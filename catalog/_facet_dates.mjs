/* Derive per-facet dates from git history and embed them into Prism.html (no deps).
   ----------------------------------------------------------------------------
   The gallery tiles carry no timestamps: `is-new` / `is-fixed` are hand-applied
   badges. This script walks every commit that touched Prism.html (oldest first),
   tokenizes each page template's tiles, and records for every facet id:

     added    the date of the first commit the tile appears in
     updated  the date of the most recent commit that changed the tile's markup
              after it was added (null if never changed)
     author   handle of whoever authored the commit that introduced the facet
              (fork commits map to their handle, everything inherited maps to the
              upstream handle), so attribution needs no per-tile markup

   Ids are derived exactly like catalog/extract-from-prism.mjs does at runtime
   (data-fx-id, else <page>-<slug(name)>, with -2/-3 suffixes for duplicates in
   document order), so the map lines up with the #prism-catalog island. Pages that
   are not catalog galleries (idea, mobile, desktop) are included too, keyed by page.

   Writes catalog/facet-dates.json and (re)writes the
   <script type="application/json" id="prism-facet-dates"> island right after the
   catalog island, so the shell's New Facets page can filter by a day window.

   Usage: node catalog/_facet_dates.mjs          # honors PRISM_HTML for the embed target
   Tiles present in the working copy but not yet committed get no entry; the shell
   treats a missing entry as "added today" so uncommitted work shows as new. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const HTML = process.env.PRISM_HTML ? resolve(process.env.PRISM_HTML) : resolve(ROOT, 'Prism.html');
const OUT = resolve(HERE, 'facet-dates.json');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
// git author -> public handle. The history has two identities: the fork's own commits
// (k33bz) and everything inherited from upstream, which is attributed to the upstream
// repository's handle (crazy54). No personal names live here.
const FORK_HANDLES = { 'k33bz': 'k33bz' };
const UPSTREAM_HANDLE = 'crazy54';
const handleOf = name => FORK_HANDLES[name] || UPSTREAM_HANDLE;

const slug = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, ' ').trim();

// Split a Prism.html snapshot into its page templates: { pageId: unescapedHtml }.
function pages(src) {
  const out = {};
  const re = /<script type="text\/html" id="pg-([a-z0-9-]+)">/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    const end = src.indexOf('\n</script>', start);
    if (end < 0) continue;
    out[m[1]] = src.slice(start, end).split('<\\/script').join('</script');
    re.lastIndex = end;
  }
  return out;
}

// Tokenize tiles/panels in document order. A tile is a <div class="tile ..."> or
// <div class="panel ..."> and runs until its matching </div> (depth counted over
// <div ... > / </div> tokens; Prism tiles only nest divs and inline/SVG content).
function tiles(html) {
  const res = [];
  const open = /<div\b[^>]*class="(?:[^"]*\s)?(tile|panel)(?:\s[^"]*)?"[^>]*>/g;
  let m;
  while ((m = open.exec(html))) {
    const start = m.index;
    let depth = 0, i = start;
    const tok = /<div\b|<\/div>/g; tok.lastIndex = start;
    let t, end = -1;
    while ((t = tok.exec(html))) {
      depth += t[0] === '</div>' ? -1 : 1;
      if (depth === 0) { end = t.index + t[0].length; break; }
    }
    if (end < 0) break;
    const outer = html.slice(start, end);
    const fx = /data-fx-id="([^"]+)"/.exec(m[0]);
    // Name = text of the first .nm / .ptitle element (querySelector order), including
    // nested spans: walk to the matching close tag of that element's own tag name.
    const nm = /<([a-z0-9]+)\b[^>]*class="(?:[^"]*\s)?(?:nm|ptitle)(?:\s[^"]*)?"[^>]*>/i.exec(outer);
    let name = 'effect';
    if (nm) {
      const tag = nm[1].toLowerCase();
      const from = nm.index + nm[0].length;
      const tt = new RegExp(`<${tag}\\b|</${tag}>`, 'gi'); tt.lastIndex = from;
      let depth = 1, t2, close = -1;
      while ((t2 = tt.exec(outer))) { depth += t2[0][1] === '/' ? -1 : 1; if (depth === 0) { close = t2.index; break; } }
      name = text(close < 0 ? outer.slice(from) : outer.slice(from, close)) || 'effect';
    }
    res.push({ fxId: fx ? fx[1] : null, name, outer });
    open.lastIndex = end;
    // nested tiles are not a thing in Prism; skip the tile body to keep O(n)
  }
  return res;
}

// All <style> inner text of a page template, concatenated.
function pageCss(html) { let c = ''; const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi; let m; while ((m = re.exec(html))) c += '\n' + m[1]; return c; }
// Split a stylesheet into top-level rules ({selector or @-prelude}{body}), brace-matched
// so @media / @keyframes / @supports blocks stay whole.
function splitRules(css) {
  const out = []; let i = 0; const n = css.length;
  while (i < n) {
    if (css[i] === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (/\s/.test(css[i])) { i++; continue; }
    let j = i, depth = 0;
    while (j < n && !(css[j] === '{' && depth === 0) && !(css[j] === '}' && depth === 0)) {
      const c = css[j]; if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--; j++;
    }
    if (j >= n || css[j] !== '{') { i = j + 1; continue; }
    let k = j, d = 0;
    for (; k < n; k++) { if (css[k] === '{') d++; else if (css[k] === '}') { d--; if (d === 0) { k++; break; } } }
    out.push({ sel: css.slice(i, j).trim(), text: css.slice(i, k).replace(/\s+/g, ' ').trim() });
    i = k;
  }
  return out;
}
// The CSS a facet actually depends on: rules whose selector (or, for @media/@supports
// wrappers, whose body) references one of the facet's own classes, plus any @keyframes
// those rules animate. Mirrors how the runtime extractor / Copy matches CSS by class
// token, so a rework of a facet's rules (colors, keyframes, a @media block) changes its
// fingerprint and counts as an update — not only edits to the tile markup.
// Gallery-chrome classes every tile carries; excluded so a restyle of the shared tile
// frame does not flip every facet, and so a facet matches only its OWN rules.
const RESERVED = new Set(['tile', 'panel', 'stage', 'meta', 'nm', 'ptitle', 'ref', 'desc', 'copy', 'gallery', 'wrap', 'sec', 'head', 'bar', 'is-new', 'is-fixed']);

// Index a page's rules ONCE per commit so per-facet CSS lookup is cheap (the naive
// facet x rule x class scan is O(millions) on the 1.5k-facet spectrum page). byClass maps
// a class token to the rules that mention it anywhere (selector, or inside an @media/
// @supports body); kfByName maps a @keyframes name to its rule; animRefs[i] is the set of
// animation-name tokens rule i references (for pulling in the @keyframes it animates).
function cssIndex(rules) {
  const byClass = new Map(); const kfByName = new Map(); const animRefs = [];
  rules.forEach((r, i) => {
    const kf = /^@keyframes\s+([\w-]+)/i.exec(r.sel);
    if (kf) { kfByName.set(kf[1], i); return; }
    const cls = r.text.match(/\.[A-Za-z_][\w-]*/g);
    if (cls) for (const c of cls) { const n = c.slice(1); let s = byClass.get(n); if (!s) byClass.set(n, s = new Set()); s.add(i); }
    const anims = r.text.match(/animation(?:-name)?\s*:[^;}]*/g);
    if (anims) { const set = new Set(); anims.forEach(a => a.split(/[\s:,]+/).forEach(t => { if (/^[A-Za-z_][\w-]*$/.test(t)) set.add(t); })); animRefs[i] = set; }
  });
  return { rules, byClass, kfByName, animRefs };
}
// The CSS a facet depends on: rules referencing one of its own (non-chrome) classes, plus
// the @keyframes those rules animate. A rework of the facet's rules (colors, keyframes, a
// new @media block) changes this fingerprint and so counts as an update.
function facetCss(idx, classes) {
  if (!classes.size) return '';
  const picked = new Set(); const kf = new Set();
  for (const c of classes) { const s = idx.byClass.get(c); if (s) for (const i of s) picked.add(i); }
  for (const i of picked) { const a = idx.animRefs[i]; if (a) for (const t of a) kf.add(t); }
  for (const name of kf) { const i = idx.kfByName.get(name); if (i != null) picked.add(i); }
  return [...picked].map(i => idx.rules[i].text).sort().join('\n');
}

function snapshot(src) {
  const map = {};
  for (const [pid, html] of Object.entries(pages(src))) {
    const idx = cssIndex(splitRules(pageCss(html)));
    const seen = {};
    for (const t of tiles(html)) {
      let id = t.fxId || (pid + '-' + slug(t.name || 'effect'));
      if (seen[id]) { seen[id]++; id += '-' + seen[id]; } else seen[id] = 1;
      // Fingerprint = tile markup (release badges + whitespace normalized out) PLUS the
      // CSS the facet's own classes reference, so a CSS-only rework registers as an update.
      const classes = new Set();
      (t.outer.match(/class="([^"]*)"/g) || []).forEach(m => m.slice(7, -1).split(/\s+/).forEach(c => { if (c && !RESERVED.has(c)) classes.add(c); }));
      const norm = t.outer.replace(/\b(is-new|is-fixed)\b/g, '').replace(/\s+/g, ' ');
      map[id] = createHash('sha1').update(norm + '||' + facetCss(idx, classes)).digest('hex').slice(0, 12);
    }
  }
  return map;
}

const log = git('log', '--reverse', '--format=%H|%cI|%an', '--', 'Prism.html').trim().split('\n').filter(Boolean)
  .map(l => { const [sha, iso, an] = l.split('|'); return { sha, date: iso.slice(0, 10), author: handleOf(an) }; });
if (!log.length) { console.error('no history for Prism.html'); process.exit(1); }

// Bulk/mechanical migrations that rewrote many facets' CSS at once (the reduced-motion
// auto-inject) must NOT flood the "Updated" bucket. Listed commits re-baseline each
// facet's fingerprint silently: the change is absorbed (hash adopted) but updatedOn is
// NOT set, so only genuine reworks AFTER them count. Full SHAs (post history-rewrite).
const SKIP_UPDATE = new Set([
  'd575201f93139a018a358a2b54df76e6332b60cd', // a11y: auto-inject reduced-motion into every animated standalone facet
  '365306e39bf02aa0dba6f730c77bf313942afd15', // carry @media (reduced-motion/responsive) into standalone facet CSS
]);

const facets = {};   // id -> { added, updated, hash }
let n = 0;
for (const c of log) {
  const src = git('show', `${c.sha}:Prism.html`);
  const snap = snapshot(src);
  const skip = SKIP_UPDATE.has(c.sha);
  for (const [id, hash] of Object.entries(snap)) {
    const f = facets[id];
    if (!f) facets[id] = { added: c.date, updated: null, author: c.author, hash };
    else if (f.hash !== hash) { f.hash = hash; if (c.date !== f.added && !skip) f.updated = c.date; }
  }
  n++;
  process.stdout.write(`\r  ${n}/${log.length} commits · ${Object.keys(facets).length} facets`);
}
process.stdout.write('\n');

const out = {
  generated: new Date().toISOString(), commits: log.length, first: log[0].date, last: log[log.length - 1].date,
  facets: Object.fromEntries(Object.entries(facets).map(([id, f]) => [id, { added: f.added, updated: f.updated, author: f.author }])),
};
writeFileSync(OUT, JSON.stringify(out));
const addedByDate = {}; for (const f of Object.values(facets)) addedByDate[f.added] = (addedByDate[f.added] || 0) + 1;
console.log('added per commit date:', Object.entries(addedByDate).sort().map(([d, k]) => `${d}:${k}`).join('  '));
console.log('updated (ever):', Object.values(facets).filter(f => f.updated).length);
const byAuthor = {}; for (const f of Object.values(facets)) byAuthor[f.author] = (byAuthor[f.author] || 0) + 1;
console.log('by author:', Object.entries(byAuthor).map(([a, n]) => `${a}:${n}`).join('  '));

// Embed / refresh the dates island right after the catalog island.
if (existsSync(HTML)) {
  let html = readFileSync(HTML, 'utf8');
  const island = `<script type="application/json" id="prism-facet-dates">${JSON.stringify(out).replace(/<\//g, '<\\/')}</script>`;
  const re = /<script type="application\/json" id="prism-facet-dates">[\s\S]*?<\/script>/;
  if (re.test(html)) html = html.replace(re, () => island);
  else {
    // Anchor AFTER the catalog block's end marker: _embed-catalog.mjs regenerates
    // everything between the PRISM CATALOG start/end comments, so anything placed
    // inside that block (e.g. right after the catalog island) is wiped on re-embed.
    const endMarker = '<!-- ===== /PRISM CATALOG ===== -->';
    let end = html.indexOf(endMarker);
    if (end >= 0) end += endMarker.length;
    else {
      const at = html.indexOf('<script type="application/json" id="prism-catalog">');
      if (at < 0) { console.error('no #prism-catalog island to anchor on'); process.exit(1); }
      end = html.indexOf('</script>', at) + '</script>'.length;
    }
    html = html.slice(0, end) + '\n' + island + html.slice(end);
  }
  writeFileSync(HTML, html);
  console.log(`embedded #prism-facet-dates island (${(island.length / 1024).toFixed(0)} KB) -> ${HTML}`);
}
