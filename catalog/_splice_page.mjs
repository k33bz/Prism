/* Splice (or re-splice) a drafted section into ANY gallery page template, bounded to
   that page. Complements _splice.mjs, whose anchors must be globally unique: here the
   anchor is the page's own tail (the last "gallery close, wrap close, <script>" run inside
   the <script type="text/html" id="pg-<page>"> template, whatever its indentation), so
   pages whose tail script is a copy of a shared helper (copyViz lives in ~10 templates)
   work too.

     node catalog/_splice_page.mjs <draftFile> <page>

   Every spliced section is wrapped in <!-- prism-section:<name> --> … <!-- /prism-section:<name> -->
   markers (name = the draft's file name). Re-splicing replaces the marked block wholesale, so a
   draft may end with <script> blocks (initializers, copy helpers) and still be replaced cleanly.
   Sections spliced before markers existed are recognised by their <h3 class="sec"> line and
   removed up to their gallery's closing </div> (legacy path).

   Insertion point: AFTER the last gallery's closing </div> and BEFORE the wrap's closing </div>
   + the page's trailing <script>, computed on the template with every marked section lifted
   out (so a section ending in scripts cannot confuse the tail match); marked sections are put
   back in their original order, then the new one. Drafts are normalised to LF. Escapes raw
   </script> closers. Honors PRISM_HTML. Zero deps. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = process.env.PRISM_HTML ? resolve(process.env.PRISM_HTML) : resolve(HERE, '../Prism.html');
const [, , draftFile, page] = process.argv;
if (!draftFile || !page) { console.error('usage: node catalog/_splice_page.mjs <draftFile> <page>'); process.exit(1); }

const name = basename(draftFile).replace(/\.html$/, '');
let draft = readFileSync(resolve(HERE, draftFile), 'utf8').replace(/\r\n?/g, '\n').replace(/\n$/, '').replace(/<\/script\s*>/gi, '<\\/script>');
const firstLine = draft.split('\n')[0].trim();
if (!/^<h3 class="sec">/.test(firstLine)) { console.error('draft must start with its <h3 class="sec"> line'); process.exit(1); }
const marked = `<!-- prism-section:${name} -->\n${draft}\n<!-- /prism-section:${name} -->`;

let html = readFileSync(HTML, 'utf8');
const open = `<script type="text/html" id="pg-${page}">`;
const a = html.indexOf(open); if (a < 0) { console.error('no template for page', page); process.exit(1); }
const b = html.indexOf('\n</script>', a);
let tpl = html.slice(a, b);

// 1. Lift out every marked section (keeping the others, in order); drop this section's old copy.
const others = [];
let action = 'Spliced';
tpl = tpl.replace(/\r?\n?<!-- prism-section:([^ ]+) -->[\s\S]*?<!-- \/prism-section:\1 -->/g, (m, n) => {
  if (n === name) { action = 'Re-spliced'; return ''; }
  others.push(m.replace(/^\r?\n/, ''));
  return '';
});
// 2. Legacy unmarked copy of this section: h3 … through its gallery's closing </div>.
const at = tpl.indexOf(firstLine);
if (at >= 0) {
  const gal = tpl.indexOf('<div class="gallery"', at);
  const end = tpl.indexOf('\n</div>', gal) + '\n</div>'.length;
  tpl = tpl.slice(0, at).replace(/\n+$/, '\n') + tpl.slice(end).replace(/^\n+/, '\n');
  action = 'Re-spliced';
}
// 3. Insertion point = just before the closing </div> of the page's main <div class="wrap">
// container (the sections live inside it), found by depth-counting so it is robust to whatever
// closing-div / whitespace shape the page's tail happens to have. Falls back to the old
// "gallery close, wrap close, <script>" tail regex for any page without a .wrap.
let cut = -1;
const wrapOpen = tpl.indexOf('<div class="wrap">');
if (wrapOpen >= 0) {
  const tok = /<div\b|<\/div>/g; tok.lastIndex = wrapOpen;
  let depth = 0, mt;
  while ((mt = tok.exec(tpl))) { depth += mt[0] === '</div>' ? -1 : 1; if (depth === 0) { cut = mt.index; break; } }
}
if (cut < 0) {
  const re = /(\r?\n[ \t]*<\/div>)([ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*<\/div>[ \t]*(?:\r?\n)+<script>)/g;
  let m; while ((m = re.exec(tpl))) cut = m.index + m[1].length;
}
if (cut < 0) { console.error('page tail not found'); process.exit(1); }
const block = others.concat([marked]).join('\n\n');
tpl = tpl.slice(0, cut) + '\n\n' + block + '\n' + tpl.slice(cut);
console.log(`${action} section "${name}" into pg-${page} (${draft.length} bytes${others.length ? `, ${others.length} other marked section(s) kept` : ''})`);
html = html.slice(0, a) + tpl + html.slice(b);
writeFileSync(HTML, html);
