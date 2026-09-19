"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { IconMenu, IconClose, IconMark, IconArrowRight } from "./Icons";

/**
 * Sticky glass-pill nav. Wordmark = IconMark + Syne "ClipMint." with a
 * mint period. Anchors scroll to landing sections; the auth-aware CTA
 * resolves a Supabase session → "Dashboard" or "Start free". Mobile gets
 * a full-screen drawer with the same links.
 */

const NAV_LINKS = [
  { href: "/#showcase", label: "Showcase" },
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<unknown>(null);
  const [authDone, setAuthDone] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!cancelled) setUser(data?.user ?? null);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setAuthDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 px-4 sm:px-6 pt-4">
        <nav
          aria-label="Main"
          className={`nav-shell mx-auto max-w-[1180px] flex items-center justify-between gap-4 rounded-full border px-4 pl-5 sm:px-5 h-14 ${
            scrolled ? "scrolled" : "border-transparent bg-transparent"
          }`}
        >
          {/* Wordmark */}
          <Link
            href="/"
            className="flex items-center gap-2.5 no-underline shrink-0"
            aria-label="ClipMint home"
          >
            <IconMark className="w-[22px] h-[22px] text-mint-400" />
            <span className="font-[family-name:var(--font-display)] font-bold text-[21px] leading-none tracking-[-0.02em] text-ink-50">
              ClipMint<span className="text-mint-400">.</span>
            </span>
          </Link>

          {/* Desktop links */}
          <div className="hidden lg:flex items-center gap-0.5">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="nav-link px-3.5 py-2 rounded-full text-sm font-medium no-underline"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Auth */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            {authDone && user ? (
              <Link href="/dashboard" className="cm-btn-primary py-2 px-5 text-sm">
                Dashboard
                <IconArrowRight className="w-4 h-4" />
              </Link>
            ) : (
              <>
                <Link href="/login" className="cm-btn-ghost py-2 px-5 text-sm hidden md:inline-flex">
                  Login
                </Link>
                <Link href="/login" className="cm-btn-primary py-2 px-5 text-sm">
                  Start free
                </Link>
              </>
            )}
          </div>

          {/* Mobile toggle */}
          <button
            type="button"
            className="flex sm:hidden items-center justify-center w-10 h-10 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-raised)] text-ink-100 cursor-pointer"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
          >
            {mobileOpen ? <IconClose className="w-5 h-5" /> : <IconMenu className="w-5 h-5" />}
          </button>
        </nav>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-[var(--bg-void)]/95 backdrop-blur-xl flex flex-col pt-28 px-7 pb-10 lg:hidden animate-scale-in">
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((link, i) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-3 py-3.5 rounded-xl text-xl font-semibold text-ink-100 hover:bg-white/5 no-underline flex items-center justify-between"
                style={{ animationDelay: `${0.06 * i}s` }}
              >
                {link.label}
                <IconArrowRight className="w-5 h-5 text-mint-400" />
              </Link>
            ))}
          </div>
          <div className="mt-10 flex flex-col gap-3">
            {authDone && user ? (
              <Link href="/dashboard" className="cm-btn-primary w-full py-3.5 text-base">
                Dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="cm-btn-primary w-full py-3.5 text-base">
                  Start free — no card
                </Link>
                <Link href="/login" className="cm-btn-ghost w-full py-3.5 text-base">
                  Login
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}