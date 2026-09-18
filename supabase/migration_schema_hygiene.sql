-- ============================================================================
-- ClipMint — schema hygiene migration (2026-09-18)
--   1. updated_at column + trigger on clips  (backlog 7.2)
--   2. transcript_srt TEXT -> transcript_json JSONB          (backlog 7.3)
--   3. index on clips(drive_file_id)                          (backlog 7.4)
-- Idempotent. Run in the Supabase SQL Editor.
-- ============================================================================

-- 1. updated_at on clips -----------------------------------------------------
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS set_clips_updated_at ON public.clips;
CREATE TRIGGER set_clips_updated_at
    BEFORE UPDATE ON public.clips
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. transcript_srt -> transcript_json ---------------------------------------
-- The column has never been written by any pipeline version (verified across
-- all rows), so repurposing loses nothing.
ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS transcript_json JSONB;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'jobs'
          AND column_name = 'transcript_srt'
    ) THEN
        ALTER TABLE public.jobs DROP COLUMN transcript_srt;
    END IF;
END $$;

COMMENT ON COLUMN public.jobs.transcript_json IS
    'Full word-level transcript stored as JSONB by the pipeline (optional; kept for replay/inspection).';

-- 3. Lookup index -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_clips_drive_file ON public.clips(drive_file_id);
