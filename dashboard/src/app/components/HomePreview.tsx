"use client";

import { useRef, useState } from "react";
import { Check, ChevronRight, CirclePlay, Film, Layers3, Pause, Play } from "lucide-react";

const STYLES = [
    { key: "hormozi", name: "Hormozi" },
    { key: "minimal", name: "Minimal" },
    { key: "typewriter", name: "Typewriter" },
] as const;

/** Interactive sample typography, clearly distinguished from a rendered clip. */
export function CaptionStudioPreview() {
    const [style, setStyle] = useState<typeof STYLES[number]["key"]>("hormozi");
    return <div className="home-studio-preview" aria-label="Interactive caption style sample">
        <div className="home-preview-toolbar"><span><Film size={17} aria-hidden="true" />Your next great clip</span><span className="home-preview-tag">Style preview</span></div>
        <div className="home-preview-workspace">
            <div className="home-preview-sidebar"><span className="home-preview-step"><Check size={13} aria-hidden="true" /></span><span className="home-preview-step is-current"><Layers3 size={16} aria-hidden="true" /></span><span className="home-preview-step"><ChevronRight size={16} aria-hidden="true" /></span></div>
            <div className={`home-caption-stage home-caption-stage--${style}`}>
                <span className="home-stage-label">Sample text · 9:16</span>
                <p>Small moments.<br /><em>Big stories.</em></p>
                <span className="home-stage-footer">Made to be shared.</span>
            </div>
            <div className="home-preview-controls"><span className="home-control-label">Caption style</span><div role="group" aria-label="Preview caption style">{STYLES.map((item) => <button type="button" aria-pressed={style === item.key} key={item.key} onClick={() => setStyle(item.key)}>{item.name}{style === item.key && <Check size={14} aria-hidden="true" />}</button>)}</div><span className="home-control-label">Built for the feed</span><span className="home-format-chip">Vertical format</span><span className="home-format-chip">Readable captions</span><p className="home-preview-note">Try a style.<br />Make it yours.</p></div>
        </div>
        <div className="home-preview-timeline"><CirclePlay size={17} aria-hidden="true" /><div><span /><span /><span /></div><span>From moment to clip</span></div>
    </div>;
}

/** Existing CC-BY fixture; no autoplay or placeholder clips passed off as real. */
export function HomeDemoVideo() {
    const video = useRef<HTMLVideoElement>(null);
    const [playing, setPlaying] = useState(false);
    const [failed, setFailed] = useState(false);
    async function toggle() {
        if (!video.current || failed) return;
        if (video.current.paused) {
            try { await video.current.play(); } catch { setFailed(true); }
        } else video.current.pause();
    }
    return <div className="home-demo-player">
        <div className="home-demo-media">
            {failed ? <div className="home-demo-failed"><Film size={28} aria-hidden="true" /><p>The demo couldn’t load.</p><a href="/showcase/clips/sintel-demo.mp4">Open the video directly</a></div> : <video ref={video} poster="/showcase/posters/sintel-demo.jpg" controls playsInline preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setFailed(true)}><source src="/showcase/clips/sintel-demo.mp4" type="video/mp4" /></video>}
            <span className="home-demo-label">Real render · demo footage</span>
        </div>
        <div className="home-demo-player-footer"><div><strong>Sintel · vertical demo</strong><span>12 seconds · 9:16 format</span></div><button type="button" onClick={() => void toggle()} disabled={failed} aria-label={playing ? "Pause the demo" : "Play the demo"}>{playing ? <Pause size={19} aria-hidden="true" /> : <Play size={19} aria-hidden="true" />}</button></div>
        <p className="home-demo-credit">Silent demo · Sintel © Blender Foundation · <a href="https://durian.blender.org/" target="_blank" rel="noopener noreferrer">CC-BY 3.0</a></p>
    </div>;
}
