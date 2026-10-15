#!/usr/bin/env python3
"""Reproduce the reported face-tracking failures on a realistic fixture.

Builds a synthetic 1920x1080 clip in which a face image:
  * moves horizontally AND vertically (not just a flat pan),
  * SCALES (leans toward and away from camera),
  * is briefly OCCLUDED,
  * is joined from t=6s by a SECOND, briefly-larger face in the background.

Then reports the raw track, the smoothed track, and the detection ratio, so the
failure mode is visible as numbers before any fix is attempted.

Run:  python _audit/probe_reframe.py
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

W, H, FPS, DUR = 1920, 1080, 30, 12.0
NF = int(FPS * DUR)


def make_face_image(size=240):
    """A crude but YuNet-detectable synthetic face (proportions matter, not art)."""
    img = np.full((size, size, 3), 225, np.uint8)
    m = size // 6
    # head
    cv2.ellipse(img, (size // 2, size // 2), (size // 2 - m, size // 2 - m // 2), 0, 0, 360, (205, 195, 180), -1)
    # eyes
    ey = int(size * 0.42)
    for ex in (int(size * 0.33), int(size * 0.67)):
        cv2.ellipse(img, (ex, ey), (int(size * 0.09), int(size * 0.055)), 0, 0, 360, (255, 255, 255), -1)
        cv2.circle(img, (ex, ey), int(size * 0.042), (45, 35, 30), -1)
    # brows
    for bx in (int(size * 0.33), int(size * 0.67)):
        cv2.line(img, (bx - int(size * 0.10), ey - int(size * 0.10)),
                 (bx + int(size * 0.10), ey - int(size * 0.12)), (60, 50, 45), 3)
    # nose
    cv2.line(img, (size // 2, ey), (size // 2, int(size * 0.62)), (170, 160, 150), 3)
    # mouth
    cv2.ellipse(img, (size // 2, int(size * 0.72)), (int(size * 0.12), int(size * 0.05)), 0, 0, 360, (120, 80, 85), -1)
    return img


def build_fixture(path: Path):
    face = make_face_image()
    # Distinct backgrounds so the tracker has texture, not a flat colour.
    bg = np.zeros((H, W, 3), np.uint8)
    for y in range(H):
        bg[y, :] = (60 + y % 90, 70, 90)
    cv2.putText(bg, "STUDIO BACKDROP", (80, 140), cv2.FONT_HERSHEY_SIMPLEX, 4, (110, 140, 170), 8)

    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    truth = []
    rng = np.random.default_rng(7)
    for i in range(NF):
        t = i / FPS
        frame = bg.copy()
        # main speaker: pan + vertical bob + gentle scale
        scale = 1.0 + 0.30 * np.sin(t * 0.9)
        cx = 480 + (W - 960) * (t / DUR)          # 480 -> 1440 across the clip
        cy = 470 + 90 * np.sin(t * 1.7)           # vertical bob -> tests cy tracking
        fw = int(240 * scale)
        fh = int(240 * scale)
        face_r = cv2.resize(face, (fw, fh))
        x0, y0 = int(cx - fw / 2), int(cy - fh / 2)
        # occlusion window 4.0-4.8 s: a card sweeps over the speaker
        occluded = 4.0 <= t <= 4.8
        if not occluded and 0 <= y0 and y0 + fh <= H and 0 <= x0 and x0 + fw <= W:
            frame[y0:y0 + fh, x0:x0 + fw] = face_r

        # second person enters at t>=6 and is briefly LARGER
        second = None
        if t >= 6.0:
            sw = int(240 * (1.6 if t < 7.5 else 1.1))
            sh = sw
            sface = cv2.resize(face, (sw, sh))
            sx = int(200 + 60 * np.sin(t))
            sy = int(760 - 30 * np.sin(t * 1.3))
            if 0 <= sy and sy + sh <= H and 0 <= sx and sx + sw <= W:
                frame[sy:sy + sh, sx:sx + sw] = sface
                second = (sx + sw / 2, sy + sh / 2, sw)

        if occluded:
            cv2.rectangle(frame, (x0 - 10, 0), (x0 + fw + 10, H), (30, 30, 30), -1)
            cv2.putText(frame, "OCCLUDED", (x0 - 60, H // 2), cv2.FONT_HERSHEY_SIMPLEX, 1.6, (200, 200, 200), 3)

        noise = rng.integers(0, 9, (H, W, 3), dtype=np.uint8)
        frame = cv2.add(frame, noise)
        vw.write(frame)
        truth.append({"t": round(t, 3), "cx": round(float(cx), 1), "cy": round(float(cy), 1),
                      "w": fw, "occluded": bool(occluded),
                      "second_cx": None if second is None else round(second[0], 1)})
    vw.release()

    # mux with audio
    with_audio = TMP / "realistic_face.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(path),
                    "-f", "lavfi", "-i", "sine=frequency=220:duration=%d" % int(DUR),
                    "-shortest", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", str(with_audio)], check=True)
    path.unlink(missing_ok=True)
    (TMP / "truth.json").write_text(json.dumps(truth, indent=2))
    return with_audio


def main():
    raw_path = TMP / "_raw.mp4"
    if not raw_path.exists() and not (TMP / "realistic_face.mp4").exists():
        print("building fixture...")
    src = build_fixture(raw_path)
    print(f"fixture: {src}")

    debug = TMP / "reframe_debug.json"
    cmd = [sys.executable, str(PIPELINE / "smart_reframe.py"),
           "--input", str(src), "--output", str(TMP / "out.mp4"),
           "--mode", "auto", "--sample-fps", "4", "--debug-json", str(debug)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    print("--- reframe stdout ---")
    print(r.stdout.strip())
    if r.stderr.strip():
        print("--- reframe stderr ---")
        print(r.stderr.strip())

    if debug.exists():
        d = json.loads(debug.read_text())
        print("\n--- summary ---")
        print("mode_used:", d.get("mode_used"), "samples:", d.get("samples"),
              "confidence:", d.get("confidence"), "note:", d.get("note"))
        raw = d.get("raw_centers") or []
        if raw:
            xs = [c["cx"] for c in raw]
            print(f"raw cx span {min(xs):.0f}..{max(xs):.0f}  (span {max(xs)-min(xs):.0f})")
        final = d.get("centers") or []
        if final:
            xs = [c["cx"] for c in final]
            ys = [c["cy"] for c in final]
            print(f"final cx span {min(xs):.0f}..{max(xs):.0f}  (span {max(xs)-min(xs):.0f})")
            print(f"final cy span {min(ys):.0f}..{max(ys):.0f}  (span {max(ys)-min(ys):.0f})")
        print("render:", d.get("render"))


if __name__ == "__main__":
    main()
