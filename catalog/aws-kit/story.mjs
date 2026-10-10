// story: an ordered list of hops becomes a diagram's timeline and numbered steps (k33bz fork). No deps.
// Importers use it to animate a design whose source gives an order (draw.io step badges, Mermaid
// numbered edges or `%% prism: flow a>b>c`, a CloudFormation sidecar), and authors can too:
//
//   import { story } from './story.mjs';
//   const { timeline, steps } = story([
//     { wire: 'w1', ring: 'apigw', text: 'Users call the API.' },
//     { wire: 'w2', ring: 'fn', text: 'API Gateway invokes the function.' },
//   ], { reply: true });
//
// A hop: { wire, reverse?, ring? (node id or { x, y, r }), kind? ('pk'|'pk-2'|'pk-bad'), text?,
// step? (false: no badge; a number or string: that badge text), f?, dx?, dy?, back? (ring for the
// reply leg: the node the request left) }. Windows share the clock evenly from `start` to `end`
// with `gap` between them (or in proportion to `weights`, one per leg); `reply` replays the request
// hops backwards as responses (pk-2); badges number from `first`.
//
// compileFlows(spec) turns a spec's `flows` (paths through the diagram, see the authoring guide)
// into timeline entries and steps after the spec's own; the generator calls it before drawing.

const r3 = (n) => Math.round(n * 1000) / 1000;

export function story(hops, { start = 0.04, end = 0.93, gap = 0.01, reply = false, first = 1, weights } = {}) {
  if (!Array.isArray(hops) || !hops.length) return { timeline: [], steps: [] };
  const legs = hops.map((h) => ({ ...h }));
  if (reply) {
    for (const h of [...hops].reverse()) legs.push({ wire: h.wire, reverse: !h.reverse, kind: 'pk-2', ring: h.back, step: false });
  }
  const room = end - start - gap * (legs.length - 1);
  if (!(room / legs.length > 0)) throw new Error(`story: ${legs.length} hops do not fit between ${start} and ${end}`);
  const wt = Array.isArray(weights) && weights.length === legs.length && weights.every((w) => w > 0) ? weights : legs.map(() => 1);
  const sum = wt.reduce((a, b) => a + b, 0);
  let a = start;
  const timeline = legs.map((h, i) => {
    const len = (room * wt[i]) / sum, t0 = a;
    a += len + gap;
    return {
      wire: h.wire, t: [r3(t0), r3(t0 + len)],
      ...(h.reverse ? { reverse: true } : {}), ...(h.kind && h.kind !== 'pk' ? { kind: h.kind } : {}), ...(h.ring != null ? { ring: h.ring } : {}),
    };
  });
  // one badge per request hop unless a hop says step: false; numbers run 1..n in order
  const steps = [];
  let n = first - 1;
  for (const h of hops) {
    if (h.step === false) continue;
    const label = h.step != null && h.step !== true ? h.step : ++n;
    if (h.step != null && h.step !== true && typeof h.step === 'number') n = h.step;
    steps.push({ n: label, at: h.wire, f: h.f != null ? h.f : 0.5, ...(h.dx != null ? { dx: h.dx } : {}), ...(h.dy != null ? { dy: h.dy } : {}), ...(h.text ? { text: h.text } : {}) });
  }
  return { timeline, steps };
}

// ---- flows: a path through the diagram as the author thinks of it ----
const segLen = (d) => {
  let x = 0, y = 0, L = 0;
  for (const [, c, v] of String(d).matchAll(/([MHVL])\s*([-\d.]+(?:[ ,][-\d.]+)?)/g)) {
    const n = v.split(/[ ,]/).map(Number), px = x, py = y;
    if (c === 'M' || c === 'L') { x = n[0]; y = n[1]; } else if (c === 'H') x = n[0]; else y = n[0];
    if (c !== 'M') L += Math.hypot(x - px, y - py);
  }
  return L;
};

/**
 * A spec with its flows compiled: { ...spec, timeline: [...own, ...flows], steps: [...own, ...flows] }
 * (the spec itself when it has none). A flow: { id?, path: [node ids] | wires: [wire id | hop],
 * reply?, text?: [one per hop], steps?: false, kind?, with?: flow id, t?: [a, b], pace?: 'length'|'even' }.
 * Flows run one after another in array order over the clock, each taking time in proportion to its
 * legs; `with` runs a flow alongside another, `t` pins its window. Packets keep one speed along a
 * flow (pace 'length': a long wire takes longer), rings pulse where each hop lands, and badges
 * number on from the spec's own steps.
 */
export function compileFlows(spec) {
  const flows = spec.flows || [];
  if (!flows.length) return spec;
  const nodes = new Map((spec.nodes || []).map((n) => [n.id, n]));
  const wires = spec.wires || [];
  const byId = new Map(wires.map((w) => [w.id, w]));
  const center = (n) => { const w = n.kind ? n.w : n.size || 40, h = n.kind ? n.h : n.size || 40; return [n.x + w / 2, n.y + h / 2]; };
  const lengthOf = (w) => {
    if (w.d) return segLen(w.d);
    const a = nodes.get(w.from), b = nodes.get(w.to);
    if (!a || !b) return 100;
    const [ax, ay] = center(a), [bx, by] = center(b);
    return Math.abs(ax - bx) + Math.abs(ay - by);
  };
  const hopsOf = (f, where) => {
    const hops = [];
    if (f.path) {
      for (let i = 1; i < f.path.length; i++) {
        const a = f.path[i - 1], b = f.path[i];
        const fw = wires.find((w) => w.from === a && w.to === b), bw = fw ? null : wires.find((w) => w.from === b && w.to === a);
        if (!fw && !bw) throw new Error(`${where}: no wire joins ${a} and ${b} (give the flow wires instead)`);
        hops.push({ wire: (fw || bw).id, ...(bw ? { reverse: true } : {}), ring: b, back: a });
      }
    } else {
      for (const x of f.wires) {
        const h = typeof x === 'string' ? { wire: x } : { ...x };
        const w = byId.get(h.wire);
        if (!w) throw new Error(`${where}: unknown wire ${JSON.stringify(h.wire)}`);
        if (h.ring === undefined && w.from && w.to) h.ring = h.reverse ? w.from : w.to;
        if (h.back === undefined && w.from && w.to) h.back = h.reverse ? w.to : w.from;
        if (h.ring === false) delete h.ring;   // no ring where this hop lands
        hops.push(h);
      }
    }
    hops.forEach((h, i) => {
      if (f.text?.[i] && h.text == null) h.text = f.text[i];
      if (f.steps === false) h.step = false;
      if (f.kind && !h.kind) h.kind = f.kind;
    });
    return hops;
  };
  const prepared = flows.map((f, i) => {
    const hops = hopsOf(f, `${spec.id} flow[${i}]`);
    const legs = hops.length * (f.reply ? 2 : 1);
    const lens = hops.map((h) => lengthOf(byId.get(h.wire)));
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length || 1;
    // one speed along the flow, but no leg so short its packet only blinks
    const w = lens.map((L) => Math.max(L, mean * 0.35));
    const weights = (f.pace || 'length') === 'length' ? [...w, ...(f.reply ? [...w].reverse() : [])] : null;
    return { f, hops, legs, weights };
  });
  // windows: pinned ones as given; the rest share the clock in order, by legs; `with` copies its partner's
  const START = 0.04, END = 0.93, GAP = 0.02;
  const seq = prepared.filter((p) => !p.f.t && p.f.with == null);
  const total = seq.reduce((a, p) => a + p.legs, 0);
  let at = START;
  const room = END - START - GAP * Math.max(0, seq.length - 1);
  for (const p of seq) { const len = (room * p.legs) / total; p.t = [at, at + len]; at += len + GAP; }
  for (const p of prepared) if (p.f.t) p.t = p.f.t;
  for (const p of prepared) {
    if (p.f.with == null) continue;
    const partner = prepared.find((q) => q.f.id === p.f.with);
    if (!partner || !partner.t) throw new Error(`${spec.id}: flow with names unknown flow ${JSON.stringify(p.f.with)}`);
    // starts with its partner, and a leg takes as long as one of the partner's
    const span = partner.t[1] - partner.t[0];
    p.t = [partner.t[0], partner.t[0] + span * Math.min(1, p.legs / partner.legs)];
  }
  const own = (spec.steps || []).map((s) => Number(s.n)).filter(Number.isFinite);
  let next = (own.length ? Math.max(...own) : 0) + 1;
  const timeline = [], steps = [];
  for (const p of prepared) {
    const out = story(p.hops, { start: p.t[0], end: p.t[1], gap: 0.005, reply: !!p.f.reply, first: next, weights: p.weights });
    timeline.push(...out.timeline);
    steps.push(...out.steps);
    const nums = out.steps.map((s) => Number(s.n)).filter(Number.isFinite);
    if (nums.length) next = Math.max(...nums) + 1;
  }
  return { ...spec, timeline: [...(spec.timeline || []), ...timeline], steps: [...(spec.steps || []), ...steps] };
}
