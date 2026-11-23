// @ts-check
/**
 * Live scrolling waveform drawn from a deck's ring buffer peaks, with beat
 * ticks when the tempo is known. The newest audio is at the right edge.
 */
import { PEAK_BLOCK } from '../audio/ringbuffer.js';

export class Waveform {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../audio/deck.js').Deck} deck
   * @param {string} color
   */
  constructor(canvas, deck, color, seconds = 8) {
    this.canvas = canvas;
    this.deck = deck;
    this.color = color;
    this.seconds = seconds;
    this.ctx2d = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    this.lastTotal = -1;
  }

  draw() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const hgt = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== hgt) {
      c.width = w;
      c.height = hgt;
      this.lastTotal = -1;
    }
    const ring = this.deck.ring;
    if (ring.total === this.lastTotal) return;
    this.lastTotal = ring.total;
    const g = this.ctx2d;
    g.clearRect(0, 0, w, hgt);
    const count = Math.round((this.seconds * ring.sampleRate) / PEAK_BLOCK);
    const peaks = ring.recentPeaks(count);
    const mid = hgt / 2;
    g.fillStyle = this.color;
    const barW = w / count;
    for (let i = 0; i < peaks.length; i++) {
      const x = w - (peaks.length - i) * barW;
      const amp = Math.min(1, peaks[i] * 1.2) * (mid - 2);
      g.globalAlpha = 0.35 + 0.65 * (i / peaks.length);
      g.fillRect(x, mid - amp, Math.max(1, barW + 0.5), amp * 2 || 1);
    }
    g.globalAlpha = 1;
    // Beat ticks
    const bpm = this.deck.effectiveBpm;
    if (bpm > 0 && ring.filled > ring.sampleRate) {
      const phase = this.deck.beatPhaseNow();
      if (Number.isFinite(phase)) {
        const beat = 60 / bpm;
        const pxPerSec = w / this.seconds;
        g.fillStyle = 'rgba(255,255,255,0.55)';
        for (let t = phase; t < this.seconds; t += beat) {
          const x = w - t * pxPerSec;
          g.fillRect(Math.round(x), 0, Math.max(1, dpr), 6 * dpr);
          g.fillRect(Math.round(x), hgt - 6 * dpr, Math.max(1, dpr), 6 * dpr);
        }
      }
    }
    // "Now" marker
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(w - 2 * dpr, 0, 2 * dpr, hgt);
  }
}
