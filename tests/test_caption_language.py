"""Offline tests for pipeline/caption_language.py (output-language conversion)."""
import json

import caption_language as cl


def words(spec):
    return [{"text": t, "startMs": s, "endMs": e} for t, s, e in spec]


# ---------------------------------------------------------------------------
# Phrase grouping
# ---------------------------------------------------------------------------
def test_group_phrases_closes_on_sentence_end_and_gap():
    caps = words([("one", 0, 300), ("two.", 300, 600),
                  ("Three", 5000, 5300), ("four", 5300, 5600)])
    phrases = cl.group_phrases(caps)
    assert phrases == [(0, 2), (2, 4)]


def test_group_phrases_respect_word_cap():
    caps = [{"text": f"w{i}", "startMs": i * 100, "endMs": i * 100 + 90}
            for i in range(20)]
    phrases = cl.group_phrases(caps)
    assert phrases[0] == (0, 18)
    assert all(b - a <= cl.MAX_PHRASE_WORDS for a, b in phrases)
    assert phrases[-1] == (18, 20)


def test_group_phrases_empty_input():
    assert cl.group_phrases([]) == []


# ---------------------------------------------------------------------------
# English conversion — timing/ordering invariants
# ---------------------------------------------------------------------------
def test_conversion_maps_tokens_across_the_original_span():
    caps = words([("yeh", 0, 400), ("ek", 400, 800),
                  ("test", 800, 1200), ("hai", 1200, 1600)])

    def ask(prompt, **kwargs):
        return json.dumps({"phrases": ["this is a test"]})

    new, status = cl.convert_captions_english(caps, ask, deadline=100.0,
                                              clock=lambda: 0.0)
    assert status["action"] == "converted"
    assert status["phrases_converted"] == 1
    assert [c["text"] for c in new] == ["this", "is", "a", "test"]
    # Span preserved exactly; timings monotonic with positive durations.
    assert new[0]["startMs"] == 0 and new[-1]["endMs"] == 1600
    starts = [c["startMs"] for c in new]
    assert starts == sorted(starts)
    assert all(e > s for s, e in zip(starts, [c["endMs"] for c in new]))
    assert not any(cl.DEVANAGARI.search(c["text"]) for c in new)


def test_untranslated_phrases_pass_through():
    caps = words([("yeh", 0, 400), ("hai", 400, 800),
                  ("ok", 3000, 3400)])
    phrases = cl.group_phrases(caps)  # [(0, 2), (2, 3)] — gap-split
    assert phrases == [(0, 2), (2, 3)]
    new = cl.apply_phrase_translation(caps, phrases, {0: "this is"})
    assert [c["text"] for c in new] == ["this", "is", "ok"]
    assert new[2]["startMs"] == 3000 and new[2]["endMs"] == 3400


def test_bad_reply_keeps_source_language_explicitly():
    caps = words([("yeh", 0, 400), ("hai", 400, 800)])
    new, status = cl.convert_captions_english(
        caps, lambda *a, **k: '{"phrases": []}',
        deadline=100.0, clock=lambda: 0.0)
    assert status["action"] == "fallback_source_language"
    assert status["phrases_fallback"] == status["phrases_total"] == 1
    assert [c["text"] for c in new] == ["yeh", "hai"]


def test_provider_outage_is_explicit_fallback_not_silent():
    caps = words([("yeh", 0, 400), ("hai", 400, 800)])

    def ask(*args, **kwargs):
        raise RuntimeError("providers down")

    new, status = cl.convert_captions_english(caps, ask, deadline=100.0,
                                              clock=lambda: 0.0)
    assert status["action"] == "fallback_source_language"
    assert [c["text"] for c in new] == ["yeh", "hai"]


def test_invalid_translation_rejected_and_source_kept():
    caps = words([("यह", 0, 400), ("है", 400, 800)])

    def ask(prompt, **kwargs):
        return json.dumps({"phrases": ["यह है"]})  # still Devanagari → invalid

    new, status = cl.convert_captions_english(caps, ask, deadline=100.0,
                                              clock=lambda: 0.0)
    assert status["action"] == "fallback_source_language"
    assert [c["text"] for c in new] == ["यह", "है"]


def test_source_english_latin_skips_without_llm():
    caps = words([("hello", 0, 400), ("world", 400, 800)])

    def ask(*args, **kwargs):
        raise AssertionError("no LLM call expected")

    new, status = cl.convert_captions_english(caps, ask, deadline=100.0,
                                              source_is_english=True,
                                              clock=lambda: 0.0)
    assert status["action"] == "skipped_source_english"
    assert new == caps


def test_devanagari_converts_even_when_source_says_english():
    # Defense against a misdetected source language: Devanagari present → convert.
    caps = words([("यह", 0, 400), ("है", 400, 800)])
    calls = []

    def ask(prompt, **kwargs):
        calls.append(prompt)
        return json.dumps({"phrases": ["this is"]})

    new, status = cl.convert_captions_english(caps, ask, deadline=100.0,
                                              source_is_english=True,
                                              clock=lambda: 0.0)
    assert calls and status["action"] == "converted"
    assert [c["text"] for c in new] == ["this", "is"]
    assert not any(cl.DEVANAGARI.search(c["text"]) for c in new)


# ---------------------------------------------------------------------------
# Budget bounding
# ---------------------------------------------------------------------------
def test_budget_exhaustion_is_partial_and_explicit():
    caps = [{"text": f"w{i}", "startMs": i * 5000, "endMs": i * 5000 + 100}
            for i in range(25)]  # 25 single-word phrases (huge gaps)
    times = iter([0.0] + [99.99] * 50)

    def ask(prompt, **kwargs):
        entries = json.loads(prompt.split("\n", 1)[1])
        return json.dumps({"phrases": [f"t{e['index']}" for e in entries]})

    new, status = cl.convert_captions_english(caps, ask, deadline=100.0,
                                              clock=lambda: next(times))
    assert status["phrases_converted"] == 10
    assert status["phrases_fallback"] == 15
    assert status["action"] == "converted"
    # Untranslated phrases keep their original text and timings.
    assert new[10]["text"] == "w10" and new[10]["startMs"] == 50_000


def test_invalid_batch_does_not_stop_the_rest():
    caps = [{"text": f"w{i}", "startMs": i * 5000, "endMs": i * 5000 + 100}
            for i in range(20)]
    replies = ['{"phrases": ["only one"]}',
               json.dumps({"phrases": [f"t{i}" for i in range(10)]})]
    calls = []

    def ask(prompt, **kwargs):
        calls.append(1)
        return replies[len(calls) - 1]

    new, status = cl.convert_captions_english(caps, ask, deadline=100.0,
                                              clock=lambda: 0.0)
    assert len(calls) == 2  # a bad batch does not end the loop
    assert status["phrases_converted"] == 10
    assert status["phrases_fallback"] == 10


# ---------------------------------------------------------------------------
# Hinglish delegation
# ---------------------------------------------------------------------------
def test_hinglish_delegates_to_transliterate(monkeypatch):
    import transliterate
    seen = {}

    def fake_romanise(captions, ask, **options):
        seen["called"] = True
        return {"unique_words": 1}

    monkeypatch.setattr(transliterate, "romanise", fake_romanise)
    assert cl.convert_hinglish([{"text": "है"}], None) == {"unique_words": 1}
    assert seen["called"]


def test_empty_captions_skip_conversion():
    new, status = cl.convert_captions_english([], lambda *a, **k: None,
                                              deadline=100.0, clock=lambda: 0.0)
    assert status["action"] == "skipped_empty" and new == []


# ---------------------------------------------------------------------------
# Job-level runners: persisted reports + fail-closed policy
# ---------------------------------------------------------------------------
def test_hinglish_success_persists_romanised_captions_and_meta(tmp_path):
    caps_path = tmp_path / "full_captions.json"
    caps_path.write_text(json.dumps([{"text": "है", "startMs": 0, "endMs": 400}]),
                         encoding="utf-8")
    meta_path = tmp_path / "transcription_meta.json"
    meta_path.write_text(json.dumps({"language": "hi", "language_source": "detected"}),
                         encoding="utf-8")
    prompts = []

    def ask(prompt, **kwargs):
        prompts.append(prompt)
        return json.dumps({"words": ["hai"]})

    code = cl.run_hinglish_conversion(caps_path, meta_path, ask, budget_seconds=60)
    assert code == 0
    # Converted captions persisted; conversion report merged into the meta.
    assert json.loads(caps_path.read_text(encoding="utf-8"))[0]["text"] == "hai"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["conversion"]["satisfied"] is True
    assert meta["conversion"]["mode"] == "hinglish"
    assert meta["language"] == "hi" and meta["language_source"] == "detected"
    # A Hinglish request romanises — it must never hit a translation prompt.
    assert prompts and "Romanise" in prompts[0] and "Translate" not in prompts[0]


def test_hinglish_fail_closed_keeps_raw_and_reports(tmp_path):
    caps_path = tmp_path / "full_captions.json"
    caps_path.write_text(json.dumps([{"text": "है", "startMs": 0, "endMs": 400}]),
                         encoding="utf-8")
    meta_path = tmp_path / "transcription_meta.json"
    meta_path.write_text(json.dumps({"language": "hi"}), encoding="utf-8")

    def ask(*args, **kwargs):
        return json.dumps({"words": [""]})   # invalid reply → batch rejected

    code = cl.run_hinglish_conversion(caps_path, meta_path, ask, budget_seconds=60)
    assert code == 1
    # RAW captions untouched on disk; warning persisted for the dashboard.
    assert json.loads(caps_path.read_text(encoding="utf-8"))[0]["text"] == "है"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["conversion"]["satisfied"] is False
    assert meta["conversion"]["warnings"]
    assert meta["language"] == "hi"


def test_english_fail_closed_persists_per_clip_report_and_meta(tmp_path):
    clipsdir = tmp_path
    (clipsdir / "clip_000.captions.json").write_text(json.dumps(
        [{"text": "यह", "startMs": 0, "endMs": 400},
         {"text": "है", "startMs": 400, "endMs": 800}]), encoding="utf-8")
    meta_path = tmp_path / "transcription_meta.json"
    meta_path.write_text(json.dumps({"language": "hi"}), encoding="utf-8")

    def ask(prompt, **kwargs):
        return '{"phrases": []}'   # count mismatch → batch fallback

    code = cl.run_english_conversion(clipsdir, meta_path, ask, budget_seconds=60,
                                     clock=lambda: 0.0)
    assert code == 1   # fail-closed: requested English not fully produced
    report = json.loads((clipsdir / "clip_000.conversion.json").read_text(encoding="utf-8"))
    assert report["action"] == "fallback_source_language"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["conversion"]["satisfied"] is False
    assert meta["conversion"]["warnings"]
    assert meta["language"] == "hi"
    # Captions file kept the source language (RAW for retry), not mixed text.
    assert json.loads((clipsdir / "clip_000.captions.json").read_text(
        encoding="utf-8"))[0]["text"] == "यह"


def test_english_success_is_satisfied_with_reports(tmp_path):
    clipsdir = tmp_path
    (clipsdir / "clip_000.captions.json").write_text(json.dumps(
        [{"text": "यह", "startMs": 0, "endMs": 400},
         {"text": "है", "startMs": 400, "endMs": 800}]), encoding="utf-8")
    meta_path = tmp_path / "transcription_meta.json"
    meta_path.write_text(json.dumps({"language": "hi"}), encoding="utf-8")

    def ask(prompt, **kwargs):
        return json.dumps({"phrases": ["this is"]})

    code = cl.run_english_conversion(clipsdir, meta_path, ask, budget_seconds=60,
                                     clock=lambda: 0.0)
    assert code == 0
    report = json.loads((clipsdir / "clip_000.conversion.json").read_text(encoding="utf-8"))
    assert report["action"] == "converted" and report["phrases_fallback"] == 0
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["conversion"]["satisfied"] is True
    assert meta["conversion"]["clips"][0]["clip"] == "clip_000.captions.json"
    caps = json.loads((clipsdir / "clip_000.captions.json").read_text(encoding="utf-8"))
    assert [c["text"] for c in caps] == ["this", "is"]


def test_partial_english_fallback_fails_closed_even_when_some_phrases_convert(tmp_path):
    clipsdir = tmp_path
    caps = [{"text": f"w{i}", "startMs": i * 5000, "endMs": i * 5000 + 100}
            for i in range(20)]
    (clipsdir / "clip_000.captions.json").write_text(json.dumps(caps), encoding="utf-8")
    meta_path = tmp_path / "transcription_meta.json"
    replies = ['{"phrases": ["only one"]}',
               json.dumps({"phrases": [f"t{i}" for i in range(10)]})]
    calls = []

    def ask(prompt, **kwargs):
        calls.append(1)
        return replies[len(calls) - 1]

    code = cl.run_english_conversion(clipsdir, meta_path, ask, budget_seconds=60,
                                     clock=lambda: 0.0)
    assert code == 1   # 10/20 phrases translated is still mixed-language output
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["conversion"]["satisfied"] is False
    assert meta["conversion"]["warnings"]


# ---------------------------------------------------------------------------
# Translated-token span resampling (the weights-by-source-index bug)
# ---------------------------------------------------------------------------
def test_more_translated_than_source_tokens_stays_in_span():
    caps = words([("yeh", 0, 400), ("hai", 400, 800)])
    new = cl.apply_phrase_translation(caps, [(0, 2)],
                                      {0: "a b c d e f g h i j"})
    assert [c["text"] for c in new] == "a b c d e f g h i j".split()
    assert new[0]["startMs"] == 0 and new[-1]["endMs"] == 800
    for prev, cur in zip(new, new[1:]):
        assert cur["startMs"] == prev["endMs"]        # contiguous, no overshoot
    for t in new:
        assert 0 <= t["startMs"] < t["endMs"] <= 800  # inside the phrase span


def test_fewer_translated_than_source_tokens_splits_by_rhythm():
    caps = [{"text": f"w{i}", "startMs": i * 100, "endMs": i * 100 + 100}
            for i in range(10)]
    new = cl.apply_phrase_translation(caps, [(0, 10)], {0: "alpha beta"})
    assert len(new) == 2
    assert new[0]["startMs"] == 0 and new[0]["endMs"] == 500
    assert new[1]["startMs"] == 500 and new[1]["endMs"] == 1000


def test_uneven_source_rhythm_resampled_onto_translated_tokens():
    caps = words([("long", 0, 800), ("short", 800, 1000)])   # 80% / 20%
    new = cl.apply_phrase_translation(caps, [(0, 2)], {0: "x y z"})
    assert new[-1]["endMs"] == 1000
    assert new[0]["endMs"] > 500          # the long word dominates the start
    assert all(t["startMs"] >= 0 and t["endMs"] <= 1000 for t in new)
    for prev, cur in zip(new, new[1:]):
        assert cur["startMs"] == prev["endMs"]


def test_token_times_respect_phrase_bounds_with_overlapping_source():
    # Sentence-end split; the next phrase's first word starts BEFORE the
    # previous phrase's last word ends (source overlap). Converted tokens
    # must stay inside their own phrase span, final ends exact.
    caps = words([("one", 0, 500), ("two.", 400, 900), ("Three", 850, 1300)])
    phrases = cl.group_phrases(caps)
    assert phrases == [(0, 2), (2, 3)]
    new = cl.apply_phrase_translation(caps, phrases, {0: "one two", 1: "three"})
    for t in new[:2]:
        assert 0 <= t["startMs"] < t["endMs"] <= 900
    assert new[1]["endMs"] == 900
    assert 850 <= new[2]["startMs"] < new[2]["endMs"] == 1300


# ---------------------------------------------------------------------------
# Reply validation: typing, expansion cap, Latin target
# ---------------------------------------------------------------------------
def test_non_string_translations_rejected():
    caps = words([("यह", 0, 400), ("है", 400, 800)])
    for reply in ['{"phrases": [null]}', '{"phrases": [{"text": "x"}]}',
                  '{"phrases": [42]}']:
        new, status = cl.convert_captions_english(
            caps, lambda *a, **k: reply, deadline=100.0, clock=lambda: 0.0)
        assert status["action"] == "fallback_source_language"
        assert [c["text"] for c in new] == ["यह", "है"]


def test_excessive_expansion_rejected():
    caps = words([("hi", 0, 400)])
    reply = json.dumps({"phrases": ["word " * 300]})   # 1800 chars from 2
    new, status = cl.convert_captions_english(
        caps, lambda *a, **k: reply, deadline=100.0, clock=lambda: 0.0)
    assert status["action"] == "fallback_source_language"
    assert new == caps


def test_non_latin_target_rejected():
    caps = words([("hello", 0, 400)])   # passes the Devanagari check…
    reply = json.dumps({"phrases": ["это тест"]})   # …Cyrillic must not slip in
    new, status = cl.convert_captions_english(
        caps, lambda *a, **k: reply, deadline=100.0, clock=lambda: 0.0)
    assert status["action"] == "fallback_source_language"
    assert new == caps


# ---------------------------------------------------------------------------
# Danda sentence boundaries
# ---------------------------------------------------------------------------
def test_danda_and_double_danda_end_sentences():
    caps = words([("yeh", 0, 300), ("hai।", 300, 600), ("phir", 600, 900)])
    assert cl.group_phrases(caps) == [(0, 2), (2, 3)]
    caps = words([("shlok", 0, 300), ("hै॥", 300, 600), ("aage", 600, 900)])
    assert cl.group_phrases(caps) == [(0, 2), (2, 3)]


# ---------------------------------------------------------------------------
# Skip rule: only proven-English source skips English conversion
# ---------------------------------------------------------------------------
def _write_meta(tmp_path, doc):
    path = tmp_path / "transcription_meta.json"
    path.write_text(json.dumps(doc), encoding="utf-8")
    return path


def test_skip_only_when_all_chunks_en_or_explicit_en(tmp_path):
    clipsdir = tmp_path
    (clipsdir / "clip_000.captions.json").write_text(json.dumps(
        [{"text": "hello", "startMs": 0, "endMs": 400}]), encoding="utf-8")
    calls = []

    def ask(prompt, **kwargs):
        calls.append(prompt)
        return json.dumps({"phrases": ["hello"]})

    # Explicit user-hint en → skip without an LLM call.
    meta = _write_meta(tmp_path, {"language": "en", "language_source": "user-hint",
                                  "chunks": []})
    assert cl.run_english_conversion(clipsdir, meta, ask, budget_seconds=60,
                                     clock=lambda: 0.0) == 0
    assert calls == []
    # Every chunk genuinely en (undetermined lock) → skip.
    meta = _write_meta(tmp_path, {"language": "und", "language_source": "undetermined",
                                  "chunks": [{"language": "en"}, {"language": "en"}]})
    assert cl.run_english_conversion(clipsdir, meta, ask, budget_seconds=60,
                                     clock=lambda: 0.0) == 0
    assert calls == []
    # Mixed detection (majority en, later hi chunks) → must NOT skip: the
    # per-clip script check alone misses romanised Hindi.
    meta = _write_meta(tmp_path, {"language": "hi", "language_source": "detected",
                                  "chunks": [{"language": "en"}, {"language": "en"},
                                             {"language": "hi"}, {"language": "hi"}]})
    assert cl.run_english_conversion(clipsdir, meta, ask, budget_seconds=60,
                                     clock=lambda: 0.0) == 0
    assert calls, "mixed detection must attempt conversion"
    # Single detected "en" with no chunk evidence (old checkpoint) → no skip.
    meta = _write_meta(tmp_path, {"language": "en", "language_source": "detected",
                                  "chunks": []})
    calls.clear()
    cl.run_english_conversion(clipsdir, meta, ask, budget_seconds=60,
                              clock=lambda: 0.0)
    assert calls, "detected-en without chunk proof must attempt conversion"
