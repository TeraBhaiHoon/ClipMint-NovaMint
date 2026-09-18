-- ============================================================================
-- ClipMint — Supabase Realtime publication migration
-- ============================================================================
-- The dashboard subscribes to `postgres_changes` on public.jobs and
-- public.clips, but neither table was part of the `supabase_realtime`
-- publication (verified: select count(*) from pg_publication_tables where
-- pubname = 'supabase_realtime' returned 0). Without this, a job page loads as
-- `queued` and never updates.
--
-- This migration is idempotent — re-adding a table to a publication raises, so
-- each table is guarded by a pg_publication_tables lookup.
--
-- Run this in the Supabase SQL Editor (or `supabase db push`).
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        RAISE NOTICE 'Publication supabase_realtime does not exist — skipping';
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'jobs'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs';
        RAISE NOTICE 'Added public.jobs to supabase_realtime';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'clips'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.clips';
        RAISE NOTICE 'Added public.clips to supabase_realtime';
    END IF;
END $$;

-- REPLICA IDENTITY FULL is required for the dashboard to receive complete rows.
--
-- With the default replica identity (primary key only), an UPDATE event only
-- carries the primary key (plus changed columns), so the dashboard's
-- `setJob(payload.new as Job)` would replace the row with a partial object and
-- wipe status/progress/error_message. FULL makes the WAL record the whole row.
-- The cost is a slightly larger WAL entry per update, which is acceptable for
-- these low-volume tables.
ALTER TABLE public.jobs REPLICA IDENTITY FULL;
ALTER TABLE public.clips REPLICA IDENTITY FULL;
