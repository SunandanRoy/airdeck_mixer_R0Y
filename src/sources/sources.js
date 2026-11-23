// @ts-check
/**
 * Deck sources. The audio engine only sees this interface, so every feature
 * works the same with a captured YouTube tab and with a local file (the Demo
 * page / Dev Harness).
 *
 * interface DeckSource {
 *   kind: 'tab' | 'file'
 *   node: AudioNode
 *   state: VideoState            latest transport state
 *   meta: TrackMeta              latest track info
 *   play(); pause(); seek(t); setRate(r); setPitchLock(on)
 *   on('state' | 'meta' | 'ended', fn)
 *   dispose()
 * }
 */
import { Emitter } from '../shared/emitter.js';
import { MSG } from '../shared/messages.js';

/** @typedef {import('../shared/messages.js').VideoState} VideoState */
/** @typedef {import('../shared/messages.js').TrackMeta} TrackMeta */

/** @returns {VideoState} */
const emptyState = () => ({ currentTime: 0, duration: 0, paused: true, rate: 1, adShowing: false, videoId: null });

/**
 * A YouTube tab captured with chrome.tabCapture. Transport commands go to the
 * tab's content script over a long-lived port.
 */
export class TabCaptureSource extends Emitter {
  /**
   * @param {AudioContext} ctx
   * @param {MediaStream} stream
   * @param {number} tabId
   */
  constructor(ctx, stream, tabId) {
    super();
    this.kind = /** @type {const} */ ('tab');
    this.tabId = tabId;
    this.stream = stream;
    this.node = ctx.createMediaStreamSource(stream);
    /** @type {VideoState} */
    this.state = emptyState();
    /** @type {TrackMeta} */
    this.meta = { title: 'Loading…', channel: '', thumbnailUrl: '', videoId: null };
    /** @type {chrome.runtime.Port | null} */
    this.port = null;
    this.stateAt = performance.now();
    stream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => this.emit('ended')));
  }

  /** @param {chrome.runtime.Port} port */
  attachPort(port) {
    this.port = port;
    port.onMessage.addListener((msg) => {
      if (msg?.type === MSG.VIDEO_STATE) {
        this.state = { ...this.state, ...msg.state };
        this.stateAt = performance.now();
        this.emit('state', this.state);
      } else if (msg?.type === MSG.TRACK_META) {
        this.meta = msg.meta;
        this.emit('meta', this.meta);
      }
    });
    port.onDisconnect.addListener(() => {
      if (this.port === port) this.port = null;
      this.emit('portlost');
    });
  }

  /** @param {string} cmd @param {number|boolean} [value] */
  send(cmd, value) {
    try {
      this.port?.postMessage({ type: MSG.VIDEO_CMD, cmd, value });
    } catch {
      this.port = null;
    }
  }

  play() {
    this.send('play');
  }
  pause() {
    this.send('pause');
  }
  /** @param {number} t */
  seek(t) {
    this.send('seek', t);
  }
  /** @param {number} r */
  setRate(r) {
    this.send('rate', r);
  }
  /** @param {boolean} on */
  setPitchLock(on) {
    this.send('pitchLock', on);
  }
  /** @param {string} label */
  setBadge(label) {
    try {
      this.port?.postMessage({ type: MSG.BADGE, label });
    } catch {
      /* port gone */
    }
  }

  dispose() {
    try {
      this.port?.disconnect();
    } catch {
      /* already gone */
    }
    this.port = null;
    this.stream.getTracks().forEach((t) => t.stop());
    this.node.disconnect();
  }
}

/**
 * A local audio file or generated demo track, played through an <audio>
 * element routed into the engine with createMediaElementSource.
 */
export class MediaElementSource extends Emitter {
  /**
   * @param {AudioContext} ctx
   * @param {string} url
   * @param {Partial<TrackMeta>} meta
   */
  constructor(ctx, url, meta) {
    super();
    this.kind = /** @type {const} */ ('file');
    this.audio = new Audio();
    this.audio.src = url;
    this.audio.preload = 'auto';
    this.audio.preservesPitch = true;
    this.url = url;
    this.node = ctx.createMediaElementSource(this.audio);
    /** @type {TrackMeta} */
    this.meta = { title: meta.title ?? 'Local file', channel: meta.channel ?? 'On this computer', thumbnailUrl: '', videoId: meta.videoId ?? null };
    /** @type {VideoState} */
    this.state = emptyState();
    this.stateAt = performance.now();
    /** Lets the Dev Harness simulate a YouTube ad. */
    this.adShowing = false;
    const update = () => {
      this.state = {
        currentTime: this.audio.currentTime,
        duration: Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
        paused: this.audio.paused,
        rate: this.audio.playbackRate,
        adShowing: this.adShowing,
        videoId: this.meta.videoId,
      };
      this.stateAt = performance.now();
      this.emit('state', this.state);
    };
    ['play', 'pause', 'seeked', 'ratechange', 'loadedmetadata', 'ended'].forEach((e) => this.audio.addEventListener(e, update));
    this.update = update;
    this.timer = setInterval(update, 250);
    queueMicrotask(() => this.emit('meta', this.meta));
  }
  play() {
    this.audio.play().catch(() => {});
  }
  pause() {
    this.audio.pause();
  }
  /** @param {number} t */
  seek(t) {
    this.audio.currentTime = Math.max(0, t);
  }
  /** @param {number} r */
  setRate(r) {
    this.audio.playbackRate = r;
  }
  /** @param {boolean} on */
  setPitchLock(on) {
    this.audio.preservesPitch = on;
  }
  setBadge() {}
  /** @param {boolean} on */
  simulateAd(on) {
    this.adShowing = on;
    this.update();
  }
  dispose() {
    clearInterval(this.timer);
    this.audio.pause();
    this.node.disconnect();
    if (this.url.startsWith('blob:')) URL.revokeObjectURL(this.url);
  }
}

/**
 * Current playback position, extrapolated from the last state report.
 * @param {{state: VideoState, stateAt: number}} source
 */
export function livePosition(source) {
  const s = source.state;
  if (s.paused) return s.currentTime;
  return s.currentTime + ((performance.now() - source.stateAt) / 1000) * s.rate;
}
