import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

/**
 * GET/POST /api/cron/reconcile
 *
 * Quota reconciliation sweep (supabase/migration_quota_v2.sql). Scheduled via
 * Vercel Cron and safe to re-run: every mutation goes through an idempotent,
 * CAS-guarded service RPC, so double delivery cannot double-charge or
 * double-refund.
 *
 *   1. Reaper: jobs stuck in a running status whose updated_at heartbeat is
 *      older than 6 h are failed atomically (fail_job_quota = status + error
 *      + refund in one transaction). The heartbeat (progress pings from the
 *      pipeline, including render shards) keeps genuinely long renders alive —
 *      elapsed-since-start alone must never kill an active job.
 *   2. Legacy refunds: failed/cancelled jobs still pending whose slot the old
 *      webhook provably never refunded (videos_refunded=false). The RPC
 *      honours the legacy marker and the window guard.
 *   3. Legacy success floors: done jobs created before the v2 migration
 *      (usage_window_start IS NULL) settle through the monotonic floor
 *      reconcile — total delivered distinct masters in the CURRENT window,
 *      capped at max(0, floor − clips_used), never decrementing, never
 *      recomputing deleted usage, then baseline-marked charged.
 *   4. New-style done jobs still pending (their finalize never ran and no
 *      rows exist to bill provably) are marked settled without a charge.
 *   5. Hold consistency: clips_reserved is recomputed from the jobs that
 *      actually hold budget.
 *
 * Auth: CRON_SECRET (Bearer), fail closed when unset — same posture as
 * /api/cron/keep-alive.
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const RUNNING_STATUSES = [
    "queued", "downloading", "transcribing", "analyzing",
    "clipping", "captioning", "uploading",
] as const;
const TERMINAL_STATUSES = ["failed", "cancelled", "done"] as const;

async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[Reconcile] CRON_SECRET is not set — refusing to run.");
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("[Reconcile] Supabase env is not configured");
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const admin = createAdminClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const summary = {
    reaped: 0,
    legacyRefunded: 0,
    legacyFloorCharged: 0,
    quarantined: [] as string[],
    holdsFixed: 0,
    errors: [] as string[],
  };

  const settle = async (jobId: string, message: string) => {
    const { data, error } = await admin.rpc("fail_job_quota", {
      p_job_id: jobId,
      p_message: message,
      p_status: "failed",
    });
    if (error) {
      summary.errors.push(`fail_job_quota ${jobId}: ${error.message}`);
      console.error(`[Reconcile] fail_job_quota ${jobId} failed:`, error.message);
      return null;
    }
    return data as boolean;
  };

  try {
    // ── 1. Reaper: stale heartbeat on running jobs ──────────────────────
    const { data: stale, error: staleError } = await admin
      .from("jobs")
      .select("id,status,updated_at,created_at")
      .in("status", [...RUNNING_STATUSES])
      .lt("updated_at", new Date(Date.now() - 6 * 3600 * 1000).toISOString())
      .limit(200);

    if (staleError) {
      summary.errors.push(`stale select: ${staleError.message}`);
    } else {
      for (const job of stale ?? []) {
        const settled = await settle(
          job.id,
          "Processing timed out and was stopped automatically. You can retry this video."
        );
        if (settled !== null) {
          summary.reaped += 1;
          console.log(`[Reconcile] reaped stale job ${job.id} (${job.status})`);
        }
      }
    }

    // ── 2+4. Terminal jobs still pending on quota ───────────────────────
    // legacy = usage_window_start IS NULL (created before the v2 migration)
    const { data: pendingTerminal, error: pendingError } = await admin
      .from("jobs")
      .select("id,user_id,status,quota_video_charged,usage_window_start,completed_at")
      .in("status", [...TERMINAL_STATUSES])
      .eq("quota_state", "pending")
      .limit(500);

    if (pendingError) {
      summary.errors.push(`pending select: ${pendingError.message}`);
    } else {
      const legacyDoneUsers = new Set<string>();
      for (const job of pendingTerminal ?? []) {
        if (job.status === "done") {
          if (job.usage_window_start === null) {
            // Legacy success: floor reconcile per profile (step 3).
            legacyDoneUsers.add(job.user_id);
          } else {
            // A v2 job should NEVER be done while quota_state is pending —
            // finalize_job_results settles status and quota in one
            // transaction. This state means something wrote `done` outside
            // the atomic finalize: QUARANTINE it for operator review instead
            // of silently granting a free delivery or charging blind.
            summary.quarantined.push(job.id);
            console.error(
              `[Reconcile] QUARANTINE: v2 job ${job.id} is done but quota_state=pending — finalize invariant broken; manual review required`
            );
          }
          continue;
        }
        // failed / cancelled
        const settled = await settle(job.id, "Video processing failed. Please try again.");
        if (settled === true) {
          summary.legacyRefunded += 1;
        }
      }

      // ── 3. Legacy monotonic floor per affected profile ─────────────────
      for (const userId of legacyDoneUsers) {
        const { data: delta, error } = await admin.rpc("reconcile_profile_usage_floor", {
          p_user_id: userId,
        });
        if (error) {
          summary.errors.push(`floor ${userId}: ${error.message}`);
          console.error(`[Reconcile] floor reconcile failed for ${userId}:`, error.message);
        } else {
          summary.legacyFloorCharged += Number(delta) || 0;
          if (Number(delta) > 0) {
            console.log(`[Reconcile] floor reconcile ${userId}: +${delta} clips`);
          }
        }
      }
    }

    // ── 5. Hold consistency sweep ───────────────────────────────────────
    const { data: fixed, error: sweepError } = await admin.rpc("sweep_quota_holds");
    if (sweepError) {
      summary.errors.push(`sweep: ${sweepError.message}`);
    } else {
      summary.holdsFixed = Number(fixed) || 0;
    }

    console.log("[Reconcile] sweep complete:", JSON.stringify(summary));
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Reconcile] unexpected error:", msg);
    return NextResponse.json({ ok: false, error: msg, ...summary }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
