// The Prism MCP tools. Each entry: { name, description, inputSchema, handler }.
// Handlers receive (args, ctx) where ctx = { store, logger } and return a plain
// JS object (serialized to JSON text by the server). Handlers throw ToolError for
// structured, actionable failures.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lightEffect } from '../utils/catalog.js';
import { loadKit, buildDiagram, lintDiagram, diagramSpecs, findDiagramSpec, suggestDiagrams } from '../utils/diagrams.js';
import { compose, composeWithTemplate, availableTemplates } from '../utils/compose.js';
import { validateFacet, validateComposition } from '../utils/validate.js';
import { THEMES, THEME_IDS, TOKEN_META, BASE_TOKENS, SHELL_CHROME, TOKEN_DOCS, getTheme, baseTokensFor, usesTokens, themeRootCss, isThemeSensitive, themeIdList, themesSummary, designSystems, themePair } from '../utils/themes.js';
import { ApplyError, resolvePalette, themeCss, tokenBlockCss, rootAttributes, autoModeScript, buildDocument, applySteps, effectGuide } from '../utils/apply.js';
import { readIntent } from '../utils/recommend.js';
import { loadEngine } from '../utils/theme-engine.js';
import { CollectionError, toExportSchema } from '../utils/collections.js';
import { ICON_KINDS, RESOLVE_FROM, RESOLVE_PREFER, searchIcons, suggestIcons, resolveIcon, colorwayPair, iconSvg, iconSymbol, iconResolver } from '../utils/icons.js';

export class ToolError extends Error {
  constructor(message, { code = 'tool_error', data = null } = {}) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.data = data;
  }
}

/** Run a CollectionStore op, translating CollectionError into a structured ToolError. */
function withCollections(collections, fn) {
  if (!collections) throw new ToolError('Collections are not available in this server context', { code: 'unavailable' });
  try {
    return fn(collections);
  } catch (err) {
    if (err instanceof CollectionError) throw new ToolError(err.message, { code: err.code, data: err.data });
    throw err;
  }
}

/**
 * Resolve component inputs (ids and/or {id} objects) against the catalog, enriching each
 * with the catalog's name+gallery so the stored/exported record is self-describing.
 * Throws a structured ToolError listing any ids not present in the catalog.
 */
function resolveComponents(effectIds, store) {
  const ids = (Array.isArray(effectIds) ? effectIds : [effectIds])
    .map((x) => (typeof x === 'string' ? x : x && x.id ? String(x.id) : null))
    .filter(Boolean);
  const missing = [];
  const resolved = [];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const e = store.get(id);
    if (!e) { missing.push(id); continue; }
    resolved.push({ id: e.id, name: e.name, gallery: e.gallery });
  }
  if (missing.length) {
    throw new ToolError(`Unknown effect id(s): ${missing.join(', ')}`, { code: 'not_found', data: { missing } });
  }
  return resolved;
}

/** The AWS icons that ship with the loaded catalog, or a structured 'unavailable' error. */
function iconPack(store) {
  const pack = store.icons ? store.icons() : null;
  if (!pack) {
    throw new ToolError('No AWS icons ship with this catalog: point the server at Prism.html, or at a manifest.json with aws-icons/aws-icons.json beside it', { code: 'unavailable' });
  }
  return pack;
}

/** Lifecycle fields of an icon (retired, end of support, renamed, duplicate), when it has any. */
function iconStatus(ic, R) {
  if (!ic || !(ic.status || ic.renamedTo || ic.duplicateOf)) return {};
  const warnings = R ? R.resolve(ic.id).warnings : [`${ic.name}: ${ic.status || 'renamed'}`];
  return {
    ...(ic.status ? { status: ic.status } : {}), ...(ic.endOfSupport ? { endOfSupport: ic.endOfSupport } : {}),
    ...(ic.renamedTo ? { renamedTo: ic.renamedTo } : {}), ...(ic.duplicateOf ? { duplicateOf: ic.duplicateOf } : {}),
    warnings,
  };
}

/** One search result row: base id, names, kind, colorways, lifecycle. */
function iconItem(icons, e, score) {
  const pair = colorwayPair(icons, e.id);
  return {
    id: e.id, name: e.name, ...(e.short ? { short: e.short } : {}), kind: e.kind, category: e.category,
    ...(e.service ? { service: e.service } : {}),
    ...(e.aliases && e.aliases.length ? { aliases: e.aliases } : {}),
    ...(pair ? { colorways: { dark: pair.dark, light: pair.light } } : {}),
    ...(e.status ? { status: e.status } : {}), ...(e.renamedTo ? { renamedTo: e.renamedTo } : {}), ...(e.duplicateOf ? { duplicateOf: e.duplicateOf } : {}),
    ...(score != null ? { score } : {}),
  };
}

// --- shared schema fragments ---
const strArr = { type: 'array', items: { type: 'string' } };

/** Coerce to a non-negative integer. Uses Math.trunc(Number(x)), NOT `x | 0`:
 *  the bitwise-or coerces to a 32-bit signed int, so any value >= 2^31 wraps
 *  negative and then clamps to 0 — turning a large paging offset into "page 1
 *  again" (infinite re-paging) and a large limit into "return nothing". */
function nonNegInt(x, fallback = 0) {
  const n = Math.trunc(Number(x));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function paginate(items, limit, offset) {
  const off = nonNegInt(offset, 0);
  const lim = limit == null ? items.length : nonNegInt(limit, 0);
  return {
    total: items.length,
    offset: off,
    limit: lim,
    returned: Math.min(lim, Math.max(0, items.length - off)),
    items: items.slice(off, off + lim),
  };
}

const MATCH_SCORE_CACHE = new WeakMap();
const INTERACTION_CACHE = new Map();

function matchScore(effect, q) {
  // Simple weighted relevance over id/name/description/tags/category.
  if (!effect || !q) return 0;
  const ql = String(q).toLowerCase();
  let byQuery = MATCH_SCORE_CACHE.get(effect);
  if (!byQuery) {
    byQuery = new Map();
    MATCH_SCORE_CACHE.set(effect, byQuery);
  }
  if (byQuery.has(ql)) return byQuery.get(ql);

  const terms = ql.split(/\s+/).filter(Boolean);
  let score = 0;
  const hay = {
    id: (effect.id || '').toLowerCase(),
    name: (effect.name || '').toLowerCase(),
    desc: (effect.description || '').toLowerCase(),
    tags: (effect.tags || []).join(' ').toLowerCase(),
    cat: (effect.category || '').toLowerCase(),
    // Derived selection fields, de-hyphenated so "time series" hits "time-series"
    // and "part to whole" hits "part-to-whole".
    sel: [effect.role, effect.layer, effect.dataShape].filter(Boolean).join(' ').toLowerCase().replace(/-/g, ' '),
  };
  for (const t of terms) {
    if (hay.name.includes(t)) score += 5;
    if (hay.id.includes(t)) score += 4;
    if (hay.tags.includes(t)) score += 3;
    if (hay.cat.includes(t)) score += 2;
    if (hay.sel.includes(t)) score += 2;
    if (hay.desc.includes(t)) score += 1;
  }
  // exact-phrase bonuses
  if (hay.name === ql) score += 10;
  if (hay.name.includes(ql)) score += 3;
  byQuery.set(ql, score);
  return score;
}

// --- faceted search engine (shared by search_effects + saved searches) ---
//
// Facets are grounded in REAL catalog fields. Two caveats the raw data forces:
//   1. The `interaction` field is noisy: words are truncated ("tatic"→static,
//      "focu"→focus, "croll"→scroll), carry stray whitespace, and combine several
//      interactions in one string ("hover click"). We normalize into a canonical
//      token set so the facet is usable.
//   2. There is NO performance/themeCompat field in the catalog, so those spec
//      facets are intentionally absent rather than faked.
const INTERACTION_FIX = { tatic: 'static', focu: 'focus', croll: 'scroll' };

/**
 * Normalize a raw `interaction` value into canonical tokens (may be several).
 * The source is inconsistent: sometimes a string ("hover click"), sometimes an
 * array (["focu"," click"]), with truncated words and stray whitespace/commas.
 * We flatten, split on whitespace AND commas, de-truncate, and de-dupe.
 */
export function normalizeInteractions(raw) {
  if (raw == null) return [];
  const cacheKey = Array.isArray(raw) ? raw.join('\u0000') : String(raw);
  if (INTERACTION_CACHE.has(cacheKey)) return INTERACTION_CACHE.get(cacheKey).slice();

  const parts = Array.isArray(raw) ? raw : [raw];
  const seen = new Set();
  for (const part of parts) {
    for (const tok of String(part).toLowerCase().split(/[\s,]+/)) {
      const t = tok.trim();
      if (!t) continue;
      seen.add(INTERACTION_FIX[t] || t);
    }
  }
  const result = Array.from(seen);
  INTERACTION_CACHE.set(cacheKey, result);
  return result.slice();
}

// Multi-value facet dimensions: value(s) extracted per effect. `multi` means an
// effect can carry several values for the dimension (tags, interactions).
const FACET_DIMS = {
  gallery: { get: (e) => (e.gallery ? [e.gallery] : []), label: 'Gallery' },
  componentType: { get: (e) => (e.componentType ? [e.componentType] : []), label: 'Component type' },
  spectrum: { get: (e) => (e.spectrum ? [e.spectrum] : []), label: 'Aesthetic (spectrum)' },
  category: { get: (e) => (e.category ? [e.category] : []), label: 'Category' },
  role: { get: (e) => (e.role ? [e.role] : []), label: 'Role (purpose)' },
  layer: { get: (e) => (e.layer ? [e.layer] : []), label: 'Layer (stacking)' },
  dataShape: { get: (e) => (e.dataShape ? [e.dataShape] : []), label: 'Data shape' },
  tag: { get: (e) => e.tags || [], label: 'Tag', multi: true },
  interaction: { get: (e) => normalizeInteractions(e.interaction), label: 'Interaction', multi: true, normalized: true },
};

// Boolean flag dimensions.
const BOOL_DIMS = {
  isNew: { get: (e) => !!e.isNew, label: 'New' },
  usableAsBackground: { get: (e) => !!e.usableAsBackground, label: 'Usable as background' },
  needsJs: { get: (e) => !!e.needsJs, label: 'Needs JS initializer' },
  isFixed: { get: (e) => !!e.isFixed, label: 'Fixed / pinned' },
  selfContained: { get: (e) => !!e.selfContained, label: 'Self-contained' },
  // Derived accessibility signals (from a11y{}). selfAnimates = moves without user
  // action; reducedMotionSafe = static, or honors prefers-reduced-motion.
  selfAnimates: { get: (e) => !!(e.a11y && e.a11y.selfAnimates), label: 'Self-animates' },
  reducedMotionSafe: { get: (e) => !e.a11y || e.a11y.reducedMotionSafe !== false, label: 'Reduced-motion safe' },
};

// Maps the plural filter keys accepted by search_effects to a facet dimension.
const FILTER_KEY_TO_DIM = {
  galleries: 'gallery',
  componentTypes: 'componentType',
  spectrums: 'spectrum',
  categories: 'category',
  roles: 'role',
  layers: 'layer',
  dataShapes: 'dataShape',
  tags: 'tag',
  interactions: 'interaction',
};

function asStrArray(v) {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).map((x) => String(x)).filter(Boolean);
}

/**
 * Apply facet filters to a list of effects.
 *   - Multi-value OR within a single facet (any selected gallery matches).
 *   - AND across different facets.
 *   - tags are AND (an effect must carry every selected tag) — narrowing.
 *   - boolean flags: only enforced when explicitly true.
 */
function applyFilters(list, filters = {}) {
  if (!filters || typeof filters !== 'object') return list;
  let out = list;
  for (const [key, dim] of Object.entries(FILTER_KEY_TO_DIM)) {
    const wanted = asStrArray(filters[key]);
    if (!wanted.length) continue;
    const wantSet = new Set(wanted);
    const def = FACET_DIMS[dim];
    if (key === 'tags') {
      // AND semantics: must carry all selected tags.
      out = out.filter((e) => {
        const have = new Set(def.get(e));
        return wanted.every((t) => have.has(t));
      });
    } else {
      out = out.filter((e) => def.get(e).some((v) => wantSet.has(v)));
    }
  }
  for (const key of Object.keys(BOOL_DIMS)) {
    if (filters[key] === true) out = out.filter((e) => BOOL_DIMS[key].get(e));
    else if (filters[key] === false) out = out.filter((e) => !BOOL_DIMS[key].get(e));
  }
  // Theme-compat facet (JFH-9): themeSensitive selects components whose rendering
  // changes under a theme (they consume theme tokens directly or via themed
  // classes). It is a derived signal, not a stored field, so it lives here.
  if (filters.themeSensitive === true) out = out.filter((e) => isThemeSensitive(e));
  else if (filters.themeSensitive === false) out = out.filter((e) => !isThemeSensitive(e));
  return out;
}

/** Sort effects by a named strategy. `scoreMap` (id->score) drives relevance. */
function sortEffects(list, sort, scoreMap) {
  const byName = (a, b) => (a.name || a.id).localeCompare(b.name || b.id);
  switch (sort) {
    case 'name':
      return [...list].sort(byName);
    case 'newest':
      return [...list].sort((a, b) => (Number(!!b.isNew) - Number(!!a.isNew)) || byName(a, b));
    case 'gallery':
      return [...list].sort((a, b) => String(a.gallery).localeCompare(String(b.gallery)) || byName(a, b));
    case 'relevance':
    default:
      if (scoreMap) {
        return [...list].sort((a, b) => (scoreMap.get(b.id) || 0) - (scoreMap.get(a.id) || 0) || byName(a, b));
      }
      return [...list].sort(byName);
  }
}

const SORTS = ['relevance', 'name', 'newest', 'gallery'];

// The closed selection vocabularies (catalog/selection-vocab.json). A value outside them matches
// nothing, so it is an error that lists the valid ones rather than an empty page.
const VOCAB = {
  roles: ['action', 'input', 'navigation', 'feedback', 'loading', 'data-display', 'decorative', 'ambient', 'media'],
  layers: ['background', 'content', 'overlay'],
  dataShapes: ['single-value', 'time-series', 'comparison', 'part-to-whole', 'correlation', 'distribution', 'flow', 'geo'],
};

/** Throw invalid_argument for a gallery, role, layer or dataShape value the catalog does not have. */
function checkVocab(store, { galleries, roles, layers, dataShapes } = {}) {
  const known = new Set([...store.galleries().map((g) => g.id), ...store.all().map((e) => e.gallery)]);
  const bad = {};
  const g = asStrArray(galleries).filter((v) => !known.has(v));
  if (g.length) bad.galleries = { unknown: g, valid: [...known].filter(Boolean) };
  for (const [key, vals] of [['roles', roles], ['layers', layers], ['dataShapes', dataShapes]]) {
    const u = asStrArray(vals).filter((v) => !VOCAB[key].includes(v));
    if (u.length) bad[key] = { unknown: u, valid: VOCAB[key] };
  }
  const keys = Object.keys(bad);
  if (keys.length) {
    throw new ToolError(`Unknown ${keys.map((k) => `${k} value ${bad[k].unknown.join(', ')}`).join('; ')}`, { code: 'invalid_argument', data: bad });
  }
}

/** Near ids for an unknown effect id: the catalog ranked by the id's words. */
function suggestEffects(store, id) {
  const q = String(id || '').replace(/[-_]+/g, ' ');
  return store.all()
    .map((x) => ({ id: x.id, score: matchScore(x, q) }))
    .filter((x) => x.score > 0).sort((x, y) => y.score - x.score || x.id.localeCompare(y.id)).slice(0, 5).map((x) => x.id);
}

/** One effect by id, or a not_found ToolError with suggestions. */
function effectOr404(store, id) {
  if (typeof id !== 'string' || !id.trim()) throw new ToolError('id is required (an effect id such as "charts-kpi-sparkline")', { code: 'invalid_argument' });
  const e = store.get(id.trim());
  if (!e) throw new ToolError(`No effect with id "${id}"`, { code: 'not_found', data: { suggestions: suggestEffects(store, id) } });
  return e;
}

/** resolvePalette as a tool error. */
function paletteOf(a) {
  try { return resolvePalette({ theme: a.theme, tokens: a.tokens }); } catch (err) {
    if (err instanceof ApplyError) throw new ToolError(err.message, { code: 'invalid_argument', data: err.data });
    throw err;
  }
}

/** A compose result as the tools return it: no internals, plus the theme and how to apply it. */
function bundleOut(res, palette, { document: doc = false, title = 'Prism' } = {}) {
  const { _perEffectHtml, _sprite, ok, ...out } = res;
  out.theme = palette ? { id: palette.id, ds: palette.ds, name: palette.name, mode: palette.mode } : null;
  out.rootAttributes = rootAttributes(palette);
  const auto = autoModeScript(palette);
  if (auto) out.autoScript = auto;
  out.apply = applySteps(palette, res.scripts || []);
  if (doc) out.document = buildDocument({ title, css: res.css, html: res.html, palette, scripts: res.scripts || [] });
  return { ok, ...out };
}

// Shared compose schema fragments: the theme a bundle carries and the standalone page.
const THEME_ARG = { type: 'string', description: `Token block to prepend: a theme id (${THEME_IDS.slice(0, 4).join(', ')}..., one mode), a design system id (${designSystems().map((d) => d.ds).join(', ')}: Auto, dark with light under prefers-color-scheme, as a first visit to the app), or "none". Default "cloudscape" (Auto).` };
const TOKENS_ARG = { type: 'object', description: 'A custom palette instead of a shipped one: the { dark, light } pair derive_theme returns (Auto when both are given), or a flat { "--accent": "#..." } map layered over the tokens of the theme for its mode (inferred from --bg).' };
const DOCUMENT_ARG = { type: 'boolean', default: false, description: 'Also return document: a complete standalone HTML page (token block, root attributes, markup, initializer scripts) ready to save or screenshot.' };

/** Count how many effects carry each value of a facet dimension. */
function facetValueCounts(list, dimKey) {
  const def = FACET_DIMS[dimKey];
  if (!def) return [];
  const counts = new Map();
  for (const e of list) {
    for (const v of def.get(e)) counts.set(v, (counts.get(v) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
}

/** Count effects matching each boolean flag dimension. */
function boolFlagCounts(list) {
  const out = {};
  for (const [key, def] of Object.entries(BOOL_DIMS)) {
    out[key] = { label: def.label, count: list.filter((e) => def.get(e)).length };
  }
  return out;
}

/** Session-scoped saved-search store, lazily attached to the CatalogStore. */
function savedSearchStore(store) {
  if (!store._savedSearches) store._savedSearches = new Map();
  return store._savedSearches;
}

function slugifyName(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'search';
}

// Upper bound on numeric-suffix attempts when de-colliding a generated id.
// Far above any realistic number of same-named saved searches, but finite so a
// flood of colliding names can't spin the id loop forever.
const MAX_ID_ATTEMPTS = 10000;

/**
 * Core faceted search shared by search_effects and execute_saved_search.
 * query is optional; when absent, results are all effects matching the filters,
 * ordered by `sort` (defaults to name when there is no query to rank by).
 */
function runSearch(store, { query, gallery, filters, sort, limit, offset } = {}) {
  let list = store.all();
  // `gallery` shorthand (back-compat) folds into the galleries filter.
  const mergedFilters = { ...(filters || {}) };
  if (gallery) mergedFilters.galleries = [...asStrArray(mergedFilters.galleries), gallery];
  list = applyFilters(list, mergedFilters);

  const q = (query || '').trim();
  let scoreMap = null;
  if (q) {
    scoreMap = new Map();
    list = list.filter((e) => {
      const s = matchScore(e, q);
      if (s > 0) scoreMap.set(e.id, s);
      return s > 0;
    });
  }
  const effSort = sort || (q ? 'relevance' : 'name');
  const ordered = sortEffects(list, effSort, scoreMap);
  const shaped = ordered.map((e) => {
    const li = lightEffect(e);
    if (scoreMap) li.score = scoreMap.get(e.id) || 0;
    li.interactions = normalizeInteractions(e.interaction);
    li.spectrum = e.spectrum || null;
    return li;
  });
  const page = paginate(shaped, limit ?? 20, offset ?? 0);
  return { query: q || null, sort: effSort, filters: mergedFilters, ...page };
}

/**
 * Rank one recommend_effects need: the filters, then the intent's words for relevance, with reduced
 * motion safe, no JS and the requested motion first. Relaxes dataShape, then role, when nothing
 * matches; never the motion, JS or background constraints.
 */
function rankNeed(store, need, intent, limit) {
  const relaxed = [];
  let filters = { ...need.filters };
  let list = applyFilters(store.all(), filters);
  for (const key of ['dataShapes', 'roles']) {
    if (list.length || !filters[key]) continue;
    relaxed.push(`${key} ${asStrArray(filters[key]).join(', ')}`);
    const { [key]: _drop, ...rest } = filters;
    filters = rest;
    list = applyFilters(store.all(), filters);
  }
  const q = intent.terms.join(' ');
  const themeDs = intent.theme ? (themePair(intent.theme) || {}).ds : null;
  const scored = list.map((e) => {
    const why = [];
    let score = q ? matchScore(e, q) : 0;
    if (score) why.push(`matches "${intent.terms.filter((t) => matchScore(e, t) > 0).join(' ')}"`);
    const a11y = e.a11y || {};
    if (a11y.reducedMotionSafe !== false) score += 2; else why.push('no reduced-motion fallback');
    if (intent.prefer.selfAnimates && a11y.selfAnimates) { score += 3; why.push('animates on its own'); }
    if (e.needsJs) { if (intent.prefer.noJs) score -= 8; why.push(`needs the "${e.needsJs}" initializer`); }
    // Spectrums are aesthetic showcases (a glass or neon family, or a theme pack's own facets, often on
    // their own stage): they rank first only when the request names that aesthetic or that theme.
    if (e.gallery === 'spectrums') {
      const look = String(e.spectrum || '');
      if (look && (look === themeDs || intent.terms.some((t) => t.length > 3 && (look.includes(t) || t.includes(look))))) { score += 3; why.push(`the ${look} aesthetic`); }
      else score -= 10;
    }
    for (const [k, v] of Object.entries(filters)) {
      if (k === 'dataShapes') why.push(`dataShape ${e.dataShape}`);
      else if (k === 'roles') why.push(`role ${e.role}`);
      else if (k === 'usableAsBackground' && v) why.push('usable as a background');
      else if (k === 'reducedMotionSafe' && v) why.push('reduced-motion safe');
    }
    return { e, score, why };
  });
  scored.sort((x, y) => y.score - x.score || (x.e.name || x.e.id).localeCompare(y.e.name || y.e.id));
  return {
    need: need.need,
    filters,
    ...(relaxed.length ? { relaxed } : {}),
    total: scored.length,
    items: scored.slice(0, limit).map(({ e, why }) => ({
      id: e.id, name: e.name, gallery: e.gallery, category: e.category,
      description: e.description && e.description.length > 180 ? e.description.slice(0, 177) + '...' : e.description,
      role: e.role, dataShape: e.dataShape, layer: e.layer, usableAsBackground: e.usableAsBackground,
      needsJs: e.needsJs, a11y: e.a11y, why: [...new Set(why)],
    })),
  };
}

const EXPORT_TO = ['drawio', 'mermaid', 'svg', 'png', 'storyboard'];
const DIAGRAM_FEATURES = ['tables', 'flows', 'v6', 'note2', 'effects', 'poster', 'moment', 'marks', 'legend'];

/** The kit primitives a diagram spec uses (get_diagram_spec without an id). */
function diagramFeatures(d) {
  const f = [];
  if ((d.tables || []).length) f.push('tables');
  if ((d.flows || []).length) f.push('flows');
  if ((d.timeline || []).some((x) => x.v6) || (d.flows || []).some((x) => x.v6 || (x.wires || []).some((w) => w && w.v6))) f.push('v6');
  if ((d.groups || []).some((g) => Array.isArray(g.note))) f.push('note2');
  if ((d.effects || []).length) f.push('effects');
  if (d.poster != null) f.push('poster');
  if ((d.steps || []).some((x) => x.moment != null)) f.push('moment');
  if ((d.marks || []).length) f.push('marks');
  if (d.legend) f.push('legend');
  return f;
}

/** The gallery's diagram specs by family, with their features, optionally filtered. */
function diagramIndex(specs, { family, feature } = {}) {
  if (feature != null && !DIAGRAM_FEATURES.includes(feature)) throw new ToolError(`feature must be one of: ${DIAGRAM_FEATURES.join(', ')}`, { code: 'invalid_argument' });
  const fams = new Map();
  for (const x of specs) {
    if (!fams.has(x.family.id)) fams.set(x.family.id, { id: x.family.id, title: x.family.title, diagrams: [] });
    const features = diagramFeatures(x.spec);
    if (family && x.family.id !== family) continue;
    if (feature && !features.includes(feature)) continue;
    fams.get(x.family.id).diagrams.push({ id: x.spec.id, name: x.spec.name, size: `${x.spec.w}x${x.spec.h}`, features });
  }
  if (family && !fams.has(family)) throw new ToolError(`No diagram family "${family}"`, { code: 'not_found', data: { families: [...fams.keys()] } });
  const families = [...fams.values()].filter((f) => f.diagrams.length);
  return { total: families.reduce((n, f) => n + f.diagrams.length, 0), families, features: DIAGRAM_FEATURES };
}

export function buildTools() {
  return [
    // ============================== DISCOVERY (11) ==============================
    {
      name: 'list_effects',
      description: 'List effects in the catalog with optional filters (gallery, tag, componentType, role, layer, dataShape, background-capable, new). Returns lightweight metadata (no html/css) with pagination. An unknown gallery, role, layer or dataShape is an invalid_argument error listing the valid values. For relevance ranking, motion filters or several values per facet use search_effects; to go from a plain request to effects use recommend_effects.',
      inputSchema: {
        type: 'object',
        properties: {
          gallery: { type: 'string', description: 'Filter by gallery id (e.g. "charts", "fx")' },
          tag: { type: 'string', description: 'Filter to effects having this tag' },
          componentType: { type: 'string', description: 'Filter by componentType' },
          role: { type: 'string', description: 'Filter by role/purpose (action, input, navigation, feedback, loading, data-display, decorative, ambient, media)' },
          layer: { type: 'string', description: 'Filter by stacking layer (background, content, overlay)' },
          dataShape: { type: 'string', description: 'Filter by data shape (charts/maps/diagrams/aws: single-value, time-series, comparison, part-to-whole, correlation, distribution, flow, geo)' },
          usableAsBackground: { type: 'boolean', description: 'Only background-capable effects' },
          isNew: { type: 'boolean', description: 'Only effects tagged new' },
          limit: { type: 'integer', minimum: 1, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
        additionalProperties: false,
      },
      handler: (a, { store }) => {
        checkVocab(store, { galleries: a.gallery, roles: a.role, layers: a.layer, dataShapes: a.dataShape });
        let list = store.all();
        if (a.gallery) list = list.filter((e) => e.gallery === a.gallery);
        if (a.tag) list = list.filter((e) => e.tags.includes(a.tag));
        if (a.componentType) list = list.filter((e) => e.componentType === a.componentType);
        if (a.role) list = list.filter((e) => e.role === a.role);
        if (a.layer) list = list.filter((e) => e.layer === a.layer);
        if (a.dataShape) list = list.filter((e) => e.dataShape === a.dataShape);
        if (a.usableAsBackground === true) list = list.filter((e) => e.usableAsBackground);
        if (a.isNew === true) list = list.filter((e) => e.isNew);
        const page = paginate(list.map(lightEffect), a.limit ?? 50, a.offset ?? 0);
        return page;
      },
    },
    {
      name: 'search_effects',
      description: 'Faceted relevance search over the catalog. Full-text ranks across id/name/description/tags/category/role/dataShape; the optional `filters` object narrows by gallery, componentType, spectrum (aesthetic), category, role (component purpose), dataShape (chart/map/diagram data relationship), tag (AND), and interaction, plus boolean flags (isNew, usableAsBackground, needsJs, isFixed, selfContained, selfAnimates, reducedMotionSafe). Pick by intent with `roles` (e.g. loading, feedback, navigation), pick the right chart with `dataShapes` (time-series for a trend, part-to-whole for shares of a total, comparison, distribution, correlation, flow, geo, single-value for a KPI), a backdrop with usableAsBackground:true (layer "background" alone also covers some foreground objects), and respect motion prefs with reducedMotionSafe:true / selfAnimates:false. `sort` controls ordering (relevance/name/newest/gallery) and offset/limit paginate. query is optional when filters are given. Unknown gallery, role, layer or dataShape values and an unknown sort are invalid_argument errors that list the valid ones. Use get_available_filters to discover facet values, recommend_effects to go from a plain request to filters.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search text, e.g. "pulsing kpi card" or "wind backdrop". Optional if filters are supplied.' },
          gallery: { type: 'string', description: 'Shorthand to restrict to one gallery (folds into filters.galleries).' },
          filters: {
            type: 'object',
            description: 'Facet filters. Array facets are OR within a facet (except tags = AND) and AND across facets. Interaction values are normalized (e.g. static/focus/scroll).',
            properties: {
              galleries: { ...strArr, description: 'Match any of these gallery ids' },
              componentTypes: { ...strArr, description: 'Match any of these componentType values' },
              spectrums: { ...strArr, description: 'Match any of these spectrum (aesthetic) values' },
              categories: { ...strArr, description: 'Match any of these category values' },
              roles: { ...strArr, description: 'Match any of these roles (component purpose): action, input, navigation, feedback, loading, data-display, decorative, ambient, media' },
              layers: { ...strArr, description: 'Match any of these stacking layers: background (sits behind), content (in-flow, default), overlay (floats above: toasts/tooltips/notifications/modals)' },
              dataShapes: { ...strArr, description: 'Match any of these data shapes (charts/maps/diagrams/aws only): single-value, time-series, comparison, part-to-whole, correlation, distribution, flow, geo' },
              tags: { ...strArr, description: 'Must carry ALL of these tags (AND)' },
              interactions: { ...strArr, description: 'Match any of these normalized interaction tokens (static, hover, click, focus, scroll, auto-play, drag, toggle, on-load, …)' },
              isNew: { type: 'boolean' },
              usableAsBackground: { type: 'boolean' },
              needsJs: { type: 'boolean' },
              isFixed: { type: 'boolean' },
              selfContained: { type: 'boolean' },
              selfAnimates: { type: 'boolean', description: 'Motion filter: true = animates without user action (reduced-motion sensitive); false = static or interaction-triggered.' },
              reducedMotionSafe: { type: 'boolean', description: 'Accessibility filter: true = static, or honors prefers-reduced-motion; false = animates with no reduced-motion fallback.' },
              themeSensitive: { type: 'boolean', description: 'Theme-compat filter: true = only components whose look changes across themes (consume theme tokens); false = theme-neutral components.' },
            },
            additionalProperties: false,
          },
          sort: { type: 'string', enum: SORTS, description: 'Ordering. Defaults to relevance when a query is given, else name.' },
          limit: { type: 'integer', minimum: 1, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
        additionalProperties: false,
      },
      handler: (a, { store }) => {
        const hasQuery = a.query && a.query.trim();
        const hasFilters = (a.filters && Object.values(a.filters).some((v) => (Array.isArray(v) ? v.length : v != null))) || a.gallery;
        if (!hasQuery && !hasFilters) {
          throw new ToolError('Provide a query and/or at least one filter', { code: 'invalid_argument' });
        }
        if (a.sort != null && !SORTS.includes(a.sort)) throw new ToolError(`Invalid sort "${a.sort}"`, { code: 'invalid_argument', data: { validSorts: SORTS } });
        const f = a.filters || {};
        checkVocab(store, { galleries: [...asStrArray(f.galleries), ...asStrArray(a.gallery)], roles: f.roles, layers: f.layers, dataShapes: f.dataShapes });
        return runSearch(store, {
          query: a.query,
          gallery: a.gallery,
          filters: a.filters,
          sort: a.sort,
          limit: a.limit ?? 20,
          offset: a.offset ?? 0,
        });
      },
    },
    {
      name: 'recommend_effects',
      description: 'Go from a plain request to the right facets. Reads the intent ("a KPI dashboard with revenue over time and the plan mix", "a loading state that respects reduced motion", "an animated hero background", "toast for a failed upload", "three-tier AWS diagram with security group rules") into selection filters: role (loading, feedback, action, input, navigation, media, data-display), dataShape (time-series for trends, part-to-whole for shares of a total, comparison, distribution, correlation, flow, geo, single-value for KPIs), usableAsBackground for backdrops, reducedMotionSafe / selfAnimates for motion, needsJs:false for CSS only, the aws gallery for architectures, and a theme named in the text. Ranks the matches (reduced-motion safe and no-JS first unless the request says otherwise) and, when the request names several needs (a dashboard with a trend and a breakdown), returns one ranked group per need. Says which rules it applied and which filters it relaxed when nothing matched. Returns { intent, rules, theme, groups: [{ need, filters, relaxed, total, items: [{ id, name, gallery, role, dataShape, layer, usableAsBackground, needsJs, a11y, why }] }], next }. Then get_effect (its apply guide) and compose { ids, theme }.',
      inputSchema: {
        type: 'object',
        properties: {
          intent: { type: 'string', description: 'What the page needs, in plain words.' },
          limit: { type: 'integer', minimum: 1, maximum: 20, default: 5, description: 'Items per group.' },
          filters: { type: 'object', additionalProperties: true, description: 'Extra search_effects filters ANDed with what the intent says, e.g. { "galleries": ["charts"] } or { "reducedMotionSafe": true }.' },
        },
        required: ['intent'],
        additionalProperties: false,
      },
      handler: (a, { store }) => {
        if (typeof a.intent !== 'string' || !a.intent.trim()) throw new ToolError('intent is required: what the page needs, in plain words', { code: 'invalid_argument' });
        if (a.filters != null && (typeof a.filters !== 'object' || Array.isArray(a.filters))) throw new ToolError('filters must be an object (search_effects filters)', { code: 'invalid_argument' });
        const extra = a.filters || {};
        checkVocab(store, { galleries: extra.galleries, roles: extra.roles, layers: extra.layers, dataShapes: extra.dataShapes });
        const r = readIntent(a.intent);
        const limit = Math.min(20, nonNegInt(a.limit, 5));
        const base = { ...r.filters, ...extra };
        // one need per detected data shape, or per role (a dashboard asks for several charts)
        const needs = [];
        const shapes = asStrArray(base.dataShapes), roles = asStrArray(base.roles);
        if (shapes.length > 1) for (const d of shapes) needs.push({ need: `dataShape ${d}`, filters: { ...base, dataShapes: [d] } });
        else if (roles.length > 1 && !shapes.length) for (const ro of roles) needs.push({ need: `role ${ro}`, filters: { ...base, roles: [ro] } });
        else needs.push({ need: r.rules.length ? r.rules.map((x) => x.split(':')[0]).join(', ') : 'text match', filters: base });
        const groups = needs.map((n) => rankNeed(store, n, r, limit));
        const next = [];
        if (r.aws) {
          next.push('get_diagram_spec with no id lists every gallery diagram with its features (tables, flows, v6, two-line notes, poster): start from the closest one.');
          next.push('Edit the spec (icon ids from resolve_aws_icon, groups, wires, flows or timeline, tables), then build_diagram, fix what lint_diagram reports, and export_diagram to svg, png, storyboard, drawio or mermaid.');
        } else {
          next.push('get_effect { id } for the html, css and its apply guide (theme tokens it reads, initializer, motion, background placement).');
          next.push(`compose { ids: [...], theme: "${r.theme || 'cloudscape'}", document: true } for one bundle with the token block, or compose_with_template for a grid of cards.`);
        }
        return { intent: a.intent, rules: r.rules, theme: r.theme, groups, next };
      },
    },
    {
      name: 'get_effect',
      description: 'Fetch the complete record for one effect by id: production-ready html and css, classes, keyframes, params, selection metadata (role, layer, dataShape, a11y, usableAsBackground), and apply, the guide to using it: the theme tokens it reads (themeTokens: any theme token block defines them), its JS initializer with the source when needsJs is set, its motion (selfAnimates, reducedMotionSafe and what to do), how to place a backdrop or overlay, recolor classes, and the [data-mode="light"] note for light themes. Unknown ids return not_found with suggestions.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The effect id (e.g. "charts-big-metric-count-up")' },
          includeCss: { type: 'boolean', default: true },
          includeHtml: { type: 'boolean', default: true },
        },
        required: ['id'],
        additionalProperties: false,
      },
      handler: (a, { store }) => {
        const e = effectOr404(store, a.id);
        const out = { ...e, apply: effectGuide(e, store) };
        if (a.includeCss === false) delete out.css;
        if (a.includeHtml === false) delete out.html;
        return out;
      },
    },
    {
      name: 'get_theme_variants',
      description: 'Return the theme token reference and how to recolor an effect: tokensCss (the default theme block, Cloudscape in Auto: every token, dark with light under prefers-color-scheme, plus the .c-* recolor classes), the semantic role tokens (accent, info, pos, warn, neg, crit) with their on-fill inks (--accent-ink...), the surface tokens (--control-line included), every shipped theme id and the design systems with their dark and light ids.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: () => {
        const palette = resolvePalette({});
        return {
          tokensCss: themeCss(palette),
          tokensNote: 'Include once per page. A theme is this block with other values: get_theme_palette { theme } returns one, compose { theme } prepends one. Set data-mode on <html> to the mode (Auto: autoScript from compose).',
          semanticTokens: ['--accent', '--info', '--pos', '--neg', '--warn', '--crit'],
          onFillInks: ['--accent-ink', '--info-ink', '--pos-ink', '--warn-ink', '--neg-ink', '--crit-ink'],
          surfaceTokens: ['--bg', '--panel', '--panel2', '--card', '--line', '--control-line', '--ink', '--muted', '--dim'],
          recolor: 'Set --c and --c-rgb (or add a c-* class like c-pos) on the effect element to recolor it.',
          designSystems: designSystems(),
          // Derived from the theme registry (utils/themes.js) so scaffolded packs
          // (F6) surface here automatically — no hand-editing this list.
          builtInThemes: THEME_IDS,
          note: themesSummary(),
        };
      },
    },
    {
      name: 'get_theme_palette',
      description: 'Return the token palette for one theme (or all themes). Prism themes are pure :root token overrides applied over identical component HTML/CSS, so a palette fully defines how every component looks in that theme. Each theme returns its complete token map (surfaces, --control-line, text, the role colors with -rgb triplets and their on-fill inks --accent-ink..--crit-ink, the font, radius and feel tokens, and the pack\'s --cs-topnav-* top-bar tokens, --cs-topnav-accent where the bar is the accent), the overrides vs the Cloudscape Dark base, mode (light/dark) and a ready-to-paste :root{…} CSS block. One theme also returns rootAttributes (data-mode, data-theme, data-ds: set them on <html>, facets read [data-mode="light"]), pair (its design system\'s dark and light ids) and autoCss (both modes following prefers-color-scheme, as the app\'s Auto). Themes: ' + themeIdList() + '.',
      inputSchema: {
        type: 'object',
        properties: {
          theme: { type: 'string', enum: THEME_IDS, description: 'A theme id. Omit to return all themes.' },
        },
        additionalProperties: false,
      },
      handler: (a) => {
        const shape = (t) => ({
          id: t.id, ds: t.ds, name: t.name, mode: t.mode, builtin: t.builtin,
          tokens: t.tokens, overrides: t.overrides,
          overrideCount: Object.keys(t.overrides).length,
          css: themeRootCss(t.id),
        });
        if (a.theme) {
          const t = getTheme(a.theme);
          if (!t) throw new ToolError(`No theme "${a.theme}"`, { code: 'not_found', data: { themes: THEME_IDS } });
          const pair = themePair(t.id);
          const auto = resolvePalette({ theme: t.ds });
          return {
            ...shape(t),
            rootAttributes: rootAttributes(resolvePalette({ theme: t.id })),
            pair: { dark: pair.dark, light: pair.light },
            autoCss: tokenBlockCss(auto),
            autoScript: autoModeScript(auto),
            apply: `Put css on the page once (or compose { theme: "${t.id}" }) and set data-mode="${t.mode}" data-theme="${t.id}" data-ds="${t.ds}" on <html>. To follow the system instead, use autoCss and run autoScript in <head> (or compose { theme: "${t.ds}" }).`,
          };
        }
        return { base: BASE_TOKENS, tokenMeta: TOKEN_META, themeCount: THEMES.length, themes: THEMES.map(shape) };
      },
    },
    {
      name: 'get_component_variants',
      description: 'Return every theme variant of one component. Because a variant is the same html/css under a different :root token set, this returns the component payload ONCE plus, for each theme, the token overrides to apply (and optionally the full recolored css). Also reports which theme tokens the component consumes and whether it is theme-sensitive. Ideal for building a variant matrix or previewing a component across themes.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The effect id (e.g. "charts-big-metric-count-up")' },
          includeCss: { type: 'boolean', default: false, description: 'Include the component css payload once (shared across all variants).' },
          themes: { ...strArr, description: 'Restrict to these theme ids (default: all). Valid: ' + THEME_IDS.join(', ') },
        },
        required: ['id'],
        additionalProperties: false,
      },
      handler: (a, { store }) => {
        const e = effectOr404(store, a.id);
        let themes = THEMES;
        if (a.themes && a.themes.length) {
          const bad = a.themes.filter((id) => !getTheme(id));
          if (bad.length) throw new ToolError(`Unknown theme(s): ${bad.join(', ')}`, { code: 'invalid_argument', data: { themes: THEME_IDS } });
          themes = a.themes.map(getTheme);
        }
        const consumed = usesTokens(e);
        return {
          id: e.id,
          name: e.name,
          gallery: e.gallery,
          componentType: e.componentType || '',
          themeSensitive: isThemeSensitive(e),
          usesTokens: consumed,
          note: 'One payload, many variants: render = html + css + the chosen theme\'s token overrides on :root.',
          html: e.html,
          ...(a.includeCss ? { css: e.css } : {}),
          variantCount: themes.length,
          variants: themes.map((t) => ({
            theme: t.id,
            name: t.name,
            mode: t.mode,
            // the full override set, plus only the overrides this component actually
            // reacts to (a consumed token the theme does NOT override is not "relevant").
            overrides: t.overrides,
            relevantOverrides: consumed.reduce((o, k) => { if (t.overrides[k] !== undefined) o[k] = t.overrides[k]; return o; }, {}),
            rootCss: themeRootCss(t.id),
          })),
        };
      },
    },
    {
      name: 'get_variants_for_theme',
      description: 'List components as they appear under a single theme, with each component\'s relevant token values for that theme. Supports the same facets as search_effects (gallery, componentType, spectrum, tag, flags) plus a themeSensitiveOnly filter, and paginates. Use this to render a whole gallery in one theme.',
      inputSchema: {
        type: 'object',
        properties: {
          theme: { type: 'string', enum: THEME_IDS, description: 'The theme id to render under.' },
          gallery: { type: 'string', description: 'Restrict to one gallery.' },
          componentType: { type: 'string', description: 'Restrict to one componentType.' },
          spectrum: { type: 'string', description: 'Restrict to one spectrum (aesthetic).' },
          tag: { type: 'string', description: 'Restrict to components carrying this tag.' },
          themeSensitiveOnly: { type: 'boolean', default: false, description: 'Only components whose rendering changes by theme.' },
          limit: { type: 'integer', minimum: 1, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
        required: ['theme'],
        additionalProperties: false,
      },
      handler: (a, { store }) => {
        if (typeof a.theme !== 'string' || !a.theme.trim()) throw new ToolError('theme is required (a theme id)', { code: 'invalid_argument', data: { themes: THEME_IDS } });
        const t = getTheme(a.theme);
        if (!t) throw new ToolError(`No theme "${a.theme}"`, { code: 'not_found', data: { themes: THEME_IDS } });
        let list = store.all();
        if (a.gallery) list = list.filter((e) => e.gallery === a.gallery);
        if (a.componentType) list = list.filter((e) => e.componentType === a.componentType);
        if (a.spectrum) list = list.filter((e) => e.spectrum === a.spectrum);
        if (a.tag) list = list.filter((e) => (e.tags || []).includes(a.tag));
        if (a.themeSensitiveOnly) list = list.filter((e) => isThemeSensitive(e));
        const mapped = list.map((e) => {
          const consumed = usesTokens(e);
          return {
            id: e.id,
            name: e.name,
            gallery: e.gallery,
            componentType: e.componentType || '',
            themeSensitive: isThemeSensitive(e),
            usesTokens: consumed,
            tokenValues: consumed.reduce((o, k) => { o[k] = t.tokens[k]; return o; }, {}),
          };
        });
        const page = paginate(mapped, a.limit ?? 50, a.offset ?? 0);
        return { theme: { id: t.id, name: t.name, mode: t.mode }, overrides: t.overrides, ...page };
      },
    },

    // ============================== THEMES (2) ==============================
    // Theme derivation: brand inputs in, a complete contrast-safe token palette for both color
    // modes out (catalog/theme-engine/derive.mjs, found beside the catalog file), and a contrast
    // audit for any token map.
    {
      name: 'derive_theme',
      description: 'Derive a complete Prism theme from brand inputs: every theme token (surfaces, text, accent, status colors with their -rgb triplets, gradient, elevation, radius scale, font, density, top-nav chrome, --control-line for input, checkbox and switch boundaries, and an on-fill ink per role, --accent-ink to --crit-ink, for text on those fills) for dark and light mode, contrast-safe by construction. The accent keeps its hue; its OKLCH lightness moves per mode only when it misses a floor (4.5:1 text on the panels, 3:1 UI on bg, readable ink on accent fills; 7:1 text with contrast AAA). Neutrals keep the brand hue at low chroma; status colors use the conventional hues at the accent\'s chroma and one shared lightness. Deterministic. Returns { name, dark, light, css: { dark, light } (paste-ready :root blocks), report: { pairs: [{ mode, fg, bg, ratio, floor, pass, apca }], failures, moved (inputs it had to move, with a message such as "accent #ffd400 too light for text on a light panel: darkened to #897000, L 0.88 to 0.55"), notes, summary } }. A mode not requested is null. To use it on a page: compose { ids, tokens: { dark, light } } (Auto between the two) or paste css.dark / css.light and set data-mode on <html>; check_theme_contrast audits any edit. To ship it as a pack: catalog/theme-engine/derive.mjs --profile out.mjs, then catalog/_scaffold_ds.mjs.',
      inputSchema: {
        type: 'object',
        properties: {
          accent: { type: 'string', description: 'Brand accent, #rgb or #rrggbb.' },
          name: { type: 'string', description: 'Theme name (default "Custom"), used in the css comments and report.' },
          secondary: { type: 'string', description: 'Optional second brand color for --accent2 (gradient partner), #hex. Defaults to the accent.' },
          neutral: { type: 'string', description: 'Surface tint: brand (default: the accent hue at low chroma), cool, warm, neutral (near grey), or a #hex whose hue and tint strength are used.' },
          mode: { type: 'string', enum: ['both', 'dark', 'light'], description: 'Color modes to derive (default both).' },
          contrast: { type: 'string', enum: ['AA', 'AAA'], description: 'WCAG level for the floors (default AA).' },
          radius: { type: ['number', 'string'], description: 'Base (md) corner radius in px, e.g. 6 or "6px" (default 8). sm/lg/xl follow at x0.5/x1.5/x2.' },
          density: { type: ['number', 'string'], description: 'compact, comfortable (default), spacious, or a number 0.8 to 1.3 for --dens.' },
          font: { type: 'string', description: 'CSS font-family list for --font (default the system stack).' },
        },
        required: ['accent'],
        additionalProperties: false,
      },
      handler: async (a, { store }) => {
        const eng = await themeEngine(store);
        let d;
        try { d = eng.derive.deriveTheme(a); } catch (err) { throw new ToolError(err.message, { code: 'invalid_argument' }); }
        const name = d.report.input.name;
        return {
          name,
          dark: d.dark,
          light: d.light,
          css: { dark: d.dark ? eng.derive.rootCss(d.dark, `${name} dark`) : null, light: d.light ? eng.derive.rootCss(d.light, `${name} light`) : null },
          report: d.report,
        };
      },
    },
    {
      name: 'check_theme_contrast',
      description: 'Check a theme token map against the contrast floors derive_theme uses: ink, muted (4.5:1 text) and dim (3:1) on bg/panel/panel2/card; accent and the five status colors as text on panel/panel2/card and as UI on bg; ink on accent fills (--accent-ink, or #fff when absent, the ink Prism\'s generated facets use); accent2 as UI; the top bar: --cs-topnav-ink and -dim on --cs-topnav-bg, --cs-topnav-accent (else --accent) as UI on it and --cs-topnav-accent-ink (else --accent-ink) on that fill, the pairs Prism\'s theme gate holds; control-line (the input, checkbox and switch boundary) as UI on bg/panel/panel2/card; line as an unscored decorative pair. On-fill inks missing from the map are taken as #fff, what the facets fall back to. Pass tokens (a partial or full map of --token: value; rgba surfaces are composited over --bg) or theme (a shipped theme id). Missing tokens are filled from the Cloudscape base of the mode and the shell\'s top-bar defaults, as Prism layers a pack over them (fill: false to check only what you pass). mode is inferred from the surfaces when omitted. Returns { mode, contrast, pass, checked, failures, pairs: [{ fg, bg, fgValue, bgValue, ratio, floor, pass, apca }], skipped, filledFromBase }.',
      inputSchema: {
        type: 'object',
        properties: {
          tokens: { type: 'object', description: 'Token map, e.g. { "--bg": "#0f1621", "--panel": "#192534", "--accent": "#539fe5" }.' },
          theme: { type: 'string', enum: THEME_IDS, description: 'A shipped theme id to check instead of tokens.' },
          mode: { type: 'string', enum: ['dark', 'light'], description: 'Color mode (default: inferred from the surfaces).' },
          contrast: { type: 'string', enum: ['AA', 'AAA'], description: 'WCAG level (default AA).' },
          fill: { type: 'boolean', default: true, description: 'Fill missing tokens from the Cloudscape base of the mode (default true).' },
        },
        additionalProperties: false,
      },
      handler: async (a, { store }) => {
        if ((a.tokens == null) === (a.theme == null)) throw new ToolError('pass exactly one of tokens or theme', { code: 'invalid_argument' });
        if (a.mode != null && !['dark', 'light'].includes(a.mode)) throw new ToolError('mode must be dark or light', { code: 'invalid_argument' });
        if (a.contrast != null && !['AA', 'AAA'].includes(a.contrast)) throw new ToolError('contrast must be AA or AAA', { code: 'invalid_argument' });
        let tokens = a.tokens;
        let mode = a.mode;
        if (a.theme != null) {
          const t = getTheme(a.theme);
          if (!t) throw new ToolError(`No theme "${a.theme}"`, { code: 'not_found', data: { themes: THEME_IDS } });
          tokens = t.tokens;
          mode = mode || t.mode;
        }
        if (typeof tokens === 'string') {
          try { tokens = JSON.parse(tokens); } catch (err) { throw new ToolError(`tokens is not valid JSON: ${err.message}`, { code: 'invalid_argument' }); }
        }
        if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) throw new ToolError('tokens must be an object of --token: value', { code: 'invalid_argument' });
        const keys = Object.keys(tokens);
        if (keys.length > 200) throw new ToolError('tokens has more than 200 entries', { code: 'invalid_argument' });
        const bad = keys.filter((k) => !/^--[a-z0-9-]+$/i.test(k) || typeof tokens[k] !== 'string' || tokens[k].length > 400);
        if (bad.length) throw new ToolError('every token must be a --name with a string value (at most 400 characters)', { code: 'invalid_argument', data: { invalid: bad.slice(0, 20) } });
        const eng = await themeEngine(store);
        mode = mode || eng.derive.inferMode(tokens);
        const filledFromBase = [];
        let full = tokens;
        if (a.fill !== false) {
          const base = { ...baseTokensFor(mode), ...SHELL_CHROME };
          full = { ...base, ...tokens };
          for (const k of Object.keys(base)) if (!(k in tokens)) filledFromBase.push(k);
        }
        let r;
        try { r = eng.derive.checkContrast(full, { mode, contrast: a.contrast || 'AA' }); } catch (err) { throw new ToolError(err.message, { code: 'invalid_argument' }); }
        topBarAccentPairs(eng.color, full, r);
        return {
          mode: r.mode, contrast: r.contrast, pass: r.pass,
          checked: r.pairs.filter((p) => p.floor != null).length,
          failures: r.failures, pairs: r.pairs, skipped: r.skipped, filledFromBase,
        };
      },
    },

    // ============================== DISCOVERY (continued) ==============================
    {
      name: 'list_galleries',
      description: 'List all galleries with their id, title and effect count.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: (a, { store }) => {
        const declared = store.galleries();
        // Cross-check declared counts against live index (catches stale manifests).
        const items = declared.map((g) => ({
          id: g.id,
          title: g.title,
          declaredCount: g.count,
          liveCount: store.gallery(g.id).length,
        }));
        return { total: items.length, items };
      },
    },
    {
      name: 'get_catalog_stats',
      description: 'Aggregate statistics: total effects, per-gallery counts, count of background-capable, effects needing JS, new/fixed counts, and unique tag/componentType tallies.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: (a, { store }) => {
        const all = store.all();
        const byGallery = {};
        const tagCounts = {};
        const typeCounts = {};
        let background = 0, needsJs = 0, isNew = 0, isFixed = 0;
        for (const e of all) {
          byGallery[e.gallery] = (byGallery[e.gallery] || 0) + 1;
          if (e.usableAsBackground) background++;
          if (e.needsJs) needsJs++;
          if (e.isNew) isNew++;
          if (e.isFixed) isFixed++;
          for (const t of e.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
          if (e.componentType) typeCounts[e.componentType] = (typeCounts[e.componentType] || 0) + 1;
        }
        return {
          totalEffects: all.length,
          galleryCount: store.galleries().length,
          byGallery,
          backgroundCapable: background,
          needsJs,
          isNew,
          isFixed,
          uniqueTags: Object.keys(tagCounts).length,
          uniqueComponentTypes: Object.keys(typeCounts).length,
          topTags: Object.entries(tagCounts).sort((a2, b2) => b2[1] - a2[1]).slice(0, 15).map(([tag, count]) => ({ tag, count })),
        };
      },
    },

    {
      name: 'get_available_filters',
      description: 'Describe every facet available for search_effects: each array facet (gallery, componentType, spectrum, category, role, dataShape, tag, interaction) with its top values and counts, plus the boolean flags and their counts (including selfAnimates / reducedMotionSafe), and the valid sort options. Use this to build a faceted UI or to learn valid filter values before searching.',
      inputSchema: {
        type: 'object',
        properties: {
          topValues: { type: 'integer', minimum: 1, default: 25, description: 'Max values to return per array facet (by frequency). Use list_filter_values for the full list of one facet.' },
        },
        additionalProperties: false,
      },
      handler: (a, { store }) => {
        const all = store.all();
        const top = a.topValues ?? 25;
        const facets = {};
        for (const [key, def] of Object.entries(FACET_DIMS)) {
          const values = facetValueCounts(all, key);
          facets[key] = {
            label: def.label,
            multi: !!def.multi,
            normalized: !!def.normalized,
            filterKey: Object.keys(FILTER_KEY_TO_DIM).find((k) => FILTER_KEY_TO_DIM[k] === key),
            totalValues: values.length,
            values: values.slice(0, top),
          };
        }
        return {
          totalEffects: all.length,
          facets,
          booleanFlags: { ...boolFlagCounts(all), themeSensitive: { label: 'Theme-sensitive (derived)', count: all.filter((e) => isThemeSensitive(e)).length } },
          sorts: SORTS,
          notes: [
            'tags filter uses AND (an effect must have every selected tag); all other array facets use OR.',
            'interaction values are normalized from noisy source data (e.g. "tatic"→static, "focu"→focus, "croll"→scroll).',
            'themeSensitive (search_effects filter) is derived: the component reads theme tokens or classes. No performance facet exists in the catalog.',
            'usableAsBackground is the authored backdrop flag; layer "background" is derived from the component type and also covers some foreground objects, so filter backdrops with usableAsBackground: true.',
            'role, layer and dataShape are closed vocabularies; recommend_effects maps a plain request onto them.',
          ],
        };
      },
    },
    {
      name: 'list_filter_values',
      description: 'List the full set of values for a single facet dimension (gallery, componentType, spectrum, category, role, dataShape, tag, or interaction) with per-value effect counts. Complements get_available_filters when you need every value of one facet (e.g. all 175 categories).',
      inputSchema: {
        type: 'object',
        properties: {
          facet: { type: 'string', enum: Object.keys(FACET_DIMS), description: 'Which facet dimension to enumerate' },
          prefix: { type: 'string', description: 'Optional case-insensitive prefix/substring filter on the value' },
          limit: { type: 'integer', minimum: 1, default: 200 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
        required: ['facet'],
        additionalProperties: false,
      },
      handler: (a, { store }) => {
        if (!FACET_DIMS[a.facet]) {
          throw new ToolError(`Unknown facet "${a.facet}"`, { code: 'invalid_argument', data: { validFacets: Object.keys(FACET_DIMS) } });
        }
        let values = facetValueCounts(store.all(), a.facet);
        if (a.prefix) {
          const p = a.prefix.toLowerCase();
          values = values.filter((v) => String(v.value).toLowerCase().includes(p));
        }
        const page = paginate(values, a.limit ?? 200, a.offset ?? 0);
        return { facet: a.facet, label: FACET_DIMS[a.facet].label, ...page };
      },
    },
    {
      name: 'create_saved_search',
      description: 'Save a named search (query + filters + sort) for reuse this session. Returns an id you can pass to execute_saved_search. Saved searches live in server memory for the current process (they are not persisted to disk).',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Human label for the saved search' },
          query: { type: 'string' },
          filters: { type: 'object', additionalProperties: true, description: 'Same shape as search_effects.filters' },
          sort: { type: 'string', enum: SORTS },
          description: { type: 'string', description: 'Optional note about what this search is for' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      handler: (a, { store }) => {
        const name = String(a.name || '').trim();
        if (!name) throw new ToolError('name is required', { code: 'invalid_argument' });
        const hasQuery = a.query && a.query.trim();
        const hasFilters = a.filters && Object.values(a.filters).some((v) => (Array.isArray(v) ? v.length : v != null));
        if (!hasQuery && !hasFilters) throw new ToolError('A saved search needs a query and/or at least one filter', { code: 'invalid_argument' });
        if (a.sort && !SORTS.includes(a.sort)) throw new ToolError(`Invalid sort "${a.sort}"`, { code: 'invalid_argument', data: { validSorts: SORTS } });
        const saved = savedSearchStore(store);
        // Stable, collision-resistant id: slug + short numeric suffix.
        // Bound the collision search so pathological/malicious duplicate names
        // (which all slugify to the same base) can't hang the server.
        const base = slugifyName(name);
        let id = base;
        for (let n = 2; saved.has(id); n++) {
          if (n - 2 >= MAX_ID_ATTEMPTS) {
            throw new ToolError(
              `Could not generate a unique id for a saved search named "${name}" after ${MAX_ID_ATTEMPTS} attempts`,
              { code: 'id_generation_failed', data: { base } }
            );
          }
          id = `${base}-${n}`;
        }
        const record = {
          id,
          name,
          description: a.description || '',
          query: hasQuery ? a.query.trim() : null,
          filters: a.filters || {},
          sort: a.sort || null,
          createdAt: new Date().toISOString(),
        };
        saved.set(id, record);
        return { created: id, savedSearch: record, total: saved.size };
      },
    },
    {
      name: 'get_saved_searches',
      description: 'List all saved searches for this session (id, name, query, filters, sort). Empty until create_saved_search is called.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: (a, { store }) => {
        const saved = savedSearchStore(store);
        return { total: saved.size, items: Array.from(saved.values()) };
      },
    },
    {
      name: 'execute_saved_search',
      description: 'Run a previously saved search by id and return ranked results (same shape as search_effects). Optionally override sort/limit/offset without changing the saved definition.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Saved-search id from create_saved_search/get_saved_searches' },
          sort: { type: 'string', enum: SORTS, description: 'Override the saved sort for this run' },
          limit: { type: 'integer', minimum: 1, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
        required: ['id'],
        additionalProperties: false,
      },
      handler: (a, { store }) => {
        const saved = savedSearchStore(store);
        const record = saved.get(a.id);
        if (!record) {
          throw new ToolError(`No saved search with id "${a.id}"`, { code: 'not_found', data: { available: Array.from(saved.keys()) } });
        }
        const res = runSearch(store, {
          query: record.query,
          filters: record.filters,
          sort: a.sort || record.sort,
          limit: a.limit ?? 20,
          offset: a.offset ?? 0,
        });
        return { savedSearch: { id: record.id, name: record.name }, ...res };
      },
    },

    // ============================== COMPOSITION (3) ==============================
    {
      name: 'compose',
      description: 'Compose effects (by id) into one production-ready bundle themed like the app: css starts with the theme token block (theme: a theme id for one mode, a design system id for Auto, dark with light under prefers-color-scheme, default "cloudscape" Auto; or tokens: a custom palette such as derive_theme\'s { dark, light }) and the .c-* recolor classes, then the deduplicated effect css; html is the merged markup (AWS icon sprites merged into one). Returns rootAttributes to set on <html> (data-mode drives the facets\' [data-mode="light"] rules; Auto returns autoScript instead), scripts (each needed JS initializer with its source), apply (the steps), conflicts (CSS selectors two effects define differently: the later wins), backgroundConflict (more than one backdrop), validation and size metrics. document: true adds a complete standalone HTML page. Optionally wrap the markup in a container element.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: { ...strArr, description: 'Effect ids to compose, in display order', minItems: 1 },
          theme: THEME_ARG,
          tokens: TOKENS_ARG,
          includeTokens: { type: 'boolean', default: true, description: 'Prepend the theme token block and the .c-* classes (false: the page supplies its own tokens).' },
          document: DOCUMENT_ARG,
          title: { type: 'string', description: 'Title of the standalone document.' },
          wrap: {
            type: 'object',
            description: 'Optional wrapper element around the combined markup',
            properties: {
              tag: { type: 'string' }, className: { type: 'string' }, style: { type: 'string' },
            },
            additionalProperties: false,
          },
          separator: { type: 'string', default: '\n' },
        },
        required: ['ids'],
        additionalProperties: false,
      },
      handler: (a, { store }) => {
        if (!Array.isArray(a.ids) || a.ids.length === 0) throw new ToolError('ids must be a non-empty array', { code: 'invalid_argument' });
        const palette = paletteOf(a);
        const res = compose(a.ids, store, { includeTokens: a.includeTokens, palette, wrap: a.wrap, separator: a.separator });
        if (!res.ok) throw new ToolError('Composition failed', { code: 'compose_failed', data: { errors: res.errors, missing: res.missing } });
        return bundleOut(res, a.includeTokens === false ? null : palette, { document: a.document === true, title: a.title });
      },
    },
    {
      name: 'compose_with_template',
      description: `Compose effects into a named layout template: stack (a column), row (wrapping flex row), grid (auto-fit columns of at least 240px), card (each effect in a padded panel, in a grid: a dashboard of tiles), backdrop (a hero section: the first usableAsBackground effect is stretched to fill it behind the other effects, which stack centered above it). Takes theme, tokens and document like compose and returns the same bundle shape plus the applied template. Templates: ${availableTemplates().join(', ')}.`,
      inputSchema: {
        type: 'object',
        properties: {
          ids: { ...strArr, description: 'Effect ids to compose', minItems: 1 },
          template: { type: 'string', enum: availableTemplates(), default: 'stack' },
          theme: THEME_ARG,
          tokens: TOKENS_ARG,
          includeTokens: { type: 'boolean', default: true },
          document: DOCUMENT_ARG,
          title: { type: 'string', description: 'Title of the standalone document.' },
        },
        required: ['ids'],
        additionalProperties: false,
      },
      handler: (a, { store }) => {
        if (!Array.isArray(a.ids) || a.ids.length === 0) throw new ToolError('ids must be a non-empty array', { code: 'invalid_argument' });
        const palette = paletteOf(a);
        const res = composeWithTemplate(a.ids, store, a.template || 'stack', { includeTokens: a.includeTokens, palette });
        if (!res.ok) throw new ToolError('Composition failed', { code: 'compose_failed', data: { errors: res.errors, missing: res.missing } });
        return bundleOut(res, a.includeTokens === false ? null : palette, { document: a.document === true, title: a.title });
      },
    },
    {
      name: 'validate_composition',
      description: 'Validate that a set of effect ids can be composed: checks each id exists, flags missing ones, reports which effects need JS initializers, and detects composition conflicts: CSS selectors that two effects define differently (the later silently wins when bundled) and more than one backdrop (usableAsBackground: only one renders). Does not build output.',
      inputSchema: {
        type: 'object',
        properties: { ids: { ...strArr, minItems: 1 } },
        required: ['ids'],
        additionalProperties: false,
      },
      handler: (a, { store }) => {
        if (!Array.isArray(a.ids) || a.ids.length === 0) throw new ToolError('ids must be a non-empty array', { code: 'invalid_argument' });
        const res = validateComposition(a.ids, store);
        return {
          valid: res.valid,
          errors: res.errors,
          warnings: res.warnings,
          conflicts: res.conflicts,
          backgroundConflict: res.backgroundConflict,
          missing: res.missing,
          resolved: res.resolved.map((e) => e.id),
        };
      },
    },

    // ============================== CONTENT CREATION (3) ==============================
    {
      name: 'create_facet',
      description: 'Create a new facet (effect) and register it in the live catalog immediately (in-memory; discoverable via list/search/get without restart). Validates naming, metadata, html/css, and token references before accepting. To persist to disk, embed via the catalog pipeline.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Lowercase kebab-case id, conventionally "<gallery>-<name>"' },
          name: { type: 'string' },
          gallery: { type: 'string' },
          category: { type: 'string' },
          description: { type: 'string' },
          html: { type: 'string' },
          css: { type: 'string' },
          classes: strArr,
          tags: strArr,
          params: { type: 'object', additionalProperties: true },
          needsJs: { type: ['string', 'null'] },
          usableAsBackground: { type: 'boolean', default: false },
        },
        required: ['id', 'name', 'gallery', 'html'],
        additionalProperties: false,
      },
      handler: (a, { store, logger }) => {
        const existingIds = new Set(store.all().map((e) => e.id));
        const knownGalleries = new Set(store.galleries().map((g) => g.id));
        const v = validateFacet(a, { existingIds, knownGalleries, isUpdate: false });
        if (!v.valid) throw new ToolError('Facet validation failed', { code: 'validation_failed', data: v });
        const created = store.addRuntimeFacet(a);
        logger && logger.info(`create_facet: registered "${created.id}" (runtime)`);
        return { created: created.id, effect: created, validation: v, persisted: false, note: 'Registered in live catalog (in-memory). Run the embed pipeline to persist into Prism.html.' };
      },
    },
    {
      name: 'update_facet',
      description: 'Update fields of an existing facet (must already exist). Re-validates the merged result. Applies to the live in-memory catalog.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          gallery: { type: 'string' },
          category: { type: 'string' },
          description: { type: 'string' },
          html: { type: 'string' },
          css: { type: 'string' },
          classes: strArr,
          tags: strArr,
          params: { type: 'object', additionalProperties: true },
          needsJs: { type: ['string', 'null'] },
          usableAsBackground: { type: 'boolean' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      handler: (a, { store, logger }) => {
        const existing = store.get(a.id);
        if (!existing) throw new ToolError(`No facet with id "${a.id}" to update`, { code: 'not_found' });
        const merged = { ...existing, ...a };
        const existingIds = new Set(store.all().map((e) => e.id));
        const knownGalleries = new Set(store.galleries().map((g) => g.id));
        const v = validateFacet(merged, { existingIds, knownGalleries, isUpdate: true });
        if (!v.valid) throw new ToolError('Facet validation failed', { code: 'validation_failed', data: v });
        const updated = store.updateRuntimeFacet(a.id, a);
        logger && logger.info(`update_facet: updated "${a.id}" (runtime)`);
        return { updated: a.id, effect: updated, validation: v, persisted: false };
      },
    },
    {
      name: 'validate_facet',
      description: 'Validate a facet definition WITHOUT creating it: checks id/kebab-case, required metadata, html presence, CSS structural soundness, and unknown token references. Returns detailed errors, warnings and per-check results.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          gallery: { type: 'string' },
          description: { type: 'string' },
          html: { type: 'string' },
          css: { type: 'string' },
          needsJs: { type: ['string', 'null'] },
        },
        required: ['id'],
        additionalProperties: true,
      },
      handler: (a, { store }) => {
        const existingIds = new Set(store.all().map((e) => e.id));
        const knownGalleries = new Set(store.galleries().map((g) => g.id));
        return validateFacet(a, { existingIds, knownGalleries, isUpdate: false });
      },
    },

    // ============================== CATALOG MANAGEMENT (3) ==============================
    {
      name: 'get_catalog_metadata',
      description: 'Return catalog-level metadata: name, version, generation timestamp, source, gallery/effect counts, runtime facet count, source file path, and whether hot reload is active.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: (a, { store }) => store.meta(),
    },
    {
      name: 'export_collection',
      description: 'Export effects as a self-contained bundle. Three sources (in priority order): a saved collectionId, an explicit set of ids, or an entire gallery. format="bundle" (default) returns merged deduped CSS (led by the theme token block, as compose) + the html and the initializer scripts; format="document" adds a complete standalone <html> document with the root attributes and the initializers; format="schema" returns the portable prism-collection-1.0 JSON (importable by the Prism.html UI). Only a saved collectionId can produce format="schema". theme and tokens work as in compose.',
      inputSchema: {
        type: 'object',
        properties: {
          collectionId: { type: 'string', description: 'Export a saved collection by id (takes priority over ids/gallery)' },
          ids: { ...strArr, description: 'Effect ids to include (omit if using collectionId or gallery)' },
          gallery: { type: 'string', description: 'Export an entire gallery instead of explicit ids' },
          format: { type: 'string', enum: ['bundle', 'document', 'schema'], default: 'bundle', description: 'bundle (CSS+HTML), document (full <html>), or schema (prism-collection-1.0 JSON)' },
          title: { type: 'string', default: 'Prism Collection' },
          asDocument: { type: 'boolean', default: false, description: 'Deprecated alias for format="document"' },
          theme: THEME_ARG,
          tokens: TOKENS_ARG,
          includeTokens: { type: 'boolean', default: true },
        },
        additionalProperties: false,
      },
      handler: (a, { store, collections }) => {
        const format = a.format || (a.asDocument ? 'document' : 'bundle');
        // --- Source resolution: saved collection > explicit ids > gallery ---
        let ids = a.ids;
        let sourceCollection = null;
        if (a.collectionId) {
          sourceCollection = withCollections(collections, (c) => c.get(a.collectionId));
          ids = sourceCollection.components.map((cmp) => cmp.id);
        } else if ((!ids || !ids.length) && a.gallery) {
          ids = store.gallery(a.gallery).map((e) => e.id);
        }
        if (!ids || !ids.length) {
          if (a.collectionId) throw new ToolError('Collection is empty; nothing to export', { code: 'invalid_argument', data: { collectionId: a.collectionId } });
          throw new ToolError('Provide collectionId, ids[], or a gallery to export', { code: 'invalid_argument' });
        }

        // --- format="schema": portable prism-collection-1.0 (saved collections only) ---
        if (format === 'schema') {
          if (!sourceCollection) throw new ToolError('format="schema" requires a saved collectionId', { code: 'invalid_argument' });
          // totalSize = byte length of the composed CSS+HTML, a useful UI hint.
          const composed = compose(ids, store, { includeTokens: a.includeTokens, palette: a.includeTokens === false ? null : paletteOf(a) });
          const totalSize = composed.ok ? Buffer.byteLength((composed.css || '') + (composed.html || '')) : null;
          return toExportSchema(sourceCollection, { totalSize });
        }

        const title = a.title || (sourceCollection && sourceCollection.name) || 'Prism Collection';
        const palette = a.includeTokens === false ? null : paletteOf(a);
        const res = compose(ids, store, { includeTokens: a.includeTokens, palette });
        if (!res.ok) throw new ToolError('Export failed', { code: 'export_failed', data: { errors: res.errors, missing: res.missing } });
        const bundle = {
          title, effects: res.effects, css: res.css, html: res.html, initializers: res.initializers, scripts: res.scripts, metrics: res.metrics,
          theme: palette ? { id: palette.id, ds: palette.ds, name: palette.name, mode: palette.mode } : null, rootAttributes: rootAttributes(palette),
        };
        if (sourceCollection) bundle.collectionId = sourceCollection.id;
        if (format === 'document') {
          // Defense-in-depth: even though the catalog is trusted by design, when we
          // inline CSS into a <style> block a stray "</style>" (or "</script>") would
          // close the tag early and let following bytes be parsed as markup/script.
          // Neutralize those sequences so composed content can't break out of context.
          const safeCss = neutralizeClosers(res.css);
          const safeBodyHtml = neutralizeClosers(res.html, /* htmlBody */ true);
          // the initializers come from the catalog's initializers table, not from facet markup
          bundle.document = buildDocument({ title: bundle.title, css: safeCss, html: safeBodyHtml, palette, scripts: res.scripts });
          if (safeCss !== res.css || safeBodyHtml !== res.html) {
            bundle.sanitized = true;
            bundle.warnings = (bundle.warnings || []).concat('Neutralized </style> or </script> sequences in composed content for the generated document.');
          }
        }
        return bundle;
      },
    },
    {
      name: 'get_token_reference',
      description: 'Return the canonical CSS token reference for building and theming facets: tokensCss (the default theme block, Cloudscape in Auto, with the .c-* recolor classes), every token a theme defines with its purpose (surfaces, --control-line, text, role colors, on-fill inks --accent-ink to --crit-ink, font, radius, feel, the top bar), the recolor classes and how a page applies a theme.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: () => {
        const palette = resolvePalette({});
        return {
          tokensCss: themeCss(palette),
          note: 'Include a theme block once per page (this one, get_theme_palette { theme } css, or compose { theme }) and set data-mode on <html>. Facets read the tokens with var(); text on a role fill reads the matching -ink token (var(--accent-ink,#fff)) and control boundaries read var(--control-line,var(--line)).',
          tokens: TOKEN_DOCS,
          recolorClasses: ['c-accent', 'c-info', 'c-pos', 'c-warn', 'c-neg', 'c-crit'],
          rootAttributes: 'data-mode (dark or light; facets carry [data-mode="light"] rules), data-theme (the theme id) and data-ds (the design system), as the app stamps them.',
        };
      },
    },

    // ============================== AWS ARCHITECTURE ICONS (3) ==============================
    // The official AWS Architecture Icons behind the AWS Architecture gallery, read from the
    // gallery's embedded sprite in Prism.html (or catalog/aws-icons/aws-icons.json). The gallery's
    // own diagrams already carry their icons in get_effect html; these tools serve new diagrams.
    // Ranking and name resolution come from catalog/aws-icons/resolve.mjs, shared with awd.mjs.
    {
      name: 'search_aws_icons',
      description: 'Search the official AWS Architecture Icons that ship with Prism (services, resources, group frames, categories) by words over name, id, service, category, aliases and crosswalk names, e.g. "lambda", "managed microsoft ad", "nat gateway", "ALB", "AWS::S3::Bucket". Every word must match a whole word or the start of one, so "ecr" does not find Secrets Manager. Exact names, abbreviations and old names (S3, NACL, DAX, Elasticsearch, QuickSight) rank first. Colorway pairs (separate artwork for dark and light backgrounds) collapse into one result keyed by the base id; retired and renamed icons carry status. Containers (security group, Availability Zone, VPC, subnets) are frames, not icons: the result then carries frame.group, the group kind a diagram spec takes. The official set has no egress-only internet gateway: the kit draws it with aws-res-vpc-internet-gateway labelled "Egress-only internet gateway". Use resolve_aws_icon to pick one icon for a name, get_aws_icon for the SVG.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words that must all match (case-insensitive). Empty lists every icon.' },
          kind: { type: 'string', enum: ICON_KINDS, description: 'Only this kind of icon.' },
          limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Max results (default 25, max 200).' },
          offset: { type: 'integer', minimum: 0, description: 'Results to skip, for paging.' },
        },
        additionalProperties: false,
      },
      handler: (a, { store }) => {
        const pack = iconPack(store);
        if (a.kind != null && !ICON_KINDS.includes(a.kind)) {
          throw new ToolError(`kind must be one of: ${ICON_KINDS.join(', ')}`, { code: 'invalid_argument' });
        }
        const limit = Math.min(200, nonNegInt(a.limit, 25));
        const offset = nonNegInt(a.offset, 0);
        const R = iconResolver(pack);
        if (!R) return { source: pack.source, ...searchIcons(pack.icons, { query: a.query || '', kind: a.kind || null, limit, offset }) };
        const hits = R.search(a.query || '', { kind: a.kind || null });
        const items = hits.slice(offset, offset + limit).map((h) => iconItem(pack.icons, h.entry, a.query ? h.score : undefined));
        const out = { source: pack.source, total: hits.length, offset, count: items.length, items };
        // a container such as "security group" has no icon: say which frame draws it
        if (a.query && a.query.trim()) {
          const r = R.resolve(a.query);
          if (r.kind === 'group' && r.group) out.frame = { group: r.group, ...(r.id ? { icon: r.id } : {}), note: `"${a.query}" is drawn as a group frame: { kind: "${r.group}" } in a diagram spec's groups (resolve_aws_icon says the same).` };
          else if (!r.id && r.warnings && r.warnings.length) out.warnings = r.warnings;
        }
        return out;
      },
    },
    {
      name: 'resolve_aws_icon',
      description: 'Pick the one official AWS icon for a name from any source: free text ("S3 bucket", "ALB", "Security Group", "Aurora PostgreSQL"), a draw.io style or shape (resIcon=mxgraph.aws4.lambda, mxgraph.aws4.internet_gateway), a Mermaid/Iconify key (aws:simple-storage-service), a PlantUML macro (LambdaLambdaFunction, VPCGroup), a Python diagrams class (compute.Lambda), a CloudFormation type (AWS::Lambda::Function) or a Terraform type (aws_lb). Returns the icon id and name, kind "node" or "group" (a frame, with the awd group kind: vpc, pub, priv, sg, az, region, asg, acct, dc...), a 0..1 confidence, how it matched, ranked candidates and warnings (retired or renamed services, a missing property, an ambiguous name). id is null when nothing is good enough. CloudFormation/Terraform icons that depend on a property take props, e.g. {"Type":"network"} for ELBv2, {"Engine":"postgres","MultiAZ":true} for RDS (adds the standby icon).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The name to resolve.' },
          from: { type: 'string', enum: RESOLVE_FROM, description: 'Source vocabulary (default text; CloudFormation, Terraform, draw.io and Mermaid forms are also recognised in text).' },
          props: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] }, description: 'Resource properties for property picks: Type, Engine, MultiAZ, FileSystemType, load_balancer_type, engine, multi_az, MapPublicIpOnLaunch, strokeColor.' },
          prefer: { type: 'string', enum: RESOLVE_PREFER, description: 'Override the default: service or resource icon, node icon or group frame.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      handler: (a, { store }) => {
        const pack = iconPack(store);
        if (typeof a.query !== 'string' || !a.query.trim()) throw new ToolError('query is required', { code: 'invalid_argument' });
        if (a.from != null && !RESOLVE_FROM.includes(a.from)) throw new ToolError(`from must be one of: ${RESOLVE_FROM.join(', ')}`, { code: 'invalid_argument' });
        if (a.prefer != null && !RESOLVE_PREFER.includes(a.prefer)) throw new ToolError(`prefer must be one of: ${RESOLVE_PREFER.join(', ')}`, { code: 'invalid_argument' });
        if (a.props != null && (typeof a.props !== 'object' || Array.isArray(a.props) || Object.values(a.props).some((v) => v != null && typeof v === 'object'))) {
          throw new ToolError('props must be an object of string, number or boolean values', { code: 'invalid_argument' });
        }
        const R = iconResolver(pack);
        if (!R) throw new ToolError('Icon name resolution needs catalog/aws-icons/resolve.mjs: run the server from the Prism repository', { code: 'unavailable' });
        const r = R.resolve(a.query, { from: a.from || 'text', props: a.props || {}, prefer: a.prefer });
        const nm = (id) => { const e = id && R.info(id); return e ? e.short || e.name : null; };
        return {
          query: a.query, from: r.from || a.from || 'text',
          id: r.id, ...(r.id ? { name: nm(r.id) } : {}), ...(r.kind ? { kind: r.kind } : {}), ...(r.group ? { group: r.group } : {}),
          ...(r.role ? { role: r.role } : {}), ...(r.confidence != null ? { confidence: r.confidence } : {}), ...(r.how ? { how: r.how } : {}),
          ...(r.standby ? { standby: r.standby } : {}), ...(r.status ? { status: r.status } : {}),
          candidates: r.candidates.map((c) => ({ id: c.id, name: nm(c.id), score: c.score })),
          warnings: r.warnings,
          source: pack.source,
        };
      },
    },
    {
      name: 'get_aws_icon',
      description: 'Get one official AWS Architecture Icon, unmodified, as standalone SVG (default) or as a <symbol> for a page sprite (reference it with <use href="#id">). For icons with separate dark/light artwork, a base id such as aws-res-users returns the light-background artwork unless colorway is "dark".',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Icon id from search_aws_icons, e.g. aws-svc-lambda.' },
          format: { type: 'string', enum: ['svg', 'symbol'], description: 'svg (default): a standalone <svg>. symbol: a <symbol> for a sprite.' },
          colorway: { type: 'string', enum: ['light', 'dark'], description: 'Artwork for light backgrounds (default) or dark ones; ignored for single-artwork icons.' },
          size: { type: 'integer', minimum: 8, maximum: 1024, description: 'Width and height of the standalone svg in px (default 48).' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      handler: (a, { store }) => {
        const pack = iconPack(store);
        if (typeof a.id !== 'string' || !a.id.trim()) throw new ToolError('id is required', { code: 'invalid_argument' });
        const icon = resolveIcon(pack.icons, a.id.trim(), a.colorway === 'dark' ? 'dark' : 'light');
        const R = iconResolver(pack);
        if (!icon) {
          // near matches: the resolver's picks for the id read as a name, then any-word matches
          const plain = a.id.trim().replace(/^aws-(svc|res|grp|cat)-/, '').replace(/-(dark|light)$/, '');
          const near = R ? [...R.resolve(plain).candidates.map((c) => c.id), ...R.search(plain).slice(0, 5).map((h) => h.id)] : [];
          const typos = closeIds([...pack.icons.keys()].filter((k) => !/-(dark|light)$/.test(k)), a.id.trim(), 2);
          const suggestions = [...new Set([...typos, ...near, ...suggestIcons(pack.icons, a.id)])].slice(0, 5);
          throw new ToolError(`Unknown AWS icon id: ${a.id}`, { code: 'not_found', data: { suggestions } });
        }
        const pair = colorwayPair(pack.icons, icon.id);
        const symbol = a.format === 'symbol';
        return {
          id: icon.id, name: icon.name, ...(icon.short ? { short: icon.short } : {}), kind: icon.kind, category: icon.category,
          ...(icon.service ? { service: icon.service } : {}),
          ...(pair ? { colorways: { dark: pair.dark, light: pair.light } } : {}),
          ...iconStatus(icon, R),
          viewBox: icon.viewBox,
          format: symbol ? 'symbol' : 'svg',
          markup: symbol ? iconSymbol(icon) : iconSvg(icon, Math.min(1024, Math.max(8, nonNegInt(a.size, 48)))),
          source: pack.source,
        };
      },
    },

    // ============================== COLLECTIONS & FAVORITES (6) ==============================
    // Saved, named sets of effects that persist across sessions (JFH-7). export_collection
    // (above) is overloaded to export a saved collection by id, including as portable
    // prism-collection-1.0 JSON for import into the Prism.html UI.
    {
      name: 'list_collections',
      description: 'List all saved collections as lightweight summaries (id, name, description, componentCount, tags, timestamps), most-recently-updated first.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: (a, { collections }) => {
        const items = withCollections(collections, (c) => c.list());
        return { total: items.length, items };
      },
    },
    {
      name: 'get_collection',
      description: 'Get a single saved collection by id, including its full component list ({id, name, gallery}).',
      inputSchema: {
        type: 'object',
        properties: { collectionId: { type: 'string', description: 'The collection id' } },
        required: ['collectionId'],
        additionalProperties: false,
      },
      handler: (a, { collections }) => withCollections(collections, (c) => c.get(a.collectionId)),
    },
    {
      name: 'create_collection',
      description: 'Create a new named collection of effects. Effect ids are validated against the catalog and stored with their name+gallery. Constraints: name <=50 chars & unique, description <=200 chars, <=5 tags, <=50 components. Duplicate ids are collapsed.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Collection name (<=50 chars, must be unique)' },
          effectIds: { ...strArr, description: 'Effect ids to seed the collection with (may be empty)' },
          description: { type: 'string', description: 'Optional description (<=200 chars)' },
          color: { type: 'string', description: 'Optional accent color for UI' },
          icon: { type: 'string', description: 'Optional icon key/emoji for UI' },
          tags: { ...strArr, description: 'Optional tags (<=5)' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      handler: (a, { store, collections }) => {
        const components = resolveComponents(a.effectIds || [], store);
        return withCollections(collections, (c) => c.create({
          name: a.name,
          description: a.description || '',
          components,
          color: a.color || null,
          icon: a.icon || null,
          tags: a.tags || [],
        }));
      },
    },
    {
      name: 'add_to_collection',
      description: 'Add one or more effects to a saved collection. Effect ids are validated against the catalog. Duplicates already in the collection are skipped; the 50-component limit is enforced. Returns the updated collection plus counts of added/skipped.',
      inputSchema: {
        type: 'object',
        properties: {
          collectionId: { type: 'string', description: 'Target collection id' },
          effectIds: { ...strArr, description: 'Effect ids to add' },
        },
        required: ['collectionId', 'effectIds'],
        additionalProperties: false,
      },
      handler: (a, { store, collections }) => {
        const components = resolveComponents(a.effectIds || [], store);
        if (!components.length) throw new ToolError('Provide at least one effectId to add', { code: 'invalid_argument' });
        return withCollections(collections, (c) => c.addComponents(a.collectionId, components));
      },
    },
    {
      name: 'remove_from_collection',
      description: 'Remove one or more effects from a saved collection by effect id. Returns the updated collection and the number removed. Ids not present are ignored.',
      inputSchema: {
        type: 'object',
        properties: {
          collectionId: { type: 'string', description: 'Target collection id' },
          effectIds: { ...strArr, description: 'Effect ids to remove' },
        },
        required: ['collectionId', 'effectIds'],
        additionalProperties: false,
      },
      handler: (a, { collections }) =>
        withCollections(collections, (c) => c.removeComponents(a.collectionId, a.effectIds || [])),
    },
    {
      name: 'delete_collection',
      description: 'Delete a saved collection entirely. This cannot be undone via the MCP surface.',
      inputSchema: {
        type: 'object',
        properties: { collectionId: { type: 'string', description: 'The collection id to delete' } },
        required: ['collectionId'],
        additionalProperties: false,
      },
      handler: (a, { collections }) => withCollections(collections, (c) => c.delete(a.collectionId)),
    },

    // ============================== AWS ARCHITECTURE DIAGRAMS (3) ==============================
    // Diagrams as data: a JSON spec (catalog/aws-kit/spec.schema.json) compiled by the AWS kit that
    // builds the gallery (catalog/aws-kit/awd.mjs), found beside the catalog file.
    {
      name: 'build_diagram',
      description: 'Build an AWS architecture diagram from a JSON spec with the AWS kit behind the AWS Architecture gallery: official AWS icons and group frames, numbered steps, and packets on one SMIL clock. A diagram is { id, name, desc, w, h (normal 480 wide and up to 300 high; wide: true for 960x440; full: true for up to 1400x900), dur (6-10 s), poster, groups, nodes, wires, steps, timeline, flows, tables, effects, notes, marks, legend }. groups: frames (cloud, region, az, vpc, pub, priv, sg, asg, acct, dc, gen...) drawn outer first, with note for a CIDR; a two-line note ["10.0.1.0/24", "2001:db8:1::/64"] puts the IPv6 block under the IPv4 one (dual stack). nodes: { id, icon (from resolve_aws_icon), x, y, label } or boxes. wires: { id, from, to } or { id, d: "M..H..V.." }, with label (a port such as TCP 443), dashed, both, tone. Story: either timeline entries { wire, t: [a, b], ring, kind: pk|pk-2|pk-bad, v6 } plus steps { n, at, text, moment? }, or flows (the easy way): { path: [node ids], reply: true, text: [one per hop], kind?, v6? } compile to packets, arrival rings and numbered steps with their text; v6: true draws IPv6 packets as diamonds (IPv4 stay circles). tables: rules and routes cards { x, y, title, tone: "security"|"networking", cols, rows: [cells] or { cells, on: "<wire id>", v6?, tone: ok|bad|muted, t?, still? } }: a row with on lights while any packet crosses that wire, the reply included (ok green for the rule that admits it, bad red for the deny), so network ACL and route tables keep time with the story; for a stateful security group rule that should light for the request only, pin t to the request window instead (story below gives it). poster is the moment a still export shows; steps[].moment pins a storyboard frame. Runs the schema and the kit\'s input checks; returns { id, svg, html, errors, lint, story }: story (a spec with flows) is the compiled timeline and steps, the windows to pin the t of a row or the moment of a step on; lint lists layout findings (the gallery build rejects severity error, tables included: fix and rebuild); svg is one self-contained SVG document (kit CSS, only the icons it uses, the spec in <metadata id="awd-spec">), html is the bare <svg class="awd"> the gallery embeds (needs the kit CSS and icon sprite on the page). svg and html are null when errors is not empty (a typo comes back as nodes[0].lable: unknown property (did you mean label?)). A family { version: 1, section, diagrams } returns { section, diagrams: [...], errors }. Start from get_diagram_spec (no id lists the gallery by feature: sg-chain for security group tables, v6-dual-stack for flows, IPv6 and two-line notes). Reference: catalog/drafts/AWS_KIT.md.',
      inputSchema: {
        type: 'object',
        properties: {
          spec: { type: 'object', description: 'One diagram spec, or a family { version: 1, section: { id, title }, diagrams: [...] }. Schema: catalog/aws-kit/spec.schema.json.' },
          theme: { type: 'string', enum: ['auto', 'light', 'dark'], description: 'Standalone svg colors: auto (default) follows prefers-color-scheme; light or dark fixes them.' },
          still: { type: 'boolean', description: 'Standalone svg shows the complete static diagram (no packets), for print and slides.' },
        },
        required: ['spec'],
        additionalProperties: false,
      },
      handler: async (a, { store }) => {
        let spec = a.spec;
        if (typeof spec === 'string') {
          try { spec = JSON.parse(spec); } catch (err) { throw new ToolError(`spec is not valid JSON: ${err.message}`, { code: 'invalid_argument' }); }
        }
        if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new ToolError('spec must be a diagram object or a family { version, section, diagrams }', { code: 'invalid_argument' });
        if (a.theme != null && !['auto', 'light', 'dark'].includes(a.theme)) throw new ToolError('theme must be auto, light or dark', { code: 'invalid_argument' });
        const kit = await diagramKit(store);
        return buildDiagram(kit, spec, { theme: a.theme || 'auto', still: a.still === true });
      },
    },
    {
      name: 'get_diagram_spec',
      description: 'Get the JSON spec of one AWS Architecture gallery diagram by id (catalog id such as aws-sl-api, or spec id sl-api). About 8x smaller than the rendered html from get_effect, and editable: change it and pass it to build_diagram. Returns { id, catalogId, family, version, spec, source }. Without an id it lists the gallery (87 diagrams in 11 families, plus the kit example sx-api) so you can pick the closest one to copy: { total, families: [{ id, title, diagrams: [{ id, name, size, features }] }] }, where features names the kit primitives a spec uses: tables (rules and routes cards), flows, v6 (IPv6 packets), note2 (two-line IPv4 and IPv6 frame notes), effects (failover, scale-out), poster, moment, marks, legend. Filter the list with family (e.g. security, ipv6, three-tier) or feature.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Diagram id, e.g. aws-sl-api or sl-api. Omit to list the gallery.' },
          family: { type: 'string', description: 'List only this family (section id), e.g. security or ipv6.' },
          feature: { type: 'string', enum: DIAGRAM_FEATURES, description: 'List only the diagrams that use this kit primitive.' },
        },
        additionalProperties: false,
      },
      handler: async (a, { store }) => {
        if (a.id == null) {
          const kit = await diagramKit(store);
          return diagramIndex(diagramSpecs(kit.dir), { family: a.family, feature: a.feature });
        }
        if (typeof a.id !== 'string' || !a.id.trim()) throw new ToolError('id is required', { code: 'invalid_argument' });
        const kit = await diagramKit(store);
        const specs = diagramSpecs(kit.dir);
        const hit = findDiagramSpec(specs, a.id);
        if (!hit) throw new ToolError(`No diagram spec with id "${a.id}"`, { code: 'not_found', data: { suggestions: suggestDiagrams(specs, a.id), available: specs.length } });
        return { id: hit.spec.id, catalogId: 'aws-' + hit.spec.id, family: hit.family, version: hit.version, spec: hit.spec, source: hit.file };
      },
    },
    {
      name: 'lint_diagram',
      description: 'Check an AWS architecture diagram\'s layout against the kit\'s rules without building it: pass a diagram spec, or the id of a gallery diagram (aws-sl-api or sl-api). Measures text with Arial\'s real widths on the drawn markup (timed captions and raw extra included). Returns { id, errors, findings: [{ severity, code, message, at }], counts, clean }. Errors (the gallery build rejects them): off-canvas, icon-overlap, text-overlap, text-on-icon, text-on-border (text across or within 2px of a frame edge), wire-on-text, wire-on-icon, badge-on-icon, badge-on-text, badge-overlap, and for rules tables table-on-border, table-overlap (an icon or badge on a table), wire-on-table. Warnings: header-band, label-lines, tile-size, step-text (a step without text), step-order (numbers not 1..n). Info: icon-sizes, text-over-text. at is the finding\'s center in viewBox units; move the element or its label and lint again.',
      inputSchema: {
        type: 'object',
        properties: {
          spec: { type: 'object', description: 'One diagram spec (catalog/aws-kit/spec.schema.json).' },
          id: { type: 'string', description: 'A gallery diagram id instead of a spec, e.g. aws-tt-classic.' },
        },
        additionalProperties: false,
      },
      handler: async (a, { store }) => {
        let spec = a.spec;
        if (typeof spec === 'string') {
          try { spec = JSON.parse(spec); } catch (err) { throw new ToolError(`spec is not valid JSON: ${err.message}`, { code: 'invalid_argument' }); }
        }
        if ((spec == null) === (a.id == null)) throw new ToolError('pass exactly one of spec or id', { code: 'invalid_argument' });
        const kit = await diagramKit(store);
        if (a.id != null) {
          const specs = diagramSpecs(kit.dir);
          const hit = findDiagramSpec(specs, a.id);
          if (!hit) throw new ToolError(`No diagram spec with id "${a.id}"`, { code: 'not_found', data: { suggestions: suggestDiagrams(specs, a.id), available: specs.length } });
          spec = hit.spec;
        }
        if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new ToolError('spec must be one diagram object', { code: 'invalid_argument' });
        return lintDiagram(kit, spec);
      },
    },
    {
      name: 'import_diagram',
      description: 'Import an architecture design into the AWS kit: draw.io (.drawio XML, plain or compressed, or .drawio.svg; a .drawio.png as contentBase64), Mermaid architecture-beta or flowchart, PlantUML-AWS, D2, CloudFormation (JSON or YAML with short-form intrinsics; CDK synth output and SAM after transform included) or Terraform (terraform show -json of a plan or a state; raw HCL is rejected with how to get the JSON). Shapes, names and resource types resolve to the official AWS Architecture Icons (unmapped ones become plain boxes and are listed), groups to AWS frames, the layout is fitted to a kit tile and checked by the kit lint, and the request order (numbered badges or edges, a %% prism: flow directive, or for IaC a flows sidecar) becomes the animation. For CloudFormation and Terraform the VPC, subnets (public, private or isolated from the route tables), Availability Zone positions, placement and edges (listener to target group, security group chain with ports, DNS aliases, event sources, IAM resource ARNs as dashed weak edges) are inferred, and report.ledger lists every fact as derived, assumed or dropped with the resources it came from (the assumed ones carry a question for the customer). Without a flows sidecar IaC has no animation unless story is guess. With rules, security group rules become tables beside the drawing (console columns, IPv4 and IPv6 sources, prefix lists, group references by name), the rule that admits each story packet lighting up as it crosses; dual-stack subnets show both CIDRs as a two-line frame note and an egress-only internet gateway is drawn; a sidecar flow or step with v6: true sends IPv6 diamonds. Returns { spec, svg, report: { from, issues, unmapped, tile, lint, ledger?, rules? } }: edit spec and pass it to build_diagram, or export it with export_diagram.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The source text (draw.io XML, Mermaid, PlantUML, D2, a CloudFormation template, or terraform show -json output).' },
          contentBase64: { type: 'string', description: 'A binary source (a .drawio.png) as base64, instead of content.' },
          from: { type: 'string', enum: ['auto', 'drawio', 'mermaid', 'plantuml', 'd2', 'cfn', 'tf'], description: 'Source format; auto (default) detects it.' },
          id: { type: 'string', description: 'Diagram id for the spec (kebab case); derived from the source when absent.' },
          name: { type: 'string', description: 'Diagram name (title).' },
          story: { type: 'string', description: 'auto (default) animates the order the source gives (or guesses one and says so); none draws a still diagram. For cfn/tf: the id of a sidecar flow or story, or guess (a breadth-first walk from the internet-facing entry, reported as a guess).' },
          flows: { type: 'object', description: 'cfn/tf only: the flows sidecar (an object, or its JSON text) with what IaC cannot say: actors, flows (steps from/to logical ids with @az1/@primary/@standby qualifiers, label, kind request|async|replication|response|bad, text; response: reverse), stories (az-fail, asg-scale), story, hide, show, merge, pin, group_hints, overrides, anchors. See "Importing CloudFormation and Terraform" in catalog/drafts/AWS_KIT.md.' },
          params: { type: 'object', description: 'cfn only: Parameter values that override the template defaults when Conditions and Fn::If are evaluated, e.g. { "Environment": "prod" }.' },
          rules: { anyOf: [{ type: 'boolean' }, { type: 'array', items: { type: 'string' } }, { type: 'object' }], description: 'cfn/tf only: draw security group rules as tables (overrides the rules key of the sidecar). true: every group a drawn resource carries, the ones the story crosses first; a list of groups (logical ids, addresses or anchors); or { groups, outbound } where outbound is true (every shown group), false or restricted (the default: only groups whose egress is restricted). Columns Type, Protocol, Port range, Source; the default all-outbound and the implicit deny are muted rows, and the row that admits a story packet lights while it crosses. report.rules lists the tables and the groups left out.' },
          theme: { type: 'string', enum: ['auto', 'light', 'dark'], description: 'Colors of the returned standalone svg.' },
        },
        additionalProperties: false,
      },
      handler: async (a, { store }) => {
        if ((a.content == null) === (a.contentBase64 == null)) throw new ToolError('pass exactly one of content or contentBase64', { code: 'invalid_argument' });
        const content = a.content != null ? String(a.content) : Buffer.from(String(a.contentBase64), 'base64');
        if (!content.length) throw new ToolError('the source is empty', { code: 'invalid_argument' });
        let flows = a.flows;
        if (typeof flows === 'string') {
          try { flows = JSON.parse(flows); } catch (err) { throw new ToolError(`flows is not valid JSON: ${err.message}`, { code: 'invalid_argument' }); }
        }
        if (flows != null && (typeof flows !== 'object' || Array.isArray(flows))) throw new ToolError('flows must be a sidecar object', { code: 'invalid_argument' });
        if (a.params != null && (typeof a.params !== 'object' || Array.isArray(a.params))) throw new ToolError('params must be an object of parameter values', { code: 'invalid_argument' });
        if (a.rules != null && !(typeof a.rules === 'boolean' || (Array.isArray(a.rules) && a.rules.every((x) => typeof x === 'string')) || (typeof a.rules === 'object' && !Array.isArray(a.rules)))) throw new ToolError('rules must be true, a list of security group names, or { groups, outbound }', { code: 'invalid_argument' });
        const kit = await diagramKit(store);
        const imp = await importers(kit);
        let out;
        try { out = await imp.importDiagram(content, { from: a.from || 'auto', id: a.id, name: a.name, story: a.story || 'auto', flows: flows || undefined, params: a.params || undefined, rules: a.rules ?? undefined }); } catch (err) {
          throw new ToolError(`Import failed: ${err.message}`, { code: 'import_failed' });
        }
        return { spec: out.spec, svg: kit.awd.standalone(out.spec, { theme: a.theme || 'auto' }), report: out.report };
      },
    },
    {
      name: 'export_diagram',
      description: 'Export an AWS kit diagram (a gallery id such as aws-tt-classic, or a spec) to draw.io (.drawio XML that opens in diagrams.net with the official AWS shapes; the Prism spec rides on a hidden layer so a re-import restores the animation), Mermaid (a flowchart with AWS icon shapes, or architecture-beta when the layout is a consistent grid), a standalone SVG (animated, the static diagram, or frozen at one moment of its clock for slides and documents), a PNG of such a moment (drawn by headless Chrome or Edge on the server; at defaults to the poster moment of the spec, where tables show their lit rows and IPv6 packets their diamonds) or a storyboard (one still per numbered step, with its step text, at the moment of the step when it has one). draw.io carries the first line of a note and leaves the tables to the hidden Prism spec, which a re-import restores. Returns { to, text }; { to, at, width, height, base64 } for a PNG; { to, frames: [{ n, at, text, svg }] } for a storyboard.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'A gallery diagram id, e.g. aws-tt-classic or tt-classic.' },
          spec: { type: 'object', description: 'A diagram spec instead of an id.' },
          to: { type: 'string', enum: EXPORT_TO, description: 'Target format.' },
          dialect: { type: 'string', enum: ['flowchart', 'architecture-beta'], description: 'Mermaid only (default flowchart).' },
          theme: { type: 'string', enum: ['auto', 'light', 'dark'], description: 'SVG, PNG (default light) and storyboard.' },
          still: { type: 'boolean', description: 'SVG only: the complete static diagram, no packets.' },
          at: { anyOf: [{ type: 'number', minimum: 0, exclusiveMaximum: 1 }, { type: 'string', enum: ['poster'] }], description: "SVG and PNG: freeze the animation at this fraction of the clock (packets where they are, failed frames red), or 'poster' for the moment the spec names (a PNG's default). No animation is left." },
          scale: { type: 'number', minimum: 0.5, maximum: 4, description: 'PNG only: device pixels per diagram unit (default 2).' },
        },
        required: ['to'],
        additionalProperties: false,
      },
      handler: async (a, { store }) => {
        if ((a.spec == null) === (a.id == null)) throw new ToolError('pass exactly one of spec or id', { code: 'invalid_argument' });
        if (!EXPORT_TO.includes(a.to)) throw new ToolError(`to must be one of: ${EXPORT_TO.join(', ')}`, { code: 'invalid_argument' });
        const kit = await diagramKit(store);
        let spec = a.spec;
        if (typeof spec === 'string') {
          try { spec = JSON.parse(spec); } catch (err) { throw new ToolError(`spec is not valid JSON: ${err.message}`, { code: 'invalid_argument' }); }
        }
        if (a.id != null) {
          const specs = diagramSpecs(kit.dir);
          const hit = findDiagramSpec(specs, a.id);
          if (!hit) throw new ToolError(`No diagram spec with id "${a.id}"`, { code: 'not_found', data: { suggestions: suggestDiagrams(specs, a.id), available: specs.length } });
          spec = hit.spec;
        }
        const errs = kit.spec.validateDiagram(spec);
        if (errs.length) throw new ToolError('spec does not match the schema', { code: 'invalid_argument', data: { errors: errs.map((e) => `${e.path}: ${e.message}`) } });
        const imp = await importers(kit);
        if (a.at != null && a.to !== 'svg' && a.to !== 'png') throw new ToolError('at applies to svg and png exports only', { code: 'invalid_argument' });
        if (a.scale != null && (a.to !== 'png' || !(typeof a.scale === 'number' && a.scale >= 0.5 && a.scale <= 4))) throw new ToolError('scale is for png exports, from 0.5 to 4', { code: 'invalid_argument' });
        if (a.at != null && a.at !== 'poster' && !(typeof a.at === 'number' && a.at >= 0 && a.at < 1)) throw new ToolError("at must be a fraction of the clock in [0, 1) or 'poster'", { code: 'invalid_argument' });
        try {
          const out = await imp.exportDiagram(spec, { to: a.to, dialect: a.dialect, theme: a.theme, still: a.still === true, at: a.at, scale: a.scale });
          if (a.to === 'png') return { to: out.to, at: out.at, width: out.width, height: out.height, base64: out.png.toString('base64') };
          // the frames carry their own svg; the HTML page would repeat them all as base64
          return a.to === 'storyboard' ? { to: out.to, frames: out.frames } : out;
        } catch (err) {
          if (a.to === 'png' && /No Chrome|ENOENT|wrote no image/.test(err.message)) throw new ToolError(`PNG export needs a Chromium-family browser on the server: ${err.message.split('\n')[0]}`, { code: 'unavailable' });
          throw new ToolError(`Export failed: ${err.message}`, { code: 'export_failed' });
        }
      },
    },
  ];
}

/**
 * The top-bar accent pairs Prism's theme gate holds (catalog/_check_themes.mjs SHELL_PAIRS) and the
 * engine's PAIRS leave out: --cs-topnav-accent (else --accent) as UI on --cs-topnav-bg, and
 * --cs-topnav-accent-ink (else --accent-ink, else #fff) as text on that fill. Added to r in place.
 */
function topBarAccentPairs(C, t, r) {
  const pick = (chain) => { for (const k of chain) { if (k.startsWith('#')) return { k, v: k }; if (t[k] != null) return { k, v: t[k] }; } return null; };
  const backdrop = r.mode === 'dark' ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  const bgP = C.parseColor(t['--bg']);
  const bgRgb = bgP ? C.composite(bgP, backdrop) : backdrop;
  const solid = (v, over) => { const c = C.parseColor(v); return c ? (c.a >= 1 ? c : C.composite(c, over)) : null; };
  const floors = r.contrast === 'AAA' ? { ui: 3, text: 7 } : { ui: 3, text: 4.5 };
  const defs = [
    { fg: ['--cs-topnav-accent', '--accent'], bg: ['--cs-topnav-bg'], kind: 'ui' },
    { fg: ['--cs-topnav-accent-ink', '--accent-ink', '#ffffff'], bg: ['--cs-topnav-accent', '--accent'], kind: 'text' },
  ];
  for (const d of defs) {
    const f = pick(d.fg), b = pick(d.bg);
    // without the top-bar tokens the ink pair falls back to --accent-ink on --accent: already checked
    if (f && b && r.pairs.some((p) => p.fg === f.k && p.bg === b.k)) continue;
    const bRgb = b && solid(b.v, d.bg[0] === '--cs-topnav-bg' ? bgRgb : (solid(t['--cs-topnav-bg'], bgRgb) || bgRgb));
    const fRgb = f && bRgb && solid(f.v, bRgb);
    if (!fRgb || !bRgb) { r.skipped.push({ fg: d.fg[0], bg: d.bg[0], reason: `${!bRgb ? d.bg[0] : d.fg[0]} is missing or not a color` }); continue; }
    const ratio = C.contrastRatio(fRgb, bRgb);
    const floor = floors[d.kind];
    const pair = { mode: r.mode, fg: f.k, bg: b.k, kind: d.kind, fgValue: C.toHex(fRgb), bgValue: C.toHex(bRgb), ratio: C.round(ratio, 2), floor, pass: ratio >= floor, apca: C.round(C.apcaContrast(fRgb, bRgb), 1) };
    r.pairs.push(pair);
    if (!pair.pass) { r.failures.push(pair); r.pass = false; }
  }
}

/** The kit's import/export entry point (catalog/aws-kit/import/index.mjs), or a structured 'unavailable' error. */
async function importers(kit) {
  try { return await import(pathToFileURL(path.join(kit.dir, 'import', 'index.mjs')).href); } catch (err) {
    throw new ToolError(`The AWS kit importers are not reachable at ${path.join(kit.dir, 'import')}: ${err.message}`, { code: 'unavailable' });
  }
}

/** The AWS kit beside the loaded catalog, or a structured 'unavailable' error. */
async function diagramKit(store) {
  let kit = null;
  try { kit = await loadKit(store.filePath); } catch (err) {
    throw new ToolError(`The AWS kit beside ${store.filePath} failed to load: ${err.message}`, { code: 'unavailable' });
  }
  if (!kit) {
    throw new ToolError(`The AWS kit is not reachable from the catalog at ${store.filePath}: expected catalog/aws-kit/awd.mjs next to Prism.html, or aws-kit/awd.mjs next to catalog/manifest.json (a full Prism checkout)`, { code: 'unavailable' });
  }
  return kit;
}

/** The theme engine beside the loaded catalog, or a structured 'unavailable' error. */
async function themeEngine(store) {
  let eng = null;
  try { eng = await loadEngine(store.filePath); } catch (err) {
    throw new ToolError(`The theme engine beside ${store.filePath} failed to load: ${err.message}`, { code: 'unavailable' });
  }
  if (!eng) {
    throw new ToolError(`The theme engine is not reachable from the catalog at ${store.filePath}: expected catalog/theme-engine/derive.mjs next to Prism.html, or theme-engine/derive.mjs next to catalog/manifest.json (a full Prism checkout)`, { code: 'unavailable' });
  }
  return eng;
}

/** Ids within an edit distance of max from text, nearest first. */
function closeIds(ids, text, max) {
  const t = String(text).toLowerCase();
  const dist = (x, y) => {
    if (Math.abs(x.length - y.length) > max) return max + 1;
    let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
    for (let i = 1; i <= x.length; i++) {
      const cur = [i];
      for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[y.length];
  };
  return ids.map((id) => ({ id, d: dist(id, t) })).filter((x) => x.d <= max).sort((a, b) => a.d - b.d || a.id.localeCompare(b.id)).map((x) => x.id);
}

/**
 * Defense-in-depth for inlining composed content into a generated HTML document.
 * - In the <style> context (htmlBody=false), the only escape hatch is a literal
 *   "</style>"; a stray "</script>" is also neutralized for good measure. We break the
 *   sequence with a CSS-legal backslash escape so the HTML tokenizer won't match it.
 * - In the <body> context (htmlBody=true), the content is rendered as markup, so we
 *   neutralize inline <script> openers/closers (facets are self-contained CSS/SVG/DOM
 *   markup and never carry inline scripts) to prevent script execution.
 */
function neutralizeClosers(text, htmlBody = false) {
  let out = String(text);
  if (htmlBody) {
    // Body content is parsed as markup: neutralize any <script>/</script> opener/closer.
    out = out.replace(/<\s*(\/?)\s*script/gi, '&lt;$1script');
  } else {
    // A <style> element's content is raw text that ends only at "</style>"; that closer
    // is the sole breakout. We also break any style/script token (opening or closing) with
    // a CSS-legal backslash so no "<script>"/"</style>" substring survives verbatim.
    out = out.replace(/<\s*(\/?)\s*(style|script)/gi, '<\\$1$2');
  }
  return out;
}
