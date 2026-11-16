import assert from "node:assert/strict";
import { test } from "node:test";
import { createComponentHarness, createSupabaseMock } from "./helpers/component-harness.mjs";

function createForm(usageReady) {
    const dashboard = { account: { id: "a", email: "a@example.test" }, profile: { id: "a", plan: "free", clips_used: 1, clips_reserved: 0, videos_used: 1 }, usageReady, refreshProfile: async () => {} };
    const supabase = createSupabaseMock();
    const harness = createComponentHarness("src/app/dashboard/new/page.tsx", { mocks: { "@/lib/supabase": { createClient: () => supabase.client }, "../_components/dashboard-provider": { useDashboard: () => dashboard } } });
    return { dashboard, supabase, harness };
}
const submit = (harness) => harness.nodes((node) => node.type === "Button" && node.props.type === "submit")[0];
const slider = (harness) => harness.nodes((node) => node.type === "input" && node.props.id === "max-clips")[0];
const addLink = (harness) => harness.nodes((node) => node.type === "input" && node.props.id === "video-url")[0].props.onChange({ target: { value: "https://youtu.be/example" } });

test("new form: unavailable usage cannot start uploads or atomic admission", async () => {
    const oldFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = () => { fetches++; throw new Error("No network allowed"); };
    const { harness, supabase } = createForm(false);
    try {
        await harness.advance(16);
        addLink(harness);
        assert.equal(submit(harness).props.disabled, true);
        assert.equal(slider(harness).props.disabled, true);
        await harness.nodes((node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
        await harness.flush();
        assert.equal(fetches, 0);
        assert.equal(supabase.calls.length, 0);
        assert.match(harness.text(), /usage is temporarily unavailable/i);
        assert.doesNotMatch(harness.text(), /Clips available 4/);
    } finally { harness.restore(); globalThis.fetch = oldFetch; }
});

test("new form: fresh usage controls allowance and becomes disabled on refresh failure", async () => {
    const { harness, dashboard } = createForm(true);
    try {
        await harness.advance(16);
        addLink(harness);
        assert.equal(submit(harness).props.disabled, false);
        assert.equal(slider(harness).props.disabled, false);
        assert.equal(slider(harness).props.value, 4);
        assert.match(harness.text(), /Clips available 4/);
        dashboard.usageReady = false;
        harness.rerender();
        assert.equal(submit(harness).props.disabled, true);
        assert.equal(slider(harness).props.disabled, true);
        assert.match(harness.text(), /Temporarily unavailable/);
    } finally { harness.restore(); }
});

test("new form: exhausted allowance disables both short clips and full-video submission", async () => {
    const { harness, dashboard } = createForm(true);
    try {
        dashboard.profile.clips_used = 5;
        harness.rerender();
        addLink(harness);
        assert.equal(submit(harness).props.disabled, true);
        assert.equal(slider(harness).props.disabled, true);
        harness.nodes((node) => node.type === "Choice" && node.props.title === "Full video captions")[0].props.onClick();
        assert.equal(submit(harness).props.disabled, true);
        assert.match(harness.text(), /Settings are saved when you create/);
        assert.match(harness.text(), /Unsaved choices reset when you leave/);
    } finally { harness.restore(); }
});
