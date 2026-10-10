/* Frutiger Aero theme profile (k33bz fork, 2026-09-05).
   ----------------------------------------------------------------------------
   The mid-2000s glossy aesthetic: sky-blue grounds, aqua and lime accents, white
   specular highlights (carried by --cardgrad and inset --elev-* highlights), generous
   rounding and a bouncy ease. Skin-only for now: the facet family is pending.

   palette.{dark,light} below are the SAME token blocks as the AERO_DARK_CSS /
   AERO_LIGHT_CSS consts in Prism.html's THEME_REGISTRY (generated from them by
   gen_profiles.mjs), so the F6 scaffolder's MCP mirror matches the shell exactly.
   Feeds: _scaffold_ds.mjs (F6, wiring) and _gen_system.mjs (F4, the 100 facets). */
export default {
  ds: 'Frutiger Aero',
  dsShort: 'aero',
  homeUrl: 'https://en.wikipedia.org/wiki/Frutiger_Aero',
  ticket: 'fork-themes-2026-09',
  skin: true,                   // shell skin only: no facet family, so the scaffolder does not register it in systems.json
  accent: '#2fb0ff',
  palette: {
    light: {
      '--bg': '#dff3ff',
      '--panel': '#ffffff',
      '--panel2': '#eef9ff',
      '--card': '#ffffff',
      '--line': '#b9dff5',
      // control boundary of inputs, checkboxes, radios, switches: --line's hue moved to 3:1 on bg/panel/panel2/card (WCAG 1.4.11)
      '--control-line': '#6c8fa4',
      '--ink': '#0b3550',
      '--muted': '#3f6b86',
      // contrast: --dim #7aa3bd -> #7099b3; dim/panel 2.69 -> 3.05:1 (floor 3), dim/card 2.69 -> 3.05:1 (floor 3)
      '--dim': '#7099b3',
      // contrast: --accent #2fb0ff -> #007cbb; accent/panel 2.39 -> 4.56:1 (floor 4.5), accent/bg 2.10 -> 4.00:1 (floor 3), #fff/accent 2.39 -> 4.56:1 (floor 4.5); aqua darkened on its own hue
      '--accent': '#007cbb',
      '--accent-rgb': '0,124,187',
      '--accent2': '#7ee03e',
      // contrast: --info #1f8bff -> #0475e1; info/panel 3.39 -> 4.53:1 (floor 4.5), #fff/info 3.39 -> 4.53:1 (floor 4.5)
      '--info': '#0475e1',
      '--info-rgb': '4,117,225',
      // contrast: --pos #5cc93a -> #2d8801; pos/panel 2.13 -> 4.53:1 (floor 4.5), #fff/pos 2.13 -> 4.53:1 (floor 4.5)
      '--pos': '#2d8801',
      '--pos-rgb': '45,136,1',
      // contrast: --warn #ffb020 -> #a06c05; warn/panel 1.83 -> 4.52:1 (floor 4.5), #fff/warn 1.83 -> 4.52:1 (floor 4.5)
      '--warn': '#a06c05',
      '--warn-rgb': '160,108,5',
      // contrast: --neg #ff5c5c -> #da373e; neg/panel 3.03 -> 4.57:1 (floor 4.5), #fff/neg 3.03 -> 4.57:1 (floor 4.5)
      '--neg': '#da373e',
      '--neg-rgb': '218,55,62',
      // contrast: --crit #b06cff -> #9751e3; crit/panel 3.26 -> 4.56:1 (floor 4.5), #fff/crit 3.26 -> 4.56:1 (floor 4.5)
      '--crit': '#9751e3',
      '--crit-rgb': '151,81,227',
      '--cardgrad': 'linear-gradient(180deg,rgba(255,255,255,.85),rgba(255,255,255,.25) 48%,rgba(255,255,255,0) 52%)',
      '--font': '"Segoe UI", Frutiger, "Frutiger Linotype", Tahoma, Verdana, sans-serif',
      '--r-sm': '10px',
      '--r-md': '16px',
      '--r-lg': '22px',
      '--r-xl': '30px',
      '--elev-1': '0 6px 18px rgba(20,90,140,.22),inset 0 1px 0 rgba(255,255,255,.9)',
      '--elev-2': '0 12px 30px rgba(20,90,140,.3),inset 0 1px 0 rgba(255,255,255,.95)',
      '--dur': '.25s',
      '--ease': 'cubic-bezier(.34,1.4,.64,1)',
      '--bd': '1px',
      '--head-w': '700',
      '--dens': '1.1',
      '--cs-topnav-bg': '#1f6fb2',
      '--cs-topnav-line': '#3d8fd6',
      '--cs-topnav-ink': '#ffffff',
      // contrast: --cs-topnav-dim #cfe6fa -> #dff0fe; topnav-dim/topnav-bg 4.11 -> 4.54:1 (floor 4.5)
      '--cs-topnav-dim': '#dff0fe',
      '--cs-topnav-hover': 'rgba(255,255,255,.18)',
      // top-bar accent: --accent #007cbb on the #1f6fb2 bar is 1.16:1, so the active mode button, brand mark
      // and focus ring there use the bar's ink instead: 5.28:1 (floor 3), with the bar color as its label
      '--cs-topnav-accent': '#ffffff',
      '--cs-topnav-accent-ink': '#1f6fb2',
      // on-fill inks (new; same #fff the generator painted before): 4.52-4.57:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#ffffff',
      '--info-ink': '#ffffff',
      '--pos-ink': '#ffffff',
      '--warn-ink': '#ffffff',
      '--neg-ink': '#ffffff',
      '--crit-ink': '#ffffff',
    },
    dark: {
      '--bg': '#052a44',
      '--panel': '#0b3b5e',
      '--panel2': '#083352',
      '--card': '#0b3b5e',
      '--line': '#1d5a84',
      // control boundary of inputs, checkboxes, radios, switches: --line's hue moved to 3:1 on bg/panel/panel2/card (WCAG 1.4.11)
      '--control-line': '#4c87b3',
      '--ink': '#eaf7ff',
      '--muted': '#a8cde6',
      '--dim': '#6d9bbd',
      '--accent': '#34c3ff',
      '--accent-rgb': '52,195,255',
      '--accent2': '#8cf05a',
      '--info': '#4fb3ff',
      '--info-rgb': '79,179,255',
      '--pos': '#8cf05a',
      '--pos-rgb': '140,240,90',
      '--warn': '#ffc23d',
      '--warn-rgb': '255,194,61',
      // contrast: --neg #ff6b6b -> #fe7876; neg/panel 4.20 -> 4.53:1 (floor 4.5)
      '--neg': '#fe7876',
      '--neg-rgb': '254,120,118',
      // contrast: --crit #c084fc -> #c387ff; crit/panel 4.41 -> 4.57:1 (floor 4.5)
      '--crit': '#c387ff',
      '--crit-rgb': '195,135,255',
      '--cardgrad': 'linear-gradient(180deg,rgba(255,255,255,.22),rgba(255,255,255,.04) 48%,rgba(255,255,255,0) 52%)',
      '--font': '"Segoe UI", Frutiger, "Frutiger Linotype", Tahoma, Verdana, sans-serif',
      '--r-sm': '10px',
      '--r-md': '16px',
      '--r-lg': '22px',
      '--r-xl': '30px',
      '--elev-1': '0 6px 18px rgba(0,40,80,.45),inset 0 1px 0 rgba(255,255,255,.35)',
      '--elev-2': '0 12px 30px rgba(0,40,80,.55),inset 0 1px 0 rgba(255,255,255,.45)',
      '--dur': '.25s',
      '--ease': 'cubic-bezier(.34,1.4,.64,1)',
      '--bd': '1px',
      '--head-w': '700',
      '--dens': '1.1',
      '--cs-topnav-bg': '#0b3b5e',
      '--cs-topnav-line': '#1d5a84',
      '--cs-topnav-ink': '#eaf7ff',
      '--cs-topnav-dim': '#a8cde6',
      '--cs-topnav-hover': 'rgba(255,255,255,.14)',
      // on-fill inks (new; the generator painted literal #fff on these fills): #fff 1.43-2.57:1 -> ink 5.74-10.36:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#052a44',
      '--info-ink': '#052a44',
      '--pos-ink': '#052a44',
      '--warn-ink': '#052a44',
      '--neg-ink': '#052a44',
      '--crit-ink': '#052a44',
    },
  },
  tokenProfile: {
    radius: '16px',
    font: '"Segoe UI", Frutiger, "Frutiger Linotype", Tahoma, Verdana, sans-serif',
  },
};
