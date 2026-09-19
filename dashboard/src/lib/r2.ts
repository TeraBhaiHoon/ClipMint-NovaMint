/**
 * ClipMint — Cloudflare R2 delivery-cache client.
 *
 * Architecture (owner decision, 2026-09-19): Google Drive is the permanent
 * archive; R2 is ONLY a short-lived delivery cache (bucket lifecycle rules
 * evict `delivery/` after 1 day and `sources/` after 7). Nothing accumulates
 * in Supabase Storage.
 *
 * All calls are no-throw wrappers: on any failure they log and return
 * null/false so a route can degrade gracefully instead of 500-ing a job page.
 *
 * Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_DELIVERY_BUCKET
 */
import { AwsClient } from "aws4fetch";

const R2_ACCOUNT_ID = (process.env.R2_ACCOUNT_ID || "").trim();
const R2_ACCESS_KEY_ID = (process.env.R2_ACCESS_KEY_ID || "").trim();
const R2_SECRET_ACCESS_KEY = (process.env.R2_SECRET_ACCESS_KEY || "").trim();
const R2_BUCKET = (process.env.R2_DELIVERY_BUCKET || "").trim();

const TTL_MIN = 60;
/** S3 presigned URLs cannot exceed 7 days. */
const TTL_MAX = 60 * 60 * 24 * 7;

export function r2Configured(): boolean {
    return Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
}

function r2Client(): AwsClient {
    // aws4fetch takes a single credentials object.
    return new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY });
}

/** Path-style object URL (R2 supports it; no bucket-name DNS constraints). */
function objectUrl(key: string): string {
    const path = key.split("/").map(encodeURIComponent).join("/");
    return `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${path}`;
}

function dispositionHeader(type: "attachment" | "inline", filename?: string): string {
    const safe = (filename || "clip.mp4")
        .replace(/[^\x20-\x7e]/g, "_")
        .replace(/["\\]/g, "_");
    return `${type}; filename="${safe}"`;
}

/** Does the object exist in the cache right now? */
export async function r2Head(key: string): Promise<boolean> {
    if (!r2Configured() || !key) return false;
    try {
        const res = await r2Client().fetch(objectUrl(key), { method: "HEAD" });
        return res.ok;
    } catch (err) {
        console.error(`r2 head failed (${key}):`, err instanceof Error ? err.message : err);
        return false;
    }
}

/** Upload bytes to the cache (used by the Drive re-materialisation path). */
export async function r2Put(key: string, body: ArrayBuffer, contentType: string): Promise<boolean> {
    if (!r2Configured() || !key) return false;
    try {
        const res = await r2Client().fetch(objectUrl(key), {
            method: "PUT",
            body,
            headers: { "Content-Type": contentType },
        });
        if (!res.ok) {
            console.error(`r2 put failed (${key}): HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        }
        return res.ok;
    } catch (err) {
        console.error(`r2 put threw (${key}):`, err instanceof Error ? err.message : err);
        return false;
    }
}

/** Remove an object (source cleanup after a successful job). 404 counts as gone. */
export async function r2Delete(key: string): Promise<boolean> {
    if (!r2Configured() || !key) return false;
    try {
        const res = await r2Client().fetch(objectUrl(key), { method: "DELETE" });
        return res.ok || res.status === 404;
    } catch (err) {
        console.error(`r2 delete failed (${key}):`, err instanceof Error ? err.message : err);
        return false;
    }
}

/**
 * Mint a presigned URL. `disposition` controls the Content-Disposition the
 * browser sees (attachment forces a download; inline lets <video> play it).
 */
export async function r2Presign(
    method: "GET" | "PUT",
    key: string,
    ttlSeconds: number,
    disposition?: { type: "attachment" | "inline"; filename?: string }
): Promise<string | null> {
    if (!r2Configured() || !key) return null;
    const ttl = Math.min(Math.max(ttlSeconds, TTL_MIN), TTL_MAX);
    try {
        // Presigned-URL extras MUST live in the query string BEFORE signing:
        // aws4fetch (like SigV4 itself) signs whatever is already in the URL's
        // searchParams and adds the auth params alongside them. Passing them
        // as headers instead signs headers the consumer never sends, which
        // yields a SignatureDoesNotMatch on download.
        const target = new URL(objectUrl(key));
        target.searchParams.set("X-Amz-Expires", String(ttl));
        if (disposition) {
            target.searchParams.set(
                "response-content-disposition",
                dispositionHeader(disposition.type, disposition.filename)
            );
        }
        const signed = await r2Client().sign(new Request(target, { method }), {
            aws: { signQuery: true },
        });
        return signed.url;
    } catch (err) {
        console.error(`r2 presign failed (${method} ${key}):`, err instanceof Error ? err.message : err);
        return null;
    }
}

export async function r2PresignGet(
    key: string,
    ttlSeconds: number,
    disposition?: { type: "attachment" | "inline"; filename?: string }
): Promise<string | null> {
    return r2Presign("GET", key, ttlSeconds, disposition);
}

export async function r2PresignPut(key: string, ttlSeconds: number): Promise<string | null> {
    return r2Presign("PUT", key, ttlSeconds);
}
