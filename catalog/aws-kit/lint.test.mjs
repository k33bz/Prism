// Tests for the geometry lint and the placement helpers. Run: node --test catalog/aws-kit/lint.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lint } from './awd.mjs';
import { textWidth } from './lint.mjs';
import { centered, R, L, B, P, lblH } from './place.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const nd = centered(40);
const codes = (spec) => lint(spec).filter((f) => f.severity === 'error').map((f) => f.code).sort();
const base = (extra = {}) => ({ id: 'x-lint', w: 480, h: 240, ...extra });

test('Arial advance widths', () => {
  assert.equal(Math.round(textWidth('Amazon EC2', 10.5) * 10) / 10, 61.9);
  assert.ok(textWidth('b', 10, true) > textWidth('b', 10));
});

test('a clean diagram has no findings', () => {
  const a = nd('a', 'aws-svc-lambda', 100, 100, 'AWS Lambda'), b = nd('b', 'aws-svc-dynamodb', 300, 100, 'Amazon DynamoDB');
  assert.deepEqual(lint(base({ groups: [{ kind: 'cloud', x: 20, y: 20, w: 440, h: 200 }], nodes: [a, b], wires: [{ id: 'w', d: P(R(a), L(b)) }] })), []);
});

test('text across a frame border, wires through text and icons, badges on icons, off-canvas', () => {
  const a = nd('a', 'aws-svc-lambda', 100, 100, 'AWS Lambda'), b = nd('b', 'aws-svc-dynamodb', 300, 100, 'Amazon DynamoDB'), c = nd('c', 'aws-svc-ec2', 200, 100, 'Amazon EC2');
  // the frame edge at x=100 runs through the Lambda label
  assert.deepEqual(codes(base({ groups: [{ kind: 'vpc', x: 100, y: 10, w: 300, h: 200 }], nodes: [a] })), ['text-on-border']);
  // a wire leaving the Lambda icon straight down through its label; a straight wire through an icon it does not connect
  assert.deepEqual(codes(base({ nodes: [a, b, c], wires: [{ id: 'v', d: 'M100,126 V200' }, { id: 'h', d: P(R(a), L(b)) }] })), ['wire-on-icon', 'wire-on-text']);
  assert.deepEqual(codes(base({ nodes: [a], steps: [{ n: 1, x: 100, y: 100 }] })), ['badge-on-icon']);
  assert.deepEqual(codes(base({ nodes: [nd('z', 'aws-svc-lambda', 470, 100, 'AWS Lambda')] })), ['off-canvas', 'off-canvas']);   // icon and label
});

test('timed captions only clash with what shows at the same time; lintAllow accepts a finding', () => {
  const notes = [{ x: 100, y: 50, text: 'first', t: [0.1, 0.3] }, { x: 100, y: 50, text: 'second', t: [0.4, 0.6] }];
  assert.deepEqual(codes(base({ notes })), []);
  assert.deepEqual(codes(base({ notes: [notes[0], { ...notes[1], t: [0.2, 0.5] }] })), ['text-overlap']);
  const spec = base({ notes: [{ x: 100, y: 50, text: 'one' }, { x: 100, y: 50, text: 'one' }] });
  assert.deepEqual(codes(spec), ['text-overlap']);
  assert.deepEqual(codes({ ...spec, lintAllow: ['text-overlap'] }), []);
});

test('place.mjs: ports, label height, orthogonal paths', () => {
  const n = nd('n', 'aws-svc-lambda', 100, 100, 'Amazon API Gateway', { sub: 'REST' });
  assert.deepEqual(R(n), [124, 100]);
  assert.equal(lblH(n), 13 * 2 + 11);
  assert.deepEqual(B(n), [100, 124 + 37]);
  assert.equal(P([0, 0], [10, 0], [10, 20]), 'M0,0 H10 V20');
  assert.throws(() => P([0, 0], [10, 10]), /diagonal/);
});

test('every gallery diagram passes lint without errors', async () => {
  for (const f of fs.readdirSync(path.join(HERE, 'specs')).filter((x) => x.endsWith('.mjs'))) {
    const mod = (await import(pathToFileURL(path.join(HERE, 'specs', f)).href)).default;
    for (const d of mod.diagrams) assert.deepEqual(lint(d).filter((x) => x.severity === 'error'), [], `${f} ${d.id}`);
  }
});
