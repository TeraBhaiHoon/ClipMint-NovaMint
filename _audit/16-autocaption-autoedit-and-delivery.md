# 16 — Auto AI Captions, Auto-Edit, and Private Clip Delivery

**Date:** 2026-09-19 · **Status:** built, unit/E2E-tested locally; live path verified
for the dashboard build; GitHub-Actions E2E runs on the next dispatched job.

## What was added

### 1. Whole-video captions mode (`job_mode = "captions"`)
- `pipeline/prepare_clips.py --mode captions` emits exactly ONE prepared clip
  (`clip_000.mp4`) spanning the whole (optionally silence-cut) source plus a
  synthetic `viral_moments.json` — so render, thumbnails, upload and
  save-results all run **unchanged** (they just see a 1-clip job).
- Landscape sources get `layout: "fill"` (blur-fill letterbox) because a whole
  video cannot be face-tracked; portrait sources stay `cover`.
- Workflow gate: viral-moment detection (and its checkpoint) is skipped when
  `job_mode=captions`; `--remove-silences` is passed only in that mode.

### 2. Auto-editor (`pipeline/auto_edit.py`)
- Cut plan from **word gaps** (not audio energy, so music beds survive):
  gaps ≥ 450 ms are removed, 120 ms edge padding kept, runs < 900 ms merged,
  400-segment cap.
- One ffmpeg trim/concat pass; word timestamps remapped onto the cut timeline
  (midpoint test; words in removed gaps are dropped).
- Unit-tested against exact synthetic timings + a real ffmpeg cut (20 s →
  16.2 s, expected 16.16 s).
- Fixture E2E: `sintel_3min.mp4` 180 s → 117 s (63 s removed, 19 cuts),
  228 words remapped, captions fit the cut timeline, manifest duration matches
  the encoded file.

### 3. Punch-in zooms (engine)
- `CaptionedClip.tsx` gained `autoPunchIn` (zod schema + Root defaultProps +
  `build_props` env `CLIPMINT_AUTO_PUNCH_IN`).
- Zoom pulse: 150 ms ease-in to 1.06, 550 ms ease-out; driven by sentence
  starts derived from caption punctuation, throttled to one per 2.5 s.
- Applied to the video layer only (never the caption layer).

### 4. Private clip delivery (BUG FIX: "request access" on downloads)
- Root cause: downloads went through `drive.google.com/uc?export=download` on
  files that are not shared publicly — Google shows an access wall. Making them
  public would leak every user's clips to anyone with the link.
- Fix: pipeline step **"Publish clips to private storage"** copies each finished
  clip + thumbnail from the Drive archive (by file id) into the private
  `clip-outputs` bucket; `clips.storage_path` / `thumbnail_path` record the
  locations (Drive stays the internal archive).
- `GET /api/clips/[jobId]/links` is the ONLY way to read them: signed-in →
  job ownership checked **server-side** → 1-hour signed URLs. URLs are never
  stored; the job page mints them on demand and falls back to the legacy Drive
  view for pre-existing rows.
- Job page now: signed thumbnails, blob downloads (real "save file", not an
  iframe), native `<video>` preview, and the Drive button only for legacy rows.

### 5. Direct uploads (source videos)
- New **Upload Video** tab: private `video-uploads` bucket under
  `{user_id}/` (RLS: own folder only), 500 MB cap, ≤30 min enforced in the
  pipeline.
- `trigger-pipeline` mints a **fresh 7-day signed URL on every dispatch** from
  `jobs.video_storage_path` — a retry days later still works (a stored signed
  URL would have expired).
- Download step now fetches `.mp4/.mov/.m4v/.webm` URLs with `curl` (no
  YouTube cookies involved) and only falls back to yt-dlp.

## Migration (applied live)
`supabase/migration_captions_and_delivery.sql`: jobs.{job_mode, remove_silences,
auto_punch_in, video_storage_path}, clips.{storage_path, thumbnail_path},
buckets `clip-outputs` (private) + `video-uploads` (private, 500 MB limit),
RLS policies (insert/select own folder). Verified: 2 buckets, 4 job columns,
2 clip columns, 2 policies.

## Verification performed
- `auto_edit` unit tests + real ffmpeg cut; captions-mode E2E on the fixture;
  `build_props` layout/punch unit checks; remotion tsc clean; dashboard
  tsc clean + production build green; workflow YAML parsed (12 inputs,
  34 steps), all steps `bash -n` clean, all 13 embedded Python blocks compile.
- NOT yet exercised: a full dispatched Actions run with `job_mode=captions`
  (first real job will be the true E2E), and the publish step against live
  Drive (needs the next completed job).

## Notes / constraints
- `clip-outputs` has **no** client RLS policies on purpose: only the pipeline
  (service role) writes and only the signed-URL route reads.
- Thumbnails are shared per clip index across aspect variants (signed once).
- Publishing is `continue-on-error` — a publish failure never fails a job, and
  the dashboard transparently falls back to the archive links.
