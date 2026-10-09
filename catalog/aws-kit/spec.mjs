// awd JSON specs: the schema (spec.schema.json), a zero-dependency validator for the subset of JSON
// Schema 2020-12 it uses, and the canonical form that awd.mjs export-json writes (known keys in
// schema order, nulls dropped, one element per line).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA = JSON.parse(fs.readFileSync(path.join(HERE, 'spec.schema.json'), 'utf8'));
export const VERSION = 1;

// keywords the validator understands; anything else in the schema is an error, so the schema
// cannot drift past what is checked
const ANNOTATIONS = new Set(['$schema', '$id', '$defs', '$comment', 'title', 'description', 'default', 'examples']);
const KEYWORDS = new Set(['$ref', 'type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'items',
  'minItems', 'maxItems', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'pattern', 'anyOf']);

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeOf(v) === t);
const resolve = (s, root) => (s.$ref ? resolve({ ...ref(s.$ref, root), ...Object.fromEntries(Object.entries(s).filter(([k]) => k !== '$ref')) }, root) : s);
function ref(p, root) {
  if (!p.startsWith('#/')) throw new Error(`schema: only local $ref is supported, got ${p}`);
  const s = p.slice(2).split('/').reduce((o, k) => (o ? o[k] : o), root);
  if (!s) throw new Error(`schema: unresolved $ref ${p}`);
  return s;
}
// closest known key for an unknown property (typos such as lable, lableDy)
function near(k, keys) {
  const dist = (a, b) => {
    const d = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = d[0]; d[0] = i;
      for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
    }
    return d[b.length];
  };
  const best = keys.map((x) => [x, dist(k.toLowerCase(), x.toLowerCase())]).sort((a, b) => a[1] - b[1])[0];
  return best && best[1] <= 2 ? best[0] : null;
}

// Validate a value; returns [{ path, message }] (empty when valid). path reads like JS: diagrams[0].nodes[2].x
export function validateSchema(value, schema = SCHEMA, root = SCHEMA, at = '') {
  const s = resolve(schema, root), errs = [];
  const err = (message) => errs.push({ path: at || '(root)', message });
  for (const k of Object.keys(s)) if (!KEYWORDS.has(k) && !ANNOTATIONS.has(k)) throw new Error(`schema: unsupported keyword ${k} at ${at || '(root)'}`);
  if (s.type) {
    const ts = [].concat(s.type);
    if (!ts.some((t) => isType(value, t))) { err(`expected ${ts.join(' or ')}, got ${typeOf(value)}`); return errs; }
  }
  if ('const' in s && value !== s.const) err(`must be ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(value)) err(`must be one of ${s.enum.join(', ')}, got ${JSON.stringify(value)}`);
  if (typeof value === 'string' && s.pattern && !new RegExp(s.pattern, 'u').test(value)) err(`must match ${s.pattern}, got ${JSON.stringify(value)}`);
  if (typeof value === 'number') {
    if (s.minimum != null && value < s.minimum) err(`must be >= ${s.minimum}`);
    if (s.maximum != null && value > s.maximum) err(`must be <= ${s.maximum}`);
    if (s.exclusiveMinimum != null && value <= s.exclusiveMinimum) err(`must be > ${s.exclusiveMinimum}`);
    if (s.exclusiveMaximum != null && value >= s.exclusiveMaximum) err(`must be < ${s.exclusiveMaximum}`);
  }
  if (Array.isArray(value)) {
    if (s.minItems != null && value.length < s.minItems) err(`needs at least ${s.minItems} item(s)`);
    if (s.maxItems != null && value.length > s.maxItems) err(`takes at most ${s.maxItems} item(s)`);
    if (s.items) value.forEach((v, i) => errs.push(...validateSchema(v, s.items, root, `${at}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    const props = s.properties || {};
    for (const k of s.required || []) if (!Object.hasOwn(value, k)) err(`missing required ${k}`);
    for (const [k, v] of Object.entries(value)) {
      const where = at ? `${at}.${k}` : k;
      if (Object.hasOwn(props, k)) errs.push(...validateSchema(v, props[k], root, where));
      else if (s.additionalProperties === false) { const m = near(k, Object.keys(props)); errs.push({ path: where, message: `unknown property${m ? ` (did you mean ${m}?)` : ''}` }); }
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') errs.push(...validateSchema(v, s.additionalProperties, root, where));
    }
  }
  if (s.anyOf) {
    const alts = s.anyOf.map((a) => validateSchema(value, a, root, at));
    if (!alts.some((e) => !e.length)) {
      // every alternative here is { required: [...] } or a type; name them instead of nesting errors
      const said = s.anyOf.map((a) => (a.required ? a.required.join(' + ') : a.type ? [].concat(a.type).join('/') : JSON.stringify(a)));
      err(`needs ${said.join(' or ')}`);
    }
  }
  return errs;
}

export const validateFamily = (fam) => validateSchema(fam);
export const validateDiagram = (d) => validateSchema(d, SCHEMA.$defs.diagram);

// Canonical copy: known keys in schema order, null/undefined dropped (the generator reads null as
// absent), unknown keys collected in `dropped` (e.g. helper fields such as cx/cy in .mjs specs).
function canon(value, schema, dropped, at) {
  const s = resolve(schema, SCHEMA);
  if (Array.isArray(value)) return value.map((v) => canon(v, s.items || {}, dropped, at));
  if (typeOf(value) !== 'object' || !s.properties) return value;
  const out = {};
  for (const [k, sub] of Object.entries(s.properties)) if (Object.hasOwn(value, k) && value[k] != null) out[k] = canon(value[k], sub, dropped, at ? `${at}.${k}` : k);
  for (const k of Object.keys(value)) if (!Object.hasOwn(s.properties, k) && value[k] != null) dropped.set(at ? `${at}.${k}` : k, (dropped.get(at ? `${at}.${k}` : k) || 0) + 1);
  return out;
}
export function canonical(mod) {
  const dropped = new Map();
  const family = canon({ ...mod, version: mod.version != null ? mod.version : VERSION }, SCHEMA, dropped, '');
  return { family, dropped };
}
export const canonicalDiagram = (d) => canon(d, SCHEMA.$defs.diagram, new Map(), '');

// JSON text, 2-space indent; arrays of scalars and objects holding only scalars (a node, a wire, a
// timeline entry) stay on one line, so a family file reads like the .mjs it came from
const scalar = (v) => v === null || typeof v !== 'object';
const flat = (v) => scalar(v) || (Array.isArray(v) && v.every(scalar));
export function toJson(v, ind = '') {
  if (scalar(v)) return JSON.stringify(v);
  const next = ind + '  ';
  if (Array.isArray(v)) {
    if (v.every(scalar)) return `[${v.map((x) => JSON.stringify(x)).join(', ')}]`;
    return `[\n${v.map((x) => next + toJson(x, next)).join(',\n')}\n${ind}]`;
  }
  const ks = Object.keys(v);
  if (!ks.length) return '{}';
  if (Object.values(v).every(flat)) return `{ ${ks.map((k) => `${JSON.stringify(k)}: ${toJson(v[k])}`).join(', ')} }`;
  return `{\n${ks.map((k) => `${next}${JSON.stringify(k)}: ${toJson(v[k], next)}`).join(',\n')}\n${ind}}`;
}
