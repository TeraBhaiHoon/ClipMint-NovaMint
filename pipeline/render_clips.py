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
  * Partial success is surfaced: the job completes, but the summary names how
    many clips failed and why.
  * Total failure returns a non-zero exit code so the workflow fails the job.

Usage:
  python3 pipeline/render_clips.py \
      --clipsdir workspace/clips \
      --outdir workspace/captioned \
      --remotion-dir remotion-captions \
      --style hormozi --concurrency 2 \
      [--platform tiktok] [--report workspace/render_report.json]
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


def build_props(
    clip_filename: str,
    captions_json: str,
    duration_frames: int,
    style: str,
    platform: str,
    has_audio: bool,
) -> dict:
    """Props must match remotion-captions/src/CaptionedClip.tsx exactly.

    `layout: "cover"` because prepare_clips.py already produced a 1080x1920
    file — the blur-fill letterbox path is only for un-reframed sources.

    `hasAudio` is the safety interlock for the audio analyser: Remotion's
    `useWindowedAudioData` calls `cancelRender()` (uncatchable) when it cannot
    find an audio track, so we only enable reactivity when ffprobe confirmed
    a stream. This value comes from the preparation manifest, not a guess.
    """
    return {
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
        "maxWordsPerPage": 4,
        "maxCharsPerPage": 26,
        "pageBreakGapMs": 420,
        "showWatermark": True,
        "brandText": "CLIPMINT",
        "showProgressBar": True,
        "hasAudio": has_audio,
        "audioReactive": os.environ.get("CLIPMINT_AUDIO_REACTIVE", "1") == "1" and has_audio,
    }


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
) -> dict:
    index = entry["index"]
    clip_path = clipsdir / entry["file"]
    captions_path = clipsdir / f"clip_{index:03d}.captions.json"
    output = outdir / f"clip_{index:03d}_captioned.mp4"

    result = {
        "index": index,
        "ok": False,
        "input": str(clip_path),
        "output": str(output),
        "error": "",
    }

    if not clip_path.exists():
        result["error"] = "prepared clip missing"
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
    # clip is copied in for the duration of the render (unique name per clip so
    # parallel renders cannot collide).
    public_clip = f"_render_{index:03d}.mp4"
    shutil.copy2(clip_path, public_dir / public_clip)

    props = build_props(
        public_clip, captions_json, duration_frames, style, platform,
        bool(entry.get("has_audio")),
    )
    props_file = props_dir / f"props_{index:03d}.json"
    props_file.write_text(json.dumps(props))

    try:
        resp = subprocess.run(
            [
                "npx", "remotion", "render", "CaptionedClip", str(output.resolve()),
                f"--props={props_file.resolve()}",
                "--codec=h264", "--video-bitrate=10M",
                "--concurrency=2", "--log=error",
            ],
            cwd=str(remotion_dir),
            capture_output=True, text=True, timeout=timeout,
            shell=(os.name == "nt"),
        )
        if resp.returncode == 0 and output.exists() and output.stat().st_size > 20_000:
            result["ok"] = True
            result["bytes"] = output.stat().st_size
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
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--concurrency", type=int, default=2)
    ap.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SEC)
    ap.add_argument("--report", default="")
    args = ap.parse_args()

    clipsdir = Path(args.clipsdir)
    outdir = Path(args.outdir)
    remotion_dir = Path(args.remotion_dir)
    outdir.mkdir(parents=True, exist_ok=True)

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

    # Two renders at --concurrency=2 each already saturate a 4-vCPU runner.
    workers = max(1, min(args.concurrency, max(1, (os.cpu_count() or 4) // 2)))
    print(f"rendering {len(manifest)} clip(s) with style={args.style} "
          f"workers={workers} fps={args.fps}")

    results: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(
                render_one, entry, clipsdir, outdir, remotion_dir, public_dir,
                props_dir, args.style, args.platform, args.fps, args.timeout,
            ): entry
            for entry in manifest
        }
        for fut in concurrent.futures.as_completed(futures):
            entry = futures[fut]
            try:
                res = fut.result()
            except Exception as exc:  # noqa: BLE001
                res = {"index": entry["index"], "ok": False, "error": f"worker crashed: {exc}"}
            results.append(res)
            if res["ok"]:
                print(f"  [{res['index']}] OK {res.get('bytes', 0):,} bytes")
            else:
                print(f"  [{res['index']}] FAILED: {res['error']}")

    results.sort(key=lambda r: r["index"])
    ok = [r for r in results if r["ok"]]
    failed = [r for r in results if not r["ok"]]

    report = {
        "style": args.style,
        "requested": len(manifest),
        "succeeded": len(ok),
        "failed": len(failed),
        "results": results,
    }
    report_path = Path(args.report) if args.report else (clipsdir / "render_report.json")
    report_path.write_text(json.dumps(report, indent=2))

    print(f"RENDER_SUMMARY ok={len(ok)} failed={len(failed)} total={len(results)}")

    if not ok:
        print("FATAL: every caption render failed — refusing to ship uncaptioned clips",
              file=sys.stderr)
        return 1

    if failed:
        # Partial success is allowed but must be visible in the logs.
        print(f"WARNING: {len(failed)} clip(s) have no captions and will be reported as failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
