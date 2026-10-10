// IPv6 and dual stack family: v6-* diagrams.
//   node catalog/aws-kit/awd.mjs preview catalog/aws-kit/specs/ipv6.mjs [light]
//   node catalog/aws-kit/awd.mjs build   catalog/aws-kit/specs/ipv6.mjs
//
// A dual-stack VPC (NAT gateways for IPv4 egress, an egress-only internet gateway for IPv6 egress), NAT64
// with Route 53 DNS64 for an IPv6-only subnet, a dual-stack Application Load Balancer, and IPv6 between
// VPCs through AWS Transit Gateway.
// Conventions: nodes are placed by CENTER with nd(); wires are explicit H/V paths built with P() from edge
// ports (R/L/T/B). IPv6 packets are diamonds (`v6: true` on a flow or hop), IPv4 packets circles. Route
// tables, DNS records and load balancer settings are kit tables; a row lights while the packet it routes
// travels, using the window the flow compiles to (win()), so the two stay in step when the layout moves.
// Addresses: IPv6 from the documentation prefix 2001:db8::/32 (RFC 3849), VPC IPv4 from 10.0.0.0/8,
// internet hosts from the RFC 5737 ranges 192.0.2.0/24 and 198.51.100.0/24. No diagram needs `extra`.

// ---- icon ids ----
const IGW = 'aws-res-vpc-internet-gateway';   // also the egress-only internet gateway: the icon set has none of its own
const NAT = 'aws-res-vpc-nat-gateway';
const EC2 = 'aws-res-ec2-instance';
const NET = 'aws-res-internet';
const RES = 'aws-res-route-53-resolver';
const SERVER = 'aws-res-server';
const CLIENT = 'aws-res-client';
const HZ = 'aws-res-route-53-hosted-zone';
const ALB = 'aws-res-elastic-load-balancing-application-load-balancer';
const TGW = 'aws-svc-transit-gateway';
const TGWA = 'aws-res-transit-gateway-attachment';

// ---- layout helpers (shared with the other specs: ../place.mjs) ----
import { R, L, T, B, P, centered } from '../place.mjs';
import { compileFlows } from '../story.mjs';
// node by CENTER (cx, cy); one 32px size per diagram
const nd = centered(32);
// a caption in the group-note style (9px muted)
const sub = (x, y, text, o = {}) => ({ x, y, text, size: 9, ...o });
// the window of the k-th packet the flows send along `wire` (a route row lights while that packet travels)
const win = (d, wire, k = 0) => {
  const hits = compileFlows(d).timeline.filter((e) => e.wire === wire);
  if (!hits[k]) throw new Error(`${d.id}: no packet ${k} on wire ${wire}`);
  return hits[k].t;
};
// the moment a packet arrives (end of its window)
const arrive = (d, wire, k = 0) => win(d, wire, k)[1];
// route table columns
const RT_COLS = ['Destination', 'Target'];
// flow hops on wires drawn with d (no ends to find): a request hop with the node it reaches, and the
// response leg back along the same wire (blue, no badge)
const hop = (wire, ring, o = {}) => ({ wire, ring, ...o });
const back = (wire, ring, o = {}) => ({ wire, reverse: true, ring, kind: 'pk-2', step: false, ...o });

// ---------------------------------------------------------------------------------------------
// v6-dual-stack: a dual-stack VPC, IPv4 egress through NAT gateways, IPv6 egress through an
// egress-only internet gateway that blocks connections initiated from the internet
// ---------------------------------------------------------------------------------------------
const dualStack = (() => {
  const VPC = { x: 256, y: 58, w: 664, h: 328 };
  const AZA = { x: 270, y: 96, w: 240, h: 278 }, AZB = { x: 522, y: 96, w: 240, h: 278 };
  const PUBA = { x: 282, y: 120, w: 216, h: 118 }, PUBB = { x: 534, y: 120, w: 216, h: 118 };
  const PRVA = { x: 282, y: 250, w: 216, h: 112 }, PRVB = { x: 534, y: 250, w: 216, h: 112 };
  const ROW4 = 180, ROW6 = 310;   // public row (NAT gateways, internet gateway) and private row (instances, egress-only gateway)
  // the subnet header holds the label on the left and the two CIDR lines on the right: vertical wires pass between them
  const MID = 108;
  const net = nd('net', NET, 50, (ROW4 + ROW6) / 2, 'Internet');
  const igw = nd('igw', IGW, 196, ROW4, 'Internet gateway');
  const eigw = nd('eigw', IGW, 196, ROW6, 'Egress-only internet gateway', { wrap: 16 });
  const nata = nd('nata', NAT, PUBA.x + MID, ROW4, 'NAT gateway');
  const natb = nd('natb', NAT, PUBB.x + MID, ROW4, 'NAT gateway');
  const eca = nd('eca', EC2, PRVA.x + MID, ROW6, 'Amazon EC2');
  const ecb = nd('ecb', EC2, PRVB.x + MID, ROW6, 'Amazon EC2');
  const XN = 86;   // the elbow between the Internet and the two gateways
  const d = {
    id: 'v6-dual-stack',
    name: 'Dual-stack VPC with an egress-only internet gateway',
    desc: 'A VPC with an IPv4 CIDR and an IPv6 /56, whose public and private subnets in two Availability Zones each carry an IPv4 /24 and an IPv6 /64. A private instance reaches the internet over IPv4 through the NAT gateway in its Availability Zone (circles) and over IPv6 through the egress-only internet gateway (diamonds), and the route table row each packet uses lights up. An IPv6 connection started from the internet is blocked at the egress-only internet gateway (red).',
    wide: true, w: 960, h: 440, dur: 12,
    groups: [
      { kind: 'cloud', x: 104, y: 8, w: 840, h: 402 },
      { kind: 'region', x: 116, y: 34, w: 816, h: 364, label: 'Region' },
      { kind: 'vpc', ...VPC, label: 'VPC', note: ['10.0.0.0/16', '2001:db8:1200::/56'] },
      { kind: 'az', ...AZA, label: 'Availability Zone A' },
      { kind: 'az', ...AZB, label: 'Availability Zone B' },
      { kind: 'pub', ...PUBA, note: ['10.0.1.0/24', '2001:db8:1200:1::/64'] },
      { kind: 'pub', ...PUBB, note: ['10.0.2.0/24', '2001:db8:1200:2::/64'] },
      { kind: 'priv', ...PRVA, note: ['10.0.11.0/24', '2001:db8:1200:11::/64'] },
      { kind: 'priv', ...PRVB, note: ['10.0.12.0/24', '2001:db8:1200:12::/64'] },
    ],
    nodes: [net, igw, eigw, nata, natb, eca, ecb],
    wires: [
      // IPv4: instance > NAT gateway (same AZ) > internet gateway > internet
      { id: 'a4', d: P(T(eca), B(nata)), both: true },
      { id: 'n4', d: P(L(nata), R(igw)), both: true },
      { id: 'g4', d: P(L(igw), [XN, ROW4], [XN, net.cy - 6], R(net, -6)), both: true },
      // IPv6: instance > egress-only internet gateway > internet
      { id: 'a6', d: P(L(eca), R(eigw)), both: true },
      { id: 'g6', d: P(L(eigw, -6), [XN, ROW6 - 6], [XN, net.cy + 6], R(net, 6)), both: true },
      // a connection the internet tries to open toward the private subnet: it stops at the egress-only gateway
      { id: 'x6', d: P(B(net), [net.cx, ROW6 + 8], L(eigw, 8)), hot: true, dashed: true },
      // Availability Zone B: its instances use the NAT gateway in their own AZ
      { id: 'b4', d: P(T(ecb), B(natb)), both: true },
    ],
    flows: [
      { id: 'v4', wires: [hop('a4', 'nata', { f: 0.83, dx: 11, dy: 0 }), hop('n4', 'igw', { f: 0.87 }), hop('g4', 'net', { f: 0.17 }),
        back('g4', 'igw'), back('n4', 'nata'), back('a4', 'eca')], text: [
        'A private instance sends IPv4 traffic to the internet. Its route table sends 0.0.0.0/0 to the NAT gateway in the public subnet of the same Availability Zone; each Availability Zone has its own NAT gateway.',
        'The NAT gateway replaces the private source address with its own and sends the traffic by the 0.0.0.0/0 route of the public route table to the internet gateway, which maps it to the Elastic IP address of the NAT gateway.',
        'The internet gateway sends the traffic to the internet, and the response returns the same way.',
      ] },
      { id: 'v6', wires: [hop('a6', 'eigw', { f: 0.87 }), hop('g6', 'net', { f: 0.12 }), back('g6', 'eigw'), back('a6', 'eca')], v6: true, text: [
        'The same instance sends IPv6 traffic. Its IPv6 address is globally unique, so there is no NAT: the route table sends ::/0 to the egress-only internet gateway, a horizontally scaled VPC component rather than one gateway per Availability Zone.',
        'The egress-only internet gateway is stateful: it sends the traffic to the internet and returns the response for this outbound connection.',
      ] },
      { id: 'in', wires: [hop('x6', 'eigw', { f: 0.75, dy: 11, text: 'A host on the internet tries to open an IPv6 connection to the private instance. The egress-only internet gateway prevents the internet from initiating IPv6 connections with the instances, while they can still start their own.' })], kind: 'pk-bad', v6: true },
    ],
  };
  const blocked = arrive(d, 'x6');
  return {
    ...d,
    // the still shows the egress-only gateway turning the inbound connection away
    poster: Math.round((blocked - 0.005) * 1000) / 1000,
    tables: [
      { id: 'rt-pub', x: 776, y: PUBB.y, title: 'Public route table', tone: 'networking', cols: RT_COLS, rows: [
        ['10.0.0.0/16', 'local'], ['2001:db8:1200::/56', 'local'],
        { cells: ['0.0.0.0/0', 'igw'], t: win(d, 'n4'), tone: 'ok' },
        ['::/0', 'igw'],
      ] },
      { id: 'rt-priv', x: 776, y: PRVB.y, title: 'Private route table, AZ A', tone: 'networking', cols: RT_COLS, rows: [
        ['10.0.0.0/16', 'local'], ['2001:db8:1200::/56', 'local'],
        { cells: ['0.0.0.0/0', 'nat-a'], t: win(d, 'a4'), tone: 'ok' },
        { cells: ['::/0', 'eigw'], t: win(d, 'a6'), tone: 'ok' },
      ] },
    ],
    notes: [
      sub(776, PRVB.y + 86, 'AZ B table: 0.0.0.0/0 > nat-b', { anchor: 'start' }),
      { x: 196, y: ROW6 + 56, text: 'Inbound IPv6\nconnection blocked', kind: 'warn', size: 8.5, t: [blocked - 0.01, 0.985], still: true },
    ],
    marks: [{ on: 'eigw', t: [blocked - 0.01, 0.985], still: true }],
    legend: { x: 108, y: 428, row: true },
  };
})();

// ---------------------------------------------------------------------------------------------
// v6-nat64: an IPv6-only subnet reaches an IPv4-only server with Route 53 DNS64 and NAT64 on a NAT gateway
// ---------------------------------------------------------------------------------------------
const nat64 = (() => {
  const ROW = 180;
  const VPC = { x: 32, y: 58, w: 712, h: 291 };
  const AZ = { x: 168, y: 92, w: 562, h: 160 };
  const V6S = { x: 180, y: 116, w: 278, h: 124 }, PUB = { x: 470, y: 116, w: 248, h: 124 };
  const res = nd('res', RES, 100, ROW, 'Route 53 VPC Resolver', { wrap: 12, sub: 'fd00:ec2::253' });
  const ec2 = nd('ec2', EC2, 250, ROW, 'Amazon EC2', { sub: '2001:db8:1200:21::10' });
  const nat = nd('nat', NAT, 540, ROW, 'NAT gateway', { sub: '10.0.1.20' });
  const igw = nd('igw', IGW, 784, ROW, 'Internet gateway');
  const srv = nd('srv', SERVER, 906, ROW, 'IPv4-only server', { sub: '198.51.100.10' });
  const d = {
    id: 'v6-nat64',
    name: 'NAT64 and DNS64 for an IPv6-only subnet',
    desc: 'An instance in an IPv6-only subnet reaches a server that has only an IPv4 address. DNS64 on the subnet makes the Route 53 VPC Resolver synthesize an AAAA answer in 64:ff9b::/96, the subnet route table sends that prefix to a NAT gateway in a public subnet, and the NAT gateway translates IPv6 (diamonds) to IPv4 (circles) on the way out and back again on the way in.',
    wide: true, w: 960, h: 400, dur: 12,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 836, h: 365 },
      { kind: 'region', x: 20, y: 34, w: 812, h: 327, label: 'Region' },
      { kind: 'vpc', ...VPC, label: 'VPC', note: ['10.0.0.0/16', '2001:db8:1200::/56'] },
      { kind: 'az', ...AZ, label: 'Availability Zone A' },
      { kind: 'priv', ...V6S, label: 'IPv6-only subnet', note: '2001:db8:1200:21::/64' },
      { kind: 'pub', ...PUB, note: ['10.0.1.0/24', '2001:db8:1200:1::/64'] },
    ],
    nodes: [res, ec2, nat, igw, srv],
    wires: [
      { id: 'q', d: P(L(ec2), R(res)), both: true },
      { id: 'a', d: P(R(ec2), L(nat)), both: true },
      { id: 'b', d: P(R(nat), L(igw)), both: true },
      { id: 'c', d: P(R(igw), L(srv)), both: true },
    ],
    flows: [
      { id: 'dns', v6: true, wires: [
        hop('q', 'res', { f: 0.8, text: 'A Nitro instance in the IPv6-only subnet receives an IPv6 address and no IPv4 address. It asks the Route 53 VPC Resolver, at fd00:ec2::253, for the AAAA record of legacy.example.com.' }),
        hop('q', 'ec2', { reverse: true, kind: 'pk-2', f: 0.8, dy: 11, text: 'The name has only an A record, 198.51.100.10. DNS64 is enabled on the subnet, so the Resolver synthesizes an AAAA answer by prepending 64:ff9b::/96 to that address: 64:ff9b::c633:640a.' }),
      ] },
      { id: 'data', wires: [
        hop('a', 'nat', { v6: true, f: 0.12, text: 'The instance sends IPv6 traffic to 64:ff9b::c633:640a. The subnet route table sends 64:ff9b::/96 to the NAT gateway in the public subnet. NAT64 is built into every NAT gateway, and its subnet does not need to be dual-stack.' }),
        hop('b', 'igw', { f: 0.2, text: 'The NAT gateway does NAT64: it replaces the IPv6 source with its own private IPv4 address and takes the IPv4 destination from the last 32 bits of the address. It sends the IPv4 packet by the 0.0.0.0/0 route of the public route table to the internet gateway.' }),
        hop('c', 'srv', { f: 0.75, text: 'The internet gateway maps the private address of the NAT gateway to its Elastic IP address, and the packet reaches the IPv4-only server.' }),
        back('c', 'igw'), back('b', 'nat'),
        back('a', 'ec2', { v6: true, step: true, f: 0.12, dy: 11, text: 'The server answers over IPv4. The NAT gateway translates the response back to IPv6, with 64:ff9b::c633:640a as its source, and delivers it to the instance over the local route.' }),
      ] },
    ],
  };
  const answer = win(d, 'q', 1), out6 = win(d, 'a'), out4 = win(d, 'b'), back4 = win(d, 'b', 1);
  return {
    ...d,
    // the still: the request has been translated and leaves the NAT gateway as IPv4
    poster: Math.round(((out4[0] + out4[1]) / 2) * 1000) / 1000,
    tables: [
      { id: 'dns64', x: 44, y: 264, title: 'Resolver answer, DNS64 on', tone: 'networking', cols: ['Name', 'Type', 'Value'], rows: [
        ['legacy.example.com', 'A', '198.51.100.10'],
        { cells: ['legacy.example.com', 'AAAA', '64:ff9b::c633:640a'], t: answer, tone: 'ok' },
      ] },
      { id: 'rt-v6', x: 256, y: 264, title: 'IPv6-only subnet route table', tone: 'networking', cols: RT_COLS, rows: [
        ['10.0.0.0/16', 'local'], ['2001:db8:1200::/56', 'local'],
        { cells: ['64:ff9b::/96', 'nat-a'], t: out6, tone: 'ok' },
      ] },
      { id: 'rt-pub', x: 540, y: 264, title: 'Public route table', tone: 'networking', cols: RT_COLS, rows: [
        ['10.0.0.0/16', 'local'], ['2001:db8:1200::/56', 'local'],
        { cells: ['0.0.0.0/0', 'igw'], t: out4, tone: 'ok' },
        ['::/0', 'igw'],
      ] },
    ],
    notes: [
      sub(V6S.x + 8, V6S.y + 36, 'DNS64 enabled', { anchor: 'start' }),
      // what each packet carries, while it travels
      { x: 392, y: ROW - 6, text: 'to 64:ff9b::c633:640a', kind: 'label', size: 8.5, tone: 'request', t: out6 },
      { x: 650, y: ROW - 6, text: 'to 198.51.100.10', kind: 'label', size: 8.5, tone: 'request', t: out4 },
      { x: 650, y: ROW - 6, text: 'from 198.51.100.10', kind: 'label', size: 8.5, tone: 'response', t: back4 },
    ],
    legend: { x: 12, y: 391, row: true },
  };
})();

// ---------------------------------------------------------------------------------------------
// v6-dualstack-alb: IPv4 and IPv6 clients reach a dual-stack internet-facing ALB, which forwards to
// IPv4 targets
// ---------------------------------------------------------------------------------------------
const dualstackAlb = (() => {
  const RA = 166, RB = 320, MIDY = (RA + RB) / 2;   // AZ A row, AZ B row, and the internet gateway between them
  const AZA = { x: 342, y: 90, w: 396, h: 140 }, AZB = { x: 342, y: 244, w: 396, h: 140 };
  const pubA = { x: 354, y: 114, w: 180, h: 104 }, prvA = { x: 546, y: 114, w: 180, h: 104 };
  const pubB = { x: 354, y: 268, w: 180, h: 104 }, prvB = { x: 546, y: 268, w: 180, h: 104 };
  const c4 = nd('c4', CLIENT, 54, RA, 'IPv4 client', { sub: '192.0.2.10' });
  const c6 = nd('c6', CLIENT, 54, RB, 'IPv6 client', { sub: '2001:db8:5000::25' });
  const r53 = nd('r53', HZ, 190, MIDY, 'Public hosted zone', { sub: 'example.com' });
  const igw = nd('igw', IGW, 300, MIDY, 'Internet gateway');
  const alba = nd('alba', ALB, pubA.x + 90, RA, 'Application Load Balancer');
  const albb = nd('albb', ALB, pubB.x + 90, RB, 'Application Load Balancer');
  const eca = nd('eca', EC2, prvA.x + 90, RA, 'Amazon EC2');
  const ecb = nd('ecb', EC2, prvB.x + 90, RB, 'Amazon EC2');
  const XC = 238;   // the channel from the clients down (and up) to the internet gateway
  const d = {
    id: 'v6-dualstack-alb',
    name: 'Dual-stack Application Load Balancer',
    desc: 'An internet-facing Application Load Balancer with the dualstack IP address type has IPv4 and IPv6 addresses, and Route 53 alias A and AAAA records point to it. An IPv4 client (circles) and an IPv6 client (diamonds) resolve the name and connect in their own IP version; the load balancer terminates both connections and reaches its targets over IPv4, because the target group IP address type is ipv4.',
    wide: true, w: 960, h: 440, dur: 14,
    groups: [
      { kind: 'cloud', x: 112, y: 8, w: 818, h: 412 },
      { kind: 'region', x: 256, y: 34, w: 662, h: 374, label: 'Region' },
      { kind: 'vpc', x: 330, y: 58, w: 576, h: 338, label: 'VPC', note: ['10.0.0.0/16', '2001:db8:1200::/56'] },
      { kind: 'az', ...AZA, label: 'Availability Zone A' },
      { kind: 'az', ...AZB, label: 'Availability Zone B' },
      { kind: 'pub', ...pubA, note: ['10.0.1.0/24', '2001:db8:1200:1::/64'] },
      { kind: 'priv', ...prvA, note: '10.0.11.0/24' },
      { kind: 'pub', ...pubB, note: ['10.0.2.0/24', '2001:db8:1200:2::/64'] },
      { kind: 'priv', ...prvB, note: '10.0.12.0/24' },
    ],
    nodes: [c4, c6, r53, igw, alba, albb, eca, ecb],
    wires: [
      // DNS: each client resolves app.example.com in Route 53
      { id: 'd4', d: P(R(c4, 8), [r53.cx, RA + 8], T(r53)), dashed: true, both: true },
      { id: 'd6', d: P(R(c6, -8), [r53.cx, RB - 8], B(r53)), dashed: true, both: true },
      // the connections: client > internet gateway > load balancer node in a public subnet
      { id: 'i4', d: P(R(c4, -8), [XC, RA - 8], [XC, MIDY - 8], L(igw, -8)), both: true, label: 'IPv4', labelAt: 0.27 },
      { id: 'i6', d: P(R(c6, 8), [XC, RB + 8], [XC, MIDY + 8], L(igw, 8)), both: true, label: 'IPv6', labelAt: 0.27, labelDy: 12 },
      { id: 'ia', d: P(T(igw), [igw.cx, RA], L(alba)), both: true },
      { id: 'ib', d: P(B(igw), [igw.cx, RB], L(albb)), both: true },
      // the load balancer reaches its targets over IPv4 (an IPv4 target group)
      { id: 'ta', d: P(R(alba), L(eca)), both: true, label: 'IPv4', labelAt: 0.75 },
      { id: 'tb', d: P(R(albb), L(ecb)), both: true, label: 'IPv4', labelAt: 0.75 },
    ],
    flows: [
      { id: 'dns4', wires: [hop('d4', 'r53', { f: 0.4, text: 'The IPv4 client asks for the A record of app.example.com. The Route 53 alias A record answers with the IPv4 addresses of the load balancer.' }), back('d4', 'c4')] },
      { id: 'dns6', v6: true, wires: [hop('d6', 'r53', { f: 0.4, dy: 11, text: 'The IPv6 client asks for the AAAA record. Because the IP address type of the load balancer is dualstack, it also has IPv6 addresses, and the alias AAAA record answers with them.' }), back('d6', 'c6')] },
      { id: 'web4', wires: [
        hop('i4', 'igw', { f: 0.55, dx: -11, dy: 0, text: 'The IPv4 client connects over IPv4 through the internet gateway to the load balancer node in the public subnet of Availability Zone A.' }),
        hop('ia', 'alba', { step: false }),
        hop('ta', 'eca', { f: 0.25, text: 'The load balancer terminates the connection and sends the request to a target over IPv4: it reaches targets in the IP version of the target group.' }),
        back('ta', 'alba'), back('ia', 'igw'), back('i4', 'c4'),
      ] },
      { id: 'web6', wires: [
        hop('i6', 'igw', { v6: true, f: 0.55, dx: -11, dy: 0, text: 'The IPv6 client connects over IPv6 to the same load balancer, here to its node in Availability Zone B. Both nodes have IPv4 and IPv6 addresses.' }),
        hop('ib', 'albb', { v6: true, step: false }),
        hop('tb', 'ecb', { f: 0.25, text: 'The load balancer terminates the IPv6 connection and opens an IPv4 one to the target, with the client IPv6 address in the X-Forwarded-For header. The response returns to the client over IPv6.' }),
        back('tb', 'albb'), back('ib', 'igw', { v6: true }), back('i6', 'c6', { v6: true }),
      ] },
    ],
  };
  const tb = win(d, 'tb');
  // a DNS record row stays lit from the query to the answer
  const lookup = (w) => [win(d, w, 0)[0], win(d, w, 1)[1]];
  return {
    ...d,
    // the still: the IPv6 client's request leaves the load balancer as IPv4
    poster: Math.round(((tb[0] + tb[1]) / 2) * 1000) / 1000,
    tables: [
      { id: 'r53-records', x: 122, y: 30, title: 'app.example.com', tone: 'networking', cols: ['Type', 'Value'], rows: [
        { cells: ['A', 'alias: the ALB'], t: lookup('d4'), tone: 'ok' },
        { cells: ['AAAA', 'alias: the ALB'], t: lookup('d6'), tone: 'ok' },
      ] },
      { id: 'alb', x: 754, y: 150, title: 'Application Load Balancer', tone: 'networking', cols: ['Setting', 'Value'], rows: [
        ['Scheme', 'internet-facing'],
        { cells: ['IP address type', 'dualstack'], t: win(d, 'ib'), tone: 'ok' },
        { cells: ['Target group IP type', 'ipv4'], t: tb, tone: 'ok' },
      ] },
    ],
    notes: [
      sub(754, 232, 'IPv6 target groups also exist\n(dualstack load balancers only):\nthe load balancer then reaches\nits targets over IPv6.', { anchor: 'start' }),
      sub(754, 290, 'dualstack-without-public-ipv4:\nIPv6 clients only, with no\npublic IPv4 addresses.', { anchor: 'start' }),
      { x: ecb.cx, y: RB + 46, text: 'X-Forwarded-For: 2001:db8:5000::25', kind: 'label', size: 8.5, tone: 'request', t: tb },
    ],
    legend: { x: 122, y: 434, row: true },
  };
})();

// ---------------------------------------------------------------------------------------------
// v6-tgw: IPv6 between VPCs through AWS Transit Gateway (VPC attachments with IPv6 support, propagated
// IPv6 routes)
// ---------------------------------------------------------------------------------------------
const tgwV6 = (() => {
  const RE = 146, RT_ = 260;   // instance row, attachment row
  // one VPC: an IPv6-only workload subnet over a dual-stack TGW subnet (an attachment cannot use an IPv6-only subnet)
  const vpc = (x, k, v4, v6) => {
    const cx = x + 130;
    return {
      groups: [
        { kind: 'vpc', x, y: 58, w: 260, h: 262, label: `VPC ${k}`, note: [`${v4}.0.0/16`, `${v6}::/56`] },
        { kind: 'priv', x: x + 12, y: 90, w: 236, h: 104, label: 'IPv6-only subnet', note: `${v6}:21::/64` },
        { kind: 'priv', x: x + 12, y: 204, w: 236, h: 104, label: 'TGW subnet', note: [`${v4}.2.0/28`, `${v6}:2::/64`] },
      ],
      ec2: nd('ec' + k.toLowerCase(), EC2, cx, RE, 'Amazon EC2', { sub: 'Nitro instance' }),
      att: nd('at' + k.toLowerCase(), TGWA, cx, RT_, 'TGW attachment', { sub: 'IPv6 support on' }),
    };
  };
  const A = vpc(32, 'A', '10.1', '2001:db8:1100'), Bv = vpc(668, 'B', '10.2', '2001:db8:2200');
  const tgw = nd('tgw', TGW, 480, RT_, 'AWS Transit Gateway');
  const TRT = { x: 384, y: 330 };   // the transit gateway route table card
  const d = {
    id: 'v6-tgw',
    name: 'IPv6 between VPCs with Transit Gateway',
    desc: 'Two dual-stack VPCs attach to AWS Transit Gateway with IPv6 support enabled on each VPC attachment, so their IPv6 CIDRs propagate into the transit gateway route table next to the IPv4 ones. Instances in IPv6-only subnets reach each other over IPv6 (diamonds), and each route table row lights as the packet uses it.',
    wide: true, w: 960, h: 440, dur: 12,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 944, h: 418 },
      { kind: 'region', x: 20, y: 34, w: 920, h: 384, label: 'Region' },
      ...A.groups, ...Bv.groups,
    ],
    nodes: [A.ec2, A.att, tgw, Bv.att, Bv.ec2],
    wires: [
      { id: 'ea', d: P(B(A.ec2), T(A.att)), both: true },
      { id: 'at', d: P(R(A.att), L(tgw)), both: true },
      { id: 'tb', d: P(R(tgw), L(Bv.att)), both: true },
      { id: 'eb', d: P(T(Bv.att), B(Bv.ec2)), both: true },
      // the transit gateway and its route table
      { id: 'rt', d: P(B(tgw), [tgw.cx, TRT.y]), dashed: true, arrow: false },
    ],
    flows: [
      { id: 'req', v6: true, wires: [
        hop('ea', 'ata', { f: 0.5, dx: 11, dy: 0, text: 'A Nitro instance in an IPv6-only subnet of VPC A sends IPv6 traffic to an instance in VPC B. Its route table sends 2001:db8:2200::/56, the IPv6 CIDR of VPC B, to the transit gateway, through the attachment in the same Availability Zone.' }),
        hop('at', 'tgw', { f: 0.5, text: 'IPv6 support is enabled on the VPC attachment, so the transit gateway has an IPv6 address on its network interface in the TGW subnet. Attachment subnets must also have IPv4: an attachment cannot use an IPv6-only subnet.' }),
        hop('tb', 'atb', { f: 0.5, text: 'With route propagation on, both attachments propagate their IPv4 and IPv6 CIDRs into the transit gateway route table. The 2001:db8:2200::/56 route sends the traffic to the VPC B attachment.' }),
        hop('eb', 'ecb', { f: 0.5, dx: -11, dy: 0, text: 'The traffic reaches the instance in VPC B. Its route table sends 2001:db8:1100::/56 to the transit gateway, so the response returns the same way.' }),
        back('eb', 'atb'), back('tb', 'tgw'), back('at', 'ata'), back('ea', 'eca'),
      ] },
    ],
  };
  const tb = win(d, 'tb');
  return {
    ...d,
    // the still: the transit gateway has looked up the IPv6 route and forwards to VPC B
    poster: Math.round(((tb[0] + tb[1]) / 2) * 1000) / 1000,
    tables: [
      { id: 'rt-a', x: 44, y: 330, title: 'VPC A, IPv6-only subnet route table', tone: 'networking', cols: RT_COLS, rows: [
        ['10.1.0.0/16', 'local'], ['2001:db8:1100::/56', 'local'],
        { cells: ['2001:db8:2200::/56', 'tgw'], t: win(d, 'ea'), tone: 'ok' },
      ] },
      { id: 'rt-tgw', x: TRT.x, y: TRT.y, title: 'Transit gateway route table', tone: 'networking', cols: ['Destination', 'Attachment', 'Type'], rows: [
        ['10.1.0.0/16', 'VPC A', 'propagated'],
        { cells: ['2001:db8:1100::/56', 'VPC A', 'propagated'], t: win(d, 'at', 1), tone: 'ok' },
        ['10.2.0.0/16', 'VPC B', 'propagated'],
        { cells: ['2001:db8:2200::/56', 'VPC B', 'propagated'], t: tb, tone: 'ok' },
      ] },
      { id: 'rt-b', x: 680, y: 330, title: 'VPC B, IPv6-only subnet route table', tone: 'networking', cols: RT_COLS, rows: [
        ['10.2.0.0/16', 'local'], ['2001:db8:2200::/56', 'local'],
        { cells: ['2001:db8:1100::/56', 'tgw'], t: win(d, 'eb', 1), tone: 'ok' },
      ] },
    ],
    legend: { x: 12, y: 437, row: true, items: [{ kind: 'pk', label: 'Request' }, { kind: 'pk-2', label: 'Response' }, { kind: 'v6', label: 'IPv6 packet' }] },
  };
})();

export default {
  section: { id: 'ipv6', title: 'IPV6 AND DUAL STACK' },
  diagrams: [dualStack, nat64, dualstackAlb, tgwV6],
};
