import type { ReactNode, CSSProperties } from "react";

/**
 * Hero entrance — one-shot staggered fade-up, pure CSS.
 * HeroGroup spaces the children with the hero grid; HeroItem fades its
 * child up with a small per-step delay (density: badge → H1 → sub → CTAs →
 * microline). Nothing loops, nothing follows the cursor, and
 * prefers-reduced-motion renders everything static via the CSS override.
 */

const ITEM_ORDER = [0.0, 0.12, 0.24, 0.38, 0.52];

export function HeroItem({
  children,
  className = "",
  index = 0,
  style,
}: {
  children: ReactNode;
  className?: string;
  index?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`hero-fade-up ${className}`}
      style={{ animationDelay: `${ITEM_ORDER[index % ITEM_ORDER.length]}s`, ...style }}
    >
      {children}
    </div>
  );
}

export function HeroGroup({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}