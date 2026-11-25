#!/usr/bin/env node
/**
 * build.js — generator for "100 DAYS OF RAIN", a 60 s animated SVG short (1080x1920).
 *
 *   node build.js            -> writes rain100.svg and preview.html next to this file
 *
 * Everything procedural (rain, windows, ripples, debris, tally marks, crowds) comes
 * from one seeded PRNG, so every build is byte-identical.
 *
 * Timing model: every animation is either
 *   - a master-timeline animation, 60 s long, with keyframes written in seconds (tl()), or
 *   - a short loop whose duration divides 60 exactly (loop()), so the film loops cleanly.
 * The CSS animation clock is the only clock. render.js seeks it via document.getAnimations().
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 1080;
const H = 1920;
const DUR = 60;

/* ------------------------------------------------------------------ PRNG */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(100100);
const R = (a, b) => a + (b - a) * rand();
const RI = (a, b) => Math.floor(R(a, b + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const n1 = (v) => +v.toFixed(1);
const n2 = (v) => +v.toFixed(2);

/* -------------------------------------------------------------- easings */
const EASE = 'cubic-bezier(.45,.05,.25,1)'; // default in-out
const OUT = 'cubic-bezier(.16,1,.3,1)';
const IN = 'cubic-bezier(.55,0,.85,.25)';
const SOFT = 'cubic-bezier(.37,0,.63,1)'; // sine-like in-out for loops
const LIN = 'linear';

/* ----------------------------------------------------------- keyframes */
const kfMap = new Map();
let kfCount = 0;
function keyframes(body) {
  let name = kfMap.get(body);
  if (!name) {
    name = 'k' + (kfCount++).toString(36);
    kfMap.set(body, name);
  }
  return name;
}
const pct = (t) => +Math.min(100, Math.max(0, (t / DUR) * 100)).toFixed(4) + '%';

/**
 * Master-timeline animation. frames: [timeSeconds, css, easingForNextSegment?][]
 * Returns the value for a style attribute.
 */
function tl(frames, extra = '') {
  const fr = frames.slice().sort((a, b) => a[0] - b[0]);
  if (fr[0][0] > 0) fr.unshift([0, fr[0][1]]);
  if (fr[fr.length - 1][0] < DUR) fr.push([DUR, fr[fr.length - 1][1]]);
  const body = fr
    .map(([t, css, e]) => `${pct(t)}{${css}${e ? ';animation-timing-function:' + e : ''}}`)
    .join('');
  return `animation:${keyframes(body)} ${DUR}s ${EASE} infinite;${extra}`;
}
/** Short loop. body is raw keyframe text; dur must divide 60. phase in seconds. */
function loop(body, dur, phase = 0, ease = SOFT, extra = '') {
  if (Math.abs(DUR / dur - Math.round(DUR / dur)) > 1e-6) throw new Error('loop duration must divide 60: ' + dur);
  return `animation:${keyframes(body)} ${dur}s ${ease} ${n2(-phase)}s infinite;${extra}`;
}
const LOOP_DURS = [0.6, 0.75, 1, 1.2, 1.5, 2, 2.4, 3, 4, 5, 6];

/* --------------------------------------------------------- markup helpers */
const at = (x, y, inner, extra = '') => `<g transform="translate(${n1(x)} ${n1(y)})${extra}">${inner}</g>`;
const anim = (style, inner, attrs = '') => `<g style="${style}"${attrs ? ' ' + attrs : ''}>${inner}</g>`;
const fade = (frames) => tl(frames.map(([t, o, e]) => [t, `opacity:${o}`, e]));
/** Scene / shot visibility with overlapping crossfades of 2*h seconds. */
function window_(a, b, h = 0.3) {
  const fr = [];
  if (a <= 0) fr.push([0, 'opacity:1;visibility:visible']);
  else fr.push([a - h, 'opacity:0;visibility:hidden', EASE], [a + h, 'opacity:1;visibility:visible']);
  if (b >= DUR) fr.push([DUR, 'opacity:1;visibility:visible']);
  else fr.push([b - h, 'opacity:1;visibility:visible', EASE], [b + h, 'opacity:0;visibility:hidden']);
  return tl(fr);
}
/** Camera move on a layer: transform from -> to between a and b. */
const cam = (a, b, from, to, ease = EASE, extra = '') => tl([[a, `transform:${from}`, ease], [b, `transform:${to}`]], extra);
/** Gentle camera shake between a and b. */
function shake(a, b, amp, step = 0.12) {
  const fr = [[a, 'transform:translate(0px,0px)', SOFT]];
  for (let t = a + step; t < b - step; t += step) {
    fr.push([t, `transform:translate(${n1(R(-amp, amp))}px,${n1(R(-amp, amp))}px)`, SOFT]);
  }
  fr.push([b, 'transform:translate(0px,0px)']);
  return tl(fr);
}
/** Stroke-draw (path must carry pathLength="1"). */
const draw = (a, b, ease = EASE) =>
  tl([[a, 'stroke-dashoffset:1', ease], [b, 'stroke-dashoffset:0']], 'stroke-dasharray:1 1');

function lg(id, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1, extra = '') {
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${extra}>${stops
    .map(([o, c, op]) => `<stop offset="${o}" stop-color="${c}"${op !== undefined ? ` stop-opacity="${op}"` : ''}/>`)
    .join('')}</linearGradient>`;
}
function rg(id, stops, cx = 0.5, cy = 0.5, r = 0.5, extra = '') {
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"${extra}>${stops
    .map(([o, c, op]) => `<stop offset="${o}" stop-color="${c}"${op !== undefined ? ` stop-opacity="${op}"` : ''}/>`)
    .join('')}</radialGradient>`;
}
const rect = (x, y, w, h, fill, extra = '') =>
  `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;
const full = (fill, extra = '') => rect(0, 0, W, H, fill, extra);
const glow = (x, y, r, grad, extra = '') => `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(r)}" fill="url(#${grad})"${extra ? ' ' + extra : ''}/>`;

/* ======================================================================
 * DEFS: gradients, filters, symbols
 * ==================================================================== */
const defs = [];
const D = (s) => defs.push(s);

/* ---- filters (used sparingly) */
D(`<filter id="blur3" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>`);
D(`<filter id="blur8" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="8"/></filter>`);
D(`<filter id="blur20" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="20"/></filter>`);
D(`<filter id="blur40" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>`);
D(`<filter id="shimmer" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.006 0.09" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="22" xChannelSelector="R" yChannelSelector="G"/></filter>`);
D(`<filter id="shimmerSoft" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.01 0.06" numOctaves="1" seed="3"/><feDisplacementMap in="SourceGraphic" scale="14" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="2.5"/></filter>`);

/* ---- shared gradients */
D(lg('gCoat', [[0, '#FFD84D'], [0.55, '#FFC21A'], [1, '#EAA30A']], 0, 0, 1, 1));
D(lg('gCoatArm', [[0, '#FFD13A'], [1, '#E9A70C']], 0, 0, 1, 0));
D(lg('gShawl', [[0, '#A3A8AF'], [1, '#6C727B']], 0, 0, 1, 1));
D(rg('gWarmGlow', [[0, '#FFE2A0', 0.95], [0.35, '#FFB65C', 0.45], [1, '#FF9A3C', 0]]));
D(rg('gSoftGlow', [[0, '#FFF1C8', 0.9], [1, '#FFF1C8', 0]]));
D(rg('gCoolGlow', [[0, '#D8F2FF', 0.85], [1, '#9FD4EC', 0]]));
D(rg('gWhiteGlow', [[0, '#FFFFFF', 1], [0.3, '#FFFFFF', 0.5], [1, '#FFFFFF', 0]]));
D(rg('gGoldGlow', [[0, '#FFE7A6', 1], [0.4, '#FFC75A', 0.55], [1, '#FFB23C', 0]]));
D(lg('gCone', [[0, '#FFE2A3', 0.55], [1, '#FFE2A3', 0]]));
D(lg('gConeCool', [[0, '#EAF6FF', 0.5], [1, '#EAF6FF', 0]]));
D(lg('gBeam', [[0, '#FFFFFF', 0.55], [1, '#FFFFFF', 0]]));
D(lg('gShaft', [[0, '#FFF0B8', 0.95], [0.5, '#FFD36E', 0.5], [1, '#FFC24A', 0]]));
D(rg('gVignette', [[0.55, '#000', 0], [1, '#000', 0.62]], 0.5, 0.48, 0.75));
D(lg('gScrimB', [[0, '#000', 0], [1, '#000', 0.55]]));
D(lg('gScrimT', [[0, '#000', 0.42], [1, '#000', 0]]));
D(lg('gStreak', [[0, '#FFD98A', 0.7], [1, '#FFD98A', 0]]));
D(lg('gStreakCool', [[0, '#BFE6F5', 0.6], [1, '#BFE6F5', 0]]));

/* ---- film grain: a tiny seeded noise PNG (no external asset, built here) */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    let c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngGA(w, h, px) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 4; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 2 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 2 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      raw[y * (w * 2 + 1) + 1 + x * 2] = px[(y * w + x) * 2];
      raw[y * (w * 2 + 1) + 2 + x * 2] = px[(y * w + x) * 2 + 1];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
{
  const G = 160;
  const grainRand = mulberry32(42);
  const px = new Uint8Array(G * G * 2);
  for (let i = 0; i < G * G; i++) {
    px[i * 2] = grainRand() > 0.5 ? 255 : 0;
    px[i * 2 + 1] = Math.floor(grainRand() ** 2 * 90);
  }
  const b64 = pngGA(G, G, px).toString('base64');
  D(`<pattern id="grain" width="${G}" height="${G}" patternUnits="userSpaceOnUse"><image href="data:image/png;base64,${b64}" width="${G}" height="${G}"/></pattern>`);
}

/* ---- window patterns for building faces */
function winPattern(id, { cw, ch, cols, rows, lit, dark, p, ww = 0.5, wh = 0.55 }) {
  let s = `<pattern id="${id}" width="${cw * cols}" height="${ch * rows}" patternUnits="userSpaceOnUse">`;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const on = rand() < p;
      s += rect(c * cw + (cw * (1 - ww)) / 2, r * ch + (ch * (1 - wh)) / 2, cw * ww, ch * wh, on ? lit : dark, on ? `opacity="${n2(R(0.6, 1))}"` : '');
    }
  }
  return s + '</pattern>';
}
D(winPattern('winWarm', { cw: 34, ch: 46, cols: 6, rows: 6, lit: '#FFCB72', dark: '#3A1C26', p: 0.55 }));
D(winPattern('winWarmFar', { cw: 18, ch: 24, cols: 8, rows: 6, lit: '#FFD38A', dark: '#6B3240', p: 0.4 }));
D(winPattern('winCool', { cw: 36, ch: 48, cols: 6, rows: 6, lit: '#E8C98A', dark: '#22343D', p: 0.3 }));
D(winPattern('winCoolFar', { cw: 20, ch: 26, cols: 8, rows: 6, lit: '#C9D6D2', dark: '#3E525B', p: 0.25 }));
D(winPattern('winSlate', { cw: 40, ch: 54, cols: 5, rows: 6, lit: '#B9C4C6', dark: '#1B272E', p: 0.12 }));
D(winPattern('winGold', { cw: 34, ch: 46, cols: 6, rows: 6, lit: '#FFE1A0', dark: '#5C4A3E', p: 0.35 }));

/* ---- rain tiles: three parallax layers, seeded */
const RT_W = 1700;
const RT_H = 900;
function rainTile(id, n, sw, l0, l1, o0, o1) {
  let s = `<symbol id="${id}" overflow="visible">`;
  for (let i = 0; i < n; i++) {
    const x = n1(R(0, RT_W));
    const y = n1(R(0, RT_H));
    s += `<line x1="${x}" y1="${y}" x2="${x}" y2="${n1(y + R(l0, l1))}" stroke-width="${n2(sw * R(0.8, 1.2))}" stroke-opacity="${n2(R(o0, o1))}"/>`;
  }
  return s + '</symbol>';
}
D(rainTile('rainFar', 190, 1.4, 26, 48, 0.25, 0.55));
D(rainTile('rainMid', 95, 2.4, 55, 90, 0.35, 0.7));
D(rainTile('rainNear', 34, 4.2, 110, 170, 0.45, 0.8));
const RAIN_SPEED = { far: 0.5, mid: 0.75, near: 1.2 };
const RAIN_SYM = { far: 'rainFar', mid: 'rainMid', near: 'rainNear' };
/** A rain layer covering the whole frame, slanted. */
function rain(layer, { op = 1, color = '#CFE3EE', dur, slant = 12, style = '' } = {}) {
  const d = dur ?? RAIN_SPEED[layer];
  const uses = [-1, 0, 1, 2].map((k) => `<use href="#${RAIN_SYM[layer]}" y="${k * RT_H}"/>`).join('');
  return `<g opacity="${op}"${style ? ` style="${style}"` : ''}><g transform="rotate(${slant} 540 960) translate(-310 -500)"><g stroke="${color}" stroke-linecap="round" style="${loop(`0%{transform:translateY(0px)}100%{transform:translateY(${RT_H}px)}`, d, 0, LIN)}">${uses}</g></g></g>`;
}

/* ---- ripples + splash crowns on wet surfaces */
const RIP_KF = `0%{transform:scale(.06);opacity:0}6%{opacity:.85}100%{transform:scale(1);opacity:0}`;
const CROWN_KF = `0%{transform:scale(.2);opacity:0}3%{opacity:1}20%{transform:scale(1);opacity:0}100%{transform:scale(1);opacity:0}`;
D(`<symbol id="crown" overflow="visible"><g stroke-linecap="round" fill="none"><path d="M0 0 L-9 -12 M0 0 L-3 -16 M0 0 L3 -16 M0 0 L9 -12"/></g><circle cx="-11" cy="-16" r="1.8"/><circle cx="11" cy="-16" r="1.8"/><circle cx="0" cy="-20" r="1.6"/></symbol>`);
function ripples(n, { x0, x1, y0, y1, color = '#DCEFF6', r0 = 14, r1 = 40, persp = true, squash = 0.28, crowns = true, sw = 2 }) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = R(x0, x1);
    const y = R(y0, y1);
    const k = persp ? 0.35 + 0.65 * ((y - y0) / Math.max(1, y1 - y0)) : 1;
    const r = R(r0, r1) * k;
    const dur = pick([1.5, 2, 2.4]);
    const ph = R(0, dur);
    s += at(x, y, anim(loop(RIP_KF, dur, ph, OUT), `<ellipse rx="${n1(r)}" ry="${n1(r)}" fill="none" stroke="${color}" stroke-width="${n2(sw / squash * 0.5)}"/>`), ` scale(1 ${squash})`);
    if (crowns && rand() < 0.55) {
      s += at(x, y, anim(loop(CROWN_KF, dur, ph, OUT), `<use href="#crown" stroke="${color}" fill="${color}" stroke-width="1.6" transform="scale(${n2(k * 1.1)})"/>`));
    }
  }
  return `<g>${s}</g>`;
}

/* ---- tiny stroke font (title cards + counter are paths, not text) */
const GLYPH = {
  0: 'M20 0C34 0 40 12 40 30C40 48 34 60 20 60C6 60 0 48 0 30C0 12 6 0 20 0Z',
  1: 'M7 13L22 0V60M7 60H37',
  2: 'M2 14C4 4 12 0 20 0C30 0 38 6 38 16C38 28 26 36 2 60H40',
  3: 'M2 6C8 1 14 0 20 0C30 0 37 6 37 15C37 24 30 29 18 29C32 29 39 36 39 45C39 55 30 60 20 60C12 60 5 57 1 52',
  4: 'M30 60V0L0 42H40',
  5: 'M36 0H6L3 27C8 23 14 22 20 22C32 22 39 30 39 41C39 53 30 60 19 60C11 60 5 57 1 52',
  6: 'M34 4C30 1 25 0 20 0C8 0 1 12 1 32C1 50 8 60 20 60C31 60 39 52 39 41C39 30 31 23 20 23C11 23 4 28 1 36',
  7: 'M0 0H40L14 60',
  8: 'M20 29C9 29 3 23 3 15C3 6 10 0 20 0C30 0 37 6 37 15C37 23 31 29 20 29C8 29 1 36 1 45C1 54 9 60 20 60C31 60 39 54 39 45C39 36 32 29 20 29Z',
  9: 'M6 56C10 59 15 60 20 60C32 60 39 48 39 28C39 10 32 0 20 0C9 0 1 8 1 19C1 30 9 37 20 37C29 37 36 32 39 24',
  D: 'M3 0V60H16C32 60 40 48 40 30C40 12 32 0 16 0Z',
  A: 'M0 60L20 0L40 60M7 40H33',
  Y: 'M0 0L20 30L40 0M20 30V60',
  S: 'M37 8C33 3 27 0 20 0C10 0 3 5 3 15C3 35 39 25 39 45C39 55 31 60 20 60C12 60 5 57 1 51',
  O: 'M20 0C34 0 40 12 40 30C40 48 34 60 20 60C6 60 0 48 0 30C0 12 6 0 20 0Z',
  F: 'M38 0H3V60M3 29H30',
  R: 'M3 60V0H22C32 0 38 6 38 16C38 26 32 32 22 32H3M21 32L40 60',
  I: 'M20 0V60',
  N: 'M3 60V0L37 60V0',
  '₹': 'M3 3H37M3 18H37M9 3C33 3 33 32 9 32H3L31 60',
};
for (const [k, d] of Object.entries(GLYPH)) {
  D(`<symbol id="g${k === '₹' ? 'R2' : k}" overflow="visible"><path pathLength="1" d="${d}"/></symbol>`);
}
const gid = (ch) => (ch === '₹' ? 'gR2' : 'g' + ch);
/** Text as stroked path glyphs. Returns [markup, width]. */
function glyphs(str, { s = 1, adv = 56, sw = 8, stagger = null } = {}) {
  let x = 0;
  let out = '';
  [...str].forEach((ch, i) => {
    if (ch === ' ') { x += 34; return; }
    const g = `<use href="#${gid(ch)}" transform="translate(${n1(x * s)} 0) scale(${s})"/>`;
    out += stagger ? stagger(i, g, x * s) : g;
    x += adv;
  });
  return [`<g fill="none" stroke-width="${n2(sw / s)}" stroke-linecap="round" stroke-linejoin="round">${out}</g>`, (x - (adv - 40)) * s];
}

/* ---- MEERA (age 9) : drawn once as symbols, composed per scene */
const SKIN = '#B9784E';
const SKIN_D = '#93583A';
const HAIR = '#16141B';
const INK = '#1B1A22';
const COAT = '#FFC21A';
const BOOT = '#D62839';
D(`<symbol id="m-legs" overflow="visible">
<rect x="-30" y="-80" width="18" height="46" rx="7" fill="#2A2D3A"/><rect x="12" y="-80" width="18" height="46" rx="7" fill="#2A2D3A"/>
<path d="M-38 -46H-10V-4Q-10 0 -14 0H-44Q-49 0 -49 -5Q-49 -13 -38 -15Z" fill="${BOOT}"/>
<path d="M10 -46H38V-15Q49 -13 49 -5Q49 0 44 0H14Q10 0 10 -4Z" fill="${BOOT}"/>
<rect x="-39" y="-48" width="30" height="8" rx="3" fill="#A81C2C"/><rect x="9" y="-48" width="30" height="8" rx="3" fill="#A81C2C"/>
<path d="M-33 -38V-14M15 -38V-14" stroke="#F06A78" stroke-width="3" stroke-linecap="round" opacity=".7"/>
</symbol>`);
D(`<symbol id="m-coat" overflow="visible">
<rect x="-9" y="-216" width="18" height="16" fill="${SKIN_D}"/>
<path d="M-44 -206Q0 -220 44 -206Q60 -150 74 -74Q76 -63 63 -61Q0 -51 -63 -61Q-76 -63 -74 -74Q-60 -150 -44 -206Z" fill="url(#gCoat)"/>
<path d="M18 -210Q52 -150 60 -62Q70 -64 74 -74Q60 -150 44 -206Z" fill="#E59D06" opacity=".55"/>
<path d="M-24 -210Q0 -196 24 -210" stroke="#E9A80C" stroke-width="6" fill="none" stroke-linecap="round"/>
<path d="M2 -200V-58" stroke="#DE9A00" stroke-width="3"/>
<circle cx="10" cy="-178" r="4" fill="#C98300"/><circle cx="10" cy="-148" r="4" fill="#C98300"/><circle cx="10" cy="-118" r="4" fill="#C98300"/>
<path d="M-50 -104H-24M26 -104H52" stroke="#D99400" stroke-width="3" stroke-linecap="round"/>
<path d="M-66 -74Q0 -62 66 -74" stroke="#FFF2B8" stroke-width="5" fill="none" opacity=".75"/>
</symbol>`);
D(`<symbol id="m-arm" overflow="visible"><rect x="-14" y="-8" width="28" height="86" rx="14" fill="url(#gCoatArm)"/><rect x="-15" y="66" width="30" height="11" rx="5" fill="#E2A00A"/><circle cy="88" r="12" fill="${SKIN}"/></symbol>`);
D(`<symbol id="m-head" overflow="visible">
<circle r="61" fill="#F0AE0E"/>
<circle r="45" cy="2" fill="${SKIN}"/>
<path d="M-50 8Q-55 -40 -30 -53Q0 -66 30 -53Q55 -40 50 8Q46 16 38 13L37 -12Q20 -24 -2 -22Q-24 -28 -37 -12L-38 13Q-46 16 -50 8Z" fill="${HAIR}"/>
<path d="M-28 -44Q-6 -54 18 -48" stroke="#3C3946" stroke-width="4" fill="none" stroke-linecap="round" opacity=".7"/>
<path d="M-58 14Q-64 -62 0 -66Q64 -62 58 14" stroke="${COAT}" stroke-width="11" fill="none" stroke-linecap="round"/>
<path d="M-4 9Q0 12 4 9" stroke="${SKIN_D}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
</symbol>`);
const eyeHi = (x, y) => `<circle cx="${x + 1.8}" cy="${y - 1.8}" r="1.6" fill="#fff"/>`;
D(`<symbol id="m-f-joy" overflow="visible">
<path d="M-24 1Q-16 -9 -8 1M8 1Q16 -9 24 1" stroke="${INK}" stroke-width="3.6" fill="none" stroke-linecap="round"/>
<path d="M-14 16Q0 36 14 16Z" fill="#7A1F24"/><path d="M-7 25Q0 31 7 25Q0 28 -7 25Z" fill="#E66A6A"/>
<ellipse cx="-27" cy="14" rx="7" ry="4" fill="#E8665A" opacity=".45"/><ellipse cx="27" cy="14" rx="7" ry="4" fill="#E8665A" opacity=".45"/>
<path d="M-25 -13Q-17 -18 -9 -14M9 -14Q17 -18 25 -13" stroke="${HAIR}" stroke-width="3" fill="none" stroke-linecap="round"/>
</symbol>`);
D(`<symbol id="m-f-bored" overflow="visible">
<path d="M-21 1A5.5 5.5 0 0 0 -10 1Z" fill="${INK}"/><path d="M10 1A5.5 5.5 0 0 0 21 1Z" fill="${INK}"/>
<path d="M-23 0H-8M8 0H23" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
<path d="M-24 -12H-9M9 -11H24" stroke="${HAIR}" stroke-width="3" stroke-linecap="round" opacity=".85"/>
<path d="M-9 22Q2 19 11 23" stroke="#5A2A2A" stroke-width="3" fill="none" stroke-linecap="round"/>
<ellipse cx="22" cy="17" rx="8" ry="6" fill="${SKIN_D}" opacity=".25"/>
</symbol>`);
D(`<symbol id="m-f-worry" overflow="visible">
<circle cx="-16" cy="1" r="5.6" fill="${INK}"/><circle cx="16" cy="1" r="5.6" fill="${INK}"/>${eyeHi(-16, 1)}${eyeHi(16, 1)}
<path d="M-26 -10L-9 -16M9 -16L26 -10" stroke="${HAIR}" stroke-width="3.2" stroke-linecap="round"/>
<path d="M-7 24Q0 18 7 24" stroke="#5A2A2A" stroke-width="3" fill="none" stroke-linecap="round"/>
</symbol>`);
D(`<symbol id="m-f-tired" overflow="visible">
<path d="M-21 2A5.5 4.5 0 0 0 -10 2Z" fill="${INK}"/><path d="M10 2A5.5 4.5 0 0 0 21 2Z" fill="${INK}"/>
<path d="M-23 1Q-15 -2 -8 1M8 1Q15 -2 23 1" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>
<path d="M-21 9Q-15 11 -10 9M10 9Q15 11 21 9" stroke="${SKIN_D}" stroke-width="2" fill="none" opacity=".8"/>
<path d="M-24 -10L-9 -13M9 -13L24 -10" stroke="${HAIR}" stroke-width="3" stroke-linecap="round" opacity=".85"/>
<path d="M-7 23H7" stroke="#5A2A2A" stroke-width="3" stroke-linecap="round"/>
</symbol>`);
D(`<symbol id="m-f-resolve" overflow="visible">
<circle cx="-16" cy="1" r="5" fill="${INK}"/><circle cx="16" cy="1" r="5" fill="${INK}"/>${eyeHi(-16, 1)}${eyeHi(16, 1)}
<path d="M-23 -4Q-16 -7 -9 -4M9 -4Q16 -7 23 -4" stroke="${INK}" stroke-width="2" fill="none" opacity=".6"/>
<path d="M-24 -13L-9 -13M9 -13L24 -13" stroke="${HAIR}" stroke-width="3.2" stroke-linecap="round"/>
<path d="M-8 20Q0 25 8 20" stroke="#5A2A2A" stroke-width="3" fill="none" stroke-linecap="round"/>
<ellipse cx="-26" cy="14" rx="6" ry="3.5" fill="#E8665A" opacity=".25"/><ellipse cx="26" cy="14" rx="6" ry="3.5" fill="#E8665A" opacity=".25"/>
</symbol>`);
/**
 * Meera, feet at (0,0), ~300 px tall at scale 1.
 * face: string or [[face, fromT, toT], ...] crossfades. arms: degrees (0 = hanging) or style strings.
 */
function meera({ face = 'joy', armL = 12, armR = -12, armLStyle = '', armRStyle = '', headStyle = '', bodyStyle = '', look = [0, 0], legs = true, faceSwap = null } = {}) {
  const arm = (x, deg, style) => at(x, -194, style ? anim(style, '<use href="#m-arm"/>') : `<use href="#m-arm" transform="rotate(${deg})"/>`);
  let faces;
  if (faceSwap) {
    faces = faceSwap.map(([f, a, b]) => {
      const fr = [];
      if (a > 0) fr.push([a - 0.25, 'opacity:0'], [a + 0.25, 'opacity:1']); else fr.push([0, 'opacity:1']);
      if (b < DUR) fr.push([b - 0.25, 'opacity:1'], [b + 0.25, 'opacity:0']);
      return anim(tl(fr), `<use href="#m-f-${f}" x="${look[0]}" y="${look[1]}"/>`);
    }).join('');
  } else faces = `<use href="#m-f-${face}" x="${look[0]}" y="${look[1]}"/>`;
  const inner = `${legs ? '<use href="#m-legs"/>' : ''}${arm(-44, armL, armLStyle)}${arm(44, armR, armRStyle)}<use href="#m-coat"/>${at(0, -254, headStyle ? anim(headStyle, `<use href="#m-head"/>${faces}`) : `<use href="#m-head"/>${faces}`)}`;
  return bodyStyle ? anim(bodyStyle, inner) : `<g>${inner}</g>`;
}

/* ---- DADAJI : bust (origin = waist centre), head, chai, radio */
const DSKIN = '#94603F';
D(`<symbol id="d-bust" overflow="visible">
<rect x="-15" y="-212" width="30" height="26" fill="#7E4F33"/>
<path d="M-118 0Q-122 -110 -96 -152Q-74 -188 -36 -194L36 -194Q74 -188 96 -152Q122 -110 118 0Z" fill="url(#gShawl)"/>
<path d="M-31 -194L0 -136L31 -194Z" fill="#EDEDE8"/>
<path d="M-72 -172Q-38 -110 -62 -10M72 -172Q40 -110 64 -10M-20 -140Q0 -100 22 -142" stroke="#585D66" stroke-width="3.5" fill="none" opacity=".55" stroke-linecap="round"/>
<path d="M-96 -40H96" stroke="#B9BEC5" stroke-width="5" stroke-dasharray="2 10" opacity=".5"/>
</symbol>`);
D(`<symbol id="d-head" overflow="visible">
<ellipse cx="-49" cy="4" rx="8" ry="13" fill="#7E4F33"/><ellipse cx="49" cy="4" rx="8" ry="13" fill="#7E4F33"/>
<ellipse rx="48" ry="55" fill="${DSKIN}"/>
<ellipse cx="-43" cy="-12" rx="11" ry="22" fill="#ECECEC"/><ellipse cx="43" cy="-12" rx="11" ry="22" fill="#ECECEC"/>
<ellipse cx="-12" cy="-36" rx="15" ry="7" fill="#fff" opacity=".13"/>
<path d="M-32 -21Q-20 -29 -7 -21M7 -21Q20 -29 32 -21" stroke="#F4F4F4" stroke-width="6" fill="none" stroke-linecap="round"/>
<circle cx="-19" cy="-3" r="3.6" fill="${INK}"/><circle cx="19" cy="-3" r="3.6" fill="${INK}"/>
<path d="M-26 -10Q-19 -6 -12 -10M12 -10Q19 -6 26 -10" stroke="${INK}" stroke-width="2" fill="none" opacity=".5"/>
<circle cx="-19" cy="-3" r="14" fill="#fff" fill-opacity=".14" stroke="#2B2B2B" stroke-width="3.5"/><circle cx="19" cy="-3" r="14" fill="#fff" fill-opacity=".14" stroke="#2B2B2B" stroke-width="3.5"/>
<path d="M-5 -5Q0 -9 5 -5M-33 -5L-47 -1M33 -5L47 -1" stroke="#2B2B2B" stroke-width="3" fill="none"/>
<path d="M-24 -9L-16 -11" stroke="#fff" stroke-width="2.5" opacity=".5" stroke-linecap="round"/>
<path d="M1 -1Q7 15 -2 18" stroke="#6E4127" stroke-width="3" fill="none" stroke-linecap="round"/>
<path d="M0 19Q-14 13 -31 23Q-35 31 -24 31Q-12 27 0 27Q12 27 24 31Q35 31 31 23Q14 13 0 19Z" fill="#F5F5F2"/>
<path d="M-12 36Q0 44 12 36" stroke="#4E2418" stroke-width="3" fill="none" stroke-linecap="round"/>
<path d="M-36 12Q-33 22 -36 30M36 12Q33 22 36 30" stroke="#6E4127" stroke-width="2" fill="none" opacity=".6"/>
</symbol>`);
D(`<symbol id="d-cup" overflow="visible"><path d="M-15 -42H15L11 0H-11Z" fill="#fff" fill-opacity=".28" stroke="#E8E2D6" stroke-width="2"/><path d="M-13.5 -30H13.5L11 0H-11Z" fill="#B06A2C"/><path d="M-13 -30H13" stroke="#E7C08E" stroke-width="2"/></symbol>`);
D(`<symbol id="d-hand" overflow="visible"><path d="M-24 -13Q0 -21 22 -11Q32 0 22 9Q0 15 -24 11Z" fill="${DSKIN}"/><path d="M4 -16Q12 -18 16 -14M6 12Q14 13 18 9" stroke="#7E4F33" stroke-width="2" fill="none"/></symbol>`);
D(`<symbol id="d-radio" overflow="visible"><path d="M22 -24L58 -108" stroke="#A9B0B8" stroke-width="3" stroke-linecap="round"/><circle cx="58" cy="-108" r="3.5" fill="#C9CED4"/><rect x="-38" y="-26" width="76" height="52" rx="8" fill="#55606B"/><rect x="-32" y="-20" width="36" height="40" rx="5" fill="#3B444D"/>${[-24, -16, -8, 0].map((x) => [-12, -4, 4, 12].map((y) => `<circle cx="${x - 2}" cy="${y}" r="2" fill="#7F8A94"/>`).join('')).join('')}<rect x="10" y="-16" width="22" height="9" rx="2" fill="#D9C27A"/><circle cx="21" cy="12" r="7" fill="#2E353C" stroke="#8D98A2" stroke-width="2"/></symbol>`);
D(`<symbol id="d-legs" overflow="visible"><path d="M-70 -4H70L60 150H-60Z" fill="#E9E6DE"/><path d="M0 0V150M-30 20L-24 150M30 20L24 150" stroke="#C8C3B6" stroke-width="3"/><rect x="-62" y="146" width="48" height="14" rx="6" fill="#5A3B28"/><rect x="14" y="146" width="48" height="14" rx="6" fill="#5A3B28"/></symbol>`);
/** Dadaji bust, waist at (0,0). */
const dadaji = ({ headStyle = '' } = {}) => `<use href="#d-bust"/>${at(0, -244, headStyle ? anim(headStyle, '<use href="#d-head"/>') : '<use href="#d-head"/>')}`;
/** Rising chai steam at (0,0). */
function steam(n = 3, scale = 1, color = '#FFFFFF') {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += at((i - (n - 1) / 2) * 12 * scale, 0, anim(loop(`0%{transform:translateY(0px) scaleX(1);opacity:0}25%{opacity:.55}100%{transform:translateY(${-60 * scale}px) scaleX(1.6);opacity:0}`, 2, i * 0.66, LIN), `<path d="M0 0C-8 -16 8 -30 0 -46C-8 -62 6 -74 0 -86" transform="scale(${scale})" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round"/>`));
  }
  return s;
}

/* ---- crowd, props */
D(`<symbol id="person" overflow="visible"><circle cy="-112" r="15"/><path d="M-20 -94Q0 -100 20 -94L26 -40H-26Z"/><rect x="-16" y="-44" width="12" height="44" rx="5"/><rect x="4" y="-44" width="12" height="44" rx="5"/></symbol>`);
D(`<symbol id="umbrella" overflow="visible"><path d="M-80 0Q-78 -58 0 -64Q78 -58 80 0Q66 -10 53 0Q40 -10 27 0Q13 -10 0 0Q-13 -10 -27 0Q-40 -10 -53 0Q-66 -10 -80 0Z"/><path d="M0 -64V-74" stroke="#222" stroke-width="3"/><path d="M0 0V58Q0 66 -8 64" stroke="#222" stroke-width="3" fill="none"/><path d="M-40 -6Q-30 -50 0 -63M40 -6Q30 -50 0 -63" stroke="#000" stroke-opacity=".18" stroke-width="2" fill="none"/></symbol>`);
D(`<symbol id="carRear" overflow="visible"><path d="M-92 -16Q-96 -56 -70 -62L-50 -98Q-44 -106 -30 -106H30Q44 -106 50 -98L70 -62Q96 -56 92 -16Q92 0 80 0H-80Q-92 0 -92 -16Z"/><path d="M-44 -94H44L60 -64H-60Z" fill="#1A2329" fill-opacity=".85"/><rect x="-84" y="-48" width="30" height="12" rx="4" fill="#FF3B3B"/><rect x="54" y="-48" width="30" height="12" rx="4" fill="#FF3B3B"/><rect x="-24" y="-34" width="48" height="12" rx="2" fill="#E8E2C8" fill-opacity=".7"/><rect x="-80" y="-4" width="26" height="14" rx="4" fill="#111"/><rect x="54" y="-4" width="26" height="14" rx="4" fill="#111"/></symbol>`);
D(`<symbol id="busRear" overflow="visible"><rect x="-120" y="-250" width="240" height="250" rx="22"/><rect x="-104" y="-232" width="208" height="96" rx="10" fill="#1A252B" fill-opacity=".9"/><rect x="-100" y="-260" width="200" height="22" rx="6" fill="#0E1417" fill-opacity=".6"/><rect x="-108" y="-80" width="30" height="20" rx="4" fill="#FF3B3B"/><rect x="78" y="-80" width="30" height="20" rx="4" fill="#FF3B3B"/><rect x="-50" y="-60" width="100" height="20" rx="3" fill="#DCD6BC" fill-opacity=".7"/><rect x="-120" y="-24" width="240" height="24" rx="4" fill="#0E1417" fill-opacity=".5"/></symbol>`);
D(`<symbol id="carSide" overflow="visible"><path d="M-110 -20Q-112 -54 -84 -58L-50 -92Q-42 -100 -26 -100H34Q50 -100 60 -88L84 -58Q112 -54 110 -22Q110 0 96 0H-96Q-110 0 -110 -20Z"/><path d="M-44 -86H-6V-60H-70ZM4 -86H40L64 -60H4Z" fill="#1A252B" fill-opacity=".85"/><circle cx="-62" cy="0" r="20" fill="#151A1E"/><circle cx="62" cy="0" r="20" fill="#151A1E"/><rect x="100" y="-44" width="10" height="10" rx="2" fill="#FFE7A3"/></symbol>`);
D(`<symbol id="busSide" overflow="visible"><rect x="-250" y="-300" width="500" height="300" rx="26"/><rect x="-250" y="-300" width="500" height="34" rx="16" fill="#000" fill-opacity=".15"/>${[0, 1, 2, 3, 4, 5].map((i) => rect(-226 + i * 76, -246, 62, 82, '#1A262C', 'rx="6" fill-opacity=".9"')).join('')}<rect x="-250" y="-140" width="500" height="10" fill="#fff" fill-opacity=".25"/><rect x="200" y="-110" width="40" height="110" fill="#1A262C" fill-opacity=".6"/></symbol>`);
D(`<symbol id="cat" overflow="visible"><ellipse cx="0" cy="-26" rx="26" ry="28"/><circle cx="-6" cy="-62" r="17"/><path d="M-20 -70L-18 -88L-8 -76ZM2 -76L10 -88L10 -70Z"/><circle cx="-12" cy="-64" r="2.6" fill="#E6D36A"/><circle cx="0" cy="-64" r="2.6" fill="#E6D36A"/></symbol>`);
D(`<symbol id="lampHead" overflow="visible"><path d="M0 0V-14Q0 -26 18 -26H40" stroke="#1A1E22" stroke-width="7" fill="none"/><path d="M30 -30H62L56 -22H36Z" fill="#1A1E22"/></symbol>`);
D(`<symbol id="pot" overflow="visible"><path d="M-34 -52H34L26 0H-26Z" fill="#B5583A"/><rect x="-38" y="-60" width="76" height="12" rx="4" fill="#C96A48"/><path d="M-30 -48H30" stroke="#3E2418" stroke-width="5"/><path d="M-20 -40L-14 -6" stroke="#fff" stroke-opacity=".18" stroke-width="5"/></symbol>`);
D(`<symbol id="boat" overflow="visible"><path d="M-30 0L30 0L22 10H-22Z" fill="#E9EEF0"/><path d="M-30 0L-4 -26L0 0ZM0 0L4 -26L30 0Z" fill="#F7FAFB"/><path d="M-4 -26L4 -26L0 0Z" fill="#C9D3D8"/></symbol>`);
D(`<symbol id="tuft" overflow="visible"><g stroke-linecap="round" fill="none"><path d="M0 0Q-4 -40 -22 -70" stroke="#5E9E3A" stroke-width="5"/><path d="M0 0Q2 -50 4 -86" stroke="#78B648" stroke-width="5"/><path d="M0 0Q6 -40 24 -66" stroke="#4E8C30" stroke-width="5"/><path d="M0 0Q-2 -30 -12 -54" stroke="#8CC65A" stroke-width="4"/><path d="M0 0Q4 -30 12 -50" stroke="#6AA840" stroke-width="4"/></g></symbol>`);
D(`<symbol id="drop" overflow="visible"><path d="M0 -26C6 -12 10 -4 10 4A10 10 0 0 1 -10 4C-10 -4 -6 -12 0 -26Z"/></symbol>`);
D(`<symbol id="bird" overflow="visible"><path d="M-16 0Q-8 -8 0 0Q8 -8 16 0" fill="none" stroke-width="3" stroke-linecap="round"/></symbol>`);
D(`<symbol id="drum" overflow="visible"><rect x="-26" y="-34" width="52" height="34" rx="6"/><path d="M-26 -24H26M-26 -10H26" stroke="#000" stroke-opacity=".25" stroke-width="3"/></symbol>`);

/* ---- building helpers */
/** Flat building with a pattern of windows. */
function building(x, baseY, w, h, fill, pat, { roof = true, inset = 14 } = {}) {
  let s = rect(0, -h, w, h, fill);
  if (pat) s += rect(inset, -h + inset + 6, w - inset * 2, h - inset * 2 - 6, `url(#${pat})`);
  if (roof) {
    if (rand() < 0.4) s += rect(w * 0.15, -h - R(16, 30), R(30, 50), 30, fill) + rect(w * 0.15 - 4, -h - 34, 60, 8, fill);
    if (rand() < 0.35) s += `<path d="M${n1(w * 0.7)} ${-h}V${n1(-h - R(40, 80))}" stroke="${fill}" stroke-width="3"/>`;
  }
  return at(x, baseY, s);
}
function skyline(x0, x1, baseY, hMin, hMax, fill, pat, wMin = 60, wMax = 150, opts = {}) {
  let s = '';
  let x = x0;
  while (x < x1) {
    const w = R(wMin, wMax);
    s += building(x, baseY, w, R(hMin, hMax), fill, pat, opts);
    x += w + R(-10, 6);
  }
  return s;
}
function clouds(n, { x0, x1, y0, y1, rx0, rx1, color, op = 1, blur = 'blur20' }) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const rx = R(rx0, rx1);
    s += `<ellipse cx="${n1(R(x0, x1))}" cy="${n1(R(y0, y1))}" rx="${n1(rx)}" ry="${n1(rx * R(0.25, 0.45))}" fill="${color}" opacity="${n2(op * R(0.6, 1))}"/>`;
  }
  return `<g filter="url(#${blur})">${s}</g>`;
}
/** A street lamp with a volumetric cone. glowStyle animates the light parts. */
function lamp(x, baseY, hgt, s = 1, { glowStyle = '', color = 'gWarmGlow', cone = 'gCone', flip = false } = {}) {
  const hx = flip ? -51 : 51;
  const light = `${glow(hx * s, -hgt - 22 * s, 70 * s, color)}<path d="M${n1((hx - 14) * s)} ${n1(-hgt - 22 * s)}L${n1((hx + 14) * s)} ${n1(-hgt - 22 * s)}L${n1(hx * s + 150 * s)} ${n1(-hgt + hgt * 0.95)}L${n1(hx * s - 150 * s)} ${n1(-hgt + hgt * 0.95)}Z" fill="url(#${cone})" opacity=".55"/>${glow(hx * s, -22 * s, 18 * s, 'gSoftGlow', 'opacity=".8"')}`;
  return at(x, baseY, `<rect x="${n1(-4 * s)}" y="${n1(-hgt)}" width="${n1(8 * s)}" height="${n1(hgt)}" fill="#1A1E22"/><use href="#lampHead" transform="translate(0 ${n1(-hgt)}) scale(${flip ? -s : s} ${s})"/>${glowStyle ? anim(glowStyle, light) : light}`);
}

/* ======================================================================
 * SCENES
 * ==================================================================== */
const scenes = [];

/* ---------------------------------------------------------- SCENE 1  0-6 */
D(lg('sky1', [[0, '#2A1838'], [0.3, '#6E2B47'], [0.5, '#C9573F'], [0.62, '#F29447'], [0.72, '#FFC66E'], [1, '#FFD98A']]));
D(lg('ground1', [[0, '#9A5A38'], [0.4, '#6B3725'], [1, '#2E1712']]));
D(lg('wall1', [[0, '#8A4630'], [1, '#5E2C1D']]));
D(rg('room1', [[0, '#FFC877'], [0.5, '#D9843E'], [1, '#6E3418']], 0.5, 0.35, 0.7));
{
  // --- shot A : golden street, 0 - 3.9
  const far = `${full('url(#sky1)')}
  ${glow(700, 1130, 560, 'gGoldGlow', 'opacity=".9"')}<circle cx="700" cy="1130" r="92" fill="#FFF0BE"/>
  ${anim(cam(0, 4, 'translateX(0px)', 'translateX(-40px)', LIN), clouds(9, { x0: -100, x1: 1200, y0: 500, y1: 950, rx0: 120, rx1: 260, color: '#F7A27A', op: 0.55 }))}
  <g opacity=".7">${skyline(-20, 1100, 1270, 120, 360, '#8B4150', 'winWarmFar', 50, 120)}</g>
  <path d="M600 1270V1150Q640 1090 680 1150V1270Z M632 1110V1060" fill="#7A3446" stroke="#7A3446" stroke-width="5"/>`;
  const mid = `${skyline(-30, 360, 1390, 380, 760, '#4A2231', 'winWarm', 110, 190)}${skyline(720, 1110, 1390, 420, 700, '#4A2231', 'winWarm', 110, 190)}
  ${lamp(360, 1400, 300, 1, { flip: false })}${lamp(730, 1400, 300, 1, { flip: true })}`;
  // chai vendor
  const vendor = at(860, 1520, `<rect x="-100" y="-70" width="200" height="70" rx="8" fill="#5B2A1E"/><rect x="-100" y="-80" width="200" height="14" rx="5" fill="#7B3A26"/><circle cx="-62" cy="6" r="18" fill="#221210"/><circle cx="62" cy="6" r="18" fill="#221210"/>
    <path d="M-30 -80 Q-30 -110 -10 -110 H10 Q30 -110 30 -80Z" fill="#9C9690"/><path d="M30 -96 L50 -104" stroke="#9C9690" stroke-width="6" stroke-linecap="round"/>
    ${at(0, -112, steam(3, 0.7))}
    ${glow(-70, -130, 70, 'gWarmGlow')}<path d="M-70 -150V-120" stroke="#2A1A12" stroke-width="3"/><rect x="-80" y="-124" width="20" height="22" rx="5" fill="#FFD27A"/>
    <use href="#person" fill="#2A1820" transform="translate(70 -70) scale(.9)"/>
    ${[0, 1, 2].map((i) => `<rect x="${-60 + i * 22}" y="-98" width="12" height="18" rx="2" fill="#fff" fill-opacity=".35"/>`).join('')}`);
  // dancing kids
  const kid = (x, y, s, ph, shirt) => at(x, y, anim(loop('0%{transform:translateY(0px) rotate(-4deg)}50%{transform:translateY(-26px) rotate(4deg)}100%{transform:translateY(0px) rotate(-4deg)}', 1, ph, SOFT), `<g transform="scale(${s})"><use href="#person" fill="#2C1720"/><path d="M-20 -94Q0 -100 20 -94L24 -56H-24Z" fill="${shirt}"/><path d="M-18 -92L-46 -140M18 -92L46 -140" stroke="#2C1720" stroke-width="9" stroke-linecap="round"/></g>`));
  const kids = kid(210, 1560, 0.95, 0, '#8A4B5E') + kid(330, 1500, 0.75, 0.35, '#5E6E8A') + kid(900, 1640, 1.05, 0.6, '#3E6E5E') + kid(650, 1470, 0.6, 0.2, '#7E5A3A');
  // first drops: dust puffs on dry pavement, then wet patches
  let dust = '';
  for (let i = 0; i < 16; i++) {
    const t = 1.25 + i * 0.13 + R(0, 0.1);
    const x = R(60, 1020);
    const y = R(1420, 1880);
    const k = 0.6 + ((y - 1420) / 460) * 0.8;
    dust += at(x, y, anim(tl([[t - 0.01, 'transform:scale(.1);opacity:0'], [t, 'transform:scale(.15);opacity:.9', OUT], [t + 0.9, 'transform:scale(1);opacity:0']]), `<ellipse rx="${n1(46 * k)}" ry="${n1(14 * k)}" fill="none" stroke="#E9C08E" stroke-width="${n1(5 * k)}"/><circle cx="${n1(-20 * k)}" cy="${n1(-14 * k)}" r="${n1(6 * k)}" fill="#E9C08E"/><circle cx="${n1(18 * k)}" cy="${n1(-18 * k)}" r="${n1(5 * k)}" fill="#E9C08E"/>`));
  }
  let wet = '';
  for (let i = 0; i < 26; i++) {
    const t = 1.6 + i * 0.07;
    const y = R(1420, 1900);
    const k = 0.6 + ((y - 1420) / 480) * 0.9;
    wet += `<ellipse cx="${n1(R(0, 1080))}" cy="${n1(y)}" rx="${n1(R(20, 46) * k)}" ry="${n1(R(6, 12) * k)}" fill="#3A1C14" style="${fade([[t, 0], [t + 0.8, 0.45]])}"/>`;
  }
  const meeraA = at(540, 1780, `<g transform="scale(1.55)">${meera({
    face: 'joy', armLStyle: 'transform:rotate(78deg)', armRStyle: 'transform:rotate(-78deg)',
    bodyStyle: loop('0%{transform:scaleX(1) translateY(0px)}22%{transform:scaleX(.12) translateY(-8px)}50%{transform:scaleX(-1) translateY(0px)}72%{transform:scaleX(-.12) translateY(-8px)}100%{transform:scaleX(1) translateY(0px)}', 1.5, 0, SOFT),
  })}</g>`);
  const shotA = `
    ${anim(cam(0, 4, 'scale(1)', 'scale(1.06)', EASE, 'transform-origin:540px 1250px'), `
      ${anim(cam(0, 4, 'translateX(0px)', 'translateX(-12px)', EASE), far)}
      ${anim(tl([[1.0, 'opacity:0'], [3.0, 'opacity:.55']]), rain('far', { color: '#FFE2A8' }))}
      ${anim(cam(0, 4, 'translateX(0px)', 'translateX(-28px)', EASE), mid)}
      ${rect(0, 1385, W, 535, 'url(#ground1)')}
      <path d="M540 1390L520 1920M540 1390L560 1920" stroke="#C4875A" stroke-width="3" opacity=".25"/>
      ${anim(tl([[2.4, 'opacity:0'], [3.6, 'opacity:.8']]), `<g filter="url(#blur8)">${rect(330, 1395, 60, 400, 'url(#gStreak)')}${rect(700, 1395, 60, 400, 'url(#gStreak)')}${rect(650, 1395, 110, 520, 'url(#gStreak)', 'opacity=".6"')}</g>`)}
      ${wet}${dust}
      ${anim(tl([[2.6, 'opacity:0'], [3.6, 'opacity:1']]), ripples(14, { x0: 0, x1: 1080, y0: 1420, y1: 1900, color: '#FFE0B0' }))}
      ${vendor}${kids}
      ${anim(cam(0, 4, 'translateX(0px)', 'translateX(-50px)', EASE), meeraA)}
      ${anim(tl([[1.4, 'opacity:0'], [3.2, 'opacity:.7']]), rain('mid', { color: '#FFE7B8' }))}`)}`;

  // --- shot B : Dadaji at the window, 3.9 - 6.3
  const plant = at(790, 1290, '<use href="#pot"/><path d="M-6 -58Q-30 -110 -50 -120M4 -58Q20 -120 40 -136M0 -58Q-2 -100 6 -150" stroke="#5E7A3A" stroke-width="6" fill="none" stroke-linecap="round"/><ellipse cx="-50" cy="-122" rx="18" ry="8" fill="#6E8C42" transform="rotate(-30 -50 -122)"/><ellipse cx="40" cy="-138" rx="18" ry="8" fill="#7E9C4A" transform="rotate(30 40 -138)"/><ellipse cx="6" cy="-152" rx="16" ry="7" fill="#6E8C42" transform="rotate(-70 6 -152)"/>');
  const catB = at(300, 1290, `<g transform="scale(1.1)"><use href="#cat" fill="#2A1712"/>${at(22, -10, anim(loop('0%{transform:rotate(0deg)}50%{transform:rotate(-38deg)}100%{transform:rotate(0deg)}', 1.2, 0, SOFT), '<path d="M0 0Q34 -4 40 -40Q42 -56 30 -60" stroke="#2A1712" stroke-width="9" fill="none" stroke-linecap="round"/>'))}</g>`);
  let bricks = '';
  for (let i = 0; i < 40; i++) bricks += rect(R(0, 1040), R(140, 1880), R(40, 90), 18, '#9C553A', `opacity="${n2(R(0.15, 0.4))}" rx="2"`);
  const shotB = anim(cam(3.9, 6.6, 'scale(1)', 'scale(1.07)', EASE, 'transform-origin:540px 1000px'), `
    ${full('url(#wall1)')}${bricks}
    ${rect(230, 600, 620, 700, 'url(#room1)')}
    ${glow(420, 760, 300, 'gWarmGlow', 'opacity=".8"')}
    <path d="M300 600V700M420 600V660" stroke="#5E2A14" stroke-width="3"/>${glow(420, 670, 40, 'gSoftGlow')}
    ${at(560, 1300, `<g transform="scale(1.5)">${dadaji({ headStyle: loop('0%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}100%{transform:rotate(-2deg)}', 3, 0, SOFT) })}${at(46, -92, '<use href="#d-cup"/><use href="#d-hand" transform="translate(-2 -14)"/>')}${at(46, -138, steam(3, 0.8))}</g>`)}
    ${rect(206, 576, 668, 24, '#3E2014')}${rect(206, 576, 24, 744, '#3E2014')}${rect(850, 576, 24, 744, '#3E2014')}${rect(538, 600, 8, 300, '#3E2014', 'opacity=".9"')}${rect(230, 896, 620, 8, '#3E2014', 'opacity=".9"')}
    ${rect(170, 1290, 740, 40, '#5A2D1C')}${rect(170, 1290, 740, 8, '#C9835A', 'opacity=".5"')}
    ${plant}${catB}
    ${ripples(8, { x0: 190, x1: 890, y0: 1300, y1: 1325, color: '#FFD9A6', r0: 10, r1: 18, persp: false })}
    ${rain('mid', { color: '#FFD6A0', op: 0.55 })}${rain('near', { color: '#FFE2B8', op: 0.4 })}
    ${anim(cam(3.9, 6.6, 'translate(0px,0px)', 'translate(-30px,0px)', EASE), `<g filter="url(#blur8)" opacity=".9"><ellipse cx="40" cy="1760" rx="160" ry="60" fill="#2A3A1A" transform="rotate(-30 40 1760)"/><ellipse cx="1060" cy="1820" rx="200" ry="70" fill="#22301A" transform="rotate(25 1060 1820)"/><ellipse cx="980" cy="160" rx="180" ry="50" fill="#2A3A1A" transform="rotate(-15 980 160)"/></g>`)}`);

  // opening: the first drop (see loop drop) splashes at 0.85s and the frame blooms
  const bloom = at(540, 980, anim(tl([[0.84, 'transform:scale(0);opacity:0'], [0.86, 'transform:scale(.1);opacity:1', OUT], [1.9, 'transform:scale(5);opacity:0']]), glow(0, 0, 300, 'gGoldGlow')));
  scenes.push({
    a: 0, b: 6,
    body: `${anim(tl([[0, 'opacity:0;transform:scale(1.12)'], [0.9, 'opacity:0;transform:scale(1.12)', OUT], [2.1, 'opacity:1;transform:scale(1)']], 'transform-origin:540px 980px'), anim(window_(0, 3.9, 0.15), shotA))}${anim(window_(3.9, 6.6, 0.15), shotB)}${bloom}`,
  });
}

/* ---------------------------------------------------------- SCENE 2  6-13 */
D(lg('sky2', [[0, '#34484F'], [0.4, '#61777C'], [0.6, '#93A3A2'], [1, '#A9B4AF']]));
D(lg('road2', [[0, '#3A4A50'], [1, '#1E282C']]));
D(lg('room2', [[0, '#25313A'], [1, '#3A4852']]));
D(lg('fog2', [[0, '#DCE8EC', 0.5], [0.5, '#CFDDE2', 0.38], [1, '#DCE8EC', 0.55]]));
{
  const HZ = 1040;
  const roadX = (d, off) => 540 + off * (420 + 1100 * d);
  const roadY = (d) => HZ + 880 * d;
  const far = `${full('url(#sky2)')}${clouds(10, { x0: -100, x1: 1200, y0: 200, y1: 800, rx0: 160, rx1: 320, color: '#52666C', op: 0.6 })}
    ${glow(540, 980, 420, 'gSoftGlow', 'opacity=".25"')}
    <g opacity=".8">${skyline(250, 830, HZ, 80, 260, '#5D7178', 'winCoolFar', 40, 90)}</g>`;
  const mid = `${skyline(-40, 300, HZ + 40, 600, 900, '#2E434D', 'winCool', 120, 170)}${skyline(780, 1120, HZ + 40, 560, 860, '#2E434D', 'winCool', 120, 170)}`;
  const road = `<path d="M300 ${HZ}H780L1400 1920H-320Z" fill="url(#road2)"/>
    ${[-0.33, 0.33].map((o) => { let s = ''; for (let d = 0.02; d < 1; d += 0.1) s += `<path d="M${n1(roadX(d, o))} ${n1(roadY(d))}L${n1(roadX(d + 0.04, o))} ${n1(roadY(d + 0.04))}" stroke="#C9D2D0" stroke-opacity=".35" stroke-width="${n1(2 + 10 * d)}"/>`; return s; }).join('')}
    <path d="M300 ${HZ}L-320 1920H-40L330 ${HZ}Z M780 ${HZ}L1400 1920H1120L750 ${HZ}Z" fill="#26343A"/>`;
  const carCols = ['#55646B', '#6E5A5A', '#3E4E5A', '#7C8285', '#4A5A4E', '#2F3B44', '#8A8A80'];
  let cars = '';
  let honks = '';
  let reflections = '';
  const rows = [0.06, 0.13, 0.22, 0.34, 0.5];
  rows.forEach((d, ri) => {
    [-0.33, 0, 0.33].forEach((o, li) => {
      if (ri === 3 && li === 2) return; // bus slot
      const s = 0.22 + 1.2 * d;
      const x = roadX(d, o) + R(-10, 10) * s;
      const y = roadY(d);
      cars += at(x, y, `<g transform="scale(${n2(s)})"><use href="#carRear" fill="${pick(carCols)}"/></g>`);
      reflections += `<rect x="${n1(x - 70 * s)}" y="${n1(y)}" width="${n1(30 * s)}" height="${n1(160 * s)}" fill="#FF4A4A" opacity=".35"/><rect x="${n1(x + 40 * s)}" y="${n1(y)}" width="${n1(30 * s)}" height="${n1(160 * s)}" fill="#FF4A4A" opacity=".35"/>`;
      if (rand() < 0.5) {
        const dur = pick([1.2, 1.5, 2]);
        honks += at(x, y - 130 * s, anim(loop('0%{transform:scale(.2);opacity:0}10%{opacity:.9}60%{transform:scale(1);opacity:0}100%{transform:scale(1);opacity:0}', dur, R(0, dur), OUT), `<circle r="${n1(46 * s)}" fill="none" stroke="#FFE7A0" stroke-width="${n1(4 * s + 1)}"/><circle r="${n1(26 * s)}" fill="none" stroke="#FFE7A0" stroke-width="${n1(3 * s + 1)}"/>`));
      }
    });
  });
  const bd = 0.34;
  const bs = 0.22 + 1.2 * bd;
  const bx = roadX(bd, 0.36);
  const by = roadY(bd);
  const spray = (dir) => anim(loop(`0%{transform:scale(.4) rotate(0deg);opacity:0}15%{opacity:.8}100%{transform:scale(1.2) rotate(${dir * 18}deg);opacity:0}`, 0.75, R(0, 0.75), OUT), `<path d="M0 0Q${dir * 60} -70 ${dir * 130} -10" stroke="#DDEFF5" stroke-width="6" fill="none" stroke-dasharray="6 14" stroke-linecap="round"/><path d="M0 0Q${dir * 40} -110 ${dir * 100} -40" stroke="#DDEFF5" stroke-width="4" fill="none" stroke-dasharray="4 12" stroke-linecap="round"/>`);
  const bus = at(bx, by, `<g transform="scale(${n2(bs)})"><use href="#busRear" fill="#2F6F7E"/>${at(-120, -10, spray(-1))}${at(120, -10, spray(1))}</g>`);
  // umbrella sea on both sidewalks
  const umbCols = ['#2E4A62', '#5B2E3A', '#2F5E5A', '#3A3A48', '#6B6F7A', '#1F2A33', '#8A3B3B', '#4D6B7A', '#3D3326', '#6E4E6E'];
  let umbs = '';
  const umb = (x, y, s, flip = false) => {
    const col = pick(umbCols);
    const bob = loop(`0%{transform:translateY(0px) rotate(-3deg)}50%{transform:translateY(-8px) rotate(3deg)}100%{transform:translateY(0px) rotate(-3deg)}`, pick([1.2, 1.5, 2]), R(0, 2), SOFT);
    const flipS = flip ? tl([[8.2, 'transform:scaleY(1)', OUT], [8.45, 'transform:scaleY(-.9) rotate(8deg)'], [9.6, 'transform:scaleY(-.9) rotate(8deg)']]) : '';
    return at(x, y, `<g transform="scale(${n2(s)})"><use href="#person" fill="#1A2227" transform="translate(0 130)"/>${anim(bob, flip ? anim(flipS, `<use href="#umbrella" fill="${col}"/>`) : `<use href="#umbrella" fill="${col}"/>`)}</g>`);
  };
  const umbList = [];
  for (let i = 0; i < 26; i++) {
    const left = i % 2 === 0;
    const y = R(1180, 1860);
    const d = (y - HZ) / 880;
    const edge = left ? roadX(d, -0.62) : roadX(d, 0.62);
    const x = left ? R(-60, edge) : R(edge, 1140);
    umbList.push([x, y, 0.35 + d * 1.1]);
  }
  umbList.sort((a, b) => a[1] - b[1]).forEach(([x, y, s], i) => { umbs += umb(x, y, s, i === 17); });
  // calendar with flipping pages (rain icons instead of numbers)
  let pages = '';
  const NP = 9;
  for (let i = NP - 1; i >= 0; i--) {
    const t = 6.5 + i * 0.36;
    const pg = `<rect x="0" y="0" width="250" height="250" rx="10" fill="${i % 2 ? '#F2F0EA' : '#EAE8E0'}"/><rect x="0" y="0" width="250" height="56" rx="10" fill="#9E4A4A"/><rect x="0" y="40" width="250" height="16" fill="#9E4A4A"/>
      <g transform="translate(125 140)"><ellipse cx="-20" cy="-10" rx="38" ry="26" fill="#8A9BA4"/><ellipse cx="22" cy="-4" rx="34" ry="22" fill="#9AABB4"/><rect x="-56" y="-6" width="110" height="24" rx="12" fill="#9AABB4"/>${[-36, -12, 12, 36].map((x) => `<path d="M${x} 30L${x - 8} 54" stroke="#4E88A8" stroke-width="5" stroke-linecap="round"/>`).join('')}</g>
      ${[0, 1, 2, 3, 4, 5].map((k) => rect(18 + k * 37, 214, 24, 6, '#C9C4B8', 'rx="2"')).join('')}`;
    pages += i < NP - 1 ? anim(tl([[t, 'transform:scaleY(1);opacity:1', IN], [t + 0.22, 'transform:scaleY(-.15);opacity:.0']]), pg) : pg;
  }
  const calendar = at(728, 360, `<g transform="rotate(-4)"><rect x="6" y="10" width="250" height="250" rx="10" fill="#000" opacity=".25"/>${pages}<circle cx="70" cy="2" r="9" fill="#333"/><circle cx="180" cy="2" r="9" fill="#333"/></g>`);
  const shotA = anim(cam(6, 9.9, 'scale(1.0) translateY(0px)', 'scale(1.07) translateY(-20px)', EASE, 'transform-origin:540px 1200px'), `
    ${anim(cam(6, 10, 'translateX(0px)', 'translateX(10px)'), far)}
    ${rain('far', { color: '#C9DCE3', op: 0.6 })}
    ${anim(cam(6, 10, 'translateX(0px)', 'translateX(24px)'), mid)}
    ${road}<g filter="url(#blur8)">${reflections}</g>
    ${ripples(34, { x0: 60, x1: 1020, y0: HZ + 40, y1: 1900, color: '#CFE4EC' })}
    ${cars}${bus}${honks}
    ${rain('mid', { color: '#C9DCE3', op: 0.55 })}
    ${umbs}
    ${calendar}
    ${rain('near', { color: '#D5E6EC', op: 0.35 })}`);

  // shot B : Meera bored at the fogged window, 9.9 - 13.3
  const wx0 = 170;
  const wx1 = 910;
  const wy0 = 520;
  const wy1 = 1420;
  let glassDrops = '';
  for (let i = 0; i < 26; i++) {
    const x = R(wx0 + 20, wx1 - 20);
    const r = R(3, 8);
    const slide = rand() < 0.5;
    const d = `<path d="M0 ${-r * 2.4}C${r * 0.6} ${-r} ${r} ${-r * 0.4} ${r} 0A${r} ${r} 0 0 1 ${-r} 0C${-r} ${-r * 0.4} ${-r * 0.6} ${-r} 0 ${-r * 2.4}Z" fill="#E6F2F6" fill-opacity=".55" stroke="#fff" stroke-opacity=".5" stroke-width="1"/>`;
    if (slide) {
      const dur = pick([2, 2.4, 3, 4]);
      glassDrops += at(x, wy0, anim(loop(`0%{transform:translateY(0px)}100%{transform:translateY(${wy1 - wy0}px)}`, dur, R(0, dur), IN), d + `<path d="M0 ${-r * 2}V-140" stroke="#fff" stroke-opacity=".18" stroke-width="${n1(r * 0.8)}"/>`));
    } else glassDrops += at(x, R(wy0 + 20, wy1 - 20), d);
  }
  const sunDraw = [];
  sunDraw.push(`<circle r="46" pathLength="1" fill="none" stroke="#2A3942" stroke-opacity=".75" stroke-width="12" stroke-linecap="round" style="${draw(10.4, 11.2)}" transform="rotate(-90)"/>`);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const t = 11.2 + k * 0.1;
    sunDraw.push(`<path pathLength="1" d="M${n1(Math.cos(a) * 64)} ${n1(Math.sin(a) * 64)}L${n1(Math.cos(a) * 98)} ${n1(Math.sin(a) * 98)}" stroke="#2A3942" stroke-opacity=".75" stroke-width="12" stroke-linecap="round" style="${draw(t, t + 0.12)}"/>`);
  }
  const finger = at(300, 880, anim(tl([[10.4, 'transform:rotate(-90deg)', EASE], [11.2, 'transform:rotate(270deg)', EASE], [12.1, 'transform:rotate(300deg)']]), at(46, 0, `<circle r="13" fill="${SKIN}"/>`)));
  let laundry = '';
  const clothes = [['shirt', '#6E8A99', 230], ['towel', '#9AA7A0', 450], ['pants', '#4C5C6B', 640], ['frock', '#7A6E8E', 830]];
  clothes.forEach(([kind, col, x], i) => {
    let shape;
    if (kind === 'shirt') shape = `<path d="M-60 0H60L80 40L56 54V160H-56V54L-80 40Z" fill="${col}"/><path d="M-14 0L0 22L14 0" fill="#4E6A79"/>`;
    else if (kind === 'towel') shape = `<rect x="-60" y="0" width="120" height="190" fill="${col}"/><path d="M-60 160H60M-60 172H60" stroke="#7E8A84" stroke-width="5"/>`;
    else if (kind === 'pants') shape = `<path d="M-50 0H50L56 200H10L0 70L-10 200H-56Z" fill="${col}"/>`;
    else shape = `<path d="M-34 0H34L70 170H-70Z" fill="${col}"/><path d="M-70 170H70" stroke="#5E5470" stroke-width="8"/>`;
    let drips = '';
    for (let k = 0; k < 3; k++) {
      const dx = R(-50, 50);
      drips += at(dx, 160, anim(loop('0%{transform:translateY(0px);opacity:0}10%{opacity:.9}100%{transform:translateY(420px);opacity:0}', 1.2, R(0, 1.2), IN), `<use href="#drop" fill="#CFE6EE" transform="scale(.45)"/>`));
    }
    laundry += at(x, 560 + Math.sin((x / 1080) * Math.PI) * 50, anim(loop('0%{transform:rotate(-2.5deg)}50%{transform:rotate(2.5deg)}100%{transform:rotate(-2.5deg)}', 3, i * 0.4, SOFT), `${shape}${drips}<rect x="-30" y="-8" width="10" height="20" fill="#C9B07A"/><rect x="20" y="-8" width="10" height="20" fill="#C9B07A"/>`));
  });
  const shotB = anim(cam(9.9, 13.6, 'scale(1)', 'scale(1.06)', EASE, 'transform-origin:540px 920px'), `
    ${full('#30434E')}
    ${(() => { let s = ''; for (let i = 0; i < 30; i++) s += rect(R(0, 1060), R(0, 1900), R(60, 140), R(4, 8), '#3E5560', 'opacity=".5"'); return s; })()}
    ${rect(wx0, wy0, wx1 - wx0, wy1 - wy0, 'url(#room2)')}
    ${glow(300, 640, 260, 'gWarmGlow', 'opacity=".55"')}${glow(300, 600, 30, 'gSoftGlow')}
    ${at(540, 1560, `<g transform="scale(2.3)">${meera({ face: 'bored', armL: 150, armR: -8, headStyle: 'transform:rotate(-6deg)' })}</g>`)}
    <ellipse cx="520" cy="955" rx="18" ry="13" fill="#D79A72" opacity=".7"/>
    ${rect(wx0, wy0, wx1 - wx0, wy1 - wy0, 'url(#fog2)')}
    <ellipse cx="520" cy="960" rx="60" ry="44" fill="#1E2A33" opacity=".22"/>
    <g transform="translate(300 880)">${sunDraw.join('')}</g>
    ${finger}
    ${glassDrops}
    ${rect(wx0 - 26, wy0 - 26, wx1 - wx0 + 52, 26, '#1E2B33')}${rect(wx0 - 26, wy0, 26, wy1 - wy0, '#1E2B33')}${rect(wx1, wy0, 26, wy1 - wy0, '#1E2B33')}${rect(536, wy0, 10, wy1 - wy0, '#1E2B33')}
    ${rect(wx0 - 60, wy1, wx1 - wx0 + 120, 46, '#26363F')}${rect(wx0 - 60, wy1, wx1 - wx0 + 120, 6, '#8FA7B0', 'opacity=".4"')}
    ${ripples(10, { x0: wx0 - 40, x1: wx1 + 40, y0: wy1 + 8, y1: wy1 + 36, color: '#D5E8EF', r0: 10, r1: 20, persp: false })}
    <path d="M-20 520Q540 640 1100 520" stroke="#1A1A1A" stroke-width="3" fill="none"/>
    ${laundry}
    ${rain('mid', { color: '#C9DCE3', op: 0.5 })}${rain('near', { color: '#D5E6EC', op: 0.3 })}`);
  scenes.push({ a: 6, b: 13, body: `${anim(window_(6, 9.9, 0.15), shotA)}${anim(window_(9.9, 13.6, 0.15), shotB)}` });
}

/* ---------------------------------------------------------- SCENE 3  13-21 */
D(lg('sky3', [[0, '#13222A'], [0.5, '#2A414B'], [1, '#3C5560']]));
D(lg('water3', [[0, '#3C5E62', 0.95], [0.08, '#2C4A4F', 0.95], [1, '#0E1C20', 1]]));
D(lg('sky3b', [[0, '#070D12'], [0.6, '#122029'], [1, '#1E2E37']]));
D(lg('water3b', [[0, '#14262D'], [1, '#050B0E']]));
{
  // shot A : water climbs the street, 13 - 16.9
  const shops = [];
  for (let i = 0; i < 7; i++) {
    const x = 20 + i * 150;
    const t = 13.5 + i * 0.12 + R(0, 0.25);
    shops.push(at(x, 1110, `${rect(0, 0, 140, 260, '#1A262B')}${rect(0, 0, 140, 260, '#E8B970', `opacity=".55"`)}${glow(70, 120, 90, 'gWarmGlow', 'opacity=".5"')}
      ${anim(tl([[t, 'transform:scaleY(0)', EASE], [t + 0.9, 'transform:scaleY(1)']]), `${rect(0, 0, 140, 260, '#6B7A80')}${(() => { let s = ''; for (let k = 0; k < 13; k++) s += rect(0, k * 20, 140, 3, '#4A575C'); return s; })()}`)}
      ${rect(-6, -26, 152, 26, pick(['#5A3A3A', '#3A4A5A', '#4A5A3A', '#5A4A2A']))}`));
  }
  const facade = `${rect(0, 380, W, 760, '#22333B')}${rect(14, 400, W - 28, 680, 'url(#winSlate)')}${rect(0, 1080, W, 30, '#16232A')}`;
  const waterSurfaceRip = ripples(16, { x0: 0, x1: 1080, y0: 4, y1: 300, color: '#BFD8DE', r0: 16, r1: 44 });
  const catOnCar = at(-20, -96, `<g transform="scale(.75)"><use href="#cat" fill="#1A1210"/><path d="M22 -10Q50 -10 54 -36" stroke="#1A1210" stroke-width="9" fill="none" stroke-linecap="round"/></g>`);
  const floatCar = (x, col, ph, drift, extra = '') => at(x, 30, anim(tl([[13, 'transform:translateX(0px)'], [17, `transform:translateX(${drift}px)`]]), anim(loop('0%{transform:translateY(0px) rotate(-3deg)}50%{transform:translateY(-10px) rotate(3deg)}100%{transform:translateY(0px) rotate(-3deg)}', 2, ph, SOFT), `<g transform="scale(1.1)"><use href="#carSide" fill="${col}"/>${extra}</g>`)));
  const water = anim(tl([[13, 'transform:translateY(1720px)', EASE], [16.6, 'transform:translateY(1318px)'], [17.2, 'transform:translateY(1300px)']]), `
    ${rect(-40, 0, W + 80, 900, 'url(#water3)')}
    <path d="M-40 0H1120" stroke="#9FC2C8" stroke-width="4" opacity=".6"/>
    ${floatCar(820, '#6E5A5A', 0, -90)}${floatCar(140, '#4A5A6B', 1, 70, catOnCar)}
    ${waterSurfaceRip}
    <g filter="url(#blur8)" opacity=".5">${rect(80, 10, 50, 300, 'url(#gStreak)')}${rect(940, 10, 50, 300, 'url(#gStreak)')}</g>`);
  const bus = at(560, 1440, '<use href="#busSide" fill="#2B6070"/>');
  const shotA = anim(shake(13, 17, 3), anim(cam(13, 17, 'scale(1.04)', 'scale(1.1)', EASE, 'transform-origin:540px 1300px'), `
    ${full('url(#sky3)')}${clouds(12, { x0: -100, x1: 1200, y0: 100, y1: 700, rx0: 160, rx1: 320, color: '#0E1A20', op: 0.8 })}
    ${anim(tl([[15.2, 'opacity:0'], [15.22, 'opacity:.9', OUT], [15.9, 'opacity:0']]), `${full('#9FC3D0', 'opacity=".5"')}<path d="M760 0L730 120L770 160L700 340L740 360L690 520" stroke="#F4FBFF" stroke-width="5" fill="none"/>`)}
    <g opacity=".8">${skyline(-20, 1100, 420, 80, 260, '#1C2C33', 'winCoolFar', 60, 140)}</g>
    ${rain('far', { color: '#B9D0D8', op: 0.6 })}
    ${facade}${shops.join('')}
    ${lamp(70, 1400, 520, 1.1, { glowStyle: loop('0%{opacity:1}46%{opacity:1}48%{opacity:.3}50%{opacity:1}100%{opacity:1}', 2.4, 0, LIN) })}
    ${bus}
    ${water}
    ${rain('mid', { color: '#B9D0D8', op: 0.6 })}${rain('near', { color: '#C9DCE3', op: 0.4 })}`));

  // shot B : water level, lamps die, blackout, phone beams, 16.9 - 21.3
  const HZ = 1000;
  const px = (z, side) => 540 + side * (700 / z);
  const py = (z, hgt) => HZ + (260 - hgt) / z;
  let walls = '';
  let wins = '';
  const lampsAll = [];
  const order = [];
  [-1, 1].forEach((side) => {
    let z = 1.15;
    while (z < 16) {
      const z2 = z * R(1.35, 1.7);
      const hb = R(2000, 3600);
      const col = side < 0 ? '#16242B' : '#1A2930';
      walls += `<path d="M${n1(px(z, side))} ${n1(py(z, hb))}L${n1(px(z2, side))} ${n1(py(z2, hb))}L${n1(px(z2, side))} ${n1(py(z2, -400))}L${n1(px(z, side))} ${n1(py(z, -400))}Z" fill="${col}"/><path d="M${n1(px(z, side))} ${n1(py(z, hb))}V${n1(py(z, -400))}" stroke="#0C161B" stroke-width="${n1(14 / z)}"/>`;
      for (let hh = 380; hh < hb - 200; hh += 330) {
        for (let zz = z * 1.06; zz < z2 * 0.95; zz *= 1.12) {
          if (rand() > 0.55) continue;
          const zb = zz * 1.05;
          const pts = [[px(zz, side), py(zz, hh)], [px(zb, side), py(zb, hh)], [px(zb, side), py(zb, hh + 170)], [px(zz, side), py(zz, hh + 170)]];
          order.push({ pts, z: zz });
        }
      }
      z = z2;
    }
  });
  // windows go dark one by one, roughly near -> far with jitter
  order.sort((a, b) => a.z - b.z + R(-3, 3));
  order.forEach(({ pts }, i) => {
    const t = 18.5 + (i / order.length) * 1.4 + R(0, 0.08);
    const lastOne = i === order.length - 1;
    const col = rand() < 0.75 ? '#F2C36B' : '#E9DDB0';
    wins += `<path d="M${pts.map((p) => `${n1(p[0])} ${n1(p[1])}`).join('L')}Z" fill="${col}" style="${tl(lastOne ? [[20.4, 'opacity:.9'], [20.5, 'opacity:0']] : [[t, 'opacity:.9', LIN], [t + 0.05, 'opacity:.2', LIN], [t + 0.1, 'opacity:.7', LIN], [t + 0.16, 'opacity:0']])}"/>`;
  });
  // lamps: rolling death foreground -> horizon
  const lampZ = [1.25, 1.75, 2.5, 3.6, 5.2, 7.5, 11];
  let lampMarkup = '';
  let lampRefl = '';
  lampZ.forEach((z, i) => {
    [-1, 1].forEach((side) => {
      const t = 17.3 + i * 0.22 + (side > 0 ? 0.06 : 0);
      const flick = tl([[t, 'opacity:1', LIN], [t + 0.06, 'opacity:.1', LIN], [t + 0.12, 'opacity:.85', LIN], [t + 0.18, 'opacity:.05', LIN], [t + 0.24, 'opacity:.6', LIN], [t + 0.3, 'opacity:0']]);
      const x = 540 + side * (520 / z);
      const base = HZ + 260 / z;
      const hgt = 1350 / z;
      const s = 1.6 / z;
      lampMarkup += lamp(x, base, hgt, s, { glowStyle: flick, flip: side > 0 });
      const hx = side > 0 ? -51 : 51;
      lampRefl += `<g style="${flick}"><rect x="${n1(x + hx * s - 22 * s)}" y="${n1(base)}" width="${n1(44 * s)}" height="${n1(hgt * 0.9)}" fill="url(#gStreak)"/></g>`;
      lampsAll.push(t);
    });
  });
  // phone flashlights in the dark
  let beams = '';
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? 1 : -1;
    const z = R(1.4, 4.5);
    const x = px(z, side) - side * R(10, 60) / z;
    const y = py(z, R(500, 1800));
    const t = 19.75 + i * 0.12 + R(0, 0.1);
    const ang = side * R(15, 40);
    beams += at(x, y, anim(tl([[t, 'opacity:0'], [t + 0.25, 'opacity:1']]), anim(loop(`0%{transform:rotate(${ang - 8}deg)}50%{transform:rotate(${ang + 8}deg)}100%{transform:rotate(${ang - 8}deg)}`, pick([3, 4, 5]), R(0, 3), SOFT), `<path d="M0 0L-${n1(120 / z + 40)} ${n1(1100 / z + 200)}H${n1(120 / z + 40)}Z" fill="url(#gBeam)" opacity=".8"/><circle r="${n1(10 / z + 3)}" fill="#fff"/>${glow(0, 0, 40 / z + 14, 'gWhiteGlow')}`)));
  }
  // seeded floating debris
  let debris = '';
  const debrisKinds = [
    '<rect x="-16" y="-6" width="32" height="12" rx="6" fill="#7FA9B5" fill-opacity=".7"/>',
    '<path d="M-14 0Q0 -12 14 0Q0 8 -14 0Z" fill="#5E7A3A"/>',
    '<path d="M-20 -4H14Q22 0 14 4H-20Z" fill="#7A4A3A"/>',
    '<rect x="-22" y="-5" width="44" height="10" fill="#6B5A44"/>',
  ];
  for (let i = 0; i < 12; i++) {
    const y = R(1080, 1880);
    const k = 0.5 + (y - 1080) / 600;
    const x0 = R(-100, 1100);
    debris += at(x0, y, anim(tl([[16.6, 'transform:translateX(0px)', LIN], [21.4, `transform:translateX(${n1(R(-160, 160))}px)`]]), anim(loop('0%{transform:translateY(0px) rotate(-6deg)}50%{transform:translateY(-6px) rotate(6deg)}100%{transform:translateY(0px) rotate(-6deg)}', pick([2, 3]), R(0, 2), SOFT), `<g transform="scale(${n2(k)})">${pick(debrisKinds)}</g>`)));
  }
  const reflWalls = `<g transform="translate(0 ${2 * HZ}) scale(1 -1)" opacity=".35">${walls}</g>`;
  const shotB = anim(shake(16.9, 21.3, 2), anim(cam(16.9, 21.3, 'scale(1)', 'scale(1.08)', EASE, 'transform-origin:540px 1000px'), `
    ${full('url(#sky3b)')}${clouds(8, { x0: -100, x1: 1200, y0: 200, y1: 800, rx0: 200, rx1: 340, color: '#1A2A33', op: 0.7 })}
    ${rain('far', { color: '#9DB8C2', op: 0.5 })}
    ${walls}${wins}
    ${anim(tl([[18.5, 'opacity:1'], [19.9, 'opacity:.15']]), `<g filter="url(#blur40)">${rect(0, 300, 260, 700, '#F2C36B', 'opacity=".12"')}${rect(820, 300, 260, 700, '#F2C36B', 'opacity=".12"')}</g>`)}
    ${lampMarkup}
    ${rect(-40, HZ, W + 80, H - HZ + 40, 'url(#water3b)')}
    <g filter="url(#shimmer)">${reflWalls}${lampRefl}${anim(tl([[18.5, 'opacity:1'], [19.9, 'opacity:0']]), `<g filter="url(#blur8)">${rect(80, 1010, 200, 500, 'url(#gStreak)', 'opacity=".5"')}${rect(800, 1010, 200, 500, 'url(#gStreak)', 'opacity=".5"')}</g>`)}</g>
    <path d="M-40 ${HZ}H1120" stroke="#5E8A96" stroke-width="2" opacity=".5"/>
    ${beams}
    ${ripples(26, { x0: 0, x1: 1080, y0: 1030, y1: 1900, color: '#9DBCC6', r0: 30, r1: 110, squash: 0.18 })}
    ${debris}
    ${rain('mid', { color: '#A9C4CE', op: 0.55 })}${rain('near', { color: '#B9D0D8', op: 0.35 })}`));
  scenes.push({ a: 13, b: 21, body: `${anim(window_(13, 16.9, 0.15), shotA)}${anim(window_(16.9, 21.3, 0.15), shotB)}` });
}

/* ---------------------------------------------------------- SCENE 4  21-29 */
D(lg('sky4', [[0, '#3E525B'], [0.5, '#76878A'], [1, '#A3A68E']]));
D(lg('field4', [[0, '#7A6744'], [0.3, '#5E4E33'], [1, '#30281B']]));
D(lg('river4', [[0, '#6E6A58'], [1, '#3A3A30']]));
D(lg('wall4', [[0, '#4E5A55'], [1, '#353E3B']]));
D(lg('sack', [[0, '#C9B286'], [1, '#9A8458']], 0, 0, 1, 0));
{
  // shot A : pan from city across bridge to drowned paddy fields, 21 - 25.7
  const PAN = 1500;
  const hills = `<path d="M-200 1060Q100 960 380 1030T980 1010T1600 1040T2300 1000T3000 1030V1200H-200Z" fill="#617773" opacity=".8"/><path d="M-200 1090Q240 1030 600 1080T1400 1070T2200 1090T3100 1060V1200H-200Z" fill="#53685F"/>`;
  const city = `${skyline(-40, 720, 1160, 260, 620, '#33454C', 'winCoolFar', 70, 140)}`;
  const bridge = (() => {
    let s = rect(620, 1046, 900, 26, '#5D6563') + rect(620, 1030, 900, 6, '#4A5250');
    for (let x = 640; x < 1520; x += 18) s += rect(x, 1030, 3, 18, '#4A5250');
    for (let i = 0; i < 4; i++) s += `<path d="M${660 + i * 220} 1180V1100Q${770 + i * 220} 1040 ${880 + i * 220} 1100V1180" fill="none" stroke="#5D6563" stroke-width="22"/>`;
    for (let i = 0; i < 5; i++) s += at(700 + i * 170 + R(0, 40), 1030, `<g transform="scale(.28)"><use href="#person" fill="#2A3234"/><use href="#umbrella" fill="${pick(['#3A4A5A', '#5A3A3A', '#2F4A44'])}" transform="translate(0 -130)"/></g>`);
    return s;
  })();
  const river = rect(560, 1150, 1100, 60, 'url(#river4)');
  let fieldLines = '';
  for (let i = 0; i < 9; i++) {
    const y = 1150 + i * i * 10 + i * 20;
    fieldLines += `<path d="M1300 ${y}H3000" stroke="#8A7A58" stroke-width="${n1(2 + i * 1.2)}" opacity=".45"/>`;
  }
  for (let i = 0; i < 10; i++) fieldLines += `<path d="M${1500 + i * 160} 1150L${1500 + (i - 4) * 380} 1920" stroke="#8A7A58" stroke-width="5" opacity=".35"/>`;
  let tufts = '';
  for (let i = 0; i < 80; i++) {
    const y = R(1160, 1900);
    const k = 0.25 + ((y - 1160) / 740) * 1.3;
    const x = R(1380, 2700);
    const t = 21.8 + (x - 1380) / 1320 * 2.2 + R(0, 1.2);
    tufts += at(x, y, anim(tl([[t, 'transform:rotate(0deg) translateY(0px);opacity:1', EASE], [t + 1.4, `transform:rotate(${n1(R(30, 70) * (rand() < 0.5 ? -1 : 1))}deg) translateY(${n1(40)}px);opacity:.25`]]), `<g transform="scale(${n2(k)})"><use href="#tuft"/></g>`));
  }
  const fieldRip = ripples(26, { x0: 1350, x1: 2750, y0: 1170, y1: 1900, color: '#C9BC98', r0: 16, r1: 46 });
  const frog = at(0, -168, `<ellipse rx="14" ry="9" fill="#5E9A3A"/><circle cx="-7" cy="-8" r="5" fill="#5E9A3A"/><circle cx="7" cy="-8" r="5" fill="#5E9A3A"/><circle cx="-7" cy="-9" r="2" fill="#111"/><circle cx="7" cy="-9" r="2" fill="#111"/>`);
  const farmer = at(2060, 1560, `<g transform="scale(1.25)">
    <path d="M-60 0Q-62 -80 -40 -100L40 -100Q62 -80 60 0Z" fill="#5A6E7A"/>
    <circle cy="-126" r="30" fill="#7E4E32"/><path d="M-34 -132Q0 -176 34 -132Q20 -146 0 -148Q-20 -146 -34 -132Z" fill="#D9D2C2"/><path d="M-34 -134Q0 -150 34 -134" stroke="#B8AE98" stroke-width="6" fill="none"/>
    <circle cx="-10" cy="-124" r="3" fill="#111"/><circle cx="10" cy="-124" r="3" fill="#111"/><path d="M-10 -108Q0 -112 10 -108" stroke="#3A2010" stroke-width="3" fill="none"/>
    ${frog}
    ${at(46, -60, anim(loop('0%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}100%{transform:rotate(-3deg)}', 3, 0, SOFT), `<path d="M0 0Q30 -10 40 -40" stroke="#7E4E32" stroke-width="14" stroke-linecap="round" fill="none"/>
      <g transform="translate(40 -40)"><path d="M0 0Q-10 50 -30 80M0 0Q0 60 -6 96M0 0Q10 50 24 84M0 0Q-20 40 -44 60M0 0Q18 40 40 56" stroke="#7A7238" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M-6 96Q-10 104 -16 100M-30 80Q-36 84 -40 80" stroke="#5A4A28" stroke-width="5" fill="none"/><rect x="-8" y="-6" width="16" height="14" rx="4" fill="#8A6A3A"/></g>`))}
    <path d="M-80 0Q0 14 80 0" stroke="#C9BC98" stroke-width="4" fill="none" opacity=".7"/>
  </g>
  ${ripples(4, { x0: -110, x1: 110, y0: 0, y1: 8, color: '#D9CCA6', r0: 90, r1: 120, persp: false, crowns: false })}`);
  const nearReeds = (() => {
    let s = '';
    for (let i = 0; i < 16; i++) {
      const x = i * 230 + R(-40, 40);
      s += `<path d="M${n1(x)} 1960Q${n1(x + R(-30, 30))} 1760 ${n1(x + R(-80, 80))} ${n1(R(1600, 1700))}" stroke="#1E2A20" stroke-width="${n1(R(10, 18))}" fill="none" stroke-linecap="round"/>`;
    }
    return `<g filter="url(#blur8)">${s}</g>`;
  })();
  const shotA = `
    ${full('url(#sky4)')}${glow(820, 640, 420, 'gSoftGlow', 'opacity=".45"')}
    ${clouds(10, { x0: -100, x1: 1200, y0: 150, y1: 750, rx0: 180, rx1: 320, color: '#56686E', op: 0.7 })}
    ${anim(cam(21, 25.7, 'translateX(0px)', `translateX(${-PAN * 0.35}px)`), hills)}
    ${rain('far', { color: '#C2CFCF', op: 0.5 })}
    ${anim(cam(21, 25.7, 'translateX(0px)', `translateX(${-PAN}px)`), `${city}${river}${bridge}${rect(1240, 1150, 1900, 770, 'url(#field4)')}${rect(-100, 1160, 1400, 760, 'url(#field4)')}${fieldLines}${fieldRip}${tufts}${farmer}`)}
    ${rain('mid', { color: '#C2CFCF', op: 0.5 })}
    ${anim(cam(21, 25.7, 'translateX(0px)', `translateX(${-PAN * 1.4}px)`), nearReeds)}`;

  // shot B : empty market, price tag keeps rising, 25.7 - 29.3
  let shelves = '';
  [700, 900, 1100, 1300].forEach((y) => {
    shelves += rect(110, y, 860, 22, '#6B5236') + rect(110, y + 22, 860, 10, '#3E2E1E', 'opacity=".7"');
    for (let k = 0; k < 5; k++) shelves += rect(R(130, 900), y - R(60, 110), R(40, 80), 120, '#5E6A64', `opacity="${n2(R(0.25, 0.45))}"`);
  });
  for (let i = 0; i < 9; i++) shelves += rect(R(120, 960), R(400, 1500), R(10, 30), R(80, 300), '#2E3632', `opacity="${n2(R(0.15, 0.35))}"`);
  const bulbSwing = loop('0%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}100%{transform:rotate(-7deg)}', 3, 0, SOFT);
  const moth = at(0, 400, anim(loop('0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}', 1.2, 0, LIN), at(46, 0, anim(loop('0%{transform:translateY(-6px)}50%{transform:translateY(6px)}100%{transform:translateY(-6px)}', 0.6, 0, SOFT), '<path d="M0 0L-8 -6L-6 4ZM0 0L8 -6L6 4Z" fill="#D8CFB8"/>'))));
  const bulb = at(540, 0, anim(bulbSwing, `<path d="M0 0V380" stroke="#222" stroke-width="3"/>${glow(0, 400, 420, 'gWarmGlow', 'opacity=".55"')}<path d="M-20 400L20 400L340 1500H-340Z" fill="url(#gCone)" opacity=".35"/><circle cy="400" r="20" fill="#FFF3CF"/>${glow(0, 400, 60, 'gSoftGlow')}${moth}`));
  // price tag: written, struck through, rewritten higher
  const prices = [['₹40', 25.7, 26.25], ['₹65', 26.55, 27.15], ['₹110', 27.45, 28.05], ['₹180', 28.35, 99]];
  let tag = '';
  prices.forEach(([p, tw, ts], i) => {
    const [gm] = glyphs(p, { s: 0.55, adv: 52, sw: 5 });
    const y = 34 + i * 52;
    const writeStyle = i === 0 ? '' : tl([[tw, 'stroke-dashoffset:1', EASE], [tw + 0.35, 'stroke-dashoffset:0']], 'stroke-dasharray:1 1');
    const g2 = gm.replace(/<use /g, `<use style="${writeStyle}" `).replace(/<g fill="none"/, '<g fill="none" stroke="' + (i === 3 ? '#B3261E' : '#2A2A2A') + '"');
    tag += at(40, y, g2);
    if (ts < 60) tag += `<path pathLength="1" d="M30 ${y + 18}L${40 + p.length * 29 + 10} ${y + 14}" stroke="#B3261E" stroke-width="5" stroke-linecap="round" style="${draw(ts, ts + 0.2)}"/>`;
  });
  const shotB = anim(cam(25.7, 29.3, 'scale(1)', 'scale(1.12)', EASE, 'transform-origin:640px 1500px'), `
    ${full('url(#wall4)')}
    ${(() => { let s = ''; for (let i = 0; i < 12; i++) { const x = R(0, 1080); s += rect(x, 0, R(20, 70), R(300, 1300), '#2A322F', 'opacity=".3"'); } return s; })()}
    ${rect(860, 860, 220, 820, '#55666A')}${at(970, 0, `<g clip-path="url(#doorClip)">${rain('mid', { color: '#C9D6D8', op: 0.7 })}</g>`)}${rect(850, 850, 24, 830, '#2A2420')}
    ${shelves}
    ${rect(0, 1560, W, 360, '#26241F')}${rect(0, 1560, W, 6, '#4A4438')}
    <ellipse cx="540" cy="1720" rx="420" ry="70" fill="#3A4848" opacity=".55"/>${glow(540, 1720, 200, 'gWarmGlow', 'opacity=".25" transform="matrix(1 0 0 .25 0 1290)"')}
    ${ripples(8, { x0: 200, x1: 880, y0: 1680, y1: 1770, color: '#B9C4C0', r0: 20, r1: 40, persp: false })}
    ${at(470, 1640, `<path d="M-130 0Q-150 -150 -110 -250Q-90 -290 -60 -300L60 -300Q90 -290 110 -250Q150 -150 130 0Z" fill="url(#sack)"/><path d="M-70 -300Q0 -330 70 -300L50 -340H-50Z" fill="#B09A6E"/><path d="M-60 -318H60" stroke="#6E5A3A" stroke-width="6"/><path d="M-100 -200Q0 -190 100 -200M-110 -80Q0 -70 110 -80" stroke="#8A744A" stroke-width="3" fill="none" stroke-dasharray="8 8"/><text x="0" y="-130" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="800" font-size="46" fill="#6E5A3A" letter-spacing="6">RICE</text><ellipse cx="0" cy="6" rx="140" ry="14" fill="#000" opacity=".35"/>`)}
    ${at(560, 1200, `<path d="M0 0L80 120" stroke="#5A4A2A" stroke-width="3"/>${at(70, 110, `<g transform="rotate(-6)"><rect x="0" y="0" width="230" height="240" rx="10" fill="#F2ECD8"/><circle cx="20" cy="18" r="7" fill="#26241F"/>${tag}</g>`)}`)}
    ${bulb}`);
  D(`<clipPath id="doorClip"><rect x="-110" y="860" width="220" height="820"/></clipPath>`);
  scenes.push({ a: 21, b: 29, body: `${anim(window_(21, 25.7, 0.15), shotA)}${anim(window_(25.7, 29.3, 0.15), shotB)}` });
}

/* ---------------------------------------------------------- SCENE 5  29-38 */
D(lg('sky5', [[0, '#1B2733'], [0.45, '#3A4F5E'], [0.75, '#61777F'], [1, '#71858A']]));
D(lg('water5', [[0, '#3E555C'], [1, '#1A262B']]));
D(lg('roof5', [[0, '#4C5559'], [1, '#262C2F']]));
D(lg('tarp', [[0, '#3A6E9E'], [1, '#24507A']]));
{
  const flashT = 35.6;
  const far = `${full('url(#sky5)')}${clouds(12, { x0: -100, x1: 1200, y0: 100, y1: 800, rx0: 180, rx1: 340, color: '#22303B', op: 0.85 })}
    ${anim(tl([[flashT - 0.01, 'opacity:0'], [flashT, 'opacity:1', OUT], [flashT + 0.1, 'opacity:1', OUT], [flashT + 0.9, 'opacity:0']]), `${full('#E3EEF6', 'opacity=".9"')}<path d="M900 0L860 140L910 170L830 380L880 400L820 620" stroke="#fff" stroke-width="6" fill="none"/>`)}
    <g opacity=".9">${skyline(-30, 1110, 1080, 60, 260, '#2C3B44', 'winSlate', 70, 160)}</g>
    ${rect(-40, 1060, W + 80, 400, 'url(#water5)')}`;
  const raft = (dir, y, s, a, b, ph) => at(0, y, anim(tl([[a, `transform:translateX(${dir > 0 ? -320 : 1400}px)`, EASE], [b, `transform:translateX(${dir > 0 ? 1400 : -320}px)`]]), `<g transform="scale(${dir * s} ${s})">
      ${anim(loop('0%{transform:translateY(0px) rotate(-2deg)}50%{transform:translateY(-6px) rotate(2deg)}100%{transform:translateY(0px) rotate(-2deg)}', 2, ph, SOFT), `
      <use href="#drum" fill="#2F6FA8" transform="translate(-60 10)"/><use href="#drum" fill="#3A7AB0" transform="translate(0 10)"/><use href="#drum" fill="#2F6FA8" transform="translate(60 10)"/>
      <rect x="-100" y="-30" width="200" height="16" rx="3" fill="#7A5A3E"/><rect x="-90" y="-30" width="4" height="16" fill="#5A3E28"/>
      <use href="#person" fill="#2A3238" transform="translate(-20 -30)"/><path d="M-20 -136Q0 -150 18 -136" fill="${pick(['#6B4E7A', '#7A4E4E'])}"/>
      ${at(-10, -90, anim(loop('0%{transform:rotate(-30deg)}50%{transform:rotate(20deg)}100%{transform:rotate(-30deg)}', 1.5, ph, SOFT), '<path d="M0 0L60 110" stroke="#5A3E28" stroke-width="6"/><ellipse cx="62" cy="116" rx="8" ry="18" fill="#5A3E28" transform="rotate(-30 62 116)"/>'))}
      <use href="#person" fill="#30383E" transform="translate(50 -30) scale(.8)"/>`)}</g>
      ${ripples(5, { x0: -140, x1: 140, y0: 14, y1: 22, color: '#BFD3D8', r0: 30, r1: 60, persp: false, crowns: false })}`));
  const mid = `${raft(1, 1300, 0.8, 29, 38.4, 0)}${raft(-1, 1200, 0.5, 29.4, 38.4, 0.7)}
    ${ripples(16, { x0: 0, x1: 1080, y0: 1080, y1: 1380, color: '#BFD3D8', r0: 14, r1: 40 })}
    ${at(80, 1360, `${rect(-120, -260, 320, 260, '#3A444A')}${rect(-120, -260, 320, 14, '#2A3236')}`)}${at(1000, 1340, `${rect(-120, -200, 300, 200, '#3A444A')}`)}`;
  // rooftop foreground
  const neighbor = (x, y, s, body, head = '#8E5A3C', ph = 0, dupatta = null) => at(x, y, `<g transform="scale(${s})">${anim(loop('0%{transform:translateY(0px)}50%{transform:translateY(-3px)}100%{transform:translateY(0px)}', 3, ph, SOFT), `<path d="M-34 0Q-40 -80 -26 -110Q0 -122 26 -110Q40 -80 34 0Z" fill="${body}"/><circle cy="-136" r="24" fill="${head}"/><path d="M-24 -142Q-20 -166 0 -166Q20 -166 24 -142Q14 -152 0 -152Q-14 -152 -24 -142Z" fill="#1A1A1E"/>${dupatta ? `<path d="M-28 -150Q0 -176 28 -150L36 -90Q0 -100 -36 -90Z" fill="${dupatta}" opacity=".9"/>` : ''}`)}</g>`);
  const stove = at(330, 1560, `${rect(-60, -24, 120, 24, '#2A2E31', 'rx="4"')}<ellipse cy="-24" rx="40" ry="8" fill="#1A1C1E"/>
    ${anim(loop('0%{transform:scaleY(1)}50%{transform:scaleY(1.25)}100%{transform:scaleY(1)}', 0.6, 0, SOFT), '<path d="M-26 -26Q-20 -46 -12 -26Q-6 -50 0 -26Q6 -50 12 -26Q20 -46 26 -26Z" fill="#4FA8FF"/><path d="M-14 -26Q-8 -38 0 -26Q8 -38 14 -26Z" fill="#BFE4FF"/>')}
    <path d="M-44 -40H44L38 -100H-38Z" fill="#6E767C"/><rect x="-48" y="-104" width="96" height="8" rx="3" fill="#8A9298"/>${at(0, -104, steam(3, 0.9))}${glow(0, -30, 90, 'gCoolGlow', 'opacity=".5"')}`);
  const crow = at(930, 1150, `${anim(tl([[32.2, 'transform:translate(220px,-260px) scale(.6);opacity:0', OUT], [32.3, 'transform:translate(220px,-260px) scale(.6);opacity:1', OUT], [33.2, 'transform:translate(0px,0px) scale(1);opacity:1']]), anim(tl([[33.8, 'transform:rotate(0deg)', OUT], [34.1, 'transform:rotate(-18deg)'], [34.9, 'transform:rotate(-18deg)', EASE], [35.2, 'transform:rotate(14deg)'], [36.2, 'transform:rotate(14deg)', EASE], [36.6, 'transform:rotate(0deg)']]), '<ellipse cx="0" cy="-16" rx="22" ry="14" fill="#121417"/><circle cx="-18" cy="-30" r="10" fill="#121417"/><path d="M-27 -31L-40 -28L-27 -26Z" fill="#2A2C2E"/><circle cx="-20" cy="-32" r="2" fill="#E8E2C8"/><path d="M14 -18L36 -10L14 -8Z" fill="#121417"/><path d="M-4 -2V8M4 -2V8" stroke="#121417" stroke-width="2.5"/>'))}`);
  const tank = at(930, 1350, `${rect(-70, -200, 140, 200, '#2E3A40', 'rx="10"')}${rect(-70, -200, 140, 20, '#3A464C', 'rx="8"')}<path d="M-60 -140H60M-60 -80H60" stroke="#25303A" stroke-width="5"/>`);
  const crackle = at(0, 0, `${[0, 1, 2].map((i) => anim(loop('0%{transform:scale(.3);opacity:0}15%{opacity:.85}100%{transform:scale(1.3);opacity:0}', 1.2, i * 0.4, OUT), '<path d="M-18 -30Q0 -44 18 -30M-30 -40Q0 -64 30 -40" stroke="#CFE8F2" stroke-width="3" fill="none" stroke-linecap="round"/>')).join('')}
    ${anim(loop('0%{opacity:0}10%{opacity:1}20%{opacity:0}45%{opacity:0}50%{opacity:1}58%{opacity:0}100%{opacity:0}', 1, 0, LIN), '<path d="M30 -10L40 -22L48 -6L58 -20L66 -8" stroke="#E8F4F8" stroke-width="2.5" fill="none"/>')}`);
  const dadajiRadio = at(800, 1760, `<g transform="scale(1.22)">${rect(-80, -10, 160, 120, '#3E5A7A', 'rx="6"')}<path d="M-80 30H80M-80 70H80" stroke="#2E4A68" stroke-width="5"/>
    ${dadaji({ headStyle: loop('0%{transform:rotate(-4deg)}50%{transform:rotate(-8deg)}100%{transform:rotate(-4deg)}', 4, 0, SOFT) })}
    ${at(-70, -150, `<use href="#d-radio"/>${at(58, -108, crackle)}${at(21, 12, anim(loop('0%{transform:rotate(-25deg)}50%{transform:rotate(25deg)}100%{transform:rotate(-25deg)}', 2, 0, SOFT), '<use href="#d-hand" transform="translate(14 4) rotate(-20)"/>'))}`)}
    <use href="#d-hand" transform="translate(-118 -128) rotate(80)"/></g>`);
  let boats = '';
  [[0, 0], [70, 18], [-80, 30]].forEach(([dx, dy], i) => {
    boats += at(560 + dx, 1790 + dy, anim(tl([[29, 'transform:translateX(0px)'], [38, `transform:translateX(${40 + i * 30}px)`]]), anim(loop('0%{transform:rotate(-6deg) translateY(0px)}50%{transform:rotate(6deg) translateY(-4px)}100%{transform:rotate(-6deg) translateY(0px)}', 2, i * 0.6, SOFT), '<use href="#boat" transform="scale(1.2)"/>')));
  });
  const meeraRoof = at(250, 1880, `<g transform="scale(1.25)">${meera({ face: 'worry', armLStyle: loop('0%{transform:rotate(-30deg)}50%{transform:rotate(-46deg)}100%{transform:rotate(-30deg)}', 2, 0, SOFT), armRStyle: loop('0%{transform:rotate(30deg)}50%{transform:rotate(46deg)}100%{transform:rotate(30deg)}', 2, 0, SOFT), headStyle: 'transform:rotate(8deg)', look: [3, 4] })}${at(0, -110, anim(loop('0%{transform:rotate(-10deg) scale(1)}50%{transform:rotate(10deg) scale(.9)}100%{transform:rotate(-10deg) scale(1)}', 2, 0, SOFT), '<use href="#boat" transform="scale(1.1)"/>'))}</g>`);
  const lantern = at(380, 1000, anim(loop('0%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}100%{transform:rotate(-5deg)}', 3, 0, SOFT), `<path d="M0 0V110" stroke="#222" stroke-width="3"/>${glow(0, 140, 260, 'gWarmGlow', 'opacity=".75"')}<rect x="-14" y="110" width="28" height="44" rx="6" fill="#FFD27A"/><rect x="-18" y="106" width="36" height="8" rx="3" fill="#2A2A2A"/>${glow(0, 132, 50, 'gSoftGlow')}`));
  const near = `${rect(0, 1390, W, 530, 'url(#roof5)')}${rect(0, 1380, W, 18, '#5E686C')}
    <ellipse cx="560" cy="1800" rx="230" ry="50" fill="#3E5560" opacity=".85"/><ellipse cx="560" cy="1800" rx="230" ry="50" fill="none" stroke="#7E949A" stroke-width="3" opacity=".6"/>
    ${ripples(7, { x0: 380, x1: 740, y0: 1780, y1: 1820, color: '#C9DCE2', r0: 14, r1: 30, persp: false })}
    ${ripples(10, { x0: 0, x1: 1080, y0: 1420, y1: 1900, color: '#AFC4CA', r0: 12, r1: 28 })}
    ${tank}${crow}
    <path d="M-20 960Q300 1110 700 980L720 1010Q320 1150 -20 1000Z" fill="url(#tarp)"/><path d="M0 980V1420M680 990V1420" stroke="#2A2A2A" stroke-width="7"/>
    ${lantern}
    ${neighbor(150, 1610, 1.05, '#6B4E5E', '#8E5A3C', 0, '#9A5A6A')}${neighbor(250, 1540, 0.9, '#3E5A5E', '#7E4E32', 1)}${neighbor(430, 1540, 0.92, '#5E5A3E', '#9A6644', 2, '#4E7A6A')}${neighbor(520, 1600, 1.0, '#4A4E66', '#7E4E32', 0.5)}
    ${stove}
    ${dadajiRadio}
    ${boats}${meeraRoof}`;
  const body = anim(shake(29, 38.3, 1.6, 0.15), anim(cam(29, 38.3, 'scale(1)', 'scale(1.06)', EASE, 'transform-origin:520px 1500px'), `
    ${anim(cam(29, 38.3, 'translateX(0px)', 'translateX(-14px)'), far)}
    ${rain('far', { color: '#B7C9CF', op: 0.55 })}
    ${anim(cam(29, 38.3, 'translateX(0px)', 'translateX(-30px)'), mid)}
    ${anim(tl([[flashT - 0.01, 'filter:none'], [flashT, 'filter:brightness(.18)', OUT], [flashT + 0.12, 'filter:brightness(.18)', OUT], [flashT + 0.9, 'filter:brightness(1)'], [flashT + 0.92, 'filter:none']]), near)}
    ${rain('mid', { color: '#B7C9CF', op: 0.5 })}${rain('near', { color: '#C9DAE0', op: 0.3 })}`));
  scenes.push({ a: 29, b: 38, body });
}

/* ---------------------------------------------------------- SCENE 6  38-49 */
D(lg('sky6', [[0, '#03041A'], [0.55, '#0C1236'], [1, '#18214A']]));
D(lg('water6', [[0, '#0A1030'], [1, '#02030C']]));
D(lg('wall6', [[0, '#1C2140'], [1, '#121630']]));
{
  // shot A : submerged city at night, 38 - 42.4
  const HZ = 1160;
  let towers = '';
  let under = '';
  const tops = [[60, 140, 300], [230, 110, 120], [380, 150, 380], [570, 120, 200], [720, 160, 460], [900, 130, 160], [990, 110, 260]];
  tops.forEach(([x, w, h], i) => {
    towers += rect(x, HZ - h, w, h + 4, '#0A0E26') + rect(x, HZ - h, 4, h, '#2A3366', 'opacity=".6"') + rect(x - 6, HZ - h - 10, w + 12, 12, '#0E1430');
    if (i === 2) towers += `${glow(x + 40, HZ - h - 30, 90, 'gWarmGlow', 'opacity=".5"')}${at(x + 40, HZ - h - 10, '<g transform="scale(.16)"><use href="#m-legs"/><use href="#m-coat"/><use href="#m-head" transform="translate(0 -254)"/></g>')}`;
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 3; c++) {
        if (rand() < 0.5) continue;
        const wx = x + 12 + c * (w - 24) / 3;
        const wy = HZ + 40 + r * 110 + c * 6;
        const col = rand() < 0.6 ? '#E2B868' : '#6FB4C2';
        under += `<rect x="${n1(wx)}" y="${n1(wy)}" width="${n1((w - 30) / 3)}" height="60" fill="${col}" style="${loop('0%{opacity:.22}50%{opacity:.5}100%{opacity:.22}', pick([3, 4, 5, 6]), R(0, 5), SOFT)}"/>`;
      }
    }
  });
  const sub = tops.map(([x, w]) => rect(x, HZ, w, 760, '#0E1640', 'opacity=".55"')).join('');
  const candleBoat = at(0, 1460, anim(tl([[38, 'transform:translateX(120px)', LIN], [42.6, 'transform:translateX(560px)']]), anim(loop('0%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}100%{transform:rotate(-5deg)}', 3, 0, SOFT), `<use href="#boat" transform="scale(1.6)"/>${rect(-4, -36, 8, 18, '#F2EEDF')}${anim(loop('0%{transform:scale(1)}50%{transform:scale(.85,1.15)}100%{transform:scale(1)}', 0.6, 0, SOFT), '<path d="M0 -50Q6 -42 0 -36Q-6 -42 0 -50Z" fill="#FFD27A"/>')}${glow(0, -44, 110, 'gWarmGlow', 'opacity=".6"')}`)));
  const shotA = anim(cam(38, 42.6, 'scale(1)', 'scale(1.08)', EASE, 'transform-origin:540px 1200px'), `
    ${full('url(#sky6)')}${clouds(8, { x0: -100, x1: 1200, y0: 200, y1: 900, rx0: 200, rx1: 360, color: '#1A2250', op: 0.5 })}
    ${anim(tl([[40.4, 'opacity:0'], [40.42, 'opacity:.6', OUT], [41.2, 'opacity:0']]), full('#3A4A8A', 'opacity=".5"'))}
    ${rain('far', { color: '#8A96C8', op: 0.25, dur: 2 })}
    ${towers}
    ${rect(-40, HZ, W + 80, H - HZ + 40, 'url(#water6)')}
    <g filter="url(#shimmerSoft)">${sub}${under}</g>
    <path d="M-40 ${HZ}H1120" stroke="#3A4A8A" stroke-width="2" opacity=".6"/>
    ${ripples(16, { x0: 0, x1: 1080, y0: HZ + 20, y1: 1900, color: '#5A6AA8', r0: 18, r1: 60, crowns: false })}
    ${candleBoat}
    ${rain('mid', { color: '#8A96C8', op: 0.25, dur: 3 })}${rain('near', { color: '#9AA6D8', op: 0.18, dur: 4 })}`);

  // shot B : tally wall, 100th mark, push-in, Dadaji's hand. 42.4 - 49.3
  let tally = '';
  const markRand = mulberry32(7);
  const mR = (a, b) => a + (b - a) * markRand();
  const groupPos = (gi) => [110 + (gi % 5) * 168 + mR(-8, 8), 500 + Math.floor(gi / 5) * 200 + mR(-8, 8)];
  for (let gi = 0; gi < 20; gi++) {
    const [gx, gy] = groupPos(gi);
    let d = '';
    for (let k = 0; k < 4; k++) {
      const x = gx + k * 26 + mR(-3, 3);
      d += `M${n1(x)} ${n1(gy + mR(-4, 4))}L${n1(x + mR(-6, 6))} ${n1(gy + 130 + mR(-4, 4))}`;
    }
    tally += `<path d="${d}" stroke="#E8ECF4" stroke-opacity="${n2(mR(0.55, 0.8))}" stroke-width="7" stroke-linecap="round" fill="none"/>`;
    if (gi < 19) tally += `<path d="M${n1(gx - 16)} ${n1(gy + 100)}L${n1(gx + 96)} ${n1(gy + 26)}" stroke="#E8ECF4" stroke-opacity="${n2(mR(0.55, 0.8))}" stroke-width="7" stroke-linecap="round"/>`;
  }
  const [lx, ly] = groupPos(19);
  const lastMark = `<path pathLength="1" d="M${n1(lx - 16)} ${n1(ly + 100)}L${n1(lx + 96)} ${n1(ly + 26)}" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" style="${draw(42.9, 43.9)}"/>`;
  const candle = at(170, 1420, `${rect(-110, 0, 220, 20, '#2A2238')}${rect(-12, -70, 24, 70, '#E8E2D0')}${anim(loop('0%{transform:scale(1) rotate(-3deg)}33%{transform:scale(.9,1.12) rotate(3deg)}66%{transform:scale(1.05,.95) rotate(-1deg)}100%{transform:scale(1) rotate(-3deg)}', 0.6, 0, SOFT), '<path d="M0 -102Q12 -84 0 -70Q-12 -84 0 -102Z" fill="#FFC861"/><path d="M0 -92Q5 -82 0 -74Q-5 -82 0 -92Z" fill="#FFF3CF"/>')}`);
  const candleGlow = at(170, 1340, anim(loop('0%{opacity:.85}30%{opacity:1}55%{opacity:.8}80%{opacity:.95}100%{opacity:.85}', 1.2, 0, SOFT), glow(0, 0, 560, 'gWarmGlow')));
  const chalkArm = anim(tl([[42.4, 'transform:rotate(-150deg)', EASE], [42.9, 'transform:rotate(-158deg)', LIN], [43.9, 'transform:rotate(-168deg)', EASE], [44.6, 'transform:rotate(-40deg)', EASE], [45.4, 'transform:rotate(-14deg)']]), '<use href="#m-arm"/><rect x="-5" y="94" width="10" height="20" rx="3" fill="#F2F2F2"/>');
  const meeraTally = at(780, 1890, `<g transform="scale(2.4)">${(() => {
    const faces = [['tired', 0, 46.9], ['resolve', 46.9, 60]].map(([f, a, b]) => anim(tl(a > 0 ? [[a - 0.3, 'opacity:0'], [a + 0.3, 'opacity:1']] : [[b - 0.3, 'opacity:1'], [b + 0.3, 'opacity:0']]), `<use href="#m-f-${f}"/>`)).join('');
    return `<use href="#m-legs"/>${at(-44, -194, '<use href="#m-arm" transform="rotate(10)"/>')}${at(44, -194, chalkArm)}<use href="#m-coat"/>${at(0, -254, anim(tl([[42.4, 'transform:rotate(-14deg)'], [44.2, 'transform:rotate(-14deg)', EASE], [45.2, 'transform:rotate(4deg)']]), `<use href="#m-head"/>${faces}`))}`;
  })()}</g>`);
  const hand = anim(tl([[45.9, 'transform:translate(-320px,260px);opacity:0', OUT], [46.9, 'transform:translate(0px,0px);opacity:1']]), `<path d="M-40 2000Q120 1700 640 1460" stroke="#7E848D" stroke-width="120" fill="none" stroke-linecap="round"/><path d="M-40 2000Q120 1700 640 1460" stroke="#9AA0A8" stroke-width="80" fill="none" stroke-linecap="round" opacity=".5"/><use href="#d-hand" transform="translate(680 1440) scale(2.3) rotate(-22)"/>`);
  const shotB = anim(cam(42.4, 49.3, 'scale(1) translate(0px,0px)', 'scale(1.38) translate(-60px,-120px)', EASE, 'transform-origin:780px 1290px'), `
    ${full('url(#wall6)')}
    ${(() => { let s = ''; for (let i = 0; i < 14; i++) s += rect(R(0, 1080), R(0, 1900), R(80, 260), R(6, 14), '#262C52', 'opacity=".5"'); return s; })()}
    ${candleGlow}
    ${tally}${lastMark}
    ${rect(0, 1440, W, 480, '#0E1128')}
    ${candle}
    ${meeraTally}
    ${hand}
    ${glow(780, 1500, 300, 'gWarmGlow', 'opacity=".22"')}`);
  D(lg('wall6Top', [[0, '#0C0F24', 0.97], [0.6, '#0C0F24', 0.85], [1, '#0C0F24', 0]]));
  scenes.push({ a: 38, b: 49, body: `${anim(window_(38, 42.4, 0.15), shotA)}${anim(window_(42.4, 49.3, 0.15), `${shotB}${rect(0, 0, W, 640, 'url(#wall6Top)')}`)}` });
}

/* ---------------------------------------------------------- SCENE 7  49-55 */
D(lg('sky7', [[0, '#2A3448'], [0.5, '#56667A'], [1, '#8A949A']]));
D(lg('water7', [[0, '#4A5A62'], [1, '#22303A']]));
D(lg('roof7', [[0, '#5A5E5C'], [1, '#2E3230']]));
{
  const gold = anim(tl([[50.6, 'opacity:0'], [53, 'opacity:1']]), `${full('#F2C46A', 'opacity=".35"')}${glow(540, 360, 900, 'gGoldGlow')}`);
  const cloudHalf = (dir) => anim(tl([[50.8, 'transform:translateX(0px)', EASE], [53.4, `transform:translateX(${dir * 340}px)`]]), `<g filter="url(#blur20)">${[0, 1, 2, 3, 4, 5].map((i) => `<ellipse cx="${540 + dir * (120 + i * 90)}" cy="${200 + (i % 3) * 140}" rx="${280 - i * 10}" ry="150" fill="#2C3546"/>`).join('')}<ellipse cx="${540 + dir * 300}" cy="760" rx="420" ry="120" fill="#38425A"/></g>`);
  const crack = anim(tl([[50.6, 'opacity:0'], [51.2, 'opacity:1']]), `<path d="M520 0L548 120L530 220L560 330L540 460" stroke="#FFF4C8" stroke-width="10" fill="none" filter="url(#blur3)"/>`);
  let facades = '';
  [[40, 360, 700], [760, 300, 620]].forEach(([x, w, h]) => {
    facades += rect(x, 1500 - h, w, h, '#4A5257') + rect(x + 16, 1500 - h + 20, w - 32, h - 40, 'url(#winSlate)');
    for (let k = 0; k < 4; k++) facades += rect(x, 1220 + k * 26 + R(-4, 4), w, R(5, 9), '#262C2E', `opacity="${n2(0.45 - k * 0.08)}"`);
  });
  const water = anim(tl([[51.4, 'transform:translateY(0px)', EASE], [55.3, 'transform:translateY(240px)']]), `${rect(-40, 1210, W + 80, 700, 'url(#water7)')}<path d="M-40 1210H1120" stroke="#C9C2A0" stroke-width="3" opacity=".6"/>${ripples(10, { x0: 0, x1: 1080, y0: 1220, y1: 1480, color: '#D9D2B0', r0: 14, r1: 34, crowns: false })}`);
  // frozen raindrops: hang, shimmer, then fall slowly and thin out
  let frozen = '';
  for (let gi = 0; gi < 4; gi++) {
    let s = '';
    for (let i = 0; i < 40; i++) {
      const x = R(-40, 1120);
      const y = R(80, 1700);
      s += `<path d="M${n1(x)} ${n1(y)}l${n1(-6)} ${n1(R(22, 40))}" stroke="#E4F0F6" stroke-width="${n1(R(2, 3.6))}" stroke-linecap="round" stroke-opacity="${n2(R(0.5, 0.9))}"/>`;
    }
    const tFall = 50.5 + gi * 0.25;
    const tGone = 52.4 + gi * 0.55;
    frozen += anim(tl([[49, 'transform:translateY(0px);opacity:1', EASE], [tFall, 'transform:translateY(0px);opacity:1', IN], [tGone + 0.5, 'transform:translateY(520px);opacity:0']]), anim(loop('0%{opacity:.55}50%{opacity:1}100%{opacity:.55}', 0.6, gi * 0.15, SOFT), s));
  }
  const shaft = anim(tl([[51.3, 'opacity:0', EASE], [52.4, 'opacity:.9']]), `<path d="M470 0H640L860 1900H250Z" fill="url(#gShaft)" style="mix-blend-mode:screen"/>${(() => { let s = ''; for (let i = 0; i < 16; i++) { const x = R(380, 720); const y = R(600, 1800); s += at(x, y, anim(loop('0%{transform:translate(0px,0px);opacity:0}30%{opacity:.9}100%{transform:translate(14px,-120px);opacity:0}', pick([3, 4]), R(0, 4), SOFT), `<circle r="${n1(R(2, 4))}" fill="#FFF6D8"/>`)); } return s; })()}`);
  const coatGlow = anim(tl([[51.6, 'opacity:0'], [52.6, 'opacity:1']]), glow(520, 1640, 280, 'gGoldGlow', 'opacity=".7"'));
  const sprout = at(220, 1612, `<use href="#pot"/>${at(0, -54, `${anim(tl([[52.6, 'transform:scaleY(0)', OUT], [53.6, 'transform:scaleY(1)']]), '<path d="M0 0Q-6 -40 4 -78" stroke="#4E9A3A" stroke-width="6" fill="none" stroke-linecap="round"/>')}
    ${at(3, -76, `${anim(tl([[53.3, 'transform:rotate(60deg) scale(0)', OUT], [54.3, 'transform:rotate(-10deg) scale(1)']]), '<path d="M0 0Q-30 -8 -42 -30Q-14 -32 0 0Z" fill="#6CC04A"/>')}${anim(tl([[53.5, 'transform:rotate(-60deg) scale(0)', OUT], [54.5, 'transform:rotate(8deg) scale(1)']]), '<path d="M0 0Q30 -10 40 -34Q12 -34 0 0Z" fill="#7ED05A"/>')}`)}`)}
    ${anim(tl([[53.6, 'opacity:0'], [54.2, 'opacity:.9']]), glow(0, -110, 70, 'gGoldGlow'))}`);
  const people = `${at(720, 1830, `<g transform="scale(1.05)"><use href="#d-legs" transform="translate(0 -170)"/><g transform="translate(0 -170)">${dadaji({ headStyle: 'transform:rotate(-6deg)' })}</g></g>`)}
    ${at(500, 1840, `<g transform="scale(1.55)">${meera({ face: 'resolve', armL: 16, armR: -16, look: [0, -4], headStyle: tl([[49, 'transform:rotate(0deg)'], [51, 'transform:rotate(0deg)', EASE], [52.2, 'transform:rotate(-8deg)']]) })}</g>`)}`;
  const body = anim(cam(49, 55.3, 'scale(1.06)', 'scale(1)', EASE, 'transform-origin:540px 1300px'), `
    ${full('url(#sky7)')}${gold}${crack}
    ${cloudHalf(-1)}${cloudHalf(1)}
    ${facades}
    ${water}
    ${rect(0, 1560, W, 360, 'url(#roof7)')}${rect(0, 1540, W, 26, '#6A6E6A')}
    ${shaft}${coatGlow}
    ${sprout}${people}
    ${frozen}`);
  scenes.push({ a: 49, b: 55, body });
}

/* ---------------------------------------------------------- SCENE 8  55-60 */
D(rg('gHalo', [[0, '#2A1A10', 0.42], [0.6, '#2A1A10', 0.22], [1, '#2A1A10', 0]]));
D(lg('sky8', [[0, '#7FA8C4'], [0.35, '#C9C8B4'], [0.6, '#F4D49A'], [1, '#FFC26A']]));
D(lg('water8', [[0, '#C9A060'], [0.3, '#7A7058'], [1, '#2E3438']]));
{
  const HZ = 1250;
  const rainbowCols = ['#FF6B6B', '#FFB36B', '#FFE56B', '#7FD67F', '#6BB8FF', '#9A7BFF'];
  const rainbow = anim(tl([[55.8, 'opacity:0'], [57.4, 'opacity:.5']]), `<g filter="url(#blur8)" fill="none">${rainbowCols.map((c, i) => `<path d="M${n1(540 - (720 - i * 18))} ${HZ}A${720 - i * 18} ${720 - i * 18} 0 0 1 ${n1(540 + (720 - i * 18))} ${HZ}" stroke="${c}" stroke-width="18" opacity=".6"/>`).join('')}</g>`);
  let city = '';
  let x = -20;
  while (x < 1100) {
    const w = R(70, 150);
    const h = R(140, 460);
    city += building(x, HZ + 20, w, h, '#4E4A50', 'winGold', { inset: 10 });
    city += rect(x, HZ - R(30, 70), w, 6, '#2E2A30', 'opacity=".55"');
    x += w + R(-6, 10);
  }
  const tiny = at(620, HZ - 170, '<g transform="scale(.17)"><use href="#d-legs" transform="translate(130 -170)"/><use href="#d-bust" transform="translate(130 -170)"/><use href="#d-head" transform="translate(130 -414)"/><use href="#m-legs"/><use href="#m-coat"/><use href="#m-head" transform="translate(0 -254)"/></g>');
  const tinyRoof = rect(540, HZ - 170, 200, 190, '#3E3A40');
  let birds = '';
  for (let i = 0; i < 5; i++) {
    birds += at(0, 0, anim(tl([[55, `transform:translate(${-80 - i * 50}px,${1000 + i * 30}px)`, LIN], [60, `transform:translate(${1200 - i * 40}px,${700 + i * 20}px)`]]), anim(loop('0%{transform:scaleY(1)}50%{transform:scaleY(-.6)}100%{transform:scaleY(1)}', 0.6, i * 0.12, SOFT), '<use href="#bird" stroke="#3A3A44"/>')));
  }
  const reflections = `<g filter="url(#shimmer)" opacity=".5">${rect(560, HZ, 160, 600, 'url(#gStreak)')}${rect(200, HZ, 60, 400, 'url(#gStreak)', 'opacity=".5"')}${rect(860, HZ, 60, 450, 'url(#gStreak)', 'opacity=".5"')}</g>`;
  // Title card (path glyphs) with per-letter stagger
  const stagger = (t0) => (i, g) => anim(tl([[t0 + i * 0.08, 'opacity:0;transform:translateY(24px)', OUT], [t0 + i * 0.08 + 0.7, 'opacity:1;transform:translateY(0px)']]), g);
  const [l1, w1] = glyphs('100 DAYS', { s: 1.55, adv: 58, sw: 10, stagger: stagger(55.8) });
  const [l2, w2] = glyphs('OF RAIN', { s: 1.55, adv: 58, sw: 10, stagger: stagger(56.3) });
  const title = `<ellipse cx="540" cy="640" rx="640" ry="420" fill="url(#gHalo)" style="${fade([[55.6, 0], [56.6, 1]])}"/><g stroke="#2A1A10" opacity=".25" transform="translate(4 6)">${at((W - w1) / 2, 430, l1)}${at((W - w2) / 2, 570, l2)}</g><g stroke="#FFF7E6">${at((W - w1) / 2, 430, l1)}${at((W - w2) / 2, 570, l2)}</g>`;
  const tagline = anim(tl([[56.9, 'opacity:0;transform:translateY(16px)', OUT], [57.6, 'opacity:1;transform:translateY(0px)']]), `<text x="540" y="800" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="44" font-weight="500" fill="#FFFDF6" stroke="#3A2A1A" stroke-opacity=".55" stroke-width="6" paint-order="stroke">Rain is a gift.</text><text x="540" y="862" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="44" font-weight="500" fill="#FFFDF6" stroke="#3A2A1A" stroke-opacity=".55" stroke-width="6" paint-order="stroke">Until it forgets to stop.</text>`);
  const body = anim(tl([[54.7, 'opacity:0;visibility:hidden'], [55.3, 'opacity:1;visibility:visible'], [58.3, 'opacity:1;visibility:visible', EASE], [59.1, 'opacity:0;visibility:hidden']]), `
    ${anim(cam(55, 59.2, 'scale(1.28)', 'scale(1)', EASE, 'transform-origin:600px 1150px'), `
      ${full('url(#sky8)')}${glow(820, HZ - 40, 600, 'gGoldGlow', 'opacity=".9"')}
      ${clouds(6, { x0: -100, x1: 1200, y0: 150, y1: 600, rx0: 160, rx1: 280, color: '#FFFFFF', op: 0.4 })}
      ${rainbow}
      ${city}${tinyRoof}${tiny}
      ${rect(-40, HZ + 20, W + 80, H - HZ, 'url(#water8)')}
      ${reflections}
      ${ripples(10, { x0: 0, x1: 1080, y0: HZ + 40, y1: 1880, color: '#FFE7B8', r0: 16, r1: 46, crowns: false })}
      ${birds}`)}
    ${title}${tagline}`);
  scenes.push({ a: 55, b: 60, body, own: true });
}

/* ======================================================================
 * PERSISTENT LAYERS: loop drop, lightning, vignette, UI, grain
 * ==================================================================== */
// The single raindrop that bridges the loop: falls from 58.6 s, crosses 60 -> 0, splashes at 0.85 s.
const dropFrames = [];
{
  const t0 = 58.6;
  const total = 2.25;
  const yAt = (s) => -60 + 1040 * s * s;
  for (let i = 0; i <= 8; i++) {
    const t = t0 + (1.4 * i) / 8;
    dropFrames.push([t, `transform:translateY(${n1(yAt((t - t0) / total))}px);opacity:1`, LIN]);
  }
  for (let i = 0; i <= 6; i++) {
    const t = (0.85 * i) / 6;
    dropFrames.push([t, `transform:translateY(${n1(yAt((t + 60 - t0) / total))}px);opacity:1`, LIN]);
  }
  dropFrames.push([0.86, 'transform:translateY(980px);opacity:0']);
  dropFrames.push([58.59, 'transform:translateY(-60px);opacity:0']);
}
const loopDrop = `${at(540, 0, anim(tl(dropFrames), `<use href="#drop" fill="#D6ECFF" transform="scale(1.1)"/>${glow(0, 0, 30, 'gCoolGlow', 'opacity=".6"')}`))}
  ${at(540, 980, `${anim(tl([[0.84, 'transform:scale(.05);opacity:0'], [0.86, 'transform:scale(.1);opacity:1', OUT], [1.9, 'transform:scale(1);opacity:0']]), '<ellipse rx="220" ry="60" fill="none" stroke="#D6ECFF" stroke-width="3"/>')}${anim(tl([[0.84, 'transform:scale(.2);opacity:0'], [0.86, 'transform:scale(.3);opacity:1', OUT], [1.3, 'transform:scale(1.4);opacity:0']]), '<use href="#crown" stroke="#D6ECFF" fill="#D6ECFF" stroke-width="2" transform="scale(2.4)"/>')}`)}`;

// Global lightning: white at 8% for 3 frames, then a soft decay.
const flash = (t, peak = 0.08) => [[t - 0.01, 'opacity:0'], [t, `opacity:${peak}`], [t + 0.1, `opacity:${peak}`, OUT], [t + 0.8, 'opacity:0']];
const lightning = `<rect width="${W}" height="${H}" fill="#fff" style="${tl([...flash(15.2), ...flash(35.6), ...flash(40.4, 0.04)])}"/>`;

/* ---- day counter: odometer digit roll, lands on 100 at exactly 49.000 s */
const SEGS = [
  // t0, t1, d0, d1, shape ('fast' = one smooth roll; number = exponent on progress, >1 accelerates)
  [6.0, 6.6, 1, 7, 'fast'],
  [6.6, 12.6, 7, 14, 1.2],
  [13.0, 13.6, 14, 21, 'fast'],
  [13.6, 20.6, 21, 35, 1.5],
  [21.0, 21.6, 35, 40, 'fast'],
  [21.6, 28.6, 40, 55, 1.7],
  [29.0, 29.6, 55, 60, 'fast'],
  [29.6, 37.6, 60, 75, 1.7],
  [38.0, 38.6, 75, 80, 'fast'],
  [38.6, 46.6, 80, 99, 0.55],
  [48.4, 49.0, 99, 100, 'fast'],
];
const smooth = (x) => x * x * (3 - 2 * x);
const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
function dayAt(t) {
  let d = 1;
  for (const [t0, t1, d0, d1, shape] of SEGS) {
    if (t < t0) break;
    if (t >= t1) { d = d1; continue; }
    const s = (t - t0) / (t1 - t0);
    if (shape === 'fast') return d0 + (d1 - d0) * easeIO(s);
    const u = d0 + (d1 - d0) * Math.pow(s, shape);
    const speed = ((d1 - d0) * shape * Math.pow(Math.max(s, 1e-3), shape - 1)) / (t1 - t0); // days per second
    const p = Math.min(1, Math.max(0.08, 0.3 * speed));
    const nI = Math.floor(u + 1e-9);
    const fr = u - nI;
    return nI + (fr < 1 - p ? 0 : smooth((fr - (1 - p)) / p));
  }
  return d;
}
const DIG_H = 84;
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const v = a[1] + ((b[1] - a[1]) * (p[0] - a[0])) / (b[0] - a[0]);
    const dd = Math.abs(p[1] - v);
    if (dd > maxD) { maxD = dd; idx = i; }
  }
  if (maxD <= tol) return [a, b];
  const l = simplify(pts.slice(0, idx + 1), tol);
  return l.slice(0, -1).concat(simplify(pts.slice(idx), tol));
}
function columnAnim(fn) {
  const pts = [];
  for (let i = 0; i <= 6000; i++) {
    const t = i / 100;
    pts.push([t, -fn(dayAt(t)) * DIG_H]);
  }
  const sp = simplify(pts, 0.4);
  return tl(sp.map(([t, y]) => [t, `transform:translateY(${n1(y)}px)`, LIN]));
}
const onesV = (d) => d;
const tensV = (d) => { const base = Math.floor(d / 10 + 1e-9); const c = d - base * 10; return base + (c > 9 ? c - 9 : 0); };
const hundV = (d) => { const base = Math.floor(d / 100 + 1e-9); const c = d - base * 100; return base + (c > 99 ? c - 99 : 0); };
const strip = (n, digitOf, dimOf) => {
  let s = '';
  for (let i = 0; i < n; i++) s += `<use href="#g${digitOf(i)}" transform="translate(0 ${i * DIG_H}) scale(1.2)"${dimOf(i) ? ' opacity=".28"' : ''}/>`;
  return s;
};
D(`<clipPath id="digClip"><rect x="-12" y="-10" width="220" height="${DIG_H + 4}"/></clipPath>`);
const [dayLabel] = glyphs('DAY', { s: 0.5, adv: 60, sw: 5.5 });
const counter = anim(tl([[0, 'opacity:0'], [1.7, 'opacity:0', OUT], [2.4, 'opacity:1'], [55.2, 'opacity:1', EASE], [55.8, 'opacity:0']]), at(92, 150, `
  <rect x="-26" y="-22" width="262" height="178" rx="22" fill="#000" opacity=".22"/>
  <g stroke="#FFFFFF" opacity=".85">${dayLabel}</g>
  ${at(0, 54, anim(tl([[48.95, 'transform:scale(1);stroke:#FFFFFF', OUT], [49.0, 'transform:scale(1.1);stroke:#FFC21A', EASE], [49.6, 'transform:scale(1);stroke:#FFC21A'], [55.9, 'transform:scale(1);stroke:#FFC21A'], [55.95, 'transform:scale(1);stroke:#FFFFFF']], 'transform-origin:96px 36px'), `<g clip-path="url(#digClip)" fill="none" stroke-width="6.7" stroke-linecap="round" stroke-linejoin="round">
    <g style="${columnAnim(hundV)}">${strip(2, (i) => i, (i) => i === 0)}</g>
    <g transform="translate(70 0)"><g style="${columnAnim(tensV)}">${strip(11, (i) => i % 10, (i) => i === 0)}</g></g>
    <g transform="translate(140 0)"><g style="${columnAnim(onesV)}">${strip(101, (i) => i % 10, () => false)}</g></g>
  </g>`))}`));

/* ---- chapter tags (small, under the counter) and captions */
const chapters = [
  ['RELIEF', 2.2, 6], ['ANNOYANCE', 6, 13], ['STREETS BECOME RIVERS', 13, 21], ['THE HARVEST DROWNS', 21, 29],
  ['LIFE ON THE ROOFTOPS', 29, 38], ['THE LOW POINT', 38, 49], ['THE BREAK', 49, 55],
];
const chapterTags = chapters.map(([txt, a, b]) => `<text x="92" y="372" font-family="Inter, Helvetica, Arial, sans-serif" font-size="26" font-weight="600" letter-spacing="4" fill="#FFFFFF" fill-opacity=".85" style="${tl([[a + 0.1, 'opacity:0;transform:translateX(-10px)', OUT], [a + 0.6, 'opacity:1;transform:translateX(0px)'], [b - 0.4, 'opacity:1;transform:translateX(0px)', EASE], [b, 'opacity:0;transform:translateX(0px)']])}">${txt}</text>`).join('');
const CAPTIONS = [
  ['The first rain felt like a gift.', 1.9, 5.7],
  ['Day 14. Nothing was drying.', 7.0, 12.7],
  ['Then the lights went out.', 17.6, 20.7],
  ['Fields drowned. Shelves emptied.', 22.0, 28.7],
  ['They shared what was left.', 30.0, 37.6],
  ['Day 100.', 46.6, 48.9],
  ['And then, a crack in the clouds.', 50.0, 54.7],
];
const captions = CAPTIONS.map(([txt, a, b]) => `<text x="540" y="1700" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="50" font-weight="600" fill="#FFFFFF" stroke="#000" stroke-opacity=".35" stroke-width="6" paint-order="stroke" style="${tl([[a, 'opacity:0;transform:translateY(14px)', OUT], [a + 0.6, 'opacity:1;transform:translateY(0px)'], [b - 0.5, 'opacity:1;transform:translateY(0px)', EASE], [b, 'opacity:0;transform:translateY(-6px)']])}">${txt}</text>`).join('');
// The brief caps captions at 6 words but its own storyboard gives two 7-word captions.
// The storyboard wording is kept verbatim; flag it on every build so it stays a visible decision.
for (const [c] of CAPTIONS) if (c.split(/\s+/).length > 6) console.warn(`note: caption has ${c.split(/\s+/).length} words (storyboard wording kept): "${c}"`);

const progress = `<rect x="0" y="1908" width="${W}" height="12" fill="#FFFFFF" opacity=".14"/><rect x="0" y="1908" width="${W}" height="12" fill="#FFD65A" opacity=".9" style="${tl([[0, 'transform:scaleX(0)', LIN], [60, 'transform:scaleX(1)']])}"/>`;
const grain = `<rect x="-160" y="-160" width="${W + 320}" height="${H + 320}" fill="url(#grain)" opacity=".5" style="${loop('0%{transform:translate(0px,0px)}20%{transform:translate(-37px,61px)}40%{transform:translate(53px,-23px)}60%{transform:translate(-71px,-49px)}80%{transform:translate(29px,83px)}100%{transform:translate(0px,0px)}', 0.6, 0, 'steps(1,end)')}"/>`;
const vignette = full('url(#gVignette)');
const scrims = `${rect(0, 1440, W, 480, 'url(#gScrimB)')}${rect(0, 0, W, 460, 'url(#gScrimT)')}`;

/* ======================================================================
 * ASSEMBLE
 * ==================================================================== */
const sceneMarkup = scenes.map((s, i) => `<g id="scene${i + 1}"${s.own ? '' : ` style="${window_(s.a, s.b)}"`}>${s.body}</g>`).join('\n');
const css = [...kfMap.entries()].map(([body, name]) => `@keyframes ${name}{${body}}`).join('\n');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet">
<title>100 Days of Rain</title>
<desc>A 60-second animated short. What if it rained for 100 days straight? Generated by build.js.</desc>
<style>
svg{background:#000}
g,rect,path,use,circle,ellipse,text{transform-box:view-box}
text{font-family:Inter, Helvetica, Arial, sans-serif}
${css}
</style>
<defs>
${defs.join('\n')}
</defs>
<rect width="${W}" height="${H}" fill="#000"/>
${sceneMarkup}
${loopDrop}
${lightning}
${vignette}
${scrims}
${counter}
${chapterTags}
${captions}
${progress}
${grain}
</svg>
`;

writeFileSync(join(HERE, 'rain100.svg'), svg);

/* ---- preview.html: the SVG inlined on a dark page with play/pause + scrubber */
const preview = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>100 Days of Rain — preview</title>
<style>
:root{color-scheme:dark}
html,body{margin:0;height:100%;background:#0b0c10;color:#e8e8ea;font:14px/1.4 Inter,Helvetica,Arial,sans-serif}
main{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;height:100%;padding:12px;box-sizing:border-box}
.stage{height:calc(100vh - 110px);aspect-ratio:9/16;max-width:calc(100vw - 24px);box-shadow:0 20px 60px rgba(0,0,0,.6);border-radius:10px;overflow:hidden;background:#000}
.stage svg{width:100%;height:100%;display:block}
.bar{display:flex;gap:12px;align-items:center;width:min(720px,calc(100vw - 24px))}
button{background:#FFC21A;color:#111;border:0;border-radius:999px;padding:8px 18px;font-weight:700;cursor:pointer;min-width:84px}
input[type=range]{flex:1;accent-color:#FFC21A}
output{font-variant-numeric:tabular-nums;min-width:64px;text-align:right}
</style></head><body><main>
<div class="stage">${svg.replace(/^<svg /, '<svg id="film" ')}</div>
<div class="bar"><button id="pp">Pause</button><input id="scrub" type="range" min="0" max="60000" step="1" value="0" aria-label="Scrub time"><output id="tc">0.00 s</output></div>
</main>
<script>
const anims = () => document.getAnimations();
const pp = document.getElementById('pp'), scrub = document.getElementById('scrub'), tc = document.getElementById('tc');
let playing = true, ref = null, dragging = false;
function now(){ ref = ref || anims().find(a => a.effect && a.effect.getTiming().duration === 60000); return ref ? ((ref.currentTime % 60000) + 60000) % 60000 : 0; }
function seek(ms){ anims().forEach(a => { a.currentTime = ms; }); }
function setPlaying(p){ playing = p; anims().forEach(a => p ? a.play() : a.pause()); pp.textContent = p ? 'Pause' : 'Play'; }
pp.onclick = () => setPlaying(!playing);
scrub.addEventListener('input', () => { dragging = true; seek(+scrub.value); tc.textContent = (scrub.value/1000).toFixed(2) + ' s'; });
scrub.addEventListener('change', () => { dragging = false; });
document.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); } });
(function tick(){ if (!dragging) { const t = now(); scrub.value = t; tc.textContent = (t/1000).toFixed(2) + ' s'; } requestAnimationFrame(tick); })();
</script></body></html>
`;
writeFileSync(join(HERE, 'preview.html'), preview);

const count = (re) => (svg.match(re) || []).length;
const elements = count(/<(?!\/|!|\?)[a-zA-Z]/g);
console.log(`rain100.svg  ${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB, ${elements} elements, ${kfMap.size} keyframe sets`);
console.log(`preview.html ${(Buffer.byteLength(preview) / 1024).toFixed(1)} KB`);
