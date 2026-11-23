// @ts-check
import { MSG, isYouTubeUrl } from '../shared/messages.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const status = $('status');

/** @param {string} text @param {boolean} [error] */
function say(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}

/** @param {HTMLElement} btn @param {string} text */
function setLabel(btn, text) {
  const label = btn.querySelector('.label');
  if (label) label.textContent = text;
}

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const st = await chrome.runtime.sendMessage({ type: MSG.GET_STATUS }).catch(() => null);
  const ok = !!tab && isYouTubeUrl(tab.url);
  const sendA = /** @type {HTMLButtonElement} */ ($('send-a'));
  const sendB = /** @type {HTMLButtonElement} */ ($('send-b'));

  if (ok) {
    $('track').textContent = (tab.title || '').replace(/\s*-\s*YouTube( Music)?$/, '') || 'This YouTube tab';
    sendA.disabled = false;
    sendB.disabled = false;
  } else {
    $('track').textContent = 'Open a YouTube video, then click this icon to put it on a deck.';
  }
  if (st?.decks && tab?.id !== undefined) {
    if (st.decks.A === tab.id) {
      sendA.classList.add('current');
      setLabel(sendA, 'On Deck A');
    }
    if (st.decks.B === tab.id) {
      sendB.classList.add('current');
      setLabel(sendB, 'On Deck B');
    }
  }

  for (const [btn, deckId] of /** @type {const} */ ([[sendA, 'A'], [sendB, 'B']])) {
    btn.addEventListener('click', async () => {
      if (tab?.id === undefined) return;
      sendA.disabled = sendB.disabled = true;
      say('Sending…');
      const res = await chrome.runtime.sendMessage({ type: MSG.ASSIGN_REQUEST, deckId, tabId: tab.id }).catch((e) => ({ ok: false, message: String(e) }));
      if (res?.ok) {
        say(res.message || `Sent to Deck ${deckId}.`);
        setTimeout(() => window.close(), 600);
      } else {
        say(res?.message || 'Something went wrong.', true);
        sendA.disabled = sendB.disabled = false;
      }
    });
  }

  $('open-mixer').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: MSG.OPEN_MIXER });
    window.close();
  });
  $('open-demo').addEventListener('click', async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/demo/demo.html') });
    window.close();
  });
}

main();
