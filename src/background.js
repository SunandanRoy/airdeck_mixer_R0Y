// @ts-check
/**
 * AirDeck service worker.
 *
 * Owns: keyboard commands, popup requests, minting tab-capture stream IDs for
 * the Mixer tab, and a small deck registry (deckId <-> tabId). It holds no
 * audio and no long-lived state: everything it needs survives in
 * chrome.storage.session because Chrome may stop it at any time.
 */
import { MSG, isYouTubeUrl } from './shared/messages.js';
import { MIXER_PATH } from './shared/constants.js';

/** @typedef {import('./shared/constants.js').DeckId} DeckId */
/** @typedef {{mixerTabId: number|null, decks: Record<DeckId, number|null>, pending: {deckId: DeckId, tabId: number}[]}} Registry */

const MIXER_URL = chrome.runtime.getURL(MIXER_PATH);

/** @returns {Promise<Registry>} */
async function getReg() {
  const { reg } = await chrome.storage.session.get('reg');
  return reg ?? { mixerTabId: null, decks: { A: null, B: null }, pending: [] };
}
/** @param {Registry} reg */
async function setReg(reg) {
  await chrome.storage.session.set({ reg });
}

/** @returns {Promise<chrome.tabs.Tab | null>} */
async function findMixerTab() {
  const tabs = await chrome.tabs.query({ url: `${MIXER_URL}*` });
  return tabs[0] ?? null;
}

/** Opens the Mixer, or focuses it if it is already open. */
async function openMixer(focus = true) {
  const existing = await findMixerTab();
  if (existing?.id !== undefined) {
    if (focus) {
      await chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
    }
    return { tab: existing, created: false };
  }
  const tab = await chrome.tabs.create({ url: MIXER_URL, active: true, pinned: false });
  return { tab, created: true };
}

/** Makes sure our content script is in the tab (tabs opened before install). */
async function ensureContentScript(/** @type {number} */ tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/youtube.js'] });
  }
}

/**
 * Promise wrapper for chrome.tabCapture.getMediaStreamId.
 * @param {number} targetTabId
 * @param {number} consumerTabId
 * @returns {Promise<string>}
 */
function mintStreamId(targetTabId, consumerTabId) {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId, consumerTabId }, (id) => {
      const err = chrome.runtime.lastError;
      if (err || !id) reject(new Error(err?.message ?? 'No stream ID'));
      else resolve(id);
    });
  });
}

/**
 * Mints a stream ID for `tabId` that only the Mixer tab can use, and hands it
 * to the Mixer.
 * @param {DeckId} deckId
 * @param {number} tabId
 * @param {number} mixerTabId
 */
async function deliver(deckId, tabId, mixerTabId) {
  try {
    const streamId = await mintStreamId(tabId, mixerTabId);
    await chrome.runtime.sendMessage({ type: MSG.DECK_ASSIGN, deckId, tabId, streamId });
    await chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});
    return { ok: true };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const message = /invoked|activeTab|permission/i.test(raw)
      ? 'Click the AirDeck icon on that tab, then choose a deck — Chrome needs a click to share tab audio.'
      : /active stream/i.test(raw)
        ? 'That tab is already being shared. Eject it from its deck first.'
        : `Couldn't capture that tab: ${raw}`;
    chrome.runtime.sendMessage({ type: MSG.ASSIGN_ERROR, deckId, tabId, message }).catch(() => {});
    return { ok: false, message };
  }
}

/**
 * Sends a tab to a deck. Called from the popup or a keyboard command, both of
 * which count as "invoking" the extension on that tab, which tabCapture needs.
 * @param {DeckId} deckId
 * @param {number} tabId
 */
async function assign(deckId, tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !isYouTubeUrl(tab.url)) return { ok: false, message: 'Open a YouTube video in this tab first.' };
  const reg = await getReg();
  const other = deckId === 'A' ? 'B' : 'A';
  if (reg.decks[other] === tabId) return { ok: false, message: `This tab is already on Deck ${other}.` };
  if (reg.decks[deckId] === tabId) {
    await openMixer(true);
    return { ok: true, message: `Already on Deck ${deckId}.` };
  }
  await ensureContentScript(tabId).catch(() => {});

  const mixer = await findMixerTab();
  if (!mixer?.id) {
    reg.pending = [...reg.pending.filter((p) => p.deckId !== deckId), { deckId, tabId }];
    await setReg(reg);
    const { tab: created } = await openMixer(true);
    reg.mixerTabId = created.id ?? null;
    await setReg(reg);
    return { ok: true, message: 'Opening the Mixer…' };
  }
  reg.mixerTabId = mixer.id;
  await setReg(reg);
  return deliver(deckId, tabId, mixer.id);
}

/** Deck tabs changed (reported by the Mixer): tell content scripts, protect tabs. */
async function updateRegistry(/** @type {Record<DeckId, number|null>} */ decks) {
  const reg = await getReg();
  const before = new Set(Object.values(reg.decks).filter((t) => t !== null));
  const after = new Set(Object.values(decks).filter((t) => t !== null));
  for (const tabId of before) {
    if (tabId !== null && !after.has(tabId)) {
      chrome.tabs.update(tabId, { autoDiscardable: true }).catch(() => {});
      chrome.tabs.sendMessage(tabId, { type: MSG.DECK_DETACH }).catch(() => {});
    }
  }
  reg.decks = decks;
  await setReg(reg);
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  const deckId = command === 'send-to-deck-a' ? 'A' : command === 'send-to-deck-b' ? 'B' : null;
  if (!deckId) return;
  const target = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (target?.id === undefined) return;
  const res = await assign(deckId, target.id);
  if (!res.ok) {
    chrome.action.setBadgeBackgroundColor({ color: '#f43f5e' });
    chrome.action.setBadgeText({ text: '!', tabId: target.id });
    chrome.action.setTitle({ title: res.message ?? 'AirDeck', tabId: target.id });
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: target.id }), 4000);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case MSG.ASSIGN_REQUEST:
        return assign(msg.deckId, msg.tabId);
      case MSG.OPEN_MIXER:
        await openMixer(true);
        return { ok: true };
      case MSG.MIXER_READY: {
        const reg = await getReg();
        const mixerTabId = sender.tab?.id ?? null;
        reg.mixerTabId = mixerTabId;
        const pending = reg.pending;
        reg.pending = [];
        await setReg(reg);
        if (mixerTabId !== null) for (const p of pending) await deliver(p.deckId, p.tabId, mixerTabId);
        return { ok: true };
      }
      case MSG.DECK_REGISTRY:
        await updateRegistry(msg.decks);
        return { ok: true };
      case MSG.WHO_AM_I: {
        const reg = await getReg();
        const tabId = sender.tab?.id;
        const deckId = /** @type {DeckId[]} */ (['A', 'B']).find((d) => reg.decks[d] === tabId) ?? null;
        return { deckId };
      }
      case MSG.GET_STATUS: {
        const reg = await getReg();
        const mixer = await findMixerTab();
        return { mixerOpen: !!mixer, decks: mixer ? reg.decks : { A: null, B: null } };
      }
      default:
        return undefined;
    }
  })().then(sendResponse, (err) => sendResponse({ ok: false, message: String(err?.message ?? err) }));
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const reg = await getReg();
  if (tabId === reg.mixerTabId) {
    // Mixer closed: every capture ends and the YouTube tabs play normally again.
    await updateRegistry({ A: null, B: null });
    const fresh = await getReg();
    fresh.mixerTabId = null;
    fresh.pending = [];
    await setReg(fresh);
    return;
  }
  if (Object.values(reg.decks).includes(tabId)) {
    chrome.runtime.sendMessage({ type: MSG.TAB_CLOSED, tabId }).catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/welcome.html') });
  }
});
