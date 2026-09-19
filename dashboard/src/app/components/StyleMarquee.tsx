import { CAPTION_STYLES } from "@/lib/types";

/**
 * The ONE loop on the landing page — an infinite CSS marquee of the nine
 * caption-style names as mint chips. The chip row is duplicated once (the
 * second copy is aria-hidden) and the track translates -50% for a seamless
 * loop. Pauses on hover, killed entirely by prefers-reduced-motion.
 * Pure CSS — no client runtime.
 */
export default function StyleMarquee({ className = "" }: { className?: string }) {
  const chips = CAPTION_STYLES.map((s) => s.label);

  return (
    <div
      className={`cm-marquee ${className}`}
      role="region"
      aria-label="Animated caption styles"
    >
      <div className="cm-marquee-track">
        {[0, 1].map((copy) => (
          <div
            key={copy}
            aria-hidden={copy === 1}
            className="flex items-center gap-4 pr-4"
          >
            {chips.map((label) => (
              <span key={`${copy}-${label}`} className="cm-marquee-chip">
                {label}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}