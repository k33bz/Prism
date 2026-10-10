/* GitHub Primer theme-pack profile (JFH-47) — Phase-2 design system.
   ----------------------------------------------------------------------------
   Palette values are lifted verbatim from Primer Primitives (GitHub's official
   design system): canvas / border / fg surfaces + the semantic fg roles
   (accent, success, attention, danger, done) for both color modes. Primer
   authentically ships a DIFFERENT accent blue per mode — accent.fg #0969da in
   light, #2f81f7 in dark — so each mode's --accent is set to its real token
   (this is intentional, not a mismatch).

   Feeds BOTH tools off one file:
     • _scaffold_ds.mjs (F6) reads palette.{dark,light} verbatim → primer-dark /
       primer-light registry + MCP-mirror entries.
     • _gen_system.mjs (F4) reads ds/dsShort/tokenProfile for the 100 facets.

   Visual language: clean, functional, information-dense; crisp 6px corners and
   GitHub's system-font stack. 100% offline: NO external fonts — Primer uses the
   OS system font stack, reproduced below. Facets reference only the GLOBAL
   tokens (var(--accent) …), never raw hex, so they re-skin with the active
   theme and pass the token-only gate. */
export default {
  ds: 'GitHub Primer',
  dsShort: 'primer',
  homeUrl: 'https://primer.style/',
  ticket: 'JFH-47',
  accent: '#0969da',            // accent.fg (light) — the brand primary (advisory; palette wins)

  palette: {
    // Light: canvas.default white ground, canvas.subtle panels, Primer's neutral
    // border + fg scale, and the light-mode semantic fg tokens.
    light: {
      '--bg': '#ffffff', '--panel': '#f6f8fa', '--panel2': '#f6f8fa', '--card': '#ffffff', '--line': '#d1d9e0',
      // control boundary of inputs, checkboxes, radios, switches: --line's hue moved to 3:1 on bg/panel/panel2/card (WCAG 1.4.11)
      '--control-line': '#899197',
      '--ink': '#1f2328', '--muted': '#59636e', '--dim': '#6e7781',              // fg.default / fg.muted / fg.subtle
      '--accent': '#0969da', '--accent-rgb': '9,105,218', '--accent2': '#0969da',  // accent.fg
      '--info': '#0969da', '--info-rgb': '9,105,218',                            // accent.fg (info)
      '--pos': '#1a7f37', '--pos-rgb': '26,127,55',                              // success.fg
      '--warn': '#9a6700', '--warn-rgb': '154,103,0',                            // attention.fg
      '--neg': '#cf222e', '--neg-rgb': '207,34,46',                              // danger.fg
      '--crit': '#8250df', '--crit-rgb': '130,80,223',                           // done.fg
      '--cardgrad': 'linear-gradient(157deg,rgba(9,105,218,.06),rgba(9,105,218,0) 55%)',
      // font, feel and top-bar tokens as shipped in Prism.html PRIMER_LIGHT_CSS (2026-10 drift
      // fix: they were hand-added to Prism.html and themes.js and never lived here)
      '--elev-2': '0 8px 24px rgba(66,74,83,.12)',
      '--dur': '.08s',
      '--head-w': '600',
      '--dens': '.95',
      '--cs-topnav-bg': '#24292f',
      '--cs-topnav-line': '#444c56',
      '--cs-topnav-ink': '#ffffff',
      '--cs-topnav-dim': '#d0d7de',
      '--cs-topnav-hover': 'rgba(255,255,255,.08)',
      // top-bar accent: --accent #0969da on the #24292f bar is 2.82:1, so the active mode button, brand mark
      // and focus ring there use the bar's ink instead: 14.65:1 (floor 3), with the bar color as its label
      '--cs-topnav-accent': '#ffffff',
      '--cs-topnav-accent-ink': '#24292f',
      // on-fill inks (new; same #fff the generator painted before): 4.87-5.36:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#ffffff',
      '--info-ink': '#ffffff',
      '--pos-ink': '#ffffff',
      '--warn-ink': '#ffffff',
      '--neg-ink': '#ffffff',
      '--crit-ink': '#ffffff',
    },
    // Dark: canvas.default #0d1117 ground, canvas.subtle #161b22 panels, Primer's
    // dark border + fg scale, and the brighter dark-mode semantic fg tokens
    // (including the authentic #2f81f7 dark accent blue).
    dark: {
      '--bg': '#0d1117', '--panel': '#161b22', '--panel2': '#161b22', '--card': '#161b22', '--line': '#30363d',
      // control boundary of inputs, checkboxes, radios, switches: --line's hue moved to 3:1 on bg/panel/panel2/card (WCAG 1.4.11)
      '--control-line': '#60676e',
      '--ink': '#e6edf3', '--muted': '#7d8590', '--dim': '#6e7681',              // fg.default / fg.muted / fg.subtle
      '--accent': '#2f81f7', '--accent-rgb': '47,129,247', '--accent2': '#2f81f7', // accent.fg (dark — authentic per-mode blue)
      '--info': '#2f81f7', '--info-rgb': '47,129,247',                           // accent.fg (info)
      '--pos': '#3fb950', '--pos-rgb': '63,185,80',                              // success.fg
      '--warn': '#d29922', '--warn-rgb': '210,153,34',                           // attention.fg
      '--neg': '#f85149', '--neg-rgb': '248,81,73',                              // danger.fg
      '--crit': '#a371f7', '--crit-rgb': '163,113,247',                          // done.fg
      '--cardgrad': 'linear-gradient(157deg,rgba(47,129,247,.08),rgba(47,129,247,0) 55%)',
      // font, feel and top-bar tokens as shipped in Prism.html PRIMER_DARK_CSS (2026-10 drift
      // fix: they were hand-added to Prism.html and themes.js and never lived here)
      '--elev-2': '0 8px 24px rgba(1,4,9,.8)',
      '--dur': '.08s',
      '--head-w': '600',
      '--dens': '.95',
      '--cs-topnav-bg': '#010409',
      '--cs-topnav-line': '#30363d',
      '--cs-topnav-ink': '#e6edf3',
      '--cs-topnav-dim': '#7d8590',
      '--cs-topnav-hover': 'rgba(255,255,255,.06)',
      // on-fill inks (new; the generator painted literal #fff on these fills): #fff 2.52-3.75:1 -> ink 5.05-7.50:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#0d1117',
      '--info-ink': '#0d1117',
      '--pos-ink': '#0d1117',
      '--warn-ink': '#0d1117',
      '--neg-ink': '#0d1117',
      '--crit-ink': '#0d1117',
    },
  },

  // Structural tokens for the F4 facet generator (become .primer-root custom
  // props). Primer's crisp 6px corners + GitHub's OS system-font stack (no
  // webfonts, fully offline).
  tokenProfile: {
    radius: '6px',   // -> --primer-radius : Primer's standard corner radius
    font: '-apple-system, "Segoe UI", system-ui, "Noto Sans", Helvetica, Arial, sans-serif', // -> --primer-font (offline system stack)
  },
};
