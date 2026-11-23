# Testing

```bash
npm install
```

```bash
npm run check
```

`npm run check` runs typecheck, lint, unit and end-to-end tests. The headed tab-capture test runs separately:

```bash
npm run e2e:capture
```

On Linux without a display:

```bash
xvfb-run -a npm run e2e:capture
```

## Automated

| PRD §13 | Test | File |
|---|---|---|
| 2. Switches: band kill ≥ 30 dB, bands sum flat ±0.5 dB | Offline render of the isolator | `tests/e2e/dsp.spec.js` |
| 3. Vocal cut: centre ≥ 20 dB down, side ±1 dB | Offline render of `centre_side` | `tests/e2e/dsp.spec.js` |
| 4. Sync: 120 → 128 BPM ± 0.5 | Real-time on the Demo page | `tests/e2e/harness.spec.js` |
| 5. Transitions: 4.0 s, peak ≤ −0.5 dBFS, no clicks | Offline render with the full engine, for each P0 preset | `tests/e2e/dsp.spec.js` |
| 6. Record: playable WebM of the right length | 5 s recording, decoded | `tests/e2e/harness.spec.js` |
| 7. Ad guard mutes within 300 ms | Simulated ad on the Demo page | `tests/e2e/harness.spec.js` |
| M0. Two tabs captured at once | Real `tabCapture` in Chromium (headed) | `tests/e2e/capture.spec.js` |
| Bass Swap timing at t0 + 2.0 s ± 1 ms; all presets well-formed | Plans as data | `tests/unit/transitions.test.js` |
| BPM ±0.5 on click tracks; tap; sync rate; beat phase | Pure analysis | `tests/unit/bpm.test.js` |
| Key fixture = 8A; Camelot wheel; key-match shift | Pure analysis | `tests/unit/camelot.test.js` |
| Title cleaner on 30 titles | Pure | `tests/unit/titleClean.test.js` |
| Loop 4 beats: seam error < 2 ms | Real-time on the Demo page | `tests/e2e/harness.spec.js` |
| Extension pages boot with no errors; CSP allows the worklet and worker | Unpacked extension in Chromium | `tests/e2e/extension.spec.js` |

## Manual YouTube checklist

YouTube can't be automated reliably (sign-in, ads, consent screens), so run this list by hand before a release.

1. Load the unpacked extension. The welcome page opens.
2. Open a YouTube video and press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>1</kbd>. Check that:
   - the Mixer opens and Deck A shows the thumbnail, title and channel within about 1 s;
   - the tab shows "On Deck A";
   - the tab itself is silent.
3. Press play/pause and move the seek bar in the Mixer. The YouTube video follows.
4. Send a second video to Deck B with the popup button.
5. Send the first tab to Deck B. AirDeck refuses with "This tab is already on Deck A".
6. Tap Bass on a playing deck. The bass drops instantly with no click.
7. Wait for the BPM, press Sync on Deck B, then press Mix (Bass Swap, 8 beats).
8. Navigate the Deck A tab to another video. The title updates, the BPM resets, and the audio keeps flowing.
9. Wait for an ad, or open a video with a pre-roll. The deck shows "Ad playing" and is muted.
10. Eject Deck A. The tab plays out loud again at normal speed.
11. Close the Mixer. Both tabs play normally again, and the badges disappear.
12. Record 30 s, stop, and play the downloaded file.
