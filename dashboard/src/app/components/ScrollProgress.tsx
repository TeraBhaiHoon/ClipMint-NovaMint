"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "./SectionReveal";

/**
 * 2px mint scroll-progress bar pinned to the top of the viewport.
 * A rAF-throttled scroll listener drives a transform: scaleX (no layout
 * writes). Landing page only — renders nothing under prefers-reduced-motion.
 */
export default function ScrollProgress() {
  const barRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const update = () => {
      const el = barRef.current;
      if (!el) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? window.scrollY / max : 0;
      el.style.transform = `scaleX(${progress})`;
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [reduced]);

  if (reduced) return null;

  return (
    <div
      ref={barRef}
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 h-[2px] bg-mint-500 origin-left z-[100] pointer-events-none"
      style={{ transform: "scaleX(0)" }}
    />
  );
}