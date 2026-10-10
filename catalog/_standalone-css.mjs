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

// Source of the helpers above, for inlining into the extractor's in-page function.
export const STANDALONE_FNS = [inlineAnimationNames, inlineAnimationSelectors, cssVarRefs, rootVarsRule]
  .map(String).join('\n');
