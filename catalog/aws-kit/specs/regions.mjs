// Multi-Region & resilience family for the AWS Architecture gallery (k33bz fork).
//   node catalog/aws-kit/awd.mjs preview catalog/aws-kit/specs/regions.mjs [light]
//   node catalog/aws-kit/awd.mjs build   catalog/aws-kit/specs/regions.mjs
//
// The four DR strategies from the AWS whitepaper "Disaster Recovery of Workloads on AWS" (backup and
// restore, pilot light, warm standby, multi-site active-active) plus the building blocks they rely on
// (Route 53 failover, Global Accelerator, S3 replication, inter-Region Transit Gateway peering).
// Conventions: nodes are placed by CENTER with N(); step badges ride above wires and short captions sit
// below them (T()); the single clock of each diagram is `dur`; wires never share a segment (translucent
// strokes would double up), so a fork leaves a node as two parallel stubs.

// node by center point (icons 40px; 32px inside dense groups)
const N = (id, icon, cx, cy, label, o = {}) => {
  const s = o.size || 40;
  return { id, icon, x: cx - s / 2, y: cy - s / 2, label, ...o };
};
// small muted caption (same style as wire labels); anchor: 'start' | 'end' | undefined (middle)
const T = (x, y, s, anchor) => `<text class="t-wire" x="${x}" y="${y}"${anchor ? ` style="text-anchor:${anchor}"` : ''}>${s}</text>`;

const ALB = 'aws-res-elastic-load-balancing-application-load-balancer';

// ------------------------------------------------------------------------------------------------
// Wide two-Region geometry shared by pilot light, warm standby and active-active.
//   Users / Route 53 sit left (Route 53 is global: inside the AWS Cloud, outside both Regions).
//   Region A (us-east-1) above Region B (us-west-2); each: ALB -> Auto Scaling group (2 x EC2) -> Aurora/DynamoDB.
// ------------------------------------------------------------------------------------------------
const RA = 34, RB = 226;                       // Region top edges (height 180)
const rowY = (R) => R + 98;                    // ALB / database row center
const ec1Y = (R) => R + 70, ec2Y = (R) => R + 126;   // EC2 slot centers inside the Auto Scaling group
const MID = 228;                               // Route 53 / Users row (midway between the two Regions)

const wideGroups = () => [
  { kind: 'cloud', x: 100, y: 8, w: 852, h: 410 },
  { kind: 'region', id: 'r1', x: 244, y: RA, w: 696, h: 180, label: 'us-east-1' },
  { kind: 'region', id: 'r2', x: 244, y: RB, w: 696, h: 180, label: 'us-west-2' },
  { kind: 'asg', x: 460, y: RA + 26, w: 160, h: 140 },
  { kind: 'asg', x: 460, y: RB + 26, w: 160, h: 140 },
];
// wire paths of the wide diagrams (explicit: parallel stubs instead of shared segments)
const wideP = () => {
  const yA = rowY(RA), yB = rowY(RB), P = {
    u: `M62,${MID} H132`,
    ra: `M178,${MID - 6} H212 V${yA} H306`,
    rb: `M178,${MID + 6} H212 V${yB} H306`,
    rep: `M782,${yA} H822 V${yB} H784`,
  };
  for (const [p, R] of [['a', RA], ['b', RB]]) {
    const y = rowY(R), y1 = ec1Y(R), y2 = ec2Y(R);
    P[`${p}1`] = `M352,${y - 6} H396 V${y1} H520`;       // ALB -> EC2 slot 1 / 2 (parallel stubs, no shared segment)
    P[`${p}2`] = `M352,${y + 6} H396 V${y2} H520`;
    P[`${p}e1`] = `M558,${y1} H690 V${y - 6} H736`;      // EC2 slot 1 / 2 -> database
    P[`${p}e2`] = `M558,${y2} H690 V${y + 6} H736`;
  }
  return P;
};
const regionWires = (P, p, d1, d2) => [
  { id: `${p}1`, d: P[`${p}1`], dashed: d1 }, { id: `${p}2`, d: P[`${p}2`], dashed: d2 },
  { id: `${p}e1`, d: P[`${p}e1`], dashed: d1 }, { id: `${p}e2`, d: P[`${p}e2`], dashed: d2 },
];
const albN = (id, R) => N(id, ALB, 330, rowY(R), 'Application Load Balancer');
const ecN = (id, R, slotNo) => N(id, 'aws-svc-ec2', 540, slotNo === 1 ? ec1Y(R) : ec2Y(R), 'Amazon EC2', { size: 32 });
const dbN = (id, R, icon, label, sub) => N(id, icon, 760, rowY(R), label, { sub });

// ---- the three wide DR diagrams share these captions / badges ----
// text: the five step descriptions, in badge order
const wideSteps = (usersWire, text) => [
  usersWire === 'u' ? { n: 1, at: 'u', f: 0.26, text: text[0] } : { n: 1, at: usersWire, f: 0.39, dy: 0, text: text[0] },   // active-active: on the vertical run
  { n: 2, at: 'ra', f: 0.82, text: text[1] },
  { n: 3, at: 'a1', f: 0.53, text: text[2] },
  { n: 4, at: 'ae1', f: 0.47, text: text[3] },
  { n: 5, x: 822, y: 170, text: text[4] },
];
// steps 1 to 4 of pilot light and warm standby (Route 53 failover routing, primary stack in us-east-1)
const failoverSteps = (step5) => [
  'Users resolve the application with Amazon Route 53, whose failover routing answers with the primary Region, us-east-1, while it is healthy.',
  'Requests reach the Application Load Balancer in us-east-1. If that Region fails, Route 53 fails over to the load balancer in us-west-2.',
  'The load balancer forwards requests to Amazon EC2 instances in the Auto Scaling group.',
  'The EC2 instances read and write the primary Amazon Aurora cluster.',
  step5,
];

const pilot = (() => {
  const P = wideP();
  return {
    id: 'mr-pilot',
    name: 'Pilot light',
    desc: 'The data tier replicates to Amazon Aurora in us-west-2 while the application servers there stay off. The animation fails us-east-1, flips Amazon Route 53 to us-west-2 and scales its Auto Scaling group up from zero.',
    wide: true, w: 960, h: 426, dur: 10,
    groups: wideGroups(),
    nodes: [
      N('users', 'aws-res-users', 40, MID, 'Users'),
      N('r53', 'aws-svc-route-53', 156, MID, 'Amazon Route 53', { wrap: 16, sub: 'failover routing' }),
      albN('albA', RA), ecN('ecA1', RA, 1), ecN('ecA2', RA, 2), dbN('dbA', RA, 'aws-svc-aurora', 'Amazon Aurora', 'primary cluster'),
      albN('albB', RB), ecN('ecB1', RB, 1), ecN('ecB2', RB, 2), dbN('dbB', RB, 'aws-svc-aurora', 'Amazon Aurora', 'secondary cluster'),
    ],
    wires: [
      { id: 'u', d: P.u }, { id: 'ra', d: P.ra }, { id: 'rb', d: P.rb, dashed: true },
      ...regionWires(P, 'a', false, false),
      ...regionWires(P, 'b', true, true),
      { id: 'rep', d: P.rep, flow: true },
    ],
    steps: wideSteps('u', failoverSteps('Aurora replicates asynchronously to the secondary cluster in us-west-2, where no EC2 instances run. On failover it is promoted and the group scales up from zero.')),
    timeline: [
      { wire: 'u', t: [0.03, 0.08] },
      { wire: 'ra', t: [0.09, 0.14], ring: 'albA' },
      { wire: 'a1', t: [0.15, 0.19], ring: 'ecA1' },
      { wire: 'ae1', t: [0.20, 0.25], ring: 'dbA' },
      { wire: 'rep', t: [0.27, 0.37], kind: 'pk-2', ring: 'dbB' },
      { ring: 'dbB', t: [0.50, 0.53], kind: 'pk-2' },          // secondary cluster promoted
      { ring: 'ecB1', t: [0.55, 0.59] },
      { ring: 'ecB2', t: [0.55, 0.59] },
      { wire: 'u', t: [0.62, 0.67] },
      { wire: 'rb', t: [0.68, 0.73], ring: 'albB' },
      { wire: 'b1', t: [0.74, 0.78], ring: 'ecB1' },
      { wire: 'be1', t: [0.79, 0.84], ring: 'dbB' },
    ],
    effects: [
      { fail: 'r1', t: [0.42, 0.98] },
      { fade: 'ra', t: [0.46, 0.98] },
      { fade: 'rep', t: [0.46, 0.98] },
      { glow: 'rb', t: [0.50, 0.98] },
      { appear: 'ecB1', t: [0.54, 0.98], ghost: true },
      { appear: 'ecB2', t: [0.54, 0.98], ghost: true },
      { glow: 'b1', t: [0.54, 0.98] }, { glow: 'b2', t: [0.54, 0.98] },
      { glow: 'be1', t: [0.54, 0.98] }, { glow: 'be2', t: [0.54, 0.98] },
    ],
    extra: [
      T(942, 22, 'RPO / RTO: tens of minutes', 'end'),
      T(275, 143, 'primary'),
      T(275, 335, 'secondary'),
      T(830, 188, 'Asynchronous', 'start'),
      T(830, 198, 'replication', 'start'),
    ].join(''),
  };
})();

const warm = (() => {
  const P = wideP();
  return {
    id: 'mr-warm',
    name: 'Warm standby',
    desc: 'A scaled-down but fully functional stack runs in us-west-2: a load balancer, one instance in the Auto Scaling group and a replicated Aurora cluster. The animation fails us-east-1, flips Amazon Route 53 to us-west-2 and scales the group out.',
    wide: true, w: 960, h: 426, dur: 10,
    groups: wideGroups(),
    nodes: [
      N('users', 'aws-res-users', 40, MID, 'Users'),
      N('r53', 'aws-svc-route-53', 156, MID, 'Amazon Route 53', { wrap: 16, sub: 'failover routing' }),
      albN('albA', RA), ecN('ecA1', RA, 1), ecN('ecA2', RA, 2), dbN('dbA', RA, 'aws-svc-aurora', 'Amazon Aurora', 'primary cluster'),
      albN('albB', RB), ecN('ecB1', RB, 1), ecN('ecB2', RB, 2), dbN('dbB', RB, 'aws-svc-aurora', 'Amazon Aurora', 'secondary cluster'),
    ],
    wires: [
      { id: 'u', d: P.u }, { id: 'ra', d: P.ra }, { id: 'rb', d: P.rb, dashed: true },
      ...regionWires(P, 'a', false, false),
      ...regionWires(P, 'b', false, true),
      { id: 'rep', d: P.rep, flow: true },
    ],
    steps: wideSteps('u', failoverSteps('Aurora replicates asynchronously to the secondary cluster in us-west-2, where a scaled-down stack already runs. On failover it is promoted and the group scales out.')),
    timeline: [
      { wire: 'u', t: [0.03, 0.08] },
      { wire: 'ra', t: [0.09, 0.14], ring: 'albA' },
      { wire: 'a1', t: [0.15, 0.19], ring: 'ecA1' },
      { wire: 'ae1', t: [0.20, 0.25], ring: 'dbA' },
      { wire: 'rep', t: [0.27, 0.37], kind: 'pk-2', ring: 'dbB' },
      { ring: 'dbB', t: [0.50, 0.53], kind: 'pk-2' },          // secondary cluster promoted
      { ring: 'ecB2', t: [0.55, 0.59] },
      { wire: 'u', t: [0.62, 0.67] },
      { wire: 'rb', t: [0.68, 0.73], ring: 'albB' },
      { wire: 'b1', t: [0.74, 0.78], ring: 'ecB1' },
      { wire: 'be1', t: [0.79, 0.84], ring: 'dbB' },
      { wire: 'b2', t: [0.86, 0.90], ring: 'ecB2' },
    ],
    effects: [
      { fail: 'r1', t: [0.42, 0.98] },
      { fade: 'ra', t: [0.46, 0.98] },
      { fade: 'rep', t: [0.46, 0.98] },
      { glow: 'rb', t: [0.50, 0.98] },
      { appear: 'ecB2', t: [0.54, 0.98], ghost: true },
      { glow: 'b2', t: [0.54, 0.98] }, { glow: 'be2', t: [0.54, 0.98] },
    ],
    extra: [
      T(942, 22, 'RPO / RTO: minutes', 'end'),
      T(275, 143, 'primary'),
      T(275, 335, 'secondary'),
      T(830, 188, 'Asynchronous', 'start'),
      T(830, 198, 'replication', 'start'),
    ].join(''),
  };
})();

const active = (() => {
  const P = wideP();
  P.ue = `M62,${rowY(RA)} H80 V${MID - 6} H132`;      // both user groups enter Route 53 on parallel stubs
  P.uw = `M62,${rowY(RB)} H80 V${MID + 6} H132`;
  return {
    id: 'mr-active',
    name: 'Active-active multi-Region',
    desc: 'Amazon Route 53 latency-based routing sends each user to the nearer of two live Regions, each with an Application Load Balancer and an Auto Scaling group, sharing Amazon DynamoDB global tables. The animation fails us-west-2 and Route 53 sends everyone to us-east-1.',
    wide: true, w: 960, h: 426, dur: 10,
    groups: wideGroups(),
    nodes: [
      N('uE', 'aws-res-users', 40, rowY(RA), 'Users', { sub: 'near us-east-1' }),
      N('uW', 'aws-res-users', 40, rowY(RB), 'Users', { sub: 'near us-west-2' }),
      N('r53', 'aws-svc-route-53', 156, MID, 'Amazon Route 53', { wrap: 16, sub: 'latency routing' }),
      albN('albA', RA), ecN('ecA1', RA, 1), ecN('ecA2', RA, 2), dbN('dbA', RA, 'aws-svc-dynamodb', 'Amazon DynamoDB', 'global table'),
      albN('albB', RB), ecN('ecB1', RB, 1), ecN('ecB2', RB, 2), dbN('dbB', RB, 'aws-svc-dynamodb', 'Amazon DynamoDB', 'global table'),
    ],
    wires: [
      { id: 'ue', d: P.ue }, { id: 'uw', d: P.uw },
      { id: 'ra', d: P.ra }, { id: 'rb', d: P.rb },
      ...regionWires(P, 'a', false, false),
      ...regionWires(P, 'b', false, false),
      { id: 'rep', d: P.rep, flow: true, both: true },
    ],
    steps: wideSteps('ue', [
      'Users query Amazon Route 53, whose latency-based routing answers with the Region that gives them the lowest latency.',
      'Each Region serves its users through its own Application Load Balancer. If a Region fails, Route 53 sends all users to the remaining Region.',
      'The load balancer forwards requests to Amazon EC2 instances in that Region\'s Auto Scaling group.',
      'The instances read and write the local replica of the Amazon DynamoDB global table.',
      'DynamoDB global tables replicate writes asynchronously in both directions, so either Region can take writes and serve all users if the other fails.',
    ]),
    timeline: [
      { wire: 'ue', t: [0.03, 0.08] }, { wire: 'uw', t: [0.03, 0.08] },
      { wire: 'ra', t: [0.09, 0.14], ring: 'albA' }, { wire: 'rb', t: [0.09, 0.14], ring: 'albB' },
      { wire: 'a1', t: [0.15, 0.19], ring: 'ecA1' }, { wire: 'b1', t: [0.15, 0.19], ring: 'ecB1' },
      { wire: 'ae1', t: [0.20, 0.25], ring: 'dbA' }, { wire: 'be1', t: [0.20, 0.25], ring: 'dbB' },
      { wire: 'rep', t: [0.27, 0.37], kind: 'pk-2', ring: 'dbB' },
      { wire: 'rep', t: [0.27, 0.37], kind: 'pk-2', reverse: true, ring: 'dbA' },
      { wire: 'ue', t: [0.58, 0.63] }, { wire: 'uw', t: [0.58, 0.63] },
      { wire: 'ra', t: [0.64, 0.70], ring: 'albA' },
      { wire: 'a2', t: [0.71, 0.75], ring: 'ecA2' },
      { wire: 'ae2', t: [0.76, 0.81], ring: 'dbA' },
    ],
    effects: [
      { fail: 'r2', t: [0.44, 0.98] },
      { fade: 'rb', t: [0.48, 0.98] },
      { fade: 'rep', t: [0.48, 0.98] },
      { glow: 'ra', t: [0.52, 0.98] },
    ],
    extra: [
      T(942, 22, 'RPO / RTO: real-time', 'end'),
      T(275, 143, 'nearest'),
      T(275, 335, 'nearest'),
      T(830, 188, 'Global tables', 'start'),
      T(830, 198, 'replication', 'start'),
    ].join(''),
  };
})();

// ------------------------------------------------------------------------------------------------
// Normal-size tiles
// ------------------------------------------------------------------------------------------------
const r53failover = (() => {
  const P = {
    u: 'M56,136 H118',
    p1: 'M164,130 H190 V84 H294', p2: 'M164,142 H190 V198 H294',
    w1: 'M340,84 H400', w2: 'M340,198 H400',
  };
  return {
    id: 'mr-r53-failover',
    name: 'Route 53 failover routing',
    desc: 'A Route 53 health check watches the primary endpoint in us-east-1; when it fails, DNS answers switch to the secondary record in us-west-2. The animation shows a healthy check, the outage, a failed check and the flip.',
    w: 480, h: 272, dur: 8,
    groups: [
      { kind: 'cloud', x: 92, y: 8, w: 380, h: 256 },
      { kind: 'region', id: 'r1', x: 212, y: 34, w: 252, h: 104, label: 'us-east-1' },
      { kind: 'region', id: 'r2', x: 212, y: 148, w: 252, h: 104, label: 'us-west-2' },
    ],
    nodes: [
      N('users', 'aws-res-users', 34, 136, 'Users'),
      N('r53', 'aws-svc-route-53', 142, 136, 'Amazon Route 53', { wrap: 8, sub: 'failover routing' }),
      N('alb1', ALB, 318, 84, 'Application Load Balancer'),
      N('ec1', 'aws-svc-ec2', 424, 84, 'Amazon EC2'),
      N('alb2', ALB, 318, 198, 'Application Load Balancer'),
      N('ec2', 'aws-svc-ec2', 424, 198, 'Amazon EC2'),
    ],
    wires: [
      { id: 'u', d: P.u },
      { id: 'p1', d: P.p1 }, { id: 'p2', d: P.p2, dashed: true },
      { id: 'w1', d: P.w1 }, { id: 'w2', d: P.w2 },
    ],
    steps: [
      { n: 1, at: 'u', f: 0.26, text: 'Users query Amazon Route 53 for the application\'s domain name.' },
      { n: 2, x: 253, y: 73, text: 'While the health check on the primary endpoint passes, Route 53 answers with the Application Load Balancer in us-east-1, which forwards to Amazon EC2.' },
      { n: 3, x: 253, y: 187, text: 'When the health check fails, Route 53 answers with the secondary record, and users reach the load balancer and EC2 in us-west-2.' },
    ],
    timeline: [
      { wire: 'u', t: [0.04, 0.09] },
      { wire: 'p1', t: [0.10, 0.16], ring: 'alb1' },
      { wire: 'w1', t: [0.17, 0.21], ring: 'ec1' },
      { wire: 'p1', t: [0.25, 0.31], kind: 'pk-2' },                     // health check probe
      { wire: 'p1', t: [0.32, 0.38], kind: 'pk-2', reverse: true, ring: 'r53' },   // healthy response
      { wire: 'p1', t: [0.46, 0.52], kind: 'pk-bad' },                   // probe gets no answer
      { wire: 'u', t: [0.60, 0.65] },
      { wire: 'p2', t: [0.66, 0.72], ring: 'alb2' },
      { wire: 'w2', t: [0.73, 0.78], ring: 'ec2' },
    ],
    effects: [
      { fail: 'r1', t: [0.44, 0.98] },
      { fade: 'p1', t: [0.54, 0.98] },
      { glow: 'p2', t: [0.56, 0.98] },
    ],
    extra: [
      T(253, 96, 'primary'),
      T(253, 106, 'health check'),
      T(253, 210, 'secondary'),
    ].join(''),
  };
})();

const gax = (() => {
  const P = {
    u: 'M56,136 H112',
    g1: 'M158,130 H180 V84 H302', g2: 'M158,142 H180 V198 H302',
    w1: 'M348,84 H398', w2: 'M348,198 H398',
  };
  return {
    id: 'mr-gax',
    name: 'AWS Global Accelerator',
    desc: 'AWS Global Accelerator gives users two static anycast IP addresses and carries their traffic over the AWS global network to the closest healthy Regional endpoint. The animation fails us-east-1 and traffic shifts to us-west-2.',
    w: 480, h: 272, dur: 8,
    groups: [
      { kind: 'cloud', x: 92, y: 8, w: 380, h: 256 },
      { kind: 'region', id: 'r1', x: 280, y: 34, w: 184, h: 104, label: 'us-east-1' },
      { kind: 'region', id: 'r2', x: 280, y: 148, w: 184, h: 104, label: 'us-west-2' },
    ],
    nodes: [
      N('users', 'aws-res-users', 34, 136, 'Users'),
      N('ga', 'aws-svc-global-accelerator', 136, 136, 'AWS Global Accelerator', { sub: '2 anycast IPs' }),
      N('alb1', ALB, 326, 84, 'Application Load Balancer'),
      N('ec1', 'aws-svc-ec2', 422, 84, 'Amazon EC2'),
      N('alb2', ALB, 326, 198, 'Application Load Balancer'),
      N('ec2', 'aws-svc-ec2', 422, 198, 'Amazon EC2'),
    ],
    wires: [
      { id: 'u', d: P.u },
      { id: 'g1', d: P.g1, flow: true }, { id: 'g2', d: P.g2, flow: true },
      { id: 'w1', d: P.w1 }, { id: 'w2', d: P.w2 },
    ],
    steps: [
      { n: 1, at: 'u', f: 0.29, text: 'Users connect to one of the two static anycast IP addresses of AWS Global Accelerator.' },
      { n: 2, x: 230, y: 73, text: 'Global Accelerator carries the traffic over the AWS global network to the closest healthy endpoint, the Application Load Balancer in us-east-1.' },
      { n: 3, x: 230, y: 187, text: 'When the us-east-1 endpoint fails its health checks, Global Accelerator shifts traffic to us-west-2 behind the same IP addresses, with no DNS change.' },
    ],
    timeline: [
      { wire: 'u', t: [0.04, 0.09], ring: 'ga' },
      { wire: 'g1', t: [0.10, 0.18], ring: 'alb1' },
      { wire: 'w1', t: [0.19, 0.24], ring: 'ec1' },
      { wire: 'u', t: [0.54, 0.59], ring: 'ga' },
      { wire: 'g2', t: [0.60, 0.70], ring: 'alb2' },
      { wire: 'w2', t: [0.71, 0.76], ring: 'ec2' },
    ],
    effects: [
      { fail: 'r1', t: [0.40, 0.98] },
      { fade: 'g1', t: [0.44, 0.98] },
      { glow: 'g2', t: [0.48, 0.98] },
    ],
    extra: [
      T(230, 96, 'AWS global network'),
      T(230, 210, 'AWS global network'),
    ].join(''),
  };
})();

const s3crr = (() => {
  const P = {
    u: 'M56,142 H116',
    ma: 'M162,136 H188 V84 H292', mb: 'M162,148 H188 V204 H292',
    rep: 'M338,84 H388 V204 H340',
  };
  return {
    id: 'mr-s3-crr',
    name: 'S3 Cross-Region Replication',
    desc: 'Amazon S3 Cross-Region Replication keeps versioned buckets in us-east-1 and us-west-2 in sync behind a Multi-Region Access Point set active-passive. When us-east-1 is disrupted, the failover controls shift requests to the replica bucket within minutes; two-way replication carries new writes back after recovery. The animation uploads an object, replicates it, fails us-east-1 and serves from the replica.',
    w: 480, h: 284, dur: 8,
    groups: [
      { kind: 'cloud', x: 92, y: 8, w: 380, h: 268 },
      { kind: 'region', id: 'r1', x: 212, y: 34, w: 252, h: 110, label: 'us-east-1' },
      { kind: 'region', id: 'r2', x: 212, y: 154, w: 252, h: 110, label: 'us-west-2' },
    ],
    nodes: [
      N('users', 'aws-res-users', 34, 142, 'Users'),
      N('mrap', 'aws-res-simple-storage-service-s3-multi-region-access-points', 140, 142, 'Multi-Region Access Point'),
      N('bA', 'aws-res-simple-storage-service-bucket', 316, 84, 'Source bucket', { wrap: 20, sub: 'versioning enabled' }),
      N('bB', 'aws-res-simple-storage-service-bucket', 316, 204, 'Destination bucket', { wrap: 20, sub: 'versioning enabled' }),
    ],
    wires: [
      { id: 'u', d: P.u },
      { id: 'ma', d: P.ma }, { id: 'mb', d: P.mb, dashed: true },
      { id: 'rep', d: P.rep, flow: true, both: true },
    ],
    steps: [
      { n: 1, at: 'u', f: 0.27, text: 'Users send requests to the Amazon S3 Multi-Region Access Point.' },
      { n: 2, x: 252, y: 73, text: 'The Multi-Region Access Point routes requests to the active source bucket in us-east-1.' },
      { n: 3, x: 388, y: 118, text: 'S3 Cross-Region Replication copies new objects to the destination bucket in us-west-2. In a disruption, the failover controls make that bucket active.' },
    ],
    timeline: [
      { wire: 'u', t: [0.04, 0.09], ring: 'mrap' },
      { wire: 'ma', t: [0.10, 0.18], ring: 'bA' },
      { wire: 'rep', t: [0.22, 0.38], kind: 'pk-2', ring: 'bB' },
      { wire: 'u', t: [0.58, 0.63], ring: 'mrap' },
      { wire: 'mb', t: [0.64, 0.74], ring: 'bB' },
    ],
    effects: [
      { fail: 'r1', t: [0.46, 0.98] },
      { fade: 'ma', t: [0.50, 0.98] },
      { fade: 'rep', t: [0.50, 0.98] },
      { glow: 'mb', t: [0.54, 0.98] },
    ],
    extra: [
      T(252, 96, 'active'),
      T(252, 215, 'passive, failover'),
      T(396, 170, 'Cross-Region', 'start'),
      T(396, 180, 'Replication', 'start'),
      T(396, 190, '(two-way)', 'start'),
    ].join(''),
  };
})();

export default {
  section: { id: 'regions', title: 'REGIONS & RESILIENCE' },
  diagrams: [
    // ------------------------------------------------------------------ mr-backup
    {
      id: 'mr-backup',
      name: 'Backup and restore',
      desc: 'AWS Backup stores recovery points in a vault in us-east-1 and copies them to a vault in us-west-2; after a Region failure a restore job rebuilds the workload there, with RPO and RTO measured in hours. The animation runs a backup, the cross-Region copy, the outage and the restore.',
      w: 480, h: 300, dur: 8,
      groups: [
        { kind: 'cloud', x: 8, y: 8, w: 464, h: 284 },
        { kind: 'region', id: 'r1', x: 20, y: 34, w: 440, h: 120, label: 'us-east-1' },
        { kind: 'region', id: 'r2', x: 20, y: 164, w: 440, h: 120, label: 'us-west-2' },
        { kind: 'gen', x: 36, y: 58, w: 152, h: 88, label: 'Protected resources' },
        { kind: 'gen', x: 36, y: 188, w: 152, h: 88, label: 'Restored resources' },
      ],
      nodes: [
        N('ec2', 'aws-svc-ec2', 72, 104, 'Amazon EC2'),
        N('rds', 'aws-svc-rds', 152, 104, 'Amazon RDS'),
        N('bk1', 'aws-svc-backup', 264, 104, 'AWS Backup'),
        N('v1', 'aws-res-backup-vault', 372, 104, 'Backup vault'),
        N('ec2r', 'aws-svc-ec2', 72, 234, 'Amazon EC2'),
        N('rdsr', 'aws-svc-rds', 152, 234, 'Amazon RDS'),
        N('bk2', 'aws-svc-backup', 264, 234, 'AWS Backup'),
        N('v2', 'aws-res-backup-vault', 372, 234, 'Backup vault'),
      ],
      wires: [
        { id: 'b1', d: 'M190,104 H240' },
        { id: 'b2', d: 'M286,104 H348' },
        { id: 'cp', d: 'M372,143 V210', dashed: true },
        { id: 'r1w', d: 'M350,234 H288' },
        { id: 'r2w', d: 'M242,234 H190' },
      ],
      steps: [
        { n: 1, at: 'b1', text: 'AWS Backup backs up the protected Amazon EC2 and Amazon RDS resources in us-east-1.' },
        { n: 2, at: 'b2', text: 'AWS Backup stores each recovery point in a backup vault in us-east-1.' },
        { n: 3, x: 372, y: 186, text: 'AWS Backup copies the recovery points to a backup vault in us-west-2.' },
        { n: 4, at: 'r1w', text: 'After a Region failure, AWS Backup in us-west-2 restores the recovery points to new EC2 and RDS resources. RPO and RTO are measured in hours.' },
      ],
      timeline: [
        { wire: 'b1', t: [0.04, 0.09], ring: 'bk1' },
        { wire: 'b2', t: [0.10, 0.15], ring: 'v1' },
        { wire: 'cp', t: [0.17, 0.30], kind: 'pk-2', ring: 'v2' },
        { wire: 'r1w', t: [0.48, 0.54], ring: 'bk2' },
        { wire: 'r2w', t: [0.55, 0.61] },
        { ring: 'ec2r', t: [0.62, 0.66] },
        { ring: 'rdsr', t: [0.62, 0.66] },
      ],
      effects: [
        { fail: 'r1', t: [0.38, 0.98] },
        { appear: 'ec2r', t: [0.61, 0.98], ghost: true },
        { appear: 'rdsr', t: [0.61, 0.98], ghost: true },
      ],
      extra: [
        T(462, 22, 'RPO / RTO: hours', 'end'),
        T(356, 186, 'Cross-Region copy', 'end'),
        T(318, 247, 'restore'),
      ].join(''),
    },

    pilot,
    warm,
    active,
    r53failover,
    gax,
    s3crr,

    // ------------------------------------------------------------------ mr-tgw-peering
    {
      id: 'mr-tgw-peering',
      name: 'Inter-Region Transit Gateway peering',
      desc: 'A peering attachment links the AWS Transit Gateways in us-east-1 and us-west-2, so attached VPCs reach each other over the AWS global network. The animation sends a request across the peering and returns the reply.',
      wide: true, w: 960, h: 364, dur: 8,
      groups: [
        { kind: 'cloud', x: 8, y: 8, w: 944, h: 348 },
        { kind: 'region', id: 'r1', x: 24, y: 36, w: 384, h: 308, label: 'us-east-1' },
        { kind: 'region', id: 'r2', x: 552, y: 36, w: 384, h: 308, label: 'us-west-2' },
        { kind: 'vpc', x: 40, y: 62, w: 190, h: 128, label: 'VPC 10.0.0.0/16' },
        { kind: 'vpc', x: 40, y: 206, w: 190, h: 128, label: 'VPC 10.1.0.0/16' },
        { kind: 'priv', x: 56, y: 88, w: 158, h: 94, label: 'Private subnet' },
        { kind: 'priv', x: 56, y: 232, w: 158, h: 94, label: 'Private subnet' },
        { kind: 'vpc', x: 730, y: 62, w: 190, h: 128, label: 'VPC 10.2.0.0/16' },
        { kind: 'vpc', x: 730, y: 206, w: 190, h: 128, label: 'VPC 10.3.0.0/16' },
        { kind: 'priv', x: 746, y: 88, w: 158, h: 94, label: 'Private subnet' },
        { kind: 'priv', x: 746, y: 232, w: 158, h: 94, label: 'Private subnet' },
      ],
      nodes: [
        N('ec1', 'aws-svc-ec2', 135, 138, 'Amazon EC2'),
        N('ec2', 'aws-svc-ec2', 135, 282, 'Amazon EC2'),
        N('tgw1', 'aws-svc-transit-gateway', 330, 198, 'AWS Transit Gateway'),
        N('tgw2', 'aws-svc-transit-gateway', 630, 198, 'AWS Transit Gateway'),
        N('ec3', 'aws-svc-ec2', 825, 138, 'Amazon EC2'),
        N('ec4', 'aws-svc-ec2', 825, 282, 'Amazon EC2'),
      ],
      wires: [
        { id: 'e1', d: 'M157,138 H270 V192 H306', both: true },
        { id: 'e2', d: 'M157,282 H270 V204 H306', both: true },
        { id: 'peer', d: 'M354,198 H606', both: true },
        { id: 'e3', d: 'M803,138 H690 V192 H654', both: true },
        { id: 'e4', d: 'M803,282 H690 V204 H654', both: true },
      ],
      steps: [
        { n: 1, at: 'e1', f: 0.45, text: 'An Amazon EC2 instance in VPC 10.0.0.0/16 sends a request for VPC 10.2.0.0/16 to AWS Transit Gateway in us-east-1.' },
        { n: 2, x: 436, y: 187, text: 'A static route sends it across the peering attachment to the transit gateway in us-west-2, over the AWS global network.' },
        { n: 3, at: 'e3', f: 0.45, text: 'The us-west-2 transit gateway delivers it to the EC2 instance in VPC 10.2.0.0/16, and the reply returns the same way.' },
      ],
      timeline: [
        { wire: 'e1', t: [0.04, 0.12], ring: 'tgw1' },
        { wire: 'peer', t: [0.14, 0.34], ring: 'tgw2' },
        { wire: 'e3', t: [0.36, 0.44], reverse: true, ring: 'ec3' },
        { wire: 'e3', t: [0.52, 0.60], kind: 'pk-2', ring: 'tgw2' },
        { wire: 'peer', t: [0.62, 0.82], kind: 'pk-2', reverse: true, ring: 'tgw1' },
        { wire: 'e1', t: [0.84, 0.92], kind: 'pk-2', reverse: true, ring: 'ec1' },
      ],
      extra: [
        T(480, 210, 'Peering attachment'),
        T(480, 221, 'static routes'),
      ].join(''),
    },
  ],
};
