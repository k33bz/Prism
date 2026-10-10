// drawio.mjs: draw.io (diagrams.net) to AWS kit spec, and back (k33bz fork). No deps.
//
//   import { fromDrawio, toDrawio } from './catalog/aws-kit/import/drawio.mjs';
//   const { spec, report } = fromDrawio(fs.readFileSync('arch.drawio'), { id: 'dr-arch' });
//   fs.writeFileSync('back.drawio', toDrawio(spec));
//
// fromDrawio(content, { id, name, page = 0, story = 'auto' | 'none', width, restore = true })
//   content: a string (.drawio plain or compressed, a bare <mxGraphModel>, a .drawio.svg) or a Buffer
//   (any of those, or a .drawio.png). Returns { spec, report }: spec is one diagram that passes checkSpec,
//   the JSON schema and lint; report is { issues: [{ severity, code, element, message }], unmapped:
//   [{ element, shape, label }], pages, scale, tile, lint }.
// toDrawio(spec) (drawio-export.mjs) writes a plain .drawio file with official AWS styles; the spec rides
//   along on a hidden layer, so fromDrawio restores the timeline and effects of an unedited export exactly.
//
// CLI:
//   node catalog/aws-kit/import/drawio.mjs <file> [--id x] [--name n] [--page n] [--story auto|none] [--width n]
//        [--out spec.json] [--svg out.svg] [--theme light|dark|auto] [--still] [--no-restore]
//   node catalog/aws-kit/import/drawio.mjs --export <family spec> <diagram id> --out x.drawio
//
// The pipeline: load (plain, compressed, svg, png, def() style compression) -> cells (object labels,
// hidden layers dropped, parent-relative geometry, edge label children, HTML flattened) -> classify (AWS
// groups and icons through resolveIcon, plain containers to kit groups with a category tone, other shapes
// to box nodes, text to notes or the title, numbered badges to steps) -> layout (scale to the kit's icon
// size, then a monotone stretch per axis that opens the 22px headers, the 16px padding and room for labels
// without breaking alignment or orthogonal wires) -> wires (from/to or an M/H/V path) -> story (badges or
// a BFS from the users) -> lint loop (labels, badges, notes and routes nudged until lint is clean).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkSpec, diagram, lint, standalone, tableSize } from '../awd.mjs';
import { validateDiagram, validateFamily, canonical, canonicalDiagram, toJson } from '../spec.mjs';
import { compileFlows, story } from '../story.mjs';
import { wrap } from '../place.mjs';
import { textWidth } from '../lint.mjs';
import { resolveIcon, iconInfo } from '../../aws-icons/resolve.mjs';
import { toDrawio, exportDrawio } from './drawio-export.mjs';

export { toDrawio, exportDrawio };

// kit geometry (catalog/drafts/AWS_KIT.md): tile sizes, the group header band and padding
const TILES = { normal: [480, 300], wide: [960, 440], full: [1400, 900] };
const HEAD = 22, PAD = 16, EDGE = 12;
// AWS category colors (the kit's CATEGORY table, awd.mjs does not export it)
const CATEGORY = {
  compute: '#ED7100', containers: '#ED7100', storage: '#7AA116', iot: '#7AA116', database: '#C925D1', devtools: '#C925D1',
  networking: '#8C4FFF', analytics: '#8C4FFF', security: '#DD344C', frontend: '#DD344C', integration: '#E7157B',
  management: '#E7157B', ai: '#01A88D', migration: '#01A88D', general: '#7D8998',
};
const TONE_PICK = ['compute', 'storage', 'database', 'networking', 'security', 'integration', 'ai'];
// default frame labels, so an imported "AWS Cloud" frame keeps the kit default instead of a copy
const GROUP_LABEL = { cloud: 'AWS Cloud', 'cloud-plain': 'AWS Cloud', region: 'Region', az: 'Availability Zone', vpc: 'VPC', pub: 'Public subnet', priv: 'Private subnet', sg: 'Security group', asg: 'Auto Scaling group', acct: 'AWS account', dc: 'Corporate data center', server: 'Server contents', ec2: 'EC2 instance contents', spot: 'Spot Fleet', iot: 'AWS IoT Greengrass deployment', gen: '' };
const ICONLESS = new Set(['az', 'sg', 'gen']);
// actors a request story starts from
const ACTORS = new Set(['aws-res-users', 'aws-res-user', 'aws-res-client', 'aws-res-mobile-client', 'aws-res-authenticated-user', 'aws-res-internet', 'aws-res-internet-alt1', 'aws-res-internet-alt2', 'aws-res-globe', 'aws-res-office-building']);

const r1 = (n) => Math.round(n);
const r3 = (n) => Math.round(n * 1000) / 1000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d = 0) => (v == null || v === '' || !Number.isFinite(+v) ? d : +v);

// ---------------------------------------------------------------- XML (draw.io's own subset)
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s).replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return Object.hasOwn(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : m;
  });
}
// elements, attributes and text (a compressed page is the text of its <diagram>); no DTDs, no namespaces
export function parseXml(src) {
  const root = { name: '#root', attrs: {}, kids: [], text: '' }, stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] != null) { top.text += m[1]; continue; }
    if (m[6] != null) { top.text += decodeEntities(m[6]); continue; }
    if (!m[3]) continue;
    if (m[2]) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].name === m[3]) { stack.length = i; break; } continue; }
    const attrs = {};
    for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decodeEntities(a[2] ?? a[3]);
    const el = { name: m[3], attrs, kids: [], text: '' };
    top.kids.push(el);
    if (!m[5]) stack.push(el);
  }
  return root;
}
const kid = (el, name) => el && el.kids.find((k) => k.name === name);

// draw.io HTML labels to plain text: block tags and <br> break lines, entities decoded, spaces collapsed
export function htmlText(s) {
  const t = String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(div|p|li|ul|ol|h\d|tr|table)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, '');
  return decodeEntities(t).replace(/ /g, ' ').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

// ---------------------------------------------------------------- loader
const isPng = (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a;
// the diagram draw.io embeds in a PNG export: a tEXt (current), zTXt or iTXt chunk named mxfile (older: mxGraphModel)
function pngPayload(buf) {
  for (let off = 8; off + 12 <= buf.length;) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IEND') break;
    if (type !== 'tEXt' && type !== 'zTXt' && type !== 'iTXt') continue;
    const z = data.indexOf(0); if (z < 0) continue;
    const kw = data.toString('latin1', 0, z);
    if (kw !== 'mxfile' && kw !== 'mxGraphModel') continue;
    if (type === 'tEXt') return data.toString('latin1', z + 1);
    if (type === 'zTXt') return zlib.inflateSync(data.subarray(z + 2)).toString('utf8');
    let p = data.indexOf(0, z + 3) + 1; p = data.indexOf(0, p) + 1;   // iTXt: flag, method, language\0, translated keyword\0
    return (data[z + 1] ? zlib.inflateSync(data.subarray(p)) : data.subarray(p)).toString('utf8');
  }
  return null;
}
const uriText = (s) => { const t = String(s).trim(); if (/^%3C/i.test(t)) { try { return decodeURIComponent(t); } catch { /* not URI text */ } } return t; };
// a compressed page: base64 of raw deflate of URI-encoded XML (older files: plain zlib, or no URI step)
function inflatePayload(text) {
  const t = String(text).trim();
  if (!t) return null;
  if (t.startsWith('<')) return t;
  const buf = Buffer.from(t, 'base64');
  let out;
  try { out = zlib.inflateRawSync(buf).toString('utf8'); } catch { try { out = zlib.inflateSync(buf).toString('utf8'); } catch { out = buf.toString('utf8'); } }
  return uriText(out);
}

/** Read any draw.io container: { format, pages: [{ name, model, compressed }], defs }. Throws on anything else. */
export function loadDrawio(content) {
  let text, format = 'drawio';
  if (typeof content !== 'string') {
    const buf = Buffer.from(content);
    if (isPng(buf)) {
      text = pngPayload(buf); format = 'drawio.png';
      if (text == null) throw new Error('this PNG carries no draw.io diagram (no mxfile text chunk): export it from draw.io with "Include a copy of my diagram"');
    } else text = buf.toString('utf8');
  } else text = content;
  text = uriText(text.replace(/^﻿/, ''));
  let doc = parseXml(text), top = doc.kids[0];
  if (top && top.name === 'svg') {
    if (!top.attrs.content) throw new Error('this SVG carries no draw.io diagram (no content attribute): export it from draw.io with "Include a copy of my diagram"');
    format = 'drawio.svg';
    const inner = uriText(top.attrs.content);
    doc = parseXml(inner.startsWith('<') ? inner : inflatePayload(inner) || ''); top = doc.kids[0];
  }
  // style compression (draw.io 29.3+): <defs><def .../></defs>, referenced from styles as def(n)
  const defs = [];
  const walk = (el) => { for (const k of el.kids) { if (k.name === 'def') defs.push(k); else walk(k); } };
  walk(doc);
  const pages = [];
  if (top && top.name === 'mxfile') {
    for (const d of top.kids.filter((k) => k.name === 'diagram')) {
      let model = kid(d, 'mxGraphModel'), compressed = false;
      if (!model && d.text.trim()) {
        const xml = inflatePayload(d.text); compressed = true;
        if (xml) { const inner = parseXml(xml); walk(inner); model = kid(inner, 'mxGraphModel'); }
      }
      if (model) pages.push({ name: d.attrs.name || `Page-${pages.length + 1}`, model, compressed });
    }
  } else if (top && top.name === 'mxGraphModel') {
    if (format === 'drawio') format = 'mxGraphModel';
    pages.push({ name: 'Page-1', model: top, compressed: false });
  }
  if (!pages.length) throw new Error(`not a draw.io diagram (expected <mxfile>, <mxGraphModel>, a .drawio.svg or a .drawio.png; found ${top ? `<${top.name}>` : 'no XML'})`);
  return { format, pages, defs: defs.map((d) => ({ id: d.attrs.id, data: d.attrs.data ?? d.attrs.value ?? d.text })) };
}

// ---------------------------------------------------------------- cells
function parseStyle(raw) {
  const s = Object.create(null); s._names = [];
  for (const part of String(raw || '').split(';')) {
    if (!part) continue;
    const i = part.indexOf('=');
    if (i < 0) { s[part] = '1'; s._names.push(part); } else s[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return s;
}
const expandDefs = (raw, defs) => (defs.length ? String(raw).replace(/def\(([^)]+)\)/g, (m, k) => {
  const d = /^\d+$/.test(k) ? defs[+k] : defs.find((x) => x.id === k);
  return d && d.data != null ? d.data : m;
}) : raw);

// cells of a page with absolute geometry; hidden layers and hidden cells dropped (counted)
function readCells(model, defs) {
  const root = kid(model, 'root');
  if (!root) throw new Error('mxGraphModel has no <root>');
  const cells = new Map(), order = [];
  let meta = null;
  const take = (el, w) => {
    const a = el.attrs, wa = w ? w.attrs : null;
    const id = wa ? wa.id : a.id; if (id == null || cells.has(id)) return;
    let value = wa ? (wa.label ?? '') : (a.value ?? '');
    const props = wa ? Object.fromEntries(Object.entries(wa).filter(([k]) => k !== 'id' && k !== 'label' && k !== 'placeholders')) : {};
    if (wa && wa.placeholders === '1') value = value.replace(/%([\w.-]+)%/g, (m, k) => (Object.hasOwn(props, k) ? props[k] : m));
    if (props.prism_spec != null) meta = { cell: id, json: props.prism_spec, scale: num(props.prism_scale, 1), origin: String(props.prism_origin || '0,0').split(',').map(Number) };
    const raw = expandDefs(a.style || '', defs);
    const c = { id, value, props, raw, style: parseStyle(raw), vertex: a.vertex === '1', edge: a.edge === '1', parent: a.parent, source: a.source, target: a.target, visible: a.visible !== '0', geo: null };
    const g = kid(el, 'mxGeometry');
    if (g) {
      c.geo = { x: num(g.attrs.x), y: num(g.attrs.y), w: num(g.attrs.width), h: num(g.attrs.height), rel: g.attrs.relative === '1', points: [], sp: null, tp: null, offset: null };
      for (const p of g.kids) {
        if (p.name !== 'mxPoint') continue;
        const pt = { x: num(p.attrs.x), y: num(p.attrs.y) };
        if (p.attrs.as === 'sourcePoint') c.geo.sp = pt; else if (p.attrs.as === 'targetPoint') c.geo.tp = pt; else if (p.attrs.as === 'offset') c.geo.offset = pt;
      }
      const arr = g.kids.find((k) => k.name === 'Array' && k.attrs.as === 'points');
      if (arr) c.geo.points = arr.kids.filter((k) => k.name === 'mxPoint').map((p) => ({ x: num(p.attrs.x), y: num(p.attrs.y) }));
    }
    cells.set(id, c); order.push(id);
  };
  for (const k of root.kids) {
    if (k.name === 'mxCell') take(k);
    else if (k.name === 'object' || k.name === 'UserObject') { const inner = kid(k, 'mxCell'); if (inner) take(inner, k); }
  }
  const rootId = order.find((id) => cells.get(id).parent == null || !cells.has(cells.get(id).parent));
  const isLayer = (c) => c && c.parent === rootId && !c.vertex && !c.edge;
  const layers = order.map((id) => cells.get(id)).filter(isLayer);
  // hidden: the cell, or any ancestor (a hidden layer), has visible="0"
  const hiddenMemo = new Map();
  const hidden = (id, depth = 0) => {
    if (id == null || depth > 64) return false;
    if (hiddenMemo.has(id)) return hiddenMemo.get(id);
    const c = cells.get(id); const h = !!c && (!c.visible || hidden(c.parent, depth + 1));
    hiddenMemo.set(id, h); return h;
  };
  // absolute top-left of a vertex (containers nest; a child's geometry is relative to its parent)
  const absMemo = new Map();
  const abs = (id, depth = 0) => {
    const c = cells.get(id);
    if (!c || !c.vertex || !c.geo || depth > 64) return { x: 0, y: 0 };
    if (absMemo.has(id)) return absMemo.get(id);
    const p = cells.get(c.parent);
    let o;
    if (c.geo.rel && p && p.vertex && p.geo) { const po = abs(c.parent, depth + 1); o = { x: po.x + c.geo.x * p.geo.w + (c.geo.offset ? c.geo.offset.x : 0), y: po.y + c.geo.y * p.geo.h + (c.geo.offset ? c.geo.offset.y : 0) }; }
    else { const po = p && p.vertex ? abs(c.parent, depth + 1) : { x: 0, y: 0 }; o = { x: po.x + c.geo.x, y: po.y + c.geo.y }; }
    absMemo.set(id, o); return o;
  };
  const live = [];
  let dropped = 0;
  for (const id of order) {
    const c = cells.get(id);
    if (id === rootId || isLayer(c)) continue;
    if (!c.vertex && !c.edge) continue;
    if (hidden(id)) { if (c.props.prism_spec == null) dropped++; continue; }
    if (c.vertex && c.geo) { const o = abs(id); c.box = { x: o.x, y: o.y, w: c.geo.w, h: c.geo.h }; }
    live.push(c);
  }
  return { cells, live, layers, hiddenLayers: layers.filter((l) => !l.visible), dropped, abs, meta, rootId };
}

// ---------------------------------------------------------------- colors and tones
const hexOf = (v) => { const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(v || '').trim()); if (!m) return null; const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]; return '#' + h.toUpperCase(); };
function hsl(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
// the kit category whose color is closest in hue (old 2019 palette included); null for grays, black, white
export function toneOf(color, { fill = false } = {}) {
  const hex = hexOf(color); if (!hex) return null;
  const [h, s, l] = hsl(hex);
  if (s < (fill ? 0.2 : 0.3) || l < 0.08 || (!fill && l > 0.92) || l > 0.985) return null;
  let best = null, bd = 1e9;
  for (const t of TONE_PICK) { const d = Math.abs(((h - hsl(CATEGORY[t])[0]) + 540) % 360 - 180); if (d < bd) { bd = d; best = t; } }
  return bd <= 30 ? best : null;
}
const isRed = (c) => { const h = hexOf(c); if (!h) return false; const [hh, s, l] = hsl(h); return s > 0.45 && (hh < 12 || hh > 345) && l > 0.25 && l < 0.7; };
const isNone = (v) => v == null || v === 'none' || v === 'transparent' || v === 'default';
const isWhite = (v) => { const h = hexOf(v); return !!h && hsl(h)[2] > 0.97; };

// ---------------------------------------------------------------- classify
const DECO = new Set(['line', 'curlyBracket', 'mxgraph.basic.partConcEllipse', 'flexArrow', 'singleArrow', 'doubleArrow', 'arrow', 'partialRectangle', 'link']);
const ec2Family = (name) => { const m = /^([a-z]{1,3}\d[a-z0-9]*?)(?:_instance)?$/.exec(name || ''); return m && !/^(rds|aurora|db|ebs|eks|ecs)/.test(m[1]) ? m[1] : null; };

function labelOf(c) {
  const html = c.style.html === '1' || /<[a-z][^>]*>/i.test(c.value);
  return html ? htmlText(c.value) : String(c.value || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}
function labelPosOf(s) {
  if (s.labelPosition === 'right') return 'r';
  if (s.labelPosition === 'left') return 'l';
  if (s.verticalLabelPosition === 'top') return 't';
  return 'b';
}
// a frame from an AWS group style: grIcon first, then the stroke color (subnets), via the shared resolver
function awsGroup(c, label, add) {
  const s = c.style, gi = String(s.grIcon || '').replace(/^mxgraph\.aws\d?\./, '');
  if (c.props.prism_group) return { t: 'group', kind: c.props.prism_group, label, icon: c.props.prism_icon };
  if (!gi) { add('info', 'group-generic', c.id, `AWS group "${label}" has no grIcon; drawn as a generic frame`); return { t: 'group', kind: 'gen', label }; }
  const r = resolveIcon(`grIcon=mxgraph.aws4.${gi};strokeColor=${s.strokeColor || ''}`, { from: 'drawio' });
  if (r.kind !== 'group') { add('warn', 'group-unknown', c.id, `unknown group grIcon=${gi} on "${label}"; drawn as a generic frame`); return { t: 'group', kind: 'gen', label, tone: toneOf(s.strokeColor) }; }
  let kind = r.group, icon;
  if (gi === 'group_aws_cloud') kind = 'cloud-plain';
  if (kind === 'gen' && r.id === 'aws-grp-iot-greengrass-deployment') kind = 'iot';
  else if (kind === 'gen' && r.id) { icon = r.id; }
  const out = { t: 'group', kind, label };
  if (icon) { out.icon = icon; const tone = toneOf(s.strokeColor); if (tone) out.tone = tone; }
  return out;
}
// an icon from an AWS shape style; the label is a guarded second signal
function awsNode(c, label, add, unmapped) {
  const s = c.style;
  if (c.props.prism_icon && iconInfo(c.props.prism_icon)) return { t: 'node', icon: c.props.prism_icon, label, labelPos: labelPosOf(s), wrap: num(c.props.prism_wrap, 0) || undefined };
  const shape = String(s.shape || '');
  let q, name;
  if (shape === 'mxgraph.aws4.resourceIcon') { name = String(s.resIcon || ''); q = `resIcon=${name}`; }
  else if (shape === 'mxgraph.aws4.productIcon') { name = String(s.prIcon || ''); q = `prIcon=${name}`; }
  else { name = shape; q = `shape=${shape}`; }
  const bare = name.replace(/^mxgraph\.aws\d?\./, '');
  let r = resolveIcon(q, { from: 'drawio' }), sub;
  if (r.kind === 'group') { const n = resolveIcon(q, { from: 'drawio', prefer: 'node' }); r = n.id && n.kind === 'node' ? n : { id: null }; }
  if (!r.id && ec2Family(bare)) { r = resolveIcon('shape=mxgraph.aws4.instance2', { from: 'drawio' }); sub = ec2Family(bare); add('info', 'icon-ec2-type', c.id, `${bare} is an EC2 instance type; drawn as an EC2 instance with "${sub}" under the label`); }
  if (!r.id) {
    unmapped.push({ element: c.id, shape: q, label });
    add('warn', 'icon-unmapped', c.id, `no Prism icon for ${q}${label ? ` ("${label.replace(/\n/g, ' ')}")` : ''}; drawn as a box`);
    return { t: 'shape', shape: 'box', label: label || bare.replace(/_/g, ' '), forced: true };
  }
  if (/^mxgraph\.aws3/.test(shape)) add('info', 'icon-legacy', c.id, `${bare} is from the legacy AWS17 (aws3) library; matched as ${r.id}`);
  for (const w of r.warnings || []) add('info', 'icon-note', c.id, w);
  if (r.confidence < 0.8) add('info', 'icon-approx', c.id, `${bare} matched ${r.id} with confidence ${r.confidence} (${r.how})`);
  let icon = r.id;
  // the label: an exact name that disagrees with the shape is reported; a label that names a resource
  // of the shape's own service refines the icon (cloudwatch + "Amazon CloudWatch Logs")
  const text = label.replace(/\s+/g, ' ').trim();
  if (text && text.length <= 60) {
    const lb = resolveIcon(text);
    const exact = lb.id && lb.kind === 'node' && lb.confidence >= 0.9 && !/words|partial|two-services|suffix|^service/.test(lb.how);
    const oneWord = !/\s/.test(text);
    const A = iconInfo(icon), B = exact ? iconInfo(lb.id) : null;
    if (B && !(oneWord && B.kind !== 'service') && lb.id !== icon && A && A.name !== B.name) {
      const related = A.svc && (A.svc === B.id || A.svc === B.svc || B.svc === A.id);
      if (B.kind === 'resource' && A.kind === 'service' && B.svc === A.id) { add('info', 'label-refined', c.id, `shape ${bare} is ${icon}; the label "${text}" names its resource ${lb.id}, used that`); icon = lb.id; }
      else if (!related) add('info', 'label-shape', c.id, `shape ${bare} draws ${icon} but the label "${text}" reads as ${lb.id}; kept the shape`);
    }
  }
  return { t: 'node', icon, label, sub, labelPos: labelPosOf(s) };
}

function classify(c, model, add, unmapped) {
  const s = c.style, p = c.props, label = labelOf(c);
  const parent = model.cells.get(c.parent);
  if (s.edgeLabel || (parent && parent.edge)) return { t: 'edgelabel', label, edge: parent && parent.edge ? parent.id : null };
  const pk = p.prism_kind;
  if (pk === 'title') return { t: 'title', label };
  if (pk === 'steplist') return { t: 'steplist', label };
  if (pk === 'legend') { let data = {}; try { data = JSON.parse(p.prism_legend || '{}'); } catch { /* defaults */ } return { t: 'legend', label, data }; }
  if (pk === 'mark') return { t: 'mark', kind: p.prism_mark === 'ok' ? 'ok' : 'blocked', on: p.prism_on };
  if (pk === 'table') { let data = null; try { data = JSON.parse(p.prism_table || 'null'); } catch { /* drawn text only */ } return data ? { t: 'table', label, data } : { t: 'text', label, size: num(s.fontSize, 10), bold: false, align: 'left', valign: 'top', color: s.fontColor, prism: true, note: null, wraps: true }; }
  if (pk === 'step') return { t: 'badge', n: /^\d+$/.test(label) ? +label : label, text: p.tooltip };
  const shape = String(s.shape || '');
  if (pk === 'group' || shape === 'mxgraph.aws4.group' || shape === 'mxgraph.aws4.groupCenter' || s.grIcon) return awsGroup(c, label, add);
  if (/^mxgraph\.aws(3|4)?d?\./.test(shape) || p.prism_icon) return awsNode(c, label, add, unmapped);
  const box = c.box || { w: 0, h: 0 };
  if (/^\d{1,2}$/.test(label) && box.w <= 48 && box.h <= 48 && box.w > 0) return { t: 'badge', n: +label };
  const textish = s.text || (s.strokeColor === 'none' && (isNone(s.fillColor) || isWhite(s.fillColor)) && !shape && !s.ellipse && !s.swimlane);
  if (pk === 'note' || pk === 'gnote' || (textish && !s.image)) {
    const size = num(s.fontSize, 12);
    let note = null;
    if (p.prism_note) { try { note = JSON.parse(p.prism_note); } catch { /* drawn text only */ } }
    return { t: 'text', label, size, bold: (num(s.fontStyle) & 1) === 1 || /^\s*<b>[\s\S]*<\/b>\s*$/i.test(c.value), align: s.align || 'center', valign: s.verticalAlign || 'middle', color: s.fontColor, gnote: pk === 'gnote', prism: !!pk, note, wraps: s.whiteSpace === 'wrap' };
  }
  if (shape === 'image' || s.image) return { t: 'image', label };
  if (DECO.has(shape) || s.line) return { t: 'deco', what: shape || 'line', label };
  const ellipse = s.ellipse || shape === 'ellipse' || shape === 'doubleEllipse' || p.prism_shape === 'pill';
  return { t: 'shape', shape: ellipse ? 'pill' : 'box', label, stroke: s.strokeColor, fill: s.fillColor, dashed: s.dashed === '1', container: s.container === '1' || !!s.swimlane || shape === 'swimlane', note: shape === 'note' };
}

// a frame kind for a plain container: Availability Zone and security group by label or stroke, other
// AWS containers by label (VPC, subnets, Region, account, data center), else a generic frame
function plainGroupKind(label, s) {
  const st = hexOf(s.strokeColor);
  const first = String(label || '').split('\n')[0];
  if (/^availability zone/i.test(first) || (st === '#147EBA' && s.dashed === '1')) return 'az';
  if (/^security group/i.test(first) || st === '#DD3522' || st === '#DD344C') return 'sg';
  if (first) { const r = resolveIcon(first, { prefer: 'group' }); if (r.kind === 'group' && r.group !== 'gen' && r.group !== 'sg' && r.confidence >= 0.8) return r.group; }
  return 'gen';
}

// ---------------------------------------------------------------- geometry helpers
const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const inside = (p, b, t = 0) => p.x > b.x - t && p.x < b.x + b.w + t && p.y > b.y - t && p.y < b.y + b.h + t;
const boxIn = (a, b, t = 1) => a.x >= b.x - t && a.y >= b.y - t && a.x + a.w <= b.x + b.w + t && a.y + a.h <= b.y + b.h + t;
function pathPts(d) {
  const out = []; let x = 0, y = 0;
  for (const [, c, v] of String(d).matchAll(/([MHVL])\s*([-\d.]+(?:[ ,][-\d.]+)?)/g)) {
    const n = v.split(/[ ,]/).map(Number);
    if (c === 'M' || c === 'L') { x = n[0]; y = n[1]; } else if (c === 'H') x = n[0]; else y = n[0];
    out.push([x, y]);
  }
  return out;
}
// point and unit direction at fraction f along a polyline
function segAt(pts, f) {
  if (pts.length < 2) return { x: pts[0] ? pts[0][0] : 0, y: pts[0] ? pts[0][1] : 0, dir: [1, 0] };
  const seg = []; let tot = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); tot += l; }
  let want = tot * f;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? Math.min(1, want / seg[i]) : 0, [a, b] = [pts[i], pts[i + 1]], l = seg[i] || 1;
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, dir: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] };
    }
    want -= seg[i];
  }
  const n = pts.length; return { x: pts[n - 1][0], y: pts[n - 1][1], dir: [1, 0] };
}
// distance from a point to a polyline, and the fraction along it of the nearest point
function nearest(p, pts) {
  let best = { d: Infinity, f: 0.5, side: 0, horiz: true }, acc = 0, tot = 0;
  for (let i = 1; i < pts.length; i++) tot += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], l2 = (bx - ax) ** 2 + (by - ay) ** 2, l = Math.sqrt(l2);
    const t = l2 ? clamp(((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / l2, 0, 1) : 0;
    const qx = ax + t * (bx - ax), qy = ay + t * (by - ay), d = Math.hypot(p.x - qx, p.y - qy);
    if (d < best.d) {
      const horiz = Math.abs(bx - ax) >= Math.abs(by - ay);
      best = { d, f: tot ? (acc + t * l) / tot : 0.5, side: horiz ? Math.sign(p.y - qy) : Math.sign(p.x - qx), horiz };
    }
    acc += l;
  }
  return best;
}
// rendered wire paths of a spec, from the kit's own markup (one source of routing truth)
function wirePaths(spec, svg = diagram(spec)) {
  const out = Object.create(null), pre = `${spec.id}-`;
  for (const m of svg.matchAll(/<path id="([^"]+)" class="w[^"]*"[^>]*? d="([^"]+)"/g)) if (m[1].startsWith(pre)) out[m[1].slice(pre.length)] = pathPts(m[2]);
  return out;
}
const mhv = (pts) => {
  let d = `M${r1(pts[0][0])},${r1(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += r1(pts[i][1]) === r1(pts[i - 1][1]) ? ` H${r1(pts[i][0])}` : ` V${r1(pts[i][1])}`;
  return d;
};
// drop repeated points and merge collinear runs
function tidy(pts) {
  const p = pts.map(([x, y]) => [r1(x), r1(y)]).filter((q, i, a) => i === 0 || q[0] !== a[i - 1][0] || q[1] !== a[i - 1][1]);
  return p.filter((q, i, a) => i === 0 || i === a.length - 1 || !((a[i - 1][0] === q[0] && q[0] === a[i + 1][0]) || (a[i - 1][1] === q[1] && q[1] === a[i + 1][1])));
}

// label metrics (the generator's own wrap, Arial advance widths from lint.mjs)
const LINE = 11;
function nodeLabel(n) {
  const lines = n.label ? wrap(n.label, n.wrap || 14) : [];
  const w = Math.max(0, ...lines.map((l) => textWidth(l, 10.5)), n.sub ? textWidth(n.sub, 9) : 0);
  return { lines, w };
}
// extents of a node (icon plus label) around its center: left, right, up, down
function nodeExt(n, S) {
  const h = S / 2, { lines, w } = nodeLabel(n), k = lines.length + (n.sub ? 1 : 0);
  const pos = n.labelPos || 'b';
  if (!k) return { l: h, r: h, u: h, d: h, core: h };
  if (pos === 'b') return { l: Math.max(h, w / 2), r: Math.max(h, w / 2), u: h, d: h + 12.5 + LINE * (k - 1), core: h };
  const bh = LINE * (k - 1) + 8;
  if (pos === 'r') return { l: h, r: h + 6 + w, u: Math.max(h, bh / 2 + 1), d: Math.max(h, bh / 2 + 1), core: h };
  if (pos === 'l') return { l: h + 6 + w, r: h, u: Math.max(h, bh / 2 + 1), d: Math.max(h, bh / 2 + 1), core: h };
  return { l: Math.max(h, w / 2), r: Math.max(h, w / 2), u: h + 5 + LINE * (k - 1) + 7.2, d: h, core: h };
}
// the label height under an icon (where a wire leaving downward starts)
const below = (n) => (n.kind || (n.labelPos || 'b') !== 'b' || !n.label ? 0 : 13 * wrap(n.label, n.wrap || 14).length) + (n.sub && !n.kind && (n.labelPos || 'b') === 'b' ? 11 : 0);
const above = (n) => (n.kind || n.labelPos !== 't' || !n.label ? 0 : LINE * wrap(n.label, n.wrap || 14).length + 4);
// a box node sized for its label
function boxSize(label, w0, h0) {
  const tw = Math.max(0, ...String(label || '').split(/\s+/).map((x) => textWidth(x, 10.5)));
  let w = Math.max(w0, Math.min(textWidth(String(label || '').replace(/\n/g, ' '), 10.5) + 16, 150), tw + 14, 56);
  const lines = wrap(label || '', Math.max(8, Math.floor((w - 12) / 5.6))).length;
  const h = Math.max(h0, LINE * lines + 14, 28);
  return { w: r1(w), h: r1(h) };
}
// note text: lines, widths, block height
function noteMetrics(nt) {
  const size = nt.size || (nt.kind === 'label' ? 10.5 : 8.5), bold = nt.weight === 'bold' || nt.kind === 'warn';
  const lines = String(nt.text).split('\n').map((l) => (nt.caps ? l.toUpperCase() : l));
  const lh = nt.size ? nt.size * 1.2 : 10;
  const w = Math.max(...lines.map((l) => textWidth(l, size, bold, nt.caps ? 0.8 : 0)));
  return { size, lines, lh, w, h: lh * (lines.length - 1) + 0.73 * size };
}

// ---------------------------------------------------------------- layout: scale, then stretch
// Each element (node, box, note, free badge, frame header, frame note) has an anchor that moves with the
// layout and fixed extents (text does not scale). Groups have four edges that move. Constraints say "this
// coordinate must end at least gap after that one"; a constraint is met by inserting space at a cut between
// them, which shifts everything past the cut. A shift never shrinks a gap, so one pass meets them all, and
// equal coordinates stay equal: rows, columns and orthogonal wires survive.
function solveAxis(cons) {
  const cuts = [];
  const F = (v) => { let o = v; for (const [c, d] of cuts) if (v > c) o += d; return o; };
  cons.sort((p, q) => (p[1] - p[0]) - (q[1] - q[0]));
  for (const [a, b, gap] of cons) { const cur = F(b) - F(a); if (cur < gap - 0.01) cuts.push([(a + b) / 2, gap - cur]); }
  return F;
}
// cluster nearly equal values (node centers, waypoints) so rows and columns are exact
function snapper(vals, tol) {
  const v = [...new Set(vals)].sort((a, b) => a - b), map = new Map();
  for (let i = 0; i < v.length;) {
    let j = i; while (j + 1 < v.length && v[j + 1] - v[i] <= tol) j++;
    const grp = v.slice(i, j + 1), rep = grp[Math.floor(grp.length / 2)];
    for (const x of grp) map.set(x, rep);
    i = j + 1;
  }
  return (x) => (map.has(x) ? map.get(x) : x);
}

function layout(M, s, S) {
  const X = (x) => (x - M.minX) * s, Y = (y) => (y - M.minY) * s;
  const sx = snapper(M.snapX.map(X), 3), sy = snapper(M.snapY.map(Y), 3);
  const gs = M.groups.map((g) => ({ X0: X(g.box.x), X1: X(g.box.x + g.box.w), Y0: Y(g.box.y), Y1: Y(g.box.y + g.box.h) }));
  const els = M.els.map((e) => {
    const ext = e.ext(S, s);
    const ax = e.snap ? sx(X(e.ax)) : X(e.ax), ay = e.snap ? sy(Y(e.ay)) : Y(e.ay);
    if (e.kind === 'head') return { e, ...ext, X: gs[e.g].X0, Y: gs[e.g].Y0 };
    if (e.kind === 'gnote') return { e, ...ext, X: gs[e.g].X1, Y: gs[e.g].Y0 };
    return { e, ...ext, X: ax, Y: ay };
  });
  const cx = [], cy = [];
  const need = (arr, a, b, gap) => { if (b - a > 1e-6) arr.push([a, b, gap]); };
  // groups: their own size, and nesting with header room
  M.groups.forEach((g, i) => {
    const G = gs[i];
    need(cx, G.X0, G.X1, g.minW); need(cy, G.Y0, G.Y1, 34);
    if (g.parent != null) {
      const P = gs[g.parent], ph = M.groups[g.parent].header;
      need(cy, P.Y0, G.Y0, ph ? HEAD + 4 : 8); need(cy, G.Y1, P.Y1, 8); need(cx, P.X0, G.X0, 8); need(cx, G.X1, P.X1, 8);
    }
  });
  // members stay inside every frame that holds their anchor: header band, padding, labels clear of borders
  for (const el of els) {
    if (el.e.kind === 'head' || el.e.kind === 'gnote') continue;
    for (const gi of el.e.groups) {
      const G = gs[gi], g = M.groups[gi];
      need(cy, G.Y0, el.Y, el.u + (g.header ? HEAD + 2 : 10));
      need(cy, el.Y, G.Y1, Math.max(el.d + 8, el.core + PAD));
      need(cx, G.X0, el.X, Math.max(el.l + 8, el.core + PAD));
      need(cx, el.X, G.X1, Math.max(el.r + 8, el.core + PAD));
    }
  }
  const bx = (el) => ({ x0: el.X - el.l, x1: el.X + el.r, y0: el.Y - el.u, y1: el.Y + el.d });
  // elements clear of frames they are not in (a label across a border is a lint error)
  for (const el of els) {
    const own = el.e.kind === 'head' || el.e.kind === 'gnote' ? new Set([el.e.g, ...M.groups[el.e.g].anc]) : new Set(el.e.groups);
    const b = bx(el);
    M.groups.forEach((g, gi) => {
      if (own.has(gi)) return;
      if (el.e.kind === 'head' || el.e.kind === 'gnote') { if (M.groups[gi].anc.includes(el.e.g)) return; }
      const G = gs[gi];
      if (!(b.x0 < G.X1 + 4 && b.x1 > G.X0 - 4 && b.y0 < G.Y1 + 4 && b.y1 > G.Y0 - 4)) return;
      // a frame's header crossed by another frame's edges
      if (el.e.kind === 'head' || el.e.kind === 'gnote') {
        for (const ex of [G.X0, G.X1]) if (ex > b.x0 + 1 && ex < b.x1 && G.Y0 < b.y1 && G.Y1 > b.y0) { if (el.e.kind === 'head') need(cx, el.X, ex, el.r + 4); else need(cx, ex, el.X, el.l + 4); }
        for (const ey of [G.Y0, G.Y1]) if (ey > b.y0 && ey < b.y1 + 4 && G.X0 < b.x1 && G.X1 > b.x0) need(cy, el.Y, ey, el.d + 4);
        return;
      }
      if (el.X < G.X0) need(cx, el.X, G.X0, el.r + 8);
      else if (el.X > G.X1) need(cx, G.X1, el.X, el.l + 8);
      else if (el.Y < G.Y0) need(cy, el.Y, G.Y0, el.d + 8);
      else if (el.Y > G.Y1) need(cy, G.Y1, el.Y, el.u + 8);
    });
  }
  // element pairs that overlap: pull apart along the axis that costs less
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const A = els[i], B = els[j];
    const hA = A.e.kind === 'head' || A.e.kind === 'gnote', hB = B.e.kind === 'head' || B.e.kind === 'gnote';
    if (hA && B.e.groups.includes(A.e.g)) continue;
    if (hB && A.e.groups.includes(B.e.g)) continue;
    if (hA && hB && (A.e.g === B.e.g || M.groups[A.e.g].anc.includes(B.e.g) || M.groups[B.e.g].anc.includes(A.e.g))) continue;
    const a = bx(A), b = bx(B), m = 6;
    if (!(a.x0 < b.x1 + m && b.x0 < a.x1 + m && a.y0 < b.y1 + m && b.y0 < a.y1 + m)) continue;
    const dX = B.X - A.X, dY = B.Y - A.Y;
    const nX = dX > 0 ? A.r + B.l + m - dX : dX < 0 ? B.r + A.l + m + dX : Infinity;
    const nY = dY > 0 ? A.d + B.u + m - dY : dY < 0 ? B.d + A.u + m + dY : Infinity;
    if (!Number.isFinite(nX) && !Number.isFinite(nY)) continue;
    if (nX <= nY) { if (dX > 0) need(cx, A.X, B.X, A.r + B.l + m); else need(cx, B.X, A.X, B.r + A.l + m); }
    else if (dY > 0) need(cy, A.Y, B.Y, A.d + B.u + m); else need(cy, B.Y, A.Y, B.d + A.u + m);
  }
  // wires (their source routes) clear frame headers and the nodes and notes they do not connect
  for (const sg of M.segs) {
    const P = sg.pts.map(([x, y]) => [sx(X(x)), sy(Y(y))]);
    for (let i = 1; i < P.length; i++) {
      const [ax, ay] = P[i - 1], [bx2, by] = P[i];
      const vert = Math.abs(ax - bx2) < 0.5, horz = Math.abs(ay - by) < 0.5;
      if (!vert && !horz) continue;
      const lo = vert ? Math.min(ay, by) : Math.min(ax, bx2), hi = vert ? Math.max(ay, by) : Math.max(ax, bx2);
      M.groups.forEach((g, gi) => {
        if (!g.header || g.centered) return;
        const G = gs[gi];
        if (vert && ax > G.X0 + 1 && ax < G.X0 + g.labelEnd + 4 && lo < G.Y0 + 20 && hi > G.Y0) need(cx, G.X0, ax, g.labelEnd + 6);
        if (vert && g.noteW && ax < G.X1 - 1 && ax > G.X1 - g.noteW - 4 && lo < G.Y0 + 20 && hi > G.Y0) need(cx, ax, G.X1, g.noteW + 6);
        if (horz && ay > G.Y0 && ay < G.Y0 + 20 && hi > G.X0 && lo < G.X0 + g.labelEnd) need(cy, G.Y0, ay, 24);
      });
      els.forEach((el, ei) => {
        if (el.e.kind === 'head' || el.e.kind === 'gnote' || sg.ends.has(ei)) return;
        const b = bx(el);
        if (vert && ax > b.x0 - 4 && ax < b.x1 + 4 && hi > b.y0 && lo < b.y1) { if (ax > el.X) need(cx, el.X, ax, el.r + 6); else if (ax < el.X) need(cx, ax, el.X, el.l + 6); }
        if (horz && ay > b.y0 - 4 && ay < b.y1 + 4 && hi > b.x0 && lo < b.x1) { if (ay > el.Y) need(cy, el.Y, ay, el.d + 6); else if (ay < el.Y) need(cy, ay, el.Y, el.u + 6); }
      });
    }
  }
  const FX = solveAxis(cx), FY = solveAxis(cy);
  // bounds: elements with extents, frames, waypoints
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (a, b, c, d) => { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); };
  for (const el of els) { const X1 = FX(el.X), Y1 = FY(el.Y); grow(X1 - el.l, Y1 - el.u, X1 + el.r, Y1 + el.d); }
  for (const G of gs) grow(FX(G.X0), FY(G.Y0), FX(G.X1), FY(G.Y1));
  for (const p of M.points) { const X1 = FX(sx(X(p.x))), Y1 = FY(sy(Y(p.y))); grow(X1, Y1, X1, Y1); }
  const ox = EDGE - x0, oy = EDGE - y0;
  const place = (x, y, snap = true) => [r1(FX(snap ? sx(X(x)) : X(x)) + ox), r1(FY(snap ? sy(Y(y)) : Y(y)) + oy)];
  return {
    W: Math.ceil(x1 - x0 + 2 * EDGE), H: Math.ceil(y1 - y0 + 2 * EDGE), s, S, place,
    at: (i) => [r1(FX(els[i].X) + ox), r1(FY(els[i].Y) + oy)],
    group: (i) => { const G = gs[i], a = r1(FX(G.X0) + ox), b = r1(FY(G.Y0) + oy); return { x: a, y: b, w: r1(FX(G.X1) + ox) - a, h: r1(FY(G.Y1) + oy) - b }; },
  };
}

// ---------------------------------------------------------------- wires
// an M/H/V path from a start to an end through waypoints; ends on nodes leave and enter at the icon edge
// (below the label when leaving downward), as the kit's own routes do
function routePath(start, wps, end) {
  const port = (e) => (e.node ? (e.port || e.c) : e.pt);
  const seq = [port(start), ...wps, port(end)].map(([x, y]) => [x, y]);
  if (seq.length < 2) return null;
  const level = (v, lo, len) => v > lo && v < lo + len;
  // does the first leg leave the start horizontally? (a port says so; else the side facing the next point)
  const firstH = (a, b, e) => {
    if (e.port) return e.side === 'h';
    const B = e.box, ly = level(b[1], B.y, B.h), lx = level(b[0], B.x, B.w);
    if (ly && !lx) return true;
    if (lx && !ly) return false;
    return Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
  };
  // does the last leg enter the end horizontally?
  const lastH = (a, b, e) => {
    if (e.port) return e.side === 'h';
    const B = e.box, ly = level(a[1], B.y, B.h), lx = level(a[0], B.x, B.w);
    if (ly && !lx) return true;
    if (lx && !ly) return false;
    return Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
  };
  const out = [seq[0]];
  for (let i = 1; i < seq.length; i++) {
    const a = out[out.length - 1], b = seq[i];
    if (Math.abs(a[0] - b[0]) > 0.5 && Math.abs(a[1] - b[1]) > 0.5) {
      const f = i === 1 && start.node ? firstH(a, b, start) : null;
      const l = i === seq.length - 1 && end.node ? lastH(a, b, end) : null;
      if (f != null && l != null && f === l) {
        // both ends want the same direction: a Z with its middle run halfway
        if (f) { const mx = (a[0] + b[0]) / 2; out.push([mx, a[1]], [mx, b[1]]); } else { const my = (a[1] + b[1]) / 2; out.push([a[0], my], [b[0], my]); }
      } else if (f != null) out.push(f ? [b[0], a[1]] : [a[0], b[1]]);
      else if (l != null) out.push(l ? [a[0], b[1]] : [b[0], a[1]]);
      else out.push([b[0], a[1]]);
    }
    out.push(b);
  }
  // clip the ends at the node edges
  const clip = (pts, e, gap, isEnd) => {
    if (!e.node) return pts;
    const B = e.box, n = e.node;
    for (let guard = 0; guard < 4 && pts.length >= 2; guard++) {
      const [p, q] = isEnd ? [pts[pts.length - 1], pts[pts.length - 2]] : [pts[0], pts[1]];
      let np;
      if (Math.abs(p[1] - q[1]) < 0.5) np = [q[0] > p[0] ? B.x + B.w + gap : B.x - gap, p[1]];
      else np = [p[0], q[1] > p[1] ? B.y + B.h + gap + below(n) : B.y - gap - above(n)];
      const past = Math.abs(p[1] - q[1]) < 0.5 ? (q[0] - np[0]) * (q[0] - p[0]) <= 0 : (q[1] - np[1]) * (q[1] - p[1]) <= 0;
      if (past && pts.length > 2) { if (isEnd) pts.splice(pts.length - 2, 1); else pts.splice(1, 1); continue; }
      if (isEnd) pts[pts.length - 1] = np; else pts[0] = np;
      break;
    }
    return pts;
  };
  let pts = tidy(out);
  pts = clip(pts, start, 2, false);
  pts = clip(pts, end, 4, true);
  pts = tidy(pts);
  if (pts.length < 2 || (pts.length === 2 && pts[0][0] === pts[1][0] && pts[0][1] === pts[1][1])) return null;
  return pts;
}
// the side of a frame a wire end meets, toward the neighbouring point
function onFrame(b, toward) {
  const c = center(b), dx = toward[0] - c.x, dy = toward[1] - c.y;
  if (Math.abs(dx) * b.h >= Math.abs(dy) * b.w) return [dx > 0 ? b.x + b.w + 1 : b.x - 1, clamp(toward[1], b.y + 8, b.y + b.h - 8)];
  return [clamp(toward[0], b.x + 8, b.x + b.w - 8), dy > 0 ? b.y + b.h + 1 : b.y - 1];
}
// a wire label beside its path: draw.io puts a positive relative y on the left of travel (measured in
// viewer.diagrams.net: above a left-to-right run, right of a top-to-bottom run)
function labelSpot(pts, at, side, lines = 1) {
  const { dir } = segAt(pts, at);
  if (Math.abs(dir[0]) >= Math.abs(dir[1])) {
    const up = side === 0 ? true : (side > 0) === (dir[0] > 0);
    return { labelDy: up ? -5 - 9.5 * (lines - 1) : 12 };
  }
  const right = side === 0 ? true : (side > 0) === (dir[1] > 0);
  return { labelAnchor: right ? 'start' : 'end', labelDx: right ? 6 : -6, labelDy: r1(3 - 4.75 * (lines - 1)) };
}
function badgeSpot(pts, f, side) {
  const { dir } = segAt(pts, f);
  if (Math.abs(dir[0]) >= Math.abs(dir[1])) return side > 0 ? { dy: 11 } : {};
  return { dx: side < 0 ? -11 : 11, dy: 0 };
}

// ---------------------------------------------------------------- main
/** Convert a draw.io diagram to one AWS kit diagram spec. See the header for options and the report. */
export function fromDrawio(content, opts = {}) {
  const issues = [], unmapped = [];
  const add = (severity, code, element, message) => issues.push({ severity, code, element: element == null ? null : String(element), message });
  const doc = loadDrawio(content);
  const want = opts.page != null ? opts.page : 0;
  const pi = typeof want === 'string' && !/^\d+$/.test(want) ? doc.pages.findIndex((p) => p.name === want) : +want;
  if (!(pi >= 0 && pi < doc.pages.length)) throw new Error(`no page ${JSON.stringify(want)} (the file has ${doc.pages.length}: ${doc.pages.map((p) => p.name).join(', ')})`);
  const page = doc.pages[pi];
  if (doc.pages.length > 1) add('info', 'pages', null, `${doc.pages.length} pages; imported page ${pi} "${page.name}" (pass page to pick another)`);
  const model = readCells(page.model, doc.defs);
  if (model.layers.length > 1) add('info', 'layers', null, `${model.layers.length} layers flattened into one paint order`);
  for (const l of model.hiddenLayers) if (l.id !== 'prism-layer') add('info', 'hidden-layer', l.id, `hidden layer "${l.value || l.id}" dropped`);
  if (model.dropped) add('info', 'hidden', null, `${model.dropped} hidden cell(s) dropped`);

  // an export of a Prism spec: restore it when the drawing was not edited
  let meta = null;
  if (model.meta) { try { meta = JSON.parse(model.meta.json); } catch { add('warn', 'prism-meta', model.meta.cell, 'the prism_spec object is not valid JSON; imported the drawing only'); } }
  if (meta && opts.restore !== false) {
    const r = restoreExact(meta, model, opts);
    if (r) { add('info', 'prism-restored', null, 'unedited Prism export: restored the spec (timeline and effects included) from the hidden prism layer'); return finish(r, { issues, unmapped, doc, pi, scale: 1 / (model.meta.scale || 1) }); }
  }

  const spec = convert(model, doc, pi, opts, add, unmapped, meta && opts.restore !== false ? meta : null);
  return finish(spec.spec, { issues, unmapped, doc, pi, scale: spec.scale, tile: spec.tile });
}

function finish(spec, { issues, unmapped, doc, pi, scale, tile }) {
  checkSpec(spec);
  const errs = validateDiagram(spec);
  if (errs.length) throw new Error(`internal: the imported spec does not match spec.schema.json: ${errs.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  const findings = lint(spec);
  for (const f of findings) if (f.severity === 'error') issues.push({ severity: 'error', code: `lint:${f.code}`, element: null, message: f.message });
  const order = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    spec,
    report: {
      issues, unmapped, pages: doc.pages.map((p, i) => ({ index: i, name: p.name, compressed: p.compressed, imported: i === pi })), format: doc.format,
      scale: r3(scale), tile: tile || (spec.full ? 'full' : spec.wide ? 'wide' : 'normal'), lint: findings,
    },
  };
}

// ---------------------------------------------------------------- conversion proper
function convert(model, doc, pi, opts, add, unmapped, meta) {
  const page = doc.pages[pi];
  const cls = new Map();
  for (const c of model.live) if (c.vertex && c.box) cls.set(c.id, classify(c, model, add, unmapped));
  const edges = model.live.filter((c) => c.edge);
  const of = (t) => model.live.filter((c) => cls.get(c.id)?.t === t);
  const connected = new Set(edges.flatMap((e) => [e.source, e.target]).filter(Boolean));

  // ---- title and subtitle: the largest text above everything else
  const content = model.live.filter((c) => c.box && (['group', 'node'].includes(cls.get(c.id)?.t) || (cls.get(c.id)?.t === 'shape' && cls.get(c.id).label)));
  const topOver = (b) => Math.min(Infinity, ...content.filter((c) => c.box.x < b.x + b.w && c.box.x + c.box.w > b.x).map((c) => c.box.y));
  let name = opts.name || null, sub = null;
  const titled = of('title')[0];
  if (titled) { name = name || cls.get(titled.id).label.replace(/\n/g, ' '); cls.set(titled.id, { t: 'used' }); }
  else {
    const cand = of('text').filter((c) => { const k = cls.get(c.id); return (k.size >= 16 || (k.bold && k.size >= 14)) && c.box.y + c.box.h <= topOver(c.box) + 10; })
      .sort((a, b) => cls.get(b.id).size - cls.get(a.id).size || a.box.y - b.box.y)[0];
    if (cand) {
      name = name || cls.get(cand.id).label.replace(/\n/g, ' ');
      add('info', 'title', cand.id, `"${cls.get(cand.id).label.replace(/\n/g, ' ')}" is the diagram name`);
      const tb = cand.box;
      const s2 = of('text').find((c) => c !== cand && c.box.y >= tb.y + tb.h - 6 && c.box.y <= tb.y + tb.h + 40 && Math.abs(c.box.x - tb.x) < 40 && cls.get(c.id).label.length < 200);
      cls.set(cand.id, { t: 'used' });
      if (s2) { sub = cls.get(s2.id).label.replace(/\n/g, ' '); cls.set(s2.id, { t: 'used' }); add('info', 'subtitle', s2.id, `"${sub}" opens the description`); }
    }
  }
  name = name || (page.name && !/^Page-\d+$/.test(page.name) ? page.name : 'Imported draw.io diagram');

  // ---- badges: a badge with text beside it carries that step's text; if the same number also sits in
  // the drawing, the one beside the text is a legend entry (a description column) and is not drawn
  const stepText = new Map();
  const setText = (n, t, el) => {
    let txt = t.replace(/\s*\n\s*/g, ' ').trim();
    if (!txt) return;
    if (txt.length > 400) { const cut = txt.slice(0, 397); txt = (cut.slice(0, cut.lastIndexOf(' ') > 300 ? cut.lastIndexOf(' ') : 397)).replace(/[,;:]$/, '') + '...'; add('warn', 'step-text-long', el, `step ${n} text is longer than 400 characters; shortened`); }
    if (!stepText.has(String(n))) stepText.set(String(n), txt);
  };
  const badges = of('badge');
  const nums = new Map();
  for (const b of badges) { const n = String(cls.get(b.id).n); nums.set(n, (nums.get(n) || 0) + 1); }
  for (const b of badges) {
    const k = cls.get(b.id);
    if (k.text) { setText(k.n, k.text, b.id); continue; }
    const bc = center(b.box);
    const beside = of('text').filter((t) => cls.get(t.id).t === 'text' && t.box.x >= b.box.x + b.box.w - 6 && t.box.x <= b.box.x + b.box.w + 40 && bc.y >= t.box.y - 4 && bc.y <= t.box.y + Math.max(t.box.h, 20) + 4)
      .sort((p, q) => p.box.x - q.box.x)[0];
    if (!beside || beside.props.prism_kind) continue;
    const legend = nums.get(String(k.n)) > 1;
    if (!legend && cls.get(beside.id).label.length < 40) continue;   // a short caption beside a badge stays a caption
    setText(k.n, cls.get(beside.id).label, beside.id);
    cls.set(beside.id, { t: 'used' });
    if (nums.get(String(k.n)) > 1) { cls.set(b.id, { t: 'used' }); nums.set(String(k.n), nums.get(String(k.n)) - 1); add('info', 'step-legend', b.id, `badge ${k.n} with its text is a legend entry: the text became step ${k.n}`); }
  }
  // a text block of numbered lines (a legend) gives the step texts of the badges in the drawing
  const badgeNums = new Set(badges.filter((b) => cls.get(b.id).t === 'badge').map((b) => String(cls.get(b.id).n)));
  for (const t of [...of('text'), ...of('steplist')]) {
    const k = cls.get(t.id), rows = k.label.split('\n').map((l) => /^\s*(\d{1,2})[.):]?\s+(\S.*)$/.exec(l)).filter(Boolean);
    if (rows.length < 2 || (k.t === 'text' && rows.filter((r) => badgeNums.has(r[1])).length < 2)) continue;
    for (const r of rows) setText(r[1], r[2], t.id);
    cls.set(t.id, { t: 'used' });
    add('info', 'step-legend', t.id, `numbered lines ${rows.map((r) => r[1]).join(', ')} became step texts`);
  }

  // ---- shapes: containers (or anything enclosing kept content) become frames, the rest boxes or dropped
  const kept = () => model.live.filter((c) => c.box && ['node', 'badge', 'text', 'shape', 'image', 'group'].includes(cls.get(c.id)?.t));
  for (const c of of('shape').sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)) {
    const k = cls.get(c.id);
    const kids = model.live.some((x) => x.parent === c.id && x.vertex && cls.get(x.id)?.t !== 'used');
    const encloses = kept().some((x) => x !== c && cls.get(x.id).t !== 'shape' && boxIn(x.box, c.box, 0) && x.box.w * x.box.h * 2 < c.box.w * c.box.h)
      || kept().some((x) => x !== c && cls.get(x.id).t === 'shape' && cls.get(x.id).frame && boxIn(x.box, c.box, 0) && x.box.w * x.box.h < c.box.w * c.box.h);
    if (!k.forced && (k.container || kids || encloses) && !k.note) {
      const kind = plainGroupKind(k.label, c.style);
      const g = { t: 'group', kind, label: k.label.split('\n')[0] };
      if (kind === 'gen') {
        const tone = toneOf(k.stroke) || (isNone(k.stroke) ? toneOf(k.fill, { fill: true }) : null);
        if (tone) g.tone = tone;
        if (!isNone(k.fill) && !isWhite(k.fill)) g.fill = true;
        g.dashed = k.dashed;
      }
      cls.set(c.id, g); k.frame = true;
      continue;
    }
    if (!k.label && !connected.has(c.id)) { cls.set(c.id, { t: 'used' }); add('info', 'shape-dropped', c.id, 'an unlabeled shape with nothing inside it was dropped'); }
  }
  for (const c of of('image')) {
    const k = cls.get(c.id);
    if (k.label) { cls.set(c.id, { t: 'shape', shape: 'box', label: k.label }); add('info', 'image', c.id, `image "${k.label.replace(/\n/g, ' ')}" drawn as a box`); }
    else { cls.set(c.id, { t: 'used' }); add('info', 'image', c.id, 'an unlabeled image was dropped (no AWS icon, no label)'); }
  }
  for (const c of of('deco')) { add('info', 'shape-dropped', c.id, `decoration ${cls.get(c.id).what} dropped`); cls.set(c.id, { t: 'used' }); }

  // ---- ids
  const ids = new Set();
  const slug = (s, max = 22) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
  const uid = (pref, base) => { let id = base && /^[A-Za-z0-9_-]+$/.test(base) ? base : pref; let i = 2; const b0 = id; while (ids.has(id)) id = `${b0}-${i++}`; ids.add(id); return id; };
  const nodeId = (c, k) => {
    if (c.props.prism_id) return uid('n', c.props.prism_id);
    if (/^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(c.id) && !/\d{3}/.test(c.id)) return uid('n', c.id);
    const info = k.icon && iconInfo(k.icon);
    return uid('n', slug(k.label && k.label.length <= 30 ? k.label : info ? (info.short || info.name).replace(/^(Amazon|AWS)\s+/, '') : k.label) || 'n');
  };

  // ---- elements
  const G = [], N = [], NOTES = [], FREE = [], MARKS = [], LEGEND = [], TABLES = [];
  const groupsSrc = model.live.filter((c) => cls.get(c.id)?.t === 'group').sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  for (const c of groupsSrc) {
    const k = cls.get(c.id);
    const label = (k.label || '').replace(/\n/g, ' ').trim();
    const g = { kind: k.kind };
    if (c.props.prism_id) g.id = uid('g', c.props.prism_id);
    const deflt = GROUP_LABEL[k.kind] || '';
    if (label && label.toLowerCase() !== deflt.toLowerCase()) g.label = label;
    else if (!label && deflt && k.kind !== 'gen' && c.style.shape == null && !c.style.grIcon && k.kind !== 'cloud') { /* a plain AZ or SG frame without text: kit default label */ }
    if (k.icon) g.icon = k.icon;
    if (k.tone) g.tone = k.tone;
    if (k.fill) g.fill = true;
    if (k.kind === 'gen' && k.dashed === false && !k.icon) g.dashed = false;
    G.push({ c, g, box: c.box });
  }
  // nesting: the smallest earlier frame that holds this one (draw order is outer first)
  G.forEach((x, i) => {
    let best = null;
    for (let j = 0; j < G.length; j++) if (j !== i && boxIn(x.box, G[j].box, 2) && G[j].box.w * G[j].box.h > x.box.w * x.box.h && (best == null || G[j].box.w * G[j].box.h < G[best].box.w * G[best].box.h)) best = j;
    x.parent = best;
  });
  G.forEach((x) => { x.anc = []; for (let p = x.parent, d = 0; p != null && d < 32; p = G[p].parent, d++) x.anc.push(p); });
  const groupsOf = (p) => G.map((g, i) => (inside(p, g.box) ? i : -1)).filter((i) => i >= 0);

  for (const c of model.live) {
    const k = cls.get(c.id);
    if (!k || !c.box) continue;
    if (k.t === 'node') {
      const n = { id: nodeId(c, k), icon: k.icon };
      const label = c.props.prism_sub ? k.label.replace(new RegExp(`\\n?${c.props.prism_sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '') : k.label;
      if (label) n.label = label.replace(/\n/g, ' ');
      if (k.sub || c.props.prism_sub) n.sub = c.props.prism_sub || k.sub;
      if (k.labelPos && k.labelPos !== 'b') n.labelPos = k.labelPos;
      if (k.wrap) n.wrap = k.wrap;
      else if (n.label && wrap(n.label, 14).length > 2) { let w = 15; while (w < 24 && wrap(n.label, w).length > 2) w++; n.wrap = w; }
      N.push({ c, n, src: c.box });
    } else if (k.t === 'shape') {
      const n = { id: nodeId(c, k), kind: k.shape === 'pill' ? 'pill' : 'box' };
      if (k.label) n.label = k.label.replace(/\n/g, ' ');
      const tone = toneOf(k.stroke); if (tone) n.tone = tone;
      N.push({ c, n, src: c.box, isBox: true });
    } else if (k.t === 'text') {
      // CIDR or a short right-aligned text on a frame's top band: that frame's note
      const host = G.map((g, i) => [g, i]).filter(([g]) => c.box.x >= g.box.x - 2 && c.box.x + c.box.w <= g.box.x + g.box.w + 4 && c.box.y >= g.box.y - 4 && c.box.y + c.box.h <= g.box.y + (k.gnote ? 48 : 30))
        .sort((a, b) => a[0].box.w * a[0].box.h - b[0].box.w * b[0].box.h)[0];
      if (host && !host[0].g.note && (k.gnote || (!k.prism && (/^[\d./:a-f]+(\s*\(.*\))?$/i.test(k.label) || (k.align === 'right' && k.label.length <= 24)) && !k.label.includes('\n')))) { const ln = k.label.split('\n').map((x) => x.trim()).filter(Boolean); host[0].g.note = k.gnote && ln.length > 1 ? ln.slice(0, 2) : k.label; continue; }
      if (k.note && typeof k.note === 'object' && k.note.text) {
        // a note Prism exported: its own fields, the place from the drawing
        const nt = pick(k.note, ['text', 'kind', 'anchor', 'tone', 'size', 'weight', 'caps']);
        const m = noteMetrics(nt), a = nt.anchor || 'middle';
        NOTES.push({ c, nt, ax: a === 'start' ? c.box.x + 4 : a === 'end' ? c.box.x + c.box.w - 4 : c.box.x + c.box.w / 2, ay: c.box.y + 2 + 0.22 * m.size + m.h / 2 });
        continue;
      }
      const nt = { text: k.label };
      if (k.bold && k.size >= 12) { nt.kind = 'label'; if (k.size >= 14) nt.weight = 'bold'; }
      const tone = toneOf(k.color);
      if (tone === 'security' && !nt.kind) nt.kind = 'warn';
      nt.anchor = k.align === 'left' ? 'start' : k.align === 'right' ? 'end' : 'middle';
      // wrap long lines where draw.io wraps them (whiteSpace=wrap): about the characters its box holds
      const m0 = noteMetrics(nt);
      const maxCh = k.wraps ? Math.max(18, Math.floor(c.box.w / (k.size * 0.55))) : Infinity;
      const lines = k.label.split('\n').flatMap((l) => (l.length > maxCh ? wrap(l, maxCh) : [l]));
      if (lines.length > k.label.split('\n').length) add('info', 'text-wrapped', c.id, `text "${k.label.slice(0, 30)}..." wrapped to ${lines.length} lines`);
      if (lines.length > 12) add('warn', 'text-long', c.id, `text "${k.label.slice(0, 30)}..." runs to ${lines.length} lines; consider moving it to the description`);
      nt.text = lines.join('\n');
      const ax = nt.anchor === 'start' ? c.box.x : nt.anchor === 'end' ? c.box.x + c.box.w : c.box.x + c.box.w / 2;
      const ay = k.valign === 'top' ? c.box.y + m0.size * 0.7 + noteMetrics(nt).h / 2 : k.valign === 'bottom' ? c.box.y + c.box.h - noteMetrics(nt).h / 2 : c.box.y + c.box.h / 2;
      NOTES.push({ c, nt, ax, ay });
    } else if (k.t === 'badge') {
      FREE.push({ c, n: k.n, at: center(c.box) });
    } else if (k.t === 'mark') {
      MARKS.push({ c, kind: k.kind, on: k.on, at: center(c.box) });
    } else if (k.t === 'table') {
      TABLES.push({ c, data: k.data, ax: c.box.x, ay: c.box.y });
    } else if (k.t === 'legend') {
      // a legend Prism exported: the kit draws it again from its items, at the same place in the layout
      const items = Array.isArray(k.data.items) ? k.data.items.filter((it) => it && typeof it.kind === 'string') : null;
      LEGEND.push({ c, items, row: k.data.row === true, ax: c.box.x + 2, ay: c.box.y + 10 });
    }
  }

  // ---- edges (source geometry): ends, waypoints, label, style
  const nodeOf = new Map(N.map((x) => [x.c.id, x]));
  const groupOf = new Map(G.map((x, i) => [x.c.id, i]));
  const labelKids = new Map();
  for (const c of model.live) { const k = cls.get(c.id); if (k && k.t === 'edgelabel' && k.edge && k.label) (labelKids.get(k.edge) || labelKids.set(k.edge, []).get(k.edge)).push(c); }
  const W = [];
  const wids = new Set();
  edges.forEach((e, i) => {
    const s = e.style, off = model.abs(e.parent);
    const wps = (e.geo ? e.geo.points : []).map((p) => ({ x: p.x + off.x, y: p.y + off.y }));
    const end = (cellId, pt, which) => {
      if (cellId && nodeOf.has(cellId)) return { node: nodeOf.get(cellId) };
      if (cellId && groupOf.has(cellId)) { add('info', 'edge-group', e.id, `edge ${which === 's' ? 'starts' : 'ends'} on the frame "${G[groupOf.get(cellId)].g.label || G[groupOf.get(cellId)].g.kind}"; drawn to its border`); return { group: groupOf.get(cellId) }; }
      const cell = cellId && model.cells.get(cellId);
      if (cell && cell.box) return { pt: center(cell.box), lost: true };
      if (pt) return { pt: { x: pt.x + off.x, y: pt.y + off.y } };
      return null;
    };
    let a = end(e.source, e.geo && e.geo.sp, 's'), b = end(e.target, e.geo && e.geo.tp, 't');
    if (!a || !b) { add('warn', 'edge-dangling', e.id, 'edge without a resolvable end; dropped'); return; }
    if (a.node && b.node && a.node === b.node) { add('info', 'edge-self', e.id, 'a self-loop has no kit form; dropped'); return; }
    const startA = !isNone(s.startArrow) && s.startArrow != null, endA = s.endArrow == null ? true : !isNone(s.endArrow);
    let reverse = false;
    if (!endA && startA) { [a, b] = [b, a]; reverse = true; wps.reverse(); }
    const cons = (p) => (s[p + 'X'] != null && s[p + 'Y'] != null ? { x: clamp(num(s[p + 'X']), 0, 1), y: clamp(num(s[p + 'Y']), 0, 1) } : null);
    const exit = reverse ? cons('entry') : cons('exit'), entry = reverse ? cons('exit') : cons('entry');
    const w = { c: e, a, b, wps, exit, entry, reverse };
    let wid = e.props.prism_id || (/^[A-Za-z][A-Za-z0-9_-]{0,11}$/.test(e.id) && !/\d{3}/.test(e.id) ? e.id : `w${i + 1}`);
    while (wids.has(wid)) wid += 'x';
    wids.add(wid); w.id = wid;
    const opt = {};
    if (s.dashed === '1') opt.dashed = true;
    if (s.flowAnimation === '1') opt.flow = true;
    if (startA && endA) opt.both = true;
    if (!startA && !endA) opt.arrow = false;
    const col = hexOf(s.strokeColor);
    if (isRed(col)) opt.hot = true;
    else if (col && !['#545B64', '#808080', '#000000', '#232F3E', '#232F3D', '#666666', '#333333', '#879196', '#7D8998', '#5A6C86', '#16191F'].includes(col)) {
      const t = toneOf(col);
      if (t === 'compute') opt.tone = 'request';
      else if (col && hsl(col)[1] > 0.3 && hsl(col)[0] > 190 && hsl(col)[0] < 230) opt.tone = 'response';
      else if (hsl(col)[1] < 0.15) opt.tone = 'muted';
      else add('info', 'edge-color', e.id, `edge color ${col} has no kit tone; drawn in the wire color`);
    }
    if (s.curved === '1') add('info', 'edge-curved', e.id, 'a curved edge is drawn orthogonal');
    if ((s.edgeStyle === 'none' || !s.edgeStyle) && !wps.length) {
      const pa = a.node ? center(a.node.src) : a.pt, pb = b.node ? center(b.node.src) : b.pt;
      if (pa && pb && Math.abs(pa.x - pb.x) > 4 && Math.abs(pa.y - pb.y) > 4) add('info', 'edge-diagonal', e.id, 'a straight diagonal edge gets an elbow (kit wires run H and V)');
    }
    if (a.lost || b.lost) add('info', 'edge-floating', e.id, 'an edge end on a dropped shape is drawn as a free end');
    // label: the edge value or edgeLabel children (relative geometry: x from -1 at the source to 1, y beside)
    const kids = labelKids.get(e.id) || [];
    let text = labelOf(e), rel = e.geo && e.geo.rel && text ? { x: e.geo.x, y: e.geo.y + (e.geo.offset ? e.geo.offset.y : 0) } : null;
    if (!text && kids.length) {
      const k0 = kids[0];
      text = cls.get(k0.id).label; rel = k0.geo ? { x: k0.geo.x, y: k0.geo.y + (k0.geo.offset ? k0.geo.offset.y : 0) } : { x: 0, y: 0 };
      if (kids.length > 1) add('info', 'edge-labels', e.id, `${kids.length} labels on one edge; kept "${text.replace(/\n/g, ' ')}"`);
    }
    if (text) {
      const lines = text.split('\n').flatMap((l) => (l.length > 24 ? wrap(l, 22) : [l]));
      w.label = { text: lines.join('\n'), at: clamp(((rel ? rel.x : 0) + 1) / 2, 0.1, 0.9), side: rel ? Math.sign(rel.y) : 0 };
      if (reverse) { w.label.at = 1 - w.label.at; w.label.side = -w.label.side; }
    }
    w.opt = opt;
    W.push(w);
  });

  // ---- badges on wires (source geometry), so the layout keeps them with their wire
  const srcPoly = (w) => {
    const p = (e) => (e.node ? center(e.node.src) : e.group != null ? center(G[e.group].box) : e.pt);
    const seq = [p(w.a), ...w.wps, p(w.b)].map((q) => [q.x, q.y]);
    const out = [seq[0]];
    for (let i = 1; i < seq.length; i++) { const a = out[out.length - 1], b = seq[i]; if (a[0] !== b[0] && a[1] !== b[1]) out.push([b[0], a[1]]); out.push(b); }
    return out;
  };
  const onWire = [];
  for (const fb of FREE) {
    let best = null;
    for (const w of W) { const r = nearest(fb.at, srcPoly(w)); if (!best || r.d < best.r.d) best = { w, r }; }
    const reach = Math.max(28, (fb.c.box.w + fb.c.box.h) / 2 + 16);
    if (best && best.r.d <= reach) onWire.push({ n: fb.n, w: best.w, f: clamp(best.r.f, 0.12, 0.88), side: best.r.side || -1, c: fb.c });
    else { fb.free = true; if (best && best.r.d <= reach * 3) { fb.near = best.w; } }
  }

  // ---- layout elements
  const iconSizes = N.filter((x) => !x.isBox).map((x) => Math.max(x.src.w, x.src.h)).sort((a, b) => a - b);
  const median = iconSizes.length ? iconSizes[Math.floor(iconSizes.length / 2)] : 0;
  const els = [];
  G.forEach((x, i) => {
    const g = x.g, label = g.label != null ? g.label : GROUP_LABEL[g.kind] || '';
    const hasIcon = typeof g.icon === 'string' || (g.icon !== false && !ICONLESS.has(g.kind));
    x.header = !!label || hasIcon;
    const lw = label ? textWidth(label, 10) : 0;
    x.labelEnd = (hasIcon ? 25 : 6) + lw + 6;
    const nw = g.note ? Math.max(...[].concat(g.note).map((l) => textWidth(l, 9))) + 12 : 0;
    x.noteW = nw; x.centered = ICONLESS.has(g.kind) && !hasIcon && g.align !== 'left';
    x.minW = Math.max(60, (ICONLESS.has(g.kind) && !hasIcon ? lw + 24 : x.labelEnd) + nw + 6);
    if (x.header && !(ICONLESS.has(g.kind) && !hasIcon)) els.push({ kind: 'head', g: i, groups: [], ext: () => ({ l: 0, r: x.labelEnd, u: 0, d: 19, core: 0 }) });
    if (g.note) els.push({ kind: 'gnote', g: i, groups: [], ext: () => ({ l: nw, r: 0, u: 0, d: 19, core: 0 }) });
  });
  const Mg = G.map((x) => ({ box: x.box, header: x.header, minW: x.minW, parent: x.parent, anc: x.anc, labelEnd: x.labelEnd, noteW: x.noteW, centered: x.centered }));
  N.forEach((x) => {
    const c = center(x.src);
    x.el = els.length;
    els.push({ kind: x.isBox ? 'box' : 'node', ax: c.x, ay: c.y, snap: true, groups: groupsOf(c), ext: (S, s) => {
      if (x.isBox) { const z = boxSize(x.n.label, x.src.w * s, x.src.h * s); x.size = z; return { l: z.w / 2, r: z.w / 2, u: z.h / 2, d: z.h / 2, core: z.h / 2 }; }
      return nodeExt(x.n, S);
    } });
  });
  NOTES.forEach((x) => {
    x.el = els.length;
    els.push({ kind: 'note', ax: x.ax, ay: x.ay, snap: false, groups: groupsOf({ x: x.ax, y: x.ay }), ext: () => {
      const m = noteMetrics(x.nt), a = x.nt.anchor;
      return { l: a === 'start' ? 0 : a === 'end' ? m.w : m.w / 2, r: a === 'start' ? m.w : a === 'end' ? 0 : m.w / 2, u: m.h / 2 + 1, d: m.h / 2 + 1, core: 0 };
    } });
  });
  const LEGEND_NAMES = { pk: 'Request', 'pk-2': 'Response', 'pk-bad': 'Failed or blocked', wire: 'Call or data path', dashed: 'Asynchronous or optional', blocked: 'Blocked' };
  LEGEND.slice(0, 1).forEach((x) => {
    x.el = els.length;
    const labels = (x.items || [{ kind: 'pk' }, { kind: 'pk-2' }]).map((it) => it.label || LEGEND_NAMES[it.kind] || '');
    const w = x.row ? labels.reduce((a, l) => a + 27 + textWidth(l, 8.5), 0) : 13 + Math.max(0, ...labels.map((l) => textWidth(l, 8.5)));
    const h = x.row ? 10 : 13 * labels.length;
    els.push({ kind: 'note', ax: x.ax, ay: x.ay, snap: false, groups: groupsOf({ x: x.ax, y: x.ay }), ext: () => ({ l: 2, r: w, u: 9, d: h - 6, core: 0 }) });
  });
  // a table keeps its size (the kit's own) and moves with the layout from its top-left corner
  TABLES.forEach((x) => {
    x.el = els.length;
    let size = { W: 0, H: 0 }; try { size = tableSize({ ...x.data, x: 0, y: 0 }); } catch { /* malformed: placed as a point */ }
    els.push({ kind: 'note', ax: x.ax, ay: x.ay, snap: false, groups: groupsOf({ x: x.ax, y: x.ay }), ext: () => ({ l: 0, r: size.W, u: 0, d: size.H, core: 0 }) });
  });
  FREE.filter((b) => b.free).forEach((b) => { b.el = els.length; els.push({ kind: 'badge', ax: b.at.x, ay: b.at.y, snap: false, groups: groupsOf(b.at), ext: () => ({ l: 8, r: 8, u: 8, d: 8, core: 8 }) }); });
  const pts = W.flatMap((w) => [...w.wps, ...[w.a, w.b].filter((e) => e.pt).map((e) => e.pt)]);
  const segs = W.map((w) => ({ pts: srcPoly(w), ends: new Set([w.a, w.b].filter((e) => e.node).map((e) => e.node.el)) }));
  const all = [...G.map((x) => x.box), ...N.map((x) => x.src), ...NOTES.map((x) => ({ x: x.ax, y: x.ay, w: 0, h: 0 })), ...FREE.filter((b) => b.free).map((b) => b.c.box), ...pts.map((p) => ({ ...p, w: 0, h: 0 }))];
  if (!all.length) throw new Error('the page has nothing to import (no shapes, icons or text)');
  const M = {
    minX: Math.min(...all.map((b) => b.x)), minY: Math.min(...all.map((b) => b.y)),
    groups: Mg, els, points: pts, segs,
    snapX: [...N.map((x) => center(x.src).x), ...W.flatMap((w) => w.wps.map((p) => p.x))],
    snapY: [...N.map((x) => center(x.src).y), ...W.flatMap((w) => w.wps.map((p) => p.y))],
  };
  // mark waypoint coordinates for snapping (layout() snaps M.snapX/snapY values only)
  for (const e of els) if (e.kind === 'node' || e.kind === 'box') e.snap = true;

  // ---- scale and tile: the smallest tile the stretched layout fits, at the largest scale that fits it
  const base = median ? 40 / median : (N.length ? 36 / Math.max(...N.map((x) => x.src.h)) : 0.6);
  const mults = [1.2, 1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.42, 0.35, 0.28];
  const tries = [];
  for (const S of [40, 32]) for (const m of mults) tries.push(layout(M, base * m * (S / 40), S));
  const fits = (L, [tw, th]) => L.W <= tw && L.H <= th;
  let order;
  if (opts.width) {
    const t = opts.width <= 480 ? 'normal' : opts.width <= 960 ? 'wide' : 'full';
    const lim = [opts.width, TILES[t][1]];
    order = [[t, tries.filter((L) => fits(L, lim))], [t, tries.filter((L) => L.W <= opts.width)]];
  } else order = Object.entries(TILES).map(([t, lim]) => [t, tries.filter((L) => fits(L, lim))]);
  const cands = [];
  for (const [t, Ls] of order) {
    const best = Ls.filter((L) => L.S === 40).sort((a, b) => b.s - a.s)[0] || Ls.sort((a, b) => b.s - a.s)[0];
    if (best && !cands.some((c) => c.L === best)) cands.push({ tile: t, L: best });
  }
  if (!cands.length) {
    const L = tries.sort((a, b) => a.W * a.H - b.W * b.H)[0];
    cands.push({ tile: 'full', L });
    add('warn', 'tile-size', null, `the layout needs ${L.W}x${L.H}, more than a full tile (1400x900); the gallery will shrink it`);
  }

  // ---- build a spec per candidate (smallest tile first) and keep the first that lints clean
  let best = null;
  for (const cand of cands.slice(0, 3)) {
    const sub2 = [];
    const built = build(cand, sub2);
    // a lint error, or a wire label dropped to avoid one, counts against this tile
    const errs = lint(built.spec).filter((f) => f.severity === 'error').length * 1000 + sub2.filter((i) => i[1] === 'label-dropped').length * 100;
    if (!best || errs < best.errs) best = { ...built, errs, tile: cand.tile, sub: sub2, s: cand.L.s };
    if (!errs) break;
  }
  for (const i of best.sub) add(...i);
  return { spec: best.spec, scale: best.s, tile: best.tile };

  // a spec at one layout: place, route, story, lint loop
  function build({ tile, L }, local) {
    const ladd = (...a) => local.push(a);
    const [tw, th] = TILES[tile];
    const width = opts.width || (tile === 'full' ? Math.max(L.W, 961) : tw);
    const dxc = tile === 'full' && !opts.width ? 0 : Math.max(0, Math.floor((width - L.W) / 2));
    const P = (x, y, snap) => { const [a, b] = L.place(x, y, snap); return [a + dxc, b]; };
    const spec = { id: diagramId(opts, page, name, ladd), name };
    if (tile === 'wide') spec.wide = true;
    if (tile === 'full') spec.full = true;
    spec.w = tile === 'full' && !opts.width ? L.W : width; spec.h = L.H;
    spec.dur = 6;
    spec.groups = G.map((x, i) => { const b = L.group(i); return { ...x.g, x: b.x + dxc, y: b.y, w: b.w, h: b.h }; });
    const S = L.S;
    const nodes = N.map((x) => {
      const [cx, cy] = L.at(x.el), n = { ...x.n };
      if (x.isBox) { const z = boxSize(n.label, x.src.w * L.s, x.src.h * L.s); n.x = cx + dxc - r1(z.w / 2); n.y = cy - r1(z.h / 2); n.w = z.w; n.h = z.h; }
      else { n.x = cx + dxc - S / 2; n.y = cy - S / 2; if (S !== 40) n.size = S; }
      return n;
    });
    spec.nodes = nodes.map((n) => ({ id: n.id, ...(n.kind ? { kind: n.kind } : { icon: n.icon }), x: n.x, y: n.y, ...(n.size ? { size: n.size } : {}), ...(n.kind ? { w: n.w, h: n.h } : {}), ...pick(n, ['label', 'wrap', 'sub', 'labelPos', 'tone']) }));
    const byCell = new Map(N.map((x, i) => [x.c.id, spec.nodes[i]]));
    const boxOfNode = (n) => ({ x: n.x, y: n.y, w: n.kind ? n.w : n.size || 40, h: n.kind ? n.h : n.size || 40 });
    // wires
    const wireEnds = new Map();
    spec.wires = [];
    for (const w of W) {
      const endOf = (e, cons) => {
        if (e.node) {
          const n = byCell.get(e.node.c.id), B = boxOfNode(n), c = [B.x + B.w / 2, B.y + B.h / 2];
          let port = null, side = null;
          if (cons && (cons.x === 0 || cons.x === 1)) { port = [B.x + cons.x * B.w, B.y + cons.y * B.h]; side = 'h'; }
          else if (cons && (cons.y === 0 || cons.y === 1)) { port = [B.x + cons.x * B.w, B.y + cons.y * B.h]; side = 'v'; }
          return { node: n, box: B, c, port, side };
        }
        if (e.group != null) return { frame: spec.groups[e.group] };
        return { pt: P(e.pt.x, e.pt.y, true) };
      };
      const A = endOf(w.a, w.exit), B = endOf(w.b, w.entry);
      const wps = w.wps.map((p) => P(p.x, p.y, true));
      const out = { id: w.id };
      if (A.node && B.node && !wps.length && !A.port && !B.port) { out.from = A.node.id; out.to = B.node.id; }
      else {
        // frame ends: the border side facing the neighbouring point
        if (A.frame) { const nb = wps[0] || (B.node ? B.c : B.pt || [B.frame.x + B.frame.w / 2, B.frame.y + B.frame.h / 2]); A.pt = onFrame(A.frame, nb); }
        if (B.frame) { const nb = wps[wps.length - 1] || (A.node ? A.c : A.pt); B.pt = onFrame(B.frame, nb); }
        const pts = routePath(A, wps, B);
        if (!pts) { ladd('warn', 'edge-degenerate', w.c.id, 'an edge collapsed to a point after layout; dropped'); continue; }
        out.d = mhv(pts);
      }
      Object.assign(out, w.opt);
      spec.wires.push(out);
      wireEnds.set(w.id, { from: A.node ? A.node.id : null, to: B.node ? B.node.id : null, w });
    }
    // labels on the rendered paths
    let paths = wirePaths(spec);
    for (const out of spec.wires) {
      const w = wireEnds.get(out.id).w;
      if (!w.label) continue;
      out.label = w.label.text;
      const lines = w.label.text.split('\n').length;
      if (Math.abs(w.label.at - 0.5) > 0.02) out.labelAt = r3(w.label.at);
      Object.assign(out, labelSpot(paths[out.id], w.label.at, w.label.side, lines));
    }
    // notes and free badges
    spec.notes = NOTES.map((x) => {
      const [ax, ay] = L.at(x.el), m = noteMetrics(x.nt);
      return { x: ax + dxc, y: r1(ay - (m.h / 2) + 0.68 * m.size), ...x.nt };
    });
    // steps and timeline
    spec.steps = []; spec.timeline = [];
    const hops = [];
    const live = (id) => spec.wires.some((x) => x.id === id);
    const sorted = [...onWire.filter((b) => live(b.w.id)), ...FREE.filter((b) => b.free && b.near && live(b.near.id)).map((b) => ({ n: b.n, w: b.near, free: true }))]
      .sort((p, q) => Number(p.n) - Number(q.n) || String(p.n).localeCompare(String(q.n)));
    if (sorted.length) {
      for (const b of sorted) {
        const ends = wireEnds.get(b.w.id), pth = paths[b.w.id];
        const ring = ends.to || ringNear(spec, pth);
        if (b.free) { hops.push({ wire: b.w.id, ring: ring || undefined, step: false }); continue; }
        const first = !hops.some((h) => h.step != null && String(h.step) === String(b.n));
        hops.push({ wire: b.w.id, ring: ring || undefined, step: b.n, f: r3(b.f), ...badgeSpot(pth, b.f, b.side), ...(first && stepText.has(String(b.n)) ? { text: stepText.get(String(b.n)) } : {}) });
      }
      if (opts.story !== 'none') ladd('info', 'story-badges', null, `story from the numbered badges: ${sorted.map((b) => `${b.n} on ${b.w.id}`).join(', ')}`);
    }
    const free = FREE.filter((b) => b.free);
    if (opts.story === 'none') {
      spec.steps = hops.filter((h) => h.step !== false).map((h) => ({ n: h.step, at: h.wire, f: h.f, ...pick(h, ['dx', 'dy', 'text']) }));
    } else if (hops.length) {
      const st = story(hops.map((h) => ({ ...h, ring: h.ring || undefined })));
      spec.timeline = st.timeline; spec.steps = st.steps;
    } else if (!free.length) {
      const bfs = bfsHops(spec, wireEnds);
      if (bfs.hops.length) {
        const st = story(bfs.hops);
        spec.timeline = st.timeline; spec.steps = st.steps;
        ladd('info', 'story-bfs', null, `no numbered badges: story guessed by a walk from ${bfs.start} over ${bfs.hops.length} wire(s): ${bfs.hops.map((h) => h.wire).join(' > ')}${bfs.skipped ? `; ${bfs.skipped} wire(s) off the path` : ''}`);
      } else ladd('info', 'story-none', null, 'no badges and no connected wires: no timeline');
    }
    for (const b of free) {
      const [x, y] = L.at(b.el);
      spec.steps.push({ n: b.n, x: x + dxc, y, ...(stepText.has(String(b.n)) ? { text: stepText.get(String(b.n)) } : {}) });
      ladd('info', 'step-free', b.c.id, `badge ${b.n} is not on a wire; kept in place${b.near && spec.timeline && spec.timeline.length ? `, its packet runs on the nearest wire ${b.near.id}` : ' without a packet'}`);
    }
    // marks (on a node or a wire by id when it still exists, else where they were) and the legend
    const live2 = new Set([...(spec.nodes || []).map((n) => n.id), ...(spec.wires || []).map((w) => w.id)]);
    const marks = MARKS.map((m) => (m.on && live2.has(m.on) ? { on: m.on, ...(m.kind === 'ok' ? { kind: 'ok' } : {}) } : { x: P(m.at.x, m.at.y, false)[0], y: P(m.at.x, m.at.y, false)[1], ...(m.kind === 'ok' ? { kind: 'ok' } : {}) }));
    if (marks.length) spec.marks = marks;
    if (TABLES.length) spec.tables = TABLES.map((x) => { const [tx, ty] = L.at(x.el); return { ...x.data, x: Math.round((tx + dxc) * 100) / 100, y: Math.round(ty * 100) / 100 }; });
    if (LEGEND.length) { const x = LEGEND[0], [lx, ly] = L.at(x.el); spec.legend = { x: lx + dxc, y: ly, ...(x.row ? { row: true } : {}), ...(x.items ? { items: x.items.map((it) => pick(it, ['kind', 'label'])) } : {}) }; }
    // step texts with no badge in the drawing (a description column only)
    for (const [n, t] of stepText) if (!spec.steps.some((s) => String(s.n) === n)) ladd('info', 'step-text-orphan', null, `step ${n} text has no badge in the drawing: "${t.slice(0, 40)}"`);
    const hopsN = spec.timeline.length;
    if (hopsN > 7) spec.dur = Math.min(10, Math.round(hopsN * 0.8));
    spec.desc = describe(sub, spec, page, sorted.length ? 'badges' : spec.timeline.length ? 'bfs' : null);
    // the hidden prism layer of an edited export: its timeline, effects and timed notes where they still resolve
    if (meta) mergeMeta(spec, meta, ladd);
    tidySpec(spec);
    const fixed = lintLoop(spec, wireEnds, TILES[tile], ladd);
    return { spec: fixed };
  }
}

// the node nearest the end of a path (a floating edge that stops next to an icon)
function ringNear(spec, pts) {
  if (!pts || !pts.length) return null;
  const [x, y] = pts[pts.length - 1];
  const n = (spec.nodes || []).map((q) => { const w = q.kind ? q.w : q.size || 40, h = q.kind ? q.h : q.size || 40; return { q, d: Math.max(q.x - x, x - q.x - w, 0) + Math.max(q.y - y, y - q.y - h, 0) }; }).sort((a, b) => a.d - b.d)[0];
  return n && n.d <= 24 ? n.q.id : null;
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] != null && o[k] !== '').map((k) => [k, o[k]]));
function tidySpec(spec) { for (const k of ['groups', 'nodes', 'wires', 'steps', 'notes', 'timeline']) if (spec[k] && !spec[k].length) delete spec[k]; }

function diagramId(opts, page, name, add) {
  const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  if (opts.id) {
    if (/^[a-z][a-z0-9-]*$/.test(opts.id)) return opts.id;
    const s = slug(opts.id); const id = /^[a-z]/.test(s) ? s : 'dr-' + s;
    add('warn', 'id', null, `id ${JSON.stringify(opts.id)} is not kebab case; used ${id}`);
    return id;
  }
  const s = slug(name && name !== 'Imported draw.io diagram' ? name : page.name);
  return 'dr-' + (s || 'import');
}

function describe(sub, spec, page, how) {
  const n = (spec.nodes || []).length, g = (spec.groups || []).length;
  const first = sub ? sub.replace(/\.?$/, '.') : `Imported from draw.io${page.name && !/^Page-\d+$/.test(page.name) ? ` (${page.name})` : ''}: ${n} node${n === 1 ? '' : 's'}${g ? ` in ${g} frame${g === 1 ? '' : 's'}` : ''}.`;
  const nums = [...new Set((spec.steps || []).map((s) => String(s.n)))];
  const second = how === 'badges' ? `Packets follow the numbered steps${nums.length > 1 ? ` 1 to ${nums.length}` : ''}.` : how === 'bfs' ? 'Packets follow the request path from the users, in an order guessed from the wires.' : '';
  return [first, second].filter(Boolean).join(' ');
}

// a request story when the drawing numbers nothing: breadth first from the leftmost actor outside the frames
function bfsHops(spec, wireEnds) {
  const nodes = spec.nodes || [], byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map(), indeg = new Map();
  for (const [wid, e] of wireEnds) {
    if (!e.from || !e.to) continue;
    const w = spec.wires.find((x) => x.id === wid);
    (out.get(e.from) || out.set(e.from, []).get(e.from)).push({ wire: wid, to: e.to, reverse: false });
    indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
    if (w && w.both) (out.get(e.to) || out.set(e.to, []).get(e.to)).push({ wire: wid, to: e.from, reverse: true });
  }
  if (!out.size) return { hops: [] };
  const inFrame = (n) => (spec.groups || []).some((g) => n.x >= g.x && n.y >= g.y && n.x <= g.x + g.w && n.y <= g.y + g.h);
  const left = (a, b) => a.x - b.x || a.y - b.y;
  const actors = nodes.filter((n) => out.has(n.id) && ACTORS.has(n.icon)).sort((a, b) => Number(inFrame(a)) - Number(inFrame(b)) || left(a, b));
  const roots = nodes.filter((n) => out.has(n.id) && !indeg.get(n.id)).sort(left);
  const start = actors[0] || roots[0] || nodes.filter((n) => out.has(n.id)).sort(left)[0];
  const hops = [], seen = new Set([start.id]), used = new Set(), q = [start.id];
  while (q.length && hops.length < 12) {
    const u = q.shift();
    const next = (out.get(u) || []).filter((e) => !used.has(e.wire)).sort((a, b) => byId.get(a.to).y - byId.get(b.to).y || byId.get(a.to).x - byId.get(b.to).x);
    for (const e of next) {
      if (hops.length >= 12) break;
      used.add(e.wire);
      hops.push({ wire: e.wire, ring: e.to, ...(e.reverse ? { reverse: true } : {}) });
      if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); }
    }
  }
  const total = [...wireEnds.values()].filter((e) => e.from && e.to).length;
  return { hops, start: start.label ? `"${start.label}"` : start.id, skipped: total - used.size };
}

// ---------------------------------------------------------------- lint loop
// Lint the drawn markup; for each error, try the knobs of the elements it names (a wire label's place, a
// node label's side and wrap, a badge's place on its wire, a note's offset, a wire's route) and keep any
// change that lowers the count. Bounded rounds; what stays is reported.
// lint findings plus one soft rule of our own: badges closer than a badge apart read as one blot
function findings(spec) {
  const svg = diagram(spec), out = lint(spec);
  const b = [...svg.matchAll(/<g class="st" transform="translate\(([-\d.]+),([-\d.]+)\)"><circle r="7.5"\/><text y="3.2">([^<]*)<\/text>/g)].map((m) => [+m[1], +m[2], m[3]]);
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
    if (Math.hypot(b[i][0] - b[j][0], b[i][1] - b[j][1]) < 22) out.push({ severity: 'soft', code: 'badge-near', message: `badge ${b[i][2]} crowds badge ${b[j][2]}`, at: `${r1(b[i][0])},${r1(b[i][1])}` });
  }
  return out;
}
function score(spec) {
  let s = 0;
  for (const f of findings(spec)) s += f.severity === 'error' ? 1000 : f.code === 'header-band' || f.code === 'label-lines' ? 10 : f.severity === 'soft' ? 5 : 0;
  return s;
}
function textOwners(spec) {
  const own = [];
  const addL = (t, o) => { for (const l of String(t).split('\n')) own.push([l.trim().slice(0, 40), o]); };
  for (const n of spec.nodes || []) { if (n.label) for (const l of n.kind ? wrap(n.label, Math.max(8, Math.floor((n.w - 12) / 5.6))) : wrap(n.label, n.wrap || 14)) addL(l, { t: 'node', id: n.id }); if (n.sub) addL(n.sub, { t: 'node', id: n.id }); }
  for (const w of spec.wires || []) if (w.label) addL(w.label, { t: 'wlabel', id: w.id });
  (spec.notes || []).forEach((nt, i) => addL(nt.caps ? nt.text.toUpperCase() : nt.text, { t: 'note', i }));
  (spec.groups || []).forEach((g, i) => { addL(g.label != null ? g.label : GROUP_LABEL[g.kind] || '', { t: 'group', i }); if (g.note) addL([].concat(g.note).join('\n'), { t: 'gnote', i }); });
  return own;
}
function knobs(f, spec, ctx) {
  const out = [], seen = new Set();
  const push = (k) => { const key = JSON.stringify(k); if (!seen.has(key)) { seen.add(key); out.push(k); } };
  const owners = textOwners(spec);
  for (const m of f.message.matchAll(/text "([^"]*)"/g)) for (const [l, o] of owners) if (l === m[1]) push(o);
  for (const m of f.message.matchAll(/wire (\S+)/g)) { push({ t: 'route', id: m[1] }); if ((spec.wires || []).some((w) => w.id === m[1] && w.label)) push({ t: 'wlabel', id: m[1] }); }
  for (const m of f.message.matchAll(/badge (\S+)/g)) push({ t: 'badge', n: m[1] });
  for (const m of f.message.matchAll(/node (\S+)/g)) push({ t: 'node', id: m[1] });
  // an icon named by its id: the node whose icon center is closest to the finding
  const [ax, ay] = String(f.at || '').split(',').map(Number);
  for (const m of f.message.matchAll(/icon (\S+)/g)) {
    const cands = (spec.nodes || []).filter((n) => !n.kind && [].concat(n.icon).some((ic) => ('aws-' + m[1]).startsWith(ic)));
    const n = cands.sort((a, b) => Math.hypot(a.x - ax, a.y - ay) - Math.hypot(b.x - ax, b.y - ay))[0];
    if (n) push({ t: 'node', id: n.id });
  }
  if (f.code === 'off-canvas') push({ t: 'canvas' });
  return out;
}
function candidates(k, spec, ctx) {
  const C = [];
  const clone = () => structuredClone(spec);
  if (k.t === 'wlabel') {
    const w0 = spec.wires.find((w) => w.id === k.id); if (!w0) return C;
    const pts = ctx.paths()[k.id]; if (!pts) return C;
    const lines = String(w0.label).split('\n').length;
    for (const at of [w0.labelAt ?? 0.5, 0.5, 0.35, 0.65, 0.2, 0.8, 0.12, 0.88, 0.42, 0.58, 0.28, 0.72]) for (const side of [1, -1]) {
      const s2 = clone(), w = s2.wires.find((x) => x.id === k.id);
      delete w.labelAt; delete w.labelDx; delete w.labelDy; delete w.labelAnchor;
      if (Math.abs(at - 0.5) > 0.02) w.labelAt = r3(at);
      Object.assign(w, labelSpot(pts, at, side, lines));
      C.push(s2);
    }
  } else if (k.t === 'node') {
    const n0 = spec.nodes.find((n) => n.id === k.id); if (!n0 || n0.kind || !n0.label) return C;
    for (const pos of ['b', 'r', 'l', 't']) for (const wr of [n0.wrap, 14, 18, 24]) {
      const s2 = clone(), n = s2.nodes.find((x) => x.id === k.id);
      if (pos === 'b') delete n.labelPos; else n.labelPos = pos;
      if (!wr || wr === 14) delete n.wrap; else n.wrap = wr;
      C.push(s2);
    }
  } else if (k.t === 'badge') {
    const idx = (spec.steps || []).map((s, i) => [s, i]).filter(([s]) => String(s.n) === k.n);
    for (const [s0, i] of idx) {
      if (s0.at == null) { for (const [dx, dy] of [[0, -14], [0, 14], [-14, 0], [14, 0], [0, -24], [0, 24]]) { const s2 = clone(); s2.steps[i].x += dx; s2.steps[i].y += dy; C.push(s2); } continue; }
      const pts = ctx.paths()[s0.at]; if (!pts) continue;
      for (const f of [0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6, 0.12, 0.88, 0.25, 0.75, 0.06, 0.94]) for (const side of [-1, 1]) {
        const s2 = clone(), st = s2.steps[i];
        delete st.dx; delete st.dy; st.f = f;
        Object.assign(st, badgeSpot(pts, f, side));
        C.push(s2);
      }
    }
  } else if (k.t === 'note') {
    for (const [dx, dy] of [[0, -8], [0, 8], [0, -16], [0, 16], [-16, 0], [16, 0], [-32, 0], [32, 0], [0, -26], [0, 26]]) { const s2 = clone(); s2.notes[k.i].x += dx; s2.notes[k.i].y += dy; C.push(s2); }
  } else if (k.t === 'group') {
    for (const al of ['left', 'center']) { const s2 = clone(); s2.groups[k.i].align = al; C.push(s2); }
  } else if (k.t === 'route') {
    const ends = ctx.ends.get(k.id); const w0 = spec.wires.find((w) => w.id === k.id);
    if (!ends || !w0 || !ends.from || !ends.to) return C;
    const byId = new Map(spec.nodes.map((n) => [n.id, n]));
    const A = byId.get(ends.from), B = byId.get(ends.to);
    const bx = (n) => ({ x: n.x, y: n.y, w: n.kind ? n.w : n.size || 40, h: n.kind ? n.h : n.size || 40 });
    const a = bx(A), b = bx(B), ca = [a.x + a.w / 2, a.y + a.h / 2], cb = [b.x + b.w / 2, b.y + b.h / 2];
    const keep = (o) => { for (const key of ['d', 'from', 'to', 'via']) delete o[key]; };
    const asD = (pts) => { const s2 = clone(), w = s2.wires.find((x) => x.id === k.id); keep(w); w.d = mhv(pts); return s2; };
    // the kit's own route, with the elbow pinned at a few places
    { const s2 = clone(), w = s2.wires.find((x) => x.id === k.id); keep(w); w.from = A.id; w.to = B.id; C.push(s2); }
    const horiz = Math.abs(cb[0] - ca[0]) >= Math.abs(cb[1] - ca[1]);
    for (const t of [0.25, 0.4, 0.6, 0.75]) {
      const s2 = clone(), w = s2.wires.find((x) => x.id === k.id); keep(w); w.from = A.id; w.to = B.id;
      w.via = r1(horiz ? ca[0] + (cb[0] - ca[0]) * t : ca[1] + (cb[1] - ca[1]) * t); C.push(s2);
    }
    // L shapes: leave sideways and turn in, or leave downward/upward and turn in
    const r = routePath({ node: A, box: a, c: ca }, [[cb[0], ca[1]]], { node: B, box: b, c: cb }); if (r) C.push(asD(r));
    const r2 = routePath({ node: A, box: a, c: ca }, [[ca[0], cb[1]]], { node: B, box: b, c: cb }); if (r2) C.push(asD(r2));
  } else if (k.t === 'canvas') {
    const [tw, th] = ctx.tile;
    for (const [dw, dh] of [[0, 16], [16, 0], [0, 32], [32, 0], [24, 24]]) { const s2 = clone(); if (s2.w + dw <= tw && s2.h + dh <= th) { s2.w += dw; s2.h += dh; C.push(s2); } }
  }
  return C;
}
function lintLoop(spec0, ends, tile, add) {
  let spec = spec0, cur = score(spec);
  let pathsCache = null;
  const ctx = { ends, tile, paths: () => (pathsCache ||= wirePaths(spec)) };
  for (let round = 0; round < 8 && cur >= 5; round++) {
    let improved = false;
    const fs = findings(spec).filter((f) => f.severity === 'error' || f.severity === 'soft' || f.code === 'header-band' || f.code === 'label-lines');
    for (const f of fs) {
      if (!findings(spec).some((g) => g.code === f.code && g.message === f.message)) continue;
      let best = null;
      for (const k of knobs(f, spec, ctx)) for (const c of candidates(k, spec, ctx)) {
        let sc; try { sc = score(c); } catch { continue; }
        if (sc < (best ? best.sc : cur)) best = { sc, c };
      }
      if (best) { spec = best.c; cur = best.sc; pathsCache = null; improved = true; }
    }
    if (!improved) break;
  }
  // last resort: a wire label that cannot sit clear of everything is dropped (and reported)
  for (const f of lint(spec).filter((x) => x.severity === 'error')) {
    for (const m of f.message.matchAll(/text "([^"]*)"/g)) {
      const own = textOwners(spec).filter(([l, o]) => l === m[1] && o.t === 'wlabel');
      for (const [, o] of own) {
        const s2 = structuredClone(spec), w = s2.wires.find((x) => x.id === o.id);
        if (!w || !w.label) continue;
        const text = w.label;
        for (const key of ['label', 'labelAt', 'labelDx', 'labelDy', 'labelAnchor', 'labelBg']) delete w[key];
        const sc = score(s2);
        if (sc < cur) { spec = s2; cur = sc; add('warn', 'label-dropped', o.id, `wire label "${text.replace(/\n/g, ' ')}" found no clear spot and was dropped`); }
      }
    }
  }
  return spec;
}

// ---------------------------------------------------------------- Prism round trip
// an unedited export: same ids, same places (in spec units), nothing added; then the stored spec is exact
function restoreExact(meta, model, opts) {
  const k = model.meta.scale || 1, [ox, oy] = model.meta.origin;
  const spec = meta.spec || meta;
  if (!spec || typeof spec !== 'object' || !spec.id) return null;
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const X = (v) => (v - ox) / k, Y = (v) => (v - oy) / k;
  // every drawn cell is one the exporter wrote (edge label children aside)
  if (model.live.some((c) => !c.props.prism_kind && !(c.vertex && model.cells.get(c.parent)?.edge))) return null;
  const tagged = (kind) => model.live.filter((c) => c.props.prism_kind === kind);
  const nodes = tagged('node');
  if (nodes.length !== (spec.nodes || []).length) return null;
  for (const c of nodes) {
    const n = (spec.nodes || []).find((x) => x.id === c.props.prism_id);
    if (!n || !c.box || Math.abs(X(c.box.x) - n.x) > 1 || Math.abs(Y(c.box.y) - n.y) > 1) return null;
    if (norm(labelOf(c)) !== norm(`${n.label || ''} ${n.sub || ''}`)) return null;
  }
  const groups = tagged('group');
  if (groups.length !== (spec.groups || []).length) return null;
  for (const c of groups) {
    const g = (spec.groups || [])[+c.props.prism_index];
    if (!g || !c.box || Math.abs(X(c.box.x) - g.x) > 1 || Math.abs(Y(c.box.y) - g.y) > 1 || Math.abs(c.box.w / k - g.w) > 1 || Math.abs(c.box.h / k - g.h) > 1) return null;
  }
  const wires = tagged('wire');
  if (wires.length !== (spec.wires || []).length) return null;
  const cellOf = (id) => model.cells.get(id)?.props.prism_id;
  for (const c of wires) {
    const w = (spec.wires || []).find((x) => x.id === c.props.prism_id);
    if (!w || norm(w.label) !== norm(labelOf(c))) return null;
    if (w.from != null && (cellOf(c.source) !== w.from || cellOf(c.target) !== w.to)) return null;
  }
  // the drawing shows the compiled story: badges for the flows' steps too
  let drawnSteps = spec.steps || [];
  try { drawnSteps = compileFlows(spec).steps || []; } catch { return null; }
  if (tagged('step').length !== drawnSteps.length) return null;
  if (tagged('table').length !== (spec.tables || []).length) return null;
  const out = canonicalDiagram(spec);
  if (opts.id && /^[a-z][a-z0-9-]*$/.test(opts.id)) out.id = opts.id;
  if (opts.name) out.name = opts.name;
  return out;
}
// an edited export: keep what still resolves from the stored spec
function mergeMeta(spec, meta, add) {
  const m = meta.spec || meta;
  const wires = new Set((spec.wires || []).map((w) => w.id)), nodes = new Set((spec.nodes || []).map((n) => n.id)), groups = new Set((spec.groups || []).filter((g) => g.id).map((g) => g.id));
  let kept = 0, lost = 0;
  if (Array.isArray(m.timeline) && m.timeline.length) {
    spec.timeline = m.timeline.filter((e) => (e.wire == null || wires.has(e.wire)) && (e.ring == null || typeof e.ring === 'object' || nodes.has(e.ring)) && (e.wire != null || e.ring != null));
    kept += spec.timeline.length; lost += m.timeline.length - spec.timeline.length;
  }
  if (Array.isArray(m.effects) && m.effects.length) {
    spec.effects = m.effects.filter((e) => (e.appear == null || nodes.has(e.appear)) && (e.fail == null || groups.has(e.fail)) && (e.fade == null || wires.has(e.fade)) && (e.glow == null || wires.has(e.glow)));
    kept += spec.effects.length; lost += m.effects.length - spec.effects.length;
    if (!spec.effects.length) delete spec.effects;
  }
  for (const s of spec.steps || []) { const t = (m.steps || []).find((x) => String(x.n) === String(s.n) && x.text); if (t && !s.text) s.text = t.text; }
  const timed = (m.notes || []).filter((n) => n.t);
  if (timed.length) spec.notes = [...(spec.notes || []), ...timed];
  for (const k of ['desc', 'dur', 'lintAllow']) if (m[k] != null) spec[k] = m[k];
  if (m.legend && !spec.legend) spec.legend = m.legend;
  add('info', 'prism-merged', null, `edited Prism export: re-imported the drawing and restored ${kept} timeline/effect entr${kept === 1 ? 'y' : 'ies'} from the hidden prism layer${lost ? ` (${lost} referred to removed elements)` : ''}`);
}

// ---------------------------------------------------------------- CLI
async function loadFamily(p) {
  if (/\.json$/i.test(p)) { const fam = JSON.parse(fs.readFileSync(path.resolve(p), 'utf8')); const errs = validateFamily(fam); if (errs.length) throw new Error(`${p} does not match spec.schema.json: ${errs.map((e) => `${e.path}: ${e.message}`).join('; ')}`); return fam; }
  return (await import(pathToFileURL(path.resolve(p)).href)).default;
}
export function summary(file, { spec, report }) {
  const c = (k) => (spec[k] || []).length;
  const n = (s) => report.issues.filter((i) => i.severity === s).length, l = (s) => report.lint.filter((f) => f.severity === s).length;
  const pg = report.pages.find((p) => p.imported);
  const lines = [
    `${file}: ${report.format}, page ${pg.index + 1} of ${report.pages.length} "${pg.name}"${pg.compressed ? ' (compressed)' : ''}`,
    `  ${spec.id}: "${spec.name}", ${report.tile} tile ${spec.w}x${spec.h}, scale ${report.scale}`,
    `  ${c('nodes')} nodes, ${c('groups')} groups, ${c('wires')} wires, ${c('steps')} steps, ${c('notes')} notes, timeline ${c('timeline')}${c('effects') ? `, effects ${c('effects')}` : ''}`,
    `  lint: ${l('error')} error, ${l('warn')} warn, ${l('info')} info`,
    `  issues: ${n('error')} error, ${n('warn')} warn, ${n('info')} info${report.unmapped.length ? `; unmapped: ${report.unmapped.length}` : ''}`,
    ...report.issues.map((i) => `    ${i.severity.padEnd(5)} ${i.code.padEnd(18)} ${i.element ? `[${i.element}] ` : ''}${i.message}`),
  ];
  return lines.join('\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const write = (out, text) => { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(path.resolve(out), text); console.error(`wrote ${out} (${text.length} bytes)`); };
  try {
    if (args[0] === '--export') {
      const [, famPath, id] = args, out = opt('--out');
      if (!famPath || !id || !out) { console.error('usage: drawio.mjs --export <family spec> <diagram id> --out x.drawio'); process.exit(2); }
      const fam = await loadFamily(famPath);
      const d = fam.diagrams.find((x) => x.id === id || 'aws-' + x.id === id);
      if (!d) { console.error(`no diagram ${JSON.stringify(id)} in ${famPath} (has: ${fam.diagrams.map((x) => x.id).join(', ')})`); process.exit(1); }
      const r = exportDrawio(d);
      write(out, r.xml);
      console.log(`${d.id}: ${r.counts.groups} groups, ${r.counts.nodes} nodes (${r.counts.named} named draw.io shapes, ${r.counts.images} inline images), ${r.counts.wires} wires, ${r.counts.steps} steps${r.lost.length ? `; not drawable in draw.io, kept on the hidden prism layer: ${r.lost.join(', ')}` : ''}`);
      process.exit(0);
    }
    const file = args[0];
    if (!file || file.startsWith('--')) { console.error('usage: drawio.mjs <file> [--id x] [--name n] [--page n] [--story auto|none] [--width n] [--out spec.json] [--svg out.svg] [--theme light|dark|auto] [--still] [--no-restore]\n       drawio.mjs --export <family spec> <diagram id> --out x.drawio'); process.exit(2); }
    const o = { id: opt('--id') || undefined, name: opt('--name') || undefined, page: opt('--page') != null ? opt('--page') : 0, story: opt('--story') || 'auto', width: opt('--width') ? +opt('--width') : undefined, restore: !args.includes('--no-restore') };
    const res = fromDrawio(fs.readFileSync(path.resolve(file)), o);
    console.log(summary(file, res));
    if (opt('--out')) {
      const { family } = canonical({ version: 1, section: { id: 'drawio-import', title: 'DRAWIO IMPORT' }, diagrams: [res.spec] });
      write(opt('--out'), toJson(family) + '\n');
    }
    if (opt('--svg')) write(opt('--svg'), standalone(res.spec, { theme: opt('--theme') || 'auto', still: args.includes('--still') }));
    process.exit(res.report.lint.some((f) => f.severity === 'error') ? 1 : 0);
  } catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
}
