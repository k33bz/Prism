// Tests for the text importers (Mermaid architecture-beta and flowchart, PlantUML-AWS, D2) and the Mermaid
// exporter. Run: node --test catalog/aws-kit/import/mermaid.test.mjs
// Mermaid's own parser is not a dependency here: the round trip goes through this module's parser (the
// exports were also checked once against Mermaid 11.16.1's mermaid.parse; see AWS_KIT.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSpec, lint, standalone } from '../awd.mjs';
import { validateDiagram } from '../spec.mjs';
import { fromMermaid, toMermaid, parseFlowchart, parseArchitecture, specGraph } from './mermaid.mjs';
import { fromPlantUml } from './plantuml.mjs';
import { fromD2 } from './d2.mjs';
import { makePack, PACK } from './make-pack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures');
const mine = fs.readdirSync(FIX).filter((f) => /^(mmd|puml|d2)-/.test(f));
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const importFile = (f, o = {}) => (f.endsWith('.puml') ? fromPlantUml : f.endsWith('.d2') ? fromD2 : fromMermaid)(read(f), { file: f, ...o });
const errors = (findings) => findings.filter((x) => x.severity === 'error');
const gallery = () => fs.readdirSync(path.join(HERE, '..', 'json')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(HERE, '..', 'json', f), 'utf8')).diagrams);

test('every fixture imports to a spec that passes checkSpec, the schema and lint', () => {
  assert.ok(mine.length >= 15, `fixtures: ${mine.length}`);
  for (const f of mine) {
    const { spec, report } = importFile(f);
    assert.doesNotThrow(() => checkSpec(spec), f);
    assert.deepEqual(validateDiagram(spec), [], `${f}: schema`);
    assert.deepEqual(errors(lint(spec)).map((x) => `${x.code} ${x.message}`), [], `${f}: lint`);
    assert.deepEqual(errors(report.issues), [], `${f}: issues`);
    assert.deepEqual(errors(report.lint), [], `${f}: report.lint`);
    assert.ok(report.tile.fits && ['normal', 'wide', 'full'].includes(report.tile.size), `${f}: tile`);
    assert.match(standalone(spec, { theme: 'light' }), /^<svg xmlns=/, f);
  }
});

test('report shape: dialect, issues, unmapped, tile, lint', () => {
  const { report } = importFile('mmd-static-site.mmd');
  assert.equal(report.dialect, 'mermaid-flowchart');
  for (const x of report.issues) { assert.ok(['error', 'warn', 'info'].includes(x.severity)); assert.equal(typeof x.code, 'string'); assert.equal(typeof x.message, 'string'); }
  assert.deepEqual(report.unmapped.map((u) => u.element), ['idp']);
  assert.ok(Array.isArray(report.lint));
  assert.deepEqual(Object.keys(report.tile).sort(), ['fits', 'h', 'size', 'w']);
});

test('animation channel 1: numbered edge titles and labels', () => {
  const { spec, report } = importFile('mmd-serverless-titled.mmd');
  assert.equal(report.story.channel, 'numbered');
  assert.deepEqual(spec.steps.map((s) => s.n), [1, 2, 3]);
  assert.deepEqual(spec.wires.filter((w) => w.label).map((w) => w.label).sort(), ['GetItem', 'HTTPS', 'invoke', 'logs']);
  // all numbered edges are <-->: the reply replays them backwards as responses
  const kinds = spec.timeline.map((t) => t.kind || 'pk');
  assert.deepEqual(kinds, ['pk', 'pk', 'pk', 'pk-2', 'pk-2', 'pk-2']);
  assert.ok(spec.timeline.slice(3).every((t) => t.reverse));
  // "1 HTTPS" (no colon) reads as a step when several labels use it
  const d2 = importFile('d2-serverless.d2');
  assert.equal(d2.report.story.channel, 'numbered');
  assert.deepEqual(d2.spec.steps.map((s) => s.n), [1, 2, 3]);
  // a lone number is a step; a port number is not
  const bare = fromMermaid('flowchart LR\n a[Amazon EC2] -->|1| b[Amazon S3]\n b -->|2| c[AWS Lambda]');
  assert.deepEqual(bare.spec.steps.map((s) => s.n), [1, 2]);
  const port = fromMermaid('flowchart LR\n a[Amazon EC2] -->|443| b[Amazon S3]');
  assert.equal(port.report.story.channel, 'bfs');
  assert.equal(port.spec.wires[0].label, '443');
});

test('animation channel 2: %% prism: flow with responses', () => {
  const { spec, report } = importFile('mmd-serverless-arch.mmd');
  assert.equal(report.story.channel, 'flow');
  // users>apigw>fn>ddb>fn>apigw>users: three requests, three responses on the same wires
  assert.equal(spec.timeline.length, 6);
  assert.deepEqual(spec.timeline.map((t) => t.kind || 'pk'), ['pk', 'pk', 'pk', 'pk-2', 'pk-2', 'pk-2']);
  assert.deepEqual(spec.steps.map((s) => s.n), [1, 2, 3]);
  assert.equal(spec.timeline[0].ring, 'apigw');
  assert.equal(spec.timeline[5].ring, 'users');
  // a flow hop through a junction keeps one badge
  const j = importFile('mmd-junction-fanout.mmd');
  assert.equal(j.report.story.channel, 'flow');
  assert.deepEqual(j.spec.steps.map((s) => s.n), [1, 2]);
  assert.equal(j.spec.timeline.length, 3);
});

test('animation channel 3: a breadth-first guess, reported as info', () => {
  const { spec, report } = importFile('mmd-serverless-noflow.mmd');
  assert.equal(report.story.channel, 'bfs');
  const guess = report.issues.find((x) => x.code === 'story-guess');
  assert.ok(guess && guess.severity === 'info' && /guess/.test(guess.message));
  assert.equal(spec.timeline[0].ring, 'apigw');
  assert.deepEqual(spec.steps.map((s) => s.n), [1, 2, 3]);
});

test('D2 steps are the story; step texts, name and dur directives', () => {
  const d2 = importFile('d2-steps.d2');
  assert.equal(d2.report.story.channel, 'd2-steps');
  assert.deepEqual(d2.spec.steps.filter((s) => s.text).map((s) => s.text), ['Users upload an image to the S3 bucket.', 'The S3 event invokes the resize function.', 'The function writes thumbnails and publishes a notice.']);
  assert.equal(d2.spec.name, 'Image upload pipeline');
  const m = importFile('mmd-static-site.mmd');
  assert.equal(m.spec.name, 'Static website with an API');
  assert.equal(m.spec.dur, 9);
  assert.match(m.spec.steps.find((s) => s.n === 2).text, /^On a cache miss/);
  assert.equal(importFile('mmd-static-site.mmd', { story: 'none' }).spec.timeline, undefined);
});

test('grid conflicts name the two edges; collisions and align hints', () => {
  const { report, spec } = importFile('mmd-grid-conflict.mmd');
  const c = report.issues.find((x) => x.code === 'grid-conflict');
  assert.ok(c && c.severity === 'warn');
  assert.match(c.message, /edge "cache:B --> T:rds" conflicts with edge "app:B --> T:cache"/);
  // align row app s3: s3 sits in app's row, to its right
  const n = (id) => spec.nodes.find((x) => x.id === id);
  assert.equal(n('s3').y, n('app').y);
  assert.ok(n('s3').x > n('app').x);
  const col = fromMermaid('architecture-beta\n service a(aws:lambda)[A]\n service b(aws:dynamodb)[B]\n service c(aws:simple-storage-service)[C]\n a:R --> L:b\n a:R --> L:c\n');
  const hit = col.report.issues.find((x) => x.code === 'grid-collision');
  assert.ok(hit && /edge "a:R --> L:[bc]" and edge "a:R --> L:[bc]" both put a node in one cell/.test(hit.message), hit && hit.message);
  assert.deepEqual(errors(col.report.lint), []);
});

test('junctions route through one point; a {group} end sits outside the group', () => {
  const { spec } = importFile('mmd-junction-fanout.mmd');
  const vpc = spec.groups.find((g) => g.id === 'vpc'), logs = spec.nodes.find((n) => n.id === 'logs');
  assert.ok(logs.y > vpc.y + vpc.h, 'logs below the VPC frame');
  const pts = (d) => [...d.matchAll(/([MHV])([-\d.]+)(?:,([-\d.]+))?/g)];
  const jw = spec.wires.filter((w) => !w.from || !w.to);
  assert.equal(jw.length, 3);   // alb->j, j->web1 and j->web2 end at the junction (the {group} wire keeps from: alb)
  const end = (d) => { let x = 0, y = 0; for (const [, c, a, b] of pts(d)) { if (c === 'M') { x = +a; y = +b; } else if (c === 'H') x = +a; else y = +a; } return `${x},${y}`; };
  const start = (d) => { const m = /M([-\d.]+),([-\d.]+)/.exec(d); return `${+m[1]},${+m[2]}`; };
  const into = spec.wires.find((w) => w.from === 'alb' && !w.to);
  assert.equal(into.arrow, false);
  assert.ok(spec.wires.filter((w) => w.to === 'web1' || w.to === 'web2').every((w) => start(w.d) === end(into.d)));
});

test('layered layout keeps sibling groups in declaration order and the request path straight', () => {
  const { spec } = importFile('mmd-threetier-flow.mmd');
  const g = (id) => spec.groups.find((x) => x.id === id);
  assert.ok(g('aza').x < g('azb').x, 'AZ a left of AZ b in a TD flowchart');
  const s = importFile('mmd-serverless-flow.mmd').spec;
  const y = (id) => s.nodes.find((n) => n.id === id).y;
  assert.equal(y('users'), y('apigw')); assert.equal(y('apigw'), y('fn')); assert.equal(y('fn'), y('ddb'));
});

test('layered layout: a lone frame centres over its fork, feeds run straight, next-layer hops draw as a bus', () => {
  const { spec } = importFile('mmd-readme-sketch.mmd');
  const n = (id) => spec.nodes.find((x) => x.id === id), g = (id) => spec.groups.find((x) => x.id === id);
  const mid = (n('EC2a').x + n('EC2b').x) / 2 + 20;
  // the ALB's subnet moved as a block: the ALB is centred over both servers, and its frame is sized from its
  // content (wider on the left only by the clearance for the wire entering through its title)
  assert.equal(n('ALB').x + 20, mid);
  assert.ok(g('Public').w < g('Private').w && g('Public').x > g('Private').x && g('Public').x + g('Public').w < g('Private').x + g('Private').w);
  assert.equal(n('CF').x, n('ALB').x); assert.equal(n('User').x, n('CF').x);
  // both branches of the fork come down into the top of their server (a bus), the merge into RDS from above
  for (const id of ['EC2a', 'EC2b', 'RDS']) for (const w of spec.wires.filter((x) => x.to === id)) assert.equal(Number(w.d.match(/V([\d.]+)$/)[1]), n(id).y - 4, `${w.id} enters ${id} from the top`);
  // a dashed and a solid wire at one port are spread apart
  const d = importFile('d2-steps.d2').spec;
  const startY = (w) => Number(w.d.match(/^M[\d.]+,([\d.]+)/)[1]);
  const [solid, dashed] = ['thumbs', 'sns'].map((t) => d.wires.find((w) => w.to === t));
  assert.notEqual(startY(solid), startY(dashed));
  assert.match(solid.d, /^M[\d.]+,([\d.]+) H[\d.]+$/, 'the solid wire stays straight');
});

test('free-text names: the whole name, else its head noun when that matches exactly', () => {
  const { spec, report } = importFile('mmd-event-driven.mmd');
  const icon = (id) => spec.nodes.find((x) => x.id === id).icon;
  for (const id of ['intake', 'pay', 'inv', 'mailer']) assert.equal(icon(id), 'aws-svc-lambda', id);
  assert.equal(icon('sfn'), 'aws-svc-step-functions');
  assert.deepEqual(report.unmapped.map((u) => u.element), ['web']);
  const r = fromMermaid('flowchart LR\n a[Order queue] --> b[Image bucket] --> c[Orders table] --> d[Auth service]');
  const kinds = r.spec.nodes.map((x) => x.icon || x.kind);
  assert.deepEqual(kinds, ['aws-svc-simple-queue-service', 'aws-res-simple-storage-service-bucket', 'box', 'box']);
  assert.ok(r.report.issues.some((x) => x.code === 'icon' && /"Order queue" matched by its last word "queue"/.test(x.message)));
});

test('group kinds: title, id, icon; directives override', () => {
  const kinds = (spec) => Object.fromEntries(spec.groups.map((g) => [g.id, g.kind]));
  assert.deepEqual(kinds(importFile('mmd-threetier-arch.mmd').spec), { cloud: 'cloud', region: 'region', vpc: 'vpc', aza: 'az', azb: 'az', puba: 'pub', appa: 'priv', dba: 'priv', pubb: 'pub', appb: 'priv', dbb: 'priv' });
  assert.deepEqual(kinds(importFile('mmd-hybrid-td.mmd').spec), { onprem: 'dc', cloud: 'cloud', tgwz: 'gen', vpcA: 'vpc', vpcB: 'vpc' });
  assert.deepEqual(kinds(importFile('puml-three-tier.puml').spec), { cloud: 'cloud', vpc: 'vpc', pub: 'pub', app: 'priv', data: 'priv' });
  const r = fromMermaid('architecture-beta\n group k(aws:elastic-kubernetes-service)[Workloads]\n service p(aws:ec2-instance)[Pod host] in k\n');
  assert.deepEqual(r.spec.groups.map((g) => [g.kind, g.icon]), [['gen', 'aws-svc-elastic-kubernetes-service']]);
});

test('icons: explicit icon, then the label; unresolved nodes become boxes listed in unmapped', () => {
  const r = fromMermaid('flowchart LR\n a@{ icon: "aws:svc-lambda", label: "Thumbnailer" } --> b[Amazon S3]\n b --> c[Stripe API]\n c --> d([Partner portal])');
  const n = (id) => r.spec.nodes.find((x) => x.id === id);
  assert.equal(n('a').icon, 'aws-svc-lambda');
  assert.equal(n('b').icon, 'aws-svc-simple-storage-service');
  assert.equal(n('c').kind, 'box');
  assert.equal(n('d').kind, 'pill');
  assert.deepEqual(r.report.unmapped.map((u) => u.element), ['c', 'd']);
  // Mermaid's generic built-ins defer to the title
  const b = importFile('mmd-builtin-icons.mmd').spec;
  assert.equal(b.nodes.find((x) => x.id === 'db').icon, 'aws-svc-rds');
  assert.equal(b.nodes.find((x) => x.id === 'net').icon, 'aws-res-users');
});

test('flowchart parser: link types, labels, chains, membership, shapes', () => {
  const ir = parseFlowchart(`flowchart LR
    a --> b
    a --- c
    a -.-> d
    a ==> e
    a <--> f
    a --o g
    a --x h
    a -- text --> i
    a -->|pipe| j & k
    l e1@--> m --> n
    subgraph S["Sub"]
      b
      subgraph T[Inner]
        m
      end
    end
    m -.-> S
    p[(Database)] --> q{{Hex}}`);
  const e = (a, b) => ir.edges.find((x) => x.a === a && x.b === b);
  assert.deepEqual([e('a', 'b').bHead, e('a', 'c').bHead, e('a', 'd').dashed, e('a', 'f').aHead, e('a', 'g').bHead, e('a', 'h').bHead], [true, false, true, true, true, true]);
  assert.equal(e('a', 'i').label, 'text');
  assert.equal(e('a', 'j').label, 'pipe'); assert.equal(e('a', 'k').label, 'pipe');
  assert.equal(e('l', 'm').id, 'e1'); assert.ok(e('m', 'n'));
  const parent = (id) => ir.nodes.find((x) => x.id === id).parent;
  assert.equal(parent('b'), 'S'); assert.equal(parent('m'), 'T'); assert.equal(parent('a'), null);
  assert.ok(!ir.nodes.some((x) => x.id === 'S'), 'a link to a subgraph id ends on the subgraph');
  assert.equal(ir.nodes.find((x) => x.id === 'p').shapeHint, 'cylinder');
});

test('architecture-beta parser: titles, {group}, junctions, quoting trap', () => {
  const ir = parseArchitecture(`architecture-beta
    group r(aws:region)[us-east-1]
    group v(aws:virtual-private-cloud)["VPC 10.0.0.0/16"] in r
    service fn(aws:lambda)[Fn] in v
    junction j in v
    service q(aws:sqs)[Queue]
    fn{group}:R -["1: send"]-> L:q
    fn:B -- T:j
    align column fn j`);
  assert.equal(ir.groups[1].label, 'VPC 10.0.0.0/16');
  assert.ok(ir.nodes.find((n) => n.id === 'j').junction);
  const e = ir.edges[0];
  assert.deepEqual([e.aGroup, e.sa, e.sb, e.bHead, e.label], [true, 'R', 'L', true, '1: send']);
  assert.ok(ir.issues.some((x) => x.code === 'mermaid-title' && /us-east-1/.test(x.message)), 'unquoted [us-east-1] is flagged');
  assert.deepEqual(ir.aligns, [{ axis: 'column', ids: ['fn', 'j'], src: 'align column fn j' }]);
});

test('flowchart export of every gallery diagram parses back with the same node and edge counts', () => {
  const all = gallery();
  assert.ok(all.length >= 79);
  for (const d of all) {
    const text = toMermaid(d);
    assert.match(text, /^flowchart LR\n/);
    const { spec } = fromMermaid(text, { id: d.id });
    assert.equal(spec.nodes.length, d.nodes.length, `${d.id}: nodes`);
    assert.equal(spec.wires.length, (d.wires || []).length, `${d.id}: wires`);
    assert.doesNotThrow(() => checkSpec(spec), d.id);
    assert.deepEqual(validateDiagram(spec), [], `${d.id}: schema`);
  }
});

test('flowchart export carries icons, subgraphs, kinds, step numbers and step texts', () => {
  const d = gallery().find((x) => x.id === 'sl-api');
  const text = toMermaid(d);
  assert.match(text, /apigw@\{ icon: "aws:svc-api-gateway", form: "square", label: "Amazon API Gateway<br>REST API"/);
  assert.match(text, /subgraph g1_cloud\["AWS Cloud"\]/);
  assert.match(text, /%% prism: kind g1_cloud=cloud g2_region=region/);
  assert.match(text, /users <-->\|"1:"\| apigw/);
  assert.match(text, /%% prism: step 1: Users send requests/);
  const back = fromMermaid(text).spec;
  assert.deepEqual(back.groups.map((g) => g.kind), ['cloud', 'region']);
  const icons = (s) => Object.fromEntries(s.nodes.map((n) => [n.id, n.icon]));
  assert.deepEqual(icons(back), icons(d));
  assert.deepEqual(back.steps.map((s) => s.n), [1, 2, 3]);
  assert.equal(back.steps[0].text, d.steps[0].text);
});

test('architecture-beta export only for a consistent grid, else a reason', () => {
  const all = gallery();
  const auth = all.find((x) => x.id === 'sl-auth');
  const text = toMermaid(auth, { dialect: 'architecture-beta' });
  assert.match(text, /^architecture-beta\n/);
  const back = fromMermaid(text).spec;
  assert.equal(back.nodes.length, auth.nodes.length);
  assert.equal(back.wires.length, auth.wires.length);
  assert.deepEqual(errors(lint(back)), []);
  assert.throws(() => toMermaid(all.find((x) => x.id === 'tt-classic'), { dialect: 'architecture-beta' }), /consistent grid.*Export a flowchart instead/s);
  assert.throws(() => toMermaid(all.find((x) => x.id === 'sl-s3-events'), { dialect: 'architecture-beta' }), /port fn:R carries 2 edges/);
});

test('specGraph: wire ends on nodes, group borders and shared points', () => {
  const g = specGraph(gallery().find((x) => x.id === 'ep-policies'));
  const kinds = g.ends.map((e) => [e.a, e.b].map((x) => (x.node ? 'n' : x.group ? 'g' : 'j')).join(''));
  assert.ok(kinds.includes('nj') && kinds.includes('jn'), kinds.join(' '));
});

test('icon pack: svc-/res- keys, no collisions, the committed file is current', () => {
  const pack = makePack();
  assert.equal(pack.prefix, 'aws');
  assert.ok(pack.icons['svc-lambda'] && pack.icons['res-users'] && pack.icons['res-users-dark'] && pack.icons['grp-region']);
  // the names that collide when ids are flattened without the prefix exist as both kinds
  for (const k of ['cloud9', 'ec2-auto-scaling', 'management-console', 'shield']) assert.ok(pack.icons[`svc-${k}`] && pack.icons[`res-${k}`], k);
  const file = fs.readFileSync(PACK, 'utf8').replace(/\r\n/g, '\n');
  assert.ok(file.length < 2.1e6, `pack is ${file.length} bytes`);
  assert.equal(file, JSON.stringify(pack) + '\n', 'regenerate with: node catalog/aws-kit/import/make-pack.mjs');
});

test('the CLI prints a report and exports Mermaid', async () => {
  const { spawnSync } = await import('node:child_process');
  const cli = path.join(HERE, 'mermaid.mjs');
  const r = spawnSync(process.execPath, [cli, path.join(FIX, 'mmd-serverless-titled.mmd'), '--id', 'sl-test'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /-> sl-test \(normal tile 480x\d+\)/);
  assert.match(r.stdout, /story: numbered/);
  const x = spawnSync(process.execPath, [cli, '--export', path.join(HERE, '..', 'json', 'serverless.json'), 'sl-auth', '--dialect', 'architecture-beta'], { encoding: 'utf8' });
  assert.equal(x.status, 0, x.stderr);
  assert.match(x.stdout, /^architecture-beta/);
  const bad = spawnSync(process.execPath, [cli, '--export', path.join(HERE, '..', 'json', 'three-tier.json'), 'tt-classic', '--dialect', 'architecture-beta'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /consistent grid/);
});
