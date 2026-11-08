"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import type { Profile } from "@/lib/types";
import { PLAN_LIMITS, effectivePlanKey } from "@/lib/types";
import {
    LayoutDashboard,
    Upload,
    Settings,
    Key,
    BarChart3,
    LogOut,
    Loader2,
    ChevronLeft,
    ChevronRight,
    Sparkles,
} from "lucide-react";

const NAV_ITEMS = [
    { href: "/dashboard", label: "My Jobs", icon: LayoutDashboard },
    { href: "/dashboard/new", label: "New Video", icon: Upload },
    { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/dashboard/api-keys", label: "API Keys", icon: Key },
    { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

/* ─── Donut SVG ─── */
function DonutMeter({ percent, size = 56, strokeWidth = 5 }: { percent: number; size?: number; strokeWidth?: number }) {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (Math.min(percent, 100) / 100) * circumference;
    const color = percent >= 90 ? "var(--accent-red)" : percent >= 70 ? "var(--accent-orange)" : "var(--accent-primary)";

    return (
        <div className="donut-container">
            <svg width={size} height={size}>
                <circle
                    cx={size / 2} cy={size / 2} r={radius}
                    fill="none" stroke="var(--bg-primary)" strokeWidth={strokeWidth}
                />
                <circle
                    cx={size / 2} cy={size / 2} r={radius}
                    fill="none" stroke={color} strokeWidth={strokeWidth}
                    strokeDasharray={circumference} strokeDashoffset={offset}
                    strokeLinecap="round"
                    style={{ transition: "stroke-dashoffset 0.8s ease" }}
                />
            </svg>
            <span className="donut-text">{percent}%</span>
        </div>
    );
}

/* ─── Page title map for breadcrumbs ─── */
function getPageTitle(pathname: string): string {
    if (pathname === "/dashboard") return "My Jobs";
    if (pathname === "/dashboard/new") return "New Video";
    if (pathname === "/dashboard/analytics") return "Analytics";
    if (pathname === "/dashboard/api-keys") return "API Keys";
    if (pathname === "/dashboard/settings") return "Settings";
    if (pathname.startsWith("/dashboard/")) return "Job Detail";
    return "Dashboard";
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const supabase = createClient();
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        async function loadProfile() {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { router.push("/login"); return; }

            // Roll the monthly usage window first (no-op unless due) so the
            // sidebar always shows this month's usage against the effective plan.
            await supabase.rpc("roll_usage_period_if_due", { p_user_id: user.id });

            const { data } = await supabase
                .from("profiles")
                .select("*")
                .eq("id", user.id)
                .single();

            if (data) setProfile(data as Profile);
            setLoading(false);
        }
        loadProfile();
    }, []);

    async function handleSignOut() {
        await supabase.auth.signOut();
        router.push("/login");
        router.refresh();
    }

    // Effective plan everywhere: an expired paid plan displays — and gates — as Free.
    const planKey = profile ? effectivePlanKey(profile) : "free";
    const planLimit = PLAN_LIMITS[planKey];
    const usagePercent = profile
        ? Math.min(100, Math.round(((profile.clips_used ?? 0) / planLimit.clips) * 100))
        : 0;

    return (
        <div className="flex min-h-screen bg-[var(--bg-inset)] text-ink-50">
            {/* ═══ Desktop Sidebar ═══ */}
            <aside className={`dash-sidebar ${collapsed ? "collapsed" : ""}`}>
                {/* Logo + Collapse toggle */}
                <div className="flex items-center justify-between px-2 mb-6">
                    <Link href="/" className="flex items-center gap-2.5 no-underline text-inherit">
                        <img src="/logo-cm-128.png" alt="ClipMint" className="h-7 w-7 rounded-md object-cover flex-shrink-0 border border-[var(--border-subtle)]" />
                        {!collapsed && <span className="gradient-text sidebar-label text-lg font-extrabold tracking-tight from-mint-500 to-mint-700">ClipMint</span>}
                    </Link>
                    <button
                        onClick={() => setCollapsed(!collapsed)}
                        className="bg-transparent border-none cursor-pointer text-ink-400 hover:text-ink-50 p-1 rounded-md transition-colors flex items-center justify-center"
                        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    >
                        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                    </button>
                </div>

                {/* User info */}
                {!collapsed && profile && (
                    <div className="p-3 mb-4 rounded-xl bg-[var(--bg-inset)] border border-[var(--border-subtle)]">
                        <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-mint-500 to-mint-700 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                                {(profile.full_name || "U").charAt(0).toUpperCase()}
                            </div>
                            <div className="overflow-hidden">
                                <div className="text-xs font-semibold whitespace-nowrap overflow-hidden text-ellipsis text-ink-100">
                                    {profile.full_name || "User"}
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className={`plan-badge ${planKey}`}>{planKey}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Nav items */}
                <nav className="flex flex-col gap-0.5 flex-1">
                    {NAV_ITEMS.map((item) => {
                        const isActive = pathname === item.href;
                        const Icon = item.icon;
                        return (
                            <Link key={item.href} href={item.href} className={`sidebar-nav-item ${isActive ? "active" : ""}`}>
                                <div className="sidebar-icon-bg">
                                    <Icon size={18} className={isActive ? "text-mint-400" : "text-ink-400"} />
                                </div>
                                {!collapsed && <span className="sidebar-label">{item.label}</span>}
                            </Link>
                        );
                    })}
                </nav>

                {/* Usage meter — Donut */}
                <div className="sidebar-usage-card p-4 rounded-xl bg-[var(--bg-inset)] border border-[var(--border-subtle)] mb-2">
                    {collapsed ? (
                        <div className="flex justify-center">
                            <DonutMeter percent={usagePercent} size={40} strokeWidth={4} />
                        </div>
                    ) : (
                        <div className="sidebar-label">
                            <div className="flex items-center justify-between mb-2.5">
                                <span className="text-xs text-ink-400 font-semibold tracking-wider">
                                    USAGE
                                </span>
                                <DonutMeter percent={usagePercent} size={40} strokeWidth={4} />
                            </div>
                            <div className="text-xs text-ink-300 font-medium">
                                {loading ? (
                                    <Loader2 size={14} className="animate-spin text-mint-400" />
                                ) : (
                                    `${profile?.clips_used ?? 0} / ${planLimit.clips} clips`
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Upgrade CTA (only if free plan) */}
                {!collapsed && planKey === "free" && (
                    <Link href="/pricing" className="upgrade-card sidebar-label block no-underline">
                        <Sparkles size={16} className="text-mint-400 mx-auto mb-1.5" />
                        <div className="text-xs font-bold text-ink-100 mb-0.5">Upgrade your plan</div>
                        <div className="text-[10px] text-ink-400">More clips every month</div>
                    </Link>
                )}

                {/* Sign out */}
                <button
                    onClick={handleSignOut}
                    className={`flex items-center ${collapsed ? "justify-center" : "justify-start"} gap-2.5 px-3.5 py-2.5 mt-2 bg-transparent border border-[var(--border-subtle)] hover:border-red-500/20 hover:bg-red-500/5 text-ink-300 hover:text-red-400 rounded-xl cursor-pointer text-xs transition-all w-full font-medium`}
                >
                    <LogOut size={16} />
                    {!collapsed && <span className="sidebar-label">Sign Out</span>}
                </button>
            </aside>

            {/* ═══ Mobile Bottom Nav ═══ */}
            <nav className="dash-bottom-nav">
                {NAV_ITEMS.map((item) => {
                    const isActive = pathname === item.href;
                    const Icon = item.icon;
                    return (
                        <Link key={item.href} href={item.href} className={`bottom-nav-item ${isActive ? "active" : ""}`}>
                            <Icon size={20} />
                            <span>{item.label.split(" ").pop()}</span>
                        </Link>
                    );
                })}
            </nav>

            {/* ═══ Main content ═══ */}
            <main className={`dash-main flex-1 p-6 md:p-9 min-h-screen transition-[margin-left] duration-300 ${collapsed ? "ml-20" : "ml-[270px]"}`}>
                {/* Breadcrumb */}
                <div className="breadcrumb mb-5">
                    <Link href="/dashboard">Dashboard</Link>
                    {pathname !== "/dashboard" && (
                        <>
                            <span className="sep">/</span>
                            <span className="current">{getPageTitle(pathname)}</span>
                        </>
                    )}
                </div>
                {children}
            </main>
        </div>
    );
}
