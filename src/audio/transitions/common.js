// @ts-check
/**
 * Shared types and helpers for transition presets ("Mix styles").
 *
 * A preset is a pure function (ctx) => Plan. A Plan is data: a list of
 * AudioParam automation events on the AudioContext clock plus a few timed
 * non-audio actions (play/pause a video, update the UI). The AutomationEngine
 * turns plans into real AudioParam calls; tests check plans as plain data.
 */
import { FALLBACK_BEAT_SECONDS } from '../../shared/constants.js';

/** @typedef {import('../../shared/constants.js').DeckId} DeckId */

/**
 * Param targets:
 *   'xfade'                     crossfader position, 0 = all A, 1 = all B
 *   `${deck}.low|mid|high`      isolator band gains (1 = on, 0 = off)
 *   `${deck}.fader`             channel fader gain
 *   `${deck}.xfOverride`        extra gain added after the crossfader (echo tails)
 *   `${deck}.lp` / `${deck}.hp` filter cutoffs in Hz
 *   `${deck}.echoSend|echoDry|echoFeedback|echoTime`
 *   `${deck}.tm`                "time machine" delay in seconds (brake/spinback)
 *   'riser.gain' / 'riser.freq' noise riser
 * @typedef {string} ParamTarget
 */

/**
 * @typedef {Object} AutomationEvent
 * @property {ParamTarget} target
 * @property {'set'|'linear'|'exp'|'curve'} type
 * @property {number | number[]} value number, or the curve values for 'curve'
 * @property {number} time AudioContext time in seconds (for 'curve': start time)
 * @property {number} [duration] curve duration in seconds
 */

/**
 * @typedef {Object} PlanAction
 * @property {number} time AudioContext time
 * @property {'play'|'pause'|'resetDeck'|'done'} type
 * @property {DeckId} [deck]
 */

/**
 * @typedef {Object} Plan
 * @property {string} preset
 * @property {number} t0 start time
 * @property {number} duration seconds from t0 until the incoming deck is fully in
 * @property {number} end time when every event and action has finished
 * @property {AutomationEvent[]} events
 * @property {PlanAction[]} actions
 * @property {ParamTarget[]} targets every param the plan touches (for Cancel)
 */

/**
 * @typedef {Object} TransitionContext
 * @property {DeckId} from outgoing deck (X)
 * @property {DeckId} to incoming deck (Y)
 * @property {number} lengthBeats
 * @property {number} bpm effective BPM of X (NaN if unknown)
 * @property {number} now AudioContext time to start at
 * @property {number} xfade current crossfader position
 * @property {number} [nyquist]
 */

/** Seconds per beat, falling back to 0.5 s (8 beats ≈ 4 s) when BPM is unknown. */
export function beatSeconds(/** @type {number} */ bpm) {
  return bpm > 0 ? 60 / bpm : FALLBACK_BEAT_SECONDS;
}

/** Crossfader position that is fully on `deck`. */
export function xfadeFor(/** @type {DeckId} */ deck) {
  return deck === 'B' ? 1 : 0;
}

/** Small builder that collects events and the targets they touch. */
export class PlanBuilder {
  /** @param {string} preset @param {number} t0 */
  constructor(preset, t0) {
    this.preset = preset;
    this.t0 = t0;
    /** @type {AutomationEvent[]} */
    this.events = [];
    /** @type {PlanAction[]} */
    this.actions = [];
    /** @type {Set<string>} */
    this.touched = new Set();
  }
  /** @param {ParamTarget} target @param {number} value @param {number} time */
  set(target, value, time) {
    this.events.push({ target, type: 'set', value, time });
    this.touched.add(target);
    return this;
  }
  /** @param {ParamTarget} target @param {number} value @param {number} time end time */
  linear(target, value, time) {
    this.events.push({ target, type: 'linear', value, time });
    this.touched.add(target);
    return this;
  }
  /** @param {ParamTarget} target @param {number} value @param {number} time end time */
  exp(target, value, time) {
    this.events.push({ target, type: 'exp', value: Math.max(1e-4, value), time });
    this.touched.add(target);
    return this;
  }
  /** Set at `time`, then ramp linearly to `to` over `dur`. */
  ramp(/** @type {ParamTarget} */ target, /** @type {number} */ from, /** @type {number} */ to, /** @type {number} */ time, /** @type {number} */ dur) {
    return this.set(target, from, time).linear(target, to, time + dur);
  }
  /** @param {ParamTarget} target @param {number[]} values @param {number} time @param {number} duration */
  curve(target, values, time, duration) {
    this.events.push({ target, type: 'curve', value: values, time, duration });
    this.touched.add(target);
    return this;
  }
  /** @param {PlanAction['type']} type @param {number} time @param {DeckId} [deck] */
  action(type, time, deck) {
    this.actions.push({ time, type, deck });
    return this;
  }
  /** @param {number} duration @param {number} [end] */
  build(duration, end) {
    const finish = end ?? this.t0 + duration;
    this.action('done', finish);
    return /** @type {Plan} */ ({
      preset: this.preset,
      t0: this.t0,
      duration,
      end: finish,
      events: this.events.slice().sort((a, b) => a.time - b.time),
      actions: this.actions.slice().sort((a, b) => a.time - b.time),
      targets: [...this.touched],
    });
  }
}

/** Equal-steps curve helper for setValueCurveAtTime. */
export function sampleCurve(/** @type {(p: number) => number} */ fn, n = 64) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(fn(i / (n - 1)));
  return out;
}
