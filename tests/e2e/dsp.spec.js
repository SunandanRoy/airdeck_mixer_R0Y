// Acceptance tests for the audio engine, rendered with OfflineAudioContext in
// real Chromium. They import the same modules the extension uses.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/e2e/blank.html');
});

test('isolator: bands sum flat (±0.5 dB) and kills attenuate ≥ 30 dB', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { Isolator } = await import('/src/audio/nodes.js');
    const sr = 44100;
    const tone = async (freq, bands) => {
      const ctx = new OfflineAudioContext(2, sr * 1, sr);
      const osc = new OscillatorNode(ctx, { frequency: freq });
      const iso = new Isolator(ctx);
      iso.low.gain.value = bands.low;
      iso.mid.gain.value = bands.mid;
      iso.high.gain.value = bands.high;
      osc.connect(iso.input);
      iso.output.connect(ctx.destination);
      osc.start();
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0).subarray(sr / 2);
      let ms = 0;
      for (const v of d) ms += v * v;
      return 10 * Math.log10(ms / d.length / 0.5); // dB relative to a unit sine
    };
    const flat = [];
    for (const f of [40, 100, 250, 600, 1500, 2500, 5000, 12000]) flat.push(await tone(f, { low: 1, mid: 1, high: 1 }));
    return {
      flat,
      bassKill60: await tone(60, { low: 0, mid: 1, high: 1 }),
      trebleKill5k: await tone(5000, { low: 1, mid: 1, high: 0 }),
      bassKeep5k: await tone(5000, { low: 0, mid: 1, high: 1 }),
    };
  });
  for (const db of r.flat) expect(Math.abs(db)).toBeLessThan(0.5);
  expect(r.bassKill60).toBeLessThan(-30);
  expect(r.trebleKill5k).toBeLessThan(-30);
  expect(Math.abs(r.bassKeep5k)).toBeLessThan(0.5);
});

test('vocal cut: centre tone ≥ 20 dB down, side tone within ±1 dB', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { VocalCut } = await import('/src/audio/nodes.js');
    const { centreSide } = await import('/src/harness/fixtures.js');
    const sr = 44100;
    const f = centreSide(2, sr);
    const ctx = new OfflineAudioContext(2, f.left.length, sr);
    const b = ctx.createBuffer(2, f.left.length, sr);
    b.copyToChannel(f.left, 0);
    b.copyToChannel(f.right, 1);
    const src = new AudioBufferSourceNode(ctx, { buffer: b });
    const vc = new VocalCut(ctx);
    src.connect(vc.input);
    vc.output.connect(ctx.destination);
    src.start();
    const out = await ctx.startRendering();
    // Goertzel magnitude of a frequency in the left channel
    const mag = (data, freq) => {
      const seg = data.subarray(sr / 2, sr / 2 + sr);
      const k = (2 * Math.PI * freq) / sr;
      let s1 = 0, s2 = 0;
      for (const x of seg) { const s = x + 2 * Math.cos(k) * s1 - s2; s2 = s1; s1 = s; }
      return Math.sqrt(s1 * s1 + s2 * s2 - 2 * Math.cos(k) * s1 * s2) / (seg.length / 2);
    };
    const inL = f.left;
    return {
      centre: 20 * Math.log10(mag(out.getChannelData(0), 1000) / mag(inL, 1000)),
      side: 20 * Math.log10(mag(out.getChannelData(0), 3000) / mag(inL, 3000)),
    };
  });
  expect(r.centre).toBeLessThan(-20);
  expect(Math.abs(r.side)).toBeLessThan(1);
});

for (const preset of ['smoothFade', 'bassSwap', 'echoOut']) {
  test(`transition ${preset}: 8 beats @ 120 BPM ends on B, no clipping, no clicks`, async ({ page }) => {
    const r = await page.evaluate(async (presetId) => {
      const { AudioEngine } = await import('/src/audio/engine.js');
      const sr = 44100;
      const seconds = 7;
      const ctx = new OfflineAudioContext(2, sr * seconds, sr);
      const engine = new AudioEngine({ ctx });
      await engine.init();
      engine.settings.autoLevel = false;
      engine.onPlanAction = () => {};
      const fake = (freq) => {
        const osc = new OscillatorNode(ctx, { frequency: freq });
        const g = new GainNode(ctx, { gain: 0.5 });
        osc.connect(g);
        osc.start();
        return { kind: 'file', node: g, state: {}, meta: {}, on() {}, play() {}, pause() {}, seek() {}, setRate() {}, setPitchLock() {}, setBadge() {}, dispose() {} };
      };
      engine.decks.A.attach(fake(440));
      engine.decks.B.attach(fake(660));
      engine.decks.A.state.bpm = { base: 120, effective: 120, stable: true, source: 'tap' };
      engine.xfPos.offset.value = 0;
      // Start the transition at t = 1 s.
      const { PRESETS_BY_ID } = await import('/src/audio/transitions/index.js');
      const plan = PRESETS_BY_ID[presetId].plan({ from: 'A', to: 'B', lengthBeats: 8, bpm: 120, now: 1, xfade: 0, nyquist: sr / 2 });
      engine.automation.run(plan);
      const out = await ctx.startRendering();
      const L = out.getChannelData(0);
      let peak = 0;
      let maxD2 = 0;
      for (let i = 2; i < L.length; i++) {
        peak = Math.max(peak, Math.abs(L[i]));
        if (i > sr * 0.2) maxD2 = Math.max(maxD2, Math.abs(L[i] - 2 * L[i - 1] + L[i - 2]));
      }
      const mag = (start, freq) => {
        const seg = L.subarray(Math.round(start * sr), Math.round((start + 0.1) * sr));
        const k = (2 * Math.PI * freq) / sr;
        let s1 = 0, s2 = 0;
        for (const x of seg) { const s = x + 2 * Math.cos(k) * s1 - s2; s2 = s1; s1 = s; }
        return Math.sqrt(s1 * s1 + s2 * s2 - 2 * Math.cos(k) * s1 * s2) / (seg.length / 2);
      };
      return {
        duration: plan.duration,
        peakDb: 20 * Math.log10(peak),
        maxD2Db: 20 * Math.log10(maxD2),
        aBefore: mag(0.5, 440), bBefore: mag(0.5, 660),
        aAfter: mag(5.5, 440), bAfter: mag(5.5, 660),
      };
    }, preset);
    expect(Math.abs(r.duration - 4)).toBeLessThan(0.01);
    expect(r.peakDb).toBeLessThanOrEqual(-0.5);
    expect(r.maxD2Db).toBeLessThan(-40);
    expect(r.aBefore).toBeGreaterThan(0.4);
    expect(r.bBefore).toBeLessThan(0.01);
    expect(r.aAfter).toBeLessThan(0.01);
    expect(r.bAfter).toBeGreaterThan(0.4);
  });
}
