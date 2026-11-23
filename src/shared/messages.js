// @ts-check
/**
 * Typed message protocol between the service worker, the Mixer page and the
 * YouTube content script. See docs/ARCHITECTURE.md for the flow.
 *
 * Runtime messages (chrome.runtime.sendMessage):
 *   ASSIGN_REQUEST  popup        -> SW      { deckId, tabId }
 *   MIXER_READY     Mixer        -> SW      {}
 *   DECK_ASSIGN     SW           -> Mixer   { deckId, tabId, streamId }
 *   ASSIGN_ERROR    SW           -> Mixer   { deckId, tabId, message }
 *   DECK_RELEASE    Mixer        -> SW      { deckId }
 *   DECK_REGISTRY   Mixer        -> SW      { decks: Record<DeckId, number|null> }
 *   TAB_CLOSED      SW           -> Mixer   { tabId }
 *   WHO_AM_I        content      -> SW      {}  -> { deckId|null }
 *   GET_STATUS      popup        -> SW      {}  -> { mixerOpen, decks }
 *   OPEN_MIXER      popup        -> SW      {}
 *
 * Tab messages (chrome.tabs.sendMessage, SW/Mixer -> content):
 *   DECK_ATTACH     { deckId }   content opens a port to the Mixer
 *   DECK_DETACH     {}           content removes its badge and closes the port
 *
 * Port messages (content <-> Mixer over chrome.runtime.connect, name DECK_PORT_NAME):
 *   HELLO           content -> Mixer  { deckId }
 *   VIDEO_STATE     content -> Mixer  { currentTime, duration, paused, rate, adShowing, videoId }
 *   TRACK_META      content -> Mixer  { title, channel, thumbnailUrl, videoId }
 *   VIDEO_CMD       Mixer -> content  { cmd: 'play'|'pause'|'seek'|'rate'|'pitchLock', value? }
 *   BADGE           Mixer -> content  { deckId, label }
 */

export const MSG = /** @type {const} */ ({
  ASSIGN_REQUEST: 'ASSIGN_REQUEST',
  MIXER_READY: 'MIXER_READY',
  DECK_ASSIGN: 'DECK_ASSIGN',
  ASSIGN_ERROR: 'ASSIGN_ERROR',
  DECK_RELEASE: 'DECK_RELEASE',
  DECK_REGISTRY: 'DECK_REGISTRY',
  TAB_CLOSED: 'TAB_CLOSED',
  WHO_AM_I: 'WHO_AM_I',
  GET_STATUS: 'GET_STATUS',
  OPEN_MIXER: 'OPEN_MIXER',
  DECK_ATTACH: 'DECK_ATTACH',
  DECK_DETACH: 'DECK_DETACH',
  HELLO: 'HELLO',
  VIDEO_STATE: 'VIDEO_STATE',
  TRACK_META: 'TRACK_META',
  VIDEO_CMD: 'VIDEO_CMD',
  BADGE: 'BADGE',
});

/**
 * @typedef {Object} VideoState
 * @property {number} currentTime
 * @property {number} duration
 * @property {boolean} paused
 * @property {number} rate
 * @property {boolean} adShowing
 * @property {string|null} videoId
 */

/**
 * @typedef {Object} TrackMeta
 * @property {string} title
 * @property {string} channel
 * @property {string} thumbnailUrl
 * @property {string|null} videoId
 */

/** True when a URL is a YouTube page AirDeck can put on a deck. */
export function isYouTubeUrl(/** @type {string|undefined} */ url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'www.youtube.com' || u.hostname === 'm.youtube.com' || u.hostname === 'music.youtube.com');
  } catch {
    return false;
  }
}
