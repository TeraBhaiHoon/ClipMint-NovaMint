import assert from "node:assert/strict";
import { test } from "node:test";
import { createComponentHarness, createSupabaseMock, deferred } from "./helpers/component-harness.mjs";

const job = (id = "job-a", extra = {}) => ({ id, user_id: "a", status: "failed", progress: 65, created_at: "2026-11-15T10:00:00Z", updated_at: "2026-11-15T10:00:00Z", caption_style: "hormozi", caption_pace: "balanced", source_language: "hi", caption_language: "original", job_mode: "clips", max_clips: 5, checkpoint_url: null, ...extra });
const context = () => ({ account: { id: "a", email: "a@example.test" }, profile: null, loading: false, usageReady: true, refreshProfile: async () => {} });
const detail = (supabase, dashboard, id = "job-a", freezeAnimationFrames = false) => createComponentHarness("src/app/dashboard/[jobId]/page.tsx", {
    freezeAnimationFrames,
    props: { params: { jobId: id } },
    mocks: { "@/lib/supabase": { createClient: () => supabase.client }, "../_components/dashboard-provider": { useDashboard: () => dashboard } },
});
const button = (harness, text) => {
    const direct = harness.nodes((node) => node.type === "Button" && JSON.stringify(node.props.children).includes(text))[0];
    return direct || harness.nodes((node) => node.props?.action?.type === "Button" && JSON.stringify(node.props.action.props.children).includes(text))[0]?.props.action;
};
const loading = (harness) => harness.nodes((node) => node.type === "LoadingState").length;

for (const status of ["failed", "done"]) {
    test(`detail: ${status} starts and settles with animation frames suspended`, async () => {
        const db = createSupabaseMock({ query: ({ name }) => ({ data: name === "jobs" ? job("job-a", { status }) : [], error: null }) });
        const harness = detail(db, context(), "job-a", true);
        try {
            await harness.advance(0);
            assert.equal(db.calls.filter((call) => call.kind === "query").length, 2);
            assert.equal(loading(harness), 0);
            if (status === "failed") assert.equal(button(harness, "Retry processing").props.disabled, false);
        } finally { harness.restore(); }
    });
}

test("detail: suspended frames cannot prevent the first request timeout", async () => {
    const db = createSupabaseMock({ query: () => new Promise(() => {}) });
    const harness = detail(db, context(), "job-a", true);
    try {
        await harness.advance(15_000);
        assert.equal(loading(harness), 0);
        assert.match(harness.text(), /took too long/);
        assert.ok(db.calls.filter((call) => call.kind === "query").every((call) => call.signal.aborted));
    } finally { harness.restore(); }
});

for (const status of ["failed", "done"]) {
    test(`detail: ${status} data renders without waiting on optional thumbnails`, async () => {
        const oldFetch = globalThis.fetch;
        const media = deferred();
        let mediaSignal;
        globalThis.fetch = (_url, options) => { mediaSignal = options.signal; return media.promise; };
        const supabase = createSupabaseMock({ query: ({ name }) => ({ data: name === "jobs" ? job("job-a", { status }) : [{ id: "clip-a", clip_index: 0, filename: "clip.mp4", storage_path: "delivery/clip.mp4" }], error: null }) });
        const harness = detail(supabase, context());
        try {
            await harness.advance(16);
            assert.equal(loading(harness), 0);
            assert.match(harness.text(), /Hindi \/ Hinglish/);
            assert.match(harness.text(), /Original language/);
            assert.match(harness.text(), /balanced/);
            if (status === "failed") assert.equal(button(harness, "Retry processing").props.disabled, false);
            await harness.advance(10_000);
            assert.equal(mediaSignal.aborted, true);
            assert.equal(loading(harness), 0);
        } finally { harness.restore(); globalThis.fetch = oldFetch; }
    });
}

test("detail: never-settling core query exits skeleton and explicit retry can load", async () => {
    const pending = deferred();
    let stalled = true;
    const supabase = createSupabaseMock({ query: ({ name }) => stalled ? pending.promise : ({ data: name === "jobs" ? job() : [], error: null }) });
    const harness = detail(supabase, context());
    try {
        await harness.advance(16);
        assert.equal(loading(harness), 1);
        await harness.advance(15_000);
        assert.equal(loading(harness), 0);
        assert.match(harness.text(), /took too long/);
        assert.ok(supabase.calls.filter((call) => call.kind === "query").every((call) => call.signal.aborted));
        stalled = false;
        button(harness, "Try again").props.onClick();
        await harness.flush();
        assert.equal(button(harness, "Retry processing").props.disabled, false);
        pending.resolve({ data: job("obsolete"), error: null });
        await harness.flush();
        assert.doesNotMatch(harness.text(), /obsolete/);
    } finally { harness.restore(); }
});

test("detail: job and account replacement cancel old data and obsolete realtime callbacks", async () => {
    const pending = deferred();
    const dashboard = context();
    const supabase = createSupabaseMock({ query: ({ name, filters }) => filters.user_id === "a" ? pending.promise : ({ data: name === "jobs" ? job("job-b", { user_id: "b" }) : [], error: null }) });
    const harness = detail(supabase, dashboard);
    try {
        await harness.advance(16);
        const oldChannel = supabase.channels[0];
        dashboard.account = { id: "b", email: "b@example.test" };
        harness.rerender({ params: { jobId: "job-b" } });
        await harness.advance(16);
        assert.equal(loading(harness), 0);
        assert.equal(oldChannel.removed, true);
        assert.ok(supabase.calls.filter((call) => call.filters?.user_id === "a").every((call) => call.signal.aborted));
        const calls = supabase.calls.length;
        oldChannel.callbacks.forEach((callback) => callback());
        await harness.flush();
        assert.equal(supabase.calls.length, calls);
        pending.resolve({ data: job("obsolete"), error: null });
        await harness.flush();
        assert.doesNotMatch(harness.text(), /obsolete/);
        assert.equal(harness.nodes((node) => node.type === "PageHeader")[0].props.title, "Video job-b");
    } finally { harness.restore(); }
});

test("detail: query error and inaccessible job are distinct settled states", async () => {
    let mode = "error";
    const supabase = createSupabaseMock({ query: () => ({ data: mode === "error" ? null : [], error: mode === "error" ? { message: "private database detail" } : null }) });
    const harness = detail(supabase, context());
    try {
        await harness.advance(16);
        assert.equal(loading(harness), 0);
        assert.match(harness.text(), /couldn’t be loaded/);
        assert.doesNotMatch(harness.text(), /private database detail/);
        mode = "missing";
        supabase.client.from = (name) => {
            const value = { select: () => value, eq: () => value, order: () => value, abortSignal: () => value, maybeSingle: () => value, then: (yes) => Promise.resolve({ data: name === "jobs" ? null : [], error: null }).then(yes) };
            return value;
        };
        button(harness, "Try again").props.onClick();
        await harness.flush();
        assert.equal(harness.nodes((node) => node.type === "EmptyState" && node.props.title === "Video not found").length, 1);
    } finally { harness.restore(); }
});

test("detail: checkpoint retry selector is conditional and retains saved language settings", async () => {
    const dashboard = context();
    const supabase = createSupabaseMock({ query: ({ name }) => ({ data: name === "jobs" ? job("job-a", { checkpoint_url: "https://example.test/checkpoint" }) : [], error: null }) });
    const harness = detail(supabase, dashboard);
    try {
        await harness.advance(16);
        const selector = harness.nodes((node) => node.type === "select" && node.props.id === "retry-mode")[0];
        assert.equal(selector.props.value, "resume");
        selector.props.onChange({ target: { value: "fresh" } });
        assert.equal(harness.nodes((node) => node.type === "select" && node.props.id === "retry-mode")[0].props.value, "fresh");
        assert.match(harness.text(), /language and caption settings are retained/);
        assert.match(harness.text(), /Hindi \/ Hinglish/);
        dashboard.usageReady = false;
        harness.rerender();
        assert.equal(button(harness, "Retry processing").props.disabled, true);
        assert.match(harness.text(), /Usage is temporarily unavailable/);
    } finally { harness.restore(); }
});

test("detail: pending retry A cannot leave errors or busy state on B", async () => {
    const previousFetch = globalThis.fetch;
    const post = deferred();
    let posts = 0;
    globalThis.fetch = () => { posts++; return post.promise; };
    const supabase = createSupabaseMock({ query: ({ name, filters }) => ({ data: name === "jobs" ? job(filters.id) : [], error: null }) });
    const harness = detail(supabase, context());
    try {
        await harness.advance(16);
        button(harness, "Retry processing").props.onClick();
        await harness.flush();
        assert.equal(posts, 1);
        harness.rerender({ params: { jobId: "job-b" } });
        await harness.advance(16);
        assert.equal(button(harness, "Retry processing").props.busy, false);
        post.resolve({ ok: false, json: async () => ({ error: "Job A retry failed" }) });
        await harness.flush();
        assert.equal(harness.nodes((node) => node.type === "PageHeader")[0].props.title, "Video job-b");
        assert.doesNotMatch(harness.text(), /Job A retry failed/);
        assert.equal(posts, 1);
    } finally { harness.restore(); globalThis.fetch = previousFetch; }
});

test("detail: stalled retry warns of unknown acceptance without automatically replaying", async () => {
    const previousFetch = globalThis.fetch;
    let posts = 0;
    globalThis.fetch = () => { posts++; return new Promise(() => {}); };
    const supabase = createSupabaseMock({ query: ({ name }) => ({ data: name === "jobs" ? job() : [], error: null }) });
    const harness = detail(supabase, context());
    try {
        await harness.advance(16);
        button(harness, "Retry processing").props.onClick();
        await harness.flush();
        await harness.advance(30_000);
        assert.match(harness.text(), /Processing may have started/);
        assert.equal(posts, 1);
        assert.equal(button(harness, "Retry processing").props.busy, false);
    } finally { harness.restore(); globalThis.fetch = previousFetch; }
});

test("detail: unmount aborts work and removes resync listeners", async () => {
    const pending = deferred();
    const supabase = createSupabaseMock({ query: () => pending.promise });
    const harness = detail(supabase, context());
    try {
        await harness.advance(16);
        harness.unmount();
        await harness.flush();
        assert.equal(harness.window.listenerCount("focus"), 0);
        assert.equal(harness.document.listenerCount("visibilitychange"), 0);
        assert.equal(supabase.channels[0].removed, true);
        assert.ok(supabase.calls.filter((call) => call.kind === "query").every((call) => call.signal.aborted));
    } finally { harness.restore(); }
});
