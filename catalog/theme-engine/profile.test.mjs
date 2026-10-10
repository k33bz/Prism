// profile.mjs: toProfile's shape, and that the profile drives the real
// _scaffold_ds.mjs (against stub copies in a temp dir, via its PRISM_* env
// overrides) and _gen_system.mjs. Nothing in the repository is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { deriveTheme, TOKENS } from './derive.mjs';
import { toProfile, profileModule } from './profile.mjs';
import { generateSystem } from '../_gen_system.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCAFFOLD = resolve(HERE, '..', '_scaffold_ds.mjs');

test('toProfile returns the profile shape the scaffolder and generator read', () => {
  const d = deriveTheme({ name: 'Acme Cloud', accent: '#0078d4', radius: 6, font: 'Inter, system-ui, sans-serif' });
  const p = toProfile(d, { homeUrl: 'https://acme.example', ticket: 'T-1' });
  assert.deepEqual(Object.keys(p), ['ds', 'dsShort', 'homeUrl', 'ticket', 'accent', 'palette', 'tokenProfile']);
  assert.equal(p.ds, 'Acme Cloud');
  assert.equal(p.dsShort, 'acme-cloud');
  assert.equal(p.accent, '#0078d4');
  assert.deepEqual(Object.keys(p.palette), ['dark', 'light']);
  for (const m of ['dark', 'light']) {
    assert.deepEqual(Object.keys(p.palette[m]), TOKENS);
    assert.deepEqual(p.palette[m], d[m]);
    assert.notEqual(p.palette[m], d[m], 'a copy, not the derived object');
  }
  assert.deepEqual(p.tokenProfile, { radius: '6px', font: 'Inter, system-ui, sans-serif' });
  assert.deepEqual(JSON.parse(JSON.stringify(p)), p, 'plain JSON data');
  // one mode only: the other palette is left for the scaffolder's accent fallback
  const dark = toProfile(deriveTheme({ accent: '#0078d4', mode: 'dark' }), { ds: 'Night', dsShort: 'night' });
  assert.deepEqual(Object.keys(dark.palette), ['dark']);
  assert.equal(toProfile(d, { ds: 'X', dsShort: 'my-pack' }).dsShort, 'my-pack');
  assert.equal(toProfile(d).homeUrl, undefined);
});

test('toProfile rejects what the scaffolder would reject', () => {
  const d = deriveTheme({ accent: '#0078d4' });
  assert.throws(() => toProfile({}), /result of deriveTheme/);
  assert.throws(() => toProfile(d, { dsShort: 'Cloudscape' }), /built-in base/);
  assert.throws(() => toProfile(d, { ds: '!!!' }), /kebab-case/);
  assert.throws(() => toProfile(d, { ds: 'a"b' }), /display name/);
  assert.throws(() => toProfile(d, { homeUrl: 'javascript:alert(1)' }), /http\(s\) URL/);
});

test('the profile feeds _gen_system.mjs: 100 facets for the pack', () => {
  const p = toProfile(deriveTheme({ name: 'Gen Probe', accent: '#58cc02' }));
  const out = generateSystem(p);
  assert.equal(out.facets.length, 100);
  assert.equal(out.spectrum, 'gen-probe');
  assert.match(out.css, /\.gen-probe-root\{--gen-probe-radius:8px;--gen-probe-font:/);
});

test('the profile drives _scaffold_ds.mjs end to end (stub targets in a temp dir)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-derive-'));
  try {
    const d = deriveTheme({ name: 'Scaffold Probe', accent: '#ffd400', radius: 10 });
    const p = toProfile(d, { homeUrl: 'https://example.com' });
    const profilePath = join(dir, 'scaffold-probe.mjs');
    writeFileSync(profilePath, profileModule(p, d));
    // Minimal stand-ins carrying exactly the anchors the scaffolder patches.
    writeFileSync(join(dir, 'Prism.html'), "<script>\n  var THEME_REGISTRY=[\n    {id:'cloudscape-dark', ds:'cloudscape'}\n  ];\n</script>\n");
    writeFileSync(join(dir, 'themes.js'), "export function packTokens(mode, over) { return { ...over }; }\nexport const THEMES = [\n  // ▼ scaffolded theme packs (F6)\n];\n");
    writeFileSync(join(dir, 'systems.json'), JSON.stringify({ legacy: [], themePack: [] }, null, 2) + '\n');
    const env = { ...process.env, PRISM_HTML: join(dir, 'Prism.html'), PRISM_MCP_THEMES: join(dir, 'themes.js'), PRISM_SYSTEMS: join(dir, 'systems.json'), PRISM_PROFILES_DIR: dir };
    const log = execFileSync(process.execPath, [SCAFFOLD, profilePath], { env, encoding: 'utf8' });
    assert.match(log, /Scaffold complete/);

    // 1) the shell registry: two entries whose :root consts carry the full derived palette
    const html = readFileSync(join(dir, 'Prism.html'), 'utf8');
    assert.match(html, /id:'scaffold-probe-dark', ds:'scaffold-probe'/);
    assert.match(html, /id:'scaffold-probe-light'/);
    for (const m of ['dark', 'light']) {
      const css = JSON.parse(html.match(new RegExp(`var SCAFFOLD_PROBE_${m.toUpperCase()}_CSS=("[^\\n]*");`))[1]);
      for (const [k, v] of Object.entries(d[m])) assert.ok(css.includes(`${k}:${v};`), `${m} ${k}`);
    }
    // 2) the MCP mirror: palette entries equal the derived maps (chrome tokens agree)
    const { THEMES } = await import(pathToFileURL(join(dir, 'themes.js')).href);
    assert.equal(THEMES.length, 2);
    for (const t of THEMES) assert.deepEqual(t.tokens, d[t.mode], t.id);
    // 3) the family registry, and 4) the profile already lives in PRISM_PROFILES_DIR
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'systems.json'), 'utf8')).themePack, [{ dsShort: 'scaffold-probe', name: 'Scaffold Probe' }]);
    assert.match(log, /profiles\/scaffold-probe\.mjs \(input profile already lives there\)/);
    assert.ok(existsSync(profilePath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
