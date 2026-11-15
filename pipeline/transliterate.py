#!/usr/bin/env python3
"""Bounded Hindi romanisation; original captions survive provider outages."""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Callable

DEVANAGARI = re.compile(r"[\u0900-\u097F]")


def romanise(captions: list[dict], ask: Callable, *, budget_seconds: float = 180,
             batch_size: int = 60, clock: Callable = time.monotonic) -> dict:
    started = clock()
    # Repeated words should not trigger another network request. Context comes
    # from the first occurrence; all timings and non-target text stay unchanged.
    unique: dict[str, str] = {}
    for index, caption in enumerate(captions):
        text = caption.get("text", "")
        if isinstance(text, str) and DEVANAGARI.search(text) and text not in unique:
            unique[text] = " ".join(str(item.get("text", "")) for item in captions[max(0, index - 2):index + 3])
    targets = list(unique)
    converted: dict[str, str] = {}
    failed = 0
    for start in range(0, len(targets), batch_size):
        remaining = budget_seconds - (clock() - started)
        if remaining < 5:
            print("TRANSLITERATE_BUDGET: retaining remaining original-script words")
            break
        group = targets[start:start + batch_size]
        entries = [{"word": word, "context": unique[word]} for word in group]
        prompt = (
            "Romanise these Hindi words into natural Hinglish. Do not translate "
            "their meaning into English. Return ONLY JSON {\"words\": [...]} "
            "with exactly one nonempty Latin-script string per input, in order.\n"
            + json.dumps(entries, ensure_ascii=False)
        )
        try:
            content = ask(prompt, system="Romanise Hindi; preserve meaning. Return JSON only.",
                          order="groq,nim", is_json=True, max_tokens=2000,
                          timeout_s=min(30, remaining), budget_s=min(45, remaining), max_attempts=1)
            parsed = json.loads(content)
            values = parsed.get("words") if isinstance(parsed, dict) else parsed
            if not isinstance(values, list) or len(values) != len(group):
                raise ValueError("word count mismatch")
            if any(not isinstance(word, str) or not word.strip() or DEVANAGARI.search(word)
                   for word in values):
                raise ValueError("invalid romanised word")
            converted.update(zip(group, [word.strip() for word in values]))
            print(f"transliterate: batch {start // batch_size + 1} ok ({len(group)} unique words)")
        except RuntimeError:
            # A full provider outage is not a reason to retry every remaining
            # batch. Devanagari is supported by the caption renderer's font.
            failed += 1
            print("TRANSLITERATE_UNAVAILABLE: preserving original-script captions")
            break
        except (ValueError, TypeError):
            failed += 1
            print("TRANSLITERATE_INVALID: preserving this batch without another provider loop")
    count = 0
    for caption in captions:
        text = caption.get("text")
        if text in converted:
            caption["text"] = converted[text]
            count += 1
    return {"unique_words": len(targets), "converted_words": count,
            "remaining_devanagari": sum(bool(DEVANAGARI.search(str(c.get("text", "")))) for c in captions),
            "failed_batches": failed}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("captions", type=Path)
    parser.add_argument("--budget-seconds", type=float, default=180)
    args = parser.parse_args()
    from llm import ask
    captions = json.loads(args.captions.read_text(encoding="utf-8"))
    if not isinstance(captions, list):
        raise SystemExit("Invalid captions file")
    result = romanise(captions, ask, budget_seconds=args.budget_seconds)
    temporary = args.captions.with_suffix(".tmp")
    temporary.write_text(json.dumps(captions, ensure_ascii=False), encoding="utf-8")
    temporary.replace(args.captions)
    print("TRANSLITERATE_RESULT " + json.dumps(result))


if __name__ == "__main__":
    main()
