"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
    ArrowUpRight, BarChart3, ChevronRight, CircleHelp, FolderOpen,
    KeyRound, LogOut, PanelLeftClose, PanelLeftOpen, Plus, Settings2,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { PLAN_LIMITS, effectivePlanKey } from "@/lib/types";
import { DashboardProvider, useDashboard } from "./_components/dashboard-provider";
import { Button, Notice, UsageMeter } from "./_components/ui";
import "./dashboard.css";

const NAV_ITEMS = [
    { href: "/dashboard", label: "My videos", mobile: "Videos", icon: FolderOpen },
    { href: "/dashboard/new", label: "New video", mobile: "Create", icon: Plus },
    { href: "/dashboard/analytics", label: "Analytics", mobile: "Analytics", icon: BarChart3 },
    { href: "/dashboard/api-keys", label: "API keys", mobile: "API keys", icon: KeyRound },
    { href: "/dashboard/settings", label: "Settings", mobile: "Settings", icon: Settings2 },
];

function activeRoute(pathname: string, href: string) {
    if (href === "/dashboard") return pathname === href || !NAV_ITEMS.some((item) => item.href !== href && pathname.startsWith(item.href));
    return pathname.startsWith(href);
}

function Workspace({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const supabase = useMemo(() => createClient(), []);
    const { account, profile, loading, error, refreshProfile } = useDashboard();
    const [collapsed, setCollapsed] = useState(false);
    const [signingOut, setSigningOut] = useState(false);
    const [signOutError, setSignOutError] = useState<string | null>(null);
    const planKey = effectivePlanKey(profile);
    const limits = PLAN_LIMITS[planKey];
    const initials = (profile?.full_name || account?.email || "You").trim().split(/\s+/).slice(0, 2).map((name) => name.charAt(0)).join("").toUpperCase();
    const pageTitle = NAV_ITEMS.find((item) => item.href === pathname)?.label || "Video details";

    async function signOut() {
        setSigningOut(true);
        setSignOutError(null);
        try {
            const { error: authError } = await supabase.auth.signOut();
            if (authError) throw authError;
            router.replace("/login");
            router.refresh();
        } catch {
            setSignOutError("Couldn’t sign out. Please try again.");
            setSigningOut(false);
        }
    }

    return (
        <div className={`studio-shell ${collapsed ? "is-collapsed" : ""}`} data-dashboard-design="workspace-v1">
            <a className="studio-skip" href="#workspace-content">Skip to content</a>
            <aside className="studio-sidebar" aria-label="Workspace sidebar">
                <div className="studio-sidebar-top">
                    <Link href="/" className="studio-brand" aria-label="ClipMint home">
                        <Image src="/logo-cm-128.png" alt="" width={29} height={29} priority />
                        {!collapsed && <span>ClipMint<em>.</em></span>}
                    </Link>
                    <Link href="/dashboard/new" className="studio-button studio-button--primary studio-new-video" aria-label="New video"><Plus size={18} aria-hidden="true" />{!collapsed && "New video"}</Link>
                </div>
                <nav className="studio-nav-group" aria-label="Main navigation">
                    {!collapsed && <p className="studio-nav-caption">Workspace</p>}
                    {NAV_ITEMS.filter((item) => item.href !== "/dashboard/new").map((item) => <Link key={item.href} href={item.href} className="studio-nav-link" aria-label={item.label} title={collapsed ? item.label : undefined} aria-current={activeRoute(pathname, item.href) ? "page" : undefined}>
                        <item.icon size={20} aria-hidden="true" />{!collapsed && <span>{item.label}</span>}
                    </Link>)}
                </nav>
                <div className="studio-sidebar-bottom">
                    {!collapsed && <div className="studio-account-usage">
                        <div className="studio-account-usage-title"><span>Plan & usage</span>{profile && !error && <span className="studio-plan-pill">{limits.label}</span>}</div>
                        {loading ? <p>Loading your plan…</p> : error ? <p>Usage temporarily unavailable</p> : profile && <>
                            <UsageMeter label="Clips" used={profile.clips_used || 0} limit={limits.clips} suffix="" />
                            <Link href="/dashboard/settings?tab=billing">Manage plan <ArrowUpRight size={14} aria-hidden="true" /></Link>
                        </>}
                    </div>}
                    <Link href="/dashboard/settings" className="studio-profile-link" aria-label="Account settings">
                        <span className="studio-avatar" aria-hidden="true">{initials}</span>
                        {!collapsed && <span className="studio-profile-copy"><strong>{profile?.full_name || "Your workspace"}</strong><span>{account?.email || "Account settings"}</span></span>}
                    </Link>
                    <div className="studio-sidebar-footer">
                        <Button variant="ghost" className={collapsed ? "studio-icon-button" : ""} onClick={signOut} busy={signingOut} aria-label="Sign out"><LogOut size={17} aria-hidden="true" />{!collapsed && "Sign out"}</Button>
                        {!collapsed && <Button variant="ghost" className="studio-icon-button" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" title="Collapse sidebar"><PanelLeftClose size={18} aria-hidden="true" /></Button>}
                    </div>
                    {collapsed && <Button variant="ghost" className="studio-icon-button" onClick={() => setCollapsed(false)} aria-label="Expand sidebar" title="Expand sidebar"><PanelLeftOpen size={18} aria-hidden="true" /></Button>}
                </div>
            </aside>

            <div className="studio-main">
                <div className="studio-topbar">
                    <Link className="studio-brand studio-mobile-brand" href="/dashboard" aria-label="ClipMint workspace"><Image src="/logo-cm-128.png" alt="" width={29} height={29} /><span>ClipMint<em>.</em></span></Link>
                    <nav className="studio-breadcrumbs" aria-label="Breadcrumb"><Link href="/dashboard">Workspace</Link><ChevronRight size={14} aria-hidden="true" /><span aria-current="page">{pageTitle}</span></nav>
                    <div className="studio-topbar-right">
                        <Link href="/contact" className="studio-help"><CircleHelp size={18} aria-hidden="true" /><span>Help & support</span></Link>
                        <Link href="/dashboard/settings" className="studio-avatar" aria-label="Open account settings">{initials}</Link>
                        <Button variant="ghost" className="studio-icon-button studio-mobile-signout" onClick={signOut} busy={signingOut} aria-label="Sign out"><LogOut size={18} aria-hidden="true" /></Button>
                    </div>
                </div>
                <main className="studio-content" id="workspace-content" tabIndex={-1}>
                    {(error || signOutError) && <div className="studio-shell-notice"><Notice tone="error" action={error ? <Button variant="secondary" onClick={() => void refreshProfile()}>Try again</Button> : undefined}>{error || signOutError}</Notice></div>}
                    {children}
                </main>
            </div>

            <nav className="studio-bottom-nav" aria-label="Mobile navigation">
                {NAV_ITEMS.map((item) => <Link key={item.href} href={item.href} aria-label={item.label} aria-current={activeRoute(pathname, item.href) ? "page" : undefined}><item.icon size={20} aria-hidden="true" /><span>{item.mobile}</span></Link>)}
            </nav>
        </div>
    );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <DashboardProvider><Workspace>{children}</Workspace></DashboardProvider>;
}
