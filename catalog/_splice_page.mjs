/* Splice (or re-splice) a drafted section into ANY gallery page template, bounded to
   that page. Complements _splice.mjs, whose anchors must be globally unique: here the
   anchor is the page's own tail (the last "gallery close, wrap close, <script>" run inside
   the <script type="text/html" id="pg-<page>"> template, whatever its indentation), so
   pages whose tail script is a copy of a shared helper (copyViz lives in ~10 templates)
   work too.

     node catalog/_splice_page.mjs <draftFile> <page>

   Idempotent: if the draft's first line (its <h3 class="sec">) is already present in
   the page, the old block (from that h3 to the end of its gallery div) is removed first,
   then the draft is inserted AFTER the last gallery's closing </div> and BEFORE the wrap's
   closing </div>. Escapes raw </script> closers inside the draft. Honors PRISM_HTML. Zero deps. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = process.env.PRISM_HTML ? resolve(process.env.PRISM_HTML) : resolve(HERE, '../Prism.html');
const [, , draftFile, page] = process.argv;
if (!draftFile || !page) { console.error('usage: node catalog/_splice_page.mjs <draftFile> <page>'); process.exit(1); }

let draft = readFileSync(resolve(HERE, draftFile), 'utf8').replace(/\n$/, '').replace(/<\/script\s*>/gi, '<\\/script>');
const firstLine = draft.split('\n')[0].trim();
if (!/^<h3 class="sec">/.test(firstLine)) { console.error('draft must start with its <h3 class="sec"> line'); process.exit(1); }

let html = readFileSync(HTML, 'utf8');
const open = `<script type="text/html" id="pg-${page}">`;
const a = html.indexOf(open); if (a < 0) { console.error('no template for page', page); process.exit(1); }
const b = html.indexOf('\n</script>', a);
let tpl = html.slice(a, b);

const at = tpl.indexOf(firstLine);
let action = 'Spliced';
if (at >= 0) {
  const gal = tpl.indexOf('<div class="gallery"', at);
  const end = tpl.indexOf('\n</div>', gal) + '\n</div>'.length;
  tpl = tpl.slice(0, at).replace(/\n+$/, '\n') + tpl.slice(end).replace(/^\n+/, '\n');
  action = 'Re-spliced';
}
const re = /(\n[ \t]*<\/div>)([ \t]*\n[ \t]*<\/div>[ \t]*\n+<script>)/g;
let m, cut = -1;
while ((m = re.exec(tpl))) cut = m.index + m[1].length;
if (cut < 0) { console.error('page tail not found'); process.exit(1); }
tpl = tpl.slice(0, cut) + '\n\n' + draft + '\n' + tpl.slice(cut);
console.log(`${action} section into pg-${page} (${draft.length} bytes)`);
html = html.slice(0, a) + tpl + html.slice(b);
writeFileSync(HTML, html);
