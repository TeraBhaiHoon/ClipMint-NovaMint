"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Bell, CreditCard, ExternalLink, LockKeyhole, Mail, ReceiptText, Save, ShieldCheck, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { CAPTION_STYLES, PLAN_LIMITS, effectivePlanKey, isPlanExpired, type CaptionStyle, type Payment } from "@/lib/types";
import { captionPreferenceKey, formatDate, readCaptionPreference } from "@/lib/dashboard";
import { useDashboard } from "../_components/dashboard-provider";
import { Button, Choice, EmptyState, LoadingState, Notice, PageHeader, SectionHeading, Toggle, UsageMeter } from "../_components/ui";

type Tab = "profile" | "notifications" | "billing" | "security";
const TABS = [
    { key: "profile", label: "Profile", icon: UserRound },
    { key: "notifications", label: "Notifications", icon: Bell },
    { key: "billing", label: "Plan & billing", icon: CreditCard },
    { key: "security", label: "Security", icon: ShieldCheck },
] as const;
const NOTIFICATIONS = [
    { key: "notify_discord", label: "Discord notifications", description: "Send job updates to your Discord webhook." },
    { key: "notify_email", label: "Email notifications", description: "Receive job updates at your account email." },
    { key: "notify_job_complete", label: "Processing completed", description: "Let me know when my clips are ready." },
    { key: "notify_job_failed", label: "Processing failed", description: "Let me know if a video needs attention." },
    { key: "notify_weekly_report", label: "Weekly summary", description: "Not available yet. Your saved preference is retained for future support." },
] as const;
type Preferences = Record<typeof NOTIFICATIONS[number]["key"], boolean>;
const INITIAL: Preferences = { notify_discord: true, notify_email: false, notify_job_complete: true, notify_job_failed: true, notify_weekly_report: false };

export default function SettingsPage() {
    const supabase = useMemo(() => createClient(), []);
    const { account, profile, loading, error: accountError, refreshProfile } = useDashboard();
    const [tab, setTab] = useState<Tab>("profile");
    const [fullName, setFullName] = useState("");
    const [style, setStyle] = useState<CaptionStyle>("hormozi");
    const [preferences, setPreferences] = useState(INITIAL);
    const [webhook, setWebhook] = useState("");
    const [initialized, setInitialized] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [paymentLoading, setPaymentLoading] = useState(true);
    const [paymentError, setPaymentError] = useState(false);
    const [paymentRetry, setPaymentRetry] = useState(0);
    const [resetPending, setResetPending] = useState(false);
    const [resetSent, setResetSent] = useState(false);
    const tabsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const readTab = () => {
            const requested = new URLSearchParams(window.location.search).get("tab");
            if (TABS.some((item) => item.key === requested)) setTab(requested as Tab);
        };
        readTab();
        window.addEventListener("popstate", readTab);
        return () => window.removeEventListener("popstate", readTab);
    }, []);

    useEffect(() => {
        if (!profile || initialized === profile.id) return;
        const frame = requestAnimationFrame(() => {
            setFullName(profile.full_name || "");
            setStyle(readCaptionPreference(profile.id));
            setWebhook(profile.discord_webhook_url || "");
            setPreferences({
                notify_discord: profile.notify_discord ?? true,
                notify_email: profile.notify_email ?? false,
                notify_job_complete: profile.notify_job_complete ?? true,
                notify_job_failed: profile.notify_job_failed ?? true,
                notify_weekly_report: profile.notify_weekly_report ?? false,
            });
            setInitialized(profile.id);
        });
        return () => cancelAnimationFrame(frame);
    }, [initialized, profile]);

    useEffect(() => {
        if (!account || tab !== "billing") return;
        let disposed = false;
        async function load() {
            setPaymentLoading(true);
            setPaymentError(false);
            try {
                const { data, error } = await supabase.from("payments").select("*").eq("user_id", account!.id).order("created_at", { ascending: false }).limit(20);
                if (error) throw error;
                if (!disposed) setPayments((data || []) as Payment[]);
            } catch { if (!disposed) setPaymentError(true); }
            finally { if (!disposed) setPaymentLoading(false); }
        }
        void load();
        return () => { disposed = true; };
    }, [account, paymentRetry, supabase, tab]);

    function changeTab(next: Tab) {
        setTab(next);
        setMessage(null);
        const url = new URL(window.location.href);
        url.searchParams.set("tab", next);
        window.history.replaceState(null, "", url);
    }

    async function save(event: React.FormEvent) {
        event.preventDefault();
        if (!profile || saving) return;
        setSaving(true);
        setMessage(null);
        try {
            if (preferences.notify_discord && webhook.trim() && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(webhook.trim())) throw new Error("Enter a valid Discord webhook URL before saving.");
            const { error } = await supabase.from("profiles").update({
                full_name: fullName.trim(), ...preferences, discord_webhook_url: webhook.trim() || null,
            }).eq("id", profile.id);
            if (error) throw new Error("Your settings couldn’t be saved. Please try again.");
            let localSaved = true;
            try { localStorage.setItem(captionPreferenceKey(profile.id), style); } catch { localSaved = false; }
            setDirty(false);
            setMessage({ tone: localSaved ? "success" : "error", text: localSaved ? "Settings saved. Your caption preference applies on this browser." : "Account settings saved, but this browser blocked saving your caption preference." });
            await refreshProfile();
        } catch (cause) { setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Couldn’t save settings. Please try again." }); }
        finally { setSaving(false); }
    }

    async function resetPassword() {
        if (!account?.email || resetPending || resetSent) return;
        setResetPending(true);
        setMessage(null);
        try {
            const { error } = await supabase.auth.resetPasswordForEmail(account.email, { redirectTo: `${window.location.origin}/auth/callback` });
            if (error) throw error;
            setResetSent(true);
            setMessage({ tone: "success", text: "Password reset email sent. Check your inbox to continue." });
        } catch { setMessage({ tone: "error", text: "The reset email couldn’t be sent. Please try again." }); }
        finally { setResetPending(false); }
    }

    const planKey = effectivePlanKey(profile);
    const plan = PLAN_LIMITS[planKey];
    const expired = isPlanExpired(profile);
    const editable = tab === "profile" || tab === "notifications";
    const initial = (profile?.full_name || account?.email || "You").charAt(0).toUpperCase();

    return <div className="studio-page">
        <PageHeader eyebrow="Make it yours" title="Settings" description="Your account, notification preferences, and plan—without the clutter." />
        <div className="studio-settings-layout">
            <div className="studio-settings-tabs" role="tablist" aria-label="Settings sections" ref={tabsRef} onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const index = TABS.findIndex((item) => item.key === tab);
                const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + TABS.length) % TABS.length;
                changeTab(TABS[next].key);
                tabsRef.current?.querySelector<HTMLButtonElement>(`#settings-tab-${TABS[next].key}`)?.focus();
            }}>{TABS.map((item) => <button key={item.key} id={`settings-tab-${item.key}`} type="button" role="tab" aria-selected={tab === item.key} aria-controls={`settings-panel-${item.key}`} tabIndex={tab === item.key ? 0 : -1} onClick={() => changeTab(item.key)}><item.icon size={18} aria-hidden="true" />{item.label}</button>)}</div>
            <div className="studio-settings-content" id={`settings-panel-${tab}`} role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
                {message && <Notice tone={message.tone}>{message.text}</Notice>}
                {loading || (profile && initialized !== profile.id) ? <div className="studio-panel"><LoadingState label="Loading account settings" /></div> : !profile || accountError ? <Notice tone="error" action={<Button variant="secondary" onClick={() => void refreshProfile()}>Try again</Button>}>Account settings are temporarily unavailable.</Notice> : <>
                    {editable && <form onSubmit={save} className="studio-stack">
                        <fieldset disabled={saving} className="studio-settings-fields">
                            {tab === "profile" ? <>
                                <section className="studio-panel"><SectionHeading title="Your profile" description="The name shown in your ClipMint workspace." icon={UserRound} />
                                    <div className="studio-profile-intro"><span className="studio-avatar studio-avatar--large" aria-hidden="true">{initial}</span><div><strong>{profile.full_name || "Your account"}</strong><p>{account?.email}</p></div><span className="studio-plan-pill">{plan.label} plan</span></div>
                                    <div className="studio-grid-two"><div className="studio-field"><label htmlFor="full-name">Full name</label><input id="full-name" className="studio-input" value={fullName} maxLength={100} autoComplete="name" onChange={(event) => { setFullName(event.target.value); setDirty(true); }} /></div><div className="studio-field"><label htmlFor="account-email">Email address</label><input id="account-email" className="studio-input" value={account?.email || ""} disabled type="email" /><p className="studio-field-hint">Linked to your sign-in account.</p></div></div>
                                </section>
                                <section className="studio-panel"><SectionHeading title="Default caption style" description="Used for new videos on this browser. You can choose another style for any project." />
                                    <div className="studio-choice-grid studio-settings-style-grid" role="group" aria-label="Default caption style">{CAPTION_STYLES.map((item) => <Choice key={item.value} selected={style === item.value} title={item.label} onClick={() => { setStyle(item.value); setDirty(true); }} />)}</div>
                                </section>
                            </> : <>
                                <section className="studio-panel"><SectionHeading title="Notification channels" description="Choose where you want to receive updates." icon={Bell} /><div className="studio-settings-rows">{NOTIFICATIONS.slice(0, 2).map((item) => <div key={item.key}><Toggle label={item.label} description={item.description} checked={preferences[item.key]} onChange={(value) => { setPreferences((old) => ({ ...old, [item.key]: value })); setDirty(true); }} />{item.key === "notify_discord" && preferences.notify_discord && <div className="studio-field studio-webhook-field"><label htmlFor="discord-webhook">Discord webhook URL</label><input id="discord-webhook" className="studio-input" type="url" value={webhook} placeholder="https://discord.com/api/webhooks/…" onChange={(event) => { setWebhook(event.target.value); setDirty(true); }} /><a className="studio-text-link studio-inline" href="https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks" target="_blank" rel="noopener noreferrer">How to create a webhook<ExternalLink size={14} aria-hidden="true" /></a></div>}</div>)}</div></section>
                                <section className="studio-panel"><SectionHeading title="Events & updates" description="Select the job events you want to hear about." /><div className="studio-settings-rows">{NOTIFICATIONS.slice(2).map((item) => <Toggle key={item.key} label={item.label} description={item.description} checked={preferences[item.key]} disabled={item.key === "notify_weekly_report"} onChange={(value) => { setPreferences((old) => ({ ...old, [item.key]: value })); setDirty(true); }} />)}</div></section>
                            </>}
                        </fieldset>
                        <div className="studio-save-bar"><p>{dirty ? "You have unsaved changes." : "Your preferences are up to date."}</p><Button type="submit" busy={saving} disabled={!dirty}><Save size={17} aria-hidden="true" />{saving ? "Saving…" : "Save changes"}</Button></div>
                    </form>}
                    {tab === "billing" && <div className="studio-stack">
                        <section className="studio-panel"><SectionHeading title="Your current plan" description="Usage resets in 30-day windows. Saved videos and clips remain in your library." icon={CreditCard} action={<Link href="/pricing" className="studio-button studio-button--secondary">{planKey === "free" ? "View plans" : "Change plan"}<ArrowUpRight size={16} aria-hidden="true" /></Link>} />
                            <div className="studio-billing-plan"><strong>{plan.label}</strong><span className={`studio-badge studio-badge--${planKey === "free" ? "neutral" : "success"}`}>{planKey === "free" ? "Free account" : "Active pass"}</span></div>
                            {expired && <Notice tone="warning">Your paid pass expired on {formatDate(profile.current_period_end)}. Free limits now apply; your existing clips are still available.</Notice>}
                            <div className="studio-grid-two studio-billing-usage"><UsageMeter label="Clips this period" used={profile.clips_used || 0} limit={plan.clips} /><UsageMeter label="Videos this period" used={profile.videos_used || 0} limit={plan.videos} /></div>
                            {!!profile.clips_reserved && <p className="studio-field-hint">{profile.clips_reserved} clips are reserved for active processing. Only successfully delivered clips become used quota; unused reservations are released.</p>}
                            <dl className="studio-billing-details"><div><dt>Billing</dt><dd>{planKey === "free" ? "No payment required" : "One-time payment · no auto-renewal"}</dd></div>{planKey !== "free" && <><div><dt>Access period</dt><dd>{profile.plan_period === "annual" ? "Annual" : "30 days"}</dd></div><div><dt>Active until</dt><dd>{formatDate(profile.current_period_end)}</dd></div></>}</dl>
                        </section>
                        {planKey === "free" && <section className="studio-plan-upgrade"><div><h2>More room to create</h2><p>Creator includes 150 clips and 30 videos per period, with all caption styles.</p></div><Link href="/pricing" className="studio-button studio-button--primary">Explore Creator<ArrowUpRight size={16} aria-hidden="true" /></Link></section>}
                        <section className="studio-panel"><SectionHeading title="Payment history" description="Your 20 most recent payment records." icon={ReceiptText} />
                            {paymentLoading ? <LoadingState label="Loading payment history" rows={2} /> : paymentError ? <Notice tone="error" action={<Button variant="secondary" onClick={() => setPaymentRetry((value) => value + 1)}>Try again</Button>}>Payment history couldn’t be loaded.</Notice> : !payments.length ? <EmptyState icon={ReceiptText} title="No payments yet" description="When you purchase a plan, the record will appear here." /> : <ul className="studio-payment-list">{payments.map((payment) => <li key={payment.id}><span><strong>{PLAN_LIMITS[payment.plan]?.label || payment.plan} plan</strong><small>{formatDate(payment.created_at)} · {payment.plan_period === "annual" ? "Annual" : "One-time"}</small></span><span className={`studio-badge studio-badge--${payment.status === "captured" ? "success" : payment.status === "failed" ? "error" : "neutral"}`}>{payment.status === "captured" ? "Paid" : payment.status}</span><strong>{new Intl.NumberFormat("en-IN", { style: "currency", currency: payment.currency || "INR", maximumFractionDigits: 0 }).format(payment.amount / 100)}</strong></li>)}</ul>}
                        </section>
                    </div>}
                    {tab === "security" && <div className="studio-stack">
                        <section className="studio-panel"><SectionHeading title="Password & sign-in" description="Change your password, or set one if you normally sign in with Google." icon={LockKeyhole} /><div className="studio-security-action"><div><strong>Password reset email</strong><p>We’ll send a secure reset link to {account?.email}.</p></div><Button variant="secondary" onClick={resetPassword} busy={resetPending} disabled={resetSent}><Mail size={17} aria-hidden="true" />{resetSent ? "Email sent" : "Send reset email"}</Button></div></section>
                        <section className="studio-panel"><SectionHeading title="Account & data" description="Account removal is handled through support, not by signing out." icon={ShieldCheck} /><p className="studio-small studio-muted">To request deletion of your account and associated data, contact support from your account email. We’ll confirm ownership before removing anything.</p><Link className="studio-button studio-button--secondary studio-support-action" href="/contact">Contact support<ArrowUpRight size={16} aria-hidden="true" /></Link></section>
                    </div>}
                </>}
            </div>
        </div>
    </div>;
}
