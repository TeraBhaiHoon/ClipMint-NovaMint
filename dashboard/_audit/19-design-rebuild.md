# Audit 19 — Landing Design Rebuild (from scratch)

**Date:** 2026-09-20
**Scope:** `src/app/page.tsx`, `src/app/components/**`, `src/app/globals.css`,
`src/app/layout.tsx`, `public/showcase/`. Nothing else was touched —
`/pricing`, login, dashboard, api routes, `lib/*`, middleware, pipeline and
workflows are untouched (the shared CSS still serves them, see §Design system).

---

## 1. What was built (section by section)

The new `/` is a **server component** (client islands only where a browser
capability is required). Sections, top to bottom:

1. **Navbar** (`components/Navbar.tsx`, client) — floating glass-pill nav:
   custom `IconMark` glyph + Syne wordmark, mint period. Links anchor to
   landing sections (Showcase · Features · How it works · Pricing · FAQ).
   Session-aware CTA (Supabase) swaps to "Dashboard". Mobile drawer with
   staggered link entrance. Focus-visible rings, aria-expanded, aria-label.
2. **Hero** — layered depth: dot-field + two drifting radial glows (mint top
   right, warm marigold bottom left), staggered one-shot entrance (CSS,
   `hero-fade-up` + per-item delay), H1 *"Ek video. Das clips."* with the
   second line gradient-mint, honest sub copy, auth-aware primary CTA +
   ghost "See how it works", format microline. Right: rebuilt **PhonePreview**
   — a pure-CSS 9:16 frame with playful caption chips (spring pop-in that
   mirrors the render engine), spec chip "9:16 · 1080×1920", progress bar,
   timecode, breathing mint glow.
3. **Platform strip** — "Made for Reels, Shorts & TikTok" (capability claim,
   not an adoption claim) on a hairline band.
4. **THE SHOWCASE** (centerpiece) — `components/ShowcaseCarousel.tsx`
   (client). Horizontal carousel of finished 9:16 clips driven by
   `public/showcase/manifest.json`:
   - real `<video>` elements (muted, loop, playsInline, `preload="none"`),
     **autoplay on enter-viewport or hover**, pause + rewind on exit;
   - **drag-to-scroll** (pointer capture, snap disabled mid-drag),
     **arrow controls** (scroll by card width, smooth under normal motion),
     **scroll-snap points**, keyboard-focusable scroller;
   - **title + duration overlay** per card, plus a play/pause toggle button
     (aria-pressed) on real clips;
   - **empty slots** render generated poster art (layered gradients in four
     brand hues + big caption typography + a center play affordance + a
     dashed "slot" frame) — nothing ever looks broken;
   - `prefers-reduced-motion`: no autoplay, no drag animation; clips play
     only on explicit click.
5. **Under the hood** — an honest spec panel ("The spec, in the open"):
   Input 500MB/MP4·MOV·WebM + links · Output 9:16 1080×1920 @ −14 LUFS ·
   Modes (viral clips / whole-video captions) · Auto-editing (silence cuts +
   punch-ins) · Private R2 delivery · 5–15 min. All real product facts,
   mono-keyed editorial rows.
6. **How it works** — `components/HowItWorks.tsx` (client): three pipeline
   steps with a **scroll-drawn mint rail** (rAF + `scaleY`, nothing loops),
   stagger entrance, real copy (paste/drop → AI finds the moments →
   download & post).
7. **Caption styles** — "Captions that do the talking": CSS **marquee** of
   the nine style names (pauses on hover, killed by reduced motion),
   counters (9 / 1080×1920 / −14 LUFS — real figures only), and the
   nine-style registry grid.
8. **Feature bento** — `components/FeatureBento.tsx` (server): asymmetric
   7/5 · 4/4/4 · 12 grid, custom line icons, hover lifts + wakes a mint
   corner glow. Copy: AI moment detection, 9 styles, face-tracked output,
   −14 LUFS, multi-format, API (`POST /v1/clips`).
9. **Pricing** — derived **read-only from `PLAN_LIMITS`**
   (paise → ₹ via `toLocaleString("en-IN")`; clip/video limits interpolated
   from the same source so numbers can't drift). Free ₹0 / Creator ₹499 /
   Pro ₹899 / Agency ₹1,499, honest feature lists and CTAs, link out to
   `/pricing` for annual + comparison.
10. **FAQ** — `components/FaqAccordion.tsx` (client): the six honest Q&As
    kept verbatim from the previous build, buttery height animation via the
    CSS grid-rows trick (no measuring, no library), first item open,
    `aria-expanded`/`aria-controls`.
11. **Final CTA** — "Shuru karo. Free hai." glass panel with mint glow,
    auth-aware CTA.
12. **Footer** (`components/Footer.tsx`, server) — editorial columns
    (Product / Resources / Legal / Contact), wordmark, "Made in India"
    status dot, © NovaMint Networks.

**Honesty:** no users, revenue, testimonials or invented stats anywhere.
Only feature capabilities, format/limit numbers, plan prices from
`PLAN_LIMITS`, and the six truthful FAQ answers. The FAQ intro still states
the product has no users yet.

**Banned items avoided:** no cursor-following elements, no shimmer/skeleton
flash overlays (CTAs render their default immediately and swap silently when
auth resolves), no tint-overlay gimmicks.

---

## 2. Design system

### Brand (preserved)
Near-black ink with a green undertone, dark theme, electric mint **#39E508**
accent — the exact color the render engine paints captions with.

### Type — `layout.tsx` (next/font/google, self-hosted, no layout shift)
- **Display:** Syne (500–800) → `--font-display`, headings/wordmark/prices.
- **Body:** Inter (400/500/600) → `--font-body`.
- **Mono:** JetBrains Mono (400/500/700) → `--font-mono`, technical labels,
  timecodes, API chips, spec keys.

### Space & rhythm
- Section padding `py-24 sm:py-32`, max-width `1180px` (showcase) /
  `1152px` (sections), generous whitespace between blocks.
- Fluid scale: `--fs-hero clamp(44px,7vw,92px)`, `--fs-h2 clamp(30px,4.2vw,54px)`,
  body `clamp(15px,1.15vw,16px)`.

### Tokens (`globals.css :root`)
- Surfaces: `--bg-void / --bg-primary / --bg-raised / --bg-inset / --bg-sunken`,
  glass `rgba(11,18,13,.55)`.
- Hairlines: `--border-subtle .07 / --border-strong .16` over
  `rgba(227,234,226,…)`.
- Depth: `--grad-mint`, `--grad-text-mint`, `--radial-hero-a/b`, `--radial-card`,
  `--pattern-dots`, `--shadow-rest / card / lift / accent`, `--glow-mint`.
- Radii: cards 20px, insets 14px, pills 999px. Easing:
  `--ease-out-expo cubic-bezier(0.16,1,0.3,1)` + a single spring
  `cubic-bezier(0.34,1.56,0.64,1)` reserved for caption-chip pops (mirrors
  the render engine).
- Full ink / mint / marigold ramps kept (dashboard + pricing depend on them).

### Motion (performance-first)
- Scroll reveal = one IntersectionObserver toggling `.is-visible`; CSS
  animates `transform`/`opacity` only (`will-change` where it pays).
- Stagger = nth-child transition delays, no JS.
- Scroll progress = rAF-throttled `scaleX`.
- How-it-works rail = rAF `scaleY`.
- Marquee = CSS `translateX(-50%)` loop.
- **Every animation is killed or resolved to final state under
  `prefers-reduced-motion`** (global media query + component guards).

### Accessibility
Visible mint `:focus-visible` rings, aria-labels on nav/menu/carousel/
accordion/buttons, `aria-expanded`/`aria-controls`/`aria-pressed`,
`role="region"` on the scroller, alt-free decorative art marked
`aria-hidden`, keyboard-focusable carousel.

---

## 3. Showcase carousel contract

**Reader:** `src/app/components/ShowcaseCarousel.tsx` fetches
`/showcase/manifest.json` at runtime.

### Manifest schema
```json
{
  "_readme": "human instructions (also duplicated in public/showcase/README.md)",
  "clips": [
    {
      "src": "/showcase/clips/episode-04-hook.mp4",   // string | null — null = generated-poster placeholder
      "poster": "/showcase/posters/episode-04-hook.jpg", // string | null, optional — omit → generated gradient art
      "title": "Episode 04 — the hook",                // string, required
      "duration": "0:42",                              // string, required
      "style": "Hormozi",                              // optional — label on generated posters
      "hue": "mint"                                    // optional — "mint" | "marigold" | "emerald" | "slate"
    }
  ]
}
```

### How the owner adds real clips
1. Drop the finished clip (H.264/AAC, ~10–20s recommended) into
   `public/showcase/clips/`.
2. (Optional) drop a poster frame into `public/showcase/posters/`.
3. In `public/showcase/manifest.json`, replace a placeholder entry
   (`"src": null`) with the real `{ src, poster, title, duration }`.
4. Deploy. The card now plays on hover/enter-viewport, shows the overlay,
   keeps drag/arrows/snap.

**Graceful failure:** a missing/malformed manifest, a `null` src, or a
missing file all fall back to the generated gradient poster + play
affordance — the carousel never looks broken. The shipped manifest contains
six placeholder slots dressed in the four poster hues.

---

## 4. Files changed / added

| File | Status |
|---|---|
| `src/app/page.tsx` | rebuilt (server component) |
| `src/app/globals.css` | rewritten as the new design system + preserved app-compat layer |
| `src/app/layout.tsx` | fonts (Syne/Inter/JetBrains Mono) + refreshed metadata |
| `src/app/components/Navbar.tsx` | rewritten |
| `src/app/components/Footer.tsx` | rewritten |
| `src/app/components/HeroMotion.tsx` | rewritten (CSS entrance) |
| `src/app/components/PhonePreview.tsx` | rewritten |
| `src/app/components/HowItWorks.tsx` | rewritten |
| `src/app/components/FeatureBento.tsx` | rewritten |
| `src/app/components/FaqAccordion.tsx` | rewritten |
| `src/app/components/StyleMarquee.tsx` | rewritten |
| `src/app/components/CountUp.tsx` | rewritten (rAF, no framer-motion) |
| `src/app/components/ScrollProgress.tsx` | rewritten (rAF, no framer-motion) |
| `src/app/components/SectionReveal.tsx` | rewritten (IntersectionObserver) |
| `src/app/components/Icons.tsx` | **new** — custom inline SVG set (20 glyphs) |
| `src/app/components/ShowcaseCarousel.tsx` | **new** — manifest-driven carousel |
| `src/app/components/CtaButtons.tsx` | **new** — auth-aware CTA (no skeleton flash) |
| `src/app/components/SectionHeading.tsx` | **new** — shared editorial header |
| `public/showcase/manifest.json` | **new** — carousel contract + `_readme` |
| `public/showcase/README.md` | **new** — how to add clips |
| `public/showcase/clips/.gitkeep` | **new** |
| `public/showcase/posters/.gitkeep` | **new** |

**Dependency wins:** the landing no longer imports `framer-motion` or
`lucide-react` at all (verified by grep); all icons are hand-drawn inline
SVGs, all motion is CSS/IntersectionObserver/rAF.

**Compatibility:** every CSS class other pages rely on was preserved and
recolored to ink/mint (`.dash-*`, `.stat-*`, `.sidebar-*`, `.faq-*`,
`.glass-card`, `.gradient-text`, `.cm-*`, `.animate-*`, `.toast*`,
`.toggle-switch`, `.progress-bar*`, `.tab-*`, `.step-*`, `.plan-badge*`,
`.upgrade-card`, `.code-block`, `.breadcrumb`, `.donut-*`, grids, range
slider, inputs). `/pricing` (another agent's file) builds and styles
unchanged.

---

## 5. Verification

- `npx tsc --noEmit` → **passes** (0 errors).
- `npm run build` → **passes**. All 28 routes compile; `/` prerendered as
  static content. Only pre-existing warnings (middleware deprecation,
  lockfile root hint) — unrelated to this change.

---

## 6. What the owner must supply

1. **Real showcase clips** — the one content gap: 4–8 finished 9:16 MP4s
   (H.264/AAC, ~10–20s each) into `public/showcase/clips/`, optional
   posters into `public/showcase/posters/`, then update
   `public/showcase/manifest.json` (see §3; step-by-step in the folder's
   README.md). Until then the homepage shows the generated poster slots,
   which is intentional and looks finished.
2. **Annual plan prices** are already in `PLAN_LIMITS` and surfaced on
   `/pricing` (that page is out of scope); the landing shows monthly only.
3. Nothing else — no stock imagery, no logos, no third-party assets are
   required; fonts are self-hosted via next/font.
