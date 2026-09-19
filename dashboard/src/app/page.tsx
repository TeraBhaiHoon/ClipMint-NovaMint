import Link from "next/link";
import { PLAN_LIMITS, CAPTION_STYLES, type Plan } from "@/lib/types";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import ScrollProgress from "./components/ScrollProgress";
import { HeroGroup, HeroItem } from "./components/HeroMotion";
import { SectionReveal, StaggerGroup, StaggerItem } from "./components/SectionReveal";
import SectionHeading from "./components/SectionHeading";
import ShowcaseCarousel from "./components/ShowcaseCarousel";
import HowItWorks from "./components/HowItWorks";
import FeatureBento from "./components/FeatureBento";
import StyleMarquee from "./components/StyleMarquee";
import CountUp from "./components/CountUp";
import FaqAccordion, { type FaqItem } from "./components/FaqAccordion";
import CtaButtons from "./components/CtaButtons";
import PhonePreview from "./components/PhonePreview";
import {
  IconSpark,
  IconPlay,
  IconCheck,
  IconArrowRight,
  IconUpload,
  IconMaximize,
  IconFilm,
  IconCut,
  IconLock,
  IconClock,
} from "./components/Icons";

/* ─── FAQ — real questions, honest answers ─── */
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

/* ─── Pricing — derived from PLAN_LIMITS (paise → rupees), never hardcoded ─── */
type PlanCard = {
  key: Plan;
  name: string;
  price: string;
  period: string;
  tagline: string;
  features: string[];
  highlighted: boolean;
  cta: string;
};

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;

const PLANS: PlanCard[] = [
  {
    key: "free",
    name: PLAN_LIMITS.free.label,
    price: inr(PLAN_LIMITS.free.monthlyPrice),
    period: "forever",
    tagline: "See it work before you pay.",
    features: [
      `${PLAN_LIMITS.free.clips} clips/month`,
      `${PLAN_LIMITS.free.videos} videos/month`,
      "720p output",
      "ClipMint watermark",
      "3 caption styles",
    ],
    highlighted: false,
    cta: "Start free",
  },
  {
    key: "creator",
    name: PLAN_LIMITS.creator.label,
    price: inr(PLAN_LIMITS.creator.monthlyPrice),
    period: "/month",
    tagline: "For creators posting every day.",
    features: [
      `${PLAN_LIMITS.creator.clips} clips/month`,
      `${PLAN_LIMITS.creator.videos} videos/month`,
      "1080p output",
      "No watermark",
      "All 9 caption styles",
      "Priority processing",
      "API access",
      "Email support",
    ],
    highlighted: true,
    cta: "Start free trial",
  },
  {
    key: "pro",
    name: PLAN_LIMITS.pro.label,
    price: inr(PLAN_LIMITS.pro.monthlyPrice),
    period: "/month",
    tagline: "Max resolution, no limits you'll hit.",
    features: [
      `${PLAN_LIMITS.pro.clips} clips/month`,
      `${PLAN_LIMITS.pro.videos} videos/month`,
      "4K output",
      "Priority processing",
      "API access",
    ],
    highlighted: false,
    cta: "Subscribe now",
  },
  {
    key: "agency",
    name: PLAN_LIMITS.agency.label,
    price: inr(PLAN_LIMITS.agency.monthlyPrice),
    period: "/month",
    tagline: "White-label, teams, and pipelines.",
    features: [
      "Unlimited clips",
      "Unlimited videos",
      "White-label",
      "Team accounts",
      "n8n integration",
    ],
    highlighted: false,
    cta: "Contact sales",
  },
];

/* ─── Pipeline spec — real capabilities, stated as numbers ─── */
const SPECS = [
  {
    icon: IconUpload,
    label: "Input",
    value: "MP4 · MOV · WebM, up to 500MB — or paste a YouTube, Instagram or Google Drive link.",
  },
  {
    icon: IconMaximize,
    label: "Output",
    value: "9:16 · 1080×1920 face-tracked vertical, loudness-normalised to −14 LUFS.",
  },
  {
    icon: IconFilm,
    label: "Modes",
    value: "Viral clips from your energy peaks, or caption the whole video — chosen per job.",
  },
  {
    icon: IconCut,
    label: "Auto-editing",
    value: "Silence cuts, punch-ins on the speaker, and boundaries snapped to speech pauses.",
  },
  {
    icon: IconLock,
    label: "Delivery",
    value: "Finished clips delivered over private R2 links, with titles, hashtags and thumbnails attached.",
  },
  {
    icon: IconClock,
    label: "Speed",
    value: "Most long videos finish processing in 5–15 minutes.",
  },
];

/* ═══ Main page — server component, client islands only where needed ═══ */
export default function HomePage() {
  return (
    <main className="overflow-x-clip min-h-screen bg-ink-950 text-ink-50">
      <Navbar />
      <ScrollProgress />

      {/* ═══ 1 · HERO — layered ink, staggered entrance ═══ */}
      <section className="relative overflow-hidden px-6 pt-36 pb-16 md:pt-44 md:pb-24">
        <div aria-hidden="true" className="hero-dots absolute inset-0" />
        <div aria-hidden="true" className="hero-orb orb-mint" style={{ width: 560, height: 560, top: -180, right: -140 }} />
        <div aria-hidden="true" className="hero-orb orb-warm" style={{ width: 480, height: 480, bottom: -200, left: -160 }} />

        <HeroGroup className="relative max-w-6xl mx-auto grid lg:grid-cols-[1.05fr_0.95fr] gap-14 lg:gap-10 items-center w-full">
          <div className="flex flex-col items-center lg:items-start text-center lg:text-left gap-6">
            <HeroItem index={0}>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-mint-500/10 border border-mint-500/25 text-xs font-semibold text-mint-300">
                <IconSpark className="w-3.5 h-3.5" />
                Now in open beta · Free plan, no card
              </div>
            </HeroItem>

            <HeroItem index={1}>
              <h1 className="text-[var(--fs-hero)] font-bold leading-[0.98] tracking-[-0.03em] text-ink-50">
                Ek video. <span className="grad-mint-text">Das clips.</span>
              </h1>
              <p className="mt-5 text-[clamp(21px,2.8vw,34px)] font-semibold tracking-[-0.02em] text-ink-300 leading-snug">
                Cut, captioned, <span className="text-ink-50">platform-ready.</span>
              </p>
            </HeroItem>

            <HeroItem index={2}>
              <p className="text-[var(--fs-lg)] text-ink-300 leading-[1.6] max-w-xl">
                Upload a podcast, vlog or lecture. ClipMint finds the moments
                worth posting and adds animated captions that look studio-made —
                in minutes.
              </p>
            </HeroItem>

            <HeroItem index={3}>
              <div className="flex flex-col sm:flex-row gap-3.5 w-full sm:w-auto mt-1">
                <CtaButtons size="lg" />
                <a href="#how-it-works" className="cm-btn-ghost py-4 px-9 text-base">
                  <IconPlay className="w-[17px] h-[17px]" />
                  See how it works
                </a>
              </div>
            </HeroItem>

            <HeroItem index={4}>
              <p className="text-[13px] font-medium text-ink-500">
                MP4 · MOV · WebM · up to 500MB · YouTube / Instagram / Drive links
              </p>
            </HeroItem>
          </div>

          <HeroItem index={2} className="flex justify-center lg:justify-end">
            <PhonePreview />
          </HeroItem>
        </HeroGroup>
      </section>

      {/* ═══ 2 · PLATFORM STRIP — capability claim, not adoption claim ═══ */}
      <SectionReveal className="py-10 border-y border-[var(--border-faint)] bg-[var(--bg-void)]">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="cm-eyebrow text-ink-500 mb-6">Made for Reels, Shorts &amp; TikTok</p>
          <div className="flex flex-wrap justify-center items-center gap-x-8 gap-y-3">
            {["Instagram Reels", "YouTube Shorts", "TikTok"].map((platform, i) => (
              <div key={platform} className="flex items-center gap-8">
                {i > 0 && <span className="hidden sm:block w-1 h-1 rounded-full bg-mint-500 shrink-0" aria-hidden="true" />}
                <span className="text-lg md:text-2xl font-[family-name:var(--font-display)] font-bold tracking-tight text-ink-200">
                  {platform}
                </span>
              </div>
            ))}
          </div>
        </div>
      </SectionReveal>

      {/* ═══ 3 · THE SHOWCASE — finished clips, the centerpiece ═══ */}
      <SectionReveal className="py-24 sm:py-32 px-6 relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute -left-40 top-20 w-[460px] h-[460px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(57,229,8,0.07), transparent 70%)", filter: "blur(60px)" }}
        />
        <div id="showcase" className="relative max-w-[1180px] mx-auto scroll-mt-28">
          <SectionHeading
            kicker="The showcase"
            title={<>Finished clips. <span className="grad-mint-text">Straight out of rendering.</span></>}
            subtitle="Reserved slots hold generated poster art until your clips land. Drag to browse, hover to play — every card is a real 9:16 master."
          />
          <ShowcaseCarousel />
        </div>
      </SectionReveal>

      {/* ═══ 4 · UNDER THE HOOD — the spec, stated plainly ═══ */}
      <SectionReveal className="py-24 sm:py-32 px-6 bg-[var(--bg-void)] border-y border-[var(--border-faint)]">
        <div id="pipeline" className="max-w-4xl mx-auto scroll-mt-28">
          <SectionHeading
            kicker="Under the hood"
            title={<>The spec, <span className="grad-mint-text">in the open.</span></>}
            subtitle="Everything the render engine actually does — numbers, not adjectives."
          />
          <div className="cm-card">
            <dl className="divide-y divide-[var(--border-faint)] px-6 sm:px-8 py-2">
              {SPECS.map((spec) => {
                const Icon = spec.icon;
                return (
                  <div
                    key={spec.label}
                    className="grid grid-cols-1 sm:grid-cols-[210px_1fr] gap-y-1.5 sm:gap-x-8 sm:items-baseline py-5"
                  >
                    <dt className="flex items-center gap-2.5 font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.12em] text-ink-400 pt-0.5">
                      <Icon className="w-4 h-4 text-mint-400 shrink-0" />
                      {spec.label}
                    </dt>
                    <dd className="text-[15px] text-ink-200 leading-relaxed">{spec.value}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </div>
      </SectionReveal>

      {/* ═══ 5 · HOW IT WORKS — scroll-drawn rail ═══ */}
      <HowItWorks />

      {/* ═══ 6 · CAPTION STYLES — the one loop + counters ═══ */}
      <SectionReveal className="py-24 sm:py-32 px-6">
        <div id="styles" className="max-w-6xl mx-auto scroll-mt-28">
          <SectionHeading
            kicker="Caption engine"
            title={<>Captions that <span className="grad-mint-text">do the talking.</span></>}
            subtitle="Nine animated styles rendered with Remotion — the same engine that paints your clips, mint highlights included."
          />

          <StyleMarquee />

          {/* Real figures only */}
          <div className="grid grid-cols-3 gap-6 max-w-2xl mx-auto text-center border-y border-[var(--border-faint)] py-7 mb-14">
            <div>
              <CountUp value="9" className="stat-num text-2xl sm:text-3xl" />
              <div className="cm-eyebrow text-ink-500 mt-2">Caption styles</div>
            </div>
            <div>
              <CountUp value="1080×1920" className="stat-num text-2xl sm:text-3xl" />
              <div className="cm-eyebrow text-ink-500 mt-2">Face-tracked output</div>
            </div>
            <div>
              <CountUp value="−14 LUFS" className="stat-num text-2xl sm:text-3xl grad-mint-text" />
              <div className="cm-eyebrow text-ink-500 mt-2">Loudness target</div>
            </div>
          </div>

          {/* Style registry */}
          <StaggerGroup className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {CAPTION_STYLES.map((style) => (
              <StaggerItem key={style.value}>
                <div className="cm-card px-6 py-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-ink-50">{style.label}</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-mint-500 shrink-0" aria-hidden="true" />
                  </div>
                  <p className="mt-2 text-[13px] leading-snug text-ink-400">{style.description}</p>
                </div>
              </StaggerItem>
            ))}
          </StaggerGroup>
        </div>
      </SectionReveal>

      {/* ═══ 7 · FEATURE BENTO ═══ */}
      <FeatureBento />

      {/* ═══ 8 · PRICING — from PLAN_LIMITS, nothing hardcoded ═══ */}
      <SectionReveal className="py-24 sm:py-32 px-6">
        <div id="pricing" className="max-w-6xl mx-auto scroll-mt-28">
          <SectionHeading
            kicker="Pricing"
            title={<>Simple pricing. <span className="grad-mint-text">Stated up front.</span></>}
            subtitle="Start free. Every limit, the watermark policy and the 7-day refund window are listed right here — nothing hidden below the fold."
          />

          <StaggerGroup className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 items-stretch">
            {PLANS.map((plan) => (
              <StaggerItem key={plan.key} className="h-full">
                <div
                  className="cm-card relative p-7 flex flex-col h-full"
                  style={
                    plan.highlighted
                      ? { borderColor: "rgba(57,229,8,0.55)", boxShadow: "var(--shadow-accent), var(--shadow-lift)" }
                      : undefined
                  }
                >
                  {plan.highlighted && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-mint-500 text-ink-950 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.12em]">
                      Popular
                    </span>
                  )}
                  <div className="flex flex-col gap-1 mb-6">
                    <h3 className="text-lg font-semibold text-ink-50">{plan.name}</h3>
                    <p className="text-[13px] text-ink-500">{plan.tagline}</p>
                  </div>
                  <div className="flex items-baseline gap-1.5 mb-6">
                    <span className="stat-num text-[36px] leading-none">{plan.price}</span>
                    <span className="text-xs text-ink-500">{plan.period}</span>
                  </div>
                  <ul className="list-none flex flex-col gap-2.5 mb-8 flex-1">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5 text-sm text-ink-300">
                        <IconCheck className="w-4 h-4 text-mint-400 mt-0.5 shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/login"
                    className={`${plan.highlighted ? "cm-btn-primary" : "cm-btn-ghost"} w-full justify-center py-3 text-sm`}
                  >
                    {plan.cta}
                    <IconArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </StaggerItem>
            ))}
          </StaggerGroup>

          <p className="text-center text-[13px] text-ink-500 mt-8">
            Prices in INR, billed monthly. Annual billing and the full comparison table live on the{" "}
            <Link href="/pricing" className="text-mint-300 underline decoration-mint-500/40 underline-offset-4 hover:text-mint-200">
              pricing page
            </Link>
            .
          </p>
        </div>
      </SectionReveal>

      {/* ═══ 9 · FAQ — honest answers to real questions ═══ */}
      <SectionReveal className="py-24 sm:py-32 px-6 bg-[var(--bg-void)] border-y border-[var(--border-faint)]">
        <div id="faq" className="max-w-2xl mx-auto scroll-mt-28">
          <SectionHeading
            kicker="FAQ"
            title={<>Straight <span className="grad-mint-text">answers.</span></>}
            subtitle="We won't invent testimonials — the product has no users yet. So the answers below are the whole pitch: formats, limits, watermark policy and the refund window, in the open."
          />
          <FaqAccordion items={FAQS} />
        </div>
      </SectionReveal>

      {/* ═══ 10 · FINAL CTA ═══ */}
      <SectionReveal className="py-16 sm:py-24 px-6">
        <div className="cta-panel max-w-4xl mx-auto px-8 py-14 md:px-14 md:py-16 text-center flex flex-col items-center gap-5">
          <IconSpark className="w-7 h-7 text-mint-400" />
          <h2 className="text-[clamp(28px,4vw,44px)] font-bold tracking-[-0.02em] leading-[1.08] text-ink-50">
            Shuru karo. <span className="grad-mint-text">Free hai.</span>
          </h2>
          <p className="text-ink-300 text-base leading-[1.6] max-w-md">
            5 clips a month, free forever. Upgrade when it earns its keep.
          </p>
          <CtaButtons size="lg" />
        </div>
      </SectionReveal>

      <Footer />
    </main>
  );
}