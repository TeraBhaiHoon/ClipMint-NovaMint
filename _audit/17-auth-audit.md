# 17 — Auth System Audit + Fixes

**Date:** 2026-09-20
**Scope:** Authentication ONLY — middleware/session refresh, email confirmation, password reset, Google OAuth, cookie hardening, user-facing error messages, RLS spot-check. Payments, landing-page design and pipeline files were **not** touched.
**Result:** **12 bugs found, 12 fixed** (7 auth-logic, 5 hardening/UX). 1 build gate is blocked by a **pre-existing, other-session WIP** (see §4).

---

## 1. Bugs found → fixed

| # | Location | Bug | Fix |
|---|----------|-----|-----|
| 1 | `src/app/auth/callback/route.ts` | **Password reset was dead end-to-end.** A `?type=recovery` link was exchanged and the user was dumped on `/dashboard` — there was **no page to actually set a new password** anywhere in the app. | Callback now routes `type=recovery` → new `/auth/update-password` page (created), which calls `supabase.auth.updateUser({ password })` and returns the user to `/login` on success. |
| 2 | `src/app/dashboard/settings/page.tsx` (Security tab) | **"Send Password Reset Email" passed NO `redirectTo`** to `resetPasswordForEmail()`, so the recovery link pointed at Supabase's default site URL instead of `/auth/callback` — it would never reach the recovery handler. It was also `fire-and-forget` (the success toast shipped even if the call failed). | Now passes `redirectTo: <origin>/auth/callback`, awaits the result, and only toasts success when the call actually succeeds. |
| 3 | `src/app/auth/callback/route.ts` | **Open redirect.** `next` was interpolated into `${origin}${next}` unvalidated; a crafted `?next=//evil.com` redirects off-site. | `safeNextPath()` only accepts same-site `"/"`-prefixed paths (rejects `//` and anything else → `/dashboard`). Also enforced in middleware and the login page. |
| 4 | `src/app/login/page.tsx` | **Callback/URL errors were silently dropped.** The callback forwards `/login?error=auth` and Supabase appends `error=access_denied&error_description=…` on OAuth denial, but the login page never read the `error` param — the user got no feedback at all. | Login page reads `?error=` on mount (client-side, no Suspense boundary) and maps it via `friendlyUrlError()` (`auth`, `oauth_cancelled`, `session_expired`). |
| 5 | `src/app/login/page.tsx` | **Raw Supabase error strings leaked** in every auth path: "Invalid login credentials", "User already registered", "Unable to validate email address…". No rate-limit-aware copy either. | `friendlyAuthError(code, message)` maps to human copy: wrong credentials, unconfirmed email, existing account, invalid email, weak password, **429/rate-limit ("Too many attempts…")**, disabled provider. Unknown errors get a generic fallback. |
| 6 | `src/app/login/page.tsx` | **Unconfirmed users got a confusing error.** After signing up (confirmation required), a login attempt surfaced raw "Email not confirmed" instead of telling them what to do. | `email_not_confirmed` → "Please confirm your email first — check your inbox (and spam) for the confirmation link." |
| 7 | `src/app/login/page.tsx` | **Signup with an existing email was misleading.** `signUp()` returns a user with zero identities (no error) — the code showed "Check your email for a confirmation link!", which is wrong for a returning user. | `data.user.identities.length === 0` → "An account with this email already exists. Please sign in instead." |
| 8 | `src/middleware.ts` | **Destination was lost on auth bounce.** An unauthenticated request to `/dashboard/analytics` redirected to `/login` bare; post-login the user landed on generic `/dashboard`. | Middleware sets `?next=<path+search>` on the redirect; login page validates it (`safeNextPath`) and returns the user where they were headed. Callback already honors `next`. |
| 9 | `src/middleware.ts` | **Refreshed session cookies were dropped on redirect.** `NextResponse.redirect()` doesn't carry the refreshed cookies that `supabaseResponse` accumulated during `getUser()`, so the very session the middleware just refreshed was lost on every bounce. | `copySessionCookies()` merges `supabaseResponse` cookies onto every redirect response. |
| 10 | `src/middleware.ts`, `src/lib/server.ts`, `src/lib/supabase.ts` | **Auth cookies lacked the `Secure` flag.** @supabase/ssr's default cookie options omit `secure`; on HTTP the session cookie would travel in the clear. (`httpOnly` must stay `false` — the browser client reads it — so Secure + `sameSite=lax` default is the correct hardening.) | `cookieOptions: { secure: NODE_ENV === "production" }` added to the middleware, server-client and browser-client. |
| 11 | `src/middleware.ts` | **Revoked/rotated refresh token = noisy 400 + stale cookies (production log finding).** Vercel runtime logs show repeated `[AuthApiError]: Invalid Refresh Token: Refresh Token Not Found` (400, `refresh_token_not_found`) — a session whose refresh token was revoked (logout elsewhere, stale cookie). `getUser()` failed, the user was silently bounced, and the dead cookies stayed behind. | Middleware detects the refresh-token failure (`refresh_token_not_found` / `invalid_refresh_token` / message contains "Refresh Token") and: **(1)** wipes every `sb-*` cookie, **(2)** redirects once to `/login?error=session_expired` ("Your session expired. Please sign in again."), **(3)** logs a `console.warn` for observability — no loop, no crash, no raw 400 to the user. `/auth/*` paths are excluded so an email-recovery `code` in the URL is never swallowed; `getUser()` is wrapped so a Supabase outage never logs everyone out. Expired and revoked sessions land on the exact same graceful path. |
| 12 | `src/app/dashboard/settings/page.tsx` | **Profile-save blew raw Supabase DB errors** (`updateError.message`, e.g. `PGRST…`) into the user's toast. | Friendly toast + `console.error` for the real message. |

### Verified-correct (no change needed)
- **`getUser()` is used everywhere for session validation** (middleware, every dashboard page, all auth-required API routes). No `getSession()` anywhere that trusts the JWT.
- **Webhooks are correctly NOT session-gated**: `POST /api/webhooks/job-status` (WEBHOOK_SECRET ✓), `POST /api/cashfree/webhook` (Cashfree signature verification ✓), `GET /api/cron/keep-alive` (CRON_SECRET bearer ✓), `POST /api/contact` (public by design ✓). All other `/api` routes (`trigger-pipeline`, `uploads/presign`, `clips/*`, `cashfree/create-order|cancel|verify-payment`) call `auth.getUser()` themselves — the middleware matcher's `/api` exclusion is safe. ✓
- **Email-confirmation flow**: signup → "Check your email…" → link hits `/auth/callback?code=…&type=signup` → exchange → middleware `getUser()` validates against Supabase → dashboard. New confirmed-user session, no stale-state risk. ✓
- **Google OAuth**: full-page redirect (not popup) to `/auth/callback` with `redirectTo`; PKCE code-verifier handled in cookies by @supabase/ssr — no manual `state` handling needed. ✓

## 2. RLS spot-check (from migrations in `supabase/`)

| Table | Policies | Verdict |
|-------|----------|---------|
| `profiles` | SELECT/UPDATE `USING auth.uid() = id`; INSERT handled by SECURITY-DEFINER trigger `handle_new_user()` | ✅ sane — users can only read/update their own row |
| `api_keys` | SELECT/INSERT/UPDATE/DELETE `auth.uid() = user_id` | ✅ |
| `jobs` | SELECT/INSERT/UPDATE `auth.uid() = user_id` | ✅ |
| `clips` | SELECT/UPDATE `auth.uid() = user_id` | ✅ |
| `payments` | SELECT own only; INSERT is service-role only (no client insert policy) | ✅ |

Ownership is re-checked server-side on every sensitive route (`download`/`links` verify clip→job→user with the service client; `trigger-pipeline` verifies job.user_id === caller). Quota RPCs (`increment_videos_used` etc.) additionally reject `auth.uid() != p_user_id`. CSRF surface on login/signup is nil — the browser talks to Supabase Auth directly; there are no credential-carrying state-changing endpoints of our own.

## 3. Files changed

| File | Change |
|------|--------|
| `dashboard/src/middleware.ts` | Secure cookie flag, revoked-refresh-token handling (clear cookies → `/login?error=session_expired`), `?next=` preservation, cookie copy onto redirects, `getUser()` guarded |
| `dashboard/src/lib/supabase.ts` | `cookieOptions.secure` (prod) |
| `dashboard/src/lib/server.ts` | `cookieOptions.secure` (prod) |
| `dashboard/src/app/auth/callback/route.ts` | `type=recovery` → update-password; `safeNextPath` open-redirect guard; OAuth error passthrough; `next` preserved on error |
| `dashboard/src/app/auth/update-password/page.tsx` | **NEW** — completes the password-reset flow (`updateUser({ password })`) |
| `dashboard/src/app/login/page.tsx` | Friendly error mapping incl. rate-limit + `session_expired`; unconfirmed-user and existing-email handling; `next` honored |
| `dashboard/src/app/dashboard/settings/page.tsx` | `redirectTo` on reset email; friendly profile-save error |

Report: `_audit/17-auth-audit.md` (this file).

## 4. Verification

- `npx tsc --noEmit` → **my files are clean.** The only remaining errors are 4 pre-existing type errors in `dashboard/src/app/api/cashfree/create-order/route.ts` — a **concurrent session's in-flight payment refactor** (uncommitted edits to `create-order` + `verify-payment`, new untracked `src/lib/cashfree.ts`, scratch `cf6.json`/`cf6.tgz`). I did **not** touch that file (out of scope) and the same errors were present before my changes.
- `npm run build` → **Compiled successfully** (all pages incl. new `/auth/update-password`), then **TypeScript phase fails** on the same single pre-existing `create-order` error. Auth changes are build-clean; the gate is blocked by the payment WIP.

## 5. Still needs the owner (Supabase dashboard / infra)

1. **Google provider config**: in Supabase Auth → Providers → Google, confirm **"auth/callback" is in the allowed Redirect URLs** (URL patterns): `https://clipmint.vikashbuilds.in/auth/callback` and `https://<vercel-preview>/auth/callback`. This was already required; unchanged by this audit.
2. **Email template URLs**: Auth → Email Templates → Confirm signup **and** Reset password must point at `{{ .SiteURL }}/auth/callback` (or the callback must be in Site URL's redirect allow-list). The reset template is what triggers the fixed recovery flow.
3. **Confirm that `handle_new_user()` trigger + all RLS policies from `supabase/schema.sql` are present in the live project** (RLS can change out-of-band). If profiles aren't auto-created on signup, new users see limbo on the dashboard. Re-run `schema.sql` if unsure (it is idempotent-ish; policies `CREATE POLICY` are not — verify first).
4. **Verify the dead-session fix in production** once deployed: sign out in a second tab (or delete the user's session via the Auth dashboard), then hit a `/dashboard/*` page in the old tab and confirm it lands on `/login` with "Your session expired…" and a console `[auth] Session refresh failed (…)` warn — not a 400, not a loop.
5. **CSRF on webhook secrets already covered** (WEBHOOK_SECRET, CRON_SECRET); no action.