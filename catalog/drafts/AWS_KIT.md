# AWS Architecture kit: authoring guide

Diagrams for Prism's **AWS Architecture** gallery are written as **specs** (plain JS data) and
compiled to self-contained SVG by `catalog/aws-kit/awd.mjs`. The output uses the **official AWS
Architecture Icons** (embedded once as a sprite, referenced by id), official group frames, numbered
steps, and motion on **one clock per diagram** (SMIL: no runtime JS). Styling lives in
`catalog/drafts/aws.css`. The exemplar is `catalog/aws-kit/specs/example.mjs`: read it first.

## Workflow
```bash
node catalog/aws-kit/awd.mjs icons lambda              # find icon ids (matches id/name/service/aliases)
node catalog/aws-kit/awd.mjs preview catalog/aws-kit/specs/<family>.mjs        # dark preview + validation
node catalog/aws-kit/awd.mjs preview catalog/aws-kit/specs/<family>.mjs light  # light preview
node catalog/aws-kit/awd.mjs build   catalog/aws-kit/specs/<family>.mjs        # -> catalog/drafts/<family>.aws.html
```
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
  diagrams: [{
    id: 'sl-api',            // unique across the WHOLE gallery: prefix with your family code (sl-, tt-, ds-, db-, mr-, vp-)
    name: 'Serverless REST API',   // tile title
    desc: '1-2 plain sentences: what the architecture is and what animates. No em dashes.',
    wide: false,             // true -> tile spans 2 columns: use w:960
    w: 480, h: 236,          // viewBox. Normal: w 480, h <= 300. Wide: w 960, h <= 440.
    dur: 6,                  // seconds; the single clock every animation in this diagram shares (6-10)
    groups:  [ { kind, x, y, w, h, label?, id?, icon?:false|'<icon id>', note? } ],   // draw OUTER groups first
    nodes:   [ { id, icon, x, y, size?:40, label?, wrap?:14, sub? } ],
    wires:   [ { id, from, to } | { id, d:'M..H..V..' } ,  dashed?, both?, flow?, label?, labelAt?:0.5, labelDx?, labelDy?:-5, labelAnchor?, via?, arrow?:false ],
    steps:   [ { n, at:'<wire id>', f?:0.5, dx?, dy?:-11 } | { n, x, y } ],
    timeline:[ { wire?, t:[a,b], reverse?, kind?:'pk'|'pk-2'|'pk-bad', ring?:'<node id>', r? } ],
    effects: [ { appear:'<node id>', t:[a,b], ghost?:true } | { fail:'<group id>', t } | { fade:'<wire id>', t } | { glow:'<wire id>', t } ],
    notes:   [ { x, y, text, kind?:'caption'|'label'|'warn', anchor?:'start'|'middle'|'end', t?:[a,b] } ],
    extra: '<raw svg appended last>',   // escape hatch for anything the kit lacks
  }],
};
```
**Groups** (`kind`): `cloud` (AWS Cloud), `region`, `az` (Availability Zone, dashed blue), `vpc`, `pub`
(public subnet), `priv` (private subnet), `sg` (security group), `asg` (Auto Scaling group), `acct`
(AWS account), `dc` (corporate data center), `server`, `ec2`, `spot`, `gen` (generic dashed).
The corner icon and label are automatic; override `label` (e.g. `'us-east-1'`, `'Private subnet 10.0.3.0/24'`).
Give a group an `id` if an effect targets it. `note` prints right-aligned on the group's top edge
(a CIDR, `0.0.0.0/0 > tgw`, an account id). `icon` may be any icon id, e.g. a `gen` frame for an
ECS service or a state machine gets that service's icon in its corner.

**Nodes**: `icon` is an id from the store: services `aws-svc-*`, resources `aws-res-*`. For icons
that ship as official colorway pairs (Users, Client, Office building, Servers, Internet...) pass the
base id (`aws-res-users`): the generator emits both and the theme picks one. Size 40 is standard;
use 32 for resource icons in dense diagrams. Labels are the official name, wrapped at 14 chars.

**Wires** auto-route from node to node (straight when aligned, one elbow otherwise; `via` pins the
elbow). Use explicit `d` with only `M`, `H`, `V` commands when you need a specific path. `dashed`
= async/optional/logical, `both` = bidirectional, `flow` = continuous stream (CSS dash motion).
`label` sits at the path's midpoint; move it with `labelAt` (0..1 along the path) when the midpoint
lands on a vertical run. Wires are opaque, so two wires may share a segment without doubling up. `labelDy` moves the label
(default -5 = above; +12 = below), `labelDx` sideways, `labelAnchor: 'start'` sets it beside a
vertical run.

**Notes** are free captions drawn on top of everything: tier names, DNS answers, route summaries,
"cache miss", "standby promoted". `kind: 'warn'` is red, `'label'` is ink, default is the muted
caption style; `
` breaks lines; `t: [a,b]` shows a note only during that window. Prefer notes over
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
- Write ONLY your own files: `catalog/aws-kit/specs/<family>.mjs`, its previews/screenshots, and the
  built `catalog/drafts/<family>.aws.html`. Do NOT edit `awd.mjs`, `aws.css`, `Prism.html`, the icon
  store, or other families' files. If the kit lacks something, use `extra` and report it.
- Descriptions: plain sentences, no em dashes, no marketing; say what animates.
- Section titles: no hyphens (the catalog cuts a category at the first dash: "MULTI-REGION" became
  "MULTI").
- `preview` must report `validation: OK` and `build` must succeed before you finish.
