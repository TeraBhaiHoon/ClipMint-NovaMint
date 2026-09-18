/**
 * ClipMint — video URL validation & normalisation.
 *
 * The stored `jobs.video_url` is forwarded to a GitHub Actions
 * `workflow_dispatch` input, which the pipeline interpolates into a shell
 * command. A crafted URL (`$(...)`, backticks, …) could therefore execute on
 * the CI runner, so every URL must be checked before it is stored/dispatched.
 *
 * This module is intentionally free of any Next.js/Supabase import so it can be
 * unit-tested in isolation (and mirrored by the Cloudflare Worker, which cannot
 * import from the Next.js tree — see `api-gateway/src/index.ts`).
 */

export type VideoProvider =
    | "youtube"
    | "instagram"
    | "facebook"
    | "drive"
    | "vimeo"
    | "direct";

export interface UrlValidationOk {
    ok: true;
    /** Normalised URL (tracking params stripped) — safe to store and dispatch. */
    url: string;
    provider: VideoProvider;
}

export interface UrlValidationFailure {
    ok: false;
    /** Human-readable reason, safe to show inline in the UI. */
    reason: string;
}

export type UrlValidationResult = UrlValidationOk | UrlValidationFailure;

/** Hard cap — longer values are never legitimate video links. */
export const MAX_URL_LENGTH = 2048;

/**
 * Hosts we accept for URL imports. Anything else must look like a direct media
 * file (see `DIRECT_MEDIA_EXTENSIONS`) or it is rejected.
 */
const PROVIDER_HOSTS: Record<string, VideoProvider> = {
    "youtube.com": "youtube",
    "www.youtube.com": "youtube",
    "m.youtube.com": "youtube",
    "music.youtube.com": "youtube",
    "youtu.be": "youtube",
    "instagram.com": "instagram",
    "www.instagram.com": "instagram",
    "facebook.com": "facebook",
    "www.facebook.com": "facebook",
    "m.facebook.com": "facebook",
    "fb.watch": "facebook",
    "drive.google.com": "drive",
    "vimeo.com": "vimeo",
};

/** Direct file links are accepted from any host when the path ends in one of these. */
const DIRECT_MEDIA_EXTENSIONS = /\.(mp4|mov|m4v|webm)$/;

/**
 * Characters rejected outright.
 *
 * This list is deliberately NARROW. An earlier version also banned `& ; | > <
 * ( ) ' "`, which rejected perfectly ordinary links such as
 * `https://youtube.com/watch?v=ID&list=PL…` and
 * `https://facebook.com/watch/?v=1&ref=share` — a real usability bug.
 *
 * Those characters are only dangerous when a value is pasted into a shell
 * command, and that no longer happens: the pipeline now passes the URL through
 * the environment (`env: VIDEO_URL: ${{ inputs.video_url }}` used as
 * `"$VIDEO_URL"`) instead of interpolating it into a script, so the shell never
 * re-parses it. What remains here is the set that is never legitimate in a URL
 * anyway (whitespace, control characters) plus the three that could break out of
 * a quoted string in any future caller that regresses: backtick, `$`, `\`.
 */
// eslint-disable-next-line no-control-regex
const SHELL_UNSAFE = /[`$\\\s\u0000-\u001f]/;

/** Query params that only carry tracking/analytics data. */
const TRACKING_PARAMS = new Set([
    "si",
    "fbclid",
    "igshid",
    "igsh",
    "feature",
    "ref",
    "ref_src",
    "_r",
]);

/** Params that are functionally required and must never be stripped. */
const KEEP_PARAMS = new Set(["v", "list", "start", "id"]);

/** Human-readable label for an offending character. */
function describeUnsafeChar(char: string): string {
    if (/\s/.test(char)) return "space or line break";
    if (char === "\\") return "backslash";
    if (char === '"') return "double quote";
    if (char === "'") return "single quote";
    return char;
}

/**
 * Strip tracking/analytics query params from a video URL while preserving the
 * functional ones (`v`, `list`, `start`, `id`).
 *
 * `t` is only stripped for YouTube links (there it is the no-op "start at"
 * tracker; elsewhere it may be meaningful). Returns the input trimmed if it
 * cannot be parsed — callers should validate first.
 */
export function normalizeVideoUrl(raw: string): string {
    const trimmed = raw.trim();
    try {
        const parsed = new URL(trimmed);
        const isYouTube = PROVIDER_HOSTS[parsed.hostname.toLowerCase()] === "youtube";

        for (const key of Array.from(parsed.searchParams.keys())) {
            const lower = key.toLowerCase();
            if (KEEP_PARAMS.has(lower)) continue;
            if (
                TRACKING_PARAMS.has(lower) ||
                lower.startsWith("utm_") ||
                (isYouTube && lower === "t")
            ) {
                parsed.searchParams.delete(key);
            }
        }

        return parsed.toString();
    } catch {
        return trimmed;
    }
}

/**
 * Validate a user-supplied video URL.
 *
 * Decision on protocols: **https only** — including for direct media files.
 * The pipeline downloads over the network on a CI runner, so plaintext http is
 * rejected even when the path ends in `.mp4`.
 *
 * Returns the *normalised* URL on success so callers can store it directly.
 */
export function validateVideoUrl(raw: unknown): UrlValidationResult {
    if (typeof raw !== "string" || !raw.trim()) {
        return { ok: false, reason: "Please paste a video URL." };
    }

    const trimmed = raw.trim();

    if (trimmed.length > MAX_URL_LENGTH) {
        return {
            ok: false,
            reason: `That URL is too long (max ${MAX_URL_LENGTH} characters).`,
        };
    }

    const unsafe = trimmed.match(SHELL_UNSAFE);
    if (unsafe) {
        return {
            ok: false,
            reason: `That URL contains an unsupported character (${describeUnsafeChar(unsafe[0])}). Copy the link straight from your browser and paste it again.`,
        };
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return {
            ok: false,
            reason: "That doesn't look like a link. Paste the full video URL starting with https://",
        };
    }

    if (parsed.protocol !== "https:") {
        return {
            ok: false,
            reason: "Only https:// links are supported. Copy the https link from your browser.",
        };
    }

    const host = parsed.hostname.toLowerCase();
    let provider = PROVIDER_HOSTS[host];

    if (!provider && DIRECT_MEDIA_EXTENSIONS.test(parsed.pathname.toLowerCase())) {
        provider = "direct";
    }

    if (!provider) {
        return {
            ok: false,
            reason:
                "That link isn't a supported video source. Paste a YouTube, Instagram, Facebook, Vimeo or Google Drive link, or a direct .mp4/.mov/.m4v/.webm file URL.",
        };
    }

    return { ok: true, url: normalizeVideoUrl(trimmed), provider };
}
