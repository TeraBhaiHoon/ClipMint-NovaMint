"use client";

import { motion, useScroll, useReducedMotion } from "framer-motion";

/**
 * 2px mint scroll-progress bar pinned to the top of the viewport.
 * Landing page only — do not mount inside /dashboard.
 * `useScroll` → scaleX (identity §6). Renders nothing under
 * prefers-reduced-motion.
 */
export default function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const reduced = useReducedMotion();

  if (reduced) return null;

  return (
    <motion.div
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 h-[2px] bg-mint-500 origin-left z-[100] pointer-events-none"
      style={{ scaleX: scrollYProgress }}
    />
  );
}
