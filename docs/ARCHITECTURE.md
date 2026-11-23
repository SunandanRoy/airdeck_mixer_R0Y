# How AirDeck works

AirDeck has three parts that talk to each other. Chrome hands the sound of each YouTube tab to one **Mixer** tab, and that tab does all the audio work in a single `AudioContext`.

```
 YouTube tab A ──(tab audio)────────┐
   └ content script ◄──port──┐      │        MIXER TAB  (src/mixer/mixer.html)
 YouTube tab B ──(tab audio)─┼──────┼──►  AudioEngine (one AudioContext)
   └ content script ◄──port──┤      │       ├ Deck A ─┐
                             │      │       ├ Deck B ─┼─► master ─► limiter ─► clipper ─► speakers
 Service worker (MV3)        │      │       ├ pads  ──┤                                └─► recorder
   ├ Alt+Shift+1/2, popup    │      │       ├ riser ──┘
   ├ mints stream IDs ───────┼──────┘       ├ AutomationEngine (mix styles)
   └ deck ↔ tab registry     └────────────  └ UI (src/ui/*)
```

| Part | File(s) | Does | Never |
|---|---|---|---|
| Service worker | `src/background.js` | Handles shortcuts and the popup, mints `tabCapture` stream IDs for the Mixer tab, keeps the deck ↔ tab registry in `chrome.storage.session`, and stops deck tabs from being discarded | Holds audio. Chrome may stop it at any time. |
| Content script | `src/content/youtube.js` | Plays, pauses, seeks and sets the speed of the `<video>`, reports its state every 250 ms, reads the title and channel, detects ads, turns off autoplay-next and shows the "On Deck" badge | Touches audio |
| Mixer page | `src/ui/app.js` + `src/audio/*` | All audio, analysis and UI, plus recording | Relies on the service worker staying alive |

## Loading a deck

1. On a YouTube tab, the user presses <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>1</kbd> or clicks **Send to Deck A** in the popup. Either one counts as invoking the extension on that tab, which `tabCapture` requires.
2. The service worker checks the tab, injects the content script if needed, and opens the Mixer if it isn't open yet. A new Mixer reports `MIXER_READY`.
3. The service worker calls `tabCapture.getMediaStreamId({targetTabId, consumerTabId: mixerTabId})` and sends `DECK_ASSIGN {deckId, tabId, streamId}`.
4. The Mixer calls `getUserMedia({audio: {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId}}})`. The tab goes quiet, and its sound now comes only from the Mixer.
5. The Mixer sends `DECK_ATTACH` to the tab. The content script opens a port and starts streaming `VIDEO_STATE` and `TRACK_META`, and the Mixer sends `VIDEO_CMD` back.

The full message list is in `src/shared/messages.js`.

## One deck

```
source ─► life ─► trim (auto level) ─┬─► capture worklet ─► ring buffer (60 s), onsets → BPM / beat phase / key
                                     └─► ad mute ─► gate ─► pre ◄── loop / stutter players
pre ─► normal │ vocal cut ─► isolator (LR8 @ 250 Hz, 2.5 kHz) ─► filter knob
    ─► Phone ─► Lo-Fi ─► Sweep ─► Flanger ─► Echo ─► Reverb ─► time machine (delay)
    ─► fader ─► crossfader gain (= curve(position) + override) ─► master
```

- **Every node is built once.** Switches and FX change gains with ramps of 5 ms or more (`smoothSet`), so nothing is ever reconnected and nothing clicks.
- **Sound switches** set the isolator band gains. Vocals off cross-fades to the vocal-cut path.
- **Tempo** uses YouTube's own `playbackRate` with pitch preserved, so changing it costs no DSP.
- **Loops** play the last N beats from the ring buffer on a looping `AudioBufferSourceNode`, with a 5 ms seam crossfade. The video pauses underneath and resumes from the same spot.

## Mix styles

A mix style is a pure function that takes `{from, to, lengthBeats, bpm, now, xfade}` and returns a **Plan**: AudioParam events on the audio clock plus a few timed actions (play Y, pause X, reset X). See `src/audio/transitions/`. `AutomationEngine` (`src/audio/automation.js`) turns those events into `setValueAtTime`, `linearRampToValueAtTime`, `exponentialRampToValueAtTime` and `setValueCurveAtTime` calls. **Cancel** holds every touched param and ramps it back over 1 s.

Because plans are plain data, they are unit-tested without audio (`tests/unit/transitions.test.js`) and rendered offline in Chromium (`tests/e2e/dsp.spec.js`).

## Deck sources

The engine only knows the `DeckSource` interface (`src/sources/sources.js`):

- `TabCaptureSource` is a captured YouTube tab, controlled over the content-script port.
- `MediaElementSource` is an `<audio>` element playing a generated demo track or a local file. The Demo page and the tests use it.

Anything YouTube-specific stays in `src/content/youtube.js`, so supporting another site means writing another content script and nothing else.

## Storage

`chrome.storage.local` (`src/ui/storage.js`, `schemaVersion: 1`) holds:

- `settings`
- `cuesByVideoId` (hot cues per song)
- `analysisByVideoId` (tempo and key per song, so they appear instantly next time)
