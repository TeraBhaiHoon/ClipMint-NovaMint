# Website redesign — implementation report (2026-09-18)

Implemented in-session by the coordinator after two background-agent attempts
died on infrastructure errors (the identity spec in `_audit/09-identity.md`
survived and drove the work).

## What changed

**Theme layer (the lever that reskins everything):**
- `globals.css` `:root` tokens swapped: purple `#8b5cf6` family → **mint-500
  `#39E508`** (the render engine's own caption color), slate grays → **ink**
  ramp (mint-tinted charcoal, never pure gray/slate), cyan/pink slots retired
  to mint-400/marigold-400, glassmorphism vars re-pointed at solid ink-850
  surfaces (names kept so dependent CSS still resolves).
- Full ink/mint/marigold 12-stop ramps + `@theme inline` Tailwind v4 mapping
  appended (bg-ink-950, text-mint-400, bg-surface-card usable everywhere).
- Fonts via `next/font`: **Bricolage Grotesque** (display), **Figtree** (body),
  **Fira Code** (mono) — the Inter/Outfit `<link>` tags deleted from
  `layout.tsx`.

**Kill-list executed (owner taste rules):**
- Deleted: `.gradient-mesh` (+ pseudo-elements with `float` animations),
  `.bg-grid`, `pulse-glow`/`float`/`shimmer` keyframes, `.btn-primary::after`
  sheen, `.glass-card::before` sheen, `.animate-pulse-glow`, `.animate-float`.
- `.skeleton` re-pointed at **opacity-pulse** on ink-800 (no shimmer).
- `.gradient-text` → solid mint-400 (no gradient text anywhere).
- `.step-circle.active` pulse-glow removed.
- Primary buttons: mint bg + **ink-950 text** (white-on-mint fails contrast at
  1.7:1), hover = brightness filter, no moving highlights.

**Honesty fixes (landing):**
- Deleted: "Trusted by 500+ content creators worldwide", "50K+ Clips
  Generated", and all three fabricated testimonials (Priya/Rahul/Ananya).
- Trust line is now "Free plan. No credit card. Watermark-free on paid."
- Stats band → real capability figures: 9 caption styles, 1080×1920
  face-tracked output, −14 LUFS studio loudness.
- Testimonial cards → "What ships in every clip" capability cards with an
  explicit line: *"We won't invent testimonials — the product has no users
  yet."*
- Hero: "Ek video. Das clips." + "Cut, captioned, platform-ready." Final CTA:
  "Shuru karo. Free hai." with the real free-plan numbers.

**Color sweep:** 195 class-level swaps across 16 files (landing, pricing,
about, contact, login, legal pages, dashboard pages, navbar/footer, sidebar) +
3 manual fixes. **Zero** `#8b5cf6`/`#c084fc`/`#d946ef`/`#06b6d4` remain in any
tsx. White-text-on-mint spots flipped to ink-950.

**Verification:** `npm run build` → exit 0, all routes compiled.

## What this pass deliberately did NOT do
- No framer-motion sections were added yet despite the package being
  installed — the motion layer (hero stagger, scroll progress, style marquee,
  before/after drag) is specified in `_audit/09-identity.md` §6 and is the
  natural next pass, now that every color/type token it needs exists.
- Landing section structure is the V2 skeleton recolored + rewritten copy; the
  full section rebuild (how-it-works connector, bento, style marquee) is also a
  next pass per §9.
