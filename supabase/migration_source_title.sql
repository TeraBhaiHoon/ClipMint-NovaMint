-- ClipMint — persist the source video's real title on the job row
-- (the pipeline's metadata step PATCHes this; the job page shows it instead
-- of a filename). Applied 2026-09-19 via Management API.
ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS source_title TEXT;
