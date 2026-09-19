"""Auto-editor: transcript-gap silence removal for the full-video captions mode.

Talking-head footage is full of dead air. This module builds "kept" segments
from the gaps BETWEEN words (not from audio energy, so music beds do not get
chopped), cuts the source in a single ffmpeg pass, and remaps the caption
word timestamps onto the shortened timeline so captions stay frame-accurate.

Word dicts are the canonical pipeline shape: {text, startMs, endMs, ...}.

Design rules:
  * gaps SHORTER than MIN_GAP_MS are natural pauses — keep them;
  * every cut keeps EDGE_PAD_MS of breathing room on both sides;
  * speech runs closer together than MIN_SEGMENT_MS are merged, so the edit
    never produces micro-cuts;
  * a word whose midpoint falls inside a removed gap is dropped.
"""

from __future__ import annotations

import bisect
import json
import subprocess
import sys
from pathlib import Path

MIN_GAP_MS = 450       # inter-word silence under this is a natural pause
EDGE_PAD_MS = 120      # breathing room kept on both sides of every speech run
MIN_SEGMENT_MS = 900   # speech runs closer than this are merged (no micro-cuts)
MIN_SEG_LEN_MS = 250   # a kept segment shorter than this is dropped entirely
MAX_SEGMENTS = 400     # pathological cut lists fall back to "no cut" upstream


def build_segments(
    words: list[dict], duration_ms: int
) -> tuple[list[tuple[int, int]], int]:
    """Word list → kept [start, end] ms segments + total removed ms.

    Returns ([], 0) when the words cannot support a cut plan.
    """
    spans: list[tuple[int, int]] = []
    for w in words:
        s, e = w.get("startMs"), w.get("endMs")
        if s is None or e is None or e <= s:
            continue
        spans.append((int(s), int(e)))
    if not spans:
        return [], 0
    spans.sort()

    # Merge words into speech runs: a gap >= MIN_GAP_MS starts a new run.
    runs: list[list[int]] = [[spans[0][0], spans[0][1]]]
    for s, e in spans[1:]:
        if s - runs[-1][1] < MIN_GAP_MS:
            runs[-1][1] = max(runs[-1][1], e)
        else:
            runs.append([s, e])

    # Pad each run, clamp to the media, then merge runs that ended up close.
    padded: list[list[int]] = [
        [max(0, s - EDGE_PAD_MS), min(duration_ms, e + EDGE_PAD_MS)]
        for s, e in runs
    ]
    merged: list[list[int]] = [padded[0]]
    for s, e in padded[1:]:
        if s - merged[-1][1] < MIN_SEGMENT_MS:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])

    segments = [(s, e) for s, e in merged if e - s >= MIN_SEG_LEN_MS]
    if not segments:
        return [], 0
    removed = duration_ms - sum(e - s for s, e in segments)
    return segments, max(0, removed)


def remap_words(words: list[dict], segments: list[tuple[int, int]]) -> list[dict]:
    """Shift word timestamps onto the cut timeline.

    A word is kept when its midpoint lands inside a kept segment; anything
    inside a removed gap is dropped. Word order is preserved.
    """
    if not segments:
        return list(words)
    starts = [s for s, _ in segments]
    offsets: list[tuple[int, int]] = []  # (output position of segment start, len)
    pos = 0
    for s, e in segments:
        offsets.append((pos, e - s))
        pos += e - s

    out: list[dict] = []
    for w in words:
        s, e = w.get("startMs"), w.get("endMs")
        if s is None or e is None:
            continue
        mid = (int(s) + int(e)) // 2
        i = bisect.bisect_right(starts, mid) - 1
        if i < 0:
            continue
        seg_start, seg_end = segments[i]
        if mid >= seg_end:
            continue  # midpoint fell inside a removed gap
        base, _len = offsets[i]
        out.append({
            **w,
            "startMs": max(0, int(s) - seg_start + base),
            "endMs": max(80, int(e) - seg_start + base),
        })
    return out


def apply_cuts(
    src: str, segments_s: list[tuple[float, float]], dst: str,
    has_audio: bool = True,
) -> None:
    """Cut+concat the kept segments in ONE ffmpeg pass (video and audio).

    A single trim/concat filter graph avoids concat-demuxer timestamp drift
    and re-encodes once (veryfast) so the output stays in sync. Sources with
    no audio stream are cut video-only (has_audio=False).
    """
    audio_tail = "-c:a", "aac", "-b:a", "192k"
    if len(segments_s) > MAX_SEGMENTS:
        raise ValueError(f"{len(segments_s)} segments exceeds the {MAX_SEGMENTS} cap")
    if len(segments_s) == 1:
        s, e = segments_s[0]
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", f"{s:.3f}", "-to", f"{e:.3f}", "-i", src,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        ]
        cmd += audio_tail if has_audio else ["-an"]
        cmd.append(dst)
    else:
        v, a, vl, al = [], [], [], []
        for i, (s, e) in enumerate(segments_s):
            v.append(f"[0:v]trim=start={s:.3f}:end={e:.3f},setpts=PTS-STARTPTS[v{i}]")
            # The video inputs exist whether or not audio does; appending them
            # only under `has_audio` left the video-only concat with 0 inputs
            # (n=N but nothing wired in) so audio-less sources failed to cut.
            vl.append(f"[v{i}]")
            if has_audio:
                a.append(f"[0:a]atrim=start={s:.3f}:end={e:.3f},asetpts=PTS-STARTPTS[a{i}]")
                al.append(f"[a{i}]")
        graph = ";".join(v + a) + ";"
        if has_audio:
            graph += (
                "".join(vl) + f"concat=n={len(segments_s)}:v=1:a=0[vout];"
                + "".join(al) + f"concat=n={len(segments_s)}:v=0:a=1[aout]"
            )
            maps = ["-map", "[vout]", "-map", "[aout]"]
        else:
            graph += "".join(vl) + f"concat=n={len(segments_s)}:v=1:a=0[vout]"
            maps = ["-map", "[vout]"]
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", src,
               "-filter_complex", graph, *maps,
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "20"]
        cmd += audio_tail if has_audio else ["-an"]
        cmd.append(dst)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg cut failed: {proc.stderr[-500:]}")


def _probe_duration_s(path: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "csv=p=0", path],
        capture_output=True, text=True,
    ).stdout.strip()
    try:
        return float(out or 0)
    except ValueError:
        return 0.0


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--words", required=True, help="full_captions.json (word list)")
    ap.add_argument("--out-video", required=True)
    ap.add_argument("--out-words", required=True)
    args = ap.parse_args()

    words = json.loads(Path(args.words).read_text())
    if not isinstance(words, list) or not words:
        print("FATAL: no words to build a cut plan from", file=sys.stderr)
        return 1

    duration_ms = int(_probe_duration_s(args.source) * 1000)
    if duration_ms <= 0:
        print("FATAL: source duration is zero", file=sys.stderr)
        return 1

    segments, removed_ms = build_segments(words, duration_ms)
    if not segments or removed_ms < 500:
        print(f"AUTOEDIT_SKIP removed_ms={removed_ms} segments={len(segments)}")
        # Identity plan: keep everything so callers can still proceed.
        segments = [(0, duration_ms)]
        removed_ms = 0
    else:
        apply_cuts(
            args.source, [(s / 1000, e / 1000) for s, e in segments], args.out_video
        )

    shifted = remap_words(words, segments)
    if not shifted:
        print("FATAL: every word fell inside a removed gap", file=sys.stderr)
        return 1
    Path(args.out_words).write_text(json.dumps(shifted))

    out_dur = (segments[-1][1] - segments[0][0]) / 1000 if len(segments) == 1 else \
        sum(e - s for s, e in segments) / 1000
    print(
        f"AUTOEDIT_OK segments={len(segments)} removed={removed_ms / 1000:.1f}s "
        f"({100 * removed_ms / duration_ms:.0f}% shorter) words={len(shifted)} "
        f"out_duration={out_dur:.1f}s"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
