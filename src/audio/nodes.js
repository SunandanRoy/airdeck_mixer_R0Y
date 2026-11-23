// @ts-check
/**
 * Small Web Audio building blocks: Linkwitz-Riley filters, the 3-band
 * isolator, the vocal cut and the one-knob filter.
 */
import { butterworthQs, filterKnobToCutoffs } from './curves.js';
import { ISO_LOW_HZ, ISO_HIGH_HZ, VOCALCUT_SPLIT_HZ } from '../shared/constants.js';
import { smoothSet } from './automation.js';

/** Web Audio interprets lowpass/highpass Q in dB; convert from a linear Q. */
export const qToDb = (/** @type {number} */ q) => 20 * Math.log10(q);

/**
 * Chain of biquads. Returns [first, last].
 * @param {BaseAudioContext} ctx
 * @param {BiquadFilterType} type
 * @param {number} freq
 * @param {number[]} qs linear Qs
 * @returns {[BiquadFilterNode, BiquadFilterNode]}
 */
function chain(ctx, type, freq, qs) {
  /** @type {BiquadFilterNode[]} */
  const nodes = qs.map((q) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = type === 'lowpass' || type === 'highpass' ? qToDb(q) : q;
    return f;
  });
  for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i]);
  return [nodes[0], nodes[nodes.length - 1]];
}

/**
 * Linkwitz-Riley low/high-pass of order `lrOrder` (4 or 8): two cascaded
 * Butterworth filters of half the order.
 * @param {BaseAudioContext} ctx
 * @param {'lowpass'|'highpass'} type
 * @param {number} freq
 */
export function lrFilter(ctx, type, freq, lrOrder = 8) {
  const qs = butterworthQs(lrOrder / 2);
  return chain(ctx, type, freq, [...qs, ...qs]);
}

/**
 * The all-pass that equals LP + HP of the matching LR filter, used to keep the
 * isolator's bands phase-aligned so they sum flat.
 * @param {BaseAudioContext} ctx
 * @param {number} freq
 */
export function lrAllpass(ctx, freq, lrOrder = 8) {
  return chain(ctx, 'allpass', freq, butterworthQs(lrOrder / 2));
}

/**
 * 3-band isolator (Bass / Mid / Treble) with LR8 crossovers. With all band
 * gains at 1 the output is an all-pass of the input (flat magnitude).
 */
export class Isolator {
  /** @param {BaseAudioContext} ctx */
  constructor(ctx, lowHz = ISO_LOW_HZ, highHz = ISO_HIGH_HZ) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.low = ctx.createGain();
    this.mid = ctx.createGain();
    this.high = ctx.createGain();

    const [lpIn, lpOut] = lrFilter(ctx, 'lowpass', lowHz);
    const [apIn, apOut] = lrAllpass(ctx, highHz);
    this.input.connect(lpIn);
    lpOut.connect(apIn);
    apOut.connect(this.low);

    const [hpIn, hpOut] = lrFilter(ctx, 'highpass', lowHz);
    this.input.connect(hpIn);
    const [lp2In, lp2Out] = lrFilter(ctx, 'lowpass', highHz);
    const [hp2In, hp2Out] = lrFilter(ctx, 'highpass', highHz);
    hpOut.connect(lp2In);
    hpOut.connect(hp2In);
    lp2Out.connect(this.mid);
    hp2Out.connect(this.high);

    this.low.connect(this.output);
    this.mid.connect(this.output);
    this.high.connect(this.output);
  }

  /** @param {{low: number, mid: number, high: number}} g */
  setBands(g) {
    smoothSet(this.low.gain, g.low, this.ctx);
    smoothSet(this.mid.gain, g.mid, this.ctx);
    smoothSet(this.high.gain, g.high, this.ctx);
  }
}

/**
 * Vocal cut (approximate): keeps the original below 150 Hz and replaces
 * everything above with the side signal (L − R), sent to both channels.
 * Centre-panned sound (usually the lead vocal) cancels out.
 */
export class VocalCut {
  /** @param {BaseAudioContext} ctx */
  constructor(ctx, splitHz = VOCALCUT_SPLIT_HZ) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.output.channelCount = 2;
    this.output.channelCountMode = 'explicit';
    this.output.channelInterpretation = 'speakers';

    const [lpIn, lpOut] = lrFilter(ctx, 'lowpass', splitHz, 4);
    this.input.connect(lpIn);
    lpOut.connect(this.output);

    const splitter = ctx.createChannelSplitter(2);
    const side = ctx.createGain();
    side.channelCount = 1;
    side.channelCountMode = 'explicit';
    const invert = ctx.createGain();
    invert.gain.value = -1;
    this.input.connect(splitter);
    splitter.connect(side, 0);
    splitter.connect(invert, 1);
    invert.connect(side);
    const [hpIn, hpOut] = lrFilter(ctx, 'highpass', splitHz, 4);
    side.connect(hpIn);
    hpOut.connect(this.output); // mono -> both channels
  }
}

/** One-knob filter: centre off, left low-pass, right high-pass. */
export class FilterKnob {
  /** @param {BaseAudioContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.lp.Q.value = 0; // 0 dB resonance (linear Q = 1)
    this.hp.Q.value = 0;
    const off = filterKnobToCutoffs(0, ctx.sampleRate / 2);
    this.lp.frequency.value = off.lp;
    this.hp.frequency.value = off.hp;
    this.lp.connect(this.hp);
    this.input = this.lp;
    this.output = this.hp;
    this.k = 0;
  }

  /** @param {number} k in [-1, 1] */
  set(k) {
    this.k = k;
    const c = filterKnobToCutoffs(k, this.ctx.sampleRate / 2);
    smoothSet(this.lp.frequency, c.lp, this.ctx, 0.02);
    smoothSet(this.hp.frequency, c.hp, this.ctx, 0.02);
  }
}
