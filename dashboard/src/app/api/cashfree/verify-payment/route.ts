import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/server";
import { PLAN_LIMITS, type Plan, type PlanPeriod } from "@/lib/types";
import {
    computePeriodEnd,
    getCashfree,
    isBilledPlan,
    isPlanPeriod,
    planPeriodAmountPaise,
    planPeriodAmountRupees,
    logCashfreeError,
} from "@/lib/cashfree";

/**
 * GET/POST /api/cashfree/verify-payment?order_id=xxx
 *
 * Called after Cashfree checkout completes (return URL redirect) and from the
 * pricing page after an in-modal payment. Always re-fetches the REAL order status
 * from Cashfree server-side — the client is never trusted.
 */
async function handleVerification(request: NextRequest) {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        // If not authenticated, redirect to login
        return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
    }

    // Get order_id from query params or body
    let orderId: string | null = null;

    if (request.method === "GET") {
        orderId = request.nextUrl.searchParams.get("order_id");
    } else {
        const body = await request.json().catch(() => null);
        orderId = typeof body?.order_id === "string" ? body.order_id : null;
    }

    if (!orderId) {
        if (request.method === "GET") {
            return NextResponse.redirect(
                new URL("/pricing?error=missing_order", request.nextUrl.origin)
            );
        }
        return NextResponse.json({ error: "Missing order_id" }, { status: 400 });
    }

    try {
        // Fetch the order server-side and bind it to the caller.
        const orderResponse = await getCashfree().PGFetchOrder(orderId);
        const orderData = orderResponse.data;

        if (!orderData) {
            return NextResponse.json(
                { error: "Order not found at Cashfree" },
                { status: 400 }
            );
        }

        // Security: an order may only verify for the user it was created for.
        const tags = (orderData.order_tags || {}) as Record<string, string>;
        if (tags.user_id && tags.user_id !== user.id) {
            return NextResponse.json(
                { error: "This order does not belong to your account" },
                { status: 403 }
            );
        }

        const plan = (tags.plan || "creator") as Plan;
        const period = (tags.period || "monthly") as PlanPeriod;

        if (!isBilledPlan(plan) || !isPlanPeriod(period)) {
            return NextResponse.json(
                { error: "Invalid plan in order" },
                { status: 400 }
            );
        }

        // Confirm the paid amount is exactly what this plan/period costs (defence in
        // depth — orders are created server-side, but never trust a mismatched order).
        const expectedRupees = planPeriodAmountRupees(plan, period);
        const paidRupees = Number(orderData.order_amount);
        if (!Number.isFinite(paidRupees) || Math.abs(paidRupees - expectedRupees) > 0.01) {
            return NextResponse.json(
                { error: "Order amount does not match the selected plan" },
                { status: 400 }
            );
        }

        // A payment only counts when Cashfree says so (order PAID, or a SUCCESS payment).
        let paymentSucceeded = orderData.order_status === "PAID";
        let successPaymentId: string | null = null;

        if (!paymentSucceeded) {
            const paymentsResponse = await getCashfree().PGOrderFetchPayments(orderId);
            const payments = paymentsResponse.data;
            const successPayment = (payments || []).find(
                (p) => (p as { payment_status?: string }).payment_status === "SUCCESS"
            );
            if (successPayment) {
                paymentSucceeded = true;
                successPaymentId = String(
                    (successPayment as { cf_payment_id?: number | string }).cf_payment_id ?? ""
                ) || null;
            }
        }

        if (!paymentSucceeded) {
            if (request.method === "GET") {
                return NextResponse.redirect(
                    new URL("/pricing?error=payment_failed", request.nextUrl.origin)
                );
            }
            return NextResponse.json(
                { error: "Payment was not successful" },
                { status: 400 }
            );
        }

        const supabaseAdmin = createServiceClient();
        if (!supabaseAdmin) {
            console.error("SUPABASE_SERVICE_ROLE_KEY missing for verify-payment");
            return NextResponse.json(
                { error: "Payment verified but could not be recorded" },
                { status: 500 }
            );
        }

        // Idempotency: this order was already processed (webhook + return URL can both fire).
        const { data: existing } = await supabaseAdmin
            .from("payments")
            .select("id")
            .eq("cashfree_order_id", orderId)
            .eq("status", "captured")
            .maybeSingle();

        const planInfo = PLAN_LIMITS[plan];
        const now = new Date();
        const periodEnd = computePeriodEnd(period, now);
        const amountPaise = planPeriodAmountPaise(plan, period);

        if (!existing) {
            // Log payment with the service role so RLS never blocks the insert.
            const { error: insertError } = await supabaseAdmin.from("payments").insert({
                user_id: user.id,
                cashfree_order_id: orderId,
                cashfree_payment_id: successPaymentId,
                cf_payment_id: successPaymentId,
                amount: amountPaise,
                currency: "INR",
                plan,
                plan_period: period,
                status: "captured",
            });

            if (insertError) {
                console.error("Failed to insert payment log:", insertError);
                return NextResponse.json(
                    { error: "Payment verified but could not be recorded" },
                    { status: 500 }
                );
            }

            // Upgrade the user's plan (only once — guarded by the payment-log idempotency above).
            const { error: updateError } = await supabaseAdmin
                .from("profiles")
                .update({
                    plan,
                    clips_limit: planInfo.clips,
                    videos_limit: planInfo.videos,
                    clips_used: 0,
                    videos_used: 0,
                    cashfree_order_id: orderId,
                    cashfree_customer_id:
                        orderData.customer_details?.customer_id || null,
                    // One-time payments only — there is never a Cashfree subscription.
                    subscription_status: "none",
                    plan_period: period,
                    current_period_end: periodEnd.toISOString(),
                })
                .eq("id", user.id);

            if (updateError) {
                console.error("Failed to update profile:", updateError);
                return NextResponse.json(
                    { error: "Failed to upgrade plan" },
                    { status: 500 }
                );
            }
        }

        if (request.method === "GET") {
            return NextResponse.redirect(
                new URL("/dashboard?payment=success", request.nextUrl.origin)
            );
        }

        return NextResponse.json({
            success: true,
            plan,
            period,
            message: `Successfully upgraded to ${planInfo.label} plan!`,
        });
    } catch (err) {
        logCashfreeError("verify-payment", err);
        if (request.method === "GET") {
            return NextResponse.redirect(
                new URL("/pricing?error=verification_failed", request.nextUrl.origin)
            );
        }
        return NextResponse.json(
            { error: "Payment verification failed. Please contact support." },
            { status: 500 }
        );
    }
}

export async function GET(request: NextRequest) {
    return handleVerification(request);
}

export async function POST(request: NextRequest) {
    return handleVerification(request);
}