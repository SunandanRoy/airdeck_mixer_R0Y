// @ts-check
/**
 * AirDeck Mixer app: builds the page, wires the audio engine to the UI, and
 * (in the extension) receives captured YouTube tabs from the service worker.
 *
 * The same app runs in two modes, set by <body data-mode>:
 *   tab   the real Mixer: decks are YouTube tabs (src/mixer/mixer.html)
 *   demo  decks are generated demo tracks or local files (src/demo/demo.html);
 *         also the Dev Harness used by the end-to-end tests
 */
import { AudioEngine } from '../audio/engine.js';
import { PRESETS, PRESETS_BY_ID } from '../audio/transitions/index.js';
import { BUILT_IN_PADS } from '../audio/pads/synth.js';
import { keysCompatible, keyMatchShift, formatKey } from '../analysis/camelot.js';
import { TabCaptureSource, MediaElementSource } from '../sources/sources.js';
import { FIXTURES } from '../harness/fixtures.js';
import { encodeWav } from '../shared/wav.js';
import { MSG } from '../shared/messages.js';
import { DECK_IDS, DECK_PORT_NAME, TRANSITION_LENGTHS } from '../shared/constants.js';
import { h, setText, fmtTime, onPress } from './dom.js';
import { Knob } from './knob.js';
import { DeckView } from './deckView.js';
import { loadAll, saveSettings, saveCues, saveAnalysis } from './storage.js';
import { installShortcuts, SHORTCUTS } from './shortcuts.js';

/** @typedef {import('../shared/constants.js').DeckId} DeckId */

const mode = /** @type {'tab'|'demo'} */ (document.body.dataset.mode === 'demo' ? 'demo' : 'tab');
const hasChrome = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

async function main() {
  const stored = await loadAll();
  const settings = stored.settings;
  const engine = new AudioEngine();
  await engine.init();
  engine.setCrossfaderCurve(settings.crossfaderCurve);
  engine.setAutoLevel(settings.autoLevel);
  engine.setMasterVolume(settings.masterVolume);
  // Expose for debugging and the end-to-end tests.
  /** @type {any} */ (window).airdeck = { engine, settings };

  const ui = { preset: settings.defaultPreset, length: settings.defaultLengthBeats };

  // ------------------------------------------------------------------ toast
  const toastBox = h('div.toasts', { attrs: { role: 'status', 'aria-live': 'polite' } });
  /** @param {string} text @param {'info'|'error'} [kind] */
  function toast(text, kind = 'info') {
    const t = h(`div.toast.${kind}`, { text });
    toastBox.append(t);
    setTimeout(() => t.classList.add('out'), 3800);
    setTimeout(() => t.remove(), 4300);
  }

  // ------------------------------------------------------------------ decks
  /** @type {Record<DeckId, DeckView>} */
  const views = /** @type {any} */ ({});
  for (const id of DECK_IDS) {
    const deck = engine.decks[id];
    const other = engine.decks[id === 'A' ? 'B' : 'A'];
    views[id] = new DeckView(deck, {
      toast,
      other: () => other,
      mode,
      settings,
      onEject: () => eject(id),
      onLoadDemo: (d) => openTrackPicker(/** @type {DeckId} */ (d)),
    });
    deck.on('cues', () => {
      const vid = deck.state.meta.videoId;
      if (!vid) return;
      stored.cuesByVideoId[vid] = [...deck.state.cues];
      saveCues(stored.cuesByVideoId);
    });
    deck.on('analysis', () => {
      const vid = deck.state.meta.videoId;
      if (!vid) return;
      stored.analysisByVideoId[vid] = { bpm: deck.state.bpm.base, key: deck.state.key, analyzedAt: Date.now() };
      saveAnalysis(stored.analysisByVideoId);
    });
    deck.on('track', (/** @type {string} */ vid) => {
      const cues = stored.cuesByVideoId[vid];
      if (cues) deck.state.cues = [...cues];
      const a = stored.analysisByVideoId[vid];
      if (a?.bpm && a.bpm > 0) deck.setBaseBpm(a.bpm, 'cache');
      if (a?.key) {
        deck.state.key = a.key;
        deck.keyRequested = true;
      }
      deck.changed();
    });
    deck.on('released', () => reportRegistry());
  }

  function eject(/** @type {DeckId} */ id) {
    const deck = engine.decks[id];
    if (!deck.source) return;
    deck.detach(0.3);
    reportRegistry();
    toast(mode === 'tab' ? `Deck ${id} ejected. That tab plays normally again.` : `Deck ${id} ejected.`);
  }

  function reportRegistry() {
    if (mode !== 'tab' || !hasChrome) return;
    /** @type {Record<DeckId, number|null>} */
    const decks = { A: null, B: null };
    for (const id of DECK_IDS) {
      const src = engine.decks[id].source;
      decks[id] = src?.kind === 'tab' ? src.tabId : null;
    }
    chrome.runtime.sendMessage({ type: MSG.DECK_REGISTRY, decks }).catch(() => {});
  }

  // ------------------------------------------------------------------ header
  const recBtn = h('button.rec', { title: 'Record your mix', attrs: { 'aria-label': 'Record' } }, h('span.rec-dot'), h('span.rec-text', { text: 'REC' }));
  recBtn.addEventListener('click', async () => {
    await engine.resume();
    if (!engine.recorder.recording) {
      engine.recorder.start(settings.recordFormat);
      if (!engine.recorder.recording) return toast('Recording isn’t available here.', 'error');
      toast(`Recording (${settings.recordFormat === 'wav' ? 'WAV' : 'WebM'})…`);
    } else {
      const blob = await engine.recorder.stop();
      if (blob) download(blob, settings.recordFormat === 'wav' ? 'wav' : 'webm');
    }
  });
  const masterMeter = h('div.meter.horizontal', { attrs: { 'aria-hidden': 'true' } }, h('div.meter-fill'), h('div.meter-peak'));
  const masterKnob = new Knob({
    label: 'Master',
    value: settings.masterVolume,
    def: 0.9,
    tip: 'Overall volume. A limiter stops the mix from ever distorting.',
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => {
      engine.setMasterVolume(v);
      settings.masterVolume = v;
      saveSettings(settings);
    },
  });
  const header = h('header.app-head', {},
    h('div.brand', {}, h('img', { src: '../../icons/48.png', alt: '', width: 28, height: 28 }), h('span', { text: 'AirDeck' }), mode === 'demo' ? h('span.chip', { text: 'Demo' }) : null),
    recBtn,
    h('span.spacer'),
    h('div.master', {}, h('span.muted.small', { text: 'Master' }), masterMeter),
    masterKnob.el,
    h('button.icon-btn', { text: '?', title: 'Keyboard shortcuts and help', attrs: { 'aria-label': 'Help' }, onclick: () => helpDialog.showModal() }),
    h('button.icon-btn', { text: '⚙', title: 'Settings', attrs: { 'aria-label': 'Settings' }, onclick: () => settingsDialog.showModal() }),
  );

  // ------------------------------------------------------------------ mix column
  const presetSelect = /** @type {HTMLSelectElement} */ (h('select.select', { attrs: { 'aria-label': 'Mix style' } }, ...PRESETS.map((p) => h('option', { value: p.id, text: p.label }))));
  presetSelect.value = PRESETS_BY_ID[ui.preset] ? ui.preset : 'bassSwap';
  ui.preset = presetSelect.value;
  const presetTip = h('p.preset-tip');
  const lengthBtns = TRANSITION_LENGTHS.map((n) => h('button.seg', { text: String(n), title: `${n} beats`, onclick: () => setLength(n) }));
  const lengthRow = h('div.segmented', { attrs: { role: 'group', 'aria-label': 'Mix length in beats' } }, ...lengthBtns);
  function setLength(/** @type {number} */ n) {
    ui.length = n;
    lengthBtns.forEach((b) => b.classList.toggle('active', Number(b.textContent) === n));
    settings.defaultLengthBeats = n;
    saveSettings(settings);
  }
  function setPreset(/** @type {string} */ id) {
    ui.preset = id;
    const p = PRESETS_BY_ID[id];
    presetTip.textContent = p.tip;
    lengthRow.classList.toggle('disabled', !p.usesLength);
    settings.defaultPreset = id;
    saveSettings(settings);
  }
  presetSelect.addEventListener('change', () => setPreset(presetSelect.value));
  setPreset(ui.preset);
  setLength(ui.length);

  const mixBtn = h('button.mix-btn', { attrs: { 'aria-label': 'Mix' } }, h('span.mix-label'), h('span.mix-progress'));
  mixBtn.addEventListener('click', () => mixOrCancel());
  async function mixOrCancel() {
    await engine.resume();
    if (engine.automation.running) {
      engine.cancelMix();
      toast('Mix cancelled.');
      return;
    }
    const to = engine.crossfader < 0.5 ? 'B' : 'A';
    const err = engine.mixTo(to, ui.preset, ui.length);
    if (err) toast(err, 'error');
  }

  const xfader = /** @type {HTMLInputElement} */ (h('input.xfader', { type: 'range', min: 0, max: 1000, value: 500, attrs: { 'aria-label': 'Mix slider: A to B' } }));
  xfader.addEventListener('input', () => engine.setCrossfader(Number(xfader.value) / 1000));
  xfader.addEventListener('dblclick', () => engine.setCrossfader(0.5));
  const curveBtns = /** @type {const} */ (['smooth', 'sharp', 'linear']).map((c) =>
    h('button.seg', {
      text: c[0].toUpperCase() + c.slice(1),
      title: { smooth: 'Smooth: the total volume stays even across the slide (best for blending).', sharp: 'Sharp: both songs at full volume until the very end (for quick cuts).', linear: 'Linear: a straight fade.' }[c],
      onclick: () => setCurve(c),
    }),
  );
  function setCurve(/** @type {'smooth'|'sharp'|'linear'} */ c) {
    engine.setCrossfaderCurve(c);
    settings.crossfaderCurve = c;
    saveSettings(settings);
    curveBtns.forEach((b) => b.classList.toggle('active', b.textContent?.toLowerCase() === c));
  }
  setCurve(settings.crossfaderCurve);

  const meterA = h('div.meter.vertical.a', {}, h('div.meter-fill'), h('div.meter-peak'));
  const meterB = h('div.meter.vertical.b', {}, h('div.meter-fill'), h('div.meter-peak'));
  const matchSpeed = h('div.match-line');
  const matchKey = h('div.match-line');

  const mixCol = h('section.mix', { attrs: { 'aria-label': 'Mixer' } },
    h('div.section-label', { text: 'Mix style' }),
    presetSelect,
    presetTip,
    h('div.section-label', { text: 'Length (beats)' }),
    lengthRow,
    mixBtn,
    h('div.xfader-box', {},
      h('div.xfader-labels', {}, h('span.a', { text: 'A' }), h('span.muted.small', { text: 'Mix slider' }), h('span.b', { text: 'B' })),
      xfader,
      h('div.segmented.small', { attrs: { role: 'group', 'aria-label': 'Mix slider curve' } }, ...curveBtns),
    ),
    h('div.meters', {}, meterA, h('div.match', {}, matchSpeed, matchKey), meterB),
  );

  // ------------------------------------------------------------------ pads
  const padEls = BUILT_IN_PADS.map((p, i) => h('button.pad', { text: p.label, title: `${p.tip} (built in)`, onclick: async () => {
    await engine.resume();
    engine.triggerPad(i);
  } }));
  const grabEls = [0, 1, 2, 3].map((i) => {
    const main = h('button.pad.grab', { text: `Grab ${i + 1}`, title: 'Empty. Press A or B to grab the last bar of that deck. Hold to clear.' });
    onPress(main, {
      tap: () => {
        if (!engine.triggerGrab(i)) toast('Press A or B on this pad to grab the last bar of that deck.');
      },
      long: () => {
        engine.grabs[i] = null;
        main.classList.remove('set');
        main.title = 'Empty. Press A or B to grab the last bar of that deck. Hold to clear.';
      },
    });
    const grabFrom = (/** @type {DeckId} */ d) =>
      h(`button.grab-from.${d.toLowerCase()}`, {
        text: d,
        title: `Grab the last bar of Deck ${d}`,
        onclick: () => {
          if (engine.grabPad(i, d)) {
            main.classList.add('set');
            main.title = `Holds a bar from Deck ${d}. Tap to play, hold to clear.`;
          } else toast(`Play Deck ${d} for a moment first.`, 'error');
        },
      });
    return h('div.grab-wrap', {}, main, h('div.grab-from-row', {}, grabFrom('A'), grabFrom('B')));
  });
  const pads = h('section.pads', { attrs: { 'aria-label': 'Sample pads' } }, h('div.section-label', { text: 'Pads' }), h('div.pad-row', {}, ...padEls, ...grabEls));

  // ------------------------------------------------------------------ dialogs
  const helpDialog = /** @type {HTMLDialogElement} */ (h('dialog.dialog', {},
    h('h2', { text: 'How to use AirDeck' }),
    h('ol.steps', {},
      h('li', {}, mode === 'tab' ? 'Open a YouTube video and press ' : 'Pick a demo track for each deck. ', mode === 'tab' ? h('kbd', { text: 'Alt+Shift+1' }) : '', mode === 'tab' ? ' to put it on Deck A. Do the same with another video and ' : '', mode === 'tab' ? h('kbd', { text: 'Alt+Shift+2' }) : '', mode === 'tab' ? ' for Deck B.' : ''),
      h('li', { text: 'Press play on Deck A. Tap the sound switches to turn the bass, vocals or treble off and on.' }),
      h('li', { text: 'Press Sync on Deck B so both songs have the same speed.' }),
      h('li', { text: 'Pick a mix style and press the big Mix button. That’s it.' }),
    ),
    h('h3', { text: 'Keyboard shortcuts' }),
    h('table.shortcuts', {}, ...SHORTCUTS.map(([k, d]) => h('tr', {}, h('td', {}, h('kbd', { text: k })), h('td', { text: d })))),
    h('form', { method: 'dialog' }, h('button.btn', { text: 'Close' })),
  ));
  const check = (/** @type {string} */ label, /** @type {boolean} */ value, /** @type {(v: boolean) => void} */ fn, /** @type {string} */ tip) => {
    const input = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: value }));
    input.addEventListener('change', () => fn(input.checked));
    return h('label.setting', { title: tip }, input, h('span', { text: label }));
  };
  const recFormat = /** @type {HTMLSelectElement} */ (h('select.select', {}, h('option', { value: 'webm', text: 'WebM (small file)' }), h('option', { value: 'wav', text: 'WAV (best quality, large)' })));
  recFormat.value = settings.recordFormat;
  recFormat.addEventListener('change', () => {
    settings.recordFormat = /** @type {'webm'|'wav'} */ (recFormat.value);
    saveSettings(settings);
  });
  const settingsDialog = /** @type {HTMLDialogElement} */ (h('dialog.dialog', {},
    h('h2', { text: 'Settings' }),
    check('Auto level match', settings.autoLevel, (v) => {
      settings.autoLevel = v;
      engine.setAutoLevel(v);
      saveSettings(settings);
    }, 'Keeps both songs at the same loudness.'),
    check('Wide tempo range (±16%)', settings.wideTempo, (v) => {
      settings.wideTempo = v;
      saveSettings(settings);
      Object.values(views).forEach((vw) => (vw.dirty = true));
    }, 'The tempo slider covers ±16% instead of ±8%.'),
    h('label.setting.col', {}, h('span', { text: 'Recording format' }), recFormat),
    hasChrome
      ? h('button.btn.small', { text: 'Change keyboard shortcuts…', onclick: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) })
      : null,
    h('p.muted.small', { text: 'AirDeck runs entirely on your computer. It makes no network requests except loading YouTube thumbnails.' }),
    h('form', { method: 'dialog' }, h('button.btn', { text: 'Done' })),
  ));

  // ------------------------------------------------------------------ demo: track picker
  const fileInput = /** @type {HTMLInputElement} */ (h('input.hidden', { type: 'file', accept: 'audio/*' }));
  /** @type {DeckId} */
  let pickFor = 'A';
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) loadUrl(pickFor, URL.createObjectURL(f), { title: f.name.replace(/\.[^.]+$/, ''), channel: 'Your file', videoId: `file:${f.name}:${f.size}` });
    fileInput.value = '';
    pickerDialog.close();
  });
  const pickerList = h('div.picker');
  const pickerDialog = /** @type {HTMLDialogElement} */ (h('dialog.dialog', {}, h('h2', { text: 'Choose a track' }), pickerList, fileInput, h('form', { method: 'dialog' }, h('button.btn', { text: 'Cancel' }))));
  const FIXTURE_LABELS = {
    song_like_a: 'Demo song A — 124 BPM',
    song_like_b: 'Demo song B — 122 BPM',
    click120: 'Click track — 120 BPM',
    click128: 'Click track — 128 BPM',
    bass_hi: 'Test tones — bass + treble',
    centre_side: 'Test tones — centre + side',
    a_minor_chords: 'Chords in A minor',
  };
  function openTrackPicker(/** @type {DeckId} */ d) {
    pickFor = d;
    pickerList.replaceChildren(
      ...Object.entries(FIXTURE_LABELS).map(([name, label]) => h('button.btn.wide', { text: label, onclick: () => {
        loadFixture(d, name);
        pickerDialog.close();
      } })),
      h('button.btn.wide.accent', { text: 'Your own audio file…', onclick: () => fileInput.click() }),
    );
    pickerDialog.showModal();
  }

  /** @param {DeckId} d @param {string} name */
  function loadFixture(d, name) {
    const f = /** @type {any} */ (FIXTURES)[name]();
    const url = URL.createObjectURL(new Blob([encodeWav([f.left, f.right], f.sampleRate)], { type: 'audio/wav' }));
    loadUrl(d, url, { title: f.label, channel: 'AirDeck demo', videoId: `demo:${name}` });
  }

  /** @param {DeckId} d @param {string} url @param {{title: string, channel: string, videoId: string}} meta */
  function loadUrl(d, url, meta) {
    const src = new MediaElementSource(engine.ctx, url, meta);
    src.audio.loop = true;
    engine.decks[d].attach(src);
  }
  /** @type {any} */ (window).airdeck.loadFixture = loadFixture;

  // ------------------------------------------------------------------ layout
  const startOverlay = h('div.start-overlay', {},
    h('button.start-btn', { onclick: async () => {
      await engine.resume();
      startOverlay.classList.add('hidden');
    } }, h('img', { src: '../../icons/128.png', alt: '', width: 72, height: 72 }), h('span', { text: 'Click to start AirDeck' }), h('span.muted.small', { text: 'Your browser needs one click before a page can play sound.' })),
  );

  const app = document.getElementById('app');
  app?.replaceChildren(
    header,
    h('main.board', {}, views.A.el, mixCol, views.B.el),
    pads,
    h('footer.app-foot', {}, h('span.muted.small', { text: mode === 'tab' ? 'Tip: keep this tab open while you mix. Closing it gives every YouTube tab its sound back.' : 'Demo mode: everything here is generated on your computer. Install the extension and use YouTube tabs for the real thing.' })),
    toastBox,
    helpDialog,
    settingsDialog,
    pickerDialog,
    startOverlay,
  );
  if (engine.ctx.state === 'running') startOverlay.classList.add('hidden');
  engine.ctx.addEventListener('statechange', () => startOverlay.classList.toggle('hidden', engine.ctx.state === 'running'));

  // ------------------------------------------------------------------ render loop
  const meterSet = (/** @type {HTMLElement} */ el, /** @type {{rms: number, peak: number}} */ lv, /** @type {'w'|'h'} */ dim) => {
    const db = (/** @type {number} */ x) => (x > 0 ? 20 * Math.log10(x) : -100);
    const pct = (/** @type {number} */ x) => `${Math.max(0, Math.min(100, ((db(x) + 48) / 48) * 100))}%`;
    const fill = /** @type {HTMLElement} */ (el.children[0]);
    const peak = /** @type {HTMLElement} */ (el.children[1]);
    if (dim === 'w') {
      fill.style.width = pct(lv.rms * 1.4);
      peak.style.left = pct(lv.peak);
    } else {
      fill.style.height = pct(lv.rms * 1.4);
      peak.style.bottom = pct(lv.peak);
    }
    el.classList.toggle('hot', lv.peak > 0.94);
  };

  function frame() {
    views.A.frame();
    views.B.frame();
    meterSet(masterMeter, engine.masterLevel(), 'w');
    meterSet(meterA, engine.decks.A.level(), 'h');
    meterSet(meterB, engine.decks.B.level(), 'h');

    const xf = engine.crossfader;
    if (document.activeElement !== xfader || engine.automation.running) xfader.value = String(Math.round(xf * 1000));
    const t = engine.transition;
    const label = /** @type {HTMLElement} */ (mixBtn.children[0]);
    const prog = /** @type {HTMLElement} */ (mixBtn.children[1]);
    if (t) {
      const p = Math.max(0, Math.min(1, (engine.ctx.currentTime - t.t0) / Math.max(0.01, t.duration)));
      setText(label, `Mixing to ${t.to}… tap to cancel`);
      prog.style.width = `${p * 100}%`;
      mixBtn.className = `mix-btn running to-${t.to.toLowerCase()}`;
    } else {
      const to = xf < 0.5 ? 'B' : 'A';
      setText(label, to === 'B' ? 'Mix to B →' : '← Mix to A');
      prog.style.width = '0%';
      mixBtn.className = `mix-btn to-${to.toLowerCase()}`;
    }

    const rec = engine.recorder;
    recBtn.classList.toggle('on', rec.recording);
    setText(/** @type {HTMLElement} */ (recBtn.children[1]), rec.recording ? fmtTime(rec.elapsed) : 'REC');

    const a = engine.decks.A.state;
    const b = engine.decks.B.state;
    if (a.bpm.effective > 0 && b.bpm.effective > 0) {
      const diff = Math.abs(a.bpm.effective - b.bpm.effective);
      setText(matchSpeed, diff < 0.5 ? 'Speed: in sync ✓' : `Speed: ${a.bpm.effective.toFixed(1)} vs ${b.bpm.effective.toFixed(1)}`);
      matchSpeed.className = `match-line ${diff < 0.5 ? 'good' : ''}`;
    } else {
      setText(matchSpeed, 'Speed: —');
      matchSpeed.className = 'match-line';
    }
    if (a.key && b.key) {
      const ok = keysCompatible(a.key, b.key);
      const shift = keyMatchShift(a.key, b.key);
      setText(matchKey, ok ? 'Keys: good match ✓' : shift !== null ? `Keys: clash (B ${shift > 0 ? '+' : ''}${shift} st would fit)` : 'Keys: clash');
      matchKey.className = `match-line ${ok ? 'good' : 'warn'}`;
      matchKey.title = `${formatKey(a.key)} · ${formatKey(b.key)}`;
    } else {
      setText(matchKey, 'Keys: —');
      matchKey.className = 'match-line';
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ------------------------------------------------------------------ shortcuts
  installShortcuts({
    engine,
    mix: mixOrCancel,
    toast,
    help: () => helpDialog.showModal(),
  });

  // ------------------------------------------------------------------ tab capture (extension)
  if (mode === 'tab' && hasChrome) setupTabCapture(engine, toast, reportRegistry);

  // ------------------------------------------------------------------ demo: preload two songs
  if (mode === 'demo') {
    loadFixture('A', 'song_like_a');
    loadFixture('B', 'song_like_b');
    engine.setCrossfader(0);
  }

  /** @param {Blob} blob @param {string} ext */
  function download(blob, ext) {
    const d = new Date();
    const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
    const name = `airdeck-mix-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
    const a = /** @type {HTMLAnchorElement} */ (h('a', { href: URL.createObjectURL(blob), download: name }));
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`Saved ${name}`);
  }
}

/**
 * Receives tabs from the service worker and keeps each deck connected to its
 * YouTube tab's content script.
 * @param {AudioEngine} engine
 * @param {(msg: string, kind?: 'info'|'error') => void} toast
 * @param {() => void} reportRegistry
 */
function setupTabCapture(engine, toast, reportRegistry) {
  /** @param {number} tabId @param {DeckId} deckId @param {number} [attempt] */
  const attachContent = (tabId, deckId, attempt = 0) => {
    chrome.tabs.sendMessage(tabId, { type: MSG.DECK_ATTACH, deckId }).catch(() => {
      if (attempt < 10) setTimeout(() => attachContent(tabId, deckId, attempt + 1), 1000);
    });
  };

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== DECK_PORT_NAME) return;
    const tabId = port.sender?.tab?.id;
    const deck = Object.values(engine.decks).find((d) => d.source?.kind === 'tab' && d.source.tabId === tabId);
    if (!deck) {
      port.disconnect();
      return;
    }
    deck.source.attachPort(port);
    deck.source.setBadge(`On Deck ${deck.id}`);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === MSG.DECK_ASSIGN) {
      assign(msg.deckId, msg.tabId, msg.streamId);
    } else if (msg?.type === MSG.ASSIGN_ERROR) {
      toast(msg.message, 'error');
    } else if (msg?.type === MSG.TAB_CLOSED) {
      for (const d of Object.values(engine.decks)) {
        if (d.source?.kind === 'tab' && d.source.tabId === msg.tabId) {
          d.detach(1, 'closed');
          reportRegistry();
        }
      }
    }
  });

  /** @param {DeckId} deckId @param {number} tabId @param {string} streamId */
  async function assign(deckId, tabId, streamId) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: /** @type {any} */ ({ mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }),
        video: false,
      });
      const src = new TabCaptureSource(/** @type {AudioContext} */ (engine.ctx), stream, tabId);
      src.on('portlost', () => {
        if (engine.decks[deckId].source === src) setTimeout(() => attachContent(tabId, deckId), 800);
      });
      engine.decks[deckId].attach(src);
      attachContent(tabId, deckId);
      reportRegistry();
      toast(`Deck ${deckId} loaded.`);
    } catch (err) {
      toast(`Couldn’t load that tab on Deck ${deckId}: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }

  // Start clean: a reloaded Mixer has no captures.
  reportRegistry();
  chrome.runtime.sendMessage({ type: MSG.MIXER_READY }).catch(() => {});
}

main().catch((err) => {
  console.error(err);
  const app = document.getElementById('app');
  if (app) app.textContent = `AirDeck couldn’t start: ${err instanceof Error ? err.message : err}`;
});
