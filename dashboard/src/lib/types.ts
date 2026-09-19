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
    drive_file_id: string | null;
    drive_url: string | null;
    thumbnail_url: string | null;
    /** Private clip-outputs bucket paths — served only via signed URLs. */
    storage_path: string | null;
    thumbnail_path: string | null;
    status: ClipStatus;
    published_platforms: string[] | null;
    scheduled_at: string | null;
    published_at: string | null;
    created_at: string;
}

export const PLAN_LIMITS: Record<Plan, { clips: number; videos: number; monthlyPrice: number; annualPrice: number; label: string }> = {
    free: { clips: 5, videos: 2, monthlyPrice: 0, annualPrice: 0, label: "Free" },
    creator: { clips: 150, videos: 30, monthlyPrice: 49900, annualPrice: 39900, label: "Creator" },
    pro: { clips: 200, videos: 20, monthlyPrice: 89900, annualPrice: 71900, label: "Pro" },
    agency: { clips: 9999, videos: 9999, monthlyPrice: 149900, annualPrice: 119900, label: "Agency" },
};

export const CAPTION_STYLES: { value: CaptionStyle; label: string; description: string }[] = [
    { value: "hormozi", label: "Hormozi", description: "Word-by-word green highlight with scale pop" },
    { value: "bounce", label: "Bounce", description: "Spring physics bounce-in animation" },
    { value: "fade", label: "Fade", description: "Smooth fade in/out" },
    { value: "glow", label: "Glow", description: "Pulsing neon glow effect" },
    { value: "typewriter", label: "Typewriter", description: "Character-by-character typing with cursor" },
    { value: "glitch", label: "Glitch", description: "RGB split glitch effect" },
    { value: "neon", label: "Neon", description: "Flickering neon sign with layered glow" },
    { value: "colorful", label: "Colorful", description: "Rainbow-colored words with staggered entrance" },
    { value: "minimal", label: "Minimal", description: "Frosted glass pill with subtle slide-up" },
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
