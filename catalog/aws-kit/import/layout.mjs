// layout.mjs: geometry for the text importers (k33bz fork). No deps beyond the kit's own modules.
// Text formats carry topology, not pixels; this turns the importers' model into the literal x/y/w/h
// awd.mjs draws, following the layout rules in catalog/drafts/AWS_KIT.md:
//
//   1. cells   gridFromSides(): architecture-beta and directional PlantUML say "b is right of a" with
//              edge sides, which is a grid (Mermaid derives the same cells before its force layout).
//              Conflicts and collisions are reported with the two edges that disagree; align row/column
//              hints are applied; junctions yield cells to services.
//              layered(): flowchart, D2 and undirected PlantUML. Longest-path layers, barycenter sweeps
//              that keep each group contiguous (sibling groups in declaration order), container packing
//              so no group box ever holds a node that is not in it, the peer-edge rule (replication
//              between twins does not count as a hop), then fan-out centering.
//   2. tracks  geometry(): column widths from icons and labels, rows from icons and label blocks, the
//              kit's 16px padding and 22px header chained through nested groups, label-aware column
//              gaps, extra room for step badges, title widths, header clearance for wires entering a
//              group from above, a symmetry pass for same-kind twins, then the tile: normal 480x300,
//              wide 960x440, or full up to 1400x900.
//   3. wires   routeAll(): orthogonal routes (M/H/V only, via place.mjs P) found by a shortest-path search
//              over the channel lines between tracks, from ports that match place.mjs (R, L, T, B below
//              the label); footprints of other nodes block, group titles and corner icons cost, wires
//              do not run along borders or on top of each other.
//   4. labels  placeLabels(): wire labels and step badges in clear intervals of their wire, ranked against
//              the same boxes lint.mjs measures (Arial advance widths), with alternates kept for the lint
//              loop in ir.mjs.
import { wrap, P } from '../place.mjs';
import { textWidth } from '../lint.mjs';

export const PAD = { l: 16, r: 16, t: 22, b: 16 };
export const MARGIN = 8;
export const TILES = [{ tile: 'normal', w: 480, h: 300 }, { tile: 'wide', w: 960, h: 440 }, { tile: 'full', w: 1400, h: 900 }];
const PX = { label: 10.5, sub: 9, wire: 8.5, group: 10 };
const r2 = (n) => Math.round(n * 100) / 100;
const isH = (s) => s === 'L' || s === 'R';
const say = (model, severity, code, element, message) => model.issues.push({ severity, code, element, message });

// ---------------------------------------------------------------------------------------------------
// node metrics: footprint width (icon or label, whichever is wider), extent above and below the row axis
export function measureNode(n) {
  if (n.junction) return Object.assign(n, { fw: 0, up: 0, down: 0, iw: 0, ih: 0, lblH: 0, lblW: 0, lines: [] });
  if (n.boxKind) {
    const text = n.label || n.id;
    let w = Math.min(150, Math.max(72, Math.ceil(textWidth(text, PX.label)) + 22));
    let lines = [];
    for (let k = 0; k < 20; k++) {
      lines = wrap(text, Math.max(8, Math.floor((w - 12) / 5.6)));
      const lw = Math.max(...lines.map((l) => textWidth(l, PX.label)), n.sub ? textWidth(n.sub, PX.sub) : 0);
      if ((lw <= w - 12 && lines.length <= 2) || w >= 220) break;
      w += 8;
    }
    const h = Math.max(40, 11 * (lines.length - 1) + (n.sub ? 10 : 0) + 26);
    return Object.assign(n, { bw: w, bh: h, fw: w, up: h / 2, down: h / 2, iw: w, ih: h, lblH: 0, lblW: w, lines });
  }
  const s = n.size || 40;
  let at = 14, lines = n.label ? wrap(n.label, 14) : [];
  while (lines.length > 2 && at < 26) { at += 2; lines = wrap(n.label, at); }
  if (at !== 14) n.wrap = at;
  const lblW = Math.max(0, ...lines.map((l) => textWidth(l, PX.label)), n.sub ? textWidth(n.sub, PX.sub) : 0);
  const lblH = (lines.length ? 13 * lines.length : 0) + (n.sub ? 11 : 0);
  return Object.assign(n, { size: s, lines, lblW, lblH, fw: Math.max(s, Math.ceil(lblW)), up: s / 2, down: s / 2 + lblH, iw: s, ih: s });
}

// ---------------------------------------------------------------------------------------------------
// 1a. grid from edge sides
// cell offset of b relative to a for an edge a:sa -- sb:b (y grows downward); null for a same-side pair
export function sideVec(sa, sb) {
  if (isH(sa) && isH(sb)) return sa === sb ? null : [sa === 'R' ? 1 : -1, 0];
  if (!isH(sa) && !isH(sb)) return sa === sb ? null : [0, sa === 'B' ? 1 : -1];
  if (isH(sa)) return [sa === 'R' ? 1 : -1, sb === 'T' ? 1 : -1];
  return [sb === 'L' ? 1 : -1, sa === 'B' ? 1 : -1];
}
const where = (dx, dy) => {
  const p = [];
  if (dx) p.push(`${Math.abs(dx) > 1 ? Math.abs(dx) + ' columns ' : ''}${dx > 0 ? 'right of' : 'left of'}`);
  if (dy) p.push(`${Math.abs(dy) > 1 ? Math.abs(dy) + ' rows ' : ''}${dy > 0 ? 'below' : 'above'}`);
  return p.length ? p.join(' and ') : 'on top of';
};

export function gridFromSides(model) {
  const { nodes, groups, edges } = model;
  const adj = new Map([...nodes.keys()].map((k) => [k, []]));
  const groupEdges = [];   // a{group}:R --> L:b places b beside a's whole group, once the group is laid out
  for (const e of edges) {
    if (!nodes.has(e.a) || !nodes.has(e.b) || e.a === e.b || !e.sa || !e.sb) continue;
    if (e.aGroup || e.bGroup) { groupEdges.push(e); continue; }
    const v = sideVec(e.sa, e.sb);
    if (!v) { say(model, 'warn', 'grid-sides', e.id, `edge "${e.src}" joins two ${e.sa} sides; Mermaid rejects that pair, so it places nothing`); continue; }
    adj.get(e.a).push({ to: e.b, v, e }); adj.get(e.b).push({ to: e.a, v: [-v[0], -v[1]], e });
  }
  for (const l of adj.values()) l.sort((x, y) => (x.e.soft ? 1 : 0) - (y.e.soft ? 1 : 0));
  const pos = new Map(), at = new Map(), by = new Map(), compOf = new Map();
  const key = (c, r) => `${c},${r}`;
  const isJ = (id) => !!nodes.get(id).junction;
  const name = (e) => (e ? `edge "${e.src}"` : 'the start of the layout');
  const reported = new Set();
  const step = (v) => (v && v[0] ? [Math.sign(v[0]), 0] : [0, v && v[1] ? Math.sign(v[1]) : 1]);
  const free = (c, r, d) => { while (at.has(key(c, r))) { c += d[0]; r += d[1]; } return [c, r]; };
  let comp = 0;
  const put = (id, c, r, e, v) => {
    const k = key(c, r);
    if (at.has(k)) {
      const other = at.get(k);
      if (isJ(other) && !isJ(id)) {
        // a junction is only a waypoint: it gives its cell to the service and moves on along its own edge
        at.delete(k);
        const d = step(by.get(other) ? vecOf(by.get(other), other) : [0, 1]);
        const [jc, jr] = free(c + d[0], r + d[1], d);
        pos.set(other, [jc, jr]); at.set(key(jc, jr), other);
        say(model, 'info', 'grid-junction', other, `junction ${other} gave its cell to ${id} (${name(e)}) and moved ${where(jc - c, jr - r)} it`);
      } else {
        const [cc, rr] = free(c, r, step(v));
        say(model, 'warn', 'grid-collision', id, `${name(e)} and ${name(by.get(other))} both put a node in one cell (${other} and ${id}); moved ${id} ${where(cc - c, rr - r)} ${other}`);
        c = cc; r = rr;
      }
    }
    pos.set(id, [c, r]); at.set(key(c, r), id); by.set(id, e || null); compOf.set(id, comp);
  };
  // the vector that placed a node through edge e (from its placed neighbour to it)
  function vecOf(e, id) { const v = sideVec(e.sa, e.sb) || [0, 1]; return e.b === id ? v : [-v[0], -v[1]]; }
  const check = (u, to, v, e) => {
    const [uc, ur] = pos.get(u), [tc, tr] = pos.get(to);
    if (tc === uc + v[0] && tr === ur + v[1]) return;
    if (reported.has(e.id)) return;
    reported.add(e.id);
    // the other edge: the one that placed `to`, else the one that placed `u`
    const pb = by.get(to) && by.get(to) !== e ? by.get(to) : by.get(u) && by.get(u) !== e ? by.get(u) : null;
    say(model, e.soft ? 'info' : 'warn', 'grid-conflict', e.id,
      `${name(e)} conflicts with ${pb ? name(pb) : 'the first placement'}: it wants ${to} ${where(v[0], v[1])} ${u}, but ${to} already sits ${where(tc - uc, tr - ur)} ${u}; kept ${pb ? `"${pb.src}"` : 'the first placement'}`);
  };
  const order = [...nodes.keys()].sort((a, b) => (isJ(a) ? 1 : 0) - (isJ(b) ? 1 : 0));
  let originC = 0;
  for (const seed of order) {
    if (pos.has(seed)) continue;
    comp++;
    // a new component starts beside its group's placed members, else to the right of everything
    let c0 = originC, r0 = 0;
    const g = nodes.get(seed).parent;
    if (g && groups.has(g)) {
      const placed = groups.get(g).desc.filter((id) => pos.has(id)).map((id) => pos.get(id));
      if (placed.length) { c0 = Math.max(...placed.map((p) => p[0])) + 1; r0 = Math.min(...placed.map((p) => p[1])); }
    }
    put(seed, c0, r0, null, [1, 0]);
    const q = [seed], pending = [];
    const expand = (u) => {
      for (const { to, v, e } of adj.get(u)) {
        if (pos.has(to)) { check(u, to, v, e); continue; }
        if (isJ(to) && !isJ(u)) { pending.push({ u, to, v, e }); continue; }
        const [uc, ur] = pos.get(u);
        put(to, uc + v[0], ur + v[1], e, v); q.push(to);
      }
    };
    while (q.length || pending.length) {
      if (q.length) { expand(q.shift()); continue; }
      const p = pending.shift();
      if (pos.has(p.to)) { check(p.u, p.to, p.v, p.e); continue; }
      // junctions go last, in the cell most of their placed neighbours agree on
      const votes = new Map();
      for (const x of [p, ...pending.filter((y) => y.to === p.to)]) {
        const [uc, ur] = pos.get(x.u), k = key(uc + x.v[0], ur + x.v[1]);
        const o = votes.get(k) || { n: 0, x, c: uc + x.v[0], r: ur + x.v[1] };
        o.n += at.has(k) ? 0.1 : 1; votes.set(k, o);
      }
      const best = [...votes.values()].sort((a, b) => b.n - a.n)[0];
      put(p.to, best.c, best.r, best.x.e, best.x.v); q.push(p.to);
      if (best.x !== p) pending.unshift(p);
    }
    originC = Math.max(...[...pos.values()].map((x) => x[0])) + 2;
  }
  // {group} edges: the far end goes just outside the outermost group of the near end that does not hold it
  const outer = (id, other) => { let G = null; for (let p = nodes.get(id).parent; p && groups.has(p); p = groups.get(p).parent) { if (groups.get(p).desc.includes(other)) break; G = p; } return G; };
  const boxOf = (gid) => { const ps = groups.get(gid).desc.filter((x) => pos.has(x)).map((x) => pos.get(x)); return { c0: Math.min(...ps.map((p) => p[0])), c1: Math.max(...ps.map((p) => p[0])), r0: Math.min(...ps.map((p) => p[1])), r1: Math.max(...ps.map((p) => p[1])) }; };
  for (const e of groupEdges) {
    const anc = e.aGroup ? e.a : e.b, oth = e.aGroup ? e.b : e.a, side = e.aGroup ? e.sa : e.sb;
    const G = outer(anc, oth);
    const [ac, ar] = pos.get(anc), B = G ? boxOf(G) : { c0: ac, c1: ac, r0: ar, r1: ar };
    let tc = side === 'R' ? B.c1 + 1 : side === 'L' ? B.c0 - 1 : ac, tr = side === 'B' ? B.r1 + 1 : side === 'T' ? B.r0 - 1 : ar;
    const Go = (e.aGroup && e.bGroup) ? outer(oth, anc) : null;
    if (Go) { const O = boxOf(Go), [oc, or] = pos.get(oth); if (side === 'R') tc += oc - O.c0; if (side === 'L') tc -= O.c1 - oc; if (side === 'B') tr += or - O.r0; if (side === 'T') tr -= O.r1 - or; }
    const [oc, or] = pos.get(oth);
    if (compOf.get(oth) !== compOf.get(anc)) {
      const cid = compOf.get(oth), members = [...pos.keys()].filter((id) => compOf.get(id) === cid);
      const d = side === 'R' ? [1, 0] : side === 'L' ? [-1, 0] : side === 'B' ? [0, 1] : [0, -1];
      let dc = tc - oc, dr = tr - or;
      const clash = () => members.some((id) => { const p = pos.get(id), o = at.get(key(p[0] + dc, p[1] + dr)); return o && compOf.get(o) !== cid; });
      for (let k = 0; k < 50 && clash(); k++) { dc += d[0]; dr += d[1]; }
      for (const id of members) at.delete(key(...pos.get(id)));
      for (const id of members) { const p = pos.get(id); pos.set(id, [p[0] + dc, p[1] + dr]); at.set(key(p[0] + dc, p[1] + dr), id); compOf.set(id, compOf.get(anc)); }
      by.set(oth, e);
      continue;
    }
    const ok = side === 'R' ? oc > B.c1 : side === 'L' ? oc < B.c0 : side === 'B' ? or > B.r1 : or < B.r0;
    if (!ok) say(model, 'warn', 'grid-conflict', e.id, `${name(e)} conflicts with ${by.get(oth) ? name(by.get(oth)) : 'the first placement'}: it wants ${oth} ${where(side === 'R' ? 1 : side === 'L' ? -1 : 0, side === 'B' ? 1 : side === 'T' ? -1 : 0)} ${G ? `group ${groups.get(G).src || G}` : anc}, but ${oth} already sits inside its rows or columns; kept the first`);
  }
  applyAligns(model, pos, at, by, compOf, key);
  normalize(pos);
  checkGroups(model, pos);
  return pos;
}

// align row a b c: same row, left to right; align column a b: same column, top to bottom (Mermaid 11.16+)
function applyAligns(model, pos, at, by, compOf, key) {
  for (const al of model.aligns || []) {
    const ids = al.ids.filter((id) => pos.has(id));
    const missing = al.ids.filter((id) => !pos.has(id));
    if (missing.length) say(model, 'warn', 'grid-align', al.ids[0], `align ${al.axis} names ${missing.join(', ')}, which is not a service or junction`);
    const row = al.axis === 'row';
    for (let i = 1; i < ids.length; i++) {
      const a = pos.get(ids[0]), prev = pos.get(ids[i - 1]), m = pos.get(ids[i]);
      const okLine = row ? m[1] === a[1] : m[0] === a[0];
      const okOrder = row ? m[0] > prev[0] : m[1] > prev[1];
      if (okLine && okOrder) continue;
      if (compOf.get(ids[i]) !== compOf.get(ids[0])) {
        // a separate component: move all of it (Mermaid treats align as a relative constraint)
        const cid = compOf.get(ids[i]);
        let dc = row ? Math.max(0, prev[0] + 1 - m[0]) : a[0] - m[0];
        let dr = row ? a[1] - m[1] : Math.max(0, prev[1] + 1 - m[1]);
        const members = [...pos.keys()].filter((id) => compOf.get(id) === cid);
        const clash = () => members.some((id) => { const p = pos.get(id), o = at.get(key(p[0] + dc, p[1] + dr)); return o && compOf.get(o) !== cid; });
        for (let k = 0; k < 50 && clash(); k++) { if (row) dc++; else dr++; }
        for (const id of members) at.delete(key(...pos.get(id)));
        for (const id of members) { const p = pos.get(id); pos.set(id, [p[0] + dc, p[1] + dr]); at.set(key(p[0] + dc, p[1] + dr), id); }
        for (const id of members) compOf.set(id, compOf.get(ids[0]));
        continue;
      }
      const e = by.get(ids[i]);
      say(model, 'warn', 'grid-align', ids[i], `align ${al.axis} ${al.ids.join(' ')} wants ${ids[i]} ${row ? 'in the row of' : 'in the column of'} ${ids[0]}${row ? ', right of ' : ', below '}${ids[i - 1]}, but ${e ? `edge "${e.src}"` : 'the layout start'} put it ${where(m[0] - prev[0], m[1] - prev[1])} ${ids[i - 1]}; kept the edge`);
    }
  }
}
function normalize(pos) {
  const vals = [...pos.values()];
  const mc = Math.min(...vals.map((p) => p[0])), mr = Math.min(...vals.map((p) => p[1]));
  for (const [k, p] of pos) pos.set(k, [p[0] - mc, p[1] - mr]);
}
// grid mode: a group box that holds a node outside the group, or two groups that interleave, cannot be
// drawn as nested rectangles; say which
function checkGroups(model, pos) {
  const { nodes, groups } = model;
  const box = new Map();
  for (const g of groups.values()) {
    const ps = g.desc.filter((id) => pos.has(id)).map((id) => pos.get(id));
    if (ps.length) box.set(g.id, { c0: Math.min(...ps.map((p) => p[0])), c1: Math.max(...ps.map((p) => p[0])), r0: Math.min(...ps.map((p) => p[1])), r1: Math.max(...ps.map((p) => p[1])) });
  }
  const inG = (id, gid) => { for (let p = nodes.get(id).parent; p; p = groups.get(p) && groups.get(p).parent) if (p === gid) return true; return false; };
  const under = (a, b) => { for (let p = groups.get(a).parent; p; p = groups.get(p) && groups.get(p).parent) if (p === b) return true; return false; };
  for (const [id, [c, r]] of pos) for (const [gid, b] of box) {
    if (!inG(id, gid) && c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1 && !nodes.get(id).junction) say(model, 'warn', 'grid-group', id, `${id} lands inside group ${gid}'s box but is not in ${gid}; reorder the edge sides or add align hints`);
  }
  const ids = [...box.keys()];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = box.get(ids[i]), b = box.get(ids[j]);
    if (a.c0 <= b.c1 && b.c0 <= a.c1 && a.r0 <= b.r1 && b.r0 <= a.r1 && !under(ids[i], ids[j]) && !under(ids[j], ids[i])) say(model, 'warn', 'grid-group', ids[i], `groups ${ids[i]} and ${ids[j]} overlap in the grid, so they cannot both be drawn as boxes`);
  }
}

// ---------------------------------------------------------------------------------------------------
// 1b. layered layout
export function layered(model) {
  const { nodes, groups, edges } = model;
  const ids = [...nodes.keys()];
  const declIdx = new Map(ids.map((id, i) => [id, i]));
  const firstNode = (gid) => { const g = groups.get(gid); return g ? g.desc.find((id) => nodes.has(id)) || null : null; };
  const rep = (end) => (nodes.has(end) ? end : groups.has(end) ? firstNode(end) : null);
  const flow = [];   // [from, to, edge]
  for (const e of edges) {
    if (e.peer) continue;
    const a = rep(e.a), b = rep(e.b);
    if (!a || !b || a === b) continue;
    flow.push(e.aHead && !e.bHead ? [b, a, e] : [a, b, e]);
  }
  // cycle breaking: depth-first in declaration order, back edges do not layer
  const out = new Map(ids.map((id) => [id, []]));
  flow.forEach((f, i) => out.get(f[0]).push(i));
  const color = new Map(), back = new Set();
  const dfs = (u) => { color.set(u, 1); for (const i of out.get(u)) { const v = flow[i][1]; if (color.get(v) === 1) back.add(i); else if (!color.get(v)) dfs(v); } color.set(u, 2); };
  for (const id of ids) if (!color.get(id)) dfs(id);
  const preds = new Map(ids.map((id) => [id, []])), succs = new Map(ids.map((id) => [id, []]));
  flow.forEach((f, i) => { if (!back.has(i)) { succs.get(f[0]).push(f[1]); preds.get(f[1]).push(f[0]); } });
  const layer = new Map();
  const L = (u) => { if (layer.has(u)) return layer.get(u); layer.set(u, 0); const l = preds.get(u).length ? Math.max(...preds.get(u).map(L)) + 1 : 0; layer.set(u, l); return l; };
  for (const id of ids) L(id);
  // a source sits just before its first successor (Cognito next to API Gateway, not next to users)
  for (const id of ids) if (!preds.get(id).length && succs.get(id).length) layer.set(id, Math.max(layer.get(id), Math.min(...succs.get(id).map((s) => layer.get(s))) - 1));
  // nodes with no hop: a peer's layer, else their group siblings' first layer
  const linked = new Set(flow.flatMap((f) => [f[0], f[1]]));
  for (const id of ids) {
    if (linked.has(id)) continue;
    const peer = edges.find((e) => e.peer && (e.a === id || e.b === id));
    const other = peer && (peer.a === id ? peer.b : peer.a);
    if (other && linked.has(other)) { layer.set(id, layer.get(other)); continue; }
    const p = nodes.get(id).parent;
    const sib = p && groups.has(p) ? groups.get(p).desc.filter((x) => linked.has(x)) : [];
    layer.set(id, sib.length ? Math.min(...sib.map((x) => layer.get(x))) : 0);
  }
  const maxL = Math.max(0, ...layer.values());

  // ordering inside layers: barycenter sweeps, keeping every group contiguous (sibling groups keep
  // their declaration order, so AZ a stays before AZ b)
  const chain = (id) => { const c = []; for (let p = nodes.get(id).parent; p && groups.has(p); p = groups.get(p).parent) c.unshift(p); return c; };
  const chains = new Map(ids.map((id) => [id, chain(id)]));
  const gOrder = new Map([...groups.keys()].map((g, i) => [g, i]));
  const sortLayer = (arr, bary) => {
    const items = arr.map((id) => ({ id, chain: chains.get(id), b: bary.has(id) ? bary.get(id) : declIdx.get(id) }));
    const rec = (list, depth) => {
      const direct = list.filter((it) => it.chain.length === depth);
      const gs = new Map();
      for (const it of list.filter((x) => x.chain.length > depth)) { const g = it.chain[depth]; if (!gs.has(g)) gs.set(g, []); gs.get(g).push(it); }
      const grp = [...gs].map(([g, its]) => ({ w: its.reduce((s, x) => s + x.b, 0) / its.length, ord: gOrder.get(g), out: rec(its, depth + 1) })).sort((a, b) => a.ord - b.ord);
      const loose = direct.map((it) => ({ w: it.b, out: [it.id] })).sort((a, b) => a.w - b.w);
      const res = []; let gi = 0;
      for (const l of loose) { while (gi < grp.length && grp[gi].w <= l.w) res.push(...grp[gi++].out); res.push(...l.out); }
      while (gi < grp.length) res.push(...grp[gi++].out);
      return res;
    };
    return rec(items, 0);
  };
  let order = Array.from({ length: maxL + 1 }, () => []);
  for (const id of ids) order[layer.get(id)].push(id);
  order = order.map((l) => sortLayer(l, new Map()));
  const posIn = () => { const m = new Map(); order.forEach((l) => l.forEach((id, i) => m.set(id, i))); return m; };
  const nb = (id, dir) => (dir ? succs : preds).get(id);
  for (let it = 0; it < 4; it++) {
    for (let l = 1; l <= maxL; l++) { const p = posIn(), b = new Map(); for (const id of order[l]) { const ps = nb(id, 0).map((x) => p.get(x)); if (ps.length) b.set(id, ps.reduce((a, c) => a + c, 0) / ps.length); } order[l] = sortLayer(order[l], b); }
    for (let l = maxL - 1; l >= 0; l--) { const p = posIn(), b = new Map(); for (const id of order[l]) { const ps = nb(id, 1).map((x) => p.get(x)); if (ps.length) b.set(id, ps.reduce((a, c) => a + c, 0) / ps.length); } order[l] = sortLayer(order[l], b); }
  }
  const key = posIn();

  // container packing, bottom-up: a group is a block of (layers x slots); blocks and nodes of one
  // container never share a cell, so group boxes cannot hold a stranger or interleave
  const links = flow.filter((f, i) => !back.has(i)).map(([a, b, e]) => [a, b, e.dashed ? 0.3 : 1]);
  const pack = (gid) => {
    const kids = gid == null ? { nodes: ids.filter((id) => !nodes.get(id).parent || !groups.has(nodes.get(id).parent)), groups: [...groups.values()].filter((g) => !g.parent || !groups.has(g.parent)).map((g) => g.id) } : groups.get(gid).kids;
    const items = [];
    for (const id of kids.nodes) if (nodes.has(id)) items.push({ L0: layer.get(id), L1: layer.get(id), h: 1, rel: new Map([[id, 0]]), key: key.get(id) });
    for (const g of kids.groups) {
      const b = pack(g);
      if (!b) continue;
      const first = [...b.rel.keys()].filter((id) => layer.get(id) === b.L0);
      items.push({ ...b, key: first.reduce((s, id) => s + key.get(id), 0) / Math.max(1, first.length) });
    }
    if (!items.length) return null;
    items.sort((a, b) => a.L0 - b.L0 || a.key - b.key);
    const placed = [], slot = new Map();
    const clash = (it, off) => placed.some((p) => it.L0 <= p.L1 && p.L0 <= it.L1 && off <= p.off + p.h - 1 && p.off <= off + it.h - 1);
    const wants = (it) => {
      const w = [];
      for (const [a, b, wt] of links) {
        if (it.rel.has(b) && slot.has(a)) w.push([slot.get(a) - it.rel.get(b), wt]);
        if (it.rel.has(a) && slot.has(b)) w.push([slot.get(b) - it.rel.get(a), wt]);
      }
      const solid = w.filter((x) => x[1] >= 1);
      return (solid.length ? solid : w).map((x) => x[0]).sort((x, y) => x - y);
    };
    const queue = [...items];
    while (queue.length) {
      // among the leftmost remaining items, one tied to a placed item by a solid link goes first, so the
      // request path keeps the straight line and side branches (dashed) step aside
      const l0 = Math.min(...queue.map((x) => x.L0));
      const pick = queue.find((x) => x.L0 === l0 && links.some(([a, b, wt]) => wt >= 1 && ((x.rel.has(b) && slot.has(a)) || (x.rel.has(a) && slot.has(b))))) || queue.find((x) => x.L0 === l0);
      queue.splice(queue.indexOf(pick), 1);
      const it = pick;
      const want = wants(it);
      let off = 0;
      if (want.length) {
        const w0 = want[Math.floor((want.length - 1) / 2)];
        for (let k = 0; k < 200; k++) { const t = w0 + (k % 2 ? Math.ceil(k / 2) : -k / 2); if (!clash(it, t)) { off = t; break; } }
      } else { while (clash(it, off)) off++; }
      placed.push({ ...it, off });
      for (const [n, s] of it.rel) slot.set(n, off + s);
    }
    const lo = Math.min(...placed.map((p) => p.off));
    for (const [n, s] of slot) slot.set(n, s - lo);
    return { L0: Math.min(...placed.map((p) => p.L0)), L1: Math.max(...placed.map((p) => p.L1)), h: Math.max(...placed.map((p) => p.off + p.h)) - lo, rel: slot };
  };
  const S = pack(null).rel;

  // centering: a fork sits between its branches, a single neighbour lines up with it
  const anc = (id) => chains.get(id);
  const spanOf = (gid) => { const ss = groups.get(gid).desc.filter((x) => S.has(x)).map((x) => S.get(x)); return [Math.floor(Math.min(...ss)), Math.ceil(Math.max(...ss))]; };
  const layersOf = (gid) => { const ls = groups.get(gid).desc.filter((x) => layer.has(x)).map((x) => layer.get(x)); return [Math.min(...ls), Math.max(...ls)]; };
  const fits = (id, s) => {
    if (s < 0) return false;
    for (const g of anc(id)) { const [a, b] = spanOf(g); if (s < a || s > b) return false; }
    for (const o of ids) if (o !== id && layer.get(o) === layer.get(id) && Math.abs(S.get(o) - s) < 1) return false;
    for (const g of groups.keys()) {
      if (anc(id).includes(g) || !groups.get(g).desc.some((x) => S.has(x))) continue;
      const [l0, l1] = layersOf(g), [a, b] = spanOf(g);
      if (layer.get(id) >= l0 && layer.get(id) <= l1 && s > a - 1 && s < b + 1) return false;
    }
    return true;
  };
  const solidS = new Map(ids.map((id) => [id, []])), solidP = new Map(ids.map((id) => [id, []]));
  flow.forEach(([a, b, e], i) => { if (!back.has(i) && !e.dashed) { solidS.get(a).push(b); solidP.get(b).push(a); } });
  const allN = (id) => [...preds.get(id), ...succs.get(id)];
  const byLayer = [...ids].sort((a, b) => layer.get(a) - layer.get(b));
  for (const id of byLayer) {
    for (const side of [solidS.get(id), solidP.get(id)]) {
      const ss = [...new Set(side.map((x) => S.get(x)))];
      if (ss.length < 2) continue;
      const c = Math.round(((Math.min(...ss) + Math.max(...ss)) / 2) * 2) / 2;
      if (c !== S.get(id) && fits(id, c)) S.set(id, c);
      break;
    }
  }
  for (const pass of [byLayer, [...byLayer].reverse()]) for (const id of pass) {
    const n = allN(id);
    if (n.length !== 1) continue;
    const s = S.get(n[0]);
    if (s !== S.get(id) && fits(id, s)) S.set(id, s);
  }
  const pos = new Map();
  for (const id of ids) {
    const l = layer.get(id), s = S.get(id);
    const ll = model.dir === 'RL' || model.dir === 'BT' ? maxL - l : l;
    pos.set(id, model.dir === 'LR' || model.dir === 'RL' ? [ll, s] : [s, ll]);
  }
  normalize(pos);
  return pos;
}

// ---------------------------------------------------------------------------------------------------
// 2. tracks
function compress(vals) {
  const ints = [...new Set(vals.filter(Number.isInteger))].sort((a, b) => a - b);
  const idx = new Map(ints.map((v, i) => [v, i]));
  return {
    n: ints.length,
    map: (v) => {
      if (idx.has(v)) return idx.get(v);
      const lo = ints.filter((x) => x < v).pop(), hi = ints.find((x) => x > v);
      if (lo == null) return 0;
      if (hi == null) return idx.get(lo);
      return (idx.get(lo) + idx.get(hi)) / 2;
    },
  };
}
const groupHasIcon = (g) => (typeof g.icon === 'string') || (g.icon !== false && !['az', 'sg', 'gen'].includes(g.kind));
export const groupTitle = (g) => (g.label != null ? g.label : DEFAULT_LABEL[g.kind] || '');
export const DEFAULT_LABEL = { cloud: 'AWS Cloud', 'cloud-plain': 'AWS Cloud', region: 'Region', az: 'Availability Zone', vpc: 'VPC', pub: 'Public subnet', priv: 'Private subnet', sg: 'Security group', asg: 'Auto Scaling group', acct: 'AWS account', dc: 'Corporate data center', server: 'Server contents', ec2: 'EC2 instance contents', spot: 'Spot Fleet', iot: 'AWS IoT Greengrass deployment', gen: '' };
// where awd draws a group's header text: [x0, x1] at the given alignment
export function headerBox(g, R, align) {
  const t = groupTitle(g);
  if (!t) return null;
  const w = textWidth(t, PX.group);
  const center = align === 'center';
  const x0 = center ? R.x + R.w / 2 - w / 2 : R.x + (groupHasIcon(g) ? 25 : 6);
  return { x0, x1: x0 + w, y0: R.y + 14 - 6.8, y1: R.y + 14 + 0.5 };
}
// where awd draws a group's note: right-aligned on the top edge, 9px
export function noteBox(g, R) {
  if (!g.note) return null;
  const w = textWidth(g.note, 9), x1 = R.x + R.w - 6;
  return { x0: x1 - w, x1, y0: R.y + 14 - 6.2, y1: R.y + 14 + 0.5 };
}
export const centeredKind = (g) => !groupHasIcon(g) && ['az', 'sg', 'gen'].includes(g.kind);

export function geometry(model, cells, ex, opts = {}) {
  const { nodes, groups } = model;
  const cx = compress([...cells.values()].map((p) => p[0])), cy = compress([...cells.values()].map((p) => p[1]));
  const cell = new Map();
  for (const [id, [c, r]] of cells) cell.set(id, [cx.map(c), cy.map(r)]);
  const C = Math.max(1, cx.n), R = Math.max(1, cy.n);
  const colW = Array(C).fill(0), up = Array(R).fill(0), down = Array(R).fill(0), colReal = Array(C).fill(false), rowReal = Array(R).fill(false);
  for (const [id, [c, r]] of cell) {
    const n = nodes.get(id);
    if (Number.isInteger(c)) { colW[c] = Math.max(colW[c], Math.ceil(n.fw)); if (!n.junction) colReal[c] = true; }
    if (Number.isInteger(r)) { up[r] = Math.max(up[r], n.up); down[r] = Math.max(down[r], Math.ceil(n.down)); if (!n.junction) rowReal[r] = true; }
  }
  const rowH = up.map((u, r) => u + down[r]);
  const gb = new Map();
  for (const g of groups.values()) {
    const cs = g.desc.filter((id) => cell.has(id)).map((id) => cell.get(id));
    if (!cs.length) continue;
    gb.set(g.id, { c0: Math.min(...cs.map((p) => Math.floor(p[0]))), c1: Math.max(...cs.map((p) => Math.ceil(p[0]))), r0: Math.min(...cs.map((p) => Math.floor(p[1]))), r1: Math.max(...cs.map((p) => Math.ceil(p[1]))) });
  }
  const kidsIn = (gid) => groups.get(gid).kids.groups.filter((h) => gb.has(h));
  const chainOf = (side, k) => {
    const memo = new Map();
    const f = (gid) => {
      if (memo.has(gid)) return memo.get(gid);
      let best = 0;
      for (const h of kidsIn(gid)) if (gb.get(h)[k] === gb.get(gid)[k]) best = Math.max(best, f(h));
      const v = PAD[side] + (ex[side].get(gid) || 0) + best;
      memo.set(gid, v); return v;
    };
    return f;
  };
  const fL = chainOf('l', 'c0'), fR = chainOf('r', 'c1'), fT = chainOf('t', 'r0'), fB = chainOf('b', 'r1');
  const padL = Array(C).fill(0), padR = Array(C).fill(0), padT = Array(R).fill(0), padB = Array(R).fill(0);
  for (const [gid, b] of gb) { padL[b.c0] = Math.max(padL[b.c0], fL(gid)); padR[b.c1] = Math.max(padR[b.c1], fR(gid)); padT[b.r0] = Math.max(padT[b.r0], fT(gid)); padB[b.r1] = Math.max(padB[b.r1], fB(gid)); }

  // label-aware gaps: a straight wire between neighbouring tracks needs room for its label and badge in
  // the stretch between the frames it crosses
  const needX = Array(C).fill(0), needY = Array(R).fill(0);
  const inside = (id, gid) => { for (let p = nodes.has(id) ? nodes.get(id).parent : gid; p && groups.has(p); p = groups.get(p).parent) if (p === gid) return true; return false; };
  for (const e of model.edges) {
    let A = cell.get(e.a), B = cell.get(e.b);
    const face = (g, o) => { const b = gb.get(g); if (!b || !o) return null; return [o[0] > b.c1 ? b.c1 : o[0] < b.c0 ? b.c0 : o[0], o[1] >= b.r0 && o[1] <= b.r1 ? o[1] : o[1] > b.r1 ? b.r1 : b.r0]; };
    if (!A && B) A = face(e.a, B);
    if (!B && A) B = face(e.b, A);
    if (!A || !B) continue;
    const lw = e.label ? Math.max(...String(e.label).split('\n').map((l) => textWidth(l, PX.wire))) + 12 : 0;
    const bw = e.badge ? 24 : 0;
    const crosses = [...gb.keys()].some((gid) => inside(e.a, gid) !== inside(e.b, gid));
    if (A[1] === B[1] && Number.isInteger(A[1]) && Math.abs(A[0] - B[0]) === 1) {
      const c = Math.min(A[0], B[0]);
      let need = lw + bw + (lw && bw ? 4 : 0) + 6;
      if (!crosses) need -= padR[c] + padL[c + 1] + (colW[c] - nodes.get(A[0] < B[0] ? e.a : e.b).iw) / 2 + (colW[c + 1] - nodes.get(A[0] < B[0] ? e.b : e.a).iw) / 2;
      needX[c] = Math.max(needX[c], Math.ceil(need));
    }
    if (A[0] === B[0] && Number.isInteger(A[0]) && Math.abs(A[1] - B[1]) === 1) {
      const r = Math.min(A[1], B[1]);
      const lower = A[1] < B[1] ? e.b : e.a;
      const entersFrame = [...gb.keys()].some((gid) => inside(lower, gid) && !inside(A[1] < B[1] ? e.a : e.b, gid));
      needY[r] = Math.max(needY[r], entersFrame ? 0 : bw ? 28 : lw ? 18 : 0);
    }
  }
  for (const [c, v] of ex.needX) if (c < C - 1) needX[c] = Math.max(needX[c], v);
  for (const [r, v] of ex.needY) if (r < R - 1) needY[r] = Math.max(needY[r], v);
  const frames = (a, b) => a > 0 && b > 0;
  const baseX = (c) => (!colReal[c] || !colReal[c + 1] ? 18 : frames(padR[c], padL[c + 1]) ? 18 : 44);
  const minX = (c) => (!colReal[c] || !colReal[c + 1] ? 10 : frames(padR[c], padL[c + 1]) ? 8 : 22);
  const baseY = (r) => (!rowReal[r] || !rowReal[r + 1] ? 14 : frames(padB[r], padT[r + 1]) ? 14 : 30);
  const minY = (r) => (!rowReal[r] || !rowReal[r + 1] ? 8 : frames(padB[r], padT[r + 1]) ? 8 : 18);
  const gapX = (c, s) => Math.round(Math.max(baseX(c) * s, minX(c), needX[c]));
  const gapY = (r, s) => Math.round(Math.max(baseY(r) * s, minY(r), needY[r]));
  const build = (sx, sy, extraGap = 0) => {
    const left = [], top = [];
    let x = MARGIN + padL[0];
    for (let c = 0; c < C; c++) { left.push(x); if (c < C - 1) x += colW[c] + padR[c] + gapX(c, sx) + extraGap + padL[c + 1]; }
    const W = x + colW[C - 1] + padR[C - 1] + MARGIN;
    let y = MARGIN + padT[0];
    for (let r = 0; r < R; r++) { top.push(y); if (r < R - 1) y += rowH[r] + padB[r] + gapY(r, sy) + padT[r + 1]; }
    const H = y + rowH[R - 1] + padB[R - 1] + MARGIN;
    return { left, top, W, H };
  };
  // the tile: the first that fits at natural spacing or squeezed, else full at natural spacing
  const solve = (lim, f) => { if (f(1) <= lim) return 1; let lo = 0, hi = 1; for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (f(m) <= lim) lo = m; else hi = m; } return lo; };
  let T = null, sx = 1, sy = 1;
  for (const t of TILES) {
    const b = build(0, 0);
    if (b.W <= t.w && b.H <= t.h) { T = t; sx = solve(t.w, (s) => build(s, 0).W); sy = solve(t.h, (s) => build(0, s).H); break; }
  }
  let overflow = false;
  if (!T) { T = TILES[2]; overflow = true; }
  let B = build(sx, sy);
  if (T.tile !== 'full' && C > 1 && B.W < T.w) {
    const per = Math.min(Math.floor((T.w - B.W) / (C - 1)), opts.stretchCap ?? (T.tile === 'wide' ? 120 : 48));
    B = build(sx, sy, per);
  }
  const W = T.tile === 'full' ? Math.max(Math.ceil(B.W), 480) : T.w;
  const shift = Math.max(0, Math.floor((W - B.W) / 2));
  const left = B.left.map((x) => x + shift), top = B.top;
  const H = Math.ceil(B.H);
  const axisX = (c) => (Number.isInteger(c) ? left[c] + colW[c] / 2 : (axisX(Math.floor(c)) + axisX(Math.ceil(c))) / 2);
  const axisY = (r) => (Number.isInteger(r) ? top[r] + up[r] : (axisY(Math.floor(r)) + axisY(Math.ceil(r))) / 2);
  const pos = new Map();
  for (const [id, [c, r]] of cell) {
    const n = nodes.get(id);
    const x = axisX(c), y = axisY(r);
    pos.set(id, { cx: x, cy: y, x: x - n.iw / 2, y: y - n.ih / 2 });
  }
  const rects = new Map();
  for (const [gid, b] of gb) {
    const x0 = left[b.c0] - fL(gid), x1 = left[b.c1] + colW[b.c1] + fR(gid);
    const y0 = top[b.r0] - fT(gid), y1 = top[b.r1] + rowH[b.r1] + fB(gid);
    rects.set(gid, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  // channels: the free middle of each gap between tracks, where wires turn
  const chX = [], chY = [];
  for (let c = 0; c < C - 1; c++) { const a = left[c] + colW[c] + padR[c], b = left[c + 1] - padL[c + 1]; chX.push([a, b]); }
  for (let r = 0; r < R - 1; r++) { const a = top[r] + rowH[r] + padB[r], b = top[r + 1] - padT[r + 1]; chY.push([a, b]); }
  return { W, H, tile: overflow ? 'over' : T.tile, natural: { w: Math.ceil(build(1, 1).W), h: Math.ceil(build(1, 1).H) }, C, R, cell, gb, rects, pos, left, top, colW, rowH, up, chX, chY, padL, padR, padT, padB };
}

// ---------------------------------------------------------------------------------------------------
// 3. routing
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];   // 0 +x (leave R), 1 -x (leave L), 2 +y (leave B), 3 -y (leave T)
const LEAVE = { R: 0, L: 1, B: 2, T: 3 };
const ENTER = { L: 0, R: 1, T: 2, B: 3 };           // direction of travel arriving at that side
const REV = [1, 0, 3, 2];

// footprints: icon (or box) and the label block under it
export function footprints(n, p) {
  if (n.junction) return [];
  const out = [{ x0: p.x, y0: p.y, x1: p.x + n.iw, y1: p.y + n.ih }];
  if (!n.boxKind && n.lblH) out.push({ x0: p.cx - n.lblW / 2, y0: p.y + n.ih + 4, x1: p.cx + n.lblW / 2, y1: p.y + n.ih + n.lblH });
  return out;
}
const grow = (b, d) => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });
const segHits = (x1, y1, x2, y2, b) => Math.max(x1, x2) > b.x0 && Math.min(x1, x2) < b.x1 && Math.max(y1, y2) > b.y0 && Math.min(y1, y2) < b.y1;

function portsOf(model, geo, end, side, other, head, wantOff) {
  const { nodes, groups } = model;
  const g = head ? 4 : 2;
  const out = [];
  const facing = (s, o, c) => {
    const dx = o[0] - c[0], dy = o[1] - c[1];
    const flowH = model.dir === 'LR' || model.dir === 'RL';
    const toward = (s === 'R' && dx > 0) || (s === 'L' && dx < 0) || (s === 'B' && dy > 0) || (s === 'T' && dy < 0);
    const major = Math.abs(dx) >= Math.abs(dy) ? isH(s) : !isH(s);
    if (!toward) return Math.abs(isH(s) ? dx : dy) < 1 ? 30 : 60;
    return (major ? 0 : 10) + (isH(s) === flowH ? 0 : 18);
  };
  if (end.kind === 'group') {
    const R = geo.rects.get(end.id);
    if (!R) return out;
    const sides = side ? [side] : ['L', 'R', 'T', 'B'];
    for (const s of sides) {
      const y = Math.min(Math.max(other[1], R.y + 30), R.y + R.h - 8), x = Math.min(Math.max(other[0], R.x + 10), R.x + R.w - 10);
      const pt = s === 'L' ? [R.x, y] : s === 'R' ? [R.x + R.w, y] : s === 'T' ? [x, R.y] : [x, R.y + R.h];
      out.push({ pt, side: s, cost: facing(s, other, [R.x + R.w / 2, R.y + R.h / 2]) });
    }
    return out;
  }
  const n = nodes.get(end.id), p = geo.pos.get(end.id);
  if (!n || !p) return out;
  if (n.junction) {
    for (const s of side ? [side] : ['R', 'L', 'B', 'T']) out.push({ pt: [p.cx, p.cy], side: s, cost: side ? 0 : facing(s, other, [p.cx, p.cy]) * 0.5, junction: true });
    return out;
  }
  if (end.groupSide && n.parent && geo.rects.has(n.parent)) {
    const R = geo.rects.get(n.parent), s = side || 'R';
    const pt = s === 'L' ? [R.x, p.cy] : s === 'R' ? [R.x + R.w, p.cy] : s === 'T' ? [p.cx, R.y] : [p.cx, R.y + R.h];
    out.push({ pt, side: s, cost: 0, groupEdge: true });
    return out;
  }
  for (const s of side ? [side] : ['R', 'L', 'B', 'T']) {
    const off = wantOff || 0;
    const pt = s === 'R' ? [p.cx + n.iw / 2 + g, p.cy + off] : s === 'L' ? [p.cx - n.iw / 2 - g, p.cy + off]
      : s === 'T' ? [p.cx + off, p.cy - n.ih / 2 - g] : [p.cx + off, p.cy + n.ih / 2 + n.lblH + g];
    out.push({ pt, side: s, cost: side ? 0 : facing(s, other, [p.cx, p.cy]) });
  }
  return out;
}

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(k, v) {
    const K = this.k, V = this.v; let i = K.length; K.push(k); V.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= k) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = k; V[i] = v;
  }
  pop() {
    const K = this.k, V = this.v, top = V[0], last = K.length - 1, lk = K[last], lv = V[last];
    this.lastKey = K[0];
    K.pop(); V.pop();
    if (last > 0) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= last) break; if (c + 1 < last && K[c + 1] < K[c]) c++; if (K[c] >= lk) break; K[i] = K[c]; V[i] = V[c]; i = c; }
      K[i] = lk; V[i] = lv;
    }
    return top;
  }
}

export function routeAll(model, geo, opts = {}) {
  const { nodes, groups, edges } = model;
  const BEND = 24;
  // static obstacles
  const foot = [];   // { b (grown), raw, owner }
  for (const [id, p] of geo.pos) for (const f of footprints(nodes.get(id), p)) foot.push({ b: grow(f, 3), raw: f, owner: id });
  const soft = [];   // costly to cross: group titles and corner icons
  for (const [gid, R] of geo.rects) {
    const g = groups.get(gid);
    const hb = headerBox(g, R, geo.align && geo.align.get(gid) || (centeredKind(g) ? 'center' : 'left'));
    if (hb) soft.push({ b: grow(hb, 2.5), pen: 500, gid, header: true });
    const nb = noteBox(g, R);
    if (nb) soft.push({ b: grow(nb, 2.5), pen: 500, gid, note: true });
    if (groupHasIcon(g)) soft.push({ b: { x0: R.x, y0: R.y, x1: R.x + 20, y1: R.y + 20 }, pen: 500, gid });
  }
  const borders = [...geo.rects.values()];
  // pairs of parallel edges get their ports spread apart
  const pairKey = (e) => [e.a, e.b].sort().join('|');
  const pairs = new Map();
  for (const e of edges) { const k = pairKey(e); pairs.set(k, (pairs.get(k) || 0) + 1); }
  const pairSeen = new Map();
  const placedSegs = { h: new Map(), v: new Map() };   // rounded fixed coordinate -> [{ a, b, w, ends }]
  const wires = [];
  const allX = new Set(), allY = new Set();
  const addLine = (set, v) => set.add(r2(v));
  for (let c = 0; c < geo.C; c++) addLine(allX, geo.left[c] + geo.colW[c] / 2);
  for (let r = 0; r < geo.R; r++) addLine(allY, geo.top[r] + geo.up[r]);
  for (const [a, b] of geo.chX) { const m = (a + b) / 2; addLine(allX, m); if (b - a >= 30) { addLine(allX, m - 8); addLine(allX, m + 8); } }
  for (const [a, b] of geo.chY) { const m = (a + b) / 2; addLine(allY, m); if (b - a >= 30) { addLine(allY, m - 8); addLine(allY, m + 8); } }
  const xs0 = [...geo.rects.values()].flatMap((R) => [R.x, R.x + R.w]), ys0 = [...geo.rects.values()].flatMap((R) => [R.y, R.y + R.h]);
  const minX = Math.min(...xs0, ...[...geo.pos.values()].map((p) => p.x)), maxX = Math.max(...xs0, ...[...geo.pos.values()].map((p) => p.cx + 20));
  const minY = Math.min(...ys0, ...[...geo.pos.values()].map((p) => p.y)), maxY = Math.max(...ys0, ...[...geo.pos.values()].map((p) => p.y + 60));
  addLine(allX, Math.max(3, minX - 6)); addLine(allX, Math.min(geo.W - 3, maxX + 6));
  addLine(allY, Math.max(3, minY - 6)); addLine(allY, Math.min(geo.H - 3, maxY + 6));
  // node centre lines and the outer lines of each group, so a wire can hug a frame from outside
  for (const p of geo.pos.values()) { addLine(allX, p.cx); addLine(allY, p.cy); }
  for (const R of geo.rects.values()) { if (R.x - 8 > 2) addLine(allX, R.x - 8); if (R.y - 8 > 2) addLine(allY, R.y - 8); addLine(allX, Math.min(geo.W - 2, R.x + R.w + 8)); addLine(allY, Math.min(geo.H - 2, R.y + R.h + 8)); }

  for (const e of edges) {
    const endOf = (id, groupSide) => (nodes.has(id) ? { kind: 'node', id, groupSide } : { kind: 'group', id });
    const A = endOf(e.a, e.aGroup), Bn = endOf(e.b, e.bGroup);
    const centre = (end) => (end.kind === 'group' ? (() => { const R = geo.rects.get(end.id); return R ? [R.x + R.w / 2, R.y + R.h / 2] : [0, 0]; })() : [geo.pos.get(end.id).cx, geo.pos.get(end.id).cy]);
    const ca = centre(A), cb = centre(Bn);
    const k = pairKey(e), cnt = pairs.get(k), i = pairSeen.get(k) || 0; pairSeen.set(k, i + 1);
    const off = cnt > 1 ? (i - (cnt - 1) / 2) * 8 : 0;
    // the drawn path runs from the request source to its head (a <-- b is drawn b to a)
    const flip = e.aHead && !e.bHead;
    const S = flip ? Bn : A, Tn = flip ? A : Bn, ss = flip ? e.sb : e.sa, ts = flip ? e.sa : e.sb;
    const cs = flip ? cb : ca, ct = flip ? ca : cb;
    const headS = e.aHead && e.bHead, headT = e.aHead || e.bHead;
    if (e.a === e.b && A.kind === 'node') { wires.push(selfLoop(e, geo.pos.get(e.a), nodes.get(e.a))); continue; }
    const starts = portsOf(model, geo, S, ss, ct, headS, off), targets = portsOf(model, geo, Tn, ts, cs, headT, off);
    if (!starts.length || !targets.length) { say(model, 'warn', 'route', e.id, `edge "${e.src}" has an end that is not drawn; skipped`); continue; }
    const xs = new Set(allX), ys = new Set(allY);
    for (const p of [...starts, ...targets]) { addLine(xs, p.pt[0]); addLine(ys, p.pt[1]); }
    const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b);
    const xi = new Map(X.map((v, i) => [v, i])), yi = new Map(Y.map((v, i) => [v, i]));
    const NY = Y.length;
    const own = new Set([S.kind === 'node' ? S.id : null, Tn.kind === 'node' ? Tn.id : null]);
    const segCost = (x1, y1, x2, y2) => {
      let c = 0;
      for (const f of foot) {
        if (own.has(f.owner)) { if (segHits(x1, y1, x2, y2, f.raw)) return Infinity; }
        else if (segHits(x1, y1, x2, y2, f.b)) return Infinity;
      }
      // a wire down through a title is repaired by header clearance (the frame's content moves right),
      // so it costs less than a detour; along a title, or through a corner icon, it stays costly
      for (const s of soft) if (segHits(x1, y1, x2, y2, s.b)) c += s.header && x1 === x2 ? 120 : s.pen;
      const hz = y1 === y2;
      for (const R of borders) {
        if (hz) {
          if (y1 > R.y && y1 < R.y + R.h) { for (const bx of [R.x, R.x + R.w]) if (bx > Math.min(x1, x2) && bx < Math.max(x1, x2)) c += 3; }
          for (const by of [R.y, R.y + R.h]) if (Math.abs(y1 - by) < 4 && Math.min(Math.max(x1, x2), R.x + R.w) - Math.max(Math.min(x1, x2), R.x) > 1) c += 300;
        } else {
          if (x1 > R.x && x1 < R.x + R.w) { for (const by of [R.y, R.y + R.h]) if (by > Math.min(y1, y2) && by < Math.max(y1, y2)) c += 3; }
          for (const bx of [R.x, R.x + R.w]) if (Math.abs(x1 - bx) < 4 && Math.min(Math.max(y1, y2), R.y + R.h) - Math.max(Math.min(y1, y2), R.y) > 1) c += 300;
        }
      }
      // other wires: running on top of one is costly unless it is a shared trunk from the same port
      const map = hz ? placedSegs.h : placedSegs.v, fix = hz ? y1 : x1, lo = Math.min(hz ? x1 : y1, hz ? x2 : y2), hi = Math.max(hz ? x1 : y1, hz ? x2 : y2);
      for (let d = -3; d <= 3; d++) for (const s of map.get(Math.round(fix) + d) || []) {
        if (Math.min(hi, s.b) - Math.max(lo, s.a) > 1) c += s.ends.some((x) => own.has(x)) && s.trunk && s.dashed === !!e.dashed ? 4 : 90;
      }
      return c;
    };
    const dist = new Float64Array(X.length * NY * 4).fill(Infinity), prev = new Int32Array(X.length * NY * 4).fill(-1);
    const heap = new Heap();
    const sIdx = (x, y, d) => ((x * NY) + y) * 4 + d;
    const startSet = new Set();
    for (const p of starts) { const s = sIdx(xi.get(r2(p.pt[0])), yi.get(r2(p.pt[1])), LEAVE[p.side]); if (p.cost < dist[s]) { dist[s] = p.cost; heap.push(p.cost, s); startSet.add(s); } }
    const tgt = new Map();
    for (const p of targets) { const pi = xi.get(r2(p.pt[0])) * NY + yi.get(r2(p.pt[1])); if (!tgt.has(pi)) tgt.set(pi, []); tgt.get(pi).push({ dir: ENTER[p.side], cost: p.cost }); }
    let found = -1, best = Infinity;
    while (heap.size) {
      const s = heap.pop();
      const cur = dist[s];
      if (heap.lastKey > cur) continue;   // stale entry
      if (cur >= best) break;
      const d = s % 4, pi = (s - d) / 4, x = Math.floor(pi / NY), y = pi % NY;
      for (let nd = 0; nd < 4; nd++) {
        if (nd === REV[d]) continue;
        if (startSet.has(s) && nd !== d) continue;   // leave a port straight
        const nx = x + DIRS[nd][0], ny = y + DIRS[nd][1];
        if (nx < 0 || ny < 0 || nx >= X.length || ny >= NY) continue;
        const sc = segCost(X[x], Y[y], X[nx], Y[ny]);
        if (sc === Infinity) continue;
        const cost = cur + Math.abs(X[nx] - X[x]) + Math.abs(Y[ny] - Y[y]) + sc + (nd !== d ? BEND : 0);
        const t = sIdx(nx, ny, nd);
        if (cost < dist[t]) {
          dist[t] = cost; prev[t] = s; heap.push(cost, t);
          const hit = tgt.get(nx * NY + ny);
          if (hit) for (const h of hit) if (h.dir === nd && cost + h.cost < best) { best = cost + h.cost; found = t; }
        }
      }
    }
    let pts;
    if (found < 0) {
      // nothing clean: a plain elbow between the preferred ports, reported
      const a = starts.sort((p, q) => p.cost - q.cost)[0], b = targets.sort((p, q) => p.cost - q.cost)[0];
      pts = isH(a.side) ? [a.pt, [r2((a.pt[0] + b.pt[0]) / 2), a.pt[1]], [r2((a.pt[0] + b.pt[0]) / 2), b.pt[1]], b.pt] : [a.pt, [a.pt[0], r2((a.pt[1] + b.pt[1]) / 2)], [b.pt[0], r2((a.pt[1] + b.pt[1]) / 2)], b.pt];
      say(model, 'warn', 'route', e.id, `edge "${e.src}" found no clear orthogonal route; drew a plain elbow`);
    } else {
      pts = [];
      for (let s = found; s >= 0; s = prev[s]) { const d = s % 4, pi = (s - d) / 4; pts.push([X[Math.floor(pi / NY)], Y[pi % NY]]); }
      pts.reverse();
    }
    pts = simplify(pts);
    const startSide = sideOf(pts, true), endSide = sideOf(pts, false);
    for (let j = 1; j < pts.length; j++) {
      const [x1, y1] = pts[j - 1], [x2, y2] = pts[j], hz = y1 === y2, map = hz ? placedSegs.h : placedSegs.v, fix = Math.round(hz ? y1 : x1);
      if (!map.has(fix)) map.set(fix, []);
      map.get(fix).push({ a: Math.min(hz ? x1 : y1, hz ? x2 : y2), b: Math.max(hz ? x1 : y1, hz ? x2 : y2), ends: [S.id, Tn.id], trunk: j === 1 || j === pts.length - 1, dashed: !!e.dashed });
    }
    wires.push({ id: e.id, edge: e, pts, d: P(...pts), from: S.kind === 'node' && !nodes.get(S.id).junction ? S.id : null, to: Tn.kind === 'node' && !nodes.get(Tn.id).junction ? Tn.id : null, startSide, endSide, flip });
  }
  return wires;
}
function selfLoop(e, p, n) {
  const x0 = p.cx + n.iw / 2 + 2, y0 = p.cy - 6, y1 = p.cy + 6, x1 = x0 + 14;
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0 + 2, y1]];
  return { id: e.id, edge: e, pts, d: P(...pts), from: e.a, to: e.a, startSide: 'R', endSide: 'R', flip: false };
}
const simplify = (pts) => {
  const p = pts.map(([x, y]) => [r2(x), r2(y)]).filter((q, i, a) => i === 0 || q[0] !== a[i - 1][0] || q[1] !== a[i - 1][1]);
  const out = [p[0]];
  for (let i = 1; i < p.length; i++) {
    const a = out[out.length - 1], b = p[i], c = p[i + 1];
    if (c && ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1]))) continue;
    out.push(b);
  }
  return out;
};
function sideOf(pts, start) {
  const [a, b] = start ? [pts[0], pts[1]] : [pts[pts.length - 1], pts[pts.length - 2]];
  if (!b) return 'R';
  if (a[1] === b[1]) return b[0] > a[0] ? 'R' : 'L';
  return b[1] > a[1] ? 'B' : 'T';
}

// header crossings: a wire through a group's title (it enters from above or leaves upward)
export function headerHits(model, geo, wires, align) {
  const out = [];
  for (const [gid, R] of geo.rects) {
    const g = model.groups.get(gid);
    for (const [hb, note] of [[headerBox(g, R, align.get(gid)), false], [noteBox(g, R), true]]) {
      if (!hb) continue;
      const box = grow(hb, 3);
      for (const w of wires) for (let i = 1; i < w.pts.length; i++) {
        const [x1, y1] = w.pts[i - 1], [x2, y2] = w.pts[i];
        if (segHits(x1, y1, x2, y2, box)) out.push({ gid, wire: w.id, x: x1 === x2 ? x1 : null, hb, R, note });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// 4. labels and badges: candidates along the wire, ranked against what lint measures
export function textBox(text, x, y, anchor = 'middle', px = PX.wire, lineGap = 9.5) {
  const lines = String(text).split('\n');
  const w = Math.max(...lines.map((l) => textWidth(l, px)));
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return { x0, x1: x0 + w, y0: y - 0.68 * px, y1: y + lineGap * (lines.length - 1) + 0.05 * px };
}
const hitB = (a, b, pad = 0) => a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;
const pathLen = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.abs(p[0] - pts[i][0]) + Math.abs(p[1] - pts[i][1]), 0);

// obstacles the way lint sees them: icons, node label lines, frame borders (2px), group titles, wires
export function obstacleSet(model, geo, wires, align) {
  const icons = [], texts = [], frames = [];
  for (const [id, p] of geo.pos) {
    const n = model.nodes.get(id);
    if (n.junction) continue;
    icons.push({ x0: p.x, y0: p.y, x1: p.x + n.iw, y1: p.y + n.ih, id });
    if (!n.boxKind && n.lines.length) {
      n.lines.forEach((l, i) => texts.push({ ...textBox(l, p.cx, p.y + n.ih + 12 + 11 * i, 'middle', PX.label), id }));
      if (n.sub) texts.push({ ...textBox(n.sub, p.cx, p.y + n.ih + 12 + 11 * n.lines.length, 'middle', PX.sub), id });
    }
  }
  for (const [gid, R] of geo.rects) {
    frames.push(R);
    const g = model.groups.get(gid);
    const hb = headerBox(g, R, align.get(gid));
    if (hb) texts.push({ ...hb, gid });
    const nb = noteBox(g, R);
    if (nb) texts.push({ ...nb, gid });
    if (groupHasIcon(g)) icons.push({ x0: R.x, y0: R.y, x1: R.x + 20, y1: R.y + 20, gid });
  }
  return { icons, texts, frames, wires };
}
function onBorder(b, frames) {
  const B = grow(b, 2);
  for (const F of frames) {
    const vert = (x) => B.x0 < x && x < B.x1 && B.y1 > F.y && B.y0 < F.y + F.h;
    const horz = (y) => B.y0 < y && y < B.y1 && B.x1 > F.x && B.x0 < F.x + F.w;
    if (vert(F.x) || vert(F.x + F.w) || horz(F.y) || horz(F.y + F.h)) return true;
  }
  return false;
}
function wireThrough(b, wires, skip) {
  let n = 0;
  for (const w of wires) for (let i = 1; i < w.pts.length; i++) {
    const [x1, y1] = w.pts[i - 1], [x2, y2] = w.pts[i];
    if (segHits(x1, y1, x2, y2, { x0: b.x0 + 0.5, y0: b.y0 + 0.5, x1: b.x1 - 0.5, y1: b.y1 - 0.5 })) n += w.id === skip ? 0.5 : 1;
  }
  return n;
}

// candidate spots along a wire: { f, dx, dy, anchor, horizontal, s (distance along) }
function spots(pts, step = 6, end = 0) {
  const total = pathLen(pts), out = [];
  let before = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
    const len = Math.abs(x2 - x1) + Math.abs(y2 - y1), hz = y1 === y2;
    const e0 = hz ? end : 0, lo = i === 1 ? Math.max(6, e0) : 5, hi = len - (i === pts.length - 1 ? Math.max(9, e0) : 5);
    for (let t = lo; t <= hi; t += step) {
      const x = x1 + (x2 - x1) * (t / len), y = y1 + (y2 - y1) * (t / len);
      out.push({ s: before + t, f: Math.round(((before + t) / total) * 1000) / 1000, x, y, hz, seg: i, segLen: len, mid: Math.abs(t - len / 2) });
    }
    before += len;
  }
  return { total, list: out };
}

export function placeLabels(model, geo, wires, align, badgeOf) {
  const O = obstacleSet(model, geo, wires, align);
  const taken = [];   // placed labels and badges
  const canvas = { x0: 1, y0: 1, x1: geo.W - 1, y1: geo.H - 1 };
  const inCanvas = (b) => b.x0 >= canvas.x0 && b.x1 <= canvas.x1 && b.y0 >= canvas.y0 && b.y1 <= canvas.y1;
  const scoreText = (b, w) => {
    let s = 0;
    if (!inCanvas(b)) s += 5000;
    for (const ic of O.icons) if (hitB(b, grow(ic, -2))) s += 1000;
    for (const t of O.texts) if (hitB(b, t, 0.5)) s += 1000;
    if (onBorder(b, O.frames)) s += 800;
    s += wireThrough(b, wires, w.id) * 900;
    for (const t of taken) if (hitB(b, t, 1)) s += 1000;
    return s;
  };
  const scoreBadge = (b, w) => {
    let s = 0;
    if (!inCanvas(b)) s += 5000;
    for (const ic of O.icons) if (hitB(b, grow(ic, -2))) s += 1000;
    for (const t of O.texts) if (hitB(b, t, 0.5)) s += 1000;
    for (const t of taken) if (hitB(b, t, 1)) s += 1000;
    if (onBorder(b, O.frames)) s += 300;
    s += wireThrough(b, wires.filter((x) => x.id !== w.id), null) * 200;
    return s;
  };
  // badges first (they are smaller and the AWS deck keeps them near the start of a hop), then labels
  const order = [...wires].sort((a, b) => pathLen(a.pts) - pathLen(b.pts));
  for (const w of order) {
    const n = badgeOf(w.id);
    if (n == null) continue;
    const { list } = spots(w.pts, 4, 13);
    const cands = [];
    for (const sp of list) {
      const opts = sp.hz ? [[0, -11], [0, 11]] : [[-13, 0], [13, 0]];
      for (const [dx, dy] of opts) {
        const b = { x0: sp.x + dx - 7.5, y0: sp.y + dy - 7.5, x1: sp.x + dx + 7.5, y1: sp.y + dy + 7.5 };
        const pref = w.edge.label ? Math.abs(sp.f - 0.22) * 30 : sp.mid * 0.08 + Math.abs(sp.f - 0.5) * 6;
        cands.push({ f: sp.f, dx, dy, b, score: scoreBadge(b, w) + pref + (dy > 0 || dx > 0 ? 3 : 0) + (sp.hz ? 0 : 4) });
      }
    }
    cands.sort((a, b) => a.score - b.score);
    w.badgeCands = dedupeCands(cands);
    w.badge = w.badgeCands[0] || null;
    if (w.badge) taken.push(w.badge.b);
  }
  for (const w of order) {
    const label = w.edge.label;
    if (!label) continue;
    const { list } = spots(w.pts, 5);
    const cands = [];
    const lw = Math.max(...String(label).split('\n').map((l) => textWidth(l, PX.wire)));
    for (const sp of list) {
      if (sp.hz) {
        if (sp.segLen < lw + 8) continue;
        const nl = String(label).split('\n').length;
        for (const dy of [-5 - 9.5 * (nl - 1), 12]) {
          const b = textBox(label, sp.x, sp.y + dy);
          cands.push({ f: sp.f, dy: r2(dy), b, score: scoreText(b, w) + sp.mid * 0.05 + (dy > 0 ? 4 : 0) });
        }
      } else {
        for (const [anchor, dx] of [['start', 6], ['end', -6]]) {
          const b = textBox(label, sp.x + dx, sp.y + 3, anchor);
          cands.push({ f: sp.f, dx, dy: 3, anchor, b, score: scoreText(b, w) + 12 + sp.mid * 0.05 + (anchor === 'end' ? 3 : 0) });
        }
      }
    }
    cands.sort((a, b) => a.score - b.score);
    w.labelCands = dedupeCands(cands);
    w.labelPos = w.labelCands[0] || null;
    if (w.labelPos) taken.push(w.labelPos.b);
  }
  return wires;
}
function dedupeCands(c) {
  const seen = new Set(), out = [];
  for (const x of c) { const k = `${Math.round(x.b.x0)},${Math.round(x.b.y0)}`; if (seen.has(k)) continue; seen.add(k); out.push(x); if (out.length >= 40) break; }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// the whole pass: cells, then tracks and routes until titles, header crossings and twins settle
export function layout(model, opts = {}) {
  for (const n of model.nodes.values()) measureNode(n);
  const n0 = model.issues.length;
  const first = layoutOnce(model, opts);
  // a layered drawing taller (or wider) than any tile: try the other axis, and say so
  if (!model.sided && first.geo.tile === 'over' && !opts.keepDirection) {
    const dir = model.dir, alt = { LR: 'TD', RL: 'BT', TD: 'LR', BT: 'RL' }[dir];
    const said = model.issues.splice(n0);
    model.dir = alt;
    const second = layoutOnce(model, opts);
    if (second.geo.tile !== 'over') {
      model.issues.push({ severity: 'info', code: 'direction', element: null, message: `drawn ${alt} instead of ${dir}: ${dir} needs ${first.geo.W}x${first.geo.H}, more than a full tile (1400x900); ${alt} fits a ${second.geo.tile} tile` });
      return second;
    }
    model.issues.splice(n0);
    model.issues.push(...said);
    model.dir = dir;
  }
  return first;
}
function layoutOnce(model, opts) {
  const cells = model.sided ? gridFromSides(model) : layered(model);
  const ex = { l: new Map(), r: new Map(), t: new Map(), b: new Map(), needX: new Map(), needY: new Map() };
  const align = new Map();
  let geo, wires, routed = null;
  for (let pass = 0; pass < 8; pass++) {
    geo = geometry(model, cells, ex, opts);
    let changed = false;
    // titles must fit their frame
    for (const [gid, R] of geo.rects) {
      const g = model.groups.get(gid), t = groupTitle(g);
      const need = (groupHasIcon(g) ? 25 : 8) + textWidth(t, PX.group) + (g.note ? textWidth(g.note, 9) + 14 : 0) + 8;
      if (R.w + 0.5 < need) { const d = Math.ceil((need - R.w) / 2); ex.l.set(gid, (ex.l.get(gid) || 0) + d); ex.r.set(gid, (ex.r.get(gid) || 0) + d); changed = true; }
    }
    if (changed) continue;
    for (const g of model.groups.values()) if (geo.rects.has(g.id) && !align.has(g.id)) align.set(g.id, centeredKind(g) ? 'center' : 'left');
    for (const g of model.groups.values()) {
      const R = geo.rects.get(g.id);
      if (!R || align.get(g.id) !== 'center') continue;
      const hb = headerBox(g, R, 'center'), nb = noteBox(g, R);
      if (hb && (hb.x0 < R.x + 6 || (nb && hb.x1 + 6 > nb.x0))) for (const o of model.groups.values()) if (o.kind === g.kind && align.get(o.id) === 'center') align.set(o.id, 'left');
    }
    geo.align = align;
    wires = routeAll(model, geo, opts); routed = geo;
    // a centred header that a wire crosses moves left, for the whole kind (awd keeps sibling frames alike)
    for (const h of headerHits(model, geo, wires, align)) {
      const g = model.groups.get(h.gid);
      if (align.get(h.gid) === 'center') { for (const o of model.groups.values()) if (o.kind === g.kind && align.get(o.id) === 'center') align.set(o.id, 'left'); changed = true; }
    }
    if (changed) continue;
    // a wire through a left-aligned title: move the frame's content right of the title
    for (const h of headerHits(model, geo, wires, align)) {
      if (h.x == null) continue;
      if (h.note) { const d = Math.ceil(h.x + 7 - h.hb.x0); if (d > 0 && d < 400) { ex.r.set(h.gid, (ex.r.get(h.gid) || 0) + d); changed = true; } continue; }
      const d = Math.ceil(h.hb.x1 + 7 - h.x);
      if (d > 0 && d < 400) { ex.l.set(h.gid, (ex.l.get(h.gid) || 0) + d); changed = true; }
    }
    // twins: frames of one kind and depth over the same columns (or rows) get the same extras
    const twins = (k0, k1, sides) => {
      const byKey = new Map();
      for (const [gid, b] of geo.gb) { const g = model.groups.get(gid); const key = `${g.kind}|${g.depth}|${b[k0]}|${b[k1]}`; if (!byKey.has(key)) byKey.set(key, []); byKey.get(key).push(gid); }
      for (const list of byKey.values()) {
        if (list.length < 2) continue;
        for (const s of sides) {
          const m = Math.max(...list.map((gid) => ex[s].get(gid) || 0));
          for (const gid of list) if ((ex[s].get(gid) || 0) < m) { ex[s].set(gid, m); changed = true; }
        }
      }
    };
    twins('c0', 'c1', ['l', 'r']); twins('r0', 'r1', ['t', 'b']);
    if (!changed) break;
  }
  if (routed !== geo) {
    for (const g of model.groups.values()) if (geo.rects.has(g.id) && !align.has(g.id)) align.set(g.id, centeredKind(g) ? 'center' : 'left');
    geo.align = align;
    wires = routeAll(model, geo, opts);
  }
  return { geo, wires, align, cells };
}
