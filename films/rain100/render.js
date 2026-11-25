#!/usr/bin/env node
/**
 * render.js — frame-accurate renderer for rain100.svg.
 *
 *   node render.js                       -> 1800 frames (30 fps x 60 s) -> rain100.mp4 (H.264, yuv420p, CRF 18)
 *   node render.js --stills 0.5,5,12     -> PNG stills in ./stills/ (for checking)
 *   node render.js --workers 4           -> parallel Chromium pages (default: CPU count, max 6)
 *   node render.js --keep-frames         -> keep ./frames/ after encoding
 *
 * Every CSS animation is paused and seeked via document.getAnimations() before each
 * screenshot, so output never depends on wall-clock speed.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// Resolve Playwright through CommonJS so a global install (NODE_PATH) or the repo's @playwright/test both work.
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('@playwright/test'); }
})();
const SVG = join(HERE, 'rain100.svg');
const FPS = 30;
const DURATION = 60;
const FRAMES = FPS * DURATION;

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const stills = opt('--stills');
const workers = Math.max(1, Math.min(6, Number(opt('--workers')) || cpus().length));
const keepFrames = args.includes('--keep-frames');

if (!existsSync(SVG)) {
  console.error('rain100.svg not found. Run `node build.js` first.');
  process.exit(1);
}

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(SVG).href, { waitUntil: 'load' });
  const n = await page.evaluate(() => {
    const all = document.getAnimations();
    all.forEach((a) => a.pause());
    return all.length;
  });
  return { page, n };
}

/** Seek every animation to t seconds and wait until Chromium has painted it. */
async function seek(page, t) {
  await page.evaluate(async (ms) => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = ms;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, t * 1000);
}

async function renderStills(times) {
  const dir = join(HERE, 'stills');
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const { page, n } = await openPage(browser);
  console.log(`${n} animations found`);
  for (const t of times) {
    await seek(page, t);
    const file = join(dir, `still_${String(t.toFixed(2)).padStart(5, '0')}s.png`);
    await page.screenshot({ path: file });
    console.log('wrote', file);
  }
  await browser.close();
}

async function renderVideo() {
  const dir = join(HERE, 'frames');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const started = Date.now();
  let done = 0;
  const chunk = Math.ceil(FRAMES / workers);
  await Promise.all(
    Array.from({ length: workers }, async (_, w) => {
      const browser = await chromium.launch(); // one browser per worker: screenshots don't serialise
      const { page, n } = await openPage(browser);
      if (w === 0) console.log(`${n} animations found, ${workers} workers`);
      for (let f = w * chunk; f < Math.min(FRAMES, (w + 1) * chunk); f++) {
        await seek(page, f / FPS);
        await page.screenshot({ path: join(dir, `f${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 95 });
        done++;
        if (done % 60 === 0) {
          const el = (Date.now() - started) / 1000;
          console.log(`${done}/${FRAMES} frames  ${el.toFixed(0)} s elapsed, ~${((el / done) * (FRAMES - done)).toFixed(0)} s left`);
        }
      }
      await browser.close();
    }),
  );

  const out = join(HERE, 'rain100.mp4');
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-framerate', String(FPS), '-i', join(dir, 'f%05d.jpg'),
    '-frames:v', String(FRAMES),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-r', String(FPS), '-movflags', '+faststart',
    out,
  ], { stdio: 'inherit' });
  const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', out]).toString().trim();
  const nb = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'default=nw=1:nk=1', out]).toString().trim();
  console.log(`wrote ${out}: ${(statSync(out).size / 1048576).toFixed(1)} MB, duration ${dur} s, ${nb} frames`);
  if (!keepFrames) rmSync(dir, { recursive: true, force: true });
}

if (stills) await renderStills(stills.split(',').map(Number));
else await renderVideo();
