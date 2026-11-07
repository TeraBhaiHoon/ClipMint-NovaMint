#!/usr/bin/env python3
"""ClipMint pipeline — per-clip quality instrument.

One ffmpeg pass per clip measures everything a bad render can get wrong, and
the result is a 0-100 score plus a per-check breakdown that ships to the
dashboard so users can SEE the quality instead of trusting it:

    loudness (EBU R128 integrated + true peak)
    clipping (sample peak near/over digital full scale)
    black frames   (blackdetect)
    frozen picture (freezedetect)
    trailing dead air (silencedetect)
    resolution / fps sanity
    video bitrate sanity
    caption coverage + caption/audio sync (optional --captions)

Checks are ffmpeg-only (no third-party deps), so the instrument itself cannot
break a render: any measurement failure becomes a "warn" check, never a job
failure. Output is machine-readable:

    QA_OK score=87 json=/path/clip_000_qa.json

Design notes:
- ONE ffmpeg invocation decodes the clip once for the video filters (black +
  freeze) and the audio filters (ebur128 + silencedetect) — on a 4-vCPU
  runner a 30 s 1080p clip analyses in a few seconds.
- Scores start at 100 and lose points per problem; every check records its
  measured value so a low score is explainable, not a black box.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"

TARGET_LUFS = -14.0
MAX_CLIP_SECONDS = 90.0
MIN_CLIP_SECONDS = 5.0

# score weights
W = {
    "no_audio": 40,
    "black": 15,
    "freeze": 10,
    "loudness_far": 15,
    "loudness_near": 8,
    "clipping": 20,
    "near_clip": 10,
    "dead_air_long": 15,
    "dead_air": 8,
    "resolution": 10,
    "fps": 5,
    "bitrate": 10,
    "captions_sparse": 15,
    "captions_late": 8,
}


def probe(path: str) -> dict:
    r = subprocess.run(
        [FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        capture_output=True, text=True, timeout=120,
    )
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {r.stderr.strip()[:200]}")
    data = json.loads(r.stdout)
    streams = data.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    try:
        dur = float(data.get("format", {}).get("duration") or 0.0)
    except (TypeError, ValueError):
        dur = 0.0
    try:
        vbr = int(data.get("format", {}).get("bit_rate") or 0)
    except (TypeError, ValueError):
        vbr = 0
    fps = 0.0
    if v:
        rate = v.get("avg_frame_rate") or v.get("r_frame_rate") or "0/1"
        try:
            num, den = rate.split("/")
            fps = float(num) / float(den) if float(den) else 0.0
        except (ValueError, ZeroDivisionError):
            fps = 0.0
    return {
        "duration": dur,
        "bitrate": vbr,
        "has_audio": a is not None,
        "width": int((v or {}).get("width") or 0),
        "height": int((v or {}).get("height") or 0),
        "fps": fps,
        "vcodec": (v or {}).get("codec_name"),
    }


def analyse(path: str) -> dict:
    """One decode pass: ebur128 + silencedetect on audio, blackdetect +
    freezedetect on video. Returns parsed measurements."""
    r = subprocess.run(
        [FFMPEG, "-hide_banner", "-nostdin", "-i", path,
         "-af", "ebur128=peak=true,silencedetect=noise=-45dB:d=1.0",
         "-vf", "blackdetect=d=0.5:pix_th=0.10,freezedetect=n=-60dB:d=2",
         "-f", "null", "-"],
        capture_output=True, text=True, timeout=600,
    )
    text = r.stderr or ""

    out: dict = {}
    m = re.search(r"I:\s*(-?[\d.]+)\s*LUFS", text)
    out["lufs"] = float(m.group(1)) if m else None
    m = re.search(r"Peak:\s*(-?[\d.]+)\s*dBFS", text)
    out["true_peak_dbfs"] = float(m.group(1)) if m else None

    blacks = re.findall(
        r"black_start:\s*(-?[\d.]+)\s+black_end:\s*(-?[\d.]+)\s+black_duration:\s*([\d.]+)", text)
    out["black_segments"] = [
        {"start": float(s), "end": float(e), "duration": float(d)} for s, e, d in blacks
    ]

    freezes = re.findall(
        r"freeze_start:\s*(-?[\d.]+).*?freeze_duration:\s*([\d.]+).*?freeze_end:\s*(-?[\d.]+)", text)
    out["freeze_segments"] = [
        {"start": float(s), "end": float(e), "duration": float(d)} for s, e, d in freezes
    ]

    silences = re.findall(
        r"silence_start:\s*(-?[\d.]+)", text)
    sil_ends = re.findall(r"silence_end:\s*(-?[\d.]+)", text)
    out["silence_segments"] = list(zip([float(s) for s in silences], [float(e) for e in sil_ends]))
    return out


def caption_checks(caps: list[dict], duration: float) -> tuple[list[str], float]:
    """(defects, first_word_start_s). Reuses the SAME coverage rule as the
    pipeline's caption gate so the score cannot contradict the gate."""
    defects: list[str] = []
    first_start = None
    covered = 0.0
    for c in caps:
        s, e = c.get("startMs"), c.get("endMs")
        if not isinstance(s, (int, float)) or not isinstance(e, (int, float)):
            continue
        if first_start is None and e > s:
            first_start = s / 1000.0
        covered += max(0.0, e - s)
    if duration > 0:
        coverage = covered / (duration * 1000.0)
        if coverage < 0.30:
            defects.append(f"coverage {coverage:.0%} < 30%")
    return defects, (first_start if first_start is not None else 0.0)


def build_report(path: str, caps_path: str | None) -> dict:
    checks: list[dict] = []
    score = 100

    def add(cid: str, label: str, status: str, value, detail: str, weight: int = 0) -> None:
        nonlocal score
        checks.append({"id": cid, "label": label, "status": status,
                       "value": value, "detail": detail})
        score -= weight if status == "fail" else 0

    meta = probe(path)
    duration = meta["duration"]

    # duration bounds
    if duration < MIN_CLIP_SECONDS:
        add("duration", "Duration", "fail", f"{duration:.1f}s",
            f"clip is shorter than {MIN_CLIP_SECONDS:.0f}s", W["no_audio"] // 2)
    elif duration > MAX_CLIP_SECONDS + 5:
        add("duration", "Duration", "warn", f"{duration:.1f}s",
            f"longer than the {MAX_CLIP_SECONDS:.0f}s cap")

    # audio presence + loudness + clipping
    if not meta["has_audio"]:
        add("audio", "Audio track", "fail", "missing", "no audio stream", W["no_audio"])
        lufs = tp = None
        analysis = {"lufs": None, "true_peak_dbfs": None, "black_segments": [],
                    "freeze_segments": [], "silence_segments": []}
    else:
        analysis = analyse(path)
        lufs = analysis["lufs"]
        tp = analysis["true_peak_dbfs"]
        if lufs is None:
            add("loudness", "Loudness (LUFS)", "warn", "unmeasured",
                "EBU R128 measurement unavailable")
        else:
            delta = abs(lufs - TARGET_LUFS)
            if delta > 3.0:
                add("loudness", "Loudness (LUFS)", "fail", f"{lufs:.1f} LUFS",
                    f"{delta:.1f} LU off the {TARGET_LUFS:g} LUFS target", W["loudness_far"])
            elif delta > 1.0:
                add("loudness", "Loudness (LUFS)", "warn", f"{lufs:.1f} LUFS",
                    f"{delta:.1f} LU off target", W["loudness_near"])
            else:
                add("loudness", "Loudness (LUFS)", "pass", f"{lufs:.1f} LUFS",
                    "on platform target")
        if tp is not None:
            if tp >= -0.2:
                add("clipping", "True peak", "fail", f"{tp:.1f} dBTP",
                    "at/over digital full scale — audible distortion", W["clipping"])
            elif tp > -0.8:
                add("clipping", "True peak", "warn", f"{tp:.1f} dBTP",
                    "very close to full scale", W["near_clip"])
            else:
                add("clipping", "True peak", "pass", f"{tp:.1f} dBTP", "clean headroom")

    # black / freeze
    total_black = sum(b["duration"] for b in analysis["black_segments"])
    if total_black > 0.3:
        add("black", "Black frames", "fail", f"{total_black:.2f}s",
            f"{len(analysis['black_segments'])} black span(s)", W["black"])
    else:
        add("black", "Black frames", "pass", "none", "")
    total_freeze = sum(f["duration"] for f in analysis["freeze_segments"])
    if total_freeze > 1.5:
        add("freeze", "Frozen picture", "fail", f"{total_freeze:.2f}s",
            "picture static for seconds at a time", W["freeze"])
    else:
        add("freeze", "Frozen picture", "pass", "none", "")

    # trailing dead air
    tail_silence = 0.0
    if meta["has_audio"]:
        for s, e in analysis["silence_segments"]:
            if e >= duration - 0.25:
                tail_silence = max(tail_silence, e - max(s, 0.0))
    if tail_silence > 3.0:
        add("dead_air", "Trailing silence", "fail", f"{tail_silence:.1f}s",
            "clip ends on dead air", W["dead_air_long"])
    elif tail_silence > 1.5:
        add("dead_air", "Trailing silence", "warn", f"{tail_silence:.1f}s",
            "noticeable silence at the end", W["dead_air"])
    else:
        add("dead_air", "Trailing silence", "pass", f"{tail_silence:.1f}s", "")

    # resolution / fps / bitrate
    area = meta["width"] * meta["height"]
    if area == 0:
        add("resolution", "Resolution", "fail", "none", "no video stream", W["resolution"])
    elif meta["height"] < 720:
        add("resolution", "Resolution", "fail", f"{meta['width']}x{meta['height']}",
            "below 720p — captions will look soft", W["resolution"])
    elif meta["height"] < 1080:
        add("resolution", "Resolution", "warn", f"{meta['width']}x{meta['height']}",
            "below the 1080p deliverable standard", W["resolution"] // 2)
    else:
        add("resolution", "Resolution", "pass", f"{meta['width']}x{meta['height']}", "")
    if meta["fps"] and not (20.0 <= meta["fps"] <= 65.0):
        add("fps", "Frame rate", "fail", f"{meta['fps']:.2f}", "outside sane range", W["fps"])
    # 1080p vertical deliverable at CRF18 veryfast lands ~2-8 Mbps; a tiny
    # bitrate on a big frame means mush. Floor scales with area.
    floor_kbps = 500 if area <= 640 * 360 else (1500 if meta["height"] < 1080 else 2500)
    if meta["bitrate"] and meta["bitrate"] < floor_kbps * 1000:
        add("bitrate", "Video bitrate", "fail",
            f"{meta['bitrate'] // 1000} kbps", f"below the {floor_kbps} kbps floor", W["bitrate"])
    else:
        add("bitrate", "Video bitrate", "pass",
            f"{meta['bitrate'] // 1000} kbps" if meta["bitrate"] else "n/a", "")

    # captions (optional)
    if caps_path:
        try:
            caps = json.loads(Path(caps_path).read_text())
            defects, first_start = caption_checks(caps, duration)
            if not caps:
                add("captions", "Captions", "fail", "empty",
                    "no caption words for this clip", W["captions_sparse"])
            elif defects:
                add("captions", "Captions", "fail", "; ".join(defects),
                    "caption gate metrics", W["captions_sparse"])
            elif first_start > 2.5:
                add("captions", "Captions", "warn", f"first word at {first_start:.1f}s",
                    "captions start late", W["captions_late"])
            else:
                add("captions", "Captions", "pass",
                    f"{len(caps)} words from {first_start:.1f}s", "")
        except (OSError, ValueError) as exc:
            add("captions", "Captions", "warn", "unreadable", str(exc)[:80])
    else:
        add("captions", "Captions", "warn", "not measured",
            "no captions file supplied for this check")

    score = max(0, min(100, score))
    return {
        "score": score,
        "clip": {"path": path, "duration": round(duration, 2),
                 "width": meta["width"], "height": meta["height"],
                 "fps": round(meta["fps"], 2), "has_audio": meta["has_audio"]},
        "loudness": {"lufs": lufs, "true_peak_dbfs": tp},
        "checks": checks,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Per-clip quality instrument")
    ap.add_argument("--clip", required=True)
    ap.add_argument("--captions", default="")
    ap.add_argument("--json", default="", help="write the report JSON here")
    args = ap.parse_args()

    if not Path(args.clip).is_file():
        print(f"QA_ERROR clip not found: {args.clip}")
        return 1

    try:
        report = build_report(args.clip, args.captions or None)
    except Exception as exc:  # noqa: BLE001 — the instrument must never break a job
        print(f"QA_WARN analysis failed ({exc.__class__.__name__}: {exc})")
        return 0

    out_json = ""
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2))
        out_json = f" json={args.json}"

    worst = [c for c in report["checks"] if c["status"] == "fail"]
    print(f"QA_OK score={report['score']} fails={len(worst)}{out_json}")
    for c in report["checks"]:
        mark = {"pass": "+", "warn": "~", "fail": "!"}[c["status"]]
        print(f"  [{mark}] {c['label']}: {c['value']} {c['detail']}".rstrip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
