"""Caption quality gate — the rule both the viral step and prepare enforce."""
import copy

from conftest import dense_words, words
from validate_captions import MIN_COVERAGE, repair_overlaps, validate_captions


def test_empty_captions_are_rejected():
    ok, defects = validate_captions([], 30)
    assert not ok and defects == ["captions_empty"]


def test_dense_speech_passes():
    ok, defects = validate_captions(dense_words(0, 30), 30)
    assert ok, defects


def test_negative_start_is_flagged():
    caps = dense_words(0, 30)
    caps[0]["startMs"] = -40
    ok, defects = validate_captions(caps, 30)
    assert not ok and any("negative startMs" in d for d in defects)


def test_zero_duration_word_is_flagged():
    caps = dense_words(0, 30)
    caps[3]["endMs"] = caps[3]["startMs"]
    ok, defects = validate_captions(caps, 30)
    assert not ok and any("non-positive duration" in d for d in defects)


def test_sparse_speech_fails_coverage():
    # ~10 words of 0.3s over 30s = 10% coverage, well under the 30% floor.
    caps = words([(i * 3.0, i * 3.0 + 0.3, f"w{i}") for i in range(10)])
    ok, defects = validate_captions(caps, 30)
    assert not ok
    assert any("coverage" in d for d in defects)
    assert MIN_COVERAGE == 0.30


def test_overlap_rejected_until_repaired():
    caps = words([(0.0, 1.5, "aur"), (0.6, 1.2, "uska"), (1.2, 2.0, "phone")])
    ok, defects = validate_captions(copy.deepcopy(caps), 2.0)
    assert not ok and any("overlap" in d for d in defects)

    repaired, n = repair_overlaps(caps)
    assert n >= 1
    ok, defects = validate_captions(repaired, 2.0)
    assert ok, defects
    assert all(c["endMs"] > c["startMs"] for c in repaired)
