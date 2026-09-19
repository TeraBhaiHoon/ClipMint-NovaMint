"""Video briefing — whole-video context for the viral-moments LLM.

Why: the viral step analyses 7,000-char transcript windows independently, so
the model that picks a clip's mood/title has never seen the rest of the video.
This module builds ONE compact briefing (topic, tone, language, audience,
summary, video-level mood prior, keywords) that gets injected into every
viral-detection prompt.

Duration scaling (owner requirement: same quality for 10-min AND 4-hour
videos):
  * transcript <= CAP_SINGLE_CHARS  -> ONE briefing call (fast path);
  * longer                          -> MAP: brief each ~CAP_SINGLE_CHARS
    section independently, then REDUCE: merge the section briefs into one
    video briefing. Every LLM call stays small no matter the duration.

Failure policy: best-effort. On any error the caller proceeds WITHOUT a
briefing (the old behaviour) — context is an upgrade, never a gate.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from llm import ask  # noqa: E402

# ~90k chars ≈ 22–25k tokens: small enough for every provider in the chain,
# large enough that a 10-min video is always a single call.
CAP_SINGLE_CHARS = 90_000
SECTION_OVERLAP_CHARS = 2_000

MOODS = ("energetic", "calm", "corporate", "inspiring")

_BRIEF_SCHEMA = (
    '{"topic": "<what this video is about, one line>", '
    '"tone": "<overall tone, few words>", '
    '"language": "<primary spoken language (e.g. English, Hindi, Hinglish, Spanish)>", '
    '"audience": "<who this video is for, few words>", '
    '"summary": "<3-4 sentence summary of the whole content>", '
    f'"mood_prior": "<one of: {", ".join(MOODS)}>", '
    '"keywords": ["<proper nouns, brand names, recurring themes>", "... 8-12 items"]}'
)

_SYSTEM = (
    "You are a senior short-form content strategist. You analyse full video "
    "transcripts so that clip selection, titles, descriptions and background "
    "music mood can be chosen with full-video context. Return only valid JSON."
)


def _clean_json(text: str) -> dict:
    """Parse the model's reply, tolerating code fences and prose wrappers."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    else:
        brace = re.search(r"\{.*\}", text, re.DOTALL)
        if brace:
            text = brace.group(0)
    return json.loads(text)


def _meta_block(meta: dict | None) -> str:
    if not meta:
        return ""
    parts = []
    if meta.get("title"):
        parts.append(f"- Video title: {meta['title']}")
    if meta.get("uploader"):
        parts.append(f"- Channel/uploader: {meta['uploader']}")
    if meta.get("description"):
        parts.append(f"- Creator's description: {meta['description'][:800]}")
    if meta.get("tags"):
        parts.append(f"- Creator's tags: {', '.join(meta['tags'][:25])}")
    return "\n".join(parts)


def _brief_prompt(transcript_text: str, meta: dict | None, section_note: str = "") -> str:
    return (
        f"{section_note}Analyse this video transcript and return JSON with exactly this shape:\n"
        f"{_BRIEF_SCHEMA}\n\n"
        "Rules: base everything on the actual content — never invent. The "
        "'language' field must be the language the PEOPLE ARE SPEAKING, and "
        "'keywords' must keep names and terms exactly as spoken. The mood "
        "prior describes the OVERALL feel of the content (used to choose "
        "background music for its clips).\n\n"
        f"{_meta_block(meta)}\n\n"
        "TRANSCRIPT:\n"
        f"{transcript_text}"
    )


def _merge_prompt(briefs: list[dict], meta: dict | None, truncated: bool = False) -> str:
    payload = json.dumps(briefs, ensure_ascii=False, indent=1)
    note = ""
    if truncated:
        # The transcript was cut at max_sections for cost. Say so: an honest
        # briefing ("the first N sections are summarised") beats one that
        # claims whole-video coverage it never saw and lets the model invent
        # later content.
        note = (
            "IMPORTANT: this video is longer than the analysed window. The "
            "section analyses below cover ONLY the first portion of the video. "
            "State this limitation plainly in the summary and describe only "
            "the content you actually saw — never fabricate later parts.\n\n"
        )
    return (
        f"You are given {len(briefs)} section analyses of ONE long video. "
        "Merge them into a single whole-video briefing. Return JSON with "
        "exactly this shape:\n"
        f"{_BRIEF_SCHEMA}\n\n"
        "Rules: the summary must cover the WHOLE video (beginning to end), "
        "keywords union the sections, mood_prior reflects the dominant overall "
        "feel, language is the dominant spoken language.\n\n"
        f"{note}"
        f"{_meta_block(meta)}\n\n"
        "SECTION ANALYSES:\n"
        f"{payload}"
    )


def _normalise(brief: dict) -> dict:
    mood = str(brief.get("mood_prior") or "").strip().lower()
    if mood not in MOODS:
        mood = ""
    return {
        "topic": str(brief.get("topic") or "")[:300],
        "tone": str(brief.get("tone") or "")[:200],
        "language": str(brief.get("language") or "")[:60],
        "audience": str(brief.get("audience") or "")[:200],
        "summary": str(brief.get("summary") or "")[:1500],
        "mood_prior": mood,
        "keywords": [str(k)[:80] for k in (brief.get("keywords") or [])][:12],
    }


def _split_sections(text: str) -> list[str]:
    step = CAP_SINGLE_CHARS - SECTION_OVERLAP_CHARS
    sections = []
    for start in range(0, len(text), step):
        chunk = text[start:start + CAP_SINGLE_CHARS]
        if len(chunk.strip()) > 200:
            sections.append(chunk)
    return sections


def build_briefing(
    words: list[dict],
    meta: dict | None,
    max_sections: int = 8,
) -> dict | None:
    """Build the whole-video briefing. Returns None on any failure.

    `words` is the canonical transcript (text/startMs/endMs dicts). Long
    transcripts are sectioned and merged so no single call ever exceeds
    CAP_SINGLE_CHARS, whatever the video length.
    """
    try:
        text = " ".join((w.get("text") or "").strip() for w in words if w.get("text"))
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) < 200:
            return None

        meta_block = _meta_block(meta)
        if len(text) <= CAP_SINGLE_CHARS:
            prompt = _brief_prompt(text, meta)
            raw = ask(prompt, system=_SYSTEM, is_json=True, max_tokens=900)
            brief = _normalise(_clean_json(raw))
            brief["sections_analysed"] = 1
            return brief

        sections = _split_sections(text)
        total_sections = len(sections)
        truncated = total_sections > max_sections
        sections = sections[:max_sections]
        briefs: list[dict] = []
        for i, section in enumerate(sections, 1):
            note = (
                f"This is SECTION {i} of {total_sections} of a long video's "
                "transcript. Analyse only this section; a later step merges "
                "the sections into one whole-video briefing.\n\n"
            )
            raw = ask(_brief_prompt(section, meta, note), system=_SYSTEM, is_json=True, max_tokens=700)
            briefs.append(_normalise(_clean_json(raw)))
        if not briefs:
            return None

        merged = _normalise(_clean_json(ask(
            _merge_prompt(briefs, meta, truncated=truncated),
            system=_SYSTEM, is_json=True, max_tokens=900,
        )))
        merged["sections_analysed"] = len(sections)
        merged["sections_total"] = total_sections
        return merged
    except Exception as exc:  # noqa: BLE001 — briefing must never gate the pipeline
        print(f"briefing: failed ({exc}) — continuing without video context", file=sys.stderr)
        return None


def context_block(brief: dict | None, meta: dict | None) -> str:
    """Render briefing + source metadata as a prompt prefix. '' when absent."""
    lines: list[str] = []
    meta_lines = _meta_block(meta)
    if meta_lines:
        lines.append(meta_lines)
    if brief:
        lines.append(
            "- Overall topic: " + (brief.get("topic") or "n/a")
            + "\n- Tone: " + (brief.get("tone") or "n/a")
            + "\n- Spoken language: " + (brief.get("language") or "n/a")
            + "\n- Audience: " + (brief.get("audience") or "n/a")
            + "\n- Whole-video summary: " + (brief.get("summary") or "n/a")
            + "\n- Video-level mood prior: " + (brief.get("mood_prior") or "n/a")
            + "\n- Keywords/names: " + ", ".join(brief.get("keywords") or [])
        )
    if not lines:
        return ""
    return (
        "\n\nSOURCE VIDEO CONTEXT (from the full transcript and the creator's "
        "own metadata — use it to frame EVERY judgement below: language, "
        "names, topic framing, mood):\n" + "\n".join(lines)
    )


def main() -> int:
    """CLI: build the briefing from workspace files (used by tests/debug)."""
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--captions", required=True)
    ap.add_argument("--metadata", default="")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    words = json.loads(Path(args.captions).read_text())
    meta = None
    if args.metadata and Path(args.metadata).exists():
        meta = json.loads(Path(args.metadata).read_text())
    brief = build_briefing(words, meta)
    if brief is None:
        print("BRIEFING_FAILED (empty or error)")
        return 1
    Path(args.out).write_text(json.dumps(brief, indent=1, ensure_ascii=False))
    print(f"BRIEFING_OK sections={brief.get('sections_analysed')} mood={brief.get('mood_prior')!r} "
          f"language={brief.get('language')!r} keywords={len(brief.get('keywords') or [])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
