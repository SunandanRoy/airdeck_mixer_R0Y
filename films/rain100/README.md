# 100 DAYS OF RAIN

A 60-second, 9:16 animated short (1080×1920). It has no narration. What if it rained for 100 days straight? The film follows one family through relief, annoyance, flooding, blackout, crop loss, rooftop survival, the low point and the break in the clouds.

| File | What it is |
|---|---|
| `build.js` | Generator. Writes `rain100.svg` and `preview.html`. It uses a fixed seed, so every build is byte-identical. |
| `rain100.svg` | The film: a single self-contained SVG with CSS `@keyframes` and no external assets (~650 KB). |
| `preview.html` | The SVG inlined on a dark page, with play/pause (or Space) and a scrubber. |
| `render.js` | A frame-accurate Playwright/Chromium renderer that writes `rain100.mp4`. |
| `rain100.mp4` | The rendered film: H.264, yuv420p, CRF 18, 30 fps, 60.0 s. |

## Run it

The generator needs Node 18+ and has no dependencies.

```bash
node build.js
```

Open `preview.html` in Chrome, or open `rain100.svg` directly. Either one plays and loops.

To render the MP4 you need Playwright with Chromium and `ffmpeg` on your PATH.

```bash
node render.js --workers 4
```

To render check stills (PNG) into `stills/`:

```bash
node render.js --stills 0.5,5,12,20,28,36,45,50,58
```

`render.js` pauses every CSS animation, then sets its `currentTime` through `document.getAnimations()` before each screenshot. Frame *n* is always exactly *n*/30 s, whatever the machine speed. Frames go to `frames/` as JPEG q95, ffmpeg encodes them, and the folder is deleted afterwards. Pass `--keep-frames` to keep it.

## How the film is built

- **One clock.** Every animation is either a 60 s master-timeline animation, with keyframes written in seconds in `tl()`, or a short loop whose duration divides 60 exactly (`loop()`). That is why the film loops seamlessly.
- **Scenes** are `<g>` groups with 0.6 s overlapping crossfades. They also toggle `visibility`, so hidden scenes cost nothing to paint. Each scene has far, mid and near layers with separate camera moves for parallax.
- **Characters** (Meera, Dadaji, crowd, props) are `<symbol>`s that every scene reuses. Meera's expressions are separate face symbols: joy, bored, worry, tired and resolve.
- **Rain** comes from three seeded tiles (far: thin and fast; near: thick and slow), repeated with `<use>`, slanted and scrolled. Ripples and splash crowns are seeded too.
- **Title card and day counter** are stroked paths from a small built-in glyph set, not font text. The counter is an odometer. Each digit column's roll is sampled from a `dayAt(t)` function and simplified into keyframes. It reaches exactly **DAY 100 at 49.000 s** and turns gold.
- **The loop seam.** One raindrop starts falling at 58.6 s over black, crosses 60 → 0, and splashes at 0.85 s to open the film.

## Notes and deviations

- The brief limits captions to 6 words, but its storyboard captions *"The first rain felt like a gift."* and *"And then, a crack in the clouds."* have 7. I kept the storyboard wording, and `build.js` prints a note about it on every build.
- The empty-market price tag shows made-up prices (₹40 → ₹65 → ₹110 → ₹180) because the storyboard asks for a price that keeps being rewritten higher. These are illustrative, not statistics. There are no real-world figures anywhere in the film.
- Captions use live text in `Inter, Helvetica, Arial, sans-serif`, so they render in whichever of those fonts the viewer has. The title card and counter are paths and look the same everywhere.
