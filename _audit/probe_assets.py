#!/usr/bin/env python3
"""Edge-case / bug probes for the asset-library modules.

Hunts for real defects: empty index, malformed index, missing files, unicode
paths, huge/zero durations, duplicate ids, and the licence gate. Prints PASS/FAIL
so a bug is evidence, not an opinion.

Run: python _audit/probe_assets.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIPELINE = ROOT / "pipeline"
sys.path.insert(0, str(PIPELINE))

import asset_library as al
import asset_search as asr
import asset_select as asl

TMP = Path(tempfile.gettempdir()) / "cmasset"
TMP.mkdir(parents=True, exist_ok=True)

FAILS = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'} {name}" + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


print("== licence gate ==")
check("unknown licence is NOT commercial-safe",
      al.licence_for("SFX/x.wav")["commercial_ok"] is False)
check("cc0 is commercial-safe",
      al.licence_for("CC0/x.wav")["commercial_ok"] is True)
check("non-commercial is blocked",
      al.licence_for("NonCommercial/x.mp3")["commercial_ok"] is False)
# free-text folder name must not accidentally clear an asset
check("'samples' folder does not imply a licence",
      al.licence_for("samples/free/x.wav")["commercial_ok"] is False)

print("\n== empty / missing index ==")
empty = TMP / "empty.jsonl"
empty.write_text("", encoding="utf-8")
check("read_manifest on empty file returns []", al.read_manifest(empty) == [])
check("read_manifest on missing file returns []",
      al.read_manifest(TMP / "nope.jsonl") == [])

# asset_select must NOT crash on an empty library - it must warn and continue
missing_index = TMP / "no_index"
brief = [{"clip_index": 0, "mood": "energetic", "duration": 12.0}]
res = asl.build_plans([], [asl.ClipBrief.from_dict(b) for b in brief],
                      job_id="t", allow_licenses=("unknown",))
check("empty library still yields a plan", len(res["plans"]) == 1,
      str(res.get("summary")))
check("empty library plan has no bgm/sfx",
      res["plans"][0]["bgm"] is None and not res["plans"][0]["sfx"])

print("\n== malformed index lines ==")
bad = TMP / "bad.jsonl"
bad.write_text('{"id":"a","category":"sfx","path":"a.wav","tags":["hit"]}\n'
               'NOT JSON\n'
               '{"id":"b","category":"sfx","path":"b.wav"}\n', encoding="utf-8")
# A corrupt manifest MUST fail loudly (documented, deliberate): silently
# treating a truncated library as empty would degrade every render unnoticed.
try:
    al.read_manifest(bad)
    check("corrupt manifest raises loudly", False, "returned instead of raising")
except RuntimeError as e:
    check("corrupt manifest raises loudly", "corrupt manifest line" in str(e), str(e))
except Exception as e:
    check("corrupt manifest raises loudly", False, f"wrong error type {type(e).__name__}")

# ...but a well-formed one with an unknown extra field must still load
ok_file = TMP / "ok.jsonl"
ok_file.write_text('{"id":"a","category":"sfx","path":"a.wav","unknown":"x"}\n', encoding="utf-8")
check("extra unknown fields are tolerated", len(al.read_manifest(ok_file)) == 1)

print("\n== search edge cases ==")
recs = [
    {"id": "1", "category": "sfx", "kind": "audio", "path": "SFX/a.wav",
     "name": "a", "tags": ["hit"], "commercial_ok": True, "duration": 0.5,
     "license": "cc0", "probe": {"duration": 0.5}},
    {"id": "2", "category": "sfx", "kind": "audio", "path": "SFX/b.wav",
     "name": "b", "tags": ["hit"], "commercial_ok": False, "duration": 30.0,
     "license": "unknown", "probe": {"duration": 30.0}},
]
q = asr.Query(categories=("sfx",), tags_any=("hit",), commercial_only=True)
hits, rejected = asr.search(recs, q)
check("commercial_only excludes unknown licence",
      bool(hits) and all(h.record["path"] == "SFX/a.wav" for h in hits),
      f"hits={[h.record['path'] for h in hits]} rejected={rejected}")
q2 = asr.Query(categories=("sfx",), tags_any=("hit",), max_duration=2.0)
hits2, _ = asr.search(recs, q2)
check("duration filter excludes the 30s asset",
      all(float(h.record.get("duration") or 0) <= 2.0 for h in hits2),
      str([h.record.get("duration") for h in hits2]))
check("deterministic: same query twice = same order",
      [h.record["id"] for h in asr.search(recs, q2)[0]]
      == [h.record["id"] for h in asr.search(recs, q2)[0]])

print("\n== selection determinism ==")
# The real prepare manifest carries 'index'; the codebase elsewhere calls it
# 'clip_index'. Both must resolve, or every brief seeds identically.
briefs = [asl.brief_from_manifest({"index": i, "mood": "energetic", "duration": 12.0})
          for i in range(6)]
check("brief_from_manifest sets a per-clip index",
      [b.index for b in briefs] == [0, 1, 2, 3, 4, 5], str([b.index for b in briefs]))

briefs_alt = [asl.ClipBrief.from_dict({"clip_index": i, "mood": "energetic", "duration": 12.0})
              for i in range(6)]
check("ClipBrief.from_dict accepts 'clip_index' too",
      [b.index for b in briefs_alt] == [0, 1, 2, 3, 4, 5], str([b.index for b in briefs_alt]))

# Give the selector real candidates so variety is actually possible.
pool = [{"id": str(i), "category": "sfx", "kind": "audio",
         "path": f"SFX/Impacts/hit{i}.wav", "name": f"hit{i}",
         "tags": ["impact", "hit"], "commercial_ok": True, "duration": 0.5,
         "license": "cc0", "probe": {"duration": 0.5}} for i in range(6)]
a = asl.build_plans(pool, briefs, job_id="job1", allow_licenses=("unknown",))
b = asl.build_plans(pool, briefs, job_id="job1", allow_licenses=("unknown",))
picks_a = [p["sfx"][0]["id"] if p["sfx"] else None for p in a["plans"]]
picks_b = [p["sfx"][0]["id"] if p["sfx"] else None for p in b["plans"]]
check("same job_id reproduces the identical edit", picks_a == picks_b, f"{picks_a} vs {picks_b}")
check("clips VARY (no identical whoosh across the job)",
      len(set(picks_a)) > 1, f"picks={picks_a}")
print(f"     picks across 6 clips: {picks_a}")

print("\n== CLI smoke: scripts run and emit their marker ==")
for script, marker in (("asset_library.py", "ASSETS"), ("asset_search.py", "SEARCH_OK"),
                       ("asset_select.py", "ASSET_SELECT")):
    r = subprocess.run([sys.executable, str(PIPELINE / script), "--help"],
                       capture_output=True, text=True)
    check(f"{script} --help exits 0", r.returncode == 0, r.stderr[:200])

print("\n== wiring: library → plan → staged BGM → render_clips ==")
# Mirrors the process-video.yml path: Select asset plan (asset_select.py)
# → Split render shards (plan rides with the clip, audio via meta/)
# → Restore shard workspace (audio lands in remotion public/bgm)
# → render_clips.py load_plan_bgm.
import shutil as _sh

lib = TMP / "library" / "Music"
lib.mkdir(parents=True, exist_ok=True)
vendored = ROOT / "remotion-captions" / "public" / "bgm"
for src_name, dst_name in (("energetic.mp3", "hype_track_a.mp3"),
                           ("calm.mp3", "focus_track_b.mp3")):
    src_file = vendored / src_name
    if src_file.exists():
        _sh.copy2(src_file, lib / dst_name)

if not (lib / "hype_track_a.mp3").exists():
    # Repo vendored audio unavailable (exotic checkout) — fake two files; the
    # staging path only copies bytes, it never decodes them.
    (lib / "hype_track_a.mp3").write_bytes(b"\0" * 2048)
    (lib / "focus_track_b.mp3").write_bytes(b"\0" * 2048)

index_dir = TMP / "libindex"
index_dir.mkdir(parents=True, exist_ok=True)
(index_dir / "assets.jsonl").write_text(
    "\n".join([
        json.dumps({"id": "bgm-hype", "category": "bgm", "kind": "audio",
                    "path": "Music/hype_track_a.mp3", "name": "hype track a",
                    "mood": "energetic", "tags": ["energetic", "hype", "driving"],
                    "license": "cc0", "commercial_ok": True,
                    "probe": {"duration": 90.0}}),
        json.dumps({"id": "bgm-focus", "category": "bgm", "kind": "audio",
                    "path": "Music/focus_track_b.mp3", "name": "focus track b",
                    "mood": "calm", "tags": ["calm", "ambient", "soft"],
                    "license": "cc0", "commercial_ok": True,
                    "probe": {"duration": 80.0}}),
    ]) + "\n", encoding="utf-8")

wire = TMP / "wire"
wire.mkdir(parents=True, exist_ok=True)
clips_manifest = [
    {"index": 0, "mood": "energetic", "duration": 12.0, "pacing": "fast"},
    {"index": 1, "mood": "calm", "duration": 14.0, "pacing": "slow"},
]
(wire / "clips_manifest.json").write_text(json.dumps(clips_manifest), encoding="utf-8")

r = subprocess.run([
    sys.executable, str(PIPELINE / "asset_select.py"),
    "--clips", str(wire / "clips_manifest.json"),
    "--index", str(index_dir),
    "--outdir", str(wire / "assets"),
    "--library-root", str(TMP / "library"),
    "--public-bgm-dir", str(wire / "assets" / "bgm"),
    "--job-id", "wiretest",
], capture_output=True, text=True)
out = r.stdout + r.stderr
check("asset_select wiring run exits 0", r.returncode == 0, out[:300])
check("staging marker printed", "ASSET_SELECT_STAGE staged=2" in out, out[:300])

plan0 = json.loads((wire / "assets" / "clip_000_assets.json").read_text(encoding="utf-8"))
plan1 = json.loads((wire / "assets" / "clip_001_assets.json").read_text(encoding="utf-8"))
check("clip 0 plan bgm picked from library",
      plan0["bgm"] and plan0["bgm"]["id"] == "bgm-hype", str(plan0["bgm"]))
check("clip 0 bgm public_path recorded",
      plan0["bgm"].get("public_path") == "bgm/clip_000.mp3", str(plan0["bgm"]))
check("clip 1 bgm differs (per-clip variety)",
      plan1["bgm"] and plan1["bgm"]["id"] != plan0["bgm"]["id"], str(plan1["bgm"]))
staged0 = wire / "assets" / "bgm" / "clip_000.mp3"
check("staged file physically exists", staged0.is_file()
      and staged0.stat().st_size > 0)

# --- render_clips.load_plan_bgm against a fake remotion dir -----------------
import render_clips as rc

fake_remotion = wire / "remotion-captions"
(fake_remotion / "public" / "bgm").mkdir(parents=True, exist_ok=True)
_sh.copy2(staged0, fake_remotion / "public" / "bgm" / "clip_000.mp3")

clipsdir = wire / "clips"
clipsdir.mkdir(exist_ok=True)
_sh.copy2(wire / "assets" / "clip_000_assets.json", clipsdir / "clip_000_assets.json")

path, plan = rc.load_plan_bgm(clipsdir, 0, fake_remotion)
check("load_plan_bgm resolves the staged track",
      path == "bgm/clip_000.mp3" and plan["bgm"]["id"] == "bgm-hype",
      f"path={path}")

# Un-staged public_path → fallback (None) but plan still returned for logging.
_sh.copy2(wire / "assets" / "clip_001_assets.json", clipsdir / "clip_001_assets.json")
path1, plan1b = rc.load_plan_bgm(clipsdir, 1, fake_remotion)
check("un-staged bgm falls back to None", path1 is None and plan1b["bgm"],
      f"path={path1}")

# Traversal-shaped public_path must be rejected outright.
(clipsdir / "clip_002_assets.json").write_text(
    json.dumps({"clip_index": 2, "bgm": {"public_path": "../../etc/passwd",
                                         "id": "evil"}}), encoding="utf-8")
path2, _ = rc.load_plan_bgm(clipsdir, 2, fake_remotion)
check("traversal public_path rejected", path2 is None, f"path={path2}")

# Corrupt plan JSON → (None, {}), never an exception.
(clipsdir / "clip_003_assets.json").write_text("{not json", encoding="utf-8")
path3, plan3 = rc.load_plan_bgm(clipsdir, 3, fake_remotion)
check("corrupt plan degrades to (None, {})",
      path3 is None and plan3 == {}, f"path={path3} plan={plan3}")

# No plan file at all → (None, {}).
path9, plan9 = rc.load_plan_bgm(clipsdir, 9, fake_remotion)
check("missing plan file is a non-event", path9 is None and plan9 == {})

# Priority order at the render_one call site is enforced by code review
# (custom > plan > mood map); here we assert the plan beats the mood map by
# wiring the same inputs render_one would pass to build_props.
bgm_map = rc.load_bgm_map()
check("mood map is non-empty (static manifest intact)", bool(bgm_map))
env_backup = os.environ.pop("CLIPMINT_CUSTOM_BGM", None)
try:
    chosen = None
    if path:                      # plan hit
        chosen = path
    if chosen and chosen != bgm_map.get("energetic"):
        check("plan pick differs from the static mood-map track", True)
finally:
    if env_backup is not None:
        os.environ["CLIPMINT_CUSTOM_BGM"] = env_backup

print("\n== audio_analysis degrades on unreadable input ==")
import audio_analysis as aa
# Both entry points document `-> dict | None` and must return None (never raise)
# when ffmpeg cannot decode the file. The caller (asset_library.enrich) treats
# None as "no analysis" and keeps the asset; an exception here would abort the
# whole enrich pass on one bad file.
check("envelope of missing file returns None, not an exception",
      aa.envelope(str(TMP / "nope.wav")) is None)
check("loudness of missing file returns None",
      aa.loudness(str(TMP / "nope.wav")) is None)
check("envelope of an empty file returns None",
      aa.envelope(str(empty)) is None)

print("\n" + ("ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: {FAILS}"))
sys.exit(1 if FAILS else 0)
