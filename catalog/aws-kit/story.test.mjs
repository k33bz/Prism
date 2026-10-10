// Tests for story(): hops to windows and badges, and compileFlows(): a spec's flows to its timeline.
// Run: node --test catalog/aws-kit/story.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSpec, diagram, lint, stepTexts } from './awd.mjs';
import { validateDiagram } from './spec.mjs';
import { compileFlows, story } from './story.mjs';

// users -> api -> fn -> db along a row; the last wire twice as long as the others
const spec = (flows, extra = {}) => ({
  id: 'x-flow', name: 'Flow probe', w: 480, h: 120,
  nodes: [{ id: 'u', icon: 'aws-svc-lambda', x: 0, y: 30 }, { id: 'api', icon: 'aws-svc-api-gateway', x: 100, y: 30 },
    { id: 'fn', icon: 'aws-svc-lambda', x: 200, y: 30 }, { id: 'db', icon: 'aws-svc-dynamodb', x: 400, y: 30 }],
  wires: [{ id: 'w1', from: 'u', to: 'api' }, { id: 'w2', from: 'api', to: 'fn' }, { id: 'w3', from: 'fn', to: 'db' }, { id: 'log', d: 'M220,74 V100 H300' }],
  flows, ...extra,
});

test('story keeps even windows by default, and weights and first when asked', () => {
  assert.deepEqual(story([{ wire: 'a' }, { wire: 'b' }]).timeline.map((e) => e.t), [[0.04, 0.48], [0.49, 0.93]]);
  const w = story([{ wire: 'a' }, { wire: 'b' }], { weights: [1, 3], gap: 0 });
  assert.deepEqual(w.timeline.map((e) => e.t), [[0.04, 0.263], [0.263, 0.93]]);
  assert.deepEqual(story([{ wire: 'a' }, { wire: 'b' }], { first: 4 }).steps.map((s) => s.n), [4, 5]);
});

test('a path compiles to hops with rings where they land, at one speed, with replies', () => {
  const out = compileFlows(spec([{ id: 'req', path: ['u', 'api', 'fn', 'db'], reply: true, text: ['Users call the API.', '', 'The function writes the item.'] }]));
  const req = out.timeline.filter((e) => !e.kind);
  assert.deepEqual(req.map((e) => [e.wire, e.ring]), [['w1', 'api'], ['w2', 'fn'], ['w3', 'db']]);
  const len = (e) => e.t[1] - e.t[0];
  assert.ok(Math.abs(len(req[2]) - 2 * len(req[0])) < 0.01, 'the long wire takes twice as long');
  const rep = out.timeline.filter((e) => e.kind === 'pk-2');
  assert.deepEqual(rep.map((e) => [e.wire, e.reverse, e.ring]), [['w3', true, 'fn'], ['w2', true, 'api'], ['w1', true, 'u']]);
  assert.equal(out.timeline[0].t[0], 0.04);
  assert.equal(out.timeline.at(-1).t[1], 0.93);
  assert.deepEqual(out.steps.map((s) => [s.n, s.at, s.text]), [[1, 'w1', 'Users call the API.'], [2, 'w2', undefined], [3, 'w3', 'The function writes the item.']]);
});

test('a path may walk a wire backwards; wires name drawn paths; with runs alongside; t pins', () => {
  const out = compileFlows(spec([
    { id: 'a', path: ['db', 'fn'], steps: false },
    { wires: [{ wire: 'log', ring: 'db' }], kind: 'pk-2', with: 'a', steps: false },
    { path: ['u', 'api'], t: [0.5, 0.6], kind: 'pk-bad' },
  ]));
  const [back, log, bad] = out.timeline;
  assert.deepEqual([back.wire, back.reverse, back.ring], ['w3', true, 'fn']);
  assert.deepEqual([log.wire, log.ring, log.kind, log.t[0]], ['log', 'db', 'pk-2', back.t[0]]);
  assert.deepEqual([bad.wire, bad.kind, bad.t], ['w1', 'pk-bad', [0.5, 0.6]]);
  assert.deepEqual(out.steps.map((s) => s.n), [1]);
});

test('flows number on after the spec\'s own steps, and the generator draws them', () => {
  const s = spec([{ path: ['api', 'fn', 'db'], text: ['Two.', 'Three.'] }], { steps: [{ n: 1, at: 'w1', text: 'One.' }], timeline: [{ wire: 'w1', t: [0.01, 0.03] }] });
  checkSpec(s);
  assert.deepEqual(validateDiagram(s), []);
  assert.deepEqual(stepTexts(s), [['1', 'One.'], ['2', 'Two.'], ['3', 'Three.']]);
  const svg = diagram(s);
  assert.equal((svg.match(/<circle class="pk"/g) || []).length, 3);
  assert.match(svg, /<mpath href="#x-flow-w3"\/>/);
  assert.deepEqual(lint(s).filter((f) => f.severity === 'error'), []);
  assert.equal(compileFlows({ id: 'x' }).timeline, undefined);   // no flows: the spec as given
});

test('flow input checks', () => {
  const bad = (flows, re) => assert.throws(() => checkSpec(spec(flows)), re);
  bad([{ path: ['u'] }], /two or more/);
  bad([{ path: ['u', 'nope'] }], /unknown node "nope"/);
  bad([{ path: ['u', 'api'], wires: ['w1'] }], /one of them/);
  bad([{ wires: ['zz'] }], /unknown wire "zz"/);
  bad([{ path: ['u', 'api'], with: 'ghost' }], /unknown flow "ghost"/);
  bad([{ path: ['u', 'api'], kind: 'pk-9' }], /kind must be one of/);
  bad([{ path: ['u', 'api'], pace: 'fast' }], /must be one of/);
  bad([{ path: ['u', 'api'], t: [0.5, 0.2] }], /./);
  assert.throws(() => diagram(spec([{ path: ['u', 'db'] }])), /no wire joins u and db/);
});
