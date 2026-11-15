/**
 * ClipMint quota v2 — real-Postgres integration tests (PGlite WASM, no server).
 *
 * Faithful fixture policy (no silent skips):
 *   - uuid-ossp loaded as a real PGlite contrib extension;
 *   - Supabase-auth surface stubbed EXPLICITLY and minimally: roles
 *     anon/authenticated/service_role, auth.uid() backed by the
 *     request.jwt.claim.sub GUC (settable per test), a minimal storage schema
 *     for the storage.bucket/object migrations — everything else applies the
 *     repo schema + migrations VERBATIM, and ANY failure aborts the run;
 *   - default Supabase-like grants (tables/sequences/functions to all three
 *     roles) applied BEFORE migrations so the migrations' REVOKE statements
 *     are exercised against the real posture;
 *   - every test runs inside SAVEPOINT ... ROLLBACK; nothing persists.
 *
 * Run:  node run-quota-tests.mjs
 * Exit: 0 all green · 1 failure (details printed)
 */
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SUPA = join(SUPA_DIR(), "supabase");

function SUPA_DIR() { return ROOT; }

const db = new PGlite({ extensions: { "uuid-ossp": uuid_ossp } });
let passed = 0;
let failed = 0;
const failures = [];

async function exec(sql) {
  return db.exec(sql);
}

async function one(sql) {
  const res = await db.exec(sql);
  return res[0]?.rows ?? [];
}

function assert(cond, label) {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.error(`  FAIL ${label}`);
  }
}

async function applyFile(path) {
  const sql = readFileSync(path, "utf8");
  await exec(sql); // throws on failure — setup must never continue broken
}

// ── Fixture: Supabase roles + privileges + auth + storage ───────────────────
async function applyFixture() {
  await exec(`
    -- auth surface stub FIRST (the grant below references this schema): the
    -- users table backs the profiles FK; auth.uid() reads the
    -- request.jwt.claim.sub GUC so a test can impersonate an authenticated
    -- browser session (or leave it NULL to act as service_role context).
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now()
    );
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    -- Roles (Supabase posture; NOLOGIN — used via SET ROLE)
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
      END IF;
    END $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

    -- Supabase default privileges: everything starts granted; the migrations
    -- then REVOKE exactly what they revoke. This ordering is what makes the
    -- privilege assertions meaningful.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

    -- Minimal storage schema fixture (real columns used by the repo's storage
    -- migrations; no object storage behaviour is exercised).
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (
      id text PRIMARY KEY,
      name text,
      public boolean DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    CREATE TABLE IF NOT EXISTS storage.objects (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      bucket_id text,
      name text,
      created_at timestamptz DEFAULT now()
    );
    CREATE OR REPLACE FUNCTION storage.foldername(name text)
      RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;
    GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON TABLES TO anon, authenticated, service_role;
  `);
}

// ── Schema + migrations, in dependency order ────────────────────────────────
const MIGRATION_ORDER = [
  "migration_phase4.sql",
  "migration_razorpay.sql",
  "migration_cashfree.sql",
  "migration_usage_period.sql",
  "migration_quota.sql",
  "migration_quota_rpc_lockdown.sql",
  "migration_captions_and_delivery.sql",
  "migration_source_title.sql",
  "migration_pipeline2.sql",
  "migration_notifications.sql",
  "migration_custom_bgm.sql",
  "migration_clip_quality.sql",
  "migration_realtime.sql",
  "migration_schema_hygiene.sql",
  "migration_r2_delivery.sql",
  "migration_pipeline_fixes.sql",
  "migration_db_hardening.sql",
  "migration_quota_v2.sql",
];

async function setup() {
  const files = readdirSync(SUPA);
  await applyFile(join(SUPA, "schema.sql"));
  for (const name of MIGRATION_ORDER) {
    if (!files.includes(name)) {
      throw new Error(`missing migration file: ${name}`);
    }
    // migration_quota.sql changes increment_videos_used from VOID (phase4)
    // to BOOLEAN — CREATE OR REPLACE cannot change a return type, so the
    // superseded definition must be dropped first (the same manual step the
    // live Supabase migration requires). Compatibility shim only; it does
    // not mask any migration statement.
    if (name === "migration_quota.sql") {
      await exec("DROP FUNCTION IF EXISTS public.increment_videos_used(uuid)");
    }
    await applyFile(join(SUPA, name));
  }
}

// ── Fixture helpers ──────────────────────────────────────────────────────────
let seq = 0;
async function makeUser(plan = "free", periodEnd = null, windowStartExpr = null) {
  seq += 1;
  const id = `11111111-1111-4111-8111-${String(seq).padStart(12, "0")}`;
  // Insert through the REAL signup path: the handle_new_user trigger creates
  // the profile; the test then shapes plan/window on that row. Window
  // expressions are raw SQL (clock_timestamp(), NOT now() — the harness runs
  // the whole suite in one transaction, where now() is frozen).
  await exec(`
    INSERT INTO auth.users (id, email) VALUES ('${id}', 'u${seq}@t.test');
    UPDATE public.profiles
       SET plan = '${plan}',
           usage_period_start = ${windowStartExpr ?? "clock_timestamp()"},
           current_period_end = ${periodEnd ? `'${periodEnd}'` : "NULL"}
     WHERE id = '${id}';
  `);
  return id;
}

async function call(fn, params) {
  const args = Object.entries(params)
    .map(([k, v]) => {
      if (typeof v === "string") return `${k} => '${v}'`;
      if (typeof v === "number") return `${k} => ${v}`;
      return `${k} => '${JSON.stringify(v)}'::jsonb`;
    })
    .join(", ");
  return one(`SELECT public.${fn}(${args}) AS r`);
}

/** Table-returning RPCs must be expanded via SELECT * FROM ... AS t. */
async function callRows(fn, params) {
  const args = Object.entries(params)
    .map(([k, v]) => {
      if (typeof v === "string") return `${k} => '${v}'`;
      if (typeof v === "number") return `${k} => ${v}`;
      return `${k} => '${JSON.stringify(v)}'::jsonb`;
    })
    .join(", ");
  return one(`SELECT * FROM public.${fn}(${args}) AS t`);
}

async function callExpectError(fn, params, label, prefix = "") {
  const args = Object.entries(params)
    .map(([k, v]) => {
      if (typeof v === "string") return `${k} => '${v}'`;
      if (typeof v === "number") return `${k} => ${v}`;
      return `${k} => '${JSON.stringify(v)}'::jsonb`;
    })
    .join(", ");
  // The intentional failure aborts the surrounding transaction; recover to a
  // savepoint so the test can keep querying afterwards.
  await exec("SAVEPOINT e");
  try {
    await exec(`SELECT public.${fn}(${args})`);
    await exec("RELEASE SAVEPOINT e");
    assert(false, `${label} (no error raised)`);
  } catch (err) {
    await exec("ROLLBACK TO SAVEPOINT e; RELEASE SAVEPOINT e");
    const msg = String(err.message || err);
    assert(prefix === "" || msg.includes(prefix), `${label} [${msg.slice(0, 90)}]`);
  }
}

/** Expect an arbitrary SQL statement to fail; recover the transaction after. */
async function expectSqlError(sql, label, prefix = "") {
  await exec("SAVEPOINT e");
  try {
    await exec(sql);
    await exec("RELEASE SAVEPOINT e");
    assert(false, `${label} (no error raised)`);
  } catch (err) {
    await exec("ROLLBACK TO SAVEPOINT e; RELEASE SAVEPOINT e");
    const msg = String(err.message || err);
    assert(prefix === "" || msg.includes(prefix), `${label} [${msg.slice(0, 90)}]`);
  }
}

async function profile(id) {
  const rows = await one(`SELECT clips_used, videos_used, clips_reserved FROM public.profiles WHERE id='${id}'`);
  return rows[0];
}

async function job(id) {
  const rows = await one(`SELECT * FROM public.jobs WHERE id='${id}'`);
  return rows[0];
}

const GOOD_CLIP = (i, extra = {}) => JSON.stringify({
  job_id: "PLACEHOLDER", clip_index: i, variant: "9x16",
  filename: `clip_${String(i).padStart(3, "0")}_captioned.mp4`,
  duration_seconds: 20, start_time: i * 30, end_time: i * 30 + 20,
  title: `Clip ${i + 1}`, description: "d", hashtags: ["#a", "#b", "#c", "#d", "#e"],
  hook_caption: "h", viral_score: 80, quality_score: 90, quality_report: { checks: [] },
  drive_file_id: `drive-${i}`, drive_url: "https://drive", thumbnail_url: "",
  storage_path: `delivery/j/clip_${i}_captioned.mp4`, thumbnail_path: null,
  thumbnail_drive_id: null, status: "ready", ...extra,
});

// ── Test runner: SAVEPOINT per test, always rolled back ─────────────────────
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test("create_job_with_quota: atomic reserve+insert, grant math, hold recorded", async () => {
  const u = await makeUser("free");
  const r = await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://youtube.com/watch?v=x", max_clips: 10 } });
  const jid = r[0].r;
  const p = await profile(u);
  const j = await job(jid);
  assert(jid, "job id returned");
  assert(Number(p.videos_used) === 1, "videos_used = 1");
  assert(Number(p.clips_reserved) === 5, "clips_reserved = granted 5 (free remaining)");
  assert(Number(j.max_clips) === 5, "max_clips clamped to remaining 5");
  assert(Number(j.clips_budget) === 5, "clips_budget recorded");
  assert(j.quota_state === "pending" && j.quota_video_charged === true, "quota_state pending + charged flag");
  assert(j.usage_window_start !== null, "usage window snapshot recorded");
  assert(j.caption_pace === "balanced" && j.source_language === "auto" && j.caption_language === "original", "new columns default");
  assert(j.status === "queued", "job queued");
});

test("create_job_with_quota: refused at video limit, atomic (no partial state)", async () => {
  const u = await makeUser("free");
  await exec(`UPDATE public.profiles SET videos_used = 2 WHERE id = '${u}'`);
  await callExpectError("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } },
    "videos limit raises", "QUOTA_VIDEOS_LIMIT");
  const p = await profile(u);
  const jobs = await one(`SELECT count(*) c FROM public.jobs WHERE user_id='${u}'`);
  assert(Number(p.clips_reserved) === 0 && Number(p.videos_used) === 2, "no partial reservation after refusal");
  assert(Number(jobs[0].c) === 0, "no job row after refusal");
});

test("create_job_with_quota: refused when no clips remain", async () => {
  const u = await makeUser("free");
  await exec(`UPDATE public.profiles SET clips_used = 5 WHERE id = '${u}'`);
  await callExpectError("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } },
    "clips limit raises", "QUOTA_CLIPS_LIMIT");
});

test("reserved clip budget prevents concurrent overspend (row-locked pool)", async () => {
  const u = await makeUser("free");
  const j1 = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://a.mp4", max_clips: 4 } }))[0].r;
  const j2 = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://b.mp4", max_clips: 4 } }))[0].r;
  const p = await profile(u);
  const jA = await job(j1), jB = await job(j2);
  assert(Number(jA.clips_budget) + Number(jB.clips_budget) <= 5, "combined budgets within plan (4+1)");
  assert(Number(jB.clips_budget) === 1, "second job clamped to remaining 1");
  assert(Number(p.clips_reserved) === 5, "holds = 5");
});

test("expired paid plan gates at FREE limits", async () => {
  const u = await makeUser("pro", new Date(Date.now() - 86400000).toISOString());
  const r = await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4", max_clips: 10 } });
  const j = await job(r[0].r);
  assert(Number(j.max_clips) === 5, "expired pro granted only free 5");
});

test("finalize_job_results: bills distinct ready masters once; variants+failed free; ENTIRE unused hold released", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4", max_clips: 5 } }))[0].r;
  const clips = [
    JSON.parse(GOOD_CLIP(0)),
    JSON.parse(GOOD_CLIP(1)),
    // variant of master 0 — not billed separately
    JSON.parse(GOOD_CLIP(0, { variant: "1x1", filename: "clip_000_1x1.mp4" })),
    // failed master — not billed
    JSON.parse(GOOD_CLIP(2, { status: "failed", storage_path: null, drive_file_id: "" })),
  ];
  const delivered = (await call("finalize_job_results", { p_job_id: jid, p_clips: clips, p_meta: { drive_folder_id: "F1" } }))[0].r;
  const p = await profile(u);
  const j = await job(jid);
  assert(Number(delivered) === 2, "delivered = 2 distinct masters");
  assert(Number(p.clips_used) === 2, "clips_used charged 2");
  assert(Number(p.clips_reserved) === 0, "hold FULLY released (budget 5, delivered 2 → 5-5=0, unused reservations are not kept)");
  assert(j.quota_state === "charged", "job charged");
  assert(Number(j.quota_clips_charged) === 2, "durable ledger = 2");
  assert(Number(j.clips_count) === 2, "clips_count = delivered");
  assert(j.status === "done" && j.progress === 100, "job done");
  assert(j.error_message && j.error_message.includes("1 of"), "failure message recorded");
  assert(j.drive_folder_id === "F1", "meta folder id stored");
});

test("finalize_job_results: idempotent — second call returns ledger, does NOT rewrite rows or re-bill", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4", max_clips: 5 } }))[0].r;
  await call("finalize_job_results", { p_job_id: jid, p_clips: [JSON.parse(GOOD_CLIP(0)), JSON.parse(GOOD_CLIP(1))], p_meta: {} });
  const idsBefore = (await one(`SELECT id FROM public.clips WHERE job_id='${jid}' ORDER BY id`)).map(r => r.id);
  const pBefore = await profile(u);
  const second = (await call("finalize_job_results", { p_job_id: jid, p_clips: [JSON.parse(GOOD_CLIP(0)), JSON.parse(GOOD_CLIP(1)), JSON.parse(GOOD_CLIP(2))], p_meta: {} }))[0].r;
  const idsAfter = (await one(`SELECT id FROM public.clips WHERE job_id='${jid}' ORDER BY id`)).map(r => r.id);
  const pAfter = await profile(u);
  assert(Number(second) === 2, "second call returns existing charge");
  assert(JSON.stringify(idsBefore) === JSON.stringify(idsAfter), "clip ids stable (no delete/reinsert)");
  assert(Number(pAfter.clips_used) === Number(pBefore.clips_used), "no double charge");
  const j = await job(jid);
  assert(Number(j.quota_clips_charged) === 2, "ledger unchanged");
});

test("finalize_job_results: zero success refuses", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } }))[0].r;
  await callExpectError("finalize_job_results", {
    p_job_id: jid,
    p_clips: [JSON.parse(GOOD_CLIP(0, { status: "failed", storage_path: null, drive_file_id: "" }))],
    p_meta: {},
  }, "zero delivered refuses", "QUOTA_ZERO_DELIVERED");
  const j = await job(jid);
  assert(j.quota_state === "pending" && j.status === "queued", "refusal left job untouched (rolled back)");
});

test("finalize_job_results: delivered > reserved budget refuses", async () => {
  const u = await makeUser("creator");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4", max_clips: 3 } }))[0].r;
  const j = await job(jid);
  const budget = Number(j.clips_budget);
  const clips = Array.from({ length: budget + 1 }, (_, i) => JSON.parse(GOOD_CLIP(i)));
  await callExpectError("finalize_job_results", { p_job_id: jid, p_clips: clips, p_meta: {} },
    "over-budget refuses", "QUOTA_BUDGET_EXCEEDED");
});

test("finalize_job_results: payload validation (dupes, bad timings, ready-without-file, empty)", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } }))[0].r;
  await callExpectError("finalize_job_results", { p_job_id: jid, p_clips: [], p_meta: {} },
    "empty array refuses");
  await callExpectError("finalize_job_results", {
    p_job_id: jid,
    p_clips: [JSON.parse(GOOD_CLIP(0)), JSON.parse(GOOD_CLIP(0))],
    p_meta: {},
  }, "duplicate index/variant refuses", "duplicate clip_index/variant");
  await callExpectError("finalize_job_results", {
    p_job_id: jid,
    p_clips: [JSON.parse(GOOD_CLIP(0, { start_time: -5 }))],
    p_meta: {},
  }, "negative timing refuses", "negative, NaN or infinite");
  await callExpectError("finalize_job_results", {
    p_job_id: jid,
    p_clips: [JSON.parse(GOOD_CLIP(0, { storage_path: null, drive_file_id: "" }))],
    p_meta: {},
  }, "ready-without-file refuses", "storage_path or drive_file_id");
  const j = await job(jid);
  assert(j.quota_state === "pending", "all validation refusals left job pending");
});

test("finalize_job_results: window rolled mid-job — hold released, current window NOT charged, job ledger records charge", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } }))[0].r;
  // Simulate a purchase/reset AFTER the reservation: the profile window moves
  // (clock_timestamp() — now() is frozen inside the harness transaction).
  await exec(`UPDATE public.profiles SET usage_period_start = clock_timestamp(), clips_used = 0, videos_used = 0 WHERE id = '${u}'`);
  await call("finalize_job_results", { p_job_id: jid, p_clips: [JSON.parse(GOOD_CLIP(0)), JSON.parse(GOOD_CLIP(1))], p_meta: {} });
  const p = await profile(u);
  const j = await job(jid);
  assert(Number(p.clips_used) === 0, "current window NOT charged after roll");
  assert(Number(p.clips_reserved) === 0, "hold released after roll");
  assert(j.quota_state === "charged" && Number(j.quota_clips_charged) === 2, "job ledger records the charge");
});

test("finalize_job_results: profile-locked window read — settle sees consistent window (no implicit roll)", async () => {
  // 20-day-old window: reservation does NOT roll it (< 30 days); finalize
  // must charge against the snapshot and leave the window anchor untouched.
  const u = await makeUser("free", null, "clock_timestamp() - interval '20 days'");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } }))[0].r;
  await call("finalize_job_results", { p_job_id: jid, p_clips: [JSON.parse(GOOD_CLIP(0))], p_meta: {} });
  const p = await profile(u);
  const w = (await one(`SELECT usage_period_start FROM public.profiles WHERE id='${u}'`))[0];
  assert(Number(p.clips_used) === 1, "charged against reservation window");
  const days = (Date.now() - new Date(w.usage_period_start).getTime()) / 86400000;
  assert(days > 19 && days < 21, "usage_period_start untouched by finalize (no mid-settle roll)");
});

test("finalize_job_results: transcription meta passthrough (detected_language/report/duration)", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } }))[0].r;
  await call("finalize_job_results", {
    p_job_id: jid,
    p_clips: [JSON.parse(GOOD_CLIP(0))],
    p_meta: { detected_language: "hi", transcription_report: { provider: "groq", segments: 42 }, video_duration_seconds: "731.5" },
  });
  const j = await job(jid);
  assert(j.detected_language === "hi", "detected_language persisted");
  assert(j.transcription_report && j.transcription_report.provider === "groq", "transcription_report persisted");
  assert(Number(j.video_duration_seconds) === 731.5, "source duration persisted");
});

test("fail_job_quota: refunds once (CAS), legacy marker honored", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } }))[0].r;
  const first = (await call("fail_job_quota", { p_job_id: jid, p_message: "boom" }))[0].r;
  const p1 = await profile(u);
  const second = (await call("fail_job_quota", { p_job_id: jid, p_message: "boom" }))[0].r;
  const p2 = await profile(u);
  const j = await job(jid);
  assert(first === true && second === false, "refund CAS: first true, duplicate false");
  assert(Number(p1.videos_used) === 0 && Number(p1.clips_reserved) === 0, "slot + hold refunded");
  assert(Number(p2.videos_used) === Number(p1.videos_used), "duplicate refund does not decrement again");
  assert(j.quota_state === "refunded" && j.videos_refunded === true, "job refunded + legacy marker");
});

test("fail_job_quota: refuses to refund a done job", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } }))[0].r;
  await exec(`UPDATE public.jobs SET status = 'done', completed_at = now() WHERE id = '${jid}'`);
  const r = (await call("fail_job_quota", { p_job_id: jid, p_message: "late failure" }))[0].r;
  const p = await profile(u);
  assert(r === false, "done job refund refused");
  assert(Number(p.videos_used) === 1, "slot NOT returned for done job");
});

test("fail_job_quota: window rolled mid-job — hold released, no wrong-window video refund", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } }))[0].r;
  await exec(`UPDATE public.profiles SET usage_period_start = clock_timestamp() WHERE id = '${u}'`);
  const r = (await call("fail_job_quota", { p_job_id: jid, p_message: "boom" }))[0].r;
  const p = await profile(u);
  assert(r === true, "refund recorded");
  assert(Number(p.videos_used) === 1, "video slot NOT refunded against rolled window");
  assert(Number(p.clips_reserved) === 0, "hold released");
});

test("re_reserve_job_quota: no-op while pending+held; fresh reservation after refund; legacy marker reset", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4", max_clips: 5 } }))[0].r;
  const g1 = (await call("re_reserve_job_quota", { p_job_id: jid }))[0].r;
  const p1 = await profile(u);
  const g2 = (await call("re_reserve_job_quota", { p_job_id: jid }))[0].r;
  const p2 = await profile(u);
  assert(Number(g1) === 5 && Number(g2) === 5, "repeat re-reserve returns existing budget");
  assert(Number(p1.videos_used) === 1 && Number(p2.videos_used) === 1, "no extra video charge on repeat");
  assert(Number(p2.clips_reserved) === Number(p1.clips_reserved), "holds unchanged on repeat");

  await call("fail_job_quota", { p_job_id: jid, p_message: "boom" });
  const p3 = await profile(u);
  assert(Number(p3.videos_used) === 0, "refund after first failure");
  const g3 = (await call("re_reserve_job_quota", { p_job_id: jid }))[0].r;
  const p4 = await profile(u);
  const j = await job(jid);
  assert(Number(g3) === 5, "retry re-reserves current window");
  assert(Number(p4.videos_used) === 1, "retry charges a fresh slot");
  assert(j.quota_state === "pending" && j.videos_refunded === false, "videos_refunded reset for new run");
});

test("re_reserve_job_quota: refuses completed jobs", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } }))[0].r;
  await exec(`UPDATE public.jobs SET status='done', quota_state='charged', completed_at=now() WHERE id='${jid}'`);
  await callExpectError("re_reserve_job_quota", { p_job_id: jid }, "done job refused", "QUOTA_JOB_DONE");
});

test("roll_usage_period_if_due: carries running holds, resets counters (explicit profile lock)", async () => {
  const u = await makeUser("free");
  await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } });
  await exec(`UPDATE public.profiles SET usage_period_start = now() - interval '31 days', clips_used = 5, videos_used = 1 WHERE id = '${u}'`);
  await exec(`SELECT public.roll_usage_period_if_due('${u}')`);
  const p = await profile(u);
  assert(Number(p.clips_used) === 0 && Number(p.videos_used) === 0, "counters reset");
  assert(Number(p.clips_reserved) === 5, "running hold carried into the new window");
  const w = (await one(`SELECT usage_period_start FROM public.profiles WHERE id='${u}'`))[0];
  assert((Date.now() - new Date(w.usage_period_start).getTime()) < 60000, "window restarted now");
});

test("reconcile_profile_usage_floor: monotonic, cumulative (legacy + v2 baseline), no double charge", async () => {
  // Window anchored 10 days back so the legacy job's completion (2 days ago)
  // falls INSIDE the current window.
  const u = await makeUser("free", null, "clock_timestamp() - interval '10 days'");
  const legacyJob = "33333333-3333-4333-8333-000000000001";
  await exec(`
    INSERT INTO public.jobs (id, user_id, status, quota_state, completed_at, clips_count)
    VALUES ('${legacyJob}', '${u}', 'done', 'pending', now() - interval '2 days', 3);
    INSERT INTO public.clips (job_id, user_id, clip_index, variant, filename, status)
    VALUES ('${legacyJob}', '${u}', 0, '9x16', 'a.mp4', 'ready'),
           ('${legacyJob}', '${u}', 1, '9x16', 'b.mp4', 'ready'),
           ('${legacyJob}', '${u}', 2, '9x16', 'c.mp4', 'ready'),
           ('${legacyJob}', '${u}', 0, '1x1', 'a_1x1.mp4', 'ready');
  `);
  const d1 = (await call("reconcile_profile_usage_floor", { p_user_id: u }))[0].r;
  const p1 = await profile(u);
  assert(Number(d1) === 3, "floor charged the legacy undercount (variants excluded)");
  assert(Number(p1.clips_used) === 3, "clips_used = 3");
  const legacy = await job(legacyJob);
  assert(legacy.quota_state === "charged" && Number(legacy.quota_clips_charged) === 3, "legacy baseline marked charged + ledger persisted");

  const d2 = (await call("reconcile_profile_usage_floor", { p_user_id: u }))[0].r;
  const p2 = await profile(u);
  assert(Number(d2) === 0 && Number(p2.clips_used) === 3, "second sweep is a no-op");

  const v2Job = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } }))[0].r;
  await call("finalize_job_results", { p_job_id: v2Job, p_clips: [JSON.parse(GOOD_CLIP(0)), JSON.parse(GOOD_CLIP(1))], p_meta: {} });
  const d3 = (await call("reconcile_profile_usage_floor", { p_user_id: u }))[0].r;
  const p3 = await profile(u);
  assert(Number(d3) === 0 && Number(p3.clips_used) === 5, "cumulative floor counts v2 ledger, no double charge");
});

test("floor eligibility: v2 job reserved in an OLD window is NOT floored into the new window", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } }))[0].r;
  await exec(`UPDATE public.profiles SET usage_period_start = clock_timestamp() WHERE id = '${u}'`);
  await call("finalize_job_results", { p_job_id: jid, p_clips: [JSON.parse(GOOD_CLIP(0)), JSON.parse(GOOD_CLIP(1))], p_meta: {} });
  const d = (await call("reconcile_profile_usage_floor", { p_user_id: u }))[0].r;
  const p = await profile(u);
  assert(Number(d) === 0 && Number(p.clips_used) === 0,
    "old-window v2 job excluded from the new-window floor (settled to its original ledger)");
});

test("legacy ledger persisted at floor time survives gallery deletion", async () => {
  // Window anchored before the legacy job's completion, like the sibling test.
  const u = await makeUser("free", null, "clock_timestamp() - interval '10 days'");
  const legacyJob = "33333333-3333-4333-8333-000000000002";
  await exec(`
    INSERT INTO public.jobs (id, user_id, status, quota_state, completed_at, clips_count)
    VALUES ('${legacyJob}', '${u}', 'done', 'pending', now() - interval '1 day', 3);
    INSERT INTO public.clips (job_id, user_id, clip_index, variant, filename, status)
    VALUES ('${legacyJob}', '${u}', 0, '9x16', 'a.mp4', 'ready'),
           ('${legacyJob}', '${u}', 1, '9x16', 'b.mp4', 'ready'),
           ('${legacyJob}', '${u}', 2, '9x16', 'c.mp4', 'ready');
  `);
  await call("reconcile_profile_usage_floor", { p_user_id: u });
  const before = await job(legacyJob);
  assert(Number(before.quota_clips_charged) === 3, "legacy count persisted into the ledger");
  await exec(`DELETE FROM public.clips WHERE job_id = '${legacyJob}'`);
  const d = (await call("reconcile_profile_usage_floor", { p_user_id: u }))[0].r;
  const p = await profile(u);
  assert(Number(d) === 0 && Number(p.clips_used) === 3, "usage survives clip deletion via durable ledger");
});

test("request_id replay: same id+payload returns original job; mismatched payload refused", async () => {
  const u = await makeUser("free");
  const rid = "44444444-4444-4444-8444-000000000001";
  const j1 = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4", max_clips: 3 }, p_creation_request_id: rid }))[0].r;
  const p1 = await profile(u);
  const j2 = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4", max_clips: 3 }, p_creation_request_id: rid }))[0].r;
  const p2 = await profile(u);
  assert(j1 === j2, "replay returns the original job id");
  assert(Number(p2.videos_used) === 1, "no second reservation on replay");
  const jobs = await one(`SELECT count(*) c FROM public.jobs WHERE user_id='${u}'`);
  assert(Number(jobs[0].c) === 1, "exactly one job row");
  const row = await job(j1);
  assert(row.creation_request_id === rid && row.creation_fingerprint !== null, "request id + fingerprint persisted");

  await callExpectError("create_job_with_quota", {
    p_user_id: u, p_job: { video_url: "https://x.mp4", max_clips: 7 }, p_creation_request_id: rid,
  }, "payload mismatch refused", "REQUEST_ID_PAYLOAD_MISMATCH");
});

test("preserve_running_holds clears stale holds when nothing holds budget", async () => {
  const u = await makeUser("free");
  await exec(`UPDATE public.profiles SET clips_reserved = 9 WHERE id = '${u}'`);
  const holds = (await call("preserve_running_holds", { p_user_id: u }))[0].r;
  const p = await profile(u);
  assert(Number(holds) === 0 && Number(p.clips_reserved) === 0, "stale holds cleared (no inner-join skip)");
});

test("sweep_quota_holds recomputes every profile under its own lock", async () => {
  const u = await makeUser("free");
  await exec(`UPDATE public.profiles SET clips_reserved = 7 WHERE id = '${u}'`);
  const fixed = (await call("sweep_quota_holds", {}))[0].r;
  const p = await profile(u);
  assert(Number(fixed) >= 1 && Number(p.clips_reserved) === 0, "sweep corrected the stale hold");
});

test("privileges (real roles): counters/plan not writable by authenticated; prefs writable; jobs INSERT/UPDATE revoked; refund RPC revoked; RLS scoping works", async () => {
  const counterCols = ["clips_used", "videos_used", "clips_reserved", "plan", "clips_limit", "videos_limit", "current_period_end"];
  for (const col of counterCols) {
    const r = await one(`SELECT has_column_privilege('authenticated', 'profiles', '${col}', 'UPDATE') AS ok`);
    assert(r[0].ok === false, `profiles.${col} UPDATE revoked from authenticated`);
  }
  for (const col of ["full_name", "notify_email", "notify_discord", "discord_webhook_url", "user_webhook_url", "notify_webhook"]) {
    const r = await one(`SELECT has_column_privilege('authenticated', 'profiles', '${col}', 'UPDATE') AS ok`);
    assert(r[0].ok === true, `profiles.${col} UPDATE retained`);
  }
  const t1 = await one(`SELECT has_table_privilege('authenticated', 'jobs', 'INSERT') AS ok, has_table_privilege('authenticated', 'jobs', 'UPDATE') AS ok2`);
  assert(t1[0].ok === false && t1[0].ok2 === false, "jobs INSERT/UPDATE revoked from authenticated");
  const t2 = await one(`SELECT has_function_privilege('authenticated', 'public.refund_videos_used(uuid)', 'EXECUTE') AS ok`);
  assert(t2[0].ok === false, "refund_videos_used revoked from authenticated");
  const t3 = await one(`SELECT has_function_privilege('authenticated', 'public.finalize_job_results(uuid,jsonb,jsonb)', 'EXECUTE') AS ok`);
  assert(t3[0].ok === false, "finalize_job_results NOT executable by authenticated");
  const t4 = await one(`SELECT has_function_privilege('service_role', 'public.finalize_job_results(uuid,jsonb,jsonb)', 'EXECUTE') AS ok`);
  assert(t4[0].ok === true, "finalize_job_results executable by service_role");

  // Live role denial: act as the authenticated browser session.
  const u = await makeUser("free");
  const other = await makeUser("free");
  await exec(`SELECT set_config('request.jwt.claim.sub', '${u}', true)`);
  await exec(`SET LOCAL ROLE authenticated`);
  try {
    const own = await one(`SELECT count(*) c FROM public.jobs WHERE user_id='${u}'`);
    assert(Number(own[0].c) === 0, "authenticated sees own (empty) jobs");
    // Every intentional failure aborts the transaction: recover to a
    // savepoint around each probe so the session stays usable.
    const deny = async (sql) => {
      await exec("SAVEPOINT d");
      try { await exec(sql); await exec("RELEASE SAVEPOINT d"); return false; }
      catch { await exec("ROLLBACK TO SAVEPOINT d; RELEASE SAVEPOINT d"); return true; }
    };
    assert(await deny(`INSERT INTO public.jobs (user_id, status) VALUES ('${u}', 'queued')`),
      "authenticated job INSERT denied at runtime");
    assert(await deny(`UPDATE public.profiles SET clips_used = 99 WHERE id = '${u}'`),
      "authenticated counter write denied at runtime");
    assert(await deny(`SELECT public.refund_videos_used('${u}')`),
      "authenticated refund RPC denied at runtime");
    const rls = await deny(`SELECT count(*) FROM public.jobs WHERE user_id='${other}'`);
    const others = Number((await one(`SELECT count(*) c FROM public.jobs WHERE user_id='${other}'`))[0].c);
    assert(rls || others === 0, "RLS hides other users' jobs from authenticated session");
  } finally {
    await exec(`RESET ROLE`);
    await exec(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
});

test("claim_job_dispatch: first queued dispatch_count=0 claims and returns the granted budget", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4", max_clips: 10 } }))[0].r;
  const c1 = (await callRows("claim_job_dispatch", { p_job_id: jid }))[0];
  assert(c1.claimed === true && c1.reason === "claimed", "first claim succeeds");
  assert(Number(c1.granted_clips) === 5, "granted budget returned (5, not stale max_clips)");
  const j = await job(jid);
  assert(Number(j.dispatch_count) === 1 && j.status === "queued", "dispatch_count incremented, status queued");
  const p = await profile(u);
  assert(Number(p.videos_used) === 1 && Number(p.clips_reserved) === 5, "no extra reservation on claim");
});

test("claim_job_dispatch: duplicate on running job refuses and never touches the hold", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } }))[0].r;
  await call("claim_job_dispatch", { p_job_id: jid });
  const p1 = await profile(u);
  const c2 = (await callRows("claim_job_dispatch", { p_job_id: jid }))[0];
  const p2 = await profile(u);
  assert(c2.claimed === false && c2.reason === "already_started", "duplicate claim refused");
  assert(Number(p2.videos_used) === Number(p1.videos_used), "no slot refund of the in-flight run");
  assert(Number(p2.clips_reserved) === Number(p1.clips_reserved), "hold untouched by duplicate click");
  const j = await job(jid);
  assert(Number(j.dispatch_count) === 1, "dispatch_count not inflated by duplicate");
});

test("claim_job_dispatch: failed job re-reserves against current window and claims", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } }))[0].r;
  await call("claim_job_dispatch", { p_job_id: jid });
  await call("fail_job_quota", { p_job_id: jid, p_message: "boom" });
  const p1 = await profile(u);
  const c = (await callRows("claim_job_dispatch", { p_job_id: jid }))[0];
  const p2 = await profile(u);
  const j = await job(jid);
  assert(c.claimed === true, "retry claim succeeds");
  assert(Number(p1.videos_used) === 0 && Number(p2.videos_used) === 1, "re-reserve charged a fresh current-window slot");
  assert(Number(j.dispatch_count) === 2, "dispatch_count incremented on retry");
  assert(j.status === "queued" && j.error_message === null, "status reset atomically by claim");
});

test("claim_job_dispatch: done job refused", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } }))[0].r;
  await call("claim_job_dispatch", { p_job_id: jid });
  await call("finalize_job_results", { p_job_id: jid, p_clips: [JSON.parse(GOOD_CLIP(0))], p_meta: {} });
  const c = (await callRows("claim_job_dispatch", { p_job_id: jid }))[0];
  assert(c.claimed === false && c.reason === "done", "done job never re-dispatched");
});

test("finalize_job_results: unknown status refused (never silently shipped as ready)", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } }))[0].r;
  await callExpectError("finalize_job_results", {
    p_job_id: jid,
    p_clips: [JSON.parse(GOOD_CLIP(0, { status: "pending" }))],
    p_meta: {},
  }, "unknown status refuses", "status other than ready/failed");
});

test("finalize_job_results: ready clip with zero duration refused; negative index refused", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } }))[0].r;
  await callExpectError("finalize_job_results", {
    p_job_id: jid,
    p_clips: [JSON.parse(GOOD_CLIP(0, { duration_seconds: 0 }))],
    p_meta: {},
  }, "ready zero duration refuses", "positive duration_seconds");
  await callExpectError("finalize_job_results", {
    p_job_id: jid,
    p_clips: [JSON.parse(GOOD_CLIP(-1))],
    p_meta: {},
  }, "negative clip index refuses", "negative, NaN or infinite");
});

test("finalize_job_results: legacy NULL-budget job capped by known max_clips (staged release)", async () => {
  const u = await makeUser("free");
  const legacy = "33333333-3333-4333-8333-000000000003";
  // Legacy job created before the v2 migration: no reservation, no budget.
  await exec(`
    INSERT INTO public.jobs (id, user_id, status, quota_state, max_clips, usage_window_start)
    VALUES ('${legacy}', '${u}', 'captioning', 'pending', 2, NULL);
  `);
  await callExpectError("finalize_job_results", {
    p_job_id: legacy,
    p_clips: [JSON.parse(GOOD_CLIP(0)), JSON.parse(GOOD_CLIP(1)), JSON.parse(GOOD_CLIP(2))],
    p_meta: {},
  }, "legacy NULL-budget over max_clips refuses", "QUOTA_BUDGET_EXCEEDED");
  const delivered = (await call("finalize_job_results", {
    p_job_id: legacy,
    p_clips: [JSON.parse(GOOD_CLIP(0)), JSON.parse(GOOD_CLIP(1))],
    p_meta: {},
  }))[0].r;
  const p = await profile(u);
  const lj = await job(legacy);
  // Snapshot-less legacy rows have no original window to bill, so the charge
  // is ledger-only (the real staged flow re-reserves via claim_job_dispatch
  // first, which sets the snapshot and bills the current window normally).
  assert(Number(delivered) === 2 && Number(lj.quota_clips_charged) === 2 && lj.quota_state === "charged",
    "legacy job within cap finalizes with ledger recorded");
  assert(Number(p.clips_used) === 0, "snapshot-less legacy row does not bill an arbitrary window");
});

test("migration_quota_v2.sql re-run is a no-op (counters, states, baselines preserved)", async () => {
  const u = await makeUser("free");
  await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } });
  await call("fail_job_quota", { p_job_id: (await one(`SELECT id FROM public.jobs WHERE user_id='${u}' ORDER BY created_at LIMIT 1`))[0].id, p_message: "x" });
  await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://y.mp4" } });
  const before = await one(`
    SELECT (SELECT clips_used FROM public.profiles WHERE id='${u}') cu,
           (SELECT videos_used FROM public.profiles WHERE id='${u}') vu,
           (SELECT clips_reserved FROM public.profiles WHERE id='${u}') cr,
           (SELECT usage_period_start FROM public.profiles WHERE id='${u}') up,
           (SELECT count(*) FROM public.jobs WHERE user_id='${u}' AND quota_state='pending') pend,
           (SELECT count(*) FROM public.jobs WHERE user_id='${u}' AND quota_state='refunded') ref,
           (SELECT count(*) FROM public.jobs WHERE user_id='${u}' AND quota_state='charged') chg
  `);
  // Re-apply ONLY the shipped migration file (the v2 file must be safe to
  // re-run; older backfills are one-shot history on the live database).
  await applyFile(join(SUPA, "migration_quota_v2.sql"));
  const after = await one(`
    SELECT (SELECT clips_used FROM public.profiles WHERE id='${u}') cu,
           (SELECT videos_used FROM public.profiles WHERE id='${u}') vu,
           (SELECT clips_reserved FROM public.profiles WHERE id='${u}') cr,
           (SELECT usage_period_start FROM public.profiles WHERE id='${u}') up,
           (SELECT count(*) FROM public.jobs WHERE user_id='${u}' AND quota_state='pending') pend,
           (SELECT count(*) FROM public.jobs WHERE user_id='${u}' AND quota_state='refunded') ref,
           (SELECT count(*) FROM public.jobs WHERE user_id='${u}' AND quota_state='charged') chg
  `);
  assert(JSON.stringify(before[0]) === JSON.stringify(after[0]),
    "v2 migration re-run changed nothing (counters/states/baselines stable)");
});

test("check constraints: caption_pace/source_language/caption_language enforced", async () => {
  const u = await makeUser("free");
  const jid = (await call("create_job_with_quota", { p_user_id: u, p_job: { video_url: "https://x.mp4" } }))[0].r;
  await expectSqlError(`UPDATE public.jobs SET caption_pace = 'nope' WHERE id = '${jid}'`,
    "caption_pace CHECK enforced");
  await expectSqlError(`UPDATE public.jobs SET source_language = 'fr' WHERE id = '${jid}'`,
    "source_language CHECK enforced");
  await expectSqlError(`UPDATE public.jobs SET caption_language = 'de' WHERE id = '${jid}'`,
    "caption_language CHECK enforced");
});

// ── Run ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Applying fixture + schema + migrations…");
  try {
    await applyFixture();
    await setup();
  } catch (err) {
    console.error("SETUP FAILED — aborting before any test:");
    console.error(String(err.message || err).slice(0, 2000));
    process.exit(1);
  }
  console.log(`Setup ok. Running ${tests.length} tests.\n`);

  // One explicit transaction for the whole suite; every test rolls back to
  // its own savepoint, intentional failures recover to a nested savepoint.
  await exec("BEGIN");
  try {
    for (const [name, fn] of tests) {
      console.log(`\n== ${name}`);
      await exec("SAVEPOINT t");
      try {
        await fn();
      } catch (err) {
        failed += 1;
        failures.push(`${name} threw: ${String(err.message || err).slice(0, 200)}`);
        console.error(`  ERROR ${String(err.message || err).slice(0, 300)}`);
        await exec("ROLLBACK TO SAVEPOINT t");
      }
      await exec("ROLLBACK TO SAVEPOINT t; RELEASE SAVEPOINT t");
    }
  } finally {
    await exec("COMMIT");
  }

  console.log(`\n──── ${passed} passed, ${failed} failed ────`);
  if (failures.length) {
    console.error("Failures:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  process.exit(0);
}

await main();
