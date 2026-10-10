// AWS Architecture diagrams: finding the kit beside the catalog, build_diagram and get_diagram_spec
// against the real kit and gallery specs (catalog/aws-kit), and the unavailable path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogStore } from '../utils/catalog.js';
import { kitDir } from '../utils/diagrams.js';
import { buildTools, ToolError } from '../tools/index.js';
import { createLogger } from '../utils/logger.js';
import { fixtureStore } from './helper.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const KIT = path.join(REPO, 'catalog', 'aws-kit');
// the tools only need the store's file path to find the kit, so the 25 MB catalog is never loaded
const repoStore = (file = path.join(REPO, 'Prism.html')) => new CatalogStore(file, { watch: false, logger: createLogger('silent') });
const tools = new Map(buildTools().map((t) => [t.name, t]));
const call = (name, args, store = repoStore()) => tools.get(name).handler(args, { store });

const probe = () => ({
  id: 'x-probe', name: 'Probe', desc: 'Lambda reads DynamoDB.',
  nodes: [{ id: 'fn', icon: 'aws-svc-lambda', x: 20, y: 40, label: 'AWS Lambda' }, { id: 'db', icon: 'aws-svc-dynamodb', x: 160, y: 40, label: 'Amazon DynamoDB' }],
  wires: [{ id: 'w', from: 'fn', to: 'db' }],
  timeline: [{ wire: 'w', t: [0.1, 0.4], ring: 'db' }],
});

test('kitDir finds catalog/aws-kit beside Prism.html and aws-kit beside catalog/manifest.json', () => {
  assert.equal(kitDir(path.join(REPO, 'Prism.html')), KIT);
  assert.equal(kitDir(path.join(REPO, 'catalog', 'manifest.json')), KIT);
  assert.equal(kitDir(path.join(HERE, 'nowhere.json')), null);
});

test('build_diagram: one diagram becomes a standalone svg and the gallery svg', async () => {
  const r = await call('build_diagram', { spec: probe() });
  assert.deepEqual(r.errors, []);
  assert.equal(r.id, 'x-probe');
  assert.match(r.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="awd" viewBox="0 0 480 240" width="480" height="240" role="img" aria-label="Probe"><title>Probe<\/title><desc>Lambda reads DynamoDB\.<\/desc><metadata id="awd-spec"/);
  assert.match(r.svg, /<symbol id="aws-svc-lambda" viewBox=/);
  assert.doesNotMatch(r.svg, /^<svg[^>]*data-(mode|still)/);
  assert.match(r.html, /^<svg class="awd" viewBox="0 0 480 240"/);
  assert.match(r.html, /<g class="awd-n" data-node="fn" data-icon="aws-svc-lambda"><title>AWS Lambda<\/title>/);
  assert.match(r.html, /data-from="fn" data-to="db"/);
  const dark = await call('build_diagram', { spec: JSON.stringify(probe()), theme: 'dark', still: true });
  assert.match(dark.svg, /^<svg[^>]* data-mode="dark" data-still="">/);
});

test('build_diagram reports schema and kit errors instead of output', async () => {
  const typo = probe(); typo.nodes[0].lable = 'x';
  let r = await call('build_diagram', { spec: typo });
  assert.equal(r.svg, null);
  assert.deepEqual(r.errors, ['nodes[0].lable: unknown property (did you mean label?)']);
  const icon = probe(); icon.nodes[1].icon = 'aws-svc-nope';
  r = await call('build_diagram', { spec: icon });
  assert.equal(r.html, null);
  assert.match(r.errors[0], /unknown icon "aws-svc-nope"/);
  const ref = probe(); ref.timeline[0].ring = 'ghost';
  r = await call('build_diagram', { spec: ref });
  assert.match(r.errors[0], /unknown ring node "ghost"/);
  const unsafe = { ...probe(), extra: '<script>alert(1)</script>' };
  r = await call('build_diagram', { spec: unsafe });
  assert.equal(r.svg, null);
  assert.match(r.errors[0], /extra: element not allowed/);
});

test('build_diagram builds every diagram of a family', async () => {
  const two = { ...probe(), id: 'x-two', name: 'Two' };
  const r = await call('build_diagram', { spec: { version: 1, section: { id: 'probe', title: 'PROBE' }, diagrams: [probe(), two, probe()] } });
  assert.deepEqual(r.section, { id: 'probe', title: 'PROBE' });
  assert.deepEqual(r.diagrams.map((d) => [d.id, !!d.svg]), [['x-probe', true], ['x-two', true], ['x-probe', false]]);
  assert.deepEqual(r.errors, ['x-probe: id: duplicate diagram id x-probe']);
  const bad = await call('build_diagram', { spec: { section: { id: 'probe', title: 'PROBE' }, diagrams: [probe()] } });
  assert.deepEqual(bad.errors, ['(root): missing required version']);
});

test('build_diagram rejects bad arguments', async () => {
  await assert.rejects(call('build_diagram', { spec: [] }), (e) => e instanceof ToolError && e.code === 'invalid_argument');
  await assert.rejects(call('build_diagram', { spec: '{nope' }), (e) => e instanceof ToolError && /not valid JSON/.test(e.message));
  await assert.rejects(call('build_diagram', { spec: probe(), theme: 'sepia' }), (e) => e instanceof ToolError && e.code === 'invalid_argument');
});

test('diagram tools say clearly when the kit is not reachable', async () => {
  for (const [name, args] of [['build_diagram', { spec: probe() }], ['get_diagram_spec', { id: 'sl-api' }]]) {
    await assert.rejects(call(name, args, fixtureStore()), (e) => e instanceof ToolError && e.code === 'unavailable' && /AWS kit is not reachable/.test(e.message));
  }
});

test('get_diagram_spec: catalog or spec id, from json/, and the spec rebuilds the gallery svg', async () => {
  const a = await call('get_diagram_spec', { id: 'aws-sl-api' });
  const b = await call('get_diagram_spec', { id: 'sl-api' }, repoStore(path.join(REPO, 'catalog', 'manifest.json')));
  assert.deepEqual(a, b);
  assert.equal(a.catalogId, 'aws-sl-api');
  assert.deepEqual(a.family, { id: 'serverless', title: 'SERVERLESS' });
  assert.equal(a.version, 1);
  assert.equal(a.source, path.join(KIT, 'json', 'serverless.json'));
  const built = await call('build_diagram', { spec: a.spec });
  assert.deepEqual(built.errors, []);
  const awd = await import(new URL(`file:///${path.join(KIT, 'awd.mjs').replace(/\\/g, '/')}`).href);
  assert.equal(built.html, awd.diagram(a.spec));
});

test('get_diagram_spec: unknown ids get suggestions', async () => {
  await assert.rejects(call('get_diagram_spec', { id: 'aws-sl-apii' }), (e) => e instanceof ToolError && e.code === 'not_found' && e.data.suggestions.includes('sl-api'));
  await assert.rejects(call('get_diagram_spec', { id: ' ' }), (e) => e instanceof ToolError && e.code === 'invalid_argument');
});

test('lint_diagram: gallery diagrams are clean; a label across a frame edge is an error', async () => {
  const g = await call('lint_diagram', { id: 'aws-tt-classic' });
  assert.equal(g.id, 'tt-classic');
  assert.equal(g.clean, true);
  assert.equal(g.counts.error, 0);
  const bad = { ...probe(), groups: [{ kind: 'vpc', x: 40, y: 10, w: 300, h: 200 }] };   // the frame's left edge runs through the Lambda label
  const r = await call('lint_diagram', { spec: bad });
  assert.equal(r.clean, false);
  assert.ok(r.findings.some((f) => f.severity === 'error' && f.code === 'text-on-border' && /AWS Lambda/.test(f.message)), JSON.stringify(r.findings));
  await assert.rejects(call('lint_diagram', {}), (e) => e instanceof ToolError && /exactly one/.test(e.message));
  await assert.rejects(call('lint_diagram', { id: 'aws-nope' }), (e) => e instanceof ToolError && e.code === 'not_found');
});

test('build_diagram returns lint findings with the drawing', async () => {
  const r = await call('build_diagram', { spec: { ...probe(), groups: [{ kind: 'vpc', x: 40, y: 10, w: 300, h: 200 }] } });
  assert.deepEqual(r.errors, []);
  assert.ok(r.svg);
  assert.ok(r.lint.some((f) => f.code === 'text-on-border'));
});

// ---- import_diagram / export_diagram against the real importers ----
import fs from 'node:fs';
const FIX = path.join(KIT, 'import', 'fixtures');
const fixture = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

test('import_diagram: draw.io, Mermaid, PlantUML and D2 sources become lint-clean kit specs with an svg', async () => {
  for (const [file, from] of [['three-tier.drawio', 'drawio'], ['three-tier.compressed.drawio', 'drawio'], ['mmd-serverless-arch.mmd', 'mermaid'], ['mmd-threetier-flow.mmd', 'mermaid'], ['puml-three-tier.puml', 'plantuml'], ['d2-steps.d2', 'd2']]) {
    if (!fs.existsSync(path.join(FIX, file))) continue;
    const r = await call('import_diagram', { content: fixture(file) });
    assert.equal(r.report.from, from, file);
    assert.match(r.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="awd"/, file);
    assert.ok(r.spec.nodes.length > 0, file);
    const lint = await call('lint_diagram', { spec: r.spec });
    assert.equal(lint.counts.error, 0, `${file}: ${JSON.stringify(lint.findings.filter((f) => f.severity === 'error'))}`);
  }
  const png = fs.readFileSync(path.join(FIX, 'embed.drawio.png'));
  const fromPng = await call('import_diagram', { contentBase64: png.toString('base64') });
  assert.equal(fromPng.report.from, 'drawio');
  await assert.rejects(call('import_diagram', { content: 'hello world' }), (e) => e instanceof ToolError && /format/.test(e.message));
  await assert.rejects(call('import_diagram', {}), (e) => e instanceof ToolError && /exactly one/.test(e.message));
});

test('export_diagram: a gallery diagram to draw.io (and back, animation restored), Mermaid and svg', async () => {
  const dio = await call('export_diagram', { id: 'aws-tt-classic', to: 'drawio' });
  assert.match(dio.text, /^<mxfile /);
  const back = await call('import_diagram', { content: dio.text });
  const orig = await call('get_diagram_spec', { id: 'tt-classic' });
  assert.equal(back.spec.timeline.length, orig.spec.timeline.length);
  const mmd = await call('export_diagram', { id: 'tt-classic', to: 'mermaid' });
  assert.match(mmd.text, /^(---[\s\S]*?---\s*)?(%%.*\n)*\s*flowchart /m);
  const svg = await call('export_diagram', { spec: orig.spec, to: 'svg', theme: 'dark', still: true });
  assert.match(svg.text, /data-mode="dark" data-still=""/);
  await assert.rejects(call('export_diagram', { id: 'tt-classic', to: 'visio' }), (e) => e instanceof ToolError);
});

test('export_diagram: a still frozen at a moment, and a storyboard', async () => {
  const fr = await call('export_diagram', { id: 'tt-az-fail', to: 'svg', at: 0.64, theme: 'light' });
  assert.match(fr.text, /class="awd awd-frame"[^>]*data-mode="light"/);
  assert.doesNotMatch(fr.text, /<animate/);
  const sb = await call('export_diagram', { id: 'aws-tt-az-fail', to: 'storyboard' });
  assert.deepEqual(sb.frames.map((f) => f.n), [1, 2, 3, 4]);
  assert.ok(sb.frames.every((f) => f.svg.startsWith('<svg ') && typeof f.at === 'number' && f.text));
  assert.equal(sb.text, undefined);
  await assert.rejects(call('export_diagram', { id: 'tt-az-fail', to: 'svg', at: 1.5 }), (e) => e instanceof ToolError && e.code === 'invalid_argument');
  await assert.rejects(call('export_diagram', { id: 'tt-az-fail', to: 'drawio', at: 0.5 }), (e) => e instanceof ToolError && /svg and png exports only/.test(e.message));
  await assert.rejects(call('export_diagram', { id: 'tt-az-fail', to: 'svg', scale: 2 }), (e) => e instanceof ToolError && e.code === 'invalid_argument');
});

test('export_diagram: a PNG of the poster moment (needs Chrome or Edge on the machine)', async (t) => {
  const out = await call('export_diagram', { id: 'tt-az-fail', to: 'png', scale: 1 }).catch((e) => e);
  if (out instanceof ToolError && out.code === 'unavailable') return t.skip('no Chrome or Edge');
  assert.deepEqual([out.to, out.at, out.width, out.height], ['png', 'poster', 960, 426]);
  assert.equal(Buffer.from(out.base64, 'base64').subarray(1, 4).toString('latin1'), 'PNG');
});
