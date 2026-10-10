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
import { THEMES, THEME_IDS, TOKEN_META, BASE_TOKENS, getTheme, baseTokensFor, usesTokens, themeRootCss, isThemeSensitive, themeIdList, themesSummary } from '../utils/themes.js';
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

function matchScore(effect, q) {
  // Simple weighted relevance over id/name/description/tags/category.
  const ql = q.toLowerCase();
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
  const parts = Array.isArray(raw) ? raw : [raw];
  const seen = new Set();
  for (const part of parts) {
    for (const tok of String(part).toLowerCase().split(/[\s,]+/)) {
      const t = tok.trim();
      if (!t) continue;
      seen.add(INTERACTION_FIX[t] || t);
    }
  }
  return Array.from(seen);
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

export function buildTools() {
  return [
    // ============================== DISCOVERY (11) ==============================
    {
      name: 'list_effects',
      description: 'List effects in the catalog with optional filters (gallery, tag, componentType, role, dataShape, background-capable, new/fixed). Returns lightweight metadata (no html/css) with pagination. For relevance ranking or multi-value facets use search_effects.',
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
      description: 'Faceted relevance search over the catalog. Full-text ranks across id/name/description/tags/category/role/dataShape; the optional `filters` object narrows by gallery, componentType, spectrum (aesthetic), category, role (component purpose), dataShape (chart/map/diagram data relationship), tag (AND), and interaction, plus boolean flags (isNew, usableAsBackground, needsJs, isFixed, selfContained, selfAnimates, reducedMotionSafe). Pick by intent with `roles` (e.g. loading, feedback, navigation), pick the right chart with `dataShapes` (e.g. time-series, part-to-whole), and respect motion prefs with reducedMotionSafe:true / selfAnimates:false. `sort` controls ordering (relevance/name/newest/gallery) and offset/limit paginate. query is optional when filters are given. Use get_available_filters to discover valid facet values.',
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
      name: 'get_effect',
      description: 'Fetch the complete record for one effect by id, including production-ready html and css, classes, keyframes, params, and whether it needs a JS initializer.',
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
        const e = store.get(a.id);
        if (!e) {
          const suggestions = store.all()
            .map((x) => ({ id: x.id, score: matchScore(x, a.id) }))
            .filter((x) => x.score > 0).sort((x, y) => y.score - x.score).slice(0, 5).map((x) => x.id);
          throw new ToolError(`No effect with id "${a.id}"`, { code: 'not_found', data: { suggestions } });
        }
        const out = { ...e };
        if (a.includeCss === false) delete out.css;
        if (a.includeHtml === false) delete out.html;
        return out;
      },
    },
    {
      name: 'get_theme_variants',
      description: 'Return the theme token reference and how to recolor an effect. Includes the global tokens.css and the semantic color tokens (accent, pos, neg, warn, info, crit) that themes override.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: (a, { store }) => {
        const tokens = store.tokens();
        return {
          tokensCss: tokens ? tokens.css : null,
          tokensNote: tokens ? tokens.note : null,
          semanticTokens: ['--accent', '--info', '--pos', '--neg', '--warn', '--crit'],
          surfaceTokens: ['--bg', '--panel', '--panel2', '--card', '--line', '--control-line', '--ink', '--muted', '--dim'],
          recolor: 'Set --c and --c-rgb (or add a c-* class like c-pos) on the effect element to recolor it.',
          // Derived from the theme registry (utils/themes.js) so scaffolded packs
          // (F6) surface here automatically — no hand-editing this list.
          builtInThemes: THEME_IDS,
          note: themesSummary(),
        };
      },
    },
    {
      name: 'get_theme_palette',
      description: 'Return the token palette for one theme (or all themes). Prism themes are pure :root token overrides applied over identical component HTML/CSS, so a palette fully defines how every component looks in that theme. Each theme returns its complete token map, the overrides vs the Cloudscape Dark base, mode (light/dark), and a ready-to-paste :root{…} CSS block. Themes: ' + themeIdList() + '.',
      inputSchema: {
        type: 'object',
        properties: {
          theme: { type: 'string', enum: THEME_IDS, description: 'A theme id. Omit to return all themes.' },
        },
        additionalProperties: false,
      },
      handler: (a) => {
        const shape = (t) => ({
          id: t.id, name: t.name, mode: t.mode, builtin: t.builtin,
          tokens: t.tokens, overrides: t.overrides,
          overrideCount: Object.keys(t.overrides).length,
          css: themeRootCss(t.id),
        });
        if (a.theme) {
          const t = getTheme(a.theme);
          if (!t) throw new ToolError(`No theme "${a.theme}"`, { code: 'not_found', data: { themes: THEME_IDS } });
          return shape(t);
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
        const e = store.get(a.id);
        if (!e) {
          const suggestions = store.all().map((x) => ({ id: x.id, score: matchScore(x, a.id) }))
            .filter((x) => x.score > 0).sort((x, y) => y.score - x.score).slice(0, 5).map((x) => x.id);
          throw new ToolError(`No effect with id "${a.id}"`, { code: 'not_found', data: { suggestions } });
        }
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
      description: 'Derive a complete Prism theme from brand inputs: every theme token (surfaces, text, accent, status colors with their -rgb triplets, gradient, elevation, radius scale, font, density, top-nav chrome, plus --accent-ink for text on accent fills) for dark and light mode, contrast-safe by construction. The accent keeps its hue; its OKLCH lightness moves per mode only when it misses a floor (4.5:1 text on the panels, 3:1 UI on bg, readable ink on accent fills; 7:1 text with contrast AAA). Neutrals keep the brand hue at low chroma; status colors use the conventional hues at the accent\'s chroma and one shared lightness. Deterministic. Returns { name, dark, light, css: { dark, light } (paste-ready :root blocks), report: { pairs: [{ mode, fg, bg, ratio, floor, pass, apca }], failures, moved (inputs it had to move, with a message such as "accent #ffd400 too light for text on a light panel: darkened to #897000, L 0.88 to 0.55"), notes, summary } }. A mode not requested is null. To ship it as a pack: catalog/theme-engine/derive.mjs --profile out.mjs, then catalog/_scaffold_ds.mjs.',
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
      description: 'Check a theme token map against the contrast floors derive_theme uses: ink, muted (4.5:1 text) and dim (3:1) on bg/panel/panel2/card; accent and the five status colors as text on panel/panel2/card and as UI on bg; ink on accent fills (--accent-ink, or #fff when absent, the ink Prism\'s generated facets use); accent2 as UI; top-nav ink and dim; control-line (the input, checkbox and switch boundary) as UI on bg/panel/panel2/card; line as an unscored decorative pair. Pass tokens (a partial or full map of --token: value; rgba surfaces are composited over --bg) or theme (a shipped theme id). Missing tokens are filled from the Cloudscape base of the mode, as Prism layers a pack over it (fill: false to check only what you pass). mode is inferred from the surfaces when omitted. Returns { mode, contrast, pass, checked, failures, pairs: [{ fg, bg, fgValue, bgValue, ratio, floor, pass, apca }], skipped, filledFromBase }.',
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
          const base = baseTokensFor(mode);
          full = { ...base, ...tokens };
          for (const k of Object.keys(base)) if (!(k in tokens)) filledFromBase.push(k);
        }
        let r;
        try { r = eng.derive.checkContrast(full, { mode, contrast: a.contrast || 'AA' }); } catch (err) { throw new ToolError(err.message, { code: 'invalid_argument' }); }
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
          booleanFlags: boolFlagCounts(all),
          sorts: SORTS,
          notes: [
            'tags filter uses AND (an effect must have every selected tag); all other array facets use OR.',
            'interaction values are normalized from noisy source data (e.g. "tatic"→static, "focu"→focus, "croll"→scroll).',
            'No performance or theme-compatibility facet exists in the catalog; those are intentionally omitted.',
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
      description: 'Compose multiple effects (by id) into one production-ready bundle: merged HTML, deduplicated + token-merged CSS, list of required JS initializers, validation, and size metrics. Reports composition conflicts in `conflicts` (CSS selectors that two effects define differently — the later wins when bundled) and `backgroundConflict` (multiple background-layer effects). Optionally wrap the markup in a container.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: { ...strArr, description: 'Effect ids to compose, in display order', minItems: 1 },
          includeTokens: { type: 'boolean', default: true, description: 'Prepend the global tokens.css' },
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
        const res = compose(a.ids, store, { includeTokens: a.includeTokens, wrap: a.wrap, separator: a.separator });
        if (!res.ok) throw new ToolError('Composition failed', { code: 'compose_failed', data: { errors: res.errors, missing: res.missing } });
        return res;
      },
    },
    {
      name: 'compose_with_template',
      description: `Compose effects into a named layout template. Templates arrange the effects: ${availableTemplates().join(', ')}. Returns the same bundle shape as compose plus the applied template.`,
      inputSchema: {
        type: 'object',
        properties: {
          ids: { ...strArr, description: 'Effect ids to compose', minItems: 1 },
          template: { type: 'string', enum: availableTemplates(), default: 'stack' },
          includeTokens: { type: 'boolean', default: true },
        },
        required: ['ids'],
        additionalProperties: false,
      },
      handler: (a, { store }) => {
        if (!Array.isArray(a.ids) || a.ids.length === 0) throw new ToolError('ids must be a non-empty array', { code: 'invalid_argument' });
        const res = composeWithTemplate(a.ids, store, a.template || 'stack', { includeTokens: a.includeTokens });
        if (!res.ok) throw new ToolError('Composition failed', { code: 'compose_failed', data: { errors: res.errors, missing: res.missing } });
        return res;
      },
    },
    {
      name: 'validate_composition',
      description: 'Validate that a set of effect ids can be composed: checks each id exists, flags missing ones, reports which effects need JS initializers or are not self-contained, and detects composition conflicts — CSS selectors that two effects define differently (the later silently wins when bundled) and multiple background-layer effects (only one renders). Does not build output.',
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
      description: 'Export effects as a self-contained bundle. Three sources (in priority order): a saved collectionId, an explicit set of ids, or an entire gallery. format="bundle" (default) returns merged deduped CSS + each effect\'s html; format="document" adds a complete standalone <html> document; format="schema" returns the portable prism-collection-1.0 JSON (importable by the Prism.html UI). Only a saved collectionId can produce format="schema".',
      inputSchema: {
        type: 'object',
        properties: {
          collectionId: { type: 'string', description: 'Export a saved collection by id (takes priority over ids/gallery)' },
          ids: { ...strArr, description: 'Effect ids to include (omit if using collectionId or gallery)' },
          gallery: { type: 'string', description: 'Export an entire gallery instead of explicit ids' },
          format: { type: 'string', enum: ['bundle', 'document', 'schema'], default: 'bundle', description: 'bundle (CSS+HTML), document (full <html>), or schema (prism-collection-1.0 JSON)' },
          title: { type: 'string', default: 'Prism Collection' },
          asDocument: { type: 'boolean', default: false, description: 'Deprecated alias for format="document"' },
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
          const composed = compose(ids, store, { includeTokens: a.includeTokens });
          const totalSize = composed.ok ? Buffer.byteLength((composed.css || '') + (composed.html || '')) : null;
          return toExportSchema(sourceCollection, { totalSize });
        }

        const title = a.title || (sourceCollection && sourceCollection.name) || 'Prism Collection';
        const res = compose(ids, store, { includeTokens: a.includeTokens });
        if (!res.ok) throw new ToolError('Export failed', { code: 'export_failed', data: { errors: res.errors, missing: res.missing } });
        const bundle = { title, effects: res.effects, css: res.css, html: res.html, initializers: res.initializers, metrics: res.metrics };
        if (sourceCollection) bundle.collectionId = sourceCollection.id;
        if (format === 'document') {
          // Defense-in-depth: even though the catalog is trusted by design, when we
          // inline CSS into a <style> block a stray "</style>" (or "</script>") would
          // close the tag early and let following bytes be parsed as markup/script.
          // Neutralize those sequences so composed content can't break out of context.
          const safeCss = neutralizeClosers(res.css);
          const safeBodyHtml = neutralizeClosers(res.html, /* htmlBody */ true);
          bundle.document = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>${escapeHtml(bundle.title)}</title>\n<style>\n${safeCss}\n</style>\n</head>\n<body>\n${safeBodyHtml}\n</body>\n</html>\n`;
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
      description: 'Return the canonical CSS token reference for building/theming facets: the global tokens.css, the list of themeable tokens with descriptions, and recolor guidance.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: (a, { store }) => {
        const tokens = store.tokens();
        return {
          tokensCss: tokens ? tokens.css : null,
          note: tokens ? tokens.note : null,
          tokens: [
            { token: '--bg', purpose: 'Page background base' },
            { token: '--panel', purpose: 'Card / panel surface' },
            { token: '--panel2', purpose: 'Secondary surface' },
            { token: '--card', purpose: 'Card fill' },
            { token: '--line', purpose: 'Borders / separators' },
            { token: '--ink', purpose: 'Primary text' },
            { token: '--muted', purpose: 'Secondary text' },
            { token: '--dim', purpose: 'Tertiary / disabled text' },
            { token: '--accent', purpose: 'Brand / primary accent (also --accent-rgb)' },
            { token: '--info', purpose: 'Informational / links (also --info-rgb)' },
            { token: '--pos', purpose: 'Positive / success (also --pos-rgb)' },
            { token: '--warn', purpose: 'Warning / caution (also --warn-rgb)' },
            { token: '--neg', purpose: 'Negative / danger (also --neg-rgb)' },
            { token: '--crit', purpose: 'Critical / special (also --crit-rgb)' },
            { token: '--c / --c-rgb', purpose: 'Per-element active color; set to recolor an effect' },
            { token: '--cardgrad', purpose: 'Standard card gradient overlay' },
          ],
          recolorClasses: ['c-accent', 'c-info', 'c-pos', 'c-warn', 'c-neg', 'c-crit'],
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
      description: 'Search the official AWS Architecture Icons that ship with Prism (services, resources, group frames, categories) by words over name, id, service, category, aliases and crosswalk names, e.g. "lambda", "managed microsoft ad", "nat gateway", "ALB", "AWS::S3::Bucket". Every word must match a whole word or the start of one, so "ecr" does not find Secrets Manager. Exact names, abbreviations and old names (S3, NACL, DAX, Elasticsearch, QuickSight) rank first. Colorway pairs (separate artwork for dark and light backgrounds) collapse into one result keyed by the base id; retired and renamed icons carry status. Use resolve_aws_icon to pick one icon for a name, get_aws_icon for the SVG.',
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
        return { source: pack.source, total: hits.length, offset, count: items.length, items };
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
          const suggestions = [...new Set([...near, ...suggestIcons(pack.icons, a.id)])].slice(0, 5);
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
      description: 'Build an AWS architecture diagram from a JSON spec with the AWS kit behind the AWS Architecture gallery: official AWS icons and group frames, numbered steps, and packets on one SMIL clock. Pass one diagram object ({ id, name, desc, w, h, dur, groups, nodes, wires, steps, timeline, effects, notes }; or flows instead of timeline and steps: { path: [node ids], reply, text: [one per hop] } compiles to packets, rings and numbered steps) or a family file ({ version: 1, section, diagrams }). Runs the schema and the kit\'s input checks; returns { id, svg, html, errors, lint }: lint lists layout findings (text across a frame edge, wires through labels or icons, badges on icons, off-canvas...; the gallery build rejects severity error, so fix those and rebuild); svg is one self-contained SVG document (kit CSS, only the icons it uses, the spec in <metadata id="awd-spec">), html is the bare <svg class="awd"> the gallery embeds (needs the kit CSS and icon sprite on the page). svg and html are null when errors is not empty. A family returns { section, diagrams: [...], errors }. Start from get_diagram_spec for a working example; find icon ids with search_aws_icons.',
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
      description: 'Get the JSON spec of one AWS Architecture gallery diagram by id (catalog id such as aws-sl-api, or spec id sl-api). About 8x smaller than the rendered html from get_effect, and editable: change it and pass it to build_diagram. Returns { id, catalogId, family, version, spec, source }.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Diagram id, e.g. aws-sl-api or sl-api.' } },
        required: ['id'],
        additionalProperties: false,
      },
      handler: async (a, { store }) => {
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
      description: 'Check an AWS architecture diagram\'s layout against the kit\'s rules without building it: pass a diagram spec, or the id of a gallery diagram (aws-sl-api or sl-api). Measures text with Arial\'s real widths on the drawn markup (timed captions and raw extra included). Returns { id, errors, findings: [{ severity, code, message, at }], counts, clean }. Errors (the gallery build rejects them): off-canvas, icon-overlap, text-overlap, text-on-icon, text-on-border (text across or within 2px of a frame edge), wire-on-text, wire-on-icon, badge-on-icon, badge-on-text, badge-overlap. Warnings: header-band, label-lines, tile-size. Info: icon-sizes, text-over-text. at is the finding\'s center in viewBox units; move the element or its label and lint again.',
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
      description: 'Import an architecture design into the AWS kit: draw.io (.drawio XML, plain or compressed, or .drawio.svg; a .drawio.png as contentBase64), Mermaid architecture-beta or flowchart, PlantUML-AWS or D2. Shapes and names resolve to the official AWS Architecture Icons (unmapped ones become plain boxes and are listed), groups to AWS frames, the layout is fitted to a kit tile and checked by the kit lint, and the request order (numbered badges or edges, or a %% prism: flow directive) becomes the animation. Returns { spec, svg, report: { from, issues, unmapped, tile, lint } }: edit spec and pass it to build_diagram, or export it with export_diagram.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The source text (draw.io XML, Mermaid, PlantUML or D2).' },
          contentBase64: { type: 'string', description: 'A binary source (a .drawio.png) as base64, instead of content.' },
          from: { type: 'string', enum: ['auto', 'drawio', 'mermaid', 'plantuml', 'd2'], description: 'Source format; auto (default) detects it.' },
          id: { type: 'string', description: 'Diagram id for the spec (kebab case); derived from the source when absent.' },
          name: { type: 'string', description: 'Diagram name (title).' },
          story: { type: 'string', enum: ['auto', 'none'], description: 'auto (default) animates the order the source gives (or guesses one and says so); none draws a still diagram.' },
          theme: { type: 'string', enum: ['auto', 'light', 'dark'], description: 'Colors of the returned standalone svg.' },
        },
        additionalProperties: false,
      },
      handler: async (a, { store }) => {
        if ((a.content == null) === (a.contentBase64 == null)) throw new ToolError('pass exactly one of content or contentBase64', { code: 'invalid_argument' });
        const content = a.content != null ? String(a.content) : Buffer.from(String(a.contentBase64), 'base64');
        if (!content.length) throw new ToolError('the source is empty', { code: 'invalid_argument' });
        const kit = await diagramKit(store);
        const imp = await importers(kit);
        let out;
        try { out = await imp.importDiagram(content, { from: a.from || 'auto', id: a.id, name: a.name, story: a.story || 'auto' }); } catch (err) {
          throw new ToolError(`Import failed: ${err.message}`, { code: 'import_failed' });
        }
        return { spec: out.spec, svg: kit.awd.standalone(out.spec, { theme: a.theme || 'auto' }), report: out.report };
      },
    },
    {
      name: 'export_diagram',
      description: 'Export an AWS kit diagram (a gallery id such as aws-tt-classic, or a spec) to draw.io (.drawio XML that opens in diagrams.net with the official AWS shapes; the Prism spec rides on a hidden layer so a re-import restores the animation), Mermaid (a flowchart with AWS icon shapes, or architecture-beta when the layout is a consistent grid), a standalone SVG (animated, the static diagram, or frozen at one moment of its clock for slides and documents), a PNG of such a moment (drawn by headless Chrome or Edge on the server) or a storyboard (one still per numbered step, with its step text). Returns { to, text }; { to, at, width, height, base64 } for a PNG; { to, frames: [{ n, at, text, svg }] } for a storyboard.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'A gallery diagram id, e.g. aws-tt-classic or tt-classic.' },
          spec: { type: 'object', description: 'A diagram spec instead of an id.' },
          to: { type: 'string', enum: ['drawio', 'mermaid', 'svg', 'png', 'storyboard'], description: 'Target format.' },
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
        const kit = await diagramKit(store);
        let spec = a.spec;
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

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
