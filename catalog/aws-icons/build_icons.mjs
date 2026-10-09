// Build Prism's AWS icon store from the official AWS Architecture Icons package.
// One size per icon (SVG scales): service 48, resource 48 (+ official Dark/Light colorways),
// group 32 (+ Dark), category 48. Artwork is NOT altered: only metadata is stripped, unreferenced
// Sketch layer ids are dropped, referenced ids (clipPath) are namespaced per icon, and coordinates
// are rounded to 2 decimals (sub-pixel at any practical render size).
// Prism metadata (aliases, short names, status, source-vocabulary crosswalks) comes from overlay.mjs and is
// merged in on every build, so a package refresh keeps it.
// Usage: node catalog/aws-icons/build_icons.mjs <unzipped Icon-package dir>  (writes aws-icons.json + aws-icons.svg here)
//        node catalog/aws-icons/build_icons.mjs --overlay-only   (re-applies overlay.mjs to the existing aws-icons.json:
//                                                                 no package needed, artwork and sprite untouched)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { META, XREF } from './overlay.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = HERE;   // writes aws-icons.json + aws-icons.svg next to this script

// ---- overlay: per-icon fields from META, xref names from XREF; object entries become store.rules. Idempotent:
// earlier overlay fields are dropped first, so overlay.mjs is the only source of this metadata.
const OVERLAY_FIELDS = ['short', 'aliases', 'status', 'endOfSupport', 'note', 'renamedTo', 'duplicateOf', 'primary', 'prefer', 'xref'];
function applyOverlay(store) {
  const icons = store.icons;
  const bad = [];
  // a colorway base id (aws-res-users, aws-grp-cloud) stands for every artwork of the pair
  const targets = (id) => [id, id + '-dark', id + '-light'].filter((v) => Object.hasOwn(icons, v));
  const need = (id, where) => { if (id && !targets(id).length) bad.push(`${where}: ${id}`); };
  for (const ic of Object.values(icons)) for (const f of OVERLAY_FIELDS) delete ic[f];
  for (const [id, meta] of Object.entries(META)) {
    need(id, 'META');
    for (const f of ['renamedTo', 'duplicateOf', 'primary']) need(meta[f], `META ${id}.${f}`);
    for (const v of targets(id)) Object.assign(icons[v], structuredClone(meta));
  }
  const rules = {};
  for (const [vocab, table] of Object.entries(XREF)) {
    for (const [name, v] of Object.entries(table)) {
      const ids = typeof v === 'string' ? [v] : [v.icon, ...Object.values(v.map || {}).map((m) => (typeof m === 'string' ? m : m.icon))];
      for (const id of ids) need(id, `XREF.${vocab} ${name}`);
      if (typeof v !== 'string') (rules[vocab] ||= {})[name] = v;
      // a plain id, or the default of a property pick, is that icon's name in the vocabulary
      const on = typeof v === 'string' ? v : (v.by && v.icon && !v.group && !v.role ? v.icon : null);
      for (const t of on ? targets(on) : []) ((icons[t].xref ||= {})[vocab] ||= []).push(name);
    }
  }
  if (bad.length) throw new Error('overlay.mjs names ids the icon store does not have:\n  ' + bad.join('\n  '));
  // stable key order: package fields, overlay fields, artwork last
  for (const [id, ic] of Object.entries(icons)) {
    for (const list of Object.values(ic.xref || {})) list.sort();
    const { viewBox, svg, ...rest } = ic;
    icons[id] = { ...rest, viewBox, svg };
  }
  const { name, source, note, count } = store;
  const overlay = 'Prism metadata from overlay.mjs: aliases, short names, status, crosswalks (xref, rules). Ids and artwork as AWS ships them.';
  return { name, source, note, count, overlay, rules, icons };
}
const overlaySummary = (store) => {
  const ics = Object.values(store.icons);
  const n = (f) => ics.filter((ic) => ic[f] != null).length;
  const xr = {};
  for (const ic of ics) for (const [v, l] of Object.entries(ic.xref || {})) xr[v] = (xr[v] || 0) + l.length;
  return `overlay (counts include both artworks of a colorway pair): aliases ${n('aliases')}, short ${n('short')}, status ${n('status')}, ` +
    `renamedTo ${n('renamedTo')}, duplicateOf ${n('duplicateOf')}; xref names ${JSON.stringify(xr)}; ` +
    `rules ${JSON.stringify(Object.fromEntries(Object.entries(store.rules).map(([k, v]) => [k, Object.keys(v).length])))}`;
};

if (process.argv[2] === '--overlay-only') {
  const file = path.join(OUT, 'aws-icons.json');
  const store = applyOverlay(JSON.parse(fs.readFileSync(file, 'utf8')));
  fs.writeFileSync(file, JSON.stringify(store));
  console.log(`aws-icons.json: ${store.count} icons, ${fs.statSync(file).size} bytes`);
  console.log(overlaySummary(store));
  process.exit(0);
}

const PKG = path.resolve(process.argv[2] || path.join(HERE, 'pkg'));   // unzipped AWS Icon-package dir
fs.mkdirSync(OUT, { recursive: true });

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  if (e.name === '__MACOSX' || e.name.startsWith('.')) return [];
  return e.isDirectory() ? walk(p) : [p];
});
const files = walk(PKG).filter((f) => f.endsWith('.svg'));

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const stripBrand = (s) => s.replace(/^(amazon|aws)-/, '');
const humanize = (s) => s.replace(/[-_]+/g, ' ').trim();

// classify + name each file
const picked = [];
for (const f of files) {
  const base = path.basename(f, '.svg');
  const famDir = path.relative(PKG, f).split(path.sep)[0];
  let m;
  if (famDir.startsWith('Architecture-Service-Icons')) {
    if (!(m = base.match(/^Arch_(.+)_48$/))) continue;
    const cat = path.relative(PKG, f).split(path.sep)[1].replace(/^Arch_/, '');
    picked.push({ f, kind: 'service', raw: m[1], category: humanize(cat), variant: null });
  } else if (famDir.startsWith('Resource-Icons')) {
    if (!(m = base.match(/^Res_(.+)_48(?:_(Dark|Light))?$/))) continue;
    const cat = path.relative(PKG, f).split(path.sep)[1].replace(/^Res_/, '');
    picked.push({ f, kind: 'resource', raw: m[1], category: humanize(cat), variant: m[2] ? m[2].toLowerCase() : null });
  } else if (famDir.startsWith('Architecture-Group-Icons')) {
    if (!(m = base.match(/^(.+)_32(?:_(Dark))?$/))) continue;
    picked.push({ f, kind: 'group', raw: m[1], category: 'Groups', variant: m[2] ? m[2].toLowerCase() : null });
  } else if (famDir.startsWith('Category-Icons')) {
    if (!(m = base.match(/^Arch-Category_(.+)_48$/))) continue;
    picked.push({ f, kind: 'category', raw: m[1], category: 'Categories', variant: null });
  }
}

const PREFIX = { service: 'svc', resource: 'res', group: 'grp', category: 'cat' };
const round = (s) => s.replace(/-?\d*\.\d+(?:e-?\d+)?/gi, (n) => {
  const r = Math.round(parseFloat(n) * 100) / 100;
  return String(r === 0 ? 0 : r).replace(/^(-?)0\./, '$1.');
});

function optimize(svg, slug) {
  const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1];
  let body = svg
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');
  // ids actually referenced (url(#x)); namespace those, drop the rest
  const refd = new Set([...body.matchAll(/url\(#([^)]+)\)/g)].map((x) => x[1]));
  body = body.replace(/\sid="([^"]*)"/g, (all, id) => (refd.has(id) ? ` id="${slug}-${slugify(id)}"` : ''));
  body = body.replace(/url\(#([^)]+)\)/g, (all, id) => `url(#${slug}-${slugify(id)})`);
  // round numeric attribute values that carry geometry
  body = body.replace(/\s(d|points|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|transform)="([^"]*)"/g,
    (all, a, v) => ` ${a}="${round(v)}"`);
  body = body
    .replace(/\sstroke="none" stroke-width="1"/g, ' stroke="none"')
    .replace(/\s+(L|C|M|Z|H|V|Q|A|S|T)\b/g, '$1')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .replace(/<(path|rect|circle|ellipse|polygon|polyline|line)([^>]*)><\/\1>/g, '<$1$2/>')
    .trim();
  return { vb, body };
}

// Resource files are "<Service>_<Resource>": slug as service-resource, without repeating the
// service ("aurora-instance", not "aurora-aurora-instance"); general icons have no service part.
function splitRes(raw) {
  const i = raw.indexOf('_');
  if (i < 0) return { slug: stripBrand(slugify(raw)), service: null, label: humanize(raw) };
  const svc = stripBrand(slugify(raw.slice(0, i)));
  const res = stripBrand(slugify(raw.slice(i + 1)));
  const slug = res === svc || res.startsWith(svc + '-') ? res : `${svc}-${res}`;
  return { slug, service: humanize(raw.slice(0, i)), label: humanize(raw.slice(i + 1)) };
}

const icons = {};
const collisions = [];
for (const p of picked) {
  const rs = p.kind === 'resource' ? splitRes(p.raw) : null;
  let slug = rs ? rs.slug : stripBrand(slugify(p.raw));
  let id = `aws-${PREFIX[p.kind]}-${slug}${p.variant ? '-' + p.variant : ''}`;
  if (icons[id]) { // keep both if two names collapse after brand-stripping
    const alt = `aws-${PREFIX[p.kind]}-${slugify(p.raw)}${p.variant ? '-' + p.variant : ''}`;
    collisions.push(`${id} <- ${p.raw} (renamed ${alt})`);
    id = alt;
  }
  const { vb, body } = optimize(fs.readFileSync(p.f, 'utf8'), id);
  icons[id] = {
    name: (rs ? rs.label : humanize(p.raw)).replace(/\bAws\b/g, 'AWS'),
    ...(rs && rs.service ? { service: rs.service } : {}),
    kind: p.kind,
    category: p.category,
    ...(p.variant ? { colorway: p.variant } : {}),
    viewBox: vb,
    svg: body,
  };
}

const sorted = Object.fromEntries(Object.entries(icons).sort(([a], [b]) => a.localeCompare(b)));
const store = applyOverlay({
  name: 'prism-aws-icons',
  source: 'AWS Architecture Icons, Icon-package_07312026 (Q3 2026 release), https://aws.amazon.com/architecture/icons/',
  note: 'Icons are AWS property, used to create architecture diagrams per AWS guidance. Artwork unmodified (metadata stripped, ids namespaced, coordinates rounded to 2 decimals).',
  count: Object.keys(sorted).length,
  icons: sorted,
});
fs.writeFileSync(path.join(OUT, 'aws-icons.json'), JSON.stringify(store));
const sprite = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' +
  Object.entries(sorted).map(([id, ic]) => `<symbol id="${id}" viewBox="${ic.viewBox}">${ic.svg}</symbol>`).join('') + '</svg>';
fs.writeFileSync(path.join(OUT, 'aws-icons.svg'), sprite);

const byKind = {};
for (const ic of Object.values(sorted)) byKind[ic.kind] = (byKind[ic.kind] || 0) + 1;
const rawBytes = picked.reduce((a, p) => a + fs.statSync(p.f).size, 0);
console.log('icons:', store.count, JSON.stringify(byKind));
console.log('raw selected bytes:', rawBytes, '| json:', fs.statSync(path.join(OUT, 'aws-icons.json')).size, '| sprite:', sprite.length);
console.log('collisions:', collisions.length ? collisions.join('; ') : 'none');
console.log('sample ids:', Object.keys(sorted).filter((k) => /lambda|dynamodb|directory|aurora-instance$|^aws-svc-rds|vpc|region|users|office|load-bal|identity-and|nat|internet-gateway|endpoint/.test(k)).join(' '));
console.log(overlaySummary(store));
