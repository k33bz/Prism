// node --test catalog/_standalone-css.test.mjs
// Covers what the extractor adds to a facet's standalone copy beyond its class rules: the
// keyframes and reduced-motion selectors for inline style="animation:..." attributes, and
// the gallery :root custom properties the copy reads. Zero deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineAnimationNames, inlineAnimationSelectors, cssVarRefs, rootVarsRule, STANDALONE_FNS } from './_standalone-css.mjs';

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
