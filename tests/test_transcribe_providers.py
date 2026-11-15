import json
from types import SimpleNamespace

import pytest
import requests

import transcribe_providers as providers


@pytest.fixture(autouse=True)
def keys(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-groq")
    monkeypatch.setenv("DEEPGRAM_API_KEY", "test-deepgram")
    monkeypatch.delenv("NVIDIA_NIM_API_KEY", raising=False)


def response(status, payload):
    return SimpleNamespace(status_code=status, text=json.dumps(payload), json=lambda: payload)


def test_groq_sends_supported_prompt_field_and_keeps_word_timestamps(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")
    calls = []

    def post(url, **kwargs):
        calls.append((url, kwargs))
        assert kwargs["data"]["prompt"]
        assert "initial_prompt" not in kwargs["data"]
        assert kwargs["data"]["timestamp_granularities[]"] == "word"
        assert kwargs["data"]["language"] == "hi"
        return response(200, {"language": "hindi", "words": [{"word": "hello", "start": 1, "end": 2}]})

    monkeypatch.setattr(providers.requests, "post", post)
    result = providers.transcribe(str(audio), 300, forced_language="hi")
    assert len(calls) == 1
    assert result["provider"] == "groq"
    assert result["language"] == "hi"
    assert result["words"][0]["startMs"] == 301000
    assert result["words"][0]["endMs"] == 302000


def test_multi_is_not_sent_as_groq_language(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")

    def post(url, **kwargs):
        assert "language" not in kwargs["data"]
        return response(200, {"language": "english", "words": [{"word": "test", "start": 0, "end": 1}]})

    monkeypatch.setattr(providers.requests, "post", post)
    assert providers.transcribe(str(audio), forced_language="multi")["provider"] == "groq"


def test_groq_hard_errors_move_on_without_backoff(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")
    sleeps = []
    calls = []

    def post(url, **kwargs):
        calls.append(url)
        if url == providers.GROQ_URL:
            return response(400, {"error": {"message": "bad request"}})
        return response(200, {"results": {"channels": [{"alternatives": [{"words": [{"word": "fallback", "start": 0, "end": 1}]}]}]}})

    monkeypatch.setattr(providers.requests, "post", post)
    monkeypatch.setattr(providers.time, "sleep", sleeps.append)
    assert providers.transcribe(str(audio))["provider"] == "deepgram"
    assert sleeps == []
    assert calls[-1] == providers.DEEPGRAM_URL


def test_empty_transcripts_do_not_count_as_success(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")
    monkeypatch.setattr(providers.requests, "post", lambda *args, **kwargs: response(200, {}))
    with pytest.raises(RuntimeError, match="all transcription providers failed"):
        providers.transcribe(str(audio))


# ---------------------------------------------------------------------------
# Language-field normalization (the "english"-vs-en / en-US / unknown-name bug)
# ---------------------------------------------------------------------------
def test_normalize_language_variants():
    assert providers.normalize_language("english") == "en"
    assert providers.normalize_language("Hindi") == "hi"
    assert providers.normalize_language("hinglish") == "hi"
    assert providers.normalize_language("en") == "en"
    assert providers.normalize_language("en-US") == "en"
    assert providers.normalize_language("hi_IN") == "hi"
    assert providers.normalize_language("bhojpuri") == providers.UNDETERMINED
    assert providers.normalize_language("multi") == providers.UNDETERMINED
    assert providers.normalize_language("") == providers.UNDETERMINED
    assert providers.normalize_language(None) == providers.UNDETERMINED


def test_groq_unknown_language_name_normalizes_to_und(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")

    def post(url, **kwargs):
        return response(200, {"language": "bhojpuri",
                              "words": [{"word": "x", "start": 0, "end": 1}]})

    monkeypatch.setattr(providers.requests, "post", post)
    assert providers.transcribe(str(audio))["language"] == providers.UNDETERMINED


def test_groq_missing_language_field_is_und_not_en(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")

    def post(url, **kwargs):
        return response(200, {"words": [{"word": "x", "start": 0, "end": 1}]})

    monkeypatch.setattr(providers.requests, "post", post)
    assert providers.transcribe(str(audio))["language"] == providers.UNDETERMINED


def test_forced_language_overrides_und(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")

    def post(url, **kwargs):
        return response(200, {"words": [{"word": "x", "start": 0, "end": 1}]})

    monkeypatch.setattr(providers.requests, "post", post)
    assert providers.transcribe(str(audio), forced_language="hi")["language"] == "hi"


def test_groq_prefers_whisper_large_v3_for_accuracy(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")
    models = []

    def post(url, **kwargs):
        models.append(kwargs["data"]["model"])
        return response(400, {"error": {"message": "hard error"}})

    monkeypatch.setattr(providers.requests, "post", post)
    try:
        providers.transcribe(str(audio))
    except RuntimeError:
        pass
    assert models[0] == "whisper-large-v3"


def test_groq_prompt_carries_bounded_metadata(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")
    prompts = []

    def post(url, **kwargs):
        prompts.append(kwargs["data"].get("prompt", ""))
        return response(200, {"language": "english",
                              "words": [{"word": "x", "start": 0, "end": 1}]})

    monkeypatch.setattr(providers.requests, "post", post)
    context = {"title": "T" * 500, "tags": [f"tag{i}" for i in range(30)]}
    providers.transcribe(str(audio), context=context)
    prompt = prompts[0]
    assert "Video title: " in prompt and "Topics: tag0" in prompt
    assert "tag20" not in prompt            # only the first 12 tags
    assert len(prompt) < 700                # bounded, never a second transcript


def test_deepgram_reports_its_detected_language(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")

    def post(url, **kwargs):
        return response(200, {"metadata": {"detected_language": "hi"},
                              "results": {"channels": [{"alternatives": [
                                  {"words": [{"word": "नमस्ते", "start": 0, "end": 1}]}]}]}})

    monkeypatch.setattr(providers.requests, "post", post)
    result = providers.transcribe(str(audio), prefer_hindi_first=True)
    assert result["provider"] == "deepgram"
    assert result["language"] == "hi"


def test_deepgram_without_detected_language_reports_multi(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")

    def post(url, **kwargs):
        return response(200, {"results": {"channels": [{"alternatives": [
            {"words": [{"word": "x", "start": 0, "end": 1}]}]}]}})

    monkeypatch.setattr(providers.requests, "post", post)
    assert providers.transcribe(str(audio), prefer_hindi_first=True)["language"] == "multi"


def test_deepgram_keyterms_include_creator_tags(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")
    captured = {}

    def post(url, **kwargs):
        captured["params"] = kwargs.get("params")
        return response(200, {"metadata": {"detected_language": "hi"},
                              "results": {"channels": [{"alternatives": [
                                  {"words": [{"word": "x", "start": 0, "end": 1}]}]}]}})

    monkeypatch.setattr(providers.requests, "post", post)
    providers.transcribe(str(audio), prefer_hindi_first=True,
                         context={"tags": ["cricket", "IPO"]})
    params = captured["params"]
    assert ("keyterm", "cricket") in params
    assert ("keyterm", "IPO") in params
    assert len(params) <= providers.MAX_DEEPGRAM_PARAMS


# ---------------------------------------------------------------------------
# Prompt: original language/script, no translation bias, char-bounded context
# ---------------------------------------------------------------------------
def test_groq_prompt_transcribes_original_script_never_translates(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")
    prompts = []

    def post(url, **kwargs):
        prompts.append(kwargs["data"].get("prompt", ""))
        return response(200, {"language": "english",
                              "words": [{"word": "x", "start": 0, "end": 1}]})

    monkeypatch.setattr(providers.requests, "post", post)
    providers.transcribe(str(audio))
    prompt = prompts[0]
    assert "do NOT translate" in prompt
    assert "original spoken language and native script" in prompt
    assert "Romanised Hindi" not in prompt      # output default is original


def test_groq_prompt_context_is_char_bounded(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")
    prompts = []

    def post(url, **kwargs):
        prompts.append(kwargs["data"].get("prompt", ""))
        return response(200, {"language": "english",
                              "words": [{"word": "x", "start": 0, "end": 1}]})

    monkeypatch.setattr(providers.requests, "post", post)
    providers.transcribe(str(audio), context={"title": "T" * 500,
                                              "tags": ["t" * 40] * 12})
    prompt = prompts[0]
    base = len(providers.PROMPT_BASE)
    assert len(prompt) <= base + 1 + providers.CONTEXT_CHAR_BUDGET


# ---------------------------------------------------------------------------
# Deepgram: hinted language is authoritative; detected_language both fields
# ---------------------------------------------------------------------------
def test_deepgram_hint_pins_language_param(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")
    captured = {}

    def post(url, **kwargs):
        captured["params"] = kwargs.get("params")
        return response(200, {"results": {"channels": [{"alternatives": [
            {"words": [{"word": "x", "start": 0, "end": 1}]}]}]}})

    monkeypatch.setattr(providers.requests, "post", post)
    providers.transcribe(str(audio), forced_language="hi", prefer_hindi_first=True)
    assert ("language", "hi") in captured["params"]
    providers.transcribe(str(audio), prefer_hindi_first=True)
    assert ("language", "multi") in captured["params"]


def test_deepgram_reads_channel_detected_language_bcp47(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")

    def post(url, **kwargs):
        # Official docs: results.channels[0].detected_language (BCP-47).
        return response(200, {"results": {"channels": [{
            "detected_language": "en-US",
            "alternatives": [{"words": [{"word": "x", "start": 0, "end": 1}]}]}]}})

    monkeypatch.setattr(providers.requests, "post", post)
    result = providers.transcribe(str(audio), prefer_hindi_first=True)
    assert result["language"] == "en"      # BCP-47 locale normalized


def test_deepgram_metadata_detected_language_still_supported(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")

    def post(url, **kwargs):
        return response(200, {"metadata": {"detected_language": "hi"},
                              "results": {"channels": [{"alternatives": [
                                  {"words": [{"word": "x", "start": 0, "end": 1}]}]}]}})

    monkeypatch.setattr(providers.requests, "post", post)
    assert providers.transcribe(str(audio), prefer_hindi_first=True)["language"] == "hi"


# ---------------------------------------------------------------------------
# Malformed timestamps must skip the word, not crash the provider
# ---------------------------------------------------------------------------
def test_groq_malformed_word_timestamps_are_skipped(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")

    def post(url, **kwargs):
        return response(200, {"language": "hindi", "words": [
            {"word": "bad", "start": "0.5", "end": 1.0},        # string
            {"word": "nan", "start": float("nan"), "end": 1.0},  # non-finite
            {"word": "back", "start": 2.0, "end": 1.0},          # inverted
            {"word": "good", "start": 1.0, "end": 2.0},
        ]})

    monkeypatch.setattr(providers.requests, "post", post)
    result = providers.transcribe(str(audio))
    assert [w["text"] for w in result["words"]] == ["good"]
    assert result["words"][0]["startMs"] == 1000


# ---------------------------------------------------------------------------
# Word-timed preference over estimated spreads
# ---------------------------------------------------------------------------
def _segments_only_groq():
    return response(200, {"language": "hindi", "segments": [
        {"start": 0.0, "end": 2.0, "text": "namaste dosto"}]})


def test_estimated_transcript_falls_over_to_word_timed_provider(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")

    def post(url, **kwargs):
        if url == providers.GROQ_URL:
            return _segments_only_groq()      # no word granularity → estimate
        return response(200, {"results": {"channels": [{"alternatives": [
            {"words": [{"word": "timed", "start": 0, "end": 1}]}]}]}})

    monkeypatch.setattr(providers.requests, "post", post)
    result = providers.transcribe(str(audio))
    assert result["provider"] == "deepgram"
    assert result["timing_source"] == "word"


def test_all_estimated_is_returned_honestly(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")

    def post(url, **kwargs):
        if url == providers.GROQ_URL:
            return _segments_only_groq()
        return response(200, {"results": {"channels": [{"alternatives": [
            {"transcript": "namaste dosto"}]}]}})   # transcript, no words

    monkeypatch.setattr(providers.requests, "post", post)
    result = providers.transcribe(str(audio))
    assert result["timing_source"] == "estimated"
    assert result["words"][0]["confidence"] is None   # honest: no fake confidence


def test_word_timed_result_carries_timing_source_word(tmp_path, monkeypatch):
    audio = tmp_path / "chunk.wav"
    audio.write_bytes(b"test audio")

    def post(url, **kwargs):
        return response(200, {"language": "english",
                              "words": [{"word": "x", "start": 0, "end": 1,
                                         "probability": 0.9}]})

    monkeypatch.setattr(providers.requests, "post", post)
    result = providers.transcribe(str(audio))
    assert result["timing_source"] == "word"
