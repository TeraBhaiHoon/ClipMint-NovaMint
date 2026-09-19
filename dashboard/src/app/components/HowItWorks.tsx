"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll } from "framer-motion";
import { Upload, Brain, Download } from "lucide-react";
import { SectionReveal, StaggerGroup, StaggerItem } from "./SectionReveal";

/**
 * Identity §9.4 — three pipeline steps with a scroll-drawn vertical
 * connector: framer-motion scaleY tied to this section's scroll progress,
 * mint-500/40. Icons are static lucide-react (registry fallback rule, §7).
 * Copy states the pipeline plainly: transcribe → score → clip → render.
 */

const STEPS = [
  {
    icon: <Upload size={22} />,
    step: "01",
    title: "Paste or drop your video",
    desc: "Bring an MP4, MOV or WebM file up to 500MB, or paste a YouTube, Instagram or Google Drive link. The pipeline transcribes your audio first.",
  },
  {
    icon: <Brain size={22} />,
    step: "02",
    title: "AI finds the moments",
    desc: "The transcript is scored for hooks, payoffs and energy peaks. Clip boundaries snap to natural speech pauses and scene cuts — never mid-sentence.",
  },
  {
    icon: <Download size={22} />,
    step: "03",
    title: "Download & post",
    desc: "Clips render face-tracked at 1080×1920 with animated captions, normalised to −14 LUFS. Titles, hashtags and thumbnails come attached.",
  },
];

export default function HowItWorks() {
  const railRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: railRef,
    offset: ["start 0.8", "end 0.55"],
  });

  return (
    <SectionReveal className="py-24 sm:py-32 px-6">
      <div id="how-it-works" className="max-w-6xl mx-auto scroll-mt-28">
        <p className="cm-eyebrow text-mint-300 text-center mb-4">How it works</p>
        <h2 className="text-center text-[clamp(32px,4.5vw,52px)] font-bold leading-[1.08] tracking-[-0.02em] text-ink-50 mb-4">
          Three steps. Zero editing.
        </h2>
        <p className="section-subheading">
          Transcribe, score, clip, render captions — the pipeline runs in that
          order, every time.
        </p>

        <div ref={railRef} className="relative max-w-2xl mx-auto mt-16">
          {/* Rail: base line + scroll-drawn mint line */}
          <div
            className="absolute left-[27.5px] top-6 bottom-6 w-px bg-white/5"
            aria-hidden="true"
          />
          <motion.div
            className="absolute left-[27.5px] top-6 bottom-6 w-px bg-mint-500/40 origin-top"
            style={{ scaleY: reduced ? 1 : scrollYProgress }}
            aria-hidden="true"
          />

          <StaggerGroup className="flex flex-col gap-12">
            {STEPS.map((item) => (
              <StaggerItem key={item.step}>
                <div className="relative flex items-start gap-6">
                  <div className="relative z-10 shrink-0 w-14 h-14 rounded-2xl bg-ink-850 border border-mint-500/25 flex items-center justify-center text-mint-400">
                    {item.icon}
                  </div>
                  <div className="pt-1">
                    <span className="cm-eyebrow text-ink-500">Step {item.step}</span>
                    <h3 className="mt-1.5 text-xl font-semibold tracking-[-0.01em] text-ink-50">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-[15px] leading-[1.6] text-ink-300">
                      {item.desc}
                    </p>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </StaggerGroup>
        </div>
      </div>
    </SectionReveal>
  );
}
