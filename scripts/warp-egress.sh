#!/usr/bin/env bash
# Cloudflare WARP egress helper — the last-resort network path for YouTube
# downloads from GitHub's datacenter IPs, which YouTube bot-checks outright
# ("Sign in to confirm you're not a bot"). WARP moves the request behind a
# Cloudflare consumer IP, which passes — verified with and without cookies
# on a GitHub runner (probe run 38435053338, 2026-10-13).
#
#   up   — install the official client (if missing), register, connect, and
#          wait until traffic actually egresses via Cloudflare (warp=on).
#   down — disconnect and delete the anonymous registration.
#
# Best effort by design: every failure exits non-zero with a reason, and the
# caller decides whether to surface it. Not specific to ClipMint internals —
# any step that shells out to yt-dlp can bracket itself with up/down.
set -uo pipefail

STATE=/tmp/warp-egress.up

warp_on() {
    curl -s --max-time 10 https://www.cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -q "^warp=on"
}

case "${1:-}" in
  up)
    if warp_on; then echo "warp: already up"; exit 0; fi
    if ! command -v warp-cli >/dev/null 2>&1; then
        echo "warp: installing official client"
        curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg \
            | sudo gpg --yes --dearmor -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg \
            || { echo "warp: key fetch failed"; exit 1; }
        echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" \
            | sudo tee /etc/apt/sources.list.d/cloudflare-client.list >/dev/null
        sudo apt-get update -qq || { echo "warp: apt update failed"; exit 1; }
        sudo apt-get install -y -qq cloudflare-warp || { echo "warp: install failed"; exit 1; }
    fi
    # A registration from an earlier step/run makes `registration new` error;
    # that is fine — connect works either way.
    warp-cli --accept-tos registration new >/dev/null 2>&1 || true
    warp-cli --accept-tos connect >/dev/null 2>&1 || true
    for _ in $(seq 1 12); do
        sleep 5
        if warp_on; then
            echo "warp: up — egress $(curl -s --max-time 10 https://www.cloudflare.com/cdn-cgi/trace | grep -m1 '^ip=')"
            touch "$STATE"
            exit 0
        fi
    done
    echo "warp: did not come up within 60s"
    exit 1
    ;;
  down)
    [ -f "$STATE" ] || { echo "warp: not up"; exit 0; }
    warp-cli --accept-tos disconnect >/dev/null 2>&1 || true
    warp-cli --accept-tos registration delete >/dev/null 2>&1 || true
    rm -f "$STATE"
    echo "warp: down"
    ;;
  *)
    echo "usage: $0 up|down"
    exit 2
    ;;
esac
