/* Stack Overflow (Stacks) theme-pack profile (JFH-69) — Phase-2 design system.
   ----------------------------------------------------------------------------
   Brand-inspired by Stack Overflow's public "Stacks" design system. Palette
   values approximate real Stacks tokens (SO orange, SO blue link, SO green,
   Peacock/near-white surfaces, the dark-mode charcoal set). Component tokens are
   approximated, not lifted from an official component library.

   Feeds BOTH tools off one file:
     • _scaffold_ds.mjs (F6) reads palette.{dark,light} verbatim → stackoverflow-
       dark / stackoverflow-light registry + MCP-mirror entries.
     • _gen_system.mjs (F4) reads ds/dsShort/tokenProfile for the 100 facets.

   Visual language: crisp, information-dense, high-contrast utility UI — the
   signature SO orange accent, a calm SO-blue link, tight 4px corners, and a
   clean humanist sans. 100% offline: NO external fonts — the look is
   approximated with a system humanist-sans stack. Facets reference only the
   GLOBAL tokens below (var(--accent) …), never raw hex, so they re-skin with the
   active theme and pass the token-only gate. */
export default {
  ds: 'Stack Overflow',
  dsShort: 'stackoverflow',
  homeUrl: 'https://stackoverflow.design/',
  ticket: 'JFH-69',
  accent: '#f48024',            // SO Orange — the brand primary (advisory; palette wins)

  palette: {
    // Light: near-white Stacks surfaces, near-black ink (#232629), SO blue link
    // for info, SO green for success, an amber warn distinct from the orange
    // accent, SO red for danger, and a distinct magenta-purple critical hue.
    light: {
      '--bg': '#f8f9f9', '--panel': '#ffffff', '--panel2': '#f1f2f3', '--card': '#ffffff', '--line': '#d6d9dc',
      // contrast: --dim #9fa6ad -> #838c95; dim/panel 2.46 -> 3.41:1 (floor 3), dim/card 2.46 -> 3.41:1 (floor 3); Stacks black-400
      '--ink': '#232629', '--muted': '#6a737c', '--dim': '#838c95',                 // black-750 / black-500 / black-350
      // contrast: --accent #f48024 -> #bb5c04; accent/panel 2.64 -> 4.52:1 (floor 4.5), accent/bg 2.50 -> 4.29:1 (floor 3), #fff/accent 2.64 -> 4.52:1 (floor 4.5); SO orange darkened on its own hue
      '--accent': '#bb5c04', '--accent-rgb': '187,92,4', '--accent2': '#f48024',  // SO Orange
      '--info': '#0074cc', '--info-rgb': '0,116,204',                               // SO blue link (blue-500)
      '--pos': '#2f6f44', '--pos-rgb': '47,111,68',                                 // SO green (accepted)
      // contrast: --warn #b8860b -> #996e04; warn/panel 3.25 -> 4.58:1 (floor 4.5), #fff/warn 3.25 -> 4.58:1 (floor 4.5)
      '--warn': '#996e04', '--warn-rgb': '153,110,4',                              // amber (distinct from accent)
      '--neg': '#d1383d', '--neg-rgb': '209,56,61',                                 // SO red (red-500)
      '--crit': '#9c2bad', '--crit-rgb': '156,43,173',                              // distinct critical magenta-purple
      '--cardgrad': 'linear-gradient(157deg,rgba(244,128,36,.06),rgba(244,128,36,0) 55%)',
      // font, feel and top-bar tokens as shipped in Prism.html STACKOVERFLOW_LIGHT_CSS (2026-10 drift
      // fix: they were hand-added to Prism.html and themes.js and never lived here)
      '--font': 'Roboto, -apple-system, "Segoe UI", system-ui, Helvetica, Arial, sans-serif',
      '--elev-2': '0 2px 8px rgba(0,0,0,.12)',
      '--dur': '.1s',
      '--head-w': '600',
      '--dens': '.95',
      '--cs-topnav-bg': '#f8f9f9',
      '--cs-topnav-line': '#e3e6e8',
      '--cs-topnav-ink': '#232629',
      '--cs-topnav-dim': '#6a737c',
      '--cs-topnav-hover': 'rgba(0,0,0,.05)',
      '--cs-topnav-elev': '0 1px 0 rgba(0,0,0,.06)',
      // on-fill inks (new; same #fff the generator painted before): 4.52-6.25:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#ffffff',
      '--info-ink': '#ffffff',
      '--pos-ink': '#ffffff',
      '--warn-ink': '#ffffff',
      '--neg-ink': '#ffffff',
      '--crit-ink': '#ffffff',
    },
    // Dark: Stacks dark-mode charcoal surfaces (#1e1e1e / #2d2d2d / #262626) with
    // light ink; info/success/warn/danger/critical brightened to pop on dark.
    dark: {
      '--bg': '#1e1e1e', '--panel': '#2d2d2d', '--panel2': '#262626', '--card': '#2d2d2d', '--line': '#3d3d3d',
      // contrast: --dim #6e767d -> #6f777e; dim/panel 2.98 -> 3.03:1 (floor 3), dim/card 2.98 -> 3.03:1 (floor 3)
      '--ink': '#e7e8eb', '--muted': '#9fa6ad', '--dim': '#6f777e',
      '--accent': '#f48024', '--accent-rgb': '244,128,36', '--accent2': '#f48024',  // SO Orange
      '--info': '#4aa3ff', '--info-rgb': '74,163,255',                              // brightened SO blue
      '--pos': '#5eba7d', '--pos-rgb': '94,186,125',                                // brightened SO green
      '--warn': '#e3b341', '--warn-rgb': '227,179,65',                              // brightened amber
      '--neg': '#f4676c', '--neg-rgb': '244,103,108',                               // brightened red
      // contrast: --crit #c264d6 -> #cd6ee1; crit/panel 3.99 -> 4.53:1 (floor 4.5)
      '--crit': '#cd6ee1', '--crit-rgb': '205,110,225',                             // brightened critical purple
      '--cardgrad': 'linear-gradient(157deg,rgba(244,128,36,.08),rgba(244,128,36,0) 55%)',
      // font, feel and top-bar tokens as shipped in Prism.html STACKOVERFLOW_DARK_CSS (2026-10 drift
      // fix: they were hand-added to Prism.html and themes.js and never lived here)
      '--font': 'Roboto, -apple-system, "Segoe UI", system-ui, Helvetica, Arial, sans-serif',
      '--elev-2': '0 2px 8px rgba(0,0,0,.5)',
      '--dur': '.1s',
      '--head-w': '600',
      '--dens': '.95',
      '--cs-topnav-bg': '#2d2d2d',
      '--cs-topnav-line': '#3d3d3d',
      '--cs-topnav-ink': '#e7e8eb',
      '--cs-topnav-dim': '#9fa6ad',
      '--cs-topnav-hover': 'rgba(255,255,255,.08)',
      // on-fill inks (new; the generator painted literal #fff on these fills): #fff 1.95-3.04:1 -> ink 5.49-8.57:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#1e1e1e',
      '--info-ink': '#1e1e1e',
      '--pos-ink': '#1e1e1e',
      '--warn-ink': '#1e1e1e',
      '--neg-ink': '#1e1e1e',
      '--crit-ink': '#1e1e1e',
    },
  },

  // Structural tokens for the F4 facet generator (become .stackoverflow-root
  // custom props). Crisp small corners + a clean humanist system-sans stack (no
  // webfonts) to echo the Stacks utilitarian voice.
  tokenProfile: {
    radius: '4px',   // -> --stackoverflow-radius : Stacks' crisp small corner radius
    font: '-apple-system, "Segoe UI", system-ui, Roboto, Helvetica, Arial, sans-serif', // -> --stackoverflow-font (offline humanist sans)
  },
};
