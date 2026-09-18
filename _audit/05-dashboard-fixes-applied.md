# ClipMint — Dashboard / API-Gateway Bug Fixes Applied

Scope: `supabase/**`, `dashboard/**`, `api-gateway/**` only.
Not committed, not pushed — everything is in the working tree.

Verification commands (run at the end, from the repo root):

```
cd dashboard && npm run build        →  exit 0, "✓ Compiled successfully in 17.8s",
                                        "✓ Generating static pages using 7 workers (26/26)"
cd api-gateway && npx --yes tsc --noEmit  →  exit 0, no output
```

Per-file TypeScript check (`dashboard/node_modules/.bin/tsc --noEmit -p tsconfig.json`) also
passed with 0 errors. `dashboard/node_modules` had to be installed (`npm install`) to run the
build; the resulting `package-lock.json` churn (`"peer": true` removals) was reverted with
`git checkout -- dashboard/package-lock.json` so the diff stays surgical.

---

## BUG 1 (CRITICAL) — Realtime not enabled / frozen UI

Status: **fixed** (code + migration; migration must be applied to the live DB)

### Files
- **ADDED** `supabase/migration_realtime.sql`
- `dashboard/src/app/dashboard/[jobId]/page.tsx`
- `dashboard/src/app/dashboard/page.tsx`

### What changed
1. `migration_realtime.sql` adds `public.jobs` and `public.clips` to the `supabase_realtime`
   publication inside a `DO $$ … $$` block that first checks `pg_publication_tables` (re-adding
   raises) and also checks that the publication itself exists. It then sets
   `REPLICA IDENTITY FULL` on both tables — justified in a comment: with the default identity an
   UPDATE payload only carries the primary key (plus changed columns), so the dashboard's
   `setJob(payload.new as Job)` would wipe status/progress/error_message.
2. `[jobId]/page.tsx` keeps the `postgres_changes` subscription and adds a 4 s polling fallback:
   one `load()` reads the job row + clips, guarded by `inFlightRef` so requests never overlap,
   `disposed` guards against setState after unmount, and the interval self-clears via
   `statusRef` once the job reaches `done|failed|cancelled`. Realtime INSERTs on clips are now
   deduped by id.
3. `dashboard/page.tsx` polls the job list every 8 s **only while at least one job is
   non-terminal** (`jobsRef` holds the latest list; no request when everything is terminal).
   The Realtime INSERT handler also dedupes by id so polling + Realtime cannot create duplicate
   React keys.
4. Stuck-job affordance: `STUCK_AFTER_MS = 45 min` compared against `started_at || created_at`;
   a "This job looks stuck — Retry" card appears in a non-terminal state and calls the existing
   `handleRetry` (which now posts just `{ job_id }` and surfaces the server's error message).

### Verification
- `npx tsc --noEmit` and `npm run build` clean.
- Migration SQL reviewed for idempotency (guarded `ALTER PUBLICATION`, unconditional but safe
  `REPLICA IDENTITY`). Not applied to a live database — see "Could not do".

---

## BUG 2 (CRITICAL) — unvalidated user URL flows into shell

Status: **fixed**

### Files
- **ADDED** `dashboard/src/lib/validateUrl.ts` (`validateVideoUrl`, `normalizeVideoUrl`,
  `MAX_URL_LENGTH`, `VideoProvider`)
- `dashboard/src/app/api/trigger-pipeline/route.ts`
- `dashboard/src/app/dashboard/new/page.tsx`
- `api-gateway/src/index.ts` (self-contained copy of the same rules)

### What changed
1. `validateVideoUrl(raw)` returns `{ok:true, url, provider}` (with the **normalised** URL) or
   `{ok:false, reason}` with a human-readable reason. Rules: string + non-empty, ≤ 2048 chars,
   rejects `` ` $ ; | & > < \ ' " ( ) `` and any whitespace/control char, must parse with
   `new URL()`, **https only** (decision documented in the file: http is rejected even for
   direct media files), host allowlist (youtube.com/www./m./music., youtu.be, instagram.com/www.,
   facebook.com/www./m., fb.watch, drive.google.com, vimeo.com), or any host whose path ends in
   `.mp4/.mov/.m4v/.webm` (case-insensitive). Everything else is rejected.
2. `normalizeVideoUrl()` strips `si, fbclid, igshid, igsh, feature, ref, ref_src, _r, utm_*`
   and `t` (YouTube only) while preserving `v, list, start, id`.
3. `trigger-pipeline` now reads **only `job_id`** from the request body. The job row is re-read
   with the caller's RLS-scoped client, and the dispatch inputs come from the stored
   `video_url` / `caption_style` / `max_clips`. The stored URL is validated (and normalised)
   before dispatch; on failure the route PATCHes the job to `failed` with the reason and
   returns 400.
4. `new/page.tsx` validates **before** inserting the job row; the reason is rendered in the
   existing `error` state and no job is created for an invalid URL. The normalised URL is what
   gets inserted. The server check remains the security boundary (client check is UX only).
5. `api-gateway/src/index.ts` `handleCreateJob` runs the same validation/normalisation (duplicated
   on purpose — a Worker cannot import the Next.js tree; commented at the top of both files to
   keep them in sync) and only ever stores/dispatches the normalised URL.

Note on the rejected `&`: the brief explicitly lists `&` among the shell-unsafe characters, so
multi-parameter links such as `…/watch?v=ID&list=PL…` are rejected on purpose (documented in both
copies). Single-link share URLs (`https://youtu.be/ID?si=…`, `…/watch?v=ID`) — the normal case —
pass and get normalised.

### Verification
Compiled the module standalone with `tsc` and exercised it with node. Sample results:

```
FAIL "https://clipmint.novamintnetworks.in/?fbclid=abc"  → "That link isn't a supported video source…"
FAIL "https://youtu.be/abc123?si=xyz&t=30"               → "…unsupported character (&)…"
OK   "https://www.youtube.com/watch?v=abc123"            → youtube -> https://www.youtube.com/watch?v=abc123
OK   "https://www.instagram.com/reel/XYZ/"               → instagram
OK   "https://drive.google.com/file/d/1AbC/view?usp=sharing" → drive
OK   "https://cdn.example.com/video.mp4"                 → direct
FAIL "http://cdn.example.com/video.mp4"                  → "Only https:// links are supported…"
FAIL "https://youtube.com/watch?v=$(whoami)"             → "…unsupported character ($)…"
FAIL "https://youtube.com/watch?v=a`id`"                 → "…unsupported character (`)…"
FAIL "https://youtube.com/watch?v=a;rm -rf /"            → "…unsupported character (;)…"
FAIL "https://youtube.com/watch?v=a b"                   → "…unsupported character (space or line break)…"
normalize("https://youtu.be/abc?si=xyz&t=30&feature=share") → "https://youtu.be/abc"
```

---

## BUG 3 (HIGH) — quota enforced only in the browser

Status: **fixed**

### Files
- **ADDED** `supabase/migration_quota.sql`
- `dashboard/src/app/dashboard/new/page.tsx`
- `dashboard/src/app/api/trigger-pipeline/route.ts`
- `dashboard/src/app/api/webhooks/job-status/route.ts`
- `api-gateway/src/index.ts`
- `dashboard/src/lib/server.ts` (added `createServiceClient()`)

### What changed
1. `migration_quota.sql` replaces the unguarded `increment_videos_used` with an atomic,
   limit-aware version: `SELECT … FOR UPDATE`, returns `false` when
   `videos_used >= videos_limit` (never raises for quota), updates `updated_at`, and refuses
   calls for another user's id when the caller is an end user (`auth.uid()` present). Adds
   `increment_clips_used(uuid,int)` and `refund_videos_used(uuid)` (`greatest(0, videos_used-1)`).
   All three `RETURNS BOOLEAN`, granted to `authenticated, service_role`.
   It also adds `jobs.videos_refunded BOOLEAN NOT NULL DEFAULT FALSE` (idempotency marker, below).
2. **Trigger route**: reads `profiles` (service role, falls back to the session client if
   `SUPABASE_SERVICE_ROLE_KEY` is unset, with a warning), returns **402** with a clear message
   when the video/clip quota is exhausted (and marks the job `failed` so it cannot sit in
   `queued`), and clamps `max_clips` to `min(max(requested,1), remaining_clips)` before dispatch.
   `remaining_clips` is computed from `clips_limit - clips_used`.
3. **Gateway**: profile query now also selects `clips_used, clips_limit`; `max_clips` is clamped
   to the remaining clips (min 1); 429 when the video or clip quota is exhausted. The video slot
   is reserved atomically *before* the job row is created, and refunded if job creation or the
   GitHub dispatch fails (no pipeline run ⇒ no webhook ⇒ no automatic refund).
4. **Client (`new/page.tsx`)**: the dead clamp is gone — the value actually inserted is
   `Math.min(maxClips, remaining)` and the slider state is updated to match. A failed profile
   fetch no longer skips the checks; it shows "Could not verify your plan limits". The
   read-modify-write `profiles.update({videos_used: profile.videos_used + 1})` is replaced by
   `supabase.rpc("increment_videos_used", …)`, and the result is checked: `false` ⇒ inline
   "You've reached your limit" error and no job is created. The slot is reserved before the
   insert and released with `refund_videos_used` if the insert fails.
   If the RPC itself errors (e.g. migration not applied) it is logged loudly and the flow
   continues — the server-side clip clamp still applies.
5. **Webhook**: `clips_used` is now incremented through `increment_clips_used` (atomic) instead
   of a read-modify-write.

### Refund idempotency (important deviation from the suggested approach)
The brief suggested "read the job's current status and bail if it is already failed/cancelled".
That cannot work here: `.github/workflows/process-video.yml` PATCHes `jobs.status` to
`failed`/`cancelled` in an earlier step and only then calls the webhook, so the status is
*always* already terminal when the webhook runs — the guard would skip every legitimate refund.
Instead the webhook claims a **compare-and-set** on the new marker column:

```
PATCH /rest/v1/jobs?id=eq.<job>&videos_refunded=eq.false   body: {"videos_refunded": true}
Prefer: return=representation
```

Only the delivery that gets a non-empty array back calls `refund_videos_used`. A repeated
`failed` webhook therefore cannot decrement twice. If the column is missing (migration not
applied) the claim returns 400, the refund is skipped, and a clear error is logged — the webhook
still returns 200 and the notification path is unaffected.

### Verification
- Typecheck + build clean.
- Logic reviewed against the workflow (lines ~1456-1506: status PATCH happens before the
  webhook POST) — this is what invalidates the status-based guard.

### Known residual (not in scope, called out for honesty)
A duplicate `done` webhook can still add `clips_used` twice — the brief only required idempotency
for the videos refund, so no marker was added for clips.

---

## BUG 4 (HIGH) — webhook 500s before its quota work

Status: **fixed**

### File
- `dashboard/src/app/api/webhooks/job-status/route.ts`

### What changed
1. `new Resend(process.env.RESEND_API_KEY)` was removed from the top of the handler. Resend is
   now constructed at the point of use, inside the existing `try/catch`, and only when
   `RESEND_API_KEY` is present; a missing key logs a warning and the email is skipped. The
   email block runs after all DB bookkeeping, so nothing can prevent the `clips_used` /
   `videos_used` updates, and no email failure changes the HTTP status.
2. The SDK's `{ error }` result is now checked and logged (the v6 SDK resolves with an error
   rather than throwing for API errors).
3. HTML escaping added (`escapeHtml`) and applied to `errorMessage` and `videoUrl` in both
   templates, and to `jobUrl` when it is interpolated into `href` attributes.

### Verification
Typecheck + build clean; grep confirms the only `new Resend(...)` left is inside the guarded
point-of-use block.

---

## BUG 5 (MEDIUM) — clips cannot be previewed, durations dead

Status: **fixed**

### File
- `dashboard/src/app/dashboard/[jobId]/page.tsx`

### What changed
1. `parseDriveFileId(clip)` uses `drive_file_id` when present, else parses
   `/file/d/<id>` or `?id=<id>` out of `drive_url`.
2. The thumbnail is now a button that opens a modal with
   `<iframe src="https://drive.google.com/file/d/<id>/preview">` in a `9 / 16`
   (`aspectRatio`) box, with close (X / backdrop click), Download and Open-in-Drive actions.
   When a clip has no thumbnail but does have a Drive id, a small "Preview" button is shown
   instead. The existing per-clip download button and Drive link are unchanged.
3. `clipDurationSeconds(clip)` renders the badge only when `duration_seconds` is a positive
   number, otherwise falls back to `end_time - start_time` when both are present; if neither
   exists no badge is rendered.

### Verification
Typecheck + build clean. No live Drive URL was available to click through in this environment.

---

## BUG 6 (MEDIUM) — API key usage columns never updated

Status: **fixed** (with a documented limitation)

### File
- `api-gateway/src/index.ts`

### What changed
On every successful API-key authentication the worker now patches
`api_keys.last_used_at = now()` and `requests_today = requests_today + 1`. The key lookup selects
`id, user_id, requests_today` to do so, and the write is dispatched through
`ctx.waitUntil(...)` so it never blocks the response. The router's `fetch` now accepts the
Workers `ExecutionContext` as a third argument. A helper (`recordKeyUsage`) falls back to
`void task` if `ctx` is absent (local/dev invocation) and logs failures instead of throwing.

Limitation (in a code comment): `api_keys` has no date column, so `requests_today` is only ever
incremented — it is **not** reset at midnight. A true daily reset needs a `requests_date`
column, which was out of scope for this fix (the brief allows this fallback explicitly).

### Verification
`npx --yes tsc --noEmit` → exit 0.

---

## BUG 7 (LOW) — CORS and docs stale

Status: **fixed**

### Files
- `api-gateway/wrangler.toml` — `CORS_ORIGIN` set to `https://clipmint.novamintnetworks.in`
  (with a comment); the `GITHUB_REPO` example comment corrected to
  `TeraBhaiHoon/ClipMint-NovaMint`.
- `api-gateway/README.md` — it did not repeat the stale values; added a short "Configuration"
  section documenting the vars (real domain), the required `wrangler secret` entries (real repo)
  and the URL/quota behaviour of `POST /api/v1/jobs`.
- `dashboard/.env.local.example` — added `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`,
  `GITHUB_TOKEN`, `GITHUB_REPO`, `WEBHOOK_SECRET`, `RESEND_API_KEY`, `CRON_SECRET` (plus comments
  on the existing three), all with placeholder values.
- `dashboard/src/app/api/cron/keep-alive/route.ts` — fails closed: 500 when `CRON_SECRET` is
  unset, 401 when the bearer token does not match, and the anon-key fallback is gone (500 unless
  `SUPABASE_SERVICE_ROLE_KEY` is configured) so the endpoint can no longer report success without
  proving privileged DB access.
- `dashboard/src/middleware.ts` — matcher now excludes `api/`
  (`"/((?!api/|_next/static|_next/image|favicon.ico|…).*)"`) so API routes are no longer gated
  by (or dependent on) the browser-session middleware; the comment explains why. Every API route
  authenticates itself: `trigger-pipeline` and the Cashfree order/cancel/verify routes use the
  session (`getUser`), `webhooks/job-status` requires `WEBHOOK_SECRET`,
  `cashfree/webhook` verifies the Cashfree signature, `cron/keep-alive` requires `CRON_SECRET`,
  and `contact` is an intentionally public form endpoint.
- `README.md` (root) — added the two new migrations to the DB setup steps and the repo tree.

### Verification
Build clean; matcher regex reviewed against every route under `src/app/api` (all authenticate
independently).

---

## BUG 8 (LOW) — `.env.local` committed?

Status: **verified clean — no change needed**

- `git ls-files dashboard/.env.local` → no output (not tracked).
- `git check-ignore -v dashboard/.env.local` → `dashboard/.gitignore:34:.env*` → ignored.
- The root `.gitignore` also ignores `.env.local` (line 14).

So the file cannot be re-committed. **`dashboard/.env.local` does exist on disk and contains
real secrets** (Supabase, and possibly more) in the working tree — the values were not printed
or modified here. `dashboard/.env.local.example` is tracked (ignore rules do not untrack it),
which is what we want for documentation.

---

## Could not do / not done

1. **Migrations were not applied to the live database.** There are no DB credentials in this
   environment and the repo convention is to run SQL files manually in the Supabase SQL Editor
   (README step 4). Until then: Realtime stays off (the new polling fallback keeps the UI
   working), and the quota RPCs / `videos_refunded` marker do not exist (the webhook logs a clear
   error and skips the refund; the client logs and proceeds; the server-side clip clamp still
   applies). Files: `supabase/migration_realtime.sql`, `supabase/migration_quota.sql`.
2. **`increment_videos_used` changed semantics** (was `RETURNS VOID`, now `RETURNS BOOLEAN`).
   Both known callers were updated (dashboard client, API gateway). If anything else calls it
   outside this repo it must handle the boolean.
3. **Residual quota hole** (documented in code): the dashboard reserves the video slot before
   inserting the job, so the trigger route treats `videos_used > videos_limit` as over-quota.
   A client that ignores the reservation RPC and posts a job row directly at exactly the limit
   could therefore still dispatch one job. The atomic RPC is the primary enforcement for all
   supported flows (dashboard + gateway).
4. **`clips_used` is not idempotent** for a duplicated `done` webhook (see BUG 3).
5. **Lint was not run** (`npm run lint` is bare `eslint` with no file arguments); the required
   build + typecheck both pass.
6. Untouched: `remotion-captions/**`, `.github/workflows/**`. An untracked `pipeline/` directory
   appeared in the working tree while this work was in progress (not created by these changes)
   and was left alone.
7. Nothing was committed or pushed.
