import { createClient } from "@/lib/server";
import { NextResponse } from "next/server";

/**
 * Only allow same-site absolute paths so a crafted `?next=` cannot turn this
 * route into an open redirect.
 */
function safeNextPath(next: string | null): string {
    if (next && next.startsWith("/") && !next.startsWith("//")) {
        return next;
    }
    return "/dashboard";
}

function buildLoginUrl(
    origin: string,
    {
        error,
        next,
    }: { error: string; next: string | null }
) {
    const url = new URL(`${origin}/login`);
    url.searchParams.set("error", error);
    if (next) url.searchParams.set("next", next);
    return url;
}

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get("code");
    const next = searchParams.get("next");
    const type = searchParams.get("type");

    // OAuth / email-link failure surfaced by Supabase (e.g. the user denied
    // Google, or clicked a stale/invalidated link). Map it to the code the
    // login page turns into a friendly message.
    const oauthError = searchParams.get("error");
    if (oauthError) {
        const mapped =
            oauthError === "access_denied" || oauthError === "invalid_request"
                ? "oauth_cancelled"
                : "auth";
        return NextResponse.redirect(
            buildLoginUrl(origin, { error: mapped, next })
        );
    }

    if (code) {
        const supabase = await createClient();
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
            // A password-recovery link must land on the update-password page,
            // never the dashboard — the user still has to set a new password.
            if (type === "recovery") {
                return NextResponse.redirect(`${origin}/auth/update-password`);
            }
            return NextResponse.redirect(`${origin}${safeNextPath(next)}`);
        }
        console.error("auth callback exchange error:", error.message);
    }

    // Return to login on error, preserving the intended destination.
    return NextResponse.redirect(
        buildLoginUrl(origin, { error: "auth", next })
    );
}