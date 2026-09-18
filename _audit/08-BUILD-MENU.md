# ClipMint — Build Menu: Free Resources & Enterprise Upgrades

**Date:** 2026-09-18 · For review — pick items, and they get built.
**Sources:** full verified research in `_audit/03-free-resources-research.md` (every number read off live vendor pages on 2026-09-18). Remotion licence + R2 pricing re-verified independently the same day.

---

## A. ALREADY BUILT (2026-09-18 session — do not re-build)

| Capability | What shipped | Proof |
|---|---|---|
| Caption engine v2 | Own page-grouping (word/char/pause/sentence based), karaoke word-fill, platform safe zones (TikTok/Reels/Shorts), auto font-shrink, fps-independent timing, progress bar, watermark, 9 styles all rendering | Captions present in **68/68 sampled frames** of a 34.5s clip; 13/14 render matrix passed |
| Auto-reframe to 1080×1920 | `pipeline/smart_reframe.py` — OpenCV **YuNet** face tracking (MIT), EMA-smoothed crop track, velocity clamp, center fallback | CI log on real footage: `mode=face confidence=0.9085 out=1080x1920 strategy=dynamic` |
| Audio mastering | `pipeline/enhance_audio.py` — 2-pass loudnorm to **−14 LUFS / −1 dBTP**, auto denoise, highpass | Measured **−13.95 LUFS** (0.05 LU from target) |
| Pipeline rewrite | 29 steps, stage-named errors, download retries across 4 yt-dlp player clients, named diagnoses, parallel render, **no silent fallbacks** | 3 live end-to-end runs green, real speech 1992 words → 2/2 clips captioned |
| LLM migration | `openai/gpt-oss-120b` → `gpt-oss-20b` → `qwen3.8-27b` chain (old model returns HTTP 404 — verified live) | VIRAL_OK moments=2 top_score=98 |
| Dashboard/gateway/db | Realtime publication fixed (live-applied), polling fallback, server-side quota (atomic RPCs, live-applied), URL validation + tracking-param stripping, Drive preview modal, webhook hardening | Migrations verified in `pg_publication_tables`; builds green |
| Dead-dependency cleanup | NVIDIA NIM ASR fallback removed (account has 82 models, **zero** ASR-capable — verified live) | — |

Also noted: the repo is **public** (`isPrivate: false` verified), so Actions already grants the full **4 vCPU / 16 GB** runner — the "you may be on half the machine" warning does not apply.

---

## B. BUILD CANDIDATES — ranked by impact × effort

### B1. Direct uploads + Cloudflare R2 delivery ⭐ the big one
- **Replaces:** Google Drive + rclone + `YOUTUBE_COOKIES`.
- **Verified limits (2026-09-18):** R2 free = **10 GB-month storage, 1M Class A ops, 10M Class B ops, egress FREE**; then $0.015/GB-month. B2 overflow: first **10 GB free**, egress to Cloudflare free.
- **Why:** the #1 cause of pipeline failure is YouTube cookie rotation (caused 4 of 5 failures before the fix). Uploads make it impossible, remove a ToS grey area, and R2's zero egress is the cost lever that matters for a video SaaS. Supabase Storage (1 GB / 5 GB egress) cannot hold video.
- **Effort:** Medium — presigned upload flow in the dashboard, storage bucket + custom domain, swap the upload step from rclone to S3 API.
- **Licence:** none implicated.

### B2. Hindi/Hinglish transcription upgrade
- **What:** route Hindi/Hinglish audio to **Deepgram Nova-3 Multilingual** ($0.0052/min) paid from their **$200 free credit, no expiry, no card** — ≈38,000 free minutes — and/or a second pass with **AI4Bharat IndicConformer-600m** (self-host, **MIT**, Hindi WER 13.2, 22 Indic languages), keeping whichever transcript scores higher.
- **Why:** Whisper-turbo is the weak link on code-switched Indian speech; no vendor publishes Hinglish WER, so this is also the A/B harness to measure it (build a 20-clip golden set).
- **Effort:** Medium. **Licence:** AI4Bharat MIT — safe.

### B3. Local Whisper.cpp ASR — remove all cloud ASR ceilings
- **What:** `@remotion/install-whisper-cpp` with `large-v3-turbo` + `tokenLevelTimestamps: true` (`t_dtw` timestamps, most accurate available for caption sync).
- **Why:** kills Groq's **25 MB upload cap** and **8 h/day** ceiling entirely; zero marginal cost. Runs on the Actions CPU (slower per-minute than Groq's API — use as overflow or the accuracy path, not necessarily primary).
- **Effort:** Low–Medium. **Licence:** MIT.

### B4. Gemini free tier for moment detection
- **What:** Gemini 2.5 Pro / 2.5 / 3.5 / 3.8 Flash are **"Free of charge"** for input and output (verified). Wire as primary with the existing Groq chain as fallback.
- **Why:** best free long-context option; 131K-token Groq context forces windowed analysis, Gemini can consider more transcript per call. Note: chunked analysis sometimes beats single-shot long-context — A/B before switching default.
- **Effort:** Low. **Risk:** per-model RPM/RPD no longer published (verified) — caps may change without notice; keep the Groq fallback.

### B5. GPU enhancement pass on Modal's free $30/month
- **What:** Real-ESRGAN (**BSD-3**) upscale + GFPGAN (**Apache-2.0**) face restore as an optional "HD" tier, burst on **Modal Starter ($30/month free compute, T4→B300 GPUs)**.
- **Why:** impossible on Actions CPU; turns phone footage into publishable quality. $30/mo is a hard ceiling — gate it per-plan.
- **Effort:** Medium-High. **Licence:** both GO (skip CodeFormer — see NO-GO).

### B6. Devanagari fonts for Hindi captions
- **What:** `@remotion/google-fonts` `loadFont()` with a Devanagari font (e.g. Noto Sans Devanagari) + the transliteration path kept as fallback.
- **Why:** tofu boxes destroy credibility with Indian creators instantly. A few lines.
- **Effort:** Trivial. **Caveat:** Devanagari availability in the package was **UNVERIFIED** — 5-minute test first.

### B7. Render throughput: matrix sharding (free, on the current stack)
- **What:** split clips across an Actions matrix job (N runners × `--concurrency 2`), merge results at the end. Optional escape hatch for >6 h jobs: **Cloud Run Jobs (240,000 vCPU-s + 450,000 GiB-s free/month, resets monthly)**.
- **Why:** render is the wall-clock bottleneck (~2 min for 2 clips). Sharding scales near-linearly and is free on public repos.
- **Effort:** Medium.

### B8. Cloudflare Workers AI burst capacity
- **What:** `@cf/openai/whisper-large-v3-turbo` (**≈214 free audio-min/day, DERIVED**) + `glm-5.3` (**1.3M ctx**) / `deepseek-v4-flash` for whole-transcript analysis. 10,000 neurons/day free.
- **Why:** overflow when Groq's 8 h/day or 200K TPD is exhausted; infra already in the stack.
- **Effort:** Low-Medium.

### B9. Free BGM / SFX / b-roll
- **What:** optional auto-background-music and whoosh/pop SFX from **Pixabay** and **Pexels** (free commercial, no attribution). Filter Freesound to **CC0/CC-BY only**.
- **Why:** full-cap clips feel finished; SFX on word-pop is a Submagic-grade differentiator.
- **Effort:** Medium.

### B10. Scene detection for cut points
- **What:** ffmpeg `scdet`/`select='gt(scene,)'` boundaries merged with silence snapping in `prepare_clips.py`.
- **Why:** avoids opening on a camera transition; local and free. (This was TIER 2.1 in IMPROVEMENTS.md, never built.)
- **Effort:** Low-Medium.

### B11. Hygiene (30 minutes total)
- Rotate the **anon JWT hardcoded in `.github/workflows/keep-alive.yml`** (public repo!) → repo secret.
- One email to hi@remotion.dev for written licence confirmation (see §C).

---

## C. LICENSING — GO / NO-GO (verified 2026-09-18)

**GO (commercially safe):** MediaPipe (Apache-2.0) · YuNet (MIT) · Real-ESRGAN (BSD-3) · GFPGAN (Apache-2.0) · SAM 2 (Apache-2.0) · AI4Bharat IndicConformer (MIT) · `@remotion/*` (MIT) · Pixabay / Pexels (free commercial, no attribution) · Deepgram/AssemblyAI/ElevenLabs paid-from-credit usage.

**NO-GO (would poison a closed SaaS):**
- **CodeFormer** — NTU S-Lab, non-commercial. Use GFPGAN instead.
- **InsightFace models** (`buffalo_l` etc.) — code MIT, **models non-commercial research only**.
- **Ultralytics YOLO** — **AGPL-3.0 including all trained models**; Enterprise licence required for any SaaS.
- **Freesound CC-BY-NC** — filter to CC0/CC-BY in code.
- **Mixkit** — silent on SaaS-embedded generation; use Pixabay/Pexels instead.

**Remotion — re-verified personally today, and the risk is LOWER than the research agent reported.** The licence FAQ states the Free License (up to 3 people, commercial use, unlimited renders, **no revenue threshold**) explicitly **permits automations for Free-License-eligible companies**, and ClipMint's flow (users submit raw video → you render your own template) matches the FAQ's accepted example. The paid Automators tier ($0.01/render, $100/mo min) exists, but the FAQ does not force it on a solo founder. Still worth one email for written confirmation; worst case $100/month. One hard line: **never let users upload their own Remotion projects** — that voids the Free License.

---

## D. CORRECTIONS to the research agent's top-10 (so you don't rebuild things)

1. **"Move to Gemini, the model is dead"** — half done: migrated to Groq `gpt-oss-120b` already; Gemini is B4.
2. **"MediaPipe for reframe"** — done differently: YuNet (MIT) shipped and verified on real footage; equivalent purpose. MediaPipe FaceLandmarker remains an *upgrade* path if you want landmark-based framing.
3. **"`createTikTokStyleCaptions()` for pagination"** — **evaluated and rejected**: it only breaks pages when a token starts with a space, and transcription strips whitespace — this exact behaviour collapsed production captions to one page. Custom grouping shipped instead and is verified.
4. **"Make the repo public for 4 vCPU"** — already public; already on the bigger runner.
5. Everything else in the top-10 maps to B1–B9 above.

---

## E. Explicitly dead ends (don't spend time)

GitHub Models (retired 2026-07-30) · Cloudflare Containers (no free tier) · Fly.io free allowance (gone) · Cerebras permanent free tier (gone; $5 trial only) · Colab as production (ToS forbids media serving) · Kaggle as production (quota claims unverified, non-production posture) · HF Spaces free tier (regressed; 5 GPU-min/day) · free cloud upscaler APIs (none exist) · any vendor's published Hinglish WER (nobody publishes it — measure it yourself per B2).
