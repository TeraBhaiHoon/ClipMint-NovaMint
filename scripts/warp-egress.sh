#!/usr/bin/env bash
# Required Cloudflare WARP egress for cookie-free YouTube downloads.
# up/check verify the same IPv4 family used by yt-dlp's extraction and media.
set -uo pipefail
STATE=/tmp/warp-egress.up

trace() {
    curl -4 -fsS --connect-timeout 5 --max-time 10 https://www.cloudflare.com/cdn-cgi/trace 2>/dev/null
}
warp_on() {
    trace | grep -q '^warp=on$'
}
connect_warp() {
    if warp_on; then
        touch "$STATE"
        echo "warp: already up — $(trace | grep -m1 '^ip=')"
        return 0
    fi
    if ! command -v warp-cli >/dev/null 2>&1; then
        echo "warp: installing official client"
        curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg \
            | sudo gpg --yes --dearmor -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg \
            || { echo "warp: key fetch failed"; return 1; }
        printf 'deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ %s main\n' "$(lsb_release -cs)" \
            | sudo tee /etc/apt/sources.list.d/cloudflare-client.list >/dev/null
        sudo apt-get update -qq || { echo "warp: apt update failed"; return 1; }
        sudo apt-get install -y -qq cloudflare-warp || { echo "warp: install failed"; return 1; }
    fi
    warp-cli --accept-tos registration new >/dev/null 2>&1 || true
    warp-cli --accept-tos mode warp >/dev/null 2>&1 || { echo "warp: could not select full-tunnel mode"; return 1; }
    warp-cli --accept-tos connect >/dev/null 2>&1 || { echo "warp: connect failed"; return 1; }
    for _ in $(seq 1 12); do
        sleep 5
        if warp_on; then
            touch "$STATE"
            echo "warp: up — IPv4 egress $(trace | grep -m1 '^ip=')"
            return 0
        fi
    done
    echo "warp: no healthy IPv4 tunnel within 60s"
    return 1
}

disconnect_warp() {
    if command -v warp-cli >/dev/null 2>&1; then
        warp-cli --accept-tos disconnect >/dev/null 2>&1 || true
        warp-cli --accept-tos registration delete >/dev/null 2>&1 || true
    fi
    rm -f "$STATE"
    echo "warp: down"
}

case "${1:-}" in
    up) connect_warp ;;
    check)
        if warp_on; then echo "warp: healthy — IPv4 egress $(trace | grep -m1 '^ip=')";
        else echo "warp: IPv4 tunnel unavailable"; exit 1; fi ;;
    refresh)
        echo "warp: refreshing the failed tunnel once"
        disconnect_warp
        sleep 3
        connect_warp ;;
    down) disconnect_warp ;;
    *) echo "usage: $0 up|check|refresh|down"; exit 2 ;;
esac
