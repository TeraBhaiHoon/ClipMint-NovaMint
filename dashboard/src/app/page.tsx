"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Upload, Play, ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { CAPTION_STYLES } from "@/lib/types";
import { createClient } from "@/lib/supabase";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import ScrollProgress from "./components/ScrollProgress";
import { HeroGroup, HeroItem } from "./components/HeroMotion";
import { SectionReveal } from "./components/SectionReveal";
import StyleMarquee from "./components/StyleMarquee";
import CountUp from "./components/CountUp";
import PhonePreview from "./components/PhonePreview";
import HowItWorks from "./components/HowItWorks";
import FeatureBento from "./components/FeatureBento";
import FaqAccordion, { type FaqItem } from "./components/FaqAccordion";

/* ─── FAQ — real questions, honest answers (identity §9.9) ─── */
const FAQS: FaqItem[] = [
  {
    q: "Do I need a credit card to start?",
    a: "No. The free plan gives you 5 clips a month with no card required. You only pay if and when you upgrade — the watermark policy and every plan limit are listed on the pricing page.",
  },
  {
    q: "Which platforms are the clips formatted for?",
    a: "Every clip renders at 9:16 (1080×1920) for Instagram Reels, YouTube Shorts and TikTok, with titles, hashtags and thumbnails attached per platform.",
  },
  {
    q: "How long can my video be?",
    a: "Files up to 500MB are supported — MP4, MOV or WebM. You can also paste a YouTube, Instagram or Google Drive link instead of uploading. Most videos finish processing in 5–15 minutes.",
  },
  {
    q: "Which languages are supported? What about Hindi?",
    a: "Transcription covers English and handles mixed Hinglish speech. Caption text renders in Latin-script languages. If your content is mostly in another language, test it on the free plan first — no card needed.",
  },
  {
    q: "Is there a watermark?",
    a: "Free-plan clips carry a small ClipMint watermark. All paid plans render watermark-free — stated up front on the pricing page, not discovered after checkout.",
  },
  {
    q: "What's the refund policy?",
    a: "A 7-day refund window from the date of purchase. If the service doesn't meet your expectations, email ClipMint.Billing@gmail.com and we'll process it.",
  },
];

/* ─── Pricing — same plans, same prices, same limits (identity §9.8) ─── */
const PLANS = [
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
];

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

  const primaryCta = user ? (
    <Link href="/dashboard" className="cm-btn-primary py-4 px-8 text-base">
      <Upload size={17} />
      <span>Go to Dashboard</span>
    </Link>
  ) : (
    <Link href="/login" className="cm-btn-primary py-4 px-8 text-base">
      <Sparkles size={17} />
      <span>Start free — no card</span>
    </Link>
  );

  return (
    <main className="overflow-x-clip min-h-screen bg-ink-950 text-ink-50">
      <Navbar />
      <ScrollProgress />

      {/* ═══ 1. HERO (identity §9.2) ═══ */}
      <section className="px-6 pt-32 pb-20 md:pt-44 md:pb-28">
        <HeroGroup className="max-w-6xl mx-auto grid lg:grid-cols-[1.1fr_0.9fr] gap-14 lg:gap-12 items-center w-full">
          <div className="flex flex-col items-center lg:items-start text-center lg:text-left gap-7">
            {/* Badge */}
            <HeroItem className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-mint-500/10 border border-mint-500/20 text-xs font-semibold text-mint-300">
              <Sparkles size={13} className="text-mint-300" />
              <span>Now in open beta · Free plan, no card</span>
            </HeroItem>

            {/* H1 */}
            <HeroItem>
              <h1 className="text-[clamp(44px,6vw,76px)] font-bold leading-[1.02] tracking-[-0.03em] text-ink-50 font-[family-name:var(--font-display)]">
                Ek video. <span className="text-mint-400">Das clips.</span>
                <span className="block text-[clamp(24px,3.4vw,44px)] font-semibold tracking-[-0.02em] text-ink-300 mt-3">
                  Cut, captioned, platform-ready.
                </span>
              </h1>
            </HeroItem>

            {/* Sub */}
            <HeroItem>
              <p className="text-lg text-ink-300 leading-[1.6] max-w-xl">
                Upload a podcast, vlog or lecture. ClipMint finds the moments
                worth posting and adds animated captions that look studio-made —
                in minutes.
              </p>
            </HeroItem>

            {/* CTA pair */}
            <HeroItem className="flex flex-col sm:flex-row gap-3.5 w-full sm:w-auto min-h-[56px] justify-center lg:justify-start">
              {loading ? (
                <>
                  <div className="h-[52px] w-full sm:w-56 skeleton rounded-xl" />
                  <div className="h-[52px] w-full sm:w-44 skeleton rounded-xl" />
                </>
              ) : (
                primaryCta
              )}
              <a href="#how-it-works" className="cm-btn-ghost py-4 px-8 text-base">
                <Play size={17} />
                <span>See how it works</span>
              </a>
            </HeroItem>

            {/* Trust microline — formats and limits, stated up front */}
            <HeroItem className="text-[13px] font-medium text-ink-500">
              MP4 · MOV · WebM · up to 500MB · YouTube / Instagram / Drive links
            </HeroItem>
          </div>

          {/* Product visual — CSS-built 9:16 caption preview */}
          <HeroItem className="flex justify-center lg:justify-end">
            <PhonePreview />
          </HeroItem>
        </HeroGroup>
      </section>

      {/* ═══ 2. PLATFORM STRIP (capability claim, not adoption claim) ═══ */}
      <SectionReveal className="py-10 border-y border-white/5 bg-ink-900/40">
        <div className="max-w-5xl mx-auto px-2 text-center">
          <p className="cm-eyebrow text-ink-500 mb-5">
            Made for Reels, Shorts &amp; TikTok
          </p>
          <div className="flex flex-wrap justify-center items-center gap-x-10 gap-y-3">
            {["Instagram Reels", "YouTube Shorts", "TikTok"].map((platform) => (
              <span
                key={platform}
                className="text-lg md:text-xl font-semibold tracking-tight text-ink-300"
              >
                {platform}
              </span>
            ))}
          </div>
        </div>
      </SectionReveal>

      {/* ═══ 3. HOW IT WORKS — scroll-drawn connector ═══ */}
      <HowItWorks />

      {/* ═══ 4. CAPTION STYLES — the one loop (marquee) + grid fallback ═══ */}
      <SectionReveal className="py-24 sm:py-32 px-6">
        <div id="styles" className="max-w-6xl mx-auto scroll-mt-28">
          <p className="cm-eyebrow text-mint-300 text-center mb-4">
            Caption engine
          </p>
          <h2 className="text-center text-[clamp(32px,4.5vw,52px)] font-bold leading-[1.08] tracking-[-0.02em] text-ink-50 mb-4">
            Captions that do the talking.
          </h2>
          <p className="section-subheading">
            Nine animated styles rendered with Remotion — the same engine that
            paints your clips, mint highlights included.
          </p>

          <StyleMarquee />

          {/* Real figures only (identity §6) */}
          <div className="grid grid-cols-3 gap-6 max-w-2xl mx-auto text-center border-y border-white/5 py-6 mb-14">
            <div>
              <div className="font-[family-name:var(--font-display)] font-bold text-2xl sm:text-3xl text-ink-50">
                <CountUp value="9" />
              </div>
              <div className="cm-eyebrow text-ink-500 mt-1.5">Caption styles</div>
            </div>
            <div>
              <div className="font-[family-name:var(--font-display)] font-bold text-2xl sm:text-3xl text-ink-50">
                <CountUp value="1080×1920" />
              </div>
              <div className="cm-eyebrow text-ink-500 mt-1.5">Face-tracked output</div>
            </div>
            <div>
              <div className="font-[family-name:var(--font-display)] font-bold text-2xl sm:text-3xl text-ink-50">
                <CountUp value="−14 LUFS" />
              </div>
              <div className="cm-eyebrow text-ink-500 mt-1.5">Loudness target</div>
            </div>
          </div>

          {/* Grid fallback under the marquee */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
            {CAPTION_STYLES.map((style) => (
              <div key={style.value} className="cm-card px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-ink-50">
                    {style.label}
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full bg-mint-500 shrink-0" aria-hidden="true" />
                </div>
                <p className="mt-1 text-[13px] leading-snug text-ink-400">
                  {style.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </SectionReveal>

      {/* ═══ 5. FEATURE BENTO ═══ */}
      <FeatureBento />

      {/* ═══ 6. PRICING — position unchanged, cards rebuilt ═══ */}
      <SectionReveal className="py-24 sm:py-32 px-6">
        <div id="pricing" className="max-w-6xl mx-auto scroll-mt-28">
          <p className="cm-eyebrow text-mint-300 text-center mb-4">Pricing</p>
          <h2 className="text-center text-[clamp(32px,4.5vw,52px)] font-bold leading-[1.08] tracking-[-0.02em] text-ink-50 mb-4">
            Simple pricing. Stated up front.
          </h2>
          <p className="section-subheading">
            Start free. Every limit, the watermark policy and the 7-day refund
            window are listed right here — nothing hidden below the fold.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5 items-stretch mt-16">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`cm-card relative p-7 flex flex-col justify-between ${
                  plan.highlighted
                    ? "border-mint-500/60 shadow-[var(--shadow-accent)]"
                    : ""
                }`}
              >
                <div>
                  {plan.highlighted && (
                    <span className="absolute -top-3 right-5 bg-mint-500 text-ink-950 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-[0.1em]">
                      Popular
                    </span>
                  )}
                  <h3 className="text-lg font-semibold text-ink-50 mb-4">
                    {plan.name}
                  </h3>
                  <div className="flex items-baseline gap-1.5 mb-6">
                    <span className="font-[family-name:var(--font-display)] font-bold text-[36px] leading-none tracking-[-0.02em] text-ink-50">
                      {plan.price}
                    </span>
                    <span className="text-xs text-ink-500">{plan.period}</span>
                  </div>
                  <ul className="list-none flex flex-col gap-3 mb-8">
                    {plan.features.map((f) => (
                      <li
                        key={f}
                        className="flex items-center gap-2.5 text-sm text-ink-300"
                      >
                        <CheckCircle2
                          size={14}
                          className="text-mint-400 shrink-0"
                        />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Link
                  href="/login"
                  className={`${
                    plan.highlighted ? "cm-btn-primary" : "cm-btn-ghost"
                  } w-full py-2.5 text-sm`}
                >
                  <span>{plan.cta}</span>
                  <ArrowRight size={14} />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </SectionReveal>

      {/* ═══ 7. FAQ — AnimatePresence accordion ═══ */}
      <SectionReveal className="py-24 sm:py-32 px-6 bg-ink-900/40 border-y border-white/5">
        <div id="faq" className="max-w-2xl mx-auto scroll-mt-28">
          <p className="cm-eyebrow text-mint-300 text-center mb-4">FAQ</p>
          <h2 className="text-center text-[clamp(32px,4.5vw,52px)] font-bold leading-[1.08] tracking-[-0.02em] text-ink-50 mb-4">
            Straight answers.
          </h2>
          <p className="section-subheading">
            We won't invent testimonials — the product has no users yet. So the
            answers below are the whole pitch: formats, limits, watermark
            policy and the refund window, in the open.
          </p>
          <FaqAccordion items={FAQS} />
        </div>
      </SectionReveal>

      {/* ═══ 8. FINAL CTA (identity §9.10) ═══ */}
      <SectionReveal className="py-16 sm:py-24 px-6">
        <div className="max-w-4xl mx-auto rounded-3xl bg-ink-850 border border-mint-500/30 shadow-[var(--shadow-accent)] p-10 md:p-14 text-center flex flex-col items-center gap-5">
          <h2 className="text-[clamp(28px,4vw,44px)] font-bold tracking-[-0.02em] leading-[1.08] text-ink-50">
            Shuru karo. <span className="text-mint-400">Free hai.</span>
          </h2>
          <p className="text-ink-300 text-base leading-[1.6] max-w-md">
            5 clips a month, free forever. Upgrade when it earns its keep.
          </p>
          {loading ? (
            <div className="h-[52px] w-52 skeleton rounded-xl" />
          ) : user ? (
            <Link href="/dashboard" className="cm-btn-primary py-3.5 px-8 text-base">
              <Upload size={17} />
              <span>Go to Dashboard</span>
            </Link>
          ) : (
            <Link href="/login" className="cm-btn-primary py-3.5 px-8 text-base">
              <Sparkles size={17} />
              <span>Start free — no card</span>
            </Link>
          )}
        </div>
      </SectionReveal>

      <Footer />
    </main>
  );
}
