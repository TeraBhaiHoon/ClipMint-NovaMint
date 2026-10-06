#!/usr/bin/env bash
# Push fresh YouTube cookies into the pipeline secret.
#
# Why: YouTube rotates session cookies every few days, and GitHub Actions
# datacenter IPs get bot-checked ("Sign in to confirm you're not a bot")
# much harder than a logged-in residential browser. When URL imports start
# failing at the download step, refresh the cookies and retry.
#
# Usage:
#   1. Export cookies for youtube.com with the "Get cookies.txt LOCALLY"
#      browser extension while logged in (Netscape format, not JSON).
#   2. Run:  bash scripts/refresh-yt-cookies.sh ~/Downloads/youtube.com_cookies.txt
#   3. Retry the job from the dashboard.
set -euo pipefail

REPO="${GITHUB_REPO:-TeraBhaiHoon/ClipMint-NovaMint}"
FILE="${1:?Usage: $0 <cookies.txt exported from your browser>}"

[ -f "$FILE" ] || { echo "not a file: $FILE"; exit 1; }
head -1 "$FILE" | grep -qi "Netscape" \
    || { echo "!! not a Netscape cookies.txt — in the extension use the 'Export' (txt) option, not JSON"; exit 1; }
grep -q "youtube.com" "$FILE" \
    || { echo "!! no youtube.com cookies in the file — browse to youtube.com first, then export"; exit 1; }
grep -qE "	(SID|HSID|SSID|SAPISID|APISID)	" "$FILE" \
    || { echo "!! core session cookies (SID/HSID/SSID/SAPISID) missing — you are probably not logged in to youtube.com in that browser profile"; exit 1; }

gh secret set YOUTUBE_COOKIES -R "$REPO" < "$FILE"
echo "OK: YOUTUBE_COOKIES updated on $REPO ($(grep -c "youtube.com" "$FILE") youtube cookies). Retry the job from the dashboard."
