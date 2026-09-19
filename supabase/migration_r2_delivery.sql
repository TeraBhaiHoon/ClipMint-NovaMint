-- ============================================================================
-- ClipMint — R2 delivery cache (replaces Supabase Storage for media)
-- ============================================================================
-- Owner architecture decision (2026-09-19):
--   * Google Drive  = permanent archive (pipeline rclone upload, unchanged);
--   * Cloudflare R2 = 24-hour delivery cache (lifecycle rules on the bucket:
--       prefix delivery/ -> expire 1 day after upload
--       prefix sources/ -> expire 7 days after upload);
--   * Supabase Storage = NOT used for media at all — the two buckets created
--     by migration_captions_and_delivery.sql are dropped here.
-- Downloads flow through /api/clips/[clipId]/download: R2 if present, else a
-- one-file re-materialisation from Drive, then a 302 to a presigned URL.
-- ============================================================================

-- 1. Drive file id of each clip's thumbnail — needed to restore it from the
--    archive after the R2 cache evicts it.
ALTER TABLE public.clips
    ADD COLUMN IF NOT EXISTS thumbnail_drive_id TEXT;

-- 2. Remove the Supabase Storage buckets (and everything in them) — the
--    R2 cache replaces them. NOTE: Supabase blocks direct SQL DELETE on
--    storage.* (storage.protect_delete trigger), so the buckets were
--    deleted through the Storage API instead:
--      DELETE {SUPABASE_URL}/storage/v1/bucket/video-uploads
--      DELETE {SUPABASE_URL}/storage/v1/bucket/clip-outputs
--    (Authorization: Bearer {SUPABASE_SERVICE_ROLE_KEY})
DROP POLICY IF EXISTS "video-uploads insert own folder" ON storage.objects;
DROP POLICY IF EXISTS "video-uploads select own folder" ON storage.objects;
