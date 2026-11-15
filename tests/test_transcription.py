"""Offline tests for pipeline/transcription.py (extracted workflow logic)."""
import json
from pathlib import Path

import pytest

import transcription as mod


def w(text, start, end, confidence=None):
    return {"text": text, "startMs": start, "endMs": end, "confidence": confidence}


# ---------------------------------------------------------------------------
# clean()
# ---------------------------------------------------------------------------
def test_clean_keeps_single_codepoint_hindi_words():
    words = [w("है", 0, 300), w("न", 300, 600), w("word", 600, 900)]
    assert [k["text"] for k in mod.clean(words)] == ["है", "न", "word"]


def test_clean_strips_ascii_single_chars_and_punctuation():
    words = [w(".", 0, 100), w("q", 100, 300), w("ok", 300, 600)]
    assert [k["text"] for k in mod.clean(words)] == ["ok"]


def test_clean_removes_hallucinated_signoffs():
    words = [w(t, i * 200, i * 200 + 150)
             for i, t in enumerate(["hello", "there", "thanks", "for", "watching", "bye"])]
    assert [k["text"] for k in mod.clean(words)] == ["hello", "there", "bye"]


def test_clean_caps_repetition_loops():
    words = [w(t, i * 200, i * 200 + 150)
             for i, t in enumerate(["ha", "ha", "ha", "ha", "ok"])]
    assert [k["text"] for k in mod.clean(words)] == ["ha", "ha", "ha", "ok"]


def test_clean_drops_impossible_spans():
    words = [w("word", 0, 9000), w("ok", 9000, 9200)]
    assert [k["text"] for k in mod.clean(words)] == ["ok"]


# ---------------------------------------------------------------------------
# LanguageLock — the auto-English-lock regression
# ---------------------------------------------------------------------------
def test_lock_auto_never_forces_detected_english():
    lock = mod.LanguageLock(None)
    assert lock.plan_chunk() == (None, False)
    lock.observe("en", "groq", "whisper-large-v3", 100, 0.9)
    # A detection of "en" (the classic Hinglish false positive) must NOT lock:
    # later chunks keep auto-detecting instead of being force-fed language=en.
    assert lock.plan_chunk() == (None, False)
    assert lock.locked is None
    assert lock.language_source == "undetermined"


def test_lock_auto_needs_two_agreeing_non_english_chunks():
    lock = mod.LanguageLock(None)
    lock.observe("hi", "groq", "whisper-large-v3", 100, 0.9)
    # One (possibly noisy, confidence-unknown) chunk is not enough to lock.
    assert lock.plan_chunk() == (None, False)
    lock.observe("hi", "deepgram", "nova-3", 100, 0.9)
    assert lock.plan_chunk() == ("hi", True)   # two agreeing chunks lock
    assert lock.language_source == "detected"


def test_lock_auto_streak_resets_on_noise_or_disagreement():
    lock = mod.LanguageLock(None)
    lock.observe("hi", "groq", "m", 10, None)
    lock.observe("en", "groq", "m", 10, None)   # en/und/multi reset the streak
    lock.observe("hi", "groq", "m", 10, None)
    assert lock.plan_chunk() == (None, False)
    lock.observe("ta", "groq", "m", 10, None)   # different code restarts pending
    assert lock.plan_chunk() == (None, False)
    lock.observe("ta", "groq", "m", 10, None)
    assert lock.plan_chunk() == ("ta", True)


def test_lock_hint_is_authoritative_from_chunk_zero():
    lock = mod.LanguageLock("hi")
    assert lock.plan_chunk() == ("hi", True)
    assert lock.language_source == "user-hint"
    lock.observe("en", "groq", "m", 10, None)  # observation cannot override a hint
    assert lock.plan_chunk() == ("hi", True)


def test_lock_hint_en_forces_english():
    assert mod.LanguageLock("en").plan_chunk() == ("en", False)


def test_lock_ignores_und_and_multi_detections():
    lock = mod.LanguageLock(None)
    lock.observe("multi", "deepgram", "nova-3", 10, None)
    lock.observe("und", "groq", "m", 10, None)
    assert lock.plan_chunk() == (None, False)
    assert lock.language_source == "undetermined"


# ---------------------------------------------------------------------------
# transcribe_file orchestration (split_chunks monkeypatched — no ffmpeg)
# ---------------------------------------------------------------------------
def test_transcribe_file_writes_captions_language_and_meta(tmp_path, monkeypatch):
    monkeypatch.setattr(mod, "MIN_WORDS", 1)
    monkeypatch.setattr(mod, "wav_duration_sec", lambda _: 310)
    wav = tmp_path / "audio.wav"
    wav.write_bytes(b"fake")
    calls = []

    def fake_transcribe(chunk, offset, forced_language=None,
                        prefer_hindi_first=False, context=None):
        calls.append((str(chunk), offset, forced_language, prefer_hindi_first))
        if len(calls) == 1:
            return {"words": [w("yeh", offset, offset + 400, 0.9),
                              w("hai", offset + 400, offset + 800, 0.8)],
                    "language": "hi", "provider": "groq", "model": "whisper-large-v3",
                    "timing_source": "word"}
        return {"words": [w("scene", offset * 1000, offset * 1000 + 500, 0.7)],
                "language": "hi", "provider": "deepgram", "model": "nova-3",
                "timing_source": "word"}

    monkeypatch.setattr(
        mod, "split_chunks",
        lambda wav, out: [tmp_path / "chunk_000.wav", tmp_path / "chunk_001.wav"])

    meta = mod.transcribe_file(wav, tmp_path, transcribe_fn=fake_transcribe)

    caps = json.loads((tmp_path / "full_captions.json").read_text())
    assert [c["text"] for c in caps] == ["yeh", "hai", "scene"]
    assert caps[2]["startMs"] == 300_000            # chunk offset applied
    assert (tmp_path / "detected_language.txt").read_text() == "hi"
    meta_doc = json.loads((tmp_path / "transcription_meta.json").read_text())
    assert meta_doc["language"] == "hi"
    assert meta_doc["source_duration"] == 310
    assert meta_doc["language_source"] == "detected"
    assert [c["provider"] for c in meta_doc["chunks"]] == ["groq", "deepgram"]
    assert meta_doc["chunks"][0]["confidence"] == 0.85   # mean of 0.9/0.8
    assert all(c["timing_source"] == "word" for c in meta_doc["chunks"])
    # Chunk 2 still ran auto: one agreeing chunk is not enough to lock (the
    # lock engages after the second agreeing observation below it).
    assert calls[1][2] is None and calls[1][3] is False


def test_transcribe_file_empty_chunk_is_a_named_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(mod, "MIN_WORDS", 1)
    monkeypatch.setattr(mod, "split_chunks", lambda wav, out: [wav])

    def fake(chunk, offset, **kwargs):
        return {"words": [], "language": "en", "provider": "groq", "model": "m"}

    with pytest.raises(mod.TranscriptionError, match="empty transcript"):
        mod.transcribe_file(tmp_path / "a.wav", tmp_path, transcribe_fn=fake)


def test_transcribe_file_too_few_words_is_a_named_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(mod, "MIN_WORDS", 10)
    monkeypatch.setattr(mod, "split_chunks", lambda wav, out: [wav])

    def fake(chunk, offset, **kwargs):
        return {"words": [w("hi", offset, offset + 100, 0.9)],
                "language": "en", "provider": "groq", "model": "m",
                "timing_source": "word"}

    with pytest.raises(mod.TranscriptionError, match="no speech"):
        mod.transcribe_file(tmp_path / "a.wav", tmp_path, transcribe_fn=fake)


def test_transcribe_file_hallucination_only_is_no_speech(tmp_path, monkeypatch):
    monkeypatch.setattr(mod, "split_chunks", lambda wav, out: [wav])

    def fake(chunk, offset, **kwargs):
        return {"words": [w("thanks", offset, offset + 200, 0.9),
                          w("for", offset + 200, offset + 300, 0.9),
                          w("watching", offset + 300, offset + 500, 0.9)],
                "language": "en", "provider": "groq", "model": "m",
                "timing_source": "word"}

    with pytest.raises(mod.TranscriptionError, match="no speech"):
        mod.transcribe_file(tmp_path / "a.wav", tmp_path, transcribe_fn=fake)


def test_split_chunks_small_wav_over_300s_is_one_complete_chunk(tmp_path, monkeypatch):
    """A mono 16 kHz WAV at 310 s is ~9.9 MB (<24 MB): it legitimately stays
    ONE chunk — the old time-based expectation (ceil(310/300)=2) aborted it."""
    from types import SimpleNamespace
    wav = tmp_path / "audio.wav"
    wav.write_bytes(b"x" * 1024)

    def fake_run(cmd, **kwargs):
        assert cmd[0] != "ffmpeg", "a small wav must never be segmented"
        if cmd[0] == "ffprobe":
            return SimpleNamespace(stdout="310\n", returncode=0)
        raise AssertionError(f"unexpected subprocess {cmd[0]}")

    monkeypatch.setattr(mod.subprocess, "run", fake_run)
    chunks = mod.split_chunks(wav, tmp_path)
    assert len(chunks) == 1


def test_transcribe_file_hint_en_forces_every_chunk(tmp_path, monkeypatch):
    monkeypatch.setattr(mod, "MIN_WORDS", 1)
    monkeypatch.setattr(mod, "split_chunks", lambda wav, out: [wav])
    calls = []

    def fake(chunk, offset, forced_language=None, prefer_hindi_first=False, context=None):
        calls.append((forced_language, prefer_hindi_first))
        return {"words": [w("ok", offset, offset + 100, 0.9)],
                "language": "en", "provider": "groq", "model": "m"}

    meta = mod.transcribe_file(tmp_path / "a.wav", tmp_path,
                               source_language="en", transcribe_fn=fake)
    assert calls == [("en", False)]
    assert meta["language_source"] == "user-hint"


def test_transcribe_file_rejects_unsupported_source_language(tmp_path):
    with pytest.raises(mod.TranscriptionError, match="unsupported source_language"):
        mod.transcribe_file(tmp_path / "a.wav", tmp_path, source_language="fr",
                            transcribe_fn=lambda *a, **k: {"words": []})


def test_lock_after_second_agreeing_chunk_forces_native_on_later_chunks(tmp_path, monkeypatch):
    monkeypatch.setattr(mod, "MIN_WORDS", 1)
    monkeypatch.setattr(mod, "split_chunks",
                        lambda wav, out: [wav.parent / "c0.wav", wav.parent / "c1.wav",
                                          wav.parent / "c2.wav"])
    calls = []

    def fake(chunk, offset, forced_language=None, prefer_hindi_first=False, context=None):
        calls.append((forced_language, prefer_hindi_first))
        return {"words": [w("hai", offset, offset + 100, 0.9)],
                "language": "hi", "provider": "groq", "model": "m"}

    mod.transcribe_file(tmp_path / "a.wav", tmp_path, transcribe_fn=fake)
    # chunks 1-2 auto (one agreeing chunk insufficient), chunk 3 locked hi.
    assert calls == [(None, False), (None, False), ("hi", True)]


def test_workflow_language_gates_whitelist_and_meta_plumbing():
    """Structure pins: default 'original' runs NO conversion for a Hindi
    source (no English-translation endpoint unless explicitly requested);
    source_language whitelist is exactly auto|hi|en; transcription_meta.json
    reaches both the checkpoint restore and the finalizer meta artifact."""
    import yaml
    root = Path(__file__).resolve().parents[1]
    wf = yaml.safe_load(
        (root / ".github/workflows/process-video.yml").read_text(encoding="utf-8"))
    steps = {s.get("name"): s for s in wf["jobs"]["process"]["steps"]}
    assert steps["Convert captions to Hinglish"]["if"] == "inputs.caption_language == 'hinglish'"
    assert steps["Convert clip captions (English)"]["if"] == "inputs.caption_language == 'en'"
    assert "caption_language.py hinglish" in steps["Convert captions to Hinglish"]["run"]
    assert "caption_language.py english" in steps["Convert clip captions (English)"]["run"]
    validate = steps["Validate inputs"]["run"]
    assert '("auto", "hi", "en")' in validate
    assert "transcription_meta.json" in steps["Resolve checkpoint"]["run"]
    assert "transcription_meta.json" in steps["Split render shards"]["run"]
    on = wf[True] if True in wf else wf["on"]
    inputs = on["workflow_dispatch"]["inputs"]
    assert inputs["source_language"]["default"] == "auto"
    assert inputs["caption_language"]["default"] == "original"
