"""auto_edit: word-gap jump-cut planning and timestamp remapping."""
from auto_edit import EDGE_PAD_MS, build_segments, remap_words
from conftest import words


def test_no_words_means_no_cut_plan():
    assert build_segments([], 10_000) == ([], 0)


def test_long_gap_splits_into_two_padded_segments():
    caps = words([(0.5, 1.0, "a"), (1.1, 1.6, "b"),      # run 1: 0.5-1.6s
                  (5.0, 5.5, "c"), (5.6, 6.0, "d")])     # run 2: 5.0-6.0s
    segs, removed = build_segments(caps, 8_000)
    assert len(segs) == 2
    assert segs[0] == (500 - EDGE_PAD_MS, 1600 + EDGE_PAD_MS)
    assert segs[1] == (5000 - EDGE_PAD_MS, 6000 + EDGE_PAD_MS)
    assert removed == 8_000 - sum(e - s for s, e in segs)


def test_natural_pauses_are_not_cut():
    # 300ms gaps are under MIN_GAP_MS: one continuous run, one segment.
    caps = words([(0.0, 0.5, "a"), (0.8, 1.3, "b"), (1.6, 2.1, "c")])
    segs, _ = build_segments(caps, 3_000)
    assert len(segs) == 1


def test_remap_shifts_later_words_and_drops_words_in_cut_gaps():
    segs = [(0, 2_000), (5_000, 7_000)]           # 3s of silence removed
    caps = words([(0.5, 0.9, "kept"), (3.0, 3.4, "gone"), (5.5, 6.0, "shifted")])
    out = remap_words(caps, segs)
    assert [w["text"] for w in out] == ["kept", "shifted"]
    assert out[0]["startMs"] == 500
    # 5.5s on the source timeline lands at 2.0 + 0.5 = 2.5s after the cut
    assert out[1]["startMs"] == 2_500
    assert out[1]["endMs"] == 3_000


def test_remap_without_segments_is_identity():
    caps = words([(1.0, 1.2, "x")])
    assert remap_words(caps, []) == caps
