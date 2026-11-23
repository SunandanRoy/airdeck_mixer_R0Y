// @ts-check
/**
 * Settings, hot cues and cached analysis in chrome.storage.local (versioned).
 * Falls back to memory when chrome.storage is unavailable (tests).
 */
import { SCHEMA_VERSION } from '../shared/constants.js';

export const DEFAULT_SETTINGS = {
  crossfaderCurve: /** @type {'smooth'|'sharp'|'linear'} */ ('smooth'),
  defaultPreset: 'bassSwap',
  defaultLengthBeats: 8,
  autoLevel: true,
  recordFormat: /** @type {'webm'|'wav'} */ ('webm'),
  wideTempo: false,
  masterVolume: 0.9,
};

/** @typedef {typeof DEFAULT_SETTINGS} Settings */

const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage?.local;
/** @type {Record<string, any>} */
const memory = {};

/** @param {string[]} keys */
async function get(keys) {
  if (hasChrome) return chrome.storage.local.get(keys);
  return Object.fromEntries(keys.map((k) => [k, memory[k]]));
}
/** @param {Record<string, any>} items */
async function set(items) {
  if (hasChrome) return chrome.storage.local.set(items);
  Object.assign(memory, items);
}

/** Loads everything and migrates older shapes. */
export async function loadAll() {
  const data = await get(['schemaVersion', 'settings', 'cuesByVideoId', 'analysisByVideoId']);
  if (data.schemaVersion !== SCHEMA_VERSION) await set({ schemaVersion: SCHEMA_VERSION });
  return {
    settings: /** @type {Settings} */ ({ ...DEFAULT_SETTINGS, ...(data.settings ?? {}) }),
    cuesByVideoId: /** @type {Record<string, (number|null)[]>} */ (data.cuesByVideoId ?? {}),
    analysisByVideoId: /** @type {Record<string, {bpm?: number, key?: any, analyzedAt: number}>} */ (data.analysisByVideoId ?? {}),
  };
}

/** @param {Settings} settings */
export const saveSettings = (settings) => set({ settings });

/** @param {Record<string, (number|null)[]>} cuesByVideoId */
export const saveCues = (cuesByVideoId) => set({ cuesByVideoId });

/** Keeps the analysis cache from growing without bound. */
export function saveAnalysis(/** @type {Record<string, any>} */ analysisByVideoId) {
  const entries = Object.entries(analysisByVideoId);
  if (entries.length > 500) {
    entries.sort((a, b) => b[1].analyzedAt - a[1].analyzedAt);
    analysisByVideoId = Object.fromEntries(entries.slice(0, 400));
  }
  return set({ analysisByVideoId });
}
