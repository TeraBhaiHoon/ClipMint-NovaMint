-- ============================================================================
-- ClipMint — quota v2: atomic reservation, job-based settlement, holds
-- ============================================================================
-- Supersedes the webhook-accounting model (migration_quota.sql). Design:
--
--   * ONE atomic RPC per transition, each SECURITY DEFINER + service_role only:
--       create_job_with_quota  — reservation + job INSERT in one transaction
--       re_reserve_job_quota   — retry reservation (no-op while a job still
--                                holds its pending reservation; fresh budget +
--                                window snapshot for refunded jobs)
--       finalize_job_results   — clip rows + quota charge + done, ONE
--                                transaction; an already-charged job returns
--                                its recorded ledger IMMEDIATELY (no row
--                                rewrite, payload changes are refused to be
--                                able to alter billing)
--       fail_job_quota         — terminal status + refund, ONE transaction;
--                                refuses done jobs
--       mark_job_quota_settled — CAS pending→charged with NO counter change
--                                (history whose window no longer exists)
--       reconcile_profile_usage_floor — monotonic cumulative undercount repair
--       preserve_running_holds / sweep_quota_holds — hold consistency
--
--   * LOCK ORDER: every multi-row function takes the PROFILE row lock first,
--     then the JOB row lock — the same order as reservation (profile → job
--     insert) and the roll (profile → jobs update). No opposite-order path, no
--     deadlock cycles. Functions that must know the job's owner read the job
--     WITHOUT a lock first (user_id is immutable), take the profile lock, then
--     take and re-read the job lock. Any validation failure RAISEs, which
--     rolls back the whole transaction — there are no partial states.
--
--   * Reserved clip budget (profiles.clips_reserved) prevents concurrent
--     overspend; settle/fail releases its own hold; rolls and purchase resets
--     CARRY running holds into the new window (never drop them).
--
--   * jobs.usage_window_start snapshots the profile window at reservation.
--     Settlement charges the ORIGINAL ledger: if the window rolled (or a
--     purchase reset) mid-job, the hold is released but the current window is
--     NOT charged. Retries re-reserve against the CURRENT window and reset
--     videos_refunded for the new run lifecycle.
--
--   * Billing unit: DISTINCT ready 9x16 master clip indexes, recorded durably
--     on jobs.quota_clips_charged. Variants and failed clips are never billed.
--
--   * Idempotency: jobs.quota_state ('pending'|'charged'|'refunded') CAS makes
--     every settlement/refund a strict one-shot per job.
--
--   * Fail-closed: callers must treat RPC failure as refusal.
--
-- New job columns (coordinated with main):
--   source_language 'auto'|'hi'|'en' (default auto)
--   caption_language 'original'|'hinglish'|'en' (default original)
--   caption_pace 'fast'|'balanced'|'slow' (default balanced)
--   detected_language TEXT NULL, transcription_report JSONB NULL
--
-- Idempotent; safe to re-run. No destructive changes to existing columns.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. New columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS clips_reserved INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS quota_state TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS quota_video_charged BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS clips_budget INTEGER,
    ADD COLUMN IF NOT EXISTS requested_clips INTEGER,
    ADD COLUMN IF NOT EXISTS usage_window_start TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dispatch_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quota_clips_charged INTEGER,
    ADD COLUMN IF NOT EXISTS creation_request_id UUID,
    ADD COLUMN IF NOT EXISTS creation_fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS source_language TEXT NOT NULL DEFAULT 'auto',
    ADD COLUMN IF NOT EXISTS caption_language TEXT NOT NULL DEFAULT 'original',
    ADD COLUMN IF NOT EXISTS caption_pace TEXT NOT NULL DEFAULT 'balanced',
    ADD COLUMN IF NOT EXISTS detected_language TEXT,
    ADD COLUMN IF NOT EXISTS transcription_report JSONB;

-- Client submission id (request_id): one reservation per submission even
-- across network retries of POST /api/jobs (same ID + same payload → the
-- original job; same ID + different payload → refused via the stored
-- fingerprint). Partial unique index keeps legacy NULL rows unrestricted.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_user_creation_request
    ON public.jobs (user_id, creation_request_id)
    WHERE creation_request_id IS NOT NULL;

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_quota_state_check;
ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_quota_state_check
    CHECK (quota_state IN ('pending', 'charged', 'refunded'));

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_source_language_check;
ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_source_language_check
    CHECK (source_language IN ('auto', 'hi', 'en'));

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_caption_language_check;
ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_caption_language_check
    CHECK (caption_language IN ('original', 'hinglish', 'en'));

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_caption_pace_check;
ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_caption_pace_check
    CHECK (caption_pace IN ('fast', 'balanced', 'slow'));

CREATE INDEX IF NOT EXISTS idx_jobs_quota_state ON public.jobs (quota_state)
    WHERE quota_state = 'pending';
CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON public.jobs (user_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Effective plan limits (expiry-aware; mirrors lib/types.ts PLAN_LIMITS)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.effective_plan_limits(
    p_plan               TEXT,
    p_current_period_end TIMESTAMPTZ,
    OUT clips_limit INTEGER,
    OUT videos_limit INTEGER
)
RETURNS RECORD
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
    -- Legacy paid rows without an expiry stay active (matches isPlanExpired).
    IF p_plan IN ('creator', 'pro', 'agency')
       AND (p_current_period_end IS NULL OR p_current_period_end >= now()) THEN
        clips_limit := CASE p_plan WHEN 'creator' THEN 150 WHEN 'pro' THEN 200 ELSE 9999 END;
        videos_limit := CASE p_plan WHEN 'creator' THEN 30 WHEN 'pro' THEN 20 ELSE 9999 END;
    ELSE
        clips_limit := 5;
        videos_limit := 2;
    END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Core reservation (PROFILE row lock). Raises on refusal — callers fail
--    closed. Messages prefixed QUOTA_VIDEOS_LIMIT / QUOTA_CLIPS_LIMIT so the
--    API layer can map them to 402. Must be entered while NO job lock is held
--    (profile → job ordering).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._quota_reserve_for_user(
    p_user_id         UUID,
    p_requested_clips INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row        public.profiles%ROWTYPE;
    v_eff_clips  INTEGER;
    v_eff_videos INTEGER;
    v_remaining  INTEGER;
    v_granted    INTEGER;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user id is required' USING ERRCODE = '22004';
    END IF;

    SELECT * INTO v_row FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'profile % not found', p_user_id USING ERRCODE = 'P0002';
    END IF;

    -- Lazy monthly roll (same rules as roll_usage_period_if_due). Running
    -- holds are CARRIED over, not dropped: clips_reserved is recomputed from
    -- the jobs that still hold budget, so an in-flight job keeps its
    -- reservation in the new window and settles against its original ledger.
    IF v_row.usage_period_start < now() - interval '30 days'
       OR (v_row.plan <> 'free'
           AND v_row.current_period_end IS NOT NULL
           AND v_row.current_period_end < now()
           AND v_row.usage_period_start < v_row.current_period_end) THEN
        UPDATE public.profiles p
           SET clips_used = 0,
               videos_used = 0,
               usage_period_start = now(),
               clips_reserved = greatest(0, coalesce((
                   SELECT sum(j.clips_budget)
                     FROM public.jobs j
                    WHERE j.user_id = p.id
                      AND j.quota_state = 'pending'
                      AND j.quota_video_charged
                      AND j.clips_budget IS NOT NULL), 0))
         WHERE p.id = p_user_id;
        SELECT * INTO v_row FROM public.profiles WHERE id = p_user_id;
    END IF;

    SELECT * INTO v_eff_clips, v_eff_videos
      FROM public.effective_plan_limits(v_row.plan, v_row.current_period_end);

    IF v_row.videos_used >= v_eff_videos THEN
        RAISE EXCEPTION 'QUOTA_VIDEOS_LIMIT: You have used your % video(s) for this period. Please upgrade.',
            v_eff_videos
            USING ERRCODE = 'P0001';
    END IF;

    v_remaining := v_eff_clips - v_row.clips_used - v_row.clips_reserved;
    IF v_remaining < 1 THEN
        RAISE EXCEPTION 'QUOTA_CLIPS_LIMIT: No clips remain in this period. Please upgrade.'
            USING ERRCODE = 'P0001';
    END IF;

    v_granted := least(greatest(coalesce(p_requested_clips, 1), 1), v_remaining, 20);

    UPDATE public.profiles
       SET videos_used = videos_used + 1,
           clips_reserved = clips_reserved + v_granted,
           updated_at = now()
     WHERE id = p_user_id;

    RETURN v_granted;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. create_job_with_quota — unified atomic reservation + job creation
--    Lock order: profile (inside _quota_reserve_for_user) → job INSERT.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_job_with_quota(
    p_user_id             UUID,
    p_job                 JSONB,
    p_creation_request_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user            UUID;
    v_job_id          UUID;
    v_fingerprint     TEXT;
    v_stored_fp       TEXT;
    v_requested       INTEGER;
    v_granted         INTEGER;
    v_source_type     TEXT;
    v_caption_style   TEXT;
    v_job_mode        TEXT;
    v_caption_pace    TEXT;
    v_source_language TEXT;
    v_caption_lang    TEXT;
    v_remove_silences BOOLEAN;
    v_auto_punch      BOOLEAN;
    v_window          TIMESTAMPTZ;
BEGIN
    -- Server routes authenticate the user and call with the service key; keep
    -- the owner check as defence in depth for any future direct-RPC caller.
    v_user := coalesce(auth.uid(), p_user_id);
    IF v_user IS NULL OR v_user <> p_user_id THEN
        RAISE EXCEPTION 'not authorized to reserve quota for another user'
            USING ERRCODE = '42501';
    END IF;

    -- Hold the profile row lock for the WHOLE decision so the request-id
    -- replay check and the reservation are serialized per user (two racing
    -- submissions with the same request id: the second sees the first's job).
    PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;

    v_fingerprint := md5(p_job::text);

    IF p_creation_request_id IS NOT NULL THEN
        SELECT id, creation_fingerprint INTO v_job_id, v_stored_fp
          FROM public.jobs
         WHERE user_id = p_user_id
           AND creation_request_id = p_creation_request_id;
        IF v_job_id IS NOT NULL THEN
            IF v_stored_fp IS NOT NULL AND v_stored_fp <> v_fingerprint THEN
                RAISE EXCEPTION 'REQUEST_ID_PAYLOAD_MISMATCH: request id % was already used with a different payload',
                    p_creation_request_id
                    USING ERRCODE = 'P0001';
            END IF;
            RETURN v_job_id; -- replay: the submission already holds its reservation
        END IF;
    END IF;

    v_source_type   := CASE WHEN p_job->>'source_type' IN ('url', 'upload', 'drive')
                            THEN p_job->>'source_type' ELSE 'url' END;
    v_caption_style := CASE WHEN p_job->>'caption_style' IN
        ('hormozi','bounce','fade','glow','typewriter','glitch','neon','colorful','minimal')
                            THEN p_job->>'caption_style' ELSE 'hormozi' END;
    v_job_mode      := CASE WHEN p_job->>'job_mode' IN ('clips', 'captions')
                            THEN p_job->>'job_mode' ELSE 'clips' END;
    v_caption_pace  := CASE WHEN p_job->>'caption_pace' IN ('fast', 'balanced', 'slow')
                            THEN p_job->>'caption_pace' ELSE 'balanced' END;
    v_source_language := CASE WHEN p_job->>'source_language' IN ('auto', 'hi', 'en')
                            THEN p_job->>'source_language' ELSE 'auto' END;
    v_caption_lang  := CASE WHEN p_job->>'caption_language' IN ('original', 'hinglish', 'en')
                            THEN p_job->>'caption_language' ELSE 'original' END;
    v_remove_silences := CASE WHEN p_job->>'remove_silences' = 'true' THEN TRUE ELSE FALSE END;
    v_auto_punch      := CASE WHEN p_job->>'auto_punch_in' = 'true' THEN TRUE ELSE FALSE END;

    v_requested := CASE
        WHEN v_job_mode = 'captions' THEN 1
        WHEN p_job->>'max_clips' ~ '^[0-9]+$'
             THEN greatest(1, least((p_job->>'max_clips')::int, 20))
        ELSE 10 END;

    v_granted := public._quota_reserve_for_user(p_user_id, v_requested);

    SELECT usage_period_start INTO v_window
      FROM public.profiles WHERE id = p_user_id;

    INSERT INTO public.jobs (
        user_id, video_url, video_filename, video_storage_path, source_type,
        caption_style, caption_pace, source_language, caption_language,
        max_clips, requested_clips, job_mode, remove_silences, auto_punch_in,
        bgm_mood, custom_bgm_url, creation_request_id, creation_fingerprint,
        status, progress,
        quota_state, quota_video_charged, clips_budget, usage_window_start
    ) VALUES (
        p_user_id,
        nullif(p_job->>'video_url', ''),
        nullif(p_job->>'video_filename', ''),
        nullif(p_job->>'video_storage_path', ''),
        v_source_type,
        v_caption_style,
        v_caption_pace,
        v_source_language,
        v_caption_lang,
        v_granted,
        v_requested,
        v_job_mode,
        v_remove_silences,
        v_auto_punch,
        nullif(p_job->>'bgm_mood', ''),
        nullif(p_job->>'custom_bgm_url', ''),
        p_creation_request_id,
        v_fingerprint,
        'queued', 0,
        'pending', TRUE, v_granted, v_window
    )
    RETURNING id INTO v_job_id;

    RETURN v_job_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. re_reserve_job_quota — retry reservation.
--    * NO-OP while the job still holds a pending reservation (repeated RPC
--      calls can never grow holds or double-charge a video slot).
--    * Only refunded failed/cancelled jobs (or legacy uncharged rows) may
--      reserve again; completed jobs are refused.
--    * Charges a CURRENT-window slot and re-snapshots the window; resets
--      videos_refunded so the new run's failure can refund exactly once.
--    Lock order: unlocked job read (owner) → PROFILE lock → JOB lock.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.re_reserve_job_quota(p_job_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user      UUID;
    v_job       public.jobs%ROWTYPE;
    v_requested INTEGER;
    v_granted   INTEGER;
    v_window    TIMESTAMPTZ;
BEGIN
    -- Owner read without a lock (jobs.user_id is immutable).
    SELECT user_id INTO v_user FROM public.jobs WHERE id = p_job_id;
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'job % not found', p_job_id USING ERRCODE = 'P0002';
    END IF;

    -- Unified lock order: profile first, then the job row, then re-read.
    PERFORM 1 FROM public.profiles WHERE id = v_user FOR UPDATE;

    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;

    IF v_job.status = 'done' OR v_job.quota_state = 'charged' THEN
        RAISE EXCEPTION 'QUOTA_JOB_DONE: job % is already completed', p_job_id
            USING ERRCODE = 'P0001';
    END IF;

    -- Already holding a live reservation: idempotent no-op.
    IF v_job.quota_state = 'pending' AND v_job.quota_video_charged THEN
        RETURN coalesce(v_job.clips_budget, 0);
    END IF;

    v_requested := coalesce(v_job.requested_clips, v_job.max_clips, 10);
    v_granted   := public._quota_reserve_for_user(v_job.user_id, v_requested);

    SELECT usage_period_start INTO v_window
      FROM public.profiles WHERE id = v_job.user_id;

    UPDATE public.jobs
       SET quota_state = 'pending',
           quota_video_charged = TRUE,
           clips_budget = v_granted,
           max_clips = v_granted,
           requested_clips = v_requested,
           usage_window_start = v_window,
           videos_refunded = FALSE
     WHERE id = p_job_id;

    RETURN v_granted;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. finalize_job_results — clip rows + quota charge + done in ONE transaction.
--    * An already-CHARGED job returns its recorded ledger immediately — no
--      DELETE/re-INSERT (clip ids / storage references stay stable), and a
--      changed payload cannot alter billing.
--    * Payload is validated before any write: non-empty array, no duplicate
--      (clip_index, variant) pairs, finite nonnegative timings, every ready
--      row carries a real file reference.
--    * Zero successful masters refuses the settlement (fail-closed).
--    * Billed masters may never exceed the reserved clip budget.
--    Lock order: unlocked job read (owner) → PROFILE lock → JOB lock.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.finalize_job_results(
    p_job_id UUID,
    p_clips  JSONB,
    p_meta   JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user      UUID;
    v_job       public.jobs%ROWTYPE;
    v_budget    INTEGER;
    v_delivered INTEGER;
    v_failed    INTEGER;
    v_window    TIMESTAMPTZ;
BEGIN
    IF p_clips IS NULL OR jsonb_typeof(p_clips) <> 'array' OR jsonb_array_length(p_clips) = 0 THEN
        RAISE EXCEPTION 'p_clips must be a non-empty JSON array' USING ERRCODE = '22023';
    END IF;

    -- Duplicate (clip_index, variant) pairs in one payload are rejected up
    -- front (the unique index would also reject them after the insert, but
    -- the explicit check gives a clear error before any write).
    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_clips) AS e
         GROUP BY e->>'clip_index',
                  coalesce(nullif(trim(e->>'variant'), ''), '9x16')
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'duplicate clip_index/variant pair in p_clips'
            USING ERRCODE = '22023';
    END IF;

    -- Finite, nonnegative timings only. NaN detection must be explicit:
    -- Postgres treats 'NaN'::float8 as EQUAL to itself, so x <> x never fires.
    IF EXISTS (
        SELECT 1
          FROM jsonb_to_recordset(p_clips) AS x(
              clip_index int, variant text,
              start_time double precision, end_time double precision,
              duration_seconds double precision, status text,
              storage_path text, drive_file_id text)
         WHERE (x.start_time       IS NOT NULL AND (x.start_time       < 0 OR x.start_time       = 'NaN'::float8 OR abs(x.start_time)       = 'Infinity'::float8))
            OR (x.end_time         IS NOT NULL AND (x.end_time         < 0 OR x.end_time         = 'NaN'::float8 OR abs(x.end_time)         = 'Infinity'::float8))
            OR (x.duration_seconds IS NOT NULL AND (x.duration_seconds < 0 OR x.duration_seconds = 'NaN'::float8 OR abs(x.duration_seconds) = 'Infinity'::float8))
            OR (x.clip_index < 0)
    ) THEN
        RAISE EXCEPTION 'p_clips contains negative, NaN or infinite timing values or a negative clip index'
            USING ERRCODE = '22023';
    END IF;

    -- Status is STRICT: only ready/failed are legal; an unknown status is a
    -- payload bug and must fail the settlement, never silently ship as ready.
    IF EXISTS (
        SELECT 1
          FROM jsonb_to_recordset(p_clips) AS x(status text)
         WHERE coalesce(x.status, 'ready') NOT IN ('ready', 'failed')
    ) THEN
        RAISE EXCEPTION 'p_clips contains a status other than ready/failed'
            USING ERRCODE = '22023';
    END IF;

    -- Every ready row must reference an actual delivered file and carry a
    -- positive duration (a zero/negative-length ready clip is a render bug).
    IF EXISTS (
        SELECT 1
          FROM jsonb_to_recordset(p_clips) AS x(
              variant text, status text, storage_path text, drive_file_id text,
              duration_seconds double precision)
         WHERE lower(coalesce(x.status, 'ready')) = 'ready'
           AND (coalesce(x.storage_path, '') = ''
                AND coalesce(x.drive_file_id, '') = '')
    ) THEN
        RAISE EXCEPTION 'ready clip rows must carry a storage_path or drive_file_id'
            USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM jsonb_to_recordset(p_clips) AS x(
              status text, duration_seconds double precision)
         WHERE lower(coalesce(x.status, 'ready')) = 'ready'
           AND (x.duration_seconds IS NULL OR x.duration_seconds <= 0)
    ) THEN
        RAISE EXCEPTION 'ready clip rows must carry a positive duration_seconds'
            USING ERRCODE = '22023';
    END IF;

    -- Owner read without a lock (jobs.user_id is immutable).
    SELECT user_id INTO v_user FROM public.jobs WHERE id = p_job_id;
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'job % not found', p_job_id USING ERRCODE = 'P0002';
    END IF;

    -- Unified lock order: profile first, then the job row, then re-read.
    PERFORM 1 FROM public.profiles WHERE id = v_user FOR UPDATE;
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;

    -- Already settled: return the durable ledger IMMEDIATELY — clip rows,
    -- ids and storage references are untouched and a changed payload can
    -- never alter billing.
    IF v_job.quota_state = 'charged' THEN
        RETURN coalesce(v_job.quota_clips_charged, v_job.clips_count, 0);
    END IF;
    IF v_job.quota_state = 'refunded' THEN
        RAISE EXCEPTION 'job % was refunded and cannot be finalized', p_job_id
            USING ERRCODE = 'P0001';
    END IF;

    v_budget := v_job.clips_budget;
    -- Legacy rows finalized during the staged release carry no reservation
    -- budget; cap them by the job's KNOWN requested clip count instead of
    -- allowing an unlimited payload.
    IF v_budget IS NULL THEN
        v_budget := greatest(1, coalesce(v_job.max_clips, 10));
    END IF;

    -- 1. Reset previous rows so a retried finalize cannot duplicate the
    --    gallery (same idempotency contract as the previous insert_clips).
    DELETE FROM public.clips WHERE job_id = p_job_id;

    -- 2. Insert delivered rows (jsonb → typed columns)
    INSERT INTO public.clips (
        job_id, user_id, clip_index, variant, filename, duration_seconds,
        start_time, end_time, title, description, hashtags, hook_caption,
        viral_score, quality_score, quality_report, drive_file_id, drive_url,
        thumbnail_url, storage_path, thumbnail_path, thumbnail_drive_id,
        status, created_at
    )
    SELECT
        p_job_id, v_user,
        x.clip_index,
        coalesce(nullif(trim(x.variant), ''), '9x16'),
        coalesce(x.filename, ''),
        x.duration_seconds::real, x.start_time::real, x.end_time::real,
        x.title, x.description, x.hashtags, x.hook_caption,
        least(100, greatest(0, round(coalesce(x.viral_score, 50))))::int,
        CASE WHEN x.quality_score IS NULL THEN NULL
             ELSE least(100, greatest(0, round(x.quality_score)))::int END,
        x.quality_report,
        coalesce(x.drive_file_id, ''), coalesce(x.drive_url, ''),
        coalesce(x.thumbnail_url, ''),
        x.storage_path, x.thumbnail_path, x.thumbnail_drive_id,
        CASE WHEN x.status IN ('ready', 'failed') THEN x.status ELSE 'ready' END,
        now()
    FROM jsonb_to_recordset(p_clips) AS x(
        clip_index int, variant text, filename text, duration_seconds double precision,
        start_time double precision, end_time double precision, title text,
        description text, hashtags text[], hook_caption text,
        viral_score double precision, quality_score double precision,
        quality_report jsonb, drive_file_id text, drive_url text,
        thumbnail_url text, storage_path text, thumbnail_path text,
        thumbnail_drive_id text, status text
    );

    -- 3. Bill DISTINCT ready 9x16 masters once (variants and failures are free)
    SELECT count(DISTINCT clip_index) INTO v_delivered
      FROM public.clips
     WHERE job_id = p_job_id AND status = 'ready' AND variant = '9x16';

    -- 4. Zero-success refusal: nothing delivered means nothing to bill and
    --    nothing to mark done.
    IF v_delivered < 1 THEN
        RAISE EXCEPTION 'QUOTA_ZERO_DELIVERED: no successful 9x16 master clip to finalize'
            USING ERRCODE = 'P0001';
    END IF;

    -- 5. Billing may never exceed the reserved budget (payload inflation is
    --    refused; a NULL budget — legacy rows finalized through re_reserve —
    --    has already been capped by the reservation path).
    IF v_budget IS NOT NULL AND v_delivered > v_budget THEN
        RAISE EXCEPTION 'QUOTA_BUDGET_EXCEEDED: % delivered masters exceed the reserved budget of %',
            v_delivered, v_budget
            USING ERRCODE = 'P0001';
    END IF;

    -- 6. Quota settlement: charge the job's ORIGINAL window only. If the
    --    window rolled (or a purchase reset) mid-job, release the hold but do
    --    not bill the new window — the job row is the ledger for that charge.
    IF v_job.usage_window_start IS NOT NULL THEN
        SELECT usage_period_start INTO v_window
          FROM public.profiles WHERE id = v_user FOR UPDATE;

        IF v_window = v_job.usage_window_start THEN
            UPDATE public.profiles
               SET clips_used = clips_used + v_delivered,
                   clips_reserved = greatest(0, clips_reserved - v_budget),
                   updated_at = now()
             WHERE id = v_user;
        ELSE
            UPDATE public.profiles
               SET clips_reserved = greatest(0, clips_reserved - v_budget),
                   updated_at = now()
             WHERE id = v_user;
        END IF;
    END IF;

    -- 7. Job ledger + terminal success (single write with the charge above)
    SELECT count(*) INTO v_failed
      FROM public.clips
     WHERE job_id = p_job_id AND status <> 'ready';

    UPDATE public.jobs
       SET status = 'done',
           progress = 100,
           clips_count = v_delivered,
           quota_clips_charged = v_delivered,
           drive_folder_id = coalesce(p_meta->>'drive_folder_id', drive_folder_id, ''),
           detected_language = coalesce(nullif(p_meta->>'detected_language', ''), detected_language),
           transcription_report = coalesce(p_meta->'transcription_report', transcription_report),
           video_duration_seconds = coalesce(
               CASE WHEN p_meta->>'video_duration_seconds' ~ '^[0-9]+(\.[0-9]+)?$'
                    THEN (p_meta->>'video_duration_seconds')::real END,
               video_duration_seconds),
           error_message = CASE WHEN v_failed > 0
                THEN format('%s of %s delivered clip file(s) failed captioning.',
                            v_failed, v_delivered + v_failed)
                ELSE NULL END,
           completed_at = now(),
           quota_state = 'charged'
     WHERE id = p_job_id;

    RETURN v_delivered;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. fail_job_quota — terminal status + refund in ONE transaction.
--    * CAS on quota_state: duplicate deliveries are no-ops; the legacy
--      videos_refunded marker is honoured (never refund a slot the old
--      webhook already refunded).
--    * DONE jobs are refused: a completed job's accounting goes through the
--      floor reconcile / mark-settled paths, never a free refund.
--    Lock order: unlocked job read (owner) → PROFILE lock → JOB lock.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fail_job_quota(
    p_job_id  UUID,
    p_message TEXT,
    p_status  TEXT DEFAULT 'failed'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user    UUID;
    v_job     public.jobs%ROWTYPE;
    v_window  TIMESTAMPTZ;
    v_budget  INTEGER;
BEGIN
    IF p_status NOT IN ('failed', 'cancelled') THEN
        RAISE EXCEPTION 'invalid terminal status %', p_status USING ERRCODE = '22023';
    END IF;

    -- Owner read without a lock (jobs.user_id is immutable).
    SELECT user_id INTO v_user FROM public.jobs WHERE id = p_job_id;
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'job % not found', p_job_id USING ERRCODE = 'P0002';
    END IF;

    -- Unified lock order: profile first, then the job row, then re-read.
    PERFORM 1 FROM public.profiles WHERE id = v_user FOR UPDATE;
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;

    IF v_job.quota_state <> 'pending' THEN
        RETURN FALSE; -- already charged/refunded: idempotent no-op
    END IF;
    IF v_job.status = 'done' THEN
        -- A completed job must never be "failed into" a free refund. Its
        -- accounting goes through finalize / floor reconcile / mark-settled.
        RETURN FALSE;
    END IF;

    v_budget := coalesce(v_job.clips_budget, 0);

    UPDATE public.jobs
       SET status = CASE WHEN v_job.status IN ('failed', 'cancelled')
                         THEN v_job.status ELSE p_status END,
           error_message = CASE WHEN v_job.status IN ('failed', 'cancelled')
                         THEN v_job.error_message ELSE left(coalesce(p_message, ''), 2000) END,
           completed_at = coalesce(v_job.completed_at, now()),
           quota_state = 'refunded',
           videos_refunded = TRUE
     WHERE id = p_job_id;

    IF NOT v_job.quota_video_charged THEN
        RETURN TRUE; -- never reserved (legacy row): nothing to release
    END IF;
    IF coalesce(v_job.videos_refunded, FALSE) THEN
        RETURN TRUE; -- legacy webhook already refunded the slot
    END IF;

    -- Profile row is already locked by this transaction (unified order), so
    -- the window read below cannot race a concurrent roll/purchase.
    SELECT usage_period_start INTO v_window
      FROM public.profiles WHERE id = v_job.user_id;

    IF v_job.usage_window_start IS NOT NULL AND v_window = v_job.usage_window_start THEN
        UPDATE public.profiles
           SET videos_used = greatest(0, videos_used - 1),
               clips_reserved = greatest(0, clips_reserved - v_budget),
               updated_at = now()
         WHERE id = v_job.user_id;
    ELSE
        -- Window rolled/reset mid-job: counters were already cleared; release
        -- the hold only (it was carried over by the roll/purchase recompute).
        UPDATE public.profiles
           SET clips_reserved = greatest(0, clips_reserved - v_budget),
               updated_at = now()
         WHERE id = v_job.user_id;
    END IF;

    RETURN TRUE;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. claim_job_dispatch — atomic dispatch claim under the unified
--    profile→job lock order. One transaction performs ALL of: state decision,
--    (re-)reservation when needed, status reset, dispatch_count increment.
--    This removes the route's read-then-PATCH race where two concurrent
--    callers both reset the status and both dispatch.
--
--    Decision table:
--      done / charged                              → claimed=false (done)
--      running with dispatch_count>0 (queued       → claimed=false
--        claimed, downloading, …)                    (already_started — the
--                                                    caller's hold is NOT
--                                                    touched, no refund of
--                                                    another run's slot)
--      queued with dispatch_count=0                → claim (first dispatch;
--                                                    existing hold stands)
--      failed / cancelled (or legacy uncharged)    → re-reserve against the
--                                                    CURRENT window, reset
--                                                    status, claim
--
--    Returns the granted clip budget so the dispatcher always sends the
--    CURRENT reservation, never a stale max_clips.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_job_dispatch(p_job_id UUID)
RETURNS TABLE (claimed BOOLEAN, reason TEXT, granted_clips INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user    UUID;
    v_job     public.jobs%ROWTYPE;
    v_granted INTEGER;
    v_window  TIMESTAMPTZ;
BEGIN
    SELECT user_id INTO v_user FROM public.jobs WHERE id = p_job_id;
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'job % not found', p_job_id USING ERRCODE = 'P0002';
    END IF;

    PERFORM 1 FROM public.profiles WHERE id = v_user FOR UPDATE;
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;

    IF v_job.status = 'done' OR v_job.quota_state = 'charged' THEN
        RETURN QUERY SELECT FALSE, 'done'::text, 0;
        RETURN;
    END IF;

    IF v_job.status IN ('queued', 'downloading', 'transcribing', 'analyzing',
                        'clipping', 'captioning', 'uploading')
       AND v_job.dispatch_count > 0 THEN
        -- A run is already claimed/in flight for this job. Never touch its
        -- hold here — a duplicate click must not refund another run's slot.
        RETURN QUERY SELECT FALSE, 'already_started'::text, coalesce(v_job.clips_budget, 0);
        RETURN;
    END IF;

    -- failed / cancelled / first-ever queued (dispatch_count = 0):
    -- ensure a live reservation for the CURRENT window.
    IF v_job.quota_state = 'refunded' OR NOT v_job.quota_video_charged THEN
        v_granted := public._quota_reserve_for_user(
            v_job.user_id, coalesce(v_job.requested_clips, v_job.max_clips, 10));
        SELECT usage_period_start INTO v_window
          FROM public.profiles WHERE id = v_job.user_id;
        UPDATE public.jobs
           SET quota_state = 'pending',
               quota_video_charged = TRUE,
               clips_budget = v_granted,
               max_clips = v_granted,
               requested_clips = coalesce(v_job.requested_clips, v_job.max_clips, 10),
               usage_window_start = v_window,
               videos_refunded = FALSE
         WHERE id = p_job_id;
    ELSE
        -- Pending + held (first dispatch after create_job_with_quota).
        v_granted := coalesce(v_job.clips_budget, 0);
        IF v_granted < 1 THEN
            -- Corrupt hold (budget 0/NULL on a pending job): fail closed
            -- rather than dispatch unaccounted.
            RAISE EXCEPTION 'QUOTA_BUDGET_MISSING: job % has no reserved clip budget', p_job_id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    UPDATE public.jobs
       SET status = 'queued',
           progress = 0,
           error_message = NULL,
           dispatch_count = dispatch_count + 1
     WHERE id = p_job_id;

    RETURN QUERY SELECT TRUE, 'claimed'::text, v_granted;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8b. mark_job_quota_settled — CAS pending→charged with NO counter change, for
--    done jobs whose reservation window no longer exists (cannot prove which
--    window to bill; preserve counts as they are).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_job_quota_settled(p_job_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_job public.jobs%ROWTYPE;
BEGIN
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'job % not found', p_job_id USING ERRCODE = 'P0002';
    END IF;
    -- Only a COMPLETED job may be marked settled: this RPC must never be a
    -- general "clear any pending state" switch for arbitrary active rows.
    IF v_job.status <> 'done' OR v_job.quota_state <> 'pending' THEN
        RETURN FALSE;
    END IF;
    UPDATE public.jobs SET quota_state = 'charged' WHERE id = p_job_id;
    -- Release the hold if the job still carries one (a legacy done job
    -- reserved before the migration and never settled).
    IF v_job.quota_video_charged AND v_job.clips_budget IS NOT NULL THEN
        UPDATE public.profiles
           SET clips_reserved = greatest(0, clips_reserved - v_job.clips_budget),
               updated_at = now()
         WHERE id = v_job.user_id;
    END IF;
    RETURN TRUE;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. reconcile_profile_usage_floor — monotonic cumulative repair.
--    Eligible jobs (CURRENT window only):
--      * legacy  (usage_window_start IS NULL) completed >= window start;
--      * v2      quota_state='charged' AND usage_window_start = window start
--                (a v2 job reserved in an OLDER window that completed after a
--                roll settled to its ORIGINAL ledger and is NOT floored into
--                the new window).
--    Per-job delivered = durable ledger (quota_clips_charged) when present,
--    else the surviving ready master rows. Charge delta = max(0, floor −
--    clips_used): charges already made are part of clips_used, so nothing is
--    double-counted; counts are never reduced; legacy per-job counts are
--    PERSISTED into quota_clips_charged when the baseline is marked, so later
--    gallery deletion cannot shrink the recorded usage.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reconcile_profile_usage_floor(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row   public.profiles%ROWTYPE;
    v_floor INTEGER := 0;
    v_delta INTEGER;
BEGIN
    SELECT * INTO v_row FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'profile % not found', p_user_id USING ERRCODE = 'P0002';
    END IF;

    SELECT coalesce(sum(jc.cnt), 0) INTO v_floor
      FROM (
            SELECT j.id,
                   coalesce(max(j.quota_clips_charged),
                            count(DISTINCT c.clip_index)) AS cnt
              FROM public.jobs j
              LEFT JOIN public.clips c
                ON c.job_id = j.id AND c.status = 'ready' AND c.variant = '9x16'
             WHERE j.user_id = p_user_id
               AND j.status = 'done'
               AND j.completed_at IS NOT NULL
               AND j.completed_at >= v_row.usage_period_start
               AND (
                    j.usage_window_start IS NULL
                    OR (j.quota_state = 'charged'
                        AND j.usage_window_start = v_row.usage_period_start)
               )
             GROUP BY j.id
           ) jc;

    v_delta := greatest(0, v_floor - v_row.clips_used);
    IF v_delta > 0 THEN
        UPDATE public.profiles
           SET clips_used = clips_used + v_delta,
               updated_at = now()
         WHERE id = p_user_id;
    END IF;

    -- Persist the baseline: every LEGACY done job of this user is accounted
    -- for with its measured count stored durably (old-window ones too — their
    -- window no longer exists, counts preserved).
    UPDATE public.jobs j
       SET quota_clips_charged = coalesce(sub.cnt, j.quota_clips_charged)
      FROM (
            SELECT c.job_id, count(DISTINCT c.clip_index) AS cnt
              FROM public.clips c
              JOIN public.jobs jj ON jj.id = c.job_id
             WHERE jj.user_id = p_user_id
               AND jj.status = 'done'
               AND jj.quota_state = 'pending'
               AND jj.usage_window_start IS NULL
               AND c.status = 'ready'
               AND c.variant = '9x16'
             GROUP BY c.job_id
           ) sub
     WHERE j.id = sub.job_id;

    UPDATE public.jobs
       SET quota_state = 'charged'
     WHERE user_id = p_user_id
       AND status = 'done'
       AND quota_state = 'pending'
       AND usage_window_start IS NULL;

    RETURN v_delta;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Hold consistency
-- ─────────────────────────────────────────────────────────────────────────────

-- Recompute clips_reserved from the jobs that actually hold budget. Locks the
-- profile row FIRST, then reads the jobs snapshot, then writes — so a
-- concurrent reservation (which takes the same profile lock first) can never
-- be overwritten by a stale aggregate. Also clears stale holds when no job
-- holds anything anymore (scalar COALESCE, not an inner join that skips the
-- update). Called by the payment routes after zeroing counters so running
-- holds survive a purchase reset in the new window.
CREATE OR REPLACE FUNCTION public.preserve_running_holds(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_holds INTEGER := 0;
BEGIN
    PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;

    SELECT coalesce(sum(clips_budget), 0) INTO v_holds
      FROM public.jobs
     WHERE user_id = p_user_id
       AND quota_state = 'pending'
       AND quota_video_charged
       AND clips_budget IS NOT NULL;

    UPDATE public.profiles
       SET clips_reserved = greatest(0, v_holds),
           updated_at = now()
     WHERE id = p_user_id;

    RETURN greatest(0, v_holds);
END;
$$;

-- Full consistency sweep for the cron reconciler: per profile, lock the row,
-- snapshot the holds, write. Same lock order as every other quota writer.
CREATE OR REPLACE FUNCTION public.sweep_quota_holds()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r       RECORD;
    v_holds INTEGER := 0;
    v_fixed INTEGER := 0;
BEGIN
    FOR r IN SELECT id FROM public.profiles ORDER BY id LOOP
        PERFORM 1 FROM public.profiles WHERE id = r.id FOR UPDATE;

        SELECT coalesce(sum(clips_budget), 0) INTO v_holds
          FROM public.jobs
         WHERE user_id = r.id
           AND quota_state = 'pending'
           AND quota_video_charged
           AND clips_budget IS NOT NULL;
        v_holds := greatest(0, v_holds);

        IF EXISTS (SELECT 1 FROM public.profiles
                   WHERE id = r.id AND clips_reserved <> v_holds) THEN
            UPDATE public.profiles
               SET clips_reserved = v_holds,
                   updated_at = now()
             WHERE id = r.id;
            v_fixed := v_fixed + 1;
        END IF;
    END LOOP;
    RETURN v_fixed;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. roll_usage_period_if_due — REPLACE: explicit profile lock first, then a
--     jobs snapshot, then the write — carries running holds into the new
--     window instead of dropping them (holds are released when their job
--     settles/fails; settlement bills the original ledger, never the new one).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.roll_usage_period_if_due(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row   public.profiles%ROWTYPE;
    v_holds INTEGER := 0;
BEGIN
    IF p_user_id IS NULL OR coalesce(auth.uid(), p_user_id) <> p_user_id THEN
        RETURN;
    END IF;

    SELECT * INTO v_row FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF v_row.usage_period_start < now() - interval '30 days'
       OR (v_row.plan <> 'free'
           AND v_row.current_period_end IS NOT NULL
           AND v_row.current_period_end < now()
           AND v_row.usage_period_start < v_row.current_period_end) THEN
        SELECT coalesce(sum(clips_budget), 0) INTO v_holds
          FROM public.jobs
         WHERE user_id = p_user_id
           AND quota_state = 'pending'
           AND quota_video_charged
           AND clips_budget IS NOT NULL;

        UPDATE public.profiles
           SET clips_used = 0,
               videos_used = 0,
               usage_period_start = now(),
               clips_reserved = greatest(0, v_holds)
         WHERE id = p_user_id;
    END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Permissions — counters/plan/limits are service+RPC mutations only
-- ─────────────────────────────────────────────────────────────────────────────

-- Jobs: users may READ their own rows (RLS); INSERT/UPDATE move behind the
-- service RPCs. This closes the direct-INSERT quota bypass and the
-- direct-PATCH status/clips_count retry mutation.
REVOKE INSERT, UPDATE ON TABLE public.jobs FROM authenticated;

-- Profiles: revoke full-row UPDATE, then grant only the preference columns.
-- Counters (clips_used, videos_used, clips_reserved), plan and limits are no
-- longer writable by the browser.
REVOKE UPDATE ON TABLE public.profiles FROM authenticated;
GRANT UPDATE (full_name, avatar_url, notify_email, notify_discord,
              notify_job_complete, notify_job_failed, notify_weekly_report,
              discord_webhook_url, user_webhook_url, notify_webhook)
    ON TABLE public.profiles TO authenticated;

-- Retire the legacy raw-counter RPCs entirely: with jobs INSERT revoked the
-- old client path cannot create jobs, so these endpoints are dead surface
-- that would otherwise permit direct quota griefing (unclips_used decrement,
-- unguarded clip-count inflation). Service_role keeps EXECUTE only because
-- the staged-release gateway may still call them; no anonymous or browser
-- caller needs any of them.
REVOKE EXECUTE ON FUNCTION public.refund_videos_used(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_videos_used(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_clips_used(UUID, INTEGER) FROM PUBLIC, anon, authenticated;

-- New functions: service_role only (routes authenticate users server-side).
REVOKE ALL ON FUNCTION public.effective_plan_limits(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.effective_plan_limits(TEXT, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public._quota_reserve_for_user(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._quota_reserve_for_user(UUID, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.create_job_with_quota(UUID, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_job_with_quota(UUID, JSONB, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.re_reserve_job_quota(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.re_reserve_job_quota(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_job_results(UUID, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_job_results(UUID, JSONB, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.fail_job_quota(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_job_quota(UUID, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.claim_job_dispatch(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_job_dispatch(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.mark_job_quota_settled(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_job_quota_settled(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.reconcile_profile_usage_floor(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_profile_usage_floor(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.preserve_running_holds(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preserve_running_holds(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.sweep_quota_holds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_quota_holds() TO service_role;

-- Roll: ensure PUBLIC/anon never hold EXECUTE (older CREATE default posture)
-- and the browser (self-checked) plus service paths do.
REVOKE EXECUTE ON FUNCTION public.roll_usage_period_if_due(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.roll_usage_period_if_due(UUID) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Backfill — history preserved; only PROVABLE current-window undercounts
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    r RECORD;
    v_delta INTEGER;
BEGIN
    -- a) Legacy jobs the old webhook already refunded (CAS marker) — settled.
    UPDATE public.jobs
       SET quota_state = 'refunded'
     WHERE status IN ('failed', 'cancelled')
       AND quota_state = 'pending'
       AND videos_refunded = TRUE;

    -- b) Terminal history older than 30 days: settle without touching
    --    counters (no provable window remains). Legacy per-job delivered
    --    counts are persisted into the durable ledger so later gallery
    --    deletion cannot shrink the recorded usage.
    UPDATE public.jobs j
       SET quota_clips_charged = coalesce(sub.cnt, j.quota_clips_charged)
      FROM (
            SELECT c.job_id, count(DISTINCT c.clip_index) AS cnt
              FROM public.clips c
              JOIN public.jobs jj ON jj.id = c.job_id
             WHERE jj.status = 'done'
               AND jj.quota_state = 'pending'
               AND jj.usage_window_start IS NULL
               AND coalesce(jj.completed_at, jj.created_at) < now() - interval '30 days'
               AND c.status = 'ready'
               AND c.variant = '9x16'
             GROUP BY c.job_id
           ) sub
     WHERE j.id = sub.job_id;

    UPDATE public.jobs
       SET quota_state = 'charged'
     WHERE status = 'done'
       AND quota_state = 'pending'
       AND usage_window_start IS NULL
       AND coalesce(completed_at, created_at) < now() - interval '30 days';

    UPDATE public.jobs
       SET quota_state = 'refunded'
     WHERE status IN ('failed', 'cancelled')
       AND quota_state = 'pending'
       AND coalesce(completed_at, created_at) < now() - interval '30 days';

    -- c) Remaining legacy done jobs (recent): monotonic cumulative floor per
    --    profile — charges only the provable current-window undercount, then
    --    marks the baseline. Never decrements; deleted-clip usage preserved.
    FOR r IN SELECT DISTINCT user_id FROM public.jobs
              WHERE status = 'done' AND quota_state = 'pending'
                AND usage_window_start IS NULL
    LOOP
        v_delta := public.reconcile_profile_usage_floor(r.user_id);
        RAISE NOTICE 'backfill floor %: +%', r.user_id, v_delta;
    END LOOP;
END;
$$;
