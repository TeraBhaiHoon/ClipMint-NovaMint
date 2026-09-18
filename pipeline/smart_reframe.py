#!/usr/bin/env python3
"""
smart_reframe.py - convert a landscape (or any aspect) clip to vertical 9:16 while
keeping the speaker's face in frame.

Replaces the "blurred letterbox with a horizontal band in the middle" behaviour
with a real, tracked vertical crop.

------------------------------------------------------------------------------
CLI
------------------------------------------------------------------------------
    python3 pipeline/smart_reframe.py \\
        --input clip.mp4 --output clip_vertical.mp4 \\
        --width 1080 --height 1920 \\
        --mode auto|face|center --smoothing 0.85 --sample-fps 2 \\
        [--debug-json path.json] [--model-cache ~/.cache/clipmint]

Exit 0 on success, non-zero with a clear message on failure. The final stdout
line is always a machine-readable marker the workflow can grep:

    REFRAME_OK    mode=face crop=607x1080 samples=23 confidence=0.81
    REFRAME_SKIP  already_vertical ...
    REFRAME_WARN  <reason>            (non-fatal; a REFRAME_OK usually follows)

------------------------------------------------------------------------------
HOW THE MOVING CROP IS RENDERED  (design note + trade-off)
------------------------------------------------------------------------------
The crop centre is sampled at `--sample-fps`, smoothed, then rendered as a
single ffmpeg pass:

    crop=w=CW:h=CH:x='<expr>':y='<expr>',scale=W:H:flags=lanczos,setsar=1,fps=30

`crop` re-evaluates its x/y expressions for every frame with `t` bound to the
frame PTS, so a time-varying crop needs no per-segment concat and no temporary
files. The expressions are piecewise-linear interpolations of the smoothed
centre track.

Two non-obvious details, both established empirically against ffmpeg on this
machine (see _audit/06-pipeline-tools-report.md):

1. ffmpeg's expression parser is RECURSIVE DESCENT and rejects expressions
   nested deeper than ~80-90 levels ("Missing ')' or too many args"). A naive
   right-nested if() chain - if(lt(t,t1),s0,if(lt(t,t2),s1,...)) - is O(n) deep,
   so it dies at ~90 keyframes, i.e. after 45 s at 2 fps. We therefore emit a
   BALANCED BINARY TREE of comparisons, which is O(log2 n) deep: 600 keyframes
   need only ~10 levels. Verified working at 600 segments.

2. The interpolation is exact. Measured on a horizontal luminance ramp, the
   requested crop x of 0/150/300 produced measured crop x of -0.03/150.00/300.02.

Trade-off vs the alternative (scale up once, crop per segment, concat the
segments): the expression approach is one encode, one container, no concat
demuxer, no segment-boundary keyframes, no audio-sync surface at all, and the
motion is continuous rather than a staircase. Its only cost is a large filter
string and reliance on crop's per-frame expression evaluation. The concat
alternative would need N encodes (or an N-segment conform), risks A/V drift at
each boundary, and makes the output impossible to produce in a single ffmpeg
invocation. We chose the expression path, with a static crop as the automatic
fallback if the graph is rejected for any reason.

------------------------------------------------------------------------------
SAFETY
------------------------------------------------------------------------------
Face tracking is strictly best-effort. Every failure mode - cv2 missing, numpy
missing, model undownloadable, unreadable frame stream, no face found, or any
unexpected exception inside the face path - degrades to a centre crop. A missing
face never fails a job.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

# --------------------------------------------------------------------------
# Optional heavy deps. Import failure must NOT be fatal.
# --------------------------------------------------------------------------
try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None

try:
    import cv2
except Exception:  # pragma: no cover
    cv2 = None


FFMPEG = os.environ.get("SMART_REFRAME_FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("SMART_REFRAME_FFPROBE", "ffprobe")

YUNET_FILENAME = "face_detection_yunet_2023mar.onnx"
# OpenCV Zoo, MIT licensed (see pipeline/README.md).
YUNET_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/"
    "face_detection_yunet/" + YUNET_FILENAME
)
MIN_MODEL_BYTES = 100 * 1024  # a Git-LFS pointer is ~131 bytes; the real file is ~232 KB

MAX_SAMPLES = 600          # hard cap on analysed frames
DETECT_MAX_WIDTH = 640     # downscale target for detection
FACE_SCORE_THRESHOLD = 0.6
FACE_USABLE_RATIO = 0.25   # a face must appear in >=25% of samples to be tracked
VELOCITY_CLAMP_PX = 40.0   # max crop-centre jump between adjacent samples
STATIC_DEV_RATIO = 0.02    # centre spread < 2% of crop width => static crop
SAMPLE_TIMEOUT_BASE = 300  # seconds

PNG_SIG = b"\x89PNG\r\n\x1a\n"
PNG_END = b"IEND\xaeB\x60\x82"


# ==========================================================================
# logging
# ==========================================================================
def say(msg: str) -> None:
    """Progress/diagnostics. stdout, flushed, so CI logs stay ordered."""
    print(msg, flush=True)


def warn(reason: str, detail: str = "") -> None:
    """Emit a greppable non-fatal marker."""
    line = f"REFRAME_WARN {reason}"
    if detail:
        line += f" {detail}"
    print(line, flush=True)


def die(msg: str, code: int = 1):
    print(f"REFRAME_ERROR {msg}", file=sys.stderr, flush=True)
    return code


# ==========================================================================
# probing
# ==========================================================================
def _run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def probe_media(path: str) -> dict:
    """ffprobe -> {width, height, duration, fps, has_audio, vcodec, acodec}."""
    cmd = [
        FFPROBE, "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", path,
    ]
    r = _run(cmd)
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe failed on {path!r}: {r.stderr.strip()[:400]}")

    try:
        data = json.loads(r.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"ffprobe produced unparseable JSON: {e}")

    streams = data.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if v is None:
        raise RuntimeError(f"no video stream in {path!r}")

    def _fps(stream):
        for key in ("avg_frame_rate", "r_frame_rate"):
            raw = stream.get(key) or ""
            if "/" in raw:
                num, _, den = raw.partition("/")
                try:
                    num, den = float(num), float(den)
                except ValueError:
                    continue
                if num > 0 and den > 0:
                    return num / den
        return 0.0

    def _rate(stream, key):
        raw = stream.get(key) or ""
        if "/" in raw:
            num, _, den = raw.partition("/")
            try:
                num, den = float(num), float(den)
                if num > 0 and den > 0:
                    return num / den
            except ValueError:
                pass
        return 0.0

    r_rate, avg_rate = _rate(v, "r_frame_rate"), _rate(v, "avg_frame_rate")
    # frame-index sampling is only exact for CFR; flag variable-rate sources
    vfr = bool(r_rate and avg_rate and abs(r_rate - avg_rate) / max(r_rate, 1e-9) > 0.02)

    duration = 0.0
    for src in (data.get("format", {}), v):
        try:
            duration = float(src.get("duration") or 0.0)
        except (TypeError, ValueError):
            duration = 0.0
        if duration > 0:
            break

    return {
        "width": int(v["width"]),
        "height": int(v["height"]),
        "duration": duration,
        "fps": _fps(v),
        "has_audio": a is not None,
        "vcodec": v.get("codec_name", "?"),
        "acodec": (a or {}).get("codec_name"),
        "nb_frames": v.get("nb_frames"),
        "vfr": vfr,
    }


# ==========================================================================
# geometry
# ==========================================================================
def _even(n: int) -> int:
    """yuv420p needs even dimensions."""
    n = int(round(n))
    return n - (n % 2)


def compute_crop_size(src_w: int, src_h: int, target_w: int, target_h: int):
    """Largest target-aspect rectangle that fits inside the source, even-clamped."""
    target_ar = target_w / target_h
    if src_h * target_ar <= src_w:
        crop_h = src_h
        crop_w = src_h * target_ar
    else:
        crop_w = src_w
        crop_h = src_w / target_ar
    crop_w, crop_h = _even(crop_w), _even(crop_h)
    crop_w = max(crop_w, 2)
    crop_h = max(crop_h, 2)
    # Never exceed the source.
    crop_w = min(crop_w, _even(src_w))
    crop_h = min(crop_h, _even(src_h))
    return crop_w, crop_h


def clamp_centers(centers, crop_w, crop_h, src_w, src_h):
    """Force every crop centre to keep the window fully inside the frame."""
    lo_x, hi_x = crop_w / 2.0, src_w - crop_w / 2.0
    lo_y, hi_y = crop_h / 2.0, src_h - crop_h / 2.0
    if hi_x < lo_x:
        lo_x = hi_x = src_w / 2.0
    if hi_y < lo_y:
        lo_y = hi_y = src_h / 2.0
    return [(min(max(x, lo_x), hi_x), min(max(y, lo_y), hi_y)) for x, y in centers]


# ==========================================================================
# YuNet model
# ==========================================================================
def ensure_yunet_model(cache_dir: str, allow_download: bool = True):
    """Return (path, note). Downloads once into cache_dir; never raises."""
    cache = Path(cache_dir).expanduser()
    dest = cache / YUNET_FILENAME

    try:
        if dest.exists() and dest.stat().st_size > MIN_MODEL_BYTES:
            return dest, "cache_hit"
    except OSError:
        pass

    if not allow_download:
        return None, "download_disabled"

    try:
        cache.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        return None, f"cache_dir_unwritable:{e.__class__.__name__}"

    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        say(f"[reframe] downloading YuNet model -> {dest}")
        req = urllib.request.Request(
            YUNET_URL, headers={"User-Agent": "clipmint-smart-reframe/1.0"}
        )
        with urllib.request.urlopen(req, timeout=90) as resp, open(tmp, "wb") as fh:
            shutil.copyfileobj(resp, fh, length=1 << 16)
        size = tmp.stat().st_size
        if size <= MIN_MODEL_BYTES:
            raise RuntimeError(f"downloaded file too small ({size} bytes)")
        os.replace(tmp, dest)
        return dest, f"downloaded:{size}"
    except Exception as e:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        return None, f"download_failed:{e.__class__.__name__}"


# ==========================================================================
# frame sampling - one ffmpeg process, PNGs over a pipe
# ==========================================================================
_VSYNC_ARGS = None


def _vsync_args():
    """
    '-fps_mode passthrough' needs ffmpeg >= 5.0; '-vsync 0' is the older
    spelling and still works on new builds. Probe once and cache.
    """
    global _VSYNC_ARGS
    if _VSYNC_ARGS is None:
        _VSYNC_ARGS = ["-fps_mode", "passthrough"]
        try:
            r = subprocess.run([FFMPEG, "-hide_banner", "-h", "full"],
                               capture_output=True, text=True)
            if r.returncode == 0 and "fps_mode" not in r.stdout:
                _VSYNC_ARGS = ["-vsync", "0"]
        except Exception:
            pass
    return list(_VSYNC_ARGS)


def _sampling_plan(probe, sample_fps, max_samples):
    """
    Pick a deterministic frame-index stride and the resulting sample interval.

    We deliberately DO NOT use the `fps` filter. Measured against raw frame
    indices, `fps=2` on a 30 fps source emits a frame 7 source frames (0.233 s)
    LATER than the nominal sample time - it selects near the midpoint of each
    output interval. Because the crop track is later rendered against real frame
    timestamps, that half-interval skew silently pushed the crop ~34 px ahead of
    the speaker (0.23 s * 140 px/s). `select='not(mod(n,K))'` instead maps
    sample k to source frame k*K exactly; verified diff=0.0 versus raw frames.

    Assumes CFR, which is what short-form masters are. VFR sources are flagged
    by the caller.
    """
    src_fps = probe.get("fps") or 30.0
    if src_fps <= 0:
        src_fps = 30.0
    duration = probe.get("duration") or 0.0

    step = max(1, int(round(src_fps / sample_fps))) if sample_fps > 0 else 1

    est = 0
    try:
        est = int(probe.get("nb_frames") or 0)
    except (TypeError, ValueError):
        est = 0
    if est <= 0 and duration > 0:
        est = int(duration * src_fps)
    if est > 0:
        # widen the stride rather than tracking only the first max_samples frames
        step = max(step, int(math.ceil(est / float(max_samples))))

    return step, step / src_fps, src_fps


def iter_sampled_frames(input_path, step, src_w, max_samples, timeout_s):
    """Yield (index, bgr_uint8_array) for every `step`-th source frame."""
    vf = f"select='not(mod(n,{step}))'"
    if src_w > DETECT_MAX_WIDTH:
        vf += f",scale={DETECT_MAX_WIDTH}:-2"
    cmd = [
        FFMPEG, "-v", "error", "-nostdin", "-i", input_path,
        "-an", "-sn", "-dn", "-vf", vf,
        *_vsync_args(),
        "-f", "image2pipe", "-vcodec", "png", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)

    buf = bytearray()
    emitted = 0
    deadline = time.time() + timeout_s
    try:
        while emitted < max_samples:
            if time.time() > deadline:
                warn("sample_timeout", f"samples={emitted}")
                break
            chunk = proc.stdout.read(1 << 16)
            if not chunk:
                break
            buf += chunk
            while emitted < max_samples:
                start = buf.find(PNG_SIG)
                if start < 0:
                    # keep only a possible partial signature
                    if len(buf) > len(PNG_SIG):
                        del buf[: len(buf) - len(PNG_SIG)]
                    break
                if start:
                    del buf[:start]
                end = buf.find(PNG_END, len(PNG_SIG))
                if end < 0:
                    break
                blob = bytes(buf[: end + len(PNG_END)])
                del buf[: end + len(PNG_END)]

                img = cv2.imdecode(np.frombuffer(blob, dtype=np.uint8), cv2.IMREAD_COLOR)
                if img is None:
                    continue  # not a real frame boundary - keep scanning
                yield emitted, img
                emitted += 1
    finally:
        try:
            proc.stdout.close()
        except Exception:
            pass
        try:
            proc.wait(timeout=20)
        except Exception:
            proc.kill()


# ==========================================================================
# face tracking
# ==========================================================================
def build_face_track(input_path, probe, sample_fps, model_cache, allow_download):
    """
    Returns (centers, confidence, samples, note).
    centers is a list of (cx, cy) in SOURCE pixel coordinates, one per sample.
    Raises on hard structural problems; callers fall back to centre crop.
    """
    src_w, src_h = probe["width"], probe["height"]
    duration = probe["duration"] or 0.0

    step, dt, src_fps = _sampling_plan(probe, sample_fps, MAX_SAMPLES)
    if abs(1.0 / dt - sample_fps) > 1e-6:
        say(f"[reframe] sampling every {step} source frames (~{1.0 / dt:.3f} fps) "
            f"instead of {sample_fps:g} fps: keeps the whole clip covered under "
            f"the {MAX_SAMPLES}-sample cap")
    if probe.get("vfr"):
        warn("vfr_source", "frame-index sampling assumes CFR; track times may drift")

    model_path, note = ensure_yunet_model(model_cache, allow_download)
    if model_path is None:
        warn("model_unavailable", note)
        return None, 0.0, 0, note, dt

    detector = cv2.FaceDetectorYN.create(
        str(model_path), "", (DETECT_MAX_WIDTH, DETECT_MAX_WIDTH),
        FACE_SCORE_THRESHOLD, 0.3, 5000,
    )

    centers, scores = [], []
    samples = 0
    detected = 0
    last = None

    timeout_s = max(SAMPLE_TIMEOUT_BASE, duration * 4) if duration else SAMPLE_TIMEOUT_BASE

    for idx, img in iter_sampled_frames(input_path, step, src_w, MAX_SAMPLES, timeout_s):
        samples += 1
        ih, iw = img.shape[:2]
        # Map detections back to source coordinates. Computed from the ACTUAL
        # decoded size, so scale=:...:-2 rounding cannot skew the mapping.
        sx = src_w / float(iw)
        sy = src_h / float(ih)

        detector.setInputSize((iw, ih))
        _retval, faces = detector.detect(img)

        best = None
        if faces is not None and len(faces):
            # YuNet rows are [x, y, w, h, 5x landmark pairs..., score]
            best = max(faces, key=lambda r: float(r[2]) * float(r[3]))

        if best is not None:
            fx, fy, fw, fh = (float(best[0]), float(best[1]), float(best[2]), float(best[3]))
            score = float(best[14])
            cx = (fx + fw / 2.0) * sx
            cy = (fy + fh / 2.0) * sy
            last = (cx, cy)
            scores.append(score)
            detected += 1
        else:
            cx, cy = last if last is not None else (src_w / 2.0, src_h / 2.0)

        centers.append((cx, cy))

    if samples == 0:
        return None, 0.0, 0, "no_frames_read", dt

    ratio = detected / float(samples)
    confidence = (sum(scores) / len(scores)) if scores else 0.0
    say(f"[reframe] sampled={samples} faces_detected={detected} "
        f"({ratio * 100:.1f}%) mean_score={confidence:.3f}")

    if ratio < FACE_USABLE_RATIO:
        return None, confidence, samples, f"face_ratio_{ratio:.3f}_below_{FACE_USABLE_RATIO}", dt

    return centers, confidence, samples, "ok", dt


# ==========================================================================
# smoothing
# ==========================================================================
def _ema(seq, alpha):
    out = list(seq)
    for i in range(1, len(seq)):
        out[i] = alpha * out[i - 1] + (1.0 - alpha) * seq[i]
    return out


def _zero_phase_ema(seq, alpha):
    """
    Forward+backward EMA averaged (lag-free), with linear-extrapolation padding.

    Without padding the double pass still distorts a trend near the ends: an EMA
    of a ramp is the ramp minus a constant lag, and each pass needs ~1/(1-alpha)
    samples of warm-up. On a 20-sample track at alpha=0.85 that transient fills
    the entire clip, so the smoothed track was measured spanning 950 px where the
    subject actually spanned 1327 px - the crop sat ~190 px off the speaker at
    the clip start, i.e. the face landed in the left third of the frame instead
    of the middle. Padding both ends with a linear extrapolation of the edge
    slope (what scipy's filtfilt does) lets the filter reach steady state before
    the real samples and removes the distortion.
    """
    n = len(seq)
    if n < 3 or alpha <= 0:
        return list(seq)

    pad = min(n, max(4, int(round(3.0 / (1.0 - alpha)))))
    head_span = min(n - 1, pad)
    tail_span = min(n - 1, pad)
    head_slope = (seq[head_span] - seq[0]) / head_span
    tail_slope = (seq[-1] - seq[n - 1 - tail_span]) / tail_span

    head = [seq[0] + head_slope * (i - pad) for i in range(pad)]
    tail = [seq[-1] + tail_slope * (i + 1) for i in range(pad)]
    ext = head + list(seq) + tail

    fwd = _ema(ext, alpha)
    bwd = _ema(ext[::-1], alpha)[::-1]
    avg = [(f + b) / 2.0 for f, b in zip(fwd, bwd)]
    return avg[pad:pad + n]


def smooth_track(centers, smoothing, dt,
                 max_vel_px_per_frame=VELOCITY_CLAMP_PX, out_fps=30.0):
    """
    Zero-phase exponential smoothing + velocity clamp.

    SMOOTHING
    A plain forward EMA is what the spec asks for, but it is causal and therefore
    LAGS a moving subject: at smoothing=0.85 and 2 fps the steady-state lag is
    (1-a)/a = ~5.7 samples, which on a walking speaker is hundreds of pixels -
    the crop trails behind the face, which looks worse than no smoothing at all.
    Because this tool is offline and already holds the whole track, we run the
    EMA forward AND backward and average the two passes. That is still an
    exponential moving average with the requested coefficient, but the lag
    cancels (zero-phase), so we get smoothness without trailing.

    VELOCITY CLAMP
    The clamp is a per-OUTPUT-FRAME budget (40 px per 1/30 s = 1200 px/s),
    converted into a per-sample budget via `dt * out_fps`.

    Why not 40 px per *sample*: measured on the moving-face fixture the subject
    travels ~1327 px over 10 s, i.e. ~70 px per 2 fps sample. A literal 40 px
    per-sample limit (80 px/s) binds on every single step and collapses the
    track into a straight line at constant speed - the crop then trails the
    speaker for most of the clip. Verified: with the per-sample reading the
    smoothed span was 758 px; with the per-frame reading it follows the subject.
    The clamp is therefore a genuine anti-teleport safety rail (it catches a
    spurious detection jumping the crop across the frame) rather than a
    motion governor, and it is exposed as --max-vel-px.
    """
    if not centers:
        return [], 0

    alpha = min(max(smoothing, 0.0), 0.98)
    xs = [c[0] for c in centers]
    ys = [c[1] for c in centers]

    if len(centers) > 2 and alpha > 0:
        xs = _zero_phase_ema(xs, alpha)
        ys = _zero_phase_ema(ys, alpha)

    max_step = max_vel_px_per_frame * (dt * out_fps)
    clamped = 0
    for arr in (xs, ys):
        for i in range(1, len(arr)):
            delta = arr[i] - arr[i - 1]
            if abs(delta) > max_step:
                arr[i] = arr[i - 1] + math.copysign(max_step, delta)
                clamped += 1
    return list(zip(xs, ys)), clamped


# ==========================================================================
# crop expression
# ==========================================================================
def build_piecewise_expr(times, values) -> str:
    """
    Build a balanced binary tree of linear interpolations.

    Depth is O(log2 n) - a right-nested chain is O(n) and ffmpeg's recursive
    descent parser rejects it above ~85 levels. See the module docstring.
    """
    n = len(values)
    if n == 0:
        return "0"
    if n == 1:
        return f"{values[0]:.3f}"

    last_seg = n - 2

    def leaf(s: int) -> str:
        t0, t1 = times[s], times[s + 1]
        v0, v1 = values[s], values[s + 1]
        span = t1 - t0
        if abs(span) < 1e-9:
            return f"{v1:.3f}"
        return f"({v0:.3f}+({v1:.3f}-{v0:.3f})*(t-{t0:.4f})/{span:.4f})"

    def rec(lo: int, hi: int) -> str:
        if lo >= hi:
            return leaf(min(lo, last_seg))
        mid = (lo + hi) // 2
        return f"if(lt(t,{times[mid + 1]:.4f}),{rec(lo, mid)},{rec(mid + 1, hi)})"

    return rec(0, last_seg)


def build_render_filter(crop_w, crop_h, out_w, out_h, x_expr, y_expr) -> str:
    tail = f"scale={out_w}:{out_h}:flags=lanczos,setsar=1,fps=30"
    return f"[0:v]crop=w={crop_w}:h={crop_h}:x='{x_expr}':y='{y_expr}',{tail}[v]"


# ==========================================================================
# rendering
# ==========================================================================
def render(input_path, output_path, filter_complex, has_audio) -> tuple[bool, str]:
    cmd = [
        FFMPEG, "-y", "-v", "error", "-nostdin", "-i", input_path,
        "-filter_complex", filter_complex,
        "-map", "[v]",
    ]
    if has_audio:
        cmd += ["-map", "0:a?"]
    else:
        cmd += ["-an"]
    cmd += [
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
        "-g", "60", "-r", "30", "-movflags", "+faststart",
    ]
    if has_audio:
        cmd += ["-c:a", "aac", "-b:a", "160k", "-ar", "48000"]
    cmd += ["-max_muxing_queue_size", "1024", output_path]

    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        return False, (r.stderr or "").strip()[:800]
    return True, ""


def remux(input_path, output_path, has_audio) -> tuple[bool, str]:
    """No re-encode: used for the already_vertical fast path."""
    cmd = [FFMPEG, "-y", "-v", "error", "-nostdin", "-i", input_path,
           "-map", "0:v:0"]
    cmd += ["-map", "0:a?"] if has_audio else ["-an"]
    cmd += ["-c", "copy", "-movflags", "+faststart", output_path]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        return False, (r.stderr or "").strip()[:800]
    return True, ""


# ==========================================================================
# main
# ==========================================================================
def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="Reframe a clip to vertical 9:16, keeping the speaker in frame."
    )
    p.add_argument("--input", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--width", type=int, default=1080)
    p.add_argument("--height", type=int, default=1920)
    p.add_argument("--mode", choices=["auto", "face", "center"], default="auto")
    p.add_argument("--smoothing", type=float, default=0.85,
                   help="EMA coefficient in [0,0.98]; higher = smoother")
    p.add_argument("--sample-fps", type=float, default=2.0)
    p.add_argument("--max-vel-px", type=float, default=VELOCITY_CLAMP_PX,
                   help="max crop-centre movement per output frame at 30fps "
                        "(anti-teleport safety rail; default 40)")
    p.add_argument("--debug-json", default=None)
    p.add_argument("--model-cache", default=os.path.expanduser("~/.cache/clipmint"))
    p.add_argument("--no-download", action="store_true",
                   help="never fetch the YuNet model; use the cache only")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    t_start = time.time()

    if not Path(args.input).is_file():
        return die(f"input_not_found {args.input}")
    if args.width <= 0 or args.height <= 0:
        return die(f"bad_target_size {args.width}x{args.height}")

    out_w, out_h = _even(args.width), _even(args.height)

    try:
        probe = probe_media(args.input)
    except Exception as e:
        return die(f"probe_failed {e}")

    src_w, src_h = probe["width"], probe["height"]
    say(f"[reframe] input={args.input} {src_w}x{src_h} "
        f"{probe['fps']:.3f}fps {probe['duration']:.3f}s "
        f"audio={probe['has_audio']} vcodec={probe['vcodec']}")

    if not probe["has_audio"]:
        warn("no_audio_track")

    target_ar = out_w / out_h
    src_ar = src_w / src_h

    debug = {
        "input": args.input,
        "output": args.output,
        "source": {"width": src_w, "height": src_h, "fps": probe["fps"],
                   "duration": probe["duration"], "has_audio": probe["has_audio"]},
        "target": {"width": out_w, "height": out_h},
        "mode_requested": args.mode,
        "smoothing": args.smoothing,
        "sample_fps_requested": args.sample_fps,
        "warnings": [],
    }

    # ---- 1. already vertical -> remux, spend no encode -------------------
    if src_ar <= target_ar * 1.02:
        ok, err = remux(args.input, args.output, probe["has_audio"])
        if not ok:
            return die(f"remux_failed {err}")
        debug.update({"mode_used": "skip", "reason": "already_vertical",
                      "final_crop": None})
        _write_debug(args.debug_json, debug)
        say(f"REFRAME_SKIP already_vertical src={src_w}x{src_h} "
            f"out={out_w}x{out_h} elapsed={time.time() - t_start:.2f}s")
        return 0

    # ---- 2. crop window --------------------------------------------------
    crop_w, crop_h = compute_crop_size(src_w, src_h, out_w, out_h)
    if crop_w > src_w or crop_h > src_h:
        return die(f"crop_exceeds_source crop={crop_w}x{crop_h} src={src_w}x{src_h}")
    debug["crop"] = {"width": crop_w, "height": crop_h}
    say(f"[reframe] crop window {crop_w}x{crop_h}")

    # ---- 3-7. face track (best effort) ----------------------------------
    mode_used = "center"
    centers = None
    confidence = 0.0
    samples = 0
    note = "center_mode_requested"
    clamped = 0

    nominal_dt = 1.0 / args.sample_fps if args.sample_fps > 0 else 0.5
    sample_dt = nominal_dt

    if args.mode == "center":
        say("[reframe] mode=center, skipping analysis")
    else:
        if cv2 is None:
            warn("opencv_missing")
            debug["warnings"].append("opencv_missing")
            note = "opencv_missing"
        elif np is None:
            warn("numpy_missing")
            debug["warnings"].append("numpy_missing")
            note = "numpy_missing"
        elif args.sample_fps <= 0:
            warn("bad_sample_fps", str(args.sample_fps))
            debug["warnings"].append("bad_sample_fps")
            note = "bad_sample_fps"
        else:
            try:
                raw, confidence, samples, note, sample_dt = build_face_track(
                    args.input, probe, args.sample_fps, args.model_cache,
                    not args.no_download,
                )
                if raw:
                    smoothed, clamped = smooth_track(
                        raw, args.smoothing, sample_dt,
                        max_vel_px_per_frame=args.max_vel_px)
                    centers = clamp_centers(smoothed, crop_w, crop_h, src_w, src_h)
                    mode_used = "face"
                    debug["sample_interval_s"] = round(sample_dt, 5)
                    debug["raw_centers"] = [
                        {"t": round(i * sample_dt, 4),
                         "cx": round(c[0], 2), "cy": round(c[1], 2)}
                        for i, c in enumerate(raw)
                    ]
                else:
                    warn("face_unusable", note)
                    debug["warnings"].append(f"face_unusable:{note}")
            except Exception as e:  # absolute safety net
                warn("face_path_failed", f"{e.__class__.__name__}:{str(e)[:120]}")
                debug["warnings"].append(f"face_path_failed:{e.__class__.__name__}")
                centers = None
                samples = 0

    if centers is None:
        if args.mode == "face":
            # forced face tracking was not possible - be loud about the downgrade
            warn("falling_back_to_center", note)
            debug["warnings"].append("fallback_to_center")
        mode_used = "center"
        centers = [(src_w / 2.0, src_h / 2.0)]
        confidence = 0.0

    centers = clamp_centers(centers, crop_w, crop_h, src_w, src_h)

    # ---- 8. static vs dynamic -------------------------------------------
    xs = [c[0] for c in centers]
    ys = [c[1] for c in centers]
    x_dev = max(abs(v - sum(xs) / len(xs)) for v in xs)
    y_dev = max(abs(v - sum(ys) / len(ys)) for v in ys)
    max_dev = max(x_dev, y_dev)
    static = len(centers) == 1 or max_dev < STATIC_DEV_RATIO * crop_w

    times = [i * sample_dt for i in range(len(centers))]
    if probe["duration"] and times and probe["duration"] > times[-1] + 1e-6:
        # Extend the final keyframe to the true end of the clip so the
        # interpolation never extrapolates past the last sample.
        times.append(probe["duration"])
        centers = centers + [centers[-1]]
        xs = [c[0] for c in centers]
        ys = [c[1] for c in centers]

    if static:
        # centre -> top-left corner, then clamp inside the frame
        x0 = int(round(xs[0] - crop_w / 2.0))
        y0 = int(round(ys[0] - crop_h / 2.0))
        x0 = min(max(x0, 0), src_w - crop_w)
        y0 = min(max(y0, 0), src_h - crop_h)
        fc = build_render_filter(crop_w, crop_h, out_w, out_h, str(x0), str(y0))
        debug["render"] = {"strategy": "static", "x": x0, "y": y0,
                           "max_deviation_px": round(max_dev, 3)}
        say(f"[reframe] static crop at x={x0} y={y0} "
            f"(max centre deviation {max_dev:.2f}px < {STATIC_DEV_RATIO * crop_w:.2f}px)")
    else:
        # crop's x/y are the TOP-LEFT corner, but the track is in CENTRE
        # coordinates. Convert before building the expression - feeding the
        # centre straight in shifts the whole crop right/down by half the crop
        # window (measured: a 304 px shift on a 608 px window).
        x_vals = [min(max(c[0] - crop_w / 2.0, 0), src_w - crop_w) for c in centers]
        y_vals = [min(max(c[1] - crop_h / 2.0, 0), src_h - crop_h) for c in centers]
        x_expr = build_piecewise_expr(times, x_vals)
        y_expr = build_piecewise_expr(times, y_vals)
        fc = build_render_filter(crop_w, crop_h, out_w, out_h, x_expr, y_expr)
        debug["render"] = {"strategy": "dynamic", "keyframes": len(centers),
                           "x_expression_length": len(x_expr),
                           "y_expression_length": len(y_expr),
                           "max_deviation_px": round(max_dev, 3),
                           "x_range": [round(min(x_vals), 2), round(max(x_vals), 2)],
                           "y_range": [round(min(y_vals), 2), round(max(y_vals), 2)]}
        say(f"[reframe] dynamic crop, {len(centers)} keyframes, "
            f"expr {len(x_expr)}B, spread {max_dev:.1f}px, "
            f"x {min(x_vals):.0f}..{max(x_vals):.0f} of 0..{src_w - crop_w}")

    # ---- 9. encode -------------------------------------------------------
    ok, err = render(args.input, args.output, fc, probe["has_audio"])
    if not ok:
        # Last-ditch: a plain centre crop is always better than failing the job.
        warn("dynamic_render_failed", err.replace("\n", " ")[:200])
        debug["warnings"].append("dynamic_render_failed")
        x0 = int(round((src_w - crop_w) / 2.0))
        y0 = int(round((src_h - crop_h) / 2.0))
        fc = build_render_filter(crop_w, crop_h, out_w, out_h, str(x0), str(y0))
        ok, err = render(args.input, args.output, fc, probe["has_audio"])
        if not ok:
            return die(f"render_failed {err}")
        mode_used = "center"
        debug["render"] = {"strategy": "static_fallback", "x": x0, "y": y0}
        confidence = 0.0

    if not Path(args.output).is_file() or Path(args.output).stat().st_size == 0:
        return die("output_missing_after_encode")

    # ---- 10. debug + summary --------------------------------------------
    try:
        outp = probe_media(args.output)
        debug["output_probe"] = outp
    except Exception:
        outp = None

    debug.update({
        "mode_used": mode_used,
        "samples": samples,
        "confidence": round(confidence, 4),
        "note": note,
        "velocity_clamped_steps": clamped,
        "final_crop": ({"x": debug["render"].get("x"), "y": debug["render"].get("y"),
                        "width": crop_w, "height": crop_h}
                       if debug["render"]["strategy"].startswith("static")
                       else {"mode": "dynamic", "width": crop_w, "height": crop_h}),
    })
    debug["centers"] = [
        {"t": round(t, 4), "cx": round(c[0], 2), "cy": round(c[1], 2)}
        for t, c in zip(times, centers)
    ]
    _write_debug(args.debug_json, debug)

    elapsed = time.time() - t_start
    say(f"REFRAME_OK mode={mode_used} crop={crop_w}x{crop_h} samples={samples} "
        f"confidence={confidence:.4f} out={out_w}x{out_h} "
        f"strategy={debug['render']['strategy']} elapsed={elapsed:.2f}s")
    return 0


def _write_debug(path, payload):
    if not path:
        return
    try:
        # nums as plain floats for json
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2, default=float)
        say(f"[reframe] debug json -> {path}")
    except Exception as e:
        warn("debug_json_failed", e.__class__.__name__)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as exc:  # never leak a traceback into the CI log
        sys.exit(die(f"unhandled {exc.__class__.__name__}: {exc}"))
