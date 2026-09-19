"use client";

import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import Link from "next/link";
import {
    CheckCircle2,
    ArrowRight,
    ChevronDown,
    Loader2,
    Zap,
    CreditCard,
    RefreshCw,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase";

/* ─── Plan data ─── */
const PLANS = [
    {
        key: "free" as const,
        name: "Free",
        monthlyPrice: "₹0",
        annualPrice: "₹0",
        period: "forever",
        features: [
            "5 clips/month",
            "2 videos/month",
            "720p output",
            "ClipMint watermark",
            "3 caption styles",
            "Email support",
        ],
        highlighted: false,
        cta: "Start Free",
    },
    {
        key: "creator" as const,
        name: "Creator",
        monthlyPrice: "₹499",
        annualPrice: "₹399",
        period: "/month",
        features: [
            "150 clips/month",
            "30 videos/month",
            "1080p output",
            "No watermark",
            "All 9 caption styles",
            "Priority processing",
            "API access",
            "Email support",
        ],
        highlighted: true,
        cta: "Get Creator",
    },
    {
        key: "pro" as const,
        name: "Pro",
        monthlyPrice: "₹899",
        annualPrice: "₹719",
        period: "/month",
        features: [
            "200 clips/month",
            "20 videos/month",
            "4K output",
            "No watermark",
            "All 9 caption styles",
            "Priority processing",
            "Full API access",
            "Discord notifications",
        ],
        highlighted: false,
        cta: "Get Pro",
    },
    {
        key: "agency" as const,
        name: "Agency",
        monthlyPrice: "₹1,499",
        annualPrice: "₹1,199",
        period: "/month",
        features: [
            "Unlimited clips",
            "Unlimited videos",
            "4K output",
            "White-label option",
            "Team accounts",
            "n8n integration",
            "Batch processing",
            "Dedicated support",
        ],
        highlighted: false,
        cta: "Contact Sales",
    },
];

const BILLING_FAQ = [
    {
        q: "What payment methods do you accept?",
        a: "We accept all major credit/debit cards, UPI, net banking, and wallets via Cashfree. All payments are securely processed with 256-bit encryption.",
    },
    {
        q: "Can I cancel anytime?",
        a: "Yes. Cancel from your Settings page at any time. You'll retain access until the end of your current billing cycle.",
    },
    {
        q: "What's the refund policy?",
        a: "We offer a 7-day refund window from the date of your first payment. Email ClipMint.Billing@gmail.com with your refund request.",
    },
    {
        q: "Do I need a credit card for the free plan?",
        a: "No. The free plan requires no credit card. Just sign up with your email or Google account and start clipping.",
    },
    {
        q: "Can I switch plans?",
        a: "Yes. Upgrade or downgrade anytime from your dashboard Settings. Changes take effect at the start of your next billing cycle.",
    },
    {
        q: "What's the difference between one-time and subscription?",
        a: "One-time payment gives you 30 days of access at the monthly rate. Subscription auto-renews each month or year at the selected rate until you cancel.",
    },
];

export default function PricingPage() {
    const [annual, setAnnual] = useState(false);
    const [openFaq, setOpenFaq] = useState<number | null>(null);
    const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
    const [paymentType, setPaymentType] = useState<"subscription" | "one_time">("subscription");
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
    const [cashfreeLoaded, setCashfreeLoaded] = useState(false);

    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then(({ data: { user } }) => {
            setIsLoggedIn(!!user);
        });
    }, []);

    // Load Cashfree JS SDK
    useEffect(() => {
        if (typeof window !== "undefined" && !cashfreeLoaded) {
            const script = document.createElement("script");
            script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
            script.onload = () => setCashfreeLoaded(true);
            document.head.appendChild(script);
        }
    }, [cashfreeLoaded]);

    const showToast = useCallback((type: "success" | "error", message: string) => {
        setToast({ type, message });
        setTimeout(() => setToast(null), 5000);
    }, []);

    async function handleCheckout(planKey: string) {
        if (planKey === "free") {
            window.location.href = "/login";
            return;
        }

        if (!isLoggedIn) {
            window.location.href = "/login";
            return;
        }

        setLoadingPlan(planKey);

        try {
            const period = paymentType === "one_time" ? "one_time" : annual ? "annual" : "monthly";

            const res = await fetch("/api/cashfree/create-order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ plan: planKey, period }),
            });

            const data = await res.json();

            if (!res.ok) {
                showToast("error", data.error || "Failed to initialize payment");
                setLoadingPlan(null);
                return;
            }

            // Open Cashfree Checkout
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cashfree = (window as any).Cashfree?.({
                mode: data.environment === "production" ? "production" : "sandbox",
            });

            if (!cashfree) {
                showToast("error", "Payment system is loading. Please try again in a moment.");
                setLoadingPlan(null);
                return;
            }

            const checkoutOptions = {
                paymentSessionId: data.payment_session_id,
                redirectTarget: "_modal",
            };

            cashfree.checkout(checkoutOptions).then(async (result: { error?: { message: string }; redirect?: boolean; paymentDetails?: { paymentMessage: string } }) => {
                if (result.error) {
                    showToast("error", result.error.message || "Payment failed. Please try again.");
                    setLoadingPlan(null);
                } else if (result.redirect) {
                    console.log("Payment redirecting...");
                } else if (result.paymentDetails) {
                    // Payment completed in modal, verify on server
                    try {
                        const verifyRes = await fetch("/api/cashfree/verify-payment", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ order_id: data.order_id }),
                        });

                        const verifyData = await verifyRes.json();

                        if (verifyRes.ok && verifyData.success) {
                            showToast("success", verifyData.message || "Payment successful! Redirecting...");
                            setTimeout(() => {
                                window.location.href = "/dashboard";
                            }, 1500);
                        } else {
                            showToast("error", verifyData.error || "Payment verification failed");
                        }
                    } catch {
                        showToast("error", "Payment verification failed. Please contact support.");
                    }
                    setLoadingPlan(null);
                }
            });
        } catch {
            showToast("error", "Something went wrong. Please try again.");
            setLoadingPlan(null);
        }
    }

    return (
        <main className="min-h-screen bg-ink-950 text-ink-50">
            <Navbar />

            {/* ─── Toast ─── */}
            {toast && (
                <div
                    className={`toast toast-${toast.type} fixed top-6 right-6 z-[1000] px-6 py-3.5 rounded-xl border font-semibold text-sm backdrop-blur-md animate-fade-in-up`}
                >
                    {toast.message}
                </div>
            )}

            <div className="max-w-6xl mx-auto px-6 pt-36 pb-24 md:pt-44 md:pb-36 relative">
                <div className="text-center mb-16">
                    <p className="cm-eyebrow text-mint-300 mb-4">Pricing</p>
                    <h1 className="text-[clamp(32px,4.5vw,52px)] font-bold leading-[1.08] tracking-[-0.02em] mb-4">
                        Simple, <span className="text-mint-400">Transparent</span> Pricing
                    </h1>
                    <p className="text-base sm:text-lg text-ink-300 max-w-lg mx-auto leading-[1.6] mb-8">
                        Start free. Scale as you grow. No hidden fees.
                    </p>

                    {/* ─── Payment Type Toggle ─── */}
                    <div className="flex justify-center gap-3 mb-6 flex-wrap">
                        <button
                            onClick={() => setPaymentType("subscription")}
                            className={`px-5 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all duration-300 ${
                                paymentType === "subscription"
                                    ? "border-mint-500 bg-mint-500/10 text-mint-300"
                                    : "border-white/5 bg-transparent text-ink-300 hover:text-ink-50"
                            }`}
                        >
                            <RefreshCw size={13} />
                            <span>Subscription</span>
                        </button>
                        <button
                            onClick={() => setPaymentType("one_time")}
                            className={`px-5 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all duration-300 ${
                                paymentType === "one_time"
                                    ? "border-mint-500 bg-mint-500/10 text-mint-300"
                                    : "border-white/5 bg-transparent text-ink-300 hover:text-ink-50"
                            }`}
                        >
                            <CreditCard size={13} />
                            <span>One-Time (30 Days)</span>
                        </button>
                    </div>

                    {/* ─── Billing Period Toggle (only for subscriptions) ─── */}
                    {paymentType === "subscription" && (
                        <div className="inline-flex items-center gap-1.5 p-1.5 rounded-xl bg-white/2.5 border border-white/5 shadow-inner">
                            <button
                                onClick={() => setAnnual(false)}
                                className={`px-5 py-2 rounded-lg border-none font-semibold text-sm cursor-pointer transition-all duration-300 ${
                                    !annual ? "bg-mint-500 text-ink-950" : "bg-transparent text-ink-300 hover:text-ink-50"
                                }`}
                            >
                                Monthly
                            </button>
                            <button
                                onClick={() => setAnnual(true)}
                                className={`px-5 py-2 rounded-lg border-none font-semibold text-sm cursor-pointer transition-all duration-300 flex items-center gap-1.5 ${
                                    annual ? "bg-mint-500 text-ink-950" : "bg-transparent text-ink-300 hover:text-ink-50"
                                }`}
                            >
                                <span>Annual</span>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                    annual ? "bg-ink-950/15 text-ink-950" : "bg-marigold-400/15 text-marigold-400"
                                }`}>
                                    Save 20%
                                </span>
                            </button>
                        </div>
                    )}
                </div>

                {/* ─── Plans Grid ─── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 items-stretch mb-24">
                    {PLANS.map((plan) => {
                        const isLoading = loadingPlan === plan.key;
                        const isFree = plan.key === "free";
                        const isContactSales = plan.cta === "Contact Sales";

                        return (
                            <div
                                key={plan.name}
                                className={`cm-card p-8 flex flex-col justify-between ${
                                    plan.highlighted ? "border-mint-500/60 shadow-[var(--shadow-accent)]" : ""
                                }`}
                            >
                                <div className="relative">
                                    {plan.highlighted && (
                                        <div className="absolute -top-3.5 right-0 bg-mint-500 text-ink-950 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
                                            Popular
                                        </div>
                                    )}
                                    <h3 className="text-lg font-semibold text-ink-50 mb-3">
                                        {plan.name}
                                    </h3>
                                    <div className="flex items-baseline gap-1 mb-2">
                                        <span className="font-[family-name:var(--font-display)] font-bold text-[34px] leading-none tracking-[-0.02em] text-ink-50">
                                            {paymentType === "one_time"
                                                ? plan.monthlyPrice
                                                : annual
                                                    ? plan.annualPrice
                                                    : plan.monthlyPrice}
                                        </span>
                                        <span className="text-xs text-ink-500 font-medium">
                                            {isFree
                                                ? "forever"
                                                : paymentType === "one_time"
                                                    ? "/30 days"
                                                    : plan.period}
                                        </span>
                                    </div>

                                    {/* Payment badge */}
                                    {!isFree && !isContactSales && (
                                        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold mb-6 ${
                                            paymentType === "subscription"
                                                ? "bg-mint-500/10 text-mint-300"
                                                : "bg-mint-500/10 text-mint-400"
                                        }`}>
                                            {paymentType === "subscription" ? (
                                                <><RefreshCw size={9} /> <span>Auto-renews</span></>
                                            ) : (
                                                <><Zap size={9} /> <span>One-time</span></>
                                            )}
                                        </div>
                                    )}

                                    <ul className="list-none flex flex-col gap-3 mb-8 mt-4">
                                        {plan.features.map((f) => (
                                            <li
                                                key={f}
                                                className="flex items-center gap-2.5 text-xs sm:text-sm text-ink-300"
                                            >
                                                <CheckCircle2
                                                    size={14}
                                                    className="text-mint-400 flex-shrink-0"
                                                />
                                                <span>{f}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                {isContactSales ? (
                                    <Link
                                        href="/contact"
                                        className="cm-btn-ghost w-full py-2.5 text-sm"
                                    >
                                        <span>Contact Sales</span>
                                        <ArrowRight size={14} />
                                    </Link>
                                ) : (
                                    <button
                                        onClick={() => handleCheckout(plan.key)}
                                        disabled={isLoading}
                                        className={`${plan.highlighted ? "cm-btn-primary" : "cm-btn-ghost"} w-full py-2.5 text-sm`}
                                    >
                                        {isLoading ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                            <>
                                                <span>{plan.cta}</span>
                                                <ArrowRight size={14} />
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* ─── Feature Comparison Table ─── */}
                <div className="mb-24">
                    <h2 className="text-[clamp(26px,3.5vw,38px)] font-bold text-center mb-10 tracking-[-0.02em]">
                        Compare <span className="text-mint-400">Plans</span>
                    </h2>
                    <div className="cm-card overflow-x-auto p-0">
                        <table className="w-full border-collapse text-sm min-w-[640px]">
                            <thead>
                                <tr className="border-b border-white/5">
                                    <th className="cm-eyebrow text-left py-4 px-6 text-ink-500">
                                        Feature
                                    </th>
                                    {PLANS.map((p) => (
                                        <th
                                            key={p.name}
                                            className={`text-center py-4 px-3 font-bold text-xs uppercase tracking-wider ${
                                                p.highlighted ? "text-mint-300 bg-mint-500/5" : "text-ink-300"
                                            }`}
                                        >
                                            {p.name}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {[
                                    ["Clips/month", "5", "150", "200", "Unlimited"],
                                    ["Videos/month", "2", "30", "20", "Unlimited"],
                                    ["Output quality", "720p", "1080p", "4K", "4K"],
                                    ["Caption styles", "3", "9", "9", "9"],
                                    ["Watermark", "Yes", "No", "No", "No"],
                                    ["API access", "—", "✓", "✓", "✓"],
                                    ["Priority processing", "—", "✓", "✓", "✓"],
                                    ["Team accounts", "—", "—", "—", "✓"],
                                    ["White-label", "—", "—", "—", "✓"],
                                ].map((row, i) => (
                                    <tr
                                        key={row[0]}
                                        className="border-b border-white/5 last:border-0 hover:bg-white/5"
                                    >
                                        <td className="py-4 px-6 text-ink-300 font-medium">
                                            {row[0]}
                                        </td>
                                        {row.slice(1).map((val, j) => {
                                            const isHighlight = PLANS[j].highlighted;
                                            return (
                                                <td
                                                    key={j}
                                                    className={`text-center py-4 px-3 ${
                                                        isHighlight ? "bg-mint-500/5" : ""
                                                    } ${
                                                        val === "✓"
                                                            ? "text-mint-400 font-bold"
                                                            : val === "—"
                                                                ? "text-ink-600"
                                                                : "text-ink-50 font-medium"
                                                    }`}
                                                >
                                                    {val}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* ─── Cashfree Trust Badge ─── */}
                <div className="text-center mb-24">
                    <div className="cm-card inline-flex items-center gap-3 py-3.5 px-6">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#39E508" strokeWidth="2.5" className="flex-shrink-0">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                        <span className="text-xs text-ink-300 font-medium leading-none">
                            Secure payments powered by <strong className="text-ink-50">Cashfree</strong> • 256-bit SSL encryption
                        </span>
                    </div>
                </div>

                {/* ─── Billing FAQ ─── */}
                <div className="max-w-2xl mx-auto w-full">
                    <h2 className="text-[clamp(26px,3.5vw,38px)] font-bold text-center mb-10 tracking-[-0.02em]">
                        Billing <span className="text-mint-400">FAQ</span>
                    </h2>
                    <div className="flex flex-col gap-3.5">
                        {BILLING_FAQ.map((faq, i) => (
                            <div key={i} className={`faq-item ${openFaq === i ? "open" : ""}`}>
                                <button className="faq-question w-full flex justify-between items-center text-left py-5 px-6 font-semibold" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                                    <span>{faq.q}</span>
                                    <ChevronDown size={18} className="faq-chevron" />
                                </button>
                                <div className="faq-answer px-6 pb-5 text-sm text-ink-300 leading-relaxed">{faq.a}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <Footer />
        </main>
    );
}
