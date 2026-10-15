# Face / motion tracking — diagnosis

**Scope:** `pipeline/smart_reframe.py`
**Date:** 2026-10-15
**Method:** every number below is measured on a purpose-built fixture, not read off
the code. Reproduce with `_audit/probe_real.py`.

---

## Fixture

`_audit/probe_real.py` builds a 14 s 1920x1080 / 30 fps clip from a **real face
photo** (OpenCV's `lena.jpg` face crop, kept in the scratch dir, not committed):

- speaker pans 480 → 1440 px, then holds still 2 s, then pans back (tests static/dynamic)
- speaker **bobs vertically** ±90 px (tests `cy`, not just `cx`)
- speaker **scales** 300 → 340 → 240 px (leans in/out)
- **0.8 s hard occlusion** at t = 5.0–5.8 s
- a **second, briefly-larger face** enters at t ≥ 8.0 s at cx ≈ 300 (identity test)

Ground truth for every frame is written to `truth.json`, so the track error is a
real measurement, not an eyeball.

---

## Symptom 1 — crop locks onto the WRONG face (the big one)

The detector picks **the largest face in each frame independently**
(`smart_reframe.py`, `best = max(faces, key=area)`). There is no identity memory, so
the moment a background person is momentarily bigger, the crop abandons the speaker.

Measured, with the intruder entering at t = 8 s:

```
   t    truth_cx   raw_cx     err   marker
 8.00       1303     1300      -3
 8.80       1193     1195      +2
 9.60       1083      460    -624   <- 2ND face steals the crop
10.40        974      463    -511   2ND
11.20        864      464    -400   2ND
12.00        754      458    -296   2ND
12.80        645      462    -183   2ND
13.60        535      458     -77   2ND

raw cx error: mean|err|=110 px, max|err|=624 px
```

A **624 px** error on a 1920 px frame. The crop does not recover — it tracks the
intruder to the end of the clip. This is the "face tracking is inaccurate" report.

This is **audit/06 §6.5, which was explicitly left unimplemented** ("Face identity
is not locked… a background person briefly becoming the largest face can steal the
crop. A proper IoU/identity lock across samples was not implemented").

## Symptom 2 — the face drifts off-centre even on the RIGHT face

Measured on the *rendered output* (face position detected inside the 1080x1920 file):

```
  t     face_cx_in_1080   offset_from_centre
 1.00          552              +12
 3.00          637              +97
 5.00          ~800            +260
 7.00          891             +351
 9.50          992             +452      <- worst, before the steal
10.00          106             -434      <- 886 px whip-pan in <0.5 s
13.50          635              +95
```

The face sits up to **+452 px off centre** (42 % of the 540 px half-width) and then
whips **886 px in half a second**. That is the "looks poor" report.

Cause isolated on a clean ramp (`smooth_track` fed the exact ground truth, so the
detector cannot be blamed):

```
alpha=0.85  lag -171..+6   mean|err|=55px   span_kept=85%   <- the shipped default
alpha=0.60  lag  -35..+1   mean|err|= 5px   span_kept=99%
alpha=0.40  lag  -15..+0   mean|err|= 1px   span_kept=100%
```

At the default `--smoothing 0.85` the smoothed track **lags the subject by up to
171 px and gives back 15 % of the travel**. The zero-phase padding fix from
audit/06 §5.2 removed the *endpoint* distortion but did **not** address the
steady-state lag on a moving subject — 0.85 is simply too slow a coefficient for
speaker motion. The smoothing is doing its job; the coefficient is mis-tuned.

## Symptom 3 — vertical tracking is silently dead

```
raw cy  span: 425 .. 929   (the speaker really does move vertically)
final cy span: 540 .. 540  (dead flat)
crop_h = 1080 = src_h,  so clamp_centers pins cy to src_h/2 = 540
```

For a 16:9 → 9:16 reframe the crop window is full-height, so `cy` *must* be 540 —
this part is correct geometry. It is recorded here so it is not mistaken for a bug:
**vertical tracking cannot work in a 9:16 reframe and is not expected to.**

## Symptom 4 — occlusion is handled by "repeat the last centre"

```
else:
    cx, cy = last if last is not None else (src_w/2, src_h/2)
```

During the 0.8 s occlusion the track holds the last centre (measured −43 px at
t = 5.6 s, which is the hold, not an error). Adequate, but the held value then
feeds the smoother as if it were a real observation, which drags the estimate.

---

## Root causes (ranked)

| # | Cause | Evidence | Status |
|---|---|---|---|
| 1 | No face identity lock — largest-face-per-frame | 624 px steal | **bug, fix** |
| 2 | `--smoothing 0.85` too slow for speaker motion | 171 px lag, 15 % span loss | **mis-tuned, fix** |
| 3 | Held occluded samples fed to the smoother as real data | adds drag during/after occlusion | **bug, fix** |
| 4 | `--mode auto` silently degrades to centre crop when the frame ratio is low | 4.4 % ratio → centre crop | works, but the threshold never gets a chance because of 1–3 |

## Non-causes (verified working)

- **YuNet detector**: real face detected at 0.87 confidence, 94.3 % of samples.
- **Frame sampling** (`select='not(mod(n,K))'`): frame-exact, as audit/06 §3.5 claims.
- **Crop-expression builder**: balanced tree, exact interpolation, verified.
- **Centre → top-left conversion**: correct (audit/06 §5.3 fix holds).
- **`crop_h == src_h` forcing cy = 540**: correct 9:16 geometry, not a bug.

## Environment note

`cv2` is **not importable from the interpreter the pipeline is pointed at by
default** on this machine, but *is* present in
`C:\Users\Vikash Meena\AppData\Local\Programs\Python\Python311\python.exe`
(cv2 4.11.0 / numpy 1.26.4). CI installs it from `pipeline/requirements.txt`, so
CI is fine; locally the tool silently degrades to a centre crop unless the 3.11
interpreter is used. Worth knowing when judging "tracking does nothing" on a dev box.

---

# FIXES APPLIED (2026-10-15)

All changes are in `pipeline/smart_reframe.py`. Verified by
`_audit/verify_reframe.py` (11 checks, all pass).

## 1. Subject identity lock — fixes the 624 px steal

Replaced `max(faces, key=area)` with a weighted identity match against the
incumbent (`_identity_score`: IoU 0.50 + centre proximity 0.30 + size
consistency 0.20). A challenger must clear a high bar **and** win
`IDENTITY_CONFIRM_FRAMES` (3) consecutive samples before it displaces the
subject, so detector noise cannot cause a switch. After a sustained absence the
lock is dropped so a real scene cut re-frames promptly. Switching is counted in
the log (`identity_switches=N`) and the debug JSON.

| metric | before | after |
|---|---|---|
| max raw cx error | 624 px | **43 px** |
| error while intruder in shot | 511–624 px | **6 px** |

## 2. `--smoothing` default 0.85 → 0.6

Zero-phase EMA removes lag, but a slow coefficient still trails a moving
subject. Measured on a clean ramp: 171 px lag / 85 % span at 0.85, versus
5 px / 99 % at 0.6. New default is 0.6; the CLI help now says why.

## 3. Occlusion gaps are bridged, not smoothed as data

`build_face_track` now returns an `observed` mask. `bridge_gaps` linearly
interpolates across samples with no accepted face (and holds across gaps too
long to be an occlusion), so a held position no longer drags the crop. Debug
JSON reports `held_samples` and `identity_locked_ratio`.

## 4. Verified result — the visual quality symptom

Measured on the face's position inside the rendered 1080x1920 output
(`_audit/verify_reframe.py` measures the face nearest centre, i.e. the one the
crop actually tracked):

| metric | before | after |
|---|---|---|
| max face offset from centre | 452 px | **62 px** |
| max frame-to-frame jump (whip-pan) | 886 px | **33 px** |

## Regression coverage

`_audit/verify_reframe.py` asserts all of the above plus: centre mode stays a
static crop, an unavailable model degrades to centre with rc=0, a missing input
exits non-zero, and `bridge_gaps` interpolates correctly.
`_audit/test_pipeline2_units.py` (pre-existing, 20+ checks) still passes.

## Still not proven

Same caveat as audit/06 §6: this is a synthetic fixture. The identity lock is a
strong improvement on one intruder scenario, but has not been exercised on real
footage with two real people, faces crossing, or a cut to a different speaker.

