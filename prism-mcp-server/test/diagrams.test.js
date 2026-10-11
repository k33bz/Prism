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

test('import_diagram: CloudFormation and Terraform, with the flows sidecar, params and the ledger', async () => {
  // YAML with short-form intrinsics, auto-detected; no sidecar means no animation
  const plain = await call('import_diagram', { content: fixture('cfn-webapp.yaml') });
  assert.equal(plain.report.from, 'cfn');
  assert.equal(plain.spec.timeline, undefined);
  assert.ok(plain.report.ledger.some((l) => l.kind === 'assumed' && /primary/.test(l.fact)), 'the RDS primary AZ is an assumption');
  assert.match(plain.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="awd"/);
  // the sidecar as an object and as JSON text animates the same flow
  const flows = JSON.parse(fixture('cfn-webapp.flows.json'));
  const a = await call('import_diagram', { content: fixture('cfn-webapp.yaml'), flows });
  const b = await call('import_diagram', { content: fixture('cfn-webapp.json'), from: 'cfn', flows: JSON.stringify(flows) });
  assert.equal(a.spec.timeline.length, 9);
  assert.deepEqual(a.spec.timeline, b.spec.timeline);
  assert.equal(a.report.story.flow, 'page-view');
  const lint = await call('lint_diagram', { spec: a.spec });
  assert.equal(lint.counts.error, 0, JSON.stringify(lint.findings.filter((f) => f.severity === 'error')));
  // params decide the Conditions
  const dev = await call('import_diagram', { content: fixture('cfn-conditions.yaml') });
  const prod = await call('import_diagram', { content: fixture('cfn-conditions.yaml'), params: { EnvType: 'prod', EnableCache: 'true' } });
  assert.ok(prod.spec.nodes.length > dev.spec.nodes.length);
  assert.ok(prod.spec.nodes.some((n) => /ElastiCache/.test(n.label)));
  // Terraform plan JSON; raw HCL is refused with what to run instead
  const tf = await call('import_diagram', { content: fixture('tf-webapp-plan.json'), story: 'guess' });
  assert.equal(tf.report.from, 'tf');
  assert.ok(tf.spec.timeline.length > 0);
  assert.ok(tf.report.issues.some((i) => i.code === 'story-guess'));
  await assert.rejects(call('import_diagram', { content: 'resource "aws_s3_bucket" "b" {\n  bucket = "x"\n}\n' }), (e) => e instanceof ToolError && /terraform show -json/.test(e.message));
  await assert.rejects(call('import_diagram', { content: fixture('cfn-webapp.yaml'), flows: '{nope' }), (e) => e instanceof ToolError && e.code === 'invalid_argument');
});

test('import_diagram: rules draws security group rules as tables, the admitting row lit; dual stack from the template', async () => {
  const flows = JSON.parse(fixture('cfn-webapp.flows.json'));
  const r = await call('import_diagram', { content: fixture('cfn-webapp.yaml'), flows, rules: true });
  assert.deepEqual(r.spec.tables.map((t) => t.title), ['AlbSg inbound rules', 'AppSg inbound rules', 'DbSg inbound rules']);
  assert.ok(r.spec.tables.every((t) => t.rows.some((row) => row.tone === 'ok' && row.t)));
  assert.deepEqual(r.report.rules.omitted, []);
  assert.match(r.svg, /<g class="awd-table" data-table="AppSg-in">/);
  const lint = await call('lint_diagram', { spec: r.spec });
  assert.equal(lint.counts.error, 0, JSON.stringify(lint.findings.filter((f) => f.severity === 'error')));
  // a list names the groups; the option beats the sidecar's rules; no option, no tables
  const db = await call('import_diagram', { content: fixture('cfn-webapp.yaml'), flows: { ...flows, rules: true }, rules: ['DbSg'] });
  assert.deepEqual(db.spec.tables.map((t) => t.id), ['DbSg-in']);
  assert.equal((await call('import_diagram', { content: fixture('cfn-webapp.yaml'), flows })).spec.tables, undefined);
  // Terraform: the dual-stack plan with its sidecar (rules: true inside), outbound tables for every group
  const tf = await call('import_diagram', { content: fixture('tf-webapp-dualstack-plan.json'), flows: JSON.parse(fixture('tf-webapp-dualstack-plan.flows.json')), rules: { outbound: true } });
  assert.equal(tf.report.from, 'tf');
  assert.deepEqual(tf.spec.tables.map((t) => t.id), ['AlbSg-in', 'AlbSg-out', 'AppSg-in', 'AppSg-out', 'DbSg-in', 'DbSg-out']);
  assert.ok(tf.spec.groups.some((g) => Array.isArray(g.note) && g.note[1] === '2001:db8:1200::/56'));
  assert.ok(tf.spec.timeline.some((e) => e.v6));
  assert.equal((await call('lint_diagram', { spec: tf.spec })).counts.error, 0);
  await assert.rejects(call('import_diagram', { content: fixture('cfn-webapp.yaml'), rules: 3 }), (e) => e instanceof ToolError && e.code === 'invalid_argument');
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

test('get_diagram_spec without an id lists the gallery by family with the kit primitives each uses', async () => {
  const all = await call('get_diagram_spec', {});
  assert.equal(all.total, 88);                       // 87 gallery diagrams plus the kit example
  const fam = (id) => all.families.find((f) => f.id === id);
  assert.deepEqual(fam('security').diagrams.map((d) => d.id), ['sg-chain', 'sg-nacl', 'sg-endpoints', 'sg-egress', 'sg-tgw']);
  assert.deepEqual(fam('ipv6').diagrams.map((d) => d.id), ['v6-dual-stack', 'v6-nat64', 'v6-dualstack-alb', 'v6-tgw']);
  const sg = fam('security').diagrams[0];
  assert.ok(sg.features.includes('tables') && sg.features.includes('poster'));
  const v6 = fam('ipv6').diagrams[0];
  for (const f of ['tables', 'flows', 'v6', 'note2']) assert.ok(v6.features.includes(f), f);
  const tables = await call('get_diagram_spec', { feature: 'tables' });
  assert.deepEqual(tables.families.map((f) => f.id).sort(), ['ipv6', 'security']);
  const only = await call('get_diagram_spec', { family: 'ipv6', feature: 'v6' });
  assert.equal(only.total, 4);
  await assert.rejects(call('get_diagram_spec', { family: 'nope' }), (e) => e instanceof ToolError && e.code === 'not_found' && e.data.families.includes('security'));
  await assert.rejects(call('get_diagram_spec', { feature: 'sparkles' }), (e) => e instanceof ToolError && e.code === 'invalid_argument');
});

test('get_diagram_spec: the new families, sg-chain with rules tables and v6-dual-stack with flows, IPv6 and two-line notes', async () => {
  const sg = await call('get_diagram_spec', { id: 'sg-chain' });
  assert.deepEqual([sg.catalogId, sg.family.id], ['aws-sg-chain', 'security']);
  assert.equal(sg.spec.tables.length, 3);
  assert.deepEqual(sg.spec.tables[0].cols, ['Type', 'Protocol', 'Port range', 'Source']);
  const v6 = await call('get_diagram_spec', { id: 'aws-v6-dual-stack' });
  assert.equal(v6.family.id, 'ipv6');
  assert.ok(v6.spec.flows.length >= 1);
  assert.ok(v6.spec.groups.some((g) => Array.isArray(g.note) && /^2001:db8:/.test(g.note[1])));
  for (const id of ['sg-chain', 'v6-dual-stack']) assert.equal((await call('lint_diagram', { id })).clean, true, id);
});

test('build_diagram with tables, flows, IPv6 packets and two-line notes returns the compiled story', async () => {
  const spec = {
    id: 'x-ds', name: 'Dual stack', desc: 'An instance reaches the internet over IPv4 and IPv6.', w: 480, h: 300, dur: 8,
    groups: [{ kind: 'vpc', x: 110, y: 8, w: 362, h: 160, note: ['10.0.0.0/16', '2001:db8:1::/56'] }],
    nodes: [{ id: 'ec2', icon: 'aws-res-ec2-instance', x: 380, y: 80, label: 'Amazon EC2' }, { id: 'igw', icon: 'aws-res-vpc-internet-gateway', x: 140, y: 80, label: 'Internet gateway', wrap: 10 }, { id: 'net', icon: 'aws-res-internet', x: 20, y: 80, label: 'Internet' }],
    wires: [{ id: 'a', from: 'ec2', to: 'igw' }, { id: 'b', from: 'igw', to: 'net' }],
    flows: [{ path: ['ec2', 'igw', 'net'], v6: true, text: ['The instance sends IPv6 traffic to the internet gateway.', 'The gateway forwards it to the internet.'] }],
    tables: [{ x: 190, y: 190, title: 'Route table', tone: 'networking', cols: ['Destination', 'Target'], rows: [['10.0.0.0/16', 'local'], { cells: ['::/0', 'igw'], on: 'a', v6: true, tone: 'ok' }] }],
  };
  const r = await call('build_diagram', { spec });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.lint.filter((f) => f.severity === 'error'), []);
  assert.deepEqual(r.story.timeline.map((e) => [e.wire, !!e.v6]), [['a', true], ['b', true]]);
  assert.deepEqual(r.story.steps.map((s) => s.n), [1, 2]);
  assert.match(r.svg, /2001:db8:1::\/56/);          // the second line of the frame note
  assert.match(r.svg, /Route table/);
  assert.equal((r.html.match(/class="pk pk-v6"/g) || []).length, 2);   // IPv6 packets are diamonds
  const plain = await call('build_diagram', { spec: probe() });
  assert.equal(plain.story, undefined, 'no flows: no story');
});

test('export_diagram: a security diagram to svg at its poster, storyboard, draw.io and Mermaid; an unknown target is invalid_argument', async () => {
  const poster = await call('export_diagram', { id: 'sg-chain', to: 'svg', at: 'poster', theme: 'light' });
  assert.match(poster.text, /class="awd awd-frame"/);
  assert.match(poster.text, /sg-alb inbound rules/);
  const sb = await call('export_diagram', { id: 'sg-chain', to: 'storyboard', theme: 'light' });
  assert.deepEqual(sb.frames.map((f) => f.n), [1, 2, 3, 4, 5]);
  const dio = await call('export_diagram', { id: 'aws-sg-chain', to: 'drawio' });
  assert.match(dio.text, /^<mxfile /);
  assert.match(dio.text, /prism_spec=/);           // the tables ride on the hidden Prism layer
  const mmd = await call('export_diagram', { id: 'sg-chain', to: 'mermaid' });
  assert.match(mmd.text, /flowchart /);
  await assert.rejects(call('export_diagram', { id: 'sg-chain', to: 'pdf' }), (e) => e instanceof ToolError && e.code === 'invalid_argument' && /drawio, mermaid, svg, png, storyboard/.test(e.message));
});
