// node --test catalog/_css-source.test.mjs
// Covers the source-text recovery the extractor uses when Chromium's cssText blanks a
// var() shorthand's longhands ("background-image: ;"): the rule splitter (nested at-rules,
// comments, strings and url()s holding braces), the declaration normalizer, and the
// order-based alignment that steps over rules the browser dropped. Zero deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCssSource, cssDeclBlock, alignCssRules, CSS_SOURCE_FNS } from './_css-source.mjs';

const preludes = rules => rules.map(r => r.prelude);

test('top-level rules split in order, statement at-rules included', () => {
  const r = parseCssSource('@import url(a.css);\n.a{color:red}\n@layer base, ui;\n.b , .c>.d{margin:0}');
  assert.deepEqual(preludes(r), ['@import url(a.css)', '.a', '@layer base, ui', '.b , .c>.d']);
  assert.equal(r[0].body, null);
  assert.equal(r[0].text, '@import url(a.css);');
  assert.equal(r[1].body, 'color:red');
  assert.equal(r[3].text, '.b , .c>.d{margin:0}');
});

test('nested at-rules get children, recursively', () => {
  const src = '@media (max-width:600px){ .a{color:red} @supports (display:grid){ .b{display:grid} .c{gap:1px} } }'
    + '@keyframes spin{from{transform:rotate(0)}50%,75%{opacity:.5}to{transform:rotate(1turn)}}'
    + '.after{top:0}';
  const r = parseCssSource(src);
  assert.deepEqual(preludes(r), ['@media (max-width:600px)', '@keyframes spin', '.after']);
  assert.deepEqual(preludes(r[0].children), ['.a', '@supports (display:grid)']);
  assert.deepEqual(preludes(r[0].children[1].children), ['.b', '.c']);
  assert.deepEqual(preludes(r[1].children), ['from', '50%,75%', 'to']);
  assert.equal(r[2].children, null);
  // a child's head can be rebuilt from the parent's text (what the extractor re-parses)
  const p = r[1], head = p.text.slice(0, p.text.length - p.body.length - 1);
  assert.equal(head, '@keyframes spin{');
  assert.equal(r[0].children[1].text, '@supports (display:grid){ .b{display:grid} .c{gap:1px} }');
});

test('comments are skipped, including ones holding braces and quotes', () => {
  const src = '/* header { not a rule } */\n.a /* x */ .b{color:red /* } */;/*"*/top:0}\n'
    + '.c/**/.d{left:0}/* trailing { */';
  const r = parseCssSource(src);
  assert.deepEqual(preludes(r), ['.a .b', '.c.d']);   // a comment is not whitespace
  assert.equal(r[0].text, '.a /* x */ .b{color:red /* } */;/*"*/top:0}');
  assert.equal(cssDeclBlock(r[0].body), 'color: red; top: 0;');
});

test('a comment closed early by "*/" inside it leaves garbage that swallows the next rule', () => {
  // Real case (nfx2-styles): "(fx-*/nfx-*)" ends the comment, so the following prose and
  // the next selector form one invalid prelude. Kept as a node; the browser drops it.
  const r = parseCssSource('/* ns fx-*/nfx-*) ==== prose */\n.lift{transform:none}\n.ok{top:0}');
  assert.equal(r.length, 2);
  assert.match(r[0].prelude, /^nfx-\*\) ==== prose \*\/ \.lift$/);
  assert.equal(r[1].prelude, '.ok');
});

test('strings and unquoted url()s containing braces and semicolons do not split rules', () => {
  const src = '.q::before{content:"}{;";quotes:\'{\' \'}\'}'
    + '.u{background:url(data:image/svg+xml;utf8,<svg><style>p{fill:red}</style></svg>) no-repeat;color:blue}'
    + '.esc\\{x{top:0}'
    + '.n{color:red}';
  const r = parseCssSource(src);
  assert.deepEqual(preludes(r), ['.q::before', '.u', '.esc\\{x', '.n']);
  assert.equal(cssDeclBlock(r[0].body), 'content: "}{;"; quotes: \'{\' \'}\';');
  assert.equal(cssDeclBlock(r[1].body),
    'background: url(data:image/svg+xml;utf8,<svg><style>p{fill:red}</style></svg>) no-repeat; color: blue;');
});

test('declaration blocks keep the var() shorthand and its longhand, in authored order', () => {
  // The two shapes the bug blanks in cssText.
  assert.equal(
    cssDeclBlock('position:absolute;\n  animation:obsBubble var(--d) ease-in infinite;animation-delay:var(--delay)'),
    'position: absolute; animation: obsBubble var(--d) ease-in infinite; animation-delay: var(--delay);');
  assert.equal(
    cssDeclBlock(' BACKGROUND : radial-gradient(circle,rgba(var(--c-rgb),.3) 1px,transparent 1.5px) ;background-size:6px  6px;'),
    'background: radial-gradient(circle,rgba(var(--c-rgb),.3) 1px,transparent 1.5px); background-size: 6px 6px;');
});

test('declaration normalizer: !important, custom-property case, strings, empties, nesting', () => {
  assert.equal(cssDeclBlock('color:red!important;--Mixed-Case: 1px ;;'), 'color: red !important; --Mixed-Case: 1px;');
  // whitespace collapses between tokens but never inside a string
  assert.equal(cssDeclBlock('content:"a   b";font-family:"Segoe  UI",  sans-serif'),
    'content: "a   b"; font-family: "Segoe  UI", sans-serif;');
  assert.equal(cssDeclBlock('grid-template-columns:repeat(2,[a] 1fr);x'), 'grid-template-columns: repeat(2,[a] 1fr);');
  assert.equal(cssDeclBlock('color:red; &:hover{color:blue}'), null);   // nested rule: not handled
  assert.equal(cssDeclBlock(''), '');
});

test('alignment steps over a dropped invalid rule and leaves script-inserted rules unmatched', () => {
  const nodes = parseCssSource('.a{top:0}.x::-moz-range-thumb{top:1px}.b{top:2px}.a{top:3px}');
  // fake browser: drops the -moz- rule, otherwise serializes "sel { body }"
  const canon = n => (/-moz-/.test(n.prelude) ? null : n.prelude + ' { ' + cssDeclBlock(n.body) + ' }');
  const cssom = ['.a { top: 0; }', '.b { top: 2px; }', '.a { top: 3px; }'];
  assert.deepEqual(alignCssRules(cssom, nodes, canon), [0, 2, 3]);
  // a rule inserted by script has no source: -1, and the cursor does not move past .b
  assert.deepEqual(alignCssRules(['.a { top: 0; }', '.ins { top: 9px; }', '.b { top: 2px; }'], nodes, canon), [0, -1, 2]);
  // identical selectors are told apart by their serialization, not their order alone
  assert.deepEqual(alignCssRules(['.a { top: 3px; }'], nodes, canon), [3]);
  // and the canonical form of each source rule is computed once
  let calls = 0;
  alignCssRules(cssom, nodes, n => { calls++; return canon(n); });
  assert.equal(calls, nodes.length);
});

test('CSS_SOURCE_FNS is self-contained (it is inlined into the in-page extractor)', () => {
  const fns = new Function(CSS_SOURCE_FNS + '\nreturn { parseCssSource, cssDeclBlock, alignCssRules };')();
  const src = '@media (x){.a{background:var(--g);background-size:2px}}/* c */.b{content:"}"}';
  assert.deepEqual(fns.parseCssSource(src), parseCssSource(src));
  assert.equal(fns.cssDeclBlock('a:b;c:d'), 'a: b; c: d;');
});
