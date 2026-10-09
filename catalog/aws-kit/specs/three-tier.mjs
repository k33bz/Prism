// Three-tier web family for the AWS Architecture gallery (k33bz fork): tt-* diagrams.
//   node catalog/aws-kit/awd.mjs preview catalog/aws-kit/specs/three-tier.mjs [light]
//   node catalog/aws-kit/awd.mjs build   catalog/aws-kit/specs/three-tier.mjs
//
// Layout: in the wide diagrams the Availability Zones are drawn as rows so the request path reads
// left to right (edge services -> web tier -> app tier -> data tier). Coordinates come from small
// helpers so every node sits on an explicit grid; nodes are placed by their CENTER with N().

// ---- icon ids ----
const IC = {
  users: 'aws-res-users', internet: 'aws-res-internet',
  r53: 'aws-svc-route-53', cf: 'aws-svc-cloudfront', waf: 'aws-svc-waf',
  igw: 'aws-res-vpc-internet-gateway', nat: 'aws-res-vpc-nat-gateway',
  alb: 'aws-res-elastic-load-balancing-application-load-balancer',
  ec2: 'aws-res-ec2-instance',
  rds: 'aws-res-aurora-rds-instance', rdsAlt: 'aws-res-aurora-rds-instance-aternate',
  cache: 'aws-svc-elasticache', cw: 'aws-res-cloudwatch-alarm', as: 'aws-svc-ec2-auto-scaling',
  fargate: 'aws-svc-fargate', ecr: 'aws-svc-elastic-container-registry', ecs: 'aws-svc-elastic-container-service',
  auroraW: 'aws-res-aurora-instance', auroraR: 'aws-res-aurora-instance-alternate', aurora: 'aws-svc-aurora',
  vpce: 'aws-res-vpc-endpoints', s3: 'aws-svc-simple-storage-service',
};

// node by center point
const N = (id, icon, cx, cy, label, o = {}) => {
  const s = o.size || 40;
  return { id, icon, x: cx - s / 2, y: cy - s / 2, label, ...o };
};
// tier heading in spaced capitals (a note)
const TIER = (x, y, text) => ({ x, y, text, caps: true });
// evenly spaced windows over [start,end]; null entries are pauses
const seq = (start, end, items, pad = 0.004) => {
  const slot = (end - start) / items.length;
  return items.map((it, i) => it && ({ ...it, t: [+(start + i * slot + pad).toFixed(4), +(start + (i + 1) * slot - pad).toFixed(4)] })).filter(Boolean);
};
// =====================================================================================
// shared geometry of the two wide diagrams (tt-classic, tt-az-fail): one grid, two AZ rows
// =====================================================================================
const wide = (() => {
  const ROW_A = 158, ROW_B = 314, MID = 236;           // icon centers of AZ a / AZ b rows and of the edge row
  const AZX = 408, AZW = 496;                           // AZ frames
  const COL = { pub: 476, app: 618, db: 831 };          // icon centers per tier
  const sub = (y) => [
    { kind: 'pub', x: 424, y, w: 104, h: 102, label: 'Public subnet' },
    { kind: 'priv', x: 546, y, w: 144, h: 102, label: 'Private subnet' },
    { kind: 'priv', x: 714, y, w: 174, h: 102, label: 'Private subnet' },
  ];
  const groups = () => [
    { kind: 'cloud', x: 84, y: 8, w: 868, h: 410 },
    { kind: 'region', x: 292, y: 30, w: 644, h: 374, label: 'Region' },
    { kind: 'vpc', x: 308, y: 52, w: 612, h: 338, label: 'VPC 10.0.0.0/16' },
    // AZ headers on the left, clear of the Auto Scaling group header
    { kind: 'az', id: 'aza', x: AZX, y: 74, w: AZW, h: 146, label: 'Availability Zone a', align: 'left' },
    { kind: 'az', id: 'azb', x: AZX, y: 230, w: AZW, h: 146, label: 'Availability Zone b', align: 'left' },
    ...sub(106), ...sub(262),
    // one Auto Scaling group across both AZs: it spans the app subnet of each
    { kind: 'asg', x: 538, y: 80, w: 160, h: 290 },
  ];
  const nodes = () => [
    N('users', IC.users, 34, MID, 'Users'),
    // Route 53 answers the DNS lookup only; the HTTPS request goes straight to CloudFront
    N('r53', IC.r53, 140, 150, 'Amazon Route 53', { wrap: 16 }),
    N('cf', IC.cf, 226, MID, 'Amazon CloudFront'),
    N('waf', IC.waf, 226, 150, 'AWS WAF', { size: 32 }),
    N('igw', IC.igw, 340, MID, 'Internet gateway'),
    N('albA', IC.alb, COL.pub, ROW_A, 'Application Load Balancer'),
    N('ec2A', IC.ec2, COL.app, ROW_A, 'Amazon EC2 instance', { wrap: 20 }),
    N('rdsA', IC.rds, COL.db, ROW_A, 'Amazon RDS primary'),
    N('albB', IC.alb, COL.pub, ROW_B, 'Application Load Balancer'),
    N('ec2B', IC.ec2, COL.app, ROW_B, 'Amazon EC2 instance', { wrap: 20 }),
    N('rdsB', IC.rdsAlt, COL.db, ROW_B, 'Amazon RDS standby'),
  ];
  const wires = () => [
    { id: 'dns', d: 'M34,214 V150 H116', dashed: true, both: true },
    { id: 'w1', from: 'users', to: 'cf', label: 'HTTPS', labelDy: 14 },
    { id: 'wf', d: 'M226,186 V212', dashed: true, arrow: false },
    { id: 'w3', from: 'cf', to: 'igw' },
    { id: 'w4a', from: 'igw', to: 'albA', via: 384 },
    { id: 'w4b', from: 'igw', to: 'albB', via: 384 },
    { id: 'w5a', from: 'albA', to: 'ec2A' },
    { id: 'w5b', from: 'albB', to: 'ec2B' },
    { id: 'w6a', from: 'ec2A', to: 'rdsA' },
    // AZ b instances use the primary DB endpoint (the Multi-AZ standby is not readable): cross-AZ,
    // between the Auto Scaling group and the database subnets
    { id: 'w6b', d: `M${COL.app + 22},${ROW_B} H706 V${ROW_A} H${COL.db - 24}` },
    { id: 'wr', from: 'rdsA', to: 'rdsB', flow: true },
  ];
  const tiers = () => [TIER(COL.pub, 66, 'Web tier'), TIER(COL.app, 66, 'Application tier'), TIER(COL.db, 66, 'Database tier')];
  // packet key in the top-left corner of the AWS Cloud frame
  const legend = (...items) => ({ x: 100.6, y: 49, items });
  return { ROW_A, ROW_B, MID, COL, AZX, AZW, groups, nodes, wires, tiers, legend };
})();

// =====================================================================================
// tt-classic: the reference three-tier web architecture across two AZs
// =====================================================================================
const classic = (() => {
  const { groups, nodes, wires, tiers, legend } = wide;
  return {
    id: 'tt-classic',
    name: 'Classic three-tier web application',
    desc: 'Users resolve the domain in Amazon Route 53, then send requests to Amazon CloudFront with AWS WAF, which fronts an internet-facing Application Load Balancer, an Auto Scaling group of EC2 instances across two Availability Zones and an Amazon RDS Multi-AZ database. The DNS lookup comes first, then a request follows the numbered path and the response returns; the RDS primary replicates synchronously to the standby.',
    wide: true, w: 960, h: 426, dur: 10,
    groups: groups(),
    nodes: nodes(),
    wires: wires().map((w) => (w.id === 'wr' ? { ...w, label: 'Synchronous replication', labelDx: -15, labelDy: -4, labelAnchor: 'end' } : w)),
    steps: [
      { n: 1, at: 'dns', f: 0.3, dx: 13, dy: 0, text: 'Users look up the application domain name in Amazon Route 53, which answers with an alias record for the Amazon CloudFront distribution.' },
      { n: 2, at: 'w1', text: 'Users send HTTPS requests to the Amazon CloudFront distribution, where AWS WAF inspects them.' },
      { n: 3, at: 'w3', f: 0.3, text: 'Amazon CloudFront forwards the request through the internet gateway to the Application Load Balancer.' },
      { n: 4, at: 'w5a', f: 0.12, text: 'The Application Load Balancer routes the request to a healthy Amazon EC2 instance in the Auto Scaling group.' },
      { n: 5, at: 'w6a', f: 0.8, text: 'The EC2 instance reads and writes data on the Amazon RDS primary DB instance.' },
      { x: wide.COL.db, y: 241, n: 6, text: 'Amazon RDS replicates each write synchronously to the standby in Availability Zone b, and the response returns to users.' },
    ],
    timeline: seq(0.03, 0.96, [
      // DNS lookup, then the HTTPS request goes straight to CloudFront
      { wire: 'dns', ring: 'r53' }, { wire: 'dns', reverse: true, kind: 'pk-2', ring: 'users' },
      { wire: 'w1', ring: 'cf' }, { wire: 'w3', ring: 'igw' },
      { wire: 'w4a', ring: 'albA' }, { wire: 'w5a', ring: 'ec2A' }, { wire: 'w6a', ring: 'rdsA' },
      { wire: 'wr', kind: 'pk-2', ring: 'rdsB' },
      null,
      { wire: 'w6a', reverse: true, kind: 'pk-2', ring: 'ec2A' }, { wire: 'w5a', reverse: true, kind: 'pk-2', ring: 'albA' },
      { wire: 'w4a', reverse: true, kind: 'pk-2', ring: 'igw' }, { wire: 'w3', reverse: true, kind: 'pk-2', ring: 'cf' },
      { wire: 'w1', reverse: true, kind: 'pk-2', ring: 'users' },
    ]),
    notes: tiers(),
    legend: legend({ kind: 'pk' }, { kind: 'pk-2', label: 'Response or replication' }),
  };
})();

// =====================================================================================
// tt-az-fail: Availability Zone failure and recovery (same architecture, same grid)
// =====================================================================================
const azFail = (() => {
  const { ROW_B, COL, groups, nodes, wires, tiers, legend } = wide;
  const DUR = 10;
  const wn = `M${COL.app + 22},${ROW_B} H${COL.db - 24}`;     // after failover the DB endpoint points at the standby
  // failure story windows (fractions of the clock)
  const F = { fail: 0.3, route: 0.38, shift: 0.45, db: 0.62, end: 0.97 };
  return {
    id: 'tt-az-fail',
    name: 'Availability Zone failure and failover',
    desc: 'Traffic first spreads across both AZs. When Availability Zone a fails, the load balancer stops routing to it, all requests shift to the instances in AZ b, and Amazon RDS fails over so the standby in AZ b becomes the primary.',
    wide: true, w: 960, h: 426, dur: DUR,
    groups: groups(),
    nodes: nodes(),
    // the standby is the failover target: a dashed path from the AZ b instances, lit by effects.glow at promotion
    wires: [...wires(), { id: 'w6n', d: wn, dashed: true }],
    steps: [
      { x: 866, y: 85, n: 1, text: 'Availability Zone a becomes unavailable, and the request in flight to it fails.' },
      { x: 440, y: 147, n: 2, text: 'The Application Load Balancer marks the targets in Availability Zone a unhealthy and stops routing requests to that zone.' },
      { x: 440, y: 303, n: 3, text: 'The Application Load Balancer sends all requests to the EC2 instances in Availability Zone b.' },
      { x: 770, y: ROW_B - 14, n: 4, text: 'Amazon RDS fails over: the standby in Availability Zone b becomes the primary, and the DB endpoint now resolves to it.' },
    ],
    timeline: [
      // normal operation: both AZs serve traffic
      { wire: 'w3', t: [0.03, 0.08], ring: 'igw' },
      { wire: 'w4a', t: [0.09, 0.14], ring: 'albA' }, { wire: 'w4b', t: [0.09, 0.14], ring: 'albB' },
      { wire: 'w5a', t: [0.15, 0.20], ring: 'ec2A' }, { wire: 'w5b', t: [0.15, 0.20], ring: 'ec2B' },
      { wire: 'w6a', t: [0.21, 0.27], ring: 'rdsA' }, { wire: 'w6b', t: [0.21, 0.27] },
      // AZ a goes down: the last request sent there fails
      { wire: 'w4a', t: [0.31, 0.36], kind: 'pk-bad' },
      // all traffic now lands in AZ b
      { wire: 'w3', t: [0.46, 0.50], ring: 'igw' },
      { wire: 'w4b', t: [0.51, 0.55], ring: 'albB' },
      { wire: 'w5b', t: [0.56, 0.60], ring: 'ec2B' },
      // RDS promotes the standby; the instance now talks to it directly
      { t: [0.62, 0.66], ring: 'rdsB', kind: 'pk-2' },
      { wire: 'w6n', t: [0.67, 0.72], ring: 'rdsB' },
      { wire: 'w6n', t: [0.74, 0.79], reverse: true, kind: 'pk-2', ring: 'ec2B' },
      { wire: 'w5b', t: [0.80, 0.84], reverse: true, kind: 'pk-2', ring: 'albB' },
      { wire: 'w4b', t: [0.85, 0.89], reverse: true, kind: 'pk-2', ring: 'igw' },
      { wire: 'w3', t: [0.90, 0.94], reverse: true, kind: 'pk-2', ring: 'cf' },
    ],
    effects: [
      { fail: 'aza', t: [F.fail, F.end] },
      { fade: 'w4a', t: [F.route, F.end] }, { fade: 'w5a', t: [F.route, F.end] },
      { fade: 'w6a', t: [F.route, F.end] }, { fade: 'wr', t: [F.route, F.end] },
      { glow: 'w4b', t: [F.shift, F.end] }, { glow: 'w5b', t: [F.shift, F.end] },
      { fade: 'w6b', t: [F.db, F.end] },
      { glow: 'w6n', t: [F.db, F.end] },
    ],
    notes: [
      ...tiers(),
      { x: 850, y: 88, text: 'AZ a unavailable', anchor: 'end', kind: 'warn', t: [F.fail, F.end] },
      { x: 762, y: ROW_B + 14, text: 'standby promoted', tone: 'response', weight: 'bold', t: [F.db, F.end] },
    ],
    legend: legend({ kind: 'pk' }, { kind: 'pk-2' }, { kind: 'pk-bad', label: 'Failed request' }),
  };
})();

// =====================================================================================
// tt-cache: cache-aside with Amazon ElastiCache between the app tier and Amazon RDS
// =====================================================================================
const cache = (() => {
  const DUR = 10;
  const CY = { cache: 98, mid: 142, rds: 186 };                    // icon centers (rows)
  const X = { users: 26, pub: 142, app: 262, data: 384 };          // icon centers (columns)
  const tl = seq(0.03, 0.96, [
    { wire: 'w1', ring: 'alb' }, { wire: 'w2', ring: 'ec2' },
    { wire: 'w3', ring: 'cache' },                                                    // GET
    { tag: 'hit', wire: 'w3', reverse: true, kind: 'pk-2', ring: 'ec2' },             // hit
    { wire: 'w2', reverse: true, kind: 'pk-2', ring: 'alb' }, { wire: 'w1', reverse: true, kind: 'pk-2', ring: 'users' },
    null,
    { wire: 'w1', ring: 'alb' }, { wire: 'w2', ring: 'ec2' },
    { wire: 'w3', ring: 'cache' },                                                    // GET
    { tag: 'miss', wire: 'w3', reverse: true, kind: 'pk-bad', ring: 'ec2' },          // miss
    { wire: 'w4', ring: 'rds' },                                                      // read RDS
    { wire: 'w4', reverse: true, kind: 'pk-2', ring: 'ec2' },
    { tag: 'set', wire: 'w3', ring: 'cache' },                                        // populate
    { wire: 'w2', reverse: true, kind: 'pk-2', ring: 'alb' }, { wire: 'w1', reverse: true, kind: 'pk-2', ring: 'users' },
  ]);
  const win = (tag, more = 0) => { const t = tl.find((e) => e.tag === tag).t; return [t[0], +(t[1] + more).toFixed(4)]; };
  const hit = win('hit', 0.06), miss = win('miss', 0.12), set = win('set');
  const cap = (t, text, tone) => ({ x: X.data, y: CY.cache + 56, text, tone, weight: 'bold', t });
  return {
    id: 'tt-cache',
    name: 'Three-tier web with a cache (cache-aside)',
    desc: 'Amazon ElastiCache sits between the app tier and Amazon RDS. The first request is a cache hit and is answered from the cache; the second misses, so the instance reads RDS, populates the cache and returns the result.',
    w: 480, h: 270, dur: DUR,
    groups: [
      { kind: 'cloud', x: 56, y: 8, w: 416, h: 254 },
      { kind: 'vpc', x: 72, y: 30, w: 384, h: 218, label: 'VPC' },
      { kind: 'pub', x: 88, y: 52, w: 108, h: 174, label: 'Public subnet' },
      { kind: 'priv', x: 208, y: 52, w: 108, h: 174, label: 'Private subnet' },
      { kind: 'priv', x: 328, y: 52, w: 112, h: 174, label: 'Private subnet' },
    ],
    nodes: [
      N('users', IC.users, X.users, CY.mid, 'Users'),
      N('alb', IC.alb, X.pub, CY.mid, 'Application Load Balancer'),
      N('ec2', IC.ec2, X.app, CY.mid, 'Amazon EC2 instance'),
      N('cache', IC.cache, X.data, CY.cache, 'Amazon ElastiCache'),
      N('rds', IC.rds, X.data, CY.rds, 'Amazon RDS'),
    ],
    wires: [
      { id: 'w1', from: 'users', to: 'alb' },
      { id: 'w2', from: 'alb', to: 'ec2' },
      { id: 'w3', from: 'ec2', to: 'cache', via: 322, both: true },
      { id: 'w4', from: 'ec2', to: 'rds', via: 322, both: true },
    ],
    steps: [
      { n: 1, at: 'w1', f: 0.76, text: 'Users send requests to the Application Load Balancer in the public subnet.' },
      { n: 2, at: 'w2', f: 0.22, text: 'The Application Load Balancer forwards each request to the Amazon EC2 instance in the private subnet.' },
      { n: 3, at: 'w3', f: 0.84, text: 'The EC2 instance checks Amazon ElastiCache first. On a cache hit, it returns the cached result to users.' },
      { n: 4, at: 'w4', f: 0.84, text: 'The EC2 instance reads Amazon RDS on a cache miss, writes the result to ElastiCache and returns it to users.' },
    ],
    timeline: tl,
    notes: [
      TIER(X.pub, 240, 'Web tier'), TIER(X.app, 240, 'App tier'), TIER(X.data, 240, 'Data tier'),
      cap(hit, 'cache hit', 'response'), cap(miss, 'cache miss', 'bad'), cap(set, 'populate cache', 'request'),
    ],
  };
})();

// =====================================================================================
// tt-scale: Auto Scaling scale-out triggered by a CloudWatch alarm
// =====================================================================================
const scale = (() => {
  const DUR = 10;
  const IX = 268, IY = [114, 154, 194, 234];                      // instance column: icon centers
  const T_NEW = 0.51, T_REG = 0.58, T_END = 0.995;                // new instances appear / get registered / end of window
  return {
    id: 'tt-scale',
    name: 'Auto Scaling scale-out',
    desc: 'The instances publish CPU to Amazon CloudWatch. When the alarm fires, Amazon EC2 Auto Scaling launches two more instances; once they are registered, the load balancer starts sending them traffic along with the original two.',
    w: 480, h: 300, dur: DUR,
    groups: [
      { kind: 'cloud', x: 56, y: 8, w: 416, h: 284 },
      { kind: 'vpc', x: 70, y: 30, w: 284, h: 248, label: 'VPC' },
      { kind: 'pub', x: 86, y: 52, w: 100, h: 212, label: 'Public subnet' },
      { kind: 'priv', x: 198, y: 52, w: 140, h: 212, label: 'Private subnet' },
      { kind: 'asg', x: 206, y: 74, w: 124, h: 182 },
    ],
    nodes: [
      N('users', IC.users, 26, 174, 'Users'),
      N('alb', IC.alb, 136, 174, 'Application Load Balancer'),
      N('i1', IC.ec2, IX, IY[0], '', { size: 32 }), N('i2', IC.ec2, IX, IY[1], '', { size: 32 }),
      N('i3', IC.ec2, IX, IY[2], '', { size: 32 }), N('i4', IC.ec2, IX, IY[3], '', { size: 32 }),
      N('cw', IC.cw, 413, 114, 'Amazon CloudWatch alarm', { wrap: 18, sub: 'high CPU' }),
      N('as', IC.as, 413, 224, 'Amazon EC2 Auto Scaling', { sub: 'scale-out policy' }),
    ],
    wires: [
      { id: 'w1', from: 'users', to: 'alb' },
      { id: 'a1', from: 'alb', to: 'i1', via: 192 }, { id: 'a2', from: 'alb', to: 'i2', via: 192 },
      { id: 'a3', from: 'alb', to: 'i3', via: 192 }, { id: 'a4', from: 'alb', to: 'i4', via: 192 },
      { id: 'w3', from: 'i1', to: 'cw', dashed: true },
      { id: 'w4', d: 'M413,174 V200' },
      { id: 'w5', d: 'M391,224 H332', dashed: true },
    ],
    steps: [
      { n: 1, at: 'w3', f: 0.835, text: 'Amazon EC2 sends CPU utilization for the instances to Amazon CloudWatch, and the high CPU alarm goes into the ALARM state.' },
      { n: 2, at: 'w4', f: 0.5, dx: 13, dy: 0, text: 'The CloudWatch alarm triggers the scale-out policy in Amazon EC2 Auto Scaling.' },
      { n: 3, at: 'w5', f: 0.3, text: 'Amazon EC2 Auto Scaling launches two new instances into the Auto Scaling group.' },
      { n: 4, at: 'a3', f: 0.9, text: 'Amazon EC2 Auto Scaling registers the new instances with the load balancer, which sends traffic to all four once they pass health checks.' },
    ],
    timeline: [
      // steady load on the two original instances
      { wire: 'w1', t: [0.03, 0.075], ring: 'alb' }, { wire: 'a1', t: [0.08, 0.125], ring: 'i1' }, { wire: 'a2', t: [0.08, 0.125], ring: 'i2' },
      { wire: 'w1', t: [0.14, 0.185], ring: 'alb' }, { wire: 'a1', t: [0.19, 0.235], ring: 'i1' }, { wire: 'a2', t: [0.19, 0.235], ring: 'i2' },
      // CPU metric reaches CloudWatch, the alarm fires and triggers the scale-out policy
      { wire: 'w3', t: [0.27, 0.34], kind: 'pk-2', ring: 'cw' },
      { wire: 'w4', t: [0.37, 0.43], ring: 'as' },
      // Auto Scaling launches two instances into the group
      { wire: 'w5', t: [0.45, 0.51] },
      { t: [0.50, 0.52], ring: 'i3' }, { t: [0.50, 0.52], ring: 'i4' },
      // registered with the ALB: traffic now reaches all four
      { wire: 'w1', t: [0.60, 0.645], ring: 'alb' },
      { wire: 'a1', t: [0.65, 0.70], ring: 'i1' }, { wire: 'a2', t: [0.65, 0.70], ring: 'i2' },
      { wire: 'a3', t: [0.65, 0.70], ring: 'i3' }, { wire: 'a4', t: [0.65, 0.70], ring: 'i4' },
      { wire: 'w1', t: [0.76, 0.805], ring: 'alb' },
      { wire: 'a1', t: [0.81, 0.855], ring: 'i1' }, { wire: 'a2', t: [0.81, 0.855], ring: 'i2' },
      { wire: 'a3', t: [0.81, 0.855], ring: 'i3' }, { wire: 'a4', t: [0.81, 0.855], ring: 'i4' },
      { wire: 'w1', t: [0.90, 0.935], ring: 'alb' },
      { wire: 'a3', t: [0.94, 0.985], ring: 'i3' }, { wire: 'a4', t: [0.94, 0.985], ring: 'i4' },
    ],
    effects: [
      { appear: 'i3', t: [T_NEW, T_END], ghost: true }, { appear: 'i4', t: [T_NEW, T_END], ghost: true },
      { fade: 'a3', t: [0.001, T_REG] }, { fade: 'a4', t: [0.001, T_REG] },
      { glow: 'a3', t: [T_REG, T_END] }, { glow: 'a4', t: [T_REG, T_END] },
    ],
    // the scaled-out instances are tagged while they run, and in still frames
    notes: [IY[2], IY[3]].map((y) => ({ x: 291, y: y + 3, text: 'new', anchor: 'start', tone: 'response', weight: 'bold', t: [T_NEW, T_END], still: true })),
  };
})();

// =====================================================================================
// tt-nat: outbound internet access from private subnets through a NAT gateway per AZ
// =====================================================================================
const nat = (() => {
  const DUR = 10;
  const ROW = { a: 114, b: 230 }, MID = 172;
  const subnets = (y) => [
    { kind: 'priv', x: 56, y, w: 116, h: 80, label: 'Private subnet' },
    { kind: 'pub', x: 182, y, w: 106, h: 80, label: 'Public subnet' },
  ];
  return {
    id: 'tt-nat',
    name: 'Outbound internet access with NAT gateways',
    desc: 'Instances in the private subnets have no public address, so each AZ routes 0.0.0.0/0 to the NAT gateway in its own public subnet, which sends the traffic out through the internet gateway and returns the replies. Packets leave through AZ a first, then through AZ b.',
    w: 480, h: 300, dur: DUR,
    groups: [
      { kind: 'cloud', x: 8, y: 6, w: 416, h: 286 },
      { kind: 'vpc', x: 24, y: 28, w: 364, h: 256, label: 'VPC' },
      { kind: 'az', x: 40, y: 50, w: 264, h: 110, label: 'Availability Zone a' },
      { kind: 'az', x: 40, y: 166, w: 264, h: 110, label: 'Availability Zone b' },
      ...subnets(72), ...subnets(188),
    ],
    nodes: [
      N('ecA', IC.ec2, 114, ROW.a, 'Amazon EC2 instance', { size: 32, wrap: 20 }),
      N('natA', IC.nat, 235, ROW.a, 'NAT gateway', { size: 32 }),
      N('ecB', IC.ec2, 114, ROW.b, 'Amazon EC2 instance', { size: 32, wrap: 20 }),
      N('natB', IC.nat, 235, ROW.b, 'NAT gateway', { size: 32 }),
      N('igw', IC.igw, 360, MID, 'Internet gateway'),
      N('net', IC.internet, 456, MID, 'Internet'),
    ],
    wires: [
      { id: 'e1a', from: 'ecA', to: 'natA' }, { id: 'e1b', from: 'ecB', to: 'natB' },
      { id: 'n2a', from: 'natA', to: 'igw', via: 314 }, { id: 'n2b', from: 'natB', to: 'igw', via: 314 },
      { id: 'n3', from: 'igw', to: 'net' },
    ],
    steps: [
      { n: 1, at: 'e1a', f: 0.24, text: 'Amazon EC2 instances in each private subnet send internet-bound traffic through the 0.0.0.0/0 route to the NAT gateway in the same Availability Zone.' },
      { n: 2, at: 'n2a', f: 0.12, text: 'The NAT gateway replaces the source address with its own and sends the traffic to the internet gateway.' },
      { n: 3, at: 'n3', f: 0.48, text: 'The internet gateway sends the traffic to the internet, and replies return through the same NAT gateway to the instance.' },
    ],
    timeline: seq(0.03, 0.97, [
      { wire: 'e1a', ring: 'natA' }, { wire: 'n2a', ring: 'igw' }, { wire: 'n3', ring: 'net' },
      { wire: 'n3', reverse: true, kind: 'pk-2', ring: 'igw' }, { wire: 'n2a', reverse: true, kind: 'pk-2', ring: 'natA' },
      { wire: 'e1a', reverse: true, kind: 'pk-2', ring: 'ecA' },
      null,
      { wire: 'e1b', ring: 'natB' }, { wire: 'n2b', ring: 'igw' }, { wire: 'n3', ring: 'net' },
      { wire: 'n3', reverse: true, kind: 'pk-2', ring: 'igw' }, { wire: 'n2b', reverse: true, kind: 'pk-2', ring: 'natB' },
      { wire: 'e1b', reverse: true, kind: 'pk-2', ring: 'ecB' },
    ]),
  };
})();

// =====================================================================================
// tt-ecs: containerized three-tier on Amazon ECS with AWS Fargate, Amazon Aurora and Amazon ECR.
// The tasks run in a private subnet with no internet route, so the image pull goes through VPC
// endpoints: the ecr.api and ecr.dkr interface endpoints for the manifest, the S3 gateway endpoint
// for the layers. The Aurora writer and reader run in subnets in two Availability Zones.
// =====================================================================================
const ecs = (() => {
  const DUR = 10;
  const CY = 256, EP = 174;                                  // request row; endpoint row
  const SVC = { x: 276, y: 216, w: 150, h: 84 };             // ECS service frame
  const DB = { x: 712, w: 188, h: 72, a: 154, b: 232 };      // Aurora subnets: AZ a above, AZ b below
  const FORK = 688;                                          // the request wire splits to writer and reader
  return {
    id: 'tt-ecs',
    name: 'Containerized three-tier on Amazon ECS and AWS Fargate',
    desc: 'An Application Load Balancer forwards requests to an Amazon ECS service whose AWS Fargate tasks run in a private subnet with no internet route: they pull their image from Amazon ECR through interface endpoints and the image layers from Amazon S3 through a gateway endpoint. The Amazon Aurora writer and reader run in two Availability Zones. The image pull animates first, then one request writes to the writer and a second reads from the reader.',
    wide: true, w: 960, h: 332, dur: DUR,
    groups: [
      { kind: 'cloud', x: 84, y: 8, w: 860, h: 316 },
      { kind: 'vpc', x: 100, y: 106, w: 828, h: 210, label: 'VPC' },
      { kind: 'pub', x: 116, y: 128, w: 128, h: 180, label: 'Public subnet' },
      { kind: 'priv', x: 260, y: 128, w: 300, h: 180, label: 'Private subnet' },
      { kind: 'gen', ...SVC, icon: IC.ecs, label: 'ECS service' },
      { kind: 'gen', x: 700, y: 128, w: 212, h: 180, icon: IC.aurora, label: 'Aurora cluster' },
      { kind: 'priv', x: DB.x, y: DB.a, w: DB.w, h: DB.h, label: 'Private subnet', note: 'Availability Zone a' },
      { kind: 'priv', x: DB.x, y: DB.b, w: DB.w, h: DB.h, label: 'Private subnet', note: 'Availability Zone b' },
    ],
    nodes: [
      N('users', IC.users, 40, CY, 'Users'),
      N('alb', IC.alb, 180, CY, 'Application Load Balancer'),
      N('t1', IC.fargate, 322, CY, '', { size: 32 }), N('t2', IC.fargate, 380, CY, '', { size: 32 }),
      N('iep', IC.vpce, 460, EP, 'Interface endpoints', { size: 32, labelPos: 'r', wrap: 10, sub: 'ecr.api, ecr.dkr' }),
      N('gep', IC.vpce, 598, EP, 'S3 gateway endpoint', { size: 32, labelPos: 'r', wrap: 10 }),
      N('ecr', IC.ecr, 460, 52, 'Amazon ECR'),
      N('s3', IC.s3, 598, 52, 'Amazon S3', { sub: 'image layers' }),
      N('wr', IC.auroraW, 760, DB.a + 44, 'Aurora writer', { size: 32, labelPos: 'r' }),
      N('rd', IC.auroraR, 760, DB.b + 44, 'Aurora reader', { size: 32, labelPos: 'r' }),
    ],
    wires: [
      { id: 'w1', d: `M62,${CY} H156` },
      { id: 'w2', d: `M202,${CY} H${SVC.x - 1}` },
      // writes go to the writer, reads to the reader
      { id: 'w3a', d: `M${SVC.x + SVC.w + 1},${CY} H${FORK} V${DB.a + 44} H740` },
      { id: 'w3b', d: `M${SVC.x + SVC.w + 1},${CY} H${FORK} V${DB.b + 44} H740` },
      // image pull when a task starts: the manifest from Amazon ECR through the interface endpoints,
      // the layers from Amazon S3 through the gateway endpoint
      { id: 'p1', d: `M404,${SVC.y - 1} V${EP} H440`, dashed: true, both: true },
      { id: 'p2', d: `M460,${EP - 20} V89`, dashed: true, both: true },
      { id: 'p3', d: `M${SVC.x + SVC.w + 1},226 H598 V${EP + 20}`, dashed: true, both: true },
      { id: 'p4', d: `M598,${EP - 20} V100`, dashed: true, both: true },
    ],
    steps: [
      { n: 1, at: 'p1', f: 0.3, dx: -13, dy: 0, text: 'When a task starts, AWS Fargate pulls the image without an internet route: the manifest from Amazon ECR through the ecr.api and ecr.dkr interface endpoints, and the layers from Amazon S3 through the S3 gateway endpoint.' },
      { n: 1, at: 'p3', f: 0.5 },
      { n: 2, at: 'w1', f: 0.76, text: 'Users send requests to the Application Load Balancer in the public subnet.' },
      { n: 3, at: 'w2', f: 0.4, text: 'The Application Load Balancer forwards each request to an AWS Fargate task in the Amazon ECS service.' },
      { n: 4, at: 'w3a', f: 0.3, text: 'The Fargate task sends writes to the Aurora writer in Availability Zone a and reads to the Aurora reader in Availability Zone b.' },
    ],
    timeline: seq(0.03, 0.97, [
      // task start: the image manifest, then the layers, arrive at the task
      { wire: 'p2', reverse: true, kind: 'pk-2', ring: 'iep' }, { wire: 'p1', reverse: true, kind: 'pk-2', ring: 't2' },
      { wire: 'p4', reverse: true, kind: 'pk-2', ring: 'gep' }, { wire: 'p3', reverse: true, kind: 'pk-2', ring: 't2' },
      null,
      // a write
      { wire: 'w1', ring: 'alb' }, { wire: 'w2', ring: 't1' }, { wire: 'w3a', ring: 'wr' },
      { wire: 'w3a', reverse: true, kind: 'pk-2', ring: 't1' }, { wire: 'w2', reverse: true, kind: 'pk-2', ring: 'alb' },
      { wire: 'w1', reverse: true, kind: 'pk-2', ring: 'users' },
      null,
      // a read
      { wire: 'w1', ring: 'alb' }, { wire: 'w2', ring: 't2' }, { wire: 'w3b', ring: 'rd' },
      { wire: 'w3b', reverse: true, kind: 'pk-2', ring: 't2' }, { wire: 'w2', reverse: true, kind: 'pk-2', ring: 'alb' },
      { wire: 'w1', reverse: true, kind: 'pk-2', ring: 'users' },
    ]),
    notes: [{ x: SVC.x + SVC.w / 2, y: CY + 28, text: 'AWS Fargate tasks', kind: 'label' }],
  };
})();

// =====================================================================================
// tt-bluegreen: blue/green deployment with weighted ALB target groups
// =====================================================================================
const blueGreen = (() => {
  const DUR = 10;
  const S1 = [0.001, 0.33], S2 = [0.34, 0.65], S3 = [0.66, 0.995];   // weight stages: 100/0, 50/50, 0/100
  const Y = { blue: 74, green: 164 }, FH = 82;                        // ASG frames (blue above green)
  const wt = (stage, y, text) => ({ x: 426, y, text, anchor: 'end', weight: 'bold', t: stage });
  const frame = (y) => ({ kind: 'asg', x: 216, y, w: 228, h: FH });
  const cy = (y) => y + FH / 2;                                       // wire entry height of a frame
  const ALB_Y = (cy(Y.blue) + cy(Y.green)) / 2;
  return {
    id: 'tt-bluegreen',
    name: 'Blue/green deployment with weighted target groups',
    desc: 'The Application Load Balancer forwards to two target groups, each backed by its own Auto Scaling group. The traffic weights move from blue 100% / green 0% to 50% / 50% and finally 0% / 100%, after which the blue path drains.',
    w: 480, h: 290, dur: DUR,
    groups: [
      { kind: 'cloud', x: 50, y: 8, w: 428, h: 274 },
      { kind: 'vpc', x: 60, y: 30, w: 410, h: 238, label: 'VPC' },
      { kind: 'pub', x: 76, y: 52, w: 108, h: 202, label: 'Public subnet' },
      { kind: 'priv', x: 208, y: 52, w: 244, h: 202, label: 'Private subnet' },
      { id: 'blue', ...frame(Y.blue), label: 'Auto Scaling group (blue, v1)' },
      { id: 'green', ...frame(Y.green), label: 'Auto Scaling group (green, v2)' },
    ],
    nodes: [
      N('users', IC.users, 24, ALB_Y, 'Users'),
      N('alb', IC.alb, 130, ALB_Y, 'Application Load Balancer', { sub: 'weighted routing' }),
      N('b1', IC.ec2, 290, Y.blue + 42, 'Amazon EC2', { size: 32 }), N('b2', IC.ec2, 370, Y.blue + 42, 'Amazon EC2', { size: 32 }),
      N('g1', IC.ec2, 290, Y.green + 42, 'Amazon EC2', { size: 32 }), N('g2', IC.ec2, 370, Y.green + 42, 'Amazon EC2', { size: 32 }),
    ],
    wires: [
      { id: 'w1', d: `M46,${ALB_Y} H106` },
      { id: 'wb', d: `M152,${ALB_Y} H196 V${cy(Y.blue)} H215` },
      { id: 'wg', d: `M152,${ALB_Y} H196 V${cy(Y.green)} H215` },
    ],
    steps: [
      { n: 1, at: 'w1', f: 0.8, text: 'Users send requests to the Application Load Balancer, which forwards them to two weighted target groups.' },
      { x: 196, y: (ALB_Y + cy(Y.blue)) / 2, n: 2, text: 'The Application Load Balancer sends the blue target group (v1) its weighted share of requests: 100%, then 50%, then 0%.' },
      { x: 196, y: (ALB_Y + cy(Y.green)) / 2, n: 3, text: 'The Application Load Balancer shifts requests to the green target group (v2) as its weight rises to 50% and then 100%.' },
    ],
    timeline: [
      { wire: 'w1', t: [0.03, 0.07], ring: 'alb' }, { wire: 'wb', t: [0.08, 0.13], ring: 'b1' },
      { wire: 'w1', t: [0.15, 0.19] }, { wire: 'wb', t: [0.20, 0.25], ring: 'b2' },
      { wire: 'w1', t: [0.37, 0.41] }, { wire: 'wb', t: [0.42, 0.47], ring: 'b1' },
      { wire: 'w1', t: [0.49, 0.53] }, { wire: 'wg', t: [0.54, 0.59], ring: 'g1' },
      { wire: 'w1', t: [0.69, 0.73] }, { wire: 'wg', t: [0.74, 0.79], ring: 'g1' },
      { wire: 'w1', t: [0.82, 0.86] }, { wire: 'wg', t: [0.87, 0.92], ring: 'g2' },
    ],
    effects: [{ fade: 'wg', t: S1 }, { fade: 'wb', t: S3 }],
    notes: [
      wt(S1, Y.blue + 14, '100%'), wt(S2, Y.blue + 14, '50%'), wt(S3, Y.blue + 14, '0%'),
      wt(S1, Y.green + 14, '0%'), wt(S2, Y.green + 14, '50%'), wt(S3, Y.green + 14, '100%'),
    ],
    // extra: the blue and green environment dots beside the live weights; no primitive draws a dot
    // in a color of its own (legend and marks use the packet and status colors)
    extra: `<circle cx="434" cy="${Y.blue + 11}" r="4" fill="#4A90E2"/><circle cx="434" cy="${Y.green + 11}" r="4" fill="#3FB950"/>`,
  };
})();

export default {
  section: { id: 'three-tier', title: 'WEB APPLICATIONS' },
  diagrams: [classic, cache, scale, azFail, ecs, nat, blueGreen],
};
