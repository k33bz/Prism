// Tests for frames: the SMIL clock evaluated at a moment, posters, storyboards and their exports.
// Run: node --test catalog/aws-kit/frame.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkSpec, diagram } from './awd.mjs';
import { frame, freeze, momentOf, storyboard } from './frame.mjs';
import { exportDiagram } from './import/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const family = async (f) => (await import(pathToFileURL(path.join(HERE, 'specs', f + '.mjs')).href)).default;
const byId = async (f, id) => (await family(f)).diagrams.find((d) => d.id === id);
const probe = () => ({ id: 'x-probe', nodes: [{ id: 'a', icon: 'aws-svc-lambda', x: 0, y: 0 }, { id: 'b', icon: 'aws-svc-dynamodb', x: 120, y: 0 }],
  wires: [{ id: 'w', from: 'a', to: 'b' }], timeline: [{ wire: 'w', t: [0.2, 0.6], ring: 'b' }], effects: [{ fade: 'w', t: [0.7, 0.9] }] });
const smil = (svg) => (svg.match(/<(animate|animateMotion|animateTransform|set)\b/g) || []).length;

test('freeze puts a packet where it is on its wire and leaves no animation', () => {
  const svg = freeze(diagram(probe()), 0.4);
  assert.match(svg, /<circle class="pk" r="3.4" opacity="1" cx="79" cy="20">/);   // halfway along M42,20 H116
  assert.equal(smil(svg), 0);
  assert.doesNotMatch(svg, /class="ring/);   // the ring waits for the packet to land
});

test('freeze evaluates linear values between key times, and drops what is not showing', () => {
  const ring = freeze(diagram(probe()), 0.66).match(/<circle class="ring"[^>]*>/)[0];
  assert.match(ring, /opacity="0.45"/);
  assert.match(ring, /r="26.95"/);
  assert.doesNotMatch(freeze(diagram(probe()), 0.66), /class="pk"/);   // the packet has landed
  assert.match(freeze(diagram(probe()), 0.8), /<path id="x-probe-w" class="w" [^>]*opacity=".16">/);   // drained
});

test('momentOf: fractions, the poster, and what it refuses', () => {
  assert.equal(momentOf({}, 0.25), 0.25);
  assert.equal(momentOf({}, '0.5'), 0.5);
  assert.equal(momentOf({}, 'poster'), null);
  assert.equal(momentOf({ poster: 0.64 }, 'poster'), 0.64);
  for (const bad of [1, -0.1, 'soon', NaN]) assert.throws(() => momentOf({}, bad), /fraction of the clock/);
  assert.throws(() => checkSpec({ ...probe(), poster: 1 }), /poster must be a fraction/);
  checkSpec({ ...probe(), poster: 0 });
});

test('frame: the poster moment, or the plain still diagram when the spec names none', () => {
  const still = frame(probe());
  assert.match(still, /^<svg [^>]*class="awd"[^>]*data-still=""/);
  const poster = frame({ ...probe(), poster: 0.4 }, 'poster', { theme: 'light' });
  assert.match(poster, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" class="awd awd-frame"[^>]*data-mode="light"/);
  assert.match(poster, /cx="79" cy="20"/);
  assert.equal(smil(poster), 0);
});

test('frame of a failure: the zone is red, nothing animates, no still copies', async () => {
  const d = await byId('three-tier', 'tt-az-fail');
  const svg = frame(d, 0.64, { theme: 'light' });
  assert.equal(smil(svg), 0);
  assert.match(svg, /g-hot/);
  assert.doesNotMatch(svg, /class="awd-static"/);
});

test('storyboard: one frame per step, in story order, concurrent hops sharing a moment', async () => {
  const az = storyboard(await byId('three-tier', 'tt-az-fail'));
  assert.deepEqual(az.map((f) => f.n), [1, 2, 3, 4]);
  for (let i = 1; i < az.length; i++) assert.ok(az[i].at >= az[i - 1].at, `step ${az[i].n} after step ${az[i - 1].n}`);
  assert.match(az[0].text, /Availability Zone a becomes unavailable/);
  assert.ok(az.every((f) => f.at != null && smil(f.svg) === 0));
  const s3 = storyboard(await byId('serverless', 'sl-s3-events'));
  assert.equal(s3[2].at, s3[3].at);   // Lambda writes the image and the metadata together
});

test('every gallery diagram with steps storyboards in order', async () => {
  for (const f of ['serverless', 'three-tier', 'directory', 'databases', 'regions', 'vpc', 'transit', 'endpoints', 'dns']) {
    for (const d of (await family(f)).diagrams) {
      if (!(d.steps || []).length) continue;
      const fr = storyboard(d);
      assert.ok(fr.every((x) => x.at != null), `${d.id}: every step has a moment`);
      for (let i = 1; i < fr.length; i++) assert.ok(fr[i].at >= fr[i - 1].at, `${d.id}: step ${fr[i].n} in order`);
    }
  }
});

test('exportDiagram: an svg at a moment, and a storyboard page', async () => {
  const d = await byId('three-tier', 'tt-az-fail');
  const svg = await exportDiagram(d, { to: 'svg', at: 0.64, theme: 'dark' });
  assert.equal(svg.at, 0.64);
  assert.match(svg.text, /class="awd awd-frame"[^>]*data-mode="dark"/);
  const sb = await exportDiagram(d, { to: 'storyboard' });
  assert.equal(sb.frames.length, 4);
  assert.match(sb.text, /^<!doctype html>/);
  assert.equal((sb.text.match(/<img src="data:image\/svg\+xml;base64,/g) || []).length, 4);
  assert.match(sb.text, /alt="Step 4: Amazon RDS fails over/);
  await assert.rejects(exportDiagram(d, { to: 'svg', at: 2 }), /fraction of the clock/);
});
