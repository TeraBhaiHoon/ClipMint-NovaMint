"use client";

import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import Link from "next/link";
import { HelpCircle, Calendar, ArrowLeft, Mail, AlertTriangle, BadgePercent } from "lucide-react";

export default function RefundPolicyPage() {
    return (
        <main className="overflow-hidden min-h-screen bg-[#030305] text-[#f8fafc]">
            <Navbar />

            {/* Ambient Background Glow */}
            <div className="absolute w-[400px] h-[400px] rounded-full bg-mint-500/5 blur-[120px] pointer-events-none top-20 left-1/4" />
            <div className="absolute w-[300px] h-[300px] rounded-full bg-[#ec4899]/3 blur-[100px] pointer-events-none top-80 right-1/4" />

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
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#ec4899]/10 border border-[#ec4899]/20 text-xs font-semibold text-[#f472b6] mb-4">
                        <BadgePercent size={13} />
                        <span>7-Day Full Protection Window</span>
                    </div>
                    <h1 className="text-4xl sm:text-5xl font-extrabold mb-4 tracking-tight">
                        Refund <span className="gradient-text bg-text-mint-400">Policy</span>
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
                            At NovaMint Networks, customer satisfaction is our top priority. We want you to be
                            completely confident using ClipMint. This Refund Policy outlines the terms under which
                            refunds may be requested and issued for our subscription or one-time plans.
                        </p>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200">
                            1. Refund Eligibility Window
                        </h2>
                        <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                            We offer a <strong className="text-slate-200">7-day refund window</strong> from the date of
                            your initial purchase. To qualify for a complete refund:
                        </p>
                        <ul className="list-none flex flex-col gap-3.5 pl-2 mt-2">
                            <li className="text-sm text-slate-400 flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-mint-500 mt-2 flex-shrink-0" />
                                <span>The refund request must be made within 7 calendar days of your initial payment.</span>
                            </li>
                            <li className="text-sm text-slate-400 flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-mint-500 mt-2 flex-shrink-0" />
                                <span>The request should state clearly why the AI clipping or captions did not meet your creative expectations.</span>
                            </li>
                            <li className="text-sm text-slate-400 flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-mint-500 mt-2 flex-shrink-0" />
                                <span>The account should have genuine usage (at least one video processed) rather than single sign-up with immediate cancellation.</span>
                            </li>
                        </ul>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200">
                            2. Requesting a Refund
                        </h2>
                        <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                            To initiate a refund request, simply email our billing support team:
                        </p>
                        <div className="flex items-center gap-3 p-4 rounded-xl bg-white/1.5 border border-white/5 text-sm text-slate-300 max-w-md">
                            <Mail size={16} className="text-mint-400 flex-shrink-0" />
                            <a href="mailto:ClipMint.Billing@gmail.com" className="hover:text-white transition-colors font-bold text-mint-300">
                                ClipMint.Billing@gmail.com
                            </a>
                        </div>
                        <p className="text-slate-400 text-xs mt-1">
                            Please specify your registered account email, date of purchase, subscription plan type, and order ID if available.
                        </p>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200">
                            3. Processing Timelines
                        </h2>
                        <ul className="list-none flex flex-col gap-3 pl-2">
                            <li className="text-sm text-slate-400 flex items-center gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#06b6d4] flex-shrink-0" />
                                <span>Acknowledgement & status verification of your ticket within 24 hours.</span>
                            </li>
                            <li className="text-sm text-slate-400 flex items-center gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#06b6d4] flex-shrink-0" />
                                <span>Processed refunds appear in your source bank/account within 5-7 business days.</span>
                            </li>
                            <li className="text-sm text-slate-400 flex items-center gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#06b6d4] flex-shrink-0" />
                                <span>All credits are automatically returned directly to the payment instrument used during order checkout.</span>
                            </li>
                        </ul>
                    </section>

                    <section className="flex flex-col gap-4">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200 flex items-center gap-2">
                            <AlertTriangle size={18} className="text-[#ef4444]" />
                            <span>Non-Refundable Circumstances</span>
                        </h2>
                        <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                            Refunds will not be issued under the following conditions:
                        </p>
                        <ul className="list-none flex flex-col gap-3 pl-2">
                            <li className="text-sm text-slate-500 flex items-center gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500/40 flex-shrink-0" />
                                <span>Requests submitted after the 7-day initial window has expired.</span>
                            </li>
                            <li className="text-sm text-slate-500 flex items-center gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500/40 flex-shrink-0" />
                                <span>Significant plan utilization (greater than 50% of the clips or videos processed).</span>
                            </li>
                            <li className="text-sm text-slate-500 flex items-center gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500/40 flex-shrink-0" />
                                <span>Automatic plan renewals (refunds apply strictly to your first subscription cycle).</span>
                            </li>
                            <li className="text-sm text-slate-500 flex items-center gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500/40 flex-shrink-0" />
                                <span>Suspension of service due to clear violations of our platform Acceptable Use policies.</span>
                            </li>
                        </ul>
                    </section>

                    <section className="flex flex-col gap-4 border-t border-white/5 pt-8">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200">
                            5. Subscription Cancellation
                        </h2>
                        <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                            Please note that cancelling your recurring billing and requesting a refund are separate actions.
                            You can cancel auto-billing at any time directly on your Settings page to stop future renewals, which
                            keeps your current plan active until the final day of the cycle.
                        </p>
                    </section>
                </div>
            </div>
            <Footer />
        </main>
    );
}
