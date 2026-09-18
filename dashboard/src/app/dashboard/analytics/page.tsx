"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import type { Clip, Job } from "@/lib/types";
import {
    BarChart3, TrendingUp, Film, Clock, Calendar, Loader2,
    Star, Hash, Sparkles, Play,
} from "lucide-react";

interface Stats {
    totalVideos: number;
    totalClips: number;
    avgViralScore: number;
    topClips: Clip[];
    clipsByDay: Record<string, number>;
    clipsByStyle: Record<string, number>;
    heatmap: Record<string, number>;
}

type TimeRange = "7d" | "30d" | "90d" | "all";

function getDaysAgo(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(0, 0, 0, 0);
    return d;
}

function formatDate(d: Date): string {
    return d.toISOString().split("T")[0];
}

/* ─── Mini Donut Chart ─── */
function StyleDonut({ data }: { data: Record<string, number> }) {
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    if (total === 0) return null;

    const COLORS = [
        "var(--accent-primary)", "var(--accent-green)", "var(--accent-orange)",
        "var(--accent-cyan)", "var(--accent-red)", "var(--accent-secondary)",
        "#F472B6", "#A78BFA", "#34D399",
    ];

    const size = 140;
    const strokeWidth = 18;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    let cumulativeOffset = 0;

    return (
        <div className="flex items-center gap-6 flex-wrap">
            <div className="relative inline-flex items-center justify-center">
                <svg width={size} height={size} className="-rotate-90">
                    {entries.map(([style, count], i) => {
                        const pct = count / total;
                        const dash = pct * circumference;
                        const offset = cumulativeOffset;
                        cumulativeOffset += dash;
                        return (
                            <circle
                                key={style}
                                cx={size / 2} cy={size / 2} r={radius}
                                fill="none" stroke={COLORS[i % COLORS.length]}
                                strokeWidth={strokeWidth}
                                strokeDasharray={`${dash} ${circumference - dash}`}
                                strokeDashoffset={-offset}
                                strokeLinecap="butt"
                                className="transition-all duration-500"
                            />
                        );
                    })}
                </svg>
                <span className="absolute text-lg font-extrabold text-slate-100">
                    {total}
                </span>
            </div>
            <div className="flex flex-col gap-1.5 flex-1 min-w-[150px]">
                {entries.slice(0, 6).map(([style, count], i) => (
                    <div key={style} className="flex items-center gap-2 text-xs">
                        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="text-slate-300 font-medium capitalize">{style}</span>
                        <span className="text-[#64748b] ml-auto font-mono">
                            {count} ({Math.round((count / total) * 100)}%)
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ─── Activity Heatmap (GitHub-style) ─── */
function ActivityHeatmap({ data }: { data: Record<string, number> }) {
    const today = new Date();
    const days: { date: string; count: number; dayName: string }[] = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = formatDate(d);
        days.push({ date: key, count: data[key] || 0, dayName: d.toLocaleDateString("en", { weekday: "short" }) });
    }

    const maxCount = Math.max(...days.map(d => d.count), 1);

    return (
        <div>
            <div 
                className="grid gap-1 mb-2.5" 
                style={{ gridTemplateColumns: "repeat(15, 1fr)" }}
            >
                {days.map((day) => {
                    const intensity = day.count / maxCount;
                    const bg = day.count === 0
                        ? "rgba(255, 255, 255, 0.02)"
                        : `rgba(139, 92, 246, ${0.25 + intensity * 0.75})`;
                    return (
                        <div
                            key={day.date}
                            title={`${day.date}: ${day.count} clip${day.count !== 1 ? "s" : ""}`}
                            className="aspect-square rounded-sm cursor-pointer transition-all duration-200 min-w-0 hover:scale-110 hover:shadow-[0_0_8px_rgba(139,92,246,0.45)] hover:z-10"
                            style={{
                                backgroundColor: bg,
                            }}
                        />
                    );
                })}
            </div>
            <div className="flex justify-between text-[10px] text-[#64748b] mt-1.5 font-medium">
                <span>30 days ago</span>
                <div className="flex items-center gap-1.5">
                    <span>Less</span>
                    {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                        <span key={v} className="w-2.5 h-2.5 rounded-sm border border-white/[0.02]" style={{
                            backgroundColor: v === 0 ? "rgba(255,255,255,0.02)" : `rgba(139, 92, 246, ${0.25 + v * 0.75})`,
                        }} />
                    ))}
                    <span>More</span>
                </div>
            </div>
        </div>
    );
}

export default function AnalyticsPage() {
    const supabase = createClient();
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);
    const [timeRange, setTimeRange] = useState<TimeRange>("30d");

    useEffect(() => {
        loadStats();
    }, [timeRange]);

    async function loadStats() {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Date filter
        let sinceDate: Date | null = null;
        if (timeRange === "7d") sinceDate = getDaysAgo(7);
        else if (timeRange === "30d") sinceDate = getDaysAgo(30);
        else if (timeRange === "90d") sinceDate = getDaysAgo(90);

        // Total videos (within range)
        let jobQuery = supabase.from("jobs").select("*").eq("user_id", user.id);
        if (sinceDate) jobQuery = jobQuery.gte("created_at", sinceDate.toISOString());
        const { data: jobsData } = await jobQuery;
        const jobs = (jobsData || []) as Job[];

        // All clips (within range)
        let clipQuery = supabase.from("clips").select("*").eq("user_id", user.id);
        if (sinceDate) clipQuery = clipQuery.gte("created_at", sinceDate.toISOString());
        const { data: clipsData } = await clipQuery;
        const allClips = (clipsData || []) as Clip[];

        // Top clips (by viral score)
        const topClips = [...allClips].sort((a, b) => (b.viral_score ?? 0) - (a.viral_score ?? 0)).slice(0, 5);

        // Average viral score
        const scoresWithValues = allClips.filter((c) => c.viral_score != null);
        const avgScore = scoresWithValues.length > 0
            ? Math.round(scoresWithValues.reduce((sum, c) => sum + (c.viral_score ?? 0), 0) / scoresWithValues.length)
            : 0;

        // Clips grouped by day (for bar chart)
        const clipsByDay: Record<string, number> = {};
        allClips.forEach((clip) => {
            const day = formatDate(new Date(clip.created_at));
            clipsByDay[day] = (clipsByDay[day] || 0) + 1;
        });

        // Clips by caption style (for donut)
        const clipsByStyle: Record<string, number> = {};
        jobs.forEach((job) => {
            const style = job.caption_style || "unknown";
            clipsByStyle[style] = (clipsByStyle[style] || 0) + (job.clips_count || 0);
        });

        // 30-day heatmap
        const heatmap: Record<string, number> = {};
        allClips.forEach((clip) => {
            const day = formatDate(new Date(clip.created_at));
            heatmap[day] = (heatmap[day] || 0) + 1;
        });

        setStats({
            totalVideos: jobs.length,
            totalClips: allClips.length,
            avgViralScore: avgScore,
            topClips,
            clipsByDay,
            clipsByStyle,
            heatmap,
        });
        setLoading(false);
    }

    /* Build chart bars from clipsByDay data */
    function renderChart() {
        if (!stats) return null;

        const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : timeRange === "90d" ? 90 : 60;
        const bars: { date: string; count: number; label: string }[] = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = formatDate(d);
            bars.push({
                date: key,
                count: stats.clipsByDay[key] || 0,
                label: d.toLocaleDateString("en", { month: "short", day: "numeric" }),
            });
        }

        const maxCount = Math.max(...bars.map((b) => b.count), 1);

        return (
            <div className="flex flex-col gap-2">
                <div className={`h-48 flex items-end px-1 ${days > 30 ? "gap-0.5" : "gap-1"}`}>
                    {bars.map((bar, i) => {
                        const height = bar.count === 0 ? 3 : Math.max(8, (bar.count / maxCount) * 100);
                        return (
                            <div
                                key={bar.date}
                                title={`${bar.label}: ${bar.count} clip${bar.count !== 1 ? "s" : ""}`}
                                className="flex-1 rounded-t cursor-pointer transition-all duration-500 hover:opacity-100 min-w-[2px]"
                                style={{
                                    height: `${height}%`,
                                    background: bar.count > 0 ? "var(--gradient-hero)" : "rgba(255, 255, 255, 0.02)",
                                    opacity: bar.count > 0 ? 0.7 + (bar.count / maxCount) * 0.3 : 0.3,
                                }}
                            />
                        );
                    })}
                </div>
                <div className="flex justify-between text-[10px] text-[#64748b] mt-1.5 font-medium">
                    <span>{bars[0]?.label}</span>
                    <span>{bars[Math.floor(bars.length / 2)]?.label}</span>
                    <span>{bars[bars.length - 1]?.label}</span>
                </div>
            </div>
        );
    }

    const s = stats;

    const statCards = s ? [
        { label: "Total Videos", value: s.totalVideos, icon: Film, color: "var(--accent-primary)", bg: "rgba(139,92,246,0.12)" },
        { label: "Clips Generated", value: s.totalClips, icon: Play, color: "var(--accent-green)", bg: "rgba(16,185,129,0.12)" },
        { label: "Avg Viral Score", value: s.avgViralScore > 0 ? s.avgViralScore : "—", icon: TrendingUp, color: "var(--accent-orange)", bg: "rgba(245,158,11,0.12)" },
        { label: "Top Score", value: s.topClips.length > 0 ? (s.topClips[0].viral_score ?? "—") : "—", icon: Star, color: "var(--accent-cyan)", bg: "rgba(6,182,212,0.12)" },
    ] : [];

    return (
        <div>
            {/* ─── Header + Time Range ─── */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-100 mb-1">
                        Analytics
                    </h1>
                    <p className="text-sm text-[#64748b]">
                        Track your content performance and usage
                    </p>
                </div>
                <div className="tab-nav mb-0">
                    {(["7d", "30d", "90d", "all"] as TimeRange[]).map((range) => (
                        <button
                            key={range}
                            className={`tab-item text-xs px-3.5 py-1.5 ${timeRange === range ? "active" : ""}`}
                            onClick={() => setTimeRange(range)}
                        >
                            {range === "all" ? "All" : range}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div>
                    <div className="dash-grid-4 mb-6">
                        {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}
                    </div>
                    <div className="skeleton h-64 rounded-2xl mb-6" />
                    <div className="dash-grid-2">
                        <div className="skeleton h-60 rounded-2xl" />
                        <div className="skeleton h-60 rounded-2xl" />
                    </div>
                </div>
            ) : (
                <>
                    {/* ─── Stat Cards ─── */}
                    <div className="dash-grid-4 mb-6">
                        {statCards.map((stat) => (
                            <div key={stat.label} className="stat-card">
                                <div className="flex justify-between items-center mb-3">
                                    <span className="text-xs text-[#64748b] font-semibold uppercase tracking-wider">{stat.label}</span>
                                    <div className="stat-icon-bg border border-white/5" style={{ backgroundColor: stat.bg }}>
                                        <stat.icon size={18} style={{ color: stat.color }} />
                                    </div>
                                </div>
                                <div className="text-3xl font-bold tracking-tight text-slate-100">{stat.value}</div>
                            </div>
                        ))}
                    </div>

                    {/* ─── Activity Chart ─── */}
                    <div className="glass-card p-6 md:p-8 mb-6">
                        <h3 className="text-base font-bold text-slate-200 mb-5 flex items-center gap-2.5">
                            <BarChart3 size={18} className="text-mint-400" />
                            Clips Activity
                        </h3>
                        {s && s.totalClips === 0 ? (
                            <div className="text-center py-10 text-[#64748b]">
                                <BarChart3 size={36} className="mx-auto mb-3 opacity-40" />
                                <p className="text-sm">No data yet. Submit your first video to see analytics.</p>
                            </div>
                        ) : (
                            renderChart()
                        )}
                    </div>

                    {/* ─── Usage Breakdown + Heatmap ─── */}
                    <div className="dash-grid-2 mb-6">
                        {/* Caption Style Distribution */}
                        <div className="glass-card p-6 md:p-8">
                            <h3 className="text-base font-bold text-slate-200 mb-5 flex items-center gap-2.5">
                                <Hash size={18} className="text-mint-400" />
                                Style Distribution
                            </h3>
                            {s && Object.keys(s.clipsByStyle).length === 0 ? (
                                <div className="text-center py-6 text-[#64748b] text-xs">
                                    No data yet
                                </div>
                            ) : (
                                s && <StyleDonut data={s.clipsByStyle} />
                            )}
                        </div>

                        {/* 30-Day Heatmap */}
                        <div className="glass-card p-6 md:p-8">
                            <h3 className="text-base font-bold text-slate-200 mb-5 flex items-center gap-2.5">
                                <Calendar size={18} className="text-mint-400" />
                                Activity Calendar
                            </h3>
                            {s && <ActivityHeatmap data={s.heatmap} />}
                        </div>
                    </div>

                    {/* ─── Top Viral Clips Leaderboard ─── */}
                    <div className="glass-card p-6 md:p-8">
                        <h3 className="text-base font-bold text-slate-200 mb-5 flex items-center gap-2.5">
                            <Sparkles size={18} className="text-mint-400" />
                            Top Performing Clips
                        </h3>
                        {s && s.topClips.length === 0 ? (
                            <div className="text-center py-6 text-[#64748b]">
                                <p className="text-sm">No clips yet. Your top performers will appear here.</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2.5">
                                {s?.topClips.map((clip, i) => (
                                    <div
                                        key={clip.id}
                                        className="flex items-center gap-3.5 px-4.5 py-3.5 rounded-xl bg-[#08080c] border border-white/5 transition-all duration-300 hover:border-mint-500/35 hover:translate-x-1 animate-fade-in-up"
                                        style={{ animationDelay: `${i * 0.06}s` }}
                                    >
                                        {/* Rank */}
                                        <div 
                                            className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0"
                                            style={{
                                                background: i === 0 ? "rgba(255,215,0,0.15)" : i === 1 ? "rgba(192,192,192,0.12)" : i === 2 ? "rgba(205,127,50,0.12)" : "#0d0c12",
                                                color: i === 0 ? "#FFD700" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "#64748b",
                                            }}
                                        >
                                            #{i + 1}
                                        </div>

                                        {/* Thumbnail */}
                                        <div className="w-11 h-11 rounded-lg flex-shrink-0 overflow-hidden bg-[#0d0c12] border border-white/5 flex items-center justify-center">
                                            {clip.thumbnail_url ? (
                                                <img src={clip.thumbnail_url} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <Film size={18} className="text-[#64748b]/40" />
                                            )}
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-semibold text-slate-200 mb-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
                                                {clip.title || `Clip ${clip.clip_index + 1}`}
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-[#64748b]">
                                                {clip.duration_seconds && <span>{Math.round(clip.duration_seconds)}s</span>}
                                            </div>
                                        </div>

                                        {/* Score bar */}
                                        {clip.viral_score != null && (
                                            <div className="flex items-center gap-2.5 flex-shrink-0">
                                                <div className="w-20 h-1.5 rounded-full bg-[#030305] overflow-hidden">
                                                    <div 
                                                        className="h-full rounded-full transition-[width] duration-700 ease-out"
                                                        style={{
                                                            width: `${clip.viral_score}%`,
                                                            backgroundColor: clip.viral_score >= 80 ? "#10b981" : clip.viral_score >= 50 ? "#f59e0b" : "#ef4444",
                                                        }} 
                                                    />
                                                </div>
                                                <span 
                                                    className="text-xs font-black min-w-8 text-right"
                                                    style={{
                                                        color: clip.viral_score >= 80 ? "#10b981" : clip.viral_score >= 50 ? "#f59e0b" : "#ef4444",
                                                    }}
                                                >
                                                    {clip.viral_score}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
