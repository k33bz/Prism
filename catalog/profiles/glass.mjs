/* Liquid Glass theme profile (k33bz fork, 2026-09-05).
   ----------------------------------------------------------------------------
   Translucent, refractive surfaces: panel / card / line tokens are rgba() so the
   ground shows through, iOS system palette for roles, very round corners, soft
   long-duration easing. Skin-only for now: the facet family is pending. NOTE the rgba
   surface tokens are unique to this skin; check opaque-surface assumptions before
   promoting it to a full pack.

   palette.{dark,light} below are the SAME token blocks as the GLASS_DARK_CSS /
   GLASS_LIGHT_CSS consts in Prism.html's THEME_REGISTRY (generated from them by
   gen_profiles.mjs), so the F6 scaffolder's MCP mirror matches the shell exactly.
   Feeds: _scaffold_ds.mjs (F6, wiring) and _gen_system.mjs (F4, the 100 facets). */
export default {
  ds: 'Liquid Glass',
  dsShort: 'glass',
  homeUrl: 'https://developer.apple.com/design/',
  ticket: 'fork-themes-2026-09',
  skin: true,                   // shell skin only: no facet family, so the scaffolder does not register it in systems.json
  accent: '#0a84ff',
  palette: {
    light: {
      '--bg': '#eef0f5',
      '--panel': 'rgba(255,255,255,.72)',
      '--panel2': 'rgba(255,255,255,.55)',
      '--card': 'rgba(255,255,255,.82)',
      '--line': 'rgba(0,0,0,.08)',
      // control boundary of inputs, checkboxes, radios, switches: --line's hue moved to 3:1 on bg/panel/panel2/card (WCAG 1.4.11)
      '--control-line': '#898a8e',
      '--ink': '#1c1c1e',
      // contrast: --muted #6e6e73 -> #6d6d72; muted/bg 4.45 -> 4.51:1 (floor 4.5); held on --bg and --panel2 as well
      '--muted': '#6d6d72',
      // contrast: --dim #aeaeb2 -> #8e8e93; dim/panel 2.13 -> 3.15:1 (floor 3), dim/card 2.16 -> 3.18:1 (floor 3); Apple systemGray
      // contrast: --dim #8e8e93 -> #8a8a8f; dim/bg 2.86 -> 3.01:1 (floor 3); held on --bg and --panel2 as well
      '--dim': '#8a8a8f',
      // contrast: --accent #007aff -> #016fea; accent/panel 3.88 -> 4.54:1 (floor 4.5), #fff/accent 4.02 -> 4.71:1 (floor 4.5); systemBlue darkened on its own hue; the high-contrast #0040dd overshoots
      '--accent': '#016fea',
      '--accent-rgb': '1,111,234',
      '--accent2': '#5ac8fa',
      // contrast: --info #32ade6 -> #037cab; info/panel 2.46 -> 4.53:1 (floor 4.5), #fff/info 2.54 -> 4.69:1 (floor 4.5)
      '--info': '#037cab',
      '--info-rgb': '3,124,171',
      // contrast: --pos #34c759 -> #018631; pos/panel 2.14 -> 4.55:1 (floor 4.5), #fff/pos 2.22 -> 4.71:1 (floor 4.5); the high-contrast systemGreen #248a3d is 4.2:1 on this panel
      '--pos': '#018631',
      '--pos-rgb': '1,134,49',
      // contrast: --warn #ff9f0a -> #a66500; warn/panel 1.98 -> 4.52:1 (floor 4.5), #fff/warn 2.06 -> 4.68:1 (floor 4.5)
      '--warn': '#a66500',
      '--warn-rgb': '166,101,0',
      // contrast: --neg #ff3b30 -> #d70015; neg/panel 3.42 -> 5.20:1 (floor 4.5), #fff/neg 3.55 -> 5.38:1 (floor 4.5); Apple high-contrast systemRed
      '--neg': '#d70015',
      '--neg-rgb': '215,0,21',
      // contrast: --crit #af52de -> #8944ab; crit/panel 3.99 -> 5.83:1 (floor 4.5), #fff/crit 4.13 -> 6.04:1 (floor 4.5); Apple high-contrast systemPurple
      '--crit': '#8944ab',
      '--crit-rgb': '137,68,171',
      '--cardgrad': 'linear-gradient(135deg,rgba(255,255,255,.9),rgba(255,255,255,.35) 60%)',
      '--font': '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
      '--r-sm': '14px',
      '--r-md': '22px',
      '--r-lg': '28px',
      '--r-xl': '36px',
      '--elev-1': '0 10px 30px rgba(30,40,60,.12),inset 0 1px 0 rgba(255,255,255,.9)',
      '--elev-2': '0 20px 50px rgba(30,40,60,.18),inset 0 1px 0 rgba(255,255,255,1)',
      '--dur': '.3s',
      '--ease': 'cubic-bezier(.2,.8,.2,1)',
      '--bd': '1px',
      '--head-w': '600',
      '--dens': '1.05',
      '--cs-topnav-bg': 'rgba(242,242,247,.8)',
      '--cs-topnav-line': 'rgba(0,0,0,.08)',
      '--cs-topnav-ink': '#1c1c1e',
      '--cs-topnav-dim': '#6e6e73',
      '--cs-topnav-hover': 'rgba(0,0,0,.05)',
      // on-fill inks (new; same #fff the generator painted before): 4.68-6.04:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#ffffff',
      '--info-ink': '#ffffff',
      '--pos-ink': '#ffffff',
      '--warn-ink': '#ffffff',
      '--neg-ink': '#ffffff',
      '--crit-ink': '#ffffff',
    },
    dark: {
      '--bg': '#0a0a0f',
      '--panel': 'rgba(255,255,255,.06)',
      '--panel2': 'rgba(255,255,255,.04)',
      '--card': 'rgba(255,255,255,.07)',
      '--line': 'rgba(255,255,255,.14)',
      // control boundary of inputs, checkboxes, radios, switches: --line's hue moved to 3:1 on bg/panel/panel2/card (WCAG 1.4.11)
      '--control-line': '#717277',
      '--ink': '#f5f5f7',
      '--muted': '#a1a1aa',
      '--dim': '#6b6b76',
      '--accent': '#0a84ff',
      '--accent-rgb': '10,132,255',
      '--accent2': '#5ac8fa',
      '--info': '#64d2ff',
      '--info-rgb': '100,210,255',
      '--pos': '#30d158',
      '--pos-rgb': '48,209,88',
      '--warn': '#ffd60a',
      '--warn-rgb': '255,214,10',
      '--neg': '#ff453a',
      '--neg-rgb': '255,69,58',
      '--crit': '#bf5af2',
      '--crit-rgb': '191,90,242',
      '--cardgrad': 'linear-gradient(135deg,rgba(255,255,255,.16),rgba(255,255,255,.03) 60%)',
      '--font': '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
      '--r-sm': '14px',
      '--r-md': '22px',
      '--r-lg': '28px',
      '--r-xl': '36px',
      '--elev-1': '0 10px 30px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.22)',
      '--elev-2': '0 20px 50px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.3)',
      '--dur': '.3s',
      '--ease': 'cubic-bezier(.2,.8,.2,1)',
      '--bd': '1px',
      '--head-w': '600',
      '--dens': '1.05',
      '--cs-topnav-bg': 'rgba(20,20,26,.72)',
      '--cs-topnav-line': 'rgba(255,255,255,.12)',
      '--cs-topnav-ink': '#f5f5f7',
      '--cs-topnav-dim': '#a1a1aa',
      '--cs-topnav-hover': 'rgba(255,255,255,.12)',
      // on-fill inks (new; the generator painted literal #fff on these fills): #fff 1.41-3.65:1 -> ink 5.42-13.99:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#0a0a0f',
      '--info-ink': '#0a0a0f',
      '--pos-ink': '#0a0a0f',
      '--warn-ink': '#0a0a0f',
      '--neg-ink': '#0a0a0f',
      '--crit-ink': '#0a0a0f',
    },
  },
  tokenProfile: {
    radius: '22px',
    font: '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
  },
};
