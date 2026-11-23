// @ts-check
/**
 * Tempo detection from an onset-strength envelope.
 *
 * The deck analyser worklet computes one onset value per 128-sample render
 * quantum (≈ 344 values per second at 44.1 kHz). This module turns a window of
 * those values into a BPM using autocorrelation with a harmonic comb, which
 * gives sub-0.1-BPM resolution without an FFT.
 *
 * Everything here is pure and runs the same in Node (unit tests) and in the
 * browser.
 */
import { BPM_MIN, BPM_MAX } from '../shared/constants.js';

/**
 * Onset strength from mono samples, one value per `hop` samples: the average of
 * the half-wave-rectified log-energy rise of the full signal and of a 150 Hz
 * low-passed copy (kick drums). Mirrors the capture worklet exactly.
 * @param {Float32Array} samples
 * @param {number} hop
 * @param {number} sampleRate
 */
export function onsetEnvelope(samples, hop = 128, sampleRate = 44100) {
  const n = Math.floor(samples.length / hop);
  const env = new Float32Array(n);
  const a = Math.exp((-2 * Math.PI * 150) / sampleRate);
  let lp = 0;
  let prevFull = 0;
  let prevLow = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    let el = 0;
    for (let j = i * hop, end = j + hop; j < end; j++) {
      const x = samples[j];
      e += x * x;
      lp = (1 - a) * x + a * lp;
      el += lp * lp;
    }
    const lf = Math.log(1e-9 + e / hop);
    const ll = Math.log(1e-9 + el / hop);
    env[i] = i === 0 ? 0 : 0.5 * Math.max(0, lf - prevFull) + 0.5 * Math.max(0, ll - prevLow);
    prevFull = lf;
    prevLow = ll;
  }
  return env;
}

/**
 * Folds a tempo into [min, max] by halving or doubling.
 * @param {number} bpm
 */
export function foldBpm(bpm, min = BPM_MIN, max = BPM_MAX) {
  if (!Number.isFinite(bpm) || bpm <= 0) return NaN;
  let b = bpm;
  while (b < min) b *= 2;
  while (b > max) b /= 2;
  return b;
}

/**
 * Estimates tempo from an onset envelope.
 * @param {Float32Array} env onset values
 * @param {number} frameRate envelope values per second
 * @returns {{bpm: number, confidence: number}}
 */
export function estimateBpm(env, frameRate, min = BPM_MIN, max = BPM_MAX) {
  const n = env.length;
  if (n < frameRate * 4) return { bpm: NaN, confidence: 0 };
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= n;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = env[i] - mean;

  const harmonics = 4;
  const maxLag = Math.min(n - 1, Math.ceil(((60 * frameRate) / min) * harmonics) + 2);
  const r = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
    r[lag] = s / (n - lag);
  }
  if (r[0] <= 0) return { bpm: NaN, confidence: 0 };

  /** @param {number} lag */
  const rAt = (lag) => {
    const i = Math.floor(lag);
    if (i + 1 > maxLag) return 0;
    const f = lag - i;
    return r[i] * (1 - f) + r[i + 1] * f;
  };

  let best = NaN;
  let bestScore = -Infinity;
  let sum = 0;
  let count = 0;
  for (let bpm = min; bpm <= max; bpm += 0.02) {
    const lag = (60 * frameRate) / bpm;
    let score = 0;
    for (let k = 1; k <= harmonics; k++) score += rAt(lag * k);
    score /= harmonics;
    sum += score;
    count++;
    if (score > bestScore) {
      bestScore = score;
      best = bpm;
    }
  }
  const avg = sum / count;
  const confidence = Math.max(0, Math.min(1, (bestScore - avg) / r[0]));
  return { bpm: Math.round(best * 10) / 10, confidence };
}

/**
 * Seconds since the most recent beat at the end of the envelope window.
 * @param {Float32Array} env
 * @param {number} frameRate
 * @param {number} bpm
 */
export function estimateBeatPhase(env, frameRate, bpm) {
  const period = (60 * frameRate) / bpm;
  const steps = Math.max(8, Math.round(period));
  let bestOffset = 0;
  let bestSum = -Infinity;
  for (let s = 0; s < steps; s++) {
    const offset = (s / steps) * period; // frames back from the end
    let sum = 0;
    for (let t = env.length - 1 - offset; t >= 0; t -= period) {
      const i = Math.round(t);
      sum += env[i] + 0.5 * ((env[i - 1] || 0) + (env[i + 1] || 0));
    }
    if (sum > bestSum) {
      bestSum = sum;
      bestOffset = offset;
    }
  }
  return bestOffset / frameRate;
}

/**
 * Average BPM from tap timestamps (seconds). Uses the last 8 taps.
 * @param {number[]} taps
 */
export function bpmFromTaps(taps) {
  const recent = taps.slice(-8);
  if (recent.length < 4) return NaN;
  const span = recent[recent.length - 1] - recent[0];
  if (span <= 0) return NaN;
  return Math.round(((60 * (recent.length - 1)) / span) * 10) / 10;
}

/**
 * Playback rate that makes deck Y play at deck X's effective tempo.
 * Tries the plain ratio, then double/half tempo (70 vs 140 BPM), and clamps.
 * @param {number} targetEffectiveBpm X's effective BPM
 * @param {number} baseBpm Y's native (rate = 1) BPM
 * @param {number} maxDeviation e.g. 0.16 for ±16%
 * @returns {number|null} rate, or null if it can't be matched in range
 */
export function syncRate(targetEffectiveBpm, baseBpm, maxDeviation = 0.16) {
  if (!(targetEffectiveBpm > 0) || !(baseBpm > 0)) return null;
  const candidates = [1, 2, 0.5].map((m) => (targetEffectiveBpm * m) / baseBpm);
  candidates.sort((p, q) => Math.abs(p - 1) - Math.abs(q - 1));
  const best = candidates[0];
  if (Math.abs(best - 1) > maxDeviation + 1e-9) return null;
  return best;
}

/**
 * Keeps a rolling envelope and reports a BPM once it has been stable.
 */
export class BpmTracker {
  /** @param {number} frameRate envelope values per second */
  constructor(frameRate, windowSeconds = 12, stableSeconds = 8) {
    this.frameRate = frameRate;
    this.size = Math.round(frameRate * windowSeconds);
    this.buf = new Float32Array(this.size);
    this.write = 0;
    this.filled = 0;
    this.stableSeconds = stableSeconds;
    /** @type {{t: number, bpm: number}[]} */
    this.history = [];
    this.locked = NaN;
  }

  reset() {
    this.buf.fill(0);
    this.write = 0;
    this.filled = 0;
    this.history = [];
    this.locked = NaN;
  }

  /** @param {ArrayLike<number>} values */
  push(values) {
    for (let i = 0; i < values.length; i++) {
      this.buf[this.write] = values[i];
      this.write = (this.write + 1) % this.size;
    }
    this.filled = Math.min(this.size, this.filled + values.length);
  }

  /** Window in chronological order. */
  window() {
    const out = new Float32Array(this.filled);
    const start = (this.write - this.filled + this.size) % this.size;
    for (let i = 0; i < this.filled; i++) out[i] = this.buf[(start + i) % this.size];
    return out;
  }

  /**
   * Runs an estimate. Call about once per second.
   * @param {number} now seconds
   * @returns {{bpm: number, stable: boolean}}
   */
  update(now) {
    const env = this.window();
    const { bpm, confidence } = estimateBpm(env, this.frameRate);
    if (Number.isFinite(bpm) && confidence > 0.02) this.history.push({ t: now, bpm });
    this.history = this.history.filter((h) => now - h.t <= this.stableSeconds + 0.5);
    if (this.history.length === 0) return { bpm: NaN, stable: false };
    const span = now - this.history[0].t;
    const sorted = this.history.map((h) => h.bpm).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const allClose = sorted.every((b) => Math.abs(b - median) <= 1);
    const stable = allClose && span >= this.stableSeconds - 0.5;
    if (stable) this.locked = median;
    return { bpm: median, stable };
  }

  /** Seconds since the last beat, given a known BPM. */
  phase(/** @type {number} */ bpm) {
    return estimateBeatPhase(this.window(), this.frameRate, bpm);
  }
}
