// Offline regression tests for the API gateway's create-job flow
// (api-gateway/src/index.ts) — the REAL source is transpiled with the
// dashboard's existing `typescript` dependency (no new dependencies) and its
// private handlers are injected via an appended-exports harness, so no source
// file is modified.
//
// Contract under test (atomic-dispatch parity with /api/trigger-pipeline):
//   1. NO raw stored-limit precheck — roll/expiry/quota authority is the SQL
//      (create_job_with_quota / claim_job_dispatch); a stale/expired profile
//      row must never produce a local 429.
//   2. create RPC receives the client's STABLE request_id (idempotent replay).
//   3. claim_job_dispatch is MANDATORY before dispatch and the workflow gets
//      the SQL-GRANTED clip budget, never the requested max_clips.
//   4. A replay whose claim returns claimed=false must NOT trigger a second
//      GitHub dispatch.
//   5. A network error during dispatch RETAINS the hold: no fail_job_quota
//      refund (acceptance unknown — reconcile cron owns it).
//   6. Invalid language selectors → 400 with ZERO RPC calls.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

// ── Transpile + private-handle injection (no source modify) ─────────────────
const source = readFileSync(new URL("../../api-gateway/src/index.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
// Append an exports handle so the harness can call the private handlers
// directly (the worker only exports a default fetch handler).
const withHandles = compiled + "\nmodule.exports.__handles = { handleCreateJob, createJobWithQuota, route };";
const module_ = { exports: {} };
new Function("module", "exports", withHandles)(module_, module_.exports);
const { handleCreateJob } = module_.exports.__handles;

// ── Fixtures ────────────────────────────────────────────────────────────────
const JOB_ID_1 = "33333333-3333-4333-8333-333333333331";
const JOB_ID_2 = "33333333-3333-4333-8333-333333333332";
const REQUEST_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const env = () => ({
    SUPABASE_URL: "https://sup.example",
    SUPABASE_SERVICE_KEY: "svc-key",
    GITHUB_TOKEN: "gh-tok",
    GITHUB_REPO: "acme/clipmint",
    RATE_LIMIT_PER_MINUTE: "30",
    CACHE: { get: async () => null, put: async () => {} },
});

// Profile row as the gateway currently loads it (stored limits may be stale
// or from an expired plan — the SQL is the only authority).
const staleProfile = () => ({
    id: "11111111-1111-4111-8111-111111111111",
    plan: "creator", videos_used: 999, videos_limit: 2,
    clips_used: 999, clips_limit: 2,
});

const createBody = () => ({
    video_url: "https://youtube.com/watch?v=abc",
    request_id: REQUEST_ID,
    max_clips: 10,
    caption_style: "hormozi",
    caption_pace: "fast",
    source_language: "hi",
    caption_language: "original",
});

// ── Fetch router mock ───────────────────────────────────────────────────────
const fetchLog = [];
const rpcCalls = [];
const ghCalls = [];

function installFetch({ createResponses, claimResponses, gh, failQuotaOk = true } = {}) {
    let createN = 0;
    let claimN = 0;
    globalThis.fetch = async (url, init) => {
        const urlText = String(url);
        let body = null;
        try { body = init?.body ? JSON.parse(init.body) : null; } catch { body = init?.body ?? null; }

        if (urlText.includes("/rpc/create_job_with_quota")) {
            rpcCalls.push({ name: "create_job_with_quota", params: body });
            const respond = createResponses?.[Math.min(createN, (createResponses?.length ?? 1) - 1)] ?? { ok: true, data: JOB_ID_1 };
            createN += 1;
            // `raw` lets a mock answer with PostgREST's real error envelope
            // (HTTP != 2xx, body {"message": "..."}), which callRpc parses.
            const text = respond.raw ?? JSON.stringify(respond.data ?? respond);
            return new Response(text, {
                status: respond.status ?? 200,
                headers: { "content-type": "application/json" },
            });
        }
        if (urlText.includes("/rpc/claim_job_dispatch")) {
            rpcCalls.push({ name: "claim_job_dispatch", params: body });
            const respond = claimResponses?.[Math.min(claimN, (claimResponses?.length ?? 1) - 1)] ?? { claimed: true, reason: "claimed", granted_clips: 5 };
            claimN += 1;
            return new Response(JSON.stringify(respond), {
                status: 200, headers: { "content-type": "application/json" },
            });
        }
        if (urlText.includes("/rpc/fail_job_quota")) {
            rpcCalls.push({ name: "fail_job_quota", params: body });
            return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
        }
        if (urlText.includes("github.com") && urlText.includes("/dispatches")) {
            ghCalls.push({ url: urlText, body });
            if (typeof gh === "function") return gh(body);
            return gh ?? new Response(null, { status: 204 });
        }
        throw new Error(`unexpected fetch: ${urlText}`);
    };
}

const resetHarness = (opts = {}) => {
    fetchLog.length = 0;
    rpcCalls.length = 0;
    ghCalls.length = 0;
    installFetch(opts);
};

const post = async (body) => {
    const res = await handleCreateJob(
        { json: async () => body },
        staleProfile(),
        env(),
    );
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, json };
};

const failQuotaCalls = () => rpcCalls.filter((c) => c.name === "fail_job_quota");
const createCalls = () => rpcCalls.filter((c) => c.name === "create_job_with_quota");
const claimCalls = () => rpcCalls.filter((c) => c.name === "claim_job_dispatch");

// ── Tests ───────────────────────────────────────────────────────────────────
test("gateway: no raw stored-limit precheck — stale/expired profile proceeds, SQL authority decides", async () => {
    resetHarness({
        // SQL refuses with a quota error despite any stored row state.
        createResponses: [{ data: "QUOTA_VIDEOS_LIMIT: You've used your 2 videos for this period. Please upgrade.", status: 400 }],
    });
    // The profile row says nothing is available; the route must still defer to
    // the SQL instead of locally 429-ing on stored counters.
    const res = await post(createBody());
    assert.notEqual(res.status, 429, "stored-limit precheck must not decide quota");
    assert.equal(createCalls().length, 1, "RPC must be the quota authority");
    assert.equal(ghCalls.length, 0);
});

test("gateway: create RPC carries the client's stable request_id for idempotent replay", async () => {
    resetHarness();
    const res = await post(createBody());
    assert.equal(res.status, 201);
    const params = createCalls()[0].params;
    assert.equal(params.p_creation_request_id, REQUEST_ID);
    assert.equal(params.p_user_id, staleProfile().id);
});

test("gateway: claim_job_dispatch is mandatory and dispatches the GRANTED budget, not requested max_clips", async () => {
    resetHarness({
        claimResponses: [{ claimed: true, reason: "claimed", granted_clips: 3 }],
    });
    const res = await post(createBody());   // body.max_clips = 10, SQL grants 3
    assert.equal(res.status, 201);
    assert.equal(claimCalls().length, 1, "claim must happen before dispatch");
    assert.equal(claimCalls()[0].params.p_job_id, JOB_ID_1);
    assert.equal(ghCalls.length, 1);
    assert.equal(ghCalls[0].body.inputs.max_clips, "3");
    assert.equal(ghCalls[0].body.inputs.max_clips !== "10", true);
});

test("gateway: replay with claimed=false never triggers a second GitHub dispatch", async () => {
    resetHarness({
        // Same request_id → the SQL replays the ORIGINAL job id both times.
        createResponses: [{ data: JOB_ID_1 }, { data: JOB_ID_1 }],
        claimResponses: [
            { claimed: true, reason: "claimed", granted_clips: 5 },
            { claimed: false, reason: "already_claimed", granted_clips: 0 },
        ],
    });
    const first = await post(createBody());
    assert.equal(first.status, 201);
    assert.equal(ghCalls.length, 1);
    const second = await post(createBody());   // same request_id
    // Replay returns the existing job (200, replayed flag) — never a second
    // dispatch and never a refund of the live hold.
    assert.equal(second.status, 200);
    assert.equal(second.json.id, JOB_ID_1);
    assert.equal(second.json.replayed, true);
    assert.equal(ghCalls.length, 1);
    assert.equal(failQuotaCalls().length, 0);
});

test("gateway: network error during dispatch retains the hold (no fail_job_quota refund)", async () => {
    resetHarness({
        gh: () => { throw new Error("ECONNRESET"); },
    });
    const res = await post(createBody());
    // Acceptance is UNKNOWN: the job stays queued/claimed (502, reconcilable)
    // and the reservation must NOT be refunded — a live run could exist.
    assert.equal(res.status, 502);
    assert.equal(res.json.id, JOB_ID_1);
    assert.equal(res.json.status, "queued");
    assert.equal(ghCalls.length, 1);
    assert.equal(failQuotaCalls().length, 0);
});

test("gateway: SQL quota refusal (PostgREST error envelope) maps to 402 fail-closed", async () => {
    resetHarness({
        createResponses: [{
            status: 400,
            raw: JSON.stringify({ message: "QUOTA_VIDEOS_LIMIT: You've used your 2 videos for this period. Please upgrade." }),
        }],
    });
    const res = await post(createBody());
    assert.equal(res.status, 402);
    assert.match(res.json.error ?? res.json.message ?? "", /2 videos/);
    assert.equal(claimCalls().length, 0, "no claim after a refused create");
    assert.equal(ghCalls.length, 0);
});

test("gateway: request_id payload mismatch maps to 409", async () => {
    resetHarness({
        createResponses: [{
            status: 409,
            raw: JSON.stringify({ message: "REQUEST_ID_PAYLOAD_MISMATCH: settings differ" }),
        }],
    });
    const res = await post(createBody());
    assert.equal(res.status, 409);
    assert.equal(ghCalls.length, 0);
});

test("gateway: invalid language selectors are 400 with ZERO rpc calls", async () => {
    resetHarness();
    for (const bad of [
        { source_language: "fr" },
        { caption_language: "de" },
        { source_language: "fr", caption_language: "de" },
    ]) {
        const res = await post({ ...createBody(), ...bad });
        assert.equal(res.status, 400, JSON.stringify(bad));
    }
    assert.equal(rpcCalls.length, 0, "validation happens before any SQL authority");
    assert.equal(ghCalls.length, 0);
});
