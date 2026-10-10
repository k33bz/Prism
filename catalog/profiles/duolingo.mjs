/* Duolingo theme-pack profile (JFH-67) — Phase-2 design system.
   ----------------------------------------------------------------------------
   Feeds BOTH tools off one file:
     • catalog/_scaffold_ds.mjs (F6) reads palette.{dark,light} verbatim as the
       :root token overrides layered over the Cloudscape base → duolingo-dark /
       duolingo-light registry + MCP-mirror entries.
     • catalog/_gen_system.mjs (F4) reads ds/dsShort/tokenProfile to author the
       100 native facets tagged data-spectrum="duolingo".

   Visual language: playful ed-tech — bold Feather-green primary, big chunky
   rounded shapes, friendly type, celebratory color. Palette values are
   Duolingo's own named brand colors (Feather Green, Macaw, Fox, Cardinal,
   Beetle) + its real dark-mode surfaces. 100% offline: NO external fonts — the
   brand's rounded look is approximated with a system rounded-font stack. Facets
   only ever reference the GLOBAL tokens below (var(--accent) …), never raw hex,
   so they re-skin with whatever theme is active and pass the token-only gate. */
export default {
  ds: 'Duolingo',
  dsShort: 'duolingo',
  homeUrl: 'https://design.duolingo.com/',
  ticket: 'JFH-67',
  accent: '#58cc02',            // Feather Green — the brand primary (advisory; palette wins)

  // Hand-authored palette for both modes (author-controlled; the scaffolder uses
  // these verbatim). Every surface/text/accent token is set so nothing bleeds
  // through from the Cloudscape base. Six distinct, authentic brand hues map onto
  // the six semantic roles so the generated facet variants read as a real system.
  palette: {
    light: {
      // surfaces — Polar/Snow with the classic Swan hairline border
      '--bg': '#f7f7f7', '--panel': '#ffffff', '--panel2': '#fbfbfb', '--card': '#ffffff', '--line': '#e5e5e5',
      // control boundary of inputs, checkboxes, radios, switches: --line's hue moved to 3:1 on bg/panel/panel2/card (WCAG 1.4.11)
      '--control-line': '#908f90',
      // text — Eel/Wolf/Hare (Duolingo never uses pure black)
      // contrast: --muted #777777 -> #767676; muted/panel 4.48 -> 4.54:1 (floor 4.5), muted/card 4.48 -> 4.54:1 (floor 4.5)
      // contrast: --dim #afafaf -> #949494; dim/panel 2.19 -> 3.03:1 (floor 3), dim/card 2.19 -> 3.03:1 (floor 3)
      // contrast: --muted #767676 -> #717171; muted/bg 4.24 -> 4.56:1 (floor 4.5), muted/panel2 4.39 -> 4.72:1 (floor 4.5); held on --bg and --panel2 as well
      // contrast: --dim #949494 -> #8f8f8f; dim/bg 2.83 -> 3.02:1 (floor 3), dim/panel2 2.93 -> 3.13:1 (floor 3); held on --bg and --panel2 as well
      '--ink': '#3c3c3c', '--muted': '#717171', '--dim': '#8f8f8f',
      // brand roles
      // contrast: --accent #58cc02 -> #347f02; accent/panel 2.09 -> 5.02:1 (floor 4.5), accent/bg 1.95 -> 4.69:1 (floor 3), #fff/accent 2.09 -> 5.02:1 (floor 4.5); Feather Green darkened on its own hue; Tree Frog #58a700 is only 3.0:1
      '--accent': '#347f02', '--accent-rgb': '52,127,2', '--accent2': '#58cc02',   // Feather Green
      // contrast: --info #1cb0f6 -> #067eb3; info/panel 2.44 -> 4.52:1 (floor 4.5), #fff/info 2.44 -> 4.52:1 (floor 4.5); Macaw darkened on its own hue
      '--info': '#067eb3', '--info-rgb': '6,126,179',                              // Macaw
      // contrast: --pos #89e219 -> #4d8405; pos/panel 1.62 -> 4.55:1 (floor 4.5), #fff/pos 1.62 -> 4.55:1 (floor 4.5); Mask Green darkened on its own hue
      '--pos': '#4d8405', '--pos-rgb': '77,132,5',                               // Mask Green (streak/XP)
      // contrast: --warn #ff9600 -> #ae6401; warn/panel 2.18 -> 4.54:1 (floor 4.5), #fff/warn 2.18 -> 4.54:1 (floor 4.5); Fox darkened on its own hue
      '--warn': '#ae6401', '--warn-rgb': '174,100,1',                              // Fox
      // contrast: --neg #ff4b4b -> #e22b33; neg/panel 3.30 -> 4.54:1 (floor 4.5), #fff/neg 3.30 -> 4.54:1 (floor 4.5); Cardinal darkened on its own hue; Fire Ant #ea2b2b is only 4.3:1
      '--neg': '#e22b33', '--neg-rgb': '226,43,51',                                // Cardinal
      // contrast: --crit #ce82ff -> #9f54cd; crit/panel 2.54 -> 4.54:1 (floor 4.5), #fff/crit 2.54 -> 4.54:1 (floor 4.5); Beetle darkened on its own hue
      '--crit': '#9f54cd', '--crit-rgb': '159,84,205',                            // Beetle
      '--cardgrad': 'linear-gradient(157deg,rgba(88,204,2,.06),rgba(88,204,2,0) 55%)',
      // font, feel and top-bar tokens as shipped in Prism.html DUOLINGO_LIGHT_CSS (2026-10 drift
      // fix: they were hand-added to Prism.html and themes.js and never lived here)
      '--font': 'Nunito, ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif',
      '--elev-1': '0 4px 0 #e0e0e0',
      '--elev-2': '0 6px 0 #d4d4d4',
      '--dur': '.2s',
      '--ease': 'cubic-bezier(.34,1.56,.64,1)',
      '--bd': '2px',
      '--head-w': '800',
      '--dens': '1.15',
      // contrast: --cs-topnav-bg #58cc02 -> #347f02; topnav-ink/topnav-bg 2.09 -> 5.02:1 (floor 4.5), topnav-dim/topnav-bg 1.96 -> 4.52:1 (floor 4.5); same green as --accent
      '--cs-topnav-bg': '#347f02',
      '--cs-topnav-line': 'rgba(255,255,255,.28)',
      '--cs-topnav-ink': '#ffffff',
      '--cs-topnav-dim': 'rgba(255,255,255,.92)',
      '--cs-topnav-hover': 'rgba(255,255,255,.16)',
      // top-bar accent: --accent #347f02 on the #347f02 bar is 1.00:1, so the active mode button, brand mark
      // and focus ring there use the bar's ink instead: 5.02:1 (floor 3), with the bar color as its label
      '--cs-topnav-accent': '#ffffff',
      '--cs-topnav-accent-ink': '#347f02',
      // on-fill inks (new; same #fff the generator painted before): 4.52-5.02:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#ffffff',
      '--info-ink': '#ffffff',
      '--pos-ink': '#ffffff',
      '--warn-ink': '#ffffff',
      '--neg-ink': '#ffffff',
      '--crit-ink': '#ffffff',
    },
    dark: {
      // surfaces — Duolingo's real dark-mode charcoal/teal set
      '--bg': '#131f24', '--panel': '#202f36', '--panel2': '#1b2a30', '--card': '#202f36', '--line': '#37464f',
      // control boundary of inputs, checkboxes, radios, switches: --line's hue moved to 3:1 on bg/panel/panel2/card (WCAG 1.4.11)
      '--control-line': '#677881',
      // text — Snow-ish ink on the dark surfaces
      '--ink': '#f1f7fb', '--muted': '#a5b4bd', '--dim': '#6b7c85',
      // brand roles — vivid, unchanged so they pop on the dark surface
      '--accent': '#58cc02', '--accent-rgb': '88,204,2', '--accent2': '#58cc02',   // Feather Green
      '--info': '#1cb0f6', '--info-rgb': '28,176,246',                              // Macaw
      '--pos': '#89e219', '--pos-rgb': '137,226,25',                               // Mask Green
      '--warn': '#ff9600', '--warn-rgb': '255,150,0',                              // Fox
      // contrast: --neg #ff4b4b -> #ff5b57; neg/panel 4.18 -> 4.53:1 (floor 4.5); Cardinal lightened on its own hue
      '--neg': '#ff5b57', '--neg-rgb': '255,91,87',                                // Cardinal
      '--crit': '#ce82ff', '--crit-rgb': '206,130,255',                            // Beetle
      '--cardgrad': 'linear-gradient(157deg,rgba(88,204,2,.08),rgba(88,204,2,0) 55%)',
      // font, feel and top-bar tokens as shipped in Prism.html DUOLINGO_DARK_CSS (2026-10 drift
      // fix: they were hand-added to Prism.html and themes.js and never lived here)
      '--font': 'Nunito, ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif',
      '--elev-1': '0 4px 0 rgba(0,0,0,.45)',
      '--elev-2': '0 6px 0 rgba(0,0,0,.5)',
      '--dur': '.2s',
      '--ease': 'cubic-bezier(.34,1.56,.64,1)',
      '--bd': '2px',
      '--head-w': '800',
      '--dens': '1.15',
      '--cs-topnav-bg': '#202f36',
      '--cs-topnav-line': '#37464f',
      '--cs-topnav-ink': '#f1f7fb',
      '--cs-topnav-dim': '#a5b4bd',
      '--cs-topnav-hover': 'rgba(255,255,255,.08)',
      // on-fill inks (new; the generator painted literal #fff on these fills): #fff 1.62-3.05:1 -> ink 5.51-10.37:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#131f24',
      '--info-ink': '#131f24',
      '--pos-ink': '#131f24',
      '--warn-ink': '#131f24',
      '--neg-ink': '#131f24',
      '--crit-ink': '#131f24',
    },
  },

  // Structural tokens for the F4 facet generator (become .duolingo-root custom
  // props). Chunky rounded geometry + a rounded system-font stack (no webfonts).
  tokenProfile: {
    radius: '16px',   // -> --duolingo-radius : Duolingo's chunky corner radius
    font: 'ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, -apple-system, sans-serif', // -> --duolingo-font (offline, rounded)
  },
};
