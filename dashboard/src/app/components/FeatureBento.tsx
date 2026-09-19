"use client";

import { Brain, Languages, Zap, AudioLines, Maximize, Key } from "lucide-react";
import { SectionReveal, StaggerGroup, StaggerItem } from "./SectionReveal";

/**
 * Identity §9.6 — six-cell mixed-size feature bento on a 6-column grid:
 * 4+2 / 2+2+2 / 6. Real capability copy only (no traction claims).
 * Hover = lift −2px + mint border + --shadow-lift via .cm-card (§6 model).
 */

const CELLS = [
  {
    icon: <Brain size={20} />,
    span: "md:col-span-4",
    title: "AI moment detection",
    desc: "Transcripts get scored for hooks, payoffs and energy peaks. Boundaries snap to speech pauses and scene cuts, so clips start on words — not mid-sentence.",
  },
  {
    icon: <Languages size={20} />,
    span: "md:col-span-2",
    title: "9 animated caption styles",
    desc: "Rendered with Remotion, not flat text. Hormozi, Bounce, Typewriter, Glow and five more — pick per clip or per project.",
  },
  {
    icon: <Zap size={20} />,
    span: "md:col-span-2",
    title: "Face-tracked 1080×1920",
    desc: "The speaker stays centered as the camera moves. Landscape sources reframe to true vertical — no letterbox bars.",
  },
  {
    icon: <AudioLines size={20} />,
    span: "md:col-span-2",
    title: "−14 LUFS audio",
    desc: "Every clip is measured and normalised to the loudness Reels, Shorts and TikTok expect, with denoise when the source needs it.",
  },
  {
    icon: <Maximize size={20} />,
    span: "md:col-span-2",
    title: "Multi-format output",
    desc: "9:16 for Reels, Shorts and TikTok, with titles, hashtags and thumbnails attached per platform.",
  },
  {
    icon: <Key size={20} />,
    span: "md:col-span-6",
    title: "API access",
    desc: "Submit videos, poll status and pull finished clips programmatically. Full REST API on Pro and Agency plans.",
    code: "POST /v1/clips",
  },
];

export default function FeatureBento() {
  return (
    <SectionReveal className="py-24 sm:py-32 px-6 bg-ink-900/40 border-y border-white/5">
      <div id="features" className="max-w-6xl mx-auto scroll-mt-28">
        <p className="cm-eyebrow text-mint-300 text-center mb-4">Capabilities</p>
        <h2 className="text-center text-[clamp(32px,4.5vw,52px)] font-bold leading-[1.08] tracking-[-0.02em] text-ink-50 mb-4">
          What the pipeline delivers.
        </h2>
        <p className="section-subheading">
          No magic claims — just what happens between your upload and a
          post-ready clip, stated plainly.
        </p>

        <StaggerGroup className="grid grid-cols-1 md:grid-cols-6 gap-4 mt-16">
          {CELLS.map((cell) => (
            <StaggerItem key={cell.title} className={cell.span}>
              <div className="cm-card h-full p-6 sm:p-7 flex flex-col gap-4">
                <div className="w-11 h-11 rounded-xl bg-mint-500/10 border border-mint-500/20 flex items-center justify-center text-mint-400 shrink-0">
                  {cell.icon}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-lg sm:text-xl font-semibold tracking-[-0.01em] text-ink-50">
                      {cell.title}
                    </h3>
                    {cell.code && (
                      <span className="font-[family-name:var(--font-mono)] text-[12px] text-mint-300 bg-mint-500/10 border border-mint-500/20 rounded-lg px-2.5 py-1">
                        {cell.code}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-[15px] leading-[1.6] text-ink-300">
                    {cell.desc}
                  </p>
                </div>
              </div>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </SectionReveal>
  );
}
