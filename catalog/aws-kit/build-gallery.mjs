// Assemble Prism's AWS Architecture gallery (the pg-aws template) from the kit. Re-runnable and
// deterministic; run it after any change to a family spec build, aws.css, the icon store or this file.
//   1. catalog/drafts/aws.body.html: the icon sprite (every icon in catalog/aws-icons/aws-icons.json as
//      a <symbol>, carrying name/kind/category metadata for the icon library) + the reading legend
//   2. catalog/drafts/icons.aws.html: the icon library section (from catalog/aws-kit/icon-library.html)
//   3. scaffolds pg-aws (catalog/_scaffold.mjs) and inserts it after pg-arch, or replaces it in place
//   4. splices the family drafts (catalog/drafts/<family>.aws.html, built by awd.mjs) in FAMILIES order,
//      then the icon library last
// Usage: node catalog/aws-kit/build-gallery.mjs [family,family,...]   (default: every built family)
// Honors PRISM_HTML like the other catalog tools.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAT = path.resolve(HERE, '..');
const DRAFTS = path.join(CAT, 'drafts');
const HTML = process.env.PRISM_HTML ? path.resolve(process.env.PRISM_HTML) : path.resolve(CAT, '..', 'Prism.html');

export const ID = 'aws';
export const TITLE = '☁️ AWS Architecture';
export const BLURB = 'Animated reference architectures drawn with the official AWS Architecture Icons: serverless, ' +
  'three-tier web, Active Directory and directory trusts, databases, multi-Region resilience, and VPC and hybrid ' +
  'networking. Numbered steps and traffic run on one clock per diagram; every icon is embedded once and the ' +
  'searchable icon library sits at the bottom.';
export const FAMILIES = ['serverless', 'three-tier', 'directory', 'databases', 'regions', 'vpc'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const node = (args) => {
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (r.status !== 0) process.exit(r.status || 1);
};

const want = process.argv[2] ? process.argv[2].split(',').map((s) => s.trim()).filter(Boolean) : null;
for (const f of want || []) if (!FAMILIES.includes(f)) { console.error(`unknown family "${f}" (known: ${FAMILIES.join(', ')})`); process.exit(1); }
// page order is always FAMILIES order, whatever order the list was given in
const families = FAMILIES.filter((f) => (!want || want.includes(f)) && fs.existsSync(path.join(DRAFTS, `${f}.aws.html`)));
if (want && families.length !== want.length) {
  console.error('not built yet: ' + want.filter((f) => !families.includes(f)).join(', ') + ' (run awd.mjs build first)');
  process.exit(1);
}

// ---- 1. body: sprite + legend ----
const store = JSON.parse(fs.readFileSync(path.join(CAT, 'aws-icons', 'aws-icons.json'), 'utf8'));
const release = (store.source.split(',')[1] || 'current release').trim();   // e.g. "Icon-package_07312026 (Q3 2026 release)"
const symbols = Object.entries(store.icons).map(([id, ic]) =>
  `<symbol id="${id}" viewBox="${ic.viewBox}" data-n="${esc(ic.name)}" data-k="${ic.kind}" data-c="${esc(ic.category)}"` +
  `${ic.service ? ` data-s="${esc(ic.service)}"` : ''}${ic.aliases ? ` data-a="${esc(ic.aliases.join('|'))}"` : ''}>${ic.svg}</symbol>`).join('');   // aliases may contain spaces
// Not display:none: gradients and clip paths inside a display:none sprite fail to paint through <use>.
const sprite = `<svg id="awd-sprite" data-prism-carry="aws-icons" xmlns="http://www.w3.org/2000/svg" width="0" height="0" ` +
  `style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false">${symbols}</svg>`;
const key = (svg, label, wide) =>
  `<span class="awd-key"><svg class="awd awd-k${wide ? ' awd-kw' : ''}" viewBox="${wide ? '0 0 34 12' : '0 0 14 14'}" aria-hidden="true">${svg}</svg>${label}</span>`;
const legend = `<div class="awd-legend" role="note" aria-label="How to read the diagrams">
  ${key('<circle class="pk" cx="7" cy="7" r="3.4"/>', 'Request')}
  ${key('<circle class="pk-2" cx="7" cy="7" r="3.4"/>', 'Response or replication')}
  ${key('<circle class="pk-bad" cx="7" cy="7" r="3.4"/>', 'Failed or blocked traffic')}
  ${key('<g class="st" transform="translate(7,7)"><circle r="6.5"/><text y="3">1</text></g>', 'Numbered step')}
  ${key('<path class="w" d="M2,6 H32"/>', 'Call or data path', true)}
  ${key('<path class="w w-d" d="M2,6 H32"/>', 'Asynchronous, optional or logical', true)}
  <span class="awd-src">Icons: official AWS Architecture Icons, ${esc(release)}, unmodified and embedded once in this page. Copy carries the icons a diagram uses. Dark and light colorways follow the theme; reduced motion shows the still diagram.</span>
</div>`;
fs.writeFileSync(path.join(DRAFTS, `${ID}.body.html`), sprite + '\n' + legend + '\n');

// ---- 2. icon library section ----
const files = Object.keys(store.icons).length;
const lib = fs.readFileSync(path.join(HERE, 'icon-library.html'), 'utf8')
  .replace(/\r\n?/g, '\n')
  .replace(/\{\{FILES\}\}/g, String(files))
  .replace(/\{\{SOURCE\}\}/g, esc(release));
fs.writeFileSync(path.join(DRAFTS, 'icons.aws.html'), lib);

// ---- 3. scaffold pg-aws and put it in place (after pg-arch the first time) ----
node([path.join(CAT, '_scaffold.mjs'), ID, TITLE, BLURB]);
const tpl = fs.readFileSync(path.join(DRAFTS, `${ID}.tpl.html`), 'utf8').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
let html = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');
const OPEN = '<script type="text/html" id="pg-';
const blockEnd = (start) => {
  // a template ends at the last "\n</script>" before the next template opens
  const next = html.indexOf('\n' + OPEN, start + 1);
  const end = html.lastIndexOf('\n</script>', next < 0 ? html.length : next);
  if (end < start) throw new Error('template end not found');
  return end + '\n</script>'.length;
};
const at = html.indexOf(`${OPEN}${ID}">`);
if (at >= 0) {
  html = html.slice(0, at) + tpl + html.slice(blockEnd(at));
  console.log(`replaced pg-${ID}`);
} else {
  const arch = html.indexOf(`${OPEN}arch">`);
  if (arch < 0) throw new Error('pg-arch not found');
  const end = blockEnd(arch);
  html = html.slice(0, end) + '\n\n' + tpl + html.slice(end);
  console.log(`inserted pg-${ID} after pg-arch`);
}
fs.writeFileSync(HTML, html);

// ---- 4. families in order, then the library ----
for (const f of families) node([path.join(CAT, '_splice_page.mjs'), `drafts/${f}.aws.html`, ID]);
node([path.join(CAT, '_splice_page.mjs'), 'drafts/icons.aws.html', ID]);

const size = fs.statSync(HTML).size;
console.log(`pg-${ID}: ${families.length} famil${families.length === 1 ? 'y' : 'ies'} (${families.join(', ') || 'none'}) + icon library (${files} icons); Prism.html ${(size / 1048576).toFixed(2)} MB`);
