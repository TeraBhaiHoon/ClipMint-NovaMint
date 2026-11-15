# Dashboard workspace redesign

## Scope and preservation

Redesign the existing `/dashboard` workspace, not the public marketing site. Preserve the CM logo, white/mint identity, local fonts, authenticated data isolation, plan limits, API routes and processing options. No new billing model, destructive account action or paid UI service.

**Mode:** Layout restructure. The previous pass corrected theme colors but left a stack of oversized floating cards, tiny metadata, conflicting content widths and inconsistent controls. This pass treats the dashboard as an editing workspace, with one shared design system.

## Direction

A calm video-production workspace for creators: compact navigation, clear titles, compact metrics, useful whitespace and immediately readable video status. Inter remains the established local UI font; Syne is reserved for the brand. Mint denotes selection and primary action, not every decoration.

## Concrete deliverables

- Shared responsive shell: desktop sidebar and topbar; usable tablet layout; mobile navigation with safe-area clearance and account/sign-out access.
- Shared typography, 4px spacing scale, 44px controls, 18–20px / 1.75-stroke Lucide icons, accessible focus and reduced-motion states.
- Jobs: integrated summary strip and searchable/filterable video list; clear loading/error/no-jobs/no-results states.
- New video: grouped source, captions, and output controls plus a live configuration summary; preserve URL, upload, Drive, both output modes, all nine styles, pace, music and editing options.
- Job detail: human-readable title, stage/status layout, responsive clip gallery, quality report, copy/download actions and viewport-safe accessible preview dialog.
- Analytics: readable charts and legends, clear period selection, responsive score list, and honest AI-score labels.
- API keys: readable key inventory, examples and creation/deletion dialogs with keyboard handling and explicit pending/error/copy states.
- Settings: profile, notifications, billing/history, security; readable section hierarchy, labelled controls and truthful account actions.

## Completion audit — 2026-11-15

The objective requires **a real layout/typography/icon/spacing redesign of all dashboard pages, with no clipping, overlap or unusable controls at desktop, tablet and mobile widths**. Implementation is saved; completion is not yet established because fresh browser verification is blocked.

| Requirement | Concrete artifact / evidence | Result |
|---|---|---|
| Shared shell and consistent titles | `dashboard/layout.tsx`, `_components/dashboard-provider.tsx`, `_components/ui.tsx`; all six page sources use `PageHeader` | Implemented; render pending |
| Layout and spacing | Isolated `dashboard.css`: one content width, common panel padding, slimmer sidebar, shared controls; breakpoints at 1180/1023/767/359px | Source reviewed; gutter/overlap measurements NOT run |
| Typography and icons | Local UI font, shared heading scale, tabular numeric values, Lucide 1.75px stroke; no emoji decoration in dashboard page sources | Source/static regression checked; visual review pending |
| Jobs | `dashboard/page.tsx`: unified library/list, search, six status filters, sort, loading/error/empty states | Implemented; click testing pending |
| New Video | `dashboard/new/page.tsx`: three grouped sections and summary; all source types/modes/styles/pace/music/auto-edit options retained | Implemented; real upload/dispatch intentionally not run |
| Job Detail | `[jobId]/page.tsx`: status/stages, human title, clip search/sort, quality/caption disclosure, download/copy, native preview dialog | Implemented; preview/download verification pending |
| Analytics | `analytics/page.tsx`: day-range helpers, paginated data, charts/legends, daily table, explicit AI-score meaning | Implemented; helper tests pass; rendered charts pending |
| API Keys | `api-keys/page.tsx`: inventory, examples, native create/delete dialogs, pending/error/copy handling | Implemented; no keys created/deleted during QA |
| All Settings tabs | `settings/page.tsx`: profile, notifications, billing/history, security; keyboard tab logic and labelled controls | Implemented; interactive verification pending |
| Honest controls | Default caption preference now browser/account-scoped; weekly-summary control labelled unavailable; deletion directs to support instead of merely signing out | Source/static regression checked |
| Accessibility | Native `<dialog>.showModal`, escape handling, focus restore, labelled inputs, skip link, safe-area navigation, reduced-motion CSS | Implemented; keyboard/hit-target audit NOT run |
| Regression checks | `npm run test:dashboard`: **13/13 passed**; `npm run lint`: **0 errors, 8 warnings**; `npm run build`: compiled, TypeScript and all routes passed | Passed; these are NOT visual acceptance evidence |
| CI coverage | `.github/workflows/quality.yml` now runs dashboard tests and lints tests as well as sources | Source updated; remote CI NOT run |
| Release | Branch `feat/dashboard-studio-layout`, no commit/push/deploy performed in this redesign pass | Local only; live site unchanged |

### Remaining acceptance gate

The official `mcp__node_repl__js` browser tool is absent from the resumed parent session and the verification agent's callable tools. The verification agent loaded the required Browser Use skill, confirmed that absence, and stopped without a substitute browser. Consequently **no fresh screenshots, width measurements, keyboard tests, login tests or production verification were performed for this redesign**. Earlier November 8 screenshots belong to the old design and do not cover these new changes.

Required next checks: all six pages and four Settings tabs at 1280/768/390px, representative 320px layout, collapsed navigation, long titles/key names, filter/search, source/mode/style/pace/music changes, create-dialog cancel/Escape/focus return, clip preview and disclosures, and final gutter/overflow/hit-target inspection. Rebuild after any fixes before separately authorized release.

### Functional fixes found during the redesign

- Server quota gate now accepts equality with the video limit because the client has already reserved the current slot; only a counter **above** the limit is refused.
- Failed-project retry resets the persisted status before redispatching.
- Submission requires an explicit `true` reservation result and does not duplicate an already-created project after a dispatch error.
- Caption copying omits null/undefined fields, and clipboard failures are reported.
- Account context retains stable identity during refresh, avoiding unnecessary data reloading.


## Verification constraints

Use the existing QA account through normal sign-in for browser review. Do not seed or edit real customers, inject sessions, send email, purchase a plan or dispatch processing just to test visuals. Existing demo data must be labelled as demo evidence, not product metrics. Use only official Browser Use APIs for browser work. Record limitations rather than treating a build or HTTP 200 as proof of every screen.
