import { describe, it, expect } from 'vitest';
import { encodeWav, decodeWav } from '../../src/shared/wav.js';
import { RingBuffer, makeSeamless } from '../../src/audio/ringbuffer.js';
import { airHorn, siren, clap, laser } from '../../src/audio/pads/synth.js';
import { isYouTubeUrl } from '../../src/shared/messages.js';

describe('wav', () => {
  it('round-trips', () => {
    const l = Float32Array.from({ length: 100 }, (_, i) => Math.sin(i / 5) * 0.5);
    const r = l.map((x) => -x);
    const { sampleRate, channels } = decodeWav(encodeWav([l, r], 48000));
    expect(sampleRate).toBe(48000);
    expect(channels[0][10]).toBeCloseTo(l[10], 3);
    expect(channels[1][10]).toBeCloseTo(r[10], 3);
  });
});

describe('ring buffer', () => {
  it('returns the most recent frames in order and wraps', () => {
    const rb = new RingBuffer(10, 1); // 10 frames
    const a = Float32Array.from({ length: 7 }, (_, i) => i);
    rb.push(a, a);
    rb.push(Float32Array.from([7, 8, 9, 10, 11]), Float32Array.from([7, 8, 9, 10, 11]));
    const [l] = rb.last(4);
    expect([...l]).toEqual([8, 9, 10, 11]);
    expect(rb.filled).toBe(10);
    expect(rb.last(50)[0].length).toBe(10);
  });
  it('seamless loop has the exact loop length and a continuous seam', () => {
    const n = 1000;
    const f = 20;
    const ramp = Float32Array.from({ length: n + f }, (_, i) => i);
    const [l] = makeSeamless(ramp, ramp, f);
    expect(l.length).toBe(n);
    // last sample flows into first: l[n-1] ≈ ramp[f-1], l[0] = ramp[f]
    expect(Math.abs(l[0] - l[n - 1])).toBeLessThanOrEqual(2);
  });
});

describe('synth pads', () => {
  it('are non-silent and never clip', () => {
    for (const make of [airHorn, siren, clap, laser]) {
      const x = make(22050);
      let peak = 0;
      for (const v of x) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeGreaterThan(0.5);
      expect(peak).toBeLessThanOrEqual(0.71);
    }
  });
});

describe('isYouTubeUrl', () => {
  it('accepts YouTube, rejects others', () => {
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(isYouTubeUrl('https://music.youtube.com/watch?v=abc')).toBe(true);
    expect(isYouTubeUrl('https://evil.com/?youtube.com')).toBe(false);
    expect(isYouTubeUrl('http://www.youtube.com/')).toBe(false);
    expect(isYouTubeUrl(undefined)).toBe(false);
  });
});
