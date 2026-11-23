// @ts-check
/**
 * Records the master output (after the limiter) as .webm (Opus) via
 * MediaRecorder, or as .wav via the capture worklet.
 */
import { encodeWav } from '../shared/wav.js';
import { Emitter } from '../shared/emitter.js';

export class Recorder extends Emitter {
  /** @param {import('./engine.js').AudioEngine} engine */
  constructor(engine) {
    super();
    this.engine = engine;
    const ctx = /** @type {AudioContext} */ (engine.ctx);
    /** @type {MediaStreamAudioDestinationNode | null} */
    this.dest = typeof ctx.createMediaStreamDestination === 'function' ? ctx.createMediaStreamDestination() : null;
    if (this.dest) engine.masterOut.connect(this.dest);
    /** @type {MediaRecorder | null} */
    this.mr = null;
    /** @type {Blob[]} */
    this.chunks = [];
    /** @type {Float32Array[][]} */
    this.pcm = [[], []];
    this.format = /** @type {'webm'|'wav'} */ ('webm');
    this.startedAt = 0;
    this.recording = false;
  }

  attachCapture() {
    const ctx = this.engine.ctx;
    this.capture = new AudioWorkletNode(ctx, 'airdeck-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      processorOptions: { chunkQuanta: 32 },
    });
    this.capture.port.postMessage({ type: 'enable', value: false });
    this.engine.masterOut.connect(this.capture);
    this.capture.connect(this.engine.sink);
    this.capture.port.onmessage = (e) => {
      if (!this.recording || this.format !== 'wav') return;
      this.pcm[0].push(e.data.left);
      this.pcm[1].push(e.data.right);
    };
  }

  get elapsed() {
    return this.recording ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  /** @param {'webm'|'wav'} format */
  start(format = 'webm') {
    if (this.recording) return;
    this.format = format === 'wav' && this.capture ? 'wav' : 'webm';
    this.chunks = [];
    this.pcm = [[], []];
    if (this.format === 'webm') {
      if (!this.dest) return;
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      this.mr = new MediaRecorder(this.dest.stream, { mimeType: mime, audioBitsPerSecond: 256000 });
      this.mr.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
      this.mr.start(1000);
    } else {
      this.capture?.port.postMessage({ type: 'enable', value: true });
    }
    this.startedAt = performance.now();
    this.recording = true;
    this.emit('change');
  }

  /** Stops and resolves with the recording as a Blob. */
  async stop() {
    if (!this.recording) return null;
    this.recording = false;
    this.emit('change');
    if (this.format === 'wav') {
      this.capture?.port.postMessage({ type: 'enable', value: false });
      const join = (/** @type {Float32Array[]} */ parts) => {
        const n = parts.reduce((a, p) => a + p.length, 0);
        const out = new Float32Array(n);
        let o = 0;
        for (const p of parts) {
          out.set(p, o);
          o += p.length;
        }
        return out;
      };
      const wav = encodeWav([join(this.pcm[0]), join(this.pcm[1])], this.engine.ctx.sampleRate);
      this.pcm = [[], []];
      return new Blob([wav], { type: 'audio/wav' });
    }
    const mr = this.mr;
    if (!mr) return null;
    await new Promise((resolve) => {
      mr.onstop = resolve;
      mr.stop();
    });
    this.mr = null;
    return new Blob(this.chunks, { type: 'audio/webm' });
  }
}
