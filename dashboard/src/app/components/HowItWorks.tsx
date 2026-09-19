"use client";

import { useEffect, useRef, useState } from "react";
import { IconUpload, IconSpark, IconDownload } from "./Icons";
import { SectionReveal, StaggerGroup, StaggerItem, useReducedMotion } from "./SectionReveal";

/**
 * Three pipeline steps with a scroll-drawn rail: a mint line paints down
 * the connector as the section travels through the viewport. A rAF-driven
 * scroll listener computes the rail's progress from its bounding rect —
 * transform: scaleY only, nothing looped, static under reduced motion.
 */

const STEPS = [
  {
    icon: IconUpload,
    step: "01",
    title: "Paste or drop your video",
    desc: "Bring an MP4, MOV or WebM file up to 500MB, or paste a YouTube, Instagram or Google Drive link. The pipeline transcribes your audio first.",
  },
  {
    icon: IconSpark,
    step: "02",
    title: "AI finds the moments",
    desc: "The transcript is scored for hooks, payoffs and energy peaks. Clip boundaries snap to natural speech pauses and scene cuts — never mid-sentence.",
  },
  {
    icon: IconDownload,
    step: "03",
    title: "Download & post",
    desc: "Clips render face-tracked at 1080×1920 with animated captions, normalised to −14 LUFS. Titles, hashtags and thumbnails come attached.",
  },
];

export default function HowItWorks() {
  const railRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [progress, setProgress] = useState(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      setProgress(1);
      return;
    }
    let raf = 0;
    const measure = () => {
      const rail = railRef.current;
      if (!rail) return;
      const rect = rail.getBoundingClientRect();
      const vh = window.innerHeight;
      const start = vh * 0.82; // rail head enters view
      const end = vh * 0.5;    // rail tail settles near mid-viewport
      const raw = (start - rect.top) / (start - end);
      setProgress(Math.min(1, Math.max(0, raw)));
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [reduced]);

  return (
    <SectionReveal className="py-24 sm:py-32 px-6 relative overflow-hidden">
      <div
        aria-hidden="true"
        className="hero-dots absolute inset-0"
      />
      <div id="how-it-works" className="relative max-w-6xl mx-auto scroll-mt-28">
        <div className="flex flex-col items-center text-center mb-16">
          <p className="kicker kicker-center mb-4">How it works</p>
          <h2 className="text-[var(--fs-h2)] font-bold leading-[1.06] tracking-[-0.02em] text-ink-50 mb-5 max-w-xl">
            Three steps. <span className="grad-mint-text">Zero editing.</span>
          </h2>
          <p className="section-subheading" style={{ marginBottom: 0 }}>
            Transcribe, score, clip, render captions — the pipeline runs in
            that order, every time. Most videos finish in 5–15 minutes.
          </p>
        </div>

        <div className="relative max-w-2xl mx-auto mt-16">
          {/* Rail */}
          <div className="step-rail" aria-hidden="true" ref={railRef} />
          <div
            className="step-rail-fill"
            aria-hidden="true"
            style={{ transform: `scaleY(${progress})` }}
          />

          <StaggerGroup className="flex flex-col gap-12">
            {STEPS.map((item) => {
              const Icon = item.icon;
              return (
                <StaggerItem key={item.step}>
                  <div className="relative flex items-start gap-6">
                    <div className="relative z-10 shrink-0 w-14 h-14 rounded-2xl bg-[var(--surface-card)] border border-mint-500/25 flex items-center justify-center text-mint-400 shadow-[var(--shadow-rest)]">
                      <Icon className="w-[22px] h-[22px]" />
                    </div>
                    <div className="pt-1">
                      <span className="cm-eyebrow text-ink-500">
                        Step {item.step}
                      </span>
                      <h3 className="mt-1.5 text-xl font-semibold tracking-[-0.01em] text-ink-50">
                        {item.title}
                      </h3>
                      <p className="mt-2 text-[15px] leading-[1.65] text-ink-300 max-w-md">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                </StaggerItem>
              );
            })}
          </StaggerGroup>
        </div>
      </div>
    </SectionReveal>
  );
}