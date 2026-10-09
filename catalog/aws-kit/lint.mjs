// awd lint: geometry checks for AWS kit diagrams (k33bz fork). No deps, no browser.
// It reads the SVG the generator emits (so `extra` markup and timed captions are covered too),
// measures text with Arial's advance widths, and reports what the layout rules in
// catalog/drafts/AWS_KIT.md forbid: overlaps, text across frame borders, wires through text or
// icons, badges on icons, content off the canvas, nodes in a group's header band.
//
//   import { lint } from './awd.mjs';  lint(spec) -> [{ severity, code, message, at }]
//   node catalog/aws-kit/awd.mjs lint <family spec> [diagram id]
// (this module imports nothing; awd.mjs passes it the markup it drew)
//
// Severity: error = breaks a layout rule (build fails); warn = a style rule (AWS deck) the
// diagram departs from; info = worth a look (timed captions over static text are usually a
// deliberate swap). A diagram can accept a finding with `lintAllow: ['<code>', '<code>:<text>']`,
// matched against the code and the start of the message.

// Arial advance widths per 1000 em (regular, bold), read from arial.ttf / arialbd.ttf hmtx.
const CH = '0123456789 !"#$%&\'()*+,-./:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~–—·•→←↔×≤≥é°µ';
const W4 = [556,556,556,556,556,556,556,556,556,556,278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,556,1000,333,350,1000,1000,1000,584,549,549,556,400,576];
const W7 = [556,556,556,556,556,556,556,556,556,556,278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,556,1000,333,350,1000,1000,1000,584,549,549,556,400,576];
const ADV = [new Map(), new Map()];
[...CH].forEach((c, i) => { ADV[0].set(c, W4[i]); ADV[1].set(c, W7[i]); });
export function textWidth(s, px, bold = false, spacing = 0) {
  const t = ADV[bold ? 1 : 0]; let w = 0, n = 0;
  for (const c of String(s)) { w += t.get(c) ?? 556; n++; }
  return (w * px) / 1000 + spacing * Math.max(0, n - 1);
}

// font size per kit text class (aws.css)
const SIZE = { 't-g': 10, 't-sub': 9, 't-wire': 8.5 };
const TILE = { normal: [480, 300], wide: [960, 440], full: [1400, 900] };

// ---- a small SVG reader: our generator's markup (and checked `extra`) only ----
const unent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function parseSvg(src) {
  const root = { tag: '#root', attrs: {}, kids: [] }, stack = [root];
  for (const m of src.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)|<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g)) {
    const [, close, tag, attrSrc, self, text] = m;
    const top = stack[stack.length - 1];
    if (text != null) { top.kids.push({ tag: '#text', text: unent(text) }); continue; }
    if (!tag) continue;
    if (close) { while (stack.length > 1 && stack.pop().tag !== tag); continue; }
    const attrs = {};
    for (const a of (attrSrc || '').matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unent(a[2] ?? a[3]);
    const el = { tag, attrs, kids: [] };
    top.kids.push(el);
    if (!self) stack.push(el);
  }
  return root.kids.find((k) => k.tag === 'svg') || root;
}
const cls = (el) => ` ${el.attrs.class || ''} `;
const has = (el, c) => cls(el).includes(` ${c} `);
const styleOf = (el) => Object.fromEntries((el.attrs.style || '').split(';').map((d) => d.split(':').map((s) => s.trim())).filter((d) => d[0]));
const textOf = (el) => el.kids.map((k) => (k.tag === '#text' ? k.text : k.tag === 'tspan' ? '' : textOf(k))).join('');

// window [a,b] an element is visible in, from its <animate attributeName="opacity" values="0;1;0">
function windowOf(el) {
  const an = el.kids.find((k) => k.tag === 'animate' && k.attrs.attributeName === 'opacity');
  if (!an) return null;
  const v = (an.attrs.values || '').split(';'), kt = (an.attrs.keyTimes || '').split(';').map(Number);
  if (v.join(';') === '0;1;0' && kt.length === 3) return [kt[1], kt[2]];
  if (v.join(';') === '1;0;1' && kt.length === 3) return { off: [kt[1], kt[2]] };   // a standing note hidden for a swap
  return 'live';   // e.g. a fading wire: always drawn
}

// Walk the tree into flat items: text lines, icons, frames, wires, badges, opaque patches.
function collect(svg, id) {
  const items = [];
  const walk = (el, st) => {
    if (el.tag === '#text' || el.tag === 'defs' || el.tag === 'marker' || el.tag === 'title' || el.tag === 'desc' || el.tag === 'metadata' || el.tag === 'style') return;
    if (has(el, 'awd-static') || has(el, 'pk') || has(el, 'pk-2') || has(el, 'pk-bad') || has(el, 'ring') || has(el, 'ring-2') || has(el, 'ring-bad') || has(el, 'g-hot') || has(el, 'awd-mark')) return;
    let s = st;
    const w = windowOf(el);
    if (has(el, 'anim') || el.attrs.opacity === '0') {
      if (Array.isArray(w)) s = { ...st, t: w };
      else if (w && w.off) s = { ...st, off: w.off };
      else if (w !== 'live') return;                       // hidden and never shown
    }
    if (el.tag === 'g' && has(el, 'st')) {
      const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(el.attrs.transform || '');
      if (m) items.push({ k: 'badge', t: s.t, name: `badge ${textOf(el).trim()}`, b: { x0: +m[1] - 7.5, y0: +m[2] - 7.5, x1: +m[1] + 7.5, y1: +m[2] + 7.5 } });
      return;
    }
    if (el.tag === 'use') {
      const x = +el.attrs.x || 0, y = +el.attrs.y || 0, wd = +el.attrs.width, ht = +el.attrs.height;
      // a colorway pair draws two <use>s on one spot: keep one
      if (!has(el, 'cw-l')) items.push({ k: 'icon', t: s.t, ghost: s.ghost, name: `icon ${String(el.attrs.href).replace('#aws-', '')}`, b: { x0: x, y0: y, x1: x + wd, y1: y + ht } });
      return;
    }
    if (el.tag === 'rect' && has(el, 'awd-box')) {
      // a box or pill node: an obstacle like an icon, with its own label inside
      const x = +el.attrs.x, y = +el.attrs.y;
      items.push({ k: 'icon', box: true, t: s.t, off: s.off, name: 'box', b: { x0: x, y0: y, x1: x + +el.attrs.width, y1: y + +el.attrs.height } });
      return;
    }
    if (el.tag === 'rect' && has(el, 'g')) {
      items.push({ k: 'frame', name: `frame ${(el.attrs.class.match(/g-(\w+)/) || [])[1]}`, b: { x0: +el.attrs.x, y0: +el.attrs.y, x1: +el.attrs.x + +el.attrs.width, y1: +el.attrs.y + +el.attrs.height } });
      return;
    }
    if (el.tag === 'rect' && /fill:\s*(var\(--awd-panel|var\(--panel)/.test(el.attrs.style || '')) {
      const x = +el.attrs.x, y = +el.attrs.y;
      items.push({ k: 'patch', t: s.t, b: { x0: x, y0: y, x1: x + +el.attrs.width, y1: y + +el.attrs.height } });
      return;
    }
    if (el.tag === 'path' && has(el, 'w') && el.attrs.d && !/stroke:var\(--awd-pk\)/.test(el.attrs.style || '')) {
      items.push({ k: 'wire', t: s.t, name: `wire ${el.attrs.id ? el.attrs.id.slice(id.length + 1) : '(extra)'}`, pts: pts(el.attrs.d) });
      return;
    }
    if (el.tag === 'text') { textItems(el, s, items); return; }
    const next = has(el, 'awd-ghost') ? { ...s, ghost: true } : s;
    for (const k of el.kids) walk(k, next);
  };
  walk(svg, { t: null });
  return items;
}

function pts(d) {
  const out = []; let x = 0, y = 0;
  for (const [, c, v] of d.matchAll(/([MHVL])\s*([-\d.]+(?:[ ,][-\d.]+)?)/g)) {
    const n = v.split(/[ ,]/).map(Number);
    if (c === 'M' || c === 'L') { x = n[0]; y = n[1]; } else if (c === 'H') x = n[0]; else y = n[0];
    out.push([x, y]);
  }
  return out;
}

// one item per rendered line; ink box = cap height above the baseline, a little below it
function textItems(el, s, items) {
  const css = styleOf(el), c = cls(el);
  const size = parseFloat(css['font-size']) || Object.entries(SIZE).find(([k]) => c.includes(` ${k} `))?.[1] || 10.5;
  const bold = /^(700|800|900|bold)$/.test(css['font-weight'] || '');
  const spacing = parseFloat(css['letter-spacing']) || 0;
  const anchor = css['text-anchor'] || el.attrs['text-anchor'] || (c.includes(' t-c ') || c.includes(' t-wire ') || c.includes(' t-gc ') ? 'middle' : 'start');
  let x = +el.attrs.x || 0, y = +el.attrs.y || 0;
  const lines = [];
  const own = el.kids.filter((k) => k.tag === '#text').map((k) => k.text).join('').trim();
  if (own) lines.push({ x, y, text: own });
  for (const k of el.kids.filter((k) => k.tag === 'tspan')) {
    if (k.attrs.x != null) x = +k.attrs.x;
    y += parseFloat(k.attrs.dy) || 0;
    if (k.attrs.y != null) y = +k.attrs.y;
    const t = textOf(k).trim(); if (t) lines.push({ x, y, text: t });
  }
  for (const ln of lines) {
    const w = textWidth(ln.text, size, bold, spacing);
    const x0 = anchor === 'middle' ? ln.x - w / 2 : anchor === 'end' ? ln.x - w : ln.x;
    items.push({ k: 'text', t: s.t, off: s.off, cls: c.trim(), name: `text "${ln.text.slice(0, 40)}"`, lines: lines.length, b: { x0, x1: x0 + w, y0: ln.y - 0.68 * size, y1: ln.y + 0.05 * size } });
  }
}

// ---- geometry ----
const hit = (a, b, pad = 0) => a.x0 < b.x1 - pad && b.x0 < a.x1 - pad && a.y0 < b.y1 - pad && b.y0 < a.y1 - pad;
const shrink = (b, d) => ({ x0: b.x0 + d, y0: b.y0 + d, x1: b.x1 - d, y1: b.y1 - d });
const inside = (b, f) => b.x0 >= f.x0 && b.x1 <= f.x1 && b.y0 >= f.y0 && b.y1 <= f.y1;
function segHits(p, q, b) {
  const x0 = Math.min(p[0], q[0]), x1 = Math.max(p[0], q[0]), y0 = Math.min(p[1], q[1]), y1 = Math.max(p[1], q[1]);
  return x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0;
}
const wireHits = (w, b) => w.pts.some((p, i) => i > 0 && segHits(w.pts[i - 1], p, b));
// windows overlap (null = always shown)
// shown at the same time: timed windows overlap (null = always), and a standing note hidden for a swap
// (off) does not meet what shows inside its off window
const within = (t, off) => t && off && t[0] >= off[0] && t[1] <= off[1];
const together = (a, b) => !within(a.t, b.off) && !within(b.t, a.off) && (!a.t || !b.t || (a.t[0] < b.t[1] && b.t[0] < a.t[1]));
// does a timed opaque patch cover this static item while the timed item shows?
const patched = (items, stat, timed) => items.some((p) => p.k === 'patch' && p.t && timed.t && p.t[0] <= timed.t[0] && p.t[1] >= timed.t[1] && inside(shrink(stat.b, 1), p.b));
const at = (b) => `${Math.round((b.x0 + b.x1) / 2)},${Math.round((b.y0 + b.y1) / 2)}`;

export function lint(spec, svg) {
  const out = [];
  const add = (severity, code, message, b) => out.push({ severity, code, message, at: b ? at(b) : '' });
  const W = spec.w || 480, H = spec.h || 240;
  const items = collect(parseSvg(svg), spec.id);
  const texts = items.filter((i) => i.k === 'text'), icons = items.filter((i) => i.k === 'icon' && !i.ghost);
  const frames = items.filter((i) => i.k === 'frame'), wires = items.filter((i) => i.k === 'wire'), badges = items.filter((i) => i.k === 'badge');
  const canvas = { x0: 0, y0: 0, x1: W, y1: H };

  // canvas
  for (const i of [...texts, ...icons, ...badges, ...frames]) if (!inside(shrink(i.b, 0.5), canvas)) add('error', 'off-canvas', `${i.name} runs past the ${W}x${H} viewBox`, i.b);
  const size = spec.full ? 'full' : spec.wide ? 'wide' : 'normal', [tw, th] = TILE[size];
  if (W > tw || H > th) add('warn', 'tile-size', `${W}x${H} is larger than a ${size} tile (${tw}x${th})${size === 'full' ? '' : '; full: true allows up to 1400x900'}`);

  // icons on icons
  for (let i = 0; i < icons.length; i++) for (let j = i + 1; j < icons.length; j++) {
    const a = icons[i], b = icons[j];
    if (together(a, b) && hit(a.b, b.b, 2) && !(a.b.x0 === b.b.x0 && a.b.y0 === b.b.y0)) add('error', 'icon-overlap', `${a.name} overlaps ${b.name}`, a.b);
  }
  // text on text: static pairs are errors; a timed caption over static text is usually a swap
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j];
    if (!together(a, b) || !hit(a.b, b.b, 0.5)) continue;
    if (!a.t && !b.t) add('error', 'text-overlap', `${a.name} overlaps ${b.name}`, a.b);
    else if (a.t && b.t) add('error', 'text-overlap', `${a.name} overlaps ${b.name} while both show`, a.b);
    else { const [s, t] = a.t ? [b, a] : [a, b]; if (!patched(items, s, t)) add('info', 'text-over-text', `timed ${t.name} lands on ${s.name}`, t.b); }
  }
  // text on icons (a frame's corner icon included)
  for (const t of texts) for (const ic of icons) if (together(t, ic) && hit(t.b, shrink(ic.b, 2)) && !(ic.box && inside(t.b, ic.b))) add('error', 'text-on-icon', `${t.name} overlaps ${ic.name}`, t.b);
  // text across (or within 2px of) a frame border: rendered glyphs run a little wider than advances
  for (const t of texts) for (const f of frames) {
    const b = shrink(t.b, -2), F = f.b;
    const vert = (x) => b.x0 < x && x < b.x1 && b.y1 > F.y0 && b.y0 < F.y1;
    const horz = (y) => b.y0 < y && y < b.y1 && b.x1 > F.x0 && b.x0 < F.x1;
    if (vert(F.x0) || vert(F.x1) || horz(F.y0) || horz(F.y1)) add('error', 'text-on-border', `${t.name} crosses the ${f.name} border`, t.b);
  }
  // wires through text and through icons they do not connect
  for (const w of wires) {
    const ends = [w.pts[0], w.pts[w.pts.length - 1]];
    const near = (b) => ends.some(([x, y]) => x > b.x0 - 8 && x < b.x1 + 8 && y > b.y0 - 34 && y < b.y1 + 34);
    for (const t of texts) if (together(w, t) && wireHits(w, shrink(t.b, 0.5))) add('error', 'wire-on-text', `${w.name} runs through ${t.name}`, t.b);
    for (const ic of icons) if (together(w, ic) && !near(ic.b) && wireHits(w, shrink(ic.b, 3))) add('error', 'wire-on-icon', `${w.name} runs through ${ic.name}`, ic.b);
  }
  // badges
  for (const bd of badges) {
    for (const ic of icons) if (together(bd, ic) && hit(bd.b, shrink(ic.b, 2))) add('error', 'badge-on-icon', `${bd.name} sits on ${ic.name}`, bd.b);
    for (const t of texts) if (together(bd, t) && hit(bd.b, t.b, 0.5)) add('error', 'badge-on-text', `${bd.name} sits on ${t.name}`, bd.b);
  }
  for (let i = 0; i < badges.length; i++) for (let j = i + 1; j < badges.length; j++) if (together(badges[i], badges[j]) && hit(badges[i].b, badges[j].b, 1)) add('error', 'badge-overlap', `${badges[i].name} overlaps ${badges[j].name}`, badges[i].b);

  // a node in its frame's header band (22px under the top edge)
  for (const n of spec.nodes || []) {
    if (n.kind) continue;
    const s = n.size || 40, cx = n.x + s / 2, cy = n.y + s / 2;
    // only frames that draw a header (a label or an icon) have a band to keep clear
    const hasHeader = (g) => (g.label != null ? g.label !== '' : g.kind !== 'gen') || typeof g.icon === 'string' || (g.icon !== false && !['az', 'sg', 'gen'].includes(g.kind));
    const own = (spec.groups || []).filter((g) => cx > g.x && cx < g.x + g.w && cy > g.y && cy < g.y + g.h && hasHeader(g)).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (own && n.y < own.y + 22 && n.y + s > own.y) add('warn', 'header-band', `node ${n.id} sits in the ${own.kind} frame's 22px header band`, { x0: n.x, y0: n.y, x1: n.x + s, y1: n.y + s });
  }
  // AWS deck: labels at most 2 lines; one icon size per diagram
  for (const n of spec.nodes || []) {
    if (n.kind || (n.labelPos || 'b') !== 'b') continue;
    const lines = texts.find((t) => t.cls === 't-c' && Math.abs((t.b.x0 + t.b.x1) / 2 - (n.x + (n.size || 40) / 2)) < 1 && t.b.y0 > n.y + (n.size || 40) - 2 && t.b.y0 < n.y + (n.size || 40) + 12);
    if (lines && lines.lines > 2) add('warn', 'label-lines', `node ${n.id} label runs to ${lines.lines} lines (raise wrap or shorten)`, lines.b);
  }
  const sizes = new Set((spec.nodes || []).filter((n) => !n.kind).map((n) => n.size || 40));
  // AWS reference pages pair each numbered callout with a step text, numbered 1..n
  const nums = [...new Set((spec.steps || []).map((s) => String(s.n)))];
  const told = new Set((spec.steps || []).filter((s) => s.text).map((s) => String(s.n)));
  const untold = nums.filter((n) => !told.has(n));
  if (untold.length) add('warn', 'step-text', `step${untold.length > 1 ? 's' : ''} ${untold.join(', ')} ha${untold.length > 1 ? 've' : 's'} no text`);
  const sorted = nums.map(Number).sort((a, b) => a - b);
  if (sorted.some((n, i) => n !== i + 1)) add('warn', 'step-order', `step numbers ${sorted.join(', ')} do not run 1..${sorted.length}`);
  if (sizes.size > 1) add('info', 'icon-sizes', `icon sizes ${[...sizes].sort((a, b) => a - b).join(', ')} in one diagram (AWS keeps one)`);

  // dedupe (a two-line label can hit the same thing twice) and apply lintAllow
  const allow = spec.lintAllow || [];
  const seen = new Set();
  return out.filter((f) => {
    const k = `${f.code}|${f.message}`; if (seen.has(k)) return false; seen.add(k);
    return !allow.some((a) => { const [code, ...rest] = a.split(':'); const txt = rest.join(':'); return code === f.code && (!txt || f.message.startsWith(txt)); });
  });
}

// text report for the CLI
export function report(id, findings) {
  if (!findings.length) return `${id}: clean`;
  const n = (s) => findings.filter((f) => f.severity === s).length;
  return `${id}: ${n('error')} error, ${n('warn')} warn, ${n('info')} info\n` + findings.map((f) => `  ${f.severity.padEnd(5)} ${f.code.padEnd(14)} ${f.message}${f.at ? ` @${f.at}` : ''}`).join('\n');
}
