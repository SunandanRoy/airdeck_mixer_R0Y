# Contributing

Thanks for helping. AirDeck aims to be **easy beats professional**: every feature should be usable with one click and no audio jargon.

## Set up

1. Clone the repo and load it in `chrome://extensions` → **Developer mode** → **Load unpacked**.
2. After you change code, click the reload arrow on AirDeck's card. Then reload the Mixer or Demo page.
3. Install the dev tools and run the checks:

```bash
npm install
```

```bash
npm run check
```

Most audio work is fastest on the Demo page (`src/demo/demo.html`), which needs no YouTube. You can also serve the folder and open the page over HTTP:

```bash
npx http-server . -p 4173
```

Then open <http://127.0.0.1:4173/src/demo/demo.html>.

## Project layout

```
manifest.json            extension manifest (Load unpacked points here)
src/background.js        service worker
src/content/youtube.js   the only YouTube-specific code
src/popup/               toolbar popup
src/mixer/  src/demo/    page shells for the Mixer and the Demo / Dev Harness
src/welcome/             first-run page
src/ui/                  Mixer UI (vanilla DOM), shortcuts, storage
src/audio/               engine, deck chain, DSP nodes, FX, transitions, recorder, worklet
src/analysis/            tempo, key, Camelot wheel, title cleaner
src/sources/             DeckSource implementations (tab capture, media element)
src/harness/fixtures.js  generated test and demo tracks
tests/unit/              Vitest (pure logic)
tests/e2e/               Playwright (offline DSP renders, Demo page, unpacked extension)
docs/                    architecture, testing, images
```

## Rules

These are the same as [CLAUDE.md](CLAUDE.md):

- **No build step and no runtime dependencies.** The repo must stay loadable as-is.
- Start every new file with `// @ts-check` and add JSDoc types. `npm run typecheck` must pass.
- **Audio params change only on the audio clock**, with ramps of 5 ms or more. Use `smoothSet()` or a transition Plan, never `setInterval`.
- Build nodes once. Bypass FX with wet = 0 instead of disconnecting them.
- Heavy work goes in a Worker or Worklet.
- No network requests.
- Plain-language UI copy. See the glossary in PRD.md, Appendix B.
- If you change a behaviour the PRD specifies, add an entry to [DECISIONS.md](DECISIONS.md).

## Pull requests

Keep them focused. Describe what a user will notice, and include a screenshot for UI changes. Make sure `npm run check` passes.
