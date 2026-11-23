// @ts-check
/**
 * Tiny DOM helpers (no framework, so the extension loads with no build step).
 */

/**
 * Creates an element. `sel` is "tag.class1.class2#id".
 * Props starting with "on" become listeners; `dataset`, `style` (object),
 * `attrs` and `text` are handled specially; everything else is set as a property.
 * @param {string} sel
 * @param {Record<string, any>} [props]
 * @param {...(Node|string|null|undefined|false)} children
 * @returns {HTMLElement}
 */
export function h(sel, props = {}, ...children) {
  const m = sel.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const tag = m?.[1] || 'div';
  const el = document.createElement(tag);
  const rest = m?.[2] ?? '';
  for (const part of rest.match(/[.#][\w-]+/g) ?? []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'attrs') for (const [a, av] of Object.entries(v)) el.setAttribute(a, String(av));
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'class') el.className = String(v);
    else /** @type {any} */ (el)[k] = v;
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Sets text only when it changed (avoids layout churn at 60 fps). */
export function setText(/** @type {Element} */ el, /** @type {string} */ text) {
  if (el.textContent !== text) el.textContent = text;
}

/** Formats seconds as m:ss. */
export function fmtTime(/** @type {number} */ s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Press handler that tells a tap from a long-press.
 * @param {HTMLElement} el
 * @param {{tap?: (e: PointerEvent) => void, long?: () => void, down?: (e: PointerEvent) => void, up?: (e: PointerEvent) => void, longMs?: number}} handlers
 */
export function onPress(el, { tap, long, down, up, longMs = 450 }) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let fired = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    fired = false;
    down?.(e);
    if (long) {
      timer = setTimeout(() => {
        fired = true;
        el.classList.add('long-fired');
        setTimeout(() => el.classList.remove('long-fired'), 300);
        long();
      }, longMs);
    }
  });
  const end = (/** @type {PointerEvent} */ e, /** @type {boolean} */ cancelled) => {
    if (timer) clearTimeout(timer);
    timer = null;
    up?.(e);
    if (!fired && !cancelled && tap) tap(e);
    fired = true;
  };
  el.addEventListener('pointerup', (e) => end(e, false));
  el.addEventListener('pointerleave', (e) => {
    if (!fired) end(e, true);
  });
  // Keyboard access: Enter/Space = tap, Shift+Enter = long-press.
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey && long) long();
    else tap?.(/** @type {any} */ (e));
  });
}
