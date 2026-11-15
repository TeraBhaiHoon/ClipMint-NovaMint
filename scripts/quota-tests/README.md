# ClipMint quota v2 — SQL integration tests

Real-Postgres tests via **PGlite** (Postgres WASM, no server, no docker).
The runner applies the repo's ACTUAL `supabase/schema.sql` and every
`supabase/migration_*.sql` in dependency order — a broken migration aborts
the run; nothing is mocked at the SQL level.

Explicit fixtures (Supabase surface only):
- roles `anon` / `authenticated` / `service_role` + Supabase-style default
  grants applied BEFORE the migrations, so every `REVOKE` in the migrations is
  exercised against the real posture;
- `auth.users` table + `auth.uid()` backed by the `request.jwt.claim.sub` GUC
  (tests impersonate an authenticated browser session where needed);
- a minimal `storage` schema (buckets/objects/foldername) for the storage
  migrations.

Coverage: atomic reservation+creation, request_id replay + payload
fingerprint, reserved clip budget overspend prevention, expired-plan gating,
atomic finalize (distinct ready 9x16 masters billed once, variants/failed
free, durable ledger, zero/over-budget refusal, strict payload validation,
NaN/Infinity guards, legacy NULL-budget cap), idempotent re-finalize with
stable clip ids, atomic fail+refund (CAS, done-refusal, legacy marker, window
guard), dispatch claim (first/duplicate/retry/done), roll with hold carry,
cumulative monotonic floor (legacy + v2 ledger, deletion survival), hold
sweeps, migration re-run idempotency, and the full privilege matrix with
live `SET LOCAL ROLE authenticated` denials.

Every test runs inside `SAVEPOINT` and rolls back; the suite never writes
anything outside the in-memory database.

```bash
cd scripts/quota-tests
npm install   # or: npm ci
npm test
```
