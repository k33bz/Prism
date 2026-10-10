// frame: a diagram frozen at one moment of its clock, as a static SVG (k33bz fork). No deps.
// The kit animates with SMIL on one clock; slides, PNGs, print and most document tools play none of
// it, and a plain still shows only the healthy path. frame() reads the SMIL the generator drew and
// evaluates it at a moment: packets sit where they are on their wires, rings at their size, failed
// frames red, drained wires dim, timed captions and marks shown or hidden, swapped captions swapped.
// The result has no animation left. storyboard() takes one frame per numbered step.
//
//   import { frame, storyboard } from './frame.mjs';
//   frame(spec, 0.5)                -> standalone svg at mid-cycle
//   frame(spec, 'poster')           -> spec.poster (a fraction of the clock), else the still diagram
//   storyboard(spec)                -> [{ n, at, text, svg }]
//
// CLI: node catalog/aws-kit/frame.mjs <family spec> <diagram id> [--at 0.5|poster] [--theme light|dark]
//        [--out file.svg] | --storyboard <dir> (one svg per step, plus index.html)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { standalone } from './awd.mjs';
import { compileFlows } from './story.mjs';

// ---- a lossless reader and writer for the markup the generator draws ----
function parse(src) {
  const root = { tag: '#root', attrs: [], kids: [] }, stack = [root];
  const re = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|[^<]+/g;
  for (const m of src.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (!m[2]) { top.kids.push({ raw: m[0] }); continue; }
    if (m[1]) { while (stack.length > 1 && stack.pop().tag !== m[2]); continue; }
    const attrs = [...(m[3] || '').matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((a) => [a[1], a[2] ?? a[3]]);
    const el = { tag: m[2], attrs, kids: [], self: !!m[4] };
    top.kids.push(el);
    if (!m[4]) stack.push(el);
  }
  return root;
}
const get = (el, k) => el.attrs?.find((a) => a[0] === k)?.[1];
const set = (el, k, v) => { const a = el.attrs.find((x) => x[0] === k); if (a) a[1] = String(v); else el.attrs.push([k, String(v)]); };
const drop = (el, k) => { el.attrs = el.attrs.filter((a) => a[0] !== k); };
const classes = (el) => (get(el, 'class') || '').split(/\s+/).filter(Boolean);
function write(el) {
  if (el.raw != null) return el.raw;
  if (el.tag === '#root') return el.kids.map(write).join('');
  const a = el.attrs.map(([k, v]) => ` ${k}="${v}"`).join('');
  return el.self && !el.kids.length ? `<${el.tag}${a}/>` : `<${el.tag}${a}>${el.kids.map(write).join('')}</${el.tag}>`;
}

// ---- SMIL at a moment: values/keyTimes, discrete or linear; animateMotion along a path ----
const nums = (s) => String(s).split(';').map((x) => x.trim());
function valueAt(an, f) {
  const vals = nums(get(an, 'values')), kt = nums(get(an, 'keyTimes')).map(Number);
  if (vals.length !== kt.length || !vals.length) return null;
  let i = 0;
  while (i + 1 < kt.length && kt[i + 1] <= f) i++;
  if ((get(an, 'calcMode') || 'linear') === 'discrete' || i + 1 >= kt.length) return vals[i];
  const a = Number(vals[i]), b = Number(vals[i + 1]);
  if (Number.isNaN(a) || Number.isNaN(b) || kt[i + 1] === kt[i]) return vals[i];
  return String(Math.round((a + (b - a) * ((f - kt[i]) / (kt[i + 1] - kt[i]))) * 1000) / 1000);
}
function pathPoints(d) {
  const out = []; let x = 0, y = 0;
  for (const [, c, v] of d.matchAll(/([MHVL])\s*([-\d.]+(?:[ ,][-\d.]+)?)/g)) {
    const n = v.split(/[ ,]/).map(Number);
    if (c === 'M' || c === 'L') { x = n[0]; y = n[1]; } else if (c === 'H') x = n[0]; else y = n[0];
    out.push([x, y]);
  }
  return out;
}
function along(d, t) {
  const p = pathPoints(d);
  if (p.length < 2) return p[0] || [0, 0];
  const seg = []; let tot = 0;
  for (let i = 1; i < p.length; i++) { const l = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); seg.push(l); tot += l; }
  let want = tot * Math.max(0, Math.min(1, t));
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) { const k = seg[i] ? Math.min(1, want / seg[i]) : 0; return [p[i][0] + (p[i + 1][0] - p[i][0]) * k, p[i][1] + (p[i + 1][1] - p[i][1]) * k]; }
    want -= seg[i];
  }
  return p[p.length - 1];
}
function motionAt(an, f, paths) {
  const kt = nums(get(an, 'keyTimes')).map(Number), kp = nums(get(an, 'keyPoints')).map(Number);
  let i = 0;
  while (i + 1 < kt.length && kt[i + 1] <= f) i++;
  const k = i + 1 < kt.length && kt[i + 1] > kt[i] ? kp[i] + (kp[i + 1] - kp[i]) * ((f - kt[i]) / (kt[i + 1] - kt[i])) : kp[i];
  const mp = an.kids.find((x) => x.tag === 'mpath');
  const d = mp && paths.get(String(get(mp, 'href')).slice(1));
  return d ? along(d, k) : null;
}

const r2 = (n) => Math.round(n * 100) / 100;
const SMIL = new Set(['animate', 'animateMotion', 'animateTransform', 'set']);

/** Evaluate the SMIL of a drawn diagram at fraction f of its clock; returns static markup. */
export function freeze(svg, f) {
  const root = parse(svg);
  const paths = new Map();
  (function index(el) { if (el.tag === 'path' && get(el, 'id')) paths.set(get(el, 'id'), get(el, 'd')); for (const k of el.kids || []) index(k); })(root);
  (function walk(el) {
    if (!el.kids) return;
    el.kids = el.kids.filter((k) => {
      if (k.raw != null) return true;
      // the reduced-motion and still copies stand in for animation; a frame shows the real state
      if (classes(k).includes('awd-static')) return false;
      const anims = k.kids.filter((x) => SMIL.has(x.tag));
      for (const an of anims) {
        if (an.tag === 'animateMotion') {
          const p = motionAt(an, f, paths);
          // a circle moves by its center; any other shape (the IPv6 diamond) is drawn around its origin
          if (p && k.tag === 'circle') { set(k, 'cx', r2(p[0])); set(k, 'cy', r2(p[1])); } else if (p) set(k, 'transform', `translate(${r2(p[0])},${r2(p[1])})`);
          continue;
        }
        const attr = get(an, 'attributeName'), v = valueAt(an, f);
        if (attr && v != null) set(k, attr, v);
      }
      k.kids = k.kids.filter((x) => !SMIL.has(x.tag));
      if (Number(get(k, 'opacity')) === 0) return false;   // not showing at this moment
      if (classes(k).includes('anim')) set(k, 'class', classes(k).filter((c) => c !== 'anim').join(' '));
      walk(k);
      return true;
    });
  })(root);
  return write(root);
}

/** The moment a still should show: a number in [0,1), or spec.poster for 'poster' (null: the plain still). */
export function momentOf(spec, at) {
  if (at === 'poster') return typeof spec.poster === 'number' ? spec.poster : null;
  const f = Number(at);
  if (!(f >= 0 && f < 1)) throw new Error(`frame: at must be a fraction of the clock in [0, 1) or 'poster', got ${JSON.stringify(at)}`);
  return f;
}

/** A standalone static SVG of the diagram at a moment (see momentOf). */
export function frame(spec, at = 'poster', { theme = 'auto' } = {}) {
  const f = momentOf(spec, at);
  if (f == null) return standalone(spec, { theme, still: true });
  // packets and rings are drawn statically here, so the reduced-motion rules must not hide them
  return freeze(standalone(spec, { theme }), f).replace(/<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="awd"/, '<svg xmlns="http://www.w3.org/2000/svg" class="awd awd-frame"');
}

// distance from a point to a polyline, and to a box
function distPath(d, [x, y]) {
  const p = pathPoints(d || ''); let best = Infinity;
  for (let i = 1; i < p.length; i++) {
    const [ax, ay] = p[i - 1], [bx, by] = p[i], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}
const distBox = (b, [x, y]) => Math.hypot(Math.max(b.x - x, 0, x - (b.x + b.w)), Math.max(b.y - y, 0, y - (b.y + b.h)));

/**
 * One frame per numbered step, in story order. A step on a wire is shown at its first packet from
 * the previous step's moment on (hops that run together share a frame); a free badge at the earliest event near it after that moment: a packet
 * on a nearby wire, a frame failing around it, a wire draining or lighting up, a node appearing.
 */
export function storyboard(spec, { theme = 'auto', near = 60 } = {}) {
  const src = spec;
  spec = compileFlows(spec);
  // the drawn wire paths (auto-routed ones included), by wire id
  const drawn = parse(standalone(spec)), paths = new Map();
  (function index(el) { const id = get(el, 'id'); if (el.tag === 'path' && id?.startsWith(spec.id + '-')) paths.set(id.slice(spec.id.length + 1), get(el, 'd')); for (const k of el.kids || []) index(k); })(drawn);
  const nodes = new Map((spec.nodes || []).map((n) => [n.id, { x: n.x, y: n.y, w: n.w ?? n.size ?? 40, h: n.h ?? n.size ?? 40 }]));
  const groups = new Map((spec.groups || []).filter((g) => g.id).map((g) => [g.id, g]));
  const mid = (t) => Math.round(((t[0] + t[1]) / 2) * 1000) / 1000;
  const soon = (t) => Math.round(Math.min(t[0] + 0.02, (t[0] + t[1]) / 2) * 1000) / 1000;
  const events = [];
  for (const e of spec.timeline || []) {
    if (e.wire) events.push({ at: mid(e.t), wire: e.wire, dist: (p) => distPath(paths.get(e.wire), p) });
    else if (typeof e.ring === 'string' && nodes.has(e.ring)) events.push({ at: mid(e.t), dist: (p) => distBox(nodes.get(e.ring), p) });
  }
  for (const e of spec.effects || []) {
    if (e.fail && groups.has(e.fail)) events.push({ at: soon(e.t), dist: (p) => distBox(groups.get(e.fail), p) });
    else if (e.fade || e.glow) events.push({ at: soon(e.t), dist: (p) => distPath(paths.get(e.fade || e.glow), p) });
    else if (e.appear && nodes.has(e.appear)) events.push({ at: mid(e.t), dist: (p) => distBox(nodes.get(e.appear), p) });
  }
  events.sort((a, b) => a.at - b.at);
  const seen = new Set(), used = new Set(), out = [];
  let prev = -1;
  for (const s of spec.steps || []) {
    if (seen.has(String(s.n))) continue;
    seen.add(String(s.n));
    // concurrent hops share a moment: an event at the previous moment still counts, once
    const after = events.filter((e) => e.at >= prev && !used.has(e));
    // an author's moment wins (a deny at the far end of a multi-hop path, say)
    if (s.moment != null) { prev = s.moment; const text = (spec.steps || []).find((x) => String(x.n) === String(s.n) && x.text)?.text || ''; out.push({ n: s.n, at: s.moment, text, svg: frame(src, s.moment, { theme }) }); continue; }
    let pick = s.at != null ? after.find((e) => e.wire === s.at) : null;
    if (!pick && s.x != null) pick = after.find((e) => e.dist([s.x, s.y]) <= near);
    if (!pick && s.at != null) pick = after.find((e) => e.dist(along(paths.get(s.at) || '', s.f ?? 0.5)) <= near);
    pick = pick || after[0];
    const at = pick ? pick.at : null;
    if (pick) { prev = at; used.add(pick); }
    const text = (spec.steps || []).find((x) => String(x.n) === String(s.n) && x.text)?.text || '';
    out.push({ n: s.n, at, text, svg: at == null ? frame(src, 'poster', { theme }) : frame(src, at, { theme }) });
  }
  return out;
}

// ---- CLI ----
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [specPath, id, ...rest] = process.argv.slice(2);
  const opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  if (!specPath || !id) { console.error('usage: frame.mjs <family spec> <diagram id> [--at 0.5|poster] [--theme light|dark|auto] [--out f.svg] | --storyboard <dir>'); process.exit(1); }
  const mod = /\.json$/i.test(specPath) ? JSON.parse(fs.readFileSync(specPath, 'utf8')) : (await import(pathToFileURL(path.resolve(specPath)).href)).default;
  const d = mod.diagrams.find((x) => x.id === id || 'aws-' + x.id === id);
  if (!d) { console.error(`no diagram ${id} in ${specPath}`); process.exit(1); }
  const theme = opt('--theme') || 'auto';
  if (opt('--storyboard')) {
    const dir = opt('--storyboard'); fs.mkdirSync(dir, { recursive: true });
    const frames = storyboard(d, { theme });
    frames.forEach((fr) => fs.writeFileSync(path.join(dir, `${d.id}-${fr.n}.svg`), fr.svg));
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>${esc(d.name)}</title><style>body{font:15px/1.5 Arial,sans-serif;max-width:1000px;margin:24px auto;padding:0 16px}section{margin:0 0 40px}img{width:100%;height:auto}h2{font-size:17px}</style><h1>${esc(d.name)}</h1>` +
      frames.map((fr) => `<section><h2>${esc(fr.n)}. ${esc(fr.text)}</h2><img src="${d.id}-${fr.n}.svg" alt="Step ${esc(fr.n)}: ${esc(fr.text)}"></section>`).join('') + '\n');
    console.log(`storyboard ${dir}: ${frames.length} frame(s)`);
  } else {
    const svg = frame(d, opt('--at') || 'poster', { theme });
    if (opt('--out')) fs.writeFileSync(opt('--out'), svg); else process.stdout.write(svg);
  }
}
