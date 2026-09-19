import Link from "next/link";

/**
 * Identity §9.11 — four columns (Product / Resources / Legal / Contact),
 * monochrome text wordmark (the purple JPG is retired per §2), and a
 * "Made in India" microbadge.
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
            },
            {
                label: "Instagram",
                href: "https://instagram.com/clipmintapp",
            },
        ],
    },
];

export default function Footer() {
    return (
        <footer className="border-t border-white/5 bg-ink-950 px-6 md:px-10 py-16">
            <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-10 md:gap-16 mb-14">
                {FOOTER_COLUMNS.map((col) => (
                    <div key={col.title} className="flex flex-col gap-4">
                        <h4 className="cm-eyebrow text-ink-400">{col.title}</h4>
                        <ul className="list-none flex flex-col gap-3">
                            {col.links.map((link) => (
                                <li key={link.label}>
                                    <Link
                                        href={link.href}
                                        className="text-sm text-ink-300 no-underline hover:text-ink-50 transition-colors duration-200"
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>

            {/* Bottom bar */}
            <div className="border-t border-white/5 pt-8 flex flex-col md:flex-row justify-between items-center gap-5 max-w-6xl mx-auto">
                <div className="flex flex-col items-center md:items-start gap-3">
                    <span className="font-[family-name:var(--font-display)] font-bold text-lg leading-none tracking-[-0.02em] text-ink-50">
                        ClipMint<span className="text-ink-400">.</span>
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-[11px] font-medium text-ink-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-mint-500" aria-hidden="true" />
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
