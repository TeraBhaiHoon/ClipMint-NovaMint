"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import {
    Upload, Link2, ArrowRight, Sparkles, Info, Loader2,
    Check, Zap, AlertCircle, Scissors, Captions, Wand2,
} from "lucide-react";
import { CAPTION_STYLES, type CaptionStyle } from "@/lib/types";
import { validateVideoUrl } from "@/lib/validateUrl";

const STEPS = [
    { num: 1, label: "Source" },
    { num: 2, label: "Style" },
    { num: 3, label: "Config" },
];

/** Caption pacing: page size + gap between caption pages. */
const CAPTION_PACES = [
    { value: "fast", label: "Fast", hint: "3 words · snappy" },
    { value: "balanced", label: "Balanced", hint: "4 words · default" },
    { value: "slow", label: "Slow", hint: "5 words · relaxed" },
] as const;

type CaptionPace = (typeof CAPTION_PACES)[number]["value"];

/** What the pipeline should do: cut viral clips, or caption the whole video. */
type JobMode = "clips" | "captions";

/** Source videos are uploaded to the private `video-uploads` bucket.
 *  Capped at 45 MB because Supabase's FREE plan enforces a 50 MB global
 *  per-file limit (bucket limits cannot exceed it). Longer videos should
 *  use a link — YouTube, Drive, or any direct MP4 URL. */
const MAX_UPLOAD_BYTES = 45 * 1024 * 1024;
const VIDEO_ACCEPT =
    "video/mp4,video/quicktime,video/x-m4v,video/webm,.mp4,.mov,.m4v,.webm";

export default function NewVideoPage() {
    const router = useRouter();
    const supabase = createClient();
    const [videoUrl, setVideoUrl] = useState("");
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("hormozi");
    const [captionPace, setCaptionPace] = useState<CaptionPace>("balanced");
    const [maxClips, setMaxClips] = useState(10);
    // Job mode: "clips" cuts viral moments; "captions" captions the whole video
    // (with optional auto-editing: silence jump-cuts + punch-in zooms).
    const [jobMode, setJobMode] = useState<JobMode>("clips");
    const [removeSilences, setRemoveSilences] = useState(true);
    const [autoPunchIn, setAutoPunchIn] = useState(true);
    // BGM choice: "auto" = AI mood pick, a mood name, "none", or "custom" with
    // an uploaded track (stored in Supabase Storage, URL saved on the job).
    const [bgmChoice, setBgmChoice] = useState<"auto" | "energetic" | "calm" | "corporate" | "inspiring" | "none" | "custom">("auto");
    const [bgmFile, setBgmFile] = useState<File | null>(null);
    const BGM_CHOICES: { value: typeof bgmChoice; label: string }[] = [
        { value: "auto", label: "Auto (AI mood)" },
        { value: "energetic", label: "Energetic" },
        { value: "calm", label: "Calm" },
        { value: "corporate", label: "Corporate" },
        { value: "inspiring", label: "Inspiring" },
        { value: "none", label: "No BGM" },
        { value: "custom", label: "My track" },
    ];
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sourceType, setSourceType] = useState<"url" | "file" | "drive">("url");
    const [currentStep, setCurrentStep] = useState(1);

    const hasSource = sourceType === "file" ? Boolean(videoFile) : Boolean(videoUrl.trim());

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!hasSource) return;

        setIsSubmitting(true);
        setError(null);

        // ── Resolve the source to a URL the pipeline can fetch ──
        let normalizedUrl: string | null = null;
        let videoStoragePath: string | null = null;

        if (sourceType === "file") {
            if (!videoFile) { setIsSubmitting(false); return; }
            if (videoFile.size > MAX_UPLOAD_BYTES) {
                setError("That video is over the 45 MB upload limit. Paste a YouTube/Drive link instead — links have no size limit.");
                setIsSubmitting(false);
                return;
            }
            // (upload happens after the quota checks below, so a failed upload
            //  never burns a video slot)
        } else {
            // Client-side validation for instant feedback. The server validates
            // the *stored* URL again before dispatching — that is the security boundary.
            const validation = validateVideoUrl(videoUrl);
            if (!validation.ok) {
                setError(validation.reason);
                setIsSubmitting(false);
                return;
            }
            normalizedUrl = validation.url;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setError("You must be logged in."); setIsSubmitting(false); return; }

        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("clips_used, clips_limit, videos_used, videos_limit")
            .eq("id", user.id)
            .single();

        if (profileError || !profile) {
            // A failed profile fetch used to skip every limit check — fail loudly instead.
            console.error("Could not load profile limits:", profileError?.message);
            setError("Could not verify your plan limits. Please refresh the page and try again.");
            setIsSubmitting(false); return;
        }

        if (profile.videos_used >= profile.videos_limit) {
            setError(`You've reached your limit of ${profile.videos_limit} video(s). Please upgrade.`);
            setIsSubmitting(false); return;
        }
        if (profile.clips_used >= profile.clips_limit) {
            setError(`You've reached your limit of ${profile.clips_limit} clip(s). Please upgrade.`);
            setIsSubmitting(false); return;
        }
        const remaining = Math.max(0, profile.clips_limit - profile.clips_used);
        if (remaining <= 0) { setError("No clips remaining. Please upgrade."); setIsSubmitting(false); return; }

        // Clamp *and use* the clamped value below — setting state alone was dead code.
        const effectiveMaxClips = Math.min(maxClips, remaining);
        if (effectiveMaxClips !== maxClips) setMaxClips(effectiveMaxClips);

        // ── Upload the source video (private bucket, own folder) ──
        if (sourceType === "file" && videoFile) {
            const ext = (videoFile.name.split(".").pop() || "mp4").toLowerCase();
            videoStoragePath = `${user.id}/source-${Date.now()}.${ext}`;
            const { error: upErr } = await supabase.storage
                .from("video-uploads")
                .upload(videoStoragePath, videoFile, {
                    contentType: videoFile.type || "video/mp4",
                    upsert: false,
                });
            if (upErr) {
                setError(`Video upload failed: ${upErr.message}`);
                setIsSubmitting(false);
                return;
            }
            // Initial signed URL for the job row; the dispatch route mints a
            // fresh one from video_storage_path on every run, so expiry is fine.
            const { data: signed } = await supabase.storage
                .from("video-uploads")
                .createSignedUrl(videoStoragePath, 60 * 60 * 24 * 7);
            if (!signed?.signedUrl) {
                setError("Upload succeeded but the video could not be prepared. Please try again.");
                setIsSubmitting(false);
                return;
            }
            normalizedUrl = signed.signedUrl;
        }

        if (!normalizedUrl) { setIsSubmitting(false); return; }

        // Reserve a video slot atomically before creating anything, so two tabs
        // (or a retry storm) cannot push videos_used past the limit.
        let reservedSlot = false;
        const { data: reserved, error: reserveError } = await supabase.rpc("increment_videos_used", {
            p_user_id: user.id,
        });
        if (reserveError) {
            // RPC missing (migration not applied) or transient failure: log loudly
            // and continue — the trigger route still enforces the clip quota.
            console.error("increment_videos_used RPC failed:", reserveError.message);
        } else if (reserved === false) {
            setError(`You've reached your limit of ${profile.videos_limit} video(s). Please upgrade.`);
            setIsSubmitting(false); return;
        } else {
            reservedSlot = true;
        }

        // Upload a user-supplied BGM track (if any) BEFORE the job row exists,
        // keyed by the user id so RLS keeps folders private-per-owner.
        let customBgmUrl: string | null = null;
        if (bgmChoice === "custom" && bgmFile) {
            if (bgmFile.size > 25 * 1024 * 1024) {
                setError("Your BGM track is over 25 MB. Please upload a smaller file.");
                setIsSubmitting(false); return;
            }
            const ext = (bgmFile.name.split(".").pop() || "mp3").toLowerCase();
            const path = `${user.id}/bgm-${Date.now()}.${ext}`;
            const { error: upErr } = await supabase.storage
                .from("bgm-uploads")
                .upload(path, bgmFile, { contentType: bgmFile.type || "audio/mpeg" });
            if (upErr) {
                setError(`BGM upload failed: ${upErr.message}`);
                setIsSubmitting(false); return;
            }
            customBgmUrl = supabase.storage.from("bgm-uploads").getPublicUrl(path).data.publicUrl;
        }
        const jobRow: Record<string, unknown> = {
            user_id: user.id, video_url: normalizedUrl,
            source_type: sourceType === "url" ? "url" : sourceType === "drive" ? "drive" : "upload",
            caption_style: captionStyle, max_clips: effectiveMaxClips, status: "queued", progress: 0,
            job_mode: jobMode,
            // Auto-edit toggles only apply to whole-video captions mode.
            remove_silences: jobMode === "captions" ? removeSilences : false,
            auto_punch_in: jobMode === "captions" ? autoPunchIn : false,
        };
        if (videoStoragePath) jobRow.video_storage_path = videoStoragePath;
        // The mood choice travels through the job row the same way the render
        // reads it: "auto" leaves it to the AI; "none" and named moods override.
        if (bgmChoice !== "auto" && bgmChoice !== "custom") jobRow.bgm_mood = bgmChoice;
        if (bgmChoice === "none") jobRow.bgm_mood = "none";
        if (customBgmUrl) jobRow.custom_bgm_url = customBgmUrl;

        const { data, error: insertError } = await supabase.from("jobs").insert(jobRow).select("id").single();

        if (insertError) {
            // Give the reserved slot back if the job could not be created.
            if (reservedSlot) await supabase.rpc("refund_videos_used", { p_user_id: user.id });
            setError(insertError.message); setIsSubmitting(false); return;
        }

        if (data) {
            try {
                const res = await fetch("/api/trigger-pipeline", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ job_id: data.id, caption_pace: captionPace }),
                });
                if (!res.ok) {
                    const payload = await res.json().catch(() => null);
                    setError(payload?.error || "Could not start processing. Please try again.");
                    setIsSubmitting(false);
                    return;
                }
            } catch (err) {
                console.warn("Trigger failed:", err);
                setError("Could not start processing. Please check your connection and retry from the job page.");
                setIsSubmitting(false);
                return;
            }
            router.push(`/dashboard/${data.id}`);
        }
    };

    return (
        <div className="max-w-2xl mx-auto">
            {/* ─── Step Progress ─── */}
            <div className="flex items-center justify-between gap-2 mb-8">
                {STEPS.map((step, i) => (
                    <div key={step.num} className="flex items-center flex-1 last:flex-initial">
                        <div className="flex items-center gap-2.5 flex-shrink-0">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                                currentStep >= step.num 
                                    ? "bg-mint-500 text-ink-950 shadow-[0_0_12px_rgba(139,92,246,0.3)]" 
                                    : "bg-[#08080c] text-[#64748b] border border-white/5"
                            }`}>
                                {currentStep > step.num ? <Check size={14} /> : step.num}
                            </div>
                            <span className={`text-xs font-semibold ${currentStep >= step.num ? "text-slate-100" : "text-[#64748b]"}`}>
                                {step.label}
                            </span>
                        </div>
                        {i < STEPS.length - 1 && (
                            <div className={`flex-1 h-0.5 mx-3 rounded-full transition-all duration-300 ${currentStep > step.num ? "bg-mint-500" : "bg-white/5"}`} />
                        )}
                    </div>
                ))}
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-1 text-slate-100 flex items-center gap-2">
                <Zap size={24} className="text-mint-400" />
                Create New Video
            </h1>
            <p className="text-sm text-[#64748b] mb-8">
                Upload a video and get viral clips, or caption the whole thing with pro auto-editing
            </p>

            <form onSubmit={handleSubmit}>
                {/* ─── Source Type Tabs ─── */}
                <div className="tab-nav mb-6">
                    {[
                        { value: "url" as const, label: "Paste URL", icon: <Link2 size={15} /> },
                        { value: "file" as const, label: "Upload Video", icon: <Upload size={15} /> },
                        { value: "drive" as const, label: "Via Drive", icon: <Upload size={15} /> },
                    ].map((tab) => (
                        <button
                            key={tab.value} type="button"
                            className={`tab-item ${sourceType === tab.value ? "active" : ""}`}
                            onClick={() => { setSourceType(tab.value); setCurrentStep(1); }}
                        >
                            {tab.icon} {tab.label}
                        </button>
                    ))}
                </div>

                {/* ─── URL Input ─── */}
                {sourceType === "url" && (
                    <div className="mb-6">
                        <label className="block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider">Video URL</label>
                        <input
                            type="url" value={videoUrl}
                            onChange={(e) => { setVideoUrl(e.target.value); if (e.target.value.trim()) setCurrentStep(2); }}
                            placeholder="https://youtube.com/watch?v=... or Instagram/Facebook URL"
                            className="input-field" required
                        />
                        <div className="flex items-center gap-1.5 mt-2.5 text-xs text-[#64748b]">
                            <Info size={12} /> Supports YouTube, Instagram, Facebook, and direct MP4 links
                        </div>
                    </div>
                )}

                {/* ─── Direct file upload ─── */}
                {sourceType === "file" && (
                    <div className="mb-6">
                        <label className="block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider">
                            Upload your video
                        </label>
                        <label
                            className={`glass-card p-8 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all text-center ${
                                videoFile ? "border-mint-500/40 bg-mint-500/5" : "hover:border-white/20"
                            }`}
                        >
                            <input
                                type="file"
                                accept={VIDEO_ACCEPT}
                                className="hidden"
                                onChange={(e) => {
                                    const f = e.target.files?.[0] ?? null;
                                    setVideoFile(f);
                                    if (f) setCurrentStep(2);
                                }}
                            />
                            {videoFile ? (
                                <>
                                    <Check size={22} className="text-mint-400" />
                                    <span className="text-sm font-bold text-slate-100">{videoFile.name}</span>
                                    <span className={`text-xs ${videoFile.size > MAX_UPLOAD_BYTES ? "text-red-400" : "text-[#64748b]"}`}>
                                        {(videoFile.size / 1024 / 1024).toFixed(1)} MB
                                        {videoFile.size > MAX_UPLOAD_BYTES && " — over the 45 MB limit"}
                                    </span>
                                    <span className="text-[10px] text-[#64748b]">Click to choose a different file</span>
                                </>
                            ) : (
                                <>
                                    <Upload size={22} className="text-mint-400" />
                                    <span className="text-sm font-bold text-slate-200">Click to choose a video</span>
                                    <span className="text-xs text-[#64748b]">MP4, MOV, M4V or WebM · up to 45 MB</span>
                                    <span className="text-[10px] text-[#64748b]">For longer videos, paste a YouTube or Drive link — no size limit there</span>
                                </>
                            )}
                        </label>
                    </div>
                )}

                {/* ─── Upload via Drive ─── */}
                {sourceType === "drive" && (
                    <div className="mb-6">
                        <label className="block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider">
                            Upload via Google Drive
                        </label>
                        <div className="glass-card p-5 mb-4">
                            <div className="flex flex-col gap-4">
                                {[
                                    { n: 1, t: "Upload to Google Drive", d: "Upload your video file to your Google Drive account" },
                                    { n: 2, t: 'Share with "Anyone with the link"', d: 'Right-click → Share → Change to "Anyone with the link" → Copy link' },
                                    { n: 3, t: "Paste the link below", d: "Paste your Google Drive share link and we'll handle the rest" },
                                ].map((s) => (
                                    <div key={s.n} className="flex items-start gap-3">
                                        <div className="w-6 h-6 rounded-full bg-mint-500/10 border border-mint-500/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-mint-400">{s.n}</div>
                                        <div>
                                            <div className="text-xs font-bold text-slate-200 mb-0.5">{s.t}</div>
                                            <div className="text-xs text-[#64748b] leading-relaxed">{s.d}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <input
                            type="url" value={videoUrl}
                            onChange={(e) => { setVideoUrl(e.target.value); if (e.target.value.trim()) setCurrentStep(2); }}
                            placeholder="https://drive.google.com/file/d/..." className="input-field" required
                        />
                    </div>
                )}

                {/* ─── What to produce ─── */}
                <div className="mb-6">
                    <label className="block text-xs font-bold text-slate-300 mb-2.5 uppercase tracking-wider">
                        What should ClipMint make?
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {([
                            {
                                value: "clips" as const,
                                icon: <Scissors size={15} />,
                                title: "Viral clips",
                                hint: "AI finds the best moments and cuts 9:16 clips",
                            },
                            {
                                value: "captions" as const,
                                icon: <Captions size={15} />,
                                title: "Full video captions",
                                hint: "One captioned video of the whole upload, auto-edited",
                            },
                        ] as const).map((mode) => (
                            <button
                                key={mode.value} type="button"
                                onClick={() => { setJobMode(mode.value); setCurrentStep(3); }}
                                className={`glass-card p-4 text-left cursor-pointer transition-all ${
                                    jobMode === mode.value
                                        ? "border-mint-500 bg-mint-500/10 shadow-[0_0_15px_rgba(139,92,246,0.1)]"
                                        : "hover:border-white/10"
                                }`}
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <span className={`text-xs font-bold flex items-center gap-1.5 ${jobMode === mode.value ? "text-mint-400" : "text-slate-300"}`}>
                                        {mode.icon} {mode.title}
                                    </span>
                                    {jobMode === mode.value && <Check size={14} className="text-mint-400" />}
                                </div>
                                <span className="text-[10px] text-[#64748b] leading-tight block">{mode.hint}</span>
                            </button>
                        ))}
                    </div>

                    {/* Auto-editing — whole-video captions mode only */}
                    {jobMode === "captions" && (
                        <div className="glass-card p-4 mt-3 space-y-3">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                <Wand2 size={12} className="text-mint-400" /> Auto-editing
                            </div>
                            {([
                                {
                                    checked: removeSilences,
                                    set: setRemoveSilences,
                                    title: "Cut out dead air",
                                    hint: "Removes silences and long pauses, so the pace stays tight",
                                },
                                {
                                    checked: autoPunchIn,
                                    title: "Dynamic punch-ins",
                                    set: setAutoPunchIn,
                                    hint: "Subtle zoom on sentence starts — the classic editor look",
                                },
                            ] as const).map((opt) => (
                                <label key={opt.title} className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={opt.checked}
                                        onChange={(e) => opt.set(e.target.checked)}
                                        className="mt-0.5 w-4 h-4 accent-[#39E508] cursor-pointer"
                                    />
                                    <span>
                                        <span className="block text-xs font-bold text-slate-200">{opt.title}</span>
                                        <span className="block text-[10px] text-[#64748b] leading-relaxed">{opt.hint}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    )}
                </div>

                {/* ─── Background Music Picker ─── */}
                <div className="mb-6">
                    <label className="block text-xs font-bold text-slate-300 mb-2.5 uppercase tracking-wider">
                        Background Music <span className="text-slate-500 normal-case font-medium">(SFX always on)</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {BGM_CHOICES.map((c) => (
                            <button
                                key={c.value} type="button"
                                onClick={() => { setBgmChoice(c.value); if (c.value !== "custom") setBgmFile(null); }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                    bgmChoice === c.value
                                        ? "border-mint-500 bg-mint-500/10 text-mint-400"
                                        : "border-white/10 text-slate-400 hover:border-white/20"
                                }`}
                            >
                                {c.label}
                            </button>
                        ))}
                    </div>
                    {bgmChoice === "custom" && (
                        <div className="mt-3">
                            <input
                                type="file"
                                accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,.mp3,.wav,.ogg"
                                onChange={(e) => setBgmFile(e.target.files?.[0] ?? null)}
                                className="input-field file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0
                                           file:bg-mint-500/10 file:text-mint-400 file:text-xs file:font-bold
                                           text-slate-400 text-xs"
                            />
                            {bgmFile && (
                                <p className="text-xs text-slate-500 mt-1.5">
                                    {bgmFile.name} · {(bgmFile.size / 1024 / 1024).toFixed(1)} MB
                                    {bgmFile.size > 25 * 1024 * 1024 && (
                                        <span className="text-red-400"> — over the 25 MB limit</span>
                                    )}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* ─── Caption Style Picker ─── */}
                <div className="mb-6">
                    <label className="block text-xs font-bold text-slate-300 mb-2.5 uppercase tracking-wider">Caption Style</label>
                    <div className="dash-grid-3">
                        {CAPTION_STYLES.map((style) => (
                            <button
                                key={style.value} type="button"
                                onClick={() => { setCaptionStyle(style.value); setCurrentStep(3); }}
                                className={`glass-card p-4 text-left cursor-pointer transition-all ${
                                    captionStyle === style.value 
                                        ? "border-mint-500 bg-mint-500/10 shadow-[0_0_15px_rgba(139,92,246,0.1)]" 
                                        : "hover:border-white/10"
                                }`}
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <span className={`text-xs font-bold ${captionStyle === style.value ? "text-mint-400" : "text-slate-300"}`}>
                                        {style.label}
                                    </span>
                                    {captionStyle === style.value && <Check size={14} className="text-mint-400" />}
                                </div>
                                <span className="text-[10px] text-[#64748b] leading-tight block">{style.description}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* ─── Caption Pace ─── */}
                <div className="mb-6">
                    <label className="block text-xs font-bold text-slate-300 mb-2.5 uppercase tracking-wider">Caption Pace</label>
                    <div className="grid grid-cols-3 gap-2.5">
                        {CAPTION_PACES.map((pace) => (
                            <button
                                key={pace.value} type="button"
                                onClick={() => setCaptionPace(pace.value)}
                                className={`glass-card p-3 text-center cursor-pointer transition-all ${
                                    captionPace === pace.value
                                        ? "border-mint-500 bg-mint-500/10"
                                        : "hover:border-white/10"
                                }`}
                            >
                                <span className={`block text-xs font-bold ${captionPace === pace.value ? "text-mint-400" : "text-slate-300"}`}>
                                    {pace.label}
                                </span>
                                <span className="block text-[10px] text-[#64748b] mt-0.5">{pace.hint}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* ─── Max Clips (viral-clips mode only) ─── */}
                {jobMode === "clips" && (
                    <div className="mb-8">
                        <label className="flex justify-between items-center text-xs font-bold text-slate-300 mb-2.5 uppercase tracking-wider">
                            <span>Max Clips</span>
                            <span className="text-mint-400 text-sm font-extrabold">{maxClips}</span>
                        </label>
                        <input
                            type="range"
                            min={1} max={20}
                            value={maxClips}
                            onChange={(e) => setMaxClips(Number(e.target.value))}
                            style={{
                                background: `linear-gradient(to right, #39E508 0%, #39E508 ${((maxClips - 1) / 19) * 100}%, rgba(255, 255, 255, 0.08) ${((maxClips - 1) / 19) * 100}%, rgba(255, 255, 255, 0.08) 100%)`,
                            }}
                            className="custom-range"
                        />
                        <div className="flex justify-between text-[10px] text-[#64748b] mt-1.5 font-medium">
                            <span>1 clip</span><span>20 clips</span>
                        </div>
                    </div>
                )}

                {/* ─── Error ─── */}
                {error && (
                    <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-[#ef4444] text-xs font-semibold mb-5 flex items-center gap-2 animate-scale-in">
                        <AlertCircle size={14} className="flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {/* ─── Submit ─── */}
                <button
                    type="submit" 
                    className="btn-primary w-full justify-center py-3.5 text-sm font-semibold shadow-lg"
                    disabled={isSubmitting || !hasSource}
                >
                    {isSubmitting ? (
                        <><Loader2 size={18} className="animate-spin" /> Processing...</>
                    ) : (
                        <><Sparkles size={18} /> Start Processing <ArrowRight size={18} /></>
                    )}
                </button>

                {/* ─── Info ─── */}
                <div className="glass-card p-4.5 mt-5 flex gap-3 bg-white/[0.01]">
                    <Info size={18} className="text-mint-400 flex-shrink-0 mt-0.5" />
                    <div>
                        <div className="text-xs font-bold text-slate-200 mb-1">How long does it take?</div>
                        <p className="text-xs text-[#64748b] leading-relaxed">
                            Processing typically takes 5-15 minutes. ClipMint transcribes your audio, writes the captions,
                            auto-edits the pacing, and renders the finished video.
                        </p>
                    </div>
                </div>
            </form>
        </div>
    );
}
