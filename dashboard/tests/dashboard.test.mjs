import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Transpile the pure helpers with the existing TypeScript dependency.
const source = readFileSync(new URL("../src/lib/dashboard.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const compiledModule = { exports: {} };
new Function("module", "exports", compiled)(compiledModule, compiledModule.exports);
const helpers = compiledModule.exports;
const file = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("usage percentages are safe for zero, invalid and over-limit counters", () => {
    assert.equal(helpers.boundedPercent(4, 5), 80);
    assert.equal(helpers.boundedPercent(56, 5), 100);
    assert.equal(helpers.boundedPercent(-2), 0);
    assert.equal(helpers.boundedPercent(null), 0);
    assert.equal(helpers.boundedPercent(NaN), 0);
    assert.equal(helpers.boundedPercent(Infinity), 0);
    assert.equal(helpers.boundedPercent(3, 0), 0);
});

test("titles prefer platform title, filename, link and finally project identifier", () => {
    const job = { source_title: " Podcast title ", video_filename: "podcast.mp4", video_url: "https://youtube.com/watch?v=x", id: "12345678-abcd" };
    assert.equal(helpers.videoTitle(job), "Podcast title");
    assert.equal(helpers.videoTitle({ ...job, source_title: " " }), "podcast.mp4");
    assert.equal(helpers.videoTitle({ ...job, source_title: null, video_filename: null }), job.video_url);
    assert.equal(helpers.videoTitle({ ...job, source_title: null, video_filename: null, video_url: null }), "Video 12345678");
});

test("source labels do not mistake lookalike domains for YouTube", () => {
    assert.equal(helpers.sourceLabel({ source_type: "url", video_url: "https://www.youtube.com/watch?v=x" }), "YouTube");
    assert.equal(helpers.sourceLabel({ source_type: "url", video_url: "https://notyoutube.com/video" }), "notyoutube.com");
    assert.equal(helpers.sourceLabel({ source_type: "upload", video_url: null }), "Uploaded video");
    assert.equal(helpers.sourceLabel({ source_type: "drive", video_url: null }), "Google Drive");
});

test("clip duration falls back to valid timestamps and formats consistently", () => {
    assert.equal(helpers.clipSeconds({ duration_seconds: 34, start_time: 1, end_time: 8 }), 34);
    assert.equal(helpers.clipSeconds({ duration_seconds: null, start_time: 10, end_time: 43 }), 33);
    assert.equal(helpers.clipSeconds({ duration_seconds: 0, start_time: 40, end_time: 10 }), null);
    assert.equal(helpers.formatDuration(34), "0:34");
    assert.equal(helpers.formatDuration(3661), "1:01:01");
    assert.equal(helpers.formatDuration(null), "—");
});

test("caption copy never includes null or undefined placeholders", () => {
    assert.equal(helpers.captionText({ title: "A moment", hook_caption: null, hashtags: null }), "A moment");
    assert.equal(helpers.captionText({ title: null, hook_caption: "The hook", hashtags: ["#creator", "#clips"] }), "The hook\n\n#creator #clips");
    assert.equal(helpers.captionText({ title: null, hook_caption: null, hashtags: null }), "");
});

test("selected day ranges include today and exactly the requested number of days", () => {
    const now = new Date(2026, 10, 15, 22, 30);
    const start = helpers.periodStart(7, now);
    assert.equal(start.getDate(), 9);
    assert.equal(start.getHours(), 0);
    const days = helpers.dailyCounts([{ created_at: new Date(2026, 10, 15, 18).toISOString() }, { created_at: new Date(2026, 10, 15, 19).toISOString() }, { created_at: new Date(2026, 10, 8, 19).toISOString() }], 7, now);
    assert.equal(days.length, 7);
    assert.equal(days[0].key, "2026-11-09");
    assert.equal(days[6].key, "2026-11-15");
    assert.equal(days[6].count, 2);
    assert.equal(days.reduce((sum, day) => sum + day.count, 0), 2);
});

test("caption preference is isolated per account and tolerates denied storage", () => {
    assert.notEqual(helpers.captionPreferenceKey("a"), helpers.captionPreferenceKey("b"));
    globalThis.localStorage = { getItem: (key) => key.endsWith(":caption-style") ? "bounce" : null };
    assert.equal(helpers.readCaptionPreference("a"), "bounce");
    globalThis.localStorage = { getItem: () => { throw new Error("Blocked"); } };
    assert.equal(helpers.readCaptionPreference("a"), "hormozi");
    delete globalThis.localStorage;
});

test("all six pages use the shared header and no legacy floating-card layout", () => {
    for (const path of ["page.tsx", "new/page.tsx", "analytics/page.tsx", "api-keys/page.tsx", "settings/page.tsx", "[jobId]/page.tsx"]) {
        const page = file(`src/app/dashboard/${path}`);
        assert.match(page, /PageHeader/);
        assert.doesNotMatch(page, /glass-card|text-\[9px\]|text-\[10px\]|JOB_STATUS_LABELS|👋/);
    }
});

test("dialog uses the native modal top layer with escape handling and focus restoration", () => {
    const ui = file("src/app/dashboard/_components/ui.tsx");
    assert.match(ui, /dialog\.showModal\(\)/);
    assert.match(ui, /onCancel=/);
    assert.match(ui, /focused\?\.isConnected/);
    assert.match(ui, /aria-labelledby=\{titleId\}/);
    assert.match(file("src/app/dashboard/dashboard.css"), /\.studio-dialog:not\(\[open\]\) \{ display: none; \}/);
});

test("responsive layouts and reduced-motion overrides are part of the source", () => {
    const css = file("src/app/dashboard/dashboard.css");
    assert.match(css, /@media \(max-width: 1023px\)/);
    assert.match(css, /@media \(max-width: 767px\)/);
    assert.match(css, /@media \(max-width: 359px\)/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /env\(safe-area-inset-bottom\)/);
    assert.doesNotMatch(css, /transition:\s*all/);
    assert.match(css, /stroke-width: 1\.75/);
});

test("job creation uses atomic server admission without browser quota mutations", () => {
    const page = file("src/app/dashboard/new/page.tsx");
    assert.match(page, /fetch\("\/api\/jobs"/);
    assert.match(page, /!hasSource \|\| submitting\.current \|\| createdJobId/);
    assert.doesNotMatch(page, /rpc\("(?:increment|refund)_videos_used"|from\("jobs"\)\.insert/);
    assert.ok(page.indexOf("bgmFile.size > 25") < page.indexOf('fetch("/api/jobs"'));
});

test("retry delegates admission and status changes to the server", () => {
    const page = file("src/app/dashboard/[jobId]/page.tsx");
    assert.match(page, /resume: resumeRetry && !!job.checkpoint_url/);
    assert.doesNotMatch(page, /from\("jobs"\)\.update/);
    assert.match(page, /disabled=\{running\}/);
});

test("account deletion is honest and does not pretend sign-out deletes data", () => {
    const settings = file("src/app/dashboard/settings/page.tsx");
    assert.doesNotMatch(settings, /handleDeleteAccount|deleteInput|auth\.signOut/);
    assert.match(settings, /Account removal is handled through support/);
    assert.match(settings, /localStorage\.setItem\(captionPreferenceKey/);
});
