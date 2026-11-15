# Homepage redesign — 2026-11-15

## Request and direction

The user reported that the homepage had barely changed and requested improved colors and a substantive design. The previous dashboard-only implementation is preserved. This is a homepage layout restructure, not a new product identity: CM logo, local Syne/Inter fonts, light surfaces, and mint accent retained.

## Implemented changes

- `src/app/page.tsx`: rebuilt hero, platform strip, real-output demo, feature layout, workflow, caption-style grid, pricing, FAQ and footer.
- `src/app/home.css`: homepage-scoped paper/white surfaces, deeper green text, restrained mint actions, common gutters, varying section surfaces and responsive layouts.
- `HomeNavigation.tsx`: new homepage navigation; native mobile dialog with Escape handling and focus return; auth-aware workspace link.
- `HomePreview.tsx`: interactive three-style typography sample clearly labelled as illustrative; existing Sintel clip uses real video controls and is identified as a silent CC-BY demo.
- `CtaButtons.tsx`: existing auth-aware CTA retained; icon switched to the same installed Lucide family used on the new homepage.
- Removed homepage use of the placeholder carousel and repetitive old sections. Existing carousel source/assets remain intact for any other references.
- Pricing derives from `PLAN_LIMITS`, shows numeric quotas and one-time pass terms instead of automatic monthly billing or invented plan capabilities. Popular remains inline beside Creator.
- Existing dashboard source changes were not modified in this homepage pass.

## Checks actually performed

| Gate | Evidence | Result |
|---|---|---|
| Homepage source regression checks | `node --test tests/homepage.test.mjs` | 8/8 passed |
| Dashboard regression checks | `npm run test:dashboard` | 13/13 passed |
| Lint | `npm run lint` | 0 errors; 8 pre-existing warnings |
| Production build + TypeScript | `npm run build` | Passed; homepage and all dashboard routes compiled |
| Core text/button contrast | Computed contrast tests for five primary palette pairs | ≥4.5:1 |
| Preview serves new content | HTTP 200; new `clipmint-home` marker, headline and stylesheet present; old placeholder carousel absent | Passed |
| Media assets | Local HEAD requests for logo, Sintel MP4 and poster | All HTTP 200 |
| Demo media facts | ffprobe | 720×1280 H.264, 12 seconds, no audio; labelled silent |
| Fresh rendered desktop/mobile inspection | Official browser `mcp__node_repl__js` is absent from this session | **Not performed** |
| Live deployment | No commit, push or deployment authorized/performed | **Local preview only** |

The current production-build preview runs at `http://localhost:3211/`. An older preview was stopped before rebuilding so this address serves the new source, not a stale bundle.

## Remaining acceptance

Inspect the new homepage at 1280, 768, 390 and representative 320 px widths. Check hero wrapping, section rhythm, real demo playback, mobile menu pointer/keyboard/focus behavior, caption-style choices, FAQ disclosure and inline Popular alignment. Source checks and HTTP 200 are not substitutes for those rendered checks. The in-app browser's design mode can supply picked-element feedback, but no screenshot review is claimed for this pass.
