/* ============================================================================
   Helpers for the per-facet gate (catalog/_check_facets.mjs). Zero deps.
   ----------------------------------------------------------------------------
     themeById / registryThemes   read a theme's :root block straight out of
                                  Prism.html's THEME_REGISTRY (the copy the shell
                                  injects into every gallery frame), so a themed
                                  run needs no server.
     themedDoc                    a facet's standalone sample, re-skinned the way
                                  the shell re-skins a gallery frame.
     collectTextItems             (runs IN the page) freezes motion and lists every
                                  rendered text run in the stage: its boxes, its
                                  computed fill, effective opacity and size.
     maskCss / HIDE_CSS           paint each run's glyphs a probe color (runs whose
                                  boxes overlap get different ones) / hide every
                                  glyph; the two screenshots give, per text run,
                                  where its glyphs actually land (clipped, covered,
                                  back-face and fully faded text drops out) and the
                                  real painted background under them (gradients,
                                  pseudo elements and siblings included).
     decodePng                    8-bit RGB/RGBA PNG -> RGBA bytes (CDP screenshots).
     measureItems / floorFor      WCAG 2.x contrast of each run against the pixels
                                  under its glyphs, and the floor it must meet.
     openWindowTab / measureText  the CDP plumbing: a tab in its OWN window (a
                                  background tab is hidden and never paints, so a
                                  screenshot there stalls), and the whole measure of
                                  the document on a tab.
   ========================================================================== */
import { inflateSync } from 'node:zlib';
import { loadHtmlThemes } from './_check_themes.mjs';
import { parseColor } from './theme-engine/color.mjs';

/* ------------------------------------------------------------- theme tokens */

/** Every THEME_REGISTRY entry of a Prism.html source: {id, ds, mode, name, css}. */
export function registryThemes(html) {
  return loadHtmlThemes(html).map(({ id, ds, mode, name, css }) => ({ id, ds, mode, name, css }));
}

/** One registry theme by id, or throw (an unknown id or a const the registry names but
 *  the file does not define must not silently render the dark defaults). */
export function themeById(html, id) {
  const all = registryThemes(html);
  const t = all.find((x) => x.id === id);
  if (!t) throw new Error(`unknown theme "${id}"; registry has: ${all.map((x) => x.id).join(', ')}`);
  if (!t.css || !/--bg\s*:/.test(t.css)) throw new Error(`theme "${id}" has no :root token block in Prism.html`);
  return t;
}

/** The theme's token map ({'--bg': '#f2f3f3', ...}) for matching computed colors. */
export function tokenMap(css) {
  const out = {};
  for (const m of String(css || '').matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) out[m[1]] = m[2].trim();
  return out;
}

/* --------------------------------------------------------------- sample doc */

/** A facet's standalone sample: the global tokens, the gate's stage, the facet's CSS
 *  and markup, its initializer. With a theme, the root carries data-ds / data-mode /
 *  data-theme / color-scheme and the theme's :root block lands after the facet CSS,
 *  exactly as the shell stamps and injects a gallery frame (stampRoot, themeSrcdoc). */
export function themedDoc(e, { tokensCss = '', theme = null, init = '' } = {}) {
  const js = init ? `<script>\n${init}\n</script>` : '';
  const bg = e.usableAsBackground ? ' bg' : '';
  const root = theme ? ` data-ds="${theme.ds}" data-mode="${theme.mode}" data-theme="${theme.id}" style="color-scheme:${theme.mode}"` : '';
  const themeCss = theme ? `\n<style id="prism-theme-vars">${theme.css}</style>` : '';
  return `<!DOCTYPE html><html${root}><head><meta charset="utf-8">
<style id="prism-tokens">${tokensCss}</style>
<style id="shell">html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,sans-serif}
body{min-height:100vh;box-sizing:border-box;padding:24px;display:flex;align-items:center;justify-content:center}
.stage{position:relative;overflow:hidden;box-sizing:border-box;width:320px;min-height:120px;padding:24px 16px;display:flex;align-items:center;justify-content:center;background:var(--panel);border:1px solid var(--line);border-radius:14px}
.stage.bg{padding:0}</style>
<style id="effect-css">${e.css || ''}</style>${themeCss}</head>
<body><div class="stage${bg}" id="stage">${e.html || ''}</div>${js}</body></html>`;
}

/* ---------------------------------------------------------- in-page collector */

// Serialized into the page (collectTextItems.toString()): it may use nothing from module scope.
export function collectTextItems(stageId) {
  var stage = document.getElementById(stageId);
  if (!stage) return { rect: null, items: [] };
  // One deterministic frame: finite animations and transitions at their end state (a
  // fade-in shows its final look), infinite ones cancelled (the static look a reduced-
  // motion visitor gets: a looping grow-in bar shows its width, not an empty track at
  // t=0), SMIL paused at 0. Runs after the motion checks, so it changes nothing they measure.
  try {
    document.getAnimations().forEach(function (a) {
      try {
        var t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
        if (t && isFinite(t.endTime)) a.finish(); else a.cancel();
      } catch (e) {}
    });
  } catch (e) {}
  [].forEach.call(document.querySelectorAll('svg'), function (s) { try { s.pauseAnimations(); s.setCurrentTime(0); } catch (e) {} });

  // boxes are relative to the stage's whole-pixel origin, the screenshot clip's origin
  var sr = stage.getBoundingClientRect(), ox = Math.floor(sr.left), oy = Math.floor(sr.top);
  var SKIP = { style: 1, script: 1, template: 1, noscript: 1, title: 1, desc: 1, metadata: 1, option: 1, optgroup: 1, datalist: 1 };
  var NONRENDER = { defs: 1, symbol: 1, clippath: 1, mask: 1, pattern: 1, marker: 1, lineargradient: 1, radialgradient: 1, filter: 1 };
  var RECOLOR = /invert|hue-rotate|brightness|contrast|saturate|sepia|grayscale|url\(/;
  var INPUT_TEXT = /^(|text|search|email|number|password|tel|url|button|submit|reset)$/;
  var cache = typeof Map === 'function' ? new Map() : null;
  // effective opacity of el's group chain, and why its painted color is not knowable
  // from computed style (a blend mode or a recoloring filter on the way up)
  function chain(el) {
    if (cache && cache.has(el)) return cache.get(el);
    var r;
    if (!el || el.nodeType !== 1) r = { op: 1, why: '' };
    else {
      var cs = getComputedStyle(el), up = chain(el.parentNode);
      var why = up.why;
      if (!why && cs.mixBlendMode && cs.mixBlendMode !== 'normal') why = 'blend';
      if (!why && cs.filter && cs.filter !== 'none' && RECOLOR.test(cs.filter)) why = 'filter';
      if (NONRENDER[(el.localName || '').toLowerCase()]) why = 'nonrender';
      if (el.matches && el.matches(':disabled,[aria-disabled="true"]')) why = why || 'disabled';
      r = { op: up.op * parseFloat(cs.opacity || '1'), why: why };
    }
    if (cache) cache.set(el, r);
    return r;
  }
  function rel(q) { return [q.left - ox, q.top - oy, q.width, q.height]; }
  function name(el, pe) {
    var c = (el.getAttribute && el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return el.localName + (c.length ? '.' + c.join('.') : '') + (pe || '');
  }
  function sizeOf(el, cs, svg) {
    var px = parseFloat(cs.fontSize) || 0;
    if (svg && el.getScreenCTM) { try { var m = el.getScreenCTM(); if (m) px *= Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)); } catch (e) {} }
    return Math.round(px * 10) / 10;
  }
  // Any computed color as rgba(): color-mix() computes to color(srgb ...) and oklch()/lab()
  // stay in their own space, so a 1x1 canvas paints it and reads the sRGB bytes back.
  var cv = document.createElement('canvas'); cv.width = cv.height = 1;
  var cx = cv.getContext('2d', { willReadFrequently: true });
  function rgba(c) {
    if (!c || /^rgba?\(/.test(c)) return c;
    try {
      cx.clearRect(0, 0, 1, 1); cx.fillStyle = 'rgba(0,0,0,0)'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
      var d = cx.getImageData(0, 0, 1, 1).data;
      return 'rgba(' + d[0] + ', ' + d[1] + ', ' + d[2] + ', ' + Math.round(d[3] / 255 * 1000) / 1000 + ')';
    } catch (e) { return c; }
  }
  function textFill(cs, svg) {
    if (svg) {
      if (!cs.fill || cs.fill === 'none' || /^url\(/.test(cs.fill)) return { skip: 'paint-server' };
      return { color: rgba(cs.fill), alpha: parseFloat(cs.fillOpacity || '1') };
    }
    if (/text/.test((cs.webkitBackgroundClip || '') + ' ' + (cs.backgroundClip || ''))) return { skip: 'clip-text' };
    var fill = rgba(cs.webkitTextFillColor || cs.color);
    // outlined text (a near-clear fill inside a -webkit-text-stroke) reads by its stroke
    var m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(fill);
    if (parseFloat(cs.webkitTextStrokeWidth) >= 0.5 && m && parseFloat(m[1]) < 0.4) return { color: rgba(cs.webkitTextStrokeColor), alpha: 1 };
    return { color: fill, alpha: 1 };
  }
  // color emoji paint their own colors, whatever the fill: a run of nothing else is not judged
  // (astral pictographs render as color emoji even without U+FE0F)
  var EMOJI = /^(?:\p{Emoji_Presentation}|\p{Emoji_Modifier}|[\u{1F000}-\u{1FAFF}]|\p{Extended_Pictographic}\uFE0F|[\uFE0F\u200D\s])+$/u;
  var items = [];
  // each run is addressable from the mask stylesheet: [data-pfx="<key>"]<sel>
  function push(el, pe, kind, text, rects, cs, fill, op, why) {
    var svg = !pe && el.namespaceURI === 'http://www.w3.org/2000/svg';
    var size = sizeOf(el, cs, svg);
    var wt = parseInt(cs.fontWeight, 10) || 400;
    el.setAttribute('data-pfx', String(i));
    items.push({
      key: i, sel: pe || '', svg: svg,
      kind: kind, el: name(el, pe), text: text.replace(/\s+/g, ' ').trim().slice(0, 40), rects: rects,
      color: fill.color || '', alpha: fill.alpha == null ? 1 : fill.alpha, op: Math.round(op * 1000) / 1000,
      size: size, wt: wt, large: size >= 24 || (size >= 18.66 && wt >= 700),
      // the --dim in effect here (a dark island inside a light theme carries its own)
      dim: (cs.getPropertyValue('--dim') || '').trim(),
      glyph: !/[0-9A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF]/.test(text),
      // under 5px (a 960px diagram scaled into the 320px stage) glyphs are antialiasing, not legible text
      skip: fill.skip || why || (EMOJI.test(text) ? 'emoji' : '') || (size < 5 ? 'tiny' : '')
    });
  }
  var els = [stage].concat([].slice.call(stage.querySelectorAll('*')));
  for (var i = 0; i < els.length; i++) {
    var el = els[i], tag = (el.localName || '').toLowerCase();
    if (SKIP[tag]) continue;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility !== 'visible') continue;
    var svg = el.namespaceURI === 'http://www.w3.org/2000/svg';
    var ch = chain(el);
    if (ch.why === 'nonrender') continue;
    // own text runs (SVG text only renders inside text content elements)
    if (!svg || (typeof SVGTextContentElement !== 'undefined' && el instanceof SVGTextContentElement)) {
      var runs = [], rects = [];
      for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && /\S/.test(n.data)) runs.push(n);
      if (runs.length) {
        if (svg) rects.push(rel(el.getBoundingClientRect()));
        else runs.forEach(function (t) {
          var r = document.createRange(); r.selectNodeContents(t);
          [].forEach.call(r.getClientRects(), function (q) { if (q.width > 0 && q.height > 0) rects.push(rel(q)); });
        });
        if (rects.length) push(el, '', 'text', runs.map(function (t) { return t.data; }).join(' '), rects, cs, textFill(cs, svg), ch.op, ch.why);
      }
    }
    // form controls: the value, else the placeholder (incidental text)
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      var type = (el.getAttribute('type') || '').toLowerCase();
      if (tag !== 'input' || INPUT_TEXT.test(type)) {
        var val = tag === 'select' ? (el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].textContent : '') : el.value;
        var box = [rel(el.getBoundingClientRect())];
        if (val && /\S/.test(val)) push(el, '', 'input', val, box, cs, textFill(cs, false), ch.op, ch.why);
        else if (el.placeholder) {
          var ph = getComputedStyle(el, '::placeholder');
          push(el, '::placeholder', 'placeholder', el.placeholder, box, ph, { color: rgba(ph.color), alpha: 1 }, ch.op, ch.why);
        }
      }
    }
    // generated content: boxes are the owner's (the glyph mask localizes them)
    if (!svg) ['::before', '::after'].forEach(function (pe) {
      var ps = getComputedStyle(el, pe), c = ps.content || '';
      if (c === 'none' || c === 'normal' || ps.display === 'none' || ps.visibility !== 'visible') return;
      var str = (c.match(/"(?:[^"\\]|\\.)*"/g) || []).map(function (q) { return q.slice(1, -1); }).join('');
      if (!/\S/.test(str)) return;
      push(el, pe, 'pseudo', str, [rel(el.getBoundingClientRect())], ps, textFill(ps, false), ch.op * parseFloat(ps.opacity || '1'), ch.why);
    });
  }
  return { rect: { x: ox, y: oy, w: Math.ceil(sr.right) - ox, h: Math.ceil(sr.bottom) - oy }, items: items };
}

// Every glyph hidden, nothing else changed: the fill color does not move currentColor, so
// borders, icons and tints drawn with it stay put.
const GLYPHS = '*,*::before,*::after,*::placeholder';
const SVG_TEXT = 'text,tspan,textPath';
// No transitions: a facet with transition:all would otherwise fade the probe colors in.
export const HIDE_CSS = `${GLYPHS}{transition:none!important;-webkit-text-fill-color:transparent!important;-webkit-text-stroke-color:transparent!important;text-shadow:none!important;text-decoration-color:transparent!important;caret-color:transparent!important}${SVG_TEXT}{fill:transparent!important;stroke:none!important}`;

// Probe colors, far apart in every direction from any backdrop.
export const CODES = [[255, 0, 255], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
const overlaps = (a, b) => a.rects.some(([x, y, w, h]) => b.rects.some(([u, v, p, q]) => x < u + p && u < x + w && y < v + q && v < y + h));

/** Echo layers: glitch / misregister ::before and ::after copies, stacked extrusion and
 *  parallax layers repeat a run's text over its own box; only the front copy is read.
 *  Of runs with the same text and overlapping boxes, keep an element's own text over
 *  generated content, then the most opaque, then the last painted; mark the rest
 *  skip:'echo'. Mutates and returns items. */
export function markEchoes(items) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const alphaOf = (it) => { const c = parseColor(it.color); return (c ? c.a : 1) * (it.alpha == null ? 1 : it.alpha) * (it.op == null ? 1 : it.op); };
  const live = items.filter((it) => !it.skip && norm(it.text));
  const better = (a, b) => (a.kind !== 'pseudo') !== (b.kind !== 'pseudo') ? a.kind !== 'pseudo' : alphaOf(a) !== alphaOf(b) ? alphaOf(a) > alphaOf(b) : items.indexOf(a) > items.indexOf(b);
  for (const it of live) {
    const rivals = live.filter((o) => o !== it && norm(o.text) === norm(it.text) && overlaps(o, it));
    if (rivals.some((o) => better(o, it))) it.skip = 'echo';
  }
  return items;
}

/** Give each run a probe color (index into CODES) no overlapping run already has, so a
 *  glyph pixel belongs to the run whose color explains it. Mutates and returns items. */
export function assignCodes(items) {
  const done = [];
  for (const it of items) {
    const used = new Set(done.filter((o) => overlaps(o, it)).map((o) => o.code));
    it.code = CODES.findIndex((_, k) => !used.has(k));
    if (it.code < 0) it.code = 0; // more overlaps than colors: share (rare)
    done.push(it);
  }
  return items;
}

/** HIDE_CSS plus one rule per run painting just its glyphs its probe color (the attribute
 *  selector outranks the hide rule's universal one; both are !important). */
export function maskCss(items) {
  return HIDE_CSS + items.map((it) => {
    const c = `rgb(${CODES[it.code].join(',')})`, at = `[data-pfx="${it.key}"]${it.sel || ''}`;
    return it.svg ? `${at}{fill:${c}!important;fill-opacity:1!important}` : `${at}{-webkit-text-fill-color:${c}!important}`;
  }).join('');
}

/* -------------------------------------------------------------------- PNG */

/** Decode an 8-bit, non-interlaced RGB or RGBA PNG to {width, height, data: RGBA bytes}. */
export function decodePng(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  if (b.length < 8 || SIG.some((v, i) => b[i] !== v)) throw new Error('not a PNG');
  let p = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (p + 8 <= b.length) {
    const len = b.readUInt32BE(p), kind = b.toString('latin1', p + 4, p + 8);
    if (p + 12 + len > b.length) throw new Error('truncated PNG chunk ' + kind);
    const body = b.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    p += 12 + len;
  }
  if (!width || !height) throw new Error('PNG has no IHDR');
  if (depth !== 8 || (type !== 6 && type !== 2) || interlace) throw new Error(`unsupported PNG (depth ${depth}, color type ${type}, interlace ${interlace})`);
  const bpp = type === 6 ? 4 : 3, stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < height * (stride + 1)) throw new Error('truncated PNG image data');
  const cur = Buffer.alloc(stride), prev = Buffer.alloc(stride), out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      else if (f !== 0) throw new Error('bad PNG filter ' + f);
      cur[x] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * bpp]; out[o + 1] = cur[x * bpp + 1]; out[o + 2] = cur[x * bpp + 2]; out[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    cur.copy(prev);
  }
  return { width, height, data: out };
}

/* ---------------------------------------------------------------- contrast */

const LIN = Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
const lum = (r, g, b) => 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];
const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/** The contrast floor a text run must meet (WCAG 2.x 1.4.3 / 1.4.11):
 *    3   large text (24px, or 18.66px bold), a glyph with no letter or digit (an icon,
 *        bullet or separator: a graphical object), a placeholder, or text painted in the
 *        --dim in effect at the run (item.dim, else the theme's; incidental text: the token
 *        contract _check_themes.mjs holds --dim to);
 *    4.5 everything else. */
export function floorFor(item, { dim = null } = {}) {
  if (item.large || item.glyph || item.kind === 'placeholder') return 3;
  if (item.dim || dim) { const c = parseColor(item.color), d = parseColor(item.dim || dim); if (c && d && Math.round(c.r) === Math.round(d.r) && Math.round(c.g) === Math.round(d.g) && Math.round(c.b) === Math.round(d.b)) return 3; }
  return 4.5;
}

// Which probe color explains mask pixel m over backdrop b: m = b + a*(code - b) for the
// code with the smallest residual; -1 when none fits with a meaningful coverage a.
export function codeAt(m0, m1, m2, b0, b1, b2) {
  const d0 = m0 - b0, d1 = m1 - b1, d2 = m2 - b2;
  let best = -1, bestR = Infinity;
  for (let k = 0; k < CODES.length; k++) {
    const v0 = CODES[k][0] - b0, v1 = CODES[k][1] - b1, v2 = CODES[k][2] - b2, vv = v0 * v0 + v1 * v1 + v2 * v2;
    if (vv < 2000) continue; // the backdrop is this color: it cannot show here
    const a = (d0 * v0 + d1 * v1 + d2 * v2) / vv;
    if (a < 0.2) continue;
    const r = (d0 - a * v0) ** 2 + (d1 - a * v1) ** 2 + (d2 - a * v2) ** 2;
    if (r < bestR) { bestR = r; best = k; }
  }
  return best;
}

/** Measure each text run: its glyph pixels are the pixels inside its boxes where the
 *  MASK screenshot differs from the HIDE one by the run's own probe color (item.code;
 *  without one, any difference counts). The text color (alpha x group opacity) is
 *  composited over the HIDE pixel under each glyph pixel and the run's ratio is the low
 *  percentile across them (a run is as legible as the worst part of its backdrop,
 *  minus outliers). Returns the items with {ratio, bg, n: glyph pixels}, or
 *  {hidden:true} when none land. */
export function measureItems(items, mask, bg, { diff = 60, minPx = 4, pct = 0.1 } = {}) {
  const W = Math.min(mask.width, bg.width), H = Math.min(mask.height, bg.height);
  return items.map((it) => {
    if (it.skip) return { ...it };
    const fg = parseColor(it.color);
    if (!fg) return { ...it, skip: 'unparsed-color' };
    const a = (fg.a == null ? 1 : fg.a) * (it.alpha == null ? 1 : it.alpha) * (it.op == null ? 1 : it.op);
    if (a <= 0) return { ...it, skip: 'transparent' };
    const seen = new Set(), ratios = [];
    for (const [x, y, w, h] of it.rects) {
      const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
      const x1 = Math.min(W, Math.ceil(x + w)), y1 = Math.min(H, Math.ceil(y + h));
      for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
        const i = py * W + px;
        if (seen.has(i)) continue; seen.add(i);
        const mo = (py * mask.width + px) * 4, bo = (py * bg.width + px) * 4;
        const d = Math.abs(mask.data[mo] - bg.data[bo]) + Math.abs(mask.data[mo + 1] - bg.data[bo + 1]) + Math.abs(mask.data[mo + 2] - bg.data[bo + 2]);
        if (d < diff) continue;
        const br = bg.data[bo], bgc = bg.data[bo + 1], bb = bg.data[bo + 2];
        if (it.code != null && codeAt(mask.data[mo], mask.data[mo + 1], mask.data[mo + 2], br, bgc, bb) !== it.code) continue;
        const tr = Math.round(fg.r * a + br * (1 - a)), tg = Math.round(fg.g * a + bgc * (1 - a)), tb = Math.round(fg.b * a + bb * (1 - a));
        const l1 = lum(tr, tg, tb), l2 = lum(br, bgc, bb);
        ratios.push([(Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), br, bgc, bb]);
      }
    }
    if (ratios.length < minPx) return { ...it, hidden: true };
    ratios.sort((p, q) => p[0] - q[0]);
    const lo = ratios[Math.floor(pct * (ratios.length - 1))];
    return { ...it, ratio: Math.round(lo[0] * 100) / 100, bg: hex(lo[1], lo[2], lo[3]), n: ratios.length };
  });
}

/* ---------------------------------------------------------------- CDP tabs */

/** Open a page in a new window of the browser listening on `port` and return a small
 *  CDP client for it: send(), ev() (evaluate by value), shot(clip) (decoded PNG) and
 *  errs (console errors and exceptions since the caller last cleared it). Every call
 *  gives up after `timeout` ms, so one stuck page cannot hang a whole run. */
export async function openWindowTab(port, { width = 900, height = 1400, timeout = 30000 } = {}) {
  const { webSocketDebuggerUrl } = await (await fetch(`http://localhost:${port}/json/version`)).json();
  const bws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r, j) => { bws.onopen = r; bws.onerror = j; });
  const targetId = await new Promise((r) => { bws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) r(m.result && m.result.targetId); }; bws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'about:blank', newWindow: true } })); });
  try { bws.close(); } catch {}
  if (!targetId) throw new Error('could not open a window');
  const ws = new WebSocket(`ws://localhost:${port}/devtools/page/${targetId}`);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const pending = new Map(); let id = 0;
  const tab = { ws, errs: [], close: () => { try { ws.close(); } catch {} } };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || { error: m.error }); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') tab.errs.push((m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 160));
    if (m.method === 'Runtime.exceptionThrown') tab.errs.push('EXC: ' + (m.params.exceptionDetails && (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text) || 'error').slice(0, 160));
  };
  tab.send = (method, params = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ error: { message: `${method} timed out` } }); } }, timeout);
  });
  tab.ev = async (x) => { const r = await tab.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r && r.result && r.result.value; };
  tab.shot = async (clip) => { const r = await tab.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } }); return r && r.data ? decodePng(Buffer.from(r.data, 'base64')) : null; };
  await tab.send('Page.enable'); await tab.send('Runtime.enable');
  await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  tab.view = { width, height };
  return tab;
}

const COLLECT = `(${collectTextItems.toString()})('stage')`;
const probeCss = (css) => `(function(){var s=document.getElementById('__probe');if(!s){s=document.createElement('style');s.id='__probe';document.head.appendChild(s);}s.textContent=${JSON.stringify(css)};})()`;

/** Text contrast of the document on `tab`: collect the runs in #stage, screenshot the
 *  stage with every glyph the probe color and with every glyph hidden, measure each run
 *  and attach its floor. Returns the measured runs (skipped and hidden ones left out).
 *  Freezes the page's motion, so call it after anything that measures animation. */
export async function measureText(tab, { dim = null } = {}) {
  const got = await tab.ev(COLLECT);
  if (!got || !got.rect) return [];
  const live = markEchoes(got.items).filter((it) => !it.skip);
  if (!live.length) return [];
  const { width, height } = tab.view;
  const clip = { x: got.rect.x, y: got.rect.y, width: Math.max(1, Math.min(got.rect.w, width - got.rect.x)), height: Math.max(1, Math.min(got.rect.h, height - got.rect.y)) };
  assignCodes(live);
  await tab.ev(probeCss(maskCss(live))); const mask = await tab.shot(clip);
  await tab.ev(probeCss(HIDE_CSS)); const bg = await tab.shot(clip);
  if (!mask || !bg) throw new Error('stage screenshot failed');
  const measured = measureItems(live, mask, bg);
  // a color the probe cannot read must not pass as legible
  const unread = measured.filter((it) => it.skip === 'unparsed-color');
  if (unread.length) throw new Error('unreadable text color ' + unread.map((it) => JSON.stringify(it.color)).join(', '));
  return measured.filter((it) => !it.skip && !it.hidden).map((it) => ({ ...it, floor: floorFor(it, { dim }) }));
}
