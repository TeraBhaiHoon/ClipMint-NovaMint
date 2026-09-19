import type { ComponentType, SVGProps } from "react";
import {
  IconSpark,
  IconCaptions,
  IconMaximize,
  IconWave,
  IconFilm,
  IconKey,
} from "./Icons";
import { SectionReveal, StaggerGroup, StaggerItem } from "./SectionReveal";

/**
 * Capabilities — an asymmetric six-cell bento (7/5, 4/4/4, 12). Real
 * product copy only: what happens between upload and post, stated plainly.
 * Custom line icons; hover lifts the card and wakes a mint corner glow.
 */

type Cell = {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  span: string;
  title: string;
  desc: string;
  code?: string;
};

const CELLS: Cell[] = [
  {
    icon: IconSpark,
    span: "md:col-span-7",
    title: "AI moment detection",
    desc: "Transcripts get scored for hooks, payoffs and energy peaks. Boundaries snap to speech pauses and scene cuts, so clips start on words — not mid-sentence.",
  },
  {
    icon: IconCaptions,
    span: "md:col-span-5",
    title: "9 animated caption styles",
    desc: "Rendered with Remotion, not flat text. Hormozi, Bounce, Typewriter, Glow and five more — pick per clip or per project.",
  },
  {
    icon: IconMaximize,
    span: "md:col-span-4",
    title: "Face-tracked 1080×1920",
    desc: "The speaker stays centered as the camera moves. Landscape sources reframe to true vertical — no letterbox bars.",
  },
  {
    icon: IconWave,
    span: "md:col-span-4",
    title: "−14 LUFS audio",
    desc: "Every clip is measured and normalised to the loudness Reels, Shorts and TikTok expect, with denoise when the source needs it.",
  },
  {
    icon: IconFilm,
    span: "md:col-span-4",
    title: "Multi-format output",
    desc: "9:16 for Reels, Shorts and TikTok, with titles, hashtags and thumbnails attached per platform.",
  },
  {
    icon: IconKey,
    span: "md:col-span-12",
    title: "API access",
    desc: "Submit videos, poll status and pull finished clips programmatically. Full REST API on Pro and Agency plans.",
    code: "POST /v1/clips",
  },
];

export default function FeatureBento() {
  return (
    <SectionReveal className="py-24 sm:py-32 px-6 bg-[var(--bg-void)] border-y border-[var(--border-faint)] relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute -top-40 right-[-160px] w-[420px] h-[420px] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(57,229,8,0.08), transparent 70%)",
          filter: "blur(50px)",
        }}
      />
      <div id="features" className="relative max-w-6xl mx-auto scroll-mt-28">
        <div className="flex flex-col items-center text-center mb-16">
          <p className="kicker kicker-center mb-4">Capabilities</p>
          <h2 className="text-[var(--fs-h2)] font-bold leading-[1.06] tracking-[-0.02em] text-ink-50 mb-5 max-w-2xl">
            What the pipeline <span className="grad-mint-text">delivers.</span>
          </h2>
          <p className="section-subheading" style={{ marginBottom: 0 }}>
            No magic claims — just what happens between your upload and a
            post-ready clip, stated plainly.
          </p>
        </div>

        <StaggerGroup className="grid grid-cols-1 md:grid-cols-12 gap-4 mt-16">
          {CELLS.map((cell) => {
            const Icon = cell.icon;
            return (
              <StaggerItem key={cell.title} className={cell.span}>
                <div className="cm-card bento-cell p-7 sm:p-8 flex flex-col gap-5">
                  <div
                    aria-hidden="true"
                    className="bento-glow"
                    style={{
                      background:
                        "radial-gradient(90% 70% at 20% 0%, rgba(57,229,8,0.10), transparent 60%)",
                    }}
                  />
                  <div className="w-12 h-12 rounded-2xl bg-mint-500/10 border border-mint-500/25 flex items-center justify-center text-mint-400 shrink-0">
                    <Icon className="w-[20px] h-[20px]" />
                  </div>
                  <div className="relative">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-lg sm:text-xl font-semibold tracking-[-0.01em] text-ink-50">
                        {cell.title}
                      </h3>
                      {cell.code && <span className="bento-code">{cell.code}</span>}
                    </div>
                    <p className="mt-2.5 text-[15px] leading-[1.65] text-ink-300 max-w-xl">
                      {cell.desc}
                    </p>
                  </div>
                </div>
              </StaggerItem>
            );
          })}
        </StaggerGroup>
      </div>
    </SectionReveal>
  );
}