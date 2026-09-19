"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { Lock, ArrowRight, Loader2, ArrowLeft, KeyRound, Check } from "lucide-react";
import Link from "next/link";

/** Friendly copy for the handful of failures this page can hit. */
function friendlyPasswordError(message: string | undefined): string {
    if (!message) return "Could not update your password. Please try again.";
    if (message.toLowerCase().includes("password should be at least")) {
        return "Password must be at least 6 characters long.";
    }
    if (message.toLowerCase().includes("session")) {
        return "Your reset link has expired. Please request a new one.";
    }
    if (message.toLowerCase().includes("rate limit") || message.toLowerCase().includes("too many")) {
        return "Too many attempts. Please wait a few minutes and try again.";
    }
    return message;
}

export default function UpdatePasswordPage() {
    const router = useRouter();
    const supabase = createClient();
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        let disposed = false;
        supabase.auth
            .getUser()
            .then(({ data }) => {
                if (disposed) return;
                // No session = no recovery grant → back to login.
                if (!data.user) {
                    router.replace("/login");
                    return;
                }
                setChecking(false);
            })
            .catch(() => {
                if (!disposed) router.replace("/login");
            });
        return () => {
            disposed = true;
        };
    }, [router]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (password !== confirm) {
            setError("Passwords do not match.");
            return;
        }
        if (password.length < 6) {
            setError("Password must be at least 6 characters long.");
            return;
        }

        setLoading(true);
        setError(null);
        setMessage(null);

        const { error } = await supabase.auth.updateUser({ password });
        setLoading(false);

        if (error) {
            setError(friendlyPasswordError(error.message));
            return;
        }

        setMessage("Password updated successfully. Taking you to sign in…");
        setTimeout(() => {
            router.push("/login");
            router.refresh();
        }, 1200);
    }

    if (checking) {
        return (
            <div className="min-h-screen bg-[#030305] text-[#f8fafc] flex flex-col justify-center items-center p-6 relative">
                <Loader2 size={20} className="animate-spin text-mint-400" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#030305] text-[#f8fafc] flex flex-col justify-center items-center p-6 relative">
            {/* Ambient Background Glow */}
            <div className="absolute w-[350px] h-[350px] rounded-full bg-mint-500/10 blur-[100px] pointer-events-none -top-12" />
            <div className="absolute w-[350px] h-[350px] rounded-full bg-[#06b6d4]/5 blur-[120px] pointer-events-none -bottom-12" />

            <Link href="/login" className="absolute top-8 left-8 flex items-center gap-2 text-sm text-slate-400 no-underline hover:text-slate-200 transition-colors">
                <ArrowLeft size={16} />
                <span>Back to Sign In</span>
            </Link>

            <div className="glass-card w-full max-w-md p-8 md:p-10 shadow-2xl relative z-10">
                {/* Logo */}
                <div className="flex items-center justify-center gap-2.5 mb-2">
                    <div className="w-8 h-8 rounded-lg overflow-hidden border border-white/10 shadow-md">
                        <img src="/clipmint-logo.jpg" alt="ClipMint" className="w-full h-full object-cover" />
                    </div>
                    <span className="gradient-text font-black text-2xl tracking-tight bg-text-mint-400">
                        ClipMint
                    </span>
                </div>

                <p className="text-center text-slate-400 text-xs sm:text-sm mb-8 font-medium">
                    Set a new password for your account
                </p>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-400">
                            New Password
                        </label>
                        <div className="relative">
                            <KeyRound
                                size={15}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
                            />
                            <input
                                className="input-field pl-11!"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                                minLength={6}
                                autoComplete="new-password"
                            />
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-400">
                            Confirm New Password
                        </label>
                        <div className="relative">
                            <Lock
                                size={15}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
                            />
                            <input
                                className="input-field pl-11!"
                                type="password"
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                                placeholder="••••••••"
                                required
                                minLength={6}
                                autoComplete="new-password"
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium leading-relaxed mt-2 animate-scale-in">
                            {error}
                        </div>
                    )}

                    {message && (
                        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium leading-relaxed mt-2 animate-scale-in">
                            <Check size={13} className="inline mr-1 -mt-0.5" />
                            {message}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="btn-primary w-full py-3.5 mt-2 flex items-center justify-center gap-2 text-sm font-semibold shadow-lg shadow-mint-500/20 transition-all duration-300"
                    >
                        {loading ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : (
                            <>
                                <span>Update Password</span>
                                <ArrowRight size={14} />
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}
