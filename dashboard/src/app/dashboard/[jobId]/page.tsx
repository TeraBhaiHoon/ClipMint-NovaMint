"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Download, ExternalLink, Film, Gauge, Image as ImageIcon, Play, RefreshCw, Search, Star } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { createLoadScope, LoadTimeoutError, type LoadScope } from "@/lib/load-scope";
import { CAPTION_LANGUAGES, SOURCE_LANGUAGES, type Clip, type Job } from "@/lib/types";
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
    const { account, usageReady, loading: accountLoading, refreshProfile } = useDashboard();
    const [storedJob, setJob] = useState<Job | null>(null);
    const [storedClips, setClips] = useState<Clip[]>([]);
    const job = storedJob?.id === jobId && storedJob.user_id === account?.id ? storedJob : null;
    const clips = job ? storedClips : [];
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [retrying, setRetrying] = useState(false);
    const [resumeRetry, setResumeRetry] = useState(true);
    const [copied, setCopied] = useState<string | null>(null);
    const [storedPreview, setPreview] = useState<Clip | null>(null);
    const preview = job ? storedPreview : null;
    const [previewFailed, setPreviewFailed] = useState(false);
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState("order");
    const [downloadingAll, setDownloadingAll] = useState(false);
    const [mediaLinks, setMediaLinks] = useState<Record<string, { thumbnailUrl: string | null }>>({});
    const [now, setNow] = useState(() => Date.now());
    const scope = useRef<LoadScope | null>(null);
    const loadIdentity = useRef<string | null>(null);
    const retryScope = useRef<LoadScope | null>(null);
    const thumbnailScope = useRef<LoadScope | null>(null);
    const lastLinks = useRef(0);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const currentStatus = useRef<Job["status"] | null>(null);
    const identity = `${account?.id || ""}:${jobId}`;

    const loadThumbnails = useCallback(async (nextClips: Clip[]) => {
        const request = thumbnailScope.current;
        if (loadIdentity.current !== identity || !request?.active || request.busy || !nextClips.some((clip) => clip.storage_path) || Date.now() - lastLinks.current <= 30 * 60 * 1000) return;
        lastLinks.current = Date.now();
        try {
            const payload = await request.run(async (signal) => {
                const response = await fetch(`/api/clips/${jobId}/links`, { signal });
                if (!response.ok) throw new Error("Thumbnails unavailable");
                return await response.json();
            });
            if (request.active && thumbnailScope.current === request && payload?.links) setMediaLinks(payload.links);
        } catch { /* Optional thumbnails must not block video details or retry controls. */ }
    }, [identity, jobId]);

    const load = useCallback(async () => {
        const request = scope.current;
        if (!account || loadIdentity.current !== identity || !request?.active || request.busy) return;
        try {
            const [jobResponse, clipResponse] = await request.run((signal) => Promise.all([
                supabase.from("jobs").select("*").eq("id", jobId).eq("user_id", account.id).abortSignal(signal).maybeSingle(),
                supabase.from("clips").select("*").eq("job_id", jobId).eq("user_id", account.id).order("clip_index", { ascending: true }).abortSignal(signal),
            ]));
            if (jobResponse.error || clipResponse.error) throw jobResponse.error || clipResponse.error;
            if (!request.active || scope.current !== request) return;
            const next = jobResponse.data as Job | null;
            const nextClips = (clipResponse.data || []) as Clip[];
            setJob(next);
            setClips(nextClips);
            currentStatus.current = next?.status || null;
            setError(null);
            setNow(Date.now());
            void loadThumbnails(nextClips);
        } catch (cause) {
            if (request.active && scope.current === request) setError(cause instanceof LoadTimeoutError ? "Loading this video took too long. Please try again." : "This video couldn’t be loaded. Please try again.");
        } finally {
            if (request.active && scope.current === request) setLoading(false);
        }
    }, [account, identity, jobId, loadThumbnails, supabase]);

    useEffect(() => {
        const request = createLoadScope();
        const retry = createLoadScope(30_000);
        const thumbnails = createLoadScope(10_000);
        retryScope.current = retry;
        scope.current = request;
        loadIdentity.current = identity;
        thumbnailScope.current = thumbnails;
        currentStatus.current = null;
        lastLinks.current = 0;
        const initialLoad = setTimeout(() => {
            setLoading(true); setError(null); setJob(null); setClips([]); setMediaLinks({}); setPreview(null); setActionError(null); setRetrying(false); setResumeRetry(true);
            void load();
        }, 0);
        const refreshWhenVisible = () => { if (document.visibilityState === "visible") void load(); };
        const timer = setInterval(() => { if (currentStatus.current && isJobRunning(currentStatus.current)) refreshWhenVisible(); }, 4000);
        window.addEventListener("focus", refreshWhenVisible);
        document.addEventListener("visibilitychange", refreshWhenVisible);
        const channel = supabase.channel(`workspace-job-${jobId}`).on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `id=eq.${jobId}` }, () => { void load(); void refreshProfile(); }).on("postgres_changes", { event: "*", schema: "public", table: "clips", filter: `job_id=eq.${jobId}` }, () => void load()).subscribe();
        return () => {
            request.dispose(); retry.dispose(); thumbnails.dispose();
            if (retryScope.current === retry) retryScope.current = null;
            if (scope.current === request) { scope.current = null; loadIdentity.current = null; }
            if (thumbnailScope.current === thumbnails) thumbnailScope.current = null;
            clearTimeout(initialLoad); clearInterval(timer);
            window.removeEventListener("focus", refreshWhenVisible);
            document.removeEventListener("visibilitychange", refreshWhenVisible);
            void supabase.removeChannel(channel);
            timers.current.forEach(clearTimeout); timers.current = [];
        };
    }, [identity, jobId, load, refreshProfile, supabase]);

    useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(null), 2200); return () => clearTimeout(timer); }, [copied]);

    async function retryJob() {
        const request = retryScope.current;
        if (!job || !account || !usageReady || retrying || isJobRunning(job.status) || !request?.active || request.busy || loadIdentity.current !== identity) return;
        const current = () => request.active && retryScope.current === request && loadIdentity.current === identity;
        setRetrying(true);
        setActionError(null);
        try {
            await request.run(async (signal) => {
                const response = await fetch("/api/trigger-pipeline", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, resume: resumeRetry && !!job.checkpoint_url }) });
                if (!response.ok) { const payload = await response.json().catch(() => null); throw new Error(payload?.error || "Processing couldn’t restart. Please try again."); }
            });
            if (!current()) return;
            currentStatus.current = "queued";
            await load();
            if (current()) void refreshProfile();
        } catch (cause) {
            if (current()) {
                setActionError(cause instanceof LoadTimeoutError ? "The restart response took too long. Processing may have started—refresh this video before trying again." : cause instanceof Error ? cause.message : "Couldn’t restart processing. Please try again.");
                void load();
            }
        } finally {
            if (current()) setRetrying(false);
        }
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
    const stuck = running && now - new Date(job.updated_at || job.started_at || job.created_at).getTime() > 45 * 60 * 1000;
    const stageIndex = job ? STAGES.indexOf(job.status) : -1;
    const previewUrl = preview?.storage_path ? `/api/clips/${preview.id}/download?inline=1` : null;
    const previewDriveId = preview ? driveId(preview) : null;

    return <div className="studio-page">
        <Link href="/dashboard" className="studio-back-link"><ArrowLeft size={16} aria-hidden="true" />Back to videos</Link>
        {!account && !accountLoading ? <Notice tone="error" action={<Button variant="secondary" onClick={() => void refreshProfile()}>Refresh account</Button>}>Your account is temporarily unavailable.</Notice> : loading ? <div className="studio-panel"><LoadingState label="Loading video details" rows={4} /></div> : error ? <Notice tone="error" action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>}>{error}</Notice> : !job ? <div className="studio-panel"><EmptyState icon={Film} title="Video not found" description="This project doesn’t exist or you don’t have access to it." action={<Link href="/dashboard" className="studio-button studio-button--secondary">View your videos</Link>} /></div> : <>
            <PageHeader eyebrow={sourceLabel(job)} title={videoTitle(job)} description={`Created ${formatDate(job.created_at, true)} · Project ${job.id.slice(0, 8)}`} actions={<Button variant="secondary" busy={downloadingAll} disabled={!availableClips.length} onClick={downloadAll}><Download size={17} aria-hidden="true" />{downloadingAll ? "Starting downloads…" : `Download all (${availableClips.length})`}</Button>}><div className="studio-detail-status"><StatusBadge status={job.status} /><span>{job.caption_style} captions</span><span>{job.job_mode === "captions" ? "Full video" : "Short clips"}</span></div></PageHeader>
            {job.transcription_report && <details className="studio-panel studio-quality-report"><summary>Subtitle processing details</summary><dl className="studio-summary-list"><div><dt>Detected language</dt><dd>{job.detected_language || "Not recorded"}</dd></div><div><dt>Output</dt><dd>{CAPTION_LANGUAGES.find((language) => language.value === job.caption_language)?.label || "Legacy output"}</dd></div><div><dt>Word count</dt><dd>{typeof job.transcription_report.words === "number" ? job.transcription_report.words : "Not recorded"}</dd></div></dl><p className="studio-field-hint">AI transcription may need review for names, noise, or overlapping speech. English translations use estimated phrase timing rather than measured English word timing.</p></details>}
            {actionError && <Notice tone="error">{actionError}</Notice>}
            <section className="studio-panel studio-project-overview"><dl><div><dt>Caption style</dt><dd>{job.caption_style}</dd></div><div><dt>Reading pace</dt><dd>{job.caption_pace || "balanced"}</dd></div><div><dt>Requested output</dt><dd>{job.job_mode === "captions" ? "1 full video" : `Up to ${job.max_clips} clips`}</dd></div><div><dt>Created clips</dt><dd>{clips.length}</dd></div><div><dt>Spoken language</dt><dd>{SOURCE_LANGUAGES.find((language) => language.value === job.source_language)?.label || "Auto-detect"}</dd></div><div><dt>Subtitles</dt><dd>{CAPTION_LANGUAGES.find((language) => language.value === job.caption_language)?.label || "Legacy output"}</dd></div><div><dt>Clips charged</dt><dd>{job.quota_clips_charged ?? "—"}</dd></div><div><dt>Source duration</dt><dd>{formatDuration(job.video_duration_seconds)}</dd></div></dl></section>
            {(running || job.status === "done") && <section className="studio-panel"><SectionHeading title={job.status === "done" ? "Your video is ready" : "Processing your video"} description={job.status === "queued" ? "Waiting for a processing slot. This page updates automatically." : job.status === "done" ? "All processing stages are complete." : "You can leave this page. Your progress is saved."} action={<span className="studio-project-progress">{boundedPercent(job.progress)}%</span>} />
                <ol className="studio-pipeline">{STAGES.map((stage, index) => { const done = job.status === "done" || index < stageIndex; const active = stageIndex === index; return <li key={stage} data-state={done ? "done" : active ? "active" : "pending"} aria-current={active ? "step" : undefined}><span>{done ? <Check size={16} aria-hidden="true" /> : index + 1}</span><strong>{STAGE_LABELS[index]}</strong></li>; })}</ol>
            </section>}
            {(job.status === "failed" || job.status === "cancelled" || stuck) && <Notice tone={job.status === "failed" ? "error" : "warning"} title={job.status === "failed" ? "Processing needs attention" : job.status === "cancelled" ? "This video was cancelled" : "This video is taking longer than expected"} action={<Button variant="secondary" busy={retrying} disabled={!usageReady || running} onClick={() => void retryJob()}><RefreshCw size={16} aria-hidden="true" />{retrying ? "Retrying…" : "Retry processing"}</Button>}>
                {job.error_message || (stuck ? "No progress update has arrived for 45 minutes. An active job cannot be started twice." : "You can retry using the saved video source.")}
                {!usageReady && <p className="studio-field-hint">Usage is temporarily unavailable. Refresh your account before retrying.</p>}
                {!running && job.checkpoint_url && <div className="studio-field"><label htmlFor="retry-mode">Retry mode</label><select id="retry-mode" className="studio-select" value={resumeRetry ? "resume" : "fresh"} onChange={(event) => setResumeRetry(event.target.value === "resume")}><option value="resume">Resume saved progress</option><option value="fresh">Start fresh · transcribe again</option></select><p className="studio-field-hint">Start fresh if the saved transcription was inaccurate. Your language and caption settings are retained.</p></div>}
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
