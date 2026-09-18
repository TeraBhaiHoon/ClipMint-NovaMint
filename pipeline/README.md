# ClipMint video pipeline tools

Two self-contained CLI scripts for the vertical short-form pipeline. No external
state, no network access at runtime (except one optional model download in
`smart_reframe.py`), no third-party deps in the audio tool.

| Tool | Purpose | Deps |
|---|---|---|
| `smart_reframe.py` | Reframe any-aspect clip to vertical 9:16, keeping the speaker in frame | `opencv-python-headless`, `numpy` (optional — degrades to centre crop) |
| `enhance_audio.py` | Broadcast-style loudness + cleanup for the final cut | none (ffmpeg/ffprobe only) |

Output format for both: **vertical 1080x1920, 30 fps, H.264 High@4.1 + AAC 160k/48 kHz,
`+faststart`**, suitable for Reels / Shorts / TikTok.

---

## Install

```bash
python -m pip install -r pipeline/requirements.txt   # only needed by smart_reframe.py
```

`ffmpeg` / `ffprobe` must be on `PATH`. Both scripts exit `0` on success and
non-zero with a clear `*_ERROR` message on failure. Every run ends with a
greppable machine-readable marker on **stdout**:

```
REFRAME_OK    mode=face crop=607x1080 samples=23 confidence=0.8100 ...
REFRAME_SKIP  already_vertical ...
REFRAME_WARN  <reason> ...
ENHANCE_OK    lufs_in=-21.8 lufs_out=-14.1 denoise=off deess=off ...
ENHANCE_SKIP  no_audio ...
ENHANCE_WARN  <reason> ...
```

`REFRAME_WARN` / `ENHANCE_WARN` are non-fatal. A `*_OK` line normally follows them.

---

## Tool 1 — `smart_reframe.py`

Turns a landscape clip into a 9:16 vertical clip that keeps the speaker in frame,
instead of the current blur-filled letterbox with a small horizontal band.

```
python3 pipeline/smart_reframe.py \
  --input clip.mp4 \
  --output clip_vertical.mp4 \
  --width 1080 --height 1920 \
  --mode auto|face|center \
  --smoothing 0.85 \
  --sample-fps 2 \
  [--debug-json path.json] \
  [--max-vel-px 40] \
  [--model-cache ~/.cache/clipmint] \
  [--no-download]
```

| Flag | Default | Meaning |
|---|---|---|
| `--mode` | `auto` | `auto` = face tracking if usable, else centre. `face` = force tracking (warns + centre if unavailable). `center` = plain centre crop, skips analysis entirely. |
| `--smoothing` | `0.85` | EMA coefficient `[0, 0.98]`. Higher = smoother, slower. |
| `--sample-fps` | `2` | Analysis frame rate. |
| `--debug-json` | off | Writes sample count, tracked centre series, chosen mode, final crop rect. |
| `--max-vel-px` | `40` | Anti-teleport rail, px of crop movement per output frame. |

### Behaviour

1. **Already vertical → remux, no re-encode.** If `src_w/src_h <= 1080/1920 * 1.02`,
   the file is stream-copied and the tool prints `REFRAME_SKIP already_vertical`.
   No encode is spent.
2. Crop window = largest target-aspect rectangle fitting the source, clamped to
   even dimensions (yuv420p requires it).
3. Frames are sampled with a single ffmpeg process piping PNGs over a pipe
   (`select` + `-f image2pipe`), decoded with `cv2.imdecode`. No per-frame shell-outs.
4. **Face detection**: OpenCV YuNet (`cv2.FaceDetectorYN`), detected at max width 640
   then mapped back to source coordinates. Largest face wins. The track is usable
   only if a face appears in **≥ 25 %** of samples; otherwise centre crop.
5. **Track**: `cx`/`cy` = face centre, clamped so the window stays inside the frame.
   Samples with no detection carry forward the last known centre.
6. **Smoothing**: zero-phase EMA (forward + backward average, with edge
   extrapolation padding), then a velocity clamp.
7. **Render**: one ffmpeg pass. A constant centre gets a static `crop`+`scale`;
   a moving centre gets `crop` with time-varying `x`/`y` expressions built as a
   balanced binary tree of piecewise-linear interpolations.

### Encode settings

```
libx264 -preset medium -crf 18 -pix_fmt yuv420p -profile:v high -level 4.1
-g 60 -r 30 -movflags +faststart
aac -b:a 160k -ar 48000
```

`-g 60` gives a keyframe every 2 s for clean platform re-encodes.

### Why a balanced binary tree, not a nested if-chain

ffmpeg's expression parser is recursive descent and **rejects expressions nested
deeper than roughly 80–90 levels** (`Missing ')' or too many args`). A naive
right-nested `if(lt(t,t1),s0,if(lt(t,t2),s1,...))` chain is O(n) deep and dies at
~90 keyframes — 45 s of clip at 2 fps. A **balanced binary tree** is O(log2 n)
deep, so 600 keyframes need only ~10 levels. Measured working at 600 segments
(expression length 31 KB).

**Trade-off vs the alternative** (scale up once, crop per segment, concat the
segments): the expression approach is a single encode, a single container, no
concat demuxer, no per-segment keyframes and no A/V-sync surface — and the motion
is continuous rather than a staircase. Its only cost is a large filter string and
reliance on `crop`'s per-frame expression evaluation. The concat alternative needs
N encodes (or an N-segment conform), risks drift at each boundary, and cannot be
done in one ffmpeg invocation. If the expression graph is ever rejected, the tool
automatically retries with a static centre crop rather than failing the job.

### Face model and its licence

`face_detection_yunet_2023mar.onnx` is downloaded once from the OpenCV Zoo into
`~/.cache/clipmint` (override with `--model-cache`, suppress with `--no-download`):

```
https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
```

**Licence: MIT.** The OpenCV Zoo states *"All files in this directory are licensed
under MIT License"*, and the `LICENSE` file in that directory is the MIT text,
`Copyright (c) 2020 Shiqi Yu <shiqi.yu@gmail.com>`. MIT permits commercial use,
modification and redistribution provided the copyright notice and permission
notice are retained. The model authors are Wu, Wei; Peng, Hanyang; Yu, Shiqi.
(The OpenCV *library* is Apache-2.0; the model weights are MIT — the stricter of
the two does not apply here, MIT does.) The model is verified to be > 100 KB on
download to catch Git-LFS pointer files and truncated transfers.

### Failure behaviour

Face tracking is strictly best-effort. Each of these prints a `REFRAME_WARN` and
falls back to a centre crop **without failing the job**:

| Condition | Warn token |
|---|---|
| `cv2` not importable | `opencv_missing` |
| `numpy` not importable | `numpy_missing` |
| Model missing and `--no-download` | `model_unavailable` |
| Download failed / offline | `model_unavailable` |
| Face in < 25 % of samples | `face_unusable` |
| Any unexpected exception in the face path | `face_path_failed` |
| Dynamic render rejected by ffmpeg | `dynamic_render_failed` |
| Input has no audio track | `no_audio_track` (handled via `-an`) |

---

## Tool 2 — `enhance_audio.py`

Two-pass EBU R128 loudness normalisation with optional denoise, rumble filter and
de-esser.

```
python3 pipeline/enhance_audio.py --input in.mp4 --output out.mp4 \
  [--target-lufs -14] [--true-peak -1.0] [--denoise auto|on|off] \
  [--highpass 80] [--deess auto|on|off] [--video-copy|--no-video-copy]
```

| Flag | Default | Meaning |
|---|---|---|
| `--target-lufs` | `-14` | Integrated loudness target. −14 LUFS is what TikTok / Instagram / YouTube normalise to. |
| `--true-peak` | `-1.0` | True-peak ceiling in dBTP. |
| `--denoise` | `auto` | `afftdn` adaptive frequency-domain denoiser. |
| `--highpass` | `80` | Rumble filter corner in Hz. `0` disables. |
| `--deess` | `auto` | `deesser` sibilance reduction. |
| `--video-copy` | on | `-c:v copy`, so audio work costs no video generation. `--no-video-copy` re-encodes. |

Filter order: `highpass → afftdn → deesser → loudnorm`.

### Loudness is measured, not guessed

Pass 1 runs `loudnorm` with `print_format=json` and parses `input_i`, `input_tp`,
`input_lra`, `input_thresh` and `target_offset`; those measured values are fed
into pass 2 with `linear=true`. The **same pre-chain is used in both passes**, so
the values measured in pass 1 describe exactly the signal pass 2 processes —
measuring the raw input while processing a denoised signal is a classic source of
off-target results.

If the JSON cannot be parsed, the tool prints
`ENHANCE_WARN measured_values_missing` and retries with single-pass (dynamic)
loudnorm rather than failing.

`lufs_out` on the `ENHANCE_OK` line is the loudness **re-measured on the written
file**, not the target that was requested — if the chain missed, the line shows it.

**Run this tool once, on the final cut.** Loudness normalisation is measured
against whatever it is given, so a second run measures an already-normalised file
and normalises again. That is not harmful but it is pointless, and the two-pass
model becomes meaningless.

### `--video-copy` and `+faststart`

`-c:v copy` still gets `-movflags +faststart`: because the output is a seekable
file (not a pipe), ffmpeg rewrites the container to relocate the `moov` atom
without touching the video stream. If the copy fails — e.g. a codec that mp4
cannot carry — the tool prints `ENHANCE_WARN video_copy_failed` and retries with
a full video re-encode.

### Auto heuristics (measured)

**Denoise.** Uses `astats` to compare the loudest and quietest 100 ms windows:
`speech level = RMS peak dB`, `noise bed = RMS through dB`, `SNR = difference`.
All three must hold to enable `afftdn`:

1. `SNR >= 6 dB` — the clip really has quiet passages, so the quiet window measures
   the noise bed and not the programme material. (A continuous signal has SNR ≈ 0
   and its "noise floor" reading is meaningless — this test is what stops the
   heuristic firing on continuous music or a speaker who never pauses.)
2. `noise bed > -55 dBFS` — the bed is loud enough to be audible. A −65 dBFS hiss
   is not worth the risk of `afftdn` artefacts.
3. `SNR < 35 dB` — the bed sits within 35 dB of the speech level.

When enabled, the measured noise bed is passed to `afftdn` as its `nf` parameter
(clamped to −80…−20 dB), so the denoiser is tuned to the actual recording.

Calibrated against a synthetic ladder (300 Hz tone gated 1.2 s on / 0.8 s off plus
a white-noise bed). Measured SNR and the resulting decision:

| noise bed | measured bed | SNR | decision |
|---|---|---|---|
| digital silence | −91.2 dBFS | 70.2 dB | off |
| −64.8 dBFS | −65.3 dBFS | 44.3 dB | off |
| −49.8 dBFS | −50.6 dBFS | 29.5 dB | **on** |
| −34.8 dBFS | −35.6 dBFS | 14.8 dB | **on** |

The 35 dB threshold sits in the empty gap between 44.3 and 29.5 dB. The measured
bed matched the predicted bed within ~0.8 dB at every rung.

**De-esser.** Compares broadband RMS against the RMS of the 5–8 kHz band
(`highpass=f=5000,lowpass=f=8000`). `auto` enables the de-esser when that
difference is `< 20 dB` **and** the denoiser was not enabled — broadband noise
inflates the 5–8 kHz band, so in a noisy recording this metric cannot separate
sibilance from hiss and the two processors would fight.

Measured on synthetic signals:

| signal | HF delta | decision |
|---|---|---|
| 7 kHz tone | 2.7 dB | on |
| tone + white noise | 18.9 dB | on (suppressed when denoise engages) |
| 440 Hz tone | 42.9 dB | off |
| 250 Hz tone | 52.7 dB | off |

> **Caveat, stated plainly:** this threshold was calibrated on synthetic tones.
> No real speech corpus was available in the build environment, so the 20 dB
> figure is **not validated against human sibilance**. It is deliberately
> conservative — real speech usually has its 5–8 kHz band 30–45 dB below the
> broadband RMS, so `auto` will normally stay OFF, which is the safe direction
> (a wrongly-engaged de-esser audibly lisps the speaker). For production, prefer
> an explicit `--deess on` / `--deess off`.

---

## Measured results

All numbers below were produced by the test run recorded in
`_audit/06-pipeline-tools-report.md`. Test media was synthesised locally with
ffmpeg; no external assets.

### `smart_reframe.py`

| Case | Result | Output |
|---|---|---|
| 1920x1080, `--mode center` | `REFRAME_OK mode=center crop=608x1080 samples=0 confidence=0.0000` | 1080x1920, 10.005 s, AAC 48 kHz |
| 1920x1080 synthetic, `--mode auto` | no face in synthetic content → `REFRAME_WARN face_unusable face_ratio_0.000_below_0.25` → centre crop | 1080x1920, 10.005 s |
| 1080x1920 portrait, `--mode auto` | `REFRAME_SKIP already_vertical` (0.29 s, no encode) | 1080x1920, 10.000 s |
| 1920x1080 with **no audio track** | `REFRAME_WARN no_audio_track` then `REFRAME_OK mode=center` | 1080x1920, no audio stream, 10.000 s |
| 1920x1080 moving face, `--mode face` | `REFRAME_OK mode=face crop=608x1080 samples=20 confidence=0.8034 strategy=dynamic` | 1080x1920, 10.005 s |

Duration deviation from the 10.000 s input was ≤ 0.005 s in every case
(0.005 s, i.e. 0.05 %), well inside the 0.2 s budget.

**Crop-tracking accuracy.** Measured on a luminance-ramp fixture (the ramp makes
the rendered crop position directly measurable from the output frames, two-point
calibrated against known static crops). The crop followed the intended track with
a **maximum error of 9.5 px over 1326 px of travel (0.7 %)**.

**The crop is driven by the face.** Rendering the moving-face clip and re-detecting
at native resolution in the 1080x1920 output, the face stayed within
**−54 px to +80 px of frame centre (1080 px wide)** with no systematic bias. That
residual oscillation is the intended effect of `--smoothing 0.85`, not tracking
error — the tracker intentionally does not chase every detection wobble. Before
the crop-centre/top-left bug fix below, the same measurement ranged from −391 px
to +485 px, i.e. the crop ran off the speaker entirely.

### `enhance_audio.py`

Independently re-measured with
`ffmpeg -i out.mp4 -af loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json -f null -`:

| Output | measured `input_i` | deviation from −14 LUFS | true peak |
|---|---|---|---|
| landscape 1920x1080 | **−14.05 LUFS** | −0.05 LU ✅ | −8.62 dBTP |
| noisy fixture (denoise on) | **−14.05 LUFS** | −0.05 LU ✅ | −5.32 dBTP |
| `--no-video-copy` re-encode | **−14.05 LUFS** | −0.05 LU ✅ | −9.09 dBTP |
| reframe → enhance chain | **−14.05 LUFS** | −0.05 LU ✅ | −9.21 dBTP |

All within the ±1.0 LU requirement, in fact within 0.05 LU. True peaks are all
well under the −1.0 dBTP ceiling.

---

## Bugs found and fixed during development

These were real defects caught by frame-accurate testing, not theoretical:
four in `smart_reframe.py` and one build-config issue. They are documented here
because each one silently degraded output rather than erroring.

1. **Velocity clamp applied per sample, not per output frame.** A 40 px limit
   between 2 fps samples is only 80 px/s, so it bound on *every* step and
   flattened the smoothed track into a straight line at constant speed, leaving
   the crop trailing the speaker. The clamp is now a per-output-frame budget
   (40 px per 1/30 s = 1200 px/s), converted to a per-sample budget via
   `dt * out_fps`, and exposed as `--max-vel-px`.
2. **Zero-phase EMA distorted the ends of the track.** A forward+backward EMA
   average is lag-free, but each pass needs ~`1/(1-alpha)` samples of warm-up, so
   on a 20-sample track the transient filled the whole clip: the smoothed track
   spanned 950 px where the subject spanned 1327 px, putting the face in the left
   third of the frame at the start. Fixed by padding both ends with a linear
   extrapolation of the edge slope before filtering (what `scipy.filtfilt` does),
   which cut the endpoint error from ~190 px to **7.3 px** while still reducing
   jitter 12x (35.4 px → 3.0 px mean second difference).
3. **Crop centre passed where a top-left corner was expected.** In the dynamic
   path the x/y expressions were fed the *centre* of the tracked face, but
   `crop`'s `x`/`y` are the *top-left corner*. The static path subtracted
   `crop_w/2` correctly; the dynamic path did not, shifting the entire animated
   crop 304 px right on a 608 px window. Caught by measuring the crop position
   from a ramp fixture; now corrected before the expression is built, with the
   values clamped to the legal range and recorded in `--debug-json`.
4. **ffmpeg's `fps` filter does not sample where you think.** Measured against
   raw frame indices, `fps=2` on a 30 fps source emits a frame **7 source frames
   (0.233 s) later** than the nominal sample time — it selects near the midpoint
   of each output interval. Because the crop track is later rendered against real
   frame timestamps, that half-interval skew silently pushed the crop ~34 px
   ahead of the speaker (0.233 s × 140 px/s). Replaced with
   `select='not(mod(n,K))'`, which maps sample *k* to source frame *k·K* exactly
   (verified: pixel difference 0.0 versus the intended raw frame, versus a
   mismatched frame under `fps`). This is also why the sampling is now
   frame-index based rather than time based; VFR sources are detected and warned
   about (`REFRAME_WARN vfr_source`) since index→time is only linear for CFR.
5. **Build environment:** `pip install opencv-python-headless>=4.9` resolves to
   OpenCV 5.x, which upgrades `numpy` to 2.x and breaks other packages in a shared
   interpreter (`numba`, `subsai`). In CI's fresh virtualenv this is harmless, but
   the local verification environment was pinned back to
   `opencv-python-headless==4.11.0` + `numpy==1.26.4` to avoid breaking unrelated
   tooling on the developer machine. Both combinations were confirmed working.

---

## Verification environment

- Python 3.11.9
- ffmpeg / ffprobe `N-121808-gf283750ba8-20251119` (Windows build)
- opencv-python-headless 4.11.0, numpy 1.26.4
- Test media synthesised with ffmpeg `testsrc2`, `sine`, `anoisesrc` and a
  luminance ramp; no external assets were downloaded for testing.
