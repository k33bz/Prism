// Tests for the AWS kit generator: input checks, markup safety and the gallery's own specs.
// Run: node --test catalog/aws-kit/awd.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkSpec, diagram, section, standalone, validate } from './awd.mjs';
import { SCHEMA, canonical, canonicalDiagram, toJson, validateDiagram, validateFamily } from './spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAMILIES = ['serverless', 'three-tier', 'directory', 'databases', 'regions', 'vpc', 'transit', 'endpoints', 'dns'];
const load = async (f) => (await import(pathToFileURL(path.join(HERE, 'specs', f + '.mjs')).href)).default;
const readLf = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
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

// ---- JSON specs ----
test('every gallery spec matches spec.schema.json, and json/ holds its canonical export', async () => {
  for (const f of [...FAMILIES, 'example']) {
    const { family } = canonical(await load(f));
    assert.deepEqual(validateFamily(family), [], f);
    assert.equal(readLf(path.join(HERE, 'json', f + '.json')), toJson(family) + '\n',
      `json/${f}.json is stale: node catalog/aws-kit/awd.mjs export-json catalog/aws-kit/specs/${f}.mjs`);
  }
});

test('building from the JSON spec is byte-identical to building from the .mjs', async () => {
  for (const f of FAMILIES) {
    const fam = JSON.parse(fs.readFileSync(path.join(HERE, 'json', f + '.json'), 'utf8'));
    assert.equal(section(fam), section(await load(f)), f);
  }
});

test('the schema reports typos, wrong types and missing alternatives by path', () => {
  const d = { id: 'x-probe', name: 'n', nodes: [{ id: 'a', icon: 'aws-svc-lambda', x: 0, y: '0', lable: 'L' }], wires: [{ id: 'w', from: 'a' }], timeline: [{ wire: 'w', t: [0, 0.5] }] };
  const msgs = validateDiagram(d).map((e) => `${e.path}: ${e.message}`);
  assert.ok(msgs.includes('nodes[0].y: expected number, got string'), msgs.join('\n'));
  assert.ok(msgs.includes('nodes[0].lable: unknown property (did you mean label?)'), msgs.join('\n'));
  assert.ok(msgs.includes('wires[0]: needs d or from + to'), msgs.join('\n'));
  assert.ok(msgs.includes('timeline[0].t[0]: must be > 0'), msgs.join('\n'));
  assert.deepEqual(validateFamily({ version: 2, section: { id: 's', title: 't' }, diagrams: [] }).map((e) => e.path), ['version']);
});

test('schema enumerations are ones the generator accepts', () => {
  const $ = SCHEMA.$defs;
  for (const kind of $.group.properties.kind.enum) checkSpec({ id: 'x-probe', groups: [{ kind, x: 0, y: 0, w: 10, h: 10 }] });
  for (const align of $.group.properties.align.enum) checkSpec({ id: 'x-probe', groups: [{ kind: 'az', x: 0, y: 0, w: 10, h: 10, align }] });
  for (const kind of $.timelineEntry.properties.kind.enum) checkSpec({ ...base(), timeline: [{ ring: 'a', t: [0.1, 0.2], kind }] });
  for (const kind of $.note.properties.kind.enum) for (const anchor of $.anchor.enum) checkSpec({ ...base(), notes: [{ x: 1, y: 1, text: 'n', kind, anchor }] });
});

test('canonical form keeps known keys in schema order and drops what the generator does not read', () => {
  const { family, dropped } = canonical({ section: { title: 't', id: 's' }, diagrams: [{ nodes: [{ y: 1, x: 2, icon: 'i', id: 'a', cx: 9, label: null }], name: 'n', id: 'd' }] });
  assert.equal(toJson(family), '{\n  "version": 1,\n  "section": { "id": "s", "title": "t" },\n  "diagrams": [\n    {\n      "id": "d",\n      "name": "n",\n      "nodes": [\n        { "id": "a", "icon": "i", "x": 2, "y": 1 }\n      ]\n    }\n  ]\n}');
  assert.deepEqual([...dropped], [['diagrams.nodes.cx', 1]]);
});

// ---- semantic markup ----
// strip what the semantic pass adds: node wrappers and titles, the svg title/desc, wire ends
const plain = (html) => html
  .replace(/<g class="awd-n" data-node="[^"]*" data-icon="[^"]*"><title>[^<]*<\/title>((?:(?!<\/g>)[\s\S])*)<\/g>/g, '$1')
  .replace(/<title>[^<]*<\/title>(?:<desc>[^<]*<\/desc>)?/g, '')
  .replace(/ data-(?:from|to)="[^"]*"/g, '');

test('semantic markup changes no geometry: all 78 gallery diagrams match the committed drafts once it is removed', async () => {
  let n = 0;
  for (const f of FAMILIES) {
    const mod = await load(f), html = section(mod);
    assert.equal(plain(html), plain(readLf(path.join(HERE, '..', 'drafts', f + '.aws.html')).replace(/\n$/, '')), f);
    const ids = (s) => [...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids(html), ids(plain(html)), `${f}: no new ids`);
    n += mod.diagrams.length;
  }
  assert.equal(n, 78);
});

test('nodes, wires and the svg carry their names', () => {
  const svg = diagram({ ...base(), name: 'Probe', desc: 'A & B.', wires: [{ id: 'w', from: 'a', to: 'b' }, { id: 'v', d: 'M0,0 H9' }],
    nodes: [...base().nodes, { id: 'u', icon: 'aws-res-users', x: 0, y: 80 }], effects: [{ appear: 'b', t: [0.2, 0.4], ghost: true }] });
  assert.match(svg, /^<svg class="awd" viewBox="0 0 480 240" role="img" aria-label="Probe"><title>Probe<\/title><desc>A &amp; B\.<\/desc><defs>/);
  assert.match(svg, /<g class="awd-n" data-node="a" data-icon="aws-svc-lambda"><title>AWS Lambda<\/title><use href="#aws-svc-lambda"/);
  assert.match(svg, /<g class="awd-n" data-node="u" data-icon="aws-res-users"><title>Users<\/title><use class="cw-d"/);
  assert.equal(svg.match(/data-node="b"/g).length, 3, 'ghost, still and animated copies');
  assert.match(svg, /<path id="x-probe-w" class="w" data-from="a" data-to="b" d=/);
  assert.match(svg, /<path id="x-probe-v" class="w" d=/);
});

// ---- standalone svg ----
// small XML well-formedness check: balanced tags, quoted unique attributes, entities only
function xmlError(xml) {
  const ENT = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/;
  const body = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  for (const m of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+=(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|([^<]+)|(<)/g)) {
    if (m[6]) return `stray < at ${m.index}`;
    if (m[5] != null) { if (ENT.test(m[5])) return 'bare & in text'; continue; }
    if (ENT.test(m[3])) return `bare & in <${m[2]}>`;
    const names = [...m[3].matchAll(/\s([\w:.-]+)=/g)].map((x) => x[1]);
    if (new Set(names).size !== names.length) return `duplicate attribute in <${m[2]}>`;
    if (m[1]) { if (stack.pop() !== m[2]) return `mismatched </${m[2]}>`; } else if (!m[4]) stack.push(m[2]);
  }
  return stack.length ? `unclosed <${stack.pop()}>` : null;
}

test('standalone(): one well-formed svg document per gallery diagram, with only the symbols it uses', async () => {
  for (const f of [...FAMILIES, 'example']) {
    for (const d of (await load(f)).diagrams) {
      const svg = standalone(d);
      assert.equal(xmlError(svg), null, d.id);
      assert.ok(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" class="awd" viewBox="0 0 ${d.w || 480} ${d.h || 240}" width="${d.w || 480}" height="${d.h || 240}" role="img"`), d.id);
      const used = new Set([...svg.matchAll(/href="#(aws-[^"]+)"/g)].map((m) => m[1]));
      const defined = [...svg.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]);
      assert.deepEqual(defined.sort(), [...used].sort(), `${d.id}: symbols`);
      const meta = svg.match(/<metadata id="awd-spec" data-version="1"><!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/);
      assert.deepEqual(JSON.parse(meta[1]), canonicalDiagram(d), `${d.id}: metadata`);
      assert.deepEqual(validate(svg), [], d.id);
    }
  }
});

test('standalone(): theme, still and the inlined kit css', () => {
  const auto = standalone(base()), light = standalone(base(), { theme: 'light' }), dark = standalone(base(), { theme: 'dark', still: true });
  assert.doesNotMatch(auto, /^<svg[^>]*data-(mode|still)/);
  assert.match(light, /^<svg[^>]* data-mode="light">/);
  assert.match(dark, /^<svg[^>]* data-mode="dark" data-still="">/);
  const css = light.match(/<style><!\[CDATA\[([\s\S]*?)\]\]><\/style>/)[1];
  assert.match(css, /\.awd \.w\{fill:none/);
  assert.match(css, /\.awd\[data-still\] \.pk/);
  assert.match(css, /\.awd:root\{width:480px;height:240px;color-scheme:light\}/);
  assert.doesNotMatch(css, /\.tile|\.gallery|awd-lib|awd-legend|\/\*/);
  assert.throws(() => standalone(base(), { theme: 'sepia' }), /theme must be/);
  // a "]]>" inside the spec cannot end the CDATA section early
  const tricky = standalone({ ...base(), desc: 'a ]]> b' });
  assert.equal(xmlError(tricky), null);
  assert.equal(JSON.parse(tricky.match(/<metadata[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/)[1]).desc, 'a ]]> b');
});

// ---- CLI ----
test('CLI: export-json, build from JSON with --out, svg, and schema errors', () => {
  const awd = path.join(HERE, 'awd.mjs'), tmp = fs.mkdtempSync(path.join(HERE, '.tmp-'));
  const run = (...args) => spawnSync(process.execPath, [awd, ...args], { encoding: 'utf8' });
  const ok = (...args) => { const r = run(...args); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  try {
    assert.equal(ok('export-json', path.join(HERE, 'specs', 'example.mjs'), '--out', '-'), readLf(path.join(HERE, 'json', 'example.json')));
    const json = path.join(HERE, 'json', 'serverless.json'), out = path.join(tmp, 'serverless.html');
    ok('build', json, '--out', out);
    assert.equal(fs.readFileSync(out, 'utf8'), section(JSON.parse(fs.readFileSync(json, 'utf8'))) + '\n');
    assert.match(ok('svg', json, 'aws-sl-api', '--theme', 'dark', '--still'), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="awd" viewBox="0 0 480 270"[^>]* data-mode="dark" data-still="">/);
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({ version: 1, section: { id: 'bad', title: 'B' }, diagrams: [{ id: 'b-1', name: 'B', nodes: [{ id: 'a', icon: 'aws-svc-lambda', x: 0, y: 0, lable: 'x' }] }] }));
    const r = run('build', bad, '--out', path.join(tmp, 'bad.html'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /diagrams\[0\]\.nodes\[0\]\.lable: unknown property \(did you mean label\?\)/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
