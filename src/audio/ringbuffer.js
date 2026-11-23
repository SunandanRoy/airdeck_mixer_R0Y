// @ts-check
/**
 * Stereo ring buffer holding the last N seconds of a deck's audio, plus a
 * peak track (one value per 512 samples) for drawing the waveform cheaply.
 * Memory: 2 ch × 44,100 × 4 B × 60 s ≈ 21 MB per deck.
 */
export const PEAK_BLOCK = 512;

export class RingBuffer {
  /** @param {number} sampleRate @param {number} seconds */
  constructor(sampleRate, seconds) {
    this.sampleRate = sampleRate;
    this.size = Math.round(sampleRate * seconds);
    this.left = new Float32Array(this.size);
    this.right = new Float32Array(this.size);
    this.write = 0;
    this.filled = 0;
    /** total frames ever written */
    this.total = 0;
    this.peakSize = Math.ceil(this.size / PEAK_BLOCK);
    this.peaks = new Float32Array(this.peakSize);
    this.peakWrite = 0;
    this.peakAcc = 0;
    this.peakCount = 0;
  }

  clear() {
    this.left.fill(0);
    this.right.fill(0);
    this.peaks.fill(0);
    this.write = 0;
    this.filled = 0;
    this.peakWrite = 0;
    this.peakAcc = 0;
    this.peakCount = 0;
  }

  /** @param {Float32Array} l @param {Float32Array} r */
  push(l, r) {
    const n = l.length;
    for (let i = 0; i < n; i++) {
      const a = l[i];
      const b = r[i];
      this.left[this.write] = a;
      this.right[this.write] = b;
      this.write = this.write + 1 === this.size ? 0 : this.write + 1;
      const p = Math.max(Math.abs(a), Math.abs(b));
      if (p > this.peakAcc) this.peakAcc = p;
      if (++this.peakCount === PEAK_BLOCK) {
        this.peaks[this.peakWrite] = this.peakAcc;
        this.peakWrite = (this.peakWrite + 1) % this.peakSize;
        this.peakAcc = 0;
        this.peakCount = 0;
      }
    }
    this.filled = Math.min(this.size, this.filled + n);
    this.total += n;
  }

  /**
   * Copies the most recent `frames` frames (oldest first).
   * @param {number} frames
   * @returns {[Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]}
   */
  last(frames) {
    const n = Math.min(Math.round(frames), this.filled);
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    let idx = (this.write - n + this.size) % this.size;
    for (let i = 0; i < n; i++) {
      l[i] = this.left[idx];
      r[i] = this.right[idx];
      idx = idx + 1 === this.size ? 0 : idx + 1;
    }
    return [l, r];
  }

  /**
   * Most recent `count` peaks, oldest first.
   * @param {number} count
   */
  recentPeaks(count) {
    const n = Math.min(count, this.peakSize);
    const out = new Float32Array(n);
    let idx = (this.peakWrite - n + this.peakSize) % this.peakSize;
    for (let i = 0; i < n; i++) {
      out[i] = this.peaks[idx];
      idx = (idx + 1) % this.peakSize;
    }
    return out;
  }
}

/**
 * Makes a loopable buffer: blends the last `fadeFrames` of the slice into its
 * start so the loop seam is click-free.
 * @param {Float32Array<ArrayBuffer>} l
 * @param {Float32Array<ArrayBuffer>} r
 * @param {number} fadeFrames
 * @returns {[Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]}
 */
export function makeSeamless(l, r, fadeFrames) {
  const n = l.length;
  const f = Math.min(fadeFrames, Math.floor(n / 4));
  if (f <= 0) return [l, r];
  // We play [f, n) then wrap to [f, ...]: the tail before the slice start is
  // the material just before it, so cross-fade the tail into the head.
  const outL = l.slice(f);
  const outR = r.slice(f);
  const m = outL.length;
  for (let i = 0; i < f; i++) {
    const g = (i + 1) / f;
    // head i blends from pre-slice material (l[i]) into the slice (l[f + i])
    outL[m - f + i] = outL[m - f + i] * (1 - g) + l[i] * g;
    outR[m - f + i] = outR[m - f + i] * (1 - g) + r[i] * g;
  }
  return [outL, outR];
}
