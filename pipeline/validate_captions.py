#!/usr/bin/env python3
"""
ClipMint pipeline — caption quality gate.

Runs against a clip's re-zeroed caption words BEFORE the clip is queued for a
Remotion render. A clip whose captions are structurally broken produces a
video that is unusable or embarrassing (negative timestamps schedule caption
pages before frame 0; overlapping words stack on top of each other; a clip
with almost no speech coverage ships as dead air). Failing it here saves the
whole render, not just the upload.

Checks (each failure names the defect and, where relevant, the word index):
  1. captions present and non-empty
  2. no negative startMs
  3. every word has a positive duration (endMs > startMs)
  4. consecutive words do not overlap by more than MAX_OVERLAP_MS — stacked
     same-page words are the visible symptom of a provider timing bug
  5. total word coverage is at least MIN_COVERAGE of the clip duration

CLI (used by unit tests and for one-off debugging):
    python3 pipeline/validate_captions.py clip.captions.json --duration 30
Exits 0 when valid, 1 with the defect list when not.
"""

from __future__ import annotations

import argparse
import json
import sys

MAX_OVERLAP_MS = 50
MIN_COVERAGE = 0.30
# After clamping, a word may keep this small tail past the next word's start,
# so adjacent words stay visually contiguous instead of getting gaps.
REPAIR_TAIL_MS = 50


def repair_overlaps(captions: list[dict]) -> tuple[list[dict], int]:
    """Clamp adjacent-word end→start overlaps instead of rejecting the clip.

    Whisper (and every ASR) routinely emits overlapping timestamps on fast
    speech — especially Hindi/Hinglish. That is timing jitter, not broken
    data: captions render as stacked pages, so a 180–900ms overlap between
    consecutive words is invisible on screen. Rejecting whole clips for it
    threw away perfectly good moments (prod incident: a score-100 clip died
    over three overlapping word boundaries).

    Clamps each word's end to the next word's start + a small tail, keeping
    every word's duration positive. Returns (captions, repaired_count).
    """
    ordered = sorted(
        (c for c in captions
         if isinstance(c.get("startMs"), (int, float)) and isinstance(c.get("endMs"), (int, float))),
        key=lambda c: c["startMs"],
    )
    repaired = 0
    for prev, cur in zip(ordered, ordered[1:]):
        prev_end, cur_start = prev["endMs"], cur["startMs"]
        overlap = prev_end - cur_start
        if overlap <= MAX_OVERLAP_MS:
            continue
        prev_start = prev.get("startMs", 0)
        new_end = int(cur_start + REPAIR_TAIL_MS)
        if new_end > prev_start:
            prev["endMs"] = new_end
        else:
            # Degenerate: word starts after the next one — keep it a short word.
            prev["endMs"] = int(prev_start + 80)
        repaired += 1
    return captions, repaired


def validate_captions(captions: list[dict], duration_sec: float) -> tuple[bool, list[str]]:
    """Validate one clip's captions against its duration.

    Returns (ok, defects). `defects` is empty when ok is True.
    """
    defects: list[str] = []

    if not captions:
        return False, ["captions_empty"]

    for i, c in enumerate(captions):
        start = c.get("startMs")
        end = c.get("endMs")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            defects.append(f"word[{i}]: missing or non-numeric timing")
            continue
        if start < 0:
            defects.append(f"word[{i}]: negative startMs ({start})")
        if end - start <= 0:
            defects.append(f"word[{i}]: non-positive duration ({start}→{end})")

    ordered = sorted(
        (c for c in captions
         if isinstance(c.get("startMs"), (int, float)) and isinstance(c.get("endMs"), (int, float))),
        key=lambda c: c["startMs"],
    )
    for prev, cur in zip(ordered, ordered[1:]):
        overlap = prev["endMs"] - cur["startMs"]
        if overlap > MAX_OVERLAP_MS:
            defects.append(
                f"word overlap >{MAX_OVERLAP_MS}ms ({overlap}ms): "
                f"{prev.get('text', '')!r} into {cur.get('text', '')!r}"
            )

    if duration_sec > 0:
        covered_ms = sum(
            max(0, c["endMs"] - c["startMs"])
            for c in ordered
        )
        coverage = covered_ms / (duration_sec * 1000.0)
        if coverage < MIN_COVERAGE:
            defects.append(
                f"word coverage {coverage:.0%} below minimum {MIN_COVERAGE:.0%} "
                f"of clip duration"
            )

    return (not defects), defects


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description="Validate one clip's captions JSON")
    ap.add_argument("captions_json", help="path to clip_XXX.captions.json")
    ap.add_argument("--duration", type=float, required=True,
                    help="clip duration in seconds")
    args = ap.parse_args()

    with open(args.captions_json) as fh:
        captions = json.load(fh)

    ok, defects = validate_captions(captions, args.duration)
    if ok:
        print(f"CAPTIONS_OK words={len(captions)} duration={args.duration:.2f}s")
        return 0
    print("CAPTIONS_INVALID:")
    for d in defects:
        print(f"  - {d}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
