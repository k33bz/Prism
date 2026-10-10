/* Prism theme engine: evaluate deriveTheme against the hand-tuned packs.
   ----------------------------------------------------------------------------
   For every catalog/profiles/*.mjs with a palette, derive a theme from the
   profile's accent alone and compare, per mode:
     - contrast: the same pair list (derive.mjs PAIRS) on the hand-tuned
       palette (layered over the Cloudscape base, as the scaffolder does) and on
       the derived one; failing pairs and the lowest text/UI/tertiary ratios;
     - distance: delta E in OKLab (x100) per color token.
   Read-only: imports the profiles and themes.js, writes nothing.

   Usage: node catalog/theme-engine/evaluate.mjs [--tokens] [--fails] [--json] [--contrast AAA] */
import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as C from './color.mjs';
import { deriveTheme, checkContrast } from './derive.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILES = resolve(HERE, '..', 'profiles');
const { packTokens } = await import(pathToFileURL(resolve(HERE, '..', '..', 'prism-mcp-server', 'utils', 'themes.js')).href);

export const COLOR_TOKENS = ['--bg', '--panel', '--panel2', '--card', '--line', '--ink', '--muted', '--dim', '--accent', '--accent2', '--info', '--pos', '--warn', '--neg', '--crit'];

/** Opaque hex for a token (translucent values composited over the mode's bg). */
function solid(tokens, k, mode) {
  const back = mode === 'dark' ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  const bg = C.composite(C.parseColor(tokens['--bg']), back);
  const p = C.parseColor(tokens[k]);
  return p ? C.toHex(k === '--bg' ? bg : C.composite(p, bg)) : null;
}

const minKind = (pairs, kind) => {
  const r = pairs.filter((p) => p.kind === kind && p.floor != null).map((p) => p.ratio);
  return r.length ? Math.min(...r) : null;
};

export async function evaluate({ contrast = 'AA' } = {}) {
  const files = readdirSync(PROFILES).filter((f) => f.endsWith('.mjs') && !f.startsWith('sample-')).sort();
  const rows = [];
  for (const f of files) {
    const p = (await import(pathToFileURL(resolve(PROFILES, f)).href)).default;
    if (!p || !p.palette || !p.accent) continue;
    const d = deriveTheme({ name: p.ds, accent: p.accent, contrast });
    for (const mode of ['dark', 'light']) {
      if (!p.palette[mode]) continue;
      const hand = packTokens(mode, p.palette[mode]);
      const der = d[mode];
      const hc = checkContrast(hand, { mode, contrast });
      const dc = checkContrast(der, { mode, contrast });
      const dE = {};
      for (const k of COLOR_TOKENS) {
        const a = solid(hand, k, mode), b = solid(der, k, mode);
        dE[k] = a && b ? C.round(C.deltaEOK(a, b) * 100, 1) : null;
      }
      const vals = Object.values(dE).filter((x) => x != null);
      const worst = Object.entries(dE).sort((x, y) => y[1] - x[1])[0];
      rows.push({
        pack: p.dsShort, mode, accent: p.accent,
        handAccent: hand['--accent'], derivedAccent: der['--accent'],
        hand: { failing: hc.failures.length, minText: minKind(hc.pairs, 'text'), minUi: minKind(hc.pairs, 'ui'), minTertiary: minKind(hc.pairs, 'tertiary'), whiteOnAccent: C.round(C.contrastRatio('#ffffff', solid(hand, '--accent', mode)), 2), failures: hc.failures.map((x) => `${x.fg} on ${x.bg} ${x.ratio}`) },
        derived: { failing: dc.failures.length, minText: minKind(dc.pairs, 'text'), minUi: minKind(dc.pairs, 'ui'), minTertiary: minKind(dc.pairs, 'tertiary'), whiteOnAccent: C.round(C.contrastRatio('#ffffff', der['--accent']), 2), inkOnAccent: C.round(C.contrastRatio(der['--accent-ink'], der['--accent']), 2), failures: dc.failures.map((x) => `${x.fg} on ${x.bg} ${x.ratio}`) },
        dE, meanDE: C.round(vals.reduce((s, x) => s + x, 0) / vals.length, 1), maxDE: { token: worst[0], dE: worst[1] },
        moved: d.report.moved.filter((m) => m.mode === mode).map((m) => m.message),
      });
    }
  }
  return rows;
}

function table(rows) {
  const L = [];
  L.push('pack           mode   hand fails  derived fails  min text h/d   min UI h/d    min dim h/d   #fff on accent h/d  meanDE  maxDE (token)');
  for (const r of rows) {
    L.push(`${r.pack.padEnd(14)} ${r.mode.padEnd(6)} ${String(r.hand.failing).padStart(10)}  ${String(r.derived.failing).padStart(13)}  ${(r.hand.minText + ' / ' + r.derived.minText).padEnd(13)} ${(r.hand.minUi + ' / ' + r.derived.minUi).padEnd(13)} ${(r.hand.minTertiary + ' / ' + r.derived.minTertiary).padEnd(13)} ${(r.hand.whiteOnAccent + ' / ' + r.derived.whiteOnAccent).padEnd(19)} ${String(r.meanDE).padStart(6)}  ${r.maxDE.dE} (${r.maxDE.token})`);
  }
  const hf = rows.reduce((s, r) => s + r.hand.failing, 0), df = rows.reduce((s, r) => s + r.derived.failing, 0);
  const inkF = rows.reduce((s, r) => s + r.hand.failures.filter((x) => x.startsWith('--accent-ink')).length, 0);
  L.push('', `Hand-tuned packs set no --accent-ink, so their ink on accent fills is #fff (what the generated facets use): ${inkF} of their failures are that pair. Derived themes solve --accent-ink; the #fff column shows what hardcoded #fff gets on each accent.`);
  const worse = rows.filter((r) => r.derived.minText < r.hand.minText);
  L.push('', `${rows.length} pack modes: hand-tuned ${hf} failing pairs, derived ${df}. Derived lowest text ratio below the hand-tuned one in ${worse.length} modes${worse.length ? ' (' + worse.map((r) => r.pack + '/' + r.mode).join(', ') + ')' : ''}.`);
  return L.join('\n');
}

function tokens(rows) {
  const L = ['pack           mode   ' + COLOR_TOKENS.map((k) => k.slice(2).padStart(7)).join('')];
  for (const r of rows) L.push(`${r.pack.padEnd(14)} ${r.mode.padEnd(6)} ` + COLOR_TOKENS.map((k) => String(r.dE[k] ?? '-').padStart(7)).join(''));
  return L.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--contrast');
  const rows = await evaluate({ contrast: ci >= 0 ? args[ci + 1] : 'AA' });
  if (args.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  else {
    console.log(table(rows));
    if (args.includes('--tokens')) console.log('\nDelta E OK x100 per token (hand-tuned vs derived):\n' + tokens(rows));
    if (args.includes('--fails')) {
      console.log('\nHand-tuned failing pairs:');
      for (const r of rows) if (r.hand.failures.length) console.log(`  ${r.pack}/${r.mode}: ${r.hand.failures.join('; ')}`);
      console.log('\nDerived moves:');
      for (const r of rows) for (const m of r.moved) console.log(`  ${r.pack}/${r.mode}: ${m}`);
    }
  }
}
