# 🎬 ClipMint — AI Content Repurposer

> Upload one long video → get 10+ platform-ready clips with professional animated captions.

## Architecture

```
13-ClipMint/
├── remotion-captions/       # Remotion subtitle rendering engine (9 styles)
│   ├── src/
│   │   ├── CaptionedClip.tsx   # Main composition with 9 caption styles
│   │   ├── Root.tsx            # Composition registrations
│   │   └── utils/
│   │       └── parseCaptions.ts  # SRT parser
│   └── public/
│       └── sample.srt          # Test SRT file
├── dashboard/               # Next.js 14 dashboard
│   ├── src/app/
│   │   ├── page.tsx            # Landing page (hero, pricing, styles)
│   │   ├── api/
│   │   │   └── trigger-pipeline/ # Server-side GitHub Actions dispatch
│   │   └── dashboard/
│   │       ├── layout.tsx      # Sidebar navigation
│   │       ├── page.tsx        # Jobs list
│   │       ├── new/page.tsx    # Upload form + pipeline trigger
│   │       ├── [jobId]/page.tsx # Job detail + clips
│   │       ├── analytics/      # Usage analytics
│   │       ├── api-keys/       # API key management
│   │       └── settings/       # User settings
│   └── src/lib/
│       ├── supabase.ts         # Supabase client
│       └── types.ts            # Shared TypeScript types
├── api-gateway/             # Cloudflare Worker API
│   ├── src/index.ts            # Main router (5 endpoints)
│   └── wrangler.toml           # Worker config
├── supabase/
│   ├── schema.sql              # Database schema (4 tables + RLS)
│   ├── migration_phase4.sql    # increment_videos_used RPC function
│   ├── migration_quota.sql     # Atomic quota counters + refund marker
│   └── migration_realtime.sql  # Realtime publication for jobs/clips
├── .github/workflows/
│   ├── process-video.yml       # Main pipeline (12 steps)
│   └── health-check.yml       # Daily cron health check
└── README.md
```

## Quick Start

### 1. Remotion Caption Engine
```bash
cd remotion-captions
npm install
npm start          # Opens Remotion Studio at localhost:3000
npm run build      # Renders a test clip to out/clip.mp4
```

### 2. Dashboard
```bash
cd dashboard
npm install
npm run dev        # Opens Next.js at localhost:3000
```

### 3. API Gateway
```bash
cd api-gateway
npm install
npx wrangler dev   # Local dev server
npx wrangler deploy # Deploy to Cloudflare
```

### 4. Database
1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Run `supabase/schema.sql` in the SQL Editor
3. Run `supabase/migration_phase4.sql` for the RPC function
4. Run `supabase/migration_quota.sql` (atomic quota counters) and `supabase/migration_realtime.sql` (Realtime publication — the dashboard needs it to live-update)
5. Add your Supabase URL and keys to `dashboard/.env.local`

## Caption Styles (9 Available)

| Style | Effect |
|-------|--------|
| **Hormozi** | Word-by-word green highlight with scale pop |
| **Bounce** | Spring physics bounce-in animation |
| **Fade** | Smooth fade in/out |
| **Glow** | Pulsing neon glow effect |
| **Typewriter** | Character-by-character typing with cursor |
| **Glitch** | RGB split glitch effect |
| **Neon** | Flickering neon sign with layered glow |
| **Colorful** | Rainbow-colored words with staggered entrance |
| **Minimal** | Frosted glass pill with subtle slide-up |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/jobs` | Submit a new video for processing |
| `GET` | `/api/v1/jobs` | List your jobs |
| `GET` | `/api/v1/jobs/:id` | Get job details |
| `GET` | `/api/v1/jobs/:id/clips` | Get clips for a job |
| `GET` | `/api/v1/health` | Health check |

## Tech Stack

- **Remotion** — React-based video rendering
- **Next.js 14** — Dashboard with Tailwind CSS
- **Cloudflare Workers** — API gateway
- **Supabase** — Auth + PostgreSQL database
- **GitHub Actions** — Video processing pipeline
- **Groq** — Whisper transcription + LLaMA 3.3 for AI analysis
- **Google Drive** — Video storage (via rclone)
- **FFmpeg** — Video processing

## Pricing (INR)

| Plan | Price | Clips/Month | Videos/Month |
|------|-------|-------------|--------------|
| Free | ₹0 | 5 | 1 |
| Creator | ₹499/mo | 50 | 5 |
| Pro | ₹1,499/mo | 200 | 20 |
| Agency | ₹4,999/mo | Unlimited | Unlimited |

## Pipeline notes (2026-09)

The processing workflow is stage-instrumented: every step records its name, so
a failure reports *which* stage broke instead of a generic message. See
`_audit/07-HANDOVER.md` for the failure playbook.

Three things are load-bearing and easy to break:-

* **All `@remotion/*` packages must be the same version.** A mismatch makes
  Remotion abort every render. They are pinned exactly in
  `remotion-captions/package.json` — bump them together or not at all.
* **Caption page grouping lives in `CaptionedClip.tsx`**, not in
  `createTikTokStyleCaptions`. That helper only breaks a page when a token
  starts with a space, which the transcription step strips.
* **Clip trimming happens in `pipeline/prepare_clips.py`**, not in Remotion.
  Trimming in the renderer shifts the picture while caption timestamps stay
  put, which desynchronises them.

A caption render that fails is reported as a failed clip. It is never replaced
with the raw uncaptioned clip — that fallback previously shipped caption-less
videos while reporting every job as successful.
