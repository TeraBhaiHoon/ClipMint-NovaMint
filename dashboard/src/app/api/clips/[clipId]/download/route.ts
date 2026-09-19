import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/server";
import { r2Configured, r2Head, r2Put, r2PresignGet } from "@/lib/r2";
import { driveDownloadFile } from "@/lib/driveAuth";

/**
 * GET /api/clips/[clipId]/download[?kind=video|thumb][&inline=1]
 *
 * THE download path — and the re-materialiser.
 *
 * Architecture (owner decision, 2026-09-19): Drive is the permanent archive,
 * R2 is a 24-hour delivery cache (bucket lifecycle evicts `delivery/` after
 * one day). When a user clicks Download:
 *
 *   1. clip still in R2  → 302 straight to a presigned URL (instant);
 *   2. clip evicted      → pull that ONE file back from the Drive archive,
 *                          re-cache it in R2, then 302 to a fresh presigned
 *                          URL. "Click again → new temporary link", exactly.
 *
 * Every request re-checks ownership server-side (clip → job → user), so a
 * signed URL is minted ONLY for the clip's owner. Legacy rows without
 * storage_path (pre-R2 jobs) answer 404 — the dashboard falls back to their
 * archived Drive links.
 */

export const maxDuration = 60;

/** Refuse to buffer absurd files into a serverless function. */
const MAX_RECOVERY_BYTES = 300 * 1024 * 1024;

const SIGNED_TTL_SECONDS = 60 * 60;

function driveRecoveryAvailable(): boolean {
    // We want the clearer 503 message before attempting a Drive download.
    return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 || process.env.RCLONE_CONF_B64);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
    const { clipId } = await params;
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") === "thumb" ? "thumb" : "video";
    const inline = url.searchParams.get("inline") === "1";

    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return new NextResponse("Unauthorized", { status: 401 });
    }
    if (!r2Configured()) {
        return new NextResponse("Downloads are not configured yet. Please contact support.", { status: 503 });
    }

    const admin = createServiceClient();
    if (!admin) {
        return new NextResponse("Server storage configuration error.", { status: 500 });
    }

    // ── Ownership: clip → job → user, checked server-side ──
    const { data: clip } = await admin
        .from("clips")
        .select("id, job_id, filename, storage_path, thumbnail_path, drive_file_id")
        .eq("id", clipId)
        .single();

    if (!clip) {
        return new NextResponse("Not found", { status: 404 });
    }
    const { data: job } = await admin
        .from("jobs")
        .select("user_id")
        .eq("id", clip.job_id)
        .single();

    if (!job || job.user_id !== user.id) {
        // Same response for missing and someone else's — no existence leak.
        return new NextResponse("Not found", { status: 404 });
    }

    const key = kind === "thumb" ? clip.thumbnail_path : clip.storage_path;
    if (!key) {
        return new NextResponse("This clip predates private delivery and has no cache entry.", { status: 404 });
    }

    const filename = kind === "thumb"
        ? `${(clip.filename || "clip").replace(/\.mp4$/i, "")}_thumb.jpg`
        : clip.filename || "clip.mp4";
    const contentType = kind === "thumb" ? "image/jpeg" : "video/mp4";

    // ── Fast path: still in the cache ──
    if (await r2Head(key)) {
        return redirectToSigned(key, inline, filename, kind);
    }

    // ── Cache miss: re-materialise this one file from the Drive archive ──
    const driveFileId = kind === "thumb"
        ? (clip as { thumbnail_drive_id?: string | null }).thumbnail_drive_id
        : clip.drive_file_id;
    if (!driveFileId) {
        return new NextResponse("The archive reference for this clip is missing. Please contact support.", { status: 404 });
    }
    if (!driveRecoveryAvailable()) {
        return new NextResponse("Archive recovery is not configured. Please contact support.", { status: 503 });
    }

    const bytes = await driveDownloadFile(driveFileId, MAX_RECOVERY_BYTES);
    if (!bytes) {
        return new NextResponse("Could not restore this clip from the archive. Please try again.", { status: 502 });
    }
    const cached = await r2Put(key, bytes, contentType);
    if (!cached) {
        return new NextResponse("Could not prepare this clip for download. Please try again.", { status: 502 });
    }

    return redirectToSigned(key, inline, filename, kind);
}

async function redirectToSigned(
    key: string,
    inline: boolean,
    filename: string,
    kind: string
): Promise<NextResponse> {
    const signed = await r2PresignGet(key, SIGNED_TTL_SECONDS, {
        type: inline ? "inline" : "attachment",
        filename,
    });
    if (!signed) {
        return new NextResponse("Could not sign the download link. Please try again.", { status: 502 });
    }
    // The 302 must never be cached: after the R2 lifecycle evicts the object,
    // a cached redirect would point at a dead URL.
    return new NextResponse(null, {
        status: 302,
        headers: { Location: signed, "Cache-Control": "private, no-store" },
    });
}
