# ClipMint API Gateway

Cloudflare Worker-based API gateway for ClipMint.

## Setup

```bash
npm install
npx wrangler login
npx wrangler deploy
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/jobs` | Submit a new video processing job |
| `GET` | `/api/v1/jobs` | List user's jobs |
| `GET` | `/api/v1/jobs/:id` | Get job status and details |
| `GET` | `/api/v1/jobs/:id/clips` | Get clips for a job |
| `GET` | `/api/v1/health` | Health check |

## Authentication

Include your API key in the `Authorization` header:

```
Authorization: Bearer cm_live_your_api_key_here
```

## Configuration

Non-secret values live in `wrangler.toml` (`[vars]`):

| Var | Value |
|-----|-------|
| `CORS_ORIGIN` | `https://clipmint.vikashbuilds.in` (production dashboard) |
| `RATE_LIMIT_PER_MINUTE` | `30` |

Secrets are set with `npx wrangler secret put <NAME>`:

| Secret | Value |
|--------|-------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase `service_role` key |
| `GITHUB_TOKEN` | Fine-grained PAT with `Actions: write` |
| `GITHUB_REPO` | `TeraBhaiHoon/ClipMint-NovaMint` |

`POST /api/v1/jobs` validates and normalises `video_url` (https only, known
video hosts or a direct media file) and clamps `max_clips` to the plan's
remaining clips before dispatching the pipeline.
