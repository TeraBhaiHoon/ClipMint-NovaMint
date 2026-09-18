"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Sparkles } from "lucide-react";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";

const NAV_LINKS = [
    { href: "/features", label: "Features" },
    { href: "/pricing", label: "Pricing" },
    { href: "/about", label: "About" },
    { href: "/contact", label: "Contact" },
];

export default function Navbar() {
    const pathname = usePathname();
    const [scrolled, setScrolled] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [user, setUser] = useState<any>(null);
    const [authLoading, setAuthLoading] = useState(true);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 40);
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    useEffect(() => {
        setMobileOpen(false);
    }, [pathname]);

    useEffect(() => {
        async function checkUser() {
            const supabase = createClient();
            try {
                const { data } = await supabase.auth.getUser();
                setUser(data?.user || null);
            } catch (err) {
                console.error(err);
            } finally {
                setAuthLoading(false);
            }
        }
        checkUser();
    }, []);

    return (
        <>
            <nav
                className={`fixed top-0 left-0 right-0 z-50 px-6 py-4 md:px-12 flex justify-between items-center transition-all duration-300 ${
                    scrolled
                        ? "bg-[#08080c]/85 border-b border-white/5 backdrop-blur-md shadow-lg"
                        : "bg-transparent border-b border-transparent"
                }`}
            >
                {/* Logo */}
                <Link
                    href="/"
                    className="flex items-center gap-2.5 no-underline group"
                >
                    <div className="relative overflow-hidden rounded-lg w-9 h-9 border border-white/10 transition-transform duration-300 group-hover:scale-105 shadow-md shadow-mint-500/10">
                        <img
                            src="/clipmint-logo.jpg"
                            alt="ClipMint"
                            className="w-full h-full object-cover"
                        />
                    </div>
                    <span className="gradient-text font-extrabold text-2xl tracking-tight bg-text-mint-400">
                        ClipMint
                    </span>
                </Link>

                {/* Desktop links */}
                <div className="hidden md:flex items-center gap-2">
                    {NAV_LINKS.map((link) => {
                        const isActive = pathname === link.href;
                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                                    isActive
                                        ? "text-mint-300 bg-mint-500/10"
                                        : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                                }`}
                            >
                                {link.label}
                            </Link>
                        );
                    })}
                </div>

                {/* Auth buttons */}
                <div className="hidden md:flex gap-3 items-center">
                    {!authLoading && user ? (
                        <Link
                            href="/dashboard"
                            className="btn-primary py-2 px-5 text-sm"
                        >
                            Dashboard
                        </Link>
                    ) : (
                        <>
                            <Link
                                href="/login"
                                className="btn-secondary py-2 px-5 text-sm"
                            >
                                Login
                            </Link>
                            <Link
                                href="/login"
                                className="btn-primary py-2 px-5 text-sm"
                            >
                                <Sparkles size={14} className="text-white/80" />
                                Start Free Trial
                            </Link>
                        </>
                    )}
                </div>

                {/* Mobile hamburger */}
                <button
                    className="flex md:hidden bg-transparent border-none text-slate-200 cursor-pointer p-2 rounded-lg hover:bg-white/5 transition-colors"
                    onClick={() => setMobileOpen(!mobileOpen)}
                    aria-label="Toggle menu"
                >
                    {mobileOpen ? <X size={22} /> : <Menu size={22} />}
                </button>
            </nav>

            {/* Mobile drawer */}
            {mobileOpen && (
                <div className="fixed inset-0 z-40 bg-[#030305]/98 backdrop-blur-xl flex flex-col pt-24 px-6 pb-8 gap-2 md:hidden animate-scale-in">
                    {NAV_LINKS.map((link) => {
                        const isActive = pathname === link.href;
                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                className={`px-5 py-4 rounded-xl text-lg font-semibold transition-all ${
                                    isActive
                                        ? "text-mint-300 bg-mint-500/10"
                                        : "text-slate-200 hover:bg-white/5"
                                }`}
                            >
                                {link.label}
                            </Link>
                        );
                    })}
                    <div className="mt-8 flex flex-col gap-3">
                        {!authLoading && user ? (
                            <Link
                                href="/dashboard"
                                className="btn-primary w-full py-3.5 text-base"
                            >
                                Dashboard
                            </Link>
                        ) : (
                            <>
                                <Link
                                    href="/login"
                                    className="btn-secondary w-full py-3.5 text-base"
                                >
                                    Login
                                </Link>
                                <Link
                                    href="/login"
                                    className="btn-primary w-full py-3.5 text-base"
                                >
                                    <Sparkles size={15} />
                                    Start Free Trial
                                </Link>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
