import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

/**
 * A `NextResponse.redirect()` drops the cookies that `supabaseResponse`
 * accumulated while refreshing the session, so a redirect here would send the
 * stale (or missing) auth cookie with it. Copy the refreshed cookies over.
 */
function copySessionCookies(from: NextResponse, to: NextResponse) {
    for (const { name, value, ...options } of from.cookies.getAll()) {
        to.cookies.set(name, value, options);
    }
}

export async function middleware(request: NextRequest) {
    let supabaseResponse = NextResponse.next({ request });

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) =>
                        request.cookies.set(name, value)
                    );
                    supabaseResponse = NextResponse.next({ request });
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    );
                },
            },
            cookieOptions: {
                // The auth-token cookie must stay httpOnly:false so the browser
                // client (@supabase/ssr createBrowserClient) can read it, but it
                // should still only travel over HTTPS in production.
                secure: process.env.NODE_ENV === "production",
            },
        }
    );

    // Refresh session and validate the JWT against Supabase (getUser(), not
    // getSession()) — this is also what makes email-confirmation sessions safe.
    let user: User | null = null;
    let sessionError: { code?: string; message?: string } | null = null;
    try {
        const result = await supabase.auth.getUser();
        user = result.data.user;
        sessionError = result.error;
    } catch {
        // Supabase unreachable or middleware hiccup: behave as "unknown", NOT
        // "logged out". Do not bounce a valid session to /login and do not
        // clear cookies — that would log everyone out during an outage.
    }

    // A revoked/rotated refresh token (logout elsewhere, stale cookie) makes
    // getUser() fail with a 400 refresh_token_* error. The browser is holding
    // a dead session: clear the stale auth cookies and send the user to login
    // once with a gentle message — never loop, never crash, never let the raw
    // 400 surface. /auth/* is excluded so an email-confirmation or recovery
    // code in the URL is never swallowed by this branch.
    const deadSession =
        !!sessionError &&
        (sessionError.code === "refresh_token_not_found" ||
            sessionError.code === "invalid_refresh_token" ||
            /refresh\s?token/i.test(sessionError.message ?? ""));
    if (
        deadSession &&
        sessionError &&
        request.nextUrl.pathname !== "/login" &&
        !request.nextUrl.pathname.startsWith("/auth/")
    ) {
        console.warn(
            `[auth] Session refresh failed (${sessionError.code ?? sessionError.message}) — clearing stale auth cookies for ${request.nextUrl.pathname}`
        );
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("error", "session_expired");
        if (request.nextUrl.pathname.startsWith("/dashboard")) {
            url.searchParams.set(
                "next",
                request.nextUrl.pathname + request.nextUrl.search
            );
        }
        const redirect = NextResponse.redirect(url);
        copySessionCookies(supabaseResponse, redirect);
        // Wipe every Supabase cookie (auth token + PKCE verifier) so the next
        // request carries no stale session at all.
        for (const { name } of request.cookies.getAll()) {
            if (name.startsWith("sb-")) {
                redirect.cookies.set(name, "", {
                    path: "/",
                    maxAge: 0,
                    secure: process.env.NODE_ENV === "production",
                });
            }
        }
        return redirect;
    }

    // Protected routes: redirect to /login if not authenticated, carrying the
    // requested destination so the login page can send the user straight back.
    if (
        !user &&
        request.nextUrl.pathname.startsWith("/dashboard")
    ) {
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set(
            "next",
            request.nextUrl.pathname + request.nextUrl.search
        );
        const redirect = NextResponse.redirect(url);
        copySessionCookies(supabaseResponse, redirect);
        return redirect;
    }

    // If logged in and visiting /login, redirect to /dashboard
    if (user && request.nextUrl.pathname === "/login") {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard";
        const redirect = NextResponse.redirect(url);
        copySessionCookies(supabaseResponse, redirect);
        return redirect;
    }

    return supabaseResponse;
}

export const config = {
    matcher: [
        // Match everything except Next.js internals, static files and all /api
        // routes. API routes authenticate themselves (session cookie, webhook
        // secret or cron secret) and must not be gated by the browser-session
        // middleware — the GitHub-called webhook in particular has no session.
        "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    ],
};
