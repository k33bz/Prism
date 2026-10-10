/* ============================================================================
   Author-text recovery for the catalog extractor (extract-from-prism.mjs)
   ----------------------------------------------------------------------------
   Chromium serializes a declaration block that mixes a var() shorthand with one
   of its longhands (`background: radial-gradient(...var(--x)...)` plus
   `background-size`) by expanding the shorthand into longhands whose values are
   still pending substitution, and those print EMPTY: `background-image: ;`.
   rule.cssText is then lossy, and a standalone copy built from it drops the
   background / border / animation. The authored text is still in the owner
   <style>, so the extractor re-reads it with these helpers.

   The functions below are plain, self-contained declarations: the extractor
   inlines their source (CSS_SOURCE_FNS) into the in-page EXTRACT_FN string, and
   the tests import them directly. No closures over module scope, no imports.
   ========================================================================== */

/** Index just past the string literal that opens at `i` (quote char at text[i]). */
export function skipCssString(text, i) {
  var q = text[i], n = text.length, j = i + 1;
  while (j < n) {
    var c = text[j];
    if (c === '\\') { j += 2; continue; }
    if (c === q) return j + 1;
    if (c === '\n') return j; // unterminated: a newline ends a bad-string token
    j++;
  }
  return n;
}

/** If an unquoted url( starts at `i`, the index just past its ")", else -1. An unquoted
 *  url token may contain { } and ; (inline SVG data URIs do), so it must be skipped whole. */
export function skipCssUrl(text, i) {
  if (!/^url\(\s*[^\s'")]/i.test(text.slice(i, i + 64)) || /[\w-]/.test(text[i - 1] || '')) return -1;
  var j = text.indexOf('(', i) + 1, n = text.length;
  while (j < n) {
    var c = text[j];
    if (c === '\\') { j += 2; continue; }
    if (c === ')') return j + 1;
    j++;
  }
  return n;
}

/** Index of the "}" that closes the "{" at `open`, skipping comments, strings and url()s;
 *  -1 when the block runs to the end of the text (the parser closes it at EOF). */
export function matchCssBrace(text, open) {
  var depth = 0, n = text.length, i = open;
  while (i < n) {
    var c = text[i];
    if (c === '/' && text[i + 1] === '*') { var e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") { i = skipCssString(text, i); continue; }
    if (c === '\\') { i += 2; continue; }
    if (c === 'u' || c === 'U') { var u = skipCssUrl(text, i); if (u > 0) { i = u; continue; } }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
    i++;
  }
  return -1;
}

/** Split stylesheet source into rules, in source order: [{ prelude, body, text, children }].
 *  `prelude` is the selector / at-rule head with comments removed and whitespace collapsed;
 *  `body` is the raw text between the braces (null for a statement at-rule such as
 *  @import); `text` is the raw rule (head through closing brace), which re-parses exactly
 *  as the browser saw it. Grouping at-rules (@media, @supports, @container, @layer, @scope,
 *  @starting-style, @document) and @keyframes get `children` parsed the same way. Invalid
 *  rules are kept: the browser drops them from the CSSOM, and alignCssRules steps over them. */
export function parseCssSource(text) {
  var rules = [], n = text.length, i = 0, pre = '', ps = -1;
  while (i < n) {
    var c = text[i];
    // a comment is not whitespace: ".a/**/.b" is the compound selector ".a.b"
    if (c === '/' && text[i + 1] === '*') { var e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (ps < 0 && !/\s/.test(c)) ps = i;
    if (c === '"' || c === "'") { var s = skipCssString(text, i); pre += text.slice(i, s); i = s; continue; }
    if (c === '\\') { pre += text.slice(i, i + 2); i += 2; continue; }
    if (c === '{') {
      var close = matchCssBrace(text, i), end = close < 0 ? n : close;
      var prelude = pre.replace(/\s+/g, ' ').trim(), body = text.slice(i + 1, end);
      var group = /^@(-[a-z]+-)?(media|supports|container|layer|scope|starting-style|document|keyframes)\b/i.test(prelude);
      rules.push({ prelude: prelude, body: body, text: text.slice(ps, i) + '{' + body + '}', children: group ? parseCssSource(body) : null });
      pre = ''; ps = -1; i = end + 1; continue;
    }
    // A ";" ends an at-rule statement; inside a qualified rule's prelude it is just a token
    // (it makes the selector invalid, so the browser drops the whole rule, as happens here).
    if (c === ';' && /^\s*@/.test(pre)) {
      rules.push({ prelude: pre.replace(/\s+/g, ' ').trim(), body: null, text: text.slice(ps, i + 1), children: null });
      pre = ''; ps = -1; i++; continue;
    }
    if (c === '}') { pre = ''; ps = -1; i++; continue; } // stray close brace
    pre += c; i++;
  }
  return rules;
}

/** Normalize a declaration block's source text to "prop: value; prop: value;" (comments
 *  dropped, whitespace collapsed outside strings, property names lower-cased except custom
 *  properties). Returns null when the block holds a nested rule, which this does not handle. */
export function cssDeclBlock(body) {
  var decls = [], cur = '', depth = 0, n = body.length, i = 0;
  function flush() {
    var d = cur.replace(/^\s+|\s+$/g, ''); cur = '';
    var k = d.indexOf(':'); if (k < 1) return;
    var name = d.slice(0, k).trim(), value = d.slice(k + 1).trim().replace(/\s*!\s*important$/i, ' !important');
    decls.push((name.indexOf('--') === 0 ? name : name.toLowerCase()) + ': ' + value + ';');
  }
  while (i < n) {
    var c = body[i];
    if (c === '/' && body[i + 1] === '*') { var e = body.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") { var s = skipCssString(body, i); cur += body.slice(i, s); i = s; continue; }
    if (c === '\\') { cur += body.slice(i, i + 2); i += 2; continue; }
    if (c === 'u' || c === 'U') { var u = skipCssUrl(body, i); if (u > 0) { cur += body.slice(i, u); i = u; continue; } }
    if (/\s/.test(c)) { if (!/\s$/.test(cur)) cur += ' '; i++; continue; }
    if (c === '{' || c === '}') return null;
    if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
    else if (c === ';' && depth === 0) { flush(); i++; continue; }
    cur += c; i++;
  }
  flush();
  return decls.join(' ');
}

/** Align CSSOM rules to source rules by order. `cssom` holds each CSSOM rule's cssText;
 *  `canon(node)` returns the cssText the browser gives that source rule parsed on its own
 *  (null when it drops it). Each CSSOM rule takes the first unclaimed source rule at or
 *  after the cursor with an identical serialization, so rules the browser dropped as
 *  invalid are stepped over, and a CSSOM rule with no source (inserted by script, or edited
 *  since) maps to -1 without moving the cursor. Returns source indices, one per CSSOM rule. */
export function alignCssRules(cssom, nodes, canon) {
  var out = [], memo = {}, j = 0;
  for (var i = 0; i < cssom.length; i++) {
    var hit = -1;
    for (var k = j; k < nodes.length; k++) {
      if (!(k in memo)) memo[k] = canon(nodes[k]);
      if (memo[k] === cssom[i]) { hit = k; break; }
    }
    out.push(hit);
    if (hit >= 0) j = hit + 1;
  }
  return out;
}

// Source of the helpers above, for inlining into the extractor's in-page function.
export const CSS_SOURCE_FNS = [skipCssString, skipCssUrl, matchCssBrace, parseCssSource, cssDeclBlock, alignCssRules]
  .map(String).join('\n');
