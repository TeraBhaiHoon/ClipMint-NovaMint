import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/server";
import { validateVideoUrl } from "@/lib/validateUrl";
import { r2Configured, r2PresignGet } from "@/lib/r2";
import { isPlanExpired } from "@/lib/cashfree";

/**
 * POST /api/trigger-pipeline
 *
 * Called by the dashboard after a job is inserted into Supabase.
 * Triggers the GitHub Actions workflow_dispatch to start processing.
 * This runs server-side so the GITHUB_TOKEN never reaches the browser.
 *
 * SECURITY: the request body only carries `job_id`. `video_url`,
 * `caption_style` and `max_clips` are always re-read from the stored job row —
 * the URL ends up in a shell command on the CI runner, so a client-supplied
 * value must never be trusted.
 */

type SupabaseLike = NonNullable<ReturnType<typeof createServiceClient>>;

const VALID_CAPTION_PACES = ["fast", "balanced", "slow"] as const;
type CaptionPace = (typeof VALID_CAPTION_PACES)[number];

/** Mark a job as failed with a user-facing message (best effort). */
async function failJob(supabase: SupabaseLike, jobId: string, message: string) {
    const { error } = await supabase
        .from("jobs")
        .update({ status: "failed", error_message: message })
        .eq("id", jobId);

    if (error) console.error("Could not mark job as failed:", error.message);
}

export async function POST(request: NextRequest) {
    const supabase = await createClient();

    // Verify user is authenticated
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const job_id = body?.job_id;

    if (!job_id || typeof job_id !== "string") {
        return NextResponse.json(
            { error: "job_id is required" },
            { status: 400 }
        );
    }

    // ── Two optional pipeline inputs (neither is security-sensitive — they do
    //    not reach a shell line, only typed workflow inputs) ──
    // `resume`: retry from the saved transcription checkpoint when one exists.
    const resumeRequested = body?.resume === true;
    // `caption_pace`: fast | balanced | slow (workflow defaults to balanced).
    const paceInput = typeof body?.caption_pace === "string" ? body.caption_pace : "balanced";
    const captionPace: CaptionPace = (VALID_CAPTION_PACES as readonly string[]).includes(paceInput)
        ? (paceInput as CaptionPace)
        : "balanced";

    // Verify the job belongs to this user and read the *stored* configuration.
    const { data: job, error: jobError } = await supabase
        .from("jobs")
        .select("id, user_id, video_url, caption_style, max_clips, status, bgm_mood, custom_bgm_url, job_mode, remove_silences, auto_punch_in, video_storage_path")
        .eq("id", job_id)
        .eq("user_id", user.id)
        .single();

    if (jobError || !job) {
        return NextResponse.json(
            { error: "Job not found or not authorized" },
            { status: 404 }
        );
    }

    // Service-role client for quota reads/writes. Falls back to the RLS-scoped
    // session client (which can read the caller's own profile) if the key is
    // not configured, so the route keeps working in local dev.
    const admin = createServiceClient();
    if (!admin) {
        console.warn("SUPABASE_SERVICE_ROLE_KEY not set — using session client for quota checks");
    }
    const quotaClient = admin ?? supabase;

    // ── Resolve the source URL ──
    // Uploaded sources live in the PRIVATE video-uploads bucket; the stored
    // video_url is just a signed URL that expires, so a fresh one is minted
    // here on every dispatch (including retries days later).
    let sourceUrl = job.video_url;
    if (job.video_storage_path) {
        // Uploaded sources live in the R2 cache under sources/ (evicted after
        // 7 days; deleted right after a successful job). A fresh presigned URL
        // is minted on EVERY dispatch, so a retry days later still works.
        if (!r2Configured()) {
            const message = "Video uploads are not configured yet. Please contact support.";
            await failJob(quotaClient, job.id, message);
            return NextResponse.json({ error: message }, { status: 503 });
        }
        const signed = await r2PresignGet(job.video_storage_path, 60 * 60 * 24);
        if (!signed) {
            const message = "Your uploaded video could not be read. Please upload it again.";
            await failJob(quotaClient, job.id, message);
            return NextResponse.json({ error: message }, { status: 400 });
        }
        sourceUrl = signed;
    }

    // ── Validate the source URL (defence in depth: it is interpolated into a
    //    shell command by the workflow) ──
    const validation = validateVideoUrl(sourceUrl);
    if (!validation.ok) {
        await failJob(quotaClient, job.id, validation.reason);
        return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    // ── Quota checks (server-side; the browser check is UX only) ──
    const { data: profile, error: profileError } = await quotaClient
        .from("profiles")
        .select("clips_used, clips_limit, videos_used, videos_limit, plan, plan_expires_at")
        .eq("id", job.user_id)
        .single();

    if (profileError || !profile) {
        console.error("Could not read profile for quota check:", profileError?.message);
        return NextResponse.json(
            { error: "Could not verify your plan limits. Please try again." },
            { status: 500 }
        );
    }

    // The dashboard reserves a video slot (increment_videos_used) *before* it
    // creates the job, so videos_used already includes this job. Only a value
    // above the limit means someone slipped past the reservation RPC.
    if (profile.videos_used > profile.videos_limit) {
        const message = `You've reached your limit of ${profile.videos_limit} video(s). Please upgrade.`;
        await failJob(quotaClient, job.id, message);
        return NextResponse.json({ error: message }, { status: 402 });
    }

    // One-time plans expire: an expired paid plan is gated at Free limits server-side.
    const expired = isPlanExpired(profile);
    const effectiveClipsLimit = expired ? 5 : (profile.clips_limit ?? 0);

    const remainingClips = Math.max(0, effectiveClipsLimit - (profile.clips_used ?? 0));
    if (remainingClips < 1) {
        const message = "You've run out of clips. Please upgrade your plan to keep creating.";
        await failJob(quotaClient, job.id, message);
        return NextResponse.json({ error: message }, { status: 402 });
    }

    // Clamp server-side: the client may ask for more clips than it has left.
    const requestedClips = Number(job.max_clips) || 10;
    const effectiveMaxClips = Math.min(Math.max(requestedClips, 1), remainingClips);

    // Trigger GitHub Actions workflow
    const githubToken = process.env.GITHUB_TOKEN;
    const githubRepo = process.env.GITHUB_REPO;

    if (!githubToken || !githubRepo) {
        console.warn("GITHUB_TOKEN or GITHUB_REPO not set — pipeline not triggered");

        const missing = [];
        if (!githubToken) missing.push("GITHUB_TOKEN");
        if (!githubRepo) missing.push("GITHUB_REPO");

        await failJob(
            quotaClient,
            job.id,
            "Processing service is temporarily unavailable. Please try again later."
        );

        return NextResponse.json({
            triggered: false,
            error: "Processing service is temporarily unavailable.",
        }, { status: 500 });
    }

    const dispatchUrl = `https://api.github.com/repos/${githubRepo}/actions/workflows/process-video.yml/dispatches`;

    try {
        const dispatchRes = await fetch(dispatchUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${githubToken}`,
                Accept: "application/vnd.github.v3+json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                ref: "main",
                inputs: {
                    job_id: job.id,
                    video_url: validation.url,
                    caption_style: job.caption_style || "hormozi",
                    max_clips: String(effectiveMaxClips),
                    caption_pace: captionPace,
                    resume_from_checkpoint: resumeRequested ? "true" : "false",
                    bgm_mood: job.bgm_mood || "auto",
                    custom_bgm_url: job.custom_bgm_url || "",
                    job_mode: job.job_mode === "captions" ? "captions" : "clips",
                    remove_silences: job.remove_silences ? "true" : "false",
                    auto_punch_in: job.auto_punch_in ? "true" : "false",
                },
            }),
        });

        if (!dispatchRes.ok) {
            const errText = await dispatchRes.text();
            console.error("GitHub dispatch failed:", `GitHub API ${dispatchRes.status}: ${errText.slice(0, 500)}`, "URL:", dispatchUrl);

            await failJob(
                quotaClient,
                job.id,
                "Could not start video processing. Please try again."
            );

            return NextResponse.json(
                { error: "Could not start video processing. Please try again." },
                { status: 500 }
            );
        }

        return NextResponse.json({
            triggered: true,
            job_id: job.id,
            max_clips: effectiveMaxClips,
        });
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("Pipeline trigger error:", errMsg);

        await failJob(
            quotaClient,
            job.id,
            "An unexpected error occurred. Please try again."
        );

        return NextResponse.json(
            { error: "An unexpected error occurred. Please try again." },
            { status: 500 }
        );
    }
}
