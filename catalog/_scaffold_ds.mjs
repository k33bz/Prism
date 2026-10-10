/* ============================================================================
   F6 (JFH-39) — Theme-pack authoring kit / scaffolder.
   ----------------------------------------------------------------------------
   Turn a design-system PROFILE into all the theme wiring, so a new Phase-2
   system is fill-in-the-blanks. One command:

     node catalog/_scaffold_ds.mjs catalog/profiles/<name>.mjs

   patches, idempotently:

     1. Prism.html THEME_REGISTRY  — adds <dsShort>-dark + <dsShort>-light entries
        (plus their :root token CSS consts). This is the single source of truth the
        shell + Variant-Matrix picker read, so the pack becomes SELECTABLE in both
        color modes with no further edits.
     2. prism-mcp-server/utils/themes.js THEMES[] — adds the mirror entries via
        packTokens(mode, overrides), so the MCP knows the pack's palette.
     3. catalog/systems.json themePack[] — registers the family so the F5 gate
        (_check_ds.mjs) will hold its facets to the 100-facet standard once authored.
        Skipped for a skin (profile.skin === true): a skin has no facet family.
     4. catalog/profiles/<dsShort>.mjs — writes a facet-gen config stub (F4) if the
        profile does not already live there, so `node catalog/_gen_system.mjs` can
        author the 100 facets next.

   REGENERATION. The profile is the source of truth for 1 and 2. Re-running the
   scaffolder on a pack that is already wired REWRITES its two CSS consts, its two
   THEME_REGISTRY entries and its two THEMES[] lines in place from the profile, so
   a palette fix in the profile reaches both copies with one command. A second run
   with the same profile changes nothing (no file is written when the regenerated
   text is identical). catalog/_check_themes.mjs reports any drift between the
   three copies.

   What it does NOT need to patch (all self-maintaining off the registry now):
     - the MCP tool metadata (builtInThemes / note / palette descriptions) derives
       from THEME_IDS + themesSummary();
     - the variants.test.js theme-count assertions derive from THEME_IDS.
   So "MCP tests updated / theme count reflects the new system" happens for free.

   The scaffolded theme ships with ZERO spectrum facets (an "empty" pack): it is
   selectable and correctly colored immediately; facets are authored afterward via
   the F4 generator. The run prints a checklist of the remaining manual steps.

   Overrides (for staged verification without touching the repo):
     PRISM_HTML         absolute path to an alternate Prism.html
     PRISM_MCP_THEMES   absolute path to an alternate utils/themes.js
     PRISM_SYSTEMS      absolute path to an alternate systems.json
     PRISM_PROFILES_DIR absolute dir for the emitted facet-gen profile stub
   Zero deps, node: builtins only, offline. Importable: themeTokens(profile, mode)
   is the exact token map this tool writes (used by _check_themes.mjs).
   ========================================================================== */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packTokens } from '../prism-mcp-server/utils/themes.js';
import { ID_RE } from '../prism-mcp-server/utils/validate.js';
import { readStringConcat } from './_check_themes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = process.env.PRISM_HTML ? resolve(process.env.PRISM_HTML) : resolve(HERE, '../Prism.html');
const THEMES_JS = process.env.PRISM_MCP_THEMES ? resolve(process.env.PRISM_MCP_THEMES) : resolve(HERE, '../prism-mcp-server/utils/themes.js');
const SYSTEMS = process.env.PRISM_SYSTEMS ? resolve(process.env.PRISM_SYSTEMS) : resolve(HERE, 'systems.json');
const PROFILES_DIR = process.env.PRISM_PROFILES_DIR ? resolve(process.env.PRISM_PROFILES_DIR) : resolve(HERE, 'profiles');

/* ------------------------------------------------------------------ helpers */
const kebab = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const eolOf = (s) => (s.includes('\r\n') ? '\r\n' : '\n');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// dsShort -> a valid JS identifier prefix for the Prism.html CSS consts.
export const constPrefix = (ds) => ds.toUpperCase().replace(/[^A-Z0-9]+/g, '_');

// "#58cc02" -> "88,204,2" (the rgb triple sibling token themes carry alongside a hex).
export function hexToRgb(hex) {
  let h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`accent "${hex}" is not a #rrggbb / #rgb hex`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
}

// Serialize a token map to a compact single-line :root{…} block (the shape the
// Prism.html theme consts + themeMatrix() parser expect).
export function serializeRoot(tokens) {
  return ':root{' + Object.entries(tokens).map(([k, v]) => `${k}:${v}`).join(';') + ';}';
}

// Derive the JFH-33 chrome-identity tokens (shell font + the 4-step corner-radius
// scale) from the profile's tokenProfile, so a scaffolded pack reskins the WHOLE
// shell (scrollbars, buttons, type, corners) — not just its facet tiles. md = the
// brand radius; sm/lg/xl = ×0.5 (min 2px) / ×1.5 / ×2 to keep the size hierarchy.
// Circles/pills (50%/999px) stay hardcoded in the chrome CSS and are never tokenized.
// Mode-invariant (font/radius don't flip light↔dark), so both modes get the same
// values. Returns {} when the profile has no tokenProfile (base Cloudscape chrome wins).
export function chromeTokens(profile) {
  const tp = profile.tokenProfile;
  if (!tp) return {};
  const out = {};
  if (tp.font) out['--font'] = tp.font;
  const px = parseInt(String(tp.radius), 10);
  if (Number.isFinite(px)) {
    out['--r-sm'] = Math.max(2, Math.round(px * 0.5)) + 'px';
    out['--r-md'] = Math.round(px) + 'px';
    out['--r-lg'] = Math.round(px * 1.5) + 'px';
    out['--r-xl'] = Math.round(px * 2) + 'px';
  }
  return out;
}

// Build the sparse per-mode override map. If the profile declares palette.<mode>,
// use it verbatim (author-controlled); otherwise derive a minimal, coherent brand
// tint from `accent` (accent + its rgb sibling, mirrored onto accent2/info like the
// Cloudscape base does). Enough for a correct, selectable starter theme. The chrome
// identity tokens (font + radius scale) derived from tokenProfile fill in whatever
// the palette does not declare, so the pack's :root reskins the shell, not only the
// facets. A token the palette declares explicitly always wins over the derived one
// (a palette that sets --r-sm:10px keeps 10px even if radius*0.5 says 8px).
export function overridesFor(profile, mode) {
  const chrome = chromeTokens(profile);
  const declared = profile.palette && profile.palette[mode];
  if (declared && Object.keys(declared).length) return { ...chrome, ...declared };
  const accent = profile.accent;
  if (!accent) throw new Error('profile needs either palette.{light,dark} or an `accent` hex to derive one');
  const rgb = hexToRgb(accent);
  return {
    '--accent': accent, '--accent-rgb': rgb, '--accent2': accent,
    '--info': accent, '--info-rgb': rgb,
    ...chrome,
  };
}

// The complete :root token map this tool writes for one mode of a profile.
export function themeTokens(profile, mode) {
  return packTokens(mode, overridesFor(profile, mode));
}

// Replace `var NAME=<string literal(s)>;` inside `src[from..to)`. Returns the new
// source, or null when the declaration is absent.
function replaceConst(src, name, literal, from, to) {
  const re = new RegExp(`var\\s+${escRe(name)}\\s*=`, 'g');
  re.lastIndex = from;
  const m = re.exec(src);
  if (!m || m.index >= to) return null;
  const valueAt = m.index + m[0].length;
  const r = readStringConcat(src, valueAt);
  if (!r) throw new Error(`${name} in Prism.html is not a plain string-literal const`);
  let end = r.end;
  if (src[end] === ';') end++;
  return src.slice(0, m.index) + `var ${name}=${literal};` + src.slice(end);
}

/* ===================================================================== main */
async function main() {
  const arg = process.argv[2];
  if (!arg || arg === '--help' || arg === '-h') {
    console.error('Usage: node catalog/_scaffold_ds.mjs <profile.mjs>');
    process.exit(arg ? 0 : 1);
  }
  const profilePath = resolve(arg);
  if (!existsSync(profilePath)) { console.error('No such profile:', profilePath); process.exit(1); }
  const profile = (await import(pathToFileURL(profilePath).href)).default;
  if (!profile || typeof profile !== 'object') { console.error('Profile must default-export the PROFILE object.'); process.exit(1); }

  const ds = String(profile.ds || '').trim();
  const dsShort = kebab(profile.dsShort || '');
  if (!ds) { console.error('profile.ds (display name) is required'); process.exit(1); }
  if (!dsShort || !ID_RE.test(dsShort)) { console.error(`profile.dsShort must be kebab-case; got "${profile.dsShort}"`); process.exit(1); }
  if (dsShort === 'cloudscape') { console.error('"cloudscape" is the built-in base system and cannot be scaffolded.'); process.exit(1); }

  const lightOver = overridesFor(profile, 'light');
  const darkOver = overridesFor(profile, 'dark');
  const lightTokens = packTokens('light', lightOver);
  const darkTokens = packTokens('dark', darkOver);
  const accentLight = lightTokens['--accent'];
  const accentDark = darkTokens['--accent'];

  const idDark = `${dsShort}-dark`;
  const idLight = `${dsShort}-light`;

  console.log(`Scaffolding theme pack "${ds}" (dsShort=${dsShort}) → ${idDark}, ${idLight}`);
  const report = { patched: [], updated: [], unchanged: [], skipped: [], wrote: [] };

  /* ============================================================ 1) Prism.html */
  {
    const before = readFileSync(HTML, 'utf8');
    let html = before;
    const EOL = eolOf(html);
    const P = constPrefix(dsShort);
    const cDark = `${P}_DARK_CSS`, cLight = `${P}_LIGHT_CSS`;
    const anchor = 'var THEME_REGISTRY=[';
    if (html.indexOf(anchor) < 0) throw new Error('THEME_REGISTRY not found in ' + HTML);
    const engineFrom = () => Math.max(0, html.lastIndexOf('THEME ENGINE', html.indexOf(anchor)));

    // (a) CSS consts: rewrite in place when present, else insert right before the registry.
    const consts = [[cDark, darkTokens], [cLight, lightTokens]];
    const fresh = [];
    for (const [name, tokens] of consts) {
      const literal = JSON.stringify(serializeRoot(tokens));
      const next = replaceConst(html, name, literal, engineFrom(), html.indexOf(anchor));
      if (next == null) fresh.push(`  var ${name}=${literal};${EOL}`);
      else html = next;
    }
    if (fresh.length) {
      const at = html.indexOf(anchor);
      html = html.slice(0, at) + fresh.join('') + html.slice(at);
    }

    // (b) registry entries: rewrite in place when present, else append after the last entry.
    const entries = [
      [idDark, `{id:'${idDark}', ds:'${dsShort}', name:'${ds} Dark', mode:'dark', accent:'${accentDark}', builtin:false, css:${cDark}}`],
      [idLight, `{id:'${idLight}', ds:'${dsShort}', name:'${ds} Light', mode:'light', accent:'${accentLight}', builtin:false, css:${cLight}}`],
    ];
    const missing = [];
    for (const [id, text] of entries) {
      const regAt = html.indexOf(anchor);
      const regEnd = html.indexOf('];', regAt);
      const at = html.indexOf(`{id:'${id}'`, regAt);
      if (at < 0 || at > regEnd) { missing.push(text); continue; }
      const close = html.indexOf('}', at); // registry entries hold no nested braces
      html = html.slice(0, at) + text + html.slice(close + 1);
    }
    if (missing.length) {
      const regAt = html.indexOf(anchor);
      const closeAt = html.indexOf('];', regAt);
      if (closeAt < 0) throw new Error('THEME_REGISTRY closing `];` not found');
      const lastBrace = html.lastIndexOf('}', closeAt); // end of the current last entry
      const add = missing.map((t) => `    ${t}`).join(',' + EOL);
      html = html.slice(0, lastBrace + 1) + ',' + EOL + add + html.slice(lastBrace + 1);
    }

    if (html === before) report.unchanged.push(`Prism.html THEME_REGISTRY (${idDark}/${idLight} already match the profile)`);
    else {
      writeFileSync(HTML, html);
      if (fresh.length || missing.length) report.patched.push(`Prism.html THEME_REGISTRY (+${fresh.length} CSS const(s), +${missing.length} entr${missing.length === 1 ? 'y' : 'ies'})`);
      if (fresh.length < 2 || missing.length < 2) report.updated.push(`Prism.html THEME_REGISTRY (${idDark}/${idLight} regenerated from the profile)`);
    }
  }

  /* ==================================================== 2) MCP utils/themes.js */
  {
    const before = readFileSync(THEMES_JS, 'utf8');
    let src = before;
    const EOL = eolOf(src);
    const marker = '// ▼ scaffolded theme packs (F6)';
    const at = src.indexOf(marker);
    if (at < 0) throw new Error('scaffold marker not found in ' + THEMES_JS + ' (expected "' + marker + '")');
    const lineStart = src.lastIndexOf(EOL, at) + EOL.length; // start of the marker line (preserve its indent)
    const indent = src.slice(lineStart, at); // whitespace before the marker
    const jL = JSON.stringify(lightOver), jD = JSON.stringify(darkOver);
    const lines = [
      [idDark, `{ id: '${idDark}', ds: '${dsShort}', dsName: '${ds}', name: '${ds} Dark', mode: 'dark', builtin: false, tokens: packTokens('dark', ${jD}) },`],
      [idLight, `{ id: '${idLight}', ds: '${dsShort}', dsName: '${ds}', name: '${ds} Light', mode: 'light', builtin: false, tokens: packTokens('light', ${jL}) },`],
    ];
    const missing = [];
    for (const [id, text] of lines) {
      const re = new RegExp(`^([ \\t]*)\\{ id: '${escRe(id)}',.*$`, 'm');
      const m = re.exec(src);
      if (!m) { missing.push(text); continue; }
      const lineEnd = m.index + m[0].length - (m[0].endsWith('\r') ? 1 : 0);
      src = src.slice(0, m.index) + m[1] + text + src.slice(lineEnd);
    }
    if (missing.length) {
      const at2 = src.indexOf(marker);
      const ls = src.lastIndexOf(EOL, at2) + EOL.length;
      src = src.slice(0, ls) + missing.map((t) => indent + t + EOL).join('') + src.slice(ls);
    }
    if (src === before) report.unchanged.push(`themes.js THEMES[] (${idDark}/${idLight} already match the profile)`);
    else {
      writeFileSync(THEMES_JS, src);
      if (missing.length) report.patched.push(`themes.js THEMES[] (+${missing.length} entr${missing.length === 1 ? 'y' : 'ies'})`);
      if (missing.length < 2) report.updated.push(`themes.js THEMES[] (${idDark}/${idLight} regenerated from the profile)`);
    }
  }

  /* ==================================================== 3) catalog/systems.json */
  {
    const reg = JSON.parse(readFileSync(SYSTEMS, 'utf8'));
    reg.themePack = reg.themePack || [];
    const has = reg.themePack.some((s) => s.dsShort === dsShort) || (reg.legacy || []).some((s) => s.dsShort === dsShort);
    if (profile.skin === true) {
      report.skipped.push(`systems.json themePack[] (${dsShort} is a skin: no facet family to gate)`);
    } else if (has) {
      report.skipped.push(`systems.json themePack[] (already lists ${dsShort})`);
    } else {
      const entry = { dsShort, name: ds };
      if (profile.ticket) entry.ticket = profile.ticket;
      reg.themePack.push(entry);
      const EOL = eolOf(readFileSync(SYSTEMS, 'utf8'));
      writeFileSync(SYSTEMS, JSON.stringify(reg, null, 2).replace(/\n/g, EOL) + EOL);
      report.patched.push(`systems.json themePack[] (+${dsShort})`);
    }
  }

  /* ============================================= 4) facet-gen profile stub (F4) */
  {
    const target = resolve(PROFILES_DIR, dsShort + '.mjs');
    if (resolve(profilePath) === target) {
      report.skipped.push(`profiles/${dsShort}.mjs (input profile already lives there)`);
    } else if (existsSync(target)) {
      report.skipped.push(`profiles/${dsShort}.mjs (already exists)`);
    } else {
      const tp = profile.tokenProfile || { radius: '14px', font: 'inherit' };
      const stub =
        `/* Facet-gen profile for ${ds} (dsShort="${dsShort}") — scaffolded by _scaffold_ds.mjs (F6).\n` +
        `   Feed to the F4 generator to author the 100 spectrum facets:\n` +
        `     node catalog/_gen_system.mjs catalog/profiles/${dsShort}.mjs\n` +
        `   tokenProfile keys become .${dsShort}-root custom props (radius -> --${dsShort}-radius). */\n` +
        `export default {\n` +
        `  ds: ${JSON.stringify(ds)},\n` +
        `  dsShort: ${JSON.stringify(dsShort)},\n` +
        (profile.homeUrl ? `  homeUrl: ${JSON.stringify(profile.homeUrl)},\n` : '') +
        (profile.ticket ? `  ticket: ${JSON.stringify(profile.ticket)},\n` : '') +
        `  accent: ${JSON.stringify(profile.accent || accentDark)},\n` +
        `  tokenProfile: ${JSON.stringify(tp, null, 4).replace(/\n/g, '\n  ')},\n` +
        `};\n`;
      writeFileSync(target, stub);
      report.wrote.push(`profiles/${dsShort}.mjs (facet-gen stub)`);
    }
  }

  /* ------------------------------------------------------------------- report */
  const line = (arr) => (arr.length ? arr.map((s) => '  • ' + s).join('\n') : '  (none)');
  console.log('\nPatched (new wiring):\n' + line(report.patched));
  console.log('Regenerated from the profile:\n' + line(report.updated));
  console.log('Unchanged:\n' + line(report.unchanged));
  if (report.wrote.length) console.log('Wrote:\n' + line(report.wrote));
  console.log('Skipped (idempotent):\n' + line(report.skipped));

  console.log('\nAuto-maintained (no edit needed — derived from the theme registry):');
  console.log('  • MCP get_theme_variants.builtInThemes / .note  (utils/themes.js → themesSummary)');
  console.log('  • MCP get_theme_palette description + THEME_IDS enum');
  console.log('  • variants.test.js theme-count assertions (derive from THEME_IDS)');

  console.log('\nRemaining manual steps to finish the pack:');
  console.log(`  1. Author facets:  node catalog/_gen_system.mjs catalog/profiles/${dsShort}.mjs`);
  console.log(`  2. Merge + re-embed the island:  node catalog/_merge_spectrum.mjs …  then  node catalog/extract-from-prism.mjs && node catalog/_embed-catalog.mjs`);
  console.log(`  3. Gate coverage:  node catalog/_check_ds.mjs --only ${dsShort}`);
  console.log('  4. Theme tokens:  node catalog/_check_themes.mjs --only ' + dsShort);
  console.log('  5. MCP suite:  (cd prism-mcp-server && node --test)');
  console.log(`  6. F7 Showcase: the pack is already selectable via the registry; the Showcase page (JFH-40) reads THEME_REGISTRY, so it lists automatically once that page ships.`);
  console.log('\n✓ Scaffold complete — the theme is selectable in both modes now (facets come next via F4).');
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
