"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { createClient } from "@/lib/supabase";

const LINKS = [
    { href: "#showcase", label: "The output" },
    { href: "#features", label: "Features" },
    { href: "#how-it-works", label: "How it works" },
    { href: "#pricing", label: "Pricing" },
];

export default function HomeNavigation() {
    const [signedIn, setSignedIn] = useState(false);
    const [open, setOpen] = useState(false);
    const dialog = useRef<HTMLDialogElement>(null);
    const toggle = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        let disposed = false;
        const supabase = createClient();
        supabase.auth.getUser().then(({ data }) => { if (!disposed) setSignedIn(!!data.user); }).catch(() => {});
        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { if (!disposed) setSignedIn(!!session); });
        return () => { disposed = true; listener.subscription.unsubscribe(); };
    }, []);

    useEffect(() => {
        const element = dialog.current;
        if (!element || !open) return;
        element.showModal();
        const trigger = toggle.current;
        const overflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            element.close();
            document.body.style.overflow = overflow;
            trigger?.focus();
        };
    }, [open]);

    return <>
        <header className="home-nav">
            <nav className="home-container home-nav-inner" aria-label="Main navigation">
                <Link href="/" className="home-wordmark" aria-label="ClipMint home"><Image src="/logo-cm-128.png" alt="" width={34} height={34} priority /><span>ClipMint<span className="home-brand-dot">.</span></span></Link>
                <div className="home-nav-links">{LINKS.map((link) => <a href={link.href} key={link.href}>{link.label}</a>)}</div>
                <div className="home-nav-actions">{!signedIn && <Link href="/login" className="home-login">Log in</Link>}<Link href={signedIn ? "/dashboard" : "/login"} className="home-button home-button--primary">{signedIn ? "Your workspace" : "Start free"}<ArrowRight size={16} aria-hidden="true" /></Link><button type="button" className="home-menu-toggle" aria-label="Open navigation menu" aria-expanded={open} aria-controls="home-mobile-menu" ref={toggle} onClick={() => setOpen(true)}><Menu size={21} aria-hidden="true" /></button></div>
            </nav>
        </header>
        <dialog ref={dialog} className="home-mobile-menu" id="home-mobile-menu" aria-labelledby="home-menu-title" onCancel={(event) => { event.preventDefault(); setOpen(false); }}>
            <div className="home-mobile-menu-heading"><strong id="home-menu-title">Explore ClipMint</strong><button type="button" className="home-menu-toggle" aria-label="Close navigation menu" onClick={() => setOpen(false)}><X size={22} aria-hidden="true" /></button></div>
            <nav aria-label="Mobile navigation">{LINKS.map((link) => <a href={link.href} key={link.href} onClick={() => setOpen(false)}>{link.label}<ArrowRight size={20} aria-hidden="true" /></a>)}</nav>
            <Link href={signedIn ? "/dashboard" : "/login"} className="home-button home-button--primary" onClick={() => setOpen(false)}>{signedIn ? "Open your workspace" : "Start free — no card required"}<ArrowRight size={17} aria-hidden="true" /></Link>
        </dialog>
    </>;
}
