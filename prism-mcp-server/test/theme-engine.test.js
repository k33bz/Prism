// Theme engine tools: finding catalog/theme-engine beside the catalog, derive_theme and
// check_theme_contrast against the real engine, and the unavailable path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogStore } from '../utils/catalog.js';
import { engineDir } from '../utils/theme-engine.js';
import { buildTools, ToolError } from '../tools/index.js';
import { TOKEN_META, BASE_TOKENS, THEME_IDS } from '../utils/themes.js';
import { createLogger } from '../utils/logger.js';
import { fixtureStore } from './helper.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const ENGINE = path.join(REPO, 'catalog', 'theme-engine');
// the tools only need the store's file path to find the engine, so the catalog is never loaded
const repoStore = (file = path.join(REPO, 'Prism.html')) => new CatalogStore(file, { watch: false, logger: createLogger('silent') });
const tools = new Map(buildTools().map((t) => [t.name, t]));
const call = (name, args, store = repoStore()) => tools.get(name).handler(args, { store });
const rejects = (p, code, re) => assert.rejects(p, (err) => err instanceof ToolError && err.code === code && (!re || re.test(err.message)));

test('engineDir finds catalog/theme-engine beside Prism.html and theme-engine beside catalog/manifest.json', () => {
  assert.equal(engineDir(path.join(REPO, 'Prism.html')), ENGINE);
  assert.equal(engineDir(path.join(REPO, 'catalog', 'manifest.json')), ENGINE);
  assert.equal(engineDir(path.join(HERE, 'nowhere.json')), null);
});

test('the THEMES tools follow the existing theme tools', () => {
  const names = buildTools().map((t) => t.name);
  const at = names.indexOf('derive_theme');
  assert.ok(at > names.indexOf('get_theme_palette'));
  assert.equal(names[at - 1], 'get_variants_for_theme');
  assert.equal(names[at + 1], 'check_theme_contrast');
});

test('derive_theme returns both complete modes, :root css and a passing report', async () => {
  const r = await call('derive_theme', { name: 'Acme', accent: '#0078d4' });
  assert.equal(r.name, 'Acme');
  for (const mode of ['dark', 'light']) {
    for (const { k } of TOKEN_META) assert.ok(r[mode][k], `${mode} ${k}`);
    for (const k of Object.keys(BASE_TOKENS)) assert.ok(r[mode][k], `${mode} ${k}`);
    assert.match(r.css[mode], new RegExp(`^:root\\{ /\\* Acme ${mode} \\*/\\n  --bg: #[0-9a-f]{6};`));
  }
  assert.equal(r.report.summary.ok, true);
  assert.equal(r.report.failures.length, 0);
  assert.ok(r.report.pairs.length > 60);
  assert.ok(r.report.moved.some((m) => m.mode === 'dark' && /lightened/.test(m.message)));
  // deterministic, and a single mode leaves the other null
  assert.deepEqual(await call('derive_theme', { name: 'Acme', accent: '#0078d4' }), r);
  const dark = await call('derive_theme', { accent: '#ffd400', mode: 'dark', contrast: 'AAA' });
  assert.equal(dark.light, null);
  assert.equal(dark.css.light, null);
  assert.ok(dark.report.pairs.every((p) => p.mode === 'dark' && (p.pass !== false)));
});

test('derive_theme rejects bad input as invalid_argument', async () => {
  await rejects(call('derive_theme', { accent: 'blue' }), 'invalid_argument', /accent must be/);
  await rejects(call('derive_theme', { accent: '#0078d4', neutral: 'teal' }), 'invalid_argument', /neutral/);
  await rejects(call('derive_theme', { accent: '#0078d4', font: 'a;}body{x:y' }), 'invalid_argument', /font/);
});

test('check_theme_contrast checks a partial map over the base and flags failures', async () => {
  const r = await call('check_theme_contrast', { tokens: { '--panel': '#ffffff', '--bg': '#f2f3f3', '--accent': '#ffd400' } });
  assert.equal(r.mode, 'light');
  assert.equal(r.pass, false);
  const acc = r.failures.find((p) => p.fg === '--accent' && p.bg === '--panel');
  assert.ok(acc && acc.ratio < 2 && acc.floor === 4.5);
  assert.ok(r.filledFromBase.includes('--ink') && !r.filledFromBase.includes('--accent'));
  assert.equal(r.checked, r.pairs.filter((p) => p.floor != null).length);
  // only what was passed
  const bare = await call('check_theme_contrast', { tokens: { '--ink': '#777777', '--panel': '#ffffff' }, mode: 'light', fill: false });
  assert.deepEqual(bare.filledFromBase, []);
  assert.equal(bare.pairs.length, 1);
  assert.equal(bare.pairs[0].ratio, 4.48);
  assert.ok(bare.skipped.length > 10);
});

test('check_theme_contrast audits a shipped theme and a derived one', async () => {
  const shipped = await call('check_theme_contrast', { theme: 'cloudscape-light', contrast: 'AA' });
  assert.equal(shipped.mode, 'light');
  assert.deepEqual(shipped.filledFromBase, []);
  assert.ok(shipped.pairs.length > 30);
  const d = await call('derive_theme', { accent: '#58cc02', contrast: 'AAA' });
  const back = await call('check_theme_contrast', { tokens: d.light, contrast: 'AAA' });
  assert.equal(back.pass, true, JSON.stringify(back.failures));
  assert.equal(back.mode, 'light');
});

test('check_theme_contrast argument errors', async () => {
  await rejects(call('check_theme_contrast', {}), 'invalid_argument', /exactly one/);
  await rejects(call('check_theme_contrast', { tokens: {}, theme: THEME_IDS[0] }), 'invalid_argument', /exactly one/);
  await rejects(call('check_theme_contrast', { theme: 'nope' }), 'not_found');
  await rejects(call('check_theme_contrast', { tokens: ['--bg'] }), 'invalid_argument');
  await rejects(call('check_theme_contrast', { tokens: { bg: '#fff' } }), 'invalid_argument', /--name/);
  await rejects(call('check_theme_contrast', { tokens: { '--bg': '#fff' }, mode: 'dim' }), 'invalid_argument', /mode/);
});

test('without the engine beside the catalog both tools are unavailable', async () => {
  const store = fixtureStore(); // file path "(fixture)": no catalog/theme-engine next to it
  await rejects(call('derive_theme', { accent: '#0078d4' }, store), 'unavailable', /theme engine is not reachable/);
  await rejects(call('check_theme_contrast', { tokens: { '--bg': '#000000' } }, store), 'unavailable');
});
