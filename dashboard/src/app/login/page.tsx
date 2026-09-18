"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { Mail, Lock, ArrowRight, Loader2, ArrowLeft, Sparkles } from "lucide-react";
import Link from "next/link";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isSignUp, setIsSignUp] = useState(false);
    const [isForgotPassword, setIsForgotPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const router = useRouter();
    const supabase = createClient();

    async function handleEmailAuth(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setMessage(null);

        if (isForgotPassword) {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/auth/callback`,
            });
            if (error) {
                setError(error.message);
            } else {
                setMessage("Password reset link sent! Check your email.");
            }
            setLoading(false);
            return;
        }

        if (isSignUp) {
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: `${window.location.origin}/auth/callback`,
                },
            });
            if (error) {
                setError(error.message);
            } else if (data.session) {
                router.push("/dashboard");
                router.refresh();
            } else {
                setMessage("Check your email for a confirmation link!");
            }
        } else {
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });
            if (error) {
                setError(error.message);
            } else {
                router.push("/dashboard");
                router.refresh();
            }
        }
        setLoading(false);
    }

    async function handleGoogleAuth() {
        setLoading(true);
        const { error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });
        if (error) {
            setError(error.message);
            setLoading(false);
        }
    }

    const switchToForgotPassword = () => {
        setIsForgotPassword(true);
        setIsSignUp(false);
        setError(null);
        setMessage(null);
    };

    const switchToLogin = () => {
        setIsForgotPassword(false);
        setError(null);
        setMessage(null);
    };

    return (
        <div className="min-h-screen bg-[#030305] text-[#f8fafc] flex flex-col justify-center items-center p-6 relative">
            {/* Ambient Background Glow */}
            <div className="absolute w-[350px] h-[350px] rounded-full bg-mint-500/10 blur-[100px] pointer-events-none -top-12" />
            <div className="absolute w-[350px] h-[350px] rounded-full bg-[#06b6d4]/5 blur-[120px] pointer-events-none -bottom-12" />

            <Link href="/" className="absolute top-8 left-8 flex items-center gap-2 text-sm text-slate-400 no-underline hover:text-slate-200 transition-colors">
                <ArrowLeft size={16} />
                <span>Back to Home</span>
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
                    {isForgotPassword
                        ? "Enter your email to reset your password"
                        : isSignUp
                            ? "Create your account to start clipping"
                            : "Sign in to your account"}
                </p>

                {/* Google OAuth — hide on forgot password */}
                {!isForgotPassword && (
                    <>
                        <button
                            onClick={handleGoogleAuth}
                            disabled={loading}
                            className="btn-secondary w-full py-3 text-sm font-semibold flex items-center justify-center gap-3.5 mb-6 hover:bg-white/5 transition-all"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" className="flex-shrink-0">
                                <path
                                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                                    fill="#4285F4"
                                />
                                <path
                                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                    fill="#34A853"
                                />
                                <path
                                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                    fill="#FBBC05"
                                />
                                <path
                                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                    fill="#EA4335"
                                />
                            </svg>
                            <span>Continue with Google</span>
                        </button>

                        {/* Divider */}
                        <div className="flex items-center gap-4 mb-6">
                            <div className="flex-1 h-px bg-white/5" />
                            <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">or</span>
                            <div className="flex-1 h-px bg-white/5" />
                        </div>
                    </>
                )}

                {/* Email/Password Form */}
                <form onSubmit={handleEmailAuth} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-400">
                            Email
                        </label>
                        <div className="relative">
                            <Mail
                                size={15}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
                            />
                            <input
                                className="input-field pl-11!"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@example.com"
                                required
                            />
                        </div>
                    </div>

                    {/* Password field — hide on forgot password */}
                    {!isForgotPassword && (
                        <div className="flex flex-col gap-1.5">
                            <div className="flex justify-between items-center">
                                <label className="text-xs font-semibold text-slate-400">
                                    Password
                                </label>
                                {!isSignUp && (
                                    <button
                                        type="button"
                                        onClick={switchToForgotPassword}
                                        className="bg-transparent border-none text-mint-300 hover:text-mint-400 cursor-pointer text-xs font-semibold transition-colors"
                                    >
                                        Forgot?
                                    </button>
                                )}
                            </div>
                            <div className="relative">
                                <Lock
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
                                />
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium leading-relaxed mt-2 animate-scale-in">
                            {error}
                        </div>
                    )}

                    {message && (
                        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium leading-relaxed mt-2 animate-scale-in">
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
                        ) : isForgotPassword ? (
                            <>
                                <span>Send Reset Link</span>
                                <ArrowRight size={14} />
                            </>
                        ) : (
                            <>
                                {isSignUp ? (
                                    <>
                                        <Sparkles size={14} />
                                        <span>Create Account</span>
                                    </>
                                ) : (
                                    <>
                                        <span>Sign In</span>
                                        <ArrowRight size={14} />
                                    </>
                                )}
                            </>
                        )}
                    </button>
                </form>

                {/* Toggle sign up / sign in / forgot password */}
                <p className="text-center mt-6 text-sm text-slate-500 font-medium">
                    {isForgotPassword ? (
                        <button
                            onClick={switchToLogin}
                            className="bg-transparent border-none text-mint-300 hover:text-mint-400 cursor-pointer font-semibold text-sm inline-flex items-center gap-1.5 transition-colors"
                        >
                            <ArrowLeft size={13} /> Back to Sign In
                        </button>
                    ) : (
                        <>
                            {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
                            <button
                                onClick={() => {
                                    setIsSignUp(!isSignUp);
                                    setError(null);
                                    setMessage(null);
                                }}
                                className="bg-transparent border-none text-mint-300 hover:text-mint-400 cursor-pointer font-bold text-sm transition-colors ml-1"
                            >
                                {isSignUp ? "Sign In" : "Sign Up"}
                            </button>
                        </>
                    )}
                </p>
            </div>
        </div>
    );
}
