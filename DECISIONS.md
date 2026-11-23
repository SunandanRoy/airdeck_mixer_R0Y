# Decisions

Every place the build differs from [PRD.md](PRD.md), why, and what was measured. Newest last.

---

### D-00 · 2026-11-23 · Spike 0 passed: keep the tab-capture architecture
**PRD:** §4.1, §12 M0. Verify that two tabs can be captured at the same time and mixed in one AudioContext in the Mixer tab. Fall back to "in-page decks" if that fails.

**Result:** passed. `tests/e2e/capture.spec.js` loads the unpacked extension into Chromium, opens two tabs playing 440 Hz and 660 Hz tones, mints a stream ID for each one in the service worker with `consumerTabId = mixerTab`, and plays both through the Mixer.

| Measurement | Deck A | Deck B |
|---|---|---|
| Own tone amplitude | 0.300 | 0.300 |
| Other deck's tone (crosstalk) | 1.8e-8 | 2.5e-8 |

Both captures stay live at the same time with independent gains. The fallback architecture is not needed.

**Notes:**
- Headless Chromium hands back a *silent* capture stream, so this test runs headed (`npm run e2e:capture`, under `xvfb-run` on Linux) and is skipped in the default `npm run e2e`.
- In real use, Chrome needs the user to invoke the extension on the tab (popup click or keyboard command). The test lifts that rule with Chromium's `--allowlisted-extension-id` switch. The popup/command path itself has to be checked by hand on YouTube: see [docs/TESTING.md](docs/TESTING.md). At the time of writing, that manual YouTube pass has not been recorded yet.

### D-01 · 2026-11-23 · Plain JavaScript modules, no build step (instead of WXT + TypeScript + React)
**PRD:** §4.5 (WXT, TypeScript strict, React + Zustand + Tailwind).

**Decision:** the extension is plain ES modules that Chrome loads directly from the repo folder. Type safety comes from `// @ts-check` + JSDoc, checked with `tsc --noEmit` (`npm run typecheck`) in strict mode. The UI is a small vanilla DOM layer (`src/ui/`).

**Why:** the project brief asked for a repo that is "easy to use for people", modelled on finger-gun-tabs, where you download the ZIP and *Load unpacked*. A build step would mean every user installs Node and runs a build, or the repo commits a `dist/` that can drift from the source. With no build step, the code people read on GitHub is exactly the code Chrome runs, which also supports the "Is it safe?" promise. The UI is small enough that React/Zustand would add weight without adding much clarity.

**Trade-off:** no hot reload during development. To pick up changes, reload the extension in `chrome://extensions`.

### D-02 · 2026-11-23 · Layout follows the no-build structure
**PRD:** §10.1 (`src/entrypoints/*`, `.ts` files).

**Decision:** the entry points are `src/background.js`, `src/popup/`, `src/mixer/`, `src/demo/` (the Dev Harness, see D-03), `src/welcome/` and `src/content/youtube.js`. The audio, analysis, shared and UI folders keep the PRD's split. Small related modules are grouped into one file where that reads better: `src/audio/nodes.js` (isolator, vocal cut, filter knob), `src/audio/fx/index.js`, `src/audio/transitions/index.js` and `src/audio/pads/synth.js`.

### D-03 · 2026-11-23 · The Dev Harness doubles as a user-facing Demo page
**PRD:** §10.3 (`harness.html`).

**Decision:** `src/demo/demo.html` runs the exact Mixer app with `data-mode="demo"`. Decks are fed by `MediaElementSource` using generated tracks (or the user's own audio files) instead of tab capture. The welcome page and popup link to it ("Try the demo"), so new users can hear AirDeck before they open YouTube. The Playwright harness tests run against this page.

### D-04 · 2026-11-23 · Fixtures are generated at runtime, not stored as WAV files
**PRD:** §10.4 (`scripts/make-fixtures.ts` writing WAV files).

**Decision:** `src/harness/fixtures.js` synthesizes every fixture (click120/128, bass_hi, centre_side, a_minor_chords, song_like_a/b) as pure functions. The Demo page turns them into WAV blobs in memory, and unit tests use them directly. This keeps about 60 MB of WAV files out of the repo while the fixtures stay deterministic.

### D-05 · 2026-11-23 · Isolator uses LR8 crossovers (instead of LR4)
**PRD:** §5.1 (LR4) and §13.2 (each band ≥ 30 dB down when killed).

**Why:** with LR4 at 2.5 kHz, the 5 kHz tone in `bass_hi` only drops 24.6 dB when Treble is killed, which fails §13.2. LR8 (two cascaded 4th-order Butterworth filters per split) gives more than 48 dB at one octave. The low band is all-pass compensated at 2.5 kHz, so the three bands still sum to an all-pass with a flat magnitude.

**Measured** (`tests/e2e/dsp.spec.js`): flat within ±0.5 dB from 40 Hz to 12 kHz. Bass kill at 60 Hz and Treble kill at 5 kHz are both below −30 dB.

Note that Web Audio reads `Q` for low/high-pass biquads in dB, so the Butterworth Qs are converted (`qToDb`).

### D-06 · 2026-11-23 · Vocal cut sends the full side signal (L − R), not (L − R)/2
**PRD:** §5.1 (`Side = (L − R)/2`) and §13.3 (side tone within ±1 dB).

**Why:** with `/2`, a hard-left tone comes out 6 dB quieter in the left channel, which fails §13.3. With `L − R`, the left channel keeps its level and centre-panned sound still cancels completely.

**Measured:** centre tone below −20 dB, side tone within ±1 dB.

### D-07 · 2026-11-23 · Own tempo and key detection (no realtime-bpm-analyzer, no GPL key finders)
**PRD:** §6.2 (realtime-bpm-analyzer) and §7.3 (libKeyFinder / essentia.js).

**Decision:**
- **Tempo:** the capture worklet computes an onset envelope, one value per 128-sample render quantum. That value is half full-band and half 150 Hz-low-passed log-energy rise, so kick drums count. `src/analysis/bpm.js` runs autocorrelation with a 4-harmonic comb over the last 12 s, and the result is shown once it has been stable within ±1 BPM for 8 s.
- **Key:** chroma plus Krumhansl–Kessler profiles in a module Worker (`src/analysis/key.js`).

**Why:** it adds no runtime dependency (D-01), the project stays MIT (the PRD's key libraries are GPL/AGPL), and a single worklet serves the ring buffer and onsets together.

**Measured:**
- click120 and click128 are detected within ±0.5 BPM. The demo songs are within ±1 BPM (song A reads 124.5 against a true 124).
- The A minor fixture is detected as 8A.
- Real-world accuracy on YouTube music has not been measured. Tap and click-to-redetect are always available.

### D-08 · 2026-11-23 · Ring buffer fed by worklet messages, not a SharedArrayBuffer
**PRD:** §6.4. That section already allows this fallback.

**Why:** a SharedArrayBuffer needs COOP/COEP on the Mixer page, and COEP would block the YouTube thumbnails (`i.ytimg.com` sends no CORP header). The worklet posts 1,024-frame stereo chunks, about 43 messages per second per deck, which is negligible.

### D-09 · 2026-11-23 · Spinback and Brake use a "time machine" delay line
**PRD:** §2.5. The PRD gives the effects but not how to build them.

**Decision:** each deck has a `DelayNode` (`tm`) after the FX. Ramping its delay time faster than real time plays the recent past backwards (Spinback: rate −2 → 0 over 1 beat). Ramping it slower than real time slows the sound to a stop with the pitch dropping (Brake: rate 1 → 0 over 2 beats). Everything is scheduled on the audio clock with `setValueCurveAtTime`, with no extra buffers or worklets.

### D-10 · 2026-11-23 · Echo Out keeps X's echo tail audible after the crossfader lands on Y
**PRD:** §2.5.

**Decision:** each deck's crossfader gain is `curve(position) + xfOverride`. Echo Out moves the crossfader fully to Y at `t0 + L` (Y comes in at full level) and at the same moment raises X's override to 1, then lets it decay over 2 beats. X's echo tail rings out over Y while X's dry sound has already been cut. The crossfader position itself is a single `ConstantSourceNode` fed through two WaveShaper curves, so every curve shape stays sample-accurate under automation.

**Measured** (`tests/e2e/dsp.spec.js`): Smooth Fade, Bass Swap and Echo Out at 8 beats / 120 BPM all run 4.0 s and end fully on B. Master peak stays at or below −0.5 dBFS. The second difference of the output stays below −40 dBFS, so there are no clicks.

### D-11 · 2026-11-23 · Safety clipper after the limiter
**PRD:** §5. Limiter only.

**Why:** `DynamicsCompressorNode` is not a brick-wall limiter, but §13.5 asks for a master peak at or below −0.5 dBFS. A WaveShaper after it leaves everything below 0.85 untouched and bends smoothly toward a 0.944 (−0.5 dBFS) ceiling.

### D-12 · 2026-11-23 · One ISOLATED-world content script; no MAIN-world script
**PRD:** §4.3 (separate MAIN-world script for video control).

**Why:** the content script can call `play/pause/currentTime/playbackRate` and read the player's classes through the shared DOM, so no page-world code is needed. That is simpler and safer. Ads are reported the moment `#movie_player` gains `.ad-showing` (a MutationObserver), and also on the regular 250 ms tick. Autoplay-next is switched off when a tab joins a deck.

### D-13 · 2026-11-23 · Messaging details
- The content script opens the port (`chrome.runtime.connect`) when the Mixer sends `DECK_ATTACH`, or after a reload when the service worker confirms through `WHO_AM_I` that the tab is still on a deck. The Mixer matches ports to decks by `port.sender.tab.id`.
- The Mixer reports deck ↔ tab changes with `DECK_REGISTRY` (in place of `DECK_RELEASE`). The service worker keeps the registry in `chrome.storage.session` and switches `autoDiscardable` on and off accordingly.
- The `offscreen` permission is not requested, because the P2 "audio keeps running with the Mixer closed" feature is not built.

### D-14 · 2026-11-23 · Shortcut keys
**PRD:** §2.8 (`Q/W/E/R`, `U/I/O/P` = pills).

**Decision:** only three pills work without AI Stems, so `Q W E` / `U I O` map to Bass, Vocals and Treble (add Shift to solo), and `R` / `P` hold Echo. `Z` / `M` play and pause each deck. Everything else is as specified.

### D-15 · 2026-11-23 · Scope of v0.1 (not built yet)
These items are deliberately left for later releases and are shown as such in the UI and README:
- **AI Stems (M5):** Drums and Melody pills, Vocal Handoff, Mashup and Mashup Hold. These need a ~166 MB model download and WebGPU benchmarking that could not be done in this build environment. The pills and the toggle are present but disabled, with a "coming in a later version" tooltip.
- **Key match pitch shifting (T4).** Key detection and the shift calculation (`keyMatchShift`, unit-tested) are done. The Mixer shows which shift would fit, but a pitch-shifting worklet is not built.
- **Automatic beat alignment (P1 part of T1)** and starting transitions on the next downbeat. Beat phase is estimated and drawn as ticks on the waveform. Transitions start immediately, as the PRD specifies when beat alignment is not available.
- **Ad starting mid-transition:** the deck mutes, but the transition timeline is not paused.
- **Auto-DJ and outro detection (M5/M6), session save of the queue, and the P2 items** (decks C/D, MIDI, Air Control).
- **Not measured yet:** the 60-minute endurance test (§13.9) and the 20× repeated preset runs on a live AudioContext (the offline tests render each preset once, deterministically).
