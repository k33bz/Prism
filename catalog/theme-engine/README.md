# Theme engine

Brand inputs in, a complete contrast-safe Prism token palette for dark and light out. Zero dependencies (Node built-ins only); it replaces the custom-palette compiler that JFH-13 removed.

| File | What it does |
|---|---|
| `color.mjs` | sRGB, OKLab and OKLCH conversions; gamut mapping by chroma reduction at fixed L and h; WCAG 2.x luminance and contrast ratio; APCA Lc; hex and rgb parsing and formatting. |
| `derive.mjs` | `deriveTheme(input)` returns `{ dark, light, report }`, and `checkContrast(tokens, { mode, contrast })` audits any token map. Also the CLI. |
| `profile.mjs` | `toProfile(derived, { ds, dsShort, homeUrl })` returns a profile in the `catalog/profiles/*.mjs` shape, ready for `_scaffold_ds.mjs` and `_gen_system.mjs`. |
| `evaluate.mjs` | Derives a theme from each hand-tuned pack's accent and compares the two: contrast pairs, and delta E per token. |

## Use

```bash
node catalog/theme-engine/derive.mjs --accent '#0078d4' --name Acme --css
node catalog/theme-engine/derive.mjs --accent '#ffd400' --neutral warm --contrast AAA --profile acme.mjs
node catalog/_scaffold_ds.mjs acme.mjs        # wire it as a pack (shell registry, MCP mirror, systems.json)
node catalog/theme-engine/evaluate.mjs --tokens --fails
```

The CLI exits 2 if any gated pair fails, which can only happen when no lightness of the accent's hue meets every floor. Other options: `--secondary`, `--mode`, `--radius`, `--density`, `--font`, `--json`, `--ds-short`, `--home-url`. The MCP server exposes the engine as `derive_theme` and `check_theme_contrast`.

Input: `{ name, accent, secondary?, neutral? (brand | cool | warm | neutral | #hex), mode? (both | dark | light), contrast? (AA | AAA), radius?, density?, font? }`.

## How it derives

- **Neutrals**: fixed OKLCH ramp positions for bg, panel, panel2, card and line, at the brand hue with low chroma (scaled by the accent's chroma; `cool`, `warm` and a hex change the hue). Ink, muted and dim start at their ramp lightness and move away from the surfaces until they clear their floors on all four surfaces. `--control-line`, the boundary of inputs, checkboxes, radios and switches, is line's hue moved the same way until it clears 3:1 on all four (`solveControlLine`, exported so hand-tuned palettes are solved alike); line itself stays a quiet divider.
- **Accent**: the hue and chroma are kept. If the accent misses a floor in a mode (text on panel, panel2 and card; UI on bg; a readable ink on the fill), only its lightness moves. A passing accent is kept byte for byte. Every move lands in `report.moved` with a message such as `accent #ffd400 too light for text on a light panel: darkened to #897000, L 0.88 to 0.55`.
- **Ink on fills**: `#fff` when it clears the floor, else a near-black from the neutral ramp, emitted as `--accent-ink` and per status role (`--info-ink`, `--pos-ink`, `--warn-ink`, `--neg-ink`, `--crit-ink`). The generated facets paint `var(--x-ink,#fff)` on role fills; the report still notes each mode where a component that hardcodes `#fff` on the accent would read below the floor.
- **Status colors**: conventional hues (info 250, pos 145, warn 75, neg 27, crit 305), the accent's chroma clamped to 0.12 to 0.19, and one shared lightness per mode: the accent's L clamped to a band, moved as far as the most demanding hue needs. Warn sits a little lighter in dark mode.
- **Everything else** follows BASE_TOKENS: `-rgb` triplets from the hex, `--cardgrad` as `linear-gradient(157deg, accent .08/.06, 0 55%)`, elevation, radius scale (x0.5, x1, x1.5, x2, the scaffolder's rule), density, font, top-nav chrome.

All contrast is measured on the final `#rrggbb`. The output is deterministic.

## Floors

| Pair kind | AA | AAA |
|---|---|---|
| text: ink and muted on every surface; accent and status on panel, panel2, card; ink on accent; top-nav ink and dim | 4.5 | 7 |
| UI: accent, accent2 and status on bg; accent2 on panel; control-line on every surface | 3 | 3 |
| tertiary: dim on every surface | 3 | 4.5 |
| decorative: line on panel and bg | reported, not gated | |

## Tests

```bash
node --test "catalog/theme-engine/*.test.mjs"
```

Conversions against reference values, round trips within 1/255, gamut mapping, WCAG and APCA reference values, every pair's floor for 12 accents under AA and AAA with each neutral, determinism, input validation, and `toProfile` driving the real scaffolder (against stub files in a temp dir) and the facet generator.
