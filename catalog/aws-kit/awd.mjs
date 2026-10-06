// awd: spec -> SVG generator for Prism's AWS Architecture gallery (k33bz fork). No deps.
// A diagram spec describes groups, nodes (official icon ids), wires, step badges and a single-clock
// timeline; this emits plain, self-contained SVG (SMIL motion, no runtime JS) styled by
// catalog/drafts/aws.css. See catalog/drafts/AWS_KIT.md for the spec reference.
//
// CLI:
//   node catalog/aws-kit/awd.mjs build <spec.mjs>            -> catalog/drafts/<section.id>.aws.html
//   node catalog/aws-kit/awd.mjs preview <spec.mjs> [light]  -> scratch preview HTML + validation report
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ICONS = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'aws-icons', 'aws-icons.json'), 'utf8')).icons;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = (n) => Math.round(n * 100) / 100;
const pct = (n) => String(r2(n)).replace(/^0\./, '.');

const GROUP = {
  cloud:  { cls: 'g-cloud',  icon: ['aws-grp-cloud-logo-dark', 'aws-grp-cloud-logo'], label: 'AWS Cloud' },
  region: { cls: 'g-region', icon: 'aws-grp-region', label: 'Region' },
  az:     { cls: 'g-az',     icon: null, label: 'Availability Zone' },
  vpc:    { cls: 'g-vpc',    icon: 'aws-grp-virtual-private-cloud-vpc', label: 'VPC' },
  pub:    { cls: 'g-pub',    icon: 'aws-grp-public-subnet', label: 'Public subnet' },
  priv:   { cls: 'g-priv',   icon: 'aws-grp-private-subnet', label: 'Private subnet' },
  sg:     { cls: 'g-sg',     icon: null, label: 'Security group' },
  asg:    { cls: 'g-asg',    icon: 'aws-grp-auto-scaling-group', label: 'Auto Scaling group' },
  acct:   { cls: 'g-acct',   icon: 'aws-grp-account', label: 'AWS account' },
  dc:     { cls: 'g-dc',     icon: 'aws-grp-corporate-data-center', label: 'Corporate data center' },
  server: { cls: 'g-dc',     icon: 'aws-grp-server-contents', label: 'Server contents' },
  ec2:    { cls: 'g-asg',    icon: 'aws-grp-ec2-instance-contents', label: 'EC2 instance contents' },
  spot:   { cls: 'g-asg',    icon: 'aws-grp-spot-fleet', label: 'Spot Fleet' },
  gen:    { cls: 'g-gen',    icon: null, label: '' },
};

// Resolve an icon reference to one or two <use> ids: a base id that has official -dark/-light
// colorways becomes a theme-swapping pair; an explicit id is used as-is.
function iconUses(icon) {
  if (Array.isArray(icon)) return [{ id: icon[0], cls: 'cw-d' }, { id: icon[1], cls: 'cw-l' }];
  if (ICONS[icon]) return [{ id: icon, cls: '' }];
  if (ICONS[icon + '-dark'] && ICONS[icon + '-light']) return [{ id: icon + '-dark', cls: 'cw-d' }, { id: icon + '-light', cls: 'cw-l' }];
  throw new Error(`unknown icon "${icon}" (not in catalog/aws-icons/aws-icons.json)`);
}
const use = (icon, x, y, s) => iconUses(icon).map((u) =>
  `<use${u.cls ? ` class="${u.cls}"` : ''} href="#${u.id}" x="${r2(x)}" y="${r2(y)}" width="${s}" height="${s}"/>`).join('');

// word-wrap a label into <= maxCh-char lines, centered tspans
function wrap(label, maxCh = 14) {
  const out = []; let line = '';
  for (const w of String(label).split(/\s+/)) {
    if (line && (line + ' ' + w).length > maxCh) { out.push(line); line = w; } else line = line ? line + ' ' + w : w;
  }
  if (line) out.push(line);
  return out;
}

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

// point at fraction f along a polyline path made of M/H/V segments (for badges/labels)
function pointAt(d, f = 0.5) {
  const pts = []; let x = 0, y = 0;
  for (const [, c, v] of d.matchAll(/([MHVL])\s*([-\d.]+(?:[ ,][-\d.]+)?)/g)) {
    const nums = v.split(/[ ,]/).map(Number);
    if (c === 'M' || c === 'L') { x = nums[0]; y = nums[1]; } else if (c === 'H') x = nums[0]; else if (c === 'V') y = nums[0];
    pts.push([x, y]);
  }
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
  const id = spec.id; if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('diagram id must be kebab/alnum: ' + id);
  const W = spec.w || 480, H = spec.h || 240, dur = spec.dur || 6;
  const D = `${dur}s`;
  const nodes = Object.fromEntries((spec.nodes || []).map((n) => [n.id, n]));
  const parts = [];

  // Arrowheads. The wire head scales with the wire's stroke (7 x 1.3 = 9.1 units); the glow overlay
  // gets its own head in user space so its thicker stroke does not inflate it. Overlay paint goes in
  // inline style: a class rule (.awd .w) would outrank presentation attributes.
  const fx = spec.effects || [];
  const head = (mid, paint, size, user) => `<marker id="${id}-${mid}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="${size}" markerHeight="${size}"${user ? ' markerUnits="userSpaceOnUse"' : ''} orient="auto-start-reverse"><path ${paint} d="M0,0 L8,4 L0,8 Z"/></marker>`;
  parts.push(`<defs>${head('ah', 'class="ah"', 7)}${(spec.wires || []).some((w) => w.hot) ? head('ahh', 'style="fill:#DD344C"', 7) : ''}${fx.some((e) => e.glow) ? head('ahg', 'style="fill:var(--awd-pk)"', 9.1, true) : ''}</defs>`);
  // fade dims the wire itself (head included) during its window
  const fading = new Map(fx.filter((e) => e.fade).map((e) => [e.fade, e.t]));

  // groups (draw order = array order; put outer groups first)
  for (const g of spec.groups || []) {
    const G = GROUP[g.kind]; if (!G) throw new Error('unknown group kind ' + g.kind);
    const label = g.label != null ? g.label : G.label;
    parts.push(`<rect class="g ${G.cls}"${g.id ? ` id="${id}-${g.id}"` : ''} x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}"/>`);
    let tx = g.x + 6;
    if (G.icon && g.icon !== false) { parts.push(use(G.icon, g.x, g.y, 20)); tx = g.x + 25; }
    if (label) parts.push(`<text class="t-g gt-${G.cls.slice(2)}" x="${tx}" y="${g.y + 14}">${esc(label)}</text>`);
  }

  // wires
  const wires = {}, wireDefs = {};
  for (const w of spec.wires || []) {
    const d = w.d || route(nodes[w.from], nodes[w.to], 4, w.via);
    if (!w.d && (!nodes[w.from] || !nodes[w.to])) throw new Error(`wire ${w.id}: unknown node`);
    wires[w.id] = d; wireDefs[w.id] = w;
    const cls = ['w', w.dashed ? 'w-d' : '', w.flow ? 'w-flow' : '', w.hot ? 'w-hot' : ''].filter(Boolean).join(' ');
    const ah = w.hot ? 'ahh' : 'ah';   // a red (hot) wire gets a red head
    const mk = w.arrow === false ? '' : `${w.both ? ` marker-start="url(#${id}-${ah})"` : ''} marker-end="url(#${id}-${ah})"`;
    if (fading.has(w.id)) {
      // a drained wire: the live copy dims during the window; the still copy serves reduced motion
      const [a, b] = fading.get(w.id);
      parts.push(`<g class="awd-static"><path class="${cls}" d="${d}"${mk}/></g>`);
      parts.push(`<path id="${id}-${w.id}" class="${cls} anim" d="${d}"${mk}><animate attributeName="opacity" dur="${D}" repeatCount="indefinite" calcMode="discrete" values="1;.16;1" keyTimes="0;${pct(a)};${pct(b)}"/></path>`);
    } else parts.push(`<path id="${id}-${w.id}" class="${cls}" d="${d}"${mk}/>`);
    if (w.label) { const [x, y] = pointAt(d, w.labelAt != null ? w.labelAt : 0.5); parts.push(`<text class="t-wire" x="${r2(x)}" y="${r2(y - 5)}">${esc(w.label)}</text>`); }
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
    return out.join('');
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
    if (s.at && wires[s.at]) { [x, y] = pointAt(wires[s.at], s.f != null ? s.f : 0.5); x += s.dx != null ? s.dx : 0; y += s.dy != null ? s.dy : -11; }
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

  if (spec.extra) parts.push(spec.extra);
  const aria = esc(spec.aria || spec.name || id);
  return `<svg class="awd" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">${parts.join('')}</svg>`;
}

export function tile(spec) {
  const svg = diagram(spec);
  const ref = `.awd #${spec.id}`;
  return `  <div class="tile is-new${spec.wide ? ' wide' : ''}" data-fx-id="aws-${spec.id}" data-ctype="${spec.ctype || 'diagram-arch'}" data-interact="auto-play" data-c="accent"><div class="stage">
    ${svg}
  </div><div class="meta"><div class="nm">${esc(spec.name)}</div><span class="ref">${esc(spec.ref || 'svg.awd')}</span><div class="desc">${esc(spec.desc || '')}</div><button class="copy" onclick="copyViz(this)">Copy</button></div></div>`;
}

export function section(mod) {
  const s = mod.section;
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

async function loadSpec(p) { return (await import(pathToFileURL(path.resolve(p)).href)).default; }

// preview page: tokens + kit css + sprite + section, optional light mode
function previewHtml(sectionHtml, mode) {
  const css = fs.readFileSync(path.join(ROOT, 'catalog', 'drafts', 'aws.css'), 'utf8');
  const sprite = fs.readFileSync(path.join(ROOT, 'catalog', 'aws-icons', 'aws-icons.svg'), 'utf8')
    .replace('<svg xmlns="http://www.w3.org/2000/svg" style="display:none">', '<svg id="awd-sprite" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">');
  const dark = ':root{--bg:#0b0e17;--panel:#121623;--panel2:#171d2e;--line:#243049;--ink:#eaf1f9;--muted:#8593a8;--dim:#5b6678;--accent:#ff9900;--accent-rgb:255,153,0;--info:#4493f8;--info-rgb:68,147,248}';
  const light = ':root{--bg:#f4f6f9;--panel:#ffffff;--panel2:#eef1f6;--line:#d5dbe5;--ink:#16191f;--muted:#5f6b7a;--dim:#8a94a3;--accent:#ec7211;--accent-rgb:236,114,17;--info:#0972d3;--info-rgb:9,114,211}';
  return `<!doctype html><html${mode === 'light' ? ' data-mode="light"' : ' data-mode="dark"'}><head><meta charset="utf-8"><title>awd preview</title><style>${mode === 'light' ? light : dark}
*{box-sizing:border-box}body{margin:0;padding:20px;background:var(--bg);color:var(--ink);font:14px system-ui}
h3.sec{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--dim);border-bottom:1px solid var(--line);padding-bottom:8px}
.gallery{display:grid;gap:18px}.tile{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.tile .stage{display:flex;align-items:center;justify-content:center}.tile .meta{padding:10px 14px;border-top:1px solid var(--line)}
.tile .nm{font-weight:700}.tile .ref{font:11px ui-monospace,monospace;color:var(--accent)}.tile .desc{color:var(--muted);font-size:12px}.tile .copy{display:none}
${css}</style></head><body>${sprite}${sectionHtml}</body></html>`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === 'icons') {
  // icon search: node catalog/aws-kit/awd.mjs icons <words...>   (matches id, name, service, category, aliases)
  const q = process.argv.slice(3).join(' ').toLowerCase().split(/\s+/).filter(Boolean);
  const rows = Object.entries(ICONS).filter(([id, ic]) => {
    const hay = [id, ic.name, ic.service || '', ic.category, (ic.aliases || []).join(' ')].join(' ').toLowerCase();
    return q.every((w) => hay.includes(w));
  });
  for (const [id, ic] of rows.slice(0, 60)) console.log(`${id.padEnd(58)} ${ic.kind.padEnd(9)} ${ic.name}${ic.service ? '  [' + ic.service + ']' : ''}`);
  console.log(`${rows.length} match(es)${rows.length > 60 ? ' (first 60 shown)' : ''}. Colorway pairs: use the base id without -dark/-light and the generator swaps per theme.`);
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, specPath, mode] = process.argv.slice(2);
  const mod = await loadSpec(specPath);
  const html = section(mod);
  const errs = validate(html);
  if (cmd === 'build') {
    const out = path.join(ROOT, 'catalog', 'drafts', `${mod.section.id}.aws.html`);
    if (errs.length) { console.error('VALIDATION FAILED:\n  ' + errs.join('\n  ')); process.exit(1); }
    fs.writeFileSync(out, html + '\n');
    console.log(`built ${path.relative(ROOT, out)}: ${mod.diagrams.length} diagram(s), ${html.length} bytes`);
  } else if (cmd === 'preview') {
    const out = path.join(path.dirname(path.resolve(specPath)), `${mod.section.id}.preview${mode === 'light' ? '-light' : ''}.html`);
    fs.writeFileSync(out, previewHtml(html, mode));
    console.log(`preview ${out}`);
    console.log(errs.length ? 'VALIDATION:\n  ' + errs.join('\n  ') : 'validation: OK');
  } else { console.error('usage: awd.mjs build|preview <spec.mjs> [light]'); process.exit(1); }
}
