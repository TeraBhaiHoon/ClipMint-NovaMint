"""Audio-energy statistics for transcript windows.

The pipeline already dumps per-second RMS levels (ffmpeg astats) to
workspace/audio/energy.txt during "Analyse audio energy". Previously that
signal only boosted viral scores numerically; this module turns it into a
compact, human-readable summary the LLM can reason over when picking a clip's
mood ("loud with frequent spikes" vs "steady and quiet").

energy.txt lines look like:
    frame:120   pts:120     pts_time:12
    lavfi.astats.Overall.RMS_level=-27.3
"""

from __future__ import annotations

import re
from pathlib import Path

_POINT_RE = re.compile(r"pts_time:(-?\d+(?:\.\d+)?)")
_RMS_RE = re.compile(r"RMS_level=(-?\d+(?:\.\d+)?|-?inf)")


def load_series(path: str | Path) -> list[tuple[float, float]]:
    """(time_seconds, rms_db) pairs; skips unparsable/inf lines."""
    series: list[tuple[float, float]] = []
    t = 0.0
    try:
        for line in Path(path).read_text(errors="replace").splitlines():
            m = _POINT_RE.search(line)
            if m:
                t = float(m.group(1))
                continue
            m = _RMS_RE.search(line)
            if m and m.group(1) not in ("-inf", "inf"):
                series.append((t, float(m.group(1))))
    except OSError:
        return []
    return series


def window_stats(series: list[tuple[float, float]], start: float, end: float) -> dict | None:
    """RMS stats for [start, end] seconds. None when no samples fall inside."""
    vals = [db for t, db in series if start <= t <= end]
    if not vals:
        return None
    vals.sort()
    n = len(vals)
    return {
        "avg_db": sum(vals) / n,
        "peak_db": max(vals),
        "quiet_db": vals[0],
        "samples": n,
    }


def summarise(stats: dict | None) -> str:
    """One-line, LLM-readable energy description."""
    if not stats:
        return "audio energy in this section: no data"
    avg, peak = stats["avg_db"], stats["peak_db"]
    if avg > -16:
        feel = "very loud / high energy"
    elif avg > -22:
        feel = "lively"
    elif avg > -30:
        feel = "moderate, conversational"
    else:
        feel = "quiet / subdued"
    spikes = "with loud peaks" if peak > (avg + 8) else "steady, few peaks"
    return (
        f"audio energy in this section: {feel} {spikes} "
        f"(avg {avg:.1f} dB RMS, loudest {peak:.1f} dB, {stats['samples']} samples)"
    )


def window_summary(path: str | Path, start: float, end: float) -> str:
    """Convenience: load + window + summarise in one call."""
    return summarise(window_stats(load_series(path), start, end))
