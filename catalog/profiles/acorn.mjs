/* Firefox Design System (Acorn) theme-pack profile (JFH-25) — Phase-2 design system.
   ----------------------------------------------------------------------------
   Palette values are lifted from Mozilla's Acorn / Photon color tokens: the
   in-content surfaces (dark #1C1B22 / light #F9F9FB grounds, toolbar panels),
   the neutral text + border scale, and the Photon semantic roles. The brand
   primary is Firefox orange (orange-50 #FF7139) per the ticket — used as
   --accent in BOTH modes so the pack reads unmistakably "Firefox". The
   information/interactive role is Firefox blue (blue-50 dark / blue-60 light),
   the authentic action color. Motion uses Photon's signature easing curve
   cubic-bezier(.07,.95,0,1).

   Feeds BOTH tools off one file:
     • _scaffold_ds.mjs (F6) reads palette.{dark,light} verbatim → acorn-dark /
       acorn-light registry + MCP-mirror entries (the full 34-token identity —
       surfaces/text/brand/status/cardgrad + feel + topnav — flows into the
       :root const; --font + the radius scale come from tokenProfile).
     • _gen_system.mjs (F4) reads ds/dsShort/tokenProfile for the 100 facets.

   Visual language: modern, friendly-but-crisp; Inter type, modest 8px corners,
   soft elevation, Photon easing. 100% offline: Inter is a BUNDLED webfont
   (shared with Ant Design), and facets reference only the GLOBAL tokens
   (var(--accent) …), never raw hex, so they re-skin with the active theme and
   pass the token-only gate. */
export default {
  ds: 'Firefox Acorn',
  dsShort: 'acorn',
  homeUrl: 'https://acorn.firefox.com/',
  ticket: 'JFH-25',
  accent: '#FF7139',            // orange-50 — Firefox brand primary (advisory; palette wins)

  palette: {
    // Light: in-content #F9F9FB ground, #FFFFFF panels, Photon neutral border +
    // text scale, light-mode semantic roles, and a LIGHT toolbar (Firefox's light
    // theme keeps a light chrome with dark text — unlike GitHub's dark header).
    light: {
      '--bg': '#f9f9fb', '--panel': '#ffffff', '--panel2': '#f0f0f4', '--card': '#ffffff', '--line': '#cfcfd8',
      // control boundary of inputs, checkboxes, radios, switches: --line's hue moved to 3:1 on bg/panel/panel2/card (WCAG 1.4.11)
      '--control-line': '#8b8a93',
      '--ink': '#15141a', '--muted': '#5b5b66', '--dim': '#8f8f9d',                  // fg / fg-muted / fg-subtle
      // contrast: --accent #ff7139 -> #cc3d00; accent/panel 2.74 -> 4.96:1 (floor 4.5), accent/bg 2.60 -> 4.72:1 (floor 3), #fff/accent 2.74 -> 4.96:1 (floor 4.5); Photon orange-70 (orange-60 #e25920 is 3.7:1)
      '--accent': '#cc3d00', '--accent-rgb': '204,61,0', '--accent2': '#ff7139',    // orange-50 (brand)
      '--info': '#0060df', '--info-rgb': '0,96,223',                                 // blue-60 (interactive)
      '--pos': '#017a5a', '--pos-rgb': '1,122,90',                                   // green-70 (success)
      // contrast: --warn #a47f00 -> #937101; warn/panel 3.74 -> 4.56:1 (floor 4.5), #fff/warn 3.74 -> 4.56:1 (floor 4.5); yellow-70 darkened on its own hue; yellow-80 #715100 overshoots
      '--warn': '#937101', '--warn-rgb': '147,113,1',                                // yellow-70 (attention)
      '--neg': '#d70022', '--neg-rgb': '215,0,34',                                   // red-60 (danger)
      '--crit': '#8000d7', '--crit-rgb': '128,0,215',                                // purple-60 (critical)
      '--cardgrad': 'linear-gradient(157deg,rgba(255,113,57,.06),rgba(255,113,57,0) 55%)',
      // feel — soft Photon elevation, Photon easing curve, semibold heads
      '--elev-1': '0 1px 4px rgba(28,27,34,.08)', '--elev-2': '0 8px 24px rgba(28,27,34,.12)',
      '--dur': '.15s', '--ease': 'cubic-bezier(.07,.95,0,1)', '--bd': '1px', '--head-w': '600', '--dens': '1',
      // topnav chrome — light Firefox toolbar with dark ink
      '--cs-topnav-bg': '#f0f0f4', '--cs-topnav-line': '#cfcfd8', '--cs-topnav-ink': '#15141a',
      '--cs-topnav-dim': '#5b5b66', '--cs-topnav-hover': 'rgba(0,0,0,.06)',
      // on-fill inks (new; same #fff the generator painted before): 4.56-7.24:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#ffffff',
      '--info-ink': '#ffffff',
      '--pos-ink': '#ffffff',
      '--warn-ink': '#ffffff',
      '--neg-ink': '#ffffff',
      '--crit-ink': '#ffffff',
    },
    // Dark: in-content #1C1B22 ground, #2B2A33 toolbar panels, Photon dark border +
    // text scale, brighter dark-mode semantic roles, and a dark Firefox toolbar.
    dark: {
      '--bg': '#1c1b22', '--panel': '#2b2a33', '--panel2': '#42414d', '--card': '#2b2a33', '--line': '#52525e',
      // control boundary of inputs, checkboxes, radios, switches: --line's hue moved to 3:1 on bg/panel/panel2/card (WCAG 1.4.11)
      '--control-line': '#8b8c99',
      '--ink': '#fbfbfe', '--muted': '#bfbfc9', '--dim': '#8f8f9d',                  // fg / fg-muted / fg-subtle
      '--accent': '#ff7139', '--accent-rgb': '255,113,57', '--accent2': '#ff7139',    // orange-50 (brand)
      // contrast: --info #0a84ff -> #45a1ff; info/panel 3.89 -> 5.26:1 (floor 4.5); Photon blue-40
      '--info': '#45a1ff', '--info-rgb': '69,161,255',                               // blue-50 (interactive, dark)
      '--pos': '#2ac3a2', '--pos-rgb': '42,195,162',                                 // teal-green (success, dark)
      '--warn': '#ffbd4f', '--warn-rgb': '255,189,79',                               // amber (attention, dark)
      '--neg': '#ff6a75', '--neg-rgb': '255,106,117',                                // red (danger, dark)
      '--crit': '#c069ff', '--crit-rgb': '192,105,255',                              // purple (critical, dark)
      '--cardgrad': 'linear-gradient(157deg,rgba(255,113,57,.08),rgba(255,113,57,0) 55%)',
      // feel — soft Photon elevation on dark, Photon easing curve, semibold heads
      '--elev-1': '0 1px 4px rgba(0,0,0,.4)', '--elev-2': '0 8px 24px rgba(0,0,0,.5)',
      '--dur': '.15s', '--ease': 'cubic-bezier(.07,.95,0,1)', '--bd': '1px', '--head-w': '600', '--dens': '1',
      // topnav chrome — dark Firefox toolbar
      '--cs-topnav-bg': '#2b2a33', '--cs-topnav-line': '#52525e', '--cs-topnav-ink': '#fbfbfe',
      '--cs-topnav-dim': '#bfbfc9', '--cs-topnav-hover': 'rgba(255,255,255,.08)',
      // on-fill inks (new; the generator painted literal #fff on these fills): #fff 1.66-3.13:1 -> ink 5.46-10.29:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#1c1b22',
      '--info-ink': '#1c1b22',
      '--pos-ink': '#1c1b22',
      '--warn-ink': '#1c1b22',
      '--neg-ink': '#1c1b22',
      '--crit-ink': '#1c1b22',
    },
  },

  // Structural tokens for the F4 facet generator (become .acorn-root custom
  // props) and the shell chrome radius scale. Firefox's modest 8px corners +
  // Inter (a BUNDLED webfont — fully offline, shared with Ant Design).
  tokenProfile: {
    radius: '8px',   // -> --r-sm 4 / --r-md 8 / --r-lg 12 / --r-xl 16 (Firefox's crisp, modestly-rounded corners)
    font: 'Inter, -apple-system, "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif', // -> --acorn-font (bundled, offline)
  },
};
