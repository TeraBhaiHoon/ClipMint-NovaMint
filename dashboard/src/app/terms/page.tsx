"use client";

import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import Link from "next/link";
import { Scale, Calendar, ArrowLeft, Mail } from "lucide-react";

export default function TermsPage() {
    return (
        <main className="overflow-hidden min-h-screen bg-[#030305] text-[#f8fafc]">
            <Navbar />

            {/* Ambient Background Glow */}
            <div className="absolute w-[400px] h-[400px] rounded-full bg-mint-500/5 blur-[120px] pointer-events-none top-20 left-1/4" />
            <div className="absolute w-[300px] h-[300px] rounded-full bg-[#06b6d4]/3 blur-[100px] pointer-events-none top-80 right-1/4" />

            <div className="max-w-4xl mx-auto px-6 pt-36 pb-24 md:pt-44 md:pb-36 relative">
                {/* Back Button */}
                <Link
                    href="/"
                    className="btn-secondary py-2 px-4 text-xs font-semibold inline-flex items-center gap-2 mb-8"
                >
                    <ArrowLeft size={13} />
                    <span>Back to Home</span>
                </Link>

                <div className="text-center mb-12">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-mint-500/10 border border-mint-500/3020 text-xs font-semibold text-[#67e8f9] mb-4">
                        <Scale size={13} />
                        <span>Platform Terms of Service</span>
                    </div>
                    <h1 className="text-4xl sm:text-5xl font-extrabold mb-4 tracking-tight">
                        Terms &amp; <span className="gradient-text bg-text-mint-400">Conditions</span>
                    </h1>
                    <p className="text-slate-400 text-sm flex items-center justify-center gap-2">
                        <Calendar size={13} />
                        <span>Last updated: March 9, 2026</span>
                    </p>
                </div>

                {/* Main Legal Content Container */}
                <div className="glass-card p-8 md:p-12 flex flex-col gap-8 shadow-xl shadow-mint-500/3">
                    <section className="border-b border-white/5 pb-6">
                        <p className="text-slate-300 leading-relaxed">
                            These Terms &amp; Conditions (&quot;Terms&quot;) govern your use of ClipMint,
                            operated by NovaMint Networks (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;). By accessing
                            or using the Service, you agree to be bound by these Terms.
                        </p>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200">
                            1. Account Credentials &amp; Profiles
                        </h2>
                        <ul className="list-none flex flex-col gap-3 pl-2">
                            <li className="text-sm text-slate-400 flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-mint-500 mt-2 flex-shrink-0" />
                                <span>You must provide accurate, current, and complete details when creating an account profile.</span>
                            </li>
                            <li className="text-sm text-slate-400 flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-mint-500 mt-2 flex-shrink-0" />
                                <span>You are solely responsible for securing your login sessions and API credential tokens.</span>
                            </li>
                            <li className="text-sm text-slate-400 flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-mint-500 mt-2 flex-shrink-0" />
                                <span>Platform access is limited to individuals who are at least 13 years of age.</span>
                            </li>
                        </ul>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200">
                            2. Platform Acceptable Use
                        </h2>
                        <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                            To maintain speed and safety for all creators, you agree not to:
                        </p>
                        <ul className="list-none flex flex-col gap-3 pl-2">
                            <li className="text-sm text-slate-400 flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#06b6d4] mt-2 flex-shrink-0" />
                                <span>Upload copyright-protected streams, clips, or materials without explicit owner authorization.</span>
                            </li>
                            <li className="text-sm text-slate-400 flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#06b6d4] mt-2 flex-shrink-0" />
                                <span>Deploy automated scrapers, web-spiders, or batch crawlers that bypass plan API limits.</span>
                            </li>
                            <li className="text-sm text-slate-400 flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#06b6d4] mt-2 flex-shrink-0" />
                                <span>Submit media material that is hateful, abusive, violent, or explicitly malicious.</span>
                            </li>
                        </ul>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200">
                            3. Intellectual Property Rights
                        </h2>
                        <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                            - <strong className="text-slate-300">Your Output Content:</strong> You retain full copyright ownership of all raw videos and final rendered clips. ClipMint claims zero content rights.
                        </p>
                        <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                            - <strong className="text-slate-300">Our Platform Assets:</strong> The ClipMint branding, logo designs, web interface style sheets, AI processing modules, and custom caption style templates remain sole properties of NovaMint Networks.
                        </p>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200">
                            4. Subscriptions, Payments &amp; Credits
                        </h2>
                        <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                            Usage limits on free accounts are updated monthly. Subscriptions automatically renew at current
                            base rates unless cancelled prior to renewal checkout. All charges are securely processed using Cashfree API gateways.
                        </p>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200">
                            5. Disclaimers &amp; Limitations of Liability
                        </h2>
                        <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                            The ClipMint platform and services are provided on an &quot;as-is&quot; and &quot;as-available&quot; operational standard.
                            NovaMint Networks claims zero liability for downstream metrics or social distribution results of compiled video files.
                        </p>
                    </section>

                    <section className="flex flex-col gap-4 border-t border-white/5 pt-8">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200">
                            6. Governing Law &amp; Disputes
                        </h2>
                        <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                            These Terms are strictly governed by current active laws of India. Any litigation actions or legal
                            claims shall fall under exclusive territorial jurisdiction of local courtrooms inside Jaipur, Rajasthan, India.
                        </p>
                    </section>

                    <section className="flex items-center gap-3 p-4 rounded-xl bg-white/1.5 border border-white/5 text-sm text-slate-300 max-w-md">
                        <Mail size={16} className="text-mint-400 flex-shrink-0" />
                        <span>Questions? Contact us at: </span>
                        <a href="mailto:ClipMint.Support@gmail.com" className="hover:text-white transition-colors font-bold text-mint-300">
                            ClipMint.Support@gmail.com
                        </a>
                    </section>
                </div>
            </div>
            <Footer />
        </main>
    );
}
