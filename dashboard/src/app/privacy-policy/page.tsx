"use client";

import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import Link from "next/link";
import { ShieldCheck, Calendar, ArrowLeft, Mail, MapPin, Building } from "lucide-react";

export default function PrivacyPolicyPage() {
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
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-mint-500/10 border border-mint-500/20 text-xs font-semibold text-mint-300 mb-4">
                        <ShieldCheck size={13} />
                        <span>GDPR-Compliant Security</span>
                    </div>
                    <h1 className="text-4xl sm:text-5xl font-extrabold mb-4 tracking-tight">
                        Privacy <span className="gradient-text bg-text-mint-400">Policy</span>
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
                            NovaMint Networks (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) operates ClipMint
                            (the &quot;Service&quot;). This Privacy Policy explains how we collect,
                            use, disclose, and safeguard your information when you use our
                            Service. By accessing our platform, you consent to the data collection
                            and utilization protocols outlined herein.
                        </p>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200">
                            1. Information We Collect
                        </h2>
                        <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                            We collect information you provide directly to us:
                        </p>
                        <ul className="list-none flex flex-col gap-3.5 pl-2 mt-2">
                            <li className="text-sm text-slate-400 flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-mint-500 mt-2 flex-shrink-0" />
                                <div>
                                    <strong className="text-slate-300">Account Information:</strong> Name, email address, and
                                    profile picture when you create an account via email signup or
                                    Google OAuth.
                                </div>
                            </li>
                            <li className="text-sm text-slate-400 flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-mint-500 mt-2 flex-shrink-0" />
                                <div>
                                    <strong className="text-slate-300">Video Content:</strong> Video URLs or uploaded video files
                                    that you submit for processing. These are processed temporarily
                                    and deleted immediately after clip generation.
                                </div>
                            </li>
                            <li className="text-sm text-slate-400 flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-mint-500 mt-2 flex-shrink-0" />
                                <div>
                                    <strong className="text-slate-300">Usage Data:</strong> Information about how you use the
                                    Service, including clips generated, styles used, and
                                    processing timelines.
                                </div>
                            </li>
                            <li className="text-sm text-slate-400 flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-mint-500 mt-2 flex-shrink-0" />
                                <div>
                                    <strong className="text-slate-300">Payment Information:</strong> When you subscribe to a paid
                                    plan, payment details are processed securely by Cashfree. We do
                                    not store your credit card or credentials on our servers.
                                </div>
                            </li>
                        </ul>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200">
                            2. How We Use Your Information
                        </h2>
                        <ul className="list-none flex flex-col gap-3 pl-2">
                            <li className="text-sm text-slate-400 flex items-center gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#06b6d4] flex-shrink-0" />
                                <span>To provide, maintain, and improve the ClipMint service</span>
                            </li>
                            <li className="text-sm text-slate-400 flex items-center gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#06b6d4] flex-shrink-0" />
                                <span>To process videos, extract viral moments, and add premium captions</span>
                            </li>
                            <li className="text-sm text-slate-400 flex items-center gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#06b6d4] flex-shrink-0" />
                                <span>To communicate transaction details, invoices, and service updates</span>
                            </li>
                            <li className="text-sm text-slate-400 flex items-center gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#06b6d4] flex-shrink-0" />
                                <span>To send auto-notifications (email/Discord) about active job runs</span>
                            </li>
                            <li className="text-sm text-slate-400 flex items-center gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#06b6d4] flex-shrink-0" />
                                <span>To prevent fraudulent activities and ensure platform security</span>
                            </li>
                        </ul>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200">
                            3. Cookies Policy
                        </h2>
                        <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                            We use essential security cookies to maintain active authentication sessions
                            and language/theme preferences. We do not use third-party advertising, commercial tracking,
                            or marketing cookies.
                        </p>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200">
                            4. Data Retention Timelines
                        </h2>
                        <ul className="list-none flex flex-col gap-3.5 pl-2">
                            <li className="text-sm text-slate-400 flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#ec4899] mt-2 flex-shrink-0" />
                                <div>
                                    <strong className="text-slate-300">Account profiles:</strong> Retained securely as long as your account remains active.
                                </div>
                            </li>
                            <li className="text-sm text-slate-400 flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#ec4899] mt-2 flex-shrink-0" />
                                <div>
                                    <strong className="text-slate-300">Uploaded videos:</strong> Automatically permanently deleted from storage buffers immediately after clipping is complete.
                                </div>
                            </li>
                            <li className="text-sm text-slate-400 flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#ec4899] mt-2 flex-shrink-0" />
                                <div>
                                    <strong className="text-slate-300">Generated clips:</strong> Saved in secure cloud buckets and accessible via your dashboard until manually deleted.
                                </div>
                            </li>
                        </ul>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200">
                            5. Your Personal Rights
                        </h2>
                        <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                            Under modern data protection regulations, you hold rights to access, rectify,
                            export, or completely wipe out your records. You may delete your account directly inside Settings
                            or make specialized requests by messaging our support channel.
                        </p>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200">
                            6. Data Security Practices
                        </h2>
                        <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                            We employ strict security policies including full TLS/SSL encryption for data transmission,
                            isolated server sandboxes for processing, and strict permission levels to prevent unauthorized leaks.
                        </p>
                    </section>

                    {/* Contact details section inside legal */}
                    <section className="border-t border-white/5 pt-8 flex flex-col gap-6">
                        <h3 className="text-lg font-semibold text-slate-200">
                            Contact Support Team
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="flex items-center gap-3 p-4 rounded-xl bg-white/1.5 border border-white/5 text-xs text-slate-300">
                                <Mail size={16} className="text-mint-400 flex-shrink-0" />
                                <a href="mailto:ClipMint.Support@gmail.com" className="hover:text-white transition-colors break-all">
                                    ClipMint.Support@gmail.com
                                </a>
                            </div>
                            <div className="flex items-center gap-3 p-4 rounded-xl bg-white/1.5 border border-white/5 text-xs text-slate-300">
                                <Building size={16} className="text-mint-400 flex-shrink-0" />
                                <span>NovaMint Networks</span>
                            </div>
                            <div className="flex items-center gap-3 p-4 rounded-xl bg-white/1.5 border border-white/5 text-xs text-slate-300">
                                <MapPin size={16} className="text-[#ec4899] flex-shrink-0" />
                                <span>Jaipur, Rajasthan, India</span>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
            <Footer />
        </main>
    );
}
