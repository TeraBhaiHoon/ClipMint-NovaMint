import { NextResponse } from "next/server";
import { createClient } from "@/lib/server";
import { getCashfree } from "@/lib/cashfree";

/**
 * POST /api/cashfree/cancel
 *
 * Cancels the user's active subscription at Cashfree (via the SDK's
 * `SubsManageSubscription` — subscriptions are cancelled in place at the end of
 * the current billing period), then updates the local profile.
 *
 * - Real Cashfree subscription → the SDK CANCEL call must succeed; otherwise the
 *   user would be marked cancelled locally but keep getting charged at renewal.
 * - Order-based purchase (no Cashfree subscription) → nothing to cancel remotely;
 *   only the local status is updated and access is retained to period end.
 */
export async function POST() {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get current profile
    const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("cashfree_subscription_id, cashfree_order_id, subscription_status, plan")
        .eq("id", user.id)
        .single();

    if (profileError || !profile) {
        return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    if (
        profile.subscription_status === "cancelled" ||
        profile.subscription_status === "none"
    ) {
        return NextResponse.json(
            { error: "Subscription is already cancelled or inactive" },
            { status: 400 }
        );
    }

    // If the user has a real Cashfree subscription, cancel it upstream FIRST.
    // A failed remote cancel means the user keeps being billed — do not claim cancelled.
    if (profile.cashfree_subscription_id) {
        try {
            await getCashfree().SubsManageSubscription(
                profile.cashfree_subscription_id,
                {
                    subscription_id: profile.cashfree_subscription_id,
                    action: "CANCEL",
                }
            );
        } catch (err) {
            console.error("Cashfree subscription cancel failed:", err);
            return NextResponse.json(
                { error: "Could not cancel the subscription at the payment provider. Please try again." },
                { status: 502 }
            );
        }
    }

    // Update profile status to cancelled (remote cancel succeeded, or nothing to cancel).
    const { error: updateError } = await supabase
        .from("profiles")
        .update({
            subscription_status: "cancelled",
        })
        .eq("id", user.id);

    if (updateError) {
        console.error("Failed to persist cancelled status:", updateError);
        return NextResponse.json(
            { error: "Subscription cancelled at the provider but could not be saved. Please contact support." },
            { status: 500 }
        );
    }

    return NextResponse.json({
        success: true,
        message:
            "Subscription cancelled. You'll retain access until the end of your current billing period.",
    });
}