#!/usr/bin/env python3
"""
ClipMint asset search — hybrid keyword + metadata search over the asset index.

Reads the JSONL manifest produced by `asset_library.py` and answers the question
the auto-editor actually asks: *"give me the best 3 sound effects for an
impact at a high-energy moment, under 2 seconds, that I'm allowed to ship in a
paid video."*

------------------------------------------------------------------------------
DESIGN
------------------------------------------------------------------------------
**Filters are hard, ranking is soft.** A filter mismatch excludes an asset
outright; only assets that pass every filter are scored. That is deliberate: a
30-second music bed must never be able to outrank a 0.4-second whoosh for a
transition slot just because its filename contains the word "whoosh". Ranking
decides *which* of the eligible assets is best; filtering decides *whether* an
asset is eligible at all.

**BM25 over weighted fields.** Each asset is a document whose terms come from
four fields with different weights:

    tags      x3   the curated/normalised vocabulary (synonyms already expanded)
    name      x2   the filename stem, which is usually the most descriptive part
    path      x1   folder tokens — a weak but real signal ("SFX/Impacts/...")
    category  x2   the classified category, so "sfx" matches every SFX

BM25 (k1=1.5, b=0.75) rather than plain TF-IDF because it saturates term
frequency: an asset whose name repeats "whoosh" three times must not score 3x
an asset named "whoosh" once. That saturation is what keeps results sane in a
library where some packs are named `whoosh_01`, `whoosh_02`, ... .

**Deterministic.** No randomness anywhere. Equal scores break ties on path.
This matters because a render must be reproducible: the same job re-run must
pick the same SFX, or A/B comparisons and bug reports are meaningless.

**No dependencies.** Pure stdlib. It must run in the finalize job, in the
dashboard's serverless function, and in a local debug shell.

Usage:
  python3 pipeline/asset_search.py \\
      --index assets/index --query "whoosh transition" \\
      --category sfx --max-duration 2 --commercial-only --limit 5 --explain

  python3 pipeline/asset_search.py --index assets/index \\
      --category bgm --mood energetic --min-duration 60 --json
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

import asset_library  # noqa: E402

# BM25 parameters. k1 controls term-frequency saturation; b controls how
# strongly document length is penalised. These are the standard defaults and
# were kept because the corpus is short-document text, which is exactly the
# regime the defaults were tuned for.
BM25_K1 = 1.5
BM25_B = 0.75

# Field weights. `tags` is highest because it is the only field that has had
# synonyms expanded into it, so it is the only field that can match a query
# word the file does not literally contain.
FIELD_WEIGHTS = {"tags": 3.0, "name": 2.0, "category": 2.0, "path": 1.0}

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STEM_SUFFIXES = ("ing", "ers", "er", "ies", "es", "s")


def tokens(text: str) -> list[str]:
    """Lowercase alphanumeric tokens."""
    return _TOKEN_RE.findall((text or "").lower())


def stem(token: str) -> str:
    """Very small suffix stripper, applied to BOTH query and index terms.

    A full Porter stemmer is overkill here and would hurt as often as it helps
    on asset names ("riser" -> "ris", "bass" -> "bas"). This only folds the
    plural/gerund forms that actually appear in asset libraries — "impacts"
    matching "impact", "whooshes" matching "whoosh" — and never shortens a
    token below 4 characters, which is what stops "bass" becoming "bas".
    """
    if len(token) < 5:
        return token
    for suffix in _STEM_SUFFIXES:
        if token.endswith(suffix) and len(token) - len(suffix) >= 4:
            return token[: -len(suffix)]
    return token


# ---------------------------------------------------------------------------
# Query
# ---------------------------------------------------------------------------
@dataclass
class Query:
    """A structured asset query. Every field is optional except the index."""

    text: str = ""
    categories: tuple[str, ...] = ()
    kinds: tuple[str, ...] = ()
    moods: tuple[str, ...] = ()
    tags_all: tuple[str, ...] = ()
    tags_any: tuple[str, ...] = ()
    exclude_tags: tuple[str, ...] = ()
    licenses: tuple[str, ...] = ()
    commercial_only: bool = False
    allow_licenses: tuple[str, ...] = ()
    min_duration: float | None = None
    max_duration: float | None = None
    min_bpm: float | None = None
    max_bpm: float | None = None
    min_bytes: int | None = None
    max_bytes: int | None = None
    require_probe: bool = False
    limit: int = 10

    def filters(self) -> list[str]:
        """Human-readable list of the active hard filters (for --explain)."""
        active = []
        if self.categories:
            active.append(f"category in {list(self.categories)}")
        if self.kinds:
            active.append(f"kind in {list(self.kinds)}")
        if self.moods:
            active.append(f"mood in {list(self.moods)}")
        if self.commercial_only:
            active.append("commercial_ok")
        if self.licenses:
            active.append(f"license in {list(self.licenses)}")
        if self.min_duration is not None:
            active.append(f"duration >= {self.min_duration}s")
        if self.max_duration is not None:
            active.append(f"duration <= {self.max_duration}s")
        if self.min_bpm is not None:
            active.append(f"bpm >= {self.min_bpm}")
        if self.max_bpm is not None:
            active.append(f"bpm <= {self.max_bpm}")
        if self.require_probe:
            active.append("has probe data")
        return active


def _duration_of(record: dict) -> float | None:
    probe = record.get("probe") or {}
    value = probe.get("duration")
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def passes(record: dict, query: Query) -> tuple[bool, str]:
    """Apply the hard filters. Returns (ok, reason_when_rejected)."""
    if query.categories and record.get("category") not in query.categories:
        return False, f"category={record.get('category')}"
    if query.kinds and record.get("kind") not in query.kinds:
        return False, f"kind={record.get('kind')}"
    if query.moods and record.get("mood") not in query.moods:
        return False, f"mood={record.get('mood')}"
    if query.licenses and record.get("license") not in query.licenses:
        return False, f"license={record.get('license')}"
    if query.commercial_only:
        reason = asset_library.blocked_reason(record, set(query.allow_licenses))
        if reason:
            return False, reason

    tags = set(record.get("tags") or [])
    if query.tags_all and not set(query.tags_all).issubset(tags):
        missing = sorted(set(query.tags_all) - tags)
        return False, f"missing tags {missing}"
    if query.tags_any and not (set(query.tags_any) & tags):
        return False, "none of the required tags present"
    if query.exclude_tags and (set(query.exclude_tags) & tags):
        found = sorted(set(query.exclude_tags) & tags)
        return False, f"excluded tags {found}"

    if query.require_probe and not record.get("probe"):
        return False, "no probe data"

    duration = _duration_of(record)
    if query.min_duration is not None:
        # An un-probed asset has an UNKNOWN duration. Treating "unknown" as
        # "passes" would let a 4-minute music bed into a 0.5 s SFX slot, so an
        # unknown duration fails a duration filter. Enrich the index first.
        if duration is None or duration < query.min_duration:
            return False, f"duration={duration}"
    if query.max_duration is not None:
        if duration is None or duration > query.max_duration:
            return False, f"duration={duration}"

    probe = record.get("probe") or {}
    bpm = probe.get("bpm")
    if query.min_bpm is not None and (bpm is None or bpm < query.min_bpm):
        return False, f"bpm={bpm}"
    if query.max_bpm is not None and (bpm is None or bpm > query.max_bpm):
        return False, f"bpm={bpm}"

    size = int(record.get("bytes") or 0)
    if query.min_bytes is not None and size < query.min_bytes:
        return False, f"bytes={size}"
    if query.max_bytes is not None and size > query.max_bytes:
        return False, f"bytes={size}"

    return True, ""


# ---------------------------------------------------------------------------
# BM25 index
# ---------------------------------------------------------------------------
def document_terms(record: dict) -> dict[str, float]:
    """Weighted term frequencies for one asset."""
    terms: dict[str, float] = {}

    def add(text: str, weight: float) -> None:
        for token in tokens(text):
            if not token:
                continue
            key = stem(token)
            terms[key] = terms.get(key, 0.0) + weight

    add(" ".join(record.get("tags") or []), FIELD_WEIGHTS["tags"])
    # Filename stem, without the extension: ".wav" would otherwise make every
    # audio file match a search for "wav".
    add(Path(record.get("name") or "").stem, FIELD_WEIGHTS["name"])
    add(record.get("category") or "", FIELD_WEIGHTS["category"])
    # The full path minus the filename, so folder names contribute once.
    add(str(Path(record.get("path") or "").parent), FIELD_WEIGHTS["path"])
    return terms


class Index:
    """BM25 index over a record list. Built in one pass; O(corpus) memory."""

    def __init__(self, records: list[dict]) -> None:
        self.records = records
        self.doc_terms: list[dict[str, float]] = []
        self.doc_len: list[float] = []
        self.df: dict[str, int] = {}

        for record in records:
            terms = document_terms(record)
            self.doc_terms.append(terms)
            self.doc_len.append(sum(terms.values()))
            for term in terms:
                self.df[term] = self.df.get(term, 0) + 1

        self.n = len(records)
        self.avg_len = (sum(self.doc_len) / self.n) if self.n else 0.0

    def idf(self, term: str) -> float:
        """BM25 idf with the +0.5 smoothing and a floor of 0.

        The floor matters: a term present in every document (e.g. "sfx" when
        every result is an SFX) has a negative idf and would actively *penalise*
        matching. Clamping at 0 makes such a term a no-op instead of a penalty,
        which is the behaviour you want for a redundant query word.
        """
        df = self.df.get(term, 0)
        value = math.log(1.0 + (self.n - df + 0.5) / (df + 0.5))
        return max(0.0, value)

    def score(self, doc_index: int, query_terms: list[str]) -> tuple[float, list[str]]:
        """BM25 score + the terms that matched (for --explain)."""
        terms = self.doc_terms[doc_index]
        length = self.doc_len[doc_index] or 1.0
        total = 0.0
        matched: list[str] = []

        for term in query_terms:
            freq = terms.get(term, 0.0)
            if freq <= 0:
                continue
            matched.append(term)
            denom = freq + BM25_K1 * (1.0 - BM25_B + BM25_B * length / (self.avg_len or 1.0))
            total += self.idf(term) * (freq * (BM25_K1 + 1.0)) / denom
        return total, matched


@dataclass
class Hit:
    record: dict
    score: float
    matched: list[str] = field(default_factory=list)


def search(records: list[dict], query: Query, index: Index | None = None) -> tuple[list[Hit], int]:
    """Rank the records that pass the hard filters.

    Returns (hits, filtered_out_count). With an empty `query.text` every
    eligible asset scores 0 and the order falls back to path, which is a
    deterministic "list everything matching the filters" mode — useful for
    building a picker UI.
    """
    index = index or Index(records)
    query_terms = [stem(t) for t in tokens(query.text)]
    # A term repeated in the query must not double-count.
    query_terms = list(dict.fromkeys(query_terms))

    hits: list[Hit] = []
    rejected = 0
    for doc_index, record in enumerate(records):
        ok, _ = passes(record, query)
        if not ok:
            rejected += 1
            continue
        score, matched = index.score(doc_index, query_terms)
        if query_terms and not matched:
            # A pure keyword query must not return assets that match nothing,
            # however well they satisfy the filters.
            continue
        hits.append(Hit(record=record, score=round(score, 6), matched=matched))

    # Deterministic ordering: score desc, then path asc. Without the path
    # tiebreak two equally-good assets would swap between runs, and the same
    # job re-rendered would pick a different SFX.
    hits.sort(key=lambda h: (-h.score, h.record.get("path", "").lower()))
    if query.limit and query.limit > 0:
        hits = hits[: query.limit]
    return hits, rejected


def search_index(index_path: str | Path, query: Query) -> tuple[list[Hit], int, int]:
    """Convenience: load a manifest and search it. Returns (hits, rejected, total)."""
    records = asset_library.read_manifest(Path(index_path))
    hits, rejected = search(records, query)
    return hits, rejected, len(records)


def hit_to_dict(hit: Hit) -> dict:
    """JSON-safe view of a hit (the full record is large; this is what a UI wants)."""
    record = hit.record
    probe = record.get("probe") or {}
    return {
        "id": record.get("id"),
        "path": record.get("path"),
        "name": record.get("name"),
        "category": record.get("category"),
        "kind": record.get("kind"),
        "tags": record.get("tags") or [],
        "mood": record.get("mood"),
        "license": record.get("license"),
        "commercial_ok": bool(record.get("commercial_ok")),
        "duration": probe.get("duration"),
        "bpm": probe.get("bpm"),
        "lufs": probe.get("lufs"),
        "energy": probe.get("energy"),
        "bytes": record.get("bytes"),
        "drive_id": record.get("drive_id"),
        "score": hit.score,
        "matched": hit.matched,
    }


def _csv_tuple(value: str) -> tuple[str, ...]:
    return tuple(v.strip().lower() for v in (value or "").split(",") if v.strip())


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Search the ClipMint asset index")
    ap.add_argument("--index", default=str(asset_library.DEFAULT_INDEX_DIR),
                    help="index directory or assets.jsonl path")
    ap.add_argument("--query", "-q", default="", help="free-text keywords")
    ap.add_argument("--category", default="", help="CSV of categories")
    ap.add_argument("--kind", default="", help="CSV of kinds (audio, video, image)")
    ap.add_argument("--mood", default="", help="CSV of moods")
    ap.add_argument("--tags-all", default="", help="CSV of tags that must ALL be present")
    ap.add_argument("--tags-any", default="", help="CSV of tags where ANY one suffices")
    ap.add_argument("--exclude-tags", default="", help="CSV of tags to reject")
    ap.add_argument("--license", default="", help="CSV of licences to allow")
    ap.add_argument("--commercial-only", action="store_true",
                    help="only assets cleared for commercial use")
    ap.add_argument("--allow-license", default="",
                    help="CSV of licences to treat as commercial-safe (operator override)")
    ap.add_argument("--min-duration", type=float, default=None)
    ap.add_argument("--max-duration", type=float, default=None)
    ap.add_argument("--min-bpm", type=float, default=None)
    ap.add_argument("--max-bpm", type=float, default=None)
    ap.add_argument("--require-probe", action="store_true",
                    help="exclude assets with no media metadata")
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--json", action="store_true", help="emit JSON instead of text")
    ap.add_argument("--explain", action="store_true",
                    help="show the active filters and why each hit matched")
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    query = Query(
        text=args.query,
        categories=_csv_tuple(args.category),
        kinds=_csv_tuple(args.kind),
        moods=_csv_tuple(args.mood),
        tags_all=_csv_tuple(args.tags_all),
        tags_any=_csv_tuple(args.tags_any),
        exclude_tags=_csv_tuple(args.exclude_tags),
        licenses=_csv_tuple(args.license),
        commercial_only=args.commercial_only,
        allow_licenses=_csv_tuple(args.allow_license),
        min_duration=args.min_duration,
        max_duration=args.max_duration,
        min_bpm=args.min_bpm,
        max_bpm=args.max_bpm,
        require_probe=args.require_probe,
        limit=args.limit,
    )

    try:
        hits, rejected, total = search_index(args.index, query)
    except RuntimeError as exc:
        print(f"SEARCH_ERROR {exc}", file=sys.stderr)
        return 1

    if args.explain:
        print(f"index: {total} asset(s)")
        print(f"filters: {query.filters() or 'none'}")
        print(f"rejected by filters: {rejected}")

    if args.json:
        print(json.dumps([hit_to_dict(h) for h in hits], indent=2))
    else:
        if not hits:
            print("(no matches)")
        for hit in hits:
            probe = hit.record.get("probe") or {}
            detail = []
            if probe.get("duration") is not None:
                detail.append(f"{probe['duration']}s")
            if probe.get("bpm"):
                detail.append(f"{probe['bpm']}bpm")
            if probe.get("lufs") is not None:
                detail.append(f"{probe['lufs']}LUFS")
            detail.append(hit.record.get("license", "?"))
            print(f"{hit.score:7.3f}  [{hit.record.get('category'):10}] "
                  f"{hit.record.get('path')}  ({', '.join(detail)})")
            if args.explain and hit.matched:
                print(f"          matched: {', '.join(hit.matched)}")

    print(f"SEARCH_OK hits={len(hits)} rejected={rejected} total={total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
