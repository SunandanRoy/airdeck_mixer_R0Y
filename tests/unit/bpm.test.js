import { describe, it, expect } from 'vitest';
import { onsetEnvelope, estimateBpm, foldBpm, bpmFromTaps, syncRate, BpmTracker, estimateBeatPhase } from '../../src/analysis/bpm.js';
import { clickTrack, songLike } from '../../src/harness/fixtures.js';

const SR = 44100;
const FR = SR / 128;
const mono = (f) => {
  const out = new Float32Array(f.left.length);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (f.left[i] + f.right[i]);
  return out;
};

describe('BPM detection', () => {
  for (const bpm of [120, 128]) {
    it(`click${bpm} within ±0.5 BPM`, () => {
      const env = onsetEnvelope(mono(clickTrack(bpm, 12)), 128);
      const r = estimateBpm(env, FR);
      expect(Math.abs(r.bpm - bpm)).toBeLessThanOrEqual(0.5);
    });
  }
  it('song-like fixtures', () => {
    for (const [w, bpm] of [['a', 124], ['b', 122]]) {
      const env = onsetEnvelope(mono(songLike(w, 12)), 128);
      expect(Math.abs(estimateBpm(env, FR).bpm - bpm)).toBeLessThanOrEqual(1);
    }
  });
  it('tracker reports stable after ~8 s', () => {
    const env = onsetEnvelope(mono(clickTrack(120, 20)), 128);
    const t = new BpmTracker(FR);
    let res = { bpm: NaN, stable: false };
    const perSec = Math.round(FR);
    let sec = 0;
    for (let i = 0; i < env.length; i += perSec) {
      t.push(env.subarray(i, i + perSec));
      sec++;
      if (sec >= 4) res = t.update(sec);
      if (res.stable) break;
    }
    expect(res.stable).toBe(true);
    expect(Math.abs(res.bpm - 120)).toBeLessThanOrEqual(0.5);
    expect(sec).toBeLessThanOrEqual(14);
  });
  it('beat phase finds the click grid', () => {
    // 10.2 s of clicks at 120 BPM: last beat at 10.0 s -> phase ≈ 0.2 s
    const env = onsetEnvelope(mono(clickTrack(120, 10.2)), 128);
    const ph = estimateBeatPhase(env, FR, 120);
    expect(Math.abs(ph - 0.2)).toBeLessThan(0.02);
  });
  it('fold', () => {
    expect(foldBpm(60)).toBe(120);
    expect(foldBpm(250)).toBe(125);
    expect(foldBpm(100)).toBe(100);
  });
  it('tap tempo', () => {
    expect(bpmFromTaps([0, 0.5, 1, 1.5])).toBe(120);
    expect(bpmFromTaps([0, 0.5])).toBeNaN();
  });
  it('sync rate', () => {
    expect(syncRate(128, 120)).toBeCloseTo(128 / 120, 6);
    expect(syncRate(140, 72)).toBeCloseTo(70 / 72, 6); // half-time
    expect(syncRate(170, 100)).toBeCloseTo(0.85, 6); // half-time
    expect(syncRate(160, 100)).toBeNull();
  });
});
