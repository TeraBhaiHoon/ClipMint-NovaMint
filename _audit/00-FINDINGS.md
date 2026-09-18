# ClipMint — Root-Cause Findings & Fixes

**Date:** 2026-09-18
**Scope:** "fix the issues it's facing when running or triggering the automation pipeline and processing the videos", then raise output quality to an enterprise standard using free resources.

Everything below was verified against the live system (GitHub Actions logs, the
production Supabase database, the real Groq key) rather than inferred from
reading code. Where a claim comes from a live probe, the probe is named.

---

## TL;DR — what was actually broken

The most important finding is not a crash. **ClipMint was delivering
uncaptioned videos while reporting every job as successful.**

The pipeline's caption-render step ended with:

```bash
npx remotion render ... || { echo "failed"; cp "$clip" "$OUTPUT"; }
```

Remotion was failing on *every single clip*, and that fallback silently copied
the raw clip instead. The job was then marked `done`, the user was emailed
"your clips are ready", and the clips had no captions at all — the one feature
the product exists to provide. This was confirmed in the logs of run
`35316799094`, the run recorded as **successful**:

```
Rendering clip_000 (20.000000s → 600 frames) with typewriter style...
Version mismatch:
- On version: 4.0.434
  - @remotion/bundler, @remotion/cli, remotion, @remotion/media-utils, ...
- On version: 4.0.526
  - @remotion/google-fonts, @remotion/media
  ⚠️ Remotion failed for clip_000 — copying raw clip
  ⚠️ Remotion failed for clip_001 — copying raw clip
  ⚠️ Remotion failed for clip_002 — copying raw clip
✅ Caption rendering complete
```

A silent fallback turned a total feature failure into a green build.

---

## 1. Critical defects (all fixed)

### 1.1 Remotion version mismatch aborted every render
`@remotion/media` and `@remotion/google-fonts` were added to `package.json` as
`^4.0.0` but were absent from `package-lock.json`. CI's `npm install` honoured
the lockfile for existing packages (4.0.434) and resolved the new ones to latest
(4.0.526). Remotion requires one version across all packages and refuses to
render otherwise.

**Fix:** all `@remotion/*` packages pinned to `4.0.526`, lockfile regenerated,
`npm ci` in CI. A version-print step now makes a future mismatch obvious in the
logs. **This removes the silent fallback entirely** — see §1.2.

### 1.2 A failed render shipped an uncaptioned clip
`render_clips.py` now renders each clip independently and records its true
status. A failed render is reported as failed and its clip row is marked
`failed`; it is never replaced with a raw copy. If *every* render fails the job
fails outright. Partial failure completes the job but names the failed indexes
in `jobs.error_message`.

### 1.3 Captions vanished after ~1.2 seconds
Two faults compounded:

1. Page grouping used `createTikTokStyleCaptions`, which only starts a new page
   when a caption token **begins with a space** (verified in
   `@remotion/captions/dist/create-tiktok-style-captions.js`). The transcription
   step calls `.strip()` on every word, so no token ever began with a space and
   an entire clip collapsed into a single page.
2. Each page's `<Sequence>` was capped at 1200 ms, so after the first 1.2
   seconds there was nothing left to draw.

The Studio preview masked this because its sample captions *do* have leading
spaces.

**Fix:** grouping is now done in `CaptionedClip.tsx` by word count, character
count, pause length and sentence end — none of which depend on whitespace.

**Verified:** rendered a 34.5 s clip from production-style captions (explicitly
asserted to contain zero leading/trailing spaces) and sampled every 0.5 s:
**68 of 68 frames contained captions, zero gaps.** The same measurement against
the old engine stopped finding captions after the first second.

### 1.4 `trimAfter` truncated clips to ~1.5 seconds
`trimAfter` on `<Video>` is an **absolute source frame index**, not a trim
length (confirmed in `@remotion/media/dist/esm/index.mjs`, `getTimeInSeconds`:
playback ends when `timeInSeconds >= (trimAfter - trimBefore) / fps`). The code
passed `ceil(trimEndSec * fps)`, so any clip with trailing silence was cut to
its first ~1.5 seconds.

**Fix:** trimming moved out of the renderer entirely. `prepare_clips.py` cuts
precisely with ffmpeg, so the file handed to Remotion is already exactly the
right span and the caption timeline is re-zeroed to the *real* cut start. The
Remotion trim props keep correct semantics for manual use.

### 1.5 The audio analyser crashed whole renders
`useWindowedAudioData` calls `cancelRender()` — which cannot be caught — when it
cannot decode a track. It was called unconditionally, so any clip without audio
aborted the render, and a missing `public/silence.mp3` broke captions-only
renders too.

**Fix:** audio reactivity is opt-in, mounted through a context provider only
when the caller asserts both `hasAudio` and `audioReactive`. The pipeline sets
`hasAudio` from `ffprobe`. Default is `false`, so the crash is impossible unless
a caller actively lies. Tested: a silent clip with `audioReactive: true` but
`hasAudio: false` renders fine.

### 1.6 Double audio
The blurred background video was unmuted, mixing the same audio track into the
export twice (+~6 dB).

### 1.7 Fade / Minimal exits and Typewriter never worked
They read `useVideoConfig().durationInFrames` — the **composition** length —
instead of the page length. Fade-outs never fired on any clip, and the
typewriter revealed roughly 0–2 characters per page on a long clip.

### 1.8 Bounce crashed on short pages
The exit window could be computed backwards (`[48, 46]`), and Remotion throws
`inputRange must be strictly monotonically increasing`.

### 1.9 The viral-moment LLM was dead
`llama-3.3-70b-versatile` returns **HTTP 404 `model_not_found`** on this
account's own key (probed live). The account exposes 13 models; the working chat
models are `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `openai/gpt-oss-safeguard-20b`,
`groq/compound`, `groq/compound-mini`, `qwen/qwen3.8-27b`. A hand-fix to
`gpt-oss-120b` landed on `main` mid-session; it is now a three-model fallback
chain.

### 1.10 The transcription fallback could never have worked
`NVIDIA_NIM_API_KEY` is set and valid, but the account exposes **82 models and
zero ASR-capable ones** (probed live) — the configured
`nvidia/parakeet-ctc-1.1b-asr` does not exist. Removed rather than left as
decoration. Groq `whisper-large-v3-turbo` → `whisper-large-v3` is the real
chain, and both were confirmed working.

---

## 2. Why jobs "never updated" in the dashboard

`select count(*) from pg_publication_tables where pubname='supabase_realtime'`
returned **0**. Neither `jobs` nor `clips` was in the Realtime publication, so
every `postgres_changes` subscription silently never fired: a job page loaded as
`queued` and stayed that way forever. There was also no polling fallback and no
stuck-job recovery, so a job that never dispatched was a dead end.

**Fixed and applied live:** both tables are now in the publication with
`REPLICA IDENTITY FULL` (without which an UPDATE payload carries only the
primary key and would have wiped the row in the browser). The UI additionally
polls while a job is running and offers a retry after 45 minutes.

---

## 3. Why the pipeline failed to start (download failures)

Four of five runs on 2026-09-18 failed at the download step. Verified causes:

| Run | Error | Root cause |
|---|---|---|
| `35315463706` | `Unsupported URL` | The user pasted ClipMint's own dashboard URL. yt-dlp's generic extractor had nothing to work with. |
| `35313813186`, `35313926993` | `Sign in to confirm you're not a bot` + `cookies are no longer valid` | YouTube cookies had rotated. |
| `35314906414` | n-challenge solver failure | Same cookie/JS-runtime path. |
| `35316799094` | — | Succeeded *after* the cookies were refreshed at 06:26 on the same day. Confirms cookies were the trigger. |

**Fixes:**
* URL validation with a provider allowlist (YouTube, Instagram, Facebook,
  Vimeo, Google Drive, direct media) *before* a job is created, in the form and
  again server-side. The pasted-dashboard-URL case is now rejected instantly
  with a plain-language reason instead of burning a CI run.
* Download retries across four yt-dlp player clients, which is the standard
  remedy for YouTube bot checks.
* Download is validated (size, decodability, duration ≥ 5 s) before
  transcription.
* Named diagnoses printed on failure: `YOUTUBE_BOT_CHECK`,
  `YOUTUBE_COOKIES_STALE`, `UNSUPPORTED_URL`, `ACCESS_DENIED`.

**Still a live operational risk:** YouTube cookie rotation is inherent to this
download method. `YOUTUBE_COOKIES` is a manual secret that will expire again.
The durable fix is to accept user uploads directly — see §6.

---

## 4. Security and correctness

* **Shell injection (fixed).** `video_url` came from the request body, was
  written to the DB, and was then interpolated into bash via
  `"${{ inputs.video_url }}"`. A URL containing `$(...)` would have executed on
  the runner with repo secrets present. Every `${{ inputs.* }}` inside a `run:`
  block is now passed through `env:` instead. Verified with a 13-case test
  (`_audit/test_url_regex.py`).
* **The trigger trusted the request body over the database.** It re-read the
  job's own `video_url`, `caption_style` and `max_clips`.
* **Quota was browser-side only.** The `max_clips` clamp was dead code (the same
  closure still inserted the old value), a failed profile fetch skipped every
  check, and `increment_videos_used` incremented unconditionally with no limit
  guard. Now atomic and server-enforced, returning `false` on refusal.
* **Webhook bookkeeping could stop silently.** `new Resend(...)` ran before the
  auth check and before any DB write, so a missing `RESEND_API_KEY` 500'd the
  endpoint and `clips_used`/`videos_used` were never updated. Email is now
  best-effort and its HTML output is escaped.
* **Secrets in the repo.** `keep-alive.yml` hardcoded the Supabase URL and an
  anon JWT in a public repository. *(Not yet fixed — flagged in §6.)*

---

## 5. Quality upgrades

**Captions**
* Platform safe areas for TikTok / Reels / Shorts. Measured bottom margin on the
  rendered output is 353 px, clear of the ~320 px UI strip; side margins 81–306 px.
* Karaoke-style progressive fill sweeps the active word in time with the voice.
* Auto font shrink so a word like `CRYPTOCURRENCY` cannot overflow the column.
* Explicit line height, text stroke on every style, a bottom-weighted scrim
  instead of a blanket vignette, and a progress bar.
* All timings expressed in seconds and converted by fps, so 30 fps and 60 fps
  renders match.
* Typewriter no longer uses system monospace (which fell back to DejaVu on the
  Linux runner and never matched the Studio preview).

**Video**
* **Auto-reframe to 1080×1920 with face tracking** (`pipeline/smart_reframe.py`,
  OpenCV YuNet — MIT, commercially safe). Previously a landscape source rendered
  as a letterboxed band occupying ~32% of a vertical frame. Now the speaker fills
  the frame. Measured: crop followed a moving face to within 0.7% of travel.
* **Loudness normalised to −14 LUFS / −1 dBTP** (`pipeline/enhance_audio.py`),
  the level the platforms normalise to. Measured output: **−13.95 LUFS, 0.05 LU
  from target**. Previously clips went out at whatever level the source had.
* Clips now report a real `duration_seconds` (the UI badge had always been dead).
* Thumbnails composite a title band over a blurred keyframe instead of being a
  bare frame grab.

**Verification matrix:** all 9 caption styles render, plus no-audio,
audio-reactive, landscape-`fill`, and trim paths — 13/14 passing, where the one
failure is the deliberate "caller lies about `hasAudio`" case that documents the
interlock.

---

## 6. Recommended next, not done here

1. **Accept direct uploads.** Every download-related failure disappears if users
   upload their own file (Supabase Storage or Cloudflare R2 — R2 has 10 GB free
   and **zero egress fees**). This is the single highest-leverage reliability
   change and also removes a ToS grey area around downloading third-party video.
2. **Rotate the committed anon JWT** in `.github/workflows/keep-alive.yml` and
   move it to a secret.
3. **Remotion licensing.** Remotion's free licence covers organisations up to
   3 employees; their "Automators" tier is $0.01/render with a $100/month
   minimum and is aimed squarely at automated video products. Confirm in writing
   which applies before scaling.
4. **Adopt the free tiers identified but not yet wired**
   (`_audit/03-free-resources-research.md`): Gemini's free tier for long-context
   moment detection, Cloudflare R2 for delivery, Modal's $30/month free GPU for
   optional upscaling.
5. **Render throughput.** Rendering is sequential per clip at
   `--concurrency=2`; on a 4-vCPU runner this is the dominant cost. Sharding
   across a matrix job would cut wall-clock time roughly linearly.
