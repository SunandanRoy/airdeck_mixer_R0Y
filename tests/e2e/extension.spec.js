// Loads the unpacked extension into Chromium and checks every page boots.
// (Capturing a real YouTube tab needs a user click, so that part is manual:
// see docs/TESTING.md.)
import { test as base, expect, chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const test = base.extend({
  context: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airdeck-'));
    const context = await chromium.launchPersistentContext(dir, {
      channel: 'chromium',
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--autoplay-policy=no-user-gesture-required'],
    });
    await use(context);
    await context.close();
    fs.rmSync(dir, { recursive: true, force: true });
  },
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw.url().split('/')[2]);
  },
});

/** @param {import('@playwright/test').Page} page */
function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

test('service worker starts and the welcome page opens on install', async ({ context, extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
  await expect.poll(() => context.pages().some((p) => p.url().includes('/src/welcome/welcome.html'))).toBe(true);
});

test('Mixer page boots inside the extension', async ({ context, extensionId }) => {
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.goto(`chrome-extension://${extensionId}/src/mixer/mixer.html`);
  await expect(page.locator('.deck-a .deck-empty')).toContainText('Alt+Shift+1');
  await expect(page.locator('.deck-b .deck-empty')).toContainText('Alt+Shift+2');
  await expect(page.locator('.mix-btn')).toBeVisible();
  // Settings and help dialogs open.
  await page.locator('.start-overlay').evaluate((el) => el.classList.add('hidden'));
  await page.getByRole('button', { name: 'Help' }).click();
  await expect(page.getByRole('heading', { name: 'How to use AirDeck' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('popup explains what to do on a non-YouTube tab', async ({ context, extensionId }) => {
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await expect(page.locator('#send-a')).toBeDisabled();
  await expect(page.locator('#track')).toContainText('Open a YouTube video');
  expect(errors).toEqual([]);
});

test('Demo page works inside the extension (worklet, worker, CSP)', async ({ context, extensionId }) => {
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.goto(`chrome-extension://${extensionId}/src/demo/demo.html`);
  await page.waitForFunction(() => window.airdeck?.engine?.workletReady === true);
  await page.evaluate(() => {
    const { engine } = window.airdeck;
    engine.resume();
    engine.decks.A.play();
  });
  await page.waitForFunction(() => window.airdeck.engine.decks.A.ring.filled > 44100, null, { timeout: 10_000 });
  // Key detection runs in a module Worker; make sure the CSP allows it.
  const key = await page.evaluate(async () => {
    const { aMinorChords } = await import('../harness/fixtures.js');
    const f = aMinorChords(16, 11025);
    return window.airdeck.engine.detectKey(f.left, 11025);
  });
  expect(key).toEqual({ tonic: 9, mode: 'minor' });
  expect(errors).toEqual([]);
});
