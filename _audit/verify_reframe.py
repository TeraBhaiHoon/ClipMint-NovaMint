#!/usr/bin/env python3
"""Verify the face-tracking fixes against ground truth.

Runs the SAME realistic fixture through smart_reframe.py and asserts:
  1. the crop never locks onto the intruder (raw cx error stays small)
  2. the rendered face stays near centre in the 1080x1920 output
  3. no 800px whip-pan when the second face appears
  4. the vertical/other fallbacks still behave

Run: python _audit/verify_reframe.py
"""
import json
import os
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent.parent
PIPELINE = ROOT / "pipeline"
TMP = Path(tempfile.gettempdir()) / "cmtest"
MODEL = os.path.expanduser("~/.cache/clipmint/face_detection_yunet_2023mar.onnx")

FAILS = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'} {name}" + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def run_reframe(src, out, debug, extra=()):
    cmd = [sys.executable, str(PIPELINE / "smart_reframe.py"),
           "--input", str(src), "--output", str(out),
           "--mode", "auto", "--sample-fps", "4", "--debug-json", str(debug), *extra]
    return subprocess.run(cmd, capture_output=True, text=True)


def face_centre_offset(video):
    """
    Return (max |offset from centre| px, list of (t, offset)).

    When a second person is in frame the crop deliberately keeps the SPEAKER,
    so we measure the face nearest the centre of the output - not the largest.
    Measuring the largest would flag the (correctly side-lined) intruder as an
    error, which is what a naive harness does.
    """
    cap = cv2.VideoCapture(str(video))
    det = cv2.FaceDetectorYN.create(MODEL, "", (1080, 1920), 0.5, 0.3, 5000)
    det.setInputSize((1080, 1920))
    rows, n = [], 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        if n % 10 == 0:
            _, fc = det.detect(fr)
            if fc is not None and len(fc):
                centres = [float(b[0]) + float(b[2]) / 2 for b in fc]
                cx = min(centres, key=lambda c: abs(c - 540.0))
                rows.append((n / 30.0, cx - 540.0))
        n += 1
    cap.release()
    return (max((abs(o) for _, o in rows), default=0.0), rows)


def main():
    src = TMP / "real_face.mp4"
    truth = json.loads((TMP / "truth.json").read_text())
    if not src.exists():
        raise SystemExit("run _audit/probe_real.py first to build the fixture")
    FPS = 30

    print("== identity lock (intruder enters at t=8s) ==")
    dbg = TMP / "verify_debug.json"
    out = TMP / "verify_out.mp4"
    r = run_reframe(src, out, dbg)
    check("process exits 0", r.returncode == 0, r.stderr[-300:])

    d = json.loads(dbg.read_text())
    check("face mode used (not centre fallback)", d["mode_used"] == "face", d["mode_used"])
    print(f"     identity_switches via note: {d.get('note')}, "
          f"held_samples={d.get('held_samples')}, "
          f"locked_ratio={d.get('identity_locked_ratio')}")

    raw = d["raw_centers"]
    errs, second_errs = [], []
    for c in raw:
        ti = min(int(round(c["t"] * FPS)), len(truth) - 1)
        e = c["cx"] - truth[ti]["cx"]
        errs.append(e)
        if truth[ti]["second_cx"] is not None:
            second_errs.append(e)
    max_err = max(abs(e) for e in errs)
    p95 = sorted(abs(e) for e in errs)[int(0.95 * len(errs))]
    print(f"     raw cx error: mean|e|={statistics.mean(abs(e) for e in errs):.0f}px "
          f"p95={p95:.0f}px max={max_err:.0f}px")
    print(f"     error while intruder present: "
          f"mean|e|={statistics.mean(abs(e) for e in second_errs):.0f}px "
          f"max={max(abs(e) for e in second_errs):.0f}px")

    # BEFORE: max 624px, and dominated by the intruder window.
    check("no identity theft: max raw cx error < 120px", max_err < 120, f"{max_err:.0f}px")
    check("intruder window stays locked: max err there < 150px",
          max(abs(e) for e in second_errs) < 150,
          f"{max(abs(e) for e in second_errs):.0f}px")

    print("\n== rendered framing (face position inside 1080x1920) ==")
    off, rows = face_centre_offset(out)
    print(f"     max |offset from centre| = {off:.0f}px of 540")
    # BEFORE: 452px.
    check("face stays near centre: max offset < 200px", off < 200, f"{off:.0f}px")

    jumps = [abs(rows[i][1] - rows[i - 1][1])
             for i in range(1, len(rows))
             if rows[i][0] - rows[i - 1][0] <= 0.4]
    max_jump = max(jumps, default=0.0)
    print(f"     max frame-to-frame jump = {max_jump:.0f}px "
          f"(per 0.33s window, {len(jumps)} windows)")
    # BEFORE: 886px whip-pan.
    check("no whip-pan: max jump < 200px", max_jump < 200, f"{max_jump:.0f}px")

    print("\n== fallback regression ==")
    # centre-mode must not analyse
    r2 = run_reframe(src, TMP / "verify_center.mp4", TMP / "verify_center.json",
                     extra=("--mode", "center"))
    d2 = json.loads((TMP / "verify_center.json").read_text())
    check("centre mode = static crop", d2["mode_used"] == "center"
          and d2["render"]["strategy"] == "static", str(d2["render"]["strategy"]))

    # model unavailable must degrade, not fail
    empty_cache = TMP / "_emptycache"
    empty_cache.mkdir(exist_ok=True)
    r3 = run_reframe(src, TMP / "verify_nodl.mp4", TMP / "verify_nodl.json",
                     extra=("--no-download", "--model-cache", str(empty_cache)))
    d3 = json.loads((TMP / "verify_nodl.json").read_text())
    check("model unavailable -> centre, rc=0",
          r3.returncode == 0 and d3["mode_used"] == "center", f"rc={r3.returncode}")

    # missing input must fail loudly
    r4 = subprocess.run([sys.executable, str(PIPELINE / "smart_reframe.py"),
                         "--input", str(TMP / "nope.mp4"), "--output", str(TMP / "x.mp4")],
                        capture_output=True, text=True)
    check("missing input exits non-zero", r4.returncode != 0, f"rc={r4.returncode}")

    print("\n== smoothing unit checks ==")
    sys.path.insert(0, str(PIPELINE))
    import smart_reframe as sr
    ramp = [(480 + 960 * (i / 40), 540) for i in range(41)]
    sm, _ = sr.smooth_track(ramp, sr.SMOOTHING_DEFAULT, 0.25)
    xs = [c[0] for c in sm]
    err = max(abs(xs[i] - ramp[i][0]) for i in range(len(ramp)))
    print(f"     default smoothing {sr.SMOOTHING_DEFAULT}: max lag {err:.0f}px on a ramp")
    check("default smoothing keeps lag < 40px", err < 40, f"{err:.0f}px")

    # bridge_gaps interpolates rather than holding
    cents = [(0, 0), (0, 0), (0, 0), (300, 0), (300, 0)]
    obs = [True, False, False, True, True]
    bridged = sr.bridge_gaps(cents, obs)
    check("bridge_gaps interpolates a gap",
          bridged[1] == (100.0, 0.0) and bridged[2] == (200.0, 0.0), str(bridged))
    check("bridge_gaps leaves observed samples untouched",
          bridged[0] == (0, 0) and bridged[3] == (300, 0))

    print("\n" + ("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: {FAILS}"))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
