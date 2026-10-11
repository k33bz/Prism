// Guidance: picking the right component (recommend_effects, the closed vocabularies) and applying it
// (compose with a theme, the apply guide of get_effect, standalone documents, the backdrop template).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolCtx, fixtureStore, ToolError } from './helper.js';
import { readIntent } from '../utils/recommend.js';
import { resolvePalette, tokenBlockCss, rootAttributes, autoModeScript, buildDocument, ApplyError } from '../utils/apply.js';
import { getTheme } from '../utils/themes.js';
import { PrismMCPServer, serverInstructions } from '../index.js';

// -------------------- reading an intent --------------------

test('readIntent maps plain requests onto role, dataShape, background, motion, JS, AWS and theme', () => {
  const dash = readIntent('KPI dashboard with a time-series chart and a part-to-whole chart in Duolingo Light');
  assert.deepEqual(dash.filters.dataShapes, ['time-series', 'part-to-whole', 'single-value']);
  assert.deepEqual(dash.filters.roles, ['data-display']);
  assert.equal(dash.theme, 'duolingo-light');
  assert.ok(!dash.terms.includes('duolingo') && !dash.terms.includes('light'), 'a theme name never ranks facets');

  const load = readIntent('a loading state that is reduced-motion safe');
  assert.deepEqual(load.filters, { roles: ['loading'], reducedMotionSafe: true });

  const hero = readIntent('a hero with an animated background');
  assert.equal(hero.filters.usableAsBackground, true);
  assert.equal(hero.filters.roles, undefined, 'a backdrop is not filtered by role');
  assert.equal(hero.prefer.selfAnimates, true);

  const aws = readIntent('three-tier AWS diagram with security group rule tables');
  assert.deepEqual(aws.filters, { galleries: ['aws'] });
  assert.equal(aws.aws, true);

  // weak shape words need a chart word: a toast for a workflow is feedback, not a flow diagram
  const toast = readIntent('a toast notification for a workflow');
  assert.deepEqual(toast.filters, { roles: ['feedback'] });

  const css = readIntent('static pure css toggle switch');
  assert.deepEqual(css.filters, { roles: ['input'], selfAnimates: false, needsJs: false });
  assert.equal(readIntent('a primary call to action').terms.includes('cta'), true);
  assert.equal(readIntent('a dashboard in fluent').theme, 'fluent', 'no mode named: the design system, Auto');
});

test('recommend_effects ranks the fixture by intent, one group per need, and relaxes what matches nothing', () => {
  const ctx = toolCtx();
  const bg = ctx.call('recommend_effects', { intent: 'an animated wind background behind the content' });
  assert.equal(bg.groups.length, 1);
  assert.deepEqual(bg.groups[0].items.map((i) => i.id), ['fx-wind-bg']);
  assert.ok(bg.groups[0].items[0].why.includes('usable as a background'));
  assert.ok(bg.rules.some((r) => r.startsWith('usableAsBackground true')));

  // reduced motion is a filter, never relaxed: the pulsing KPI has no fallback
  const kpi = ctx.call('recommend_effects', { intent: 'a KPI tile that is reduced-motion safe' });
  assert.deepEqual(kpi.groups[0].items.map((i) => i.id), ['charts-kpi-delta']);

  // nothing in the fixture is a loading state: role is relaxed and said so
  const load = ctx.call('recommend_effects', { intent: 'a loading spinner' });
  assert.deepEqual(load.groups[0].relaxed, ['roles loading']);

  // two data shapes: two groups
  const two = ctx.call('recommend_effects', { intent: 'a dashboard with a trend over time and a breakdown chart' });
  assert.deepEqual(two.groups.map((g) => g.need), ['dataShape time-series', 'dataShape part-to-whole']);
  assert.match(two.next.join(' '), /compose \{ ids/);

  const aws = ctx.call('recommend_effects', { intent: 'a VPC architecture diagram' });
  assert.match(aws.next[0], /get_diagram_spec with no id/);

  assert.throws(() => ctx.call('recommend_effects', { intent: ' ' }), (e) => e instanceof ToolError && e.code === 'invalid_argument');
  assert.throws(() => ctx.call('recommend_effects', { intent: 'x', filters: { roles: ['spinner'] } }), (e) => e.code === 'invalid_argument' && e.data.roles.valid.includes('loading'));
});

// -------------------- closed vocabularies and argument checks --------------------

test('unknown gallery, role, layer and dataShape values and an unknown sort are invalid_argument with the valid values', () => {
  const ctx = toolCtx();
  const bad = (name, args) => ctx.callSafe(name, args).error;
  let e = bad('list_effects', { gallery: 'nope' });
  assert.equal(e.code, 'invalid_argument');
  assert.deepEqual(e.data.galleries.valid.sort(), ['charts', 'fx']);
  e = bad('list_effects', { role: 'spinner', dataShape: 'pie' });
  assert.deepEqual(Object.keys(e.data).sort(), ['dataShapes', 'roles']);
  e = bad('search_effects', { filters: { layers: ['floating'] } });
  assert.deepEqual(e.data.layers.valid, ['background', 'content', 'overlay']);
  e = bad('search_effects', { query: 'kpi', sort: 'popular' });
  assert.deepEqual(e.data.validSorts, ['relevance', 'name', 'newest', 'gallery']);
  // valid values still work
  assert.equal(ctx.call('search_effects', { filters: { roles: ['data-display'], dataShapes: ['single-value'] } }).total, 2);
});

test('get_effect: a missing id is invalid_argument; a hyphenated near miss gets suggestions', () => {
  const ctx = toolCtx();
  assert.equal(ctx.callSafe('get_effect', {}).error.code, 'invalid_argument');
  assert.equal(ctx.callSafe('get_component_variants', {}).error.code, 'invalid_argument');
  const miss = ctx.callSafe('get_effect', { id: 'charts-kpi-pulsing' }).error;
  assert.equal(miss.code, 'not_found');
  assert.ok(miss.data.suggestions.includes('charts-kpi-pulse'));
  assert.equal(ctx.callSafe('get_variants_for_theme', {}).error.code, 'invalid_argument');
});

// -------------------- the apply guide --------------------

test('get_effect apply: theme tokens, initializer source, motion, backdrop placement', () => {
  const ctx = toolCtx();
  const kpi = ctx.call('get_effect', { id: 'charts-kpi-pulse' });
  assert.deepEqual(kpi.apply.themeTokens, ['--ink']);
  assert.equal(kpi.apply.motion.reducedMotionSafe, false);
  assert.match(kpi.apply.motion.note, /no reduced-motion fallback/);
  assert.equal(kpi.apply.initializer, undefined);
  const wind = ctx.call('get_effect', { id: 'fx-wind-bg' });
  assert.equal(wind.apply.initializer.key, 'wind-init');
  assert.match(wind.apply.initializer.js, /window\.__wind/);
  assert.match(wind.apply.background, /template: "backdrop"/);
  assert.ok(wind.apply.steps.some((s) => /initializer\.js once/.test(s)));
});

// -------------------- compose with a theme --------------------

test('compose prepends the theme token block: a theme id, a design system for Auto, none', () => {
  const ctx = toolCtx();
  const light = ctx.call('compose', { ids: ['charts-kpi-pulse'], theme: 'cloudscape-light' });
  assert.ok(light.css.startsWith(':root{--bg:#f2f3f3;'), 'the Cloudscape Light tokens lead, not the legacy tokens.css');
  assert.match(light.css, /--control-line:#7d8998;/);
  assert.match(light.css, /--accent-ink:#ffffff;/);
  assert.match(light.css, /color-scheme:light/);
  assert.match(light.css, /\.c-pos\{--c:var\(--pos\);--c-rgb:var\(--pos-rgb\)\}/);
  assert.equal((light.css.match(/:root\{/g) || []).length, 1);
  assert.deepEqual(light.rootAttributes, { 'data-mode': 'light', 'data-ds': 'cloudscape', 'data-theme': 'cloudscape-light' });
  assert.equal(light.autoScript, undefined);
  assert.equal(light._perEffectHtml, undefined, 'no internals in the tool result');
  assert.equal(light._sprite, undefined);

  const auto = ctx.call('compose', { ids: ['charts-kpi-pulse'] });     // default: Cloudscape, Auto
  assert.equal(auto.theme.mode, 'auto');
  assert.ok(auto.css.startsWith(':root{--bg:#0f1621;'));
  assert.match(auto.css, /@media \(prefers-color-scheme: light\)\{:root:not\(\[data-mode="dark"\]\)\{--bg:#f2f3f3;/);
  assert.match(auto.css, /:root\[data-mode="light"\]\{--bg:#f2f3f3;/);
  assert.deepEqual(auto.rootAttributes, {});
  assert.match(auto.autoScript, /prefers-color-scheme: light/);
  assert.ok(auto.apply.some((s) => /autoScript/.test(s)));

  const none = ctx.call('compose', { ids: ['charts-kpi-pulse'], theme: 'none' });
  assert.doesNotMatch(none.css, /:root\{/);
  assert.equal(none.theme, null);
  const off = ctx.call('compose', { ids: ['charts-kpi-pulse'], includeTokens: false });
  assert.doesNotMatch(off.css, /--bg:/);

  const bad = ctx.callSafe('compose', { ids: ['charts-kpi-pulse'], theme: 'solarized' }).error;
  assert.equal(bad.code, 'invalid_argument');
  assert.ok(bad.data.designSystems.includes('duolingo'));
});

test('compose takes a custom palette: derive_theme { dark, light } (Auto) or a flat map over a theme', () => {
  const ctx = toolCtx();
  const pair = ctx.call('compose', { ids: ['charts-kpi-delta'], tokens: { dark: { '--bg': '#101010', '--accent': '#ff00aa' }, light: { '--bg': '#fafafa', '--accent': '#aa0066' } } });
  assert.equal(pair.theme.mode, 'auto');
  assert.ok(pair.css.startsWith(':root{--bg:#101010;'));
  assert.match(pair.css, /--accent:#aa0066/);
  assert.match(pair.css, /--control-line:#6a7888/, 'missing tokens come from the Cloudscape base of each mode');
  const flat = ctx.call('compose', { ids: ['charts-kpi-delta'], theme: 'duolingo-light', tokens: { '--accent': '#0a7d33' } });
  assert.equal(flat.theme.mode, 'light');
  assert.match(flat.css, /--accent:#0a7d33/);
  assert.match(flat.css, /--panel2:#fbfbfb/, 'layered over Duolingo Light');
  assert.deepEqual(flat.rootAttributes, { 'data-mode': 'light' });
  const bad = ctx.callSafe('compose', { ids: ['charts-kpi-delta'], tokens: { '--accent': 'red;}body{display:none' } }).error;
  assert.equal(bad.code, 'invalid_argument');
});

test('compose returns the initializer sources and a standalone document', () => {
  const ctx = toolCtx();
  const r = ctx.call('compose', { ids: ['charts-kpi-pulse', 'fx-wind-bg'], theme: 'duolingo-dark', document: true, title: 'A <b> page' });
  assert.deepEqual(r.initializers, ['wind-init']);
  assert.equal(r.scripts.length, 1);
  assert.deepEqual(r.scripts[0].effects, ['fx-wind-bg']);
  assert.match(r.document, /^<!DOCTYPE html>\n<html lang="en" data-mode="dark" data-ds="duolingo" data-theme="duolingo-dark">/);
  assert.match(r.document, /<title>A &lt;b&gt; page<\/title>/);
  assert.match(r.document, /<script data-prism-init="wind-init">/);
  assert.match(r.document, /wind <\\\/script> drift/, 'a </script> inside the source cannot close the tag');
  assert.ok(r.document.indexOf('<script data-prism-init') > r.document.indexOf('class="fx-wind"'), 'initializers run after the markup');
  const exp = ctx.call('export_collection', { ids: ['fx-wind-bg'], format: 'document', theme: 'cloudscape' });
  assert.match(exp.document, /<script>\(function\(\)\{var q=window\.matchMedia/, 'Auto: the mode script in head');
  assert.match(exp.document, /data-prism-init="wind-init"/);
  assert.equal(exp.theme.mode, 'auto');
});

test('compose refuses a wrapper tag that is not an element name', () => {
  const ctx = toolCtx();
  const r = ctx.callSafe('compose', { ids: ['charts-kpi-pulse'], wrap: { tag: 'div onclick=alert(1)' } });
  assert.equal(r.error.code, 'compose_failed');
  assert.match(r.error.data.errors[0], /element name/);
  assert.ok(ctx.call('compose', { ids: ['charts-kpi-pulse'], wrap: { tag: 'my-panel' } }).html.startsWith('<my-panel>'));
});

test('compose_with_template backdrop stretches the backdrop behind the other effects', () => {
  const ctx = toolCtx();
  const r = ctx.call('compose_with_template', { ids: ['charts-kpi-pulse', 'fx-wind-bg'], template: 'backdrop', theme: 'cloudscape-dark' });
  assert.equal(r.template, 'backdrop');
  assert.match(r.html, /^<section class="prism-compose-backdrop">\n<div class="prism-compose-bg" aria-hidden="true"><div class="fx-wind"><\/div><\/div>\n<div class="prism-compose-fg">\n<div class="kpi pulse">/);
  assert.match(r.css, /\.prism-compose-bg>\*\{position:absolute!important;inset:0!important;width:100%!important;max-width:none!important/);
  const plain = ctx.call('compose_with_template', { ids: ['charts-kpi-pulse'], template: 'backdrop' });
  assert.ok(plain.warnings.some((w) => /No backdrop/.test(w)));
});

test('validate_composition: a backdrop is usableAsBackground; no noise about self-contained', () => {
  const ctx = toolCtx();
  const r = ctx.call('validate_composition', { ids: ['charts-kpi-pulse', 'fx-wind-bg'] });
  assert.equal(r.backgroundConflict, null);
  assert.ok(!r.warnings.some((w) => /self-contained/.test(w)));
  assert.ok(r.warnings.some((w) => /wind-init/.test(w)));
});

// -------------------- tokens, facets and the reference --------------------

test('validate_facet knows the new theme tokens; the token reference lists them', () => {
  const ctx = toolCtx();
  const v = ctx.call('validate_facet', {
    id: 'charts-x', name: 'X', gallery: 'charts', description: 'A facet that reads the new tokens.', html: '<b class="x">x</b>',
    css: '.x{color:var(--accent-ink);border:var(--bd) solid var(--control-line);background:var(--accent2);box-shadow:var(--elev-1)}',
  });
  assert.deepEqual(v.warnings, []);
  const ref = ctx.call('get_token_reference', {});
  assert.ok(ref.tokensCss.startsWith(':root{--bg:#0f1621;'), 'the default theme, not the legacy catalog tokens.css');
  for (const k of ['--control-line', '--accent-ink', '--neg-ink', '--accent2', '--cardgrad']) assert.ok(ref.tokens.some((t) => t.token === k), k);
  const tv = ctx.call('get_theme_variants', {});
  assert.deepEqual(tv.onFillInks, ['--accent-ink', '--info-ink', '--pos-ink', '--warn-ink', '--neg-ink', '--crit-ink']);
  assert.ok(tv.designSystems.some((d) => d.ds === 'duolingo' && d.light === 'duolingo-light'));
  const f = ctx.call('get_available_filters', {});
  assert.equal(f.booleanFlags.themeSensitive.count, 3);
  assert.ok(!f.notes.some((n) => /theme-compatibility facet/.test(n)));
});

// -------------------- the palette helpers --------------------

test('resolvePalette, tokenBlockCss, rootAttributes and buildDocument', () => {
  const p = resolvePalette({ theme: 'heroku-light' });
  assert.equal(p.mode, 'light');
  assert.deepEqual(p.light, getTheme('heroku-light').tokens);
  assert.equal(resolvePalette({ theme: 'none' }), null);
  assert.equal(resolvePalette({ theme: 'auto' }).ds, 'cloudscape');
  assert.throws(() => resolvePalette({ theme: 'none', tokens: { '--bg': '#000' } }), ApplyError);
  assert.throws(() => resolvePalette({ tokens: { bg: '#000' } }), ApplyError);
  const auto = resolvePalette({ theme: 'monzo' });
  const css = tokenBlockCss(auto);
  assert.match(css, /^:root\{--bg:#06060a;/);
  assert.doesNotMatch(css.split('\n')[1], /--font:/, 'the light block carries only what differs from dark');
  assert.deepEqual(rootAttributes(auto), {});
  assert.match(autoModeScript(auto), /ds="monzo"|ds=\"monzo\"/);
  const doc = buildDocument({ title: 't', css: '.a{}', html: '<i></i>', palette: resolvePalette({ theme: 'primer-dark' }) });
  assert.match(doc, /<html lang="en" data-mode="dark" data-ds="primer" data-theme="primer-dark">/);
  assert.match(doc, /body\{margin:0;padding:24px;background:var\(--bg,#0f1621\)/);
});

// -------------------- the server instructions --------------------

test('the server instructions carry live counts and the pick / apply / AWS guidance', async () => {
  const store = fixtureStore();
  const text = serverInstructions(store);
  assert.match(text, /^Prism: 3 offline CSS\/SVG components .* in 2 galleries, themed by 16 design systems in dark and light \(32 themes\)/);
  for (const w of ['recommend_effects', 'usableAsBackground:true', 'reducedMotionSafe:true', 'compose { ids, theme }', 'rootAttributes', 'derive_theme', 'get_diagram_spec with no id', 'tables', 'export_diagram']) assert.ok(text.includes(w), w);
  const server = new PrismMCPServer('(fixture)', { watch: false, logLevel: 'silent', collectionsInMemory: true });
  server.store = store;
  const init = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(init.result.instructions, text);
});
