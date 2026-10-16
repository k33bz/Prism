// Whole-deck moments, after the ones the fork owner's own Stream Deck console plays across all its
// keys: confetti when a long task finishes, a ripple of attention when something needs you (amber) or
// breaks (red), and an 80s outrun drive as a screensaver. Generic here: a runtime starts them (or a
// press does), and each draws per key so the bezels hide the gaps.
//
//   span-confetti   a burst of Spectrum confetti: from the key you press, or raining from the top edge
//   span-attention  rings of one tone (amber · red · blue) spread from the middle key, keys flash as
//                   they pass, three times, then quiet
//   span-outrun     a neon sunset drive: a striped sun on the horizon, a ridge, and a grid floor rolling
//                   toward you

import { surface, rect, path, n, linearGradient, url } from '../../scene/index.js';
import { clamp, smoothstep, phase } from '../../scene/easing.js';
import { hash } from '../../scene/noise.js';
import { BUDGET, frameClock, materials, runsInRect, runsPath, circlePoints } from './_d3-span.js';

const center = (c) => [c.x + c.w / 2, c.y + c.h / 2];
const nearestCell = (cells, x, y) => cells.reduce((b, c) => (Math.hypot(...center(c).map((v, i) => v - [x, y][i])) < Math.hypot(...center(b).map((v, i) => v - [x, y][i])) ? c : b), cells[0]);

// ── span-confetti ────────────────────────────────────────────────────────────

const CONFETTI_LOOP = 4.5;
const HUES = [24, 70, 150, 205, 258, 300];

const confetti = {
  id: 'span-confetti', title: 'Confetti', category: 'Whole Device',
  description: 'A burst of Spectrum confetti across the device when something finishes: pieces flutter down behind the bezels; press a key and they burst from it.',
  tags: ['confetti', 'celebrate', 'done', 'success', 'finish', 'moment', 'burst', 'party', 'span', 'ai'],
  surface: 'span', span: { cols: 'all', rows: 'all' }, press: 'momentary', fps: 12, loop: CONFETTI_LOOP, still: 1.1,
  params: {
    amount: { type: 'number', default: 1, min: 0.4, max: 2, step: 0.1, label: 'Amount' },
    budget: BUDGET,
  },
  order: 60,
  render(ctx) {
    const k = surface(ctx);
    const { grid, theme: T } = ctx;
    const cells = grid.cells;
    const { t } = frameClock(ctx, { fps: 12, changing: cells.length, still: 1.1 });
    materials(k, { tone: 'idle' });
    const K = Math.min(grid.key.w, grid.key.h), u = K / 72;
    const W = k.w, H = k.h, g = H * 1.15;                   // gravity: px/s²
    const burst = ctx.pressed || ctx.pressAge < CONFETTI_LOOP;
    const age = burst ? (ctx.pressed ? 0 : ctx.pressAge) : phase(t, CONFETTI_LOOP) * CONFETTI_LOOP;
    const origin = burst ? center(cells.find((c) => c.i === ctx.pressKey) || nearestCell(cells, W / 2, H / 2)) : null;
    const N = Math.round(Math.min(160, 14 + cells.length * 4.5) * ctx.params.amount);
    const buckets = new Map();                                // `${cell}:${hue}` → path data
    for (let i = 0; i < N; i++) {
      const r1 = hash(i, 1, ctx.seed), r2 = hash(i, 2), r3 = hash(i, 3), r4 = hash(i, 4);
      let x, y;
      const delay = burst ? r4 * 0.12 : r4 * 1.6;
      const a = age - delay;
      if (a < 0) continue;
      if (origin) {
        // shot up and out of the pressed key, then falling with drag
        const ang = (-90 + (r1 - 0.5) * 150) * (Math.PI / 180), v = H * (0.9 + 1.1 * r2);
        const drag = 1 - Math.exp(-a * 1.6);
        x = origin[0] + Math.cos(ang) * v * drag / 1.6 + Math.sin(a * (4 + r3 * 4) + r1 * 6) * K * 0.08;
        y = origin[1] + Math.sin(ang) * v * drag / 1.6 + 0.5 * g * 0.55 * a * a;
      } else {
        // raining from above the top edge, fluttering side to side
        x = W * (r1 * 1.1 - 0.05) + Math.sin(a * (3 + r3 * 3) + r2 * 6) * K * 0.12;
        y = -K * 0.3 + (H * 0.32 + H * 0.22 * r2) * a;
      }
      if (y > H + K || x < -K || x > W + K) continue;
      const cell = cells.find((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
      if (!cell) continue;                                     // behind a bezel
      const hue = HUES[Math.floor(r3 * HUES.length)];
      const sz = K * (0.05 + 0.04 * r2), flip = Math.cos(a * (6 + r1 * 8) + r4 * 6);   // the piece turning edge-on
      const rot = (a * (2 + r2 * 3) + r1 * 6);
      const hw = sz, hh = Math.max(0.35 * u, sz * 0.45 * Math.abs(flip));
      const cs = Math.cos(rot), sn = Math.sin(rot);
      const pt = (dx, dy) => `${n(x + dx * cs - dy * sn)} ${n(y + dx * sn + dy * cs)}`;
      const key = `${cell.i}:${hue}`;
      buckets.set(key, (buckets.get(key) || '') + `M${pt(-hw, -hh)}L${pt(hw, -hh)}L${pt(hw, hh)}L${pt(-hw, hh)}Z`);
    }
    // per key, one path per color (cells in order, so each key's markup stays together)
    for (const c of cells) for (const hue of HUES) {
      const d = buckets.get(`${c.i}:${hue}`);
      if (d) k.add(path(d, { fill: T.spectral(hue, { tier: 'vivid' }) }));
    }
    return k.svg();
  },
};

// ── span-attention ───────────────────────────────────────────────────────────

const ATT_LOOP = 4, RING_EVERY = 0.9, RINGS = 3, RING_LIFE = 2.2;

const attention = {
  id: 'span-attention', title: 'Attention Ripple', category: 'Ripples & Light',
  description: 'Rings of one tone spread from the middle key across the device, three times, each key flashing as they pass: amber when something needs you, red when it breaks.',
  tags: ['attention', 'alert', 'alarm', 'ask', 'ripple', 'rings', 'moment', 'notify', 'span', 'ai'],
  surface: 'span', span: { cols: 'all', rows: 'all' }, press: 'momentary', fps: 10, loop: ATT_LOOP, still: 1.2,
  params: {
    tone: { type: 'select', default: 'warn', options: ['warn', 'neg', 'info'], label: 'Tone' },
    budget: BUDGET,
  },
  order: 45,
  render(ctx) {
    const k = surface(ctx);
    const { grid } = ctx;
    const cells = grid.cells;
    const { t } = frameClock(ctx, { fps: 10, changing: cells.length, still: 1.2 });
    const color = k.colors[ctx.params.tone] || k.colors.warn;
    materials(k, { tone: 'idle' });
    const K = Math.min(grid.key.w, grid.key.h);
    const W = k.w, H = k.h;
    const reach = Math.hypot(W, H) * 0.62, vel = reach / RING_LIFE;
    const pressedAt = ctx.pressed ? 0 : ctx.pressAge;
    const age = pressedAt < ATT_LOOP ? pressedAt : phase(t, ATT_LOOP) * ATT_LOOP;
    const o = center(pressedAt < ATT_LOOP ? cells.find((c) => c.i === ctx.pressKey) || nearestCell(cells, W / 2, H / 2) : nearestCell(cells, W / 2, H / 2));
    const lw = Math.max(1.5, K / 72 * 2.4);
    for (const c of cells) {
      const cc = center(c);
      const dist = Math.hypot(cc[0] - o[0], cc[1] - o[1]);
      let glow = 0, d = '';
      for (let r = 0; r < RINGS; r++) {
        const a = age - r * RING_EVERY;
        if (a < 0 || a > RING_LIFE) continue;
        const R = a * vel, fade = 1 - smoothstep(0.5, 1, a / RING_LIFE);
        glow = Math.max(glow, fade * (1 - clamp(Math.abs(dist - R) / (K * 0.9))));
        if (R < 1) continue;
        const runs = runsInRect(circlePoints(o[0], o[1], R, Math.max(3, K / 16)), c, lw * 2);
        if (runs.length) d += runsPath(runs);
      }
      if (glow > 0.02) k.add(rect({ x: n(c.x), y: n(c.y), width: n(c.w), height: n(c.h), rx: n(k.m.radius), fill: color, fillOpacity: n(glow * (k.dark ? 0.32 : 0.22), 3) }));
      if (d) k.add(path(d, { fill: 'none', stroke: color, strokeWidth: n(lw), strokeLinecap: 'round', strokeOpacity: 0.85 }));
    }
    return k.svg();
  },
};

// ── span-outrun ──────────────────────────────────────────────────────────────

const OUT_LOOP = 2;

/** Liang–Barsky: the part of segment (x0,y0)–(x1,y1) inside rect r, or null. */
function clipSeg(x0, y0, x1, y1, r) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  for (const [p, q] of [[-dx, x0 - r.x], [dx, r.x + r.w - x0], [-dy, y0 - r.y], [dy, r.y + r.h - y0]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const tt = q / p;
    if (p < 0) { if (tt > t1) return null; if (tt > t0) t0 = tt; } else { if (tt < t0) return null; if (tt < t1) t1 = tt; }
  }
  return [x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1];
}

const outrun = {
  id: 'span-outrun', title: 'Outrun Drive', category: 'Whole Device',
  description: 'An 80s neon drive across the device: a striped sun sets on the horizon behind a ridge while a glowing grid floor rolls toward you. A screensaver.',
  tags: ['outrun', 'synthwave', 'retro', 'neon', 'sunset', 'grid', 'screensaver', 'ambient', 'wall', '80s', 'span'],
  surface: 'span', span: { cols: 'all', rows: 'all' }, fps: 10, loop: OUT_LOOP * 6,
  params: {
    speed: { type: 'number', default: 1, min: 0.25, max: 3, step: 0.05, label: 'Speed' },
    budget: BUDGET,
  },
  order: 25,
  render(ctx) {
    const k = surface(ctx);
    const { grid, theme: T } = ctx;
    const cells = grid.cells;
    const { t } = frameClock(ctx, { fps: 10, changing: Math.ceil(cells.length * 0.6), still: 0.8 });
    const W = k.w, H = k.h, K = Math.min(grid.key.w, grid.key.h), u = K / 72;
    const hz = H * (grid.rows > 2 ? 0.5 : 0.56);           // the horizon
    const pink = T.spectral(345, { tier: 'vivid' }), magenta = T.spectral(320, { tier: 'vivid' }), cyan = T.spectral(200, { tier: 'vivid' });
    const amber = T.spectral(70, { tier: 'vivid' });
    k.add(rect({ width: n(W), height: n(H), fill: '#000000' }));
    // sky: deep night down to a magenta haze at the horizon (its own picture in every theme and mode)
    const sky = k.id('sky');
    k.def(linearGradient(sky, [[0, '#070414'], [0.62, '#1d0a3a'], [1, magenta, 0.85]], { x1: 0, y1: 0, x2: 0, y2: n(hz), gradientUnits: 'userSpaceOnUse' }));
    const floor = k.id('floor');
    k.def(linearGradient(floor, [[0, '#12051f'], [1, '#03020a']], { x1: 0, y1: n(hz), x2: 0, y2: n(H), gradientUnits: 'userSpaceOnUse' }));
    const sun = k.id('sun');
    const R = Math.min(W * 0.2, hz * 0.62);
    k.def(linearGradient(sun, [[0, amber], [1, pink]], { x1: 0, y1: n(hz - R), x2: 0, y2: n(hz), gradientUnits: 'userSpaceOnUse' }));
    for (const c of cells) {
      if (c.y < hz) k.add(rect({ x: n(c.x), y: n(c.y), width: n(c.w), height: n(Math.min(c.h, hz - c.y)), fill: url(sky) }));
      if (c.y + c.h > hz) k.add(rect({ x: n(c.x), y: n(Math.max(c.y, hz)), width: n(c.w), height: n(c.y + c.h - Math.max(c.y, hz)), fill: url(floor) }));
    }
    // the sun: horizontal bands of a disc, the gaps widening toward the horizon (the classic stripes)
    const bands = [];
    let y = hz - R;
    const stripes = 6;
    const cut = (yy) => clamp((yy - (hz - R * 0.55)) / (R * 0.55));       // 0 above the stripe zone → 1 at the horizon
    while (y < hz) {
      const f = cut(y), h = Math.max(1, (R / 18) * (1.3 - f));
      const gap = f > 0 ? Math.max(0.8 * u, (R / stripes / 3) * f * 1.6) : 0;
      bands.push([y, Math.min(hz, y + h)]);
      y += h + gap;
    }
    const sx = W / 2;
    const discX = (yy) => { const dy = yy - hz; return Math.sqrt(Math.max(0, R * R - dy * dy)); };
    for (const c of cells) {
      let d = '';
      for (const [y0, y1] of bands) {
        const a = Math.max(y0, c.y), b = Math.min(y1, c.y + c.h);
        if (b - a <= 0.1) continue;
        const wa = discX(a), wb = discX(b);
        const xa0 = Math.max(c.x, sx - wa), xa1 = Math.min(c.x + c.w, sx + wa), xb0 = Math.max(c.x, sx - wb), xb1 = Math.min(c.x + c.w, sx + wb);
        if (xa1 - xa0 <= 0.1 && xb1 - xb0 <= 0.1) continue;
        d += `M${n(xa0)} ${n(a)}L${n(Math.max(xa0, xa1))} ${n(a)}L${n(Math.max(xb0, xb1))} ${n(b)}L${n(xb0)} ${n(b)}Z`;
      }
      if (d) k.add(path(d, { fill: url(sun) }));
    }
    // a ridge on the horizon (a fixed silhouette), drawn per key
    const ridgeY = (x) => hz - H * 0.07 * (0.35 + 0.65 * Math.abs(Math.sin(x / W * 7.3 + 0.6)) * (0.55 + 0.45 * Math.sin(x / W * 17.1)));
    for (const c of cells) {
      if (c.y > hz || c.y + c.h < hz - H * 0.08) continue;
      const pts = [];
      for (let i = 0; i <= 12; i++) { const x = c.x + (c.w * i) / 12; pts.push([x, Math.max(c.y, ridgeY(x))]); }
      const bottom = Math.min(hz, c.y + c.h);
      k.add(path(`M${n(c.x)} ${n(bottom)}${pts.map(([x, yy]) => `L${n(x)} ${n(Math.min(bottom, yy))}`).join('')}L${n(c.x + c.w)} ${n(bottom)}Z`, { fill: '#0a0418' }));
    }
    // the grid floor: rows rushing toward you (quadratic spacing), rays from the vanishing point
    const p = phase(t * ctx.params.speed, OUT_LOOP);
    const rows = 9, lines = [];
    for (let i = 0; i < rows; i++) { const s = (i + p) / rows; lines.push([0, hz + (H - hz) * s * s * 1.05, W, hz + (H - hz) * s * s * 1.05]); }
    lines.push([0, hz, W, hz]);
    const rays = 13;
    for (let i = 0; i <= rays; i++) { const bx = -W * 0.6 + (W * 2.2 * i) / rays; lines.push([sx, hz, bx, H * 1.02]); }
    const lw = Math.max(1, 1.3 * u);
    for (const c of cells) {
      if (c.y + c.h < hz) continue;
      let d = '';
      for (const [x0, y0, x1, y1] of lines) { const s = clipSeg(x0, y0, x1, y1, c); if (s && Math.hypot(s[2] - s[0], s[3] - s[1]) > 0.3) d += `M${n(s[0])} ${n(s[1])}L${n(s[2])} ${n(s[3])}`; }
      if (d) {
        k.add(path(d, { fill: 'none', stroke: magenta, strokeWidth: n(lw * 3.2), strokeOpacity: 0.22 }));
        k.add(path(d, { fill: 'none', stroke: cyan, strokeWidth: n(lw), strokeOpacity: 0.95 }));
      }
    }
    return k.svg();
  },
};

export default [confetti, attention, outrun];
