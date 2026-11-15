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

Release gates 1–4 below are **passed**, with direct evidence in the approved release section. Gate 5 remains **unverified** because the required driver is unavailable:
1. Applied `supabase/migration_quota_v2.sql` after approval (monotonic current-window correction, no clip-row reductions).
2. Published processing code and deployed dashboard and Worker; verified READY production SHA/alias and actual endpoint availability.
3. Confirmed five-clip and two-clip account corrections and durable ledgers.
4. Completed a short Hindi recognition/render/delivery job and verified final quota plus repeated-completion idempotency.
5. Authenticated browser click/layout testing remains blocked on the missing browser driver.

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

Quantitative WER remains unmeasured. Authenticated HTTP admission and upload were verified, but browser click/layout interaction was not: the browser driver is not available in this session.

## Follow-up verification — browser recovery and accuracy measurement

- The missing tool was diagnosed as a ZCode late-connect registration race: this old session registered its MCP tools before the healthy Node REPL host connected. A fresh root verification session regained `mcp__node_repl__js` without configuration or permission changes.
- That fresh session successfully bootstrapped the official Browser Use client and discovered the in-app browser. It observed the live login tab, but tab load/snapshot operations timed out or returned an internal MCP error. **No authenticated clicks or screenshots have passed yet**. Further isolation is in progress; this is an operational tool failure, not proof of a ClipMint UI defect.
- Later isolated browser calls succeeded: normal QA login field fills and Sign In click reached the authenticated dashboard, and clicking the sidebar New video link returned the form snapshot. Original output default, all nine style controls, and sidebar `1 / 5` clip usage were observed. Selection/keyboard/dialog/retry interaction acceptance is still incomplete. Full-page screenshot output was tiled and cannot count as visual layout proof.
- Subsequent session failure was diagnosed from the runtime log as a **provider token-rate-limit business error** (`rate_limit_exceeded`), not a browser failure or user denial. Repeated session execution attempts are stopped; the successful browser tool result before the provider failure does not establish unseen follow-on actions.
- Browser inspection found a genuine initial display mismatch: clip slider label showed 5 while remaining quota/summary showed 4. The slider and summary now share `availableClipRequest`, with a regression test; dashboard helper suite is **14 passed** and the production build passed. No new processing was submitted by the browser check.
- Independently measured the delivered Hindi sample: **51 words, 39 containing Hindi script, 0 invalid time ranges, 0 overlapping word ranges**. These are subtitle timing/script metrics, not speech accuracy.
- No verified human/creator transcript of the exact 18-second sample was found. ASR output and the provider's `0.9184` confidence cannot be used as reference truth or an accuracy percentage.
- Added `scripts/measure_transcription_accuracy.py`: computes substitution/deletion/insertion WER and CER against an explicitly sourced human/creator reference, preserves Hindi marks during normalization, and refuses empty/unsupported reference input. Six new functional tests pass; combined Python suite **182 passed**. The metric tool is ready, but a real WER measurement remains blocked on independent ground truth.

## Release constraints / honesty

Production balances and migration were changed only after explicit approval, as documented above. Existing rendered user clips were not overwritten. Quantitative recognition accuracy remains unmeasured: offline tests prove policy and timing behavior, and one live Hindi sample proves actual native-script delivery—not zero transcription errors. Authenticated HTTP behavior was verified, but browser interaction remains an uncovered gate.
