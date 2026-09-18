-- ============================================================================
-- ClipMint — quota / atomic counter migration
-- ============================================================================
-- Replaces the unguarded `increment_videos_used()` from migration_phase4.sql
-- (which incremented unconditionally, so it could be raced past the limit and
-- had no way to signal refusal) and adds the companion counters used by the
-- dashboard and the API gateway.
--
-- Conventions:
--   * every function returns BOOLEAN and never RAISEs for quota exhaustion, so
--     callers can answer with a clean 402/429 instead of a 500;
--   * `true`  = counter updated;
--   * `false` = refused (limit reached / unknown profile / invalid count).
--
-- Run this in the Supabase SQL Editor.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Idempotency marker for the webhook refund
-- ─────────────────────────────────────────────────────────────────────────────
-- The pipeline PATCHes `jobs.status` to failed/cancelled *before* it calls
-- /api/webhooks/job-status, so the webhook cannot use the status transition to
-- detect a duplicate delivery. This flag is the "we already refunded" record:
-- the webhook claims it with a conditional PATCH (videos_refunded=eq.false) and
-- only the winning caller performs the refund.
ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS videos_refunded BOOLEAN NOT NULL DEFAULT FALSE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. increment_videos_used — atomic, limit-aware reservation
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_videos_used(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_used  INTEGER;
    v_limit INTEGER;
BEGIN
    -- A user may only move their own counter. Server-side callers (service_role)
    -- have no `sub` claim, so auth.uid() is NULL and the check is skipped.
    IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
        RAISE EXCEPTION 'not authorized to update another user''s quota'
            USING ERRCODE = '42501';
    END IF;

    SELECT videos_used, videos_limit
      INTO v_used, v_limit
      FROM public.profiles
     WHERE id = p_user_id
       FOR UPDATE; -- serialise concurrent submissions for this user

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF v_used >= v_limit THEN
        RETURN FALSE; -- quota exhausted — caller returns 402/429
    END IF;

    UPDATE public.profiles
       SET videos_used = v_used + 1,
           updated_at  = now()
     WHERE id = p_user_id;

    RETURN TRUE;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. increment_clips_used — atomic addition of produced clips
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_clips_used(p_user_id UUID, p_count INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_count IS NULL OR p_count <= 0 THEN
        RETURN FALSE;
    END IF;

    PERFORM 1
       FROM public.profiles
      WHERE id = p_user_id
        FOR UPDATE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    UPDATE public.profiles
       SET clips_used = clips_used + p_count,
           updated_at = now()
     WHERE id = p_user_id;

    RETURN TRUE;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. refund_videos_used — atomic decrement, never below zero
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refund_videos_used(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
        RAISE EXCEPTION 'not authorized to update another user''s quota'
            USING ERRCODE = '42501';
    END IF;

    PERFORM 1
       FROM public.profiles
      WHERE id = p_user_id
        FOR UPDATE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    UPDATE public.profiles
       SET videos_used = greatest(0, videos_used - 1),
           updated_at  = now()
     WHERE id = p_user_id;

    RETURN TRUE;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Permissions
-- ─────────────────────────────────────────────────────────────────────────────
-- authenticated: dashboard (browser, RLS-scoped session)
-- service_role:  API gateway + webhook (bypasses RLS by design)
GRANT EXECUTE ON FUNCTION public.increment_videos_used(UUID)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_clips_used(UUID, INTEGER)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refund_videos_used(UUID)               TO authenticated, service_role;
