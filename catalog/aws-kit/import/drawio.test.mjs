// Tests for the draw.io importer and exporter. Run: node --test catalog/aws-kit/import/drawio.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fromDrawio, toDrawio, exportDrawio, loadDrawio, htmlText } from './drawio.mjs';
import { checkSpec, lint } from '../awd.mjs';
import { compileFlows } from '../story.mjs';
import { canonicalDiagram, validateDiagram, validateFamily } from '../spec.mjs';
import { png, SMALL } from './fixtures/make-fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIX, f));
const errors = (r) => r.report.lint.filter((f) => f.severity === 'error');
const codes = (r) => r.report.issues.map((i) => i.code);
const count = (s, k) => (s[k] || []).length;
const model = (cells) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;

// every fixture imports to a spec that passes checkSpec, the schema and lint with no error
const FIXTURES = ['three-tier.drawio', 'three-tier.compressed.drawio', 'order-intake.drawio', 'embed.drawio.svg', 'embed.drawio.png'];
for (const f of FIXTURES) {
  test(`fixture ${f}: checkSpec, schema and lint clean`, () => {
    const r = fromDrawio(read(f));
    checkSpec(r.spec);
    assert.deepEqual(validateDiagram(r.spec), [], f);
    assert.deepEqual(errors(r), [], `${f}: ${errors(r).map((x) => x.message).join('; ')}`);
    assert.deepEqual(lint(r.spec).filter((x) => x.severity === 'error'), []);
    assert.ok(['normal', 'wide', 'full'].includes(r.report.tile));
    assert.ok(r.report.scale > 0);
    assert.ok(!r.report.issues.some((i) => i.severity === 'error'), f);
  });
}

test('plain and compressed .drawio give the same spec; a bare mxGraphModel too', () => {
  const plain = fromDrawio(read('three-tier.drawio').toString('utf8'));
  const packed = fromDrawio(read('three-tier.compressed.drawio'));
  assert.deepEqual(packed.spec, plain.spec);
  assert.equal(packed.report.pages[0].compressed, true);
  const bare = read('three-tier.drawio').toString('utf8').match(/<mxGraphModel[\s\S]*<\/mxGraphModel>/)[0];
  const r = fromDrawio(bare, { name: 'Three-tier web application on AWS', id: plain.spec.id });
  assert.equal(r.report.format, 'mxGraphModel');
  assert.deepEqual({ ...r.spec, desc: '' }, { ...plain.spec, desc: '' });   // a bare model has no page name for the description
});

test('.drawio.svg and .drawio.png (zTXt and tEXt chunks) carry the same diagram', () => {
  const svg = fromDrawio(read('embed.drawio.svg'));
  const z = fromDrawio(read('embed.drawio.png'));
  const t = fromDrawio(png(SMALL, 'tEXt'));
  assert.equal(svg.report.format, 'drawio.svg');
  assert.equal(z.report.format, 'drawio.png');
  assert.deepEqual(z.spec, svg.spec);
  assert.deepEqual(t.spec, svg.spec);
  assert.deepEqual(svg.spec.nodes.map((n) => n.icon), ['aws-res-client', 'aws-svc-cloudfront', 'aws-res-simple-storage-service-bucket']);
  assert.equal(svg.spec.groups[0].kind, 'cloud');
});

test('three-tier: layers, object labels, relative geometry, edge label children, title and legend', () => {
  const { spec, report } = fromDrawio(read('three-tier.drawio'));
  assert.equal(spec.name, 'Three-tier web application on AWS');
  assert.ok(!JSON.stringify(spec).includes('OLD DESIGN'), 'the hidden layer is dropped');
  assert.ok(codes({ report }).includes('hidden-layer'));
  const cf = spec.nodes.find((n) => n.id === 'cf');
  assert.equal(cf.label, 'Amazon CloudFront');   // from the <object> wrapper
  assert.equal(cf.icon, 'aws-svc-cloudfront');
  assert.equal(spec.nodes.find((n) => n.id === 'eca').icon, 'aws-res-ec2-instance');   // bare shape: resource
  assert.equal(spec.nodes.find((n) => n.id === 'ecb').icon, 'aws-svc-ec2');            // resIcon tile: service
  assert.equal(spec.nodes.find((n) => n.id === 'rdss').icon, 'aws-res-aurora-rds-instance-aternate');
  assert.deepEqual(spec.groups.map((g) => g.kind).sort(), ['asg', 'az', 'az', 'cloud', 'priv', 'priv', 'priv', 'priv', 'pub', 'pub', 'region', 'vpc']);
  assert.equal(spec.groups.filter((g) => g.note).length, 2);   // the CIDR texts became frame notes
  assert.equal(spec.wires.find((w) => w.id === 'e11').label, 'outbound only');   // an edgeLabel child
  assert.ok(spec.wires.find((w) => w.id === 'e12').hot);
  assert.ok(spec.wires.find((w) => w.id === 'e10').both && spec.wires.find((w) => w.id === 'e10').dashed);
  // children of nested containers sit inside their frames
  const vpc = spec.groups.find((g) => g.kind === 'vpc'), alb = spec.nodes.find((n) => n.id === 'alb');
  assert.ok(alb.x > vpc.x && alb.y > vpc.y + 22 && alb.x + 40 < vpc.x + vpc.w);
  // the legend's numbered lines became the step texts of the badges; the badges drive the story
  assert.deepEqual(spec.steps.map((s) => s.n), [1, 2, 3, 4, 5, 6]);
  assert.equal(spec.steps[0].text, 'Resolve DNS (Route 53)');
  assert.equal(spec.timeline.length, 6);
  assert.ok(spec.timeline.every((e, i) => i === 0 || e.t[0] > spec.timeline[i - 1].t[1]));
  assert.ok(codes({ report }).includes('story-badges'));
});

test('order-intake: colored container, boxes, a pill, a floating edge, a description column', () => {
  const { spec, report } = fromDrawio(read('order-intake.drawio'));
  assert.equal(spec.name, 'Order intake');
  const svc = spec.groups.find((g) => g.label === 'Order service');
  assert.deepEqual([svc.kind, svc.tone, svc.fill, svc.dashed], ['gen', 'compute', true, false]);
  const boxes = spec.nodes.filter((n) => n.kind);
  assert.deepEqual(boxes.map((n) => [n.kind, n.label]).sort(), [['box', 'Idempotency key per order'], ['box', 'Payment provider (SaaS)'], ['pill', 'Partner feed']]);
  const fn = spec.nodes.find((n) => n.label === 'Order handler'), gw = spec.nodes.find((n) => n.icon === 'aws-svc-api-gateway');
  for (const n of [fn, gw]) assert.ok(n.x > svc.x && n.x + 40 < svc.x + svc.w && n.y > svc.y + 22 && n.y + 40 < svc.y + svc.h, n.id);
  const free = spec.wires.find((w) => w.id === 'e5');
  assert.ok(free.d && /^M[\d.]+,[\d.]+( [HV][\d.]+)+$/.test(free.d), free.d);   // only M, H, V
  assert.equal(spec.wires.find((w) => w.id === 'e3').label, 'PutItem');
  assert.equal(spec.wires.find((w) => w.id === 'e4').dashed, true);
  assert.deepEqual(spec.steps.map((s) => [s.n, s.at]), [[1, 'e1'], [2, 'e2'], [3, 'e3']]);
  assert.match(spec.steps[2].text, /writes the order to DynamoDB once/);
  assert.equal(report.issues.filter((i) => i.code === 'step-legend').length, 3);
  assert.deepEqual(spec.notes.map((n) => n.text), ['Orders are written once']);
});

test('story: auto from badges, a BFS from the users without them, none on request', () => {
  const bfs = fromDrawio(read('embed.drawio.svg'));
  assert.deepEqual(bfs.spec.timeline.map((e) => e.wire), ['a', 'b']);
  assert.ok(codes(bfs).includes('story-bfs'));
  assert.ok(bfs.spec.steps.every((s) => !s.text));   // no texts invented
  const none = fromDrawio(read('three-tier.drawio'), { story: 'none' });
  assert.equal(count(none.spec, 'timeline'), 0);
  assert.equal(none.spec.steps.length, 6);   // the badges stay
});

test('shapes: guarded label signal, refinement, EC2 instance types, unmapped shapes, images', () => {
  const T = (id, value, style, x) => `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="40" width="48" height="48" as="geometry"/></mxCell>`;
  const r = fromDrawio(model([
    T('logs', 'Amazon CloudWatch Logs', 'shape=mxgraph.aws4.cloudwatch;', 0),
    T('ad', 'Active Directory', 'shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cloud_directory;', 200),
    T('c5', 'Batch worker', 'shape=mxgraph.aws4.c5_instance;', 400),
    T('nope', 'Mystery', 'shape=mxgraph.aws4.not_a_real_shape_name;', 600),
    T('img', 'Corporate logo', 'shape=image;image=img/lib/clip_art/logo.svg;', 800),
    T('img2', '', 'shape=image;image=img/lib/clip_art/other.svg;', 1000),
  ].join('')));
  const by = Object.fromEntries(r.spec.nodes.map((n) => [n.id, n]));
  assert.equal(by.logs.icon, 'aws-res-cloudwatch-logs');
  assert.equal(by.ad.icon, 'aws-svc-cloud-directory');   // the shape wins; the disagreement is reported
  assert.ok(r.report.issues.some((i) => i.code === 'label-shape' && i.element === 'ad'));
  assert.ok(r.report.issues.some((i) => i.code === 'label-refined' && i.element === 'logs'));
  assert.deepEqual([by.c5.icon, by.c5.sub], ['aws-res-ec2-instance', 'c5']);
  assert.equal(by.nope.kind, 'box');
  assert.deepEqual(r.report.unmapped.map((u) => u.element), ['nope']);
  assert.ok(r.report.issues.some((i) => i.code === 'icon-unmapped' && i.severity === 'warn'));
  assert.deepEqual([by.img.kind, by.img.label], ['box', 'Corporate logo']);
  assert.ok(!by.img2);
  assert.ok(r.report.issues.some((i) => i.code === 'image' && i.element === 'img'));
});

test('loader: def() style compression, HTML labels, UserObject placeholders, errors', () => {
  const xml = `<mxfile><diagram name="p">${model(`<UserObject label="%name% API" placeholders="1" name="Orders" id="u"><mxCell style="shape=def(0);resIcon=mxgraph.aws4.api_gateway;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="48" height="48" as="geometry"/></mxCell></UserObject>`)}</diagram><defs><def data="mxgraph.aws4.resourceIcon"/></defs></mxfile>`;
  const r = fromDrawio(xml);
  assert.deepEqual([r.spec.nodes[0].icon, r.spec.nodes[0].label], ['aws-svc-api-gateway', 'Orders API']);
  assert.equal(htmlText('Amazon<br>Cognito&nbsp;pool<div>two</div>'), 'Amazon\nCognito pool\ntwo');
  assert.throws(() => fromDrawio('<html><body>hi</body></html>'), /not a draw.io diagram/);
  assert.throws(() => fromDrawio(png('', 'tEXt').subarray(0, 33)), /no draw.io diagram/);
  assert.throws(() => fromDrawio(read('three-tier.drawio'), { page: 3 }), /no page/);
  assert.equal(loadDrawio(read('three-tier.compressed.drawio')).pages.length, 1);
});

test('width picks the tile; the canvas respects it', () => {
  const r = fromDrawio(read('embed.drawio.svg'), { width: 960 });
  assert.equal(r.report.tile, 'wide');
  assert.equal(r.spec.w, 960);
  assert.equal(r.spec.wide, true);
});

test('export: official draw.io AWS styles, prism properties, hidden prism layer', () => {
  const fam = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'json', 'serverless.json'), 'utf8'));
  const d = fam.diagrams.find((x) => x.id === 'sl-api');
  const xml = toDrawio(d);
  assert.match(xml, /^<mxfile host="prism"/);
  assert.match(xml, /shape=mxgraph\.aws4\.resourceIcon;resIcon=mxgraph\.aws4\.lambda;/);
  assert.match(xml, /<mxCell id="prism-layer" value="[^"]*" parent="0" visible="0"\/>/);
  assert.match(xml, /<object id="prism-spec" label="" prism_spec="/);
  const icons = [...xml.matchAll(/<object id="n-[^"]*"[^>]*>/g)].map((m) => m[0]);
  assert.equal(icons.length, d.nodes.length);
  for (const o of icons) if (!/prism_shape=/.test(o)) assert.match(o, /prism_icon="aws-(svc|res)-[^"]+"/);
  // the step text rides on the badge as its tooltip
  assert.match(xml, /prism_kind="step" tooltip="[^"]+"/);
  // an icon without a draw.io stencil is an inline image that still names its Prism icon
  const tg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'json', 'transit.json'), 'utf8')).diagrams.find((x) => x.nodes.some((n) => n.icon === 'aws-res-direct-connect-gateway'));
  const ex = exportDrawio(tg);
  assert.ok(ex.counts.images >= 1);
  assert.match(ex.xml, /prism_icon="aws-res-direct-connect-gateway"[^>]*><mxCell style="shape=image;/);
  const back = fromDrawio(ex.xml, { restore: false });
  assert.ok(back.spec.nodes.some((n) => n.icon === 'aws-res-direct-connect-gateway'));
});

test('edited export: the drawing is re-imported, the timeline and effects restored where they still apply', () => {
  const fam = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'json', 'regions.json'), 'utf8'));
  const d = fam.diagrams.find((x) => (x.effects || []).length && (x.timeline || []).length);
  const xml = toDrawio(d).replace(/(<object id="n-[^"]*"[^>]*><mxCell [^>]*><mxGeometry x=")([\d.]+)/, (m, a, x) => a + (+x + 30));
  const r = fromDrawio(xml);
  assert.ok(codes(r).includes('prism-merged'));
  assert.ok(r.spec.timeline.length > 0 && r.spec.effects.length > 0);
  assert.deepEqual(validateDiagram(r.spec), []);
  checkSpec(r.spec);
});

// the gallery round trip: spec -> draw.io -> spec, with the hidden prism layer (exact) and without it
// (the drawing alone: the same node, group, wire and step counts, and lint clean)
const GALLERY = fs.readdirSync(path.join(HERE, '..', 'json')).filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(HERE, '..', 'json', f), 'utf8')).diagrams);
test(`gallery round trip with the prism layer: ${GALLERY.length} diagrams restored exactly`, () => {
  for (const d of GALLERY) assert.deepEqual(fromDrawio(toDrawio(d)).spec, canonicalDiagram(d), d.id);
});
test('gallery round trip from the drawing alone: same counts, lint clean', () => {
  const exceptions = [];
  for (const d of GALLERY) {
    const r = fromDrawio(toDrawio(d), { restore: false });
    // a diagram authored with flows draws the steps they compile to
    const c = compileFlows(d);
    const diff = ['nodes', 'groups', 'wires', 'steps'].filter((k) => count(r.spec, k) !== count(c, k)).map((k) => `${k} ${count(c, k)} -> ${count(r.spec, k)}`);
    if (diff.length) exceptions.push(`${d.id}: ${diff.join(', ')}`);
    if (errors(r).length) exceptions.push(`${d.id}: ${errors(r).map((x) => x.message).join('; ')}`);
    assert.deepEqual(validateDiagram(r.spec), [], d.id);
  }
  assert.deepEqual(exceptions, []);
});

test('CLI: import with --out and --svg, and --export', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-'));
  try {
    const cli = path.join(HERE, 'drawio.mjs');
    const out = path.join(tmp, 'spec.json'), svg = path.join(tmp, 'x.svg'), dio = path.join(tmp, 'x.drawio');
    const a = spawnSync(process.execPath, [cli, path.join(FIX, 'three-tier.drawio'), '--id', 'dr-tt', '--out', out, '--svg', svg, '--theme', 'dark'], { encoding: 'utf8' });
    assert.equal(a.status, 0, a.stderr);
    assert.match(a.stdout, /dr-tt: "Three-tier web application on AWS", full tile/);
    const fam = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.deepEqual(validateFamily(fam), []);
    assert.match(fs.readFileSync(svg, 'utf8'), /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" class="awd"[^>]* data-mode="dark"/);
    const b = spawnSync(process.execPath, [cli, '--export', path.join(HERE, '..', 'json', 'serverless.json'), 'sl-api', '--out', dio], { encoding: 'utf8' });
    assert.equal(b.status, 0, b.stderr);
    assert.match(b.stdout, /sl-api: \d+ groups, \d+ nodes/);
    assert.deepEqual(fromDrawio(fs.readFileSync(dio)).spec, canonicalDiagram(JSON.parse(fs.readFileSync(path.join(HERE, '..', 'json', 'serverless.json'), 'utf8')).diagrams.find((x) => x.id === 'sl-api')));
    const c = spawnSync(process.execPath, [cli, path.join(FIX, 'make-fixtures.mjs')], { encoding: 'utf8' });
    assert.equal(c.status, 1);
    assert.match(c.stderr, /not a draw.io diagram/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

