# 09 — ClipMint Brand Identity & Design System Spec

Date: 2026-09-18 · Scope: marketing site + dashboard reskin (skin only, no function changes)
Owner constraints (non-negotiable, restated): NO cursor-following effects · NO shimmer/scanline · NO color-tint overlays on images/video · each product gets its own researched identity · premium not playful-gimmicky · Indian creator market, tasteful Hinglish welcome · no invented traction numbers (product has no users yet).

---

## 1. Brand essence

**"One long video in, caption-ready clips out — cut fresh, finished like a studio."**

The name does the branding work: Clip (the cut) + Mint (freshness + minting new assets). Mint green is not a random accent — it is literally the color the render engine paints the captions with. The UI should match the output. That is the whole identity thesis: **the product's own frames are the brand.**

### Voice rules
1. **State, don't hype.** Say what it does ("AI finds the moments worth posting"), never what it might do ("10x your reach", "magic", "go viral instantly" are banned).
2. **Real numbers only.** No user counts, no "50K+ clips", no testimonials from people who don't exist. Replace social proof with honesty: "Free plan. No credit card. Watermark-free on paid."
3. **Hinglish is seasoning, not sauce.** Max one Hinglish phrase per section, placed in eyebrows/CTAs ("Ek video. Das clips. Bas." / "Shuru karo — free hai"). Feature specs stay clean English.
4. **Creator-to-creator register.** Talk about *their* podcast, *their* vlog, *their* lecture, and the platforms they actually post to (Reels, Shorts, TikTok).
5. **Honesty as a feature.** Formats, limits, watermark policy and refund window are stated up front, in the open. Trust is the differentiator at zero-users stage.

---

## 2. Logo analysis (sampled from `ClipMint Logo.jpg`)

The mark is a **"CM" monogram in the purple/plum family**, faceted geometric letterforms, the C's terminal wrapping toward the M, soft drop shadow, on textured charcoal.

Sampled colors (approximate, from the JPG):
| Sample | Hex |
|---|---|
| Background charcoal (textured) | `#201E22` (variance `#1B191D`–`#262429`) |
| Letterform highlight (light lilac-pink) | `#C09CC0` |
| Mid mauve | `#8A6A96` |
| Deep plum / aubergine shadow | `#42304D` (darkest crevices `#312238`) |

**Conflict to resolve:** the logo is purple; the render engine accent is mint `#39E508`; the owner directs the token system around mint. Resolution:
- **Mint is the accent** — it matches the actual product output (animated captions), which is the only defensible source of brand color.
- **The charcoal background is kept** as the base family (see "ink" ramp — tinted, not gray).
- **The purple/plum family is retired from UI.** Do not port it into tokens. Display the existing logo in monochrome (white or ink-50) inside the app, or commission a mint re-render of the mark. Do not build a mint-vs-purple two-accent system — that re-creates the "AI generic" problem being fixed.

---

## 3. Competitive visual language (ground truth, extracted from live CSS/HTML)

| Product | Palette | Type | Notes |
|---|---|---|---|
| **Opus Pro** (opus.pro) | dark `#0E1015`, accent violet `#6723FF` / deep `#3600AE` | Gilroy (display) + Geist / Geist Mono | dark SaaS, violet glow |
| **Submagic** (submagic.co) | accent **orange-red `#FF4F01`** (110 hits in page HTML), dark `#212224`/`#242424`, light sections `#FAFAFA` | Archivo (display) + Inter | orange is their entire identity |
| **Vizard** (vizard.ai) | light theme, Google blue `#1A73E8` + purple `#6646C4`/`#926CD6` | Google Sans / Roboto | Google-adjacent, utilitarian |
| **Klap** (klap.app) | slate darks `#020617`/`#0F172A`/`#111827`, blue `#3B82F6`/`#2563EB` | Poppins | Tailwind-default slate look |

**What they ALL do (the cliché to avoid):** dark slate/charcoal base + one saturated accent (violet or orange or blue) + Inter-family or geometric-grotesque display (Gilroy/Archivo/Poppins/Geist) + badge → "viral clips with AI" hero → trust bar → 3-step how-it-works → feature grid → stat-heavy testimonials → FAQ → mega footer. Identical skeletons; only the accent hue differs.

**The gaps (our territory):**
1. **No one owns green/mint** in this category — Submagic took orange, Opus violet, Vizard/Klap blue. Mint is open *and* literally matches ClipMint's render output.
2. No one shows **raw product frames as the hero** — everyone ships stylized mockups. Real rendered clips (with their real mint captions) in a 9:16 frame is both honest and visually unclaimed.
3. No one has an **Indian-creator voice** (Hinglish microcopy, ₹-first pricing is already there — lean in).

---

## 4. Color token system

Base is a **mint-tinted charcoal ("ink")** — has a green cast, deliberately not gray-slate (Klap already owns Tailwind slate). Secondary is **marigold amber** — warm counterpoint to mint, culturally resonant, and distinct from Submagic's red-orange (`#FF4F01`). Usage ratio: 90% ink family / ~8% mint / ~2% marigold. Marigold appears ONLY as: annual-save badge, "viral/hot" tags, warning states, one highlighted word per page max.

### Ink (base) — 50–950
```
50:#F3F7F2  100:#E3EAE2  200:#C7D3C7  300:#A3B2A5  400:#7C8D80
500:#5C6E61 600:#46574B  700:#333F36  800:#1F2921  850:#141C16
900:#0C130E 950:#060B07
```
(`850` is a custom stop for card surfaces.)

### Mint (accent) — 50–950, anchored on render-engine `#39E508`
```
50:#F4FEE9  100:#E6FDCB  200:#CDFB9F  300:#ADF368  400:#7BEC2D
500:#39E508 600:#2DC204  700:#259D07  800:#217D0C  900:#1D6610
950:#0A3706
```

### Marigold (secondary) — 50–950
```
50:#FFF9EB  100:#FFF0C9  200:#FFE08F  300:#FFCD55  400:#FFB92B
500:#F5A300 600:#CC8300  700:#A36600  800:#7A4C02  900:#5C3906
950:#332000
```

### Semantics
- success: mint-600 (light surfaces) / mint-400 (dark)
- warning: marigold-500 · danger: `#EF4444` (keep, neutral red)
- info: ink-300 (deliberately no blue — Klap/Vizard own blue here)

### Surfaces / elevation / borders
```
--surface-page:   ink-950 #060B07
--surface-raised: ink-900 #0C130E
--surface-card:   ink-850 #141C16
--surface-card-hover: ink-800 #1F2921
--surface-inset:  #090F0A
--border-subtle:  rgba(227,234,226,0.07)
--border-strong:  rgba(227,234,226,0.14)
--ring-focus:     rgba(57,229,8,0.40)
--shadow-rest:   0 1px 2px rgba(0,0,0,.5), 0 8px 24px rgba(0,0,0,.35)
--shadow-lift:   0 12px 32px rgba(0,0,0,.45), 0 0 0 1px rgba(57,229,8,.08)
--shadow-accent: 0 8px 32px rgba(57,229,8,.14)
radius: sm 8 / md 12 / lg 16 / xl 24 / pill 999
spacing scale: 4-base (4,8,12,16,24,32,48,64,96,128)
```

**Contrast rules (checked):** `#39E508` on `#060B07` ≈ 11.6:1 → mint is fine as accent text/graphics on dark. **Black-on-mint ≈ 12.4:1, white-on-mint ≈ 1.7:1 → primary buttons MUST be mint bg + ink-950 text, never white text.** Body text: ink-50 `#F3F7F2` primary; ink-300 `#A3B2A5` secondary; ink-500 muted. No pure white `#FFF`, no slate `#94A3B8`.

---

## 5. Typography

**Display: Bricolage Grotesque.** A quirky-premium grotesque with an optical-size axis; reads editorial-confident, not gimmicky, and is used by none of the four competitors (Gilroy/Archivo/Poppins/Geist are all taken — using any of them would import their look). Space Grotesk was rejected: it has become the default "AI tool headline" face — exactly the generic trap. Unbounded rejected: decorative-only. Outfit (current) rejected: interchangeable.
**Body/UI: Figtree.** Closest Google-font analog to Satoshi — warm humanist-geometric, excellent at 13–16px UI sizes, pairs naturally with Bricolage. Plus Jakarta Sans rejected (overused in 2025-era SaaS), DM Sans acceptable fallback.
**Mono: Fira Code** (keep — API keys, code blocks).

### next/font setup (replaces the `<link>` tags in `layout.tsx`)
```ts
// layout.tsx
import { Bricolage_Grotesque, Figtree, Fira_Code } from "next/font/google";

export const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});
export const body = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});
export const mono = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});
// <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
```

### Usage rules
| Role | Face | Weight | Size | Tracking | Notes |
|---|---|---|---|---|---|
| Hero H1 | Bricolage | 700 | clamp(44px, 6vw, 76px) | −0.03em | line-height 1.02 |
| Section H2 | Bricolage | 700 | clamp(32px, 4.5vw, 52px) | −0.02em | lh 1.08 |
| Card H3 | Bricolage | 600 | 20–24px | −0.01em | |
| Price | Bricolage | 700 | 36–44px | −0.02em | ₹ amounts |
| Eyebrow/label | Figtree | 600 | 11–12px | +0.14em | uppercase, mint-300 or ink-300 |
| Body / UI | Figtree | 400/500 | 15–16px | normal | lh 1.6 |
| Small / meta | Figtree | 500 | 13px | normal | lh 1.5 |
| Code / API keys | Fira Code | 400 | 13px | 0 | |

Rule: **Bricolage never below 18px, Figtree never above 24px.** One gradient-free headline treatment: solid ink-50 with a single mint-400 highlighted word or phrase — no purple-to-cyan gradient text anywhere.

---

## 6. Motion spec (package: `motion`, imports from `motion/react`)

### Tokens
```ts
export const spring = {
  snappy:  { type: "spring", stiffness: 420, damping: 32, mass: 0.9 }, // buttons, toggles, layoutId tab indicator, drag-handle settle
  smooth:  { type: "spring", stiffness: 170, damping: 26, mass: 1   }, // reveals, accordion height, counters
  playful: { type: "spring", stiffness: 550, damping: 20            }, // ONLY inside caption-style previews (mirrors product output)
} as const;

export const duration = { fast: 0.15, base: 0.25, slow: 0.5 } as const;
export const ease = { outExpo: [0.16, 1, 0.3, 1], standard: [0.4, 0, 0.2, 1] } as const;
export const stagger = { children: 0.07, delayChildren: 0.1 } as const;
```

### What animates (marketing site only)
- **Hero:** one-shot staggered reveal (badge → H1 → sub → CTAs → player), y:24→0 + opacity, 0.5s outExpo, `once: true`. Nothing loops.
- **Scroll progress:** 2px mint bar, `useScroll` → scaleX, top of viewport.
- **How-it-works connector:** vertical line scaleY tied to section scroll progress.
- **View reveals:** `whileInView` one-shot, `viewport={{ once: true, margin: "-80px" }}`.
- **Caption-style gallery:** infinite marquee of 9 style chips (CSS animation, 40s linear, pause on hover, killed by `prefers-reduced-motion`). This is the one loop, and it demos the product.
- **Before/after slider:** user-dragged handle with `spring.snappy` settle on release. The wipe NEVER animates by itself.
- **Counters:** only real figures — 9 caption styles, ₹499, "under 20 min". `spring.smooth` count-up on first view. No invented totals.
- **Tabs/FAQ:** `layoutId` underline slide; AnimatePresence height:auto accordion.

### What NEVER animates
- **All forms** — no placeholder motion, no shake; submit errors = border+color change only.
- **Dashboard** — zero entrance animations on stat cards/tables/numbers, no pulse-glow, no hover-translate on data cards. Loading = **opacity-pulse skeleton** (not shimmer).
- **Sidebar/nav** transitions, **checkout buttons** (spinner only), anything while a user waits on the result.
- Hover model: marketing cards lift −2px with border→mint-500/30 + `--shadow-lift` (200ms CSS). Dashboard cards change border color only.

### Hard bans (owner) + substitutes that keep the page alive
| Banned | Substitute |
|---|---|
| cursor-following / magnetic / spotlight | hover lift + border-color shift; `layoutId` indicators |
| shimmer / scanline (incl. `.btn-primary::after` sheen, shimmer skeletons) | opacity-pulse skeletons; buttons brighten via `filter: brightness(1.06)` — no moving highlights |
| color-tint overlays on images/video | raw media in a 1px mint-500/40-bordered 9:16 frame on `--surface-inset`, letterboxed — the frame is the treatment |
| gradient-mesh floating orbs, pulse-glow | static 1px grid at 2% opacity, or clean empty ink |
| conic/animated gradient borders | static border on the highlighted pricing card + `--shadow-accent` |

---

## 7. Icon registry — verified picks (`lucide-animated.com/r/{name}.json`)

**Verified 200 (valid registry JSON, shadcn-style, depends on `motion/react`) — 34 names:**
`sparkles, play, zap, languages, rocket, palette, layers, mic, check, arrow-right, upload, download, clock, flame, workflow, brain, audio-lines, gauge, shield-check, earth, activity, trending-up, cpu, bot, timer, loader, settings, key, chart-line, users, maximize, link, youtube, instagram, twitter, linkedin`

**Confirmed 404 (17 probed + 9 capitalized variants):**
`scissors, clapperboard, wand, wand-2, wand-sparkles, captions, captions-on, film, globe, shield, star, gem, monitor-play, share-2, type, video, cut, movie, crown, diamond, target, music, camera, monitor, smartphone, tiktok, quote, text` (capitalized `Scissors/Clapperboard/Film/Star/Wand/Gem/Shield/Globe/Captions` also 404)

### Mapping for the missing concepts
| Concept | Use instead |
|---|---|
| clip/cut (scissors ✗) | `zap` (processing), `flame` (viral moment) |
| captions/subtitles ✗ | `languages` + `audio-lines` |
| film/video ✗ | `play` (hero/preview), `upload` (new video) |
| multi-platform (globe ✗) | `earth` |
| security (shield ✗) | `shield-check` |
| AI magic (wand ✗) | `sparkles` or `brain` |
| ratings (star ✗) | **plain static `lucide-react` Star** — ratings should never animate anyway |

Usage rules: registry (animated) icons only in marketing sections — max ONE animated icon per section, animate on in-view once. Dashboard chrome and small inline icons use static `lucide-react`. Fallback for any registry failure: same-name static lucide-react icon.

---

## 8. 21st.dev — verified search queries

Proven live (metadata confirmed on 2026-09-18):
| Query | Verified result |
|---|---|
| `hero section with video preview and badge` | Hero Scroll Video Pin Reveal (GSAP — re-implement with `motion`), Hero Section w/ staggered reveal |
| `pricing section with monthly annual toggle` | Pricing Section with Frequency Toggle (3-tier, animated prices) |
| `bento grid feature showcase` | Bento Grid, bento grid 01 (animated) |
| `FAQ accordion` | spring-animated accessible Accordion |
| `logo cloud marquee brands strip` | Logo Cloud Marquee (edge fade + pause-on-hover) |
| `testimonial cards wall grid` | Staggered Testimonials Grid |

Additional queries for the implementer to run:
`before after image comparison slider drag` · `footer with columns and newsletter` · `phone mockup 9:16 video player` · `number counter stat section` · `sticky navbar with blur` · `feature card grid with icons` · `step indicator timeline vertical`

Note: get_component is paid — retrieve only the chosen ones. Every retrieved component must be re-skinned to ink/mint tokens before landing.

---

## 9. Landing page blueprint (section order + copy voice)

**Honesty migration first:** delete "Trusted by 500+ content creators worldwide", the "50K+ Clips Generated" stat, and all three fabricated testimonials (Priya/Rahul/Ananya). Nothing replaces invented proof; honesty IS the launch-phase proof.

1. **Nav** — sticky, ink-950/80 backdrop-blur, wordmark in Bricolage + mint dot. Links: Features, Pricing, FAQ.
2. **Hero** — eyebrow badge "Now in open beta · Free plan, no card" → H1: **"Ek video. Das clips."** with second line in ink-50: "Cut, captioned, platform-ready." → sub (Figtree 18px): "Upload a podcast, vlog or lecture. ClipMint finds the moments worth posting and adds animated captions that look studio-made — in minutes." → CTA pair: mint primary "Start free — no card" + ghost "See how it works". Below: **real before/after pair** — source long-form frame vs actual rendered 9:16 clip with its real mint captions, in bordered frames. NO tint overlays. Trust microline: "MP4 · MOV · WebM · up to 500MB · YouTube/Instagram/Drive links".
3. **Platform strip** — "Made for Reels, Shorts & TikTok" + platform wordmarks, static, ink-300. (Honest: capability claim, not adoption claim.)
4. **How it works** — 3 steps with registry icons (`upload` → `brain`/`zap` → `download`), scroll-drawn connector: "Paste or drop your video" / "AI finds the moments" / "Download & post". Copy states the pipeline plainly (transcribe → score → clip → render captions).
5. **Caption-style gallery** — marquee of the 9 style chips, each a real mini preview (Remotion export or screen recording). Headline: "Captions that do the talking."
6. **Feature bento** — 6 cells, mixed sizes: AI moment detection (`brain`), 9 caption styles (`languages`), batch queue (`layers`/`workflow`), multi-platform output (`earth`), API access (`key`), usage analytics (`chart-line`). Real limits stated per plan.
7. **Before/after slider** — draggable raw-frame vs minted-clip comparison, `spring.snappy` handle. The single most persuasive module; use a genuinely representative clip.
8. **Pricing** — keep existing 4-plan structure + monthly/annual toggle + comparison table (function unchanged). ₹-first, annual badge in marigold-400 "Save 20%". Highlighted Creator card: static mint border + `--shadow-accent`.
9. **FAQ** — existing 7 questions + "Do I need a credit card?" expanded to 8. AnimatePresence accordion.
10. **Final CTA** — ink-850 panel, 1px mint-500/30 border: H2 "Shuru karo. Free hai." + sub "5 clips a month, free forever. Upgrade when it earns its keep." + mint button.
11. **Footer** — 4 columns (Product / Resources / Legal / Contact), monochrome logo, "Made in India" microbadge.

---

## 10. Dashboard-shell restyle (skin only — structure, routes, logic untouched)

- **Sidebar:** bg ink-900; active item = mint-500/12% bg, mint-300 icon, ink-50 text, 1px mint-500/20 border. Remove all `#8b5cf6` hardcodes. Donut meter fill: mint-500 normally, **marigold-400 ≥70%**, danger red ≥90%. Keep collapse behavior, donut math, plan badges (recolor: free=ink, creator=mint, pro=marigold, agency=ink-300).
- **Cards/tables:** kill `.glass-card` backdrop-blur + `::before` sheen → solid ink-850, 1px `--border-subtle`; row hover ink-800; header text ink-300, 11px uppercase +0.14em. Data cards: border-color change on hover only, no translate.
- **Buttons:** primary = mint-500 bg + **ink-950 text** (contrast rule above), hover mint-400; remove `::after` shimmer. Secondary = ink-800 bg + strong border.
- **Step progress, tabs, toasts, inputs:** keep structure; recolor accents to mint; `.input-field` focus ring = `--ring-focus`; toast success = mint-600 family.
- **Skeletons:** opacity-pulse on ink-800, shimmer keyframes deleted.
- **Delete from globals.css:** `gradient-mesh` + float/pulse-glow/shimmer keyframes, `.gradient-text` purple gradients, purple grid lines, glass shadows, all `rgba(139,92,246,*)` remnants.

---

## 11. Tailwind theme snippet (ready to paste)

The project is **Tailwind v4** (`@import "tailwindcss"` + `@theme` in globals.css), so the primary mechanism is `@theme`/CSS variables — no tailwind.config needed. (For any v3-style plugin config, mirror the same tokens.)

```css
/* ─── ClipMint Identity Tokens (mint/ink) ─── */
:root {
  /* ink base — mint-tinted charcoal */
  --ink-50:#F3F7F2;  --ink-100:#E3EAE2; --ink-200:#C7D3C7; --ink-300:#A3B2A5;
  --ink-400:#7C8D80; --ink-500:#5C6E61; --ink-600:#46574B; --ink-700:#333F36;
  --ink-800:#1F2921; --ink-850:#141C16; --ink-900:#0C130E; --ink-950:#060B07;
  /* mint accent — render-engine #39E508 */
  --mint-50:#F4FEE9;  --mint-100:#E6FDCB; --mint-200:#CDFB9F; --mint-300:#ADF368;
  --mint-400:#7BEC2D; --mint-500:#39E508; --mint-600:#2DC204; --mint-700:#259D07;
  --mint-800:#217D0C; --mint-900:#1D6610; --mint-950:#0A3706;
  /* marigold secondary */
  --marigold-50:#FFF9EB;  --marigold-100:#FFF0C9; --marigold-200:#FFE08F;
  --marigold-300:#FFCD55; --marigold-400:#FFB92B; --marigold-500:#F5A300;
  --marigold-600:#CC8300; --marigold-700:#A36600; --marigold-800:#7A4C02;
  --marigold-900:#5C3906; --marigold-950:#332000;
  /* surfaces */
  --surface-page:#060B07; --surface-raised:#0C130E; --surface-card:#141C16;
  --surface-card-hover:#1F2921; --surface-inset:#090F0A;
  --border-subtle:rgba(227,234,226,.07); --border-strong:rgba(227,234,226,.14);
  --ring-focus:rgba(57,229,8,.40);
  --shadow-rest:0 1px 2px rgba(0,0,0,.5), 0 8px 24px rgba(0,0,0,.35);
  --shadow-lift:0 12px 32px rgba(0,0,0,.45), 0 0 0 1px rgba(57,229,8,.08);
  --shadow-accent:0 8px 32px rgba(57,229,8,.14);
}

@theme inline {
  --color-ink-50: var(--ink-50);   --color-ink-950: var(--ink-950);
  --color-ink-850: var(--ink-850);
  --color-mint-50: var(--mint-50); --color-mint-950: var(--mint-950);
  --color-marigold-50: var(--marigold-50);
  --color-marigold-950: var(--marigold-950);
  --color-surface-page: var(--surface-page);
  --color-surface-raised: var(--surface-raised);
  --color-surface-card: var(--surface-card);
  --color-border-subtle: var(--border-subtle);
  --color-border-strong: var(--border-strong);
  --font-display: var(--font-display), "Bricolage Grotesque", sans-serif;
  --font-body: var(--font-body), "Figtree", sans-serif;
  --font-mono: var(--font-mono), "Fira Code", monospace;
  --radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; --radius-xl: 24px;
  --shadow-rest: var(--shadow-rest);
  --shadow-lift: var(--shadow-lift);
  --shadow-accent: var(--shadow-accent);
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
}

/* usage: bg-ink-950 text-ink-50 · bg-surface-card border-border-subtle
   bg-mint-500 text-ink-950 (primary CTA — never text-white on mint) */
```

(Expand the `@theme` lists to all 12 stops per ramp when wiring up; the `:root` block above is already complete.)

---

## 12. Kill-list (current code, for the implementer)

1. `layout.tsx` — delete Google Fonts `<link>`s; add next/font imports (§5).
2. `globals.css` — delete: `.btn-primary::after` sheen, `shimmer`/`float`/`pulse-glow` keyframes, `.gradient-mesh`, `.gradient-text`, glass blur/shadows, purple grid `.bg-grid`, all `#8b5cf6`/`#c084fc`/`#d946ef`/`#06b6d4` values → replaced by tokens above.
3. `page.tsx` — remove "Trusted by 500+", "50K+ Clips Generated", all 3 fake testimonials; rebuild sections per §9.
4. `pricing/page.tsx` — structure stays; recolor to tokens; annual badge → marigold-400.
5. `dashboard/layout.tsx` — sidebar/badge/donut recolor per §10; remove logo `<img>` purple JPG in favor of monochrome wordmark or mint re-render.
6. Motion: add `motion` package, use spring tokens (§6); nothing animates inside `/dashboard`.
