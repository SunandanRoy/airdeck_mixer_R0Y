// @ts-check
/**
 * Test and demo tracks, synthesized in code (no audio files, no licences).
 * Pure functions returning stereo Float32Arrays, so they run in Node tests and
 * in the browser (the Demo page turns them into WAV blobs).
 */

/** @typedef {{name: string, label: string, bpm?: number, sampleRate: number, left: Float32Array, right: Float32Array}} Fixture */

/** Deterministic PRNG so fixtures are identical every run. */
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** @param {number} seconds @param {number} sr */
function alloc(seconds, sr) {
  const n = Math.round(seconds * sr);
  return { n, left: new Float32Array(n), right: new Float32Array(n) };
}

/** Click track at an exact tempo. */
export function clickTrack(bpm = 120, seconds = 30, sr = 44100) {
  const { n, left, right } = alloc(seconds, sr);
  const period = (60 / bpm) * sr;
  const clickLen = Math.round(0.01 * sr);
  for (let b = 0; b * period < n; b++) {
    const start = Math.round(b * period);
    const accent = b % 4 === 0 ? 0.8 : 0.5;
    for (let i = 0; i < clickLen && start + i < n; i++) {
      const env = Math.exp(-i / (0.0025 * sr));
      const s = accent * env * Math.sin((2 * Math.PI * (b % 4 === 0 ? 1500 : 1000) * i) / sr);
      left[start + i] = s;
      right[start + i] = s;
    }
  }
  return /** @type {Fixture} */ ({ name: `click${bpm}`, label: `Click ${bpm} BPM`, bpm, sampleRate: sr, left, right });
}

/** 60 Hz + 5 kHz sines at equal level: tests the Bass / Treble switches. */
export function bassHi(seconds = 10, sr = 44100) {
  const { n, left, right } = alloc(seconds, sr);
  for (let i = 0; i < n; i++) {
    const s = 0.3 * Math.sin((2 * Math.PI * 60 * i) / sr) + 0.3 * Math.sin((2 * Math.PI * 5000 * i) / sr);
    left[i] = s;
    right[i] = s;
  }
  return /** @type {Fixture} */ ({ name: 'bass_hi', label: 'Test: bass + treble tones', sampleRate: sr, left, right });
}

/** 1 kHz centre tone + 3 kHz tone hard left: tests the vocal cut. */
export function centreSide(seconds = 10, sr = 44100) {
  const { n, left, right } = alloc(seconds, sr);
  for (let i = 0; i < n; i++) {
    const c = 0.3 * Math.sin((2 * Math.PI * 1000 * i) / sr);
    const s = 0.3 * Math.sin((2 * Math.PI * 3000 * i) / sr);
    left[i] = c + s;
    right[i] = c;
  }
  return /** @type {Fixture} */ ({ name: 'centre_side', label: 'Test: centre + side tones', sampleRate: sr, left, right });
}

const midiHz = (/** @type {number} */ m) => 440 * Math.pow(2, (m - 69) / 12);

/** Am – F – C – G pads (A minor = 8A). */
export function aMinorChords(seconds = 16, sr = 44100) {
  const { n, left, right } = alloc(seconds, sr);
  const chords = [
    [57, 60, 64, 69], // Am
    [53, 57, 60, 65], // F
    [48, 55, 60, 64], // C
    [55, 59, 62, 67], // G
  ];
  const chordLen = 2 * sr;
  for (let i = 0; i < n; i++) {
    // Weighted so the tonic chord dominates, like a real song in A minor.
    const idx = Math.floor(i / chordLen) % 4;
    const notes = chords[idx];
    const pos = (i % chordLen) / chordLen;
    const env = Math.min(1, pos * 20) * Math.min(1, (1 - pos) * 20);
    const weight = idx === 0 ? 1.3 : 0.8;
    let s = 0;
    for (const m of notes) s += Math.sin((2 * Math.PI * midiHz(m) * i) / sr);
    s *= (0.12 * weight * env);
    left[i] = s;
    right[i] = s;
  }
  return /** @type {Fixture} */ ({ name: 'a_minor_chords', label: 'Test: A minor chords', sampleRate: sr, left, right });
}

/**
 * A short, song-like loop: kick, snare, hats, bass line, chord pad and a
 * centre-panned "vocal" sweep, so every switch has something to act on.
 * @param {'a'|'b'} which
 */
export function songLike(which = 'a', seconds = 40, sr = 44100) {
  const bpm = which === 'a' ? 124 : 122;
  const root = which === 'a' ? 45 : 50; // A or D
  const minor = [0, 3, 7, 10];
  const { n, left, right } = alloc(seconds, sr);
  const rand = rng(which === 'a' ? 7 : 11);
  const beat = (60 / bpm) * sr;
  const bassPattern = [0, 0, 7, 0, 10, 0, 7, 3];
  const vibrato = which === 'a' ? 5 : 4;
  for (let i = 0; i < n; i++) {
    const b = i / beat;
    const inBeat = (b % 1) * beat; // samples since beat
    const bar = Math.floor(b / 4);
    let L = 0;
    let R = 0;
    // Kick on every beat (a pitch-swept sine).
    const tk = inBeat / sr;
    if (tk < 0.25) {
      const f = 50 + 90 * Math.exp(-tk * 30);
      const k = 0.55 * Math.exp(-tk * 12) * Math.sin(2 * Math.PI * f * tk);
      L += k;
      R += k;
    }
    // Snare on 2 and 4 (noise burst).
    const beatInBar = Math.floor(b) % 4;
    if ((beatInBar === 1 || beatInBar === 3) && tk < 0.15) {
      const s = 0.22 * Math.exp(-tk * 25) * (rand() * 2 - 1);
      L += s;
      R += s;
    }
    // Hats on the off-beat 8ths, panned slightly.
    const t8 = ((b * 2) % 1) * (beat / 2) / sr;
    if (Math.floor(b * 2) % 2 === 1 && t8 < 0.04) {
      const h = 0.08 * Math.exp(-t8 * 120) * (rand() * 2 - 1);
      L += h * 1.2;
      R += h * 0.8;
    }
    // Bass line, 8th notes.
    const step = Math.floor(b * 2) % 8;
    const bf = midiHz(root - 12 + bassPattern[step]);
    const bassEnv = Math.min(1, t8 * 200) * Math.exp(-t8 * 3);
    const bass = 0.22 * bassEnv * Math.sin(2 * Math.PI * bf * (i / sr));
    L += bass;
    R += bass;
    // Pad: minor 7th chord, wide stereo.
    const chordRoot = root + [0, -4, 3, -2][bar % 4];
    let padL = 0;
    let padR = 0;
    minor.forEach((iv, j) => {
      const f = midiHz(chordRoot + 12 + iv);
      padL += Math.sin(2 * Math.PI * f * 1.002 * (i / sr) + j);
      padR += Math.sin(2 * Math.PI * f * 0.998 * (i / sr) + j * 2);
    });
    L += 0.035 * padL;
    R += 0.035 * padR;
    // "Vocal": centre-panned, vibrato sine that sings a phrase every 2 bars.
    const phrasePos = (b % 8) / 8;
    if (phrasePos < 0.75) {
      const note = root + 24 + [0, 3, 7, 5, 3, 0][Math.floor(phrasePos * 8) % 6];
      const f = midiHz(note) * (1 + 0.01 * Math.sin(2 * Math.PI * vibrato * (i / sr)));
      const env = Math.min(1, phrasePos * 40) * Math.min(1, (0.75 - phrasePos) * 40);
      const v = 0.12 * env * (Math.sin(2 * Math.PI * f * (i / sr)) + 0.3 * Math.sin(4 * Math.PI * f * (i / sr)));
      L += v;
      R += v;
    }
    left[i] = L;
    right[i] = R;
  }
  return /** @type {Fixture} */ ({
    name: `song_like_${which}`,
    label: which === 'a' ? 'Demo song A (124 BPM)' : 'Demo song B (122 BPM)',
    bpm,
    sampleRate: sr,
    left,
    right,
  });
}

/** All fixtures by name, as lazy builders. */
export const FIXTURES = {
  song_like_a: () => songLike('a'),
  song_like_b: () => songLike('b'),
  click120: () => clickTrack(120),
  click128: () => clickTrack(128),
  bass_hi: () => bassHi(),
  centre_side: () => centreSide(),
  a_minor_chords: () => aMinorChords(),
};
