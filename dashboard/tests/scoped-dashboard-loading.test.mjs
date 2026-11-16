import assert from "node:assert/strict";
import { test } from "node:test";
import { createComponentHarness, createSupabaseMock, deferred } from "./helpers/component-harness.mjs";

const user = (id) => ({ id, email: `${id}@example.test` });
const authResult = (id) => ({ data: { user: id ? user(id) : null }, error: null });
const profile = (id) => ({ id, full_name: id, plan: "free", clips_used: 1, videos_used: 1, clips_reserved: 2 });
const job = (id, accountId) => ({ id, user_id: accountId, source_title: id, caption_style: "minimal", status: "failed", created_at: "2026-11-16T00:00:00Z", clips_count: 0 });
function provider(db, router = { replace() {} }) {
    return createComponentHarness("src/app/dashboard/_components/dashboard-provider.tsx", { mocks: { "@/lib/supabase": { createClient: () => db.client }, "next/navigation": { useRouter: () => router } }, props: { children: null } });
}
function page(path, db, context, freezeAnimationFrames = false) {
    return createComponentHarness(`src/app/dashboard/${path}`, { freezeAnimationFrames, mocks: {
        "@/lib/supabase": { createClient: () => db.client },
        "./_components/dashboard-provider": { useDashboard: () => context.value },
        "../_components/dashboard-provider": { useDashboard: () => context.value },
    } });
}

function mutationDb({ save: saveResult, password: passwordResult } = {}) {
    const db = createSupabaseMock();
    db.client.from = (name) => {
        const call = { kind: "query", name, filters: {}, signal: null };
        db.calls.push(call);
        const query = {
            select() { return query; },
            update(values) { call.kind = "update"; call.values = values; return query; },
            eq(key, value) { call.filters[key] = value; return query; },
            order() { return query; }, limit() { return query; },
            abortSignal(signal) { call.signal = signal; return query; },
            then(yes, no) { return Promise.resolve().then(() => call.kind === "update" ? saveResult?.(call) ?? { error: null } : { data: [], error: null }).then(yes, no); },
        };
        return query;
    };
    db.client.auth.resetPasswordForEmail = (email) => {
        const call = { kind: "password", email };
        db.calls.push(call);
        return passwordResult?.(call) ?? Promise.resolve({ error: null });
    };
    return db;
}
const settingsContext = (id, refreshProfile = async () => {}) => ({ value: { account: user(id), profile: profile(id), loading: false, usageReady: true, error: null, refreshProfile } });
const saveButton = (h) => h.nodes((node) => node.type === "Button" && node.props.type === "submit")[0];
const resetButton = (h) => h.nodes((node) => node.type === "Button" && (node.props.children === "Email sent" || Array.isArray(node.props.children) && node.props.children.some((child) => child === "Send reset email" || child === "Email sent")))[0];
const submit = (h) => h.nodes((node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
const editName = (h, value) => h.nodes((node) => node.props?.id === "full-name")[0].props.onChange({ target: { value } });

test("settings initialize without an animation frame and do not mask account errors", async () => {
    const db = mutationDb();
    const context = settingsContext("a");
    const h = page("settings/page.tsx", db, context, true);
    try {
        await h.advance(0);
        assert.equal(h.nodes((node) => node.type === "LoadingState").length, 0);
        assert.equal(h.nodes((node) => node.props?.id === "full-name")[0].props.value, "a");
        context.value = { ...context.value, account: user("b"), profile: profile("b"), error: "unavailable" };
        h.rerender();
        assert.equal(h.nodes((node) => node.type === "LoadingState").length, 0);
        assert.match(h.text(), /Account settings are temporarily unavailable/);
    } finally { h.restore(); }
});

test("settings suspended-frame initialization cannot publish old account fields", async () => {
    const db = mutationDb();
    const context = settingsContext("a");
    const h = page("settings/page.tsx", db, context, true);
    try {
        context.value = { ...context.value, account: user("b"), profile: profile("b") };
        h.rerender();
        await h.advance(0);
        assert.equal(h.nodes((node) => node.props?.id === "full-name")[0].props.value, "b");
        assert.equal(h.nodes((node) => node.type === "LoadingState").length, 0);
    } finally { h.restore(); }
});

test("settings save A cannot publish success, local preference or refresh on B", async () => {
    const pending = deferred();
    const db = mutationDb({ save: () => pending.promise });
    let refreshes = 0;
    const context = settingsContext("a", async () => { refreshes++; });
    const h = page("settings/page.tsx", db, context);
    try {
        await h.advance(16);
        const writes = [];
        globalThis.localStorage.setItem = (...args) => writes.push(args);
        editName(h, "A edited");
        const saving = submit(h);
        await h.flush();
        assert.equal(saveButton(h).props.busy, true);
        const update = db.calls.find((call) => call.kind === "update");
        assert.equal(update.filters.id, "a");
        context.value = { ...context.value, account: user("b"), profile: profile("b") };
        h.rerender();
        await h.advance(16);
        assert.equal(saveButton(h).props.busy, false);
        assert.equal(update.signal.aborted, true);
        pending.resolve({ error: null });
        await saving;
        await h.flush();
        assert.doesNotMatch(h.text(), /Settings saved/);
        assert.equal(refreshes, 0);
        assert.deepEqual(writes, []);
        assert.equal(h.nodes((node) => node.props?.id === "full-name")[0].props.value, "b");
    } finally { h.restore(); }
});

test("settings owner mismatch hides form and obsolete submit cannot update", async () => {
    const db = mutationDb();
    const context = settingsContext("a");
    const h = page("settings/page.tsx", db, context);
    try {
        await h.advance(16);
        editName(h, "A draft");
        const oldSubmit = h.nodes((node) => node.type === "form")[0].props.onSubmit;
        context.value = { ...context.value, account: user("b") };
        h.rerender();
        await h.advance(16);
        assert.equal(h.nodes((node) => node.type === "form").length, 0);
        assert.equal(h.nodes((node) => node.props?.label === "Loading account settings").length, 0);
        assert.match(h.text(), /Account settings are temporarily unavailable/);
        await oldSubmit({ preventDefault() {} });
        await h.flush();
        assert.equal(db.calls.filter((call) => call.kind === "update").length, 0);
    } finally { h.restore(); }
});

test("settings save deadline warns uncertain outcome, never replays and ignores late success", async () => {
    const pending = deferred();
    const db = mutationDb({ save: () => pending.promise });
    let refreshes = 0;
    const context = settingsContext("a", async () => { refreshes++; });
    const h = page("settings/page.tsx", db, context);
    try {
        await h.advance(16);
        editName(h, "Edited");
        const saving = submit(h);
        await h.flush();
        await h.advance(15_000);
        await saving;
        assert.equal(saveButton(h).props.busy, false);
        assert.match(h.text(), /save result couldn’t be confirmed/);
        assert.match(h.text(), /Refresh your account before saving again/);
        assert.equal(db.calls.filter((call) => call.kind === "update").length, 1);
        assert.equal(db.calls.find((call) => call.kind === "update").signal.aborted, true);
        pending.resolve({ error: null });
        await h.advance(60_000);
        assert.equal(db.calls.filter((call) => call.kind === "update").length, 1);
        assert.equal(refreshes, 0);
        assert.doesNotMatch(h.text(), /Settings saved/);
    } finally { h.restore(); }
});

test("confirmed save ends saving independently of pending profile refresh", async () => {
    const refresh = deferred();
    const db = mutationDb();
    const h = page("settings/page.tsx", db, settingsContext("a", () => refresh.promise));
    try {
        await h.advance(16);
        editName(h, "Edited");
        await submit(h);
        await h.flush();
        assert.equal(saveButton(h).props.busy, false);
        assert.match(h.text(), /Settings saved/);
        assert.equal(db.calls.filter((call) => call.kind === "update").length, 1);
    } finally { h.restore(); }
});

test("password request A resets pending for B and late A cannot mark B sent", async () => {
    const pending = deferred();
    const db = mutationDb({ password: (call) => call.email === "a@example.test" ? pending.promise : Promise.resolve({ error: null }) });
    const context = settingsContext("a");
    const h = page("settings/page.tsx", db, context);
    try {
        await h.advance(16);
        h.nodes((node) => node.props?.id === "settings-tab-security")[0].props.onClick();
        const request = resetButton(h).props.onClick();
        await h.flush();
        assert.equal(resetButton(h).props.busy, true);
        context.value = { ...context.value, account: user("b"), profile: profile("b") };
        h.rerender();
        await h.advance(16);
        assert.equal(resetButton(h).props.busy, false);
        assert.equal(resetButton(h).props.disabled, false);
        pending.resolve({ error: null });
        await request;
        await h.flush();
        assert.equal(resetButton(h).props.disabled, false);
        assert.doesNotMatch(h.text(), /Password reset email sent/);
        await resetButton(h).props.onClick();
        await h.flush();
        assert.equal(resetButton(h).props.disabled, true);
        assert.equal(db.calls.filter((call) => call.kind === "password").at(-1).email, "b@example.test");
    } finally { h.restore(); }
});

test("password deadline warns uncertain email without sending twice or late success", async () => {
    const pending = deferred();
    const db = mutationDb({ password: () => pending.promise });
    const h = page("settings/page.tsx", db, settingsContext("a"));
    try {
        await h.advance(16);
        h.nodes((node) => node.props?.id === "settings-tab-security")[0].props.onClick();
        const request = resetButton(h).props.onClick();
        await h.flush();
        await h.advance(15_000);
        await request;
        assert.equal(resetButton(h).props.busy, false);
        assert.match(h.text(), /reset email result couldn’t be confirmed/);
        pending.resolve({ error: null });
        await h.advance(60_000);
        assert.equal(db.calls.filter((call) => call.kind === "password").length, 1);
        assert.equal(resetButton(h).props.disabled, false);
        assert.doesNotMatch(h.text(), /Password reset email sent/);
    } finally { h.restore(); }
});

for (const stage of ["auth", "profile"]) {
    test(`provider bounds never-settling ${stage}, permits retry and ignores late completion`, async () => {
        const stalled = deferred();
        let stall = true;
        const db = createSupabaseMock({ auth: () => stage === "auth" && stall ? stalled.promise : authResult("a"), query: () => stage === "profile" && stall ? stalled.promise : { data: profile("a"), error: null } });
        const h = provider(db);
        try {
            await h.flush();
            assert.equal(h.tree.props.value.loading, true);
            await h.advance(15_000);
            assert.equal(h.tree.props.value.loading, false);
            assert.match(h.tree.props.value.error, /couldn’t be refreshed/);
            assert.equal(h.tree.props.value.usageReady, false);
            if (stage === "profile") assert.equal(db.calls.find((call) => call.name === "profiles").signal.aborted, true);
            stall = false;
            await h.tree.props.value.refreshProfile();
            await h.flush();
            assert.equal(h.tree.props.value.profile.id, "a");
            assert.equal(h.tree.props.value.usageReady, true);
            stalled.resolve(stage === "auth" ? authResult("old") : { data: profile("old"), error: null });
            await h.flush();
            assert.equal(h.tree.props.value.account.id, "a");
            assert.equal(h.tree.props.value.profile.id, "a");
        } finally { h.restore(); }
    });
}

test("provider bounds optional rollover and still loads preferences with unavailable usage", async () => {
    const stalled = deferred();
    const db = createSupabaseMock({ rpc: () => stalled.promise, query: () => ({ data: profile("a"), error: null }) });
    const h = provider(db);
    try {
        await h.flush();
        assert.equal(db.calls.filter((call) => call.name === "profiles").length, 0);
        await h.advance(5_000);
        assert.equal(h.tree.props.value.profile.id, "a");
        assert.equal(h.tree.props.value.loading, false);
        assert.equal(h.tree.props.value.usageReady, false);
        assert.equal(h.tree.props.value.error, null);
        assert.equal(db.calls.find((call) => call.kind === "rpc").signal.aborted, true);
        stalled.resolve({ data: null, error: null });
        await h.flush();
        assert.equal(h.tree.props.value.usageReady, false);
    } finally { h.restore(); }
});

test("provider outer deadline cancels rollover and forbids late preference SELECT", async () => {
    const delayedAuth = deferred();
    const delayedRollover = deferred();
    const db = createSupabaseMock({ auth: () => delayedAuth.promise, rpc: () => delayedRollover.promise });
    const h = provider(db);
    try {
        await h.flush();
        await h.advance(12_000);
        delayedAuth.resolve(authResult("a"));
        await h.flush();
        const rollover = db.calls.find((call) => call.kind === "rpc");
        await h.advance(3_000);
        assert.equal(h.tree.props.value.loading, false);
        assert.equal(rollover.signal.aborted, true);
        delayedRollover.resolve({ data: null, error: null });
        await h.flush();
        assert.equal(db.calls.some((call) => call.name === "profiles"), false);
        assert.equal(h.tree.props.value.usageReady, false);
    } finally { h.restore(); }
});

test("provider returned rollover error leaves preferences readable without authoritative counters", async () => {
    const db = createSupabaseMock({ rpc: () => ({ error: { message: "private database error" } }), query: () => ({ data: profile("a"), error: null }) });
    const h = provider(db);
    try {
        await h.flush();
        assert.equal(h.tree.props.value.profile.id, "a");
        assert.equal(h.tree.props.value.usageReady, false);
        assert.equal(h.tree.props.value.error, null);
    } finally { h.restore(); }
});

test("provider immediately invalidates account A and schedules B auth outside callback", async () => {
    const oldProfile = deferred();
    let accountId = "a";
    const db = createSupabaseMock({ auth: () => authResult(accountId), query: (call) => call.filters.id === "a" ? oldProfile.promise : { data: profile("b"), error: null } });
    const h = provider(db);
    try {
        await h.flush();
        const oldQuery = db.calls.find((call) => call.name === "profiles");
        const authCalls = db.calls.filter((call) => call.kind === "auth").length;
        accountId = "b";
        db.emit("SIGNED_IN", user("b"));
        assert.equal(h.tree.props.value.account, null);
        assert.equal(h.tree.props.value.profile, null);
        assert.equal(h.tree.props.value.usageReady, false);
        assert.equal(oldQuery.signal.aborted, true);
        assert.equal(db.calls.filter((call) => call.kind === "auth").length, authCalls);
        await h.advance(0);
        assert.equal(h.tree.props.value.account.id, "b");
        assert.equal(h.tree.props.value.profile.id, "b");
        oldProfile.resolve({ data: profile("a"), error: null });
        await h.flush();
        assert.equal(h.tree.props.value.profile.id, "b");
    } finally { h.restore(); }
});

test("provider initial pending auth A cannot overwrite auth-event B", async () => {
    const initialAuth = deferred();
    let first = true;
    const db = createSupabaseMock({ auth: () => { if (first) { first = false; return initialAuth.promise; } return authResult("b"); }, query: () => ({ data: profile("b"), error: null }) });
    const h = provider(db);
    try {
        await h.flush();
        db.emit("SIGNED_IN", user("b"));
        assert.equal(h.tree.props.value.account, null);
        await h.advance(0);
        assert.equal(h.tree.props.value.account.id, "b");
        initialAuth.resolve(authResult("a"));
        await h.flush();
        assert.equal(h.tree.props.value.account.id, "b");
        assert.equal(h.tree.props.value.profile.id, "b");
        assert.equal(db.calls.some((call) => call.filters?.id === "a" || call.args?.p_user_id === "a"), false);
    } finally { h.restore(); }
});

test("provider signout clears cached state immediately and keeps confirmed login gate", async () => {
    let accountId = "a";
    const redirects = [];
    const db = createSupabaseMock({ auth: () => authResult(accountId), query: () => ({ data: profile("a"), error: null }) });
    const h = provider(db, { replace: (url) => redirects.push(url) });
    try {
        await h.flush();
        accountId = null;
        db.emit("SIGNED_OUT", null);
        assert.equal(h.tree.props.value.account, null);
        assert.equal(h.tree.props.value.profile, null);
        assert.equal(h.tree.props.value.usageReady, false);
        assert.deepEqual(redirects, []);
        await h.advance(0);
        assert.deepEqual(redirects, ["/login?next=%2Fdashboard"]);
        h.unmount();
        assert.equal(db.listenerCount, 0);
        assert.equal(h.window.listenerCount("focus"), 0);
        assert.equal(h.document.listenerCount("visibilitychange"), 0);
    } finally { h.restore(); }
});

test("transient provider auth error does not clear session or claim authentication", async () => {
    const redirects = [];
    const db = createSupabaseMock({ auth: () => ({ data: { user: null }, error: { name: "AuthRetryableFetchError" } }) });
    const h = provider(db, { replace: (url) => redirects.push(url) });
    try {
        await h.flush();
        assert.equal(h.tree.props.value.account, null);
        assert.equal(h.tree.props.value.loading, false);
        assert.match(h.tree.props.value.error, /couldn’t be refreshed/);
        assert.deepEqual(redirects, []);
        assert.equal(db.calls.filter((call) => call.kind !== "auth").length, 0);
    } finally { h.restore(); }
});

test("library timeout clears skeleton, owner filtering remains and explicit retry succeeds", async () => {
    const stalled = deferred();
    let stall = true;
    const db = createSupabaseMock({ query: () => stall ? stalled.promise : { data: [job("b-video", "a")], error: null } });
    const context = { value: { account: user("a"), profile: profile("a"), loading: false, refreshProfile: async () => {} } };
    const h = page("page.tsx", db, context);
    try {
        await h.flush();
        assert.ok(h.nodes((node) => node.props?.label === "Loading videos").length);
        await h.advance(15_000);
        assert.equal(h.nodes((node) => node.props?.label === "Loading videos").length, 0);
        assert.match(h.text(), /Your videos couldn’t be loaded/);
        assert.equal(db.calls[0].filters.user_id, "a");
        assert.equal(db.calls[0].signal.aborted, true);
        stall = false;
        const retry = h.nodes((node) => node.type === "Notice")[0].props.action;
        retry.props.onClick();
        await h.flush();
        assert.match(h.text(), /b-video/);
        stalled.resolve({ data: [job("old-video", "a")], error: null });
        await h.flush();
        assert.doesNotMatch(h.text(), /old-video/);
    } finally { h.restore(); }
});

test("library ignores stale A result and obsolete realtime callback after B transition", async () => {
    const stalled = deferred();
    let refreshes = 0;
    const db = createSupabaseMock({ query: (call) => call.filters.user_id === "a" ? stalled.promise : { data: [job("b-video", "b")], error: null } });
    const context = { value: { account: user("a"), profile: profile("a"), loading: false, refreshProfile: async () => { refreshes++; } } };
    const h = page("page.tsx", db, context);
    try {
        await h.flush();
        const oldChannel = db.channels[0];
        const oldQuery = db.calls[0];
        context.value = { ...context.value, account: user("b"), profile: profile("b") };
        h.rerender();
        await h.flush();
        assert.equal(oldQuery.signal.aborted, true);
        assert.equal(oldChannel.removed, true);
        const count = db.calls.length;
        oldChannel.callbacks[0]();
        await h.flush();
        assert.equal(db.calls.length, count);
        assert.equal(refreshes, 0);
        stalled.resolve({ data: [job("a-video", "a")], error: null });
        await h.flush();
        assert.match(h.text(), /b-video/);
        assert.doesNotMatch(h.text(), /a-video/);
        h.unmount();
        assert.equal(db.channels[1].removed, true);
    } finally { h.restore(); }
});

test("payments timeout exits skeleton, permits retry and usage unavailable hides counters", async () => {
    const stalled = deferred();
    let stall = true;
    const db = createSupabaseMock({ query: () => stall ? stalled.promise : { data: [], error: null } });
    const context = { value: { account: user("a"), profile: profile("a"), loading: false, usageReady: false, error: null, refreshProfile: async () => {} } };
    const h = page("settings/page.tsx", db, context);
    try {
        h.window.location.search = "?tab=billing";
        h.window.dispatch("popstate");
        await h.advance(16);
        assert.ok(h.nodes((node) => node.props?.label === "Loading payment history").length);
        await h.advance(15_000);
        assert.equal(h.nodes((node) => node.props?.label === "Loading payment history").length, 0);
        assert.match(h.text(), /Payment history couldn’t be loaded/);
        assert.match(h.text(), /Usage temporarily unavailable/);
        assert.equal(h.nodes((node) => node.type === "UsageMeter").length, 0);
        assert.equal(db.calls[0].filters.user_id, "a");
        assert.equal(db.calls[0].signal.aborted, true);
        stall = false;
        const errorNotice = h.nodes((node) => node.type === "Notice" && String(node.props.children).includes("Payment history couldn’t"))[0];
        errorNotice.props.action.props.onClick();
        await h.flush();
        assert.equal(h.nodes((node) => node.type === "EmptyState" && node.props.title === "No payments yet").length, 1);
        stalled.resolve({ data: [{ id: "stale", plan: "pro", created_at: "2026-11-16", amount: 100, status: "captured" }], error: null });
        await h.flush();
        assert.equal(h.nodes((node) => node.type === "EmptyState" && node.props.title === "No payments yet").length, 1);
    } finally { h.restore(); }
});

test("payments cancel on tab change and ignore stale A results after B", async () => {
    const stalled = deferred();
    const db = createSupabaseMock({ query: (call) => call.filters.user_id === "a" ? stalled.promise : { data: [], error: null } });
    const context = { value: { account: user("a"), profile: profile("a"), loading: false, usageReady: true, error: null, refreshProfile: async () => {} } };
    const h = page("settings/page.tsx", db, context);
    try {
        h.window.location.search = "?tab=billing";
        h.window.dispatch("popstate");
        await h.advance(16);
        const oldQuery = db.calls[0];
        h.nodes((node) => node.props?.id === "settings-tab-profile")[0].props.onClick();
        await h.flush();
        assert.equal(oldQuery.signal.aborted, true);
        context.value = { ...context.value, account: user("b"), profile: profile("b") };
        h.rerender();
        h.nodes((node) => node.props?.id === "settings-tab-billing")[0].props.onClick();
        await h.advance(16);
        stalled.resolve({ data: [{ id: "stale", plan: "pro", created_at: "2026-11-16", amount: 100, status: "captured" }], error: null });
        await h.flush();
        assert.equal(h.nodes((node) => node.type === "EmptyState" && node.props.title === "No payments yet").length, 1);
        assert.equal(db.calls.at(-1).filters.user_id, "b");
    } finally { h.restore(); }
});
