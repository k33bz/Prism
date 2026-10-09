// awd: spec -> SVG generator for Prism's AWS Architecture gallery (k33bz fork). No deps.
// A diagram spec describes groups, nodes (official icon ids), wires, step badges and a single-clock
// timeline; this emits plain, self-contained SVG (SMIL motion, no runtime JS) styled by
// catalog/drafts/aws.css. See catalog/drafts/AWS_KIT.md for the spec reference.
//
// CLI (a family spec is a .mjs module or a .json file that matches spec.schema.json):
//   node catalog/aws-kit/awd.mjs build <spec> [--out <file>]   -> catalog/drafts/<section.id>.aws.html
//   node catalog/aws-kit/awd.mjs preview <spec> [light] [still]  -> scratch preview HTML + validation report
//     (still: no packets or rings, the complete static diagram, as for print and exports)
//   node catalog/aws-kit/awd.mjs lint <spec> [diagram id] [--info]  -> geometry findings (lint.mjs); build fails on errors
//   node catalog/aws-kit/awd.mjs export-json <spec> [--out <file>|-]  -> catalog/aws-kit/json/<section.id>.json
//   node catalog/aws-kit/awd.mjs svg <spec> <diagram id> [--theme light|dark|auto] [--still] [--out <file>]
//     -> one self-contained .svg (kit CSS, the icons it uses, the spec in <metadata>); stdout without --out
//   node catalog/aws-kit/awd.mjs icons <words...>               -> icon search
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { VERSION, canonical, canonicalDiagram, toJson, validateFamily } from './spec.mjs';
import { wrap } from './place.mjs';
import { lint as lintSvg, report as lintReport } from './lint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ICONS = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'aws-icons', 'aws-icons.json'), 'utf8')).icons;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = (n) => Math.round(n * 100) / 100;
const pct = (n) => String(r2(n)).replace(/^0\./, '.');

// center: the AWS deck centers the header of the frames that carry no icon (AZ, security group,
// generic); a spec can override per group with align:'left'|'center'
const GROUP = {
  cloud:  { cls: 'g-cloud',  icon: ['aws-grp-cloud-logo-dark', 'aws-grp-cloud-logo'], label: 'AWS Cloud' },
  region: { cls: 'g-region', icon: 'aws-grp-region', label: 'Region' },
  az:     { cls: 'g-az',     icon: null, label: 'Availability Zone', center: true },
  vpc:    { cls: 'g-vpc',    icon: 'aws-grp-virtual-private-cloud-vpc', label: 'VPC' },
  pub:    { cls: 'g-pub',    icon: 'aws-grp-public-subnet', label: 'Public subnet' },
  priv:   { cls: 'g-priv',   icon: 'aws-grp-private-subnet', label: 'Private subnet' },
  sg:     { cls: 'g-sg',     icon: null, label: 'Security group', center: true },
  asg:    { cls: 'g-asg',    icon: 'aws-grp-auto-scaling-group', label: 'Auto Scaling group' },
  acct:   { cls: 'g-acct',   icon: 'aws-grp-account', label: 'AWS account' },
  dc:     { cls: 'g-dc',     icon: 'aws-grp-corporate-data-center', label: 'Corporate data center' },
  server: { cls: 'g-dc',     icon: 'aws-grp-server-contents', label: 'Server contents' },
  ec2:    { cls: 'g-ec2',    icon: 'aws-grp-ec2-instance-contents', label: 'EC2 instance contents' },
  spot:   { cls: 'g-ec2',    icon: 'aws-grp-spot-fleet', label: 'Spot Fleet' },
  gen:    { cls: 'g-gen',    icon: null, label: '', center: true },
};

// ---- input checks. Specs may come from importers (draw.io, Mermaid, IaC), so everything that
// lands in markup is checked here: ids are plain tokens, numbers are finite, wire paths use only
// M/H/V/L, enumerations come from a fixed set, and raw `extra` markup cannot run script, load
// anything external or escape the diagram. ----
const ID_RE = /^[A-Za-z0-9_-]+$/;
const D_RE = /^[MHVL\d.,\s-]+$/;
const ANCHORS = new Set(['start', 'middle', 'end']);
const PACKETS = new Set(['pk', 'pk-2', 'pk-bad']);
const NOTE_KINDS = new Set(['caption', 'label', 'warn']);
const EXTRA_BAD = [
  [/<\s*(script|foreignObject|style|iframe|object|embed)\b/i, 'element not allowed'],
  [/\son[a-z]+\s*=/i, 'event handler attribute'],
  [/javascript\s*:/i, 'javascript: URL'],
  [/\bhref\s*=\s*(?:["'](?!#)|(?!["'#]))/i, 'href must be a #fragment'],
  [/url\(\s*(?:["'](?!#)|(?!["'#]))/i, 'url() must be a #fragment'],
];

function fail(where, msg) { throw new Error(`${where}: ${msg}`); }
function okId(v, where) { if (!ID_RE.test(String(v))) fail(where, `id must match [A-Za-z0-9_-]+, got ${JSON.stringify(v)}`); }
function okNum(v, where) { if (typeof v !== 'number' || !Number.isFinite(v)) fail(where, `expected a finite number, got ${JSON.stringify(v)}`); }
function okOptNum(o, keys, where) { for (const k of keys) if (o[k] != null) okNum(o[k], `${where}.${k}`); }
function okWindow(t, where) {
  if (!Array.isArray(t) || t.length !== 2) fail(where, 't must be [a, b]');
  const [a, b] = t; okNum(a, where + '.t[0]'); okNum(b, where + '.t[1]');
  if (!(a > 0 && b < 1 && b > a)) fail(where, `window must satisfy 0 < a < b < 1: ${JSON.stringify(t)}`);
}
function okExtra(x, where) {
  if (typeof x !== 'string') fail(where, 'extra must be a string of SVG markup');
  for (const [re, why] of EXTRA_BAD) { const m = x.match(re); if (m) fail(where, `${why}: ${JSON.stringify(x.slice(Math.max(0, m.index - 20), m.index + 40))}`); }
}

// Check a whole spec before any markup is written; throws with the element at fault.
export function checkSpec(spec) {
  const id = spec.id; if (!/^[a-z][a-z0-9-]*$/.test(String(id))) fail('diagram', 'id must be kebab/alnum: ' + JSON.stringify(id));
  const at = `diagram ${id}`;
  okOptNum(spec, ['w', 'h', 'dur'], at);
  const nodeIds = new Set(), wireIds = new Set(), groupIds = new Set();
  for (const [i, g] of (spec.groups || []).entries()) {
    const w = `${at} group[${i}]`;
    if (!GROUP[g.kind]) fail(w, `unknown group kind ${JSON.stringify(g.kind)} (known: ${Object.keys(GROUP).join(', ')})`);
    for (const k of ['x', 'y', 'w', 'h']) okNum(g[k], `${w}.${k}`);
    if (g.id != null) { okId(g.id, w); groupIds.add(g.id); }
    if (g.align != null && g.align !== 'left' && g.align !== 'center') fail(w, 'align must be left or center');
  }
  for (const n of spec.nodes || []) {
    const w = `${at} node ${n.id}`;
    okId(n.id, `${at} node`); if (nodeIds.has(n.id)) fail(w, 'duplicate node id'); nodeIds.add(n.id);
    okNum(n.x, w + '.x'); okNum(n.y, w + '.y'); okOptNum(n, ['size', 'wrap'], w);
    if (Array.isArray(n.icon)) { for (const ic of n.icon) if (!Object.hasOwn(ICONS, ic)) fail(w, `unknown icon ${JSON.stringify(ic)}`); } else iconUses(n.icon, w);
  }
  for (const wr of spec.wires || []) {
    const w = `${at} wire ${wr.id}`;
    okId(wr.id, `${at} wire`); if (wireIds.has(wr.id)) fail(w, 'duplicate wire id'); wireIds.add(wr.id);
    if (wr.d != null) { if (typeof wr.d !== 'string' || !D_RE.test(wr.d)) fail(w, 'd may use only M, H, V, L and numbers'); }
    else for (const end of ['from', 'to']) if (!nodeIds.has(wr[end])) fail(w, `${end} names unknown node ${JSON.stringify(wr[end])}`);
    okOptNum(wr, ['via', 'labelAt', 'labelDx', 'labelDy'], w);
    if (wr.labelAnchor != null && !ANCHORS.has(wr.labelAnchor)) fail(w, 'labelAnchor must be start, middle or end');
  }
  for (const [i, s] of (spec.steps || []).entries()) {
    const w = `${at} step[${i}]`;
    if (s.at != null) { if (!wireIds.has(s.at)) fail(w, `at names unknown wire ${JSON.stringify(s.at)}`); okOptNum(s, ['f', 'dx', 'dy'], w); }
    else { okNum(s.x, w + '.x'); okNum(s.y, w + '.y'); }
  }
  for (const [i, e] of (spec.timeline || []).entries()) {
    const w = `${at} timeline[${i}]`;
    okWindow(e.t, w); okOptNum(e, ['r'], w);
    if (e.wire != null && !wireIds.has(e.wire)) fail(w, `unknown wire ${JSON.stringify(e.wire)}`);
    if (e.ring != null && !nodeIds.has(e.ring)) fail(w, `unknown ring node ${JSON.stringify(e.ring)}`);
    if (e.wire == null && e.ring == null) fail(w, 'needs a wire, a ring, or both');
    if (e.kind != null && !PACKETS.has(e.kind)) fail(w, `kind must be one of ${[...PACKETS].join(', ')}`);
  }
  for (const [i, e] of (spec.effects || []).entries()) {
    const w = `${at} effects[${i}]`;
    okWindow(e.t, w);
    if (e.appear != null && !nodeIds.has(e.appear)) fail(w, `appear: unknown node ${JSON.stringify(e.appear)}`);
    if (e.fail != null && !groupIds.has(e.fail)) fail(w, `fail: unknown group id ${JSON.stringify(e.fail)}`);
    if (e.fade != null && !wireIds.has(e.fade)) fail(w, `fade: unknown wire ${JSON.stringify(e.fade)}`);
    if (e.glow != null && !wireIds.has(e.glow)) fail(w, `glow: unknown wire ${JSON.stringify(e.glow)}`);
  }
  for (const [i, nt] of (spec.notes || []).entries()) {
    const w = `${at} note[${i}]`;
    okNum(nt.x, w + '.x'); okNum(nt.y, w + '.y');
    if (nt.kind != null && !NOTE_KINDS.has(nt.kind)) fail(w, `kind must be one of ${[...NOTE_KINDS].join(', ')}`);
    if (nt.anchor != null && !ANCHORS.has(nt.anchor)) fail(w, 'anchor must be start, middle or end');
    if (nt.t != null) okWindow(nt.t, w);
  }
  if (spec.extra != null) okExtra(spec.extra, `${at} extra`);
}

// Resolve an icon reference to one or two <use> ids: a base id that has official -dark/-light
// colorways becomes a theme-swapping pair; an explicit id is used as-is.
function iconUses(icon, where = 'icon') {
  if (Array.isArray(icon)) return [{ id: icon[0], cls: 'cw-d' }, { id: icon[1], cls: 'cw-l' }];
  if (Object.hasOwn(ICONS, icon)) return [{ id: icon, cls: '' }];
  if (Object.hasOwn(ICONS, icon + '-dark') && Object.hasOwn(ICONS, icon + '-light')) return [{ id: icon + '-dark', cls: 'cw-d' }, { id: icon + '-light', cls: 'cw-l' }];
  throw new Error(`${where}: unknown icon ${JSON.stringify(icon)} (not in catalog/aws-icons/aws-icons.json; search with: node catalog/aws-kit/awd.mjs icons <words>)`);
}
const use = (icon, x, y, s) => iconUses(icon).map((u) =>
  `<use${u.cls ? ` class="${u.cls}"` : ''} href="#${u.id}" x="${r2(x)}" y="${r2(y)}" width="${s}" height="${s}"/>`).join('');

function nodeBox(n) { const s = n.size || 40; return { x: n.x, y: n.y, s, cx: n.x + s / 2, cy: n.y + s / 2, r: n.x + s, b: n.y + s }; }

// auto-route a wire between two node boxes: straight if aligned, else one elbow
function route(a, b, gap = 4, via) {
  const A = nodeBox(a), B = nodeBox(b);
  const dx = B.cx - A.cx, dy = B.cy - A.cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const x1 = dx > 0 ? A.r + 2 : A.x - 2, x2 = dx > 0 ? B.x - gap : B.r + gap;
    if (Math.abs(dy) < 1) return `M${r2(x1)},${r2(A.cy)} H${r2(x2)}`;
    const mx = via != null ? via : r2((x1 + x2) / 2);
    return `M${r2(x1)},${r2(A.cy)} H${r2(mx)} V${r2(B.cy)} H${r2(x2)}`;
  }
  const y1 = dy > 0 ? A.b + 2 : A.y - 2, y2 = dy > 0 ? B.y - gap - 14 * 0 : B.b + gap;
  // vertical wires land on the icon top/bottom; leave room for the label under the source icon
  const y1l = dy > 0 ? A.b + 2 + (a.label ? 13 * wrap(a.label, a.wrap).length : 0) : y1;
  if (Math.abs(dx) < 1) return `M${r2(A.cx)},${r2(y1l)} V${r2(y2)}`;
  const my = via != null ? via : r2((y1l + y2) / 2);
  return `M${r2(A.cx)},${r2(y1l)} V${r2(my)} H${r2(B.cx)} V${r2(y2)}`;
}

// vertices of a polyline path made of M/H/V/L segments
function pathPoints(d) {
  const pts = []; let x = 0, y = 0;
  for (const [, c, v] of d.matchAll(/([MHVL])\s*([-\d.]+(?:[ ,][-\d.]+)?)/g)) {
    const nums = v.split(/[ ,]/).map(Number);
    if (c === 'M' || c === 'L') { x = nums[0]; y = nums[1]; } else if (c === 'H') x = nums[0]; else if (c === 'V') y = nums[0];
    pts.push([x, y]);
  }
  return pts;
}

// does any segment of path d touch box {x, y, r, b}? (exact for H/V runs, a bounding-box test for L)
function crosses(d, box) {
  const p = pathPoints(d);
  for (let i = 1; i < p.length; i++) {
    const [x1, y1] = p[i - 1], [x2, y2] = p[i];
    if (Math.max(x1, x2) >= box.x && Math.min(x1, x2) <= box.r && Math.max(y1, y2) >= box.y && Math.min(y1, y2) <= box.b) return true;
  }
  return false;
}

// rough rendered width of a line of Arial at px size (average advance about 0.56 em)
const textW = (s, px) => String(s).length * px * 0.56;

// point at fraction f along a polyline path made of M/H/V segments (for badges/labels)
function pointAt(d, f = 0.5) {
  const pts = pathPoints(d);
  if (pts.length < 2) return pts[0] || [0, 0];
  const seg = []; let tot = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); tot += l; }
  let want = tot * f;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? Math.min(1, want / seg[i]) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
    want -= seg[i];
  }
  return pts[pts.length - 1];
}

const win = (dur, a, b, inner) => inner; // (kept for readability of call sites)

export function diagram(spec) {
  checkSpec(spec);
  const id = spec.id;
  const W = spec.w || 480, H = spec.h || 240, dur = spec.dur || 6;
  const D = `${dur}s`;
  // null-prototype lookups: an id such as "constructor" must not resolve to an inherited member
  const nodes = Object.assign(Object.create(null), Object.fromEntries((spec.nodes || []).map((n) => [n.id, n])));
  const parts = [];

  // Arrowheads: the open chevron of the AWS deck ("open arrow"), stroked like the wire. The wire head
  // scales with the wire's stroke (7 x 1.3 = 9.1 units); the glow overlay gets its own head in user
  // space so its thicker stroke does not inflate it. Overlay paint goes in inline style: a class rule
  // (.awd .w) would outrank presentation attributes.
  const fx = spec.effects || [];
  const head = (mid, paint, size, sw, user) => `<marker id="${id}-${mid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${size}" markerHeight="${size}"${user ? ' markerUnits="userSpaceOnUse"' : ''} orient="auto-start-reverse"><path ${paint} d="M1.5,1.5 L9,5 L1.5,8.5" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></marker>`;
  parts.push(`<defs>${head('ah', 'class="ah"', 7, 1.4)}${(spec.wires || []).some((w) => w.hot) ? head('ahh', 'style="fill:none;stroke:#DD344C"', 7, 1.4) : ''}${fx.some((e) => e.glow) ? head('ahg', 'style="fill:none;stroke:var(--awd-pk)"', 9.1, 2.4, true) : ''}</defs>`);
  // fade dims the wire itself (head included) during its window
  const fading = new Map(fx.filter((e) => e.fade).map((e) => [e.fade, e.t]));

  // wire paths first: a centered group header must not sit on a wire
  const paths = Object.create(null);
  for (const w of spec.wires || []) paths[w.id] = w.d || route(nodes[w.from], nodes[w.to], 4, w.via);
  // Icon-less frames (AZ, security group, generic) center their header. A kind falls back to the
  // left for the whole diagram when any of its centered headers would sit on a wire or its group's
  // note, so sibling frames stay alike. An explicit align always wins.
  const groupIcon = (g) => (typeof g.icon === 'string' ? g.icon : (g.icon !== false ? GROUP[g.kind].icon : null));
  const groupLabel = (g) => (g.label != null ? g.label : GROUP[g.kind].label);
  const leftKinds = new Set();
  for (const g of spec.groups || []) {
    if (g.align || !GROUP[g.kind].center || groupIcon(g) || !groupLabel(g)) continue;
    const cx = g.x + g.w / 2, half = textW(groupLabel(g), 10) / 2 + 6;
    const band = { x: cx - half, r: cx + half, y: g.y + 2, b: g.y + 18 };
    const noteLeft = g.note ? g.x + g.w - 6 - textW(g.note, 9) - 6 : Infinity;
    if (band.x < g.x + 4 || band.r > noteLeft || Object.values(paths).some((d) => crosses(d, band))) leftKinds.add(g.kind);
  }

  // groups (draw order = array order; put outer groups first)
  for (const g of spec.groups || []) {
    const G = GROUP[g.kind];
    const label = groupLabel(g);
    parts.push(`<rect class="g ${G.cls}"${g.id ? ` id="${id}-${g.id}"` : ''} x="${r2(g.x)}" y="${r2(g.y)}" width="${r2(g.w)}" height="${r2(g.h)}"/>`);
    let tx = g.x + 6;
    // corner icon: the kind's official group icon, a service icon id (e.g. a gen frame for an ECS
    // service), or none with icon:false
    const gi = groupIcon(g);
    if (gi) { parts.push(use(gi, g.x, g.y, 20)); tx = g.x + 25; }
    const center = g.align ? g.align === 'center' : (G.center && !gi && !leftKinds.has(g.kind));
    if (label) parts.push(`<text class="t-g${center ? ' t-gc' : ''}" x="${r2(center ? g.x + g.w / 2 : tx)}" y="${r2(g.y + 14)}">${esc(label)}</text>`);
    // note: right-aligned on the top edge (a CIDR, a route summary, an account id)
    if (g.note) parts.push(`<text class="t-sub" x="${r2(g.x + g.w - 6)}" y="${r2(g.y + 14)}" style="text-anchor:end">${esc(g.note)}</text>`);
  }

  // wires
  const wires = Object.create(null), wireDefs = Object.create(null);
  for (const w of spec.wires || []) {
    const d = paths[w.id];
    wires[w.id] = d; wireDefs[w.id] = w;
    const cls = ['w', w.dashed ? 'w-d' : '', w.flow ? 'w-flow' : '', w.hot ? 'w-hot' : ''].filter(Boolean).join(' ');
    const ah = w.hot ? 'ahh' : 'ah';   // a red (hot) wire gets a red head
    const mk = w.arrow === false ? '' : `${w.both ? ` marker-start="url(#${id}-${ah})"` : ''} marker-end="url(#${id}-${ah})"`;
    // semantic ends: the nodes a wire joins, when the spec names them
    const ends = (w.from != null && nodes[w.from] ? ` data-from="${esc(w.from)}"` : '') + (w.to != null && nodes[w.to] ? ` data-to="${esc(w.to)}"` : '');
    if (fading.has(w.id)) {
      // a drained wire: the live copy dims during the window; the still copy serves reduced motion
      const [a, b] = fading.get(w.id);
      parts.push(`<g class="awd-static"><path class="${cls}"${ends} d="${d}"${mk}/></g>`);
      parts.push(`<path id="${id}-${w.id}" class="${cls} anim"${ends} d="${d}"${mk}><animate attributeName="opacity" dur="${D}" repeatCount="indefinite" calcMode="discrete" values="1;.16;1" keyTimes="0;${pct(a)};${pct(b)}"/></path>`);
    } else parts.push(`<path id="${id}-${w.id}" class="${cls}"${ends} d="${d}"${mk}/>`);
    if (w.label) {
      // labelDx/labelDy nudge the label off the path point (default 5 above); labelAnchor start|end
      // puts it beside a vertical run
      const [x, y] = pointAt(d, w.labelAt != null ? w.labelAt : 0.5);
      const lx = x + (w.labelDx || 0), ly = y + (w.labelDy != null ? w.labelDy : -5);
      parts.push(`<text class="t-wire" x="${r2(lx)}" y="${r2(ly)}"${w.labelAnchor ? ` style="text-anchor:${w.labelAnchor}"` : ''}>${esc(w.label)}</text>`);
    }
  }

  // nodes + labels. A node targeted by an `appear` effect is drawn twice: animated (shown only
  // during its window) and static (.awd-static: hidden normally, shown under reduced motion so
  // the still diagram stays complete).
  const appearing = new Set((spec.effects || []).filter((e) => e.appear).map((e) => e.appear));
  const nodeMarkup = (n) => {
    const B = nodeBox(n), out = [use(n.icon, n.x, n.y, B.s)];
    if (n.label) {
      const lines = wrap(n.label, n.wrap);
      out.push(`<text class="t-c" x="${r2(B.cx)}" y="${B.b + 12}">${lines.map((l, i) => `<tspan x="${r2(B.cx)}"${i ? ' dy="11"' : ''}>${esc(l)}</tspan>`).join('')}</text>`);
    }
    if (n.sub) out.push(`<text class="t-c t-sub" x="${r2(B.cx)}" y="${B.b + 12 + 11 * wrap(n.label || '', n.wrap).length}">${esc(n.sub)}</text>`);
    // semantic wrapper (no id: an appearing node is drawn more than once): tools find a node by
    // data-node, and the title names it on hover
    const title = n.label || ICONS[iconUses(n.icon)[0].id].name;
    return `<g class="awd-n" data-node="${esc(n.id)}" data-icon="${esc([].concat(n.icon).join(' '))}"><title>${esc(title)}</title>${out.join('')}</g>`;
  };
  // appear + ghost: a dim copy marks the empty slot (wires still attached) outside the window
  const ghosts = new Set(fx.filter((e) => e.appear && e.ghost).map((e) => e.appear));
  for (const n of spec.nodes || []) {
    if (!appearing.has(n.id)) { parts.push(nodeMarkup(n)); continue; }
    if (ghosts.has(n.id)) parts.push(`<g class="awd-ghost" opacity=".3">${nodeMarkup(n)}</g>`);
    parts.push(`<g class="awd-static">${nodeMarkup(n)}</g>`);
  }

  // step badges (at a wire's point, nudged off the line)
  for (const s of spec.steps || []) {
    let x, y;
    if (s.at != null) { [x, y] = pointAt(wires[s.at], s.f != null ? s.f : 0.5); x += s.dx != null ? s.dx : 0; y += s.dy != null ? s.dy : -11; }
    else { x = s.x; y = s.y; }
    parts.push(`<g class="st" transform="translate(${r2(x)},${r2(y)})"><circle r="7.5"/><text y="3.2">${esc(s.n)}</text></g>`);
  }

  // timeline: packets along wires, rings on arrival, and window effects (appear / fail / fade / glow)
  for (const e of spec.timeline || []) {
    const [a, b] = e.t; if (!(a > 0 && b < 1 && b > a)) throw new Error(`timeline window must satisfy 0 < a < b < 1: ${JSON.stringify(e)}`);
    if (e.wire) {
      if (!wires[e.wire]) throw new Error('timeline: unknown wire ' + e.wire);
      const kp = e.reverse ? '1;1;0;0' : '0;0;1;1';
      parts.push(`<circle class="${e.kind || 'pk'}" r="${e.r || 3.4}" opacity="0"><animateMotion dur="${D}" repeatCount="indefinite" calcMode="linear" keyPoints="${kp}" keyTimes="0;${pct(a)};${pct(b)};1"><mpath href="#${id}-${e.wire}"/></animateMotion><animate attributeName="opacity" dur="${D}" repeatCount="indefinite" calcMode="discrete" values="0;1;0" keyTimes="0;${pct(a)};${pct(b)}"/></circle>`);
    }
    if (e.ring) {
      const n = nodes[e.ring]; if (!n) throw new Error('timeline: unknown ring node ' + e.ring);
      const B = nodeBox(n), r0 = B.s * 0.55, t = b, t2 = Math.min(0.995, t + 0.12);
      parts.push(`<circle class="${e.kind === 'pk-2' ? 'ring-2' : 'ring'}" cx="${r2(B.cx)}" cy="${r2(B.cy)}" r="${r2(r0)}" opacity="0"><animate attributeName="opacity" dur="${D}" repeatCount="indefinite" values="0;0;.9;0;0" keyTimes="0;${pct(t - 0.001)};${pct(t)};${pct(t2)};1"/><animate attributeName="r" dur="${D}" repeatCount="indefinite" values="${r2(r0)};${r2(r0)};${r2(r0)};${r2(r0 * 1.45)};${r2(r0 * 1.45)}" keyTimes="0;${pct(t - 0.001)};${pct(t)};${pct(t2)};1"/></circle>`);
    }
  }
  // appear: nodes hidden outside [a,b] (scale-out / scale-in); fail: group turns red + X; fade/glow: wire emphasis
  const winAttr = (attr, vals, a, b) => `<animate attributeName="${attr}" dur="${D}" repeatCount="indefinite" calcMode="discrete" values="${vals}" keyTimes="0;${pct(a)};${pct(b)}"/>`;
  for (const e of spec.effects || []) {
    const [a, b] = e.t;
    if (e.appear) {
      const n = nodes[e.appear]; if (!n) throw new Error('effects.appear: unknown node ' + e.appear);
      parts.push(`<g class="anim" opacity="0">${nodeMarkup(n)}${winAttr('opacity', '0;1;0', a, b)}</g>`);
    } else if (e.fail) {
      const g = (spec.groups || []).find((x) => x.id === e.fail); if (!g) throw new Error('effects.fail: unknown group id ' + e.fail);
      const cx = g.x + g.w - 12, cy = g.y + 12;
      parts.push(`<rect class="g g-hot anim" x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" opacity="0">${winAttr('opacity', '0;1;0', a, b)}</rect>`);
      parts.push(`<g class="anim" opacity="0"><circle cx="${cx}" cy="${cy}" r="8" fill="#DD344C"/><path d="M${cx - 3.5},${cy - 3.5} L${cx + 3.5},${cy + 3.5} M${cx + 3.5},${cy - 3.5} L${cx - 3.5},${cy + 3.5}" stroke="#fff" stroke-width="1.8"/>${winAttr('opacity', '0;1;0', a, b)}</g>`);
    } else if (e.fade) {
      if (!wires[e.fade]) throw new Error('effects.fade: unknown wire ' + e.fade);   // drawn with the wire above
    } else if (e.glow) {
      // a request-colored overlay (and head) lights the rerouted wire
      const w = wireDefs[e.glow]; if (!w) throw new Error('effects.glow: unknown wire ' + e.glow);
      const ends = w.arrow === false ? '' : `${w.both ? ` marker-start="url(#${id}-ahg)"` : ''} marker-end="url(#${id}-ahg)"`;
      parts.push(`<path class="anim" d="${wires[e.glow]}" style="fill:none;stroke:var(--awd-pk);stroke-width:2.2;filter:drop-shadow(0 0 3px var(--awd-pk))"${ends} opacity="0">${winAttr('opacity', '0;1;0', a, b)}</path>`);
    }
  }

  // notes: free captions drawn on top. kind caption (muted, default) | label (ink) | warn (red);
  // anchor start|middle|end; t:[a,b] shows the note only during that window (hidden under reduced
  // motion, like every other window effect)
  for (const nt of spec.notes || []) {
    const cls = nt.kind === 'label' ? 't-c' : 't-wire';
    const style = [nt.anchor ? `text-anchor:${nt.anchor}` : '', nt.kind === 'warn' ? 'fill:#DD344C;font-weight:700' : ''].filter(Boolean).join(';');
    const lines = String(nt.text).split('\n');
    const txt = `<text class="${cls}" x="${r2(nt.x)}" y="${r2(nt.y)}"${style ? ` style="${style}"` : ''}>${lines.map((l, i) => `<tspan x="${r2(nt.x)}"${i ? ' dy="10"' : ''}>${esc(l)}</tspan>`).join('')}</text>`;
    if (nt.t) {
      const [a, b] = nt.t; if (!(a > 0 && b < 1 && b > a)) throw new Error(`notes window must satisfy 0 < a < b < 1: ${JSON.stringify(nt)}`);
      parts.push(`<g class="anim" opacity="0">${txt}${winAttr('opacity', '0;1;0', a, b)}</g>`);
    } else parts.push(txt);
  }

  if (spec.extra) parts.push(spec.extra);
  const aria = esc(spec.aria || spec.name || id);
  const named = `<title>${esc(spec.name || id)}</title>${spec.desc ? `<desc>${esc(spec.desc)}</desc>` : ''}`;
  return `<svg class="awd" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">${named}${parts.join('')}</svg>`;
}

export function tile(spec) {
  const svg = diagram(spec);
  const ref = `.awd #${spec.id}`;
  return `  <div class="tile is-new${spec.full ? ' full' : spec.wide ? ' wide' : ''}" data-fx-id="aws-${spec.id}" data-ctype="${esc(spec.ctype || 'diagram-arch')}" data-interact="auto-play" data-c="accent"><div class="stage">
    ${svg}
  </div><div class="meta"><div class="nm">${esc(spec.name)}</div><span class="ref">${esc(spec.ref || 'svg.awd')}</span><div class="desc">${esc(spec.desc || '')}</div><button class="copy" onclick="copyViz(this)">Copy</button></div></div>`;
}

export function section(mod) {
  const s = mod.section;
  // section.id names the output file: a kebab token, never a path
  if (!/^[a-z][a-z0-9-]*$/.test(String(s.id))) fail('section', 'id must be kebab/alnum: ' + JSON.stringify(s.id));
  return `<h3 class="sec">${esc(s.title)}</h3>\n<div class="gallery">\n\n${mod.diagrams.map(tile).join('\n\n')}\n\n</div>`;
}

// ---- validation: icon ids resolve, ids unique, one clock per diagram, windows sane ----
export function validate(html) {
  const errs = [];
  for (const [, id] of html.matchAll(/href="#(aws-[^"]+)"/g)) if (!ICONS[id]) errs.push('unresolved icon ' + id);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i); if (dup.length) errs.push('duplicate ids: ' + [...new Set(dup)].join(', '));
  for (const [svg] of html.matchAll(/<svg class="awd"[\s\S]*?<\/svg>/g)) {
    const durs = new Set([...svg.matchAll(/dur="([^"]+)"/g)].map((m) => m[1]));
    if (durs.size > 1) errs.push('mixed clocks in one diagram: ' + [...durs].join(','));
  }
  return errs;
}

// ---- lint: layout rules checked on the drawn markup (see lint.mjs) ----
export function lint(spec) { return lintSvg(spec, diagram(spec)); }

// ---- standalone SVG: one self-contained document per diagram, for .svg files, <img src>, slides and
// READMEs. The kit CSS (diagram rules only, not the gallery chrome) is inlined, the <symbol>s the
// diagram uses go in <defs>, and the spec rides along in <metadata id="awd-spec"> as JSON. theme
// light|dark fixes data-mode; auto follows prefers-color-scheme. still shows the static diagram. ----
// keep top-level rules that style .awd (and the @media/@keyframes that hold them); drop comments
function kitCss(css) {
  const out = [];
  let i = 0;
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  while (i < css.length) {
    const open = css.indexOf('{', i); if (open < 0) break;
    let depth = 1, j = open + 1;
    for (; j < css.length && depth; j++) depth += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0;
    const sel = css.slice(i, open).trim(), body = css.slice(open + 1, j - 1);
    const decl = body.trim().replace(/\s*\n\s*/g, '');
    if (sel.startsWith('@keyframes')) out.push(`${sel}{${decl}}`);
    else if (sel.startsWith('@media')) { const inner = kitCss(body); if (inner) out.push(`${sel}{${inner}}`); }
    else if (/\.awd(?![\w-])/.test(sel)) out.push(`${sel.replace(/\s*\n\s*/g, '')}{${decl}}`);
    i = j;
  }
  return out.join('\n');
}
let KIT_CSS;
export function standalone(spec, { theme = 'auto', still = false } = {}) {
  if (!['auto', 'light', 'dark'].includes(theme)) fail('standalone', `theme must be auto, light or dark, got ${JSON.stringify(theme)}`);
  const svg = diagram(spec);
  const W = spec.w || 480, H = spec.h || 240;
  if (KIT_CSS == null) KIT_CSS = kitCss(fs.readFileSync(path.join(ROOT, 'catalog', 'drafts', 'aws.css'), 'utf8'));
  // the root is the .awd element here: natural size from the viewBox (the page rule is width:100%),
  // and a color-scheme so a viewer paints a matching canvas behind a fixed theme
  const css = `${KIT_CSS}\n.awd:root{width:${W}px;height:${H}px;color-scheme:${theme === 'auto' ? 'light dark' : theme}}`;
  const used = [...new Set([...svg.matchAll(/href="#(aws-[^"]+)"/g)].map((m) => m[1]))].filter((x) => Object.hasOwn(ICONS, x));
  const symbols = used.map((x) => `<symbol id="${x}" viewBox="${ICONS[x].viewBox}">${ICONS[x].svg}</symbol>`).join('');
  // "]]>" can only occur inside a JSON string, where escaping the ">" leaves the same text
  const json = JSON.stringify(canonicalDiagram(spec)).replace(/]]>/g, ']]\\u003e');
  const m = svg.match(/^<svg class="awd" viewBox="([^"]+)"([^>]*)>(<title>[^<]*<\/title>(?:<desc>[^<]*<\/desc>)?)/);
  const root = `<svg xmlns="http://www.w3.org/2000/svg" class="awd" viewBox="${m[1]}" width="${W}" height="${H}"${m[2]}${theme !== 'auto' ? ` data-mode="${theme}"` : ''}${still ? ' data-still=""' : ''}>`;
  return root + m[3] + `<metadata id="awd-spec" data-version="${VERSION}"><![CDATA[${json}]]></metadata>` +
    `<style><![CDATA[\n${css}\n]]></style><defs>${symbols}</defs>` + svg.slice(m[0].length) + '\n';
}

// a family spec: an .mjs module (default export) or a .json file checked against spec.schema.json
async function loadSpec(p) {
  if (!/\.json$/i.test(p)) return (await import(pathToFileURL(path.resolve(p)).href)).default;
  const fam = JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'));
  const errs = validateFamily(fam);
  if (errs.length) throw new Error(`${p} does not match spec.schema.json:\n  ${errs.map((e) => `${e.path}: ${e.message}`).join('\n  ')}`);
  return fam;
}

// preview page: tokens + kit css + sprite + section, optional light mode and still frame
function previewHtml(sectionHtml, mode, still) {
  const css = fs.readFileSync(path.join(ROOT, 'catalog', 'drafts', 'aws.css'), 'utf8');
  const sprite = fs.readFileSync(path.join(ROOT, 'catalog', 'aws-icons', 'aws-icons.svg'), 'utf8')
    .replace('<svg xmlns="http://www.w3.org/2000/svg" style="display:none">', '<svg id="awd-sprite" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">');
  const dark = ':root{--bg:#0b0e17;--panel:#121623;--panel2:#171d2e;--line:#243049;--ink:#eaf1f9;--muted:#8593a8;--dim:#5b6678;--accent:#ff9900;--accent-rgb:255,153,0;--info:#4493f8;--info-rgb:68,147,248}';
  const light = ':root{--bg:#f4f6f9;--panel:#ffffff;--panel2:#eef1f6;--line:#d5dbe5;--ink:#16191f;--muted:#5f6b7a;--dim:#8a94a3;--accent:#ec7211;--accent-rgb:236,114,17;--info:#0972d3;--info-rgb:9,114,211}';
  return `<!doctype html><html${mode === 'light' ? ' data-mode="light"' : ' data-mode="dark"'}${still ? ' data-still' : ''}><head><meta charset="utf-8"><title>awd preview</title><style>${mode === 'light' ? light : dark}
*{box-sizing:border-box}body{margin:0;padding:20px;background:var(--bg);color:var(--ink);font:14px system-ui}
h3.sec{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--dim);border-bottom:1px solid var(--line);padding-bottom:8px}
.gallery{display:grid;gap:18px}.tile{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.tile .stage{display:flex;align-items:center;justify-content:center}.tile .meta{padding:10px 14px;border-top:1px solid var(--line)}
.tile .nm{font-weight:700}.tile .ref{font:11px ui-monospace,monospace;color:var(--accent)}.tile .desc{color:var(--muted);font-size:12px}.tile .copy{display:none}
${css}</style></head><body>${sprite}${sectionHtml}</body></html>`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && ['export-json', 'svg'].includes(process.argv[2])) {
  const [cmd, specPath, ...rest] = process.argv.slice(2);
  const opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
  const write = (out, text, what) => {
    if (out === '-' || (out == null && cmd === 'svg')) { process.stdout.write(text); return; }
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(path.resolve(out), text);
    console.error(`wrote ${path.relative(process.cwd(), path.resolve(out))}: ${what}, ${text.length} bytes`);
  };
  if (!specPath) { console.error('usage: awd.mjs export-json <spec> [--out <file>|-] | svg <spec> <diagram id> [--theme light|dark|auto] [--still] [--out <file>]'); process.exit(1); }
  const mod = await loadSpec(specPath);
  if (cmd === 'export-json') {
    // canonical JSON: known keys in schema order; keys the generator does not read are dropped
    const { family, dropped } = canonical(mod);
    const errs = validateFamily(family);
    if (errs.length) { console.error('SCHEMA:\n  ' + errs.map((e) => `${e.path}: ${e.message}`).join('\n  ')); process.exit(1); }
    if (dropped.size) console.error('dropped (not read by the generator): ' + [...dropped].map(([k, n]) => `${k} x${n}`).join(', '));
    write(opt('--out') || path.join(HERE, 'json', `${family.section.id}.json`), toJson(family) + '\n', `${family.diagrams.length} diagram(s)`);
  } else {
    // a gallery id (aws-sl-api) or a spec id (sl-api)
    const want = rest[0] && !rest[0].startsWith('--') ? rest[0] : null;
    const d = mod.diagrams.find((x) => x.id === want) || mod.diagrams.find((x) => 'aws-' + x.id === want);
    if (!d) { console.error(`no diagram ${JSON.stringify(want)} in ${specPath} (has: ${mod.diagrams.map((x) => x.id).join(', ')})`); process.exit(1); }
    const theme = opt('--theme') || 'auto';
    write(opt('--out'), standalone(d, { theme, still: rest.includes('--still') }), `${d.id}, theme ${theme}`);
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === 'icons') {
  // icon search: node catalog/aws-kit/awd.mjs icons <words...> [--from drawio|mermaid|plantuml|diagrams|cfn|tf] [--prop K=V]
  // ranked by the shared resolver (catalog/aws-icons/resolve.mjs): aliases, crosswalks, word starts
  const { resolveIcon, searchIcons } = await import('../aws-icons/resolve.mjs');
  const args = process.argv.slice(3), opts = { props: {} }, words = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from') opts.from = args[++i];
    else if (args[i] === '--prop') { const [k, ...v] = String(args[++i]).split('='); opts.props[k] = v.join('='); }
    else words.push(args[i]);
  }
  const q = words.join(' ');
  const best = resolveIcon(q, opts);
  if (best.id) console.log(`best: ${best.id} (${best.kind}${best.group ? ', group ' + best.group : ''}, confidence ${best.confidence}, ${best.how})`);
  for (const w of best.warnings || []) console.log(`  warning: ${w}`);
  const rows = searchIcons(q);
  for (const r of rows.slice(0, 40)) {
    const e = r.entry;
    console.log(`${r.id.padEnd(58)} ${e.kind.padEnd(9)} ${e.short || e.name}${e.service ? '  [' + e.service + ']' : ''}${e.status ? '  (' + e.status + ')' : ''}`);
  }
  console.log(`${rows.length} match(es)${rows.length > 40 ? ' (first 40 shown)' : ''}. Colorway pairs: use the base id without -dark/-light and the generator swaps per theme.`);
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, specPath, ...flags] = process.argv.slice(2);
  const mode = flags.includes('light') ? 'light' : 'dark', still = flags.includes('still');
  const mod = await loadSpec(specPath);
  const html = section(mod);
  const errs = validate(html);
  const findings = mod.diagrams.map((d) => [d.id, lint(d)]);
  const lintErrs = findings.flatMap(([id, f]) => f.filter((x) => x.severity === 'error').map((x) => `${id}: ${x.code} ${x.message}`));
  const count = (s) => findings.reduce((k, [, f]) => k + f.filter((x) => x.severity === s).length, 0);
  if (cmd === 'lint') {
    const only = flags.find((f) => !f.startsWith('--'));
    for (const [id, f] of findings) if (!only || id === only) console.log(lintReport(id, flags.includes('--info') ? f : f.filter((x) => x.severity !== 'info')));
    process.exit(lintErrs.length ? 1 : 0);
  }
  if (cmd === 'build') {
    const outAt = flags.indexOf('--out');
    const out = outAt >= 0 && flags[outAt + 1] ? path.resolve(flags[outAt + 1]) : path.join(ROOT, 'catalog', 'drafts', `${mod.section.id}.aws.html`);
    if (errs.length) { console.error('VALIDATION FAILED:\n  ' + errs.join('\n  ')); process.exit(1); }
    if (lintErrs.length) { console.error('LINT FAILED (fix the layout, or accept a finding with lintAllow):\n  ' + lintErrs.join('\n  ')); process.exit(1); }
    fs.writeFileSync(out, html + '\n');
    console.log(`built ${path.relative(ROOT, out)}: ${mod.diagrams.length} diagram(s), ${html.length} bytes`);
  } else if (cmd === 'preview') {
    const out = path.join(path.dirname(path.resolve(specPath)), `${mod.section.id}.preview${mode === 'light' ? '-light' : ''}${still ? '-still' : ''}.html`);
    fs.writeFileSync(out, previewHtml(html, mode, still));
    console.log(`preview ${out}`);
    console.log(errs.length ? 'VALIDATION:\n  ' + errs.join('\n  ') : 'validation: OK');
    console.log(`lint: ${count('error')} error, ${count('warn')} warn, ${count('info')} info (details: awd.mjs lint <spec>)`);
  } else { console.error('usage: awd.mjs build <spec> [--out <file>] | preview <spec> [light] [still] | lint <spec> [diagram id] [--info] | export-json <spec> | svg <spec> <diagram id> | icons <words>'); process.exit(1); }
}
