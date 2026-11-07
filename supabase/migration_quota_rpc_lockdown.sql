-- Quota RPC lockdown — close a direct-RPC quota-griefing hole.
--
-- increment_clips_used is SECURITY DEFINER and had EXECUTE granted to `anon`
-- and `authenticated` with NO owner check (unlike increment_videos_used /
-- refund_videos_used, which both verify auth.uid()). Any unauthenticated
-- caller could therefore inflate ANY user's clips_used directly against the
-- PostgREST RPC endpoint — quota griefing with a single curl.
--
-- The function is only ever called server-side (the job-status webhook with
-- the service-role key, for which auth.uid() is NULL), so the correct
-- posture is: service_role only.
--
-- Idempotent; safe to re-run.

REVOKE EXECUTE ON FUNCTION public.increment_clips_used(uuid, integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_clips_used(uuid, integer)
    TO service_role;

-- Defence in depth for the other two as well: they already check the caller,
-- but there is no reason for anon to hold EXECUTE at all.
REVOKE EXECUTE ON FUNCTION public.increment_videos_used(uuid)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_videos_used(uuid)
    TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.refund_videos_used(uuid)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_videos_used(uuid)
    TO authenticated, service_role;
