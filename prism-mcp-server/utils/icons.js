// AWS Architecture Icons for the MCP: the icon store behind Prism's AWS Architecture gallery.
//
// Prism.html embeds every icon once, as a <symbol> in the gallery's #awd-sprite, each carrying its
// metadata (data-n name, data-k kind, data-c category, data-s service, data-a aliases joined by |).
// A store pointed at catalog/manifest.json reads catalog/aws-icons/aws-icons.json beside it instead.
// Same icons either way. Official colorway pairs (x-dark + x-light, or x-dark + x) are addressed by
// their base id, like the kit does, and resolve to the dark or light variant on request.

import fs from 'node:fs';
import path from 'node:path';

export const ICON_KINDS = ['service', 'resource', 'group', 'category'];
const KIND_RANK = { service: 0, resource: 1, group: 2, category: 3 };

const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function attr(attrs, name) {
  const m = attrs.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? unesc(m[1]) : null;
}

/** Parse the gallery sprite (#awd-sprite) out of Prism.html source. Map id -> icon, or null. */
export function parseSprite(html) {
  const at = html.indexOf('<svg id="awd-sprite"');
  if (at === -1) return null;
  const end = html.indexOf('</svg>', at);   // icon bodies never nest an <svg>
  if (end === -1) return null;
  const icons = new Map();
  const re = /<symbol id="([^"]+)" viewBox="([^"]+)"([^>]*)>([\s\S]*?)<\/symbol>/g;
  for (const [, id, viewBox, attrs, svg] of html.slice(at, end).matchAll(re)) {
    const aliases = attr(attrs, 'data-a');
    icons.set(id, {
      id,
      name: attr(attrs, 'data-n') || id,
      kind: attr(attrs, 'data-k') || '',
      category: attr(attrs, 'data-c') || '',
      service: attr(attrs, 'data-s'),
      aliases: aliases ? aliases.split('|').filter(Boolean) : [],
      viewBox,
      svg,
    });
  }
  return icons.size ? icons : null;
}

/** Normalize the durable store (catalog/aws-icons/aws-icons.json) into the same Map shape. */
export function parseIconStore(store) {
  const icons = new Map();
  for (const [id, ic] of Object.entries((store && store.icons) || {})) {
    icons.set(id, {
      id, name: ic.name || id, kind: ic.kind || '', category: ic.category || '',
      service: ic.service || null, aliases: ic.aliases || [], viewBox: ic.viewBox, svg: ic.svg,
    });
  }
  return icons.size ? icons : null;
}

/** Load the icons that belong with a catalog file. { source, icons } or null when there are none. */
export function loadIcons(catalogPath) {
  try {
    const ext = path.extname(catalogPath).toLowerCase();
    if (ext === '.html' || ext === '.htm') {
      const icons = parseSprite(fs.readFileSync(catalogPath, 'utf8'));
      if (icons) return { source: `${catalogPath} (#awd-sprite)`, icons };
    }
    const json = path.join(path.dirname(catalogPath), 'aws-icons', 'aws-icons.json');
    if (fs.existsSync(json)) {
      const icons = parseIconStore(JSON.parse(fs.readFileSync(json, 'utf8')));
      if (icons) return { source: json, icons };
    }
  } catch { /* unreadable or malformed: no icons */ }
  return null;
}

/** The official colorway pair an id belongs to: { base, dark, light } or null. */
export function colorwayPair(icons, id) {
  const base = id.replace(/-(dark|light)$/, '');
  const dark = icons.has(base + '-dark') ? base + '-dark' : null;
  const light = icons.has(base + '-light') ? base + '-light' : (dark && icons.has(base) ? base : null);
  return dark && light ? { base, dark, light } : null;
}

/**
 * Search by words over id, name, service, category and aliases (every word must match). Colorway
 * pairs collapse into one result keyed by the base id. Ranked: exact name or short id first, then
 * services, resources, groups, categories; shorter names first within a rank.
 */
export function searchIcons(icons, { query = '', kind = null, limit = 25, offset = 0 } = {}) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const q = words.join(' ');
  const seen = new Set();
  const hits = [];
  for (const ic of icons.values()) {
    const pair = colorwayPair(icons, ic.id);
    const key = pair ? pair.base : ic.id;
    if (seen.has(key)) continue;
    if (kind && ic.kind !== kind) continue;
    const hay = [key, ic.name, ic.service || '', ic.category, ...ic.aliases].join(' ').toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    seen.add(key);
    const exact = q && (ic.name.toLowerCase() === q || ic.name.toLowerCase().replace(/^(amazon|aws) /, '') === q ||
      key.replace(/^aws-(svc|res|grp|cat)-/, '') === words.join('-') || ic.aliases.includes(q));
    hits.push({
      rank: (exact ? 0 : 10) + (KIND_RANK[ic.kind] ?? 5),
      item: {
        id: key, name: ic.name, kind: ic.kind, category: ic.category,
        ...(ic.service ? { service: ic.service } : {}),
        ...(ic.aliases.length ? { aliases: ic.aliases } : {}),
        ...(pair ? { colorways: { dark: pair.dark, light: pair.light } } : {}),
      },
    });
  }
  hits.sort((a, b) => a.rank - b.rank || a.item.name.length - b.item.name.length || a.item.name.localeCompare(b.item.name));
  const items = hits.slice(offset, offset + limit).map((h) => h.item);
  return { total: hits.length, offset, count: items.length, items };
}

/** Near matches for an unknown id or phrase: icons matching ANY of its words, most words first. */
export function suggestIcons(icons, text, n = 5) {
  const words = String(text).toLowerCase().replace(/^aws-(svc|res|grp|cat)-/, '').replace(/-(dark|light)$/, '')
    .split(/[\s-]+/).filter((w) => w.length > 1);
  const scored = new Map();
  for (const w of words) {
    for (const it of searchIcons(icons, { query: w, limit: Infinity }).items) {
      const s = scored.get(it.id) || { it, hits: 0 };
      s.hits++;
      scored.set(it.id, s);
    }
  }
  return [...scored.values()]
    .sort((a, b) => b.hits - a.hits || (KIND_RANK[a.it.kind] ?? 5) - (KIND_RANK[b.it.kind] ?? 5) || a.it.name.length - b.it.name.length)
    .slice(0, n).map((s) => s.it.id);
}

/**
 * Resolve an id to one concrete icon. A colorway base id (or either variant) picks the requested
 * colorway: 'dark' = artwork for dark backgrounds, 'light' = for light backgrounds (default).
 */
export function resolveIcon(icons, id, colorway = 'light') {
  const pair = colorwayPair(icons, id);
  if (pair && (id === pair.base || !icons.has(id))) return icons.get(colorway === 'dark' ? pair.dark : pair.light) || null;
  return icons.get(id) || null;
}

/** Standalone SVG markup for an icon (artwork unmodified; only the outer element is added). */
export function iconSvg(icon, size = 48) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}" width="${size}" height="${size}" role="img" aria-label="${escAttr(icon.name)}">${icon.svg}</svg>`;
}

/** The icon as a <symbol> for a page sprite, referenced with <use href="#id">. */
export function iconSymbol(icon) {
  return `<symbol id="${icon.id}" viewBox="${icon.viewBox}">${icon.svg}</symbol>`;
}
