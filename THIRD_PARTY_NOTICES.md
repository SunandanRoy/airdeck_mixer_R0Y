# Third-party notices

**The extension bundles no third-party code, models, samples or fonts.** Every file Chrome loads from this repo was written for AirDeck:

- Sound effects (air horn, siren, clap, laser), the reverb impulse response and the riser noise are synthesized in code (`src/audio/pads/synth.js`, `src/audio/fx/index.js`).
- Demo and test tracks are synthesized in code (`src/harness/fixtures.js`).
- Tempo and key detection are AirDeck's own implementations (`src/analysis/`). The key profiles are the published Krumhansl–Kessler probe-tone ratings (a scientific result, not code).
- The UI uses the system font.

The PRD lists some copyleft libraries (essentia.js, libKeyFinder, SoundTouch). AirDeck deliberately does **not** use them, so the project stays MIT-licensed. See [DECISIONS.md](DECISIONS.md).

## Development-only tools (not shipped)

These are installed by `npm install` to run the checks. They are not part of the extension.

| Package | Licence | Used for |
|---|---|---|
| [@playwright/test](https://github.com/microsoft/playwright) | Apache-2.0 | End-to-end tests, icon rendering |
| [vitest](https://github.com/vitest-dev/vitest) | MIT | Unit tests |
| [typescript](https://github.com/microsoft/TypeScript) | Apache-2.0 | Type checking JSDoc |
| [@types/chrome](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT | Chrome API types |
| [eslint](https://github.com/eslint/eslint), [globals](https://github.com/sindresorhus/globals) | MIT | Linting |

YouTube is a trademark of Google LLC. AirDeck is not affiliated with or endorsed by YouTube or Google.
