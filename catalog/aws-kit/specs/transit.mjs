// Transit & network segmentation family: tg-* diagrams.
//   node catalog/aws-kit/awd.mjs preview catalog/aws-kit/specs/transit.mjs [light]
//   node catalog/aws-kit/awd.mjs build   catalog/aws-kit/specs/transit.mjs
//
// Goes deeper than the vp-* family (hub and spoke, inspection, egress, hybrid): Transit Gateway route table
// segmentation, Transit Gateway Connect, Direct Connect gateway across Regions, AWS Cloud WAN, VPC Lattice,
// Gateway Load Balancer, distributed Network Firewall, private NAT gateways and VPC IPAM.
// Conventions: nodes are placed by CENTER with nd(); wires are explicit H/V paths built with P() from edge ports
// (R/L/T/B); route summaries, CIDRs and captions use group `note`, wire labels and `notes` (timed where they
// tell a moment of the story). `extra` is used only for the red "dropped" X marks, which the kit lacks.

// ---- icon ids ----
const IGW = 'aws-res-vpc-internet-gateway';
const NAT = 'aws-res-vpc-nat-gateway';
const ALB = 'aws-res-elastic-load-balancing-application-load-balancer';
const GWLB = 'aws-res-elastic-load-balancing-gateway-load-balancer';
const EC2 = 'aws-res-ec2-instance';
const EC2S = 'aws-res-ec2-instances';
const RT = 'aws-res-route-53-route-table';
const VPCE = 'aws-res-vpc-endpoints';
const NFW_EP = 'aws-res-network-firewall-endpoints';
const TGW = 'aws-svc-transit-gateway';
const TGWA = 'aws-res-transit-gateway-attachment';
const CGW = 'aws-res-vpc-customer-gateway';
const DXGW = 'aws-res-direct-connect-gateway';
const DX = 'aws-svc-direct-connect';
const NET = 'aws-res-internet';
const VPCI = 'aws-res-vpc-virtual-private-cloud-vpc';

// ---- layout helpers (shared with the other specs: ../place.mjs) ----
import { wrapLines, lblH, R, L, T, B, Bi, P, centered } from '../place.mjs';
// node by CENTER (cx, cy); default 32px icon
const nd = centered(32);
// rescale a timeline so its last window ends at `end` of the clock
const fit = (tl, end = 0.93) => {
  const k = end / Math.max(...tl.map((e) => e.t[1]));
  const r = (n) => Math.round(n * k * 1000) / 1000;
  return tl.map((e) => ({ ...e, t: [r(e.t[0]), r(e.t[1])] }));
};
// notes: ink table cell / muted caption / red cell
const cell = (x, y, text, o = {}) => ({ x, y, text, kind: 'label', anchor: 'start', ...o });
const cap = (x, y, text, o = {}) => ({ x, y, text, ...o });
const warn = (x, y, text, o = {}) => ({ x, y, text, kind: 'warn', ...o });
// a red "dropped" X (the kit has no node-level fail mark); shown only during [a, b] of the clock
const RED = '#DD344C';
const dropX = (cx, cy, a, b, dur) => {
  const f = (n) => String(Math.round(n * 1000) / 1000).replace(/^0\./, '.');
  return `<g class="anim" opacity="0"><circle cx="${cx}" cy="${cy}" r="7.5" fill="${RED}"/><path d="M${cx - 3},${cy - 3} L${cx + 3},${cy + 3} M${cx + 3},${cy - 3} L${cx - 3},${cy + 3}" stroke="#fff" stroke-width="1.7" fill="none"/>` +
    `<animate attributeName="opacity" dur="${dur}s" repeatCount="indefinite" calcMode="discrete" values="0;1;0" keyTimes="0;${f(a)};${f(b)}"/></g>`;
};

// ---------------------------------------------------------------------------------------------
// tg-segmentation: Transit Gateway route tables isolate prod and dev, both reach shared services
// ---------------------------------------------------------------------------------------------
const segmentation = (() => {
  const PV = { x: 36, y: 70, w: 214, h: 96 }, SV = { x: 710, y: 176, w: 214, h: 96 }, DV = { x: 36, y: 282, w: 214, h: 96 };
  const ecP = nd('ecP', EC2, 88, 118, 'Amazon EC2'), attP = nd('attP', TGWA, 200, 118, 'TGW attachment');
  const attS = nd('attS', TGWA, 756, 224, 'TGW attachment'), ecS = nd('ecS', EC2, 860, 224, 'Amazon EC2');
  const ecD = nd('ecD', EC2, 88, 330, 'Amazon EC2'), attD = nd('attD', TGWA, 200, 330, 'TGW attachment');
  // one card per Transit Gateway route table: its association, its propagation source and the routes it holds
  const card = (y, name, assoc, prop, rows) => {
    const x = 296;
    const g = { kind: 'gen', icon: RT, x, y, w: 368, h: 96, label: name, note: 'association: ' + assoc };
    const n = [cap(x + 14, y + 38, 'Destination', { anchor: 'start' }), cap(x + 116, y + 38, 'Next hop', { anchor: 'start' }), cap(x + 256, y + 38, 'Route type', { anchor: 'start' })];
    rows.forEach(([d, h, t, bad], i) => {
      const ry = y + 53 + i * 14;
      n.push(cell(x + 14, ry, d), bad ? warn(x + 116, ry, h, { anchor: 'start' }) : cell(x + 116, ry, h), cap(x + 256, ry, t, { anchor: 'start' }));
    });
    n.push(cap(x + 14, y + 88, 'propagation from: ' + prop, { anchor: 'start' }));
    return { g, n };
  };
  const cp = card(70, 'Prod route table', 'Prod attachment', 'Shared attachment',
    [['10.30.0.0/16', 'Shared attachment', 'propagated'], ['10.20.0.0/16', 'blackhole', 'static', true]]);
  const cs = card(176, 'Shared services route table', 'Shared attachment', 'Prod and Dev attachments',
    [['10.10.0.0/16', 'Prod attachment', 'propagated'], ['10.20.0.0/16', 'Dev attachment', 'propagated']]);
  const cd = card(282, 'Dev route table', 'Dev attachment', 'Shared attachment',
    [['10.30.0.0/16', 'Shared attachment', 'propagated'], ['10.10.0.0/16', 'blackhole', 'static', true]]);
  return {
    id: 'tg-segmentation',
    name: 'Transit Gateway route table segmentation',
    desc: 'Each attachment is associated with one Transit Gateway route table, which routes everything that arrives on it, and attachments propagate only into the tables you choose. Prod and Dev reach shared services, but a Dev packet bound for Prod hits a blackhole route and is dropped. Requests are orange, responses blue, dropped traffic red.',
    wide: true, w: 960, h: 424, dur: 12,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 944, h: 408 },
      { kind: 'region', x: 20, y: 34, w: 920, h: 374, label: 'Region' },
      { kind: 'vpc', ...PV, label: 'Prod VPC', note: '10.10.0.0/16' },
      { kind: 'vpc', ...SV, label: 'Shared services VPC', note: '10.30.0.0/16' },
      { kind: 'vpc', ...DV, label: 'Dev VPC', note: '10.20.0.0/16' },
      { kind: 'gen', icon: TGW, x: 284, y: 44, w: 392, h: 342, label: 'AWS Transit Gateway' },
      cp.g, cs.g, cd.g,
    ],
    nodes: [ecP, attP, attS, ecS, ecD, attD],
    wires: [
      { id: 'pa', d: P(R(ecP), L(attP)), arrow: false },
      { id: 'da', d: P(R(ecD), L(attD)), arrow: false },
      { id: 'sa', d: P(R(attS), L(ecS)), arrow: false },
      // attachment -> its own route table (association): the lookup uses the table of the arriving attachment
      { id: 'aP', d: P(R(attP, -8), [292, 110]) },
      { id: 'aD', d: P(R(attD, -8), [292, 322]) },
      { id: 'aS', d: P(L(attS), [668, 224]) },
      // forwarding after the lookup: Prod and Dev tables point at the Shared attachment; the Shared table points at both
      { id: 'dP', d: P([668, 110], [692, 110], [692, 212], L(attS, -12)) },
      { id: 'dD', d: P([668, 322], [692, 322], [692, 236], L(attS, 12)) },
      { id: 'rP', d: P([292, 232], [268, 232], [268, 126], R(attP, 8)) },
      { id: 'rD', d: P([292, 244], [268, 244], [268, 338], R(attD, 8)) },
    ],
    steps: [
      { n: 1, at: 'aP', f: 0.5, dy: -11, text: 'A Prod instance sends traffic to shared services. AWS Transit Gateway looks it up in the Prod route table, the table the Prod attachment is associated with.' },
      { n: 2, at: 'dP', f: 0.48, dx: 11, dy: 0, text: 'AWS Transit Gateway forwards it to the Shared attachment on the propagated 10.30.0.0/16 route. The reply is looked up in the Shared services route table.' },
      { n: 3, at: 'aD', f: 0.5, dy: -11, text: 'A Dev instance sends traffic to Prod. The Dev route table holds a static blackhole route for 10.10.0.0/16, so AWS Transit Gateway drops the packet.' },
    ],
    timeline: fit([
      { wire: 'pa', t: [0.03, 0.07], ring: 'attP' },
      { wire: 'aP', t: [0.07, 0.12] },
      { wire: 'dP', t: [0.14, 0.23], ring: 'attS' },
      { wire: 'sa', t: [0.23, 0.28], ring: 'ecS' },
      { wire: 'sa', t: [0.35, 0.4], reverse: true, kind: 'pk-2', ring: 'attS' },
      { wire: 'aS', t: [0.4, 0.45], kind: 'pk-2' },
      { wire: 'rP', t: [0.46, 0.55], kind: 'pk-2', ring: 'attP' },
      { wire: 'pa', t: [0.55, 0.6], reverse: true, kind: 'pk-2', ring: 'ecP' },
      { wire: 'da', t: [0.68, 0.72], kind: 'pk-bad' },
      { wire: 'aD', t: [0.72, 0.78], kind: 'pk-bad' },
    ], 0.93),
    notes: [
      ...cp.n, ...cs.n, ...cd.n,
      warn(480, 404, 'Dev to Prod: blackhole route, packet dropped', { anchor: 'middle', t: [0.84, 0.985] }),
    ],
    extra: dropX(294, 322, 0.84, 0.985, 12),
  };
})();

// ---------------------------------------------------------------------------------------------
// tg-connect: Transit Gateway Connect with an SD-WAN appliance (GRE tunnel + BGP over a VPC transport attachment)
// ---------------------------------------------------------------------------------------------
const connect = (() => {
  const brA = nd('brA', CGW, 74, 140, 'SD-WAN edge', { sub: 'Branch A' }), brB = nd('brB', CGW, 74, 240, 'SD-WAN edge', { sub: 'Branch B' });
  const net = nd('net', NET, 200, 190, 'Internet', { size: 40 });
  const igw = nd('igw', IGW, 276, 190, null);
  const app = nd('app', EC2, 350, 190, 'SD-WAN virtual appliance');
  const att = nd('att', TGWA, 466, 190, 'VPC attachment', { sub: '(transport)' });
  const conn = nd('conn', TGWA, 612, 134, 'Connect attachment', { sub: 'over transport' });
  const tgw = nd('tgw', TGW, 680, 190, 'AWS Transit Gateway', { size: 48 });
  const attW = nd('attW', TGWA, 826, 190, 'TGW attachment'), ecW = nd('ecW', EC2, 902, 190, 'Amazon EC2');
  return {
    id: 'tg-connect',
    name: 'Transit Gateway Connect with SD-WAN',
    desc: 'An SD-WAN virtual appliance in a VPC joins the Transit Gateway through a Connect attachment: a GRE tunnel with two BGP sessions that rides on the VPC attachment used as transport. BGP (blue) carries the branch prefix into the TGW route table and the VPC prefix back; branch traffic (orange) then flows over the tunnel to the workload VPC.',
    wide: true, w: 960, h: 352, dur: 14,
    groups: [
      { kind: 'dc', x: 8, y: 64, w: 150, h: 256, label: 'Branch offices' },
      { kind: 'cloud', x: 224, y: 8, w: 728, h: 336 },
      { kind: 'region', x: 236, y: 34, w: 704, h: 302, label: 'Region' },
      { kind: 'vpc', x: 276, y: 62, w: 252, h: 266, label: 'SD-WAN VPC', note: '10.0.0.0/16' },
      { kind: 'pub', x: 288, y: 88, w: 228, h: 228, label: 'Public subnet' },
      { kind: 'gen', icon: TGW, x: 552, y: 70, w: 206, h: 236, label: 'AWS Transit Gateway' },
      { kind: 'vpc', x: 782, y: 130, w: 158, h: 120, label: 'Workload VPC', note: '10.1.0.0/16' },
      { kind: 'gen', icon: RT, x: 772, y: 262, w: 168, h: 64, label: 'TGW route table' },
    ],
    nodes: [brA, brB, net, igw, app, att, conn, tgw, attW, ecW],
    wires: [
      { id: 'wa', d: P(R(brA), [168, 140], [168, 182], L(net, -8)), dashed: true, both: true },
      { id: 'wb', d: P(R(brB), [168, 240], [168, 198], L(net, 8)), dashed: true, both: true },
      { id: 'ni', d: P(R(net), L(igw)), dashed: true, both: true },
      { id: 'ia', d: P(R(igw), L(app)), both: true },
      { id: 'ap', d: P(R(app), L(att)), arrow: false },
      { id: 'tr', d: P(R(att), L(tgw)), both: true },
      { id: 'gre', d: P(T(app, -8), [342, 128], L(conn, -6)), both: true, flow: true, label: 'GRE tunnel (Connect peer)', labelAt: 0.45 },
      { id: 'bgp', d: P(T(app, 8), [358, 140], L(conn, 6)), both: true, dashed: true, label: '2 BGP sessions', labelAt: 0.45, labelDy: 12 },
      { id: 'ct', d: P(R(conn), [680, 134], T(tgw)), both: true },
      { id: 'tw', d: P(R(tgw), L(attW)), both: true },
      { id: 'wa2', d: P(R(attW), L(ecW)), arrow: false },
      { id: 'rt', d: P(Bi(tgw, 0, 4 + 26), [680, 294], [770, 294]), dashed: true, arrow: false },
    ],
    steps: [
      { n: 1, at: 'wa', f: 0.62, dx: 11, dy: 0, text: 'The SD-WAN edge in Branch A sends traffic for the workload VPC over the SD-WAN overlay, across the internet, to the SD-WAN virtual appliance.' },
      { n: 2, at: 'gre', f: 0.2, dy: -11, text: 'The appliance sends the traffic through the GRE tunnel of the Connect peer, whose two BGP sessions earlier advertised 172.16.0.0/16 and learned 10.1.0.0/16.' },
      { n: 3, at: 'tw', f: 0.5, dy: -11, text: 'AWS Transit Gateway matches 10.1.0.0/16, propagated from the workload VPC attachment, and forwards the traffic to the instance in the workload VPC.' },
    ],
    timeline: [
      { wire: 'bgp', t: [0.03, 0.10], kind: 'pk-2', ring: 'conn' },
      { wire: 'ct', t: [0.10, 0.14], kind: 'pk-2', ring: 'tgw' },
      { wire: 'ct', t: [0.18, 0.22], reverse: true, kind: 'pk-2' },
      { wire: 'bgp', t: [0.22, 0.29], reverse: true, kind: 'pk-2', ring: 'app' },
      { wire: 'wa', t: [0.38, 0.44] },
      { wire: 'ni', t: [0.44, 0.48], ring: 'igw' },
      { wire: 'ia', t: [0.48, 0.52], ring: 'app' },
      { wire: 'gre', t: [0.53, 0.63], ring: 'conn' },
      { wire: 'ct', t: [0.63, 0.67], ring: 'tgw' },
      { wire: 'tw', t: [0.68, 0.74], ring: 'attW' },
      { wire: 'wa2', t: [0.74, 0.79], ring: 'ecW' },
    ],
    notes: [
      cap(74, 308, '172.16.0.0/16'),
      cap(196, 118, 'SD-WAN\noverlay'),
      // centered in the 40px between the Region and VPC edges (the gateway sits on the VPC edge)
      cap(256, 224, 'Internet'), cap(256, 234, 'gateway'),
      // route table card: what BGP installed
      cell(782, 292, '172.16.0.0/16'), cap(868, 292, 'Connect (BGP)', { anchor: 'start' }),
      cell(782, 306, '10.1.0.0/16'), cap(868, 306, 'VPC (propagated)', { anchor: 'start' }),
      // BGP exchange, shown while the blue packets move
      cap(444, 164, 'advertises 172.16.0.0/16', { t: [0.03, 0.14] }),
      cap(444, 164, 'learns 10.1.0.0/16', { t: [0.18, 0.3] }),
    ],
  };
})();

// ---------------------------------------------------------------------------------------------
// tg-dxgw: one Direct Connect gateway, one transit VIF, Transit Gateways in two Regions
// ---------------------------------------------------------------------------------------------
const dxgw = (() => {
  const srv = nd('srv', 'aws-res-servers', 60, 134, 'Servers', { size: 40, sub: '192.168.0.0/16' });
  const rtr = nd('rtr', CGW, 60, 226, 'Customer gateway');
  const dx = nd('dx', DX, 251, 226, 'AWS Direct Connect', { size: 40 });
  const gw = nd('gw', DXGW, 424, 226, 'Direct Connect gateway', { size: 40, sub: 'global resource' });
  const region = (k, y, tgwId, asn, ids) => {
    const tg = nd(tgwId, TGW, 580, y + 94, 'AWS Transit Gateway', { size: 48, sub: 'ASN ' + asn });
    const rows = ids.map(([aid, vid, name, cidr], i) => [
      nd(aid, TGWA, 706, y + 64 + i * 60, 'TGW attachment'),
      nd(vid, VPCI, 846, y + 64 + i * 60, name, { sub: cidr }),
    ]);
    return { tg, rows };
  };
  const r1 = region(1, 34, 'tg1', 64512, [['a1a', 'v1a', 'VPC A', '10.1.0.0/16'], ['a1b', 'v1b', 'VPC B', '10.2.0.0/16']]);
  const r2 = region(2, 246, 'tg2', 64513, [['a2a', 'v2a', 'VPC C', '10.3.0.0/16'], ['a2b', 'v2b', 'VPC D', '10.4.0.0/16']]);
  const [a1a, v1a] = r1.rows[0], [a1b, v1b] = r1.rows[1], [a2a, v2a] = r2.rows[0], [a2b, v2b] = r2.rows[1];
  const tg1 = r1.tg, tg2 = r2.tg;
  const fan = (tg, a, b, id) => [
    { id: id + 'a', d: P(R(tg, -8), [650, tg.cy - 8], [650, a.cy], L(a)), both: true },
    { id: id + 'b', d: P(R(tg, 8), [650, tg.cy + 8], [650, b.cy], L(b)), both: true },
  ];
  return {
    id: 'tg-dxgw',
    name: 'Direct Connect gateway to Transit Gateways in two Regions',
    desc: 'One transit VIF carries on-premises traffic to a Direct Connect gateway, which is associated with a Transit Gateway in us-east-1 and another in eu-west-1, each with its own ASN and allowed prefixes. Requests (orange) fan out from the gateway to VPCs in both Regions; responses (blue) return the same way.',
    wide: true, w: 960, h: 436, dur: 12,
    groups: [
      { kind: 'dc', x: 8, y: 84, w: 150, h: 200, label: 'Corporate data center' },
      { kind: 'gen', x: 176, y: 176, w: 150, h: 108, label: 'Direct Connect location' },
      { kind: 'cloud', x: 364, y: 8, w: 588, h: 420 },
      { kind: 'region', x: 490, y: 34, w: 450, h: 172, label: 'us-east-1' },
      { kind: 'region', x: 490, y: 246, w: 450, h: 172, label: 'eu-west-1' },
    ],
    nodes: [srv, rtr, dx, gw, tg1, a1a, v1a, a1b, v1b, tg2, a2a, v2a, a2b, v2b],
    wires: [
      { id: 'sr', d: P(B(srv), T(rtr)), both: true },
      { id: 'rd', d: P(R(rtr), L(dx)), both: true, label: 'Transit VIF', labelAt: 0.2 },
      { id: 'dg', d: P(R(dx), L(gw)), both: true },
      { id: 'g1', d: P(R(gw), [466, 226], [466, tg1.cy], L(tg1)), both: true },
      { id: 'g2', d: P(R(gw), [466, 226], [466, tg2.cy], L(tg2)), both: true },
      ...fan(tg1, a1a, a1b, 't1'), ...fan(tg2, a2a, a2b, 't2'),
      { id: 'u1a', d: P(R(a1a), L(v1a)), arrow: false }, { id: 'u1b', d: P(R(a1b), L(v1b)), arrow: false },
      { id: 'u2a', d: P(R(a2a), L(v2a)), arrow: false }, { id: 'u2b', d: P(R(a2b), L(v2b)), arrow: false },
    ],
    steps: [
      { n: 1, at: 'rd', f: 0.62, dy: -11, text: 'The customer gateway sends traffic from the on-premises servers over a transit VIF on AWS Direct Connect to the Direct Connect gateway.' },
      { n: 2, at: 'g1', f: 0.5, dx: 11, dy: 0, text: 'The Direct Connect gateway sends traffic for 10.1.0.0/16 and 10.2.0.0/16 to AWS Transit Gateway in us-east-1, whose association allows those prefixes.' },
      { n: 3, at: 'g2', f: 0.5, dx: 11, dy: 0, text: 'The Direct Connect gateway sends 10.3.0.0/16 and 10.4.0.0/16 to the Transit Gateway in eu-west-1. Each Transit Gateway delivers to its VPCs, and replies return the same way.' },
    ],
    timeline: [
      { wire: 'sr', t: [0.03, 0.06] },
      { wire: 'rd', t: [0.06, 0.12], ring: 'dx' },
      { wire: 'dg', t: [0.12, 0.17], ring: 'gw' },
      { wire: 'g1', t: [0.18, 0.25], ring: 'tg1' }, { wire: 'g2', t: [0.18, 0.25], ring: 'tg2' },
      { wire: 't1a', t: [0.26, 0.30], ring: 'a1a' }, { wire: 't2a', t: [0.26, 0.30], ring: 'a2a' },
      { wire: 'u1a', t: [0.31, 0.35], ring: 'v1a' }, { wire: 'u2a', t: [0.31, 0.35], ring: 'v2a' },
      { wire: 'u1a', t: [0.48, 0.52], reverse: true, kind: 'pk-2', ring: 'a1a' }, { wire: 'u2a', t: [0.48, 0.52], reverse: true, kind: 'pk-2', ring: 'a2a' },
      { wire: 't1a', t: [0.52, 0.56], reverse: true, kind: 'pk-2', ring: 'tg1' }, { wire: 't2a', t: [0.52, 0.56], reverse: true, kind: 'pk-2', ring: 'tg2' },
      { wire: 'g1', t: [0.57, 0.64], reverse: true, kind: 'pk-2', ring: 'gw' }, { wire: 'g2', t: [0.57, 0.64], reverse: true, kind: 'pk-2' },
      { wire: 'dg', t: [0.65, 0.7], reverse: true, kind: 'pk-2', ring: 'dx' },
      { wire: 'rd', t: [0.7, 0.76], reverse: true, kind: 'pk-2', ring: 'rtr' },
      { wire: 'sr', t: [0.76, 0.79], reverse: true, kind: 'pk-2', ring: 'srv' },
    ],
    notes: [
      cap(460, 146, 'TGW association', { anchor: 'end' }), cap(460, 156, 'allowed prefixes:', { anchor: 'end' }),
      cap(460, 166, '10.1.0.0/16', { anchor: 'end' }), cap(460, 176, '10.2.0.0/16', { anchor: 'end' }),
      cap(460, 306, 'TGW association', { anchor: 'end' }), cap(460, 316, 'allowed prefixes:', { anchor: 'end' }),
      cap(460, 326, '10.3.0.0/16', { anchor: 'end' }), cap(460, 336, '10.4.0.0/16', { anchor: 'end' }),
    ],
  };
})();

// ---------------------------------------------------------------------------------------------
// tg-cloudwan: AWS Cloud WAN core network, segments across Regions, segment sharing
// ---------------------------------------------------------------------------------------------
const cloudwan = (() => {
  const CNE = 'aws-res-cloud-wan-core-network-edge', SEG = 'aws-res-cloud-wan-segment-network';
  const COLS = [{ x: 228, name: 'us-east-1', k: 1 }, { x: 470, name: 'eu-west-1', k: 2 }, { x: 712, name: 'ap-southeast-2', k: 3 }];
  const BAND = [{ y: 146, seg: 'prod' }, { y: 238, seg: 'dev' }, { y: 330, seg: 'shared' }];
  const CIDR = { 1: ['10.1.0.0/16', '10.2.0.0/16', '10.3.0.0/16'], 2: ['10.11.0.0/16', '10.12.0.0/16', '10.13.0.0/16'], 3: ['10.21.0.0/16', '10.22.0.0/16', '10.23.0.0/16'] };
  const VNAME = ['Prod VPC', 'Dev VPC', 'Shared services VPC'];
  const groups = [
    { kind: 'cloud', x: 8, y: 8, w: 944, h: 424 },
    { kind: 'gen', icon: 'aws-svc-cloud-wan', x: 20, y: 34, w: 196, h: 104, label: 'Core network policy' },
    ...BAND.map((b) => ({ kind: 'gen', icon: SEG, x: 20, y: b.y, w: 920, h: 86, label: b.seg + ' segment' })),
    ...COLS.map((c) => ({ kind: 'region', x: c.x, y: 34, w: 228, h: 390, label: c.name })),
  ];
  const nodes = [], wires = [];
  const cne = {};
  for (const c of COLS) {
    cne[c.k] = nd('cne' + c.k, CNE, c.x + 114, 84, 'Core network edge');
    nodes.push(cne[c.k]);
    BAND.forEach((b, i) => {
      const vx = c.x + 34, vy = b.y + 4;
      groups.push({ kind: 'vpc', x: vx, y: vy, w: 188, h: 78, label: VNAME[i], note: CIDR[c.k][i] });
      const e = nd(`v${c.k}${'pds'[i]}`, EC2, vx + 94, vy + 42, 'Amazon EC2');
      nodes.push(e);
      const tx = c.x + 10;
      wires.push({ id: `c${c.k}${'pds'[i]}`, d: P(L(cne[c.k]), [tx, 84], [tx, e.cy], [vx - 2, e.cy]), both: true });
    });
  }
  wires.push({ id: 'm12', d: P(R(cne[1]), L(cne[2])), both: true, label: 'global network', labelAt: 0.22, labelDy: -8 });
  wires.push({ id: 'm23', d: P(R(cne[2]), L(cne[3])), both: true });
  return {
    id: 'tg-cloudwan',
    name: 'AWS Cloud WAN core network and segments',
    desc: 'A core network policy defines segments, edge locations and tag-based attachment rules; VPCs land in prod, dev or shared segments through a core network edge in their Region. Prod reaches Prod in another Region (orange, then blue back), a Dev packet bound for Prod is dropped because segments are isolated (red), and the shared segment is shared with both.',
    wide: true, w: 960, h: 440, dur: 14,
    groups, nodes, wires,
    steps: [
      { n: 1, at: 'c1p', f: 0.16, dx: 0, dy: -11, text: 'The Prod VPC in us-east-1, attached to the prod segment by its tag, sends traffic for the Prod VPC in eu-west-1 to the core network edge in its Region.' },
      { n: 2, at: 'm12', f: 0.62, dy: 11, text: 'The core network edge carries the traffic over the AWS global network to the core network edge in eu-west-1, within the prod segment.' },
      { n: 3, at: 'c2p', f: 0.82, dx: 0, dy: -11, text: 'The eu-west-1 core network edge delivers the traffic to the Prod VPC there, and the reply returns the same way.' },
      { n: 4, at: 'c1d', f: 0.4, dx: 11, dy: 0, text: 'The core network edge drops a Dev VPC packet bound for Prod because the segments are isolated. Prod still reaches the shared segment, which is shared with both.' },
    ],
    timeline: [
      { wire: 'c1p', t: [0.03, 0.09], reverse: true, ring: 'cne1' },
      { wire: 'm12', t: [0.09, 0.17], ring: 'cne2' },
      { wire: 'c2p', t: [0.17, 0.23], ring: 'v2p' },
      { wire: 'c2p', t: [0.3, 0.35], reverse: true, kind: 'pk-2', ring: 'cne2' },
      { wire: 'm12', t: [0.35, 0.43], reverse: true, kind: 'pk-2', ring: 'cne1' },
      { wire: 'c1p', t: [0.43, 0.49], kind: 'pk-2', ring: 'v1p' },
      { wire: 'c1d', t: [0.56, 0.63], reverse: true, kind: 'pk-bad' },
      { wire: 'c1p', t: [0.84, 0.89], reverse: true, ring: 'cne1' },
      { wire: 'c1s', t: [0.89, 0.95], ring: 'v1s' },
    ],
    notes: [
      cap(32, 63, 'segments: prod, dev, shared', { anchor: 'start' }),
      cap(32, 74, 'attach by VPC tag: segment', { anchor: 'start' }),
      cap(32, 85, 'share: shared with prod, dev', { anchor: 'start' }),
      cap(32, 96, 'edges in us-east-1, eu-west-1,', { anchor: 'start' }),
      cap(32, 107, 'ap-southeast-2', { anchor: 'start' }),
      cap(32, 190, 'tag segment = prod', { anchor: 'start' }), cap(32, 202, 'isolated from dev', { anchor: 'start' }),
      cap(32, 282, 'tag segment = dev', { anchor: 'start' }), cap(32, 294, 'isolated from prod', { anchor: 'start' }),
      cap(32, 374, 'tag segment = shared', { anchor: 'start' }), cap(32, 386, 'shared with prod and dev', { anchor: 'start' }),
      warn(342, 140, 'Dev to Prod: segments are isolated', { anchor: 'middle', t: [0.64, 0.8] }),
    ],
    extra: dropX(342, 84, 0.64, 0.8, 14),
  };
})();

// ---------------------------------------------------------------------------------------------
// tg-lattice: Amazon VPC Lattice service network across VPCs and accounts
// ---------------------------------------------------------------------------------------------
const lattice = (() => {
  const LAT = 'aws-svc-vpc-lattice';
  const clA = nd('clA', EC2, 64, 104, 'Amazon EC2', { sub: '10.0.0.0/16' });
  const clB = nd('clB', 'aws-res-elastic-container-service-task', 64, 218, 'ECS task', { sub: '10.0.0.0/16' });
  const sv = [['sv1', 66, 'orders service'], ['sv2', 146, 'payments service'], ['sv3', 226, 'inventory service']]
    .map(([id, cy, label]) => nd(id, LAT, 262, cy, label, { wrap: 18, sub: 'auth policy' }));
  const tg1 = nd('tg1', EC2, 410, 66, 'EC2 target group', { wrap: 20 });
  const tg2 = nd('tg2', 'aws-res-lambda-function', 410, 146, 'Lambda target group', { wrap: 20 });
  const tg3 = nd('tg3', 'aws-res-elastic-container-service-task', 410, 226, 'ECS target group', { wrap: 20 });
  return {
    id: 'tg-lattice',
    name: 'Amazon VPC Lattice service network',
    desc: 'Two consumer VPCs with the same CIDR are associated with one VPC Lattice service network, which routes requests by service DNS name to services whose target groups (EC2, Lambda, ECS) live in other accounts. Auth policies on the network and on each service decide who may call; no transit gateway, peering or internet gateway is involved. Requests are orange, responses blue.',
    w: 480, h: 300, dur: 10,
    groups: [
      { kind: 'cloud', x: 6, y: 8, w: 468, h: 286 },
      { kind: 'vpc', x: 14, y: 48, w: 184, h: 100, label: 'VPC A' },
      { kind: 'vpc', x: 14, y: 162, w: 184, h: 100, label: 'VPC B' },
      { kind: 'gen', icon: LAT, x: 216, y: 30, w: 118, h: 258, label: 'Service network' },
      { kind: 'acct', x: 352, y: 30, w: 116, h: 76, label: 'Account B' },
      { kind: 'acct', x: 352, y: 110, w: 116, h: 76, label: 'Account C' },
      { kind: 'acct', x: 352, y: 190, w: 116, h: 76, label: 'Account D' },
    ],
    nodes: [clA, clB, ...sv, tg1, tg2, tg3],
    wires: [
      { id: 'a1', d: P(R(clA), [150, 104], [150, 66], L(sv[0])), label: 'VPC association', labelAt: 0.316, labelAnchor: 'end' },
      { id: 'a2', d: P(R(clA), [150, 104], [150, 146], L(sv[1])) },
      { id: 'b3', d: P(R(clB), [150, 218], [150, 226], L(sv[2])) },
      { id: 's1', d: P(R(sv[0]), L(tg1)), both: true },
      { id: 's2', d: P(R(sv[1]), L(tg2)), both: true },
      { id: 's3', d: P(R(sv[2]), L(tg3)), both: true },
    ],
    steps: [
      { n: 1, at: 'a1', f: 0.62, dy: -11, text: 'Clients in VPC A and VPC B, both 10.0.0.0/16, call services by DNS name. Each VPC association sends the requests into the VPC Lattice service network.' },
      { n: 2, at: 's1', f: 0.2, dy: -11, text: 'Amazon VPC Lattice evaluates the service network and service auth policies, then routes each request to the target group of the service in another account.' },
      { n: 3, at: 's1', f: 0.9, dy: -11, text: 'The EC2 and ECS targets in Account B and Account D respond, and VPC Lattice returns the responses to the clients.' },
    ],
    timeline: [
      { wire: 'a1', t: [0.05, 0.14], ring: 'sv1' }, { wire: 'b3', t: [0.05, 0.14], ring: 'sv3' },
      { wire: 's1', t: [0.15, 0.24], ring: 'tg1' }, { wire: 's3', t: [0.15, 0.24], ring: 'tg3' },
      { wire: 's1', t: [0.45, 0.54], reverse: true, kind: 'pk-2', ring: 'sv1' }, { wire: 's3', t: [0.45, 0.54], reverse: true, kind: 'pk-2', ring: 'sv3' },
      { wire: 'a1', t: [0.55, 0.64], reverse: true, kind: 'pk-2', ring: 'clA' }, { wire: 'b3', t: [0.55, 0.64], reverse: true, kind: 'pk-2', ring: 'clB' },
    ],
    notes: [cap(275, 282, 'network auth policy', { anchor: 'middle' })],
  };
})();

// ---------------------------------------------------------------------------------------------
// tg-gwlb: Gateway Load Balancer with a third-party firewall fleet, ingress routing
// ---------------------------------------------------------------------------------------------
const gwlb = (() => {
  const OFF = 166;                 // AZ B sits OFF below AZ A
  const net = nd('net', NET, 40, 240, 'Internet', { size: 40 });
  const igw = nd('igw', IGW, 132, 240, 'Internet gateway', { wrap: 8 });
  const az = (k, dy) => ({
    gwe: nd('ge' + k, VPCE, 266, 146 + dy, 'GWLB endpoint', { sub: 'PrivateLink' }),
    app: nd('ap' + k, EC2, 462, 146 + dy, 'Amazon EC2'),
    f1: nd('f1' + k, EC2, 798, 142 + dy, 'Firewall appliance', { wrap: 20 }),
    f2: nd('f2' + k, EC2, 798, 194 + dy, 'Firewall appliance', { wrap: 20 }),
  });
  const A = az('A', 0), Bz = az('B', OFF);
  const gw = nd('gw', GWLB, 650, 240, 'Gateway Load Balancer', { size: 40 });
  const hop = (a, y) => P(B(a.gwe), [266, y], [596, y], [596, 240], [626, 240]);   // GWLB endpoint -> GWLB, running below the application node
  return {
    id: 'tg-gwlb',
    name: 'Gateway Load Balancer with firewall appliances',
    desc: 'Ingress routing associates a route table with the internet gateway so inbound traffic for the application subnet goes to a Gateway Load Balancer endpoint. The endpoint sends it over AWS PrivateLink to the Gateway Load Balancer, which wraps it in GENEVE and spreads flows across the appliance fleet, then returns it through the endpoint to the application. The reply (blue) takes the same appliance back.',
    wide: true, w: 960, h: 436, dur: 16,
    groups: [
      { kind: 'cloud', x: 84, y: 8, w: 868, h: 420 },
      { kind: 'region', x: 96, y: 34, w: 844, h: 386, label: 'Region' },
      { kind: 'vpc', x: 108, y: 58, w: 476, h: 354, label: 'Application VPC', note: '10.0.0.0/16' },
      { kind: 'az', x: 164, y: 80, w: 408, h: 154, label: 'Availability Zone A' },
      { kind: 'az', x: 164, y: 246, w: 408, h: 154, label: 'Availability Zone B' },
      { kind: 'priv', x: 176, y: 104, w: 180, h: 122, label: 'Endpoint subnet', note: '0.0.0.0/0 > igw' },
      { kind: 'pub', x: 364, y: 104, w: 196, h: 122, label: 'Public subnet', note: '0.0.0.0/0 > gwlbe' },
      { kind: 'priv', x: 176, y: 270, w: 180, h: 122, label: 'Endpoint subnet', note: '0.0.0.0/0 > igw' },
      { kind: 'pub', x: 364, y: 270, w: 196, h: 122, label: 'Public subnet', note: '0.0.0.0/0 > gwlbe' },
      { kind: 'vpc', x: 608, y: 58, w: 320, h: 354, label: 'Appliance VPC', note: '10.100.0.0/16' },
      { kind: 'az', x: 716, y: 80, w: 200, h: 154, label: 'Availability Zone A' },
      { kind: 'az', x: 716, y: 246, w: 200, h: 154, label: 'Availability Zone B' },
      { kind: 'asg', x: 728, y: 104, w: 140, h: 122 }, { kind: 'asg', x: 728, y: 270, w: 140, h: 122 },
    ],
    nodes: [net, igw, A.gwe, A.app, A.f1, A.f2, Bz.gwe, Bz.app, Bz.f1, Bz.f2, gw],
    wires: [
      { id: 'ni', d: P(R(net), L(igw)), both: true },
      { id: 'ga', d: P(R(igw), [156, 240], [156, 146], L(A.gwe)) },
      { id: 'gb', d: P(R(igw), [156, 240], [156, 146 + OFF], L(Bz.gwe)) },
      { id: 'ge', d: hop(A, 214), both: true, label: 'AWS PrivateLink', labelAt: 0.5 },
      { id: 'gf', d: hop(Bz, 214 + OFF), both: true },
      { id: 'pa', d: P(R(A.gwe), L(A.app)), both: true },
      { id: 'pb', d: P(R(Bz.gwe), L(Bz.app)), both: true },
      { id: 'p1', d: P(R(gw, -8), [690, 232], [690, A.f1.cy], L(A.f1)), both: true, label: 'GENEVE', labelAt: 0.88 },
      { id: 'p2', d: P(R(gw, -8), [690, 232], [690, A.f2.cy], L(A.f2)), both: true },
      { id: 'q1', d: P(R(gw, 8), [702, 248], [702, Bz.f1.cy], L(Bz.f1)), both: true },
      { id: 'q2', d: P(R(gw, 8), [702, 248], [702, Bz.f2.cy], L(Bz.f2)), both: true },
    ],
    steps: [
      { n: 1, at: 'ni', f: 0.5, dy: -11, text: 'Traffic from the internet arrives at the internet gateway of the application VPC.' },
      { n: 2, at: 'ga', f: 0.8, dy: -11, text: 'The internet gateway route table (edge association) sends traffic for the public subnet in AZ A to the Gateway Load Balancer endpoint in that AZ.' },
      { n: 3, at: 'ge', f: 0.2, dy: -11, text: 'The Gateway Load Balancer endpoint sends the traffic over AWS PrivateLink to the Gateway Load Balancer in the appliance VPC.' },
      { n: 4, at: 'p1', f: 0.5, dx: 11, dy: 0, text: 'The Gateway Load Balancer sends it to a firewall appliance in a GENEVE tunnel and gets it back after inspection. Flow stickiness keeps each flow on one appliance.' },
      { n: 5, at: 'pa', f: 0.5, dy: -11, text: 'The endpoint delivers the inspected traffic to the instance. The reply follows the subnet default route back through the same endpoint and appliance.' },
    ],
    timeline: [
      { wire: 'ni', t: [0.02, 0.05] },
      { wire: 'ga', t: [0.05, 0.09], ring: 'geA' },
      { wire: 'ge', t: [0.09, 0.17], ring: 'gw' },
      { wire: 'p1', t: [0.17, 0.22], ring: 'f1A' },
      { wire: 'p1', t: [0.24, 0.29], reverse: true, ring: 'gw' },
      { wire: 'ge', t: [0.29, 0.37], reverse: true, ring: 'geA' },
      { wire: 'pa', t: [0.37, 0.42], ring: 'apA' },
      { wire: 'pa', t: [0.5, 0.55], reverse: true, kind: 'pk-2', ring: 'geA' },
      { wire: 'ge', t: [0.55, 0.63], kind: 'pk-2', ring: 'gw' },
      { wire: 'p1', t: [0.63, 0.68], kind: 'pk-2', ring: 'f1A' },
      { wire: 'p1', t: [0.7, 0.75], reverse: true, kind: 'pk-2', ring: 'gw' },
      { wire: 'ge', t: [0.75, 0.83], reverse: true, kind: 'pk-2', ring: 'geA' },
      { wire: 'ga', t: [0.83, 0.87], reverse: true, kind: 'pk-2', ring: 'igw' },
      { wire: 'ni', t: [0.87, 0.92], reverse: true, kind: 'pk-2', ring: 'net' },
    ],
    notes: [
      cap(190, 50, 'IGW route table (edge association):  10.0.2.0/24 > gwlbe-a,  10.0.12.0/24 > gwlbe-b', { anchor: 'start' }),
      cap(654, 304, 'flow stickiness:', { anchor: 'middle' }), cap(654, 314, 'same appliance in', { anchor: 'middle' }), cap(654, 324, 'both directions', { anchor: 'middle' }),
    ],
  };
})();

// ---------------------------------------------------------------------------------------------
// tg-nfw-distributed: AWS Network Firewall, one firewall endpoint per AZ inside the VPC
// ---------------------------------------------------------------------------------------------
const nfwDist = (() => {
  const OFF = 116;
  const net = nd('net', NET, 40, 194, 'Internet', { size: 40 });
  const igw = nd('igw', IGW, 148, 194, 'Internet gateway', { wrap: 8 });
  const az = (k, dy) => ({
    fw: nd('fw' + k, NFW_EP, 314, 146 + dy, 'Network Firewall endpoint', { wrap: 28 }),
    ec: nd('ec' + k, EC2, 545, 146 + dy, 'Amazon EC2'),
  });
  const A = az('A', 0), Bz = az('B', OFF);
  return {
    id: 'tg-nfw-distributed',
    name: 'Distributed AWS Network Firewall',
    desc: 'Each VPC gets its own firewall endpoint in a dedicated subnet in every AZ. The internet gateway route table (edge association) sends traffic for each public subnet to the endpoint in that AZ, the public subnet default route points back at the same endpoint, and the firewall subnet routes on to the internet gateway. Inbound traffic is orange, the reply blue.',
    wide: true, w: 960, h: 340, dur: 12,
    groups: [
      { kind: 'cloud', x: 84, y: 8, w: 868, h: 324 },
      { kind: 'region', x: 96, y: 34, w: 844, h: 290, label: 'Region' },
      { kind: 'vpc', x: 108, y: 58, w: 568, h: 254, label: 'VPC', note: '10.0.0.0/16' },
      { kind: 'az', x: 190, y: 82, w: 474, h: 108, label: 'Availability Zone A' },
      { kind: 'az', x: 190, y: 198, w: 474, h: 108, label: 'Availability Zone B' },
      { kind: 'priv', x: 202, y: 106, w: 224, h: 76, label: 'Firewall subnet', note: '0.0.0.0/0 > igw' },
      { kind: 'pub', x: 438, y: 106, w: 214, h: 76, label: 'Public subnet', note: '0.0.0.0/0 > fw endpoint' },
      { kind: 'priv', x: 202, y: 222, w: 224, h: 76, label: 'Firewall subnet', note: '0.0.0.0/0 > igw' },
      { kind: 'pub', x: 438, y: 222, w: 214, h: 76, label: 'Public subnet', note: '0.0.0.0/0 > fw endpoint' },
      { kind: 'gen', icon: 'aws-svc-network-firewall', x: 700, y: 110, w: 232, h: 136, label: 'AWS Network Firewall' },
    ],
    nodes: [net, igw, A.fw, A.ec, Bz.fw, Bz.ec],
    wires: [
      { id: 'ni', d: P(R(net), L(igw)), both: true },
      { id: 'ia', d: P(R(igw), [180, 194], [180, 146], L(A.fw)), both: true },
      { id: 'ib', d: P(R(igw), [180, 194], [180, 146 + OFF], L(Bz.fw)), both: true },
      { id: 'fa', d: P(R(A.fw), L(A.ec)), both: true },
      { id: 'fb', d: P(R(Bz.fw), L(Bz.ec)), both: true },
    ],
    steps: [
      { n: 1, at: 'ni', f: 0.5, dy: -11, text: 'Traffic from the internet arrives at the internet gateway.' },
      { n: 2, at: 'ia', f: 0.7, dy: -11, text: 'The internet gateway route table (edge association) sends traffic for each public subnet to the firewall endpoint in its AZ, and AWS Network Firewall applies the firewall policy.' },
      { n: 3, at: 'fa', f: 0.5, dy: -11, text: 'The firewall endpoint forwards allowed traffic to the instances. Their subnet default route points back at the same endpoint, so the replies are inspected too.' },
    ],
    timeline: [
      { wire: 'ni', t: [0.03, 0.07] },
      { wire: 'ia', t: [0.07, 0.15], ring: 'fwA' }, { wire: 'ib', t: [0.07, 0.15], ring: 'fwB' },
      { wire: 'fa', t: [0.16, 0.23], ring: 'ecA' }, { wire: 'fb', t: [0.16, 0.23], ring: 'ecB' },
      { wire: 'fa', t: [0.42, 0.49], reverse: true, kind: 'pk-2', ring: 'fwA' }, { wire: 'fb', t: [0.42, 0.49], reverse: true, kind: 'pk-2', ring: 'fwB' },
      { wire: 'ia', t: [0.5, 0.58], reverse: true, kind: 'pk-2', ring: 'igw' }, { wire: 'ib', t: [0.5, 0.58], reverse: true, kind: 'pk-2' },
      { wire: 'ni', t: [0.59, 0.64], reverse: true, kind: 'pk-2', ring: 'net' },
    ],
    notes: [
      cap(190, 50, 'IGW route table (edge association):  10.0.1.0/24 > fw endpoint A,  10.0.2.0/24 > fw endpoint B', { anchor: 'start' }),
      cap(716, 140, 'One firewall endpoint per AZ,', { anchor: 'start' }), cap(716, 151, 'in a dedicated firewall subnet', { anchor: 'start' }),
      cell(716, 172, 'Firewall policy'),
      cap(716, 184, 'stateless rule groups', { anchor: 'start' }), cap(716, 195, 'stateful rule groups', { anchor: 'start' }),
      cap(716, 216, 'Logs: Amazon S3, CloudWatch Logs,', { anchor: 'start' }), cap(716, 227, 'or Amazon Data Firehose', { anchor: 'start' }),
    ],
  };
})();

// ---------------------------------------------------------------------------------------------
// tg-private-nat: private NAT gateways translate overlapping CIDRs into routable secondary CIDRs
// ---------------------------------------------------------------------------------------------
const privateNat = (() => {
  const cl = nd('cl', EC2, 122, 108, 'Amazon EC2', { sub: '10.0.0.8' });
  const nat = nd('nat', NAT, 122, 222, 'Private NAT gateway');
  const tgw = nd('tgw', TGW, 240, 222, 'AWS Transit Gateway', { size: 48 });
  const alb = nd('alb', ALB, 384, 222, 'Application Load Balancer');
  const tgt = nd('tgt', EC2, 384, 108, 'Amazon EC2', { sub: '10.0.0.8' });
  return {
    id: 'tg-private-nat',
    name: 'Private NAT gateway for overlapping CIDRs',
    desc: 'Two VPCs both use 10.0.0.0/16, so each also gets a routable secondary CIDR from 100.64.0.0/10. The client sends to the other VPC\'s routable range, a private NAT gateway rewrites its source to a routable address, the Transit Gateway forwards between the routable subnets, and the load balancer reaches the overlapping target. Request orange, reply blue.',
    w: 480, h: 292, dur: 10,
    groups: [
      { kind: 'cloud', x: 6, y: 8, w: 468, h: 276 },
      { kind: 'vpc', x: 14, y: 40, w: 184, h: 236, label: 'VPC A', note: '10.0.0.0/16' },
      { kind: 'vpc', x: 282, y: 40, w: 184, h: 236, label: 'VPC B', note: '10.0.0.0/16' },
      { kind: 'priv', x: 22, y: 64, w: 168, h: 108, label: 'Non-routable', note: '10.0.0.0/24' },
      { kind: 'priv', x: 22, y: 180, w: 168, h: 88, label: 'Routable', note: '100.64.1.0/24' },
      { kind: 'priv', x: 290, y: 64, w: 168, h: 108, label: 'Non-routable', note: '10.0.0.0/24' },
      { kind: 'priv', x: 290, y: 180, w: 168, h: 88, label: 'Routable', note: '100.64.2.0/24' },
    ],
    nodes: [cl, nat, tgw, alb, tgt],
    wires: [
      { id: 'cn', d: P(B(cl), T(nat)), both: true },
      { id: 'nt', d: P(R(nat), L(tgw)), both: true },
      { id: 'ta', d: P(R(tgw), L(alb)), both: true },
      { id: 'at', d: P(T(alb), B(tgt)), both: true },
    ],
    steps: [
      { n: 1, at: 'cn', f: 0.5, dx: 11, dy: 0, text: 'The instance in VPC A sends to the load balancer at 100.64.2.10 in VPC B. Its subnet route sends 100.64.2.0/24 to the private NAT gateway.' },
      { n: 2, at: 'nt', f: 0.5, dy: -11, text: 'The private NAT gateway rewrites the source to its routable address, 100.64.1.7, and AWS Transit Gateway forwards the request on a static route to VPC B.' },
      { n: 3, at: 'at', f: 0.5, dx: 11, dy: 0, text: 'The Application Load Balancer sends the request to the target 10.0.0.8 in the non-routable subnet, and the reply returns the same way.' },
    ],
    timeline: [
      { wire: 'cn', t: [0.05, 0.13], ring: 'nat' },
      { wire: 'nt', t: [0.14, 0.19], ring: 'tgw' },
      { wire: 'ta', t: [0.19, 0.24], ring: 'alb' },
      { wire: 'at', t: [0.25, 0.32], ring: 'tgt' },
      { wire: 'at', t: [0.5, 0.57], reverse: true, kind: 'pk-2', ring: 'alb' },
      { wire: 'ta', t: [0.57, 0.62], reverse: true, kind: 'pk-2', ring: 'tgw' },
      { wire: 'nt', t: [0.62, 0.67], reverse: true, kind: 'pk-2', ring: 'nat' },
      { wire: 'cn', t: [0.68, 0.76], reverse: true, kind: 'pk-2', ring: 'cl' },
    ],
    notes: [
      // route entries per subnet
      cap(30, 110, '100.64.2.0/24', { anchor: 'start' }), cap(30, 120, '> private NAT', { anchor: 'start' }),
      cap(30, 226, '100.64.2.0/24', { anchor: 'start' }), cap(30, 236, '> TGW', { anchor: 'start' }),
      cap(296, 238, '100.64.1.0/24', { anchor: 'start' }), cap(296, 248, '> TGW', { anchor: 'start' }),
      cap(296, 110, 'ALB targets', { anchor: 'start' }), cap(296, 120, 'in this subnet', { anchor: 'start' }),
      // transit gateway static routes (propagation disabled)
      cell(240, 66, 'TGW routes', { anchor: 'middle' }),
      cap(240, 80, '100.64.1.0/24', { anchor: 'middle' }), cap(240, 90, '> VPC A', { anchor: 'middle' }),
      cap(240, 104, '100.64.2.0/24', { anchor: 'middle' }), cap(240, 114, '> VPC B', { anchor: 'middle' }),
      cap(240, 128, '(static)', { anchor: 'middle' }),
      // the translation, while the packet moves
      cap(240, 170, 'src 10.0.0.8', { anchor: 'middle', t: [0.04, 0.14] }), cap(240, 180, 'dst 100.64.2.10', { anchor: 'middle', t: [0.04, 0.14] }),
      cap(240, 170, 'src 100.64.1.7', { anchor: 'middle', t: [0.14, 0.3] }), cap(240, 180, 'dst 100.64.2.10', { anchor: 'middle', t: [0.14, 0.3] }),
    ],
  };
})();

// ---------------------------------------------------------------------------------------------
// tg-ipam: Amazon VPC IP Address Manager pools and allocations
// ---------------------------------------------------------------------------------------------
const ipam = (() => {
  const IPAM = 'aws-svc-virtual-private-cloud';
  const ipamN = nd('ipam', IPAM, 50, 62, 'IP Address Manager', { size: 40, sub: 'Amazon VPC IPAM' });
  const acct = nd('acct', 'aws-res-organizations-account', 44, 210, 'Account D', { size: 32 });
  const slot = (id, cx, cy, who, cidr) => nd(id, VPCI, cx, cy, who, { sub: cidr });
  const a = slot('va', 196, 98, 'Account A VPC', '10.0.0.0/16'), b = slot('vb', 196, 154, 'Account B VPC', '10.1.0.0/16');
  const nv = slot('nv', 196, 210, 'Account D VPC', '10.2.0.0/16');
  const c = slot('vc', 377, 98, 'Account C VPC', '10.16.0.0/16'), d = slot('vd', 377, 154, 'Account A VPC', '10.17.0.0/16');
  return {
    id: 'tg-ipam',
    name: 'Amazon VPC IPAM pools and allocations',
    desc: 'A private-scope top-level pool (10.0.0.0/8) is split into one pool per Region and shared with member accounts through AWS RAM. When an account creates a VPC and asks the Regional pool for a /16, IPAM allocates the next free block (10.2.0.0/16) so it cannot overlap the others. Request orange, answer blue.',
    w: 480, h: 292, dur: 10,
    groups: [
      { kind: 'cloud', x: 6, y: 8, w: 468, h: 276 },
      { kind: 'gen', x: 96, y: 30, w: 372, h: 246, label: 'Top-level pool (private scope)', note: '10.0.0.0/8', icon: false },
      { kind: 'gen', x: 106, y: 56, w: 180, h: 212, label: 'us-east-1 pool', note: '10.0.0.0/12', icon: false },
      { kind: 'gen', x: 296, y: 56, w: 162, h: 212, label: 'eu-west-1 pool', note: '10.16.0.0/12', icon: false },
    ],
    nodes: [ipamN, acct, a, b, nv, c, d],
    wires: [
      { id: 'im', d: P(R(ipamN), [96, 62]), dashed: true },
      { id: 'rq', d: P(R(acct), L(nv)), both: true, label: 'new VPC /16', labelAt: 0.78 },
    ],
    steps: [{ n: 1, at: 'rq', f: 0.16, dy: -12, text: 'Account D creates a VPC with a /16 from the us-east-1 pool it received through AWS RAM. IPAM allocates 10.2.0.0/16, a free block, so the VPC cannot overlap the others.' }],
    timeline: [
      { wire: 'rq', t: [0.05, 0.17] },
      { ring: 'nv', t: [0.19, 0.22], kind: 'pk-2' },
      { wire: 'rq', t: [0.3, 0.4], reverse: true, kind: 'pk-2', ring: 'acct' },
    ],
    effects: [{ appear: 'nv', t: [0.2, 0.97], ghost: true }],
    notes: [
      cap(44, 142, 'pools shared via', { anchor: 'middle' }), cap(44, 152, 'AWS RAM', { anchor: 'middle' }),
      cap(44, 172, 'allocates the', { anchor: 'middle', t: [0.17, 0.5] }), cap(44, 182, 'next free /16', { anchor: 'middle', t: [0.17, 0.5] }),
      cap(377, 208, 'free: 10.18.0.0/16', { anchor: 'middle' }), cap(377, 218, 'and above', { anchor: 'middle' }),
    ],
  };
})();

export default {
  section: { id: 'transit', title: 'TRANSIT & NETWORK SEGMENTATION' },
  diagrams: [segmentation, connect, dxgw, cloudwan, gwlb, nfwDist, lattice, privateNat, ipam],
};
