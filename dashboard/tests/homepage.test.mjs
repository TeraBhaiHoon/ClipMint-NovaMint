import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("src/app/page.tsx");
const css = read("src/app/home.css");
const navigation = read("src/app/components/HomeNavigation.tsx");
const preview = read("src/app/components/HomePreview.tsx");

test("homepage is structurally redesigned rather than a color-only patch", () => {
    for (const section of ["home-hero-grid", "home-output-grid", "home-feature-layout", "home-styles-layout", "home-plans", "home-faq-layout", "home-footer-main"]) assert.ok(page.includes(section));
    assert.doesNotMatch(page, /ShowcaseCarousel|PhonePreview|Your clip lands here|no users yet/);
    assert.match(page, /data-zcode-design/);
    assert.match(page, /CaptionStudioPreview/);
    assert.match(page, /HomeDemoVideo/);
});

test("navigation anchors all resolve to homepage sections", () => {
    const ids = new Set([...page.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
    for (const href of [...navigation.matchAll(/href: "#([^"]+)"/g)].map((match) => match[1])) assert.ok(ids.has(href), `Missing section ${href}`);
    assert.ok(ids.has("home-content"));
});

test("homepage pricing remains sourced from plan limits with clear purchase terms", () => {
    assert.match(page, /PLAN_LIMITS\[key\]/);
    assert.match(page, /plan\.monthlyPrice \/ 100/);
    assert.match(page, /per 30-day pass/);
    assert.match(page, /no automatic renewal/);
    assert.doesNotMatch(page, /Start free trial|billed monthly|Unlimited clips|Team accounts|White-label/);
});

test("demo uses existing real media and labels the silent licensed example", () => {
    assert.ok(existsSync(new URL("../public/showcase/clips/sintel-demo.mp4", import.meta.url)));
    assert.match(preview, /controls playsInline preload="none"/);
    assert.match(preview, /Silent demo/);
    assert.match(preview, /CC-BY 3\.0/);
    assert.doesNotMatch(preview, /autoPlay|sintel-demo\.vtt/);
    assert.match(preview, /onPlay=/);
    assert.match(preview, /onPause=/);
});

test("interactive caption sample has three keyboard-addressable choices", () => {
    assert.match(preview, /hormozi/);
    assert.match(preview, /minimal/);
    assert.match(preview, /typewriter/);
    assert.match(preview, /aria-pressed=\{style === item.key\}/);
    assert.match(preview, /Sample text/);
    assert.match(page, /not a customer result/);
});

test("mobile menu uses native dialog focus and escape handling", () => {
    assert.match(navigation, /element\.showModal\(\)/);
    assert.match(navigation, /onCancel=/);
    assert.match(navigation, /trigger\?\.focus\(\)/);
    assert.match(css, /\.home-mobile-menu:not\(\[open\]\) \{ display: none; \}/);
});

test("responsive styling stays scoped and avoids old overflow-hiding workarounds", () => {
    assert.match(css, /@media \(max-width: 900px\)/);
    assert.match(css, /@media \(max-width: 639px\)/);
    assert.match(css, /@media \(max-width: 359px\)/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.doesNotMatch(css, /\.studio-|transition:\s*all|font-size:\s*9px/);
    assert.doesNotMatch(page, /overflow-x-clip/);
});

function luminance(hex) {
    const channels = hex.match(/[a-f\d]{2}/gi).map((part) => parseInt(part, 16) / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(a, b) {
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (values[0] + .05) / (values[1] + .05);
}
test("core homepage text and primary CTA color pairs pass normal-text contrast", () => {
    for (const pair of [["183023", "fafbf7"], ["536455", "fafbf7"], ["276139", "fafbf7"], ["18330d", "39e508"], ["416034", "d1e4ba"]]) assert.ok(contrast(...pair) >= 4.5, `Low contrast ${pair}`);
});
