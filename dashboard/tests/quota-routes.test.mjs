// Route regression tests for /api/trigger-pipeline and /api/jobs — fully
// mocked (no network, no Supabase, no GitHub). The TS routes are transpiled
// with the repo's existing `typescript` devDependency (same pattern as
// tests/dashboard.test.mjs) and executed against stub modules, so the real
// handler code is what runs. No shared file is modified.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

// ── Transpile helper (existing pattern) ─────────────────────────────────────
const compile = (path) =>
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;

// ── Mutable mock state + recorders ──────────────────────────────────────────
const USER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";

const state = {
    user: { id: USER_ID },
    jobError: null,
    readbackError: null,
    job: null,
    admin: null,          // createServiceClient() result (null = missing key)
    validateUrl: { ok: true, url: null },
    r2: { configured: true, presign: "https://r2.example/signed/abc" },
    fetch: null,          // global fetch override (guard installed otherwise)
    env: {},
};

const recorded = { fetchCalls: [], sessionFrom: [], serviceFrom: [] };

let envSaved = false;
const envBackup = {};

function resetState(overrides = {}) {
    Object.assign(state, {
        user: { id: USER_ID },
        jobError: null,
        readbackError: null,
        job: null,
        admin: null,
        validateUrl: { ok: true, url: null },
        r2: { configured: true, presign: "https://r2.example/signed/abc" },
        fetch: null,
        env: { GITHUB_TOKEN: "tok", GITHUB_REPO: "acme/clipmint" },
    }, overrides);
    // The routes read process.env directly — mirror the per-test env there.
    for (const key of ["GITHUB_TOKEN", "GITHUB_REPO"]) {
        if (!envSaved) envBackup[key] = process.env[key];
        process.env[key] = state.env[key] || "";
    }
    envSaved = true;
    // Guard fetch: any unexpected network call is recorded (with its payload)
    // and thrown on, so "no dispatch" assertions catch stray attempts instead
    // of hitting the network.
    globalThis.fetch = state.fetch ?? (async (url, init) => {
        let body = null;
        try { body = init?.body ? JSON.parse(init.body) : (init?.body ?? null); } catch { body = init?.body ?? null; }
        recorded.fetchCalls.push({ url, body });
        throw new Error(`unexpected fetch: ${url}`);
    });
    recorded.fetchCalls.length = 0;
    recorded.sessionFrom.length = 0;
    recorded.serviceFrom.length = 0;
}

const baseJob = () => ({
    id: JOB_ID, user_id: USER_ID,
    video_url: "https://youtube.com/watch?v=abc", video_storage_path: null,
    caption_style: "hormozi", caption_pace: "fast",
    source_language: "hi", caption_language: "original", max_clips: 5,
    job_mode: "clips", remove_silences: false, auto_punch_in: false,
    bgm_mood: "auto", custom_bgm_url: null, status: "queued",
    quota_state: "pending", quota_video_charged: true, dispatch_count: 0,
    checkpoint_url: null, usage_window_start: null,
});

// ── Supabase client stubs ───────────────────────────────────────────────────
function sessionClient() {
    return {
        auth: { getUser: async () => ({ data: { user: state.user } }) },
        from(table) {
            recorded.sessionFrom.push(table);
            return {
                select() { return this; },
                eq() { return this; },
                single: async () => (state.jobError
                    ? { data: null, error: { message: state.jobError } }
                    : { data: state.job, error: null }),
            };
        },
    };
}

function serviceClient(handlers = {}) {
    const rpcCalls = [];
    const client = {
        rpcCalls,
        rpc: async (name, params) => {
            rpcCalls.push({ name, params });
            const handler = handlers[name];
            return handler ? await handler(params) : { data: null, error: { message: `unexpected rpc ${name}` } };
        },
        from(table) {
            recorded.serviceFrom.push(table);
            return {
                select() { return this; },
                eq() { return this; },
                single: async () => (state.readbackError
                    ? { data: null, error: { message: state.readbackError } }
                    : {
                        data: { id: JOB_ID, status: "queued", max_clips: 5, quota_state: "pending", clips_budget: 5, usage_window_start: null },
                        error: null,
                    }),
            };
        },
    };
    return client;
}

const claimOk = (granted = 5) => async () => ({
    data: [{ claimed: true, reason: "claimed", granted_clips: granted }], error: null,
});
const claimRefused = (reason) => async () => ({
    data: [{ claimed: false, reason, granted_clips: 0 }], error: null,
});
const failJobRpc = async () => ({ data: null, error: null });

// ── Module require shim + route loading ─────────────────────────────────────
function loadRoute(sourcePath) {
    const code = compile(sourcePath);
    const shim = (name) => {
        if (name === "next/server") {
            class NextRequest {}
            return {
                NextRequest,
                NextResponse: {
                    json: (data, init) => ({ status: init?.status ?? 200, data }),
                },
            };
        }
        if (name === "@/lib/server") {
            return {
                createClient: async () => sessionClient(),
                createServiceClient: () => state.admin,
            };
        }
        if (name === "@/lib/validateUrl") {
            return { validateVideoUrl: (url) => {
                if (!state.validateUrl.ok) return { ok: false, reason: state.validateUrl.reason };
                return { ok: true, url: state.validateUrl.url ?? url };
            } };
        }
        if (name === "@/lib/r2") {
            return {
                r2Configured: () => state.r2.configured,
                r2PresignGet: async () => state.r2.presign,
            };
        }
        throw new Error(`unexpected require ${name}`);
    };
    const compiledModule = { exports: {} };
    new Function("require", "module", "exports", code)(shim, compiledModule, compiledModule.exports);
    return compiledModule.exports;
}

const triggerRoute = loadRoute("../src/app/api/trigger-pipeline/route.ts");
const jobsRoute = loadRoute("../src/app/api/jobs/route.ts");

// Crash-safe runner: a route that THROWS on malformed input (e.g. missing
// claim row) is normalized to status 500 + crash flag instead of failing the
// harness — the assertion then decides whether that is acceptable.
const post = async (route, body) => {
    try {
        return await route.POST({ json: async () => body });
    } catch (err) {
        return { status: 500, data: { error: String(err?.message ?? err) }, crash: true };
    }
};

// ── env handling ────────────────────────────────────────────────────────────
test("trigger: fresh queued job, first dispatch (count 0) succeeds — no queued-0 gate", async () => {
    resetState({
        job: baseJob(),
        admin: serviceClient({ claim_job_dispatch: claimOk(5), fail_job_quota: failJobRpc }),
        fetch: async (url, init) => {
            recorded.fetchCalls.push({ url, body: JSON.parse(init.body) });
            return { ok: true, status: 200, text: async () => "" };
        },
    });
    const res = await post(triggerRoute, { job_id: JOB_ID });
    assert.equal(res.status, 200);
    assert.equal(res.data.triggered, true);
    assert.equal(recorded.fetchCalls.length, 1);
    assert.match(recorded.fetchCalls[0].url, /process-video\.yml\/dispatches$/);
    assert.equal(recorded.fetchCalls[0].body.inputs.job_id, JOB_ID);
    // The route itself must not gate on queued/0 state: the claim RPC already
    // granted the dispatch and nothing else blocks it before the dispatch.
    const failCalls = state.admin.rpcCalls.filter((c) => c.name === "fail_job_quota");
    assert.equal(failCalls.length, 0);
});

test("trigger: dispatch inputs use PERSISTED source/caption choices, not client body", async () => {
    resetState({
        job: baseJob(),
        admin: serviceClient({ claim_job_dispatch: claimOk(5), fail_job_quota: failJobRpc }),
        fetch: async (url, init) => {
            recorded.fetchCalls.push({ url, body: JSON.parse(init.body) });
            return { ok: true, status: 200, text: async () => "" };
        },
    });
    // Client tries to override style/pace/languages/mode/bgm — all ignored.
    const res = await post(triggerRoute, {
        job_id: JOB_ID, caption_style: "glitch", caption_pace: "slow",
        source_language: "fr", caption_language: "de", job_mode: "captions",
        bgm_mood: "inspiring", custom_bgm_url: "https://evil.example/x.mp3",
        max_clips: 99,
    });
    assert.equal(res.status, 200);
    const inputs = recorded.fetchCalls[0].body.inputs;
    assert.equal(inputs.caption_style, "hormozi");       // persisted
    assert.equal(inputs.caption_pace, "fast");           // persisted
    assert.equal(inputs.source_language, "hi");          // persisted
    assert.equal(inputs.caption_language, "original");   // persisted
    assert.equal(inputs.job_mode, "clips");              // persisted
    assert.equal(inputs.bgm_mood, "auto");               // persisted
    assert.equal(inputs.custom_bgm_url, "");             // persisted
    assert.equal(inputs.max_clips, "5");                 // granted budget, not client 99
});

test("trigger: invalid persisted caption_pace/language fall back to safe defaults", async () => {
    resetState({
        job: { ...baseJob(), caption_pace: "bogus", source_language: "zz", caption_language: null },
        admin: serviceClient({ claim_job_dispatch: claimOk(5), fail_job_quota: failJobRpc }),
        fetch: async (url, init) => {
            recorded.fetchCalls.push({ url, body: JSON.parse(init.body) });
            return { ok: true, status: 200, text: async () => "" };
        },
    });
    const res = await post(triggerRoute, { job_id: JOB_ID });
    const inputs = recorded.fetchCalls[0].body.inputs;
    assert.equal(res.status, 200);
    assert.equal(inputs.caption_pace, "balanced");
    assert.equal(inputs.source_language, "auto");
    assert.equal(inputs.caption_language, "original");
});

test("trigger: duplicate dispatch of a claimed/queued job is denied (409, no GitHub call)", async () => {
    resetState({
        job: baseJob(),
        admin: serviceClient({ claim_job_dispatch: claimRefused("in_flight"), fail_job_quota: failJobRpc }),
    });
    const res = await post(triggerRoute, { job_id: JOB_ID });
    assert.equal(res.status, 409);
    assert.match(res.data.error, /already processing/);
    assert.equal(recorded.fetchCalls.length, 0);
});

test("trigger: done job refused (409), no GitHub call", async () => {
    resetState({
        job: { ...baseJob(), status: "done", quota_state: "charged" },
        admin: serviceClient({ claim_job_dispatch: claimRefused("done"), fail_job_quota: failJobRpc }),
    });
    const res = await post(triggerRoute, { job_id: JOB_ID });
    assert.equal(res.status, 409);
    assert.match(res.data.error, /already completed/);
    assert.equal(recorded.fetchCalls.length, 0);
});

test("trigger: quota refusal from the expiry-aware SQL claim maps to 402 fail-closed", async () => {
    // Expiry fallback (expired paid plan → free limits) is enforced inside the
    // claim_job_dispatch SQL; the route must surface its refusal as 402 and
    // never dispatch.
    resetState({
        job: baseJob(),
        admin: serviceClient({
            claim_job_dispatch: async () => ({
                data: null, error: { message: "QUOTA_VIDEOS_LIMIT: You've used your 2 videos for this period. Please upgrade." },
            }),
            fail_job_quota: failJobRpc,
        }),
    });
    const res = await post(triggerRoute, { job_id: JOB_ID });
    assert.equal(res.status, 402);
    assert.match(res.data.error, /2 videos/);
    assert.equal(recorded.fetchCalls.length, 0);
});

test("trigger: unknown claim RPC failure is fail-closed 503 with no dispatch", async () => {
    resetState({
        job: baseJob(),
        admin: serviceClient({
            claim_job_dispatch: async () => ({ data: null, error: { message: "DB down" } }),
            fail_job_quota: failJobRpc,
        }),
    });
    const res = await post(triggerRoute, { job_id: JOB_ID });
    assert.equal(res.status, 503);
    assert.equal(recorded.fetchCalls.length, 0);
});

test("trigger: missing service key is fail-closed 503, no claim, no dispatch", async () => {
    resetState({ job: baseJob(), admin: null });
    const res = await post(triggerRoute, { job_id: JOB_ID });
    assert.equal(res.status, 503);
    assert.equal(recorded.fetchCalls.length, 0);
});

test("trigger: missing GITHUB env fails the job via fail_job_quota RPC exactly once, no dispatch", async () => {
    resetState({
        job: baseJob(),
        admin: serviceClient({ claim_job_dispatch: claimOk(5), fail_job_quota: failJobRpc }),
        env: { GITHUB_TOKEN: "", GITHUB_REPO: "acme/clipmint" },
    });
    const res = await post(triggerRoute, { job_id: JOB_ID });
    assert.equal(res.status, 500);
    const failCalls = state.admin.rpcCalls.filter((c) => c.name === "fail_job_quota");
    assert.equal(failCalls.length, 1);                          // refunded/settled once
    assert.equal(failCalls[0].params.p_job_id, JOB_ID);
    assert.equal(failCalls[0].params.p_status, "failed");
    assert.equal(recorded.fetchCalls.length, 0);                // never dispatched
});

test("trigger: stale FAILED retry re-reserves — dispatches the SQL-granted budget, not client or stale max_clips", async () => {
    resetState({
        job: { ...baseJob(), status: "failed", dispatch_count: 2, max_clips: 10, checkpoint_url: "https://drive.example/ck" },
        admin: serviceClient({ claim_job_dispatch: claimOk(3), fail_job_quota: failJobRpc }),
        fetch: async (url, init) => {
            recorded.fetchCalls.push({ url, body: JSON.parse(init.body) });
            return { ok: true, status: 200, text: async () => "" };
        },
    });
    const res = await post(triggerRoute, { job_id: JOB_ID, resume: true, max_clips: 99 });
    assert.equal(res.status, 200);
    assert.equal(res.data.max_clips, 3);                        // fresh SQL budget
    const inputs = recorded.fetchCalls[0].body.inputs;
    assert.equal(inputs.max_clips, "3");                        // not stale 10, not client 99
    assert.equal(inputs.resume_from_checkpoint, "true");        // explicit retry flag honored
    const failCalls = state.admin.rpcCalls.filter((c) => c.name === "fail_job_quota");
    assert.equal(failCalls.length, 0);
});

test("trigger: dispatch cap — job with 5 dispatches is settled and refused (429)", async () => {
    resetState({
        job: { ...baseJob(), dispatch_count: 5 },
        admin: serviceClient({ claim_job_dispatch: claimOk(5), fail_job_quota: failJobRpc }),
    });
    const res = await post(triggerRoute, { job_id: JOB_ID });
    assert.equal(res.status, 429);
    assert.match(res.data.error, /retry limit/);
    const failCalls = state.admin.rpcCalls.filter((c) => c.name === "fail_job_quota");
    assert.equal(failCalls.length, 1);                          // claim undone
    assert.equal(recorded.fetchCalls.length, 0);
});

test("trigger: GitHub HTTP rejection settles the job (fail_job_quota once) and returns 500", async () => {
    resetState({
        job: baseJob(),
        admin: serviceClient({ claim_job_dispatch: claimOk(5), fail_job_quota: failJobRpc }),
        fetch: async () => ({ ok: false, status: 422, text: async () => "Bad request" }),
    });
    const res = await post(triggerRoute, { job_id: JOB_ID });
    assert.equal(res.status, 500);
    const failCalls = state.admin.rpcCalls.filter((c) => c.name === "fail_job_quota");
    assert.equal(failCalls.length, 1);
});

test("trigger: GitHub network error leaves the job queued (no refund) — reconcile cron owns it", async () => {
    resetState({
        job: baseJob(),
        admin: serviceClient({ claim_job_dispatch: claimOk(5), fail_job_quota: failJobRpc }),
    });
    state.fetch = async () => { throw new Error("ECONNRESET"); };
    const res = await post(triggerRoute, { job_id: JOB_ID });
    assert.equal(res.status, 502);
    const failCalls = state.admin.rpcCalls.filter((c) => c.name === "fail_job_quota");
    assert.equal(failCalls.length, 0);   // acceptance UNKNOWN — never refunded here
});

test("trigger: upload source — R2 presign failure fails the job once, no dispatch", async () => {
    resetState({
        job: { ...baseJob(), video_url: null, video_storage_path: `sources/${USER_ID}/123.mp4` },
        admin: serviceClient({ claim_job_dispatch: claimOk(5), fail_job_quota: failJobRpc }),
        r2: { configured: true, presign: null },
    });
    const res = await post(triggerRoute, { job_id: JOB_ID });
    assert.equal(res.status, 400);
    const failCalls = state.admin.rpcCalls.filter((c) => c.name === "fail_job_quota");
    assert.equal(failCalls.length, 1);
    assert.equal(recorded.fetchCalls.length, 0);
});

test("trigger: unauthenticated caller gets 401 before any state change", async () => {
    resetState({ user: null, job: baseJob(), admin: serviceClient({}) });
    const res = await post(triggerRoute, { job_id: JOB_ID });
    assert.equal(res.status, 401);
    assert.equal(recorded.fetchCalls.length, 0);
});

// ── /api/jobs ───────────────────────────────────────────────────────────────
const jobsBody = {
    request_id: "5f0c4c1e-8b1a-4c6e-9f3a-2b7d1e0a9c11",
    video_url: "https://youtube.com/watch?v=abc",
    source_type: "url", job_mode: "clips", caption_style: "hormozi",
    caption_pace: "slow", source_language: "hi", caption_language: "original",
    max_clips: 5, remove_silences: true, auto_punch_in: false, bgm_mood: "calm",
};

function jobsAdmin({ rpcResult } = {}) {
    return serviceClient({
        create_job_with_quota: async () => rpcResult,
    });
}

test("jobs: malformed enums are rejected with 400 and never reach the SQL reservation", async () => {
    resetState({ admin: jobsAdmin({ rpcResult: { data: JOB_ID, error: null } }) });
    const res = await post(jobsRoute, {
        ...jobsBody,
        source_language: "fr", caption_language: "de", job_mode: "both",
        caption_pace: 5, bgm_mood: "loud", max_clips: 99,
    });
    assert.equal(res.status, 400);
    assert.ok(Array.isArray(res.data.details) && res.data.details.length >= 6);
    // No RPC was attempted — strict validation happens before any reservation.
    assert.equal(state.admin.rpcCalls.filter((c) => c.name === "create_job_with_quota").length, 0);
});

test("jobs: request_id is the retry key — required, UUID-checked, passed to the SQL idempotency", async () => {
    resetState({ admin: jobsAdmin({ rpcResult: { data: JOB_ID, error: null } }) });
    const missing = await post(jobsRoute, { ...jobsBody, request_id: undefined });
    assert.equal(missing.status, 400);
    assert.match(missing.data.error, /request_id/);
    const invalid = await post(jobsRoute, { ...jobsBody, request_id: "not-a-uuid" });
    assert.equal(invalid.status, 400);
    // Valid retry: the SAME request_id travels into the SQL call, which owns
    // the replay (same id → original job, never a second reservation).
    const first = await post(jobsRoute, jobsBody);
    const second = await post(jobsRoute, jobsBody);
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const quotaCalls = state.admin.rpcCalls.filter((c) => c.name === "create_job_with_quota");
    assert.equal(quotaCalls.length, 2);
    assert.equal(quotaCalls[0].params.p_creation_request_id, jobsBody.request_id);
    assert.equal(quotaCalls[1].params.p_creation_request_id, jobsBody.request_id);
});

test("jobs: happy path reserves via the SQL RPC with server-derived fields only", async () => {
    resetState({ admin: jobsAdmin({ rpcResult: { data: JOB_ID, error: null } }) });
    const res = await post(jobsRoute, jobsBody);
    assert.equal(res.status, 201);
    assert.equal(res.data.job.id, JOB_ID);
    const call = state.admin.rpcCalls.find((c) => c.name === "create_job_with_quota");
    assert.equal(call.params.p_user_id, USER_ID);
    const job = call.params.p_job;
    assert.equal(job.caption_pace, "slow");
    assert.equal(job.source_language, "hi");
    assert.equal(job.caption_language, "original");
    assert.equal(job.max_clips, 5);
    assert.equal(job.remove_silences, false);   // clips mode never carries the captions-mode flag
    // The browser never supplies identity/status/quota columns.
    assert.equal("user_id" in job, false);
    assert.equal("status" in job, false);
    assert.equal("progress" in job, false);
});

test("jobs: quota refusal maps to 402; payload-mismatch retry maps to 409", async () => {
    resetState({
        admin: jobsAdmin({ rpcResult: { data: null, error: { message: "QUOTA_VIDEOS_LIMIT: You've used your 2 videos for this period. Please upgrade." } } }),
    });
    const res = await post(jobsRoute, jobsBody);
    assert.equal(res.status, 402);
    assert.match(res.data.error, /2 videos/);

    resetState({
        admin: jobsAdmin({ rpcResult: { data: null, error: { message: "REQUEST_ID_PAYLOAD_MISMATCH: settings differ" } } }),
    });
    const replay = await post(jobsRoute, { ...jobsBody, caption_style: "neon" });
    assert.equal(replay.status, 409);
    assert.match(replay.data.error, /different settings/i);
});

test("jobs: fail-closed — missing service key and RPC failures never create a job", async () => {
    resetState({ admin: null });
    const noKey = await post(jobsRoute, jobsBody);
    assert.equal(noKey.status, 503);

    resetState({ admin: jobsAdmin({ rpcResult: { data: null, error: { message: "DB down" } } }) });
    const rpcFail = await post(jobsRoute, jobsBody);
    assert.equal(rpcFail.status, 503);
    assert.equal(rpcFail.data.error, "Could not start your video right now. Please try again shortly.");
});

test("jobs: created job whose readback fails still returns 201 with the id (no second reservation)", async () => {
    resetState({
        admin: serviceClient({
            create_job_with_quota: async () => ({ data: JOB_ID, error: null }),
        }),
        readbackError: "readback down",
    });
    const res = await post(jobsRoute, jobsBody);
    assert.equal(res.status, 201);
    assert.equal(res.data.job.id, JOB_ID);
    assert.equal(res.data.job.status, "queued");
});

// ── Malformed claim responses: the route must FAIL CLOSED ───────────────────
// Contract (main's fix in trigger-pipeline/route.ts): a claim row that is
// empty, missing the boolean `claimed`, has a non-integer or out-of-bounds
// budget (<1 or >20 when claimed) → 503 "Could not verify the processing
// reservation", NO GitHub dispatch, and NO refund — the service claim may
// hold the reservation, which is left for the reconcile cron.
const malformedClaim = (claim) => async () => ({ data: claim, error: null });
const expectFailClosed = async (claim) => {
    resetState({
        job: baseJob(),
        admin: serviceClient({
            claim_job_dispatch: malformedClaim(claim),
            fail_job_quota: failJobRpc,
        }),
    });
    const res = await post(triggerRoute, { job_id: JOB_ID });
    assert.equal(res.status, 503);                 // fail-closed, never 409/502/500
    assert.match(res.data.error, /Could not verify the processing reservation/);
    assert.equal(recorded.fetchCalls.length, 0);   // never dispatched
    const failCalls = state.admin.rpcCalls.filter((c) => c.name === "fail_job_quota");
    assert.equal(failCalls.length, 0);             // reservation left, not refunded
    return res;
};

test("claim malformed: claimed as string 'false' fails closed", async () => {
    const res = await expectFailClosed([{ claimed: "false", reason: "claimed", granted_clips: 5 }]);
    assert.equal(res.crash, undefined);
});

test("claim malformed: claimed missing fails closed", async () => {
    const res = await expectFailClosed([{ reason: "claimed", granted_clips: 5 }]);
    assert.equal(res.crash, undefined);
});

test("claim malformed: empty claim array fails closed without crashing", async () => {
    const res = await expectFailClosed([]);
    assert.equal(res.crash, undefined);
});

test("claim malformed: claim object without fields fails closed", async () => {
    const res = await expectFailClosed({});
    assert.equal(res.crash, undefined);
});

test("claim malformed: granted_clips missing fails closed (no budget undefined dispatch)", async () => {
    const res = await expectFailClosed([{ claimed: true, reason: "claimed" }]);
    assert.equal(res.crash, undefined);
});

test("claim malformed: granted_clips 0 fails closed (claimed budget must be >= 1)", async () => {
    const res = await expectFailClosed([{ claimed: true, reason: "claimed", granted_clips: 0 }]);
    assert.equal(res.crash, undefined);
});

test("claim malformed: granted_clips above 20 fails closed", async () => {
    const res = await expectFailClosed([{ claimed: true, reason: "claimed", granted_clips: 21 }]);
    assert.equal(res.crash, undefined);
});

test("claim malformed: non-integer granted_clips fails closed", async () => {
    const res = await expectFailClosed([{ claimed: true, reason: "claimed", granted_clips: 2.5 }]);
    assert.equal(res.crash, undefined);
});
