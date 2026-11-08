-- ═══════════════════════════════════════════════════════════════════════════
-- Monthly usage windows — resets clips_used / videos_used when the window rolls.
--
-- Every plan is quoted as "N clips per month", so usage must be per-window,
-- not lifetime. `usage_period_start` anchors the current window; the RPC
-- below rolls it lazily on read (no cron needed):
--   1. 30 days elapsed since the window started      → fresh window (free users
--      get their 5 clips/month back; paid passes roll if ever >30 days).
--   2. A paid plan just expired and the window began
--      during that pass                              → fresh Free window today.
-- New purchases additionally reset the window at payment time.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles
    add column if not exists usage_period_start timestamptz not null default now();

-- Backfill: anchor pre-existing windows at account creation. The column
-- default of now() would freeze already-expired accounts at their stale
-- usage until the new window ages past 30 days; created_at lets the expiry
-- rule (window began during the pass) fire on first read instead.
update public.profiles set usage_period_start = created_at
 where usage_period_start >= now() - interval '1 second';

create or replace function public.roll_usage_period_if_due(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- Only the row owner (authenticated) or service_role may roll a window.
    -- service_role JWTs carry no auth.uid(), so the coalesce lets them pass.
    if p_user_id is null or coalesce(auth.uid(), p_user_id) <> p_user_id then
        return;
    end if;

    update public.profiles
       set clips_used = 0,
           videos_used = 0,
           usage_period_start = now()
     where id = p_user_id
       and (
           -- Window older than 30 days → monthly roll.
           usage_period_start < now() - interval '30 days'
           -- Paid pass expired with the window inside it → fresh Free window.
           or (
               plan <> 'free'
               and current_period_end is not null
               and current_period_end < now()
               and usage_period_start < current_period_end
           )
       );
end;
$$;

revoke all on function public.roll_usage_period_if_due(uuid) from public, anon;
grant execute on function public.roll_usage_period_if_due(uuid) to authenticated, service_role;
