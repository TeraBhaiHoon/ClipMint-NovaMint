import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/server";

/**
 * GET /api/clips/[jobId]/links
 *
 * Mints short-lived signed URLs for a job's clips and thumbnails from the
 * PRIVATE `clip-outputs` bucket.
 *
 * Why this exists: finished clips are archived in Google Drive, which cannot
 * serve anonymous downloads (users hit "request access"). Storing public links
 * instead would let ANYONE with a URL download ANY user's clips. This route is
 * the privacy-preserving middle ground:
 *
 *   1. the caller must be signed in;
 *   2. the job must belong to that caller (checked server-side with the
 *      service client, so RLS can't be bypassed from the browser);
 *   3. only then are 1-hour signed URLs returned — they expire on their own
 *      and are never stored in the database.
 */

/** Signed-URL lifetime. Short on purpose: they are minted fresh per visit. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ jobId: string }> }
) {
    const { jobId } = await params;

    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createServiceClient();
    if (!admin) {
        return NextResponse.json(
            { error: "Storage is not configured." },
            { status: 500 }
        );
    }

    // ── Ownership check: the job must belong to the caller ──
    const { data: job, error: jobError } = await admin
        .from("jobs")
        .select("id, user_id")
        .eq("id", jobId)
        .single();

    if (jobError || !job || job.user_id !== user.id) {
        // Same response for "missing" and "someone else's" — a distinct 403
        // would confirm that the job id exists.
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const { data: clips } = await admin
        .from("clips")
        .select("id, storage_path, thumbnail_path")
        .eq("job_id", jobId);

    type LinkEntry = { url: string | null; thumbnailUrl: string | null };
    const links: Record<string, LinkEntry> = {};

    // Signed URLs are unique per call, so identical storage paths (every
    // variant of one clip shares its thumbnail) are signed once and reused.
    const signedCache = new Map<string, string | null>();

    const sign = async (path: string): Promise<string | null> => {
        if (signedCache.has(path)) return signedCache.get(path) ?? null;
        const { data, error } = await admin.storage
            .from("clip-outputs")
            .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        const url = !error && data?.signedUrl ? data.signedUrl : null;
        if (error) {
            console.error(`Could not sign ${path}:`, error.message);
        }
        signedCache.set(path, url);
        return url;
    };

    for (const clip of clips ?? []) {
        links[clip.id] = {
            url: clip.storage_path ? await sign(clip.storage_path) : null,
            thumbnailUrl: clip.thumbnail_path ? await sign(clip.thumbnail_path) : null,
        };
    }

    return NextResponse.json({ links });
}
