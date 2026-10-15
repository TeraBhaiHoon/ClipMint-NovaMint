#!/usr/bin/env python3
"""Realistic reframe fixture + failure reproduction, using a REAL face image.

Fixture characteristics that stress the tracker exactly where the audit said it
was unproven (audit/06 section 6):
  * face pans horizontally AND bobs vertically (tests cy, not just cx)
  * face SCALES (leans in/out)
  * ~0.8 s HARD OCCLUSION in the middle
  * a SECOND, briefly-larger face enters from t=6 s (tests identity stealing)
  * the speaker pauses (no motion) then resumes (tests static/dynamic decisions)

Run: python _audit/probe_real.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
PIPELINE = ROOT / "pipeline"
sys.path.insert(0, str(PIPELINE))

TMP = Path(tempfile.gettempdir()) / "cmtest"
TMP.mkdir(parents=True, exist_ok=True)
LENA = TMP / "lena.jpg"

W, H, FPS, DUR = 1920, 1080, 30, 14.0
NF = int(FPS * DUR)


def load_face():
    img = cv2.imread(str(LENA))
    if img is None:
        raise SystemExit("lena.jpg missing - run the curl download first")
    return img[80:400, 120:440]


def build(path: Path, lena):
    bg = np.zeros((H, W, 3), np.uint8)
    for y in range(H):
        bg[y, :] = (60 + y % 90, 70, 90)
    cv2.putText(bg, "STUDIO", (80, 160), cv2.FONT_HERSHEY_SIMPLEX, 4, (110, 140, 170), 8)

    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    truth = []
    rng = np.random.default_rng(7)
    for i in range(NF):
        t = i / FPS
        frame = bg.copy()
        # main speaker trajectory
        if t < 5.0:
            cx = 480 + (W - 960) * (t / 5.0)          # pan 480 -> 1440
        elif t < 7.0:
            cx = 1440                                  # HOLD (static segment)
        else:
            cx = 1440 - (W - 960) * ((t - 7.0) / 7.0)  # pan back
        cy = 470 + 90 * np.sin(t * 1.7)
        dw = np.interp(t, [0, 3, 7, DUR], [300, 340, 300, 240])
        fw = int(dw)
        face_r = cv2.resize(lena, (fw, fw))
        x0, y0 = int(cx - fw / 2), int(cy - fw / 2)
        occluded = 5.0 <= t <= 5.8
        if not occluded and y0 >= 0 and y0 + fw <= H and x0 >= 0 and x0 + fw <= W:
            frame[y0:y0 + fw, x0:x0 + fw] = face_r

        second = None
        if t >= 8.0:
            sw = int(320 * (1.5 if t < 9.5 else 1.0))
            sface = cv2.resize(lena, (sw, sw))
            sx, sy = 300, 700 - int(20 * np.sin(t))
            if sy + sw <= H and sx + sw <= W:
                frame[sy:sy + sw, sx:sx + sw] = sface
                second = (sx + sw / 2, sy + sw / 2)

        if occluded:
            cv2.rectangle(frame, (x0 - 20, 0), (x0 + fw + 20, H), (25, 25, 25), -1)
            cv2.putText(frame, "OCCLUDED", (max(x0 - 90, 20), H // 2),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.8, (200, 200, 200), 4)

        frame = cv2.add(frame, rng.integers(0, 8, (H, W, 3), dtype=np.uint8))
        vw.write(frame)
        truth.append({"t": round(t, 3), "cx": round(float(cx), 1), "cy": round(float(cy), 1),
                      "w": fw, "occluded": bool(occluded),
                      "second_cx": None if second is None else round(float(second[0]), 1)})
    vw.release()

    out = TMP / "real_face.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(path),
                    "-f", "lavfi", "-i", f"sine=frequency=220:duration={int(DUR)}",
                    "-shortest", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", str(out)], check=True)
    path.unlink(missing_ok=True)
    (TMP / "truth.json").write_text(json.dumps(truth, indent=2))
    return out


def main():
    lena = load_face()
    src = build(TMP / "_raw.mp4", lena)

    variant = sys.argv[1] if len(sys.argv) > 1 else "auto"
    debug = TMP / f"real_debug_{variant}.json"
    cmd = [sys.executable, str(PIPELINE / "smart_reframe.py"),
           "--input", str(src), "--output", str(TMP / f"real_out_{variant}.mp4"),
           "--mode", "auto", "--sample-fps", "4", "--debug-json", str(debug)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout.strip())
    if r.stderr.strip():
        print("STDERR:", r.stderr.strip())

    if not debug.exists():
        return
    d = json.loads(debug.read_text())
    print("\n--- summary ---")
    print("mode_used:", d.get("mode_used"), "samples:", d.get("samples"),
          "confidence:", d.get("confidence"), "note:", d.get("note"))

    truth = json.loads((TMP / "truth.json").read_text())
    raw = d.get("raw_centers") or []
    if raw and truth:
        print("\n  t    truth_cx  raw_cx   err   (occlusion/second-face marker)")
        step = max(1, len(raw) // 16)
        for k in range(0, len(raw), step):
            c = raw[k]
            ti = min(int(round(c["t"] * FPS)), len(truth) - 1)
            tr = truth[ti]
            err = c["cx"] - tr["cx"]
            mark = "OCCL" if tr["occluded"] else ("2ND" if tr["second_cx"] is not None else "")
            print(f"{c['t']:5.2f}  {tr['cx']:8.0f}  {c['cx']:7.0f} {err:+7.0f}   {mark}")
        errs = []
        for c in raw:
            ti = min(int(round(c["t"] * FPS)), len(truth) - 1)
            errs.append(c["cx"] - truth[ti]["cx"])
        import statistics
        print(f"\n  raw cx error: mean|err|={statistics.mean(abs(e) for e in errs):.0f}px "
              f"max|err|={max(abs(e) for e in errs):.0f}px")
    print("\nrender:", json.dumps(d.get("render"), indent=None))


if __name__ == "__main__":
    main()
