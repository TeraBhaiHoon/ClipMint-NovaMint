# yt-egress-proxy — DOES NOT WORK (kept as a tombstone)

Goal: HTTP CONNECT forward proxy on a Worker so yt-dlp egresses from a
Cloudflare IP (avoiding GitHub datacenter IP bot-checks).

Result (2026-10-06): Cloudflare's EDGE rejects CONNECT before the Worker's
fetch handler ever runs — every CONNECT gets `400 Bad Request` / proxied GETs
get `403`, both with `Server: cloudflare` and `CF-RAY: -` (no worker
invocation; `wrangler tail` confirms zero events). The Workers platform does
not support the CONNECT method at the edge, regardless of handler code.

Do not retry this approach. The Cloudflare-native fix for YouTube bot-checks
is a PO-token provider Worker (e.g. the bgutil provider) used with
yt-dlp --extractor-args youtube:po_token=... — a plain HTTP endpoint, no
CONNECT needed. Worker deleted; secrets destroyed.
