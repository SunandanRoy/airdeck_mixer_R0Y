# AirDeck — PRD for a YouTube-Tab DJ Mixer (Chrome Extension)

**Version:** 1.0 · **Date:** 23 Nov 2026 · **Owner:** Aman Chaturvedi · **Builder:** Claude Code
**Status:** Ready to build. Put this file at the repo root as `PRD.md`.

> **Implementation note:** this is the original product spec. What was actually built, and every place the build differs from this document, is recorded in [DECISIONS.md](DECISIONS.md). Feature status is tracked in [README.md](README.md#whats-in-v01).

---

## 0. How Claude Code should use this document

**Kickoff prompt (paste into Claude Code):**

> Read `PRD.md` end to end. Build AirDeck exactly as specified, following the Build Order in §12 without waiting for approval between milestones. Start with Spike 0 (§12, M0). If any spike result contradicts this PRD, apply the fallback written next to that spike, record what happened in `DECISIONS.md`, and keep going. Before writing code, clone the reference repos in §11 into `/reference` (gitignored), read the relevant parts, and copy patterns, not whole files. Every milestone ends with its acceptance tests (§13) passing on the Dev Harness (§10.3). Commit after each milestone. Create `CLAUDE.md` from Appendix A. When finished, write `README.md` with install steps (Load unpacked) and a 60-second usage guide.

**Ground rules**
- No paid APIs, no API keys, no backend server, no accounts. Everything runs locally in the browser.
- One allowed network fetch: downloading open-source model weights once (Hugging Face), then caching them locally. Bundling the weights in the extension is the fallback.
- Personal-use tool. It does not download YouTube files. It only processes audio that is already playing in the user's own tabs.

---

## 1. Product summary

AirDeck turns any two (later up to four) YouTube tabs into **DJ decks**. A single **Mixer tab** takes the audio from those tabs, lets you switch sound parts on and off ("drop the bass", "kill the vocals", "only drums"), match tempo and key, and run **one-tap transitions** between songs (smooth fade, bass swap, echo out, and so on). You can record the result.

**Design principle: easy beats professional.** Every feature should be usable with one click or one slider and no audio-engineering vocabulary. Advanced controls sit behind an "Advanced" disclosure, closed by default.

### 1.1 Target user
A non-professional who wants to mix songs at a party, for a reel, or for fun. They know songs, not dB, Q-factors or beatgrids.

### 1.2 Success criteria
| Metric | Target |
|---|---|
| Time from install to first transition | < 2 minutes, no tutorial |
| Clicks to load a YouTube tab onto a deck | ≤ 2 (keyboard shortcut or popup button) |
| Quick sound switches (Bass/Mid/High/Vocal-cut) response time | < 50 ms perceived |
| Transition preset reliability | 0 audible clicks/pops in 20 consecutive runs on the harness |
| AI Stems warm-up on a WebGPU laptop | ≤ 15 s before stem audio starts |
| Crash-free 60-minute session | Yes (no memory growth > 300 MB over baseline) |

### 1.3 Non-goals
- Not a pro console: no 4-band parametric EQ per channel, no jog-wheel scratch physics, no DVS. Hardware MIDI support comes later (P2).
- No downloading or saving YouTube source audio as files (recording the *mix* is allowed for personal use).
- No song identification against a fingerprint database. See §7.6 for why and what is used instead.
- No support for non-YouTube sites in v1. The architecture must not hard-block them, though: the capture layer is site-agnostic and only the metadata/controls adapter is YouTube-specific.

---

## 2. Feature set (prioritised)

**P0 = MVP · P1 = v1 · P2 = later.** Names in quotes are the user-facing labels.

### 2.1 Decks
| # | Feature | Priority | User-facing behaviour |
|---|---|---|---|
| D1 | "Send to Deck A/B" | P0 | On any YouTube tab: click the toolbar icon → Deck A / Deck B, or press `Alt+Shift+1` / `Alt+Shift+2`. The tab's audio moves into the Mixer. |
| D2 | Deck card | P0 | Thumbnail, title, channel, elapsed/remaining time, play/pause, seek bar, volume. |
| D3 | Auto level match | P0 | Both decks are normalised to the same loudness automatically (on by default). |
| D4 | "Hot cues" | P1 | 4 buttons per deck. Tap an empty one to save the current position; tap a saved one to jump. Long-press clears it. |
| D5 | "Loop" | P1 | Buttons: Loop 1 / 2 / 4 / 8 beats. Loops the *last* N beats seamlessly from the deck's audio buffer (§6.4). Tap again to release. |
| D6 | BPM + key display | P0 BPM / P1 key | e.g. "124 BPM · 8A (A minor)". Shows "detecting…" until confident. Includes a "Tap" button for manual BPM. |
| D7 | Ad guard | P0 | If YouTube is showing an ad on a deck's tab, the deck auto-mutes and shows "Ad playing". It unmutes when the ad ends. |
| D8 | Up to 4 decks | P2 | Decks C/D, same behaviour. |

### 2.2 Sound switches (the core "easy" feature)
Each deck has a row of big toggle pills. Tapping one turns that part **off**; tapping again turns it back **on**. Long-press = **solo** (that part only). Each pill also has a small level slider under Advanced.

| Pill | Quick mode (always available, real-time DSP) | AI Stems mode (P1) |
|---|---|---|
| "Bass" | Low band (< 250 Hz) of a 3-band isolator | Demucs `bass` stem |
| "Vocals" | Vocal-cut approximation (centre-channel removal above 150 Hz) — labelled "approx." | Demucs `vocals` stem |
| "Drums" | Greyed out, with tooltip "Turn on AI Stems" | Demucs `drums` stem |
| "Melody" | Greyed out, with tooltip "Turn on AI Stems" | Demucs `other` stem |
| "Treble" | High band (> 2.5 kHz) of the isolator | High band of the isolator, applied after the stems are summed |

A deck toggle "AI Stems" (off by default) switches the deck from Quick to AI mode. See §7.2 for the trade-offs, including the warm-up delay.

### 2.3 Tempo and key
| # | Feature | Priority | Behaviour |
|---|---|---|---|
| T1 | "Sync" | P0 | Matches this deck's tempo to the other deck (tempo-only in P0; tempo + beat alignment in P1). The pitch is kept constant. |
| T2 | Tempo slider | P0 | ±8% by default, ±16% under Advanced. |
| T3 | "Nudge" ◀ ▶ | P1 | Briefly slows or speeds the deck to line up beats by ear. |
| T4 | "Key match" | P1 | Shifts this deck's pitch by up to ±2 semitones to the nearest compatible key (Camelot wheel). |
| T5 | "Pitch" | P2 | Manual ±6 semitones. |

### 2.4 Mixer and transitions
| # | Feature | Priority | Behaviour |
|---|---|---|---|
| M1 | Crossfader | P0 | Curve selector: Smooth (equal-power, default) / Sharp (cut) / Linear. |
| M2 | Channel faders + master volume + limiter | P0 | A master limiter is always on, so nothing clips. |
| M3 | "Filter" knob per deck | P0 | One knob: centre = off, left = low-pass sweep, right = high-pass sweep. |
| M4 | **One-tap transitions** | P0 (first 3) / P1 (rest) | Pick a preset and a length (4 / 8 / 16 / 32 beats, or seconds if BPM is unknown), then press **"Mix to B"** (or "Mix to A"). See §2.5. |
| M5 | "Auto-DJ" | P1 | A queue of YouTube tabs or URLs. Each next track is loaded into the idle deck, synced, and mixed in with a chosen preset when the current track enters its last ~30 s or the outro detector fires (§7.5). |
| M6 | "Mashup" | P1 | One button: vocals of A + instrumental of B, tempo- and key-matched. Requires AI Stems on both decks. |
| M7 | Record mix | P0 | Record → Stop → download `.webm` (Opus) or `.wav`. A timer and level meter are shown. |
| M8 | Session save | P1 | Save the deck setup, cues, preset choices and queue to `chrome.storage.local`. |

### 2.5 Transition presets (scripted automations)
Each preset is a **timeline of parameter changes** scheduled sample-accurately on the AudioContext clock (§6.5). `L` = transition length, `X` = outgoing deck, `Y` = incoming deck.

| Preset | Priority | Script |
|---|---|---|
| "Smooth Fade" | P0 | Crossfader moves X→Y over `L` on the equal-power curve. |
| "Bass Swap" | P0 | Y starts with its bass off; both decks play at full level; at `L/2` (snapped to the beat) X's bass switches off and Y's bass switches on in one beat; X fades out over the remaining `L/2`. |
| "Echo Out" | P0 | X gets a beat-synced echo (1/2 beat, feedback 0.55) for the last 2 beats while its dry signal cuts; Y comes in at full level on the next downbeat. |
| "Filter Fade" | P1 | X's high-pass sweeps 20 Hz → 2 kHz while Y's low-pass sweeps 2 kHz → 20 kHz; the crossfader follows. |
| "Quick Cut" | P1 | Instant switch on the next downbeat. |
| "Vocal Handoff" | P1 (AI) | X's vocals mute at the start; Y enters with its vocals muted; at the end, X fades out and Y's vocals come back. |
| "Spinback" | P1 | X does a vinyl spin-back (reverse plus pitch drop over 1 beat), then Y drops in. |
| "Brake" | P1 | X slows to a stop over 2 beats (simulated turntable stop), then Y drops in. |
| "Riser Build" | P1 | A synthesized white-noise riser plus a rising high-pass on X over `L`, then Y drops in on the downbeat. |
| "Mashup Hold" | P2 (AI) | X's vocals keep playing over Y's beat for `L`, then fade. |

Rules for every preset:
- If either deck has no BPM, fall back to seconds (8 beats ≈ 4 s).
- Start on the next downbeat when beat alignment is available (P1); otherwise start immediately.
- When a transition finishes, the outgoing deck is paused and the crossfader is left at Y.
- A "Cancel" button reverses the change smoothly over 1 s.

### 2.6 FX pads (per deck, one tap each)
P0: "Echo", "Reverb", "Filter Sweep". P1: "Flanger", "Lo-Fi" (bitcrush + low-pass), "Stutter" (repeats 1/4 beat from the buffer), "Telephone" (band-pass 300–3,400 Hz). Each pad is momentary (hold) or latched (double-tap), and has a single "Amount" knob.

### 2.7 Sample pads (P1)
8 pads in the Mixer:
- 4 built-in sounds **synthesized in code** (air horn, siren, clap, laser), so no audio files carry licensing problems.
- 4 "Grab" pads: tap Grab, and the last 1 bar of Deck A or B (from the buffer) is stored on that pad.

### 2.8 Controls beyond the mouse
| Feature | Priority |
|---|---|
| Keyboard shortcuts in the Mixer: `Q/W/E/R` = Deck A pills, `U/I/O/P` = Deck B pills, `Space` = Mix-to, `←/→` = crossfader nudge, `1–4` / `7–0` = hot cues | P0 |
| Web MIDI mapping (learn mode) for cheap USB controllers | P2 |
| "Air Control": hand gestures through the webcam with MediaPipe Hands (palm height = crossfader; pinch = toggle the selected pill; swipe = Mix-to) | P2 |

---

## 3. UX specification

### 3.1 Surfaces
1. **Toolbar popup (on a YouTube tab):** two big buttons, "Send to Deck A" and "Send to Deck B", plus "Open Mixer". If the Mixer isn't open, sending a tab opens it.
2. **Mixer tab** (`mixer.html`, an extension page pinned as a normal tab). This is the main app *and* the audio engine host.
3. **In-page badge on YouTube** (small, unobtrusive): "On Deck A" with a coloured dot, so the user knows which tab is which.

### 3.2 Mixer layout (desktop, ≥ 1280 px wide)
```
┌──────────────────────────────────────────────────────────────────────┐
│  AirDeck      [● REC 00:00]                 Master ▮▮▮▮▯  [⚙]        │
├───────────────────────────┬───────────┬──────────────────────────────┤
│ DECK A  [thumb] Title     │  MIX      │ DECK B  [thumb] Title        │
│ 124 BPM · 8A   [Sync]     │           │ 122 BPM · 9A   [Sync]        │
│ ~~~~ scrolling waveform ~~│ Preset ▾  │ ~~~~ scrolling waveform ~~   │
│ ▶ ❚❚  ───●────── 2:31     │ Length ▾  │ ▶ ❚❚  ──●──────── 0:12       │
│ [Bass][Vocals][Drums]     │ [MIX → B] │ [Bass][Vocals][Drums]        │
│ [Melody][Treble]          │           │ [Melody][Treble]             │
│ AI Stems ○                │ A ═══●═ B │ AI Stems ●  (ready)          │
│ Cues ① ② ③ ④  Loop 1 2 4 8│           │ Cues ① ② ③ ④  Loop 1 2 4 8   │
│ FX [Echo][Reverb][Sweep]  │           │ FX [Echo][Reverb][Sweep]     │
│ Filter ◐   Tempo ─●─      │           │ Filter ◐   Tempo ─●─         │
├───────────────────────────┴───────────┴──────────────────────────────┤
│ Pads [Horn][Siren][Clap][Laser][Grab1][Grab2][Grab3][Grab4]          │
│ Auto-DJ queue: 1. ...  2. ...   [+ add current tab] [Start Auto-DJ]  │
└──────────────────────────────────────────────────────────────────────┘
```
- Dark theme with high-contrast pills. Deck A is cyan and Deck B is magenta throughout, including the badges and waveforms.
- Pill states: On (filled), Off (outlined + strikethrough icon), Solo (glowing), Unavailable (greyed, with tooltip).
- Every control has a tooltip in plain language ("Bass off: removes the thump").
- Empty state for a deck: "Open a YouTube video and press Alt+Shift+1".

### 3.3 Status messages (plain language)
| Situation | Message |
|---|---|
| Capture refused | "Click the AirDeck icon on that tab, then choose Deck A — Chrome needs a click to share tab audio." |
| AI Stems warming up | "Getting stems ready… 9 s" (countdown) |
| GPU missing | "AI Stems needs a newer graphics setup (WebGPU). Quick mode still works." |
| BPM unknown | "Can't find the beat yet — tap the Tap button to the rhythm." |
| Tab closed | Deck shows "Tab closed" and fades out over 1 s. |

---

## 4. Architecture

### 4.1 Decision: one audio graph in the Mixer tab via `chrome.tabCapture`
Each deck's YouTube tab is captured with `chrome.tabCapture`, and all streams are mixed in **one AudioContext inside the Mixer tab**. This is what makes a single master bus, transitions with sample-accurate timing, recording and a single shared ML model possible.

Facts this design relies on (verify in Spike 0):
- tabCapture can only be called after the user invokes an extension, such as by clicking the extension's action button. That's why loading a deck goes through the popup or a keyboard command, both of which count as invocation.
- When a MediaStream is obtained for a tab, audio in that tab will no longer be played to the user. That's what we want: the Mixer becomes the only output.
- If `consumerTabId` is given, the ID can be used by a getUserMedia() call in any frame in the given tab which has the same security origin, so the service worker can mint the ID with `consumerTabId = mixerTabId`.
- Starting in Chrome 116, you can call the chrome.tabCapture API in a service worker to obtain a stream ID following user gesture.

**Fallback architecture (only if Spike 0 fails):** "In-page decks". A MAIN-world content script wraps the YouTube `<video>` element in `createMediaElementSource` and builds the deck chain inside each YouTube tab. Existing equalizer extensions use this pattern — Peaks, for example, runs in the MAIN world of the page (same JavaScript context as the website). The Mixer then sends parameter messages, and transitions are coordinated by timestamps. Recording and the shared model are lost in this mode. Record the choice in `DECISIONS.md`.

### 4.2 Component diagram
```
YouTube Tab A ──(tabCapture stream)──┐
  └ content script (control + meta)  │      MIXER TAB (extension page)
YouTube Tab B ──(tabCapture stream)──┼──►  AudioContext
  └ content script (control + meta)  │       ├ DeckChain A ─┐
                                      │       ├ DeckChain B ─┼─► MasterBus ─► Limiter ─► speakers
Service Worker (MV3)                  │       │              └─► Recorder (MediaRecorder / WAV)
  ├ commands (Alt+Shift+1/2)          │       ├ AnalysisWorklets (BPM, onsets, loudness, waveform)
  ├ tab registry, stream-ID minting ──┘       ├ StemWorker (ONNX Runtime Web, WebGPU) ◄─► RingBuffers
  └ storage                                   └ UI (React) + Store (Zustand) + AutomationEngine
```

### 4.3 Responsibilities
| Context | Owns | Must not |
|---|---|---|
| Service worker | Commands, popup actions, `getMediaStreamId`, tab registry (`deckId ↔ tabId`), opening/focusing the Mixer, `autoDiscardable:false` on deck tabs | Hold audio or long-lived state (it can be killed at any time) |
| YouTube content script (ISOLATED world) | Message bridge, deck badge | Touch audio |
| YouTube page script (MAIN world) | `video.play/pause/currentTime/playbackRate`, reading title/channel/thumbnail/duration, ad detection (`.ad-showing` on `#movie_player`), turning off YouTube autoplay-next | Process audio (except in fallback mode) |
| Mixer tab | All audio, analysis, ML, UI, recording | Assume the service worker is alive |

### 4.4 Message protocol (typed; `src/shared/messages.ts`)
| Message | From → To | Payload |
|---|---|---|
| `DECK_ASSIGN` | SW → Mixer | `{deckId, tabId, streamId}` |
| `DECK_RELEASE` | Mixer → SW | `{deckId}` |
| `VIDEO_CMD` | Mixer → content | `{cmd: 'play'│'pause'│'seek'│'rate', value?}` |
| `VIDEO_STATE` | content → Mixer (every 250 ms + on events) | `{currentTime, duration, paused, rate, adShowing}` |
| `TRACK_META` | content → Mixer | `{title, channel, thumbnailUrl, videoId}` |
| `TAB_CLOSED` | SW → Mixer | `{tabId}` |

Use `chrome.runtime.connect` ports between the Mixer and each content script (long-lived), and reconnect on disconnect.

### 4.5 Tech stack
| Layer | Choice | Why |
|---|---|---|
| Extension framework | **WXT** (Vite-based, MV3); alternative Vite + `@crxjs/vite-plugin` | Hot reload, multiple entrypoints, TypeScript |
| Language | TypeScript, strict mode | |
| UI | React 18 + Zustand + Tailwind | Simple, fast to iterate |
| Audio | Web Audio API + AudioWorklets | Native and low latency |
| ML runtime | `onnxruntime-web` (WebGPU EP, WASM fallback) inside a dedicated Worker | Standard for in-browser Demucs |
| Tests | Vitest (pure DSP math, automation timelines), Playwright with the unpacked extension loaded (E2E on the Dev Harness) | |

Manifest essentials: `permissions: ["tabCapture","tabs","storage","scripting","offscreen"]`, `host_permissions: ["https://www.youtube.com/*"]`, `commands` for `Alt+Shift+1/2`, and `content_security_policy.extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"` (required for ONNX/WASM). `offscreen` is reserved for the fallback in which the Mixer UI is closed but audio keeps running (P2).

---

## 5. Audio graph per deck

```
MediaStreamSource (tab capture)
  → InputTrim (auto level match gain)
  → [Mode switch]
       Quick:  Isolator3 (LR4 crossover @250 Hz & 2.5 kHz; per-band gain) + VocalCut
       AI:     StemPlayer (4 stem buses: vocals/drums/bass/other, each with gain) → Isolator3 (treble only)
  → PitchShifter (SoundTouch worklet; bypassed when pitch = 0)
  → FilterKnob (biquad LP/HP, one-knob mapping)
  → FX rack (Echo, Reverb, Flanger, LoFi, Stutter, Telephone) with wet/dry
  → DeckRingBuffer tap (last 60 s of post-trim audio, for loops/grab/stutter/spinback)
  → ChannelFader → CrossfaderGain
  → MasterBus
MasterBus → MasterLimiter (DynamicsCompressor, threshold −1 dBFS, ratio 20, fast attack) → destination + Recorder
```

### 5.1 DSP specs
- **Isolator3:** Linkwitz-Riley 4th order = two cascaded 2nd-order Butterworth biquads (Q = 0.7071) per split. Low = LP@250; High = HP@2500; Mid = HP@250 → LP@2500. When all band gains = 1, the bands must sum flat within ±0.5 dB (unit test with an impulse/FFT on an OfflineAudioContext). A "kill" ramps the gain to 0 over 15 ms with `setTargetAtTime`, so it never clicks.
- **VocalCut (approx.):** `out = LowBand(original, <150 Hz) + Side(>150 Hz)`, where `Side = (L − R)/2`, sent to both channels. Keeps the bass and removes centre-panned vocals. Label it "approx." in the UI.
- **Crossfader, equal-power:** `gA = cos(x·π/2)`, `gB = sin(x·π/2)` for x ∈ [0,1]. At x = 0.5 both gains = 0.7071, so the summed power = 0.5 + 0.5 = 1 and perceived loudness stays constant. Sharp curve: gains stay at 1 until within 5% of the far end. Linear: `gA = 1 − x`.
- **Filter knob:** knob k ∈ [−1, 1]. For k < 0, low-pass cutoff = `20000 · 2^(k·10)` Hz (k = −1 → ≈19.5 Hz). For k > 0, high-pass cutoff = `20 · 2^(k·10)` Hz (k = 1 → 20,480 Hz). Resonance Q = 1.0. Dead zone |k| < 0.03 = bypass.
- **Auto level match:** integrated loudness estimated over a rolling 10 s (K-weighting approximated with a high-shelf +4 dB @1.5 kHz and HP@60 Hz, then RMS). Target −14 LUFS-equivalent. InputTrim is clamped to [−12, +6] dB and changes at most 1 dB/s, so it never "pumps".
- **Echo:** DelayNode with time = 60/BPM × fraction (1/2 beat default; 375 ms when BPM is unknown), feedback 0.5, a low-pass in the feedback loop @ 6 kHz.
- **Reverb:** ConvolverNode with an impulse response *generated in code* (exponentially decaying noise, 2.5 s), so no IR files are needed.

---

## 6. Timing, tempo, buffers and automation

### 6.1 Tempo change
Use the YouTube player's own `video.playbackRate` through `VIDEO_CMD rate`. Chrome keeps the pitch by default (`preservesPitch = true`), so **tempo changes need no DSP on our side** and the captured stream reflects them. Valid range: 0.84–1.16 (±16%).

### 6.2 BPM detection
- Primary: `realtime-bpm-analyzer` (MIT, AudioWorklet-based) on each deck's post-trim signal. The library can be used to analyze audio or video nodes, streams as well as files.
- Show "detecting…" until the top candidate has been stable for 8 s. Fold the result into the 70–180 BPM range (halve or double).
- The "Tap" button overrides with the average of the last 4–8 taps.
- **Effective BPM** = detected BPM × playbackRate. Always display the effective BPM.

### 6.3 Sync and beat alignment
- **P0 Sync (tempo only):** `rateY = (bpmX_effective / bpmY_detected)`, clamped to ±16%. If the ratio is outside that range, try ×2 or ×½ of the BPM first (handles 70 vs 140 BPM).
- **P1 Beat alignment:** an onset detector (spectral flux in an AudioWorklet) produces beat timestamps per deck. Phase = (time of last beat mod beat period). To align, apply a temporary rate offset of ±2% for `Δphase / 0.02` seconds, then restore. A drift guard re-checks every 8 beats and corrects only if |Δphase| > 20 ms.
- The video seek (`currentTime`) is *not* used for alignment: YouTube seeks take 100–300 ms and are imprecise.

### 6.4 Deck ring buffer (enables loops, grab, stutter, spinback)
- Holds the last 60 s of each deck's post-trim audio in a SharedArrayBuffer ring (stereo Float32).
- Memory per deck: 2 ch × 44,100 samples/s × 4 bytes × 60 s = **21.2 MB**. For 2 decks, 42.3 MB.
- **Loop N beats:** on press, pause the YouTube video (`VIDEO_CMD pause`) and play the last N beats from the ring through an AudioBufferSourceNode with `loop = true`, with 5 ms crossfades at the loop seam. On release, resume the video. Because playback resumes from where it paused, the song continues with no skipped audio.
- The SharedArrayBuffer requires cross-origin isolation on the Mixer page (`cross_origin_embedder_policy` / `cross_origin_opener_policy` in the manifest). If that turns out to be impractical, post Float32Array chunks from the worklet to the main thread instead (slower, but fine).

### 6.5 Automation engine (`src/audio/automation.ts`)
- A transition preset = a pure function `(ctx: {L, bpm, now, decks}) → AutomationEvent[]`, where each event is `{target: ParamRef, type: 'set'│'linear'│'exp'│'curve', value, time}`.
- The engine converts the events to `AudioParam` calls (`setValueAtTime`, `linearRampToValueAtTime`, `setValueCurveAtTime`) on the AudioContext clock. **Never** drive audio parameters with `setInterval`/`requestAnimationFrame`.
- The UI mirrors scheduled values for display only (crossfader animation driven by rAF reading the expected curve).
- Cancel = `cancelAndHoldAtTime(now)` on all affected params, then a 1 s ramp back.
- Presets are **unit-tested as pure data**: given L = 8 beats at 120 BPM (4.0 s), Bass Swap must schedule X-bass-off and Y-bass-on at t0 + 2.0 s ± 1 ms.

---

## 7. AI Stems mode (P1) and analysis features

### 7.1 Model
- **HTDemucs v4 (4 stems: drums, bass, other, vocals)**, ONNX export, run with `onnxruntime-web` on WebGPU.
- Candidate weights, all MIT-licensed exports of Meta's MIT weights:
  - `Ghilda/htdemucs-onnx` — this build already powers YouStem, a Chrome/Brave extension doing the same job. The ONNX model is about 166 MB in float32, and the model processes fixed 7.8-second segments (343,980 samples at 44.1 kHz), with the host application comput[ing] the STFT and iSTFT in JavaScript and perform[ing] the final sum.
  - `monteslu/htdemucs-web-onnx` — mixed precision and chained into pieces, in a form designed to run while the same GPU is rendering a UI the user is watching. **Preferred**, because the Mixer UI renders waveforms while the model runs.
  - `StemSplit` `demucs-onnx` tooling (scaffolds a browser demo; documents an fp16-weights variant for the browser).
- Claude Code: benchmark the two preferred exports in M5 and keep the faster one that meets ≥ 1.5× real-time. Log the numbers in `DECISIONS.md`.
- Caching: the first time AI Stems is enabled, download the weights with a progress bar and store them in the extension's Cache Storage or OPFS. After that, load locally. Fallback: ship them in `/public/models/` (unpacked install only).
- Throughput reference: one in-browser implementation reports that WebGPU allows it to run at about 3x realtime on the author's machine, and that without WebGPU it will be much, much slower. AI Stems is therefore **WebGPU-only**; no WASM fallback for live use.

### 7.2 "Live-delayed" stem pipeline
The model needs 7.8 s windows, so live stems are necessarily **delayed**. The UX hides this with a warm-up countdown, and AI Stems is best switched on for the *incoming* track while it is cued.

```
Tab stream → CaptureWorklet → input ring (raw)
          → StemWorker: take 7.8 s window, hop 5.85 s (25% overlap) → STFT → ORT → iSTFT
          → overlap-add with linear crossfade over the 1.95 s overlap → 4 stem rings
StemPlayer reads the 4 stem rings at (now − D) → 4 gain nodes → deck chain
```
Latency/throughput arithmetic (to be logged with real numbers in `DECISIONS.md`):
- Segment = 343,980 / 44,100 = **7.80 s**. Hop at 25% overlap = 7.80 × 0.75 = **5.85 s**.
- Processing time per segment at speed R× real-time = 7.80 / R s. Keeping up requires 7.80/R < 5.85 → **R > 1.33×**.
- Output delay D ≈ segment + processing + 1 s safety. At R = 3: 7.80 + 2.60 + 1.00 = **11.4 s**. At R = 1.5: 7.80 + 5.20 + 1.00 = **14.0 s**.
- Set D adaptively: measure R on the first 2 segments, then fix D for the session. If R drops below 1.4 during playback, show "Stems can't keep up" and fall back to Quick mode with a 2 s crossfade.
- Memory: 4 stems × 2 ch × 44,100 × 4 B = 1.41 MB/s. A 90 s rolling stem window = **127 MB per deck**. Cap at 90 s, and allow AI Stems on at most 2 decks at once.

Consequences the UI must handle:
- When AI Stems turns on, the deck's audio is D seconds behind the YouTube video picture. Show a "video is ahead by 11 s" chip. Acceptable: the user listens, they don't watch.
- On the **cued (silent) deck**, stems prepare while the user plays deck A, so by the time they mix, there is no waiting. This is the main intended workflow, and the Mashup and Vocal Handoff presets assume it.
- Seeking or a hot-cue jump in AI mode flushes the stem rings and restarts the warm-up (with countdown).

### 7.3 Key detection (P1)
- Run chroma/key estimation on the 30 s after a track loads, with `webKeyFinder`'s approach (libKeyFinder compiled to WASM). In that project, once roughly one second of audio is recorded, the chuck is sent to a web worker running the key finder WebAssembly module. Alternative: `essentia.js` KeyExtractor.
- Display as Camelot + name, e.g. "8A (A minor)".
- **Key match:** compute the semitone shift s ∈ [−2, +2] that moves Y onto X's Camelot number or an adjacent one (±1 on the wheel, same letter), preferring |s| smallest. Apply it through the SoundTouch AudioWorklet (`@soundtouchjs/audio-worklet`) with `pitchSemitones = s`.
- Licence note: essentia.js and libKeyFinder are copyleft (AGPL/GPL). That's fine for a personal, unpublished tool. If AirDeck is ever published, replace them or comply with the licence (§14).

### 7.4 Waveforms and meters
- Live scrolling waveform from the ring buffer (peak per 512 samples, rendered to canvas at 60 fps; past 8 s visible).
- Beat ticks overlaid when beats are known. A per-deck and master level meter (RMS + peak hold).

### 7.5 Outro detection for Auto-DJ (P1)
Trigger the transition at `max(duration − 30 s, firstOf(energyDrop))`, where an energy drop is the 4 s RMS falling below 40% of the track's running median for 2 consecutive bars within the last 60 s. A YouTube duration < 90 s is treated as "not a song": skip the track and warn.

### 7.6 Song identification — what we do instead
True song recognition (Shazam-style) needs a fingerprint *database* of reference recordings, which means a remote API or a huge local index. That's out of scope by design. Instead:
- **Track metadata** is read from the YouTube page (title, channel, thumbnail, videoId).
- A title cleaner removes noise like "(Official Video)", "[Lyrics]", "4K", "HD", "ft." normalisation, and "Artist - Title" splitting. Unit-test it with 30 sample titles.
- BPM and key come from audio analysis (§6.2, §7.3), which is what a DJ actually needs.

---

## 8. Data and settings
`chrome.storage.local` schema (versioned, `schemaVersion: 1`):
```ts
{
  settings: { crossfaderCurve, defaultPreset, defaultLengthBeats, autoLevel: true, theme: 'dark',
              shortcuts: Record<Action, KeyCombo>, aiStemsModel: 'monteslu-mixed' | 'ghilda-fp32' },
  cuesByVideoId: Record<videoId, (number|null)[4]>,   // hot cues remembered per song
  analysisByVideoId: Record<videoId, {bpm?, key?, analyzedAt}>, // skip re-detection next time
  sessions: Session[], autoDjQueue: QueueItem[]
}
```

---

## 9. Edge cases (must handle)
| Case | Expected behaviour |
|---|---|
| User navigates the deck tab to a different video | Detect the videoId change → reset BPM/key/cues → load cached analysis if one exists → keep the capture stream. |
| Deck tab closed / Mixer closed | Deck fades out over 1 s / every capture is released, and the YouTube tabs play normally again. |
| Same tab sent to both decks | Refuse with "This tab is already on Deck A". |
| Ad starts mid-transition | Pause the transition timeline (`cancelAndHoldAtTime`), mute that deck, resume when the ad ends. |
| YouTube autoplay jumps to a new video | Autoplay is disabled on deck tabs; if it happens anyway, treat it as a navigation. |
| Chrome Memory Saver discards a background deck tab | Set `chrome.tabs.update(tabId, {autoDiscardable: false})` while it's on a deck. |
| Sample rate is not 44.1 kHz (e.g., 48 kHz) | Resample to 44.1 kHz before the model (linear-phase resampler in the worker) and back afterwards. |
| No WebGPU | AI Stems pills show "Needs WebGPU"; Quick mode is unaffected. |
| AudioContext suspended (autoplay policy) | A full-screen "Click to start AirDeck" overlay appears on first open. |

---

## 10. Project structure, quality and testing

### 10.1 Repo layout
```
airdeck/
  PRD.md  CLAUDE.md  DECISIONS.md  README.md
  wxt.config.ts  package.json  tsconfig.json
  src/
    entrypoints/
      background.ts                 # service worker
      popup/ (index.html, main.tsx)
      mixer/ (index.html, main.tsx)  # main app + audio host
      harness/ (index.html, main.tsx)# Dev Harness (§10.3)
      youtube.content.ts            # ISOLATED world bridge + badge
      youtube-main.content.ts       # MAIN world: video control, meta, ads
    audio/
      engine.ts  deck.ts  master.ts  isolator.ts  vocalcut.ts  crossfader.ts
      filterknob.ts  levelmatch.ts  recorder.ts  ringbuffer.ts  automation.ts
      fx/ (echo.ts reverb.ts flanger.ts lofi.ts stutter.ts telephone.ts spinback.ts brake.ts riser.ts)
      worklets/ (capture.worklet.ts onset.worklet.ts meter.worklet.ts)
      transitions/ (smoothFade.ts bassSwap.ts echoOut.ts filterFade.ts ... index.ts)
      pads/ (synthHorn.ts synthSiren.ts synthClap.ts synthLaser.ts grab.ts)
    analysis/ (bpm.ts beats.ts key.ts camelot.ts outro.ts titleClean.ts)
    ml/ (stems.worker.ts demucs.ts stft.ts modelCache.ts benchmark.ts)
    shared/ (messages.ts types.ts constants.ts)
    ui/ (components/*, store.ts, theme.ts, shortcuts.ts)
  tests/
    unit/ (isolator.test.ts crossfader.test.ts automation.test.ts camelot.test.ts titleClean.test.ts)
    e2e/  (harness.spec.ts youtube.smoke.spec.ts)
    fixtures/ (generated; see §10.4)
  reference/   # cloned repos, gitignored
```

### 10.2 Coding rules
- TypeScript strict; no `any` in the audio or ML modules.
- Every audio param change uses AudioContext-time scheduling with a ramp of ≥ 5 ms (no clicks).
- Audio nodes are created once per deck and re-used; FX are bypassed with wet = 0 rather than disconnected and reconnected.
- Heavy work (model, key detection) runs only in Workers or Worklets. The main thread stays < 8 ms per frame.

### 10.3 Dev Harness (critical for autonomous building)
A page `harness.html` that runs the **exact same engine** but feeds decks from local audio files through `<audio>` → `createMediaElementSource` instead of tab capture. This lets Claude Code build and test the entire audio feature set **without YouTube**, and lets Playwright verify it headlessly. The deck source is behind an interface:
```ts
interface DeckSource { node: AudioNode; play(); pause(); seek(t); setRate(r); meta: TrackMeta; state$: Observable<VideoState> }
// Implementations: TabCaptureSource (YouTube), MediaElementSource (harness / fallback)
```

### 10.4 Generated test fixtures (`scripts/make-fixtures.ts`, using OfflineAudioContext or Node)
| Fixture | Content | Used to test |
|---|---|---|
| `click120.wav` / `click128.wav` | 60 s click track at exactly 120 / 128 BPM | BPM detection (±1 BPM), sync, beat alignment (±20 ms) |
| `bass_hi.wav` | 60 Hz sine + 5 kHz sine, equal level | Isolator kills (each band ≥ 30 dB attenuation when killed) |
| `centre_side.wav` | 1 kHz tone panned centre + 3 kHz tone panned hard left | VocalCut (centre ≥ 20 dB down, side retained) |
| `a_minor_chords.wav` | Synthesized Am–F–C–G pads | Key detection = 8A |
| `song_like_a.wav`, `song_like_b.wav` | Drums + bass + pad + "vocal" sine-sweep at 124 / 122 BPM | Transitions, auto-level, E2E flows |

---

## 11. Reference repos and libraries to study
Clone into `/reference`, read, and adapt patterns. Check each licence before copying code.

| Need | Repo / package | Licence | What to take |
|---|---|---|---|
| Tab capture in MV3 | Chrome docs "Audio recording and screen capture" + `GoogleChrome/chrome-extensions-samples` (tabcapture / offscreen samples) | Apache-2.0 | `getMediaStreamId` + `getUserMedia` flow; keeping audio audible after capture |
| Stem separation in the browser | `bakkot/demucs-js`, `timcsy/demucs-web` (npm `demucs-web`), `StemSplit/demucs-onnx` (browser demo), HF `monteslu/htdemucs-web-onnx`, HF `Ghilda/htdemucs-onnx` | MIT (check each) | STFT/iSTFT in JS, segmenting/overlap-add, ORT WebGPU session setup |
| Stem separation (Rust/WebGPU alternative) | `nikhilunni/demucs-rs` | check | Only if the ONNX route fails |
| Original model | `facebookresearch/demucs` | MIT | Segment/overlap defaults; reference outputs for testing |
| BPM (real-time) | `dlepaux/realtime-bpm-analyzer` | MIT | AudioWorklet BPM processor |
| BPM + beat offset (from buffers) | `chrisguttandin/web-audio-beat-detector` | MIT | `guess()` on ring-buffer snapshots for beat offset |
| Key detection | `dogayuksel/webkeyfinder` (libKeyFinder WASM); `MTG/essentia.js` | GPL / AGPL-3.0 | Streaming key estimation in a worker |
| Pitch shift / time-stretch | `cutterbl/SoundTouchJS` → `@soundtouchjs/audio-worklet`; `olvb/phaze` (phase vocoder) | LGPL-2.1 / check | Pitch-only shifting worklet for Key match |
| Browser EQ patterns | Peaks (Firefox add-on, `github.com/dip-chakraborty`), eq8 | check / MIT | Wrapping media elements (fallback mode) |
| Hand gestures (P2) | `google-ai-edge/mediapipe` (Hands / Gesture Recognizer, web) | Apache-2.0 | Landmark → control mapping |
| Extension framework | `wxt-dev/wxt` | MIT | Project scaffolding, MAIN-world content scripts |

---

## 12. Build order (milestones)

| M | Name | Contents | Exit criteria |
|---|---|---|---|
| **M0** | **Spike: capture** | Minimal MV3 extension: a popup button mints a stream ID for the current YouTube tab with `consumerTabId = mixerTab`; the Mixer plays it via `getUserMedia` → AudioContext. Then capture **two tabs at once** and play both. Test the keyboard command as invocation. | Two YouTube tabs audible *only* through the Mixer, with independent gains. **Fallback:** if two simultaneous captures fail, or the command/popup can't mint the ID, switch to the in-page architecture (§4.1) and log it in `DECISIONS.md`. |
| M1 | Skeleton | WXT project, entrypoints, message protocol, tab registry, deck badge, Mixer layout with empty decks, Dev Harness with `MediaElementSource` | Load a tab onto A/B; meta and timer show; play/pause/seek from the Mixer control the YouTube video. |
| M2 | Core mixing (P0) | Deck chain, Isolator3, VocalCut, filter knob, crossfader (3 curves), channel faders, master limiter, auto level match, ad guard, keyboard shortcuts | Unit tests for the isolator/crossfader pass; manual: kill bass on a live YouTube track with no clicks. |
| M3 | Tempo + transitions (P0) | BPM detection, Tap, Sync (tempo), automation engine, Smooth Fade / Bass Swap / Echo Out, FX pads Echo/Reverb/Sweep, Record | Harness E2E: 128→120 BPM fixtures sync within ±0.5 BPM; all 3 presets run 20× with no clipping (master peak ≤ −0.5 dBFS) and correct timings. |
| M4 | Buffers + v1 polish | Ring buffer, loops, hot cues, stutter, grab pads, synth pads, waveforms, meters, beat alignment, nudge, remaining transition presets, session save | Loop 4 beats on click120: seam error < 2 ms; beat alignment holds ±20 ms for 2 min. |
| M5 | AI Stems | Model download/cache, benchmark both exports, StemWorker, live-delayed pipeline with adaptive D, stem pills, Vocal Handoff, Mashup | On a WebGPU machine: warm-up ≤ 15 s; stems toggle without clicks; logged R and D; a graceful Quick-mode fallback when R < 1.4. |
| M6 | Analysis + Auto-DJ | Key detection + Camelot + Key match, outro detection, Auto-DJ queue, cached analysis per videoId, title cleaner | Key test fixture = 8A; Auto-DJ plays 3 queued harness tracks back to back with transitions and no user input. |
| M7 | P2 (optional) | Decks C/D, Web MIDI learn, Air Control (MediaPipe), Mashup Hold, manual pitch | Each behind a settings toggle, off by default. |

---

## 13. Acceptance tests (summary)
1. **Load:** pressing `Alt+Shift+1` on a YouTube tab moves its audio to Deck A within 1 s; the tab shows the "On Deck A" badge.
2. **Switches:** toggling Bass/Treble attenuates the corresponding band of `bass_hi.wav` by ≥ 30 dB within 50 ms; re-enabling restores it within ±0.5 dB.
3. **Vocal cut:** the centre tone of `centre_side.wav` drops ≥ 20 dB; the side tone stays within ±1 dB.
4. **Sync:** Deck B at 120 BPM synced to Deck A at 128 BPM → effective BPM 128 ± 0.5.
5. **Transitions:** each P0 preset at 8 beats / 120 BPM runs 4.0 s ± 10 ms, with master peak ≤ −0.5 dBFS and no discontinuities > −40 dBFS in the difference signal.
6. **Record:** a 30 s mix records and downloads as a playable `.webm` with a duration of 30 ± 0.5 s.
7. **Ad guard:** simulating `.ad-showing` mutes the deck within 300 ms.
8. **AI Stems (WebGPU):** warm-up ≤ 15 s; muting Vocals on a real song is clearly audible; 10 minutes of continuous playback without underruns.
9. **Endurance:** a 60-minute Auto-DJ session on the harness with heap growth < 300 MB.

---

## 14. Risks and mitigations
| Risk | Likelihood | Mitigation |
|---|---|---|
| Two simultaneous tab captures blocked or flaky | Medium | Spike 0 first; in-page fallback architecture is fully specified. |
| AI Stems too slow on a weak GPU | High on low-end laptops | WebGPU-only; benchmark-driven model choice; adaptive delay; Quick mode is always available and first-class. |
| Live stems are inherently delayed by ~11–14 s | Certain | UX framing: prepare stems on the cued deck; countdown; "video is ahead" chip. |
| YouTube DOM changes break metadata/ad detection | Medium | Isolate selectors in `youtube-main.content.ts` with multiple fallbacks; audio keeps working even if metadata fails. |
| Copyleft licences (essentia.js AGPL, libKeyFinder GPL, SoundTouch LGPL) | Only matters if published | Fine for personal use; `LICENSES.md` lists every dependency; swap them out before any public release. |
| Model weights size (~166 MB fp32) | Medium | Prefer the mixed-precision export; download once; cache locally. |
| Chrome Web Store policy on YouTube-related audio tools | If ever published | Out of scope for v1 (unpacked personal use). |

---

## Appendix A — `CLAUDE.md` (create at the repo root)
```md
# AirDeck — rules for Claude Code
- Source of truth: PRD.md. Log every deviation in DECISIONS.md with a date and the reason.
- Never schedule audio params with timers; use AudioContext time + ramps (≥5 ms).
- All audio features must work in the Dev Harness (harness.html) with fixtures; test there first.
- Keep YouTube-specific code ONLY in src/entrypoints/youtube*.ts.
- Heavy compute = Worker/Worklet only. Main thread < 8 ms/frame.
- Run `pnpm test` (Vitest) + `pnpm e2e` (Playwright, harness) before each commit.
- No network calls except the one-time model download in src/ml/modelCache.ts.
- UI copy: plain language, no jargon (say "Bass off", not "LF kill").
```

## Appendix B — Glossary (for the UI copywriter)
| Term in code | Term in UI |
|---|---|
| Isolator low/high band kill | "Bass off" / "Treble off" |
| Stem mute | "Vocals off", "Drums off", "Melody off" |
| Solo | "Only drums" (etc.) |
| Crossfader | "Mix slider" (tooltip); label A ↔ B |
| Transition preset | "Mix style" |
| Beatmatch / sync | "Sync" (tooltip: "match the speed of the other song") |
| Harmonic mixing | "Key match" (tooltip: "make the songs sound good together") |
