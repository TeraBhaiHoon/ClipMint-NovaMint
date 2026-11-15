# Quota, language and caption quality repair — 2026-11-15

## User requirements → acceptance evidence

| Requirement | Concrete deliverable | Evidence / current gate |
|---|---|---|
| Latest five clips consume quota | Transactional finalization, job ledger and current-window legacy repair | Live read: job `095547b0-37c9-4f8f-9aaf-74cf1ee0de41` has five ready 9:16 masters while its profile has `clips_used=0`, `videos_used=1`; correction pending live approval |
| Related quota bugs | Atomic admission/holds, job-based refunds, idempotent completion, effective-plan limits, protected counters, monthly-window safety | SQL migration and actual local PostgreSQL gate pending final integration |
| Hindi recognition does not silently become English | Explicit source-language hint; auto mode never forces English based on its first chunk; original native-script transcription prompt | Completed run `43701485991` logged first chunk `en`, then all fourteen chunks forced English; regression tests now cover lock policy and provider normalization |
| Subtitle language selection | Spoken: Auto/Hindi/English. Output: Original/Hinglish/English. Stored on job and reused on retry | New-video inputs, summary, API dispatch, workflow and job detail fields; Original is default |
| Better accuracy | Preferred full Whisper model, bounded real source context, actual Deepgram detection/hints, native-script prompt, malformed-timestamp filtering, word-timed preference | Offline provider/orchestration tests. No live recognition benchmark or measured WER yet; no numerical accuracy claim |
| Robust output conversion | Phrase-level English translation with in-span estimated timing; Hinglish transliteration; fail closed if explicitly selected output cannot be produced | Conversion tests cover expansion/contraction, invalid replies, partial conversion, provider outage and raw checkpoint preservation |
| Improved nine styles | Shared measured two-line layout, licensed local Hindi/Latin fonts, complete graphemes, restrained animation, ratio-aware safe areas | 54 real frame renders, nine encoded two-second motion samples and ffprobe verification; eight functional layout tests |
| Optimized previews | Actual renderer-generated WebP style samples, not misleading CSS approximations | 18 Hindi/English preview assets under `dashboard/public/caption-previews/` |
| Related retry/render gaps | Persist language/pace choices; resume or fresh retry; custom music carried to shards; cumulative render heartbeat | Workflow tests, fresh retry control, custom-BGM artifact wiring, render counter fix |
| Fully verified release | Combined tests, build, transaction/security gates, actual live migration/account correction and production verification | Local build passed; live migration/deployment not yet authorized. Browser interaction unavailable: required browser driver is not exposed in this session |

## Confirmed root causes

1. Clip accounting lived only in a best-effort notification webhook. The finalizer wrote rows and `done` independently; webhook errors could be ignored and quota remained zero. This also permitted duplicate completion notifications to double-charge.
2. The first detected audio language was reused as a forced hint for the entire video. An English or code-switched introduction locked a Hindi-heavy source to English.
3. Caption layouts measured only the longest word; unbreakable phrase styles could overflow. Hindi typing sliced code units rather than graphemes, and all aspect ratios reused vertical safe areas.

## Verification performed so far

- Python pipeline regression suite: **176 passed** on the final combined state (including finalizer metadata and idempotent RPC retry checks).
- Actual PostgreSQL quota gate: **126 passed assertions across 35 tests**, including runtime browser-role denials and migration re-run idempotency.
- Executable dashboard quota API tests: **29 passed** (fresh first dispatch, duplicate refusal, persisted inputs, refunds, request replay and malformed claims).
- Dashboard regression tests: **13 passed**; homepage regression tests: **8 passed**.
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

Still required before declaring the production issue resolved:
1. Approve and apply `supabase/migration_quota_v2.sql` (includes monotonic current-window repair of existing proven clip undercounts, no reductions).
2. Publish the reviewed code to the processing repository and deploy the dashboard/Worker updates in a coordinated release; verify actual production release state, not just CI.
3. Confirm the latest five-clip job's ledger and profile show five charged clips without a duplicate charge; verify the other proven two-clip undercount too.
4. Run a fresh Hindi recognition job with explicit Hindi + Original captions and compare delivered audio/text, then verify quota and repeated-completion behavior on live data.
5. Perform authenticated browser clicks when the required browser driver is available. That driver is not exposed in this session.

These gates are pending, not passed. The goal remains incomplete until live verification covers them.

## Release constraints / honesty

No production balances, migration or deployment changed in this round yet. Existing rendered user clips were not overwritten. Quantitative recognition accuracy is unmeasured; the offline tests prove code policy, not audio WER. Render samples prove actual captions, not a fully authenticated browser flow. The goal is not complete until uncovered gates are resolved or explicitly reported as blockers.
