// End-to-end tests on the Demo page (the Dev Harness): the exact engine and UI
// the extension uses, fed by generated tracks instead of YouTube tabs.
import { test, expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page */
async function open(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/src/demo/demo.html');
  await page.waitForFunction(() => window.airdeck?.engine);
  await page.evaluate(() => window.airdeck.engine.resume());
  return errors;
}

test('demo page loads two decks with no errors', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('.deck-a .track-title')).toHaveText(/Demo song A/);
  await expect(page.locator('.deck-b .track-title')).toHaveText(/Demo song B/);
  await expect(page.locator('.mix-btn')).toContainText('Mix to B');
  expect(errors).toEqual([]);
});

test('sound switches, keyboard and solo update deck state', async ({ page }) => {
  await open(page);
  await page.locator('.start-overlay').evaluate((el) => el.classList.add('hidden'));
  const bass = page.locator('.deck-a .pill').first();
  await bass.click();
  await expect(bass).toHaveClass(/off/);
  await page.keyboard.press('q');
  await expect(bass).not.toHaveClass(/off/);
  await page.keyboard.press('Shift+E');
  expect(await page.evaluate(() => window.airdeck.engine.decks.A.state.solo)).toBe('treble');
  await expect(page.locator('.deck-a .pill').nth(4)).toHaveClass(/solo/);
});

test('BPM detection, Sync and a 4-beat loop on click tracks', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  await page.evaluate(() => {
    const { engine, loadFixture } = window.airdeck;
    loadFixture('A', 'click128');
    loadFixture('B', 'click120');
    setTimeout(() => {
      engine.decks.A.play();
      engine.decks.B.play();
    }, 300);
  });
  await page.waitForFunction(() => {
    const d = window.airdeck.engine.decks;
    return d.A.state.bpm.stable && d.B.state.bpm.stable;
  }, null, { timeout: 60_000 });
  const bpm = await page.evaluate(() => {
    const d = window.airdeck.engine.decks;
    return { a: d.A.state.bpm.effective, b: d.B.state.bpm.effective };
  });
  expect(Math.abs(bpm.a - 128)).toBeLessThanOrEqual(1);
  expect(Math.abs(bpm.b - 120)).toBeLessThanOrEqual(1);

  // Sync B to A: effective BPM 128 ± 0.5
  const synced = await page.evaluate(() => {
    const d = window.airdeck.engine.decks;
    d.A.state.bpm.base = 128; // pin to the true tempo so the test checks Sync, not detection
    d.A.updateEffectiveBpm();
    d.B.state.bpm.base = 120;
    const err = d.B.syncTo(d.A);
    return { err, eff: d.B.state.bpm.effective, rate: d.B.source.audio.playbackRate };
  });
  expect(synced.err).toBeNull();
  expect(Math.abs(synced.eff - 128)).toBeLessThanOrEqual(0.5);
  expect(synced.rate).toBeCloseTo(128 / 120, 3);

  // Loop 4 beats: the loop is exactly 4 beats long (seam error < 2 ms).
  const loop = await page.evaluate(() => {
    const deck = window.airdeck.engine.decks.A;
    const err = deck.toggleLoop(4);
    const len = deck.loopPlayer ? deck.loopPlayer.buffer.duration : NaN;
    return { err, len, expected: (4 * 60) / deck.effectiveBpm, looping: deck.state.loop };
  });
  expect(loop.err).toBeNull();
  expect(loop.looping).toBe(4);
  expect(Math.abs(loop.len - loop.expected) * 1000).toBeLessThan(2);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.airdeck.engine.decks.A.source.audio.paused)).toBe(true);
  await page.evaluate(() => window.airdeck.engine.decks.A.toggleLoop(4));
  await page.waitForFunction(() => !window.airdeck.engine.decks.A.source.audio.paused);
});

test('ad guard mutes a deck within 300 ms', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.airdeck.engine.decks.A.play());
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => window.airdeck.engine.decks.A.level().rms);
  expect(before).toBeGreaterThan(0.01);
  const after = await page.evaluate(async () => {
    const deck = window.airdeck.engine.decks.A;
    deck.source.simulateAd(true);
    await new Promise((r) => setTimeout(r, 300));
    return deck.level().rms;
  });
  expect(after).toBeLessThan(before * 0.01);
  await expect(page.locator('.deck-a .chip.warn')).toBeVisible();
  await page.evaluate(() => window.airdeck.engine.decks.A.source.simulateAd(false));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.airdeck.engine.decks.A.level().rms)).toBeGreaterThan(0.01);
});

test('records the mix as a playable WebM of the right length', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { engine } = window.airdeck;
    engine.decks.A.play();
    engine.recorder.start('webm');
    await new Promise((res) => setTimeout(res, 5000));
    const blob = await engine.recorder.stop();
    const buf = await engine.ctx.decodeAudioData(await blob.arrayBuffer());
    let peak = 0;
    const d = buf.getChannelData(0);
    for (const v of d) peak = Math.max(peak, Math.abs(v));
    return { type: blob.type, duration: buf.duration, peak };
  });
  expect(r.type).toBe('audio/webm');
  expect(Math.abs(r.duration - 5)).toBeLessThan(0.5);
  expect(r.peak).toBeGreaterThan(0.05);
});

test('Mix button runs a full transition and lands on Deck B', async ({ page }) => {
  await open(page);
  await page.locator('.start-overlay').evaluate((el) => el.classList.add('hidden'));
  await page.evaluate(() => {
    const { engine } = window.airdeck;
    engine.decks.A.setBaseBpm(240, 'tap'); // 8 beats = 2 s keeps the test quick
    engine.decks.A.play();
  });
  await page.locator('.mix-style, select.select').first().selectOption('smoothFade');
  await page.locator('.mix-btn').click();
  await expect(page.locator('.mix-btn')).toHaveClass(/running/);
  await page.waitForFunction(() => window.airdeck.engine.transition === null, null, { timeout: 10_000 });
  const s = await page.evaluate(() => {
    const { engine } = window.airdeck;
    return { xf: engine.crossfader, bPlaying: !engine.decks.B.source.audio.paused, aPaused: engine.decks.A.source.audio.paused };
  });
  expect(s.xf).toBeCloseTo(1, 2);
  expect(s.bPlaying).toBe(true);
  expect(s.aPaused).toBe(true);
  await expect(page.locator('.mix-btn')).toContainText('Mix to A');
});
