import { describe, it, expect } from 'vitest';
import { PRESETS, bassSwap, smoothFade, echoOut, lengthSeconds } from '../../src/audio/transitions/index.js';

const ctx = (over = {}) => ({ from: 'A', to: 'B', lengthBeats: 8, bpm: 120, now: 10, xfade: 0, nyquist: 22050, ...over });
const at = (plan, target, type) => plan.events.filter((e) => e.target === target && (!type || e.type === type));

describe('transition presets', () => {
  it('8 beats at 120 BPM = 4.0 s', () => {
    expect(lengthSeconds(ctx())).toBe(4);
    expect(smoothFade(ctx()).duration).toBe(4);
  });
  it('falls back to seconds when BPM is unknown (8 beats ≈ 4 s)', () => {
    expect(lengthSeconds(ctx({ bpm: NaN }))).toBe(4);
  });
  it('Smooth Fade ramps the crossfader A -> B over L', () => {
    const p = smoothFade(ctx());
    const lin = at(p, 'xfade', 'linear');
    expect(lin).toHaveLength(1);
    expect(lin[0].value).toBe(1);
    expect(lin[0].time).toBeCloseTo(14, 9);
  });
  it('Bass Swap swaps basses at t0 + L/2 (±1 ms)', () => {
    const p = bassSwap(ctx());
    const xOff = at(p, 'A.low').filter((e) => e.type === 'set' && e.value === 1);
    const yOn = at(p, 'B.low').filter((e) => e.type === 'set' && e.value === 0 && e.time > 10.1);
    expect(Math.abs(xOff[0].time - 12)).toBeLessThan(0.001);
    expect(Math.abs(yOn[0].time - 12)).toBeLessThan(0.001);
    const xEnd = at(p, 'A.low', 'linear').pop();
    const yEnd = at(p, 'B.low', 'linear').pop();
    expect(xEnd.value).toBe(0);
    expect(yEnd.value).toBe(1);
    expect(xEnd.time - 12).toBeLessThanOrEqual(0.5); // within one beat
    // Y starts with its bass off
    expect(at(p, 'B.low')[0]).toMatchObject({ type: 'set', value: 1, time: 10 });
    expect(at(p, 'B.low', 'linear')[0]).toMatchObject({ value: 0 });
  });
  it('Echo Out: dry cut 2 beats before the end, Y in at the end', () => {
    const p = echoOut(ctx());
    const dry = at(p, 'A.echoDry', 'set')[0];
    expect(dry.time).toBeCloseTo(13, 9);
    expect(at(p, 'A.echoFeedback')[0].value).toBe(0.55);
    expect(at(p, 'A.echoTime')[0].value).toBe(0.25);
    const xf = at(p, 'xfade', 'linear').pop();
    expect(xf.value).toBe(1);
    expect(xf.time).toBeCloseTo(14.01, 6);
  });
  it('every preset produces a sorted, well-formed plan in both directions', () => {
    for (const preset of PRESETS) {
      for (const dir of [{ from: 'A', to: 'B', xfade: 0 }, { from: 'B', to: 'A', xfade: 1 }]) {
        const p = preset.plan(ctx(dir));
        expect(p.events.length).toBeGreaterThan(0);
        for (let i = 1; i < p.events.length; i++) expect(p.events[i].time).toBeGreaterThanOrEqual(p.events[i - 1].time);
        expect(p.actions.at(-1).type).toBe('done');
        expect(p.end).toBeGreaterThanOrEqual(p.t0 + p.duration - 1e-9);
        const finalXf = at(p, 'xfade').pop();
        expect(finalXf.value).toBe(dir.to === 'B' ? 1 : 0);
        expect(p.actions.some((a) => a.type === 'pause' && a.deck === dir.from)).toBe(true);
        for (const e of p.events) expect(Number.isFinite(e.time)).toBe(true);
      }
    }
  });
});
