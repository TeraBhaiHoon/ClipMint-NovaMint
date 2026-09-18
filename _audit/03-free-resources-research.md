# ClipMint — Best Free / Near-Free Resources (September 2026)

**Research date:** 2026-09-18
**Scope:** Free-tier resources that materially improve output quality, caption/transcript accuracy (incl. Hindi/Hinglish), speaker framing, runtime, storage/bandwidth cost, and AI moment detection for a solo-founder SaaS.
**Method:** Every number below was read off the vendor's live documentation or pricing page on 2026-09-18 with WebFetch. Where a figure could not be read off a live page, it is explicitly tagged **UNVERIFIED**. Derived arithmetic (not quoted from the vendor) is tagged **DERIVED**.
**Not legal advice.** Licensing section flags risk; a lawyer should confirm before shipping.

---

## 1. Decision Table

| Pipeline stage | Recommended free resource | Verified limits (verified 2026-09-18) | Why it beats the current choice | Risk |
|---|---|---|---|---|
| **Moment detection (LLM)** | **Google AI Studio Gemini free tier** (Gemini 3.8 Flash / 2.5 Flash / 2.5 Pro) | Free tier listed "Free of charge" for input **and** output tokens for Gemini 2.5 Pro, 2.5 Flash, 2.5 Flash-Lite, 3.5 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite, 3 Flash Preview, 3.8 Flash. Gemini 3.6 / 3.7 Flash show "Not available" on free tier. RPM/TPM/RPD **not published** on the public page (see §4) | **The current model is already dead.** `llama-3.3-70b-versatile` was shut down **08/16/26**. Gemini gives long-context + a real free tier | Rate limits not published; free-tier caps have historically been tightened without notice |
| **Moment detection (fallback / self-host)** | **Groq `openai/gpt-oss-120b`** | Free tier: RPM **30**, RPD **1,000**, TPM **8K**, TPD **200K**, context **131,072**. Also `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`, `groq/compound` (30/250/70K) | Official Groq replacement for the retired llama-3.3-70b; already on the stack | 200K tokens/day is small — a 90-min transcript is ~15–25K tokens, so ~8–13 runs/day |
| **Transcription (primary)** | **Groq `whisper-large-v3-turbo`** (keep) | Free tier: RPM **20**, RPD **2,000**, ASH **7,200**, ASD **28,800** audio-sec/day (= **8 h/day**). Max upload **25 MB** on free tier. Word timestamps via `timestamp_granularities=["word"]` + `response_format="verbose_json"` | Already in place and generous; word timestamps feed TikTok-style captions | 25 MB free-tier file cap forces audio chunking for long uploads; 8 h/day ceiling |
| **Transcription (Hindi/Hinglish accuracy)** | **Deepgram Nova-3 Multilingual** ($200 free credit) or **ElevenLabs Scribe v2** (Hindi ≤10% WER tier) | Deepgram: **$200 free credit, no expiry, no credit card**, concurrency 50 REST / 150 WSS; Nova-3 pre-recorded **$0.0043/min** mono, **$0.0052/min** multilingual. ElevenLabs: Hindi is published in the **"High Accuracy (>5% to ≤10% WER)"** tier; 90+ languages incl. Hindi; Free plan 10,000 credits/mo, STT = **330 credits/min** (~30 min/mo) | Whisper turbo is weak on Indian code-switching; Hindi-specific WER tiers are published for ElevenLabs and AssemblyAI | Deepgram/Speechmatics do **not** publish Hinglish code-switching. ElevenLabs free tier ≈30 min/mo only |
| **Transcription (Hindi, self-host, MIT)** | **AI4Bharat `indic-conformer-600m-multilingual`** | **MIT license**, 600M params, **22 official Indian languages**, Hindi **WER 13.2** (Vaani-Benchmark-V1.0) | Only MIT-licensed Indic ASR found; safe to self-host commercially | Hindi WER 13.2 is not clearly better than Whisper large-v3; use as a second opinion / Hindi-only path |
| **Transcription (burst beyond Groq's 8 h/day)** | **Cloudflare Workers AI `@cf/openai/whisper-large-v3-turbo`** | **$0.000513 per audio minute**; **10,000 neurons/day free** on Workers Free → **DERIVED ≈214 audio-min/day free**. Batch supported | Adds ~3.5 h/day of free ASR on infrastructure he already has | Neuron cost per audio-minute is not quoted per-model; §4 |
| **Speaker tracking / auto-reframe** | **MediaPipe FaceDetector + FaceLandmarker** | **Apache 2.0** (code samples), tasks `FaceDetector` / `FaceLandmarker`, models BlazeFace short-range / full-range / Sparse, platforms Android, Python, Web, iOS, modes IMAGE / VIDEO / LIVE_STREAM | Free, local, commercially safe, no GPU needed; handles the crop-and-follow problem | Not a full "auto-reframe" product — you must implement smoothing/pan logic yourself |
| **Face detection (alt)** | **OpenCV YuNet** (`face_detection_yunet`) | Model LICENSE = **MIT** ("Copyright 2020 Shiqi Yu"); opencv_zoo repo = Apache 2.0 | MIT model, tiny, fast, CPU-only | — |
| **Speaker segmentation** | **SAM 2** (facebookresearch/sam2) | "SAM 2 model checkpoints, SAM 2 demo code, and SAM 2 training code are licensed under **Apache 2.0**" | Precise mask-based subject isolation for punch-ins | Heavy; needs GPU → pair with Modal/RunPod |
| **Upscale / denoise / face restore** | **Real-ESRGAN (BSD-3-Clause) + GFPGAN (Apache 2.0) + FFmpeg filters** | Real-ESRGAN = **BSD-3-Clause**; GFPGAN = **Apache License 2.0**; FFmpeg = **LGPL 2.1+** (GPL 2+ if built `--enable-gpl`) | Real-ESRGAN + GFPGAN are commercially usable — a genuine quality jump for phone-shot verticals | **CodeFormer must be avoided** (see §3). libx264 is GPL → see §3 FFmpeg note |
| **Caption rendering** | **`@remotion/captions` `createTikTokStyleCaptions()`** | Package version **4.0.526**, **MIT**. API since **v4.0.216**; `durationMs` on pages since **v4.0.261**; `breakOnSilenceAfterMilliseconds` since **v4.0.514**; token `pageBreakAfter` since **v4.0.517** | Purpose-built for the exact viral-caption look; no hand-rolled pagination | Whitespace-sensitive: `text` must contain spaces and CSS `white-space: pre` |
| **Word-level timestamps locally** | **`@remotion/install-whisper-cpp`** | `installWhisperCpp()`, `downloadWhisperModel()`, `transcribe()`, `convertToCaptions()` (since **v4.0.131**). Models: `tiny`, `tiny.en`, `base`, `base.en`, `small`, `small.en`, `medium`, `medium.en`, `large-v1`, `large-v2`, `large-v3`, `large-v3-turbo`. `tokenLevelTimestamps: true` → `--dtw` → `t_dtw` field (needs Whisper.cpp ≥1.0.55) | Removes the 25 MB Groq upload cap and the 8 h/day ceiling entirely; zero marginal cost | Runs on GitHub Actions CPU (slow for `large-v3`); default model is `base.en` — set explicitly |
| **Hindi caption glyphs** | **`@remotion/google-fonts`** `loadFont()` | `loadFont()` with `weights` + `subsets` (both **required non-empty from v5.0**, else it throws); `waitUntilDone()` since v4.0.135; `ignoreTooManyRequestsWarning` since v4.0.283 | Fixes tofu/missing-glyph boxes for Devanagari captions | Devanagari font availability not confirmed on the page (§4) |
| **Storage + delivery** | **Cloudflare R2** | **10 GB-month** storage, **1M Class A**, **10M Class B** ops/month, **egress FREE** (Standard storage only) | Replaces Google Drive/rclone 15 GB; **zero egress fees** is the single biggest cost lever for delivering many MP4s | 10 GB is small for a video SaaS — pair with B2 (below) |
| **Cheap overflow storage** | **Backblaze B2** | First **10 GB storage always free**; free egress up to **3× average monthly storage**; **$0.01/GB** beyond; **egress to Cloudflare free** | 20 GB free combined; B2→Cloudflare egress waives the bill | Beyond 3× egress it costs money |
| **Runtime / >6 h jobs** | **Cloud Run Jobs** | Free tier **240,000 vCPU-seconds + 450,000 GiB-seconds per month**, resets monthly (instance-based & Jobs). Request-based services: 180,000 vCPU-s + 360,000 GiB-s + 2M requests | Escapes the **6 h/job** GitHub Actions ceiling *and* adds parallelism for ffmpeg | "A 1 vCPU / 512 MiB job running continuously would consume ~2.6M vCPU-seconds/month, far exceeding 240,000" (page's own arithmetic) |
| **GPU burst compute** | **Modal Starter** | **$30/month free compute**, $0 + compute, 3 seats, 100 containers, **10 GPU concurrency**. GPUs incl. T4, L4, A10, L40S, A100, H100, H200, B200, B300 | Free GPU for Real-ESRGAN/GFPGAN/SAM2 passes — currently impossible on GH Actions CPU | $30/mo is a hard ceiling; GPU seconds burn fast |
| **Orchestration / queueing** | **Cloudflare Queues + Durable Objects (Workers Free)** | Queues: **10,000 ops/day**, 24 h retention (non-configurable). Durable Objects: **100,000 req/day**, **13,000 GB-s/day**, 5 GB SQL total, 5M row reads/day, 100K rows written/day. Workers: **100,000 req/day**, **10 ms CPU** per invocation, **5 cron triggers/account** | Gives retry/backpressure semantics GH Actions lacks | **10 ms CPU** on free Workers — cannot do encoding; orchestration only |
| **Scheduling** | **Vercel Cron (Hobby)** | **100 cron jobs/project**, minimum interval **once per day**, precision **±59 min**. Expressions running more often **fail deployment** | Free scheduler already paid for | Cannot poll more than daily on Hobby |
| **Music / SFX / b-roll** | **Pixabay + Pexels + Freesound (CC0 only)** | Pixabay Content License: free commercial, **no attribution**, cannot resell standalone. Pexels License: free commercial, no attribution, no trademark use. Freesound: CC0 / CC-BY / **CC-BY-NC** | Safe free commercial assets | **CC-BY-NC sounds are commercially unusable**; Mixkit forbids video games/broadcast (§3) |

---

## 2. Category Detail

### 2.1 Free compute (GPU + long jobs)

**GitHub Actions — a finding that changes his cost model.**
`ubuntu-latest` is **4 vCPU / 16 GB RAM / 14 GB SSD only for PUBLIC repositories**. For **private** repositories it is **2 vCPU / 8 GB RAM / 14 GB SSD**. Verified via `https://docs.github.com/en/actions/reference/runners/github-hosted-runners` on 2026-09-18. If ClipMint's repo is private, he is running on half the RAM and half the cores he believes he has.
- Job execution: **6 hours/job** (GitHub-hosted); **5 days/job** self-hosted. Workflow run: **35 days**. Job concurrency on Free: **20**. Verified via `https://docs.github.com/en/actions/reference/limits` on 2026-09-18.
- Free minutes for private repos: GitHub Free **2,000 min/month**; public repos are free (unmetered). Verified via `https://docs.github.com/en/billing/concepts/product-billing/github-actions` on 2026-09-18.
- **Larger runners are never free:** "Larger runners are always charged for, even when used by public repositories or when you have quota available from your plan." Usage is blocked until a payment method is added. Verified via the same billing page on 2026-09-18. Baseline SKU rates: Linux 1-core $0.002/min, Linux 2-core $0.006/min, Linux 2-core arm64 $0.005/min.

**Google Colab (free).** Free of charge, includes GPU and TPU access, but "GPU and TPU types... vary over time" and are "heavily restricted" — **the FAQ does not name T4**, so "free T4" is **UNVERIFIED**. Max session **12 hours**. Prohibits "file hosting, media serving, or other web service offerings not related to interactive compute with Colab." Verified via `https://research.google.com/colaboratory/faq.html` on 2026-09-18. → Not viable as production infrastructure (the media-serving clause is a direct conflict for a video SaaS).

**Kaggle Notebooks.** Free accelerators: **P100 (1× GPU, 4 CPU cores, 29 GB RAM)** or **T4 ×2 (4 CPU cores, 29 GB RAM)**; CPU-only notebooks get **4 CPU cores / 30 GB RAM**. Max session **12 h** (CPU/GPU) and **9 h** (TPU); saved-version runs must also finish inside 12 h/9 h. Idle timeout while editing: **20 min**. Auto-saved disk: **20 GB** (`/kaggle/working`). Public GPU hours: **900 h** max per week for **video watch-time minutes**; phone verification is required before any GPU can run. Commercial use: no general restriction stated in the notebook limits section, but the docs say nothing grants commercial rights either — treat Kaggle as non-production. Reviewed via `https://r.jina.ai/https://www.kaggle.com/docs/notebooks` (help articles mirrored by the docs) on 2026-09-18. The commonly cited "30 h/week GPU" quota appears **nowhere** in the live docs → **UNVERIFIED as a published number**.

**Hugging Face Spaces — a major 2026 regression.** "Static Spaces are free for everyone. **Gradio and Docker Spaces run on compute and require a paid plan to create: PRO for personal accounts**, Team or Enterprise for organizations. Free personal accounts in good standing can still host up to **2 Gradio Spaces running on ZeroGPU**." Verified via `https://huggingface.co/docs/hub/spaces-overview` on 2026-09-18. The old "free CPU Basic 2 vCPU/16 GB" path is effectively closed for new Spaces.
- **ZeroGPU** is now **NVIDIA RTX Pro 6000 Blackwell**: sizes `large` (half card, 48 GB) and `xlarge` (full card, 96 GB, costs 2× quota). Hosting: **2 Spaces** for free personal accounts (verified email + account >30 days); PRO 10; orgs 50. **Daily GPU usage quota: Unauthenticated 2 min, Free account 5 min, PRO 40 min, Team 40 min, Enterprise 60 min.** Extensions past quota cost **$1 per 10 minutes**. `@spaces.GPU(duration=120)` sets max runtime; default 60 s. No `torch.compile` (AOT only). Verified via `https://huggingface.co/docs/hub/spaces-zerogpu` on 2026-09-18. → **5 GPU-min/day free is not a production path.**

**Hugging Face Jobs.** No free tier — "Jobs are available to any user or organization with a positive credit balance." Billed per minute; **CPU Basic (2 vCPU / 16 GB / 50 GB) = $0.01/hour**, CPU Upgrade (8 vCPU/32 GB) $0.03/h, T4-small $0.40/h, L4 $0.80/h, A10G-small $1.00/h, A100-large $2.50/h, H200 $5.00/h, RTX PRO 6000 $2.75/h. **Default timeout 30 minutes** — must pass `--timeout` explicitly. Verified via `https://huggingface.co/docs/hub/jobs-pricing` on 2026-09-18. → Not free, but CPU Basic at **$0.01/hour** is effectively free for long CPU ffmpeg jobs.

**Modal (the standout free GPU offer).** Starter plan is **"$0 + compute / month"** and includes **"$30 / month free compute"**, 3 workspace seats, 100 containers, **10 GPU concurrency**, limited scheduled/web functions. Team is $250 + compute with $100/mo free compute. GPU fleet: B300, B200, H200 SXM, H100 SXM5, RTX PRO 6000, A100 80/40 GB, L40S, A10, L4, T4. Verified via `https://modal.com/pricing` on 2026-09-18.

**Oracle Cloud Always Free — SPECS HAVE SHRUNK.** Current: Ampere A1 = **12 GB memory total** (one or two VMs), metered as **1,500 OCPU-hours and 9,000 GB-hours per month** (≈2 OCPU × 12 GB running continuously); **2 AMD VMs** at 1/8 OCPU / 1 GB each; **200 GB block volume** total (up to 2 volumes) + 5 volume backups; **10 TB/month outbound data transfer**. Verified via `https://r.jina.ai/https://www.oracle.com/cloud/free/` on 2026-09-18.
> **The "4 OCPU / 24 GB ARM" figure in the brief is out of date.** 1,500 OCPU-hours ÷ 744 h ≈ **2 OCPUs**, and 9,000 GB-hours ÷ 744 h ≈ **12 GB**. Budget for half the machine. No idle-reclamation policy is stated on that page (**UNVERIFIED** whether reclaim still happens in practice).

**AWS Free Tier — restructured in 2026.** New accounts get **"$100 in credits immediately"** and can earn **"up to $100 more"** (**up to $200 over 6 months**). Four offer types: Free plan (90+ services for up to 6 months), Paid plan, short-term trials, and **"Always free: 30+ AWS services... within monthly usage limits."** The page does **not** publish the per-service hourly/GB numbers (no 750 h t2.micro, no 5 GB S3 figures) → **those exact amounts are UNVERIFIED**. Verified via `https://aws.amazon.com/free/` on 2026-09-18.

**Google Cloud Always Free (recurring monthly, not one-time).**
- Compute Engine: **one non-preemptible `e2-micro`** per month in `us-west1`, `us-central1`, or `us-east1`; **30 GB-months standard persistent disk**; **1 GB** outbound data transfer from North America/month. GPUs/TPUs excluded and always charged.
- Cloud Storage: **5 GB-months** regional (US regions), **5,000 Class A ops**, **50,000 Class B ops**, **100 GB outbound data transfer from North America/month**.
- Cloud Run (request-based): **2M requests**, **180,000 vCPU-seconds**, **360,000 GB-seconds**, **1 GB** NA egress per month.
- Cloud Run functions: **2M invocations**, **400,000 GB-seconds**, **200,000 GHz-seconds**, **5 GB** egress per month.
- Verified via `https://r.jina.ai/https://cloud.google.com/free/docs/free-cloud-features` on 2026-09-18.

**Cloud Run free tier (per the pricing page, orthogonal to the GCP free-tier page):** Services instance-based **240,000 vCPU-s + 450,000 GiB-s**/month; request-based **180,000 vCPU-s + 360,000 GiB-s + 2M requests**; Jobs **240,000 vCPU-s + 450,000 GiB-s**; Delayed Jobs 342,857 / 642,857; Worker pools 384,204 / 728,744. Egress: **1 GiB free** NA/month on the Premium tier. "The free tier usage is aggregated across projects by billing account and **resets every month**." Cost warning from the page itself: a 1 vCPU / 512 MiB container running continuously would consume **~2.6M vCPU-seconds/month**, far beyond the grant. Containers are general OCI images, so an ffmpeg image is technically runnable (the page does not forbid it) — but **Cloud Run Jobs is the correct primitive for batch transcoding** ("billed at the Instance-based billing rate, for the entire lifetime of any instance started, with a minimum of 1 minute"). Verified via `https://cloud.google.com/run/pricing` on 2026-09-18.

**Cloudflare Containers — NO free tier.** "Free" is listed as **N/A** for memory, CPU, and disk; Containers require Workers Paid ($5/mo), which includes **25 GiB-hours memory, 375 vCPU-minutes, 200 GB-hours disk** per month. Instance types run from lite (1/16 vCPU, 256 MiB, 2 GB disk) to standard-4 (4 vCPU, 12 GiB, 20 GB). Egress $0.025/GB (NA/EU, 1 TB included), $0.04/GB elsewhere. Verified via `https://developers.cloudflare.com/containers/pricing/` on 2026-09-18. → **The brief's "does Cloudflare Containers have a free tier" answer is: no.**

**RunPod.** No free tier, no signup credit, no free serverless allowance anywhere on the pricing page → **free credits UNVERIFIED / apparently non-existent.** Paid rates (community/secure): RTX A5000 from $0.16–0.27/hr, RTX 4090 $0.34–0.74/hr, A40 $0.35–0.49/hr, L4 $0.49/hr, A100 $1.59/hr, H100 PCIe $1.99–2.89/hr, H200 $4.59/hr, B200 $6.79/hr, B300 $6.94–7.89/hr. Network storage from $0.05/GB/mo. Verified via `https://www.runpod.io/pricing` on 2026-09-18.

**Vast.ai.** No free credits or free tier described; only On-Demand, Interruptible ("50%+ cheaper") and Reserved ("Up to 50% Off"). Billing is per-second, 68+ GPU types from RTX 3060 to B200. → **free credits UNVERIFIED.** Verified via `https://vast.ai/pricing` on 2026-09-18.

**Fly.io — free allowance is gone.** The page describes a pure "pay as you go" model with a credit card required for all organizations except Linked Organizations. The only free allowances left: **first 10 GB of volume snapshots/month free**, **first 10 single-hostname SSL certs free**, free inbound/same-region data transfer, free shared IPv4 + unlimited Anycast IPv6. Verified via `https://fly.io/docs/about/pricing/` on 2026-09-18.

**Deno Deploy (Free plan, still available).** **$0/month**: **1M requests/month**, **10 hr active CPU**, **150 GiB-hr memory**, **20 GiB egress**, 5 custom domains, 10 GiB revision storage, 10 apps, 1 concurrent build, 15 builds/hour, **1 GiB KV**, 1M KV read units/mo, 500K KV write units/mo, 3 team members, 1-day log retention. Idle apps "automatically shut down after ~20–30 seconds." Wall-clock limit **not stated** → **UNVERIFIED**. Verified via `https://deno.com/deploy/pricing` on 2026-09-18.

### 2.2 Transcription / ASR (incl. Hindi/Hinglish)

| Service | Free allowance | Hindi / Hinglish | Source (verified 2026-09-18) |
|---|---|---|---|
| **Groq** `whisper-large-v3-turbo`, `whisper-large-v3` | RPM **20**, RPD **2,000**, ASH **7,200**, ASD **28,800** (=**8 h/day**); max file **25 MB** free tier | "Multilingual" only; no Indic WER published. `whisper-large-v3` is the accuracy option, turbo the speed option | `console.groq.com/docs/rate-limits`, `/docs/speech-to-text` |
| **Cloudflare Workers AI** `@cf/openai/whisper-large-v3-turbo` | **$0.000513/audio-minute**; 10,000 neurons/day free → **DERIVED ≈214 audio-min/day**. Batch supported. `whisper`, `whisper-tiny-en` (English-only) also listed | Not stated on the model page — **language list UNVERIFIED** | `developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/`, `/workers-ai/platform/pricing/` |
| **Deepgram** | **$200 free credit, no expiration, no credit card**, concurrency 50 REST / 150 WSS; Nova-3 pre-recorded **$0.0043/min** mono, **$0.0052/min** multilingual | Nova-3 **Multilingual** exists; supported-language list **UNVERIFIED** | `deepgram.com/pricing` |
| **AssemblyAI** | **$50 free credits on signup, no credit card**; concurrency 5 new streams/min on free. Universal-2 **$0.15/hr** (99 languages incl. `hi`), Universal-3.5 Pro **$0.21/hr** (18 languages) | Hindi = `hi` on both models. Accuracy groups published (≤10% WER "high", >10–25% "good"). **No Hinglish code-switching claim** — only "Spanglish" is named | `assemblyai.com/pricing`, `assemblyai.com/docs/speech-to-text/pre-recorded-audio/supported-languages` |
| **ElevenLabs Scribe v2** | Free plan **10,000 credits/month**; STT costs **330 credits/minute** → **~30 min/month**; 330 credits/min ≈ 19,800 credits/hour | **Hindi published in the "High Accuracy (>5% to ≤10% WER)" tier** — the most useful published Hindi number found. 90+ languages. Urdu sits in "Moderate (>25–50% WER)" | `elevenlabs.io/pricing`, `elevenlabs.io/docs/capabilities/speech-to-text` |
| **Speechmatics** | **$100 free credit, no credit card**. Pro rate shown as 0.129 (unit not stated) | Hindi, Bengali, Marathi, Tamil, Urdu transcription supported. **Melia-1 multilingual code-switching is listed as Arabic, Spanish, Mandarin, Malay, Tamil — Hindi NOT listed.** No Indic WER claims published | `speechmatics.com/pricing` |
| **AI4Bharat IndicConformer** | Self-host, free | **MIT license**, 600M params, **22 official Indian languages**, **Hindi WER 13.2** (Vaani-Benchmark-V1.0) | `huggingface.co/ai4bharat/indic-conformer-600m-multilingual` |
| **Hugging Face Inference Providers** | Free users **$0.10/month**; PRO $2.00 | n/a | `huggingface.co/docs/inference-providers/pricing` |
| **OpenAI Whisper via free credits** | OpenAI no longer lists a standing free API credit grant → **UNVERIFIED / treat as none** | — | — |

**Hinglish verdict.** No vendor publishes a Hinglish/code-switching WER. The strongest verified signals for Hindi are ElevenLabs' ≤10% WER tier and AssemblyAI's Hindi support. **Recommended play:** run Groq `whisper-large-v3-turbo` as today, and on Hindi/Hinglish files run **Deepgram Nova-3 Multilingual** (paid out of the $200 credit) or **self-hosted AI4Bharat IndicConformer (MIT)** as a second pass, then pick the higher-confidence transcript. Treat Hinglish quality as **empirically testable, not documented** — build a 20-clip golden set and measure.

### 2.3 LLM APIs for the moment-detection step

| Provider | Free tier (verified 2026-09-18) | Long-context fit | Source |
|---|---|---|---|
| **Google AI Studio (Gemini)** | "Free of charge" input+output on 2.5 Pro, 2.5 Flash, 2.5 Flash-Lite, 3.1 Flash-Lite, 3.5 Flash, 3.5 Flash-Lite, 3 Flash Preview, 3.8 Flash. **Not free:** 3.6 Flash, 3.7 Flash. Gemini 2.5 Pro free tier **excludes context caching** | Best free long-context option | `ai.google.dev/gemini-api/docs/pricing` |
| **Groq** | `openai/gpt-oss-120b`: RPM 30 / RPD 1,000 / TPM 8K / TPD 200K, ctx 131,072. `openai/gpt-oss-20b` same. `qwen/qwen3.8-27b` same. `groq/compound` & `compound-mini`: RPM 30 / RPD 250 / TPM 70K. Guard models: RPM 30 / RPD 14,400 | 131K ctx; 200K TPD is the binding constraint | `console.groq.com/docs/rate-limits`, `/docs/models` |
| **Cloudflare Workers AI** | 10,000 neurons/day free. Text models include `glm-5.3` (**1.3M ctx**), `deepseek-v4-flash-0731` / `deepseek-v4-pro-0813` (**1M ctx**), `qwen3.8-27b` & `kimi-k2.6` (262.1K), `nemotron-3-120b-a12b` (256K), `gemma-4-26b-a4b-it` (256K), `gpt-oss-120b`/`20b` (128K), `llama-3.3-70b-instruct-fp8-fast` (**24K**), `llama-4-scout-17b-16e-instruct` (131K). Some frontier models (kimi-k2.6/k2.7-code, glm-5.2/5.3/5.3-flash, deepseek-v4-flash/pro) **require a paid billing method** | **1.3M ctx for free-tier neurons** is a genuine differentiator | `developers.cloudflare.com/workers-ai/models/`, `/workers-ai/platform/pricing/` |
| **OpenRouter** | `:free` models: **20 RPM**; **50 RPD** if <10 credits ever purchased; **1,000 RPD** if ≥10 credits purchased (granted from 9 credits). `GET /api/v1/key` reports `free_model_daily_requests` | Varies by model | `openrouter.ai/docs/api-reference/limits` |
| **Cerebras** | **No permanent free tier.** Only a **Free Trial: $5 in credits, expiring 30 days** after grant, and requires a verified payment method. Trial limits: RPM 5, TPM 30K uncached, TPH 1M, **TPD 1M**; models `gpt-oss-120b`, `qwen-3.8-27b` | 1M TPD but 5 RPM is the bottleneck | `inference-docs.cerebras.ai/support/rate-limits` |
| **NVIDIA NIM (build.nvidia.com)** | Free tier: **"up to 40 requests per minute (RPM) for most models, with no per-token billing."** Credit balances are no longer mentioned on the page → the old "1000/5000 credits" claim is **UNVERIFIED** | 40 RPM uncapped tokens is strong for this workload | `build.nvidia.com/explore/discover` (via r.jina.ai) |
| **GitHub Models** | **RETIRED.** "GitHub Models has been fully retired as of July 30, 2026" — playground, model catalog, inference API and BYOK all removed. Redirects to Azure AI Foundry / Copilot | **Dead end** | `docs.github.com/en/github-models/about-github-models` |
| **Together AI** | Only **Ternary Bonsai 27B** shows $0.00 in/out. No other free models, no published free-tier rate limits | Weak | `together.ai/pricing` |
| **SambaNova** | **No free tier mentioned** on the pricing page (models: MiniMax-M2.7/M3, DeepSeek-V3.1/V3.2, gemma-4-31B-it, gpt-oss-120b, Meta-Llama-3.3-70B-Instruct) | **UNVERIFIED** — free tier appears discontinued | `cloud.sambanova.ai/pricing` |
| **Mistral** | Docs URLs (`/deployment/laplateforme/tier/`, `/deployment/laplateforme/overview/`) returned **404** → free-tier limits **UNVERIFIED** | — | — |

**Best zero-cost option for long-context transcript analysis:** Gemini free tier for depth, with **Cloudflare Workers AI `glm-5.3` (1.3M ctx)** or `deepseek-v4-flash` as the self-contained long-context fallback, and **Groq `gpt-oss-120b`** for speed-limited burst. Note that a whole-transcript single-shot prompt is often *worse* than chunked moment detection — the long context is a convenience, not automatically higher quality.

### 2.4 Video reframing / speaker tracking / face detection — with licenses

- **MediaPipe (Apache 2.0)** — `FaceDetector` and `FaceLandmarker` tasks; models **BlazeFace short-range**, **BlazeFace full-range**, **BlazeFace Sparse**; platforms **Android, Python, Web, iOS**; runs on "Still images, decoded video frames, live video feed" with `IMAGE` / `VIDEO` / `LIVE_STREAM` modes. Page content is CC-BY 4.0, **code samples Apache 2.0**. Verified via `https://developers.google.com/edge/mediapipe/solutions/vision/face_detector` on 2026-09-18. → **Best free, commercially safe, CPU-capable path for auto-reframe.**
- **OpenCV YuNet** — model LICENSE is **MIT** ("Copyright 2020 Shiqi Yu"); the `opencv_zoo` repo is **Apache 2.0**, and the repo warns "Please refer to licenses of different models" for model-specific terms. Verified via `https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/face_detection_yunet/LICENSE` on 2026-09-18.
- **InsightFace — DO NOT SHIP.** "The code of InsightFace is released under the MIT License. **The training data containing the annotation (and the models trained with these data) are available for non-commercial research purposes only.**" This applies to auto-downloaded models including `buffalo_l`. Verified via `https://github.com/deepinsight/insightface` on 2026-09-18.
- **Ultralytics YOLO — AGPL-3.0, dangerous for SaaS.** AGPL-3.0 applies by default, including "**All Ultralytics YOLO trained models**". An **Enterprise License** is required for "Internal business tools or private company applications," "**Any commercial product or service**," "Proprietary / closed-source software," SaaS/APIs, embedded deployments, and commercially used fine-tuned models. The stated obligation is "the requirement to open-source modified works or larger works containing Ultralytics YOLO code and models." Pricing is not published ("tailored to each organization's size"). Verified via `https://www.ultralytics.com/license` on 2026-09-18.
- **SAM 2** (facebookresearch/sam2) — "**The SAM 2 model checkpoints, SAM 2 demo code (front-end and back-end), and SAM 2 training code are licensed under Apache 2.0.**" Repo also shows BSD-3-Clause. Verified via `https://github.com/facebookresearch/sam2` on 2026-09-18.
- **Free reframing API:** none found → **UNVERIFIED**.

### 2.5 Video enhancement / upscaling / denoise — with licenses

| Tool | License | Commercial SaaS OK? | Source (2026-09-18) |
|---|---|---|---|
| **Real-ESRGAN** | **BSD-3-Clause** | **Yes** | `github.com/xinntao/Real-ESRGAN` |
| **GFPGAN** | **Apache License 2.0** | **Yes** (note: it builds on StyleGAN2-derived architecture — see §3 caveat) | `github.com/TencentARC/GFPGAN` |
| **CodeFormer** | **NTU S-Lab License 1.0** | **NO** — license permits "Redistribution and use **for non-commercial purpose**" and requires contacting the contributors for "commercial purpose" | `raw.githubusercontent.com/sczhou/CodeFormer/master/LICENSE` |
| **FFmpeg** | **LGPL 2.1+** by default; **GPL 2+** if built with `--enable-gpl`. Not offered under proprietary terms "not even in exchange for payment." The page explicitly warns about GPL libraries "notably **libx264**" | Yes if LGPL build + dynamic linking and no GPL components; encoder choice matters | `ffmpeg.org/legal.html` |
| **ffmpeg filters** `hqdn3d`, `nlmeans`, `atadenoise`, `unsharp`, `cas` | Inherit FFmpeg's license | Yes (same conditions) — individual filter pages **not fetched**, so filter availability in any given build is **UNVERIFIED** | — |

**Free cloud upscaler APIs:** none verified. **UNVERIFIED / no such free tier found.**

### 2.6 Caption / subtitle rendering (Remotion) — exact APIs and the license

**Current version.** `@remotion/captions` on `main` is **4.0.526**, license **MIT**. Verified via `https://raw.githubusercontent.com/remotion-dev/remotion/main/packages/captions/package.json` on 2026-09-18. Note the docs already describe **v5.0** behaviour changes (see `loadFont` below), so v5.x exists or is imminent.

**`@remotion/captions`**
- Install: `npx remotion add @remotion/captions`
- `createTikTokStyleCaptions()` — available since **v4.0.216**. Options: `captions` (array of `Caption`), `combineTokensWithinMilliseconds`, and `breakOnSilenceAfterMilliseconds` (**v4.0.514**). Returns `{ pages }` where each `TikTokPage` has `text`, `startMs`, `durationMs` (**v4.0.261**), and `tokens` with `text`, `fromMs`, `toMs`, `pageBreakAfter` (**v4.0.517**). Safe in browser, Node.js, and Bun.
- `breakOnSilenceAfterMilliseconds` "only adds earlier page breaks" — pages "can only get shorter, never longer"; `0` breaks at every word boundary.
- **Whitespace gotcha:** `text` is whitespace sensitive — "You should include spaces in it, ideally before each word." Missing spaces "will cause the entire text to merge into a single line or page." Apply CSS `white-space: pre`.
- Conversion helpers: `toCaptions()` (from `@remotion/install-whisper-cpp` and `@remotion/whisper-web`), `openAiWhisperApiToCaptions()` (from `@remotion/openai-whisper`), `elevenLabsTranscriptToCaptions()` (from `@remotion/elevenlabs`).
- Verified via `https://www.remotion.dev/docs/captions`, `/docs/captions/api`, `/docs/captions/create-tiktok-style-captions` on 2026-09-18.

**`@remotion/install-whisper-cpp`** — `installWhisperCpp()`, `downloadWhisperModel()`, `transcribe()`, `convertToCaptions()`; since **v4.0.131**. Model names accepted by `transcribe()`: `tiny`, `tiny.en`, `base`, `base.en`, `small`, `small.en`, `medium`, `medium.en`, `large-v1`, `large-v2`, `large-v3`, `large-v3-turbo`. **Default is `base.en`** — you must pass `large-v3-turbo` explicitly. `tokenLevelTimestamps: true` passes `--dtw` to Whisper.cpp and returns the more accurate `t_dtw` field (Whisper.cpp ≥1.0.55; prefer `t_dtw` over `offsets`). `tokensPerItem` can only be set when `tokenLevelTimestamps` is false. Verified via `https://www.remotion.dev/docs/install-whisper-cpp/transcribe` on 2026-09-18.

**`@remotion/google-fonts`** — `loadFont()` with `weights` and `subsets` options; `waitUntilDone()` since **v4.0.135**; `ignoreTooManyRequestsWarning` since **v4.0.283**. **Breaking change: from v5.0, `weights` and `subsets` are required non-empty arrays, otherwise `loadFont()` throws.** Verified via `https://www.remotion.dev/docs/google-fonts/load-font` on 2026-09-18. Devanagari/Hindi font availability (e.g. Noto Sans Devanagari) was **not confirmed on the page → UNVERIFIED**; test it before relying on it for Hindi captions.

**REMOTION LICENSING — the founder must read this twice.**
- **Free License:** "For individuals and companies of up to 3 people"; "unlimited use"; "Commercial use allowed"; "No sign up needed". LICENSE.md eligibility: "an individual", "**a for-profit organization with up to 3 employees**", "a non-profit or not-for-profit organization", or someone evaluating. **No revenue threshold is stated anywhere** — eligibility is headcount-based. Verified via `https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md`, `https://www.remotion.pro/license`, and `https://www.remotion.dev/docs/license/faq` on 2026-09-18.
- **Remotion for Creators:** **$25/month per seat** (1 seat per user; 3 seats = $75).
- **Remotion for Automators:** **"$0.01 per render, $100/mo minimum"** (10,000 renders = $100). Described as "For companies launching applications and systems; such as video editors, prompt-to-video apps, embedding the Remotion Player, or **any other automated video creation**." "Developers working on automation projects do not require a Seat."
- **Company License:** for "collaborations and companies of 4+ people," pay according to usage, example total $100/month, includes $250 Mux credits (new Mux customers).
- **Enterprise License:** from **$500/month**.
- **The FAQ's acceptable-use line is the one that saves him:** acceptable = "Allowing users to create and render their own personalized video based on your Remotion template." Unacceptable = "Allowing users to submit any Remotion video, meaning a Remotion project, to your server for rendering." ClipMint takes *raw video* + ClipMint's own template → falls in the acceptable bucket.
- **Risk assessment:** as a 1-person company rendering its own template, the **Free License** appears to cover ClipMint with unlimited renders. But an **"Automators" tier exists specifically for "any other automated video creation,"** and its page presents itself as the tier for automated systems **"It does not state an exception based on company size."** That is a real ambiguity worth one email to Remotion for written confirmation before scaling revenue. Worst case is **$100/month** (10,000 renders) — cheap insurance relative to a licensing dispute.

### 2.7 Free storage + CDN for video delivery

| Option | Free allowance | Egress | Verdict |
|---|---|---|---|
| **Cloudflare R2** | **10 GB-month** storage, **1M Class A** ops, **10M Class B** ops per month (Standard storage only) | **Free** | **Best free option for delivering many vertical MP4s** — zero egress is the decisive factor |
| **Backblaze B2** | **First 10 GB storage always free** | Free up to **3× average monthly storage**, then **$0.01/GB**; **egress to Cloudflare is free** (Cloudflare listed among free-egress partners) | Best overflow tier; pair B2 → Cloudflare |
| **Supabase Storage** | **1 GB file storage, 5 GB egress, 5 GB cached egress**; max upload **50 MB**; 500 MB DB; 500K edge invocations; 2 active projects; **pauses after 1 week of inactivity** | Metered | **1 GB is far too small for video** — keep Supabase for metadata only |
| **Bunny CDN** | **14-day free trial**, no card. **No permanent free tier.** | $0.01/GB EU/NA, $0.03/GB Asia/Oceania; **$1/month minimum** | Good paid fallback, not a free resource |
| **Wasabi** | **No free tier** (free trial only) | **No fees for egress or API requests** | $7.99 TB/month — not free |
| **Internet Archive** | Upload/create account terms not retrievable from live pages (404s) → **UNVERIFIED**, and its archive-not-CDN purpose plus uncertain privacy/commercial terms make it unsuitable | — | **Do not use for commercial delivery** |

Verified via `developers.cloudflare.com/r2/pricing/`, `backblaze.com/cloud-storage/pricing`, `supabase.com/pricing`, `bunny.net/pricing/`, `wasabi.com/pricing` on 2026-09-18.

**Recommendation:** **R2 primary (10 GB + free egress) → B2 overflow when >10 GB (free-to-Cloudflare egress).** Move the dashboard's video URLs to R2 public buckets / custom domain. This removes the Google Drive/rclone dependency and its 15 GB cap, and eliminates egress bills which are the classic killer for a video SaaS.

### 2.8 Long-running job orchestration beyond GitHub Actions' 6-hour limit

| Platform | Verified free limits (2026-09-18) | Notes |
|---|---|---|
| **GitHub Actions** | **6 h/job** GitHub-hosted; 5 days/job self-hosted; 35-day workflow run; Free plan concurrency 20; 2,000 min/month private | The 6 h wall is real and confirmed |
| **Cloudflare Workers Free** | **100,000 requests/day**; **10 ms CPU** per HTTP invocation and per Cron Trigger; **5 Cron Triggers/account** | 10 ms CPU rules out any encoding on free Workers |
| **Cloudflare Queues (Free)** | **10,000 operations/day**; retention **24 h, non-configurable**; an operation = each 64 KB written/read/deleted | Great for retry/backpressure; small daily ceiling |
| **Cloudflare Durable Objects (Free)** | **100,000 requests/day**; **13,000 GB-s/day**; **5 GB SQL total**; **5M row reads/day**; **100K rows written/day**; SQLite backend only | Usable free state machine for job coordination |
| **Cloudflare Containers** | **No free tier** — Workers Paid $5/mo | See §2.1 |
| **Supabase Edge Functions** | **150 s wall-clock** (free), 400 s paid; **256 MB memory**; **2 s CPU per request**; 150 s idle timeout; 100 functions/project | 150 s is the hard cap — not a render worker |
| **Vercel Cron (Hobby)** | **100 cron jobs/project**; **minimum interval once per day**; **±59 min** precision; sub-daily expressions **fail deployment** | Fine for daily sweeps, useless for polling |
| **Deno Deploy Free** | 1M req/mo, **10 h active CPU**, 150 GiB-hr memory, 20 GiB egress, 1 GiB KV; idle apps shut down in ~20–30 s | Wall-clock limit unstated |
| **Fly.io** | **No general free tier** (pay as you go). First 10 GB volume snapshots and first 10 SSL certs free | Free Machines allowance is gone |
| **Railway / Render** | **Not fetched — UNVERIFIED.** Treat as no meaningful free tier | — |
| **Cloud Run / Cloud Run Jobs** | **240,000 vCPU-s + 450,000 GiB-s/month** free, resets monthly; Jobs billed with a 1-minute minimum per instance | **The best free escape hatch from the 6 h wall**; supports containerised ffmpeg |
| **Oracle Cloud Always Free** | **~2 OCPU / 12 GB ARM** + 2 tiny AMD VMs; 200 GB block volume; 10 TB/month egress | A free always-on worker for polling, not for heavy encode |
| **Hugging Face Jobs** | No free tier; **CPU Basic 2 vCPU/16 GB = $0.01/hour**; default timeout 30 min | Effectively free CPU for long ffmpeg batches |

**Recommended orchestration pattern:** GitHub Actions for the parallel fan-out (matrix across clips), **Cloudflare Queues + Durable Objects** for retry/state on the free tier, **Cloud Run Jobs** when a single unit of work exceeds 6 h or when you need N parallel ffmpeg workers, and **Modal** when a step needs a GPU.

### 2.9 Free music / SFX / b-roll usable commercially

| Source | License terms (verified 2026-09-18) | Commercial in a SaaS? |
|---|---|---|
| **Pixabay** | Content License: "Use Content for free," "Modify or adapt Content into new works," "Use Content **without having to attribute** the author." Prohibited: selling/distributing on a "standalone basis," using recognizable marks on merchandise, immoral/illegal/misleading use, use in a "trade-mark, design-mark, trade-name, business name or service mark" | **Yes** — avoid standalone resale and trademark use |
| **Pexels** (photos + videos) | "All photos and videos on Pexels can be downloaded and used for free," no attribution required, may modify. Prohibited: identifiable people "in a bad light," selling unaltered copies, implying endorsement, redistributing on other stock platforms, use as a trade/service mark | **Yes** — Pexels API rate limits **UNVERIFIED** (page 403'd) |
| **Freesound** | Licenses available: **CC0**, **CC-BY**, **CC-BY-NC** (Sampling+ retired). "Some sounds you cannot use commercially." CC0 = "do pretty much what you want"; CC-BY = must credit; **CC-BY-NC = "you can't earn any money with the piece of work you create"** | **Only CC0 and CC-BY.** Filter out CC-BY-NC in code |
| **Mixkit** | "free, royalty free music... at no cost whatsoever," attribution appreciated not required, permitted on YouTube, blogs, music videos, websites, social, podcasts, online ads. Prohibited: "**You are not permitted to use Mixkit music in CDs, DVDs, Video Games or TV & Radio broadcasts**" | **Probably yes**, but the license does **not** address embedding in a software product that generates videos for users → **UNVERIFIED for the SaaS case.** Get written permission or use Pixabay/Pexels instead |
| **Coverr, Internet Archive, free AI b-roll generation** | **Not fetched / no verified free tier found** | **UNVERIFIED** |

Verified via `https://r.jina.ai/https://pixabay.com/service/license-summary/`, `https://r.jina.ai/https://www.pexels.com/license/`, `https://freesound.org/help/faq/`, `https://mixkit.co/free-stock-music/` on 2026-09-18.

---

## 3. LICENSING — what cannot be used commercially for free

> Not legal advice. Confirm with counsel before shipping any of the "NO" items.

### Hard NO for a paid SaaS

| Asset | License | The restriction |
|---|---|---|
| **CodeFormer** | **NTU S-Lab License 1.0** | Permits "Redistribution and use **for non-commercial purpose**"; commercial requires contacting the contributors. Verified via `raw.githubusercontent.com/sczhou/CodeFormer/master/LICENSE`. **Replace with GFPGAN (Apache 2.0).** |
| **InsightFace models** (e.g. `buffalo_l`) | Code MIT, **models non-commercial** | "The training data containing the annotation (and the models trained with these data) are available for **non-commercial research purposes only**." Affects both manual and auto-downloaded models. Verified via `github.com/deepinsight/insightface`. **Replace with MediaPipe (Apache 2.0) or YuNet (MIT).** |
| **Ultralytics YOLO** (all trained models) | **AGPL-3.0** | AGPL applies by default to code *and* "All Ultralytics YOLO trained models." An **Enterprise License** (price not published) is required for "Any commercial product or service," closed-source software, and SaaS/APIs. Otherwise you must open-source your larger work. Verified via `ultralytics.com/license`. **ClipMint cannot ship YOLO on AGPL.** |
| **Freesound CC-BY-NC sounds** | **CC-BY-NC** | "you can't earn any money with the piece of work you create." Verified via `freesound.org/help/faq/`. Filter to CC0/CC-BY only. |
| **Mixkit in video games / TV / radio** | Mixkit free licenses | "You are not permitted to use Mixkit music in CDs, DVDs, Video Games or TV & Radio broadcasts." Also silent on software-embedded generation. Verified via `mixkit.co/free-stock-music/`. |

### Conditional — understand before shipping

| Asset | Situation |
|---|---|
| **Remotion** | Free License covers "individuals and for-profit organizations with up to 3 employees," commercial use, unlimited renders — **no revenue threshold is published**. A solo founder qualifies. **But** the paid **"Automators"** tier ($0.01/render, $100/mo minimum) is described as being for "video editors, prompt-to-video apps... or any other automated video creation," and its page "does not state an exception based on company size." The FAQ lists ClipMint's exact flow (users submit *raw video*, you render *your* template) as **acceptable**. **Action: get written confirmation from Remotion; budget $100/month as the worst case.** Also note the **Free License does not permit users uploading their own Remotion projects.** Verified via `remotion.dev/docs/license/faq`, `remotion.pro/license`, `raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md`. |
| **FFmpeg / libx264** | FFmpeg is LGPL 2.1+ **only** without `--enable-gpl`/`--enable-nonfree`; the official page warns about GPL libraries "notably **libx264**." To stay LGPL for a closed-source SaaS: build without `--enable-gpl`, dynamically link, and prefer a non-GPL encoder (e.g. hardware encoders or an LGPL-compatible muxing path). FFmpeg is "not offered under proprietary or commercial terms, not even in exchange for payment." Also flagged: patent licensing exposure for codecs once you profit. Verified via `ffmpeg.org/legal.html`. |
| **GFPGAN** | Repo license is **Apache 2.0** (commercially fine). Caveat: it is built on StyleGAN2-derived architecture whose upstream NVIDIA implementation has historically carried separate non-commercial terms — verify the actual dependency chain in your build before shipping. |
| **SAM 2** | Apache 2.0 for checkpoints, demo code, and training code → commercially fine. |
| **Real-ESRGAN** | BSD-3-Clause → commercially fine. |
| **MediaPipe / YuNet** | Apache 2.0 (MediaPipe code samples, opencv_zoo repo) and **MIT** (YuNet model LICENSE) → commercially fine. **These are the safe face-detection choices.** |
| **AI4Bharat IndicConformer** | **MIT** → commercially fine. |
| **Pixabay / Pexels** | Free commercial, no attribution → fine, subject to the standalone-resale and trademark prohibitions. |

**The single most important licensing risk: Remotion's "Automators" tier.** It is the only one attached to code ClipMint *already ships and monetises*, it is explicitly described as applying to "**any other automated video creation**," the terms are ambiguous about whether a ≤3-person company still qualifies for the Free License while running an automated SaaS, and the downside is revenue-linked. Resolve it in writing this week. The runner-up — worth equal attention before adopting anything new — is **Ultralytics YOLO's AGPL-3.0**, which silently converts a closed-source SaaS into an open-source obligation.

---

## 4. What I could not verify (honest dead ends)

1. **Gemini free-tier RPM / TPM / RPD.** The live rate-limits page no longer publishes per-model free numbers — it says limits "can be viewed in Google AI Studio" and that "Specified rate limits are not guaranteed." The *pricing* page confirms the models are free of charge. **Exact per-minute/day caps are UNVERIFIED.**
2. **Kaggle's published weekly GPU quota.** The docs confirm 12 h sessions, P100 / T4×2 accelerators, 4 cores / 29 GB RAM, 20 GB disk and mention only the Colab Pro promo ("15 and 30 hours of extra GPU hours per week"). The widely repeated **"30 h/week" is not in the live docs → UNVERIFIED.**
3. **Google Colab free GPU model.** The FAQ says GPU "types... vary over time" and are "heavily restricted." **"Free T4" is UNVERIFIED.**
4. **NVIDIA NIM credits.** No credit balance is mentioned on build.nvidia.com; only "up to 40 requests per minute (RPM) for most models, with no per-token billing." **The "1,000 / 5,000 free credits" claim is UNVERIFIED.**
5. **Mistral free tier.** Two documentation URLs returned **404** (`/deployment/laplateforme/tier/`, `/deployment/laplateforme/overview/`). **UNVERIFIED.**
6. **SambaNova free tier.** No free tier on the pricing page — **appears discontinued, UNVERIFIED.**
7. **OpenAI free credits / Whisper free tier.** No standing free grant found. **UNVERIFIED / assume none.**
8. **GitHub Models.** Confirmed **retired 2026-07-30** — recorded here as a dead end, not a gap.
9. **NVIDIA NIM / free cloud ASR models (Parakeet, Canary).** The speech category was linked but no model list rendered → **UNVERIFIED.**
10. **Free cloud upscaler APIs.** None found. **UNVERIFIED — appears not to exist.**
11. **Cloudflare Workers AI neuron cost per audio-minute.** The model page quotes only "$0.000513 per audio minute," so the **DERIVED ≈214 free audio-minutes/day** figure depends on the global $0.011/1,000-neurons rate and is an arithmetic estimate, not a quoted quota.
12. **Devanagari font availability in `@remotion/google-fonts`** — not stated on the page. **UNVERIFIED.**
13. **Railway / Render free tier status** — not fetched. **UNVERIFIED.**
14. **RunPod and Vast.ai free credits** — absent from live pricing pages. **UNVERIFIED / apparently non-existent.**
15. **Pexels API rate limits** — documentation page returned **403**. **UNVERIFIED.**
16. **Internet Archive upload policy, file size limits, private items, commercial use** — multiple help URLs 404'd. **UNVERIFIED**, and unsuitable for commercial delivery regardless.
17. **Mixkit license for the SaaS case** (embedding music in videos a third party generates) — the public license text does not address it. **UNVERIFIED.**
18. **Hinglish / code-switching WER for any vendor.** **No vendor publishes it.** Hindi-only tiers exist (ElevenLabs ≤10% WER band), but Hinglish must be measured empirically on a golden set.
19. **AWS Free Tier per-service amounts** (750 h EC2, 5 GB S3, CloudFront GB) — the live page describes the *structure* ($100 credits + up to $100 more over 6 months, 30+ always-free services) but not the numbers. **UNVERIFIED.**
20. **Coverr / free AI b-roll generation with a real free tier** — not fetched. **UNVERIFIED.**
21. **Oracle idle-resource reclamation policy** — not stated on the current free page. **UNVERIFIED** (historically Oracle has reclaimed idle Always Free ARM instances; do not assume it won't).

---

## 5. Ranked TOP 10 — highest-impact free changes (impact × effort)

1. **Replace the dead moment-detection model — move to the Gemini free tier, with Groq `openai/gpt-oss-120b` as fallback.**
   *Rationale:* `llama-3.3-70b-versatile` was **shut down 08/16/26**; the pipeline is degraded or broken right now, and Gemini's free tier is free of charge for 2.5 Pro/Flash and 3.x Flash models. Highest urgency, zero cost.

2. **Move all MP4 delivery to Cloudflare R2 (10 GB free + free egress), with B2 as overflow.**
   *Rationale:* Egress is the thing that bankrupts video SaaS; R2's zero-egress + 10 GB free replaces the 15 GB Drive/rclone cap and makes delivery dramatically faster for Indian users.

3. **Adopt MediaPipe `FaceDetector` + `FaceLandmarker` (Apache 2.0) for speaker tracking and auto-reframe.**
   *Rationale:* The single biggest *quality* lever for vertical clips — no more centre-crop decapitations — and it is free, CPU-capable, and commercially unambiguous, unlike YOLO (AGPL) or InsightFace (non-commercial models).

4. **Use `@remotion/captions` `createTikTokStyleCaptions()` with `breakOnSilenceAfterMilliseconds`.**
   *Rationale:* Moves caption pagination from hand-rolled logic to a purpose-built, MIT-licensed API (v4.0.526) that also gives per-token `pageBreakAfter` for true word-by-word karaoke timing.

5. **Burn Modal's $30/month free GPU compute on Real-ESRGAN (BSD-3) + GFPGAN (Apache 2.0) enhancement passes.**
   *Rationale:* GPU-grade upscaling/face restoration is currently impossible on GitHub Actions CPU; $30/month of T4/L4/A100 time turns phone footage into publishable quality at zero cost.

6. **Add `@remotion/install-whisper-cpp` with `large-v3-turbo` + `tokenLevelTimestamps: true` as an unlimited local ASR path.**
   *Rationale:* Removes Groq's **25 MB free-tier upload cap** and the **8 h/day** ceiling entirely, and `t_dtw` timestamps are the most accurate available for caption sync.

7. **Route Hindi/Hinglish audio to Deepgram Nova-3 Multilingual, paid from the $200 no-expiry credit.**
   *Rationale:* Whisper-turbo is the weak link on code-switched Indian speech; $200 buys ~38,000 minutes at $0.0052/min, enough to A/B against Groq and pick per-language winners for free.

8. **Add Cloud Run Jobs as the >6-hour escape hatch and parallel ffmpeg fleet (240,000 vCPU-s + 450,000 GiB-s free per month).**
   *Rationale:* Directly removes the GitHub Actions **6 h/job** wall and gives horizontal encode parallelism — the runtime improvement the founder asked for — using a recurring monthly grant.

9. **Add Cloudflare Workers AI `@cf/openai/whisper-large-v3-turbo` and `glm-5.3`/`deepseek-v4-flash` as burst capacity.**
   *Rationale:* ~214 free audio-minutes/day (DERIVED) of ASR plus **1.3M-token** context for whole-transcript moment analysis, on infrastructure already in the stack and already free of egress cost.

10. **Wire `@remotion/google-fonts` `loadFont()` with a Devanagari font for Hindi captions, and pin `weights`/`subsets` before the v5.0 breaking change hits.**
    *Rationale:* Missing glyphs render as tofu boxes and instantly destroy the product's credibility with Indian creators; the fix is a few lines, and the v5.0 change makes `weights`/`subsets` mandatory (currently it throws if omitted).

**Honourable mentions (high impact, small effort):** raise the GitHub Actions runner from 2 vCPU/8 GB to 4 vCPU/16 GB by **making the repo public** (or budget for it) — the founder may be on half the machine he thinks; and **stop using CodeFormer / InsightFace / YOLO** if they are anywhere in the current codebase.
