// VPC & hybrid networking family: vp-* diagrams. Build: node catalog/aws-kit/awd.mjs preview catalog/aws-kit/specs/vpc.mjs
// Authoring note: coordinates are computed with small helpers (node centers, edge ports, H/V paths) so every diagram sits on an
// explicit grid. Legends, CIDRs on group headers (group note), route captions (notes), blocked marks and red rings use the kit's
// primitives; no diagram needs `extra`.

// ---- icon ids ----
const IGW = 'aws-res-vpc-internet-gateway';
const NAT = 'aws-res-vpc-nat-gateway';
const ALB = 'aws-res-elastic-load-balancing-application-load-balancer';
const NLB = 'aws-res-elastic-load-balancing-network-load-balancer';
const EC2 = 'aws-res-ec2-instance';
const EC2S = 'aws-res-ec2-instances';
const RT = 'aws-res-route-53-route-table';
const PCX = 'aws-res-vpc-peering-connection';
const VPCE = 'aws-res-vpc-endpoints';
const ENI = 'aws-res-vpc-elastic-network-interface';
const TGW = 'aws-svc-transit-gateway';
const TGWA = 'aws-res-transit-gateway-attachment';
const S3 = 'aws-svc-simple-storage-service';
const DDB = 'aws-svc-dynamodb';
const SQS = 'aws-svc-simple-queue-service';
const RDS = 'aws-svc-rds';
const PL = 'aws-svc-privatelink';
const NFW_EP = 'aws-res-network-firewall-endpoints';
const CGW = 'aws-res-vpc-customer-gateway';
const DXGW = 'aws-res-direct-connect-gateway';
const DX = 'aws-svc-direct-connect';
const S2S = 'aws-svc-site-to-site-vpn';
const NET = 'aws-res-internet';

// ---- layout helpers (shared with the other specs: ../place.mjs) ----
import { wrapLines, lblH, R, L, T, B, Bi, P, centered } from '../place.mjs';
// node by CENTER (cx, cy); default 32px icon
const nd = centered(32);
// a caption in the group-note style (9px muted): route lines, protocol names
const sub = (x, y, text, anchor) => ({ x, y, text, size: 9, ...(anchor ? { anchor } : {}) });
// a caption on a group's bottom edge, right-aligned (the group note sits on the top edge only)
const foot = (g, text) => sub(g.x + g.w - 8, g.y + g.h - 8, text, 'end');
// the in-diagram key: swatch centers at (x, y), (x, y + 13)...
const legend = (x, y, ...items) => ({ x: x - 3.4, y: y + 3.4, items: items.map(([kind, label]) => ({ kind, label })) });
// rescale a timeline so its last window ends at `end` of the clock (keeps the idle tail short and every window ordered)
const fit = (tl, end = 0.93) => {
  const k = end / Math.max(...tl.map((e) => e.t[1]));
  const r = (n) => Math.round(n * k * 1000) / 1000;
  return tl.map((e) => ({ ...e, t: [r(e.t[0]), r(e.t[1])] }));
};

// ---------------------------------------------------------------------------------------------
// vp-standard: standard VPC across two AZs
// ---------------------------------------------------------------------------------------------
const standard = (() => {
  const AZA = { x: 120, y: 158, w: 378, h: 234 }, AZB = { x: 538, y: 158, w: 378, h: 234 };
  const PUBA = { x: 132, y: 180, w: 354, h: 98 }, PUBB = { x: 550, y: 180, w: 354, h: 98 };
  const PRVA = { x: 132, y: 286, w: 354, h: 94 }, PRVB = { x: 550, y: 286, w: 354, h: 94 };
  const VPC = { x: 108, y: 60, w: 820, h: 340 };
  const nodes = [
    { id: 'net', icon: NET, x: 12, y: 72, label: 'Internet' },
    { id: 'igw', icon: IGW, x: 498, y: 80, label: 'Internet gateway', wrap: 20 },
    // AZ A
    nd('rta1', RT, 182, 224, 'Route table', { sub: '0.0.0.0/0 > igw' }),
    nd('nata', NAT, 262, 224, 'NAT gateway'),
    nd('alba', ALB, 346, 224, 'Application Load Balancer'),
    nd('rta2', RT, 182, 330, 'Route table', { sub: '0.0.0.0/0 > nat' }),
    nd('eca', EC2, 262, 330, 'Amazon EC2'),
    // AZ B (mirrored about x=518)
    nd('albb', ALB, 690, 224, 'Application Load Balancer'),
    nd('natb', NAT, 774, 224, 'NAT gateway'),
    nd('rtb1', RT, 854, 224, 'Route table', { sub: '0.0.0.0/0 > igw' }),
    nd('ecb', EC2, 774, 330, 'Amazon EC2'),
    nd('rtb2', RT, 854, 330, 'Route table', { sub: '0.0.0.0/0 > nat' }),
  ];
  return {
    id: 'vp-standard',
    name: 'Standard VPC across two AZs',
    desc: 'A 10.0.0.0/16 VPC with a public and a private subnet in each of two Availability Zones. Inbound requests (orange) enter through the internet gateway and the load balancer to the private instances; outbound requests (blue) leave through the NAT gateway in the same AZ and then the internet gateway.',
    wide: true, w: 960, h: 424, dur: 10,
    groups: [
      { kind: 'cloud', x: 84, y: 8, w: 868, h: 408 },
      { kind: 'region', x: 96, y: 34, w: 844, h: 374, label: 'Region' },
      { kind: 'vpc', ...VPC, label: 'VPC', note: '10.0.0.0/16' },
      { kind: 'az', ...AZA, label: 'Availability Zone A' },
      { kind: 'az', ...AZB, label: 'Availability Zone B' },
      { kind: 'pub', ...PUBA, label: 'Public subnet', note: '10.0.0.0/24' },
      { kind: 'priv', ...PRVA, label: 'Private subnet', note: '10.0.10.0/24' },
      { kind: 'pub', ...PUBB, label: 'Public subnet', note: '10.0.1.0/24' },
      { kind: 'priv', ...PRVB, label: 'Private subnet', note: '10.0.11.0/24' },
    ],
    nodes,
    wires: [
      { id: 'net', d: 'M56,92 H494', both: true },
      { id: 'in0', d: 'M518,138 V148', arrow: false },
      { id: 'in1a', d: P([518, 148], [346, 148], T(nodes[4])) },
      { id: 'in1b', d: P([518, 148], [690, 148], T(nodes[7])) },
      { id: 'in2a', d: P(B(nodes[4]), [346, 338], R(nodes[6], 8)) },
      { id: 'in2b', d: P(B(nodes[7]), [690, 338], L(nodes[10], 8)) },
      { id: 'o1a', d: P(R(nodes[6], -8), [304, 322], [304, 232], R(nodes[3], 8)) },
      { id: 'o1b', d: P(L(nodes[10], -8), [732, 322], [732, 232], L(nodes[8], 8)) },
      { id: 'o2a', d: P(T(nodes[3]), [262, 108], [494, 108]) },
      { id: 'o2b', d: P(T(nodes[8]), [774, 108], [542, 108]) },
    ],
    steps: [
      { n: 1, at: 'net', f: 0.35, text: 'Inbound requests from the internet enter the VPC through the internet gateway.' },
      { n: 2, at: 'in1a', f: 0.4, text: 'The internet gateway delivers them to the Application Load Balancer, which has a node in the public subnet of each Availability Zone.' },
      { n: 3, at: 'in2a', f: 0.28, dx: 11, dy: 0, text: 'The load balancer forwards each request to Amazon EC2 instances in the private subnets.' },
      { n: 4, at: 'o1a', f: 0.3, dx: 11, dy: 0, text: 'The instances send outbound traffic by the private route table\'s default route to the NAT gateway in their own Availability Zone.' },
      { n: 5, at: 'o2a', f: 0.5, dy: 11, text: 'The NAT gateway translates the private source address and sends the traffic by the public route table\'s default route to the internet gateway.' },
      { n: 6, at: 'net', f: 0.62, text: 'The internet gateway sends the outbound traffic to the internet.' },
    ],
    timeline: fit([
      { wire: 'net', t: [0.04, 0.12], ring: 'igw' },
      { wire: 'in0', t: [0.13, 0.15] },
      { wire: 'in1a', t: [0.15, 0.23], ring: 'alba' },
      { wire: 'in1b', t: [0.15, 0.23], ring: 'albb' },
      { wire: 'in2a', t: [0.24, 0.32], ring: 'eca' },
      { wire: 'in2b', t: [0.24, 0.32], ring: 'ecb' },
      { wire: 'o1a', t: [0.45, 0.53], kind: 'pk-2', ring: 'nata' },
      { wire: 'o1b', t: [0.45, 0.53], kind: 'pk-2', ring: 'natb' },
      { wire: 'o2a', t: [0.54, 0.66], kind: 'pk-2', ring: 'igw' },
      { wire: 'o2b', t: [0.54, 0.66], kind: 'pk-2' },
      { wire: 'net', t: [0.67, 0.77], reverse: true, kind: 'pk-2', ring: 'net' },
    ], 0.93),
    legend: legend(16, 178, ['pk', 'Inbound'], ['pk-2', 'Outbound']),
  };
})();

// ---------------------------------------------------------------------------------------------
// vp-peering: VPC peering (non-transitive)
// ---------------------------------------------------------------------------------------------
const peering = (() => {
  const A = { x: 20, y: 38, w: 184, h: 98 }, C = { x: 20, y: 188, w: 184, h: 98 }, BV = { x: 276, y: 38, w: 184, h: 248 };
  const ea = nd('ea', EC2, 156, 84, 'Amazon EC2');
  const ra = nd('ra', RT, 80, 84, 'Route table', { sub: '10.1.0.0/16 > pcx-1' });
  const ec = nd('ec', EC2, 156, 236, 'Amazon EC2');
  const rc = nd('rc', RT, 80, 236, 'Route table', { sub: '10.1.0.0/16 > pcx-2' });
  const p1 = nd('p1', PCX, 240, 84, 'Peering connection', { sub: 'pcx-1' });
  const p2 = nd('p2', PCX, 240, 236, 'Peering connection', { sub: 'pcx-2' });
  const eb = nd('eb', EC2, 338, 161, 'Amazon EC2');
  const rb = nd('rb', RT, 410, 161, 'Route table', { sub: '10.0.0.0/16 > pcx-1' });
  return {
    id: 'vp-peering',
    name: 'VPC peering',
    desc: 'VPC A and VPC B are peered, and each route table sends the other VPC\'s CIDR to the peering connection, so requests (orange) and responses (blue) cross it privately. VPC C peers only with B, so traffic from A to C is not forwarded through B (red): peering is not transitive.',
    w: 480, h: 300, dur: 8,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 464, h: 286 },
      { kind: 'vpc', ...A, label: 'VPC A', note: '10.0.0.0/16' },
      { kind: 'vpc', ...C, label: 'VPC C', note: '10.2.0.0/16' },
      { kind: 'vpc', ...BV, label: 'VPC B', note: '10.1.0.0/16' },
    ],
    nodes: [ea, ra, ec, rc, p1, p2, eb, rb],
    wires: [
      { id: 'w1a', d: P(R(ea), L(p1)), both: true },
      { id: 'w1b', d: P(R(p1), [296, 84], [296, 153], L(eb, -8)), both: true },
      { id: 'w2a', d: P(R(ec), L(p2)), both: true },
      { id: 'w2b', d: P(R(p2), [296, 236], [296, 169], L(eb, 8)), both: true },
      { id: 'bl1', d: 'M112,140 V153', hot: true, dashed: true, arrow: false },
      { id: 'bl2', d: 'M112,171 V184', hot: true, dashed: true, arrow: false },
    ],
    steps: [
      { n: 1, at: 'w1a', f: 0.3, dy: -12, text: 'An Amazon EC2 instance in VPC A sends traffic for 10.1.0.0/16, which its route table sends to peering connection pcx-1.' },
      { n: 2, at: 'w1b', f: 0.45, dx: 11, dy: 0, text: 'The traffic crosses pcx-1 privately to the instance in VPC B, whose route for 10.0.0.0/16 returns the response over the same connection.' },
      { n: 3, at: 'w2a', f: 0.3, dy: -12, text: 'An instance in VPC C reaches VPC B over its own peering connection: its route table sends 10.1.0.0/16 to pcx-2, and VPC B routes 10.2.0.0/16 back over pcx-2.' },
      { n: 4, at: 'bl1', f: 0.5, dx: -11, dy: 0, text: 'VPC B does not forward traffic from VPC A to VPC C, because peering is not transitive: VPC A and VPC C would need a peering connection of their own.' },
    ],
    timeline: fit([
      { wire: 'w1a', t: [0.04, 0.11] },
      { wire: 'w1b', t: [0.11, 0.2], ring: 'eb' },
      { wire: 'w1b', t: [0.25, 0.34], reverse: true, kind: 'pk-2' },
      { wire: 'w1a', t: [0.34, 0.41], reverse: true, kind: 'pk-2', ring: 'ea' },
      { wire: 'w2a', t: [0.47, 0.54] },
      { wire: 'w2b', t: [0.54, 0.63], ring: 'eb' },
      { wire: 'w1a', t: [0.68, 0.74], kind: 'pk-bad' },
      // the A-to-C attempt dies at VPC B: a red ring when it arrives
      { wire: 'w1b', t: [0.74, 0.82], kind: 'pk-bad', ring: 'eb' },
    ], 0.86),
    marks: [{ x: 112, y: 162 }],
    notes: [
      sub(410, 211, '10.2.0.0/16 > pcx-2'),   // the second route of VPC B's route table
      { x: 124, y: 160, text: 'No transitive\npeering', kind: 'warn', anchor: 'start', size: 8.5 },
      { x: 324, y: 228, text: 'A to C is not\nforwarded by B', kind: 'warn', anchor: 'start', size: 8.5, t: [0.86, 0.985] },
    ],
  };
})();

// ---------------------------------------------------------------------------------------------
// vp-endpoints: gateway endpoint (S3/DynamoDB) + interface endpoints (AWS PrivateLink)
// ---------------------------------------------------------------------------------------------
const endpoints = (() => {
  const VPCg = { x: 32, y: 60, w: 272, h: 218 };
  const SUB = { x: 44, y: 84, w: 178, h: 186 };
  const ec2 = nd('ec2', EC2, 84, 130, 'Amazon EC2');
  const rt = nd('rt', RT, 162, 130, 'Route table', { sub: 'prefix lists > vpce' });
  const gw = nd('gw', VPCE, 262, 130, 'Gateway endpoints');
  const eni = nd('eni', VPCE, 84, 218, 'Interface endpoint');
  const pl = nd('pl', PL, 346, 218, 'AWS PrivateLink');
  const s3 = nd('s3', S3, 418, 72, 'Amazon S3', { size: 36 });
  const ddb = nd('ddb', DDB, 418, 130, 'Amazon DynamoDB', { size: 36 });
  const sqs = nd('sqs', SQS, 418, 218, 'Amazon SQS', { size: 36 });
  return {
    id: 'vp-endpoints',
    name: 'VPC endpoints',
    desc: 'A private subnet reaches AWS services without an internet gateway or NAT gateway. S3 and DynamoDB traffic follows route-table entries to gateway endpoints (orange); other services such as Amazon SQS are reached through an interface endpoint, a network interface powered by AWS PrivateLink (blue).',
    w: 480, h: 300, dur: 8,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 464, h: 286 },
      { kind: 'region', x: 20, y: 34, w: 440, h: 254, label: 'Region' },
      { kind: 'vpc', ...VPCg, label: 'VPC 10.0.0.0/16' },
      { kind: 'priv', ...SUB, label: 'Private subnet 10.0.1.0/24' },
    ],
    nodes: [ec2, rt, gw, eni, pl, s3, ddb, sqs],
    wires: [
      { id: 'e1', d: P(R(ec2), L(rt)), dashed: true },
      { id: 'e2', d: P(R(rt), L(gw)) },
      { id: 'e3', d: P(T(gw), [262, 72], L(s3)) },
      { id: 'e4', d: P(R(gw), L(ddb)) },
      { id: 'i1', d: P(B(ec2, 0, 8), T(eni)) },
      { id: 'i2', d: P(R(eni), L(pl)) },
      { id: 'i3', d: P(R(pl), L(sqs)) },
    ],
    steps: [
      { n: 1, at: 'e1', f: 0.5, text: 'Traffic from the Amazon EC2 instance to Amazon S3 or DynamoDB matches the service prefix lists in the subnet route table.' },
      { n: 2, at: 'e3', f: 0.72, dy: 11, text: 'The route table sends it to the gateway endpoints, which deliver it to Amazon S3 and Amazon DynamoDB without an internet gateway or NAT gateway.' },
      { n: 3, at: 'i1', f: 0.5, dx: 11, dy: 0, text: 'For other services, the instance sends traffic to an interface endpoint, a network interface with a private IP address in the subnet.' },
      { n: 4, at: 'i3', f: 0.5, text: 'AWS PrivateLink carries the traffic from the interface endpoint to Amazon SQS over the AWS network.' },
    ],
    timeline: fit([
      { wire: 'e1', t: [0.04, 0.09] },
      { wire: 'e2', t: [0.09, 0.16], ring: 'gw' },
      { wire: 'e3', t: [0.16, 0.26], ring: 's3' },
      { wire: 'e4', t: [0.16, 0.26], ring: 'ddb' },
      { wire: 'i1', t: [0.42, 0.49], kind: 'pk-2', ring: 'eni' },
      { wire: 'i2', t: [0.49, 0.62], kind: 'pk-2', ring: 'pl' },
      { wire: 'i3', t: [0.62, 0.7], kind: 'pk-2', ring: 'sqs' },
    ], 0.93),
    // in the Region header band, right of the VPC (the kit legend stacks its rows)
    legend: legend(316, 42, ['pk', 'Gateway endpoints path'], ['pk-2', 'PrivateLink path']),
  };
})();

// ---------------------------------------------------------------------------------------------
// vp-privatelink: endpoint service (NLB) in a provider account, interface endpoint in a consumer account
// ---------------------------------------------------------------------------------------------
const privatelink = (() => {
  const CA = { x: 16, y: 34, w: 164, h: 194 }, PA = { x: 262, y: 34, w: 200, h: 194 };
  const CV = { x: 24, y: 58, w: 148, h: 162 }, PV = { x: 270, y: 58, w: 184, h: 162 };
  const CS = { x: 32, y: 82, w: 132, h: 130 }, PS = { x: 278, y: 82, w: 168, h: 130 };
  const ecc = nd('ecc', EC2, 72, 138, 'Amazon EC2');
  const eni = nd('eni', VPCE, 136, 138, 'Interface endpoint');
  const pl = nd('pl', PL, 220, 138, 'AWS PrivateLink', { size: 40 });
  const nlb = nd('nlb', NLB, 322, 138, 'Network Load Balancer', { sub: 'endpoint service' });
  const t1 = nd('t1', EC2, 408, 114, 'Amazon EC2');
  const t2 = nd('t2', EC2, 408, 172, 'Amazon EC2');
  return {
    id: 'vp-privatelink',
    name: 'AWS PrivateLink service',
    desc: 'A provider exposes a service behind a Network Load Balancer as a VPC endpoint service. A consumer VPC in another account creates an interface endpoint, so requests (orange) reach the load balancer and its targets over the AWS network and responses (blue) return the same way, with no peering, internet gateway or NAT.',
    w: 480, h: 244, dur: 8,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 464, h: 228 },
      { kind: 'acct', ...CA, label: 'Service consumer account' },
      { kind: 'acct', ...PA, label: 'Service provider account' },
      { kind: 'vpc', ...CV, label: 'VPC 10.0.0.0/16' },
      { kind: 'vpc', ...PV, label: 'VPC 10.1.0.0/16' },
      { kind: 'priv', ...CS, label: 'Private subnet' },
      { kind: 'priv', ...PS, label: 'Private subnet' },
    ],
    nodes: [ecc, eni, pl, nlb, t1, t2],
    wires: [
      { id: 'a', d: P(R(ecc), L(eni)), both: true },
      { id: 'b', d: P(R(eni), L(pl)), both: true },
      { id: 'c', d: P(R(pl), L(nlb)), both: true },
      { id: 'd1', d: P(R(nlb, -6), [366, 132], [366, 114], L(t1)), both: true },
      { id: 'd2', d: P(R(nlb, 6), [366, 144], [366, 172], L(t2)), both: true },
    ],
    steps: [
      { n: 1, at: 'a', f: 0.5, text: 'An Amazon EC2 instance in the consumer VPC sends a request to the interface endpoint in its subnet.' },
      { n: 2, x: 220, y: 104, text: 'AWS PrivateLink carries the request over the AWS network to the provider\'s endpoint service in another account.' },
      { n: 3, at: 'd1', f: 0.55, dx: -11, dy: 0, text: 'The Network Load Balancer forwards the request to its EC2 targets, and the response returns the same way, with no peering, internet gateway or NAT.' },
    ],
    timeline: fit([
      { wire: 'a', t: [0.04, 0.1] },
      { wire: 'b', t: [0.1, 0.17], ring: 'eni' },
      { wire: 'c', t: [0.17, 0.26], ring: 'pl' },
      { wire: 'd1', t: [0.26, 0.34], ring: 't1' },
      { wire: 'd2', t: [0.26, 0.34], ring: 't2' },
      { wire: 'd1', t: [0.5, 0.58], reverse: true, kind: 'pk-2', ring: 'nlb' },
      { wire: 'd2', t: [0.5, 0.58], reverse: true, kind: 'pk-2' },
      { wire: 'c', t: [0.58, 0.67], reverse: true, kind: 'pk-2', ring: 'pl' },
      { wire: 'b', t: [0.67, 0.74], reverse: true, kind: 'pk-2', ring: 'eni' },
      { wire: 'a', t: [0.74, 0.8], reverse: true, kind: 'pk-2', ring: 'ecc' },
    ], 0.93),
  };
})();

// ---------------------------------------------------------------------------------------------
// vp-shared: Shared VPC through AWS Resource Access Manager
// ---------------------------------------------------------------------------------------------
const shared = (() => {
  const NA = { x: 88, y: 34, w: 304, h: 234 };
  const V = { x: 100, y: 134, w: 280, h: 126 };
  const S1 = { x: 112, y: 158, w: 124, h: 94 }, S2 = { x: 244, y: 158, w: 124, h: 94 };
  const ram = nd('ram', 'aws-svc-resource-access-manager', 240, 80, 'AWS Resource Access Manager', { size: 40 });
  const wa = nd('wa', 'aws-res-organizations-account', 48, 198, 'Workload account A', { size: 40 });
  const wb = nd('wb', 'aws-res-organizations-account', 432, 198, 'Workload account B', { size: 40 });
  const eca = nd('eca', EC2, 174, 198, 'Amazon EC2', { sub: 'Account A' });
  const ecb = nd('ecb', EC2, 306, 198, 'Amazon EC2', { sub: 'Account B' });
  return {
    id: 'vp-shared',
    name: 'Shared VPC with AWS RAM',
    desc: 'A network account owns the VPC and shares two subnets with workload accounts through AWS Resource Access Manager (dashed). Each workload account then launches its own instances into a shared subnet (orange), and instances from both accounts talk over the VPC local route (blue).',
    w: 480, h: 284, dur: 8,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 464, h: 268 },
      { kind: 'acct', ...NA, label: 'Network account (VPC owner)' },
      { kind: 'vpc', ...V, label: 'VPC 10.0.0.0/16', note: 'local route: 10.0.0.0/16' },
      { kind: 'priv', ...S1, label: 'Shared subnet' },
      { kind: 'priv', ...S2, label: 'Shared subnet' },
    ],
    nodes: [ram, wa, wb, eca, ecb],
    wires: [
      { id: 'sa', d: P(L(ram), [48, 80], T(wa)), dashed: true, label: 'share subnets', labelAt: 0.3 },
      { id: 'sb', d: P(R(ram), [432, 80], T(wb)), dashed: true, label: 'share subnets', labelAt: 0.3 },
      { id: 'la', d: P(R(wa), L(eca)) },
      { id: 'lb', d: P(L(wb), R(ecb)) },
      { id: 'ab', d: P(R(eca), L(ecb)), both: true },
    ],
    steps: [
      { n: 1, at: 'sa', f: 0.4, dy: 11, text: 'The network account shares two subnets of its VPC with workload accounts A and B through AWS Resource Access Manager.' },
      { n: 2, at: 'la', f: 0.84, dy: -11, text: 'Each workload account launches its own Amazon EC2 instances into a shared subnet, while the network account keeps ownership of the VPC.' },
      { n: 3, at: 'ab', f: 0.23, dy: 11, text: 'Instances from both accounts communicate over the VPC local route for 10.0.0.0/16, with no peering needed.' },
    ],
    timeline: fit([
      { wire: 'sa', t: [0.04, 0.16], kind: 'pk-2', ring: 'wa' },
      { wire: 'sb', t: [0.04, 0.16], kind: 'pk-2', ring: 'wb' },
      { wire: 'la', t: [0.22, 0.32], ring: 'eca' },
      { wire: 'lb', t: [0.22, 0.32], ring: 'ecb' },
      { wire: 'ab', t: [0.42, 0.54], ring: 'ecb' },
      { wire: 'ab', t: [0.58, 0.7], reverse: true, kind: 'pk-2', ring: 'eca' },
    ], 0.93),
  };
})();

// ---------------------------------------------------------------------------------------------
// vp-client-vpn: AWS Client VPN
// ---------------------------------------------------------------------------------------------
const clientVpn = (() => {
  // the Client VPN endpoint is a Regional resource: it sits in the Region, outside the VPC, and reaches
  // the VPC through the network interface it creates in its associated subnet
  const V = { x: 212, y: 130, w: 236, h: 132 };
  const SUB = { x: 224, y: 154, w: 216, h: 100 };
  const cl = nd('cl', 'aws-res-client', 34, 198, 'Remote client', { size: 40, wrap: 8 });
  const idp = nd('idp', 'aws-svc-iam-identity-center', 160, 76, 'AWS IAM Identity Center', { size: 40, wrap: 16 });
  const ep = nd('ep', 'aws-svc-client-vpn', 160, 198, 'AWS Client VPN endpoint', { size: 40 });
  const eni = nd('eni', ENI, 266, 198, 'Network interface', { wrap: 16 });
  const ec2 = nd('ec2', EC2, 334, 198, 'Amazon EC2');
  const rds = nd('rds', RDS, 402, 198, 'Amazon RDS');
  return {
    id: 'vp-client-vpn',
    name: 'AWS Client VPN',
    desc: 'A remote client opens a TLS tunnel to the Client VPN endpoint (orange), a Regional resource that authenticates the user against an identity provider (blue) and then forwards traffic through its network interface in the associated subnet to private instances and databases.',
    w: 480, h: 284, dur: 8,
    groups: [
      { kind: 'cloud', x: 84, y: 8, w: 388, h: 270 },
      { kind: 'region', x: 96, y: 34, w: 364, h: 236, label: 'Region' },
      { kind: 'vpc', ...V, label: 'VPC', note: '10.0.0.0/16' },
      { kind: 'priv', ...SUB, label: 'Private subnet 10.0.1.0/24' },
    ],
    nodes: [cl, idp, ep, eni, ec2, rds],
    wires: [
      { id: 'tls', d: P(R(cl), L(ep)), both: true, label: 'TLS', labelAt: 0.1 },
      { id: 'auth', d: P(B(idp), T(ep)), dashed: true, both: true },
      { id: 'as', d: P(R(ep), L(eni)) },
      { id: 'ae', d: P(R(eni), L(ec2)) },
      { id: 'ad', d: P(R(ec2), L(rds)) },
    ],
    steps: [
      { n: 1, at: 'tls', f: 0.7, text: 'A remote client opens a TLS connection to the AWS Client VPN endpoint.' },
      { n: 2, at: 'auth', f: 0.5, dx: 11, dy: 0, text: 'The Client VPN endpoint authenticates the user through SAML federation with AWS IAM Identity Center.' },
      { n: 3, at: 'as', f: 0.23, dy: -12, text: 'The endpoint is associated with the subnet through a network interface it creates there, and forwards authorized traffic through it to the private Amazon EC2 instance and the Amazon RDS database.' },
    ],
    timeline: fit([
      { wire: 'tls', t: [0.04, 0.14], ring: 'ep' },
      { wire: 'auth', t: [0.17, 0.25], reverse: true, kind: 'pk-2', ring: 'idp' },
      { wire: 'auth', t: [0.27, 0.35], kind: 'pk-2', ring: 'ep' },
      { wire: 'as', t: [0.42, 0.5], ring: 'eni' },
      { wire: 'ae', t: [0.5, 0.57], ring: 'ec2' },
      { wire: 'ad', t: [0.57, 0.64], ring: 'rds' },
    ], 0.93),
    notes: [sub(ep.cx + 8, 170, 'SAML', 'start')],
  };
})();

// ---------------------------------------------------------------------------------------------
// vp-tgw: AWS Transit Gateway hub and spoke with a Site-to-Site VPN attachment
// ---------------------------------------------------------------------------------------------
const tgwHub = (() => {
  const DC = { x: 8, y: 120, w: 140, h: 184 };
  const VA = { x: 560, y: 50, w: 368, h: 100 }, VB = { x: 560, y: 162, w: 368, h: 100 }, VC = { x: 560, y: 274, w: 368, h: 100 };
  const srv = nd('srv', 'aws-res-servers', 78, 168, 'Servers', { size: 40 });
  const cgw = nd('cgw', CGW, 78, 252, 'Customer gateway');
  const vpn = nd('vpn', S2S, 322, 212, 'AWS Site-to-Site VPN', { size: 40, wrap: 16 });
  const tgw = nd('tgw', TGW, 450, 212, 'AWS Transit Gateway', { size: 48 });
  const trt = nd('trt', RT, 450, 306, 'TGW route table', { sub: 'propagated routes' });
  const aa = nd('aa', TGWA, 612, 100, 'TGW attachment', { sub: 'subnet per AZ' });
  const ab = nd('ab', TGWA, 612, 212, 'TGW attachment', { sub: 'subnet per AZ' });
  const ac = nd('ac', TGWA, 612, 324, 'TGW attachment', { sub: 'subnet per AZ' });
  const wa = nd('wa', EC2S, 780, 100, 'Amazon EC2 instances');
  const wb = nd('wb', EC2S, 780, 212, 'Amazon EC2 instances');
  const wc = nd('wc', 'aws-res-directory-service-managed-microsoft-ad', 780, 324, 'AWS Managed Microsoft AD');
  return {
    id: 'vp-tgw',
    name: 'Transit Gateway hub and spoke',
    desc: 'Three VPCs and an on-premises network attach to one AWS Transit Gateway, which routes between them with its route table. On-premises traffic (orange) crosses the Site-to-Site VPN to reach VPC B; VPC A reaches the shared services VPC C through the transit gateway (blue) with no VPC-to-VPC peering.',
    wide: true, w: 960, h: 408, dur: 10,
    groups: [
      { kind: 'dc', ...DC, label: 'Corporate data center' },
      { kind: 'cloud', x: 250, y: 8, w: 702, h: 392 },
      { kind: 'region', x: 262, y: 34, w: 678, h: 358, label: 'Region' },
      { kind: 'vpc', ...VA, label: 'Production VPC', note: '10.1.0.0/16' },
      { kind: 'vpc', ...VB, label: 'Development VPC', note: '10.2.0.0/16' },
      { kind: 'vpc', ...VC, label: 'Shared services VPC', note: '10.3.0.0/16' },
    ],
    nodes: [srv, cgw, vpn, tgw, trt, aa, ab, ac, wa, wb, wc],
    wires: [
      { id: 'w0', d: P(B(srv), T(cgw)) },
      { id: 'w1', d: P(R(cgw), [232, 252], [232, 212], L(vpn)), both: true, dashed: true, label: 'IPsec tunnels', labelAt: 0.37 },
      { id: 'w2', d: P(R(vpn), L(tgw)), both: true },
      { id: 'tA', d: P(R(tgw, -8), [520, 204], [520, 100], L(aa)), both: true },
      { id: 'tB', d: P(R(tgw), L(ab)), both: true },
      { id: 'tC', d: P(R(tgw, 8), [520, 220], [520, 324], L(ac)), both: true },
      { id: 'iA', d: P(R(aa), L(wa)), both: true },
      { id: 'iB', d: P(R(ab), L(wb)), both: true },
      { id: 'iC', d: P(R(ac), L(wc)), both: true },
      { id: 'rt', d: P(B(tgw), T(trt)), dashed: true, arrow: false },
    ],
    steps: [
      { n: 1, at: 'w1', f: 0.37, dy: 11, text: 'On-premises servers send traffic from the customer gateway over IPsec tunnels to AWS Site-to-Site VPN.' },
      { n: 2, at: 'w2', f: 0.5, text: 'The VPN connection is attached to AWS Transit Gateway, which routes the traffic with its route table of propagated routes.' },
      { n: 3, at: 'tB', f: 0.55, text: 'The transit gateway sends the traffic through the Development VPC attachment, which has a subnet in each AZ, to the EC2 instances.' },
      { n: 4, at: 'tA', f: 0.3, dx: -11, dy: 0, text: 'An instance in the Production VPC sends traffic through its attachment to the transit gateway.' },
      { n: 5, at: 'tC', f: 0.3, dx: -11, dy: 0, text: 'The transit gateway routes it to the Shared services VPC, which runs AWS Managed Microsoft AD, with no peering between the VPCs.' },
    ],
    timeline: fit([
      { wire: 'w0', t: [0.03, 0.07] },
      { wire: 'w1', t: [0.08, 0.17], ring: 'vpn' },
      { wire: 'w2', t: [0.18, 0.24], ring: 'tgw' },
      { wire: 'tB', t: [0.25, 0.31], ring: 'ab' },
      { wire: 'iB', t: [0.32, 0.37], ring: 'wb' },
      { wire: 'iA', t: [0.5, 0.55], reverse: true, kind: 'pk-2', ring: 'aa' },
      { wire: 'tA', t: [0.56, 0.62], reverse: true, kind: 'pk-2', ring: 'tgw' },
      { wire: 'tC', t: [0.63, 0.69], kind: 'pk-2', ring: 'ac' },
      { wire: 'iC', t: [0.7, 0.75], kind: 'pk-2', ring: 'wc' },
    ], 0.93),
    legend: legend(16, 336, ['pk', 'On-premises to VPC'], ['pk-2', 'VPC to VPC']),
  };
})();

// ---------------------------------------------------------------------------------------------
// vp-inspection: centralized inspection VPC (AWS Network Firewall) behind a Transit Gateway
// ---------------------------------------------------------------------------------------------
const inspection = (() => {
  const IV = { x: 330, y: 52, w: 524, h: 328 };
  const AZA = { x: 342, y: 76, w: 412, h: 142 }, AZB = { x: 342, y: 226, w: 412, h: 142 };
  const SA = { x: 32, y: 84, w: 164, h: 132 }, SB = { x: 32, y: 234, w: 164, h: 132 };
  const row = (y) => [
    { kind: 'priv', x: 354, y, w: 116, h: 112, label: 'TGW subnet' },
    { kind: 'priv', x: 486, y, w: 116, h: 112, label: 'Firewall subnet' },
    { kind: 'pub', x: 618, y, w: 124, h: 112, label: 'Public subnet' },
  ];
  const ea = nd('ea', EC2, 72, 150, 'Amazon EC2'), aa = nd('aa', TGWA, 146, 150, 'Attachment');
  const eb = nd('eb', EC2, 72, 300, 'Amazon EC2'), ab = nd('ab', TGWA, 146, 300, 'Attachment');
  const tgw = nd('tgw', TGW, 262, 225, 'AWS Transit Gateway', { size: 48 });
  // two TGW route tables, so no flow can skip the firewall: the spoke attachments look up the spoke
  // table (everything to the inspection VPC), the inspection attachment looks up the firewall table
  // (the spoke VPC routes)
  const srt = nd('srt', RT, 262, 78, 'Spoke route table', { wrap: 20, sub: '0.0.0.0/0 > inspection' });
  const frt = nd('frt', RT, 262, 314, 'Firewall route table', { wrap: 20, sub: '10.1.0.0/16 > spoke A' });
  const eia = nd('eia', TGWA, 412, 150, 'TGW attachment', { sub: 'appliance mode' }), fwa = nd('fwa', NFW_EP, 544, 150, 'Firewall endpoint'), nata = nd('nata', NAT, 680, 150, 'NAT gateway');
  const eib = nd('eib', TGWA, 412, 300, 'TGW attachment', { sub: 'appliance mode' }), fwb = nd('fwb', NFW_EP, 544, 300, 'Firewall endpoint'), natb = nd('natb', NAT, 680, 300, 'NAT gateway');
  const igw = nd('igw', IGW, 806, 225, 'Internet gateway', { size: 40 });
  const net = nd('net', NET, 920, 225, 'Internet', { size: 40 });
  return {
    id: 'vp-inspection',
    name: 'Centralized inspection with Network Firewall',
    desc: 'Spoke VPCs send traffic to the Transit Gateway, which hands it to an inspection VPC where an AWS Network Firewall endpoint in each AZ inspects it. Two transit gateway route tables keep every flow on that path: the spoke route table sends all spoke traffic to the inspection VPC, and the firewall route table returns inspected traffic to the spokes. East-west traffic (orange) is inspected and returned to the transit gateway for the other spoke; north-south traffic (blue) continues through a NAT gateway and the internet gateway.',
    wide: true, w: 960, h: 404, dur: 10,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 866, h: 388 },
      { kind: 'region', x: 20, y: 34, w: 842, h: 354, label: 'Region' },
      { kind: 'vpc', ...SA, label: 'Spoke VPC A', note: '10.1.0.0/16' },
      { kind: 'vpc', ...SB, label: 'Spoke VPC B', note: '10.2.0.0/16' },
      { kind: 'vpc', ...IV, label: 'Inspection VPC', note: '10.0.0.0/16' },
      { kind: 'az', ...AZA, label: 'Availability Zone A' },
      { kind: 'az', ...AZB, label: 'Availability Zone B' },
      ...row(98), ...row(248),
    ],
    nodes: [ea, aa, eb, ab, tgw, srt, frt, eia, fwa, nata, eib, fwb, natb, igw, net],
    wires: [
      { id: 'ia', d: P(R(ea), L(aa)), arrow: false },
      { id: 'ib', d: P(R(eb), L(ab)), arrow: false },
      { id: 'sa', d: P(R(aa), [220, 150], [220, 217], L(tgw, -8)), both: true },
      { id: 'sb', d: P(R(ab), [220, 300], [220, 233], L(tgw, 8)), both: true },
      { id: 'ta', d: P(R(tgw, -8), [310, 217], [310, 150], L(eia)), both: true },
      { id: 'tb', d: P(R(tgw, 8), [310, 233], [310, 300], L(eib)), both: true },
      { id: 'fa', d: P(R(eia), L(fwa)), both: true },
      { id: 'fb', d: P(R(eib), L(fwb)), both: true },
      { id: 'na', d: P(R(fwa), L(nata)) },
      { id: 'nb', d: P(R(fwb), L(natb)) },
      { id: 'ga', d: P(R(nata), [806, 150], T(igw)) },
      { id: 'gb', d: P(R(natb), [766, 300], [766, 225], L(igw)) },
      { id: 'gn', d: P(R(igw), L(net)), both: true },
      // the transit gateway's two route tables (the spoke table's line starts below its caption lines)
      { id: 'rts', d: P([262, 134], T(tgw)), dashed: true, arrow: false },
      { id: 'rtf', d: P(B(tgw), T(frt)), dashed: true, arrow: false },
    ],
    steps: [
      { n: 1, at: 'sa', f: 0.5, dx: 11, dy: 0, text: 'Spoke VPC A sends traffic by its default route through its attachment to AWS Transit Gateway. The spoke attachments are associated with the spoke route table, whose only route, 0.0.0.0/0, points to the inspection VPC attachment.' },
      { n: 2, at: 'fa', f: 0.5, text: 'The transit gateway sends the traffic to the inspection VPC. Appliance mode keeps each flow in one AZ, where the AWS Network Firewall endpoint inspects it.' },
      { n: 3, at: 'sb', f: 0.5, dx: -11, dy: 0, text: 'The firewall returns allowed traffic to the transit gateway. The inspection VPC attachment is associated with the firewall route table, which holds the spoke VPC routes, so the traffic goes on to Spoke VPC B; spoke-to-spoke traffic never bypasses the firewall.' },
      { n: 4, at: 'fb', f: 0.5, text: 'Internet-bound traffic from Spoke VPC B follows the same spoke route table to the inspection VPC, here to the firewall endpoint in Availability Zone B.' },
      { n: 5, at: 'gb', f: 0.5, dx: 11, dy: 0, text: 'Inspected traffic leaves through the NAT gateway in the public subnet and the internet gateway to the internet.' },
    ],
    timeline: fit([
      { wire: 'sa', t: [0.03, 0.075] },
      { ring: 'srt', t: [0.07, 0.075] },   // spoke attachment: the spoke route table sends it to inspection
      { wire: 'ta', t: [0.08, 0.125], ring: 'eia' },
      { wire: 'fa', t: [0.13, 0.175], ring: 'fwa' },
      { wire: 'fa', t: [0.18, 0.225], reverse: true, ring: 'eia' },
      { wire: 'ta', t: [0.23, 0.275], reverse: true, ring: 'tgw' },
      { ring: 'frt', t: [0.27, 0.275] },   // inspection attachment: the firewall route table sends it to spoke B
      { wire: 'sb', t: [0.28, 0.325], reverse: true, ring: 'ab' },
      { wire: 'sb', t: [0.42, 0.465], kind: 'pk-2' },
      { ring: 'srt', t: [0.46, 0.465], kind: 'pk-2' },
      { wire: 'tb', t: [0.47, 0.515], kind: 'pk-2', ring: 'eib' },
      { wire: 'fb', t: [0.52, 0.565], kind: 'pk-2', ring: 'fwb' },
      { wire: 'nb', t: [0.57, 0.615], kind: 'pk-2', ring: 'natb' },
      { wire: 'gb', t: [0.62, 0.665], kind: 'pk-2', ring: 'igw' },
      { wire: 'gn', t: [0.67, 0.73], kind: 'pk-2', ring: 'net' },
    ], 0.93),
    notes: [
      sub(262, 128, 'associated: spoke VPCs'),
      sub(262, 364, '10.2.0.0/16 > spoke B'), sub(262, 375, 'associated: inspection VPC'),
      foot(SA, '0.0.0.0/0 > tgw'), foot(SB, '0.0.0.0/0 > tgw'),
    ],
    legend: legend(886, 70, ['pk', 'East-west'], ['pk-2', 'North-south']),
  };
})();

// ---------------------------------------------------------------------------------------------
// vp-egress: centralized egress through NAT gateways in a shared egress VPC
// ---------------------------------------------------------------------------------------------
const egress = (() => {
  const SP = [{ x: 32, y: 56, w: 164, h: 100 }, { x: 32, y: 164, w: 164, h: 100 }, { x: 32, y: 272, w: 164, h: 100 }];
  const EV = { x: 380, y: 52, w: 470, h: 340 };
  const AZA = { x: 392, y: 76, w: 360, h: 148 }, AZB = { x: 392, y: 232, w: 360, h: 148 };
  const row = (y) => [
    { kind: 'priv', x: 404, y, w: 150, h: 116, label: 'TGW subnet' },
    { kind: 'pub', x: 574, y, w: 162, h: 116, label: 'Public subnet' },
  ];
  const ec = (i, cy) => nd('e' + i, EC2, 72, cy, 'Amazon EC2');
  const at = (i, cy) => nd('a' + i, TGWA, 146, cy, 'Attachment');
  const e1 = ec(1, 106), a1 = at(1, 106), e2 = ec(2, 214), a2 = at(2, 214), e3 = ec(3, 322), a3 = at(3, 322);
  const tgw = nd('tgw', TGW, 282, 214, 'AWS Transit Gateway', { size: 48 });
  // two TGW route tables (the AWS centralized egress pattern): the spoke attachments look up the spoke
  // table (default route to the egress VPC, 10.0.0.0/8 blackholed so spokes cannot reach each other
  // through the NAT gateways), the egress attachment looks up the egress table (the spoke routes)
  const srt = nd('srt', RT, 282, 76, 'Spoke route table', { wrap: 20, sub: '0.0.0.0/0 > egress VPC' });
  const ert = nd('ert', RT, 282, 306, 'Egress route table', { wrap: 20, sub: '10.1.0.0/16 > spoke A' });
  const ena = nd('ena', TGWA, 470, 150, 'TGW attachment'), nata = nd('nata', NAT, 655, 150, 'NAT gateway');
  const enb = nd('enb', TGWA, 470, 306, 'TGW attachment'), natb = nd('natb', NAT, 655, 306, 'NAT gateway');
  const igw = nd('igw', IGW, 816, 228, 'Internet gateway', { size: 40 });
  const net = nd('net', NET, 920, 228, 'Internet', { size: 40 });
  return {
    id: 'vp-egress',
    name: 'Centralized egress',
    desc: 'Spoke VPCs have no NAT gateways of their own: a default route sends internet-bound traffic to the Transit Gateway, whose spoke route table forwards it to an egress VPC with a NAT gateway in each AZ and one internet gateway, and blackholes 10.0.0.0/8 so spokes cannot reach each other. Outbound requests (orange) leave through the NAT gateways and responses (blue) return through the egress route table to each spoke.',
    wide: true, w: 960, h: 416, dur: 10,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 866, h: 400 },
      { kind: 'region', x: 20, y: 34, w: 842, h: 366, label: 'Region' },
      { kind: 'vpc', ...SP[0], label: 'Spoke VPC A', note: '10.1.0.0/16' },
      { kind: 'vpc', ...SP[1], label: 'Spoke VPC B', note: '10.2.0.0/16' },
      { kind: 'vpc', ...SP[2], label: 'Spoke VPC C', note: '10.3.0.0/16' },
      { kind: 'vpc', ...EV, label: 'Egress VPC', note: '10.0.0.0/16' },
      { kind: 'az', ...AZA, label: 'Availability Zone A' },
      { kind: 'az', ...AZB, label: 'Availability Zone B' },
      ...row(98), ...row(254),
    ],
    nodes: [e1, a1, e2, a2, e3, a3, tgw, srt, ert, ena, nata, enb, natb, igw, net],
    wires: [
      { id: 'i1', d: P(R(e1), L(a1)), arrow: false },
      { id: 'i2', d: P(R(e2), L(a2)), arrow: false },
      { id: 'i3', d: P(R(e3), L(a3)), arrow: false },
      { id: 's1', d: P(R(a1), [216, 106], [216, 200], L(tgw, -14)), both: true },
      { id: 's2', d: P(R(a2), L(tgw)), both: true },
      { id: 's3', d: P(R(a3), [216, 322], [216, 228], L(tgw, 14)), both: true },
      { id: 'ta', d: P(R(tgw, -14), [352, 200], [352, 150], L(ena)), both: true },
      { id: 'tb', d: P(R(tgw, 14), [352, 228], [352, 306], L(enb)), both: true },
      { id: 'na', d: P(R(ena), L(nata)), both: true },
      { id: 'nb', d: P(R(enb), L(natb)), both: true },
      { id: 'ga', d: P(R(nata), [816, 150], T(igw)), both: true },
      { id: 'gb', d: P(R(natb), [766, 306], [766, 228], L(igw)), both: true },
      { id: 'gn', d: P(R(igw), L(net)), both: true },
      // the transit gateway's two route tables (the spoke table's line starts below its caption lines)
      { id: 'rts', d: P([282, 142], T(tgw)), dashed: true, arrow: false },
      { id: 'rte', d: P(B(tgw), T(ert)), dashed: true, arrow: false },
    ],
    steps: [
      { n: 1, at: 's1', f: 0.6, dx: 11, dy: 0, text: 'Instances in the spoke VPCs send internet-bound traffic by the default route through their attachments to AWS Transit Gateway.' },
      { n: 2, at: 'ta', f: 0.5, dx: 11, dy: 0, text: 'The spoke attachments are associated with the spoke route table, which sends 0.0.0.0/0 to the egress VPC attachment (a TGW subnet in each Availability Zone) and blackholes 10.0.0.0/8, so spokes cannot reach each other through the egress VPC.' },
      { n: 3, at: 'na', f: 0.2, text: 'The TGW subnet route table sends the traffic to the NAT gateway in the same Availability Zone.' },
      { n: 4, at: 'ga', f: 0.75, text: 'The NAT gateway translates the source address and sends the traffic to the internet gateway. Its subnet routes 10.0.0.0/8 back to the transit gateway.' },
      { n: 5, at: 'gn', f: 0.8, text: 'The internet gateway sends the traffic to the internet. Responses return through the same NAT gateway to the transit gateway, where the egress VPC attachment is associated with the egress route table, whose propagated spoke routes lead back to each spoke.' },
    ],
    timeline: fit([
      { wire: 's1', t: [0.03, 0.08] }, { wire: 's3', t: [0.03, 0.08] },
      { ring: 'srt', t: [0.075, 0.08] },   // spoke attachments: the spoke route table sends it to the egress VPC
      { wire: 'ta', t: [0.09, 0.14], ring: 'ena' }, { wire: 'tb', t: [0.09, 0.14], ring: 'enb' },
      { wire: 'na', t: [0.15, 0.21], ring: 'nata' }, { wire: 'nb', t: [0.15, 0.21], ring: 'natb' },
      { wire: 'ga', t: [0.22, 0.28], ring: 'igw' }, { wire: 'gb', t: [0.22, 0.28] },
      { wire: 'gn', t: [0.29, 0.36], ring: 'net' },
      { wire: 'gn', t: [0.46, 0.53], reverse: true, kind: 'pk-2', ring: 'igw' },
      { wire: 'ga', t: [0.54, 0.6], reverse: true, kind: 'pk-2', ring: 'nata' }, { wire: 'gb', t: [0.54, 0.6], reverse: true, kind: 'pk-2', ring: 'natb' },
      { wire: 'na', t: [0.61, 0.67], reverse: true, kind: 'pk-2', ring: 'ena' }, { wire: 'nb', t: [0.61, 0.67], reverse: true, kind: 'pk-2', ring: 'enb' },
      { wire: 'ta', t: [0.68, 0.74], reverse: true, kind: 'pk-2', ring: 'tgw' }, { wire: 'tb', t: [0.68, 0.74], reverse: true, kind: 'pk-2' },
      { ring: 'ert', t: [0.735, 0.74], kind: 'pk-2' },   // egress attachment: the egress route table sends it to the spoke
      { wire: 's1', t: [0.75, 0.81], reverse: true, kind: 'pk-2', ring: 'a1' }, { wire: 's3', t: [0.75, 0.81], reverse: true, kind: 'pk-2', ring: 'a3' },
    ], 0.93),
    notes: [
      sub(282, 126, '10.0.0.0/8 > blackhole'), sub(282, 137, 'associated: spoke VPCs'),
      sub(282, 356, '10.2.0.0/16 > spoke B'), sub(282, 367, '10.3.0.0/16 > spoke C'), sub(282, 378, 'associated: egress VPC'),
      foot(SP[0], '0.0.0.0/0 > tgw'), foot(SP[1], '0.0.0.0/0 > tgw'), foot(SP[2], '0.0.0.0/0 > tgw'),
      // subnet route tables of the egress VPC
      sub(479, 204, '0.0.0.0/0 > nat'), sub(479, 360, '0.0.0.0/0 > nat'),
      sub(655, 195, '0.0.0.0/0 > igw'), sub(655, 206, '10.0.0.0/8 > tgw'),
      sub(655, 351, '0.0.0.0/0 > igw'), sub(655, 362, '10.0.0.0/8 > tgw'),
    ],
    legend: legend(886, 70, ['pk', 'Outbound'], ['pk-2', 'Return']),
  };
})();

// ---------------------------------------------------------------------------------------------
// vp-hybrid: Direct Connect primary, Site-to-Site VPN backup, with failover
// ---------------------------------------------------------------------------------------------
const hybrid = (() => {
  const DC = { x: 8, y: 52, w: 140, h: 214 };
  const DXL = { x: 200, y: 52, w: 160, h: 104, id: 'dxloc' };
  // the Direct Connect gateway is a global resource: inside the AWS Cloud, above the Region frame
  const REG = { x: 462, y: 160, w: 466, h: 164 };
  const V = { x: 732, y: 186, w: 184, h: 114 };
  const srv = nd('srv', 'aws-res-servers', 78, 100, 'Servers', { size: 40 });
  // the on-premises router terminates Direct Connect and, on the VPN path, is the customer gateway device
  const rtr = nd('rtr', CGW, 78, 206, 'Customer router', { sub: 'VPN customer gateway' });
  const dx = nd('dx', DX, 280, 100, 'AWS Direct Connect', { size: 40 });
  const net = nd('net', NET, 280, 262, 'Internet', { size: 40 });
  const dxgw = nd('dxgw', DXGW, 520, 100, 'Direct Connect gateway', { size: 40 });
  const vpn = nd('vpn', S2S, 520, 262, 'AWS Site-to-Site VPN', { size: 40, wrap: 16 });
  const tgw = nd('tgw', TGW, 656, 238, 'AWS Transit Gateway', { size: 48 });
  const att = nd('att', TGWA, 782, 238, 'TGW attachment');
  const ec2 = nd('ec2', EC2S, 872, 238, 'Amazon EC2 instances');
  const fw = (wire, a, b, o = {}) => ({ wire, t: [a, b], ...o });          // request, left to right
  const bk = (wire, a, b, o = {}) => ({ wire, t: [a, b], reverse: true, kind: 'pk-2', ...o }); // response, right to left
  return {
    id: 'vp-hybrid',
    name: 'Direct Connect with VPN backup',
    desc: 'On-premises traffic normally takes AWS Direct Connect, through a transit VIF and a Direct Connect gateway (a global resource) to the Transit Gateway in the Region. When the Direct Connect location fails, BGP withdraws its routes and the traffic (requests orange, responses blue) fails over to the Site-to-Site VPN attached to the same transit gateway.',
    wide: true, w: 960, h: 340, dur: 10,
    groups: [
      { kind: 'dc', ...DC, label: 'Corporate data center' },
      { kind: 'gen', ...DXL, label: 'Direct Connect location' },
      { kind: 'cloud', x: 410, y: 8, w: 542, h: 324 },
      { kind: 'region', ...REG, label: 'Region' },
      { kind: 'vpc', ...V, label: 'VPC', note: '10.0.0.0/16' },
    ],
    nodes: [srv, rtr, dx, net, dxgw, vpn, tgw, att, ec2],
    wires: [
      { id: 'w0', d: P(B(srv), T(rtr)), both: true },
      { id: 'd1', d: P(R(rtr, -8), [170, 198], [170, 100], L(dx)), both: true },
      { id: 'd2', d: P(R(dx), L(dxgw)), both: true, label: 'Transit VIF', labelAt: 0.81 },
      { id: 'd3', d: P(R(dxgw), [592, 100], [592, 230], L(tgw, -8)), both: true },
      { id: 'v1', d: P(R(rtr, 8), [190, 214], [190, 262], L(net)), dashed: true, both: true },
      { id: 'v2', d: P(R(net), L(vpn)), dashed: true, both: true, label: 'IPsec VPN tunnels', labelAt: 0.27 },
      { id: 'v3', d: P(R(vpn), [592, 262], [592, 246], L(tgw, 8)), dashed: true, both: true },
      { id: 't1', d: P(R(tgw), L(att)), both: true },
      { id: 't2', d: P(R(att), L(ec2)), both: true },
    ],
    steps: [
      { n: 1, at: 'd1', f: 0.6, dx: 11, dy: 0, text: 'On-premises servers send traffic through the customer router over AWS Direct Connect, the primary path.' },
      // on the vertical run, above the Region frame (48 + 34 of the path's 214)
      { n: 2, at: 'd3', f: 82 / 214, dx: 11, dy: 0, text: 'A transit VIF carries it to the Direct Connect gateway, a global resource outside the Region, which forwards it to AWS Transit Gateway and the Amazon EC2 instances in the VPC.' },
      { n: 3, at: 'v3', f: 0.5, dx: 11, dy: 0, text: 'When the Direct Connect location fails, BGP withdraws its routes and the traffic fails over to AWS Site-to-Site VPN on the same transit gateway, with the customer router as the VPN customer gateway device.' },
    ],
    effects: [
      { fail: 'dxloc', t: [0.47, 0.95] },
      { fade: 'd1', t: [0.47, 0.95] }, { fade: 'd2', t: [0.47, 0.95] }, { fade: 'd3', t: [0.47, 0.95] },
      { glow: 'v1', t: [0.5, 0.95] }, { glow: 'v2', t: [0.5, 0.95] }, { glow: 'v3', t: [0.5, 0.95] },
    ],
    timeline: [
      // 1) Direct Connect is up: request, then response
      fw('w0', 0.03, 0.05), fw('d1', 0.05, 0.09, { ring: 'dx' }), fw('d2', 0.09, 0.14, { ring: 'dxgw' }),
      fw('d3', 0.14, 0.18, { ring: 'tgw' }), fw('t1', 0.18, 0.2, { ring: 'att' }), fw('t2', 0.2, 0.22, { ring: 'ec2' }),
      bk('t2', 0.24, 0.265, { ring: 'att' }), bk('t1', 0.265, 0.29, { ring: 'tgw' }), bk('d3', 0.29, 0.33, { ring: 'dxgw' }),
      bk('d2', 0.33, 0.38, { ring: 'dx' }), bk('d1', 0.38, 0.42, { ring: 'rtr' }), bk('w0', 0.42, 0.44, { ring: 'srv' }),
      // 2) Direct Connect fails: the same traffic takes the VPN
      fw('w0', 0.52, 0.54), fw('v1', 0.54, 0.58, { ring: 'net' }), fw('v2', 0.58, 0.63, { ring: 'vpn' }),
      fw('v3', 0.63, 0.67, { ring: 'tgw' }), fw('t1', 0.67, 0.69, { ring: 'att' }), fw('t2', 0.69, 0.71, { ring: 'ec2' }),
      bk('t2', 0.73, 0.755, { ring: 'att' }), bk('t1', 0.755, 0.78, { ring: 'tgw' }), bk('v3', 0.78, 0.82, { ring: 'vpn' }),
      bk('v2', 0.82, 0.87, { ring: 'net' }), bk('v1', 0.87, 0.91, { ring: 'rtr' }), bk('w0', 0.91, 0.93, { ring: 'srv' }),
    ],
    notes: [sub(154, 94, 'Primary', 'start'), sub(198, 256, 'Backup', 'start')],
    legend: legend(16, 292, ['pk', 'Request'], ['pk-2', 'Response']),
  };
})();

export default {
  section: { id: 'vpc', title: 'VPC & HYBRID NETWORKING' },
  // ordered so the half-width tiles pair up in the two-column gallery
  diagrams: [standard, peering, endpoints, tgwHub, inspection, egress, hybrid, shared, clientVpn, privatelink],
};
