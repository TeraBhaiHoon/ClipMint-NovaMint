#!/usr/bin/env python3
"""
ClipMint pipeline — caption output-language conversion.

Two modes, both opt-in (the workflow never converts unless the job asked;
`original` — the default — touches nothing):

  hinglish  word-level Devanagari → Hinglish romanisation. Delegates to
            pipeline/transliterate.py (unique-word batching, budget, and the
            preserve-original-on-outage contract).

  english   phrase-level translation of per-clip caption files. Phrases are
            contiguous sentence/gap-bounded word runs; each translated phrase
            is split back across the SAME time span (proportional to the
            original word durations, last token clamped to the phrase end),
            so timings stay monotonic and coverage is preserved by
            construction. Words are NEVER translated one-by-one — unique-word
            translation destroys grammar — the unit is a phrase and the LLM
            returns one English sentence per phrase.

Honesty contract — FAIL-CLOSED on an explicitly requested output language:
if Hinglish or English cannot be fully produced (provider outage, exhausted
budget, invalid replies), the job FAILS with a clear CONVERSION_UNAVAILABLE
marker and the RAW captions + checkpoint stay intact for a retry — captions
are never silently delivered in the wrong (or mixed) language. Every run
persists a conversion report: per-clip `clip_XXX.conversion.json` beside the
captions and a `conversion` section merged into `transcription_meta.json`
(language, language_source, per-chunk evidence and conversion warnings for
the dashboard). `--warn-only` is the explicit opt-out that delivers with the
persisted warning instead of failing.

A source already identified as English (per detected_language.txt) with no
Devanagari present is skipped without an LLM call.

Clip-level English conversion (clip_XXX.captions.json files, after prepare)
bounds the cost to clips that will actually ship.

CLI:
    python3 pipeline/caption_language.py hinglish \
        --captions workspace/audio/full_captions.json \
        --meta-file workspace/audio/transcription_meta.json --budget-seconds 180
    python3 pipeline/caption_language.py english \
        --clipsdir workspace/clips \
        --source-language-file workspace/audio/detected_language.txt \
        --meta-file workspace/audio/transcription_meta.json --budget-seconds 240
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))

DEVANAGARI = re.compile(r"[\u0900-\u097F]")

MAX_PHRASE_WORDS = 18
MAX_PHRASE_CHARS = 90
MAX_PHRASE_GAP_MS = 1200
PHRASE_BATCH = 10
# Latin-script sentence enders AND Devanagari danda / double danda.
SENTENCE_ENDS = ".!?…।॥"
# A translation may expand to at most this multiple of its source length
# (or 200 chars for very short phrases) — more is model runaway, not prose.
MAX_EXPANSION = 4
MIN_LATIN_RATIO = 0.4


def convert_hinglish(captions: list[dict], ask: Callable, **options) -> dict:
    """Word-level romanisation via the bounded transliterate module."""
    from transliterate import romanise
    return romanise(captions, ask, **options)


def group_phrases(captions: list[dict]) -> list[tuple[int, int]]:
    """Contiguous [start, end) index ranges closing on gaps, sentence ends and
    word/char caps. The ranges tile the word list in order, so translating
    phrase-by-phrase can never reorder the timeline."""
    if not captions:
        return []
    phrases: list[tuple[int, int]] = []
    start = 0
    chars = len((captions[0].get("text") or "").strip()) + 1
    for i in range(1, len(captions)):
        prev = captions[i - 1]
        cur = captions[i]
        gap = cur.get("startMs", 0) - prev.get("endMs", prev.get("startMs", 0))
        ends_sentence = (prev.get("text") or "").strip()[-1:] in SENTENCE_ENDS
        cur_chars = len((cur.get("text") or "").strip()) + 1
        if (gap > MAX_PHRASE_GAP_MS or ends_sentence
                or (i - start) >= MAX_PHRASE_WORDS
                or chars + cur_chars > MAX_PHRASE_CHARS):
            phrases.append((start, i))
            start = i
            chars = cur_chars
        else:
            chars += cur_chars
    phrases.append((start, len(captions)))
    return phrases


def phrase_text(captions: list[dict], start: int, end: int) -> str:
    return " ".join((captions[i].get("text") or "").strip()
                    for i in range(start, end)).strip()


def translate_phrases(
    phrases: list[tuple[int, int]],
    captions: list[dict],
    ask: Callable,
    *,
    deadline: float,
    batch_size: int = PHRASE_BATCH,
    clock: Callable = time.monotonic,
) -> dict[int, str]:
    """Translate phrase batches → {phrase_index: english text}.

    A failed batch keeps its phrases in the source language; the loop never
    re-runs a provider chain per phrase, and the shared deadline bounds the
    whole conversion regardless of clip count.
    """
    converted: dict[int, str] = {}
    indexed = list(enumerate(phrases))
    for start_at in range(0, len(indexed), batch_size):
        remaining = deadline - clock()
        if remaining < 5:
            print("CONVERSION_PARTIAL: budget exhausted — remaining phrases "
                  "keep the source language")
            break
        batch = indexed[start_at:start_at + batch_size]
        entries = [{"index": idx, "text": phrase_text(captions, a, b)}
                   for idx, (a, b) in batch]
        prompt = (
            "Translate each transcript phrase into natural spoken English. "
            "Keep person names and brand names as spoken. Do not add "
            "commentary. Return ONLY JSON {\"phrases\": [...]} with exactly "
            "one nonempty English sentence per input, in order.\n"
            + json.dumps(entries, ensure_ascii=False)
        )
        try:
            content = ask(
                prompt,
                system="Translate speech phrases to English; preserve meaning. "
                       "Return JSON only.",
                order="groq,nim", is_json=True, max_tokens=2000,
                timeout_s=min(30, remaining), budget_s=min(60, remaining),
                max_attempts=1,
            )
            parsed = json.loads(content)
            values = parsed.get("phrases") if isinstance(parsed, dict) else parsed
            if not isinstance(values, list) or len(values) != len(batch):
                raise ValueError("phrase count mismatch")
            for (idx, (a, b)), value in zip(batch, values):
                # Strict typing: str(None)/str(dict) used to slip through as
                # "translations" and silently corrupt a phrase.
                if not isinstance(value, str):
                    raise ValueError("non-string translation")
                text = " ".join(value.split())
                if not text or DEVANAGARI.search(text):
                    raise ValueError("invalid translation")
                source_text = phrase_text(captions, a, b)
                # Expansion cap: a translation many times its source length is
                # model runaway, not prose.
                if len(text) > max(MAX_EXPANSION * len(source_text), 200):
                    raise ValueError("excessive expansion")
                # Target-script check: English output must be overwhelmingly
                # Latin — also catches Cyrillic/CJK hallucinations that pass
                # the Devanagari check.
                non_space = text.replace(" ", "")
                latin = len(re.findall(r"[A-Za-z]", non_space))
                if non_space and latin / len(non_space) < MIN_LATIN_RATIO:
                    raise ValueError("non-Latin target")
                converted[idx] = text
        except RuntimeError:
            print("CONVERSION_UNAVAILABLE: providers down — remaining phrases "
                  "keep the source language")
            break
        except (ValueError, TypeError):
            print("CONVERSION_BATCH_INVALID: this batch keeps the source language")
    return converted


def apply_phrase_translation(
    captions: list[dict],
    phrases: list[tuple[int, int]],
    converted: dict[int, str],
) -> list[dict]:
    """Rebuild captions: a translated phrase's word entries become token
    entries that tile the SAME [startMs, endMs] span exactly.

    The source rhythm (per-source-word durations) is RESAMPLED onto the
    translated token count: token boundaries are the source-time fractions
    j/m mapped through the source cumulative-duration curve. The previous
    version indexed source weights by translated-token index — with more
    translated tokens than source words the cursor overshot end_ms and the
    final token ran backwards / past the phrase end. Now widths always sum
    to the span, every start/end stays inside it, and the last token ends
    exactly at end_ms; no minimum-duration floor may extend the span.
    Untranslated phrases pass through untouched."""
    out: list[dict] = []
    for p_idx, (a, b) in enumerate(phrases):
        text = converted.get(p_idx)
        if not text:
            out.extend(captions[a:b])
            continue
        start_ms = int(captions[a].get("startMs", 0))
        end_ms = max(int(captions[b - 1].get("endMs", start_ms + 200)), start_ms + 1)
        span = end_ms - start_ms
        durations = [
            max(1, int(c.get("endMs", c.get("startMs", 0))) - int(c.get("startMs", 0)))
            for c in captions[a:b]
        ]
        total = sum(durations)
        # Absolute phrase-time at each source-word boundary (n+1 points,
        # start_ms .. end_ms — strictly covering the span).
        bounds, acc = [start_ms], 0
        for d in durations[:-1]:
            acc += d
            bounds.append(start_ms + span * acc // total)
        bounds.append(end_ms)

        def _at(fraction: float) -> int:
            """Absolute ms for source-time fraction in [0, 1] (piecewise
            constant density across the source words)."""
            pos = min(int(fraction * len(durations)), len(durations) - 1)
            lo, hi = bounds[pos], bounds[pos + 1]
            within = fraction * len(durations) - pos
            return int(round(lo + (hi - lo) * within))

        tokens = text.split()
        count = len(tokens)
        prev = start_ms
        for j, token in enumerate(tokens):
            if j == count - 1:
                tok_end = end_ms                       # exact close, no drift
            else:
                tok_end = _at((j + 1) / count)
                # Keep tokens ordered, positive and inside the span, always
                # leaving room for the tokens that follow.
                tok_end = min(max(tok_end, prev + 1), end_ms - (count - 1 - j))
            out.append({
                "text": token,
                "startMs": min(prev, end_ms - 1),
                "endMs": min(max(prev + 1, tok_end), end_ms),
                "timestampMs": None,
                "confidence": None,
            })
            prev = out[-1]["endMs"]
    return out


def convert_captions_english(
    captions: list[dict],
    ask: Callable,
    *,
    deadline: float,
    source_is_english: bool = False,
    clock: Callable = time.monotonic,
) -> tuple[list[dict], dict]:
    """English conversion for one caption list. Returns (captions, status).

    `source_is_english` is the PROVEN-source decision made upstream (explicit
    en hint, or every chunk reported en) — never a single noisy detection."""
    if not captions:
        return captions, {"mode": "english", "action": "skipped_empty"}
    devanagari_words = sum(1 for c in captions
                           if DEVANAGARI.search(str(c.get("text", ""))))
    if source_is_english and devanagari_words == 0:
        print("CONVERT: source proven English and no Devanagari — skipping")
        return captions, {"mode": "english", "action": "skipped_source_english",
                          "words": len(captions)}
    phrases = group_phrases(captions)
    if not phrases:
        return captions, {"mode": "english", "action": "skipped_empty"}
    converted = translate_phrases(phrases, captions, ask, deadline=deadline,
                                  clock=clock)
    new_captions = apply_phrase_translation(captions, phrases, converted)
    from validate_captions import repair_overlaps
    new_captions, _repaired = repair_overlaps(new_captions)
    status = {
        "mode": "english",
        "action": "converted" if converted else "fallback_source_language",
        "phrases_total": len(phrases),
        "phrases_converted": len(converted),
        "phrases_fallback": len(phrases) - len(converted),
    }
    if converted and len(converted) < len(phrases):
        print(f"CONVERSION_PARTIAL: {len(converted)}/{len(phrases)} phrases "
              "translated; the rest keep the source language")
    if not converted:
        print("CONVERSION_FALLBACK: captions stay in the source language — "
              "explicit fallback, not a silent wrong-language delivery")
    return new_captions, status


# ---------------------------------------------------------------------------
# Job-level runners: persisted reports + fail-closed policy
# ---------------------------------------------------------------------------
def _clip_satisfied(status: dict) -> bool:
    """A clip satisfies the requested output language only when EVERY phrase
    was converted (or there was nothing to convert). A partial conversion is
    mixed-language output — it does NOT satisfy an explicit request."""
    if status.get("action") == "converted":
        return status.get("phrases_fallback", 0) == 0
    return status.get("action") in ("skipped_source_english", "skipped_empty")


def _read_meta(meta_path) -> dict:
    path = Path(meta_path)
    try:
        meta = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    except (OSError, ValueError):
        meta = {}
    return meta if isinstance(meta, dict) else {}


def _source_proven_english(meta: dict) -> bool:
    """True only when the job PROVED the source is English: an explicit en
    hint, or every chunk reported en. Mixed detection (majority en with later
    hi chunks) and undetermined sources must attempt conversion — the
    per-clip Devanagari check alone misses romanised Hindi."""
    language = str(meta.get("language") or "").strip().lower()
    language_source = str(meta.get("language_source") or "").strip().lower()
    if language_source == "user-hint" and language == "en":
        return True
    chunks = [c for c in (meta.get("chunks") or []) if isinstance(c, dict)]
    return bool(chunks) and all(
        str(c.get("language") or "").strip().lower() == "en" for c in chunks)


def update_meta(meta_path, summary: dict) -> None:
    """Merge a conversion summary into transcription_meta.json (best-effort).

    The dashboard reads `transcription_meta.conversion` for the per-job
    language/conversion warnings; the transcription sections (language,
    language_source, per-chunk evidence) are preserved untouched.
    """
    meta = _read_meta(meta_path)
    meta["conversion"] = summary
    try:
        path = Path(meta_path)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(meta, indent=2, ensure_ascii=False),
                             encoding="utf-8")
        temporary.replace(path)
    except OSError as exc:
        print(f"  ! conversion meta update failed (non-fatal): {exc}")


def run_hinglish_conversion(captions_path, meta_path, ask, *,
                            budget_seconds: float,
                            warn_only: bool = False) -> int:
    """Hinglish output for the whole transcript, FAIL-CLOSED: leftover
    Devanagari means the requested output cannot be delivered, so the job
    fails with a clear marker and the RAW captions/checkpoint stay intact for
    a retry. Returns a process exit code."""
    captions = json.loads(Path(captions_path).read_text(encoding="utf-8"))
    result = convert_hinglish(captions, ask, budget_seconds=budget_seconds)
    remaining = int(result.get("remaining_devanagari") or 0)
    satisfied = remaining == 0
    summary = {
        "mode": "hinglish", "requested": True, "satisfied": satisfied,
        "warnings": ([] if satisfied else
                     [f"{remaining} caption word(s) could not be romanised"]),
        "result": result,
    }
    update_meta(meta_path, summary)
    print("CONVERT_RESULT " + json.dumps(summary, ensure_ascii=False))
    if satisfied:
        # Persist the romanised captions (romanise mutated the list in place).
        # On failure the file on disk keeps the RAW text for the retry.
        temporary = Path(captions_path).with_suffix(".tmp")
        temporary.write_text(json.dumps(captions, ensure_ascii=False),
                             encoding="utf-8")
        temporary.replace(captions_path)
    if satisfied or warn_only:
        return 0
    print("CONVERSION_UNAVAILABLE: requested Hinglish output could not be fully "
          "produced — failing closed. RAW captions and the checkpoint are "
          "preserved; retry to re-convert.")
    return 1


def run_english_conversion(clipsdir, meta_path, ask, *, budget_seconds: float,
                           warn_only: bool = False,
                           clock: Callable = time.monotonic) -> int:
    """Clip-level English output, FAIL-CLOSED: any clip left partially in the
    source language fails the job with a clear marker (RAW captions and the
    checkpoint are preserved for retry) — never a silent mixed-language
    delivery. Per-clip reports land next to the captions; the summary merges
    into transcription_meta.json for the dashboard. Returns an exit code."""
    clipsdir = Path(clipsdir)
    meta = _read_meta(meta_path)
    source_is_english = _source_proven_english(meta)
    deadline = clock() + max(5.0, budget_seconds)
    statuses: list[dict] = []
    warnings: list[str] = []
    for path in sorted(clipsdir.glob("clip_*.captions.json")):
        captions = json.loads(path.read_text(encoding="utf-8"))
        new_captions, status = convert_captions_english(
            captions, ask, deadline=deadline, source_is_english=source_is_english,
            clock=clock)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(new_captions, ensure_ascii=False),
                             encoding="utf-8")
        temporary.replace(path)
        statuses.append({"clip": path.name, **status})
        # Per-clip conversion report, persisted beside the captions file.
        report = path.with_name(path.stem.replace(".captions", "") + ".conversion.json")
        report.write_text(json.dumps(status, ensure_ascii=False, indent=2),
                          encoding="utf-8")
        print(f"CONVERT {path.name}: {status['action']} "
              f"phrases={status.get('phrases_converted', 0)}/"
              f"{status.get('phrases_total', 0)}")
        if status.get("phrases_fallback"):
            warnings.append(
                f"{path.name}: {status['phrases_fallback']}/"
                f"{status['phrases_total']} phrases kept the source language")

    satisfied = bool(statuses) and all(_clip_satisfied(s) for s in statuses)
    summary = {"mode": "english", "requested": True, "satisfied": satisfied,
               "source_proven_english": source_is_english,
               "recorded_source_language": str(meta.get("language") or "und"),
               "warnings": warnings, "clips": statuses}
    update_meta(meta_path, summary)
    print("CONVERT_RESULT " + json.dumps(summary, ensure_ascii=False))
    if satisfied or warn_only:
        return 0
    print("CONVERSION_UNAVAILABLE: requested English output could not be fully "
          "produced — failing closed. RAW captions and the checkpoint are "
          "preserved; retry to re-convert.")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)

    p = sub.add_parser("hinglish", help="word-level Devanagari → Hinglish")
    p.add_argument("--captions", type=Path, required=True)
    p.add_argument("--meta-file", type=Path, required=True,
                   help="transcription_meta.json to merge the report into")
    p.add_argument("--budget-seconds", type=float, default=180)
    p.add_argument("--warn-only", action="store_true",
                   help="deliver with a persisted warning instead of failing")

    p = sub.add_parser("english", help="clip-level phrase translation")
    p.add_argument("--clipsdir", type=Path, required=True)
    p.add_argument("--source-language-file", type=Path, default=None,
                   help="detected_language.txt from the transcription step")
    p.add_argument("--meta-file", type=Path, required=True,
                   help="transcription_meta.json to merge the report into")
    p.add_argument("--budget-seconds", type=float, default=240,
                   help="total LLM budget across ALL clips")
    p.add_argument("--warn-only", action="store_true",
                   help="deliver with a persisted warning instead of failing")
    args = parser.parse_args()

    from llm import ask  # bounded provider chain (lazy: imports without keys)

    if args.mode == "hinglish":
        return run_hinglish_conversion(args.captions, args.meta_file, ask,
                                       budget_seconds=args.budget_seconds,
                                       warn_only=args.warn_only)

    source_language = ""
    if args.source_language_file and args.source_language_file.is_file():
        source_language = args.source_language_file.read_text(
            encoding="utf-8").strip().lower()
    return run_english_conversion(args.clipsdir, args.meta_file, ask,
                                  budget_seconds=args.budget_seconds,
                                  source_language=source_language,
                                  warn_only=args.warn_only)


if __name__ == "__main__":
    raise SystemExit(main())
