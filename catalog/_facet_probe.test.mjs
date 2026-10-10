// node --test catalog/_facet_probe.test.mjs
// Covers the per-facet gate's helpers: the theme token reader, the themed sample document,
// the PNG decoder the screenshots go through, the contrast floors and the glyph-localized
// contrast measure. Each has a negative control. Zero deps, offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { registryThemes, themeById, tokenMap, themedDoc, decodePng, floorFor, measureItems, maskCss, HIDE_CSS, assignCodes, codeAt, CODES, markEchoes } from './_facet_probe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(resolve(HERE, '../Prism.html'), 'utf8');

/* ------------------------------------------------------------ token reader */

test('token reader: every registry theme, Cloudscape Light as the shell applies it', () => {
  const all = registryThemes(HTML);
  assert.equal(all.length, 32);
  assert.equal(all.filter(t => t.mode === 'light').length, 16);
  const cl = themeById(HTML, 'cloudscape-light');
  assert.equal(cl.mode, 'light'); assert.equal(cl.ds, 'cloudscape');
  const k = tokenMap(cl.css);
  assert.equal(k['--bg'], '#f2f3f3'); assert.equal(k['--ink'], '#16191f'); assert.equal(k['--dim'], '#828d9c');
  // the font stack keeps its quotes and commas
  assert.match(k['--font'], /"Segoe UI"/);
  assert.equal(tokenMap(themeById(HTML, 'acorn-dark').css)['--bg'], '#1c1b22');
});

test('token reader: the shell mirror agrees on Cloudscape Light (themes.js comment says it is mirrored)', async () => {
  const mcp = readFileSync(resolve(HERE, '../prism-mcp-server/utils/themes.js'), 'utf8');
  const k = tokenMap(themeById(HTML, 'cloudscape-light').css);
  for (const name of ['--bg', '--panel', '--ink', '--muted', '--dim', '--accent']) assert.ok(mcp.includes(k[name]), `${name} ${k[name]} in themes.js`);
});

test('token reader (negative): an unknown id or a registry entry without its const throws', () => {
  assert.throws(() => themeById(HTML, 'cloudscape-sepia'), /unknown theme "cloudscape-sepia"/);
  const broken = '// ===================== THEME ENGINE\nvar THEME_REGISTRY=[\n'
    + "{id:'x-light', ds:'x', name:'X Light', mode:'light', accent:'#000', builtin:false, css:X_LIGHT_CSS}\n];";
  assert.throws(() => themeById(broken, 'x-light'), /no :root token block/);
});

/* ------------------------------------------------------------ themed sample */

test('themed sample: theme block after the facet CSS, root stamped like the shell', () => {
  const e = { css: '.a{color:var(--ink)}', html: '<b class="a">x</b>' };
  const theme = themeById(HTML, 'duolingo-light');
  const doc = themedDoc(e, { tokensCss: ':root{--bg:#000}', theme });
  assert.match(doc, /<html data-ds="duolingo" data-mode="light" data-theme="duolingo-light" style="color-scheme:light">/);
  assert.ok(doc.indexOf('id="prism-theme-vars"') > doc.indexOf('id="effect-css"'), 'theme wins over facet :root vars, as in the shell');
  assert.ok(doc.includes(theme.css));
  // negative control: no theme, no stamp, no override
  const plain = themedDoc(e, { tokensCss: ':root{--bg:#000}' });
  assert.match(plain, /<html><head>/);
  assert.ok(!plain.includes('prism-theme-vars'));
});

test('probe styles: hide every glyph, then paint each run its own color; neither moves currentColor', () => {
  assert.match(HIDE_CSS, /-webkit-text-fill-color:transparent!important/);
  for (const sel of ['::before', '::placeholder', 'tspan']) assert.ok(HIDE_CSS.includes(sel), sel);
  const runs = assignCodes([
    { key: 3, sel: '', svg: false, rects: [[0, 0, 50, 10]] },
    { key: 3, sel: '::after', svg: false, rects: [[0, 0, 50, 10]] },   // same box as its owner's text
    { key: 7, sel: '', svg: true, rects: [[0, 40, 50, 10]] },          // apart from both
  ]);
  assert.deepEqual(runs.map(r => r.code), [0, 1, 0], 'overlapping runs get different colors, distant ones may share');
  const css = maskCss(runs);
  assert.ok(css.startsWith(HIDE_CSS));
  assert.ok(css.includes('[data-pfx="3"]{-webkit-text-fill-color:rgb(255,0,255)!important}'));
  assert.ok(css.includes('[data-pfx="3"]::after{-webkit-text-fill-color:rgb(0,255,0)!important}'));
  assert.ok(css.includes('[data-pfx="7"]{fill:rgb(255,0,255)!important'));
  assert.doesNotMatch(css, /(^|[;{])color:/);
});

test('probe colors: a pixel is attributed to the color that explains it, at any coverage', () => {
  const bgs = [[255, 255, 255], [0, 0, 0], [13, 17, 29], [242, 243, 243], [9, 114, 211], [128, 128, 128]];
  for (const b of bgs) for (let k = 0; k < CODES.length; k++) for (const a of [0.35, 0.7, 1]) {
    const m = CODES[k].map((c, i) => Math.round(b[i] + a * (c - b[i])));
    if (Math.abs(m[0] - b[0]) + Math.abs(m[1] - b[1]) + Math.abs(m[2] - b[2]) < 60) continue; // below the glyph threshold anyway
    assert.equal(codeAt(...m, ...b), k, `code ${k} at ${a} over ${b}`);
  }
  // negative control: an unrelated change (an icon recolored, a shifted pixel) fits no code
  assert.notEqual(codeAt(40, 40, 40, 0, 0, 0), 0, 'a gray change is not the magenta probe');
  assert.equal(codeAt(255, 255, 255, 255, 255, 255), -1, 'no difference, no code');
});

/* ---------------------------------------------------------------------- PNG */

// Minimal encoder for the tests: one filter type per row, cycling 0..4.
function crc32(buf) { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function encodePng(w, h, rgba, { type = 6, depth = 8 } = {}) {
  const bpp = type === 6 ? 4 : 3, stride = w * bpp, rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < w; x++) for (let c = 0; c < bpp; c++) cur[x * bpp + c] = rgba[(y * w + x) * 4 + c];
    const f = y % 5, out = Buffer.alloc(stride + 1); out[0] = f;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[i + 1] = (cur[i] - pred) & 255;
    }
    rows.push(out); prev = cur;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = depth; ihdr[9] = type;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const noise = (w, h) => { const d = Buffer.alloc(w * h * 4); let s = 7; for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = s >> 16 & 255; } for (let i = 3; i < d.length; i += 4) d[i] = 255; return d; };

test('PNG: RGBA and RGB, all five row filters, round-trip exact', () => {
  const w = 7, h = 10, px = noise(w, h);
  const a = decodePng(encodePng(w, h, px));
  assert.equal(a.width, w); assert.equal(a.height, h); assert.deepEqual([...a.data], [...px]);
  const b = decodePng(encodePng(w, h, px, { type: 2 }));
  assert.deepEqual([...b.data], [...px], 'RGB decodes with alpha 255');
});

test('PNG (negative): not a PNG, an unsupported format and truncated data throw', () => {
  assert.throws(() => decodePng(Buffer.from('GIF89a........')), /not a PNG/);
  assert.throws(() => decodePng(encodePng(2, 2, noise(2, 2), { depth: 16 })), /unsupported PNG/);
  const ok = encodePng(4, 4, noise(4, 4));
  assert.throws(() => decodePng(ok.subarray(0, ok.length - 30)), /truncated|PNG/);
});

/* -------------------------------------------------------------------- floors */

test('contrast floors: 4.5 for body text, 3 for large, glyph-only, placeholder and --dim text', () => {
  const base = { kind: 'text', color: 'rgb(95, 107, 122)', large: false, glyph: false };
  assert.equal(floorFor(base), 4.5);
  assert.equal(floorFor({ ...base, large: true }), 3);
  assert.equal(floorFor({ ...base, glyph: true }), 3);
  assert.equal(floorFor({ ...base, kind: 'placeholder' }), 3);
  assert.equal(floorFor({ ...base, color: 'rgb(137, 149, 164)' }, { dim: '#8995a4' }), 3);
  // negative control: a color one step off --dim is body text
  assert.equal(floorFor({ ...base, color: 'rgb(137, 149, 165)' }, { dim: '#8995a4' }), 4.5);
  // the --dim in effect at the run wins over the theme's (a dark island inside a light theme)
  assert.equal(floorFor({ ...base, color: 'rgb(91, 102, 120)', dim: '#5b6678' }, { dim: '#8995a4' }), 3);
  assert.equal(floorFor({ ...base, color: 'rgb(137, 149, 164)', dim: '#5b6678' }, { dim: '#8995a4' }), 4.5);
});

/* ------------------------------------------------------------------ measure */

// W x H images: bg filled with one color, mask = bg plus a "glyph" block painted #ff00ff.
function img(w, h, fill) { const d = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) { d[i * 4] = fill[0]; d[i * 4 + 1] = fill[1]; d[i * 4 + 2] = fill[2]; d[i * 4 + 3] = 255; } return { width: w, height: h, data: d }; }
function paint(im, x0, y0, x1, y1, c) { const out = { ...im, data: Buffer.from(im.data) }; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * im.width + x) * 4; out.data[o] = c[0]; out.data[o + 1] = c[1]; out.data[o + 2] = c[2]; } return out; }
const MAG = [255, 0, 255];

test('measure: --ink on a hardcoded dark hole is flagged under a light theme (the Obsidian donut)', () => {
  const bg = img(40, 20, [0x0d, 0x11, 0x1d]);
  const mask = paint(bg, 10, 5, 20, 15, MAG);
  const [it] = measureItems([{ kind: 'pseudo', el: 'span.obs-donut::after', text: '42', color: 'rgb(22, 25, 31)', op: 1, rects: [[0, 0, 40, 20]] }], mask, bg);
  assert.equal(it.n, 100);
  assert.equal(it.bg, '#0d111d');
  assert.ok(it.ratio < 1.2, `ratio ${it.ratio}`);
  assert.ok(it.ratio < floorFor({ ...it, large: false, glyph: false }));
});

test('measure (negative control): the same run on the light panel passes', () => {
  const bg = img(40, 20, [255, 255, 255]);
  const mask = paint(bg, 10, 5, 20, 15, MAG);
  const [it] = measureItems([{ kind: 'text', text: '42', color: 'rgb(22, 25, 31)', op: 1, rects: [[0, 0, 40, 20]] }], mask, bg);
  assert.ok(it.ratio > 17, `ratio ${it.ratio}`);
});

test('measure: group opacity and color alpha are composited before the ratio', () => {
  const bg = img(20, 10, [0, 0, 0]), mask = paint(bg, 0, 0, 20, 10, MAG);
  const [full] = measureItems([{ text: 'a', color: 'rgb(255, 255, 255)', op: 1, rects: [[0, 0, 20, 10]] }], mask, bg);
  const [half] = measureItems([{ text: 'a', color: 'rgba(255, 255, 255, 0.5)', op: 0.5, rects: [[0, 0, 20, 10]] }], mask, bg);
  assert.equal(full.ratio, 21);
  // 25% white over black paints #404040: 2.03:1
  assert.equal(half.ratio, 2.03);
});

test('measure: the ratio follows the backdrop under the glyphs, not the box', () => {
  // left half of the box black, right half white; glyphs only on the white half
  let bg = img(40, 10, [0, 0, 0]); bg = paint(bg, 20, 0, 40, 10, [255, 255, 255]);
  const mask = paint(bg, 24, 2, 36, 8, MAG);
  const [it] = measureItems([{ text: 'x', color: 'rgb(255, 255, 255)', op: 1, rects: [[0, 0, 40, 10]] }], mask, bg);
  assert.equal(it.ratio, 1, 'white text over the white half is invisible even though half its box is black');
});

test('measure: glyphs of another run inside this run box are not counted (flip-card back face, clipped layer)', () => {
  const bg = img(40, 20, [255, 255, 255]);
  const mask = paint(bg, 10, 5, 30, 15, CODES[0]);               // only the front face (code 0) painted
  const [front, back] = measureItems([
    { text: 'front', color: 'rgb(22, 25, 31)', op: 1, code: 0, rects: [[0, 0, 40, 20]] },
    { text: 'back', color: 'rgb(255, 255, 255)', op: 1, code: 1, rects: [[0, 0, 40, 20]] },
  ], mask, bg);
  assert.ok(front.ratio > 17);
  assert.equal(back.hidden, true, 'white back-face text is not measured against the front face pixels');
});

test('measure (negative): a run whose glyphs never land (clipped, covered) is hidden, not failed; skipped runs pass through', () => {
  const bg = img(20, 10, [0, 0, 0]);
  const [h] = measureItems([{ text: 'gone', color: 'rgb(0, 0, 0)', op: 1, rects: [[0, 0, 20, 10]] }], bg, bg);
  assert.equal(h.hidden, true); assert.equal(h.ratio, undefined);
  const [s] = measureItems([{ text: 'grad', skip: 'clip-text', color: '', rects: [[0, 0, 20, 10]] }], paint(bg, 0, 0, 20, 10, MAG), bg);
  assert.equal(s.skip, 'clip-text'); assert.equal(s.ratio, undefined);
  // boxes outside the image are clipped, not read out of bounds
  const [o] = measureItems([{ text: 'off', color: 'rgb(255, 255, 255)', op: 1, rects: [[30, 30, 10, 10]] }], paint(bg, 0, 0, 20, 10, MAG), bg);
  assert.equal(o.hidden, true);
});

test('echo layers: of stacked copies of one text, only the front run is judged', () => {
  const box = [[0, 0, 80, 20]];
  const runs = markEchoes([
    { kind: 'text', el: 'span.lay', text: 'DEPTH', color: 'rgba(255, 153, 0, 0.33)', rects: box },
    { kind: 'text', el: 'span.lay', text: 'DEPTH', color: 'rgba(255, 153, 0, 0.6)', rects: box },
    { kind: 'text', el: 'span.front', text: 'DEPTH', color: 'rgb(22, 25, 31)', rects: box },
    { kind: 'pseudo', el: 'span.front::before', text: 'DEPTH', color: 'rgb(51, 221, 255)', rects: box },
  ]);
  assert.deepEqual(runs.map(r => r.skip || ''), ['echo', 'echo', '', 'echo']);
  // negative controls: the same text elsewhere, and different text in the same box, are judged
  const apart = markEchoes([
    { kind: 'text', text: 'OK', color: 'rgb(0, 0, 0)', rects: [[0, 0, 20, 10]] },
    { kind: 'text', text: 'OK', color: 'rgb(0, 0, 0)', rects: [[50, 0, 20, 10]] },
    { kind: 'text', text: 'Cancel', color: 'rgb(0, 0, 0)', rects: [[0, 0, 20, 10]] },
  ]);
  assert.deepEqual(apart.map(r => r.skip || ''), ['', '', '']);
});

/* ------------------------------------------------- in-browser probe (CDP) */
// The collector and the two-screenshot measure on real rendering. Needs Chrome or Edge
// (PRISM_CHROME); skipped when none is installed.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveChrome, closeBrowser } from './_chrome.mjs';
import { openWindowTab, measureText } from './_facet_probe.mjs';

let CHROME = null; try { CHROME = resolveChrome(); } catch {}

test('probe in the browser: flags theme breakage, passes token-true text, ignores what is not painted', { skip: !CHROME && 'no Chrome/Edge' }, async () => {
  const port = 9900 + Math.floor(Math.random() * 90);
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb', '--hide-scrollbars', '--remote-debugging-port=' + port, '--user-data-dir=' + mkdtempSync(tmpdir() + '/pcf-t-'), 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) { try { await (await fetch(`http://localhost:${port}/json/version`)).json(); break; } catch {} await new Promise(r => setTimeout(r, 150)); }
    const tab = await openWindowTab(port, { width: 900, height: 900 });
    const light = themeById(HTML, 'cloudscape-light');
    const dim = tokenMap(light.css)['--dim'];
    const TOK = ':root{--bg:#0b0e17;--panel:#121623;--ink:#eaf1f9;--crit:#c879ff;--line:#243049}';
    const run = async (css, html, theme = light) => {
      await tab.ev(`document.open();document.write(${JSON.stringify(themedDoc({ css, html }, { tokensCss: TOK, theme }))});document.close();`);
      await new Promise(r => setTimeout(r, 60));
      return measureText(tab, { dim });
    };
    const one = (runs, text) => runs.find(r => r.text === text);

    // negative control: a hardcoded dark hole under --ink generated content (the Obsidian donut)
    const hole = '.d{width:66px;height:66px;border-radius:50%;background:conic-gradient(red 0 40%,blue 0);position:relative}'
      + '.d::after{content:"42";position:absolute;inset:10px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--ink);font-weight:800;background:HOLE}';
    const bad = one(await run(hole.replace('HOLE', '#0d111d'), '<span class="d"></span>'), '42');
    assert.ok(bad && bad.ratio < 1.3, `donut on #0d111d: ${bad && bad.ratio}`);
    assert.equal(bad.bg, '#0d111d'); assert.equal(bad.kind, 'pseudo');
    // the fix: the hole follows the theme
    const good = one(await run(hole.replace('HOLE', 'var(--panel)'), '<span class="d"></span>'), '42');
    assert.ok(good && good.ratio >= 4.5, `donut on --panel: ${good && good.ratio}`);
    // and the hardcoded hole was fine in dark, so it is the theme that breaks it
    const dark = one(await run(hole.replace('HOLE', '#0d111d'), '<span class="d"></span>', null), '42');
    assert.ok(dark && dark.ratio > 10, `donut in dark: ${dark && dark.ratio}`);

    // color-mix() computes to color(srgb ...): it is measured like any other color (negative
    // control for the probe once skipping it), white-ish on the light panel is flagged
    const mixed = one(await run('.m{color:color-mix(in srgb,#fff 90%,var(--ink))}', '<b class="m">Mixed</b>'), 'Mixed');
    assert.ok(mixed && mixed.ratio < 1.5, `color-mix text: ${mixed && mixed.ratio}`);
    const svgMix = one(await run('', '<svg width="120" height="30"><text x="4" y="20" font-size="14" style="fill:color-mix(in srgb,#fff 90%,#000)">Mixed fill</text></svg>'), 'Mixed fill');
    assert.ok(svgMix && svgMix.ratio < 1.5, `color-mix svg fill: ${svgMix && svgMix.ratio}`);

    // group opacity: crit at .7 reads 3.1:1 on the light panel
    const ref = one(await run('.r{color:var(--crit);opacity:.7;font-size:10.5px}', '<div class="r">AL-12</div>'), 'AL-12');
    assert.ok(ref && ref.ratio < 4.5 && ref.floor === 4.5, `ref ${ref && ref.ratio}`);

    // SVG text over a dark shape that is a sibling, not an ancestor
    const svg = one(await run('', '<svg width="200" height="60"><rect width="200" height="60" fill="#0d111d"/><text x="20" y="38" font-size="16" fill="var(--ink)">Label</text></svg>'), 'Label');
    assert.ok(svg && svg.ratio < 1.3, `svg label: ${svg && svg.ratio}`);

    // a finite fade-in is measured at its end state, not mid-fade
    const fade = one(await run('@keyframes f{from{opacity:0}to{opacity:1}}.f{animation:f 5s forwards;opacity:0;color:var(--ink)}', '<b class="f">Ready</b>'), 'Ready');
    assert.ok(fade && fade.ratio > 15, `fade-in end state: ${fade && fade.ratio}`);

    // not painted, not judged: clipped, gradient-filled, aria-disabled
    const quiet = await run('.g{background:linear-gradient(90deg,#fff,#eee);-webkit-background-clip:text;background-clip:text;color:transparent}',
      '<div><div style="height:0;overflow:hidden;color:#fff">clipped</div><b class="g">Gradient</b><button aria-disabled="true" style="color:#eee;background:#fff">Off</button></div>');
    assert.deepEqual(quiet.map(r => r.text), []);

    // not judged either: a color emoji (paints its own colors), 3px text (a scaled-down diagram)
    const glyphs = await run('', '<div><span style="color:#fff">🎉</span><svg width="40" height="20" viewBox="0 0 400 200"><text x="10" y="100" font-size="30" fill="#fff">tiny</text></svg></div>');
    assert.deepEqual(glyphs.map(r => r.text), []);
    // ...but a text-style symbol is (negative control): white ★ on the light panel
    const star = one(await run('', '<b style="color:#fff;font-size:20px">★</b>'), '★');
    assert.ok(star && star.ratio < 1.1 && star.floor === 3, `star ${star && star.ratio}`);

    // glitch echoes: the ::before/::after copies are not judged, the front text is
    const echo = await run('.e{position:relative;color:var(--ink)}.e::before,.e::after{content:attr(data-t);position:absolute;left:1px;top:0}.e::before{color:#33ddff}.e::after{color:#ff33aa}',
      '<b class="e" data-t="GLITCH">GLITCH</b>');
    assert.deepEqual(echo.map(r => r.el), ['b.e']);

    // outlined text reads by its stroke: a white outline on the light panel is invisible
    const outline = one(await run('.o{color:rgba(255,255,255,.16);-webkit-text-stroke:.6px rgba(255,255,255,.55);font-size:40px;font-weight:800}', '<b class="o">GLASS</b>'), 'GLASS');
    assert.ok(outline && outline.ratio < 1.5, `white outline ${outline && outline.ratio}`);
    tab.close();
  } finally {
    await closeBrowser(port, proc);
  }
});
