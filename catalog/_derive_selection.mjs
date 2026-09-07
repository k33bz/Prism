#!/usr/bin/env node
// Derive agent-facing selection metadata (role, dataShape, a11y) for every catalog
// facet, deterministically, from fields that already exist (componentType, gallery,
// category, name, interaction, css). No LLM, no hand-authoring: the mapping lives in
// selection-vocab.json so it stays reviewable and gate-checkable.
//
//   node catalog/_derive_selection.mjs            # report only (distribution + samples)
//   node catalog/_derive_selection.mjs --write    # patch catalog/index.json + manifest.json in place
//   node catalog/_derive_selection.mjs --json      # emit the derived {id: fields} map as JSON
//
// Fields added per effect:
//   role         one of vocab.roles
//   dataShape    one of vocab.dataShapes (only for charts/maps/diagrams; else omitted)
//   a11y         { selfAnimates:bool, reducedMotionSafe:bool }
//
// selfAnimates      = interaction declares auto-play or on-load (moves without user action)
// reducedMotionSafe = no motion at all, OR the facet css carries a prefers-reduced-motion block

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VOCAB = JSON.parse(fs.readFileSync(path.join(HERE, 'selection-vocab.json'), 'utf8'));
const MANIFEST = path.join(HERE, 'manifest.json');
const INDEX = path.join(HERE, 'index.json');

const field = (e, on) => String(
  on === 'componentType' ? (e.componentType || '')
  : on === 'gallery' ? (e.gallery || '')
  : on === 'category' ? (e.category || '')
  : on === 'name' ? (e.name || '')
  : ''
);

function deriveRole(e) {
  for (const r of VOCAB.roleRules) {
    if (new RegExp(r.test, 'i').test(field(e, r.on))) return r.role;
  }
  const g = VOCAB.roleGalleryFallback[e.gallery];
  return g || VOCAB.roleDefault;
}

function deriveDataShape(e) {
  if (!VOCAB.dataShapeGalleries.includes(e.gallery)) return null;
  for (const r of VOCAB.dataShapeRules) {
    if (new RegExp(r.test, 'i').test(field(e, r.on))) return r.shape;
  }
  return VOCAB.dataShapeDefault;
}

function deriveA11y(e) {
  const interaction = String(e.interaction || '');
  const css = String(e.css || '');
  const html = String(e.html || '');
  // Ground motion in real evidence, not just the noisy `interaction` label: a facet
  // labelled auto-play/on-load that carries no CSS animation, no SVG SMIL, and no JS
  // initializer does not actually move (e.g. a static "stamp" styled toast).
  // Real animation only: a keyframe def, an animation shorthand/name with a value, or a
  // transition. A lone animation-delay/duration longhand (orphan CSS, no keyframes) is NOT motion.
  const cssMotion = /@keyframes|transition\s*:\s*[^;\s]|animation(-name)?\s*:\s*[^;\s]/.test(css);
  const hasMotion = cssMotion || /<animate/.test(html) || !!e.needsJs;
  const selfAnimates = /\b(auto-play|on-load)\b/.test(interaction) && hasMotion;
  const reducedMotionSafe = !hasMotion || /prefers-reduced-motion/.test(css);
  return { selfAnimates, reducedMotionSafe };
}

function derive(e) {
  const out = { role: deriveRole(e), a11y: deriveA11y(e) };
  const ds = deriveDataShape(e);
  if (ds) out.dataShape = ds;
  return out;
}

// ---- load (manifest has css+html; index is the lean catalog) ----
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const mEffects = Array.isArray(manifest) ? manifest : (manifest.effects || []);
const byId = new Map(mEffects.map(e => [e.id, e]));

const derived = new Map();
for (const e of mEffects) derived.set(e.id, derive(e));

const args = process.argv.slice(2);

if (args.includes('--json')) {
  process.stdout.write(JSON.stringify(Object.fromEntries(derived), null, 1));
  process.exit(0);
}

if (args.includes('--write')) {
  let patched = 0;
  const apply = (arr) => {
    for (const e of arr) {
      const d = derived.get(e.id);
      if (!d) continue;
      e.role = d.role;
      e.a11y = d.a11y;
      if (d.dataShape) e.dataShape = d.dataShape; else delete e.dataShape;
      patched++;
    }
  };
  // manifest
  apply(mEffects);
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  // index
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const iEffects = Array.isArray(index) ? index : (index.effects || []);
  apply(iEffects);
  fs.writeFileSync(INDEX, JSON.stringify(index, null, 2) + '\n');
  console.log(`wrote role/dataShape/a11y to ${patched} manifest + ${iEffects.length} index effects`);
  console.log('NOTE: re-embed the island next: node catalog/_embed-catalog.mjs');
  process.exit(0);
}

// ---- default: report ----
const tally = (fn) => {
  const m = {};
  for (const e of mEffects) { const v = fn(e); if (v == null) continue; m[v] = (m[v] || 0) + 1; }
  return m;
};
const show = (t) => Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${String(v).padStart(5)}  ${k}`).join('\n');

console.log('=== role distribution (all ' + mEffects.length + ') ===');
console.log(show(tally(e => derived.get(e.id).role)));

console.log('\n=== role x is-spectrum (spectrum bulk vs authored) ===');
const rs = {};
for (const e of mEffects) {
  const r = derived.get(e.id).role, k = e.spectrum ? 'spectrum' : 'authored';
  rs[r] = rs[r] || { spectrum: 0, authored: 0 }; rs[r][k]++;
}
for (const [r, c] of Object.entries(rs).sort((a, b) => (b[1].spectrum + b[1].authored) - (a[1].spectrum + a[1].authored)))
  console.log(`  ${r.padEnd(14)} authored ${String(c.authored).padStart(4)}  spectrum ${String(c.spectrum).padStart(5)}`);

console.log('\n=== dataShape distribution (charts/maps/diagrams only) ===');
console.log(show(tally(e => derived.get(e.id).dataShape)));

console.log('\n=== a11y ===');
let sa = 0, rms = 0, animNoSafe = 0;
for (const e of mEffects) {
  const a = derived.get(e.id).a11y;
  if (a.selfAnimates) sa++;
  if (a.reducedMotionSafe) rms++;
  if (a.selfAnimates && !a.reducedMotionSafe) animNoSafe++;
}
console.log(`  selfAnimates:        ${sa}`);
console.log(`  reducedMotionSafe:   ${rms}`);
console.log(`  self-animate & NOT reduced-motion-safe (agent should warn): ${animNoSafe}`);

// role fell through to gallery fallback / default (candidates to refine)
console.log('\n=== role via fallback (no componentType rule matched) — top componentTypes ===');
const fell = {};
for (const e of mEffects) {
  let matched = false;
  for (const r of VOCAB.roleRules) if (new RegExp(r.test, 'i').test(field(e, r.on))) { matched = true; break; }
  if (!matched) { const k = (e.componentType || '(none)') + ' @' + e.gallery; fell[k] = (fell[k] || 0) + 1; }
}
console.log(show(fell).split('\n').slice(0, 20).join('\n') || '  (none — every facet matched a componentType rule)');

// samples
console.log('\n=== samples (authored galleries) ===');
const samples = mEffects.filter(e => !e.spectrum).filter((_, i) => i % 90 === 0).slice(0, 14);
for (const e of samples) {
  const d = derived.get(e.id);
  console.log(`  ${e.id}`);
  console.log(`      gallery=${e.gallery} ct=${e.componentType} int="${e.interaction}"`);
  console.log(`      -> role=${d.role}${d.dataShape ? ' dataShape=' + d.dataShape : ''} a11y=${JSON.stringify(d.a11y)}`);
}
