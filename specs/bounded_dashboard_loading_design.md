# Bounded dashboard loading follow-up — 2026-11-16

## Scope and evidence

The completed supported-browser verification found a failed QA job stuck on the initial skeleton, slow completed-job/settings loads, and inconclusive library-link activation. Read-only database lookup confirms both referenced jobs exist for the QA account; it does not measure customer-request latency or establish a database resource cause.

Source-backed gaps: core dashboard loads have no logical deadline; job detail awaits optional thumbnail recovery before releasing its loading state; shared mounted/single-flight refs can outlive their effect identity. New-video copy implies draft autosave although settings are persisted only at creation.

## Implementation

1. Add a small effect-scoped request helper: bound the complete async operation, including auth preparation/body parsing, abort cancellable work, settle loading on failure, ignore late/disposed results, and permit a subsequent explicit retry. Keep independent scopes for optional media and core data.
2. Job detail: load scoped job/clip queries without waiting on thumbnails, clear job-specific state on identity changes, add bounded focus/visibility resync, preserve existing retry admission and saved language settings.
3. Shared profile/library/payment loading: use the helper, cancel on teardown/identity changes, clear account data on sign-out/account change without awaiting SDK work inside the auth callback. Permit preferences to display if rollover fails, but mark usage unavailable and keep quota-sensitive UI disabled until fresh usage is verified. Server admission remains authoritative.
4. Correct draft-save copy; do not add unrequested draft storage or redesign link hit areas.
5. Test actual helper/component loading behavior with never-settling mocks, late results, cancellation, retries and independent thumbnails. Run dashboard/API regressions, typecheck and build. Browser follow-up must check real retry rendering without submitting another job.

## Security checkpoint

- Authentication and owner-filtered/RLS reads retained; no service-role credentials in browser code.
- Account transition invalidates cached data and in-flight callbacks.
- No weakening of auth locks, cookie protection or server-side create/retry quota gates.
- Stale usage is not presented as fresh availability; no new database mutation or refund rules.
- Generic customer-facing errors only; no provider keys or raw database error leakage.
- No processing submissions, customer clip overwrite, payment, email or permission approval in browser checks.

## Acceptance and limits

A stalled logical load must exit its initial skeleton within the chosen deadline and expose retry. Job details must render when thumbnail fetch stalls. Account/job A responses must not update B. Authenticated library link activation remains unverified until actual browser follow-up, not declared fixed from JSX. An independent transcript is still needed for numerical speech accuracy. Local code changes are not proof of a deployed fix; report publication and browser checks separately.
