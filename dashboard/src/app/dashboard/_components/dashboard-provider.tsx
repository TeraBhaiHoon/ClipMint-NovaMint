"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { createLoadScope } from "@/lib/load-scope";
import type { Profile } from "@/lib/types";

type Account = { id: string; email: string };
type DashboardContextValue = {
    account: Account | null;
    profile: Profile | null;
    loading: boolean;
    usageReady: boolean;
    error: string | null;
    refreshProfile: () => Promise<void>;
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const supabase = useMemo(() => createClient(), []);
    const [account, setAccount] = useState<Account | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    const [usageReady, setUsageReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const refreshRef = useRef<(() => Promise<void>) | null>(null);
    const refreshProfile = useCallback(async () => { await refreshRef.current?.(); }, []);

    useEffect(() => {
        let disposed = false;
        let scope = createLoadScope();
        let identity: string | null | undefined;
        let verifiedAccountId: string | null = null;
        let scheduled: ReturnType<typeof setTimeout> | undefined;

        function clearAccount() {
            verifiedAccountId = null;
            setAccount(null);
            setProfile(null);
            setUsageReady(false);
        }

        async function refresh() {
            const requestScope = scope;
            if (disposed || !requestScope.active || requestScope.busy) return;
            const current = () => !disposed && scope === requestScope && requestScope.active;
            setUsageReady(false);
            try {
                const result = await requestScope.run(async (signal) => {
                    const { data: { user }, error: authError } = await supabase.auth.getUser();
                    if (!current() || signal.aborted) return null;
                    if (!user) {
                        if (authError && authError.name !== "AuthSessionMissingError") throw authError;
                        return { signedOut: true as const };
                    }
                    // Only a server-validated user can unlock owner-filtered dashboard reads.
                    if (verifiedAccountId !== user.id) setProfile(null);
                    verifiedAccountId = user.id;
                    identity = user.id;
                    setAccount((previous) => previous?.id === user.id && previous.email === (user.email || "")
                        ? previous : { id: user.id, email: user.email || "" });

                    // Rollover is optional for preferences, not for authoritative usage.
                    // Its sub-budget leaves time for the profile read inside the total 15s deadline.
                    let rolled = false;
                    const rollover = createLoadScope(5_000);
                    const abortRollover = () => rollover.dispose();
                    signal.addEventListener("abort", abortRollover, { once: true });
                    try {
                        const { error: rolloverError } = await rollover.run((rolloverSignal) =>
                            supabase.rpc("roll_usage_period_if_due", { p_user_id: user.id }).abortSignal(rolloverSignal));
                        rolled = !rolloverError;
                    } catch { /* Preferences remain readable; quota stays unavailable. */ }
                    finally { signal.removeEventListener("abort", abortRollover); rollover.dispose(); }
                    if (!current() || signal.aborted) return null;
                    const { data, error: profileError } = await supabase.from("profiles").select("*").eq("id", user.id).abortSignal(signal).single();
                    if (profileError || !data) throw profileError || new Error("Profile unavailable");
                    return { signedOut: false as const, profile: data as Profile, rolled };
                });
                if (!current() || !result) return;
                if (result.signedOut) {
                    clearAccount();
                    router.replace("/login?next=%2Fdashboard");
                    return;
                }
                setProfile(result.profile);
                setUsageReady(result.rolled);
                setError(null);
            } catch {
                if (current()) {
                    setUsageReady(false);
                    setError("Your account details couldn’t be refreshed. Please try again.");
                }
            } finally {
                if (current()) setLoading(false);
            }
        }

        function scheduleRefresh() {
            clearTimeout(scheduled);
            scheduled = setTimeout(() => { if (!disposed) void refresh(); }, 0);
        }
        const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
            if (disposed) return;
            const nextIdentity = session?.user.id ?? null;
            if (event === "SIGNED_OUT" || identity !== nextIdentity) {
                // Invalidate synchronously, before an old request can publish another account's data.
                scope.dispose();
                scope = createLoadScope();
                clearAccount();
                setError(null);
                setLoading(true);
            }
            identity = nextIdentity;
            // Do not await any SDK operation inside the auth lock's callback.
            scheduleRefresh();
        });
        refreshRef.current = refresh;
        void refresh();
        const refreshWhenVisible = () => {
            if (document.visibilityState === "visible") void refresh();
        };
        const timer = setInterval(refreshWhenVisible, 60_000);
        window.addEventListener("focus", refreshWhenVisible);
        document.addEventListener("visibilitychange", refreshWhenVisible);
        return () => {
            disposed = true;
            scope.dispose();
            clearTimeout(scheduled);
            clearInterval(timer);
            listener.subscription.unsubscribe();
            window.removeEventListener("focus", refreshWhenVisible);
            document.removeEventListener("visibilitychange", refreshWhenVisible);
            if (refreshRef.current === refresh) refreshRef.current = null;
        };
    }, [router, supabase]);

    return <DashboardContext.Provider value={{ account, profile, loading, usageReady, error, refreshProfile }}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
    const context = useContext(DashboardContext);
    if (!context) throw new Error("useDashboard requires DashboardProvider");
    return context;
}
