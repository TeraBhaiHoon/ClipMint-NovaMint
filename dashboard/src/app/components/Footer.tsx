import Link from "next/link";

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
        title: "Company",
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
        title: "Connect",
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
        <footer className="border-t border-white/5 px-6 md:px-12 py-16 bg-gradient-to-b from-transparent to-[#08080c]/50">
            <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-10 md:gap-16 mb-12">
                {FOOTER_COLUMNS.map((col) => (
                    <div key={col.title} className="flex flex-col gap-4">
                        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest">
                            {col.title}
                        </h4>
                        <ul className="list-none flex flex-col gap-3">
                            {col.links.map((link) => (
                                <li key={link.label}>
                                    <Link
                                        href={link.href}
                                        className="text-sm text-slate-400 no-underline hover:text-slate-200 transition-colors duration-200"
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
            <div className="border-t border-white/5 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 max-w-6xl mx-auto">
                <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-md overflow-hidden border border-white/10">
                        <img
                            src="/clipmint-logo.jpg"
                            alt="ClipMint"
                            className="w-full h-full object-cover"
                        />
                    </div>
                    <span className="gradient-text font-bold text-md bg-text-mint-400">
                        ClipMint
                    </span>
                </div>
                <span className="text-xs text-slate-500">
                    © 2026 NovaMint Networks. All rights reserved.
                </span>
            </div>
        </footer>
    );
}
