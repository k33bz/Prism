// node --test catalog/_check_themes.test.mjs
// Covers the WCAG ratio math against known pairs, the parsers the gate relies on,
// one synthetic failing palette (in-process and through the CLI with --json), the
// facet pairs taken from the generator (and the old recipe they replace), and the
// scaffolder precedence the drift check depends on. Zero deps.
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
  loadHtmlThemes, PAIRS, severityOf, runChecks, facetPairs,
} from './_check_themes.mjs';
import { themeTokens } from './_scaffold_ds.mjs';
import { generateSystem, PAINTS, VARIANTS } from './_gen_system.mjs';

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
    const chip = report.contrast.find((x) => x.pair === 'chip:accent/panel');   // yellow label on a yellow tint
    assert.deepEqual([chip.pass, chip.severity], [false, 'fail']);
    assert.equal(report.drift.length, 0);                 // both copies agree; only contrast fails
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* --------------------------------------------------------------- facet pairs */
// Cloudscape's info role and surfaces in both modes (the Prism.html values).
const CS = {
  light: { '--bg': '#f2f3f3', '--panel': '#ffffff', '--panel2': '#fafafa', '--card': '#ffffff', '--ink': '#16191f', '--info': '#0972d3', '--info-rgb': '9,114,211', '--info-ink': '#ffffff' },
  dark: { '--bg': '#0f1621', '--panel': '#192534', '--panel2': '#232f3e', '--card': '#1a2633', '--ink': '#e9ebed', '--info': '#539fe5', '--info-rgb': '83,159,229', '--info-ink': '#000716' },
};
const infoRows = (mode, pairs, tokens = CS[mode]) => auditTheme({ id: 'cs-' + mode, mode, tokens }, {}, pairs).filter((r) => r.pair.includes(':info/'));
const fmtAlpha = (a) => String(a).replace(/^0\.(?=\d)/, '.');

test('facet pairs are the generator PAINTS, and the emitted CSS uses the same numbers', () => {
  const out = generateSystem({ ds: 'T', dsShort: 't' });
  for (const p of PAINTS) {
    for (const v of VARIANTS) for (const s of p.on) assert.ok(PAIRS.some((x) => x.id === `${p.arch}:${v.key}/${s.slice(2)}`), `PAIRS has ${p.arch}:${v.key}/${s}`);
    const f = out.facets.find((x) => x.id === `t-${p.arch}-info`);
    assert.ok(f, `facet t-${p.arch}-info exists`);
    if (p.tint > 0 && p.tint < 1) assert.ok(f.css.includes(`rgba(var(--_rgb),${fmtAlpha(p.tint)})`), `${p.arch} paints its ${p.tint} tint`);
    if (p.tint >= 1) assert.ok(f.css.includes('background:var(--_c)'), `${p.arch} paints an opaque fill`);
    if (p.mix < 100) assert.ok(f.css.includes(`color:color-mix(in srgb,var(--_c) ${p.mix}%,var(--ink))`), `${p.arch} mixes its label ${p.mix}%`);
    if (p.fg === 'role-ink') {
      assert.ok(f.css.includes('var(--_ink,#fff)'), `${p.arch} paints the on-fill ink`);
      assert.ok(f.html.includes('--_ink:var(--info-ink,#fff)'), `${p.arch} sets the role ink`);
    }
  }
  // The pattern the gate replaced must not come back unmeasured: a rule that paints
  // the bare role as text on a role tint.
  const bare = out.css.split('}').filter((r) => /color:var\(--_c\)/.test(r) && /background:rgba\(var\(--_rgb\)/.test(r));
  assert.deepEqual(bare, []);
});

test('negative control: the old recipe fails the facet pairs, the new one passes', () => {
  const OLD = [
    { arch: 'chip', fg: 'role', mix: 100, tint: 0.16, on: ['--panel', '--panel2'] },
    { arch: 'menu', fg: 'role', mix: 100, tint: 0.26, on: ['--panel2'] },
    { arch: 'tab', fg: '--ink', mix: 100, tint: 0.9, on: ['--panel2'] },   // ink on the 90% indicator
  ];
  for (const mode of ['light', 'dark']) {
    const old = infoRows(mode, facetPairs(OLD));
    assert.equal(old.length, 4);
    old.forEach((r) => { assert.equal(r.pass, false, `${mode} ${r.pair} ${r.ratio}`); assert.equal(r.severity, 'fail'); assert.ok(r.ratio < 4.5); });
    const now = infoRows(mode, facetPairs(PAINTS));
    assert.equal(now.length, PAINTS.reduce((n, p) => n + p.on.length, 0));
    now.forEach((r) => assert.equal(r.pass, true, `${mode} ${r.pair} ${r.ratio}`));
  }
  near(infoRows('light', facetPairs(OLD)).find((r) => r.pair === 'chip:info/panel').ratio, 3.86);
  near(infoRows('dark', facetPairs(OLD)).find((r) => r.pair === 'tab:info/panel2').ratio, 2.7);
});

test('negative control: a surface too light for the current recipe is a gated failure', () => {
  const rows = infoRows('dark', PAIRS, { ...CS.dark, '--panel2': '#5a5966' });
  const p2 = rows.find((r) => r.pair === 'chip:info/panel2');
  assert.deepEqual([p2.pass, p2.severity, p2.floor], [false, 'fail', 4.5]);
  assert.ok(p2.ratio < 4.5, String(p2.ratio));
  assert.match(p2.fg, /^#539fe5 \d+% to --ink #e9ebed$/);
  assert.match(p2.bg, /^rgba\(83,159,229,[0-9.]+\) over #5a5966$/);
  assert.equal(rows.find((r) => r.pair === 'chip:info/panel').pass, true);
});

test('muted and dim are held on every text surface, as derive.mjs solves them', () => {
  for (const tok of ['muted', 'dim']) for (const s of ['bg', 'panel', 'panel2', 'card']) {
    const p = PAIRS.find((x) => x.id === `${tok}/${s}`);
    assert.ok(p, `${tok}/${s} is a pair`);
    assert.equal(p.floor, tok === 'muted' ? 4.5 : 3);
    assert.equal(severityOf(p, 'light'), 'fail');
  }
  // Duolingo Light as it was: muted and dim tuned on --panel/--card only
  const was = { id: 'x-light', mode: 'light', tokens: { '--bg': '#f7f7f7', '--panel': '#ffffff', '--panel2': '#fbfbfb', '--card': '#ffffff', '--ink': '#3c3c3c', '--muted': '#767676', '--dim': '#949494' } };
  const pairs = PAIRS.filter((p) => p.fg === '--muted' || p.fg === '--dim');
  const rows = auditTheme(was, {}, pairs);
  const by = (id) => rows.find((r) => r.pair === id);
  // negative control: the --panel and --card pairs it was tuned on pass, the new surfaces fail
  for (const id of ['muted/panel', 'muted/card', 'dim/panel', 'dim/card']) assert.equal(by(id).pass, true, id);
  for (const id of ['muted/bg', 'muted/panel2', 'dim/bg', 'dim/panel2']) assert.deepEqual([by(id).pass, by(id).severity], [false, 'fail'], id);
  near(by('muted/panel2').ratio, 4.39);
  near(by('dim/bg').ratio, 2.83);
  // the solved values clear all four
  const now = auditTheme({ ...was, tokens: { ...was.tokens, '--muted': '#717171', '--dim': '#8f8f8f' } }, {}, pairs);
  now.forEach((r) => assert.equal(r.pass, true, `${r.pair} ${r.ratio}`));
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

/* ------------------------------------------ shell CSS pairs + literal inks */
import { SHELL_PAIRS, auditShellPairs, loadRefMix, mixSrgb, checkLiteralInks } from './_check_themes.mjs';

// A light theme whose top bar is its accent (Duolingo Light before the fix), with
// nothing but --line to draw a control boundary.
const SHELL_LIGHT = {
  id: 'shell-light', mode: 'light',
  tokens: {
    '--bg': '#f7f7f7', '--panel': '#ffffff', '--panel2': '#fbfbfb', '--card': '#ffffff', '--line': '#e5e5e5',
    '--ink': '#3c3c3c', '--accent': '#347f02', '--accent-ink': '#ffffff', '--cs-topnav-bg': '#347f02', '--cs-topnav-ink': '#ffffff',
  },
};
const rowOf = (rows, id) => rows.find((r) => r.pair === id);
const withTokens = (t, extra) => ({ ...t, tokens: { ...t.tokens, ...extra } });

test('control-line: --line as the control boundary fails 3:1 on every surface, a solved control line passes', () => {
  const bad = auditShellPairs(withTokens(SHELL_LIGHT, { '--control-line': '#e5e5e5' }));
  for (const s of ['bg', 'panel', 'panel2', 'card']) {
    const r = rowOf(bad, `control-line/${s}`);
    assert.equal(r.pass, false, s);
    assert.equal(r.floor, 3);
  }
  near(rowOf(bad, 'control-line/panel').ratio, 1.26);
  assert.equal(rowOf(auditShellPairs(SHELL_LIGHT), 'control-line/bg').note, 'unresolvable color'); // undeclared fails, never passes
  const good = auditShellPairs(withTokens(SHELL_LIGHT, { '--control-line': '#908f90' }));
  for (const s of ['bg', 'panel', 'panel2', 'card']) assert.equal(rowOf(good, `control-line/${s}`).pass, true, s);
});

test('ref/panel2: the mix comes from the gallery CSS; plain accent fails where the mix passes', () => {
  const css = (c) => `<style>.tile .ref{font-size:11.5px;color:${c};background:var(--panel2);border:1px solid var(--line)}</style>`;
  assert.deepEqual(loadRefMix(css('color-mix(in srgb,var(--accent) 75%,var(--ink))')), { mix: 0.75, rules: 1, findings: [] });
  assert.equal(loadRefMix(css('var(--accent)')).mix, 1);
  assert.equal(loadRefMix('<style>.tile .ref{color:var(--crit);opacity:.7}</style>').rules, 0); // not the chip label
  assert.equal(loadRefMix(css('var(--accent)') + css('color-mix(in srgb,var(--accent) 75%,var(--ink))')).findings.length, 1); // copies disagree
  assert.deepEqual(mixSrgb({ r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 }, 0.75), { r: 191, g: 0, b: 64, a: 1 });
  // Firefox Acorn Dark: accent #ff7139 on its light panel2 #42414d
  const acorn = { id: 'acorn-like', mode: 'dark', tokens: { '--bg': '#1c1b22', '--panel2': '#42414d', '--accent': '#ff7139', '--ink': '#fbfbfe' } };
  const plain = rowOf(auditShellPairs(acorn, {}, { refMix: 1 }), 'ref/panel2');
  near(plain.ratio, 3.66);
  assert.equal(plain.pass, false);
  const mixed = rowOf(auditShellPairs(acorn, {}, { refMix: 0.75 }), 'ref/panel2');
  assert.equal(mixed.pass, true);
  near(mixed.ratio, 4.61);
  assert.equal(rowOf(auditShellPairs(acorn), 'ref/panel2'), undefined); // no .tile .ref rule: not measured
});

test('topnav-accent: an accent-colored top bar fails 3:1 until the theme sets --cs-topnav-accent', () => {
  const f = rowOf(auditShellPairs(SHELL_LIGHT), 'topnav-accent/topnav-bg');
  assert.equal(f.fg, '#347f02');
  near(f.ratio, 1);
  assert.equal(f.pass, false);
  const good = auditShellPairs(withTokens(SHELL_LIGHT, { '--cs-topnav-accent': '#ffffff', '--cs-topnav-accent-ink': '#347f02' }));
  near(rowOf(good, 'topnav-accent/topnav-bg').ratio, 5.02);
  assert.equal(rowOf(good, 'topnav-accent/topnav-bg').pass, true);
  near(rowOf(good, 'topnav-accent-ink/topnav-accent').ratio, 5.02);
  assert.equal(rowOf(good, 'topnav-accent-ink/topnav-accent').pass, true);
  // the label falls back to --accent-ink: a white top-bar accent without its own ink fails
  const noInk = rowOf(auditShellPairs(withTokens(SHELL_LIGHT, { '--cs-topnav-accent': '#ffffff' })), 'topnav-accent-ink/topnav-accent');
  assert.equal(noInk.fg, '#ffffff');
  assert.equal(noInk.pass, false);
  // a theme that sets no bar gets the shell :root default (Cloudscape's #000716)
  const dflt = rowOf(auditShellPairs({ id: 'x', mode: 'dark', tokens: { '--bg': '#0f1621', '--accent': '#539fe5' } }, { '--cs-topnav-bg': '#000716' }), 'topnav-accent/topnav-bg');
  near(dflt.ratio, 7.16);
});

test('literal inks: role fills with a literal text color are found; inks, tints and literal stops are not', () => {
  const html = [
    '<script>{}</script>', '<style>',
    '.a{background:var(--accent);color:#1a1200}',
    '.b{background:var(--neg,#d91515);color:#fff!important}',
    '.c{background:linear-gradient(90deg,var(--crit),rgba(var(--crit-rgb),.4));color:white}',
    '.d{background:var(--accent);color:var(--accent-ink,#1a1200)}',
    '.e{background:rgba(var(--accent-rgb),.15);color:#fff}',
    '.f{background:linear-gradient(90deg,var(--accent),#ffb347);color:#1a1205}',
    '.g{background:var(--panel2);color:#fff}',
    '</style>',
    '<div style="background:var(--pos);color:#06210d">x</div><div style="background:var(--pos);color:var(--pos-ink)">y</div>',
  ].join('\n');
  const hits = checkLiteralInks(html);
  assert.deepEqual(hits.map((h) => h.where), ['.a', '.b', '.c', 'inline style']);
  assert.deepEqual(hits.map((h) => h.literal), ['#1a1200', '#fff', 'white', '#06210d']);
  assert.deepEqual(hits.map((h) => h.line), [3, 4, 5, 11]);
});

test('the repo measures every shell pair in every theme and has no literal inks left', async () => {
  const report = await runChecks();
  for (const t of report.themes) {
    for (const p of SHELL_PAIRS) {
      const r = report.contrast.find((x) => x.theme === t.id && x.pair === p.id);
      assert.ok(r, `${t.id} ${p.id} measured`);
      assert.equal(r.pass, true, `${t.id} ${p.id} ${r.ratio}`);
    }
  }
  assert.deepEqual(report.shellCss, []);
});
