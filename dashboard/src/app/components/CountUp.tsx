"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useInView, useReducedMotion } from "framer-motion";
import { springSmooth } from "./SectionReveal";

/**
 * Count-up for real figures only (identity §6 — no invented totals).
 * Pure integer strings ("9") animate 0 → N with spring.smooth on first view;
 * compound strings ("1080×1920", "-14 LUFS") pass through untouched.
 * Reduced motion: renders the final value immediately.
 */
export default function CountUp({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduced = useReducedMotion();
  const isNumeric = /^-?\d+$/.test(value.trim());
  const [display, setDisplay] = useState<string>(() =>
    isNumeric && !reduced ? "0" : value
  );

  useEffect(() => {
    if (!isNumeric) return;
    if (reduced) {
      setDisplay(value.trim());
      return;
    }
    if (!inView) return;
    const target = parseInt(value.trim(), 10);
    const controls = animate(0, target, {
      ...springSmooth,
      onUpdate: (v) => setDisplay(String(Math.round(v))),
    });
    return () => controls.stop();
  }, [inView, isNumeric, reduced, value]);

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
}
