# 15 — Landing page rebuild (identity §9 full blueprint)

Date: 2026-09-19 · Scope: `/` (§9 rebuild), `Navbar.tsx`, `Footer.tsx` (restyle in place), `/features`, `/pricing` (layout polish), `globals.css` (additive section styles only). Not committed/pushed.

## What changed, section by section

### 1. Nav — `components/Navbar.tsx`
- Restyled in place; auth logic (Supabase session), scroll state, mobile drawer and pathname-close behavior untouched.
- Sticky bar: `bg-ink-950/80 backdrop-blur-md` + hairline border when scrolled, transparent at top.
- Wordmark is now a Bricolage text mark "ClipMint" + mint-400 period (the purple JPG is retired per identity §2). Links are Features / Pricing / FAQ, anchored to landing sections (`/#features`, `/#pricing`, `/#faq`).
- Buttons moved to new on-token `cm-btn-primary` / `cm-btn-ghost` classes (mint bg + ink-950 text).

### 2. Hero — `page.tsx`
- Rebuilt to the §9.2 order: eyebrow badge "Now in open beta · Free plan, no card" → H1 "Ek video. Das clips." (Bricolage 700, clamp 44–76px, −0.03em, mint-400 on "Das clips.") + ink-300 second line "Cut, captioned, platform-ready." → Figtree 18px sub → CTA pair (mint primary "Start free — no card" / ghost "See how it works" → `#how-it-works`) → product visual → trust microline "MP4 · MOV · WebM · up to 500MB · YouTube / Instagram / Drive links".
- Layout is now a two-column editorial hero (text left, product visual right) instead of the old centered stack. Auth-based CTA switch (dashboard vs login) and loading skeletons preserved.
- New **product visual**: `components/PhonePreview.tsx` — CSS-built 9:16 phone frame (`border-mint-500/40`, `rounded-[32px]`, `--surface-inset` bg) with a "9:16 · 1080×1920" meta pill, 4 stacked word-chips ("EK VIDEO. / DAS CLIPS. / STUDIO-MADE / CAPTIONS.") popping in with the playful spring (stiffness 550 / damping 20 — the one place it's allowed, mirroring render output), progress bar + mono timecode at frame bottom. No video file, no tint overlays, one-shot on mount, static under reduced motion.

### 3. Platform strip — `page.tsx`
- Replaced the old "Built for creators on" logo-fake row with the §9.3 capability claim: eyebrow "Made for Reels, Shorts & TikTok" + static ink-300 wordmark row (Instagram Reels / YouTube Shorts / TikTok).

### 4. How it works — `components/HowItWorks.tsx` (new)
- 3 vertical steps (upload → brain → download; static lucide icons, registry fallback rule) with copy stating the pipeline plainly (transcribe → score → clip → render).
- Scroll-drawn connector: framer-motion `useScroll({ target })` → `scaleY` mint-500/40 line, origin-top, static at full under reduced motion. Steps use `StaggerGroup`/`StaggerItem` (whileInView, once).

### 5. Caption styles — `page.tsx`
- Kept `StyleMarquee` (the single permitted loop) + the CAPTION_STYLES grid fallback restyled to compact `cm-card` chips.
- Added a real-figure stat row using `CountUp` (kept in use): 9 caption styles (animates), 1080×1920, −14 LUFS (compound strings pass through). Headline "Captions that do the talking."

### 6. Feature bento — `components/FeatureBento.tsx` (new)
- 6 mixed-size cells on a 6-col grid (4+2 / 2+2+2 / 6): AI moment detection (`brain`), 9 caption styles (`languages`), face-tracked 1080×1920 (`zap`), −14 LUFS audio (`audio-lines`), multi-format output (`maximize`), API access (`key` + mono chip `POST /v1/clips`).
- Capability copy only; hover = lift −2px + mint border + `--shadow-lift` via `.cm-card` (§6 hover model — no cursor effects).

### 7. Pricing (landing section) — `page.tsx`
- Position unchanged; cards rebuilt: `cm-card p-7`, Bricolage 36px prices, mint-400 checkmarks, highlighted Creator = 1px mint-500/60 border + `--shadow-accent` (no animated border). Same plans, ₹ prices, limits, and `/login` links as before.

### 8. FAQ — `components/FaqAccordion.tsx` (new) + `page.tsx`
- New 6-question AnimatePresence accordion (height:auto, `springSmooth`), first item open. Questions: credit card? / platforms? / video length? / languages & Hinglish / watermark? / refunds — all answered with real policies already in the product (7-day refund, 500MB, 9:16, watermark on free).
- Section sub keeps the honesty line in spirit: "We won't invent testimonials — the product has no users yet."

### 9. Final CTA — `page.tsx`
- ink-850 panel, 1px mint-500/30 border + `--shadow-accent`, "Shuru karo. Free hai." / "5 clips a month, free forever. Upgrade when it earns its keep." + mint CTA. Auth switch preserved.

### 10. Footer — `components/Footer.tsx`
- Restyled in place: 4 columns Product / Resources / Legal / Contact (same links, incl. mailto + Instagram), monochrome text wordmark, "Made in India" pill microbadge, © 2026 NovaMint Networks.

### Deleted from `/`
- The "What ships in every clip" testimonial-styled cards (its capability claims now live in the bento), the old 3-step glass-card grid, the old feature grid, glass cards and `gradient-text`/`bg-text-mint-400` classes throughout.

### features/page.tsx (polish only)
- Content, metadata, links untouched. Header gained eyebrow, Bricolage clamp H1, 15–17px/1.6 body; stat card → `cm-card` with mint figures; 9 feature cards → `cm-card` with mint icon tiles + detail pills (purple `rgba(108,92,231)` removed); CTA panel matches the landing final-CTA treatment.

### pricing/page.tsx (polish only, ALL logic byte-preserved)
- Cashfree checkout, subscription/one-time toggle, monthly/annual toggle, toasts, comparison table, billing FAQ logic untouched.
- Reskin: bg → `bg-ink-950`, ambient blur orb removed, eyebrow + clamp headings, plan cards → `cm-card` + mint highlight + Bricolage prices, Save-20% badge → marigold-400 (active: ink-950 text on mint-500), all `#10b981`/`slate-*`/`gradient-text`/`glass-card` replaced with ink/mint tokens, table hover/cell colors tokenized.

### globals.css — additive only
- Token layer untouched. Appended: `.cm-hairline`, `.cm-eyebrow` (Figtree 600 11px +0.14em), `.cm-card` (hover-lift model), `.cm-btn-primary` (mint-500 bg + ink-950 text, brightness hover — no moving highlights), `.cm-btn-ghost`, and mint recolor overrides for the shared `.faq-item` hover/open states used by /pricing.

## Honesty check
- Zero user counts, testimonials, or invented numbers anywhere in scope. All figures are capabilities: 9 styles, 1080×1920, −14 LUFS, 5 clips/mo, ₹ prices, 500MB, 7-day refund. "Free plan, no card" and "won't invent testimonials" lines retained in spirit.
- Banned effects: none used — no cursor-follow/magnetic/spotlight, no shimmer/scanline, no tint overlays, no gradient-mesh orbs (the /pricing blur orb was removed), no conic borders. Landing animations are one-shot whileInView / mount-stagger only; the sole loop is StyleMarquee. No dashboard/api/lib/login/contact/about/legal/dashboard-new files touched.

## Build output
- `npx tsc --noEmit` → exit 0 (0 errors).
- `npm run build` → exit 0; all 27 routes compiled, `/`, `/features`, `/pricing` static.
- Grep `8b5cf6|shimmer|gradient-mesh` in `page.tsx` → zero matches (scope-wide, only a pre-existing CSS comment mentions "never shimmer").

## Files touched
- `dashboard/src/app/page.tsx` (rebuilt)
- `dashboard/src/app/components/Navbar.tsx`, `Footer.tsx` (restyle in place)
- `dashboard/src/app/components/PhonePreview.tsx`, `HowItWorks.tsx`, `FeatureBento.tsx`, `FaqAccordion.tsx` (new, all `"use client"`)
- `dashboard/src/app/globals.css` (additive block only)
- `dashboard/src/app/features/page.tsx`, `dashboard/src/app/pricing/page.tsx` (polish)
