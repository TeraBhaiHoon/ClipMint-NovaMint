#!/usr/bin/env python3
"""
ClipMint pipeline — render captions onto every prepared clip, in parallel.

This replaces a bash `for` loop whose failure path was:

    npx remotion render ... || { echo "failed"; cp "$clip" "$OUTPUT"; }

That fallback silently shipped the ORIGINAL, UNCAPTIONED clip and still
reported the job as successful. It hid a Remotion version mismatch for an
unknown length of time, so the product delivered uncaptioned videos while
telling users the job succeeded.

Behaviour now:
  * Each clip renders independently and its real status is recorded.
  * A clip whose render fails is NOT replaced with a raw copy. It is reported
    as failed, and the clip row is marked failed so the dashboard can show it.
  * Every render is ffprobe-validated afterwards: file exists, video stream
    decodes, and the duration is within 0.5 s of what was requested. A file
    that is short, empty or stream-less counts as a failure, not a success.
  * Partial success is surfaced: the job completes, but the summary names how
    many clips failed and why.
  * Total failure returns a non-zero exit code so the workflow fails the job.
  * When the job asks for formats beyond 9x16, each extra format is rendered
    FROM THE PRE-REFRAME CUT (kept by prepare_clips.py) at the format's own
    dimensions with layout "cover": 1x1 = 1080x1080, 16x9 = 1920x1080, saved
    as clip_XXX_1x1.mp4 / clip_XXX_16x9.mp4 and validated the same way.

Usage:
  python3 pipeline/render_clips.py \
      --clipsdir workspace/clips \
      --outdir workspace/captioned \
      --remotion-dir remotion-captions \
      --style hormozi --concurrency 2 \
      [--platform tiktok] [--caption-pace fast|balanced|slow] \
      [--formats 9x16,1x1,16x9] [--report workspace/render_report.json]
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_TIMEOUT_SEC = 900

# Caption pacing (backlog: caption pace). Page size + page gap control how
# fast the captions cycle; fast = punchier, slow = easier to read.
CAPTION_PACE = {
    "fast": {"maxWordsPerPage": 3, "maxCharsPerPage": 20, "pageBreakGapMs": 300},
    "balanced": {"maxWordsPerPage": 4, "maxCharsPerPage": 26, "pageBreakGapMs": 420},
    "slow": {"maxWordsPerPage": 5, "maxCharsPerPage": 32, "pageBreakGapMs": 560},
}

# Extra aspect formats rendered from the pre-reframe cut (backlog 3.4).
FORMAT_DIMENSIONS = {
    "1x1": (1080, 1080),
    "16x9": (1920, 1080),
}

DURATION_TOLERANCE_SEC = 0.5

PIPELINE_DIR = Path(__file__).resolve().parent


def load_bgm_map() -> dict:
    """bgm[mood] → file name, from the assets manifest owned by the audio
    pack. The manifest is optional: absent, unreadable or mood-less simply
    means the render engine's own defaults apply."""
    manifest_path = PIPELINE_DIR / "assets_manifest.json"
    if not manifest_path.exists():
        return {}
    try:
        data = json.loads(manifest_path.read_text())
        bgm = data.get("bgm")
        return bgm if isinstance(bgm, dict) else {}
    except (OSError, ValueError) as exc:
        print(f"! assets_manifest.json unreadable ({exc}) — engine default BGM applies")
        return {}


def validate_render(path: Path, expected_sec: float) -> tuple[bool, str]:
    """ffprobe a finished render: exists, video stream present, duration
    within tolerance of the requested length."""
    if not path.exists() or path.stat().st_size < 20_000:
        return False, f"output missing or under 20 KB ({path.name})"
    resp = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams",
         str(path)],
        capture_output=True, text=True,
    )
    if resp.returncode != 0:
        return False, f"ffprobe failed on output: {resp.stderr[:200]}"
    try:
        data = json.loads(resp.stdout)
    except ValueError:
        return False, "ffprobe returned unparseable output"
    streams = data.get("streams", [])
    if not any(s.get("codec_type") == "video" for s in streams):
        return False, "output has no video stream"
    duration = float(data.get("format", {}).get("duration") or 0.0)
    if duration <= 0:
        return False, "output duration is zero"
    if expected_sec > 0 and abs(duration - expected_sec) > DURATION_TOLERANCE_SEC:
        return False, f"duration {duration:.2f}s differs from expected {expected_sec:.2f}s"
    return True, ""


def build_props(
    clip_filename: str,
    captions_json: str,
    duration_frames: int,
    style: str,
    platform: str,
    has_audio: bool,
    pace: dict,
    bgm_src: str | None,
    sfx_enabled: bool | None,
) -> dict:
    """Props must match remotion-captions/src/CaptionedClip.tsx exactly.

    `layout: "cover"` because prepare_clips.py already produced a 1080x1920
    file — the blur-fill letterbox path is only for un-reframed sources.

    `hasAudio` is the safety interlock for the audio analyser: Remotion's
    `useWindowedAudioData` calls `cancelRender()` (uncatchable) when it cannot
    find an audio track, so we only enable reactivity when ffprobe confirmed
    a stream. This value comes from the preparation manifest, not a guess.

    `bgmSrc`/`sfxEnabled` are only set when the assets manifest provides a
    track for this clip's mood — otherwise the keys are omitted and the
    engine's defaults apply.
    """
    props: dict = {
        "videoSrc": clip_filename,
        "durationInFrames": duration_frames,
        "captionsData": captions_json,
        "captionStyle": style,
        "backgroundColor": "#000000",
        "accentColor": "#39E508",
        "fontSize": 68,
        "trimStartSec": 0,
        "trimEndSec": 0,
        "layout": "cover",
        "platform": platform,
        "showWatermark": True,
        "brandText": "CLIPMINT",
        "showProgressBar": True,
        "hasAudio": has_audio,
        "audioReactive": os.environ.get("CLIPMINT_AUDIO_REACTIVE", "1") == "1" and has_audio,
    }
    props.update(pace)
    if bgm_src:
        props["bgmSrc"] = bgm_src
    if sfx_enabled is not None:
        props["sfxEnabled"] = sfx_enabled
    return props


def render_one(
    entry: dict,
    clipsdir: Path,
    outdir: Path,
    remotion_dir: Path,
    public_dir: Path,
    props_dir: Path,
    style: str,
    platform: str,
    fps: int,
    timeout: int,
    pace: dict,
    variant: str,
    bgm_map: dict,
) -> dict:
    """Render one master (variant='9x16') or one extra-format variant."""
    index = entry["index"]
    suffix = "" if variant == "9x16" else f"_{variant}"
    clip_path = clipsdir / entry["file"]
    if variant != "9x16":
        cut_name = entry.get("cut_file", "")
        clip_path = clipsdir / cut_name if cut_name else clip_path
    captions_path = clipsdir / f"clip_{index:03d}.captions.json"
    output = outdir / f"clip_{index:03d}{suffix}_captioned.mp4" if variant == "9x16" \
        else outdir / f"clip_{index:03d}_{variant}.mp4"

    result = {
        "index": index,
        "variant": variant,
        "ok": False,
        "input": str(clip_path),
        "output": str(output),
        "error": "",
    }

    if not clip_path.exists():
        result["error"] = ("prepared clip missing" if variant == "9x16"
                           else "pre-reframe cut missing for variant render")
        return result
    if not captions_path.exists():
        result["error"] = "captions file missing"
        return result

    captions_json = captions_path.read_text()
    if not captions_json.strip() or captions_json.strip() == "[]":
        result["error"] = "captions file is empty"
        return result

    duration_sec = float(entry.get("duration") or 0)
    if duration_sec <= 0:
        result["error"] = "clip duration is zero"
        return result
    duration_frames = max(1, round(duration_sec * fps))

    # Remotion resolves staticFile() inside its own public/ directory, so the
    # clip is copied in for the duration of the render (unique name per clip
    # AND variant so parallel renders cannot collide).
    public_clip = f"_render_{index:03d}{suffix}.mp4"
    shutil.copy2(clip_path, public_dir / public_clip)

    mood = entry.get("mood") or ""
    bgm_src = bgm_map.get(mood) if mood else None
    sfx_enabled: bool | None = None
    if bgm_src:
        sfx_enabled = os.environ.get("CLIPMINT_SFX", "1") == "1"

    props = build_props(
        public_clip, captions_json, duration_frames, style, platform,
        bool(entry.get("has_audio")), pace, bgm_src, sfx_enabled,
    )
    props_file = props_dir / f"props_{index:03d}{suffix}.json"
    props_file.write_text(json.dumps(props))

    cmd = [
        "npx", "remotion", "render", "CaptionedClip", str(output.resolve()),
        f"--props={props_file.resolve()}",
        "--codec=h264", "--video-bitrate=10M",
        "--concurrency=2", "--log=error",
    ]
    if variant != "9x16":
        width, height = FORMAT_DIMENSIONS[variant]
        cmd += [f"--width={width}", f"--height={height}"]

    try:
        resp = subprocess.run(
            cmd,
            cwd=str(remotion_dir),
            capture_output=True, text=True, timeout=timeout,
            shell=(os.name == "nt"),
        )
        if resp.returncode == 0 and output.exists() and output.stat().st_size > 20_000:
            ok, reason = validate_render(output, duration_sec)
            if ok:
                result["ok"] = True
                result["bytes"] = output.stat().st_size
            else:
                result["error"] = f"render validation failed: {reason}"
        else:
            tail = (resp.stderr or resp.stdout or "").strip().splitlines()
            result["error"] = (
                " | ".join(l.strip() for l in tail[-4:] if l.strip())[:500]
                or f"render exited {resp.returncode} with no output"
            )
    except subprocess.TimeoutExpired:
        result["error"] = f"render timed out after {timeout}s"
    except Exception as exc:  # noqa: BLE001
        result["error"] = f"{type(exc).__name__}: {exc}"[:500]
    finally:
        (public_dir / public_clip).unlink(missing_ok=True)
        props_file.unlink(missing_ok=True)

    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clipsdir", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--remotion-dir", required=True)
    ap.add_argument("--style", default="hormozi")
    ap.add_argument("--platform", default="tiktok")
    ap.add_argument("--caption-pace", default="balanced", choices=sorted(CAPTION_PACE))
    ap.add_argument("--formats", default="9x16",
                    help="CSV of output aspect ratios (9x16,1x1,16x9)")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--concurrency", type=int, default=2)
    ap.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SEC)
    ap.add_argument("--report", default="")
    args = ap.parse_args()

    clipsdir = Path(args.clipsdir)
    outdir = Path(args.outdir)
    remotion_dir = Path(args.remotion_dir)
    outdir.mkdir(parents=True, exist_ok=True)

    requested_formats = [f.strip() for f in args.formats.split(",") if f.strip()]
    extra_formats = [f for f in requested_formats if f != "9x16"]
    unknown = [f for f in requested_formats if f not in ("9x16", *FORMAT_DIMENSIONS)]
    if unknown:
        print(f"FATAL: unsupported formats {unknown} — allowed: 9x16, "
              f"{', '.join(FORMAT_DIMENSIONS)}", file=sys.stderr)
        return 2

    manifest_path = clipsdir / "clips_manifest.json"
    if not manifest_path.exists():
        print("FATAL: clips_manifest.json missing — prepare step did not run", file=sys.stderr)
        return 2
    manifest = json.loads(manifest_path.read_text())
    if not manifest:
        print("FATAL: no prepared clips to render", file=sys.stderr)
        return 2

    public_dir = remotion_dir / "public"
    public_dir.mkdir(parents=True, exist_ok=True)
    props_dir = clipsdir / "_props"
    props_dir.mkdir(parents=True, exist_ok=True)

    pace = CAPTION_PACE[args.caption_pace]
    bgm_map = load_bgm_map()
    if bgm_map:
        print(f"bgm moods available: {', '.join(sorted(bgm_map))}")

    # One worker unit = master render (+ its variants, sequentially). Variant
    # renders share the master's ffmpeg/Remotion warm-up, and keeping them in
    # the same worker halves the peak disk usage of the public/ copies.
    workers = max(1, min(args.concurrency, max(1, (os.cpu_count() or 4) // 2)))
    print(f"rendering {len(manifest)} clip(s) with style={args.style} "
          f"pace={args.caption_pace} formats={','.join(['9x16', *extra_formats])} "
          f"workers={workers} fps={args.fps}")

    def render_entry(entry: dict) -> list[dict]:
        outputs = [render_one(entry, clipsdir, outdir, remotion_dir, public_dir,
                              props_dir, args.style, args.platform, args.fps,
                              args.timeout, pace, "9x16", bgm_map)]
        for variant in extra_formats:
            if not entry.get("cut_file"):
                outputs.append({
                    "index": entry["index"], "variant": variant, "ok": False,
                    "output": "", "error": "no cut_file in prepare manifest",
                })
                continue
            outputs.append(render_one(entry, clipsdir, outdir, remotion_dir, public_dir,
                                      props_dir, args.style, args.platform, args.fps,
                                      args.timeout, pace, variant, bgm_map))
        return outputs

    results: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(render_entry, entry): entry for entry in manifest}
        for fut in concurrent.futures.as_completed(futures):
            entry = futures[fut]
            try:
                batch = fut.result()
            except Exception as exc:  # noqa: BLE001
                batch = [{"index": entry["index"], "variant": "9x16", "ok": False,
                          "error": f"worker crashed: {exc}"}]
            for res in batch:
                results.append(res)
                label = res.get("variant", "9x16")
                if res["ok"]:
                    print(f"  [{res['index']}:{label}] OK {res.get('bytes', 0):,} bytes")
                else:
                    print(f"  [{res['index']}:{label}] FAILED: {res['error']}")

    results.sort(key=lambda r: (r["index"], r.get("variant", "9x16")))
    ok = [r for r in results if r["ok"]]
    failed = [r for r in results if not r["ok"]]

    masters_ok = {r["index"] for r in ok if r.get("variant", "9x16") == "9x16"}

    report = {
        "style": args.style,
        "caption_pace": args.caption_pace,
        "formats": ["9x16", *extra_formats],
        "requested": len(manifest),
        "succeeded": len(ok),
        "failed": len(failed),
        "results": results,
    }
    report_path = Path(args.report) if args.report else (clipsdir / "render_report.json")
    report_path.write_text(json.dumps(report, indent=2))

    print(f"RENDER_SUMMARY ok={len(ok)} failed={len(failed)} total={len(results)}")

    if not masters_ok:
        print("FATAL: every caption render failed — refusing to ship uncaptioned clips",
              file=sys.stderr)
        return 1

    if failed:
        # Partial success is allowed but must be visible in the logs.
        print(f"WARNING: {len(failed)} render(s) failed and will be reported as failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
