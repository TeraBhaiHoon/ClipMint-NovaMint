import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function createClient() {
    const cookieStore = await cookies();

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        );
                    } catch {
                        // The `setAll` method was called from a Server Component.
                        // This can be ignored if you have middleware refreshing
                        // user sessions.
                    }
                },
            },
            cookieOptions: {
                // The auth-token cookie must stay httpOnly:false so the browser
                // client can read it, but it should only travel over HTTPS.
                secure: process.env.NODE_ENV === "production",
            },
        }
    );
}

/**
 * Service-role client for server-only work (quota counters, cross-user reads).
 * Returns `null` when SUPABASE_SERVICE_ROLE_KEY is not configured so callers can
 * degrade gracefully instead of throwing.
 */
export function createServiceClient(): SupabaseClient | null {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return null;

    return createAdminClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}
