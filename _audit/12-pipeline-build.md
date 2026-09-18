# 12 — Pipeline Build 2 (multi-provider STT/LLM, checkpoints, multi-format)

Date: 2026-09-18
Scope honoured: `.github/workflows/process-video.yml`, `pipeline/*.py` (except
`gpu_enhance.py`, plus new modules), `api-gateway/src/index.ts`,
`supabase/migration_pipeline2.sql`, dashboard trigger/new/`[jobId]`/webhook/types
minimal edits, `pipeline/requirements.txt`. `remotion-captions/**`, `modal/**`,
`pipeline/gpu_enhance.py`, `pipeline/assets_manifest.json`,
`pipeline/assets_README.md` untouched.

---

## BUILD 1 — Multi-provider transcription

**`pipeline/transcribe_providers.py` (new)**
- `transcribe(wav_path, segment_offset_sec=0.0, forced_language=None, prefer_hindi_first=False)`
  → `{"words": Caption[], "language": str, "provider": str, "model": str}`.
  Canonical Caption = `{"text","startMs","endMs","timestampMs":None,"confidence"}`.
- Provider order: `prefer_hindi_first` → Deepgram → Groq → NIM; else Groq → Deepgram → NIM.
- Groq: `verbose_json`, `timestamp_granularities[]=word`, models
  whisper-large-v3-turbo → whisper-large-v3; "multi" is never sent as a Groq
  language (would 400).
- Deepgram: raw WAV bytes body (`Content-Type: audio/wav`),
  `model=nova-3&language=multi&smart_format=true`, `Authorization: Token`;
  parses `results.channels[0].alternatives[0].words[]`, prefers
  `punctuated_word` over `word`, seconds → ms. Key absent → provider skipped
  silently.
- NIM: lazy `import riva.client` (module imports fine without it installed);
  `riva.client.Auth(uri="grpc.nvcf.nvidia.com:443", use_ssl=True,
  metadata_args=[["function-id","b702f636-f60c-4a3d-a6f4-f3568c13bd7d"],
  ["authorization", f"Bearer {key}"]])` + `ASRService` +
  `offline_recognize` with `RecognitionConfig(sample_rate_hertz=16000,
  max_alternatives=1, enable_word_time_offsets=True,
  enable_automatic_punctuation=True, language_code="multi")`. LAST in the
  chain (trial terms may record inputs).
- Every provider: 3 attempts, exponential backoff on 429/5xx/network.
- When a provider returns text but no word timings, words are spread evenly
  across the segment window (Groq per-segment; Deepgram across the chunk;
  Riva across equal slices of the chunk).
- Parse functions (`parse_groq_payload`, `parse_deepgram_payload`,
  `parse_riva_response`) are pure → unit-tested without network.

**Workflow transcription step**: keeps chunking (>24 MB → 5-min chunks), the
hallucination filter, and the first-chunk language lock (now from the module's
returned code; `multi` is never re-passed as a Groq hint). Per chunk:
`prefer_hindi_first = (detected == "hi")`. Env: `GROQ_API_KEY`,
`DEEPGRAM_API_KEY`, `NVIDIA_NIM_API_KEY`. Writes `full_captions.json` +
`detected_language.txt` unchanged.

**`pipeline/requirements.txt`**: added `nvidia-riva-client>=2.14` (comment
notes the lazy import).

## BUILD 2 — LLM provider chain

**`pipeline/llm.py` (new)**: `ask(prompt, system="", is_json=False, max_tokens=4096) -> str`.
Chain: Groq (`openai/gpt-oss-120b` head, override via `CLIPMINT_LLM_MODEL`,
then `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`) → NIM
(`nvidia/nemotron-3-super-120b-a12b`, `deepseek-ai/deepseek-v4-flash-0731`,
`z-ai/glm-5.3-flash`). 3 attempts per (provider, model) with backoff on
429/5xx/network; hard 4xx moves to the next model immediately (dead-but-listed
NIM models 404/410 land here). A 400 that mentions `response_format` is
retried once without it (not all NIM models accept it). The answering
provider+model is logged (`LLM_OK provider=… model=…`). All providers
unavailable → RuntimeError → named stage failure, never a silent fallback.

Transliterate step and viral step rewired to `llm.ask` (prompts preserved).
Transliterate keeps its per-batch tolerance: a batch where every provider
failed is counted in `failed_batches` and ships un-romanised rather than
killing the job.

## BUILD 3 — backlog items

**2.1 scene detection** — `prepare_clips.py::detect_scenes()` runs one ffmpeg
decode pass (`select='gt(scene,0.3)',metadata=print:file=_clipmint_scene_marks.txt`,
relative marks path + cwd=source.parent because an absolute Windows path's
`C:` breaks filter parsing — found and fixed in the E2E). `snap_with_scenes()`
prefers a boundary within 0.6 s that aligns with BOTH a silence midpoint and a
scene cut; falls back: silence snap → scene cut → raw timestamp. `--no-scene-detect`
flag; all failures degrade to no scene data.

**2.2 metadata** — download step runs `yt-dlp --dump-json` (skipped for
drive.google.com / direct media extensions; any failure ignored) →
`workspace/source/metadata.json` (title, duration, uploader, description[:2000],
tags, chapters). Viral step: chapters overlapping a window are appended as
`[chapter] title (start-end)` lines to the discovery context; a moment whose
span sits inside a matching chapter gets `viral_score += 5` and
`moment["chapter_title"]`.

**2.3 ideal_duration** — discovery prompt gains the content-type duration
table (HOOK 15-25 s / STORY 25-45 s / EXPLANATION 40-60 s / OPINION 20-40 s);
ranking JSON now requires `duration_reason`; `MIN_CLIP_SECONDS` lowered
15 → 10 (max 90 unchanged) so the clamp is min 10 s after snapping.

**2.4 caption validator** — `pipeline/validate_captions.py` (new): non-empty,
no negative startMs, no zero/negative durations, consecutive-word overlap
> 50 ms flagged, word coverage ≥ 30 % of clip duration.
`prepare_clips.py` validates the exact window pre-cut; failures drop the clip
BEFORE the encode (logged `[i] DROPPED by caption validator: …`, recorded in
`clips/dropped_clips.json`), saving the render as well as the cut.

**4.2 checkpoints** — after silence detection the workflow uploads
`full_captions.json`, `detected_language.txt`, `silences.txt` to
`ClipMint/{job_id}/_checkpoints/` and records the captions file's Drive URL in
`jobs.checkpoint_url` (db.py `set-checkpoint`); after viral detection
`viral_moments.json` joins the checkpoint. Both upload steps are
`continue-on-error` (an optimisation must never gate the job).
New input `resume_from_checkpoint` ("true"/"false", default false). The
"Resolve checkpoint" step: `db.py get-checkpoint` → if set and resume
requested, rclone-downloads the checkpoint files into `workspace/audio` +
`workspace/clips`, then RE-FETCHES the source video (prepare needs `source.mp4`
and it cannot live in the checkpoint — deviation from the literal "skip
download": the dedicated download step is skipped, the fetch happens inside
the resume step instead). Audio extraction, transcribe, transliterate, energy,
silence and viral steps are all `if:`-skipped; viral is only skipped when the
viral checkpoint exists (`viral_ready` output). db.py gained
`get_checkpoint_url`/`set_checkpoint_url` + CLI `get-checkpoint`/`set-checkpoint`.
Dashboard: trigger route accepts `resume: true` and forwards
`resume_from_checkpoint`; `[jobId]` retry sends `resume: Boolean(job.checkpoint_url)`;
`Job.checkpoint_url` added to `dashboard/src/lib/types.ts`.

**5.5 render validation** — `render_clips.py::validate_render()` ffprobes
every output: exists (>20 KB), video stream present, duration within 0.5 s of
expected; mismatches mark the render failed with the reason (before: size>20KB only).

**3.4 multi-format** — new input `output_formats` (CSV, default `9x16`,
validated in the inputs step). `prepare_clips.py --formats` keeps the
pre-reframe cut as `clip_XXX_cut.mp4` when extras are requested and records
`cut_file` + `mood` in `clips_manifest.json`. `render_clips.py --formats`
renders each extra format FROM THE CUT: 1x1 = 1080x1080, 16x9 = 1920x1080 via
Remotion CLI `--width/--height` (verified present in Remotion 4.0.526), props
`layout:"cover"`, output `clip_XXX_1x1.mp4` / `clip_XXX_16x9.mp4`, each
ffprobe-validated. Upload step copies all variants and matches thumbnails via
a suffix-aware key; Save-results writes one row per variant with
`clips.variant` (`9x16` master / `1x1` / `16x9`), same `clip_index`.
Migration: `ALTER TABLE clips ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT '9x16';`

**6.4 gateway body limit** — `api-gateway/src/index.ts` rejects
`Content-Length > 10240` with 413 before any route/auth/JSON-reading work
(`bodyTooLarge`, first thing after CORS preflight).

**8.5 user webhook** — migration adds `profiles.user_webhook_url TEXT` +
`profiles.notify_webhook BOOLEAN NOT NULL DEFAULT FALSE`. The dashboard
job-status webhook route reads the new prefs and, when opted in and URL set,
POSTs `{event:"job.completed"|"job.failed"|"job.cancelled", job_id, status,
clips_count, error_message, timestamp}` with a 5 s timeout
(`AbortSignal.timeout(5000)`); failures are logged, never thrown.

**Mood for BGM** — viral ranking JSON gains `"mood"` (normalised to
energetic|calm|corporate|inspiring, default energetic); prepare passes it
through the manifest; `render_clips.py` reads `pipeline/assets_manifest.json`
(`bgm[mood]` → prop `bgmSrc`, `sfxEnabled` from `CLIPMINT_SFX` default "1");
absent manifest/mood → props omitted, engine defaults apply. During the E2E
the manifest appeared (concurrent engineer) with all four moods and the
bgmSrc path rendered successfully end-to-end.

**Caption pace** — new input `caption_pace` (fast|balanced|slow, default
balanced). render_clips maps fast=(3,20,300), balanced=(4,26,420),
slow=(5,32,560) into `maxWordsPerPage` / `maxCharsPerPage` / `pageBreakGapMs`.
Dashboard `new/page.tsx` gained a 3-option select and forwards `caption_pace`
through the trigger route.

**Migration `supabase/migration_pipeline2.sql`** (idempotent, NOT applied —
coordinator applies via Management API): jobs.checkpoint_url, clips.variant,
profiles.user_webhook_url, profiles.notify_webhook.

---

## VERIFICATION

| Check | Result | Proof |
|---|---|---|
| `python -m py_compile pipeline/*.py` | PASS | `PY_COMPILE_OK 0 errors` |
| Workflow YAML parse | PASS | 32 steps; inputs: caption_pace, caption_style, job_id, max_clips, output_formats, resume_from_checkpoint, video_url |
| bash -n on every run block (`${{ }}` → PLACEHOLDER) | PASS | 29 run blocks checked, 0 syntax errors; all inline `<<'PY'` python heredocs also compile |
| `cd api-gateway && npx tsc --noEmit` | PASS | exit 0, `API_GATEWAY_TSC_OK` |
| `cd dashboard && npm run build` | PASS | compiled, full route table emitted, exit 0 |
| Unit tests (`_audit/test_pipeline2_units.py`) | PASS | `UNIT_TESTS_OK (all checks passed)` — 33 checks: validator catches empty/negative/non-positive/overlap>50 ms (exactly-50 ms allowed)/low-coverage/non-numeric; Groq verbose_json + segments-spread + language mapping + offset; Deepgram punctuated_word + seconds→ms + no-words spread; Riva word timings + non-speech skip + no-offset spread; lazy riva import (NIM skipped without key, no import error); provider orders groq→deepgram and deepgram→groq; forced language; all-providers-down raises; scene/silence snap preferences |
| E2E dry-run prepare | PASS | synthetic 60 s source (lavfi blue+red concat at 30 s + sine): `scene_cuts=1` detected; clip [2] end snapped `30.4 → 30.00` to the scene cut with ZERO silence data (`snapped from 20.0-30.4`); captionless moment `[1] DROPPED by caption validator: captions_empty`; manifest carries `mood` + `cut_file` |
| E2E dry-run render | PASS | `python pipeline/render_clips.py --caption-pace fast --formats 9x16,1x1` → `RENDER_SUMMARY ok=4 failed=0 total=4`; ffprobe: masters 1080x1920, 1x1 variants 1080x1080, 10.09 s vs 10.0 s expected (within 0.5 s); `bgm moods available: calm, corporate, energetic, inspiring` loaded from the concurrently-added assets manifest |

Dry-run artefacts were regenerated under `workspace/` and removed afterwards
(command sequence documented above; fixtures reproducible in <2 min).

## Notes / deviations

1. **Resume re-fetches the source video.** The spec says to skip the download
   step on resume, but prepare/render cannot run without `source.mp4` and the
   checkpoint holds only the 4 text artefacts. The dedicated download step is
   indeed skipped; the resolve-checkpoint step performs a compact 2-attempt
   yt-dlp fetch instead. Net behaviour: one download, zero re-transcription.
2. **Validator runs pre-cut** (on the exact window that would be written) so a
   dropped clip also saves the encode; the written JSON is the validated object.
3. **Scene marks file must be a relative path** — ffmpeg filter args eat the
   `C:` of an absolute Windows path as an option separator (caught by the E2E).
4. **`MIN_CLIP_SECONDS` is now 10 s** per backlog 2.3 ("min 10s after snapping").
5. Transcription checkpoint is uploaded after the silence step (so
   `silences.txt` exists); if a job dies before that, resume simply isn't
   available and the retry runs full — graceful by design.
