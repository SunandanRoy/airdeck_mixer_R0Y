// @ts-check
/**
 * One deck: its audio chain, its analysis (BPM, key, loudness, waveform) and
 * its user-facing state (switches, tempo, cues, loops, FX).
 *
 *  source → in → life → trim ─┬─► capture worklet (ring buffer, onsets)
 *                              └─► ad → gate → pre ◄── loop/stutter players
 *  pre → (normal | vocal cut) → isolator → filter → FX → time machine
 *      → fader → [meter] → xf (crossfader gain) → master
 */
import { Emitter } from '../shared/emitter.js';
import { Isolator, VocalCut, FilterKnob } from './nodes.js';
import { Echo, Reverb, FilterSweep, Flanger, LoFi, Telephone } from './fx/index.js';
import { RingBuffer, makeSeamless } from './ringbuffer.js';
import { BpmTracker, bpmFromTaps, syncRate } from '../analysis/bpm.js';
import { smoothSet, hold } from './automation.js';
import { dbToGain } from './curves.js';
import { cleanTitle } from '../analysis/titleClean.js';
import { livePosition } from '../sources/sources.js';
import {
  RING_SECONDS,
  LEVEL_TARGET_LUFS,
  LEVEL_TRIM_MIN_DB,
  LEVEL_TRIM_MAX_DB,
  LEVEL_MAX_DB_PER_SEC,
  RATE_MIN,
  RATE_MAX,
} from '../shared/constants.js';

/** @typedef {import('../shared/constants.js').DeckId} DeckId */
/** @typedef {'bass'|'vocals'|'drums'|'melody'|'treble'} PillId */
/** @typedef {'echo'|'reverb'|'sweep'|'flanger'|'lofi'|'telephone'|'stutter'} FxId */

const LEVEL_TICK_MS = 250;

export function initialDeckState() {
  return {
    /** @type {'empty'|'ready'|'closed'} */
    status: 'empty',
    /** @type {'tab'|'file'|null} */
    sourceKind: null,
    message: '',
    meta: { title: '', channel: '', thumbnailUrl: '', videoId: /** @type {string|null} */ (null), artist: '', song: '' },
    video: { currentTime: 0, duration: 0, paused: true, rate: 1, adShowing: false },
    pills: { bass: true, vocals: true, treble: true },
    /** @type {PillId|null} */
    solo: null,
    levels: { bass: 1, mid: 1, treble: 1 },
    filter: 0,
    fader: 1,
    tempo: 0,
    bpm: { base: NaN, effective: NaN, stable: false, source: /** @type {'auto'|'tap'|'cache'} */ ('auto') },
    /** @type {import('../analysis/camelot.js').Key | null} */
    key: null,
    /** @type {Record<FxId, boolean>} */
    fx: { echo: false, reverb: false, sweep: false, flanger: false, lofi: false, telephone: false, stutter: false },
    fxAmount: 0.6,
    /** @type {(number|null)[]} */
    cues: [null, null, null, null],
    /** @type {number|null} */
    loop: null,
    trimDb: 0,
  };
}

export class Deck extends Emitter {
  /**
   * @param {import('./engine.js').AudioEngine} engine
   * @param {DeckId} id
   */
  constructor(engine, id) {
    super();
    this.engine = engine;
    this.id = id;
    const ctx = engine.ctx;
    this.ctx = ctx;
    this.state = initialDeckState();
    /** @type {any} */
    this.source = null;

    // --- input and level match
    this.in = ctx.createGain();
    this.life = ctx.createGain();
    this.life.gain.value = 0;
    this.trim = ctx.createGain();
    this.in.connect(this.life).connect(this.trim);
    const kHp = ctx.createBiquadFilter();
    kHp.type = 'highpass';
    kHp.frequency.value = 60;
    const kShelf = ctx.createBiquadFilter();
    kShelf.type = 'highshelf';
    kShelf.frequency.value = 1500;
    kShelf.gain.value = 4;
    this.loudness = ctx.createAnalyser();
    this.loudness.fftSize = 8192;
    this.life.connect(kHp).connect(kShelf).connect(this.loudness);
    /** @type {number[]} */
    this.loudHistory = [];

    // --- capture (ring buffer + onsets)
    this.ring = new RingBuffer(ctx.sampleRate, RING_SECONDS);
    this.bpmTracker = new BpmTracker(ctx.sampleRate / 128);
    this.framesSinceLoad = 0;
    this.keyRequested = false;
    if (engine.workletReady) this.attachCapture();

    // --- main path
    this.ad = ctx.createGain();
    this.gate = ctx.createGain();
    this.pre = ctx.createGain();
    this.trim.connect(this.ad).connect(this.gate).connect(this.pre);
    this.loopBus = ctx.createGain();
    this.loopBus.connect(this.pre);

    this.normal = ctx.createGain();
    this.vcGain = ctx.createGain();
    this.vcGain.gain.value = 0;
    this.vocalCut = new VocalCut(ctx);
    this.iso = new Isolator(ctx);
    this.pre.connect(this.normal).connect(this.iso.input);
    this.pre.connect(this.vocalCut.input);
    this.vocalCut.output.connect(this.vcGain).connect(this.iso.input);

    this.filter = new FilterKnob(ctx);
    this.iso.output.connect(this.filter.input);

    this.fxNodes = {
      telephone: new Telephone(ctx),
      lofi: new LoFi(ctx),
      sweep: new FilterSweep(ctx),
      flanger: new Flanger(ctx),
      echo: new Echo(ctx),
      reverb: new Reverb(ctx),
    };
    /** @type {AudioNode} */
    let tail = this.filter.output;
    for (const fx of Object.values(this.fxNodes)) {
      tail.connect(fx.input);
      tail = fx.output;
    }
    this.tm = ctx.createDelay(4);
    this.tm.delayTime.value = 0;
    tail.connect(this.tm);

    this.fader = ctx.createGain();
    this.tm.connect(this.fader);
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 1024;
    this.fader.connect(this.meter);
    this.xf = ctx.createGain();
    this.xf.gain.value = 0; // driven by the crossfader shaper + override
    this.fader.connect(this.xf);
    this.xfOverride = ctx.createConstantSource();
    this.xfOverride.offset.value = 0;
    this.xfOverride.connect(this.xf.gain);
    this.xfOverride.start();

    /** @type {AudioBufferSourceNode | null} */
    this.loopPlayer = null;
    /** @type {GainNode | null} */
    this.loopGain = null;
    this.nudging = 0;
    /** @type {number[]} */
    this.taps = [];
    /** @type {{phase: number, total: number} | null} */
    this.beatInfo = null;

    this.levelTimer = setInterval(() => this.levelTick(), LEVEL_TICK_MS);
    this.bpmTimer = setInterval(() => this.bpmTick(), 1000);
  }

  /** Called by the engine once the worklet module has loaded. */
  attachCapture() {
    if (this.capture) return;
    this.capture = new AudioWorkletNode(this.ctx, 'airdeck-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      processorOptions: { chunkQuanta: 8 },
    });
    this.trim.connect(this.capture);
    this.capture.connect(this.engine.sink);
    this.capture.port.onmessage = (e) => {
      const { left, right, onset } = e.data;
      // While paused the tab is silent: keep the last real audio for loops and grabs.
      if (!this.source || (this.state.video.paused && !this.loopPlayer)) return;
      this.ring.push(left, right);
      if (!this.state.video.adShowing && !this.loopPlayer) {
        this.bpmTracker.push(onset);
        this.framesSinceLoad += left.length;
        this.maybeDetectKey();
      }
    };
  }

  // ------------------------------------------------------------------ helpers
  get effectiveBpm() {
    return this.state.bpm.effective;
  }
  get rate() {
    return 1 + this.state.tempo;
  }
  changed() {
    this.emit('change', this.state);
  }

  // ------------------------------------------------------------------ source
  /** @param {any} source a DeckSource */
  attach(source) {
    if (this.source) this.detach(0.05);
    this.source = source;
    source.node.connect(this.in);
    this.state.status = 'ready';
    this.state.sourceKind = source.kind;
    this.state.message = '';
    this.resetAnalysis();
    this.state.tempo = 0;
    this.state.cues = [null, null, null, null];
    smoothSet(this.life.gain, 1, this.ctx, 0.02);
    source.on('state', (/** @type {any} */ s) => this.onVideoState(s));
    source.on('meta', (/** @type {any} */ m) => this.onMeta(m));
    source.on('ended', () => this.onSourceEnded());
    source.setPitchLock?.(true);
    source.setBadge?.(`On Deck ${this.id}`);
    this.changed();
  }

  /** Fades out and releases the source. */
  detach(fade = 1, status = /** @type {'empty'|'closed'} */ ('empty')) {
    const src = this.source;
    if (!src) return;
    this.source = null;
    this.stopLoop(true);
    hold(this.life.gain, this.ctx.currentTime);
    this.life.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fade);
    setTimeout(() => src.dispose(), fade * 1000 + 100);
    this.state.status = status;
    this.state.message = status === 'closed' ? 'Tab closed' : '';
    this.changed();
  }

  onSourceEnded() {
    this.detach(1, 'closed');
    this.emit('released');
  }

  /** @param {any} s */
  onVideoState(s) {
    const v = this.state.video;
    const wasAd = v.adShowing;
    Object.assign(v, s);
    if (s.adShowing !== wasAd) {
      smoothSet(this.ad.gain, s.adShowing ? 0 : 1, this.ctx, 0.02);
    }
    // Keep the player at the tempo we asked for (YouTube resets it sometimes).
    if (this.source?.kind === 'tab' && !s.adShowing && Math.abs(s.rate - this.currentRate()) > 0.001) {
      this.source.setRate(this.currentRate());
    }
    this.changed();
  }

  /** @param {any} m */
  onMeta(m) {
    const prevId = this.state.meta.videoId;
    const { artist, title } = cleanTitle(m.title, m.channel);
    this.state.meta = { ...m, artist, song: title };
    if (m.videoId && prevId && m.videoId !== prevId) {
      // Same tab, new video: start fresh.
      this.resetAnalysis();
      this.state.cues = [null, null, null, null];
    }
    if (m.videoId && m.videoId !== prevId) this.emit('track', m.videoId);
    this.source?.setBadge?.(`On Deck ${this.id}`);
    this.changed();
  }

  resetAnalysis() {
    this.bpmTracker.reset();
    this.ring.clear();
    this.framesSinceLoad = 0;
    this.keyRequested = false;
    this.taps = [];
    this.loudHistory = [];
    this.state.bpm = { base: NaN, effective: NaN, stable: false, source: 'auto' };
    this.state.key = null;
    this.beatInfo = null;
  }

  // ------------------------------------------------------------------ transport
  play() {
    this.source?.play();
  }
  pause() {
    this.source?.pause();
  }
  togglePlay() {
    if (this.state.video.paused) this.play();
    else this.pause();
  }
  /** @param {number} t */
  seek(t) {
    this.source?.seek(Math.max(0, Math.min(t, this.state.video.duration || t)));
  }
  position() {
    return this.source ? livePosition(this.source) : 0;
  }

  currentRate() {
    return Math.min(RATE_MAX, Math.max(RATE_MIN, this.rate * (1 + this.nudging)));
  }

  /** @param {number} tempo fraction, e.g. 0.04 = +4% */
  setTempo(tempo) {
    this.state.tempo = Math.min(RATE_MAX - 1, Math.max(RATE_MIN - 1, tempo));
    this.source?.setRate(this.currentRate());
    this.updateEffectiveBpm();
    this.changed();
  }

  /** Nudge: briefly speed up (+1) or slow down (-1) by 2%; 0 to release. */
  nudge(/** @type {-1|0|1} */ dir) {
    this.nudging = dir * 0.02;
    this.source?.setRate(this.currentRate());
  }

  updateEffectiveBpm() {
    const b = this.state.bpm;
    b.effective = b.base > 0 ? Math.round(b.base * this.rate * 10) / 10 : NaN;
  }

  /** @param {number} base @param {'auto'|'tap'|'cache'} source */
  setBaseBpm(base, source) {
    this.state.bpm.base = base;
    this.state.bpm.stable = true;
    this.state.bpm.source = source;
    this.updateEffectiveBpm();
    this.changed();
    this.emit('analysis');
  }

  /** "Tap" button: average the last taps. */
  tap() {
    const now = performance.now() / 1000;
    if (this.taps.length && now - this.taps[this.taps.length - 1] > 2) this.taps = [];
    this.taps.push(now);
    const eff = bpmFromTaps(this.taps);
    if (eff > 0) this.setBaseBpm(eff / this.rate, 'tap');
    return this.taps.length;
  }

  /** Re-run automatic detection. */
  redetect() {
    this.bpmTracker.reset();
    this.state.bpm = { base: NaN, effective: NaN, stable: false, source: 'auto' };
    this.changed();
  }

  /**
   * Match this deck's tempo to another deck. Returns a message on failure.
   * @param {Deck} other
   */
  syncTo(other) {
    if (!(other.effectiveBpm > 0)) return `Deck ${other.id} has no beat yet.`;
    if (!(this.state.bpm.base > 0)) return `Deck ${this.id} has no beat yet — tap the Tap button to the rhythm.`;
    const r = syncRate(other.effectiveBpm, this.state.bpm.base, RATE_MAX - 1);
    if (r === null) return 'These songs are too far apart in speed to sync.';
    this.setTempo(r - 1);
    return null;
  }

  bpmTick() {
    if (!this.source || this.state.video.paused) return;
    if (this.effectiveBpm > 0 && this.bpmTracker.filled > this.bpmTracker.frameRate * 4) {
      this.beatInfo = { phase: this.bpmTracker.phase(this.effectiveBpm), total: this.ring.total };
    }
    if (this.state.bpm.stable) return;
    const { bpm, stable } = this.bpmTracker.update(performance.now() / 1000);
    if (stable && bpm > 0) this.setBaseBpm(bpm / this.currentRate(), 'auto');
  }

  /** Seconds since the last beat at the newest audio in the ring (NaN if unknown). */
  beatPhaseNow() {
    const eff = this.effectiveBpm;
    if (!(eff > 0) || !this.beatInfo) return NaN;
    const beat = 60 / eff;
    const t = this.beatInfo.phase + (this.ring.total - this.beatInfo.total) / this.ctx.sampleRate;
    return ((t % beat) + beat) % beat;
  }

  maybeDetectKey() {
    if (this.keyRequested || this.framesSinceLoad < this.ctx.sampleRate * 30) return;
    this.keyRequested = true;
    const [l, r] = this.ring.last(this.ctx.sampleRate * 30);
    const factor = 4;
    const mono = new Float32Array(Math.floor(l.length / factor));
    for (let i = 0; i < mono.length; i++) {
      let s = 0;
      for (let j = 0; j < factor; j++) s += l[i * factor + j] + r[i * factor + j];
      mono[i] = s / (2 * factor);
    }
    this.engine.detectKey(mono, this.ctx.sampleRate / factor).then((key) => {
      if (!key || !this.source) return;
      this.state.key = key;
      this.changed();
      this.emit('analysis');
    });
  }

  // ------------------------------------------------------------------ level match
  levelTick() {
    if (!this.source) return;
    if (!this.engine.settings.autoLevel) {
      if (this.state.trimDb !== 0) this.applyTrim(0);
      return;
    }
    if (this.state.video.paused || this.state.video.adShowing) return;
    const buf = new Float32Array(this.loudness.fftSize);
    this.loudness.getFloatTimeDomainData(buf);
    let ms = 0;
    for (let i = 0; i < buf.length; i++) ms += buf[i] * buf[i];
    ms /= buf.length;
    if (ms < 1e-6) return; // gate: below -60 dB is silence
    this.loudHistory.push(ms);
    const maxLen = Math.round(10000 / LEVEL_TICK_MS);
    if (this.loudHistory.length > maxLen) this.loudHistory.shift();
    if (this.loudHistory.length < 8) return;
    const mean = this.loudHistory.reduce((a, b) => a + b, 0) / this.loudHistory.length;
    const lufs = -0.691 + 10 * Math.log10(mean);
    const target = Math.min(LEVEL_TRIM_MAX_DB, Math.max(LEVEL_TRIM_MIN_DB, LEVEL_TARGET_LUFS - lufs));
    const step = (LEVEL_MAX_DB_PER_SEC * LEVEL_TICK_MS) / 1000;
    const cur = this.state.trimDb;
    const next = cur + Math.max(-step, Math.min(step, target - cur));
    if (Math.abs(next - cur) > 0.01) this.applyTrim(next);
  }

  /** @param {number} db */
  applyTrim(db) {
    this.state.trimDb = db;
    smoothSet(this.trim.gain, dbToGain(db), this.ctx, 0.08);
  }

  // ------------------------------------------------------------------ switches
  /** Band gains and vocal-cut mix for the current pill state. */
  bandTargets() {
    const { pills, solo, levels } = this.state;
    let low = pills.bass ? levels.bass : 0;
    let mid = levels.mid;
    let high = pills.treble ? levels.treble : 0;
    let cut = !pills.vocals;
    if (solo === 'bass') [low, mid, high, cut] = [levels.bass, 0, 0, false];
    else if (solo === 'treble') [low, mid, high, cut] = [0, 0, levels.treble, false];
    else if (solo === 'vocals') [low, mid, high, cut] = [0, levels.mid, 0, false];
    return { low, mid, high, cut };
  }

  applyBands() {
    const t = this.bandTargets();
    this.iso.setBands(t);
    smoothSet(this.normal.gain, t.cut ? 0 : 1, this.ctx);
    smoothSet(this.vcGain.gain, t.cut ? 1 : 0, this.ctx);
  }

  /** Tap a pill: turn that part off/on. @param {PillId} pill */
  togglePill(pill) {
    if (pill === 'drums' || pill === 'melody') return false; // needs AI Stems
    if (this.state.solo) this.state.solo = null;
    else this.state.pills[pill] = !this.state.pills[pill];
    this.applyBands();
    this.changed();
    return true;
  }

  /** Long-press a pill: solo it (press again to release). @param {PillId} pill */
  soloPill(pill) {
    if (pill === 'drums' || pill === 'melody') return false;
    this.state.solo = this.state.solo === pill ? null : pill;
    this.applyBands();
    this.changed();
    return true;
  }

  /** @param {'bass'|'mid'|'treble'} band @param {number} level */
  setLevel(band, level) {
    this.state.levels[band] = level;
    this.applyBands();
    this.changed();
  }

  /** @param {number} k */
  setFilter(k) {
    this.state.filter = k;
    this.filter.set(k);
    this.changed();
  }

  /** @param {number} v */
  setFader(v) {
    this.state.fader = v;
    smoothSet(this.fader.gain, v * v, this.ctx, 0.01); // squared = natural-feeling taper
    this.changed();
  }

  // ------------------------------------------------------------------ FX
  /** @param {FxId} id @param {boolean} on */
  setFx(id, on) {
    if (this.state.fx[id] === on) return;
    this.state.fx[id] = on;
    if (id === 'stutter') {
      if (on) this.startLoop(0.25, false);
      else this.stopLoop(false);
    } else {
      this.fxNodes[id].setOn(on, this.state.fxAmount, this.effectiveBpm);
    }
    this.changed();
  }

  /** @param {number} amount 0..1 */
  setFxAmount(amount) {
    this.state.fxAmount = amount;
    for (const [id, node] of Object.entries(this.fxNodes)) {
      if (this.state.fx[/** @type {FxId} */ (id)]) node.setOn(true, amount, this.effectiveBpm);
    }
    this.changed();
  }

  // ------------------------------------------------------------------ loops
  /**
   * Starts looping the last `beats` beats from the ring buffer.
   * @param {number} beats
   * @param {boolean} pauseVideo true for Loop (song waits), false for Stutter (song runs on underneath)
   * @returns {string|null} error message
   */
  startLoop(beats, pauseVideo) {
    const eff = this.effectiveBpm;
    if (!(eff > 0)) return 'Loops need the beat — wait for the BPM or use Tap.';
    const sr = this.ctx.sampleRate;
    const frames = Math.round((beats * 60 * sr) / eff);
    const fade = Math.round(0.005 * sr);
    if (this.ring.filled < frames + fade) return 'Play a little more of the song first.';
    this.stopLoop(true);
    const [l, r] = this.ring.last(frames + fade);
    const [sl, sr2] = makeSeamless(l, r, fade);
    const buffer = this.ctx.createBuffer(2, sl.length, sr);
    buffer.copyToChannel(sl, 0);
    buffer.copyToChannel(sr2, 1);
    const player = this.ctx.createBufferSource();
    player.buffer = buffer;
    player.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    player.connect(g).connect(this.loopBus);
    const now = this.ctx.currentTime;
    player.start(now);
    g.gain.setTargetAtTime(1, now, 0.002);
    hold(this.gate.gain, now);
    this.gate.gain.setTargetAtTime(0, now, 0.002);
    this.loopPlayer = player;
    this.loopGain = g;
    if (pauseVideo) {
      this.state.loop = beats;
      this.loopPausedVideo = !this.state.video.paused;
      this.pause();
    }
    this.changed();
    return null;
  }

  /** @param {boolean} immediate skip waiting for the video to resume */
  stopLoop(immediate) {
    const player = this.loopPlayer;
    const g = this.loopGain;
    if (!player || !g) return;
    this.loopPlayer = null;
    this.loopGain = null;
    const wasLoop = this.state.loop !== null;
    this.state.loop = null;
    const finish = () => {
      const now = this.ctx.currentTime;
      hold(g.gain, now);
      g.gain.setTargetAtTime(0, now, 0.002);
      hold(this.gate.gain, now);
      this.gate.gain.setTargetAtTime(1, now, 0.002);
      player.stop(now + 0.05);
    };
    if (wasLoop && this.loopPausedVideo && !immediate) {
      this.play();
      // Keep the loop running until the video is actually playing again.
      const started = performance.now();
      const wait = () => {
        if (!this.state.video.paused || performance.now() - started > 600) setTimeout(finish, 60);
        else setTimeout(wait, 20);
      };
      wait();
    } else {
      finish();
    }
    this.changed();
  }

  /** @param {number} beats */
  toggleLoop(beats) {
    if (this.state.loop === beats) {
      this.stopLoop(false);
      return null;
    }
    return this.startLoop(beats, true);
  }

  /** Last `beats` beats as an AudioBuffer (for Grab pads). */
  grab(beats = 4) {
    const eff = this.effectiveBpm;
    const seconds = eff > 0 ? (beats * 60) / eff : 2;
    const [l, r] = this.ring.last(seconds * this.ctx.sampleRate);
    if (l.length < this.ctx.sampleRate * 0.25) return null;
    const buf = this.ctx.createBuffer(2, l.length, this.ctx.sampleRate);
    buf.copyToChannel(l, 0);
    buf.copyToChannel(r, 1);
    return buf;
  }

  // ------------------------------------------------------------------ cues
  /** Tap: save or jump. @param {number} i */
  cue(i) {
    const c = this.state.cues[i];
    if (c === null || c === undefined) {
      this.state.cues[i] = Math.round(this.position() * 100) / 100;
      this.emit('cues');
    } else {
      this.seek(c);
    }
    this.changed();
  }
  /** Long-press: clear. @param {number} i */
  clearCue(i) {
    this.state.cues[i] = null;
    this.emit('cues');
    this.changed();
  }

  // ------------------------------------------------------------------ automation reset
  /** Restores every param a transition may have moved to the deck's UI state. */
  resetAfterTransition() {
    const now = this.ctx.currentTime;
    const params = [
      this.fader.gain,
      this.tm.delayTime,
      this.xfOverride.offset,
      this.fxNodes.echo.send.gain,
      this.fxNodes.echo.dry.gain,
      this.fxNodes.echo.feedback.gain,
      this.filter.lp.frequency,
      this.filter.hp.frequency,
      this.iso.low.gain,
      this.iso.mid.gain,
      this.iso.high.gain,
    ];
    params.forEach((p) => hold(p, now));
    this.tm.delayTime.setValueAtTime(0, now + 0.02);
    this.xfOverride.offset.setTargetAtTime(0, now, 0.01);
    this.fxNodes.echo.dry.gain.setTargetAtTime(1, now, 0.01);
    this.fxNodes.echo.feedback.gain.setTargetAtTime(0.5, now, 0.01);
    this.fxNodes.echo.send.gain.setTargetAtTime(this.state.fx.echo ? this.state.fxAmount : 0, now, 0.01);
    // Fader returns after the time-machine jump so it is never heard.
    this.fader.gain.setValueAtTime(this.fader.gain.value, now + 0.03);
    this.fader.gain.setTargetAtTime(this.state.fader * this.state.fader, now + 0.03, 0.01);
    this.filter.set(this.state.filter);
    this.applyBands();
  }

  /** Param lookup for the automation engine. @param {string} name */
  param(name) {
    switch (name) {
      case 'low':
        return this.iso.low.gain;
      case 'mid':
        return this.iso.mid.gain;
      case 'high':
        return this.iso.high.gain;
      case 'fader':
        return this.fader.gain;
      case 'xfOverride':
        return this.xfOverride.offset;
      case 'lp':
        return this.filter.lp.frequency;
      case 'hp':
        return this.filter.hp.frequency;
      case 'echoSend':
        return this.fxNodes.echo.send.gain;
      case 'echoDry':
        return this.fxNodes.echo.dry.gain;
      case 'echoFeedback':
        return this.fxNodes.echo.feedback.gain;
      case 'echoTime':
        return this.fxNodes.echo.delay.delayTime;
      case 'tm':
        return this.tm.delayTime;
      default:
        return null;
    }
  }

  /** RMS and peak of the channel (post-fader), 0..1. */
  level() {
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

  dispose() {
    clearInterval(this.levelTimer);
    clearInterval(this.bpmTimer);
    this.detach(0.01);
  }
}
