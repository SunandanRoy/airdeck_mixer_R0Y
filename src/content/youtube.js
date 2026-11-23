/**
 * AirDeck content script for YouTube.
 *
 * - Controls the <video> (play, pause, seek, tempo) when the Mixer asks.
 * - Reports transport state every 250 ms and track info when it changes.
 * - Detects ads so the Mixer can mute the deck.
 * - Shows a small "On Deck A" badge.
 *
 * It never touches audio. All YouTube-specific selectors live in this file.
 * Classic script (content scripts can't be ES modules), so message names are
 * repeated here; keep them in sync with src/shared/messages.js.
 */
(() => {
  if (window.__airdeckLoaded) return;
  window.__airdeckLoaded = true;

  const PORT_NAME = 'airdeck-deck';
  const COLORS = { A: '#22d3ee', B: '#f472d0' };

  /** @type {chrome.runtime.Port | null} */
  let port = null;
  let deckId = null;
  let timer = null;
  let desiredRate = 1;
  let lastMetaKey = '';

  // ------------------------------------------------------------ page readers
  const video = () =>
    document.querySelector('#movie_player video.html5-main-video') ||
    document.querySelector('#movie_player video') ||
    document.querySelector('video');

  const player = () => document.querySelector('#movie_player') || document.querySelector('.html5-video-player');

  const adShowing = () => {
    const p = player();
    return !!(p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')));
  };

  function videoId() {
    try {
      const u = new URL(location.href);
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]{6,})/);
      return m ? m[2] : null;
    } catch {
      return null;
    }
  }

  const text = (sel) => {
    const el = document.querySelector(sel);
    return el && el.textContent ? el.textContent.trim() : '';
  };

  function readMeta() {
    const id = videoId();
    const title =
      text('h1.ytd-watch-metadata yt-formatted-string') ||
      text('#title h1') ||
      text('ytmusic-player-bar .title') ||
      (document.querySelector('meta[name="title"]') || {}).content ||
      document.title.replace(/\s*-\s*YouTube( Music)?$/, '').replace(/^\(\d+\)\s*/, '');
    const channel =
      text('ytd-watch-metadata ytd-channel-name a') ||
      text('#owner #channel-name a') ||
      text('ytd-video-owner-renderer #channel-name') ||
      text('ytmusic-player-bar .byline a') ||
      '';
    return { title: title || 'YouTube video', channel, thumbnailUrl: id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : '', videoId: id };
  }

  function readState() {
    const v = video();
    return {
      currentTime: v ? v.currentTime : 0,
      duration: v && Number.isFinite(v.duration) ? v.duration : 0,
      paused: v ? v.paused : true,
      rate: v ? v.playbackRate : 1,
      adShowing: adShowing(),
      videoId: videoId(),
    };
  }

  // ------------------------------------------------------------ reporting
  function post(msg) {
    if (!port) return;
    try {
      port.postMessage(msg);
    } catch {
      port = null;
    }
  }

  function report() {
    if (!port) return;
    const state = readState();
    // Keep the tempo the Mixer asked for (YouTube resets it after ads etc.).
    const v = video();
    if (v && !state.adShowing && Math.abs(v.playbackRate - desiredRate) > 0.001) {
      v.playbackRate = desiredRate;
      state.rate = desiredRate;
    }
    post({ type: 'VIDEO_STATE', state });
    const meta = readMeta();
    const key = `${meta.videoId}|${meta.title}|${meta.channel}`;
    if (key !== lastMetaKey) {
      lastMetaKey = key;
      post({ type: 'TRACK_META', meta });
    }
  }

  const onVideoEvent = () => report();
  let hookedVideo = null;
  function hookVideo() {
    const v = video();
    if (!v || v === hookedVideo) return;
    if (hookedVideo) ['play', 'pause', 'seeked', 'ratechange', 'durationchange'].forEach((e) => hookedVideo.removeEventListener(e, onVideoEvent));
    hookedVideo = v;
    ['play', 'pause', 'seeked', 'ratechange', 'durationchange'].forEach((e) => v.addEventListener(e, onVideoEvent));
  }

  // Report ads the moment the player's class changes, not on the next tick.
  let adObserver = null;
  let observedPlayer = null;
  function watchAds() {
    const p = player();
    if (!p || p === observedPlayer) return;
    if (adObserver) adObserver.disconnect();
    observedPlayer = p;
    let last = adShowing();
    adObserver = new MutationObserver(() => {
      const now = adShowing();
      if (now !== last) {
        last = now;
        report();
      }
    });
    adObserver.observe(p, { attributes: true, attributeFilter: ['class'] });
  }

  /** Turns off "Autoplay next video" so a deck never jumps to a new song. */
  function disableAutoplay() {
    const toggle = document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
    if (toggle) toggle.click();
  }

  // ------------------------------------------------------------ commands
  function handleCommand(msg) {
    const v = video();
    if (!v) return;
    switch (msg.cmd) {
      case 'play':
        v.play().catch(() => {});
        break;
      case 'pause':
        v.pause();
        break;
      case 'seek':
        if (Number.isFinite(msg.value)) v.currentTime = Math.max(0, msg.value);
        break;
      case 'rate':
        if (Number.isFinite(msg.value)) {
          desiredRate = Math.min(1.16, Math.max(0.84, msg.value));
          v.playbackRate = desiredRate;
        }
        break;
      case 'pitchLock':
        v.preservesPitch = msg.value !== false;
        break;
    }
    report();
  }

  // ------------------------------------------------------------ badge
  let badgeHost = null;
  function showBadge(id, label) {
    if (!badgeHost) {
      badgeHost = document.createElement('div');
      badgeHost.id = 'airdeck-badge-host';
      badgeHost.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483646;pointer-events:none;';
      const shadow = badgeHost.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>
        .b{display:flex;align-items:center;gap:8px;padding:6px 12px 6px 10px;border-radius:999px;
           background:rgba(15,17,26,.88);color:#f4f6fb;font:600 12px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;
           box-shadow:0 4px 18px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);letter-spacing:.02em}
        .d{width:9px;height:9px;border-radius:50%;box-shadow:0 0 10px currentColor}
      </style><div class="b"><span class="d"></span><span class="t"></span></div>`;
      document.documentElement.appendChild(badgeHost);
    }
    const root = badgeHost.shadowRoot;
    const dot = root.querySelector('.d');
    dot.style.background = COLORS[id] || '#fff';
    dot.style.color = COLORS[id] || '#fff';
    root.querySelector('.t').textContent = label || `On Deck ${id}`;
  }
  function hideBadge() {
    if (badgeHost) badgeHost.remove();
    badgeHost = null;
  }

  // ------------------------------------------------------------ connection
  function connect(id) {
    if (port && deckId === id) return;
    disconnect(false);
    deckId = id;
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch {
      port = null;
      return;
    }
    port.onMessage.addListener((msg) => {
      if (msg.type === 'VIDEO_CMD') handleCommand(msg);
      else if (msg.type === 'BADGE') showBadge(deckId, msg.label);
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      disconnect(true);
    });
    port.postMessage({ type: 'HELLO', deckId: id });
    lastMetaKey = '';
    desiredRate = 1;
    showBadge(id, `On Deck ${id}`);
    disableAutoplay();
    hookVideo();
    watchAds();
    report();
    timer = setInterval(() => {
      hookVideo();
      watchAds();
      report();
    }, 250);
  }

  /** @param {boolean} restore put the player back to normal speed */
  function disconnect(restore) {
    if (timer) clearInterval(timer);
    timer = null;
    if (port) {
      try {
        port.disconnect();
      } catch {
        /* gone */
      }
    }
    port = null;
    if (adObserver) adObserver.disconnect();
    adObserver = null;
    observedPlayer = null;
    hideBadge();
    if (restore) {
      const v = video();
      if (v) {
        v.playbackRate = 1;
        v.preservesPitch = true;
      }
      desiredRate = 1;
      deckId = null;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PING') sendResponse({ ok: true });
    else if (msg.type === 'DECK_ATTACH') {
      connect(msg.deckId);
      sendResponse({ ok: true });
    } else if (msg.type === 'DECK_DETACH') {
      disconnect(true);
      sendResponse({ ok: true });
    }
  });

  // YouTube is a single-page app: report new videos promptly.
  window.addEventListener('yt-navigate-finish', () => {
    if (!port) return;
    disableAutoplay();
    hookVideo();
    report();
  });

  // After a full page reload, reconnect if this tab is still on a deck.
  chrome.runtime.sendMessage({ type: 'WHO_AM_I' }, (res) => {
    void chrome.runtime.lastError;
    if (res && res.deckId) connect(res.deckId);
  });
})();
