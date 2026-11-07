"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./SectionReveal";

/**
 * Count-up for real figures only — no invented totals.
 * Pure integers ("9") animate 0 → N on first view via requestAnimationFrame
 * with an ease-out-expo curve (respects reduced motion by rendering the
 * final value immediately). Compound values ("1080×1920", "-14 LUFS") pass
 * through untouched.
 *
 * The rendered value is DERIVED from (reduced-motion, animation) state —
 * never synchronised into state from an effect body, so there is no
 * cascading render when reduced-motion flips.
 */
export default function CountUp({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const isNumeric = /^-?\d+$/.test(value.trim());
  const [seen, setSeen] = useState(false);
  // null = the animation has not started yet
  const [anim, setAnim] = useState<number | null>(null);

  useEffect(() => {
    if (!isNumeric || reduced) return;
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [isNumeric, reduced]);

  useEffect(() => {
    if (!isNumeric || reduced || !seen) return;
    const target = parseInt(value.trim(), 10);
    const duration = 1100;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      setAnim(Math.round(eased * target));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isNumeric, reduced, seen, value]);

  const display = !isNumeric
    ? value.trim()
    : reduced
      ? value.trim()
      : anim !== null
        ? String(anim)
        : "0";

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
}
