import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree, Fira_Code } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});
const body = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});
const mono = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ClipMint — AI Video Clips with Professional Animated Captions",
  description:
    "Upload one long video and get 10+ platform-ready clips with professional animated captions. AI detects viral moments, clips them, and adds studio-quality captions. Try free.",
  keywords: [
    "AI video clipper",
    "content repurposer",
    "short-form video",
    "animated captions",
    "viral clips",
    "YouTube shorts",
    "Instagram reels",
    "TikTok clips",
    "ClipMint",
  ],
  openGraph: {
    title: "ClipMint — AI Video Clips with Animated Captions",
    description:
      "Turn one video into 10+ viral clips with professional animated captions. Free to start.",
    type: "website",
    url: "https://clipmint.vikashbuilds.in",
    siteName: "ClipMint",
  },
  twitter: {
    card: "summary_large_image",
    title: "ClipMint — AI Video Clips with Animated Captions",
    description:
      "Turn one video into 10+ viral clips with professional animated captions.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Production build marker: identity deploy 2026-09-19
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
      </head>
      <body>{children}</body>
    </html>
  );
}
