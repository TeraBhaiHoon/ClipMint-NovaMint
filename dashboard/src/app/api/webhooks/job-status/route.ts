import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

/**
 * Force Node.js runtime (not Edge) so all npm packages resolve correctly.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/job-status
 *
 * Called by the processing pipeline when a job completes or fails.
 * - Updates clips_used in the user's profile
 * - Sends email notification via Resend
 * - Sends Discord notification via user's webhook URL
 *
 * Body: { job_id, status, error_message?, webhook_secret }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { job_id, status, error_message, webhook_secret } = body;

    // ── Authenticate the webhook call ──
    const expectedSecret = process.env.WEBHOOK_SECRET;
    if (!expectedSecret || webhook_secret !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!job_id || !status) {
      return NextResponse.json(
        { error: "job_id and status are required" },
        { status: 400 }
      );
    }

    // ── Fetch job details from Supabase via REST ──
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceKey) {
      console.error("SUPABASE_SERVICE_ROLE_KEY env var is not set — cannot fetch job");
      return NextResponse.json(
        { error: "Server misconfiguration" },
        { status: 500 }
      );
    }

    const jobRes = await fetch(
      `${supabaseUrl}/rest/v1/jobs?id=eq.${job_id}&select=id,user_id,video_url,clips_count,source_type`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      }
    );

    const jobs = await jobRes.json();
    console.log(`Webhook job lookup: job_id=${job_id}, status=${jobRes.status}, results=${Array.isArray(jobs) ? jobs.length : 'non-array'}`);
    if (!jobs || jobs.length === 0) {
      console.error(`Job not found: job_id=${job_id}, response:`, JSON.stringify(jobs));
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const job = jobs[0];

    // ── Update clips_used in user profile when job completes successfully ──
    // Atomic RPC (see supabase/migration_quota.sql) instead of a read-modify-write.
    if (status === "done" && job.clips_count > 0) {
      try {
        const rpc = await callRpc(supabaseUrl, serviceKey, "increment_clips_used", {
          p_user_id: job.user_id,
          p_count: job.clips_count,
        });
        if (!rpc.ok) {
          console.error("increment_clips_used RPC failed:", rpc.detail);
        } else if (rpc.data === false) {
          console.error(`increment_clips_used refused for user ${job.user_id} (profile missing?)`);
        } else {
          console.log(`incremented clips_used by ${job.clips_count} for user ${job.user_id}`);
        }
      } catch (err) {
        console.error("Failed to update clips_used:", err);
      }
    }

    // ── Decrement videos_used when job fails or is cancelled ──
    // (The user's videos_used was incremented at submission time, so we reverse
    //  it here since the job didn't succeed.)
    //
    // Idempotency: the pipeline sets `jobs.status` to failed/cancelled *before*
    // it calls this webhook, so the status cannot tell us whether we already
    // refunded. Instead we flip `jobs.videos_refunded` with a conditional PATCH
    // (compare-and-set): only the delivery that wins the race refunds.
    if (status === "failed" || status === "cancelled") {
      try {
        const claimRes = await fetch(
          `${supabaseUrl}/rest/v1/jobs?id=eq.${job_id}&videos_refunded=eq.false`,
          {
            method: "PATCH",
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify({ videos_refunded: true }),
          }
        );

        if (!claimRes.ok) {
          const detail = (await claimRes.text()).slice(0, 300);
          console.error(
            `Could not claim refund for job ${job_id} (is supabase/migration_quota.sql applied?):`,
            claimRes.status,
            detail
          );
        } else {
          const claimed = await claimRes.json();
          if (Array.isArray(claimed) && claimed.length > 0) {
            const rpc = await callRpc(supabaseUrl, serviceKey, "refund_videos_used", {
              p_user_id: job.user_id,
            });
            if (rpc.ok && rpc.data === true) {
              console.log(`Refunded one video slot for user ${job.user_id} (job ${status})`);
            } else {
              console.error("refund_videos_used RPC failed:", rpc.detail);
            }
          } else {
            console.log(`Refund already recorded for job ${job_id} — skipping duplicate refund`);
          }
        }
      } catch (err) {
        console.error("Failed to refund videos_used:", err);
      }
    }

    // ── Get user email + profile (for notification prefs) ──
    const userRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${job.user_id}`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      }
    );

    const userData = await userRes.json();
    const userEmail = userData?.email;

    if (!userEmail) {
      console.error("Could not fetch user email for user:", job.user_id);
      return NextResponse.json(
        { error: "User email not found" },
        { status: 404 }
      );
    }

    // ── Get user notification preferences ──
    let notifyEmail = true;
    let notifyDiscord = false;
    let notifyJobComplete = true;
    let notifyJobFailed = true;
    let discordWebhookUrl: string | null = null;
    let userWebhookUrl: string | null = null;
    let notifyWebhook = false;

    try {
      const profileNotifRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${job.user_id}&select=notify_email,notify_discord,notify_job_complete,notify_job_failed,notify_webhook,discord_webhook_url,user_webhook_url`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        }
      );
      const profileNotifData = await profileNotifRes.json();
      if (profileNotifData && profileNotifData.length > 0) {
        const prefs = profileNotifData[0];
        notifyEmail = prefs.notify_email ?? true;
        notifyDiscord = prefs.notify_discord ?? false;
        notifyJobComplete = prefs.notify_job_complete ?? true;
        notifyJobFailed = prefs.notify_job_failed ?? true;
        discordWebhookUrl = prefs.discord_webhook_url || null;
        userWebhookUrl = prefs.user_webhook_url || null;
        notifyWebhook = prefs.notify_webhook ?? false;
      }
    } catch (err) {
      console.warn("Could not fetch notification prefs, using defaults:", err);
    }

    const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || "https://clipmint.vikashbuilds.in";
    const jobUrl = `${dashboardUrl}/dashboard/${job_id}`;

    // ── Check if this notification type is enabled ──
    const shouldNotify =
      (status === "done" && notifyJobComplete) ||
      (status === "failed" && notifyJobFailed) ||
      (status === "cancelled" && notifyJobFailed);

    // ── Send Email notification (best effort — must never fail the webhook) ──
    if (shouldNotify && notifyEmail) {
      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) {
        console.warn("RESEND_API_KEY is not set — skipping email notification");
      } else {
        try {
          // Constructed here, at the point of use, so a missing/invalid key can
          // never throw before the quota bookkeeping above has run.
          const resend = new Resend(resendKey);

          if (status === "done") {
            const result = await resend.emails.send({
              from: "ClipMint <no-reply@novamintnetworks.in>",
              to: [userEmail],
              subject: "🎬 Your clips are ready!",
              html: buildSuccessEmail({
                jobUrl,
                clipCount: job.clips_count || 0,
                videoUrl: job.video_url || "",
              }),
            });
            if (result.error) console.error("Resend error (success email):", result.error);
            else console.log(`Email notification sent to ${userEmail} for status: ${status}`);
          } else if (status === "failed") {
            const result = await resend.emails.send({
              from: "ClipMint <no-reply@novamintnetworks.in>",
              to: [userEmail],
              subject: "⚠️ Video processing failed",
              html: buildFailureEmail({
                jobUrl,
                errorMessage: error_message || "An unexpected error occurred",
                videoUrl: job.video_url || "",
              }),
            });
            if (result.error) console.error("Resend error (failure email):", result.error);
            else console.log(`Email notification sent to ${userEmail} for status: ${status}`);
          }
        } catch (err) {
          console.error("Failed to send email notification:", err);
        }
      }
    }

    // ── Send Discord notification ──
    if (shouldNotify && notifyDiscord && discordWebhookUrl) {
      try {
        await sendDiscordNotification({
          webhookUrl: discordWebhookUrl,
          status,
          jobUrl,
          clipCount: job.clips_count || 0,
          videoUrl: job.video_url || "",
          errorMessage: error_message,
        });
        console.log(`Discord notification sent for job ${job_id}`);
      } catch (err) {
        console.error("Failed to send Discord notification:", err);
      }
    }

    // ── Send user webhook (backlog 8.5) ──
    // The user's own endpoint gets a flat JSON event when they opted in
    // (profiles.notify_webhook + profiles.user_webhook_url). Strictly
    // best-effort: 5 s timeout, failures logged and never thrown, so a slow
    // or broken user endpoint cannot delay or fail the pipeline webhook.
    const webhookEvent =
      status === "done"
        ? "job.completed"
        : status === "failed"
          ? "job.failed"
          : status === "cancelled"
            ? "job.cancelled"
            : null;
    if (webhookEvent && notifyWebhook && userWebhookUrl) {
      const payload = JSON.stringify({
        event: webhookEvent,
        job_id,
        status,
        clips_count: job.clips_count || 0,
        error_message: error_message || null,
        timestamp: new Date().toISOString(),
      });
      try {
        const resp = await fetch(userWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: AbortSignal.timeout(5000),
        });
        console.log(`User webhook POST ${userWebhookUrl} -> ${resp.status} for job ${job_id}`);
      } catch (err) {
        console.error("User webhook failed (non-critical):", err);
      }
    }

    return NextResponse.json({ sent: true, to: userEmail, status });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("Webhook handler error:", errMsg);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}

// ── Supabase helpers ──

/**
 * Call a Postgres function via PostgREST. Returns `ok: false` with a short
 * detail string when the HTTP call fails (e.g. the migration was not applied)
 * so callers can log instead of throwing.
 */
async function callRpc(
  supabaseUrl: string,
  serviceKey: string,
  fn: string,
  params: Record<string, unknown>
): Promise<{ ok: boolean; data: unknown; detail: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { ok: res.ok, data, detail: `${res.status} ${text.slice(0, 300)}` };
}

/** Escape a value before interpolating it into the notification HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Discord Webhook ──

/** Strip internal/technical references from error messages before showing to users */
function sanitizeErrorMessage(msg: string | undefined): string {
  if (!msg) return "An unexpected error occurred. Please try again or contact support.";
  return msg
    .replace(/GitHub/gi, "")
    .replace(/pipeline/gi, "processing")
    .replace(/Actions/g, "")
    .replace(/\blogs?\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim() || "An unexpected error occurred. Please try again or contact support.";
}

async function sendDiscordNotification(opts: {
  webhookUrl: string;
  status: string;
  jobUrl: string;
  clipCount: number;
  videoUrl: string;
  errorMessage?: string;
}) {
  const isSuccess = opts.status === "done";
  const safeError = sanitizeErrorMessage(opts.errorMessage);

  const embed = {
    title: isSuccess ? "🎬 Your clips are ready!" : "⚠️ Processing failed",
    description: isSuccess
      ? `ClipMint generated **${opts.clipCount} clip${opts.clipCount !== 1 ? "s" : ""}** from your video.`
      : `ClipMint encountered an error while processing your video.\n\n**Error:** ${safeError}`,
    color: isSuccess ? 0x39E508 : 0xEF4444,
    fields: [
      {
        name: "📹 Source",
        value: opts.videoUrl.length > 100
          ? opts.videoUrl.slice(0, 100) + "..."
          : opts.videoUrl || "N/A",
        inline: false,
      },
      ...(isSuccess
        ? [{ name: "📊 Clips", value: `${opts.clipCount}`, inline: true }]
        : []),
    ],
    url: opts.jobUrl,
    timestamp: new Date().toISOString(),
    footer: {
      text: "ClipMint by NovaMint Networks",
    },
  };

  await fetch(opts.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "ClipMint",
      avatar_url: "https://clipmint.vikashbuilds.in/favicon.ico",
      embeds: [embed],
    }),
  });
}

// ── Email Templates ──

function buildSuccessEmail(opts: { jobUrl: string; clipCount: number; videoUrl: string }) {
  const safeVideoUrl = escapeHtml(opts.videoUrl);
  const safeJobUrl = escapeHtml(opts.jobUrl);
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#111;border-radius:16px;border:1px solid #222;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#39E508 0%,#00C853 100%);padding:32px 40px;">
      <h1 style="margin:0;color:#000;font-size:24px;font-weight:800;">🎬 Your clips are ready!</h1>
    </div>
    <div style="padding:32px 40px;">
      <p style="color:#ccc;font-size:15px;line-height:1.6;margin:0 0 20px;">
        Great news! ClipMint has finished processing your video and generated
        <strong style="color:#39E508;">${opts.clipCount} clip${opts.clipCount !== 1 ? "s" : ""}</strong>.
      </p>
      <p style="color:#888;font-size:13px;margin:0 0 24px;word-break:break-all;">
        Source: ${safeVideoUrl.length > 80 ? safeVideoUrl.slice(0, 80) + "..." : safeVideoUrl}
      </p>
      <a href="${safeJobUrl}"
         style="display:inline-block;background:linear-gradient(135deg,#39E508,#00C853);color:#000;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;">
        View & Download Clips →
      </a>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #222;">
      <p style="color:#555;font-size:12px;margin:0;">
        ClipMint by NovaMint Networks · <a href="${safeJobUrl}" style="color:#39E508;text-decoration:none;">Dashboard</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

function buildFailureEmail(opts: { jobUrl: string; errorMessage: string; videoUrl: string }) {
  const safeVideoUrl = escapeHtml(opts.videoUrl);
  const safeJobUrl = escapeHtml(opts.jobUrl);
  const safeError = escapeHtml(opts.errorMessage);
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#111;border-radius:16px;border:1px solid #222;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#EF4444 0%,#DC2626 100%);padding:32px 40px;">
      <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;">⚠️ Processing Failed</h1>
    </div>
    <div style="padding:32px 40px;">
      <p style="color:#ccc;font-size:15px;line-height:1.6;margin:0 0 16px;">
        Unfortunately, ClipMint encountered an error while processing your video.
      </p>
      <p style="color:#888;font-size:13px;margin:0 0 12px;word-break:break-all;">
        Source: ${safeVideoUrl.length > 80 ? safeVideoUrl.slice(0, 80) + "..." : safeVideoUrl}
      </p>
      <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:12px 16px;margin:0 0 24px;">
        <span style="color:#EF4444;font-size:13px;">
          ${safeError}
        </span>
      </div>
      <a href="${safeJobUrl}"
         style="display:inline-block;background:linear-gradient(135deg,#EF4444,#DC2626);color:#fff;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;">
        View Job & Retry →
      </a>
    </div>
    <div style="padding:20px 40px;border-top:1px solid #222;">
      <p style="color:#555;font-size:12px;margin:0;">
        ClipMint by NovaMint Networks · <a href="${safeJobUrl}" style="color:#39E508;text-decoration:none;">Dashboard</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}
