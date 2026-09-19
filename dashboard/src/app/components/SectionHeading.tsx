import type { ReactNode } from "react";

/**
 * Shared editorial section header: kicker-line / H2 (with optional mint
 * gradient accent) / one-line subtitle. Used by every landing section so
 * the type rhythm stays consistent across the page.
 */
export default function SectionHeading({
  kicker,
  title,
  subtitle,
  align = "center",
}: {
  kicker: string;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: "center" | "left";
}) {
  const centered = align === "center";
  return (
    <div
      className={`flex flex-col ${centered ? "items-center text-center" : "items-start text-left"} mb-16`}
    >
      <p className={`kicker ${centered ? "kicker-center" : ""} mb-4`}>{kicker}</p>
      <h2
        className="text-[var(--fs-h2)] font-bold leading-[1.06] tracking-[-0.02em] text-ink-50 mb-5 max-w-2xl"
      >
        {title}
      </h2>
      {subtitle && (
        <p
          className="text-[var(--fs-base)] text-ink-300 leading-[1.65] max-w-xl"
          style={{ marginBottom: 0 }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}