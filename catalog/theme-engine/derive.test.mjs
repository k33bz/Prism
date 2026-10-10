// derive.mjs: complete token maps, contrast floors for diverse accents (every
// pair recomputed here from the hex values, not read from the report),
// determinism, input moves and validation, and checkContrast on packs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './color.mjs';
import { deriveTheme, checkContrast, inferMode, normalizeInput, rootCss, formatReport, TOKENS, PAIRS, FLOORS, STATUS_HUES } from './derive.mjs';
import { BASE_TOKENS, TOKEN_META, THEMES } from '../../prism-mcp-server/utils/themes.js';

// 12 diverse accents: yellow, cyan, pure red, near-black, near-white, magenta,
// three brand blues and three brand greens.
const ACCENTS = {
  yellow: '#ffd400', cyan: '#00e5ff', red: '#ff0000', nearBlack: '#0a0a0a', nearWhite: '#f7f7f7', magenta: '#ff00ff',
  azure: '#0078d4', googleBlue: '#1a73e8', githubBlue: '#0969da',
  duolingoGreen: '#58cc02', shopifyGreen: '#008060', spotifyGreen: '#1db954',
};
const HEX = /^#[0-9a-f]{6}$/;

/** Recompute every pair of a derived mode from the hex values (independent of the report). */
function verifyFloors(map, mode, contrast, tag) {
  const floors = FLOORS[contrast];
  let gated = 0;
  for (const [fg, bg, kind] of PAIRS) {
    const floor = floors[kind];
    assert.ok(HEX.test(map[fg]) && HEX.test(map[bg]), `${tag} ${fg}/${bg} are opaque hex`);
    if (floor == null) continue;
    const r = C.contrastRatio(map[fg], map[bg]);
    assert.ok(r >= floor, `${tag} ${mode}: ${fg} ${map[fg]} on ${bg} ${map[bg]} = ${r.toFixed(3)} < ${floor}`);
    gated++;
  }
  return gated;
}

test('derived maps cover every TOKEN_META and BASE_TOKENS token in both modes', () => {
  const d = deriveTheme({ accent: '#0078d4' });
  for (const mode of ['dark', 'light']) {
    const map = d[mode];
    assert.deepEqual(Object.keys(map), TOKENS, `${mode} key order is TOKENS`);
    for (const { k } of TOKEN_META) assert.ok(map[k], `${mode} has ${k}`);
    for (const k of Object.keys(BASE_TOKENS)) assert.ok(typeof map[k] === 'string' && map[k].length, `${mode} has ${k}`);
    for (const k of ['--bg', '--panel', '--panel2', '--card', '--line', '--ink', '--muted', '--dim', '--accent', '--accent2', '--accent-ink', '--info', '--pos', '--warn', '--neg', '--crit']) assert.match(map[k], HEX, `${mode} ${k}`);
  }
});

test('-rgb triplets match their hex and the gradient follows the BASE_TOKENS shape', () => {
  const shape = /^linear-gradient\(157deg,rgba\(\d+,\d+,\d+,\.\d+\),rgba\(\d+,\d+,\d+,0\) 55%\)$/;
  assert.match(BASE_TOKENS['--cardgrad'].replace(/rgba\(255,255,255,\.05\)/, 'rgba(1,1,1,.05)'), shape, 'the shape test matches the base itself');
  for (const accent of Object.values(ACCENTS)) {
    const d = deriveTheme({ accent });
    for (const mode of ['dark', 'light']) {
      const m = d[mode];
      for (const k of ['--accent', '--info', '--pos', '--warn', '--neg', '--crit']) {
        const { r, g, b } = C.parseHex(m[k]);
        assert.equal(m[k + '-rgb'], `${r},${g},${b}`, `${accent} ${mode} ${k}-rgb`);
      }
      assert.match(m['--cardgrad'], shape);
      assert.ok(m['--cardgrad'].includes(`rgba(${m['--accent-rgb']},`), 'gradient uses the accent');
      assert.ok(m['--cs-topnav-hover'].startsWith(`rgba(${m['--accent-rgb']},`));
    }
  }
});

test('every gated pair meets its floor for 12 diverse accents (AA and AAA, all neutrals)', () => {
  let total = 0;
  for (const [name, accent] of Object.entries(ACCENTS)) {
    for (const contrast of ['AA', 'AAA']) {
      for (const neutral of ['brand', 'cool', 'warm', 'neutral', '#8a6f4e']) {
        const d = deriveTheme({ name, accent, contrast, neutral });
        for (const mode of ['dark', 'light']) total += verifyFloors(d[mode], mode, contrast, `${name} ${accent} ${contrast} ${neutral}`);
        assert.equal(d.report.summary.failing, 0, `${name} ${contrast} ${neutral} report agrees`);
        assert.equal(d.report.failures.length, 0);
      }
    }
  }
  const perMode = PAIRS.filter(([, , kind]) => FLOORS.AA[kind] != null).length;
  assert.equal(total, 12 * 2 * 5 * 2 * perMode, 'every gated pair of every run was checked');
});

test('the report lists every pair with its ratio and floor, matching an independent check', () => {
  const d = deriveTheme({ accent: '#ffd400', contrast: 'AA' });
  assert.equal(d.report.pairs.length, PAIRS.length * 2);
  for (const p of d.report.pairs) {
    const map = d[p.mode];
    const want = p.fg === '--accent-ink' ? C.contrastRatio(map['--accent-ink'], map['--accent']) : C.contrastRatio(map[p.fg], map[p.bg]);
    assert.equal(p.ratio, C.round(want, 2), `${p.mode} ${p.fg} on ${p.bg}`);
    assert.equal(p.floor, FLOORS.AA[p.kind]);
    assert.equal(typeof p.apca, 'number');
  }
  assert.equal(d.report.summary.ok, true);
});

test('the accent keeps its hue; lightness moves only when a floor fails, and the move is reported', () => {
  for (const [name, accent] of Object.entries(ACCENTS)) {
    const a0 = C.toOklch(accent);
    const d = deriveTheme({ accent });
    for (const mode of ['dark', 'light']) {
      const a1 = C.toOklch(d[mode]['--accent']);
      if (a0.C > 0.04 && a1.C > 0.04) {
        const dh = Math.abs(((a1.h - a0.h + 540) % 360) - 180);
        assert.ok(dh <= 4, `${name} ${mode} hue ${a0.h.toFixed(1)} -> ${a1.h.toFixed(1)}`);
      }
      const moved = d.report.moved.find((m) => m.mode === mode && m.token === '--accent');
      assert.equal(!!moved, d[mode]['--accent'] !== accent, `${name} ${mode} reported iff moved`);
    }
  }
  // GitHub's light blue already passes in light mode: kept exactly
  const gh = deriveTheme({ accent: '#0969da' });
  assert.equal(gh.light['--accent'], '#0969da');
  assert.ok(!gh.report.moved.some((m) => m.mode === 'light'));
  // yellow is darkened for light mode, with a readable message
  const y = deriveTheme({ accent: '#ffd400' });
  const mv = y.report.moved.find((m) => m.mode === 'light');
  assert.match(mv.message, /^accent #ffd400 too light for text on a light panel: darkened to #[0-9a-f]{6}, L 0\.\d\d to 0\.\d\d$/);
  assert.equal(mv.output, y.light['--accent']);
  assert.ok(mv.L[1] < mv.L[0]);
  assert.equal(y.dark['--accent'], '#ffd400', 'yellow already reads on a dark panel');
  assert.notEqual(y.dark['--accent-ink'], '#ffffff', 'a dark ink on the yellow fill');
  assert.ok(y.report.notes.some((n) => /hardcode #fff/.test(n)));
  // a deep blue is lightened for dark mode
  const az = deriveTheme({ accent: '#0078d4' });
  assert.match(az.report.moved.find((m) => m.mode === 'dark').message, /too dark for text on a dark panel: lightened to/);
});

test('status colors take the conventional hues at one shared lightness per mode', () => {
  const d = deriveTheme({ accent: '#7c3aed' });
  for (const mode of ['dark', 'light']) {
    const Ls = [];
    for (const [k, h] of Object.entries(STATUS_HUES)) {
      const c = C.toOklch(d[mode][k]);
      const dh = Math.abs(((c.h - h + 540) % 360) - 180);
      assert.ok(dh <= 6, `${mode} ${k} hue ${c.h.toFixed(1)} vs ${h}`);
      assert.ok(c.C >= 0.08, `${mode} ${k} keeps chroma (${c.C.toFixed(3)})`);
      if (k !== '--warn' && k !== '--pos') Ls.push(c.L);
    }
    assert.ok(Math.max(...Ls) - Math.min(...Ls) < 0.02, `${mode} info/neg/crit share a lightness: ${Ls.map((x) => x.toFixed(3))}`);
  }
});

test('neutral ramps keep the brand hue at low chroma; presets and hex steer the hue', () => {
  const brand = deriveTheme({ accent: '#0078d4' });
  const ah = C.toOklch('#0078d4').h;
  for (const mode of ['dark', 'light']) {
    for (const k of ['--bg', '--panel2', '--line', '--muted']) {
      const c = C.toOklch(brand[mode][k]);
      assert.ok(c.C < 0.04, `${mode} ${k} chroma ${c.C}`);
      if (c.C > 0.008) assert.ok(Math.abs(((c.h - ah + 540) % 360) - 180) < 12, `${mode} ${k} hue ${c.h} near brand ${ah}`);
    }
  }
  const warm = deriveTheme({ accent: '#0078d4', neutral: 'warm' });
  const wh = C.toOklch(warm.dark['--bg']).h;
  assert.ok(Math.abs(wh - 70) < 12, `warm bg hue ${wh}`);
  const grey = deriveTheme({ accent: '#0a0a0a' });
  assert.ok(C.toOklch(grey.dark['--panel']).C < 0.003, 'an achromatic brand gives grey surfaces');
  const hexN = deriveTheme({ accent: '#0078d4', neutral: '#2e8b57' });
  assert.ok(Math.abs(C.toOklch(hexN.dark['--bg']).h - C.toOklch('#2e8b57').h) < 12);
  const loud = deriveTheme({ accent: '#0078d4', neutral: '#ff0000' });
  assert.ok(loud.report.notes.some((n) => /tint capped/.test(n)));
  assert.ok(C.toOklch(loud.dark['--panel']).C < 0.05);
});

test('deterministic: the same input always gives the same output', () => {
  for (const accent of Object.values(ACCENTS)) {
    const a = JSON.stringify(deriveTheme({ accent, name: 'X', neutral: 'cool', contrast: 'AAA', radius: 6 }));
    const b = JSON.stringify(deriveTheme({ radius: '6px', contrast: 'aaa', neutral: 'cool', name: 'X', accent: accent.toUpperCase() }));
    assert.equal(a, b, accent);
  }
});

test('mode, radius, density and font flow through', () => {
  const d = deriveTheme({ accent: '#008060', mode: 'dark', radius: 12, density: 'compact', font: 'Inter, system-ui, sans-serif' });
  assert.equal(d.light, null);
  assert.ok(d.report.pairs.every((p) => p.mode === 'dark'));
  assert.deepEqual([d.dark['--r-sm'], d.dark['--r-md'], d.dark['--r-lg'], d.dark['--r-xl']], ['6px', '12px', '18px', '24px']);
  assert.equal(d.dark['--dens'], '.95');
  assert.equal(d.dark['--font'], 'Inter, system-ui, sans-serif');
  const l = deriveTheme({ accent: '#008060', mode: 'light', density: 1.1, radius: '2px' });
  assert.equal(l.dark, null);
  assert.equal(l.light['--dens'], '1.1');
  assert.equal(l.light['--r-sm'], '2px');
  const defaults = deriveTheme({ accent: '#008060' });
  assert.equal(defaults.dark['--font'], BASE_TOKENS['--font']);
  assert.deepEqual([defaults.dark['--r-sm'], defaults.dark['--r-xl']], [BASE_TOKENS['--r-sm'], BASE_TOKENS['--r-xl']]);
});

test('invalid input is rejected with a clear message', () => {
  assert.throws(() => deriveTheme(), /accent/);
  assert.throws(() => deriveTheme({}), /accent must be a #rgb or #rrggbb/);
  assert.throws(() => deriveTheme({ accent: 'blue' }), /accent must be/);
  assert.throws(() => deriveTheme({ accent: '#0078d4', secondary: 'nope' }), /secondary must be/);
  assert.throws(() => deriveTheme({ accent: '#0078d4', neutral: 'teal' }), /neutral must be/);
  assert.throws(() => deriveTheme({ accent: '#0078d4', mode: 'dim' }), /mode must be/);
  assert.throws(() => deriveTheme({ accent: '#0078d4', contrast: 'A' }), /contrast must be/);
  assert.throws(() => deriveTheme({ accent: '#0078d4', radius: -1 }), /radius/);
  assert.throws(() => deriveTheme({ accent: '#0078d4', density: 'huge' }), /density/);
  assert.throws(() => deriveTheme({ accent: '#0078d4', font: 'x;}body{color:red' }), /font must be/);
  assert.throws(() => deriveTheme({ accent: '#0078d4', name: '<b>' }), /name must be/);
  assert.equal(normalizeInput({ accent: '#ABC' }).accent, '#aabbcc');
});

test('secondary becomes --accent2, moved to clear the UI floor when needed', () => {
  const d = deriveTheme({ accent: '#0078d4', secondary: '#ffe600' });
  assert.equal(d.dark['--accent2'], '#ffe600');
  assert.notEqual(d.light['--accent2'], '#ffe600');
  assert.ok(d.report.moved.some((m) => m.mode === 'light' && m.token === '--accent2' && /secondary #ffe600/.test(m.message)));
  assert.ok(C.contrastRatio(d.light['--accent2'], d.light['--bg']) >= 3);
});

test('checkContrast: partial maps, translucent surfaces, mode inference', () => {
  assert.equal(inferMode({ '--bg': '#0f1621' }), 'dark');
  assert.equal(inferMode({ '--bg': '#f2f3f3' }), 'light');
  const part = checkContrast({ '--ink': '#777777', '--panel': '#ffffff' }, { mode: 'light' });
  const ink = part.pairs.find((p) => p.fg === '--ink' && p.bg === '--panel');
  assert.equal(ink.ratio, 4.48);
  assert.equal(ink.pass, false);
  assert.equal(part.pass, false);
  assert.ok(part.skipped.length > 0);
  const glass = THEMES.find((t) => t.id === 'glass-dark');
  const g = checkContrast(glass.tokens);
  assert.equal(g.mode, 'dark');
  const panel = g.pairs.find((p) => p.fg === '--ink' && p.bg === '--panel');
  assert.match(panel.bgValue, HEX, 'rgba panel composited over bg');
  const fill = checkContrast({ '--accent': '#ffd400', '--bg': '#000000' }).pairs.find((p) => p.fg === '--accent-ink');
  assert.equal(fill.fgValue, '#ffffff (facet default)');
  assert.throws(() => checkContrast(null), /tokens must be an object/);
  assert.throws(() => checkContrast({}, { contrast: 'B' }), /contrast/);
});

test('rootCss and formatReport render', () => {
  const d = deriveTheme({ accent: '#539fe5', name: 'Demo' });
  const css = rootCss(d.dark, 'Demo dark');
  assert.match(css, /^:root\{ \/\* Demo dark \*\/\n  --bg: #[0-9a-f]{6};\n/);
  assert.equal(css.split('\n').length, TOKENS.length + 2);
  const txt = formatReport(d);
  assert.match(txt, /Theme "Demo"/);
  assert.match(txt, /\d+ gated pairs, 0 failing/);
});
