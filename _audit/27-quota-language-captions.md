# Quota, language and caption quality repair — 2026-11-15

## User requirements → acceptance evidence

| Requirement | Concrete deliverable | Evidence / current gate |
|---|---|---|
| Latest five clips consume quota | Transactional finalization, job ledger and current-window legacy repair | Live read before: five ready masters with `clips_used=0`. After approved migration: **5 used, ledger charged=5**, videos unchanged. |
| Related quota bugs | Atomic admission/holds, job-based refunds, idempotent completion, effective-plan limits, protected counters, monthly-window safety | Applied live migration, **126 passing PostgreSQL assertions**, live replay/duplicate/refinalization gates |
| Hindi recognition does not silently become English | Explicit source-language hint; auto mode never forces English based on its first chunk; original native-script transcription prompt | Completed run `43701485991` logged first chunk `en`, then all fourteen chunks forced English; regression tests now cover lock policy and provider normalization |
| Subtitle language selection | Spoken: Auto/Hindi/English. Output: Original/Hinglish/English. Stored on job and reused on retry | New-video inputs, summary, API dispatch, workflow and job detail fields; Original is default |
| Better accuracy | Preferred full Whisper model, bounded real source context, actual Deepgram detection/hints, native-script prompt, malformed-timestamp filtering, word-timed preference | Offline provider/orchestration tests. No live recognition benchmark or measured WER yet; no numerical accuracy claim |
| Robust output conversion | Phrase-level English translation with in-span estimated timing; Hinglish transliteration; fail closed if explicitly selected output cannot be produced | Conversion tests cover expansion/contraction, invalid replies, partial conversion, provider outage and raw checkpoint preservation |
| Improved nine styles | Shared measured two-line layout, licensed local Hindi/Latin fonts, complete graphemes, restrained animation, ratio-aware safe areas | 54 real frame renders, nine encoded two-second motion samples and ffprobe verification; eight functional layout tests |
| Optimized previews | Actual renderer-generated WebP style samples, not misleading CSS approximations | 18 Hindi/English preview assets under `dashboard/public/caption-previews/` |
| Related retry/render gaps | Persist language/pace choices; resume or fresh retry; custom music carried to shards; cumulative render heartbeat | Workflow tests, fresh retry control, custom-BGM artifact wiring, render counter fix |
| Fully verified release | Combined tests, build, transaction/security gates, actual live migration/account correction and production verification | Local and remote gates passed; READY production release, balances corrected and short Hindi pipeline success verified. Browser interaction and quantitative WER/load benchmarks remain unverified. |

## Confirmed root causes

1. Clip accounting lived only in a best-effort notification webhook. The finalizer wrote rows and `done` independently; webhook errors could be ignored and quota remained zero. This also permitted duplicate completion notifications to double-charge.
2. The first detected audio language was reused as a forced hint for the entire video. An English or code-switched introduction locked a Hindi-heavy source to English.
3. Caption layouts measured only the longest word; unbreakable phrase styles could overflow. Hindi typing sliced code units rather than graphemes, and all aspect ratios reused vertical safe areas.

## Verification performed so far

- Python pipeline regression suite: **182 passed** on the latest tested state (including six independent-reference WER/CER tool tests, finalizer metadata and idempotent RPC retry checks). This count supersedes the initial 176-test run; no suite was rerun for this documentation correction.
- Actual PostgreSQL quota gate: **126 passed assertions across 35 tests**, including runtime browser-role denials and migration re-run idempotency.
- Executable dashboard quota API tests: **29 passed** (fresh first dispatch, duplicate refusal, persisted inputs, refunds, request replay and malformed claims).
- Dashboard regression tests: **14 passed** after the clip-limit display regression was added; homepage regression tests: **8 passed**.
- Caption layout tests: **8 passed**.
- Dashboard production build: **passed** (existing Next.js middleware deprecation warning remains).
- Caption renderer TypeScript: **passed**.
- Frame matrix: **54 distinct outputs** (9 styles × Hindi/English × 9:16/1:1/16:9).
- Motion samples: **9 H.264 files**, each **720×1280**, **60 frames**, **2.000 seconds**, verified using ffprobe.
- Actual PostgreSQL quota harness setup initially failed on `uuid-ossp`; the corrected, tracked harness now loads the extension and applies the baseline schema and migrations. The final **126/126** gate was executed by the main agent, not accepted from an agent's assertion alone.
- All **10 workflows** passed syntax/embedded-code checks. Latest dashboard production build and gateway TypeScript passed.
- Gateway functional suite: **8 passed**; tests exercise the actual Worker handlers with mocked HTTP, including quota verdicts, atomic claims, granted budgets, replay and unknown dispatch acceptance.

## Completion audit / remaining release gates

Implementation artifacts exist for every requested feature. The local SQL gate validates transaction semantics and role denials; PGlite is a single-backend engine, so this is not proof of multi-backend concurrency under production load. The functions use a consistent profile-before-job locking order, and the tests verify the serialized reservation pool.

Release gates 1–4 below are **passed**, with direct evidence in the approved release section. Gate 5 is **partially verified**, with remaining checks paused for a user permission decision; gate 6 lacks an independent reference:
1. Applied `supabase/migration_quota_v2.sql` after approval (monotonic current-window correction, no clip-row reductions).
2. Published processing code and deployed dashboard and Worker; verified READY production SHA/alias and actual endpoint availability.
3. Confirmed five-clip and two-clip account corrections and durable ledgers.
4. Completed a short Hindi recognition/render/delivery job and verified final quota plus repeated-completion idempotency.
5. Normal QA sign-in, New video navigation, language/style selection, completed-job language fields, preview-dialog opening/Escape closing and billing counters passed in the supported browser. Remaining checks include library-link activation, failed-job attention/retry rendering, checkpoint-bearing resume/fresh selection, keyboard use and post-refresh persisted details. The existing browser follow-up requires the user's Approve/Decline decision; no permission was approved or bypassed by the assistant.
6. WER/CER measurement code and tests passed, but measured speech accuracy remains unverified without independent human/creator reference text for the exact sample.

No claim of a universally perfect or error-free system is made. Live English/Hinglish conversion quality and a multi-backend concurrency/load benchmark remain future quality gates; mocked conversion tests and serialized PostgreSQL tests cover the code contracts, not every real-world input.

## Approved release — live evidence

The user approved **Publish and repair**. Code release `b71fe05` was pushed to the processing repository; website sync `25bdfab` deployed to Vercel production `dpl_F41WUiGbZJEqPujtU9WnAQKLdcvn` (**READY**), with the domain alias verified. The Worker deployed as version `6be04880-b1ec-474b-992e-73b44a632366`.

Migration `quota_v2_atomic_job_accounting`, version `20261115151319`, was applied successfully. Live before → after:
- Latest five-clip account: `clips_used 0 → 5`, `videos_used 1 → 1`; job remains done, ledger charged=5.
- Other proven two-clip account: `clips_used 0 → 2`, `videos_used 1 → 1`; job remains done, ledger charged=2.
- All 114 clip rows remain intact; no rendered clip files overwritten. Two other current-window proven undercounts were repaired monotonically.

Release CI initially failed on an obsolete legacy parser test (new parser returns timing-source flag) and a new test variable name lint rule. Both were corrected in `fc8951b`; remote **Quality checks 43729481393 passed** all three jobs, including the newly added quota SQL/API/layout gates. Website sync `cf728c7` deployed **READY** as `dpl_FTUt7vYnkCFAVFSJibZ3YuAeByM1`.

The user also approved one short live Hindi QA sample. Admission request replay returned the same job; duplicate dispatch returned 409. Job `91063c16-cc3e-4c36-ae94-ff032aa4c451`, run `43730218303`, completed **successfully** using explicit `hi` + `original`. Downloaded live input artifact confirms actual Deepgram Nova-3 output: **51 words**, Hindi Devanagari plus spoken English words, actual word timestamps; report records `language=hi`, `language_source=user-hint`, `source_duration=18.0053125`. No translation/transliteration step ran.

End-to-end acceptance:
- Actual H.264 delivery is **1080×1920**, **540 video frames**, **18.048 seconds**, with AAC audio (ffprobe).
- Active-speech frame at 7 seconds visibly renders the mixed phrase “Assume नहीं कर रहा” with complete Hindi clusters, two lines and active-word highlighting. A frame during the real pause at 4.4 seconds correctly shows no captions.
- Live job is done/100%, clip ready, ledger charged=1; profile `clips_used=1`, `videos_used=1`, `clips_reserved=0`.
- Repeated finalization was executed inside a rolled-back live transaction: counters remain 1/1/0 and clip ID `5f5996f4-220f-4ff7-bc7b-34a5d93c2f90` remains stable.
- Finalizer logged `TRANSCRIPTION_META_RESTORED`, `QA_CAPTIONS_RESTORED merged=1`, atomic `SAVE_OK`, and `CLEANUP_OK`; `video_storage_path` is null after source deletion.

Quantitative WER remains unmeasured. Authenticated HTTP admission and upload passed. Supported-browser QA sign-in and New video navigation later passed; the remaining interaction/layout checks are incomplete, as detailed below.

## Follow-up verification — browser recovery and accuracy measurement

- The missing tool was diagnosed as a ZCode late-connect registration race: this old session registered its MCP tools before the healthy Node REPL host connected. A fresh root verification session regained `mcp__node_repl__js` without configuration or permission changes.
- Initially, the fresh session successfully bootstrapped the official Browser Use client and discovered the in-app browser, but tab load/snapshot operations timed out or returned an internal MCP error. That initial attempt produced no authenticated interaction proof. Isolated calls subsequently succeeded, as recorded in the next item; the initial tooling errors were not proof of a ClipMint UI defect.
- Later isolated browser calls succeeded: normal QA login field fills and Sign In click reached the authenticated dashboard, and clicking the sidebar New video link returned the form snapshot. Original output default, all nine style controls, and sidebar `1 / 5` clip usage were observed. Selection/keyboard/dialog/retry interaction acceptance is still incomplete. Full-page screenshot output was tiled and cannot count as visual layout proof.
- Subsequent session failure was diagnosed from the runtime log as a **provider token-rate-limit business error** (`rate_limit_exceeded`), not a browser failure or user denial. Repeated session execution attempts are stopped; the successful browser tool result before the provider failure does not establish unseen follow-on actions.
- Browser inspection found a genuine initial display mismatch: clip slider label showed 5 while remaining quota/summary showed 4. The slider and summary now share `availableClipRequest`, with a regression test; dashboard helper suite is **14 passed** and the production build passed. Follow-up commit `419eaff` passed remote Quality checks `43739588639` and deployed **READY** through website sync `9e2582f` as `dpl_F3jPno7Kj69WaDCqSQWJPF7sQ6wv`, domain alias verified. No new processing was submitted by the browser check.
- Independently measured the delivered Hindi sample: **51 words, 39 containing Hindi script, 0 invalid time ranges, 0 overlapping word ranges**. These are subtitle timing/script metrics, not speech accuracy.
- No verified human/creator transcript of the exact 18-second sample was found. ASR output and the provider's `0.9184` confidence cannot be used as reference truth or an accuracy percentage.
- Added `scripts/measure_transcription_accuracy.py`: computes substitution/deletion/insertion WER and CER against an explicitly sourced human/creator reference, preserves Hindi marks during normalization, and refuses empty/unsupported reference input. Six new functional tests pass; combined Python suite **182 passed**. The metric tool is ready, but a real WER measurement remains blocked on independent ground truth.

## Browser acceptance and bounded-loading follow-up — 2026-11-16

The original alternate operation eventually reported completed; `.testrun/browser-verification-alternate.md` exists. Its report and saved viewport screenshots support passing source/output selection, all nine style-control state changes, loaded summary sample, completed-job language fields and one-clip charge, preview dialog opening/Escape closing, billing 1 clip/1 video and the corrected four-clip available limit. These are observed desktop checks, not comprehensive mobile acceptance. Three style screenshots were skipped after capture errors; pressed-state/alt-text observations exist, not visual proof for those individual steps. Zero holds was inferred on that surface from remaining usage, not directly rendered as a holds row.

Remaining findings need careful classification:
- Failed-job detail stayed on the skeleton during the delegated browser check. That is real uncovered retry acceptance, but does not prove a failed-status-specific database cause.
- Library-link activation is **inconclusive**, not a confirmed app hit-target defect. The entire source row is a normal Next Link; automated clicks also timed out on other controls. Direct navigation proves the destination works, not link activation.
- Draft choices reset on navigation by implementation. They are stored on project creation, not autosaved during configuration. The wording was misleading; the local follow-up clarifies it.
- Read-only live SQL confirms both referenced jobs belong to the QA account. Failed job `bf21a0ba-3f9d-4b30-80a0-47997acc294c` has **no checkpoint**, so its resume/fresh selector is intentionally absent. A separate checkpoint-bearing fixture is needed to verify that selector without modifying production data or submitting a retry.

Source-backed repairs now exist locally (not yet published): complete logical load deadlines, independent optional thumbnail loading, effect-scoped cancellation/late-response isolation, auth-event invalidation outside the SDK callback, bounded optional rollover with unavailable-usage guards, scoped retry response handling without automatic POST replay, visible saved reading pace, and honest draft-save wording. Design: `specs/bounded_dashboard_loading_design.md`.

New component tests execute the actual TSX loaders with mocked hooks/Supabase/fetch and fake clocks. They cover stalled auth/query/rollover/payments, retry recovery, thumbnails not hiding detail, late account/job results, obsolete realtime callbacks, retry/save/password A not changing B, uncertain mutation acceptance without replay, and creation disabled while usage is unavailable. They do **not** use a real browser or substitute for live deployment/interaction proof.

Final integrated local gates after the settings continuation repair: **43 loading/helper/component tests**, **14 dashboard tests**, **8 homepage tests** and **37 API/gateway quota tests passed**; full dashboard ESLint passed with **0 errors and 10 existing warnings**; production build passed. All ten workflows passed the workflow checker. The earlier lint attempt failed on a new harness variable named `module`; it was corrected to `compiledModule` before this final passing run. These results concern local follow-up code, not a new production deployment.

## Current blockers — 2026-11-16

- A bounded browser follow-up was sent to the existing alternate session. Its exact operation returned `needs_attention` with `attention.kind=approval`, revision 18928. The original operation is completed, but the new follow-up requires the user's permission decision. No assistant approval or bypass occurred; the way the original pending request resolved was not observed, so no human approval is invented.
- The user explicitly approved publication of the tested loading/account-isolation follow-up on 2026-11-16 after pausing the broader goal. This authorizes committing/pushing the reviewed fixes and verifying the deployment only; it does not resume the paused goal, approve the separate browser permission, or authorize another processing run. Deployment verification is still pending at the time of this pre-release note.
- No verified independent transcript of the exact 18-second QA sample is available. Provider confidence, its own ASR output and script/timing validity cannot substitute for human/creator ground truth. No numerical speech accuracy score is claimed.

## Release constraints / honesty

Production balances and migration were changed only after explicit approval, as documented above. Existing rendered user clips were not overwritten. Quantitative recognition accuracy remains unmeasured: offline tests prove policy and timing behavior, and one live Hindi sample proves actual native-script delivery—not zero transcription errors. Authenticated HTTP behavior and supported-browser QA sign-in/New video navigation passed; comprehensive browser interaction/layout acceptance remains incomplete.
