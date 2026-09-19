# ClipMint — Pipeline Bug Hunt

Bug hunt over the **processing pipeline only**: `pipeline/*.py`, `.github/workflows/process-video.yml`
(whole 34-step run), `supabase/migration_*.sql` (read-only — fixes go in a NEW migration), and
`r2-probe.yml` / `migrate-r2.yml`. The dashboard (`src/app`, `src/lib`), api-gateway, and design /
auth / payment files were **not** touched.

Not committed, not pushed. Everything is in the working tree.

---

## 0. Validation results (run at the end, all green)

| Check | Result |
|---|---|
| `python -m py_compile` on every changed pipeline file | PASS (auto_edit, db, render_clips, transcribe_providers, video_briefing) |
| `python -m py_compile` on every pipeline file (baseline) | PASS |
| Workflow YAML parses (`yaml.safe_load`) | PASS (process-video, r2-probe, migrate-r2) |
| Every embedded Python heredoc compiles (dedent + `py_compile`) | PASS (15 heredocs across the 3 in-scope workflows) |
| `bash -n` on every `run:` block | PASS (33 blocks in process-video, 1 + 1 in r2-probe / migrate-r2) |

---

## 1. Bugs found → fixed

| # | Bug | Where (file:line before fix) | Fix |
|---|---|---|---|
| 1 | **Audio-less multi-segment cut is broken.** `apply_cuts` appended the `[v{i}]` concat inputs only inside the `if has_audio:` branch, so the video-only path built `concat=n=N` with **0 inputs** — audio-less sources (or any captions-mode/auto-edit cut on a video with no audio track, i.e. `has_audio=False`) with ≥2 segments failed in ffmpeg. The caller swallowed it (`WARNING: silence cut failed — keeping the full timeline`), so the user silently got an un-cut video. | `pipeline/auto_edit.py:137-142` | Append `vl.append(f"[v{i}]")` unconditionally; audio inputs stay conditional. Verified: built graph for 2 segments now reads `[v0][v1]concat=n=2:v=1:a=0[vout]`. |
| 2 | **Failed renders left broken partial files that ship.** `render_clips.py` marks a render `ok=False` on validation failure (too short, no video stream, timeout mid-write), but Remotion's partial output file stayed on disk. The Upload, R2-publish and thumbnail steps glob `*.mp4` blindly, so a broken clip was **uploaded to Drive and R2, thumbnailed, and recorded as a clip row with a drive_url** — exactly the "ships garbage while reporting a failed clip" class the module was written to prevent. | `pipeline/render_clips.py:264-292` | Delete `output` whenever `result["ok"]` is False (before returning). A failed render now delivers nothing. |
| 3 | **Failed renders vanished from the DB records.** Combined with fix 2, the save-results step (which builds rows from the upload manifest) would see zero trace of a failed render — job completes with "fewer clips" and no explanation, contradicting render_clips' contract ("the clip row is marked failed so the dashboard can show it"). | `.github/workflows/process-video.yml` save-results heredoc (after the main clip loop) | Synthesize an explicit `status="failed"` clip row for every `render_report.json` result that is not `ok` and not delivered, so the dashboard still shows what happened. `error_message` keeps the "N of M clips could not be captioned (clip indexes [...])." |
| 4 | **Split-truncation silently drops the tail of long videos.** The Transcribe step split audio with `os.system(...)` and **never read the return code**. If ffmpeg died partway (disk full, runner killed, odd codec), the surviving chunks still transcribed and the step reported `TRANSCRIBE_OK` — a 4-hour video could ship a transcript missing its last hour, caption pages, and clips, while the job shows success. | `.github/workflows/process-video.yml` Transcribe heredoc (chunking block) | Use `subprocess.run`, fail loudly on non-zero split/copy rc, and add a **coverage check**: if `len(chunks) < ceil(src_dur / 300)` abort with `FATAL: audio split produced N/M chunks`. |
| 5 | **Direct-URL curl fast path accepts garbage downloads and hard-fails.** A `.mp4` link that returns an HTML error page or a non-video redirect "downloads successfully" with curl; the job then exits at the duration check without ever trying yt-dlp (the more robust fetcher). Also, direct files with common extensions (`mkv`, `avi`, `flv`, `3gp`, `mpg`, `mpeg`) fell through to the yt-dlp generic extractor and could get bot-checked despite being plain files. | `.github/workflows/process-video.yml` Download step | Validate the curl result with `ffprobe` (duration ≥ 5 s); on failure delete and fall through to the yt-dlp loop. Added the extra direct-file extensions to the fast path. |
| 6 | **Thumbnails reported success with no files.** The Generate-thumbnails heredoc did `made += 1` regardless of whether ffmpeg produced the `out` file (`check=False`), so `THUMBNAILS_OK count=N` printed with an empty folder, and uploads/R2 silently shipped nothing for the thumbnails. | `.github/workflows/process-video.yml` Generate thumbnails heredoc | Count only existing output files (`continue` with a logged reason when `out` is missing); keep `FATAL` when `made == 0`. |
| 7 | **`insert_clips` retry could double-insert.** The "delete then insert" idempotency reset never checked the DELETE response: a transient 4xx/reset hiccup passed silently (status < 500 returns immediately) and the POST then re-inserted, duplicating the clip gallery on a retry (and over-counting `clips_used` via the webhook). | `pipeline/db.py:136` | Check the DELETE status; raise `clip reset failed` on anything but 200/204 so the failure is loud instead of duplicated. |
| 8 | **Whole-video briefing lies about coverage under `max_sections`.** For a long video, `build_briefing` silently truncated to the first `max_sections` sections and then asked the merge LLM to produce a "whole-video" summary — the model (and every downstream viral prompt using it) believed it had seen the whole 4-hour video when it had seen only the first ~40 minutes, risking invented later content. | `pipeline/video_briefing.py` map-reduce path | Track truncation and add an explicit prompt note ("covers ONLY the first portion … never fabricate later parts"); report `sections_analysed` = analyzed count and new `sections_total` = real section count. |
| 9 | **A malformed 200 response killed an entire provider.** `resp.json()` sat outside the try in both Groq and Deepgram, so a 200 with a non-JSON body raised `ValueError` all the way out of `_transcribe_groq` / `_transcribe_deepgram`, burning **every model attempt** of that provider instead of moving to the next model / provider. | `pipeline/transcribe_providers.py:191-198` and `:259-262` | Wrap the JSON parse; on failure log and `break` to the next model. |

---

## 2. Migration must be applied live (NOT applied — working tree only)

**`supabase/migration_pipeline_fixes.sql`** — two fixes, both additive/backfill-safe, run in the
Supabase SQL Editor (or a new migration). **Do not edit applied migrations.**

1. `ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS render_error TEXT;`
   — `pipeline/db.py:insert_clip_errors()` PATCHes this column, but it was never created;
   the helper (whenever wired) silently failed.
2. Dedupe + `CREATE UNIQUE INDEX IF NOT EXISTS idx_clips_job_index_variant ON public.clips (job_id, clip_index, variant);`
   — makes the one-row-per-variant invariant the save-results retry logic depends on hold at the
   DB level, so a duplicated dispatch can never double-count clips (feeds `clips_used`).
   Existing duplicates are deleted first (oldest `id` kept) so the index builds cleanly.

---

## 3. Still at risk / owner actions (no code bug found, or out of scope)

| Risk | Notes |
|---|---|
| `videos_refunded` is never reset between a failed run and its retry. | A job that fails once (webhook refunds, flag set true) and then **fails again on a retry** will not be refunded the second time (`videos_refunded=eq.false` claim fails). Correctness depends on whether the dashboard re-reserves a slot on retry (`dashboard/src/app/dashboard/new/page.tsx:232` refund path). Out of pipeline scope — confirm with the dashboard/gateway owner. |
| `increment_clips_used` counts failed rows. | `job.clips_count = len(rows)` includes `status="failed"` clip rows, so `clips_used` over-counts when some renders fail. Minor; deliberate to keep the row count consistent with the dashboard. |
| A genuinely empty 5-minute chunk fails the job. | The provider chain returns empty for a speech-free chunk (long music intro / ambient section) and the workflow treats "chunk produced an empty transcript" as FATAL. Defensible (talking-head video with zero words from 3 providers is suspicious) but a pure-music segment can fail a good job. Consider `skip` instead of `FATAL` if it becomes a real incident. |
| Captions mode + extra formats (`--formats 9x16,1x1,16x9`) produces failed variant rows. | `run_captions_mode` writes no `cut_file`, so 1x1/16x9 variant renders fail ("no cut_file in prepare manifest") and are now reported as explicit failed rows (fix 3). No silent corruption; feature decision whether captions mode should support variants. |
| `clips.render_error` is unused. | The workflow doesn't call `db.insert_clip_errors()`; the column (migration above) is provided so wiring it up later works. |
| Reservoir sampling / byte budget of the `build_face_track` YuNet model download | `smart_reframe.py` handles all failure modes (falls back to centre crop with `REFRAME_WARN`); nothing silent found. |
| Concurrency is deliberately serial per job, `cancel-in-progress: false`. | Re-running the same job back-to-back is serialised by the concurrency group `clipmint-${{ job_id }}`; two *different* jobs never collide (separate runners). |

---

## 4. Notes on checked-but-clean areas

- **Provider chain / retries**: Groq (2 models × 3 attempts, backoff on 429/500/502/503) → Deepgram
  (3 attempts) → NIM (3 attempts). All-exhausted raises `RuntimeError` → named `transcribe` failure,
  never silent. A missing API key skips its provider with a log line. Language lock (`detected == "hi"`
  → Deepgram-first) and cross-chunk `forced` hints are correct; inverted/negative/oversized word spans
  are filtered in the workflow's `clean()` and re-gated by `validate_captions`.
- **Long audio** (3–4 h): split is a real 24 MB / 300 s chunker (not whole-file), and split success is
  now verified (fix 4). Each chunk is ~9.6 MB, safely under Groq/Deepgram single-request caps.
- **LLM chain** (`llm.py`): per-(provider, model) backoff; `response_format` rejection retried once
  without it; malformed 200 handled; hard 4xx moves to next model; per-model retry loop uses the
  `for…else` correctly.
- **Checkpoint/resume**: `.current_step` written per stage; resume restores captions/silences/viral
  and skips exactly the right steps; `viral_ready` gates viral detection; resume with
  `job_mode=captions` works (captions restored, synthetic moments regenerated). Resume source refetch
  failure fails loud (`RESUME_SOURCE_FAILED`).
- **Notify / failure**: `Notify completion` runs `if: always()` with `set -uo pipefail` (never fails the
  job); `Record failure` runs on `failure()` and sets `jobs.error_message` via `set_error`. Cancelled
  jobs are reported via the webhook without touching `error_message`.
- **R2 publish / cleanup**: missing R2 secrets mid-run exit 0 with a message; publish and cleanup are
  `continue-on-error`, so they never mask a real step failure; cleanup only ever runs on the success
  path (steps after a failure are skipped), matching its "failed job keeps the source" contract.
- **`r2-probe.yml` / `migrate-r2.yml`**: no bugs found. `migrate-r2` already resolves the Drive remote
  by parsing `rclone.conf` (the env-configured R2 remote sorts first in `listremotes`).