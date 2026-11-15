"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BarChart3, CalendarDays, Captions, Clapperboard, Film, Info, Star, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { Clip, Job } from "@/lib/types";
import { boundedPercent, clipSeconds, dailyCounts, formatDuration, periodStart } from "@/lib/dashboard";
import { useDashboard } from "../_components/dashboard-provider";
import { Button, EmptyState, LoadingState, Metrics, Notice, PageHeader, SectionHeading } from "../_components/ui";

type Range = "7" | "30" | "90" | "all";
type AnalyticsClip = Clip & { jobs: { caption_style: string } | null };
const COLORS = ["#2f7d32", "#78b84c", "#bbcfa0", "#37665c", "#77988a", "#53643e", "#c0b878", "#637966", "#a6c59d"];

export default function AnalyticsPage() {
    const supabase = useMemo(() => createClient(), []);
    const { account, loading: accountLoading, refreshProfile } = useDashboard();
    const [range, setRange] = useState<Range>("30");
    const [jobs, setJobs] = useState<Job[]>([]);
    const [clips, setClips] = useState<AnalyticsClip[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    const [today] = useState(() => new Date());

    useEffect(() => {
        if (!account) return;
        let disposed = false;
        const controller = new AbortController();
        async function load() {
            setLoading(true);
            setError(null);
            try {
                const collectedJobs: Job[] = [];
                const collectedClips: AnalyticsClip[] = [];
                const since = range === "all" ? null : periodStart(Number(range), today).toISOString();
                // Paginate rather than silently capping an account's history at 1,000 rows.
                for (const table of ["jobs", "clips"] as const) {
                    for (let offset = 0; !disposed; offset += 1000) {
                        let query = supabase.from(table).select(table === "clips" ? "*, jobs(caption_style)" : "*").eq("user_id", account!.id).order("created_at", { ascending: false }).order("id").range(offset, offset + 999).abortSignal(controller.signal);
                        if (since) query = query.gte("created_at", since);
                        const { data, error: queryError } = await query;
                        if (queryError) throw queryError;
                        const rows = data || [];
                        if (table === "jobs") collectedJobs.push(...rows as unknown as Job[]);
                        else collectedClips.push(...rows as unknown as AnalyticsClip[]);
                        if (rows.length < 1000) break;
                    }
                }
                if (!disposed) { setJobs(collectedJobs); setClips(collectedClips); }
            } catch {
                if (!disposed) setError("Analytics couldn’t be loaded. Please try again.");
            } finally { if (!disposed) setLoading(false); }
        }
        void load();
        return () => { disposed = true; controller.abort(); };
    }, [account, range, retry, supabase, today]);

    const scored = clips.filter((clip) => clip.viral_score != null);
    const average = scored.length ? Math.round(scored.reduce((sum, clip) => sum + (clip.viral_score || 0), 0) / scored.length) : null;
    const topClips = [...scored].sort((a, b) => (b.viral_score || 0) - (a.viral_score || 0)).slice(0, 5);
    const chartDays = range === "all" ? 90 : Number(range);
    const bars = dailyCounts(clips, chartDays, today);
    const highest = Math.max(...bars.map((bar) => bar.count), 1);
    const chartTotal = bars.reduce((sum, bar) => sum + bar.count, 0);
    const calendarDays = Math.min(chartDays, 30);
    const calendar = dailyCounts(clips, calendarDays, today);
    const styles = new Map<string, number>();
    clips.forEach((clip) => { const style = clip.jobs?.caption_style || "Unknown"; styles.set(style, (styles.get(style) || 0) + 1); });
    const distribution = [...styles.entries()].sort((a, b) => b[1] - a[1]);
    const slices: { style: string; count: number; color: string; from: number; to: number }[] = [];
    let angle = 0;
    for (let index = 0; index < distribution.length; index++) {
        const [style, count] = distribution[index];
        const start = angle;
        angle += (count / Math.max(1, clips.length)) * 360;
        slices.push({ style, count, color: COLORS[index % COLORS.length], from: start, to: angle });
    }

    return <div className="studio-page">
        <PageHeader eyebrow="Workspace insights" title="Analytics" description="See what you’re creating, the styles you use, and the moments AI rates highest."
            actions={<div className="studio-segmented studio-period-picker" role="group" aria-label="Analytics period">{(["7", "30", "90", "all"] as Range[]).map((value) => <button key={value} aria-pressed={range === value} onClick={() => setRange(value)}>{value === "all" ? "All time" : `${value} days`}</button>)}</div>} />
        {!account && !accountLoading ? <Notice tone="error" action={<Button variant="secondary" onClick={() => void refreshProfile()}>Refresh account</Button>}>Your account is temporarily unavailable.</Notice> : error ? <Notice tone="error" action={<Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>Try again</Button>}>{error}</Notice> : <>
            <Metrics loading={loading} items={[
                { label: "Videos added", value: jobs.length, icon: Film },
                { label: "Clips created", value: clips.length, icon: Clapperboard },
                { label: "Average AI score", value: average ?? "—", icon: TrendingUp },
                { label: "Highest AI score", value: topClips[0]?.viral_score ?? "—", icon: Star },
            ]} />
            {loading ? <div className="studio-panel"><LoadingState label="Loading analytics" rows={4} /></div> : <>
                <div className="studio-analytics-main">
                    <section className="studio-panel studio-chart-panel">
                        <SectionHeading title="Clips over time" description={range === "all" ? "Last 90 days · summary above includes all time" : `Daily output over the last ${range} days`} icon={BarChart3} action={<span className="studio-chart-total">{chartTotal}<small>clips</small></span>} />
                        {chartTotal === 0 ? <EmptyState icon={BarChart3} title="No clips in this period" description="Choose a wider date range or create a video to start seeing activity." /> : <>
                            <div className="studio-bar-chart" role="img" aria-label={`${chartTotal} clips created across ${chartDays} days. The busiest day had ${highest} clips.`}>
                                <div className="studio-chart-grid" aria-hidden="true"><span>{highest}</span><span>{Math.ceil(highest / 2)}</span><span>0</span></div>
                                <div className="studio-chart-bars">{bars.map((bar) => <div key={bar.key} className="studio-chart-column" title={`${bar.label}: ${bar.count} clips`}><span style={{ height: `${bar.count ? Math.max(3, bar.count / highest * 100) : 0}%` }} /></div>)}</div>
                            </div>
                            <div className="studio-chart-axis" aria-hidden="true"><span>{bars[0].label}</span><span>{bars[Math.floor(chartDays / 2)].label}</span><span>{bars[chartDays - 1].label}</span></div>
                            <details className="studio-chart-data"><summary>View daily counts</summary><div><table><caption className="studio-sr-only">Daily clip counts</caption><thead><tr><th scope="col">Day</th><th scope="col">Clips</th></tr></thead><tbody>{bars.map((bar) => <tr key={bar.key}><th scope="row">{bar.label}</th><td>{bar.count}</td></tr>)}</tbody></table></div></details>
                        </>}
                    </section>
                    <section className="studio-panel"><SectionHeading title="Caption styles" description="Share of clips in the selected period" icon={Captions} />
                        {!distribution.length ? <EmptyState icon={Captions} title="No styles yet" description="Caption styles will appear after your first clips are ready." /> : <div className="studio-style-breakdown">
                            <div className="studio-style-donut" role="img" aria-label={`${clips.length} clips across ${distribution.length} caption styles`} style={{ background: `conic-gradient(${slices.map((slice) => `${slice.color} ${slice.from}deg ${slice.to}deg`).join(",")})` }}><div><strong>{clips.length}</strong><span>clips</span></div></div>
                            <ul className="studio-chart-legend">{slices.map((slice) => <li key={slice.style}><i style={{ background: slice.color }} /><span>{slice.style}</span><strong>{slice.count}</strong><small>{boundedPercent(slice.count, clips.length)}%</small></li>)}</ul>
                        </div>}
                    </section>
                </div>
                <div className="studio-analytics-bottom">
                    <section className="studio-panel"><SectionHeading title="Top-rated moments" description="AI estimates—not social views or engagement" icon={Star} />
                        {!topClips.length ? <EmptyState icon={Star} title="No rated clips yet" description="When your clips are analyzed, their highest AI scores will appear here." /> : <ol className="studio-ranked-clips">{topClips.map((clip, index) => <li key={clip.id}><Link href={`/dashboard/${clip.job_id}`}><span className="studio-rank">{String(index + 1).padStart(2, "0")}</span><span className="studio-ranked-info"><strong>{clip.title || clip.filename}</strong><small>{formatDuration(clipSeconds(clip))} · {clip.jobs?.caption_style || "Captioned clip"}</small></span><span className="studio-score">{clip.viral_score}<small>/100</small></span><ArrowUpRight size={16} aria-hidden="true" /></Link></li>)}</ol>}
                    </section>
                    <section className="studio-panel"><SectionHeading title="Activity calendar" description={`Clip creation over the last ${calendarDays} days`} icon={CalendarDays} />
                        <div className="studio-activity-calendar" role="img" aria-label={`${calendar.filter((day) => day.count > 0).length} active days in the last ${calendarDays} days`}>
                            {calendar.map((day) => <span key={day.key} title={`${day.label}: ${day.count} clips`} data-level={day.count === 0 ? "0" : day.count >= highest / 2 ? "2" : "1"}>{day.day}</span>)}
                        </div>
                        <div className="studio-calendar-legend"><span>{calendar[0].label} — {calendar[calendar.length - 1].label}</span><span><i />Active day</span></div>
                        <p className="studio-analytics-note"><Info size={16} aria-hidden="true" />These are creation statistics. ClipMint doesn’t track social-platform performance.</p>
                    </section>
                </div>
            </>}
        </>}
    </div>;
}
