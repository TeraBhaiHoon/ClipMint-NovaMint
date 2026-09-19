"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";

/**
 * Hero product visual (identity §9.2): a CSS-built 9:16 phone frame —
 * 1px mint-500/40 border on --surface-inset — holding a stylized caption
 * preview. Four stacked word-chips pop in with the playful spring (§6:
 * the ONLY place the playful spring is allowed, because it mirrors the
 * render engine's caption output). Progress bar at the bottom of the frame.
 * No video file, no tint overlays, one-shot on mount, static under
 * prefers-reduced-motion.
 */

const springPlayful = { type: "spring", stiffness: 550, damping: 20 } as const;

const chipContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.16, delayChildren: 0.9 } },
};

const chipItem: Variants = {
  hidden: { opacity: 0, scale: 0.6, y: 12 },
  show: { opacity: 1, scale: 1, y: 0, transition: springPlayful },
};

const WORDS: { text: string; tone: "mint" | "plain" }[] = [
  { text: "EK VIDEO.", tone: "plain" },
  { text: "DAS CLIPS.", tone: "mint" },
  { text: "STUDIO-MADE", tone: "plain" },
  { text: "CAPTIONS.", tone: "mint" },
];

export default function PhonePreview() {
  const reduced = useReducedMotion();

  const chips = (
    <div
      className={
        reduced
          ? "flex flex-col items-center gap-1.5"
          : undefined
      }
    >
      {reduced ? (
        WORDS.map((w) => <Chip key={w.text} word={w} />)
      ) : (
        <motion.div
          variants={chipContainer}
          initial="hidden"
          animate="show"
          className="flex flex-col items-center gap-1.5"
        >
          {WORDS.map((w) => (
            <motion.div key={w.text} variants={chipItem}>
              <Chip word={w} />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );

  return (
    <div
      className="relative mx-auto w-[260px] sm:w-[300px] aspect-[9/16] rounded-[32px] border border-mint-500/40 bg-[var(--surface-inset)] p-3 shadow-[var(--shadow-rest)]"
      role="img"
      aria-label="Stylized preview of a 9:16 ClipMint clip with animated word-by-word captions"
    >
      <div className="h-full w-full rounded-[24px] bg-ink-950/60 flex flex-col overflow-hidden">
        {/* Speaker notch */}
        <div className="flex justify-center pt-2.5">
          <div className="w-16 h-1.5 rounded-full bg-ink-800" aria-hidden="true" />
        </div>

        {/* Format meta — real output spec, not a claim */}
        <div className="flex justify-center pt-4">
          <span className="rounded-full border border-white/10 bg-ink-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
            9:16 · 1080×1920
          </span>
        </div>

        {/* Clean empty ink — no orbs, no tints (§6 bans) */}
        <div className="flex-1" />

        {/* Stylized caption block, lower third */}
        <div className="px-4 pb-5">{chips}</div>

        {/* Progress bar + timecode */}
        <div className="px-4 pb-4">
          <div className="h-1 w-full rounded-full bg-ink-800 overflow-hidden">
            <div className="h-full w-[62%] rounded-full bg-mint-500" />
          </div>
          <div className="mt-2 flex justify-between font-[family-name:var(--font-mono)] text-[10px] text-ink-500">
            <span>0:07</span>
            <span>0:12</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ word }: { word: { text: string; tone: "mint" | "plain" } }) {
  const base =
    "inline-block rounded-lg px-3 py-1 text-lg sm:text-xl font-bold uppercase tracking-tight leading-tight";
  return (
    <span
      className={`${base} ${
        word.tone === "mint"
          ? "bg-mint-400 text-ink-950"
          : "bg-ink-900/90 text-ink-50 border border-white/10"
      }`}
    >
      {word.text}
    </span>
  );
}
