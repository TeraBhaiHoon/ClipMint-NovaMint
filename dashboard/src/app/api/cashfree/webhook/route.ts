import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/server";
import { PLAN_LIMITS, type Plan, type PlanPeriod } from "@/lib/types";
import {
    computePeriodEnd,
    isBilledPlan,
    isPlanPeriod,
    normalizeWebhookEventType,
    planPeriodAmountPaise,
    verifyCashfreeWebhook,
} from "@/lib/cashfree";

/**
 * POST /api/cashfree/webhook
 *
 * Receives Cashfree webhook events for payment and subscription lifecycle.
 * This route is NOT protected by auth — it is protected by signature verification
 * (see `verifyCashfreeWebhook`: timestamp replay window + HMAC-SHA256 against the
 * configured webhook secret, with the SDK's client-secret check as the fallback).
 *
 * Cashfree event `type` values arrive with a `_WEBHOOK` suffix
 * (e.g. `PAYMENT_SUCCESS_WEBHOOK`); `normalizeWebhookEventType` strips it so the
 * switch below reads `PAYMENT_SUCCESS` / `PAYMENT_FAILED` / `PAYMENT_USER_DROPPED`.
 *
 * Events handled:
 * - PAYMENT_SUCCESS            → Payment captured, upgrade plan (idempotent)
 * - PAYMENT_FAILED             → Log failed payment (best-effort, always 200)
 * - PAYMENT_USER_DROPPED       → User abandoned payment (same as failed)
 * - SUBSCRIPTION_PAYMENT_SUCCESS → Recurring payment successful
 * - SUBSCRIPTION_CANCELLED     → Subscription cancelled
 * - SUBSCRIPTION_EXPIRED       → Subscription expired, downgrade to free
 *
 * Success events return 500 on persistence errors so Cashfree retries; failed /
 * benign events always return 200 so Cashfree stops retrying.
 */

export async function POST(request: NextRequest) {
    const rawBody = await request.text();
    const timestamp =
        request.headers.get("x-webhook-timestamp") ||
        request.headers.get("x-cashfree-timestamp") ||
        "";
    const signature =
        request.headers.get("x-webhook-signature") ||
        request.headers.get("x-cashfree-signature") ||
        "";

    // Always verify first — unauthenticated webhook calls are rejected before any work.
    if (!verifyCashfreeWebhook(signature, rawBody, timestamp)) {
        console.error("Cashfree webhook signature verification failed");
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    let event: { type?: string; data?: Record<string, unknown> };
    try {
        event = JSON.parse(rawBody);
    } catch {
        console.error("Cashfree webhook: malformed body");
        return NextResponse.json({ status: "ok" }, { status: 200 });
    }

    const eventType = normalizeWebhookEventType(event.type);
    const eventData = event.data || {};

    console.log(`Cashfree webhook: ${eventType}`);

    // Safe object access for the payload shapes Cashfree sends.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const order = ((eventData as any).order || {}) as Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payment = ((eventData as any).payment || {}) as Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscription = ((eventData as any).subscription || {}) as Record<string, any>;

    const orderTags = (order.order_tags || {}) as Record<string, string>;
    const subscriptionTags = (subscription.subscription_tags || {}) as Record<string, string>;

    const supabase = createServiceClient();
    if (!supabase) {
        console.error(
            "Cashfree webhook: SUPABASE_SERVICE_ROLE_KEY is not configured — cannot process events"
        );
        // Fail loudly so the operator notices; Cashfree will retry.
        return NextResponse.json({ message: "Service not configured" }, { status: 500 });
    }

    try {
        switch (eventType) {
            case "PAYMENT_SUCCESS": {
                const userId = orderTags.user_id;
                const plan = orderTags.plan as Plan;
                const period = (orderTags.period || "monthly") as PlanPeriod;

                if (!userId || !isBilledPlan(plan) || !isPlanPeriod(period)) {
                    console.log(
                        `Missing user_id/plan/period in order tags (userId=${userId ? "yes" : "no"}, plan=${plan}, period=${period})`
                    );
                    break;
                }

                const planInfo = PLAN_LIMITS[plan];

                // Idempotency: an already-captured payment for this order (e.g. from the
                // return-URL verification path, or a Cashfree redelivery) must not run again.
                const { data: existing } = await supabase
                    .from("payments")
                    .select("id")
                    .eq("cashfree_order_id", order.order_id || "")
                    .eq("status", "captured")
                    .maybeSingle();

                if (!existing) {
                    const periodEnd = computePeriodEnd(period);
                    const amountPaise = planPeriodAmountPaise(plan, period);

                    // Upgrade user
                    const { error: updateError } = await supabase
                        .from("profiles")
                        .update({
                            plan,
                            clips_limit: planInfo.clips,
                            videos_limit: planInfo.videos,
                            clips_used: 0,
                            videos_used: 0,
                            cashfree_order_id: order.order_id || null,
                            cashfree_customer_id: payment.customer_id || null,
                            subscription_status: period === "one_time" ? "none" : "active",
                            plan_period: period,
                            current_period_end: periodEnd.toISOString(),
                        })
                        .eq("id", userId);

                    if (updateError) {
                        // Persistence failure — let Cashfree retry the webhook.
                        throw new Error(
                            `Failed to upgrade profile for ${userId}: ${updateError.message}`
                        );
                    }

                    // Log payment
                    const { error: insertError } = await supabase.from("payments").insert({
                        user_id: userId,
                        cashfree_order_id: order.order_id || "",
                        cashfree_payment_id: String(payment.cf_payment_id ?? "") || null,
                        cf_payment_id: String(payment.cf_payment_id ?? "") || null,
                        amount: amountPaise,
                        currency: payment.payment_currency || "INR",
                        plan,
                        plan_period: period,
                        status: "captured",
                    });

                    if (insertError) {
                        throw new Error(
                            `Failed to log payment for ${userId}: ${insertError.message}`
                        );
                    }
                }
                break;
            }

            case "PAYMENT_FAILED":
            case "PAYMENT_USER_DROPPED": {
                const userId = orderTags.user_id;
                if (!userId) {
                    console.log("Missing user_id in order tags for failed payment");
                    break;
                }

                // Best-effort record of the failed attempt — NEVER let a failure here throw,
                // so Cashfree stops retrying these benign events. (No plan state changes.)
                try {
                    await supabase.from("payments").insert({
                        user_id: userId,
                        cashfree_order_id: order.order_id || "",
                        cashfree_payment_id: String(payment.cf_payment_id ?? "") || null,
                        cf_payment_id: String(payment.cf_payment_id ?? "") || null,
                        amount: Math.round(Number(order.order_amount || 0) * 100),
                        currency: order.order_currency || "INR",
                        plan: isBilledPlan(orderTags.plan) ? orderTags.plan : "creator",
                        plan_period: isPlanPeriod(orderTags.period)
                            ? (orderTags.period as PlanPeriod)
                            : "monthly",
                        status: "failed",
                    });
                } catch (err) {
                    // Failed-payment logging is non-critical; log and continue.
                    console.error("Failed to record failed payment event:", err);
                }
                break;
            }

            case "SUBSCRIPTION_PAYMENT_SUCCESS": {
                const userId = subscriptionTags.user_id;
                const plan = subscriptionTags.plan as Plan;
                if (!userId || !isBilledPlan(plan)) break;

                // Renew period and reset usage
                const periodEnd = computePeriodEnd(
                    subscriptionTags.period === "annual" ? "annual" : "monthly"
                );

                const { error: updateError } = await supabase
                    .from("profiles")
                    .update({
                        clips_used: 0,
                        videos_used: 0,
                        subscription_status: "active",
                        current_period_end: periodEnd.toISOString(),
                    })
                    .eq("id", userId);

                if (updateError) {
                    throw new Error(
                        `Failed to renew subscription for ${userId}: ${updateError.message}`
                    );
                }
                break;
            }

            case "SUBSCRIPTION_CANCELLED": {
                const userId = subscriptionTags.user_id;
                if (!userId) break;

                const { error: updateError } = await supabase
                    .from("profiles")
                    .update({ subscription_status: "cancelled" })
                    .eq("id", userId);

                if (updateError) {
                    throw new Error(
                        `Failed to mark subscription cancelled for ${userId}: ${updateError.message}`
                    );
                }
                break;
            }

            case "SUBSCRIPTION_EXPIRED": {
                const userId = subscriptionTags.user_id;
                if (!userId) break;

                // Downgrade to free
                const { error: updateError } = await supabase
                    .from("profiles")
                    .update({
                        plan: "free",
                        clips_limit: 5,
                        videos_limit: 2,
                        subscription_status: "none",
                        cashfree_subscription_id: null,
                        current_period_end: null,
                    })
                    .eq("id", userId);

                if (updateError) {
                    throw new Error(
                        `Failed to downgrade expired subscription for ${userId}: ${updateError.message}`
                    );
                }
                break;
            }

            default:
                // Unknown / irrelevant event — acknowledge so Cashfree stops retrying.
                console.log(`Unhandled Cashfree event: ${eventType}`);
        }

        return NextResponse.json({ status: "ok" });
    } catch (err) {
        console.error("Webhook processing error:", err);
        // Genuine persistence failures return 500 so Cashfree retries the delivery.
        return NextResponse.json({ message: "Error processing webhook" }, { status: 500 });
    }
}