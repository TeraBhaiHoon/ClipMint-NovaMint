import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/server";
import { validateVideoUrl } from "@/lib/validateUrl";
import { r2Configured, r2PresignGet } from "@/lib/r2";

/**
 * POST /api/trigger-pipeline
 *
 * Dispatches (or re-dispatches) a job to the GitHub Actions pipeline. The
 * browser never PATCHes the jobs table (INSERT/UPDATE on jobs is revoked from
 * authenticated) — this route owns every dispatch mutation.
 *
 * ALL dispatch state decisions happen in ONE atomic transaction via the
 * service RPC `claim_job_dispatch` (supabase/migration_quota_v2.sql, unified
 * profile→job lock order):
 *
 *   queued + dispatch_count=0   → claim (first dispatch; existing hold stands)
 *   running + dispatch_count>0  → refused ("already started"; the in-flight
 *                                 run's hold is never touched)
 *   failed / cancelled          → re-reserve against the CURRENT window, reset
 *                                 status, claim (fresh budget; videos_refunded
 *                                 reset for the new run)
 *   done / charged              → refused (done jobs never retry)
 *
 * The RPC returns the granted clip budget and the route dispatches THAT value
 * (never a stale max_clips). Fail-closed: any RPC failure aborts with no
 * dispatch.
 *
 * Uncertainty handling: a GitHub HTTP error status means the dispatch was NOT
 * accepted → the job is settled atomically (fail_job_quota: failed + refund).
 * A thrown fetch (network error) leaves acceptance UNKNOWN → the job is
 * deliberately left queued+claimed so a possibly-accepted run is not refunded
 * while a duplicate is being processed; the reconcile cron reaps it if no run
 * materializes (updated_at heartbeat older than 6 h).
 */

interface JobWithQuota {
    id: string;
    user_id: string;
    video_url: string | null;
    video_storage_path: string | null;
    caption_style: string | null;
    caption_pace: string | null;
    source_language: string | null;
    caption_language: string | null;
    max_clips: number | null;
    job_mode: string | null;
    remove_silences: boolean | null;
    auto_punch_in: boolean | null;
    bgm_mood: string | null;
    custom_bgm_url: string | null;
    status: string;
    quota_state: string | null;
    quota_video_charged: boolean | null;
    dispatch_count: number | null;
    checkpoint_url: string | null;
    usage_window_start: string | null;
}

const MAX_DISPATCHES_PER_JOB = 5;
const VALID_CAPTION_PACES = ["fast", "balanced", "slow"] as const;
const VALID_SOURCE_LANGUAGES = ["auto", "hi", "en"] as const;
const VALID_CAPTION_LANGUAGES = ["original", "hinglish", "en"] as const;

type QuotaError = { status: number; message: string };

function mapQuotaError(message: string): QuotaError | null {
    if (message.startsWith("QUOTA_VIDEOS_LIMIT") || message.startsWith("QUOTA_CLIPS_LIMIT")) {
        return {
            status: 402,
            message: message.split(": ").slice(1).join(": ") || "Plan limit reached.",
        };
    }
    if (message.startsWith("QUOTA_JOB_DONE")) {
        return { status: 409, message: "This video is already completed." };
    }
    return null;
}

export async function POST(request: NextRequest) {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const job_id = body?.job_id;

    if (!job_id || typeof job_id !== "string") {
        return NextResponse.json({ error: "job_id is required" }, { status: 400 });
    }

    // Retry semantics: resume=true forces checkpoint resume, resume=false
    // forces a fresh run; omitted defaults to the saved checkpoint when one
    // exists. Only these two flags are accepted from the client — everything
    // else is re-read from the stored row.
    const resumeInput = body?.resume;
    if (resumeInput !== undefined && typeof resumeInput !== "boolean") {
        return NextResponse.json({ error: "resume must be a boolean" }, { status: 400 });
    }

    const admin = createServiceClient();
    if (!admin) {
        // Fail closed: without the service key there is no accounting.
        console.error("[trigger] SUPABASE_SERVICE_ROLE_KEY is not configured");
        return NextResponse.json(
            { error: "Processing is temporarily unavailable. Please try again shortly." },
            { status: 503 }
        );
    }

    // Read the stored job through the RLS session client (ownership proof).
    // The select is a SINGLE literal string — the supabase-js typed-query
    // parser mis-handles concatenated/dynamic select strings.
    const { data, error: jobError } = await supabase
        .from("jobs")
        .select("id,user_id,video_url,video_storage_path,caption_style,caption_pace,source_language,caption_language,max_clips,job_mode,remove_silences,auto_punch_in,bgm_mood,custom_bgm_url,status,quota_state,quota_video_charged,dispatch_count,checkpoint_url,usage_window_start")
        .eq("id", job_id)
        .eq("user_id", user.id)
        .single();

    const job = data ? (data as unknown as JobWithQuota) : null;
    if (jobError || !job) {
        return NextResponse.json({ error: "Job not found or not authorized" }, { status: 404 });
    }

    // ── Atomic claim (state decision + reservation + reset + count) ──────
    const { data: claim, error: claimError } = await admin.rpc("claim_job_dispatch", {
        p_job_id: job.id,
    });
    if (claimError || !claim) {
        const message = claimError?.message ?? "unknown error";
        console.error("[trigger] claim_job_dispatch failed:", message);
        const mapped = mapQuotaError(message);
        if (mapped) {
            return NextResponse.json({ error: mapped.message }, { status: mapped.status });
        }
        return NextResponse.json(
            { error: "Could not start processing. Please try again shortly." },
            { status: 503 }
        );
    }

    // claim shape: [{ claimed, reason, granted_clips }]
    const claimRow = Array.isArray(claim) ? claim[0] : claim;
    if (!claimRow || typeof claimRow.claimed !== "boolean"
        || typeof claimRow.reason !== "string"
        || !Number.isInteger(claimRow.granted_clips)
        || claimRow.granted_clips < 0
        || (claimRow.claimed && (claimRow.granted_clips < 1 || claimRow.granted_clips > 20))) {
        console.error("[trigger] malformed quota claim; refusing dispatch");
        return NextResponse.json({ error: "Could not verify the processing reservation. Please try again shortly." }, { status: 503 });
    }

    if (!claimRow.claimed) {
        if (claimRow.reason === "done") {
            return NextResponse.json(
                { error: "This video is already completed." },
                { status: 409 }
            );
        }
        // A run is already claimed/in flight — never touch its hold.
        return NextResponse.json(
            { error: "This video is already processing." },
            { status: 409 }
        );
    }

    if ((job.dispatch_count ?? 0) >= MAX_DISPATCHES_PER_JOB) {
        // The claim succeeded; undo it via a settle so the cap stays honest.
        await failJobQuota(admin, job.id,
            "This video has reached its retry limit. Please contact support.");
        return NextResponse.json(
            { error: "This video has reached its retry limit. Please contact support." },
            { status: 429 }
        );
    }

    // ── Resolve the source URL ───────────────────────────────────────────
    let sourceUrl = job.video_url;
    if (job.video_storage_path) {
        if (!r2Configured()) {
            await failJobQuota(admin, job.id,
                "Video uploads are not configured yet. Please contact support.");
            return NextResponse.json(
                { error: "Video uploads are not configured yet. Please contact support." },
                { status: 503 }
            );
        }
        const signed = await r2PresignGet(job.video_storage_path, 60 * 60 * 24);
        if (!signed) {
            await failJobQuota(admin, job.id,
                "Your uploaded video could not be read. Please upload it again.");
            return NextResponse.json(
                { error: "Your uploaded video could not be read. Please upload it again." },
                { status: 400 }
            );
        }
        sourceUrl = signed;
    }

    const validation = validateVideoUrl(sourceUrl);
    if (!validation.ok) {
        await failJobQuota(admin, job.id, validation.reason);
        return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    // ── Dispatch GitHub Actions with the PERSISTED choices + fresh budget ─
    const githubToken = process.env.GITHUB_TOKEN;
    const githubRepo = process.env.GITHUB_REPO;
    if (!githubToken || !githubRepo) {
        const missing = [!githubToken && "GITHUB_TOKEN", !githubRepo && "GITHUB_REPO"]
            .filter(Boolean)
            .join(", ");
        console.error(`[trigger] ${missing} not set — pipeline not triggered`);
        await failJobQuota(admin, job.id,
            "Processing service is temporarily unavailable. Please try again later.");
        return NextResponse.json(
            { error: "Processing service is temporarily unavailable." },
            { status: 500 }
        );
    }

    const captionPace = VALID_CAPTION_PACES.includes(
        job.caption_pace as (typeof VALID_CAPTION_PACES)[number]
    )
        ? (job.caption_pace as string)
        : "balanced";
    const sourceLanguage = VALID_SOURCE_LANGUAGES.includes(
        job.source_language as (typeof VALID_SOURCE_LANGUAGES)[number]
    )
        ? (job.source_language as string)
        : "auto";
    const captionLanguage = VALID_CAPTION_LANGUAGES.includes(
        job.caption_language as (typeof VALID_CAPTION_LANGUAGES)[number]
    )
        ? (job.caption_language as string)
        : "original";

    const resumeFromCheckpoint =
        resumeInput === true ? true : resumeInput === false ? false : !!job.checkpoint_url;

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
                    max_clips: String(claimRow.granted_clips),
                    caption_pace: captionPace,
                    source_language: sourceLanguage,
                    caption_language: captionLanguage,
                    resume_from_checkpoint: resumeFromCheckpoint ? "true" : "false",
                    bgm_mood: job.bgm_mood || "auto",
                    custom_bgm_url: job.custom_bgm_url || "",
                    job_mode: job.job_mode === "captions" ? "captions" : "clips",
                    remove_silences: job.remove_silences ? "true" : "false",
                    auto_punch_in: job.auto_punch_in ? "true" : "false",
                },
            }),
        });

        if (!dispatchRes.ok) {
            // GitHub rejected the dispatch — acceptance is definitively NO.
            const errText = await dispatchRes.text();
            console.error(
                "GitHub dispatch failed:",
                `GitHub API ${dispatchRes.status}: ${errText.slice(0, 500)}`,
                "URL:",
                dispatchUrl
            );
            await failJobQuota(admin, job.id,
                "Could not start video processing. Please try again.");
            return NextResponse.json(
                { error: "Could not start video processing. Please try again." },
                { status: 500 }
            );
        }
    } catch (err) {
        // Network-level failure: GitHub may or may not have accepted the
        // dispatch. Do NOT refund — the job stays queued+claimed so a possibly
        // accepted run is not refunded; the reconcile cron reaps it (6 h
        // stale heartbeat) if no run materialized.
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(
            "Pipeline trigger network error — dispatch acceptance UNKNOWN; job left queued for reconciliation:",
            errMsg
        );
        return NextResponse.json(
            { error: "Processing may have started. Check this video's status in a few minutes." },
            { status: 502 }
        );
    }

    return NextResponse.json({
        triggered: true,
        job_id: job.id,
        max_clips: claimRow.granted_clips,
        resume_from_checkpoint: resumeFromCheckpoint,
    });
}

/**
 * Atomic terminal status + quota refund (fail_job_quota RPC). Used when THIS
 * route rejects/dispatches-fails so the reservation can never leak. A failure
 * here is logged loudly — the reconcile cron settles the pending job later.
 */
async function failJobQuota(
    supabase: NonNullable<ReturnType<typeof createServiceClient>>,
    jobId: string,
    message: string
) {
    const { error } = await supabase.rpc("fail_job_quota", {
        p_job_id: jobId,
        p_message: message,
        p_status: "failed",
    });
    if (error) console.error("[trigger] fail_job_quota failed for", jobId, error.message);
}
