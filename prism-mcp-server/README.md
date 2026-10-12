# Prism MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes the **Prism component catalog** (3,587 self-contained CSS/SVG facets in 18 galleries, themed by 16 design systems in dark and light) and the **AWS architecture diagram kit** (87 animated gallery diagrams) as tools for agents.

An agent can ask for *"a KPI dashboard with revenue over time and the plan mix, in Duolingo Light"* and get the right components, themed and composed into **production-ready HTML/CSS**, or for *"a three-tier VPC with its security group rules"* and get an animated AWS diagram, a PNG or a draw.io file.

- **Zero runtime dependencies**: pure Node.js (18 or later). Speaks MCP JSON-RPC 2.0 over stdio, the transport Claude Desktop, Claude Code and the Anthropic API use for local MCP servers.
- **Reads the authoritative catalog**: `Prism.html` (the embedded `#prism-catalog` JSON island) or `catalog/manifest.json`.
- **Hot reload**: edits to the catalog file are picked up without a restart.
- **Picks by intent**: every facet carries derived selection metadata (role, layer, dataShape, motion), and `recommend_effects` maps a plain request onto it.
- **Applies like the app**: `compose` prepends the theme token block, returns the attributes the app stamps on `<html>`, the JS initializers with their source, and a standalone page on request.

---

## Quick start

```bash
cd prism-mcp-server

# Inspect the catalog (no server; prints stats and exits)
node cli.js info

# List the available tools
node cli.js tools

# Run the MCP server over stdio
node cli.js start --catalog ../Prism.html
```

Because it has no dependencies, there is nothing to `npm install`. (`npm link` or `npm i -g .` will expose the `prism-mcp` binary if you want it on your `PATH`.)

### CLI

```
prism-mcp start [options]     Run the MCP server over stdio (default command)
prism-mcp info  [options]     Print catalog metadata + stats, then exit
prism-mcp tools               List available tools, then exit
prism-mcp help                Show help

Options:
  --catalog <path>   Path to Prism.html or catalog/manifest.json
                     (default: ../Prism.html, else ../catalog/manifest.json)
  --no-watch         Disable catalog hot reload
  --log-level <lvl>  debug | info | warn | error | silent   (default: info)
```

> **Note on `--port`:** this build speaks MCP over **stdio**, which is how Claude Desktop and the Anthropic API launch local MCP servers (as a subprocess). A `--port` flag is accepted but ignored; an HTTP/SSE transport can be added by implementing another transport against `PrismMCPServer` (see *Architecture*).

---

## Use with Claude Desktop

Add the server to your `claude_desktop_config.json` (see `examples/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "prism": {
      "command": "node",
      "args": [
        "C:/path/to/prism-settings-and-custom-themes/prism-mcp-server/cli.js",
        "start",
        "--catalog",
        "C:/path/to/prism-settings-and-custom-themes/Prism.html"
      ]
    }
  }
}
```

Restart Claude Desktop; the 40 Prism tools appear in the tools menu.

## Use with the Anthropic API

The Messages API accepts local MCP servers via the `mcp_servers` parameter (stdio). Point it at the same `command`/`args` as above. See `examples/anthropic_api.md` for a full request example and a runnable Tool-Runner snippet using the Anthropic SDK.

---

## Choosing and applying components

The `initialize` response carries the same guide as server instructions (with the live counts), so an agent that reads nothing else still knows the path.

### Pick the component

| You need | Ask for | Notes |
|---|---|---|
| Anything, in plain words | `recommend_effects { intent }` | Reads the request into the filters below, ranks the matches (reduced-motion safe and no-JS first), one group per need, and says which rules it applied and what it relaxed. |
| A chart for your data | `search_effects { filters: { dataShapes: [...] } }` | `time-series` (a value over time: line, area, sparkline), `part-to-whole` (shares of one total: donut, pie, stacked 100%, treemap), `comparison` (bars, ranked lists), `distribution` (histogram, box plot), `correlation` (scatter, bubble), `flow` (sankey, funnel, tree, every AWS diagram), `geo` (maps), `single-value` (KPI tile, big number, gauge). |
| A component by purpose | `filters.roles` | `loading` (spinners, skeletons, progress), `feedback` (toasts, alerts, badges, status), `action` (buttons), `input` (fields, toggles, checkboxes), `navigation` (menus, tabs, breadcrumbs), `data-display`, `media`, `decorative`, `ambient`. |
| A backdrop behind content | `filters.usableAsBackground: true` | The authored flag (49 facets). `layer: "background"` is derived from the component type and also covers 40 foreground objects, so filter on the flag. |
| Something that floats | `filters.layers: ["overlay"]` | Toasts, tooltips, notifications, modals. |
| Motion that respects users | `filters.reducedMotionSafe: true`, or `selfAnimates: false` for no motion of its own | reducedMotionSafe means static, or the facet's css stops its animation under `prefers-reduced-motion: reduce`. |
| CSS only | `filters.needsJs: false` | 19 facets need a small JS initializer. |

Unknown `gallery`, `role`, `layer` or `dataShape` values (and an unknown `sort`) are `invalid_argument` errors that list the valid ones; `get_available_filters` and `list_filter_values` enumerate every facet.

### Apply it

1. `get_effect { id }` returns `html`, `css` and `apply`: the theme tokens the facet reads (`themeTokens`), its JS initializer with the source (`initializer`), its motion and what to do when it has no reduced-motion fallback, how to place a backdrop or an overlay, the recolor classes, and the `[data-mode="light"]` note.
2. `compose { ids, theme }` (or `compose_with_template` for a `stack`, `row`, `grid`, `card` or `backdrop` layout) returns one bundle:
   - `css` starts with the **theme token block**: a `:root` with every token of the theme (surfaces, `--control-line`, text, role colors and their on-fill inks `--accent-ink`..`--crit-ink`, font, radius and feel tokens) and `color-scheme`, then the `.c-*` recolor classes, then the deduplicated facet css. `theme` is a theme id (`duolingo-light`: one mode), a design system id (`duolingo`: **Auto**, dark with the light tokens under `prefers-color-scheme: light`, as a first visit to the app), or `none`; the default is `cloudscape` (Auto). `tokens` takes a custom palette instead: `derive_theme`'s `{ dark, light }` pair, or a flat map layered over a theme.
   - `rootAttributes`: `data-mode`, `data-theme`, `data-ds` to set on `<html>`, as the app stamps them. 902 facets carry `[data-mode="light"]` rules (light artwork, softer shadows, AWS icon colorways), so a light theme needs the attribute as well as the tokens. Auto returns `autoScript` instead, which keeps `data-mode` in step with the system.
   - `scripts`: each needed initializer with its source, to run once after the markup is in the page.
   - `apply`: the steps, in words. `document: true` adds a complete standalone HTML page.
3. Reduced motion needs nothing extra for facets with `reducedMotionSafe: true`: their css carries the media query.

### Theme it

A theme is a `:root` token swap over identical HTML and CSS. `get_theme_palette { theme }` returns the `:root` css, `rootAttributes`, the design system's `pair` and `autoCss`; `get_component_variants` and `get_variants_for_theme` show components across themes. For a brand, `derive_theme { accent }` returns a contrast-safe dark and light palette (pass its `{ dark, light }` to `compose` as `tokens`), and `check_theme_contrast` audits any token map or shipped theme.

### Draw an AWS architecture

1. `get_diagram_spec` with no id lists the 87 gallery diagrams (plus the kit example) by family with the kit primitives each uses: `tables`, `flows`, `v6`, `note2` (two-line IPv4 and IPv6 frame notes), `effects`, `poster`, `moment`. Start from the closest one: `sg-chain` for security group rule tables, `v6-dual-stack` for flows, IPv6 packets and dual-stack notes.
2. `resolve_aws_icon` maps any name (text, CloudFormation, Terraform, draw.io, Mermaid, PlantUML, Python diagrams) to an icon id; containers such as a security group or a subnet are frames (`groups[].kind`).
3. Edit the spec and `build_diagram` it: `flows` say the request path (`{ path, reply, text, v6 }`), `tables` are rules and routes cards whose rows light per packet, and `story` returns the compiled windows. Fix the `lint` errors (`lint_diagram` checks without building).
4. `export_diagram` writes an animated or still svg, a moment (`at`, or the spec's `poster`), a PNG, a storyboard (one still per step), draw.io or Mermaid. `import_diagram` goes the other way, from draw.io, Mermaid, PlantUML, D2, CloudFormation or Terraform (`rules: true` draws security group tables).

---

## Tools (40)

### Discovery & search (12)
| Tool | Purpose |
|------|---------|
| `recommend_effects` | From a plain request (`intent`) to ranked facets: reads role, dataShape, backdrop, motion, JS, the AWS gallery and a named theme; one group per need (a dashboard with a trend and a breakdown gets two); `rules` say why, `relaxed` says what was dropped when nothing matched; `next` says how to apply. Optional `filters` add to what the intent says. |
| `list_effects` | List effects with filters (gallery, tag, componentType, role, layer, dataShape, background, new) + pagination. Returns light metadata. |
| `search_effects` | Faceted relevance search: full-text ranking + a `filters` object (gallery, componentType, spectrum, category, **role**, **layer**, **dataShape**, tag [AND], interaction) + boolean flags (incl. `themeSensitive`, **`selfAnimates`**, **`reducedMotionSafe`**, `needsJs`, `usableAsBackground`) + `sort` + pagination. |
| `get_available_filters` | Describe every facet with its top values + counts, the boolean flags (with `themeSensitive`), and valid sort options. |
| `list_filter_values` | Enumerate the full value set for one facet (e.g. all 252 categories) with per-value counts + prefix filtering. |
| `create_saved_search` | Save a named query+filters+sort (session memory) and get an id back. |
| `get_saved_searches` | List saved searches for this session. |
| `execute_saved_search` | Run a saved search by id (with optional sort/limit override). |
| `get_effect` | Full record for one effect incl. production-ready `html`/`css` and the `apply` guide (theme tokens, initializer source, motion, backdrop placement). A missing id is `invalid_argument`; an unknown one returns `not_found` with suggestions. |
| `get_theme_variants` | The default theme block (`tokensCss`, Cloudscape in Auto), the role, on-fill ink and surface tokens, how to recolor an effect, every theme id and the design systems with their dark and light ids. |
| `list_galleries` | All galleries with declared vs. live effect counts. |
| `get_catalog_stats` | Aggregate stats: per-gallery counts, tags, componentTypes, etc. |

> **Facets are grounded in real catalog data.** Available facets: `gallery`, `componentType`, `spectrum` (visual aesthetic), `category`, `role`, `layer`, `dataShape`, `tag`, `interaction`. Interaction values are **normalized** from noisy source data (`tatic` to `static`, `focu` to `focus`, `croll` to `scroll`, multi-value strings/arrays split). The `themeSensitive` facet is **derived** (does the component consume theme tokens?), not a stored field. Saved searches are per-process (in-memory), not persisted to disk.
>
> **Selection metadata.** `role`, `layer`, `dataShape` and `a11y` are derived deterministically from existing fields (componentType, gallery, category, name, interaction, per-facet CSS) by the repo pipeline (`catalog/selection-vocab.json`, `catalog/_derive_selection.mjs`) and gated so they cannot go stale. `role` and `dataShape` also feed full-text ranking (de-hyphenated, so `"time series"` matches `time-series`).

### Component Variant Matrix (3)
| Tool | Purpose |
|------|---------|
| `get_theme_palette` | Token palette for one theme (or all 32): complete token map (on-fill inks, `--control-line`, the pack's `--cs-topnav-*` top bar with `--cs-topnav-accent` where the bar is the accent), overrides vs the Cloudscape Dark base, mode, and a paste-ready `:root{...}` block. One theme also returns `rootAttributes`, `pair` (its design system's dark and light ids), `autoCss` and `autoScript`. Prism ships 16 design systems in dark and light: Cloudscape (`cloudscape-dark` is the base), Duolingo, Mailchimp, Stack Overflow, Monzo, Heroku, Shopify Polaris, GitHub Primer, Ant Design, Firefox Acorn, Material Design 3, Cloudflare Orange, Frutiger Aero, Liquid Glass, Google Cloud Console and Fluent (Azure). |
| `get_component_variants` | Every theme variant of one component. Prism themes are pure `:root` token swaps over identical HTML/CSS, so this returns the payload **once** plus each theme's token overrides (and the subset the component actually consumes), not N copies. |
| `get_variants_for_theme` | Components rendered under a single theme, each with the token values it uses; supports gallery/componentType/spectrum/tag + `themeSensitiveOnly` filters + pagination. |

> **Variants are token swaps, not copies.** A "variant" is the same component under a different `:root` token set, the exact mechanism Prism's live theme engine uses. Rendering a variant = component `html` + `css` + the chosen theme's token block, with `data-mode` set on `<html>`.

### Themes (2)
Theme derivation with the engine in `catalog/theme-engine/` (zero-dependency ES modules), found beside the catalog file the same way as the AWS kit: `catalog/theme-engine/` next to `Prism.html`, or `theme-engine/` next to `catalog/manifest.json`. Without it both tools return `unavailable`.

| Tool | Purpose |
|------|---------|
| `derive_theme` | Brand inputs (`accent`, optional `name`, `secondary`, `neutral`: brand, cool, warm, neutral or a hex, `mode`, `contrast`: AA or AAA, `radius`, `density`, `font`) in; every theme token for dark and light out, including `--control-line` and an on-fill ink per role (`--accent-ink` to `--crit-ink`). The accent keeps its hue and only its OKLCH lightness moves, per mode, when it misses a floor (4.5:1 text on the panels, 3:1 UI on bg, a readable ink on fills; 7:1 text at AAA). Neutrals keep the brand hue at low chroma; status colors take the conventional hues at the accent's chroma and one shared lightness. Deterministic. Returns `{ name, dark, light, css: { dark, light }, report }`; `report` lists every checked pair (`ratio`, `floor`, `pass`, APCA `apca`) and every moved input with a message such as `accent #ffd400 too light for text on a light panel: darkened to #897000, L 0.88 to 0.55`. Use it with `compose { tokens: { dark, light } }`. |
| `check_theme_contrast` | Audit a token map (`tokens`, partial or full; rgba surfaces are composited) or a shipped `theme` against the same pairs and floors, plus the top bar pairs Prism's theme gate holds (`--cs-topnav-accent`, else `--accent`, as UI on `--cs-topnav-bg`; its ink on that fill). Missing tokens are filled from the Cloudscape base of the `mode` (inferred when omitted) and the shell's top-bar defaults, the way Prism layers a pack, unless `fill: false`. Returns `{ mode, contrast, pass, checked, failures, pairs, skipped, filledFromBase }`. |

### Composition (3)
| Tool | Purpose |
|------|---------|
| `compose` | Merge effects into one bundle themed like the app: css led by the theme token block (`theme`, `tokens`), deduped facet css, merged HTML (AWS icon sprites merged into one), `rootAttributes` or `autoScript`, `scripts` (initializer sources), `apply` (steps), composition `conflicts`/`backgroundConflict`, validation and size metrics; `document: true` adds a standalone page. Optional wrapper element (a plain element name). |
| `compose_with_template` | `compose` plus a layout template: `stack`, `row`, `grid`, `card` (each effect in a padded panel: a dashboard of tiles) or `backdrop` (a hero: the first backdrop is stretched behind the other effects). |
| `validate_composition` | Check a set of ids composes cleanly without building output: missing ids, JS needs, `conflicts` (CSS selectors two effects define differently, so the later silently wins when bundled) and `backgroundConflict` (more than one backdrop: only one renders). |

### Content creation (3)
| Tool | Purpose |
|------|---------|
| `create_facet` | Validate + register a new facet into the live catalog (in-memory, instantly discoverable). |
| `update_facet` | Update fields of an existing facet, re-validated. |
| `validate_facet` | Validate a facet definition (id/kebab-case, metadata, HTML presence, CSS soundness, token references: every theme token, the on-fill inks and `--control-line` included) without creating it. |

### Catalog management (3)
| Tool | Purpose |
|------|---------|
| `get_catalog_metadata` | Catalog name/version/source/counts, source path, hot-reload status. |
| `export_collection` | Export a self-contained bundle from a saved `collectionId`, an explicit set of `ids`, or a whole gallery, themed like `compose` (`theme`, `tokens`). `format`: `bundle` (CSS+HTML+scripts, default), `document` (full `<html>` with the root attributes and the initializers), or `schema` (portable `prism-collection-1.0` JSON, saved collections only). |
| `get_token_reference` | Canonical token reference: the default theme block, every token with its purpose (surfaces, `--control-line`, text, roles, on-fill inks, font, radius, feel, the top bar), the recolor classes and the root attributes. |

### AWS Architecture Icons (3)
The official AWS Architecture Icons behind the AWS Architecture gallery, read from the gallery's embedded sprite in `Prism.html` (or `catalog/aws-icons/aws-icons.json` beside a manifest). The sprite carries names and aliases; with `Prism.html` the server also merges the metadata of `catalog/aws-icons/aws-icons.json` beside it (crosswalks, short names, status) when that file is present. Names resolve through `catalog/aws-icons/resolve.mjs`, the resolver `awd.mjs` and the importers use; a server copied out of the repository falls back to word-start search. The gallery's own diagrams already carry their icons in `get_effect` html; these serve new diagrams.

| Tool | Purpose |
|------|---------|
| `search_aws_icons` | Search icons by words over name, id, service, category, aliases and crosswalk names (`query`, optional `kind`: service, resource, group, category; `limit`, `offset`). Words match whole words or word starts (`ecr` never finds Secrets Manager); exact names, abbreviations and old names (S3, NACL, DAX, Elasticsearch, QuickSight) rank first. Dark/light colorway pairs collapse into one result keyed by the base id; retired and renamed icons carry `status`. A container such as "security group" has no icon: the result carries `frame.group` (`sg`), the frame kind to draw. |
| `resolve_aws_icon` | Pick one icon for a name from any source: free text, draw.io styles, Mermaid/Iconify keys, PlantUML macros, Python `diagrams` classes, CloudFormation or Terraform types (`query`, optional `from`, `props` for property picks such as `{"Type":"network"}` or `{"Engine":"postgres","MultiAZ":true}`, `prefer`: service, resource, node, group). Returns `id` and `name`, `kind` node or group (with the awd frame kind: vpc, pub, priv, sg, az...), `confidence` 0..1, `how`, ranked `candidates`, `warnings` (retired, renamed, missing property, ambiguous, no icon such as the egress-only internet gateway, which the kit draws with `aws-res-vpc-internet-gateway`); `id` is null when nothing is good enough. |
| `get_aws_icon` | One icon, unmodified, as standalone SVG (`format: "svg"`, `size`) or as a `<symbol>` for a page sprite. A colorway base id returns the light-background artwork unless `colorway: "dark"`. Retired, end-of-support and renamed icons include `status` and `warnings`. Unknown ids return `not_found` with suggestions (a typo such as `aws-svc-lamda` gets `aws-svc-lambda`). |

### Collections & favorites (6)
Saved, named sets of effects that persist across sessions (disk-backed JSON). Constraints: name at most 50 chars and unique, description at most 200 chars, at most 5 tags and 50 components; duplicate ids are collapsed.
| Tool | Purpose |
|------|---------|
| `list_collections` | List saved collections as lightweight summaries (most-recently-updated first). |
| `get_collection` | Get one collection incl. its full component list (`{id, name, gallery}`). |
| `create_collection` | Create a named collection; effect ids are validated against the catalog and stored with their name+gallery. |
| `add_to_collection` | Add effects to a collection (dedup + 50-component cap); reports added/skipped. |
| `remove_from_collection` | Remove effects from a collection by id; reports the count removed. |
| `delete_collection` | Delete a collection entirely. |

> Export a saved collection for the Prism.html UI with `export_collection { collectionId, format: "schema" }`: the resulting `prism-collection-1.0` JSON is the cross-surface bridge between the MCP server and the in-browser Collections panel.

### AWS Architecture diagrams (5)
Diagrams as data. A diagram is a JSON spec (schema: `catalog/aws-kit/spec.schema.json`, reference: `catalog/drafts/AWS_KIT.md`) compiled by the same AWS kit that builds the gallery (`catalog/aws-kit/awd.mjs`), found beside the catalog file: `catalog/aws-kit/` next to `Prism.html`, or `aws-kit/` next to `catalog/manifest.json`. Without it all five tools return `unavailable`. The gallery holds 87 diagrams in 11 families: serverless, three-tier, directory, databases, regions, vpc, security (`sg-*`: security groups and network ACLs), ipv6 (`v6-*`: dual stack), transit, endpoints and dns.

| Tool | Purpose |
|------|---------|
| `build_diagram` | Build one diagram spec, or every diagram of a family (`{ version: 1, section, diagrams }`). The spec's primitives: `groups` (frames; a two-line `note: ["10.0.1.0/24", "2001:db8:1::/64"]` shows both CIDRs of a dual-stack subnet), `nodes`, `wires`, the story as `timeline` + `steps` (with `moment` to pin a storyboard frame) or as `flows` (`{ path, reply, text, kind, v6 }`, compiled to packets, rings and numbered steps; `v6` draws IPv6 packets as diamonds), `tables` (rules and routes cards: a row with `on` lights while a packet crosses that wire, the reply included; `t` pins its window), `effects`, `notes`, `marks`, `legend`, and `poster` (the moment a still export shows). Runs the schema and the kit's input checks and returns `{ id, svg, html, errors, lint, story }`: `svg` is one self-contained SVG document (kit CSS, only the icons it uses, the spec in `<metadata id="awd-spec">`; `theme`: auto, light or dark; `still`: no packets), `html` is the bare `<svg class="awd">` the gallery embeds, `story` (a spec with flows) is the compiled timeline and steps. Both are null when `errors` is not empty (typos come back as `nodes[0].lable: unknown property (did you mean label?)`). |
| `get_diagram_spec` | The JSON spec of one gallery diagram by catalog id (`aws-sg-chain`) or spec id (`sg-chain`), from `catalog/aws-kit/json/`: far smaller than the rendered `get_effect` html, and the starting point for an edited copy. Without an id it lists the gallery by family with each diagram's `features` (`tables`, `flows`, `v6`, `note2`, `effects`, `poster`, `moment`, `marks`, `legend`), filterable by `family` and `feature`. Unknown ids return `not_found` with suggestions. |
| `lint_diagram` | Layout findings for a diagram spec or a gallery diagram id, measured on the drawn markup with Arial's real widths: `{ id, errors, findings: [{ severity, code, message, at }], counts, clean }`. Errors are what the gallery build rejects (text across a frame edge, wires through labels or icons, badges on icons, off-canvas, and for tables `table-on-border`, `table-overlap`, `wire-on-table`); warnings include `step-text` and `step-order`; `build_diagram` returns the same findings as `lint`. |
| `import_diagram` | Import a design: draw.io (`.drawio` XML plain or compressed, `.drawio.svg`; `.drawio.png` as `contentBase64`), Mermaid `architecture-beta` or `flowchart`, PlantUML-AWS, D2, CloudFormation (JSON or YAML, CDK synth output, SAM after transform) or Terraform (`terraform show -json` of a plan or a state; raw HCL is refused with what to run) (`from`: auto detects). Icons resolve to the official AWS icons (unmapped shapes become boxes and are listed), groups to AWS frames, the layout fits a kit tile and passes the kit lint, and the source's order (numbered badges or edges, `%% prism: flow`, or for IaC the `flows` sidecar: actors, request flows, stories) becomes the animation. CloudFormation and Terraform infer subnets (public, private or isolated from the route tables), AZ positions, placement and edges, and `report.ledger` lists every fact as derived, assumed (with a question for the customer) or dropped; `params` overrides CloudFormation parameter defaults; without a sidecar IaC has no animation unless `story` is `guess`. `rules` (`true`, a list of security groups, or `{ groups, outbound }`; the sidecar may carry it too) draws security group rules as tables beside the drawing, with console columns (Type, Protocol, Port range, Source), IPv4 and IPv6 sources on their own rows, prefix lists and group references by name, the default all-outbound and the implicit deny muted, and the row that admits each story packet lit while it crosses; every row is a ledger fact and groups left out for room are listed in `report.rules`. Dual-stack subnets show both CIDRs as a two-line frame note, an egress-only internet gateway is drawn, and a sidecar flow with `v6` sends IPv6 diamonds. Returns `{ spec, svg, report: { from, issues, unmapped, tile, lint, ledger?, rules? } }`. |
| `export_diagram` | Export a gallery diagram (`id`) or a spec to `drawio` (opens in diagrams.net with the official AWS shapes; the Prism spec, tables included, rides on a hidden layer so a re-import restores the animation), `mermaid` (flowchart with AWS icon shapes, or `dialect: architecture-beta` for a consistent grid), a standalone `svg` (`still` for the static diagram, `at: 0.5` or `at: 'poster'` to freeze the animation at a moment, failed frames red, packets in place and table rows lit), a `png` of such a moment (headless Chrome or Edge on the server; `scale`, default 2; `at` defaults to the poster), or a `storyboard`: one still per numbered step. Returns `{ to, text }`, `{ to, at, width, height, base64 }` for a PNG, or `{ to, frames: [{ n, at, text, svg }] }`. An unknown `to` is `invalid_argument`. |

Full parameter schemas are returned by `tools/list`. Per-tool example calls live in [`examples/`](./examples).

---

## Facet creation flow (draft, validate, register, embed)

1. Agent calls `validate_facet` (or `create_facet`, which validates first) with `{id, name, gallery, html, css, ...}`.
2. Validation checks naming (lowercase kebab-case), required metadata, HTML presence, CSS structural soundness, and token references.
3. On success `create_facet` registers the facet into the **live** catalog: it is immediately returned by `list_effects` / `search_effects` / `get_effect` with **no restart** (`persisted:false`).
4. To persist to disk, run the repository's catalog pipeline (`extract-from-prism.mjs`, then `catalog/_embed-catalog.mjs`) to embed the facet into `Prism.html`. With hot reload on, the server re-reads the file and the facet becomes permanent (`persisted` on the next load).

> **Source-of-truth note:** the `#prism-catalog` island in `Prism.html` is authoritative; `catalog/manifest.json` is rebuilt from it by the extractor. Point `--catalog` at `Prism.html` for the complete catalog and the AWS icon sprite. The island's own `tokens.css` is the legacy Prism palette; the tools theme with the registry in `utils/themes.js`, which mirrors the app's themes.

---

## Architecture

```
prism-mcp-server/
├── index.js          # PrismMCPServer (JSON-RPC dispatch, server instructions) + StdioTransport
├── cli.js            # prism-mcp CLI (start / info / tools / help)
├── tools/
│   └── index.js      # the 40 tool definitions (name, description, schema, handler)
├── utils/
│   ├── catalog.js    # CatalogStore: load island/manifest, index, hot reload, runtime facets, initializers
│   ├── collections.js# CollectionStore: disk-backed named sets + prism-collection-1.0 export
│   ├── css.js        # split/dedupe/merge/validate CSS; token extraction
│   ├── compose.js    # composition engine + layout templates (stack, row, grid, card, backdrop)
│   ├── apply.js      # theme token blocks (fixed or Auto), root attributes, initializer scripts, documents, the per-effect apply guide
│   ├── recommend.js  # reads a plain request into selection filters (recommend_effects)
│   ├── validate.js   # facet + composition validation
│   ├── themes.js     # canonical theme token maps (variant matrix), mirrors Prism.html THEMES
│   ├── icons.js      # AWS Architecture Icons: sprite/store parsing, search, colorways, the shared name resolver
│   ├── diagrams.js   # AWS kit beside the catalog: build diagram specs, serve the gallery's specs
│   ├── theme-engine.js # theme engine beside the catalog (catalog/theme-engine): derive_theme, check_theme_contrast
│   └── logger.js     # stderr logger (never pollutes the stdio JSON-RPC channel)
├── examples/         # one example request/response per tool + integration configs
└── test/             # node:test integration + unit tests (206 tests)
```

**Server model.** `new PrismMCPServer(catalogPath, opts)` builds the tool registry and a `CatalogStore`. `await server.load()` reads + indexes the catalog. `server.connect(transport)` wires a transport; `StdioTransport` implements newline-delimited JSON-RPC on stdin/stdout. The transport is pluggable: implement `onMessage(cb)` / `send(obj)` to add HTTP/SSE.

**Error handling.** Protocol errors (bad method / unknown tool) return JSON-RPC errors. Tool-level failures (unknown id, an unknown filter value, validation failure) return an MCP tool result with `isError: true` and a structured `{error, code, data}` payload with actionable messages, valid values and suggestions.

**Logging.** Request + composition trace logs go to **stderr** (stdout is reserved for the JSON-RPC channel). Control verbosity with `--log-level` or `PRISM_MCP_LOG_LEVEL`.

---

## Testing

```bash
node --test          # or: npm test
```

206 tests cover every tool (incl. the advanced-search & variant-matrix tools, `recommend_effects` and intent reading, the `themeSensitive` facet, the closed vocabularies, `compose` with fixed, Auto and custom palettes, standalone documents and the backdrop template, the `apply` guide, the 6 Collections tools + `export_collection` formats, the 3 AWS icon tools against a fixture sprite and the real one, the AWS diagram tools against the real kit and gallery specs (the security and IPv6 families, tables, flows, IPv6 packets, two-line notes, the gallery index), and the 2 theme tools against the real engine, top bar pairs included), the CSS/compose/validate utilities, the canonical theme token maps, the `CollectionStore`, the JSON-RPC protocol layer and the server instructions, and loading the real `Prism.html` island. The PNG export test skips when no Chrome or Edge can draw.

---

## License

MIT
