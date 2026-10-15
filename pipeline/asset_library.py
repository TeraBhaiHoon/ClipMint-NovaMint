#!/usr/bin/env python3
"""
ClipMint asset library — index a Google Drive media library so the auto-editor
can *search* it (SFX, BGM, video effects, overlays, LUTs, transitions, voice,
b-roll) instead of being limited to the four vendored BGM tracks and four
synthesized SFX in `remotion-captions/public/`.

------------------------------------------------------------------------------
WHY A FILE MANIFEST AND NOT A DATABASE
------------------------------------------------------------------------------
The index is a JSONL file (`assets.jsonl`) plus a small `index_meta.json`. That
is deliberate:

  * The GitHub Actions runner is ephemeral. A file manifest is fetched in one
    `curl` from R2/Drive and needs no connection setup, no migrations and no
    credentials beyond what the job already has.
  * It diffs cleanly in git, so "what changed in the library" is reviewable.
  * It is the *source of truth* that any future search/cache layer (e.g. a
    Supabase assets table) would be synced FROM — the JSONL is the owner of
    the data. If a sync target is unavailable the pipeline still works.
  * Nothing in this module needs a network call to *read* the index, so the
    render step stays offline-capable and reproducible.

------------------------------------------------------------------------------
WHY rclone AND NOT THE GOOGLE DRIVE API
------------------------------------------------------------------------------
`rclone lsjson --recursive --hash` returns the full tree *with Google Drive's
own MD5 checksums* in a single paginated call, and `rclone copyto` fetches one
file on demand. Using the Drive API directly would mean OAuth token management,
quota-project configuration and hand-rolled pagination for the same result.
rclone is already a configured dependency of this pipeline (see
`.github/workflows/process-video.yml` → "Configure rclone"), so this adds no new
credential surface.

The MD5 matters: it lets an asset be identified, de-duplicated and cached
**without downloading it**. Hashing 40 GB of Drive content to build an index is
not an option on a free-tier runner; reading Drive's stored MD5 costs one API
page.

------------------------------------------------------------------------------
THREE-TIER INGEST (so a 40 GB library indexes in seconds)
------------------------------------------------------------------------------
  tier 1  `ingest --remote`   metadata only, from `rclone lsjson`. No download.
                              Duration/codec/tempo are unknown for most files.
  tier 2  `enrich`            download + ffprobe/ffmpeg-analyse a *subset*
                              (`--where category=bgm`, `--limit 200`, ...) and
                              merge the results back into the manifest.
  tier 3  `ingest --local`    index a local mirror with full analysis. This is
                              what the owner runs on the machine that already
                              holds the library, then uploads the manifest.

`fetch` resolves one asset id to a local file at render time, caching by
checksum so the same SFX is downloaded once per runner.

Usage:
  # Tier 1 — index a Drive folder (fast, no downloads)
  python3 pipeline/asset_library.py ingest \\
      --remote gdrive: --remote-path "ClipMint-Assets" \\
      --root-folder-id 1AbC... --out assets/index

  # Tier 2 — add real duration/tempo/loudness for the music + SFX
  python3 pipeline/asset_library.py enrich \\
      --index assets/index/assets.jsonl --where category=bgm,sfx --limit 500

  # Tier 3 — index a local mirror with full analysis
  python3 pipeline/asset_library.py ingest --local-dir D:\\Assets --out assets/index

  # Query
  python3 pipeline/asset_library.py stats  --index assets/index/assets.jsonl
  python3 pipeline/asset_library.py fetch  --index assets/index/assets.jsonl \\
      --id <asset_id> --out /tmp/whoosh.wav

Every subcommand prints a machine-readable marker on stdout, matching the
convention used by `smart_reframe.py` / `enhance_audio.py`:
    ASSETS_OK   total=4127 by_category={...} by_licence={...}
    ASSETS_WARN <reason>
    ENRICH_OK   enriched=128 failed=3
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

import audio_analysis  # noqa: E402  (local module; path set above)

MANIFEST_VERSION = 2
DEFAULT_INDEX_DIR = Path("assets/index")
MANIFEST_NAME = "assets.jsonl"
META_NAME = "index_meta.json"

FFPROBE = shutil.which("ffprobe") or "ffprobe"
RCLONE = shutil.which("rclone") or "rclone"
RCLONE_TIMEOUT_SEC = 900


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------
# Extension -> (kind, default category). The category here is only a *fallback*;
# path tokens below almost always override it, because a real library is
# organised by folder ("SFX/", "BGM/", "LUTs/") and the folder is a far
# stronger signal than the extension. `impact.wav` is an SFX; `Focus.mp3` in
# `BGM/` is music; both are `.wav`/`.mp3`.
EXT_KIND = {
    # audio
    ".wav": ("audio", "sfx"), ".mp3": ("audio", "bgm"), ".m4a": ("audio", "bgm"),
    ".aac": ("audio", "bgm"), ".ogg": ("audio", "bgm"), ".opus": ("audio", "bgm"),
    ".flac": ("audio", "bgm"), ".aif": ("audio", "bgm"), ".aiff": ("audio", "bgm"),
    # video
    ".mp4": ("video", "footage"), ".mov": ("video", "footage"),
    ".mkv": ("video", "footage"), ".webm": ("video", "footage"),
    ".m4v": ("video", "footage"), ".avi": ("video", "footage"),
    ".mts": ("video", "footage"), ".mxf": ("video", "footage"),
    ".braw": ("video", "footage"), ".r3d": ("video", "footage"),
    # image
    ".png": ("image", "overlay"), ".jpg": ("image", "image"),
    ".jpeg": ("image", "image"), ".webp": ("image", "image"),
    ".gif": ("image", "overlay"), ".svg": ("image", "overlay"),
    ".tif": ("image", "image"), ".tiff": ("image", "image"),
    ".psd": ("image", "template"), ".ai": ("image", "template"),
    ".exr": ("image", "overlay"),
    # other
    ".cube": ("lut", "lut"), ".3dl": ("lut", "lut"), ".look": ("lut", "lut"),
    ".cub": ("lut", "lut"),
    ".ttf": ("font", "font"), ".otf": ("font", "font"), ".woff": ("font", "font"),
    ".woff2": ("font", "font"),
    ".aep": ("template", "template"), ".aepx": ("template", "template"),
    ".mogrt": ("template", "template"), ".prproj": ("template", "template"),
    ".drfx": ("template", "template"), ".fcpxml": ("template", "template"),
    ".kdenlive": ("template", "template"), ".mlt": ("template", "template"),
    ".motn": ("template", "template"), ".comp": ("template", "template"),
    ".lottie": ("template", "template"), ".json": ("data", "template"),
}

# Path/filename token -> category. Whole-token matching (split on
# non-alphanumerics), so "bgm" inside "bgm_pack" matches but "bg" inside
# "bg-overlay" does not accidentally match "bgm".
CATEGORY_TOKENS: dict[str, tuple[str, ...]] = {
    "sfx": ("sfx", "soundeffect", "soundeffects", "foley",
            "impact", "impacts", "whoosh", "riser", "swoosh",
            "ui", "ui-sounds", "hits", "zaps"),
    "bgm": ("bgm", "music", "backgroundmusic", "tracks",
            "songs", "score", "soundtrack", "instrumental", "beats", "loops",
            "royaltyfree", "royaltyfreemusic"),
    "voice": ("voice", "voiceover", "vo", "narration",
              "speech", "tts", "vocals", "acapella", "adlibs"),
    "music_stem": ("stems", "acapellas", "instrumentals", "drumloop",
                   "drumloops"),
    "footage": ("footage", "broll", "clips", "stock", "stockvideo",
                "stockfootage", "aerial", "drone", "timelapse", "greenscreen",
                "raw"),
    "overlay": ("overlay", "overlays", "elements", "graphics", "motion",
                "motiongraphics", "stickers", "emoji",
                "shapes", "particles", "lightleaks", "flares",
                "filmgrain", "grain", "dust", "smoke", "fire", "sparks",
                "glitter", "confetti", "sparkles"),
    "effect": ("effects", "vfx", "videoeffects", "glitch",
               "distortion", "distort", "chromatic", "prism", "glow",
               "blur", "shake", "zoom", "speedramp"),
    "transition": ("transitions", "transition", "wipes", "wipe", "swipe",
                   "seamless", "seamlesstransitions"),
    "lut": ("luts", "lut", "presets", "color", "colour", "grade", "grading",
            "look", "looks", "film-emulation", "filters"),
    "template": ("templates", "template", "titles", "title", "lowerthirds",
                 "intros", "outros", "openers", "slideshows",
                 "captions", "subtitles"),
    "image": ("images", "photos", "pictures", "textures", "backgrounds",
              "wallpapers"),
    "font": ("fonts", "font", "typefaces", "typeface"),
    "project": ("projects", "project", "prproj", "finalcut", "davinci"),
}

# A licence is inferred from the path when the owner names folders after the
# source, which is the common convention ("Pixabay/", "CC0/", "Epidemic/").
LICENSE_TOKENS: list[tuple[str, str]] = [
    ("cc0", "cc0"), ("creativecommonszero", "cc0"),
    ("publicdomain", "cc0"), ("pixabay", "pixabay"), ("pexels", "pexels"),
    ("mixkit", "mixkit"), ("coverr", "coverr"), ("videvo", "videvo"),
    ("freesound", "freesound"), ("ccby", "cc-by"),
    ("creativecommons", "cc-by"), ("attribution", "cc-by"),
    ("epidemicsound", "epidemic"), ("artlist", "artlist"),
    ("envato", "envato"), ("elements", "envato"),
    ("storyblocks", "storyblocks"), ("audiojungle", "envato"),
    ("synthesized", "synthesized"), ("generated", "synthesized"),
    ("noncommercial", "non-commercial"), ("noderiv", "no-derivatives"),
]

# Which licences may be shipped inside a monetised render. `commercial_ok` is
# the only licence field the render path actually enforces, so an *unknown*
# licence is treated as NOT commercial-safe: shipping a paid render containing
# an unlicensed asset is a legal problem, while refusing to use an asset is a
# cosmetic one. `--allow-licence` is the explicit operator override.
LICENSE_SAFE: dict[str, bool] = {
    "cc0": True,
    "pixabay": True,
    "pexels": True,
    "mixkit": True,
    "coverr": True,
    "videvo": True,
    "synthesized": True,
    "cc-by": True,          # commercial OK; attribution required
    "freesound": False,     # Freesound mixes CC0 / CC-BY / CC-BY-NC per file
    "epidemic": True,       # subscription-gated — see SUBSCRIPTION_LICENSES
    "artlist": True,
    "envato": True,
    "storyblocks": True,
    "non-commercial": False,
    "no-derivatives": False,
    "unknown": False,
}

# Licences usable commercially only while a subscription is live. The pipeline
# cannot verify a subscription, so it flags them for the operator rather than
# silently allowing them.
SUBSCRIPTION_LICENSES = {"epidemic", "artlist", "envato", "storyblocks"}

STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "with", "by",
    "vol", "volume", "part", "pt", "pack", "packs", "set", "sets", "final",
    "new", "copy", "edit", "edited", "mix", "mixed", "master", "mastered",
    "hd", "uhd", "4k", "1080p", "720p", "mp3", "mp4", "wav", "mov", "png",
    "v1", "v2", "v3", "v01", "v02", "v03",
    "sample", "samples", "demo", "test", "preview", "free", "download",
    "downloaded", "assets", "asset", "files",
}

# Cross-domain synonyms so a search for "swish" finds the file named
# "whoosh_02.wav". Values are the canonical tag added to the asset's tag set.
SYNONYMS: dict[str, str] = {
    "swish": "whoosh", "swoosh": "whoosh", "sweep": "whoosh",
    "hit": "impact", "slam": "impact", "thud": "impact", "boom": "impact",
    "punch": "impact", "punchy": "impact",
    "swoop": "whoosh", "transition": "transition", "wipe": "transition",
    "smooth": "transition", "glide": "transition",
    "bell": "ding", "chime": "ding", "notify": "ding", "notification": "ding",
    "click": "pop", "tick": "pop", "tap": "pop", "bubble": "pop",
    "build": "riser", "buildup": "riser", "tension": "riser", "swell": "riser",
    "uplift": "riser", "suspense": "riser",
    "chill": "calm", "relax": "calm", "relaxing": "calm", "ambient": "calm",
    "meditation": "calm", "lofi": "calm", "soft": "calm",
    "hype": "energetic", "upbeat": "energetic", "fast": "energetic",
    "trap": "energetic", "edm": "energetic", "techno": "energetic",
    "business": "corporate", "tech": "corporate", "technology": "corporate",
    "clean": "corporate", "professional": "corporate", "startup": "corporate",
    "cinematic": "inspiring", "epic": "inspiring", "motivational": "inspiring",
    "emotional": "inspiring", "uplifting": "inspiring", "hopeful": "inspiring",
    "sad": "calm", "dark": "cinematic", "dramatic": "cinematic",
    "grain": "grain", "film-grain": "grain", "filmgrain": "grain",
    "light-leak": "lightleak", "lightleaks": "lightleak",
    "lower-third": "lowerthird", "lowerthirds": "lowerthird",
    "green-screen": "greenscreen", "green": "greenscreen",
    "speed-ramp": "speedramp", "speedramps": "speedramp",
}

MOODS = ("energetic", "calm", "corporate", "inspiring", "cinematic")

# Tag normalisation: strip anything that is not a letter, digit or hyphen.
_TAG_STRIP_RE = re.compile(r"[^a-z0-9\-]+")
_TOKEN_SPLIT_RE = re.compile(r"[^a-z0-9]+")


def tokenise(text: str) -> list[str]:
    """Split a path or filename into lowercase alphanumeric tokens.

    Splits on every non-alphanumeric character, so `Whoosh-02_final.wav`
    becomes ['whoosh', '02', 'final', 'wav']. Numeric-only tokens are kept —
    they are dropped later by the tagger, not here, because the *classifier*
    wants to see them.
    """
    return [t for t in _TOKEN_SPLIT_RE.split(text.lower()) if t]


def classify(rel_path: str) -> tuple[str, str, str]:
    """(kind, category, why) for a library-relative path.

    Path tokens beat the extension, and the *deepest* matching token wins so
    `SFX/Transitions/whoosh.wav` is an SFX rather than a transition — the
    top-level folder is the owner's own taxonomy and is more trustworthy than a
    sub-folder name that happens to collide with another category.
    """
    ext = Path(rel_path).suffix.lower()
    kind, default_category = EXT_KIND.get(ext, ("other", "other"))

    parts = tokenise(rel_path)
    if not parts:
        return kind, default_category, "extension_only"

    # Build (category, index) for every token that matches, where index is the
    # token's position in the path (0 = shallowest).
    hits: list[tuple[int, str]] = []
    for index, token in enumerate(parts):
        for category, tokens in CATEGORY_TOKENS.items():
            if token in tokens:
                hits.append((index, category))

    if not hits:
        return kind, default_category, "extension_only"

    # Shallowest match wins; ties broken by a stable category order so the
    # result is deterministic across runs and platforms.
    hits.sort(key=lambda h: (h[0], h[1]))
    best_index = hits[0][0]
    category = hits[0][1]
    return kind, category, f"path_token:{parts[best_index]}"


def derive_tags(rel_path: str, category: str) -> list[str]:
    """Searchable tags from the path: normalised tokens + canonical synonyms."""
    tags: set[str] = set()
    for token in tokenise(rel_path):
        if token in STOPWORDS or token.isdigit() or len(token) < 3:
            continue
        tag = _TAG_STRIP_RE.sub("", token)
        if not tag:
            continue
        tags.add(tag)
        # A synonym adds the CANONICAL tag (so "swish" yields "whoosh"), which
        # is what makes a keyword search behave like a thesaurus search.
        if tag in SYNONYMS:
            tags.add(SYNONYMS[tag])

    tags.add(category)
    return sorted(tags)


def derive_mood(tags: list[str], category: str) -> str | None:
    """The single best mood tag, or None. Deterministic via MOODS order."""
    for mood in MOODS:
        if mood in tags:
            return mood
    return None


def licence_for(rel_path: str, explicit: str | None = None) -> dict:
    """(licence, commercial_ok, attribution_required, note) for a path.

    `explicit` wins when supplied (a sidecar `licenses.json` or a CLI flag), so
    the owner can correct a wrong inference without renaming folders.
    """
    if explicit:
        name = explicit.strip().lower()
    else:
        parts = tokenise(rel_path)
        name = "unknown"
        for index, token in enumerate(parts):
            for needle, licence in LICENSE_TOKENS:
                if token == needle or token.startswith(needle):
                    name = licence
                    break
            if name != "unknown":
                break

    if name not in LICENSE_SAFE:
        name = "unknown"

    commercial_ok = LICENSE_SAFE[name]
    note = ""
    if name in SUBSCRIPTION_LICENSES:
        note = "subscription-gated: confirm the licence is active before shipping"
    elif name == "unknown":
        note = "licence not inferable from the path — set it in licenses.json"
    elif name == "cc-by":
        note = "attribution required in the video description"
    elif name == "freesound":
        note = "per-file licence varies on Freesound; verify each file"

    return {
        "license": name,
        "commercial_ok": commercial_ok,
        "attribution_required": name == "cc-by",
        "license_note": note,
    }


# ---------------------------------------------------------------------------
# Listing sources
# ---------------------------------------------------------------------------
def _run_rclone(args: list[str], timeout: int = RCLONE_TIMEOUT_SEC):
    """Run rclone. Returns (ok, stdout, stderr). Never raises."""
    try:
        proc = subprocess.run(
            [RCLONE, *args], capture_output=True, text=True, timeout=timeout
        )
    except FileNotFoundError:
        return False, "", "rclone not found on PATH"
    except subprocess.TimeoutExpired:
        return False, "", f"rclone timed out after {timeout}s"
    except Exception as exc:  # noqa: BLE001
        return False, "", f"rclone failed: {exc}"
    if proc.returncode != 0:
        return False, proc.stdout, (proc.stderr or "").strip()[:500]
    return True, proc.stdout, ""


def list_remote(remote: str, remote_path: str, root_folder_id: str = "") -> tuple[list[dict], str]:
    """List a Drive folder via `rclone lsjson --recursive --hash`.

    Returns (entries, error). Each entry is normalised to
    {'rel_path', 'bytes', 'md5', 'mod_time', 'id', 'is_dir'}.

    `--hash` is what makes this cheap: Drive returns the stored MD5 for binary
    files, so a 40 GB library is de-duplicated and content-addressed without a
    single byte being downloaded. Files Drive has no MD5 for (Google Docs,
    shortcut stubs) simply come back with an empty hash and fall back to a
    path+size identity.
    """
    target = f"{remote}:{remote_path}" if remote_path else f"{remote}:"

    args = ["lsjson", target, "--recursive", "--hash", "--no-mimetype", "--files-only"]
    if root_folder_id:
        # Required when the configured remote points at "My Drive" root but the
        # library lives in a folder that is not directly reachable by path.
        args += ["--drive-root-folder-id", root_folder_id]

    ok, stdout, err = _run_rclone(args)
    if not ok:
        return [], err or "rclone lsjson failed"

    try:
        raw = json.loads(stdout or "[]")
    except ValueError as exc:
        return [], f"rclone returned invalid JSON: {exc}"

    entries: list[dict] = []
    for item in raw:
        if item.get("IsDir"):
            continue
        rel = (item.get("Path") or "").replace("\\", "/").lstrip("/")
        if not rel:
            continue
        hashes = item.get("Hashes") or {}
        entries.append({
            "rel_path": rel,
            "bytes": int(item.get("Size") or 0),
            "md5": (hashes.get("md5") or hashes.get("MD5") or "").lower(),
            "mod_time": item.get("ModTime") or "",
            "id": item.get("ID") or "",
            "is_dir": False,
        })
    return entries, ""


def list_local(root: Path) -> tuple[list[dict], str]:
    """Walk a local mirror. Computes a streaming MD5 for every file.

    MD5 (not SHA-256) is chosen deliberately: it is what Drive reports, so a
    local mirror and a Drive listing produce the *same* asset id for the same
    bytes and the two indexes can be merged without re-downloading anything.
    """
    if not root.is_dir():
        return [], f"not a directory: {root}"

    entries: list[dict] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        try:
            size = path.stat().st_size
        except OSError:
            continue
        entries.append({
            "rel_path": rel,
            "bytes": size,
            "md5": md5_file(path),
            "mod_time": "",
            "id": "",
            "is_dir": False,
            "_local": str(path),
        })
    return entries, ""


def md5_file(path: Path, chunk: int = 1 << 20) -> str:
    """Streaming MD5. Returns '' on an unreadable file rather than raising."""
    digest = hashlib.md5()
    try:
        with open(path, "rb") as fh:
            while True:
                block = fh.read(chunk)
                if not block:
                    break
                digest.update(block)
    except OSError:
        return ""
    return digest.hexdigest()


def asset_id(entry: dict) -> str:
    """Stable, content-addressed id.

    Preference order:
      1. md5:<hash>          identical bytes anywhere => identical id
      2. path:<sha1 prefix>  no hash available (Drive stub) => identity by path
    The `path:` fallback is stable across runs but NOT across a rename, which is
    correct: a renamed file without a checksum cannot be proven identical.
    """
    md5 = (entry.get("md5") or "").strip().lower()
    if md5:
        return f"md5:{md5}"
    key = f"{entry.get('rel_path','')}|{entry.get('bytes',0)}"
    return "path:" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:24]


# ---------------------------------------------------------------------------
# Media probing
# ---------------------------------------------------------------------------
def probe_media(path: str) -> dict:
    """ffprobe a local media file into flat, JSON-safe fields.

    Best-effort: a corrupt or unsupported file yields {} rather than failing the
    ingest. Only called on local files (see the tiering note in the docstring) —
    probing a Drive object would require downloading it.
    """
    try:
        proc = subprocess.run(
            [FFPROBE, "-v", "error", "-print_format", "json",
             "-show_format", "-show_streams", str(path)],
            capture_output=True, timeout=120,
        )
        if proc.returncode != 0:
            return {}
        data = json.loads(proc.stdout or b"{}")
    except Exception:  # noqa: BLE001
        return {}

    out: dict = {}
    fmt = data.get("format") or {}
    try:
        out["duration"] = round(float(fmt.get("duration")), 3)
    except (TypeError, ValueError):
        pass
    try:
        out["size_bytes"] = int(fmt.get("size"))
    except (TypeError, ValueError):
        pass

    for stream in data.get("streams") or []:
        ctype = stream.get("codec_type")
        if ctype == "video" and "width" not in out:
            out["width"] = stream.get("width")
            out["height"] = stream.get("height")
            out["vcodec"] = stream.get("codec_name")
            out["pix_fmt"] = stream.get("pix_fmt")
            rate = stream.get("avg_frame_rate") or stream.get("r_frame_rate") or ""
            if "/" in rate:
                num, _, den = rate.partition("/")
                try:
                    out["fps"] = round(float(num) / float(den), 3) if float(den) else None
                except (TypeError, ValueError):
                    pass
        elif ctype == "audio" and "acodec" not in out:
            out["acodec"] = stream.get("codec_name")
            try:
                out["sample_rate"] = int(stream.get("sample_rate"))
            except (TypeError, ValueError):
                pass
            out["channels"] = stream.get("channels")
    return out


def analyse_media(path: str, kind: str) -> dict:
    """Media probe plus audio analysis, for local files only."""
    probe = probe_media(path)
    if kind == "audio":
        audio = audio_analysis.analyse(path, with_envelope=False, with_tempo=True)
        if audio:
            for key in ("duration", "lufs", "true_peak_dbfs", "lra",
                        "energy", "dynamics", "bpm", "beat_confidence",
                        "beat_sync_ok", "has_rhythm", "codec", "sample_rate",
                        "channels", "bit_rate"):
                value = audio.get(key)
                if value is not None:
                    probe[key] = value
    elif kind == "video":
        # A video's own audio track is what BGM ducking and loudness matching
        # care about, so analyse it too when present.
        audio = audio_analysis.analyse(path, with_envelope=False, with_tempo=False)
        if audio:
            for key in ("lufs", "true_peak_dbfs", "codec"):
                value = audio.get(key)
                if value is not None:
                    probe.setdefault(f"audio_{key}", value)
    return probe


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------
def build_record(entry: dict, source: str, licences: dict[str, str] | None = None,
                 probed: dict | None = None) -> dict:
    """One manifest record. Field order is stable so the JSONL diffs cleanly."""
    rel = entry["rel_path"]
    kind, category, why = classify(rel)
    tags = derive_tags(rel, category)
    explicit = None
    if licences:
        explicit = licences.get(rel) or licences.get(Path(rel).name)
    licence = licence_for(rel, explicit)

    record = {
        "id": asset_id(entry),
        "version": MANIFEST_VERSION,
        "path": rel,
        "name": Path(rel).name,
        "ext": Path(rel).suffix.lower(),
        "kind": kind,
        "category": category,
        "category_why": why,
        "tags": tags,
        "mood": derive_mood(tags, category),
        "bytes": entry.get("bytes", 0),
        "md5": entry.get("md5") or "",
        "source": source,
        "drive_id": entry.get("id") or "",
        "mod_time": entry.get("mod_time") or "",
        **licence,
    }
    if probed:
        record["probe"] = probed
        record["probed_at"] = now_iso()
    return record


def blocked_reason(record: dict, allow: set[str] | None = None) -> str:
    """Why this asset must NOT be used in a monetised render. '' when fine.

    An asset with an unknown licence is blocked. That direction is deliberate:
    using a mis-licensed asset in a paid video is a legal exposure, while not
    using it is a cosmetic one. `allow` is the operator's explicit override
    (`--allow-licence`), which is also how a subscription licence is released.
    """
    licence = record.get("license") or "unknown"
    if allow and licence in allow:
        return ""
    if record.get("commercial_ok"):
        return ""
    if licence == "unknown":
        return "unlicensed (licence could not be inferred; set it in licenses.json)"
    return f"licence '{licence}' is not cleared for commercial use"


def write_manifest(records: list[dict], index_dir: Path, meta: dict) -> Path:
    """Write assets.jsonl (sorted, deterministic) + index_meta.json."""
    index_dir.mkdir(parents=True, exist_ok=True)
    manifest = index_dir / MANIFEST_NAME

    # Sort by path so two ingests of the same library produce byte-identical
    # files. That is what makes `git diff` on the manifest meaningful and lets
    # the workflow skip an upload when nothing changed.
    ordered = sorted(records, key=lambda r: r["path"].lower())
    with open(manifest, "w", encoding="utf-8", newline="\n") as fh:
        for record in ordered:
            fh.write(json.dumps(record, ensure_ascii=False, sort_keys=False) + "\n")

    meta = dict(meta)
    meta["manifest"] = MANIFEST_NAME
    meta["manifest_version"] = MANIFEST_VERSION
    meta["asset_count"] = len(ordered)
    meta["generated_at"] = now_iso()
    meta["total_bytes"] = sum(int(r.get("bytes") or 0) for r in ordered)
    (index_dir / META_NAME).write_text(
        json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return manifest


def read_manifest(path: Path) -> list[dict]:
    """Load assets.jsonl.

    Tolerates a missing file (returns []) but NOT corrupt JSON: a half-written
    manifest must be a loud error, because silently treating a truncated library
    as an empty one would degrade every render without anyone noticing.
    """
    path = Path(path)
    if path.is_dir():
        path = path / MANIFEST_NAME
    if not path.is_file():
        return []
    records: list[dict] = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except ValueError as exc:
            raise RuntimeError(f"{path}:{lineno}: corrupt manifest line: {exc}") from exc
    return records


def load_licences(path: str | None) -> dict[str, str]:
    """Optional sidecar `licenses.json`: {path-or-filename: licence-name}.

    Lets the owner correct a wrong inference (or clear a subscription licence)
    without renaming folders in the library.
    """
    if not path:
        return {}
    source = Path(path)
    if not source.is_file():
        raise SystemExit(f"FATAL: licences file not found: {path}")
    try:
        data = json.loads(source.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise SystemExit(f"FATAL: {path} is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise SystemExit(f"FATAL: {path} must be a JSON object of path -> licence")
    return {str(k): str(v) for k, v in data.items()}


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------
def ingest(entries: list[dict], source: str, index_dir: Path,
           licences: dict[str, str] | None = None, probe: bool = False,
           kinds: set[str] | None = None, limit: int = 0,
           progress_every: int = 200) -> list[dict]:
    """Build the manifest from listing entries.

    `probe` only makes sense for local files; callers pass entries that came
    from `list_local` (which carry `_local`) when they want real media metadata.
    """
    records: list[dict] = []
    probed_count = 0
    for entry in entries:
        kind, _, _ = classify(entry["rel_path"])
        if kinds and kind not in kinds:
            continue

        probed = None
        local = entry.get("_local")
        # `limit` caps the expensive probing, never the listing: the index must
        # still know about every file even when only some were analysed, or a
        # partial enrich would silently shrink the library.
        if probe and local and Path(local).is_file() and (not limit or probed_count < limit):
            probed = analyse_media(local, kind)
            probed_count += 1
            if progress_every and probed_count % progress_every == 0:
                print(f"  probed {probed_count} file(s)...", flush=True)

        records.append(build_record(entry, source, licences, probed))

    return records


def merge_probe(existing: dict, probed: dict) -> dict:
    """Merge fresh probe data into a record, preserving everything else."""
    merged = dict(existing)
    if probed:
        merged["probe"] = probed
        merged["probed_at"] = now_iso()
    return merged


def enrich_remote(records: list[dict], remote: str, remote_path: str,
                  work_dir: Path, root_folder_id: str = "", limit: int = 0,
                  timeout_each: int = 300) -> tuple[int, int, list[str]]:
    """Download-and-probe a subset of a Drive-backed index.

    Returns (enriched, failed, errors). Each file is downloaded, analysed and
    deleted immediately, so peak disk usage is one asset — this matters when the
    runner has ~14 GB free and the library does not.
    """
    work_dir.mkdir(parents=True, exist_ok=True)
    enriched = failed = 0
    errors: list[str] = []

    for record in records:
        if limit and enriched >= limit:
            break
        if record.get("probe"):
            continue
        kind = record.get("kind")
        if kind not in ("audio", "video"):
            continue

        rel = record["path"]
        remote_src = f"{remote}:{remote_path}/{rel}" if remote_path else f"{remote}:{rel}"
        local = work_dir / Path(rel).name
        args = ["copyto", remote_src, str(local), "--stats-one-line"]
        if root_folder_id:
            args += ["--drive-root-folder-id", root_folder_id]

        ok, _, err = _run_rclone(args, timeout=timeout_each)
        if not ok or not local.is_file():
            failed += 1
            errors.append(f"{rel}: {err or 'download produced no file'}")
            continue

        try:
            merged = merge_probe(record, analyse_media(str(local), kind))
            record.clear()
            record.update(merged)
            enriched += 1
        except Exception as exc:  # noqa: BLE001
            failed += 1
            errors.append(f"{rel}: probe failed: {exc}")
        finally:
            try:
                local.unlink(missing_ok=True)
            except OSError:
                pass

    return enriched, failed, errors


def fetch(record: dict, remote: str, remote_path: str, out_path: Path,
          root_folder_id: str = "", timeout: int = 600) -> tuple[bool, str]:
    """Download one asset to `out_path` (cached by checksum by the caller)."""
    rel = record["path"]
    remote_src = f"{remote}:{remote_path}/{rel}" if remote_path else f"{remote}:{rel}"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    args = ["copyto", remote_src, str(out_path)]
    if root_folder_id:
        args += ["--drive-root-folder-id", root_folder_id]
    ok, _, err = _run_rclone(args, timeout=timeout)
    if not ok:
        return False, err
    if not out_path.is_file():
        return False, "rclone reported success but produced no file"
    return True, ""


def summarise(records: list[dict], allow: set[str] | None = None) -> dict:
    """Counts by category / kind / licence, plus how much is render-eligible."""
    by_category: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    by_licence: dict[str, int] = {}
    blocked = 0
    total_bytes = 0

    for record in records:
        by_category[record.get("category", "other")] = \
            by_category.get(record.get("category", "other"), 0) + 1
        by_kind[record.get("kind", "other")] = \
            by_kind.get(record.get("kind", "other"), 0) + 1
        licence = record.get("license", "unknown")
        by_licence[licence] = by_licence.get(licence, 0) + 1
        total_bytes += int(record.get("bytes") or 0)
        if blocked_reason(record, allow):
            blocked += 1

    return {
        "total": len(records),
        "render_eligible": len(records) - blocked,
        "blocked": blocked,
        "total_bytes": total_bytes,
        "by_category": dict(sorted(by_category.items())),
        "by_kind": dict(sorted(by_kind.items())),
        "by_licence": dict(sorted(by_licence.items())),
        "probed": sum(1 for r in records if r.get("probe")),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _split_csv(value: str) -> set[str]:
    return {v.strip().lower() for v in value.split(",") if v.strip()}


def cmd_ingest(args) -> int:
    licences = load_licences(args.licences)
    index_dir = Path(args.out)
    kinds = _split_csv(args.kinds) if args.kinds else None

    if args.local_dir:
        root = Path(args.local_dir)
        entries, err = list_local(root)
        source = f"local:{root}"
    else:
        entries, err = list_remote(args.remote, args.remote_path, args.root_folder_id)
        source = f"drive:{args.remote}:{args.remote_path}"

    if err:
        print(f"ASSETS_ERROR {err}", file=sys.stderr)
        return 1
    if not entries:
        print("ASSETS_WARN empty_listing (check the remote/path and folder id)")
        return 1

    print(f"listed {len(entries)} file(s) from {source}")
    records = ingest(
        entries, source, index_dir, licences,
        probe=not args.no_probe, kinds=kinds, limit=args.limit,
    )
    manifest = write_manifest(records, index_dir, {
        "source": source,
        "remote": "" if args.local_dir else args.remote,
        "remote_path": "" if args.local_dir else args.remote_path,
        "root_folder_id": "" if args.local_dir else args.root_folder_id,
        "probed": bool(not args.no_probe),
    })

    stats = summarise(records)
    print(f"ASSETS_OK total={stats['total']} by_category={json.dumps(stats['by_category'])} "
          f"by_licence={json.dumps(stats['by_licence'])} eligible={stats['render_eligible']}")
    print(f"manifest: {manifest}")
    return 0


def cmd_stats(args) -> int:
    records = read_manifest(Path(args.index))
    if not records:
        print(f"ASSETS_ERROR no manifest at {args.index}", file=sys.stderr)
        return 1
    allow = _split_csv(args.allow_licence) if args.allow_licence else None
    stats = summarise(records, allow)
    print(json.dumps(stats, indent=2))
    print(f"ASSETS_OK total={stats['total']} eligible={stats['render_eligible']} "
          f"blocked={stats['blocked']} probed={stats['probed']}")
    return 0


def cmd_categories(args) -> int:
    """Dump the classification taxonomy (used by the docs and by tests)."""
    print(json.dumps({
        "categories": sorted(CATEGORY_TOKENS),
        "extensions": {k: list(v) for k, v in sorted(EXT_KIND.items())},
        "licenses": {k: v for k, v in sorted(LICENSE_SAFE.items())},
    }, indent=2))
    return 0


def cmd_enrich(args) -> int:
    index_dir = Path(args.index)
    records = read_manifest(index_dir)
    if not records:
        print(f"ASSETS_ERROR no manifest at {index_dir}", file=sys.stderr)
        return 1

    wanted = _split_csv(args.where) if args.where else None
    targets = [
        r for r in records
        if not r.get("probe")
        and r.get("kind") in ("audio", "video")
        and (not wanted or r.get("category") in wanted)
    ]
    if not targets:
        print("ENRICH_OK enriched=0 failed=0 (nothing left to probe)")
        return 0

    print(f"enriching {len(targets)} asset(s) via {args.remote}")
    enriched, failed, errors = enrich_remote(
        targets, args.remote, args.remote_path, Path(args.work_dir),
        root_folder_id=args.root_folder_id, limit=args.limit, timeout_each=args.timeout,
    )

    # Rebuild the manifest from the (mutated) target records plus the untouched
    # remainder, so a partial enrich never drops the un-enriched majority.
    by_id = {r["id"]: r for r in records}
    for record in targets:
        by_id[record["id"]] = record
    write_manifest(list(by_id.values()), index_dir, {
        "source": args.remote, "remote": args.remote,
        "remote_path": args.remote_path, "root_folder_id": args.root_folder_id,
        "probed": True,
    })

    for error in errors[:20]:
        print(f"  ! {error}")
    print(f"ENRICH_OK enriched={enriched} failed={failed}")
    return 0 if enriched or not failed else 1


def cmd_fetch(args) -> int:
    records = read_manifest(Path(args.index))
    match = next((r for r in records if r["id"] == args.id), None)
    if not match:
        print(f"ASSETS_ERROR asset id not found: {args.id}", file=sys.stderr)
        return 1
    ok, err = fetch(match, args.remote, args.remote_path, Path(args.out),
                    root_folder_id=args.root_folder_id)
    if not ok:
        print(f"ASSETS_ERROR {err}", file=sys.stderr)
        return 1
    print(f"FETCH_OK id={args.id} out={args.out}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="ClipMint asset library — index and search a Drive media library"
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    def add_remote_args(p):
        p.add_argument("--remote", default="gdrive",
                       help="rclone remote name (default: gdrive)")
        p.add_argument("--remote-path", default="",
                       help="folder inside the remote, e.g. ClipMint-Assets")
        p.add_argument("--root-folder-id", default="",
                       help="Drive folder id (needed when the path is not reachable)")

    p = sub.add_parser("ingest", help="build the index (metadata-only, or full for --local-dir)")
    add_remote_args(p)
    p.add_argument("--out", default=str(DEFAULT_INDEX_DIR))
    p.add_argument("--local-dir", default="", help="index a local mirror instead of Drive")
    p.add_argument("--licences", default="", help="licenses.json sidecar (path -> licence)")
    p.add_argument("--kinds", default="", help="CSV of kinds to keep: audio,video,image")
    p.add_argument("--limit", type=int, default=0, help="max files to probe (0 = all)")
    p.add_argument("--no-probe", action="store_true",
                   help="skip ffprobe/ffmpeg analysis (fast; for Drive listings)")
    p.set_defaults(func=cmd_ingest)

    p = sub.add_parser("enrich", help="download + analyse a subset and merge into the index")
    add_remote_args(p)
    p.add_argument("--index", default=str(DEFAULT_INDEX_DIR))
    p.add_argument("--where", default="",
                   help="CSV of categories to enrich, e.g. bgm,sfx (default: all)")
    p.add_argument("--work-dir", default=".asset-work")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--timeout", type=int, default=300, help="per-file download timeout (s)")
    p.set_defaults(func=cmd_enrich)

    p = sub.add_parser("stats", help="summary of the index")
    p.add_argument("--index", default=str(DEFAULT_INDEX_DIR))
    p.add_argument("--allow-licence", default="",
                   help="CSV of extra licences to treat as commercial-safe")
    p.set_defaults(func=cmd_stats)

    p = sub.add_parser("fetch", help="download one asset by id")
    add_remote_args(p)
    p.add_argument("--index", default=str(DEFAULT_INDEX_DIR))
    p.add_argument("--id", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_fetch)

    p = sub.add_parser("categories", help="print the classification taxonomy")
    p.set_defaults(func=cmd_categories)

    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
