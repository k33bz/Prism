# AWS Architecture kit: authoring guide

Diagrams for Prism's **AWS Architecture** gallery are written as **specs** (plain JS data, or the
same data as JSON: see [JSON specs](#json-specs)) and compiled to self-contained SVG by
`catalog/aws-kit/awd.mjs`. The output uses the **official AWS Architecture Icons** (embedded once
as a sprite, referenced by id), official group frames, numbered steps, and motion on **one clock per
diagram** (SMIL: no runtime JS). Styling lives in `catalog/drafts/aws.css`. The exemplar is
`catalog/aws-kit/specs/example.mjs`: read it first.

## Workflow
```bash
node catalog/aws-kit/awd.mjs icons lambda              # find icon ids (matches id/name/service/aliases)
node catalog/aws-icons/resolve.mjs "S3 bucket"          # one icon id for any name (see "Resolving icon names")
node catalog/aws-kit/awd.mjs preview catalog/aws-kit/specs/<family>.mjs        # dark preview + validation
node catalog/aws-kit/awd.mjs preview catalog/aws-kit/specs/<family>.mjs light  # light preview
node catalog/aws-kit/awd.mjs build   catalog/aws-kit/specs/<family>.mjs        # -> catalog/drafts/<family>.aws.html
node catalog/aws-kit/awd.mjs export-json catalog/aws-kit/specs/<family>.mjs   # -> catalog/aws-kit/json/<family>.json
node catalog/aws-kit/awd.mjs svg catalog/aws-kit/json/<family>.json <diagram id> --theme light --out x.svg   # one standalone .svg
node catalog/aws-kit/import/mermaid.mjs diagram.mmd --out imported.json --svg imported.svg   # Mermaid, PlantUML or D2 -> spec (see "Importing")
node catalog/aws-kit/import/index.mjs template.yaml --flows template.flows.json --ledger --svg out.svg   # CloudFormation or Terraform JSON -> spec
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
    full: false,             // true -> tile spans the whole row: w up to 1400, h up to 900 (imports, 3 AZs)
    w: 480, h: 236,          // viewBox. Normal: w 480, h <= 300. Wide: w 960, h <= 440.
    lintAllow: [],           // accepted lint findings: '<code>' or '<code>:<start of message>' (say why in a comment)
    dur: 6,                  // seconds; the single clock every animation in this diagram shares (6-10)
    poster: 0.64,            // optional: the moment (a fraction of the clock) a still export shows; see Frames
    groups:  [ { kind, x, y, w, h, label?, id?, icon?:false|'<icon id>', note?, align?:'left'|'center', tone?, fill?, dashed? } ],   // draw OUTER groups first
    nodes:   [ { id, icon /* or [darkId, lightId] */, x, y, size?:40, label?, wrap?:14, sub?, labelPos?:'b'|'r'|'l'|'t' }
             | { id, kind:'box'|'pill', x, y, w, h, label?, sub?, tone? } ],
    wires:   [ { id, from, to } | { id, d:'M..H..V..' } ,  dashed?, both?, flow?, label?, labelAt?:0.5, labelDx?, labelDy?:-5, labelAnchor?, labelBg?, via?, arrow?:false, hot?, tone? ],
    steps:   [ { n, at:'<wire id>', f?:0.5, dx?, dy?:-11, text } | { n, x, y, text } ],
    timeline:[ { wire?, t:[a,b], reverse?, kind?:'pk'|'pk-2'|'pk-bad', ring?:'<node id>'|{ x, y, r? }, r? } ],
    flows:   [ { id?, path:['<node id>', ...] | wires:['<wire id>' | { wire, reverse?, ring?, text?, step?, f?, dx?, dy?, kind? }, ...],
                 reply?, text?:['<one per hop>'], steps?:false, kind?, with?:'<flow id>', t?:[a,b], pace?:'length'|'even' } ],
    effects: [ { appear:'<node id>', t:[a,b], ghost?:true } | { fail:'<group id>', t } | { fade:'<wire id>', t } | { glow:'<wire id>', t } ],
    notes:   [ { x, y, text, kind?:'caption'|'label'|'warn', anchor?:'start'|'middle'|'end', t?:[a,b], off?:[a,b], still?, tone?, size?, weight?, caps? } ],
    marks:   [ { on:'<node or wire id>', f?, kind?:'blocked'|'ok', t?:[a,b], still?, dx?, dy? } | { x, y, ... } ],
    legend:  { x, y, items?: [ { kind:'pk'|'pk-2'|'pk-bad'|'wire'|'dashed'|'blocked', label? } ] },
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
`extra` text. `tone` (request, response, bad, muted, ink), `size` (px), `weight: 'bold'` and `caps`
(spaced capitals: tier headings such as WEB TIER) style a note. A caption that swaps one text for
another is a standing note with `off: [a,b]` (hidden in that window) plus a timed note with
`t: [a,b]` at the same spot: no cover-up rectangles. Timed notes, marks and effects are hidden in still
frames; `still: true` keeps a copy there when the still must tell that part of the story.

**Step texts**: every badge number carries `text`, one or two plain sentences on what happens at
that step (on the first badge of a repeated number). The tile lists them under the description, as AWS
reference architecture pages do, and the svg `<desc>` carries them for screen readers and copies.
lint warns when a number has no text or the numbers do not run 1..n.

**Marks** put a red X (`blocked`, default) or a green check (`ok`) on a node (its icon's top-right
corner), a wire (at `f`) or a point: blocked routes, denied requests, a failed health check.
**Legend** draws the key inside the diagram from `(x, y)`, one row per item; with no `items` it lists
the packet kinds the timeline uses. **Rings** pulse on a node or on a point `{ x, y, r }` (a storage
copy, a table row); a `pk-bad` packet's ring is red.

**Wires** may take a `tone` (request orange, response blue, bad red, muted) with a matching head; a
label with `\n` runs to several lines, and `labelBg` draws a halo in the tile color behind it.
**Boxes and pills** (`kind: 'box' | 'pill'`, with `w`, `h`, label inside, optional category `tone`)
stand in for what has no AWS icon: a corporate identity provider, a SaaS, a cluster endpoint name.
`labelPos` puts an icon's label to the right, left or above. Groups take a category `tone`
(compute, containers, storage, iot, database, devtools, networking, analytics, security, frontend,
integration, management, ai, migration, general), `fill` (a light tint) and `dashed` (override the
kind); `cloud-plain` is the AWS Cloud frame with the plain cloud icon and `iot` the IoT Greengrass
group. place.mjs has `box(id, cx, cy, w, h, label)`, and its ports know boxes and label positions.

**Timeline**: each entry moves a packet along a wire during window `[a,b]` (fractions of `dur`,
`0 < a < b < 1`) and optionally pulses a `ring` on a node when the packet arrives (at `b`).
`pk` = request (AWS orange), `pk-2` = response/replication (blue), `pk-bad` = failed traffic (red).
Packet colors are fixed rather than the theme accent, so the two stay distinct in every design
system; a page can override them with `--awd-request` / `--awd-response`.

**Flows** say the story the way an architect tells it, and the generator writes the timeline:
`{ path: ['users', 'apigw', 'fn', 'ddb'], reply: true, text: ['Users call the API.', '...', '...'] }`
sends a request along the wires that join those nodes (either direction), pulses a ring on each node
it reaches, numbers a badge per hop (on from the spec's own steps) with its text, and with `reply`
brings the response back. Packets keep one speed (`pace: 'length'`, the default: a long wire takes
longer; `'even'` gives equal windows). Flows run one after another over the clock in array order;
`with: '<flow id>'` starts one alongside another (a log write beside the request), `t: [a, b]` pins
one, `kind: 'pk-bad'` draws failed traffic, `steps: false` drops its badges. A wire drawn with `d` has
no ends to find, so name it: `wires: ['l1', { wire: 'l2', ring: 'cw', f: 0.7 }]` (a hop object also
sets the badge spot and `ring: false` for none). An empty text (`''`) leaves a hop's step untold.
Flows compile to plain timeline entries and steps after the spec's own, so the two mix, and the
exports, frames and storyboards see the compiled story. `compileFlows(spec)` in `story.mjs` shows it.
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

## Frames and storyboards
A still shows the healthy diagram; slides, PNGs, print and most document tools play no SMIL, so a
failure story has nothing to show there. `catalog/aws-kit/frame.mjs` evaluates the animation at a
moment instead: `frame(spec, at, { theme })` returns a standalone SVG with no animation left, where
packets sit where they are on their wires, rings have their size, failed frames are red with their X,
drained wires are dim, and timed captions, marks and swaps show what they show at that moment. `at` is
a fraction of the clock in [0, 1), or `'poster'`: the spec's own `poster` moment (without one, the
plain still). Pick a poster where the story is told: `tt-az-fail` uses 0.64, the failover done.

`storyboard(spec, { theme })` returns one frame per numbered step, `[{ n, at, text, svg }]`, for a
deck or a printed runbook: a step on a wire is shown when its packet travels that wire, a free badge
at the first event near it (a packet, a frame failing, a wire draining or lighting up, a node
appearing), always in step order; hops that run together share a moment. Every gallery diagram with
steps storyboards in order (a test holds this).

CLI: `node catalog/aws-kit/frame.mjs <family spec> <diagram id> [--at 0.5|poster] [--theme light|dark]
[--out file.svg]`, or `--storyboard <dir>` for one svg per step and an `index.html` that shows them
with their step texts. `exportDiagram(spec, { to: 'svg', at })` and `{ to: 'storyboard' }` (frames,
plus a self-contained HTML page) do the same, and so does the MCP tool `export_diagram`.

**PNG**: `catalog/aws-kit/png.mjs` rasterizes a frame with headless Chrome or Edge (`catalog/_chrome.mjs`
finds one; `PRISM_CHROME` overrides): `toPng(spec, { at: 'poster', theme: 'light', scale: 2 })`
returns `{ png, width, height }` in about a second. CLI: `node catalog/aws-kit/png.mjs <family spec>
<diagram id> [--at 0.5|poster] [--theme light|dark] [--scale 2] --out file.png`; also
`exportDiagram(spec, { to: 'png' })` and `export_diagram` with `to: 'png'` (base64).

**Placement helpers** (`catalog/aws-kit/place.mjs`, imported by the vpc, transit, endpoints and dns
specs): `centered(size)` makes a node factory that places icons by center and keeps `cx`/`cy` on the
node; `R`, `L`, `T`, `B` (below the label) and `Bi` (below the icon) give a node's edge ports;
`P(...points)` joins points into an `M H V` path and throws on a diagonal; `lblH` predicts a label
block's height with the generator's own `wrap`. Example, one elbow at x=300: `{ id: 'w', d: P(R(alb), [300, alb.cy], [300, tg.cy], L(tg)) }`.

**Lint** (`catalog/aws-kit/lint.mjs`) checks the drawn markup, `extra` and timed captions included,
with Arial's real advance widths. Errors (the build fails on any): `off-canvas`, `icon-overlap`,
`text-overlap` (static, or timed captions shown at the same time), `text-on-icon`, `text-on-border`
(text across or within 2px of a frame edge), `wire-on-text`, `wire-on-icon` (an icon the wire does
not connect), `badge-on-icon`, `badge-on-text`, `badge-overlap`. Warnings: `header-band` (an icon
inside a frame's 22px header), `label-lines` (more than 2), `tile-size`. Info: `icon-sizes` (AWS
keeps one size per diagram), `text-over-text` (a timed caption over static text, usually a swap).
`node catalog/aws-kit/awd.mjs lint <spec> [diagram id] [--info]` prints them; `preview` prints a
count. It agrees with a headless-Edge measurement of the gallery (0 static defects in both).

## Resolving icon names
`catalog/aws-icons/resolve.mjs` maps any name for an AWS thing to one icon id. `awd.mjs`, the importers
and the MCP server (`resolve_aws_icon`, `search_aws_icons`) share it; no deps.
```bash
node catalog/aws-icons/resolve.mjs "S3 bucket"                     # aws-res-simple-storage-service-bucket
node catalog/aws-icons/resolve.mjs AWS::ElasticLoadBalancingV2::LoadBalancer --prop Type=network
node catalog/aws-icons/resolve.mjs mxgraph.aws4.internet_gateway --from drawio
node catalog/aws-icons/resolve.mjs "Security Group" --json        # kind group, group sg: a frame
```
```js
import { resolveIcon } from '../aws-icons/resolve.mjs';
resolveIcon('AWS::RDS::DBInstance', { props: { Engine: 'postgres', MultiAZ: true } });
// { id: 'aws-res-aurora-postgresql-instance', kind: 'node', confidence: 1, how: 'rule+Engine',
//   standby: 'aws-res-aurora-postgresql-instance-alternate', candidates: [...], warnings: [] }
```
- `from`: `text` (default), `drawio`, `mermaid`, `plantuml`, `diagrams`, `cfn`, `tf`. In text, CloudFormation
  and Terraform types, draw.io styles and Mermaid keys are recognised by their shape. Below confidence 0.5
  the result is `{ id: null, candidates, warnings }`: show the candidates, do not guess.
- Words match whole (plural-folded), never as substrings; abbreviations and old names come from the
  store's `aliases` (S3, ALB, NLB, ECR, DAX, NACL, SSO, Elasticsearch, Kinesis Firehose, QuickSight).
  `_alt` names resolve to the alternate colorway (AWS's own typo id `-aternate` included), and `-dark`/
  `-light` ids to the base id: pass base ids, the generator swaps the artwork per theme.
- Service vs resource: draw.io `resIcon` tiles are services and bare `mxgraph.aws4.*` shapes resources;
  PlantUML, Mermaid pack keys and `diagrams` classes name exact icons. Text, CloudFormation and Terraform
  pick the resource icon, except a Lambda function, DynamoDB table, SQS queue or SNS topic, which the kit
  draws with the service icon (store field `prefer`). A service plus a word with no icon of its own
  ("EKS cluster", "KMS key") gets the service icon. `prefer: 'resource' | 'service'` overrides.
- Containers (security group, Availability Zone, VPC, subnets, Region, Auto Scaling group, account,
  corporate data center, AWS Cloud) return `kind: 'group'` with the awd group kind; `prefer: 'node'` gives
  the node icon where one exists, `prefer: 'group'` turns anything into a frame (`gen` with its icon).
- CloudFormation/Terraform property picks: ELBv2 `Type`, RDS `Engine` and `MultiAZ` (adds `standby`),
  ElastiCache `Engine`, FSx `FileSystemType`, `aws_lb.load_balancer_type`, `aws_db_instance.engine`. Types
  that are relationships or folded into a node return `role: 'edge' | 'attr' | 'meta'` and no icon.
- Retired, end-of-support, renamed and duplicate icons still resolve, with a warning and `status`. Labels:
  use the store's `short` name when there is one ("Amazon S3", "AWS Site-to-Site VPN", "Route 53 VPC
  Resolver").
- The data is `catalog/aws-icons/overlay.mjs` (aliases, short names, status, per-vocabulary `xref` names,
  property rules), merged into `aws-icons.json` by `build_icons.mjs`; after editing it run
  `node catalog/aws-icons/build_icons.mjs --overlay-only`. Coverage on the interop evaluators' inputs:
  `node catalog/aws-icons/coverage.mjs`; tests: `node --test catalog/aws-icons/resolve.test.mjs`.

## Import and export, any format
`catalog/aws-kit/import/index.mjs` is the one entry point: `importDiagram(content, { from: 'auto' })` detects
draw.io (plain, compressed, `.drawio.svg`, `.drawio.png`), Mermaid, PlantUML, D2, CloudFormation (`AWSTemplateFormatVersion`,
or `Resources` whose entries have an `AWS::` type) or Terraform (`terraform show -json`: `format_version` with
`planned_values` or `values`; HCL is routed there to be refused with what to run) and returns
`{ spec, report: { from, issues, unmapped, tile, lint } }` (CloudFormation and Terraform add `ledger`, `story` and
`resources`; they take `flows`, the sidecar, and CloudFormation `params`); `exportDiagram(spec, { to: 'drawio' | 'mermaid' | 'svg' })`
returns `{ to, text }`; `to: 'svg'` takes `at` for a frozen frame, `to: 'png'` returns an image and `to: 'storyboard'`
returns `frames` (see Frames and storyboards). CLI: `node catalog/aws-kit/import/index.mjs <file> [--from x] [--id x]
[--flows sidecar.json] [--param K=V]... [--story id|none|guess] [--ledger] [--out spec.json] [--svg out.svg] [--at 0.5|poster]`.
The MCP server exposes both as `import_diagram` and `export_diagram`. Importers animate the order a
source gives with `story(hops, { reply })` (`catalog/aws-kit/story.mjs`), which authors can use too: an
ordered list of hops becomes even windows on the clock, arrival rings, numbered steps and, with
`reply`, the response legs. The per-format details follow.

## Importing and exporting draw.io
`catalog/aws-kit/import/drawio.mjs` turns a draw.io (diagrams.net) diagram into one kit spec, and
`drawio-export.mjs` writes a spec back as a `.drawio` file. No deps.
```bash
node catalog/aws-kit/import/drawio.mjs arch.drawio                        # report summary only
node catalog/aws-kit/import/drawio.mjs arch.drawio --id dr-arch --out arch.json --svg arch.svg --theme light
node catalog/aws-kit/import/drawio.mjs arch.drawio.png --page 1 --story none --width 960
node catalog/aws-kit/import/drawio.mjs --export catalog/aws-kit/json/three-tier.json tt-classic --out tt.drawio
```
```js
import { fromDrawio, toDrawio } from './catalog/aws-kit/import/drawio.mjs';
const { spec, report } = fromDrawio(fs.readFileSync('arch.drawio'), { id: 'dr-arch', page: 0, story: 'auto' });
// report: { issues: [{ severity, code, element, message }], unmapped: [{ element, shape, label }], pages, format, scale, tile, lint }
fs.writeFileSync('tt.drawio', toDrawio(spec));
```
`--out` writes a family JSON (section `drawio-import`) that `awd.mjs build`, `preview` and `svg` read. The CLI
exits 1 when lint errors remain. Options: `id` (kebab; default `dr-` plus the title or page name), `name`,
`page` (index or name), `story` (`auto` or `none`), `width` (forces the canvas width and so the tile),
`restore` (default true, see the round trip below).

**What it reads.** Plain and compressed `.drawio`, a bare `<mxGraphModel>`, `.drawio.svg` (the `content`
attribute) and `.drawio.png` (the `mxfile` tEXt, zTXt or iTXt chunk); `<object>`/`UserObject` labels and
`%placeholders%`, layers (hidden ones dropped), parent-relative geometry, `edgeLabel` children, `def(n)`
style compression, HTML labels (flattened to text).

**How shapes map.**
- AWS shapes go through `resolveIcon(style, { from: 'drawio' })`: a `resIcon` tile is the service icon, a bare
  `mxgraph.aws4.*` shape the resource icon. An EC2 instance-type shape (`c5_instance`) is an EC2 instance with
  the family as `sub`. The label is a guarded second signal: an exact name that disagrees with the shape is
  reported (`label-shape`, the shape wins); a label naming a resource of the shape's own service refines it
  (`cloudwatch` labelled "Amazon CloudWatch Logs": `label-refined`). An AWS shape with no icon is a box (`icon-unmapped`, listed in `unmapped`).
- AWS groups: `grIcon` through the resolver (subnets told apart by stroke color; `group_aws_cloud` is
  `cloud-plain`, the Greengrass deployment `iot`, Beanstalk and Step Functions a `gen` frame with that icon).
  Plain containers (a container, a swimlane, or a rectangle around other content) are Availability Zones or
  security groups by label or stroke, other kit frames by label ("VPC", "Private subnet", "us-east-1"), else
  `gen` with the category `tone` nearest the stroke color (the 2019 palette included), `fill` when filled,
  `dashed` as drawn.
- Other shapes are `box` nodes (an ellipse a `pill`) with their label; an image with a label is a box, one
  without is dropped; unlabeled decorations (lines, brackets, empty panels) are dropped. All are reported.
- Text is a note (wrapped where draw.io wraps it); the largest bold text above the drawing is the `name`, a
  line right under it opens the `desc`; a CIDR or short right-aligned text on a frame's top band is that
  frame's `note`.
- Numbered ellipses and small rounded boxes ("1".."99") are steps. A badge with a sentence beside it, or a
  repeated number beside text (a description column), gives that step its text; a text block of numbered
  lines (a legend) does too. Texts longer than 400 characters are shortened (`step-text-long`).

**Layout.** The drawing is scaled so the median icon is 40 (or 32) px, every icon gets that one size, then
each axis is stretched where the kit needs room: the 22px header band and 16px padding of every frame, labels
clear of frame borders and of each other, wires clear of headers and of labels they do not connect. A stretch
inserts space between two coordinates and moves everything past it, so rows, columns and orthogonal wires
stay intact. The tile is the smallest of normal (480x300), wide (960x440) and full (up to 1400x900) the
result fits, at the largest scale that fits it; a smaller tile that only lints clean by dropping a label
loses to the next one. Wires that join two nodes without waypoints are `from`/`to`; the rest are explicit
`M`/`H`/`V` paths through the waypoints (elbows added, ends at the icon edge or below its label, exit and
entry sides kept), floating ends kept, ends on a frame drawn to its border (`edge-group`). Edge labels follow
draw.io's relative position (`labelAt`), on the side the measured rule gives (a positive relative y is left
of travel: above a left-to-right run, right of a top-to-bottom run). Then a lint loop tries each finding's
knobs (a wire label's place and side, a node label's side and wrap, a badge's place on its wire, a note's
offset, a wire's elbow, a frame header's alignment, the canvas) and keeps what lowers the count; it also
spreads badges that crowd each other. A wire label with no clear spot is dropped as a last resort
(`label-dropped`); lint errors that remain are reported as `lint:<code>` issues.

**Story.** With `story: 'auto'`, badges on (or near) wires give the order: one hop per badge, in number order,
a ring on the wire's target. Without badges, a breadth-first walk from the leftmost actor outside the frames
(users, client, internet...) over the connected wires (12 hops at most) gives a guessed order, reported as
`story-bfs`. Windows come from `story()`; step texts stay empty unless the drawing carries them.

**Export.** `toDrawio(spec)` writes a plain `.drawio`: official AWS group styles (the Auto Scaling group as the
left-aligned group, as the kit draws it), icons as the draw.io AWS4 shape that resolves back to the same id
(the store's `xref.drawio` names first, then the draw.io library names in `coverage-inputs.json`; an icon
draw.io lacks, such as Direct Connect gateway, is an inline SVG image), boxes as rounded rectangles, wires as
orthogonal edges with `source`/`target`, the kit's route as waypoints and exact ports (`exitDx`/`exitDy`, so a
wire starts below a label), steps as numbered ellipses (the step text is the tooltip), static notes, marks and
the legend as text, the name above the drawing and the step list below it. Every cell carries `prism_kind`,
`prism_id` and, on icons, `prism_icon`. Motion has no draw.io form, so the canonical spec rides on a hidden
layer (`<object prism_spec="...">`). Importing an unedited export restores that spec exactly
(`prism-restored`); after edits in draw.io the drawing is imported again and the timeline, effects, timed
notes and step texts are restored where their references still exist (`prism-merged`). `restore: false`
(CLI `--no-restore`) ignores the hidden layer.
Gallery round trip (tested): all 79 diagrams restore exactly; from the drawing alone all 79 keep their node,
group, wire and step counts and lint clean (wire labels, notes, marks and legends kept; the timeline becomes
one packet per badge; tiles can grow because the importer keeps headers and padding the gallery sometimes
tightens).

Tests: `node --test catalog/aws-kit/import/drawio.test.mjs`. Fixtures live in `catalog/aws-kit/import/fixtures/`
(`make-fixtures.mjs` regenerates the authored ones). Do not commit the jgraph templates.

## Importing from Mermaid, PlantUML and D2
`catalog/aws-kit/import/` turns diagram text into an ordinary spec (layout, routes, labels, badges and the
animation included), and a spec back into Mermaid. No deps; all four dialects share one model (`ir.mjs`), so
they get the same layout, icons, group kinds, directives and story.
```bash
node catalog/aws-kit/import/mermaid.mjs diagram.mmd [--id x] [--name "..."] [--out spec.json] [--svg out.svg] [--theme light|dark] [--story none]
node catalog/aws-kit/import/mermaid.mjs stack.puml              # PlantUML (.puml/.plantuml, or text starting @startuml)
node catalog/aws-kit/import/mermaid.mjs pipeline.d2             # D2
node catalog/aws-kit/import/mermaid.mjs --export catalog/aws-kit/json/serverless.json sl-api [--dialect flowchart|architecture-beta]
```
The import prints a summary (tile, counts, story channel, every issue and lint finding); `--out` writes a
one-diagram family file that `awd.mjs preview|build|svg` read, `--svg` a standalone SVG. From code:
```js
import { fromMermaid, toMermaid } from './import/mermaid.mjs';   // fromPlantUml: ./import/plantuml.mjs, fromD2: ./import/d2.mjs
const { spec, report } = fromMermaid(text, { id: 'sl-imported', name, story: 'auto' });   // story: 'none' drops the animation
// report: { dialect, issues: [{ severity, code, element, message }], unmapped: [{ element, label, icon, candidates }],
//           tile: { size, w, h, fits }, lint: [...lint findings left], story: { channel, legs, steps }, icons: [...] }
```
The spec passes `checkSpec`, the schema and `lint` (the importer runs a lint loop that moves flagged labels and
badges to their next clear spot, a bounded number of rounds; what remains is in `report.lint`). Review
`report.issues`: `warn` means the drawing departs from the source (a grid conflict, an unmapped icon), `info`
explains a choice (a guessed story, a generated step text, an ignored `classDef`).

**Mermaid architecture-beta** (the best input: it carries icons, nesting and placement):
`group id(icon)[title] in parent`, `service id(icon)[title] in parent`, `junction id in parent`, edges
`a:R --> L:b` with `--`, `-->`, `<--`, `<-->`, an edge title `-[1: HTTPS]-`, `a{group}:B --> T:b` (the edge
leaves a's group border; b is placed outside that group), `align row a b c` / `align column a b`, `title`,
`accTitle`, `accDescr`, frontmatter `title:`. Edge sides place nodes on a grid (b right of a, below a...), as
Mermaid does before its force layout; when two edges disagree the report names both
(`edge "cache:B --> T:rds" conflicts with edge "app:B --> T:cache"...`), and two nodes sent to one cell are
reported and moved. Junctions are waypoints: each edge into or out of one stays its own wire, meeting at the
junction point. Mermaid 11 rejects unquoted titles with anything but letters, digits, `_` and spaces:
`[us-east-1]` must be `["us-east-1"]` (the importer accepts both and reports the unquoted one).

**Mermaid flowchart** (what most people write): `flowchart LR|RL|TD|BT` (or `graph`), node shapes
(`[ ]`, `( )`, `([ ])` (a pill when no icon matches), `[( )]`, `(( ))`, `{ }`, `{{ }}`, `[/ /]`, `>  ]`),
`id@{ icon: "aws:lambda", label: "..." }` and `id@{ shape: f-circ }` (a junction), every link (`-->`, `---`,
`-.->`, `-.-`, `==>`, `<-->`, `--o`, `--x`, longer forms, `-- text -->`, `-->|text|`), `a & b --> c`
chains, edge ids `e1@-->`, `subgraph id [Title] ... end` (nested; a node belongs to the innermost subgraph
that mentions it, as in Mermaid), and links to a subgraph id (the wire ends on that frame's border). `classDef`,
`class`, `style`, `linkStyle`, `click` and `~~~` are ignored (the kit's theme sets colors). Thick links draw as
normal wires. Without sides, a layered layout places the nodes: longest-path layers in the flowchart's direction,
groups kept contiguous (sibling groups in declaration order, so AZ a comes before AZ b), barycenter ordering,
container packing (a frame never holds a node that is not in it), forks centered between their branches (a frame
alone in its slot, such as an ALB in its public subnet, centers as a block), and chains straightened into them. A
both-headed edge between twins (same icon) or a dashed both-headed edge is a peer edge (replication, sync): same
tier, not a hop. A layered drawing that fits no tile in its direction is tried in the other one (reported).

**PlantUML** (awslabs aws-icons-for-plantuml): group macros are exact frame kinds (`AWSCloudGroup`,
`RegionGroup`, `VPCGroup`, `AvailabilityZoneGroup`, `PublicSubnetGroup`, `PrivateSubnetGroup`,
`SecurityGroupGroup`, `AutoScalingGroupGroup`, `AWSAccountGroup`, `CorporateDataCenterGroup`, `GenericGroup`...),
icon macros `Lambda(fn, "AWS Lambda", "technology", "description")` (the technology is the sub line), plain
`actor`, `rectangle`, `node`, `database`, `component`, `package`... with or without a block, links (`-->`,
`->`, `..>`, `--`, `<-->`, `-[#c]->`, `-[dashed]->`) with `: label`, `title`, `left to right direction`.
Direction words (`-right->`, `-r->`, `-up->`, `-down->`, `-left->`) are edge sides and place nodes on the grid;
links without one follow the diagram direction as a soft hint. Notes, legends and skinparams are ignored.

**D2**: shapes (`a`, `a: Label`, quoted keys, dotted paths `a.b.c`), containers (a shape with children is a
frame), `icon:` URLs (the file name names the service: `icons.terrastruct.com/aws/Compute/AWS-Lambda.svg`),
`label:`, `shape: person`, connections (`->`, `<-`, `<->`, `--`, chains, `: label`, a block with
`style.stroke-dash` for a dashed wire), `direction:`, and `steps`. A top-level reference to a key that only
exists nested (`apigw` for `cloud.region.apigw`) joins the nested shape (real D2 would make a new one; reported).
`layers`, `scenarios`, `vars`, `classes` and globs are ignored.

**Icons** come from the explicit icon, then the label, through `resolveIcon` (Mermaid pack keys such as
`aws:lambda`, Prism pack keys `aws:svc-lambda` exactly, PlantUML macros, D2 file names, free text such as "ALB",
"RDS Primary", "Dead-letter queue"; when the whole name matches nothing, its last word or two may, exactly:
"Order queue", "Image bucket", "Payment function", reported). Mermaid's generic built-ins (`cloud`, `database`, `disk`, `internet`,
`server`) defer to the title. Anything unresolved becomes a `kind: 'box'` node (a `pill` for a stadium shape)
and an `unmapped` entry with the closest candidates. A node without a label takes the icon's official short
name; a `<br>` in a label starts the sub line. Wire labels over 18 characters break into two lines.
**Group kinds** come from the title (CIDRs ignored: "VPC 10.0.0.0/16" is a vpc, "us-east-1" a region,
"Availability Zone a" an az, "Private subnet" priv; a subnet that does not say public or private is priv,
reported), then the id (`aza`, `pub_a`), then the icon (a group icon such as `aws:region`; a service icon makes
a `gen` frame with that icon in its corner), else `gen` (reported). A title equal to the kind's default label
is dropped, so the frame shows the official name.

**Directives** ride in comments, so the source stays valid Mermaid (`%% prism: ...`), PlantUML
(`' prism: ...`) or D2 (`# prism: ...`):

| directive | effect |
|---|---|
| `flow users>apigw>fn>ddb>fn>apigw>users` | the request path; a hop back along a wire already taken is the response (blue packet, no badge). Several `flow` lines run one after another; a hop through a junction is one step |
| `kind vpc=vpc aza=az` | group kinds by group id (`cloud region az vpc pub priv sg asg acct dc server ec2 spot iot gen`; `public`, `private`, `subnet`, `account` also read) |
| `icon fn=aws-svc-lambda`, `icon idp=box` | a node's icon: an icon id, a Prism pack key, any name the resolver knows, or `box` / `pill` |
| `name Serverless REST API`, `desc ...` | tile title and description (default: frontmatter `title:`, then a generated description that says where the story came from) |
| `dur 8` | seconds on the diagram's clock (default 6 to 10 from the number of legs) |
| `step 2: API Gateway invokes the function.` | the text of badge 2 (default: a generated "A to B: label." text, reported as info) |
| `peer rdsA rdsB` | a replication or sync edge: same tier in a layered layout, not a hop in the BFS guess |
| `note vpc=10.0.0.0/16` | a frame's right-aligned note |
| `story none` | no timeline or badges |

**Animation channels**, first match wins:
1. numbered edge titles or labels: `-["1: HTTPS"]-`, `-->|2: invoke|`, `-->|3|`, PlantUML `: 1 HTTPS`,
   D2 `: 1 HTTPS` (a number followed by `:`, `.` or `)`, or alone; "1 HTTPS" without a separator only when two or
   more labels use it; numbers that are not a 1..n sequence, such as a port 443, are labels). The number comes
   off the label and becomes the badge. When every numbered edge is `<-->`, the response replays the path
   backwards (`story(..., { reply: true })`); otherwise only the `<-->` hops get a response leg.
2. `%% prism: flow a>b>c` (above).
3. D2 `steps`: each step board's new connections are one numbered step; a step's `label:` is its text.
4. a breadth-first guess from the entry actor (Users, a client, the internet, a server outside every group,
   else a node nothing points at), along the arrows, solid wires only; responses on `<-->` wires. Reported as
   `info` (`story-guess`): it is a guess, set the order with one of the channels above.
The timeline and numbered steps come from `story()` (story.mjs), one window per leg on the diagram's clock.

**Layout and tile.** Track sizing follows the layout rules below: 16px padding and the 22px header chain through
nested frames, columns as wide as their icon or label, room in a gap for a straight wire's label and badge,
frames widened for their title (and note), a frame whose title a wire crosses from above gets left clearance,
and frames of one kind over the same columns (or rows) get the same size. The tile is the first that fits:
normal 480x300, wide 960x440 (gaps stretched to use the width), full up to 1400x900; larger is reported
(`tile-size`). Wires are orthogonal M/H/V routes from the kit's ports (place.mjs `R`, `L`, `T`, `B` below the
label), searched over the channel lines between tracks: other nodes block, titles and corner icons cost, wires
avoid running along borders or on top of each other (a shared trunk from one port is fine). In a layered layout a
hop to the next layer leaves on the flow's exit side and enters on its entry side, so a fork draws as a bus and
a merge comes in from one side; a dashed and a solid wire at one port are spread apart. Labels and badges
go to the clearest spot along their wire, measured the way lint measures (Arial advance widths).

**Export.** `toMermaid(spec)` writes a `flowchart LR`: subgraphs by containment, nodes as
`id@{ icon: "aws:svc-lambda", form: "square", label: "...", pos: "b", h: 48 }` (boxes as `["..."]`, pills as
`(["..."])`), wire ends on nodes, frame borders (a link to the subgraph) or shared points (an `f-circ` junction
node), the step number on each badged wire's label (`|"1: HTTPS"|`), and `%% prism:` lines for the name,
description, duration, group kinds, notes, box nodes and step texts, so an import of the export gets the same
kinds and texts back. Timeline windows, effects, notes, marks, the legend and `extra` are not carried (the
first comment line counts them). `{ dialect: 'architecture-beta' }` exports only when the spec's grid is
consistent: every wire joins two nodes, no node side carries two wires, and the edge sides rebuild the spec's
own arrangement; otherwise it throws with the reasons (8 of the 79 gallery diagrams qualify).
Mermaid needs the icons: `catalog/aws-icons/aws-mermaid-pack.json` is the store as an Iconify pack (859 icons,
1.8 MB; keys `svc-*`, `res-*`, `grp-*`, `cat-*`, colorway pairs as `<key>` light and `<key>-dark`):
`mermaid.registerIconPacks([{ name: 'aws', icons: pack }])`. Regenerate it after a store refresh with
`node catalog/aws-kit/import/make-pack.mjs` (a test fails while it is stale).

**Checks.** `node --test catalog/aws-kit/import/mermaid.test.mjs`: every fixture in `import/fixtures/` (`mmd-`,
`puml-`, `d2-`) imports to a spec that passes checkSpec, the schema and lint with 0 errors; each animation
channel; grid conflicts and collisions; and the flowchart export of every gallery diagram imports back with the
same node and wire counts. Mermaid itself is not a dependency: the round trip uses this parser. The fixtures and
all exports (79 flowcharts, 8 architecture-beta) were also checked once against Mermaid 11.16.1's
`mermaid.parse` in headless Edge, with negative controls (all valid inputs parse, the controls fail).

**Limits.** The layered layout is built for the sizes gallery tiles hold (about 30 nodes); a long chain of
layers or nine frames in one layer may need a full tile or more. Group kinds and icons from free text are best
guesses: read `report.issues` and pin them with `kind` / `icon` directives. The accuracy rules (ALB in a public
subnet, one NAT gateway per AZ...) are not checked; the source's structure is drawn as written.

## Importing CloudFormation and Terraform
`catalog/aws-kit/import/cfn.mjs` and `tf.mjs` turn infrastructure as code into an AWS reference diagram, and a
**flows sidecar** adds what code cannot say (who the users are, the request order, the stories). Both feed
`iac.mjs` (classification, inference, the ledger, the sidecar, the AZ-row layout), which lays out through the
text importers' pipeline (`ir.mjs`, `layout.mjs`). No deps.
```bash
node catalog/aws-kit/import/index.mjs webapp.yaml --flows webapp.flows.json --ledger --svg webapp.svg
node catalog/aws-kit/import/cfn.mjs template.yaml --param Environment=prod --story guess --out spec.json
terraform plan -out plan.tfplan && terraform show -json plan.tfplan > plan.json
node catalog/aws-kit/import/tf.mjs plan.json --flows plan.flows.json --out spec.json
```
```js
import { fromCloudFormation } from './import/cfn.mjs';   // fromTerraform, tfId: ./import/tf.mjs
const { spec, report } = fromCloudFormation(text, { id, name, flows, params: { Environment: 'prod' }, story: 'page-view' });
// report: { from, issues, unmapped, tile, lint,
//           ledger: [{ kind: 'derived'|'assumed'|'dropped', fact, from: [logical ids or addresses], ask?, via? }],
//           story: { channel: 'sidecar'|'bfs'|'none', flow, template, legs, steps, available },
//           resources: [{ key, type, as: 'node'|'group'|'edge'|'folded'|'dropped'|'meta', into?, nodes?, frames?, group? }] }
```
Options: `id` (default `cfn-`/`tf-` plus the file name), `name`, `flows` (the sidecar, an object or its JSON),
`params` (CloudFormation parameter values over the defaults), `region`, `story` (a sidecar flow or story id; `none`;
`guess`). Without a sidecar there is **no animation** unless `story: 'guess'`, which draws a breadth-first walk from
the internet-facing entry through the first AZ and reports it as a guess (`story-guess`). The spec passes
`checkSpec`, the schema and lint like every import; fixtures and tests: `import/fixtures/cfn-*`, `tf-*`
(`make-iac-fixtures.mjs` regenerates the CDK and Terraform ones), `node --test catalog/aws-kit/import/cfn.test.mjs
catalog/aws-kit/import/tf.test.mjs`.

**Inputs.**
- **CloudFormation**, JSON or YAML. `cfn-yaml.mjs` (`parseYaml`) reads the short-form intrinsics (`!Ref`, `!GetAtt A.B`
  and `[A, B]`, `!Sub` string and list, `!If`, `!Select`, `!GetAZs`, `!Join`, `!Split`, `!FindInMap`, `!ImportValue`,
  `!Equals`, `!Not`, `!And`, `!Or`, `!Base64`, `!Cidr`, `!Condition`...) into their long JSON form, and the YAML
  templates use: block and flow collections across lines, compact `- key: value`, plain, quoted and `|`/`>` block
  scalars, comments, anchors. Plain scalars resolve as YAML 1.2 core does, so `2010-09-09`, `0755` and `yes` stay
  strings. Parameters take their default unless `params` gives one; Conditions are evaluated (a resource whose
  condition is false does not exist; `Fn::If` picks its branch; `AWS::NoValue` drops the property), Mappings and
  pseudo parameters resolve (`AWS::Region` only with `region`), `Fn::ImportValue` names another stack (info). The
  ledger says which parameter decided what, and whether it was a default (assumed) or given (derived).
- **CDK synth output.** `Metadata."aws:cdk:path"` names things: node ids from the last two construct segments
  (`ApiService-LB-az1`), subs from them (`ApiService/LB`), ledger and issue text in construct paths (`from` keeps the
  hashed logical ids). `Custom::` resources, their provider functions, roles and layers, and `CDKMetadata` fold away;
  `DefaultPolicy` statements become IAM edges; the `aws-cdk:subnet-type` tag is the fallback when no route table says.
- **SAM.** The processed template (`aws cloudformation get-template --template-stage Processed`) is exact: implicit
  APIs with OpenAPI bodies, permissions, event source mappings and policy templates expanded into roles. A SAM source
  template is approximated (Api, HttpApi, SQS, Kinesis, DynamoDB, S3, SNS and schedule events, policy templates) with a
  `sam-source` warning.
- **Terraform**, `terraform show -json` of a plan (`planned_values` and `configuration`) or a state (`values`). Modules
  recurse; `count` and `for_each` instances are resources of their own; edges come from
  `configuration.*.expressions.references`, resolved through `var.x` (the module call's argument) and `module.x.out`
  (the module's output), with `count.index` and `each.key` pairing instances (`aws_nat_gateway.this[1]` in
  `aws_subnet.public[1]`). In a state (or for values a plan knows), an attribute equal to another resource's id or ARN
  is a reference too, an ARN with a path (`bucket/*`, `table/x/index/*`) included. The Region comes from the aws
  provider configuration. `tfId(address)` makes kit ids: `module.vpc.aws_subnet.private[0]` is `vpc-subnet-private-0`,
  `aws_subnet.az["us-east-1a"]` is `subnet-az-us-east-1a`. Raw HCL is refused with what to run instead: only
  Terraform can expand modules, `count` and `for_each`.
- Nested stacks (`AWS::CloudFormation::Stack`) are one stack node (the child template is not fetched: warning); macros
  do not run. A template may carry its sidecar in `Metadata: { "Prism::Flows": { ... } }`.

**Classification.** Every resource is one of: a **node** (its icon from `resolveIcon(type, { from: 'cfn' | 'tf', props })`,
with the ELBv2 `Type`, RDS `Engine` and `MultiAZ` picks; label the official name, sub the author's name), a **group**
(VPC, subnet, Auto Scaling group), an **edge** (security group rules, listeners and target groups, event source
mappings, subscriptions, permissions, DNS records, API integrations), **folded** into another (route tables, routes,
EIPs, launch templates, instance profiles, roles and policies, subnet groups, ECS clusters and task definitions, CDK
helpers; `resources[].into` says into what), **dropped** (operational: alarms, dashboards, log groups, scaling
policies, API stages and deployments, bucket, queue and topic policies; the sidecar's `show` draws one) or **meta**
(not architecture). A type with no icon is a box (`unmapped-type`, listed in `unmapped`).

**What is inferred.**

| fact | how |
|---|---|
| VPC | `AWS::EC2::VPC` / `aws_vpc`, its CIDR as the frame's note; Cloud and Region frames are always added (the Region is named when the source says: a provider region, AZ names) |
| AZ position | `!Select [n, !GetAZs '']` (or `!Select [n, !Ref <AZ list parameter>]`) is position n+1, a position and never an AZ name; literal AZ names are sorted and shown as the AZ frame's note; otherwise the subnet's place among its siblings (assumed). Frames read "Availability Zone 1", "Availability Zone 2", never a/b |
| public, private, isolated | the subnet's route table association, then that table's 0.0.0.0/0 route: an internet gateway makes it public, a NAT gateway (or a transit gateway, an appliance) private with egress, no default route isolated (drawn as a private subnet frame titled "Isolated subnet": the kit has no isolated kind). Without an association: the CDK subnet tag, then `MapPublicIpOnLaunch` (a hint, assumed); `group_hints` overrides |
| placement | `SubnetId`, `Subnets`/`SubnetMappings`, `VPCZoneIdentifier`, DB, cache, DocumentDB and Redshift subnet groups (an Aurora instance through its cluster's), `VpcConfig.SubnetIds`, `AwsvpcConfiguration.Subnets`, `ResourcesVpcConfig`, `VPCOptions`, `ClientSubnets` and their Terraform names; VPC-level gateways (internet, VPN, gateway endpoints) through their attachment |
| replicas | a resource in subnets of several AZs is drawn once per AZ (`<id>-az1`, `<id>-az2`): load balancers, ASG instances (one Auto Scaling group frame across the AZs, as the gallery draws it, or one per AZ when a single frame would cross subnet header text), VPC Lambda functions, ECS services, interface endpoints. A database is a primary (`-primary`) and, when Multi-AZ, a standby (`-standby`, the alternate icon) in another AZ; which AZ holds the primary is assumed unless the sidecar pins it. Aurora instances are their cluster's writer and readers (request edges go to the writer). Replicas share a column |
| request edges | listener > target group > Auto Scaling group, ECS service, instances or Lambda (the target group's port); security group ingress chains (an ASG carries its launch template's groups) with ports; an internet-facing load balancer behind its public subnets' internet gateway; CloudFront origins; API Gateway integrations (methods, OpenAPI bodies, HTTP API integrations); Step Functions tasks. A load balancer replica reaches the targets in its own AZ |
| async edges (dashed) | event source mappings, EventBridge rule targets, SNS subscriptions, S3 notifications, Pipes, Scheduler; Lambda permissions when nothing else linked the two |
| DNS (dashed) | Route 53 aliases (a Route 53 node stands in for a zone outside the stack), labelled with the record name |
| weak edges (dashed) | the resource ARNs in a role's policies, from what assumes the role (a function, an instance or ASG through its instance profile and launch template, an ECS task role), labelled with the action or "dynamodb read/write"; one per role and target. An ARN in a policy does not prove traffic: a sidecar request step over one makes it solid |
| egress | a dashed "egress" wire from each private subnet to its NAT gateway; a NAT gateway in another AZ is a ledger fact with a question (an AZ failure cuts that subnet's egress) |
| actors | the sidecar's; else Users at the internet-facing entry (CloudFront, the internet gateway in front of an internet-facing load balancer, API Gateway, AppSync), assumed |

`Ref`, `GetAtt` and `DependsOn` alone draw nothing: they are configuration, not traffic.

**Layout.** With a VPC, the **AZ-row three-tier** archetype places the cells and the shared pipeline does the rest:
Availability Zones are rows (one band per AZ, as tall as the busiest subnet column; the subnets of a band share its
height), tiers are columns (public, private, isolated subnets; inside a subnet the entry, compute and data columns,
deeper tiers further right, NAT gateways under the load balancer), VPC-level gateways sit on the VPC's left edge
centred on the bands, regional services that feed the VPC on its left and the rest on its right, global services
(CloudFront, Route 53) left of the Region, actors outside the AWS Cloud. A primary and its standby sit in one column
with the replication wire straight between the AZ rows. Without a VPC (a **serverless chain**), the layered layout of
the text importers places it left to right. Tracks, routes, labels, badges, the tile and the lint loop are shared.

**The ledger** (`report.ledger`, CLI `--ledger`) lists every fact the drawing rests on, and doubles as the question
list for the customer:
- `derived`: read from the source, with the chain ("PrivateSubnet1 is a private subnet with egress: route table
  PrivateRouteTable1 sends 0.0.0.0/0 to the NAT gateway NatGateway1"; "AppAsg reaches Database on :5432: DbSg allows
  ingress from AppSg (AppAsg carries AppSg through LaunchTemplate)").
- `assumed`: the importer had to choose (a parameter's default decided a condition, the AZ of a primary, the Users
  actor, a subnet's AZ); each carries `ask`, the question to put to the customer ("Which AZ holds Database's primary
  today?").
- `dropped`: not drawn, and why (operational, not architecture, a false condition, no edge between drawn resources).

`from` lists the resources a fact came from; every resource of the source appears in at least one entry.
`via: 'sidecar'` marks what the sidecar supplied (a pin, a hop, a confirmed edge).

### The flows sidecar
A separate JSON file (a TAM should not have to edit a customer's template), passed as `flows` (`--flows` on the CLI,
`flows` on the MCP `import_diagram` tool) or carried in the template's `Metadata."Prism::Flows"`:
```json
{
  "name": "Three-tier web app",
  "story": "page-view",
  "actors": [{ "id": "Users", "icon": "aws-res-users", "label": "Users", "side": "left" }],
  "flows": [{
    "id": "page-view", "name": "Browse a page", "dur": 10, "response": "reverse",
    "steps": [
      { "from": "Users", "to": "InternetGateway", "label": "HTTP :80", "text": "Users open the site." },
      { "from": "InternetGateway", "to": "LoadBalancer@az1" },
      { "from": "LoadBalancer@az1", "to": "AppAsg@az1", "label": ":8080" },
      { "from": "AppAsg@az1", "to": "Database@primary", "label": ":5432" },
      { "from": "Database@primary", "to": "Database@standby", "kind": "replication" }
    ]
  }],
  "stories": [
    { "id": "az-failure", "template": "az-fail", "flow": "page-view", "az": "az1", "promote": "Database@standby" },
    { "id": "scale-out", "template": "asg-scale", "asg": "AppAsg", "from": 2, "to": 4 }
  ],
  "hide": ["CpuAlarm"],
  "show": [],
  "merge": { "TargetGroup": "LoadBalancer" },
  "pin": { "Database@primary": "az1" },
  "group_hints": { "PrivateSubnet1": "iso", "SubnetX": { "kind": "pub", "az": 2 } },
  "overrides": { "AssetsBucket": { "icon": "aws-svc-simple-storage-service", "label": "Amazon S3", "sub": "assets" } },
  "anchors": { "Web": { "cfn": "LoadBalancer", "tf": "aws_lb.web", "cdk": "Stack/Alb/Resource" } }
}
```

| field | effect |
|---|---|
| `actors` | nodes outside the stack (users, partners, on-premises systems): `id`, `icon` (any name the resolver knows), `label`, `sub`, `side` (`left`, default, or `right`), `to` (refs to wire it to). They replace the assumed Users |
| `flows` | ordered request paths. A step names two **refs**: a logical id, a Terraform address, a CDK path, an anchor or an actor, with a qualifier for replicas: `@az1`, `@az2` (the replica in that AZ), `@primary`, `@standby` (a database), `@writer`, `@reader` (Aurora). An unqualified ref to a replicated resource takes the first replica (reported). `kind`: request (default: a numbered `pk` packet), `async` (numbered, the wire stays dashed), `replication` or `response` (`pk-2`, no badge), `bad` (`pk-bad`). `label` labels the wire, `text` is the badge's step text (default "A to B on label."). A step the source has no edge for adds a wire (a ledger fact); a request step over a weak IAM edge confirms it (solid). `response: reverse` replays the request steps backwards as responses. `dur` sets the clock. Steps compile to the timeline and badges with `story()` (even windows, one badge per request step) |
| `stories` | templates over a flow (`flow`, default the first): `az-fail` runs the flow, then fails the AZ (`fail` on its frame, `fade` on its wires) and runs the same request through the other AZ with the standby promoted (`glow` on that path; a wire the failover needs is added; the clock is lengthened); `asg-scale` adds instances to each of the ASG's frames, from `from` to `to` (default its Min and Max), shown with `appear` and ghosted when idle |
| `story` | the flow or story to draw (default the first flow); the `story` option overrides it |
| `hide`, `show` | drop a resource; draw an operational one (an alarm, a log group) |
| `merge` | draw a resource as part of another (its edges move there) |
| `pin` | which AZ a replica is in: `"Database@primary": "az2"` answers the ledger's "which AZ holds the primary" |
| `group_hints` | a subnet's kind (`pub`, `priv`, `iso`) and AZ when the source is ambiguous |
| `overrides` | a node's `icon`, `label` or `sub` (one replica with `"LoadBalancer@az2"`) |
| `anchors` | one stable name across a CloudFormation logical id, a Terraform address and a CDK path: it becomes the node id and a ref the flows can use, so a sidecar survives a refactor or a move from CloudFormation to Terraform |
| `name`, `desc`, `region` | the tile title, description and Region frame label |

### What IaC cannot tell
The ledger's `assumed` entries and the sidecar exist for these:
1. **Actors** outside the stack: users, browsers, partners, on-premises systems. Users at the internet-facing entry are
   assumed; the sidecar's `actors` say who they are.
2. **Request order**, the response path and which paths matter: IaC has dependencies, not traffic. No animation
   without a sidecar flow (`story: 'guess'` draws a breadth-first walk and says it is a guess).
3. **Which AZ holds a primary** (RDS picks it at deploy time; `pin` answers it) and anything a parameter decides
   (`params`; the ledger names the default that decided it).
4. **Runtime counts**: an ASG's Min, Max and Desired are in the ledger; the running count and placement are not
   (`asg-scale` draws a scale-out).
5. **Anything outside the stack**: DNS zones (a Route 53 node stands in), CDNs, WAF, Transit Gateway, shared VPCs,
   `Fn::ImportValue`, cross-account links; nested stacks' children; macros' output.
6. **Whether a grant is traffic**: an ARN in a policy is a dashed weak edge until a sidecar step confirms it.
7. **Terraform HCL** alone: modules, `count` and `for_each` need Terraform to expand them; values known only after
   apply are absent from a plan (the configuration's references still give the edges).

**Kit gaps met here.** No isolated-subnet frame (drawn as `priv` titled "Isolated subnet"); no security group icon
(security group chains become edges, not frames); no way to say one node spans AZs (replicas per AZ instead); no
`src` provenance field on nodes (the ledger and `report.resources` carry it).

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
  store, or other families' files. Use the primitives (legend, marks, notes, boxes, rings on points); if the kit still lacks something, use `extra` with a comment saying why, and report it.
- Descriptions: plain sentences, no em dashes, no marketing; say what animates.
- Section titles: a spaced dash or an em/en dash starts a subtitle that the catalog drops from the
  category ("NETWORKING - hub and spoke" files under "NETWORKING"); a hyphen inside a word stays.
- `preview` must report `validation: OK` and `lint: 0 error`, and `build` must succeed before you finish.
