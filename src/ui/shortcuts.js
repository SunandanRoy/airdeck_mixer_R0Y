// @ts-check
/**
 * Mixer keyboard shortcuts. Ignored while typing in a text field or select.
 */

/** [key, description] pairs shown in the Help dialog. */
export const SHORTCUTS = [
  ['Q  W  E', 'Deck A: Bass, Vocals, Treble on/off (hold Shift to solo)'],
  ['U  I  O', 'Deck B: Bass, Vocals, Treble on/off (hold Shift to solo)'],
  ['R / P', 'Hold for Echo on Deck A / Deck B'],
  ['Z / M', 'Play or pause Deck A / Deck B'],
  ['Space', 'Mix to the other deck (again to cancel)'],
  ['← →', 'Move the mix slider'],
  ['1 – 4', 'Deck A hot cues'],
  ['7 – 0', 'Deck B hot cues'],
  ['?', 'This help'],
];

/**
 * @param {{engine: import('../audio/engine.js').AudioEngine, mix: () => void, toast: (m: string) => void, help: () => void}} opts
 */
export function installShortcuts({ engine, mix, help }) {
  const A = engine.decks.A;
  const B = engine.decks.B;
  /** @type {Record<string, [import('../audio/deck.js').Deck, import('../audio/deck.js').PillId]>} */
  const pills = { q: [A, 'bass'], w: [A, 'vocals'], e: [A, 'treble'], u: [B, 'bass'], i: [B, 'vocals'], o: [B, 'treble'] };
  /** @type {Record<string, [import('../audio/deck.js').Deck, number]>} */
  const cues = { 1: [A, 0], 2: [A, 1], 3: [A, 2], 4: [A, 3], 7: [B, 0], 8: [B, 1], 9: [B, 2], 0: [B, 3] };

  const typing = (/** @type {EventTarget|null} */ t) => {
    if (!(t instanceof HTMLElement)) return false;
    if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
    if (t.tagName === 'INPUT') return !['range', 'checkbox', 'button'].includes(/** @type {HTMLInputElement} */ (t).type);
    return false;
  };

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    if (document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (pills[k] && !e.repeat) {
      const [deck, pill] = pills[k];
      if (e.shiftKey) deck.soloPill(pill);
      else deck.togglePill(pill);
    } else if ((k === 'r' || k === 'p') && !e.repeat) {
      (k === 'r' ? A : B).setFx('echo', true);
    } else if (k === 'z' && !e.repeat) {
      A.togglePlay();
    } else if (k === 'm' && !e.repeat) {
      B.togglePlay();
    } else if (k === ' ') {
      if (!e.repeat) mix();
    } else if (k === 'arrowleft' || k === 'arrowright') {
      if (/** @type {HTMLElement} */ (e.target).tagName === 'INPUT') return;
      engine.setCrossfader(engine.crossfader + (k === 'arrowleft' ? -0.05 : 0.05));
    } else if (cues[k] && !e.repeat) {
      const [deck, i] = cues[k];
      deck.cue(i);
    } else if (e.key === '?') {
      help();
    } else {
      return;
    }
    e.preventDefault();
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'r' || k === 'p') (k === 'r' ? A : B).setFx('echo', false);
  });
}
