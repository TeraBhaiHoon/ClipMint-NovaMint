#!/usr/bin/env python3
"""
ClipMint pipeline — dependency-light audio analysis.

Three questions the asset library and the auto-editor both need answered about
an audio file, without pulling a heavyweight DSP stack into CI:

  1. How loud is it?            -> `loudness()`   (ffmpeg ebur128, LUFS + true peak)
  2. Where is the energy?       -> `envelope()`   (ffmpeg decode -> onset envelope)
  3. What is the tempo?         -> `tempo()`      (autocorrelation over that envelope)

Design rules (same as the rest of `pipeline/`):

  * **ffmpeg is the only hard dependency.** numpy is used when present because it
    makes the envelope 50-100x faster, but every function degrades to a pure
    Python path rather than failing. A CI runner with no numpy must still index
    a music library.
  * **Never raise for a missing/undecodable stream.** A silent file, a video with
    no audio track, or a corrupt header returns `None`/empty and the caller
    decides. Asset indexing must not die because one file in 4,000 is broken.
  * **Machine-readable stdout markers** for the CLI, matching the convention in
    `smart_reframe.py` / `enhance_audio.py`:
        AUDIO_OK   duration=3.210 lufs=-8.5 tp=-6.0 bpm=128.0 energy=0.82
        AUDIO_SKIP no_audio_stream

Why an onset envelope rather than raw RMS: tempo estimation on a raw RMS curve
locks onto the amplitude modulation of the music (the "swell"), which is often
half or double the beat. Onset strength (positive half-wave rectified first
difference of RMS) removes the slow envelope and leaves the transients the
autocorrelation needs. That difference is the single reason the tempo estimate
below is usable rather than decorative.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
import sys
from pathlib import Path

try:  # optional — pure-Python fallbacks exist for everything below
    import numpy as _np
except Exception:  # noqa: BLE001
    _np = None

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = shutil.which("ffprobe") or "ffprobe"

# Analysis sample rate. 22.05 kHz keeps everything under Nyquist for onset
# detection (which cares about 100 Hz - 4 kHz) while halving the data volume of
# a 48 kHz source. Envelopes are computed at ENVELOPE_FPS by default: 100 Hz is
# finer than any beat interval we care about (600 BPM) and keeps arrays small.
ANALYSIS_RATE = 22050
ENVELOPE_FPS = 100

# Autocorrelation search window: 60-200 BPM. Below 60 is ambient (no beat),
# above 200 is a subdivision we fold back down in `_fold_tempo`.
BPM_MIN = 60.0
BPM_MAX = 200.0

# Absolute onset floor. Percentile normalisation divides by the 95th percentile,
# which turns the numerical noise floor of a *sustained* sound (a held note, a
# drone, room tone) into a full-scale envelope — and then autocorrelation finds a
# confident tempo in pure noise. Measured: an 8 s 440 Hz sine reported 119.98 BPM
# with a usable-looking correlation before this floor existed. Anything whose
# 95th-percentile onset is below this (≈ -80 dBFS frame-to-frame change) is
# treated as having no rhythm at all.
ONSET_NOISE_FLOOR = 1e-4

# Minimum autocorrelation peak before a tempo is reported as usable.
MIN_BEAT_CONFIDENCE = 0.25

# A "rhythm" needs repeated transients, not one loud one. An onset counts as
# strong at >= 30% of the peak, and a track needs at least 4 of them before
# tempo estimation is attempted at all.
RHYTHM_ONSET_RATIO = 0.30
RHYTHM_MIN_ONSETS = 4

# Onset floor, expressed RELATIVE to the file's own mean RMS. An absolute floor
# cannot work: a sustained 440 Hz sine at 22.05 kHz has 50.1 samples per cycle,
# so a 10 ms analysis window holds a non-integer number of cycles and the RMS
# wobbles by ~0.4% window to window. That wobble is a regular, repeating
# "onset" pattern that autocorrelation happily reads as 119.98 BPM. Measured
# peak-to-mean-RMS ratio for that tone: 0.0036. A real transient is >10% of the
# signal level, so requiring >= 2% separates them with two orders of magnitude
# of headroom in each direction.
ONSET_REL_FLOOR = 0.02

DECODE_TIMEOUT_SEC = 600
PROBE_TIMEOUT_SEC = 60


# ---------------------------------------------------------------------------
# Low level helpers
# ---------------------------------------------------------------------------
def _run(cmd: list[str], timeout: int = PROBE_TIMEOUT_SEC):
    return subprocess.run(cmd, capture_output=True, timeout=timeout)


def has_audio_stream(path: str) -> bool:
    """True when ffprobe sees at least one audio stream. False on any error."""
    try:
        proc = _run([
            FFPROBE, "-v", "error", "-select_streams", "a:0",
            "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(path),
        ])
    except Exception:  # noqa: BLE001 — ffprobe missing or hung
        return False
    return proc.returncode == 0 and b"audio" in proc.stdout


def probe_audio(path: str) -> dict | None:
    """ffprobe the first audio stream. None when there is none / on error."""
    try:
        proc = _run([
            FFPROBE, "-v", "error", "-select_streams", "a:0",
            "-show_entries",
            "stream=codec_name,sample_rate,channels,bit_rate,duration",
            "-show_entries", "format=duration,bit_rate",
            "-of", "json", str(path),
        ])
        if proc.returncode != 0:
            return None
        data = json.loads(proc.stdout or b"{}")
    except Exception:  # noqa: BLE001
        return None

    streams = data.get("streams") or []
    if not streams:
        return None
    stream = streams[0]
    fmt = data.get("format") or {}

    def _f(value):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    return {
        "codec": stream.get("codec_name"),
        "sample_rate": int(stream["sample_rate"]) if stream.get("sample_rate") else None,
        "channels": int(stream["channels"]) if stream.get("channels") else None,
        "bit_rate": int(stream["bit_rate"]) if stream.get("bit_rate") else None,
        "duration": _f(stream.get("duration")) or _f(fmt.get("duration")),
    }


# ---------------------------------------------------------------------------
# Loudness (ffmpeg ebur128)
# ---------------------------------------------------------------------------
_LUFS_RE = re.compile(r"I:\s*(-?\d+(?:\.\d+)?)\s*LUFS")
_PEAK_RE = re.compile(r"Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS")
_LRA_RE = re.compile(r"LRA:\s*(-?\d+(?:\.\d+)?)\s*LU")


def _finite(value: str | None):
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def loudness(path: str) -> dict | None:
    """Integrated loudness / true peak / LRA via ffmpeg's ebur128 filter.

    Returns {'lufs': float, 'true_peak_dbfs': float, 'lra': float|None} or None.

    ebur128 writes its summary to stderr, so stderr is parsed rather than the
    exit code trusted alone — the filter still exits 0 on a silent file and
    reports -inf, which is normalised to None rather than propagating `inf` into
    JSON (which is not valid JSON and would break the manifest).
    """
    try:
        proc = _run([
            FFMPEG, "-hide_banner", "-nostdin", "-i", str(path),
            "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-",
        ], timeout=DECODE_TIMEOUT_SEC)
    except Exception:  # noqa: BLE001
        return None

    err = proc.stderr.decode("utf-8", "replace")
    lufs_m = _LUFS_RE.search(err)
    peak_m = _PEAK_RE.search(err)
    if not lufs_m:
        return None

    lra_m = _LRA_RE.search(err)
    return {
        "lufs": _finite(lufs_m.group(1)),
        "true_peak_dbfs": _finite(peak_m.group(1)) if peak_m else None,
        "lra": _finite(lra_m.group(1)) if lra_m else None,
    }


# ---------------------------------------------------------------------------
# Envelope (onset strength)
# ---------------------------------------------------------------------------
def decode_pcm(path: str, rate: int = ANALYSIS_RATE, timeout: int = DECODE_TIMEOUT_SEC):
    """Decode the first audio stream to mono float32. Returns (bytes, ok)."""
    try:
        proc = subprocess.run(
            [FFMPEG, "-v", "error", "-nostdin", "-i", str(path),
             "-vn", "-ac", "1", "-ar", str(rate), "-f", "f32le", "-"],
            capture_output=True, timeout=timeout,
        )
    except Exception:  # noqa: BLE001
        return b"", False
    if proc.returncode != 0 or not proc.stdout:
        return b"", False
    return proc.stdout, True


def _to_samples(raw: bytes):
    """bytes -> float array in [-1, 1]. numpy when available, else a list."""
    if _np is not None:
        return _np.frombuffer(raw, dtype="<f4")
    # Pure-Python fallback: struct.unpack over the whole buffer. Slower, but a
    # 30 s SFX is ~660k samples and completes in well under a second.
    import struct

    count = len(raw) // 4
    return list(struct.unpack(f"<{count}f", raw[: count * 4]))


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _std(values: list[float]) -> float:
    if not values:
        return 0.0
    m = _mean(values)
    return math.sqrt(sum((v - m) ** 2 for v in values) / len(values))


def envelope(path: str, fps: int = ENVELOPE_FPS, rate: int = ANALYSIS_RATE) -> dict | None:
    """Onset-strength envelope of the whole file.

    Returns {'fps', 'values', 'duration', 'onset_peak', 'has_rhythm',
    'energy', 'dynamics'} or None.

    Normalisation divides by the **maximum** onset, not a percentile. A
    percentile was tried first and is wrong here: percussive material is
    *sparse* — a click track has onsets in ~2% of frames — so the 95th
    percentile of its onset array is 0 and the whole track normalises to zero.
    Measured: a 120 BPM click track reported `energy=0.0` under the percentile
    version.

    `has_rhythm` is therefore a *repetition* test, not a magnitude test. A
    single edge transient (every audio file has one, from the ffmpeg source's
    ramp-in) produces one large onset and no rhythm; a real beat produces many.
    Requiring >= RHYTHM_MIN_ONSETS onsets above RHYTHM_ONSET_RATIO of the peak
    is what separates "this track has a beat" from "this track had a click at
    t=0" — the latter previously produced a confident, entirely fabricated
    119.98 BPM from a sustained 440 Hz sine.
    """
    raw, ok = decode_pcm(path, rate=rate)
    if not ok:
        return None

    samples = _to_samples(raw)
    n = len(samples)
    if n < rate // 4:  # < 250 ms of audio: nothing to analyse
        return None

    window = max(1, int(rate / fps))
    n_windows = n // window
    if n_windows < 2:
        return None

    if _np is not None:
        trimmed = samples[: n_windows * window].reshape(n_windows, window)
        rms = _np.sqrt(_np.mean(_np.square(trimmed), axis=1))
        onset = _np.maximum(_np.diff(rms), 0.0)
        peak = float(onset.max()) if onset.size else 0.0
        level = float(rms.mean()) if rms.size else 0.0
        out = [float(v) for v in (onset / peak)] if peak > 0 else [0.0] * int(onset.size)
    else:
        rms: list[float] = []
        for i in range(n_windows):
            chunk = samples[i * window: (i + 1) * window]
            total = 0.0
            for s in chunk:
                total += s * s
            rms.append(math.sqrt(total / len(chunk)))
        onset = [max(0.0, rms[i] - rms[i - 1]) for i in range(1, len(rms))]
        peak = max(onset) if onset else 0.0
        level = _mean(rms)
        out = [v / peak for v in onset] if peak > 0 else [0.0] * len(onset)

    floor = max(ONSET_NOISE_FLOOR, ONSET_REL_FLOOR * level)
    strong = sum(1 for v in out if v >= RHYTHM_ONSET_RATIO)
    has_rhythm = peak >= floor and strong >= RHYTHM_MIN_ONSETS

    return {
        "fps": fps,
        "values": out,
        "duration": n / float(rate),
        "onset_peak": round(peak, 8),
        "onset_floor": round(floor, 8),
        "strong_onsets": strong,
        "has_rhythm": has_rhythm,
        # Onset energy is only meaningful when real transients exist. Without
        # them the normalised values are amplified noise, and reporting that as
        # "energy" would let a drone outrank a drum loop in asset ranking.
        "energy": round(_mean(out), 4) if has_rhythm else 0.0,
        "dynamics": round(_std(out), 4) if has_rhythm else 0.0,
    }


# ---------------------------------------------------------------------------
# Tempo (autocorrelation over the onset envelope)
# ---------------------------------------------------------------------------
def _fold_tempo(bpm: float) -> float:
    """Fold an octave-ambiguous tempo into [BPM_MIN, BPM_MAX].

    Autocorrelation cannot tell 70 BPM from 140 BPM — the lag at half the period
    correlates just as strongly. Folding by octaves (rather than clamping) keeps
    the *beat*, which is what matters for cutting on it.
    """
    if bpm <= 0:
        return 0.0
    while bpm < BPM_MIN:
        bpm *= 2.0
    while bpm > BPM_MAX:
        bpm /= 2.0
    return bpm


def tempo(values: list[float], fps: int = ENVELOPE_FPS) -> dict:
    """Autocorrelation tempo estimate. Returns {'bpm': float, 'confidence': float}.

    confidence is the normalised autocorrelation peak at the winning lag
    (0..1). Below ~0.25 the track has no reliable pulse (ambient, drones,
    speech) and callers should not beat-sync to it.
    """
    n = len(values)
    min_lag = max(1, int(round(fps * 60.0 / BPM_MAX)))
    max_lag = int(round(fps * 60.0 / BPM_MIN))
    if n < max_lag * 2 or max_lag <= min_lag:
        return {"bpm": 0.0, "confidence": 0.0}

    mean = _mean(values)
    centered = [v - mean for v in values]
    energy = sum(v * v for v in centered)
    if energy <= 1e-9:
        return {"bpm": 0.0, "confidence": 0.0}

    def _corr_at(lag: int) -> float:
        if lag < 1 or lag >= n:
            return 0.0
        acc = 0.0
        # Step by 2: autocorrelation at envelope resolution is smooth, and
        # halving the inner loop keeps a 3-minute track under a second in pure
        # Python. Accuracy loss is < 1 BPM after the parabolic refine below.
        for i in range(0, n - lag, 2):
            acc += centered[i] * centered[i + lag]
        return acc / energy

    best_lag, best_corr = 0, 0.0
    for lag in range(min_lag, max_lag + 1):
        corr = _corr_at(lag)
        if corr > best_corr:
            best_corr, best_lag = corr, lag

    if best_lag == 0:
        return {"bpm": 0.0, "confidence": 0.0}

    # Parabolic interpolation around the winning lag: the true period is almost
    # never an integer number of envelope frames, and without this the estimate
    # quantises to ~1.5 BPM steps at 140 BPM.
    c0, c1, c2 = _corr_at(best_lag - 1), best_corr, _corr_at(best_lag + 1)
    denom = c0 - 2 * c1 + c2
    offset = 0.5 * (c0 - c2) / denom if abs(denom) > 1e-12 else 0.0
    offset = max(-0.5, min(0.5, offset))

    bpm = _fold_tempo(60.0 * fps / (best_lag + offset))
    return {"bpm": round(bpm, 2), "confidence": round(min(1.0, max(0.0, best_corr)), 4)}


def beats(values: list[float], fps: int = ENVELOPE_FPS, bpm: float = 0.0) -> list[float]:
    """Beat times in seconds: phase-locked to the strongest onset near the grid.

    Returns [] when no usable tempo was supplied. The phase search is what stops
    the grid from landing consistently *between* the hits, which is the usual
    failure of a naive `t = n * 60/bpm` grid.
    """
    if bpm <= 0 or not values:
        return []
    period = 60.0 / bpm
    step = period * fps  # frames per beat
    n = len(values)

    best_phase, best_score = 0.0, -1.0
    for phase in range(max(1, int(round(step)))):
        score = 0.0
        pos = float(phase)
        while pos < n:
            score += values[int(pos)]
            pos += step
        if score > best_score:
            best_score, best_phase = score, float(phase)

    out: list[float] = []
    pos = best_phase
    while pos < n:
        out.append(round(pos / fps, 4))
        pos += step
    return out


def analyse(path: str, with_envelope: bool = False, with_tempo: bool = True) -> dict | None:
    """One call for everything: probe + loudness + energy + tempo.

    Returns None when the file has no decodable audio stream. `envelope` and
    `beats` are only included when requested, because they are large (100 floats
    per second) and the asset manifest only needs the summaries.
    """
    if not has_audio_stream(path):
        return None

    info = probe_audio(path) or {}
    loud = loudness(path) or {}
    result: dict = {
        "duration": info.get("duration"),
        "codec": info.get("codec"),
        "sample_rate": info.get("sample_rate"),
        "channels": info.get("channels"),
        "bit_rate": info.get("bit_rate"),
        "lufs": loud.get("lufs"),
        "true_peak_dbfs": loud.get("true_peak_dbfs"),
        "lra": loud.get("lra"),
        "energy": None,
        "dynamics": None,
        "bpm": None,
        "beat_confidence": None,
    }

    if with_tempo or with_envelope:
        env = envelope(path)
        if env:
            result["energy"] = env["energy"]
            result["dynamics"] = env["dynamics"]
            result["has_rhythm"] = env["has_rhythm"]
            if result["duration"] is None:
                result["duration"] = round(env["duration"], 3)
            if with_tempo:
                t = tempo(env["values"], env["fps"]) if env["has_rhythm"] else \
                    {"bpm": 0.0, "confidence": 0.0}
                # A tempo is only reported when the autocorrelation actually
                # found a pulse. Below the confidence gate the track is ambient
                # or speech and beat-syncing to it would invent a rhythm.
                usable = t["confidence"] >= MIN_BEAT_CONFIDENCE
                result["bpm"] = t["bpm"] if usable else None
                result["beat_confidence"] = t["confidence"]
                result["beat_sync_ok"] = bool(usable)
                if with_envelope:
                    result["beats"] = beats(env["values"], env["fps"], t["bpm"]) if usable else []
            if with_envelope:
                result["envelope"] = env["values"]
                result["envelope_fps"] = env["fps"]

    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="ClipMint audio analysis (ffmpeg + optional numpy)")
    ap.add_argument("--input", required=True, help="audio or video file")
    ap.add_argument("--envelope", action="store_true", help="include the onset envelope")
    ap.add_argument("--no-tempo", action="store_true")
    ap.add_argument("--json-out", default=None)
    args = ap.parse_args(argv)

    if not Path(args.input).is_file():
        print(f"FATAL: no such file: {args.input}", file=sys.stderr)
        return 2

    result = analyse(args.input, with_envelope=args.envelope, with_tempo=not args.no_tempo)
    if result is None:
        print("AUDIO_SKIP no_audio_stream")
        return 0

    if args.json_out:
        Path(args.json_out).write_text(json.dumps(result, indent=2))

    print(
        "AUDIO_OK duration={dur} lufs={lufs} tp={tp} bpm={bpm} energy={energy}".format(
            dur=result.get("duration"),
            lufs=result.get("lufs"),
            tp=result.get("true_peak_dbfs"),
            bpm=result.get("bpm"),
            energy=result.get("energy"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
