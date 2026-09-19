# ClipMint — Payments Audit (Cashfree PG)

Audit + upgrade of the Cashfree payment integration. Scope: `dashboard/src/app/api/cashfree/**`,
`dashboard/src/app/pricing/page.tsx` (checkout wiring), `dashboard/src/lib/cashfree.ts` (new shared
module), billing UI (`dashboard/src/app/dashboard/settings/page.tsx`), `package.json` /
`package-lock.json`. Auth, landing design and pipeline files were **not** touched.

Not committed, not pushed — everything is in the working tree.

---

## 1. API version: before → after

| | Before | After |
|---|---|---|
| SDK | `cashfree-pg` `^5.1.0` | `cashfree-pg` `^6.0.6` (npm `latest`) |
| Cashfree API version (`x-api-version`) | `2025-01-01` (SDK v5 default) — **but** cancel route hand-rolled `2023-08-01` | `2026-01-01` (SDK v6 default) — **one pinned version everywhere**, `CASHFREE_API_VERSION` in `src/lib/cashfree.ts` |

- v5 → v6 is a drop-in upgrade for this integration: same `new Cashfree(CFEnvironment, appId, secret)`
  constructor and same instance methods used here (`PGCreateOrder`, `PGFetchOrder`,
  `PGOrderFetchPayments`, `PGVerifyWebhookSignature`, `SubsManageSubscription`). The only relevant
  difference is the default `x-api-version` (`2025-01-01` → `2026-01-01`).
- All four routes now share **one** `Cashfree` client instance (lazy singleton in `src/lib/cashfree.ts`)
  with `XApiVersion` pinned to `2026-01-01`, so create/verify/webhook/cancel always talk the same
  API version and the same gateway environment (`CASHFREE_ENV`).

---

## 2. Bugs found → fixed

| # | Severity | Bug | Fix |
|---|---|---|---|
| 1 | **CRITICAL** | `cancel/route.ts` hand-rolled `POST …/pg/subscriptions/{id}/cancel` with `x-api-version: 2023-08-01`. That endpoint does not exist in the Subscriptions v3 API, so the call always failed (and was silently swallowed). | Replaced with the SDK's `cashfree.SubsManageSubscription(subscriptionId, { subscription_id, action: "CANCEL" })` — the correct v3 "manage" endpoint — using the shared v6 client. |
| 2 | **CRITICAL** | Webhook event names wrong. Cashfree sends `PAYMENT_SUCCESS_WEBHOOK` / `PAYMENT_FAILED_WEBHOOK` / `PAYMENT_USER_DROPPED_WEBHOOK`, but the handler matched `PAYMENT_SUCCESS`, `PAYMENT_FAILED`, `PAYMENT_USER_DROPPED`. Every real payment webhook fell through to `Unhandled Cashfree event` — the webhook could never upgrade a plan. (Prod log evidence: `Unhandled Cashfree event: PAYMENT_FAILED_WEBHOOK`.) | `normalizeWebhookEventType()` strips the `_WEBHOOK` suffix; the switch matches stable base names (`PAYMENT_SUCCESS`, `PAYMENT_FAILED`, `PAYMENT_USER_DROPPED`, subscription events). Both suffixed and bare forms now work. |
| 3 | **CRITICAL** | `verify-payment` had no order→user binding: any logged-in user could pass any `order_id` (e.g. a cheap order or another user's paid order) and be upgraded to a paid plan. | Now fetches the order server-side first and requires `order_tags.user_id === user.id` (403 otherwise). Amount is also cross-checked against the plan/period price (`order_amount` must equal the expected rupees). |
| 4 | **HIGH** | Webhook signature verification only used the SDK's check, which signs with the **API secret key**; if the Dashboard webhook secret differs (recommended), valid webhooks were rejected. No replay protection either. | `verifyCashfreeWebhook()`: prefers a dedicated `CASHFREE_WEBHOOK_SECRET` HMAC-SHA256 (timestamp+body, base64), falls back to the SDK check, and enforces a 5-minute timestamp window so captured webhooks cannot be replayed. Signature is always verified before any processing. |
| 5 | **HIGH** | `verify-payment` not idempotent: webhook **and** return-URL can both fire for one payment → duplicate `payments` rows, usage counters reset twice. | Guard: before upgrading, check `payments` for an existing `cashfree_order_id` + `status = 'captured'`; if present, skip the upgrade+insert and just return success. |
| 6 | **HIGH** | Webhook `PAYMENT_SUCCESS` not idempotent: Cashfree retries redeliver the same event → duplicate upgrade + duplicate payment row. | Same idempotency guard on the payments table before upgrading. |
| 7 | **HIGH** | Webhook always returned `200` even on DB failure (`"Error processed"`), swallowing genuine persistence errors so Cashfree never retried them. | Persistence failures now return `500` so Cashfree retries; handled/benign/duplicate events return `200`. Signature/malformed-body failures return `400`. |
| 8 | **HIGH** | `PAYMENT_FAILED` / `PAYMENT_USER_DROPPED` were not explicitly handled (fell into `default`), so failed payments were never recorded and the order/job state was never marked failed. | Explicit case: best-effort insert of a `status: 'failed'` payment row, never throws, always returns `200` so Cashfree stops retrying. (Coordinator finding — addressed.) |
| 9 | **MEDIUM** | `create-order` had no idempotency: double-click / retry minted a second Cashfree order → risk of double charge. | Reuses an existing in-flight order for the same `plan` + `period` (fetched via `PGFetchOrder`, still `ACTIVE`/`PENDING`, has a `payment_session_id`) and returns it instead of creating a new one. |
| 10 | **MEDIUM** | `create-order` set no explicit order expiry (Cashfree default ~30 min), so abandoned checkouts lingered and a reused order could be stale. | `order_expiry_time` set explicitly to now + 15 min (`ORDER_EXPIRY_MINUTES`). |
| 11 | **MEDIUM** | Error handlers leaked raw `err.message` to the client (create-order, verify-payment, cancel) — internal details / stack traces surfaced. | All client-facing errors are now friendly, fixed strings; full error is only `console.error`-ed server-side. |
| 12 | **MEDIUM** | `create-order` proceeded when the user's `profiles` row was missing (silent `.single()` miss → fake name, silent no-op update). | 404 "Profile not found" when the profile row is missing. Also checks the `cashfree_order_id` persistence update for errors. |
| 13 | **LOW** | `create-order` used `user.email || ""`; Cashfree requires a non-empty email at order creation. | Falls back to `customer@clipmint.app` placeholder (phone `9999999999` retained as before — customer can correct at checkout). |
| 14 | **LOW** | `cancel` marked the profile `cancelled` even when the Cashfree API call failed — user would stop being shown as billed locally while Cashfree kept charging at renewal. | If a real `cashfree_subscription_id` exists, the remote CANCEL must succeed first (else `502` and no local change). Local-only cancellation is kept for order-based purchases (nothing to cancel at Cashfree). Also checks the Supabase update for errors. |
| 15 | **LOW** | Duplicated, divergent Cashfree client initialisation in 4 routes (each re-read env, each could drift on API version / env). | Single shared `getCashfree()` in `src/lib/cashfree.ts`; all amount math centralised (`planPeriodAmountRupees` / `planPeriodAmountPaise`, `computePeriodEnd`, `orderNoteFor`) so create-order, verify-payment and the webhook can never disagree on prices or period end. |

---

## 3. Coordinator items — confirmed and addressed

### (a) `PAYMENT_FAILED_WEBHOOK` handling
Fixed in the webhook route (bug #2 + #8 above). Flow: verify signature (always, first) → replay
window → parse event → `PAYMENT_FAILED` / `PAYMENT_USER_DROPPED` insert a `status: 'failed'`
payment row (best-effort, never throws) → always `200` so Cashfree stops retrying. `PAYMENT_SUCCESS`
upgrades the plan idempotently; persistence failures return `500` for retry.

### (b) `DeprecationWarning: url.parse() … CVE security implications`
Verified the source: it comes from `follow-redirects` (the HTTP adapter axios uses, which the
cashfree-pg SDK drives on every request), **not** from the hand-rolled `fetch` in `cancel/route.ts`
(`fetch` does not use `url.parse`). Evidence in the installed tree:
`node_modules/follow-redirects/index.js` calls `url.parse`, and `follow-redirects` is axios's
dependency. Installed `follow-redirects` is **1.15.11**, which is already on the patched line for
the known follow-redirects CVE-2024-28849 (fixed in 1.15.4 / 1.15.6), so the CVE angle is mitigated
in the current tree.

Upgrading to cashfree-pg **v6 does not remove this warning** — v6 still depends on
`axios ^1.19.0` → `follow-redirects`, so every SDK call still goes through `url.parse`. It is a
benign Node deprecation notice, not an active vulnerability with the installed versions. The
hand-rolled cancel call was still replaced with the SDK (it was broken anyway — wrong endpoint +
wrong API version), but that is **not** what produced this warning. If the noise must go, the owner
option is `NODE_OPTIONS=--no-deprecation` on the Node runtime or pinning a follow-redirects fork
that stopped using `url.parse` (neither recommended — the warning is harmless).

---

## 4. Verification

- `npm install cashfree-pg@latest` → `package.json` now `"cashfree-pg": "^6.0.6"`, `package-lock.json`
  resolved entry `cashfree-pg` → `6.0.6` (verified).
- `npx tsc --noEmit` → **0 errors in any payment file**. The full run reports exactly two errors,
  both **pre-existing and out of scope**: `src/app/components/FaqAccordion.tsx` imports
  `springSmooth` which an in-progress landing redesign removed from `SectionReveal.tsx` (both files
  were already modified in the working tree before this task), and `src/app/layout.tsx` passes
  Inter `weight: "450"` which the font API rejects. Neither file was touched here (landing design
  is explicitly out of scope).
- Isolated compile of the payment module graph (temp `tsconfig` over `src/lib/cashfree.ts`,
  `src/lib/{types,server,supabase}.ts`, `src/app/api/cashfree/**`): **exit 0**.
- `npm run build` is blocked by the same pre-existing landing breakage (FaqAccordion →
  `springSmooth` module-not-found), unrelated to these changes. Payment routes are server-side API
  routes and pass typecheck + bundle independently.

---

## 5. Owner actions (do before/after shipping)

1. **Production webhook secret**: set `CASHFREE_WEBHOOK_SECRET` (recommended) and register it in
   Merchant Dashboard → Settings → Webhooks; or leave it unset to verify with the API secret key.
2. **Register the webhook URL** in Merchant Dashboard → Settings → Webhooks:
   `https://<app>/api/cashfree/webhook`, with the payment + subscription events enabled.
3. **Set `CASHFREE_ENV=PRODUCTION`** in production env (sandbox is the default when unset).
4. **Set `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `NEXT_PUBLIC_CASHFREE_APP_ID`** for the
   production merchant account (`.env.local.example` now documents all four + the webhook secret).
5. **Decide on real subscriptions**: today `create-order` creates a **regular PG order** for
   monthly/annual too — Cashfree never sees a subscription, so **auto-renewal does not happen** and
   the `SUBSCRIPTION_*` webhooks / `cashfree_subscription_id` path are dormant. If auto-renew is
   wanted, `SubsCreateSubscription` / `SubsCreatePlan` must be wired in `create-order` (the cancel
   route already speaks the correct v3 manage API now). Otherwise treat monthly/annual as one-time
   orders and drop the subscription UI copy.
6. **Collect a real customer phone** at signup/profile (currently `9999999999` placeholder at order
   creation — Cashfree lets the customer correct it in checkout, but UPI/net-banking flows are
   smoother with the real number).
7. The two pre-existing landing type errors (`FaqAccordion.tsx`, `layout.tsx`) are from an in-progress
   redesign and block `next build`; they are outside this audit's scope and should be resolved by
   whoever owns the landing redesign.

---

## 6. Files changed

- `dashboard/package.json` — cashfree-pg `^5.1.0` → `^6.0.6`
- `dashboard/package-lock.json` — lockfile regenerated for v6
- `dashboard/.env.local.example` — documented all CASHFREE_* vars (incl. new `CASHFREE_WEBHOOK_SECRET`)
- `dashboard/src/lib/cashfree.ts` — **NEW** shared module (client singleton, pinned API version,
  amount/period helpers, webhook verification + replay window)
- `dashboard/src/app/api/cashfree/create-order/route.ts` — shared client, idempotent order reuse,
  explicit expiry, profile check, sanitized errors
- `dashboard/src/app/api/cashfree/verify-payment/route.ts` — server-side order fetch, order→user
  binding, amount check, idempotency, sanitized errors
- `dashboard/src/app/api/cashfree/webhook/route.ts` — correct event names, signature+replay guard,
  explicit failed-payment handling, idempotent success, retry-aware status codes
- `dashboard/src/app/api/cashfree/cancel/route.ts` — SDK `SubsManageSubscription` (no hand-rolled
  call), remote-cancel-first semantics

Not changed (already correct, verified): `pricing/page.tsx` checkout wiring, `settings/page.tsx`
billing UI.
