"use client";

import Link from "next/link";
import {
  Upload,
  Zap,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Play,
  Film,
  Bot,
  Layers,
  BarChart3,
  Code2,
  MonitorSmartphone,
  ChevronDown,
  Star,
  Quote,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { CAPTION_STYLES } from "@/lib/types";
import { createClient } from "@/lib/supabase";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";

/* ─── Scroll reveal hook ─── */
function useReveal() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("visible");
          observer.unobserve(el);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

function RevealSection({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useReveal();
  return (
    <section
      ref={ref}
      className={`reveal ${delay ? `reveal-delay-${delay}` : ""} ${className}`}
    >
      {children}
    </section>
  );
}

/* ─── FAQ Component ─── */
function FAQ() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const faqs = [
    {
      q: "What video formats are supported?",
      a: "ClipMint supports MP4, MOV, WebM, and AVI files up to 500MB. You can also paste a YouTube, Instagram, or Google Drive URL directly.",
    },
    {
      q: "How long does processing take?",
      a: "Most videos are processed in 5-15 minutes depending on length. Priority processing is available on Pro and Agency plans for faster results.",
    },
    {
      q: "Can I cancel my subscription?",
      a: "Absolutely. You can cancel anytime from your dashboard Settings page. You'll keep access until the end of your billing period.",
    },
    {
      q: "What's included in the free plan?",
      a: "The free plan includes 5 clips per month, 2 videos per month, 720p output, and access to 3 caption styles. No credit card required.",
    },
    {
      q: "How does the refund policy work?",
      a: "We offer a 7-day refund policy from the date of purchase. If the service doesn't meet your expectations, email us at ClipMint.Billing@gmail.com.",
    },
    {
      q: "Can I use clips commercially?",
      a: "Yes! You own 100% of your content. All clips generated through ClipMint can be used for commercial purposes on any platform.",
    },
    {
      q: "Is API access available?",
      a: "API access is available on Pro and Agency plans. You get full RESTful API access to integrate ClipMint into your own workflows and tools.",
    },
  ];

  return (
    <div className="flex flex-col gap-3.5 max-w-2xl mx-auto w-full">
      {faqs.map((faq, i) => (
        <div
          key={i}
          className={`faq-item ${openIdx === i ? "open" : ""}`}
        >
          <button
            className="faq-question w-full flex justify-between items-center text-left py-5 px-6 font-semibold"
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
          >
            <span>{faq.q}</span>
            <ChevronDown size={18} className="faq-chevron" />
          </button>
          <div className="faq-answer px-6 pb-5 text-sm text-slate-400 leading-relaxed">
            {faq.a}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Main Page ─── */
export default function HomePage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data?.user || null);
      setLoading(false);
    });
  }, []);

  return (
    <main className="overflow-hidden min-h-screen bg-[#030305] text-[#f8fafc]">
      <Navbar />

      {/* ═══ 1. HERO ═══ */}
      <section className="relative min-h-screen flex flex-col justify-center items-center text-center px-6 pt-36 pb-24 md:pt-48 md:pb-36 bg-radial-gradient">
        {/* Badge */}
        <div className="animate-fade-in-up flex items-center gap-2 px-4 py-1.5 rounded-full bg-mint-500/10 border border-mint-500/20 text-xs font-semibold text-mint-300 mb-8">
          <Sparkles size={13} className="text-mint-300" />
          <span>Now in open beta · Free plan, no card</span>
        </div>

        <h1 className="animate-fade-in-up text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight leading-[1.05] max-w-4xl mb-6 font-[family-name:var(--font-display)]">
          Ek video. <span className="text-mint-400">Das clips.</span>
          <span className="block text-ink-300 text-3xl sm:text-5xl md:text-6xl mt-3 font-bold">
            Cut, captioned, platform-ready.
          </span>
        </h1>

        <p className="animate-fade-in-up text-base sm:text-lg md:text-xl text-slate-400 max-w-2xl leading-relaxed mb-10">
          Upload a podcast, vlog, or lecture — AI detects viral moments,
          clips them, and adds{" "}
          <span className="text-ink-50 font-semibold underline decoration-mint-400 decoration-2 underline-offset-4">
            animated captions that look studio-made
          </span>
          . Platform-ready in minutes.
        </p>

        <div className="animate-fade-in-up flex flex-col sm:flex-row gap-4 justify-center items-center w-full max-w-lg min-h-[58px]">
          {loading ? (
            <>
              <div className="h-[54px] w-full sm:flex-1 skeleton rounded-xl" />
              <div className="h-[54px] w-full sm:w-36 skeleton rounded-xl" />
            </>
          ) : (
            <>
              {user ? (
                <Link
                  href="/dashboard"
                  className="btn-primary py-4 px-8 text-base w-full sm:flex-1 flex items-center justify-center gap-2"
                >
                  <Upload size={18} />
                  <span>Go to Dashboard</span>
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="btn-primary py-4 px-8 text-base w-full sm:flex-1 flex items-center justify-center gap-2"
                >
                  <Upload size={18} />
                  <span>Start Free — No Card Required</span>
                </Link>
              )}
              <Link
                href="/features"
                className="btn-secondary py-4 px-8 text-base w-full sm:w-36 flex items-center justify-center gap-2 flex-shrink-0"
              >
                <Play size={18} />
                <span>See Features</span>
              </Link>
            </>
          )}
        </div>

        {/* Trust badge */}
        <div className="animate-fade-in-up flex items-center gap-2 mt-12 text-sm text-slate-500">
          <CheckCircle2 size={16} className="text-[#10b981]" />
          <span>Free plan. No credit card. Watermark-free on paid.</span>
        </div>

        {/* Stats */}
        <div className="animate-fade-in-up grid grid-cols-3 gap-8 md:gap-16 mt-16 max-w-2xl mx-auto border-t border-white/5 pt-8 w-full">
          {[
            { value: "9", label: "Caption Styles" },
            { value: "1080×1920", label: "Face-Tracked Output" },
            { value: "-14 LUFS", label: "Studio Loudness" },
          ].map((stat) => (
            <div key={stat.label} className="flex flex-col items-center">
              <div className="gradient-text font-black text-2xl sm:text-3xl bg-text-mint-400">
                {stat.value}
              </div>
              <div className="text-[11px] sm:text-xs text-slate-500 font-medium uppercase tracking-wider mt-1">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ 2. SOCIAL PROOF BAR ═══ */}
      <RevealSection className="py-12 border-y border-white/5 bg-[#08080c]/30 text-center">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6">
          Built for creators on
        </p>
        <div className="flex justify-center items-center gap-8 md:gap-16 flex-wrap opacity-40 px-6">
          {["YouTube", "Instagram", "TikTok", "LinkedIn", "X / Twitter"].map(
            (platform) => (
              <span
                key={platform}
                className="text-lg md:text-xl font-extrabold text-slate-400 tracking-tight"
              >
                {platform}
              </span>
            )
          )}
        </div>
      </RevealSection>

      {/* ═══ 3. HOW IT WORKS ═══ */}
      <RevealSection className="py-24 px-6 max-w-6xl mx-auto w-full">
        <h2 className="section-heading text-3xl sm:text-4xl font-extrabold text-center mb-4">
          How It <span className="text-mint-400">Works</span>
        </h2>
        <p className="section-subheading text-center text-slate-400 mb-16 max-w-md mx-auto">
          Three steps. Zero editing skills required.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              icon: <Upload size={24} />,
              step: "01",
              title: "Upload",
              desc: "Paste a YouTube/Instagram URL or drag-and-drop your video file. We support MP4, MOV, WebM up to 500MB.",
            },
            {
              icon: <Zap size={24} />,
              step: "02",
              title: "AI Processes",
              desc: "Transcribes → AI scores viral moments → Clips → Renders studio-quality animated captions.",
            },
            {
              icon: <Sparkles size={24} />,
              step: "03",
              title: "Download & Post",
              desc: "Get platform-ready clips with titles, hashtags, and thumbnails — formatted for Reels, Shorts & TikTok.",
            },
          ].map((item) => (
            <div
              key={item.step}
              className="glass-card p-8 flex flex-col gap-6"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-mint-500/10 flex items-center justify-center text-mint-400 border border-mint-500/20">
                  {item.icon}
                </div>
                <span className="text-xs font-bold text-mint-400 tracking-widest uppercase">
                  Step {item.step}
                </span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-200 mb-2">
                  {item.title}
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  {item.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </RevealSection>

      {/* ═══ 4. FEATURES GRID ═══ */}
      <RevealSection className="py-24 px-6 bg-gradient-to-b from-transparent via-mint-500/5 to-transparent">
        <div className="max-w-6xl mx-auto w-full">
          <h2 className="section-heading text-3xl sm:text-4xl font-extrabold text-center mb-4">
            Powerful <span className="text-mint-400">Features</span>
          </h2>
          <p className="section-subheading text-center text-slate-400 mb-16 max-w-lg mx-auto">
            Everything you need to turn long-form content into viral
            short-form clips.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: <Bot size={22} />,
                title: "AI Viral Moment Detection",
                desc: "Our AI analyzes audio energy, transcript context, and engagement patterns to find the most shareable moments.",
              },
              {
                icon: <Sparkles size={22} />,
                title: "9 Animated Caption Styles",
                desc: "Studio-quality animated captions powered by Remotion — not flat FFmpeg text. From Hormozi-style to Neon Glow.",
              },
              {
                icon: <Layers size={22} />,
                title: "Batch Processing",
                desc: "Process multiple videos at once. Queue up your content and let AI handle the rest while you focus on creating.",
              },
              {
                icon: <MonitorSmartphone size={22} />,
                title: "Multi-Platform Output",
                desc: "Clips are automatically formatted for YouTube Shorts, Instagram Reels, TikTok, and LinkedIn — with proper aspect ratios.",
              },
              {
                icon: <Code2 size={22} />,
                title: "API Access",
                desc: "Full RESTful API to integrate ClipMint into your own tools, workflows, and team processes. Available on Pro plans.",
              },
              {
                icon: <BarChart3 size={22} />,
                title: "Analytics Dashboard",
                desc: "Track clips generated, viral scores, processing trends, and usage — all in a real-time analytics dashboard.",
              },
            ].map((feat) => (
              <div
                key={feat.title}
                className="glass-card p-6 flex flex-col gap-4"
              >
                <div className="w-11 h-11 rounded-xl bg-mint-500/10 flex items-center justify-center text-mint-400 border border-mint-500/30">
                  {feat.icon}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-200 mb-2">
                    {feat.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                    {feat.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </RevealSection>

      {/* ═══ 5. CAPTION STYLES SHOWCASE ═══ */}
      <RevealSection className="py-24 px-6 max-w-6xl mx-auto w-full">
        <h2 className="section-heading text-3xl sm:text-4xl font-extrabold text-center mb-4">
          <span className="text-mint-400">9 Caption Styles</span>
        </h2>
        <p className="section-subheading text-center text-slate-400 mb-16 max-w-md mx-auto">
          Professional animated captions powered by Remotion — studio-quality,
          not flat text.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {CAPTION_STYLES.map((style) => (
            <div
              key={style.value}
              className="glass-card p-6 hover:border-mint-500/40 cursor-default"
            >
              <h3 className="text-base font-bold text-slate-200 mb-2">
                {style.label}
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-normal">
                {style.description}
              </p>
            </div>
          ))}
        </div>
      </RevealSection>

      {/* ═══ 6. PRICING ═══ */}
      <RevealSection className="py-24 px-6 bg-gradient-to-b from-transparent via-mint-500/5 to-transparent">
        <div className="max-w-6xl mx-auto w-full">
          <h2 className="section-heading text-3xl sm:text-4xl font-extrabold text-center mb-4">
            Simple <span className="text-mint-400">Pricing</span>
          </h2>
          <p className="section-subheading text-center text-slate-400 mb-16 max-w-md mx-auto">
            Start free. Upgrade when you're ready to go pro.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 items-stretch">
            {[
              {
                name: "Free",
                price: "₹0",
                period: "forever",
                features: [
                  "5 clips/month",
                  "2 videos/month",
                  "720p output",
                  "ClipMint watermark",
                  "3 caption styles",
                ],
                highlighted: false,
                cta: "Start Free",
              },
              {
                name: "Creator",
                price: "₹499",
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
                cta: "Start Free Trial",
              },
              {
                name: "Pro",
                price: "₹899",
                period: "/month",
                features: [
                  "200 clips/month",
                  "20 videos/month",
                  "4K output",
                  "Priority processing",
                  "API access",
                ],
                highlighted: false,
                cta: "Subscribe Now",
              },
              {
                name: "Agency",
                price: "₹1,499",
                period: "/month",
                features: [
                  "Unlimited clips",
                  "Unlimited videos",
                  "White-label",
                  "Team accounts",
                  "n8n integration",
                ],
                highlighted: false,
                cta: "Contact Sales",
              },
            ].map((plan) => (
              <div
                key={plan.name}
                className={`glass-card p-6 flex flex-col justify-between ${
                  plan.highlighted ? "border-mint-500 border-2" : ""
                }`}
              >
                <div>
                  {plan.highlighted && (
                    <div className="absolute top-3 right-4 bg-mint-500 text-ink-950 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
                      Popular
                    </div>
                  )}
                  <h3 className="text-lg font-bold text-slate-200 mb-3">
                    {plan.name}
                  </h3>
                  <div className="flex items-baseline gap-1 mb-6">
                    <span className="text-3xl font-extrabold text-slate-200">
                      {plan.price}
                    </span>
                    <span className="text-xs text-slate-500">
                      {plan.period}
                    </span>
                  </div>
                  <ul className="list-none flex flex-col gap-3 mb-8">
                    {plan.features.map((f) => (
                      <li
                        key={f}
                        className="flex items-center gap-2.5 text-xs sm:text-sm text-slate-400"
                      >
                        <CheckCircle2
                          size={14}
                          className="text-[#10b981] flex-shrink-0"
                        />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Link
                  href="/login"
                  className={`${
                    plan.highlighted ? "btn-primary" : "btn-secondary"
                  } w-full py-2.5 text-sm`}
                >
                  <span>{plan.cta}</span>
                  <ArrowRight size={14} />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </RevealSection>

      {/* ═══ 7. TESTIMONIALS ═══ */}
      <RevealSection className="py-24 px-6 max-w-6xl mx-auto w-full">
        <h2 className="section-heading text-3xl sm:text-4xl font-extrabold text-center mb-4">
          What ships in <span className="text-mint-400">every clip</span>
        </h2>
        <p className="section-subheading text-center text-slate-400 mb-16 max-w-md mx-auto">
          We won't invent testimonials — the product has no users yet. Here is
          exactly what the pipeline delivers instead.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              name: "Face-tracked 1080×1920",
              role: "Auto-reframe",
              text: "The speaker stays centered as the camera moves. Landscape sources become true vertical clips — no decapitation, no letterbox bars.",
              stars: 0,
            },
            {
              name: "-14 LUFS · -1 dBTP",
              role: "Studio loudness",
              text: "Every clip is measured and normalised to the level Reels, Shorts and TikTok normalize to, with denoise when the source needs it.",
              stars: 0,
            },
            {
              name: "Silence-snapped cuts",
              role: "Clean boundaries",
              text: "Clip boundaries snap to natural speech pauses and scene changes, so clips start on words and end on silence — not mid-sentence.",
              stars: 0,
            },
          ].map((t) => (
            <div
              key={t.name}
              className="glass-card p-6 flex flex-col justify-between"
            >
              <div>
                <div className="flex gap-0.5 mb-4">
                  {Array.from({ length: t.stars }).map((_, i) => (
                    <Star
                      key={i}
                      size={14}
                      fill="#f59e0b"
                      className="text-[#f59e0b]"
                    />
                  ))}
                </div>
                <Quote
                  size={18}
                  className="text-mint-400 opacity-20 mb-3"
                />
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed mb-6">
                  {t.text}
                </p>
              </div>
              <div className="border-t border-white/5 pt-4">
                <div className="text-sm font-bold text-slate-300">{t.name}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {t.role}
                </div>
              </div>
            </div>
          ))}
        </div>
      </RevealSection>

      {/* ═══ 8. FAQ ═══ */}
      <RevealSection className="py-24 px-6 border-t border-white/5 bg-[#08080c]/20 w-full">
        <h2 className="section-heading text-3xl sm:text-4xl font-extrabold text-center mb-4">
          Frequently Asked <span className="text-mint-400">Questions</span>
        </h2>
        <p className="section-subheading text-center text-slate-400 mb-16 max-w-md mx-auto">
          Everything you need to know about ClipMint.
        </p>
        <FAQ />
      </RevealSection>

      {/* ═══ 9. CTA BANNER ═══ */}
      <RevealSection className="py-20 px-6 text-center max-w-6xl mx-auto w-full">
        <div className="relative p-10 md:p-16 rounded-3xl bg-ink-850 border border-mint-500/30 shadow-xl overflow-hidden">
          <div className="relative z-10 flex flex-col items-center gap-6">
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">
              Shuru karo. <span className="text-mint-400">Free hai.</span>
            </h2>
            <p className="text-slate-400 text-sm sm:text-base max-w-lg leading-relaxed">
              5 clips a month, free forever. Upgrade when it earns its keep.
            </p>
            {loading ? (
              <div className="h-12 w-44 skeleton rounded-xl" />
            ) : user ? (
              <Link
                href="/dashboard"
                className="btn-primary py-3.5 px-8 text-base shadow-lg flex items-center gap-2"
              >
                <Sparkles size={16} />
                <span>Go to Dashboard</span>
              </Link>
            ) : (
              <Link
                href="/login"
                className="btn-primary py-3.5 px-8 text-base shadow-lg flex items-center gap-2"
              >
                <Sparkles size={16} />
                <span>Get Started for Free</span>
              </Link>
            )}
          </div>
        </div>
      </RevealSection>

      <Footer />
    </main>
  );
}
