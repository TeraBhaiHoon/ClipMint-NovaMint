"""Whole-video briefing parsing + prompt context, and the LLM provider chain."""
import llm
import video_briefing as vb


# ── video_briefing ───────────────────────────────────────────────────────
def test_clean_json_tolerates_fences_and_prose():
    assert vb._clean_json('```json\n{"topic": "x"}\n```') == {"topic": "x"}
    assert vb._clean_json('Sure! Here it is: {"topic": "y"} hope this helps') == {"topic": "y"}
    assert vb._clean_json('{"topic": "z"}') == {"topic": "z"}


def test_normalise_rejects_unknown_moods_and_caps_fields():
    out = vb._normalise({"mood_prior": "Spooky", "keywords": [str(i) for i in range(30)],
                         "summary": "s" * 5000})
    assert out["mood_prior"] == ""
    assert len(out["keywords"]) == 12
    assert len(out["summary"]) == 1500
    assert vb._normalise({"mood_prior": " Calm "})["mood_prior"] == "calm"


def test_long_transcripts_are_sectioned_with_overlap():
    text = "word " * 60_000                      # 300k chars
    sections = vb._split_sections(text)
    assert len(sections) >= 3
    assert all(len(s) <= vb.CAP_SINGLE_CHARS for s in sections)


def test_context_block_is_empty_without_data_and_carries_the_brief():
    assert vb.context_block(None, None) == ""
    block = vb.context_block({"topic": "Startup funding", "mood_prior": "corporate",
                              "keywords": ["Raj"]}, None)
    assert "Startup funding" in block and "corporate" in block and "Raj" in block


# ── llm provider chain ───────────────────────────────────────────────────
def test_nim_is_first_and_groq_override_is_deduplicated(monkeypatch):
    monkeypatch.setenv("NVIDIA_NIM_API_KEY", "nim-key")
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    monkeypatch.setenv("CLIPMINT_LLM_MODEL", llm.GROQ_MODELS[1])
    chain = llm._providers()
    assert [c[0] for c in chain] == ["nim", "groq"]
    groq_models = chain[1][3]
    assert groq_models[0] == llm.GROQ_MODELS[1]
    assert len(groq_models) == len(set(groq_models))


def test_no_keys_means_no_providers(monkeypatch):
    for k in ("NVIDIA_NIM_API_KEY", "GROQ_API_KEY", "CLIPMINT_LLM_MODEL"):
        monkeypatch.delenv(k, raising=False)
    assert llm._providers() == []
