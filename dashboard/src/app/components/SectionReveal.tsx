"use client";

import {
  useEffect,
  useRef,
  useState,
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

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function useInViewOnce<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;
    if (!("IntersectionObserver" in window)) {
      setSeen(true);
      return;
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