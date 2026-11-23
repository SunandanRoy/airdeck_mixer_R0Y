// @ts-check
/**
 * AudioEngine: the single AudioContext that hosts every deck, the master bus,
 * the crossfader, sample pads, the transition automation and the recorder.
 *
 *  Deck A ─┐                         ┌─► analyser (meter)
 *  Deck B ─┼─► masterIn ─► volume ─► limiter ─► safety clipper ─► speakers
 *  Pads  ──┤                                                  └─► recorder
 *  Riser ──┘
 */
import { Emitter } from '../shared/emitter.js';
import { Deck } from './deck.js';
import { AutomationEngine, smoothSet } from './automation.js';
import { crossfaderShaperCurve, safetyClipperCurve } from './curves.js';
import { PRESETS_BY_ID } from './transitions/index.js';
import { BUILT_IN_PADS, whiteNoise } from './pads/synth.js';
import { Recorder } from './recorder.js';
import { DECK_IDS } from '../shared/constants.js';

/** @typedef {import('../shared/constants.js').DeckId} DeckId */
/** @typedef {import('./curves.js').CrossfaderCurve} CrossfaderCurve */

export class AudioEngine extends Emitter {
  /** @param {{ctx?: AudioContext}} [opts] */
  constructor(opts = {}) {
    super();
    this.ctx = opts.ctx ?? new AudioContext({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.settings = { autoLevel: true, crossfaderCurve: /** @type {CrossfaderCurve} */ ('smooth') };
    this.workletReady = false;

    // Silent sink keeps analysis worklets running without being heard.
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(ctx.destination);

    // --- master bus
    this.masterIn = ctx.createGain();
    this.volume = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.1;
    this.clipper = ctx.createWaveShaper();
    this.clipper.curve = safetyClipperCurve(0.944, 0.85);
    this.masterOut = ctx.createGain();
    this.masterIn.connect(this.volume).connect(this.limiter).connect(this.clipper).connect(this.masterOut);
    this.masterOut.connect(ctx.destination);
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 2048;
    this.masterOut.connect(this.meter);

    // --- crossfader: one sample-accurate position param -> two gain curves
    this.xfPos = ctx.createConstantSource();
    this.xfPos.offset.value = 0.5;
    this.shaperA = ctx.createWaveShaper();
    this.shaperB = ctx.createWaveShaper();
    this.xfPos.connect(this.shaperA);
    this.xfPos.connect(this.shaperB);
    this.xfPos.start();
    this.setCrossfaderCurve('smooth');

    // --- decks
    /** @type {Record<DeckId, Deck>} */
    this.decks = /** @type {any} */ ({});
    for (const id of DECK_IDS) {
      const deck = new Deck(this, id);
      deck.xf.connect(this.masterIn);
      (id === 'A' ? this.shaperA : this.shaperB).connect(deck.xf.gain);
      this.decks[id] = deck;
    }

    // --- riser (for the Riser Build mix style)
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    noise.copyToChannel(/** @type {Float32Array<ArrayBuffer>} */ (whiteNoise(2, ctx.sampleRate)), 0);
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noise;
    noiseSrc.loop = true;
    this.riserFilter = ctx.createBiquadFilter();
    this.riserFilter.type = 'bandpass';
    this.riserFilter.Q.value = 1.5;
    this.riserFilter.frequency.value = 400;
    this.riserGain = ctx.createGain();
    this.riserGain.gain.value = 0;
    noiseSrc.connect(this.riserFilter).connect(this.riserGain).connect(this.masterIn);
    noiseSrc.start();

    // --- pads
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.8;
    this.padBus.connect(this.masterIn);
    /** @type {(AudioBuffer|null)[]} */
    this.pads = BUILT_IN_PADS.map((p) => {
      const data = p.make(ctx.sampleRate);
      const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
      b.copyToChannel(/** @type {Float32Array<ArrayBuffer>} */ (data), 0);
      return b;
    });
    /** @type {(AudioBuffer|null)[]} */
    this.grabs = [null, null, null, null];

    // --- automation
    this.automation = new AutomationEngine(ctx, (t) => this.resolveParam(t), (action, plan) => this.onPlanAction(action, plan));
    /** @type {{from: DeckId, to: DeckId, preset: string, t0: number, duration: number} | null} */
    this.transition = null;

    this.recorder = new Recorder(this);
    /** @type {Worker | null} */
    this.keyWorker = null;
    /** @type {Map<number, (k: any) => void>} */
    this.keyJobs = new Map();
    this.keyJobId = 0;
  }

  /** Loads the AudioWorklet module. Call once before using decks. */
  async init() {
    try {
      await this.ctx.audioWorklet.addModule(new URL('./worklets/capture.worklet.js', import.meta.url));
      this.workletReady = true;
      Object.values(this.decks).forEach((d) => d.attachCapture());
      this.recorder.attachCapture();
    } catch (err) {
      console.warn('[AirDeck] capture worklet unavailable; loops, BPM and waveforms are off', err);
    }
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  // ------------------------------------------------------------------ mixer
  /** @param {CrossfaderCurve} curve */
  setCrossfaderCurve(curve) {
    this.settings.crossfaderCurve = curve;
    this.shaperA.curve = crossfaderShaperCurve('a', curve);
    this.shaperB.curve = crossfaderShaperCurve('b', curve);
    this.emit('change');
  }

  /** Manual crossfader move. @param {number} x 0 = A, 1 = B */
  setCrossfader(x) {
    if (this.automation.running) return;
    smoothSet(this.xfPos.offset, Math.min(1, Math.max(0, x)), this.ctx, 0.008);
  }

  get crossfader() {
    return this.xfPos.offset.value;
  }

  /** @param {number} v 0..1 */
  setMasterVolume(v) {
    smoothSet(this.volume.gain, v * v, this.ctx, 0.01);
  }

  /** @param {boolean} on */
  setAutoLevel(on) {
    this.settings.autoLevel = on;
  }

  // ------------------------------------------------------------------ transitions
  /** @param {string} target */
  resolveParam(target) {
    if (target === 'xfade') return this.xfPos.offset;
    if (target === 'riser.gain') return this.riserGain.gain;
    if (target === 'riser.freq') return this.riserFilter.frequency;
    const [deckId, name] = target.split('.');
    const deck = this.decks[/** @type {DeckId} */ (deckId)];
    return deck ? deck.param(name) : null;
  }

  /**
   * Starts a transition to `to`.
   * @param {DeckId} to
   * @param {string} presetId
   * @param {number} lengthBeats
   * @returns {string|null} error message
   */
  mixTo(to, presetId, lengthBeats) {
    const from = /** @type {DeckId} */ (to === 'A' ? 'B' : 'A');
    const preset = PRESETS_BY_ID[presetId];
    if (!preset) return 'Unknown mix style.';
    if (!this.decks[to].source) return `Load a song on Deck ${to} first.`;
    if (this.automation.running) this.automation.cancel(0.05);
    const deckX = this.decks[from];
    const bpm = deckX.effectiveBpm > 0 ? deckX.effectiveBpm : this.decks[to].effectiveBpm;
    const plan = preset.plan({
      from,
      to,
      lengthBeats,
      bpm,
      now: this.ctx.currentTime + 0.05,
      xfade: this.crossfader,
      nyquist: this.ctx.sampleRate / 2,
    });
    this.transition = { from, to, preset: presetId, t0: plan.t0, duration: plan.duration };
    this.automation.run(plan);
    this.emit('transition', this.transition);
    return null;
  }

  cancelMix() {
    if (!this.automation.running) return;
    const t = this.transition;
    this.automation.cancel(1);
    if (t) setTimeout(() => this.decks[t.from].resetAfterTransition(), 1050);
  }

  /**
   * @param {import('./transitions/common.js').PlanAction} action
   * @param {import('./transitions/common.js').Plan} _plan
   */
  onPlanAction(action, _plan) {
    const deck = action.deck ? this.decks[action.deck] : null;
    switch (action.type) {
      case 'play':
        if (deck && deck.state.video.paused) deck.play();
        break;
      case 'pause':
        deck?.pause();
        break;
      case 'resetDeck':
        deck?.resetAfterTransition();
        break;
      case 'done':
        this.transition = null;
        this.emit('transition', null);
        break;
    }
  }

  // ------------------------------------------------------------------ pads
  /** @param {AudioBuffer} buffer */
  playBuffer(buffer) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.padBus);
    src.start();
  }
  /** @param {number} i */
  triggerPad(i) {
    const b = this.pads[i];
    if (b) this.playBuffer(b);
  }
  /** @param {number} i @param {DeckId} deckId */
  grabPad(i, deckId) {
    const buf = this.decks[deckId].grab(4);
    if (!buf) return false;
    this.grabs[i] = buf;
    this.emit('change');
    return true;
  }
  /** @param {number} i */
  triggerGrab(i) {
    const b = this.grabs[i];
    if (b) this.playBuffer(b);
    return !!b;
  }

  // ------------------------------------------------------------------ analysis
  /**
   * Key detection in a Worker so the UI never stalls.
   * @param {Float32Array} mono
   * @param {number} sampleRate
   */
  detectKey(mono, sampleRate) {
    if (!this.keyWorker) {
      this.keyWorker = new Worker(new URL('../analysis/key.worker.js', import.meta.url), { type: 'module' });
      this.keyWorker.onmessage = (e) => {
        const job = this.keyJobs.get(e.data.id);
        this.keyJobs.delete(e.data.id);
        job?.(e.data.key);
      };
    }
    const id = ++this.keyJobId;
    return new Promise((resolve) => {
      this.keyJobs.set(id, resolve);
      this.keyWorker?.postMessage({ id, samples: mono, sampleRate }, [mono.buffer]);
    });
  }

  /** Master RMS / peak, 0..1. */
  masterLevel() {
    const buf = new Float32Array(this.meter.fftSize);
    this.meter.getFloatTimeDomainData(buf);
    let ms = 0;
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      ms += buf[i] * buf[i];
      peak = Math.max(peak, Math.abs(buf[i]));
    }
    return { rms: Math.sqrt(ms / buf.length), peak };
  }
}
