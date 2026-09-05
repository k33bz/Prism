/* Derive per-facet dates from git history and embed them into Prism.html (no deps).
   ----------------------------------------------------------------------------
   The gallery tiles carry no timestamps: `is-new` / `is-fixed` are hand-applied
   badges. This script walks every commit that touched Prism.html (oldest first),
   tokenizes each page template's tiles, and records for every facet id:

     added    the date of the first commit the tile appears in
     updated  the date of the most recent commit that changed the tile's markup
              after it was added (null if never changed)
     author   handle of whoever authored the commit that introduced the facet
              (git author name mapped through AUTHOR_HANDLES; unknown names pass
              through as-is), so attribution needs no per-tile markup

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
// git author name -> public handle. Upstream is crazy54 (Jeremy Hall); the fork is k33bz.
const AUTHOR_HANDLES = { 'Jeremy Hall': 'crazy54', 'k33bz': 'k33bz' };
const handleOf = name => AUTHOR_HANDLES[name] || name;

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

function snapshot(src) {
  const map = {};
  for (const [pid, html] of Object.entries(pages(src))) {
    const seen = {};
    for (const t of tiles(html)) {
      let id = t.fxId || (pid + '-' + slug(t.name || 'effect'));
      if (seen[id]) { seen[id]++; id += '-' + seen[id]; } else seen[id] = 1;
      // Hash markup with the release badges and whitespace normalized out, so a
      // badge toggle or reformat does not count as an update.
      const norm = t.outer.replace(/\b(is-new|is-fixed)\b/g, '').replace(/\s+/g, ' ');
      map[id] = createHash('sha1').update(norm).digest('hex').slice(0, 12);
    }
  }
  return map;
}

const log = git('log', '--reverse', '--format=%H|%cI|%an', '--', 'Prism.html').trim().split('\n').filter(Boolean)
  .map(l => { const [sha, iso, an] = l.split('|'); return { sha, date: iso.slice(0, 10), author: handleOf(an) }; });
if (!log.length) { console.error('no history for Prism.html'); process.exit(1); }

const facets = {};   // id -> { added, updated, hash }
let n = 0;
for (const c of log) {
  const src = git('show', `${c.sha}:Prism.html`);
  const snap = snapshot(src);
  for (const [id, hash] of Object.entries(snap)) {
    const f = facets[id];
    if (!f) facets[id] = { added: c.date, updated: null, author: c.author, hash };
    else if (f.hash !== hash) { f.hash = hash; if (c.date !== f.added) f.updated = c.date; }
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
