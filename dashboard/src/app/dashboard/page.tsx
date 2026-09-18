"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase";
import Link from "next/link";
import type { Job, JobStatus } from "@/lib/types";
import { JOB_STATUS_LABELS } from "@/lib/types";
import {
    Film,
    Search,
    Filter,
    Plus,
    Clock,
    CheckCircle2,
    Clapperboard,
    ChevronDown,
    X,
    TrendingUp,
} from "lucide-react";

type FilterOption = JobStatus | "all" | "processing";

/** Polling fallback cadence while at least one job is still running. */
const JOBS_POLL_MS = 8000;
const TERMINAL_STATUSES: JobStatus[] = ["done", "failed", "cancelled"];

function isTerminalStatus(status: JobStatus): boolean {
    return TERMINAL_STATUSES.includes(status);
}

const FILTER_OPTIONS: { value: FilterOption; label: string; color: string }[] = [
    { value: "all", label: "All Jobs", color: "var(--text-secondary)" },
    { value: "queued", label: "Queued", color: "#6B7280" },
    { value: "processing", label: "Processing", color: "#F59E0B" },
    { value: "done", label: "Completed", color: "#10B981" },
    { value: "failed", label: "Failed", color: "#EF4444" },
];

function getGreeting(): string {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
}

function timeAgo(date: string): string {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString();
}

export default function JobsPage() {
    const supabase = createClient();
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<FilterOption>("all");
    const [showFilterDropdown, setShowFilterDropdown] = useState(false);
    const [userName, setUserName] = useState("");
    const filterRef = useRef<HTMLDivElement>(null);
    const inFlightRef = useRef(false);
    const jobsRef = useRef<Job[]>([]);

    // Keep a ref of the latest jobs so the polling interval can decide cheaply.
    useEffect(() => { jobsRef.current = jobs; }, [jobs]);

    useEffect(() => {
        let disposed = false;
        let timer: ReturnType<typeof setInterval> | null = null;

        async function loadJobs() {
            if (inFlightRef.current) return; // never overlap requests
            inFlightRef.current = true;
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user || disposed) return;

                // Load name for greeting
                const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
                if (profile?.full_name && !disposed) setUserName(profile.full_name.split(" ")[0]);

                const { data, error } = await supabase
                    .from("jobs")
                    .select("*")
                    .eq("user_id", user.id)
                    .order("created_at", { ascending: false });

                if (disposed) return;
                if (data && !error) setJobs(data as Job[]);
            } finally {
                inFlightRef.current = false;
                if (!disposed) setLoading(false);
            }
        }
        loadJobs();

        // Polling fallback: only while at least one job is non-terminal.
        timer = setInterval(() => {
            if (!jobsRef.current.some((j) => !isTerminalStatus(j.status))) return;
            loadJobs();
        }, JOBS_POLL_MS);

        const channel = supabase
            .channel("jobs-changes")
            .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, (payload) => {
                if (payload.eventType === "INSERT") {
                    const inserted = payload.new as Job;
                    // The polling fallback may already have this row — dedupe by id.
                    setJobs((prev) => (prev.some((j) => j.id === inserted.id) ? prev : [inserted, ...prev]));
                } else if (payload.eventType === "UPDATE") {
                    setJobs((prev) => prev.map((j) => j.id === (payload.new as Job).id ? (payload.new as Job) : j));
                }
            })
            .subscribe();

        return () => {
            disposed = true;
            if (timer) clearInterval(timer);
            supabase.removeChannel(channel);
        };
    }, []);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilterDropdown(false);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const PROCESSING_STATUSES: JobStatus[] = ["downloading", "transcribing", "analyzing", "clipping", "captioning", "uploading"];

    const filteredJobs = jobs.filter((j) => {
        if (statusFilter !== "all") {
            if (statusFilter === "processing") {
                if (!PROCESSING_STATUSES.includes(j.status)) return false;
            } else {
                if (j.status !== statusFilter) return false;
            }
        }
        if (search) {
            const q = search.toLowerCase();
            return (j.video_url || "").toLowerCase().includes(q) || j.caption_style.toLowerCase().includes(q) || (j.video_filename || "").toLowerCase().includes(q);
        }
        return true;
    });

    const totalJobs = jobs.length;
    const processing = jobs.filter((j) => !["done", "failed", "queued", "cancelled"].includes(j.status)).length;
    const completed = jobs.filter((j) => j.status === "done").length;
    const totalClips = jobs.reduce((sum, j) => sum + (j.clips_count || 0), 0);

    const activeFilterLabel = FILTER_OPTIONS.find((f) => f.value === statusFilter);

    const statCards = [
        { label: "Total Jobs", value: totalJobs, icon: Film, color: "var(--accent-primary)", bg: "rgba(108,92,231,0.12)" },
        { label: "Processing", value: processing, icon: Clock, color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
        { label: "Completed", value: completed, icon: CheckCircle2, color: "#10B981", bg: "rgba(16,185,129,0.12)" },
        { label: "Clips Generated", value: totalClips, icon: Clapperboard, color: "#06B6D4", bg: "rgba(6,182,212,0.12)" },
    ];

    return (
        <div>
            {/* ─── Welcome Header ─── */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-1 text-slate-100">
                        {getGreeting()}{userName ? `, ${userName}` : ""} 👋
                    </h1>
                    <p className="text-sm text-[#64748b]">
                        Here&apos;s what&apos;s happening with your content today
                    </p>
                </div>
                <Link href="/dashboard/new" className="btn-primary py-2.5 px-5 text-sm font-semibold flex items-center gap-2 shadow-lg">
                    <Plus size={16} /> New Video
                </Link>
            </div>

            {/* ─── Stat Cards ─── */}
            <div className="dash-grid-4 mb-8">
                {statCards.map((stat) => (
                    <div key={stat.label} className="stat-card">
                        <div className="flex justify-between items-center mb-3">
                            <span className="text-xs text-[#64748b] font-semibold uppercase tracking-wider">{stat.label}</span>
                            <div className="stat-icon-bg border border-white/5" style={{ backgroundColor: stat.bg }}>
                                <stat.icon size={18} style={{ color: stat.color }} />
                            </div>
                        </div>
                        <div className="text-3xl font-bold tracking-tight text-slate-100 mb-1">
                            {loading ? <div className="skeleton h-8 w-16" /> : stat.value}
                        </div>
                        {!loading && stat.label === "Completed" && totalJobs > 0 && (
                            <div className="flex items-center gap-1.5 text-xs text-[#10b981] font-semibold">
                                <TrendingUp size={12} /> {Math.round((completed / totalJobs) * 100)}% success rate
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* ─── Search + Filter ─── */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <div className="flex-1 relative">
                    <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#64748b]" />
                    <input 
                        className="input-field pl-11! py-3" 
                        placeholder="Search jobs..." 
                        value={search} 
                        onChange={(e) => setSearch(e.target.value)} 
                    />
                </div>
                <div ref={filterRef} className="relative">
                    <button
                        className={`btn-secondary w-full sm:w-auto px-4 py-3 text-xs font-semibold justify-center gap-2 h-full ${statusFilter !== "all" ? "border-mint-500 bg-mint-500/10 text-white" : ""}`}
                        onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                    >
                        <Filter size={14} />
                        {statusFilter === "all" ? "Filter" : activeFilterLabel?.label}
                        {statusFilter !== "all" ? (
                            <X size={12} className="cursor-pointer ml-1 text-[#64748b] hover:text-[#f8fafc] transition-colors" onClick={(e) => { e.stopPropagation(); setStatusFilter("all"); setShowFilterDropdown(false); }} />
                        ) : <ChevronDown size={12} />}
                    </button>
                    {showFilterDropdown && (
                        <div className="absolute top-[calc(100%+6px)] right-0 min-w-[180px] bg-[#0d0c12] border border-white/5 rounded-xl p-1.5 z-50 shadow-2xl animate-scale-in">
                            {FILTER_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value}
                                    onClick={() => { setStatusFilter(opt.value); setShowFilterDropdown(false); }}
                                    className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-lg border-none text-left cursor-pointer text-xs transition-all font-medium ${statusFilter === opt.value ? "bg-mint-500/15 text-[#f8fafc]" : "bg-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}
                                >
                                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: opt.color }} />
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ─── Jobs List ─── */}
            {loading ? (
                <div className="flex flex-col gap-3">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="skeleton h-20 rounded-2xl" />
                    ))}
                </div>
            ) : filteredJobs.length === 0 ? (
                <div className="glass-card flex flex-col items-center justify-center text-center py-20 px-6 max-w-lg mx-auto">
                    <div className="w-20 h-20 rounded-2xl bg-mint-500/10 border border-mint-500/20 flex items-center justify-center mb-6 shadow-inner mx-auto">
                        <Film size={44} className="text-mint-400 animate-pulse-glow" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-200 mb-2">
                        {statusFilter !== "all" ? "No matching jobs" : "No jobs yet"}
                    </h3>
                    <p className="text-sm text-slate-400 max-w-xs mb-6 leading-relaxed">
                        {statusFilter !== "all" ? "Try a different filter or clear your search" : "Upload your first video to get started"}
                    </p>
                    {statusFilter === "all" && (
                        <Link href="/dashboard/new" className="btn-primary flex items-center gap-2 shadow-lg text-sm font-semibold">
                            <Plus size={16} /> Upload Video
                        </Link>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {filteredJobs.map((job, i) => {
                        const statusInfo = JOB_STATUS_LABELS[job.status];
                        const isProcessing = !["done", "failed", "queued", "cancelled"].includes(job.status);
                        return (
                            <Link
                                key={job.id}
                                href={`/dashboard/${job.id}`}
                                className="glass-card p-4 flex items-center gap-4 no-underline text-inherit animate-fade-in-up hover:border-mint-500/35"
                                style={{
                                    animationDelay: `${i * 0.04}s`,
                                }}
                            >
                                {/* Thumbnail placeholder */}
                                <div className="w-12 h-12 rounded-xl flex-shrink-0 bg-mint-500/5 flex items-center justify-center border border-white/5">
                                    <Film size={20} className="text-[#64748b]/60" />
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-semibold text-slate-200 mb-1 whitespace-nowrap overflow-hidden text-ellipsis">
                                        {job.video_url || job.video_filename || "Untitled"}
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-[#64748b]">
                                        <span>{job.caption_style}</span>
                                        <span className="opacity-30">•</span>
                                        <span>{timeAgo(job.created_at)}</span>
                                        {job.clips_count > 0 && (
                                            <>
                                                <span className="opacity-30">•</span>
                                                <span className="text-[#10b981] font-semibold">{job.clips_count} clips</span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Progress ring or status */}
                                <div className="flex items-center gap-3.5 flex-shrink-0">
                                    {isProcessing && (
                                        <div className="relative w-9 h-9">
                                            <svg width="36" height="36" className="-rotate-90">
                                                <circle cx="18" cy="18" r="14" fill="none" stroke="var(--bg-secondary)" strokeWidth="3" />
                                                <circle
                                                    cx="18" cy="18" r="14" fill="none" stroke="var(--accent-primary)" strokeWidth="3"
                                                    strokeDasharray={2 * Math.PI * 14} strokeDashoffset={2 * Math.PI * 14 * (1 - (job.progress || 0) / 100)}
                                                    strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.5s ease" }}
                                                />
                                            </svg>
                                            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-slate-200">
                                                {job.progress}%
                                            </span>
                                        </div>
                                    )}
                                    <span 
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border"
                                        style={{
                                            color: statusInfo.color,
                                            backgroundColor: `${statusInfo.color}15`,
                                            borderColor: `${statusInfo.color}25`,
                                        }}
                                    >
                                        {isProcessing && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: statusInfo.color }} />}
                                        {statusInfo.label}
                                    </span>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
