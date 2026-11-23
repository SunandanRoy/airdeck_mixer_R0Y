// @ts-check
/**
 * Cleans YouTube video titles into "Artist" + "Title".
 * e.g. "Daft Punk - One More Time (Official Video) [4K]" ->
 *      { artist: 'Daft Punk', title: 'One More Time' }
 */

const NOISE = [
  'official\\s*(music\\s*)?video',
  'official\\s*audio',
  'official\\s*lyric\\s*video',
  'official\\s*visuali[sz]er',
  'official\\s*mv',
  'lyric\\s*video',
  'lyrics?',
  'audio',
  'visuali[sz]er',
  'music\\s*video',
  'video\\s*oficial',
  'videoclip',
  'm/?v',
  'hd',
  'hq',
  '4k',
  '8k',
  '1080p',
  '720p',
  'remastered(\\s*\\d{4})?',
  '\\d{4}\\s*remaster(ed)?',
  'explicit',
  'clean',
  'out\\s*now',
  'free\\s*download',
];
const NOISE_RE = new RegExp(`^\\s*(${NOISE.join('|')})\\s*$`, 'i');

/**
 * @param {string} raw
 * @param {string} [channel] used as the artist when the title has no "Artist - "
 * @returns {{artist: string, title: string}}
 */
export function cleanTitle(raw, channel = '') {
  let t = (raw || '').replace(/\s+/g, ' ').trim();

  // Drop bracketed groups that are pure noise: (Official Video), [4K], 【MV】
  t = t.replace(/[([【{]([^)\]】}]*)[)\]】}]/g, (whole, inner) => {
    const parts = String(inner).split(/[|/,]/).map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 && parts.every((p) => NOISE_RE.test(p)) ? ' ' : whole;
  });
  // Trailing "| Official Video" or "- Lyrics"
  t = t.replace(/\s*[|]\s*[^|]*$/, (m) => (NOISE_RE.test(m.replace(/^\s*\|\s*/, '')) ? '' : m));
  t = t.replace(/\s+(HD|HQ|4K|8K)\s*$/i, '');
  // Hashtags at the end
  t = t.replace(/(\s#[\p{L}\p{N}_]+)+\s*$/u, '');
  // Normalise featuring
  t = t.replace(/\s*\(?\b(feat\.?|featuring|ft\.?)\s+/gi, (m) => (m.trim().startsWith('(') ? ' (ft. ' : ' ft. '));
  t = t.replace(/\s+/g, ' ').trim();

  let artist = '';
  let title = t;
  const dash = t.match(/^(.+?)\s+[-–—~]\s+(.+)$/);
  if (dash) {
    artist = dash[1].trim();
    title = dash[2].trim();
  } else {
    const quoted = t.match(/^(.+?)\s*["“](.+?)["”]\s*$/);
    if (quoted) {
      artist = quoted[1].trim();
      title = quoted[2].trim();
    } else {
      artist = cleanChannel(channel);
    }
  }
  title = title.replace(/^["“'](.*)["”']$/, '$1').replace(/\s*[-–—|]\s*$/, '').trim();
  return { artist, title: title || t };
}

/** "ArtistVEVO" / "Artist - Topic" -> "Artist" */
export function cleanChannel(/** @type {string} */ channel) {
  return (channel || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s*Official$/i, '')
    .trim();
}
