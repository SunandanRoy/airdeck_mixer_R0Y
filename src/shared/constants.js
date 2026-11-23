// @ts-check
/**
 * Shared constants. Plain values only, so this file can be imported from the
 * service worker, extension pages, worklets and Node unit tests alike.
 */

/** @typedef {'A' | 'B'} DeckId */

/** @type {DeckId[]} */
export const DECK_IDS = ['A', 'B'];

export const DECK_COLORS = /** @type {const} */ ({ A: '#22d3ee', B: '#f472d0' });

/** Tempo slider ranges (fraction of 1.0). */
export const TEMPO_RANGE_DEFAULT = 0.08;
export const TEMPO_RANGE_WIDE = 0.16;
export const RATE_MIN = 1 - TEMPO_RANGE_WIDE; // 0.84
export const RATE_MAX = 1 + TEMPO_RANGE_WIDE; // 1.16

/** BPM detection folds results into this range. */
export const BPM_MIN = 70;
export const BPM_MAX = 180;

/** Isolator crossover points (Hz). */
export const ISO_LOW_HZ = 250;
export const ISO_HIGH_HZ = 2500;
/** Vocal-cut keeps everything below this untouched (Hz). */
export const VOCALCUT_SPLIT_HZ = 150;

/** Shortest ramp for any audible parameter change (seconds). */
export const MIN_RAMP = 0.005;
/** Time constant used for pill kills (15 ms ramp). */
export const KILL_RAMP = 0.015;

/** Auto level match. */
export const LEVEL_TARGET_LUFS = -14;
export const LEVEL_TRIM_MIN_DB = -12;
export const LEVEL_TRIM_MAX_DB = 6;
export const LEVEL_MAX_DB_PER_SEC = 1;

/** Ring buffer length per deck (seconds). */
export const RING_SECONDS = 60;

/** Transition lengths offered in the UI (beats). */
export const TRANSITION_LENGTHS = [4, 8, 16, 32];

/** When BPM is unknown, 1 beat is treated as this many seconds (8 beats = 4 s). */
export const FALLBACK_BEAT_SECONDS = 0.5;

/** Storage schema version for chrome.storage.local. */
export const SCHEMA_VERSION = 1;

/** Ports and message names (see messages.js). */
export const DECK_PORT_NAME = 'airdeck-deck';

/** Pages. */
export const MIXER_PATH = 'src/mixer/mixer.html';
