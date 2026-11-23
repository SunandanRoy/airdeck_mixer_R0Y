// @ts-check
/**
 * Pure math for mixer curves. No Web Audio here, so it is unit-testable in Node.
 */

/** @typedef {'smooth' | 'sharp' | 'linear'} CrossfaderCurve */

/**
 * Crossfader gains for a position x in [0, 1] (0 = all A, 1 = all B).
 * - smooth: equal power, gA = cos(x·π/2), gB = sin(x·π/2)
 * - sharp:  both at full until within 5% of the far end, then a quick cut
 * - linear: gA = 1 - x, gB = x
 * @param {number} x
 * @param {CrossfaderCurve} curve
 * @returns {{a: number, b: number}}
 */
export function crossfaderGains(x, curve) {
  const p = Math.min(1, Math.max(0, x));
  switch (curve) {
    case 'linear':
      return { a: 1 - p, b: p };
    case 'sharp': {
      const edge = 0.05;
      const a = p <= 1 - edge ? 1 : (1 - p) / edge;
      const b = p >= edge ? 1 : p / edge;
      return { a, b };
    }
    case 'smooth':
    default:
      return { a: Math.cos((p * Math.PI) / 2), b: Math.sin((p * Math.PI) / 2) };
  }
}

/**
 * Builds a WaveShaper curve that maps a control signal in [0, 1] to the gain of
 * one side of the crossfader. Inputs below 0 (the shaper's [-1, 0) half) clamp to
 * the value at 0. This lets the crossfader position be a single sample-accurate
 * AudioParam (a ConstantSourceNode offset) that automation can ramp.
 * @param {'a'|'b'} side
 * @param {CrossfaderCurve} curve
 * @param {number} [size]
 */
export function crossfaderShaperCurve(side, curve, size = 4097) {
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const input = (i / (size - 1)) * 2 - 1; // [-1, 1]
    const g = crossfaderGains(Math.max(0, input), curve);
    out[i] = side === 'a' ? g.a : g.b;
  }
  return out;
}

/**
 * One-knob filter mapping. k in [-1, 1]: centre = off, left = low-pass sweep,
 * right = high-pass sweep.
 * @param {number} k
 * @param {number} nyquist
 * @returns {{lp: number, hp: number, active: boolean}}
 */
export function filterKnobToCutoffs(k, nyquist = 22050) {
  const kk = Math.min(1, Math.max(-1, k));
  const off = { lp: Math.min(22000, nyquist), hp: 10, active: false };
  if (Math.abs(kk) < 0.03) return off;
  if (kk < 0) return { lp: Math.min(20000 * Math.pow(2, kk * 10), nyquist), hp: 10, active: true };
  return { lp: off.lp, hp: Math.min(20 * Math.pow(2, kk * 10), nyquist), active: true };
}

export const dbToGain = (/** @type {number} */ db) => Math.pow(10, db / 20);
export const gainToDb = (/** @type {number} */ g) => (g <= 0 ? -Infinity : 20 * Math.log10(g));

/**
 * Soft safety-clipper curve: identity up to `knee`, then a smooth tanh-shaped
 * approach to `ceiling`. Guarantees the master never exceeds the ceiling.
 * @param {number} ceiling linear peak ceiling (e.g. 0.944 = -0.5 dBFS)
 * @param {number} knee linear level where the curve starts bending
 * @param {number} [size]
 */
export function safetyClipperCurve(ceiling = 0.944, knee = 0.85, size = 8193) {
  const out = new Float32Array(size);
  const range = ceiling - knee;
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + range * Math.tanh((ax - knee) / range);
    out[i] = Math.sign(x) * y;
  }
  return out;
}

/**
 * Butterworth section Qs for an order-n filter (n even). LR(2n) filters are two
 * cascaded Butterworth(n) filters.
 * @param {number} order
 */
export function butterworthQs(order) {
  const qs = [];
  for (let k = 0; k < order / 2; k++) {
    qs.push(1 / (2 * Math.cos(((2 * k + 1) * Math.PI) / (2 * order))));
  }
  return qs;
}
