import React, { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { AbsoluteFill, cancelRender, continueRender, delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Trail } from "@remotion/motion-blur";
import { activeTokenIndex, captionGeometry, fitCaptionLines, graphemes, type CaptionPage, type CaptionPlatform } from "./caption-layout";

const LATIN = "ClipMint Inter";
const HINDI = "ClipMint Baloo";
let fontPromise: Promise<void> | null = null;

function loadCaptionFonts(): Promise<void> {
    fontPromise ??= Promise.all([
        new FontFace(LATIN, `url(${staticFile("fonts/inter-var.woff2")})`, { weight: "400 900" }).load(),
        new FontFace(HINDI, `url(${staticFile("fonts/baloo2-var.ttf")})`, { weight: "400 800" }).load(),
    ]).then((fonts) => { fonts.forEach((font) => document.fonts.add(font)); });
    return fontPromise;
}

export function CaptionFontGate({ children }: { children: React.ReactNode }) {
    const [handle] = useState(() => delayRender("Loading bundled caption fonts"));
    const [ready, setReady] = useState(false);
    useEffect(() => {
        let disposed = false;
        loadCaptionFonts().then(() => {
            if (!disposed) flushSync(() => setReady(true));
            continueRender(handle);
        }).catch((error) => cancelRender(new Error(`Caption fonts could not load: ${String(error)}`)));
        return () => { disposed = true; continueRender(handle); };
    }, [handle]);
    return ready ? <>{children}</> : null;
}

type Style = "hormozi" | "bounce" | "fade" | "glow" | "typewriter" | "glitch" | "neon" | "colorful" | "minimal";
export type ProfessionalPageProps = {
    page: CaptionPage;
    pageFrames: number;
    style: Style;
    accentColor: string;
    fontSize: number;
    platform: CaptionPlatform;
    motionBlur?: boolean;
};
export const CaptionAudioContext = React.createContext(0);
const COLORS = ["#FDE68A", "#BAE6FD", "#BBF7D0", "#FBCFE8"];

function MotionAccent({ text, fromMs, fontSize }: { text: string; fromMs: number; fontSize: number }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const progress = Math.max(0, Math.min(1, (frame / fps * 1000 - fromMs) / 100));
    return <span style={{ display: "inline-block", transform: `translateY(${(1 - progress) * fontSize * 0.08}px)` }}>{text}</span>;
}

export function ProfessionalCaptionPage({ page, pageFrames, style, accentColor, fontSize, platform, motionBlur = false }: ProfessionalPageProps) {
    const frame = useCurrentFrame();
    const intensity = React.useContext(CaptionAudioContext);
    const { width, height, fps } = useVideoConfig();
    const geometry = captionGeometry(width, height, platform);
    const nowMs = page.startMs + frame / fps * 1000;
    const active = activeTokenIndex(page, nowMs);
    const hindi = page.tokens.some((token) => /[\u0900-\u097f]/.test(token.text));
    const family = hindi ? `"${HINDI}", "${LATIN}"` : `"${LATIN}", "${HINDI}"`;
    const weight = style === "minimal" || style === "fade" ? 600 : 800;
    const uppercase = !hindi && ["hormozi", "bounce", "glitch", "neon"].includes(style);
    const baseSize = fontSize * geometry.scale * (style === "minimal" ? 0.88 : 1);
    const layout = useMemo(() => {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Caption text measurement is unavailable");
        const measure = (text: string, size: number) => {
            context.font = `${weight} ${size}px ${family}`;
            const rendered = uppercase ? text.toLocaleUpperCase("en") : text;
            // Extra room covers word pills, spaces, outlines and active scaling.
            return context.measureText(rendered).width * 1.13 + page.tokens.length * size * 0.18;
        };
        return fitCaptionLines(page.tokens, baseSize, geometry.maxWidth - baseSize * 1.2, measure);
    }, [page.tokens, baseSize, geometry.maxWidth, family, weight, uppercase]);
    const size = layout.fontSize;
    const enterFrames = Math.max(1, Math.min(Math.round(fps * 0.14), Math.floor(pageFrames / 3)));
    const entered = interpolate(frame, [0, enterFrames], [0.88, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const bottom = geometry.bottom;
    const panel = style === "minimal" || style === "fade" || style === "typewriter";
    let index = 0;
    return <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingLeft: geometry.left, paddingRight: geometry.right, paddingBottom: bottom, pointerEvents: "none" }}>
        <div data-caption-page={style} data-caption-language={hindi ? "hi" : "latin"} style={{
            maxWidth: geometry.maxWidth, boxSizing: "border-box", textAlign: "center", fontFamily: family,
            fontSize: size, fontWeight: weight, lineHeight: hindi ? 1.48 : 1.32,
            padding: panel ? `${size * 0.2}px ${size * 0.45}px` : `${size * 0.12}px`,
            borderRadius: size * 0.22, background: panel ? "rgba(8,14,20,0.88)" : "transparent",
            boxShadow: panel ? "0 8px 24px rgba(0,0,0,0.28)" : "none",
            transform: style === "bounce" ? `translateY(${(1 - entered) * size * 0.75}px) scale(${entered})` : style === "fade" || style === "minimal" ? `translateY(${(1 - entered) * size * 0.35}px)` : undefined,
            opacity: style === "fade" ? entered : 1,
        }}>
            {layout.lines.map((line, lineIndex) => <div key={lineIndex} data-caption-line style={{ whiteSpace: "nowrap", display: "flex", justifyContent: "center", alignItems: "baseline", gap: `${size * 0.16}px` }}>
                {line.map((token) => {
                    const tokenIndex = index++;
                    const isActive = tokenIndex === active;
                    const text = uppercase ? token.text.toLocaleUpperCase("en") : token.text;
                    const glyphs = graphemes(text);
                    const progress = Math.min(1, Math.max(0, (nowMs - token.fromMs) / Math.max(1, token.toMs - token.fromMs)));
                    const typed = tokenIndex < active ? text : tokenIndex > active ? "" : glyphs.slice(0, Math.max(1, Math.ceil(progress * glyphs.length))).join("");
                    const pill = isActive && (style === "hormozi" || style === "bounce");
                    const highlight = isActive && ["glow", "glitch", "neon"].includes(style);
                    const color = pill ? "#07130A" : style === "colorful" ? COLORS[tokenIndex % COLORS.length] : highlight ? accentColor : "#FFFFFF";
                    const shadow = style === "neon" || style === "glow" ? `0 2px 4px #000, 0 0 ${isActive ? size * (0.18 + intensity * 0.12) : style === "neon" ? size * 0.07 : 0}px ${accentColor}` : "0 2px 5px rgba(0,0,0,0.95)";
                    return <span key={`${tokenIndex}-${token.fromMs}`} data-caption-word style={{ position: "relative", display: "inline-block", whiteSpace: "pre", padding: `${size * 0.015}px ${size * 0.045}px`, borderRadius: size * 0.12,
                        color, background: pill ? accentColor : highlight ? "rgba(0,0,0,0.82)" : "transparent",
                        textShadow: pill ? "none" : shadow, transform: isActive && style === "bounce" ? "scale(1.035)" : undefined,
                        WebkitTextStroke: !pill && !panel ? `${size * 0.016}px rgba(0,0,0,0.92)` : undefined, paintOrder: "stroke fill",
                    }}>
                        {style === "typewriter" ? <><span style={{ visibility: "hidden" }} aria-hidden>{text}</span><span style={{ position: "absolute", inset: 0 }}>{typed}</span></> : text}
                        {motionBlur && style === "hormozi" && isActive && <span aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none" }}><Trail layers={3} lagInFrames={1} trailOpacity={0.2}><MotionAccent text={text} fromMs={token.fromMs - page.startMs} fontSize={size} /></Trail></span>}
                        {style === "glitch" && isActive && frame < enterFrames && <span aria-hidden style={{ position: "absolute", inset: 0, color: "#BAE6FD", opacity: 0.35, transform: `translateX(${geometry.scale * 2}px)` }}>{text}</span>}
                    </span>;
                })}
            </div>)}
        </div>
    </AbsoluteFill>;
}
