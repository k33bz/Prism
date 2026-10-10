/* Prism theme engine: color math. Zero dependencies.
   ----------------------------------------------------------------------------
   - parsing and formatting: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), and
     the bare "r,g,b" triplet Prism's -rgb tokens carry;
   - sRGB <-> linear sRGB <-> OKLab <-> OKLCH (Bjorn Ottosson's matrices);
   - gamut mapping: reduce chroma at fixed L and h until the color fits sRGB;
   - WCAG 2.x relative luminance and contrast ratio;
   - APCA Lc (APCA-W3 0.0.98G-4g constants) as an optional second metric.

   Colors move between functions as plain objects:
     rgb   { r, g, b, a? }   r/g/b in 0..255 (floats allowed), a in 0..1
     lab   { L, a, b }       OKLab
     lch   { L, C, h }       OKLCH, h in degrees 0..360 (0 for achromatic)  */

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/* ------------------------------------------------------------- parse/format */

/** Parse a CSS color string into { r, g, b, a } (0..255, alpha 0..1), or null. */
export function parseColor(input) {
  if (input && typeof input === 'object' && 'r' in input) return { r: +input.r, g: +input.g, b: +input.b, a: input.a == null ? 1 : +input.a };
  const s = String(input == null ? '' : input).trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(\s*([^)]*)\)$/.exec(s);
  const body = m ? m[1] : /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(s) ? s : null;
  if (body == null) return null;
  const parts = body.split(/\s*[,/]\s*|\s+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const ch = (p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
  const al = (p) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p));
  const out = { r: ch(parts[0]), g: ch(parts[1]), b: ch(parts[2]), a: parts[3] != null ? al(parts[3]) : 1 };
  if (![out.r, out.g, out.b, out.a].every(Number.isFinite)) return null;
  out.r = clamp(out.r, 0, 255); out.g = clamp(out.g, 0, 255); out.b = clamp(out.b, 0, 255); out.a = clamp(out.a, 0, 1);
  return out;
}

/** Parse a hex color ("#rgb" or "#rrggbb"; alpha forms accepted), or throw. */
export function parseHex(hex) {
  const c = /^#/.test(String(hex).trim()) ? parseColor(hex) : null;
  if (!c) throw new Error(`"${hex}" is not a #rgb / #rrggbb hex color`);
  return c;
}

const byte = (x) => clamp(Math.round(x), 0, 255);
const hx = (x) => byte(x).toString(16).padStart(2, '0');

/** { r, g, b } -> "#rrggbb" (rounded, clamped; alpha ignored). */
export function toHex(rgb) { return '#' + hx(rgb.r) + hx(rgb.g) + hx(rgb.b); }

/** { r, g, b } -> "r,g,b" (the -rgb token triplet). */
export function toRgbTriplet(rgb) { return `${byte(rgb.r)},${byte(rgb.g)},${byte(rgb.b)}`; }

/** { r, g, b } + alpha -> "rgba(r,g,b,.a)" in Prism's compact style. */
export function toRgba(rgb, alpha) {
  const a = Math.round(clamp(alpha, 0, 1) * 1000) / 1000;
  const as = a === 0 ? '0' : a === 1 ? '1' : String(a).replace(/^0\./, '.');
  return `rgba(${toRgbTriplet(rgb)},${as})`;
}

/** Normalize any parseable color to "#rrggbb" (or throw). */
export function normalizeHex(input) {
  const c = parseColor(input);
  if (!c) throw new Error(`"${input}" is not a color`);
  return toHex(c);
}

/** Alpha-composite fg (with its own alpha) over an opaque bg. Returns opaque rgb. */
export function composite(fg, bg) {
  const a = fg.a == null ? 1 : fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

/* -------------------------------------------------------------- sRGB/linear */

export function srgbToLinear(c) { // c in 0..1
  const s = Math.sign(c) || 1, x = Math.abs(c);
  return s * (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
}
export function linearToSrgb(c) {
  const s = Math.sign(c) || 1, x = Math.abs(c);
  return s * (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
}

/* ----------------------------------------------------------------- OKLab */

/** Linear sRGB (0..1 floats) -> OKLab. */
export function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

/** OKLab -> linear sRGB (0..1 floats, may be out of gamut). */
export function oklabToLinear({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

/** { r, g, b } (0..255) -> OKLab. */
export function rgbToOklab(rgb) { return linearToOklab([rgb.r, rgb.g, rgb.b].map((c) => srgbToLinear(c / 255))); }

/** OKLab -> { r, g, b } (0..255 floats, clamped). Use gamutMap first for out-of-gamut input. */
export function oklabToRgb(lab) {
  const [r, g, b] = oklabToLinear(lab).map((c) => clamp(linearToSrgb(c), 0, 1) * 255);
  return { r, g, b, a: 1 };
}

export function oklabToOklch({ L, a, b }) {
  const C = Math.hypot(a, b);
  let h = C < 1e-7 ? 0 : (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}
export function oklchToOklab({ L, C, h }) {
  const r = (h * Math.PI) / 180;
  return { L, a: C * Math.cos(r), b: C * Math.sin(r) };
}

export function rgbToOklch(rgb) { return oklabToOklch(rgbToOklab(rgb)); }

/* ------------------------------------------------------------ gamut mapping */

// Ottosson's published matrices round-trip to about 1e-6, so the gamut test
// allows that much before it calls a color out of gamut.
const GAMUT_EPS = 2e-5;
/** Is an OKLCH color inside the sRGB gamut? */
export function inGamut(lch) {
  return oklabToLinear(oklchToOklab(lch)).every((c) => c >= -GAMUT_EPS && c <= 1 + GAMUT_EPS);
}

/** Fit OKLCH into sRGB by reducing chroma at fixed L and h (bisection). Returns { L, C, h }. */
export function gamutMap(lch) {
  const L = clamp(lch.L, 0, 1), h = lch.h || 0;
  let C = Math.max(0, lch.C || 0);
  if (L <= 0 || L >= 1) return { L, C: 0, h };
  if (inGamut({ L, C, h })) return { L, C, h };
  let lo = 0, hi = C;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut({ L, C: mid, h })) lo = mid; else hi = mid;
  }
  return { L, C: lo, h };
}

/** OKLCH -> { r, g, b } (gamut mapped by chroma reduction). */
export function oklchToRgb(lch) { return oklabToRgb(oklchToOklab(gamutMap(lch))); }

/** OKLCH -> "#rrggbb" (gamut mapped by chroma reduction). */
export function oklchToHex(lch) { return toHex(oklchToRgb(lch)); }

/** Any color -> OKLCH. */
export function toOklch(color) {
  const c = parseColor(color);
  if (!c) throw new Error(`"${color}" is not a color`);
  return rgbToOklch(c);
}

/** Euclidean distance in OKLab (deltaE OK), between two colors. */
export function deltaEOK(x, y) {
  const a = rgbToOklab(parseColor(x)), b = rgbToOklab(parseColor(y));
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

/* --------------------------------------------------------------- WCAG 2.x */

/** WCAG 2.x relative luminance of an opaque color (0..1). */
export function relativeLuminance(color) {
  const c = parseColor(color);
  if (!c) throw new Error(`"${color}" is not a color`);
  const [r, g, b] = [c.r, c.g, c.b].map((v) => srgbToLinear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two opaque colors (1..21). */
export function contrastRatio(fg, bg) {
  const a = relativeLuminance(fg), b = relativeLuminance(bg);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------------------------ APCA */

// APCA-W3 0.0.98G-4g constants. Lc is signed: positive for dark text on a light
// background, negative for light text on a dark one. |Lc| 75 ~ body text, 60 ~
// large text, 45 ~ headlines and UI; 15 is the "invisible" floor.
const APCA = {
  mainTRC: 2.4, sRco: 0.2126729, sGco: 0.7151522, sBco: 0.0721750,
  normBG: 0.56, normTXT: 0.57, revTXT: 0.62, revBG: 0.65,
  blkThrs: 0.022, blkClmp: 1.414, scaleBoW: 1.14, scaleWoB: 1.14,
  loBoWoffset: 0.027, loWoBoffset: 0.027, deltaYmin: 0.0005, loClip: 0.1,
};
function apcaY(c) {
  const f = (v) => Math.pow(v / 255, APCA.mainTRC);
  return APCA.sRco * f(c.r) + APCA.sGco * f(c.g) + APCA.sBco * f(c.b);
}

/** APCA lightness contrast Lc of text on a background (about -108..106). */
export function apcaContrast(text, background) {
  const t = parseColor(text), bgc = parseColor(background);
  if (!t || !bgc) throw new Error('apcaContrast needs two colors');
  let txtY = apcaY(t), bgY = apcaY(bgc);
  const soft = (y) => (y > APCA.blkThrs ? y : y + Math.pow(APCA.blkThrs - y, APCA.blkClmp));
  txtY = soft(txtY); bgY = soft(bgY);
  if (Math.abs(bgY - txtY) < APCA.deltaYmin) return 0;
  let out;
  if (bgY > txtY) {
    const sapc = (Math.pow(bgY, APCA.normBG) - Math.pow(txtY, APCA.normTXT)) * APCA.scaleBoW;
    out = sapc < APCA.loClip ? 0 : sapc - APCA.loBoWoffset;
  } else {
    const sapc = (Math.pow(bgY, APCA.revBG) - Math.pow(txtY, APCA.revTXT)) * APCA.scaleWoB;
    out = sapc > -APCA.loClip ? 0 : sapc + APCA.loWoBoffset;
  }
  return out * 100;
}

/* ---------------------------------------------------------------- helpers */

/** Round to n decimals (report formatting). */
export function round(x, n = 2) { const p = 10 ** n; return Math.round(x * p) / p; }
