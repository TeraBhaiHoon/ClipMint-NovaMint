#!/usr/bin/env python3
"""
ClipMint pipeline — final result recording (accounting section).

Replaces the former inline "Save results to Supabase" workflow heredoc. The
critical change: clip-row insertion, quota settlement and the job's terminal
'done' write happen in ONE database transaction (finalize_job_results, see
supabase/migration_quota_v2.sql), so a job can never end up done-uncharged or
charged-without-rows, and a retried finalize cannot double-charge.

Billing unit: DISTINCT ready 9x16 master clip indexes — aspect variants of the
same master and failed clips are never billed (the SQL computes this; this
module only assembles the rows it is given).

Exit codes: 0 = finalized; non-zero = the workflow step fails and the job is
handed to the failure path (Record failure → fail_job_quota → refund). That is
deliberate fail-closed behaviour: never ship a delivered-but-uncharged job.
"""

from __future__ import annotations

import glob
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import DatabaseUnavailable, Supabase  # noqa: E402


def variant_of(name: str) -> tuple[str, str]:
    for variant, suffix in (("9x16", "_captioned.mp4"), ("1x1", "_1x1.mp4"),
                            ("16x9", "_16x9.mp4")):
        if name.endswith(suffix):
            return variant, name[: -len(suffix)]
    return "9x16", name[: -len(".mp4")]


def build_rows(job_id: str, user_id: str, workspace: Path) -> tuple[list[dict], list[str]]:
    """Assemble the clip rows from the pipeline artifacts (unchanged logic)."""
    manifest = json.loads((workspace / "output" / "upload_manifest.json").read_text())
    prepared = {c["file"]: c for c in json.loads(
        (workspace / "clips" / "clips_manifest.json").read_text())}
    moments = json.loads((workspace / "clips" / "viral_moments.json").read_text()).get("clips", [])
    render = json.loads((workspace / "render_report.json").read_text())
    render_by = {(r["index"], r.get("variant", "9x16")): r for r in render["results"]}

    # Private-storage delivery manifest (publish step): (index, variant) →
    # storage paths, so the dashboard can serve downloads with signed URLs.
    delivery_by: dict[tuple[int, str], dict] = {}
    try:
        for d in json.loads((workspace / "output" / "delivery_manifest.json").read_text()).get("files", []):
            delivery_by[(int(d["index"]), d.get("variant", "9x16"))] = d
    except (OSError, ValueError, KeyError, TypeError):
        print("  note: no delivery manifest (publish step skipped or failed)")

    # Quality-instrument reports: per MASTER clip index → {score, checks, ...}.
    qa_by: dict[int, dict] = {}
    for f in glob.glob(str(workspace / "qa" / "clip_*_qa.json")):
        try:
            qa_by[int(re.search(r"clip_(\d+)_qa", f).group(1))] = json.loads(Path(f).read_text())
        except (OSError, ValueError, AttributeError):
            continue
    qa_score_by = {i: int(r["score"]) for i, r in qa_by.items()
                   if isinstance(r.get("score"), (int, float))}

    rows: list[dict] = []
    failed: list[str] = []

    for clip in manifest["clips"]:
        variant, base = variant_of(clip["name"])
        try:
            index = int(base.split("_")[1])
        except (IndexError, ValueError):
            print(f"  ! skipping unrecognised upload file: {clip['name']}")
            continue
        info = prepared.get(f"clip_{index:03d}.mp4", {})
        moment = moments[index] if index < len(moments) else {}
        rendered = render_by.get((index, variant), {})
        captured = bool(rendered.get("ok"))

        rows.append({
            "job_id": job_id,
            "clip_index": index,
            "variant": variant,
            "filename": clip["name"],
            "duration_seconds": info.get("duration"),
            # Prefer the window ffmpeg ACTUALLY rendered (silence-snapped and
            # length-clamped) over the raw moment.
            "start_time": float(info.get("start", moment.get("start_time", 0)) or 0),
            "end_time": float(info.get("end", moment.get("end_time", 0)) or 0),
            "title": moment.get("title", f"Clip {index + 1}"),
            "description": moment.get("description", ""),
            "hashtags": moment.get("hashtags", []),
            "hook_caption": moment.get("hook", ""),
            "viral_score": int(float(moment.get("viral_score", 50) or 50)),
            "quality_score": qa_score_by.get(index),
            "quality_report": qa_by.get(index) or None,
            "drive_file_id": clip.get("id", ""),
            "drive_url": clip.get("url", ""),
            "thumbnail_url": clip.get("thumbnail_url", ""),
            "storage_path": (delivery_by.get((index, variant)) or {}).get("storage_path") or None,
            "thumbnail_path": (delivery_by.get((index, variant)) or {}).get("thumbnail_path") or None,
            "thumbnail_drive_id": (delivery_by.get((index, variant)) or {}).get("thumbnail_drive_id") or None,
            "status": "ready" if captured else "failed",
        })
        if not captured:
            failed.append(f"{index}:{variant}")

    # Renders that FAILED are deleted by render_clips.py (never shipped), so
    # they do not appear in the upload manifest. Re-surface each as an explicit
    # failed row so the dashboard shows what happened.
    delivered_keys = {(r["clip_index"], r["variant"]) for r in rows}
    for r in render["results"]:
        key = (r["index"], r.get("variant", "9x16"))
        if r.get("ok") or key in delivered_keys:
            continue
        index, variant = key
        moment = moments[index] if index < len(moments) else {}
        suffix = "_captioned.mp4" if variant == "9x16" else f"_{variant}.mp4"
        rows.append({
            "job_id": job_id,
            "clip_index": index,
            "variant": variant,
            "filename": f"clip_{index:03d}{suffix} (render failed, not delivered)",
            "duration_seconds": None,
            "start_time": float(moment.get("start_time", 0) or 0),
            "end_time": float(moment.get("end_time", 0) or 0),
            "title": moment.get("title", f"Clip {index + 1}"),
            "description": moment.get("description", ""),
            "hashtags": moment.get("hashtags", []),
            "hook_caption": moment.get("hook", ""),
            "viral_score": int(float(moment.get("viral_score", 50) or 50)),
            "drive_file_id": "",
            "drive_url": "",
            "thumbnail_url": "",
            "storage_path": None,
            "thumbnail_path": None,
            "thumbnail_drive_id": None,
            "status": "failed",
        })
        failed.append(f"{index}:{variant}")

    if not rows:
        raise SystemExit("FATAL: no clip rows assembled — refusing to finalize")

    return rows, failed


def main() -> None:
    job_id = os.environ.get("JOB_ID", "").strip()
    if not job_id:
        raise SystemExit("FATAL: JOB_ID is not set")

    workspace = Path("workspace")
    db = Supabase()

    # user_id comes from the job row (clips.user_id is NOT NULL).
    user_id = db.get_job(job_id)["user_id"]

    rows, failed = build_rows(job_id, user_id, workspace)
    for row in rows:
        row["user_id"] = user_id

    meta: dict = {"job_id": job_id}
    try:
        meta["drive_folder_id"] = json.loads(
            (workspace / "output" / "upload_manifest.json").read_text()
        ).get("folder_id", "")
    except (OSError, ValueError):
        meta["drive_folder_id"] = ""

    # Transcription metadata (best effort — a missing file only means the job
    # row keeps whatever it already stores).
    # Detected language: the transcription step's own output wins; otherwise
    # the transcription report's "language" field is the fallback so the job
    # row still records it when the side-car file is missing.
    detected_language = ""
    try:
        detected_language = (workspace / "audio" / "detected_language.txt").read_text().strip()
    except OSError:
        pass

    report: dict = {}
    try:
        loaded = json.loads((workspace / "output" / "transcription_meta.json").read_text())
        if isinstance(loaded, dict):
            report = loaded
            meta["transcription_report"] = report
            if not detected_language and report.get("language"):
                detected_language = str(report["language"])
            duration = report.get("duration") or report.get("source_duration") or report.get("wav_duration")
            if isinstance(duration, (int, float)) and duration > 0:
                meta["video_duration_seconds"] = duration
    except (OSError, ValueError):
        pass
    if not report:
        print("  note: transcription_meta.json absent — detected_language/report keep their job-row values")
    if detected_language:
        meta["detected_language"] = detected_language[:10]

    # The SQL computes the honest delivered count and writes it to clips_count.
    db.finalize_job(job_id, rows, meta)

    print(f"SAVE_OK job={job_id} rows={len(rows)} caption_failures={len(failed)} "
          f"(delivered masters billed atomically by finalize_job_results)")
    if failed:
        print("WARNING: some clips were delivered without captions and marked failed")


if __name__ == "__main__":
    try:
        main()
    except (DatabaseUnavailable, RuntimeError, OSError, ValueError, KeyError) as exc:
        print(f"FINALIZE_FAILED: {exc}")
        raise SystemExit(1)
