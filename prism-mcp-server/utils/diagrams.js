// AWS Architecture diagrams for the MCP: builds diagram specs with the AWS kit
// (catalog/aws-kit/awd.mjs) and serves the gallery's own specs (catalog/aws-kit/json/*.json).
//
// The kit is found beside the catalog the server was pointed at: catalog/aws-kit/ next to
// Prism.html, or aws-kit/ next to catalog/manifest.json. It is imported on first use (plain ES
// modules, no dependencies), so the server stays dependency-free and builds with the same code,
// checks and icons as the gallery.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** The kit directory that belongs with a catalog file, or null when there is none. */
export function kitDir(catalogPath) {
  const dir = path.dirname(path.resolve(catalogPath));
  for (const d of [path.join(dir, 'aws-kit'), path.join(dir, 'catalog', 'aws-kit')]) {
    if (fs.existsSync(path.join(d, 'awd.mjs')) && fs.existsSync(path.join(d, 'spec.mjs'))) return d;
  }
  return null;
}

/** Import the kit: { dir, awd (generator), spec (schema + canonical form) }, or null when not found. */
export async function loadKit(catalogPath) {
  const dir = kitDir(catalogPath);
  if (!dir) return null;
  const [awd, spec] = await Promise.all(['awd.mjs', 'spec.mjs'].map((f) => import(pathToFileURL(path.join(dir, f)).href)));
  return { dir, awd, spec };
}

const fmt = (e) => `${e.path}: ${e.message}`;

/**
 * Build one diagram spec: schema check, the kit's input checks (checkSpec), then validation of the
 * markup. { id, svg (standalone document), html (the gallery's <svg class="awd">), errors, lint };
 * svg and html are null whenever errors is not empty. lint holds the layout findings
 * (catalog/aws-kit/lint.mjs): the drawing is returned with them, but the gallery build rejects
 * any of severity error.
 */
function buildOne(kit, d, opts) {
  const out = { id: d && typeof d === 'object' && typeof d.id === 'string' ? d.id : null, svg: null, html: null, errors: [], lint: [] };
  if (!d || typeof d !== 'object' || Array.isArray(d)) { out.errors.push('(root): a diagram must be an object'); return out; }
  out.errors.push(...kit.spec.validateDiagram(d).map(fmt));
  if (out.errors.length) return out;
  try {
    const html = kit.awd.diagram(d);
    out.errors.push(...kit.awd.validate(html));
    if (!out.errors.length) { out.html = html; out.svg = kit.awd.standalone(d, opts); out.lint = kit.awd.lint(d); }
  } catch (err) {
    out.errors.push(err.message);
  }
  return out;
}

/**
 * Lint one diagram spec: { id, errors (schema and input checks), findings, counts, clean }.
 * clean means no finding of severity error (the bar the gallery build applies).
 */
export function lintDiagram(kit, d) {
  const out = { id: d && typeof d === 'object' && typeof d.id === 'string' ? d.id : null, errors: [], findings: [], counts: { error: 0, warn: 0, info: 0 }, clean: false };
  if (!d || typeof d !== 'object' || Array.isArray(d)) { out.errors.push('(root): a diagram must be an object'); return out; }
  out.errors.push(...kit.spec.validateDiagram(d).map(fmt));
  if (out.errors.length) return out;
  try { out.findings = kit.awd.lint(d); } catch (err) { out.errors.push(err.message); return out; }
  for (const f of out.findings) out.counts[f.severity]++;
  out.clean = out.counts.error === 0;
  return out;
}

/**
 * Build a diagram, or every diagram of a family file ({ version, section, diagrams }). A family
 * returns { section, diagrams: [one result per diagram], errors } where errors collects the
 * family's own problems and each diagram's, prefixed with its id.
 */
export function buildDiagram(kit, spec, opts = {}) {
  if (!Array.isArray(spec.diagrams)) return buildOne(kit, spec, opts);
  const errors = kit.spec.validateFamily({ ...spec, diagrams: [] }).map(fmt);
  const seen = new Set();
  const diagrams = spec.diagrams.map((d, i) => {
    const r = buildOne(kit, d, opts);
    if (r.id != null && seen.has(r.id)) { r.errors.push(`id: duplicate diagram id ${r.id}`); r.svg = r.html = null; }
    seen.add(r.id);
    errors.push(...r.errors.map((e) => `${r.id || `diagrams[${i}]`}: ${e}`));
    return r;
  });
  return { section: spec.section || null, diagrams, errors };
}

/** Every gallery diagram spec: [{ family: { id, title }, version, file, spec }], from <kit>/json/*.json. */
export function diagramSpecs(dir) {
  const jdir = path.join(dir, 'json');
  if (!fs.existsSync(jdir)) return [];
  const out = [];
  for (const f of fs.readdirSync(jdir).filter((x) => x.endsWith('.json')).sort()) {
    const fam = JSON.parse(fs.readFileSync(path.join(jdir, f), 'utf8'));
    for (const d of fam.diagrams || []) out.push({ family: fam.section, version: fam.version, file: path.join(jdir, f), spec: d });
  }
  return out;
}

/** One gallery diagram spec by its spec id (sl-api) or catalog id (aws-sl-api), or null. */
export function findDiagramSpec(specs, id) {
  const want = String(id).trim();
  return specs.find((x) => x.spec.id === want) || specs.find((x) => 'aws-' + x.spec.id === want) || null;
}

/** Near matches for an unknown diagram id: specs sharing the most words with it (id and name). */
export function suggestDiagrams(specs, text, n = 5) {
  const words = String(text).toLowerCase().replace(/^aws-/, '').split(/[\s-]+/).filter((w) => w.length > 1);
  return specs
    .map((x) => ({ id: x.spec.id, hits: words.filter((w) => `${x.spec.id} ${x.spec.name || ''}`.toLowerCase().includes(w)).length }))
    .filter((x) => x.hits)
    .sort((a, b) => b.hits - a.hits || a.id.localeCompare(b.id))
    .slice(0, n).map((x) => x.id);
}
