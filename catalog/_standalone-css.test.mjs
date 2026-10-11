// node --test catalog/_standalone-css.test.mjs
// Covers what the extractor adds to a facet's standalone copy beyond its class rules: the
// keyframes and reduced-motion selectors for inline style="animation:..." attributes,
// the gallery :root custom properties the copy reads, the surrounding rules it is re-anchored
// on, and tokens.css. Zero deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineAnimationNames, inlineAnimationSelectors, cssVarRefs, rootVarsRule, STANDALONE_FNS,
  selectorList, selectorParts, joinParts, stripDynamic, themeCondition, rescopeSelector, rootSelector, tokensCss } from './_standalone-css.mjs';
import { BASE_TOKENS } from '../prism-mcp-server/utils/themes.js';

test('inline animation names: shorthand and longhand, first-seen order, no duplicates', () => {
  const html = '<div class="box" style="animation:fadeIn 1.5s ease infinite alternate">a</div>'
    + '<i style="width:4px;animation: scx-growW .8s cubic-bezier(.2,.8,.2,1) both, glow 2s steps(4,end) infinite"></i>'
    + '<b style="animation-name:fadeIn;animation-duration:2s"></b>';
  assert.deepEqual(inlineAnimationNames(html), ['fadeIn', 'scx-growW', 'glow']);
});

test('inline animation names: keywords, numbers, var() and non-animation styles are not names', () => {
  assert.deepEqual(inlineAnimationNames('<i style="animation:none"></i><i style="animation:var(--a) 2s linear infinite"></i>'), []);
  assert.deepEqual(inlineAnimationNames('<i style="animation:2s step-end infinite reverse both paused auto"></i>'), []);
  // delay / play-state longhands and custom properties that merely end in "animation"
  assert.deepEqual(inlineAnimationNames('<i style="animation-delay:.2s;animation-play-state:paused;--slide-animation:spin"></i>'), []);
  // a class or data attribute holding the word is not a style
  assert.deepEqual(inlineAnimationNames('<i class="animation:spin" data-x="animation:spin"></i>'), []);
  assert.deepEqual(inlineAnimationNames(''), []);
});

test('inline animation names: SVG and multi-line markup', () => {
  const html = '<svg>\n  <circle r="4" style="opacity:1;\n animation:rag-blink 1.5s linear infinite"></circle>\n</svg>';
  assert.deepEqual(inlineAnimationNames(html), ['rag-blink']);
});

test('inline animation selectors scope by keyframe name', () => {
  assert.deepEqual(inlineAnimationSelectors(['fadeIn', 'scx-growW']),
    ['[style*="animation"][style*="fadeIn"]', '[style*="animation"][style*="scx-growW"]']);
  assert.deepEqual(inlineAnimationSelectors([]), []);
});

test('var() references, first-seen order, fallbacks included', () => {
  assert.deepEqual(cssVarRefs('a{color:rgba(var(--ann-i-rgb),.5);border:1px solid var( --line , #000);fill:var(--ann-i-rgb)}'),
    ['--ann-i-rgb', '--line']);
  assert.deepEqual(cssVarRefs('--x: 1px; width: calc(var(--x) * 2)'), ['--x']);
  assert.deepEqual(cssVarRefs('no vars here'), []);
});

test(':root rule: only referenced gallery properties, transitively, tokens left out', () => {
  const decls = [
    ['--bg', '#0b0e17'], ['--teal', '#2ec6d6'], ['--mag', '#e0379a'],
    ['--nobj2-t', 'var(--teal,#2ec6d6)'], ['--ann-i-rgb', 'var(--info-rgb,68,147,248)'],
  ];
  const skip = ['--bg', '--info-rgb'];
  assert.equal(rootVarsRule(decls, '.x{stroke:var(--nobj2-t);background:var(--bg)}', skip),
    ':root { --teal: #2ec6d6; --nobj2-t: var(--teal,#2ec6d6); }');
  assert.equal(rootVarsRule(decls, '<div style="border-color:rgba(var(--ann-i-rgb),.5)"></div>', skip),
    ':root { --ann-i-rgb: var(--info-rgb,68,147,248); }');
  // nothing referenced, or only tokens and undefined names
  assert.equal(rootVarsRule(decls, '.x{color:var(--bg);fill:var(--nope)}', skip), '');
  assert.equal(rootVarsRule([], '.x{color:var(--teal)}', skip), '');
});

test(':root rule: a later definition wins but keeps the first position; cycles terminate', () => {
  const decls = [['--a', 'red'], ['--b', 'var(--a)'], ['--a', 'blue'], ['--c', 'var(--d)'], ['--d', 'var(--c)']];
  assert.equal(rootVarsRule(decls, 'x{color:var(--b)}'), ':root { --a: blue; --b: var(--a); }');
  assert.equal(rootVarsRule(decls, 'x{color:var(--c)}'), ':root { --c: var(--d); --d: var(--c); }');
});

test('STANDALONE_FNS is self-contained (it is inlined into the in-page extractor)', () => {
  const fns = new Function(STANDALONE_FNS + '\nreturn { inlineAnimationNames, inlineAnimationSelectors, rootVarsRule };')();
  const html = '<div style="animation:fadeInUp 1s both"></div>';
  assert.deepEqual(fns.inlineAnimationNames(html), inlineAnimationNames(html));
  assert.deepEqual(fns.inlineAnimationSelectors(['x']), inlineAnimationSelectors(['x']));
  assert.equal(fns.rootVarsRule([['--k', '1px']], 'var(--k)', []), ':root { --k: 1px; }');
});

/* ---- rules that reach a facet through its surroundings, re-anchored on its roots ---- */

test('selector lists and compounds split at top level only', () => {
  assert.deepEqual(selectorList('.a, .b:is(.c, .d) , [x="1,2"]'), ['.a', '.b:is(.c, .d)', '[x="1,2"]']);
  assert.deepEqual(selectorParts('.tile:hover  .stage>svg ~ i + b'), ['.tile:hover', ' ', '.stage', '>', 'svg', '~', 'i', '+', 'b']);
  assert.deepEqual(selectorParts('a:not(.x > .y) [data-k="p q"]'), ['a:not(.x > .y)', ' ', '[data-k="p q"]']);
  assert.equal(joinParts(selectorParts('.a>.b  .c~d')), '.a > .b .c ~ d');
});

test('stripDynamic drops pseudo-elements and user-action states, never leaves nothing', () => {
  assert.equal(stripDynamic('.x:hover::after'), '.x');
  assert.equal(stripDynamic('button:focus-visible'), 'button');
  assert.equal(stripDynamic('::-webkit-scrollbar'), '*');
  assert.equal(stripDynamic('.a:nth-child(2)::before'), '.a:nth-child(2)');
  assert.equal(stripDynamic('.a:hovered'), '.a:hovered');
});

test('themeCondition: attribute-only compounds on the root', () => {
  assert.equal(themeCondition(':root[data-mode="light"]'), '[data-mode="light"]');
  assert.equal(themeCondition('html[data-ds="duolingo"][data-mode="dark"]'), '[data-ds="duolingo"][data-mode="dark"]');
  assert.equal(themeCondition('[data-mode="light"]'), '[data-mode="light"]');
  assert.equal(themeCondition('.tile[data-mode="light"]'), null);
  assert.equal(themeCondition(':root'), null);
});

test('rescopeSelector re-anchors surrounding rules on the facet roots', () => {
  // a fake tile: .gallery > .tile > .stage > svg.chart > text
  const facet = new Set(['svg', 'text', '*', 'svg text', '.chart', 'svg.chart']);
  const around = new Set(['.stage', '.tile', '.gallery', 'body', '*', 'div']);
  const inF = (s) => facet.has(s), arc = (s) => around.has(s);
  const roots = ['.chart'];
  assert.equal(rescopeSelector('.stage svg', roots, inF, arc), ':where(.chart) svg, svg:where(.chart)');
  assert.equal(rescopeSelector('.stage > svg', roots, inF, arc), 'svg:where(.chart)');
  assert.equal(rescopeSelector('.tile .stage svg text', roots, inF, arc), ':where(.chart) svg text, svg:where(.chart) text');
  assert.equal(rescopeSelector('*', roots, inF, arc), ':where(.chart) *, *:where(.chart)');
  assert.equal(rescopeSelector('*::before', roots, inF, arc), ':where(.chart) *::before, *:where(.chart)::before');
  // a theme condition stays, as an ancestor
  assert.equal(rescopeSelector(':root[data-mode="light"] .stage svg', roots, inF, arc), '[data-mode="light"] :where(.chart) svg, [data-mode="light"] svg:where(.chart)');
  // a state of the surroundings cannot travel; nor can surroundings this tile does not have
  assert.equal(rescopeSelector('.stage:hover svg', roots, inF, arc), null);
  assert.equal(rescopeSelector('.other .stage svg', roots, inF, arc), null);
  // a sibling of the surroundings, the surroundings themselves, no root to scope to
  assert.equal(rescopeSelector('.tile + svg', roots, inF, arc), null);
  assert.equal(rescopeSelector('.tile .stage', roots, inF, arc), null);
  assert.equal(rescopeSelector('.stage svg', [], inF, arc), null);
});

test('rootSelector names a root by all its classes', () => {
  assert.equal(rootSelector(' el-card  c-info fx-pulse '), '.el-card.c-info.fx-pulse');
  assert.equal(rootSelector(''), null);
  assert.equal(rootSelector(null), null);
  assert.equal(rootSelector('w-1/2 ok'), '.ok');
});

test('tokensCss: dark :root default, light deltas under :root[data-mode="light"], page base at zero specificity', () => {
  const css = tokensCss({ '--bg': '#000', '--ink': '#fff', '--r-sm': '4px' }, { '--bg': '#fff', '--ink': '#000', '--r-sm': '4px' });
  assert.ok(css.startsWith(':root{--bg:#000;--ink:#fff;--r-sm:4px;color-scheme:dark}:root[data-mode="light"]{--bg:#fff;--ink:#000;color-scheme:light}'));
  assert.ok(!/prefers-color-scheme/.test(css));   // deterministic: no data-mode is dark
  assert.ok(css.includes('.c-pos{--c:var(--pos);--c-rgb:var(--pos-rgb)}'));
  assert.ok(/:where\(body\)\{background:var\(--bg\);color:var\(--ink\);font:14px\/1\.6 /.test(css));
  assert.ok(!tokensCss({ '--bg': '#000' }, { '--bg': '#000' }).includes('[data-mode'));
});

test('tokensCss from the MCP base defines every token the MCP base does', () => {
  const css = tokensCss(BASE_TOKENS, null);
  for (const k of Object.keys(BASE_TOKENS)) assert.ok(css.includes(k + ':'), k);
});

test('STANDALONE_FNS carries the re-scoping helpers', () => {
  const fns = new Function(STANDALONE_FNS + '\nreturn { rescopeSelector, rootSelector, selectorList };')();
  assert.equal(fns.rescopeSelector('.stage svg', ['.x'], (s) => s === 'svg', (s) => s === '.stage'), ':where(.x) svg, svg:where(.x)');
  assert.equal(fns.rootSelector('a b'), '.a.b');
  assert.deepEqual(fns.selectorList('a,b'), ['a', 'b']);
});
