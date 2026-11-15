"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

type Account = { id: string; email: string };
type DashboardContextValue = {
    account: Account | null;
    profile: Profile | null;
    loading: boolean;
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
    const [error, setError] = useState<string | null>(null);
    const inFlight = useRef(false);
    const mounted = useRef(false);

    const refreshProfile = useCallback(async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        try {
            const { data: { user }, error: authError } = await supabase.auth.getUser();
            if (!mounted.current) return;
            if (!user) {
                if (authError && authError.name !== "AuthSessionMissingError") throw authError;
                router.replace("/login?next=%2Fdashboard");
                return;
            }
            setAccount((previous) => previous?.id === user.id && previous.email === (user.email || "")
                ? previous : { id: user.id, email: user.email || "" });
            const { error: rolloverError } = await supabase.rpc("roll_usage_period_if_due", { p_user_id: user.id });
            if (rolloverError) throw rolloverError;
            const { data, error: profileError } = await supabase.from("profiles").select("*").eq("id", user.id).single();
            if (profileError || !data) throw profileError || new Error("Profile unavailable");
            if (mounted.current) {
                setProfile(data as Profile);
                setError(null);
            }
        } catch {
            if (mounted.current) setError("Your account details couldn’t be refreshed. Please try again.");
        } finally {
            inFlight.current = false;
            if (mounted.current) setLoading(false);
        }
    }, [router, supabase]);

    useEffect(() => {
        mounted.current = true;
        void refreshProfile();
        const refreshWhenVisible = () => {
            if (document.visibilityState === "visible") void refreshProfile();
        };
        const timer = setInterval(refreshWhenVisible, 60_000);
        window.addEventListener("focus", refreshWhenVisible);
        document.addEventListener("visibilitychange", refreshWhenVisible);
        return () => {
            mounted.current = false;
            clearInterval(timer);
            window.removeEventListener("focus", refreshWhenVisible);
            document.removeEventListener("visibilitychange", refreshWhenVisible);
        };
    }, [refreshProfile]);

    return <DashboardContext.Provider value={{ account, profile, loading, error, refreshProfile }}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
    const context = useContext(DashboardContext);
    if (!context) throw new Error("useDashboard requires DashboardProvider");
    return context;
}
