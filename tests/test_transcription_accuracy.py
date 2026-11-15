import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("measure_accuracy", ROOT / "scripts/measure_transcription_accuracy.py")
accuracy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(accuracy)


def test_hindi_marks_are_preserved_and_punctuation_is_normalized():
    assert accuracy.normalize("यह है।") == "यह है"
    assert accuracy.normalize("ज़रूरी") == "ज़रूरी"
    assert accuracy.normalize("Assume, नहीं!") == "assume नहीं"


def test_identical_hindi_text_has_zero_error():
    result = accuracy.measure("यह बात ज़रूरी है।", "यह बात ज़रूरी है")
    assert result["wer"] == 0
    assert result["cer"] == 0
    assert result["reference_words"] == 4


def test_known_substitution_deletion_and_insertion_counts():
    assert accuracy.edit_counts(["one", "two", "three"], ["one", "four", "three"])["substitutions"] == 1
    assert accuracy.edit_counts(["one", "two", "three"], ["one", "three"])["deletions"] == 1
    assert accuracy.edit_counts(["one", "two"], ["one", "extra", "two"])["insertions"] == 1
    assert accuracy.measure("one two three", "one four three")["wer"] == pytest.approx(1 / 3)


def test_error_rate_is_not_clamped_to_fake_accuracy_percentage():
    assert accuracy.measure("one", "two three four")["wer"] == 3


def test_empty_reference_refuses_a_score():
    with pytest.raises(ValueError, match="reference"):
        accuracy.measure("...", "recognized words")


def test_caption_hypothesis_reads_actual_words():
    assert accuracy.load_hypothesis([{"text": "नहीं"}, {"text": "है"}]) == "नहीं है"
    with pytest.raises(ValueError):
        accuracy.load_hypothesis([{"text": None}])
