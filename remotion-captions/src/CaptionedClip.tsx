import React, { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, Audio, cancelRender, continueRender, delayRender, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Video } from "@remotion/media";
import { preloadVideo } from "@remotion/preload";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { flushSync } from "react-dom";
import { useWindowedAudioData, visualizeAudio } from "@remotion/media-utils";
import { CaptionAudioContext, CaptionFontGate, ProfessionalCaptionPage } from "./ProfessionalCaptions";
import { buildCaptionPages, captionGeometry, normalizeCaptionTokens, pageEndMs } from "./caption-layout";
export { buildCaptionPages, fitFontSize } from "./caption-layout";

export const captionedClipSchema = z.object({
    videoSrc: z.string().default(""),
    durationInFrames: z.number().int().min(1).default(300),
    captionsData: z.string(),
    captionStyle: z.enum(["hormozi", "bounce", "fade", "glow", "typewriter", "glitch", "neon", "colorful", "minimal"]),
    backgroundColor: zColor(),
    accentColor: zColor(),
    fontSize: z.number().min(24).max(140).default(68),
    // Source trimming belongs to prepare_clips.py. These offsets remain for
    // legacy callers; trimAfter is an absolute source position, never a length.
    trimStartSec: z.number().min(0).default(0),
    trimEndSec: z.number().min(0).default(0),
    layout: z.enum(["cover", "fill"]).default("cover"),
    platform: z.enum(["tiktok", "reels", "shorts"]).default("tiktok"),
    maxWordsPerPage: z.number().int().min(1).max(8).default(4),
    maxCharsPerPage: z.number().int().min(8).max(60).default(26),
    pageBreakGapMs: z.number().int().min(50).max(2000).default(420),
    showWatermark: z.boolean().default(true),
    brandText: z.string().default("CLIPMINT"),
    showProgressBar: z.boolean().default(true),
    hasAudio: z.boolean().default(false),
    audioReactive: z.boolean().default(false),
    fadeEdge: z.boolean().default(true),
    motionBlur: z.boolean().default(false),
    autoPunchIn: z.boolean().default(false),
    sfxEnabled: z.boolean().default(false),
    bgmSrc: z.string().default(""),
    bgmVolume: z.number().min(0).max(1).default(0.16),
});
export type CaptionedClipProps = z.infer<typeof captionedClipSchema>;

const assetChecks = new Map<string, Promise<boolean>>();
function optionalAssetExists(src: string) {
    if (!assetChecks.has(src)) assetChecks.set(src, fetch(src, { method: "HEAD" }).then((response) => response.ok).catch(() => false));
    return assetChecks.get(src)!;
}

function OptionalAudio({ src, volume, loop = false }: { src: string; volume: number; loop?: boolean }) {
    const [ready, setReady] = useState(false);
    const [handle] = useState(() => delayRender(`Checking optional audio: ${src}`));
    useEffect(() => {
        let disposed = false;
        optionalAssetExists(src).then((exists) => {
            if (!disposed) flushSync(() => setReady(exists));
            continueRender(handle);
        });
        return () => { disposed = true; continueRender(handle); };
    }, [handle, src]);
    return ready ? <Audio src={src} volume={volume} loop={loop} /> : null;
}

function VideoGate({ src, children }: { src: string; children: React.ReactNode }) {
    const [handle] = useState(() => delayRender("Decoding source video"));
    useEffect(() => {
        const releasePreload = preloadVideo(src);
        const probe = document.createElement("video");
        const ready = () => continueRender(handle);
        const failed = () => cancelRender(new Error("Source video cannot be decoded; refusing an empty render"));
        probe.preload = "auto";
        probe.muted = true;
        probe.src = src;
        probe.addEventListener("loadeddata", ready, { once: true });
        probe.addEventListener("error", failed, { once: true });
        probe.load();
        return () => {
            releasePreload();
            probe.removeEventListener("loadeddata", ready);
            probe.removeEventListener("error", failed);
            probe.removeAttribute("src");
            continueRender(handle);
        };
    }, [handle, src]);
    return <>{children}</>;
}

function CaptionAudioGate({ src, children }: { src: string; children: React.ReactNode }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const { audioData, dataOffsetInSeconds } = useWindowedAudioData({ src, frame, fps, windowInSeconds: 2 });
    const intensity = useMemo(() => {
        if (!audioData) return 0;
        const bins = visualizeAudio({ fps, frame, audioData, numberOfSamples: 128, optimizeFor: "speed", dataOffsetInSeconds }).slice(0, 16);
        return Math.min(1, bins.reduce((sum, value) => sum + value, 0) / Math.max(1, bins.length));
    }, [audioData, dataOffsetInSeconds, fps, frame]);
    return <CaptionAudioContext.Provider value={intensity}>{children}</CaptionAudioContext.Provider>;
}

export function CaptionedClip(props: CaptionedClipProps) {
    const { width, height, fps } = useVideoConfig();
    const frame = useCurrentFrame();
    const durationMs = props.durationInFrames / fps * 1000;
    const safe = captionGeometry(width, height, props.platform);
    const tokens = useMemo(() => {
        try { return normalizeCaptionTokens(JSON.parse(props.captionsData), durationMs); }
        catch { throw new Error("Invalid caption JSON; refusing an uncaptioned render"); }
    }, [props.captionsData, durationMs]);
    const pages = useMemo(() => buildCaptionPages(tokens, {
        maxWords: props.maxWordsPerPage, maxChars: props.maxCharsPerPage,
        gapMs: props.pageBreakGapMs, maxPageMs: 3200,
    }), [tokens, props.maxWordsPerPage, props.maxCharsPerPage, props.pageBreakGapMs]);
    if (!pages.length) throw new Error("No caption words within this clip; refusing an uncaptioned render");
    const nowMs = frame / fps * 1000;
    let scale = 1;
    if (props.autoPunchIn) {
        let lastPunch = -Infinity;
        for (let index = 0; index < tokens.length; index++) {
            if (index && !/[.!?।॥]$/.test(tokens[index - 1].text)) continue;
            const start = tokens[index].fromMs;
            if (start - lastPunch < 2500) continue;
            lastPunch = start;
            const elapsed = nowMs - start;
            if (elapsed >= 0 && elapsed < 700) scale = 1 + 0.05 * Math.sin(Math.PI * elapsed / 700);
        }
    }
    const trimBefore = Math.floor(props.trimStartSec * fps);
    const videoProps = { src: staticFile(props.videoSrc), trimBefore, trimAfter: trimBefore + props.durationInFrames };
    const fadeFrames = Math.max(1, Math.min(Math.round(fps * 0.18), Math.floor(props.durationInFrames / 3)));
    const fade = props.fadeEdge ? Math.max(
        interpolate(frame, [0, fadeFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        interpolate(frame, [Math.max(1, props.durationInFrames - fadeFrames), props.durationInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    ) : 0;
    const content = <AbsoluteFill style={{ backgroundColor: props.videoSrc ? "#000" : props.backgroundColor }}>
        {props.videoSrc && <AbsoluteFill style={{ transform: `scale(${scale})` }}>
            {props.layout === "fill" && <Video {...videoProps} muted style={{ width: "100%", height: "100%", objectFit: "cover", filter: "blur(24px) brightness(0.65)", transform: "scale(1.18)" }} />}
            <AbsoluteFill><Video {...videoProps} style={{ width: "100%", height: "100%", objectFit: props.layout === "fill" ? "contain" : "cover" }} /></AbsoluteFill>
        </AbsoluteFill>}
        <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(0,0,0,0.58), transparent 52%)", pointerEvents: "none" }} />
        {props.bgmSrc && <OptionalAudio src={staticFile(props.bgmSrc)} volume={props.bgmVolume} loop />}
        {props.sfxEnabled && <OptionalAudio src={staticFile("sfx/whoosh.wav")} volume={0.22} />}
        {props.showWatermark && props.brandText && <div style={{ position: "absolute", top: safe.top * 0.4, left: safe.left, color: "rgba(255,255,255,0.55)", fontFamily: '"ClipMint Inter", sans-serif', fontWeight: 700, fontSize: 22 * safe.scale, letterSpacing: safe.scale * 3 }}>{props.brandText}</div>}
        {props.showProgressBar && <div style={{ position: "absolute", inset: "auto 0 0", height: Math.max(2, 5 * safe.scale), background: "rgba(255,255,255,0.12)" }}><div style={{ height: "100%", width: `${Math.min(100, frame / Math.max(1, props.durationInFrames - 1) * 100)}%`, background: props.accentColor }} /></div>}
        {pages.map((page, index) => {
            const from = Math.max(0, Math.round(page.startMs / 1000 * fps));
            const next = pages[index + 1];
            const nextFrame = next ? Math.round(next.startMs / 1000 * fps) : props.durationInFrames;
            const end = Math.min(props.durationInFrames, nextFrame, Math.max(from + 1, Math.round(pageEndMs(page, next, durationMs) / 1000 * fps)));
            if (end <= from) return null;
            return <Sequence key={`${index}-${page.startMs}`} from={from} durationInFrames={end - from}>
                <ProfessionalCaptionPage page={page} pageFrames={end - from} style={props.captionStyle} accentColor={props.accentColor} fontSize={props.fontSize} platform={props.platform} motionBlur={props.motionBlur} />
                {props.sfxEnabled && pages.length <= 60 && <OptionalAudio src={staticFile("sfx/pop.wav")} volume={0.18} />}
            </Sequence>;
        })}
        {fade > 0 && <AbsoluteFill style={{ backgroundColor: "#000", opacity: fade, pointerEvents: "none" }} />}
    </AbsoluteFill>;
    const gated = props.videoSrc ? <VideoGate src={staticFile(props.videoSrc)}>{content}</VideoGate> : content;
    // The analyser cancels rendering on silent media, so both flags interlock it.
    return <CaptionFontGate>{props.videoSrc && props.hasAudio && props.audioReactive
        ? <CaptionAudioGate src={staticFile(props.videoSrc)}>{gated}</CaptionAudioGate>
        : gated}</CaptionFontGate>;
}
