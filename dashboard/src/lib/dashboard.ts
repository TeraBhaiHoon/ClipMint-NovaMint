import type { CaptionStyle, Clip, Job, JobStatus } from "./types";

export const RUNNING_STATUSES: JobStatus[] = ["queued", "downloading", "transcribing", "analyzing", "clipping", "captioning", "uploading"];

export function isJobRunning(status: JobStatus): boolean {
    return RUNNING_STATUSES.includes(status);
}

export function boundedPercent(value: number | null | undefined, total = 100): number {
    if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round(((value ?? 0) / total) * 100)));
}

export function availableClipRequest(requested: number, remaining: number | null): number {
    const amount = Number.isFinite(requested) ? Math.min(20, Math.max(1, Math.floor(requested))) : 1;
    return remaining === null ? amount : Math.min(amount, Math.max(0, Math.floor(remaining)));
}

export function videoTitle(job: Pick<Job, "source_title" | "video_filename" | "video_url" | "id">): string {
    return job.source_title?.trim() || job.video_filename?.trim() || job.video_url?.trim() || `Video ${job.id.slice(0, 8)}`;
}

export function sourceLabel(job: Pick<Job, "source_type" | "video_url">): string {
    if (job.source_type === "upload") return "Uploaded video";
    if (job.source_type === "drive") return "Google Drive";
    try {
        const hostname = new URL(job.video_url || "").hostname.replace(/^www\./, "");
        if (hostname === "youtu.be" || hostname === "youtube.com" || hostname.endsWith(".youtube.com")) return "YouTube";
        if (hostname === "drive.google.com") return "Google Drive";
        return hostname || "Video link";
    } catch {
        return "Video link";
    }
}

export function formatDate(value: string | null | undefined, includeTime = false): string {
    if (!value || !Number.isFinite(new Date(value).getTime())) return "—";
    return new Date(value).toLocaleDateString("en-IN", {
        day: "numeric", month: "short", year: "numeric",
        ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
}

export function formatDuration(seconds: number | null | undefined): string {
    if (!seconds || !Number.isFinite(seconds) || seconds < 0) return "—";
    const rounded = Math.round(seconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const remainder = rounded % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function clipSeconds(clip: Pick<Clip, "duration_seconds" | "start_time" | "end_time">): number | null {
    if (clip.duration_seconds && clip.duration_seconds > 0) return clip.duration_seconds;
    if (typeof clip.start_time === "number" && typeof clip.end_time === "number" && clip.end_time > clip.start_time) return clip.end_time - clip.start_time;
    return null;
}

export function captionText(clip: Pick<Clip, "title" | "hook_caption" | "hashtags">): string {
    return [clip.title, clip.hook_caption, clip.hashtags?.join(" ")].filter((part) => part?.trim()).join("\n\n");
}

export function localDateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function periodStart(days: number, now = new Date()): Date {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (days - 1));
    return date;
}

export function dailyCounts(clips: Pick<Clip, "created_at">[], days: number, now = new Date()) {
    const counts = new Map<string, number>();
    clips.forEach((clip) => {
        const key = localDateKey(new Date(clip.created_at));
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from({ length: days }, (_, index) => {
        const date = periodStart(days - index, now);
        return {
            key: localDateKey(date),
            label: date.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
            day: date.getDate(),
            count: counts.get(localDateKey(date)) || 0,
        };
    });
}

export function captionPreferenceKey(userId: string): string {
    return `clipmint:${userId}:caption-style`;
}

export function readCaptionPreference(userId: string): CaptionStyle {
    try {
        const saved = localStorage.getItem(captionPreferenceKey(userId));
        if (["hormozi", "bounce", "fade", "glow", "typewriter", "glitch", "neon", "colorful", "minimal"].includes(saved || "")) return saved as CaptionStyle;
    } catch {
        // Storage may be unavailable in a private browsing session.
    }
    return "hormozi";
}
