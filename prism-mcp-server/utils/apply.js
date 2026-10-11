// Applying Prism output outside the app: the theme token block a page needs, the attributes the app
// stamps on each document root, the initializer scripts, a standalone document, and the per-effect
// "how to use it" guide that get_effect returns.
//
// The app themes a page in two ways at once (Prism.html stampRoot): a :root block with every token of
// the active theme, and data-mode / data-theme / data-ds plus color-scheme on <html>. 902 facets carry
// [data-mode="light"] rules (light artwork, a softer shadow, the AWS icon colorways), so a light theme
// needs the attribute as well as the tokens. Auto (a first visit to the app) follows the system:
// prefers-color-scheme picks the tokens and a two-line script keeps data-mode in step.

import { THEMES, getTheme, baseTokensFor, usesTokens, RECOLOR_CSS, designSystems, DEFAULT_THEME_ID } from './themes.js';

export const DEFAULT_PALETTE = 'cloudscape';

export class ApplyError extends Error {
  constructor(message, data = null) { super(message); this.name = 'ApplyError'; this.data = data; }
}

/** WCAG relative luminance of a #rgb/#rrggbb color, or null. */
function luminance(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** A flat token map's mode from its first hex surface, or null when it does not say. */
export function modeOf(tokens) {
  for (const k of ['--bg', '--panel', '--card']) {
    const l = luminance(tokens && tokens[k]);
    if (l != null) return l < 0.4 ? 'dark' : 'light';
  }
  return null;
}

function checkTokenMap(map, where) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new ApplyError(`${where} must be an object of --token: value`);
  const bad = Object.keys(map).filter((k) => !/^--[a-z0-9-]+$/i.test(k) || typeof map[k] !== 'string' || map[k].length > 400 || /[;{}<>]/.test(map[k]));
  if (bad.length) throw new ApplyError(`${where}: every key must be a --token and every value a CSS value without ; { } < > (at most 400 characters)`, { invalid: bad.slice(0, 20) });
  return map;
}

/**
 * The palette a page is themed with: { id, ds, name, mode: 'dark'|'light'|'auto', dark?, light? }
 * (complete token maps). theme is a shipped theme id ("duolingo-light": that mode only), a design
 * system id ("duolingo": Auto, both modes) or "none"; tokens is a custom palette, either
 * derive_theme's { dark, light } pair or a flat map layered over the theme's tokens for its mode.
 * Returns null for theme "none".
 */
export function resolvePalette({ theme, tokens } = {}) {
  const want = theme == null || theme === '' ? DEFAULT_PALETTE : String(theme).trim();
  if (want === 'none') {
    if (tokens != null) throw new ApplyError('theme "none" takes no tokens');
    return null;
  }
  let p;
  const t = getTheme(want);
  if (t) p = { id: t.id, ds: t.ds, name: t.name, mode: t.mode, [t.mode]: { ...t.tokens } };
  else {
    const s = designSystems().find((x) => x.ds === want || (want === 'auto' && x.isDefault));
    if (!s) {
      throw new ApplyError(`Unknown theme "${want}": pass a theme id, a design system id for Auto, or "none"`, {
        themes: THEMES.map((x) => x.id), designSystems: designSystems().map((x) => x.ds),
      });
    }
    p = { id: s.ds, ds: s.ds, name: `${s.name} (Auto)`, mode: 'auto', dark: { ...getTheme(s.dark).tokens }, light: { ...getTheme(s.light).tokens } };
  }
  if (tokens == null) return p;
  if (typeof tokens === 'string') {
    try { tokens = JSON.parse(tokens); } catch (err) { throw new ApplyError(`tokens is not valid JSON: ${err.message}`); }
  }
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) throw new ApplyError('tokens must be a token map or { dark, light }');
  const keys = Object.keys(tokens);
  if (keys.length && keys.every((k) => k === 'dark' || k === 'light')) {
    // derive_theme's pair: each given mode is complete; a null mode is left out.
    const out = { id: 'custom', ds: 'custom', name: 'Custom' };
    for (const m of ['dark', 'light']) if (tokens[m] != null) out[m] = { ...baseTokensFor(m), ...checkTokenMap(tokens[m], `tokens.${m}`) };
    if (!out.dark && !out.light) throw new ApplyError('tokens { dark, light } has neither mode');
    out.mode = out.dark && out.light ? 'auto' : out.dark ? 'dark' : 'light';
    return out;
  }
  checkTokenMap(tokens, 'tokens');
  const mode = modeOf(tokens) || (p.mode === 'auto' ? 'dark' : p.mode);
  const base = p[mode] || baseTokensFor(mode);
  return { id: 'custom', ds: 'custom', name: `Custom over ${p.name}`, mode, [mode]: { ...base, ...tokens } };
}

const decls = (map) => Object.entries(map).map(([k, v]) => `${k}:${v}`).join(';');

/** The token block: :root with every token of the palette (Auto: dark, then the light differences). */
export function tokenBlockCss(p) {
  if (!p) return '';
  if (p.mode !== 'auto') return `:root{${decls(p[p.mode])};color-scheme:${p.mode}}`;
  const lightDiff = {};
  for (const [k, v] of Object.entries(p.light)) if (p.dark[k] !== v) lightDiff[k] = v;
  const light = `${decls(lightDiff)};color-scheme:light`;
  return `:root{${decls(p.dark)};color-scheme:dark}\n`
    + `@media (prefers-color-scheme: light){:root:not([data-mode="dark"]){${light}}}\n`
    + `:root[data-mode="light"]{${light}}`;
}

/** The token block plus the .c-* recolor classes: what a page includes once. */
export function themeCss(p) {
  return p ? `${tokenBlockCss(p)}\n${RECOLOR_CSS}` : '';
}

/** The attributes the app stamps on <html> for a fixed mode (Auto: set by autoModeScript). */
export function rootAttributes(p) {
  if (!p || p.mode === 'auto') return {};
  const a = { 'data-mode': p.mode };
  if (p.ds !== 'custom') { a['data-ds'] = p.ds; a['data-theme'] = p.id; }
  return a;
}

/** For Auto: keeps <html data-mode> (and data-theme) in step with the system color scheme. */
export function autoModeScript(p) {
  if (!p || p.mode !== 'auto') return null;
  const ds = p.ds !== 'custom' ? JSON.stringify(p.ds) : 'null';
  return '(function(){var q=window.matchMedia&&matchMedia("(prefers-color-scheme: light)"),de=document.documentElement,ds=' + ds + ';'
    + 'function set(){var m=q&&q.matches?"light":"dark";de.setAttribute("data-mode",m);if(ds){de.setAttribute("data-ds",ds);de.setAttribute("data-theme",ds+"-"+m);}}'
    + 'set();if(q&&q.addEventListener)q.addEventListener("change",set);})();';
}

/** The initializer scripts a set of effects needs: [{ key, js, page, note, effects }]. */
export function initializerScripts(effects, store) {
  const by = new Map();
  for (const e of effects) {
    if (!e.needsJs) continue;
    if (!by.has(e.needsJs)) {
      const init = store.initializer ? store.initializer(e.needsJs) : null;
      by.set(e.needsJs, {
        key: e.needsJs,
        js: init ? init.js : null,
        page: init ? init.page : null,
        note: init && init.js ? 'Run once after the markup is in the page (idempotent, no dependencies).'
          : `The catalog carries no inline source for "${e.needsJs}"${init && init.note ? ` (${init.note.replace(/\.\s*$/, '')})` : ''}: without it the effect shows only what its css draws.`,
        effects: [],
      });
    }
    by.get(e.needsJs).effects.push(e.id);
  }
  return [...by.values()];
}

const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
/** Script source safe inside <script>: no "</script" can close it early. */
const safeScript = (js) => String(js).replace(/<\/(script)/gi, '<\\/$1');

/**
 * A complete standalone page: the palette's root attributes, the css (token block included by the
 * caller), the markup, then the initializer scripts. bodyCss styles the page itself.
 */
export function buildDocument({ title = 'Prism', css = '', html = '', palette = null, scripts = [], bodyCss = '' }) {
  const attrs = rootAttributes(palette);
  const attrText = Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
  const auto = autoModeScript(palette);
  const base = bodyCss || 'body{margin:0;padding:24px;background:var(--bg,#0f1621);color:var(--ink,#e9ebed);font-family:var(--font,system-ui,sans-serif)}';
  const runnable = scripts.filter((s) => s.js);
  return '<!DOCTYPE html>\n'
    + `<html lang="en"${attrText}>\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n`
    + `<title>${escapeText(title)}</title>\n`
    + (auto ? `<script>${auto}</script>\n` : '')
    + `<style>\n${base}\n${css}\n</style>\n</head>\n<body>\n${html}\n`
    + runnable.map((s) => `<script data-prism-init="${escapeAttr(s.key)}">\n${safeScript(s.js)}\n</script>\n`).join('')
    + '</body>\n</html>\n';
}

/** The steps to put a bundle on a page, for compose and export results. */
export function applySteps(p, scripts) {
  const steps = [];
  if (p) {
    steps.push(p.mode === 'auto'
      ? 'css starts with the theme token block: :root holds the dark tokens, and the light ones apply under prefers-color-scheme: light or <html data-mode="light">. Include it once per page.'
      : `css starts with the ${p.name} token block (:root with every token, color-scheme ${p.mode}). Include it once per page.`);
    const a = rootAttributes(p);
    if (Object.keys(a).length) steps.push(`Set ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ')} on <html>: facets read [data-mode="light"] for light-only rules (the app stamps the same attributes).`);
    if (p.mode === 'auto') steps.push('Run autoScript in <head>: it keeps <html data-mode> in step with the system, as the app does on a first visit.');
  } else {
    steps.push('No token block: the page must define the theme tokens itself (get_theme_palette css).');
  }
  steps.push('Insert html where the components go and include css once.');
  for (const s of scripts) {
    steps.push(s.js ? `Run the "${s.key}" initializer (scripts[].js) once after the markup is in the page.` : `"${s.key}" has no inline initializer in the catalog: ${s.effects.join(', ')} show only what their css draws.`);
  }
  steps.push('Motion: facets that self-animate and are reducedMotionSafe stop under prefers-reduced-motion: reduce on their own; nothing to add.');
  return steps;
}

/** Custom properties an effect reads with var() but neither defines nor gets from a theme. */
function ownVars(e) {
  const surface = `${e.html || ''}\n${e.css || ''}`;
  const read = new Set([...surface.matchAll(/var\(\s*(--[a-z0-9_-]+)/gi)].map((m) => m[1]));
  const defined = new Set([...surface.matchAll(/(--[a-z0-9_-]+)\s*:/gi)].map((m) => m[1]));
  const theme = new Set(usesTokens(e));
  return [...read].filter((k) => !defined.has(k) && !theme.has(k) && k !== '--c' && k !== '--c-rgb');
}

/** How to use one effect: tokens, initializer, motion, layer, light mode. */
export function effectGuide(e, store) {
  const tokens = usesTokens(e);
  const init = e.needsJs ? initializerScripts([e], store)[0] : null;
  const lightRules = /\[data-mode=["']?light/.test(e.css || '');
  const a = e.a11y || { selfAnimates: false, reducedMotionSafe: true };
  const guide = {
    steps: [
      tokens.length
        ? `Include a theme token block once per page: it reads ${tokens.length} theme token${tokens.length === 1 ? '' : 's'} (themeTokens). compose { ids, theme } adds it; get_theme_palette { theme } returns it as css.`
        : 'Reads no theme token directly: it looks the same under every theme.',
      e.css ? 'Insert html and include css (selfContained false: the html alone is unstyled).' : 'The html is all it needs (inline styles).',
    ],
    themeTokens: tokens,
    motion: {
      selfAnimates: !!a.selfAnimates,
      reducedMotionSafe: a.reducedMotionSafe !== false,
      note: a.reducedMotionSafe !== false
        ? (a.selfAnimates ? 'Animates on its own and stops under prefers-reduced-motion: reduce (its css carries the rule).' : 'Static, or moves only on interaction.')
        : `${a.selfAnimates ? 'Animates on its own' : 'Animates on interaction'} with no reduced-motion fallback: add @media (prefers-reduced-motion: reduce){ <its animated selectors> {animation:none;transition:none} } or pick one with reducedMotionSafe:true.`,
    },
  };
  if (init) {
    guide.initializer = init;
    guide.steps.push(init.js ? `Run initializer.js once after the markup is in the page (needsJs "${init.key}").` : `needsJs "${init.key}": ${init.note}`);
  }
  const vars = ownVars(e);
  if (vars.length) guide.instanceVars = vars;
  if (e.params && e.params.color) guide.recolor = 'Add a c-* class (c-accent, c-info, c-pos, c-warn, c-neg, c-crit) or set --c and --c-rgb on the element.';
  if (lightRules) guide.steps.push('Carries [data-mode="light"] rules: under a light theme set data-mode="light" on <html> (compose and get_theme_palette say how).');
  if (e.usableAsBackground) {
    guide.background = 'A backdrop, drawn here as a tile: compose_with_template { template: "backdrop", ids: [this, ...content] } stretches it behind the other effects. By hand: put it first in a position:relative container, stretch its root (position:absolute; inset:0; width:100%; max-width:none; height:100%; border-radius:0) and give the content position:relative; z-index:1.';
  } else if (e.layer === 'background') {
    guide.background = 'layer is background (from its component type) but usableAsBackground is false: it is drawn as a tile, not a page backdrop.';
  } else if (e.layer === 'overlay') {
    guide.overlay = 'Floats above content (toast, tooltip, notification, modal): place it in a position:relative or fixed container.';
  }
  if (e.gallery === 'aws') guide.diagram = 'An AWS kit diagram: get_diagram_spec gives its editable JSON spec, export_diagram a standalone svg, png, storyboard, draw.io or Mermaid.';
  return guide;
}

export { DEFAULT_THEME_ID };
