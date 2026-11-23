// @ts-check
/** Minimal event emitter. */
export class Emitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();
  }
  /**
   * @param {string} event
   * @param {Function} fn
   * @returns {() => void} unsubscribe
   */
  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event)?.add(fn);
    return () => this._handlers.get(event)?.delete(fn);
  }
  /** @param {string} event @param {...unknown} args */
  emit(event, ...args) {
    this._handlers.get(event)?.forEach((fn) => {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[AirDeck] handler for "${event}" failed`, err);
      }
    });
  }
}
