#!/usr/bin/env python3
"""
ClipMint pipeline — turn AI-selected moments into finished vertical clips.

For every moment this module, in order:

  1. Snaps the boundaries to nearby silence so cuts land in pauses, not
     mid-word, and enforces sane length limits.
  2. Cuts the source with a single precise re-encode (no double encoding: the
     reframe and the loudness pass below operate on this file only).
  3. Reframes to 1080x1920 with face-aware crop tracking when the source is
     not already vertical (`pipeline/smart_reframe.py`).
  4. Normalises loudness to -14 LUFS / -1 dBTP with optional denoise
     (`pipeline/enhance_audio.py`).
  5. Writes the clip-relative caption words, re-zeroed to the ACTUAL cut
     start so captions cannot drift out of sync with the picture.
  6. Records per-clip metadata (duration, has_audio) for the render step.

Doing the trim here — rather than inside Remotion — is deliberate. Trimming in
the renderer meant the video timeline shifted while caption timestamps did not,
and a mis-set trim length silently truncated clips to ~1.5 seconds.

Usage:
  python3 pipeline/prepare_clips.py \
      --source workspace/source/source.mp4 \
      --moments workspace/clips/viral_moments.json \
      --captions workspace/audio/full_captions.json \
      --silences workspace/audio/silences.txt \
      --outdir workspace/clips \
      [--min-seconds 15] [--max-seconds 90] [--no-reframe] [--no-enhance]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

MIN_CLIP_SECONDS = 15.0
MAX_CLIP_SECONDS = 90.0
SNAP_MAX_SHIFT = 3.0
SNAP_MIN_SILENCE = 0.18

PIPELINE_DIR = Path(__file__).resolve().parent


# ---------------------------------------------------------------------------
# Shell helpers
# ---------------------------------------------------------------------------
def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kwargs)


def probe(path: Path) -> dict:
    """ffprobe a file, returning duration and stream info."""
    resp = run([
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ])
    if resp.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {path}: {resp.stderr[:300]}")
    data = json.loads(resp.stdout)
    duration = float(data.get("format", {}).get("duration") or 0.0)
    has_audio = any(s.get("codec_type") == "audio" for s in data.get("streams", []))
    has_video = any(s.get("codec_type") == "video" for s in data.get("streams", []))
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    return {
        "duration": duration,
        "has_audio": has_audio,
        "has_video": has_video,
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
    }


def parse_silences(path: Path) -> list[tuple[float, float]]:
    """Parse ffmpeg silencedetect output into (start, end) pairs."""
    gaps: list[tuple[float, float]] = []
    start: float | None = None
    if not path.exists():
        return gaps
    for line in path.read_text(errors="ignore").splitlines():
        m = re.search(r"silence_start:\s*(-?\d+\.?\d*)", line)
        if m:
            start = float(m.group(1))
        m = re.search(r"silence_end:\s*(-?\d+\.?\d*)", line)
        if m and start is not None:
            end = float(m.group(1))
            if end - start >= SNAP_MIN_SILENCE:
                gaps.append((start, end))
            start = None
    return gaps


def snap(t: float, gaps: list[tuple[float, float]], prefer: str) -> float:
    """Snap a timestamp to the nearest silence gap midpoint within the limit.

    `prefer` biases which edge of a range matters: for a clip START we would
    rather begin slightly late than include dead air, and for a clip END we
    would rather finish slightly early.
    """
    best = t
    best_dist = SNAP_MAX_SHIFT
    for g_start, g_end in gaps:
        mid = (g_start + g_end) / 2
        dist = abs(mid - t)
        if dist > best_dist:
            continue
        if prefer == "start" and mid < t:
            continue
        if prefer == "end" and mid > t:
            continue
        best, best_dist = mid, dist
    return best


def clamp_length(start: float, end: float, source_duration: float) -> tuple[float, float]:
    """Keep clips inside sane bounds and inside the source media."""
    start = max(0.0, start)
    end = min(source_duration, end)
    length = end - start

    if length < MIN_CLIP_SECONDS:
        # Grow forward first, then backward, so a short moment still becomes a
        # usable clip without starting before the video does.
        grow = MIN_CLIP_SECONDS - length
        end = min(source_duration, end + grow)
        if end - start < MIN_CLIP_SECONDS:
            start = max(0.0, end - MIN_CLIP_SECONDS)
        length = end - start

    if length > MAX_CLIP_SECONDS:
        end = start + MAX_CLIP_SECONDS

    return round(start, 3), round(end, 3)


# ---------------------------------------------------------------------------
# Caption handling
# ---------------------------------------------------------------------------
def captions_for_window(
    captions: list[dict], start: float, end: float
) -> list[dict]:
    """Extract the words inside a clip window, re-zeroed to the clip start.

    The renderer groups words into caption pages itself, so leading spaces are
    irrelevant here — but the text is kept verbatim so any punctuation and
    casing survives.
    """
    start_ms = int(start * 1000)
    end_ms = int(end * 1000)
    out: list[dict] = []
    for c in captions:
        c_start = c.get("startMs")
        if c_start is None:
            continue
        # Include a word that is still being spoken at the cut point, but clamp
        # it to zero: negative timestamps made the renderer schedule a caption
        # page at a negative frame.
        c_end = c.get("endMs", c_start + 200)
        if c_end <= start_ms or c_start >= end_ms:
            continue
        text = (c.get("text") or "").strip()
        if not text:
            continue
        out.append({
            "text": text,
            "startMs": max(0, int(c_start - start_ms)),
            "endMs": max(80, int(min(c_end, end_ms) - start_ms)),
            "timestampMs": None,
            "confidence": None,
        })
    return out


# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------
def preset_for(height: int) -> str:
    """Faster x264 preset for small sources, slower for larger ones.

    Encoding is the dominant cost here; `veryfast` on a 1080p source is the
    sweet spot between wall-clock time and file size on a 4-vCPU runner.
    """
    return "veryfast" if height >= 1080 else "fast"


@dataclass
class ClipResult:
    index: int
    path: str
    duration: float
    has_audio: bool
    caption_words: int
    warnings: list[str] = field(default_factory=list)


def build_clip(
    index: int,
    source: Path,
    outdir: Path,
    start: float,
    end: float,
    captions: list[dict],
    *,
    do_reframe: bool,
    do_enhance: bool,
    src_height: int,
) -> ClipResult:
    warnings: list[str] = []
    cut = outdir / f"clip_{index:03d}_cut.mp4"
    vertical = outdir / f"clip_{index:03d}.mp4"

    # ── 1. Precise cut ────────────────────────────────────────────────────
    # -ss/-t AFTER -i is frame-accurate at the cost of a slow seek; for short
    # clips that is the right trade because a keyframe-accurate cut can be
    # seconds off and would desync every caption.
    cut_cmd = [
        "ffmpeg", "-i", str(source),
        "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}",
        "-c:v", "libx264", "-preset", preset_for(src_height), "-crf", "18",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-avoid_negative_ts", "make_zero",
        str(cut), "-y", "-loglevel", "error",
    ]
    resp = run(cut_cmd)
    if resp.returncode != 0 or not cut.exists():
        raise RuntimeError(f"cut failed: {resp.stderr[:400]}")

    current = cut

    # ── 2. Reframe to vertical (face-aware) ───────────────────────────────
    if do_reframe:
        resp = run([
            sys.executable, str(PIPELINE_DIR / "smart_reframe.py"),
            "--input", str(current), "--output", str(vertical),
            "--width", "1080", "--height", "1920", "--mode", "auto",
        ])
        last = (resp.stdout or "").strip().splitlines()
        marker = next((l for l in reversed(last) if l.startswith("REFRAME_")), "")
        if resp.returncode == 0 and vertical.exists():
            if marker.startswith("REFRAME_WARN"):
                warnings.append(marker)
            current.unlink(missing_ok=True)
            current = vertical
        else:
            # Reframing is an enhancement: fall back to the cut rather than
            # failing the clip, but say so loudly.
            print(f"  ! reframe failed for clip {index} (rc={resp.returncode}): "
                  f"{(resp.stderr or '')[:200]}")
            warnings.append("reframe_failed")

    # ── 3. Loudness normalisation ─────────────────────────────────────────
    if do_enhance:
        enhanced = outdir / f"clip_{index:03d}_enh.mp4"
        resp = run([
            sys.executable, str(PIPELINE_DIR / "enhance_audio.py"),
            "--input", str(current), "--output", str(enhanced),
            # Loudness normalisation is the last audio stage, so it runs once on
            # the final cut. --video-copy keeps the picture generation-free.
            "--target-lufs", "-14", "--true-peak", "-1.0", "--video-copy",
        ])
        if resp.returncode == 0 and enhanced.exists():
            current.unlink(missing_ok=True)
            current = enhanced
        else:
            print(f"  ! audio enhance failed for clip {index}: {(resp.stderr or '')[:200]}")
            warnings.append("enhance_failed")

    if current != vertical:
        current.replace(vertical)
        current = vertical

    # ── 4. Captions re-zeroed to the real cut ─────────────────────────────
    window = captions_for_window(captions, start, end)
    (outdir / f"clip_{index:03d}.captions.json").write_text(json.dumps(window))

    # ── 5. Verify what we actually produced ───────────────────────────────
    info = probe(vertical)
    if info["duration"] <= 0 or not info["has_video"]:
        raise RuntimeError("produced clip has no decodable video stream")
    if not window:
        warnings.append("no_captions")

    return ClipResult(
        index=index,
        path=str(vertical),
        duration=info["duration"],
        has_audio=info["has_audio"],
        caption_words=len(window),
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--moments", required=True)
    ap.add_argument("--captions", required=True)
    ap.add_argument("--silences", default="")
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--no-reframe", action="store_true")
    ap.add_argument("--no-enhance", action="store_true")
    args = ap.parse_args()

    source = Path(args.source)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    src = probe(source)
    print(f"source: {src['width']}x{src['height']} {src['duration']:.1f}s audio={src['has_audio']}")

    moments = json.loads(Path(args.moments).read_text())
    if isinstance(moments, dict):
        moments = moments.get("clips", [])
    captions = json.loads(Path(args.captions).read_text())
    gaps = parse_silences(Path(args.silences)) if args.silences else []
    print(f"moments={len(moments)} caption_words={len(captions)} silence_gaps={len(gaps)}")

    results: list[ClipResult] = []
    for i, m in enumerate(moments):
        try:
            raw_start = float(m.get("start_time", 0))
            raw_end = float(m.get("end_time", 0))
        except (TypeError, ValueError):
            print(f"[{i}] skipped: non-numeric boundaries")
            continue

        start = snap(raw_start, gaps, "start")
        end = snap(raw_end, gaps, "end")
        start, end = clamp_length(start, end, src["duration"])

        if end - start < 5:
            print(f"[{i}] skipped: window too small ({end - start:.1f}s)")
            continue

        try:
            res = build_clip(
                i, source, outdir, start, end, captions,
                do_reframe=not args.no_reframe,
                do_enhance=not args.no_enhance,
                src_height=src["height"],
            )
            results.append(res)
            snapped = "" if (start == raw_start and end == raw_end) else (
                f" (snapped from {raw_start:.1f}-{raw_end:.1f})")
            print(f"[{i}] OK {start:.2f}s→{end:.2f}s  {res.duration:.1f}s  "
                  f"{res.caption_words} words  audio={res.has_audio}{snapped}"
                  + (f"  warns={res.warnings}" if res.warnings else ""))
        except Exception as exc:  # keep going: one bad moment must not kill the job
            print(f"[{i}] FAILED: {exc}")

    manifest = [
        {
            "index": r.index,
            "file": os.path.basename(r.path),
            "duration": round(r.duration, 3),
            "has_audio": r.has_audio,
            "caption_words": r.caption_words,
            "warnings": r.warnings,
        }
        for r in results
    ]
    (outdir / "clips_manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"PREPARE_OK clips={len(manifest)}")

    if not manifest:
        print("FATAL: no clips could be prepared", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
