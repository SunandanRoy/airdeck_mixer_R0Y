import { describe, it, expect } from 'vitest';
import { crossfaderGains, crossfaderShaperCurve, filterKnobToCutoffs, safetyClipperCurve, butterworthQs } from '../../src/audio/curves.js';

describe('crossfader', () => {
  it('equal-power: constant power across the throw', () => {
    for (let x = 0; x <= 1; x += 0.05) {
      const { a, b } = crossfaderGains(x, 'smooth');
      expect(a * a + b * b).toBeCloseTo(1, 6);
    }
    const mid = crossfaderGains(0.5, 'smooth');
    expect(mid.a).toBeCloseTo(0.7071, 4);
    expect(mid.b).toBeCloseTo(0.7071, 4);
  });
  it('ends are fully one deck', () => {
    for (const c of ['smooth', 'sharp', 'linear']) {
      expect(crossfaderGains(0, c).a).toBeCloseTo(1);
      expect(crossfaderGains(0, c).b).toBeCloseTo(0);
      expect(crossfaderGains(1, c).a).toBeCloseTo(0);
      expect(crossfaderGains(1, c).b).toBeCloseTo(1);
    }
  });
  it('sharp: both full in the middle', () => {
    expect(crossfaderGains(0.5, 'sharp')).toEqual({ a: 1, b: 1 });
    expect(crossfaderGains(0.94, 'sharp').a).toBe(1);
  });
  it('linear', () => {
    expect(crossfaderGains(0.25, 'linear')).toEqual({ a: 0.75, b: 0.25 });
  });
  it('shaper curve maps [0,1] and clamps negatives', () => {
    const c = crossfaderShaperCurve('a', 'smooth', 4097);
    expect(c[0]).toBeCloseTo(1); // input -1 clamps to 0
    expect(c[2048]).toBeCloseTo(1); // input 0
    expect(c[4096]).toBeCloseTo(0, 6); // input 1
    expect(c[3072]).toBeCloseTo(Math.cos(Math.PI / 4), 4); // input 0.5
  });
});

describe('filter knob', () => {
  it('dead zone bypasses', () => {
    expect(filterKnobToCutoffs(0.02).active).toBe(false);
    expect(filterKnobToCutoffs(-0.02).active).toBe(false);
  });
  it('ends of the throw', () => {
    expect(filterKnobToCutoffs(-1).lp).toBeCloseTo(19.53, 1);
    expect(filterKnobToCutoffs(1, 22050).hp).toBe(20480);
  });
  it('monotonic sweeps', () => {
    expect(filterKnobToCutoffs(-0.5).lp).toBeLessThan(filterKnobToCutoffs(-0.2).lp);
    expect(filterKnobToCutoffs(0.5).hp).toBeGreaterThan(filterKnobToCutoffs(0.2).hp);
  });
});

describe('safety clipper', () => {
  it('never exceeds the ceiling and is transparent below the knee', () => {
    const c = safetyClipperCurve(0.944, 0.85, 8193);
    expect(Math.max(...c)).toBeLessThanOrEqual(0.944);
    const i = Math.round(((0.5 + 1) / 2) * 8192);
    expect(c[i]).toBeCloseTo(0.5, 3);
  });
});

describe('butterworth', () => {
  it('Qs for orders 2 and 4', () => {
    expect(butterworthQs(2)[0]).toBeCloseTo(0.7071, 4);
    const q4 = butterworthQs(4);
    expect(q4[0]).toBeCloseTo(0.5412, 3);
    expect(q4[1]).toBeCloseTo(1.3066, 3);
  });
});
