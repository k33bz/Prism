# Prism catalog pipeline

The machine-readable catalog of every Prism effect lives **inside `Prism.html`** as a
JSON island: `<script type="application/json" id="prism-catalog">`. That island is the
source of truth consumed by the MCP server and any AI tooling. `catalog/manifest.json`
(+ `index.json`) is a regenerable build artifact, not the source of truth.

The pipeline re-derives the island from the live gallery templates inside `Prism.html`:

```
_facet_dates.mjs         →  facet-dates.json + #prism-facet-dates island   (git history: addedOn / updatedOn per facet)
extract-from-prism.mjs   →  manifest.json + index.json   (headless Chrome / CDP; merges facet-dates.json)
_derive_selection.mjs    →  adds role / dataShape / a11y to manifest.json + index.json   (--write; deterministic, from selection-vocab.json)
_embed-catalog.mjs       →  writes the island back into Prism.html   (idempotent)
_smoke.mjs               →  validates the island parses + shell scripts syntax-check
_check_ds.mjs            →  design-system coverage & integrity gate (exit non-zero on fail)
_check_selection.mjs     →  agent-facing selection-metadata gate: every facet has valid role + a11y, charts have dataShape (exit non-zero on fail)
```

## Agent-facing selection metadata

`_derive_selection.mjs` enriches every facet with three fields the MCP server exposes as
search facets, so an agent can pick by intent instead of keyword-guessing:

- **`role`** — the component's purpose: `action`, `input`, `navigation`, `feedback`,
  `loading`, `data-display`, `decorative`, `ambient`, `media`.
- **`dataShape`** (charts / maps / diagrams only) — the data relationship it fits:
  `single-value`, `time-series`, `comparison`, `part-to-whole`, `correlation`,
  `distribution`, `flow`, `geo`. This is the machine-readable answer to "when do I use
  which chart".
- **`a11y`** — `{ selfAnimates, reducedMotionSafe }`: whether it moves without user
  action, and whether it is static or honors `prefers-reduced-motion`.

Everything is **derived deterministically** (no LLM, no hand-authoring) from fields that
already exist — `componentType`, `gallery`, `category`, `name`, `interaction`, and the
per-facet CSS. The mapping lives in `selection-vocab.json` as ordered, first-match rules;
edit that file (never the per-facet values) and re-run `_derive_selection.mjs --write`.
`_check_selection.mjs` gates the result so the values can't silently rot, and
`--warn` lists facets that self-animate without a reduced-motion fallback (a11y follow-ups).

All pipeline scripts honor `PRISM_HTML` (an absolute path to an alternate copy),
so a staged temp copy can be extracted / embedded / smoke-checked / gated without
touching the repo's `Prism.html`.

## Requirements

- **Node 18+** (uses the global `fetch`/`WebSocket` and `node:` builtins only — no npm deps).
- A **Chromium-family browser**: Google Chrome, Chromium, or Microsoft Edge. They all
  speak the same DevTools protocol, so any of them works.

## Running it

From the repo root:

```bash
node catalog/extract-from-prism.mjs   # drives Prism.html in headless Chrome, writes manifest.json + index.json
node catalog/_derive_selection.mjs --write   # adds role/dataShape/a11y to manifest.json + index.json
node catalog/_embed-catalog.mjs       # embeds manifest.json into the #prism-catalog island in Prism.html
node catalog/_smoke.mjs               # sanity-checks the island + shell
node catalog/_check_selection.mjs     # gates role/dataShape/a11y coverage (exit non-zero on fail)
```

A correct run reports **2670 effects across 15 galleries** (parity with the island) and
`_smoke.mjs` prints `OK island: galleries=15 effects=2670`.

> `_smoke.mjs` also prints `FAIL: shell script #1: Unexpected identifier 'the'` / `2/3
> parsed`. This is a long-standing **false positive** — the script-extraction regex
> matches an HTML comment in `<head>`, not real JS. The actual shell logic block parses
> fine. Treat "2/3 parsed" as the expected baseline.

## Design-system coverage & integrity gate (`_check_ds.mjs`)

Enforces the theme-packs epic standard on the **live catalog island**. For each
design-system family it asserts:

- **exactly 100 facets** tagged `data-spectrum=<dsShort>` (the epic coverage standard),
- **id integrity** — kebab-case, no duplicates (reuses `prism-mcp-server/utils/validate.js`),
- **offline / token-only CSS** — no `@import`, `@font-face`, `http(s)://`, or external/data
  `url()` (internal `url(#svgFilter)` fragment refs are fine), and no raw *brand* hex
  (chromatic `#rrggbb`; achromatic `#fff`/`#000`/greys are allowed for text/masks),
- **reduced-motion** — a `prefers-reduced-motion` block covering the family where it animates.

It exits non-zero on any failure, so it can gate PRs / CI.

```bash
node catalog/_check_ds.mjs                       # gate the live Prism.html
PRISM_HTML=/abs/path/copy.html node catalog/_check_ds.mjs   # gate a staged temp copy
PRISM_SYSTEMS=/abs/path/systems.json node catalog/_check_ds.mjs  # gate a staged registry
node catalog/_check_ds.mjs --only duolingo,monzo  # restrict to some families
```

**Two tiers (`catalog/systems.json`).** The registry splits families into `themePack`
(held to the full standard) and `legacy` — the original 9 spectrums (`material-ui`,
`cyberpunk-os`, …) that predate the standard, intentionally hardcode their brand palette
(the fixed palette *is* the design language's identity), use non-`dsShort` class prefixes
(`.mat-*`), and ship one shared reduced-motion block. Legacy families are reported for
information but only gated on the universal checks (id integrity, offline). We do **not**
re-author the ~1,668 existing facets. Any family present in the island that is not listed
as legacy is treated as a theme-pack and fully gated (so a freshly-staged system is checked
even before it is added to the registry); a declared `themePack` entry that is absent from
the island fails the parity check.

## Theme-pack scaffolder (`_scaffold_ds.mjs`)

The scaffolder emits a structural copy of the **reference pack, Cloudscape** — same theme
registry, same `:root`-token contract, same MCP mirror, different palette. Read
[`REFERENCE-PACK.md`](REFERENCE-PACK.md) for the canonical shape a correct pack takes in all
three files (`Prism.html` `THEME_REGISTRY`, `utils/themes.js` `THEMES[]`, `systems.json`),
why a pack ships **only** a `:root` block (F1/F2 moved all chrome onto `body.cs-light` mode
tokens), and how to verify a pack against the reference.

Turns a design-system **profile** into all the theme wiring in one command, so each
Phase-2 system is fill-in-the-blanks:

```bash
node catalog/_scaffold_ds.mjs catalog/profiles/<name>.mjs
```

A profile only needs `{ ds, dsShort, accent }` — from `accent` the scaffolder derives a
coherent starter palette for **both** color modes (layered over the Cloudscape base). To
hand-author instead, add `palette: { dark: {…}, light: {…} }`. `tokenProfile` (structural
tokens like `radius`/`font`) flows into the emitted facet-gen stub; `homeUrl`/`ticket` are
advisory. See `catalog/profiles/sample-scaffold.mjs`.

It idempotently patches four things:

1. **`Prism.html` `THEME_REGISTRY`** — adds `<dsShort>-dark` + `<dsShort>-light` entries
   (plus their `:root` token CSS consts). This is the single source of truth the shell and
   the Variant-Matrix picker read, so the pack becomes **selectable in both modes** with no
   further edits.
2. **`prism-mcp-server/utils/themes.js` `THEMES[]`** — adds the MCP mirror entries via
   `packTokens(mode, overrides)`.
3. **`catalog/systems.json` `themePack[]`** — registers the family so the F5 gate then
   holds its facets to the 100-facet standard.
4. **`catalog/profiles/<dsShort>.mjs`** — writes a facet-gen (F4) config stub.

Everything else is **self-maintaining off the theme registry** — no per-pack edits:

- the MCP tool metadata (`get_theme_variants.builtInThemes` / `note`, the `get_theme_palette`
  description + `THEME_IDS` enum) derives from `THEMES` via `themeIdList()` / `themesSummary()`;
- the `variants.test.js` theme-count assertions derive from `THEME_IDS`, so the suite passes
  at the new count with zero edits ("theme count reflects the new system" for free).

The scaffolded theme ships with **zero facets** (an "empty" pack): it is selectable and
correctly colored immediately, and the run prints a checklist of the remaining steps —
author the 100 facets with `_gen_system.mjs`, merge + re-embed the island, then gate with
`_check_ds.mjs --only <dsShort>`. Until the facets exist the F5 gate correctly fails the
pack (0 facets), which is the signal to run F4.

Staged-verification overrides (never touch the repo copies): `PRISM_HTML`,
`PRISM_MCP_THEMES`, `PRISM_SYSTEMS`, `PRISM_PROFILES_DIR`.

## Chrome resolution (cross-platform)

`catalog/_chrome.mjs` resolves a browser binary at runtime so the pipeline runs on
Windows, macOS, and Linux without edits. Order:

1. **`PRISM_CHROME`** environment variable — an explicit path to any Chromium-family
   executable. Set this if your browser is installed somewhere unusual, or to force a
   specific one.
2. Otherwise, the first existing path from a per-OS candidate list (Chrome → Chromium →
   Edge), covering the common install locations on each platform.

If nothing is found it throws with the list of locations it checked and how to set
`PRISM_CHROME`.

```bash
# Windows (cmd):     set PRISM_CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
# Windows (bash):    export PRISM_CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
# macOS:             export PRISM_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# Linux:             export PRISM_CHROME="/usr/bin/google-chrome"
```

## Other CDP tools (same resolver)

These visual/QA scripts share `_chrome.mjs`, so they honor `PRISM_CHROME` too:

- `_find_broken.mjs [pages…]` — flags broken/empty/unstyled `is-new`/`is-fixed` facets.
- `_shoot.mjs [pages…]` — full-page PNG of each gallery's new/fixed tiles → `catalog/shots/`.
- `_shell-shot.mjs [theme] [page] [w] [h]` — screenshot the themed shell chrome.
- `_scrollbar-shot.mjs [theme] [page]` — shell shot with scrollbars visible.
