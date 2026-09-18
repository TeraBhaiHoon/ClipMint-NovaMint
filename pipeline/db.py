#!/usr/bin/env python3
"""
ClipMint pipeline — Supabase helpers.

Centralises every database write so the workflow does not have to embed
PostgREST calls (and their shell-quoting hazards) inline. All functions are
best-effort for non-critical fields but raise on the initial job lookup, so a
bad job id fails fast with a clear message instead of producing a silently
half-written job.

Environment:
    SUPABASE_URL          e.g. https://xxxx.supabase.co
    SUPABASE_SERVICE_KEY  service-role key (bypasses RLS)

CLI usage (so the workflow can call it per step):
    python3 pipeline/db.py set-status   --job-id ID --status clipping --progress 50
    python3 pipeline/db.py set-error    --job-id ID --message "..." [--status failed]
    python3 pipeline/db.py get-job      --job-id ID
    python3 pipeline/db.py insert-clips --job-id ID --clips-json path.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any

import requests

TIMEOUT = 30
RETRIES = 3


def _env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"FATAL: {name} is not set")
    return value.rstrip("/")


class Supabase:
    def __init__(self) -> None:
        self.url = _env("SUPABASE_URL")
        self.key = _env("SUPABASE_SERVICE_KEY")
        self.headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }

    # -- low level ---------------------------------------------------------
    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        """Issue a request with retries on transient failures.

        A dropped PATCH here means the dashboard shows a stale status forever,
        so retrying is worth the extra seconds.
        """
        last: Exception | None = None
        for attempt in range(RETRIES):
            try:
                resp = requests.request(
                    method,
                    f"{self.url}/rest/v1/{path}",
                    headers=self.headers,
                    timeout=TIMEOUT,
                    **kwargs,
                )
                if resp.status_code < 500:
                    return resp
                last = RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
            except requests.RequestException as exc:  # network hiccup
                last = exc
            time.sleep(2 ** attempt)
        raise RuntimeError(f"Supabase {method} {path} failed after {RETRIES} tries: {last}")

    # -- jobs --------------------------------------------------------------
    def get_job(self, job_id: str) -> dict[str, Any]:
        resp = self._request("GET", f"jobs?id=eq.{job_id}&select=*")
        if resp.status_code != 200:
            raise SystemExit(f"FATAL: job lookup failed (HTTP {resp.status_code}): {resp.text[:300]}")
        rows = resp.json()
        if not rows:
            raise SystemExit(f"FATAL: job {job_id} does not exist")
        return rows[0]

    def update_job(self, job_id: str, **fields: Any) -> None:
        resp = self._request("PATCH", f"jobs?id=eq.{job_id}", json=fields)
        if resp.status_code not in (200, 204):
            raise RuntimeError(f"job update failed (HTTP {resp.status_code}): {resp.text[:300]}")

    def set_status(self, job_id: str, status: str, progress: int | None = None) -> None:
        fields: dict[str, Any] = {"status": status}
        if progress is not None:
            fields["progress"] = max(0, min(100, int(progress)))
        if status == "downloading":
            fields["started_at"] = datetime.now(timezone.utc).isoformat()
        self.update_job(job_id, **fields)

    def set_error(self, job_id: str, message: str, status: str = "failed") -> None:
        self.update_job(
            job_id,
            status=status,
            error_message=message[:2000],
            completed_at=datetime.now(timezone.utc).isoformat(),
        )

    # -- clips -------------------------------------------------------------
    def insert_clips(self, job_id: str, clips: list[dict[str, Any]]) -> int:
        """Insert clip rows. Clears any previous rows for the job first so a
        retry does not duplicate the gallery."""
        if not clips:
            return 0

        # Deleting first makes this idempotent under retry.
        self._request("DELETE", f"clips?job_id=eq.{job_id}")

        resp = self._request("POST", "clips", json=clips)
        if resp.status_code not in (200, 201, 204):
            raise RuntimeError(f"clip insert failed (HTTP {resp.status_code}): {resp.text[:300]}")
        return len(clips)

    def insert_clip_errors(self, rows: list[dict[str, Any]]) -> None:
        """Attach a render error to specific clip rows (best effort)."""
        for row in rows:
            try:
                self._request(
                    "PATCH",
                    f"clips?job_id=eq.{row['job_id']}&clip_index=eq.{row['clip_index']}",
                    json={"status": "failed", "render_error": row.get("render_error", "")[:500]},
                )
            except Exception as exc:  # never fail the job over diagnostics
                print(f"  ! could not record render error for clip {row['clip_index']}: {exc}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description="ClipMint pipeline DB helper")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("set-status")
    p.add_argument("--job-id", required=True)
    p.add_argument("--status", required=True)
    p.add_argument("--progress", type=int, default=None)

    p = sub.add_parser("set-error")
    p.add_argument("--job-id", required=True)
    p.add_argument("--message", required=True)
    p.add_argument("--status", default="failed")

    p = sub.add_parser("get-job")
    p.add_argument("--job-id", required=True)

    p = sub.add_parser("insert-clips")
    p.add_argument("--clips-json", required=True)

    args = parser.parse_args()
    db = Supabase()

    if args.cmd == "set-status":
        db.set_status(args.job_id, args.status, args.progress)
        print(f"OK status={args.status} progress={args.progress}")
    elif args.cmd == "set-error":
        db.set_error(args.job_id, args.message, args.status)
        print(f"OK error recorded ({args.status})")
    elif args.cmd == "get-job":
        print(json.dumps(db.get_job(args.job_id)))
    elif args.cmd == "insert-clips":
        with open(args.clips_json) as fh:
            clips = json.load(fh)
        job_id = clips[0]["job_id"] if clips else ""
        count = db.insert_clips(job_id, clips)
        print(f"OK inserted {count} clips")


if __name__ == "__main__":
    main()
