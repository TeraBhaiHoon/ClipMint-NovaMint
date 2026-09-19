import type { Metadata } from "next";
import { Syne, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = Syne({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
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
    url: "https://clipmint.vikashbuilds.in",
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