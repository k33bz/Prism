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
// with `gap` between them; `reply` replays the request hops backwards as responses (pk-2).

const r3 = (n) => Math.round(n * 1000) / 1000;

export function story(hops, { start = 0.04, end = 0.93, gap = 0.01, reply = false } = {}) {
  if (!Array.isArray(hops) || !hops.length) return { timeline: [], steps: [] };
  const legs = hops.map((h) => ({ ...h }));
  if (reply) {
    for (const h of [...hops].reverse()) legs.push({ wire: h.wire, reverse: !h.reverse, kind: 'pk-2', ring: h.back, step: false });
  }
  const len = (end - start - gap * (legs.length - 1)) / legs.length;
  if (!(len > 0)) throw new Error(`story: ${legs.length} hops do not fit between ${start} and ${end}`);
  const timeline = legs.map((h, i) => {
    const a = start + i * (len + gap);
    return {
      wire: h.wire, t: [r3(a), r3(a + len)],
      ...(h.reverse ? { reverse: true } : {}), ...(h.kind && h.kind !== 'pk' ? { kind: h.kind } : {}), ...(h.ring != null ? { ring: h.ring } : {}),
    };
  });
  // one badge per request hop unless a hop says step: false; numbers run 1..n in order
  const steps = [];
  let n = 0;
  for (const h of hops) {
    if (h.step === false) continue;
    const label = h.step != null && h.step !== true ? h.step : ++n;
    if (h.step != null && h.step !== true && typeof h.step === 'number') n = h.step;
    steps.push({ n: label, at: h.wire, f: h.f != null ? h.f : 0.5, ...(h.dx != null ? { dx: h.dx } : {}), ...(h.dy != null ? { dy: h.dy } : {}), ...(h.text ? { text: h.text } : {}) });
  }
  return { timeline, steps };
}
