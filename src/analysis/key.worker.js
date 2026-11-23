// Key detection worker: keeps the FFT work off the UI thread.
import { detectKey } from './key.js';

self.onmessage = (e) => {
  const { id, samples, sampleRate } = e.data;
  try {
    const { key, score } = detectKey(samples, sampleRate);
    self.postMessage({ id, key: score > 0.3 ? key : null });
  } catch {
    self.postMessage({ id, key: null });
  }
};
