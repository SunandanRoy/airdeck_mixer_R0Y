// @ts-check
/**
 * The deck card: track info, transport, sound switches, cues, loops, FX,
 * filter, tempo and volume. Renders from Deck state; never touches audio
 * nodes directly.
 */
import { h, setText, fmtTime, onPress } from './dom.js';
import { Knob } from './knob.js';
import { Waveform } from './waveform.js';
import { FX_PADS } from '../audio/fx/index.js';
import { formatKey } from '../analysis/camelot.js';
import { DECK_COLORS, TEMPO_RANGE_DEFAULT, TEMPO_RANGE_WIDE } from '../shared/constants.js';

/** @typedef {import('../audio/deck.js').Deck} Deck */
/** @typedef {import('../audio/deck.js').PillId} PillId */

const PILLS = /** @type {{id: PillId, label: string, tipOff: string, ai?: boolean, approx?: boolean}[]} */ ([
  { id: 'bass', label: 'Bass', tipOff: 'Bass off: removes the thump. Hold to hear only the bass.' },
  { id: 'vocals', label: 'Vocals', tipOff: 'Vocals off (approx.): removes sound panned to the centre, usually the singer. Hold to hear mostly vocals.', approx: true },
  { id: 'drums', label: 'Drums', tipOff: 'Needs AI Stems (coming in a later version).', ai: true },
  { id: 'melody', label: 'Melody', tipOff: 'Needs AI Stems (coming in a later version).', ai: true },
  { id: 'treble', label: 'Treble', tipOff: 'Treble off: removes hi-hats and sparkle. Hold to hear only the treble.' },
]);

const PILL_KEYS = { A: ['Q', 'W', null, null, 'E'], B: ['U', 'I', null, null, 'O'] };

export class DeckView {
  /**
   * @param {Deck} deck
   * @param {{toast: (msg: string, kind?: 'info'|'error') => void, other: () => Deck, mode: 'tab'|'demo', onEject: () => void, onLoadDemo?: (deckId: string) => void, settings: {wideTempo: boolean}}} ctx
   */
  constructor(deck, ctx) {
    this.deck = deck;
    this.ctx = ctx;
    const id = deck.id;
    this.dirty = true;

    // ---------------------------------------------------------------- header + track
    this.thumb = /** @type {HTMLImageElement} */ (h('img.thumb', { alt: '', referrerPolicy: 'no-referrer', draggable: false }));
    this.thumb.addEventListener('error', () => this.thumb.classList.add('hidden'));
    this.title = h('div.track-title');
    this.artist = h('div.track-artist');
    this.ejectBtn = h('button.icon-btn.eject', { title: 'Eject: give this tab its sound back', attrs: { 'aria-label': `Eject Deck ${id}` }, onclick: () => ctx.onEject(), text: '⏏' });
    this.adChip = h('span.chip.warn.hidden', { text: 'Ad playing — muted' });

    const emptyText =
      ctx.mode === 'demo'
        ? h('p', {}, 'Pick a demo track or one of your own audio files.')
        : h('p', {}, 'Open a YouTube video and press ', h('kbd', { text: id === 'A' ? 'Alt+Shift+1' : 'Alt+Shift+2' }), ', or click the AirDeck icon on that tab.');
    this.empty = h('div.deck-empty', {}, h('div.empty-dot'), emptyText);
    if (ctx.mode === 'demo' && ctx.onLoadDemo) {
      this.empty.append(h('button.btn.small', { text: 'Choose a track…', onclick: () => ctx.onLoadDemo?.(id) }));
    }

    // ---------------------------------------------------------------- info row
    this.bpmText = h('button.bpm', { title: 'Beats per minute. Click to detect again.', onclick: () => deck.redetect() });
    this.keyText = h('span.key', { title: 'Musical key (Camelot code). Songs with the same or neighbouring numbers sound good together.' });
    this.tapBtn = h('button.btn.small', { text: 'Tap', title: 'Tap along to the beat to set the speed by hand.', onclick: () => deck.tap() });
    this.syncBtn = h('button.btn.small.sync', {
      text: 'Sync',
      title: 'Match the speed of the other song.',
      onclick: () => {
        const err = deck.syncTo(ctx.other());
        if (err) ctx.toast(err, 'error');
      },
    });

    // ---------------------------------------------------------------- waveform + transport
    this.canvas = /** @type {HTMLCanvasElement} */ (h('canvas.waveform', { attrs: { 'aria-hidden': 'true' } }));
    this.waveform = new Waveform(this.canvas, deck, DECK_COLORS[id]);
    this.playBtn = h('button.play', { attrs: { 'aria-label': 'Play or pause' }, onclick: () => deck.togglePlay() });
    this.seek = /** @type {HTMLInputElement} */ (h('input.seek', { type: 'range', min: 0, max: 1000, value: 0, attrs: { 'aria-label': 'Position' } }));
    this.seeking = false;
    this.seek.addEventListener('pointerdown', () => (this.seeking = true));
    this.seek.addEventListener('change', () => {
      const d = deck.state.video.duration;
      if (d > 0) deck.seek((Number(this.seek.value) / 1000) * d);
      this.seeking = false;
    });
    this.elapsed = h('span.time');
    this.remaining = h('span.time.remaining');

    // ---------------------------------------------------------------- pills
    this.pillEls = PILLS.map((p, i) => {
      const key = PILL_KEYS[id][i];
      const el = h(`button.pill${p.ai ? '.unavailable' : ''}`, {
        title: p.tipOff + (key ? ` (key ${key})` : ''),
        attrs: { 'aria-pressed': 'true', 'aria-disabled': p.ai ? 'true' : 'false' },
      });
      el.append(h('span.pill-label', { text: p.label }));
      if (p.approx) el.append(h('span.pill-note', { text: 'approx.' }));
      if (p.ai) el.append(h('span.pill-note', { text: 'AI' }));
      onPress(el, {
        tap: (e) => {
          if (p.ai) return ctx.toast('Drums and Melody need AI Stems, which is coming in a later version. Bass, Vocals and Treble work now.');
          if (/** @type {any} */ (e).shiftKey) deck.soloPill(p.id);
          else deck.togglePill(p.id);
        },
        long: p.ai ? undefined : () => deck.soloPill(p.id),
      });
      return { def: p, el };
    });
    this.stemsToggle = h('label.toggle.disabled', { title: 'AI Stems separates drums, bass, melody and vocals with an AI model on your graphics card. Coming in a later version.' },
      h('input', { type: 'checkbox', disabled: true }),
      h('span.toggle-track'),
      h('span', { text: 'AI Stems' }),
      h('span.chip.soon', { text: 'soon' }),
    );

    // ---------------------------------------------------------------- cues + loops
    this.cueEls = [0, 1, 2, 3].map((i) => {
      const el = h('button.cue', { text: String(i + 1), title: 'Hot cue: tap to save this spot, tap again to jump back to it. Hold to clear.' });
      onPress(el, { tap: () => deck.cue(i), long: () => deck.clearCue(i), longMs: 600 });
      return el;
    });
    this.loopEls = [1, 2, 4, 8].map((beats) => {
      const el = h('button.loop', {
        text: String(beats),
        title: `Loop the last ${beats} beat${beats > 1 ? 's' : ''}. Tap again to carry on.`,
        onclick: () => {
          const err = deck.toggleLoop(beats);
          if (err) ctx.toast(err, 'error');
        },
      });
      el.dataset.beats = String(beats);
      return el;
    });

    // ---------------------------------------------------------------- FX
    this.fxEls = FX_PADS.map((fx) => {
      const el = h('button.fx', { text: fx.label, title: `${fx.tip} Hold for a moment; double-tap to keep it on.` });
      let latched = false;
      let lastUp = 0;
      let ignoreUp = false;
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        el.setPointerCapture(e.pointerId);
        const fxId = /** @type {any} */ (fx.id);
        if (latched) {
          latched = false;
          ignoreUp = true;
          deck.setFx(fxId, false);
        } else {
          ignoreUp = false;
          if (performance.now() - lastUp < 300) latched = true;
          deck.setFx(fxId, true);
        }
        el.classList.toggle('latched', latched);
      });
      el.addEventListener('pointerup', () => {
        lastUp = performance.now();
        if (!latched && !ignoreUp) deck.setFx(/** @type {any} */ (fx.id), false);
        el.classList.toggle('latched', latched);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        latched = !latched;
        deck.setFx(/** @type {any} */ (fx.id), latched);
        el.classList.toggle('latched', latched);
      });
      el.dataset.fx = fx.id;
      return el;
    });
    this.fxAmount = new Knob({ label: 'Amount', value: deck.state.fxAmount, def: 0.6, tip: 'How strong the FX are.', format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => deck.setFxAmount(v) });

    // ---------------------------------------------------------------- knobs + sliders
    this.filterKnob = new Knob({
      label: 'Filter',
      min: -1,
      max: 1,
      value: 0,
      def: 0,
      step: 0.01,
      bipolar: true,
      tip: 'Turn left to make it muffled, right to make it thin. Double-click to reset.',
      format: (v) => (Math.abs(v) < 0.03 ? 'Off' : v < 0 ? `Low ${Math.round(-v * 100)}` : `High ${Math.round(v * 100)}`),
      onInput: (v) => deck.setFilter(v),
    });
    this.volumeKnob = new Knob({ label: 'Volume', value: 1, def: 1, tip: 'This deck’s volume.', format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => deck.setFader(v) });

    this.tempo = /** @type {HTMLInputElement} */ (h('input.tempo', { type: 'range', min: -1000, max: 1000, value: 0, step: 1, attrs: { 'aria-label': 'Tempo' } }));
    this.tempo.addEventListener('input', () => deck.setTempo((Number(this.tempo.value) / 1000) * this.tempoRange()));
    this.tempo.addEventListener('dblclick', () => deck.setTempo(0));
    this.tempoText = h('span.tempo-text');
    const nudge = (/** @type {-1|1} */ dir, /** @type {string} */ label, /** @type {string} */ tip) => {
      const el = h('button.btn.small.nudge', { text: label, title: tip, attrs: { 'aria-label': tip } });
      el.addEventListener('pointerdown', () => deck.nudge(dir));
      const up = () => deck.nudge(0);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointerleave', up);
      return el;
    };

    // ---------------------------------------------------------------- advanced
    const levelSlider = (/** @type {'bass'|'mid'|'treble'} */ band, /** @type {string} */ label) => {
      const input = /** @type {HTMLInputElement} */ (h('input', { type: 'range', min: 0, max: 150, value: 100, attrs: { 'aria-label': `${label} level` } }));
      input.addEventListener('input', () => deck.setLevel(band, Number(input.value) / 100));
      input.addEventListener('dblclick', () => {
        input.value = '100';
        deck.setLevel(band, 1);
      });
      return h('label.level', {}, h('span', { text: label }), input);
    };
    this.trimText = h('span.muted');
    this.advanced = h('details.advanced', {},
      h('summary', { text: 'Advanced' }),
      h('div.adv-grid', {},
        levelSlider('bass', 'Bass level'),
        levelSlider('mid', 'Mid level'),
        levelSlider('treble', 'Treble level'),
        h('div.adv-row', {}, h('span', { text: 'Auto level:' }), this.trimText),
      ),
    );

    this.message = h('div.deck-message', { attrs: { role: 'status', 'aria-live': 'polite' } });

    // ---------------------------------------------------------------- assemble
    this.el = h(`section.deck.deck-${id.toLowerCase()}`, { attrs: { 'aria-label': `Deck ${id}` } },
      h('header.deck-head', {},
        h('span.deck-tag', { text: `Deck ${id}` }),
        this.adChip,
        h('span.spacer'),
        this.ejectBtn,
      ),
      this.empty,
      h('div.deck-body', {},
        h('div.track', {}, h('div.thumb-wrap', {}, this.thumb), h('div.track-text', {}, this.title, this.artist)),
        h('div.info-row', {}, this.bpmText, h('span.dot-sep', { text: '·' }), this.keyText, h('span.spacer'), this.tapBtn, this.syncBtn),
        this.canvas,
        h('div.transport', {}, this.playBtn, this.elapsed, this.seek, this.remaining),
        h('div.section-label', { text: 'Sound switches' }),
        h('div.pills', {}, ...this.pillEls.map((p) => p.el)),
        h('div.row.between', {}, this.stemsToggle, h('span.hint', { text: 'Tap = off · Hold = only this' })),
        h('div.row.split', {},
          h('div.group', {}, h('div.section-label', { text: 'Hot cues' }), h('div.cues', {}, ...this.cueEls)),
          h('div.group', {}, h('div.section-label', { text: 'Loop (beats)' }), h('div.loops', {}, ...this.loopEls)),
        ),
        h('div.section-label', { text: 'FX' }),
        h('div.fx-row', {}, h('div.fx-grid', {}, ...this.fxEls), this.fxAmount.el),
        h('div.controls', {},
          this.filterKnob.el,
          h('div.tempo-box', {},
            h('div.tempo-head', {}, h('span.knob-label', { text: 'Tempo' }), this.tempoText),
            this.tempo,
            h('div.nudges', {}, nudge(-1, '◀', 'Nudge: slow down a moment to line up the beats'), nudge(1, '▶', 'Nudge: speed up a moment to line up the beats')),
          ),
          this.volumeKnob.el,
        ),
        this.advanced,
        this.message,
      ),
    );

    deck.on('change', () => (this.dirty = true));
  }

  tempoRange() {
    return this.ctx.settings.wideTempo ? TEMPO_RANGE_WIDE : TEMPO_RANGE_DEFAULT;
  }

  /** @param {string} text @param {'info'|'error'} [kind] */
  say(text, kind = 'info') {
    this.message.textContent = text;
    this.message.className = `deck-message ${kind}`;
  }

  /** Called every animation frame. */
  frame() {
    this.waveform.draw();
    const d = this.deck;
    const s = d.state;
    const v = s.video;
    // Position updates every frame while playing.
    const pos = d.position();
    setText(this.elapsed, fmtTime(pos));
    setText(this.remaining, `-${fmtTime(Math.max(0, v.duration - pos))}`);
    if (!this.seeking && v.duration > 0) this.seek.value = String(Math.round((pos / v.duration) * 1000));
    if (!this.dirty) return;
    this.dirty = false;

    const loaded = s.status === 'ready';
    this.el.classList.toggle('is-empty', !loaded);
    this.el.classList.toggle('is-playing', loaded && !v.paused);
    if (s.status === 'closed') this.say('Tab closed.', 'error');

    // Track
    setText(this.title, s.meta.song || s.meta.title || '');
    setText(this.artist, s.meta.artist || s.meta.channel || '');
    if (s.meta.thumbnailUrl) {
      if (this.thumb.src !== s.meta.thumbnailUrl) {
        this.thumb.classList.remove('hidden');
        this.thumb.src = s.meta.thumbnailUrl;
      }
    } else {
      this.thumb.classList.add('hidden');
    }
    this.adChip.classList.toggle('hidden', !v.adShowing);

    // BPM / key
    const b = s.bpm;
    if (b.effective > 0) {
      setText(this.bpmText, `${b.effective.toFixed(1)} BPM`);
      this.bpmText.classList.remove('detecting');
      this.bpmText.title = `${b.source === 'tap' ? 'Tapped' : b.source === 'cache' ? 'Remembered' : 'Detected'}: ${b.base.toFixed(1)} BPM at normal speed. Click to detect again.`;
    } else {
      setText(this.bpmText, loaded ? (v.paused ? 'Press play to find the beat' : 'Finding the beat…') : '— BPM');
      this.bpmText.classList.add('detecting');
    }
    setText(this.keyText, s.key ? formatKey(s.key) : loaded ? 'Key: listening…' : 'Key —');

    // Transport
    setText(this.playBtn, v.paused ? '▶' : '❚❚');
    this.playBtn.classList.toggle('playing', !v.paused);

    // Pills
    for (const { def, el } of this.pillEls) {
      if (def.ai) continue;
      const on = /** @type {any} */ (s.pills)[def.id];
      const solo = s.solo === def.id;
      const mutedBySolo = s.solo !== null && !solo;
      el.classList.toggle('off', !on || mutedBySolo);
      el.classList.toggle('solo', solo);
      el.setAttribute('aria-pressed', String(on && !mutedBySolo));
    }

    // Cues / loops / FX
    this.cueEls.forEach((el, i) => {
      const c = s.cues[i];
      el.classList.toggle('set', c !== null && c !== undefined);
      el.title = c !== null && c !== undefined ? `Cue ${i + 1} at ${fmtTime(c)}. Tap to jump, hold to clear.` : 'Hot cue: tap to save this spot. Hold to clear.';
    });
    this.loopEls.forEach((el) => el.classList.toggle('active', s.loop === Number(el.dataset.beats)));
    this.fxEls.forEach((el) => el.classList.toggle('on', /** @type {any} */ (s.fx)[el.dataset.fx ?? '']));

    // Knobs and sliders follow state (e.g. after Sync)
    this.filterKnob.set(s.filter);
    this.volumeKnob.set(s.fader);
    const range = this.tempoRange();
    this.tempo.value = String(Math.round((s.tempo / range) * 1000));
    setText(this.tempoText, `${s.tempo >= 0 ? '+' : ''}${(s.tempo * 100).toFixed(1)}%`);
    setText(this.trimText, `${s.trimDb >= 0 ? '+' : ''}${s.trimDb.toFixed(1)} dB`);
  }
}
