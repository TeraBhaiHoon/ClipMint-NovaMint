/**
 * CaptionedClip — ClipMint's animated caption renderer.
 *
 * Design rules this file follows (learned from production failures):
 *
 * 1. Page grouping is DONE HERE, deterministically. We do not depend on
 *    `createTikTokStyleCaptions`, whose page breaks require each caption token
 *    to start with a space. Our transcription pipeline strips whitespace from
 *    every word, so that helper collapsed an entire clip into a single page and
 *    captions disappeared after ~1.2s. Grouping by word count / character count /
 *    silence gap / sentence end is independent of whitespace and can never fail
 *    that way.
 *
 * 2. Every animation duration is expressed in SECONDS and converted with the
 *    composition fps — never as a raw frame count — so a 60fps render behaves
 *    like a 30fps render.
 *
 * 3. Page exit animations use the PAGE's duration, not the composition's.
 *
 * 4. Captions respect platform safe areas, so nothing lands under the Reels /
 *    Shorts / TikTok UI chrome.
 *
 * 5. Audio reactivity is opt-in (`audioReactive`). `useWindowedAudioData`
 *    cancels the whole render when it cannot decode a track, which silently
 *    killed every clip that had no audio stream.
 */
import React, { useMemo } from "react";
import { flushSync } from "react-dom";
import {
    AbsoluteFill,
    useCurrentFrame,
    useVideoConfig,
    Sequence,
    interpolate,
    Easing,
    staticFile,
    Audio,
    continueRender,
    delayRender,
} from "remotion";
import { Video } from "@remotion/media";
import { preloadVideo } from "@remotion/preload";
import { fitText } from "@remotion/layout-utils";
import { Trail } from "@remotion/motion-blur";
import { noise2D } from "@remotion/noise";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { type Caption } from "@remotion/captions";
import { loadFont } from "@remotion/google-fonts/Inter";
import { useWindowedAudioData, visualizeAudio } from "@remotion/media-utils";

// ---------------------------------------------------------------------------
// Fonts — loaded render-blocking so CI output matches the Studio preview
// ---------------------------------------------------------------------------
const { fontFamily: interFont } = loadFont("normal", {
    weights: ["400", "500", "600", "700", "800", "900"],
    subsets: ["latin"],
});

// ---------------------------------------------------------------------------
// Safe areas
//
// Platform UI covers the bottom and right of a vertical video. Captions placed
// inside those regions get hidden behind the app's own chrome, so every style
// anchors above the reserved strip.
// ---------------------------------------------------------------------------
const SAFE_AREAS = {
    tiktok: { bottom: 340, right: 150, top: 140, left: 60 },
    reels: { bottom: 320, right: 140, top: 140, left: 60 },
    shorts: { bottom: 280, right: 110, top: 110, left: 60 },
} as const;

// ---------------------------------------------------------------------------
// Timing (seconds — converted to frames per composition)
// ---------------------------------------------------------------------------
const ENTER_SEC = 0.18;
const EXIT_SEC = 0.14;
const MIN_PAGE_SEC = 0.35;
const HOLD_AFTER_LAST_WORD_SEC = 0.18;
/** Shortest observable blank window between two caption pages. Below this the
 *  previous page is held until the next one starts, so captions never flicker. */
const BLANK_TOLERANCE_MS = 700;

/** Bezier curves tuned for a crisp, premium feel. */
const EASE_CRISP_ENTER = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_EDITORIAL = Easing.bezier(0.45, 0, 0.55, 1);
const EASE_PLAYFUL_OVERSHOOT = Easing.bezier(0.34, 1.56, 0.64, 1);

// ---------------------------------------------------------------------------
// Edge fades (9.2) + SFX/BGM assets
// ---------------------------------------------------------------------------
/** Length of the fade-in from / fade-out to black, in composition frames. */
const FADE_EDGE_FRAMES = 8;
/** Pop SFX per caption page is disabled above this page count. */
const MAX_POP_PAGES = 60;
/** Shared SFX level (task spec: pops ~0.5; whoosh uses the same bed level). */
const SFX_VOLUME = 0.5;
/** Public/ paths of the vendored SFX (see pipeline/assets_manifest.json). */
const SFX_POP = "sfx/pop.wav";
const SFX_WHOOSH = "sfx/whoosh.wav";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
export const captionedClipSchema = z.object({
    /** File name inside public/ of the clip to caption. Empty = captions only. */
    videoSrc: z.string().default(""),
    /** Composition length in frames. Also the length of the visible clip portion. */
    durationInFrames: z.number().int().min(1).default(300),
    /** JSON string of Caption[] (per-word timestamps). */
    captionsData: z.string(),
    captionStyle: z.enum([
        "hormozi",
        "bounce",
        "fade",
        "glow",
        "typewriter",
        "glitch",
        "neon",
        "colorful",
        "minimal",
    ]),
    /** Background colour, used only when videoSrc is empty. */
    backgroundColor: zColor(),
    /** Accent colour for highlighted words, progress bar and glows. */
    accentColor: zColor(),
    /** Base caption size in px. Auto-shrinks per page if a word would overflow. */
    fontSize: z.number().min(24).max(140).default(68),

    // ── Clip trimming ──────────────────────────────────────────────────────
    // Both are offsets into the SOURCE clip in seconds. The composition shows
    // `durationInFrames` frames starting at trimStartSec.
    /** Seconds of leading silence/lead-in to skip. */
    trimStartSec: z.number().min(0).default(0),
    /** Seconds of trailing silence/lead-out to skip. */
    trimEndSec: z.number().min(0).default(0),

    // ── Framing ────────────────────────────────────────────────────────────
    /**
     * cover  — the clip already fills 9:16 (pre-reframed pipeline output). Best
     *          quality: one decoder, no blur.
     * fill   — landscape/other source: blurred cover background + contained
     *          foreground so nothing is cropped away.
     */
    layout: z.enum(["cover", "fill"]).default("cover"),

    // ── Layout / pacing ────────────────────────────────────────────────────
    platform: z.enum(["tiktok", "reels", "shorts"]).default("tiktok"),
    /** Hard cap on words shown at once. */
    maxWordsPerPage: z.number().int().min(1).max(8).default(4),
    /** Hard cap on characters per page, which drives line wrapping. */
    maxCharsPerPage: z.number().int().min(8).max(60).default(26),
    /** A pause longer than this starts a new page. */
    pageBreakGapMs: z.number().int().min(50).max(2000).default(420),

    // ── Overlays ───────────────────────────────────────────────────────────
    showWatermark: z.boolean().default(true),
    brandText: z.string().default("CLIPMINT"),
    showProgressBar: z.boolean().default(true),
    /**
     * Whether the source clip actually contains an audio stream. ffprobe
     * result, supplied by the pipeline.
     *
     * This is a SAFETY interlock, not a hint. `useWindowedAudioData` calls
     * `cancelRender()` — which cannot be caught — when it cannot find a track,
     * so mounting the audio analyser on a silent clip aborts the entire render.
     * The analyser is therefore only mounted when the caller asserts BOTH
     * `audioReactive` and `hasAudio`.
     */
    hasAudio: z.boolean().default(false),
    /** Pulse captions with the audio. Requires `hasAudio: true` to take effect. */
    audioReactive: z.boolean().default(false),

    // ── Edge fades (9.2) ───────────────────────────────────────────────────
    /**
     * 8-frame fade-in from black at clip start + fade-out to black at clip
     * end. Implemented as AbsoluteFill black overlays (NOT TransitionSeries —
     * see EdgeFadeOverlay below for why). Purely visual: caption Sequences
     * and their timing are untouched.
     */
    fadeEdge: z.boolean().default(true),

    // ── Motion blur (9.6) ──────────────────────────────────────────────────
    /**
     * `@remotion/motion-blur` `<Trail>` on the active word. Hormozi style
     * ONLY, and opt-in because it multiplies the number of rendered layers.
     */
    motionBlur: z.boolean().default(false),

    // ── SFX + BGM ──────────────────────────────────────────────────────────
    /**
     * Render the SFX bed: `sfx/pop.wav` on the first word of every caption
     * page (skipped entirely when the clip has >60 pages) and
     * `sfx/whoosh.wav` at clip frame 0. Missing files are skipped silently —
     * they can never fail a render.
     */
    sfxEnabled: z.boolean().default(false),
    /** File name inside public/ of the background music track. Empty = none. */
    bgmSrc: z.string().default(""),
    /** BGM mixing level. The voice/SFX bed sits on top of this. */
    bgmVolume: z.number().min(0).max(1).default(0.16),
});

export type CaptionedClipProps = z.infer<typeof captionedClipSchema>;

// ---------------------------------------------------------------------------
// Caption page model
// ---------------------------------------------------------------------------
type WordToken = {
    text: string;
    fromMs: number;
    toMs: number;
};

type CaptionPage = {
    tokens: WordToken[];
    startMs: number;
    endMs: number;
};

const isSentenceEnd = (text: string) => /[.!?…]"?$/.test(text.trim());

/**
 * Deterministic word grouping. A page is closed when ANY of these is true:
 * the next word would exceed the word cap, the character cap, or the maximum
 * page duration; the next word starts after a noticeable pause; or the previous
 * word ended a sentence.
 *
 * Unlike `createTikTokStyleCaptions`, this never inspects leading whitespace,
 * so it is immune to the whitespace-stripping that broke production captions.
 */
export function buildCaptionPages(
    tokens: WordToken[],
    opts: {
        maxWords: number;
        maxChars: number;
        gapMs: number;
        maxPageMs: number;
    },
): CaptionPage[] {
    const pages: CaptionPage[] = [];
    let current: CaptionPage | null = null;
    let currentChars = 0;

    const flush = () => {
        if (current && current.tokens.length > 0) pages.push(current);
        current = null;
        currentChars = 0;
    };

    for (const token of tokens) {
        const text = token.text.trim();
        if (!text) continue;

        const word: WordToken = {
            text,
            fromMs: token.fromMs,
            // Guarantee forward progress even if upstream emitted a bad range.
            toMs: Math.max(token.toMs, token.fromMs + 80),
        };

        if (current) {
            const gap = word.fromMs - current.endMs;
            const prevLast = current.tokens[current.tokens.length - 1];
            const wouldOverflowWords = current.tokens.length + 1 > opts.maxWords;
            const wouldOverflowChars = currentChars + word.text.length + 1 > opts.maxChars;
            const wouldOverflowTime = word.toMs - current.startMs > opts.maxPageMs;
            const afterSentence = isSentenceEnd(prevLast.text);

            if (
                gap > opts.gapMs ||
                wouldOverflowWords ||
                wouldOverflowChars ||
                wouldOverflowTime ||
                afterSentence
            ) {
                flush();
            }
        }

        if (!current) {
            current = { tokens: [], startMs: word.fromMs, endMs: word.toMs };
        }
        current.tokens.push(word);
        current.endMs = Math.max(current.endMs, word.toMs);
        currentChars += word.text.length + 1;
    }

    flush();
    return pages;
}

/**
 * STATIC text-fitting estimator (9.3, part 1).
 *
 * Shrink the base size when a page contains a word long enough to overflow the
 * caption column. Prevents "CRYPTOCURRENCY" from running off a 1080px frame.
 *
 * This remains the exported pure function and the INITIAL value of
 * `useFitFontSize` below: it runs before fonts/DOM are available, so every
 * frame has a sane size from the very first paint.
 */
export function fitFontSize(
    tokens: WordToken[],
    baseSize: number,
    maxWidth: number,
    uppercase: boolean,
): number {
    let longest = 0;
    for (const t of tokens) longest = Math.max(longest, t.text.length);
    if (longest === 0) return baseSize;

    // Advance-width estimate for Inter (black weight, uppercase is wider).
    const perChar = uppercase ? 0.62 : 0.55;
    const widest = longest * baseSize * perChar;
    if (widest <= maxWidth) return baseSize;

    const scaled = Math.floor((baseSize * maxWidth) / widest);
    return Math.max(30, scaled);
}

/**
 * REAL text fitting (9.3, part 2) via `@remotion/layout-utils`.
 *
 * `fitText()`/`measureText()` measure with a hidden DOM node, so they can only
 * run inside the React/browser tree — the pure `fitFontSize` above cannot be
 * replaced by them in a plain function. This hook therefore:
 *
 *   1. seeds state with the static estimator (same external contract, min 30);
 *   2. holds the frame with `delayRender()` until `document.fonts.ready`;
 *   3. re-measures the longest word with `fitText({ validateFontIsLoaded: true })`
 *      — matching weight 900 + uppercase, the widest combination any style
 *      renders with, so the fit is conservative for every style;
 *   4. flushes the measured size synchronously (`flushSync`) BEFORE
 *      `continueRender()`, so the screenshotted frame always uses the real
 *      measurement, never the estimate.
 *
 * If the font cannot be validated (font load failure), the static estimate is
 * kept and the render proceeds — fitting degrades, it never fails.
 */
const useFitFontSize = (
    tokens: WordToken[],
    baseSize: number,
    maxWidth: number,
    uppercase: boolean,
): number => {
    const initial = useMemo(
        () => fitFontSize(tokens, baseSize, maxWidth, uppercase),
        [tokens, baseSize, maxWidth, uppercase],
    );
    const [size, setSize] = React.useState(initial);
    const longest = useMemo(() => {
        let longest = "";
        for (const t of tokens) {
            if (t.text.length > longest.length) longest = t.text;
        }
        return longest;
    }, [tokens]);

    React.useEffect(() => {
        if (!longest || maxWidth <= 0) return;
        let settled = false;
        let cancelled = false;
        const handle = delayRender(`layout-utils: fitting "${longest}"`);
        const settle = () => {
            if (!settled) {
                settled = true;
                continueRender(handle);
            }
        };

        document.fonts.ready
            .then(() => {
                if (cancelled) {
                    settle();
                    return;
                }
                try {
                    const { fontSize } = fitText({
                        text: longest,
                        withinWidth: maxWidth,
                        fontFamily: interFont,
                        fontWeight: 900,
                        textTransform: uppercase ? "uppercase" : "none",
                        validateFontIsLoaded: true,
                    });
                    // Same external contract as fitFontSize: never grow above
                    // the base size, never shrink below 30.
                    const fitted = Math.max(30, Math.min(baseSize, Math.floor(fontSize)));
                    if (fitted !== size) {
                        // Synchronous re-render BEFORE continueRender so the
                        // frame that gets screenshotted already uses this size.
                        flushSync(() => setSize(fitted));
                    }
                } catch {
                    // validateFontIsLoaded threw — font not (yet) loadable.
                    // Keep the static estimate; do not fail the render.
                }
                settle();
            })
            .catch(() => settle());

        return () => {
            cancelled = true;
            settle();
        };
    }, [longest, maxWidth, baseSize, uppercase, size]);

    return size;
};

// ---------------------------------------------------------------------------
// Audio reactivity — opt-in, provided through context.
//
// `useWindowedAudioData` calls cancelRender() when it cannot decode a track, so
// calling it for a silent clip aborts the whole render (this is what used to
// kill every clip without an audio stream). Because hooks cannot be called
// conditionally, the hook lives in a provider that is mounted ONLY when
// `audioReactive` is on. Every style then reads the value from context, which
// is 0 when the provider is absent.
// ---------------------------------------------------------------------------
const BassContext = React.createContext(0);
const useBass = () => React.useContext(BassContext);

const BassProvider: React.FC<{ src: string; children: React.ReactNode }> = ({
    src,
    children,
}) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();

    const { audioData, dataOffsetInSeconds } = useWindowedAudioData({
        src,
        frame,
        fps,
        windowInSeconds: 2,
    });

    const value = useMemo(() => {
        if (!audioData) return 0;
        try {
            const frequencies = visualizeAudio({
                fps,
                frame,
                audioData,
                numberOfSamples: 128,
                optimizeFor: "speed",
                dataOffsetInSeconds,
            });
            const low = frequencies.slice(0, 16);
            return low.reduce((sum, v) => sum + v, 0) / low.length;
        } catch {
            return 0;
        }
    }, [audioData, frame, fps, dataOffsetInSeconds]);

    return <BassContext.Provider value={value}>{children}</BassContext.Provider>;
};

// ---------------------------------------------------------------------------
// Asset existence gate (SFX + BGM + preloading)
//
// The composition bundle has no fs access, so "does this file exist" is
// answered with an HTTP probe against Remotion's asset server (which serves
// public/). The probe result is cached module-wide: during a render each frame
// is a fresh browser page, so the cache costs one probe per unique asset per
// frame, not per usage.
//
// While the probe is in flight the frame is held open with `delayRender()` and
// the decision is flushed with `flushSync()` before `continueRender()` — the
// screenshotted frame therefore always reflects the final answer. A missing
// file resolves to "skip": the <Audio> never mounts and the render succeeds.
// ---------------------------------------------------------------------------

/** Module-wide probe cache: url → exists. */
const assetExistsCache = new Map<string, boolean>();

const probeAssetExists = async (url: string): Promise<boolean> => {
    try {
        const head = await fetch(url, { method: "HEAD" });
        if (head.ok) return true;
        if (head.status === 404 || head.status === 410) return false;
        // Server rejected HEAD outright (e.g. 405) — retry once with GET.
    } catch {
        return false;
    }
    try {
        const get = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } });
        return get.ok;
    } catch {
        return false;
    }
};

/**
 * Renders `children` (an <Audio>) only if the asset actually resolves.
 * Unknown → renders nothing until the probe completes (the frame is blocked
 * by the delayRender handle meanwhile, so nothing is screenshotted early).
 */
const AssetGate: React.FC<{ src: string; children: React.ReactNode }> = ({ src, children }) => {
    const [exists, setExists] = React.useState<boolean | null>(
        () => assetExistsCache.get(src) ?? null,
    );

    React.useEffect(() => {
        const cached = assetExistsCache.get(src);
        if (cached !== undefined) {
            // Cached answers need no probe and no handle.
            if (cached !== exists) setExists(cached);
            return;
        }

        let cancelled = false;
        let settled = false;
        const handle = delayRender(`Probing asset ${src}`);
        const settle = () => {
            if (!settled) {
                settled = true;
                continueRender(handle);
            }
        };

        probeAssetExists(src)
            .then((ok) => {
                assetExistsCache.set(src, ok);
                if (cancelled) {
                    settle();
                    return;
                }
                // Synchronous re-render BEFORE continueRender so the frame
                // that gets screenshotted already reflects the probe result.
                flushSync(() => setExists(ok));
                settle();
            })
            .catch(() => {
                assetExistsCache.set(src, false);
                flushSync(() => {
                    if (!cancelled) setExists(false);
                });
                settle();
            });

        return () => {
            cancelled = true;
            settle();
        };
    }, [src]);

    if (exists === null || exists === false) return null;
    return <>{children}</>;
};

// ---------------------------------------------------------------------------
// Video preload gate (9.7 — no black first frames)
//
// Two layers of defence:
//   1. `preloadVideo()` (from @remotion/preload) injects <link rel="preload">
//      so the fetch starts as early as possible.
//   2. `VideoPreloadGate` holds the FIRST frame with `delayRender()` until a
//      probe <video> element has fired `loadeddata` (first frame decoded) —
//      the actual <Video> then paints real pixels on frame 0 instead of the
//      background colour. An `error` event settles the gate too: a broken
//      source must fail loudly elsewhere, never hang the render.
// ---------------------------------------------------------------------------

const VideoPreloadGate: React.FC<{ src: string; children: React.ReactNode }> = ({
    src,
    children,
}) => {
    React.useEffect(() => {
        let settled = false;
        const handle = delayRender(`Waiting for first frame of ${src}`);
        const settle = () => {
            if (!settled) {
                settled = true;
                continueRender(handle);
            }
        };

        const probe = document.createElement("video");
        probe.preload = "auto";
        probe.muted = true;
        probe.src = src;
        probe.addEventListener("loadeddata", settle, { once: true });
        probe.addEventListener("error", settle, { once: true });
        probe.load();

        return () => {
            probe.removeEventListener("loadeddata", settle);
            probe.removeEventListener("error", settle);
            probe.removeAttribute("src");
            settle();
        };
    }, [src]);

    return <>{children}</>;
};

// ---------------------------------------------------------------------------
// Edge fades (9.2)
//
// CHOICE: AbsoluteFill black overlays, NOT <TransitionSeries>. TransitionSeries
// would force every caption page <Sequence> into enter/transition slots and
// rewrite the absolute page timings that buildCaptionPages + pageFrames depend
// on — i.e. it would move the captions. Two absolutely positioned overlays
// change nothing but pixels: no Sequences, no durations, no re-timing.
//
// The overlay is the TOPMOST child so the whole frame (clip + captions + UI)
// fades from and to black. On very short clips where both windows overlap,
// `Math.max` keeps it black at both ends.
// ---------------------------------------------------------------------------

const EdgeFadeOverlay: React.FC<{ enabled: boolean; durationInFrames: number }> = ({
    enabled,
    durationInFrames,
}) => {
    const frame = useCurrentFrame();
    if (!enabled) return null;

    const fadeIn = interpolate(frame, [0, FADE_EDGE_FRAMES], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });
    const fadeOut = interpolate(
        frame,
        [Math.max(0, durationInFrames - FADE_EDGE_FRAMES), durationInFrames],
        [0, 1],
        {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
        },
    );

    return (
        <AbsoluteFill
            style={{
                backgroundColor: "#000000",
                opacity: Math.max(fadeIn, fadeOut),
                pointerEvents: "none",
            }}
        />
    );
};

// ---------------------------------------------------------------------------
// Shared word renderer — consistent stroke/shadow/karaoke across all styles
// ---------------------------------------------------------------------------
const WordTokenSpan: React.FC<{
    token: WordToken;
    fontSize: number;
    weight: number;
    color: string;
    activeColor: string;
    isActive: boolean;
    karaokeProgress: number;
    accentColor: string;
    uppercase: boolean;
    strokeWidth: number;
    scale: number;
    glow?: number;
    letterSpacing?: number;
    dimmed?: boolean;
}> = ({
    token,
    fontSize,
    weight,
    color,
    activeColor,
    isActive,
    karaokeProgress,
    accentColor,
    uppercase,
    strokeWidth,
    scale,
    glow = 0,
    letterSpacing = 0,
    dimmed = false,
}) => {
    const common: React.CSSProperties = {
        fontSize,
        fontFamily: interFont,
        fontWeight: weight,
        textTransform: uppercase ? "uppercase" : "none",
        letterSpacing,
        // paintOrder keeps the outline behind the glyph instead of eating into it
        WebkitTextStroke: strokeWidth > 0 ? `${strokeWidth}px rgba(0,0,0,0.85)` : undefined,
        paintOrder: "stroke fill",
        whiteSpace: "pre",
    };

    const shadow = [
        glow > 0 ? `0 0 ${glow}px ${accentColor}` : null,
        glow > 0 ? `0 0 ${glow * 2}px ${accentColor}66` : null,
        "0 4px 10px rgba(0,0,0,0.65)",
    ]
        .filter(Boolean)
        .join(", ");

    // Karaoke: a coloured copy clipped from the left so the fill sweeps the
    // word exactly in time with the voice.
    const useKaraoke = isActive && karaokeProgress > 0 && karaokeProgress < 1;

    return (
        <span
            style={{
                ...common,
                display: "inline-block",
                position: "relative",
                transform: `scale(${scale})`,
                textShadow: shadow,
                color: isActive ? activeColor : color,
                opacity: dimmed ? 0.55 : 1,
            }}
        >
            {useKaraoke ? (
                <>
                    <span style={{ color, WebkitTextStroke: common.WebkitTextStroke }}>
                        {token.text}
                    </span>
                    <span
                        aria-hidden
                        style={{
                            ...common,
                            position: "absolute",
                            left: 0,
                            top: 0,
                            color: activeColor,
                            clipPath: `inset(0 ${(1 - karaokeProgress) * 100}% 0 0)`,
                        }}
                    >
                        {token.text}
                    </span>
                </>
            ) : (
                token.text
            )}
        </span>
    );
};

// ---------------------------------------------------------------------------
// Caption column — anchored inside the platform safe area
// ---------------------------------------------------------------------------
const CaptionColumn: React.FC<{
    children: React.ReactNode;
    platform: keyof typeof SAFE_AREAS;
    width: number;
}> = ({ children, platform, width }) => {
    const safe = SAFE_AREAS[platform];
    return (
        <AbsoluteFill
            style={{
                justifyContent: "flex-end",
                alignItems: "center",
                paddingBottom: safe.bottom,
                paddingLeft: safe.left,
                paddingRight: safe.right,
            }}
        >
            <div
                style={{
                    maxWidth: width - safe.left - safe.right,
                    textAlign: "center",
                    // Explicit line height: the default ~1.2 makes multi-line
                    // captions collide with the outline.
                    lineHeight: 1.14,
                }}
            >
                {children}
            </div>
        </AbsoluteFill>
    );
};

// ---------------------------------------------------------------------------
// Progress bar — retention cue + polish
// ---------------------------------------------------------------------------
const ProgressBar: React.FC<{
    frame: number;
    durationInFrames: number;
    accentColor: string;
    bottom: number;
}> = ({ frame, durationInFrames, accentColor, bottom }) => {
    const progress = Math.min(1, Math.max(0, frame / Math.max(1, durationInFrames - 1)));
    return (
        <div
            style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom,
                height: 6,
                backgroundColor: "rgba(255,255,255,0.16)",
            }}
        >
            <div
                style={{
                    width: `${progress * 100}%`,
                    height: "100%",
                    backgroundColor: accentColor,
                    boxShadow: `0 0 12px ${accentColor}`,
                }}
            />
        </div>
    );
};

// ---------------------------------------------------------------------------
// Main composition
// ---------------------------------------------------------------------------
export const CaptionedClip: React.FC<CaptionedClipProps> = ({
    videoSrc,
    durationInFrames,
    captionsData,
    captionStyle,
    backgroundColor,
    accentColor,
    fontSize,
    trimStartSec,
    trimEndSec,
    layout,
    platform,
    maxWordsPerPage,
    maxCharsPerPage,
    pageBreakGapMs,
    showWatermark,
    brandText,
    showProgressBar,
    hasAudio,
    audioReactive,
    fadeEdge,
    motionBlur,
    sfxEnabled,
    bgmSrc,
    bgmVolume,
}) => {
    const { width, height, fps } = useVideoConfig();
    const frame = useCurrentFrame();

    // ── 9.7: kick off the video fetch as early as possible ─────────────────
    // <link rel="preload"> for the clip. The deterministic first-frame gate
    // itself is VideoPreloadGate below.
    React.useEffect(() => {
        if (!videoSrc) return;
        return preloadVideo(staticFile(videoSrc));
    }, [videoSrc]);

    // ── Trim maths (frames are ABSOLUTE positions in the source clip) ──────
    // `trimAfter` is an end position, not a length. Passing the trailing
    // silence duration here (the previous behaviour) truncated every clip to
    // its first ~1.5 seconds.
    const trimBeforeFrames = Math.max(0, Math.floor(trimStartSec * fps));
    const trimAfterFrames = trimBeforeFrames + durationInFrames;

    // ── Parse captions ────────────────────────────────────────────────────
    const tokens = useMemo<WordToken[]>(() => {
        try {
            const parsed = JSON.parse(captionsData);
            if (!Array.isArray(parsed)) return [];
            return (parsed as Caption[])
                .filter((c) => c && typeof c.text === "string" && typeof c.startMs === "number")
                .map((c) => ({
                    // Preserve the original spacing intent but normalise the
                    // value we group on; grouping never depends on it.
                    text: c.text,
                    fromMs: c.startMs,
                    toMs: typeof c.endMs === "number" ? c.endMs : c.startMs + 200,
                }))
                .sort((a, b) => a.fromMs - b.fromMs);
        } catch {
            return [];
        }
    }, [captionsData]);

    // ── Group into pages (failsafe: never one giant page) ─────────────────
    const pages = useMemo(() => {
        if (tokens.length === 0) return [];
        return buildCaptionPages(tokens, {
            maxWords: maxWordsPerPage,
            maxChars: maxCharsPerPage,
            gapMs: pageBreakGapMs,
            maxPageMs: 3800,
        });
    }, [tokens, maxWordsPerPage, maxCharsPerPage, pageBreakGapMs]);

    const maxCaptionWidth = width - SAFE_AREAS[platform].left - SAFE_AREAS[platform].right;

    // Pops are capped: beyond 60 pages the per-page pop bed is skipped entirely.
    const renderPops = sfxEnabled && pages.length <= MAX_POP_PAGES;

    const content = (
        <AbsoluteFill
            style={{
                backgroundColor: videoSrc ? "#000000" : backgroundColor,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
            }}
        >
            {/* ── BGM (looping, mixed at bgmVolume) + whoosh at clip frame 0 ──
                Both are existence-gated: a missing file silently drops the
                layer instead of failing the render (see AssetGate). */}
            {bgmSrc ? (
                <AssetGate src={staticFile(bgmSrc)}>
                    <Audio src={staticFile(bgmSrc)} volume={bgmVolume} loop />
                </AssetGate>
            ) : null}
            {sfxEnabled ? (
                <AssetGate src={staticFile(SFX_WHOOSH)}>
                    <Audio src={staticFile(SFX_WHOOSH)} volume={SFX_VOLUME} />
                </AssetGate>
            ) : null}

            {videoSrc ? (
                layout === "fill" ? (
                    <>
                        {/* Landscape source: blurred backdrop. Muted so the audio
                            track is not mixed in twice and doubled in volume. */}
                        <AbsoluteFill>
                            <Video
                                src={staticFile(videoSrc)}
                                trimBefore={trimBeforeFrames}
                                trimAfter={trimAfterFrames}
                                muted
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    filter: "blur(24px) brightness(0.65)",
                                    transform: "scale(1.18)",
                                }}
                            />
                        </AbsoluteFill>
                        <AbsoluteFill
                            style={{
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                            }}
                        >
                            <Video
                                src={staticFile(videoSrc)}
                                trimBefore={trimBeforeFrames}
                                trimAfter={trimAfterFrames}
                                style={{ width: "100%", height: "100%", objectFit: "contain" }}
                            />
                        </AbsoluteFill>
                    </>
                ) : (
                    /* Clip already fills 9:16 — single decoder, no letterbox. */
                    <AbsoluteFill>
                        <Video
                            src={staticFile(videoSrc)}
                            trimBefore={trimBeforeFrames}
                            trimAfter={trimAfterFrames}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                    </AbsoluteFill>
                )
            ) : null}

            {/* Scrim behind the caption band so text stays legible over bright
                footage. Bottom-weighted rather than a full-frame vignette. */}
            <AbsoluteFill
                style={{
                    background: `linear-gradient(to top, rgba(0,0,0,0.68) 0%, rgba(0,0,0,0.35) ${
                        (SAFE_AREAS[platform].bottom + 340) / height * 100
                    }%, transparent 62%)`,
                }}
            />

            {showWatermark && brandText ? (
                <div
                    style={{
                        position: "absolute",
                        top: SAFE_AREAS[platform].top * 0.35,
                        left: 0,
                        right: 0,
                        textAlign: "center",
                        color: "rgba(255,255,255,0.22)",
                        fontSize: 22,
                        fontFamily: interFont,
                        fontWeight: 700,
                        letterSpacing: 4,
                        textTransform: "uppercase",
                    }}
                >
                    {brandText}
                </div>
            ) : null}

            {showProgressBar ? (
                <ProgressBar
                    frame={frame}
                    durationInFrames={durationInFrames}
                    accentColor={accentColor}
                    bottom={0}
                />
            ) : null}

            {pages.map((page, pageIndex) => {
                const nextPage = pages[pageIndex + 1] ?? null;

                const startFrame = Math.max(0, Math.round((page.startMs / 1000) * fps));
                const nextStartMs = nextPage ? nextPage.startMs : Number.POSITIVE_INFINITY;

                // A page normally clears a beat after its last word. When the next
                // page follows almost immediately, clearing first opens a visible
                // blank window (measured at ~130ms in a real render). In that case
                // the page stays up until the next one arrives. Across a real pause
                // there is nothing being said, so clearing is correct.
                const holdEndMs = page.endMs + HOLD_AFTER_LAST_WORD_SEC * 1000;
                const gapToNextMs = nextStartMs - holdEndMs;
                const bridgeShortGap =
                    nextPage !== null && gapToNextMs > 0 && gapToNextMs < BLANK_TOLERANCE_MS;

                const desiredEndMs = bridgeShortGap
                    ? nextStartMs
                    : Math.min(nextStartMs, holdEndMs);
                const endMs = Math.max(desiredEndMs, page.startMs + MIN_PAGE_SEC * 1000);
                const endFrame = Math.max(
                    startFrame + 1,
                    Math.round((endMs / 1000) * fps),
                );

                const pageFrames = Math.max(1, endFrame - startFrame);
                // Fitting now happens inside PageRenderer via useFitFontSize
                // (layout-utils needs the React tree); the page gets the base
                // size plus the real caption column width.
                const popOffset = page.tokens.length
                    ? Math.max(
                          0,
                          Math.round(((page.tokens[0].fromMs - page.startMs) / 1000) * fps),
                      )
                    : 0;

                return (
                    <Sequence
                        key={`page-${pageIndex}-${page.startMs}`}
                        from={startFrame}
                        durationInFrames={pageFrames}
                    >
                        <PageRenderer
                            page={page}
                            pageFrames={pageFrames}
                            style={captionStyle}
                            accentColor={accentColor}
                            fontSize={fontSize}
                            width={width}
                            maxWidth={maxCaptionWidth}
                            platform={platform}
                            motionBlur={motionBlur}
                        />
                        {/* Pop SFX on the FIRST word of this page, inside the
                            page's own Sequence so it lands on that word. */}
                        {renderPops && page.tokens.length > 0 ? (
                            <AssetGate src={staticFile(SFX_POP)}>
                                <Sequence from={popOffset} durationInFrames={fps}>
                                    <Audio src={staticFile(SFX_POP)} volume={SFX_VOLUME} />
                                </Sequence>
                            </AssetGate>
                        ) : null}
                    </Sequence>
                );
            })}

            {/* ── 9.2: 8-frame fade from / to black over EVERYTHING ─────────
                Topmost layer, purely visual — see EdgeFadeOverlay. */}
            <EdgeFadeOverlay enabled={fadeEdge} durationInFrames={durationInFrames} />
        </AbsoluteFill>
    );

    // Interlock: the audio analyser mounts only when the caller asserts the
    // clip has audio AND asked for reactivity. Either flag alone keeps the
    // audio APIs completely untouched, so a silent clip can never abort a render.
    const mountBassAnalyser = audioReactive && hasAudio && Boolean(videoSrc);

    // 9.7: hold frame 0 until the clip's first frame is decoded so the video
    // (not the background colour) is visible from the very first frame.
    const gatedContent = videoSrc ? (
        <VideoPreloadGate src={staticFile(videoSrc)}>{content}</VideoPreloadGate>
    ) : (
        content
    );

    return mountBassAnalyser ? (
        <BassProvider src={staticFile(videoSrc)}>{gatedContent}</BassProvider>
    ) : (
        gatedContent
    );
};

// ---------------------------------------------------------------------------
// Style router
// ---------------------------------------------------------------------------
interface PageRendererProps {
    page: CaptionPage;
    /** Duration of THIS page, not the composition. */
    pageFrames: number;
    style: CaptionedClipProps["captionStyle"];
    accentColor: string;
    /** BASE size — the real fitted size is computed here via useFitFontSize. */
    fontSize: number;
    width: number;
    maxWidth: number;
    platform: keyof typeof SAFE_AREAS;
    /** 9.6: Trail motion blur on the active word (hormozi only). */
    motionBlur: boolean;
}

const PageRenderer: React.FC<PageRendererProps> = (props) => {
    // 9.3: real text fitting with @remotion/layout-utils. The static estimator
    // inside the hook is the initial value; the measured value replaces it
    // before the frame is screenshotted (delayRender + flushSync). Same
    // external contract as before: shrink long words, min size 30.
    const fittedFontSize = useFitFontSize(props.page.tokens, props.fontSize, props.maxWidth, true);
    const withFitted = { ...props, fontSize: fittedFontSize };

    switch (props.style) {
        case "bounce":
            return <BouncePage {...withFitted} />;
        case "fade":
            return <FadePage {...withFitted} />;
        case "glow":
            return <GlowPage {...withFitted} />;
        case "typewriter":
            return <TypewriterPage {...withFitted} />;
        case "glitch":
            return <GlitchPage {...withFitted} />;
        case "neon":
            return <NeonPage {...withFitted} />;
        case "colorful":
            return <ColorfulPage {...withFitted} />;
        case "minimal":
            return <MinimalPage {...withFitted} />;
        case "hormozi":
        default:
            return <HormoziPage {...withFitted} />;
    }
};

// ---------------------------------------------------------------------------
// Shared hooks
// ---------------------------------------------------------------------------

/** Absolute timeline position of the current frame (page-local → clip time). */
function useAbsoluteTimeMs(page: CaptionPage): number {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    return page.startMs + (frame / fps) * 1000;
}

function useActiveTokenIndex(page: CaptionPage): number {
    const now = useAbsoluteTimeMs(page);
    let active = -1;
    for (let i = 0; i < page.tokens.length; i++) {
        if (page.tokens[i].fromMs <= now && page.tokens[i].toMs > now) return i;
    }
    // Between words, keep the most recently spoken word lit.
    for (let i = 0; i < page.tokens.length; i++) {
        if (page.tokens[i].fromMs <= now) active = i;
    }
    return active;
}

/** 0 → 1 progress through the active word, for the karaoke fill. */
function useKaraokeProgress(page: CaptionPage, activeIdx: number): number {
    const now = useAbsoluteTimeMs(page);
    if (activeIdx < 0) return 0;
    const token = page.tokens[activeIdx];
    const span = Math.max(1, token.toMs - token.fromMs);
    return Math.min(1, Math.max(0, (now - token.fromMs) / span));
}

const pageEnterFrames = (fps: number) => Math.max(1, Math.round(ENTER_SEC * fps));
const pageExitFrames = (fps: number) => Math.max(1, Math.round(EXIT_SEC * fps));

// ===========================================================================
// 1. HORMOZI — word-by-word karaoke highlight with a scale pop
// ===========================================================================

/**
 * One hormozi word. ALL of its motion (active state, karaoke fill, entrance,
 * pop) is derived from `useCurrentFrame()` INSIDE this component — required
 * for 9.6: <Trail> re-renders its children at earlier frames via <Freeze>, so
 * only frame-dependent children produce an actual trail.
 */
const HormoziWord: React.FC<{
    page: CaptionPage;
    token: WordToken;
    index: number;
    fontSize: number;
    accentColor: string;
}> = ({ page, token, index, fontSize, accentColor }) => {
    const bassIntensity = useBass();
    const { fps } = useVideoConfig();
    const frame = useCurrentFrame();
    const activeIdx = useActiveTokenIndex(page);
    const karaoke = useKaraokeProgress(page, activeIdx);
    const enter = pageEnterFrames(fps);

    const isActive = index === activeIdx;
    const tokenStart = Math.round(((token.fromMs - page.startMs) / 1000) * fps);
    const entrance = interpolate(Math.max(0, frame - tokenStart), [0, enter], [0, 1], {
        easing: EASE_PLAYFUL_OVERSHOOT,
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });
    const pop = isActive ? 1 + entrance * 0.13 + bassIntensity * 0.12 : 1;

    return (
        <WordTokenSpan
            token={token}
            fontSize={fontSize}
            weight={900}
            color="#FFFFFF"
            activeColor={accentColor}
            isActive={isActive}
            karaokeProgress={karaoke}
            accentColor={accentColor}
            uppercase
            strokeWidth={isActive ? 0 : 2}
            scale={pop}
            glow={isActive ? 26 + bassIntensity * 26 : 0}
        />
    );
};

const HormoziPage: React.FC<PageRendererProps> = ({
    page,
    accentColor,
    fontSize,
    width,
    platform,
    motionBlur,
}) => {
    return (
        <CaptionColumn platform={platform} width={width}>
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: `${Math.round(fontSize * 0.16)}px`,
                }}
            >
                {page.tokens.map((token, i) => {
                    if (!motionBlur) {
                        return (
                            <HormoziWord
                                key={`${i}-${token.fromMs}`}
                                page={page}
                                token={token}
                                index={i}
                                fontSize={fontSize}
                                accentColor={accentColor}
                            />
                        );
                    }

                    // ── 9.6: motion blur on the ACTIVE word ────────────────
                    // <Trail> wraps its children in full-frame AbsoluteFills,
                    // which would tear the word out of the flex-wrap row. An
                    // invisible in-flow copy reserves the exact word box and
                    // the Trail overlay is anchored to it with inset:0, so
                    // layout is byte-identical to the non-blur case.
                    return (
                        <span
                            key={`${i}-${token.fromMs}`}
                            style={{ display: "inline-block", position: "relative" }}
                        >
                            <span aria-hidden style={{ visibility: "hidden", display: "inline-block" }}>
                                <WordTokenSpan
                                    token={token}
                                    fontSize={fontSize}
                                    weight={900}
                                    color="#FFFFFF"
                                    activeColor={accentColor}
                                    isActive={false}
                                    karaokeProgress={0}
                                    accentColor={accentColor}
                                    uppercase
                                    strokeWidth={2}
                                    scale={1}
                                />
                            </span>
                            <span aria-hidden style={{ position: "absolute", inset: 0 }}>
                                <Trail layers={4} lagInFrames={1} trailOpacity={0.6}>
                                    <HormoziWord
                                        page={page}
                                        token={token}
                                        index={i}
                                        fontSize={fontSize}
                                        accentColor={accentColor}
                                    />
                                </Trail>
                            </span>
                        </span>
                    );
                })}
            </div>
        </CaptionColumn>
    );
};

// ===========================================================================
// 2. BOUNCE — per-word spring pop with a staggered page rise
// ===========================================================================
const BouncePage: React.FC<PageRendererProps> = ({
    page,
    pageFrames,
    accentColor,
    fontSize,
    width,
    platform,
}) => {
    const bassIntensity = useBass();
    const { fps } = useVideoConfig();
    const frame = useCurrentFrame();
    const activeIdx = useActiveTokenIndex(page);
    const karaoke = useKaraokeProgress(page, activeIdx);
    const enter = pageEnterFrames(fps);
    const exit = pageExitFrames(fps);

    const rise = interpolate(frame, [0, enter], [0, 1], {
        easing: EASE_PLAYFUL_OVERSHOOT,
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });
    // The exit window must be a strictly increasing range. Deriving it as
    // `pageFrames - exit + 6` produced a DESCENDING range on short pages
    // (e.g. [48, 46]), and Remotion throws
    // "inputRange must be strictly monotonically increasing".
    const exitStart = Math.max(0, pageFrames - exit);
    const exitEnd = Math.max(exitStart + 1, pageFrames);
    const settle = interpolate(frame, [exitStart, exitEnd], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });

    return (
        <CaptionColumn platform={platform} width={width}>
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "center",
                    transform: `translateY(${(1 - rise) * 60}px) scale(${0.86 + rise * 0.14})`,
                    opacity: settle,
                }}
            >
                {page.tokens.map((token, i) => {
                    const isActive = i === activeIdx;
                    const tokenStart = Math.round(((token.fromMs - page.startMs) / 1000) * fps);
                    const wordIn = interpolate(
                        Math.max(0, frame - tokenStart),
                        [0, Math.max(2, enter + 4)],
                        [0, 1],
                        {
                            easing: EASE_PLAYFUL_OVERSHOOT,
                            extrapolateLeft: "clamp",
                            extrapolateRight: "clamp",
                        },
                    );
                    return (
                        <WordTokenSpan
                            key={`${i}-${token.fromMs}`}
                            token={token}
                            fontSize={fontSize}
                            weight={900}
                            color="#FFFFFF"
                            activeColor={accentColor}
                            isActive={isActive}
                            karaokeProgress={karaoke}
                            accentColor={accentColor}
                            uppercase
                            strokeWidth={2}
                            scale={(0.7 + wordIn * 0.3) * (isActive ? 1.08 + bassIntensity * 0.1 : 1)}
                            glow={isActive ? 22 : 0}
                        />
                    );
                })}
            </div>
        </CaptionColumn>
    );
};

// ===========================================================================
// 3. FADE — soft editorial cross-fade, exits on its OWN duration
// ===========================================================================
const FadePage: React.FC<PageRendererProps> = ({ page, pageFrames, fontSize, width, platform }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const enter = pageEnterFrames(fps);
    const exit = pageExitFrames(fps);

    const fadeIn = interpolate(frame, [0, enter + 4], [0, 1], {
        easing: EASE_EDITORIAL,
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });
    // pageFrames, NOT the composition duration — the old code used
    // useVideoConfig().durationInFrames, so the fade-out never fired.
    const fadeOut = interpolate(frame, [pageFrames - exit, pageFrames], [1, 0], {
        easing: EASE_EDITORIAL,
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });

    return (
        <CaptionColumn platform={platform} width={width}>
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "center",
                    gap: `${Math.round(fontSize * 0.16)}px`,
                    opacity: fadeIn * fadeOut,
                    transform: `translateY(${(1 - fadeIn) * 14}px)`,
                }}
            >
                {page.tokens.map((token, i) => (
                    <span
                        key={`${i}-${token.fromMs}`}
                        style={{
                            fontSize: fontSize * 0.94,
                            fontFamily: interFont,
                            fontWeight: 600,
                            color: "#FFFFFF",
                            whiteSpace: "pre",
                            paintOrder: "stroke fill",
                            WebkitTextStroke: "1.5px rgba(0,0,0,0.75)",
                            textShadow: "0 4px 14px rgba(0,0,0,0.7)",
                            display: "inline-block",
                        }}
                    >
                        {token.text}
                    </span>
                ))}
            </div>
        </CaptionColumn>
    );
};

// ===========================================================================
// 4. GLOW — bass-reactive bloom on the active word
// ===========================================================================
const GlowPage: React.FC<PageRendererProps> = ({
    page,
    accentColor,
    fontSize,
    width,
    platform,
}) => {
    const bassIntensity = useBass();
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const activeIdx = useActiveTokenIndex(page);
    const karaoke = useKaraokeProgress(page, activeIdx);
    // Pulse is time-based, not frame-index based, so it looks identical at 30
    // and 60 fps.
    const pulse = Math.sin((frame / fps) * 3.2) * 0.25 + 0.75;
    const bloom = pulse + bassIntensity * 0.6;

    return (
        <CaptionColumn platform={platform} width={width}>
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "center",
                    gap: `${Math.round(fontSize * 0.16)}px`,
                }}
            >
                {page.tokens.map((token, i) => {
                    const isActive = i === activeIdx;
                    return (
                        <WordTokenSpan
                            key={`${i}-${token.fromMs}`}
                            token={token}
                            fontSize={fontSize}
                            weight={800}
                            color="#FFFFFF"
                            activeColor={accentColor}
                            isActive={isActive}
                            karaokeProgress={karaoke}
                            accentColor={accentColor}
                            uppercase
                            strokeWidth={isActive ? 0 : 1.5}
                            scale={isActive ? 1 + bassIntensity * 0.1 : 1}
                            glow={isActive ? 30 * bloom : 0}
                        />
                    );
                })}
            </div>
        </CaptionColumn>
    );
};

// ===========================================================================
// 5. TYPEWRITER — reveals in time with the page, not the whole clip
// ===========================================================================
const TypewriterPage: React.FC<PageRendererProps> = ({
    page,
    pageFrames,
    fontSize,
    width,
    platform,
}) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const fullText = page.tokens.map((t) => t.text).join(" ");

    // Reveal relative to the page length (the old code used the composition
    // duration, so a 45s clip revealed ~1 character per page).
    const revealFrames = Math.max(2, Math.min(pageFrames - 2, Math.round(1.1 * fps)));
    const progress = interpolate(frame, [0, revealFrames], [0, 1], {
        easing: Easing.out(Easing.cubic),
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });
    const charsToShow = Math.floor(progress * fullText.length);
    const visible = fullText.slice(0, charsToShow);
    const showCursor = frame % Math.round(fps * 0.5) < Math.round(fps * 0.3);

    return (
        <CaptionColumn platform={platform} width={width}>
            <div
                style={{
                    fontSize: fontSize * 0.82,
                    fontFamily: interFont, // was monospace → DejaVu fallback in CI
                    fontWeight: 700,
                    color: "#FFFFFF",
                    textAlign: "left",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.2,
                    textShadow: "0 0 18px rgba(0,0,0,0.85), 0 4px 10px rgba(0,0,0,0.7)",
                    paintOrder: "stroke fill",
                    WebkitTextStroke: "1.5px rgba(0,0,0,0.7)",
                }}
            >
                {visible}
                {showCursor ? <span style={{ opacity: 0.65 }}>▌</span> : null}
            </div>
        </CaptionColumn>
    );
};

// ===========================================================================
// 6. GLITCH — RGB split with a deterministic, fps-normalised cadence
// ===========================================================================
const GlitchPage: React.FC<PageRendererProps> = ({
    page,
    accentColor,
    fontSize,
    width,
    platform,
}) => {
    const bassIntensity = useBass();
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const enter = pageEnterFrames(fps);
    const activeIdx = useActiveTokenIndex(page);
    const karaoke = useKaraokeProgress(page, activeIdx);

    // ── 9.4: deterministic simplex noise (@remotion/noise) ─────────────────
    // Replaces Math.sin(frame*N): noise2D is a pure function of (seed, x, y),
    // so every frame renders identically across renders/fps, while producing
    // the irregular, non-cyclic jitter the sine approximation could not.
    // Coordinates are expressed in SECONDS so the cadence does not change with
    // fps. Intensities are unchanged: same strength, same opacity, same
    // ~1/3-active duty cycle (threshold 0.3 on a [-1,1] field).
    const seconds = frame / fps;
    const glitchField = noise2D("clipmint-glitch-cadence", seconds * 7, 0);
    const glitchActive = glitchField > 0.3;
    const strength = glitchActive ? 2.5 + bassIntensity * 7 : 0;
    const offset = glitchActive ? noise2D("clipmint-glitch-offset", seconds * 62, 0) * strength : 0;

    const entrance = interpolate(frame, [0, enter], [0, 1], {
        easing: EASE_CRISP_ENTER,
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });

    return (
        <CaptionColumn platform={platform} width={width}>
            <div style={{ position: "relative", transform: `scale(${entrance})` }}>
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center" }}>
                    {page.tokens.map((token, i) => (
                        <WordTokenSpan
                            key={`${i}-${token.fromMs}`}
                            token={token}
                            fontSize={fontSize}
                            weight={900}
                            color="#FFFFFF"
                            activeColor={accentColor}
                            isActive={i === activeIdx}
                            karaokeProgress={karaoke}
                            accentColor={accentColor}
                            uppercase
                            strokeWidth={2}
                            scale={1}
                        />
                    ))}
                </div>
                {/* Chromatic ghosts, offset in opposite directions */}
                <div
                    aria-hidden
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        flexWrap: "wrap",
                        justifyContent: "center",
                        color: "#FF0040",
                        mixBlendMode: "screen",
                        opacity: glitchActive ? 0.55 : 0,
                        transform: `translate(${offset}px, ${-offset * 0.5}px)`,
                        pointerEvents: "none",
                    }}
                >
                    {page.tokens.map((token, i) => (
                        <span
                            key={`r-${i}-${token.fromMs}`}
                            style={{
                                fontSize,
                                fontFamily: interFont,
                                fontWeight: 900,
                                textTransform: "uppercase",
                                whiteSpace: "pre",
                            }}
                        >
                            {token.text}
                        </span>
                    ))}
                </div>
                <div
                    aria-hidden
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        flexWrap: "wrap",
                        justifyContent: "center",
                        color: "#00FFFF",
                        mixBlendMode: "screen",
                        opacity: glitchActive ? 0.55 : 0,
                        transform: `translate(${-offset}px, ${offset * 0.5}px)`,
                        pointerEvents: "none",
                    }}
                >
                    {page.tokens.map((token, i) => (
                        <span
                            key={`c-${i}-${token.fromMs}`}
                            style={{
                                fontSize,
                                fontFamily: interFont,
                                fontWeight: 900,
                                textTransform: "uppercase",
                                whiteSpace: "pre",
                            }}
                        >
                            {token.text}
                        </span>
                    ))}
                </div>
            </div>
        </CaptionColumn>
    );
};

// ===========================================================================
// 7. NEON — layered bloom with a real ignition flicker
// ===========================================================================
const NeonPage: React.FC<PageRendererProps> = ({
    page,
    accentColor,
    fontSize,
    width,
    platform,
}) => {
    const bassIntensity = useBass();
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const seconds = frame / fps;

    // Ignition: a brief irregular flicker for the first ~0.35s, then steady.
    // 9.4: noise2D instead of Math.sin — same 0.35 / -0.3 thresholds and
    // intensities, but the flicker pattern is now aperiodic and deterministic.
    const igniting = seconds < 0.35;
    const flicker = igniting
        ? noise2D("clipmint-neon-flicker", seconds * 90, 0) > -0.3
            ? 1
            : 0.35
        : 1;
    const bloom = 1 + bassIntensity * 0.5;

    return (
        <CaptionColumn platform={platform} width={width}>
            <div
                style={{
                    fontSize,
                    fontFamily: interFont,
                    fontWeight: 700, // 300 was never loaded — it silently fell back
                    color: "#FFFFFF",
                    opacity: flicker,
                    textTransform: "uppercase",
                    letterSpacing: 3,
                    whiteSpace: "pre",
                    textShadow: `
                        0 0 ${5 * bloom}px ${accentColor},
                        0 0 ${11 * bloom}px ${accentColor},
                        0 0 ${22 * bloom}px ${accentColor},
                        0 0 ${44 * bloom}px ${accentColor}aa,
                        0 0 ${80 * bloom}px ${accentColor}55
                    `,
                }}
            >
                {page.tokens.map((t) => t.text).join(" ")}
            </div>
        </CaptionColumn>
    );
};

// ===========================================================================
// 8. COLORFUL — rainbow words, spoken words at full strength
// ===========================================================================
const RAINBOW_COLORS = [
    "#FF6B6B",
    "#FFA07A",
    "#FFD93D",
    "#6BCB77",
    "#4D96FF",
    "#9B59B6",
    "#FF6B9D",
    "#00D2FF",
];

const ColorfulPage: React.FC<PageRendererProps> = ({
    page,
    accentColor,
    fontSize,
    width,
    platform,
}) => {
    const bassIntensity = useBass();
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const activeIdx = useActiveTokenIndex(page);
    const enter = pageEnterFrames(fps);

    return (
        <CaptionColumn platform={platform} width={width}>
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "center",
                    gap: `${Math.round(fontSize * 0.14)}px`,
                }}
            >
                {page.tokens.map((token, i) => {
                    const tokenStart = Math.round(((token.fromMs - page.startMs) / 1000) * fps);
                    const entrance = interpolate(
                        Math.max(0, frame - tokenStart),
                        [0, enter + 4],
                        [0, 1],
                        {
                            easing: EASE_PLAYFUL_OVERSHOOT,
                            extrapolateLeft: "clamp",
                            extrapolateRight: "clamp",
                        },
                    );
                    const isActive = i === activeIdx;
                    // Previously un-spoken words were permanently dimmed to 0.5,
                    // which reads as a rendering bug. They now animate in fully.
                    return (
                        <span
                            key={`${i}-${token.fromMs}`}
                            style={{
                                fontSize,
                                fontFamily: interFont,
                                fontWeight: 900,
                                color: isActive ? accentColor : RAINBOW_COLORS[i % RAINBOW_COLORS.length],
                                transform: `scale(${entrance * (isActive ? 1.07 + bassIntensity * 0.08 : 1)}) rotate(${(1 - entrance) * -8}deg)`,
                                display: "inline-block",
                                whiteSpace: "pre",
                                paintOrder: "stroke fill",
                                WebkitTextStroke: "1.5px rgba(0,0,0,0.55)",
                                textShadow: "0 4px 10px rgba(0,0,0,0.6)",
                            }}
                        >
                            {token.text}
                        </span>
                    );
                })}
            </div>
        </CaptionColumn>
    );
};

// ===========================================================================
// 9. MINIMAL — frosted glass card, exit timed to the page
// ===========================================================================
const MinimalPage: React.FC<PageRendererProps> = ({
    page,
    pageFrames,
    fontSize,
    width,
    platform,
}) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const enter = pageEnterFrames(fps);
    const exit = pageExitFrames(fps);

    const entrance = interpolate(frame, [0, enter + 2], [0, 1], {
        easing: EASE_CRISP_ENTER,
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });
    const exitOpacity = interpolate(frame, [pageFrames - exit, pageFrames], [1, 0], {
        easing: Easing.in(Easing.cubic),
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });

    return (
        <CaptionColumn platform={platform} width={width}>
            <div
                style={{
                    display: "inline-block",
                    backgroundColor: "rgba(12,12,14,0.72)",
                    padding: `${Math.round(fontSize * 0.3)}px ${Math.round(fontSize * 0.5)}px`,
                    borderRadius: 16,
                    opacity: entrance * exitOpacity,
                    transform: `translateY(${(1 - entrance) * 18}px)`,
                    boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        flexWrap: "wrap",
                        justifyContent: "center",
                        gap: `${Math.round(fontSize * 0.16)}px`,
                    }}
                >
                    {page.tokens.map((token, i) => (
                        <span
                            key={`${i}-${token.fromMs}`}
                            style={{
                                fontSize: fontSize * 0.8,
                                fontFamily: interFont,
                                fontWeight: 600,
                                color: "#FFFFFF",
                                letterSpacing: 0.3,
                                whiteSpace: "pre",
                                display: "inline-block",
                            }}
                        >
                            {token.text}
                        </span>
                    ))}
                </div>
            </div>
        </CaptionColumn>
    );
};
