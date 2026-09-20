# ClipMint — Setup Guide (what's done, what's left, how to verify)

_Last updated: 2026-09-20. Real secret VALUES live in `ENV_SETUP.md` (gitignored) — this
guide only names the variables, never prints them._

The goal: you can hand this to anyone and they can take ClipMint from "code pushed" to
"a stranger can sign up, pay, and get clips". Every step ends with a **verify**, so you
never guess whether it worked.

---

## PART 0 — Already done (verified — do NOT redo)

| Area | State |
|---|---|
| Website repo → Vercel | `VikashMeena777/ClipMint-NovaMint` auto-synced from the processing repo; live on `clipmint.novamintnetworks.in` |
| Processing repo | `TeraBhaiHoon/ClipMint-NovaMint` — all workflows active (process-video, sync-web, probes) |
| Database | Supabase `zwgooqazqxqnfdgmhsev` — every migration applied live (quota RPCs, R2 fields, `source_title`, `render_error` + unique clip index) |
| Supabase Auth settings | Site URL = `https://clipmint.novamintnetworks.in`; redirect allow-list now includes `/auth/callback` for both domains + localhost ✅ (fixed 2026-09-20) |
| Google login | Provider enabled with your Google OAuth client |
| Cloudflare R2 | Bucket `clipmint-delivery` live; round-trip probe PASSED; 15 old clips migrated and downloadable |
| GitHub secrets (processing repo) | Supabase pair, Groq, NVIDIA NIM, Deepgram, YouTube cookies, rclone (Drive), R2×4, REPO_A_TOKEN, DASHBOARD_URL, NEXT_PUBLIC_APP_URL, WEBHOOK_SECRET |
| Auth hardening | Revoked-session → clean "session expired" redirect; secure cookies; password recovery page |
| Payments SDK | Cashfree SDK v6.0.6 across all four routes; webhook signature-verified; PAYMENT_FAILED handled |
| Landing page | Rebuilt from scratch with the video showcase carousel |

---

## PART 1 — Cloudflare R2 final settings **(≈5 min)** ← do this first

The upload/download system depends on two settings that only you can confirm:

1. **Bucket → Settings → Object lifecycle rules** — add BOTH rules:
   - Name `expire-delivery` · Prefix `delivery/` · **Delete objects 1 day after upload**
   - Name `expire-sources` · Prefix `sources/` · **Delete objects 7 days after upload**
   Why: finished clips live in R2 for 24h (then re-materialise from Drive on demand);
   uploaded source videos are deleted by the pipeline after success, with 7 days as the
   safety net. Without these, the 10 GB free tier slowly fills.
2. **Bucket → Settings → CORS policy** — paste (this is what lets the browser upload):
   ```json
   [{"AllowedOrigins":["https://clipmint.novamintnetworks.in","https://clipmint.vikashbuilds.in","http://localhost:3000"],
     "AllowedMethods":["PUT"],"AllowedHeaders":["*"],"MaxAgeSeconds":3600}]
   ```
3. **Verify**: Dashboard → New Video → Upload Video tab → pick any small MP4 → the button
   shows "Uploading N%" and then the job starts. If the upload stalls at 0%, CORS is wrong.

## PART 2 — Vercel environment variables **(≈10 min)**

Vercel → your ClipMint project → Settings → Environment Variables. All values are in
`ENV_SETUP.md` section 1. The full list (names only):

```
NEXT_PUBLIC_SUPABASE_URL        SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SUPABASE_ANON_KEY   GITHUB_TOKEN            (= TeraBhaiHoon PAT, Actions: write)
                                GITHUB_REPO             (= TeraBhaiHoon/ClipMint-NovaMint)
CASHFREE_APP_ID                 CASHFREE_ENV            (= PRODUCTION)
CASHFREE_SECRET_KEY             CASHFREE_WEBHOOK_SECRET
NEXT_PUBLIC_CASHFREE_APP_ID
NEXT_PUBLIC_APP_URL             DASHBOARD_URL           (= https://clipmint.novamintnetworks.in)
CRON_SECRET
R2_ACCOUNT_ID                   R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY            R2_DELIVERY_BUCKET      (= clipmint-delivery)
RCLONE_CONF_B64              ← REQUIRED for old clips: paste the SAME value as the GitHub secret
```
After saving: **Deployments → ⋯ → Redeploy** (env changes only apply to new deployments).
**Verify**: `POST https://clipmint.novamintnetworks.in/api/uploads/presign` without login
returns `401 Unauthorized` (route live), and an old job's Download button saves a file.

## PART 3 — Cashfree production switch **(≈15 min, plus their review time)**

1. **Merchant dashboard → Settings → Webhooks**: URL
   `https://clipmint.novamintnetworks.in/api/cashfree/webhook`, enable **payment** events
   (success + failed) and subscription events if you plan to use them.
2. Copy the webhook secret → set `CASHFREE_WEBHOOK_SECRET` in Vercel (done above).
3. Confirm the three Vercel Cashfree values are the **production** merchant's
   (`CASHFREE_ENV=PRODUCTION`).
4. **Product decision**: monthly/annual plans currently create **one-time orders** — a
   customer pays once and does not auto-renew. Two options: (a) keep it simple, treat them
   as one-time and adjust the pricing copy, or (b) wire real Cashfree subscriptions
   (`SubsCreatePlan` / `SubsCreateSubscription`) — say the word and I'll build it.
5. **Verify**: make one real ₹1-ish payment from the pricing page in production, confirm
   the plan activates on the account page, then refund it from the Cashfree dashboard.

## PART 4 — Email templates **(≈5 min)**

Supabase → Authentication → Email Templates: confirm **Confirm signup** and **Reset
password** both link to `{{ .ConfirmationURL }}` (default). The app already sends
`/auth/callback` as the redirect, and the allow-list now accepts it (fixed above).
**Verify**: sign up with a fresh email, click the link, land signed-in on the dashboard.
Also do a Google login from a private window.

## PART 5 — The end-to-end acceptance test **(≈20 min)**

Run these in order; each one exercises a different subsystem:

1. **Signup → confirm → login** (email + Google) — Part 4's verify.
2. **Process a real video**: New Video → paste a YouTube link → wait 5–15 min →
   clips appear; click Download on one (instant from R2).
3. **The 24h re-materialisation**: the day after a job, click Download on that same old
   clip — it takes a few seconds longer (re-pulled from Drive), then works.
4. **Upload path**: Upload Video tab → a file under 2 GB → job processes → source is
   deleted from R2 afterwards (visible in the Cloudflare bucket: no file left in
   `sources/` for that job).
5. **Captions mode**: New Video → "Full video captions" + both auto-edit toggles → verify
   the output is one captioned video, tighter pacing, punch-in zooms.
6. **Quota**: free account → try to exceed the plan limit → clean "upgrade" message (not
   a crash).
7. **Payment**: Part 3's verify.

## PART 6 — Nice-to-haves (not blockers)

- **Showcase carousel**: drop 4–8 real finished clips into `dashboard/public/showcase/clips/`
  and fill the entries in `public/showcase/manifest.json` (schema is inside the file).
  Until then the page shows generated poster cards.
- **YouTube imports**: the cookies secret expires every few weeks — when a YouTube job
  fails with `YOUTUBE_BOT_CHECK`, re-export cookies and update the `YOUTUBE_COOKIES`
  secret. Direct uploads are immune.
- **Remotion licence**: the Free License covers ≤3 employees and automation use — keep
  the confirmation handy if you exceed that.

---

## Troubleshooting quick table

| Symptom | Cause | Fix |
|---|---|---|
| Upload button stuck at 0% | R2 CORS missing | Part 1 step 2 |
| Download says "archive reference missing" | Clip predates the migration | Re-run `migrate-r2.yml` (Actions → One-time migrate…) |
| "Could not start video processing" | Vercel `GITHUB_TOKEN`/`GITHUB_REPO` wrong or expired PAT | Part 2, then Redeploy |
| Login bounces to "session expired" repeatedly | Cookies blocked in browser | Allow cookies for the site; the fix clears bad session state |
| Google login "redirect_uri_mismatch" | Google Cloud console redirect URI | Google Cloud → Credentials → OAuth client → Authorized redirect URIs must contain `https://zwgooqazqxqnfdgmhsev.supabase.co/auth/v1/callback` |
| Webhook logs "Invalid signature" | `CASHFREE_WEBHOOK_SECRET` mismatch | Re-copy from Cashfree dashboard → Vercel → Redeploy |
