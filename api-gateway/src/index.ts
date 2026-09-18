/**
 * ClipMint API Gateway — Cloudflare Worker
 *
 * Routes:
 *   POST /api/v1/jobs         — Submit a new video processing job
 *   GET  /api/v1/jobs         — List user's jobs
 *   GET  /api/v1/jobs/:id     — Get job details
 *   GET  /api/v1/jobs/:id/clips — Get clips for a job
 *   GET  /api/v1/health       — Health check
 *
 * NOTE: the URL validator below is a self-contained copy of
 * `dashboard/src/lib/validateUrl.ts` — a Worker cannot import from the Next.js
 * tree, so the rules are duplicated on purpose. Keep both in sync.
 */

export interface Env {
    SUPABASE_URL: string;
    SUPABASE_SERVICE_KEY: string;
    GITHUB_TOKEN: string;
    GITHUB_REPO: string;
    CORS_ORIGIN: string;
    RATE_LIMIT_PER_MINUTE: string;
    CACHE: KVNamespace;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface ApiUser {
    id: string;
    plan: string;
    videos_used: number;
    videos_limit: number;
    clips_used: number;
    clips_limit: number;
}

interface ApiKeyRow {
    id: string;
    user_id: string;
    requests_today: number | null;
}

interface CreateJobBody {
    video_url: string;
    caption_style?: string;
    max_clips?: number;
    source_type?: string;
}

// ─── Video URL validation / normalisation (mirror of lib/validateUrl.ts) ────

type VideoProvider = "youtube" | "instagram" | "facebook" | "drive" | "vimeo" | "direct";

interface UrlValidationResult {
    ok: boolean;
    url?: string;
    provider?: VideoProvider;
    reason?: string;
}

const MAX_URL_LENGTH = 2048;

const PROVIDER_HOSTS: Record<string, VideoProvider> = {
    "youtube.com": "youtube",
    "www.youtube.com": "youtube",
    "m.youtube.com": "youtube",
    "music.youtube.com": "youtube",
    "youtu.be": "youtube",
    "instagram.com": "instagram",
    "www.instagram.com": "instagram",
    "facebook.com": "facebook",
    "www.facebook.com": "facebook",
    "m.facebook.com": "facebook",
    "fb.watch": "facebook",
    "drive.google.com": "drive",
    "vimeo.com": "vimeo",
};

const DIRECT_MEDIA_EXTENSIONS = /\.(mp4|mov|m4v|webm)$/;

/**
 * Characters rejected outright. Deliberately NARROW — an earlier version also
 * banned `& ; | > < ( ) ' "`, which rejected ordinary links like
 * `youtube.com/watch?v=ID&list=…`. Those are only dangerous when a value is
 * pasted into a shell command, and the pipeline now passes the URL through the
 * environment rather than interpolating it into a script. What remains is the
 * set that is never legitimate in a URL (whitespace, control characters) plus
 * backtick, `$` and `\`, which could break out of a quoted string.
 */
const SHELL_UNSAFE = /[`$\\\s\u0000-\u001f]/;

const TRACKING_PARAMS = new Set(["si", "fbclid", "igshid", "igsh", "feature", "ref", "ref_src", "_r"]);
const KEEP_PARAMS = new Set(["v", "list", "start", "id"]);

/** Strip tracking params while preserving functional ones (`v`, `list`, `start`, `id`). */
function normalizeVideoUrl(raw: string): string {
    const trimmed = raw.trim();
    try {
        const parsed = new URL(trimmed);
        const isYouTube = PROVIDER_HOSTS[parsed.hostname.toLowerCase()] === "youtube";

        for (const key of Array.from(parsed.searchParams.keys())) {
            const lower = key.toLowerCase();
            if (KEEP_PARAMS.has(lower)) continue;
            if (TRACKING_PARAMS.has(lower) || lower.startsWith("utm_") || (isYouTube && lower === "t")) {
                parsed.searchParams.delete(key);
            }
        }

        return parsed.toString();
    } catch {
        return trimmed;
    }
}

/** https-only (including direct media files). Returns the normalised URL. */
function validateVideoUrl(raw: unknown): UrlValidationResult {
    if (typeof raw !== "string" || !raw.trim()) {
        return { ok: false, reason: "Please paste a video URL." };
    }

    const trimmed = raw.trim();

    if (trimmed.length > MAX_URL_LENGTH) {
        return { ok: false, reason: `That URL is too long (max ${MAX_URL_LENGTH} characters).` };
    }

    if (SHELL_UNSAFE.test(trimmed)) {
        return {
            ok: false,
            reason: "That URL contains an unsupported character. Copy the link straight from your browser and paste it again.",
        };
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { ok: false, reason: "That doesn't look like a link. Paste the full video URL starting with https://" };
    }

    if (parsed.protocol !== "https:") {
        return { ok: false, reason: "Only https:// links are supported." };
    }

    const host = parsed.hostname.toLowerCase();
    let provider = PROVIDER_HOSTS[host];

    if (!provider && DIRECT_MEDIA_EXTENSIONS.test(parsed.pathname.toLowerCase())) {
        provider = "direct";
    }

    if (!provider) {
        return {
            ok: false,
            reason:
                "That link isn't a supported video source. Paste a YouTube, Instagram, Facebook, Vimeo or Google Drive link, or a direct .mp4/.mov/.m4v/.webm file URL.",
        };
    }

    return { ok: true, url: normalizeVideoUrl(trimmed), provider };
}

// ─── Body limit ──────────────────────────────────────────────────────────────

// Backlog 6.4: every accepted body is JSON a few hundred bytes long (video_url,
// caption_style, max_clips). Reject oversized bodies BEFORE reading/parsing so
// a large payload can never consume Worker CPU or memory — the 100 MB Worker
// request limit would otherwise allow abuse through this free endpoint.
const MAX_BODY_BYTES = 10240;

function bodyTooLarge(request: Request, env: Env): Response | null {
    const contentLength = request.headers.get("content-length");
    if (!contentLength) return null;
    const bytes = parseInt(contentLength, 10);
    if (Number.isNaN(bytes) || bytes <= MAX_BODY_BYTES) return null;
    return errorResponse(
        `Request body too large (max ${MAX_BODY_BYTES} bytes).`,
        413,
        env
    );
}

// ─── CORS Headers ────────────────────────────────────────────────────────────

function corsHeaders(origin: string): HeadersInit {
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
    };
}

function jsonResponse(data: unknown, status = 200, env?: Env): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...corsHeaders(env?.CORS_ORIGIN || "*"),
        },
    });
}

function errorResponse(message: string, status: number, env?: Env): Response {
    return jsonResponse({ error: message }, status, env);
}

// ─── Supabase helpers ────────────────────────────────────────────────────────

interface RpcResult {
    ok: boolean;
    data: unknown;
}

async function callRpc(env: Env, fn: string, params: Record<string, unknown>): Promise<RpcResult | null> {
    try {
        const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
            method: "POST",
            headers: {
                apikey: env.SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(params),
        });

        if (!res.ok) {
            const detail = (await res.text()).slice(0, 300);
            console.error(`RPC ${fn} failed: ${res.status} ${detail}`);
            return null;
        }

        const text = await res.text();
        return { ok: true, data: text ? JSON.parse(text) : null };
    } catch (err) {
        console.error(`RPC ${fn} threw:`, err instanceof Error ? err.message : String(err));
        return null;
    }
}

/**
 * Reserve one video slot atomically (supabase/migration_quota.sql).
 * Returns true (reserved), false (limit reached) or null (RPC unavailable —
 * caller fails open so the API keeps working if the migration is not applied).
 */
async function reserveVideoSlot(env: Env, userId: string): Promise<boolean | null> {
    const result = await callRpc(env, "increment_videos_used", { p_user_id: userId });
    if (!result) return null;
    return result.data === true;
}

async function refundVideoSlot(env: Env, userId: string): Promise<void> {
    await callRpc(env, "refund_videos_used", { p_user_id: userId });
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────

/**
 * Update `api_keys.last_used_at` / `requests_today` without blocking the
 * response. NOTE: `api_keys` has no date column, so `requests_today` can only be
 * incremented here — it is never reset at midnight. A true daily reset would
 * need a `requests_date` column (out of scope for this fix).
 */
function recordKeyUsage(
    env: Env,
    keyId: string,
    requestsToday: number | null,
    ctx?: ExecutionContext
): void {
    const task = (async () => {
        try {
            await fetch(`${env.SUPABASE_URL}/rest/v1/api_keys?id=eq.${keyId}`, {
                method: "PATCH",
                headers: {
                    apikey: env.SUPABASE_SERVICE_KEY,
                    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                    "Content-Type": "application/json",
                    Prefer: "return=minimal",
                },
                body: JSON.stringify({
                    last_used_at: new Date().toISOString(),
                    requests_today: (requestsToday || 0) + 1,
                }),
            });
        } catch (err) {
            console.error("Failed to record API key usage:", err instanceof Error ? err.message : String(err));
        }
    })();

    if (ctx) ctx.waitUntil(task);
    else void task;
}

async function authenticateRequest(
    request: Request,
    env: Env,
    ctx?: ExecutionContext
): Promise<ApiUser | null> {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;

    const apiKey = authHeader.slice(7);
    if (!apiKey || apiKey.length < 10) return null;

    // Hash the API key to look up in database
    const keyBuffer = new TextEncoder().encode(apiKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", keyBuffer);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    // Check Supabase for the key
    const keyRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/api_keys?key_hash=eq.${hashHex}&is_active=eq.true&select=id,user_id,requests_today`,
        {
            headers: {
                apikey: env.SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            },
        }
    );

    const keys = (await keyRes.json()) as ApiKeyRow[];
    if (!keys.length) return null;

    // Authenticated — record usage (non-blocking).
    recordKeyUsage(env, keys[0].id, keys[0].requests_today, ctx);

    // Get user profile
    const profileRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${keys[0].user_id}&select=id,plan,videos_used,videos_limit,clips_used,clips_limit`,
        {
            headers: {
                apikey: env.SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            },
        }
    );

    const profiles = (await profileRes.json()) as ApiUser[];
    return profiles[0] || null;
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

async function checkRateLimit(
    userId: string,
    env: Env
): Promise<boolean> {
    const key = `rate:${userId}:${Math.floor(Date.now() / 60000)}`;
    const current = parseInt((await env.CACHE.get(key)) || "0");
    const limit = parseInt(env.RATE_LIMIT_PER_MINUTE) || 30;

    if (current >= limit) return false;

    await env.CACHE.put(key, String(current + 1), { expirationTtl: 120 });
    return true;
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

async function handleCreateJob(
    request: Request,
    user: ApiUser,
    env: Env
): Promise<Response> {
    const body = (await request.json()) as CreateJobBody;

    // ── Validate + normalise the URL (it is interpolated into a shell command
    //    by the workflow, so this is the security boundary) ──
    const validation = validateVideoUrl(body.video_url);
    if (!validation.ok) {
        return errorResponse(validation.reason || "Invalid video_url", 400, env);
    }

    // ── Quota ──
    if (user.videos_used >= user.videos_limit) {
        return errorResponse(
            `Video limit reached (${user.videos_used}/${user.videos_limit}). Upgrade your plan.`,
            429,
            env
        );
    }

    const remainingClips = Math.max(0, (user.clips_limit ?? 0) - (user.clips_used ?? 0));
    if (remainingClips < 1) {
        return errorResponse(
            `Clip limit reached (${user.clips_used}/${user.clips_limit}). Upgrade your plan.`,
            429,
            env
        );
    }

    const VALID_STYLES = [
        "hormozi", "bounce", "fade", "glow", "typewriter",
        "glitch", "neon", "colorful", "minimal",
    ];
    const captionStyle = body.caption_style || "hormozi";
    if (!VALID_STYLES.includes(captionStyle)) {
        return errorResponse(`Invalid caption_style. Must be one of: ${VALID_STYLES.join(", ")}`, 400, env);
    }

    // Clamp server-side to the plan's remaining clips.
    const maxClips = Math.min(Math.max(body.max_clips || 10, 1), 20, remainingClips);

    // Reserve the video slot *before* creating/dispatching the job so a
    // concurrent submission cannot slip past the limit.
    const reserved = await reserveVideoSlot(env, user.id);
    if (reserved === false) {
        return errorResponse(
            `Video limit reached (${user.videos_used}/${user.videos_limit}). Upgrade your plan.`,
            429,
            env
        );
    }
    const slotReserved = reserved === true;

    // Create job in Supabase
    const jobRes = await fetch(`${env.SUPABASE_URL}/rest/v1/jobs`, {
        method: "POST",
        headers: {
            apikey: env.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
        },
        body: JSON.stringify({
            user_id: user.id,
            video_url: validation.url,
            caption_style: captionStyle,
            max_clips: maxClips,
            source_type: body.source_type || "url",
            status: "queued",
        }),
    });

    const jobs = (await jobRes.json()) as Array<{ id: string }>;
    if (!jobs.length) {
        if (slotReserved) await refundVideoSlot(env, user.id);
        return errorResponse("Failed to create job", 500, env);
    }

    const jobId = jobs[0].id;

    // Trigger GitHub Actions workflow
    const dispatchUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/process-video.yml/dispatches`;
    try {
        const dispatchRes = await fetch(dispatchUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${env.GITHUB_TOKEN}`,
                Accept: "application/vnd.github.v3+json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                ref: "main",
                inputs: {
                    job_id: jobId,
                    video_url: validation.url,
                    caption_style: captionStyle,
                    max_clips: String(maxClips),
                },
            }),
        });

        // Check if GitHub accepted the dispatch (204 = success, no body)
        if (!dispatchRes.ok) {
            const errText = await dispatchRes.text();
            const errDetail = `GitHub API ${dispatchRes.status}: ${errText.slice(0, 300)}`;
            console.error("GitHub dispatch failed:", errDetail, "URL:", dispatchUrl);

            await fetch(
                `${env.SUPABASE_URL}/rest/v1/jobs?id=eq.${jobId}`,
                {
                    method: "PATCH",
                    headers: {
                        apikey: env.SUPABASE_SERVICE_KEY,
                        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                        "Content-Type": "application/json",
                        Prefer: "return=minimal",
                    },
                    body: JSON.stringify({
                        status: "failed",
                        error_message: errDetail,
                    }),
                }
            );
            // No pipeline run means no webhook, so refund the reserved slot here.
            if (slotReserved) await refundVideoSlot(env, user.id);
            return errorResponse(errDetail, 500, env);
        }
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("GitHub dispatch exception:", errMsg);

        // Update job status to failed if trigger throws
        await fetch(
            `${env.SUPABASE_URL}/rest/v1/jobs?id=eq.${jobId}`,
            {
                method: "PATCH",
                headers: {
                    apikey: env.SUPABASE_SERVICE_KEY,
                    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                    "Content-Type": "application/json",
                    Prefer: "return=minimal",
                },
                body: JSON.stringify({
                    status: "failed",
                    error_message: `Pipeline trigger failed: ${errMsg}`,
                }),
            }
        );
        if (slotReserved) await refundVideoSlot(env, user.id);
        return errorResponse(`Pipeline trigger failed: ${errMsg}`, 500, env);
    }

    return jsonResponse(
        {
            id: jobId,
            status: "queued",
            message: "Video processing started. You'll be notified when done.",
        },
        201,
        env
    );
}

async function handleListJobs(
    user: ApiUser,
    url: URL,
    env: Env
): Promise<Response> {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0");
    const status = url.searchParams.get("status");

    let query = `${env.SUPABASE_URL}/rest/v1/jobs?user_id=eq.${user.id}&order=created_at.desc&limit=${limit}&offset=${offset}`;
    query += "&select=id,video_url,caption_style,status,progress,clips_count,created_at,completed_at";

    if (status) {
        query += `&status=eq.${status}`;
    }

    const res = await fetch(query, {
        headers: {
            apikey: env.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
    });

    const jobs = await res.json();
    return jsonResponse({ jobs, limit, offset }, 200, env);
}

async function handleGetJob(
    user: ApiUser,
    jobId: string,
    env: Env
): Promise<Response> {
    const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/jobs?id=eq.${jobId}&user_id=eq.${user.id}`,
        {
            headers: {
                apikey: env.SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            },
        }
    );

    const jobs = (await res.json()) as unknown[];
    if (!jobs.length) {
        return errorResponse("Job not found", 404, env);
    }

    return jsonResponse(jobs[0], 200, env);
}

async function handleGetClips(
    user: ApiUser,
    jobId: string,
    env: Env
): Promise<Response> {
    // Verify job belongs to user
    const jobRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/jobs?id=eq.${jobId}&user_id=eq.${user.id}&select=id`,
        {
            headers: {
                apikey: env.SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            },
        }
    );

    const jobs = (await jobRes.json()) as unknown[];
    if (!jobs.length) {
        return errorResponse("Job not found", 404, env);
    }

    const clipsRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/clips?job_id=eq.${jobId}&order=clip_index.asc`,
        {
            headers: {
                apikey: env.SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            },
        }
    );

    const clips = await clipsRes.json();
    return jsonResponse({ clips }, 200, env);
}

// ─── Main Router ─────────────────────────────────────────────────────────────

export default {
    async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: corsHeaders(env.CORS_ORIGIN),
            });
        }

        // Reject oversized bodies before any route/auth work reads them.
        const oversized = bodyTooLarge(request, env);
        if (oversized) return oversized;

        const url = new URL(request.url);
        const path = url.pathname;

        // Health check (no auth required)
        if (path === "/api/v1/health") {
            return jsonResponse(
                {
                    status: "ok",
                    service: "ClipMint API",
                    version: "1.0.0",
                    timestamp: new Date().toISOString(),
                },
                200,
                env
            );
        }

        // All other routes require auth
        const user = await authenticateRequest(request, env, ctx);
        if (!user) {
            return errorResponse(
                "Unauthorized. Provide a valid API key via Authorization: Bearer <key>",
                401,
                env
            );
        }

        // Rate limit check
        const withinLimit = await checkRateLimit(user.id, env);
        if (!withinLimit) {
            return errorResponse(
                "Rate limit exceeded. Please try again in a minute.",
                429,
                env
            );
        }

        // Route matching
        const jobIdMatch = path.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)$/);
        const clipsMatch = path.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)\/clips$/);

        // POST /api/v1/jobs — Create job
        if (path === "/api/v1/jobs" && request.method === "POST") {
            return handleCreateJob(request, user, env);
        }

        // GET /api/v1/jobs — List jobs
        if (path === "/api/v1/jobs" && request.method === "GET") {
            return handleListJobs(user, url, env);
        }

        // GET /api/v1/jobs/:id/clips — Get clips
        if (clipsMatch && request.method === "GET") {
            return handleGetClips(user, clipsMatch[1], env);
        }

        // GET /api/v1/jobs/:id — Get job
        if (jobIdMatch && request.method === "GET") {
            return handleGetJob(user, jobIdMatch[1], env);
        }

        return errorResponse("Not found", 404, env);
    },
};
