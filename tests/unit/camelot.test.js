import { describe, it, expect } from 'vitest';
import { toCamelot, formatKey, keysCompatible, keyMatchShift } from '../../src/analysis/camelot.js';
import { detectKey } from '../../src/analysis/key.js';
import { aMinorChords } from '../../src/harness/fixtures.js';

const k = (tonic, mode) => ({ tonic, mode });

describe('camelot', () => {
  it('maps the wheel', () => {
    expect(toCamelot(k(9, 'minor'))).toEqual({ number: 8, letter: 'A' });
    expect(toCamelot(k(0, 'major'))).toEqual({ number: 8, letter: 'B' });
    expect(toCamelot(k(4, 'minor'))).toEqual({ number: 9, letter: 'A' });
    expect(toCamelot(k(7, 'major'))).toEqual({ number: 9, letter: 'B' });
    expect(toCamelot(k(5, 'major'))).toEqual({ number: 7, letter: 'B' });
    expect(toCamelot(k(11, 'major'))).toEqual({ number: 1, letter: 'B' });
    expect(toCamelot(k(8, 'minor'))).toEqual({ number: 1, letter: 'A' });
    expect(formatKey(k(9, 'minor'))).toBe('8A (A minor)');
  });
  it('compatibility', () => {
    expect(keysCompatible(k(9, 'minor'), k(0, 'major'))).toBe(true); // 8A/8B
    expect(keysCompatible(k(9, 'minor'), k(4, 'minor'))).toBe(true); // 8A/9A
    expect(keysCompatible(k(9, 'minor'), k(8, 'minor'))).toBe(false); // 8A/1A
  });
  it('key match shift picks the smallest move', () => {
    expect(keyMatchShift(k(9, 'minor'), k(9, 'minor'))).toBe(0);
    // Ab minor (1A) -> +1 = A minor (8A)
    expect(keyMatchShift(k(9, 'minor'), k(8, 'minor'))).toBe(1);
    const s = keyMatchShift(k(0, 'major'), k(6, 'major'));
    expect(s === null || Math.abs(s) <= 2).toBe(true);
  });
});

describe('key detection', () => {
  it('A minor chords -> 8A', () => {
    const f = aMinorChords(16, 11025);
    const { key } = detectKey(f.left, 11025);
    expect(formatKey(key)).toBe('8A (A minor)');
  });
});
