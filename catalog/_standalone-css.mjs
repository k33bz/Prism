/* ============================================================================
   Standalone-copy helpers for the catalog extractor (extract-from-prism.mjs)
   ----------------------------------------------------------------------------
   A facet's standalone copy is its html plus the css rules that style its
   classes. Two things the live gallery gives a facet never show up that way:

   - Keyframes named only in an inline style="animation:..." attribute. No class
     rule mentions them, so the copy animated to nothing, and the generated
     reduced-motion block (built from class selectors) could not stop them. The
     galleries stop those with a page-wide "*" rule under prefers-reduced-motion,
     which no facet carries.
   - Custom properties a gallery defines on its own :root (--ann-i-rgb,
     --teal, --neu-base...). tokens.css ships the global ones; the gallery ones
     were lost, so colors fell back or vanished (a dotted divider drew nothing).

   Like _css-source.mjs, these are plain, self-contained declarations: the
   extractor inlines their source (STANDALONE_FNS) into the in-page EXTRACT_FN
   string, and the tests import them directly. No closures over module scope.
   ========================================================================== */

/** Keyframe names that the inline style="" attributes in `html` animate with, in first-seen
 *  order. Only animation / animation-name declarations count; timing keywords, numbers and
 *  function tokens (var(), steps(), cubic-bezier()) are not names. */
export function inlineAnimationNames(html) {
  var KEYWORDS = /^(ease|linear|infinite|alternate|reverse|normal|forwards|backwards|both|none|steps|ease-in|ease-out|ease-in-out|paused|running|cubic-bezier|alternate-reverse|step-start|step-end|initial|inherit|unset|revert|auto)$/;
  var names = [], seen = {};
  (html.match(/\sstyle="[^"]*"/g) || []).forEach(function (attr) {
    // the lookbehind keeps a custom property such as --slide-animation from counting
    (attr.match(/(?<![\w-])animation(?:-name)?\s*:\s*[^;"]+/g) || []).forEach(function (decl) {
      decl.slice(decl.indexOf(':') + 1).split(/[\s,]+/).forEach(function (t) {
        if (/^[a-zA-Z_][\w-]*$/.test(t) && !KEYWORDS.test(t) && !seen[t]) { seen[t] = 1; names.push(t); }
      });
    });
  });
  return names;
}

/** Selectors for the elements whose inline style animates with one of `names`, for the
 *  generated reduced-motion block. An inline declaration outranks every normal stylesheet
 *  rule, so only an !important one stops it. Scoped by keyframe name, not by a root class:
 *  many inline-animated facets have no class at all (a styled <div> or a bare <svg>). */
export function inlineAnimationSelectors(names) {
  return names.map(function (n) { return '[style*="animation"][style*="' + n + '"]'; });
}

/** Custom property names referenced through var() in `text`, in first-seen order. */
export function cssVarRefs(text) {
  var out = [], seen = {}, re = /var\(\s*(--[\w-]+)/g, m;
  while ((m = re.exec(text))) if (!seen[m[1]]) { seen[m[1]] = 1; out.push(m[1]); }
  return out;
}

/** The :root rule a standalone copy needs: the custom properties that `text` (the facet's
 *  css and html) references, directly or through another carried property. `decls` holds
 *  [name, value] pairs from the gallery's top-level :root rules in source order (a later
 *  value wins, as in the cascade); names in `skip` (the global tokens in tokens.css) stay
 *  out so the copy keeps following the shared tokens. '' when nothing applies. */
export function rootVarsRule(decls, text, skip) {
  var def = {}, order = [], omit = {}, need = {};
  (skip || []).forEach(function (n) { omit[n] = 1; });
  decls.forEach(function (d) { if (!(d[0] in def)) order.push(d[0]); def[d[0]] = d[1]; });
  var queue = cssVarRefs(text);
  while (queue.length) {
    var v = queue.shift();
    if (need[v] || omit[v] || !(v in def)) continue;
    need[v] = 1; queue = queue.concat(cssVarRefs(def[v]));
  }
  var out = order.filter(function (v) { return need[v]; }).map(function (v) { return v + ': ' + def[v] + ';'; });
  return out.length ? ':root { ' + out.join(' ') + ' }' : '';
}

/* A gallery also styles a facet through its surroundings: ".stage svg{display:block}",
   "*{box-sizing:border-box}", "button{font:inherit}", ".tile .x". Those rules name no class of
   the facet, so the class match above never carried them, and a copy lost its block-level
   SVGs, its box sizing and its control text. The extractor now finds them by testing each
   selector against the live tile, and re-anchors them on the facet's own root elements
   (scoped with :where(), so the rule's specificity stays what it was in the gallery). */

/** A selector list split at its top-level commas. */
export function selectorList(s) {
  var out = [], d = 0, cur = '';
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--;
    if (c === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A complex selector as [compound, combinator, compound, ...]; a combinator is ' ', '>', '+' or '~'. */
export function selectorParts(s) {
  var out = [], d = 0, cur = '', i = 0;
  s = s.trim();
  while (i < s.length) {
    var c = s[i];
    if (c === '(' || c === '[') { d++; cur += c; i++; continue; }
    if (c === ')' || c === ']') { d--; cur += c; i++; continue; }
    if (!d && /[\s>+~]/.test(c)) {
      var comb = ' ';
      while (i < s.length && /[\s>+~]/.test(s[i])) { if (!/\s/.test(s[i])) comb = s[i]; i++; }
      if (cur) { out.push(cur, comb); cur = ''; }
      continue;
    }
    cur += c; i++;
  }
  if (cur) out.push(cur); else out.pop();
  return out;
}

/** selectorParts' inverse: ".a", ">", ".b" -> ".a > .b". */
export function joinParts(p) {
  var s = '';
  for (var i = 0; i < p.length; i++) s += (i % 2) ? (p[i] === ' ' ? ' ' : ' ' + p[i] + ' ') : p[i];
  return s;
}

/** The selector with its pseudo-elements and user-action states removed, so it can be tested
 *  against the live DOM (".x:hover::after" matches the elements ".x" does). '*' when nothing is left. */
export function stripDynamic(s) {
  var p = s.replace(/::?(?:before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)(?:\([^)]*\))?|:(?:hover|focus-visible|focus-within|focus|active|visited|target)(?![\w-])/g, '').trim();
  return !p || /[>+~]$/.test(p) ? p + '*' : p;
}

/** A compound that is only a theme condition ("[data-mode=light]", ":root[data-ds=duolingo]"):
 *  its attribute selectors without the html / :root they sit on, or null for any other compound. */
export function themeCondition(c) {
  var a = c.replace(/^(?:html|:root)/, '');
  return /^(?:\[data-(?:mode|ds|theme)\b[^\]]*\])+$/.test(a) ? a : null;
}

/** Re-anchor `sel`, a gallery selector that reaches the facet only through its surroundings, onto
 *  the facet's roots (`roots`: one selector per top-level element, e.g. ".el-card.c-info").
 *  `inFacet(s)` tells whether s matches an element of the facet, `around(s)` whether it matches
 *  the stage, the tile or the page around it (both are handed the selector with stripDynamic
 *  applied). Leading compounds that match only the surroundings are dropped; the rest is scoped to
 *  the roots: their descendants, and the roots themselves unless a dropped ">" ruled that out
 *  (".stage > svg" can only be a root). A theme condition stays, as an ancestor (it holds on any
 *  page whose root carries the theme's data-mode / data-ds, as the shell's does). Returns null when
 *  the selector needs surroundings this facet does not have or a state of them (".stage:hover svg"),
 *  styles only the surroundings, or there is no root to scope to. */
export function rescopeSelector(sel, roots, inFacet, around) {
  if (!roots.length) return null;
  var p = selectorParts(sel), i = 0, cond = [];
  while (i < p.length - 1 && !inFacet(stripDynamic(p[i]))) {
    var tc = themeCondition(p[i]);
    if (tc) cond.push(tc);
    else if (stripDynamic(p[i]) !== p[i] || !around(p[i])) return null;
    i += 2;
  }
  var rest = p.slice(i), comb = i ? p[i - 1] : ' ';
  if (comb === '+' || comb === '~' || !inFacet(stripDynamic(joinParts(rest)))) return null;
  var scope = ':where(' + roots.join(', ') + ')', pre = cond.length ? cond.join(' ') + ' ' : '', out = [];
  if (comb !== '>') out.push(pre + scope + ' ' + joinParts(rest));
  // the roots themselves: the scope goes on the first compound, ahead of any pseudo-element
  var m = /::?(?:before|after|first-line|first-letter|marker|placeholder|selection|backdrop|-webkit-[\w-]+|-moz-[\w-]+)$/.exec(rest[0]);
  var first = m ? rest[0].slice(0, m.index) + scope + m[0] : rest[0] + scope;
  out.push(pre + joinParts([first].concat(rest.slice(1))));
  return out.join(', ');
}

/** The selector that names one of the facet's root elements: its classes, or null without any. */
export function rootSelector(classAttr) {
  var c = String(classAttr || '').trim().split(/\s+/).filter(function (x) { return /^-?[_a-zA-Z][\w-]*$/.test(x); });
  return c.length ? '.' + c.join('.') : null;
}

// Source of the helpers above, for inlining into the extractor's in-page function.
export const STANDALONE_FNS = [inlineAnimationNames, inlineAnimationSelectors, cssVarRefs, rootVarsRule,
  selectorList, selectorParts, joinParts, stripDynamic, themeCondition, rescopeSelector, rootSelector]
  .map(String).join('\n');

/* ------------------------------------------------------------------ tokens.css */

/** tokens.css (manifest.tokens.css: include once per page, then any facet's html + css), built
 *  from the live theme registry: `dark` and `light` are the token maps of Cloudscape Dark (the
 *  shell's default theme) and Cloudscape Light ({'--bg': '#0f1621', ...}, _check_themes.mjs
 *  loadHtmlThemes). Dark is the :root default; light applies under [data-mode="light"] (the
 *  attribute the shell stamps on a themed page, on <html> or on any wrapper) and repeats only
 *  the tokens that change. Then the c-* recolor classes, and the page base every gallery body
 *  sets (backdrop, text color, 14px/1.6 system type) at zero specificity, so a blank page shows a
 *  facet the way its tile looks while any body rule of the host page still wins. */
export function tokensCss(dark, light) {
  var decl = function (m, keys) { return keys.map(function (k) { return k + ':' + m[k]; }).join(';'); };
  var dk = Object.keys(dark), lk = Object.keys(light || {}).filter(function (k) { return light[k] !== dark[k]; });
  return ':root{' + decl(dark, dk) + '}'
    + (lk.length ? '[data-mode="light"]{' + decl(light, lk) + '}' : '')
    + '.c-crit{--c:var(--crit);--c-rgb:var(--crit-rgb)}.c-neg{--c:var(--neg);--c-rgb:var(--neg-rgb)}'
    + '.c-warn{--c:var(--warn);--c-rgb:var(--warn-rgb)}.c-pos{--c:var(--pos);--c-rgb:var(--pos-rgb)}'
    + '.c-info{--c:var(--info);--c-rgb:var(--info-rgb)}.c-accent{--c:var(--accent);--c-rgb:var(--accent-rgb)}'
    + ':where(body){background:var(--bg);color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}';
}
