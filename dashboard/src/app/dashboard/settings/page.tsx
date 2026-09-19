"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import type { Profile, Payment } from "@/lib/types";
import { CAPTION_STYLES, PLAN_LIMITS, type CaptionStyle } from "@/lib/types";
import {
    User, Bell, CreditCard, ShieldAlert, Save, Loader2,
    ExternalLink, Check, Crown, Sparkles, AlertTriangle,
    Trash2, Lock, ArrowUpRight, Calendar, XCircle,
    Receipt, RefreshCw, Zap, ArrowRight,
} from "lucide-react";
import Link from "next/link";

type SettingsTab = "profile" | "notifications" | "billing" | "security";

const TABS: { key: SettingsTab; label: string; icon: React.ElementType }[] = [
    { key: "profile", label: "Profile", icon: User },
    { key: "notifications", label: "Notifications", icon: Bell },
    { key: "billing", label: "Billing", icon: CreditCard },
    { key: "security", label: "Security", icon: ShieldAlert },
];

export default function SettingsPage() {
    const supabase = createClient();
    const router = useRouter();
    const [profile, setProfile] = useState<Profile | null>(null);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [email, setEmail] = useState("");
    const [fullName, setFullName] = useState("");
    const [defaultStyle, setDefaultStyle] = useState<CaptionStyle>("hormozi");
    const [notifications, setNotifications] = useState({
        discord: true,
        email: false,
        jobComplete: true,
        jobFailed: true,
        weeklyReport: false,
    });
    const [discordWebhookUrl, setDiscordWebhookUrl] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
    const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteInput, setDeleteInput] = useState("");
    const [deleting, setDeleting] = useState(false);
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);
    const [cancelling, setCancelling] = useState(false);

    useEffect(() => {
        async function load() {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            setEmail(user.email ?? "");

            const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
            if (data) {
                const p = data as Profile;
                setProfile(p);
                setFullName(p.full_name ?? "");
                setNotifications({
                    discord: p.notify_discord ?? true,
                    email: p.notify_email ?? false,
                    jobComplete: p.notify_job_complete ?? true,
                    jobFailed: p.notify_job_failed ?? true,
                    weeklyReport: p.notify_weekly_report ?? false,
                });
                setDiscordWebhookUrl(p.discord_webhook_url ?? "");
            }

            // Load payment history
            const { data: paymentData } = await supabase
                .from("payments")
                .select("*")
                .eq("user_id", user.id)
                .order("created_at", { ascending: false })
                .limit(10);

            if (paymentData) {
                setPayments(paymentData as Payment[]);
            }

            setLoading(false);
        }
        load();
    }, [supabase]);

    function showToast(type: "success" | "error", message: string) {
        setToast({ type, message });
        setTimeout(() => setToast(null), 3000);
    }

    const handleSave = async () => {
        if (!profile) return;
        setSaving(true);

        if (notifications.discord && discordWebhookUrl.trim()) {
            if (!discordWebhookUrl.startsWith("https://discord.com/api/webhooks/") &&
                !discordWebhookUrl.startsWith("https://discordapp.com/api/webhooks/")) {
                showToast("error", "Invalid Discord webhook URL");
                setSaving(false);
                return;
            }
        }

        const { error: updateError } = await supabase
            .from("profiles")
            .update({
                full_name: fullName.trim(),
                notify_discord: notifications.discord,
                notify_email: notifications.email,
                notify_job_complete: notifications.jobComplete,
                notify_job_failed: notifications.jobFailed,
                notify_weekly_report: notifications.weeklyReport,
                discord_webhook_url: discordWebhookUrl.trim() || null,
            })
            .eq("id", profile.id);

        if (updateError) {
            console.error("Profile update error:", updateError.message);
            showToast("error", "Could not save your settings. Please try again.");
        } else {
            showToast("success", "Settings saved successfully");
        }
        setSaving(false);
    };

    const handleCancelSubscription = async () => {
        setCancelling(true);
        try {
            const res = await fetch("/api/cashfree/cancel", { method: "POST" });
            const data = await res.json();

            if (res.ok && data.success) {
                showToast("success", data.message);
                setShowCancelConfirm(false);
                // Refresh profile
                if (profile) {
                    setProfile({ ...profile, subscription_status: "cancelled" });
                }
            } else {
                showToast("error", data.error || "Failed to cancel subscription");
            }
        } catch {
            showToast("error", "Failed to cancel subscription");
        }
        setCancelling(false);
    };

    const handleDeleteAccount = async () => {
        if (deleteInput !== "DELETE") return;
        setDeleting(true);
        await supabase.auth.signOut();
        router.push("/login");
    };

    if (loading) {
        return (
            <div className="max-w-2xl mx-auto">
                <div className="skeleton h-8 w-44 rounded-lg mb-2" />
                <div className="skeleton h-4 w-72 rounded-md mb-8" />
                <div className="skeleton h-12 w-full rounded-xl mb-6" />
                <div className="skeleton h-80 w-full rounded-2xl" />
            </div>
        );
    }

    const planKey = profile?.plan ?? "free";
    const planInfo = PLAN_LIMITS[planKey];
    const initial = (profile?.full_name || "U").charAt(0).toUpperCase();
    const hasActiveSubscription = profile?.subscription_status === "active";
    const isCancelled = profile?.subscription_status === "cancelled";
    const periodEndDate = profile?.current_period_end ? new Date(profile.current_period_end) : null;

    // Use Math.max to guarantee minimum free limits display of 2 videos / 5 clips
    const clipsLimit = profile ? Math.max(planInfo.clips, profile.clips_limit) : planInfo.clips;
    const videosLimit = profile ? Math.max(planInfo.videos, profile.videos_limit) : planInfo.videos;
    const clipsUsed = profile?.clips_used ?? 0;
    const videosUsed = profile?.videos_used ?? 0;
    const usagePercent = Math.min(100, Math.round((clipsUsed / clipsLimit) * 100));

    return (
        <div className="max-w-2xl mx-auto">
            {/* ─── Toast Notification ─── */}
            {toast && (
                <div className={`toast toast-${toast.type} fixed top-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-2xl border ${
                    toast.type === "success" 
                        ? "bg-[#10b981]/10 border-[#10b981]/25 text-[#10b981]" 
                        : "bg-[#ef4444]/10 border-[#ef4444]/25 text-[#ef4444]"
                }`} key={toast.message}>
                    {toast.type === "success" ? <Check size={16} /> : <AlertTriangle size={16} />}
                    <span className="text-sm font-semibold">{toast.message}</span>
                </div>
            )}

            {/* ─── Header ─── */}
            <div className="mb-8">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-100 mb-1">Settings</h1>
                <p className="text-sm text-[#64748b]">
                    Manage your account, preferences, and subscription
                </p>
            </div>

            {/* ─── Tab Navigation ─── */}
            <div className="tab-nav mb-8">
                {TABS.map((tab) => {
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.key}
                            className={`tab-item ${activeTab === tab.key ? "active" : ""}`}
                            onClick={() => setActiveTab(tab.key)}
                        >
                            <Icon size={15} /> <span>{tab.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* ═══════════ Profile Tab ═══════════ */}
            {activeTab === "profile" && (
                <div className="glass-card p-6 sm:p-8">
                    <div className="flex items-center gap-5 mb-8">
                        <div className="w-16 h-16 rounded-full bg-text-mint-400 flex items-center justify-center text-2xl font-black text-white shadow-lg shadow-mint-500/10 flex-shrink-0">
                            {initial}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-100">{fullName || "User"}</h2>
                            <p className="text-sm text-[#64748b] mt-0.5">{email}</p>
                            <div className="mt-2.5">
                                <span className={`plan-badge ${planKey}`}>
                                    {planKey} plan
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-8">
                        <div>
                            <label className="block text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-2">Full Name</label>
                            <input
                                type="text"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                className="input-field"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-2">Email Address</label>
                            <input
                                type="email"
                                value={email}
                                disabled
                                className="input-field opacity-50 cursor-not-allowed"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-slate-200 mb-4">Default Caption Style</label>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {CAPTION_STYLES.map((style) => (
                                <button
                                    key={style.value}
                                    onClick={() => setDefaultStyle(style.value)}
                                    className={`p-3.5 rounded-xl text-left transition-all duration-200 flex items-center justify-between border ${
                                        defaultStyle === style.value
                                            ? "border-mint-500 bg-mint-500/10 text-slate-100"
                                            : "border-white/5 bg-[#08080c]/30 hover:border-white/10 text-[#94a3b8] hover:text-slate-200"
                                    }`}
                                >
                                    <span className="text-sm font-semibold">
                                        {style.label}
                                    </span>
                                    {defaultStyle === style.value && <Check size={14} className="text-mint-400" />}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ═══════════ Notifications Tab ═══════════ */}
            {activeTab === "notifications" && (
                <div className="glass-card p-6 sm:p-8">
                    <h3 className="text-lg font-bold text-slate-100 mb-6 flex items-center gap-2">
                        <Bell size={18} className="text-mint-400" />
                        Notification Preferences
                    </h3>
                    <div className="flex flex-col gap-6">
                        {[
                            { key: "discord" as const, label: "Discord Notifications", desc: "Get notified via Discord webhook when jobs are processed" },
                            { key: "email" as const, label: "Email Notifications", desc: "Receive email updates for completed jobs" },
                            { key: "jobComplete" as const, label: "Job Completed", desc: "Notify when video processing finishes successfully" },
                            { key: "jobFailed" as const, label: "Job Failed", desc: "Alert when processing encounters errors" },
                            { key: "weeklyReport" as const, label: "Weekly Report", desc: "Summary of clips, performance, and usage" },
                        ].map((item) => (
                            <div key={item.key} className="border-b border-white/5 last:border-0 pb-6 last:pb-0">
                                <div className="flex justify-between items-center">
                                    <div>
                                        <div className="text-sm font-semibold text-slate-200">{item.label}</div>
                                        <div className="text-xs text-[#64748b] mt-1">{item.desc}</div>
                                    </div>
                                    <button
                                        className={`toggle-switch ${notifications[item.key] ? "active" : ""}`}
                                        onClick={() => setNotifications((n) => ({ ...n, [item.key]: !n[item.key] }))}
                                    />
                                </div>

                                {item.key === "discord" && notifications.discord && (
                                    <div className="mt-4 pt-4 border-t border-white/5">
                                        <label className="block text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-2">
                                            Discord Webhook URL
                                        </label>
                                        <input
                                            type="url"
                                            value={discordWebhookUrl}
                                            onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                                            placeholder="https://discord.com/api/webhooks/..."
                                            className="input-field text-sm"
                                        />
                                        <a
                                            href="https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 mt-2.5 text-xs text-mint-400 hover:text-[#a78bfa] transition-colors no-underline font-medium"
                                        >
                                            <ExternalLink size={12} />
                                            <span>How to create a Discord webhook</span>
                                        </a>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ═══════════ Billing Tab ═══════════ */}
            {activeTab === "billing" && (
                <div className="flex flex-col gap-6">
                    {/* ─── Current Plan Card ─── */}
                    <div className="glass-card p-6 sm:p-8 relative overflow-hidden">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-6">
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <Crown size={20} className={planKey === "free" ? "text-[#64748b]" : "text-mint-400"} />
                                    <span className="gradient-text bg-text-mint-400 text-xl font-extrabold">
                                        {planInfo.label} Plan
                                    </span>
                                </div>
                                <div className="text-sm text-[#64748b] leading-relaxed">
                                    {clipsUsed} / {clipsLimit} clips used
                                    <br />
                                    {videosUsed} / {videosLimit} videos used
                                </div>
                            </div>
                            <Link href="/pricing" className="btn-primary py-2.5 px-5 text-sm font-semibold flex items-center gap-2 shadow-lg no-underline">
                                <Sparkles size={14} /> <span>{planKey === "free" ? "Upgrade Plan" : "Change Plan"}</span> <ArrowUpRight size={14} />
                            </Link>
                        </div>

                        {/* Usage progress */}
                        <div className="mt-6 pt-6 border-t border-white/5">
                            <div className="flex justify-between text-xs text-[#64748b] font-semibold mb-2">
                                <span>CLIPS USAGE</span>
                                <span>{usagePercent}%</span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-[#08080c] overflow-hidden">
                                <div className="h-full rounded-full bg-text-mint-400 transition-[width] duration-500" style={{ width: `${usagePercent}%` }} />
                            </div>
                        </div>
                    </div>

                    {/* ─── Subscription Details Card (for paid users) ─── */}
                    {planKey !== "free" && (
                        <div className="glass-card p-6 sm:p-8">
                            <h3 className="text-base font-bold text-slate-100 mb-6 flex items-center gap-2.5">
                                <CreditCard size={16} className="text-mint-400" />
                                Subscription Details
                            </h3>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                                {/* Status */}
                                <div className="p-4 rounded-xl bg-[#08080c]/50 border border-white/5">
                                    <div className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-1.5">
                                        Status
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${
                                            hasActiveSubscription ? "bg-[#10b981]" : isCancelled ? "bg-[#ef4444]" : "bg-[#64748b]"
                                        }`} />
                                        <span className={`text-sm font-bold ${
                                            hasActiveSubscription ? "text-[#10b981]" : isCancelled ? "text-[#ef4444]" : "text-slate-300"
                                        }`}>
                                            {hasActiveSubscription ? "Active" : isCancelled ? "Cancelled" : profile?.subscription_status === "none" ? "One-time" : (profile?.subscription_status ?? "None")}
                                        </span>
                                    </div>
                                </div>

                                {/* Billing Period */}
                                <div className="p-4 rounded-xl bg-[#08080c]/50 border border-white/5">
                                    <div className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-1.5">
                                        Billing Period
                                    </div>
                                    <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
                                        {profile?.plan_period === "one_time" ? (
                                            <><Zap size={14} className="text-mint-400" /> <span>One-time</span></>
                                        ) : profile?.plan_period === "annual" ? (
                                            <><Calendar size={14} className="text-mint-400" /> <span>Annual</span></>
                                        ) : (
                                            <><RefreshCw size={14} className="text-mint-400" /> <span>Monthly</span></>
                                        )}
                                    </div>
                                </div>

                                {/* Amount */}
                                <div className="p-4 rounded-xl bg-[#08080c]/50 border border-white/5">
                                    <div className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-1.5">
                                        Amount
                                    </div>
                                    <div className="text-sm font-bold text-slate-200">
                                        ₹{((profile?.plan_period === "annual" ? planInfo.annualPrice : planInfo.monthlyPrice) / 100).toLocaleString("en-IN")}
                                        <span className="text-xs text-[#64748b] font-medium ml-1">
                                            {profile?.plan_period === "annual" ? "/mo" : profile?.plan_period === "one_time" ? "/30 days" : "/mo"}
                                        </span>
                                    </div>
                                </div>

                                {/* Next Billing / Expiry */}
                                {periodEndDate && (
                                    <div className="p-4 rounded-xl bg-[#08080c]/50 border border-white/5">
                                        <div className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-1.5">
                                            {isCancelled ? "Access Until" : hasActiveSubscription ? "Next Billing" : "Expires"}
                                        </div>
                                        <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
                                            <Calendar size={14} className="text-[#64748b]" />
                                            <span>{periodEndDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Cancel notice */}
                            {isCancelled && periodEndDate && (
                                <div className="p-4 rounded-xl bg-[#ef4444]/5 border border-[#ef4444]/15 mb-6 flex items-start gap-3">
                                    <AlertTriangle size={16} className="text-[#ef4444] flex-shrink-0 mt-0.5" />
                                    <span className="text-xs text-slate-300 leading-relaxed">
                                        Your subscription has been cancelled. You&apos;ll retain access to all features until{" "}
                                        <strong className="text-slate-100">{periodEndDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</strong>.
                                        After that, your plan will revert to Free.
                                    </span>
                                </div>
                            )}

                            {/* Cancel button (only for active subscriptions) */}
                            {hasActiveSubscription && (profile?.cashfree_subscription_id || profile?.cashfree_order_id) && (
                                <button
                                    className="btn-secondary border-red-500/20 hover:border-red-500/35 text-[#ef4444] hover:bg-[#ef4444]/5 py-2.5 px-4 text-xs font-semibold flex items-center gap-2"
                                    onClick={() => setShowCancelConfirm(true)}
                                >
                                    <XCircle size={14} /> Cancel Subscription
                                </button>
                            )}
                        </div>
                    )}

                    {/* ─── Upgrade CTA (for free users) ─── */}
                    {planKey === "free" && (
                        <div className="glass-card p-6 sm:p-8">
                            <h3 className="text-base font-bold text-slate-100 mb-5 flex items-center gap-2">
                                <Sparkles size={16} className="text-mint-400" />
                                What you get with Creator Plan
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                                {[
                                    "30 videos per month",
                                    "150 clips per month",
                                    "Priority processing",
                                    "All caption styles",
                                    "API access",
                                    "Email support",
                                ].map((feature) => (
                                    <div key={feature} className="flex items-center gap-2.5 text-sm text-[#94a3b8]">
                                        <Check size={16} className="text-[#10b981] flex-shrink-0" />
                                        <span>{feature}</span>
                                    </div>
                                ))}
                            </div>
                            <Link
                                href="/pricing"
                                className="btn-primary py-3 px-6 text-sm font-bold flex items-center justify-center gap-2 shadow-lg no-underline"
                            >
                                <Sparkles size={16} /> Upgrade to Creator — ₹499/mo
                            </Link>
                        </div>
                    )}

                    {/* ─── Payment History ─── */}
                    {payments.length > 0 && (
                        <div className="glass-card p-6 sm:p-8">
                            <h3 className="text-base font-bold text-slate-100 mb-6 flex items-center gap-2.5">
                                <Receipt size={16} className="text-mint-400" />
                                Payment History
                            </h3>
                            <div className="flex flex-col">
                                {payments.map((payment, i) => (
                                    <div
                                        key={payment.id}
                                        className={`flex justify-between items-center py-4 ${
                                            i < payments.length - 1 ? "border-b border-white/5" : ""
                                        }`}
                                    >
                                        <div>
                                            <div className="text-sm font-semibold text-slate-200">
                                                {payment.plan.charAt(0).toUpperCase() + payment.plan.slice(1)} Plan
                                                <span className={`text-[10px] font-bold ml-2.5 px-2 py-0.5 rounded-md ${
                                                    payment.status === "captured"
                                                        ? "bg-[#10b981]/15 text-[#10b981]"
                                                        : "bg-[#ef4444]/15 text-[#ef4444]"
                                                }`}>
                                                    {payment.status === "captured" ? "Paid" : payment.status}
                                                </span>
                                            </div>
                                            <div className="text-xs text-[#64748b] mt-1">
                                                {new Date(payment.created_at).toLocaleDateString("en-IN", {
                                                    day: "numeric", month: "short", year: "numeric",
                                                })}
                                                {" · "}
                                                {payment.plan_period === "one_time" ? "One-time" : payment.plan_period === "annual" ? "Annual" : "Monthly"}
                                            </div>
                                        </div>
                                        <div className="text-base font-bold text-slate-200">
                                            ₹{(payment.amount / 100).toLocaleString("en-IN")}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ═══════════ Security Tab ═══════════ */}
            {activeTab === "security" && (
                <div className="flex flex-col gap-6">
                    <div className="glass-card p-6 sm:p-8">
                        <h3 className="text-base font-bold text-slate-100 mb-2 flex items-center gap-2">
                            <Lock size={16} className="text-mint-400" /> Password
                        </h3>
                        <p className="text-sm text-[#64748b] mb-6">
                            Change your password or set one if you signed up with Google OAuth
                        </p>
                        <button
                            className="btn-secondary text-sm py-2.5 px-4 font-semibold"
                            onClick={async () => {
                                // Redirect to /auth/callback so the recovery code
                                // is exchanged there and the user lands on the
                                // update-password page (not the site root).
                                const { error } = await supabase.auth.resetPasswordForEmail(
                                    email,
                                    { redirectTo: `${window.location.origin}/auth/callback` }
                                );
                                if (error) {
                                    showToast("error", "Could not send the reset email. Please try again.");
                                } else {
                                    showToast("success", "Password reset email sent");
                                }
                            }}
                        >
                            Send Password Reset Email
                        </button>
                    </div>

                    <div className="danger-zone p-6 sm:p-8">
                        <h3 className="text-base font-bold text-[#ef4444] mb-2 flex items-center gap-2">
                            <AlertTriangle size={16} /> Danger Zone
                        </h3>
                        <p className="text-sm text-[#64748b] mb-6 leading-relaxed">
                            Permanently delete your account and all associated data. This action is irreversible — all your jobs, clips, API keys, and settings will be permanently removed.
                        </p>
                        <button
                            className="btn-secondary border-red-500/20 hover:border-red-500/35 text-[#ef4444] hover:bg-[#ef4444]/5 py-2.5 px-4 text-sm font-semibold flex items-center gap-2"
                            onClick={() => setShowDeleteConfirm(true)}
                        >
                            <Trash2 size={14} /> Delete Account
                        </button>
                    </div>
                </div>
            )}

            {/* ─── Save Button (visible on profile + notifications tabs) ─── */}
            {(activeTab === "profile" || activeTab === "notifications") && (
                <button
                    className="btn-primary w-full py-3.5 px-6 text-sm font-bold flex items-center justify-center gap-2 shadow-lg mt-6"
                    onClick={handleSave}
                    disabled={saving}
                >
                    {saving ? <Loader2 size={18} className="animate-spin" /> : <><Save size={18} /> Save Changes</>}
                </button>
            )}

            {/* ─── Cancel Subscription Confirmation Modal ─── */}
            {showCancelConfirm && (
                <div
                    className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm"
                    onClick={() => setShowCancelConfirm(false)}
                >
                    <div
                        className="glass-card p-6 sm:p-8 w-full max-w-md animate-scale-in"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-4 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-[#ef4444]/10 flex items-center justify-center flex-shrink-0">
                                <XCircle size={20} className="text-[#ef4444]" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-100">Cancel Subscription</h3>
                                <p className="text-xs text-[#64748b] mt-1">You&apos;ll retain access until the end of your billing period</p>
                            </div>
                        </div>

                        <div className="p-4 rounded-xl bg-[#ef4444]/5 border border-[#ef4444]/15 mb-6">
                            <p className="text-sm text-slate-300 leading-relaxed">
                                After cancellation you&apos;ll keep access to all {planInfo.label} plan features until your current billing period ends.
                                Your plan will then revert to Free with 5 clips/month and 2 videos/month.
                            </p>
                        </div>

                        <div className="flex gap-3">
                            <button
                                className="btn-secondary flex-1 justify-center py-2.5 font-semibold text-sm"
                                onClick={() => setShowCancelConfirm(false)}
                            >
                                Keep Subscription
                            </button>
                            <button
                                className="btn-primary bg-[#ef4444] hover:bg-[#dc2626] border-[#ef4444] hover:border-[#dc2626] flex-1 justify-center py-2.5 font-semibold text-sm flex items-center gap-2"
                                disabled={cancelling}
                                onClick={handleCancelSubscription}
                            >
                                {cancelling ? <Loader2 size={14} className="animate-spin" /> : <><XCircle size={14} /> Cancel</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Delete Account Confirmation Modal ─── */}
            {showDeleteConfirm && (
                <div
                    className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm"
                    onClick={() => { setShowDeleteConfirm(false); setDeleteInput(""); }}
                >
                    <div
                        className="glass-card p-6 sm:p-8 w-full max-w-md animate-scale-in"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-4 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-[#ef4444]/10 flex items-center justify-center flex-shrink-0">
                                <AlertTriangle size={20} className="text-[#ef4444]" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-[#ef4444]">Delete Account</h3>
                                <p className="text-xs text-[#64748b] mt-1">This cannot be undone</p>
                            </div>
                        </div>

                        <div className="p-4 rounded-xl bg-[#ef4444]/5 border border-[#ef4444]/15 mb-5">
                            <p className="text-sm text-slate-300 leading-relaxed">
                                All your data will be permanently deleted including jobs, clips, API keys, and settings.
                            </p>
                        </div>

                        <label className="block text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-2">
                            Type <strong className="text-[#ef4444]">DELETE</strong> to confirm
                        </label>
                        <input
                            type="text"
                            value={deleteInput}
                            onChange={(e) => setDeleteInput(e.target.value)}
                            placeholder="DELETE"
                            className="input-field mb-6"
                        />

                        <div className="flex gap-3">
                            <button
                                className="btn-secondary flex-1 justify-center py-2.5 font-semibold text-sm"
                                onClick={() => { setShowDeleteConfirm(false); setDeleteInput(""); }}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn-primary bg-[#ef4444] hover:bg-[#dc2626] border-[#ef4444] hover:border-[#dc2626] flex-1 justify-center py-2.5 font-semibold text-sm flex items-center gap-2"
                                disabled={deleteInput !== "DELETE" || deleting}
                                onClick={handleDeleteAccount}
                                style={{ opacity: deleteInput === "DELETE" ? 1 : 0.4 }}
                            >
                                {deleting ? <Loader2 size={14} className="animate-spin" /> : <><Trash2 size={14} /> Delete Account</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
