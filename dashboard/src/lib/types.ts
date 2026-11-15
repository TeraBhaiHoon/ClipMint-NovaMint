/** ClipMint shared TypeScript types */

export type Plan = "free" | "creator" | "pro" | "agency";

export type CaptionStyle =
    | "hormozi"
    | "bounce"
    | "fade"
    | "glow"
    | "typewriter"
    | "glitch"
    | "neon"
    | "colorful"
    | "minimal";

export type SourceLanguage = "auto" | "hi" | "en";
export type CaptionLanguage = "original" | "hinglish" | "en";
export type CaptionPace = "fast" | "balanced" | "slow";

export const SOURCE_LANGUAGES: { value: SourceLanguage; label: string; description: string }[] = [
    { value: "auto", label: "Auto-detect", description: "Recognize each audio section without forcing English." },
    { value: "hi", label: "Hindi / Hinglish", description: "Hindi speech, including Hindi mixed with English." },
    { value: "en", label: "English", description: "Use when the speaker is speaking English." },
];
export const CAPTION_LANGUAGES: { value: CaptionLanguage; label: string; description: string }[] = [
    { value: "original", label: "Original language", description: "Keep what was spoken. Hindi stays in देवनागरी." },
    { value: "hinglish", label: "Hinglish", description: "Write Hindi in Latin letters, without translating it." },
    { value: "en", label: "English translation", description: "Translate phrases to English. Translation timing is estimated." },
];

export type JobStatus =
    | "queued"
    | "downloading"
    | "transcribing"
    | "analyzing"
    | "clipping"
    | "captioning"
    | "uploading"
    | "done"
    | "failed"
    | "cancelled";

export type ClipStatus = "ready" | "scheduled" | "published" | "failed";

export type SubscriptionStatus = "none" | "created" | "active" | "paused" | "cancelled" | "expired";
export type PlanPeriod = "monthly" | "annual" | "one_time";

export interface Profile {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
    plan: Plan;
    clips_used: number;
    clips_limit: number;
    videos_used: number;
    videos_limit: number;
    clips_reserved?: number;
    usage_period_start?: string;
    notify_email: boolean;
    notify_discord: boolean;
    notify_job_complete: boolean;
    notify_job_failed: boolean;
    notify_weekly_report: boolean;
    discord_webhook_url: string | null;
    user_webhook_url: string | null;
    notify_webhook: boolean;
    cashfree_customer_id: string | null;
    cashfree_subscription_id: string | null;
    cashfree_order_id: string | null;
    subscription_status: SubscriptionStatus;
    plan_period: PlanPeriod;
    current_period_end: string | null;
    created_at: string;
    updated_at: string;
}

export interface Payment {
    id: string;
    user_id: string;
    cashfree_order_id: string;
    cashfree_payment_id: string | null;
    cf_payment_id: string | null;
    amount: number;
    currency: string;
    plan: Plan;
    plan_period: PlanPeriod;
    status: "created" | "captured" | "failed" | "refunded";
    created_at: string;
}

export interface Job {
    id: string;
    user_id: string;
    video_url: string | null;
    video_filename: string | null;
    video_duration_seconds: number | null;
    source_type: "url" | "upload" | "drive";
    caption_style: CaptionStyle;
    source_language?: SourceLanguage;
    caption_language?: CaptionLanguage;
    caption_pace?: CaptionPace;
    detected_language?: string | null;
    transcription_report?: Record<string, unknown> | null;
    quota_state?: "pending" | "charged" | "refunded";
    quota_video_charged?: boolean;
    clips_budget?: number | null;
    requested_clips?: number | null;
    usage_window_start?: string | null;
    dispatch_count?: number;
    creation_request_id?: string | null;
    quota_clips_charged?: number | null;
    max_clips: number;
    target_platforms: string[];
    status: JobStatus;
    progress: number;
    error_message: string | null;
    clips_count: number;
    drive_folder_id: string | null;
    transcript_srt: string | null;
    viral_moments: unknown;
    github_run_id: string | null;
    checkpoint_url: string | null;
    /** "clips" = cut viral moments; "captions" = caption the whole video. */
    job_mode: "clips" | "captions" | null;
    remove_silences: boolean | null;
    auto_punch_in: boolean | null;
    /** Private video-uploads bucket path (source of a fresh signed URL). */
    video_storage_path: string | null;
    /** Real title from the source platform (yt-dlp), set by the pipeline. */
    source_title: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface Clip {
    id: string;
    job_id: string;
    user_id: string;
    clip_index: number;
    /** Aspect tag: '9x16' master, or a variant of the same master ('1x1', '16x9'). */
    variant: string | null;
    filename: string;
    duration_seconds: number | null;
    start_time: number | null;
    end_time: number | null;
    title: string | null;
    description: string | null;
    hashtags: string[] | null;
    hook_caption: string | null;
    viral_score: number | null;
    /** Quality-instrument score 0-100 (pipeline/clip_qa.py). NULL = not measured. */
    quality_score: number | null;
    /** Per-check breakdown {checks:[{id,label,status,value,detail}], loudness, clip}. */
    quality_report: {
        checks?: { id: string; label: string; status: string; value: string; detail: string }[];
        loudness?: { lufs: number | null; true_peak_dbfs: number | null };
        clip?: Record<string, unknown>;
    } | null;
    drive_file_id: string | null;
    drive_url: string | null;
    thumbnail_url: string | null;
    /** R2 delivery-cache keys (Drive is the archive; R2 evicts after 24h). */
    storage_path: string | null;
    thumbnail_path: string | null;
    /** Drive file id of the thumbnail — used to restore it after eviction. */
    thumbnail_drive_id: string | null;
    status: ClipStatus;
    published_platforms: string[] | null;
    scheduled_at: string | null;
    published_at: string | null;
    created_at: string;
}

/** A plan row as the app reads it (profile or a subset of it). */
export interface PlanState {
    plan?: string | null;
    current_period_end?: string | null;
    clips_used?: number | null;
    videos_used?: number | null;
}

/**
 * One-time plans expire: a paid plan whose `current_period_end` has passed is
 * treated as Free everywhere. Legacy paid rows without an expiry stay active
 * rather than locking existing payers out. Single source of truth — the
 * trigger route, the settings card, the new-video page and the webhook all
 * derive limits through here so the UI can never disagree with the quota gate.
 */
export function isPlanExpired(profile?: PlanState | null): boolean {
    if (!profile?.plan || profile.plan === "free") return false;
    if (!profile.current_period_end) return false;
    return new Date(profile.current_period_end).getTime() < Date.now();
}

/** The plan that ACTUALLY applies right now (expired paid plans read as free). */
export function effectivePlanKey(profile?: PlanState | null): Plan {
    if (!profile?.plan || profile.plan === "free" || isPlanExpired(profile)) return "free";
    return (profile.plan === "creator" || profile.plan === "pro" || profile.plan === "agency"
        ? profile.plan
        : "free") as Plan;
}

/** The limits that ACTUALLY apply right now, from the effective plan. */
export function effectiveLimits(profile?: PlanState | null): { clips: number; videos: number; label: string } {
    return PLAN_LIMITS[effectivePlanKey(profile)];
}

export const PLAN_LIMITS: Record<Plan, { clips: number; videos: number; monthlyPrice: number; annualPrice: number; label: string }> = {
    free: { clips: 5, videos: 2, monthlyPrice: 0, annualPrice: 0, label: "Free" },
    creator: { clips: 150, videos: 30, monthlyPrice: 49900, annualPrice: 39900, label: "Creator" },
    pro: { clips: 200, videos: 20, monthlyPrice: 89900, annualPrice: 71900, label: "Pro" },
    agency: { clips: 9999, videos: 9999, monthlyPrice: 149900, annualPrice: 119900, label: "Agency" },
};

export const CAPTION_STYLES: { value: CaptionStyle; label: string; description: string }[] = [
    { value: "hormozi", label: "Hormozi", description: "High-contrast active-word highlight" },
    { value: "bounce", label: "Bounce", description: "Controlled word pop with stable line spacing" },
    { value: "fade", label: "Fade", description: "Soft editorial captions on a dark reading panel" },
    { value: "glow", label: "Glow", description: "Soft active-word glow with a crisp text core" },
    { value: "typewriter", label: "Typewriter", description: "Speech-timed typing that preserves Hindi characters" },
    { value: "glitch", label: "Glitch", description: "Brief chromatic accent without continuous jitter" },
    { value: "neon", label: "Neon", description: "Steady neon lettering without flashing" },
    { value: "colorful", label: "Colorful", description: "Readable pastel word accents" },
    { value: "minimal", label: "Minimal", description: "Compact two-line subtitle panel" },
];

export const JOB_STATUS_LABELS: Record<JobStatus, { label: string; emoji: string; color: string }> = {
    queued: { label: "Queued", emoji: "⏳", color: "#6B7280" },
    downloading: { label: "Downloading", emoji: "📥", color: "#3B82F6" },
    transcribing: { label: "Transcribing", emoji: "🗣️", color: "#8B5CF6" },
    analyzing: { label: "Analyzing", emoji: "🧠", color: "#F59E0B" },
    clipping: { label: "Clipping", emoji: "✂️", color: "#EF4444" },
    captioning: { label: "Captioning", emoji: "🎬", color: "#EC4899" },
    uploading: { label: "Uploading", emoji: "☁️", color: "#06B6D4" },
    done: { label: "Done", emoji: "✅", color: "#10B981" },
    failed: { label: "Failed", emoji: "❌", color: "#EF4444" },
    cancelled: { label: "Cancelled", emoji: "⚠️", color: "#F59E0B" },
};
