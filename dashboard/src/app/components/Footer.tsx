import Link from "next/link";
import { IconMark, IconMail, IconInstagram } from "./Icons";

/**
 * Editorial footer — four quiet columns (Product / Resources / Legal /
 * Contact), monochrome wordmark with the mint mark, and a "Made in India"
 * microbadge. Same links as before, same honesty: no invented claims.
 */

const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "Pricing", href: "/pricing" },
      { label: "API Docs", href: "/dashboard/api-keys" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy-policy" },
      { label: "Terms & Conditions", href: "/terms" },
      { label: "Refund Policy", href: "/refund-policy" },
    ],
  },
  {
    title: "Contact",
    links: [
      {
        label: "ClipMint.Support@gmail.com",
        href: "mailto:ClipMint.Support@gmail.com",
        icon: IconMail,
      },
      {
        label: "Instagram",
        href: "https://instagram.com/clipmintapp",
        icon: IconInstagram,
      },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="relative border-t border-[var(--border-faint)] bg-[var(--bg-void)] px-6 md:px-10 pt-20 pb-10 overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[420px] pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 100% at 50% 100%, rgba(57,229,8,0.05), transparent 70%)",
        }}
      />
      <div className="relative max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-10 md:gap-14 mb-16">
        {FOOTER_COLUMNS.map((col) => (
          <div key={col.title} className="flex flex-col gap-5">
            <h4 className="cm-eyebrow text-ink-500">{col.title}</h4>
            <ul className="list-none flex flex-col gap-3">
              {col.links.map((link) => {
                const Icon = "icon" in link ? link.icon : undefined;
                return (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="group inline-flex items-center gap-2.5 text-sm text-ink-300 no-underline hover:text-ink-50 transition-colors duration-200"
                    >
                      {Icon && (
                        <Icon className="w-4 h-4 text-ink-500 group-hover:text-mint-400 transition-colors duration-200" />
                      )}
                      <span className="group-hover:underline decoration-mint-400/50 underline-offset-4">
                        {link.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="relative border-t border-[var(--border-faint)] pt-8 flex flex-col md:flex-row justify-between items-center gap-6 max-w-6xl mx-auto">
        <div className="flex flex-col items-center md:items-start gap-4">
          <span className="flex items-center gap-2.5 font-[family-name:var(--font-display)] font-bold text-lg leading-none tracking-[-0.02em] text-ink-50">
            <IconMark className="w-5 h-5 text-mint-400" />
            ClipMint<span className="text-mint-400">.</span>
          </span>
          <span className="inline-flex items-center gap-2.5 rounded-full border border-white/10 px-3.5 py-1.5 text-[11px] font-medium text-ink-300">
            <span className="relative flex w-2 h-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full rounded-full bg-mint-500 opacity-40 animate-ping" />
              <span className="relative inline-flex rounded-full w-2 h-2 bg-mint-500" />
            </span>
            Made in India
          </span>
        </div>
        <span className="text-[13px] text-ink-500">
          © 2026 NovaMint Networks. All rights reserved.
        </span>
      </div>
    </footer>
  );
}