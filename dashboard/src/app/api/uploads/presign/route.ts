import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/server";
import { r2Configured, r2PresignPut } from "@/lib/r2";

/**
 * POST /api/uploads/presign
 *
 * Mints a presigned PUT URL so the browser uploads a source video DIRECTLY to
 * the private R2 cache (browser → R2, never through this server — Vercel
 * functions have a small request-body limit, so proxying is not an option).
 *
 * The key is server-generated (`sources/{user.id}/{timestamp}.{ext}`) so the
 * client can never write outside its own folder. The bucket's lifecycle rule
 * deletes `sources/` after 7 days; the pipeline deletes the object itself as
 * soon as the job succeeds.
 */

const MAX_UPLOAD_BYTES = 45 * 1024 * 1024; // mirrors the client-side cap
const ALLOWED_EXTENSIONS = ["mp4", "mov", "m4v", "webm"];
const PUT_TTL_SECONDS = 60 * 60; // uploads start immediately after this call

export async function POST(request: NextRequest) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!r2Configured()) {
        return NextResponse.json(
            { error: "Video uploads are not configured yet. Please paste a video link instead." },
            { status: 503 }
        );
    }

    const body = await request.json().catch(() => ({}));
    const filename = typeof body?.filename === "string" ? body.filename : "";
    const size = Number(body?.size);

    const ext = (filename.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return NextResponse.json(
            { error: "Only MP4, MOV, M4V or WebM files are supported." },
            { status: 400 }
        );
    }
    if (!Number.isFinite(size) || size <= 0) {
        return NextResponse.json({ error: "Missing file size." }, { status: 400 });
    }
    if (size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
            { error: "That video is over the 45 MB upload limit. Paste a YouTube/Drive link instead." },
            { status: 413 }
        );
    }

    const key = `sources/${user.id}/${Date.now()}.${ext}`;
    const url = await r2PresignPut(key, PUT_TTL_SECONDS);
    if (!url) {
        return NextResponse.json({ error: "Could not start the upload. Please try again." }, { status: 500 });
    }

    return NextResponse.json({ key, url, expiresIn: PUT_TTL_SECONDS });
}
