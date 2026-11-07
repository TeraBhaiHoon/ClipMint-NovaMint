"""Heuristic moment fallback + its interplay with the caption gate."""
from conftest import dense_words
from fallback_moments import fallback_moments
from prepare_clips import captions_for_window
from validate_captions import repair_overlaps, validate_captions


def _gate_ok(caps, m):
    win, _ = repair_overlaps(captions_for_window(caps, m["start_time"], m["end_time"]))
    return validate_captions(win, m["end_time"] - m["start_time"])[0]


def test_no_speech_yields_no_moments():
    assert fallback_moments([], 180.0, 3) == []


def test_sparse_video_moments_land_on_speech_and_pass_the_gate():
    # Sintel-like profile: music-only opening, dialogue only at 97-145s.
    caps = dense_words(97.0, 145.0, step_s=0.7, dur_s=0.35)
    moments = fallback_moments(caps, 180.0, 3)
    assert moments, "a video with speech must produce at least one moment"
    for m in moments:
        assert 90.0 <= m["start_time"] < m["end_time"] <= 180.0
        assert _gate_ok(caps, m), m
    # a music-region window would fail the same gate
    assert not _gate_ok(caps, {"start_time": 10.0, "end_time": 40.0})


def test_moments_respect_max_clips_and_do_not_overlap():
    caps = dense_words(0.0, 600.0)
    moments = fallback_moments(caps, 600.0, 4)
    assert len(moments) == 4
    for i, a in enumerate(moments):
        for b in moments[i + 1:]:
            overlap = min(a["end_time"], b["end_time"]) - max(a["start_time"], b["start_time"])
            assert overlap <= 5


def test_moments_have_the_llm_output_shape():
    caps = dense_words(0.0, 120.0)
    m = fallback_moments(caps, 120.0, 1)[0]
    for key in ("start_time", "end_time", "viral_score", "title", "mood", "hashtags"):
        assert key in m
