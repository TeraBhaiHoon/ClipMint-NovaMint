import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted variable fonts — next/font/google fetched these from Google at
// BUILD time, and one flaky fetch killed the whole Vercel deploy (site kept
// serving a stale build). Files live in src/fonts/, builds are now offline.
const display = localFont({
  src: "../fonts/syne-var.woff2",
  weight: "400 800",
  variable: "--font-display",
  display: "swap",
});

const body = localFont({
  src: "../fonts/inter-var.woff2",
  weight: "100 900",
  variable: "--font-body",
  display: "swap",
});

const mono = localFont({
  src: "../fonts/jetbrains-mono-var.woff2",
  weight: "100 800",
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  icons: { icon: "/logo-cm-128.png" },
  title: "ClipMint — Turn long videos into vertical clips with animated captions",
  description:
    "Upload one long video and get platform-ready 9:16 clips with professional animated captions. AI finds the moments worth posting, cuts them, and renders studio-made captions. Free to start, no card needed.",
  keywords: [
    "AI video clipper",
    "content repurposer",
    "short-form video",
    "animated captions",
    "vertical clips",
    "YouTube shorts",
    "Instagram reels",
    "TikTok clips",
    "auto captions",
    "ClipMint",
  ],
  openGraph: {
    title: "ClipMint — Turn long videos into vertical clips with animated captions",
    description:
      "Upload one video, get platform-ready 9:16 clips with animated captions. AI finds the moments. Free to start.",
    type: "website",
    url: "https://clipmint.novamintnetworks.in",
    siteName: "ClipMint",
  },
  twitter: {
    card: "summary_large_image",
    title: "ClipMint — Turn long videos into vertical clips with animated captions",
    description:
      "Upload one video, get platform-ready 9:16 clips with animated captions. AI finds the moments. Free to start.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
      </head>
      <body>{children}</body>
    </html>
  );
}