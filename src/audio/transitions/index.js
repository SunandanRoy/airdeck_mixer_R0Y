// @ts-check
/**
 * All Mix styles. Each is a pure function TransitionContext -> Plan.
 * Times are AudioContext seconds; L = transition length, X = outgoing deck,
 * Y = incoming deck.
 */
import { PlanBuilder, beatSeconds, xfadeFor, sampleCurve } from './common.js';

/** @typedef {import('./common.js').TransitionContext} TransitionContext */
/** @typedef {import('./common.js').Plan} Plan */

const CUT = 0.01; // 10 ms "instant" ramps never click

/** Length of the transition in seconds. */
export function lengthSeconds(/** @type {TransitionContext} */ ctx) {
  return ctx.lengthBeats * beatSeconds(ctx.bpm);
}

/** Smooth Fade: the crossfader glides X -> Y over L (equal-power curve). */
export function smoothFade(/** @type {TransitionContext} */ ctx) {
  const L = lengthSeconds(ctx);
  const t0 = ctx.now;
  const p = new PlanBuilder('smoothFade', t0);
  p.action('play', t0, ctx.to);
  p.set('xfade', ctx.xfade, t0).linear('xfade', xfadeFor(ctx.to), t0 + L);
  p.action('pause', t0 + L, ctx.from);
  return p.build(L);
}

/**
 * Bass Swap: Y comes in with its bass off; halfway through, the basses swap in
 * one go (so the two kick drums never fight), then X fades away.
 */
export function bassSwap(/** @type {TransitionContext} */ ctx) {
  const L = lengthSeconds(ctx);
  const beat = beatSeconds(ctx.bpm);
  const t0 = ctx.now;
  const mid = t0 + L / 2;
  const swap = Math.min(beat / 8, 0.08);
  const X = ctx.from;
  const Y = ctx.to;
  const p = new PlanBuilder('bassSwap', t0);
  p.action('play', t0, Y);
  p.ramp(`${Y}.low`, 1, 0, t0, CUT);
  p.set('xfade', ctx.xfade, t0).linear('xfade', 0.5, mid);
  p.set(`${X}.low`, 1, mid).linear(`${X}.low`, 0, mid + swap);
  p.set(`${Y}.low`, 0, mid).linear(`${Y}.low`, 1, mid + swap);
  p.set('xfade', 0.5, mid + swap).linear('xfade', xfadeFor(Y), t0 + L);
  p.action('pause', t0 + L, X);
  p.action('resetDeck', t0 + L + 0.05, X);
  return p.build(L, t0 + L + 0.05);
}

/**
 * Echo Out: X's last 2 beats turn into a beat-synced echo while its dry sound
 * cuts; Y lands at full level when the transition ends, with X's echo tail
 * fading out over it.
 */
export function echoOut(/** @type {TransitionContext} */ ctx) {
  const L = lengthSeconds(ctx);
  const beat = beatSeconds(ctx.bpm);
  const t0 = ctx.now;
  const X = ctx.from;
  const Y = ctx.to;
  const tEnd = t0 + L;
  const tCut = Math.max(t0, tEnd - 2 * beat);
  const tSend = Math.max(t0, tCut - beat / 2);
  const tail = 2 * beat;
  const p = new PlanBuilder('echoOut', t0);
  p.set(`${X}.echoTime`, beat / 2, t0);
  p.set(`${X}.echoFeedback`, 0.55, t0);
  p.set(`${X}.echoSend`, 0, tSend).linear(`${X}.echoSend`, 1, tCut);
  p.set(`${X}.echoSend`, 1, tCut).linear(`${X}.echoSend`, 0, tCut + CUT);
  p.set(`${X}.echoDry`, 1, tCut).linear(`${X}.echoDry`, 0, tCut + CUT);
  // Y needs to be rolling before it is heard.
  p.action('play', Math.max(t0, tEnd - 4 * beat), Y);
  const xfFrom = xfadeFor(X);
  p.set('xfade', ctx.xfade, t0).linear('xfade', xfFrom, t0 + CUT);
  p.set('xfade', xfFrom, tEnd).linear('xfade', xfadeFor(Y), tEnd + CUT);
  p.set(`${X}.xfOverride`, 0, tEnd).linear(`${X}.xfOverride`, 1, tEnd + CUT);
  p.linear(`${X}.xfOverride`, 0, tEnd + tail);
  p.action('pause', tEnd, X);
  p.action('resetDeck', tEnd + tail + 0.05, X);
  return p.build(L, tEnd + tail + 0.05);
}

/** Filter Fade: X thins out (high-pass up) while Y opens up (low-pass up). */
export function filterFade(/** @type {TransitionContext} */ ctx) {
  const L = lengthSeconds(ctx);
  const t0 = ctx.now;
  const X = ctx.from;
  const Y = ctx.to;
  const top = Math.min(20000, (ctx.nyquist ?? 22050) - 50);
  const p = new PlanBuilder('filterFade', t0);
  p.action('play', t0, Y);
  p.set(`${X}.hp`, 20, t0).exp(`${X}.hp`, 2000, t0 + L);
  p.set(`${Y}.lp`, 2000, t0).exp(`${Y}.lp`, top, t0 + L);
  p.set('xfade', ctx.xfade, t0).linear('xfade', xfadeFor(Y), t0 + L);
  p.action('pause', t0 + L, X);
  p.action('resetDeck', t0 + L + 0.05, X);
  p.action('resetDeck', t0 + L + 0.05, Y);
  return p.build(L, t0 + L + 0.05);
}

/** Quick Cut: instant switch. */
export function quickCut(/** @type {TransitionContext} */ ctx) {
  const t0 = ctx.now;
  const p = new PlanBuilder('quickCut', t0);
  p.action('play', t0, ctx.to);
  p.set('xfade', ctx.xfade, t0).linear('xfade', xfadeFor(ctx.to), t0 + CUT);
  p.action('pause', t0 + CUT, ctx.from);
  return p.build(CUT);
}

/**
 * Spinback: X spins backwards like a pulled-back record (reverse with a pitch
 * drop over 1 beat), then Y drops in. Done with a delay line whose delay time
 * grows faster than real time, which plays the recent past in reverse.
 */
export function spinback(/** @type {TransitionContext} */ ctx) {
  const T = beatSeconds(ctx.bpm);
  const t0 = ctx.now;
  const X = ctx.from;
  const Y = ctx.to;
  const p = new PlanBuilder('spinback', t0);
  p.action('play', t0, Y);
  // delay d(t) = 3t - t²/T  ->  playback rate 1 - d'(t) goes from -2 to 0.
  p.curve(`${X}.tm`, sampleCurve((u) => 3 * u * T - u * u * T, 128), t0, T);
  p.set(`${X}.fader`, 1, t0 + 0.7 * T).linear(`${X}.fader`, 0, t0 + T);
  p.set('xfade', ctx.xfade, t0 + T).linear('xfade', xfadeFor(Y), t0 + T + CUT);
  p.action('pause', t0 + T, X);
  p.action('resetDeck', t0 + T + 0.1, X);
  return p.build(T + CUT, t0 + T + 0.1);
}

/** Brake: X slows to a stop over 2 beats like a turntable switched off. */
export function brake(/** @type {TransitionContext} */ ctx) {
  const T = 2 * beatSeconds(ctx.bpm);
  const t0 = ctx.now;
  const X = ctx.from;
  const Y = ctx.to;
  const p = new PlanBuilder('brake', t0);
  p.action('play', t0, Y);
  // delay d(t) = t²/(2T)  ->  playback rate 1 - t/T goes from 1 to 0.
  p.curve(`${X}.tm`, sampleCurve((u) => (u * u * T) / 2, 128), t0, T);
  p.set(`${X}.fader`, 1, t0 + 0.75 * T).linear(`${X}.fader`, 0, t0 + T);
  p.set('xfade', ctx.xfade, t0 + T).linear('xfade', xfadeFor(Y), t0 + T + CUT);
  p.action('pause', t0 + T, X);
  p.action('resetDeck', t0 + T + 0.1, X);
  return p.build(T + CUT, t0 + T + 0.1);
}

/** Riser Build: a white-noise riser and a rising high-pass on X, then Y drops. */
export function riserBuild(/** @type {TransitionContext} */ ctx) {
  const L = lengthSeconds(ctx);
  const t0 = ctx.now;
  const X = ctx.from;
  const Y = ctx.to;
  const tEnd = t0 + L;
  const p = new PlanBuilder('riserBuild', t0);
  p.action('play', Math.max(t0, tEnd - 2), Y);
  p.set('riser.gain', 0, t0).linear('riser.gain', 0.35, tEnd);
  p.set('riser.freq', 400, t0).exp('riser.freq', 9000, tEnd);
  p.set('riser.gain', 0.35, tEnd).linear('riser.gain', 0, tEnd + 0.03);
  p.set(`${X}.hp`, 20, t0).exp(`${X}.hp`, 1200, tEnd);
  p.set('xfade', ctx.xfade, tEnd).linear('xfade', xfadeFor(Y), tEnd + CUT);
  p.action('pause', tEnd, X);
  p.action('resetDeck', tEnd + 0.05, X);
  return p.build(L, tEnd + 0.05);
}

/**
 * @typedef {Object} PresetInfo
 * @property {string} id
 * @property {string} label
 * @property {string} tip plain-language description for the tooltip
 * @property {boolean} usesLength
 * @property {(ctx: TransitionContext) => Plan} plan
 */

/** @type {PresetInfo[]} */
export const PRESETS = [
  { id: 'smoothFade', label: 'Smooth Fade', tip: 'Slowly slide from one song to the other.', usesLength: true, plan: smoothFade },
  { id: 'bassSwap', label: 'Bass Swap', tip: 'Bring the new song in without its bass, then swap the basses halfway. The classic DJ blend.', usesLength: true, plan: bassSwap },
  { id: 'echoOut', label: 'Echo Out', tip: 'The old song echoes away and the new one lands on the beat.', usesLength: true, plan: echoOut },
  { id: 'filterFade', label: 'Filter Fade', tip: 'The old song thins out while the new one opens up.', usesLength: true, plan: filterFade },
  { id: 'riserBuild', label: 'Riser Build', tip: 'Build tension with a whoosh, then drop the new song.', usesLength: true, plan: riserBuild },
  { id: 'quickCut', label: 'Quick Cut', tip: 'Switch songs instantly.', usesLength: false, plan: quickCut },
  { id: 'spinback', label: 'Spinback', tip: 'Spin the old song backwards like a record, then drop the new one.', usesLength: false, plan: spinback },
  { id: 'brake', label: 'Brake', tip: 'Stop the old song like a turntable switched off, then drop the new one.', usesLength: false, plan: brake },
];

export const PRESETS_BY_ID = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
