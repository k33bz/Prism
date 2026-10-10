/* Mailchimp theme-pack profile (JFH-68) — Phase-2 design system.
   ----------------------------------------------------------------------------
   Brand-inspired (Mailchimp's public system is a Voice & Tone guide; this pack
   adopts the well-known BRAND identity — Cavendish yellow on Peppercorn near-
   black, quirky retro warmth, editorial display type). Component tokens are
   approximated, not lifted from an official component library.

   Feeds BOTH tools off one file:
     • _scaffold_ds.mjs (F6) reads palette.{dark,light} verbatim → mailchimp-dark
       / mailchimp-light registry + MCP-mirror entries.
     • _gen_system.mjs (F4) reads ds/dsShort/tokenProfile for the 100 facets.

   Visual language: signature Cavendish yellow, high-contrast on warm near-black,
   generous whitespace, characterful editorial headings, a dry human voice. 100%
   offline: NO external fonts — the brand's Cooper-style display face is
   approximated with a serif system stack. Facets reference only the GLOBAL
   tokens below (var(--accent) …), never raw hex, so they re-skin with the active
   theme and pass the token-only gate. */
export default {
  ds: 'Mailchimp',
  dsShort: 'mailchimp',
  homeUrl: 'https://styleguide.mailchimp.com/',
  ticket: 'JFH-68',
  accent: '#ffe01b',            // Cavendish Yellow — the brand primary (advisory; palette wins)

  palette: {
    // Light: warm off-white paper, Peppercorn ink and top bar. Pure #ffe01b is
    // illegible as text or under #fff on white, and the shell and facets paint
    // --accent as both (rail links, labels, button fills), so the light accent is
    // the deepest gold on Cavendish's hue that passes; the yellow stays in
    // --accent2 (gradient fills) and --cardgrad. Semantic roles use warm,
    // high-contrast brand-adjacent hues.
    light: {
      '--bg': '#fbf9f4', '--panel': '#ffffff', '--panel2': '#f6f2e9', '--card': '#ffffff', '--line': '#e6e0d3',
      // control boundary of inputs, checkboxes, radios, switches: --line's hue moved to 3:1 on bg/panel/panel2/card (WCAG 1.4.11)
      '--control-line': '#918b80',
      // contrast: --dim #a89f90 -> #9c9385; dim/panel 2.62 -> 3.03:1 (floor 3), dim/card 2.62 -> 3.03:1 (floor 3)
      // contrast: --dim #9c9385 -> #948b7e; dim/bg 2.88 -> 3.19:1 (floor 3), dim/panel2 2.71 -> 3.01:1 (floor 3); held on --bg and --panel2 as well
      '--ink': '#241c15', '--muted': '#6b6357', '--dim': '#948b7e',        // Peppercorn family
      // contrast: --accent #ffe01b -> #877605; accent/panel 1.32 -> 4.54:1 (floor 4.5), accent/bg 1.25 -> 4.32:1 (floor 3), #fff/accent 1.32 -> 4.54:1 (floor 4.5); Cavendish yellow cannot be text or carry #fff on white; deepest gold on the same hue that does (dark mode keeps #ffe01b)
      '--accent': '#877605', '--accent-rgb': '135,118,5', '--accent2': '#ffe01b',  // Cavendish gold / Cavendish Yellow
      '--info': '#007c89', '--info-rgb': '0,124,137',                       // Mailchimp teal
      // contrast: --pos #3caa3c -> #098914; pos/panel 3.00 -> 4.57:1 (floor 4.5), #fff/pos 3.00 -> 4.57:1 (floor 4.5)
      '--pos': '#098914', '--pos-rgb': '9,137,20',                         // warm green
      // contrast: --warn #ff9d1c -> #ab6600; warn/panel 2.08 -> 4.53:1 (floor 4.5), #fff/warn 2.08 -> 4.53:1 (floor 4.5); Squash darkened on its own hue
      '--warn': '#ab6600', '--warn-rgb': '171,102,0',                      // Squash orange
      // contrast: --neg #e0503f -> #d24333; neg/panel 3.90 -> 4.57:1 (floor 4.5), #fff/neg 3.90 -> 4.57:1 (floor 4.5)
      '--neg': '#d24333', '--neg-rgb': '210,67,51',                         // warm brick red
      '--crit': '#c8467c', '--crit-rgb': '200,70,124',                      // warm magenta
      '--cardgrad': 'linear-gradient(157deg,rgba(255,224,27,.10),rgba(255,224,27,0) 55%)',
      // font, feel and top-bar tokens as shipped in Prism.html MAILCHIMP_LIGHT_CSS (2026-10 drift
      // fix: they were hand-added to Prism.html and themes.js and never lived here)
      '--font': 'Bitter, Rockwell, Georgia, "Times New Roman", serif',
      '--elev-1': '0 2px 6px rgba(60,50,30,.08)',
      '--elev-2': '0 8px 22px rgba(60,50,30,.14)',
      '--dur': '.15s',
      '--cs-topnav-bg': '#241c15',
      '--cs-topnav-line': '#463b30',
      '--cs-topnav-ink': '#f7f3ea',
      '--cs-topnav-dim': '#c2b6a4',
      '--cs-topnav-hover': 'rgba(255,255,255,.08)',
      // on-fill inks (new; same #fff the generator painted before): 4.53-4.95:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#ffffff',
      '--info-ink': '#ffffff',
      '--pos-ink': '#ffffff',
      '--warn-ink': '#ffffff',
      '--neg-ink': '#ffffff',
      '--crit-ink': '#ffffff',
    },
    // Dark: Peppercorn near-black surfaces (the signature Mailchimp brand ground)
    // with Cavendish yellow popping on top.
    dark: {
      '--bg': '#241c15', '--panel': '#302720', '--panel2': '#2a221b', '--card': '#302720', '--line': '#463b30',
      // control boundary of inputs, checkboxes, radios, switches: --line's hue moved to 3:1 on bg/panel/panel2/card (WCAG 1.4.11)
      '--control-line': '#7c6f63',
      '--ink': '#f7f3ea', '--muted': '#c2b6a4', '--dim': '#8a7d6c',
      '--accent': '#ffe01b', '--accent-rgb': '255,224,27', '--accent2': '#ffe01b',  // Cavendish Yellow
      '--info': '#3fb6c3', '--info-rgb': '63,182,195',                      // brightened teal on dark
      '--pos': '#5cc95c', '--pos-rgb': '92,201,92',
      '--warn': '#ffab3f', '--warn-rgb': '255,171,63',
      '--neg': '#f0685a', '--neg-rgb': '240,104,90',
      '--crit': '#e069a0', '--crit-rgb': '224,105,160',
      '--cardgrad': 'linear-gradient(157deg,rgba(255,224,27,.12),rgba(255,224,27,0) 55%)',
      // font, feel and top-bar tokens as shipped in Prism.html MAILCHIMP_DARK_CSS (2026-10 drift
      // fix: they were hand-added to Prism.html and themes.js and never lived here)
      '--font': 'Bitter, Rockwell, Georgia, "Times New Roman", serif',
      '--elev-1': '0 2px 6px rgba(0,0,0,.4)',
      '--elev-2': '0 8px 22px rgba(0,0,0,.5)',
      '--dur': '.15s',
      '--cs-topnav-bg': '#302720',
      '--cs-topnav-line': '#463b30',
      '--cs-topnav-ink': '#f7f3ea',
      '--cs-topnav-dim': '#c2b6a4',
      '--cs-topnav-hover': 'rgba(255,255,255,.08)',
      // on-fill inks (new; the generator painted literal #fff on these fills): #fff 1.32-3.14:1 -> ink 5.35-12.72:1 on accent/info/pos/warn/neg/crit (floor 4.5)
      '--accent-ink': '#241c15',
      '--info-ink': '#241c15',
      '--pos-ink': '#241c15',
      '--warn-ink': '#241c15',
      '--neg-ink': '#241c15',
      '--crit-ink': '#241c15',
    },
  },

  // Structural tokens for the F4 facet generator (become .mailchimp-root custom
  // props). Crisp, near-square corners + an editorial serif system stack (no
  // webfonts) to echo the Cooper-style display voice.
  tokenProfile: {
    radius: '6px',   // -> --mailchimp-radius : crisp, characterful corners (not pill-round)
    font: 'Cooper, "Cooper Black", Rockwell, Georgia, "Times New Roman", serif', // -> --mailchimp-font (offline serif stack)
  },
};
