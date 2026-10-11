// Composition engine: turn a set of effect ids into one production-ready bundle
// (merged HTML + deduped/token-merged CSS + validation + a trace of what happened).

import { dedupeCss, mergeRootTokens, validateCss } from './css.js';
import { validateComposition } from './validate.js';
import { themeCss, initializerScripts } from './apply.js';

/**
 * Compose effects into a single bundle.
 * @param {string[]} ids       effect ids, in the order they should appear
 * @param {CatalogStore} store
 * @param {object} opts
 *   - includeTokens: prepend a token block (default true)
 *   - palette: the theme to prepend (utils/apply.js resolvePalette: every token of the theme, Auto
 *     included, plus the .c-* recolor classes), or null for none. Absent: the catalog's tokens.css.
 *   - wrap: optional {tag, className, style} wrapper around the combined HTML
 *   - separator: HTML joined with this (default '\n')
 * @returns {object} composition result with html, css, trace, validation, metrics
 */
export function compose(ids, store, opts = {}) {
  const { includeTokens = true, wrap = null, separator = '\n' } = opts;
  const hasPalette = Object.prototype.hasOwnProperty.call(opts, 'palette');
  const trace = [];
  const t0 = Date.now();

  // The wrapper tag is written into the markup as is: only a plain element name may pass.
  if (wrap && wrap.tag != null && !/^[a-z][a-z0-9-]*$/i.test(String(wrap.tag))) {
    return { ok: false, errors: [`wrap.tag must be an element name such as section or div, not "${String(wrap.tag).slice(0, 40)}"`], warnings: [], missing: [] };
  }
  const check = validateComposition(ids, store);
  if (!check.valid) {
    return {
      ok: false,
      errors: check.errors,
      warnings: check.warnings,
      missing: check.missing,
    };
  }

  const effects = check.resolved;
  trace.push(`Resolved ${effects.length} effect(s): ${effects.map((e) => e.id).join(', ')}`);
  if (check.conflicts && check.conflicts.length) {
    trace.push(`⚠ ${check.conflicts.length} selector collision(s): ${check.conflicts.map((c) => c.selector).join(', ')} (later rule wins)`);
  }
  if (check.backgroundConflict) {
    trace.push(`⚠ Multiple background layers: ${check.backgroundConflict.join(', ')} (only one renders)`);
  }

  // --- HTML ---
  // AWS diagrams each carry a hidden sprite of the icon <symbol>s they use. Composing several would
  // repeat shared symbols (duplicate ids), so the sprites are lifted out and merged into one.
  const hoisted = hoistSprites(effects.map((e) => e.html || ''));
  const perEffectHtml = hoisted.html;
  if (hoisted.removed) trace.push(`Merged ${hoisted.sprites} icon sprite(s) into one: ${hoisted.symbols} symbol(s), ${hoisted.removed} duplicate(s) dropped`);
  let html = perEffectHtml.join(separator);
  if (wrap && wrap.tag) {
    const cls = wrap.className ? ` class="${escapeAttr(wrap.className)}"` : '';
    const sty = wrap.style ? ` style="${escapeAttr(wrap.style)}"` : '';
    html = `<${wrap.tag}${cls}${sty}>\n${html}\n</${wrap.tag}>`;
    trace.push(`Wrapped markup in <${wrap.tag}>`);
  }
  if (hoisted.sprite) html += '\n' + hoisted.sprite;

  // --- CSS: gather, optionally prepend tokens, dedupe, merge :root ---
  const cssSources = [];
  if (includeTokens && hasPalette) {
    if (opts.palette) {
      cssSources.push(themeCss(opts.palette));
      trace.push(`Included the ${opts.palette.name} token block${opts.palette.mode === 'auto' ? ' (dark, light under prefers-color-scheme or data-mode)' : ''} and the .c-* recolor classes`);
    }
  } else if (includeTokens && store.tokens() && store.tokens().css) {
    cssSources.push(store.tokens().css);
    trace.push('Included global tokens.css');
  }
  for (const e of effects) if (e.css) cssSources.push(e.css);

  const naiveLength = cssSources.join('\n').length;
  const deduped = dedupeCss(cssSources);
  const merged = mergeRootTokens(deduped.css);
  const finalCss = merged.css;
  trace.push(`Deduped CSS: ${deduped.rulesIn} → ${deduped.rulesOut} rules (${deduped.duplicatesRemoved} duplicates removed)`);
  if (merged.rootBlocksCollapsed > 1) trace.push(`Merged ${merged.rootBlocksCollapsed} :root blocks → ${merged.tokensMerged} tokens`);

  // --- initializers needed ---
  const initializers = Array.from(new Set(effects.map((e) => e.needsJs).filter(Boolean)));
  if (initializers.length) trace.push(`Requires JS initializers: ${initializers.join(', ')}`);
  const scripts = initializerScripts(effects, store);

  const validation = validateCss(finalCss);

  const reduction = naiveLength > 0 ? (naiveLength - finalCss.length) / naiveLength : 0;

  return {
    ok: true,
    html,
    css: finalCss,
    effects: effects.map((e) => e.id),
    initializers,
    scripts,
    warnings: check.warnings,
    conflicts: check.conflicts || [],
    backgroundConflict: check.backgroundConflict || null,
    validation,
    trace,
    _perEffectHtml: perEffectHtml,
    _sprite: hoisted.sprite,
    metrics: {
      effectCount: effects.length,
      rulesIn: deduped.rulesIn,
      rulesOut: deduped.rulesOut,
      duplicatesRemoved: deduped.duplicatesRemoved,
      naiveCssLength: naiveLength,
      finalCssLength: finalCss.length,
      reductionPct: Math.round(reduction * 1000) / 10, // one decimal place
      composeMs: Date.now() - t0,
    },
  };
}

/**
 * Compose using a named layout template. Templates position slots of effects.
 * Currently supported templates: 'stack' (vertical), 'row' (flex row), 'grid' (auto-fit grid),
 * 'card' (wrap each effect in a padded panel then arrange in a grid), 'backdrop' (a hero: the first
 * usableAsBackground effect fills the section behind the others).
 */
export function composeWithTemplate(ids, store, templateName = 'stack', opts = {}) {
  const template = TEMPLATES[templateName];
  if (!template) {
    return { ok: false, errors: [`Unknown template "${templateName}". Available: ${Object.keys(TEMPLATES).join(', ')}`] };
  }
  const base = compose(ids, store, { ...opts, wrap: null });
  if (!base.ok) return base;

  const wrapper = template.build(ids, store);
  const css = [base.css, wrapper.css].filter(Boolean).join('\n');
  base.trace.push(`Applied template "${templateName}"`);
  if (wrapper.note) base.warnings = [...(base.warnings || []), wrapper.note];
  return {
    ...base,
    html: wrapper.html(base),
    css,
    template: templateName,
  };
}

const TEMPLATES = {
  stack: {
    build: () => ({
      css: '.prism-compose-stack{display:flex;flex-direction:column;gap:16px}',
      html: (b) => `<div class="prism-compose-stack">\n${b.html}\n</div>`,
    }),
  },
  row: {
    build: () => ({
      css: '.prism-compose-row{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}',
      html: (b) => `<div class="prism-compose-row">\n${b.html}\n</div>`,
    }),
  },
  grid: {
    build: () => ({
      css: '.prism-compose-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}',
      html: (b) => `<div class="prism-compose-grid">\n${b.html}\n</div>`,
    }),
  },
  // A hero: the first backdrop (usableAsBackground) fills the section behind the other effects. A
  // gallery backdrop is drawn as a tile (a fixed width, height and radius on its root), so its root is
  // stretched to the section here.
  backdrop: {
    build: (ids, store) => {
      const is = (test) => ids.findIndex((id) => { const e = store.get(id); return e && test(e); });
      // the authored flag first; layer 'background' (derived) only when no id carries it
      let bgAt = is((e) => e.usableAsBackground);
      if (bgAt < 0) bgAt = is((e) => e.layer === 'background');
      return {
        css: '.prism-compose-backdrop{position:relative;isolation:isolate;overflow:hidden;min-height:360px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:48px 24px;box-sizing:border-box}'
          + '.prism-compose-bg{position:absolute;inset:0;z-index:0}'
          + '.prism-compose-bg>*{position:absolute!important;inset:0!important;width:100%!important;max-width:none!important;height:100%!important;margin:0!important;border-radius:0!important}'
          + '.prism-compose-fg{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:16px}',
        html: (b) => {
          const parts = b._perEffectHtml || [b.html];
          const bg = bgAt >= 0 ? `<div class="prism-compose-bg" aria-hidden="true">${parts[bgAt]}</div>\n` : '';
          const fg = parts.filter((_, i) => i !== bgAt).join('\n');
          return `<section class="prism-compose-backdrop">\n${bg}<div class="prism-compose-fg">\n${fg}\n</div>\n</section>` + (b._sprite ? '\n' + b._sprite : '');
        },
        note: bgAt < 0 ? 'No backdrop among the ids (usableAsBackground): the effects stack on a plain section.' : null,
      };
    },
  },
  card: {
    build: () => ({
      css: '.prism-compose-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}'
        + '.prism-compose-card{background:var(--panel,#121623);border:1px solid var(--line,#243049);border-radius:12px;padding:16px}',
      // For 'card' we re-wrap each effect individually.
      html: (b) => {
        const wrapped = b._perEffectHtml
          ? b._perEffectHtml.map((h) => `<div class="prism-compose-card">${h}</div>`).join('\n') + (b._sprite ? '\n' + b._sprite : '')
          : `<div class="prism-compose-card">${b.html}</div>`;
        return `<div class="prism-compose-grid">\n${wrapped}\n</div>`;
      },
    }),
  },
};

export function availableTemplates() {
  return Object.keys(TEMPLATES);
}

// The hidden sprite the catalog extractor appends to an AWS diagram's html (catalog/extract-from-prism.mjs).
const SPRITE_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">';
const SPRITE_RE = /\n?<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="0" height="0" style="position:absolute" aria-hidden="true">((?:<symbol\b[\s\S]*?<\/symbol>)+)<\/svg>/g;

/** Lift each effect's icon sprite out of its html and merge them, first copy of each symbol id wins. */
export function hoistSprites(htmls) {
  const symbols = new Map();
  let sprites = 0, seen = 0;
  const html = htmls.map((h) => h.replace(SPRITE_RE, (_, inner) => {
    sprites++;
    for (const m of inner.matchAll(/<symbol id="([^"]+)"[\s\S]*?<\/symbol>/g)) {
      seen++;
      if (!symbols.has(m[1])) symbols.set(m[1], m[0]);
    }
    return '';
  }));
  const sprite = symbols.size ? `${SPRITE_OPEN}${[...symbols.values()].join('')}</svg>` : '';
  return { html, sprite, sprites, symbols: symbols.size, removed: seen - symbols.size };
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}
