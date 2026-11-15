#!/usr/bin/env python3
"""Measure ASR errors against an independent reference, never provider confidence.

Reference JSON: {"source": "human-reviewed|creator-transcript", "text": "..."}.
Hypothesis JSON: Caption[] or {"text": "..."}. Both files remain local.

Run: python scripts/measure_transcription_accuracy.py --reference ref.json
     --hypothesis clip_000.captions.json --output report.json
"""
from __future__ import annotations

import argparse
import json
import unicodedata
from pathlib import Path


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).casefold()
    # Keep Devanagari vowel signs and conjuncts: they are meaningful, not noise.
    return " ".join("".join(
        " " if unicodedata.category(char)[0] in ("P", "S") else char
        for char in text
    ).split())


def edit_counts(reference: list[str], hypothesis: list[str]) -> dict[str, int]:
    # Each cell carries substitutions/deletions/insertions so the final result
    # includes diagnostic counts rather than an opaque similarity percentage.
    previous = [(0, 0, i) for i in range(len(hypothesis) + 1)]
    for index, ref in enumerate(reference, 1):
        current = [(0, index, 0)]
        for j, hyp in enumerate(hypothesis, 1):
            if ref == hyp:
                current.append(previous[j - 1])
                continue
            s, d, i = previous[j - 1]
            substitution = (s + 1, d, i)
            s, d, i = previous[j]
            deletion = (s, d + 1, i)
            s, d, i = current[j - 1]
            insertion = (s, d, i + 1)
            current.append(min((substitution, deletion, insertion), key=sum))
        previous = current
    s, d, i = previous[-1]
    return {"substitutions": s, "deletions": d, "insertions": i, "errors": s + d + i}


def measure(reference: str, hypothesis: str) -> dict:
    ref, hyp = normalize(reference), normalize(hypothesis)
    words = ref.split()
    if not words:
        raise ValueError("Independent reference must contain speech words")
    word_counts = edit_counts(words, hyp.split())
    ref_chars = [char for char in ref if not char.isspace()]
    hyp_chars = [char for char in hyp if not char.isspace()]
    char_counts = edit_counts(ref_chars, hyp_chars)
    return {
        "reference_words": len(words), "hypothesis_words": len(hyp.split()),
        "word_errors": word_counts, "wer": word_counts["errors"] / len(words),
        "reference_characters": len(ref_chars), "character_errors": char_counts,
        "cer": char_counts["errors"] / len(ref_chars),
        "normalization": "NFKC, casefold, punctuation/symbols removed, whitespace collapsed; no transliteration",
        "scope": "This reference segment only; not whole-product accuracy",
    }


def load_hypothesis(data) -> str:
    if isinstance(data, list):
        if any(not isinstance(word, dict) or not isinstance(word.get("text"), str) for word in data):
            raise ValueError("Hypothesis captions must have string text fields")
        return " ".join(word["text"] for word in data)
    if isinstance(data, dict) and isinstance(data.get("text"), str):
        return data["text"]
    raise ValueError("Hypothesis must be Caption[] or an object with text")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--hypothesis", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    reference = json.loads(args.reference.read_text(encoding="utf-8"))
    if not isinstance(reference, dict) or reference.get("source") not in ("human-reviewed", "creator-transcript"):
        raise ValueError("Reference must identify an independently reviewed human or creator transcript; ASR is not ground truth")
    if not isinstance(reference.get("text"), str):
        raise ValueError("Reference text is required")
    hypothesis = load_hypothesis(json.loads(args.hypothesis.read_text(encoding="utf-8")))
    report = {"reference_source": reference["source"], **measure(reference["text"], hypothesis)}
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
