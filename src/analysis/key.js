// @ts-check
/**
 * Key detection: chroma vector + Krumhansl-Kessler key profiles.
 *
 * This is AirDeck's own small implementation (MIT), used instead of the
 * GPL/AGPL options in the PRD so the project stays permissively licensed.
 * Accuracy is good on harmonic material and rougher on drum-heavy tracks,
 * which is why the UI shows it as a hint.
 */

// Krumhansl-Kessler probe-tone profiles, index 0 = tonic.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/**
 * In-place iterative radix-2 FFT.
 * @param {Float32Array} re
 * @param {Float32Array} im
 */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * 12-bin chroma (C = 0) from mono samples.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 */
export function chroma(samples, sampleRate, frameSize = 8192) {
  const out = new Float64Array(12);
  const hop = frameSize;
  const window = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
  const binPc = new Int8Array(frameSize / 2).fill(-1);
  for (let k = 1; k < frameSize / 2; k++) {
    const f = (k * sampleRate) / frameSize;
    if (f < 55 || f > 2000) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    binPc[k] = ((Math.round(midi) % 12) + 12) % 12;
  }
  const re = new Float32Array(frameSize);
  const im = new Float32Array(frameSize);
  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    for (let i = 0; i < frameSize; i++) {
      re[i] = samples[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < frameSize / 2; k++) {
      const pc = binPc[k];
      if (pc >= 0) out[pc] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
  }
  return out;
}

/** @param {ArrayLike<number>} a @param {ArrayLike<number>} b */
function correlation(a, b) {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= 12;
  mb /= 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/**
 * Best-matching key for a chroma vector.
 * @param {ArrayLike<number>} c
 * @returns {{key: import('./camelot.js').Key, score: number}}
 */
export function keyFromChroma(c) {
  /** @type {import('./camelot.js').Key} */
  let best = { tonic: 0, mode: 'major' };
  let bestScore = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = new Array(12);
    for (let i = 0; i < 12; i++) rotated[i] = c[(i + tonic) % 12];
    const maj = correlation(rotated, MAJOR);
    const min = correlation(rotated, MINOR);
    if (maj > bestScore) {
      bestScore = maj;
      best = { tonic, mode: 'major' };
    }
    if (min > bestScore) {
      bestScore = min;
      best = { tonic, mode: 'minor' };
    }
  }
  return { key: best, score: bestScore };
}

/**
 * @param {Float32Array} samples mono
 * @param {number} sampleRate
 */
export function detectKey(samples, sampleRate) {
  return keyFromChroma(chroma(samples, sampleRate));
}
