import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, AudioLines, Captions, Check, CheckCircle2, ChevronRight, Film, Focus, Link2, Scissors, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { CAPTION_STYLES, PLAN_LIMITS, type Plan } from "@/lib/types";
import HomeNavigation from "./components/HomeNavigation";
import { CaptionStudioPreview, HomeDemoVideo } from "./components/HomePreview";
import CtaButtons from "./components/CtaButtons";
import "./home.css";

const FAQS = [
    { question: "Can I try ClipMint without paying?", answer: "Yes. The Free plan includes 5 clips and 2 videos per 30-day usage window. No card is needed to start. Free clips carry a ClipMint watermark; paid plans remove it." },
    { question: "What kind of videos can I use?", answer: "Podcasts, interviews, vlogs, lessons, and other videos with spoken content are good starting points. Upload an MP4, MOV, M4V, or WebM file up to 2 GB, or use a YouTube, Instagram, Facebook, or Google Drive link." },
    { question: "How long does processing take?", answer: "Most videos take around 5–15 minutes. Longer sources and busy periods can take more time. You can check progress in your workspace without keeping the page open." },
    { question: "Can I caption the entire video instead?", answer: "Yes. Choose Full video captions when creating a project. You can also enable pause removal and dynamic punch-ins for that mode." },
    { question: "Does my plan renew automatically?", answer: "No. Paid plans use one-time payments. A monthly pass provides 30 days of access; annual pricing is also available. When the pass expires, Free limits apply, and your existing clips stay in your library." },
    { question: "What is the refund policy?", answer: "There is a 7-day refund window from the date of purchase. Contact ClipMint.Billing@gmail.com if the service does not meet your expectations. The full policy is linked below." },
];
const STEPS = [
    { number: "01", title: "Bring your video.", description: "Paste a link or upload a file. Choose short clips or captions for the full video.", icon: Upload },
    { number: "02", title: "Choose your look.", description: "Pick a caption style, reading pace, and background music. Make each project feel like you.", icon: Captions },
    { number: "03", title: "Download. Post. Repeat.", description: "Your finished clips land in your workspace, alongside captions, hashtags, and thumbnails.", icon: Film },
];
const PLAN_CONTENT: Record<Plan, { description: string; features: string[]; cta: string; href: string }> = {
    free: { description: "Get a feel for your next workflow.", features: ["Try the clipping workflow", "ClipMint watermark", "No payment to start"], cta: "Start free", href: "/login" },
    creator: { description: "For a steady flow of new content.", features: ["Watermark-free clips", "All caption styles", "API access"], cta: "Explore Creator", href: "/pricing" },
    pro: { description: "More clips for a bigger content library.", features: ["Watermark-free clips", "All caption styles", "API access"], cta: "Explore Pro", href: "/pricing" },
    agency: { description: "For high-volume content workflows.", features: ["High-volume clip quota", "Watermark-free clips", "API access"], cta: "Talk to us", href: "/contact" },
};
const FOOTER_LINKS = [
    { label: "Product", links: [{ label: "Features", href: "/features" }, { label: "Pricing", href: "/pricing" }, { label: "API keys", href: "/dashboard/api-keys" }] },
    { label: "Company", links: [{ label: "About ClipMint", href: "/about" }, { label: "Contact", href: "/contact" }] },
    { label: "The details", links: [{ label: "Privacy", href: "/privacy-policy" }, { label: "Terms", href: "/terms" }, { label: "Refund policy", href: "/refund-policy" }] },
];

export default function HomePage() {
    return <div className="home-page" data-zcode-design="clipmint-home">
        <a className="home-skip" href="#home-content">Skip to content</a>
        <HomeNavigation />
        <main id="home-content">
            <section className="home-hero">
                <div className="home-container home-hero-grid">
                    <div className="home-hero-copy">
                        <p className="home-eyebrow"><span className="home-status-dot" />Less editing. More creating.</p>
                        <h1>Ek video.<br /><span>More stories.</span></h1>
                        <p className="home-hero-subtitle">Your best moments.<br />Ready for the feed.</p>
                        <p className="home-hero-description">Turn your podcasts, interviews, and long videos into captioned clips. ClipMint finds the moments. You make them yours.</p>
                        <div className="home-hero-actions"><CtaButtons size="lg" /><a className="home-button home-button--outline" href="#showcase">See the output<ArrowDown size={17} aria-hidden="true" /></a></div>
                        <p className="home-hero-assurance"><CheckCircle2 size={16} aria-hidden="true" />5 clips free · no credit card · upgrade when you’re ready</p>
                    </div>
                    <div className="home-hero-visual"><CaptionStudioPreview /><div className="home-visual-caption"><span><span className="home-live-dot" />A look that feels like you</span><a href="#styles">Explore the styles<ChevronRight size={14} aria-hidden="true" /></a></div></div>
                </div>
                <div className="home-container home-platform-strip"><span>One edit. Three places to share.</span><div><strong>Instagram Reels</strong><i aria-hidden="true" /><strong>YouTube Shorts</strong><i aria-hidden="true" /><strong>TikTok</strong></div></div>
            </section>

            <section id="showcase" className="home-section home-output">
                <div className="home-container home-output-grid">
                    <div className="home-output-copy"><p className="home-eyebrow">The output, not the promise</p><h2>Made to leave<br /><span>the editing room.</span></h2><p className="home-section-description">A real vertical render, ready to watch. No pretend showcase cards—just an example of the format your clips are made for.</p><ul className="home-output-details"><li><Focus size={20} aria-hidden="true" /><div><strong>Built for vertical screens</strong><span>A 9:16 frame for the short-form feed.</span></div></li><li><Captions size={20} aria-hidden="true" /><div><strong>Captions with character</strong><span>Choose the style and pace for your content.</span></div></li><li><AudioLines size={20} aria-hidden="true" /><div><strong>Speech stays the star</strong><span>Music is mixed beneath the voice.</span></div></li></ul><p className="home-demo-disclaimer">The sample uses licensed Sintel footage to demonstrate the rendered format. The interactive hero above is a caption-style illustration, not a customer result.</p></div>
                    <HomeDemoVideo />
                </div>
            </section>

            <section id="features" className="home-section home-features">
                <div className="home-container"><div className="home-section-heading home-section-heading--split"><div><p className="home-eyebrow">Keep the good parts</p><h2>Less timeline.<br /><span>More storytelling.</span></h2></div><p className="home-section-description">A focused workflow from a long recording to a library of moments worth sharing.</p></div>
                    <div className="home-feature-layout">
                        <article className="home-feature-main"><span className="home-feature-icon"><Scissors size={25} aria-hidden="true" /></span><div><p className="home-eyebrow">Find the moment</p><h3>There’s a good clip<br />in that long video.</h3><p>AI reviews your transcript for hooks, payoffs, and energy. Clip boundaries snap to natural speech pauses.</p></div><div className="home-moment-strip" aria-label="Illustration of selected video moments"><span /><span /><span className="is-chosen"><Check size={16} aria-hidden="true" />The moment</span><span /><span /></div><small>Illustrated selection · not a live analysis</small></article>
                        <div className="home-feature-side"><article><Focus size={22} aria-hidden="true" /><h3>Keep the speaker in frame.</h3><p>Face-tracked vertical framing puts the person, not the empty space, at the center.</p></article><article><Captions size={22} aria-hidden="true" /><h3>Give every word a look.</h3><p>Nine caption styles, from bold highlights to quiet, minimal text.</p></article></div>
                        <div className="home-feature-footer"><article><Link2 size={20} aria-hidden="true" /><div><h3>Link it or drop it.</h3><p>YouTube, Drive, or an upload up to 2 GB.</p></div></article><article><ShieldCheck size={20} aria-hidden="true" /><div><h3>Your work, in your workspace.</h3><p>Download your clips through private delivery links.</p></div></article><article><Sparkles size={20} aria-hidden="true" /><div><h3>One video, fully captioned.</h3><p>Prefer the whole recording? There’s a mode for that.</p></div></article></div>
                    </div>
                </div>
            </section>

            <section id="how-it-works" className="home-section home-workflow"><div className="home-container"><div className="home-section-heading"><p className="home-eyebrow">From video to ready</p><h2>Three steps.<br className="home-mobile-break" /> One less thing to do.</h2></div><ol className="home-steps">{STEPS.map((step) => <li key={step.number}><div className="home-step-top"><span>{step.number}</span><step.icon size={22} aria-hidden="true" /></div><h3>{step.title}</h3><p>{step.description}</p></li>)}</ol><div className="home-workflow-note"><span>Most videos take 5–15 minutes. Longer sources can take more time.</span><Link href="/login">Try it with your video<ArrowRight size={16} aria-hidden="true" /></Link></div></div></section>

            <section id="styles" className="home-section home-styles"><div className="home-container home-styles-layout"><div><p className="home-eyebrow">Caption personality</p><h2>Same story.<br /><span>Your signature.</span></h2><p className="home-section-description">Bold, soft, snappy, or understated. Pick the caption style that belongs with your content.</p><Link href="/dashboard/new" className="home-button home-button--outline">Choose your look<ArrowRight size={17} aria-hidden="true" /></Link></div><div className="home-style-grid">{CAPTION_STYLES.map((style) => <article key={style.value}><span className={`home-style-sample home-style-sample--${style.value}`} aria-hidden="true">Make it <em>count.</em></span><h3>{style.label}</h3><p>{style.description}</p></article>)}</div></div></section>

            <section id="pricing" className="home-section home-pricing"><div className="home-container"><div className="home-section-heading home-section-heading--split"><div><p className="home-eyebrow">Start small. Make more.</p><h2>Room for your<br /><span>next chapter.</span></h2></div><div><p className="home-section-description">Try the workflow for free. Paid passes are one-time purchases—no automatic renewal.</p><Link className="home-inline-link" href="/pricing">Full plan comparison<ArrowRight size={16} aria-hidden="true" /></Link></div></div><div className="home-plans">{(["free", "creator", "pro", "agency"] as Plan[]).map((key) => {
                    const plan = PLAN_LIMITS[key]; const copy = PLAN_CONTENT[key];
                    return <article className={`home-plan ${key === "creator" ? "home-plan--featured" : ""}`} key={key}><div className="home-plan-title"><h3>{plan.label}</h3>{key === "creator" && <span>Popular</span>}</div><p className="home-plan-description">{copy.description}</p><div className="home-plan-price"><strong>₹{(plan.monthlyPrice / 100).toLocaleString("en-IN")}</strong><span>{key === "free" ? "free forever" : "per 30-day pass"}</span></div><ul><li><Check size={16} aria-hidden="true" /><span>{plan.clips.toLocaleString("en-IN")} clips per period</span></li><li><Check size={16} aria-hidden="true" /><span>{plan.videos.toLocaleString("en-IN")} videos per period</span></li>{copy.features.map((feature) => <li key={feature}><Check size={16} aria-hidden="true" /><span>{feature}</span></li>)}</ul><Link href={copy.href} className={`home-button ${key === "creator" ? "home-button--primary" : "home-button--outline"}`}>{copy.cta}<ArrowRight size={16} aria-hidden="true" /></Link></article>;
                })}</div><p className="home-pricing-note">Prices in INR. Annual options and the 7-day refund policy are explained on the <Link href="/pricing">pricing page</Link>.</p></div></section>

            <section id="faq" className="home-section home-faq"><div className="home-container home-faq-layout"><div><p className="home-eyebrow">A few good questions</p><h2>Clear answers.<br /><span>No fine-print hunt.</span></h2><p className="home-section-description">Still have a question?<br /><Link href="/contact">Talk to us<ArrowRight size={16} aria-hidden="true" /></Link></p></div><div className="home-faq-list">{FAQS.map((faq) => <details key={faq.question}><summary>{faq.question}<span aria-hidden="true">+</span></summary><p>{faq.answer}</p></details>)}</div></div></section>

            <section className="home-closing"><div className="home-container home-closing-inner"><div><p className="home-eyebrow">You’ve already done the recording.</p><h2>Let’s make it<br />worth sharing.</h2><p>Start with 5 free clips. No card. No pressure.</p></div><div className="home-closing-action"><CtaButtons size="lg" /><span>Your next clip starts with one video.</span></div></div></section>
        </main>
        <footer className="home-footer"><div className="home-container"><div className="home-footer-main"><div className="home-footer-brand"><Link href="/" className="home-wordmark"><Image src="/logo-cm-128.png" alt="" width={32} height={32} /><span>ClipMint<span className="home-brand-dot">.</span></span></Link><p>Good moments deserve<br />a second life.</p><a href="mailto:ClipMint.Support@gmail.com">ClipMint.Support@gmail.com</a></div>{FOOTER_LINKS.map((column) => <div className="home-footer-column" key={column.label}><h2>{column.label}</h2><ul>{column.links.map((link) => <li key={link.href}><Link href={link.href}>{link.label}</Link></li>)}</ul></div>)}</div><div className="home-footer-bottom"><span>© 2026 NovaMint Networks</span><span>Made in India. Made for your next story.</span></div></div></footer>
    </div>;
}
