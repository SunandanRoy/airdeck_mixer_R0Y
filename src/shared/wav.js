// @ts-check
/**
 * 16-bit PCM WAV encoder. Pure; used for "Record as .wav" and demo tracks.
 * @param {Float32Array[]} channels one Float32Array per channel, equal length
 * @param {number} sampleRate
 * @returns {ArrayBuffer}
 */
export function encodeWav(channels, sampleRate) {
  const numCh = channels.length;
  const len = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const dataSize = len * numCh * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (/** @type {number} */ off, /** @type {string} */ s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numCh * bytesPerSample, true);
  v.setUint16(32, numCh * bytesPerSample, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return buf;
}

/**
 * Parses a 16-bit PCM WAV produced by encodeWav (for tests).
 * @param {ArrayBuffer} buf
 */
export function decodeWav(buf) {
  const v = new DataView(buf);
  const numCh = v.getUint16(22, true);
  const sampleRate = v.getUint32(24, true);
  const dataSize = v.getUint32(40, true);
  const len = dataSize / (numCh * 2);
  const channels = Array.from({ length: numCh }, () => new Float32Array(len));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = v.getInt16(off, true);
      channels[c][i] = s < 0 ? s / 0x8000 : s / 0x7fff;
      off += 2;
    }
  }
  return { sampleRate, channels };
}
