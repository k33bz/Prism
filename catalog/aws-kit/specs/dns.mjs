// Route 53 & DNS family for the AWS Architecture gallery (k33bz fork): dns-* diagrams.
//   node catalog/aws-kit/awd.mjs preview catalog/aws-kit/specs/dns.mjs [light]
//   node catalog/aws-kit/awd.mjs build   catalog/aws-kit/specs/dns.mjs
//
// Authoring notes: nodes are placed by CENTER with nd(); wires are explicit H/V polylines built with P() from node
// ports (R/L/T/B); text uses the kit's `notes`, group `note` and wire `label` (raw `extra` only draws shapes such as
// legend dots and the red unhealthy mark). Documentation address ranges (192.0.2.0/24, 198.51.100.0/24,
// 203.0.113.0/24) stand in for public IPs. "Route 53 VPC Resolver" is the current name of Route 53 Resolver.

// ---- icon ids ----
const R53 = 'aws-svc-route-53';
const HZ = 'aws-res-route-53-hosted-zone';
const RES = 'aws-res-route-53-resolver';
const DNSFW = 'aws-res-route-53-resolver-dns-firewall';
const QLOG = 'aws-res-route-53-resolver-query-logging';
const ALB = 'aws-res-elastic-load-balancing-application-load-balancer';
const EC2 = 'aws-res-ec2-instance';
const EC2S = 'aws-res-ec2-instances';
const ENI = 'aws-res-vpc-elastic-network-interface';
const VGW = 'aws-res-vpc-vpn-gateway';
const TGW = 'aws-svc-transit-gateway';
const TGWA = 'aws-res-transit-gateway-attachment';
const DX = 'aws-svc-direct-connect';
const RAM = 'aws-svc-resource-access-manager';
const KMS = 'aws-svc-key-management-service';
const CWL = 'aws-res-cloudwatch-logs';
const S3B = 'aws-res-simple-storage-service-bucket';
const SERVER = 'aws-res-server';
const SERVERS = 'aws-res-servers';
const USERS = 'aws-res-users';
const CLIENT = 'aws-res-client';

// ---- layout helpers (shared with the other specs: ../place.mjs) ----
import { wrapLines, lblH, R, L, T, B, Bi, P, centered } from '../place.mjs';
// node by CENTER (cx, cy); default 40px icon
const nd = centered(40);
const f3 = (n) => Math.round(n * 1000) / 1000;
// consecutive equal windows starting at t0 (len each, gap between), one per item
const seq = (t0, len, items, gap = 0) => items.map((it, i) => ({ ...it, t: [f3(t0 + i * (len + gap)), f3(t0 + i * (len + gap) + len)] }));
// request leg (left to right, orange) and response leg (blue)
const fw = (wire, o = {}) => ({ wire, ...o });
const bk = (wire, o = {}) => ({ wire, reverse: true, kind: 'pk-2', ...o });
const RED = '#DD344C';
// raw shapes (the kit has no node-level fail mark or legend dots)
const dot = (x, y, kind) => `<circle cx="${x}" cy="${y}" r="3.4" fill="var(--awd-${kind})"/>`;
const xmark = (cx, cy, r = 7.5) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${RED}"/><path d="M${cx - 3},${cy - 3} L${cx + 3},${cy + 3} M${cx + 3},${cy - 3} L${cx - 3},${cy + 3}" stroke="#fff" stroke-width="1.7" fill="none"/>`;
const timed = (a, b, dur, svg) =>
  `<g class="anim" opacity="0">${svg}<animate attributeName="opacity" dur="${dur}s" repeatCount="indefinite" calcMode="discrete" values="0;1;0" keyTimes="0;${String(f3(a)).replace(/^0\./, '.')};${String(f3(b)).replace(/^0\./, '.')}"/></g>`;
const legend = (x, y, ...items) => ({
  extra: items.map(([kind], i) => dot(x, y + i * 14, kind)).join(''),
  notes: items.map(([, text], i) => ({ x: x + 9, y: y + 3 + i * 14, text, anchor: 'start' })),
});

// ---------------------------------------------------------------------------------------------
// dns-resolution: how a public name resolves (wide)
// ---------------------------------------------------------------------------------------------
const resolution = (() => {
  const res = nd('res', SERVER, 110, 196, 'Recursive resolver', { wrap: 10, sub: 'caches by TTL' });
  const cli = nd('cli', CLIENT, 110, 322, 'Client', { sub: 'stub resolver' });
  const root = nd('root', SERVER, 330, 50, 'Root name server', { wrap: 12 });
  const tld = nd('tld', SERVER, 330, 196, '.com TLD name server', { wrap: 12 });
  const NS = [
    nd('ns1', R53, 596, 112, 'ns-17', { size: 32, sub: 'awsdns-02.com' }),
    nd('ns2', R53, 686, 112, 'ns-603', { size: 32, sub: 'awsdns-11.net' }),
    nd('ns3', R53, 776, 112, 'ns-1144', { size: 32, sub: 'awsdns-15.org' }),
    nd('ns4', R53, 866, 112, 'ns-1802', { size: 32, sub: 'awsdns-33.co.uk' }),
  ];
  const alb = nd('alb', ALB, 700, 322, 'Application Load Balancer');
  const ec2 = nd('ec2', EC2S, 860, 322, 'Amazon EC2 instances');
  const lg = legend(16, 392, ['pk', 'Query'], ['pk2', 'Referral or answer']);
  return {
    id: 'dns-resolution',
    name: 'How a public name resolves',
    desc: 'A recursive resolver walks the DNS hierarchy for example.com: the root refers it to the .com servers, which refer it to the four name servers of the Route 53 public hosted zone, where an alias record at the zone apex answers with the load balancer. The resolver caches the answer for its TTL, so a second query is answered from cache. Orange packets are queries, blue are referrals and answers; the animation runs the full lookup, the HTTPS request and then the cached repeat.',
    wide: true, w: 960, h: 424, dur: 10,
    groups: [
      { kind: 'cloud', x: 520, y: 20, w: 432, h: 392 },
      { kind: 'gen', x: 536, y: 46, w: 400, h: 172, icon: HZ, label: 'Public hosted zone example.com', note: '4 name servers' },
      { kind: 'region', x: 536, y: 238, w: 400, h: 156, label: 'us-east-1' },
    ],
    nodes: [res, cli, root, tld, ...NS, alb, ec2],
    wires: [
      { id: 'c1', d: P(T(cli), B(res, 0, 8)), both: true, label: 'example.com A?', labelAt: 0.5, labelAnchor: 'start', labelDx: 8, labelDy: 3 },
      { id: 'r1', d: P(R(res), [200, 196], [200, 50], L(root)), both: true },
      { id: 'r2', d: P(R(res), L(tld)), both: true },
      { id: 'r3', d: P(R(res), [200, 196], [200, 112], L(NS[0])), both: true },
      { id: 'al', d: P([700, 218], T(alb)), dashed: true, arrow: true, label: 'alias A record', labelAt: 0.5, labelAnchor: 'start', labelDx: 8, labelDy: 3 },
      { id: 'lb', d: P(R(alb), L(ec2)) },
      { id: 'h', d: P(R(cli), L(alb)), label: 'HTTPS to 203.0.113.10', labelAt: 0.5 },
    ],
    steps: [
      { n: 1, at: 'c1', f: 0.7, dx: -11, dy: 0, text: 'The stub resolver on the client asks the recursive resolver for the A record of example.com.' },
      { n: 2, at: 'r1', f: 0.9, dy: -11, text: 'The recursive resolver queries a root name server, which refers it to the .com TLD name servers.' },
      { n: 3, at: 'r2', f: 0.5, dy: -11, text: 'The resolver queries a .com TLD name server, which refers it to the four Route 53 name servers for example.com.' },
      { n: 4, at: 'r3', f: 0.78, dy: -11, text: 'A Route 53 name server answers from the public hosted zone: the alias A record at the zone apex returns the Application Load Balancer addresses.' },
      { n: 5, at: 'c1', f: 0.3, dx: -11, dy: 0, text: 'The resolver caches the answer for its 60-second TTL and returns 203.0.113.10 to the client.' },
      { n: 6, at: 'h', f: 0.2, dy: -11, text: 'The client connects over HTTPS to the Application Load Balancer, which forwards to the EC2 instances. A repeat query inside the TTL is answered from cache.' },
    ],
        timeline: [
      // cold lookup: client, root referral, TLD referral, Route 53 answer, answer to the client
      ...seq(0.02, 0.05, [
        fw('c1'), fw('r1', { ring: 'root' }), bk('r1', { ring: 'res' }),
        fw('r2', { ring: 'tld' }), bk('r2', { ring: 'res' }),
        fw('r3', { ring: 'ns1' }), bk('r3', { ring: 'res' }),
        bk('c1', { ring: 'cli' }),
      ], 0.005),
      ...seq(0.47, 0.1, [fw('h', { ring: 'alb' })]),
      ...seq(0.59, 0.05, [fw('lb', { ring: 'ec2' })]),
      // second query inside the TTL: answered from the resolver cache
      ...seq(0.74, 0.05, [fw('c1', { ring: 'res' }), bk('c1', { ring: 'cli' })], 0.01),
    ],
    notes: [
      { x: 362, y: 46, text: 'Referral:\nNS for .com', anchor: 'start' },
      { x: 362, y: 192, text: 'Referral: NS for example.com\n(4 name servers)', anchor: 'start' },
      { x: 552, y: 184, text: 'example.com  A  ALIAS  my-alb-1234.us-east-1.elb.amazonaws.com', anchor: 'start' },
      { x: 552, y: 195, text: 'Alias answers return the ALB addresses with TTL 60 s', anchor: 'start' },
      { x: 206, y: 262, text: 'Cached: example.com A\n203.0.113.10, TTL 60 s', anchor: 'start', t: [0.4, 0.72] },
      { x: 206, y: 262, text: 'Second query inside the TTL: answered from cache', anchor: 'start', kind: 'label', t: [0.73, 0.98] },
      { x: 206, y: 275, text: 'No root, TLD or Route 53 lookups needed', anchor: 'start', t: [0.73, 0.98] },
      ...lg.notes,
    ],
    extra: lg.extra,
  };
})();

// ---------------------------------------------------------------------------------------------
// dns-weighted: weighted routing for a canary release
// ---------------------------------------------------------------------------------------------
const weighted = (() => {
  const users = nd('users', USERS, 30, 150, 'Users', { size: 36 });
  const r53 = nd('r53', R53, 130, 150, 'Amazon Route 53', { wrap: 8, sub: 'weighted routing' });
  const alb1 = nd('alb1', ALB, 300, 100, 'Application Load Balancer', { size: 32 });
  const ec1 = nd('ec1', EC2S, 410, 100, 'Amazon EC2', { size: 32, sub: 'app v1' });
  const alb2 = nd('alb2', ALB, 300, 208, 'Application Load Balancer', { size: 32 });
  const ec2 = nd('ec2', EC2S, 410, 208, 'Amazon EC2', { size: 32, sub: 'app v2' });
  // one query = users -> Route 53 -> chosen ALB -> instances; each phase picks a different mix of v1 / v2
  const query = (t0, p, alb, ec, w) => [
    { wire: 'u', t: [f3(t0), f3(t0 + 0.02)] },
    { wire: p, t: [f3(t0 + 0.02), f3(t0 + 0.05)], ring: alb },
    { wire: w, t: [f3(t0 + 0.05), f3(t0 + 0.07)], ring: ec },
  ];
  const one = (p) => (p === 'p1' ? ['p1', 'alb1', 'ec1', 'w1'] : ['p2', 'alb2', 'ec2', 'w2']);
  const mix = (start, order) => order.flatMap((p, i) => query(start + i * 0.08, ...one(p)));
  return {
    id: 'dns-weighted',
    name: 'Weighted routing for a canary',
    desc: 'Two weighted alias records with the same name point at a stable and a canary load balancer stack. Route 53 answers in proportion to the weights: 90 / 10 first, then 50 / 50, then 0 / 100 once the canary is promoted. The animation shifts the weights and the share of queries going to each stack.',
    w: 480, h: 282, dur: 10,
    groups: [
      { kind: 'cloud', x: 70, y: 8, w: 402, h: 266 },
      { kind: 'region', x: 246, y: 34, w: 218, h: 232, label: 'us-east-1' },
      { kind: 'gen', x: 258, y: 58, w: 194, h: 96, label: 'Stable (v1)' },
      { kind: 'gen', x: 258, y: 164, w: 194, h: 96, label: 'Canary (v2)' },
    ],
    nodes: [users, r53, alb1, ec1, alb2, ec2],
    wires: [
      { id: 'u', d: P(R(users), L(r53)) },
      { id: 'p1', d: P(R(r53, -6), [176, 144], [176, 100], L(alb1)) },
      { id: 'p2', d: P(R(r53, 6), [176, 156], [176, 208], L(alb2)) },
      { id: 'w1', d: P(R(alb1), L(ec1)) },
      { id: 'w2', d: P(R(alb2), L(ec2)) },
    ],
    steps: [
      { n: 1, at: 'u', f: 0.5, dy: -11, text: 'Users look up the application name. Amazon Route 53 holds two weighted alias records for it, with set identifiers v1 and v2.' },
      { n: 2, at: 'p1', f: 0.55, dy: 12, text: 'Route 53 answers with the stable or the canary load balancer in proportion to the weights: 90/10, then 50/50, then 0/100 at cutover.' },
      { n: 3, at: 'w1', f: 0.5, dy: -11, text: 'Users connect to the Application Load Balancer in the answer, which sends their requests to the v1 or v2 instances.' },
    ],
        timeline: [
      ...mix(0.02, ['p1', 'p1', 'p1', 'p2']),
      ...mix(0.36, ['p1', 'p2', 'p1', 'p2']),
      ...mix(0.70, ['p2', 'p2', 'p2']),
    ],
    effects: [
      { fade: 'p1', t: [0.72, 0.99] },
      { glow: 'p2', t: [0.72, 0.99] },
    ],
    notes: [
      // weights per phase, beside the two answer wires
      { x: 211, y: 94, text: 'weight 90', t: [0.02, 0.34] }, { x: 211, y: 202, text: 'weight 10', t: [0.02, 0.34] },
      { x: 211, y: 94, text: 'weight 50', t: [0.36, 0.68] }, { x: 211, y: 202, text: 'weight 50', t: [0.36, 0.68] },
      { x: 211, y: 94, text: 'weight 0', t: [0.70, 0.99] }, { x: 211, y: 202, text: 'weight 100', t: [0.70, 0.99] },
      { x: 130, y: 232, text: 'Canary: 90 / 10', kind: 'label', t: [0.02, 0.34] },
      { x: 130, y: 232, text: 'Ramp up: 50 / 50', kind: 'label', t: [0.36, 0.68] },
      { x: 130, y: 232, text: 'Cutover: 0 / 100', kind: 'label', t: [0.70, 0.99] },
      { x: 130, y: 250, text: 'Two records, same name,\nset identifiers v1 and v2' },
    ],
  };
})();

// ---------------------------------------------------------------------------------------------
// dns-geo: geolocation routing with a default record
// ---------------------------------------------------------------------------------------------
const geo = (() => {
  const UY = [54, 114, 174, 234];
  const subs = ['North America', 'South America', 'Europe', 'Asia'];
  const us = UY.map((y, i) => nd('u' + i, USERS, 30, y, 'Users', { size: 32, sub: subs[i] }));
  const r53 = nd('r53', R53, 140, 152, 'Amazon Route 53', { wrap: 8, sub: 'geolocation' });
  const RY = [68, 152, 236];
  const albs = RY.map((y, i) => nd('alb' + i, ALB, 360, y, 'Application Load Balancer', { size: 32, wrap: 30 }));
  const lane = 70;
  const uw = (i) => P(R(us[i], 0, 4), [lane, UY[i]], [lane, 152], L(r53));
  return {
    id: 'dns-geo',
    name: 'Geolocation routing',
    desc: 'Route 53 matches the location of the query to a geolocation record: North America and a Default record go to us-east-1, Europe to eu-west-1 and Asia to ap-southeast-1. A South America query has no record of its own, so the Default record answers. The animation sends one query from each location.',
    w: 480, h: 292, dur: 10,
    groups: [
      { kind: 'cloud', x: 84, y: 8, w: 388, h: 276 },
      { kind: 'region', x: 262, y: 30, w: 202, h: 76, label: 'us-east-1' },
      { kind: 'region', x: 262, y: 114, w: 202, h: 76, label: 'eu-west-1' },
      { kind: 'region', x: 262, y: 198, w: 202, h: 76, label: 'ap-southeast-1' },
    ],
    nodes: [...us, r53, ...albs],
    wires: [
      ...us.map((_, i) => ({ id: 'u' + i, d: uw(i) })),
      { id: 'gNA', d: P(R(r53, -14), [196, 138], [196, 62], L(albs[0], -6)), label: 'NA', labelAt: 0.82 },
      { id: 'gDEF', d: P(R(r53, -8), [210, 144], [210, 74], L(albs[0], 6)), dashed: true, label: 'Default', labelAt: 0.6, labelDy: 11 },
      { id: 'gEU', d: P(R(r53), L(albs[1])), label: 'EU', labelAt: 0.82 },
      { id: 'gAS', d: P(R(r53, 12), [196, 164], [196, 236], L(albs[2])), label: 'AS', labelAt: 0.82 },
    ],
    steps: [
      { n: 1, at: 'u2', f: 0.45, dy: -11, text: 'Users in Europe query the application name, and Amazon Route 53 matches the location of the query to the Europe geolocation record.' },
      { n: 2, at: 'gEU', f: 0.55, dy: -11, text: 'Route 53 answers with the eu-west-1 load balancer. North America and the Default record, which serves South America, go to us-east-1; Asia goes to ap-southeast-1.' },
    ],
        timeline: [
      ...seq(0.03, 0.07, [fw('u0', { ring: 'r53' }), fw('gNA', { ring: 'alb0' })], 0.01),
      ...seq(0.27, 0.07, [fw('u1', { ring: 'r53' }), fw('gDEF', { ring: 'alb0' })], 0.01),
      ...seq(0.51, 0.07, [fw('u2', { ring: 'r53' }), fw('gEU', { ring: 'alb1' })], 0.01),
      ...seq(0.75, 0.07, [fw('u3', { ring: 'r53' }), fw('gAS', { ring: 'alb2' })], 0.01),
    ],
    notes: [
      { x: 140, y: 222, text: 'No SA record,\nso Default answers', t: [0.28, 0.5] },
    ],
  };
})();

// ---------------------------------------------------------------------------------------------
// dns-multivalue: up to eight healthy records; an unhealthy one drops out
// ---------------------------------------------------------------------------------------------
const multivalue = (() => {
  const users = nd('users', USERS, 30, 56, 'Users', { size: 36 });
  const r53 = nd('r53', R53, 190, 56, 'Amazon Route 53', { wrap: 20, sub: 'multivalue answer routing' });
  const IP = ['192.0.2.10', '192.0.2.11', '192.0.2.12', '192.0.2.13'];
  const EX = [190, 270, 350, 430];
  const eps = EX.map((x, i) => nd('e' + i, EC2, x, 226, 'Amazon EC2', { size: 32, sub: IP[i] }));
  const busY = 128;
  return {
    id: 'dns-multivalue',
    name: 'Multivalue answer routing',
    desc: 'Four multivalue answer records, each with its own health check, resolve app.example.com. Route 53 returns up to eight healthy addresses and the client connects to one. When the fourth endpoint fails its health check, Route 53 drops its address from the answers. The animation runs a query, the health checks, the failure and a second query.',
    w: 480, h: 292, dur: 10,
    groups: [
      { kind: 'cloud', x: 84, y: 8, w: 392, h: 276 },
      { kind: 'region', x: 100, y: 150, w: 368, h: 126, label: 'us-east-1' },
    ],
    nodes: [users, r53, ...eps],
    wires: [
      { id: 'q', d: P(R(users), L(r53)), both: true, label: 'app.example.com A?', labelAt: 0.66, labelDy: -6 },
      ...eps.map((e, i) => ({ id: 'h' + i, d: P([190, 106], [190, busY], [EX[i], busY], T(e)), dashed: true })),
      { id: 'c', d: P(B(users), [30, 226], L(eps[0])), label: 'connect', labelAt: 0.24, labelAnchor: 'start', labelDx: 5, labelDy: 0 },
    ],
    steps: [
      { n: 1, at: 'q', f: 0.25, dy: 12, text: 'Users query app.example.com, which has four multivalue answer records, each with its own health check.' },
      { n: 2, at: 'q', f: 0.75, dy: 12, text: 'Amazon Route 53 answers with up to eight healthy records. When 192.0.2.13 fails its health check, later answers leave it out.' },
      { n: 3, at: 'c', f: 0.88, dy: -11, text: 'The client connects to one of the returned addresses, 192.0.2.10.' },
    ],
        timeline: [
      // first query: four healthy records, the client connects to the first
      ...seq(0.02, 0.05, [fw('q', { ring: 'r53' }), bk('q', { ring: 'users' })], 0.01),
      ...seq(0.16, 0.1, [fw('c', { ring: 'e0' })]),
      // health checks: probes out, healthy answers back
      ...['h0', 'h1', 'h2', 'h3'].map((w) => ({ wire: w, kind: 'pk-2', t: [0.30, 0.35] })),
      ...['h0', 'h1', 'h2'].map((w, i) => ({ wire: w, reverse: true, kind: 'pk-2', t: [0.36, 0.41], ...(i === 0 ? { ring: 'r53' } : {}) })),
      // the fourth endpoint stops answering
      { wire: 'h3', kind: 'pk-bad', t: [0.48, 0.56] },
      // second query: three healthy records
      ...seq(0.66, 0.05, [fw('q', { ring: 'r53' }), bk('q', { ring: 'users' })], 0.01),
      ...seq(0.80, 0.1, [fw('c', { ring: 'e0' })]),
    ],
    notes: [
      { x: 232, y: 36, text: 'Answer: 4 healthy records\n192.0.2.10  192.0.2.11\n192.0.2.12  192.0.2.13', anchor: 'start', t: [0.1, 0.66] },
      { x: 232, y: 36, text: 'Answer: 3 healthy records\n192.0.2.10  192.0.2.11\n192.0.2.12', anchor: 'start', t: [0.73, 0.99] },
      { x: 232, y: 120, text: 'health checks', anchor: 'start' },
      { x: 232, y: 68, text: '192.0.2.13 failed its health check', kind: 'warn', anchor: 'start', t: [0.6, 0.99] },
    ],
    extra: timed(0.58, 0.99, 10, xmark(446, 212)),
  };
})();

// ---------------------------------------------------------------------------------------------
// dns-private-zone: private hosted zone for two VPCs, plus split horizon
// ---------------------------------------------------------------------------------------------
const privateZone = (() => {
  const inet = nd('inet', USERS, 30, 52, 'Internet users', { size: 36, wrap: 8 });
  const pub = nd('pub', HZ, 420, 52, 'Public hosted zone', { wrap: 14, sub: 'example.com' });
  const ea = nd('ea', EC2, 140, 158, 'Amazon EC2', { size: 32 });
  const ra = nd('ra', RES, 270, 158, 'Route 53 VPC Resolver', { size: 32, wrap: 22 });
  const eb = nd('eb', EC2, 140, 230, 'Amazon EC2', { size: 32 });
  const rb = nd('rb', RES, 270, 230, 'Route 53 VPC Resolver', { size: 32, wrap: 22 });
  const phz = nd('phz', HZ, 420, 194, 'Private hosted zone', { wrap: 14, sub: 'example.com' });
  return {
    id: 'dns-private-zone',
    name: 'Private hosted zone and split horizon',
    desc: 'One private hosted zone is associated with two VPCs. Instances query the Route 53 VPC Resolver at the VPC base address plus two, which answers app.example.com from the private zone with a private IP. The same name queried from the internet is answered by the public hosted zone with a public IP. The animation resolves from each VPC, then from the internet.',
    w: 480, h: 288, dur: 10,
    groups: [
      { kind: 'cloud', x: 70, y: 8, w: 402, h: 272 },
      { kind: 'region', x: 82, y: 106, w: 290, h: 166, label: 'us-east-1', note: 'enableDnsSupport + enableDnsHostnames' },
      { kind: 'vpc', x: 94, y: 126, w: 266, h: 66, label: 'VPC A', note: '10.0.0.0/16, Resolver 10.0.0.2' },
      { kind: 'vpc', x: 94, y: 198, w: 266, h: 66, label: 'VPC B', note: '10.1.0.0/16, Resolver 10.1.0.2' },
    ],
    nodes: [inet, pub, ea, ra, eb, rb, phz],
    wires: [
      { id: 'pu', d: P(R(inet), L(pub)), both: true, label: 'app.example.com A?', labelAt: 0.5 },
      { id: 'ea', d: P(R(ea), L(ra)) },
      { id: 'za', d: P(R(ra), [384, 158], [384, 188], L(phz, -6)), both: true },
      { id: 'eb', d: P(R(eb), L(rb)) },
      { id: 'zb', d: P(R(rb), [384, 230], [384, 200], L(phz, 6)), both: true },
    ],
    steps: [
      { n: 1, at: 'ea', f: 0.5, dy: -11, text: 'An instance in VPC A sends a query for app.example.com to the Route 53 VPC Resolver at 10.0.0.2, the VPC base address plus two.' },
      { n: 2, at: 'za', f: 0.9, dy: -11, text: 'The Resolver answers from the private hosted zone associated with VPC A and VPC B, returning 10.0.1.25. VPC B resolves the name the same way.' },
      { n: 3, at: 'pu', f: 0.2, dy: -11, text: 'The public hosted zone answers the same name for internet users with 203.0.113.10: split horizon.' },
    ],
        timeline: [
      ...seq(0.03, 0.05, [fw('ea', { ring: 'ra' }), fw('za', { ring: 'phz' }), bk('za', { ring: 'ra' }), bk('ea', { ring: 'ea' })], 0.005),
      ...seq(0.30, 0.05, [fw('eb', { ring: 'rb' }), fw('zb', { ring: 'phz' }), bk('zb', { ring: 'rb' }), bk('eb', { ring: 'eb' })], 0.005),
      ...seq(0.60, 0.1, [fw('pu', { ring: 'pub' }), bk('pu', { ring: 'inet' })], 0.03),
    ],
    notes: [
      { x: 420, y: 122, text: 'app.example.com A\n203.0.113.10' },
      { x: 420, y: 264, text: 'app.example.com A\n10.0.1.25' },
      { x: 227, y: 98, text: 'Split horizon: same name, different answers' },
    ],
  };
})();

// ---------------------------------------------------------------------------------------------
// dns-hybrid: Route 53 VPC Resolver inbound and outbound endpoints (wide)
// ---------------------------------------------------------------------------------------------
const hybrid = (() => {
  const cli = nd('cli', CLIENT, 92, 110, 'Client');
  const dns = nd('dns', SERVERS, 92, 236, 'On-premises DNS servers', { wrap: 14, sub: '10.1.1.10' });
  const dx = nd('dx', DX, 236, 236, 'AWS Direct Connect', { wrap: 14, sub: 'or Site-to-Site VPN' });
  const vgw = nd('vgw', VGW, 368, 236, 'Virtual private gateway', { wrap: 14 });
  const ia = nd('ia', ENI, 500, 120, 'Inbound endpoint', { size: 32, wrap: 18, sub: 'ENI 10.0.1.10' });
  const oa = nd('oa', ENI, 500, 184, 'Outbound endpoint', { size: 32, wrap: 18, sub: 'ENI 10.0.1.20' });
  const ib = nd('ib', ENI, 500, 278, 'Inbound endpoint', { size: 32, wrap: 18, sub: 'ENI 10.0.2.10' });
  const ob = nd('ob', ENI, 500, 342, 'Outbound endpoint', { size: 32, wrap: 18, sub: 'ENI 10.0.2.20' });
  const ec2 = nd('ec2', EC2, 740, 118, 'Amazon EC2', { sub: '10.0.1.50' });
  const res = nd('res', RES, 740, 236, 'Route 53 VPC Resolver', { wrap: 12, sub: '10.0.0.2' });
  const phz = nd('phz', HZ, 880, 236, 'Private hosted zone', { wrap: 14, sub: 'aws.example.com' });
  const rv = (wire, o = {}) => ({ wire, reverse: true, ...o });
  const lg = legend(16, 404, ['pk', 'Query'], ['pk2', 'Answer']);
  return {
    id: 'dns-hybrid',
    name: 'Hybrid DNS with Resolver endpoints',
    desc: 'An inbound endpoint (ENIs in two Availability Zones) lets on-premises DNS servers resolve the private hosted zone aws.example.com over Direct Connect or VPN. An outbound endpoint and a forwarding rule send queries for corp.example.com from the VPC to the on-premises servers. The animation runs one inbound lookup, then one outbound lookup, each with its answer.',
    wide: true, w: 960, h: 428, dur: 10,
    groups: [
      { kind: 'dc', x: 8, y: 40, w: 168, h: 316 },
      { kind: 'cloud', x: 300, y: 8, w: 652, h: 412 },
      { kind: 'region', x: 312, y: 34, w: 496, h: 376, label: 'Region' },
      { kind: 'vpc', x: 324, y: 58, w: 472, h: 340, label: 'VPC', note: '10.0.0.0/16' },
      { kind: 'az', x: 412, y: 82, w: 214, h: 150, label: 'Availability Zone A' },
      { kind: 'az', x: 412, y: 240, w: 214, h: 150, label: 'Availability Zone B' },
    ],
    nodes: [cli, dns, dx, vgw, ia, oa, ib, ob, ec2, res, phz],
    wires: [
      { id: 'c', d: P(B(cli), T(dns)), both: true },
      { id: 'd1', d: P(R(dns), L(dx)), both: true },
      { id: 'd2', d: P(R(dx), L(vgw)), both: true },
      { id: 'ina', d: P(R(vgw), [402, 236], [402, 120], L(ia)) },
      { id: 'inb', d: P(R(vgw), [402, 236], [402, 278], L(ib)) },
      { id: 'outa', d: P(L(oa), [402, 184], [402, 230], R(vgw, -6)) },
      { id: 'outb', d: P(L(ob), [402, 342], [402, 242], R(vgw, 6)) },
      { id: 'iar', d: P(R(ia), [672, 120], [672, 224], L(res, -12)) },
      { id: 'ibr', d: P(R(ib), [672, 278], [672, 224], L(res, -12)) },
      { id: 'oar', d: P(L(res, 12), [672, 248], [672, 184], R(oa)) },
      { id: 'obr', d: P(L(res, 12), [672, 248], [672, 342], R(ob)) },
      { id: 'e', d: P(B(ec2), T(res)), both: true },
      { id: 'z', d: P(R(res), L(phz)), both: true, label: 'zone lookup', labelAt: 0.76 },
    ],
    steps: [
      { n: 1, at: 'c', f: 0.5, dx: 11, dy: 0, text: 'The on-premises client asks the on-premises DNS servers for a name in aws.example.com.' },
      { n: 2, at: 'd2', f: 0.5, dy: -11, text: 'A conditional forwarder sends the query over AWS Direct Connect or AWS Site-to-Site VPN to the inbound endpoint IPs 10.0.1.10 and 10.0.2.10.' },
      { n: 3, at: 'iar', f: 0.3, dy: -11, text: 'The inbound endpoint passes the query to the Route 53 VPC Resolver, which answers from the private hosted zone; the answer returns to the client.' },
      { n: 4, at: 'e', f: 0.5, dx: 11, dy: 0, text: 'An instance in the VPC queries the Route 53 VPC Resolver at 10.0.0.2 for a name in corp.example.com.' },
      { n: 5, at: 'obr', f: 0.85, dy: -11, text: 'The forwarding rule for corp.example.com sends the query through the outbound endpoint to the on-premises DNS servers, and the answer returns to the instance.' },
    ],
        timeline: [
      // inbound: on-premises client -> on-premises DNS -> inbound endpoint -> VPC Resolver -> private hosted zone
      ...seq(0.02, 0.032, [
        fw('c', { ring: 'dns' }), fw('d1', { ring: 'dx' }), fw('d2', { ring: 'vgw' }), fw('ina', { ring: 'ia' }),
        fw('iar', { ring: 'res' }), fw('z', { ring: 'phz' }),
        bk('z', { ring: 'res' }), bk('iar', { ring: 'ia' }), bk('ina', { ring: 'vgw' }), bk('d2', { ring: 'dx' }),
        bk('d1', { ring: 'dns' }), bk('c', { ring: 'cli' }),
      ], 0.004),
      // outbound: instance -> VPC Resolver -> forwarding rule -> outbound endpoint -> on-premises DNS
      ...seq(0.52, 0.036, [
        fw('e', { ring: 'res' }), fw('obr', { ring: 'ob' }), fw('outb', { ring: 'vgw' }), rv('d2', { ring: 'dx' }), rv('d1', { ring: 'dns' }),
        { wire: 'd1', kind: 'pk-2', ring: 'dx' }, { wire: 'd2', kind: 'pk-2', ring: 'vgw' },
        bk('outb', { ring: 'ob' }), bk('obr', { ring: 'res' }), bk('e', { ring: 'ec2' }),
      ], 0.004),
    ],
    notes: [
      { x: 92, y: 314, text: 'Conditional forwarder:\naws.example.com >\n10.0.1.10, 10.0.2.10' },
      { x: 236, y: 306, text: 'Inbound: on-premises\nresolves aws.example.com', t: [0.02, 0.5] },
      { x: 236, y: 306, text: 'Outbound: AWS resolves\ncorp.example.com', t: [0.52, 0.98] },
      { x: 740, y: 312, text: 'Forwarding rule:\ncorp.example.com >\n10.1.1.10, 10.1.1.11' },
      ...lg.notes,
    ],
    extra: lg.extra,
  };
})();

// ---------------------------------------------------------------------------------------------
// dns-shared-rules: centralized DNS in a networking account (wide)
// ---------------------------------------------------------------------------------------------
const sharedRules = (() => {
  const ec2a = nd('ec2a', EC2, 84, 128, 'Amazon EC2', { size: 32 });
  const resa = nd('resa', RES, 184, 128, 'Route 53 VPC Resolver', { size: 32, wrap: 12 });
  const ec2b = nd('ec2b', EC2, 84, 308, 'Amazon EC2', { size: 32 });
  const resb = nd('resb', RES, 184, 308, 'Route 53 VPC Resolver', { size: 32, wrap: 12 });
  const ram = nd('ram', RAM, 284, 72, 'AWS Resource Access Manager', { wrap: 14 });
  const tgw = nd('tgw', TGW, 284, 220, 'AWS Transit Gateway', { wrap: 12 });
  const rule = nd('rule', RES, 400, 128, 'Forwarding rule', { size: 32, wrap: 16, sub: 'corp.example.com' });
  const phz = nd('phz', HZ, 510, 128, 'Private hosted zone', { size: 32, wrap: 14, sub: 'aws.example.com' });
  const fwg = nd('fwg', DNSFW, 620, 128, 'DNS Firewall rule group', { size: 32, wrap: 14, sub: 'block list' });
  const att = nd('att', TGWA, 396, 288, 'TGW attachment', { size: 32, wrap: 16 });
  const ob = nd('ob', ENI, 488, 288, 'Outbound endpoint', { size: 32, wrap: 18, sub: 'ENIs in 2 AZs' });
  const ib = nd('ib', ENI, 596, 288, 'Inbound endpoint', { size: 32, wrap: 18, sub: 'ENIs in 2 AZs' });
  const dx = nd('dx', DX, 772, 300, 'AWS Direct Connect', { wrap: 14 });
  const dns = nd('dns', SERVERS, 882, 300, 'On-premises DNS servers', { wrap: 14, sub: '10.1.1.10' });
  const rv = (wire, o = {}) => ({ wire, reverse: true, ...o });
  const lg = legend(36, 402, ['pk', 'Query'], ['pk2', 'Answer or share']);
  return {
    id: 'dns-shared-rules',
    name: 'Centralized DNS with AWS RAM and Profiles',
    desc: 'A networking account owns the Resolver endpoints, the forwarding rule and the private hosted zone, bundles them in a Route 53 Profile and shares it with spoke accounts through AWS RAM (dashed). Spoke VPCs attach to a Transit Gateway. A spoke query for corp.example.com is forwarded by the shared rule through the central outbound endpoint and over Direct Connect to the on-premises DNS servers. The animation shares the Profile, then forwards one query and returns the answer.',
    wide: true, w: 960, h: 440, dur: 10,
    groups: [
      { kind: 'dc', x: 812, y: 230, w: 140, h: 150 },
      { kind: 'cloud', x: 8, y: 8, w: 730, h: 424 },
      { kind: 'region', x: 20, y: 34, w: 706, h: 390, label: 'Region' },
      { kind: 'acct', x: 32, y: 58, w: 204, h: 150, label: 'Spoke account A' },
      { kind: 'vpc', x: 44, y: 82, w: 180, h: 118, label: 'Spoke VPC', note: '10.1.0.0/16' },
      { kind: 'acct', x: 32, y: 232, w: 204, h: 150, label: 'Spoke account B' },
      { kind: 'vpc', x: 44, y: 256, w: 180, h: 118, label: 'Spoke VPC', note: '10.2.0.0/16' },
      { kind: 'acct', x: 336, y: 58, w: 380, h: 324, label: 'Networking account' },
      { kind: 'gen', x: 348, y: 82, w: 356, h: 104, icon: R53, label: 'Route 53 Profile' },
      { kind: 'vpc', x: 348, y: 208, w: 356, h: 162, label: 'Hub VPC', note: '10.0.0.0/16' },
    ],
    nodes: [ec2a, resa, ec2b, resb, ram, tgw, rule, phz, fwg, att, ob, ib, dx, dns],
    wires: [
      { id: 'sa', d: P(L(ram, 6), [244, 78], [244, 100], [226, 100]), dashed: true },
      { id: 'sb', d: P(L(ram, -6), [244, 66], [244, 270], [226, 270]), dashed: true },
      { id: 'sp', d: P(R(ram, 12), [346, 84]), dashed: true },
      { id: 'e', d: P(R(ec2a), L(resa)) },
      { id: 'eb', d: P(R(ec2b), L(resb)) },
      { id: 'q', d: P(R(resa), L(rule)), dashed: true },
      { id: 'qr', d: P(B(rule), [400, 196], [488, 196], T(ob)) },
      { id: 'qe', d: P(L(ob), R(att)), both: true },
      { id: 'th', d: P(R(tgw), [322, 220], [322, 288], L(att)), both: true },
      { id: 'tx', d: P(B(tgw), [284, 404], [772, 404], B(dx)), both: true },
      { id: 'xd', d: P(R(dx), L(dns)), both: true },
      { id: 'aa', d: P([210, 200], [210, 220], L(tgw)), both: true },
      { id: 'ab', d: P([210, 256], [210, 220], L(tgw)), both: true },
      { id: 'ib', d: P(B(ib), [596, 340], [396, 340], B(att)), dashed: true, both: true, label: 'on-premises queries', labelAt: 0.5, labelDy: 12 },
    ],
    steps: [
      { n: 1, at: 'sb', f: 0.12, dy: -11, text: 'The networking account shares the Route 53 Profile, holding the forwarding rule, private hosted zone and DNS Firewall rule group, with the spoke accounts through AWS RAM.' },
      { n: 2, at: 'e', f: 0.5, dy: -11, text: 'An instance in spoke account A queries the Route 53 VPC Resolver in its VPC for a name in corp.example.com.' },
      { n: 3, at: 'q', f: 0.6, dy: 12, text: 'The Resolver matches the forwarding rule for corp.example.com, which the Profile applies to the spoke VPC.' },
      { n: 4, at: 'qr', f: 0.88, dx: 11, dy: 0, text: 'The rule sends the query out of the outbound endpoint in the hub VPC, through the TGW attachment to AWS Transit Gateway.' },
      { n: 5, at: 'tx', f: 0.62, dy: -11, text: 'AWS Transit Gateway carries the query over AWS Direct Connect to the on-premises DNS servers, and the answer returns the same way to the instance.' },
    ],
        timeline: [
      { wire: 'sb', t: [0.03, 0.12], kind: 'pk-2' }, { wire: 'sa', t: [0.03, 0.12], kind: 'pk-2' },
      ...seq(0.2, 0.048, [
        fw('e', { ring: 'resa' }), fw('q', { ring: 'rule' }), fw('qr', { ring: 'ob' }), fw('qe', { ring: 'att' }),
        rv('th', { ring: 'tgw' }), fw('tx', { ring: 'dx' }), fw('xd', { ring: 'dns' }),
        { wire: 'xd', reverse: true, kind: 'pk-2', ring: 'dx' }, { wire: 'tx', reverse: true, kind: 'pk-2', ring: 'tgw' },
        { wire: 'th', kind: 'pk-2', ring: 'att' }, bk('qe', { ring: 'ob' }), bk('qr', { ring: 'rule' }),
        bk('q', { ring: 'resa' }), bk('e', { ring: 'ec2a' }),
      ], 0.004),
    ],
    notes: [...lg.notes],
    extra: lg.extra,
  };
})();

// ---------------------------------------------------------------------------------------------
// dns-firewall: Route 53 Resolver DNS Firewall
// ---------------------------------------------------------------------------------------------
const firewall = (() => {
  const ec2 = nd('ec2', EC2, 92, 96, 'Amazon EC2');
  const res = nd('res', RES, 92, 180, 'Route 53 VPC Resolver', { wrap: 12, sub: '10.0.0.2' });
  const fw_ = nd('fw', DNSFW, 224, 180, 'DNS Firewall rule group', { wrap: 14, sub: 'block list' });
  const ql = nd('ql', QLOG, 204, 92, 'Resolver query logging', { wrap: 14 });
  const cwl = nd('cwl', CWL, 306, 62, 'Amazon CloudWatch Logs', { size: 32, wrap: 16 });
  const s3 = nd('s3', S3B, 306, 122, 'Amazon S3 bucket', { size: 32, wrap: 22 });
  const hz = nd('hz', HZ, 424, 180, 'Public hosted zone', { wrap: 14, sub: 'example.com' });
  return {
    id: 'dns-firewall',
    name: 'Route 53 Resolver DNS Firewall',
    desc: 'A DNS Firewall rule group with a block list is associated with the VPC, so the Route 53 VPC Resolver checks every query from the instance against it. A good domain matches no rule and resolves normally; a domain on the block list is answered with NXDOMAIN. Resolver query logging sends every query and firewall action to CloudWatch Logs and Amazon S3. The animation sends a good query, then a blocked one, and logs both.',
    w: 480, h: 292, dur: 10,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 464, h: 276 },
      { kind: 'region', x: 20, y: 34, w: 336, h: 242, label: 'us-east-1' },
      { kind: 'vpc', x: 32, y: 58, w: 120, h: 198, label: 'VPC' },
    ],
    nodes: [ec2, res, fw_, ql, cwl, s3, hz],
    wires: [
      { id: 'q', d: P(B(ec2), T(res)), both: true },
      { id: 'rf', d: P(R(res), L(fw_)), both: true },
      { id: 'fh', d: P(R(fw_), L(hz)), both: true, label: 'no match: resolve', labelAt: 0.32 },
      { id: 'rl', d: P(R(res, -10), [166, 170], [166, 92], L(ql)), dashed: true },
      { id: 'lc', d: P(R(ql, -6), [258, 86], [258, 62], L(cwl)), dashed: true },
      { id: 'ls', d: P(R(ql, 6), [258, 98], [258, 122], L(s3)), dashed: true },
    ],
    steps: [
      { n: 1, at: 'q', f: 0.5, dx: 11, dy: 0, text: 'The instance sends a DNS query to the Route 53 VPC Resolver at 10.0.0.2.' },
      { n: 2, at: 'rf', f: 0.5, dy: -11, text: 'The Resolver checks the query against the DNS Firewall rule group associated with the VPC. A domain on the block list, malware.example.net, gets NXDOMAIN.' },
      { n: 3, at: 'fh', f: 0.62, dy: -11, text: 'The Resolver resolves good.example.com, which matches no rule, from the public hosted zone. Resolver query logging sends each query and action to CloudWatch Logs and Amazon S3.' },
    ],
        timeline: [
      // good.example.com: no rule matches, resolved
      ...seq(0.02, 0.045, [
        fw('q', { ring: 'res' }), fw('rf', { ring: 'fw' }), fw('fh', { ring: 'hz' }),
        bk('fh', { ring: 'fw' }), bk('rf', { ring: 'res' }), bk('q', { ring: 'ec2' }),
      ], 0.004),
      ...seq(0.33, 0.035, [{ wire: 'rl', kind: 'pk-2', ring: 'ql' }, { wire: 'lc', kind: 'pk-2', ring: 'cwl' }, { wire: 'ls', kind: 'pk-2', ring: 's3' }], 0.004),
      // malware.example.net: matches the block list, NXDOMAIN
      ...seq(0.5, 0.05, [
        fw('q', { ring: 'res' }), fw('rf', { ring: 'fw' }),
        { wire: 'rf', reverse: true, kind: 'pk-bad', ring: 'res' }, { wire: 'q', reverse: true, kind: 'pk-bad', ring: 'ec2' },
      ], 0.004),
      ...seq(0.73, 0.035, [{ wire: 'rl', kind: 'pk-2', ring: 'ql' }, { wire: 'lc', kind: 'pk-2', ring: 'cwl' }, { wire: 'ls', kind: 'pk-2', ring: 's3' }], 0.004),
    ],
    effects: [{ fade: 'fh', t: [0.5, 0.99] }],
    notes: [
      { x: 168, y: 254, text: 'good.example.com: no rule matches,\nresolved to 203.0.113.10', anchor: 'start', t: [0.02, 0.48] },
      { x: 168, y: 254, text: 'malware.example.net: on the block list,\nanswered with NXDOMAIN', anchor: 'start', kind: 'warn', t: [0.5, 0.99] },
    ],
  };
})();

// ---------------------------------------------------------------------------------------------
// dns-dnssec: DNSSEC signing for a public hosted zone and the chain of trust
// ---------------------------------------------------------------------------------------------
const dnssec = (() => {
  const root = nd('root', SERVER, 48, 80, 'Root zone', { wrap: 12, sub: 'trust anchor' });
  const com = nd('com', SERVER, 160, 80, '.com zone', { wrap: 12, sub: 'holds DS record' });
  const hz = nd('hz', HZ, 330, 80, 'Public hosted zone', { wrap: 20, sub: 'example.com, signed' });
  const kms = nd('kms', KMS, 424, 80, 'AWS KMS', { wrap: 12, sub: 'KSK key' });
  const users = nd('users', USERS, 48, 226, 'Users', { size: 36 });
  const res = nd('res', SERVER, 160, 226, 'Validating resolver', { wrap: 10, sub: 'DNSSEC aware' });
  return {
    id: 'dns-dnssec',
    name: 'DNSSEC signing and chain of trust',
    desc: 'Route 53 signs the public hosted zone with a key signing key backed by an asymmetric AWS KMS key in us-east-1 and a zone signing key that Route 53 manages. The DS record in the parent .com zone links the zone to the chain of trust, so a validating resolver checks the answer from the root trust anchor down. The animation signs the zone, resolves and validates one query.',
    w: 480, h: 292, dur: 10,
    groups: [
      { kind: 'cloud', x: 236, y: 24, w: 236, h: 138 },
      { kind: 'region', x: 384, y: 44, w: 80, h: 108, label: 'us-east-1' },
    ],
    nodes: [root, com, hz, kms, users, res],
    wires: [
      { id: 'ch1', d: P(R(root), L(com)), dashed: true, label: 'DS .com', labelAt: 0.5 },
      { id: 'ch2', d: P(R(com), L(hz)), dashed: true, label: 'DS example.com', labelAt: 0.715 },
      { id: 'sg', d: P(R(hz), L(kms)), both: true, label: 'signs', labelAt: 0.22 },
      { id: 'u', d: P(R(users), L(res)), both: true },
      { id: 'v1', d: P(T(res), B(com)), both: true, label: 'DS lookup', labelAt: 0.5, labelAnchor: 'start', labelDx: 8, labelDy: 3 },
      { id: 'v2', d: P(R(res), [330, 226], B(hz)), both: true, label: 'DNSKEY, A, RRSIG', labelAt: 0.3 },
    ],
    steps: [
      { n: 1, at: 'sg', f: 0.5, dy: 12, text: 'Route 53 signs the zone: a key signing key backed by an asymmetric AWS KMS key in us-east-1 signs the DNSKEY records, and a Route 53 managed zone signing key signs the rest.' },
      { n: 2, at: 'u', f: 0.5, dy: -11, text: 'Users send a query for example.com to a validating resolver, which asks for the DNSSEC records along with the answer.' },
      { n: 3, at: 'v1', f: 0.5, dx: -11, dy: 0, text: 'The resolver fetches the DS record for example.com from the .com zone. It holds a hash of the zone KSK and chains through .com to the root trust anchor.' },
      { n: 4, at: 'v2', f: 0.55, dy: -11, text: 'The resolver gets the DNSKEY, A and RRSIG records from the hosted zone, validates them against the DS record, and sets the AD flag when the chain checks out.' },
    ],
        timeline: [
      // sign the zone: Route 53 calls KMS to sign with the KSK
      ...seq(0.03, 0.08, [{ wire: 'sg', kind: 'pk-2', ring: 'kms' }, { wire: 'sg', reverse: true, kind: 'pk-2', ring: 'hz' }], 0.01),
      // resolve and validate
      ...seq(0.26, 0.075, [fw('u', { ring: 'res' }), fw('v1', { ring: 'com' }), bk('v1', { ring: 'res' }), fw('v2', { ring: 'hz' }), bk('v2', { ring: 'res' }), bk('u', { ring: 'users' })], 0.01),
    ],
    effects: [{ glow: 'ch1', t: [0.675, 0.98] }, { glow: 'ch2', t: [0.675, 0.98] }],
    notes: [
      { x: 190, y: 196, text: 'Chain validated: AD flag set', kind: 'label', anchor: 'start', t: [0.675, 0.98] },
      { x: 236, y: 250, text: 'KSK: asymmetric KMS key in us-east-1', anchor: 'start' },
      { x: 236, y: 262, text: 'ZSK: managed by Route 53', anchor: 'start' },
      { x: 236, y: 274, text: 'DS record in .com holds the KSK hash', anchor: 'start' },
      { x: 236, y: 286, text: 'Validates root > .com > example.com', anchor: 'start' },
    ],
  };
})();

export default {
  section: { id: 'dns', title: 'ROUTE 53 & DNS' },
  diagrams: [resolution, weighted, geo, multivalue, privateZone, hybrid, sharedRules, firewall, dnssec],
};
