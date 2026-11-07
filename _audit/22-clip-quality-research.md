# 22 — Clip-quality research: free tools, licences, CPU cost on the runner

Date: 2026-11-07. Author: agent round "review + quality instruments + redesign".
Scope: what can measurably improve OUTPUT CLIP quality using FREE, SaaS-licence-safe
tools that run on a GitHub-hosted `ubuntu-latest` runner (4 vCPU, 16 GB RAM, ~14 GB
disk, no GPU, 6 h job limit) inside the existing
`.github/workflows/process-video.yml` pipeline. Every external claim is cited;
anything I could not verify from a primary source is marked **UNVERIFIED**.

Baseline facts used throughout (verified in this repo): 3 h source → ~75 min total
(2.5 min download via WARP, 1.5 min Groq transcription, 32 min LLM analysis, 29 min
prepare, 15-shard render). CPU encode budget for one 30 s clip is ~5–20 s
(veryfast CRF18, measured in fcd3605's A/B).

---

## 1. What the pipeline already does right (do not re-do)

- **Two-pass EBU R128 loudness** with verification (`pipeline/enhance_audio.py`) —
  re-measures the OUTPUT so `lufs_out` is a fact. Calibrated, honest auto-heuristics
  for denoise/de-ess with stated caveats.
- **Face-aware reframe with identity lock** (`pipeline/smart_reframe.py`, 61ce493) —
  max raw track error 43 px, 6 px while an intruder is in shot.
- **Caption gate** (`pipeline/validate_captions.py`) — overlap repair + 30 % coverage
  floor, applied in BOTH the viral step and prepare.
- **Jump-cut tightening** (54a0c35) — pauses + unambiguous fillers inside clips mode,
  captions remapped, variants kept in sync.
- **Quality instrument** (a340c10, `pipeline/clip_qa.py`) — one ffmpeg pass per clip:
  loudness, true peak, black/freeze, dead air, resolution/fps/bitrate, caption
  coverage → 0–100 score + per-check breakdown on `clips.quality_score/_report`.

---

## 2. Candidates reviewed

### 2.1 Speech denoise beyond afftdn

| Tool | Licence | Runner cost (30 s clip) | Verdict |
|---|---|---|---|
| ffmpeg `arnndn` + RNNoise-class model | Models: LGPL (std.rnnn from Xiph RNNoise); `mpirp9nbsd.rnn` in [richardpl/arnndn-models](https://github.com/richardpl/arnndn-models) — repo has no explicit licence file → **UNVERIFIED**, treat as usable-but-confirm | ~2–4 s decode-bound; model file ~2 MB fetched once | **ADOPT as second-stage**: only when `afftdn` is already ON (SNR band 6–35 dB) and measured noise bed > −45 dBFS, because RNNoise-class models preserve speech better than FFT gating on broadband noise. Community reports a faint residual hiss ([r/ffmpeg](https://www.reddit.com/r/ffmpeg/comments/17pzty7/arnndn_noise_suppression_question)) — keep `afftdn` first, add `arnndn` only in the noisy band, and gate the whole thing behind the QA loudness/silence checks. |
| [DeepFilterNet](https://github.com/rikorose/deepfilternet) | MIT (code); model weights licence **UNVERIFIED** — confirm before SaaS use | RTF ≈ 0.19 on ONE CPU thread ([arXiv 2110.05588](https://arxiv.org/html/2110.05588v2)) ≈ 6 s per 30 s clip + pip install (~200 MB with torch → too heavy) | **DEFER**: MIT is fine, RTF is fine, but the torch dependency blows the runner install budget for a gain that only matters on genuinely noisy sources. Revisit if users complain about noise specifically. LADSPA plugin path exists (`libdeep_filter_ladspa.so`) but adds packaging complexity. |
| `anlmdn` | built-in | slower than afftdn at similar quality | skip — afftdn already measured/calibrated |

### 2.2 Word-timing accuracy → caption sync

The STT chain (Groq whisper-turbo → Deepgram nova-3 → NIM Riva) already returns word
timestamps; the caption gate repairs ASR jitter. Measured in prod: drift is dominated
by jump-cuts, which `remap_words` now handles exactly (midpoint test, proven by the
tighten E2E: last word ends 20759 ms in a 20790 ms clip).

- **WhisperX forced alignment** (wav2vec2, [github](https://github.com/m-bain/whisperX),
  BSD-4-Clause — the "non-commercial" clause applies to **models** trained by the
  project, not the library; the ASR models it aligns are OpenAI/Riven downloaded
  separately) — **DEFER**: adds a torch dependency + a model download to the runner for
  a timing problem we already solved structurally. Only revisit if a provider ever
  returns millisecond-level garbage that the repair pass cannot clamp.
- **ffmpeg `silencedetect` snap** — already used (`prepare_clips.snap`). No change.

### 2.3 Video look: denoise/deblock/sharpen/grade

All built-in ffmpeg filters, zero install cost, ~1.2–1.8× decode time per filter on
1080p (measured locally: `hqdn3d` 1.3×, `unsharp` 1.2×, `eq` ≈1× on a 30 s clip —
**UNVERIFIED on the runner**, re-measure before enabling by default):

- **`hqdn3d`** (spatio-temporal denoise, built-in): worthwhile ONLY for low-light /
  phone-in-dark sources. Auto-gate idea: enable when `clip_qa` measures high noise
  (astats RMS spread). Priority MEDIUM.
- **`unsharp=5:5:0.6`** after scaling to 1080×1920: recovers crispness lost to the
  reframe scale. Priority MEDIUM — A/B on real footage before shipping; over-sharpen
  reads as "AI upscaled".
- **Colour normalisation**: `normalize` filter is risky (shifts branded colours).
  The asset library already ships LUTs (`pipeline/assets_manifest.json`) — a mood→LUT
  grade is the safer creative path. Priority LOW (subjective).
- **AI upscaling (Real-ESRGAN etc.)**: CPU RTF ≫ 1 at 1080p — **REJECT** on runners
  (hours per clip). GPU-only paths are also REJECT (no GPU).

### 2.4 Framing / multi-speaker

`smart_reframe` handles single-subject identity lock. Multi-face layouts (two-person
podcasts cropped to show both) need a layout decision inside the reframe output
geometry — 61ce493's tracker already tracks the ACTIVE speaker; switching layout
mid-clip is a design change with regression risk. Priority LOW-MEDIUM: first step
would be logging both faces' presence in `REFRAME_` markers, then a split-screen
mode behind a flag. **UNVERIFIED effort** — needs a two-person fixture like
`_audit/verify_reframe.py` builds.

### 2.5 Captions (highest visible-quality lever)

Platform safe zones for 1080×1920 ([reloop.so](https://reloop.so/blog/article/social-media-safe-zones),
[orsonlord.com](https://orsonlord.com/articles/free-safe-zone-overlays-for-reels-tiktok-and-shorts)):
bottom ~10–15 % (caption/description UI), right edge (action rail), top ~10 %
(username/progress). Recommendation: **bake a safe-zone clamp into
`CaptionedClip.tsx`** — cap caption-page Y so no glyph crosses 82 % frame height and
shift horizontal insets by ~60 px each side; platform-specific variants stay
unnecessary since all three platforms overlap heavily in the middle band. Priority **HIGH**,
pure-frontend, testable in Remotion studio.

Keyword emphasis (colour/scale pop on keywords), emoji, per-language line breaking:
already partially present in the caption engine styles. Next increment: LLM marks
`emphasis: true` on 1–2 words per page in the ranking JSON (schema change, prompt
tweak, engine reads it). Priority MEDIUM-HIGH — visible pop, cheap.

Devanagari/Hinglish: many users speak Hindi. The current font stack (Syne/Inter/
JetBrains Mono) has NO Devanagari glyphs → Hindi captions fall back to system fonts
with inconsistent metrics. Fix: bundle an OFL Devanagari face that harmonises with
Inter — **Noto Sans Devanagari** or **Baloo 2** (both SIL OFL 1.1, on Google Fonts,
self-hostable via next/font). Priority **HIGH** (correctness for a core user group).

### 2.6 B-roll / stock (Pexels/Pixabay)

- [Pexels API](https://www.pexels.com/api/): free, attribution appreciated not
  required, API key needed. **UNVERIFIED rate limits** (community: 200 req/h).
- [Pixabay API](https://pixabay.com/api/docs/): free, key needed, attribution not
  required. Content-quality filter needed (scrape-free? both allow hotlinking only
  via their CDN URLs — verify ToS before embedding).
- Verdict: **DEFER** — big feature (selection UI + licence surface + storage),
  moderate quality gain for talking-head podcasts (b-roll mainly helps listicle/
  news content). The asset library (7039918) already gives BGM/SFX/LUT structure to
  extend later.

### 2.7 QA instruments — DONE this round (a340c10)

`clip_qa.py` covers loudness/true-peak/clipping/black/freeze/dead-air/resolution/
fps/bitrate/caption-coverage, stores `quality_score` + `quality_report`. Remaining
increment: **caption-sync drift metric** (compare first caption start to first
non-silence audio after t=0; flag >0.5 s) — cheap, add to clip_qa when needed.

---

## 3. Prioritised build list (impact × confidence ÷ effort)

1. ~~Caption safe-zone clamp~~ — **ALREADY BUILT**: `CaptionedClip.tsx` defines
   per-platform SAFE_AREAS (bottom 280–340 px, right 110–150 px, top 110–140 px,
   left 60) and anchors the caption column inside them (discovered while
   implementing item 2; do not re-build).
2. ~~Devanagari font bundle~~ — **DONE same round**: Baloo 2 (SIL OFL, loaded via
   @remotion/google-fonts at the pinned version) now carries Devanagari as a
   fallback after Inter on every caption site; verified with a real Hindi render
   (proper conjunct shaping, active-word highlight, safe-area respected).
3. **Keyword emphasis pop** (2.5) — ranking JSON `emphasis: []`, engine scales
   1.15× + accent colour on marked words; schema is additive.
4. **arnndn second-stage denoise** (2.1) — `enhance_audio` gains `arnndn` after
   `afftdn` only in the noisy band; fetch `mpirp9nbsd.rnn` once into the workflow;
   A/B with the QA loudness metric before defaulting on.
5. **clip_qa sync-drift check** (2.7) — first-caption vs first-audio delta; warns
   in the report.
6. **`unsharp` after reframe** (2.3) — behind a flag, A/B on the fixture before
   defaulting.
7. **Two-face layout logging → split-screen mode** (2.4) — start with REFRAME_
   logging; layout mode only if podcasts commonly two-shot.
8. **Pexels/Pixabay b-roll** (2.6) — only after user demand; reuse the asset-library
   licence-gate pattern.

## 4. Explicitly rejected

- **AI upscaling** — CPU RTF ≫ 1; GPU unavailable. Hours per clip.
- **WhisperX / DeepFilterNet now** — torch dependency vs. solved problem; revisit on
  evidence of user pain.
- **`normalize` colour filter** — shifts brand colours unpredictably; LUTs instead.
- **Cookies for downloads** — WARP egress is the primary path by owner decision;
  cookies system removed entirely (5d39991).
- **GPL-only denoisers / non-commercial model weights** — SaaS distribution risk
  without a licence audit; everything adopted above is MIT/BSD/OFL/built-in.
