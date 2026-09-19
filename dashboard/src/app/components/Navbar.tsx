"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";

/**
 * Identity §9.1 — sticky nav on ink-950/80 + backdrop-blur, Bricolage
 * wordmark with a mint-400 period, links anchor to landing sections.
 * Auth logic unchanged (Supabase session → Dashboard / Login+Start).
 */
const NAV_LINKS = [
    { href: "/#features", label: "Features" },
    { href: "/#pricing", label: "Pricing" },
    { href: "/#faq", label: "FAQ" },
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
                className={`fixed top-0 left-0 right-0 z-50 px-6 py-3.5 md:px-10 flex justify-between items-center transition-colors duration-300 border-b ${
                    scrolled
                        ? "bg-ink-950/80 backdrop-blur-md border-white/5"
                        : "bg-transparent border-transparent"
                }`}
            >
                {/* Wordmark — monochrome text + mint period (§9.1) */}
                <Link href="/" className="flex items-center no-underline">
                    <span className="font-[family-name:var(--font-display)] font-bold text-[22px] leading-none tracking-[-0.02em] text-ink-50">
                        ClipMint<span className="text-mint-400">.</span>
                    </span>
                </Link>

                {/* Desktop links */}
                <div className="hidden md:flex items-center gap-1">
                    {NAV_LINKS.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className="px-3.5 py-2 rounded-lg text-sm font-medium text-ink-300 hover:text-ink-50 hover:bg-white/5 transition-colors duration-200 no-underline"
                        >
                            {link.label}
                        </Link>
                    ))}
                </div>

                {/* Auth buttons */}
                <div className="hidden md:flex gap-2.5 items-center">
                    {!authLoading && user ? (
                        <Link href="/dashboard" className="cm-btn-primary py-2 px-4 text-sm">
                            Dashboard
                        </Link>
                    ) : (
                        <>
                            <Link href="/login" className="cm-btn-ghost py-2 px-4 text-sm">
                                Login
                            </Link>
                            <Link href="/login" className="cm-btn-primary py-2 px-4 text-sm">
                                Start free
                            </Link>
                        </>
                    )}
                </div>

                {/* Mobile hamburger */}
                <button
                    className="flex md:hidden bg-transparent border-none text-ink-50 cursor-pointer p-2 rounded-lg hover:bg-white/5 transition-colors"
                    onClick={() => setMobileOpen(!mobileOpen)}
                    aria-label="Toggle menu"
                >
                    {mobileOpen ? <X size={22} /> : <Menu size={22} />}
                </button>
            </nav>

            {/* Mobile drawer */}
            {mobileOpen && (
                <div className="fixed inset-0 z-40 bg-ink-950/95 backdrop-blur-xl flex flex-col pt-24 px-6 pb-8 gap-2 md:hidden animate-scale-in">
                    {NAV_LINKS.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className="px-5 py-4 rounded-xl text-lg font-semibold text-ink-50 hover:bg-white/5 transition-colors no-underline"
                        >
                            {link.label}
                        </Link>
                    ))}
                    <div className="mt-8 flex flex-col gap-3">
                        {!authLoading && user ? (
                            <Link href="/dashboard" className="cm-btn-primary w-full py-3.5 text-base">
                                Dashboard
                            </Link>
                        ) : (
                            <>
                                <Link href="/login" className="cm-btn-ghost w-full py-3.5 text-base">
                                    Login
                                </Link>
                                <Link href="/login" className="cm-btn-primary w-full py-3.5 text-base">
                                    Start free — no card
                                </Link>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
