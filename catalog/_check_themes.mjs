/* ============================================================================
   Theme token gate: contrast floors, rgb/hex agreement, drift, coverage.
   ----------------------------------------------------------------------------
   Every shell theme exists in up to three copies that must agree:

     1. catalog/profiles/<ds>.mjs      palette.{dark,light} (the source of truth
                                        for a pack or skin; Cloudscape has none)
     2. Prism.html THEME_REGISTRY      the <DS>_DARK_CSS / <DS>_LIGHT_CSS consts
                                        (CS_DARK_CSS / CS_LIGHT_CSS for Cloudscape)
     3. prism-mcp-server/utils/themes.js  the MCP mirror (THEMES[].tokens)

   The profile copy is expanded exactly the way catalog/_scaffold_ds.mjs expands
   it (its exported themeTokens()), so "profile vs Prism.html vs themes.js" means
   "what the scaffolder would write vs what is actually there".

   Checks (each failure names the theme, the pair or token, the value and floor):

     contrast   WCAG 2.x relative-luminance ratios for the pairs the shell and the
                generated facets actually paint (see PAIRS below for the floor and
                the usage that justifies it). Translucent surfaces are composited
                over --bg first, translucent text over its surface.
     rgb        every --x-rgb triplet equals the rgb of its --x hex.
     drift      profile vs Prism.html const vs themes.js, token by token, plus the
                THEME_REGISTRY accent field vs the const's --accent.
     coverage   every theme defines every TOKEN_META token in every copy (for a
                profile, in its declared palette, so nothing bleeds through from
                the Cloudscape base).

   Pairs with severity "advisory" are measured and reported but never fail the
   gate (see PAIRS for why each one is advisory).

   Usage:
     node catalog/_check_themes.mjs            human report, exit 1 on failure
     node catalog/_check_themes.mjs --json     machine-readable report on stdout
     node catalog/_check_themes.mjs --table    also print every measured pair
     node catalog/_check_themes.mjs --only <ds>  restrict to one family

   Overrides (same names as the scaffolder): PRISM_HTML, PRISM_MCP_THEMES,
   PRISM_PROFILES_DIR. Zero deps, node: builtins only, offline.
   ========================================================================== */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ================================================================ color math */

// Parse #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba() and a bare "r,g,b"
// triplet into {r,g,b,a} (0-255 channels, 0-1 alpha). Anything else -> null.
export function parseColor(input) {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = s.match(/^rgba?\(\s*([^)]*)\)$/) || s.match(/^(\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3})$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = parts.slice(0, 3).map(Number);
    if (ch.some((v) => !Number.isFinite(v) || v < 0 || v > 255)) return null;
    let a = 1;
    if (parts[3] != null) a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : Number(parts[3]);
    if (!Number.isFinite(a)) return null;
    return { r: ch[0], g: ch[1], b: ch[2], a: Math.max(0, Math.min(1, a)) };
  }
  return null;
}

export const toHex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// Alpha-composite fg over an opaque bg (gamma-encoded, rounded to 8-bit channels,
// as browsers paint it).
export function over(fg, bg) {
  const a = fg.a == null ? 1 : fg.a;
  const mix = (f, b) => Math.round(f * a + b * (1 - a));
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

// WCAG 2.x relative luminance (sRGB, 0.03928 knee as written in the spec).
export function relativeLuminance({ r, g, b }) {
  const lin = (c8) => {
    const c = c8 / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Contrast ratio of two colors (strings or parsed). A translucent first color is
// composited over the second; a translucent second color must be resolved by
// the caller (contrast() has no backdrop for it and treats it as opaque).
export function contrast(fgIn, bgIn) {
  const bg0 = typeof bgIn === 'string' ? parseColor(bgIn) : bgIn;
  const fg0 = typeof fgIn === 'string' ? parseColor(fgIn) : fgIn;
  if (!fg0 || !bg0) return NaN;
  const bg = { ...bg0, a: 1 };
  const fg = fg0.a < 1 ? over(fg0, bg) : fg0;
  const l1 = relativeLuminance(fg), l2 = relativeLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/* ===================================================================== pairs
   The floors and the usage that sets them (found by reading the shell CSS in
   Prism.html and the archetypes in catalog/_gen_system.mjs):

   ink      body text everywhere: shell rail/titles on --panel, page on --bg, tile
            text on --panel/--card, menus/toasts/tabs/avatars on --panel2. 4.5.
   muted    secondary text at 11-13px: rail links (fallback), breadcrumbs, tile
            .desc on --panel, facet card <p> on --card. Normal-size text, 4.5.
   dim      only ever secondary or incidental text: rail footer (11px), crumb
            separators, timestamps, placeholders, pending/disabled steps,
            captions (357 uses in Prism.html, none of them body copy). 3.0.
   accent   as TEXT: rail .sr-tag, active rail link, current sub-link, tile .ref
            label, facet chip/menu/card labels (11-13px). 4.5 on --panel.
            as UI: the focus ring (2px outline), input focus border, loader bar,
            progress/slider/spinner fills on the page. 3.0 on --bg.
   inks     --accent-ink, --info-ink … --crit-ink: the text/glyph the generated
            facets paint ON a role fill (button label, count badge, checkbox
            tick; catalog/_gen_system.mjs, color:var(--_ink,#fff)). Text, 4.5,
            both modes. An undefined ink falls back to #fff, as the generator does.
   #fff on accent  the shell still paints literal #fff on --accent
            (.cs-mode button.on, the Duolingo active rail link). Text, 4.5.
            Enforced in LIGHT themes, where the value that reads as text on a
            near-white panel also carries #fff. ADVISORY in DARK themes: an accent
            light enough for 4.5 text on a dark panel cannot also carry #fff at
            4.5 (needs L >= 0.27 for the first and L <= 0.18 for the second), so
            the fix is var(--accent-ink) in the shell CSS, not a palette value.
   roles    info/pos/warn/neg/crit are painted as TEXT by the facets (chip, menu
            row, card heading, 12px bold) and by the shell (--pos "New facets"
            link and chip). 4.5 on --panel.
   line     dividers, tile and panel borders. Advisory 3.0 on --bg: in the shell
            and the generated facets --line is never the only cue for a control
            (every bordered control also has a fill, an icon or a label).
   topnav   shell top bar: --cs-topnav-ink (titles, picker) and --cs-topnav-dim
            (service name, mode buttons, chips, 12-13px) on --cs-topnav-bg. 4.5.
   ========================================================================== */
export const FLOOR = { text: 4.5, ui: 3 };
const ROLES = ['info', 'pos', 'warn', 'neg', 'crit'];
export const INK_TOKENS = ['accent', ...ROLES].map((r) => `--${r}-ink`);

export const PAIRS = [
  ...['bg', 'panel', 'panel2', 'card'].map((s) => ({ id: `ink/${s}`, fg: '--ink', bg: `--${s}`, floor: FLOOR.text, kind: 'text' })),
  ...['panel', 'card'].map((s) => ({ id: `muted/${s}`, fg: '--muted', bg: `--${s}`, floor: FLOOR.text, kind: 'text' })),
  ...['panel', 'card'].map((s) => ({ id: `dim/${s}`, fg: '--dim', bg: `--${s}`, floor: FLOOR.ui, kind: 'secondary text' })),
  { id: 'accent/panel', fg: '--accent', bg: '--panel', floor: FLOOR.text, kind: 'text' },
  { id: 'accent/bg', fg: '--accent', bg: '--bg', floor: FLOOR.ui, kind: 'ui' },
  ...['accent', ...ROLES].map((r) => ({ id: `${r}-ink/${r}`, fg: `--${r}-ink`, fgFallback: '#ffffff', bg: `--${r}`, floor: FLOOR.text, kind: 'text on fill' })),
  { id: '#fff/accent', fg: '#ffffff', bg: '--accent', floor: FLOOR.text, kind: 'shell text on fill', shellLiteral: true },
  ...ROLES.map((r) => ({ id: `${r}/panel`, fg: `--${r}`, bg: '--panel', floor: FLOOR.text, kind: 'text' })),
  { id: 'line/bg', fg: '--line', bg: '--bg', floor: FLOOR.ui, kind: 'border', advisory: 'divider; never the only cue in the shell or generated facets' },
  { id: 'topnav-ink/topnav-bg', fg: '--cs-topnav-ink', bg: '--cs-topnav-bg', floor: FLOOR.text, kind: 'text' },
  { id: 'topnav-dim/topnav-bg', fg: '--cs-topnav-dim', bg: '--cs-topnav-bg', floor: FLOOR.text, kind: 'text' },
];

// Severity for one pair in one theme: 'fail' (gated) or 'advisory' (reported).
export function severityOf(pair, mode) {
  if (pair.advisory) return 'advisory';
  if (pair.shellLiteral && mode === 'dark') return 'advisory';
  return 'fail';
}

/* ====================================================== token-map resolution */

// Resolve a surface token to an opaque color: translucent surfaces sit on --bg,
// and --bg itself sits on white (light) or black (dark) if it is translucent.
function surfaceOf(tokens, key, mode) {
  const page = mode === 'light' ? { r: 255, g: 255, b: 255, a: 1 } : { r: 0, g: 0, b: 0, a: 1 };
  const bgRaw = parseColor(tokens['--bg']);
  const bg = bgRaw ? (bgRaw.a < 1 ? over(bgRaw, page) : bgRaw) : null;
  if (key === '--bg') return bg;
  const c = key.startsWith('#') ? parseColor(key) : parseColor(tokens[key]);
  if (!c || !bg) return null;
  return c.a < 1 ? over(c, bg) : c;
}

// Measure every PAIR for one theme. `fallback` supplies tokens the theme does
// not declare but the shell paints anyway (the static :root chrome defaults).
export function auditTheme(theme, fallback = {}) {
  const tokens = { ...fallback, ...theme.tokens };
  const rows = [];
  for (const p of PAIRS) {
    const bg = surfaceOf(tokens, p.bg, theme.mode);
    const fgVal = p.fg.startsWith('#') ? p.fg : (tokens[p.fg] != null ? tokens[p.fg] : p.fgFallback);
    const fgRaw = parseColor(fgVal);
    const bgVal = tokens[p.bg];
    if (!bg || !fgRaw) {
      rows.push({ theme: theme.id, mode: theme.mode, pair: p.id, fg: fgVal, bg: bgVal, ratio: null, floor: p.floor, kind: p.kind, severity: 'fail', pass: false, note: 'unresolvable color' });
      continue;
    }
    const ratio = contrast(fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw, bg);
    const pass = ratio + 1e-9 >= p.floor;
    rows.push({ theme: theme.id, mode: theme.mode, pair: p.id, fg: fgVal, bg: bgVal, ratio: Math.round(ratio * 100) / 100, floor: p.floor, kind: p.kind, severity: severityOf(p, theme.mode), pass });
  }
  return rows;
}

// Every --x-rgb must equal the rgb of --x.
export function checkRgb(theme) {
  const out = [];
  for (const [k, v] of Object.entries(theme.tokens)) {
    if (!k.endsWith('-rgb')) continue;
    const base = k.slice(0, -4);
    const hex = parseColor(theme.tokens[base]);
    const trip = parseColor(v);
    if (!hex) { out.push({ theme: theme.id, token: k, problem: `${base} is missing or not a color` }); continue; }
    if (!trip) { out.push({ theme: theme.id, token: k, problem: `"${v}" is not an r,g,b triplet` }); continue; }
    if (hex.r !== trip.r || hex.g !== trip.g || hex.b !== trip.b) {
      out.push({ theme: theme.id, token: k, problem: `"${v}" != ${base} ${theme.tokens[base]} (${hex.r},${hex.g},${hex.b})` });
    }
  }
  return out;
}

/* ============================================================ copy loaders */

// Split a :root{...} block into an ordered token map. Splits on ';' outside
// quotes and parentheses (font stacks and gradients contain neither ; nor }).
export function parseRootBlock(css) {
  const m = String(css).match(/:root\s*\{([\s\S]*)\}\s*$/);
  const body = m ? m[1] : String(css);
  const out = {};
  let depth = 0, quote = null, start = 0;
  const flush = (end) => {
    const decl = body.slice(start, end).trim();
    if (decl) {
      const i = decl.indexOf(':');
      if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ';' && depth === 0) { flush(i); start = i + 1; }
  }
  flush(body.length);
  return out;
}

// Read a JS expression made of string literals joined by '+', starting at `pos`.
// Returns { value, end } or null. Handles '...' and "..." with backslash escapes.
export function readStringConcat(src, pos) {
  let i = pos, value = '', any = false;
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  for (;;) {
    ws();
    const q = src[i];
    if (q !== '"' && q !== "'") break;
    i++;
    let s = '';
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') {
        const n = src[i + 1];
        s += n === 'n' ? '\n' : n === 't' ? '\t' : n;
        i += 2;
      } else s += src[i++];
    }
    if (src[i] !== q) return null;
    i++;
    value += s; any = true;
    ws();
    if (src[i] === '+') { i++; continue; }
    break;
  }
  return any ? { value, end: i } : null;
}

// Parse THEME_REGISTRY and its CSS consts out of Prism.html.
export function loadHtmlThemes(html) {
  const regAt = html.indexOf('var THEME_REGISTRY=[');
  if (regAt < 0) throw new Error('THEME_REGISTRY not found in Prism.html');
  const regEnd = html.indexOf('];', regAt);
  const reg = html.slice(regAt, regEnd);
  const entryRe = /\{\s*id:'([^']+)',\s*ds:'([^']+)',\s*name:'([^']+)',\s*mode:'(dark|light)',\s*accent:'([^']*)',\s*builtin:(true|false),\s*css:([A-Za-z0-9_$]+)\s*\}/g;
  // Consts live in the theme-engine block just above the registry.
  const engineAt = html.lastIndexOf('THEME ENGINE', regAt);
  const scope = html.slice(engineAt > 0 ? engineAt : 0, regAt);
  const themes = [];
  let m;
  while ((m = entryRe.exec(reg)) !== null) {
    const [, id, ds, name, mode, accent, builtin, constName] = m;
    const declAt = scope.search(new RegExp(`var\\s+${constName}\\s*=`));
    let css = null;
    if (declAt >= 0) {
      const eq = scope.indexOf('=', declAt);
      const r = readStringConcat(scope, eq + 1);
      css = r ? r.value : null;
    }
    themes.push({ id, ds, name, mode, accent, builtin: builtin === 'true', constName, css, tokens: css ? parseRootBlock(css) : null });
  }
  return themes;
}

// The shell's static :root defaults (first :root block of the first <style>):
// what a theme that does not declare a chrome token (e.g. --cs-topnav-*) gets.
export function loadShellDefaults(html) {
  const styleAt = html.indexOf('<style>', html.indexOf('</script>'));
  const rootAt = html.indexOf(':root{', styleAt);
  if (styleAt < 0 || rootAt < 0) return {};
  let depth = 0, i = rootAt + 5;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = html.slice(rootAt, i + 1).replace(/\/\*[\s\S]*?\*\//g, '');
  return parseRootBlock(body);
}

/* ============================================================ drift + coverage */

const normVal = (v) => String(v).trim().replace(/\s+/g, ' ').replace(/#[0-9a-fA-F]{3,8}\b/g, (h) => h.toLowerCase());

// Token-by-token differences between two maps, labelled with the copy names.
export function diffTokens(a, b, labelA, labelB) {
  const out = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    const inA = a && k in a, inB = b && k in b;
    if (inA && !inB) out.push({ token: k, problem: `in ${labelA} (${a[k]}) but not in ${labelB}` });
    else if (!inA && inB) out.push({ token: k, problem: `in ${labelB} (${b[k]}) but not in ${labelA}` });
    else if (normVal(a[k]) !== normVal(b[k])) out.push({ token: k, problem: `${labelA} ${a[k]} != ${labelB} ${b[k]}` });
  }
  return out;
}

export function checkCoverage(id, copy, tokens, metaKeys) {
  return metaKeys.filter((k) => !tokens || !(k in tokens)).map((k) => ({ theme: id, copy, token: k, problem: `${copy} does not define ${k}` }));
}

/* ================================================ shell CSS pairs + literal inks
   Kept apart from PAIRS (plain token pairs): these depend on what the shell and
   gallery CSS in Prism.html does with the tokens.

   control-line/<surface>   --control-line on bg/panel/panel2/card, 3:1 (WCAG
            1.4.11). It is the only boundary of an unchecked checkbox, radio,
            switch or toggle and of a text input, select or multi-select box;
            --line stays the divider (1.1-2.2:1, see line/bg above).
   ref/panel2   the gallery .tile .ref label, 11.5px text on --panel2, 4.5:1. The
            gallery CSS paints color-mix(in srgb,var(--accent) N%,var(--ink)); N is
            read from Prism.html, and every accent .tile .ref copy must use the same
            mix (a copy that does not is a shellCss finding). No copy: not measured.
   topnav-accent/topnav-bg   --cs-topnav-accent, else --accent, on --cs-topnav-bg,
            3:1: the active mode button fill, the brand mark and the focus ring on
            the top bar. A theme whose bar is (close to) its accent sets the token.
   topnav-accent-ink/topnav-accent   the active mode button label:
            --cs-topnav-accent-ink, else --accent-ink, else #fff. 4.5:1.

   literal inks: a rule (or inline style) in the shell or a gallery template that
   paints a role fill (var(--accent|info|pos|warn|neg|crit), alone or in a
   gradient of role stops) and a literal text color (#hex, white, black, rgb()).
   The fix is the matching on-fill ink, var(--accent-ink,<old literal>). Fills
   with a literal stop or a translucent tint are not role fills. The 9 legacy
   spectrum families hardcode their whole palette and never paint var() fills.
   ========================================================================== */
export const CONTROL_SURFACES = ['bg', 'panel', 'panel2', 'card'];
// fg/bg are fallback chains: the first token the theme (or the shell :root) defines
// wins; a '#hex' entry ends the chain. fg { mix } is the .tile .ref color-mix.
export const SHELL_PAIRS = [
  ...CONTROL_SURFACES.map((s) => ({ id: `control-line/${s}`, fg: ['--control-line'], bg: [`--${s}`], floor: FLOOR.ui, kind: 'control boundary' })),
  { id: 'ref/panel2', fg: { mix: ['--accent', '--ink'] }, bg: ['--panel2'], floor: FLOOR.text, kind: 'text' },
  { id: 'topnav-accent/topnav-bg', fg: ['--cs-topnav-accent', '--accent'], bg: ['--cs-topnav-bg'], floor: FLOOR.ui, kind: 'ui' },
  { id: 'topnav-accent-ink/topnav-accent', fg: ['--cs-topnav-accent-ink', '--accent-ink', '#ffffff'], bg: ['--cs-topnav-accent', '--accent'], floor: FLOOR.text, kind: 'text on fill' },
];

// color-mix(in srgb, a p, b): gamma-encoded channels interpolated, painted as 8-bit.
export function mixSrgb(a, b, p) {
  const ch = (x, y) => Math.round(x * p + y * (1 - p));
  return { r: ch(a.r, b.r), g: ch(a.g, b.g), b: ch(a.b, b.b), a: 1 };
}

// The accent .tile .ref rules of the gallery templates: { mix (0-1, or null when
// there is none), rules, findings }. The mix must be the same in every copy.
export function loadRefMix(html) {
  const out = { mix: null, rules: 0, findings: [] };
  const re = /\.tile \.ref\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const body = m[1];
    if (!/background:var\(--panel2\)/.test(body)) continue;   // the chip label (Animation Lab's .ref is plain crit text)
    const c = (body.match(/(?:^|;)color:([^;]*)/) || [])[1] || '';
    if (!/var\(--accent\)/.test(c)) continue;
    out.rules++;
    const mm = c.match(/^color-mix\(in srgb,var\(--accent\) (\d+(?:\.\d+)?)%,var\(--ink\)\)$/);
    const mix = mm ? Number(mm[1]) / 100 : c.trim() === 'var(--accent)' ? 1 : NaN;
    if (!Number.isFinite(mix)) { out.findings.push({ where: '.tile .ref', problem: `unrecognized label color "${c}"` }); continue; }
    if (out.mix == null) out.mix = mix;
    else if (mix !== out.mix) out.findings.push({ where: '.tile .ref', problem: `copies disagree: ${Math.round(out.mix * 100)}% and ${Math.round(mix * 100)}% accent` });
  }
  return out;
}

// Measure SHELL_PAIRS for one theme (same row shape as auditTheme).
export function auditShellPairs(theme, fallback = {}, { refMix = null } = {}) {
  const tokens = { ...fallback, ...theme.tokens };
  const page = theme.mode === 'light' ? { r: 255, g: 255, b: 255, a: 1 } : { r: 0, g: 0, b: 0, a: 1 };
  const bg0 = parseColor(tokens['--bg']);
  const bg = bg0 ? (bg0.a < 1 ? over(bg0, page) : bg0) : null;
  const pick = (chain) => { for (const k of chain) { if (k.startsWith('#')) return { k, v: k }; if (tokens[k] != null) return { k, v: tokens[k] }; } return { k: chain[0], v: null }; };
  const opaque = (v, under) => { const c = parseColor(v); return c && under ? (c.a < 1 ? over(c, under) : c) : null; };
  const rows = [];
  for (const p of SHELL_PAIRS) {
    if (p.fg.mix && refMix == null) continue;
    const b = pick(p.bg);
    const bgC = b.k === '--bg' ? bg : opaque(b.v, bg);
    let fgVal, fgC = null;
    if (p.fg.mix) {
      const [x, y] = p.fg.mix.map((k) => parseColor(tokens[k]));
      fgC = x && y && bgC ? mixSrgb(opaque(tokens[p.fg.mix[0]], bgC), opaque(tokens[p.fg.mix[1]], bgC), refMix) : null;
      fgVal = `color-mix(${p.fg.mix[0]} ${Math.round(refMix * 100)}%, ${p.fg.mix[1]})` + (fgC ? ' = ' + toHex(fgC) : '');
    } else {
      fgVal = pick(p.fg).v;
      fgC = bgC ? opaque(fgVal, bgC) : null;
    }
    const base = { theme: theme.id, mode: theme.mode, pair: p.id, fg: fgVal, bg: b.v, floor: p.floor, kind: p.kind, severity: 'fail' };
    if (!fgC || !bgC) { rows.push({ ...base, ratio: null, pass: false, note: 'unresolvable color' }); continue; }
    const ratio = contrast(fgC, bgC);
    rows.push({ ...base, ratio: Math.round(ratio * 100) / 100, pass: ratio + 1e-9 >= p.floor });
  }
  return rows;
}

// Literal text colors on role fills, in the shell and gallery CSS (see above).
const ROLE_FILL = /var\(--(?:accent2?|info|pos|warn|neg|crit)(?:,[^)]*)?\)/;
const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|\b(?:white|black)\b|rgba?\(\s*\d/i;
const LITERAL_INK = /(?:^|[;{\s])color\s*:\s*(#[0-9a-f]{3,8}|white|black|rgba?\([\d\s.,%]+\))\s*(?:!important\s*)?(?:;|$)/i;
function literalOnFill(decls) {
  const bgm = decls.match(/(?:^|[;{\s])background(?:-color)?\s*:\s*([^;]*)/i);
  // a role fill has no literal stop once var() calls (with their fallbacks) and rgba(var(--x-rgb),a) are set aside
  if (!bgm || !ROLE_FILL.test(bgm[1]) || LITERAL_COLOR.test(bgm[1].replace(/rgba?\(var\([^)]*\)[^)]*\)/g, '').replace(/var\([^()]*\)/g, ''))) return null;
  const c = decls.match(LITERAL_INK);
  return c ? c[1] : null;
}
export function checkLiteralInks(html) {
  // from the shell <style> (the first after the catalog island) to the end: shell CSS,
  // the gallery templates and the shell scripts (chrome CSS strings)
  const start = Math.max(0, html.indexOf('<style>', html.indexOf('</script>')));
  const lineAt = (i) => { let n = 1; for (let j = html.indexOf('\n'); j >= 0 && j < i; j = html.indexOf('\n', j + 1)) n++; return n; };
  const hits = [];
  for (let i = html.indexOf('{', start); i >= 0; i = html.indexOf('{', i + 1)) {
    const close = html.indexOf('}', i + 1), next = html.indexOf('{', i + 1);
    if (close < 0 || (next >= 0 && next < close) || close - i > 4000) continue;
    const lit = literalOnFill(html.slice(i + 1, close));
    if (!lit) continue;
    const s0 = Math.max(html.lastIndexOf('}', i), html.lastIndexOf('{', i - 1), html.lastIndexOf('\n', i), html.lastIndexOf("'", i), i - 120);
    hits.push({ at: i, where: html.slice(s0 + 1, i).trim(), literal: lit });
  }
  const re = /style="([^"]*)"/g; re.lastIndex = start;
  let m;
  while ((m = re.exec(html)) !== null) {
    const lit = literalOnFill(';' + m[1]);
    if (lit) hits.push({ at: m.index, where: 'inline style', literal: lit });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => ({ line: lineAt(h.at), where: h.where, literal: h.literal, problem: `literal ${h.literal} on a role fill: use the matching var(--<role>-ink,${h.literal})` }));
}

/* ==================================================================== runner */

export async function runChecks(opts = {}) {
  const htmlPath = opts.html || (process.env.PRISM_HTML ? resolve(process.env.PRISM_HTML) : resolve(HERE, '../Prism.html'));
  const themesPath = opts.themesJs || (process.env.PRISM_MCP_THEMES ? resolve(process.env.PRISM_MCP_THEMES) : resolve(HERE, '../prism-mcp-server/utils/themes.js'));
  const profilesDir = opts.profilesDir || (process.env.PRISM_PROFILES_DIR ? resolve(process.env.PRISM_PROFILES_DIR) : resolve(HERE, 'profiles'));
  const only = opts.only || null;

  const html = readFileSync(htmlPath, 'utf8');
  const htmlThemes = loadHtmlThemes(html);
  const shellDefaults = loadShellDefaults(html);
  const refMix = loadRefMix(html);
  const mirror = await import(pathToFileURL(themesPath).href);
  const { themeTokens } = await import(pathToFileURL(resolve(HERE, '_scaffold_ds.mjs')).href);
  const metaKeys = mirror.TOKEN_META.map((t) => t.k);

  const ids = [...new Set([...htmlThemes.map((t) => t.id), ...mirror.THEMES.map((t) => t.id)])];
  const report = { contrast: [], rgb: [], drift: [], coverage: [], themes: [] };
  const profileCache = new Map();
  const profileFor = async (ds) => {
    if (profileCache.has(ds)) return profileCache.get(ds);
    const p = resolve(profilesDir, ds + '.mjs');
    const prof = existsSync(p) ? (await import(pathToFileURL(p).href)).default : null;
    profileCache.set(ds, prof);
    return prof;
  };

  for (const id of ids) {
    const h = htmlThemes.find((t) => t.id === id) || null;
    const mt = mirror.THEMES.find((t) => t.id === id) || null;
    const ds = (h && h.ds) || (mt && mt.ds);
    const mode = (h && h.mode) || (mt && mt.mode);
    if (only && ds !== only) continue;
    const profile = ds === 'cloudscape' ? null : await profileFor(ds);
    const profTokens = profile ? themeTokens(profile, mode) : null;
    report.themes.push({ id, ds, mode, copies: { profile: !!profile, html: !!(h && h.tokens), mirror: !!mt } });

    // --- drift
    const drift = [];
    if (!h) drift.push({ token: '*', problem: 'missing from Prism.html THEME_REGISTRY' });
    else if (!h.tokens) drift.push({ token: '*', problem: `Prism.html const ${h.constName} not found or unparseable` });
    if (!mt) drift.push({ token: '*', problem: 'missing from themes.js THEMES' });
    if (ds !== 'cloudscape' && !profile) drift.push({ token: '*', problem: `no catalog/profiles/${ds}.mjs` });
    if (profTokens && h && h.tokens) drift.push(...diffTokens(profTokens, h.tokens, 'profile', 'Prism.html'));
    if (profTokens && mt) drift.push(...diffTokens(profTokens, mt.tokens, 'profile', 'themes.js'));
    if (!profTokens && h && h.tokens && mt) drift.push(...diffTokens(h.tokens, mt.tokens, 'Prism.html', 'themes.js'));
    if (h && h.tokens && normVal(h.accent) !== normVal(h.tokens['--accent'])) {
      drift.push({ token: 'registry.accent', problem: `THEME_REGISTRY accent ${h.accent} != ${h.constName} --accent ${h.tokens['--accent']}` });
    }
    drift.forEach((d) => report.drift.push({ theme: id, ...d }));

    // --- coverage (declared tokens only, per copy)
    if (profile) {
      const declared = (profile.palette && profile.palette[mode]) || {};
      report.coverage.push(...checkCoverage(id, 'profile palette', declared, metaKeys));
    }
    if (h) report.coverage.push(...checkCoverage(id, 'Prism.html', h.tokens, metaKeys));
    if (mt) report.coverage.push(...checkCoverage(id, 'themes.js', mt.tokens, metaKeys));

    // --- contrast + rgb, on the copy the shell paints (Prism.html), else the
    // profile, else the mirror. Drift is reported separately above.
    const tokens = (h && h.tokens) || profTokens || (mt && mt.tokens);
    if (tokens) {
      const theme = { id, mode, tokens };
      report.contrast.push(...auditTheme(theme, shellDefaults));
      report.contrast.push(...auditShellPairs(theme, shellDefaults, { refMix: refMix.mix }));
      report.rgb.push(...checkRgb(theme));
      if (profTokens && profTokens !== tokens) report.rgb.push(...checkRgb({ id: id + ' (profile)', tokens: profTokens }));
      if (mt && mt.tokens !== tokens) report.rgb.push(...checkRgb({ id: id + ' (themes.js)', tokens: mt.tokens }));
    }
  }

  report.shellCss = [...refMix.findings, ...checkLiteralInks(html)];
  const contrastFailures = report.contrast.filter((r) => !r.pass && r.severity === 'fail');
  const advisories = report.contrast.filter((r) => !r.pass && r.severity === 'advisory');
  report.summary = {
    themes: report.themes.length,
    pairsMeasured: report.contrast.length,
    contrastFailures: contrastFailures.length,
    advisories: advisories.length,
    rgbMismatches: report.rgb.length,
    driftFindings: report.drift.length,
    coverageGaps: report.coverage.length,
    shellCssFindings: report.shellCss.length,
  };
  report.ok = contrastFailures.length === 0 && report.rgb.length === 0 && report.drift.length === 0 && report.coverage.length === 0 && report.shellCss.length === 0;
  return report;
}

/* ======================================================================= cli */
function printHuman(report, { table }) {
  const fails = report.contrast.filter((r) => !r.pass && r.severity === 'fail');
  const adv = report.contrast.filter((r) => !r.pass && r.severity === 'advisory');
  const fmt = (r) => `  ${r.theme.padEnd(28)} ${r.pair.padEnd(22)} ${String(r.ratio).padStart(5)}:1  floor ${r.floor}:1  (${r.fg} on ${r.bg}, ${r.kind})`;
  if (table) {
    console.log('All measured pairs:');
    report.contrast.forEach((r) => console.log(fmt(r) + (r.pass ? '' : r.severity === 'fail' ? '  FAIL' : '  advisory')));
    console.log('');
  }
  console.log(`Contrast: ${report.summary.pairsMeasured} pairs over ${report.summary.themes} themes, ${fails.length} failing, ${adv.length} advisory`);
  fails.forEach((r) => console.log(fmt(r)));
  if (adv.length) {
    const byPair = {};
    adv.forEach((r) => { (byPair[r.pair] = byPair[r.pair] || []).push(`${r.theme} ${r.ratio}`); });
    console.log('Advisory (reported, not gated):');
    Object.entries(byPair).forEach(([p, list]) => console.log(`  ${p.padEnd(22)} ${list.length} theme(s): ${list.join(', ')}`));
  }
  console.log(`rgb/hex: ${report.rgb.length} mismatch(es)`);
  report.rgb.forEach((r) => console.log(`  ${r.theme.padEnd(28)} ${r.token.padEnd(14)} ${r.problem}`));
  console.log(`Drift (profile / Prism.html / themes.js): ${report.drift.length} finding(s)`);
  report.drift.forEach((d) => console.log(`  ${d.theme.padEnd(28)} ${d.token.padEnd(18)} ${d.problem}`));
  console.log(`TOKEN_META coverage: ${report.coverage.length} gap(s)`);
  report.coverage.forEach((c) => console.log(`  ${c.theme.padEnd(28)} ${c.problem}`));
  console.log(`Shell CSS (literal inks on role fills, .tile .ref mix): ${report.shellCss.length} finding(s)`);
  report.shellCss.forEach((f) => console.log(`  ${f.line ? 'Prism.html:' + f.line : ''} ${String(f.where).slice(-60)}  ${f.problem}`));
  console.log(report.ok ? '\nOK: theme tokens pass.' : '\nFAIL: theme tokens need attention (see above).');
}

// No top-level await here: _scaffold_ds.mjs imports this module statically, and
// runChecks() imports the scaffolder, so this module must finish evaluating first.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const table = args.includes('--table');
  const oi = args.indexOf('--only');
  const only = oi >= 0 ? args[oi + 1] : null;
  runChecks({ only }).then((report) => {
    if (json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    else printHuman(report, { table });
    process.exitCode = report.ok ? 0 : 1;
  }, (e) => {
    if (json) process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message || e) }) + '\n');
    else console.error('check_themes error:', e && e.stack || e);
    process.exitCode = 2;
  });
}
