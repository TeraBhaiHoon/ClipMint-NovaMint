#!/usr/bin/env python3
"""
ClipMint pipeline — speech-to-text with independent provider fallback.

The transcription step was Groq-only: a Groq outage or a rate-limited account
killed every job at the same stage. This module spreads the risk across three
independent providers and returns ONE canonical shape, so the workflow never
has to know which provider answered:

    Provider order:
      prefer_hindi_first=False  →  Groq → Deepgram → NIM
      prefer_hindi_first=True   →  Deepgram → Groq → NIM
    (Deepgram nova-3 handles code-switched Hindi markedly better, so when the
    language already locked to `hi` it goes first; NIM/Riva is last because
    NVIDIA trial terms may record submitted audio.)

    transcribe(wav_path, segment_offset_sec, forced_language, prefer_hindi_first)
      → {"words": Caption[], "language": "<code>", "provider": "<name>", "model": "<id>"}

    Caption (canonical, matches the renderer's expectation):
      {"text": str, "startMs": int, "endMs": int, "timestampMs": None, "confidence": float|None}

Per provider: 3 attempts with exponential backoff on 429 / 5xx / timeouts.
A provider without its API key is skipped with a log line, never an error.
If every provider fails, `transcribe` raises RuntimeError — the workflow turns
that into a named `transcribe` stage failure.

This module handles exactly ONE audio chunk (the >24 MB chunk splitting, the
hallucination filter and the cross-chunk language lock stay in the workflow,
which passes this module the chunk's absolute offset in seconds).

Providers
---------
Groq      POST /openai/v1/audio/transcriptions, verbose_json + word
          granularity, models whisper-large-v3 → whisper-large-v3-turbo
          (accuracy first; turbo is the cheaper fallback).
Deepgram  POST /v1/listen?model=nova-3&language=multi&smart_format=true with
          the raw WAV bytes as the body (Content-Type: audio/wav). Words carry
          second-float start/end and are returned by default.
NIM       gRPC Riva (pip `nvidia-riva-client`, imported lazily so the module
          works without it until this provider is actually reached):
          grpc.nvcf.nvidia.com:443, function-id
          b702f636-f60c-4a3d-a6f4-f3568c13bd7d, model family
          openai/whisper-large-v3, 16 kHz mono 16-bit WAV required.

When a provider returns a transcript but no per-word timings, words are spread
evenly across the segment window (same policy the workflow used before) so
downstream caption paging still works.
"""

from __future__ import annotations

import math
import os
import re
import time
import wave

import requests

# ── Provider endpoints / constants ──────────────────────────────────────────
GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
# Preferred model first, turbo is the cheaper fallback (relative quality on
# Hindi/Hinglish is measured per job's golden set, not claimed here).
GROQ_MODELS = ["whisper-large-v3", "whisper-large-v3-turbo"]

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
# keyterm must be REPEATED query params (Deepgram API shape), hence tuples.
DEEPGRAM_PARAMS: list[tuple[str, str]] = [
    ("model", "nova-3"),
    ("language", "multi"),
    ("smart_format", "true"),
    ("keyterm", "podcast"),
    ("keyterm", "vlog"),
    ("keyterm", "reels"),
    ("keyterm", "shorts"),
    ("keyterm", "youtube"),
]

NIM_URI = "grpc.nvcf.nvidia.com:443"
NIM_FUNCTION_ID = "b702f636-f60c-4a3d-a6f4-f3568c13bd7d"
NIM_LANGUAGE = "multi"

ATTEMPTS_PER_PROVIDER = 3


def _word(text: str, start_s: float, end_s: float, offset_s: float, confidence) -> dict:
    """One canonical Caption entry from provider-second timings + chunk offset."""
    return {
        "text": (text or "").strip(),
        "startMs": int(round((start_s + offset_s) * 1000)),
        "endMs": int(round((end_s + offset_s) * 1000)),
        "timestampMs": None,
        "confidence": confidence,
    }


def _spread_words(text: str, start_s: float, end_s: float, offset_s: float) -> list[dict]:
    """Spread a transcript's words evenly across a known window.

    Used when a provider returns text but no per-word timings. Even spacing is
    approximate; that is still far better for caption paging than no words.
    """
    tokens = (text or "").split()
    if not tokens or end_s <= start_s:
        return []
    span = (end_s - start_s) / len(tokens)
    return [
        _word(tok, start_s + i * span, start_s + (i + 1) * span, offset_s, None)
        for i, tok in enumerate(tokens)
    ]


def wav_duration_sec(path: str) -> float:
    """Duration of a WAV via its header (fallback spreading needs a window)."""
    try:
        with wave.open(path, "rb") as fh:
            frames = fh.getnframes()
            rate = fh.getframerate() or 1
            return frames / float(rate)
    except Exception:  # noqa: BLE001 — header unreadable: no spreading possible
        return 0.0


PROMPT_BASE = (
    "Transcribe in the original spoken language and native script; "
    "do NOT translate. Preserve English words when the speaker code-switches."
)
# The whole metadata context is a HINT: bounded in characters, never a
# second transcript.
CONTEXT_CHAR_BUDGET = 300


def build_prompt(context: dict | None) -> str:
    """Base prompt + bounded creator metadata (title ≤120 chars, ≤12 tags of
    ≤24 chars, whole context ≤ CONTEXT_CHAR_BUDGET characters)."""
    parts = [PROMPT_BASE]
    if context:
        title = str(context.get("title") or "").strip()[:120]
        tags = [str(t).strip()[:24] for t in (context.get("tags") or [])[:12]
                if str(t).strip()]
        context_text = ""
        if title:
            context_text += f"Video title: {title}. "
        if tags:
            context_text += "Topics: " + ", ".join(tags) + "."
        parts.append(context_text[:CONTEXT_CHAR_BUDGET].strip())
    return " ".join(p for p in parts if p)


MAX_DEEPGRAM_PARAMS = 14


def _deepgram_params(context: dict | None,
                     language: str | None) -> list[tuple[str, str]]:
    """Base query params with the language hint made authoritative (a real
    ISO code replaces `multi`), + creator tags as extra keyterms."""
    params = [(k, language if (k == "language" and language) else v)
              for k, v in DEEPGRAM_PARAMS]
    seen = {v.lower() for k, v in params if k == "keyterm"}
    for tag in (context or {}).get("tags") or []:
        term = str(tag).strip()[:40]
        if term and term.lower() not in seen and len(params) < MAX_DEEPGRAM_PARAMS:
            params.append(("keyterm", term))
            seen.add(term.lower())
    return params


def _valid_pair(start, end) -> tuple[float, float] | None:
    """(start, end) as finite floats with end > start, else None.

    Malformed provider timestamps (strings, NaN/inf, inverted ranges) skip
    the WORD — they must never crash the provider chain."""
    if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
        return None
    start_f, end_f = float(start), float(end)
    if not (math.isfinite(start_f) and math.isfinite(end_f)) or end_f <= start_f:
        return None
    return start_f, end_f


# ── Groq ────────────────────────────────────────────────────────────────────
LANGUAGE_CODES = {
    "hindi": "hi", "english": "en", "hinglish": "hi", "urdu": "ur",
    "punjabi": "pa", "tamil": "ta", "telugu": "te", "bengali": "bn",
    "marathi": "mr", "gujarati": "gu", "kannada": "kn", "malayalam": "ml",
}

UNDETERMINED = "und"


def normalize_language(raw) -> str:
    """Provider language field → a safe ISO-639-1 code or `und`.

    Providers return either codes ("en"), full names ("english", "hindi"),
    locale tags ("en-US") or free-text names ("bhojpuri"). Only a real
    2-letter code may travel on: anything else becomes `und` so callers can
    treat it as "not locked" instead of feeding a full name back into an API
    that expects ISO-639-1 (which used to 400 every later chunk).
    """
    value = str(raw or "").strip().lower()
    if not value:
        return UNDETERMINED
    value = LANGUAGE_CODES.get(value, value)
    if re.fullmatch(r"[a-z]{2}", value):
        return value
    locale = re.fullmatch(r"([a-z]{2})[-_][a-z]{2,8}", value)
    if locale:
        return locale.group(1)
    return UNDETERMINED


def parse_groq_payload(data: dict, offset_s: float) -> tuple[list[dict], str, bool]:
    """Groq verbose_json → (canonical words, language code, word_timed).

    `word_timed` is False when words had to be spread across segment windows
    (the provider omitted word granularity) — the caller prefers a provider
    that produced real timings before accepting an estimate."""
    language = normalize_language(data.get("language"))

    words = []
    for w in data.get("words") or []:
        pair = _valid_pair(w.get("start"), w.get("end"))
        if pair is None:
            continue
        words.append(_word(w.get("word", w.get("text", "")),
                           pair[0], pair[1], offset_s, w.get("probability")))
    timed = bool(words)
    if not words:
        # Provider omitted word granularity: spread each segment's words evenly
        # across its own window so captions still get per-word timings.
        for seg in data.get("segments") or []:
            pair = _valid_pair(seg.get("start"), seg.get("end"))
            if pair is None:
                continue
            words.extend(_spread_words(seg.get("text") or "",
                                       pair[0], pair[1], offset_s))
    return words, language, timed


def _transcribe_groq(path: str, offset_s: float, language: str | None,
                     context: dict | None = None,
                     ) -> tuple[list[dict], str, str, bool] | None:
    key = os.environ.get("GROQ_API_KEY", "").strip()
    if not key:
        print("  groq: GROQ_API_KEY not set — skipping provider")
        return None

    for model in GROQ_MODELS:
        for attempt in range(ATTEMPTS_PER_PROVIDER):
            form = {
                "model": model,
                "response_format": "verbose_json",
                "timestamp_granularities[]": "word",
            }
            # "multi" is only meaningful for providers that accept it; Groq
            # wants an ISO-639-1 code and would 400 on anything else.
            if language and language != "multi":
                form["language"] = language
            # Bias the model toward the content type and proper-noun handling:
            # noticeably fewer misspelled names/brand terms than a bare call,
            # and temperature=0 keeps chunk-to-chunk vocabulary consistent.
            form["temperature"] = "0"
            form["prompt"] = build_prompt(context)
            try:
                with open(path, "rb") as fh:
                    resp = requests.post(
                        GROQ_URL,
                        headers={"Authorization": f"Bearer {key}"},
                        files={"file": (os.path.basename(path), fh, "audio/wav")},
                        data=form,
                        timeout=300,
                    )
            except requests.RequestException as exc:
                wait = 2**attempt * 5
                print(f"  groq/{model}: network error ({exc}); retry in {wait}s")
                time.sleep(wait)
                continue

            if resp.status_code == 200:
                try:
                    data = resp.json()
                except ValueError as exc:
                    # A 200 with a non-JSON body is a provider bug, not a
                    # transient error — log it and move to the next model
                    # rather than burning the whole provider.
                    print(f"  groq/{model}: HTTP 200 with non-JSON body ({exc})")
                    break
                if data.get("words") or data.get("segments"):
                    words, lang, timed = parse_groq_payload(data, offset_s)
                    if words:
                        print(f"  groq: ok model={model} lang={lang} "
                              f"timed={timed}")
                        return words, lang, model, timed
                print(f"  groq/{model}: HTTP 200 but no usable transcript")
                break
            if resp.status_code in (429, 500, 502, 503):
                wait = 2**attempt * 5
                print(f"  groq/{model}: HTTP {resp.status_code}; retry in {wait}s")
                time.sleep(wait)
                continue
            print(f"  groq/{model}: HTTP {resp.status_code} {resp.text[:200]}")
            break
    return None


# ── Deepgram ────────────────────────────────────────────────────────────────
def parse_deepgram_payload(data: dict, offset_s: float,
                           duration_s: float) -> tuple[list[dict], bool]:
    """Deepgram listen response → (canonical words, word_timed)
    (punctuated_word preferred)."""
    words: list[dict] = []
    try:
        alt = data["results"]["channels"][0]["alternatives"][0]
    except (KeyError, IndexError, TypeError):
        return words, False
    for w in alt.get("words") or []:
        pair = _valid_pair(w.get("start"), w.get("end"))
        if pair is None:
            continue
        words.append(_word(
            w.get("punctuated_word") or w.get("word") or "",
            pair[0], pair[1], offset_s, w.get("confidence"),
        ))
    timed = bool(words)
    if not words and (alt.get("transcript") or "").strip() and duration_s > 0:
        words = _spread_words(alt.get("transcript") or "", 0.0, duration_s, offset_s)
    return words, timed


def _transcribe_deepgram(path: str, offset_s: float, language: str | None = None,
                         context: dict | None = None,
                         ) -> tuple[list[dict], str, str, bool] | None:
    key = os.environ.get("DEEPGRAM_API_KEY", "").strip()
    if not key:
        print("  deepgram: DEEPGRAM_API_KEY not set — skipping provider")
        return None

    duration = wav_duration_sec(path)
    with open(path, "rb") as fh:
        audio = fh.read()

    # The language hint is authoritative when it is a real code: `language=hi`
    # pins the model instead of the previous always-`multi` behaviour.
    params = _deepgram_params(context, language)
    for attempt in range(ATTEMPTS_PER_PROVIDER):
        try:
            resp = requests.post(
                DEEPGRAM_URL,
                params=params,
                headers={
                    "Authorization": f"Token {key}",
                    "Content-Type": "audio/wav",
                },
                data=audio,
                timeout=300,
            )
        except requests.RequestException as exc:
            wait = 2**attempt * 5
            print(f"  deepgram: network error ({exc}); retry in {wait}s")
            time.sleep(wait)
            continue

        if resp.status_code == 200:
            try:
                data = resp.json()
            except ValueError as exc:
                print(f"  deepgram: HTTP 200 with non-JSON body ({exc})")
                break
            words, timed = parse_deepgram_payload(data, offset_s, duration)
            if words:
                # detected_language lives in results.channels[0] per the
                # current docs (BCP-47); metadata.detected_language is the
                # legacy location — support both.
                detected = ""
                try:
                    detected = (data["results"]["channels"][0]
                                .get("detected_language") or "")
                except (KeyError, IndexError, TypeError, AttributeError):
                    detected = ""
                if not detected:
                    try:
                        detected = (data.get("metadata") or {}
                                    ).get("detected_language") or ""
                    except AttributeError:
                        detected = ""
                # Report the code Deepgram actually detected (normalized) so
                # callers can lock on it; `multi` only when none was reported.
                lang = normalize_language(detected)
                if lang == UNDETERMINED:
                    lang = "multi"
                print(f"  deepgram: ok words={len(words)} timed={timed} "
                      f"detected={lang}")
                return words, lang, "nova-3", timed
            print("  deepgram: HTTP 200 but no usable transcript")
            break
        if resp.status_code in (429, 500, 502, 503):
            wait = 2**attempt * 5
            print(f"  deepgram: HTTP {resp.status_code}; retry in {wait}s")
            time.sleep(wait)
            continue
        print(f"  deepgram: HTTP {resp.status_code} {resp.text[:200]}")
        break
    return None


# ── NIM (Riva gRPC) ─────────────────────────────────────────────────────────
def parse_riva_response(response, offset_s: float,
                        duration_s: float) -> tuple[list[dict], bool]:
    """Riva offline_recognize response → (canonical words, word_timed).

    Word timings are second floats. Results without word offsets (non-speech
    audio returns empty word lists) get their transcript spread evenly across
    an equal slice of the chunk.
    """
    words: list[dict] = []
    no_offset_texts: list[str] = []
    try:
        results = list(response.results)
    except (TypeError, AttributeError):
        return words, False

    for result in results:
        try:
            alt = result.alternatives[0]
        except (AttributeError, IndexError, TypeError):
            continue
        transcript = getattr(alt, "transcript", "") or ""
        riva_words = list(getattr(alt, "words", []) or [])
        if riva_words:
            for w in riva_words:
                pair = _valid_pair(getattr(w, "start_time", None),
                                   getattr(w, "end_time", None))
                if pair is None:
                    continue
                words.append(_word(
                    getattr(w, "word", "") or transcript, pair[0], pair[1],
                    offset_s, getattr(w, "confidence", None),
                ))
        elif transcript.strip():
            no_offset_texts.append(transcript.strip())

    timed = bool(words)
    if no_offset_texts and duration_s > 0:
        slice_sec = duration_s / len(no_offset_texts)
        for i, text in enumerate(no_offset_texts):
            words.extend(_spread_words(text, i * slice_sec, (i + 1) * slice_sec, offset_s))
    return words, timed


def _transcribe_nim(path: str, offset_s: float, language: str | None = None,
                    context: dict | None = None,
                    ) -> tuple[list[dict], str, str, bool] | None:
    key = os.environ.get("NVIDIA_NIM_API_KEY", "").strip()
    if not key:
        print("  nim: NVIDIA_NIM_API_KEY not set — skipping provider")
        return None

    try:
        import riva.client  # lazy: the module must import without this installed
    except ImportError as exc:
        print(f"  nim: riva client not installed ({exc}) — skipping provider")
        return None

    duration = wav_duration_sec(path)
    with open(path, "rb") as fh:
        audio = fh.read()

    auth = riva.client.Auth(
        uri=NIM_URI,
        use_ssl=True,
        metadata_args=[
            ["function-id", NIM_FUNCTION_ID],
            ["authorization", f"Bearer {key}"],
        ],
    )
    service = riva.client.ASRService(auth)
    config = riva.client.RecognitionConfig(
        sample_rate_hertz=16000,
        max_alternatives=1,
        enable_word_time_offsets=True,
        enable_automatic_punctuation=True,
        language_code=NIM_LANGUAGE,
    )

    for attempt in range(ATTEMPTS_PER_PROVIDER):
        try:
            response = service.offline_recognize(audio_bytes=audio, config=config)
        except Exception as exc:  # noqa: BLE001 — gRPC raises many types
            wait = 2**attempt * 5
            print(f"  nim: riva error ({type(exc).__name__}: {exc}); retry in {wait}s")
            time.sleep(wait)
            continue

        words, timed = parse_riva_response(response, offset_s, duration)
        if words:
            print(f"  nim: ok words={len(words)} timed={timed} "
                  "model=openai/whisper-large-v3 (riva)")
            return words, "multi", "openai/whisper-large-v3", timed
        print("  nim: response contained no usable transcript")
        break
    return None


# ── Entry point ─────────────────────────────────────────────────────────────
def transcribe(
    wav_path: str,
    segment_offset_sec: float = 0.0,
    forced_language: str | None = None,
    prefer_hindi_first: bool = False,
    context: dict | None = None,
) -> dict:
    """Transcribe one WAV chunk through the provider chain.

    Returns {"words": Caption[], "language": str, "provider": str, "model": str,
    "timing_source": "word"|"estimated"}.
    `language` is a normalized ISO-639-1 code, "multi" when the provider cannot
    report a single language and no forced language was given, or "und" when
    the provider's answer could not be normalized; the workflow's language lock
    only consumes real codes. A transcript WITHOUT word timings is only used
    after every provider had the chance to produce real timings — estimated
    spreads over a 5-minute chunk are far too coarse to prefer.
    """
    order = (
        [("deepgram", _transcribe_deepgram), ("groq", _transcribe_groq), ("nim", _transcribe_nim)]
        if prefer_hindi_first
        else [("groq", _transcribe_groq), ("deepgram", _transcribe_deepgram), ("nim", _transcribe_nim)]
    )

    errors: list[str] = []
    estimated: dict | None = None   # first transcript without word timings
    for name, fn in order:
        try:
            result = fn(wav_path, segment_offset_sec, forced_language, context)
        except Exception as exc:  # noqa: BLE001 — a provider bug must not kill the others
            errors.append(f"{name}: {type(exc).__name__}: {exc}")
            print(f"  {name}: crashed ({errors[-1]})")
            continue
        if result is None:
            errors.append(f"{name}: no transcript")
            continue
        words, language, model, timed = result
        if forced_language and language in ("multi", "", UNDETERMINED):
            language = forced_language
        if timed:
            return {"words": words, "language": language, "provider": name,
                    "model": model, "timing_source": "word"}
        if estimated is None:
            estimated = {"words": words, "language": language, "provider": name,
                         "model": model}
            print(f"  {name}: transcript without word timings — "
                  "trying word-timed providers first")
    if estimated is not None:
        # Honest estimate: evenly spread words, confidence absent, flagged so
        # the report can say the timings are not measured.
        estimated["timing_source"] = "estimated"
        print(f"  {estimated['provider']}: no provider produced word timings — "
              "using the evenly spread estimate")
        return estimated

    raise RuntimeError(f"all transcription providers failed: {'; '.join(errors)}")


# ---------------------------------------------------------------------------
# CLI smoke check:  python3 pipeline/transcribe_providers.py file.wav [offset]
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) < 2:
        print("usage: transcribe_providers.py <wav> [offset_sec]")
        raise SystemExit(2)
    out = transcribe(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 0.0)
    print(json.dumps({"language": out["language"], "provider": out["provider"],
                      "model": out["model"], "words": len(out["words"])}))
