/* Prism theme engine: turn a deriveTheme() result into a theme-pack profile.
   ----------------------------------------------------------------------------
   The profile has the shape catalog/profiles/*.mjs use, so it feeds both
   catalog/_scaffold_ds.mjs (palette.{dark,light} become the shell's theme
   consts and the MCP mirror) and catalog/_gen_system.mjs (ds, dsShort and
   tokenProfile become the 100 facets):

     { ds, dsShort, homeUrl?, ticket?, accent,
       palette: { dark: {...}, light: {...} },
       tokenProfile: { radius, font } }

   tokenProfile.radius is the md radius; the scaffolder rebuilds the
   --r-sm..--r-xl scale from it with the same x0.5 / x1 / x1.5 / x2 rule the
   engine uses, so the palette and the chrome tokens agree. Zero deps, and no
   import of derive.mjs (its CLI loads this file while it is still running). */
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // same rule as prism-mcp-server/utils/validate.js
const kebab = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Build a scaffolder/generator profile from a deriveTheme() result.
 * opts: { ds (display name; default the theme name), dsShort (kebab id; default
 * kebab(ds)), homeUrl?, ticket? }. Throws on an invalid dsShort or homeUrl.
 */
export function toProfile(derived, opts = {}) {
  if (!derived || typeof derived !== 'object' || !derived.report) throw new Error('toProfile needs the result of deriveTheme()');
  if (!derived.dark && !derived.light) throw new Error('derived theme has neither a dark nor a light palette');
  const input = derived.report.input || {};
  const ds = String(opts.ds || input.name || '').trim();
  if (!ds || /[<>{};'"`\\]/.test(ds)) throw new Error('ds must be a display name without < > { } ; quotes or backslash');
  const dsShort = kebab(opts.dsShort || ds);
  if (!dsShort || !ID_RE.test(dsShort)) throw new Error(`dsShort must be kebab-case; got "${opts.dsShort || ds}"`);
  if (dsShort === 'cloudscape') throw new Error('"cloudscape" is the built-in base system and cannot be a pack');
  if (opts.homeUrl != null && !/^https?:\/\/[^\s"'<>]+$/.test(String(opts.homeUrl))) throw new Error('homeUrl must be an http(s) URL');

  const palette = {};
  for (const m of ['dark', 'light']) if (derived[m]) palette[m] = { ...derived[m] };
  const any = derived.dark || derived.light;
  const profile = {
    ds,
    dsShort,
    ...(opts.homeUrl ? { homeUrl: String(opts.homeUrl) } : {}),
    ...(opts.ticket ? { ticket: String(opts.ticket) } : {}),
    accent: input.accent || any['--accent'],
    palette,
    tokenProfile: { radius: any['--r-md'], font: any['--font'] },
  };
  return profile;
}

/** The profile as an ES module source (what --profile out.mjs writes). */
export function profileModule(profile, derived) {
  const r = derived && derived.report;
  const safe = (x) => String(x).replace(/\*\//g, '* /');
  const head = [
    `/* ${safe(profile.ds)} theme-pack profile, derived by catalog/theme-engine (deriveTheme).`,
    r ? `   Input: ${safe(JSON.stringify(r.input))}` : null,
    r ? `   Contrast ${r.contrast}: ${r.summary.checked} gated pairs, ${r.summary.failing} failing.` : null,
    ...(r && r.moved.length ? r.moved.map((m) => `   [${m.mode}] ${safe(m.message)}`) : []),
    `   Wire it with:  node catalog/_scaffold_ds.mjs <this file>`,
    `   Facets with:   node catalog/_gen_system.mjs <this file> */`,
  ].filter(Boolean).join('\n');
  return `${head}\nexport default ${JSON.stringify(profile, null, 2)};\n`;
}
