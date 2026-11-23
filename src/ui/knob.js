// @ts-check
/**
 * Rotary knob. Drag up/down, scroll, or use the arrow keys. Double-click resets.
 * Accessible as role="slider".
 */
import { h } from './dom.js';

export class Knob {
  /**
   * @param {{label: string, min?: number, max?: number, value?: number, def?: number, step?: number,
   *          bipolar?: boolean, tip?: string, format?: (v: number) => string, onInput: (v: number) => void}} opts
   */
  constructor(opts) {
    this.min = opts.min ?? 0;
    this.max = opts.max ?? 1;
    this.def = opts.def ?? opts.value ?? this.min;
    this.value = opts.value ?? this.def;
    this.step = opts.step ?? (this.max - this.min) / 100;
    this.bipolar = !!opts.bipolar;
    this.format = opts.format ?? ((v) => v.toFixed(2));
    this.onInput = opts.onInput;

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    svg.setAttribute('aria-hidden', 'true');
    const track = document.createElementNS(ns, 'path');
    track.setAttribute('class', 'knob-track');
    track.setAttribute('d', arc(24, 24, 18, -135, 135));
    this.arc = document.createElementNS(ns, 'path');
    this.arc.setAttribute('class', 'knob-value');
    this.pointer = document.createElementNS(ns, 'line');
    this.pointer.setAttribute('class', 'knob-pointer');
    this.pointer.setAttribute('x1', '24');
    this.pointer.setAttribute('y1', '24');
    svg.append(track, this.arc, this.pointer);

    this.dial = h('div.knob-dial', {
      tabIndex: 0,
      attrs: { role: 'slider', 'aria-label': opts.label, 'aria-valuemin': this.min, 'aria-valuemax': this.max },
    });
    this.dial.append(svg);
    this.readout = h('span.knob-readout');
    this.el = h('div.knob', { title: opts.tip ?? '' }, this.dial, h('span.knob-label', { text: opts.label }), this.readout);

    let startY = 0;
    let startV = 0;
    this.dial.addEventListener('pointerdown', (e) => {
      this.dial.setPointerCapture(e.pointerId);
      startY = e.clientY;
      startV = this.value;
      this.dial.classList.add('dragging');
    });
    this.dial.addEventListener('pointermove', (e) => {
      if (!this.dial.hasPointerCapture(e.pointerId)) return;
      const range = this.max - this.min;
      const fine = e.shiftKey ? 0.25 : 1;
      this.set(startV + ((startY - e.clientY) / 160) * range * fine, true);
    });
    const end = (/** @type {PointerEvent} */ e) => {
      if (this.dial.hasPointerCapture(e.pointerId)) this.dial.releasePointerCapture(e.pointerId);
      this.dial.classList.remove('dragging');
    };
    this.dial.addEventListener('pointerup', end);
    this.dial.addEventListener('pointercancel', end);
    this.dial.addEventListener('dblclick', () => this.set(this.def, true));
    this.dial.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.set(this.value - Math.sign(e.deltaY) * this.step * 2, true);
      },
      { passive: false },
    );
    this.dial.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'ArrowUp' || k === 'ArrowRight') this.set(this.value + this.step, true);
      else if (k === 'ArrowDown' || k === 'ArrowLeft') this.set(this.value - this.step, true);
      else if (k === 'Home' || k === 'Delete' || k === 'Backspace') this.set(this.def, true);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    this.render();
  }

  /** @param {number} v @param {boolean} [emit] */
  set(v, emit = false) {
    const snapped = Math.round(Math.min(this.max, Math.max(this.min, v)) / this.step) * this.step;
    const nv = Math.min(this.max, Math.max(this.min, snapped));
    if (nv === this.value && !emit) return;
    this.value = nv;
    this.render();
    if (emit) this.onInput(nv);
  }

  render() {
    const t = (this.value - this.min) / (this.max - this.min);
    const angle = -135 + 270 * t;
    const from = this.bipolar ? 0 : -135;
    this.arc.setAttribute('d', Math.abs(angle - from) < 0.5 ? '' : arc(24, 24, 18, Math.min(from, angle), Math.max(from, angle)));
    const rad = ((angle - 90) * Math.PI) / 180;
    this.pointer.setAttribute('x2', String(24 + 13 * Math.cos(rad)));
    this.pointer.setAttribute('y2', String(24 + 13 * Math.sin(rad)));
    this.readout.textContent = this.format(this.value);
    this.dial.setAttribute('aria-valuenow', String(this.value));
    this.dial.setAttribute('aria-valuetext', this.format(this.value));
    this.el.classList.toggle('active', this.bipolar ? Math.abs(this.value - this.def) > this.step / 2 : t > 0);
  }
}

/** SVG arc path from angle a0 to a1 (degrees, 0 = up, clockwise). */
function arc(/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ r, /** @type {number} */ a0, /** @type {number} */ a1) {
  const p = (/** @type {number} */ a) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}
