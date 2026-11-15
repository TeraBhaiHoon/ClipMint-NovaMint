import json

from transliterate import romanise


def captions(*words):
    return [{"text": word, "startMs": index * 1000, "endMs": (index + 1) * 1000} for index, word in enumerate(words)]


def test_latin_only_does_not_call_provider():
    words = captions("Hello", "world")
    result = romanise(words, lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("no request needed")))
    assert result["unique_words"] == 0


def test_repeated_hindi_words_share_one_conversion_and_keep_timings():
    words = captions("है", "Podcast", "है", "नमस्ते")
    calls = []
    def ask(prompt, **options):
        calls.append(options)
        assert options["order"] == "groq,nim"
        assert options["max_attempts"] == 1
        assert options["timeout_s"] <= 30
        assert options["budget_s"] <= 45
        return json.dumps({"words": ["hai", "namaste"]})
    result = romanise(words, ask)
    assert [word["text"] for word in words] == ["hai", "Podcast", "hai", "namaste"]
    assert words[2]["startMs"] == 2000
    assert len(calls) == 1
    assert result["converted_words"] == 3


def test_full_outage_does_not_retry_every_remaining_batch():
    words = captions("है", "नमस्ते", "नहीं")
    calls = []
    def ask(*args, **kwargs):
        calls.append(True)
        raise RuntimeError("providers unavailable")
    result = romanise(words, ask, batch_size=1)
    assert len(calls) == 1
    assert result["remaining_devanagari"] == 3
    assert words[0]["text"] == "है"


def test_malformed_short_empty_or_original_script_reply_preserves_original_words():
    for reply in ["not JSON", '{"words": []}', '{"words": [""]}', '{"words": [null]}', json.dumps({"words": ["है"]})]:
        words = captions("है")
        result = romanise(words, lambda *args, **kwargs: reply)
        assert words[0]["text"] == "है"
        assert result["failed_batches"] == 1


def test_budget_stops_subsequent_batches():
    times = iter([0, 0, 181])
    words = captions("है", "नहीं")
    calls = []
    def ask(*args, **kwargs):
        calls.append(True)
        return '{"words": ["hai"]}'
    result = romanise(words, ask, batch_size=1, clock=lambda: next(times))
    assert len(calls) == 1
    assert result["remaining_devanagari"] == 1
