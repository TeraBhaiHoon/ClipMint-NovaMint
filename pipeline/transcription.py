#!/usr/bin/env python3
"""
ClipMint pipeline — transcription orchestration.

Extracts the logic that used to live inline in .github/workflows/
process-video.yml so it can be tested offline:

  * chunk the extracted WAV (24 MB cap → 5-minute PCM segments) and verify
    the split re-covers the whole file BEFORE paying for STT;
  * run the provider chain per chunk under a language policy that can no
    longer mis-lock English:
      - an explicit user hint (source_language) is authoritative and is
        forced on every chunk from the first one;
      - auto mode locks ONLY a confident non-English ISO code; a detection
        of "en" (the classic Hinglish false positive) never locks, so later
        chunks keep auto-detecting instead of being force-fed language=en;
      - "und" (provider names that could not be normalized) and "multi"
        never lock;
  * clean Whisper artefacts (punctuation-only tokens, repetition loops,
    hallucinated sign-offs, single-character noise — ASCII only, so Hindi
    one-code-point words such as "है" survive);
  * write the canonical captions plus an honest metadata sidecar
    (per-chunk provider/model/language/confidence — nothing invented).

CLI (used by the workflow's transcribe step):
    python3 pipeline/transcription.py --wav workspace/audio/audio.wav \
        --outdir workspace/audio [--source-language auto|hi|en] \
        [--title "..."] [--tags "a,b,c"]

Output files in --outdir:
    full_captions.json        canonical Caption[] (raw, pre-conversion)
    detected_language.txt     locked code, or "und"
    transcription_meta.json   language, language_source, per-chunk evidence
"""
from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from transcribe_providers import UNDETERMINED, normalize_language, transcribe, wav_duration_sec  # noqa: E402

SEGMENT_SECONDS = 300
MAX_BYTES = 24_000_000
# Speech/no-speech distinction, not a quality gate: ≥1 surviving word is
# speech; 0 means the audio carried no (non-hallucinated) speech. The old
# floor of 10 words rejected legitimate very short videos.
MIN_WORDS = 1
# Exact source-language whitelist (mirrors the workflow's Validate inputs).
SUPPORTED_SOURCE_LANGUAGES = ("auto", "hi", "en")

HALLUCINATIONS = {
    "thank you for watching", "thanks for watching",
    "subscribe to my channel", "please like and share",
    "please subscribe", "like share and subscribe",
    "don't forget to subscribe", "hit the bell icon",
    "see you in the next video", "subtitles by", "captions by",
    "translated by", "music playing",
}


class TranscriptionError(RuntimeError):
    """A transcription-stage failure whose message is safe to surface."""


def clean(words: list[dict]) -> list[dict]:
    """Remove punctuation-only tokens, repetition loops, hallucinated
    sign-offs and noise single characters.

    The single-character rule is ASCII-only on purpose: Devanagari words such
    as "है" (is) are one code point but real speech — the old
    `len(text) == 1` check deleted them from every Hindi transcript.
    """
    kept = []
    for w in words:
        text = (w.get("text") or "").strip()
        if not text:
            continue
        if re.fullmatch(r"[^\w\s]+", text):
            continue
        if len(text) == 1 and text.isascii() and text.lower() not in ("i", "a", "o"):
            continue
        span = w["endMs"] - w["startMs"]
        if span <= 0 or span > 8000:
            continue
        kept.append(w)

    deduped, run = [], 1
    for i, w in enumerate(kept):
        if i > 0 and w["text"].lower() == kept[i - 1]["text"].lower():
            run += 1
            if run > 3:
                continue
        else:
            run = 1
        deduped.append(w)

    final, skip_to = [], -1
    for i, w in enumerate(deduped):
        if i < skip_to:
            continue
        escaped = False
        for phrase in HALLUCINATIONS:
            n = len(phrase.split())
            window = " ".join(d["text"].lower() for d in deduped[i:i + n])
            if window == phrase:
                print(f"    removed hallucination: {phrase!r}")
                skip_to = i + n
                escaped = True
                break
        if not escaped:
            final.append(w)
    return final


class LanguageLock:
    """Chunk-to-chunk language policy (see module docstring for the rules).

    Auto mode requires TWO consecutive chunks agreeing on the same
    non-English code before locking — one noisy chunk (unknown/absent
    confidence) must not lock the whole job. The first "en" detection never
    locks; an explicit hi/en hint is authoritative from chunk 0.
    """

    def __init__(self, source_language: str | None = None):
        code = normalize_language(source_language)
        self.hint: str | None = code if code not in (UNDETERMINED, "multi") else None
        self.locked: str | None = self.hint
        self._pending: str | None = None  # candidate awaiting a second agreement
        self.chunks: list[dict] = []

    def plan_chunk(self) -> tuple[str | None, bool]:
        """(forced_language, prefer_native_first) for the next chunk.

        `prefer_native_first` sends non-English content to Deepgram nova-3
        first (best code-switched accuracy, per the provider notes).
        """
        forced = self.locked
        if forced == "en" and self.hint != "en":
            forced = None  # detection alone never forces English
        prefer_native = bool(forced and forced != "en") or self.hint == "hi"
        return forced, prefer_native

    def observe(self, language, provider, model, word_count, confidence,
                timing_source: str = "word") -> None:
        code = normalize_language(language)
        entry = {"language": code, "provider": provider, "model": model,
                 "words": word_count, "timing_source": timing_source}
        if isinstance(confidence, (int, float)):
            entry["confidence"] = round(float(confidence), 4)
        self.chunks.append(entry)
        if self.hint is not None or self.locked is not None:
            return
        # Robust detection: a non-English code locks only after two
        # consecutive agreeing chunks. "en" (the Hinglish false positive),
        # "und" and "multi" never lock and reset the agreement streak; a
        # different non-English code restarts it.
        if code in (UNDETERMINED, "multi", "en"):
            self._pending = None
        elif code == self._pending:
            self.locked = code
        else:
            self._pending = code

    @property
    def language_source(self) -> str:
        if self.hint:
            return "user-hint"
        return "detected" if self.locked else "undetermined"


def split_chunks(wav: Path, out_dir: Path) -> list[Path]:
    """Stage the WAV as ≤24 MB chunks; verify coverage before STT spends money."""
    for old in sorted(out_dir.glob("chunk_*.wav")):
        old.unlink()

    if wav.stat().st_size > MAX_BYTES:
        split = subprocess.run(
            ["ffmpeg", "-i", str(wav), "-f", "segment",
             "-segment_time", str(SEGMENT_SECONDS), "-c", "copy",
             str(out_dir / "chunk_%03d.wav"), "-y", "-loglevel", "error"],
            capture_output=True, text=True,
        )
        if split.returncode != 0:
            raise TranscriptionError(
                "audio split failed: " + (split.stderr or split.stdout or "").strip()[-400:])
    else:
        # A whole WAV under the byte cap stays ONE chunk regardless of
        # duration: mono 16 kHz PCM at 310 s is ~9.9 MB. Segmenting is
        # byte-driven, so a time-based chunk-count expectation is wrong here —
        # it used to abort a perfectly complete single-chunk transcript.
        shutil.copyfile(wav, out_dir / "chunk_000.wav")

    chunks = sorted(out_dir.glob("chunk_*.wav"))
    if not chunks:
        raise TranscriptionError("no audio chunks produced")

    # Coverage check ONLY for the segmented path: a partial split (disk full,
    # runner killed mid-encode) silently drops the video's TAIL — existing
    # chunks still transcribe and the step would report success with a
    # truncated transcript. The single-chunk path is complete by definition.
    if wav.stat().st_size > MAX_BYTES:
        probe = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(wav)],
            capture_output=True, text=True,
        )
        try:
            src_dur = float((probe.stdout or "").strip() or 0)
        except ValueError:
            src_dur = 0.0
        if src_dur > 0:
            expected = int(math.ceil(src_dur / SEGMENT_SECONDS))
            if len(chunks) < expected:
                raise TranscriptionError(
                    f"audio split produced {len(chunks)}/{expected} chunks — "
                    "the transcript would be truncated; aborting")
    return chunks


def transcribe_file(
    wav: Path,
    out_dir: Path,
    *,
    source_language: str | None = None,
    context: dict | None = None,
    transcribe_fn=transcribe,
) -> dict:
    """Transcribe the whole WAV; write full_captions.json (RAW, pre-conversion),
    detected_language.txt and transcription_meta.json.

    Raises TranscriptionError with a user-safe message on failure.
    """
    if source_language and str(source_language).lower() not in SUPPORTED_SOURCE_LANGUAGES:
        raise TranscriptionError(
            f"unsupported source_language {source_language!r} — "
            f"use one of {', '.join(SUPPORTED_SOURCE_LANGUAGES)}")
    chunks = split_chunks(wav, out_dir)
    print(f"chunks: {len(chunks)}")

    lock = LanguageLock(source_language)
    all_words: list[dict] = []
    for idx, chunk in enumerate(chunks):
        offset = idx * SEGMENT_SECONDS
        forced, prefer_native = lock.plan_chunk()
        print(f"chunk {idx + 1}/{len(chunks)} (offset {offset}s) "
              f"forced={forced or 'auto'} native_first={prefer_native}")
        result = transcribe_fn(str(chunk), offset, forced_language=forced,
                               prefer_hindi_first=prefer_native, context=context)
        words = result.get("words") or []
        if not words:
            raise TranscriptionError(f"chunk {idx + 1} produced an empty transcript")
        confidences = [w["confidence"] for w in words
                       if isinstance(w.get("confidence"), (int, float))]
        avg = round(sum(confidences) / len(confidences), 4) if confidences else None
        lock.observe(result.get("language"), result.get("provider"),
                     result.get("model"), len(words), avg,
                     timing_source=result.get("timing_source", "word"))
        all_words.extend(words)

    if not all_words:
        raise TranscriptionError("transcript is empty")

    cleaned = clean(all_words)
    print(f"words: {len(all_words)} raw -> {len(cleaned)} filtered")
    if len(cleaned) < MIN_WORDS:
        raise TranscriptionError(
            "no speech survived filtering — the audio may contain no speech")

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "full_captions.json").write_text(json.dumps(cleaned))
    (out_dir / "detected_language.txt").write_text(lock.locked or UNDETERMINED)
    meta = {
        "language": lock.locked or UNDETERMINED,
        "language_source": lock.language_source,
        "chunks": lock.chunks,
        "words": len(cleaned),
        "source_duration": wav_duration_sec(str(wav)) or None,
    }
    (out_dir / "transcription_meta.json").write_text(json.dumps(meta, indent=2))
    print(f"TRANSCRIBE_OK words={len(cleaned)} language={meta['language']} "
          f"language_source={meta['language_source']}")
    return meta


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wav", type=Path, required=True)
    parser.add_argument("--outdir", type=Path, required=True)
    parser.add_argument("--source-language", default="auto",
                        help="auto, or an ISO-639-1 hint such as hi/en")
    parser.add_argument("--title", default="",
                        help="source video title (metadata prompt context)")
    parser.add_argument("--tags", default="",
                        help="comma-separated source tags (prompt + keyterms)")
    args = parser.parse_args()

    context = None
    if args.title or args.tags:
        context = {
            "title": args.title,
            "tags": [t.strip() for t in args.tags.split(",") if t.strip()],
        }
    meta = transcribe_file(args.wav, args.outdir,
                           source_language=args.source_language, context=context)
    print("TRANSCRIPTION_META " + json.dumps(meta))


if __name__ == "__main__":
    main()
