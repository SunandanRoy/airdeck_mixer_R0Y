# AirDeck — rules for Claude Code

Adapted from PRD.md Appendix A for the no-build layout this repo uses (see DECISIONS.md, D-01).

- Source of truth: PRD.md. Log every deviation in DECISIONS.md with a date and the reason.
- Never schedule audio params with timers; use AudioContext time + ramps (≥ 5 ms). `smoothSet()` and the `AutomationEngine` in `src/audio/automation.js` do this for you.
- All audio features must work in the Dev Harness (`src/demo/demo.html`) with the generated fixtures in `src/harness/fixtures.js`; test there first.
- Keep YouTube-specific code ONLY in `src/content/youtube.js`. Everything else goes through the `DeckSource` interface (`src/sources/sources.js`).
- Heavy compute = Worker/Worklet only. Main thread < 8 ms/frame.
- No build step: plain ES modules that Chrome loads directly. Don't add a bundler or runtime npm dependencies.
- Type safety via `// @ts-check` + JSDoc. Run `npm run check` (tsc, ESLint, Vitest, Playwright) before each commit.
- No network calls. The extension CSP allows only `i.ytimg.com` thumbnails; keep it that way.
- UI copy: plain language, no jargon (say "Bass off", not "LF kill"). Glossary: PRD.md Appendix B.
