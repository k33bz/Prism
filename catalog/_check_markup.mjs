/* ============================================================================
   Markup gate: Prism.html and every gallery template parse the way they read.
   ----------------------------------------------------------------------------
   Browsers never reject HTML, they repair it, and a repair can quietly move half a
   page somewhere else (a stray </div> that ends .wrap early, a duplicate attribute
   the parser drops, a <div> inside an <svg> that throws the rest of the drawing
   out). This walks the shell document and each <script type="text/html" id="pg-*">
   template with a tokenizer and a tree builder that follow the HTML parsing rules
   closely enough to catch every repair that changes the tree:

     templates  each template ends exactly where its text says (the script-data
                escape states included, so a "<!--" plus "<script" in a template
                cannot swallow its own </script>), and nothing leaks between two
                templates into the live shell
     structure  unclosed or mis-nested elements, stray end tags, a block that
                implicitly closes a <p>, <a> inside <a>, nested buttons or forms,
                HTML that breaks out of <svg>/<math>, content foster-parented out
                of a table, "/>" on a non-void HTML element, a malformed comment
     attributes duplicate attributes (the second is dropped), a missing space
                between attributes, an unquoted value with quotes or "<" in it
     ids        within one rendered document, two elements sharing an id must be
                identical copies (a self-contained facet's own sprite); differing
                ones mean url(#id) / <use> / getElementById hit the wrong one
     islands    #prism-catalog and #prism-facet-dates parse; the catalog's counts,
                gallery counts, initializers and effect ids agree with
                catalog/manifest.json; the dates island matches facet-dates.json

   Usage:
     node catalog/_check_markup.mjs                # gate (exit 1 on failure)
     node catalog/_check_markup.mjs --file X.html  # another copy
     node catalog/_check_markup.mjs --json         # machine-readable report
     node catalog/_check_markup.mjs --self-test    # the parser against planted defects
   Zero deps, no browser, about two seconds.
   ========================================================================== */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const words = s => new Set(s.split(' '));
const VOID = words('area base br col embed hr img input link meta source track wbr param keygen basefont bgsound frame');
const RAWTEXT = words('script style xmp iframe noembed noframes noscript');
const RCDATA = words('textarea title');
// end tags the HTML syntax lets an author omit: closing them implicitly is not a repair
const OPTIONAL_END = words('li dt dd p rt rp rb rtc optgroup option colgroup caption thead tbody tfoot tr td th html head body');
const SPECIAL = words('address applet area article aside base basefont bgsound blockquote body br button caption center col colgroup dd details dir div dl dt embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html iframe img input keygen li link listing main marquee menu meta nav noembed noframes noscript object ol p param plaintext pre script search section select source style summary table tbody td template textarea tfoot th thead title tr track ul wbr xmp');
const CLOSES_P = words('address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer header hgroup main menu nav ol p search section summary ul h1 h2 h3 h4 h5 h6 pre listing form plaintext table hr xmp');
const FORMATTING = words('a b big code em font i nobr s small strike strong tt u');
const BREAKOUT = words('b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var');
const SCOPE = words('applet caption html table td th marquee object template');
// end tags that close table parts look through cells: their scope stops only at html, table, template
const TABLE_PARTS = words('table tbody thead tfoot tr td th caption colgroup');
const TABLE_SCOPE = words('html table template');
const TABLE_KIDS = { table: words('caption colgroup col thead tbody tfoot tr td th script style template form input') };
TABLE_KIDS.tbody = TABLE_KIDS.thead = TABLE_KIDS.tfoot = words('tr td th script style template form input');
TABLE_KIDS.tr = words('td th script style template form input');

/** Where a script element's text ends: the index of its closing "</script", or -1.
 *  Follows the tokenizer's script-data escape states: after "<!--", a "<script" enters the
 *  double-escaped state in which "</script>" does NOT end the element (until "-->"). */
export function scriptEnd(src, from) {
  let st = 0, i = from; const n = src.length;
  const tagAt = (p, close) => {
    const t = close ? '</script' : '<script';
    if (src.slice(p, p + t.length).toLowerCase() !== t) return false;
    const c = src[p + t.length]; return c === undefined || /[\s/>]/.test(c);
  };
  while (i < n) {
    const c = src[i];
    if (c === '<') {
      if (st === 0 && src.startsWith('<!--', i)) { st = 1; i += 2; continue; }   // re-read the "--" so "<!-->" closes at once
      if (tagAt(i, true)) { if (st === 2) { st = 1; i += 8; continue; } return i; }
      if (st === 1 && tagAt(i, false)) { st = 2; i += 7; continue; }
    } else if (c === '-' && st > 0 && src.startsWith('-->', i)) { st = 0; i += 3; continue; }
    i++;
  }
  return -1;
}
function rawEnd(src, from, name) {
  const re = new RegExp('</' + name + '[\\s/>]', 'ig'); re.lastIndex = from;
  const m = re.exec(src); return m ? m.index : -1;
}

/** Parse one document. Returns {issues:[{line,kind,msg}], ids:Map(id -> [{line,tag,text}]), scripts}. */
export function parseHtml(src, { lineBase = 1 } = {}) {
  const issues = [], ids = new Map(), stack = [];
  const ls = [0]; for (let k = 0; k < src.length; k++) if (src.charCodeAt(k) === 10) ls.push(k + 1);
  const L = pos => { let lo = 0, hi = ls.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ls[m] <= pos) lo = m; else hi = m - 1; } return lo + lineBase; };
  const issue = (pos, kind, msg) => issues.push({ line: L(pos), kind, msg });
  const top = () => stack[stack.length - 1];
  // namespace a start tag lands in: the nearest foreign element, unless an HTML integration
  // point (svg foreignObject / desc / title) sits between it and the top
  const ns = () => {
    for (let k = stack.length - 1; k >= 0; k--) {
      const e = stack[k];
      if (e.ns === 'svg' && (e.name === 'foreignobject' || e.name === 'desc' || e.name === 'title')) return 'html';
      if (e.ns) return e.ns;
    }
    return 'html';
  };
  const inScope = (name, extra) => {
    for (let k = stack.length - 1; k >= 0; k--) {
      const e = stack[k];
      if (e.name === name && !e.ns) return k;
      if ((SCOPE.has(e.name) && !e.ns) || (e.ns === 'svg' && (e.name === 'foreignobject' || e.name === 'desc' || e.name === 'title')) || (extra && extra.has(e.name))) return -1;
    }
    return -1;
  };
  const BUTTON = words('button');
  let lastP = null, scripts = 0;
  const pop = (k, endPos) => { while (stack.length > k) { const e = stack.pop(); if (e.id != null) record(e, endPos); } };
  function record(e, endPos) { ids.get(e.id).push({ line: L(e.pos), tag: e.name, text: src.slice(e.pos, endPos) }); }
  function closeImplied(k, pos, by) {
    for (let q = stack.length - 1; q > k; q--) { const e = stack[q]; if (!OPTIONAL_END.has(e.name) && !e.ns) issue(e.pos, 'unclosed', '<' + e.name + '> (line ' + L(e.pos) + ') is closed by ' + by + ' at line ' + L(pos)); }
    pop(k, pos);
  }
  function startTag(name, pos, end, attrs, selfClose) {
    const id = attrs.get('id');
    if (ns() !== 'html') {
      const foreignTop = top();
      if (BREAKOUT.has(name) || (name === 'font' && (attrs.has('color') || attrs.has('face') || attrs.has('size')))) {
        issue(pos, 'breakout', '<' + name + '> inside <' + foreignTop.name + '> breaks out of the <' + (foreignTop.ns) + '>: the parser closes it there');
        while (stack.length && top().ns && !(top().ns === 'svg' && (top().name === 'foreignobject' || top().name === 'desc' || top().name === 'title'))) pop(stack.length - 1, pos);
      } else {
        if (id != null && !ids.has(id)) ids.set(id, []);
        const e = { name, pos, ns: ns(), id };   // "/>" closes a foreign element
        if (selfClose) { if (id != null) record(e, end); return; }
        stack.push(e); return;
      }
    }
    if (CLOSES_P.has(name)) { const k = inScope('p', BUTTON); if (k >= 0) { lastP = { pos: stack[k].pos, by: name, byPos: pos }; closeImplied(k, pos, '<' + name + '>'); } }
    if (/^h[1-6]$/.test(name) && top() && /^h[1-6]$/.test(top().name)) { issue(pos, 'nest', '<' + name + '> inside <' + top().name + '> closes it'); pop(stack.length - 1, pos); }
    if (name === 'li' || name === 'dt' || name === 'dd') {
      const sib = name === 'li' ? ['li'] : ['dt', 'dd'];
      for (let k = stack.length - 1; k >= 0; k--) { const e = stack[k]; if (sib.includes(e.name) && !e.ns) { closeImplied(k, pos, '<' + name + '>'); break; } if (SPECIAL.has(e.name) && !['address', 'div', 'p'].includes(e.name)) break; }
    }
    if (name === 'option' && top() && top().name === 'option') pop(stack.length - 1, pos);
    if (name === 'optgroup') { if (top() && top().name === 'option') pop(stack.length - 1, pos); if (top() && top().name === 'optgroup') pop(stack.length - 1, pos); }
    if (name === 'tr' || name === 'td' || name === 'th' || name === 'tbody' || name === 'thead' || name === 'tfoot') {
      const stopAt = name === 'tr' ? ['tbody', 'thead', 'tfoot', 'table'] : (name === 'td' || name === 'th') ? ['tr', 'tbody', 'thead', 'tfoot', 'table'] : ['table'];
      if (stack.some(e => e.name === 'table')) while (stack.length && !stopAt.includes(top().name) && ['tr', 'td', 'th', 'tbody', 'thead', 'tfoot', 'caption', 'colgroup'].includes(top().name)) pop(stack.length - 1, pos);
    }
    if (name === 'a' && stack.some(e => e.name === 'a' && !e.ns)) issue(pos, 'nest', '<a> inside <a>: the outer link is closed first');
    if (name === 'button') { const k = inScope('button'); if (k >= 0) { issue(pos, 'nest', '<button> inside <button>: the outer one is closed first'); pop(k, pos); } }
    if (name === 'form' && stack.some(e => e.name === 'form')) issue(pos, 'nest', 'a <form> inside a <form> is dropped');
    const t = top();
    if (t && !t.ns && TABLE_KIDS[t.name] && !TABLE_KIDS[t.name].has(name)) issue(pos, 'foster', '<' + name + '> directly inside <' + t.name + '> is moved out in front of the table');
    if (t && t.name === 'select' && !['option', 'optgroup', 'hr', 'script', 'template'].includes(name)) issue(pos, 'select', '<' + name + '> inside <select>');
    if (selfClose && !VOID.has(name) && name !== 'svg' && name !== 'math') issue(pos, 'selfclose', '<' + name + '/> is not a void element: the "/" is ignored and it stays open');
    if (id != null && !ids.has(id)) ids.set(id, []);
    if (VOID.has(name)) { if (id != null) record({ name, pos, id }, end); return; }
    if ((name === 'svg' || name === 'math') && selfClose) { if (id != null) record({ name, pos, id }, end); return; }
    stack.push({ name, pos, ns: name === 'svg' || name === 'math' ? name : null, id });
  }
  function endTag(name, pos, end) {
    if (VOID.has(name)) { issue(pos, 'endtag', 'end tag for the void element </' + name + '>'); return; }
    if (top() && top().ns) {
      // foreign content: close the nearest same-named element, case-insensitively
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === name) { for (let q = stack.length - 1; q > k; q--) issue(stack[q].pos, 'unclosed', '<' + stack[q].name + '> (line ' + L(stack[q].pos) + ') is closed by </' + name + '> at line ' + L(pos)); pop(k, end); return; }
        if (!stack[k].ns) break;
      }
    }
    if (name === 'p') {
      const k = inScope('p', BUTTON);
      if (k < 0) { issue(pos, 'strayp', 'stray </p>: the parser inserts an empty <p></p> here' + (lastP ? ' (the <p> at line ' + L(lastP.pos) + ' was already closed by <' + lastP.by + '> at line ' + L(lastP.byPos) + ')' : '')); return; }
      closeImplied(k, pos, '</p>'); return;
    }
    for (let k = stack.length - 1; k >= 0; k--) {
      const e = stack[k];
      if (e.name === name && !e.ns) {
        if (FORMATTING.has(name) && stack.slice(k + 1).some(x => SPECIAL.has(x.name))) issue(pos, 'misnest', '</' + name + '> with a block still open inside it: the adoption agency splits the tree');
        closeImplied(k, end, '</' + name + '>');
        return;
      }
      if (!e.ns && (TABLE_PARTS.has(name) ? TABLE_SCOPE.has(e.name) : SCOPE.has(e.name))) break;
      if (SPECIAL.has(e.name) && !FORMATTING.has(name) && !SPECIAL.has(name)) { issue(pos, 'ignored', '</' + name + '> is ignored: <' + e.name + '> (line ' + L(e.pos) + ') is still open inside it'); return; }
    }
    issue(pos, 'stray', 'stray </' + name + '> (nothing open to close)');
  }

  const n = src.length; let i = 0;
  while (i < n) {
    const lt = src.indexOf('<', i); if (lt < 0) break;
    if (lt > i && top() && !top().ns && TABLE_KIDS[top().name] && /\S/.test(src.slice(i, lt))) issue(i, 'foster', 'text directly inside <' + top().name + '> is moved out in front of the table: ' + JSON.stringify(src.slice(i, lt).trim().slice(0, 40)));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      if (e < 0) { issue(lt, 'comment', 'unterminated comment: everything after it is commented out'); break; }
      const body = src.slice(lt + 4, e);
      if (body.startsWith('>') || body.startsWith('->') || /--!?>/.test(body)) issue(lt, 'comment', 'malformed comment');
      i = e + 3; continue;
    }
    if (/^<!doctype/i.test(src.slice(lt, lt + 9))) { i = src.indexOf('>', lt) + 1; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); if (ns() === 'html') issue(lt, 'cdata', 'CDATA in HTML content becomes a bogus comment'); i = e < 0 ? n : e + 3; continue; }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') { issue(lt, 'bogus', 'bogus comment ' + JSON.stringify(src.slice(lt, lt + 14))); i = src.indexOf('>', lt) + 1 || n; continue; }
    if (src[lt + 1] === '/') {
      const m = /^<\/([a-zA-Z][^\s/>]*)/.exec(src.slice(lt, lt + 80));
      const gt = src.indexOf('>', lt); i = gt < 0 ? n : gt + 1;
      if (!m) { issue(lt, 'endtag', src[lt + 2] === '>' ? 'empty end tag </>' : 'bogus end tag'); continue; }
      if (/\S/.test(src.slice(lt + m[0].length, gt).replace(/\//g, ''))) issue(lt, 'endtag', 'end tag </' + m[1].toLowerCase() + '> carries attributes');
      endTag(m[1].toLowerCase(), lt, i);
      continue;
    }
    if (!/[a-zA-Z]/.test(src[lt + 1] || '')) { i = lt + 1; continue; }   // a literal "<"
    // start tag and its attributes, per the tokenizer
    let j = lt + 1; while (j < n && !/[\s/>]/.test(src[j])) j++;
    const name = src.slice(lt + 1, j).toLowerCase();
    const attrs = new Map(); let selfClose = false;
    for (;;) {
      while (j < n && /\s/.test(src[j])) j++;
      if (j >= n) { issue(lt, 'eof', 'the file ends inside <' + name + '>'); break; }
      if (src[j] === '>') { j++; break; }
      if (src[j] === '/') { if (src[j + 1] === '>') { selfClose = true; j += 2; break; } issue(j, 'attr', 'stray "/" inside <' + name + '>'); j++; continue; }
      const a = j; if (src[j] === '=') j++;
      while (j < n && !/[\s/>=]/.test(src[j])) j++;
      const an = src.slice(a, j).toLowerCase();
      if (/["'<]/.test(an)) issue(a, 'attr', 'attribute name ' + JSON.stringify(an.slice(0, 40)) + ' in <' + name + '> (a quoting slip)');
      let k = j; while (k < n && /\s/.test(src[k])) k++;
      let val = '';
      if (src[k] === '=') {
        k++; while (k < n && /\s/.test(src[k])) k++;
        if (src[k] === '"' || src[k] === "'") {
          const q = src[k], e = src.indexOf(q, k + 1);
          if (e < 0) { issue(k, 'attr', 'unterminated ' + q + ' value for ' + an + ' in <' + name + '>'); j = n; break; }
          val = src.slice(k + 1, e); j = e + 1;
          if (j < n && !/[\s/>]/.test(src[j])) issue(j, 'attr', 'no space after ' + an + '=' + q + '…' + q + ' in <' + name + '> (next: ' + JSON.stringify(src.slice(j, j + 16)) + ')');
        } else if (src[k] === '>') { issue(k, 'attr', 'missing value after ' + an + '= in <' + name + '>'); j = k; }
        else {
          let e = k; while (e < n && !/[\s>]/.test(src[e])) e++;
          val = src.slice(k, e); j = e;
          if (/["'<=`]/.test(val)) issue(k, 'attr', 'unquoted value ' + JSON.stringify(val.slice(0, 40)) + ' for ' + an + ' in <' + name + '>');
        }
      }
      if (attrs.has(an)) issue(a, 'dupattr', 'duplicate ' + an + '="…" on <' + name + '>: the parser drops the second');
      else attrs.set(an, val);
    }
    i = j;
    startTag(name, lt, j, attrs, selfClose);
    const t = top();
    if (t && t.pos === lt && !t.ns && (RAWTEXT.has(name) || RCDATA.has(name))) {
      const close = name === 'script' ? scriptEnd(src, i) : rawEnd(src, i, name);
      if (close < 0) { issue(lt, 'eof', '<' + name + '> is never closed: the rest of the file is its text'); i = n; break; }
      if (name === 'script') scripts++;
      i = src.indexOf('>', close) + 1 || n;
      pop(stack.length - 1, i);
    }
  }
  for (const e of stack) if (!OPTIONAL_END.has(e.name) && (!e.ns || e.name === 'svg' || e.name === 'math')) issue(e.pos, 'unclosed', '<' + e.name + '> is never closed');
  return { issues, ids, scripts };
}

/** Differing duplicate ids (identical copies are fine). */
export function idClashes(ids) {
  const clash = [], copies = [];
  for (const [id, list] of ids) {
    if (list.length < 2) continue;
    if (list.every(x => x.text === list[0].text)) copies.push(id);
    else clash.push(id + ' x' + list.length + ' (<' + list[0].tag + '> at lines ' + list.map(x => x.line).slice(0, 5).join(', ') + ')');
  }
  return { clash, copies };
}

/** Locate the gallery templates and check each ends where its text says it does. */
export function templates(html) {
  const out = [], re = /<script\b[^>]*\btype="text\/html"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const idm = /\bid="([^"]+)"/.exec(m[0]);
    const start = m.index + m[0].length, end = scriptEnd(html, start);
    const naive = html.toLowerCase().indexOf('</script', start);
    const close = end < 0 ? -1 : html.indexOf('>', end) + 1;
    // a template is followed by the next <script> (or a comment, or </body>): anything else is the
    // rest of a template that ended early, now parsed as live shell markup
    const rest = close < 0 ? '' : html.slice(close, close + 400).replace(/^\s+/, '');
    const leaked = close >= 0 && rest && !/^<(script\b|!--|\/body\b)/i.test(rest) ? rest.slice(0, 60) : '';
    out.push({ id: idm ? idm[1] : '(no id)', start, end, endsWhereItReads: end === naive, leaked,
      text: end < 0 ? '' : html.slice(start, end).split('<\\/script').join('</script') });
    re.lastIndex = close < 0 ? html.length : close;
  }
  return out;
}

function island(html, id) {
  // the real island is the application/json one (the AI banner comment names the catalog too)
  const open = new RegExp('<script\\b[^>]*\\btype="application/json"[^>]*\\bid="' + id + '"[^>]*>', 'i').exec(html);
  if (!open) return { error: 'missing' };
  const s = open.index + open[0].length, e = scriptEnd(html, s);
  if (e < 0) return { error: 'never closed' };
  try { return { value: JSON.parse(html.slice(s, e).split('<\\/script').join('</script')) }; }
  catch (err) { return { error: 'JSON: ' + err.message }; }
}

export function run(file) {
  const html = readFileSync(file, 'utf8');
  const lineAt = (() => { const ls = [0]; for (let k = 0; k < html.length; k++) if (html.charCodeAt(k) === 10) ls.push(k + 1); return pos => { let lo = 0, hi = ls.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ls[m] <= pos) lo = m; else hi = m - 1; } return lo + 1; }; })();
  const checks = [];
  const add = (group, name, ok, detail, note) => checks.push({ group, name, ok: !!ok, detail: ok ? undefined : detail, note });
  // the shell document (templates and islands are script text to it)
  const shell = parseHtml(html);
  add('shell', 'the shell document parses without a repair', !shell.issues.length, shell.issues.slice(0, 8).map(x => x.line + ' ' + x.kind + ': ' + x.msg));
  const sh = idClashes(shell.ids);
  add('shell', 'no two shell elements share an id', !sh.clash.length && !sh.copies.length, sh.clash.concat(sh.copies));
  // templates
  const T = templates(html);
  add('templates', T.length + ' gallery templates found', T.length > 0, 'none');
  const ends = T.filter(t => !t.endsWhereItReads || t.end < 0).map(t => t.id + (t.end < 0 ? ' never closes' : ' ends at line ' + lineAt(t.end) + ', not at its first </script>'));
  add('templates', 'every template ends where its text says (no escape-state swallow)', !ends.length, ends);
  const leaks = T.filter(t => t.leaked).map(t => t.id + ': ' + JSON.stringify(t.leaked));
  add('templates', 'nothing leaks between templates into the shell (no </script> breakout)', !leaks.length, leaks);
  const struct = [], clashes = [], copyNotes = [];
  for (const t of T) {
    const r = parseHtml(t.text, { lineBase: lineAt(t.start) });
    r.issues.forEach(x => struct.push(t.id + ' line ' + x.line + ' ' + x.kind + ': ' + x.msg));
    const c = idClashes(r.ids);
    c.clash.forEach(x => clashes.push(t.id + ': ' + x));
    if (c.copies.length) copyNotes.push(t.id + ' ' + c.copies.length + ' (' + c.copies.slice(0, 3).join(', ') + (c.copies.length > 3 ? ', …' : '') + ')');
  }
  add('templates', 'every template parses without a repair (structure, nesting, attributes)', !struct.length, struct.slice(0, 15).concat(struct.length > 15 ? ['… ' + (struct.length - 15) + ' more'] : []));
  add('templates', 'no two differing elements share an id within a template', !clashes.length, clashes.slice(0, 10),
    copyNotes.length ? 'identical self-contained copies (fine): ' + copyNotes.join('; ') : undefined);
  // islands vs catalog/manifest.json
  const cat = island(html, 'prism-catalog'), dates = island(html, 'prism-facet-dates');
  add('islands', '#prism-catalog parses', !cat.error, cat.error);
  add('islands', '#prism-facet-dates parses', !dates.error, dates.error);
  const mf = resolve(dirname(file), 'catalog/manifest.json');
  if (cat.value && existsSync(mf)) {
    const m = JSON.parse(readFileSync(mf, 'utf8')), c = cat.value, bad = [];
    if (c.count !== c.effects.length) bad.push('island count ' + c.count + ' != its ' + c.effects.length + ' effects');
    if (c._ai && c._ai.count != null && c._ai.count !== c.count) bad.push('_ai.count ' + c._ai.count + ' != count ' + c.count);
    if (c.count !== m.count) bad.push('count: island ' + c.count + ', manifest ' + m.count);
    if (c.effects.length !== m.effects.length) bad.push('effects: island ' + c.effects.length + ', manifest ' + m.effects.length);
    if ((c.categories || []).length !== (m.categories || []).length) bad.push('categories: island ' + (c.categories || []).length + ', manifest ' + (m.categories || []).length);
    const mg = Object.fromEntries((m.galleries || []).map(g => [g.id, g.count]));
    if ((c.galleries || []).length !== (m.galleries || []).length) bad.push('galleries: island ' + c.galleries.length + ', manifest ' + m.galleries.length);
    const per = {}; c.effects.forEach(e => { per[e.gallery] = (per[e.gallery] || 0) + 1; });
    (c.galleries || []).forEach(g => {
      if (mg[g.id] !== g.count) bad.push(g.id + ': island says ' + g.count + ', manifest ' + mg[g.id]);
      if (per[g.id] !== g.count) bad.push(g.id + ': island says ' + g.count + ' but holds ' + (per[g.id] || 0));
    });
    const ki = Object.keys(c.initializers || {}).sort().join(','), km = Object.keys(m.initializers || {}).sort().join(',');
    if (ki !== km) bad.push('initializers: island ' + ki + ' / manifest ' + km);
    const a = new Set(c.effects.map(e => e.id)), b = new Set(m.effects.map(e => e.id));
    const onlyA = [...a].filter(x => !b.has(x)), onlyB = [...b].filter(x => !a.has(x));
    if (a.size !== c.effects.length) bad.push((c.effects.length - a.size) + ' duplicate effect ids in the island');
    if (onlyA.length || onlyB.length) bad.push('ids only in the island: ' + onlyA.slice(0, 4).join(', ') + ' / only in the manifest: ' + onlyB.slice(0, 4).join(', '));
    add('islands', 'catalog island agrees with catalog/manifest.json (' + c.count + ' effects, ' + c.galleries.length + ' galleries)', !bad.length, bad.slice(0, 10));
  }
  const df = resolve(dirname(file), 'catalog/facet-dates.json');
  if (dates.value && existsSync(df)) {
    const d = JSON.parse(readFileSync(df, 'utf8'));
    const ni = Object.keys(dates.value.facets || {}).length, nf = Object.keys(d.facets || {}).length;
    add('islands', 'dates island matches catalog/facet-dates.json (' + ni + ' facets)', ni === nf && dates.value.generated === d.generated,
      { island: { facets: ni, generated: dates.value.generated }, file: { facets: nf, generated: d.generated } });
  }
  return checks;
}

// ---------------------------------------------------------------- self-test
// The parser against planted defects (each must be reported with its kind) and clean markup
// that leans on the rules (optional end tags, svg self-closing, integration points) that
// must come back clean.
export function selfTest() {
  const cases = [
    ['clean', '<div><p>a<p>b</p><ul><li>a<li>b</ul><svg><path d=""/><g><rect/></g><foreignObject><div>x</div></foreignObject><title>t</title><desc>d</desc></svg><table><tr><td>1<td>2</table><select><option>a<option>b</select></div>', []],
    ['unclosed span', '<div><span>a</div>', ['unclosed']],
    ['stray div', '<div></div></div>', ['stray']],
    ['block in p', '<p>a<div>b</div></p>', ['strayp']],
    ['nested a', '<a href=x><a href=y>b</a></a>', ['nest']],
    ['html in svg', '<svg><text><span>x</span></text></svg>', ['breakout']],
    ['duplicate attribute', '<text style="a" x="1" style="b">t</text>', ['dupattr']],
    ['no space', '<i class="a"id="b"></i>', ['attr']],
    ['self-closed div', '<div/><p>x</p>', ['selfclose', 'unclosed']],
    ['div in table', '<table><div>x</div><tr><td>a</td></tr></table>', ['foster']],
    ['span closes over div', '<span><div>x</span></div>', ['ignored']],
    ['double-escaped script', '<script>var a="<!--<script>";</script><div></div>', ['eof']],
  ];
  const res = [];
  for (const [name, src, want] of cases) {
    const got = [...new Set(parseHtml(src).issues.map(x => x.kind))];
    const ok = want.length ? want.every(k => got.includes(k)) : !got.length;
    res.push({ group: 'self-test', name: name + (want.length ? ' -> ' + want.join(', ') : ' -> nothing'), ok, detail: ok ? undefined : got });
  }
  // template level: a breakout, an escape-state swallow, a differing id clash and an identical copy
  const doc = (tpl) => '<!DOCTYPE html><html><head></head><body><script type="text/html" id="pg-a">' + tpl + '</script>\n<script type="text/html" id="pg-b"><p>ok</p></script></body></html>';
  const t1 = templates(doc('<p>x</p><script>var s=1;</script><p>leaked</p>'));
  res.push({ group: 'self-test', name: 'a raw </script> inside a template is a breakout', ok: t1.some(t => t.leaked) });
  const t2 = templates(doc('<!-- note <script> --><p>x</p>'));
  res.push({ group: 'self-test', name: 'the escape states are honoured ("<!--" "<script" "-->" closes normally)', ok: t2.length === 2 && t2.every(t => t.endsWhereItReads && !t.leaked) });
  const t3 = templates(doc('<!-- <script> <p>x</p>'));
  res.push({ group: 'self-test', name: 'an unclosed "<!--" + "<script" swallows the template\'s own </script>', ok: t3.some(t => !t.endsWhereItReads) });
  const c = idClashes(parseHtml('<svg><symbol id="s"><path d="M0"/></symbol></svg><svg><symbol id="s"><path d="M0"/></symbol></svg><i id="x">1</i><i id="x">2</i>').ids);
  res.push({ group: 'self-test', name: 'differing ids clash, identical copies do not', ok: c.clash.length === 1 && /^x /.test(c.clash[0]) && c.copies.join() === 's', detail: c });
  return res;
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const JSON_OUT = argv.includes('--json');
  const file = resolve(opt('--file', process.env.PRISM_HTML || resolve(HERE, '../Prism.html')));
  const checks = argv.includes('--self-test') ? selfTest() : run(file);
  const failed = checks.filter(c => !c.ok);
  if (JSON_OUT) console.log(JSON.stringify({ ok: !failed.length, checks }, null, 2));
  else {
    for (const c of checks) {
      console.log((c.ok ? '  ok   ' : '  FAIL ') + c.group + ': ' + c.name + (c.ok || c.detail == null ? '' : '  -> ' + (typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail))));
      if (c.note) console.log('       note: ' + c.note);
    }
    console.log((failed.length ? 'FAIL' : 'PASS') + ': ' + (checks.length - failed.length) + '/' + checks.length + ' checks passed');
  }
  process.exit(failed.length ? 1 : 0);
}
