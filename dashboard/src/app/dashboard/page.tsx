"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownUp, ArrowRight, CheckCircle2, Clapperboard, Clock3, Film, FolderOpen, Plus, RefreshCw, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { createLoadScope } from "@/lib/load-scope";
import type { Job, JobStatus } from "@/lib/types";
import { boundedPercent, formatDate, isJobRunning, sourceLabel, videoTitle } from "@/lib/dashboard";
import { useDashboard } from "./_components/dashboard-provider";
import { Button, EmptyState, LoadingState, Metrics, Notice, PageHeader, StatusBadge } from "./_components/ui";

type Filter = "all" | "processing" | "done" | "failed" | "queued" | "cancelled";
const FILTERS: { value: Filter; label: string }[] = [
    { value: "all", label: "All videos" }, { value: "processing", label: "Processing" },
    { value: "queued", label: "Queued" }, { value: "done", label: "Completed" },
    { value: "failed", label: "Failed" }, { value: "cancelled", label: "Cancelled" },
];

export default function JobsPage() {
    const supabase = useMemo(() => createClient(), []);
    const { account, profile, loading: accountLoading, refreshProfile } = useDashboard();
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<Filter>("all");
    const [sort, setSort] = useState("newest");
    const [dataAccountId, setDataAccountId] = useState<string | null>(null);
    const reloadRef = useRef<{ accountId: string; load: () => Promise<void> } | null>(null);
    const loadJobs = useCallback(async () => {
        const reload = reloadRef.current;
        if (reload && reload.accountId === account?.id) await reload.load();
    }, [account?.id]);

    useEffect(() => {
        const scope = createLoadScope();
        const accountId = account?.id;
        let currentJobs: Job[] = [];
        setJobs([]);
        setDataAccountId(null);
        setError(null);
        setRefreshing(false);
        setLoading(!!accountId);
        if (!accountId) return () => scope.dispose();
        async function load() {
            if (!scope.active || scope.busy) return;
            try {
                const { data, error: queryError } = await scope.run((signal) =>
                    supabase.from("jobs").select("*").eq("user_id", accountId).order("created_at", { ascending: false }).abortSignal(signal));
                if (queryError) throw queryError;
                if (!scope.active) return;
                currentJobs = (data || []) as Job[];
                setJobs(currentJobs);
                setDataAccountId(accountId!);
                setError(null);
            } catch {
                if (scope.active) setError("Your videos couldn’t be loaded. Your work is safe—please try again.");
            } finally {
                if (scope.active) { setLoading(false); setRefreshing(false); }
            }
        }
        const reload = { accountId, load };
        reloadRef.current = reload;
        void load();
        const timer = setInterval(() => {
            if (document.visibilityState === "visible" && currentJobs.some((job) => isJobRunning(job.status))) void load();
        }, 8000);
        const channel = supabase.channel(`workspace-jobs-${accountId}`).on("postgres_changes", {
            event: "*", schema: "public", table: "jobs", filter: `user_id=eq.${accountId}`,
        }, () => { if (scope.active) { void load(); void refreshProfile(); } }).subscribe();
        return () => {
            scope.dispose();
            clearInterval(timer);
            void supabase.removeChannel(channel);
            if (reloadRef.current === reload) reloadRef.current = null;
        };
    }, [account?.id, refreshProfile, supabase]);
    const accountJobs = useMemo(() => dataAccountId === account?.id ? jobs : [], [account?.id, dataAccountId, jobs]);

    const visibleJobs = useMemo(() => accountJobs.filter((job) => {
        if (filter === "processing" ? !isJobRunning(job.status) : filter !== "all" && job.status !== filter) return false;
        const query = search.trim().toLowerCase();
        return !query || [videoTitle(job), job.video_url, job.caption_style].some((value) => value?.toLowerCase().includes(query));
    }).sort((a, b) => sort === "oldest" ? Date.parse(a.created_at) - Date.parse(b.created_at) : sort === "clips" ? b.clips_count - a.clips_count : Date.parse(b.created_at) - Date.parse(a.created_at)), [accountJobs, filter, search, sort]);

    const pending = accountLoading || (loading && !!account);
    const running = accountJobs.filter((job) => isJobRunning(job.status)).length;
    const completed = accountJobs.filter((job) => job.status === "done").length;
    const clips = accountJobs.reduce((count, job) => count + (job.clips_count || 0), 0);
    const name = profile?.full_name?.trim().split(/\s+/)[0];
    const clearFilters = () => { setSearch(""); setFilter("all"); };

    return <div className="studio-page">
        <PageHeader eyebrow={name ? `Your workspace, ${name}` : "Your workspace"} title="My videos" description="From one long video to your next great clip. All your projects, in one place."
            actions={<Link href="/dashboard/new" className="studio-button studio-button--primary"><Plus size={18} aria-hidden="true" />New video</Link>} />
        <Metrics loading={pending} items={[
            { label: "Total videos", value: accountJobs.length, icon: Film },
            { label: "In progress", value: running, icon: Clock3 },
            { label: "Completed", value: completed, icon: CheckCircle2 },
            { label: "Clips created", value: clips, icon: Clapperboard },
        ]} />
        <section className="studio-library" aria-labelledby="library-title">
            <div className="studio-library-heading"><div><h2 id="library-title">Video library</h2><span>{pending ? "Loading your projects…" : `${accountJobs.length} project${accountJobs.length === 1 ? "" : "s"}`}</span></div>
                <Button variant="ghost" className="studio-icon-button" aria-label="Refresh videos" title="Refresh videos" busy={refreshing} onClick={() => { setRefreshing(true); void loadJobs(); }} disabled={pending || !account}><RefreshCw size={17} aria-hidden="true" /></Button>
            </div>
            <div className="studio-library-toolbar">
                <div className="studio-filter-tabs" role="group" aria-label="Filter videos">
                    {FILTERS.map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}{item.value === "processing" && running > 0 && <span>{running}</span>}</button>)}
                </div>
                <div className="studio-library-tools">
                    <label className="studio-search"><span className="studio-sr-only">Search videos</span><Search size={17} aria-hidden="true" /><input type="search" className="studio-input" placeholder="Search videos…" value={search} onChange={(e) => setSearch(e.target.value)} />{search && <Button variant="ghost" className="studio-icon-button" aria-label="Clear search" onClick={() => setSearch("")}><X size={16} aria-hidden="true" /></Button>}</label>
                    <label className="studio-sort"><ArrowDownUp size={16} aria-hidden="true" /><span className="studio-sr-only">Sort videos</span><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="clips">Most clips</option></select></label>
                </div>
            </div>
            {error && <div className="studio-library-notice"><Notice tone="error" action={<Button variant="secondary" onClick={() => void loadJobs()}>Try again</Button>}>{error}</Notice></div>}
            {pending ? <LoadingState rows={4} label="Loading videos" /> : !account ? <EmptyState title="Account unavailable" description="Refresh your account details to view your videos." action={<Button variant="secondary" onClick={() => void refreshProfile()}>Refresh account</Button>} /> : !error && visibleJobs.length === 0 ? <EmptyState icon={search || filter !== "all" ? Search : FolderOpen} title={search || filter !== "all" ? "No matching videos" : "Your first clip starts here"} description={search || filter !== "all" ? "Try another search or clear the filters to see all your videos." : "Add a video link or upload a file. We’ll turn the best moments into captioned clips."} action={search || filter !== "all" ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button> : <Link href="/dashboard/new" className="studio-button studio-button--primary"><Plus size={17} aria-hidden="true" />Create your first video</Link>} /> : <>
                <div className="studio-video-columns" aria-hidden="true"><span>Video</span><span>Status</span><span>Clips</span><span>Created</span><span /></div>
                <ul className="studio-video-list" aria-label="Your videos">{visibleJobs.map((job) => <li key={job.id}>
                    <Link href={`/dashboard/${job.id}`} className="studio-video-row">
                        <div className="studio-video-info"><span className={`studio-video-symbol ${job.status === "done" ? "is-complete" : ""}`}><Film size={22} aria-hidden="true" /></span><div><h3>{videoTitle(job)}</h3><p>{sourceLabel(job)}<span aria-hidden="true">·</span>{job.caption_style.charAt(0).toUpperCase() + job.caption_style.slice(1)}<span className="studio-video-date-mobile"> · {formatDate(job.created_at)}</span></p></div></div>
                        <div className="studio-video-status"><StatusBadge status={job.status as JobStatus} />{isJobRunning(job.status) && job.status !== "queued" && <span className="studio-row-progress">{boundedPercent(job.progress)}%</span>}</div>
                        <span className="studio-video-count">{job.clips_count || "—"}<span className="studio-video-count-label"> clips</span></span>
                        <time className="studio-video-date" dateTime={job.created_at}>{formatDate(job.created_at)}</time>
                        <ArrowRight size={17} className="studio-video-arrow" aria-hidden="true" />
                    </Link>
                </li>)}</ul>
                {visibleJobs.length > 0 && <div className="studio-library-footer">Showing {visibleJobs.length} of {accountJobs.length} videos<span>Updates automatically while processing</span></div>}
            </>}
        </section>
    </div>;
}
