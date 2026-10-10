/* Monzo theme-pack profile (JFH-70) — Phase-2 design system.
   ----------------------------------------------------------------------------
   Brand-inspired (Monzo's public identity, not an official component library):
   the well-known fintech look — signature Hot Coral on deep near-black navy,
   confident geometric sans, generous rounded cards. Component tokens are
   approximated, not lifted from an internal design system.

   Feeds BOTH tools off one file:
     • _scaffold_ds.mjs (F6) reads palette.{dark,light} verbatim → monzo-dark /
       monzo-light registry + MCP-mirror entries.
     • _gen_system.mjs (F4) reads ds/dsShort/tokenProfile for the 100 facets.

   Visual language: dark-first — deep charcoal/navy surfaces with Hot Coral
   popping on top; a light mode on clean white with Monzo navy ink. 100%
   offline: NO external fonts — the brand's geometric sans is approximated with
   a system-font stack. Facets reference only the GLOBAL tokens below
   (var(--accent) …), never raw hex, so they re-skin with the active theme and
   pass the token-only gate. */
export default {
  ds: 'Monzo',
  dsShort: 'monzo',
  homeUrl: 'https://monzo.com/',
  ticket: 'JFH-70',
  accent: '#ff4f40',            // Hot Coral — the brand primary (advisory; palette wins)

  palette: {
    // Light: clean white paper, Monzo navy ink, Hot Coral accent. Semantic roles
    // use brand-adjacent hues (Monzo teal, a fresh green, warm amber, coral-red,
    // a distinct critical purple) so the generated facet variants read as a
    // real system.
    light: {
      '--bg': '#fafbfc', '--panel': '#ffffff', '--panel2': '#f2f4f8', '--card': '#ffffff', '--line': '#e6e9ef',
      // contrast: --dim #9aa2b1 -> #8c94a3; dim/panel 2.57 -> 3.05:1 (floor 3), dim/card 2.57 -> 3.05:1 (floor 3)
      '--ink': '#14233c', '--muted': '#6b7385', '--dim': '#8c94a3',          // Monzo navy ink family
      // contrast: --accent #ff4f40 -> #e12e24; accent/panel 3.26 -> 4.55:1 (floor 4.5), #fff/accent 3.26 -> 4.55:1 (floor 4.5); Hot Coral darkened on its own hue
      '--accent': '#e12e24', '--accent-rgb': '225,46,36', '--accent2': '#ff4f40',   // Hot Coral
      // contrast: --info #00a4b3 -> #03828e; info/panel 3.02 -> 4.58:1 (floor 4.5), #fff/info 3.02 -> 4.58:1 (floor 4.5)
      '--info': '#03828e', '--info-rgb': '3,130,142',                        // Monzo teal
      // contrast: --pos #52b03a -> #2a8804; pos/panel 2.75 -> 4.54:1 (floor 4.5), #fff/pos 2.75 -> 4.54:1 (floor 4.5)
      '--pos': '#2a8804', '--pos-rgb': '42,136,4',                          // fresh green
      // contrast: --warn #ffb74a -> #a26b01; warn/panel 1.73 -> 4.53:1 (floor 4.5), #fff/warn 1.73 -> 4.53:1 (floor 4.5)
      '--warn': '#a26b01', '--warn-rgb': '162,107,1',                       // warm amber
      // contrast: --neg #e5484d -> #d83b43; neg/panel 3.91 -> 4.54:1 (floor 4.5), #fff/neg 3.91 -> 4.54:1 (floor 4.5)
      '--neg': '#d83b43', '--neg-rgb': '216,59,67',                          // coral-adjacent red
      '--crit': '#9d4edd', '--crit-rgb': '157,78,221',                       // critical purple
      '--cardgrad': 'linear-gradient(157deg,rgba(255,79,64,.06),rgba(255,79,64,0) 55%)',
      // font, feel and top-bar tokens as shipped in Prism.html MONZO_LIGHT_CSS (2026-10 drift
      // fix: they were hand-added to Prism.html and themes.js and never lived here)
      '--font': 'Manrope, "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif',
      '--elev-1': '0 2px 10px rgba(20,35,60,.08)',
      '--elev-2': '0 10px 30px rgba(20,35,60,.14)',
      '--dur': '.22s',
      '--ease': 'cubic-bezier(.4,0,.2,1)',
      '--dens': '1.1',
      '--cs-topnav-bg': '#ffffff',
      '--cs-topnav-line': '#e6e9ef',
      '--cs-topnav-ink': '#14233c',
      '--cs-topnav-dim': '#6b7385',
      '--cs-topnav-hover': 'rgba(0,0,0,.04)',
      '--cs-topnav-elev': '0 1px 0 rgba(20,35,60,.06)',
      // on-fill inks (new; same #fff the generator painted before): 4.53-4.60:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#ffffff',
      '--info-ink': '#ffffff',
      '--pos-ink': '#ffffff',
      '--warn-ink': '#ffffff',
      '--neg-ink': '#ffffff',
      '--crit-ink': '#ffffff',
    },
    // Dark: Monzo's signature deep near-black navy/charcoal surfaces (the brand
    // ground) with Hot Coral popping on top; semantic hues brightened for the
    // dark surface.
    dark: {
      '--bg': '#06060a', '--panel': '#14161c', '--panel2': '#1c1f27', '--card': '#14161c', '--line': '#2a2e38',
      '--ink': '#f4f5f7', '--muted': '#a2a7b3', '--dim': '#6b7280',
      '--accent': '#ff4f40', '--accent-rgb': '255,79,64', '--accent2': '#ff4f40',   // Hot Coral
      '--info': '#1fc7d6', '--info-rgb': '31,199,214',                       // brightened teal on dark
      '--pos': '#6cc551', '--pos-rgb': '108,197,81',
      '--warn': '#ffc266', '--warn-rgb': '255,194,102',
      '--neg': '#f2555a', '--neg-rgb': '242,85,90',
      '--crit': '#b46ce6', '--crit-rgb': '180,108,230',
      '--cardgrad': 'linear-gradient(157deg,rgba(255,79,64,.08),rgba(255,79,64,0) 55%)',
      // font, feel and top-bar tokens as shipped in Prism.html MONZO_DARK_CSS (2026-10 drift
      // fix: they were hand-added to Prism.html and themes.js and never lived here)
      '--font': 'Manrope, "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif',
      '--elev-1': '0 2px 10px rgba(0,0,0,.5)',
      '--elev-2': '0 8px 28px rgba(0,0,0,.6)',
      '--dur': '.22s',
      '--ease': 'cubic-bezier(.4,0,.2,1)',
      '--dens': '1.1',
      '--cs-topnav-bg': '#14161c',
      '--cs-topnav-line': '#2a2e38',
      '--cs-topnav-ink': '#f4f5f7',
      '--cs-topnav-dim': '#a2a7b3',
      '--cs-topnav-hover': 'rgba(255,255,255,.08)',
      // on-fill inks (new; the generator painted literal #fff on these fills): #fff 1.60-3.37:1 -> ink 5.99-12.68:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#06060a',
      '--info-ink': '#06060a',
      '--pos-ink': '#06060a',
      '--warn-ink': '#06060a',
      '--neg-ink': '#06060a',
      '--crit-ink': '#06060a',
    },
  },

  // Structural tokens for the F4 facet generator (become .monzo-root custom
  // props). Generous rounded corners + a geometric-sans system stack (no
  // webfonts) to echo Monzo's confident, friendly type.
  tokenProfile: {
    radius: '12px',   // -> --monzo-radius : Monzo's generous rounded corners
    font: '"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif', // -> --monzo-font (offline geometric-sans stack)
  },
};
