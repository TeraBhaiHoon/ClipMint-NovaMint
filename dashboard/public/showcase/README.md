# ClipMint Showcase — drop real clips here

This folder feeds the **showcase carousel** on the homepage. The carousel
(`src/app/components/ShowcaseCarousel.tsx`) fetches
`/showcase/manifest.json` at runtime and renders one 9:16 card per entry.

## Folder layout

```
public/showcase/
├── manifest.json   ← the source of truth for what the carousel shows
├── clips/          ← put your finished MP4s here
└── posters/        ← optional poster frames (JPG/WebP, 1080×1920-ish)
```

## How to add a real clip (2 minutes)

1. Drop the finished clip into `public/showcase/clips/`
   (e.g. `clips/episode-04-hook.mp4` — H.264/AAC, keep it to ~10–20 seconds
   so the page stays fast).
2. Optional but nice: drop a poster frame into `public/showcase/posters/`.
   Without one, the carousel generates layered gradient art automatically.
3. Edit `public/showcase/manifest.json`. Replace a placeholder entry like:

   ```json
   { "src": null, "title": "Your clip lands here", "duration": "0:12" }
   ```

   with a real entry:

   ```json
   {
     "src": "/showcase/clips/episode-04-hook.mp4",
     "poster": "/showcase/posters/episode-04-hook.jpg",
     "title": "Episode 04 — the hook",
     "duration": "0:42"
   }
   ```

4. Push / redeploy. That's it — the card now plays the video (muted,
   autoplay on hover or enter-viewport), shows the title + duration overlay,
   and keeps the drag / arrow / snap controls.

## Schema reference

| field      | type            | required | meaning |
|------------|-----------------|----------|---------|
| `src`      | string \| null  | yes      | Site-root-relative path to the clip (`/showcase/clips/…`). `null` = keep the generated-poster placeholder. |
| `poster`   | string \| null  | no       | Site-root-relative poster image path. Omit → generated gradient art. |
| `title`    | string          | yes      | Shown overlaid on the card. |
| `duration` | string          | yes      | Shown overlaid on the card (e.g. `"0:42"`). |
| `style`    | string          | no       | Caption-style label drawn on generated posters. |
| `hue`      | string          | no       | `"mint" \| "marigold" \| "emerald" \| "slate"` — generated-poster palette. |

A missing or malformed manifest (or entries with a missing file) always
falls back to the generated posters — the carousel never looks broken.
