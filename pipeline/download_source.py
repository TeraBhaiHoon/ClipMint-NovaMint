#!/usr/bin/env python3
"""Cookie-free source downloads with required WARP egress for YouTube."""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.parse import urlsplit
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]


def is_youtube(url: str) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    return host in {"youtube.com", "youtu.be"} or host.endswith(".youtube.com")


def classify_error(log: str) -> str:
    text = log.lower()
    if any(value in text for value in ("private video", "members-only", "age-restricted", "sign in to confirm your age", "video unavailable")):
        return "SOURCE_ACCESS_DENIED"
    if "sign in to confirm" in text or "not a bot" in text:
        return "YOUTUBE_BOT_CHECK"
    if "http error 403" in text or "http error 429" in text:
        return "SOURCE_MEDIA_BLOCKED"
    if "requested format is not available" in text or "only images are available" in text:
        return "SOURCE_FORMAT_UNAVAILABLE"
    if "unsupported url" in text:
        return "UNSUPPORTED_URL"
    return "SOURCE_DOWNLOAD_FAILED"


def download_command(url: str, output: Path, attempt: int) -> list[str]:
    command = [sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-playlist",
               "--js-runtimes", "deno", "--remote-components", "ejs:github",
               "--retries", "2", "--fragment-retries", "2", "--retry-sleep", "3",
               "--socket-timeout", "30", "--check-formats", "--merge-output-format", "mp4",
               "--remux-video", "mp4",
               "--format", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
               "--output", str(output / "source.%(ext)s"), "--write-info-json",
               "--newline", "--sleep-requests", "1"]
    if is_youtube(url):
        # WARP supplies both IPv4 and IPv6; bind extraction and media to IPv4
        # so signed media URLs cannot switch address families between requests.
        command += ["--force-ipv4"]
        if attempt == 1:
            command += ["--extractor-args", "youtube:player_client=visionos"]
        elif attempt == 2:
            command += ["--extractor-args", "youtube:player_client=web_safari",
                        "--format", "bestvideo[protocol=m3u8_native][height<=1080]+bestaudio[protocol=m3u8_native]/best[protocol=m3u8_native][height<=1080]"]
    return command + [url]


def valid_video(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size < 10240:
        return False
    try:
        probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", str(path)], capture_output=True, text=True, timeout=30)
        data = json.loads(probe.stdout)
        duration = float(data.get("format", {}).get("duration", 0))
        return probe.returncode == 0 and math.isfinite(duration) and duration >= 5 and any(stream.get("codec_type") == "video" for stream in data.get("streams", []))
    except (OSError, subprocess.TimeoutExpired, ValueError, TypeError):
        return False


def warp(action: str) -> None:
    subprocess.run(["bash", str(ROOT / "scripts" / "warp-egress.sh"), action], check=True, timeout=180)


def download(url: str, output: Path, *, run: Callable = subprocess.run,
             budget_seconds: float = 2400, clock: Callable = time.monotonic) -> None:
    output.mkdir(parents=True, exist_ok=True)
    started = clock()
    def remaining_timeout(maximum: float) -> float:
        remaining = budget_seconds - (clock() - started)
        if remaining <= 0:
            raise RuntimeError("SOURCE_DOWNLOAD_TIMEOUT: download time budget exhausted")
        return min(maximum, remaining)
    youtube = is_youtube(url)
    warp_started = False
    try:
        if youtube:
            try:
                warp("up")
                warp_started = True
            except (subprocess.SubprocessError, OSError) as exc:
                raise RuntimeError("WARP_UNAVAILABLE: YouTube downloading requires a healthy WARP connection; no raw-runner fallback.") from exc
        # Direct-media links are not bot-checked and do not need WARP.
        path = urlsplit(url).path.lower()
        if path.endswith((".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi")):
            try:
                result = run(["curl", "-fsSL", "--retry", "2", "--connect-timeout", "15", "--max-time", "1800", "--output", str(output / "source.mp4"), url], timeout=remaining_timeout(1830))
            except subprocess.TimeoutExpired:
                result = None
            if result is not None and result.returncode == 0 and valid_video(output / "source.mp4"):
                print("DOWNLOAD_OK direct_media", flush=True)
                return
            (output / "source.mp4").unlink(missing_ok=True)
        attempts = 3 if youtube else 2
        last_log = ""
        for attempt in range(attempts):
            if youtube:
                remaining_timeout(1800)
                try:
                    warp("check")
                except (subprocess.SubprocessError, OSError):
                    warp("up")
            print(f"download: attempt {attempt + 1}/{attempts}", flush=True)
            try:
                result = run(download_command(url, output, attempt), capture_output=True, text=True, timeout=remaining_timeout(1800))
                last_log = (result.stdout or "") + (result.stderr or "")
            except subprocess.TimeoutExpired:
                last_log = "Source download exceeded its 30-minute time limit"
                result = None
            (output / "download.log").write_text(last_log, encoding="utf-8")
            # Progress lines can be thousands of entries; retain diagnostic lines
            # and the final tail, not entire signed media URLs in customer errors.
            for line in last_log.splitlines():
                if line.startswith(("ERROR:", "WARNING:", "[info]", "[youtube] [jsc")):
                    print(line[:500], flush=True)
            if result is not None and result.returncode == 0 and valid_video(output / "source.mp4"):
                print("DOWNLOAD_OK", flush=True)
                return
            reason = classify_error(last_log)
            if reason in {"SOURCE_ACCESS_DENIED", "UNSUPPORTED_URL"}:
                break
            for staged in output.glob("source.*"):
                if staged.is_file():
                    staged.unlink()
            if youtube and reason in {"SOURCE_MEDIA_BLOCKED", "YOUTUBE_BOT_CHECK"} and attempt == 0:
                # One bounded fresh tunnel; the next extraction gets fresh media
                # URLs instead of retrying the same denied signature/client.
                warp("refresh")
            if attempt + 1 < attempts:
                time.sleep(remaining_timeout(3))
        raise RuntimeError(f"{classify_error(last_log)}: The source could not be downloaded. Media HTTP 403 does not prove a video is private. Retry later or upload a file you have permission to use.")
    finally:
        if warp_started:
            try:
                warp("down")
            except (subprocess.SubprocessError, OSError):
                print("warp: teardown failed; runner cleanup will release the connection", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.environ.get("VIDEO_URL", ""))
    parser.add_argument("--output", type=Path, default=Path("workspace/source"))
    args = parser.parse_args()
    parsed = urlsplit(args.url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise SystemExit("Unsupported source URL")
    try:
        download(args.url, args.output)
    except (RuntimeError, subprocess.SubprocessError, OSError) as exc:
        print(f"DOWNLOAD_FAILED: {exc}", flush=True)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
