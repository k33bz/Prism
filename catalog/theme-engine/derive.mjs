/* Prism theme engine: derive a complete, contrast-safe token palette for both
   color modes from a few brand inputs.
   ----------------------------------------------------------------------------
     import { deriveTheme } from './derive.mjs';
     const { dark, light, report } = deriveTheme({ name: 'Acme', accent: '#0078d4' });

   Input: { name, accent: '#hex', secondary?, neutral? ('brand'|'cool'|'warm'|
   'neutral'|'#hex'), mode? ('both'|'dark'|'light'), contrast? ('AA'|'AAA'),
   radius?, density?, font? }

   - Surfaces and text come from a neutral ramp in OKLCH that keeps the brand
     hue (or the chosen neutral hue) at low chroma.
   - The accent keeps its hue and chroma; only its lightness moves, per mode,
     and only when it misses a floor (text on the panels, UI on bg, and a
     readable ink on accent fills). Every move is reported.
   - Status colors use the conventional hues (info blue, pos green, warn amber,
     neg red, crit purple) at the accent's chroma, solved to one shared
     lightness per mode so they read as a set.
   - Every color is gamut mapped by chroma reduction at fixed L and h, and every
     contrast is measured on the final #rrggbb value.
   Pure and deterministic: the same input always gives the same output.

   CLI:  node catalog/theme-engine/derive.mjs --accent '#0078d4' [--name x]
           [--secondary '#hex'] [--neutral warm] [--mode both] [--contrast AAA]
           [--radius 6] [--density compact] [--font '...'] [--css] [--json]
           [--profile out.mjs --ds-short x --home-url https://...]
   Zero deps, node: builtins only, offline. */
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import * as C from './color.mjs';

/* ------------------------------------------------------------- vocabulary */

// Every token the engine emits, in the order of BASE_TOKENS
// (prism-mcp-server/utils/themes.js), then the optional top-nav chrome tokens
// the newer packs set, then the on-fill inks (--accent-ink and one per status
// role: the solved ink for text and glyphs painted on that fill, which the
// generated facets read as var(--x-ink,#fff)). The tests check this list covers
// TOKEN_META and BASE_TOKENS.
export const TOKENS = [
  '--bg', '--panel', '--panel2', '--card', '--line', '--ink', '--muted', '--dim',
  '--accent', '--accent-rgb', '--accent2', '--info', '--info-rgb', '--pos', '--pos-rgb',
  '--warn', '--warn-rgb', '--neg', '--neg-rgb', '--crit', '--crit-rgb', '--cardgrad',
  '--font', '--r-sm', '--r-md', '--r-lg', '--r-xl',
  '--elev-1', '--elev-2', '--dur', '--ease', '--bd', '--head-w', '--dens',
  '--cs-topnav-bg', '--cs-topnav-line', '--cs-topnav-ink', '--cs-topnav-dim', '--cs-topnav-hover',
  '--accent-ink', '--info-ink', '--pos-ink', '--warn-ink', '--neg-ink', '--crit-ink',
];

export const STATUS_HUES = { '--info': 250, '--pos': 145, '--warn': 75, '--neg': 27, '--crit': 305 };
const STATUS = Object.keys(STATUS_HUES);

export const DEFAULT_FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

// Contrast floors by pair kind. text = WCAG 1.4.3 (1.4.6 for AAA); ui = 1.4.11
// non-text; tertiary = --dim captions and placeholders (large-text floor at AA,
// normal-text floor at AAA); decorative = hairlines, reported but not gated.
export const FLOORS = {
  AA: { text: 4.5, ui: 3, tertiary: 3, decorative: null },
  AAA: { text: 7, ui: 3, tertiary: 4.5, decorative: null },
};

// The checked pairs: [foreground token, background token, kind].
const TEXT_SURFACES = ['--bg', '--panel', '--panel2', '--card'];
const CONTENT_SURFACES = ['--panel', '--panel2', '--card'];
export const PAIRS = [
  ...TEXT_SURFACES.map((s) => ['--ink', s, 'text']),
  ...TEXT_SURFACES.map((s) => ['--muted', s, 'text']),
  ...TEXT_SURFACES.map((s) => ['--dim', s, 'tertiary']),
  ['--line', '--panel', 'decorative'], ['--line', '--bg', 'decorative'],
  ...CONTENT_SURFACES.map((s) => ['--accent', s, 'text']),
  ['--accent', '--bg', 'ui'],
  ['--accent-ink', '--accent', 'text'],
  ['--accent2', '--bg', 'ui'], ['--accent2', '--panel', 'ui'],
  ...STATUS.flatMap((t) => [...CONTENT_SURFACES.map((s) => [t, s, 'text']), [t, '--bg', 'ui'], [t + '-ink', t, 'text']]),
  ['--cs-topnav-ink', '--cs-topnav-bg', 'text'], ['--cs-topnav-dim', '--cs-topnav-bg', 'text'],
];

/* ------------------------------------------------------------ contrast check */

const isSurface = (k) => ['--panel', '--panel2', '--card', '--cs-topnav-bg'].includes(k);

/** Guess a token map's mode: from the first opaque surface (--bg, --panel, --card;
 *  dark when its luminance < 0.4), else from --ink (light ink means dark mode). */
export function inferMode(tokens) {
  const t = tokens || {};
  for (const k of ['--bg', '--panel', '--card']) {
    const c = C.parseColor(t[k]);
    if (c && c.a >= 1) return C.relativeLuminance(c) < 0.4 ? 'dark' : 'light';
  }
  const ink = C.parseColor(t['--ink']);
  if (ink) return C.relativeLuminance(C.composite(ink, { r: 128, g: 128, b: 128 })) > 0.4 ? 'dark' : 'light';
  return 'dark';
}

/**
 * Check a (partial or full) token map's contrast pairs. Translucent values are
 * composited: --bg over black (dark) or white (light), surfaces over --bg, and a
 * foreground over the background of its pair. When an on-fill ink (--accent-ink,
 * --info-ink, ...) is absent it is taken as #ffffff, the generated facets' fallback.
 * Pairs whose tokens are missing or unparseable are listed in `skipped`.
 * Returns { mode, contrast, pairs, failures, skipped, pass }.
 */
export function checkContrast(tokens, { mode, contrast = 'AA' } = {}) {
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) throw new Error('tokens must be an object of --token: value');
  if (!FLOORS[contrast]) throw new Error(`contrast must be AA or AAA, not "${contrast}"`);
  const m = mode === 'dark' || mode === 'light' ? mode : inferMode(tokens);
  const floors = FLOORS[contrast];
  const backdrop = m === 'dark' ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  const isInk = (k) => /^--(accent|info|pos|warn|neg|crit)-ink$/.test(k);
  const raw = (k) => (isInk(k) && tokens[k] == null ? '#ffffff' : tokens[k]);
  const bgRgb = (() => { const p = C.parseColor(tokens['--bg']); return p ? C.composite(p, backdrop) : null; })();
  const opaque = (k, over) => {
    const p = C.parseColor(raw(k));
    if (!p) return null;
    if (p.a >= 1) return p;
    const base = over || (k === '--bg' ? backdrop : bgRgb || backdrop);
    return C.composite(p, base);
  };
  const pairs = [], skipped = [];
  for (const [fg, bg, kind] of PAIRS) {
    const b = bg === '--bg' ? bgRgb : opaque(bg, isSurface(bg) ? bgRgb || backdrop : null);
    const f = b ? opaque(fg, b) : null;
    if (!f || !b) { skipped.push({ fg, bg, reason: `${!b ? bg : fg} is missing or not a color` }); continue; }
    const ratio = C.contrastRatio(f, b);
    const floor = floors[kind];
    pairs.push({
      mode: m, fg, bg, kind,
      fgValue: isInk(fg) && tokens[fg] == null ? '#ffffff (facet default)' : C.toHex(f),
      bgValue: C.toHex(b),
      ratio: C.round(ratio, 2), floor, pass: floor == null ? null : ratio >= floor,
      apca: C.round(C.apcaContrast(f, b), 1),
    });
  }
  const failures = pairs.filter((p) => p.pass === false);
  return { mode: m, contrast, pairs, failures, skipped, pass: failures.length === 0 };
}

/* ------------------------------------------------------------ input parsing */

const NEUTRAL_PRESETS = {
  brand: null, // brand hue, tint scaled by the accent's chroma
  cool: { h: 250, k: 0.8 },
  warm: { h: 70, k: 0.6 },
  neutral: { k: 0.25 }, // near grey, a faint cast of the brand hue
};

function parseLength(v, what) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : /^\s*\d+(\.\d+)?\s*(px)?\s*$/i.test(String(v)) ? parseFloat(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 64) throw new Error(`${what} must be a size in px between 0 and 64, not "${v}"`);
  return n;
}

const DENSITY = { compact: 0.95, comfortable: 1, default: 1, spacious: 1.1 };

/** Validate and normalize deriveTheme input. Throws Error with a clear message. */
export function normalizeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input must be an object with at least { accent: "#hex" }');
  const hex = (v, what) => {
    if (typeof v !== 'string' || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())) throw new Error(`${what} must be a #rgb or #rrggbb hex color, not ${JSON.stringify(v)}`);
    return C.normalizeHex(v.trim());
  };
  const out = { name: 'Custom', accent: hex(input.accent, 'accent') };
  if (input.name != null) {
    const n = String(input.name).trim();
    if (!n || n.length > 60 || /[<>{};]/.test(n)) throw new Error('name must be 1 to 60 characters without < > { } ;');
    out.name = n;
  }
  if (input.secondary != null && input.secondary !== '') out.secondary = hex(input.secondary, 'secondary');
  const nv = input.neutral == null || input.neutral === '' ? 'brand' : String(input.neutral).trim().toLowerCase();
  if (nv.startsWith('#')) out.neutral = hex(nv, 'neutral');
  else if (nv in NEUTRAL_PRESETS) out.neutral = nv;
  else throw new Error(`neutral must be brand, cool, warm, neutral or a #hex color, not "${input.neutral}"`);
  out.mode = input.mode == null ? 'both' : String(input.mode);
  if (!['both', 'dark', 'light'].includes(out.mode)) throw new Error(`mode must be both, dark or light, not "${input.mode}"`);
  out.contrast = input.contrast == null ? 'AA' : String(input.contrast).toUpperCase();
  if (!FLOORS[out.contrast]) throw new Error(`contrast must be AA or AAA, not "${input.contrast}"`);
  out.radius = parseLength(input.radius, 'radius') ?? 8;
  if (input.density == null) out.density = 1;
  else if (typeof input.density === 'number' || /^\s*\d*\.?\d+\s*$/.test(String(input.density))) {
    out.density = Number(input.density);
    if (!(out.density >= 0.8 && out.density <= 1.3)) throw new Error(`density must be compact, comfortable, spacious or a number from 0.8 to 1.3, not "${input.density}"`);
  } else if (String(input.density).toLowerCase() in DENSITY) out.density = DENSITY[String(input.density).toLowerCase()];
  else throw new Error(`density must be compact, comfortable, spacious or a number from 0.8 to 1.3, not "${input.density}"`);
  if (input.font != null && input.font !== '') {
    const f = String(input.font).trim();
    if (f.length > 300 || /[;{}<>\\]/.test(f)) throw new Error('font must be a CSS font-family list (no ; { } < > or backslash, at most 300 characters)');
    out.font = f;
  } else out.font = DEFAULT_FONT;
  return out;
}

/* ---------------------------------------------------------------- solving */

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const lchOf = (hex) => C.toOklch(hex);
const hexAt = (L, Ch, h) => C.oklchToHex({ L: clamp(L, 0, 1), C: Ch, h });

/**
 * Find the lightness closest to lch.L, moving in `dir` (+1 lighter, -1 darker),
 * whose gamut-mapped hex satisfies ok(hex). Coarse scan then bisection; the
 * result is always a value ok() accepted, or { ok: false } at the extreme.
 */
function solveL(lch, dir, ok) {
  const at = (L) => hexAt(L, lch.C, lch.h);
  const L0 = clamp(lch.L, 0, 1);
  if (ok(at(L0))) return { hex: at(L0), ok: true, moved: false };
  const STEP = 0.0025;
  let prev = L0, found = null;
  for (let i = 1; i <= 400; i++) {
    const L = clamp(L0 + dir * STEP * i, 0, 1);
    if (ok(at(L))) { found = L; break; }
    prev = L;
    if (L === 0 || L === 1) break;
  }
  if (found == null) return { hex: at(dir > 0 ? 1 : 0), ok: false, moved: true };
  let lo = prev, hi = found;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (ok(at(mid))) hi = mid; else lo = mid;
  }
  return { hex: at(hi), ok: true, moved: true };
}

const meets = (hex, against, floor) => against.every((b) => C.contrastRatio(hex, b) >= floor);

function bestInk(fillHex, inks, floor) {
  // Prefer white (what Prism's generated facets put on fills), then the dark ink.
  for (const ink of inks) if (C.contrastRatio(ink, fillHex) >= floor) return ink;
  return inks.slice().sort((a, b) => C.contrastRatio(b, fillHex) - C.contrastRatio(a, fillHex))[0];
}

/* ------------------------------------------------------------- per mode */

// Neutral ramp: OKLCH lightness and chroma (at full tint) per surface/text role.
const RAMP = {
  dark: {
    '--bg': [0.200, 0.022], '--panel': [0.255, 0.026], '--panel2': [0.290, 0.026], '--card': [0.265, 0.026],
    '--line': [0.370, 0.030], '--ink': [0.950, 0.006], '--muted': [0.760, 0.024], '--dim': [0.600, 0.026],
    ink0: [0.170, 0.010],
  },
  light: {
    '--bg': [0.972, 0.004], '--panel': [1.000, 0.000], '--panel2': [0.978, 0.006], '--card': [1.000, 0.000],
    '--line': [0.900, 0.012], '--ink': [0.240, 0.016], '--muted': [0.520, 0.026], '--dim': [0.680, 0.022],
    ink0: [0.170, 0.010],
  },
};
// Status lightness band per mode (the shared target is the accent's L, clamped),
// and per-hue offsets from that shared L: amber reads as a warning only when it
// sits lighter than the other hues (every hand-tuned dark pack does this).
const STATUS_BAND = { dark: [0.70, 0.82], light: [0.48, 0.60] };
const STATUS_OFFSET = { dark: { '--warn': 0.09, '--pos': 0.02 }, light: { '--warn': 0.02 } };

function neutralSpec(inp, accentLch) {
  const n = inp.neutral;
  const brandK = clamp((accentLch.C - 0.02) / 0.10, 0, 1);
  if (n === 'brand') return { h: accentLch.h, k: brandK, label: 'brand hue' };
  if (n === 'neutral') return { h: accentLch.h, k: NEUTRAL_PRESETS.neutral.k * brandK, label: 'near grey' };
  if (n === 'cool' || n === 'warm') return { ...NEUTRAL_PRESETS[n], label: n };
  const l = lchOf(n);
  return { h: l.h, k: clamp(l.C / 0.025, 0, 1.6), label: `hue of ${n}`, capped: l.C / 0.025 > 1.6, srcC: l.C };
}

function deriveMode(mode, inp, ctx) {
  const floors = FLOORS[inp.contrast];
  const R = RAMP[mode];
  const dir = mode === 'dark' ? +1 : -1;
  const { neutral } = ctx;
  const tone = (role) => ({ L: R[role][0], C: R[role][1] * neutral.k, h: neutral.h });
  const t = {};

  // Surfaces: fixed ramp positions.
  for (const k of ['--bg', '--panel', '--panel2', '--card', '--line']) t[k] = C.oklchToHex(tone(k));
  const surfaces = TEXT_SURFACES.map((k) => t[k]);
  const content = CONTENT_SURFACES.map((k) => t[k]);

  // Text: start at the ramp lightness, move away from the surfaces until it clears.
  t['--ink'] = solveL(tone('--ink'), dir, (h) => meets(h, surfaces, floors.text)).hex;
  t['--muted'] = solveL(tone('--muted'), dir, (h) => meets(h, surfaces, floors.text)).hex;
  t['--dim'] = solveL(tone('--dim'), dir, (h) => meets(h, surfaces, floors.tertiary)).hex;

  // Accent: brand hue and chroma kept; lightness moves only if a floor fails.
  const inks = ['#ffffff', C.oklchToHex(tone('ink0'))];
  const accentOk = (h) => meets(h, content, floors.text) && meets(h, [t['--bg']], floors.ui)
    && C.contrastRatio(bestInk(h, inks, floors.text), h) >= floors.text;
  const a0 = lchOf(inp.accent);
  // An input that already passes is kept byte for byte (no OKLCH round trip).
  const acc = accentOk(inp.accent) ? { hex: inp.accent, ok: true } : solveL(a0, dir, accentOk);
  t['--accent'] = acc.hex;
  if (acc.hex !== inp.accent) ctx.moved.push(moveNote(mode, '--accent', 'accent', inp.accent, acc.hex, failing(inp.accent, t, content, floors, inks)));
  if (!acc.ok) ctx.notes.push(`${mode}: no lightness of hue ${Math.round(a0.h)} meets every accent floor; the closest is used`);
  t['--accent-ink'] = bestInk(t['--accent'], inks, floors.text);

  // Secondary accent (gradient partner): its own hue if given, else the accent.
  if (inp.secondary) {
    const s0 = lchOf(inp.secondary);
    const secOk = (h) => meets(h, [t['--bg'], t['--panel']], floors.ui);
    const sec = secOk(inp.secondary) ? { hex: inp.secondary, ok: true } : solveL(s0, dir, secOk);
    t['--accent2'] = sec.hex;
    if (sec.hex !== inp.secondary) {
      ctx.moved.push(moveNote(mode, '--accent2', 'secondary', inp.secondary, sec.hex,
        [t['--bg'], t['--panel']].map((b, i) => ({ what: `UI on ${i ? '--panel' : '--bg'}`, ratio: C.contrastRatio(inp.secondary, b), floor: floors.ui })).filter((x) => x.ratio < x.floor)));
    }
  } else t['--accent2'] = t['--accent'];

  // Status colors: conventional hues at the accent's chroma, one shared lightness.
  const aL = lchOf(t['--accent']).L;
  const [lo, hi] = STATUS_BAND[mode];
  const Ls = clamp(aL, lo, hi);
  const Cs = clamp(ctx.accentLch.C, 0.12, 0.19);
  const statusOk = (h) => meets(h, content, floors.text) && meets(h, [t['--bg']], floors.ui);
  const off = (k) => STATUS_OFFSET[mode][k] || 0;
  // Solve each hue alone, then put every hue at the shared lightness the most
  // demanding one needed (plus its offset), so the five read as one set.
  const need = STATUS.map((k) => lchOf(solveL({ L: Ls + off(k), C: Cs, h: STATUS_HUES[k] }, dir, statusOk).hex).L - off(k));
  const shared = dir > 0 ? Math.max(Ls, ...need) : Math.min(Ls, ...need);
  STATUS.forEach((k) => {
    t[k] = solveL({ L: shared + off(k), C: Cs, h: STATUS_HUES[k] }, dir, statusOk).hex;
    t[k + '-ink'] = bestInk(t[k], inks, floors.text);
  });

  // -rgb triplets mirror their hex.
  for (const k of ['--accent', '--info', '--pos', '--warn', '--neg', '--crit']) t[k + '-rgb'] = C.toRgbTriplet(C.parseHex(t[k]));

  // Gradient, elevation, shape, motion: BASE_TOKENS shapes, brand-tinted.
  const accRgb = C.parseHex(t['--accent']);
  t['--cardgrad'] = `linear-gradient(157deg,${C.toRgba(accRgb, mode === 'dark' ? 0.08 : 0.06)},${C.toRgba(accRgb, 0)} 55%)`;
  const shadow = mode === 'dark' ? { r: 0, g: 0, b: 0 } : C.parseHex(t['--ink']);
  t['--elev-1'] = `0 1px 2px ${C.toRgba(shadow, mode === 'dark' ? 0.4 : 0.08)}`;
  t['--elev-2'] = `0 6px 18px ${C.toRgba(shadow, mode === 'dark' ? 0.45 : 0.12)}`;
  t['--font'] = inp.font;
  const px = inp.radius;
  t['--r-sm'] = Math.max(2, Math.round(px * 0.5)) + 'px';
  t['--r-md'] = Math.round(px) + 'px';
  t['--r-lg'] = Math.round(px * 1.5) + 'px';
  t['--r-xl'] = Math.round(px * 2) + 'px';
  t['--dur'] = inp.density < 1 ? '.1s' : inp.density > 1 ? '.18s' : '.12s';
  t['--ease'] = 'ease';
  t['--bd'] = '1px';
  t['--head-w'] = '700';
  t['--dens'] = String(inp.density).replace(/^0\./, '.');

  // Top-nav chrome follows the panel.
  t['--cs-topnav-bg'] = t['--panel'];
  t['--cs-topnav-line'] = t['--line'];
  t['--cs-topnav-ink'] = t['--ink'];
  t['--cs-topnav-dim'] = t['--muted'];
  t['--cs-topnav-hover'] = C.toRgba(accRgb, mode === 'dark' ? 0.12 : 0.08);

  const out = {};
  for (const k of TOKENS) out[k] = t[k];
  return out;
}

function failing(hex, t, content, floors, inks) {
  const out = [];
  CONTENT_SURFACES.forEach((k, i) => { const r = C.contrastRatio(hex, content[i]); if (r < floors.text) out.push({ what: `text on ${k}`, ratio: r, floor: floors.text }); });
  const rb = C.contrastRatio(hex, t['--bg']);
  if (rb < floors.ui) out.push({ what: 'UI on --bg', ratio: rb, floor: floors.ui });
  const ink = bestInk(hex, inks, floors.text), ri = C.contrastRatio(ink, hex);
  if (ri < floors.text) out.push({ what: 'ink on accent fill', ratio: ri, floor: floors.text });
  return out;
}

function moveNote(mode, token, what, from, to, fails) {
  const L0 = lchOf(from).L, L1 = lchOf(to).L;
  const darker = L1 < L0;
  const first = fails[0];
  const why = first ? first.what.replace(/--/g, '') : 'contrast';
  const surface = mode === 'dark' ? 'a dark' : 'a light';
  const reason = first && /ink/.test(first.what)
    ? `no readable ink on ${what} ${from} fills`
    : `${what} ${from} too ${darker ? 'light' : 'dark'} for ${/UI/.test(why) ? 'UI' : 'text'} on ${surface} ${/bg/.test(why) ? 'background' : 'panel'}`;
  return {
    mode, token, input: from, output: to,
    L: [C.round(L0, 2), C.round(L1, 2)],
    failed: fails.map((f) => ({ what: f.what, ratio: C.round(f.ratio, 2), floor: f.floor })),
    message: `${reason}: ${darker ? 'darkened' : 'lightened'} to ${to}, L ${C.round(L0, 2).toFixed(2)} to ${C.round(L1, 2).toFixed(2)}`,
  };
}

/* ---------------------------------------------------------------- public */

/**
 * Derive a complete token palette for both color modes from brand inputs.
 * Returns { dark, light, report }; a mode not requested is null.
 * report = { input, neutral, contrast, pairs, failures, moved, notes, summary }.
 */
export function deriveTheme(input) {
  const inp = normalizeInput(input);
  const accentLch = lchOf(inp.accent);
  const neutral = neutralSpec(inp, accentLch);
  const ctx = { accentLch, neutral, moved: [], notes: [] };
  if (neutral.capped) ctx.notes.push(`neutral ${inp.neutral} has chroma ${C.round(neutral.srcC, 3)}, too strong for surfaces: tint capped`);
  const modes = inp.mode === 'both' ? ['dark', 'light'] : [inp.mode];
  const res = { dark: null, light: null };
  const pairs = [];
  for (const m of modes) {
    res[m] = deriveMode(m, inp, ctx);
    pairs.push(...checkContrast(res[m], { mode: m, contrast: inp.contrast }).pairs);
  }
  for (const m of modes) {
    if (res[m]['--accent-ink'] !== '#ffffff') {
      ctx.notes.push(`${m}: accent ${res[m]['--accent']} needs dark ink (${res[m]['--accent-ink']}); components that hardcode #fff on var(--accent) read at ${C.round(C.contrastRatio('#ffffff', res[m]['--accent']), 2)}:1, use var(--accent-ink)`);
    }
  }
  const failures = pairs.filter((p) => p.pass === false);
  const gated = pairs.filter((p) => p.floor != null);
  const report = {
    input: inp,
    neutral: { hue: C.round(neutral.h, 1), tint: C.round(neutral.k, 2), source: neutral.label },
    contrast: inp.contrast,
    floors: FLOORS[inp.contrast],
    pairs,
    failures,
    moved: ctx.moved,
    notes: ctx.notes,
    summary: {
      checked: gated.length, failing: failures.length, ok: failures.length === 0,
      minRatio: { text: minOf(gated, 'text'), ui: minOf(gated, 'ui'), tertiary: minOf(gated, 'tertiary') },
    },
  };
  return { dark: res.dark, light: res.light, report };
}

function minOf(pairs, kind) {
  const r = pairs.filter((p) => p.kind === kind).map((p) => p.ratio);
  return r.length ? Math.min(...r) : null;
}

/** A token map as a :root{...} block (one token per line). */
export function rootCss(tokens, label) {
  if (!tokens) return '';
  let s = `:root{${label ? ` /* ${String(label).replace(/\*\//g, '* /')} */` : ''}\n`;
  for (const k of Object.keys(tokens)) s += `  ${k}: ${tokens[k]};\n`;
  return s + '}';
}

/** Human-readable report (the CLI's output). */
export function formatReport(derived) {
  const { report } = derived;
  const L = [];
  const i = report.input;
  L.push(`Theme "${i.name}"  accent ${i.accent}${i.secondary ? `  secondary ${i.secondary}` : ''}  neutral ${i.neutral} (hue ${report.neutral.hue}, tint ${report.neutral.tint})  contrast ${report.contrast}`);
  L.push(`floors: text ${report.floors.text}:1, UI ${report.floors.ui}:1, tertiary ${report.floors.tertiary}:1`);
  if (report.moved.length) { L.push('', 'Moved inputs:'); for (const m of report.moved) L.push(`  [${m.mode}] ${m.message}`); }
  if (report.notes.length) { L.push('', 'Notes:'); for (const n of report.notes) L.push(`  ${n}`); }
  L.push('', 'mode   fg                bg               fgValue  bgValue   ratio  floor  APCA Lc  result');
  for (const p of report.pairs) {
    L.push(`${p.mode.padEnd(6)} ${p.fg.padEnd(17)} ${p.bg.padEnd(16)} ${String(p.fgValue).slice(0, 7).padEnd(8)} ${p.bgValue}  ${p.ratio.toFixed(2).padStart(6)}  ${p.floor == null ? '   -' : String(p.floor).padStart(4)}  ${p.apca.toFixed(1).padStart(7)}  ${p.pass == null ? 'info' : p.pass ? 'pass' : 'FAIL'}`);
  }
  L.push('', `${report.summary.checked} gated pairs, ${report.summary.failing} failing. Lowest: text ${report.summary.minRatio.text}, UI ${report.summary.minRatio.ui}, tertiary ${report.summary.minRatio.tertiary}`);
  return L.join('\n');
}

/* ------------------------------------------------------------------ CLI */

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument "${a}"`);
    const key = a.slice(2);
    if (['css', 'json', 'help'].includes(key)) { o[key] = true; continue; }
    const v = argv[++i];
    if (v == null) throw new Error(`${a} needs a value`);
    o[key] = v;
  }
  return o;
}

async function main() {
  const USAGE = "Usage: node catalog/theme-engine/derive.mjs --accent '#0078d4' [--name x] [--secondary '#hex'] [--neutral brand|cool|warm|neutral|'#hex'] [--mode both|dark|light] [--contrast AA|AAA] [--radius 8] [--density compact|comfortable|spacious|n] [--font '...'] [--css] [--json] [--profile out.mjs [--ds-short x] [--home-url url]]";
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (err) { console.error(err.message + '\n' + USAGE); process.exit(1); }
  if (o.help || !o.accent) { console.error(USAGE); process.exit(o.help ? 0 : 1); }
  let d;
  try {
    d = deriveTheme({ name: o.name, accent: o.accent, secondary: o.secondary, neutral: o.neutral, mode: o.mode, contrast: o.contrast, radius: o.radius, density: o.density, font: o.font });
  } catch (err) { console.error('error: ' + err.message); process.exit(1); }
  if (o.json) console.log(JSON.stringify(d, null, 2));
  else console.log(formatReport(d));
  if (o.css) {
    for (const m of ['dark', 'light']) if (d[m]) console.log('\n' + rootCss(d[m], `${d.report.input.name} ${m}`));
  }
  if (o.profile) {
    const { toProfile, profileModule } = await import('./profile.mjs');
    const { writeFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const ds = d.report.input.name;
    const p = toProfile(d, { ds, dsShort: o['ds-short'], homeUrl: o['home-url'] });
    writeFileSync(resolve(o.profile), profileModule(p, d));
    console.error(`wrote ${o.profile} (ds "${p.ds}", dsShort "${p.dsShort}")`);
  }
  process.exit(d.report.summary.ok ? 0 : 2);
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
