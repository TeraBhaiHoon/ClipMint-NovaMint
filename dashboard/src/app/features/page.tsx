import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import Link from "next/link";
import {
    Bot,
    Sparkles,
    Layers,
    MonitorSmartphone,
    Code2,
    BarChart3,
    Clock,
    Shield,
    Wand2,
    ArrowRight,
} from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Features — ClipMint AI Video Clipping Platform",
    description:
        "Discover ClipMint's powerful features: AI viral moment detection, 9 animated caption styles, batch processing, multi-platform output, API access, and real-time analytics.",
};

const FEATURES = [
    {
        icon: <Bot size={22} />,
        title: "AI Viral Moment Detection",
        desc: "Our AI engine uses audio energy analysis, transcript context, silence detection, and engagement scoring to find the most shareable moments in your videos. No manual trimming needed.",
        detail: "Powered by OpenAI transcription + GPT-4 viral scoring",
    },
    {
        icon: <Sparkles size={22} />,
        title: "9 Animated Caption Styles",
        desc: "Choose from 9 studio-quality animated caption styles rendered — from Hormozi-style word highlighting to Neon glow effects. These are real animations, not flat text.",
        detail: "Hormozi · Bounce · Fade · Glow · Typewriter · Glitch · Neon · Colorful · Minimal",
    },
    {
        icon: <Layers size={22} />,
        title: "Batch Processing",
        desc: "Queue up multiple videos at once. ClipMint processes them sequentially so you can focus on creating while AI handles the editing. Perfect for agencies and prolific creators.",
        detail: "Unlimited batch queue on Agency plan",
    },
    {
        icon: <MonitorSmartphone size={22} />,
        title: "Multi-Platform Output",
        desc: "Every clip is automatically formatted for YouTube Shorts (9:16), Instagram Reels, TikTok, and LinkedIn. Complete with titles, descriptions, hashtags, and thumbnails.",
        detail: "Auto-generated metadata for each platform",
    },
    {
        icon: <Code2 size={22} />,
        title: "Full API Access",
        desc: "Integrate ClipMint into your own tools, CMS, or team workflows via a RESTful API. Submit videos, check processing status, and retrieve clips programmatically.",
        detail: "Available on Pro and Agency plans",
    },
    {
        icon: <BarChart3 size={22} />,
        title: "Analytics Dashboard",
        desc: "Track clips generated, viral scores, processing activity, and usage trends — all in a real-time dashboard. Understand which content performs best.",
        detail: "Activity heatmaps, trend charts, and leaderboards",
    },
    {
        icon: <Clock size={22} />,
        title: "Fast Processing",
        desc: "Most videos are processed in under 20 minutes — from upload to download-ready clips with animated captions. Priority processing available on paid plans.",
        detail: "Average: 10 clips in ~15 minutes",
    },
    {
        icon: <Shield size={22} />,
        title: "Secure & Private",
        desc: "Your videos are processed and then deleted. Clips are stored in your linked Google Drive. We never share your content or data with third parties.",
        detail: "GDPR-compliant data handling",
    },
    {
        icon: <Wand2 size={22} />,
        title: "Smart Audio Analysis",
        desc: "ClipMint analyzes audio energy levels, detects laughter and emphasis, and snaps clip boundaries to natural pauses — so your clips start and end cleanly.",
        detail: "Silence detection + energy peak scoring",
    },
];

export default function FeaturesPage() {
    return (
        <main className="min-h-screen bg-ink-950 text-ink-50">
            <Navbar />

            <div className="max-w-6xl mx-auto px-6 pt-36 pb-24 md:pt-44 md:pb-32">
                {/* Header */}
                <div className="text-center mb-20">
                    <p className="cm-eyebrow text-mint-300 mb-4">Features</p>
                    <h1 className="text-[clamp(32px,4.5vw,52px)] font-bold leading-[1.08] tracking-[-0.02em] mb-4">
                        Everything the pipeline{" "}
                        <span className="text-mint-400">does.</span>
                    </h1>
                    <p className="text-base sm:text-[17px] text-ink-300 leading-[1.6] max-w-xl mx-auto">
                        One long video in, caption-ready clips out — here is
                        exactly what happens in between.
                    </p>
                </div>

                {/* Comparison stats — real figures, no traction claims */}
                <div className="cm-card p-8 sm:p-10 mb-14">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
                        {[
                            { label: "Manual editing", value: "4-6 hrs", muted: true },
                            { label: "With ClipMint", value: "< 20 min", muted: false },
                            { label: "Per batch of 10 clips", value: "~15 min", muted: false },
                        ].map((s) => (
                            <div key={s.label}>
                                <div
                                    className={`font-[family-name:var(--font-display)] font-bold text-3xl tracking-[-0.02em] ${
                                        s.muted
                                            ? "text-ink-500 line-through"
                                            : "text-mint-400"
                                    }`}
                                >
                                    {s.value}
                                </div>
                                <div className="cm-eyebrow text-ink-400 mt-2">
                                    {s.label}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Feature cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-24">
                    {FEATURES.map((feat) => (
                        <div key={feat.title} className="cm-card p-7 flex flex-col gap-4">
                            <div className="w-11 h-11 rounded-xl bg-mint-500/10 border border-mint-500/20 flex items-center justify-center text-mint-400">
                                {feat.icon}
                            </div>
                            <div>
                                <h3 className="text-xl font-semibold tracking-[-0.01em] text-ink-50 mb-2">
                                    {feat.title}
                                </h3>
                                <p className="text-[15px] leading-[1.6] text-ink-300 mb-4">
                                    {feat.desc}
                                </p>
                                <span className="inline-block text-xs font-semibold text-mint-300 bg-mint-500/10 border border-mint-500/20 rounded-lg px-2.5 py-1.5">
                                    {feat.detail}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* CTA — same treatment as the landing final panel */}
                <div className="rounded-3xl bg-ink-850 border border-mint-500/30 shadow-[var(--shadow-accent)] p-10 md:p-14 text-center">
                    <h2 className="text-[clamp(26px,3.5vw,38px)] font-bold tracking-[-0.02em] leading-[1.08] mb-3">
                        Ready to try it?
                    </h2>
                    <p className="text-ink-300 text-base leading-[1.6] mb-8">
                        Start with the free plan — 5 clips a month, no credit card.
                    </p>
                    <Link href="/login" className="cm-btn-primary py-4 px-9 text-base">
                        Get started free <ArrowRight size={17} />
                    </Link>
                </div>
            </div>

            <Footer />
        </main>
    );
}
