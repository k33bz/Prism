// The terminal tools in this fork's server: the server instructions name them (with live counts once a
// terminal catalog is loaded), they answer real questions against the real prism-term catalog with run
// commands that point at this fork's site, the CLI's `info` reports both catalogs, and the Prism.html
// island (when embedded) is the same catalog as prism-term/catalog/terminal-catalog.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TerminalCatalogStore, parseTerminalIsland, TERMINAL_ISLAND_OPEN } from '../utils/terminal-catalog.js';
import { buildTools } from '../tools/index.js';
import { PrismMCPServer, serverInstructions } from '../index.js';
import { createLogger } from '../utils/logger.js';
import { fixtureStore } from './helper.js';
import { FIXTURE } from './fixture.js';
import { TERMINAL_FIXTURE } from './terminal-fixture.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const REAL_JSON = path.join(ROOT, 'prism-term', 'catalog', 'terminal-catalog.json');
const REAL_HTML = path.join(ROOT, 'Prism.html');
const silent = createLogger('silent');
const TERMINAL_TOOLS = ['list_terminal_galleries', 'list_terminal_facets', 'search_terminal_facets', 'get_terminal_facet', 'get_terminal_catalog_stats'];

function fixtureTerminal(raw = TERMINAL_FIXTURE) {
  const t = new TerminalCatalogStore({ logger: silent });
  t._apply({ raw, source: 'json', filePath: '(fixture)', problems: [] });
  t.loaded = true;
  return t;
}

async function realTerminal() {
  const t = new TerminalCatalogStore({ jsonPath: REAL_JSON, watch: false, logger: silent });
  await t.load();
  return t;
}

function caller(terminal) {
  const map = new Map(buildTools().map((x) => [x.name, x]));
  return (name, args = {}) => map.get(name).handler(args, { terminal, logger: silent });
}

test('the five terminal tools are registered once each, with object schemas', () => {
  const tools = buildTools();
  for (const name of TERMINAL_TOOLS) {
    const hits = tools.filter((t) => t.name === name);
    assert.equal(hits.length, 1, name);
    assert.equal(hits[0].inputSchema.type, 'object', name);
    assert.ok(hits[0].description.length > 40, `${name} describes itself`);
  }
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length, 'tool names are unique');
});

test('the server instructions name the terminal tools, with live counts once a terminal catalog is loaded', async () => {
  const store = fixtureStore();
  const without = serverInstructions(store);
  assert.match(without, /^TERMINAL: the prism-term catalog of command-line facets: /m);
  for (const name of ['list_terminal_galleries', 'search_terminal_facets', 'get_terminal_facet', 'maxGlyphs', 'usage.npx']) assert.ok(without.includes(name), name);
  const empty = new TerminalCatalogStore({ logger: silent });
  assert.equal(serverInstructions(store, empty), without, 'an unavailable terminal catalog changes nothing');
  const t = fixtureTerminal();
  const withTerm = serverInstructions(store, t);
  assert.match(withTerm, new RegExp(`^TERMINAL: the prism-term catalog of command-line facets \\(${t.meta().facetCount} facets in ${t.meta().galleryCount} galleries\\)`, 'm'));
  const server = new PrismMCPServer('(fixture)', { watch: false, logLevel: 'silent', collectionsInMemory: true, terminal: t });
  server.store = store;
  const init = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(init.result.instructions, withTerm);
});

test('real catalog: an ASCII-only, 16-colour spinner for a serial console, with commands for this fork', { skip: !fs.existsSync(REAL_JSON) && 'no prism-term catalog' }, async () => {
  const terminal = await realTerminal();
  const call = caller(terminal);
  const hits = await call('search_terminal_facets', { query: 'spinner', maxGlyphs: 'ascii', maxColor: '16', limit: 5 });
  assert.ok(hits.total > 0 && hits.items.length > 0, 'found ASCII spinners');
  for (const f of hits.items) {
    assert.equal(f.glyphs, 'ascii', f.id);
    assert.ok(['mono', '16'].includes(f.color), `${f.id} needs ${f.color}`);
  }
  const pick = await call('get_terminal_facet', { id: hits.items[0].id });
  assert.match(pick.usage.cli, new RegExp(`^prism-term play ${pick.id}\\b`));
  assert.match(pick.usage.npx, /^npx -y --package=https:\/\/prism\.k33bz\.com\/dl\/prism-term[^ ]*\.tgz prism-term play /);
  assert.equal(pick.usage.curl, `curl -sL https://prism.k33bz.com/f/${pick.id}`);
  assert.ok(typeof pick.source === 'string' && /export default/.test(pick.source), 'module source included');
  const text = JSON.stringify(pick);
  assert.ok(!/jeremyfhall|crazy54\/Prism/.test(text), 'no upstream site or repository in the record');
});

test('real catalog: galleries and stats agree with the catalog file', { skip: !fs.existsSync(REAL_JSON) && 'no prism-term catalog' }, async () => {
  const raw = JSON.parse(fs.readFileSync(REAL_JSON, 'utf8'));
  const terminal = await realTerminal();
  const call = caller(terminal);
  const galleries = await call('list_terminal_galleries');
  const list = galleries.galleries || galleries.items || galleries;
  assert.equal(list.length, raw.galleries.length);
  const stats = await call('get_terminal_catalog_stats');
  assert.equal(stats.totalFacets ?? stats.total ?? stats.facets, raw.facets.length);
  const perGallery = Object.values(stats.byGallery || {}).reduce((s, n) => s + (typeof n === 'number' ? n : n.count || 0), 0);
  assert.equal(perGallery, raw.facets.length, 'gallery totals add up');
});

test('cli info reports the terminal catalog next to the web catalog', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-mcp-fork-'));
  try {
    const html = path.join(dir, 'Prism.html');
    const web = `<script type="application/json" id="prism-catalog">${JSON.stringify(FIXTURE).split('</script').join('<\\/script')}</script>`;
    const term = `${TERMINAL_ISLAND_OPEN}${JSON.stringify(TERMINAL_FIXTURE)}</script>`;
    fs.writeFileSync(html, `<!doctype html><html><head>${web}\n${term}</head><body></body></html>`);
    const out = execFileSync(process.execPath, [path.join(HERE, '..', 'cli.js'), 'info', '--catalog', html, '--log-level', 'silent'], { encoding: 'utf8' });
    const info = JSON.parse(out);
    assert.equal(info.meta.effectCount, 3);
    assert.equal(info.terminal.available, true);
    assert.equal(info.terminal.source, 'island');
    assert.equal(info.terminal.facetCount, TERMINAL_FIXTURE.facets.length);
    assert.ok(info.terminal.stats, 'terminal stats included');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the real Prism.html terminal island is the committed prism-term catalog (when embedded)', async (t) => {
  if (!fs.existsSync(REAL_HTML) || !fs.existsSync(REAL_JSON)) return t.skip('no Prism.html or terminal catalog');
  const html = fs.readFileSync(REAL_HTML, 'utf8');
  const island = parseTerminalIsland(html);
  if (!island) return t.skip('Prism.html has no prism-terminal-catalog island yet');
  assert.deepEqual(island, JSON.parse(fs.readFileSync(REAL_JSON, 'utf8')));
  const s = new PrismMCPServer(REAL_HTML, { watch: false, logLevel: 'silent', collectionsInMemory: true });
  await s.load();
  try {
    assert.equal(s.terminal.source, 'island');
    assert.equal(s.terminal.meta().facetCount, island.facets.length);
  } finally {
    s.close();
  }
});
