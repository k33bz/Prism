// Service endpoints & private access family: ep-* diagrams. Build: node catalog/aws-kit/awd.mjs build catalog/aws-kit/specs/endpoints.mjs
// Authoring note: coordinates come from small helpers (node centers, edge ports, H/V paths) so every diagram sits on an explicit grid.
// Text uses the kit's `notes`, group `note` and wire label offsets; blocked traffic uses the kit's `marks` (a red X) and red
// rings on the failed packets' timeline entries. No raw `extra`.
// Already covered elsewhere (vpc.mjs): vp-endpoints (basic gateway + interface endpoint) and vp-privatelink (provider/consumer service).

// ---- icon ids ----
const EC2 = 'aws-res-ec2-instance';
const VPCE = 'aws-res-vpc-endpoints';
const ENI = 'aws-res-vpc-elastic-network-interface';
const TGW = 'aws-svc-transit-gateway';
const TGWA = 'aws-res-transit-gateway-attachment';
const PL = 'aws-svc-privatelink';
const S3 = 'aws-svc-simple-storage-service';
const BUCKET = 'aws-res-simple-storage-service-bucket';
const SQS = 'aws-svc-simple-queue-service';
const PHZ = 'aws-res-route-53-hosted-zone';
const RESOLVER = 'aws-res-route-53-resolver';
const NET = 'aws-res-internet';

// ---- layout helpers (shared with the other specs: ../place.mjs) ----
import { wrapLines, lblH, R, L, T, B, Bi, P, centered } from '../place.mjs';
// node by CENTER (cx, cy); default 32px icon
const nd = centered(32);
// rescale a timeline so its last window ends at `end` of the clock (keeps the idle tail short and every window ordered)
const fit = (tl, end = 0.93) => {
  const k = end / Math.max(...tl.map((e) => e.t[1]));
  const r = (n) => Math.round(n * k * 1000) / 1000;
  return tl.map((e) => ({ ...e, t: [r(e.t[0]), r(e.t[1])] }));
};
const D = [];

// ---------------------------------------------------------------------------------------------
// ep-centralized: shared interface endpoints, private hosted zone per service, spokes over Transit Gateway
// ---------------------------------------------------------------------------------------------
D.push((() => {
  const dur = 10;
  const ecA = nd('eca', EC2, 118, 140, 'Amazon EC2');
  const atA = nd('ata', TGWA, 184, 140, 'Attachment');
  const ecB = nd('ecb', EC2, 118, 346, 'Amazon EC2');
  const atB = nd('atb', TGWA, 184, 346, 'Attachment');
  const phz = nd('phz', PHZ, 292, 243, 'Private hosted zone', { size: 40, sub: 'sqs.us-east-1.amazonaws.com' });
  const tgw = nd('tgw', TGW, 420, 243, 'AWS Transit Gateway', { size: 48 });
  const saA = nd('saa', TGWA, 560, 164, 'Attachment');
  const saB = nd('sab', TGWA, 560, 322, 'Attachment');
  const epA = nd('epa', VPCE, 704, 164, 'Interface endpoint', { wrap: 18, sub: 'ENI 10.0.1.25' });
  const epB = nd('epb', VPCE, 704, 322, 'Interface endpoint', { wrap: 18, sub: 'ENI 10.0.2.25' });
  const pl = nd('pl', PL, 832, 243, 'AWS PrivateLink', { size: 40 });
  const sqs = nd('sqs', SQS, 906, 243, 'Amazon SQS', { size: 36 });
  return {
    id: 'ep-centralized',
    name: 'Centralized interface endpoints',
    aria: 'Architecture diagram: interface endpoints for Amazon SQS in a shared services VPC with private DNS disabled, a Route 53 private hosted zone for sqs.us-east-1.amazonaws.com associated with two spoke VPCs, and the spokes reaching the endpoint network interfaces over a Transit Gateway.',
    desc: 'Interface endpoints for Amazon SQS live once, in a shared services VPC, with private DNS turned off. A Route 53 private hosted zone for sqs.us-east-1.amazonaws.com, associated with each spoke VPC, answers the DNS query with the endpoint network interface IPs (orange query, blue answer). The spoke then sends the request across the Transit Gateway to the endpoint, which reaches Amazon SQS over AWS PrivateLink.',
    wide: true, w: 960, h: 420, dur,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 944, h: 404 },
      { kind: 'region', x: 16, y: 32, w: 928, h: 372, label: 'us-east-1' },
      { kind: 'vpc', x: 28, y: 92, w: 196, h: 96, label: 'Spoke A', note: '10.0.0.0/16 > tgw' },
      { kind: 'vpc', x: 28, y: 298, w: 196, h: 96, label: 'Spoke B', note: '10.0.0.0/16 > tgw' },
      { kind: 'vpc', x: 480, y: 48, w: 308, h: 340, label: 'Shared services VPC', note: '10.0.0.0/16' },
      { kind: 'az', x: 488, y: 72, w: 292, h: 150, label: 'Availability Zone A' },
      { kind: 'az', x: 488, y: 230, w: 292, h: 150, label: 'Availability Zone B' },
      { kind: 'priv', x: 496, y: 96, w: 128, h: 118, label: 'TGW subnet' },
      { kind: 'priv', x: 636, y: 96, w: 136, h: 118, label: 'Endpoint subnet' },
      { kind: 'priv', x: 496, y: 254, w: 128, h: 118, label: 'TGW subnet' },
      { kind: 'priv', x: 636, y: 254, w: 136, h: 118, label: 'Endpoint subnet' },
    ],
    nodes: [ecA, atA, ecB, atB, phz, tgw, saA, saB, epA, epB, pl, sqs],
    wires: [
      { id: 'dns', d: P(B(ecA), [118, 243], L(phz)), dashed: true, both: true, label: 'DNS query', labelAt: 0.8 },
      { id: 'dnsb', d: P(T(ecB), [118, 243], L(phz)), dashed: true, both: true },
      { id: 'iA', d: P(R(ecA), L(atA)) },
      { id: 'iB', d: P(R(ecB), L(atB)) },
      { id: 'sA', d: P(R(atA), [376, 140], [376, 235], L(tgw, -8)), both: true },
      { id: 'sB', d: P(R(atB), [376, 346], [376, 251], L(tgw, 8)), both: true },
      { id: 'tA', d: P(R(tgw, -8), [468, 235], [468, 164], L(saA)), both: true },
      { id: 'tB', d: P(R(tgw, 8), [468, 251], [468, 322], L(saB)), both: true },
      { id: 'eA', d: P(R(saA), L(epA)), both: true },
      { id: 'eB', d: P(R(saB), L(epB)), both: true },
      { id: 'pA', d: P(R(epA), [832, 164], T(pl)), both: true },
      { id: 'pB', d: P(R(epB), [832, 322], B(pl)), both: true },
      { id: 'q', d: P(R(pl), L(sqs)), both: true },
    ],
    steps: [
      { n: 1, at: 'dns', f: 0.5, dy: -11, text: 'Each spoke instance resolves sqs.us-east-1.amazonaws.com. The private hosted zone associated with its VPC returns the endpoint IPs 10.0.1.25 and 10.0.2.25.' },
      { n: 2, at: 'sA', f: 0.2, dy: -11, text: 'The instance sends the request to an endpoint IP. The spoke VPC route table sends it to AWS Transit Gateway, which forwards it to the shared services VPC attachment.' },
      { n: 3, at: 'eA', f: 0.5, dy: -11, text: 'The Transit Gateway attachment in the shared services VPC passes the request to the interface endpoint network interface in the endpoint subnet.' },
      { n: 4, at: 'q', f: 0.5, dy: -11, text: 'The interface endpoint sends the request to Amazon SQS over AWS PrivateLink, and the response returns the same way to the spoke instance.' },
    ],
    timeline: fit([
      { wire: 'dns', t: [0.03, 0.1], ring: 'phz' }, { wire: 'dnsb', t: [0.03, 0.1] },
      { wire: 'dns', t: [0.12, 0.19], reverse: true, kind: 'pk-2', ring: 'eca' }, { wire: 'dnsb', t: [0.12, 0.19], reverse: true, kind: 'pk-2', ring: 'ecb' },
      { wire: 'iA', t: [0.23, 0.26] }, { wire: 'iB', t: [0.23, 0.26] },
      { wire: 'sA', t: [0.26, 0.31], ring: 'tgw' }, { wire: 'sB', t: [0.26, 0.31] },
      { wire: 'tA', t: [0.31, 0.36], ring: 'saa' }, { wire: 'tB', t: [0.31, 0.36], ring: 'sab' },
      { wire: 'eA', t: [0.36, 0.4], ring: 'epa' }, { wire: 'eB', t: [0.36, 0.4], ring: 'epb' },
      { wire: 'pA', t: [0.4, 0.46], ring: 'pl' }, { wire: 'pB', t: [0.4, 0.46] },
      { wire: 'q', t: [0.46, 0.52], ring: 'sqs' },
      { wire: 'q', t: [0.58, 0.64], reverse: true, kind: 'pk-2', ring: 'pl' },
      { wire: 'pA', t: [0.64, 0.7], reverse: true, kind: 'pk-2', ring: 'epa' }, { wire: 'pB', t: [0.64, 0.7], reverse: true, kind: 'pk-2', ring: 'epb' },
      { wire: 'eA', t: [0.7, 0.74], reverse: true, kind: 'pk-2' }, { wire: 'eB', t: [0.7, 0.74], reverse: true, kind: 'pk-2' },
      { wire: 'tA', t: [0.74, 0.79], reverse: true, kind: 'pk-2', ring: 'tgw' }, { wire: 'tB', t: [0.74, 0.79], reverse: true, kind: 'pk-2' },
      { wire: 'sA', t: [0.79, 0.84], reverse: true, kind: 'pk-2', ring: 'ata' }, { wire: 'sB', t: [0.79, 0.84], reverse: true, kind: 'pk-2', ring: 'atb' },
    ], 0.93),
    notes: [
      { x: 292, y: 203, text: 'Zone associated with\neach spoke VPC', anchor: 'middle' },
      { x: 704, y: 134, text: 'private DNS disabled', anchor: 'middle' },
      { x: 704, y: 292, text: 'private DNS disabled', anchor: 'middle' },
      { x: 193, y: 258, text: 'A: 10.0.1.25, 10.0.2.25', anchor: 'middle', t: [0.14, 0.3] },
      { x: 936, y: 330, text: 'Repeat per service:\none endpoint and\none hosted zone', anchor: 'end' },
    ],
  };
})());

// ---------------------------------------------------------------------------------------------
// ep-onprem-s3: on-premises access to Amazon S3 through an S3 interface endpoint (gateway endpoints are not reachable)
// ---------------------------------------------------------------------------------------------
D.push((() => {
  const dur = 10;
  const cli = nd('cli', 'aws-res-client', 56, 106, 'On-premises client');
  const dns = nd('dns', 'aws-res-servers', 56, 252, 'On-premises DNS', { sub: 'forwarder' });
  // one on-premises router serves both links: "customer router" is right for Direct Connect and for the VPN device
  // ("customer gateway" is only the VPN term)
  const cgw = nd('cgw', 'aws-res-vpc-customer-gateway', 116, 166, 'Customer router');
  const dx = nd('dx', 'aws-svc-direct-connect', 234, 112, 'AWS Direct Connect', { size: 40, sub: 'private VIF' });
  const vpn = nd('vpn', 'aws-svc-site-to-site-vpn', 234, 212, 'AWS Site-to-Site VPN', { size: 40, wrap: 16 });
  const vgw = nd('vgw', 'aws-res-vpc-vpn-gateway', 356, 161, 'Virtual private gateway', { wrap: 16 });
  const res = nd('res', RESOLVER, 500, 114, 'Route 53 VPC Resolver inbound endpoint', { wrap: 22, sub: 'ENI per AZ' });
  const s3ep = nd('s3ep', VPCE, 500, 208, 'S3 interface endpoint', { wrap: 22, sub: 'ENI per AZ' });
  const ec2 = nd('ec2', EC2, 470, 336, 'Amazon EC2');
  const gwe = nd('gwe', VPCE, 590, 336, 'S3 gateway endpoint', { sub: 'route table target' });
  const s3 = nd('s3', S3, 880, 208, 'Amazon S3', { size: 40 });
  return {
    id: 'ep-onprem-s3',
    name: 'On-premises access to Amazon S3',
    aria: 'Architecture diagram: an on-premises client reaches Amazon S3 over AWS Direct Connect or Site-to-Site VPN through an S3 interface endpoint, resolving the name with a Route 53 VPC Resolver inbound endpoint; the S3 gateway endpoint cannot be reached from on-premises.',
    desc: 'An on-premises client reaches Amazon S3 over Direct Connect or Site-to-Site VPN through an S3 interface endpoint. Its DNS server forwards the S3 name to a Route 53 VPC Resolver inbound endpoint (orange), the answer returns the endpoint IPs (blue), and the HTTPS request follows them to S3 over AWS PrivateLink; the client could instead call the endpoint-specific name. The gateway endpoint serves only the VPC, so traffic from on-premises cannot use it (red).',
    wide: true, w: 960, h: 432, dur,
    groups: [
      { kind: 'dc', x: 8, y: 56, w: 150, h: 272 },
      { kind: 'gen', x: 172, y: 56, w: 116, h: 272, label: 'Hybrid link' },
      { kind: 'cloud', x: 306, y: 8, w: 646, h: 416 },
      { kind: 'region', x: 314, y: 32, w: 630, h: 384, label: 'us-east-1' },
      { kind: 'vpc', x: 420, y: 52, w: 362, h: 352, label: 'VPC', note: '10.0.0.0/16' },
      { kind: 'priv', x: 432, y: 78, w: 338, h: 180, label: 'Private subnets' },
      { kind: 'priv', x: 432, y: 306, w: 338, h: 90, label: 'Private subnet' },
    ],
    nodes: [cli, dns, cgw, dx, vpn, vgw, res, s3ep, ec2, gwe, s3],
    wires: [
      { id: 'q0', d: P(B(cli), T(dns)) },
      { id: 'q1', d: P(R(dns), [116, 252], B(cgw)) },
      { id: 'c1', d: P(R(cli), [116, 106], T(cgw)) },
      { id: 'h1', d: P(R(cgw), [165, 166], [165, 112], L(dx)), both: true },
      { id: 'h1v', d: P(R(cgw), [165, 166], [165, 212], L(vpn)), both: true, dashed: true },
      { id: 'h2', d: P(R(dx), [297, 112], [297, 155], L(vgw, -6)), both: true },
      { id: 'h2v', d: P(R(vpn), [297, 212], [297, 167], L(vgw, 6)), both: true, dashed: true },
      { id: 'r1', d: P(R(vgw, -6), [406, 155], [406, 114], L(res)), both: true },
      { id: 's1', d: P(R(vgw, 6), [406, 167], [406, 208], L(s3ep)), both: true },
      { id: 's2', d: P(R(s3ep), L(s3)), both: true, label: 'AWS PrivateLink', labelAt: 0.9 },
      { id: 'g1', d: P(R(ec2), L(gwe)) },
      { id: 'g2', d: P(R(gwe), [880, 336], B(s3)) },
      { id: 'bad1', d: P(R(vgw, 10), [406, 171], [406, 278], [540, 278]), hot: true, dashed: true, arrow: false },
      { id: 'bad2', d: P([540, 278], [590, 278], T(gwe)), hot: true, dashed: true },
    ],
    steps: [
      { n: 1, at: 'q0', f: 0.5, dx: 11, dy: 0, text: 'The on-premises client asks the on-premises DNS forwarder for the S3 name, and the forwarder sends the query to the Route 53 VPC Resolver inbound endpoint.' },
      { n: 2, at: 'h2', f: 0.08, dy: -11, text: 'The query crosses AWS Direct Connect or AWS Site-to-Site VPN to the inbound endpoint, and the Route 53 VPC Resolver answers with the S3 interface endpoint IPs.' },
      { n: 3, at: 's2', f: 0.5, dy: -11, text: 'The client sends its HTTPS request over the same link to the S3 interface endpoint, which carries it to Amazon S3 over AWS PrivateLink.' },
      { n: 4, at: 'g2', f: 0.62, dy: 11, text: 'Instances in the VPC reach Amazon S3 through the S3 gateway endpoint, a route table target. Traffic from on-premises cannot use the gateway endpoint.' },
    ],
    timeline: fit([
      { wire: 'q0', t: [0.03, 0.06] }, { wire: 'q1', t: [0.06, 0.09] },
      { wire: 'h1', t: [0.09, 0.14], ring: 'dx' }, { wire: 'h2', t: [0.14, 0.18], ring: 'vgw' }, { wire: 'r1', t: [0.18, 0.22], ring: 'res' },
      { wire: 'r1', t: [0.24, 0.28], reverse: true, kind: 'pk-2', ring: 'vgw' }, { wire: 'h2', t: [0.28, 0.32], reverse: true, kind: 'pk-2', ring: 'dx' },
      { wire: 'h1', t: [0.32, 0.37], reverse: true, kind: 'pk-2', ring: 'cgw' }, { wire: 'q1', t: [0.37, 0.4], reverse: true, kind: 'pk-2', ring: 'dns' },
      { wire: 'q0', t: [0.4, 0.43], reverse: true, kind: 'pk-2', ring: 'cli' },
      { wire: 'c1', t: [0.47, 0.5] }, { wire: 'h1', t: [0.5, 0.55], ring: 'dx' }, { wire: 'h2', t: [0.55, 0.59], ring: 'vgw' },
      { wire: 's1', t: [0.59, 0.63], ring: 's3ep' }, { wire: 's2', t: [0.63, 0.7], ring: 's3' },
      { wire: 'g1', t: [0.73, 0.77], ring: 'gwe' }, { wire: 'g2', t: [0.77, 0.83], ring: 's3' },
      { wire: 'bad1', t: [0.87, 0.93], kind: 'pk-bad', ring: { x: 540, y: 278, r: 11 } },
    ], 0.95),
    notes: [
      { x: 234, y: 180, text: 'or', anchor: 'middle' },
      { x: 14, y: 350, text: 'Option 1: endpoint-specific name', kind: 'label', anchor: 'start' },
      { x: 14, y: 364, text: 'bucket.vpce-0a1b2c3d-4e5f.s3.us-east-1.vpce.amazonaws.com', anchor: 'start' },
      { x: 14, y: 386, text: 'Option 2: private DNS for inbound endpoints', kind: 'label', anchor: 'start' },
      { x: 14, y: 400, text: 'forward s3.us-east-1.amazonaws.com to the\nResolver inbound endpoint', anchor: 'start' },
      { x: 648, y: 352, text: 'Not reachable from\non-premises, peered VPCs\nor Transit Gateway', kind: 'warn', anchor: 'start' },
      { x: 548, y: 108, text: 'returns the S3\nendpoint IPs', anchor: 'start', t: [0.27, 0.45] },
    ],
    marks: [{ x: 540, y: 278 }],
  };
})());

// ---------------------------------------------------------------------------------------------
// ep-policies: least privilege with an S3 gateway endpoint policy plus a bucket policy on aws:SourceVpce
// ---------------------------------------------------------------------------------------------
D.push((() => {
  const dur = 8;
  const ec2 = nd('ec2', EC2, 141, 130, 'Amazon EC2');
  const gwe = nd('gwe', VPCE, 236, 130, 'S3 gateway endpoint');
  const other = nd('other', BUCKET, 404, 100, 'other-bucket');
  const data = nd('data', BUCKET, 404, 166, 'analytics-data');
  const net = nd('net', NET, 30, 220, 'Internet', { size: 32 });
  return {
    id: 'ep-policies',
    name: 'Endpoint policy and bucket policy',
    aria: 'Architecture diagram: an EC2 instance in a private subnet reaches Amazon S3 through a gateway endpoint whose endpoint policy allows only the analytics-data bucket; a request to another bucket is denied by the endpoint policy, and a request from the internet is denied by the bucket policy that requires aws:SourceVpce.',
    desc: 'Two policies enforce least privilege. The S3 gateway endpoint policy allows only the analytics-data bucket, and that bucket denies any request that does not arrive through the endpoint (aws:SourceVpce). A request from the instance to analytics-data succeeds (orange, response blue); a request to another bucket fails at the endpoint policy and one from the internet fails at the bucket policy (red).',
    w: 480, h: 300, dur,
    groups: [
      { kind: 'cloud', x: 64, y: 8, w: 408, h: 236 },
      { kind: 'region', x: 72, y: 32, w: 392, h: 204, label: 'us-east-1' },
      { kind: 'vpc', x: 84, y: 56, w: 192, h: 140, label: 'VPC' },
      { kind: 'priv', x: 92, y: 78, w: 98, h: 110, label: 'Private subnet' },
      { kind: 'gen', icon: S3, x: 352, y: 56, w: 104, h: 152, label: 'Amazon S3' },
    ],
    nodes: [ec2, gwe, other, data, net],
    wires: [
      { id: 'g1', d: P(R(ec2), L(gwe)) },
      { id: 'trunk', d: P(R(gwe), [312, 130]), arrow: false },
      { id: 'a1', d: P([312, 130], [312, 100], [334, 100]), hot: true, dashed: true, arrow: false },
      { id: 'a2', d: P([334, 100], L(other)), hot: true, dashed: true },
      { id: 'b', d: P([312, 130], [312, 166], L(data)), label: 'allowed', labelAt: 0.5 },
      { id: 'n1', d: P(R(net), [300, 220]), hot: true, dashed: true, arrow: false },
      { id: 'n2', d: P([300, 220], [404, 220], B(data)), hot: true, dashed: true },
    ],
    steps: [
      { n: 1, at: 'g1', f: 0.5, text: 'The instance requests an object in analytics-data through the S3 gateway endpoint. The endpoint policy and the bucket policy both allow it, and the response returns.' },
      { n: 2, at: 'a1', f: 0.3, dx: -11, dy: 0, text: 'The endpoint policy denies a request from the instance to other-bucket, because it allows only analytics-data.' },
      { n: 3, at: 'n1', f: 0.45, text: 'The bucket policy denies a request from the internet to analytics-data, because it does not arrive through the endpoint (aws:SourceVpce).' },
    ],
    timeline: fit([
      { wire: 'g1', t: [0.04, 0.09], ring: 'gwe' }, { wire: 'trunk', t: [0.09, 0.12] }, { wire: 'b', t: [0.12, 0.2], ring: 'data' },
      { wire: 'b', t: [0.24, 0.32], reverse: true, kind: 'pk-2' }, { wire: 'trunk', t: [0.32, 0.35], reverse: true, kind: 'pk-2' },
      { wire: 'g1', t: [0.35, 0.4], reverse: true, kind: 'pk-2', ring: 'ec2' },
      { wire: 'g1', t: [0.46, 0.51], ring: 'gwe' }, { wire: 'trunk', t: [0.51, 0.54] },
      { wire: 'a1', t: [0.54, 0.62], kind: 'pk-bad', ring: { x: 334, y: 100, r: 11 } },
      { wire: 'n1', t: [0.7, 0.8], kind: 'pk-bad', ring: { x: 300, y: 220, r: 11 } },
    ], 0.94),
    notes: [
      { x: 84, y: 262, text: 'Endpoint policy', kind: 'label', anchor: 'start' },
      { x: 84, y: 274, text: 'Allow s3:GetObject and s3:PutObject\non analytics-data only', anchor: 'start' },
      { x: 270, y: 262, text: 'Bucket policy on analytics-data', kind: 'label', anchor: 'start' },
      { x: 270, y: 274, text: 'Deny s3:* unless aws:SourceVpce\nequals vpce-0a1b2c3d', anchor: 'start' },
      { x: 334, y: 89, text: 'denied', kind: 'warn', anchor: 'middle' },
      { x: 300, y: 211, text: 'denied', kind: 'warn', anchor: 'middle' },
    ],
    marks: [{ x: 334, y: 100 }, { x: 300, y: 220 }],
  };
})());

// ---------------------------------------------------------------------------------------------
// ep-private-api: private REST API reachable only through an execute-api interface endpoint
// ---------------------------------------------------------------------------------------------
D.push((() => {
  const dur = 8;
  const net = nd('net', NET, 30, 60, 'Internet', { size: 32 });
  const ec2 = nd('ec2', EC2, 122, 156, 'Amazon EC2');
  const enp = nd('enp', VPCE, 204, 156, 'Interface endpoint', { sub: 'execute-api' });
  const pl = nd('pl', PL, 282, 156, 'AWS PrivateLink');
  const api = nd('api', 'aws-svc-api-gateway', 350, 156, 'Amazon API Gateway', { size: 40, sub: 'private REST API' });
  const fn = nd('fn', 'aws-svc-lambda', 428, 156, 'AWS Lambda', { size: 36 });
  return {
    id: 'ep-private-api',
    name: 'Private API Gateway API',
    aria: 'Architecture diagram: an EC2 instance in a private subnet calls a private Amazon API Gateway REST API through an execute-api interface endpoint and AWS PrivateLink; the API resource policy allows only that endpoint, so a call from the internet is refused with 403 Forbidden.',
    desc: 'A private REST API in Amazon API Gateway can be called only through an execute-api interface endpoint. An instance in a private subnet reaches the API over AWS PrivateLink, the resource policy allows that endpoint (aws:SourceVpce), and the Lambda backend answers (request orange, response blue). A call from the internet is refused with 403 Forbidden (red).',
    w: 480, h: 292, dur,
    groups: [
      { kind: 'cloud', x: 64, y: 8, w: 408, h: 276 },
      { kind: 'region', x: 72, y: 32, w: 392, h: 244, label: 'us-east-1' },
      { kind: 'vpc', x: 80, y: 90, w: 164, h: 140, label: 'VPC' },
      { kind: 'priv', x: 88, y: 112, w: 148, h: 110, label: 'Private subnet' },
    ],
    nodes: [net, ec2, enp, pl, api, fn],
    wires: [
      { id: 'g1', d: P(R(ec2), L(enp)) },
      { id: 'g2', d: P(R(enp), L(pl)) },
      { id: 'g3', d: P(R(pl), L(api)), both: true },
      { id: 'g4', d: P(R(api), L(fn)), both: true },
      { id: 'n', d: P(R(net), [350, 60], T(api)), hot: true, dashed: true, label: 'from the internet', labelAt: 0.3, labelDy: 12 },
    ],
    steps: [
      { n: 1, at: 'g1', f: 0.5, text: 'The instance calls the private API. Private DNS resolves the execute-api name to the interface endpoint, which receives the request.' },
      { n: 2, at: 'g3', f: 0.5, dy: -11, text: 'AWS PrivateLink carries the request to Amazon API Gateway. The resource policy allows this endpoint (aws:SourceVpce), and AWS Lambda returns the response.' },
      { n: 3, at: 'n', f: 0.5, dy: -11, text: 'Amazon API Gateway refuses a call from the internet with 403 Forbidden, because it does not arrive through the interface endpoint.' },
    ],
    timeline: fit([
      { wire: 'g1', t: [0.04, 0.09], ring: 'enp' }, { wire: 'g2', t: [0.09, 0.14], ring: 'pl' }, { wire: 'g3', t: [0.14, 0.2], ring: 'api' },
      { wire: 'g4', t: [0.2, 0.26], ring: 'fn' },
      { wire: 'g4', t: [0.3, 0.36], reverse: true, kind: 'pk-2', ring: 'api' }, { wire: 'g3', t: [0.36, 0.42], reverse: true, kind: 'pk-2', ring: 'pl' },
      { wire: 'g2', t: [0.42, 0.47], reverse: true, kind: 'pk-2', ring: 'enp' }, { wire: 'g1', t: [0.47, 0.52], reverse: true, kind: 'pk-2', ring: 'ec2' },
      { wire: 'n', t: [0.6, 0.8], kind: 'pk-bad', ring: { x: 350, y: 124, r: 11 } },
    ], 0.94),
    notes: [
      { x: 350, y: 238, text: 'Resource policy', kind: 'label', anchor: 'middle' },
      { x: 350, y: 250, text: 'Allow execute-api:Invoke\nif aws:SourceVpce =\nvpce-0a1b2c3d', anchor: 'middle' },
      { x: 360, y: 108, text: '403 Forbidden', kind: 'warn', anchor: 'start' },
      { x: 88, y: 246, text: 'Private DNS: abc123.execute-api\n.us-east-1.amazonaws.com\nresolves to the endpoint ENIs', anchor: 'start' },
    ],
    marks: [{ x: 350, y: 124 }],
  };
})());

// ---------------------------------------------------------------------------------------------
// ep-ecr-private: Fargate tasks in private subnets pull images with no NAT gateway
// ---------------------------------------------------------------------------------------------
D.push((() => {
  const dur = 10;
  const task = nd('task', 'aws-res-elastic-container-service-task', 115, 220, 'Amazon ECS task', { sub: 'AWS Fargate' });
  const ep1 = nd('ep1', VPCE, 330, 112, 'Interface endpoint', { wrap: 18, sub: 'ecr.api' });
  const ep2 = nd('ep2', VPCE, 330, 184, 'Interface endpoint', { wrap: 18, sub: 'ecr.dkr' });
  const gwe = nd('gwe', VPCE, 330, 256, 'S3 gateway endpoint', { wrap: 22, sub: 'route table target' });
  const ep4 = nd('ep4', VPCE, 330, 328, 'Interface endpoint', { wrap: 18, sub: 'logs' });
  const ecr = nd('ecr', 'aws-svc-elastic-container-registry', 760, 148, 'Amazon ECR', { size: 40, sub: 'private repository' });
  const s3 = nd('s3', S3, 760, 256, 'Amazon S3', { size: 40, sub: 'prod-us-east-1-starport-layer-bucket' });
  const cwl = nd('cwl', 'aws-res-cloudwatch-logs', 760, 328, 'Amazon CloudWatch Logs', { size: 36, wrap: 24 });
  // one pull step: request to the endpoint then the service, response back (2 hops each way)
  const leg = (w1, w2, t0, r1, r2, r0) => [
    { wire: w1, t: [t0, t0 + 0.05], ring: r1 }, { wire: w2, t: [t0 + 0.05, t0 + 0.11], ring: r2 },
    { wire: w2, t: [t0 + 0.13, t0 + 0.18], reverse: true, kind: 'pk-2', ring: r1 }, { wire: w1, t: [t0 + 0.18, t0 + 0.22], reverse: true, kind: 'pk-2', ring: r0 },
  ];
  return {
    id: 'ep-ecr-private',
    name: 'Private image pulls for Fargate',
    aria: 'Architecture diagram: an Amazon ECS task on AWS Fargate in a private subnet with no NAT gateway pulls its image through interface endpoints for ecr.api and ecr.dkr, downloads image layers from Amazon S3 through a gateway endpoint, and sends logs through an interface endpoint for CloudWatch Logs.',
    desc: 'An Amazon ECS task on AWS Fargate starts in a private subnet with no NAT gateway or internet gateway. Its image pull uses three private paths, all required on Fargate platform version 1.4.0 or later: a token from ecr.api, the manifest from ecr.dkr and the layers from Amazon S3 through the gateway endpoint. A logs endpoint carries container logs to CloudWatch Logs, needed only with the awslogs log driver. Requests are orange and responses blue.',
    wide: true, w: 960, h: 412, dur,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 944, h: 396 },
      { kind: 'region', x: 16, y: 32, w: 928, h: 364, label: 'us-east-1' },
      { kind: 'vpc', x: 28, y: 52, w: 520, h: 332, label: 'VPC', note: 'no NAT gateway, no internet gateway' },
      { kind: 'priv', x: 40, y: 160, w: 150, h: 120, label: 'Private subnet' },
    ],
    nodes: [task, ep1, ep2, gwe, ep4, ecr, s3, cwl],
    wires: [
      { id: 'w1', d: P(R(task), [235, 220], [235, 112], L(ep1)) },
      { id: 'w2', d: P(R(task), [235, 220], [235, 184], L(ep2)) },
      { id: 'w3', d: P(R(task), [235, 220], [235, 256], L(gwe)) },
      { id: 'w4', d: P(R(task), [235, 220], [235, 328], L(ep4)) },
      { id: 'e1', d: P(R(ep1), [690, 112], [690, 140], L(ecr, -8)), both: true, label: 'GetAuthorizationToken', labelAt: 0.652 },
      { id: 'e2', d: P(R(ep2), [690, 184], [690, 156], L(ecr, 8)), both: true, label: 'image manifest', labelAt: 0.652 },
      { id: 'e3', d: P(R(gwe), L(s3)), both: true, label: 'image layers', labelAt: 0.4 },
      { id: 'e4', d: P(R(ep4), L(cwl)), both: true, label: 'awslogs driver', labelAt: 0.4 },
    ],
    steps: [
      { n: 1, at: 'w1', f: 0.8, dy: -11, text: 'The Amazon ECS task gets an authorization token from Amazon ECR through the ecr.api interface endpoint.' },
      { n: 2, at: 'w2', f: 0.8, dy: -11, text: 'The task pulls the image manifest from the private repository through the ecr.dkr interface endpoint.' },
      { n: 3, at: 'w3', f: 0.8, dy: -11, text: 'The task downloads the image layers from Amazon S3 through the S3 gateway endpoint, a route table target.' },
      { n: 4, at: 'w4', f: 0.8, dy: -11, text: 'The awslogs log driver sends container logs to Amazon CloudWatch Logs through the logs interface endpoint.' },
    ],
    timeline: fit([
      ...leg('w1', 'e1', 0.03, 'ep1', 'ecr', 'task'),
      ...leg('w2', 'e2', 0.25, 'ep2', 'ecr', 'task'),
      ...leg('w3', 'e3', 0.47, 'gwe', 's3', 'task'),
      ...leg('w4', 'e4', 0.69, 'ep4', 'cwl', 'task'),
    ], 0.94),
    notes: [
      { x: 40, y: 326, text: 'Interface endpoints:\none ENI per AZ, security\ngroup allows TCP 443\nfrom the task', anchor: 'start' },
    ],
  };
})());

// ---------------------------------------------------------------------------------------------
// ep-ssm-private: Session Manager to EC2 instances with no internet path (ssm + ssmmessages endpoints)
// ---------------------------------------------------------------------------------------------
D.push((() => {
  const dur = 10;
  const op = nd('op', 'aws-res-user', 30, 264, 'Operator', { size: 32 });
  const ec2 = nd('ec2', EC2, 134, 150, 'Amazon EC2', { sub: 'SSM Agent' });
  const ep1 = nd('ep1', VPCE, 244, 118, 'Interface endpoint', { wrap: 18, sub: 'ssm' });
  const ep2 = nd('ep2', VPCE, 244, 182, 'Interface endpoint', { wrap: 18, sub: 'ssmmessages' });
  const svc = nd('svc', 'aws-svc-systems-manager', 424, 150, 'AWS Systems Manager', { size: 40, sub: 'Session Manager' });
  return {
    id: 'ep-ssm-private',
    name: 'Session Manager without internet access',
    aria: 'Architecture diagram: an operator starts an AWS Systems Manager Session Manager session to an EC2 instance in a private subnet with no internet path; the SSM Agent reaches the service through interface endpoints for ssm and ssmmessages.',
    desc: 'An operator starts a Session Manager session from the console or AWS CLI to an instance in a private subnet with no inbound ports, bastion host or internet path. The SSM Agent opens its connections outward through interface endpoints for ssm and ssmmessages, so the session returns over the channel the agent already holds (request orange, response blue). SSM Agent 3.3.40.0 and later does not need ec2messages.',
    w: 480, h: 300, dur,
    groups: [
      { kind: 'cloud', x: 64, y: 8, w: 408, h: 284 },
      { kind: 'region', x: 72, y: 32, w: 392, h: 252, label: 'us-east-1' },
      { kind: 'vpc', x: 84, y: 56, w: 226, h: 188, label: 'VPC', note: 'ec2messages: agents before 3.3.40.0' },
      { kind: 'priv', x: 92, y: 78, w: 210, h: 158, label: 'Private subnet' },
    ],
    nodes: [op, ec2, ep1, ep2, svc],
    wires: [
      { id: 'a1', d: P(R(ec2), [190, 150], [190, 118], L(ep1)) },
      { id: 'a2', d: P(R(ec2), [190, 150], [190, 182], L(ep2)) },
      { id: 'b1', d: P(R(ep1), [340, 118], [340, 142], L(svc, -8)), both: true },
      { id: 'b2', d: P(R(ep2), [340, 182], [340, 158], L(svc, 8)), both: true },
      { id: 'op', d: P(R(op), [424, 264], B(svc)), both: true, label: 'AWS Management Console or AWS CLI', labelAt: 0.3 },
    ],
    steps: [
      { n: 1, at: 'a1', f: 0.8, dy: -11, text: 'The SSM Agent on the instance connects to AWS Systems Manager through the ssm interface endpoint.' },
      { n: 2, at: 'a2', f: 0.8, dy: 11, text: 'The agent opens a control channel to Session Manager through the ssmmessages interface endpoint and keeps it open.' },
      { n: 3, at: 'op', f: 0.93, dy: 0, text: 'An operator starts a session from the AWS Management Console or AWS CLI, and Session Manager receives the request.' },
      { n: 4, at: 'b2', f: 0.45, dy: 11, text: 'Session Manager reaches the agent over its open channel, and the session output returns through the ssmmessages endpoint to the operator. No inbound port is opened.' },
    ],
    timeline: fit([
      { wire: 'a1', t: [0.03, 0.08], ring: 'ep1' }, { wire: 'b1', t: [0.08, 0.14], ring: 'svc' },
      { wire: 'a2', t: [0.17, 0.22], ring: 'ep2' }, { wire: 'b2', t: [0.22, 0.28], ring: 'svc' },
      { wire: 'op', t: [0.34, 0.46], ring: 'svc' },
      { wire: 'b2', t: [0.5, 0.56], reverse: true, ring: 'ep2' }, { wire: 'a2', t: [0.56, 0.61], reverse: true, ring: 'ec2' },
      { wire: 'a2', t: [0.66, 0.7], kind: 'pk-2', ring: 'ep2' }, { wire: 'b2', t: [0.7, 0.76], kind: 'pk-2', ring: 'svc' },
      { wire: 'op', t: [0.78, 0.9], reverse: true, kind: 'pk-2', ring: 'op' },
    ], 0.94),
    notes: [
      { x: 100, y: 210, text: 'No inbound ports,\nno bastion host,\nno public IP', anchor: 'start' },
      { x: 346, y: 108, text: 'AWS PrivateLink', anchor: 'start' },
    ],
  };
})());

// ---------------------------------------------------------------------------------------------
// ep-resource: PrivateLink for VPC resources (resource gateway + resource configuration + resource endpoint), no NLB
// ---------------------------------------------------------------------------------------------
D.push((() => {
  const dur = 10;
  const ec2 = nd('ec2', EC2, 60, 102, 'Amazon EC2');
  const rep = nd('rep', VPCE, 140, 102, 'Resource endpoint', { wrap: 14 });
  const gw = nd('gw', ENI, 140, 222, 'Resource gateway', { wrap: 18, sub: 'ENIs in 2 AZs' });
  const rds = nd('rds', 'aws-svc-rds', 232, 222, 'Amazon RDS', { sub: 'MySQL, port 3306' });
  const cfg = nd('cfg', 'aws-svc-vpc-lattice', 326, 222, 'Resource configuration', { wrap: 14 });
  const ram = nd('ram', 'aws-svc-resource-access-manager', 414, 150, 'AWS Resource Access Manager', { wrap: 14 });
  return {
    id: 'ep-resource',
    name: 'PrivateLink access to VPC resources',
    aria: 'Architecture diagram: a provider account shares an Amazon RDS database through a resource gateway and a resource configuration with AWS Resource Access Manager, and an EC2 instance in a consumer VPC reaches it through a resource endpoint over AWS PrivateLink without a Network Load Balancer.',
    desc: 'A provider account shares a private Amazon RDS database without a Network Load Balancer. A resource gateway in the provider VPC fronts the database, and its resource configuration is shared with AWS RAM (blue). In the consumer VPC an instance connects to a resource endpoint (orange), and AWS PrivateLink carries the connection to the resource gateway and the database.',
    w: 480, h: 292, dur,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 464, h: 276 },
      { kind: 'region', x: 16, y: 32, w: 448, h: 244, label: 'us-east-1' },
      { kind: 'vpc', x: 24, y: 56, w: 340, h: 94, label: 'Consumer VPC', note: 'account 1111-2222-3333' },
      { kind: 'vpc', x: 24, y: 174, w: 340, h: 98, label: 'Provider VPC', note: 'account 4444-5555-6666' },
    ],
    nodes: [ec2, rep, gw, rds, cfg, ram],
    wires: [
      { id: 'g1', d: P(R(ec2), L(rep)) },
      { id: 'g2', d: P(B(rep), T(gw)), both: true },
      { id: 'g3', d: P(R(gw), L(rds)), both: true },
      { id: 'd1', d: P(R(rds), L(cfg)), dashed: true, arrow: false },
      { id: 'r1', d: P(R(cfg), [414, 222], B(ram)), dashed: true },
      { id: 'r2', d: P(T(ram), [414, 102], R(rep)), dashed: true },
    ],
    steps: [
      { n: 1, at: 'r1', f: 0.5, dy: -11, text: 'The provider account shares the resource configuration for its Amazon RDS database through AWS RAM, and the consumer account creates a resource endpoint for it.' },
      { n: 2, at: 'g1', f: 0.5, text: 'The instance in the consumer VPC connects to the database through the resource endpoint.' },
      { n: 3, at: 'g2', f: 0.78, dy: 0, text: 'AWS PrivateLink carries the connection from the resource endpoint to the resource gateway in the provider VPC.' },
      { n: 4, at: 'g3', f: 0.5, text: 'The resource gateway forwards the connection to the Amazon RDS database on port 3306, and the response returns the same way.' },
    ],
    timeline: fit([
      { wire: 'r1', t: [0.03, 0.1], kind: 'pk-2', ring: 'ram' }, { wire: 'r2', t: [0.1, 0.18], kind: 'pk-2', ring: 'rep' },
      { wire: 'g1', t: [0.26, 0.31], ring: 'rep' }, { wire: 'g2', t: [0.31, 0.4], ring: 'gw' }, { wire: 'g3', t: [0.4, 0.46], ring: 'rds' },
      { wire: 'g3', t: [0.52, 0.57], reverse: true, kind: 'pk-2', ring: 'gw' }, { wire: 'g2', t: [0.57, 0.66], reverse: true, kind: 'pk-2', ring: 'rep' },
      { wire: 'g1', t: [0.66, 0.71], reverse: true, kind: 'pk-2', ring: 'ec2' },
    ], 0.93),
    notes: [
      { x: 134, y: 168, text: 'AWS PrivateLink', anchor: 'end' },
      { x: 146, y: 168, text: 'connections start in the consumer VPC only', anchor: 'start' },
      { x: 414, y: 238, text: 'shared through\nAWS RAM', anchor: 'middle' },
    ],
  };
})());

// wide tiles first, then the half-width tiles in pairs for the two-column gallery
const ORDER = ['ep-centralized', 'ep-onprem-s3', 'ep-ecr-private', 'ep-policies', 'ep-private-api', 'ep-ssm-private', 'ep-resource'];

export default {
  section: { id: 'endpoints', title: 'SERVICE ENDPOINTS & PRIVATE ACCESS' },
  diagrams: ORDER.map((id) => D.find((d) => d.id === id)),
};
