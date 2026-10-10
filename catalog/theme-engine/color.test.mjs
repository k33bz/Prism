// color.mjs: parsing, OKLab/OKLCH against reference values, round trips,
// gamut mapping, WCAG 2.x contrast and APCA.  Run: node --test catalog/theme-engine/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './color.mjs';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b} (eps ${eps})`);

// A deterministic spread of sRGB colors: the 6x6x6 web-safe cube plus a
// linear-congruential sample of 2,000 more.
function sample() {
  const out = [];
  const steps = [0, 51, 102, 153, 204, 255];
  for (const r of steps) for (const g of steps) for (const b of steps) out.push({ r, g, b });
  let s = 12345;
  const next = () => (s = (s * 1103515245 + 12345) % 2147483648) % 256;
  for (let i = 0; i < 2000; i++) out.push({ r: next(), g: next(), b: next() });
  return out;
}

test('parseColor reads hex, rgb()/rgba() and the -rgb triplet', () => {
  assert.deepEqual(C.parseColor('#abc'), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(C.parseColor('#0078D4'), { r: 0, g: 120, b: 212, a: 1 });
  assert.equal(C.parseColor('#00000080').a, 128 / 255);
  assert.deepEqual(C.parseColor('rgb(9, 114, 211)'), { r: 9, g: 114, b: 211, a: 1 });
  assert.deepEqual(C.parseColor('rgba(255,255,255,.06)'), { r: 255, g: 255, b: 255, a: 0.06 });
  assert.deepEqual(C.parseColor('rgb(0 0 0 / 50%)'), { r: 0, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(C.parseColor('83,159,229'), { r: 83, g: 159, b: 229, a: 1 });
  for (const bad of ['', 'blue', '#12', '#12345', 'rgb(1,2)', 'linear-gradient(red,blue)', null]) assert.equal(C.parseColor(bad), null, String(bad));
  assert.throws(() => C.parseHex('rgb(1,2,3)'), /not a #rgb/);
});

test('formatting: hex, triplet and compact rgba', () => {
  assert.equal(C.toHex({ r: 0, g: 120.4, b: 212.6 }), '#0078d5');
  assert.equal(C.toHex({ r: -3, g: 300, b: 15 }), '#00ff0f');
  assert.equal(C.toRgbTriplet({ r: 9, g: 114, b: 211 }), '9,114,211');
  assert.equal(C.toRgba({ r: 9, g: 114, b: 211 }, 0.08), 'rgba(9,114,211,.08)');
  assert.equal(C.toRgba({ r: 9, g: 114, b: 211 }, 0), 'rgba(9,114,211,0)');
  assert.equal(C.normalizeHex('#FFF'), '#ffffff');
});

test('OKLab and OKLCH match the CSS Color 4 reference values', () => {
  const ref = [
    ['#ffffff', 1, 0, 0], ['#000000', 0, 0, 0],
    ['#ff0000', 0.62796, 0.22486, 0.12585],
    ['#00ff00', 0.86644, -0.23389, 0.17950],
    ['#0000ff', 0.45201, -0.03246, -0.31153],
  ];
  for (const [hex, L, a, b] of ref) {
    const lab = C.rgbToOklab(C.parseHex(hex));
    near(lab.L, L, 1e-4, `${hex} L`); near(lab.a, a, 1e-4, `${hex} a`); near(lab.b, b, 1e-4, `${hex} b`);
  }
  const red = C.toOklch('#ff0000');
  near(red.C, 0.25768, 1e-4, 'red C'); near(red.h, 29.2339, 1e-3, 'red h');
  const blue = C.toOklch('#0000ff');
  near(blue.h, 264.052, 1e-3, 'blue h');
  assert.equal(C.toOklch('#808080').h, 0, 'achromatic hue is 0');
});

test('round trips sRGB -> OKLab -> sRGB and via OKLCH stay within 1/255 per channel', () => {
  let worst = 0;
  for (const c of sample()) {
    const back = C.oklabToRgb(C.rgbToOklab(c));
    const back2 = C.oklchToRgb(C.rgbToOklch(c));
    for (const k of ['r', 'g', 'b']) worst = Math.max(worst, Math.abs(back[k] - c[k]), Math.abs(back2[k] - c[k]));
    assert.equal(C.toHex(back2), C.toHex(c));
  }
  assert.ok(worst <= 1, `worst channel error ${worst}`);
  assert.ok(worst < 0.01, `float round trip error is far below one step (${worst})`);
});

test('gamut mapping reduces chroma at fixed L and h', () => {
  const lch = { L: 0.7, C: 0.4, h: 145 };
  assert.equal(C.inGamut(lch), false);
  const m = C.gamutMap(lch);
  assert.equal(m.L, 0.7); assert.equal(m.h, 145);
  assert.ok(m.C < 0.4 && m.C > 0.1, `C ${m.C}`);
  assert.ok(C.inGamut(m));
  assert.equal(C.inGamut({ ...m, C: m.C + 0.002 }), false, 'mapped to the gamut edge');
  // the rendered hex keeps L and h (8-bit rounding aside)
  const back = C.toOklch(C.oklchToHex(lch));
  near(back.L, 0.7, 0.004, 'L'); near(back.h, 145, 1, 'h');
  // in-gamut colors are untouched; L outside 0..1 clamps to black/white
  const inside = { L: 0.6, C: 0.05, h: 250 };
  assert.deepEqual(C.gamutMap(inside), inside);
  assert.equal(C.oklchToHex({ L: 1.2, C: 0.3, h: 30 }), '#ffffff');
  assert.equal(C.oklchToHex({ L: -0.1, C: 0.3, h: 30 }), '#000000');
  // every hue at several lightnesses maps into gamut
  for (let h = 0; h < 360; h += 15) for (const L of [0.2, 0.5, 0.8, 0.95]) assert.ok(C.inGamut(C.gamutMap({ L, C: 0.37, h })), `L ${L} h ${h}`);
});

test('WCAG 2.x relative luminance and contrast ratio', () => {
  assert.equal(C.relativeLuminance('#ffffff'), 1);
  assert.equal(C.relativeLuminance('#000000'), 0);
  near(C.relativeLuminance('#ff0000'), 0.2126, 1e-9);
  near(C.contrastRatio('#000000', '#ffffff'), 21, 1e-9);
  assert.equal(C.contrastRatio('#ffffff', '#000000'), C.contrastRatio('#000000', '#ffffff'), 'symmetric');
  assert.equal(C.contrastRatio('#539fe5', '#539fe5'), 1);
  near(C.contrastRatio('#777777', '#ffffff'), 4.48, 0.005);
  near(C.contrastRatio('#767676', '#ffffff'), 4.54, 0.005);
});

test('APCA Lc matches the APCA-W3 0.0.98G reference values', () => {
  near(C.apcaContrast('#000000', '#ffffff'), 106.04, 0.01, 'black on white');
  near(C.apcaContrast('#ffffff', '#000000'), -107.88, 0.01, 'white on black');
  near(C.apcaContrast('#888888', '#ffffff'), 63.06, 0.01, '#888 on white');
  near(C.apcaContrast('#ffffff', '#888888'), -68.54, 0.01, 'white on #888');
  assert.equal(C.apcaContrast('#777777', '#777777'), 0);
});

test('composite and deltaE', () => {
  assert.equal(C.toHex(C.composite(C.parseColor('rgba(255,255,255,.5)'), { r: 0, g: 0, b: 0 })), '#808080');
  assert.equal(C.deltaEOK('#123456', '#123456'), 0);
  near(C.deltaEOK('#000000', '#ffffff'), 1, 1e-6);
});
