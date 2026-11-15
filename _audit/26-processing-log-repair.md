# Processing-log repair — 2026-11-15

## Evidence from both supplied logs

Job: `095547b0-37c9-4f8f-9aaf-74cf1ee0de41`.

- Run `43672970652` downloaded the public YouTube source (523,287,682 bytes, 3,937 seconds). Transcription completed with 11,045 words, but both Groq Whisper models returned HTTP 400 on every chunk: unsupported `initial_prompt`.
- Deepgram recovered that transcript. Optional romanisation then repeatedly tried an unavailable NVIDIA model (HTTP 404) and a model returning 180-second timeouts before Groq `openai/gpt-oss-120b` succeeded. The same failed probes repeated across batches until the run was cancelled after about 105 minutes total.
- Run `43680936187` failed before transcription. Metadata extraction succeeded, but media download returned HTTP 403. Retry clients included removed `tv_embedded` and token-restricted `android_vr`. Both WARP connections were up; the logs do not establish whether the block was IP-specific or a changed YouTube media/client policy.
- The second run's finalizer then attempted to download nonexistent `render-inputs`. Its generic access-denied diagnosis also matched `age` inside `webpage`, incorrectly suggesting that the source was private.

## Repairs implemented locally

1. `pipeline/transcribe_providers.py`: supported Groq `prompt` field replaces `initial_prompt`, keeping word timestamps and model fallback.
2. `pipeline/llm.py`: Groq-first default based on the actual successful provider; remembered hard model failures, provider auth failures and temporary exhaustion; bounded attempts, request timeouts and total-call deadlines; empty/malformed success bodies rejected; existing environment overrides preserved.
3. `pipeline/transliterate.py`: tested, optional romanisation with unique-word reuse, a 180-second stage budget, 45-second call budget, one attempt per model. Bad replies/provider outages preserve original text and timestamps. Original Hindi text is renderable through the existing Baloo 2 caption font.
4. `pipeline/download_source.py`: normal and resume downloads share one path. WARP is required for YouTube; no cookie path or raw-runner fallback. Fresh format checks, current default/visionOS/Safari-HLS attempts, one bounded tunnel refresh after media denial, consistent IPv4 requests, timeout budget, metadata reuse and video validation. Direct media/Drive do not require WARP.
5. `scripts/warp-egress.sh`: explicit full-tunnel mode, IPv4 health check, check/refresh commands, verified setup and teardown.
6. Workflow: officially documented `yt-dlp[default]` extra, transcript checkpoint before optional cleanup, bounded transcription/cleanup/checkpoint steps, processing-stage diagnostic artifact, skip nonexistent render inputs after process failure, and record downstream failures precisely.

## Validation actually performed

- Full pipeline suite: **98 tests passed** (`python -m pytest -o addopts='' -q tests`).
- All **10 workflows** passed YAML, Bash and embedded-Python static checks.
- WARP shell syntax and Python compile checks passed.
- Mocked tests cover Groq request fields, model/provider outage memory, timeout budgets, malformed completion bodies, caption/timing preservation, download attempt parity, no raw-IP fallback, one tunnel refresh, correct restriction/media diagnoses, and finalizer artifact handling.
- Groq's public API reference was retrieved and confirms `prompt` as the transcription field: https://console.groq.com/docs/api-reference
- yt-dlp research used official EJS guidance, client implementation/release notes and PO-token guide. The guide's client table can lag current extractor code: https://github.com/yt-dlp/yt-dlp/wiki/EJS and https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide

## Not verified / release gate

**No corrected real GitHub processing run has been executed. No provider keys, customers' media, or real job records were used in local tests. No commit/push or workflow dispatch has been performed for this repair.**

YouTube media 403 recovery is a resilience repair, not a proven cure. A fresh runner must verify an actual media download (not `--simulate`). If media remains blocked across a healthy fresh WARP connection, investigate YouTube's current proof-of-origin requirement before adding any provider/plugin; do not restore cookies or claim that WARP alone guarantees access.

The existing diagnostic probe uses simulated extraction; that alone cannot prove the Googlevideo media download works. Releasing these repairs and retrying the affected job are the remaining explicit actions. A successful end-to-end result requires a completed processing/render/finalize run and real output clips, not only green local tests.
