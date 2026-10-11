# Prism MCP: example tool calls

One example per tool. Each shows the **`tools/call` request** (the `params` an
MCP client sends) and the **shape of the result** (the JSON the tool returns,
which the server wraps in `content: [{ type: "text", text: "<json>" }]`).

The results come from the shipped `Prism.html` (3,560 effects in 18 galleries,
32 themes, 87 AWS diagrams), trimmed with `…` for readability; run
`node cli.js info` and the tools against your own copy for live data.

---

## Discovery

### `recommend_effects`
From a plain request to the right facets. The intent is read into selection
filters (role, dataShape, backdrop, motion, JS, the AWS gallery, a theme named
in the text); several data shapes give one ranked group each.
Request:
```json
{ "name": "recommend_effects", "arguments": { "intent": "a KPI dashboard with revenue over time and the plan mix, in Duolingo Light", "limit": 2 } }
```
Result:
```json
{
  "intent": "a KPI dashboard with revenue over time and the plan mix, in Duolingo Light",
  "rules": [
    "dataShape time-series: a value changing over time: line, area, sparkline",
    "dataShape part-to-whole: shares of one total: donut, pie, stacked 100% bar, treemap",
    "dataShape single-value: one headline number: KPI tile, big number, gauge",
    "role data-display: charts, KPIs, tables",
    "theme duolingo-light: compose { theme: \"duolingo-light\" }"
  ],
  "theme": "duolingo-light",
  "groups": [
    { "need": "dataShape time-series", "filters": { "dataShapes": ["time-series"], "roles": ["data-display"] }, "total": 54,
      "items": [ { "id": "charts-bump-chart-rank-over-time", "name": "Bump Chart (rank over time)", "gallery": "charts",
                   "role": "data-display", "dataShape": "time-series", "layer": "content", "usableAsBackground": false, "needsJs": null,
                   "a11y": { "selfAnimates": false, "reducedMotionSafe": true }, "why": ["matches \"over time\"", "dataShape time-series", "role data-display"] }, "…" ] },
    { "need": "dataShape part-to-whole", "total": 35, "items": [ { "id": "charts-stacked-area-chart", "…": "…" }, { "id": "charts-live-stacked-bars", "…": "…" } ] },
    { "need": "dataShape single-value", "total": 40, "items": [ { "id": "charts-kpi-delta-card-grid", "…": "…" }, { "id": "charts-mini-kpi-row", "…": "…" } ] }
  ],
  "next": [
    "get_effect { id } for the html, css and its apply guide (theme tokens it reads, initializer, motion, background placement).",
    "compose { ids: [...], theme: \"duolingo-light\", document: true } for one bundle with the token block, or compose_with_template for a grid of cards."
  ]
}
```
Other intents: `"a loading state that is reduced-motion safe"` (role loading,
reducedMotionSafe true), `"a hero with an animated background"`
(usableAsBackground true, self-animating first), `"static pure css toggle switch"`
(role input, selfAnimates false, needsJs false), `"three-tier AWS diagram with
security group rule tables"` (the aws gallery; `next` points at
`get_diagram_spec` and `build_diagram`). When nothing matches, the group says
what it relaxed (`"relaxed": ["roles loading"]`); motion, JS and backdrop
constraints are never relaxed.

### `list_effects`
Request:
```json
{ "name": "list_effects", "arguments": { "role": "loading", "limit": 1 } }
```
Result:
```json
{
  "total": 91, "offset": 0, "limit": 1, "returned": 1,
  "items": [
    { "id": "charts-radial-progress-stack", "name": "Radial Progress Stack", "gallery": "charts",
      "componentType": "progress-bar", "role": "loading", "layer": "content", "dataShape": "comparison",
      "a11y": { "selfAnimates": true, "reducedMotionSafe": true },
      "usableAsBackground": false, "needsJs": null, "hasHtml": true, "hasCss": true, "…": "…" }
  ]
}
```
An unknown gallery, role, layer or dataShape is an `invalid_argument` error that
lists the valid values, e.g. `{ "role": "spinner" }` gives
`data.roles.valid: ["action","input","navigation","feedback","loading","data-display","decorative","ambient","media"]`.

### `search_effects`
Full-text query, faceted filters, or both. `filters` narrows by facet (OR within a
facet; `tags` is AND; AND across facets) plus boolean flags. `sort` is one of
`relevance` (default when a query is present), `name`, `newest`, `gallery`.

Request (query + facets):
```json
{
  "name": "search_effects",
  "arguments": {
    "query": "pulsing kpi card",
    "filters": { "galleries": ["charts"], "interactions": ["auto-play"] },
    "limit": 3
  }
}
```
Result:
```json
{
  "query": "pulsing kpi card", "sort": "relevance",
  "filters": { "galleries": ["charts"], "interactions": ["auto-play"] },
  "total": 11, "offset": 0, "limit": 3, "returned": 3,
  "items": [
    { "id": "charts-kpi-sparkline", "name": "KPI + Sparkline", "score": 11, "interactions": ["auto-play"], "spectrum": null, "…": "…" },
    { "id": "charts-prism-kpi", "score": 10, "…": "…" },
    { "id": "charts-tilted-card-stack", "score": 10, "…": "…" }
  ]
}
```
Request (pick a chart by data shape, motion safe, no query):
```json
{ "name": "search_effects", "arguments": { "filters": { "dataShapes": ["part-to-whole"], "reducedMotionSafe": true }, "limit": 3 } }
```
Result: `"total": 37`, items `charts-3d-donut-torus-gauge`, `charts-3d-pie-chart`, `charts-3d-stacked-bars`.
A backdrop is `{ "filters": { "usableAsBackground": true } }` (49 facets); an unknown
`sort` is `invalid_argument` with `data.validSorts`.

### `get_available_filters`
Request:
```json
{ "name": "get_available_filters", "arguments": { "topValues": 3 } }
```
Result:
```json
{
  "totalEffects": 3560,
  "facets": {
    "gallery": { "label": "Gallery", "filterKey": "galleries", "totalValues": 18,
      "values": [ { "value": "spectrums", "count": 1566 }, { "value": "charts", "count": 266 }, { "value": "lab", "count": 261 } ] },
    "role": { "filterKey": "roles", "totalValues": 9,
      "values": [ { "value": "decorative", "count": 1006 }, { "value": "data-display", "count": 812 }, { "value": "feedback", "count": 488 } ] },
    "layer": { "filterKey": "layers", "values": [ { "value": "content", "count": 3359 }, { "value": "overlay", "count": 112 }, { "value": "background", "count": 89 } ] },
    "dataShape": { "filterKey": "dataShapes", "values": [ { "value": "flow", "count": 162 }, { "value": "comparison", "count": 104 }, { "value": "time-series", "count": 54 } ] },
    "…": "…"
  },
  "booleanFlags": {
    "usableAsBackground": { "label": "Usable as background", "count": 49 },
    "needsJs": { "label": "Needs JS initializer", "count": 19 },
    "selfAnimates": { "label": "Self-animates", "count": 2641 },
    "reducedMotionSafe": { "label": "Reduced-motion safe", "count": 3400 },
    "themeSensitive": { "label": "Theme-sensitive (derived)", "count": 3550 },
    "…": "…"
  },
  "sorts": ["relevance","name","newest","gallery"],
  "notes": ["tags filter uses AND …", "usableAsBackground is the authored backdrop flag; layer \"background\" … also covers some foreground objects …", "…"]
}
```

### `list_filter_values`
Enumerate one facet in full (useful for high-cardinality facets like the 252 categories).
Request:
```json
{ "name": "list_filter_values", "arguments": { "facet": "category", "prefix": "3d", "limit": 5 } }
```
Result:
```json
{
  "facet": "category", "label": "Category",
  "total": 13, "offset": 0, "limit": 5, "returned": 5,
  "items": [ { "value": "3D Charts & Graphs", "count": 21 }, { "value": "3D & Perspective (2026 drop)", "count": 20 }, "…" ]
}
```
Unknown facet: tool error `invalid_argument` with `data.validFacets`.

### `create_saved_search`
Request:
```json
{
  "name": "create_saved_search",
  "arguments": {
    "name": "Motion-safe loaders",
    "filters": { "roles": ["loading"], "reducedMotionSafe": true },
    "sort": "name"
  }
}
```
Result:
```json
{
  "created": "motion-safe-loaders",
  "savedSearch": { "id": "motion-safe-loaders", "name": "Motion-safe loaders", "description": "", "query": null,
    "filters": { "roles": ["loading"], "reducedMotionSafe": true }, "sort": "name", "createdAt": "2026-10-11T…Z" },
  "total": 1
}
```
Needs a query and/or at least one filter, else tool error `invalid_argument`.

### `get_saved_searches`
Request:
```json
{ "name": "get_saved_searches", "arguments": {} }
```
Result:
```json
{ "total": 1, "items": [ { "id": "motion-safe-loaders", "name": "Motion-safe loaders", "…": "…" } ] }
```

### `execute_saved_search`
Request:
```json
{ "name": "execute_saved_search", "arguments": { "id": "motion-safe-loaders", "limit": 2 } }
```
Result: same shape as `search_effects`, prefixed with the saved-search identity:
```json
{
  "savedSearch": { "id": "motion-safe-loaders", "name": "Motion-safe loaders" },
  "query": null, "sort": "name", "total": 88, "items": [ { "id": "lab-bar-load", "…": "…" }, { "id": "lab-bar-wave-loader", "…": "…" } ]
}
```
Unknown id: tool error `not_found` with `data.available` (the known ids).

### `get_effect`
Request:
```json
{ "name": "get_effect", "arguments": { "id": "input-persistent-checklist", "includeHtml": false, "includeCss": false } }
```
Result (the record plus `apply`, the guide to using it):
```json
{
  "id": "input-persistent-checklist", "gallery": "input", "role": "input", "layer": "content",
  "a11y": { "selfAnimates": false, "reducedMotionSafe": true }, "needsJs": "chk-store", "…": "…",
  "apply": {
    "steps": [
      "Include a theme token block once per page: it reads 11 theme tokens (themeTokens). compose { ids, theme } adds it; get_theme_palette { theme } returns it as css.",
      "Insert html and include css (selfContained false: the html alone is unstyled).",
      "Run initializer.js once after the markup is in the page (needsJs \"chk-store\")."
    ],
    "themeTokens": ["--panel2","--line","--control-line","--ink","--muted","--dim","--info","--info-rgb","--pos","--pos-rgb","--pos-ink"],
    "motion": { "selfAnimates": false, "reducedMotionSafe": true, "note": "Static, or moves only on interaction." },
    "initializer": { "key": "chk-store", "js": "/* Prism initializer \"chk-store\": persistence + live progress … */ (function(){ … })();",
                     "page": "input", "note": "Run once after the markup is in the page (idempotent, no dependencies).", "effects": ["input-persistent-checklist"] }
  }
}
```
A backdrop's `apply.background` says how to stretch it behind content (or use
`compose_with_template { template: "backdrop" }`); a facet with
`[data-mode="light"]` rules gets a step about `data-mode`. A missing id is
`invalid_argument`; an unknown one is `not_found` with `data.suggestions`
(`charts-kpi-pulse` suggests `charts-mini-kpi-row`, `charts-kpi-delta-card-grid`, …).

### `get_theme_variants`
Request:
```json
{ "name": "get_theme_variants", "arguments": {} }
```
Result:
```json
{
  "tokensCss": ":root{--bg:#0f1621;--panel:#192534;…;color-scheme:dark}\n@media (prefers-color-scheme: light){:root:not([data-mode=\"dark\"]){--bg:#f2f3f3;…}}\n:root[data-mode=\"light\"]{…}\n.c-crit{--c:var(--crit);--c-rgb:var(--crit-rgb)}…",
  "semanticTokens": ["--accent","--info","--pos","--neg","--warn","--crit"],
  "onFillInks": ["--accent-ink","--info-ink","--pos-ink","--warn-ink","--neg-ink","--crit-ink"],
  "surfaceTokens": ["--bg","--panel","--panel2","--card","--line","--control-line","--ink","--muted","--dim"],
  "recolor": "Set --c and --c-rgb (or add a c-* class like c-pos) on the effect element to recolor it.",
  "designSystems": [ { "ds": "cloudscape", "name": "Cloudscape", "dark": "cloudscape-dark", "light": "cloudscape-light", "isDefault": true }, "…" ],
  "builtInThemes": ["cloudscape-dark","cloudscape-light","duolingo-dark","duolingo-light","…"],
  "note": "Prism ships 16 design systems as pure :root token overrides over identical component HTML/CSS: Cloudscape (cloudscape-dark [default], cloudscape-light); Duolingo (…); …"
}
```

### `list_galleries`
Request:
```json
{ "name": "list_galleries", "arguments": {} }
```
Result (declared vs. live counts catch a stale manifest):
```json
{
  "total": 18,
  "items": [
    { "id": "charts", "title": "Charts & Metrics", "declaredCount": 266, "liveCount": 266 },
    { "id": "aws", "title": "AWS Architecture", "declaredCount": 87, "liveCount": 87 },
    "…"
  ]
}
```

### `get_catalog_stats`
Request:
```json
{ "name": "get_catalog_stats", "arguments": {} }
```
Result:
```json
{
  "totalEffects": 3560, "galleryCount": 18,
  "byGallery": { "charts": 266, "fx": 248, "lab": 261, "aws": 87, "spectrums": 1566, "…": 0 },
  "backgroundCapable": 49, "needsJs": 19, "isNew": 2842, "isFixed": 25,
  "uniqueTags": 49, "uniqueComponentTypes": 104,
  "topTags": [ { "tag": "animated", "count": 3111 }, "…" ]
}
```

---

## Component Variant Matrix

Prism themes are pure `:root` token overrides applied over identical component
HTML/CSS, so a "variant" is one component under a different token set. These
tools return token maps + overrides, never N rendered copies.

### `get_theme_palette`
Request (one theme; omit `theme` for all 32):
```json
{ "name": "get_theme_palette", "arguments": { "theme": "duolingo-light" } }
```
Result:
```json
{
  "id": "duolingo-light", "ds": "duolingo", "name": "Duolingo Light", "mode": "light", "builtin": false,
  "tokens": { "--bg": "#f7f7f7", "--control-line": "#908f90", "--accent": "#347f02", "--accent-ink": "#ffffff",
              "--cs-topnav-bg": "#347f02", "--cs-topnav-accent": "#ffffff", "--cs-topnav-accent-ink": "#347f02", "…": "…" },
  "overrides": { "…": "…" }, "overrideCount": 48,
  "css": ":root{ /* Duolingo Light */\n  --bg: #f7f7f7;\n  --panel: #ffffff;\n  … }",
  "rootAttributes": { "data-mode": "light", "data-ds": "duolingo", "data-theme": "duolingo-light" },
  "pair": { "dark": "duolingo-dark", "light": "duolingo-light" },
  "autoCss": ":root{--bg:#131f24;…;color-scheme:dark}\n@media (prefers-color-scheme: light){:root:not([data-mode=\"dark\"]){--bg:#f7f7f7;…}}\n:root[data-mode=\"light\"]{…}",
  "autoScript": "(function(){var q=window.matchMedia&&matchMedia(\"(prefers-color-scheme: light)\")…})();",
  "apply": "Put css on the page once (or compose { theme: \"duolingo-light\" }) and set data-mode=\"light\" data-theme=\"duolingo-light\" data-ds=\"duolingo\" on <html>. To follow the system instead, use autoCss and run autoScript in <head> (or compose { theme: \"duolingo\" })."
}
```

### `get_component_variants`
Request:
```json
{ "name": "get_component_variants", "arguments": { "id": "charts-kpi-tile-delta", "themes": ["cloudscape-dark","duolingo-light"] } }
```
Result (one payload, one entry per theme):
```json
{
  "id": "charts-kpi-tile-delta", "themeSensitive": true,
  "usesTokens": ["--card","--line","--ink","--muted","--info","--pos","--pos-rgb","--neg","--neg-rgb","--cardgrad"],
  "note": "One payload, many variants: render = html + css + the chosen theme's token overrides on :root.",
  "html": "<div class=\"kpi\">…</div>",
  "variantCount": 2,
  "variants": [
    { "theme": "cloudscape-dark", "mode": "dark", "overrides": {}, "relevantOverrides": {}, "rootCss": ":root{ /* Cloudscape Dark */ … }" },
    { "theme": "duolingo-light", "mode": "light",
      "relevantOverrides": { "--card": "#ffffff", "--ink": "#3c3c3c", "--pos": "#4d8405", "--neg": "#e22b33", "…": "…" }, "rootCss": ":root{ /* Duolingo Light */ … }" }
  ]
}
```

### `get_variants_for_theme`
Request:
```json
{ "name": "get_variants_for_theme", "arguments": { "theme": "duolingo-light", "gallery": "charts", "themeSensitiveOnly": true, "limit": 1 } }
```
Result:
```json
{
  "theme": { "id": "duolingo-light", "name": "Duolingo Light", "mode": "light" },
  "overrides": { "--bg": "#f7f7f7", "…": "…" },
  "total": 266, "offset": 0, "limit": 1, "returned": 1,
  "items": [
    { "id": "charts-big-metric-count-up", "name": "Big Metric + Count-Up", "componentType": "chart-kpi",
      "themeSensitive": true, "usesTokens": ["--muted","--accent"], "tokenValues": { "--muted": "#717171", "--accent": "#347f02" } }
  ]
}
```

---

## Themes

Brand inputs in, a complete contrast-safe token palette for both color modes
out, from the engine in `catalog/theme-engine/` (found beside the catalog file).

### `derive_theme`
Request:
```json
{ "name": "derive_theme", "arguments": { "name": "Sunny", "accent": "#ffd400" } }
```
Result (abridged: `dark` and `light` carry every theme token, `report.pairs` every checked pair):
```json
{
  "name": "Sunny",
  "dark":  { "--bg": "#19160a", "--accent": "#ffd400", "--accent-ink": "#110f0a", "--control-line": "#797460", "…": "…" },
  "light": { "--accent": "#897000", "--accent-ink": "#ffffff", "--control-line": "#908f86", "…": "…" },
  "css": { "dark": ":root{ /* Sunny dark */\n  --bg: #19160a;\n  … }", "light": ":root{ /* Sunny light */ … }" },
  "report": {
    "pairs": [ "…" ],
    "failures": [],
    "moved": [ { "mode": "light", "token": "--accent", "input": "#ffd400", "output": "#897000", "L": [0.88, 0.55],
                 "message": "accent #ffd400 too light for text on a light panel: darkened to #897000, L 0.88 to 0.55" } ],
    "notes": [ "dark: accent #ffd400 needs dark ink (#110f0a); components that hardcode #fff on var(--accent) read at 1.43:1, use var(--accent-ink)" ],
    "summary": { "checked": 100, "failing": 0, "ok": true, "minRatio": { "text": 4.51, "ui": 3, "tertiary": 3.02 } }
  }
}
```
Apply it with `compose { "ids": [...], "tokens": { "dark": <dark>, "light": <light> } }` (Auto between the two modes).

### `check_theme_contrast`
Request (a partial map; the rest is filled from the Cloudscape base of the inferred mode and the shell's top bar):
```json
{ "name": "check_theme_contrast", "arguments": { "tokens": { "--bg": "#f7f7f7", "--panel": "#ffffff", "--accent": "#58cc02" } } }
```
Result (abridged):
```json
{
  "mode": "light", "contrast": "AA", "pass": false, "checked": 51,
  "failures": [ { "fg": "--accent", "bg": "--panel", "kind": "text", "fgValue": "#58cc02", "bgValue": "#ffffff", "ratio": 2.09, "floor": 4.5, "pass": false, "apca": 40.4 },
                { "fg": "--accent-ink", "bg": "--accent", "ratio": 2.09, "floor": 4.5, "…": "…" }, "…" ],
  "pairs": [ "…" ], "skipped": [], "filledFromBase": [ "--panel2", "--card", "--line", "--ink", "…", "--cs-topnav-bg", "…" ]
}
```
For a shipped theme (`{ "theme": "duolingo-light" }`) the top bar pairs include
`--cs-topnav-accent` (#ffffff) as UI on `--cs-topnav-bg` (#347f02) at 5.02:1 and
`--cs-topnav-accent-ink` on that fill at 5.02:1.

---

## Composition

### `compose`
Request:
```json
{
  "name": "compose",
  "arguments": {
    "ids": ["charts-mini-kpi-row", "fx-live-holo-tilt"],
    "theme": "cloudscape-light",
    "wrap": { "tag": "section", "className": "dashboard" }
  }
}
```
Result:
```json
{
  "ok": true,
  "html": "<section class=\"dashboard\">…</section>",
  "css": ":root{--bg:#f2f3f3;--panel:#ffffff;--panel2:#fafafa;--card:#ffffff;--line:#d5dbdb;--control-line:#7d8998;…;color-scheme:light}\n.c-crit{…}…\n.kpi{…}…",
  "effects": ["charts-mini-kpi-row","fx-live-holo-tilt"],
  "initializers": ["fxc-tilt"],
  "scripts": [ { "key": "fxc-tilt", "js": "/* Prism initializer \"fxc-tilt\": pointer-reactive holo tilt. … */", "page": "fx", "note": "Run once after the markup is in the page (idempotent, no dependencies).", "effects": ["fx-live-holo-tilt"] } ],
  "warnings": ["Effect \"fx-live-holo-tilt\" needs JS initializer \"fxc-tilt\": run it once after inserting the markup (compose returns it in scripts)"],
  "conflicts": [], "backgroundConflict": null,
  "validation": { "valid": true, "errors": [], "warnings": [] },
  "trace": [ "…" ],
  "metrics": { "effectCount": 2, "rulesIn": 100, "rulesOut": 100, "duplicatesRemoved": 0, "naiveCssLength": 19309, "finalCssLength": 19314, "reductionPct": 0, "composeMs": 6 },
  "theme": { "id": "cloudscape-light", "ds": "cloudscape", "name": "Cloudscape Light", "mode": "light" },
  "rootAttributes": { "data-mode": "light", "data-ds": "cloudscape", "data-theme": "cloudscape-light" },
  "apply": [
    "css starts with the Cloudscape Light token block (:root with every token, color-scheme light). Include it once per page.",
    "Set data-mode=\"light\" data-ds=\"cloudscape\" data-theme=\"cloudscape-light\" on <html>: facets read [data-mode=\"light\"] for light-only rules (the app stamps the same attributes).",
    "Insert html where the components go and include css once.",
    "Run the \"fxc-tilt\" initializer (scripts[].js) once after the markup is in the page.",
    "Motion: facets that self-animate and are reducedMotionSafe stop under prefers-reduced-motion: reduce on their own; nothing to add."
  ]
}
```
`theme` is a theme id (one mode), a design system id (`"duolingo"`: Auto, dark with
the light tokens under `prefers-color-scheme: light`; the result then carries
`autoScript` instead of `rootAttributes`), or `"none"`; the default is
`"cloudscape"` (Auto). `tokens` takes a custom palette (derive_theme's
`{ dark, light }`, or a flat map over a theme). `document: true` adds a complete
standalone page. Unknown id: tool error `compose_failed` with `data.missing`; a
wrapper tag that is not an element name is refused.

### `compose_with_template`
Request (a hero: the backdrop fills the section behind the other effects):
```json
{
  "name": "compose_with_template",
  "arguments": { "ids": ["objects-aurora-curtains", "text-gradient-pan", "input-cta-arrow-slide"], "template": "backdrop", "theme": "cloudscape", "document": true }
}
```
Result: same shape as `compose`, plus `"template": "backdrop"`, with the markup in
`<section class="prism-compose-backdrop"><div class="prism-compose-bg" aria-hidden="true">…</div><div class="prism-compose-fg">…</div></section>`
and the template CSS appended. Templates: `stack`, `row`, `grid`, `card` (each
effect in a padded panel), `backdrop`.

### `validate_composition`
Request:
```json
{ "name": "validate_composition", "arguments": { "ids": ["objects-snowfall","objects-rain","ghost"] } }
```
Result:
```json
{
  "valid": false,
  "errors": ["Unknown effect id: ghost"],
  "warnings": ["Effect \"objects-snowfall\" needs JS initializer \"amb-particles\": …", "…", "Multiple background-layer effects (objects-snowfall, objects-rain) … only one background renders; the others are occluded"],
  "conflicts": [],
  "backgroundConflict": ["objects-snowfall","objects-rain"],
  "missing": ["ghost"],
  "resolved": ["objects-snowfall","objects-rain"]
}
```

---

## Content creation

### `validate_facet`
Request:
```json
{
  "name": "validate_facet",
  "arguments": {
    "id": "charts-spark-badge",
    "name": "Spark Badge",
    "gallery": "charts",
    "description": "A compact sparkline badge for tiny trends.",
    "html": "<span class=\"spark-badge\"></span>",
    "css": ".spark-badge{color:var(--accent-ink);background:var(--accent);border:var(--bd) solid var(--control-line)}"
  }
}
```
Result:
```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "checks": { "id": true, "name": true, "gallery": true, "description": true, "html": true, "css": true, "tokens": true }
}
```
Bad id (`Charts_Bad`): `valid:false` with an error mentioning `kebab-case`.
Unknown token (`var(--made-up)`): a warning; unbalanced braces: an error.

### `create_facet`
Request:
```json
{
  "name": "create_facet",
  "arguments": {
    "id": "charts-spark-badge",
    "name": "Spark Badge",
    "gallery": "charts",
    "description": "A compact sparkline badge for tiny trends.",
    "html": "<span class=\"spark-badge\"></span>",
    "css": ".spark-badge{color:var(--accent)}",
    "tags": ["charts","sparkline"]
  }
}
```
Result:
```json
{
  "created": "charts-spark-badge",
  "persisted": false,
  "note": "Registered in live catalog (in-memory). Run the embed pipeline to persist into Prism.html.",
  "effect": { "id": "charts-spark-badge", "name": "Spark Badge", "…": "…" }
}
```
It is discoverable immediately (`get_effect`/`search_effects`). Duplicate id:
tool error `validation_failed`.

### `update_facet`
Request:
```json
{
  "name": "update_facet",
  "arguments": { "id": "charts-spark-badge", "description": "Now with a hover tooltip." }
}
```
Result:
```json
{ "updated": "charts-spark-badge", "persisted": false, "effect": { "…": "…" } }
```
Unknown id: tool error `not_found`.

---

## Catalog management

### `get_catalog_metadata`
Request:
```json
{ "name": "get_catalog_metadata", "arguments": {} }
```
Result:
```json
{
  "name": "prism-effects",
  "version": "1.0.0",
  "generated": "2026-10-10T17:07:04.867Z",
  "source": "Prism.html (seeded from catalog/manifest.json)",
  "galleryCount": 18,
  "effectCount": 3560,
  "runtimeFacetCount": 0,
  "filePath": "C:/…/Prism.html",
  "hotReload": true
}
```

### `export_collection`
Request:
```json
{
  "name": "export_collection",
  "arguments": { "ids": ["charts-kpi-sparkline","objects-aurora-curtains"], "title": "Status page", "format": "document", "theme": "polaris-dark" }
}
```
Result:
```json
{
  "title": "Status page",
  "effects": ["charts-kpi-sparkline","objects-aurora-curtains"],
  "css": ":root{--bg:#0b0c0d;…}\n…",
  "html": "…",
  "initializers": [], "scripts": [],
  "metrics": { "…": "…" },
  "theme": { "id": "polaris-dark", "ds": "polaris", "name": "Shopify Polaris Dark", "mode": "dark" },
  "rootAttributes": { "data-mode": "dark", "data-ds": "polaris", "data-theme": "polaris-dark" },
  "document": "<!DOCTYPE html>\n<html lang=\"en\" data-mode=\"dark\" data-ds=\"polaris\" data-theme=\"polaris-dark\">…</html>\n"
}
```
Source priority: `collectionId` (a saved collection) > explicit `ids` > `gallery`; none: tool error `invalid_argument`.
`format` is `bundle` (default; `css` + `html` + `scripts`), `document` (adds a full `<html>`), or `schema`
(the portable `prism-collection-1.0` JSON, see below; requires a `collectionId`).
`asDocument: true` is a deprecated alias for `format: "document"`.

### `get_token_reference`
Request:
```json
{ "name": "get_token_reference", "arguments": {} }
```
Result:
```json
{
  "tokensCss": ":root{--bg:#0f1621;…;--control-line:#6a7888;…;--accent-ink:#000716;…;color-scheme:dark}\n@media (prefers-color-scheme: light){…}\n…",
  "note": "Include a theme block once per page … text on a role fill reads the matching -ink token (var(--accent-ink,#fff)) and control boundaries read var(--control-line,var(--line)).",
  "tokens": [
    { "token": "--bg", "group": "surface", "purpose": "Page background" },
    { "token": "--control-line", "group": "surface", "purpose": "Boundary of an input, select, checkbox, radio, switch or toggle: 3:1 on every surface (WCAG 1.4.11); …" },
    { "token": "--accent-ink", "group": "on-fill ink", "purpose": "Text and glyphs painted ON an accent fill (button label, badge count, checkbox tick); …" },
    "…"
  ],
  "recolorClasses": ["c-accent","c-info","c-pos","c-warn","c-neg","c-crit"],
  "rootAttributes": "data-mode (dark or light; facets carry [data-mode=\"light\"] rules), data-theme (the theme id) and data-ds (the design system), as the app stamps them."
}
```

---

## AWS Architecture Icons

The official AWS Architecture Icons behind the AWS Architecture gallery (read from its embedded sprite, plus the crosswalks and status in `catalog/aws-icons/aws-icons.json`).

### `search_aws_icons`
Request:
```json
{ "name": "search_aws_icons", "arguments": { "query": "users", "limit": 2 } }
```
Result (dark/light colorway pairs collapse into one base id; `score` ranks exact names and aliases first):
```json
{
  "source": "…/Prism.html (#awd-sprite) + metadata …/catalog/aws-icons/aws-icons.json",
  "total": 6, "offset": 0, "count": 2,
  "items": [
    { "id": "aws-res-users", "name": "Users", "kind": "resource", "category": "General Icons",
      "colorways": { "dark": "aws-res-users-dark", "light": "aws-res-users-light" }, "score": 1.95 },
    { "id": "aws-res-user", "name": "User", "kind": "resource", "category": "General Icons",
      "colorways": { "dark": "aws-res-user-dark", "light": "aws-res-user-light" }, "score": 0.83 }
  ]
}
```
A container has no icon, so `{ "query": "security group" }` returns `"total": 0` with
`"frame": { "group": "sg", "note": "\"security group\" is drawn as a group frame: { kind: \"sg\" } in a diagram spec's groups …" }`.

### `resolve_aws_icon`
Request (a CloudFormation type with the properties that pick its icon):
```json
{ "name": "resolve_aws_icon", "arguments": { "query": "AWS::RDS::DBInstance", "props": { "Engine": "postgres", "MultiAZ": true } } }
```
Result (`standby` is the alternate-colorway icon for the Multi-AZ standby):
```json
{
  "query": "AWS::RDS::DBInstance", "from": "cfn",
  "id": "aws-res-aurora-postgresql-instance", "name": "Amazon Aurora PostgreSQL Instance", "kind": "node",
  "confidence": 1, "how": "rule+Engine", "standby": "aws-res-aurora-postgresql-instance-alternate",
  "candidates": [ { "id": "aws-res-aurora-postgresql-instance", "name": "Amazon Aurora PostgreSQL Instance", "score": 1 } ],
  "warnings": [], "source": "…"
}
```
A container name returns a frame: `{ "query": "Security Group" }` gives `"id": null, "kind": "group", "group": "sg"` (the awd frame kind; security groups have no icon). `{ "query": "AWS::EC2::EgressOnlyInternetGateway" }` gives `"id": null` and the warning that the package has no egress-only internet gateway icon (the kit draws it with `aws-res-vpc-internet-gateway`). Other forms: `"ALB"`, `"mxgraph.aws4.internet_gateway"` (`from: "drawio"`), `"aws:simple-storage-service-bucket"`, `"LambdaLambdaFunction"` (`from: "plantuml"`), `"compute.Lambda"` (`from: "diagrams"`), `"aws_lb"` with `{ "load_balancer_type": "network" }`.

### `get_aws_icon`
Request:
```json
{ "name": "get_aws_icon", "arguments": { "id": "aws-svc-lambda", "size": 48 } }
```
Result (artwork unmodified; `format: "symbol"` returns a `<symbol>` for a page sprite instead):
```json
{
  "id": "aws-svc-lambda", "name": "AWS Lambda", "kind": "service", "category": "Compute",
  "viewBox": "0 0 64 64", "format": "svg",
  "markup": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\" width=\"48\" height=\"48\" role=\"img\" aria-label=\"AWS Lambda\">…</svg>",
  "source": "…/Prism.html (#awd-sprite)"
}
```
A retired, end-of-support or renamed icon adds its lifecycle, for example `aws-svc-app-mesh`:
`"status": "end-of-support", "endOfSupport": "2026-09-30", "warnings": ["AWS App Mesh reached end of support on 2026-09-30 (migrate to Amazon VPC Lattice or Amazon ECS Service Connect)"]`.
An unknown id fails with `code: "not_found"` and `data.suggestions` (near matches: `aws-svc-lamda` suggests `aws-svc-lambda`).

---
## Collections & favorites

Saved, named sets of effects that persist across sessions (disk-backed JSON).

### `create_collection`
Request:
```json
{
  "name": "create_collection",
  "arguments": {
    "name": "Dashboard Kit",
    "description": "KPI tiles I reuse across dashboards",
    "effectIds": ["charts-mini-kpi-row", "charts-kpi-tile-delta"],
    "tags": ["dashboards", "kpi"]
  }
}
```
Result:
```json
{
  "id": "e5b1…-uuid",
  "name": "Dashboard Kit",
  "description": "KPI tiles I reuse across dashboards",
  "version": "1.0",
  "tags": ["dashboards","kpi"],
  "components": [
    { "id": "charts-mini-kpi-row", "name": "Mini KPI Row", "gallery": "charts" },
    { "id": "charts-kpi-tile-delta", "name": "KPI Tile + Delta", "gallery": "charts" }
  ],
  "createdAt": "2026-10-11T00:00:00.000Z",
  "updatedAt": "2026-10-11T00:00:00.000Z"
}
```
Effect ids are validated against the catalog (unknown ids: `not_found`). Constraints:
name at most 50 chars and unique (`duplicate_name`), description at most 200 chars, at most 5 tags and 50 components.

### `list_collections`
Request:
```json
{ "name": "list_collections", "arguments": {} }
```
Result:
```json
{
  "total": 1,
  "items": [
    { "id": "e5b1…-uuid", "name": "Dashboard Kit", "componentCount": 2,
      "tags": ["dashboards","kpi"], "updatedAt": "2026-10-11T00:00:00.000Z" }
  ]
}
```

### `get_collection`
Request:
```json
{ "name": "get_collection", "arguments": { "collectionId": "e5b1…-uuid" } }
```
Returns the full record incl. its `components` list (unknown id: `not_found`).

### `add_to_collection`
Request:
```json
{ "name": "add_to_collection", "arguments": { "collectionId": "e5b1…-uuid", "effectIds": ["objects-aurora-curtains"] } }
```
Result:
```json
{ "collection": { "…": "…", "components": ["…", { "id": "objects-aurora-curtains", "…": "…" }] }, "added": 1, "skipped": 0 }
```
Ids already present are skipped; exceeding 50 components: `limit_exceeded`.

### `remove_from_collection`
Request:
```json
{ "name": "remove_from_collection", "arguments": { "collectionId": "e5b1…-uuid", "effectIds": ["objects-aurora-curtains"] } }
```
Result:
```json
{ "collection": { "…": "…" }, "removed": 1 }
```

### `delete_collection`
Request:
```json
{ "name": "delete_collection", "arguments": { "collectionId": "e5b1…-uuid" } }
```
Result:
```json
{ "deleted": "e5b1…-uuid" }
```

### Export a saved collection for the Prism.html UI
Request:
```json
{ "name": "export_collection", "arguments": { "collectionId": "e5b1…-uuid", "format": "schema" } }
```
Result: the portable `prism-collection-1.0` object the in-browser Collections panel imports:
```json
{
  "__schema": "prism-collection-1.0",
  "name": "Dashboard Kit",
  "description": "KPI tiles I reuse across dashboards",
  "version": "1.0",
  "exportedAt": "2026-10-11T00:00:00.000Z",
  "color": null, "icon": null,
  "tags": ["dashboards","kpi"],
  "components": [
    { "id": "charts-mini-kpi-row", "name": "Mini KPI Row", "gallery": "charts" },
    { "id": "charts-kpi-tile-delta", "name": "KPI Tile + Delta", "gallery": "charts" }
  ],
  "componentCount": 2,
  "totalSize": 4220
}
```

---

## AWS Architecture diagrams

Diagrams as JSON specs, compiled by the AWS kit beside the catalog (`catalog/aws-kit/awd.mjs`).
Reference: `catalog/drafts/AWS_KIT.md`.

### `get_diagram_spec`
Request (no id: the gallery, listed by the kit primitives each diagram uses):
```json
{ "name": "get_diagram_spec", "arguments": { "family": "security" } }
```
Result:
```json
{
  "total": 5,
  "families": [
    { "id": "security", "title": "SECURITY GROUPS AND NETWORK ACLS", "diagrams": [
      { "id": "sg-chain", "name": "Security group referencing", "size": "960x440", "features": ["tables","poster","marks","legend"] },
      { "id": "sg-nacl", "name": "Network ACLs and security groups", "size": "960x268", "features": ["tables","poster","marks","legend"] },
      "…"
    ] }
  ],
  "features": ["tables","flows","v6","note2","effects","poster","moment","marks","legend"]
}
```
Without `family` it lists all 87 gallery diagrams in 11 families plus the kit example; `feature: "v6"` lists the IPv6 ones.

Request (one spec):
```json
{ "name": "get_diagram_spec", "arguments": { "id": "aws-v6-dual-stack" } }
```
Result (`spec` matches `catalog/aws-kit/spec.schema.json`):
```json
{
  "id": "v6-dual-stack", "catalogId": "aws-v6-dual-stack",
  "family": { "id": "ipv6", "title": "IPV6 AND DUAL STACK" }, "version": 1,
  "spec": {
    "id": "v6-dual-stack", "name": "Dual-stack VPC with an egress-only internet gateway", "wide": true, "w": 960, "h": 440, "dur": 10, "poster": "…",
    "groups": [ { "kind": "vpc", "x": 256, "y": 58, "w": 664, "h": 328, "label": "VPC", "note": ["10.0.0.0/16", "2001:db8:1200::/56"] }, "…" ],
    "nodes": [ "…" ], "wires": [ "…" ],
    "flows": [ { "id": "v4", "wires": [ { "wire": "a4", "ring": "nata", "f": 0.83 }, "…" ], "text": ["A private instance sends IPv4 traffic to the internet. …", "…"] }, "…" ],
    "tables": [ "…", { "id": "rt-priv", "title": "Private route table, AZ A", "tone": "networking", "cols": ["Destination","Target"],
      "rows": [ ["10.0.0.0/16","local"], ["2001:db8:1200::/56","local"], { "cells": ["0.0.0.0/0","nat-a"], "t": [0.04,0.083], "tone": "ok" }, { "cells": ["::/0","eigw"], "t": [0.524,0.596], "tone": "ok" } ] } ],
    "…": "…"
  },
  "source": "…/catalog/aws-kit/json/ipv6.json"
}
```

### `build_diagram`
Request (one diagram; a family `{ "version": 1, "section": {…}, "diagrams": […] }` also works):
```json
{
  "name": "build_diagram",
  "arguments": {
    "theme": "light",
    "spec": {
      "id": "x-ds", "name": "Dual stack", "desc": "An instance reaches the internet over IPv6.", "w": 480, "h": 300, "dur": 8,
      "groups": [ { "kind": "vpc", "x": 110, "y": 8, "w": 362, "h": 160, "note": ["10.0.0.0/16", "2001:db8:1::/56"] } ],
      "nodes": [
        { "id": "ec2", "icon": "aws-res-ec2-instance", "x": 380, "y": 80, "label": "Amazon EC2" },
        { "id": "igw", "icon": "aws-res-vpc-internet-gateway", "x": 140, "y": 80, "label": "Internet gateway", "wrap": 10 },
        { "id": "net", "icon": "aws-res-internet", "x": 20, "y": 80, "label": "Internet" }
      ],
      "wires": [ { "id": "a", "from": "ec2", "to": "igw" }, { "id": "b", "from": "igw", "to": "net" } ],
      "flows": [ { "path": ["ec2", "igw", "net"], "v6": true, "text": ["The instance sends IPv6 traffic to the internet gateway.", "The gateway forwards it to the internet."] } ],
      "tables": [ { "x": 190, "y": 190, "title": "Route table", "tone": "networking", "cols": ["Destination", "Target"],
                    "rows": [ ["10.0.0.0/16", "local"], { "cells": ["::/0", "igw"], "on": "a", "v6": true, "tone": "ok" } ] } ]
    }
  }
}
```
Result (`svg` is a complete .svg file; `html` is the bare gallery `<svg class="awd">`; `story` is what the flows compile to):
```json
{
  "id": "x-ds",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" class=\"awd\" viewBox=\"0 0 480 300\" … data-mode=\"light\"><title>Dual stack</title><desc>…</desc><metadata id=\"awd-spec\" data-version=\"1\">…</metadata><style>…</style><defs>…</defs>…</svg>\n",
  "html": "<svg class=\"awd\" viewBox=\"0 0 480 300\" role=\"img\" aria-label=\"Dual stack\">…<path class=\"pk pk-v6\" d=\"M0,-4.76 L4.76,0 L0,4.76 L-4.76,0Z\" …>…</svg>",
  "errors": [],
  "lint": [],
  "story": {
    "timeline": [ { "wire": "a", "t": [0.04, 0.63], "ring": "igw", "v6": true }, { "wire": "b", "t": [0.635, 0.93], "ring": "net", "v6": true } ],
    "steps": [ { "n": 1, "at": "a", "f": 0.5 }, { "n": 2, "at": "b", "f": 0.5 } ]
  }
}
```
A row with `on` lights for every packet on that wire, the reply included; for a stateful
security group rule that should light for the request only, pin `t` to the request window
from `story.timeline`. A spec with problems returns `svg: null`, `html: null` and the reasons, e.g.
`"errors": ["nodes[0].lable: unknown property (did you mean label?)"]`.

### `lint_diagram`
Request:
```json
{ "name": "lint_diagram", "arguments": { "id": "sg-chain" } }
```
Result:
```json
{ "id": "sg-chain", "errors": [], "findings": [], "counts": { "error": 0, "warn": 0, "info": 0 }, "clean": true }
```
A port label at the middle of a wire that crosses two subnet frames:
```json
{
  "id": "x-tt-sg", "errors": [],
  "findings": [
    { "severity": "error", "code": "text-on-border", "message": "text \":8080\" crosses the frame pub border", "at": "500,152" },
    { "severity": "error", "code": "badge-on-text", "message": "badge 3 sits on text \":8080\"", "at": "500,149" }
  ],
  "counts": { "error": 3, "warn": 0, "info": 0 }, "clean": false
}
```
Move the label (`labelAt`, `labelDy`) and lint again.

### `import_diagram`
Request (CloudFormation with its flows sidecar and the security group rules as tables):
```json
{
  "name": "import_diagram",
  "arguments": {
    "content": "AWSTemplateFormatVersion: '2010-09-09'\nResources:\n  Vpc: …",
    "flows": { "name": "Dual-stack web app", "rules": true, "flows": [ { "id": "page-view", "v6": true, "steps": [ "…" ] } ], "…": "…" },
    "rules": true,
    "theme": "light"
  }
}
```
Result (abridged):
```json
{
  "spec": { "id": "cfn-dual-stack-web-app", "w": 1238, "h": 694, "tables": [ "… 4 tables …" ], "…": "…" },
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" …</svg>",
  "report": {
    "from": "cfn",
    "issues": [ { "severity": "info", "code": "kit-gap", "element": "EgressOnlyInternetGateway", "message": "the official icon set has no egress-only internet gateway: drawn with the internet gateway icon and labelled \"Egress-only internet gateway\"" } ],
    "unmapped": [], "tile": { "size": "full", "w": 1238, "h": 694, "fits": true }, "lint": [],
    "ledger": [ { "kind": "derived", "fact": "Vpc is a VPC (10.0.0.0/16)", "from": ["Vpc"] },
                { "kind": "derived", "fact": "Vpc is dual-stack: VpcIpv6Block gives it the IPv6 block 2001:db8:1200::/56", "from": ["VpcIpv6Block","Vpc"] }, "…" ],
    "rules": { "tables": [ { "id": "AlbSg-in", "group": "AlbSg", "dir": "in", "rows": 3, "lit": 1 }, { "id": "AppSg-in", "…": "…" }, { "id": "AppSg-out", "…": "…" }, { "id": "DbSg-in", "…": "…" } ],
               "omitted": [], "placed": "right" }
  }
}
```
draw.io, Mermaid, PlantUML and D2 work the same way (`content`, `from: "auto"`); a `.drawio.png` goes in `contentBase64`; raw Terraform HCL is refused with the commands that produce `terraform show -json`.

### `export_diagram`
Request:
```json
{ "name": "export_diagram", "arguments": { "id": "sg-chain", "to": "storyboard", "theme": "light" } }
```
Result (one still per numbered step):
```json
{
  "to": "storyboard",
  "frames": [
    { "n": 1, "at": 0.115, "text": "A client on the internet opens an HTTPS connection to the Application Load Balancer …", "svg": "<svg …>…</svg>" },
    { "n": 2, "at": 0.21, "text": "The load balancer opens its own connection to an instance on TCP 8080.", "svg": "…" },
    "…",
    { "n": 5, "at": 0.845, "text": "A probe for TCP 5432 from the internet reaches only the load balancer, …", "svg": "…" }
  ]
}
```
Other targets: `{ "to": "png", "theme": "light" }` gives `{ "to": "png", "at": "poster", "width": 1920, "height": 880, "base64": "iVBORw0K…" }`
(headless Chrome or Edge on the server), `{ "to": "svg", "at": "poster" }` a still with the poster's table rows lit,
`{ "to": "drawio" }` a `.drawio` file (the Prism spec, tables included, rides on a hidden layer),
`{ "to": "mermaid" }` a flowchart. An unknown `to` is `invalid_argument`.

---

## Raw stdio session (no client library)

You can drive the server by piping newline-delimited JSON-RPC to it:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"recommend_effects","arguments":{"intent":"a loading state that respects reduced motion"}}}' \
  | node cli.js start --catalog ../Prism.html --log-level silent
```

Each response is one line of JSON on stdout; logs (if any) go to stderr. The
`initialize` result carries the server instructions: the counts and the
pick, apply, theme and AWS guide.
