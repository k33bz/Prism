# AWS Architecture kit: authoring guide

Diagrams for Prism's **AWS Architecture** gallery are written as **specs** (plain JS data, or the
same data as JSON: see [JSON specs](#json-specs)) and compiled to self-contained SVG by
`catalog/aws-kit/awd.mjs`. The output uses the **official AWS Architecture Icons** (embedded once
as a sprite, referenced by id), official group frames, numbered steps, and motion on **one clock per
diagram** (SMIL: no runtime JS). Styling lives in `catalog/drafts/aws.css`. The exemplar is `catalog/aws-kit/specs/example.mjs`: read it first.

## Workflow
```bash
node catalog/aws-kit/awd.mjs icons lambda              # find icon ids (matches id/name/service/aliases)
node catalog/aws-kit/awd.mjs preview catalog/aws-kit/specs/<family>.mjs        # dark preview + validation
node catalog/aws-kit/awd.mjs preview catalog/aws-kit/specs/<family>.mjs light  # light preview
node catalog/aws-kit/awd.mjs build   catalog/aws-kit/specs/<family>.mjs        # -> catalog/drafts/<family>.aws.html
node catalog/aws-kit/awd.mjs export-json catalog/aws-kit/specs/<family>.mjs   # -> catalog/aws-kit/json/<family>.json
node catalog/aws-kit/awd.mjs svg catalog/aws-kit/json/<family>.json <diagram id> --theme light --out x.svg   # one standalone .svg
```
`build` and `preview` take a `.json` family as well as a `.mjs` one; `build --out <file>` writes
somewhere other than `catalog/drafts/`. After editing a family `.mjs`, run `export-json` for it too
(the tests fail while `json/` is stale).
Screenshot a preview (SMIL advances under the virtual-time budget; take 2 budgets to see motion):
```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu --hide-scrollbars \
  --user-data-dir="<fresh temp dir per shot>" \
  --virtual-time-budget=1500 --window-size=1100,1400 --screenshot="<abs path>.png" "file:///<abs path to preview>.html"
```
Use a fresh `--user-data-dir` for every shot: if a previous Edge still holds the profile, the new
one hands off to it and exits without writing the PNG. `--screenshot` returns before the PNG is
written, so poll for the file (up to ~20 s) instead of checking once. Wrap calls in `timeout 90`.
If you drive Edge over CDP (`--remote-debugging-port`), shut it down with `Browser.close` (see
`closeBrowser()` in `catalog/_chrome.mjs`); killing the spawned process leaks the browser and its
children, and dozens of leaked instances pin the CPU for everyone.

Assemble the gallery page in `Prism.html` (maintainer step: re-scaffolds `pg-aws` with the full icon
sprite and the legend, splices the family drafts in order, then the icon library):
```bash
node catalog/aws-kit/build-gallery.mjs                    # every built family
node catalog/aws-kit/build-gallery.mjs serverless,vpc     # only these
```
Then run the usual catalog pipeline (extract, derive, embed, facet dates, gates). The extractor copies
each diagram's referenced `<symbol>`s into its catalog `html`, so MCP output stays self-contained.

## Spec reference
```js
export default {
  section: { id: 'serverless', title: 'SERVERLESS' },          // id -> drafts/<id>.aws.html, title -> <h3>
  // a JSON family file also carries version: 1
  diagrams: [{
    id: 'sl-api',            // unique across the WHOLE gallery: prefix with your family code (sl-, tt-, ds-, db-, mr-, vp-, tg-, ep-, dns-)
    name: 'Serverless REST API',   // tile title
    desc: '1-2 plain sentences: what the architecture is and what animates. No em dashes.',   // also the svg <desc>
    aria: 'optional aria-label (default: name)',  ctype: 'diagram-arch',  ref: 'svg.awd',      // optional tile metadata
    wide: false,             // true -> tile spans 2 columns: use w:960
    w: 480, h: 236,          // viewBox. Normal: w 480, h <= 300. Wide: w 960, h <= 440.
    dur: 6,                  // seconds; the single clock every animation in this diagram shares (6-10)
    groups:  [ { kind, x, y, w, h, label?, id?, icon?:false|'<icon id>', note?, align?:'left'|'center' } ],   // draw OUTER groups first
    nodes:   [ { id, icon /* or [darkId, lightId] */, x, y, size?:40, label?, wrap?:14, sub? } ],
    wires:   [ { id, from, to } | { id, d:'M..H..V..' } ,  dashed?, both?, flow?, label?, labelAt?:0.5, labelDx?, labelDy?:-5, labelAnchor?, via?, arrow?:false, hot? ],
    steps:   [ { n, at:'<wire id>', f?:0.5, dx?, dy?:-11 } | { n, x, y } ],
    timeline:[ { wire?, t:[a,b], reverse?, kind?:'pk'|'pk-2'|'pk-bad', ring?:'<node id>', r? } ],
    effects: [ { appear:'<node id>', t:[a,b], ghost?:true } | { fail:'<group id>', t } | { fade:'<wire id>', t } | { glow:'<wire id>', t } ],
    notes:   [ { x, y, text, kind?:'caption'|'label'|'warn', anchor?:'start'|'middle'|'end', t?:[a,b] } ],
    extra: '<raw svg appended last>',   // escape hatch for anything the kit lacks (checked: see Input checks)
  }],
};
```
**Groups** (`kind`): `cloud` (AWS Cloud), `region`, `az` (Availability Zone, dashed teal), `vpc`, `pub`
(public subnet), `priv` (private subnet), `sg` (security group), `asg` (Auto Scaling group), `acct`
(AWS account), `dc` (corporate data center), `server`, `ec2`, `spot`, `gen` (generic dashed).
The corner icon and label are automatic; override `label` (e.g. `'us-east-1'`, `'Private subnet 10.0.3.0/24'`).
Frames without an icon (`az`, `sg`, `gen` without `icon`) center their header, as in the AWS deck;
`align` overrides that per group. `ec2` and `spot` frames are solid, `asg`, `az`, `region` and `gen` dashed.
Give a group an `id` if an effect targets it. `note` prints right-aligned on the group's top edge
(a CIDR, `0.0.0.0/0 > tgw`, an account id). `icon` may be any icon id, e.g. a `gen` frame for an
ECS service or a state machine gets that service's icon in its corner.

**Nodes**: `icon` is an id from the store: services `aws-svc-*`, resources `aws-res-*`. For icons
that ship as official colorway pairs (Users, Client, Office building, Servers, Internet...) pass the
base id (`aws-res-users`): the generator emits both and the theme picks one. Size 40 is standard;
use 32 for resource icons in dense diagrams, and keep one size within a diagram. Labels are the
official name, wrapped at 14 chars (raise `wrap` rather than let a label run to 3 lines).

**Wires** auto-route from node to node (straight when aligned, one elbow otherwise; `via` pins the
elbow). Use explicit `d` with only `M`, `H`, `V` commands when you need a specific path. `dashed`
= async/optional/logical, `both` = bidirectional, `flow` = continuous stream (CSS dash motion),
`hot` = red wire and head (blocked or failing path). Heads are the open arrow of the AWS deck.
`label` sits at the path's midpoint; move it with `labelAt` (0..1 along the path) when the midpoint
lands on a vertical run. Wires are opaque, so two wires may share a segment without doubling up. `labelDy` moves the label
(default -5 = above; +12 = below), `labelDx` sideways, `labelAnchor: 'start'` sets it beside a
vertical run.

**Notes** are free captions drawn on top of everything: tier names, DNS answers, route summaries,
"cache miss", "standby promoted". `kind: 'warn'` is red, `'label'` is ink, default is the muted
caption style; `\n` breaks lines; `t: [a,b]` shows a note only during that window. Prefer notes over
`extra` text.

**Timeline**: each entry moves a packet along a wire during window `[a,b]` (fractions of `dur`,
`0 < a < b < 1`) and optionally pulses a `ring` on a node when the packet arrives (at `b`).
`pk` = request (AWS orange), `pk-2` = response/replication (blue), `pk-bad` = failed traffic (red).
Packet colors are fixed rather than the theme accent, so the two stay distinct in every design
system; a page can override them with `--awd-request` / `--awd-response`.
`reverse:true` runs the wire backwards. Tell one readable story per cycle: sequential windows with
small gaps, responses after requests, leave ~0.05 idle at the end before the loop.

**Effects** (all on the same clock): `appear` shows a node (icon and label) only during the window
(scale-out / scale-in; place the node as normal and it is hidden outside the window; under reduced
motion it is shown, so the still diagram is complete; `ghost: true` keeps a 30% copy in place outside
the window, so a scale-out slot reads as empty rather than missing), `fail` turns a group red
with an X (AZ/Region outage), `fade` dims a wire (traffic drained), `glow` highlights a wire (traffic
rerouted). Pair `fail` + `fade` + `glow` to tell a failover story.

**Style** follows the AWS Architecture Icons deck: Arial Regular, group labels in ink (the frame and
its icon carry the color), open arrowheads near black on light and near white on dark, solid subnet
frames, teal dashed Availability Zones (`--awd-az` to change it). Stills (print, screenshots,
exports) set `data-still` on the svg or an ancestor: packets and rings are hidden and the static
diagram shows, as under reduced motion. `preview <spec> [light] still` writes such a page.

**Input checks**: `build` and `preview` reject a spec before writing markup when an id is not
`[A-Za-z0-9_-]+`, a coordinate is not a finite number, a wire `d` uses anything but `M H V L`, a
reference (wire end, step `at`, ring, effect target) names nothing, a window is outside
`0 < a < b < 1`, an enumeration (`kind`, `anchor`, `labelAnchor`, `align`) is unknown, or `extra`
holds script, `on*=` handlers, `foreignObject`/`style`/`iframe`, or an `href`/`url()` that is not a
`#fragment`. A `.json` family is also checked against `spec.schema.json` first, so a typo such as
`lable` fails with `diagrams[0].nodes[2].lable: unknown property (did you mean label?)`.
Tests: `node --test catalog/aws-kit/awd.test.mjs`.

## JSON specs
`catalog/aws-kit/spec.schema.json` (JSON Schema 2020-12) describes a family file
`{ version: 1, section: { id, title }, diagrams: [...] }` and every field the generator reads; the
kit checks (`checkSpec`) add what a schema cannot say (references resolve, ids are unique, icon ids
exist, `b > a` in windows, safe `extra`). `catalog/aws-kit/spec.mjs` validates the subset of JSON
Schema the schema uses (no dependencies; an unsupported keyword in the schema is an error) and
writes the canonical form. `catalog/aws-kit/json/<family>.json` holds the canonical export of each
family `.mjs` (and the example): known keys in schema order, nulls dropped, keys the generator does
not read dropped and reported (`cx`/`cy` from node helpers, timeline `tag`), 2-space indent with one
node, wire or timeline entry per line. Building from the JSON gives byte-identical output to building
from the `.mjs` (tested). The `.mjs` files stay the authored source for now; the JSON is what tools,
importers and the MCP (`get_diagram_spec`, `build_diagram`) read and write.

## Semantic markup
The generated SVG says what it draws, without changing any coordinate, class or draw order:
- the `<svg>` starts with `<title>` (the diagram name) and `<desc>` (its `desc`);
- every drawn node is wrapped in `<g class="awd-n" data-node="<id>" data-icon="<icon>">` with a
  `<title>` holding its label (or the icon name when it has none). A node with an `appear` effect is
  drawn more than once (ghost, still and animated copies), so it has one wrapper per copy; the
  wrappers carry no `id`, which keeps every id in the page unique;
- wires that name their ends carry `data-from` / `data-to` (wires with an explicit `d` do not).
Find a node with `svg.querySelectorAll('.awd-n[data-node="apigw"]')`.

## Standalone SVG
`standalone(spec, { theme: 'auto'|'light'|'dark', still: false })` (CLI: `svg <spec> <diagram id>
[--theme light|dark|auto] [--still] [--out file]`, stdout without `--out`; the id may carry the
catalog's `aws-` prefix) returns one self-contained SVG document for files, `<img src>`, READMEs and
slides: `xmlns`, `width`/`height` from the viewBox, the kit CSS (the diagram rules of `aws.css`,
without the gallery chrome) inlined in `<style><![CDATA[...]]>`, only the `<symbol>`s it uses in
`<defs>`, and the canonical spec as JSON in `<metadata id="awd-spec" data-version="1">`. `theme`
light or dark sets `data-mode` on the root (and a matching `color-scheme`, so a browser paints a dark
canvas behind a dark export); `auto` follows `prefers-color-scheme`. `still` sets `data-still`: no
packets or rings, the complete static diagram (the still is the healthy state; failure windows are
not shown). SMIL keeps running inside `<img>` in Chromium browsers. For a page that switches themes,
export a light and a dark file and pick with `<picture>`.

## Layout rules (the bar is "looks like an official AWS reference architecture")
- 16px padding inside groups; leave 22px at the top of a group for its corner icon + label.
- Nothing overlaps: labels never cross wires, icons, group borders or other labels (>= 6px clear).
- Align nodes on a grid; equal spacing; wires straight wherever possible; no wire crosses a label.
- Users / clients / on-prem sit OUTSIDE the AWS Cloud frame (left), AWS services inside.
- Steps 1..n follow the request path left to right / top to bottom; badges sit on wires, not on borders.
- Prefer two AZs side by side for HA designs; show CIDRs on subnets when it helps the story.
- Wide tiles for designs that need it (multi-VPC, multi-region, hybrid/on-prem with trusts).

## Accuracy rules (the audience is an AWS TAM)
- Only real AWS patterns and real service relationships, as documented in AWS reference
  architectures and service docs. When unsure, simplify rather than invent.
- Correct placement: ALB and NAT gateways in public subnets; app/DB tiers in private subnets; one NAT
  gateway per AZ; RDS Multi-AZ standby in a different AZ; Aurora storage spans 3 AZs; Managed
  Microsoft AD = two domain controllers in two AZs; Transit Gateway attachments per AZ.
- Use the official service/resource names in labels (e.g. "AWS Managed Microsoft AD", "Amazon Aurora").

## Rules for parallel authors
- Write ONLY your own files: `catalog/aws-kit/specs/<family>.mjs`, its previews/screenshots, the
  built `catalog/drafts/<family>.aws.html` and its export `catalog/aws-kit/json/<family>.json`. Do NOT edit `awd.mjs`, `aws.css`, `Prism.html`, the icon
  store, or other families' files. If the kit lacks something, use `extra` and report it.
- Descriptions: plain sentences, no em dashes, no marketing; say what animates.
- Section titles: a spaced dash or an em/en dash starts a subtitle that the catalog drops from the
  category ("NETWORKING - hub and spoke" files under "NETWORKING"); a hyphen inside a word stays.
- `preview` must report `validation: OK` and `build` must succeed before you finish.
