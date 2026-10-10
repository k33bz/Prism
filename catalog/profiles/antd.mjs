/* Ant Design theme-pack profile (JFH-46) — Phase-2 design system.
   ----------------------------------------------------------------------------
   Authentic Ant Design v5 seed/map tokens (not brand-inspired): the palette is
   lifted verbatim from AntD's default (light) and dark algorithm outputs — the
   per-mode primary is the real colorPrimary (#1677ff light / #1668dc dark), and
   the surface/border/text/semantic roles are the published colorBg / colorBorder
   / colorText / colorSuccess / colorWarning / colorError tokens.

   Feeds BOTH tools off one file:
     • _scaffold_ds.mjs (F6) reads palette.{dark,light} verbatim → antd-dark /
       antd-light registry + MCP-mirror entries.
     • _gen_system.mjs (F4) reads ds/dsShort/tokenProfile for the 100 facets.

   Visual language: calm, systematic enterprise UI — crisp 6px corners, neutral
   greys, a clear blue primary, six-role semantic scale. 100% offline: NO
   external fonts — AntD's default is already a system font stack. Facets
   reference only the GLOBAL tokens below (var(--accent) …), never raw hex, so
   they re-skin with the active theme and pass the token-only gate. */
export default {
  ds: 'Ant Design',
  dsShort: 'antd',
  homeUrl: 'https://ant.design/',
  ticket: 'JFH-46',
  accent: '#1677ff',            // colorPrimary (light) — the brand primary (advisory; palette wins)

  palette: {
    // Light — AntD v5 default algorithm. Surfaces: colorBgLayout / colorBgContainer
    // / colorBgElevated; colorBorder hairline; text steps at 88% / 65% / 45%.
    light: {
      '--bg': '#f5f5f5', '--panel': '#ffffff', '--panel2': '#fafafa', '--card': '#ffffff', '--line': '#d9d9d9',
      '--ink': '#141414', '--muted': '#595959', '--dim': '#8c8c8c',        // colorText / colorTextSecondary / colorTextTertiary
      // contrast: --accent #1677ff -> #0958d9; accent/panel 4.10 -> 6.16:1 (floor 4.5), #fff/accent 4.10 -> 6.16:1 (floor 4.5); antd blue-7 (colorPrimaryActive)
      '--accent': '#0958d9', '--accent-rgb': '9,88,217', '--accent2': '#1677ff',  // colorPrimary (blue-6)
      // contrast: --info #1677ff -> #0958d9; info/panel 4.10 -> 6.16:1 (floor 4.5), #fff/info 4.10 -> 6.16:1 (floor 4.5); antd blue-7
      '--info': '#0958d9', '--info-rgb': '9,88,217',                     // colorInfo
      // contrast: --pos #52c41a -> #237804; pos/panel 2.27 -> 5.59:1 (floor 4.5), #fff/pos 2.27 -> 5.59:1 (floor 4.5); antd green-8 (green-7 #389e0d is 3.5:1)
      '--pos': '#237804', '--pos-rgb': '35,120,4',                        // colorSuccess (green-6)
      // contrast: --warn #faad14 -> #9f6c03; warn/panel 1.90 -> 4.54:1 (floor 4.5), #fff/warn 1.90 -> 4.54:1 (floor 4.5); gold darkened on its own hue; gold-8 #ad6800 is 4.4:1, gold-9 overshoots
      '--warn': '#9f6c03', '--warn-rgb': '159,108,3',                     // colorWarning (gold-6)
      // contrast: --neg #ff4d4f -> #d9363e; neg/panel 3.27 -> 4.62:1 (floor 4.5), #fff/neg 3.27 -> 4.62:1 (floor 4.5); antd colorErrorActive
      '--neg': '#d9363e', '--neg-rgb': '217,54,62',                        // colorError (red-5)
      // contrast: --crit #eb2f96 -> #c41d7f; crit/panel 3.90 -> 5.48:1 (floor 4.5), #fff/crit 3.90 -> 5.48:1 (floor 4.5); antd magenta-7
      '--crit': '#c41d7f', '--crit-rgb': '196,29,127',                     // magenta-6 (highest-severity)
      '--cardgrad': 'linear-gradient(157deg,rgba(22,119,255,.06),rgba(22,119,255,0) 55%)',
      // font, feel and top-bar tokens as shipped in Prism.html ANTD_LIGHT_CSS (2026-10 drift
      // fix: they were hand-added to Prism.html and themes.js and never lived here)
      '--font': 'Inter, -apple-system, "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif',
      '--elev-1': '0 1px 2px 0 rgba(0,0,0,.03),0 1px 6px -1px rgba(0,0,0,.02),0 2px 4px 0 rgba(0,0,0,.02)',
      '--elev-2': '0 6px 16px 0 rgba(0,0,0,.08)',
      '--dur': '.2s',
      '--ease': 'cubic-bezier(.34,.69,.1,1)',
      '--head-w': '600',
      '--cs-topnav-bg': '#001529',
      '--cs-topnav-line': '#002140',
      '--cs-topnav-ink': '#ffffff',
      '--cs-topnav-dim': 'rgba(255,255,255,.65)',
      '--cs-topnav-hover': 'rgba(255,255,255,.08)',
      // on-fill inks (new; same #fff the generator painted before): 4.54-6.16:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#ffffff',
      '--info-ink': '#ffffff',
      '--pos-ink': '#ffffff',
      '--warn-ink': '#ffffff',
      '--neg-ink': '#ffffff',
      '--crit-ink': '#ffffff',
    },
    // Dark — AntD v5 dark algorithm. Surfaces darken to #141414 → #1f1f1f → #262626,
    // border #424242, text rgba(255,255,255,.85) plus its muted/dim steps.
    dark: {
      '--bg': '#141414', '--panel': '#1f1f1f', '--panel2': '#262626', '--card': '#1f1f1f', '--line': '#424242',
      '--ink': '#e6e6e6', '--muted': '#a6a6a6', '--dim': '#737373',        // colorText / colorTextSecondary / colorTextTertiary
      // contrast: --accent #1668dc -> #3c89e8; accent/panel 3.18 -> 4.66:1 (floor 4.5); antd dark-algorithm blue-7
      '--accent': '#3c89e8', '--accent-rgb': '60,137,232', '--accent2': '#1668dc',  // colorPrimary (dark blue-6)
      // contrast: --info #1668dc -> #3c89e8; info/panel 3.18 -> 4.66:1 (floor 4.5); antd dark-algorithm blue-7
      '--info': '#3c89e8', '--info-rgb': '60,137,232',                     // colorInfo
      '--pos': '#49aa19', '--pos-rgb': '73,170,25',                        // colorSuccess (dark green)
      '--warn': '#d89614', '--warn-rgb': '216,150,20',                     // colorWarning (dark gold)
      // contrast: --neg #dc4446 -> #e86e6b; neg/panel 3.89 -> 5.40:1 (floor 4.5); antd dark colorErrorHover
      '--neg': '#e86e6b', '--neg-rgb': '232,110,107',                        // colorError (dark red)
      // contrast: --crit #cb2b83 -> #e0529c; crit/panel 3.31 -> 4.60:1 (floor 4.5); antd dark-algorithm magenta-7
      '--crit': '#e0529c', '--crit-rgb': '224,82,156',                     // dark magenta (highest-severity)
      '--cardgrad': 'linear-gradient(157deg,rgba(22,104,220,.08),rgba(22,104,220,0) 55%)',
      // font, feel and top-bar tokens as shipped in Prism.html ANTD_DARK_CSS (2026-10 drift
      // fix: they were hand-added to Prism.html and themes.js and never lived here)
      '--font': 'Inter, -apple-system, "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif',
      '--elev-1': '0 1px 2px -2px rgba(0,0,0,.5),0 3px 6px 0 rgba(0,0,0,.4),0 5px 12px 4px rgba(0,0,0,.3)',
      '--elev-2': '0 6px 16px 0 rgba(0,0,0,.5)',
      '--dur': '.2s',
      '--ease': 'cubic-bezier(.34,.69,.1,1)',
      '--head-w': '600',
      '--cs-topnav-bg': '#001529',
      '--cs-topnav-line': '#1f3a5f',
      '--cs-topnav-ink': '#ffffff',
      '--cs-topnav-dim': 'rgba(255,255,255,.65)',
      '--cs-topnav-hover': 'rgba(255,255,255,.08)',
      // on-fill inks (new; the generator painted literal #fff on these fills): #fff 2.53-3.59:1 -> ink 5.14-7.27:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#141414',
      '--info-ink': '#141414',
      '--pos-ink': '#141414',
      '--warn-ink': '#141414',
      '--neg-ink': '#141414',
      '--crit-ink': '#141414',
    },
  },

  // Structural tokens for the F4 facet generator (become .antd-root custom
  // props). AntD's default borderRadius + its system-based default font stack
  // (no webfonts).
  tokenProfile: {
    radius: '6px',   // -> --antd-radius : AntD v5 borderRadius
    font: '-apple-system, "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif', // -> --antd-font (offline system stack)
  },
};
