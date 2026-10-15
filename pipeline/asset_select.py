#!/usr/bin/env python3
"""
ClipMint asset select — turn a clip brief into a concrete asset plan.

`asset_search.py` answers "what matches?"; this module answers "what should
this clip actually use?". It is the bridge between the indexed library and the
render, and it is where the editorial rules live:

  * which sound-effect ROLES a clip needs (a hook whoosh, caption pops, a
    pre-hook riser, an ending ding) and where each one lands in time;
  * which music bed to use, at what level, with what ducking and fades;
  * which transition/overlay/effect assets suit the mood;
  * and — critically — what got *blocked* for licensing, so the operator can
    see why the library was not used.

------------------------------------------------------------------------------
WHY SELECTION IS SEEDED, NOT RANDOM
------------------------------------------------------------------------------
Choosing among the top candidates uses a PRNG seeded from
`job_id + clip_index + role`. Two consequences, both required:

  1. **Different clips get different SFX.** A job with 10 clips must not ship
     the identical whoosh 10 times; that reads as a bug to a viewer.
  2. **Re-running the same job reproduces the same edit.** A retry after a
     transient failure, or a bug report replayed a week later, must produce the
     same file. `random.random()` would silently break both.

------------------------------------------------------------------------------
WHY ROLES AND NOT FREE-TEXT QUERIES
------------------------------------------------------------------------------
An auto-editor does not "search for a sound"; it fills a *slot*. The slot has a
meaning (this is the hook), a timing (it starts at 0), a length ceiling (it must
not outlast the first line) and a level (it must sit under the voice). Modelling
roles explicitly is what makes the output sound edited rather than assembled.

Usage:
  python3 pipeline/asset_select.py \\
      --index assets/index --brief clip_brief.json --out clip_assets.json \\
      [--job-id abc123] [--seed 0] [--allow-license epidemic] \\
      [--no-bgm] [--no-sfx] [--explain]

  # or generate a brief from the prepare manifest:
  python3 pipeline/asset_select.py --index assets/index \\
      --clips workspace/clips/clips_manifest.json --outdir workspace/assets

  # ...and stage the chosen BGM into the render engine's public dir so
  # render_clips.py can reference it (needs the local library mirror):
  python3 pipeline/asset_select.py --index assets/index \\
      --clips workspace/clips/clips_manifest.json --outdir workspace/assets \\
      --library-root /mnt/ClipMint-Assets \\
      --public-bgm-dir workspace/assets/bgm
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

import asset_library  # noqa: E402
import asset_search  # noqa: E402
from asset_search import Query  # noqa: E402

PLAN_VERSION = 1

# BGM level under dialogue. Matches the vendored-library default in
# `remotion-captions` (bgmVolume 0.12) so switching between the two sources does
# not change the mix.
DEFAULT_BGM_VOLUME = 0.12

# Mood -> (bgm volume, duck dB, fade-in s, fade-out s). Energetic music sits
# slightly hotter and ducks harder; calm music sits lower and barely ducks.
MOOD_MIX = {
    "energetic": {"volume": 0.14, "duck_db": -13.0, "fade_in": 0.4, "fade_out": 1.2},
    "calm": {"volume": 0.10, "duck_db": -8.0, "fade_in": 1.2, "fade_out": 2.5},
    "corporate": {"volume": 0.11, "duck_db": -10.0, "fade_in": 0.8, "fade_out": 2.0},
    "inspiring": {"volume": 0.12, "duck_db": -11.0, "fade_in": 1.0, "fade_out": 2.5},
    "cinematic": {"volume": 0.12, "duck_db": -11.0, "fade_in": 1.5, "fade_out": 3.0},
}

# Fallback ladder when the exact mood has no eligible asset. Ordered from
# "closest feel" outward, and every entry is a real mood key.
MOOD_FALLBACK = {
    "energetic": ("energetic", "cinematic", "inspiring", "corporate", "calm"),
    "calm": ("calm", "inspiring", "corporate", "cinematic", "energetic"),
    "corporate": ("corporate", "inspiring", "calm", "cinematic", "energetic"),
    "inspiring": ("inspiring", "cinematic", "calm", "corporate", "energetic"),
    "cinematic": ("cinematic", "inspiring", "energetic", "corporate", "calm"),
}

# Adjacent-mood expansion used when SEARCHING: a query for "energetic" should
# also consider "cinematic" assets, but with a lower preference weight.
MOOD_QUERY_TAGS = {
    "energetic": ("energetic", "hype", "upbeat", "fast", "driving"),
    "calm": ("calm", "ambient", "relaxing", "soft", "chill"),
    "corporate": ("corporate", "business", "clean", "professional", "tech"),
    "inspiring": ("inspiring", "cinematic", "epic", "motivational", "emotional"),
    "cinematic": ("cinematic", "epic", "dramatic", "dark", "orchestral"),
}

# How many candidates to consider before the seeded pick. Picking from a pool
# rather than always taking rank 1 is what makes consecutive clips differ.
PICK_POOL = 3

# Fraction of the top score a candidate must reach to enter the pick pool.
PICK_POOL_RATIO = 0.75


# ---------------------------------------------------------------------------
# SFX roles
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class SfxRole:
    """A slot the editor wants filled.

    `query` is the search text; `tags_any` widens it so a library that names
    things differently still matches. `max_duration` is the hard ceiling that
    stops a 4-second impact from swallowing the first sentence. `at` is the
    placement rule — see `place_sfx` for how the dynamic ones are resolved.
    """

    name: str
    query: str
    tags_any: tuple[str, ...]
    max_duration: float
    min_duration: float
    gain_db: float
    at: str                    # "start" | "end" | "hook" | "beat" | "caption"
    optional: bool = True
    density: float = 1.0       # 0..1 — probability a slot is filled per opportunity


SFX_ROLES: tuple[SfxRole, ...] = (
    SfxRole(
        name="hook_whoosh",
        query="whoosh transition swoosh",
        tags_any=("whoosh", "transition", "swish", "swoosh", "sweep"),
        min_duration=0.08, max_duration=1.5, gain_db=-9.0, at="start",
    ),
    SfxRole(
        name="hook_riser",
        query="riser buildup tension swell",
        tags_any=("riser", "buildup", "tension", "swell", "uplift"),
        min_duration=0.4, max_duration=3.0, gain_db=-12.0, at="hook",
    ),
    SfxRole(
        name="caption_pop",
        query="pop click tick ui",
        tags_any=("pop", "click", "tick", "ui", "bubble"),
        min_duration=0.02, max_duration=0.6, gain_db=-15.0, at="caption", density=0.35,
    ),
    SfxRole(
        name="impact",
        query="impact hit slam punch",
        tags_any=("impact", "hit", "slam", "boom", "punch"),
        min_duration=0.05, max_duration=1.2, gain_db=-10.0, at="beat", density=0.5,
    ),
    SfxRole(
        name="outro_ding",
        query="ding chime bell notification",
        tags_any=("ding", "chime", "bell", "notify", "notification"),
        min_duration=0.05, max_duration=1.5, gain_db=-14.0, at="end",
    ),
)

ROLE_BY_NAME = {role.name: role for role in SFX_ROLES}


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------
def stable_seed(*parts) -> int:
    """A deterministic 63-bit seed from arbitrary parts.

    Python's built-in `hash()` is randomised per process (PYTHONHASHSEED), so it
    cannot be used here — it would give a different SFX on every run. SHA-256
    over the joined parts is stable across processes, machines and versions.
    """
    key = "|".join(str(p) for p in parts)
    digest = hashlib.sha256(key.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") & 0x7FFFFFFFFFFFFFFF


@dataclass
class ClipBrief:
    """Everything the selector needs to know about one clip."""

    index: int = 0
    duration: float = 0.0
    mood: str | None = None
    platform: str = "reels"
    pacing: str = "balanced"
    hook_text: str = ""
    title: str = ""
    keywords: tuple[str, ...] = ()
    beats: list[float] = field(default_factory=list)
    caption_starts: list[float] = field(default_factory=list)
    has_bgm_override: bool = False

    @classmethod
    def from_dict(cls, data: dict) -> "ClipBrief":
        # `clip_index` is the canonical name everywhere else in the codebase
        # (db.py, the emitted plan, the module docstring), while the prepare
        # manifest uses `index`. Accept both: silently defaulting every brief to
        # index 0 would seed every clip identically and ship the same SFX for
        # the whole job - the exact defect this module exists to prevent.
        raw_index = data.get("index", data.get("clip_index"))
        return cls(
            index=int(raw_index if raw_index is not None else 0),
            duration=float(data.get("duration") or 0.0),
            mood=(data.get("mood") or None),
            platform=data.get("platform") or "reels",
            pacing=data.get("pacing") or "balanced",
            hook_text=data.get("hook_text") or "",
            title=data.get("title") or "",
            keywords=tuple(data.get("keywords") or ()),
            beats=[float(b) for b in (data.get("beats") or [])],
            caption_starts=[float(c) for c in (data.get("caption_starts") or [])],
            has_bgm_override=bool(data.get("has_bgm_override")),
        )

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "duration": self.duration,
            "mood": self.mood,
            "platform": self.platform,
            "pacing": self.pacing,
            "hook_text": self.hook_text,
            "title": self.title,
            "keywords": list(self.keywords),
            "beats": self.beats,
            "caption_starts": self.caption_starts,
            "has_bgm_override": self.has_bgm_override,
        }


def brief_from_manifest(entry: dict, moments: dict | None = None) -> ClipBrief:
    """Build a brief from a `prepare_clips.py` manifest entry (+ its moment)."""
    index = int(entry.get("index") or 0)
    moment = moments or {}
    return ClipBrief(
        index=index,
        duration=float(entry.get("duration") or 0.0),
        mood=entry.get("mood") or moment.get("mood"),
        platform=entry.get("platform") or "reels",
        pacing=entry.get("pacing") or "balanced",
        hook_text=moment.get("hook_caption") or moment.get("hook") or "",
        title=moment.get("title") or "",
        keywords=tuple(moment.get("keywords") or ()),
        beats=[float(b) for b in (entry.get("beats") or [])],
        caption_starts=[float(c) for c in (entry.get("caption_starts") or [])],
    )


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------
class AssetSelector:
    """Selects assets for clips from one indexed library.

    Built once per job: the BM25 index is constructed a single time and reused
    for every clip and every role, which keeps a 20-clip job's selection under a
    second even against a 10,000-asset library.
    """

    def __init__(self, records: list[dict], allow_licenses: tuple[str, ...] = (),
                 job_id: str = "", seed: int | None = None,
                 explain: bool = False) -> None:
        self.records = records
        self.allow = set(allow_licenses)
        self.job_id = job_id
        self.base_seed = seed
        self.explain = explain
        self.index = asset_search.Index(records) if records else None
        self.blocked: dict[str, str] = {}

    # -- helpers ----------------------------------------------------------
    def _query(self, **kwargs) -> Query:
        """Every query is commercial-filtered: the library is only useful if
        what it returns is shippable."""
        kwargs.setdefault("commercial_only", True)
        kwargs.setdefault("allow_licenses", tuple(self.allow))
        kwargs.setdefault("limit", 25)
        return Query(**kwargs)

    def _run(self, query: Query) -> list[asset_search.Hit]:
        if not self.records:
            return []
        hits, _ = asset_search.search(self.records, query, self.index)
        if not hits and self.explain:
            print(f"    (no eligible asset for {query.text!r} filters={query.filters()})")
        return hits

    def _note_blocked(self, records: list[dict]) -> None:
        """Record why candidates were rejected, for the operator report."""
        for record in records:
            reason = asset_library.blocked_reason(record, self.allow)
            if reason:
                self.blocked.setdefault(record.get("path", "?"), reason)

    def _pick(self, hits: list[asset_search.Hit], role: str, index: int,
              pool: int = PICK_POOL) -> asset_search.Hit | None:
        """Choose among the top candidates with a deterministic seed.

        The pool is the set of hits scoring at least PICK_POOL_RATIO of the
        best, so only a near-tie is randomised — a clearly-better asset is never
        passed over just to add variety.
        """
        if not hits:
            return None
        best = hits[0].score
        candidates = [h for h in hits[:pool] if best <= 0 or h.score >= best * PICK_POOL_RATIO]
        if len(candidates) <= 1:
            return hits[0]
        rng = random.Random(self.base_seed if self.base_seed is not None
                            else stable_seed(self.job_id, index, role))
        return rng.choice(candidates)

    # -- BGM --------------------------------------------------------------
    def select_bgm(self, brief: ClipBrief) -> dict | None:
        """The best music bed for the clip's mood, or None.

        A bed must be at least as long as the clip: a 30 s clip under a 20 s
        loop would either cut off mid-phrase or need a hard loop point. Longer
        is fine — the render fades out at the clip end.
        """
        if brief.has_bgm_override:
            return None

        needed = max(brief.duration, 15.0)
        mood = brief.mood or "corporate"

        for candidate_mood in MOOD_FALLBACK.get(mood, (mood,)):
            hits = self._run(self._query(
                categories=("bgm", "music_stem"),
                moods=(candidate_mood,),
                min_duration=needed,
                require_probe=True,
            ))
            if not hits:
                # Retry without the probe requirement: an un-enriched index is
                # still a usable library, just without durations. Accept it
                # rather than shipping a silent clip.
                hits = self._run(self._query(
                    categories=("bgm", "music_stem"),
                    moods=(candidate_mood,),
                ))
            if hits:
                chosen = self._pick(hits, "bgm", brief.index)
                mix = MOOD_MIX.get(mood, MOOD_MIX["corporate"])
                asset_duration = (chosen.record.get("probe") or {}).get("duration") or 0
                return {
                    "role": "bgm",
                    "id": chosen.record["id"],
                    "path": chosen.record["path"],
                    "mood": chosen.record.get("mood") or candidate_mood,
                    "mood_requested": mood,
                    "score": chosen.score,
                    "license": chosen.record.get("license"),
                    "attribution_required": bool(chosen.record.get("attribution_required")),
                    "duration": asset_duration or None,
                    "volume": mix["volume"],
                    "duck_db": mix["duck_db"],
                    "fade_in": mix["fade_in"],
                    "fade_out": min(mix["fade_out"], max(0.5, brief.duration / 4)),
                    "loop": bool(asset_duration and asset_duration < brief.duration),
                }

        if self.explain:
            print(f"    bgm: no eligible asset for mood={mood} (need {needed:.1f}s)")
        return None

    # -- SFX --------------------------------------------------------------
    def select_sfx(self, brief: ClipBrief) -> list[dict]:
        """Fill every SFX slot the clip's timeline offers."""
        out: list[dict] = []

        for role_name, at, opportunity in place_sfx(brief):
            role = ROLE_BY_NAME.get(role_name)
            if role is None:
                continue

            hits = self._run(self._query(
                categories=("sfx",),
                text=role.query,
                tags_any=role.tags_any,
                min_duration=role.min_duration,
                max_duration=role.max_duration,
                require_probe=True,
            ))
            if not hits:
                # Fall back to tags only: a library whose filenames are numbers
                # ("sfx_018.wav") still has usable tags from its folders.
                hits = self._run(self._query(
                    categories=("sfx",), tags_any=role.tags_any,
                ))
            if not hits:
                continue

            chosen = self._pick(hits, role.name, brief.index)
            asset_duration = (chosen.record.get("probe") or {}).get("duration") or 0
            # A sound must not ring past the end of the clip.
            if asset_duration and at + asset_duration > brief.duration + 0.25:
                if self.explain:
                    print(f"    {role.name}: rejected {chosen.record['path']} "
                          f"(ends {at + asset_duration:.2f}s > {brief.duration:.2f}s)")
                continue

            out.append({
                "role": role.name,
                "at": round(at, 3),
                "id": chosen.record["id"],
                "path": chosen.record["path"],
                "score": chosen.score,
                "gain_db": role.gain_db,
                "duration": asset_duration or None,
                "license": chosen.record.get("license"),
                "opportunity": opportunity,
            })

        # One sound per instant: two SFX landing on the same frame is a bug that
        # sounds like a clipped mix.
        out.sort(key=lambda s: (s["at"], s["role"]))
        deduped: list[dict] = []
        for item in out:
            if deduped and abs(deduped[-1]["at"] - item["at"]) < 0.05:
                if self.explain:
                    print(f"    {item['role']}: dropped (collides with "
                          f"{deduped[-1]['role']} at {item['at']}s)")
                continue
            deduped.append(item)
        return deduped

    # -- visual -----------------------------------------------------------
    def select_visuals(self, brief: ClipBrief) -> dict:
        """Transition / overlay / effect assets that suit the clip's mood.

        These are advisory: the renderer applies an ffmpeg-native transition
        first (see `pipeline/transitions.py`) and only falls back to a library
        asset when one exists, because a library transition is a video file that
        must be composited, which is far more expensive than `xfade`.
        """
        result: dict = {"transition": None, "overlays": [], "effects": []}
        mood = brief.mood or "corporate"

        transition = self._run(self._query(
            categories=("transition",), moods=(mood,),
            max_duration=min(3.0, max(0.5, brief.duration / 4)),
            require_probe=True,
        )) or self._run(self._query(categories=("transition",), moods=(mood,)))
        if transition:
            chosen = self._pick(transition, "transition", brief.index)
            result["transition"] = {
                "id": chosen.record["id"],
                "path": chosen.record["path"],
                "score": chosen.score,
                "duration": (chosen.record.get("probe") or {}).get("duration"),
                "license": chosen.record.get("license"),
            }

        # At most two overlays: a clip that stacks four overlays looks like a
        # template, not an edit.
        overlays = self._run(self._query(
            categories=("overlay",), moods=(mood,), limit=8,
        ))
        for hit in overlays[:2]:
            result["overlays"].append({
                "id": hit.record["id"],
                "path": hit.record["path"],
                "score": hit.score,
                "kind": hit.record.get("kind"),
                "license": hit.record.get("license"),
            })

        effects = self._run(self._query(
            categories=("effect", "lut"), moods=(mood,), limit=5,
        ))
        for hit in effects[:1]:
            result["effects"].append({
                "id": hit.record["id"],
                "path": hit.record["path"],
                "category": hit.record.get("category"),
                "score": hit.score,
                "license": hit.record.get("license"),
            })

        return result


# ---------------------------------------------------------------------------
# Placement
# ---------------------------------------------------------------------------
# Pacing -> how many caption pops and impacts the clip can carry. A "slow"
# clip that pops on every caption reads as anxious; a "fast" clip with two
# sounds in 20 s reads as unfinished.
PACING_DENSITY = {"fast": 1.25, "balanced": 1.0, "slow": 0.7}

# Minimum spacing between two impacts, and between two caption pops.
IMPACT_MIN_GAP_SEC = 3.5
POP_MIN_GAP_SEC = 2.0

# A hook riser should end just before the hook line, not under the whole clip.
RISER_LEAD_SEC = 0.25


def place_sfx(brief: ClipBrief) -> list[tuple[str, float, str]]:
    """Decide which SFX slots exist and where they land.

    Returns a list of (role_name, at_seconds, opportunity) where `opportunity`
    is a human-readable note about what offered the slot. Ordering is by time.

    The rules, and why each exists:

      * **hook_whoosh at 0.0** — always. The first 200 ms decide whether a
        viewer keeps watching, and a whoosh under the first frame is the
        cheapest way to signal "this is edited".
      * **hook_riser before the hook line** — only when the clip has one and
        there is room. A riser that lands *on* the hook instead of just before
        it is worse than no riser.
      * **impact on beats** — capped by IMPACT_MIN_GAP_SEC so a 20 s clip with
        a 140 BPM bed does not get 46 impacts.
      * **caption_pop** — the highest-density, lowest-gain role. Thinned by
        pacing so "slow" clips stay calm.
      * **outro_ding** — lands so it finishes at the clip end, not starts there.
    """
    placements: list[tuple[str, float, str]] = []
    density = PACING_DENSITY.get(brief.pacing, 1.0)
    duration = brief.duration

    if duration <= 0:
        return placements

    # 1. Hook whoosh.
    placements.append(("hook_whoosh", 0.0, "clip start"))

    # 2. Riser, ending just before the hook.
    if brief.hook_text and duration > 4.0:
        riser_hits = [h for h in (brief.beats or []) if 0.5 <= h <= duration - 2.0]
        riser_end = riser_hits[0] if riser_hits else min(1.5, duration * 0.2)
        riser_at = max(0.0, riser_end - RISER_LEAD_SEC)
        if riser_at > 0.05:
            placements.append(("hook_riser", riser_at, "pre-hook"))

    # 3. Impacts on beats (or evenly spaced when there is no beat grid).
    beat_candidates = [b for b in (brief.beats or []) if 0.6 <= b <= duration - 0.6]
    if not beat_candidates:
        step = 60.0 / 110.0 * 8  # ~every 8 beats at 110 BPM when tempo is unknown
        beat_candidates = [step * n for n in range(1, int(duration / step) + 1)]
    last_impact = -IMPACT_MIN_GAP_SEC
    for position in beat_candidates:
        if position - last_impact < IMPACT_MIN_GAP_SEC:
            continue
        if random.Random(stable_seed("impact-gate", brief.index, round(position, 2))).random() > \
                min(1.0, ROLE_BY_NAME["impact"].density * density):
            continue
        placements.append(("impact", position, "beat"))
        last_impact = position

    # 4. Caption pops.
    pop_density = ROLE_BY_NAME["caption_pop"].density * density
    last_pop = -POP_MIN_GAP_SEC
    for start in (brief.caption_starts or []):
        if start <= 0.35 or start >= duration - 0.3:
            continue
        if start - last_pop < POP_MIN_GAP_SEC:
            continue
        if random.Random(stable_seed("pop-gate", brief.index, round(start, 2))).random() > pop_density:
            continue
        placements.append(("caption_pop", start, "caption start"))
        last_pop = start

    # 5. Outro ding, ending at the clip end.
    ding = ROLE_BY_NAME["outro_ding"]
    ding_at = max(0.0, duration - (ding.max_duration * 0.6))
    if duration > 3.0:
        placements.append(("outro_ding", ding_at, "clip end"))

    placements.sort(key=lambda p: (p[1], p[0]))
    return placements


# ---------------------------------------------------------------------------
# Plan building
# ---------------------------------------------------------------------------
def build_plan(selector: AssetSelector, brief: ClipBrief,
               want_bgm: bool = True, want_sfx: bool = True,
               want_visuals: bool = True) -> dict:
    """One clip's complete asset plan."""
    if selector.explain:
        print(f"  clip {brief.index}: mood={brief.mood} duration={brief.duration:.1f}s "
              f"pacing={brief.pacing}")

    bgm = selector.select_bgm(brief) if want_bgm else None
    sfx = selector.select_sfx(brief) if want_sfx else []
    visuals = selector.select_visuals(brief) if want_visuals else \
        {"transition": None, "overlays": [], "effects": []}

    if selector.explain and sfx:
        for item in sfx:
            print(f"    {item['role']:14} @ {item['at']:6.2f}s  {item['path']}")

    attribution = []
    if bgm and bgm.get("attribution_required"):
        attribution.append(f"music: {bgm['path']}")

    return {
        "version": PLAN_VERSION,
        "clip_index": brief.index,
        "brief": brief.to_dict(),
        "bgm": bgm,
        "sfx": sfx,
        "transition": visuals["transition"],
        "overlays": visuals["overlays"],
        "effects": visuals["effects"],
        "attribution": attribution,
        "source": "asset-library" if selector.records else "vendored",
    }


def build_plans(records: list[dict], briefs: list[ClipBrief], *,
                job_id: str = "", seed: int | None = None,
                allow_licenses: tuple[str, ...] = (),
                want_bgm: bool = True, want_sfx: bool = True,
                want_visuals: bool = True, explain: bool = False) -> dict:
    """Plans for every clip in a job, plus a library-level report."""
    selector = AssetSelector(records, allow_licenses=allow_licenses,
                             job_id=job_id, seed=seed, explain=explain)
    plans = [
        build_plan(selector, brief, want_bgm, want_sfx, want_visuals)
        for brief in briefs
    ]

    return {
        "version": PLAN_VERSION,
        "job_id": job_id,
        "generated_by": "pipeline/asset_select.py",
        "library": {
            "assets": len(records),
            "eligible": sum(
                1 for r in records
                if not asset_library.blocked_reason(r, set(allow_licenses))
            ),
            "blocked_examples": dict(list(selector.blocked.items())[:10]),
        },
        "plans": plans,
        "summary": {
            "clips": len(plans),
            "with_bgm": sum(1 for p in plans if p["bgm"]),
            "with_sfx": sum(1 for p in plans if p["sfx"]),
            "total_sfx": sum(len(p["sfx"]) for p in plans),
            "attribution_needed": sorted({a for p in plans for a in p["attribution"]}),
        },
    }


# ---------------------------------------------------------------------------
# BGM staging
# ---------------------------------------------------------------------------
def stage_bgm_files(result: dict, library_root: Path, public_bgm_dir: Path,
                    explain: bool = False) -> tuple[int, int]:
    """Copy each chosen BGM into the renderer's public dir and record it.

    Remotion resolves audio through `staticFile()`, i.e. inside
    `remotion-captions/public/`, so a library track is unplayable until it is
    COPIED there under a per-clip name. `bgm.public_path` is what
    `render_clips.py` hands to the render; `bgm.path` stays the library-relative
    provenance for the operator report.

    Fails soft per file: an unreadable/unfindable source drops `public_path`
    (the renderer then falls back to the mood map) but never aborts the plan —
    a missing asset must not fail a job the vendored library can still serve.

    Returns (staged, skipped).
    """
    staged = skipped = 0
    public_bgm_dir.mkdir(parents=True, exist_ok=True)
    for plan in result.get("plans", []):
        bgm = plan.get("bgm")
        if not isinstance(bgm, dict) or not bgm.get("path"):
            continue
        src = library_root / bgm["path"]
        if not src.is_file():
            if explain:
                print(f"    bgm stage: {src} not found — clip {plan['clip_index']} "
                      "falls back to the mood library")
            skipped += 1
            continue
        index = int(plan.get("clip_index") or 0)
        dest = public_bgm_dir / f"clip_{index:03d}{src.suffix.lower() or '.mp3'}"
        try:
            shutil.copy2(src, dest)
        except OSError as exc:
            print(f"    bgm stage: copy failed ({exc}) — clip {index} falls "
                  "back to the mood library")
            skipped += 1
            continue
        # The convention across the repo (custom BGM env, static manifest) is
        # that public audio paths are relative to remotion-captions/public/ and
        # the caller passes the bgm/ folder itself as --public-bgm-dir.
        bgm["public_path"] = f"bgm/{dest.name}"
        bgm["staged_bytes"] = dest.stat().st_size
        staged += 1
    return staged, skipped


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def load_briefs(args) -> list[ClipBrief]:
    """Briefs from an explicit brief file, a prepare manifest, or inline JSON."""
    if args.brief:
        data = json.loads(Path(args.brief).read_text(encoding="utf-8"))
        if isinstance(data, list):
            return [ClipBrief.from_dict(d) for d in data]
        return [ClipBrief.from_dict(data)]

    if args.clips:
        manifest = json.loads(Path(args.clips).read_text(encoding="utf-8"))
        moments: dict[int, dict] = {}
        moments_path = Path(args.clips).parent / "viral_moments.json"
        if moments_path.is_file():
            raw = json.loads(moments_path.read_text(encoding="utf-8"))
            items = raw if isinstance(raw, list) else (raw.get("moments") or [])
            for position, moment in enumerate(items):
                moments[int(moment.get("index", position))] = moment
        return [
            brief_from_manifest(entry, moments.get(int(entry.get("index") or 0)))
            for entry in manifest
        ]

    raise SystemExit("FATAL: pass --brief or --clips")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Select SFX/BGM/effects for clips from the asset library"
    )
    ap.add_argument("--index", default=str(asset_library.DEFAULT_INDEX_DIR),
                    help="index directory or assets.jsonl path")
    ap.add_argument("--brief", default="", help="clip brief JSON (object or array)")
    ap.add_argument("--clips", default="", help="prepare_clips.py clips_manifest.json")
    ap.add_argument("--out", default="", help="write the plan JSON here")
    ap.add_argument("--outdir", default="",
                    help="write one <outdir>/clip_XXX_assets.json per clip")
    ap.add_argument("--library-root", default="",
                    help="root dir the manifest paths resolve against "
                         "(required for --public-bgm-dir)")
    ap.add_argument("--public-bgm-dir", default="",
                    help="copy each chosen BGM into this bgm/ folder as "
                         "clip_XXX<ext> and record bgm.public_path for the "
                         "renderer")
    ap.add_argument("--job-id", default="", help="used to seed deterministic picks")
    ap.add_argument("--seed", type=int, default=None,
                    help="override the seed entirely (reproducible tests)")
    ap.add_argument("--allow-license", default="",
                    help="CSV of licences to treat as commercial-safe")
    ap.add_argument("--no-bgm", action="store_true")
    ap.add_argument("--no-sfx", action="store_true")
    ap.add_argument("--no-visuals", action="store_true")
    ap.add_argument("--explain", action="store_true")
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    records = asset_library.read_manifest(Path(args.index))
    if not records:
        # Not an error: a job must still render using the vendored library.
        print("ASSET_SELECT_WARN no asset index found — "
              "rendering with the vendored SFX/BGM library only")

    briefs = load_briefs(args)
    allow = tuple(v.strip().lower() for v in args.allow_license.split(",") if v.strip())

    result = build_plans(
        records, briefs,
        job_id=args.job_id, seed=args.seed, allow_licenses=allow,
        want_bgm=not args.no_bgm, want_sfx=not args.no_sfx,
        want_visuals=not args.no_visuals, explain=args.explain,
    )

    if args.public_bgm_dir:
        if not args.library_root:
            print("ASSET_SELECT_WARN --public-bgm-dir needs --library-root — "
                  "plans are written unstageable and the renderer will use "
                  "the mood library")
        else:
            staged, skipped = stage_bgm_files(
                result, Path(args.library_root), Path(args.public_bgm_dir),
                explain=args.explain,
            )
            print(f"ASSET_SELECT_STAGE staged={staged} skipped={skipped}")

    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(
            json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    if args.outdir:
        outdir = Path(args.outdir)
        outdir.mkdir(parents=True, exist_ok=True)
        for plan in result["plans"]:
            target = outdir / f"clip_{int(plan['clip_index']):03d}_assets.json"
            target.write_text(
                json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
        (outdir / "asset_plan.json").write_text(
            json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )

    summary = result["summary"]
    print(f"ASSET_SELECT_OK clips={summary['clips']} with_bgm={summary['with_bgm']} "
          f"with_sfx={summary['with_sfx']} total_sfx={summary['total_sfx']} "
          f"library={result['library']['assets']}")
    if summary["attribution_needed"]:
        print(f"ATTRIBUTION_REQUIRED {json.dumps(summary['attribution_needed'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())



