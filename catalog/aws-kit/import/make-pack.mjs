// make-pack.mjs: the Prism icon store as an Iconify JSON icon pack for Mermaid (k33bz fork). No deps.
// toMermaid() writes icons as aws:<key>, where <key> is the store id without "aws-": svc-lambda,
// res-users, grp-region, cat-compute. The svc-/res-/grp-/cat- prefixes keep keys unique (flattening ids to
// bare names collides: cloud9, ec2-auto-scaling, management-console and shield exist as both a service and
// a resource icon). Colorway pairs get the base key with the light artwork (Mermaid's default theme) and
// <key>-dark with the dark one.
//
//   node catalog/aws-kit/import/make-pack.mjs [--out <file>]   -> catalog/aws-icons/aws-mermaid-pack.json
//
// Use it in a page:   mermaid.registerIconPacks([{ name: 'aws', icons: <the JSON> }]);
// fromMermaid() reads aws:svc-*/aws:res-* keys back to the exact icon ids.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.resolve(HERE, '..', '..', 'aws-icons', 'aws-icons.json');
export const PACK = path.resolve(HERE, '..', '..', 'aws-icons', 'aws-mermaid-pack.json');

export function makePack(store = JSON.parse(fs.readFileSync(STORE, 'utf8'))) {
  const icons = store.icons;
  const pack = { prefix: 'aws', info: { name: 'AWS Architecture Icons (Prism store)', license: { title: 'AWS Architecture Icons terms', url: 'https://aws.amazon.com/architecture/icons/' } }, icons: {}, width: 64, height: 64 };
  const has = (id) => Object.hasOwn(icons, id);
  for (const id of Object.keys(icons).sort()) {
    const m = id.match(/^aws-(svc|res|grp|cat)-(.+)$/);
    if (!m) continue;
    let key = `${m[1]}-${m[2]}`;
    const base = id.replace(/-(dark|light)$/, '');
    const pair = base !== id && has(base + '-dark') && (has(base + '-light') || has(base));
    if (pair) key = id.endsWith('-dark') ? `${base.replace(/^aws-/, '')}-dark` : base.replace(/^aws-/, '');
    const [, , w, h] = String(icons[id].viewBox || '0 0 64 64').split(/\s+/).map(Number);
    if (pack.icons[key]) throw new Error(`pack key collision: ${key} (${id})`);
    pack.icons[key] = { body: icons[id].svg, ...(w !== 64 ? { width: w } : {}), ...(h !== 64 ? { height: h } : {}) };
  }
  return pack;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const out = i > 0 ? path.resolve(process.argv[i + 1]) : PACK;
  const pack = makePack();
  const text = JSON.stringify(pack);
  fs.writeFileSync(out, text + '\n');
  console.log(`wrote ${path.relative(process.cwd(), out)}: ${Object.keys(pack.icons).length} icons, ${text.length} bytes`);
}
