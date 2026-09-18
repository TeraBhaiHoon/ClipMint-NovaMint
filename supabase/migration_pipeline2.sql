-- ClipMint pipeline 2 migration (idempotent — safe to run repeatedly).
--
-- Adds:
--   jobs.checkpoint_url        → Drive URL of the transcription checkpoint; when
--                                set, a retry with resume_from_checkpoint=true
--                                skips download/audio/transcribe/viral (4.2).
--   clips.variant              → aspect tag per uploaded file: '9x16' (default
--                                master), '1x1', '16x9'. Multi-format jobs write
--                                one row per variant with the same clip_index (3.4).
--   profiles.user_webhook_url  → user-supplied webhook endpoint (8.5).
--   profiles.notify_webhook    → opt-in flag; the dashboard job-status webhook
--                                POSTs {event, job_id, status, clips_count,
--                                error_message, timestamp} when true + URL set.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS checkpoint_url TEXT;

ALTER TABLE clips
  ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT '9x16';

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS user_webhook_url TEXT;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notify_webhook BOOLEAN NOT NULL DEFAULT FALSE;
