# ClipMint — vendored audio assets

Committed audio library used by the render engine. File locations are indexed in
[`pipeline/assets_manifest.json`](./assets_manifest.json); all paths in the manifest are relative to
`remotion-captions/public/`.

- `sfx/` — synthesized locally with ffmpeg. **Zero licensing risk**: generated content, no third-party rights.
- `bgm/` — downloaded from Pixabay under the **Pixabay Content License** (commercial use, no attribution required).

SFX: 48 kHz, 16-bit PCM stereo WAV. BGM: stereo MP3, 128 kbps (calm: 112 kbps to stay under 8 MB),
mixed at ~12% volume under dialogue.

## SFX inventory

| Key | File | Duration | Peak | Purpose | Sound design |
|---|---|---|---|---|---|
| `pop` | `sfx/pop.wav` | 90 ms | -8.5 dB | Caption word pop | Sine sweep 600→900 Hz, fast exponential decay, 4 ms soft attack, low-pass 3.8 kHz |
| `whoosh` | `sfx/whoosh.wav` | 450 ms | -6.0 dB | Clip-start transition | Band-passed (700 Hz) pink noise, smooth rise-then-fall envelope, low-pass 5 kHz |
| `ding` | `sfx/ding.wav` | 350 ms | -6.2 dB | Completion cue | Two partials (880 + 1320 Hz), exponential decay, 5 ms soft attack, low-pass 8 kHz |
| `riser` | `sfx/riser.wav` | 1.0 s | -6.0 dB | Pre-hook tension | Pink noise, band-pass 800 Hz, rising `t^2.6` envelope, click-safe 70 ms fade-out |

### Exact synthesis commands (ffmpeg)

Run from `remotion-captions/public/`. Levels were tuned by re-measuring with `volumedetect`
(all four peak between -6 dB and -8.5 dB — conservative headroom, no limiter needed).

```bash
# pop — 90 ms sine sweep 600->900 Hz, fast exponential decay
ffmpeg -y -f lavfi -i "aevalsrc='0.8*sin(2*PI*(600*t+1666.7*t*t))*exp(-55*t)*min(t/0.004,1)':d=0.09:s=48000" \
  -af "lowpass=f=3800,volume=0.85" -ar 48000 -ac 2 -c:a pcm_s16le sfx/pop.wav

# whoosh — 450 ms band-passed pink noise, rise-then-fall envelope
ffmpeg -y -f lavfi -i "anoisesrc=color=pink:d=0.45:s=48000" \
  -af "bandpass=f=700:w=900,lowpass=f=5000,volume=volume='pow(sin(PI*t/0.45),1.8)':eval=frame,volume=0.7,volume=50.3dB" \
  -ar 48000 -ac 2 -c:a pcm_s16le sfx/whoosh.wav

# ding — 350 ms two partials 880 + 1320 Hz, exponential decay
ffmpeg -y -f lavfi -i "aevalsrc='(0.62*sin(2*PI*880*t)*exp(-9*t)+0.35*sin(2*PI*1320*t)*exp(-12*t))*min(t/0.005,1)':d=0.35:s=48000" \
  -af "lowpass=f=8000,volume=0.8" -ar 48000 -ac 2 -c:a pcm_s16le sfx/ding.wav

# riser — 1 s rising band-passed pink noise with click-safe fade-out
ffmpeg -y -f lavfi -i "anoisesrc=color=pink:d=1.0:s=48000" \
  -af "bandpass=f=800:w=1400,lowpass=f=6000,volume=volume='pow(t,2.6)':eval=frame,afade=t=out:st=0.93:d=0.07,volume=0.65,volume=55.1dB" \
  -ar 48000 -ac 2 -c:a pcm_s16le sfx/riser.wav
```

Design constraints: soft attacks (4–5 ms) so pops don't click, low-pass filtering so nothing sounds
arcade-y, conservative peak levels (~-6 dBFS max) so the mixer can sum tracks without clipping.

## BGM provenance

All tracks were downloaded from Pixabay's official CDN (`cdn.pixabay.com`) on 2026-09-18 and
re-encoded to stereo MP3. Every page was verified live (title, author, duration, license line).

| Mood key | Track | Author | Source page | Duration | License |
|---|---|---|---|---|---|
| `energetic` | Melodic Techno Journey | alex-morgan | https://pixabay.com/music/techno-trance-melodic-techno-journey-537492/ | 5:04 | Pixabay Content License |
| `calm` | Focus | AtlasAudio | https://pixabay.com/music/meditationspiritual-focus-583146/ | 8:22 | Pixabay Content License |
| `corporate` | Technology - Tech Technology | APALONBeats | https://pixabay.com/music/corporate-technology-tech-technology-549463/ | 3:22 | Pixabay Content License |
| `inspiring` | Freedom Inspired Cinematic Background Music For Video | music_for_video | https://pixabay.com/music/trap-freedom-inspired-cinematic-background-music-for-video-5606/ | 2:20 | Pixabay Content License |

Direct CDN URLs used for download (for re-downloading identical bytes):

- energetic: `https://cdn.pixabay.com/download/audio/2026/06/04/audio_4c74ab0210.mp3`
- calm: `https://cdn.pixabay.com/download/audio/2026/08/10/audio_c549c08c56.mp3`
- corporate: `https://cdn.pixabay.com/download/audio/2026/06/22/audio_155ca0c7d3.mp3`
- inspiring: `https://cdn.pixabay.com/download/audio/2021/07/22/audio_9584aae297.mp3`

### License

Pixabay Content License — https://pixabay.com/service/license-summary/

Key line (from the license summary, quoted verbatim):

> All content on Pixabay is released under the Pixabay Content License, which allows you to use the
> content for free, without attribution, for commercial and non-commercial purposes.

The summary grants, verbatim: "Use Content for free", "Use Content without having to attribute the
author", "Modify or adapt Content into new works". The relevant prohibition: do not sell or distribute
the Content on a standalone basis — vendoring the files inside the ClipMint product as background
music is permitted use, standalone redistribution of the raw mp3s is not.

Note: `energetic` (Melodic Techno Journey) is tagged "AI generated" by its uploader on Pixabay; it is
covered by the same Pixabay Content License as all other content on the platform.

## Mood mapping

The pipeline selects background music by mood key: it looks up `bgm[mood]` in
`pipeline/assets_manifest.json` and mixes the referenced file (from `remotion-captions/public/`) at
~12% volume under dialogue. Keys currently available:

- `energetic` — fast cuts, sports, hacks, hype intros
- `calm` — ambient/mindfulness, tutorials, relaxing b-roll
- `corporate` — business, product explainers, tech overviews
- `inspiring` — motivational, storytelling, cinematic travel

## Adding or replacing tracks

1. Pick a track on https://pixabay.com/music/ (filter by mood). Confirm the page shows
   "Free for use under the Pixabay Content License".
2. Download the mp3 and keep it under 8 MB — if larger, re-encode:
   `ffmpeg -y -i in.mp3 -codec:a libmp3lame -b:a 128k -ac 2 bgm/<mood>.mp3`
   (use `-b:a 112k` if 128 kbps still exceeds 8 MB — 128 is a standard MP3 CBR rate, 124 is not and
   gets silently snapped back to 128 by libmp3lame).
3. Verify: `ffprobe bgm/<mood>.mp3` — must decode as mp3, stereo, duration > 60 s.
4. Add the `"mood": "bgm/<mood>.mp3"` entry to `bgm` in `pipeline/assets_manifest.json` and a
   matching license line (`title` by `author`, source page URL) to `meta.licenses`.
5. Update the provenance table above. Keep author = the handle shown on the live Pixabay page
   (uploader handles can differ from credits found in third-party sources).
