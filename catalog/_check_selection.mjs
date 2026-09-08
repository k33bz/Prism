#!/usr/bin/env node
// Gate: every facet in the shipped catalog island must carry valid agent-facing
// selection metadata, so search_effects role/dataShape/a11y filters never silently
// go stale. Validates Prism.html's <script id="prism-catalog"> island (what the MCP
// server actually serves) against catalog/selection-vocab.json.
//
//   node catalog/_check_selection.mjs            # gate: exit 1 on any violation
//   node catalog/_check_selection.mjs --warn     # also print a11y warnings (self-animate, not reduced-motion-safe)
//
// Checks, per effect:
//   role         present and in vocab.roles
//   a11y         object with boolean selfAnimates + reducedMotionSafe
//   dataShape    present + in vocab.dataShapes IFF gallery is a dataShape gallery; absent otherwise

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VOCAB = JSON.parse(fs.readFileSync(path.join(HERE, 'selection-vocab.json'), 'utf8'));
const HTML = path.resolve(HERE, '..', 'Prism.html');

const ISLAND_OPEN = '<script type="application/json" id="prism-catalog">';
function parseIsland(html) {
  const open = html.indexOf(ISLAND_OPEN);
  if (open === -1) throw new Error('prism-catalog island not found');
  const start = open + ISLAND_OPEN.length;
  const end = html.indexOf('</script>', start);
  const raw = html.slice(start, end).split('<\\/script').join('</script');
  return JSON.parse(raw);
}

const roles = new Set(VOCAB.roles);
const layers = new Set(VOCAB.layers);
const shapes = new Set(VOCAB.dataShapes);
const dsGalleries = new Set(VOCAB.dataShapeGalleries);

const catalog = parseIsland(fs.readFileSync(HTML, 'utf8'));
const effects = catalog.effects || [];
const errors = [];
const warnings = [];

for (const e of effects) {
  const at = `${e.id}`;
  if (!e.role) errors.push(`${at}: missing role`);
  else if (!roles.has(e.role)) errors.push(`${at}: role "${e.role}" not in vocab`);

  if (!e.layer) errors.push(`${at}: missing layer`);
  else if (!layers.has(e.layer)) errors.push(`${at}: layer "${e.layer}" not in vocab`);

  const a = e.a11y;
  if (!a || typeof a !== 'object') errors.push(`${at}: missing a11y`);
  else {
    if (typeof a.selfAnimates !== 'boolean') errors.push(`${at}: a11y.selfAnimates not boolean`);
    if (typeof a.reducedMotionSafe !== 'boolean') errors.push(`${at}: a11y.reducedMotionSafe not boolean`);
    if (a && a.selfAnimates && a.reducedMotionSafe === false) warnings.push(`${at} (${e.gallery}/${e.componentType})`);
  }

  const isDsGallery = dsGalleries.has(e.gallery);
  if (isDsGallery) {
    if (!e.dataShape) errors.push(`${at}: ${e.gallery} facet missing dataShape`);
    else if (!shapes.has(e.dataShape)) errors.push(`${at}: dataShape "${e.dataShape}" not in vocab`);
  } else if (e.dataShape) {
    errors.push(`${at}: dataShape set on non-chart gallery "${e.gallery}"`);
  }
}

const withRole = effects.filter((e) => e.role).length;
const withLayer = effects.filter((e) => e.layer).length;
const withShape = effects.filter((e) => e.dataShape).length;
console.log(`selection gate: ${effects.length} effects | role ${withRole} | layer ${withLayer} | dataShape ${withShape} | a11y ${effects.filter((e) => e.a11y).length}`);

if (process.argv.includes('--warn') && warnings.length) {
  console.log(`\n${warnings.length} facets self-animate WITHOUT a reduced-motion fallback (a11y follow-ups):`);
  for (const w of warnings) console.log('  - ' + w);
}

if (errors.length) {
  console.error(`\nFAIL: ${errors.length} selection violation(s):`);
  for (const e of errors.slice(0, 40)) console.error('  ✗ ' + e);
  if (errors.length > 40) console.error(`  … and ${errors.length - 40} more`);
  process.exit(1);
}
console.log('OK: every facet carries valid role + layer + a11y (and dataShape where applicable).');
