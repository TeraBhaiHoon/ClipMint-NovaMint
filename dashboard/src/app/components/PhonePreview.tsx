import type { CSSProperties } from "react";

/**
 * Hero product visual — a CSS-built 9:16 phone frame holding a stylized
 * caption preview. The four word-chips pop in with a playful spring
 * (the ONLY playful spring on the page, because it mirrors the render
 * engine's actual caption output). A mint glow breathes behind the frame.
 * No video file, no tint overlays, pure CSS animation — killed by
 * prefers-reduced-motion.
 */

const WORDS: { text: string; tone: "mint" | "plain" }[] = [
  { text: "EK VIDEO.", tone: "plain" },
  { text: "DAS CLIPS.", tone: "mint" },
  { text: "STUDIO-MADE", tone: "plain" },
  { text: "CAPTIONS.", tone: "mint" },
];

export default function PhonePreview() {
  return (
    <div className="relative" role="img" aria-label="Stylized preview of a 9:16 ClipMint clip with animated word-by-word captions">
      {/* Breathing mint glow behind the frame */}
      <div
        aria-hidden="true"
        className="hero-orb"
        style={{
          inset: "6% -18% -8% -18%",
          background: "radial-gradient(50% 50% at 50% 50%, rgba(57,229,8,0.16), transparent 70%)",
          animationName: "floaty",
          animationDuration: "6s",
        }}
      />

      <div className="phone-frame phone-float relative mx-auto w-[262px] sm:w-[304px] aspect-[9/16]">
        <div className="phone-screen flex flex-col">
          {/* Notch */}
          <div className="flex justify-center pt-3" aria-hidden="true">
            <div className="w-16 h-1.5 rounded-full bg-ink-800" />
          </div>

          {/* Output spec — real number, not a claim */}
          <div className="flex justify-center pt-5">
            <span className="rounded-full border border-white/10 bg-ink-900/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400">
              9:16 · 1080×1920
            </span>
          </div>

          {/* Clean ink gap */}
          <div className="flex-1" aria-hidden="true" />

          {/* Caption chips, lower third */}
          <div className="px-4 pb-6">
            <div className="flex flex-col items-center gap-2">
              {WORDS.map((w, i) => (
                <span
                  key={w.text}
                  className={`phone-chip ${w.tone}`}
                  style={{ animationDelay: `${0.35 + i * 0.16}s` } as CSSProperties}
                >
                  {w.text}
                </span>
              ))}
            </div>
          </div>

          {/* Progress + timecode */}
          <div className="px-5 pb-5">
            <div className="h-1 w-full rounded-full bg-ink-800/80 overflow-hidden">
              <div className="h-full w-[62%] rounded-full bg-mint-500" />
            </div>
            <div className="mt-2.5 flex justify-between font-[family-name:var(--font-mono)] text-[10px] text-ink-500">
              <span>0:07</span>
              <span>0:12</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}