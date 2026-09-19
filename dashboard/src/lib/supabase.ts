import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookieOptions: {
                // Session cookie must stay readable by the browser client
                // (httpOnly:false is @supabase/ssr's default), but it should only
                // travel over HTTPS in production.
                secure: process.env.NODE_ENV === "production",
            },
        }
    );
}
