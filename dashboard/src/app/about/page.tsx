import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { Target, Lightbulb, Rocket } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "About ClipMint — AI Video Clipping Platform",
    description:
        "Learn about ClipMint, the AI-powered platform that turns long videos into viral short-form clips with professional animated captions.",
};

export default function AboutPage() {
    return (
        <main className="overflow-hidden min-h-screen bg-[#030305] text-[#f8fafc]">
            <Navbar />

            <div className="max-w-4xl mx-auto px-6 pt-36 pb-24 md:pt-44 md:pb-36 relative">
                {/* Ambient glow */}
                <div className="absolute w-[250px] h-[250px] rounded-full bg-mint-500/5 blur-[80px] pointer-events-none top-24 left-1/3" />

                {/* Hero */}
                <div className="text-center mb-16">
                    <div className="inline-flex items-center gap-2.5 mb-6">
                        <div className="w-9 h-9 rounded-lg overflow-hidden border border-white/10 shadow-md">
                            <img src="/clipmint-logo.jpg" alt="ClipMint" className="w-full h-full object-cover" />
                        </div>
                        <span className="gradient-text font-black text-3xl tracking-tight bg-text-mint-400">
                            ClipMint
                        </span>
                    </div>
                    <h1 className="text-4xl sm:text-5xl font-extrabold mb-4 leading-tight">
                        Turning Long Videos Into <span className="gradient-text bg-text-mint-400">Viral Moments</span>
                    </h1>
                    <p className="text-base sm:text-lg text-slate-400 max-w-xl mx-auto leading-relaxed">
                        ClipMint was built to solve a simple problem: content creators
                        spend hours editing long-form videos into short clips. We
                        automated the entire workflow with AI.
                    </p>
                </div>

                {/* Story */}
                <div className="glass-card p-8 md:p-10 mb-8">
                    <h2 className="text-xl sm:text-2xl font-bold text-slate-200 mb-4 flex items-center gap-2.5">
                        <Lightbulb size={22} className="text-[#f59e0b]" />
                        <span>Our Story</span>
                    </h2>
                    <p className="text-slate-400 leading-relaxed text-sm sm:text-base">
                        ClipMint started as a personal tool — a weekend project to help
                        podcast creators turn 1-hour episodes into scroll-stopping clips.
                        After seeing the quality of AI transcription and the
                        power of custom animated captions, we knew this could
                        become a product that saves creators thousands of hours every
                        month.
                    </p>
                    <p className="text-slate-400 leading-relaxed text-sm sm:text-base mt-4">
                        Today, ClipMint processes videos end-to-end: downloading,
                        transcribing, detecting viral moments using AI, clipping with
                        precision, and rendering studio-quality animated captions — all
                        automatically.
                    </p>
                </div>

                {/* Values grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-16">
                    {[
                        {
                            icon: <Target size={22} />,
                            title: "Our Mission",
                            desc: "Democratize professional video editing. Every creator should have access to studio-quality clips and captions — regardless of budget or editing skill.",
                        },
                        {
                            icon: <Rocket size={22} />,
                            title: "Our Vision",
                            desc: "Become the go-to AI platform for content repurposing. From a 1-hour podcast to 15 platform-ready clips — in under 20 minutes.",
                        },
                    ].map((item) => (
                        <div
                            key={item.title}
                            className="glass-card p-8 flex flex-col gap-4"
                        >
                            <div className="w-11 h-11 rounded-xl bg-mint-500/10 flex items-center justify-center text-mint-400 border border-mint-500/20">
                                {item.icon}
                            </div>
                            <h3 className="text-lg font-bold text-slate-200">
                                {item.title}
                            </h3>
                            <p className="text-sm text-slate-400 leading-relaxed">
                                {item.desc}
                            </p>
                        </div>
                    ))}
                </div>

                {/* Company info */}
                <div className="text-center text-slate-500 text-sm leading-relaxed border-t border-white/5 pt-8">
                    <p className="font-bold text-slate-300">NovaMint Networks</p>
                    <p className="mt-0.5">Founder of ClipMint - VIKASH MEENA</p>
                    <p className="mt-0.5">Jaipur, Rajasthan, India</p>
                    <p className="mt-2">
                        <a
                            href="mailto:ClipMintApp@gmail.com"
                            className="text-mint-300 hover:text-mint-400 no-underline font-medium transition-colors"
                        >
                            ClipMintApp@gmail.com
                        </a>
                    </p>
                </div>
            </div>

            <Footer />
        </main>
    );
}
