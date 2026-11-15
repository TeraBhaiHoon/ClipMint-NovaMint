import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/server";
import { validateVideoUrl } from "@/lib/validateUrl";

/**
 * POST /api/jobs
 *
 * Unified quota reservation + job creation. The browser never touches the
 * jobs table and never calls a quota RPC directly: it posts a plain row
 * payload (NO user_id / status / progress — the server derives those), and
 * this route performs the reservation and the insert as ONE database
 * transaction via the service-only RPC `create_job_with_quota`
 * (supabase/migration_quota_v2.sql):
 *
 *   - lazy usage-window roll,
 *   - expiry-aware effective plan limits,
 *   - atomic video-slot charge (videos_used + 1) under a row lock,
 *   - atomic reserved clip budget (profiles.clips_reserved) so concurrent
 *     submissions can never overspend the plan,
 *   - job INSERT with quota_state='pending', clips_budget and the window
 *     snapshot used later for settlement.
 *
 * Idempotency: `request_id` (client-generated UUID persisted with the
 * submission) is REQUIRED. A network drop after the reservation succeeded is
 * retried with the same id and returns the ORIGINAL job — never a second
 * reservation. Invalid provided selectors (languages, pace) are rejected with
 * 400 — the server never silently substitutes a different language.
 *
 * Fail-closed: any RPC failure returns 5xx and NO job exists — there is no
 * path that creates a job without a settled reservation or vice versa.
 *
 * Response: 201 { job: { id, status, max_clips, quota_state, ... } }
 *   400 invalid payload · 401 unauthenticated · 402 quota exhausted
 *   503 quota service unavailable (fail-closed)
 */

const CAPTION_STYLES = ["hormozi", "bounce", "fade", "glow", "typewriter", "glitch", "neon", "colorful", "minimal"] as const;
const SOURCE_TYPES = ["url", "upload", "drive"] as const;
const JOB_MODES = ["clips", "captions"] as const;
const CAPTION_PACES = ["fast", "balanced", "slow"] as const;
const SOURCE_LANGUAGES = ["auto", "hi", "en"] as const;
const CAPTION_LANGUAGES = ["original", "hinglish", "en"] as const;
const BGM_MOODS = ["energetic", "calm", "corporate", "inspiring", "auto", "none"] as const;

// The presign route scopes keys to sources/{userId}/{timestamp}.{ext}; a
// payload may only reference a path inside the caller's own folder.
const STORAGE_KEY_PATTERN = /^sources\/([0-9a-f-]{36})\/\d+\.(mp4|mov|m4v|webm)$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reject if the field is present but invalid; fall back only when absent. */
function strictEnum<T extends readonly string[]>(
    value: unknown,
    allowed: T,
    fallback: T[number],
    label: string,
    errors: string[]
): T[number] {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
        return value as T[number];
    }
    errors.push(`${label} must be one of: ${allowed.join(", ")}`);
    return fallback;
}

function strictBool(value: unknown, label: string, errors: string[]): boolean | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "boolean") return value;
    errors.push(`${label} must be true or false`);
    return undefined;
}

export async function POST(request: NextRequest) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const errors: string[] = [];

    // Submission id is REQUIRED (frontend sends request_id = crypto.randomUUID
    // captured once per new-video instance, preserved across network retries).
    // Same request_id + same payload replays the original job; same request_id
    // + different payload is refused (server-side payload fingerprint).
    const requestId = typeof body.request_id === "string" ? body.request_id : "";
    if (!UUID_PATTERN.test(requestId)) {
        return NextResponse.json(
            { error: "request_id (a stable UUID for this submission) is required." },
            { status: 400 }
        );
    }

    const sourceType = strictEnum(body.source_type, SOURCE_TYPES, "url", "source_type", errors);
    const jobMode = strictEnum(body.job_mode, JOB_MODES, "clips", "job_mode", errors);
    const captionStyle = strictEnum(body.caption_style, CAPTION_STYLES, "hormozi", "caption_style", errors);
    const captionPace = strictEnum(body.caption_pace, CAPTION_PACES, "balanced", "caption_pace", errors);
    const sourceLanguage = strictEnum(body.source_language, SOURCE_LANGUAGES, "auto", "source_language", errors);
    const captionLanguage = strictEnum(body.caption_language, CAPTION_LANGUAGES, "original", "caption_language", errors);

    // bgm_mood: absent → auto; provided → must be valid (strict).
    let bgmMood = "auto";
    if (body.bgm_mood !== undefined && body.bgm_mood !== null) {
        if (typeof body.bgm_mood !== "string" ||
            !(BGM_MOODS as readonly string[]).includes(body.bgm_mood)) {
            errors.push("bgm_mood must be one of: " + BGM_MOODS.join(", "));
        } else {
            bgmMood = body.bgm_mood;
        }
    }

    // Strict numbers: integers only — arrays, NaN and numeric strings rejected.
    let maxClips = 10;
    if (body.max_clips !== undefined && body.max_clips !== null) {
        if (!Number.isInteger(body.max_clips) || body.max_clips < 1 || body.max_clips > 20) {
            errors.push("max_clips must be an integer between 1 and 20");
        } else {
            maxClips = body.max_clips;
        }
    }
    const requestedClips = jobMode === "captions" ? 1 : maxClips;

    const removeSilences = strictBool(body.remove_silences, "remove_silences", errors);
    const autoPunchIn = strictBool(body.auto_punch_in, "auto_punch_in", errors);

    let videoUrl: string | null = null;
    let videoStoragePath: string | null = null;
    let videoFilename: string | null = null;
    if (body.video_filename !== undefined && body.video_filename !== null) {
        if (typeof body.video_filename !== "string" || !body.video_filename.trim()) {
            errors.push("video_filename must be a non-empty string");
        } else {
            videoFilename = body.video_filename.trim().slice(0, 300);
        }
    }

    if (sourceType === "upload") {
        const key = typeof body.video_storage_path === "string" ? body.video_storage_path : "";
        const match = STORAGE_KEY_PATTERN.exec(key);
        if (!match || match[1] !== user.id) {
            errors.push("Upload reference is missing or does not belong to your account.");
        } else {
            videoStoragePath = key;
        }
    } else {
        const validation = validateVideoUrl(body.video_url);
        if (!validation.ok) {
            errors.push(validation.reason);
        } else {
            videoUrl = validation.url ?? null;
        }
    }

    // Custom BGM: ONLY the caller's own uploaded track in the bgm-uploads
    // bucket (public object URL of this user's folder). Arbitrary https URLs
    // are refused — the pipeline would fetch them from the CI runner (SSRF
    // surface), so the host is pinned to this deployment's Supabase storage.
    let customBgmUrl: string | null = null;
    if (body.custom_bgm_url !== undefined && body.custom_bgm_url !== null) {
        if (typeof body.custom_bgm_url !== "string" || !body.custom_bgm_url.trim()) {
            errors.push("custom_bgm_url must be a string when provided");
        } else {
            const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
                ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
                : "";
            try {
                const parsed = new URL(body.custom_bgm_url.trim());
                const expectedPrefix = `/storage/v1/object/public/bgm-uploads/${user.id}/`;
                if (parsed.protocol !== "https:"
                    || (supabaseHost && parsed.host !== supabaseHost)
                    || !parsed.pathname.startsWith(expectedPrefix)) {
                    errors.push("Use a track you uploaded on this page (your own music library URL).");
                } else if (parsed.pathname.length <= expectedPrefix.length) {
                    errors.push("The music track path is incomplete.");
                } else {
                    customBgmUrl = parsed.toString();
                }
            } catch {
                errors.push("custom_bgm_url is not a valid URL");
            }
        }
    }

    if (errors.length) {
        return NextResponse.json({ error: errors[0], details: errors }, { status: 400 });
    }

    const admin = createServiceClient();
    if (!admin) {
        // Fail closed: without the service key there is no atomic reservation.
        console.error("[jobs] SUPABASE_SERVICE_ROLE_KEY is not configured");
        return NextResponse.json(
            { error: "Could not start your video right now. Please try again shortly." },
            { status: 503 }
        );
    }

    // Atomic reservation + insert. Every other error is fail-closed 503; only
    // the quota refusals map to 402 with their user-facing messages.
    const { data: jobId, error } = await admin.rpc("create_job_with_quota", {
        p_user_id: user.id,
        p_job: {
            video_url: videoUrl,
            video_filename: videoFilename,
            video_storage_path: videoStoragePath,
            source_type: sourceType,
            caption_style: captionStyle,
            caption_pace: captionPace,
            source_language: sourceLanguage,
            caption_language: captionLanguage,
            max_clips: requestedClips,
            job_mode: jobMode,
            // Jump-cuts only apply to the mode that uses them; the pipeline
            // treats captions-mode flags independently.
            remove_silences: jobMode === "captions" && removeSilences === true,
            auto_punch_in: jobMode === "captions" && autoPunchIn === true,
            bgm_mood: bgmMood,
            custom_bgm_url: customBgmUrl,
        },
        p_creation_request_id: requestId,
    });

    if (error || !jobId) {
        const message = error?.message ?? "unknown error";
        console.error("[jobs] create_job_with_quota failed:", message);
        if (message.startsWith("QUOTA_VIDEOS_LIMIT") || message.startsWith("QUOTA_CLIPS_LIMIT")) {
            return NextResponse.json(
                { error: message.split(": ").slice(1).join(": ") || "Plan limit reached." },
                { status: 402 }
            );
        }
        if (message.startsWith("REQUEST_ID_PAYLOAD_MISMATCH")) {
            return NextResponse.json(
                { error: "This submission id was already used with different settings. Refresh the page and start a new submission." },
                { status: 409 }
            );
        }
        return NextResponse.json(
            { error: "Could not start your video right now. Please try again shortly." },
            { status: 503 }
        );
    }

    // Re-read the created row for the response (also proves the insert). If
    // the readback fails the job STILL exists with its reservation — return
    // the id so the client never retries into a second creation.
    const { data: job, error: readError } = await admin
        .from("jobs")
        .select("id,status,max_clips,quota_state,clips_budget,usage_window_start")
        .eq("id", jobId)
        .single();

    if (readError || !job) {
        console.error("[jobs] job created but readback failed:", readError?.message);
        return NextResponse.json(
            { job: { id: jobId, status: "queued", quota_state: "pending" } },
            { status: 201 }
        );
    }

    return NextResponse.json({ job }, { status: 201 });
}
