"""prepare_clips helpers: boundary snapping, length clamping, caption windows."""
from conftest import words
from prepare_clips import (
    MAX_CLIP_SECONDS,
    MIN_CLIP_SECONDS,
    SNAP_MAX_SHIFT,
    captions_for_window,
    clamp_length,
    parse_silences,
    preset_for,
    snap,
)


# ── snap ─────────────────────────────────────────────────────────────────
def test_start_snaps_forward_into_a_nearby_silence():
    # gap midpoint 11.0 is 1s after the start — a clip should begin there.
    assert snap(10.0, [(10.8, 11.2)], "start") == 11.0


def test_start_never_snaps_backwards():
    assert snap(10.0, [(8.8, 9.2)], "start") == 10.0


def test_end_snaps_backward_and_never_forward():
    assert snap(40.0, [(38.8, 39.2)], "end") == 39.0
    assert snap(40.0, [(40.8, 41.2)], "end") == 40.0


def test_snap_ignores_gaps_beyond_the_shift_limit():
    far = 10.0 + SNAP_MAX_SHIFT + 1.0
    assert snap(10.0, [(far - 0.1, far + 0.1)], "start") == 10.0


# ── clamp_length ─────────────────────────────────────────────────────────
def test_short_clip_grows_forward_to_the_minimum():
    s, e = clamp_length(20.0, 23.0, 600.0)
    assert (s, e) == (20.0, 20.0 + MIN_CLIP_SECONDS)


def test_short_clip_at_the_end_grows_backward():
    s, e = clamp_length(596.0, 600.0, 600.0)
    assert e == 600.0 and e - s == MIN_CLIP_SECONDS


def test_long_clip_is_capped():
    s, e = clamp_length(0.0, 500.0, 600.0)
    assert e - s == MAX_CLIP_SECONDS


def test_window_is_kept_inside_the_media():
    s, e = clamp_length(-5.0, 30.0, 25.0)
    assert s >= 0.0 and e <= 25.0


# ── captions_for_window ──────────────────────────────────────────────────
def test_window_rezeroes_and_clamps_words():
    caps = words([(9.8, 10.3, "edge"), (12.0, 12.4, "inside"),
                  (40.0, 40.5, "after"), (13.0, 13.2, "  ")])
    win = captions_for_window(caps, 10.0, 20.0)
    assert [w["text"] for w in win] == ["edge", "inside"]
    # a word straddling the cut point is clamped to 0, never negative
    assert win[0]["startMs"] == 0
    assert win[1]["startMs"] == 2000
    assert all(w["endMs"] >= 80 for w in win)


# ── parse_silences ───────────────────────────────────────────────────────
def test_parse_silences_keeps_only_real_gaps(tmp_path):
    log = tmp_path / "silences.txt"
    log.write_text(
        "[silencedetect @ 0x1] silence_start: 5.0\n"
        "[silencedetect @ 0x1] silence_end: 5.9 | silence_duration: 0.9\n"
        "[silencedetect @ 0x1] silence_start: 8.00\n"
        "[silencedetect @ 0x1] silence_end: 8.05 | silence_duration: 0.05\n"
    )
    assert parse_silences(log) == [(5.0, 5.9)]
    assert parse_silences(tmp_path / "missing.txt") == []


def test_preset_tracks_source_height():
    assert preset_for(1080) == "veryfast"
    assert preset_for(720) == "fast"
