"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Download, ExternalLink, Film, Gauge, Image as ImageIcon, Play, RefreshCw, Search, Star } from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { Clip, Job } from "@/lib/types";
import { boundedPercent, captionText, clipSeconds, formatDate, formatDuration, isJobRunning, sourceLabel, videoTitle } from "@/lib/dashboard";
import { useDashboard } from "../_components/dashboard-provider";
import { Button, Dialog, EmptyState, LoadingState, Notice, PageHeader, SectionHeading, StatusBadge } from "../_components/ui";

const STAGES = ["downloading", "transcribing", "analyzing", "clipping", "captioning", "uploading"];
const STAGE_LABELS = ["Download", "Transcribe", "Analyze", "Clip", "Caption", "Upload"];

function driveId(clip: Clip): string | null {
    return clip.drive_file_id || clip.drive_url?.match(/\/file\/d\/([^/?#]+)/)?.[1] || clip.drive_url?.match(/[?&]id=([^&#]+)/)?.[1] || null;
}
function downloadable(clip: Clip) { return !!(clip.storage_path || clip.drive_url); }

function ClipPreview({ clip, thumbnail, onPreview }: { clip: Clip; thumbnail?: string | null; onPreview: () => void }) {
    const [failedImage, setFailedImage] = useState(false);
    const available = !!(clip.storage_path || driveId(clip));
    return <div className="studio-clip-preview">
        {thumbnail && !failedImage ? <img src={thumbnail} alt="" onError={() => setFailedImage(true)} /> : <div className="studio-clip-preview-empty"><Film size={28} aria-hidden="true" /><span>{available ? "Clip ready to preview" : "Preview not available"}</span></div>}
        {available && <button type="button" className="studio-clip-play" onClick={onPreview} aria-label={`Preview ${clip.title || clip.filename}`}><Play size={18} aria-hidden="true" />Preview</button>}
        <span className="studio-clip-duration">{formatDuration(clipSeconds(clip))}</span>
        <span className="studio-clip-index">Clip {clip.clip_index + 1}{clip.variant ? ` · ${clip.variant.replace("x", ":")}` : ""}</span>
    </div>;
}

export default function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
    const { jobId } = use(params);
    const supabase = useMemo(() => createClient(), []);
    const { account, loading: accountLoading, refreshProfile } = useDashboard();
    const [job, setJob] = useState<Job | null>(null);
    const [clips, setClips] = useState<Clip[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [retrying, setRetrying] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);
    const [preview, setPreview] = useState<Clip | null>(null);
    const [previewFailed, setPreviewFailed] = useState(false);
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState("order");
    const [downloadingAll, setDownloadingAll] = useState(false);
    const [mediaLinks, setMediaLinks] = useState<Record<string, { thumbnailUrl: string | null }>>({});
    const [now, setNow] = useState(() => Date.now());
    const mounted = useRef(false);
    const inFlight = useRef(false);
    const lastLinks = useRef(0);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const currentStatus = useRef<Job["status"] | null>(null);

    const load = useCallback(async () => {
        if (!account || inFlight.current) return;
        inFlight.current = true;
        try {
            const [jobResponse, clipResponse] = await Promise.all([
                supabase.from("jobs").select("*").eq("id", jobId).eq("user_id", account.id).maybeSingle(),
                supabase.from("clips").select("*").eq("job_id", jobId).eq("user_id", account.id).order("clip_index", { ascending: true }),
            ]);
            if (jobResponse.error || clipResponse.error) throw jobResponse.error || clipResponse.error;
            if (!mounted.current) return;
            const next = jobResponse.data as Job | null;
            const nextClips = (clipResponse.data || []) as Clip[];
            setJob(next);
            setClips(nextClips);
            currentStatus.current = next?.status || null;
            setError(null);
            setNow(Date.now());
            if (nextClips.some((clip) => clip.storage_path) && Date.now() - lastLinks.current > 30 * 60 * 1000) {
                try {
                    const response = await fetch(`/api/clips/${jobId}/links`);
                    const payload = await response.json();
                    if (response.ok && payload?.links && mounted.current) { setMediaLinks(payload.links); lastLinks.current = Date.now(); }
                } catch { /* Missing thumbnails must not hide the video itself. */ }
            }
        } catch { if (mounted.current) setError("This video couldn’t be loaded. Please try again."); }
        finally { inFlight.current = false; if (mounted.current) setLoading(false); }
    }, [account, jobId, supabase]);

    useEffect(() => {
        mounted.current = true;
        currentStatus.current = null;
        lastLinks.current = 0;
        const frame = requestAnimationFrame(() => { setLoading(true); setJob(null); setClips([]); void load(); });
        const timer = setInterval(() => { if (currentStatus.current && isJobRunning(currentStatus.current) && document.visibilityState === "visible") void load(); }, 4000);
        const channel = supabase.channel(`workspace-job-${jobId}`).on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `id=eq.${jobId}` }, () => { void load(); void refreshProfile(); }).on("postgres_changes", { event: "*", schema: "public", table: "clips", filter: `job_id=eq.${jobId}` }, () => void load()).subscribe();
        return () => { mounted.current = false; cancelAnimationFrame(frame); clearInterval(timer); void supabase.removeChannel(channel); timers.current.forEach(clearTimeout); timers.current = []; };
    }, [jobId, load, refreshProfile, supabase]);

    useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(null), 2200); return () => clearTimeout(timer); }, [copied]);

    async function retryJob() {
        if (!job || !account || retrying) return;
        setRetrying(true);
        setActionError(null);
        try {
            // Reset the persisted status too; the dispatcher does not do this.
            const { error: resetError } = await supabase.from("jobs").update({ status: "queued", progress: 0, error_message: null }).eq("id", job.id).eq("user_id", account!.id);
            if (resetError) throw new Error("This project couldn’t be prepared for retry. Please try again.");
            const response = await fetch("/api/trigger-pipeline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, resume: !!job.checkpoint_url }) });
            if (!response.ok) { const payload = await response.json().catch(() => null); throw new Error(payload?.error || "Processing couldn’t restart. Please try again."); }
            currentStatus.current = "queued";
            await load();
            void refreshProfile();
        } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Couldn’t restart processing. Please try again."); }
        finally { setRetrying(false); }
    }

    function download(clip: Clip, kind: "video" | "thumb" = "video") {
        let url: string | null = null;
        if (clip.storage_path) url = `/api/clips/${clip.id}/download${kind === "thumb" ? "?kind=thumb" : ""}`;
        else if (kind === "thumb") url = clip.thumbnail_url;
        else if (driveId(clip)) url = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveId(clip)!)}`;
        else url = clip.drive_url;
        if (!url) return;
        const frame = document.createElement("iframe");
        frame.style.display = "none";
        frame.src = url;
        document.body.appendChild(frame);
        timers.current.push(setTimeout(() => frame.remove(), 120000));
    }

    async function copyCaption(clip: Clip) {
        try { await navigator.clipboard.writeText(captionText(clip)); setCopied(clip.id); }
        catch { setActionError("Clipboard access was blocked. Open the caption text below and copy it manually."); }
    }

    const availableClips = clips.filter(downloadable);
    function downloadAll() {
        if (!availableClips.length || downloadingAll) return;
        setDownloadingAll(true);
        availableClips.forEach((clip, index) => timers.current.push(setTimeout(() => { download(clip); if (index === availableClips.length - 1) setDownloadingAll(false); }, index * 1200)));
    }
    const visibleClips = clips.filter((clip) => !search.trim() || [clip.title, clip.filename, clip.hook_caption].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase()))).sort((a, b) => sort === "score" ? (b.viral_score || 0) - (a.viral_score || 0) : a.clip_index - b.clip_index);
    const running = !!job && isJobRunning(job.status);
    const stuck = running && now - new Date(job.started_at || job.created_at).getTime() > 45 * 60 * 1000;
    const stageIndex = job ? STAGES.indexOf(job.status) : -1;
    const previewUrl = preview?.storage_path ? `/api/clips/${preview.id}/download?inline=1` : null;
    const previewDriveId = preview ? driveId(preview) : null;

    return <div className="studio-page">
        <Link href="/dashboard" className="studio-back-link"><ArrowLeft size={16} aria-hidden="true" />Back to videos</Link>
        {!account && !accountLoading ? <Notice tone="error" action={<Button variant="secondary" onClick={() => void refreshProfile()}>Refresh account</Button>}>Your account is temporarily unavailable.</Notice> : loading ? <div className="studio-panel"><LoadingState label="Loading video details" rows={4} /></div> : error ? <Notice tone="error" action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>}>{error}</Notice> : !job ? <div className="studio-panel"><EmptyState icon={Film} title="Video not found" description="This project doesn’t exist or you don’t have access to it." action={<Link href="/dashboard" className="studio-button studio-button--secondary">View your videos</Link>} /></div> : <>
            <PageHeader eyebrow={sourceLabel(job)} title={videoTitle(job)} description={`Created ${formatDate(job.created_at, true)} · Project ${job.id.slice(0, 8)}`} actions={<Button variant="secondary" busy={downloadingAll} disabled={!availableClips.length} onClick={downloadAll}><Download size={17} aria-hidden="true" />{downloadingAll ? "Starting downloads…" : `Download all (${availableClips.length})`}</Button>}><div className="studio-detail-status"><StatusBadge status={job.status} /><span>{job.caption_style} captions</span><span>{job.job_mode === "captions" ? "Full video" : "Short clips"}</span></div></PageHeader>
            {actionError && <Notice tone="error">{actionError}</Notice>}
            <section className="studio-panel studio-project-overview"><dl><div><dt>Caption style</dt><dd>{job.caption_style}</dd></div><div><dt>Requested output</dt><dd>{job.job_mode === "captions" ? "1 full video" : `Up to ${job.max_clips} clips`}</dd></div><div><dt>Created clips</dt><dd>{clips.length}</dd></div><div><dt>Source duration</dt><dd>{formatDuration(job.video_duration_seconds)}</dd></div></dl></section>
            {(running || job.status === "done") && <section className="studio-panel"><SectionHeading title={job.status === "done" ? "Your video is ready" : "Processing your video"} description={job.status === "queued" ? "Waiting for a processing slot. This page updates automatically." : job.status === "done" ? "All processing stages are complete." : "You can leave this page. Your progress is saved."} action={<span className="studio-project-progress">{boundedPercent(job.progress)}%</span>} />
                <ol className="studio-pipeline">{STAGES.map((stage, index) => { const done = job.status === "done" || index < stageIndex; const active = stageIndex === index; return <li key={stage} data-state={done ? "done" : active ? "active" : "pending"} aria-current={active ? "step" : undefined}><span>{done ? <Check size={16} aria-hidden="true" /> : index + 1}</span><strong>{STAGE_LABELS[index]}</strong></li>; })}</ol>
            </section>}
            {(job.status === "failed" || job.status === "cancelled" || stuck) && <Notice tone={job.status === "failed" ? "error" : "warning"} title={job.status === "failed" ? "Processing needs attention" : job.status === "cancelled" ? "This video was cancelled" : "This video is taking longer than expected"} action={<Button variant="secondary" busy={retrying} onClick={() => void retryJob()}><RefreshCw size={16} aria-hidden="true" />{retrying ? "Retrying…" : "Retry processing"}</Button>}>
                {job.error_message || (stuck ? "This project has been running for more than 45 minutes. Check the status before retrying." : "You can retry using the saved video source.")}
            </Notice>}
            <section aria-labelledby="clip-library-title"><div className="studio-clips-heading"><div><h2 id="clip-library-title">Your clips <span>{clips.length}</span></h2><p>Preview, download, and copy the caption for each moment.</p></div>{!!clips.length && <div className="studio-clips-tools"><label className="studio-search"><Search size={17} aria-hidden="true" /><span className="studio-sr-only">Search clips</span><input type="search" className="studio-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search clips…" /></label><label><span className="studio-sr-only">Sort clips</span><select className="studio-select" value={sort} onChange={(event) => setSort(event.target.value)}><option value="order">Clip order</option><option value="score">Highest AI score</option></select></label></div>}</div>
                {!visibleClips.length ? <div className="studio-panel"><EmptyState icon={Film} title={search ? "No matching clips" : running ? "Your clips are on the way" : "No clips yet"} description={search ? "Try another search to find a moment." : running ? "Completed clips will appear here as your video is processed." : "No clips were generated for this project."} /></div> : <div className="studio-clip-grid">{visibleClips.map((clip) => <article className="studio-clip-card" key={clip.id}>
                    <ClipPreview clip={clip} thumbnail={mediaLinks[clip.id]?.thumbnailUrl || clip.thumbnail_url} onPreview={() => { setPreview(clip); setPreviewFailed(false); }} />
                    <div className="studio-clip-content"><h3>{clip.title || clip.filename}</h3>{clip.hook_caption && <p className="studio-clip-hook">{clip.hook_caption}</p>}
                        <div className="studio-clip-scores">{clip.viral_score != null && <span title="AI estimate, not measured social performance"><Star size={15} aria-hidden="true" />AI score {clip.viral_score}</span>}{clip.quality_score != null && <span><Gauge size={15} aria-hidden="true" />Quality {clip.quality_score}</span>}</div>
                        {clip.hashtags?.length ? <div className="studio-clip-tags">{clip.hashtags.slice(0, 4).map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</div> : null}
                        <div className="studio-clip-actions"><Button onClick={() => download(clip)} disabled={!downloadable(clip)}><Download size={16} aria-hidden="true" />Download</Button><Button variant="secondary" onClick={() => void copyCaption(clip)} disabled={!captionText(clip)} aria-label={`Copy caption for ${clip.title || clip.filename}`} title="Copy caption">{copied === clip.id ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied === clip.id ? "Copied" : "Caption"}</Button></div>
                        <div className="studio-clip-secondary">{(clip.thumbnail_url || clip.thumbnail_path || clip.thumbnail_drive_id) && <Button variant="ghost" onClick={() => download(clip, "thumb")}><ImageIcon size={15} aria-hidden="true" />Thumbnail</Button>}{!clip.storage_path && clip.drive_url && <a className="studio-button studio-button--ghost" href={clip.drive_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} aria-hidden="true" />Open in Drive</a>}</div>
                        {clip.quality_report?.checks?.length ? <details className="studio-quality-report"><summary>Quality report <Gauge size={15} aria-hidden="true" /></summary><ul>{clip.quality_report.checks.map((check) => <li key={check.id}><span data-status={check.status}>{check.status === "fail" ? "Needs attention" : check.status === "warn" ? "Review" : "Passed"}</span><strong>{check.label}</strong><p>{check.value}{check.detail ? ` · ${check.detail}` : ""}</p></li>)}</ul></details> : null}
                        <details className="studio-caption-text"><summary>Caption & hashtags</summary><p>{captionText(clip) || "No caption text is available."}</p></details>
                    </div>
                </article>)}</div>}
            </section>
            <Dialog open={!!preview} onClose={() => setPreview(null)} title={preview?.title || "Clip preview"} description={preview ? `${formatDuration(clipSeconds(preview))} · ${preview.filename}` : undefined} wide actions={<><Button variant="secondary" onClick={() => setPreview(null)}>Close</Button>{preview && <Button disabled={!downloadable(preview)} onClick={() => download(preview)}><Download size={17} aria-hidden="true" />Download clip</Button>}</>}>
                <div className="studio-preview-player">{previewUrl && !previewFailed ? <video src={previewUrl} controls autoPlay playsInline onError={() => setPreviewFailed(true)} /> : previewDriveId && !previewFailed ? <iframe src={`https://drive.google.com/file/d/${encodeURIComponent(previewDriveId)}/preview`} allow="autoplay; fullscreen" allowFullScreen title="Video clip preview" /> : <EmptyState icon={Film} title={previewFailed ? "Preview couldn’t load" : "Preview unavailable"} description="You can still download the clip if its file is available." />}</div>
            </Dialog>
        </>}
    </div>;
}
