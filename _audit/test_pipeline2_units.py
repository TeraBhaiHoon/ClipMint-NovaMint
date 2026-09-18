#!/usr/bin/env python3
"""
Unit tests for pipeline build 2 — no network, no live providers.

Covers:
  * pipeline/validate_captions.py  — every defect type is caught
  * pipeline/transcribe_providers.py — synthetic provider payloads (Groq
    verbose_json, Deepgram listen response, Riva offline_recognize response)
    parse into the canonical Caption[] shape
  * pipeline/prepare_clips.py — scene/silence boundary snapping preferences

Run:  python _audit/test_pipeline2_units.py
"""

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

from validate_captions import validate_captions
import transcribe_providers as tp
from prepare_clips import snap, snap_with_scenes

FAILURES = []


def check(name, cond, detail=""):
    if cond:
        print(f"  PASS {name}")
    else:
        FAILURES.append(name)
        print(f"  FAIL {name} {detail}")


def word(text, s, e, conf=0.9):
    return {"text": text, "startMs": s, "endMs": e, "timestampMs": None, "confidence": conf}


# ─── validate_captions ──────────────────────────────────────────────────────
print("caption validator:")
ok, defects = validate_captions([word("hello", 0, 400), word("world", 450, 900)], 2.0)
check("valid passes", ok and not defects, str(defects))

ok, defects = validate_captions([], 5.0)
check("empty caught", not ok and "captions_empty" in defects, str(defects))

ok, defects = validate_captions([word("hi", -200, 300)], 1.0)
check("negative startMs caught", not ok and any("negative startMs" in d for d in defects), str(defects))

ok, defects = validate_captions([word("hi", 300, 300)], 1.0)
check("zero duration caught", not ok and any("non-positive duration" in d for d in defects), str(defects))

ok, defects = validate_captions([word("hi", 400, 300)], 1.0)
check("negative duration caught", not ok and any("non-positive duration" in d for d in defects), str(defects))

overlap = [word("one", 0, 600), word("two", 500, 900)]  # 100ms overlap
ok, defects = validate_captions(overlap, 1.0)
check("overlap >50ms caught", not ok and any("overlap" in d for d in defects), str(defects))

# exactly-50ms overlap is the allowed boundary, 51ms+ is flagged
ok, _ = validate_captions([word("one", 0, 550), word("two", 500, 900)], 1.0)
check("overlap of exactly 50ms allowed", ok)

sparse = [word("only", 0, 200)]  # 0.2s of 2.0s = 10%
ok, defects = validate_captions(sparse, 2.0)
check("low coverage caught", not ok and any("coverage" in d for d in defects), str(defects))

good_cov = [word(f"w{i}", i * 200, i * 200 + 190) for i in range(4)]  # 760ms/2.0s = 38%
ok, defects = validate_captions(good_cov, 2.0)
check("coverage >= 30% passes", ok and not defects, str(defects))

ok, defects = validate_captions([word("x", "bad", 100)], 1.0)
check("non-numeric timing caught", not ok and any("non-numeric" in d for d in defects), str(defects))

# ─── transcribe_providers parsing ───────────────────────────────────────────
print("groq parser:")
groq_payload = {
    "language": "hindi",
    "words": [
        {"word": "नमस्ते", "start": 0.00, "end": 0.42, "probability": 0.97},
        {"word": "world", "start": 1.10, "end": 1.65, "probability": 0.88},
    ],
}
words, lang = tp.parse_groq_payload(groq_payload, offset_s=300.0)
check("groq word count", len(words) == 2, str(words))
check("groq language mapped hindi->hi", lang == "hi")
check("groq offset applied", words[1]["startMs"] == 301100 and words[1]["endMs"] == 301650, str(words[1]))
check("groq canonical shape", all(set(w) == {"text", "startMs", "endMs", "timestampMs", "confidence"}
                                  for w in words) and words[0]["timestampMs"] is None)
check("groq confidence kept", words[1]["confidence"] == 0.88)

seg_only = {
    "language": "english",
    "segments": [{"text": "one two three", "start": 10.0, "end": 16.0}],
}
words, lang = tp.parse_groq_payload(seg_only, offset_s=0.0)
check("groq segments spread evenly", len(words) == 3
      and words[0]["startMs"] == 10000 and words[0]["endMs"] == 12000
      and words[2]["startMs"] == 14000 and words[2]["endMs"] == 16000, str(words))
check("groq english->en", lang == "en")

print("deepgram parser:")
dg_payload = {
    "results": {"channels": [{"alternatives": [{
        "transcript": "Hello world.",
        "words": [
            {"word": "Hello", "punctuated_word": "Hello,", "start": 0.01, "end": 0.50, "confidence": 0.99},
            {"word": "world", "punctuated_word": "world.", "start": 0.60, "end": 1.10, "confidence": 0.91},
        ],
    }]}]},
}
words = tp.parse_deepgram_payload(dg_payload, offset_s=60.0, duration_s=5.0)
check("deepgram word count", len(words) == 2, str(words))
check("deepgram punctuated_word preferred", words[0]["text"] == "Hello," and words[1]["text"] == "world.")
check("deepgram seconds->ms + offset", words[0]["startMs"] == 60010 and words[1]["endMs"] == 61100, str(words[0]))
check("deepgram confidence kept", words[1]["confidence"] == 0.91)

dg_fallback = {"results": {"channels": [{"alternatives": [{
    "transcript": "spread these four words please", "words": []}]}]}}
words = tp.parse_deepgram_payload(dg_fallback, offset_s=0.0, duration_s=8.0)
check("deepgram no-words spread", len(words) == 5 and words[0]["startMs"] == 0 and words[-1]["endMs"] == 8000, str(words))

print("riva/NIM parser:")
def riva_word(text, s, e, conf=0.9):
    return types.SimpleNamespace(word=text, start_time=s, end_time=e, confidence=conf)

riva_resp = types.SimpleNamespace(results=[
    types.SimpleNamespace(alternatives=[types.SimpleNamespace(
        transcript="hello there",
        words=[riva_word("hello", 0.0, 0.3), riva_word("there", 0.4, 0.8)],
    )]),
    types.SimpleNamespace(alternatives=[types.SimpleNamespace(
        transcript="", words=[])]),  # non-speech: skipped
])
words = tp.parse_riva_response(riva_resp, offset_s=120.0, duration_s=10.0)
check("riva word count (non-speech skipped)", len(words) == 2, str(words))
check("riva offset applied", words[1]["startMs"] == 120400 and words[1]["endMs"] == 120800)
check("riva confidence", words[0]["confidence"] == 0.9)

riva_no_offsets = types.SimpleNamespace(results=[
    types.SimpleNamespace(alternatives=[types.SimpleNamespace(transcript="a b c d", words=[])]),
    types.SimpleNamespace(alternatives=[types.SimpleNamespace(transcript="e f", words=[])]),
])
words = tp.parse_riva_response(riva_no_offsets, offset_s=0.0, duration_s=12.0)
# two segments split 12s in half; first gets a b c d across 0-6s, second e f 6-12s
check("riva no-offset spread across segment slices",
      len(words) == 6 and words[0]["startMs"] == 0 and words[3]["endMs"] == 6000
      and words[4]["startMs"] == 6000 and words[5]["endMs"] == 12000, str(words))

print("lazy riva import:")
import os
os.environ.pop("NVIDIA_NIM_API_KEY", None)
try:
    result = tp._transcribe_nim("whatever.wav", 0.0)
    check("nim skipped without key (no riva import needed)", result is None)
except ImportError as exc:
    check("nim skipped without key (no riva import needed)", False, f"raised {exc}")

print("provider order:")
_ORIG = (tp._transcribe_deepgram, tp._transcribe_groq, tp._transcribe_nim)
calls = []
def fake_dg(path, off, lang):
    calls.append("deepgram"); return [word("x", 0, 100)], "multi", "nova-3"
def fake_gq(path, off, lang):
    calls.append("groq"); return [word("x", 0, 100)], "en", "turbo"
def fake_nim(path, off, lang):
    calls.append("nim"); return [word("x", 0, 100)], "multi", "riva"
tp._transcribe_deepgram, tp._transcribe_groq, tp._transcribe_nim = fake_dg, fake_gq, fake_nim

os.environ["DEEPGRAM_API_KEY"] = "x"
os.environ["GROQ_API_KEY"] = "x"
calls.clear()
out = tp.transcribe("f.wav", 0.0)
check("default order groq->deepgram", calls == ["groq"], str(calls))

calls.clear()
out = tp.transcribe("f.wav", 0.0, forced_language="hi", prefer_hindi_first=True)
check("hindi-first order deepgram->groq", calls == ["deepgram"], str(calls))
check("forced language replaces multi", out["language"] == "hi")

tp._transcribe_deepgram, tp._transcribe_groq, tp._transcribe_nim = _ORIG
os.environ.pop("GROQ_API_KEY", None)
os.environ.pop("DEEPGRAM_API_KEY", None)
try:
    tp.transcribe("f.wav", 0.0)
    check("all-providers-down raises", False, "no exception")
except RuntimeError:
    check("all-providers-down raises", True)

# ─── prepare_clips snapping ─────────────────────────────────────────────────
print("scene/silence snapping:")
gaps = [(4.0, 5.0)]  # silence midpoint 4.5
scenes = [4.6]
check("silence-only snap preserved", snap(4.2, gaps, "start") == 4.5)
check("both-aligned prefers scene cut", snap_with_scenes(4.2, gaps, scenes, "start") == 4.6)
check("scene cut beyond 0.6s ignored",
      snap_with_scenes(4.2, gaps, [5.3], "start") == 4.5)
check("scene-only fallback when no silence", snap_with_scenes(8.0, [], [8.1], "start") == 8.1)
check("no data leaves timestamp unchanged", snap_with_scenes(8.0, [], [], "start") == 8.0)
check("crashes cleanly with no scene data (graceful path)",
      snap_with_scenes(10.0, [], [7.0, 15.0], "end") == 10.0)

print()
if FAILURES:
    print(f"UNIT_TESTS_FAILED: {len(FAILURES)} -> {FAILURES}")
    sys.exit(1)
print("UNIT_TESTS_OK (all checks passed)")
