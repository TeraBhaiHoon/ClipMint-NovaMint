"""Heuristic last-resort moment selection (no LLM).

Used ONLY when the discovery/ranking chain produced no usable moment — an
empty completion or malformed JSON on every retry — while the video plainly
has speech. Picks the densest speech spans so a transient provider hiccup
degrades clip SELECTION instead of failing the whole job. The caption
validator downstream still gets the final say, so a fallback clip that would
render virtually captionless is dropped exactly like an LLM one.

Deliberately tiny and dependency-free.
"""


def fallback_moments(
    captions: list[dict],
    duration: float,
    max_clips: int,
    target_seconds: float = 25.0,
    min_seconds: float = 12.0,
) -> list[dict]:
    """Speech-dense spans as moment dicts shaped like the LLM's output.

    Short (25s) windows on purpose: word coverage is what passes the caption
    gate, and a sparse source can only clear it around its densest speech.
    """
    words = []
    for c in captions:
        try:
            start = float(c["startMs"]) / 1000.0
            end = float(c["endMs"]) / 1000.0
        except (KeyError, TypeError, ValueError):
            continue
        if end > start:
            words.append((start, end, str(c.get("text", ""))))
    if not words:
        return []

    end_limit = duration if duration and duration > 0 else words[-1][1] + 5.0
    stride = max(5.0, target_seconds / 2.0)

    candidates = []
    t = 0.0
    while t + min_seconds <= end_limit:
        e = min(t + target_seconds, end_limit)
        in_window = [(ws, we, tx) for ws, we, tx in words if t <= ws < e]
        # Roughly the caption validator's bar (~30% coverage); a span with less
        # speech would be dropped later anyway.
        if in_window and len(in_window) >= max(6, int((e - t) * 0.4)):
            candidates.append({
                "start_time": t,
                "end_time": e,
                "density": len(in_window) / max(1.0, e - t),
                "text": " ".join(tx for _, _, tx in in_window),
            })
        t += stride

    candidates.sort(key=lambda c: c["density"], reverse=True)

    chosen: list[dict] = []
    for c in candidates:
        if any(
            min(c["end_time"], k["end_time"]) - max(c["start_time"], k["start_time"]) > 5
            for k in chosen
        ):
            continue
        chosen.append({
            "start_time": c["start_time"],
            "end_time": c["end_time"],
            "viral_score": 50.0,
            "title": c["text"][:60] or f"Clip {len(chosen) + 1}",
            "description": "",
            "hashtags": [],
            "hook": "",
            "duration_reason": "heuristic fallback — LLM ranking unavailable",
            "mood": "energetic",
        })
        if len(chosen) >= max_clips:
            break
    return chosen
