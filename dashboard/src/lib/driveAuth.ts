/**
 * ClipMint — Google Drive access for the re-materialisation path.
 *
 * When a clip has fallen out of the 24-hour R2 cache, the download route
 * re-pulls the single file from the Drive archive. This module derives the
 * Google credential from whichever the owner configured — no new Google
 * console setup is required:
 *
 *   1. GOOGLE_SERVICE_ACCOUNT_JSON_B64 — a service-account JSON (base64).
 *   2. RCLONE_CONF_B64 — the SAME rclone config the pipeline already uses,
 *      base64. We parse out either an inline service-account or the OAuth
 *      client_id/client_secret/refresh_token and mint access tokens.
 *
 * Tokens are cached in module scope until shortly before expiry.
 */
import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

type DriveCreds =
    | { kind: "sa"; clientEmail: string; privateKey: string }
    | { kind: "oauth"; clientId: string; clientSecret: string; refreshToken: string };

let cachedToken: { token: string; expiresAt: number } | null = null;
let cachedCreds: DriveCreds | null | undefined; // undefined = not parsed yet

function b64decode(value: string | undefined): string {
    if (!value) return "";
    return Buffer.from(value, "base64").toString("utf8");
}

/** Parse an rclone INI: returns the fields of the first `type = drive` remote. */
export function parseRcloneDriveRemote(confText: string): Record<string, string> | null {
    const sections: Record<string, Record<string, string>> = {};
    let current: string | null = null;
    for (const rawLine of confText.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || line.startsWith(";")) continue;
        const section = line.match(/^\[(.+)\]$/);
        if (section) {
            current = section[1];
            sections[current] = {};
            continue;
        }
        if (!current) continue;
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        sections[current][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    const drive = Object.values(sections).find((f) => (f.type || "").toLowerCase() === "drive");
    return drive ?? null;
}

function loadDriveCreds(): DriveCreds | null {
    if (cachedCreds !== undefined) return cachedCreds;

    const saJson = b64decode(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64).trim();
    if (saJson) {
        try {
            const parsed = JSON.parse(saJson) as { client_email?: string; private_key?: string };
            if (parsed.client_email && parsed.private_key) {
                cachedCreds = {
                    kind: "sa",
                    clientEmail: parsed.client_email,
                    privateKey: parsed.private_key.replace(/\\n/g, "\n"),
                };
                return cachedCreds;
            }
        } catch (err) {
            console.error("GOOGLE_SERVICE_ACCOUNT_JSON_B64 is not valid JSON:", err instanceof Error ? err.message : err);
        }
    }

    const conf = b64decode(process.env.RCLONE_CONF_B64).trim();
    if (conf) {
        const remote = parseRcloneDriveRemote(conf);
        if (remote) {
            if ((remote.service_account_credentials || "").trim()) {
                try {
                    const sa = JSON.parse(remote.service_account_credentials) as { client_email?: string; private_key?: string };
                    if (sa.client_email && sa.private_key) {
                        cachedCreds = {
                            kind: "sa",
                            clientEmail: sa.client_email,
                            privateKey: sa.private_key.replace(/\\n/g, "\n"),
                        };
                        return cachedCreds;
                    }
                } catch (err) {
                    console.error("rclone service_account_credentials is not valid JSON:", err instanceof Error ? err.message : err);
                }
            }
            if (remote.client_id && remote.client_secret && remote.token) {
                try {
                    const token = JSON.parse(remote.token) as { refresh_token?: string };
                    if (token.refresh_token) {
                        cachedCreds = {
                            kind: "oauth",
                            clientId: remote.client_id,
                            clientSecret: remote.client_secret,
                            refreshToken: token.refresh_token,
                        };
                        return cachedCreds;
                    }
                } catch {
                    // token line not JSON — fall through
                }
            }
        }
    }

    cachedCreds = null;
    return null;
}

export function driveRecoveryConfigured(): boolean {
    return loadDriveCreds() !== null;
}

async function mintAccessToken(creds: DriveCreds): Promise<string | null> {
    if (creds.kind === "sa") {
        const b64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");
        const now = Math.floor(Date.now() / 1000);
        const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
        const claims = b64url(JSON.stringify({
            iss: creds.clientEmail,
            scope: DRIVE_SCOPE,
            aud: TOKEN_URL,
            iat: now,
            exp: now + 3600,
        }));
        const signer = createSign("RSA-SHA256");
        signer.update(`${header}.${claims}`);
        const assertion = `${header}.${claims}.${b64url(signer.sign(creds.privateKey))}`;
        const res = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                assertion,
            }),
        });
        if (!res.ok) {
            console.error("Google SA token exchange failed:", res.status, (await res.text()).slice(0, 200));
            return null;
        }
        const data = (await res.json()) as { access_token?: string; expires_in?: number };
        if (!data.access_token) return null;
        cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
        return cachedToken.token;
    }

    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            refresh_token: creds.refreshToken,
            grant_type: "refresh_token",
        }),
    });
    if (!res.ok) {
        console.error("Google refresh-token exchange failed:", res.status, (await res.text()).slice(0, 200));
        return null;
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return cachedToken.token;
}

async function getAccessToken(): Promise<string | null> {
    if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
        return cachedToken.token;
    }
    const creds = loadDriveCreds();
    if (!creds) return null;
    return mintAccessToken(creds);
}

/**
 * Download one file from the Drive archive by file id. Returns null on any
 * failure or when the file exceeds maxBytes (protects the serverless function).
 */
export async function driveDownloadFile(fileId: string, maxBytes: number): Promise<ArrayBuffer | null> {
    const token = await getAccessToken();
    if (!token) return null;
    try {
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) {
            console.error(`Drive fetch failed for ${fileId}: HTTP ${res.status}`);
            return null;
        }
        const len = Number(res.headers.get("content-length") || 0);
        if (len > maxBytes) {
            console.error(`Drive file ${fileId} too large for recovery: ${len} bytes`);
            return null;
        }
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > maxBytes) {
            console.error(`Drive file ${fileId} too large for recovery: ${buffer.byteLength} bytes`);
            return null;
        }
        return buffer;
    } catch (err) {
        console.error(`Drive fetch threw for ${fileId}:`, err instanceof Error ? err.message : err);
        return null;
    }
}
