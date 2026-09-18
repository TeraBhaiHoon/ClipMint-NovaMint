#!/usr/bin/env python3
"""
ClipMint — runner-side CLI for the Modal GPU "HD enhance" pass.

CONTRACT (the workflow greps stdout and trusts exit codes):
    python3 pipeline/gpu_enhance.py --input <in.mp4> --output <out.mp4> [--timeout 900]

    success                  exit 0   final line `ENHANCE_OK engine=modal gpu=T4 seconds=<n>`
    Modal not configured /   exit 0   output copied untouched,
    any failure                       final line `ENHANCE_SKIPPED reason=<short>`

Enhancement is an OPTIONAL tier: it must NEVER fail a job. When Modal credits
are exhausted or the account isn't set up, the clip silently ships in its
standard quality and the reason is logged.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time


def ffprobe_ok(path: str) -> tuple[bool, str]:
    """Output must be a decodable video file."""
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json",
             "-show_format", "-show_streams", path],
            capture_output=True, text=True, timeout=30,
        )
        if r.returncode != 0:
            return False, "ffprobe_failed"
        import json
        data = json.loads(r.stdout)
        has_video = any(s.get("codec_type") == "video" for s in data.get("streams", []))
        if not has_video:
            return False, "no_video_stream"
        return True, ""
    except Exception as exc:  # noqa: BLE001
        return False, f"ffprobe_error:{exc}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--timeout", type=int, default=900)
    args = ap.parse_args()

    def skip(reason: str) -> int:
        # Guarantee the deliverable exists either way.
        if os.path.abspath(args.input) != os.path.abspath(args.output):
            shutil.copy2(args.input, args.output)
        print(f"ENHANCE_SKIPPED reason={reason}")
        return 0

    if not os.path.exists(args.input):
        print(f"FATAL: input missing: {args.input}", file=sys.stderr)
        return 1

    # 1. Modal credentials present? (Modal also accepts ~/.modal.toml)
    if not (os.environ.get("MODAL_TOKEN_ID") and os.environ.get("MODAL_TOKEN_SECRET")) \
            and not os.path.exists(os.path.expanduser("~/.modal.toml")):
        return skip("not_configured")

    # 2. modal package available? Install once, quietly, on the runner.
    try:
        import modal  # noqa: F401
    except ImportError:
        import importlib
        r = subprocess.run([sys.executable, "-m", "pip", "install", "-q", "modal"],
                           capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            return skip("modal_unavailable")
        importlib.invalidate_caches()
        try:
            import modal  # noqa: F401
        except ImportError:
            return skip("modal_unavailable")

    import modal

    started = time.time()
    try:
        fn = modal.Function.from_name("clipmint-enhance", "enhance")
        result = fn.remote(bytes(open(args.input, "rb").read()))
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        # Map the common failure modes to stable reasons.
        if "402" in msg or "403" in msg or "credit" in msg.lower():
            return skip("credits_exhausted")
        if "not found" in msg.lower() and ("deploy" in msg.lower() or "function" in msg.lower()):
            return skip("app_not_deployed")
        if "auth" in msg.lower() or "token" in msg.lower() or "401" in msg:
            return skip("auth_failed")
        return skip(f"modal_error:{type(exc).__name__}")

    tmp = args.output + ".enh.tmp"
    open(tmp, "wb").write(result)

    ok, why = ffprobe_ok(tmp)
    if not ok:
        os.unlink(tmp)
        return skip(f"bad_output:{why}")

    shutil.move(tmp, args.output)
    print(f"ENHANCE_OK engine=modal gpu=T4 seconds={time.time() - started:.0f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
