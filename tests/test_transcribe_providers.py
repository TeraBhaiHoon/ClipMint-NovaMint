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
