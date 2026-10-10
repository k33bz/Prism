/* Heroku theme-pack profile (JFH-71) — Phase-2 design system.
   ----------------------------------------------------------------------------
   Brand-inspired (Heroku's identity is its layered "Purple3" palette on soft
   near-white paper / deep purple-charcoal dark surfaces). Component tokens are
   approximated, not lifted from an official component library.

   Feeds BOTH tools off one file:
     • _scaffold_ds.mjs (F6) reads palette.{dark,light} verbatim → heroku-dark /
       heroku-light registry + MCP-mirror entries.
     • _gen_system.mjs (F4) reads ds/dsShort/tokenProfile for the 100 facets.

   Visual language: calm developer-platform purple — Purple3 (#79589f) as the
   through-line across light and dark, faint purple-tinted surfaces, restful
   contrast, friendly humanist type. 100% offline: NO external fonts — the brand
   look is approximated with a neutral system sans stack. Facets reference only
   the GLOBAL tokens below (var(--accent) …), never raw hex, so they re-skin with
   the active theme and pass the token-only gate. */
export default {
  ds: 'Heroku',
  dsShort: 'heroku',
  homeUrl: 'https://www.heroku.com/',
  ticket: 'JFH-71',
  accent: '#79589f',            // Purple3 — the brand primary (advisory; palette wins)

  palette: {
    // Light: soft near-white paper with a faint purple tint, deep aubergine ink,
    // Purple3 accent. Semantic roles use blue-violet / green / amber / rose /
    // magenta hues that sit comfortably beside the purple identity.
    light: {
      '--bg': '#faf9fc', '--panel': '#ffffff', '--panel2': '#f4f1f9', '--card': '#ffffff', '--line': '#e4e0ec',
      // control boundary of inputs, checkboxes, radios, switches: --line's hue moved to 3:1 on bg/panel/panel2/card (WCAG 1.4.11)
      '--control-line': '#8e8a95',
      // contrast: --dim #a49db3 -> #9891a7; dim/panel 2.61 -> 3.02:1 (floor 3), dim/card 2.61 -> 3.02:1 (floor 3)
      // contrast: --dim #9891a7 -> #90899f; dim/bg 2.88 -> 3.2:1 (floor 3), dim/panel2 2.71 -> 3:1 (floor 3); held on --bg and --panel2 as well
      '--ink': '#2a2734', '--muted': '#6f6a7d', '--dim': '#90899f',
      '--accent': '#79589f', '--accent-rgb': '121,88,159', '--accent2': '#79589f',  // Purple3
      // contrast: --info #6f7bd6 -> #636ec8; info/panel 3.83 -> 4.57:1 (floor 4.5), #fff/info 3.83 -> 4.57:1 (floor 4.5)
      '--info': '#636ec8', '--info-rgb': '99,110,200',                    // blue-violet
      // contrast: --pos #3fae6b -> #048849; pos/panel 2.81 -> 4.54:1 (floor 4.5), #fff/pos 2.81 -> 4.54:1 (floor 4.5)
      '--pos': '#048849', '--pos-rgb': '4,136,73',                       // success green
      // contrast: --warn #e0a13a -> #a06c06; warn/panel 2.25 -> 4.52:1 (floor 4.5), #fff/warn 2.25 -> 4.52:1 (floor 4.5)
      '--warn': '#a06c06', '--warn-rgb': '160,108,6',                     // amber
      // contrast: --neg #d0455f -> #cf445e; neg/panel 4.47 -> 4.52:1 (floor 4.5), #fff/neg 4.47 -> 4.52:1 (floor 4.5)
      '--neg': '#cf445e', '--neg-rgb': '207,68,94',                        // rose/danger
      '--crit': '#b5479f', '--crit-rgb': '181,71,159',                     // magenta
      '--cardgrad': 'linear-gradient(157deg,rgba(121,88,159,.06),rgba(121,88,159,0) 55%)',
      // font, feel and top-bar tokens as shipped in Prism.html HEROKU_LIGHT_CSS (2026-10 drift
      // fix: they were hand-added to Prism.html and themes.js and never lived here)
      '--font': '"Open Sans", "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif',
      '--elev-1': '0 1px 4px rgba(40,30,60,.08)',
      '--elev-2': '0 6px 20px rgba(40,30,60,.14)',
      '--dur': '.18s',
      '--ease': 'cubic-bezier(.4,0,.2,1)',
      '--head-w': '600',
      '--cs-topnav-bg': '#3d2c5f',
      '--cs-topnav-line': 'rgba(255,255,255,.14)',
      '--cs-topnav-ink': '#f2eef8',
      '--cs-topnav-dim': '#c9bce0',
      '--cs-topnav-hover': 'rgba(255,255,255,.1)',
      // top-bar accent: --accent #79589f on the #3d2c5f bar is 2.15:1, so the active mode button, brand mark
      // and focus ring there use the bar's ink instead: 10.65:1 (floor 3), with the bar color as its label
      '--cs-topnav-accent': '#f2eef8',
      '--cs-topnav-accent-ink': '#3d2c5f',
      // on-fill inks (new; same #fff the generator painted before): 4.52-5.66:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#ffffff',
      '--info-ink': '#ffffff',
      '--pos-ink': '#ffffff',
      '--warn-ink': '#ffffff',
      '--neg-ink': '#ffffff',
      '--crit-ink': '#ffffff',
    },
    // Dark: deep purple-charcoal surfaces (the signature Heroku dark ground) with
    // Purple3 holding steady on top and the semantic hues brightened for contrast.
    dark: {
      '--bg': '#1a1523', '--panel': '#2a2338', '--panel2': '#201a2b', '--card': '#2a2338', '--line': '#3a3350',
      // control boundary of inputs, checkboxes, radios, switches: --line's hue moved to 3:1 on bg/panel/panel2/card (WCAG 1.4.11)
      '--control-line': '#726b8b',
      '--ink': '#f2eef8', '--muted': '#b0a6c2', '--dim': '#7a7090',
      // contrast: --accent #79589f -> #a07ec9; accent/panel 2.66 -> 4.53:1 (floor 4.5); Heroku purple lightened on its own hue for dark surfaces
      '--accent': '#a07ec9', '--accent-rgb': '160,126,201', '--accent2': '#79589f',  // Purple3
      '--info': '#8b96e2', '--info-rgb': '139,150,226',                    // brightened blue-violet
      '--pos': '#56c483', '--pos-rgb': '86,196,131',
      '--warn': '#edb455', '--warn-rgb': '237,180,85',
      // contrast: --neg #e26075 -> #e46277; neg/panel 4.42 -> 4.52:1 (floor 4.5)
      '--neg': '#e46277', '--neg-rgb': '228,98,119',
      // contrast: --crit #cc63b3 -> #d167b7; crit/panel 4.30 -> 4.54:1 (floor 4.5)
      '--crit': '#d167b7', '--crit-rgb': '209,103,183',
      '--cardgrad': 'linear-gradient(157deg,rgba(121,88,159,.08),rgba(121,88,159,0) 55%)',
      // font, feel and top-bar tokens as shipped in Prism.html HEROKU_DARK_CSS (2026-10 drift
      // fix: they were hand-added to Prism.html and themes.js and never lived here)
      '--font': '"Open Sans", "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif',
      '--elev-1': '0 1px 4px rgba(0,0,0,.4)',
      '--elev-2': '0 6px 20px rgba(0,0,0,.5)',
      '--dur': '.18s',
      '--ease': 'cubic-bezier(.4,0,.2,1)',
      '--head-w': '600',
      '--cs-topnav-bg': '#2a2338',
      '--cs-topnav-line': '#3a3350',
      '--cs-topnav-ink': '#f2eef8',
      '--cs-topnav-dim': '#b0a6c2',
      '--cs-topnav-hover': 'rgba(255,255,255,.08)',
      // on-fill inks (new; the generator painted literal #fff on these fills): #fff 1.86-3.33:1 -> ink 5.37-9.58:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#1a1523',
      '--info-ink': '#1a1523',
      '--pos-ink': '#1a1523',
      '--warn-ink': '#1a1523',
      '--neg-ink': '#1a1523',
      '--crit-ink': '#1a1523',
    },
  },

  // Structural tokens for the F4 facet generator (become .heroku-root custom
  // props). Gently rounded corners + a neutral humanist system-sans stack (no
  // webfonts) approximating the brand's clean developer-platform voice.
  tokenProfile: {
    radius: '8px',   // -> --heroku-radius : soft, gently rounded corners
    font: '"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif', // -> --heroku-font (offline system sans)
  },
};
