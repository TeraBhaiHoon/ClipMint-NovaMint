import Link from "next/link";

/** Branded light-theme 404 — Next's default renders black on this app. */
export default function NotFound() {
    return (
        <main className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg-primary)] text-ink-50 px-6 text-center">
            <p className="kicker mb-4">Error 404</p>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-3">Page not found</h1>
            <p className="text-sm text-ink-400 mb-8 max-w-sm leading-relaxed">
                The page you are looking for doesn&apos;t exist or may have moved.
            </p>
            <Link href="/dashboard" className="btn-primary py-2.5 px-6 text-sm font-semibold no-underline">
                Back to dashboard
            </Link>
        </main>
    );
}
