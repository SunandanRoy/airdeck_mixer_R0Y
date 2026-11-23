// @ts-check
/**
 * Per-deck FX. Every effect is built once and bypassed with wet = 0 (never
 * disconnected), so switching is click-free. Each exposes:
 *   input, output    nodes to chain
 *   setOn(on, amount, bpm?)
 */
import { smoothSet } from '../automation.js';

/** @typedef {{input: AudioNode, output: AudioNode, setOn: (on: boolean, amount: number, bpm?: number) => void}} Fx */

/** Generates a stereo reverb impulse response in code: decaying noise. */
export function makeImpulse(/** @type {BaseAudioContext} */ ctx, seconds = 2.5, decay = 3) {
  const len = Math.round(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (rand() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/** Beat-synced echo with a low-passed feedback loop. Also used by Echo Out. */
export class Echo {
  /** @param {BaseAudioContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.send = ctx.createGain();
    this.send.gain.value = 0;
    this.delay = ctx.createDelay(4);
    this.delay.delayTime.value = 0.375;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.5;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 6000;
    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.send).connect(this.delay);
    this.delay.connect(tone).connect(this.feedback).connect(this.delay);
    this.delay.connect(this.output);
  }
  /** @param {boolean} on @param {number} amount @param {number} [bpm] */
  setOn(on, amount, bpm) {
    if (bpm && bpm > 0) smoothSet(this.delay.delayTime, 30 / bpm, this.ctx, 0.02);
    smoothSet(this.feedback.gain, 0.5, this.ctx);
    smoothSet(this.send.gain, on ? amount : 0, this.ctx);
  }
}

/** Convolution reverb with a generated impulse response. */
export class Reverb {
  /** @param {BaseAudioContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.send = ctx.createGain();
    this.send.gain.value = 0;
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx);
    this.input.connect(this.output);
    this.input.connect(this.send).connect(conv).connect(this.output);
  }
  /** @param {boolean} on @param {number} amount */
  setOn(on, amount) {
    smoothSet(this.send.gain, on ? amount * 0.8 : 0, this.ctx, 0.02);
  }
}

/** Base for insert effects: out = dry·(1 − mix) + wet·mix. */
class Insert {
  /** @param {BaseAudioContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.input.connect(this.dry).connect(this.output);
    this.wet.connect(this.output);
  }
  /** @param {boolean} on @param {number} amount */
  mix(on, amount) {
    const m = on ? Math.max(0, Math.min(1, amount)) : 0;
    smoothSet(this.dry.gain, 1 - m, this.ctx);
    smoothSet(this.wet.gain, m, this.ctx);
  }
}

/** Resonant low-pass swept up and down once per bar. */
export class FilterSweep extends Insert {
  /** @param {BaseAudioContext} ctx */
  constructor(ctx) {
    super(ctx);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200;
    f.Q.value = 8; // dB
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 0.5;
    const depth = ctx.createGain();
    depth.gain.value = 2400; // ± 2 octaves in cents
    this.lfo.connect(depth).connect(f.detune);
    this.lfo.start();
    this.input.connect(f).connect(this.wet);
  }
  /** @param {boolean} on @param {number} amount @param {number} [bpm] */
  setOn(on, amount, bpm) {
    if (bpm && bpm > 0) this.lfo.frequency.setValueAtTime(bpm / 60 / 4, this.ctx.currentTime);
    this.mix(on, 0.4 + 0.6 * amount);
  }
}

/** Classic flanger: a short, slowly moving delay mixed with the dry sound. */
export class Flanger {
  /** @param {BaseAudioContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    const delay = ctx.createDelay(0.02);
    delay.delayTime.value = 0.004;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.25;
    const depth = ctx.createGain();
    depth.gain.value = 0.003;
    lfo.connect(depth).connect(delay.delayTime);
    lfo.start();
    const fb = ctx.createGain();
    fb.gain.value = 0.6;
    this.input.connect(this.output);
    this.input.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(this.wet).connect(this.output);
  }
  /** @param {boolean} on @param {number} amount */
  setOn(on, amount) {
    smoothSet(this.wet.gain, on ? 0.4 + 0.5 * amount : 0, this.ctx);
  }
}

/** Lo-Fi: bit-crush style quantisation plus a dull low-pass. */
export class LoFi extends Insert {
  /** @param {BaseAudioContext} ctx */
  constructor(ctx) {
    super(ctx);
    const shaper = ctx.createWaveShaper();
    const steps = 12;
    const curve = new Float32Array(4096);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.round(x * steps) / steps;
    }
    shaper.curve = curve;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    this.input.connect(shaper).connect(lp).connect(this.wet);
  }
  /** @param {boolean} on @param {number} amount */
  setOn(on, amount) {
    this.mix(on, 0.5 + 0.5 * amount);
  }
}

/** Telephone: band-pass 300–3,400 Hz with a touch of grit. */
export class Telephone extends Insert {
  /** @param {BaseAudioContext} ctx */
  constructor(ctx) {
    super(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 300;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3400;
    const drive = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(2.5 * x) / Math.tanh(2.5);
    }
    drive.curve = curve;
    const makeup = ctx.createGain();
    makeup.gain.value = 1.4;
    this.input.connect(hp).connect(lp).connect(drive).connect(makeup).connect(this.wet);
  }
  /** @param {boolean} on @param {number} amount */
  setOn(on, amount) {
    this.mix(on, 0.6 + 0.4 * amount);
  }
}

/** FX pad catalogue for the UI. `stutter` is handled by the deck (it needs the buffer). */
export const FX_PADS = [
  { id: 'echo', label: 'Echo', tip: 'Repeats the sound in time with the beat.' },
  { id: 'reverb', label: 'Reverb', tip: 'Makes it sound like a big hall.' },
  { id: 'sweep', label: 'Sweep', tip: 'A filter that sweeps up and down every bar.' },
  { id: 'flanger', label: 'Flanger', tip: 'A swirling, jet-plane whoosh.' },
  { id: 'lofi', label: 'Lo-Fi', tip: 'Crunchy, old-cassette sound.' },
  { id: 'telephone', label: 'Phone', tip: 'Sounds like it is playing through a phone.' },
  { id: 'stutter', label: 'Stutter', tip: 'Repeats a tiny slice of the beat while you hold it.' },
];
