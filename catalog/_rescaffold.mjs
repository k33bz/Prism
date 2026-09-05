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
// The template's own script closers are escaped (<\/script>), so the first raw
// "\n</script>" after the opener is the template's end.
const end = html.indexOf('\n</script>', start) + '\n</script>'.length;
const old = html.slice(start, end);
if (!old.endsWith('</html>\n</script>')) { console.error('Unexpected template tail; aborting.'); process.exit(1); }
html = html.slice(0, start) + tpl + html.slice(end);
writeFileSync(HTML, html);
console.log(`Replaced pg-${id}: ${old.length} -> ${tpl.length} bytes`);
