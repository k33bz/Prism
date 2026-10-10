/* Cloudflare Orange theme profile (k33bz fork, 2026-09-05).
   ----------------------------------------------------------------------------
   Cloudflare's dashboard language: orange #f6821f as the single brand accent on charcoal
   (dark) or white (light) surfaces, blue #0051c3 reserved for links/info, tight 4-12px
   radii, flat elevation, Inter-first type (system fallback; nothing fetched).

   palette.{dark,light} below are the SAME token blocks as the CLOUDFLARE_DARK_CSS /
   CLOUDFLARE_LIGHT_CSS consts in Prism.html's THEME_REGISTRY (generated from them by
   gen_profiles.mjs), so the F6 scaffolder's MCP mirror matches the shell exactly.
   Feeds: _scaffold_ds.mjs (F6, wiring) and _gen_system.mjs (F4, the 100 facets). */
export default {
  ds: 'Cloudflare Orange',
  dsShort: 'cloudflare',
  homeUrl: 'https://www.cloudflare.com',
  ticket: 'fork-themes-2026-09',
  accent: '#f6821f',
  palette: {
    light: {
      '--bg': '#f8f9fa',
      '--panel': '#ffffff',
      '--panel2': '#f3f4f6',
      '--card': '#ffffff',
      '--line': '#e0e3e8',
      // control boundary of inputs, checkboxes, radios, switches: --line's hue moved to 3:1 on bg/panel/panel2/card (WCAG 1.4.11)
      '--control-line': '#8b8d92',
      '--ink': '#1c1e24',
      '--muted': '#5b6270',
      '--dim': '#8a919e',
      // contrast: --accent #f6821f -> #b95d04; accent/panel 2.58 -> 4.54:1 (floor 4.5), accent/bg 2.45 -> 4.30:1 (floor 3), #fff/accent 2.58 -> 4.54:1 (floor 4.5); Cloudflare orange darkened on its own hue
      '--accent': '#b95d04',
      '--accent-rgb': '185,93,4',
      '--accent2': '#faad3f',
      '--info': '#0051c3',
      '--info-rgb': '0,81,195',
      // contrast: --pos #1f8a4c -> #1a8749; pos/panel 4.38 -> 4.56:1 (floor 4.5), #fff/pos 4.38 -> 4.56:1 (floor 4.5)
      '--pos': '#1a8749',
      '--pos-rgb': '26,135,73',
      // contrast: --warn #d18a00 -> #a26a03; warn/panel 2.86 -> 4.57:1 (floor 4.5), #fff/warn 2.86 -> 4.57:1 (floor 4.5)
      '--warn': '#a26a03',
      '--warn-rgb': '162,106,3',
      '--neg': '#c62828',
      '--neg-rgb': '198,40,40',
      '--crit': '#7c3aed',
      '--crit-rgb': '124,58,237',
      '--cardgrad': 'linear-gradient(157deg,rgba(246,130,31,.07),rgba(246,130,31,0) 55%)',
      '--font': 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif',
      '--r-sm': '4px',
      '--r-md': '6px',
      '--r-lg': '8px',
      '--r-xl': '12px',
      '--elev-1': '0 1px 2px rgba(20,30,50,.08)',
      '--elev-2': '0 6px 18px rgba(20,30,50,.12)',
      '--dur': '.15s',
      '--ease': 'cubic-bezier(.2,0,0,1)',
      '--bd': '1px',
      '--head-w': '700',
      '--dens': '1',
      '--cs-topnav-bg': '#ffffff',
      '--cs-topnav-line': '#e0e3e8',
      '--cs-topnav-ink': '#1c1e24',
      '--cs-topnav-dim': '#5b6270',
      '--cs-topnav-hover': 'rgba(246,130,31,.1)',
      // on-fill inks (new; same #fff the generator painted before): 4.54-7.08:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#ffffff',
      '--info-ink': '#ffffff',
      '--pos-ink': '#ffffff',
      '--warn-ink': '#ffffff',
      '--neg-ink': '#ffffff',
      '--crit-ink': '#ffffff',
    },
    dark: {
      '--bg': '#12141a',
      '--panel': '#1b1e26',
      '--panel2': '#161920',
      '--card': '#1b1e26',
      '--line': '#2b3040',
      // control boundary of inputs, checkboxes, radios, switches: --line's hue moved to 3:1 on bg/panel/panel2/card (WCAG 1.4.11)
      '--control-line': '#62687b',
      '--ink': '#f3f4f6',
      '--muted': '#a3a9b8',
      '--dim': '#6e7484',
      '--accent': '#f6821f',
      '--accent-rgb': '246,130,31',
      '--accent2': '#faad3f',
      '--info': '#3b82f6',
      '--info-rgb': '59,130,246',
      '--pos': '#46a46c',
      '--pos-rgb': '70,164,108',
      '--warn': '#e6b400',
      '--warn-rgb': '230,180,0',
      // contrast: --neg #d33f3f -> #e7524f; neg/panel 3.61 -> 4.54:1 (floor 4.5)
      '--neg': '#e7524f',
      '--neg-rgb': '231,82,79',
      // contrast: --crit #8b5cf6 -> #9469ff; crit/panel 3.94 -> 4.54:1 (floor 4.5)
      '--crit': '#9469ff',
      '--crit-rgb': '148,105,255',
      '--cardgrad': 'linear-gradient(157deg,rgba(246,130,31,.09),rgba(246,130,31,0) 55%)',
      '--font': 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif',
      '--r-sm': '4px',
      '--r-md': '6px',
      '--r-lg': '8px',
      '--r-xl': '12px',
      '--elev-1': '0 1px 2px rgba(0,0,0,.4)',
      '--elev-2': '0 6px 18px rgba(0,0,0,.45)',
      '--dur': '.15s',
      '--ease': 'cubic-bezier(.2,0,0,1)',
      '--bd': '1px',
      '--head-w': '700',
      '--dens': '1',
      '--cs-topnav-bg': '#1b1e26',
      '--cs-topnav-line': '#2b3040',
      '--cs-topnav-ink': '#f3f4f6',
      '--cs-topnav-dim': '#a3a9b8',
      '--cs-topnav-hover': 'rgba(246,130,31,.12)',
      // on-fill inks (new; the generator painted literal #fff on these fills): #fff 1.93-3.68:1 -> ink 5.01-9.55:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#12141a',
      '--info-ink': '#12141a',
      '--pos-ink': '#12141a',
      '--warn-ink': '#12141a',
      '--neg-ink': '#12141a',
      '--crit-ink': '#12141a',
    },
  },
  tokenProfile: {
    radius: '6px',
    font: 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif',
  },
};
