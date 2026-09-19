"use client";

import { use, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import Link from "next/link";
import type { Job, Clip, JobStatus } from "@/lib/types";
import { JOB_STATUS_LABELS } from "@/lib/types";
import {
    ArrowLeft, Download, ExternalLink, Copy, Share2, Star,
    Clock, Film, Loader2, RefreshCw, AlertTriangle, Image,
    Check, ChevronRight, Play, X,
} from "lucide-react";

const PIPELINE_STEPS = [
    { key: "downloading", label: "Download" },
    { key: "transcribing", label: "Transcribe" },
    { key: "analyzing", label: "Analyze" },
    { key: "clipping", label: "Clip" },
    { key: "captioning", label: "Caption" },
    { key: "uploading", label: "Upload" },
];

const TERMINAL_STATUSES: JobStatus[] = ["done", "failed", "cancelled"];
/** Polling fallback cadence while a job is still running (Realtime can drop). */
const JOB_POLL_MS = 4000;
/** A job stuck in a non-terminal state for longer than this is surfaced as stuck. */
const STUCK_AFTER_MS = 45 * 60 * 1000;

function isTerminalStatus(status: JobStatus | null | undefined): boolean {
    return !!status && TERMINAL_STATUSES.includes(status);
}

/** Google Drive file id — from the stored column, else parsed out of the URL. */
function parseDriveFileId(clip: Clip): string | null {
    if (clip.drive_file_id) return clip.drive_file_id;
    if (!clip.drive_url) return null;
    const byPath = clip.drive_url.match(/\/file\/d\/([^/?#]+)/);
    if (byPath) return byPath[1];
    const byQuery = clip.drive_url.match(/[?&]id=([^&]+)/);
    return byQuery ? byQuery[1] : null;
}

/** The pipeline never writes duration_seconds — fall back to end - start. */
function clipDurationSeconds(clip: Clip): number | null {
    if (typeof clip.duration_seconds === "number" && clip.duration_seconds > 0) {
        return clip.duration_seconds;
    }
    if (
        typeof clip.start_time === "number" &&
        typeof clip.end_time === "number" &&
        clip.end_time > clip.start_time
    ) {
        return clip.end_time - clip.start_time;
    }
    return null;
}

function getStepState(stepKey: string, jobStatus: string) {
    const stepOrder = PIPELINE_STEPS.map((s) => s.key);
    const currentIdx = stepOrder.indexOf(jobStatus);
    const stepIdx = stepOrder.indexOf(stepKey);
    if (jobStatus === "done") return "completed";
    if (stepIdx < currentIdx) return "completed";
    if (stepIdx === currentIdx) return "active";
    return "pending";
}

export default function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
    const { jobId } = use(params);
    const supabase = createClient();
    const [job, setJob] = useState<Job | null>(null);
    const [clips, setClips] = useState<Clip[]>([]);
    const [loading, setLoading] = useState(true);
    const [retrying, setRetrying] = useState(false);
    const [downloadingAll, setDownloadingAll] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [previewClip, setPreviewClip] = useState<Clip | null>(null);
    // Ticks on every poll so the "stuck" check re-evaluates without extra timers.
    const [now, setNow] = useState(() => Date.now());
    // Signed thumbnail URLs (1-hour TTL), keyed by clip id, minted by an
    // ownership-checked API route — never public links. Video downloads do
    // NOT need presigned state: their button hits the download route, which
    // re-materialises from the Drive archive when the R2 cache has expired.
    const [mediaLinks, setMediaLinks] = useState<Record<string, { thumbnailUrl: string | null }>>({});
    const linksFetchedAtRef = useRef(0);
    const inFlightRef = useRef(false);
    const statusRef = useRef<JobStatus | null>(null);

    /** Fetch (or refresh) signed URLs. Safe to call often; no-ops when fresh. */
    const loadLinks = async (force = false) => {
        const age = Date.now() - linksFetchedAtRef.current;
        if (!force && age < 30 * 60 * 1000) return;
        try {
            const res = await fetch(`/api/clips/${jobId}/links`);
            if (!res.ok) return;
            const payload = await res.json();
            if (payload?.links) {
                setMediaLinks(payload.links);
                linksFetchedAtRef.current = Date.now();
            }
        } catch (err) {
            console.warn("Could not load clip links:", err);
        }
    };

    useEffect(() => {
        let disposed = false;
        let timer: ReturnType<typeof setInterval> | null = null;

        async function load() {
            if (inFlightRef.current) return; // never overlap requests
            inFlightRef.current = true;
            try {
                const { data: jobData } = await supabase.from("jobs").select("*").eq("id", jobId).single();
                if (disposed) return;
                if (jobData) {
                    setJob(jobData as Job);
                    statusRef.current = (jobData as Job).status;
                }

                const { data: clipsData } = await supabase.from("clips").select("*").eq("job_id", jobId).order("clip_index", { ascending: true });
                if (disposed) return;
                if (clipsData) setClips(clipsData as Clip[]);
                // Sign downloads/thumbnails once any clip lives in private
                // storage (private paths, legacy Drive rows keep their old view).
                if (clipsData?.some((c) => (c as Clip).storage_path)) {
                    void loadLinks();
                }
                setNow(Date.now());
            } finally {
                inFlightRef.current = false;
                if (!disposed) setLoading(false);
            }
        }

        load();

        // Polling fallback: Realtime `postgres_changes` only fires when the
        // publication is configured AND the websocket is healthy, so keep a
        // simple poll running until the job reaches a terminal state.
        timer = setInterval(() => {
            if (isTerminalStatus(statusRef.current)) {
                if (timer) clearInterval(timer);
                return;
            }
            load();
        }, JOB_POLL_MS);

        // Real-time updates for this job
        const channel = supabase
            .channel(`job-${jobId}`)
            .on("postgres_changes", { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${jobId}` }, (payload) => {
                const next = payload.new as Job;
                statusRef.current = next.status;
                setJob(next);
            })
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "clips", filter: `job_id=eq.${jobId}` }, (payload) => {
                const clip = payload.new as Clip;
                setClips((prev) => (prev.some((c) => c.id === clip.id) ? prev : [...prev, clip]));
            })
            .subscribe();

        return () => {
            disposed = true;
            if (timer) clearInterval(timer);
            supabase.removeChannel(channel);
        };
    }, [jobId]);

    const handleRetry = async () => {
        if (!job) return;
        setRetrying(true);
        await supabase.from("jobs").update({ status: "queued", progress: 0, error_message: null }).eq("id", job.id);
        setJob((j) => j ? { ...j, status: "queued", progress: 0, error_message: null } : j);
        statusRef.current = "queued";
        try {
            // Only the job id is sent — the API re-reads the stored URL/config.
            // A retry reuses the saved transcription checkpoint (4.2) when the
            // pipeline recorded one, skipping straight back to clip preparation.
            const res = await fetch("/api/trigger-pipeline", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ job_id: job.id, resume: Boolean(job.checkpoint_url) }),
            });
            if (!res.ok) {
                const payload = await res.json().catch(() => null);
                const message = payload?.error || "Could not start processing. Please try again.";
                setJob((j) => j ? { ...j, status: "failed", error_message: message } : j);
                statusRef.current = "failed";
            }
        } catch {
            setJob((j) => j ? { ...j, status: "failed", error_message: "Could not start processing. Please check your connection." } : j);
            statusRef.current = "failed";
        }
        setRetrying(false);
    };

    const toDirectDriveUrl = (url: string): string => {
        const match = url.match(/\/file\/d\/([^/]+)/);
        if (match) return `https://drive.google.com/uc?export=download&id=${match[1]}`;
        const idMatch = url.match(/[?&]id=([^&]+)/);
        if (idMatch) return `https://drive.google.com/uc?export=download&id=${idMatch[1]}`;
        return url;
    };

    const triggerDownload = (url: string) => {
        const downloadUrl = toDirectDriveUrl(url);
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.src = downloadUrl;
        document.body.appendChild(iframe);
        setTimeout(() => { if (document.body.contains(iframe)) document.body.removeChild(iframe); }, 10000);
    };

    /** True when this clip is served from the R2 delivery cache. */
    const isStored = (clip: Clip) => Boolean(clip.storage_path);

    /**
     * Download through the ownership-checked route: a 302 to a presigned R2
     * URL — or, when the 24h cache evicted the clip, a one-file re-materialisation
     * from the Drive archive first. The hidden iframe lets downloads run without
     * navigating away and stays alive until the archive pull has finished.
     */
    const triggerRouteDownload = (clip: Clip, kind: "video" | "thumb" = "video") => {
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.src = `/api/clips/${clip.id}/download${kind === "thumb" ? "?kind=thumb" : ""}`;
        document.body.appendChild(iframe);
        setTimeout(() => { if (document.body.contains(iframe)) document.body.removeChild(iframe); }, 120000);
    };

    const handleDownload = (clip: Clip) => {
        if (isStored(clip)) return triggerRouteDownload(clip);
        if (clip.drive_url) triggerDownload(clip.drive_url);
    };

    const handleDownloadAll = () => {
        if (clips.length === 0) return;
        setDownloadingAll(true);
        clips.forEach((clip, i) => {
            setTimeout(() => {
                if (isStored(clip)) triggerRouteDownload(clip);
                else if (clip.drive_url) triggerDownload(clip.drive_url);
                if (i === clips.length - 1) setDownloadingAll(false);
            }, i * 1200);
        });
    };

    const handleCopy = (clipId: string, text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(clipId);
        setTimeout(() => setCopiedId(null), 2000);
    };

    if (loading) {
        return (
            <div>
                <div className="skeleton h-7 w-44 mb-6 rounded-lg" />
                <div className="skeleton h-20 mb-5 rounded-2xl" />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1, 2, 3].map((i) => <div key={i} className="skeleton h-64 rounded-2xl" />)}
                </div>
            </div>
        );
    }

    if (!job) {
        return (
            <div>
                <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-slate-300 hover:text-white no-underline text-sm mb-5 transition-colors">
                    <ArrowLeft size={16} /> Back to Jobs
                </Link>
                <div className="glass-card p-10 text-center max-w-md mx-auto">
                    <Film size={40} className="text-[#64748b] mb-4 mx-auto" />
                    <h2 className="text-lg font-bold text-slate-200 mb-2">Job Not Found</h2>
                    <p className="text-sm text-[#64748b]">This job doesn&apos;t exist or you don&apos;t have access.</p>
                </div>
            </div>
        );
    }

    const statusInfo = JOB_STATUS_LABELS[job.status];
    const isProcessing = !["done", "failed", "queued", "cancelled"].includes(job.status);
    const runningSince = new Date(job.started_at || job.created_at).getTime();
    const isStuck = !isTerminalStatus(job.status) && runningSince > 0 && now - runningSince > STUCK_AFTER_MS;
    const previewDriveId = previewClip && !isStored(previewClip)
        ? parseDriveFileId(previewClip) : null;
    // The download endpoint re-materialises from the Drive archive when the
    // R2 cache has expired, then 302s to a presigned inline URL — so <video>
    // can point at it directly.
    const previewStreamUrl = previewClip && isStored(previewClip)
        ? `/api/clips/${previewClip.id}/download?inline=1` : null;

    const openPreview = (clip: Clip) => {
        setPreviewClip(clip);
    };

    return (
        <div>
            {/* ─── Header ─── */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                    <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-[#64748b] hover:text-slate-300 no-underline text-xs mb-3 transition-colors">
                        <ArrowLeft size={14} /> Back to Jobs
                    </Link>
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-100 mb-2">
                        Job {jobId.slice(0, 8)}
                    </h1>
                    <div className="flex items-center gap-3 flex-wrap text-xs text-[#64748b]">
                        <span 
                            className="plan-badge font-bold px-2.5 py-1 rounded-md border text-[10px] tracking-wider uppercase flex items-center gap-1"
                            style={{ 
                                backgroundColor: `${statusInfo.color}15`, 
                                color: statusInfo.color, 
                                borderColor: `${statusInfo.color}30` 
                            }}
                        >
                            {statusInfo.emoji} {statusInfo.label}
                        </span>
                        <span className="flex items-center gap-1"><Clock size={13} /> {new Date(job.created_at).toLocaleString()}</span>
                        <span>Style: {job.caption_style}</span>
                    </div>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                    <button 
                        className="btn-secondary w-full sm:w-auto px-4 py-2.5 text-xs font-semibold" 
                        onClick={handleDownloadAll} 
                        disabled={downloadingAll || clips.length === 0}
                    >
                        {downloadingAll ? <><Loader2 size={14} className="animate-spin" /> Downloading...</> : <><Download size={14} /> Download All ({clips.length})</>}
                    </button>
                </div>
            </div>

            {/* ─── Job Overview Card ─── */}
            <div className="glass-card p-5 mb-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                        <div className="text-[10px] text-[#64748b] font-bold uppercase tracking-wider mb-1">SOURCE</div>
                        <div className="text-xs text-slate-300 font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{job.source_title || job.video_url || job.video_filename || "—"}</div>
                    </div>
                    <div>
                        <div className="text-[10px] text-[#64748b] font-bold uppercase tracking-wider mb-1">CAPTION STYLE</div>
                        <div className="text-xs text-slate-300 font-semibold">{job.caption_style}</div>
                    </div>
                    <div>
                        <div className="text-[10px] text-[#64748b] font-bold uppercase tracking-wider mb-1">MAX CLIPS</div>
                        <div className="text-xs text-slate-300 font-semibold">{job.max_clips}</div>
                    </div>
                    <div>
                        <div className="text-[10px] text-[#64748b] font-bold uppercase tracking-wider mb-1">CLIPS GENERATED</div>
                        <div className="text-xs text-[#10b981] font-bold">{clips.length}</div>
                    </div>
                </div>
            </div>

            {/* ─── Step Progress Indicator ─── */}
            {(isProcessing || job.status === "done") && (
                <div className="glass-card p-6 mb-6">
                    <div className="text-xs font-bold text-[#64748b] uppercase tracking-wider mb-4">PROCESSING PIPELINE</div>
                    <div className="step-progress">
                        {PIPELINE_STEPS.map((step, i) => {
                            const state = job.status === "done" ? "completed" : getStepState(step.key, job.status);
                            return (
                                <div key={step.key} className="step-item">
                                    {i < PIPELINE_STEPS.length - 1 && <div className={`step-connector ${state === "completed" ? "completed" : state === "active" ? "active" : ""}`} />}
                                    <div className={`step-circle ${state}`}>
                                        {state === "completed" ? <Check size={14} /> : i + 1}
                                    </div>
                                    <span className={`text-[10px] font-semibold mt-1.5 ${state === "active" ? "text-mint-400" : state === "completed" ? "text-[#10b981]" : "text-[#64748b]"}`}>
                                        {step.label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ─── Error/Cancelled states ─── */}
            {job.status === "failed" && (
                <div className="glass-card p-5 mb-6 border-red-500/20 bg-red-500/5">
                    <div className="flex items-start gap-3">
                        <AlertTriangle size={20} className="text-[#ef4444] flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <div className="text-sm font-bold text-[#ef4444] mb-1.5">Processing failed</div>
                            <div className="text-xs text-slate-300 bg-black/30 border border-white/5 p-3 rounded-lg mb-3.5 leading-relaxed font-mono">
                                {job.error_message || "Something went wrong. Please try again or contact support."}
                            </div>
                            <button 
                                className="btn-primary px-4 py-2 text-xs font-semibold flex items-center gap-1.5" 
                                onClick={handleRetry} 
                                disabled={retrying}
                            >
                                {retrying ? <><Loader2 size={14} className="animate-spin" /> Retrying...</> : <><RefreshCw size={14} /> Retry</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {job.status === "cancelled" && (
                <div className="glass-card p-5 mb-6 border-amber-500/20 bg-amber-500/5">
                    <div className="flex items-start gap-3">
                        <AlertTriangle size={20} className="text-[#f59e0b] flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <div className="text-sm font-bold text-[#f59e0b] mb-1.5">Processing cancelled</div>
                            <div className="text-xs text-slate-300 mb-3.5">This job was cancelled. You can retry to reprocess your video.</div>
                            <button 
                                className="btn-primary px-4 py-2 text-xs font-semibold flex items-center gap-1.5" 
                                onClick={handleRetry} 
                                disabled={retrying}
                            >
                                {retrying ? <><Loader2 size={14} className="animate-spin" /> Retrying...</> : <><RefreshCw size={14} /> Retry</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Stuck job (no progress for 45+ minutes) ─── */}
            {isStuck && (
                <div className="glass-card p-5 mb-6 border-amber-500/20 bg-amber-500/5">
                    <div className="flex items-start gap-3">
                        <AlertTriangle size={20} className="text-[#f59e0b] flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <div className="text-sm font-bold text-[#f59e0b] mb-1.5">This job looks stuck</div>
                            <div className="text-xs text-slate-300 mb-3.5">
                                It has been in &quot;{statusInfo.label}&quot; for more than 45 minutes with no progress.
                                Retry to send it through the pipeline again.
                            </div>
                            <button 
                                className="btn-primary px-4 py-2 text-xs font-semibold flex items-center gap-1.5" 
                                onClick={handleRetry} 
                                disabled={retrying}
                            >
                                {retrying ? <><Loader2 size={14} className="animate-spin" /> Retrying...</> : <><RefreshCw size={14} /> Retry</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Clips Gallery ─── */}
            <h2 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
                <Film size={18} className="text-mint-400" />
                {clips.length} Clip{clips.length !== 1 ? "s" : ""} Generated
            </h2>

            {clips.length === 0 ? (
                <div className="glass-card p-12 text-center max-w-md mx-auto">
                    <Film size={36} className="text-[#64748b] opacity-40 mb-3 mx-auto" />
                    <p className="text-sm text-[#64748b]">
                        {job.status === "done" ? "No clips were generated for this job." : "Clips will appear here once processing is complete."}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {clips.map((clip, i) => {
                        const driveId = parseDriveFileId(clip);
                        const duration = clipDurationSeconds(clip);
                        return (
                        <div 
                            key={clip.id} 
                            className="glass-card animate-fade-in-up !p-0 overflow-hidden hover:border-mint-500/35 shadow-lg flex flex-col" 
                            style={{ animationDelay: `${i * 0.06}s` }}
                        >
                            {/* Preview area */}
                            <div className="h-44 bg-gradient-to-br from-[#0d0c12] to-[#12101b] flex items-center justify-center relative overflow-hidden border-b border-white/5">
                                {(clip.thumbnail_url || mediaLinks[clip.id]?.thumbnailUrl) ? (
                                    <button
                                        type="button"
                                        onClick={() => void openPreview(clip)}
                                        className="absolute inset-0 w-full h-full group cursor-pointer border-0 bg-transparent p-0"
                                        title="Preview clip"
                                    >
                                        <img 
                                            src={mediaLinks[clip.id]?.thumbnailUrl || clip.thumbnail_url || undefined} 
                                            alt={clip.title || `Clip ${clip.clip_index + 1}`} 
                                            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
                                        />
                                        <span className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <span className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                                                <Play size={17} className="text-white ml-0.5" fill="currentColor" />
                                            </span>
                                        </span>
                                    </button>
                                ) : (
                                    <div className="flex flex-col items-center gap-2">
                                        <Film size={36} className="text-[#64748b]/20" />
                                        {driveId && (
                                            <button
                                                type="button"
                                                onClick={() => setPreviewClip(clip)}
                                                className="btn-secondary px-3 py-1.5 text-[10px] font-semibold flex items-center gap-1.5"
                                            >
                                                <Play size={11} /> Preview
                                            </button>
                                        )}
                                    </div>
                                )}
                                {clip.viral_score != null && (
                                    <div 
                                        className={`absolute top-2.5 right-2.5 flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold backdrop-blur-md border ${
                                            clip.viral_score >= 80 
                                                ? "bg-emerald-500/20 text-[#10b981] border-emerald-500/20" 
                                                : "bg-amber-500/20 text-[#f59e0b] border-amber-500/20"
                                        }`}
                                    >
                                        <Star size={13} /> {clip.viral_score}
                                    </div>
                                )}
                                {duration != null && (
                                    <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded bg-black/70 text-[10px] font-bold text-slate-200 backdrop-blur-sm">
                                        {Math.round(duration)}s
                                    </div>
                                )}
                            </div>

                            {/* Info */}
                            <div className="p-4 flex-1 flex flex-col justify-between">
                                <div>
                                    <h3 className="text-sm font-bold text-slate-100 mb-1 leading-snug">
                                        {clip.title || `Clip ${clip.clip_index + 1}`}
                                    </h3>
                                    {clip.hook_caption && (
                                        <p className="text-xs text-[#64748b] mb-3 leading-relaxed line-clamp-2 italic">
                                            &ldquo;{clip.hook_caption}&rdquo;
                                        </p>
                                    )}
                                    {clip.hashtags && clip.hashtags.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mb-3.5">
                                            {clip.hashtags.slice(0, 4).map((tag) => (
                                                <span key={tag} className="text-[9px] px-2 py-0.5 rounded bg-mint-500/10 text-mint-300 font-semibold border border-mint-500/10">{tag}</span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="flex gap-1.5 mt-auto">
                                    <button 
                                        className="btn-primary flex-1 justify-center py-2 px-2.5 text-xs font-semibold shadow-md" 
                                        onClick={() => handleDownload(clip)}
                                        disabled={!isStored(clip) && !clip.drive_url}
                                    >
                                        <Download size={13} /> Video
                                    </button>
                                    {(mediaLinks[clip.id]?.thumbnailUrl || clip.thumbnail_url) && (
                                        <button 
                                            className="btn-secondary py-2 px-2.5 text-xs font-semibold" 
                                            onClick={() => {
                                                if (isStored(clip)) triggerRouteDownload(clip, "thumb");
                                                else if (clip.thumbnail_url) triggerDownload(clip.thumbnail_url);
                                            }} 
                                            title="Download Thumbnail"
                                        >
                                            <Image size={13} />
                                        </button>
                                    )}
                                    <button
                                        className="btn-secondary py-2 px-2.5 text-xs font-semibold"
                                        onClick={() => handleCopy(clip.id, `${clip.title}\n\n${clip.hook_caption}\n\n${clip.hashtags?.join(" ")}`)}
                                        title={copiedId === clip.id ? "Copied!" : "Copy caption & hashtags"}
                                    >
                                        {copiedId === clip.id ? <Check size={13} className="text-[#10b981]" /> : <Copy size={13} />}
                                    </button>
                                    {clip.drive_url && !isStored(clip) && (
                                        <a 
                                            href={clip.drive_url} 
                                            target="_blank" 
                                            rel="noopener noreferrer" 
                                            className="btn-secondary py-2 px-2.5 text-xs font-semibold" 
                                            title="Open in Drive"
                                        >
                                            <ExternalLink size={13} />
                                        </a>
                                    )}
                                </div>
                            </div>
                        </div>
                        );
                    })}
                </div>
            )}

            {/* ─── Inline clip preview (Google Drive player) ─── */}
            {previewClip && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                    onClick={() => setPreviewClip(null)}
                >
                    <div
                        className="relative w-full max-w-[340px]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={() => setPreviewClip(null)}
                            className="absolute -top-10 right-0 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 flex items-center justify-center text-slate-200 cursor-pointer transition-colors"
                            aria-label="Close preview"
                        >
                            <X size={16} />
                        </button>
                        <div
                            className="relative w-full rounded-2xl overflow-hidden border border-white/10 bg-black shadow-2xl"
                            style={{ aspectRatio: "9 / 16" }}
                        >
                            {previewStreamUrl ? (
                                <video
                                    src={previewStreamUrl}
                                    className="absolute inset-0 w-full h-full object-contain"
                                    controls
                                    autoPlay
                                    playsInline
                                />
                            ) : previewDriveId ? (
                                <iframe
                                    src={`https://drive.google.com/file/d/${previewDriveId}/preview`}
                                    className="absolute inset-0 w-full h-full"
                                    allow="autoplay; fullscreen"
                                    allowFullScreen
                                    title={previewClip.title || `Clip ${previewClip.clip_index + 1}`}
                                />
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center text-xs text-[#64748b] px-6 text-center">
                                    Preview isn&apos;t available for this clip yet.
                                </div>
                            )}
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-200 truncate">
                                {previewClip.title || `Clip ${previewClip.clip_index + 1}`}
                            </span>
                            <div className="flex gap-1.5 flex-shrink-0">
                                <button
                                    className="btn-primary py-1.5 px-3 text-[11px] font-semibold"
                                    onClick={() => handleDownload(previewClip)}
                                >
                                    <Download size={12} /> Download
                                </button>
                                {previewClip.drive_url && !isStored(previewClip) && (
                                    <a
                                        href={previewClip.drive_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="btn-secondary py-1.5 px-3 text-[11px] font-semibold"
                                    >
                                        <ExternalLink size={12} /> Drive
                                    </a>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
