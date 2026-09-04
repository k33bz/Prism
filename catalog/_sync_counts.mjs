#!/usr/bin/env node
// Sync the root README's hand-maintained numbers from catalog/manifest.json
// (which extract-from-prism.mjs regenerates from the live gallery). Run after
// adding/removing facets:  node catalog/_sync_counts.mjs
//
// Counts are the HONEST totals - every facet in the catalog counts as one.
// The README historically froze Spectrums at its pre-theme-pack 266 in the
// hero number (1,670 vs the catalog's 2,670), which is not derivable from
// any data and caused doc drift twice. Pass --legacy-spectrums=266 to keep
// that convention instead.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const legacyArg = process.argv.find(a => a.startsWith('--legacy-spectrums='));
const legacySpectrums = legacyArg ? Number(legacyArg.split('=')[1]) : null;

const manifest = JSON.parse(readFileSync(join(root, 'catalog', 'manifest.json'), 'utf8'));
const items = Array.isArray(manifest) ? manifest : (manifest.effects || Object.values(manifest));
const perGallery = {};
for (const e of items) perGallery[e.gallery] = (perGallery[e.gallery] || 0) + 1;
const galleries = Object.keys(perGallery).length;
let total = items.length;
if (legacySpectrums != null && perGallery.spectrums)
  total = total - perGallery.spectrums + legacySpectrums;
const fmt = n => n.toLocaleString('en-US');

const readmePath = join(root, 'README.md');
let s = readFileSync(readmePath, 'utf8');
const before = s;
const sub = (re, repl, label) => {
  if (!re.test(s)) { console.warn(`WARN: pattern not found: ${label}`); return; }
  s = s.replace(re, repl);
};

// shields.io badges (served via GitHub's camo proxy; numbers live in the URL)
sub(/effects-\d+-/g, `effects-${total}-`, 'effects badge');
sub(/galleries-\d+-/g, `galleries-${galleries}-`, 'galleries badge');
// hero sentence: "a whole design library of **N** offline, self-contained..."
sub(/\*\*[\d,]+\*\* offline, self-contained/, `**${fmt(total)}** offline, self-contained`, 'hero count');
// galleries table: each cell links galleries/<g>.md and carries <sub>N effects</sub>
for (const [g, n] of Object.entries(perGallery)) {
  const re = new RegExp(`(galleries/${g}\\.md[^]*?<sub>)[\\d,]+( effects)`, '');
  sub(re, `$1${fmt(n)}$2`, `table count for ${g}`);
}

if (s === before) {
  console.log(`README already in sync (total ${fmt(total)}, ${galleries} galleries).`);
} else {
  writeFileSync(readmePath, s);
  console.log(`README updated: total ${fmt(total)}, ${galleries} galleries,` +
    (legacySpectrums != null ? ` spectrums held at legacy ${legacySpectrums}.` : ' honest spectrums count.'));
}
