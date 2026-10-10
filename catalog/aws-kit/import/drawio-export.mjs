// drawio-export.mjs: AWS kit diagram spec to a draw.io file (k33bz fork). No deps.
//
//   import { toDrawio, exportDrawio } from './drawio-export.mjs';
//   fs.writeFileSync('x.drawio', toDrawio(spec));             // plain (uncompressed) .drawio XML
//   const { xml, counts, lost } = exportDrawio(spec, { scale: 1.2 });
//
// Groups get the official draw.io AWS group styles, icons the draw.io AWS4 shape that resolves back to the
// same Prism id (service tiles for aws-svc-*, resource shapes for aws-res-*; names from the store's
// xref.drawio first, then the draw.io library names in catalog/aws-icons/coverage-inputs.json, each checked
// through resolveIcon so an import gives the same icon). An icon draw.io lacks is an inline SVG image.
// Every cell carries prism_* properties (kind, id, icon), boxes are rounded rectangles, wires orthogonal
// edges with source/target and the kit's resolved route as waypoints, steps numbered ellipses (the step
// text as the tooltip), notes text cells. The geometry is the kit's own: wire paths and badge positions are
// read from the SVG awd.mjs draws. Motion has no draw.io form, so the whole spec rides along on a hidden
// layer (<object prism_spec="...">), and fromDrawio restores it exactly when the drawing was not edited.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagram, stepTexts } from '../awd.mjs';
import { canonicalDiagram, VERSION } from '../spec.mjs';
import { wrap } from '../place.mjs';
import { textWidth } from '../lint.mjs';
import { resolveIcon } from '../../aws-icons/resolve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.resolve(HERE, '..', '..', 'aws-icons');
let STORE = null;
const store = () => (STORE ||= JSON.parse(fs.readFileSync(path.join(ICONS_DIR, 'aws-icons.json'), 'utf8')).icons);

const r2 = (n) => Math.round(n * 100) / 100;
const xesc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#xa;');
const hesc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = (s) => String(s).split('\n').map(hesc).join('<br>');

// AWS category fills of draw.io's AWS 2025 palette, by the store's category names
const FILL = {
  'General Icons': '#232F3D', 'Front End Web Mobile': '#DD344C', 'Networking Content Delivery': '#8C4FFF', 'Migration Modernization': '#01A88D',
  Analytics: '#8C4FFF', Databases: '#C925D1', Storage: '#7AA116', 'Quantum Technologies': '#ED7100', 'Security Identity': '#DD344C',
  'Media Services': '#ED7100', 'Developer Tools': '#C925D1', 'Management Governance': '#E7157B', 'Management Tools': '#E7157B',
  'Artificial Intelligence': '#01A88D', Compute: '#ED7100', Containers: '#ED7100', 'Application Integration': '#E7157B', IoT: '#7AA116',
  'Internet of Things': '#7AA116', Blockchain: '#ED7100', 'Business Applications': '#DD344C', 'Customer Enablement': '#C925D1',
  'Cloud Financial Management': '#7AA116', Games: '#8C4FFF', Satellite: '#C925D1', 'End User Computing': '#01A88D',
};
const CATEGORY = {
  compute: '#ED7100', containers: '#ED7100', storage: '#7AA116', iot: '#7AA116', database: '#C925D1', devtools: '#C925D1',
  networking: '#8C4FFF', analytics: '#8C4FFF', security: '#DD344C', frontend: '#DD344C', integration: '#E7157B',
  management: '#E7157B', ai: '#01A88D', migration: '#01A88D', general: '#7D8998',
};
const WIRE_COLOR = { request: '#ED7100', response: '#0972D3', bad: '#DD344C', muted: '#AAB7B8' };
const GROUP_LABEL = { cloud: 'AWS Cloud', 'cloud-plain': 'AWS Cloud', region: 'Region', az: 'Availability Zone', vpc: 'VPC', pub: 'Public subnet', priv: 'Private subnet', sg: 'Security group', asg: 'Auto Scaling group', acct: 'AWS account', dc: 'Corporate data center', server: 'Server contents', ec2: 'EC2 instance contents', spot: 'Spot Fleet', iot: 'AWS IoT Greengrass deployment', gen: '' };

// ---- official draw.io AWS group styles
const PTS16 = 'points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];';
const PTS10 = 'points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],[0.25,1,0],[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],[1,0.25,0],[1,0.5,0],[1,0.75,0]];';
const grp = (icon, stroke, fill, font, extra = '') => `${PTS16}outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=12;fontStyle=0;container=1;pointerEvents=0;collapsible=0;recursiveResize=0;shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.${icon};strokeColor=${stroke};fillColor=${fill};verticalAlign=top;align=left;spacingLeft=30;fontColor=${font};${extra}`;
const plainGrp = (stroke, fill, font, dash, center) => `fillColor=${fill};strokeColor=${stroke};dashed=${dash ? 1 : 0};verticalAlign=top;fontStyle=0;fontColor=${font};whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;align=${center ? 'center' : 'left'};spacingLeft=${center ? 0 : 6};fontSize=12;`;
const GSTYLE = {
  cloud: grp('group_aws_cloud_alt', '#232F3E', 'none', '#232F3E', 'dashed=0;'),
  'cloud-plain': grp('group_aws_cloud', '#232F3E', 'none', '#232F3E', 'dashed=0;'),
  region: grp('group_region', '#00A4A6', 'none', '#147EBA', 'dashed=1;'),
  vpc: grp('group_vpc2', '#8C4FFF', 'none', '#AAB7B8', 'dashed=0;'),
  pub: grp('group_security_group', '#7AA116', '#F2F6E8', '#248814', 'grStroke=0;dashed=0;'),
  priv: grp('group_security_group', '#00A4A6', '#E6F6F7', '#147EBA', 'grStroke=0;dashed=0;'),
  acct: grp('group_account', '#CD2264', 'none', '#CD2264', 'dashed=0;'),
  dc: grp('group_corporate_data_center', '#7D8998', 'none', '#5A6C86', 'dashed=0;'),
  server: grp('group_on_premise', '#7D8998', 'none', '#5A6C86', 'dashed=0;'),
  ec2: grp('group_ec2_instance_contents', '#D86613', 'none', '#D86613', 'dashed=0;'),
  spot: grp('group_spot_fleet', '#D86613', 'none', '#D86613', 'dashed=0;'),
  iot: grp('group_iot_greengrass_deployment', '#7AA116', 'none', '#3F8624', 'dashed=0;'),
  asg: `${PTS16}outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=12;fontStyle=0;container=1;pointerEvents=0;collapsible=0;recursiveResize=0;shape=mxgraph.aws4.groupCenter;grIcon=mxgraph.aws4.group_auto_scaling_group;grStroke=1;strokeColor=#D86613;fillColor=none;verticalAlign=top;align=center;fontColor=#D86613;dashed=1;spacingTop=25;`,
  az: plainGrp('#147EBA', 'none', '#147EBA', true, true),
  sg: plainGrp('#DD3522', 'none', '#DD3522', false, true),
};
// a light tint of a category color for a filled frame
const tint = (hex, a = 0.08) => '#' + [1, 3, 5].map((i) => Math.round(255 - (255 - parseInt(hex.slice(i, i + 2), 16)) * a).toString(16).padStart(2, '0')).join('').toUpperCase();
function groupStyle(g) {
  if (g.kind !== 'gen' && GSTYLE[g.kind]) {
    let s = GSTYLE[g.kind];
    if (g.dashed != null) s = s.replace(/dashed=\d;/, `dashed=${g.dashed ? 1 : 0};`);
    return s;
  }
  const stroke = g.tone ? CATEGORY[g.tone] : '#5A6C86';
  const fill = g.fill ? tint(CATEGORY[g.tone || 'general']) : 'none';
  return plainGrp(stroke, fill, g.tone ? stroke : '#5A6C86', g.dashed != null ? g.dashed : true, !g.icon && g.align !== 'left');
}

// ---- Prism icon id -> draw.io shape: { form: 'tile' | 'shape', name }
let REV = null;
export function drawioShapeOf(id) {
  if (!REV) {
    REV = new Map();
    const S = store();
    let tiles = new Set(), shapes = new Set();
    try {
      const cov = JSON.parse(fs.readFileSync(path.join(ICONS_DIR, 'coverage-inputs.json'), 'utf8'));
      tiles = new Set(Object.keys(cov.drawioTiles || {})); shapes = new Set(Object.keys(cov.drawioShapes || {}));
    } catch { /* no library lists: the store's xref names alone */ }
    const known = tiles.size + shapes.size > 0;
    const back = (form, name) => { const r = resolveIcon(`${form === 'tile' ? 'resIcon' : 'shape'}=mxgraph.aws4.${name}`, { from: 'drawio' }); return r.id && r.kind === 'node' ? r.id : null; };
    const put = (id, v) => { if (!REV.has(id)) REV.set(id, v); };
    // 1. the store's curated draw.io names, in the form the library has them
    for (const e of Object.values(S)) for (const name of (e.xref && e.xref.drawio) || []) {
      const forms = tiles.has(name) && shapes.has(name) ? (e.kind === 'resource' ? ['shape', 'tile'] : ['tile', 'shape'])
        : tiles.has(name) ? ['tile'] : shapes.has(name) ? ['shape'] : known ? [] : [e.kind === 'resource' ? 'shape' : 'tile'];
      for (const form of forms) { const b = back(form, name); if (b) { put(b, { form, name }); break; } }
    }
    // 2. every name in the draw.io AWS4 library, resolved forward
    for (const name of tiles) { const b = back('tile', name); if (b) put(b, { form: 'tile', name }); }
    for (const name of shapes) { const b = back('shape', name); if (b) put(b, { form: 'shape', name }); }
  }
  return REV.get(id) || null;
}
const baseId = (icon) => { const S = store(); const id = Array.isArray(icon) ? icon[1] || icon[0] : icon; const b = String(id).replace(/-(dark|light)$/, ''); return S[b] || S[b + '-dark'] ? b : id; };
const artwork = (id) => { const S = store(); return S[id] || S[id + '-light'] || S[id + '-dark']; };

const labelStyle = (pos) => (pos === 'r' ? 'labelPosition=right;verticalLabelPosition=middle;align=left;verticalAlign=middle;'
  : pos === 'l' ? 'labelPosition=left;verticalLabelPosition=middle;align=right;verticalAlign=middle;'
    : pos === 't' ? 'labelPosition=center;verticalLabelPosition=top;align=center;verticalAlign=bottom;'
      : 'verticalLabelPosition=bottom;verticalAlign=top;align=center;');
function nodeStyle(n, stats) {
  if (n.kind) {
    const stroke = n.tone ? CATEGORY[n.tone] : '#7D8998';
    return `rounded=1;whiteSpace=wrap;html=1;arcSize=${n.kind === 'pill' ? 50 : 10};fillColor=#F2F4F8;strokeColor=${stroke};fontColor=#232F3E;fontSize=12;`;
  }
  const id = baseId(n.icon), ic = artwork(id), rev = drawioShapeOf(id);
  const fill = FILL[ic && ic.category] || '#232F3D', lbl = labelStyle(n.labelPos);
  if (rev && rev.form === 'tile') { stats.named++; return `sketch=0;${PTS10}outlineConnect=0;fontColor=#232F3E;fillColor=${fill};strokeColor=#ffffff;dashed=0;${lbl}html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.${rev.name};`; }
  if (rev) { stats.named++; return `sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor=none;fillColor=${fill};strokeColor=none;dashed=0;${lbl}html=1;fontSize=12;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.${rev.name};`; }
  // no draw.io stencil: the icon's own artwork as an inline SVG (base64 without ";base64": draw.io splits styles on ";")
  stats.images++;
  const [, , vw, vh] = ic.viewBox.split(/\s+/);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ic.viewBox}" width="${vw}" height="${vh}">${ic.svg}</svg>`;
  return `shape=image;html=1;${lbl}imageAspect=0;aspect=fixed;fontSize=12;fontColor=#232F3E;image=data:image/svg+xml,${Buffer.from(svg).toString('base64')};`;
}

// ---- kit geometry, read back from the markup the generator draws
function pathPts(d) {
  const out = []; let x = 0, y = 0;
  for (const [, c, v] of String(d).matchAll(/([MHVL])\s*([-\d.]+(?:[ ,][-\d.]+)?)/g)) {
    const n = v.split(/[ ,]/).map(Number);
    if (c === 'M' || c === 'L') { x = n[0]; y = n[1]; } else if (c === 'H') x = n[0]; else y = n[0];
    out.push([x, y]);
  }
  return out.filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
}
function segAt(pts, f) {
  if (pts.length < 2) return { x: pts[0] ? pts[0][0] : 0, y: pts[0] ? pts[0][1] : 0, dir: [1, 0] };
  const seg = []; let tot = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); tot += l; }
  let want = tot * f;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? Math.min(1, want / seg[i]) : 0, a = pts[i], b = pts[i + 1], l = seg[i] || 1;
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, dir: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] };
    }
    want -= seg[i];
  }
  return { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1], dir: [1, 0] };
}
const nodeBox = (n) => (n.kind ? { x: n.x, y: n.y, w: n.w, h: n.h } : { x: n.x, y: n.y, w: n.size || 40, h: n.size || 40 });
const labelH = (n) => (n.kind || (n.labelPos || 'b') !== 'b' ? 0 : (n.label ? 13 * wrap(n.label, n.wrap || 14).length : 0) + (n.sub ? 11 : 0));

/** Export one diagram spec: { xml, counts, lost } (lost: what draw.io cannot draw; it stays in prism_spec). */
export function exportDrawio(spec, { scale = 1.2 } = {}) {
  const svg = diagram(spec);   // checks the spec; its markup is the geometry source
  const k = scale, S = (v) => r2(v * k);
  const top = 40;              // room above the diagram for the title (draw.io px)
  const out = [], stats = { named: 0, images: 0 };
  const pre = `${spec.id}-`;
  const paths = Object.create(null);
  for (const m of svg.matchAll(/<path id="([^"]+)" class="w[^"]*"[^>]*? d="([^"]+)"/g)) if (m[1].startsWith(pre)) paths[m[1].slice(pre.length)] = pathPts(m[2]);
  const badges = [...svg.matchAll(/<g class="st" transform="translate\(([-\d.]+),([-\d.]+)\)">/g)].map((m) => [+m[1], +m[2]]);
  const cell = (id, props, value, style, b, parent, extra = '') => {
    const po = parent ? parent.abs : { x: 0, y: -top / k };
    const attrs = Object.entries(props).filter(([, v]) => v != null && v !== '').map(([a, v]) => ` ${a}="${xesc(v)}"`).join('');
    out.push(`<object id="${xesc(id)}" label="${xesc(value)}"${attrs}><mxCell style="${xesc(style)}" vertex="1" parent="${parent ? xesc(parent.id) : '1'}"${extra}><mxGeometry x="${S(b.x - po.x)}" y="${S(b.y - po.y)}" width="${S(b.w)}" height="${S(b.h)}" as="geometry"/></mxCell></object>`);
  };

  // groups (outer first, as drawn); a group's parent is the smallest earlier group that holds it
  const groups = (spec.groups || []).map((g, i) => ({ g, i, id: `g${i}`, abs: { x: g.x, y: g.y }, b: { x: g.x, y: g.y, w: g.w, h: g.h } }));
  const holds = (G, b) => b.x >= G.b.x - 0.5 && b.y >= G.b.y - 0.5 && b.x + b.w <= G.b.x + G.b.w + 0.5 && b.y + b.h <= G.b.y + G.b.h + 0.5;
  const parentOf = (b, before = Infinity) => groups.filter((G) => G.i < before && holds(G, b) && G.b.w * G.b.h > b.w * b.h).sort((a, z) => a.b.w * a.b.h - z.b.w * z.b.h)[0] || null;
  for (const G of groups) {
    const g = G.g, label = g.label != null ? g.label : GROUP_LABEL[g.kind] || '';
    cell(G.id, { prism_kind: 'group', prism_index: G.i, prism_group: g.kind, prism_id: g.id, prism_icon: typeof g.icon === 'string' ? g.icon : null, prism_tone: g.tone, prism_fill: g.fill ? '1' : null, prism_dashed: g.dashed != null ? (g.dashed ? '1' : '0') : null, prism_align: g.align },
      html(label), groupStyle(g), G.b, parentOf(G.b, G.i));
    if (g.note) {
      const w = textWidth(g.note, 9) + 10;
      cell(`${G.id}-note`, { prism_kind: 'gnote' }, html(g.note), 'text;html=1;align=right;verticalAlign=middle;resizable=0;points=[];autosize=0;strokeColor=none;fillColor=none;fontSize=10;fontColor=#545B64;', { x: g.x + g.w - 6 - w, y: g.y + 3, w, h: 14 }, G);
    }
  }
  // nodes
  const nodeCell = new Map();
  for (const n of spec.nodes || []) {
    const b = nodeBox(n), id = `n-${n.id}`;
    nodeCell.set(n.id, { id, b, n });
    const lines = n.label ? (n.kind ? [n.label] : wrap(n.label, n.wrap || 14)) : [];
    const value = [...lines.map(hesc), ...(n.sub ? [`<font color="#7D8998">${hesc(n.sub)}</font>`] : [])].join('<br>');
    cell(id, { prism_kind: 'node', prism_id: n.id, prism_icon: n.kind ? null : baseId(n.icon), prism_shape: n.kind, prism_sub: n.sub, prism_wrap: n.wrap, prism_tone: n.tone }, value, nodeStyle(n, stats), b, parentOf(b));
  }
  // wires: source/target when an end sits on a node, the route's inner points as waypoints, ports from the ends
  const endAt = (p, start) => {
    let best = null;
    for (const [nid, c] of nodeCell) {
      const B = c.b, lh = labelH(c.n);
      const d = Math.max(B.x - p[0], p[0] - (B.x + B.w), 0) + Math.max(B.y - p[1], p[1] - (B.y + B.h + (start ? lh : 0)), 0);
      if (d <= 8 && (!best || d < best.d)) best = { d, nid, c };
    }
    return best;
  };
  const port = (B, p, q) => {
    // which side the path leaves (or enters) through, and where along it
    const horiz = Math.abs(p[1] - q[1]) < 0.5;
    const cl = (v) => Math.max(0, Math.min(1, r2(v)));
    if (horiz) return { x: q[0] > p[0] ? (p[0] >= B.x + B.w / 2 ? 1 : 0) : (p[0] <= B.x + B.w / 2 ? 0 : 1), y: cl((p[1] - B.y) / B.h) };
    return { x: cl((p[0] - B.x) / B.w), y: q[1] > p[1] ? (p[1] >= B.y + B.h / 2 ? 1 : 0) : (p[1] <= B.y + B.h / 2 ? 0 : 1) };
  };
  for (const w of spec.wires || []) {
    const pts = paths[w.id] || [];
    if (pts.length < 2) continue;
    const s0 = w.from != null ? { nid: w.from, c: nodeCell.get(w.from) } : endAt(pts[0], true);
    const t0 = w.to != null ? { nid: w.to, c: nodeCell.get(w.to) } : endAt(pts[pts.length - 1], false);
    const color = w.hot ? '#DD344C' : w.tone ? WIRE_COLOR[w.tone] : '#545B64';
    let st = `edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;html=1;strokeColor=${color};strokeWidth=2;fontSize=11;fontColor=#545B64;labelBackgroundColor=#FFFFFF;endArrow=${w.arrow === false ? 'none' : 'open'};endFill=0;startArrow=${w.both && w.arrow !== false ? 'open' : 'none'};startFill=0;`;
    if (w.dashed) st += 'dashed=1;';
    if (w.flow) st += 'flowAnimation=1;';
    if (s0 && s0.c) { const p = port(s0.c.b, pts[0], pts[1]); st += `exitX=${p.x};exitY=${p.y};exitDx=0;exitDy=0;`; }
    if (t0 && t0.c) { const p = port(t0.c.b, pts[pts.length - 1], pts[pts.length - 2]); st += `entryX=${p.x};entryY=${p.y};entryDx=0;entryDy=0;`; }
    // label: x from -1 at the source to 1, y beside the path (positive = left of travel, as draw.io draws it)
    let lx = 0, ly = 0;
    if (w.label) {
      const at = w.labelAt != null ? w.labelAt : 0.5, sp = segAt(pts, at);
      const lines = String(w.label).split('\n'), tw = Math.max(...lines.map((l) => textWidth(l, 8.5)));
      const dx = (w.labelDx || 0) + (w.labelAnchor === 'start' ? tw / 2 : w.labelAnchor === 'end' ? -tw / 2 : 0);
      const dy = (w.labelDy != null ? w.labelDy : -5) - 3 + 4.75 * (lines.length - 1);
      lx = r2(at * 2 - 1); ly = r2((dx * sp.dir[1] - dy * sp.dir[0]) * k);
    }
    const inner = pts.slice(1, -1);
    let geo = `<mxGeometry${w.label ? ` x="${lx}" y="${ly}"` : ''} relative="1" as="geometry">`;
    if (!(s0 && s0.c)) geo += `<mxPoint x="${S(pts[0][0])}" y="${S(pts[0][1] + top / k)}" as="sourcePoint"/>`;
    if (!(t0 && t0.c)) geo += `<mxPoint x="${S(pts[pts.length - 1][0])}" y="${S(pts[pts.length - 1][1] + top / k)}" as="targetPoint"/>`;
    if (inner.length) geo += `<Array as="points">${inner.map(([x, y]) => `<mxPoint x="${S(x)}" y="${S(y + top / k)}"/>`).join('')}</Array>`;
    geo += '</mxGeometry>';
    out.push(`<object id="w-${xesc(w.id)}" label="${xesc(w.label ? html(w.label) : '')}" prism_kind="wire" prism_id="${xesc(w.id)}"><mxCell style="${xesc(st)}" edge="1" parent="1"${s0 && s0.c ? ` source="${xesc(s0.c.id)}"` : ''}${t0 && t0.c ? ` target="${xesc(t0.c.id)}"` : ''}>${geo}</mxCell></object>`);
  }
  // steps: numbered ellipses where the kit draws the badges; the step text is the tooltip
  (spec.steps || []).forEach((s, i) => {
    const [x, y] = badges[i] || [s.x || 0, s.y || 0], d = 15;
    cell(`s${i}`, { prism_kind: 'step', tooltip: s.text }, String(s.n), 'ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#232F3E;strokeColor=none;fontColor=#FFFFFF;fontStyle=1;fontSize=10;', { x: x - d / 2, y: y - d / 2, w: d, h: d }, null);
  });
  // notes still frames show (timed ones stay in the prism spec), marks, legend
  const lost = [];
  (spec.notes || []).forEach((nt, i) => {
    if (nt.t && !nt.still) return;
    const size = nt.size || (nt.kind === 'label' ? 10.5 : 8.5), lines = String(nt.text).split('\n').map((l) => (nt.caps ? l.toUpperCase() : l));
    const lh = nt.size ? nt.size * 1.2 : 10, bold = nt.weight === 'bold' || nt.kind === 'warn';
    const w = Math.max(...lines.map((l) => textWidth(l, size, bold, nt.caps ? 0.8 : 0))) + 8, h = lh * (lines.length - 1) + size + 6;
    const a = nt.anchor || 'middle', x = a === 'start' ? nt.x - 4 : a === 'end' ? nt.x - w + 4 : nt.x - w / 2;
    const color = nt.kind === 'warn' || nt.tone === 'bad' ? '#DD344C' : nt.tone === 'request' ? '#ED7100' : nt.tone === 'response' ? '#0972D3' : nt.kind === 'label' || nt.tone === 'ink' ? '#232F3E' : '#545B64';
    const fields = Object.fromEntries(['text', 'kind', 'anchor', 'tone', 'size', 'weight', 'caps'].filter((f) => nt[f] != null).map((f) => [f, nt[f]]));
    cell(`t${i}`, { prism_kind: 'note', prism_note: JSON.stringify(fields) }, lines.map(hesc).join('<br>'), `text;html=1;align=${a === 'start' ? 'left' : a === 'end' ? 'right' : 'center'};verticalAlign=top;whiteSpace=nowrap;strokeColor=none;fillColor=none;fontSize=${Math.round(size * k)};fontColor=${color};${bold ? 'fontStyle=1;' : ''}`, { x, y: nt.y - size * 0.9 - 2, w, h }, null);
  });
  (spec.marks || []).forEach((m, i) => {
    if (m.t && !m.still) return;
    let x = m.x, y = m.y;
    const n = m.on != null && (spec.nodes || []).find((q) => q.id === m.on);
    if (n) { const B = nodeBox(n); x = B.x + B.w - 2; y = B.y + 2; } else if (m.on != null && paths[m.on]) ({ x, y } = segAt(paths[m.on], m.f != null ? m.f : 0.5));
    x += m.dx || 0; y += m.dy || 0;
    const ok = m.kind === 'ok';
    cell(`m${i}`, { prism_kind: 'mark', prism_mark: ok ? 'ok' : 'blocked', prism_on: m.on }, ok ? '✓' : '✕', `ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=${ok ? '#3F8624' : '#DD344C'};strokeColor=none;fontColor=#FFFFFF;fontStyle=1;fontSize=10;`, { x: x - 7.5, y: y - 7.5, w: 15, h: 15 }, null);
  });
  if (spec.legend) {
    const L = spec.legend, used = new Set((spec.timeline || []).filter((e) => e.wire).map((e) => e.kind || 'pk'));
    const NAMES = { pk: 'Request', 'pk-2': 'Response', 'pk-bad': 'Failed or blocked', wire: 'Call or data path', dashed: 'Asynchronous or optional', blocked: 'Blocked' };
    const DOT = { pk: '#ED7100', 'pk-2': '#0972D3', 'pk-bad': '#DD344C', blocked: '#DD344C' };
    const items = L.items || ['pk', 'pk-2', 'pk-bad'].filter((x) => used.has(x)).map((kind) => ({ kind }));
    const rows = items.map((it) => `${DOT[it.kind] ? `<font color="${DOT[it.kind]}">●</font>` : it.kind === 'dashed' ? '- -' : '--'} ${hesc(it.label || NAMES[it.kind])}`);
    if (rows.length) cell('legend', { prism_kind: 'legend', prism_legend: JSON.stringify({ ...(L.items ? { items: L.items } : {}), ...(L.row ? { row: true } : {}) }) }, rows.join('<br>'), 'text;html=1;align=left;verticalAlign=top;whiteSpace=nowrap;strokeColor=none;fillColor=none;fontSize=10;fontColor=#545B64;', { x: L.x - 2, y: L.y - 10, w: 150, h: rows.length * 13 + 6 }, null);
  }
  // the title above the diagram, the step list below it (draw.io has no tile around the drawing)
  cell('title', { prism_kind: 'title' }, hesc(spec.name || spec.id), 'text;html=1;align=left;verticalAlign=middle;whiteSpace=nowrap;strokeColor=none;fillColor=none;fontSize=16;fontStyle=1;fontColor=#232F3E;', { x: 0, y: -top / k + 2, w: Math.max(200, textWidth(spec.name || spec.id, 13.5, true) + 20), h: 24 / k }, null);
  const told = stepTexts(spec);
  if (told.length) cell('steplist', { prism_kind: 'steplist' }, told.map(([n, t]) => `${hesc(n)}. ${hesc(t)}`).join('<br>'), 'text;html=1;align=left;verticalAlign=top;whiteSpace=wrap;strokeColor=none;fillColor=none;fontSize=11;fontColor=#232F3E;', { x: 0, y: (spec.h || 240) + 10, w: spec.w || 480, h: told.length * 14 + 8 }, null);
  if ((spec.timeline || []).length) lost.push(`timeline (${spec.timeline.length})`);
  if ((spec.effects || []).length) lost.push(`effects (${spec.effects.length})`);
  const timed = (spec.notes || []).filter((n) => n.t && !n.still).length + (spec.marks || []).filter((m) => m.t && !m.still).length;
  if (timed) lost.push(`timed notes and marks (${timed})`);
  if (spec.extra) lost.push('extra markup');
  const meta = { version: VERSION, spec: canonicalDiagram(spec) };
  const W = Math.ceil((spec.w || 480) * k + 40), H = Math.ceil((spec.h || 240) * k + top + 40);
  const model = `<mxGraphModel dx="${W}" dy="${H}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${W}" pageHeight="${H}" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" value="Diagram" parent="0"/>`
    + out.join('')
    + `<mxCell id="prism-layer" value="Prism spec (motion, step texts)" parent="0" visible="0"/><object id="prism-spec" label="" prism_spec="${xesc(JSON.stringify(meta))}" prism_scale="${k}" prism_origin="0,${top}"><mxCell style="text;html=1;" vertex="1" parent="prism-layer"><mxGeometry width="10" height="10" as="geometry"/></mxCell></object></root></mxGraphModel>`;
  const xml = `<mxfile host="prism" version="27.0.0" type="device"><diagram id="${xesc(spec.id)}" name="${xesc(spec.name || spec.id)}">${model}</diagram></mxfile>\n`;
  return {
    xml, lost,
    counts: { groups: groups.length, nodes: (spec.nodes || []).length, named: stats.named, images: stats.images, wires: (spec.wires || []).length, steps: (spec.steps || []).length, notes: (spec.notes || []).length },
  };
}

/** A plain .drawio document (XML string) for one diagram spec. */
export function toDrawio(spec, opts) { return exportDrawio(spec, opts).xml; }
