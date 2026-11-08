# Showcase carousel — how to add your real clips

The homepage carousel is fully manifest-driven: `ShowcaseCarousel.tsx` fetches
`public/showcase/manifest.json` at runtime. A card with a `src` renders and
autoplays the REAL video (muted, on hover/in-view); a card with `"src": null`
renders a generated poster placeholder.

## Add a clip (3 steps)

1. **Drop the file** — put your finished 9:16 clip in `public/showcase/clips/`,
   e.g. `clips/my-best-hook.mp4`. Keep it short (8–15s) and compressed
   (`ffmpeg -i in.mp4 -vf scale=720:1280 -crf 25 out.mp4` lands around 2 MB).
2. **Make the poster** — grab a frame ~70% in:
   `ffmpeg -ss 11 -i clips/my-best-hook.mp4 -frames:v 1 -q:v 4 posters/my-best-hook.jpg`
   (seek a couple of seconds BEFORE the clip ends — seeking to the exact
   duration produces an empty file).
3. **Register it** — put the entry FIRST in `public/showcase/manifest.json`
   (the first card shows on the homepage above the fold):

```json
{
  "src": "/showcase/clips/my-best-hook.mp4",
  "poster": "/showcase/posters/my-best-hook.jpg",
  "title": "The hook that stopped the scroll",
  "duration": "0:12",
  "style": "Hormozi",
  "hue": "mint"
}
```

Commit, push — sync-web mirrors it and the site redeploys automatically.

## Rules of thumb

- Real clips first; keep 1–2 `"src": null` placeholder slots at the end only
  if you want the "your clip lands here" grid look.
- Third-party footage needs a licence that allows it (the current demo clip is
  Sintel © Blender Foundation, CC-BY 3.0 — attribution is shown in the
  showcase subtitle; keep it there while the clip stays).
- Trim the dead air — the card autoplays muted, so the first second must
  already show the caption style doing its thing.
