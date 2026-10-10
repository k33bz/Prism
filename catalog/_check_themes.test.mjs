// node --test catalog/_check_themes.test.mjs
// Covers the WCAG ratio math against known pairs, the parsers the gate relies on,
// one synthetic failing palette (in-process and through the CLI with --json), and
// the scaffolder precedence the drift check depends on. Zero deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  parseColor, contrast, relativeLuminance, over, toHex,
  parseRootBlock, readStringConcat, auditTheme, checkRgb, diffTokens, checkCoverage,
  loadHtmlThemes, PAIRS, severityOf, runChecks,
} from './_check_themes.mjs';
import { themeTokens } from './_scaffold_ds.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b} (±${eps})`);

/* ---------------------------------------------------------------- ratio math */
test('relative luminance of the extremes and a mid grey', () => {
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
  near(relativeLuminance({ r: 255, g: 255, b: 255 }), 1, 1e-12);
  near(relativeLuminance(parseColor('#777777')), 0.1845, 0.0005);
});

test('contrast ratios match published reference pairs', () => {
  near(contrast('#000000', '#ffffff'), 21, 1e-9);           // the maximum
  near(contrast('#ffffff', '#ffffff'), 1, 1e-9);            // the minimum
  near(contrast('#767676', '#ffffff'), 4.54);               // the classic lightest AA grey on white
  near(contrast('#777777', '#ffffff'), 4.48);               // one step lighter fails AA
  near(contrast('#949494', '#ffffff'), 3.03);               // lightest 3:1 grey on white
  near(contrast('#ff0000', '#ffffff'), 4.0);                // pure red
  near(contrast('#0000ff', '#ffffff'), 8.59);               // pure blue
  near(contrast('#0972d3', '#ffffff'), 4.82);               // Cloudscape light accent
  // order does not matter
  near(contrast('#ffffff', '#767676'), contrast('#767676', '#ffffff'), 1e-12);
});

test('translucent colors are composited before measuring', () => {
  const half = over(parseColor('rgba(0,0,0,.5)'), parseColor('#ffffff'));
  assert.equal(toHex(half), '#808080');
  near(contrast('rgba(0,0,0,.5)', '#ffffff'), contrast('#808080', '#ffffff'), 0.01);
});

test('parseColor accepts the forms themes use and rejects the rest', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#58CC02'), { r: 88, g: 204, b: 2, a: 1 });
  assert.deepEqual(parseColor('rgba(255,255,255,.72)'), { r: 255, g: 255, b: 255, a: 0.72 });
  assert.deepEqual(parseColor('88,204,2'), { r: 88, g: 204, b: 2, a: 1 });
  assert.equal(parseColor('linear-gradient(157deg,#fff,#000)'), null);
  assert.equal(parseColor('#12345'), null);
});

/* ------------------------------------------------------------------ parsers */
test('parseRootBlock keeps quoted font stacks and gradients intact', () => {
  const t = parseRootBlock(':root{--bg:#000;--font:"Segoe UI", system-ui;--cardgrad:linear-gradient(157deg,rgba(0,0,0,.1),rgba(0,0,0,0) 55%);--dens:1;}');
  assert.equal(t['--bg'], '#000');
  assert.equal(t['--font'], '"Segoe UI", system-ui');
  assert.equal(t['--cardgrad'], 'linear-gradient(157deg,rgba(0,0,0,.1),rgba(0,0,0,0) 55%)');
  assert.equal(t['--dens'], '1');
});

test('readStringConcat reads single, double and +-joined literals', () => {
  const src = `var A=':root{'+\n  '--bg:#000;'+"--ink:\\"x\\";"+\n  '}';rest`;
  const r = readStringConcat(src, src.indexOf('=') + 1);
  assert.equal(r.value, ':root{--bg:#000;--ink:"x";}');
  assert.equal(src.slice(r.end, r.end + 1), ';');
});

/* ------------------------------------------------- synthetic failing palette */
const FAILING = {
  id: 'synthetic-light', mode: 'light',
  tokens: {
    '--bg': '#ffffff', '--panel': '#ffffff', '--panel2': '#ffffff', '--card': '#ffffff', '--line': '#f0f0f0',
    '--ink': '#999999',            // 2.85:1 -> fails 4.5
    '--muted': '#bbbbbb', '--dim': '#dddddd',
    '--accent': '#ffe01b', '--accent-rgb': '1,2,3',   // yellow on white, and a wrong triplet
    '--info': '#0972d3', '--pos': '#037f0c', '--warn': '#ff9600', '--neg': '#d91515', '--crit': '#8657f0',
    '--accent-ink': '#ffffff',
    '--cs-topnav-bg': '#000716', '--cs-topnav-ink': '#e9ebed', '--cs-topnav-dim': '#c6cdd6',
  },
};

test('a failing palette produces named, gated failures', () => {
  const rows = auditTheme(FAILING);
  const fail = (pair) => rows.find((r) => r.pair === pair);
  const ink = fail('ink/panel');
  assert.equal(ink.pass, false);
  assert.equal(ink.severity, 'fail');
  assert.equal(ink.theme, 'synthetic-light');
  assert.equal(ink.floor, 4.5);
  near(ink.ratio, 2.85);
  assert.equal(fail('accent/panel').pass, false);
  assert.equal(fail('accent/bg').pass, false);
  assert.equal(fail('accent-ink/accent').pass, false);       // #fff on yellow
  assert.equal(fail('warn-ink/warn').fg, '#ffffff');          // undefined ink falls back to #fff
  assert.equal(fail('warn-ink/warn').pass, false);
  assert.equal(fail('info/panel').pass, true);
  assert.equal(fail('line/bg').severity, 'advisory');        // borders are reported, not gated
});

test('severity: the shell #fff-on-accent pair is advisory only in dark mode', () => {
  const p = PAIRS.find((x) => x.id === '#fff/accent');
  assert.equal(severityOf(p, 'light'), 'fail');
  assert.equal(severityOf(p, 'dark'), 'advisory');
  const ink = PAIRS.find((x) => x.id === 'accent-ink/accent');
  assert.equal(severityOf(ink, 'dark'), 'fail');
});

test('rgb/hex disagreement, drift and coverage gaps are reported', () => {
  const rgb = checkRgb(FAILING);
  assert.equal(rgb.length, 1);
  assert.equal(rgb[0].token, '--accent-rgb');
  const drift = diffTokens({ '--bg': '#FFFFFF', '--ink': '#111', '--x': '1' }, { '--bg': '#ffffff', '--ink': '#222', '--y': '2' }, 'profile', 'Prism.html');
  assert.deepEqual(drift.map((d) => d.token).sort(), ['--ink', '--x', '--y']); // hex case is not drift
  const gaps = checkCoverage('synthetic-light', 'themes.js', FAILING.tokens, ['--bg', '--ink', '--crit-ink']);
  assert.deepEqual(gaps.map((g) => g.token), ['--crit-ink']);
});

test('the CLI exits 1 with --json naming theme, pair, ratio and floor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-themes-'));
  try {
    const css = ':root{' + Object.entries({ ...FAILING.tokens, '--accent-rgb': '255,224,27' }).map(([k, v]) => `${k}:${v}`).join(';') + ';}';
    writeFileSync(join(dir, 'Prism.html'), [
      '<script type="application/json">{}</script>',
      '<style>:root{--cs-topnav-bg:#000716;--cs-topnav-ink:#e9ebed;--cs-topnav-dim:#c6cdd6}</style>',
      '<script>',
      '  // ===================== THEME ENGINE =====================',
      `  var CS_LIGHT_CSS=${JSON.stringify(css)};`,
      'var THEME_REGISTRY=[',
      "    {id:'cloudscape-light', ds:'cloudscape', name:'Cloudscape Light', mode:'light', accent:'#ffe01b', builtin:true, css:CS_LIGHT_CSS}",
      '  ];',
      '</script>',
    ].join('\n'));
    writeFileSync(join(dir, 'themes.js'),
      `export const THEMES = [{ id: 'cloudscape-light', ds: 'cloudscape', mode: 'light', tokens: ${JSON.stringify({ ...FAILING.tokens, '--accent-rgb': '255,224,27' })} }];\n` +
      `export const TOKEN_META = [{ k: '--bg' }, { k: '--ink' }];\n`);
    mkdirSync(join(dir, 'profiles'));
    const r = spawnSync(process.execPath, [resolve(HERE, '_check_themes.mjs'), '--json'], {
      encoding: 'utf8',
      env: { ...process.env, PRISM_HTML: join(dir, 'Prism.html'), PRISM_MCP_THEMES: join(dir, 'themes.js'), PRISM_PROFILES_DIR: join(dir, 'profiles') },
    });
    assert.equal(r.status, 1, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.ok, false);
    const f = report.contrast.find((x) => x.pair === 'ink/panel');
    assert.deepEqual([f.theme, f.pass, f.floor], ['cloudscape-light', false, 4.5]);
    near(f.ratio, 2.85);
    assert.equal(report.drift.length, 0);                 // both copies agree; only contrast fails
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------- scaffolder precedence + loaders */
test('a token the palette declares beats the tokenProfile-derived chrome token', () => {
  const profile = {
    ds: 'X', dsShort: 'x', tokenProfile: { radius: '16px', font: 'Derived' },
    palette: { dark: { '--r-sm': '10px', '--accent': '#123456' }, light: { '--accent': '#123456' } },
  };
  const dark = themeTokens(profile, 'dark');
  assert.equal(dark['--r-sm'], '10px');        // declared wins (radius*0.5 would be 8px)
  assert.equal(dark['--r-md'], '16px');        // undeclared still derived
  assert.equal(dark['--font'], 'Derived');
  assert.equal(themeTokens(profile, 'light')['--r-sm'], '8px');
});

test('the repo copies parse and pass the gate', async () => {
  const report = await runChecks();
  const ids = report.themes.map((t) => t.id);
  assert.ok(ids.includes('cloudscape-dark') && ids.includes('glass-light'));
  assert.ok(report.summary.pairsMeasured >= ids.length * 20);
  assert.equal(report.ok, true, JSON.stringify(report.summary));
});

test('loadHtmlThemes reads multi-line Cloudscape consts and single-line pack consts', async () => {
  const html = [
    '// THEME ENGINE',
    "  var CS_DARK_CSS=':root{'+",
    "      '--bg:#0f1621;'+",
    "      '--ink:#e9ebed;}';",
    '  var P_DARK_CSS=":root{--bg:#111;--ink:#eee;}";',
    'var THEME_REGISTRY=[',
    "    {id:'cloudscape-dark', ds:'cloudscape', name:'Cloudscape Dark', mode:'dark', accent:'#539fe5', builtin:true, css:CS_DARK_CSS},",
    "    {id:'p-dark', ds:'p', name:'P Dark', mode:'dark', accent:'#000', builtin:false, css:P_DARK_CSS}",
    '  ];',
  ].join('\n');
  const t = loadHtmlThemes(html);
  assert.deepEqual(t.map((x) => x.id), ['cloudscape-dark', 'p-dark']);
  assert.deepEqual(t[0].tokens, { '--bg': '#0f1621', '--ink': '#e9ebed' });
  assert.equal(t[1].tokens['--ink'], '#eee');
});
