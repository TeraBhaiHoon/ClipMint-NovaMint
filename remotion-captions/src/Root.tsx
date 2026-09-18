import React from "react";
import { Composition } from "remotion";
import { CaptionedClip, captionedClipSchema } from "./CaptionedClip";

// Default Caption[] for Remotion Studio preview (10 seconds, ~17 words)
const PREVIEW_CAPTIONS = JSON.stringify([
    { text: "Welcome ", startMs: 500, endMs: 900, timestampMs: null, confidence: null },
    { text: "to ", startMs: 950, endMs: 1100, timestampMs: null, confidence: null },
    { text: "ClipMint ", startMs: 1150, endMs: 1900, timestampMs: null, confidence: null },
    { text: "The ", startMs: 2500, endMs: 2700, timestampMs: null, confidence: null },
    { text: "AI ", startMs: 2750, endMs: 3000, timestampMs: null, confidence: null },
    { text: "Content ", startMs: 3050, endMs: 3400, timestampMs: null, confidence: null },
    { text: "Repurposer ", startMs: 3450, endMs: 4200, timestampMs: null, confidence: null },
    { text: "Turn ", startMs: 5000, endMs: 5300, timestampMs: null, confidence: null },
    { text: "one ", startMs: 5350, endMs: 5500, timestampMs: null, confidence: null },
    { text: "video ", startMs: 5550, endMs: 5900, timestampMs: null, confidence: null },
    { text: "into ", startMs: 5950, endMs: 6200, timestampMs: null, confidence: null },
    { text: "ten ", startMs: 6250, endMs: 6500, timestampMs: null, confidence: null },
    { text: "viral ", startMs: 6550, endMs: 6900, timestampMs: null, confidence: null },
    { text: "clips ", startMs: 6950, endMs: 7500, timestampMs: null, confidence: null },
    { text: "Powered ", startMs: 8000, endMs: 8400, timestampMs: null, confidence: null },
    { text: "by ", startMs: 8450, endMs: 8600, timestampMs: null, confidence: null },
    { text: "Remotion", startMs: 8650, endMs: 9200, timestampMs: null, confidence: null },
]);

export const RemotionRoot: React.FC = () => {
    return (
        <>
            {/*
             * CaptionedClip — main production composition.
             *
             * `durationInFrames` defaults to 300 (10 s) here for Remotion Studio
             * preview. The CI workflow always passes the actual clip duration via
             * --props so every rendered clip gets the correct length.
             *
             * `calculateMetadata` reads `durationInFrames` from the incoming props
             * and returns it as the composition length at render time.
             */}
            <Composition
                id="CaptionedClip"
                component={CaptionedClip}
                durationInFrames={300}
                fps={30}
                width={1080}
                height={1920}
                schema={captionedClipSchema}
                defaultProps={{
                    videoSrc: "",
                    durationInFrames: 300,
                    captionsData: PREVIEW_CAPTIONS,
                    captionStyle: "hormozi",
                    backgroundColor: "#000000",
                    accentColor: "#39E508",
                    fontSize: 68,
                    trimStartSec: 0,
                    trimEndSec: 0,
                    layout: "cover",
                    platform: "tiktok",
                    maxWordsPerPage: 4,
                    maxCharsPerPage: 26,
                    pageBreakGapMs: 420,
                    showWatermark: true,
                    brandText: "CLIPMINT",
                    showProgressBar: true,
                    hasAudio: false,
                    audioReactive: false,
                    fadeEdge: true,
                    motionBlur: false,
                    sfxEnabled: false,
                    bgmSrc: "",
                    bgmVolume: 0.12,
                }}
                calculateMetadata={({ props }) => {
                    return {
                        durationInFrames: props.durationInFrames ?? 300,
                    };
                }}
            />

            {/* Quick preview composition — captions-only, fixed 5 s */}
            <Composition
                id="CaptionPreview"
                component={CaptionedClip}
                durationInFrames={150}
                fps={30}
                width={1080}
                height={1920}
                schema={captionedClipSchema}
                defaultProps={{
                    videoSrc: "",
                    durationInFrames: 150,
                    captionsData: JSON.stringify([
                        { text: "This ", startMs: 500, endMs: 800, timestampMs: null, confidence: null },
                        { text: "is ", startMs: 850, endMs: 1000, timestampMs: null, confidence: null },
                        { text: "a ", startMs: 1050, endMs: 1200, timestampMs: null, confidence: null },
                        { text: "preview ", startMs: 1250, endMs: 1700, timestampMs: null, confidence: null },
                        { text: "of ", startMs: 1750, endMs: 1900, timestampMs: null, confidence: null },
                        { text: "animated ", startMs: 1950, endMs: 2400, timestampMs: null, confidence: null },
                        { text: "captions", startMs: 2450, endMs: 3000, timestampMs: null, confidence: null },
                    ]),
                    captionStyle: "hormozi",
                    backgroundColor: "#0a0a0a",
                    accentColor: "#FF6B35",
                    fontSize: 72,
                    trimStartSec: 0,
                    trimEndSec: 0,
                    layout: "cover",
                    platform: "reels",
                    maxWordsPerPage: 4,
                    maxCharsPerPage: 26,
                    pageBreakGapMs: 420,
                    showWatermark: false,
                    brandText: "CLIPMINT",
                    showProgressBar: false,
                    hasAudio: false,
                    audioReactive: false,
                    fadeEdge: true,
                    motionBlur: false,
                    sfxEnabled: false,
                    bgmSrc: "",
                    bgmVolume: 0.12,
                }}
            />
        </>
    );
};
