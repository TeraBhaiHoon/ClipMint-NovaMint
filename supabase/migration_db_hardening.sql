-- DB hardening from the advisor review (2026-11-07).
--
-- 1. search_path: handle_new_user / handle_updated_at / can_create_job had a
--    role-mutable search_path (advisor 0011). Re-created with an EMPTY
--    search_path and schema-qualified bodies — the Supabase-recommended
--    posture for trigger + SECURITY DEFINER functions.
-- 2. can_create_job: dead database code (zero callers in dashboard/ or
--    pipeline/) AND anon-executable SECURITY DEFINER (advisor 0028) — an
--    unauthenticated caller could probe any user's quota state. Revoked from
--    anon/authenticated; kept for service_role in case the server wants it.
-- 3. handle_new_user: the auth trigger must stay working for
--    supabase_auth_admin, but anon/authenticated never need to RPC it
--    directly (advisor 0028). Trigger execution does not check EXECUTE.
-- 4. RLS init-plan (advisor 0003): 12 policies re-evaluated auth.uid() per
--    row; rewritten with the (select auth.uid()) wrapper — identical logic,
--    evaluated once per statement.
-- 5. leaked_password_protection: enabled separately via the auth-config API.
--
-- Idempotent-ish: CREATE OR REPLACE + DROP IF EXISTS/CREATE for policies.
-- INSERT policies carry only WITH CHECK (USING is omitted for them).

-- ── 1. search_path + 2/3. revoke dead / non-client functions ─────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
    INSERT INTO public.profiles (id, full_name, avatar_url)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        NEW.raw_user_meta_data->>'avatar_url'
    );
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_create_job(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
    v_plan TEXT;
    v_videos_used INTEGER;
    v_videos_limit INTEGER;
BEGIN
    SELECT plan, videos_used, videos_limit
    INTO v_plan, v_videos_used, v_videos_limit
    FROM public.profiles
    WHERE id = p_user_id;

    RETURN v_videos_used < v_videos_limit;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.can_create_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_job(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ── 4. RLS init-plan rewrite: auth.uid() → (select auth.uid()) ───────────

-- profiles.Users can view own profile (SELECT)
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
    AS PERMISSIVE FOR SELECT
    TO public
    USING (((select auth.uid()) = id));
-- profiles.Users can update own profile (UPDATE)
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
    AS PERMISSIVE FOR UPDATE
    TO public
    USING (((select auth.uid()) = id));
-- api_keys.Users can view own API keys (SELECT)
DROP POLICY IF EXISTS "Users can view own API keys" ON public.api_keys;
CREATE POLICY "Users can view own API keys" ON public.api_keys
    AS PERMISSIVE FOR SELECT
    TO public
    USING (((select auth.uid()) = user_id));
-- api_keys.Users can create own API keys (INSERT)
DROP POLICY IF EXISTS "Users can create own API keys" ON public.api_keys;
CREATE POLICY "Users can create own API keys" ON public.api_keys
    AS PERMISSIVE FOR INSERT
    TO public
    WITH CHECK (((select auth.uid()) = user_id));
-- api_keys.Users can update own API keys (UPDATE)
DROP POLICY IF EXISTS "Users can update own API keys" ON public.api_keys;
CREATE POLICY "Users can update own API keys" ON public.api_keys
    AS PERMISSIVE FOR UPDATE
    TO public
    USING (((select auth.uid()) = user_id));
-- api_keys.Users can delete own API keys (DELETE)
DROP POLICY IF EXISTS "Users can delete own API keys" ON public.api_keys;
CREATE POLICY "Users can delete own API keys" ON public.api_keys
    AS PERMISSIVE FOR DELETE
    TO public
    USING (((select auth.uid()) = user_id));
-- jobs.Users can view own jobs (SELECT)
DROP POLICY IF EXISTS "Users can view own jobs" ON public.jobs;
CREATE POLICY "Users can view own jobs" ON public.jobs
    AS PERMISSIVE FOR SELECT
    TO public
    USING (((select auth.uid()) = user_id));
-- jobs.Users can create own jobs (INSERT)
DROP POLICY IF EXISTS "Users can create own jobs" ON public.jobs;
CREATE POLICY "Users can create own jobs" ON public.jobs
    AS PERMISSIVE FOR INSERT
    TO public
    WITH CHECK (((select auth.uid()) = user_id));
-- jobs.Users can update own jobs (UPDATE)
DROP POLICY IF EXISTS "Users can update own jobs" ON public.jobs;
CREATE POLICY "Users can update own jobs" ON public.jobs
    AS PERMISSIVE FOR UPDATE
    TO public
    USING (((select auth.uid()) = user_id));
-- clips.Users can view own clips (SELECT)
DROP POLICY IF EXISTS "Users can view own clips" ON public.clips;
CREATE POLICY "Users can view own clips" ON public.clips
    AS PERMISSIVE FOR SELECT
    TO public
    USING (((select auth.uid()) = user_id));
-- clips.Users can update own clips (UPDATE)
DROP POLICY IF EXISTS "Users can update own clips" ON public.clips;
CREATE POLICY "Users can update own clips" ON public.clips
    AS PERMISSIVE FOR UPDATE
    TO public
    USING (((select auth.uid()) = user_id));
-- payments.Users can view own payments (SELECT)
DROP POLICY IF EXISTS "Users can view own payments" ON public.payments;
CREATE POLICY "Users can view own payments" ON public.payments
    AS PERMISSIVE FOR SELECT
    TO public
    USING (((select auth.uid()) = user_id));

-- handle_updated_at is also a trigger function: anon/authenticated never
-- need to RPC it directly (same reasoning as handle_new_user above).
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated;

-- ACCEPTED (not findings): authenticated EXECUTE on increment_videos_used /
-- refund_videos_used is intentional — the dashboard calls them for the
-- signed-in user's own quota and both verify auth.uid() = p_user_id inside.
