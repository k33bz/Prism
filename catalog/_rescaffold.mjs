/* Re-scaffold a drafts-built gallery and swap its pg-<id> template inside Prism.html.
   Use after editing catalog/drafts/<id>.body.html or <id>.css for a gallery that was
   already spliced (the first-time insert is the scaffold + splice pair).

   Usage: node catalog/_rescaffold.mjs <id> "<emoji> <Title>" "<blurb>"
   Honors PRISM_HTML like the other pipeline scripts. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = process.env.PRISM_HTML ? resolve(process.env.PRISM_HTML) : resolve(HERE, '../Prism.html');
const [, , id, titleFull, blurb] = process.argv;
if (!id || !titleFull) { console.error('Usage: node catalog/_rescaffold.mjs <id> "<emoji Title>" "<blurb>"'); process.exit(1); }

const r = spawnSync(process.execPath, [resolve(HERE, '_scaffold.mjs'), id, titleFull, blurb || ''], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status);

const tpl = readFileSync(resolve(HERE, 'drafts', id + '.tpl.html'), 'utf8').replace(/\n+$/, '');
let html = readFileSync(HTML, 'utf8');
const open = `<script type="text/html" id="pg-${id}">`;
const start = html.indexOf(open);
if (start < 0) { console.error(`No ${open} block in Prism.html — use _splice or insert it first.`); process.exit(1); }
// The block ends where the next page template begins (robust even if a draft left
// a raw </script> inside the template, which would otherwise truncate the search).
const nextOpen = html.indexOf('\n<script type="text/html" id="pg-', start + open.length);
const endTag = '\n</script>';
let end = html.lastIndexOf(endTag, nextOpen < 0 ? html.length : nextOpen);
if (end < start) { console.error('Could not find the template end; aborting.'); process.exit(1); }
end += endTag.length;
const old = html.slice(start, end);
if (!old.endsWith('</html>\n</script>')) { console.error('Unexpected template tail; aborting.'); process.exit(1); }
html = html.slice(0, start) + tpl + html.slice(end);
writeFileSync(HTML, html);
console.log(`Replaced pg-${id}: ${old.length} -> ${tpl.length} bytes`);
