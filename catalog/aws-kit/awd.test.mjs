// Tests for the AWS kit generator: input checks, markup safety and the gallery's own specs.
// Run: node --test catalog/aws-kit/awd.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkSpec, diagram, section, validate } from './awd.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const base = () => ({ id: 'x-probe', nodes: [{ id: 'a', icon: 'aws-svc-lambda', x: 0, y: 0 }, { id: 'b', icon: 'aws-svc-dynamodb', x: 120, y: 0 }] });
const rejects = (patch, re) => assert.throws(() => checkSpec({ ...base(), ...patch }), re);

test('extra accepts fragment references', () => {
  checkSpec({ ...base(), extra: '<use href="#aws-svc-lambda" x="1" y="1"/><path d="M0,0 H9" style="marker-end:url(#x-probe-ah)"/>' });
});

test('extra rejects script, handlers, external references and foreign content', () => {
  for (const extra of [
    '<script>alert(1)</script>', '<g onload="x()"/>', '<image href="http://e.example/x.png"/>', '<use href=x />',
    '<use xlink:href="https://e.example/a.svg#b"/>', '<rect style="fill:url(http://e.example/p)"/>', '<a href="javascript:x()">a</a>',
    '<foreignObject><div/></foreignObject>', '<style>.awd{}</style>',
  ]) rejects({ extra }, /extra/);
});

test('ids, numbers, paths and enumerations are checked before markup is written', () => {
  rejects({ nodes: [{ id: 'a" onclick="x', icon: 'aws-svc-lambda', x: 0, y: 0 }] }, /id must match/);
  rejects({ nodes: [{ id: 'a', icon: 'aws-svc-lambda', x: '1" y="2', y: 0 }] }, /finite number/);
  rejects({ wires: [{ id: 'w', d: 'M0,0 C1,1 2,2 3,3' }] }, /M, H, V, L/);
  rejects({ wires: [{ id: 'w', d: 'M0,0 H9' }], timeline: [{ wire: 'w', t: [0.1, 0.2], kind: 'pk" x="' }] }, /kind must be/);
  rejects({ wires: [{ id: 'w', from: 'constructor', to: 'a' }] }, /unknown node/);
  rejects({ wires: [{ id: 'w', d: 'M0,0 H9' }], steps: [{ n: 1, at: 'ww' }] }, /unknown wire/);
  rejects({ groups: [{ kind: 'vpc', x: 0, y: 0, w: 10 }] }, /\.h/);
  rejects({ groups: [{ kind: 'subnet', x: 0, y: 0, w: 10, h: 10 }] }, /unknown group kind/);
  rejects({ nodes: [{ id: 'a', icon: 'aws-svc-nope', x: 0, y: 0 }] }, /unknown icon/);
  rejects({ notes: [{ x: 1, y: 1, text: 'n', anchor: 'left' }] }, /anchor/);
  rejects({ timeline: [{ ring: 'a', t: [0.5, 0.4] }] }, /0 < a < b < 1/);
  assert.throws(() => section({ section: { id: '../evil', title: 't' }, diagrams: [] }), /kebab/);
});

test('arrowheads are open chevrons and icon-less frames center their header', () => {
  const svg = diagram({ ...base(), groups: [{ kind: 'az', x: 0, y: 0, w: 200, h: 80 }, { kind: 'vpc', x: 0, y: 0, w: 200, h: 80 }], wires: [{ id: 'w', from: 'a', to: 'b' }] });
  assert.match(svg, /<marker id="x-probe-ah"[^>]*><path class="ah" d="M1\.5,1\.5 L9,5 L1\.5,8\.5"/);
  assert.match(svg, /<text class="t-g t-gc" x="100" y="14">Availability Zone<\/text>/);
  assert.match(svg, /<text class="t-g" x="25" y="14">VPC<\/text>/);
});

test('every gallery spec builds and validates', async () => {
  const specs = fs.readdirSync(path.join(HERE, 'specs')).filter((f) => f.endsWith('.mjs'));
  const seen = new Map();
  for (const f of specs) {
    const mod = (await import(pathToFileURL(path.join(HERE, 'specs', f)).href)).default;
    assert.deepEqual(validate(section(mod)), [], f);
    for (const d of mod.diagrams) {
      assert.ok(!seen.has(d.id), `diagram id ${d.id} in ${f} is also in ${seen.get(d.id)}`);
      seen.set(d.id, f);
    }
  }
});
