"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * Reveal system — a single IntersectionObserver toggles `.is-visible` and
 * the CSS in globals.css does the animating (transform/opacity only, with
 * the expo ease token). No animation library on the landing page.
 *
 * - SectionReveal  : wraps a <section>, fades the whole block in once.
 * - StaggerGroup   : wraps children; children get staggered entrance.
 * - StaggerItem    : one staggered child (must sit inside StaggerGroup).
 * - useReducedMotion: matchMedia("(prefers-reduced-motion: reduce)").
 *
 * Under reduced motion everything renders static (CSS also forces final
 * state), so the observer is simply skipped.
 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  // An external store (the OS setting), not component state — reading it via
  // useSyncExternalStore avoids the setState-in-effect cascade.
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false, // server render: assume motion is fine
  );
}

function useInViewOnce<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;
    if (!("IntersectionObserver" in window)) {
      // Ancient browser without IO: reveal asynchronously instead of
      // setting state synchronously inside the effect body.
      const raf = requestAnimationFrame(() => setSeen(true));
      return () => cancelAnimationFrame(raf);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -10% 0px" }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [enabled]);

  return { ref, seen };
}

export function SectionReveal({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const { ref, seen } = useInViewOnce<HTMLElement>(!reduced);
  const visible = reduced || seen;
  return (
    <section
      ref={ref}
      className={`reveal ${visible ? "is-visible" : ""} ${className}`}
    >
      {children}
    </section>
  );
}

export function StaggerGroup({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const { ref, seen } = useInViewOnce<HTMLDivElement>(!reduced);
  const visible = reduced || seen;
  return (
    <div
      ref={ref}
      className={`stagger-group ${visible ? "is-visible" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function StaggerItem({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`stagger-item ${className}`}>{children}</div>;
}