// Databases family for the AWS Architecture kit. Build: node catalog/aws-kit/awd.mjs build catalog/aws-kit/specs/databases.mjs
// Spec-local helpers emit raw SVG into `extra` for the few things the kit has no primitive for
// (endpoint pills, caption swaps, storage bars). Every <animate> uses the diagram's own dur, so each
// diagram still has exactly one clock. Overlays that replace static text carry class "anim", so under
// reduced motion they are hidden and the static diagram stays complete.

const r2 = (n) => Math.round(n * 100) / 100;
const pc = (n) => String(r2(n)).replace(/^0\./, '.');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Build the helper set for a diagram clock of `dur` seconds.
function kit(dur) {
  const D = `${dur}s`;
  const win = (a, b, inner) => `<g class="anim" opacity="0">${inner}<animate attributeName="opacity" dur="${D}" repeatCount="indefinite" calcMode="discrete" values="0;1;0" keyTimes="0;${pc(a)};${pc(b)}"/></g>`;
  // text block: lines centered (anchor 'middle') or left/right aligned, one tspan per line
  const text = (x, y, lines, o = {}) => {
    const ls = Array.isArray(lines) ? lines : [lines];
    const st = `${o.anchor ? `text-anchor:${o.anchor};` : ''}${o.size ? `font-size:${o.size}px;` : ''}${o.weight ? `font-weight:${o.weight};` : ''}${o.fill ? `fill:${o.fill};` : ''}`;
    const cls = o.cls || (o.anchor ? '' : 't-c');
    return `<text${cls ? ` class="${cls}"` : ''}${st ? ` style="${st}"` : ''} x="${r2(x)}" y="${r2(y)}">${ls.map((l, i) => `<tspan x="${r2(x)}"${i ? ` dy="${o.lh || 11}"` : ''}>${esc(l)}</tspan>`).join('')}</text>`;
  };
  // opaque patch (panel color, plus an optional tint to match a tinted group) that hides static text under it
  const patch = (x, y, w, h, tint) => `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" style="fill:var(--awd-panel)"/>${tint ? `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" fill="${tint}"/>` : ''}`;
  // endpoint pill (a DNS name is not a service, so it is drawn as a labelled pill, not an icon)
  const pill = (cx, cy, w, h, lines, o = {}) => {
    const ls = Array.isArray(lines) ? lines : [lines];
    const y0 = cy + 3.2 - (ls.length - 1) * 5;
    return `<rect x="${r2(cx - w / 2)}" y="${r2(cy - h / 2)}" width="${w}" height="${h}" rx="${Math.min(h / 2, 14)}" style="fill:var(--awd-panel2);stroke:var(--awd-wire);stroke-width:1.25"/>`
      + text(cx, y0, ls[0], { size: o.size || 9, weight: 700 })
      + ls.slice(1).map((l, i) => text(cx, y0 + 10 * (i + 1), l, { size: 8, weight: 500, fill: 'var(--awd-muted)' })).join('');
  };
  // arrival pulse on an arbitrary point (for things drawn in extra, which the kit timeline cannot ring)
  const pulse = (cx, cy, r0, t, kind) => {
    const t1 = Math.max(0.001, t - 0.001), t2 = Math.min(0.995, t + 0.12);
    return `<circle class="${kind === 'pk-2' ? 'ring-2' : 'ring'}" cx="${r2(cx)}" cy="${r2(cy)}" r="${r0}" opacity="0"><animate attributeName="opacity" dur="${D}" repeatCount="indefinite" values="0;0;.9;0;0" keyTimes="0;${pc(t1)};${pc(t)};${pc(t2)};1"/><animate attributeName="r" dur="${D}" repeatCount="indefinite" values="${r0};${r0};${r0};${r2(r0 * 1.45)};${r2(r0 * 1.45)}" keyTimes="0;${pc(t1)};${pc(t)};${pc(t2)};1"/></circle>`;
  };
  return { win, text, patch, pill, pulse };
}

// the official generic Database icon (dark/light colorway pair) for things drawn inside `extra`
const dbIco = (x, y, s) => `<use class="cw-d" href="#aws-res-database-dark" x="${r2(x)}" y="${r2(y)}" width="${s}" height="${s}"/><use class="cw-l" href="#aws-res-database-light" x="${r2(x)}" y="${r2(y)}" width="${s}" height="${s}"/>`;

const TINT_PRIV = 'rgba(0,164,166,.10)'; // matches the kit's private-subnet fill, for patches inside subnets

// ---------------------------------------------------------------------------------------------
// db-multiaz: Amazon RDS Multi-AZ (instance deployment) with failover
// ---------------------------------------------------------------------------------------------
function multiAz() {
  const K = kit(9);
  // geometry
  const azA = { x: 196, y: 84, w: 252, h: 78 }, azB = { x: 196, y: 188, w: 252, h: 78 };
  const subA = { x: 204, y: 106, w: 236, h: 50 }, subB = { x: 204, y: 210, w: 236, h: 50 };
  const ix = 326; // db icon x (right part of the subnet, clear of the subnet label)
  const pA = { x: ix, y: subA.y + 5 }, pB = { x: ix, y: subB.y + 5 };
  const cx = ix + 20, cyA = pA.y + 20, cyB = pB.y + 20;
  const pillC = { x: 145, y: 183, w: 74, h: 30 };
  const wApp = 'M84,183 H104';
  const wPrim = `M${pillC.x},${pillC.y - 15} V${cyA} H${ix - 4}`;
  const wStby = `M${pillC.x},${pillC.y + 15} V${cyB} H${ix - 4}`;
  const wSync = `M${cx},${pA.y + 42} V${pB.y - 4}`;

  const extra = [
    // the DB instance endpoint (a DNS name, so a labelled pill rather than an icon)
    K.pill(pillC.x, pillC.y, pillC.w, pillC.h, ['DB instance', 'endpoint']),
    // side labels for the two DB instances (inside the subnets, right of the icons)
    K.text(ix + 46, cyA - 2, ['Primary', 'DB instance'], { anchor: 'start' }),
    K.text(ix + 46, cyB - 2, ['Standby', 'DB instance'], { anchor: 'start' }),
    K.win(0.66, 0.97, K.patch(ix + 44, cyB - 12, 66, 26, TINT_PRIV) + K.text(ix + 46, cyB - 2, ['Primary', '(promoted)'], { anchor: 'start', fill: 'var(--awd-pk)' })),
    // wire label: synchronous replication (right-aligned left of the vertical wire, inside the AZ gap)
    K.text(cx - 8, 178.5, 'Synchronous replication', { cls: 't-wire', anchor: 'end' }),
    // narration (left zone)
    K.text(34, 98, ['The endpoint CNAME points to', 'the primary. Every write is', 'replicated synchronously.'], { anchor: 'start', size: 8.5, fill: 'var(--awd-muted)', lh: 10.5 }),
    K.win(0.66, 0.97, K.patch(30, 88, 162, 40) + K.text(34, 98, ['AZ a fails: RDS promotes the', 'standby and flips the endpoint', 'CNAME (typically 60 to 120 s).'], { anchor: 'start', size: 8.5, fill: 'var(--awd-pk)', lh: 10.5 })),
  ].join('');

  return {
    id: 'db-multiaz',
    name: 'Amazon RDS Multi-AZ Instance Deployment',
    desc: 'An application writes through the DB instance endpoint to the primary, which replicates synchronously to a standby in another Availability Zone. Packets show a write, then AZ a failing, the standby being promoted and the endpoint CNAME flipping to it.',
    w: 480, h: 298, dur: 9,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 464, h: 282 },
      { kind: 'region', x: 16, y: 34, w: 448, h: 248, label: 'Region' },
      { kind: 'vpc', x: 24, y: 60, w: 432, h: 214 },
      { kind: 'az', id: 'az-a', ...azA, label: 'Availability Zone a' },
      { kind: 'az', id: 'az-b', ...azB, label: 'Availability Zone b' },
      { kind: 'priv', ...subA }, { kind: 'priv', ...subB },
    ],
    nodes: [
      { id: 'app', icon: 'aws-res-ec2-instance', x: 40, y: 163, label: 'Application' },
      { id: 'primary', icon: 'aws-res-aurora-rds-instance', x: pA.x, y: pA.y },
      { id: 'standby', icon: 'aws-res-aurora-rds-instance', x: pB.x, y: pB.y },
    ],
    wires: [
      { id: 'w-app', d: wApp },
      { id: 'w-prim', d: wPrim },
      { id: 'w-stby', d: wStby, dashed: true },
      { id: 'w-sync', d: wSync },
    ],
    steps: [
      { n: 1, at: 'w-app', f: 0.5, text: 'The application connects to the DB instance endpoint, a DNS name whose CNAME points to the primary DB instance.' },
      { n: 2, x: 157, y: 150, text: 'The connection reaches the primary DB instance in Availability Zone a, which serves all reads and writes.' },
      { n: 3, x: 357, y: 175, text: 'The primary replicates each write synchronously to the standby in Availability Zone b. If AZ a fails, RDS promotes the standby and points the endpoint CNAME to it.' },
    ],
    timeline: [
      { wire: 'w-app', t: [0.03, 0.10] },
      { wire: 'w-prim', t: [0.11, 0.21], ring: 'primary' },
      { wire: 'w-sync', t: [0.23, 0.33], kind: 'pk-2', ring: 'standby' },
      { wire: 'w-app', t: [0.47, 0.54] },
      { wire: 'w-prim', t: [0.55, 0.63], kind: 'pk-bad' },
      { wire: 'w-app', t: [0.70, 0.76] },
      { wire: 'w-stby', t: [0.77, 0.88], ring: 'standby' },
    ],
    effects: [
      { fail: 'az-a', t: [0.50, 0.97] },
      { fade: 'w-prim', t: [0.58, 0.97] },
      { fade: 'w-sync', t: [0.52, 0.97] },
      { glow: 'w-stby', t: [0.66, 0.97] },
    ],
    extra,
  };
}

// ---------------------------------------------------------------------------------------------
// db-cluster: RDS Multi-AZ DB cluster (one writer, two readable standbys, three AZs)
// ---------------------------------------------------------------------------------------------
function cluster() {
  const K = kit(9);
  const colX = [100, 219, 338], colW = 112, cx = colX.map((x) => x + 56);
  const azY = 128, azH = 134, icY = 156, lblY = icY + 52;
  const cP = { x: 160, y: 106, w: 96, h: 28 };      // cluster endpoint pill
  const rP = { x: 334.5, y: 80, w: 180, h: 28 };    // reader endpoint pill (spans the two reader columns)
  const wAppC = `M86,106 H${cP.x - cP.w / 2 - 4}`;
  const wAppR = `M86,106 H96 V${rP.y} H${rP.x - rP.w / 2 - 4}`;
  const wCW = `M${cx[0]},${cP.y + cP.h / 2} V${icY - 4}`;
  const wRb = `M${cx[1]},${rP.y + rP.h / 2} V${icY - 4}`;
  const wRc = `M${cx[2]},${rP.y + rP.h / 2} V${icY - 4}`;
  // one replication rail under the labels; wires are opaque, so both readers share the stem and the rail
  const yr = 228, up = lblY + 9;
  const rb = `M${cx[0]},${up} V${yr} H${cx[1]} V${up}`;
  const rc = `M${cx[0]},${up} V${yr} H${cx[2]} V${up}`;

  const extra = [
    K.pill(cP.x, cP.y, cP.w, cP.h, ['Cluster endpoint', 'read/write']),
    K.pill(rP.x, rP.y, rP.w, rP.h, ['Reader endpoint', 'read-only, load balanced']),
    K.text(cx[1], yr + 14, ['Semisynchronous', 'replication'], { cls: 't-wire' }),
  ].join('');

  return {
    id: 'db-cluster',
    name: 'Amazon RDS Multi-AZ DB Cluster',
    desc: 'A Multi-AZ DB cluster has one writer and two readable standby DB instances in three Availability Zones, replicated semisynchronously. Packets show a write through the cluster endpoint, its replication and acknowledgment, then reads through the reader endpoint.',
    w: 480, h: 294, dur: 9,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 464, h: 278 },
      { kind: 'region', x: 16, y: 34, w: 448, h: 244, label: 'Region' },
      { kind: 'vpc', x: 24, y: 60, w: 432, h: 210 },
      { kind: 'az', x: colX[0], y: azY, w: colW, h: azH, label: 'AZ a' },
      { kind: 'az', x: colX[1], y: azY, w: colW, h: azH, label: 'AZ b' },
      { kind: 'az', x: colX[2], y: azY, w: colW, h: azH, label: 'AZ c' },
    ],
    nodes: [
      { id: 'app', icon: 'aws-res-ec2-instance', x: 42, y: 86, label: 'Application' },
      { id: 'writer', icon: 'aws-res-aurora-rds-instance', x: cx[0] - 20, y: icY, label: 'Writer DB instance', wrap: 20 },
      { id: 'rd1', icon: 'aws-res-aurora-rds-instance', x: cx[1] - 20, y: icY, label: 'Reader DB instance', wrap: 20 },
      { id: 'rd2', icon: 'aws-res-aurora-rds-instance', x: cx[2] - 20, y: icY, label: 'Reader DB instance', wrap: 20 },
    ],
    wires: [
      { id: 'w-appc', d: wAppC }, { id: 'w-appr', d: wAppR },
      { id: 'w-cw', d: wCW }, { id: 'w-rb', d: wRb }, { id: 'w-rc', d: wRc },
      { id: 'rep-b', d: rb, dashed: true }, { id: 'rep-c', d: rc, dashed: true },
    ],
    steps: [
      { n: 1, x: 100, y: 116, text: 'The application sends writes to the cluster endpoint, which connects to the writer DB instance in AZ a.' },
      { n: 2, x: 360, y: 240, text: 'The writer replicates each change semisynchronously to both reader DB instances and commits once at least one of them acknowledges it.' },
      { n: 3, x: 226, y: 91, text: 'The application sends read-only queries to the reader endpoint, which load balances them across the two reader DB instances.' },
    ],
    timeline: [
      { wire: 'w-appc', t: [0.03, 0.10] },
      { wire: 'w-cw', t: [0.11, 0.19], ring: 'writer' },
      { wire: 'rep-b', t: [0.21, 0.32], kind: 'pk-2', ring: 'rd1' },
      { wire: 'rep-c', t: [0.21, 0.34], kind: 'pk-2', ring: 'rd2' },
      { wire: 'rep-b', t: [0.36, 0.46], kind: 'pk-2', reverse: true, ring: 'writer' },
      { wire: 'w-appr', t: [0.50, 0.58] },
      { wire: 'w-rb', t: [0.59, 0.67], ring: 'rd1' },
      { wire: 'w-appr', t: [0.69, 0.77] },
      { wire: 'w-rc', t: [0.78, 0.86], ring: 'rd2' },
    ],
    extra,
  };
}

// ---------------------------------------------------------------------------------------------
// db-aurora: Aurora cluster, writer + readers over one shared cluster volume (six copies, two per AZ)
// ---------------------------------------------------------------------------------------------
function aurora() {
  const K = kit(8);
  const colX = [100, 219, 338], colW = 112, cx = colX.map((x) => x + 56);
  const azY = 110, azH = 166, icY = 138, lblY = icY + 52;
  const barY = 222, barH = 46;
  const cP = { x: 160, y: 88, w: 96, h: 28 };
  const rP = { x: 334.5, y: 64, w: 180, h: 28 };
  const wAppC = `M86,88 H${cP.x - cP.w / 2 - 4}`;
  const wAppR = `M86,88 H96 V${rP.y} H${rP.x - rP.w / 2 - 4}`;
  const wCW = `M${cx[0]},${cP.y + cP.h / 2} V${icY - 4}`;
  const wRb = `M${cx[1]},${rP.y + rP.h / 2} V${icY - 4}`;
  const wRc = `M${cx[2]},${rP.y + rP.h / 2} V${icY - 4}`;
  const wWrite = `M${cx[0]},${lblY + 8} V${barY - 3}`;
  const wRead1 = `M${cx[1]},${barY - 2} V${lblY + 8}`;
  const wRead2 = `M${cx[2]},${barY - 2} V${lblY + 8}`;
  const copyY = barY + 11, cs = 24;
  const copies = []; // [cx, cy] of the six copies, two per AZ
  for (let i = 0; i < 3; i++) { copies.push([cx[i] - 15, copyY + cs / 2], [cx[i] + 15, copyY + cs / 2]); }

  const extra = [
    K.pill(cP.x, cP.y, cP.w, cP.h, ['Cluster endpoint', 'writer']),
    K.pill(rP.x, rP.y, rP.w, rP.h, ['Reader endpoint', 'load balances the readers']),
    // the cluster volume: one bar crossing the three AZ columns (opaque so the AZ borders pass behind it)
    `<rect x="${colX[0] + 4}" y="${barY}" width="${colX[2] + colW - 4 - (colX[0] + 4)}" height="${barH}" rx="6" style="fill:color-mix(in srgb,#C925D1 16%,var(--awd-panel));stroke:#C925D1;stroke-width:1.4"/>`,
    ...copies.map(([x, y]) => dbIco(x - cs / 2, y - cs / 2, cs)),
    K.text(94, barY + 17, ['Aurora cluster', 'volume'], { anchor: 'end', size: 9.5, weight: 700, lh: 11 }),
    K.text(94, barY + 41, '6 copies, 3 AZs', { anchor: 'end', size: 8.5, fill: 'var(--awd-muted)' }),
    // the write fans out to all six copies, staggered by AZ
    ...[0, 1, 2].map((i) => K.pulse(cx[i] - 15, copyY + cs / 2, 14, 0.30 + 0.015 * i, 'pk-2') + K.pulse(cx[i] + 15, copyY + cs / 2, 14, 0.30 + 0.015 * i, 'pk-2')),
  ].join('');

  return {
    id: 'db-aurora',
    name: 'Amazon Aurora DB Cluster',
    desc: 'A writer and two readers in three Availability Zones share one cluster volume that keeps six copies of the data, two per AZ. Packets show a write fanning out to all six copies, then reads served from the same volume.',
    w: 480, h: 300, dur: 8,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 464, h: 284 },
      { kind: 'region', x: 16, y: 34, w: 448, h: 250, label: 'Region' },
      { kind: 'az', x: colX[0], y: azY, w: colW, h: azH, label: 'AZ a' },
      { kind: 'az', x: colX[1], y: azY, w: colW, h: azH, label: 'AZ b' },
      { kind: 'az', x: colX[2], y: azY, w: colW, h: azH, label: 'AZ c' },
    ],
    nodes: [
      { id: 'app', icon: 'aws-res-ec2-instance', x: 42, y: 68, label: 'Application' },
      { id: 'writer', icon: 'aws-res-aurora-instance-alternate', x: cx[0] - 20, y: icY, label: 'Writer DB instance', wrap: 20 },
      { id: 'rd1', icon: 'aws-res-aurora-instance-alternate', x: cx[1] - 20, y: icY, label: 'Reader DB instance', wrap: 20 },
      { id: 'rd2', icon: 'aws-res-aurora-instance-alternate', x: cx[2] - 20, y: icY, label: 'Reader DB instance', wrap: 20 },
    ],
    wires: [
      { id: 'w-appc', d: wAppC }, { id: 'w-appr', d: wAppR },
      { id: 'w-cw', d: wCW }, { id: 'w-rb', d: wRb }, { id: 'w-rc', d: wRc },
      { id: 'w-write', d: wWrite },
      { id: 'w-read1', d: wRead1, dashed: true }, { id: 'w-read2', d: wRead2, dashed: true },
    ],
    steps: [
      { n: 1, x: 100, y: 98, text: 'The application sends writes to the cluster endpoint, which always connects to the writer DB instance.' },
      { n: 2, x: 168, y: 210, text: 'The writer DB instance writes to the shared Aurora cluster volume, which keeps six copies of the data, two in each of three AZs.' },
      { n: 3, x: 150, y: 53, text: 'The application reads through the reader endpoint, which load balances across the reader DB instances. They read from the same cluster volume.' },
    ],
    timeline: [
      { wire: 'w-appc', t: [0.04, 0.10] },
      { wire: 'w-cw', t: [0.11, 0.19], ring: 'writer' },
      { wire: 'w-write', t: [0.21, 0.29], kind: 'pk-2' },
      { wire: 'w-appr', t: [0.44, 0.51] },
      { wire: 'w-rb', t: [0.52, 0.59], ring: 'rd1' },
      { wire: 'w-rc', t: [0.52, 0.60], ring: 'rd2' },
      { wire: 'w-read1', t: [0.63, 0.71], kind: 'pk-2', ring: 'rd1' },
      { wire: 'w-read2', t: [0.63, 0.72], kind: 'pk-2', ring: 'rd2' },
    ],
    extra,
  };
}

// ---------------------------------------------------------------------------------------------
// db-serverless: Aurora Serverless v2 capacity (ACUs) following load, using the kit's appear effect
// ---------------------------------------------------------------------------------------------
function serverless() {
  const K = kit(9);
  const ts = 22, tileX = (k) => 212 + 30 * k, tileY = 105;
  const ctr = (tileX(0) + tileX(7) + ts) / 2; // centre of the tile row
  const mutedC = (x, y, t, size = 8.5) => K.text(x, y, t, { anchor: 'middle', size, fill: 'var(--awd-muted)' });
  const tiles = Array.from({ length: 8 }, (_, k) => ({ id: 't' + k, icon: 'aws-svc-aurora', x: tileX(k), y: tileY, size: ts }));
  // tile k (2..7) is shown while capacity is at least k+1 tiles: nested windows, rising then falling
  const appear = [[0.12, 0.90], [0.18, 0.84], [0.24, 0.78], [0.30, 0.72], [0.36, 0.66], [0.42, 0.60]].map((t, i) => ({ appear: 't' + (i + 2), t, ghost: true }));
  // request load: sparse, ramping, dense at the peak, then easing off
  const load = [[0.03, 0.10], [0.15, 0.22], [0.21, 0.28], [0.26, 0.33], [0.30, 0.37], [0.34, 0.41], [0.38, 0.45], [0.41, 0.48],
    [0.44, 0.51], [0.47, 0.54], [0.50, 0.57], [0.53, 0.60], [0.62, 0.69], [0.68, 0.75], [0.74, 0.81], [0.82, 0.89]];
  const ringAt = new Set([0, 4, 8, 12, 15]);
  const cap = (a, b, t) => K.win(a, b, K.patch(ctr - 112, 157, 224, 14) + K.text(ctr, 166, t, { anchor: 'middle', size: 8.5, fill: 'var(--awd-pk)' }));
  const extra = [
    mutedC(ctr, 98, 'Capacity in ACUs, adjusted in 0.5 ACU steps'),
    // configured capacity range: bracket under the tiles with min / max
    `<path class="w" d="M${tileX(0)},129 V134 H${tileX(7) + ts} V129" style="stroke-width:1"/>`,
    K.text(tileX(0), 146, 'min', { anchor: 'start', size: 8.5, fill: 'var(--awd-muted)' }),
    K.text(tileX(7) + ts, 146, 'max', { anchor: 'end', size: 8.5, fill: 'var(--awd-muted)' }),
    // shared cluster volume under the writer (storage is separate from compute)
    `<rect x="108" y="184" width="332" height="24" rx="6" style="fill:color-mix(in srgb,#C925D1 16%,var(--awd-panel));stroke:#C925D1;stroke-width:1.4"/>`,
    K.text(274, 200, 'Cluster volume: shared storage that grows automatically', { anchor: 'middle', size: 9, weight: 600 }),
    // load narration: static base text, swapped over by the live phases
    K.text(ctr, 166, 'Capacity follows the load, between min and max', { anchor: 'middle', size: 8.5, fill: 'var(--awd-muted)' }),
    cap(0.005, 0.12, 'Low load: minimum capacity'),
    cap(0.12, 0.40, 'Load rising: capacity scales up in place'),
    cap(0.40, 0.62, 'Peak load: capacity at its maximum'),
    cap(0.62, 0.90, 'Load falling: capacity scales back down'),
    cap(0.90, 0.995, 'Low load: minimum capacity'),
  ].join('');

  return {
    id: 'db-serverless',
    name: 'Amazon Aurora Serverless v2 Scaling',
    desc: 'An Aurora Serverless v2 writer scales its capacity in ACUs in place, between a configured minimum and maximum, while storage stays on the shared cluster volume. Capacity tiles appear as the load rises and drop away as it falls.',
    w: 480, h: 242, dur: 9,
    groups: [
      { kind: 'cloud', x: 76, y: 8, w: 396, h: 226 },
      { kind: 'region', x: 84, y: 34, w: 380, h: 192, label: 'Region' },
      { kind: 'gen', x: 92, y: 60, w: 364, h: 158, label: 'Aurora DB cluster' },
    ],
    nodes: [
      { id: 'users', icon: 'aws-res-users', x: 8, y: 96, label: 'Users' },
      { id: 'writer', icon: 'aws-res-aurora-instance-alternate', x: 130, y: 96, label: 'Writer DB instance', wrap: 20, sub: 'db.serverless' },
      ...tiles,
    ],
    wires: [
      { id: 'w-in', d: 'M52,116 H126' },
      { id: 'w-vol', d: 'M150,167 V181' },
    ],
    steps: [
      { n: 1, x: 62, y: 104, text: 'Users send requests to the writer DB instance. As the load rises and falls, Aurora Serverless v2 scales its capacity in place between the minimum and maximum ACUs.' },
      { n: 2, x: 164, y: 174, text: 'The writer DB instance reads and writes the shared cluster volume. Storage is separate from compute and grows automatically.' },
    ],
    timeline: [
      ...load.map((t, i) => ({ wire: 'w-in', t, ...(ringAt.has(i) ? { ring: 'writer' } : {}) })),
      { wire: 'w-vol', t: [0.30, 0.36], kind: 'pk-2' },
      { wire: 'w-vol', t: [0.50, 0.56], kind: 'pk-2' },
      { wire: 'w-vol', t: [0.70, 0.76], kind: 'pk-2' },
    ],
    effects: appear,
    extra,
  };
}

// ---------------------------------------------------------------------------------------------
// db-proxy: RDS Proxy pooling connections from a Lambda fleet
// ---------------------------------------------------------------------------------------------
function proxy() {
  const K = kit(8);
  const lx = 56, ls = 26, lcy = [131, 163, 195, 227], bus = 150, pcy = 179;
  const stub = (i) => `M${lx + ls + 2},${lcy[i]} H${bus} V${pcy}`;   // four stubs share the trunk into the proxy
  const muted = (x, y, t, anchor = 'middle') => K.text(x, y, t, { anchor, size: 8.5, fill: 'var(--awd-muted)' });
  const extra = [
    K.text(276, 58, ['AWS Secrets', 'Manager'], { anchor: 'start' }),
    muted(258, 122, 'credentials', 'start'),
    K.text(lx + ls / 2, 252, ['AWS Lambda', 'functions'], { anchor: 'middle' }),
    muted(142, 121, 'Many app connections'),
    muted(326, 165, 'Pooled connections'),
  ].join('');
  const L = [0, 1, 2, 3];
  return {
    id: 'db-proxy',
    name: 'Amazon RDS Proxy Connection Pooling',
    desc: 'A fleet of AWS Lambda functions opens many connections to Amazon RDS Proxy, which pools them into a few reused connections to the RDS or Aurora database and reads the credentials from AWS Secrets Manager. Packets show requests converging, being multiplexed, and responses fanning back out.',
    w: 480, h: 300, dur: 8,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 464, h: 284 },
      { kind: 'region', x: 16, y: 34, w: 448, h: 250, label: 'Region' },
      { kind: 'vpc', x: 24, y: 92, w: 432, h: 184 },
    ],
    nodes: [
      { id: 'sec', icon: 'aws-svc-secrets-manager', x: 230, y: 42 },
      ...L.map((i) => ({ id: 'l' + i, icon: 'aws-svc-lambda', x: lx, y: lcy[i] - ls / 2, size: ls })),
      { id: 'proxy', icon: 'aws-res-rds-proxy-instance-alternate', x: 230, y: 159, label: 'Amazon RDS Proxy', sub: 'connection pooling' },
      { id: 'db', icon: 'aws-res-aurora-rds-instance', x: 380, y: 159, label: 'RDS or Aurora DB instance' },
    ],
    wires: [
      { id: 'sec', d: 'M250,84 V155', dashed: true },
      ...L.map((i) => ({ id: 's' + i, d: stub(i), arrow: false })),
      { id: 'merge', d: `M${bus},${pcy} H226` },
      { id: 'o1', d: 'M276,173 H376' },
      { id: 'o2', d: 'M276,185 H376' },
    ],
    steps: [
      { n: 1, x: 235, y: 108, text: 'Amazon RDS Proxy retrieves the database credentials from AWS Secrets Manager.' },
      { n: 2, at: 'merge', f: 0.5, dy: -11, text: 'AWS Lambda functions open many connections to RDS Proxy instead of connecting to the database directly.' },
      { n: 3, x: 326, y: 197, text: 'RDS Proxy multiplexes the requests over a few pooled, reused connections to the RDS or Aurora DB instance and returns each response to its function.' },
    ],
    timeline: [
      { wire: 'sec', t: [0.02, 0.09], kind: 'pk-2', ring: 'proxy' },
      ...L.map((i) => ({ wire: 's' + i, t: [0.12 + 0.02 * i, 0.19 + 0.02 * i] })),
      ...L.map((i) => ({ wire: 'merge', t: [0.19 + 0.02 * i, 0.27 + 0.02 * i], ...(i === 3 ? { ring: 'proxy' } : {}) })),
      { wire: 'o1', t: [0.31, 0.41], ring: 'db' },
      { wire: 'o2', t: [0.35, 0.45] },
      { wire: 'o1', t: [0.50, 0.60], kind: 'pk-2', reverse: true, ring: 'proxy' },
      { wire: 'o2', t: [0.52, 0.62], kind: 'pk-2', reverse: true },
      { wire: 'merge', t: [0.62, 0.70], kind: 'pk-2', reverse: true },
      { wire: 'merge', t: [0.66, 0.74], kind: 'pk-2', reverse: true },
      ...L.map((i) => ({ wire: 's' + i, t: [0.72 + 0.01 * i, 0.80 + 0.01 * i], kind: 'pk-2', reverse: true, ring: 'l' + i })),
    ],
    extra,
  };
}

// ---------------------------------------------------------------------------------------------
// db-cache: ElastiCache cache-aside in front of RDS (a miss, then a hit)
// ---------------------------------------------------------------------------------------------
function cache() {
  const K = kit(10);
  const mutedS = (x, y, lines) => K.text(x, y, lines, { anchor: 'start', size: 8.5, fill: 'var(--awd-muted)', lh: 10.5 });
  const note = (a, b, lines) => K.win(a, b, K.patch(96, 222, 150, 38) + K.text(100, 232, lines, { anchor: 'start', size: 8.5, fill: 'var(--awd-pk)', lh: 10.5 }));
  const extra = [
    K.text(308, 114, 'GET / SET with TTL', { cls: 't-wire' }),
    K.text(308, 204, 'SQL query on a miss', { cls: 't-wire' }),
    mutedS(100, 232, ['Cache-aside: read the cache first,', 'query RDS only on a miss, then', 'fill the cache for the next read.']),
    note(0.005, 0.60, ['Request 1, cache miss: read', 'RDS, then fill the cache.']),
    note(0.60, 0.995, ['Request 2, cache hit: answered', 'from memory, RDS not touched.']),
  ].join('');
  return {
    id: 'db-cache',
    name: 'Amazon ElastiCache Cache-Aside',
    desc: 'The application checks Amazon ElastiCache first; on a miss it queries Amazon RDS and writes the result back to the cache. Packets show a miss that fills the cache, then a hit that never reaches the database.',
    w: 480, h: 290, dur: 10,
    groups: [
      { kind: 'cloud', x: 76, y: 8, w: 396, h: 274 },
      { kind: 'region', x: 84, y: 34, w: 380, h: 240, label: 'Region' },
      { kind: 'vpc', x: 92, y: 60, w: 364, h: 206 },
    ],
    nodes: [
      { id: 'users', icon: 'aws-res-users', x: 14, y: 136, label: 'Users' },
      { id: 'app', icon: 'aws-res-ec2-instance', x: 150, y: 136, label: 'Application' },
      { id: 'cache', icon: 'aws-svc-elasticache', x: 360, y: 82, label: 'Amazon ElastiCache' },
      { id: 'db', icon: 'aws-res-aurora-rds-instance', x: 360, y: 190, label: 'Amazon RDS DB instance' },
    ],
    wires: [
      { id: 'u-app', d: 'M58,156 H146' },
      { id: 'a-cache', d: 'M194,148 H260 V102 H356' },
      { id: 'a-db', d: 'M194,164 H260 V210 H356' },
    ],
    steps: [
      { n: 1, x: 121, y: 144, text: 'Users send a request to the application.' },
      { n: 2, x: 300, y: 91, text: 'The application reads the key from Amazon ElastiCache first. On a cache hit, it answers from memory without touching the database.' },
      { n: 3, x: 300, y: 222, text: 'On a cache miss, the application queries the Amazon RDS DB instance, then writes the result to ElastiCache with a TTL for the next read.' },
    ],
    timeline: [
      // request 1: a miss
      { wire: 'u-app', t: [0.03, 0.08] },
      { wire: 'a-cache', t: [0.09, 0.16], ring: 'cache' },
      { wire: 'a-cache', t: [0.17, 0.24], kind: 'pk-2', reverse: true },
      { wire: 'a-db', t: [0.26, 0.33], ring: 'db' },
      { wire: 'a-db', t: [0.34, 0.41], kind: 'pk-2', reverse: true },
      { wire: 'a-cache', t: [0.42, 0.49], ring: 'cache' },
      { wire: 'u-app', t: [0.50, 0.55], kind: 'pk-2', reverse: true },
      // request 2: a hit
      { wire: 'u-app', t: [0.63, 0.68] },
      { wire: 'a-cache', t: [0.69, 0.76], ring: 'cache' },
      { wire: 'a-cache', t: [0.77, 0.84], kind: 'pk-2', reverse: true },
      { wire: 'u-app', t: [0.85, 0.90], kind: 'pk-2', reverse: true },
    ],
    extra,
  };
}

// ---------------------------------------------------------------------------------------------
// db-ddb-global: DynamoDB global tables, active-active between two Regions
// ---------------------------------------------------------------------------------------------
function ddbGlobal() {
  const K = kit(10);
  const extra = [
    K.text(348, 161.5, 'Asynchronous replication', { cls: 't-wire', anchor: 'end' }),
    K.text(380, 161.5, 'Last writer wins', { cls: 't-wire', anchor: 'start' }),
  ].join('');
  const row = (suffix, cy) => ([
    { id: 'users-' + suffix, icon: 'aws-res-users', x: 14, y: cy - 20, label: 'Users' },
    { id: 'fn-' + suffix, icon: 'aws-svc-lambda', x: 164, y: cy - 20, label: 'AWS Lambda' },
    { id: 'tbl-' + suffix, icon: 'aws-svc-dynamodb', x: 344, y: cy - 20, label: 'Amazon DynamoDB', wrap: 20, sub: 'global table replica' },
  ]);
  return {
    id: 'db-ddb-global',
    name: 'Amazon DynamoDB Global Tables',
    desc: 'A DynamoDB global table keeps a replica in each Region and replicates changes both ways, so users write locally in either Region and concurrent updates resolve by last writer wins. Packets show a write in us-east-1 reaching eu-west-1, then a write in eu-west-1 reaching us-east-1.',
    w: 480, h: 296, dur: 10,
    groups: [
      { kind: 'cloud', x: 76, y: 8, w: 396, h: 280 },
      { kind: 'region', x: 84, y: 34, w: 380, h: 110, label: 'us-east-1' },
      { kind: 'region', x: 84, y: 170, w: 380, h: 110, label: 'eu-west-1' },
    ],
    nodes: [...row('a', 82), ...row('b', 218)],
    wires: [
      { id: 'ua', d: 'M58,82 H160' }, { id: 'fa', d: 'M208,82 H340' },
      { id: 'ub', d: 'M58,218 H160' }, { id: 'fb', d: 'M208,218 H340' },
      { id: 'repl', d: 'M364,134 V194', both: true, dashed: true },
    ],
    steps: [
      { n: 1, at: 'ua', f: 0.5, dy: -12, text: 'Users in us-east-1 call AWS Lambda, which writes to the local replica of the Amazon DynamoDB global table.' },
      { n: 2, x: 364, y: 157, text: 'DynamoDB replicates each change asynchronously to the replica in the other Region. Concurrent updates to the same item resolve by last writer wins.' },
      { n: 3, at: 'ub', f: 0.5, dy: -12, text: 'Users in eu-west-1 write to their local replica the same way, and DynamoDB replicates those changes back to us-east-1.' },
    ],
    timeline: [
      { wire: 'ua', t: [0.03, 0.09] },
      { wire: 'fa', t: [0.10, 0.17], ring: 'tbl-a' },
      { wire: 'repl', t: [0.19, 0.31], kind: 'pk-2', ring: 'tbl-b' },
      { wire: 'ub', t: [0.50, 0.56] },
      { wire: 'fb', t: [0.57, 0.64], ring: 'tbl-b' },
      { wire: 'repl', t: [0.66, 0.78], kind: 'pk-2', reverse: true, ring: 'tbl-a' },
    ],
    extra,
  };
}

// ---------------------------------------------------------------------------------------------
// db-replicas (wide): in-Region read replicas plus a cross-Region read replica, asynchronous replication
// ---------------------------------------------------------------------------------------------
function replicas() {
  const K = kit(10);
  const colX = [118, 288, 458], colW = 160, cx = colX.map((x) => x + 80);
  const azY = 156, azH = 120, icY = 184;
  const xrAz = { x: 740, w: 188 }, xrCx = xrAz.x + 94;
  const mutedC = (x, y, t) => K.text(x, y, t, { anchor: 'middle', size: 8.5, fill: 'var(--awd-muted)' });
  // application wires: staircase lanes above the AZ frames, drops land on each icon from the top
  const wWrite = `M86,142 H${cx[0]} V${icY - 4}`;
  const wReadB = `M86,130 H110 V110 H${cx[1]} V${icY - 4}`;
  const wReadC = `M86,118 H98 V96 H${cx[2]} V${icY - 4}`;
  const wReadX = `M728,130 H${xrCx} V${icY - 4}`;
  // one replication rail under the labels (opaque wires share the stem and the rail), a stub per replica
  const r1 = `M${cx[0]},268 V282 H${cx[1]} V256`;
  const r2 = `M${cx[0]},268 V282 H${cx[2]} V256`;
  const r3 = `M${cx[0]},268 V282 H${xrCx} V268`;
  const extra = [
    mutedC(300, 121, 'reads'),
    mutedC(330, 91, 'reads'),
    mutedC(781, 125, 'reads'),
    K.text(cx[1], 300, 'Asynchronous replication', { cls: 't-wire' }),
    K.text(780, 300, 'Cross-Region replication', { cls: 't-wire' }),
    K.text(742, 93, ['Promote the replica to a standalone', 'DB instance for disaster recovery.'], { anchor: 'start', size: 8.5, fill: 'var(--awd-muted)', lh: 10.5 }),
  ].join('');
  return {
    id: 'db-replicas',
    name: 'Amazon RDS Read Replicas',
    desc: 'A source DB instance replicates asynchronously to two read replicas in other AZs and to a cross-Region read replica, which can serve local reads or be promoted for disaster recovery. Packets show a write, the replication fan-out, then reads from each replica.',
    wide: true, w: 960, h: 336, dur: 10,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 944, h: 320 },
      { kind: 'region', x: 16, y: 34, w: 620, h: 286, label: 'us-east-1' },
      { kind: 'region', x: 652, y: 34, w: 292, h: 286, label: 'eu-west-1' },
      { kind: 'vpc', x: 24, y: 60, w: 604, h: 252 },
      { kind: 'vpc', x: 660, y: 60, w: 276, h: 252 },
      ...colX.map((x, i) => ({ kind: 'az', x, y: azY, w: colW, h: azH, label: 'AZ ' + 'abc'[i] })),
      { kind: 'az', x: xrAz.x, y: azY, w: xrAz.w, h: azH, label: 'AZ a' },
    ],
    nodes: [
      { id: 'app', icon: 'aws-res-ec2-instance', x: 42, y: 110, label: 'Application' },
      { id: 'src', icon: 'aws-res-aurora-rds-instance', x: cx[0] - 20, y: icY, label: 'Source DB instance', sub: 'read/write' },
      { id: 'rep1', icon: 'aws-res-aurora-rds-instance', x: cx[1] - 20, y: icY, label: 'Read replica', sub: 'read-only' },
      { id: 'rep2', icon: 'aws-res-aurora-rds-instance', x: cx[2] - 20, y: icY, label: 'Read replica', sub: 'read-only' },
      { id: 'appx', icon: 'aws-res-ec2-instance', x: 684, y: 110, label: 'Application' },
      { id: 'xr', icon: 'aws-res-aurora-rds-instance', x: xrCx - 20, y: icY, label: 'Cross-Region read replica', sub: 'read-only' },
    ],
    wires: [
      { id: 'w-wr', d: wWrite }, { id: 'w-rb', d: wReadB }, { id: 'w-rc', d: wReadC }, { id: 'w-rx', d: wReadX },
      { id: 'r1', d: r1, dashed: true }, { id: 'r2', d: r2, dashed: true }, { id: 'r3', d: r3, dashed: true },
    ],
    steps: [
      { n: 1, x: 150, y: 131, text: 'The application sends writes to the source DB instance in AZ a, the only read/write instance.' },
      { n: 2, x: 296, y: 297, text: 'The source DB instance replicates changes asynchronously to read replicas in AZ b and AZ c.' },
      { n: 3, x: 710, y: 297, text: 'The source DB instance also replicates asynchronously to a cross-Region read replica in eu-west-1, which can be promoted to a standalone DB instance for disaster recovery.' },
      { n: 4, x: 551, y: 128, text: 'The application sends read-only queries to the read replicas, and an application in eu-west-1 reads from the cross-Region read replica.' },
    ],
    timeline: [
      { wire: 'w-wr', t: [0.03, 0.12], ring: 'src' },
      { wire: 'r1', t: [0.14, 0.30], kind: 'pk-2', ring: 'rep1' },
      { wire: 'r2', t: [0.14, 0.34], kind: 'pk-2', ring: 'rep2' },
      { wire: 'r3', t: [0.14, 0.56], kind: 'pk-2', ring: 'xr' },
      { wire: 'w-rb', t: [0.62, 0.72], ring: 'rep1' },
      { wire: 'w-rc', t: [0.64, 0.75], ring: 'rep2' },
      { wire: 'w-rx', t: [0.72, 0.82], ring: 'xr' },
    ],
    extra,
  };
}

// ---------------------------------------------------------------------------------------------
// db-aurora-global (wide): storage-level replication to a secondary Region, then managed failover
// ---------------------------------------------------------------------------------------------
function auroraGlobal() {
  const K = kit(11);
  const mutedS = (x, y, lines, anchor = 'start') => K.text(x, y, lines, { anchor, size: 8.5, fill: 'var(--awd-muted)', lh: 10.5 });
  const icY = 154, ly = 206;                       // instance icon top, label baseline
  const barY = 232, barH = 46, cs = 22;
  const bar = (x, w) => `<rect x="${x}" y="${barY}" width="${w}" height="${barH}" rx="6" style="fill:color-mix(in srgb,#C925D1 16%,var(--awd-panel));stroke:#C925D1;stroke-width:1.4"/>`;
  const copies = (x, w) => Array.from({ length: 6 }, (_, k) => [x + w / 2 - 120 + 48 * k, barY + barH / 2]);
  const A = { x: 170, w: 320 }, B = { x: 602, w: 320 };
  const cA = copies(A.x, A.w), cB = copies(B.x, B.w);
  const wRA = 'M538,72 V88 H390 V150';
  const wRB = 'M554,72 V88 H840 V150';
  const note = (a, b, lines, fill) => K.win(a, b, K.patch(86, 62, 250, 24) + K.text(90, 70, lines, { anchor: 'start', size: 8.5, fill, lh: 10.5 }));
  const extra = [
    K.text(572, 48, ['Amazon', 'Route 53'], { anchor: 'start' }),
    // narration under the Users wire: base text, replaced during the outage
    mutedS(90, 70, ['Writes go to the primary Region; the secondary', 'Region replicates from storage and serves reads.']),
    note(0.50, 0.995, ['Primary Region outage: the secondary cluster is', 'promoted and Route 53 sends writes to eu-west-1.'], 'var(--awd-pk)'),
    // cluster volumes with six copies each
    bar(A.x, A.w), bar(B.x, B.w),
    ...cA.map(([x, y]) => dbIco(x - cs / 2, y - cs / 2, cs)), ...cB.map(([x, y]) => dbIco(x - cs / 2, y - cs / 2, cs)),
    K.text(A.x + A.w / 2, 298, 'Cluster volume: 6 copies across 3 AZs', { anchor: 'middle', size: 8.5, fill: 'var(--awd-muted)' }),
    K.text(B.x + B.w / 2, 298, 'Cluster volume: 6 copies across 3 AZs', { anchor: 'middle', size: 8.5, fill: 'var(--awd-muted)' }),
    // replication lag annotation around the storage-level wire
    K.text(546, 229, ['Storage-level', 'replication'], { cls: 't-wire', lh: 10.5 }),
    K.text(546, 277, ['typical lag', 'under 1 s'], { cls: 't-wire', lh: 10.5 }),
    // the secondary reader becomes the writer: cover and replace its label
    K.win(0.64, 0.995, K.patch(782, 196, 116, 14) + K.text(840, ly, 'Writer (promoted)', { fill: 'var(--awd-pk)' })),
    // replicated changes land on the six copies of the secondary volume (staggered pulses)
    ...cB.map(([x, y], k) => K.pulse(x, y, 13, 0.38 + 0.006 * k, 'pk-2')),
  ].join('');
  return {
    id: 'db-aurora-global',
    name: 'Amazon Aurora Global Database',
    desc: 'The primary Region cluster replicates at the storage layer to a secondary Region, typically with under one second of lag, and a managed failover or switchover promotes the secondary. Packets show replication, then a Region outage, the promotion and Route 53 redirecting writes.',
    wide: true, w: 960, h: 340, dur: 11,
    groups: [
      { kind: 'cloud', x: 76, y: 8, w: 876, h: 324 },
      { kind: 'gen', x: 148, y: 100, w: 796, h: 222, label: 'Aurora global database' },
      { kind: 'region', id: 'reg-a', x: 158, y: 126, w: 344, h: 188, label: 'us-east-1 (primary)' },
      { kind: 'region', x: 590, y: 126, w: 344, h: 188, label: 'eu-west-1 (secondary)' },
    ],
    nodes: [
      { id: 'users', icon: 'aws-res-users', x: 12, y: 30, label: 'Users' },
      { id: 'r53', icon: 'aws-svc-route-53', x: 526, y: 30 },
      { id: 'rA', icon: 'aws-res-aurora-instance-alternate', x: 230, y: icY, label: 'Reader DB instance', wrap: 20 },
      { id: 'wA', icon: 'aws-res-aurora-instance-alternate', x: 370, y: icY, label: 'Writer DB instance', wrap: 20 },
      { id: 'rB1', icon: 'aws-res-aurora-instance-alternate', x: 660, y: icY, label: 'Reader DB instance', wrap: 20 },
      { id: 'rB2', icon: 'aws-res-aurora-instance-alternate', x: 820, y: icY, label: 'Reader DB instance', wrap: 20 },
    ],
    wires: [
      { id: 'w-u', d: 'M56,50 H522' },
      { id: 'w-ra', d: wRA },
      { id: 'w-rb', d: wRB, dashed: true },
      { id: 'w-wa', d: 'M390,216 V229' },
      { id: 'w-ra1', d: 'M250,229 V216', dashed: true },
      { id: 'w-rb1', d: 'M680,229 V216', dashed: true },
      { id: 'w-rb2', d: 'M840,229 V216', dashed: true },
      { id: 'w-rep', d: 'M494,255 H598' },
    ],
    steps: [
      { n: 1, x: 220, y: 39, text: 'Users reach the database through Amazon Route 53, which sends writes to the writer DB instance in the primary Region, us-east-1.' },
      { n: 2, x: 546, y: 255, text: 'The writer commits to the primary cluster volume, and Aurora replicates it at the storage layer to eu-west-1, typically with under one second of lag.' },
      { n: 3, x: 700, y: 77, text: 'When us-east-1 fails, a global database failover promotes the secondary cluster in eu-west-1, and Route 53 sends writes to its new writer DB instance.' },
    ],
    timeline: [
      { wire: 'w-u', t: [0.03, 0.09] },
      { wire: 'w-ra', t: [0.10, 0.18], ring: 'wA' },
      { wire: 'w-wa', t: [0.19, 0.24], kind: 'pk-2' },
      { wire: 'w-rep', t: [0.26, 0.38], kind: 'pk-2' },
      { wire: 'w-ra', t: [0.52, 0.60], kind: 'pk-bad' },
      { wire: 'w-u', t: [0.68, 0.73] },
      { wire: 'w-rb', t: [0.74, 0.84], ring: 'rB2' },
    ],
    effects: [
      { fail: 'reg-a', t: [0.50, 0.97] },
      { fade: 'w-ra', t: [0.52, 0.97] },
      { fade: 'w-rep', t: [0.52, 0.97] },
      { glow: 'w-rb', t: [0.66, 0.97] },
    ],
    extra,
  };
}

// ---------------------------------------------------------------------------------------------
// db-dms (wide): on premises -> DMS replication instance -> Aurora, full load then CDC; SCT optional
// ---------------------------------------------------------------------------------------------
function dms() {
  const K = kit(11);
  const mutedC = (x, y, t) => K.text(x, y, t, { anchor: 'middle', size: 8.5, fill: 'var(--awd-muted)' });
  const phase = (a, b, t) => K.win(a, b, K.patch(481, 162, 140, 14, TINT_PRIV) + K.text(551, 172, t, { anchor: 'middle', size: 8.5, fill: 'var(--awd-pk)' }));
  const extra = [
    mutedC(551, 172, 'Full load, then CDC'),
    phase(0.26, 0.53, 'Full load'),
    phase(0.53, 0.995, 'Ongoing replication (CDC)'),
    K.text(300, 163, ['Direct Connect', 'or VPN'], { cls: 't-wire', lh: 10 }),
    mutedC(133, 176, 'reads schema'),
    mutedC(500, 85, 'applies the converted schema'),
  ].join('');
  return {
    id: 'db-dms',
    name: 'AWS Database Migration Service',
    desc: 'AWS DMS copies an on-premises database into Amazon Aurora over Direct Connect or VPN, first as a full load and then as ongoing change data capture, with the optional AWS Schema Conversion Tool preparing the target schema. Packets show schema conversion, the bulk load, then change replication.',
    wide: true, w: 960, h: 288, dur: 11,
    groups: [
      { kind: 'dc', x: 8, y: 20, w: 252, h: 252 },
      { kind: 'cloud', x: 340, y: 8, w: 612, h: 272 },
      { kind: 'region', x: 348, y: 34, w: 596, h: 238, label: 'Region' },
      { kind: 'vpc', x: 356, y: 60, w: 580, h: 204 },
      { kind: 'az', x: 366, y: 108, w: 392, h: 148, label: 'Availability Zone a' },
      { kind: 'az', x: 766, y: 108, w: 162, h: 148, label: 'Availability Zone b' },
      { kind: 'priv', x: 374, y: 130, w: 376, h: 118 },
      { kind: 'priv', x: 774, y: 130, w: 146, h: 118 },
    ],
    nodes: [
      { id: 'sct', icon: 'aws-res-client', x: 36, y: 162, label: 'AWS Schema Conversion Tool', wrap: 16, sub: '(optional)' },
      { id: 'src', icon: 'aws-res-database', x: 190, y: 162, label: 'Source database', sub: 'Oracle, SQL Server' },
      { id: 'dms', icon: 'aws-svc-database-migration-service', x: 430, y: 162, label: 'AWS DMS replication instance', wrap: 20 },
      { id: 'tgt', icon: 'aws-res-aurora-instance-alternate', x: 630, y: 162, label: 'Aurora writer DB instance' },
      { id: 'rd', icon: 'aws-res-aurora-instance-alternate', x: 827, y: 162, label: 'Aurora reader DB instance' },
    ],
    wires: [
      { id: 'w-sct-src', d: 'M80,182 H186', dashed: true },
      { id: 'w-sct-tgt', d: 'M56,158 V90 H650 V158', dashed: true },
      { id: 'w-link', d: 'M234,182 H426' },
      { id: 'w-dms', d: 'M476,182 H626' },
    ],
    steps: [
      { n: 1, x: 133, y: 193, text: 'The optional AWS Schema Conversion Tool reads the source schema, converts it and applies the converted schema to the Aurora target.' },
      { n: 2, x: 398, y: 171, text: 'The AWS DMS replication instance connects to the source database over AWS Direct Connect or a VPN and reads its data.' },
      { n: 3, x: 551, y: 193, text: 'AWS DMS loads the existing data into the Aurora writer DB instance as a full load, then keeps applying ongoing changes with change data capture (CDC).' },
    ],
    timeline: [
      { wire: 'w-sct-src', t: [0.03, 0.08], kind: 'pk-2', ring: 'src' },
      { wire: 'w-sct-tgt', t: [0.09, 0.24], kind: 'pk-2', ring: 'tgt' },
      ...[0, 1, 2, 3].map((i) => ({ wire: 'w-link', t: [0.27 + 0.03 * i, 0.37 + 0.03 * i] })),
      ...[0, 1, 2, 3].map((i) => ({ wire: 'w-dms', t: [0.36 + 0.03 * i, 0.44 + 0.03 * i], ...(i === 3 ? { ring: 'tgt' } : {}) })),
      { wire: 'w-link', t: [0.57, 0.65], kind: 'pk-2' },
      { wire: 'w-dms', t: [0.66, 0.74], kind: 'pk-2', ring: 'tgt' },
      { wire: 'w-link', t: [0.77, 0.85], kind: 'pk-2' },
      { wire: 'w-dms', t: [0.86, 0.94], kind: 'pk-2', ring: 'tgt' },
    ],
    extra,
  };
}

export default {
  section: { id: 'databases', title: 'DATABASES' },
  diagrams: [multiAz(), cluster(), aurora(), serverless(), proxy(), cache(), ddbGlobal(), replicas(), auroraGlobal(), dms()],
};
