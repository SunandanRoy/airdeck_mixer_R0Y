/**
 * AirDeck capture worklet.
 *
 * Collects stereo audio into chunks and posts them to the main thread together
 * with one onset-strength value per 128-frame render quantum. The main thread
 * keeps the deck ring buffer (loops, stutter, grab, waveform) and the BPM
 * tracker. Passes audio through unchanged.
 *
 * Options: { processorOptions: { chunkQuanta?: number } }
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const quanta = (options && options.processorOptions && options.processorOptions.chunkQuanta) || 8;
    this.quanta = quanta;
    this.frames = quanta * 128;
    this.left = new Float32Array(this.frames);
    this.right = new Float32Array(this.frames);
    this.onset = new Float32Array(quanta);
    this.pos = 0;
    this.q = 0;
    this.prevFull = 0;
    this.prevLow = 0;
    this.lp = 0;
    this.lpA = Math.exp((-2 * Math.PI * 150) / sampleRate);
    this.enabled = true;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'enable') this.enabled = !!e.data.value;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const n = 128;
    const l = input && input[0] ? input[0] : null;
    const r = input && input[1] ? input[1] : l;
    if (output) {
      for (let c = 0; c < output.length; c++) {
        const src = c === 0 ? l : r;
        if (src) output[c].set(src);
      }
    }
    if (!this.enabled) return true;
    let e = 0;
    let el = 0;
    const a1 = this.lpA;
    let lp = this.lp;
    for (let i = 0; i < n; i++) {
      const a = l ? l[i] : 0;
      const b = r ? r[i] : 0;
      this.left[this.pos + i] = a;
      this.right[this.pos + i] = b;
      const m = 0.5 * (a + b);
      e += m * m;
      lp = (1 - a1) * m + a1 * lp;
      el += lp * lp;
    }
    this.lp = lp;
    // Same formula as onsetEnvelope() in src/analysis/bpm.js.
    const lf = Math.log(1e-9 + e / n);
    const ll = Math.log(1e-9 + el / n);
    this.onset[this.q] = 0.5 * Math.max(0, lf - this.prevFull) + 0.5 * Math.max(0, ll - this.prevLow);
    this.prevFull = lf;
    this.prevLow = ll;
    this.pos += n;
    this.q++;
    if (this.q >= this.quanta) {
      this.port.postMessage({ left: this.left, right: this.right, onset: this.onset, frame: currentFrame }, [
        this.left.buffer,
        this.right.buffer,
        this.onset.buffer,
      ]);
      this.left = new Float32Array(this.frames);
      this.right = new Float32Array(this.frames);
      this.onset = new Float32Array(this.quanta);
      this.pos = 0;
      this.q = 0;
    }
    return true;
  }
}

registerProcessor('airdeck-capture', CaptureProcessor);
