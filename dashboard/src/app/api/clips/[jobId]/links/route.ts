import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/server";
import { r2Configured, r2Head, r2Put, r2PresignGet } from "@/lib/r2";
import { driveDownloadFile } from "@/lib/driveAuth";

/**
 * GET /api/clips/[jobId]/links
 *
 * Signed thumbnail URLs for the job page grid — minted fresh per visit and
 * never stored. Videos do NOT flow through here: their download button hits
 * /api/clips/[clipId]/download, which re-checks ownership and re-materialises
 * from the Drive archive when the 24-hour R2 cache has evicted the clip.
 *
 * Thumbnails are tiny (~50 KB), so if one has been evicted this route
 * re-materialises it inline — cheap even for a whole grid.
 */

const SIGNED_TTL_SECONDS = 60 * 60;
const MAX_THUMB_BYTES = 5 * 1024 * 1024;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
    const { jobId } = await params;

    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!r2Configured()) {
        return NextResponse.json({ links: {} });
    }

    const admin = createServiceClient();
    if (!admin) {
        return NextResponse.json({ error: "Storage is not configured." }, { status: 500 });
    }

    // ── Ownership: the job must belong to the caller ──
    const { data: job } = await admin
        .from("jobs")
        .select("id, user_id")
        .eq("id", jobId)
        .single();

    if (!job || job.user_id !== user.id) {
        // Same response for missing and someone else's — no existence leak.
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const { data: clips } = await admin
        .from("clips")
        .select("id, thumbnail_path, thumbnail_drive_id")
        .eq("job_id", jobId);

    const links: Record<string, { thumbnailUrl: string | null }> = {};

    for (const clip of clips ?? []) {
        let thumbnailUrl: string | null = null;
        if (clip.thumbnail_path) {
            if (await r2Head(clip.thumbnail_path)) {
                thumbnailUrl = await r2PresignGet(clip.thumbnail_path, SIGNED_TTL_SECONDS, {
                    type: "inline",
                });
            } else if (clip.thumbnail_drive_id) {
                // Evicted after 24h — restore this thumbnail from the archive.
                const bytes = await driveDownloadFile(clip.thumbnail_drive_id, MAX_THUMB_BYTES);
                if (bytes && (await r2Put(clip.thumbnail_path, bytes, "image/jpeg"))) {
                    thumbnailUrl = await r2PresignGet(clip.thumbnail_path, SIGNED_TTL_SECONDS, {
                        type: "inline",
                    });
                }
            }
        }
        links[clip.id] = { thumbnailUrl };
    }

    return NextResponse.json({ links });
}
