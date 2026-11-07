"""Shared pytest setup: pipeline modules import by bare name, exactly as the
workflow runs them (`sys.path.insert(0, "pipeline")`)."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))


def words(spec):
    """Build caption words from (start_s, end_s, text) tuples."""
    return [
        {"text": t, "startMs": int(s * 1000), "endMs": int(e * 1000)}
        for s, e, t in spec
    ]


def dense_words(start_s, end_s, step_s=0.4, dur_s=0.3, prefix="w"):
    """Evenly spaced words: a speech run that easily clears the 30% coverage gate."""
    out, t, i = [], start_s, 0
    while t + dur_s <= end_s:
        out.append({"text": f"{prefix}{i}", "startMs": int(t * 1000),
                    "endMs": int((t + dur_s) * 1000)})
        t += step_s
        i += 1
    return out
