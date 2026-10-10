// Tests for rules and routes tables, IPv6 packets and two-line frame notes.
// Run: node --test catalog/aws-kit/tables.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSpec, diagram } from './awd.mjs';
import { validateDiagram } from './spec.mjs';
import { compileFlows } from './story.mjs';
import { freeze } from './frame.mjs';

const base = () => ({ id: 'x-tb', name: 'Tables', w: 480, h: 240,
  nodes: [{ id: 'a', icon: 'aws-svc-lambda', x: 0, y: 100 }, { id: 'b', icon: 'aws-svc-dynamodb', x: 200, y: 100 }],
  wires: [{ id: 'w', from: 'a', to: 'b' }] });
const rejects = (patch, re) => assert.throws(() => checkSpec({ ...base(), ...patch }), re);

test('a rules table: title, small-caps columns, cells, a row lit during its window', () => {
  const s = { ...base(), tables: [{ id: 'sg', x: 300, y: 20, title: 'sg-app inbound rules', tone: 'security', cols: ['Type', 'Port', 'Source'],
    rows: [{ cells: ['TCP', '8080', 'sg-alb'], t: [0.3, 0.4], tone: 'ok' }, ['TCP', '22', '10.0.0.0/8'], { cells: ['All', 'All', 'no match: denied'], tone: 'muted' }] }] };
  checkSpec(s);
  assert.deepEqual(validateDiagram(s), []);
  const svg = diagram(s);
  assert.match(svg, /<g class="awd-table" data-table="sg"><rect class="awd-tb" x="300" y="20" [^>]*rx="3"\/><rect [^>]*style="fill:#DD344C"\/><text class="t-tb" [^>]*font-weight:700">sg-app inbound rules<\/text>/);
  assert.match(svg, /<text class="t-tbh" [^>]*>TYPE<\/text>/);
  assert.match(svg, /<g class="anim" opacity="0"><rect [^>]*fill:#3F8624;fill-opacity:.16[^>]*\/><animate attributeName="opacity" [^>]*values="0;1;0" keyTimes="0;\.3;\.4"\/><\/g>/);
  assert.match(svg, /<text class="t-tb t-tbm" [^>]*>no match: denied<\/text>/);
  // the lit row's highlight sits under its text
  assert.ok(svg.indexOf('fill:#3F8624') < svg.indexOf('>sg-alb<'));
});

test('table input checks', () => {
  rejects({ tables: [{ x: 1, y: 1, title: 't', cols: ['A', 'B'], rows: [['1']] }] }, /1 cells for 2 columns/);
  rejects({ tables: [{ x: 1, y: 1, title: 't', rows: [] }] }, /1 to 12 rows/);
  rejects({ tables: [{ x: 1, y: 1, title: 't', rows: [{ cells: ['a'], tone: 'neon' }] }] }, /must be one of/);
  rejects({ tables: [{ x: 1, y: 1, title: 't', rows: [{ cells: ['a'], t: [0.5, 0.2] }] }] }, /./);
});

test('IPv6 packets are diamonds, the legend keys both shapes, flows carry v6 into replies', () => {
  const s = { ...base(), timeline: [{ wire: 'w', t: [0.1, 0.3] }, { wire: 'w', t: [0.4, 0.6], v6: true, kind: 'pk-2' }], legend: { x: 10, y: 20 } };
  const svg = diagram(s);
  assert.match(svg, /<path class="pk-2 pk-v6" d="M0,-4.76 L4.76,0 L0,4.76 L-4.76,0Z" opacity="0"><animateMotion /);
  assert.match(svg, /<circle class="pk" r="3.4" opacity="0"><animateMotion /);
  assert.match(svg, /<circle class="lg-shape" [^>]*\/><text [^>]*>IPv4 packet<\/text><path class="lg-shape" [^>]*\/><text [^>]*>IPv6 packet<\/text>/);
  const f = compileFlows({ ...base(), flows: [{ path: ['a', 'b'], reply: true, v6: true }] });
  assert.deepEqual(f.timeline.map((e) => [e.kind || 'pk', !!e.v6]), [['pk', true], ['pk-2', true]]);
  // a frozen frame places the diamond with a transform (a circle moves by cx/cy)
  assert.match(freeze(svg, 0.5), /<path class="pk-2 pk-v6" d="[^"]*" opacity="1" transform="translate\(\d+(\.\d+)?,\d+(\.\d+)?\)">/);
});

test('a dual-stack frame shows its IPv4 and IPv6 CIDRs on two lines', () => {
  const s = { ...base(), groups: [{ kind: 'priv', x: 0, y: 0, w: 300, h: 200, note: ['10.0.1.0/24', '2001:db8:1200:1::/64'] }] };
  checkSpec(s);
  assert.deepEqual(validateDiagram(s), []);
  const svg = diagram(s);
  assert.match(svg, /<text class="t-sub" x="294" y="14" style="text-anchor:end">10.0.1.0\/24<\/text><text class="t-sub" x="294" y="25" style="text-anchor:end">2001:db8:1200:1::\/64<\/text>/);
  rejects({ groups: [{ kind: 'priv', x: 0, y: 0, w: 9, h: 9, note: ['a', 'b', 'c'] }] }, /one or two lines/);
});

test('rows light in several windows, or while packets travel a wire (one IP version if asked)', async () => {
  const { lint } = await import('./awd.mjs');
  const s = { ...base(), timeline: [{ wire: 'w', t: [0.1, 0.2] }, { wire: 'w', t: [0.5, 0.6], v6: true }],
    tables: [{ x: 300, y: 20, title: 'routes', rows: [{ cells: ['a'], t: [[0.1, 0.2], [0.7, 0.8]], tone: 'ok' }, { cells: ['b'], on: 'w', tone: 'ok' }, { cells: ['c'], on: 'w', v6: true, tone: 'ok' }] }] };
  checkSpec(s);
  assert.deepEqual(validateDiagram(s), []);
  const svg = diagram(s);
  assert.match(svg, /values="0;1;0;1;0" keyTimes="0;\.1;\.2;\.7;\.8"/);
  assert.match(svg, /values="0;1;0;1;0" keyTimes="0;\.1;\.23;\.5;\.63"/);   // both packets, each a moment past arrival
  assert.match(svg, /values="0;1;0" keyTimes="0;\.5;\.63"/);                // the IPv6 one only
  assert.deepEqual(lint(s).filter((f) => f.severity === 'error'), []);
  assert.throws(() => checkSpec({ ...s, tables: [{ x: 1, y: 1, title: 't', rows: [{ cells: ['a'], on: 'nope' }] }] }), /unknown wire "nope"/);
});

test('lint: a table off the canvas, across a frame edge, or under a wire or icon is an error', async () => {
  const { lint } = await import('./awd.mjs');
  const codes = (patch) => lint({ ...base(), ...patch }).filter((f) => f.severity === 'error').map((f) => f.code);
  assert.ok(codes({ tables: [{ x: 440, y: 20, title: 'wide table here', rows: [['x']] }] }).includes('off-canvas'));
  assert.ok(codes({ groups: [{ kind: 'vpc', x: 250, y: 0, w: 220, h: 230 }], tables: [{ x: 230, y: 40, title: 'routes', rows: [['x']] }] }).includes('table-on-border'));
  assert.ok(codes({ tables: [{ x: 60, y: 110, title: 'routes over the wire', rows: [['x']] }] }).some((c) => c === 'wire-on-table' || c === 'table-overlap'));
  assert.deepEqual(codes({ tables: [{ x: 300, y: 20, title: 'routes', rows: [['x']] }] }), []);
});

test('legend keys only the IP versions used; a hop names its reply ring; a step can pin its storyboard moment', async () => {
  const { storyboard } = await import('./frame.mjs');
  const only6 = diagram({ ...base(), timeline: [{ wire: 'w', t: [0.1, 0.3], v6: true }], legend: { x: 10, y: 20 } });
  assert.match(only6, />IPv6 packet</);
  assert.doesNotMatch(only6, />IPv4 packet</);
  const drawn = { ...base(), wires: [{ id: 'd', d: 'M42,120 H200' }], flows: [{ wires: [{ wire: 'd', ring: 'b', back: 'a' }], reply: true }] };
  checkSpec(drawn);
  assert.deepEqual(validateDiagram(drawn), []);
  assert.deepEqual(compileFlows(drawn).timeline.map((e) => e.ring), ['b', 'a']);
  const st = { ...base(), timeline: [{ wire: 'w', t: [0.1, 0.3] }, { wire: 'w', t: [0.6, 0.8], kind: 'pk-bad' }], steps: [{ n: 1, at: 'w', text: 'Request.' }, { n: 2, at: 'w', text: 'Denied.', moment: 0.75 }] };
  assert.deepEqual(storyboard(st).map((f) => f.at), [0.2, 0.75]);
  assert.throws(() => checkSpec({ ...st, steps: [{ n: 1, at: 'w', moment: 1.2 }] }), /moment must be a fraction/);
});
