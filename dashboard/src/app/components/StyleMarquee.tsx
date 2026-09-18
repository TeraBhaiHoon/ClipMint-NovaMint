"use client";

import { CAPTION_STYLES } from "@/lib/types";

/**
 * The ONE loop on the landing page (identity §6): infinite CSS marquee of the
 * 9 caption-style name chips. 40s linear, pauses on hover, killed entirely by
 * prefers-reduced-motion. The chip row is duplicated once (second copy
 * aria-hidden) and the track translates -50% for a seamless loop.
 */
export default function StyleMarquee() {
  const chips = CAPTION_STYLES.map((s) => s.label);

  return (
    <div
      className="cm-marquee relative w-full overflow-hidden mb-14"
      role="region"
      aria-label="Caption styles"
    >
      <style>{`
        @keyframes cm-marquee-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .cm-marquee-track {
          animation: cm-marquee-scroll 40s linear infinite;
        }
        .cm-marquee:hover .cm-marquee-track {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .cm-marquee-track { animation: none; }
        }
      `}</style>

      <div className="cm-marquee-track flex w-max items-center">
        {[0, 1].map((copy) => (
          <div
            key={copy}
            aria-hidden={copy === 1}
            className="flex items-center gap-3 pr-3"
          >
            {chips.map((label) => (
              <span
                key={label}
                className="whitespace-nowrap rounded-full border border-mint-500/25 bg-mint-500/5 px-4 py-1.5 text-sm font-semibold text-mint-200"
              >
                {label}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
