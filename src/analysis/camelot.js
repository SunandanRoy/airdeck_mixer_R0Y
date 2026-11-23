// @ts-check
/**
 * Musical keys and the Camelot wheel, used for "Key match".
 *
 * A key is { tonic: 0-11 (C = 0), mode: 'major' | 'minor' }.
 */

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** @typedef {{tonic: number, mode: 'major' | 'minor'}} Key */
/** @typedef {{number: number, letter: 'A' | 'B'}} Camelot */

/**
 * Camelot code for a key. Minor = A, major = B. Moving up a fifth (+7
 * semitones) moves one step clockwise. A minor = 8A, C major = 8B.
 * @param {Key} key
 * @returns {Camelot}
 */
export function toCamelot(key) {
  const ref = key.mode === 'minor' ? 9 : 0; // A minor / C major sit at 8
  const steps = (((key.tonic - ref) * 7) % 12 + 12) % 12;
  return { number: ((steps + 7) % 12) + 1, letter: key.mode === 'minor' ? 'A' : 'B' };
}

/** @param {Key} key e.g. "8A (A minor)" */
export function formatKey(key) {
  const c = toCamelot(key);
  return `${c.number}${c.letter} (${NOTE_NAMES[key.tonic]} ${key.mode})`;
}

/**
 * True if two keys mix well: same code, same number (relative major/minor), or
 * one step around the wheel with the same letter.
 * @param {Key} x
 * @param {Key} y
 */
export function keysCompatible(x, y) {
  const a = toCamelot(x);
  const b = toCamelot(y);
  if (a.number === b.number) return true;
  if (a.letter !== b.letter) return false;
  const d = Math.abs(a.number - b.number);
  return d === 1 || d === 11;
}

/**
 * Smallest pitch shift in semitones, within ±maxShift, that makes Y compatible
 * with X. Returns 0 if already compatible and null if no shift works.
 * @param {Key} x
 * @param {Key} y
 */
export function keyMatchShift(x, y, maxShift = 2) {
  const order = [0];
  for (let s = 1; s <= maxShift; s++) order.push(s, -s);
  for (const s of order) {
    const shifted = { tonic: (((y.tonic + s) % 12) + 12) % 12, mode: y.mode };
    if (keysCompatible(x, shifted)) return s;
  }
  return null;
}
