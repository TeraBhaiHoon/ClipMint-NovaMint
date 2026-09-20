import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/server";
import { PLAN_LIMITS, type Plan, type PlanPeriod } from "@/lib/types";
import {
    getCashfree,
    isBilledPlan,
    isPlanPeriod,
    isProductionEnvironment,
    orderNoteFor,
    ORDER_EXPIRY_MINUTES,
    planPeriodAmountRupees,
    logCashfreeError,
} from "@/lib/cashfree";

/**
 * POST /api/cashfree/create-order
 *
 * Creates (or reuses) a Cashfree order for one-time or subscription payments.
 * Body: { plan: "creator" | "pro" | "agency", period: "monthly" | "annual" | "one_time" }
 *
 * Returns a payment_session_id for the Cashfree JS SDK checkout.
 */
export async function POST(request: NextRequest) {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);

    const rawPlan = body?.plan;
    const rawPeriod = body?.period;

    if (typeof rawPlan !== "string" || !isBilledPlan(rawPlan)) {
        return NextResponse.json(
            { error: "Valid plan required" },
            { status: 400 }
        );
    }
    if (typeof rawPeriod !== "string" || !isPlanPeriod(rawPeriod)) {
        return NextResponse.json(
            { error: "Valid period required (monthly, annual or one_time)" },
            { status: 400 }
        );
    }

    // Narrowed by the type guards above.
    const plan: Plan = rawPlan;
    const period: PlanPeriod = rawPeriod;

    // Get user profile — the order is linked to it and later verified against it.
    const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

    if (profileError || !profile) {
        return NextResponse.json(
            { error: "Profile not found" },
            { status: 404 }
        );
    }

    try {
        const planInfo = PLAN_LIMITS[plan];
        const finalAmount = planPeriodAmountRupees(plan, period);

        // Idempotency: if the user already has an in-flight Cashfree order for this
        // exact plan + period that has not expired and not been paid, reuse it instead
        // of minting a second order (prevents double charges from double-clicks/retries).
        if (profile.cashfree_order_id) {
            try {
                const existing = await getCashfree().PGFetchOrder(
                    profile.cashfree_order_id
                );
                const existingData = existing.data;
                const existingTags = (existingData?.order_tags || {}) as Record<string, string>;
                const stillPending =
                    existingData &&
                    (existingData.order_status === "ACTIVE" ||
                        existingData.order_status === "PENDING");
                if (
                    stillPending &&
                    existingTags.plan === plan &&
                    existingTags.period === period &&
                    existingData.payment_session_id
                ) {
                    return NextResponse.json({
                        order_id: profile.cashfree_order_id,
                        payment_session_id: existingData.payment_session_id,
                        cf_order_id: existingData.cf_order_id ?? null,
                        app_id: process.env.NEXT_PUBLIC_CASHFREE_APP_ID,
                        plan,
                        period,
                        amount: finalAmount,
                        environment: isProductionEnvironment() ? "production" : "sandbox",
                        reused: true,
                    });
                }
            } catch {
                // Order fetch failed (e.g. expired/unknown in this environment) — mint a new one.
            }
        }

        const orderId = `clipmint_${plan}_${user.id.slice(0, 8)}_${Date.now()}`;

        const orderRequest = {
            order_id: orderId,
            order_amount: finalAmount,
            order_currency: "INR",
            customer_details: {
                customer_id: user.id.replace(/-/g, "").slice(0, 20),
                customer_email: user.email || "customer@clipmint.app",
                // Cashfree requires a phone at order creation; the checkout flow lets the
                // customer correct it. A real phone capture is tracked as an owner action.
                customer_phone: "9999999999",
                customer_name: profile.full_name || user.email || "Customer",
            },
            order_meta: {
                return_url: `${request.nextUrl.origin}/api/cashfree/verify-payment?order_id={order_id}`,
                notify_url: `${request.nextUrl.origin}/api/cashfree/webhook`,
            },
            // Explicit short expiry so abandoned checkouts are recycled and never charged late.
            order_expiry_time: new Date(
                Date.now() + ORDER_EXPIRY_MINUTES * 60 * 1000
            ).toISOString(),
            order_note: orderNoteFor(planInfo.label, period),
            order_tags: {
                user_id: user.id,
                plan,
                period,
            },
        };

        const response = await getCashfree().PGCreateOrder(orderRequest);
        const orderData = response.data;

        if (!orderData?.payment_session_id) {
            console.error("Cashfree order creation failed:", orderData);
            return NextResponse.json(
                { error: "Failed to create payment order" },
                { status: 500 }
            );
        }

        // Remember the in-flight order on the profile so it can be reused/verified.
        const { error: updateError } = await supabase
            .from("profiles")
            .update({ cashfree_order_id: orderId })
            .eq("id", user.id);

        if (updateError) {
            console.error("Failed to persist order id:", updateError);
        }

        return NextResponse.json({
            order_id: orderId,
            payment_session_id: orderData.payment_session_id,
            cf_order_id: orderData.cf_order_id,
            app_id: process.env.NEXT_PUBLIC_CASHFREE_APP_ID,
            plan,
            period,
            amount: finalAmount,
            environment: isProductionEnvironment() ? "production" : "sandbox",
        });
    } catch (err) {
        logCashfreeError("create-order", err);
        return NextResponse.json(
            { error: "Payment initialization failed. Please try again." },
            { status: 500 }
        );
    }
}