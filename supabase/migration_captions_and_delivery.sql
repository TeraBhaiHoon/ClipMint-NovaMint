-- ============================================================================
-- ClipMint — captions/auto-edit mode + private clip delivery
-- ============================================================================
-- Two features, one migration:
--
-- 1. CAPTIONS MODE (job_mode='captions'): caption the WHOLE uploaded video
--    with optional auto-editing (silence jump-cuts + punch-in zooms) instead
--    of cutting viral clips.
--
-- 2. PRIVATE CLIP DELIVERY: finished clips + thumbnails are copied from the
--    Drive archive into a PRIVATE Supabase bucket. The dashboard serves them
--    through an ownership-checked route that mints short-lived signed URLs —
--    this fixes the "request access" Google Drive wall on downloads while
--    keeping every other user's clips unreachable.
-- ============================================================================

-- ── 1. Jobs: mode + auto-edit toggles + uploaded-file location ──────────────
ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS job_mode TEXT NOT NULL DEFAULT 'clips',
    ADD COLUMN IF NOT EXISTS remove_silences BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS auto_punch_in BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS video_storage_path TEXT;

-- ── 2. Clips: private-storage paths (Drive columns remain as archive) ───────
ALTER TABLE public.clips
    ADD COLUMN IF NOT EXISTS storage_path TEXT,
    ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;

-- ── 3. Buckets ───────────────────────────────────────────────────────────────
-- clip-outputs: written ONLY by the pipeline (service_role bypasses RLS);
-- read NEVER by clients directly — the dashboard API mints 1-hour signed URLs
-- after an RLS ownership check, so cross-user access is impossible.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('clip-outputs', 'clip-outputs', false, 1073741824)
ON CONFLICT (id) DO NOTHING;

-- video-uploads: users upload their source videos into their own folder;
-- the pipeline downloads them via a server-generated signed URL.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('video-uploads', 'video-uploads', false, 524288000)
ON CONFLICT (id) DO NOTHING;

-- Per-user isolation on video-uploads: insert/read only under auth.uid()/
DROP POLICY IF EXISTS "video-uploads insert own folder" ON storage.objects;
CREATE POLICY "video-uploads insert own folder" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'video-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "video-uploads select own folder" ON storage.objects;
CREATE POLICY "video-uploads select own folder" ON storage.objects
FOR SELECT TO authenticated
USING (
    bucket_id = 'video-uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
);
