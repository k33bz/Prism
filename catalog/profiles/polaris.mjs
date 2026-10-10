/* Shopify Polaris theme-pack profile (JFH-45) — Phase-2 design system.
   ----------------------------------------------------------------------------
   Brand-inspired by Shopify's public Polaris system (authentic surface/border/
   text tokens + the action green #008060). Component tokens are approximated,
   not lifted from the live component library.

   Feeds BOTH tools off one file:
     • _scaffold_ds.mjs (F6) reads palette.{dark,light} verbatim → polaris-dark
       / polaris-light registry + MCP-mirror entries.
     • _gen_system.mjs (F4) reads ds/dsShort/tokenProfile for the 100 facets.

   Visual language: calm commerce-admin UI — crisp neutral surfaces, a single
   confident action green, restrained semantic hues, roomy 8px geometry. 100%
   offline: NO external fonts — Polaris's Inter-like sans is approximated with a
   system stack. Facets reference only the GLOBAL tokens below (var(--accent) …),
   never raw hex, so they re-skin with the active theme and pass the token gate. */
export default {
  ds: 'Shopify Polaris',
  dsShort: 'polaris',
  homeUrl: 'https://polaris.shopify.com/',
  ticket: 'JFH-45',
  accent: '#008060',            // Polaris action green — the brand primary (advisory; palette wins)

  palette: {
    // Light: Polaris "surface" #f6f6f7 ground, white panels/cards, Swan-grey
    // hairline #e1e3e5, near-black ink #202223. The action green stays the
    // accent in both roles; semantic hues use Polaris's own blue/green/amber/red.
    light: {
      '--bg': '#f6f6f7', '--panel': '#ffffff', '--panel2': '#fafbfb', '--card': '#ffffff', '--line': '#e1e3e5',
      '--ink': '#202223', '--muted': '#6d7175', '--dim': '#8c9196',              // ink / subdued / disabled
      '--accent': '#008060', '--accent-rgb': '0,128,96', '--accent2': '#008060', // action green (both roles)
      '--info': '#2c6ecb', '--info-rgb': '44,110,203',                           // Polaris interactive blue
      '--pos': '#007f5f', '--pos-rgb': '0,127,95',                               // success green
      // contrast: --warn #b98900 -> #916a00; warn/panel 3.16 -> 4.92:1 (floor 4.5), #fff/warn 3.16 -> 4.92:1 (floor 4.5); Polaris text-warning
      '--warn': '#916a00', '--warn-rgb': '145,106,0',                            // warning amber (readable hue of #ffc453)
      '--neg': '#d72c0d', '--neg-rgb': '215,44,13',                              // critical / danger red
      '--crit': '#bf0711', '--crit-rgb': '191,7,17',                             // deeper critical red
      '--cardgrad': 'linear-gradient(157deg,rgba(0,128,96,.06),rgba(0,128,96,0) 55%)',
      // font, feel and top-bar tokens as shipped in Prism.html POLARIS_LIGHT_CSS (2026-10 drift
      // fix: they were hand-added to Prism.html and themes.js and never lived here)
      '--elev-1': '0 1px 3px rgba(0,0,0,.08)',
      '--elev-2': '0 4px 16px rgba(0,0,0,.12)',
      '--dur': '.2s',
      '--ease': 'cubic-bezier(.25,.8,.25,1)',
      '--head-w': '600',
      '--cs-topnav-bg': '#1a1c1d',
      '--cs-topnav-line': '#3f4246',
      '--cs-topnav-ink': '#e3e5e7',
      '--cs-topnav-dim': '#b5bcc2',
      '--cs-topnav-hover': 'rgba(255,255,255,.08)',
      // on-fill inks (new; same #fff the generator painted before): 4.92-6.45:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#ffffff',
      '--info-ink': '#ffffff',
      '--pos-ink': '#ffffff',
      '--warn-ink': '#ffffff',
      '--neg-ink': '#ffffff',
      '--crit-ink': '#ffffff',
    },
    // Dark: Polaris dark surfaces — #0b0c0d ground, #202223 panels, #3f4246
    // border, light ink #e3e5e7. Accent green is held per brand; semantic hues
    // are brightened to hold contrast on the dark ground.
    dark: {
      '--bg': '#0b0c0d', '--panel': '#202223', '--panel2': '#1a1c1d', '--card': '#202223', '--line': '#3f4246',
      '--ink': '#e3e5e7', '--muted': '#999fa4', '--dim': '#71767a',
      // contrast: --accent #008060 -> #309978; accent/panel 3.24 -> 4.53:1 (floor 4.5); Polaris green lightened on its own hue for dark surfaces
      '--accent': '#309978', '--accent-rgb': '48,153,120', '--accent2': '#008060', // action green (both roles)
      '--info': '#4b9bff', '--info-rgb': '75,155,255',                           // brightened interactive blue
      '--pos': '#4ade80', '--pos-rgb': '74,222,128',                             // brightened success green
      '--warn': '#e6b800', '--warn-rgb': '230,184,0',                            // brightened warning amber
      '--neg': '#ff6b52', '--neg-rgb': '255,107,82',                             // brightened danger red
      '--crit': '#ff5470', '--crit-rgb': '255,84,112',                           // brightened critical red/magenta
      '--cardgrad': 'linear-gradient(157deg,rgba(0,128,96,.08),rgba(0,128,96,0) 55%)',
      // font, feel and top-bar tokens as shipped in Prism.html POLARIS_DARK_CSS (2026-10 drift
      // fix: they were hand-added to Prism.html and themes.js and never lived here)
      '--elev-1': '0 1px 3px rgba(0,0,0,.5)',
      '--elev-2': '0 4px 16px rgba(0,0,0,.55)',
      '--dur': '.2s',
      '--ease': 'cubic-bezier(.25,.8,.25,1)',
      '--head-w': '600',
      '--cs-topnav-bg': '#1a1c1d',
      '--cs-topnav-line': '#3f4246',
      '--cs-topnav-ink': '#e3e5e7',
      '--cs-topnav-dim': '#999fa4',
      '--cs-topnav-hover': 'rgba(255,255,255,.08)',
      // on-fill inks (new; the generator painted literal #fff on these fills): #fff 1.74-3.53:1 -> ink 5.55-11.24:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#0b0c0d',
      '--info-ink': '#0b0c0d',
      '--pos-ink': '#0b0c0d',
      '--warn-ink': '#0b0c0d',
      '--neg-ink': '#0b0c0d',
      '--crit-ink': '#0b0c0d',
    },
  },

  // Structural tokens for the F4 facet generator (become .polaris-root custom
  // props). Roomy 8px corners + an Inter-like system sans stack (no webfonts).
  tokenProfile: {
    radius: '8px',   // -> --polaris-radius : Polaris's soft 8px corner radius
    font: '-apple-system, "Segoe UI", system-ui, Roboto, Helvetica, Arial, sans-serif', // -> --polaris-font (offline Inter-like sans)
  },
};
