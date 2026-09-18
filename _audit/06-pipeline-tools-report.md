# 06 — Pipeline tools: build + test evidence report

**Scope:** `pipeline/smart_reframe.py`, `pipeline/enhance_audio.py`,
`pipeline/requirements.txt`, `pipeline/README.md`.
**Date:** 2026-09-18. **Nothing was committed or pushed.**

All output below is pasted from real runs. Test media was synthesised locally with
ffmpeg; no external assets were downloaded for testing.

---

## 1. Environment actually used

```
$ python --version
Python 3.11.9

$ python -c "import cv2, numpy; print(cv2.__version__, numpy.__version__)"
4.11.0 1.26.4

$ ffmpeg -version | head -1
ffmpeg version N-121808-gf283750ba8-20251119 Copyright (c) 2000-2025 the FFmpeg developers
```

Notes on the environment:

- `python3` does not exist on this Windows box (Microsoft Store alias); `python`
  and `py -3` are 3.11.9. All commands below use `python`.
- `cv2` was **not** installed. Installed with
  `python -m pip install "opencv-python-headless>=4.9,<5" "numpy>=1.26,<2"`.
  The unbounded `>=4.9` resolved to OpenCV 5.0.0 and pulled `numpy` 2.4.6, which
  broke unrelated packages in this shared interpreter (`numba 0.62.1 requires
  numpy<2.4`, `subsai 1.6.2 requires numpy<2`). Pinned back to
  4.11.0 / 1.26.4. Both combinations were confirmed working; in CI's fresh
  virtualenv the loose pins in `requirements.txt` are fine.
- The CI target is `ubuntu-latest` + Python 3.11. Development and testing happened
  on Windows, so **the tools have not been executed on Linux**. Nothing
  platform-specific was used (no shell=True, no POSIX-only paths — `pathlib`
  throughout, `subprocess` with argument lists), but this is an untested surface.

---

## 2. Test fixtures (all synthesised)

```
$ ffprobe -v error -show_entries stream=codec_type,width,height,r_frame_rate,duration -of default=nw=1 test_landscape.mp4
codec_type=video
width=1920
height=1080
r_frame_rate=30/1
duration=10.000000
codec_type=audio
duration=10.000000
```

| Fixture | Content | Purpose |
|---|---|---|
| `test_landscape.mp4` | 1920x1080 testsrc2 30 fps 10 s + 440 Hz sine | centre crop, no-face fallback |
| `test_portrait.mp4` | 1080x1920 testsrc2 + sine | `already_vertical` skip path |
| `test_noaudio.mp4` | 1920x1080 testsrc2, `-an` | no-audio path |
| `test_face.mp4` | 1920x1080, face image moving x=100→1500 over 10 s + sine | face tracking |
| `spy_face.mp4` | luminance-ramp background + moving face | measures the *actual* rendered crop x |
| `sp_clean/n60/n45/n30.mp4` | 300 Hz tone gated 1.2 s on / 0.8 s off + white-noise bed | denoise heuristic calibration |

Face-path fixtures use `lena.jpg` (OpenCV's own `samples/data`, Apache-2.0 with
OpenCV). It sits in a scratch directory **outside the repo and is not committed** —
it is a local test fixture only, used to make a face move across a frame. It was
chosen because Wikimedia and other public-domain portrait sources were network-blocked
from this machine (every attempt returned a 2035-byte error page).

---

## 3. `smart_reframe.py` — results

### 3.1 Full matrix (final build)

```
### fixtures
  test_landscape.mp4           -> {'w': 1920, 'h': 1080, 'dur': 10.0, 'v': 'h264', 'a': 'aac', 'ar': '48000', 'ch': 1}
  test_portrait.mp4            -> {'w': 1080, 'h': 1920, 'dur': 10.0, 'v': 'h264', 'a': 'aac', 'ar': '48000', 'ch': 1}
  test_noaudio.mp4             -> {'w': 1920, 'h': 1080, 'dur': 10.0, 'v': 'h264', 'a': None, 'ar': None, 'ch': None}
  test_face.mp4                -> {'w': 1920, 'h': 1080, 'dur': 10.0, 'v': 'h264', 'a': 'aac', 'ar': '48000', 'ch': 1}

### REFRAME: center
[reframe] input=test_landscape.mp4 1920x1080 30.000fps 10.000s audio=True vcodec=h264
[reframe] crop window 608x1080
[reframe] mode=center, skipping analysis
[reframe] static crop at x=656 y=0 (max centre deviation 0.00px < 12.16px)
REFRAME_OK mode=center crop=608x1080 samples=0 confidence=0.0000 out=1080x1920 strategy=static elapsed=8.88s

### REFRAME: auto (synthetic, no face)
[reframe] sampled=20 faces_detected=0 (0.0%) mean_score=0.000
REFRAME_WARN face_unusable face_ratio_0.000_below_0.25
[reframe] static crop at x=656 y=0 (max centre deviation 0.00px < 12.16px)
REFRAME_OK mode=center crop=608x1080 samples=20 confidence=0.0000 out=1080x1920 strategy=static elapsed=9.76s

### REFRAME: portrait skip
[reframe] input=test_portrait.mp4 1080x1920 30.000fps 10.000s audio=True vcodec=h264
REFRAME_SKIP already_vertical src=1080x1920 out=1080x1920 elapsed=0.28s

### REFRAME: no audio
[reframe] input=test_noaudio.mp4 1920x1080 30.000fps 10.000s audio=False vcodec=h264
REFRAME_WARN no_audio_track
[reframe] crop window 608x1080
[reframe] sampled=20 faces_detected=0 (0.0%) mean_score=0.000
REFRAME_WARN face_unusable face_ratio_0.000_below_0.25
[reframe] static crop at x=656 y=0 (max centre deviation 0.00px < 12.16px)
REFRAME_OK mode=center crop=608x1080 samples=20 confidence=0.0000 out=1080x1920 strategy=static elapsed=9.25s

### REFRAME: face tracking
[reframe] input=test_face.mp4 1920x1080 30.000fps 10.000s audio=True vcodec=h264
[reframe] crop window 608x1080
[reframe] sampled=20 faces_detected=19 (95.0%) mean_score=0.803
[reframe] dynamic crop, 21 keyframes, expr 1248B, spread 625.4px, x 0..1242 of 0..1312
[reframe] debug json -> final2/f.json
REFRAME_OK mode=face crop=608x1080 samples=20 confidence=0.8034 out=1080x1920 strategy=dynamic elapsed=8.25s
```

### 3.2 Output probes (`ffprobe`)

```
  final2/c.mp4   -> {'w': 1080, 'h': 1920, 'dur': 10.005, 'v': 'h264', 'a': 'aac', 'ar': '48000', 'ch': 1}
  final2/a.mp4   -> {'w': 1080, 'h': 1920, 'dur': 10.005, 'v': 'h264', 'a': 'aac', 'ar': '48000', 'ch': 1}
  final2/p.mp4   -> {'w': 1080, 'h': 1920, 'dur': 10.0,   'v': 'h264', 'a': 'aac', 'ar': '48000', 'ch': 1}
  final2/n.mp4   -> {'w': 1080, 'h': 1920, 'dur': 10.0,   'v': 'h264', 'a': None,  'ar': None, 'ch': None}
  final2/f.mp4   -> {'w': 1080, 'h': 1920, 'dur': 10.005, 'v': 'h264', 'a': 'aac', 'ar': '48000', 'ch': 1}
```

| Check | Required | Result |
|---|---|---|
| Exit code | 0 | 0 on all five |
| `REFRAME_*` line | present | present on all five |
| Output resolution | 1080x1920 | 1080x1920 on all five |
| Audio present where expected | video with audio in → audio out | present on c/a/p/f; **absent** on the no-audio input |
| Duration vs input (10.000 s) | within 0.2 s | max deviation 0.005 s (0.05 %) |

### 3.3 Is the crop actually moving? — measured, not assumed

This is the part that matters. Two independent measurements were taken.

**(a) Crop-position accuracy.** A luminance-ramp fixture makes the rendered crop
position directly measurable from the output frames: the source is a horizontal
ramp `lum(X) = floor(255·X/1920)`, so the mean luminance of a rendered frame
inverts to the crop's left edge. The measurement was two-point calibrated against
known static crops (`x=100` measured 96.18; `x=656` measured 644.56).

```
[reframe] dynamic crop, 21 keyframes, expr 1248B, spread 625.4px, x 0..1242 of 0..1312
REFRAME_OK mode=face crop=608x1080 samples=20 confidence=0.7977 out=1080x1920 strategy=dynamic

  t   intended_crop_x   measured_crop_x    error_px
  0               0.0             -8.75      -8.75
  1             113.1            104.50      -8.55
  2             243.9            238.34      -5.53
  3             389.4            384.33      -5.07
  4             529.6            528.32      -1.29
  5             669.0            668.38      -0.58
  6             808.0            810.22      +2.17
  7             946.7            950.07      +3.37
  8            1085.0           1090.05      +5.04
  9            1222.1           1229.82      +7.73
  max |error| = 8.75 px over 1222 px of travel
```

The crop follows the intended trajectory to within **8.75 px over 1222 px of
travel (0.7 %)**. The tracker is demonstrably doing something.

**(b) Is the face kept in frame?** The moving-face clip was rendered and the face
re-detected at native resolution in the finished 1080x1920 output:

```
  t   face_cx_in_output   offset_from_540   face_w
  0             485.5             -54.5    170.1
  1             521.6             -18.4    163.7
  2             532.4              -7.6    167.2
  3             539.6              -0.4    162.0
  4             542.0              +2.0    163.1
  5             553.6             +13.6    162.6
  6             567.9             +27.9    165.4
  7             579.8             +39.8    163.4
  8             599.4             +59.4    176.6
  9             620.6             +80.6    164.3
  range: -54.5 .. +80.6 px  (frame is 1080 wide, face ~165 px)
```

The face stays within **±81 px of centre in a 1080 px wide frame** (±7.5 %), with
no systematic bias (it crosses zero). That residual is the intended effect of
`--smoothing 0.85` — the tracker deliberately does not chase every detection
wobble. For comparison, with the crop-centre bug described in §5.3 the same
measurement ranged from **−391 px to +485 px**, i.e. the crop ran off the speaker.

**What is proven:** face tracking end-to-end, on a synthesised moving face, in an
automated pipeline. **What is NOT proven:** behaviour on real footage of a real
human — no real-speaker video existed in this environment.

### 3.4 Fallbacks and error handling

```
### cache HIT path (model already downloaded)
REFRAME_OK mode=face crop=608x1080 samples=20 confidence=0.8034 out=1080x1920 strategy=dynamic
(no "downloading" line — cache was reused)

### model unavailable (--no-download with an EMPTY cache dir)
REFRAME_WARN model_unavailable download_disabled
REFRAME_WARN face_unusable download_disabled
REFRAME_OK mode=center crop=608x1080 samples=0 confidence=0.0000 out=1080x1920 strategy=static
rc=0

### opencv-unavailable (simulated by shadowing cv2 with a raising module)
REFRAME_WARN opencv_missing
REFRAME_OK mode=center crop=608x1080 samples=0 confidence=0.0000 out=1080x1920 strategy=static
rc=0

### --mode face on a clip with NO face (must warn + fall back, not crash)
REFRAME_WARN face_unusable face_ratio_0.000_below_0.25
REFRAME_WARN falling_back_to_center face_ratio_0.000_below_0.25
REFRAME_OK mode=center crop=608x1080 samples=20 confidence=0.0000 out=1080x1920 strategy=static

### missing input (must exit non-zero)
REFRAME_ERROR input_not_found nope.mp4
rc=1
```

All fallback outputs were verified as valid 1080x1920 H.264 files. A missing face,
a missing model, a missing OpenCV and a missing download **never fail the job**.

### 3.5 ffmpeg capability findings discovered by testing

Two ffmpeg behaviours were established empirically and drove the design:

1. **Expression nesting depth is limited.** A right-nested `if()` chain fails above
   roughly 85 levels:
   ```
   depth=  80 expr_len=  1523 -> OK
   depth= 100 expr_len=  1903 -> FAIL
   depth= 250 expr_len=  4903 -> FAIL
   ```
   Error: `Missing ')' or too many args`. A **balanced binary tree**
   (depth O(log₂ n)) was verified working with 600 segments:
   ```
   segments=  64 expr_len=  3246 -> OK
   segments= 200 expr_len= 10382 -> OK
   segments= 600 expr_len= 31582 -> OK
   ```
2. **ffmpeg's `fps` filter does not sample where you think.** See §5.4.

`select='not(mod(n,K))'` was verified frame-exact (pixel difference 0.0 against the
intended source frame):

```
-vsync 0: 20 frames (expect 20)
    sampler_k= 0 best_matches_source_frame=  0 (expected   0) diff=0.0
    sampler_k= 5 best_matches_source_frame= 75 (expected  75) diff=0.0
    sampler_k=10 best_matches_source_frame=150 (expected 150) diff=0.0
    sampler_k=15 best_matches_source_frame=225 (expected 225) diff=0.0
    sampler_k=19 best_matches_source_frame=285 (expected 285) diff=0.0
    => EXACT
```

---

## 4. `enhance_audio.py` — results

### 4.1 Full matrix (final build)

```
### ENHANCE: landscape
[enhance] input=test_landscape.mp4 duration=10.00s video=h264 audio=aac
[enhance] speech_window=-20.9dBFS noise_bed=-23.0dBFS snr=2.1dB
[enhance] broadband_rms=-21.1dB 5-8kHz_rms=-63.9dB hf_delta=42.8dB
[enhance] denoise=False (no_quiet_passages(range=2.1dB))  deess=False (hf_delta=42.8dB>=20)
[enhance] pre-chain: highpass=f=80
[enhance] loudnorm pass1: input_i=-21.75 input_tp=-16.34 input_lra=0.1 thresh=-31.75 offset=0.04
ENHANCE_OK lufs_in=-21.8 lufs_out=-14.1 denoise=off deess=off highpass=80 target=-14 true_peak=-1

### ENHANCE: noisy (denoise engages)
[enhance] input=sp_n30.mp4 duration=10.00s video=h264 audio=aac
[enhance] speech_window=-20.8dBFS noise_bed=-35.6dBFS snr=14.8dB
[enhance] broadband_rms=-23.0dB 5-8kHz_rms=-43.6dB hf_delta=20.6dB
[enhance] denoise=True (snr=14.8dB<35)  deess=False (denoise_active_metric_unreliable)
[enhance] pre-chain: highpass=f=80,afftdn=nr=12:nf=-35.6:tn=1
[enhance] loudnorm pass1: input_i=-23.75 input_tp=-15.05 input_lra=1.6 thresh=-33.75 offset=0.24
ENHANCE_OK lufs_in=-23.8 lufs_out=-14.1 denoise=on deess=off highpass=80 target=-14 true_peak=-1

### ENHANCE: no audio
[enhance] input=test_noaudio.mp4 duration=10.00s video=h264 audio=None
ENHANCE_WARN no_audio_track
ENHANCE_SKIP no_audio output=final2/e3.mp4

### ENHANCE: --no-video-copy
[enhance] input=test_face.mp4 duration=10.00s video=h264 audio=aac
[enhance] speech_window=-21.0dBFS noise_bed=-23.0dBFS snr=2.0dB
[enhance] broadband_rms=-21.1dB 5-8kHz_rms=-70.6dB hf_delta=49.5dB
[enhance] denoise=False (no_quiet_passages(range=2.0dB))  deess=False (hf_delta=49.5dB>=20)
[enhance] pre-chain: highpass=f=80
[enhance] loudnorm pass1: input_i=-21.95 input_tp=-17.03 input_lra=0.0 thresh=-31.95 offset=-0.04
ENHANCE_OK lufs_in=-21.9 lufs_out=-14.1 denoise=off deess=off highpass=80 target=-14 true_peak=-1
```

### 4.2 Independent loudness verification

Command used (exactly as specified — a completely separate measurement pass over
the written file):

```
ffmpeg -i out.mp4 -af loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json -f null -
```

```
  final2/e1.mp4   input_i= -14.05 LUFS  true_peak= -8.62 dBTP  deviation_from_-14=-0.05 LU  PASS
  final2/e2.mp4   input_i= -14.05 LUFS  true_peak= -5.32 dBTP  deviation_from_-14=-0.05 LU  PASS
  final2/e4.mp4   input_i= -14.05 LUFS  true_peak= -9.09 dBTP  deviation_from_-14=-0.05 LU  PASS
```

Raw JSON from the first of those runs:

```
	"input_i" : "-14.05",
	"input_tp" : "-8.62",
	"input_lra" : "0.00",
	"input_thresh" : "-24.05",
	"target_offset" : "-0.04"
```

**All three outputs measure −14.05 LUFS — a deviation of 0.05 LU, against a 1.0 LU
requirement.** True peak is respected: every output is well below the −1.0 dBTP
ceiling (−5.32 to −9.09 dBTP).

### 4.3 Output probes

```
  final2/e1.mp4 -> {'w': 1920, 'h': 1080, 'dur': 10.005, 'v': 'h264', 'a': 'aac', 'ar': '48000', 'ch': 1}
  final2/e2.mp4 -> {'w': 320,  'h': 240,  'dur': 10.005, 'v': 'h264', 'a': 'aac', 'ar': '48000', 'ch': 1}
  final2/e3.mp4 -> {'w': 1920, 'h': 1080, 'dur': 10.0,   'v': 'h264', 'a': None,  'ar': None, 'ch': None}
  final2/e4.mp4 -> {'w': 1920, 'h': 1080, 'dur': 10.1,   'v': 'h264', 'a': 'aac', 'ar': '48000', 'ch': 1}
```

`-c:v copy` preserved the video stream untouched (1920x1080 h264 in, same out).
`--no-video-copy` re-encoded (duration 10.1 s vs 10.0 s, a 0.1 s frame-quantisation
difference). The no-audio input produced a valid output with no audio stream and
exit code 0.

### 4.4 End-to-end chain (the actual pipeline order)

```
### END-TO-END CHAIN: reframe -> enhance
  REFRAME_OK mode=face crop=608x1080 samples=20 confidence=0.8034 out=1080x1920 strategy=dynamic elapsed=8.83s
  ENHANCE_OK lufs_in=-21.9 lufs_out=-14.1 denoise=off deess=off highpass=80 target=-14 true_peak=-1
  final/chain_step2.mp4 -> {'w': 1080, 'h': 1920, 'dur': 10.1, 'v': 'h264', 'a': 'aac', 'ar': '48000', 'ch': 1}
  final/chain_step2.mp4   input_i= -14.05 LUFS  true_peak= -9.21 dBTP  deviation_from_-14=-0.05 LU  PASS
```

Landscape → vertical (face-tracked) → loudness-normalised: 1080x1920, −14.05 LUFS.

### 4.5 Denoise heuristic calibration

Built a ladder of speech-like signals (300 Hz tone gated 1.2 s on / 0.8 s off, so
the clip genuinely has pauses, plus a white-noise bed). The `astats`
`RMS peak dB` / `RMS through dB` pair gives speech level and noise bed:

```
file          speech dB  noisebed dB   SNR dB   predicted noise bed
sp_clean.mp4     -21.05       -91.21     70.2   digital silence
sp_n60.mp4       -21.05       -65.34     44.3   -64.8 dBFS
sp_n45.mp4       -21.03       -50.58     29.5   -49.8 dBFS
sp_n30.mp4       -20.81       -35.57     14.8   -34.8 dBFS
```

The measured bed matched the predicted bed within ~0.8 dB at every rung, so the
metric is sound. The 35 dB threshold sits in the empty gap between 44.3 and 29.5.
The third guard (bed must exceed −55 dBFS) is what stops `auto` denoising a merely
SNR-poor but inaudibly quiet recording.

Two heuristics were **rejected** after measurement, rather than shipped:

- `astats`' `Noise floor dB` field: reads −15.3 dB on a signal whose RMS is
  −20.7 dB, i.e. *above* the RMS. It is not a noise floor in any useful sense.
- `loudnorm`'s `input_thresh`: measured as exactly `input_i − 10.0` on every
  fixture (−21.75/−31.75, −20.90/−30.90), so it carries no SNR information at all.

### 4.6 De-esser status — stated honestly

The de-esser `auto` heuristic (5–8 kHz band within 20 dB of broadband RMS) was
calibrated on **synthetic tones only**:

```
cal 7 kHz tone        HF delta  2.7 dB  -> on
tone + white noise    HF delta 18.9 dB  -> on (suppressed when denoise engages)
cal 440 Hz tone       HF delta 42.9 dB  -> off
cal 250 Hz tone       HF delta 52.7 dB  -> off
```

**No real speech was available to validate the 20 dB threshold.** It is set
conservatively, so `auto` will normally stay OFF on real speech (where the band
typically sits 30–45 dB down) — the safe direction, since a wrongly-engaged
de-esser audibly lisps the speaker. `--deess on|off` is the reliable path in
production. This caveat is repeated in the module docstring and the README.

---

## 5. Bugs found and fixed during testing

All five were caught by measurement, not by reading code. Each degraded output
silently rather than erroring.

### 5.1 Velocity clamp applied per sample instead of per output frame

A "40 px between samples" clamp at 2 fps is only 80 px/s. Measured on the
moving-face fixture (subject travels ~1327 px in 10 s ≈ 70 px per sample), the
clamp bound on **18 of 19 steps**, collapsing the smoothed track into a straight
line at constant speed:

```
  idx    t     raw_cx  |  sm_cx
    0   0.00    309.7  |   497.7
    1   0.50    373.2  |   535.6
    2   1.00    447.8  |   575.6
   ...
   19   9.50   1636.4  |  1255.6
raw cx span: 309.7 .. 1636.4 (span 1326.7)
sm  cx span: 497.7 .. 1255.6 (span 757.9)
warnings: [] clamped_steps: 18
```

Fixed by reading the clamp as a per-**output-frame** budget (40 px per 1/30 s =
1200 px/s), converted to a per-sample budget. It is now a genuine anti-teleport
rail, exposed as `--max-vel-px`. After the fix `velocity_clamped_steps: 0` and the
track span retention is 98 %.

### 5.2 Zero-phase EMA distorted the ends of the track

Forward+backward EMA averaging removes lag, but each pass needs ~`1/(1-α)` samples
of warm-up. At α=0.85 that is ~20 samples — the entire track — so the smoothed
track spanned 950 px where the subject spanned 1327 px, putting the face in the
left third of the frame at clip start:

```
sm  cx span: 497.7 .. 1447.8  (span 950.1)   <- subject actually spans 1326.7
```

Fixed by padding both ends with a linear extrapolation of the edge slope before
filtering (what `scipy.filtfilt` does). Unit-checked:

```
UNIT 1 - pure ramp (endpoint distortion test)
  input span  : 300.0 .. 1630.0  (span 1330.0)
  smoothed    : 307.3 .. 1622.7  (span 1315.3)
  max |err|   : 7.34 px
UNIT 2 - ramp + gaussian noise (sigma=25px)
  mean |2nd diff| in  : 35.43 px  (jitter)
  mean |2nd diff| out :  2.95 px  (jitter after smoothing)
  trend preserved     : 304.5 -> 1610.7  (raw trend 300 -> 1630)
UNIT 3 - constant track stays constant: {540.0}
```

Endpoint error ~190 px → **7.3 px**, while still cutting jitter **12x**.

### 5.3 Crop centre passed where a top-left corner was expected

`crop`'s `x`/`y` are the **top-left corner**; the tracked track is in **centre**
coordinates. The static path subtracted `crop_w/2`; the **dynamic** path did not,
shifting the entire animated crop 304 px right on a 608 px window.

Diagnosis: the generated expression string was verified correct by translating it
to Python and evaluating it independently at all 21 keyframes (every value matched),
proving the bug was downstream of expression generation. Measuring the ramp fixture
then showed the rendered crop at 313.2 where the expression said 12.6 — and 316.63
was exactly the *centre* value, confirming the missing offset.

Fixed by converting centre → top-left and clamping before building the expression:

```
[reframe] dynamic crop, 21 keyframes, expr 1248B, spread 625.4px, x 0..1242 of 0..1312
```

### 5.4 ffmpeg's `fps` filter samples ~half an interval late

The analysis originally sampled with `-vf fps=2`. Matching sampler output against
raw source frame indices showed a **consistent +7-frame (0.233 s) offset**:

```
sampler_k  nominal_frame  BEST_MATCHING_frame   offset_frames  offset_seconds
        0              0                     7             +7         +0.233
        5             75                    82             +7         +0.233
       10            150                   157             +7         +0.233
       15            225                   232             +7         +0.233
       19            285                   292             +7         +0.233
```

`fps` selects near the midpoint of each output interval. Because the crop track is
later rendered against *real* frame timestamps, that skew pushed the crop ~34 px
ahead of the speaker (0.233 s × 140 px/s) — visible as the face sitting off-centre
in the output. Replaced with `select='not(mod(n,K))'`, verified exact
(diff 0.0, §3.5). VFR sources are now detected and warned (`REFRAME_WARN vfr_source`)
since index→time is only linear for CFR.

### 5.5 Build environment (not a code bug)

`pip install opencv-python-headless>=4.9` resolves to OpenCV 5.0.0 → `numpy` 2.4.6,
which broke `numba` and `subsai` in this shared interpreter. Harmless in CI's fresh
virtualenv, but pinned back locally to avoid breaking unrelated developer tooling.
Recorded in `requirements.txt`.

---

## 6. Unfinished / not proven

Stated plainly so nothing here is overclaimed:

1. **Real-footage face tracking is not proven.** Face tracking is verified
   end-to-end in an automated pipeline, but the "face" is a photo of a face moving
   across a flat background. Real speakers turn their heads, get occluded, and
   appear with other faces in shot. The largest-face heuristic is untested against
   a two-person frame.
2. **The de-esser `auto` threshold is unvalidated on real speech** (§4.6). Use
   `--deess on|off` in production.
3. **Nothing has run on Linux.** CI is `ubuntu-latest`; development was Windows.
   No platform-specific constructs were used, but the scripts have not been executed
   on the target OS.
4. **VFR sources are warned about, not handled.** Sampling is frame-index based,
   which assumes CFR. A VFR input emits `REFRAME_WARN vfr_source` and the track
   timing may drift.
5. **Face identity is not locked.** The tracker picks the largest face per sample
   independently, so a scene where a background person briefly becomes the largest
   face can steal the crop. A proper IoU/identity lock across samples was not
   implemented.
6. **`afftdn` artefact quality was not auditioned.** The denoiser engages correctly
   and the output measures on-target, but the audio was never listened to; the
   chosen strength (`nr=12`) is ffmpeg's default, not a tuned value.
7. **Long-clip sampling was reasoned about but not exercised.** The >600-sample
   path (stride widening to keep whole-clip coverage) was not run on a long fixture.

---

## 7. Deliverables

| File | Status |
|---|---|
| `pipeline/smart_reframe.py` | Created. 5 test cases + 4 fallback paths + chain verified. |
| `pipeline/enhance_audio.py` | Created. 4 test cases + independent loudness verification. |
| `pipeline/requirements.txt` | Created. |
| `pipeline/README.md` | Created. CLI, licence, measured numbers, bug notes. |
| `_audit/06-pipeline-tools-report.md` | This file. |

No files outside `pipeline/` and `_audit/` were created or modified. Nothing was
committed or pushed. (The working tree already had unrelated modifications to
`README.md`, `api-gateway/*` and `dashboard/*` before this task began; they are
untouched.)
