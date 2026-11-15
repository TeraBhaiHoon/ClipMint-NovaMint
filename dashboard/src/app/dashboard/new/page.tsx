"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Captions, Check, ChevronRight, CloudUpload, FileVideo, FolderOpen, Link2, Music2, Scissors, SlidersHorizontal, Sparkles, Upload, Wand2, X } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { CAPTION_STYLES, effectiveLimits, type CaptionStyle } from "@/lib/types";
import { readCaptionPreference } from "@/lib/dashboard";
import { validateVideoUrl } from "@/lib/validateUrl";
import { useDashboard } from "../_components/dashboard-provider";
import { Button, Choice, Notice, PageHeader, SectionHeading, Toggle } from "../_components/ui";

const PACES = [
    { value: "fast", label: "Fast", hint: "3 words · snappy" },
    { value: "balanced", label: "Balanced", hint: "4 words · natural" },
    { value: "slow", label: "Slow", hint: "5 words · relaxed" },
] as const;
const MUSIC = [
    { value: "auto", label: "AI selection" }, { value: "energetic", label: "Energetic" },
    { value: "calm", label: "Calm" }, { value: "corporate", label: "Corporate" },
    { value: "inspiring", label: "Inspiring" }, { value: "none", label: "No music" },
    { value: "custom", label: "Upload a track" },
] as const;
type Pace = typeof PACES[number]["value"];
type Music = typeof MUSIC[number]["value"];
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/x-m4v,video/webm,.mp4,.mov,.m4v,.webm";

export default function NewVideoPage() {
    const router = useRouter();
    const supabase = useMemo(() => createClient(), []);
    const { account, profile, refreshProfile } = useDashboard();
    const [sourceType, setSourceType] = useState<"url" | "file" | "drive">("url");
    const [videoUrl, setVideoUrl] = useState("");
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("hormozi");
    const [captionPace, setCaptionPace] = useState<Pace>("balanced");
    const [maxClips, setMaxClips] = useState(5);
    const [jobMode, setJobMode] = useState<"clips" | "captions">("clips");
    const [removeSilences, setRemoveSilences] = useState(true);
    const [autoPunchIn, setAutoPunchIn] = useState(true);
    const [bgmChoice, setBgmChoice] = useState<Music>("auto");
    const [bgmFile, setBgmFile] = useState<File | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [uploadPct, setUploadPct] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [createdJobId, setCreatedJobId] = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const errorRef = useRef<HTMLDivElement>(null);
    const preferenceLoaded = useRef<string | null>(null);
    const submitting = useRef(false);

    useEffect(() => {
        if (!account || preferenceLoaded.current === account.id) return;
        const style = readCaptionPreference(account.id);
        const frame = requestAnimationFrame(() => {
            preferenceLoaded.current = account.id;
            setCaptionStyle(style);
        });
        return () => cancelAnimationFrame(frame);
    }, [account]);
    useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

    const hasSource = sourceType === "file" ? !!videoFile : !!videoUrl.trim();
    const remaining = profile ? Math.max(0, effectiveLimits(profile).clips - profile.clips_used) : null;
    const styleLabel = CAPTION_STYLES.find((style) => style.value === captionStyle)?.label || "Hormozi";

    function selectFile(file: File | null) {
        setError(null);
        if (file && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) {
            setError("Choose an MP4, MOV, M4V, or WebM video.");
            return;
        }
        setVideoFile(file);
        if (file && file.size > MAX_UPLOAD_BYTES) setError("This video is over 2 GB. Use a YouTube or Google Drive link for larger files.");
    }

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        if (!hasSource || submitting.current || createdJobId) return;
        submitting.current = true;
        setIsSubmitting(true);
        setError(null);
        setCreatedJobId(null);
        let reservedSlot = false;
        let userId: string | null = null;
        let jobCreated = false;
        try {
            let normalizedUrl: string | null = null;
            let videoStoragePath: string | null = null;
            if (sourceType === "file") {
                if (!videoFile || videoFile.size > MAX_UPLOAD_BYTES) throw new Error("Choose a video under 2 GB or use a video link.");
            } else {
                const validation = validateVideoUrl(videoUrl);
                if (!validation.ok) throw new Error(validation.reason);
                normalizedUrl = validation.url;
            }
            if (bgmChoice === "custom" && !bgmFile) throw new Error("Choose a music file or select another music option.");
            if (bgmChoice === "custom" && bgmFile && bgmFile.size > 25 * 1024 * 1024) throw new Error("Your music track is over 25 MB. Choose a smaller file.");

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Please sign in again before creating a video.");
            userId = user.id;
            const { error: rollError } = await supabase.rpc("roll_usage_period_if_due", { p_user_id: user.id });
            if (rollError) throw new Error("Couldn’t check your current usage. Please try again.");
            const { data: currentProfile, error: profileError } = await supabase.from("profiles").select("plan, current_period_end, clips_used, videos_used").eq("id", user.id).single();
            if (profileError || !currentProfile) throw new Error("Couldn’t verify your plan limits. Please try again.");
            const limits = effectiveLimits(currentProfile);
            if (currentProfile.videos_used >= limits.videos) throw new Error(`You’ve used your ${limits.videos} videos for this period. View your plan in Settings → Billing.`);
            const clipsLeft = Math.max(0, limits.clips - currentProfile.clips_used);
            if (!clipsLeft) throw new Error("No clips remain in this period. View your plan in Settings → Billing.");
            const effectiveMaxClips = Math.min(jobMode === "captions" ? 1 : maxClips, clipsLeft);

            if (sourceType === "file" && videoFile) {
                const response = await fetch("/api/uploads/presign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: videoFile.name, size: videoFile.size }) });
                const presign = await response.json().catch(() => null);
                if (!response.ok || !presign?.url || !presign?.key) throw new Error(presign?.error || "Couldn’t start your upload. Please try again.");
                setUploadPct(0);
                const uploaded = await new Promise<boolean>((resolve) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("PUT", presign.url);
                    xhr.timeout = 30 * 60 * 1000;
                    xhr.upload.onprogress = (progress) => { if (progress.lengthComputable) setUploadPct(Math.round(progress.loaded / progress.total * 100)); };
                    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
                    xhr.onerror = xhr.ontimeout = xhr.onabort = () => resolve(false);
                    xhr.send(videoFile);
                });
                setUploadPct(null);
                if (!uploaded) throw new Error("Upload failed. Check your connection and try again.");
                videoStoragePath = presign.key;
            }

            let customBgmUrl: string | null = null;
            if (bgmChoice === "custom" && bgmFile) {
                const extension = (bgmFile.name.split(".").pop() || "mp3").toLowerCase();
                const path = `${user.id}/bgm-${Date.now()}.${extension}`;
                const { error: musicError } = await supabase.storage.from("bgm-uploads").upload(path, bgmFile, { contentType: bgmFile.type || "audio/mpeg" });
                if (musicError) throw new Error("Your music file couldn’t be uploaded. Please try again.");
                customBgmUrl = supabase.storage.from("bgm-uploads").getPublicUrl(path).data.publicUrl;
            }

            const { data: reserved, error: reserveError } = await supabase.rpc("increment_videos_used", { p_user_id: user.id });
            if (reserveError) throw new Error("Couldn’t reserve a video slot. Please try again.");
            if (reserved !== true) throw new Error("You’ve reached your video limit or a slot couldn’t be reserved. Please try again.");
            reservedSlot = true;
            const row: Record<string, unknown> = {
                user_id: user.id, video_url: normalizedUrl, video_filename: sourceType === "file" ? videoFile?.name : null,
                source_type: sourceType === "file" ? "upload" : sourceType, caption_style: captionStyle,
                max_clips: effectiveMaxClips, status: "queued", progress: 0, job_mode: jobMode,
                remove_silences: jobMode === "captions" ? removeSilences : false,
                auto_punch_in: jobMode === "captions" ? autoPunchIn : false,
            };
            if (videoStoragePath) row.video_storage_path = videoStoragePath;
            if (bgmChoice !== "auto" && bgmChoice !== "custom") row.bgm_mood = bgmChoice;
            if (customBgmUrl) row.custom_bgm_url = customBgmUrl;
            const { data: job, error: insertError } = await supabase.from("jobs").insert(row).select("id").single();
            if (insertError || !job) throw new Error("Your video project couldn’t be created. Please try again.");
            jobCreated = true;
            setCreatedJobId(job.id);
            const response = await fetch("/api/trigger-pipeline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, caption_pace: captionPace }) });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.error || "Your project was saved, but processing didn’t start. Open it below to retry.");
            }
            void refreshProfile();
            router.push(`/dashboard/${job.id}`);
        } catch (cause) {
            if (reservedSlot && !jobCreated && userId) await supabase.rpc("refund_videos_used", { p_user_id: userId });
            setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
        } finally {
            setUploadPct(null);
            submitting.current = false;
            setIsSubmitting(false);
        }
    }

    return <div className="studio-page">
        <PageHeader eyebrow="Create something worth sharing" title="New video" description="Bring the video. Choose the look. We’ll handle the edit." />
        <form onSubmit={handleSubmit} className="studio-create-layout">
            <fieldset disabled={isSubmitting} className="studio-create-fields">
                <section className="studio-panel" id="source"><SectionHeading title="01 · Add your video" description="Paste a link or upload a file to get started." icon={CloudUpload} />
                    <div className="studio-segmented studio-source-tabs" role="group" aria-label="Video source">{([{ value: "url", label: "Video link", icon: Link2 }, { value: "file", label: "Upload file", icon: Upload }, { value: "drive", label: "Google Drive", icon: FolderOpen }] as const).map(({ value, label, icon: Icon }) => <button type="button" key={value} aria-pressed={sourceType === value} onClick={() => { setSourceType(value); setError(null); }}><Icon size={17} aria-hidden="true" />{label}</button>)}</div>
                    {sourceType === "file" ? <div className="studio-field">
                        <div className={`studio-dropzone ${dragging ? "is-dragging" : ""}`} onDragOver={(e) => { e.preventDefault(); if (!isSubmitting) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); if (!isSubmitting) selectFile(e.dataTransfer.files[0] || null); }}>
                            <input ref={fileInput} id="video-upload" type="file" accept={VIDEO_ACCEPT} className="studio-upload-native" onChange={(e) => selectFile(e.target.files?.[0] || null)} aria-label="Choose a video file" />
                            {videoFile ? <><FileVideo size={28} aria-hidden="true" /><strong>{videoFile.name}</strong><p>{(videoFile.size / 1024 / 1024).toFixed(1)} MB · Click to replace</p></> : <><CloudUpload size={30} aria-hidden="true" /><strong>Drop your video here</strong><p>or click to browse files</p><span>MP4, MOV, M4V, WebM · up to 2 GB</span></>}
                        </div>
                        {videoFile && <Button variant="ghost" className="studio-remove-file" onClick={() => { selectFile(null); if (fileInput.current) fileInput.current.value = ""; }}><X size={15} aria-hidden="true" />Remove file</Button>}
                        <p className="studio-field-hint">Your source upload is private and removed after successful processing.</p>
                    </div> : <div className="studio-field"><label htmlFor="video-url">{sourceType === "drive" ? "Google Drive share link" : "Video URL"}</label><input id="video-url" className="studio-input" type="url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder={sourceType === "drive" ? "https://drive.google.com/file/d/…" : "https://youtube.com/watch?v=…"} aria-describedby="source-hint" required />
                        <p className="studio-field-hint" id="source-hint">{sourceType === "drive" ? 'In Drive, choose Share → General access → “Anyone with the link”, then copy the link.' : "YouTube, Instagram, Facebook, or a direct video link."}</p>
                    </div>}
                    <div className="studio-field studio-create-output"><span className="studio-field-label">What would you like to make?</span><div className="studio-choice-grid studio-choice-grid--two" role="group" aria-label="Output mode"><Choice selected={jobMode === "clips"} title="Short clips" description="AI picks the best moments and cuts vertical clips." icon={Scissors} onClick={() => setJobMode("clips")} /><Choice selected={jobMode === "captions"} title="Full video captions" description="Caption and auto-edit your entire video." icon={Captions} onClick={() => setJobMode("captions")} /></div></div>
                </section>
                <section className="studio-panel" id="captions"><SectionHeading title="02 · Choose your captions" description="Select a style and reading pace. You can change the look for each project." icon={Captions} />
                    <div className="studio-choice-grid studio-caption-choices" role="group" aria-label="Caption style">{CAPTION_STYLES.map((style) => <Choice key={style.value} title={style.label} description={style.description} selected={captionStyle === style.value} onClick={() => setCaptionStyle(style.value)}><span className={`studio-caption-sample studio-caption-sample--${style.value}`} aria-hidden="true">Make it <em>count.</em></span></Choice>)}</div>
                    <div className="studio-field studio-create-pace"><span className="studio-field-label">Reading pace</span><div className="studio-choice-grid" role="group" aria-label="Caption pace">{PACES.map((pace) => <Choice key={pace.value} selected={captionPace === pace.value} title={pace.label} description={pace.hint} onClick={() => setCaptionPace(pace.value)} />)}</div></div>
                </section>
                <section className="studio-panel" id="output"><SectionHeading title="03 · Fine-tune the output" description="Set the length of your batch and the sound of your video." icon={SlidersHorizontal} />
                    {jobMode === "clips" && <div className="studio-field studio-clip-amount"><div className="studio-usage-caption"><label htmlFor="max-clips">Maximum clips</label><output htmlFor="max-clips">{maxClips} clips</output></div><input id="max-clips" type="range" min="1" max="20" value={maxClips} onChange={(e) => setMaxClips(Number(e.target.value))} className="studio-range" /><p className="studio-field-hint">Up to {maxClips} clips, depending on the source and your remaining quota.</p></div>}
                    {jobMode === "captions" && <div className="studio-auto-edit"><h3><Wand2 size={17} aria-hidden="true" />Auto-editing</h3><Toggle label="Remove pauses" description="Cut long silences to keep the video moving." checked={removeSilences} onChange={setRemoveSilences} /><Toggle label="Dynamic punch-ins" description="Add subtle zooms at the start of a sentence." checked={autoPunchIn} onChange={setAutoPunchIn} /></div>}
                    <div className="studio-field"><label htmlFor="background-music">Background music</label><select id="background-music" className="studio-select" value={bgmChoice} onChange={(e) => { setBgmChoice(e.target.value as Music); setBgmFile(null); }}>{MUSIC.map((music) => <option key={music.value} value={music.value}>{music.label}</option>)}</select><p className="studio-field-hint">Music is mixed beneath speech. Sound effects remain enabled.</p></div>
                    {bgmChoice === "custom" && <div className="studio-field studio-custom-track"><label htmlFor="music-file">Your music track</label><input id="music-file" type="file" className="studio-input" accept="audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg" onChange={(e) => setBgmFile(e.target.files?.[0] || null)} required /><p className="studio-field-hint">MP3, WAV or OGG · up to 25 MB. Use a track you have permission to use.</p></div>}
                </section>
            </fieldset>
            <aside className="studio-create-summary" aria-label="Video configuration summary"><div className="studio-panel">
                <div className="studio-summary-title"><Sparkles size={18} aria-hidden="true" /><h2>Your next video</h2></div>
                <div className={`studio-caption-preview studio-caption-sample--${captionStyle}`}><span className="studio-preview-label">Caption style preview</span><p>Make every<br /><em>moment count.</em></p><span className="studio-preview-footer">{styleLabel} · {PACES.find((pace) => pace.value === captionPace)?.label}</span></div>
                <dl className="studio-summary-list"><div><dt>Source</dt><dd>{!hasSource ? "Not added yet" : sourceType === "file" ? "Uploaded video" : sourceType === "drive" ? "Google Drive" : "Video link"}</dd></div><div><dt>Output</dt><dd>{jobMode === "clips" ? `Up to ${remaining === null ? maxClips : Math.min(maxClips, remaining)} short clips` : "1 full video"}</dd></div><div><dt>Music</dt><dd>{MUSIC.find((music) => music.value === bgmChoice)?.label}</dd></div>{remaining !== null && <div><dt>Clips available</dt><dd>{remaining}</dd></div>}</dl>
                <div ref={errorRef} tabIndex={-1}>{error && <Notice tone="error">{error}{createdJobId && <a href={`/dashboard/${createdJobId}`} className="studio-text-link"> Open saved project</a>}</Notice>}</div>
                <Button type="submit" busy={isSubmitting} disabled={!hasSource || !!createdJobId || (sourceType === "file" && (videoFile?.size || 0) > MAX_UPLOAD_BYTES)} className="studio-create-submit">{isSubmitting ? uploadPct !== null ? `Uploading ${uploadPct}%…` : "Starting your video…" : "Create video"}{!isSubmitting && <ChevronRight size={17} aria-hidden="true" />}</Button>
                <p className="studio-summary-hint"><Check size={14} aria-hidden="true" />Your settings are saved with this project.</p>
            </div><p className="studio-create-timing"><Music2 size={17} aria-hidden="true" /><span>Most videos take 5–15 minutes. Longer sources and busy periods may take more time.</span></p></aside>
        </form>
    </div>;
}
