"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { IconArrowLeft, IconArrowRight, IconPause, IconPlay } from "./Icons";
import { useReducedMotion } from "./SectionReveal";

/**
 * The showcase — a horizontal carousel of finished 9:16 clips.
 *
 * Contract:
 * - Reads `public/showcase/manifest.json` at runtime.
 * - Each entry: `{ src, poster, title, duration }` (see the manifest's
 *   `_readme` field for the exact schema and how to add real clips).
 * - Draggable (pointer events), arrow controls, scroll-snap points.
 * - Real clips autoplay muted when they enter the viewport or on hover,
 *   show the poster frame while idle, and carry a title + duration overlay.
 * - Empty slots (no `src`) render generated gradient poster art with a
 *   play affordance — nothing looks broken before real clips land.
 * - prefers-reduced-motion: no autoplay; clips play only on explicit click.
 */

export type ShowcaseClip = {
  src: string | null;
  poster?: string | null;
  title: string;
  duration: string;
  style?: string;
  hue?: "mint" | "marigold" | "emerald" | "slate";
};

type Manifest = { _readme?: string; clips?: ShowcaseClip[] };

const HUES: NonNullable<ShowcaseClip["hue"]>[] = ["mint", "marigold", "emerald", "slate"];

const POSTER_WORDS: [string, string][] = [
  ["EK VIDEO.", "DAS CLIPS."],
  ["STUDIO-MADE", "CAPTIONS."],
  ["HOOK.", "PAYOFF."],
  ["SPEAKER", "ON CAMERA"],
  ["CUT", "ON THE WORD"],
  ["9:16", "PLATFORM-READY"],
];

const PLACEHOLDER_CLIPS: ShowcaseClip[] = [
  { src: null, title: "Your clip lands here", duration: "0:12", style: "Hormozi", hue: "mint" },
  { src: null, title: "Your clip lands here", duration: "0:18", style: "Glow", hue: "marigold" },
  { src: null, title: "Your clip lands here", duration: "0:09", style: "Typewriter", hue: "emerald" },
  { src: null, title: "Your clip lands here", duration: "0:21", style: "Minimal", hue: "slate" },
  { src: null, title: "Your clip lands here", duration: "0:14", style: "Bounce", hue: "mint" },
  { src: null, title: "Your clip lands here", duration: "0:16", style: "Neon", hue: "marigold" },
];

export default function ShowcaseCarousel() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [clips, setClips] = useState<ShowcaseClip[]>(PLACEHOLDER_CLIPS);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ down: false, startX: 0, startLeft: 0 });

  /* Load the manifest; fall back to the generated poster slots. */
  useEffect(() => {
    let cancelled = false;
    fetch("/showcase/manifest.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Manifest | null) => {
        if (cancelled) return;
        const list = data?.clips;
        if (
          Array.isArray(list) &&
          list.length > 0 &&
          list.every((c) => c && typeof c.title === "string")
        ) {
          setClips(list);
        }
      })
      .catch(() => {
        /* manifest missing → ship the generated poster slots */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scrollByCard = useCallback(
    (dir: 1 | -1) => {
      const el = scrollerRef.current;
      if (!el) return;
      const card = el.querySelector<HTMLElement>("[data-card]");
      const step = (card ? card.offsetWidth : 280) + 20;
      el.scrollBy({ left: dir * step, behavior: reduced ? "auto" : "smooth" });
    },
    [reduced]
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (!el) return;
    drag.current = { down: true, startX: e.clientX, startLeft: el.scrollLeft };
    el.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    const d = drag.current;
    if (!el || !d.down) return;
    el.scrollLeft = d.startLeft - (e.clientX - d.startX);
  };
  const endDrag = () => {
    drag.current.down = false;
    setDragging(false);
  };

  return (
    <div className="select-none">
      <div
        ref={scrollerRef}
        role="region"
        aria-label="Finished clip showcase. Drag to browse; clips autoplay when in view."
        tabIndex={0}
        className={`showcase-scroller ${dragging ? "is-dragging" : ""} cursor-grab`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {clips.map((clip, i) => (
          <ShowcaseCard key={`${clip.title}-${i}`} clip={clip} index={i} />
        ))}
      </div>

      {/* Controls */}
      <div className="mt-6 flex items-center justify-center gap-4">
        <button
          type="button"
          className="showcase-arrow"
          onClick={() => scrollByCard(-1)}
          aria-label="Scroll to previous clips"
        >
          <IconArrowLeft className="w-5 h-5" />
        </button>
        <span className="cm-eyebrow text-ink-500 px-2">
          Drag to browse · hover to play
        </span>
        <button
          type="button"
          className="showcase-arrow"
          onClick={() => scrollByCard(1)}
          aria-label="Scroll to next clips"
        >
          <IconArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

/* ── One 9:16 card: video (or generated poster) + overlay ── */

function ShowcaseCard({ clip, index }: { clip: ShowcaseClip; index: number }) {
  const cardRef = useRef<HTMLElement>(null);
  const vidRef = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const hasVideo = Boolean(clip.src);
  const [playing, setPlaying] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const flags = useRef({ inView: false, hover: false, manual: false });

  const applyPlayback = useCallback(() => {
    const vid = vidRef.current;
    if (!vid) return;
    const f = flags.current;
    const want = !reduced && !videoFailed && !f.manual && (f.inView || f.hover);
    if (want) {
      vid.play().then(() => setPlaying(true)).catch(() => {
        /* autoplay denied (e.g. low power / data saver) — stay on poster */
        setPlaying(false);
      });
    } else {
      vid.pause();
      setPlaying(false);
    }
  }, [reduced, videoFailed]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card || !hasVideo || reduced) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        flags.current.inView = Boolean(entry?.isIntersecting);
        if (!entry?.isIntersecting) {
          flags.current.manual = false;
          const vid = vidRef.current;
          if (vid) vid.currentTime = 0;
        }
        applyPlayback();
      },
      { threshold: 0.55 }
    );
    io.observe(card);
    return () => {
      io.disconnect();
      vidRef.current?.pause();
    };
  }, [hasVideo, reduced, applyPlayback]);

  const toggleManual = () => {
    const f = flags.current;
    if (f.manual) {
      f.manual = false;
      applyPlayback();
      return;
    }
    f.manual = true;
    const vid = vidRef.current;
    if (vid) {
      vid.play().then(() => setPlaying(true)).catch(() => {
        f.manual = false;
        setPlaying(false);
      });
    }
  };

  return (
    <article
      ref={cardRef}
      data-card="true"
      className="showcase-card"
      aria-label={hasVideo ? `${clip.title} — ${clip.duration}` : `${clip.title} — reserved showcase slot`}
    >
      <div className="showcase-frame">
        {/* Generated gradient poster — always present behind the video */}
        <ClipPoster clip={clip} index={index} />

        {hasVideo && (
          <video
            ref={vidRef}
            className="showcase-video"
            muted
            loop
            playsInline
            preload="none"
            disablePictureInPicture
            poster={clip.poster ?? undefined}
            onError={() => setVideoFailed(true)}
          >
            <source src={clip.src ?? undefined} type="video/mp4" />
          </video>
        )}

        {/* Title + duration overlay */}
        <div className="showcase-meta">
          <span className="showcase-title">{clip.title}</span>
          <span className="showcase-duration">{clip.duration}</span>
        </div>

        {/* Explicit play toggle for real clips */}
        {hasVideo && !reduced && (
          <button
            type="button"
            className={`showcase-play ${playing ? "is-playing" : ""}`}
            onClick={toggleManual}
            aria-pressed={playing}
            aria-label={playing ? `Pause ${clip.title}` : `Play ${clip.title}`}
          >
            {playing ? (
              <IconPause className="w-4 h-4" />
            ) : (
              <IconPlay className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
    </article>
  );
}

/* ── Generated poster — layered gradient art + caption type ── */

function ClipPoster({ clip, index }: { clip: ShowcaseClip; index: number }) {
  const hue = clip.hue ?? HUES[index % HUES.length];
  const words = POSTER_WORDS[index % POSTER_WORDS.length];
  const styleName = clip.style ?? "Captions";
  const isSlot = !clip.src;

  return (
    <div className={`clip-poster poster-${hue}`} aria-hidden="true">
      {isSlot && <div className="clip-poster-slot" />}

      <div className="clip-poster-words">
        <span className="clip-poster-word">{words[0]}</span>
        <span className="clip-poster-word mint">{words[1]}</span>
      </div>

      {isSlot && (
        <div className="clip-poster-play">
          <IconPlay className="w-5 h-5 ml-0.5" />
        </div>
      )}

      <span className="clip-poster-style">{styleName}</span>
    </div>
  );
}