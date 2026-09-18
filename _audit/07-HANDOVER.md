# ClipMint — Operations & Handover

**Date:** 2026-09-18 · Companion to `_audit/00-FINDINGS.md` (root causes) and
`_audit/03-free-resources-research.md` (free-tier research).

---

## 1. What to check first, in order

1. **`_audit/00-FINDINGS.md`** — the root causes, with the log evidence.
2. **GitHub Actions** — `TeraBhaiHoon/ClipMint-NovaMint` (the repo redirects
   from `VikashMeena777/ClipMint-NovaMint`; both work).
3. **Supabase project** `zwgooqazqxqnfdgmhsev` — live and healthy.
4. **Dashboard** — `https://clipmint.novamintnetworks.in`

---

## 2. The one thing to understand about the old pipeline

Every caption render was failing, and a shell fallback (`|| cp "$clip" "$OUTPUT"`)
swapped in the raw uncaptioned clip while the job was marked `done`. So the
product was green and delivering captions-less videos.

**That fallback no longer exists.** If captions can't be rendered, the clip is
marked `failed` and the user is told. If *all* clips fail, the job fails.

This means: **a job in this pipeline can now fail where it previously "succeeded".**
That is intended. A green build that ships the wrong output is worse than a red
one. Expect the failure rate to look higher before it looks lower.

---

## 3. Proof it works now

Three live end-to-end runs on 2026-09-18:

| Run | Source | Result |
|---|---|---|
| `35351041576` | 634 s / 155 MB video | 1 clip, 1 caption render, 0 failures |
| `35351609656` | 930 s / 298 MB video, **1992 words** | 2 clips prepared from real speech, **2 caption renders OK, 0 failures**, 2 thumbnails, uploaded, `SAVE_OK clips=2 caption_failures=0` |
| `35352024432` | same, `glow` style | geometry + reframe mode now logged |

Stored rows for the 1992-word run (all previously-empty fields now populated):

```
index  status  duration  start   end     span   score  drive  thumb  hashtags
0      ready   17.8s     119.9   137.6   17.7   98     yes    yes    5
1      ready   15.1s      23.1    38.1   15.0   89     yes    yes    5
```

`duration_seconds` had been `NULL` for every clip ever produced.

**Caption continuity, measured locally on a 34.5 s clip:** captions present in
**68 of 68** sampled frames. The old engine stopped after the first ~1.2 s.

**Vertical output:** a 1920×1080 source becomes 1080×1920 through
`smart_reframe.py` (OpenCV YuNet face tracking, MIT-licensed). The prepare step
now logs the mode used and warns if geometry is not 1080×1920.

**Loudness:** measured **−13.95 LUFS** against a −14 LUFS target (0.05 LU).

---

## 4. Operating it

### Secrets that can expire

| Secret | Where | What breaks | Fix |
|---|---|---|---|
| `YOUTUBE_COOKIES` | GitHub repo secret | Download fails with `Sign in to confirm you're not a bot` or `cookies are no longer valid` | Re-export cookies from a signed-in browser in Netscape format and update the secret. **This will happen again** — see §6. |
| `GROQ_API_KEY` | GitHub repo secret | Transcription and moment detection fail | Rotate at console.groq.com |
| `RCLONE_CONF_B64` | GitHub repo secret | Upload fails | Re-run `rclone config` and base64 the config |

The pipeline now *says which of these is the problem* instead of a generic
error — look for `YOUTUBE_BOT_CHECK`, `YOUTUBE_COOKIES_STALE`,
`UNSUPPORTED_URL` or `ACCESS_DENIED` in the download step.

### Dashboard / Vercel environment

`GITHUB_TOKEN`, `GITHUB_REPO` (= `TeraBhaiHoon/ClipMint-NovaMint`),
`WEBHOOK_SECRET`, `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`,
`NEXT_PUBLIC_APP_URL` plus the Supabase and Cashfree keys. A full list with
comments is in `dashboard/.env.local.example`.

**`GITHUB_REPO` matters:** with it unset the trigger route marks every job
failed with "Processing service is temporarily unavailable". Confirm it is set
in Vercel for **Production**, not just Preview.

### Migrations

Two migrations were applied directly to the live database and verified:

* `supabase/migration_realtime.sql` — adds `jobs` and `clips` to the
  `supabase_realtime` publication with `REPLICA IDENTITY FULL`.
  Verified: `pg_publication_tables` now returns `jobs, clips` (was 0 rows).
* `supabase/migration_quota.sql` — atomic, limit-aware
  `increment_videos_used`, plus `increment_clips_used` and
  `refund_videos_used`, all returning `boolean`; adds `jobs.videos_refunded`.
  Verified: all three functions report `-> boolean`.

Run these in the Supabase SQL Editor for any new environment. They are
idempotent.

---

## 5. Failure playbook

| Symptom | First thing to check |
|---|---|
| Job stuck on `queued`, dashboard not moving | Realtime publication — `select * from pg_publication_tables where pubname='supabase_realtime'`. The UI also polls now, so a frozen page means the job genuinely never started. Check GitHub Actions is enabled and has minutes. |
| `We could not download that video` | The `DOWNLOAD DIAGNOSIS` block in the download step names the cause. Cookies are the usual answer. |
| Clips delivered but no captions | Should now be impossible: those clips are marked `failed`. If you see it, the fallback has been reintroduced somewhere. |
| Captions out of sync with speech | Check that trimming stayed in `prepare_clips.py`. If trimming moves back into Remotion, video and captions drift (see finding 1.4). |
| `Version mismatch` in the render step | `@remotion/*` packages have drifted apart. They must all be one version — see the comment in `remotion-captions/package.json`. |
| Job fails in ~40 s with a stage name | That is the intended fail-fast. The message names the stage; the `Record failure` step maps it to a user-facing reason. |

---

## 6. Highest-value next steps

1. **Accept direct uploads.** Every download failure, the cookie-rotation
   treadmill, and a ToS grey area all disappear if users upload their own file.
   **Cloudflare R2 is the free option:** 10 GB storage, and egress is free.
   Supabase Storage's 1 GB / 5 GB egress free tier cannot hold video.
2. **Rotate the committed anon JWT** in `.github/workflows/keep-alive.yml` — it
   is hardcoded in a public repository.
3. **Confirm Remotion licensing in writing.** The free licence covers
   organisations up to 3 employees; their "Automators" tier ($0.01/render,
   $100/month minimum) is explicitly aimed at automated video products. Get an
   answer before volume grows.
4. **Shard rendering across a matrix job.** Rendering is the wall-clock
   bottleneck (~2 min for 2 clips at `--concurrency=2` on 4 vCPUs). Splitting
   clips across runners scales close to linearly.
5. **Free tiers worth wiring** (verified, see the research doc): Gemini's free
   tier for long-context moment detection; R2 for delivery; Modal's $30/month
   free GPU if upscaling is ever wanted.
6. **Kitchen-sink upgrades not attempted:** b-roll insertion, speaker
   diarization, multi-format export (16:9 / 1:1), a caption QA gate before
   upload.

---

## 7. What was verified vs. what was not

**Verified against the live system:** Groq model availability (the old model
returns 404), NVIDIA NIM having no ASR models, the Realtime publication being
empty, the successful run having zero captioned clips, the full pipeline
end-to-end on real speech, caption continuity across a whole clip, output
geometry, and loudness.

**Verified locally only:** face tracking was proven on a synthetic moving face,
never on real speaker footage, and the two-person frame case is untested. The
de-esser heuristic in `enhance_audio.py` is calibrated on synthetic tones and
defaults to off.

**Not verified:** the dashboard fixes compile and their logic is tested, but the
UI was not exercised in a browser after the changes. The Vercel deployment
should be checked visually.
