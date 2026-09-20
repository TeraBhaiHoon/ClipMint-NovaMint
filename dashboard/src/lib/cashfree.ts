import crypto from "crypto";
import { Cashfree, CFEnvironment } from "cashfree-pg";
import { PLAN_LIMITS, type Plan, type PlanPeriod } from "@/lib/types";

/**
 * Single source of truth for the Cashfree PG integration.
 * - One SDK instance (cashfree-pg v6) with ONE pinned API version across all call sites.
 * - All plan amounts are derived from PLAN_LIMITS here so create-order, verify-payment
 *   and the webhook can never disagree about what a plan costs.
 *
 * cashfree-pg v6 maps to the Cashfree OpenAPI spec 2026-01-01 (the SDK's default
 * `XApiVersion`). It is pinned explicitly so an SDK bump can never silently change
 * the API version the integration talks.
 */
export const CASHFREE_API_VERSION = "2026-01-01";

/** Orders expire 45 minutes after creation. Cashfree requires expiry to be
 *  STRICTLY more than 15 minutes away (a 15-minute value 400s as
 *  order_expiry_time_invalid, and server clock skew eats into the margin),
 *  and less than 30 days. The reuse path re-serves the same session, so a
 *  longer window never double-charges. */
export const ORDER_EXPIRY_MINUTES = 45;

/** A webhook signature older than this is treated as a replay. */
export const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Log a failed Cashfree SDK call WITH the gateway's own response body — the
 * axios error alone (e.g. "401") hides whether the credentials were rejected,
 * the environment mismatched, or the request was malformed.
 */
export function logCashfreeError(scope: string, err: unknown): void {
    const axios = err as { response?: { status?: number; data?: unknown }; message?: string };
    const status = axios?.response?.status;
    const body = axios?.response?.data;
    const hint =
        status === 401
            ? " — credentials rejected: CASHFREE_APP_ID/CASHFREE_SECRET_KEY must be a matching pair for the host CASHFREE_ENV selects (PRODUCTION=api.cashfree.com, else sandbox.cashfree.com)"
            : "";
    console.error(
        `Cashfree ${scope} failed: HTTP ${status ?? "?"} ${hint}`,
        typeof body === "string" ? body.slice(0, 400) : JSON.stringify(body)?.slice(0, 400),
        err instanceof Error ? err.message : err,
    );
}

/** Generic plan / period guard reused by every route. */
export function isBilledPlan(plan: string | undefined | null): plan is Plan {
    return !!plan && plan !== "free" && plan in PLAN_LIMITS;
}

/** True for the exact PlanPeriod values the checkout can produce. */
export function isPlanPeriod(period: string | undefined | null): period is PlanPeriod {
    return period === "monthly" || period === "annual" || period === "one_time";
}

/**
 * The charge for a plan/period, in paise, as recorded in the `payments` table
 * (the settings page renders `amount / 100`).
 * Annual is the monthly-equivalent annual price billed all 12 months upfront.
 */
export function planPeriodAmountPaise(plan: Plan, period: PlanPeriod): number {
    const p = PLAN_LIMITS[plan];
    return period === "annual" ? p.annualPrice * 12 : p.monthlyPrice;
}

/** The charge in rupees — Cashfree `order_amount` accepts rupees with up to two decimals. */
export function planPeriodAmountRupees(plan: Plan, period: PlanPeriod): number {
    return planPeriodAmountPaise(plan, period) / 100;
}

/**
 * One-time plans expire: a paid plan whose `plan_expires_at` has passed is
 * treated as Free everywhere (quota reads gate on this). Legacy paid rows
 * without an expiry stay active rather than locking existing payers out.
 */
export function isPlanExpired(profile: {
    plan?: string | null;
    plan_expires_at?: string | null;
}): boolean {
    if (!profile?.plan || profile.plan === "free") return false;
    if (!profile.plan_expires_at) return false;
    return new Date(profile.plan_expires_at).getTime() < Date.now();
}

/** Period end for a fresh purchase/renewal, computed identically everywhere. */
export function computePeriodEnd(period: PlanPeriod, from: Date = new Date()): Date {
    const end = new Date(from);
    if (period === "one_time" || period === "monthly") {
        // One-time purchases grant 30 days; monthly subscriptions grant a calendar month.
        if (period === "one_time") end.setDate(end.getDate() + 30);
        else end.setMonth(end.getMonth() + 1);
    } else {
        end.setFullYear(end.getFullYear() + 1);
    }
    return end;
}

/** Human label for a purchase/order note. */
export function orderNoteFor(planLabel: string, period: PlanPeriod): string {
    const periodLabel =
        period === "one_time" ? "One-time" : period === "annual" ? "Annual" : "Monthly";
    return `ClipMint ${planLabel} Plan — ${periodLabel}`;
}

class CashfreeNotConfiguredError extends Error {
    constructor() {
        super(
            "Cashfree is not configured. Set CASHFREE_APP_ID and CASHFREE_SECRET_KEY."
        );
        this.name = "CashfreeNotConfiguredError";
    }
}

let cachedClient: Cashfree | null = null;

/**
 * Lazily built singleton Cashfree client (v6). One instance, one pinned API version,
 * shared by create-order / verify-payment / webhook / cancel so they all talk the
 * same gateway environment.
 */
export function getCashfree(): Cashfree {
    if (cachedClient) return cachedClient;

    const appId = process.env.CASHFREE_APP_ID;
    const secretKey = process.env.CASHFREE_SECRET_KEY;
    if (!appId || !secretKey) {
        throw new CashfreeNotConfiguredError();
    }

    const environment =
        process.env.CASHFREE_ENV === "PRODUCTION"
            ? CFEnvironment.PRODUCTION
            : CFEnvironment.SANDBOX;

    const client = new Cashfree(environment, appId, secretKey);
    client.XApiVersion = CASHFREE_API_VERSION;
    cachedClient = client;
    return client;
}

/** Report which environment the integration is running against (for client + logs). */
export function isProductionEnvironment(): boolean {
    return process.env.CASHFREE_ENV === "PRODUCTION";
}

/**
 * Webhook event types arrive with a `_WEBHOOK` suffix (PAYMENT_SUCCESS_WEBHOOK).
 * Normalise away the suffix so the handler switches on stable base names; bare
 * names (e.g. from Cashfree DevStudio test samples) still match.
 */
export function normalizeWebhookEventType(rawType: string | undefined | null): string {
    if (!rawType) return "";
    return rawType.endsWith("_WEBHOOK") ? rawType.slice(0, -"_WEBHOOK".length) : rawType;
}

/**
 * Verify a Cashfree webhook signature, with replay protection.
 *
 * - The SDK's `PGVerifyWebhookSignature(timestamp + rawBody, client secret)` matches
 *   the default Dashboard setup (webhook secret == API secret key).
 * - If a dedicated `CASHFREE_WEBHOOK_SECRET` is configured (recommended), verify the
 *   same HMAC-SHA256 form against it instead.
 * - Timestamps older than `WEBHOOK_MAX_AGE_MS` are rejected so captured webhook
 *   payloads cannot be replayed.
 */
export function verifyCashfreeWebhook(
    signature: string,
    rawBody: string,
    timestamp: string
): boolean {
    if (!signature || !timestamp) return false;

    // Replay window — timestamps arrive as a unix timestamp (seconds or milliseconds).
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;
    const tsMs = ts > 1e12 ? ts : ts * 1000;
    if (Math.abs(Date.now() - tsMs) > WEBHOOK_MAX_AGE_MS) return false;

    const dedicatedSecret = process.env.CASHFREE_WEBHOOK_SECRET;
    if (dedicatedSecret) {
        const expected = crypto
            .createHmac("sha256", dedicatedSecret)
            .update(timestamp + rawBody)
            .digest("base64");
        return expected === signature;
    }

    try {
        getCashfree().PGVerifyWebhookSignature(signature, rawBody, timestamp);
        return true;
    } catch {
        return false;
    }
}