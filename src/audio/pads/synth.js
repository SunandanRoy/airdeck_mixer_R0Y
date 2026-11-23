// @ts-check
/**
 * Built-in sample pads, synthesized in code so no audio files (and no
 * licensing questions) ship with AirDeck. Pure functions -> mono Float32Array.
 */

function rng(seed = 3) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** One-pole low-pass in place. */
function onePole(/** @type {Float32Array} */ x, /** @type {number} */ hz, /** @type {number} */ sr) {
  const a = Math.exp((-2 * Math.PI * hz) / sr);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y = (1 - a) * x[i] + a * y;
    x[i] = y;
  }
  return x;
}

function normalise(/** @type {Float32Array} */ x, peak = 0.7) {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
}

/** Air horn: three detuned saws in a chord with a stuttered envelope. */
export function airHorn(sr = 44100) {
  const len = Math.round(1.3 * sr);
  const out = new Float32Array(len);
  const freqs = [466.16, 587.33, 698.46];
  const phases = [0, 0, 0];
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const blast = t < 0.18 || (t > 0.24 && t < 0.42) || t > 0.5 ? 1 : 0;
    const env = blast * Math.min(1, t * 80) * Math.min(1, (1.3 - t) * 6);
    let s = 0;
    freqs.forEach((f, k) => {
      phases[k] += (f * (1 + 0.004 * Math.sin(2 * Math.PI * 6 * t))) / sr;
      s += 2 * (phases[k] % 1) - 1;
    });
    out[i] = s * env;
  }
  return normalise(onePole(out, 3500, sr));
}

/** Siren: a sine that wails up and down. */
export function siren(sr = 44100) {
  const len = Math.round(1.6 * sr);
  const out = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = 900 + 500 * Math.sin(2 * Math.PI * 1.25 * t - Math.PI / 2);
    phase += f / sr;
    const env = Math.min(1, t * 30) * Math.min(1, (1.6 - t) * 8);
    out[i] = env * (Math.sin(2 * Math.PI * phase) + 0.3 * Math.sin(6 * Math.PI * phase));
  }
  return normalise(out);
}

/** Clap: three quick band-limited noise bursts and a short tail. */
export function clap(sr = 44100) {
  const len = Math.round(0.45 * sr);
  const out = new Float32Array(len);
  const rand = rng(9);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let env = 0;
    for (const start of [0, 0.011, 0.022]) if (t >= start) env = Math.max(env, Math.exp(-(t - start) * 180));
    env = Math.max(env, t >= 0.03 ? 0.5 * Math.exp(-(t - 0.03) * 18) : 0);
    out[i] = (rand() * 2 - 1) * env;
  }
  // crude band-pass around 1.2 kHz: low-pass, minus a lower low-pass
  const low = onePole(out.slice(), 600, sr);
  onePole(out, 4000, sr);
  for (let i = 0; i < len; i++) out[i] -= low[i];
  return normalise(out);
}

/** Laser: a fast downward pitch sweep. */
export function laser(sr = 44100) {
  const len = Math.round(0.5 * sr);
  const out = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = 2400 * Math.exp(-t * 7) + 90;
    phase += f / sr;
    const env = Math.min(1, t * 200) * Math.exp(-t * 4);
    out[i] = env * (phase % 1 < 0.5 ? 1 : -1) * 0.6 + env * 0.4 * Math.sin(2 * Math.PI * phase);
  }
  return normalise(onePole(out, 6000, sr));
}

/** White noise loop used by the Riser transition. */
export function whiteNoise(seconds = 2, sr = 44100) {
  const rand = rng(21);
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = rand() * 2 - 1;
  return out;
}

export const BUILT_IN_PADS = [
  { id: 'horn', label: 'Horn', tip: 'Air horn', make: airHorn },
  { id: 'siren', label: 'Siren', tip: 'Siren', make: siren },
  { id: 'clap', label: 'Clap', tip: 'Hand clap', make: clap },
  { id: 'laser', label: 'Laser', tip: 'Laser zap', make: laser },
];
