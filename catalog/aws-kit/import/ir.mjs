// ir.mjs: the intermediate model the text importers share (Mermaid architecture-beta and flowchart,
// PlantUML-AWS, D2) and the pipeline that turns it into one awd diagram spec (k33bz fork). No deps.
//
//   const ir = newIr('mermaid-flowchart');  ...the parser fills ir...
//   const { spec, report } = buildSpec(ir, { id, name, story: 'auto' | 'none' });
//
// IR = { dialect, title, dir: 'LR'|'RL'|'TD'|'BT', sided (edge sides place nodes),
//        groups: [{ id, label, icon, parent, kind? (explicit, e.g. a PlantUML macro) }],
//        nodes:  [{ id, label, sub, icon, iconFrom, parent, junction?, shapeHint? }],
//        edges:  [{ id?, a, b, sa, sb, aHead, bHead, dashed, label, aGroup, bGroup, soft, src }],
//        aligns: [{ axis: 'row'|'column', ids }], d2Steps: [{ label, edges: [edge index] }] | null,
//        directives: { flow: [[ids]], kind: {id: kind}, icon: {id: icon}, steps: {n: text}, peer: [[a, b]], name, desc, dur, story },
//        issues: [{ severity, code, element, message }] }
// An edge end that names a group (a flowchart link to a subgraph) ends on that group's border; aGroup /
// bGroup (architecture-beta {group}) end on the border of the node's own group.
import { resolveIcon, iconInfo } from '../../aws-icons/resolve.mjs';
import { checkSpec, lint as lintSpec } from '../awd.mjs';
import { validateDiagram } from '../spec.mjs';
import { story as storyOf } from '../story.mjs';
import { layout, placeLabels, DEFAULT_LABEL } from './layout.mjs';

export const KINDS = ['cloud', 'cloud-plain', 'region', 'az', 'vpc', 'pub', 'priv', 'sg', 'asg', 'acct', 'dc', 'server', 'ec2', 'spot', 'iot', 'gen'];
const KIND_WORDS = { public: 'pub', private: 'priv', subnet: 'priv', account: 'acct', datacenter: 'dc', 'data-center': 'dc', onprem: 'dc', generic: 'gen', group: 'gen', 'availability-zone': 'az', zone: 'az' };
const DIALECT_NAME = { 'mermaid-architecture': 'Mermaid architecture-beta', 'mermaid-flowchart': 'a Mermaid flowchart', plantuml: 'PlantUML', d2: 'D2' };
const ID_RE = /^[A-Za-z0-9_-]+$/;

export function newIr(dialect) {
  return {
    dialect, title: null, dir: 'LR', sided: false, groups: [], nodes: [], edges: [], aligns: [], d2Steps: null,
    directives: { flow: [], kind: {}, icon: {}, steps: {}, peer: [], note: {} }, issues: [], meta: {},
  };
}
export const issue = (ir, severity, code, element, message) => ir.issues.push({ severity, code, element, message });

// ---- directives: `%% prism: <key> <value>` in Mermaid, `' prism:` in PlantUML, `# prism:` in D2
//   flow a>b>c           the request path (repeat a hop backwards for the response)
//   kind vpc=vpc, aza=az group kinds (cloud region az vpc pub priv sg asg acct dc server ec2 spot iot gen)
//   icon fn=aws-svc-lambda | fn=box | fn=pill | fn=<any name the resolver knows>
//   name <tile title>    desc <description>    dur <seconds>    step <n>: <text>
//   peer a b             a replication or sync edge: same tier, not a hop
//   note vpc=10.0.0.0/16 a frame's right-aligned note      story none|auto
export function directive(ir, text, line) {
  const m = String(text).trim().match(/^([a-z]+)\b\s*(.*)$/i);
  if (!m) { issue(ir, 'info', 'directive', null, `unknown prism directive "${text}"`); return; }
  const key = m[1].toLowerCase(), val = m[2].trim();
  const pairs = () => val.split(/[,\s]+/).filter(Boolean).map((p) => p.split('=').map((x) => x.trim())).filter((p) => p.length === 2 && p[0] && p[1]);
  const D = ir.directives;
  if (key === 'flow') { const ids = val.split(/\s*(?:>|->|-->)\s*/).map((x) => x.trim()).filter(Boolean); if (ids.length > 1) D.flow.push(ids); else issue(ir, 'warn', 'directive', null, `flow needs at least two ids: "${text}"`); }
  else if (key === 'kind') for (const [g, k0] of pairs()) { const k = KIND_WORDS[k0.toLowerCase()] || k0.toLowerCase(); if (KINDS.includes(k)) D.kind[g] = k; else issue(ir, 'warn', 'directive', g, `kind ${k0} is not a group kind (${KINDS.join(' ')})`); }
  else if (key === 'icon') { const i = val.indexOf('='); if (i > 0) D.icon[val.slice(0, i).trim()] = val.slice(i + 1).trim(); }
  else if (key === 'note') { const i = val.indexOf('='); if (i > 0) D.note[val.slice(0, i).trim()] = val.slice(i + 1).trim(); }
  else if (key === 'step') { const s = val.match(/^(\d+)\s*[:.)]?\s*(.+)$/); if (s) D.steps[s[1]] = s[2].trim(); else issue(ir, 'warn', 'directive', null, `step needs a number and a text: "${text}"`); }
  else if (key === 'peer') { const ids = val.split(/[\s,]+/).filter(Boolean); if (ids.length === 2) D.peer.push(ids); }
  else if (key === 'dur') { const d = Number(val); if (d >= 2 && d <= 30) D.dur = d; else issue(ir, 'warn', 'directive', null, `dur must be 2 to 30 seconds: "${val}"`); }
  else if (['name', 'desc', 'story', 'id'].includes(key)) D[key] = val;
  else issue(ir, 'info', 'directive', null, `unknown prism directive "${key}"${line ? ` (line ${line})` : ''}`);
}

// text helpers: entities, markup and quotes the source formats wrap labels in
export function cleanText(s) {
  if (s == null) return null;
  let t = String(s).trim();
  if (/^".*"$/s.test(t) || /^'.*'$/s.test(t)) t = t.slice(1, -1);
  t = t.replace(/^`|`$/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/\\n/g, '\n').replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/#quot;/g, '"').replace(/#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
  return t.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}
export const safeId = (s, used, prefix = 'n') => {
  let id = String(s).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || prefix;
  if (/^ah/.test(id)) id = prefix + '-' + id;
  let k = id, i = 2;
  while (used.has(k)) k = `${id}-${i++}`;
  used.add(k);
  return k;
};

// ---- group kinds: the title, then the id, then the icon; a directive overrides
const KIND_RULES = [
  [/availability[ -]?zones?|\baz[-_ ]?[a-f1-6]?\b|\b[a-z]{2}(?:-gov)?-[a-z]+-\d[a-f]\b/, 'az'],
  [/public[ -]?subnets?|\bpub(?:lic)?[-_ ]?(?:subnet|sn|[a-d1-4])?\b|\bdmz\b/, 'pub'],
  [/private[ -]?subnets?|isolated[ -]?subnets?|\bpriv(?:ate)?[-_ ]?(?:subnet|sn|[a-d1-4])?\b|\bsubnets?\b/, 'priv'],
  [/\bvpcs?\b|virtual[ -]private[ -]cloud/, 'vpc'],
  [/\bregions?\b|\b(?:us|eu|ap|sa|ca|me|af|il|mx)(?:-gov)?-[a-z]+-\d\b/, 'region'],
  [/security[ -]?groups?|\bsg\b/, 'sg'],
  [/auto[ -]?scaling(?:[ -]?groups?)?|\basg\b/, 'asg'],
  [/\baccounts?\b|\bacct\b/, 'acct'],
  [/data[ -]?cent(?:er|re)|on[ -]?prem(?:ise|ises)?\b|corporate[ -]network|\bdc\b/, 'dc'],
  [/spot[ -]?fleet/, 'spot'], [/ec2 instance contents/, 'ec2'], [/server contents/, 'server'], [/greengrass/, 'iot'],
  [/^aws[ -]?cloud$|^cloud$|^aws$|^amazon web services$/, 'cloud'],
];
const stripCidr = (s) => String(s || '').replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?\b/g, ' ').replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
export function groupKind(g, ir) {
  const o = ir.directives.kind[g.id];
  if (o) return { kind: o, how: 'directive' };
  if (g.kind) return { kind: g.kind, how: 'explicit' };
  const tries = [[stripCidr(g.label), 'title'], [String(g.id || '').replace(/[_-]+/g, ' '), 'id']];
  for (const [s0, how] of tries) {
    const s = s0.toLowerCase();
    if (!s) continue;
    for (const [re, k] of KIND_RULES) if (re.test(s)) return { kind: k, how: `${how} words` };
    if (how === 'title') { const r = resolveIcon(s0); if (r.kind === 'group' && r.group && r.group !== 'gen') return { kind: r.group, how: `title (${r.how})` }; }
  }
  if (g.icon) {
    const r = resolveIcon(prismKey(g.icon) || g.icon, { from: g.iconFrom || 'mermaid' });
    if (r.kind === 'group' && r.group) return { kind: r.group, how: 'icon', icon: r.group === 'gen' ? r.id : null };
    if (r.id && r.kind === 'node') return { kind: 'gen', how: 'icon (a service frame)', icon: r.id };
  }
  return { kind: 'gen', how: 'default' };
}
// Prism's own Mermaid pack keys (aws:svc-lambda, aws:res-users) name an icon id exactly
export function prismKey(icon) {
  const m = String(icon).trim().match(/^[\w-]+:(svc|res|grp|cat)-([a-z0-9-]+)$/i);
  if (!m) return null;
  const id = `aws-${m[1].toLowerCase()}-${m[2].toLowerCase()}`;
  return iconInfo(id) ? iconInfo(id).id : null;
}

// ---- node icons: the explicit icon, then the label; a generic built-in icon defers to the label
const BUILTIN = new Set(['cloud', 'database', 'disk', 'internet', 'server', 'blank']);
function fromLabel(text) {
  const t = String(text).split('\n')[0];
  if (!t) return null;
  let r = resolveIcon(t);
  if (r.kind === 'group') r = resolveIcon(t, { prefer: 'node' });
  return r.id && r.kind === 'node' && r.confidence >= 0.5 ? { icon: r.id, how: `label (${r.how})`, confidence: r.confidence, warnings: r.warnings } : null;
}
function resolveNode(n, ir) {
  const over = ir.directives.icon[n.id];
  if (over) {
    if (over === 'box' || over === 'pill') return { box: over, how: 'directive' };
    const id = prismKey(over) || (iconInfo(over) && iconInfo(over).id);
    if (id) return { icon: id, how: 'directive' };
    const r = fromLabel(over);
    if (r) return { ...r, how: 'directive ' + r.how };
    issue(ir, 'warn', 'directive', n.id, `icon ${n.id}=${over}: no Prism icon matches; kept the node's own icon`);
  }
  if (n.icon) {
    const q = String(n.icon).trim();
    const pk = prismKey(q);
    if (pk) return { icon: pk, how: 'prism pack key', confidence: 1 };
    if (/^aws-(svc|res|grp|cat)-/.test(q) && iconInfo(q)) return { icon: iconInfo(q).id, how: 'icon id', confidence: 1 };
    if (BUILTIN.has(q.toLowerCase()) && n.label) {
      const byLabel = fromLabel(n.label);
      if (byLabel) return { ...byLabel, how: `${byLabel.how}; built-in icon "${q}" is generic` };
    }
    const r = resolveIcon(q, { from: n.iconFrom || 'mermaid' });
    if (r.id && r.kind === 'node' && r.confidence >= 0.5) return { icon: r.id, how: r.how, confidence: r.confidence, warnings: r.warnings };
    if (!BUILTIN.has(q.toLowerCase())) issue(ir, 'info', 'icon', n.id, `icon "${q}" names no Prism node icon${r.kind === 'group' ? ' (it is a frame)' : ''}; tried the label`);
  }
  const lab = n.label != null ? n.label : n.id;
  const r = fromLabel(lab);
  if (r) return r;
  const c = resolveIcon(String(lab).split('\n')[0]);
  return { box: n.shapeHint === 'stadium' ? 'pill' : 'box', how: 'unresolved', candidates: (c.candidates || []).slice(0, 3).map((x) => x.id) };
}
const iconName = (id) => { const e = iconInfo(id); return e ? e.short || e.name : id; };

// ---- prepare: resolve, measure later in layout.mjs
export function prepare(ir) {
  const used = new Set(), gUsed = new Set();
  const model = { dialect: ir.dialect, dir: ir.dir, sided: ir.sided, nodes: new Map(), groups: new Map(), edges: [], aligns: ir.aligns, issues: ir.issues, unmapped: [], icons: [] };
  const say = (s, c, e, m) => issue(ir, s, c, e, m);
  const nodeIds = new Map(), groupIds = new Map();
  for (const n of ir.nodes) nodeIds.set(n.id, safeId(n.id, used, 'n'));
  ir.groups.forEach((g) => groupIds.set(g.id, safeId(g.id, gUsed, 'g')));
  // groups
  ir.groups.forEach((g, i) => {
    const k = groupKind(g, ir);
    let label = g.label != null ? cleanText(g.label) : null;
    if (label && label.includes('\n')) label = label.replace(/\n/g, ' ');
    if (label != null && DEFAULT_LABEL[k.kind] != null && label.toLowerCase() === DEFAULT_LABEL[k.kind].toLowerCase()) label = null;
    if (k.how === 'default' && (g.label || g.id)) say('info', 'group-kind', g.id, `group ${g.id} ("${g.label || g.id}") names no AWS frame; drawn as a generic group (set one with %% prism: kind ${g.id}=<kind>)`);
    if (k.kind === 'priv' && /\bsubnets?\b/i.test(g.label || '') && !/private|isolated/i.test(g.label || '') && k.how !== 'directive' && k.how !== 'explicit') say('info', 'group-kind', g.id, `"${g.label}" does not say public or private; drawn as a private subnet`);
    model.groups.set(groupIds.get(g.id), {
      id: groupIds.get(g.id), src: g.id, kind: k.kind, kindHow: k.how, label: label === '' ? null : label, icon: k.icon || null,
      note: ir.directives.note[g.id] || g.note || null, parent: g.parent != null ? groupIds.get(g.parent) || null : null, decl: i,
      kids: { nodes: [], groups: [] }, desc: [], depth: 0,
    });
  });
  for (const g of model.groups.values()) if (g.parent && !model.groups.has(g.parent)) { say('warn', 'parent', g.src, `group ${g.src}: unknown parent group`); g.parent = null; }
  // a group cannot sit inside itself
  for (const g of model.groups.values()) { const seen = new Set([g.id]); for (let p = g.parent; p; p = model.groups.get(p) && model.groups.get(p).parent) { if (seen.has(p)) { say('warn', 'parent', g.src, `group ${g.src} nests in itself; moved to the top level`); g.parent = null; break; } seen.add(p); } }
  // nodes
  ir.nodes.forEach((n, i) => {
    const id = nodeIds.get(n.id);
    const parent = n.parent != null ? groupIds.get(n.parent) || null : null;
    if (n.parent != null && !parent) say('warn', 'parent', n.id, `node ${n.id}: unknown parent group ${n.parent}`);
    if (n.junction) { model.nodes.set(id, { id, src: n.id, junction: true, parent, decl: i }); return; }
    const r = resolveNode(n, ir);
    let label = n.label != null ? cleanText(n.label) : null, sub = n.sub != null ? cleanText(n.sub) : null;
    if (label && label.includes('\n')) { const [a, ...b] = label.split('\n'); label = a; if (!sub) sub = b.join(' '); }
    if (!label) label = r.icon ? iconName(r.icon) : n.id;
    const N = { id, src: n.id, parent, decl: i, label, sub: sub || null, shapeHint: n.shapeHint || null };
    if (r.icon) N.icon = r.icon; else N.boxKind = r.box;
    for (const w of r.warnings || []) say('info', 'icon', n.id, w);
    if (!r.icon) {
      model.unmapped.push({ element: n.id, label, icon: n.icon || null, candidates: r.candidates || [] });
      say('warn', 'unmapped', n.id, `no Prism icon for ${n.icon ? `"${n.icon}" or ` : ''}"${label}"; drawn as a ${r.box}${r.candidates && r.candidates.length ? ` (closest: ${r.candidates.join(', ')})` : ''}`);
    }
    model.icons.push({ node: n.id, source: n.icon || `label: ${label}`, icon: r.icon || null, how: r.how, confidence: r.confidence != null ? r.confidence : null });
    model.nodes.set(id, N);
  });
  // membership
  for (const n of model.nodes.values()) if (n.parent) model.groups.get(n.parent).kids.nodes.push(n.id);
  for (const g of model.groups.values()) if (g.parent) model.groups.get(g.parent).kids.groups.push(g.id);
  const desc = (gid) => { const g = model.groups.get(gid); return [...g.kids.nodes, ...g.kids.groups.flatMap(desc)]; };
  for (const g of model.groups.values()) { g.desc = desc(g.id); for (let p = g.parent; p; p = model.groups.get(p).parent) g.depth++; }
  // an empty group is still drawn (Mermaid draws empty subgraphs, and a link may end on it): a zero-size
  // placeholder gives it a cell
  for (const g of model.groups.values()) {
    if (g.desc.length) continue;
    const pid = safeId(`${g.id}-space`, used, 'n');
    model.nodes.set(pid, { id: pid, src: pid, junction: true, placeholder: true, parent: g.id, decl: model.nodes.size });
    for (let p = g.id; p; p = model.groups.get(p).parent) model.groups.get(p).desc.push(pid);
    g.kids.nodes.push(pid);
    say('info', 'empty-group', g.src, `group ${g.src} has no services; drawn as an empty frame`);
  }
  // edges
  const wUsed = new Set([...model.groups.keys()]);
  const endOf = (x) => (nodeIds.has(x) ? nodeIds.get(x) : groupIds.has(x) ? groupIds.get(x) : null);
  const peers = new Set(ir.directives.peer.map(([a, b]) => [a, b].sort().join('|')));
  ir.edges.forEach((e, i) => {
    const a = endOf(e.a), b = endOf(e.b);
    if (!a || !b) { say('warn', 'edge', e.src || `${e.a}-${e.b}`, `edge "${e.src || `${e.a} -> ${e.b}`}" names ${!a ? e.a : e.b}, which is not declared; skipped`); return; }
    const id = safeId(e.id || `w${i + 1}`, wUsed, 'w');
    const A = model.nodes.get(a), B = model.nodes.get(b);
    const twin = A && B && A.icon && A.icon === B.icon;
    const peer = peers.has([e.a, e.b].sort().join('|')) || (!!e.aHead && !!e.bHead && (!!e.dashed || twin)) || (!e.aHead && !e.bHead && !!e.dashed && twin);
    let label = e.label != null ? cleanText(e.label) : null;
    model.edges.push({ ...e, id, a, b, srcA: e.a, srcB: e.b, label: label || null, peer, decl: i, src: e.src || `${e.a} -> ${e.b}` });
  });
  return model;
}

// a long wire label breaks into two lines near its middle (the kit draws "\n" as a second line)
function wrapLabel(s) {
  const mid = s.length / 2;
  let best = -1;
  for (let i = 0; i < s.length; i++) if (s[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best > 0 ? `${s.slice(0, best)}\n${s.slice(best + 1)}` : s;
}

// ---- the story: numbered edges, a flow directive, D2 steps, else a BFS guess
const NUM = /^\s*(\d+)\s*(?:[:.)]\s*(.*))?$/s, NUM_BARE = /^\s*(\d+)\s+(\S.*)$/s;
const ACTOR = /^aws-res-(users|user|client|mobile-client|internet|internet-alt\d?|office-building|traditional-server|server|generic-application)$/;
export function planStory(model, ir, opts = {}) {
  const { nodes, edges } = model;
  const mode = opts.story || ir.directives.story || 'auto';
  const real = (id) => nodes.has(id) && !nodes.get(id).junction;
  const nm = (id) => (nodes.has(id) ? nodes.get(id).label : model.groups.has(id) ? (model.groups.get(id).label || DEFAULT_LABEL[model.groups.get(id).kind] || id) : id);
  const srcOf = (e) => (e.aHead && !e.bHead ? e.b : e.a), dstOf = (e) => (e.aHead && !e.bHead ? e.a : e.b);
  const hop = (e, from, extra = {}) => {
    const to = from === e.a ? e.b : e.a;
    return { wire: e.id, reverse: from !== srcOf(e), ring: real(to) ? to : undefined, back: real(from) ? from : undefined, from, to, edge: e, ...extra };
  };
  const plan = { channel: 'none', hops: [], reply: false, texts: new Map() };
  if (mode === 'none' || !edges.length) return plan;
  // 1. numbered labels (1: HTTPS); a bare "1 HTTPS" only when two or more edges use it
  // numbers read as steps only when they look like a sequence (a label "443" is a port, not step 443)
  const looksNumbered = (l) => { const ns = l.map((x) => Number(x.m[1])); return ns.length && Math.min(...ns) <= 1 && Math.max(...ns) <= 2 * ns.length + 2; };
  let num = edges.map((e) => ({ e, m: e.label && e.label.match(NUM) })).filter((x) => x.m);
  if (num.length && !looksNumbered(num)) { issue(ir, 'info', 'story', null, `edge labels ${num.map((x) => `"${x.e.label}"`).slice(0, 4).join(', ')} start with numbers that are not a 1..n sequence; not read as steps`); num = []; }
  if (!num.length) { const bare = edges.map((e) => ({ e, m: e.label && e.label.match(NUM_BARE) })).filter((x) => x.m); if (bare.length >= 2 && looksNumbered(bare)) num = bare; }
  if (num.length) {
    plan.channel = 'numbered';
    num.sort((x, y) => Number(x.m[1]) - Number(y.m[1]) || x.e.decl - y.e.decl);
    for (const { e, m } of num) { e.label = (m[2] || '').trim() || null; plan.hops.push(hop(e, srcOf(e), { step: Number(m[1]) })); }
    const both = plan.hops.filter((h) => h.edge.aHead && h.edge.bHead);
    if (both.length && both.length === plan.hops.length) plan.reply = true;
    else for (const h of [...both].reverse()) plan.hops.push(hop(h.edge, h.to, { kind: 'pk-2', step: false }));
  } else if (ir.directives.flow.length) {
    // 2. %% prism: flow a>b>c; a hop back along a wire already taken is the response
    plan.channel = 'flow';
    const seen = new Map();
    for (const seq of ir.directives.flow) for (let i = 1; i < seq.length; i++) {
      const u = model.nodeIdOf(seq[i - 1]), v = model.nodeIdOf(seq[i]);
      const path = u && v ? hopPath(model, u, v) : null;
      if (!path) { issue(ir, 'warn', 'flow', seq[i - 1], `flow: no wire between ${seq[i - 1]} and ${seq[i]}${!u || !v ? ` (${!u ? seq[i - 1] : seq[i]} is not declared)` : ''}`); continue; }
      path.forEach(([e, from], j) => {
        const fwd = from === srcOf(e);
        const prev = seen.get(e.id);
        const kind = prev != null && prev !== fwd ? 'pk-2' : undefined;
        const step = prev != null || j > 0 ? false : undefined;
        if (prev == null) seen.set(e.id, fwd);
        plan.hops.push(hop(e, from, { kind, step, pair: [u, v], last: j === path.length - 1 }));
      });
    }
    let n = 0;
    for (const h of plan.hops) if (h.step !== false) h.step = ++n;
  } else if (ir.d2Steps && ir.d2Steps.length) {
    // 3. D2 steps: each step board's new connections are one numbered step
    plan.channel = 'd2-steps';
    ir.d2Steps.forEach((st, i) => {
      st.edges.map((k) => edges.find((e) => e.decl === k)).filter(Boolean).forEach((e, j) => plan.hops.push(hop(e, srcOf(e), { step: j ? false : i + 1 })));
      if (st.label) plan.texts.set(String(i + 1), st.label);
    });
  } else {
    // 4. a guess: breadth-first from the entry actor, along the arrows, solid wires only
    plan.channel = 'bfs';
    const entry = pickEntry(model);
    const depth = new Map([[entry, 0]]), q = [entry];
    while (q.length) {
      const u = q.shift();
      for (const e of edges) {
        if (e.dashed || e.peer) continue;
        let v = null;
        if (e.a === u && (e.bHead || !e.aHead)) v = e.b; else if (e.b === u && (e.aHead || (!e.aHead && !e.bHead))) v = e.a;
        if (v == null || depth.has(v)) continue;
        depth.set(v, depth.get(u) + 1); q.push(v);
        plan.hops.push(hop(e, u, { step: depth.get(u) + 1 }));
      }
    }
    // renumber so steps run 1..n even through junctions (a junction leg shares its number)
    let n = 0, last = null;
    for (const h of plan.hops) { if (nodes.has(h.from) && nodes.get(h.from).junction && last != null) h.step = false; else { h.step = ++n; last = h; } }
    const both = plan.hops.filter((h) => h.edge.aHead && h.edge.bHead);
    for (const h of [...both].reverse()) plan.hops.push(hop(h.edge, h.to, { kind: 'pk-2', step: false }));
    if (plan.hops.length) issue(ir, 'info', 'story-guess', entry, `no numbered edges or flow directive: packets follow a breadth-first guess from ${nm(entry)}; set the order with %% prism: flow a>b>c or number the edge labels`);
  }
  // step texts: directives, D2 step labels, else generated from the hop
  const gen = new Map();
  for (const h of plan.hops) {
    if (h.step === false) continue;
    const k = String(h.step);
    const [u, v] = h.pair || [h.from, h.to];
    const t = `${nm(u)} to ${nm(v)}${h.edge.label ? `: ${h.edge.label}` : ''}`;
    gen.set(k, gen.has(k) ? `${gen.get(k)}; ${t}` : t);
  }
  const generated = [];
  for (const [k, t] of gen) {
    if (ir.directives.steps[k]) plan.texts.set(k, ir.directives.steps[k]);
    else if (!plan.texts.has(k)) { plan.texts.set(k, `${t}.`); generated.push(k); }
  }
  if (generated.length && plan.channel !== 'bfs') issue(ir, 'info', 'step-text', null, `step${generated.length > 1 ? 's' : ''} ${generated.join(', ')} got a generated text; write your own with %% prism: step N: text`);
  for (const h of plan.hops) if (h.step !== false && h.step != null) h.edge.badge = true;
  return plan;
}
// a path of edges from u to v whose inner nodes are junctions (a flow hop through a fan-out)
function hopPath(model, u, v) {
  const q = [[u, []]], seen = new Set([u]);
  while (q.length) {
    const [x, path] = q.shift();
    for (const e of model.edges) {
      const y = e.a === x ? e.b : e.b === x ? e.a : null;
      if (y == null || seen.has(y)) continue;
      const p = [...path, [e, x]];
      if (y === v) return p;
      if (model.nodes.has(y) && model.nodes.get(y).junction) { seen.add(y); q.push([y, p]); }
    }
  }
  return null;
}
export function pickEntry(model) {
  const real = [...model.nodes.values()].filter((n) => !n.junction);
  const actor = real.find((n) => !n.parent && n.icon && ACTOR.test(n.icon)) || real.find((n) => n.icon && ACTOR.test(n.icon));
  if (actor) return actor.id;
  const into = new Set(model.edges.filter((e) => !e.dashed).flatMap((e) => (e.aHead && !e.bHead ? [e.a] : e.bHead || !e.aHead ? [e.b] : [])));
  return (real.find((n) => !into.has(n.id) && model.edges.some((e) => e.a === n.id || e.b === n.id)) || real[0] || [...model.nodes.values()][0]).id;
}

// ---- emit + lint loop
const r2 = (n) => Math.round(n * 100) / 100;
const kebab = (s) => String(s || '').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function buildSpec(ir, opts = {}) {
  const model = prepare(ir);
  const byName = new Map();
  for (const n of model.nodes.values()) byName.set(n.src, n.id);
  model.nodeIdOf = (x) => byName.get(x) || (model.nodes.has(x) ? x : null);
  const plan = planStory(model, ir, opts);
  // after the story took its numbers off: long labels break into two lines
  for (const e of model.edges) if (e.label && !e.label.includes('\n') && e.label.length > 18) e.label = wrapLabel(e.label);
  const L = layout(model, opts);
  const { geo, wires, align } = L;
  const badgeOf = new Map();
  for (const h of plan.hops) if (h.step !== false && h.step != null && !badgeOf.has(h.wire)) badgeOf.set(h.wire, h.step);
  placeLabels(model, geo, wires, align, (wid) => (badgeOf.has(wid) ? badgeOf.get(wid) : null));
  let id = opts.id || ir.directives.id || null;
  if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) { const k = kebab(id || opts.file || ir.title || 'imported'); id = /^[a-z]/.test(k) ? k : `mmd-${k || 'diagram'}`; }
  const realNodes = [...model.nodes.values()].filter((n) => !n.junction);
  const names = realNodes.map((n) => n.label);
  const list = (a) => (a.length <= 1 ? a.join('') : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const storyLine = { numbered: 'Packets follow the numbered steps', flow: 'Packets follow the declared request path', 'd2-steps': 'Packets follow the D2 steps', bfs: 'Packets follow a guessed request path', none: '' }[plan.channel];
  const hasReply = plan.reply || plan.hops.some((h) => h.kind === 'pk-2');
  const desc = ir.directives.desc || ir.meta.desc || `Imported from ${DIALECT_NAME[model.dialect] || model.dialect}: ${list(names.slice(0, 6))}${names.length > 6 ? ' and more' : ''}.${storyLine ? ` ${storyLine}${hasReply ? ', and responses return the same way' : ''}.` : ''}`;
  // story legs -> timeline and steps (story.mjs), badges where layout placed them
  const { timeline, steps } = plan.hops.length ? storyOf(plan.hops.map((h) => ({ wire: h.wire, reverse: h.reverse, ring: h.ring, back: h.back, kind: h.kind, step: h.step, text: h.step !== false ? plan.texts.get(String(h.step)) : undefined })), { reply: plan.reply }) : { timeline: [], steps: [] };
  const wireById = new Map(wires.map((w) => [w.id, w]));
  const seenText = new Set();
  for (const s of steps) {
    const w = wireById.get(s.at);
    const b = w && w.badge;
    if (b) { s.f = b.f; if (b.dx) s.dx = b.dx; s.dy = b.dy; }
    if (s.text && seenText.has(String(s.n))) delete s.text; else if (s.text) seenText.add(String(s.n));
  }
  const legs = timeline.length;
  const dur = ir.directives.dur || Math.min(10, Math.max(6, Math.round(4 + legs * 0.5)));
  const groups = [...model.groups.values()].filter((g) => geo.rects.has(g.id)).sort((a, b) => a.depth - b.depth || a.decl - b.decl).map((g) => {
    const R = geo.rects.get(g.id);
    const o = { kind: g.kind, id: g.id, x: r2(R.x), y: r2(R.y), w: r2(R.w), h: r2(R.h) };
    if (g.label != null) o.label = g.label;
    if (g.icon) o.icon = g.icon;
    if (g.note) o.note = g.note;
    if (!o.icon && ['az', 'sg', 'gen'].includes(g.kind)) o.align = align.get(g.id) || 'center';
    return o;
  });
  const nodes = realNodes.map((n) => {
    const p = geo.pos.get(n.id);
    if (n.boxKind) { const o = { id: n.id, kind: n.boxKind, x: r2(p.x), y: r2(p.y), w: n.iw, h: n.ih, label: n.label }; if (n.sub) o.sub = n.sub; return o; }
    const o = { id: n.id, icon: n.icon, x: r2(p.x), y: r2(p.y) };
    if (n.size !== 40) o.size = n.size;
    o.label = n.label;
    if (n.wrap) o.wrap = n.wrap;
    if (n.sub) o.sub = n.sub;
    return o;
  });
  const specWires = wires.map((w) => {
    const e = w.edge, o = { id: w.id };
    if (w.from) o.from = w.from;
    if (w.to) o.to = w.to;
    o.d = w.d;
    if (e.dashed) o.dashed = true;
    if (e.aHead && e.bHead) o.both = true;
    const intoJunction = model.nodes.has(e.b) && model.nodes.get(e.b).junction;
    if ((!e.aHead && !e.bHead) || (intoJunction && !e.aHead)) o.arrow = false;
    if (e.label) {
      o.label = e.label;
      const p = w.labelPos;
      if (p) { o.labelAt = p.f; if (p.dx) o.labelDx = p.dx; if (p.dy !== -5) o.labelDy = p.dy; if (p.anchor) o.labelAnchor = p.anchor; }
    }
    return o;
  });
  const spec = {
    id, name: opts.name || ir.directives.name || ir.title || 'Imported diagram', desc,
    ...(ir.meta.aria ? { aria: ir.meta.aria } : {}),
    ...(geo.tile === 'wide' ? { wide: true } : geo.tile === 'full' || geo.tile === 'over' ? { full: true } : {}),
    w: geo.W, h: geo.H, dur, groups, nodes, wires: specWires, steps, timeline,
  };
  if (!spec.steps.length) delete spec.steps;
  if (!spec.timeline.length) delete spec.timeline;
  // the lint loop: move what lint flags to its next clear spot, a bounded number of rounds
  const findings = lintLoop(spec, wires, model);
  // checks the kit runs
  try { checkSpec(spec); } catch (err) { issue(ir, 'error', 'spec', spec.id, String(err.message || err)); }
  for (const e of validateDiagram(spec)) issue(ir, 'error', 'schema', e.path, e.message);
  if (geo.tile === 'over') issue(ir, 'warn', 'tile-size', spec.id, `the layout needs ${geo.W}x${geo.H}, more than a full tile (1400x900); split the diagram or simplify it`);
  const report = {
    dialect: ir.dialect, issues: ir.issues, unmapped: model.unmapped,
    tile: { size: geo.tile === 'over' ? 'full' : geo.tile, w: spec.w, h: spec.h, fits: geo.tile !== 'over' },
    lint: findings,
    story: { channel: plan.channel, legs, steps: steps.length },
    icons: model.icons,
  };
  return { spec, report };
}

// which spec elements a lint finding blames, among the ones the loop may move
function culprits(f, spec) {
  const out = [];
  const texts = [...f.message.matchAll(/text "([^"]*)"/g)].map((m) => m[1]);
  for (const t of texts) for (const w of spec.wires) if (w.label && String(w.label).split('\n').some((l) => l.trim().slice(0, 40) === t)) out.push(`label:${w.id}`);
  for (const m of f.message.matchAll(/badge (\S+)/g)) for (const s of spec.steps || []) if (String(s.n) === m[1]) out.push(`badge:${s.at}:${s.n}`);
  return [...new Set(out)];
}
export function lintLoop(spec, wires, model) {
  const byId = new Map(wires.map((w) => [w.id, w]));
  const idx = new Map();   // element -> candidate index
  const apply = (key, i) => {
    const [kind, wid] = key.split(':');
    const w = byId.get(wid), sw = spec.wires.find((x) => x.id === wid);
    if (kind === 'label') {
      const c = w.labelCands[i];
      sw.labelAt = c.f; delete sw.labelDx; delete sw.labelDy; delete sw.labelAnchor;
      if (c.dx) sw.labelDx = c.dx; if (c.dy !== -5) sw.labelDy = c.dy; if (c.anchor) sw.labelAnchor = c.anchor;
    } else {
      const c = w.badgeCands[i];
      for (const s of spec.steps || []) if (s.at === wid) { s.f = c.f; delete s.dx; s.dy = c.dy; if (c.dx) s.dx = c.dx; }
    }
  };
  const cands = (key) => { const [kind, wid] = key.split(':'); const w = byId.get(wid); return (kind === 'label' ? w && w.labelCands : w && w.badgeCands) || []; };
  const errors = () => lintSpec(spec).filter((f) => f.severity === 'error');
  let errs = errors();
  for (let round = 0; round < 6 && errs.length; round++) {
    const keys = [...new Set(errs.flatMap((f) => culprits(f, spec)))];
    if (!keys.length) break;
    let improved = false;
    for (const key of keys) {
      const list = cands(key);
      if (list.length < 2) continue;
      const cur = idx.get(key) || 0;
      let best = { i: cur, n: errs.length };
      for (let i = 0; i < Math.min(list.length, 14); i++) {
        if (i === cur) continue;
        apply(key, i);
        const n = errors().length;
        if (n < best.n) best = { i, n };
        if (n === 0) break;
      }
      apply(key, best.i); idx.set(key, best.i);
      if (best.i !== cur) improved = true;
      errs = errors();
      if (!errs.length) break;
    }
    if (!improved) break;
  }
  return lintSpec(spec);
}
