// The AI console across several keys (the owner's console designs, as generic spans; see ai-console.js):
//
//   app-ai-question  an agent asks you something: the question flows word by word across the top row of
//                    keys (each key holds its own lines, so nothing is cut by a bezel) and the answers sit
//                    on the row below, the first in green, the second in red, the rest in blue; a press on
//                    an answer lights it as sent
//   app-ai-stream    the work stream: packets of light run along a row of keys while an agent works,
//                    passing behind the bezels; idle, a few drift slowly
//
// Both draw per key (keyInto), so a key whose pixels did not change stays byte-identical.

import { surface, rect, circle, n, measureText, capHeight } from '../../scene/index.js';
import { clamp, outExpo } from '../../scene/easing.js';
import { hash } from '../../scene/noise.js';
import { keyInto } from '../../scene/compose.js';
import { frameClock, materials, rowCells, spectrumHue } from '../spans/_d3-span.js';
import { keyRing } from './ai-console.js';

// ── text flow: words across keys ─────────────────────────────────────────────

/** Greedy line breaking into `perKey` lines per key across `keys` keys; long words break with a hyphen. */
export function flowWords(str, { keys, perKey, maxWidth, size, weight = 600 }) {
  const fits = (s) => measureText(s, { size, weight }) <= maxWidth;
  const words = String(str).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  const push = () => { if (cur) lines.push(cur); cur = ''; };
  for (let w of words) {
    while (!fits(w)) {                                  // a word wider than a key: split it
      let i = w.length - 1;
      while (i > 1 && !fits(`${w.slice(0, i)}-`)) i--;
      push();
      lines.push(`${w.slice(0, i)}-`);
      w = w.slice(i);
    }
    if (!cur) cur = w;
    else if (fits(`${cur} ${w}`)) cur = `${cur} ${w}`;
    else { push(); cur = w; }
  }
  push();
  const max = keys * perKey;
  if (lines.length > max) {
    lines.length = max;
    let last = lines[max - 1];
    while (last.length > 1 && !fits(`${last}…`)) last = last.slice(0, -1);
    lines[max - 1] = `${last.replace(/\s+$/, '')}…`;
  }
  return Array.from({ length: keys }, (_, i) => lines.slice(i * perKey, (i + 1) * perKey));
}

const CHOICE_TONE = ['ok', 'neg'];
const ringOf = (k, i) => (i === 0 ? k.colors.pos : i === 1 ? k.colors.neg : k.colors.info);

const question = {
  id: 'app-ai-question', title: 'Agent Question', category: 'AI Console',
  description: 'An agent asks you something: the question flows word by word across the top row of keys and the answers wait below, green, red and blue. A press sends one.',
  tags: ['ai', 'agent', 'question', 'ask', 'answer', 'choices', 'approve', 'claude', 'console', 'span', 'text'],
  surface: 'span', span: { cols: 'all', rows: 2 }, fps: 8, loop: 4, press: 'momentary',
  params: {
    question: { type: 'text', default: 'The release notes are ready. Publish them as they are?', maxLength: 160, label: 'Question' },
    choices: { type: 'text', default: 'Yes, No, Edit first', maxLength: 60, label: 'Answers (comma-separated)' },
    from: { type: 'text', default: 'Agent asks', maxLength: 14, label: 'Who asks' },
  },
  order: 50,
  render(ctx) {
    const d = surface(ctx);
    const { grid } = ctx;
    const rows = [...new Set(grid.cells.map((c) => c.row))].sort((a, b) => a - b);
    const top = rowCells(grid, rows[0]), bottom = rows.length > 1 ? rowCells(grid, rows[1]) : [];
    const choices = String(ctx.params.choices).split(',').map((s) => s.trim()).filter(Boolean).slice(0, Math.max(1, bottom.length));
    const pressedChoice = (ctx.pressed || ctx.pressAge < 3) ? bottom.findIndex((c) => c.i === ctx.pressKey) : -1;
    const sent = pressedChoice >= 0 && pressedChoice < choices.length ? pressedChoice : -1;
    d.add(rect({ width: d.w, height: d.h, fill: '#000000' }));
    // the question: one block of lines per key, the first key under a small "who asks" line
    const K = Math.min(grid.key.w, grid.key.h), u = K / 72;
    const size = (K >= 110 ? 10.5 : 10) * u, lh = size * 1.22, pad = 7 * u;
    // as many lines as a key holds under the first key's "who asks" line, spread over the row: a short
    // question takes two or three lines a key across several keys rather than filling the first two
    const maxWidth = grid.key.w - pad * 2;
    const maxPer = Math.max(2, Math.min(5, Math.floor((grid.key.h - pad * 2 - 9 * u) / lh)));
    const total = flowWords(ctx.params.question, { keys: 1, perKey: 99, maxWidth, size })[0].length;
    const perKey = Math.min(maxPer, Math.max(2, Math.ceil(total / Math.max(1, top.length))));
    const blocks = flowWords(ctx.params.question, { keys: top.length, perKey, maxWidth, size });
    const arr = ctx.reduced ? 1 : outExpo(clamp(ctx.t / 0.8));
    top.forEach((cell, i) => keyInto(d, cell, (k) => {
      k.background({ tone: i === 0 ? 'warn' : 'idle' });
      const lines = blocks[i] || [];
      const head = i === 0 ? capHeight(k.typeStyle('eyebrow').size) + 3 * u : 0;
      if (i === 0) k.eyebrow(ctx.params.from, { align: 'center', color: 'warn' });
      const total = lines.length * lh;
      const y0 = head + (k.h - head - total) / 2 + lh * 0.78;
      lines.forEach((ln, j) => k.text('caption', ln, { y: y0 + j * lh, size, color: 'ink', opacity: i * 0.12 > arr ? 0 : 1, maxWidth: k.w - pad * 1.6 }));
    }, { tag: `q${cell.i}`, clip: false, tone: i === 0 ? 'warn' : 'idle' }));
    // the answers
    bottom.forEach((cell, i) => keyInto(d, cell, (k) => {
      if (i >= choices.length) { k.background({ tone: 'off' }); return; }
      const isSent = sent === i, dim = sent >= 0 && !isSent;
      k.background({ tone: isSent ? CHOICE_TONE[i] || 'info' : 'idle' });
      const c = ringOf(k, i);
      if (isSent) k.add(rect({ width: k.w, height: k.h, rx: k.m.radius, fill: c, fillOpacity: k.dark ? 0.28 : 0.18 }));
      keyRing(k, c, { width: Math.max(2, k.m.u * 2.6), opacity: dim ? 0.35 : 1, f: ctx.reduced ? 1 : outExpo(clamp((ctx.t - 0.25 - i * 0.12) / 0.6)) });
      k.value(choices[i], { cy: k.h * (isSent ? 0.42 : 0.5), color: dim ? 'muted' : 'ink', maxWidth: k.w - k.m.text * 2 });
      if (isSent) k.caption('sent', { y: k.h - (k.theme.type.label?.baseline ?? 6.5) * k.m.u, color: 'ink' });
    }, { tag: `a${cell.i}`, clip: false, tone: 'idle' }));
    return d.svg();
  },
};

// ── app-ai-stream ────────────────────────────────────────────────────────────

const stream = {
  id: 'app-ai-stream', title: 'Work Stream', category: 'AI Console',
  description: 'Packets of light run along a row of keys while an agent works, colored by the Spectrum and passing behind the bezels; idle, a few drift slowly.',
  tags: ['ai', 'agent', 'working', 'stream', 'tokens', 'activity', 'busy', 'claude', 'console', 'span', 'ambient'],
  surface: 'span', span: { cols: 'all', rows: 1 }, fps: 12, loop: 6,
  states: ['working', 'idle'], tones: { working: 'active', idle: 'idle' }, press: 'toggle',
  params: {
    density: { type: 'number', default: 1, min: 0.3, max: 2, step: 0.1, label: 'Packets' },
    budget: { type: 'number', default: 30, min: 10, max: 240, step: 5, label: 'Device budget (key images/s)' },
  },
  order: 51,
  render(ctx) {
    const d = surface(ctx);
    const { grid, theme: T } = ctx;
    const cells = grid.cells;
    const working = (ctx.stateName || 'working') === 'working';
    const { t } = frameClock(ctx, { fps: 12, changing: cells.length, still: 1.4 });
    materials(d, { tone: 'idle' });
    const K = Math.min(grid.key.w, grid.key.h), u = K / 72;
    const W = d.w, lanes = 3;
    const count = Math.round(cells.length * (working ? 2.4 : 0.8) * ctx.params.density);
    const len = K * (working ? 0.42 : 0.3), hh = Math.max(1.5, 2.2 * u);
    const speed = (W + len) / (working ? 2 : 6);                    // px/s: a packet crosses the row in 2 s (6 s idle)
    const hairs = new Map(), heads = new Map();
    for (let p = 0; p < count; p++) {
      const off = hash(p, ctx.seed, 17), lane = Math.floor(hash(p, 5) * lanes);
      const v = speed * (0.75 + 0.5 * hash(p, 9));
      const span = W + len * 2;
      const x = ((t * v + off * span) % span) - len;              // head position
      const yLane = (lane - (lanes - 1) / 2) * K * 0.17;
      const hue = spectrumHue(clamp(x / W));
      for (const c of cells) {
        const y = c.y + c.h / 2 + yLane;
        const x0 = Math.max(c.x + K * 0.08, x - len), x1 = Math.min(c.x + c.w - K * 0.08, x);
        if (x1 - x0 < 0.5) continue;
        const color = T.spectral(hue, { tier: 'vivid' });
        if (!hairs.has(c.i)) hairs.set(c.i, []);
        hairs.get(c.i).push(rect({ x: n(x0), y: n(y - hh / 2), width: n(x1 - x0), height: n(hh), rx: n(hh / 2), fill: color, fillOpacity: n(working ? 0.55 : 0.3, 3) }));
        if (x <= c.x + c.w - K * 0.08 && x >= c.x + K * 0.08) {
          if (!heads.has(c.i)) heads.set(c.i, []);
          heads.get(c.i).push(circle({ cx: n(x), cy: n(y), r: n(hh * 1.6), fill: color, fillOpacity: 0.3 }) + circle({ cx: n(x), cy: n(y), r: n(hh * 0.8), fill: d.dark ? '#ffffff' : color }));
        }
      }
    }
    // a faint rail through each key, then the packets (cells in order, so each key's markup stays together)
    for (const c of cells) {
      const y = c.y + c.h / 2;
      d.add(rect({ x: n(c.x + K * 0.08), y: n(y - 0.5), width: n(c.w - K * 0.16), height: 1, fill: d.colors.line, fillOpacity: 0.7 }));
      for (const m of hairs.get(c.i) || []) d.add(m);
      for (const m of heads.get(c.i) || []) d.add(m);
    }
    return d.svg();
  },
};

export default [question, stream];
