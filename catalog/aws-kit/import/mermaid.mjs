// mermaid.mjs: Mermaid <-> Prism AWS kit (k33bz fork). No deps.
//
//   fromMermaid(text, { id, name, story: 'auto' | 'none' })
//     -> { spec, report: { dialect, issues: [{ severity, code, element, message }], unmapped, tile, lint, story, icons } }
//   toMermaid(spec, { dialect: 'flowchart' | 'architecture-beta' }) -> Mermaid text (architecture-beta throws
//     with the reason when the spec's grid is not consistent)
//
// Dialects: architecture-beta (groups, services, junctions, edge sides, arrows, {group} ends, edge titles,
// align row/column) and flowchart (subgraphs, node shapes, @{ icon, label } and @{ shape }, every link type,
// labels, & chains, edge ids). PlantUML-AWS and D2 come from plantuml.mjs and d2.mjs over the same model.
// Directives ride in comments: %% prism: flow a>b>c | kind vpc=vpc | icon n=box | name ... | desc ... |
// dur 8 | step 1: text | peer a b | note g=10.0.0.0/16 | story none.
//
// CLI:
//   node catalog/aws-kit/import/mermaid.mjs <file.mmd|.puml|.d2> [--id x] [--name "..."] [--out spec.json]
//        [--svg out.svg] [--theme light|dark] [--story none]    -> report summary (and files)
//   node catalog/aws-kit/import/mermaid.mjs --export <family spec> <diagram id> [--dialect flowchart|architecture-beta]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { newIr, issue, directive, cleanText, buildSpec, prepare } from './ir.mjs';
import { gridFromSides } from './layout.mjs';
import { wrap } from '../place.mjs';

// ---------------------------------------------------------------------------------------------------
// shared: frontmatter, %% comments and %% prism: directives
function preamble(text, ir) {
  let t = String(text).replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const fm = t.match(/^\s*---\n([\s\S]*?)\n---[ \t]*\n/);
  if (fm) {
    const m = fm[1].match(/^title:\s*(.+)$/m);
    if (m) ir.title = cleanText(m[1]);
    t = t.slice(fm[0].length);
  }
  const lines = [];
  t.split('\n').forEach((raw, i) => {
    const d = raw.match(/^\s*%%\s*prism\s*:\s*(.*)$/i);
    if (d) { directive(ir, d[1], i + 1); lines.push({ text: '', n: i + 1 }); return; }
    if (/^\s*%%/.test(raw)) { lines.push({ text: '', n: i + 1 }); return; }
    lines.push({ text: raw, n: i + 1 });
  });
  return lines;
}
const ID = '[A-Za-z0-9_](?:[-\\w]*\\w)?';
const TITLE = '\\[(?:"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|[^\\]]*)\\]';
const unq = (t) => { if (t == null) return null; const s = t.trim().replace(/^\[|\]$/g, '').trim(); return /^".*"$|^'.*'$/s.test(s) ? s.slice(1, -1).replace(/\\(.)/g, '$1') : s; };
const bareTitleOk = (t) => /^\[[\w ]*\]$/.test(t.trim()) || /^\[\s*["']/.test(t.trim());

// ---------------------------------------------------------------------------------------------------
// architecture-beta
export function parseArchitecture(text) {
  const ir = newIr('mermaid-architecture');
  ir.sided = true;
  const lines = preamble(text, ir);
  const head = lines.findIndex((l) => /^\s*architecture-beta\s*$/.test(l.text));
  if (head < 0) throw new Error('not a Mermaid architecture-beta diagram');
  const DECL = new RegExp(`^(group|service)\\s+(${ID})\\s*(?:\\(([^)]*)\\))?\\s*(${TITLE})?\\s*(?:in\\s+(${ID}))?\\s*$`);
  const JUNC = new RegExp(`^junction\\s+(${ID})\\s*(?:in\\s+(${ID}))?\\s*$`);
  const EDGE = new RegExp(`^(${ID})(\\{group\\})?\\s*:\\s*([LRTB])\\s*(<)?\\s*(?:--|-\\s*(${TITLE})\\s*-)\\s*(>)?\\s*([LRTB])\\s*:\\s*(${ID})(\\{group\\})?\\s*$`);
  const ALIGN = /^align\s+(row|column)\s+(.+)$/;
  const titleCheck = (t, el) => { if (t && !bareTitleOk(t)) issue(ir, 'info', 'mermaid-title', el, `title ${t.trim()} has characters Mermaid 11 rejects unquoted; write ["${unq(t)}"]`); };
  for (const { text: raw, n } of lines.slice(head + 1)) {
    const l = raw.trim();
    if (!l) continue;
    let m;
    if ((m = l.match(DECL))) {
      const [, kind, id, icon, title, parent] = m;
      titleCheck(title, id);
      const o = { id, icon: icon ? icon.trim() : null, label: title != null ? unq(title) : null, parent: parent || null, line: n };
      if (kind === 'group') ir.groups.push(o); else ir.nodes.push(o);
    } else if ((m = l.match(JUNC))) {
      ir.nodes.push({ id: m[1], junction: true, parent: m[2] || null, line: n });
    } else if ((m = l.match(EDGE))) {
      const [, a, ag, sa, lt, title, gt, sb, b, bg] = m;
      titleCheck(title, `${a}-${b}`);
      ir.edges.push({ a, b, sa, sb, aHead: !!lt, bHead: !!gt, aGroup: !!ag, bGroup: !!bg, label: title != null ? unq(title) : null, src: l, line: n });
    } else if ((m = l.match(ALIGN))) {
      ir.aligns.push({ axis: m[1], ids: m[2].trim().split(/\s+/), src: l });
    } else if ((m = l.match(/^accTitle\s*:\s*(.+)$/))) ir.meta.aria = m[1].trim();
    else if ((m = l.match(/^accDescr\s*:\s*(.+)$/))) ir.meta.desc = m[1].trim();
    else if (/^title\s+/.test(l)) ir.title = ir.title || l.replace(/^title\s+/, '').trim();
    else issue(ir, 'warn', 'parse', `line ${n}`, `line ${n} is not architecture-beta: ${l}`);
  }
  // group-end edges must start in a group
  for (const e of ir.edges) for (const [x, g] of [[e.a, e.aGroup], [e.b, e.bGroup]]) {
    const node = ir.nodes.find((q) => q.id === x);
    if (g && (!node || !node.parent)) issue(ir, 'warn', 'group-edge', e.src, `${x}{group} needs ${x} to be inside a group; drew the edge to ${x} itself`);
  }
  return ir;
}

// ---------------------------------------------------------------------------------------------------
// flowchart
const OPENERS = [['(((', ')))', 'circle'], ['([', '])', 'stadium'], ['[[', ']]', 'subroutine'], ['[(', ')]', 'cylinder'], ['((', '))', 'circle'], ['{{', '}}', 'hexagon'], ['[/', ']', 'para'], ['[\\', ']', 'para'], ['[', ']', 'rect'], ['(', ')', 'round'], ['{', '}', 'diamond'], ['>', ']', 'flag']];
function scanClose(s, j, close) {
  let q = null;
  for (let k = j; k < s.length; k++) {
    const c = s[k];
    if (q) { if (c === '\\') { k++; continue; } if (c === q) q = null; continue; }
    if (c === '"') { q = c; continue; }
    if (s.startsWith(close, k)) return k;
  }
  return -1;
}
function scanNode(s, i) {
  const m = /^[A-Za-z0-9_À-￿]+(?:-(?![-.>=])[A-Za-z0-9_À-￿]+)*/.exec(s.slice(i));
  if (!m) return null;
  let j = i + m[0].length;
  const ref = { id: m[0], text: null, shape: null, attrs: null };
  if (s.startsWith('@{', j)) {
    const k = scanClose(s, j + 2, '}');
    if (k < 0) return null;
    ref.attrs = parseAttrs(s.slice(j + 2, k));
    j = k + 1;
  } else {
    for (const [o, c, shape] of OPENERS) {
      if (!s.startsWith(o, j)) continue;
      const k = scanClose(s, j + o.length, c);
      if (k < 0) return null;
      ref.text = s.slice(j + o.length, k).replace(/[/\\]$/, '');
      ref.shape = shape;
      j = k + c.length;
      break;
    }
  }
  const cls = /^:::[\w-]+/.exec(s.slice(j));
  if (cls) j += cls[0].length;
  ref.end = j;
  return ref;
}
// @{ key: value, key: "value" } (YAML-like)
function parseAttrs(src) {
  const out = {};
  for (const m of src.matchAll(/([A-Za-z]+)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,}]+)/g)) {
    let v = m[2].trim();
    if (/^".*"$|^'.*'$/s.test(v)) v = v.slice(1, -1).replace(/\\(.)/g, '$1');
    out[m[1]] = v;
  }
  return out;
}
const TEXT_LINK = /^\s*(?:([A-Za-z_]\w*)@)?([xo<]?)(-{2}|={2}|-\.)\s+(?![->.=])(.+?)\s+(-{2,}[->xo]|={2,}[=>xo]|\.+-[>xo]?)(?=\s|[A-Za-z0-9_"])\s*/;
const PLAIN_LINK = /^\s*(?:([A-Za-z_]\w*)@)?([xo<]?)(-{2,}|={2,}|-?\.+-|~{3,})([>xo]?)\s*(?:\|((?:[^|"]|"[^"]*")*)\|)?\s*/;
function scanLink(s, i) {
  const rest = s.slice(i);
  let m;
  if ((m = rest.match(TEXT_LINK))) {
    const end = m[5];
    return { id: m[1] || null, aHead: !!m[2], bHead: /[>xo]$/.test(end), dashed: m[3] === '-.', thick: m[3] === '==', label: m[4], end: i + m[0].length };
  }
  if ((m = rest.match(PLAIN_LINK))) {
    const body = m[3];
    if (/^~/.test(body)) return { invisible: true, end: i + m[0].length };
    return { id: m[1] || null, aHead: !!m[2], bHead: !!m[4], dashed: body.includes('.'), thick: body.startsWith('='), label: m[5] != null ? m[5] : null, end: i + m[0].length };
  }
  return null;
}
const splitStatements = (l) => {
  const out = []; let q = null, depth = 0, cur = '';
  for (let k = 0; k < l.length; k++) {
    const c = l[k];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"') { q = c; cur += c; continue; }
    if ('[({'.includes(c)) depth++; else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    if (c === ';' && !depth) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
};
const JUNCTION_SHAPES = new Set(['f-circ', 'junction', 'filled-circle', 'sm-circ', 'small-circle', 'fr-circ', 'framed-circle', 'stop', 'start']);
export function parseFlowchart(text) {
  const ir = newIr('mermaid-flowchart');
  const lines = preamble(text, ir);
  const h = lines.findIndex((l) => /^\s*(flowchart|graph)(-elk)?\b/.test(l.text));
  if (h < 0) throw new Error('not a Mermaid flowchart');
  const hm = lines[h].text.match(/^\s*(?:flowchart|graph)(?:-elk)?\s+(LR|RL|TD|TB|BT)\b/);
  ir.dir = hm ? (hm[1] === 'TB' ? 'TD' : hm[1]) : 'TD';
  const nodes = new Map(), stack = [], mentions = [];
  const claimed = new Map();   // node -> subgraph (innermost closes first, like Mermaid)
  let ignored = 0, invisible = 0;
  const ensure = (ref) => {
    let n = nodes.get(ref.id);
    if (!n) { n = { id: ref.id, label: null, icon: null, parent: null, iconFrom: 'mermaid' }; nodes.set(ref.id, n); ir.nodes.push(n); }
    if (stack.length) stack[stack.length - 1].mentions.add(ref.id);
    if (ref.text != null) { n.label = cleanText(ref.text); n.shapeHint = ref.shape; n.explicit = true; }
    if (ref.attrs) {
      const a = ref.attrs;
      n.explicit = true;
      if (a.icon) n.icon = a.icon;
      if (a.label != null) n.label = cleanText(a.label);
      if (a.shape && JUNCTION_SHAPES.has(a.shape)) n.junction = true;
      else if (a.shape) n.shapeHint = /stadium|pill|terminal/.test(a.shape) ? 'stadium' : a.shape;
      if (a.img) { n.img = a.img; issue(ir, 'info', 'image', ref.id, `image node ${ref.id}: images are not imported; resolved by its label`); }
    }
    return n;
  };
  for (const { text: raw, n: lineNo } of lines.slice(h + 1)) {
    for (const l of splitStatements(raw.trim())) {
      let m;
      if ((m = l.match(/^subgraph\s+(.+)$/))) {
        const rest = m[1].trim();
        let id, title;
        const a = rest.match(/^([A-Za-z0-9_][\w-]*)\s*\[\s*(.*?)\s*\]$/);
        if (a) { id = a[1]; title = cleanText(a[2]); }
        else if (/^["']/.test(rest) || /\s/.test(rest)) { title = cleanText(rest); id = title.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') || `sg${ir.groups.length + 1}`; }
        else { id = rest; title = rest; }
        const g = { id, label: title, icon: null, parent: stack.length ? stack[stack.length - 1].id : null, mentions: new Set(), line: lineNo };
        ir.groups.push(g); stack.push(g);
        continue;
      }
      if (l === 'end') {
        const g = stack.pop();
        if (g) for (const id of g.mentions) if (!claimed.has(id)) claimed.set(id, g.id);
        continue;
      }
      if (/^direction\s+(LR|RL|TB|TD|BT)$/.test(l)) { if (!stack.length) ir.dir = l.split(/\s+/)[1].replace('TB', 'TD'); continue; }
      if (/^(classDef|class|style|linkStyle|click|callback)\b/.test(l)) { ignored++; continue; }
      if ((m = l.match(/^accTitle\s*:\s*(.+)$/))) { ir.meta.aria = m[1].trim(); continue; }
      if ((m = l.match(/^accDescr\s*:\s*(.+)$/))) { ir.meta.desc = m[1].trim(); continue; }
      if (/^title\s+/.test(l)) { ir.title = ir.title || l.replace(/^title\s+/, '').trim(); continue; }
      // node (link node)*, with & groups on either side
      let i = 0;
      const readGroup = () => {
        const refs = [];
        for (;;) {
          while (l[i] === ' ' || l[i] === '\t') i++;
          const r = scanNode(l, i);
          if (!r) return refs.length ? refs : null;
          refs.push(ensure(r)); i = r.end;
          const amp = l.slice(i).match(/^\s*&\s*/);
          if (amp) { i += amp[0].length; continue; }
          return refs;
        }
      };
      let prev = readGroup();
      if (!prev) { issue(ir, 'warn', 'parse', `line ${lineNo}`, `line ${lineNo} is not flowchart syntax: ${l}`); continue; }
      while (i < l.length) {
        const k = scanLink(l, i);
        if (!k) { if (l.slice(i).trim()) issue(ir, 'warn', 'parse', `line ${lineNo}`, `line ${lineNo}: could not read "${l.slice(i).trim()}"`); break; }
        i = k.end;
        const nxt = readGroup();
        if (!nxt) { issue(ir, 'warn', 'parse', `line ${lineNo}`, `line ${lineNo}: a link with no target`); break; }
        if (k.invisible) invisible++;
        else for (const a of prev) for (const b of nxt) ir.edges.push({ id: k.id, a: a.id, b: b.id, aHead: k.aHead, bHead: k.bHead, dashed: k.dashed, thick: k.thick, label: k.label != null ? cleanText(k.label) : null, src: l, line: lineNo });
        prev = nxt;
      }
    }
  }
  while (stack.length) { const g = stack.pop(); for (const id of g.mentions) if (!claimed.has(id)) claimed.set(id, g.id); issue(ir, 'warn', 'parse', g.id, `subgraph ${g.id} has no end`); }
  for (const n of ir.nodes) n.parent = claimed.get(n.id) || null;
  // a link to a subgraph id ends on that subgraph's border
  const gids = new Set(ir.groups.map((g) => g.id));
  ir.nodes = ir.nodes.filter((n) => !(gids.has(n.id) && !n.explicit));
  for (const g of ir.groups) delete g.mentions;
  if (ignored) issue(ir, 'info', 'styling', null, `${ignored} classDef/class/style/linkStyle/click statement(s) ignored: the kit's theme sets colors`);
  if (invisible) issue(ir, 'info', 'invisible-link', null, `${invisible} invisible link(s) (~~~) ignored`);
  return ir;
}

// ---------------------------------------------------------------------------------------------------
export function detectDialect(text) {
  const t = String(text).replace(/\r/g, '').replace(/^﻿/, '').replace(/^\s*---\n[\s\S]*?\n---[ \t]*\n/, '');
  for (const l of t.split('\n')) {
    const s = l.trim();
    if (!s || s.startsWith('%%')) continue;
    if (/^architecture-beta\b/.test(s)) return 'architecture-beta';
    if (/^(flowchart|graph)(-elk)?\b/.test(s)) return 'flowchart';
    return null;
  }
  return null;
}
export function fromMermaid(text, opts = {}) {
  const d = detectDialect(text);
  if (!d) throw new Error('not a Mermaid architecture-beta or flowchart diagram (the first statement must be architecture-beta, flowchart or graph)');
  const ir = d === 'architecture-beta' ? parseArchitecture(text) : parseFlowchart(text);
  return buildSpec(ir, opts);
}

// ---------------------------------------------------------------------------------------------------
// export: a spec back to Mermaid text
const GROUP_ICON = { cloud: 'grp-cloud-logo', 'cloud-plain': 'grp-cloud', region: 'grp-region', vpc: 'grp-virtual-private-cloud-vpc', pub: 'grp-public-subnet', priv: 'grp-private-subnet', asg: 'grp-auto-scaling-group', acct: 'grp-account', dc: 'grp-corporate-data-center', server: 'grp-server-contents', ec2: 'grp-ec2-instance-contents', spot: 'grp-spot-fleet', iot: 'grp-iot-greengrass-deployment' };
const DEF_LABEL = { cloud: 'AWS Cloud', 'cloud-plain': 'AWS Cloud', region: 'Region', az: 'Availability Zone', vpc: 'VPC', pub: 'Public subnet', priv: 'Private subnet', sg: 'Security group', asg: 'Auto Scaling group', acct: 'AWS account', dc: 'Corporate data center', server: 'Server contents', ec2: 'EC2 instance contents', spot: 'Spot Fleet', iot: 'AWS IoT Greengrass deployment', gen: 'Group' };
const RESERVED = new Set(['end', 'subgraph', 'graph', 'flowchart', 'style', 'class', 'classDef', 'click', 'linkStyle', 'direction', 'default', 'call', 'href', 'interpolate', 'junction', 'group', 'service', 'in', 'align']);
const packKey = (icon) => { const m = String(icon).match(/^aws-(svc|res|grp|cat)-(.+)$/); return m ? `${m[1]}-${m[2]}` : String(icon); };
const pathPts = (d) => { const o = []; let x = 0, y = 0; for (const [, c, v] of String(d).matchAll(/([MHVL])\s*([-\d.]+(?:[ ,][-\d.]+)?)/g)) { const n = v.split(/[ ,]/).map(Number); if (c === 'M' || c === 'L') { x = n[0]; y = n[1]; } else if (c === 'H') x = n[0]; else y = n[0]; o.push([x, y]); } return o; };

// the graph a spec draws: nodes and groups by containment, each wire's two ends (node, group border or a
// junction point shared with other wires), in the order the spec lists them
export function specGraph(spec) {
  const used = new Set();
  const mid = (s, p) => { let id = String(s).replace(/[^A-Za-z0-9_]/g, '_'); if (!/^[A-Za-z]/.test(id) || RESERVED.has(id) || /^[ox]_|^[ox]$/.test(id)) id = `${p}_${id}`; let k = id, i = 2; while (used.has(k)) k = `${id}_${i++}`; used.add(k); return k; };
  const groups = (spec.groups || []).map((g, i) => ({ ...g, i, mid: mid(g.id || `g${i + 1}_${g.kind}`, 'g') }));
  const contains = (g, x, y, strict) => (strict ? x > g.x && x < g.x + g.w && y > g.y && y < g.y + g.h : x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h);
  const area = (g) => g.w * g.h;
  for (const g of groups) g.parent = groups.filter((o) => o !== g && o.x <= g.x && o.y <= g.y && o.x + o.w >= g.x + g.w && o.y + o.h >= g.y + g.h && area(o) > area(g)).sort((a, b) => area(a) - area(b))[0] || null;
  const nodes = (spec.nodes || []).map((n) => {
    const s = n.kind ? null : n.size || 40, w = n.kind ? n.w : s, h = n.kind ? n.h : s;
    const lh = !n.kind && n.label && (n.labelPos || 'b') === 'b' ? 13 * wrap(n.label, n.wrap).length + (n.sub ? 11 : 0) : 0;
    const cx = n.x + w / 2, cy = n.y + h / 2;
    const parent = groups.filter((g) => contains(g, cx, cy, false)).sort((a, b) => area(a) - area(b))[0] || null;
    return { ...n, mid: mid(n.id, 'n'), cx, cy, box: { x0: n.x, y0: n.y, x1: n.x + w, y1: n.y + h + lh }, parent };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const dist = (p, b) => Math.hypot(Math.max(b.x0 - p[0], 0, p[0] - b.x1), Math.max(b.y0 - p[1], 0, p[1] - b.y1));
  const junctions = [];
  const ends = (spec.wires || []).map((w) => {
    if (!w.d) return { w, a: { node: byId.get(w.from) }, b: { node: byId.get(w.to) }, pts: null };
    const pts = pathPts(w.d);
    return { w, pts, a: { pt: pts[0], node: w.from && byId.get(w.from) }, b: { pt: pts[pts.length - 1], node: w.to && byId.get(w.to) } };
  });
  const resolveEnd = (e, other) => {
    if (e.node) return e;
    const p = e.pt;
    const near = nodes.map((n) => ({ n, d: dist(p, n.box) })).sort((x, y) => x.d - y.d)[0];
    if (near && near.d <= 14) return { node: near.n, pt: p };
    const onBorder = groups.filter((g) => (Math.abs(p[0] - g.x) < 4 || Math.abs(p[0] - g.x - g.w) < 4) && p[1] >= g.y - 2 && p[1] <= g.y + g.h + 2 || (Math.abs(p[1] - g.y) < 4 || Math.abs(p[1] - g.y - g.h) < 4) && p[0] >= g.x - 2 && p[0] <= g.x + g.w + 2).sort((a, b) => area(a) - area(b))[0];
    const shared = ends.some((o) => o !== other && o.pts && o.pts.some((q, i) => (i === 0 || i === o.pts.length - 1) ? Math.hypot(q[0] - p[0], q[1] - p[1]) < 3 : false));
    if (onBorder && !shared) return { group: onBorder, pt: p };
    let j = junctions.find((x) => Math.hypot(x.pt[0] - p[0], x.pt[1] - p[1]) < 3);
    if (!j) { j = { pt: p, mid: mid(`j${junctions.length + 1}`, 'j'), parent: groups.filter((g) => contains(g, p[0], p[1], true)).sort((a, b) => area(a) - area(b))[0] || null }; junctions.push(j); }
    return { junction: j, pt: p };
  };
  for (const e of ends) { e.a = resolveEnd(e.a, e); e.b = resolveEnd(e.b, e); }
  return { groups, nodes, junctions, ends };
}
const endId = (x) => (x.node ? x.node.mid : x.group ? x.group.mid : x.junction.mid);
const mq = (s) => String(s).replace(/"/g, '#quot;').replace(/\|/g, '#124;').replace(/\n/g, '<br>');
const yq = (s) => JSON.stringify(String(s)).replace(/\\n/g, '<br>');

export function toMermaid(spec, { dialect = 'flowchart' } = {}) {
  if (!spec || !Array.isArray(spec.nodes)) throw new Error('toMermaid takes one diagram spec (an entry of a family\'s diagrams)');
  if (dialect === 'architecture-beta') return toArchitecture(spec);
  if (dialect !== 'flowchart') throw new Error(`unknown dialect ${dialect}: flowchart or architecture-beta`);
  const G = specGraph(spec);
  const stepOf = new Map();
  for (const s of spec.steps || []) if (s.at && !stepOf.has(s.at)) stepOf.set(s.at, s.n);
  const texts = new Map();
  for (const s of spec.steps || []) if (s.text && !texts.has(String(s.n))) texts.set(String(s.n), s.text);
  const out = ['flowchart LR'];
  const dropped = [['timeline windows', (spec.timeline || []).length], ['effects', (spec.effects || []).length], ['notes', (spec.notes || []).length], ['marks', (spec.marks || []).length], ['extra markup', spec.extra ? 1 : 0], ['legend', spec.legend ? 1 : 0]].filter(([, n]) => n).map(([k, n]) => `${n} ${k}`);
  out.push(`    %% exported from the Prism AWS kit diagram ${spec.id}${dropped.length ? `; not carried: ${dropped.join(', ')}` : ''}`);
  if (spec.name) out.push(`    %% prism: name ${spec.name}`);
  if (spec.desc) out.push(`    %% prism: desc ${spec.desc.replace(/\s+/g, ' ')}`);
  if (spec.dur) out.push(`    %% prism: dur ${spec.dur}`);
  if (G.groups.length) out.push(`    %% prism: kind ${G.groups.map((g) => `${g.mid}=${g.kind}`).join(' ')}`);
  for (const g of G.groups) if (g.note) out.push(`    %% prism: note ${g.mid}=${g.note}`);
  const boxes = G.nodes.filter((n) => n.kind);
  if (boxes.length) out.push(`    %% prism: icon ${boxes.map((n) => `${n.mid}=${n.kind}`).join(' ')}`);
  for (const [n, t] of [...texts].sort((a, b) => Number(a[0]) - Number(b[0]))) out.push(`    %% prism: step ${n}: ${t.replace(/\s+/g, ' ')}`);
  const nodeLine = (n, ind) => {
    if (n.kind) return `${ind}${n.mid}${n.kind === 'pill' ? '(["' : '["'}${mq(n.label || n.id)}${n.kind === 'pill' ? '"])' : '"]'}`;
    const icon = Array.isArray(n.icon) ? n.icon[1] || n.icon[0] : n.icon;
    return `${ind}${n.mid}@{ icon: "aws:${packKey(String(icon).replace(/-(dark|light)$/, ''))}", form: "square", label: ${yq([n.label || n.id, n.sub].filter(Boolean).join('\n'))}, pos: "b", h: 48 }`;
  };
  const emit = (parent, ind) => {
    for (const g of G.groups.filter((x) => x.parent === parent)) {
      out.push(`${ind}subgraph ${g.mid}["${mq(g.label != null ? g.label || DEF_LABEL[g.kind] : DEF_LABEL[g.kind])}"]`);
      emit(g, ind + '  ');
      out.push(`${ind}end`);
    }
    for (const n of G.nodes.filter((x) => x.parent === parent)) out.push(nodeLine(n, ind));
    for (const j of G.junctions.filter((x) => x.parent === parent)) out.push(`${ind}${j.mid}@{ shape: f-circ }`);
  };
  emit(null, '    ');
  for (const e of G.ends) {
    const w = e.w;
    const lab = [stepOf.has(w.id) ? `${stepOf.get(w.id)}:` : '', w.label ? String(w.label).replace(/\n/g, ' ') : ''].join(' ').trim();
    const op = w.dashed ? (w.both ? '<-.->' : w.arrow === false ? '-.-' : '-.->') : (w.both ? '<-->' : w.arrow === false ? '---' : '-->');
    out.push(`    ${endId(e.a)} ${op}${lab ? `|"${mq(lab)}"|` : ''} ${endId(e.b)}`);
  }
  return out.join('\n') + '\n';
}

// architecture-beta: only when the edge sides reproduce the spec's grid
function toArchitecture(spec) {
  const G = specGraph(spec);
  const why = [];
  const sideAt = (pts, start) => {
    const [a, b] = start ? [pts[0], pts[1]] : [pts[pts.length - 1], pts[pts.length - 2]];
    if (a[1] === b[1]) return b[0] > a[0] ? 'R' : 'L';
    return b[1] > a[1] ? 'B' : 'T';
  };
  const edges = [];
  for (const e of G.ends) {
    if (e.a.group || e.b.group) { why.push(`wire ${e.w.id} ends on a group border`); continue; }
    let sa, sb;
    const A = e.a.node || e.a.junction, B = e.b.node || e.b.junction;
    if (e.pts && e.pts.length > 1) { sa = sideAt(e.pts, true); sb = sideAt(e.pts, false); }
    else { const dx = B.cx - A.cx, dy = B.cy - A.cy; if (Math.abs(dx) >= Math.abs(dy)) { sa = dx > 0 ? 'R' : 'L'; sb = dx > 0 ? 'L' : 'R'; } else { sa = dy > 0 ? 'B' : 'T'; sb = dy > 0 ? 'T' : 'B'; } }
    edges.push({ e, sa, sb });
  }
  const port = new Map();
  for (const { e, sa, sb } of edges) for (const [x, s] of [[endId(e.a), sa], [endId(e.b), sb]]) { const k = `${x}:${s}`; port.set(k, (port.get(k) || 0) + 1); }
  for (const [k, n] of port) if (n > 1 && !k.startsWith('j')) why.push(`port ${k} carries ${n} edges (Mermaid stacks them on one point)`);
  const title = (s) => (/^[\w ]*$/.test(s) ? `[${s}]` : `["${String(s).replace(/"/g, "'")}"]`);
  const lines = ['architecture-beta', `    %% exported from the Prism AWS kit diagram ${spec.id}`];
  if (spec.name) lines.push(`    %% prism: name ${spec.name}`);
  if (G.groups.length) lines.push(`    %% prism: kind ${G.groups.map((g) => `${g.mid}=${g.kind}`).join(' ')}`);
  for (const g of G.groups) lines.push(`    group ${g.mid}${g.icon && typeof g.icon === 'string' ? `(aws:${packKey(g.icon)})` : GROUP_ICON[g.kind] ? `(aws:${GROUP_ICON[g.kind]})` : ''}${title(g.label || DEF_LABEL[g.kind])}${g.parent ? ` in ${g.parent.mid}` : ''}`);
  for (const n of G.nodes) {
    const icon = n.kind ? 'server' : `aws:${packKey(String(Array.isArray(n.icon) ? n.icon[1] : n.icon).replace(/-(dark|light)$/, ''))}`;
    lines.push(`    service ${n.mid}(${icon})${title(n.label || n.id)}${n.parent ? ` in ${n.parent.mid}` : ''}`);
  }
  for (const j of G.junctions) lines.push(`    junction ${j.mid}${j.parent ? ` in ${j.parent.mid}` : ''}`);
  const stepOf = new Map();
  for (const s of spec.steps || []) if (s.at && !stepOf.has(s.at)) stepOf.set(s.at, s.n);
  for (const { e, sa, sb } of edges) {
    const w = e.w;
    const lab = [stepOf.has(w.id) ? `${stepOf.get(w.id)}:` : '', w.label ? String(w.label).replace(/\n/g, ' ') : ''].join(' ').trim();
    const body = lab ? `-${title(lab)}-` : '--';
    lines.push(`    ${endId(e.a)}:${sa} ${w.both ? '<' : ''}${body}${w.arrow === false ? '' : '>'} ${sb}:${endId(e.b)}`);
  }
  const text = lines.join('\n') + '\n';
  // the grid the sides imply must match the spec's own arrangement
  if (!why.length) {
    const ir = parseArchitecture(text);
    const model = prepare(ir);
    for (const n of model.nodes.values()) n.fw = n.up = n.down = 0;
    const pos = gridFromSides(model);
    for (const x of ir.issues) if (/^grid-/.test(x.code) && x.severity !== 'info') why.push(x.message);
    const at = new Map();
    for (const n of G.nodes) at.set(n.mid, [n.cx, n.cy]);
    for (const j of G.junctions) at.set(j.mid, j.pt);
    const ids = [...at.keys()].filter((k) => pos.has(k));
    const sgn = (v) => (Math.abs(v) < 4 ? 0 : Math.sign(v));
    for (let i = 0; i < ids.length && why.length < 6; i++) for (let k = i + 1; k < ids.length; k++) {
      const [a, b] = [ids[i], ids[k]], pa = pos.get(a), pb = pos.get(b), sa = at.get(a), sb = at.get(b);
      if (Math.sign(pb[0] - pa[0]) !== sgn(sb[0] - sa[0]) || Math.sign(pb[1] - pa[1]) !== sgn(sb[1] - sa[1])) { why.push(`the edge sides put ${b} ${where(pb[0] - pa[0], pb[1] - pa[1])} ${a}, the spec draws it ${where(sb[0] - sa[0], sb[1] - sa[1])} it`); break; }
    }
  }
  if (why.length) throw new Error(`architecture-beta needs a consistent grid, and ${spec.id} has none: ${[...new Set(why)].slice(0, 6).join('; ')}. Export a flowchart instead.`);
  return text;
}
const where = (dx, dy) => [dx ? (dx > 0 ? 'right of' : 'left of') : '', dy ? (dy > 0 ? 'below' : 'above') : ''].filter(Boolean).join(' and ') || 'level with';

// ---------------------------------------------------------------------------------------------------
// CLI
async function main(argv) {
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  if (argv.includes('--export')) {
    const i = argv.indexOf('--export'), file = argv[i + 1], did = argv[i + 2];
    if (!file || !did) { console.error('usage: mermaid.mjs --export <family spec .mjs|.json> <diagram id> [--dialect flowchart|architecture-beta]'); return 2; }
    const fam = /\.json$/i.test(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : (await import(pathToFileURL(path.resolve(file)).href)).default;
    const d = fam.diagrams.find((x) => x.id === did || 'aws-' + x.id === did);
    if (!d) { console.error(`no diagram ${did} in ${file} (has: ${fam.diagrams.map((x) => x.id).join(', ')})`); return 1; }
    try { process.stdout.write(toMermaid(d, { dialect: opt('--dialect') || 'flowchart' })); } catch (err) { console.error(err.message); return 1; }
    return 0;
  }
  const file = argv.find((a, i) => !a.startsWith('--') && (i === 0 || !['--id', '--name', '--out', '--svg', '--theme', '--story', '--dialect'].includes(argv[i - 1])));
  if (!file) { console.error('usage: mermaid.mjs <file.mmd|.puml|.d2> [--id x] [--name "..."] [--out spec.json] [--svg out.svg] [--theme light|dark] [--story none]\n       mermaid.mjs --export <family spec> <diagram id> [--dialect flowchart|architecture-beta]'); return 2; }
  const text = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file).toLowerCase();
  const o = { id: opt('--id'), name: opt('--name'), story: opt('--story') || 'auto', file: path.basename(file) };
  let res;
  if (ext === '.puml' || ext === '.plantuml' || ext === '.pu' || /^\s*@startuml/m.test(text)) res = (await import('./plantuml.mjs')).fromPlantUml(text, o);
  else if (ext === '.d2') res = (await import('./d2.mjs')).fromD2(text, o);
  else res = fromMermaid(text, o);
  const { spec, report } = res;
  const n = (s) => report.issues.filter((x) => x.severity === s).length;
  const ln = (s) => report.lint.filter((x) => x.severity === s).length;
  console.log(`${file}: ${report.dialect} -> ${spec.id} (${report.tile.size} tile ${spec.w}x${spec.h}${report.tile.fits ? '' : ', larger than any tile'})`);
  console.log(`  ${spec.nodes.length} nodes, ${(spec.groups || []).length} groups, ${spec.wires.length} wires, ${(spec.steps || []).length} steps, ${(spec.timeline || []).length} packet windows (story: ${report.story.channel})`);
  console.log(`  issues: ${n('error')} error, ${n('warn')} warn, ${n('info')} info; unmapped: ${report.unmapped.length}; lint: ${ln('error')} error, ${ln('warn')} warn, ${ln('info')} info`);
  for (const x of report.issues) console.log(`  ${x.severity.padEnd(5)} ${String(x.code).padEnd(15)} ${x.element ? `[${x.element}] ` : ''}${x.message}`);
  for (const x of report.lint.filter((f) => f.severity !== 'info')) console.log(`  lint ${x.severity.padEnd(5)} ${x.code.padEnd(14)} ${x.message}`);
  if (opt('--out')) {
    const { canonical, toJson } = await import('../spec.mjs');
    const fam = canonical({ section: { id: 'imported', title: 'IMPORTED' }, diagrams: [spec] }).family;
    fs.writeFileSync(path.resolve(opt('--out')), toJson(fam) + '\n');
    console.log(`  wrote ${opt('--out')} (a family file: node catalog/aws-kit/awd.mjs preview ${opt('--out')})`);
  }
  if (opt('--svg')) {
    const { standalone } = await import('../awd.mjs');
    fs.writeFileSync(path.resolve(opt('--svg')), standalone(spec, { theme: opt('--theme') || 'auto' }));
    console.log(`  wrote ${opt('--svg')}`);
  }
  return n('error') ? 1 : 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
