// Databases family for the AWS Architecture kit. Build: node catalog/aws-kit/awd.mjs build catalog/aws-kit/specs/databases.mjs
// Endpoints are pill nodes, cluster volumes are database-toned frames with their copies as nodes,
// caption swaps are a standing note with an off window plus a timed note, and arrival pulses on the
// copies are timeline rings. `extra` keeps only the min/max range bracket in db-serverless.
import { box } from '../place.mjs';

// an endpoint (a DNS name, not a service) as a pill node placed by center
const pill = (id, cx, cy, w, h, label, o = {}) => box(id, cx, cy, w, h, label, { kind: 'pill', ...o });
// the official generic Database icon as one copy of the data on a cluster volume, placed by center
const copy = (id, cx, cy, s) => ({ id, icon: 'aws-res-database', x: cx - s / 2, y: cy - s / 2, size: s });
// a cluster volume: a solid database-toned frame (its copies are ordinary nodes inside it)
const volume = (x, y, w, h, label = '') => ({ kind: 'gen', x, y, w, h, label, tone: 'database', fill: true, dashed: false });

// ---------------------------------------------------------------------------------------------
// db-multiaz: Amazon RDS Multi-AZ (instance deployment) with failover
// ---------------------------------------------------------------------------------------------
function multiAz() {
  // geometry
  const azA = { x: 196, y: 84, w: 252, h: 78 }, azB = { x: 196, y: 188, w: 252, h: 78 };
  const subA = { x: 204, y: 106, w: 236, h: 50 }, subB = { x: 204, y: 210, w: 236, h: 50 };
  const ix = 326; // db icon x (right part of the subnet, clear of the subnet label)
  const pA = { x: ix, y: subA.y + 5 }, pB = { x: ix, y: subB.y + 5 };
  const cx = ix + 20, cyA = pA.y + 20, cyB = pB.y + 20;
  const ep = { cx: 145, cy: 183, w: 74, h: 30 };
  const wPrim = `M${ep.cx},${ep.cy - 15} V${cyA} H${ix - 4}`;
  const wStby = `M${ep.cx},${ep.cy + 15} V${cyB} H${ix - 4}`;
  const wSync = `M${cx},${pA.y + 42} V${pB.y - 4}`;
  // the standby's side label, one note per line so it matches the primary's node label; it swaps
  // to "Primary (promoted)" while AZ a is down
  const side = (y, text, o) => ({ x: ix + 46, y, text, kind: 'label', anchor: 'start', ...o });
  const fail = [0.66, 0.97];

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
      pill('ep', ep.cx, ep.cy, ep.w, ep.h, 'DB instance endpoint', { wrap: 12 }),
      { id: 'primary', icon: 'aws-res-aurora-rds-instance', x: pA.x, y: pA.y, label: 'Primary DB instance', labelPos: 'r', wrap: 10 },
      { id: 'standby', icon: 'aws-res-aurora-rds-instance', x: pB.x, y: pB.y },
    ],
    wires: [
      { id: 'w-app', from: 'app', to: 'ep' },
      { id: 'w-prim', d: wPrim },
      { id: 'w-stby', d: wStby, dashed: true },
      { id: 'w-sync', d: wSync, label: 'Synchronous replication', labelAnchor: 'end', labelDx: -8, labelDy: -3.5 },
    ],
    steps: [
      { n: 1, at: 'w-app', f: 0.5, text: 'The application connects to the DB instance endpoint, a DNS name whose CNAME points to the primary DB instance.' },
      { n: 2, x: 157, y: 150, text: 'The connection reaches the primary DB instance in Availability Zone a, which serves all reads and writes.' },
      { n: 3, x: 357, y: 175, text: 'The primary replicates each write synchronously to the standby DB instance in Availability Zone b, which serves no traffic while the primary is healthy.' },
      { n: 4, x: 157, y: 216, text: 'If Availability Zone a fails, RDS promotes the standby to primary and points the endpoint CNAME to it, typically within 60 to 120 seconds. The application reconnects through the same endpoint.' },
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
    notes: [
      side(cyB - 2, 'Standby DB', { off: fail }), side(cyB + 9, 'instance', { off: fail }),
      side(cyB - 2, 'Primary', { tone: 'request', t: fail }), side(cyB + 9, '(promoted)', { tone: 'request', t: fail }),
      // narration (left zone), swapped during the outage
      { x: 34, y: 98, text: 'The endpoint CNAME points to\nthe primary. Every write is\nreplicated synchronously.', anchor: 'start', size: 8.5, off: fail },
      { x: 34, y: 98, text: 'AZ a fails: RDS promotes the\nstandby and flips the endpoint\nCNAME (typically 60 to 120 s).', anchor: 'start', size: 8.5, tone: 'request', t: fail },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// db-cluster: RDS Multi-AZ DB cluster (one writer, two readable standbys, three AZs)
// ---------------------------------------------------------------------------------------------
function cluster() {
  const colX = [100, 219, 338], colW = 112, cx = colX.map((x) => x + 56);
  const azY = 128, azH = 134, icY = 156, lblY = icY + 52;
  const cP = { x: 160, y: 106, w: 96, h: 28 };      // cluster endpoint pill (center)
  const rP = { x: 334.5, y: 80, w: 180, h: 28 };    // reader endpoint pill (spans the two reader columns)
  const wAppR = `M86,106 H96 V${rP.y} H${rP.x - rP.w / 2 - 4}`;
  const wCW = `M${cx[0]},${cP.y + cP.h / 2} V${icY - 4}`;
  const wRb = `M${cx[1]},${rP.y + rP.h / 2} V${icY - 4}`;
  const wRc = `M${cx[2]},${rP.y + rP.h / 2} V${icY - 4}`;
  // one replication rail under the labels; wires are opaque, so both readers share the stem and the rail
  const yr = 228, up = lblY + 9;
  const rb = `M${cx[0]},${up} V${yr} H${cx[1]} V${up}`;
  const rc = `M${cx[0]},${up} V${yr} H${cx[2]} V${up}`;

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
      pill('cep', cP.x, cP.y, cP.w, cP.h, 'Cluster endpoint', { sub: 'read/write', wrap: 20 }),
      pill('rep', rP.x, rP.y, rP.w, rP.h, 'Reader endpoint', { sub: 'read-only, load balanced' }),
      { id: 'writer', icon: 'aws-res-aurora-rds-instance', x: cx[0] - 20, y: icY, label: 'Writer DB instance', wrap: 20 },
      { id: 'rd1', icon: 'aws-res-aurora-rds-instance', x: cx[1] - 20, y: icY, label: 'Reader DB instance', wrap: 20 },
      { id: 'rd2', icon: 'aws-res-aurora-rds-instance', x: cx[2] - 20, y: icY, label: 'Reader DB instance', wrap: 20 },
    ],
    wires: [
      { id: 'w-appc', from: 'app', to: 'cep' }, { id: 'w-appr', d: wAppR },
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
    notes: [
      { x: cx[1], y: yr + 14, text: 'Semisynchronous\nreplication', size: 8.5 },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// db-aurora: Aurora cluster in a VPC, writer + readers over one shared cluster volume (six copies, two per AZ)
// ---------------------------------------------------------------------------------------------
function aurora() {
  const colX = [100, 219, 338], colW = 112, cx = colX.map((x) => x + 56);
  const azY = 124, azH = 144, icY = 148, lblY = icY + 52;
  const barY = 226, barH = 36, cs = 24;
  const cP = { x: 160, y: 102, w: 96, h: 26 };
  const rP = { x: 334.5, y: 78, w: 180, h: 26 };
  const wAppR = `M86,${cP.y} H96 V${rP.y} H${rP.x - rP.w / 2 - 4}`;
  const wCW = `M${cx[0]},${cP.y + cP.h / 2} V${icY - 4}`;
  const wRb = `M${cx[1]},${rP.y + rP.h / 2} V${icY - 4}`;
  const wRc = `M${cx[2]},${rP.y + rP.h / 2} V${icY - 4}`;
  const wWrite = `M${cx[0]},${lblY + 8} V${barY - 4}`;
  const wRead1 = `M${cx[1]},${barY - 2} V${lblY + 8}`;
  const wRead2 = `M${cx[2]},${barY - 2} V${lblY + 8}`;
  const copyCy = barY + barH / 2;
  // the six copies, two per AZ column
  const copies = [0, 1, 2].flatMap((i) => [copy(`copy${2 * i}`, cx[i] - 15, copyCy, cs), copy(`copy${2 * i + 1}`, cx[i] + 15, copyCy, cs)]);

  return {
    id: 'db-aurora',
    name: 'Amazon Aurora DB Cluster',
    desc: 'A writer and two readers in three Availability Zones of a VPC share one cluster volume that keeps six copies of the data, two per AZ. Packets show a write fanning out to all six copies, then reads served from the same volume.',
    w: 480, h: 300, dur: 8,
    // the volume frame has no header (no label, no icon), so its copies sit centered in it
    lintAllow: ['header-band:node copy'],
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 464, h: 284 },
      { kind: 'region', x: 16, y: 34, w: 448, h: 250, label: 'Region' },
      { kind: 'vpc', x: 24, y: 60, w: 432, h: 216 },
      { kind: 'az', x: colX[0], y: azY, w: colW, h: azH, label: 'AZ a' },
      { kind: 'az', x: colX[1], y: azY, w: colW, h: azH, label: 'AZ b' },
      { kind: 'az', x: colX[2], y: azY, w: colW, h: azH, label: 'AZ c' },
      // the cluster volume crosses the three AZ columns
      volume(colX[0] + 4, barY, colX[2] + colW - 4 - (colX[0] + 4), barH),
    ],
    nodes: [
      { id: 'app', icon: 'aws-res-ec2-instance', x: 42, y: cP.y - 20, label: 'Application' },
      pill('cep', cP.x, cP.y, cP.w, cP.h, 'Cluster endpoint', { sub: 'writer', wrap: 20 }),
      pill('rep', rP.x, rP.y, rP.w, rP.h, 'Reader endpoint', { sub: 'load balances the readers' }),
      { id: 'writer', icon: 'aws-res-aurora-instance-alternate', x: cx[0] - 20, y: icY, label: 'Writer DB instance', wrap: 20 },
      { id: 'rd1', icon: 'aws-res-aurora-instance-alternate', x: cx[1] - 20, y: icY, label: 'Reader DB instance', wrap: 20 },
      { id: 'rd2', icon: 'aws-res-aurora-instance-alternate', x: cx[2] - 20, y: icY, label: 'Reader DB instance', wrap: 20 },
      ...copies,
    ],
    wires: [
      { id: 'w-appc', from: 'app', to: 'cep' }, { id: 'w-appr', d: wAppR },
      { id: 'w-cw', d: wCW }, { id: 'w-rb', d: wRb }, { id: 'w-rc', d: wRc },
      { id: 'w-write', d: wWrite },
      { id: 'w-read1', d: wRead1, dashed: true }, { id: 'w-read2', d: wRead2, dashed: true },
    ],
    steps: [
      { n: 1, x: 100, y: 113, text: 'The application sends writes to the cluster endpoint, which always connects to the writer DB instance.' },
      { n: 2, x: 168, y: 214, text: 'The writer DB instance writes to the shared Aurora cluster volume, which keeps six copies of the data, two in each of three AZs.' },
      { n: 3, x: 226, y: 90, text: 'The application reads through the reader endpoint, which load balances across the reader DB instances. They read from the same cluster volume.' },
    ],
    timeline: [
      { wire: 'w-appc', t: [0.04, 0.10] },
      { wire: 'w-cw', t: [0.11, 0.19], ring: 'writer' },
      { wire: 'w-write', t: [0.21, 0.29], kind: 'pk-2' },
      // the write fans out to all six copies, staggered by AZ
      ...copies.map((c, k) => { const t = 0.30 + 0.015 * Math.floor(k / 2); return { ring: c.id, t: [t - 0.01, t], kind: 'pk-2' }; }),
      { wire: 'w-appr', t: [0.44, 0.51] },
      { wire: 'w-rb', t: [0.52, 0.59], ring: 'rd1' },
      { wire: 'w-rc', t: [0.52, 0.60], ring: 'rd2' },
      { wire: 'w-read1', t: [0.63, 0.71], kind: 'pk-2', ring: 'rd1' },
      { wire: 'w-read2', t: [0.63, 0.72], kind: 'pk-2', ring: 'rd2' },
    ],
    notes: [
      { x: 96, y: barY + 14, text: 'Aurora cluster\nvolume', kind: 'label', anchor: 'end', size: 9.5, weight: 'bold' },
      { x: 96, y: barY + 34, text: '6 copies, 3 AZs', anchor: 'end', size: 8.5 },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// db-serverless: an application tier in a VPC querying an Aurora Serverless v2 writer whose capacity
// (ACUs) follows the load, using the kit's appear effect
// ---------------------------------------------------------------------------------------------
function serverless() {
  const ts = 22, n = 7, tileX = (k) => 240 + 28 * k, tileY = 129;
  const x0 = tileX(0), x1 = tileX(n - 1) + ts, ctr = (x0 + x1) / 2; // tile row and its centre
  const tiles = Array.from({ length: n }, (_, k) => ({ id: 't' + k, icon: 'aws-svc-aurora', x: tileX(k), y: tileY, size: ts }));
  // tile k (2..6) is shown while capacity is at least k+1 tiles: nested windows, rising then falling
  const appear = [[0.12, 0.90], [0.19, 0.83], [0.26, 0.76], [0.33, 0.69], [0.40, 0.62]].map((t, i) => ({ appear: 't' + (i + 2), t, ghost: true }));
  // request load: sparse, ramping, dense at the peak, then easing off; each request crosses the
  // application (first half of its window) to the writer (second half)
  const load = [[0.03, 0.10], [0.15, 0.22], [0.21, 0.28], [0.26, 0.33], [0.30, 0.37], [0.34, 0.41], [0.38, 0.45], [0.41, 0.48],
    [0.44, 0.51], [0.47, 0.54], [0.50, 0.57], [0.53, 0.60], [0.62, 0.69], [0.68, 0.75], [0.74, 0.81], [0.82, 0.89]];
  const ringAt = new Set([0, 4, 8, 12, 15]);
  const mid = (a, b) => Math.round((a + b) * 500) / 1000;
  // load narration: the standing caption gives way to the live phases for the whole cycle
  const phase = (a, b, text) => ({ x: ctr, y: 190, text, size: 8.5, tone: 'request', t: [a, b] });
  const volY = 216, gY = 84, gH = volY + 24 + 10 - gY;

  return {
    id: 'db-serverless',
    name: 'Amazon Aurora Serverless v2 Scaling',
    desc: 'Users reach an application in a VPC that queries an Aurora Serverless v2 writer, which scales its capacity in ACUs in place, between a configured minimum and maximum, while storage stays on the shared cluster volume. Capacity tiles appear as the load rises and drop away as it falls.',
    w: 480, h: gY + gH + 32, dur: 9,
    groups: [
      { kind: 'cloud', x: 60, y: 8, w: 412, h: gY + gH + 16 },
      { kind: 'region', x: 68, y: 34, w: 396, h: gY + gH - 18, label: 'Region' },
      { kind: 'vpc', x: 76, y: 60, w: 380, h: gY + gH - 52 },
      { kind: 'gen', x: 160, y: gY, w: 288, h: gH, label: 'Aurora DB cluster' },
      // shared cluster volume under the writer (storage is separate from compute)
      volume(172, volY, 264, 24, 'Cluster volume: shared storage that grows automatically'),
    ],
    nodes: [
      { id: 'users', icon: 'aws-res-users', x: 8, y: 120, label: 'Users' },
      { id: 'app', icon: 'aws-res-ec2-instance', x: 92, y: 120, label: 'Application' },
      { id: 'writer', icon: 'aws-res-aurora-instance-alternate', x: 176, y: 120, label: 'Writer DB instance', wrap: 10, sub: 'db.serverless' },
      ...tiles,
    ],
    wires: [
      { id: 'w-in', from: 'users', to: 'app' },
      { id: 'w-app', from: 'app', to: 'writer' },
      { id: 'w-vol', d: `M196,200 V${volY - 3}` },
    ],
    steps: [
      { n: 1, at: 'w-app', f: 0.3, text: 'Users send requests to the application on Amazon EC2 in the VPC, which sends its queries to the Aurora Serverless v2 writer DB instance.' },
      { n: 2, x: 228, y: 140, text: 'As the load rises and falls, Aurora Serverless v2 scales the writer\'s capacity in place, in 0.5 ACU steps, between the minimum and maximum ACUs.' },
      { n: 3, x: 210, y: 206, text: 'The writer DB instance reads and writes the shared cluster volume. Storage is separate from compute and grows automatically.' },
    ],
    timeline: [
      ...load.flatMap((t, i) => [
        { wire: 'w-in', t: [t[0], mid(t[0], t[1])] },
        { wire: 'w-app', t: [mid(t[0], t[1]), t[1]], ...(ringAt.has(i) ? { ring: 'writer' } : {}) },
      ]),
      { wire: 'w-vol', t: [0.30, 0.36], kind: 'pk-2' },
      { wire: 'w-vol', t: [0.50, 0.56], kind: 'pk-2' },
      { wire: 'w-vol', t: [0.70, 0.76], kind: 'pk-2' },
    ],
    effects: appear,
    notes: [
      { x: ctr, y: 122, text: 'Capacity in ACUs, adjusted in 0.5 ACU steps', size: 8.5 },
      { x: x0, y: 170, text: 'min', anchor: 'start', size: 8.5 },
      { x: x1, y: 170, text: 'max', anchor: 'end', size: 8.5 },
      { x: ctr, y: 190, text: 'Capacity follows the load, between min and max', size: 8.5, off: [0.005, 0.995] },
      phase(0.005, 0.12, 'Low load: minimum capacity'),
      phase(0.12, 0.40, 'Load rising: capacity scales up in place'),
      phase(0.40, 0.62, 'Peak load: capacity at its maximum'),
      phase(0.62, 0.90, 'Load falling: capacity scales back down'),
      phase(0.90, 0.995, 'Low load: minimum capacity'),
    ],
    // the min/max range bracket under the capacity tiles: a dimension line, not a connection, so it is
    // not a wire, and the kit has no bracket primitive
    extra: `<path class="w" d="M${x0},${tileY + 24} V${tileY + 29} H${x1} V${tileY + 24}" style="stroke-width:1"/>`,
  };
}

// ---------------------------------------------------------------------------------------------
// db-proxy: RDS Proxy pooling connections from a Lambda fleet
// ---------------------------------------------------------------------------------------------
function proxy() {
  const lx = 56, ls = 26, lcy = [131, 163, 195, 227], bus = 150, pcy = 179;
  const stub = (i) => `M${lx + ls + 2},${lcy[i]} H${bus} V${pcy}`;   // four stubs share the trunk into the proxy
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
      { id: 'sec', icon: 'aws-svc-secrets-manager', x: 230, y: 42, label: 'AWS Secrets Manager', labelPos: 'r', wrap: 11 },
      // the bottom function carries the label for the whole fleet
      ...L.map((i) => ({ id: 'l' + i, icon: 'aws-svc-lambda', x: lx, y: lcy[i] - ls / 2, size: ls, ...(i === 3 ? { label: 'AWS Lambda functions', wrap: 11 } : {}) })),
      { id: 'proxy', icon: 'aws-res-rds-proxy-instance-alternate', x: 230, y: 159, label: 'Amazon RDS Proxy', sub: 'connection pooling' },
      { id: 'db', icon: 'aws-res-aurora-rds-instance', x: 380, y: 159, label: 'RDS or Aurora DB instance' },
    ],
    wires: [
      { id: 'sec', d: 'M250,84 V155', dashed: true, label: 'credentials', labelAnchor: 'start', labelDx: 8, labelDy: 2.5 },
      ...L.map((i) => ({ id: 's' + i, d: stub(i), arrow: false })),
      { id: 'merge', d: `M${bus},${pcy} H226` },
      { id: 'o1', d: 'M276,173 H376', label: 'Pooled connections', labelDy: -8 },
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
    notes: [
      { x: 142, y: 121, text: 'Many app connections' },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// db-cache: ElastiCache cache-aside in front of RDS (a miss, then a hit)
// ---------------------------------------------------------------------------------------------
function cache() {
  // the cache-aside caption, swapped for the live request narration through the whole cycle
  const say = (text, o) => ({ x: 100, y: 232, text, anchor: 'start', size: 8.5, ...o });
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
      // labels at x 308 on the last run (66 + 46 + 48 of 208 along the path)
      { id: 'a-cache', d: 'M194,148 H260 V102 H356', label: 'GET / SET with TTL', labelAt: 160 / 208, labelDy: 12 },
      { id: 'a-db', d: 'M194,164 H260 V210 H356', label: 'SQL query on a miss', labelAt: 160 / 208, labelDy: -6 },
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
    notes: [
      say('Cache-aside: read the cache first,\nquery RDS only on a miss, then\nfill the cache for the next read.', { off: [0.005, 0.995] }),
      say('Request 1, cache miss: read\nRDS, then fill the cache.', { tone: 'request', t: [0.005, 0.60] }),
      say('Request 2, cache hit: answered\nfrom memory, RDS not touched.', { tone: 'request', t: [0.60, 0.995] }),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// db-ddb-global: DynamoDB global tables, active-active between two Regions
// ---------------------------------------------------------------------------------------------
function ddbGlobal() {
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
      { id: 'repl', d: 'M364,134 V194', both: true, dashed: true, label: 'Asynchronous replication', labelAnchor: 'end', labelDx: -16, labelDy: -2.5 },
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
    notes: [
      { x: 380, y: 161.5, text: 'Last writer wins', anchor: 'start' },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// db-replicas (wide): in-Region read replicas plus a cross-Region read replica, asynchronous replication
// ---------------------------------------------------------------------------------------------
function replicas() {
  const colX = [118, 288, 458], colW = 160, cx = colX.map((x) => x + 80);
  const azY = 156, azH = 120, icY = 184;
  const xrAz = { x: 740, w: 188 }, xrCx = xrAz.x + 94;
  // application wires: staircase lanes above the AZ frames, drops land on each icon from the top
  const wWrite = `M86,142 H${cx[0]} V${icY - 4}`;
  const wReadB = `M86,130 H110 V110 H${cx[1]} V${icY - 4}`;
  const wReadC = `M86,118 H98 V96 H${cx[2]} V${icY - 4}`;
  const wReadX = `M728,130 H${xrCx} V${icY - 4}`;
  // one replication rail under the labels (opaque wires share the stem and the rail), a stub per replica
  const r1 = `M${cx[0]},268 V282 H${cx[1]} V256`;
  const r2 = `M${cx[0]},268 V282 H${cx[2]} V256`;
  const r3 = `M${cx[0]},268 V282 H${xrCx} V268`;
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
      { id: 'w-wr', d: wWrite },
      // "reads" labels at x 300 under the y 110 lane, x 330 over the y 96 lane, x 781 over the y 130 lane
      { id: 'w-rb', d: wReadB, label: 'reads', labelAt: 234 / 372, labelDy: 11 },
      { id: 'w-rc', d: wReadC, label: 'reads', labelAt: 266 / 558 },
      { id: 'w-rx', d: wReadX, label: 'reads', labelAt: 53 / 156 },
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
    notes: [
      { x: cx[1], y: 300, text: 'Asynchronous replication' },
      { x: 780, y: 300, text: 'Cross-Region replication' },
      { x: 742, y: 93, text: 'Promote the replica to a standalone\nDB instance for disaster recovery.', anchor: 'start', size: 8.5 },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// db-aurora-global (wide): storage-level replication to a secondary Region, then managed failover
// ---------------------------------------------------------------------------------------------
function auroraGlobal() {
  const icY = 154, ly = 206;                       // instance icon top, label baseline
  const barY = 232, barH = 46, cs = 22;
  const A = { x: 170, w: 320 }, B = { x: 602, w: 320 };
  // six copies per cluster volume, spread across the volume
  const copies = (p, v) => Array.from({ length: 6 }, (_, k) => copy(`copy-${p}${k}`, v.x + v.w / 2 - 120 + 48 * k, barY + barH / 2, cs));
  const cA = copies('a', A), cB = copies('b', B);
  const wRA = 'M538,72 V88 H390 V150';
  const wRB = 'M554,72 V88 H840 V150';
  const out = [0.50, 0.995];
  const say = (text, o) => ({ x: 90, y: 70, text, anchor: 'start', size: 8.5, ...o });
  const promoted = [0.64, 0.995];
  return {
    id: 'db-aurora-global',
    name: 'Amazon Aurora Global Database',
    desc: 'The primary Region cluster replicates at the storage layer to a secondary Region, typically with under one second of lag, and a managed failover or switchover promotes the secondary. Packets show replication, then a Region outage, the promotion and Route 53 redirecting writes.',
    wide: true, w: 960, h: 340, dur: 11,
    // the volume frames have no header (no label, no icon), so their copies sit centered in them
    lintAllow: ['header-band:node copy'],
    groups: [
      { kind: 'cloud', x: 76, y: 8, w: 876, h: 324 },
      { kind: 'gen', x: 148, y: 100, w: 796, h: 222, label: 'Aurora global database' },
      { kind: 'region', id: 'reg-a', x: 158, y: 126, w: 344, h: 188, label: 'us-east-1 (primary)' },
      { kind: 'region', x: 590, y: 126, w: 344, h: 188, label: 'eu-west-1 (secondary)' },
      // the cluster volume of each Region, six copies each
      volume(A.x, barY, A.w, barH), volume(B.x, barY, B.w, barH),
    ],
    nodes: [
      { id: 'users', icon: 'aws-res-users', x: 12, y: 30, label: 'Users' },
      { id: 'r53', icon: 'aws-svc-route-53', x: 526, y: 30, label: 'Amazon Route 53', labelPos: 'r', wrap: 8 },
      { id: 'rA', icon: 'aws-res-aurora-instance-alternate', x: 230, y: icY, label: 'Reader DB instance', wrap: 20 },
      { id: 'wA', icon: 'aws-res-aurora-instance-alternate', x: 370, y: icY, label: 'Writer DB instance', wrap: 20 },
      { id: 'rB1', icon: 'aws-res-aurora-instance-alternate', x: 660, y: icY, label: 'Reader DB instance', wrap: 20 },
      // its label is a note below: it swaps to "Writer (promoted)" after the failover
      { id: 'rB2', icon: 'aws-res-aurora-instance-alternate', x: 820, y: icY },
      ...cA, ...cB,
    ],
    wires: [
      { id: 'w-u', d: 'M56,50 H522' },
      { id: 'w-ra', d: wRA },
      { id: 'w-rb', d: wRB, dashed: true },
      { id: 'w-wa', d: 'M390,216 V229' },
      { id: 'w-ra1', d: 'M250,229 V216', dashed: true },
      { id: 'w-rb1', d: 'M680,229 V216', dashed: true },
      { id: 'w-rb2', d: 'M840,229 V216', dashed: true },
      { id: 'w-rep', d: 'M494,255 H598', label: 'Storage-level\nreplication', labelDy: -26 },
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
      // replicated changes land on the six copies of the secondary volume (staggered rings)
      ...cB.map((c, k) => { const t = Math.round((0.38 + 0.006 * k) * 1000) / 1000; return { ring: c.id, t: [t - 0.005, t], kind: 'pk-2' }; }),
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
    notes: [
      // narration under the Users wire, replaced during the outage
      say('Writes go to the primary Region; the secondary\nRegion replicates from storage and serves reads.', { off: out }),
      say('Primary Region outage: the secondary cluster is\npromoted and Route 53 sends writes to eu-west-1.', { tone: 'request', t: out }),
      { x: A.x + A.w / 2, y: 298, text: 'Cluster volume: 6 copies across 3 AZs', size: 8.5 },
      { x: B.x + B.w / 2, y: 298, text: 'Cluster volume: 6 copies across 3 AZs', size: 8.5 },
      { x: 546, y: 277, text: 'typical lag\nunder 1 s', size: 8.5 },
      // the secondary reader becomes the writer
      { x: 840, y: ly, text: 'Reader DB instance', kind: 'label', off: promoted },
      { x: 840, y: ly, text: 'Writer (promoted)', kind: 'label', tone: 'request', t: promoted },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// db-dms (wide): on premises -> DMS replication instance -> Aurora, full load then CDC; SCT optional
// ---------------------------------------------------------------------------------------------
function dms() {
  const phase = (text, o) => ({ x: 551, y: 172, text, size: 8.5, ...o });
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
      { id: 'w-sct-src', d: 'M80,182 H186', dashed: true, label: 'reads schema', labelDy: -6 },
      // label at x 500 on the top run (68 + 444 of 730 along the path)
      { id: 'w-sct-tgt', d: 'M56,158 V90 H650 V158', dashed: true, label: 'applies the converted schema', labelAt: 512 / 730 },
      { id: 'w-link', d: 'M234,182 H426', label: 'Direct Connect\nor VPN', labelAt: 66 / 192, labelDy: -19 },
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
    notes: [
      // the migration phase under the DMS wire: the standing caption gives way to the live phase
      phase('Full load, then CDC', { off: [0.26, 0.995] }),
      phase('Full load', { tone: 'request', t: [0.26, 0.53] }),
      phase('Ongoing replication (CDC)', { tone: 'request', t: [0.53, 0.995] }),
    ],
  };
}

export default {
  section: { id: 'databases', title: 'DATABASES' },
  diagrams: [multiAz(), cluster(), aurora(), serverless(), proxy(), cache(), ddbGlobal(), replicas(), auroraGlobal(), dms()],
};
