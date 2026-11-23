// Spike 0 (PRD §12 M0): capture TWO tabs at once with chrome.tabCapture and
// play both through the Mixer's single AudioContext with independent gains.
//
// Real use needs a user click on the extension (the "invocation" rule). For
// automation Chromium offers --allowlisted-extension-id, which lifts that rule
// for one extension, so this test exercises the real capture path end to end.
import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Unpacked extension IDs are derived from the folder path.
const extensionId = [...crypto.createHash('sha256').update(root).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join('');

// Headless Chromium captures silence, so this runs headed and only on request:
//   npm run e2e:capture            (macOS / Windows / Linux desktop)
//   xvfb-run -a npm run e2e:capture (Linux without a display)
test.skip(!process.env.AIRDECK_CAPTURE, 'Set AIRDECK_CAPTURE=1 (npm run e2e:capture) to run the real tab-capture test.');

test('two tabs captured at once, both audible only through the Mixer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airdeck-cap-'));
  const context = await chromium.launchPersistentContext(dir, {
    channel: 'chromium',
    headless: false,
    args: [
      `--disable-extensions-except=${root}`,
      `--load-extension=${root}`,
      `--allowlisted-extension-id=${extensionId}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    expect(sw.url()).toContain(extensionId);

    const tabA = await context.newPage();
    await tabA.goto('http://127.0.0.1:4173/tests/e2e/tone.html?f=440');
    const tabB = await context.newPage();
    await tabB.goto('http://127.0.0.1:4173/tests/e2e/tone.html?f=660');
    const mixer = await context.newPage();
    await mixer.goto(`chrome-extension://${extensionId}/src/mixer/mixer.html`);
    await mixer.waitForFunction(() => window.airdeck?.engine?.workletReady);
    await mixer.evaluate(() => window.airdeck.engine.resume());

    // Mint stream IDs in the service worker, exactly as background.js does.
    const result = await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const mixerTab = tabs.find((t) => t.url.includes('/src/mixer/mixer.html'));
      const a = tabs.find((t) => t.url.includes('f=440'));
      const b = tabs.find((t) => t.url.includes('f=660'));
      const out = [];
      for (const [deckId, tab] of [['A', a], ['B', b]]) {
        try {
          const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id, consumerTabId: mixerTab.id });
          await chrome.runtime.sendMessage({ type: 'DECK_ASSIGN', deckId, tabId: tab.id, streamId });
          out.push({ deckId, ok: true });
        } catch (e) {
          out.push({ deckId, ok: false, error: String(e && e.message ? e.message : e) });
        }
      }
      return out;
    });
    expect(result).toEqual([{ deckId: 'A', ok: true }, { deckId: 'B', ok: true }]);

    await mixer.waitForFunction(() => {
      const d = window.airdeck.engine.decks;
      return d.A.ring.filled > 22050 && d.B.ring.filled > 22050;
    }, null, { timeout: 15_000 }).catch(() => {});

    // Each deck carries its own tab's tone, with independent gains.
    const levels = await mixer.evaluate(async () => {
      const { engine } = window.airdeck;
      const tone = (deck, freq) => {
        const [l] = deck.ring.last(engine.ctx.sampleRate / 2);
        const k = (2 * Math.PI * freq) / engine.ctx.sampleRate;
        let s1 = 0, s2 = 0;
        for (const x of l) { const s = x + 2 * Math.cos(k) * s1 - s2; s2 = s1; s1 = s; }
        return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - 2 * Math.cos(k) * s1 * s2)) / (l.length / 2);
      };
      // Ring only records while "playing"; tone tabs have no content script, so mark them playing.
      for (const d of Object.values(engine.decks)) d.state.video.paused = false;
      await new Promise((r) => setTimeout(r, 800));
      const r = {
        a440: tone(engine.decks.A, 440),
        a660: tone(engine.decks.A, 660),
        b660: tone(engine.decks.B, 660),
        b440: tone(engine.decks.B, 440),
        kinds: [engine.decks.A.source?.kind, engine.decks.B.source?.kind],
      };
      return r;
    });
    expect(levels.kinds).toEqual(['tab', 'tab']);
    expect(levels.a440).toBeGreaterThan(0.05);
    expect(levels.b660).toBeGreaterThan(0.05);
    expect(levels.a660).toBeLessThan(levels.a440 / 20);
    expect(levels.b440).toBeLessThan(levels.b660 / 20);
  } finally {
    await context.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
