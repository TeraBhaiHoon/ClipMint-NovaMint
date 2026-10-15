# ClipMint — Video Engines, Timeline Formats, Auto-Editing, Composition & Render Orchestration

**Research doc:** `docs/research/01-video-engines.md`
**Audience:** ClipMint engineering
**Scope:** Open-source NLE/interchange engines, programmatic editors, auto-editing intelligence, multi-format composition, and render orchestration/scale — evaluated for an **enterprise-grade, commercial SaaS** (ClipMint ships paid tiers in ₹, so GPL/AGPL and non-OSI licences are hard blockers unless isolated).

> **How to read this doc.** Every tool has: name, GitHub URL, stars (as rendered on the repo page at research time), **licence** (⚠️ = commercial-SaaS risk), language, recency signal, and a concrete adoption recommendation. Star counts and prices are point-in-time snapshots and drift; re-verify before a build decision. Recency is reported as the observable signal (release version, commit count, CI status) — I did not fabricate exact commit dates.

---

## 0. Executive summary

ClipMint today is a **GitHub-Actions-orchestrated, FFmpeg + Remotion pipeline** with:
- `pipeline/auto_edit.py` — transcript-gap silence removal (word-timestamp driven, with word remapping)
- `pipeline/audio_energy.py` — `ffmpeg astats` RMS energy summaries fed to the LLM
- `pipeline/smart_reframe.py` — OpenCV face-tracking reframe (degrades to centre-crop)
- `pipeline/enhance_audio.py` — FFmpeg-only audio cleanup
- `modal/enhance_app.py` — Modal GPU enhancement
- `remotion-captions/` — 9 caption styles, React/Remotion

So the stack is already **FFmpeg-first + Remotion-for-captions + GitHub-Actions-as-the-scheduler**. The highest-leverage research findings are therefore:

1. **Add a real timeline IR (OTIO)** so clip plans, EDL/FCPXML round-trips, and future NLE export stop being ad-hoc JSON.
2. **Upgrade the cut planner** from "word-gap silence" to a **scene + audio-energy + beat** hybrid (PySceneDetect + `astats`/librosa onset), which is the single biggest perceived-quality lever for short-form.
3. **Adopt FFmpeg `xfade`/`xstack` + NVENC** for transitions, split-screen/PIP and hardware encode — pure CLI, zero new licences.
4. **Treat GitHub Actions as a scheduler, not a renderer.** Move fan-out to Modal (already integrated) or RunPod, and shard renders per-clip.
5. **Watch the Remotion licence.** It is *not* OSI open source; a 4+ person company running automated batch rendering must pay ($0.01/render, $100/mo minimum). Budget it now.

---
## 1. Timeline / Interchange Formats & NLE Engines

### 1.1 OpenTimelineIO (OTIO) — ⭐ recommended
- **URL:** https://github.com/AcademySoftwareFoundation/OpenTimelineIO · site: https://opentimeline.io
- **Stars:** 2.0k · **Licence:** Apache-2.0 ✅ · **Language:** C++ core + Python bindings
- **Recency:** Actively maintained under the Academy Software Foundation (ASWF); 865 commits on `main`, versioned releases, 0.19.0.dev docs live.
- **What it is:** An API + interchange format for editorial timeline data. Core schema = `Timeline → Stack → Track → Clip/Gap/Transition`, with `RationalTime` (value + rate) so frame-accurate maths never drifts.

**Adapters** (per the OTIO adapters docs):
- **Core (bundled):** `otio_json` (`.otio`), `otiod` (directory bundle), `otioz` (zip bundle with media).
- **Batteries-included (`OpenTimelineIO-Plugins` on PyPI):** `aaf`, `ale`, `burnins`, `cmx_3600` (CMX EDL), `fcp_xml` (Final Cut Pro XML), `maya_sequencer`, `svg`, `xges` (GStreamer).
- **Additional:** `kdenlive`, `fcpx_xml` (FCPXML), `hls_playlist`.

**Python snippet (ClipMint clip-plan → OTIO):**
```python
import opentimelineio as otio

def clip_plan_to_otio(plan, rate=30.0):
    """plan = [{start_s, end_s, name, path}] -> OTIO timeline."""
    tl = otio.schema.Timeline(name="clipmint-v1")
    track = otio.schema.Track(kind=otio.schema.TrackKind.Video)
    cursor = otio.opentime.RationalTime(0, rate)
    for seg in plan:
        start = otio.opentime.RationalTime(seg["start_s"] * rate, rate)
        dur   = otio.opentime.RationalTime((seg["end_s"] - seg["start_s"]) * rate, rate)
        if (start - cursor).value > 0:
            track.append(otio.schema.Gap(source_range=start - cursor))
        track.append(otio.schema.Clip(
            name=seg["name"],
            source_range=otio.opentime.TimeRange(start, dur),
            media_reference=otio.schema.ExternalReference(
                target_url=f"file://{seg['path']}",
                available_range=otio.opentime.TimeRange(start, dur)),
        ))
        cursor = start + dur
    tl.tracks.append(track)
    return tl

tl = clip_plan_to_otio(plan)
otio.adapters.write_to_file(tl, "clip_plan.otio")   # or .otioz to bundle media
```

**Recommendation:** **Adopt OTIO as ClipMint's internal timeline IR.** Apache-2.0 (safe), industry standard (Netflix/Pixar/Autodesk-adjacent tooling), and it gives three things for free: (a) a stable, versioned schema for the "viral moment → clip plan" object that today lives as bespoke JSON; (b) one-line export to `cmx_3600` EDL and FCPXML so an agency tier can hand a plan to Premiere/Resolve; (c) `.otioz` as a self-contained deliverable bundle. Effort is low: a ~150-line adapter + an `--export-edl` flag on the existing plan stage. Do **not** adopt OTIO as the *renderer* — keep FFmpeg as executor; OTIO is the plan, not the pipeline.

### 1.2 MLT Framework — ⚠️ LGPL, powerful but heavy
- **URL:** https://github.com/mltframework/mlt · https://mltframework.org
- **Stars:** 1.9k · **Licence:** **LGPL-2.1** ⚠️ (weak copyleft — usable in SaaS if dynamically linked and unmodified, but needs legal sign-off) · **Language:** C/C++
- **Recency:** Very active; 6,785 commits, CMake presets, dev-container support, `melt` CLI.
- **What it is:** The engine behind **Shotcut** and **Kdenlive**. Producer/Filter/Consumer graph, `melt` command line, XML `.mlt` project format, frei0r/LADSPA/OpenGL filters.

**Recommendation:** **Do not adopt as the core.** MLT duplicates what FFmpeg already gives ClipMint, adds a C build dependency and a licensing question, and its real value is *interactive* multi-track editing — which a batch repurposer does not need. Its `melt` CLI and `.mlt` XML are a good reference for filter-graph serialisation. If you ever ship a desktop preview editor, MLT (via Shotcut) is the fastest path — but for the SaaS, stay on FFmpeg.


### 1.3 GStreamer Editing Services (GES) — ⚠️ LGPL, wrong shape for batch
- **URL:** https://gstreamer.freedesktop.org/documentation/gst-editing-services/index.html
- **Licence:** **LGPL** (GStreamer core LGPL; some plugins GPL) ⚠️ · **Language:** C (Python/JS/Rust bindings)
- **What it is:** `GESTimeline` / `GESLayer` / `GESClip` / `GESTrack` / `GESPipeline` on top of GStreamer + GNonLin, plus `GESFormatter` save/load and an `xges` project format (which OTIO can read via its `xges` adapter).

**Recommendation:** **Skip for ClipMint.** GES is built for *live/streaming and interactive* editing where a running clock matters; ClipMint's workload is offline batch transcoding where FFmpeg `filter_complex` is faster to write and trivially parallelisable. The one thing worth stealing is the **`xges` ↔ OTIO bridge** — adopting OTIO gives you GES project import for free without depending on GStreamer. Revisit only if you add live capture.

### 1.4 Blender Video Sequence Editor (VSE) — ⚠️ GPL, blocker
- **URL:** https://docs.blender.org/manual/en/latest/video_editing/index.html
- **Licence:** **GPL** ⚠️ **hard blocker** for a commercial SaaS if linked/shipped in-product.
- **What it is:** A full video sequencer (channels, strips, transitions, effects) with **Python scripting** and **headless render** (`blender -b file.blend -a`).

**Recommendation:** **Avoid in the product path.** GPL + a ~200 MB dependency to do what `ffmpeg` does in one line is a bad trade. The only legitimate use is as an *offline authoring* tool for motion-graphics templates you bake to rendered assets (GPL attaches to derived code, not rendered output). Not worth the compliance overhead.

### 1.5 VapourSynth — ⚠️ LGPL, niche but keep in reserve
- **URL:** https://github.com/vapoursynth/vapoursynth · https://www.vapoursynth.com
- **Stars:** 2.1k · **Licence:** **LGPL-2.1** ⚠️ · **Language:** C++ with a **Python scripting API** (frameserver model)
- **Recency:** Active; 5,252 commits on `master`.

**Recommendation:** **Interesting, not yet needed.** VapourSynth is a *scriptable frame server* — excellent for frame-exact restoration, denoise and quality work, with an ergonomic Python API. ClipMint does not currently do frame-level restoration. **Keep in reserve** for a "quality/pro" tier (deblocking, denoise, high-quality 1080×1920 downscale) where FFmpeg filters are weaker. LGPL is manageable; do not build the core on it.

### 1.6 libavfilter / `filter_complex` patterns — ✅ the workhorse
- **URL:** https://ffmpeg.org/ffmpeg-filters.html
- **Licence:** LGPL by default; ⚠️ note `libx264`/`libx265` are **GPL**-licensed components. The safe SaaS pattern — which ClipMint **already uses** — is to invoke the FFmpeg **binary via subprocess** rather than linking `libav*`, which keeps you in "separate program / mere aggregation" territory. Keep it that way.

**Key patterns** (all CLI, no new deps):
- **Trim + concat** (already used in `auto_edit.py`):
  `[0:v]trim=start=..:end=..,setpts=PTS-STARTPTS[v0]` … `concat=n=N:v=1:a=0[vout]`
- **Vertical reframe + cover-crop:** `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`
- **Blur-pad letterbox:** `split[a][b];[a]scale=1080:1920,gblur=sigma=20[bg];[b]scale=1080:-1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`
- **Loudness normalise to platform target:** `loudnorm=I=-14:TP=-1.5:LRA=11` (≈ YouTube/TikTok -14 LUFS)

**Recommendation:** **Double down.** FFmpeg `filter_complex` is ClipMint's most under-used asset. Build a small internal *filter-graph builder* module (Python functions returning graph strings) so graphs are composable and unit-testable, instead of hand-concatenating strings inline as `auto_edit.py` does today. Highest-ROI refactor in the rendering layer.

---

## 2. Programmatic Video Editors

### 2.1 MoviePy 2.x — ✅ Python-side prototyping, not the render core
- **URL:** https://github.com/Zulko/moviepy · **Stars:** 14.9k · **Licence:** MIT ✅ · **Language:** Python
- **Recency:** **v2.0 released (major breaking changes); v1 no longer maintained**; 1,532 commits; active maintainers.
- **What it is:** Pythonic NLE — cuts, concatenations, titles, compositing, effects, GIF/MP4/WebM. v2 renamed the API (`subclipped`, `with_volume_scaled`, `with_position`).

```python
from moviepy import VideoFileClip, TextClip, CompositeVideoClip
clip = VideoFileClip("in.mp4").subclipped(10, 20).with_volume_scaled(0.8)
txt  = TextClip(font="Arial.ttf", text="Hello", font_size=70, color="white").with_duration(10).with_position("center")
CompositeVideoClip([clip, txt]).write_videofile("out.mp4")
```

**Recommendation:** **Adopt narrowly, as an offline authoring/prototyping tool — never in the hot render path.** MoviePy's own README warns it is "slower than using ffmpeg directly due to heavier data import/export operations" (it decodes frames into numpy). For a SaaS billing per clip, that CPU tax is a margin killer. Use it to prototype effect recipes and generate one-off assets, then port the recipe to a `filter_complex` string. Keep it out of the render container's `requirements.txt`.

### 2.2 auto-editor (WyattBlue) — ⭐ best-in-class silence/motion cutter
- **URL:** https://github.com/WyattBlue/auto-editor · https://auto-editor.com
- **Stars:** 5.4k · **Licence:** **Unlicense (public domain)** ✅ — most permissive in this report · **Language:** Nim (static binary)
- **Recency:** Very active; 2,533 commits; ships a `skills/` folder (`npx skills add`) — AI-agent friendly.
- **What it is:** CLI auto-editor that cuts "dead space" by **audio loudness** or **motion**, with `--margin` padding, multi-track rules, dB thresholds, and **NLE export** (`--export premiere|resolve|final-cut-pro|shotcut|kdenlive|clip-sequence`).

```bash
auto-editor in.mp4 --edit audio:-19dB --margin 0.3s,1.5sec
auto-editor in.mp4 --edit "motion:threshold=0.02"            # cut static scenes
auto-editor in.mp4 --edit:2 audio:-12dB --when:2 speed:1.5   # speed up loud parts
auto-editor in.mp4 --export premiere                         # XML for Premiere
```

**Recommendation:** **Adopt the *ideas* and NLE-export formats immediately; consider the binary for a "jump-cut" feature.** ClipMint's `auto_edit.py` already does transcript-gap silence removal with word remapping — arguably *better* than pure-loudness cutting because music beds don't get chopped (its own docstring makes this point). So do **not** rip-and-replace. Instead: (a) borrow the **`--edit motion`** detector as a second signal for B-roll/no-speech segments; (b) copy its **export targets** — an `--export` flag writing Premiere/Resolve XML is a killer agency-tier feature and maps onto the OTIO adoption above (OTIO already has `fcp_xml`/`cmx_3600`). Unlicense = lift code with zero obligation.

### 2.3 Editly — ✅ best reference for declarative JSON→video
- **URL:** https://github.com/mifi/editly · **Stars:** 5.5k · **Licence:** MIT ✅ · **Language:** TypeScript/Node (FFmpeg + GLSL shaders)
- **Recency:** 430 commits; solo maintainer (bus-factor risk).
- **What it is:** **Declarative NLE** — describe a video as a JSON5 spec (clips, images, audio, titles, transitions, Ken Burns, `position`, `resizeMode`) and it renders via streaming FFmpeg. Ships GLSL shader transitions.

**Recommendation:** **Adopt the *spec-as-JSON* pattern and the shader list; don't add the Node dependency.** Editly proves that a declarative spec + streaming FFmpeg is the right architecture for a repurposer — exactly the OTIO-as-IR idea. Its `position`/`resizeMode`/Ken-Burns vocabulary is a ready-made schema for ClipMint's clip-layout object. ClipMint already has Remotion on the React side, so adding Editly duplicates it. **Steal the JSON schema + gl-transitions shader names**, implement with FFmpeg `xfade`/`overlay`.


### 2.4 Remotion — ⚠️ NOT open source; licence + price gate
- **URL:** https://github.com/remotion-dev/remotion · https://remotion.dev
- **Stars:** 61.5k · **Licence:** **Proprietary "Remotion License"** ⚠️⚠️ — *not* OSI-approved; source visible but commercial use is gated.
- **Language:** TypeScript/React · **Recency:** Extremely active; 37,960 commits; ships `@remotion/lambda`, `@remotion/player`, AI agent skills.

**Licence terms (verbatim from LICENSE.md + pricing page):**
- **Free License** for **individuals**, **for-profit orgs with up to 3 employees**, non-profits, and evaluation.
- **Company License required for 4+ employees / collaborations.** Two SKUs:
  - **Remotion for Automators — $0.01 per render, $100/mo minimum** (exactly ClipMint's use case: batch rendering inside a product).
  - **Remotion for Creators** — $25/seat/mo. **Enterprise** from **$500/mo**.
- Disallowed: reselling/relicensing a Remotion derivative.

**Recommendation:** **Keep Remotion for what it's good at (animated captions), budget the licence, and preserve an escape hatch.** ClipMint already has a 9-style caption engine in `remotion-captions/` — Remotion's sweet spot (React layout, springs, DOM text measurement), and rewriting would be wasteful. **Actions:** (1) decide whether ClipMint is "≤3 employees" — if not, **budget $100/mo + $0.01/render now** (10k renders/mo ≈ $200/mo; 200k ≈ $2,100/mo); (2) keep captions **decoupled** from the rest of the render so you *could* migrate to **Revideo (MIT)** or FFmpeg `subtitles`/`drawtext` if licence cost ever exceeds value; (3) never ship Remotion as a user-facing editor without the Automators licence.

### 2.5 Revideo — ✅ the MIT escape hatch from Remotion
- **URL:** https://github.com/redotvideo/revideo (now midrender/revideo) · **Stars:** 4.1k · **Licence:** MIT ✅ · **Language:** TypeScript
- **Recency:** 1,143 commits; active; engine behind Midrender.
- **What it is:** A rendering engine for "videos in code" — TypeScript scenes (shapes/text/media/animation) with a **headless render API**, a **React `<Player/>`** for preview, **parallelized rendering** (split a render across workers), and `<Video/>`/`<Audio/>` with frame-accurate sync. Forked from Motion Canvas; zero-dep core. Telemetry via PostHog (disable with `DISABLE_TELEMETRY=true`).

**Recommendation:** **Adopt as the strategic MIT alternative to Remotion for *new* motion-graphics work.** It gives you Remotion-like ergonomics (TS scenes, headless render, browser preview) under MIT with **no per-render fee** — important if ClipMint scales to millions of renders. It also has **built-in parallel/sharded rendering**, which ClipMint currently lacks. Do not migrate captions wholesale (effort), but **build the next motion-graphics template (e.g. "hook" intros, stat cards, animated lower-thirds) in Revideo** and benchmark quality/effort. If it holds up, it de-risks the Remotion licence.

### 2.6 Motion Canvas — ✅ great for explainer/vector motion, MIT
- **URL:** https://github.com/motion-canvas/motion-canvas · https://motion-canvas.io
- **Stars:** 19.2k · **Licence:** MIT ✅ · **Language:** TypeScript
- **Recency:** 955 commits; monorepo (`core`, `2d`, `ui`, `player`, `vite-plugin`); real-time preview editor.
- **What it is:** TypeScript library using **generators** to program animations, plus an editor with real-time preview. Designed for informative vector animations synced to voice-overs.

**Recommendation:** **Adopt selectively for animated explainer overlays.** Motion Canvas is the best OSS tool for *diagram/vector* animation (arrows, charts, callouts) synced to narration — a strong differentiator for a "course-creator" tier. Like Revideo it is MIT. Caveat: its generator model is less suited to data-driven per-clip batching than Remotion/Revideo's React model, so use it for a small library of reusable animated overlays rendered offline, not for the per-clip hot path.

### 2.7 Vidstack — ✅ player only, useful for the dashboard
- **URL:** https://github.com/vidstack/player · https://vidstack.io
- **Stars:** 3.7k · **Licence:** MIT ✅ · **Language:** TypeScript (Web Components + React/Vue/Svelte/Solid/Angular)
- **Recency:** 2,601 commits; active; successor to Plyr 3.x / Vime 5.x.
- **What it is:** Headless, accessible **video/audio player** UI components + hooks. Supports HLS/DASH, captions, analytics.

**Recommendation:** **Adopt for the ClipMint dashboard preview.** Today the dashboard likely uses a bare `<video>` tag. Vidstack gives you a polished, accessible player with **caption track support** (so users can preview SRT/VTT burned or soft captions), quality switching, and HLS — which matters once clips are large/4K. MIT, zero cost. Low effort, immediate UX win. Not a render dependency.


### 2.8 FFmpeg binding / wrapper libraries

| Tool | URL | Stars | Licence | Language | Verdict for ClipMint |
|---|---|---|---|---|---|
| **ffmpeg-python** | github.com/kkroening/ffmpeg-python | 11.0k | Apache-2.0 ✅ | Python | **Optional.** Builds `filter_complex` as a composable graph — nice, but the project is **lightly maintained** (479 open issues) and generates the same CLI you could write. Use only if you want a typed graph builder. |
| **PyAV** | github.com/PyAV-Org/PyAV | 3.3k | BSD-3-Clause ✅ | Python/Cython | **Adopt for metadata + frame inspection.** Direct access to containers/streams/packets/frames; ships **binary wheels with FFmpeg bundled** (Linux/macOS/Windows), supports FFmpeg 8.x, Python 3.12+. Ideal for `ffprobe`-free duration/resolution checks and for extracting frames for thumbnails/CLIP scoring. README rightly warns: if the `ffmpeg` CLI does the job, don't use PyAV — so keep it for *inspection*, not encoding. |
| **imageio-ffmpeg** | github.com/imageio/imageio-ffmpeg | 303 | BSD-2-Clause ✅ | Python | **Use for portable FFmpeg binaries.** Its wheels ship platform FFmpeg executables; `get_ffmpeg_exe()` resolves the right binary. Its own README says "you should probably use PyAV instead" for frame work — but the *bundled binary* is genuinely useful for reproducible CI containers (pin FFmpeg version in GitHub Actions instead of relying on the runner's). |
| **ffmpeg.wasm** | github.com/ffmpegwasm/ffmpeg.wasm | 17.8k | MIT ✅ | TypeScript/WASM | **Adopt for client-side preview only.** Runs FFmpeg *in the browser* — perfect for instant "trim preview" or "download my clip at 720p without a server round-trip". Caveats: 388 open issues, single-threaded without SharedArrayBuffer/COOP-COEP headers, ~2–5× slower than native, large WASM download. Never the primary renderer. |

**Recommendation (this block):** Pick **PyAV** for inspection and **imageio-ffmpeg** for pinned binaries. Treat `ffmpeg-python` as a nice-to-have and `ffmpeg.wasm` as a dashboard-only preview toy.

### 2.9 Shotstack (hosted) — for reference only
- **URL:** https://shotstack.io — **Licence:** commercial SaaS (not open source) ⚠️ paid.
- **What it is:** Hosted, API-driven video-editing service with a JSON edit spec (very close to Editly's), cloud rendering, and template/asset APIs.

**Recommendation:** **Do not adopt (cost + lock-in), but study its JSON edit schema.** Shotstack's spec is the most mature "declarative edit document" in the industry and is worth reading when you design ClipMint's OTIO-backed plan object. Since ClipMint's entire PRD thesis is **$0-until-scale** rendering, a hosted per-minute renderer contradicts the model. Keep it as a documented "burst capacity" fallback if a customer demands an SLA you can't meet on your own fleet.

---

## 3. Auto-Editing Intelligence

This is where ClipMint's *perceived quality* is won or lost. Today the "smart" signals are: transcript word gaps (`auto_edit.py`), LLM viral scoring, and `ffmpeg astats` RMS (`audio_energy.py`). The upgrades below add **visual** and **rhythmic** awareness.

### 3.1 PySceneDetect — ⭐ top adoption
- **URL:** https://github.com/Breakthrough/PySceneDetect · https://www.scenedetect.com
- **Stars:** 5.2k · **Licence:** BSD-3-Clause ✅ · **Language:** Python (+ OpenCV)
- **Recency:** **Very active — latest release v0.7.1 (July 21, 2026)**; 1,721 commits; publishes accuracy/speed benchmarks.
- **Detectors:** `ContentDetector` (HSV delta per frame), `AdaptiveDetector` (two-pass, robust to fast camera motion), `ThresholdDetector` (fade in/out via luminance), `HashDetector` (perceptual hash), `HistogramDetector`.
- **CLI + API**, plus `split_video_ffmpeg()`.

```python
from scenedetect import detect, ContentDetector, AdaptiveDetector
scenes = detect("in.mp4", AdaptiveDetector())     # robust to handheld motion
for i, (start, end) in enumerate(scenes):
    print(f"scene {i}: {start.get_seconds():.2f}s -> {end.get_seconds():.2f}s")
```

**Recommendation:** **Adopt immediately — highest value/effort ratio in the whole report.** Run `AdaptiveDetector` (falls back to `ContentDetector`) as a preprocessing stage in `prepare_clips.py`, then: (a) snap clip **in/out points to scene boundaries** so cuts never land mid-shot; (b) reject "viral moments" that straddle a hard scene cut unless it's a deliberate multi-shot montage; (c) feed scene density to the LLM as a "visual variety" feature (fast-cut talking-head vs static slideshow); (d) use it to auto-select a **thumbnail frame** with high visual entropy. It is a pure-Python BSD dependency, runs on CPU, and its benchmark page lets you tune thresholds with data. This is the single most impactful auto-editing upgrade.

### 3.2 TransNetV2 — ✅ best-in-class *shot-boundary* accuracy (heavier)
- **URL:** https://github.com/soCzech/TransNetV2 · **Stars:** 1.1k · **Licence:** MIT ✅ · **Language:** Python (TensorFlow + a PyTorch port)
- **Recency:** 78 commits; has `inference/` and `inference-pytorch/` folders; a paper-backed model (arXiv 2008.04838).
- **What it is:** A CNN shot-boundary detector with strong F1 (e.g. **96.2 on BBC Planet Earth**, 77.9 on ClipShots) that beats earlier methods.

**Recommendation:** **Adopt as an *optional high-accuracy* mode, behind a flag.** TransNetV2 catches **dissolves, wipes and gradual transitions** that frame-difference detectors miss, and it is MIT. But it needs a GPU/TF runtime and is slower than PySceneDetect. Pattern: use PySceneDetect as the always-on default; run TransNetV2 on the Modal GPU app (`modal/enhance_app.py` already exists) for premium tiers or for content with lots of dissolves (e.g. cinematic vlogs). Emit the same scene-list shape so the rest of the pipeline is detector-agnostic.

### 3.3 librosa — ⭐ adopt for beat/onset-driven pacing
- **URL:** https://github.com/librosa/librosa · https://librosa.org
- **Stars:** 8.6k · **Licence:** **ISC** ✅ (permissive) · **Language:** Python (numpy/scipy)
- **Recency:** Very active; 3,550 commits; v1.0 line; citable (`librosa.cite()`).
- **What it is:** The de-facto MIR toolkit — onset detection (`onset.onset_detect`), beat tracking (`beat.beat_track`), tempo, spectral features, MFCC.

```python
import librosa
y, sr = librosa.load("clip.wav", sr=22050)
tempo, beats = librosa.beat.beat_track(y=y, sr=sr)      # BPM + beat frames
onsets = librosa.onset.onset_detect(y=y, sr=sr, units="time")
```

**Recommendation:** **Adopt for beat-synced editing and "cut on the beat" styles.** Short-form that cuts/zooms on musical beats reads as *professionally edited* to viewers. Add a `pipeline/beats.py` that (a) detects tempo + beat times, (b) aligns **punch-ins, B-roll cutaways and caption pops** to the nearest beat, and (c) exposes a "beat-reactive" caption style (scale pop on downbeats). ISC licence is safe. This is the natural partner to the existing `CLIPMINT_AUDIO_REACTIVE=1` env flag — you already *believe* in audio-reactivity; librosa makes it rhythmic, not just loudness-reactive.

### 3.4 madmom — ⚠️ strong but heavier, licence split
- **URL:** https://github.com/CPJKU/madmom · **Stars:** 1.7k · **Licence:** **code = BSD-ish (source) but model/data files are separately licensed (non-commercial)** ⚠️ — the repo states two licences, one for source and one for model/data files. **Verify before commercial use.** · **Language:** Python/Cython
- **Recency:** 1,753 commits; academic (JKU Linz) but actively maintained.
- **What it is:** Reference MIR implementations — RNN/DBN onset & beat/downbeat tracking, tempo, chords.

**Recommendation:** **Prefer librosa; use madmom only if you need downbeat tracking and clear the model-licence question.** madmom's RNN+DBM beat/downbeat tracker is more accurate than librosa's on hard music, and BeatNet (below) *builds on* it. But the **split licence on model files is a commercial red flag** — get legal to confirm the pretrained models are usable in a paid product before shipping.


### 3.5 aubio — ⚠️ GPL, avoid in-product
- **URL:** https://github.com/aubio/aubio · https://aubio.org
- **Stars:** 3.8k · **Licence:** **GPL-3.0** ⚠️⚠️ **hard blocker** for a commercial SaaS (strong copyleft). · **Language:** C with a Python module
- **What it is:** Onset/pitch/beat/tempo detection; CLI tools `aubioonset`, `aubiotrack`, `aubiocut` (slices audio at onsets/beats), MFCC.

**Recommendation:** **Avoid in the product.** aubio is excellent engineering, but **GPL-3.0 is a blocker** for a proprietary SaaS — even importing the Python module creates a derivative-work question. **librosa (ISC) covers ~all of aubio's relevant functionality** for ClipMint's use case. Do not add it.

### 3.6 Essentia — ⚠️ AGPL, avoid in-product
- **URL:** https://github.com/MTG/essentia · https://essentia.upf.edu
- **Stars:** 3.8k · **Licence:** **AGPL-3.0** ⚠️⚠️ — the *strongest* copyleft; AGPL's network clause means **even a SaaS that merely runs it over a network must offer source to users**. Hard blocker. · **Language:** C++ + Python bindings
- **What it is:** Industrial-grade audio analysis / MIR: spectral, tonal, temporal and high-level descriptors; CLI extractors; TensorFlow variants.

**Recommendation:** **Do not adopt.** AGPL-3.0 is disqualifying for ClipMint's closed SaaS. Its "mood/energy" descriptors are genuinely useful for BGM selection — but `ffmpeg astats` (already used) + librosa's spectral features approximate them under a permissive licence. If you truly need Essentia's descriptors, run it as a **completely separate AGPL service with a documented source-offer**, which is rarely worth the legal complexity. Skip.

### 3.7 BeatNet — ✅ SOTA beat/downbeat, permissive
- **URL:** https://github.com/mjhydri/BeatNet · **Stars:** 519 · **Licence:** **CC-BY-4.0** ✅ (attribution required — fine for commercial use) · **Language:** Python/PyTorch
- **Recency:** 94 commits; v1.2.0 added a training pipeline; ISMIR 2021 paper implementation.
- **What it is:** State-of-the-art joint **beat / downbeat / tempo / meter** tracking using a CRNN + cascade particle filtering, with **streaming, real-time, online and offline** modes. Built on librosa features + madmom state space.

```python
from BeatNet.BeatNet import BeatNet
est = BeatNet(1, mode='offline', inference_model='PF', plot=[])
beats = est.process("audio.wav")     # beat + downbeat times
```

**Recommendation:** **Adopt as the "premium pacing" engine, gated behind the beat-detection feature.** CC-BY-4.0 is commercially usable (attribute in docs). BeatNet is markedly better than librosa at **downbeats** (bar starts), which is what you want for "cut on the bar" cinematic edits and for beat-reactive caption styles. Pattern: librosa for the cheap default (tempo+onsets), BeatNet (PyTorch, GPU) for premium/Pro tiers. Note it pulls in madmom for state space — re-check that dependency's model licence (3.4).

### 3.8 Audio-energy cut planning & jump-cut styles — already partly built
ClipMint already dumps per-second RMS via `ffmpeg astats` and summarises it for the LLM (`audio_energy.py`), and already does **transcript-gap jump cuts** (`auto_edit.py`). The gap to close:

- **Add an onset/loudness "punch-in" planner:** combine RMS spikes (`astats`), spectral flux onsets (librosa), and sentence starts (word timestamps) to place **punch-in zooms** — you already expose `auto_punch_in` as a workflow input but it is transcript-driven; adding audio onsets makes it feel musical.
- **Jump-cut variants:** expose styles — `hard-jump` (current), `soft-jump` (keep 120 ms, add 80 ms crossfade via `xfade`), `punch-cut` (cut + 1.08× punch-in), `beat-cut` (snap cuts to BeatNet/librosa beats). This is a *marketing* differentiator at near-zero engineering cost since the cut engine exists.
- **Silence detection is cheap via FFmpeg too:** `silencedetect=noise=-30dB:d=0.4` gives silence intervals without any Python audio lib — a good zero-dependency fallback.

**Recommendation:** **Adopt the hybrid planner** (scene + energy + beat + transcript) as the flagship "AI editor" feature. It is the clearest thing ClipMint can do that a naive `ffmpeg -ss` tool cannot, and every component is either already present or BSD/ISC-licensed.

---

## 4. Multi-Format Export & Composition

All of this section is **FFmpeg-native** unless noted — no new dependencies, no licences to worry about.

### 4.1 Split-screen / grid layouts — `xstack`
- **Docs:** https://ffmpeg.org/ffmpeg-filters.html#xstack
- `xstack` tiles N inputs into a grid via a `layout` string; each input is first scaled to a cell size. Positions are `x_y` pixel offsets.

**2×2 grid (1080×1920 → four 540×960 cells):**
```bash
ffmpeg -i a.mp4 -i b.mp4 -i c.mp4 -i d.mp4 -filter_complex \
"[0:v]scale=540:960,setsar=1[a];\
 [1:v]scale=540:960,setsar=1[b];\
 [2:v]scale=540:960,setsar=1[c];\
 [3:v]scale=540:960,setsar=1[d];\
 [a][b][c][d]xstack=inputs=4:layout=0_0|540_0|0_960|540_960[out]" \
-map "[out]" -c:v libx264 -crf 20 -pix_fmt yuv420p grid.mp4
```
**Simpler cases:** `hstack=inputs=2` (side-by-side), `vstack=inputs=2` (stacked).

**Recommendation:** **Adopt `xstack` for "podcast/interview" and "reaction" layout presets.** Short-form podcast clips overwhelmingly use a **speaker-stack** (host over guest) or **side-by-side**. Add layout presets (`stack-vertical`, `stack-horizontal`, `grid-2x2`, `solo`) selectable per clip, and generate the `layout` string programmatically from the number of faces detected by `smart_reframe.py` — you already know how many faces are in frame, so you can **auto-pick the layout**. Strong, cheap differentiator.

### 4.2 Picture-in-picture / overlay
- **Docs:** https://ffmpeg.org/ffmpeg-filters.html#overlay
```bash
# Main video with a PIP guest in the bottom-right, 30% width
ffmpeg -i main.mp4 -i guest.mp4 -filter_complex \
"[1:v]scale=iw*0.30:-1[pip];[0:v][pip]overlay=W-w-40:H-h-40:shortest=1[out]" \
-map "[out]" out.mp4
```
**Recommendation:** **Adopt for B-roll and "captioned + screen-share" layouts.** `overlay` also powers logo/watermark burns (the PRD's free-tier watermark), progress bars, and sticker stings. Add an `overlay()` helper to the proposed filter-graph builder.


### 4.3 Transitions — `xfade` (57 named transitions) + gl-transitions
- **Docs:** https://ffmpeg.org/ffmpeg-filters.html#xfade · https://gl-transitions.com
- `xfade` syntax: `xfade=transition=<name>:duration=<s>:offset=<s>`, chained across inputs. `offset` = when the transition starts on the *first* input's timeline (cumulative as you chain).

**Chained 3-clip crossfade:**
```bash
ffmpeg -i a.mp4 -i b.mp4 -i c.mp4 -filter_complex \
"[0][1]xfade=transition=fade:duration=0.5:offset=4[v01];\
 [v01][2]xfade=transition=circleopen:duration=0.5:offset=8.5[v]" \
-map "[v]" -c:v libx264 out.mp4
```
(Also `acrossfade` the audio, or `xfade` will desync it.)

**Named `xfade` transitions (FFmpeg 6–8):** `fade`, `wipeleft/right/up/down`, `slideleft/right/up/down`, `circleopen`, `circleclose`, `circlecrop`, `rectcrop`, `distance`, `fadeblack`, `fadewhite`, `fadegrays`, `radial`, `smoothleft/right/up/down`, `vertopen`, `vertclose`, `horzopen`, `horzclose`, `dissolve`, `pixelize`, `diagtl/tr/bl/br`, `hlslice`, `hrslice`, `vuslice`, `vdslice`, `hblur`, `wipetl/tr/bl/br`, `squeezeh`, `squeezev`, `zoomin`, `fadefast`, `fadeslow`, `hlwind`, `hrwind`, `vuwind`, `vdwind`, `coverleft/right/up/down`, `revealleft/right/up/down`, `slidecirclein`, `slidecircleout`, plus `custom` (supply your own expression/GLSL).

- **gl-transitions** (https://gl-transitions.com) — **MIT**, GLSL shader collection (~80+ transitions: CrossZoom, DreamyZoom, LinearBlur, WaterDrop, Swap, Morph…). **Not** directly usable by `xfade`, but usable via Editly/Remotion/WebGL renderers or by pre-rendering and compositing.

**Recommendation:** **Adopt `xfade` with a curated 8–12 preset set; skip shader transitions for now.** `xfade` is free, GPU-friendly, deterministic. Curate: `fade`, `fadeblack`, `circleopen`, `smoothleft`, `slideup`, `wipeleft`, `dissolve`, `zoomin`, `hblur`, `pixelize`, `squeezev`, `radial` — and map each to a "vibe" (clean / energetic / cinematic / glitch). If you later want the flashy CrossZoom/WaterDrop look, render those in Remotion (WebGL) rather than adding a GLSL pipeline to FFmpeg for two effects.

### 4.4 Aspect-ratio variants (9:16 / 1:1 / 16:9 / 4:5)
ClipMint's workflow already takes an `output_formats` CSV (`9x16,1x1,16x9`). Canonical recipes:
```bash
# 9:16 vertical, cover-crop (fills frame, crops sides)
-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"

# 9:16 vertical, contain + blurred background (no content lost)
-filter_complex "split[a][b];\
 [a]scale=1080:1920,gblur=sigma=20,eq=brightness=-0.05[bg];\
 [b]scale=1080:-1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2"

# 1:1 square feed
-vf "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080"
```
**Recommendation:** **Adopt the contain+blur recipe as the default for 16:9→9:16** (never decapitates anyone), with cover-crop as an opt-in "fill". `smart_reframe.py` already solves the *hard* part (where to crop); expose both modes.

### 4.5 Motion graphics
- **Remotion** (⚠️ gated licence) and **Revideo / Motion Canvas** (MIT) — covered in §2.
- **Lottie** (https://github.com/airbnb/lottie-web, MIT) — JSON vector animations; Remotion has first-class support (`@remotion/lottie`). Use for pre-made animated stickers/arrows/check-marks.
- **Rive** (https://rive.app) — runtime state-machine animations; runtime is MIT but the editor is proprietary. Use sparingly.
- **Manim** (https://github.com/ManimCommunity/manim, MIT) — Python math/explainer animation (3Blue1Brown style). Excellent for **education/course-creator** tiers: animated graphs, equations, diagrams.

**Recommendation:** **Adopt Lottie for sticker/asset animations** (free, JSON, Remotion-native) and **Manim as an offline asset generator** for the education tier — render reusable animated clips once, composite with FFmpeg `overlay`. Skip Rive for now.

---

## 5. Render Orchestration & Scale

### 5.1 FFmpeg hardware encoding — ✅ biggest single cost lever
- **Reference:** https://trac.ffmpeg.org/wiki/HWAccelIntro (note: the FFmpeg trac wiki is behind an Anubis bot-challenge; consult the FFmpeg docs and vendor docs if it blocks you).
- **Available encoders:** NVIDIA **NVENC** (`h264_nvenc`, `hevc_nvenc`, `av1_nvenc`), Intel **QSV** (`h264_qsv`, `hevc_qsv`, `av1_qsv`), AMD **AMF** (`h264_amf`), Apple **VideoToolbox** (`h264_videotoolbox`, `hevc_videotoolbox`), Linux **VAAPI** (`h264_vaapi`, `hevc_vaapi`).

```bash
# NVENC 1080p H.264, quality-tuned
ffmpeg -hwaccel cuda -i in.mp4 -c:v h264_nvenc -preset p5 -tune hq -rc vbr -cq 23 -b:v 0 out.mp4

# Apple VideoToolbox (macOS CI runners)
ffmpeg -i in.mp4 -c:v h264_videotoolbox -b:v 6M out.mp4
```
**Recommendation:** **Adopt GPU encode for the clip-render stage — this is the largest cost lever available.** Software `libx264` at `veryfast` (what `auto_edit.py` uses) is CPU-bound and slow; NVENC encodes 1080×1920 shorts in near-real-time and offloads the CPU for the many `filter_complex` stages. Practical plan: (a) keep `libx264 -crf` as the quality reference; (b) add an `--encoder {cpu,nvenc,qsv,videotoolbox}` switch to the render module; (c) prefer NVENC on Modal GPU workers and GitHub `ubuntu-latest` is CPU-only, so pair this with the GPU migration in §5.4. Quality caveat: NVENC at low bitrate is *slightly* softer than `x264 -crf 18`; use `-cq 21..23` and `-preset p5/p6` for the sweet spot.

### 5.2 Remotion Lambda / Lambda@Edge — ⚠️ pay-per-render + licence
- **Docs:** https://www.remotion.dev/docs/lambda
- **How it works:** a Lambda + S3 bucket; Remotion deploys the project to S3 as a website; **many Lambda functions render chunks in parallel**, then one stitches the result. **Regions:** 20+ AWS regions incl. `ap-south-1` (Mumbai — good for ClipMint's India-first users).
- **Limits:** ~10 GB Lambda storage → **~5 GB output** → **~2 h Full HD** max; default **1000 concurrent lambdas/region** (raisable); **no AV1**.
- **Cost:** "multiple minutes of video for a few pennies"; Remotion shows a per-render cost estimate. **Plus the Remotion Company Licence** (Automators: $0.01/render, $100/mo min) if you're 4+ employees.
- **Lambda@Edge:** not the primary path for rendering — Edge is for request/response manipulation at CDN edge; Remotion's docs steer you to regular Lambda (+ Cloud Run as the non-AWS alternative).

**Recommendation:** **Evaluate, but do not default to it.** Remotion Lambda is genuinely excellent *if* you're already on AWS and rendering ≤2 h Full HD — it removes all orchestration work and autoscales to 1000 concurrent. For ClipMint it means: **AWS account + S3 egress + per-render licence** stacked on top of Groq/Supabase costs, which fights the "$0-until-scale" thesis. **Better fit for ClipMint: keep GitHub Actions as the *scheduler* and Modal as the *renderer*** (§5.4), since `modal/enhance_app.py` already exists. Revisit Lambda only if AWS credits are available (the PRD already mentions AWS Activate via Modal).

### 5.3 Sharding renders across CI matrix jobs — ✅ quick win
GitHub Actions jobs are the free-tier bottleneck (2,000 min/mo per the PRD). Fan-out pattern:
```yaml
jobs:
  plan:      # one job: transcribe → analyse → emit clips_manifest.json (N clips)
    outputs: { clips: ${{ steps.plan.outputs.clips }} }
  render:    # matrix over clip indices
    needs: plan
    strategy:
      fail-fast: false
      max-parallel: 8
      matrix: { clip: ${{ fromJson(needs.plan.outputs.clips) }} }
    runs-on: ubuntu-latest
    steps:
      - run: python pipeline/render_clips.py --clip-index ${{ matrix.clip }}
```
**Recommendation:** **Adopt immediately.** Each matrix leg renders one clip independently; `fail-fast: false` means one bad clip never fails the whole job (directly addresses the "nothing fails silently" design rule in `process-video.yml`). Note GitHub bills each matrix leg's minutes separately, so sharding does **not** reduce free minutes — it reduces *wall-clock* and isolates failures. Combine with `actions/cache` for the FFmpeg binary + npm/Remotion bundle so each leg skips install time.


### 5.4 GPU compute for render/encode — Modal vs RunPod vs Replicate

**Modal** (https://modal.com/pricing) — serverless, per-second, **1–2 s cold start**, no idle billing, autoscaling.
- Plans: **Starter $0/mo + $30/mo free compute**; Team $250/mo (+$100 credit); Enterprise custom.
- Per-second: **T4 $0.000164**, **L4 $0.000222**, **A10 $0.000306**, L40S $0.000542, A100-40GB $0.000583, **A100-80GB $0.000694**, **H100 $0.001097**, B200 $0.001736. CPU **$0.0000131/core/s**, RAM $0.00000222/GiB/s.

**RunPod** (https://www.runpod.io/pricing) — dedicated pods + serverless; cheapest raw GPU/hr.
- Community/Secure pods (per hour): **RTX A5000 $0.27**, L4 $0.49, A40 $0.49, RTX 3090 $0.50, RTX 4090 **$0.74**, L40S $1.09, A100-80GB **$1.59**, H100 PCIe **$2.89**, H100 SXM $3.49.

**Replicate** (https://replicate.com/pricing) — hosted models + your own via Cog; per-second hardware, but **private models bill for idle time** unless "fast booting fine-tune".
- Per second: **T4 $0.000225** ($0.81/hr), L40S $0.000975 ($3.51/hr), A100-80GB $0.0014 ($5.04/hr), H100 $0.001525 ($5.49/hr). Also per-output pricing on hosted models (e.g. video models $0.09–$0.50/s of output).

**Rough cost per render-minute (1 min of 1080×1920 output):**
| Path | Assumption | Est. cost / render-min |
|---|---|---|
| GitHub Actions | 1 min wall-clock ≈ 1 billed min (2-core CPU) | ~$0.008 (beyond free 2,000 min: $0.008/min Linux) |
| Modal A10 (NVENC) | ~20–40 s encode+filter per output-min | **~$0.002–0.005** |
| Modal L4 | cheaper, slightly slower | **~$0.0015–0.004** |
| RunPod RTX 4090 | dedicated, $0.74/hr, ~real-time | **~$0.012** (but no cold-start tax) |
| Replicate T4 | per-second, hosted | **~$0.003–0.01** |
| Remotion Lambda | AWS GB-s + $0.01/render licence | **~$0.01–0.03 + licence** |

**Recommendation:** **Standardise on Modal for bursty per-clip GPU work (already integrated) and keep RunPod in reserve for sustained batch jobs.** Modal's per-second, zero-idle billing matches ClipMint's spiky, per-upload workload and its **1–2 s cold start** is the differentiator vs RunPod pods (which you pay for while idle). Concretely: (a) run **NVENC encoding + BeatNet/TransNetV2 inference** on Modal A10/L4; (b) keep the always-on FFmpeg cut/trim on CPU (cheap, no GPU needed); (c) use RunPod only for a "batch 500 videos overnight" agency job where a dedicated 4090 at $0.74/hr beats serverless overhead. **Avoid Replicate for rendering** — it shines for *model* inference, not for FFmpeg pipelines you control.

### 5.5 Job-queue / workflow orchestration engines

| Tool | URL | Stars | Licence | Language | Verdict |
|---|---|---|---|---|---|
| **Temporal** | github.com/temporalio/temporal | 23.4k | MIT ✅ | Go (SDKs: Py/TS/Go/Java) | **Best long-term fit.** Durable execution: workflows survive crashes, retries/compensation are first-class — exactly the "checkpoint after transcription / resume_from_checkpoint" behaviour ClipMint hand-rolls today. Heavy to self-host (Go server + DB) but the payoffs (visible state machine, timeouts, saga rollback) are real at scale. |
| **Ray** | github.com/ray-project/ray | 44.0k | Apache-2.0 ✅ | Python/C++ | **Adopt for distributed *compute*.** Ray Core (tasks/actors) + Ray Data fan out clip renders across a cluster; runs on any cloud/K8s. Overkill until you have many concurrent videos, then it's the natural step up from a CI matrix. |
| **Dramatiq** | github.com/Bogdanp/dramatiq | 5.3k | **LGPL-3.0** ⚠️ (+GPL) | Python | Simple, fast Redis/RabbitMQ task queue. **LGPL is manageable** but a copyleft dependency in a SaaS is friction; Celery is the safer licence. Use only if you want a light queue and clear LGPL. |
| **Celery** | github.com/celery/celery | 28.9k | **BSD-3-Clause** ✅ | Python | The battle-tested default. Massive ecosystem, Redis/RabbitMQ/SQS brokers, S3/GCS result backends, retries, chords/groups (great for "render N clips then stitch"). **Adopt if/when you outgrow GitHub Actions**, since ClipMint's pipeline is already Python. |

**Recommendation:** **Don't adopt a queue yet — but plan the migration.** Today GitHub Actions + Supabase job rows *is* your orchestrator, and it works. The trigger to move: when a single upload needs **>20 parallel renders**, or when you need **sub-minute queue latency** (Actions has dispatch lag). At that point the ladder is: **Celery (BSD, Python-native, easy) → Ray (when you need a cluster) → Temporal (when correctness/durability of the whole job graph becomes the product risk)**. Keep the pipeline functions pure (input → artifacts → DB row) so the orchestrator is swappable — that's the architectural insurance, and it costs nothing today.

### 5.6 Spot instances / cost discipline
- Modal and RunPod both expose preemptible/community capacity at a discount; RunPod's "Community Cloud" tier is the cheap pool.
- **Recommendation:** design render jobs to be **idempotent and restartable per clip** (they already mostly are — clip artifacts are keyed by `job_id`/`clip_index`). Idempotency is what lets you safely use spot/preemptible GPUs, which is where the real 30–60% savings live. This is a *design* choice, not a purchase.

---

## 6. Summary Comparison Table

| # | Tool | Stars | Licence | SaaS-safe? | Lang | Area | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | OpenTimelineIO | 2.0k | Apache-2.0 | ✅ | C++/Py | Timeline IR | **Adopt (IR + EDL/FCPXML export)** |
| 2 | MLT Framework | 1.9k | LGPL-2.1 | ⚠️ | C/C++ | NLE engine | Skip (FFmpeg covers it) |
| 3 | GStreamer GES | — | LGPL | ⚠️ | C | NLE engine | Skip (steal `xges`↔OTIO) |
| 4 | Blender VSE | — | GPL | ❌ | C/C++/Py | NLE engine | Avoid in product |
| 5 | VapourSynth | 2.1k | LGPL-2.1 | ⚠️ | C++/Py | Frame server | Reserve for pro tier |
| 6 | FFmpeg `filter_complex` | — | LGPL (subproc) | ✅ | C | Engine | **Adopt / build graph builder** |
| 7 | MoviePy 2.x | 14.9k | MIT | ✅ | Py | Programmatic | Prototype only |
| 8 | auto-editor | 5.4k | Unlicense | ✅ | Nim | Auto-edit | **Steal motion detector + exports** |
| 9 | Editly | 5.5k | MIT | ✅ | TS | Declarative | Steal JSON schema |
| 10 | Remotion | 61.5k | **Proprietary** | ⚠️💰 | TS | Motion/captions | Keep + **budget licence** |
| 11 | Revideo | 4.1k | MIT | ✅ | TS | Motion | **Adopt for new motion (Remotion escape hatch)** |
| 12 | Motion Canvas | 19.2k | MIT | ✅ | TS | Vector motion | Adopt for explainer overlays |
| 13 | Vidstack | 3.7k | MIT | ✅ | TS | Player | Adopt in dashboard |
| 14 | ffmpeg-python | 11.0k | Apache-2.0 | ✅ | Py | Bindings | Optional |
| 15 | PyAV | 3.3k | BSD-3 | ✅ | Py | Bindings | **Adopt for inspection** |
| 16 | imageio-ffmpeg | 303 | BSD-2 | ✅ | Py | Binaries | Adopt for pinned FFmpeg |
| 17 | ffmpeg.wasm | 17.8k | MIT | ✅ | TS/WASM | Browser | Dashboard preview only |
| 18 | PySceneDetect | 5.2k | BSD-3 | ✅ | Py | Scene detect | **Adopt (top pick)** |
| 19 | TransNetV2 | 1.1k | MIT | ✅ | Py | Shot detect | Optional premium |
| 20 | librosa | 8.6k | ISC | ✅ | Py | Beat/onset | **Adopt** |
| 21 | madmom | 1.7k | BSD + ⚠️models | ⚠️ | Py/Cython | Beat/downbeat | Only if model licence clears |
| 22 | aubio | 3.8k | **GPL-3.0** | ❌ | C/Py | Beat/onset | Avoid (librosa covers) |
| 23 | Essentia | 3.8k | **AGPL-3.0** | ❌ | C++/Py | MIR | Avoid |
| 24 | BeatNet | 519 | CC-BY-4.0 | ✅ | Py/Torch | Beat/downbeat | Adopt (premium pacing) |
| 25 | gl-transitions | — | MIT | ✅ | GLSL | Transitions | Reference list |
| 26 | Temporal | 23.4k | MIT | ✅ | Go | Orchestration | Later (durable jobs) |
| 27 | Ray | 44.0k | Apache-2.0 | ✅ | Py/C++ | Distributed | Later (cluster compute) |
| 28 | Dramatiq | 5.3k | LGPL-3.0 | ⚠️ | Py | Queue | Optional |
| 29 | Celery | 28.9k | BSD-3 | ✅ | Py | Queue | Adopt when outgrowing Actions |
| 30 | Manim | ~30k | MIT | ✅ | Py | Explainer | Adopt (education tier) |

---

## 7. TOP 15 ADOPTIONS RANKED BY VALUE / EFFORT

Scoring: **Value** = impact on output quality, cost, or new revenue; **Effort** = eng-days to ship a first version. Ranked by Value ÷ Effort, with licence safety as a tie-breaker.

| Rank | Adoption | Area | Licence | Value | Effort | Why it wins |
|---|---|---|---|---|---|---|
| **1** | **PySceneDetect scene-boundary snapping** | Auto-edit | BSD-3 ✅ | High | **Low** (~2–3 d) | Snap clip in/out to shots; kill mid-shot cuts; feed scene density to the LLM; auto-pick thumbnails. Pure-Python, CPU-only, benchmarked. Biggest quality jump per day of work. |
| **2** | **FFmpeg `xfade` transitions (curated 8–12)** | Composition | FFmpeg ✅ | High | **Low** (~2 d) | Instant "produced" feel on multi-shot clips. CLI-only, no deps, GPU-friendly. Map transitions to vibe presets. |
| **3** | **NVENC hardware encode** | Orchestration | FFmpeg ✅ | High | **Low** (~2–3 d) | Cuts render wall-clock and CPU cost dramatically; frees CPU for `filter_complex`. Add an `--encoder` switch; pair with Modal GPU. |
| **4** | **`xstack`/`hstack` split-screen layout presets** | Composition | FFmpeg ✅ | High | **Low** (~3 d) | Unlocks the dominant podcast/interview short format; auto-pick layout from face count in `smart_reframe.py`. Differentiator, no new deps. |
| **5** | **Sharded render matrix (per-clip jobs)** | Orchestration | — ✅ | High | **Low** (~2 d) | Isolates failures (`fail-fast:false`), cuts wall-clock, matches the "nothing fails silently" design rule. YAML change + a `--clip-index` flag. |
| **6** | **OpenTimelineIO as internal IR + EDL/FCPXML export** | Timeline | Apache-2.0 ✅ | High | **Med** (~5–8 d) | Stable versioned plan schema; agency-tier "export to Premiere/Resolve"; `.otioz` bundles. Foundation for everything timeline-shaped. |
| **7** | **librosa beat/onset-driven pacing** | Auto-edit | ISC ✅ | High | **Med** (~4–5 d) | "Cut on the beat" reads as professional. Enables beat-reactive captions + musical punch-ins. Natural extension of `CLIPMINT_AUDIO_REACTIVE`. |
| **8** | **Hybrid cut planner (scene + energy + beat + transcript)** | Auto-edit | mixed ✅ | **Very High** | **Med-High** (~8–12 d) | The flagship "AI editor" capability; combines #1, #7 and existing `auto_edit.py`/`audio_energy.py`. Hardest to copy. |
| **9** | **Revideo for new motion graphics** | Motion | MIT ✅ | High | **Med** (~5–8 d) | MIT escape hatch from Remotion's per-render fee; built-in **sharded rendering**. Build one template (hook intro / stat card) to de-risk the licence. |
| **10** | **Pinned FFmpeg binary via imageio-ffmpeg + PyAV inspection** | Reliability | BSD ✅ | Med | **Low** (~2 d) | Reproducible CI (no runner-FFmpeg drift) + `ffprobe`-free metadata/frame extraction for thumbnails and CLIP scoring. |
| **11** | **Vidstack player in the dashboard** | UX | MIT ✅ | Med | **Low** (~2–3 d) | Accessible player with caption tracks + quality switching; polish users notice. Zero cost. |
| **12** | **Modal as the render/burst GPU tier (NVENC + BeatNet/TransNetV2)** | Orchestration | — ✅ | High | **Med** (~5–7 d) | Per-second, 1–2 s cold start, no idle cost — matches spiky workload. `modal/enhance_app.py` already exists to extend. |
| **13** | **Lottie + Manim asset libraries** | Motion | MIT ✅ | Med | **Med** (~4–6 d) | Stickers/arrows (Lottie) + animated equations/diagrams (Manim) for the education tier. Render-once, composite via `overlay`. |
| **14** | **Celery queue (when Actions is outgrown)** | Orchestration | BSD-3 ✅ | Med-High | **Med** (~6–10 d) | Python-native, chords/groups for "render N then stitch", sub-minute dispatch latency. Adopt at the trigger, not before. |
| **15** | **TransNetV2 premium shot detection on GPU** | Auto-edit | MIT ✅ | Med | **Med** (~4–6 d) | Catches dissolves/wipes PySceneDetect misses; gate behind Pro tier. Same scene-list shape → detector-agnostic. |

**Sequenced plan (suggested):**
- **Sprint 1 (1 week, near-zero risk):** #1 PySceneDetect, #2 `xfade`, #3 NVENC, #5 matrix sharding.
- **Sprint 2 (2 weeks):** #4 `xstack`, #7 librosa, #6 OTIO, #10 pinned FFmpeg.
- **Sprint 3 (2–3 weeks):** #8 hybrid planner, #9 Revideo template, #12 Modal render tier, #11 Vidstack.
- **Backlog (trigger-gated):** #13 Lottie/Manim, #14 Celery, #15 TransNetV2.

---

## 8. Licensing Risk Register (commercial SaaS)

| Risk | Licence | Impact | Mitigation |
|---|---|---|---|
| **Remotion** | Proprietary (not OSI) | **Must pay** if 4+ employees: $0.01/render + $100/mo min (Automators) | Budget it; keep captions decoupled; prototype **Revideo (MIT)** as an alternative for new work. |
| **Essentia** | **AGPL-3.0** | Network-copyleft: offering it as a service triggers source-disclosure | **Do not adopt.** Use FFmpeg `astats` + librosa descriptors. |
| **aubio** | **GPL-3.0** | Strong copyleft; Python import = derivative-work risk | **Do not adopt.** librosa (ISC) covers the use case. |
| **Blender** | **GPL** | Shipping/linking in-product infects your code | Avoid in product; offline asset authoring only. |
| **MLT / GStreamer GES / VapourSynth** | LGPL | Weak copyleft — OK if dynamically linked, unmodified, and you provide the library's source + relink ability | Prefer FFmpeg subprocess; if adopted, keep them as **separate processes** and document. |
| **Dramatiq** | LGPL-3.0 | Copyleft dependency in a SaaS | Prefer **Celery (BSD-3)**. |
| **madmom** | BSD code + **separately-licensed model/data files** | Pretrained models may be non-commercial | **Get legal sign-off** before shipping; or use librosa/BeatNet instead. |
| **FFmpeg + libx264/x265** | GPL components | Linking `libav*` could pull you into GPL | **Keep the subprocess pattern** ClipMint already uses; consider an LGPL-only build (openh264/vpx/svt-av1) if you ever statically bundle. |
| **BeatNet** | CC-BY-4.0 | Attribution required | Fine commercially — add an attributions page. |
| **PySceneDetect / PyAV / librosa / Revideo / Motion Canvas / Vidstack / Ray / Temporal / Celery** | BSD/ISC/MIT/Apache | None | Safe. |

---

## 9. Sources (all URLs fetched during research)

**Timeline / NLE**
- OpenTimelineIO — https://github.com/AcademySoftwareFoundation/OpenTimelineIO · https://opentimeline.io · adapters: https://opentimelineio.readthedocs.io/en/latest/tutorials/adapters.html · quickstart: https://opentimelineio.readthedocs.io/en/latest/tutorials/quickstart.html
- MLT Framework — https://github.com/mltframework/mlt · https://mltframework.org
- GStreamer Editing Services — https://gstreamer.freedesktop.org/documentation/gst-editing-services/index.html
- Blender VSE — https://docs.blender.org/manual/en/latest/video_editing/index.html
- VapourSynth — https://github.com/vapoursynth/vapoursynth · https://www.vapoursynth.com
- FFmpeg filters — https://ffmpeg.org/ffmpeg-filters.html (xfade: `#xfade`, xstack: `#xstack`, overlay: `#overlay`)

**Programmatic editors**
- MoviePy — https://github.com/Zulko/moviepy · https://zulko.github.io/moviepy/
- auto-editor — https://github.com/WyattBlue/auto-editor · https://auto-editor.com
- Editly — https://github.com/mifi/editly
- Remotion — https://github.com/remotion-dev/remotion · https://www.remotion.dev · licence: https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md · pricing: https://www.remotion.dev/pricing · Lambda: https://www.remotion.dev/docs/lambda
- Revideo — https://github.com/redotvideo/revideo
- Motion Canvas — https://github.com/motion-canvas/motion-canvas · https://motion-canvas.io
- Vidstack — https://github.com/vidstack/player · https://vidstack.io
- ffmpeg-python — https://github.com/kkroening/ffmpeg-python
- PyAV — https://github.com/PyAV-Org/PyAV
- imageio-ffmpeg — https://github.com/imageio/imageio-ffmpeg
- ffmpeg.wasm — https://github.com/ffmpegwasm/ffmpeg.wasm
- Shotstack — https://shotstack.io

**Auto-editing intelligence**
- PySceneDetect — https://github.com/Breakthrough/PySceneDetect · https://www.scenedetect.com
- TransNetV2 — https://github.com/soCzech/TransNetV2 · arXiv 2008.04838
- librosa — https://github.com/librosa/librosa · https://librosa.org
- madmom — https://github.com/CPJKU/madmom · http://madmom.readthedocs.org
- aubio — https://github.com/aubio/aubio · https://aubio.org
- Essentia — https://github.com/MTG/essentia · https://essentia.upf.edu
- BeatNet — https://github.com/mjhydri/BeatNet · arXiv 2108.03576

**Composition / transitions / motion**
- gl-transitions — https://gl-transitions.com
- Lottie — https://github.com/airbnb/lottie-web
- Rive — https://rive.app
- Manim — https://github.com/ManimCommunity/manim

**Orchestration / scale**
- Modal pricing — https://modal.com/pricing
- RunPod pricing — https://www.runpod.io/pricing
- Replicate pricing — https://replicate.com/pricing
- Temporal — https://github.com/temporalio/temporal · https://docs.temporal.io
- Ray — https://github.com/ray-project/ray · https://ray.io
- Dramatiq — https://github.com/Bogdanp/dramatiq · https://dramatiq.io
- Celery — https://github.com/celery/celery · https://docs.celeryq.dev
- FFmpeg HW accel — https://trac.ffmpeg.org/wiki/HWAccelIntro

**ClipMint internal files referenced**
- `README.md`, `prd.md.resolved`
- `pipeline/auto_edit.py`, `pipeline/audio_energy.py`, `pipeline/requirements.txt`
- `.github/workflows/process-video.yml`
- `modal/enhance_app.py`, `remotion-captions/`

---

*End of report. Star counts, prices and licences are point-in-time snapshots from the URLs above; re-verify before committing to a build decision. Licence classifications are engineering judgements, not legal advice — route the ⚠️ items through counsel before shipping.*

