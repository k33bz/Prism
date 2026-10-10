// Security groups and network ACLs family: sg-* diagrams. Build: node catalog/aws-kit/awd.mjs preview catalog/aws-kit/specs/security.mjs
// Authoring note: coordinates come from the shared placement helpers (node centers, edge ports, H/V paths), so every diagram sits
// on an explicit grid. Rules are the kit's `tables` (security group rules, network ACL entries, route tables, an endpoint policy):
// a row lights green while the packet it admits is evaluated and red for the deny that applied. Security group boundaries are the
// kit's `sg` frame (the deck's red Security group frame), ports are wire labels, denials use red packets, red rows and blocked marks.
// Address ranges are documentation ranges: 10.x for VPCs, RFC 5737 (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) for internet
// hosts, RFC 3849 (2001:db8::/32) for IPv6. Security group ids are written as short names (sg-alb, sg-app): in AWS a group's id
// starts with sg- and its name may not, so read them as ids. No raw `extra`.

// ---- icon ids ----
const NET = 'aws-res-internet';
const CLIENT = 'aws-res-client';
const IGW = 'aws-res-vpc-internet-gateway';
const NAT = 'aws-res-vpc-nat-gateway';
const ALB = 'aws-res-elastic-load-balancing-application-load-balancer';
const EC2 = 'aws-res-ec2-instance';
const RDS = 'aws-res-aurora-rds-instance';
const RDS_ALT = 'aws-res-aurora-rds-instance-aternate';
const NACL = 'aws-res-vpc-network-access-control-list';
const RT = 'aws-res-route-53-route-table';
const VPCE = 'aws-res-vpc-endpoints';
const PL = 'aws-svc-privatelink';
const SQS = 'aws-svc-simple-queue-service';
const S3 = 'aws-svc-simple-storage-service';
const TGW = 'aws-svc-transit-gateway';
const TGWA = 'aws-res-transit-gateway-attachment';

// ---- layout helpers (shared with the other specs: ../place.mjs) ----
import { R, L, T, B, P, centered } from '../place.mjs';
// node by CENTER (cx, cy); 32px resource icons throughout (dense diagrams with rule tables)
const nd = centered(32);
// the in-diagram key: swatch centers at (x, y), (x, y + 13)...
const legend = (x, y, ...items) => ({ x: x - 3.4, y: y + 3.4, items: items.map(([kind, label]) => ({ kind, label })) });
// a timeline entry: request (orange), response (blue, reversed), failed (red)
const rq = (wire, a, b, o = {}) => ({ wire, t: [a, b], ...o });
const rs = (wire, a, b, o = {}) => ({ wire, t: [a, b], reverse: true, kind: 'pk-2', ...o });
const bad = (wire, a, b, o = {}) => ({ wire, t: [a, b], kind: 'pk-bad', ...o });
// a table row lit from the moment its packet is on the wire (the middle of that window, or a given moment) to `end`, and kept
// lit in still frames: the still shows every rule the story used
const mid = (e) => (typeof e === 'number' ? e : Math.round(((e.t[0] + e.t[1]) / 2) * 1000) / 1000);
const from = (e) => Math.round((mid(e) - 0.01) * 1000) / 1000;
const ok = (cells, e, end = 0.97) => ({ cells, t: [from(e), end], tone: 'ok', still: true });
const deny = (cells, e, end = 0.97) => ({ cells, t: [from(e), end], tone: 'bad', still: true });
const quiet = (cells) => ({ cells, tone: 'muted' });

// ---- console columns ----
const SG_IN = ['Type', 'Protocol', 'Port range', 'Source'];
const SG_OUT = ['Type', 'Protocol', 'Port range', 'Destination'];
const ACL_IN = ['Rule #', 'Type', 'Protocol', 'Port range', 'Source', 'Allow/Deny'];
const ACL_OUT = ['Rule #', 'Type', 'Protocol', 'Port range', 'Destination', 'Allow/Deny'];
// security groups have no deny rules: traffic that matches no allow rule is dropped (drawn muted, or red when it applies)
const NO_MATCH = ['All other', 'All', 'All', 'no match: denied'];

const D = [];

// ---------------------------------------------------------------------------------------------
// sg-chain: security group referencing in a three-tier application across two AZs
// ---------------------------------------------------------------------------------------------
D.push((() => {
  // AZ rows, tier columns: subnet > security group frame > node
  const AZY = [56, 208], SUBX = { web: 184, app: 452, db: 720 }, SUBW = 196;
  const subY = (r) => AZY[r] + 24, sgY = (r) => subY(r) + 24, cy = (r) => sgY(r) + 42;
  const cx = (c) => SUBX[c] + SUBW / 2;
  const net = nd('net', NET, 36, 222, 'Internet');
  const igw = nd('igw', IGW, 128, 222, 'Internet gateway');
  const albA = nd('albA', ALB, cx('web'), cy(0), 'Application Load Balancer', { wrap: 26 });
  const albB = nd('albB', ALB, cx('web'), cy(1), 'Application Load Balancer', { wrap: 26 });
  const ec2A = nd('ec2A', EC2, cx('app'), cy(0), 'Amazon EC2');
  const ec2B = nd('ec2B', EC2, cx('app'), cy(1), 'Amazon EC2');
  const rdsA = nd('rdsA', RDS, cx('db'), cy(0), 'Amazon RDS primary', { wrap: 20 });
  const rdsB = nd('rdsB', RDS_ALT, cx('db'), cy(1), 'Amazon RDS standby', { wrap: 20 });
  const subnet = (c, r, kind, label, note) => ({ kind, x: SUBX[c], y: subY(r), w: SUBW, h: 112, label, note });
  const sg = (c, r, label) => ({ kind: 'sg', x: SUBX[c] + 12, y: sgY(r), w: SUBW - 24, h: 80, label });
  // the story: a request through the tiers, the response back, then a probe for TCP 5432 from the internet
  const tl = {
    r1: rq('w1', 0.03, 0.08, { ring: 'igw' }), r2: rq('w2a', 0.08, 0.15, { ring: 'albA' }),
    r3: rq('w3a', 0.17, 0.25, { ring: 'ec2A' }), r4: rq('w4a', 0.27, 0.35, { ring: 'rdsA' }),
    s4: rs('w4a', 0.4, 0.48, { ring: 'ec2A' }), s3: rs('w3a', 0.49, 0.57, { ring: 'albA' }),
    s2: rs('w2a', 0.58, 0.65, { ring: 'igw' }), s1: rs('w1', 0.65, 0.7, { ring: 'net' }),
    b1: bad('w1', 0.76, 0.81), b2: bad('w2a', 0.81, 0.88, { ring: 'albA' }),
  };
  return {
    id: 'sg-chain',
    name: 'Security group referencing',
    aria: 'Architecture diagram: a three-tier application across two Availability Zones with an Application Load Balancer in sg-alb, Amazon EC2 instances in sg-app and an Amazon RDS database in sg-db. sg-alb allows TCP 443 from the internet, sg-app allows TCP 8080 from sg-alb and sg-db allows TCP 5432 from sg-app; a probe for TCP 5432 from the internet matches no rule and is dropped.',
    desc: 'Three security groups chain a web application across two Availability Zones. sg-alb allows HTTPS from the internet, sg-app allows TCP 8080 only from sg-alb, and sg-db allows TCP 5432 only from sg-app: each source is a security group, not an IP range. A request lights the matching inbound rule in each table, the response returns with no rule of its own because security groups are stateful, and a probe for TCP 5432 from the internet matches no rule and is dropped (red).',
    wide: true, w: 960, h: 440, dur: 10, poster: 0.92,
    groups: [
      { kind: 'cloud', x: 72, y: 8, w: 880, h: 360 },
      { kind: 'vpc', x: 84, y: 30, w: 856, h: 330, label: 'VPC', note: '10.0.0.0/16, 2001:db8:1234::/56' },
      { kind: 'az', x: 172, y: AZY[0], w: 756, h: 144, label: 'Availability Zone a' },
      { kind: 'az', x: 172, y: AZY[1], w: 756, h: 144, label: 'Availability Zone b' },
      subnet('web', 0, 'pub', 'Public subnet', '10.0.0.0/24'), subnet('app', 0, 'priv', 'Private subnet', '10.0.10.0/24'), subnet('db', 0, 'priv', 'Private subnet', '10.0.20.0/24'),
      subnet('web', 1, 'pub', 'Public subnet', '10.0.1.0/24'), subnet('app', 1, 'priv', 'Private subnet', '10.0.11.0/24'), subnet('db', 1, 'priv', 'Private subnet', '10.0.21.0/24'),
      sg('web', 0, 'sg-alb'), sg('app', 0, 'sg-app'), sg('db', 0, 'sg-db'),
      sg('web', 1, 'sg-alb'), sg('app', 1, 'sg-app'), sg('db', 1, 'sg-db'),
    ],
    nodes: [net, igw, albA, albB, ec2A, ec2B, rdsA, rdsB],
    wires: [
      { id: 'w1', d: P(R(net), L(igw)) },
      { id: 'w2a', d: P(R(igw), [156, igw.cy], [156, albA.cy], L(albA)), label: 'TCP 443', labelAt: 0.758 },
      { id: 'w2b', d: P(R(igw), [156, igw.cy], [156, albB.cy], L(albB)) },
      { id: 'w3a', d: P(R(albA), L(ec2A)), label: ':8080', labelDy: 13 },
      { id: 'w3b', d: P(R(albB), L(ec2B)), label: ':8080', labelDy: 13 },
      { id: 'w4a', d: P(R(ec2A), L(rdsA)), label: ':5432', labelDy: 13 },
      // instances in AZ b use the primary's endpoint too (the Multi-AZ standby takes no traffic)
      { id: 'w4b', d: P(R(ec2B), [704, ec2B.cy], [704, rdsA.cy], L(rdsA)) },
    ],
    steps: [
      { n: 1, at: 'w2a', f: 0.242, dx: -11, dy: 0, text: 'A client on the internet opens an HTTPS connection to the Application Load Balancer through the internet gateway. sg-alb allows TCP 443 from 0.0.0.0/0, and a separate rule allows ::/0 for IPv6 clients.' },
      { n: 2, at: 'w3a', f: 0.5, text: 'The load balancer opens its own connection to an instance on TCP 8080. sg-app allows it because the load balancer\'s network interfaces belong to sg-alb: the rule names a security group, so it keeps matching as the load balancer\'s private IP addresses change.' },
      { n: 3, at: 'w4a', f: 0.5, text: 'The instance connects to the Amazon RDS primary on TCP 5432, which sg-db allows only from sg-app. Instances in Availability Zone b match the same rule.' },
      { n: 4, at: 'w1', f: 0.5, dy: 11, text: 'Each response returns over its own connection with no inbound rule for it: security groups are stateful, so the return traffic of a connection they allowed is allowed too.' },
      { n: 5, at: 'w2a', f: 0.932, text: 'A probe for TCP 5432 from the internet reaches only the load balancer, because the database has no public address. sg-alb has no rule for TCP 5432 and security groups have no deny rules, so nothing matches and the packet is dropped.' },
    ],
    timeline: Object.values(tl),
    tables: [
      { id: 'sg-alb', x: 112, y: 376, title: 'sg-alb inbound rules', tone: 'security', cols: SG_IN,
        rows: [ok(['HTTPS', 'TCP', '443', '0.0.0.0/0'], tl.r2), ['HTTPS', 'TCP', '443', '::/0'], deny(NO_MATCH, tl.b2)] },
      { id: 'sg-app', x: 385, y: 376, title: 'sg-app inbound rules', tone: 'security', cols: SG_IN,
        rows: [ok(['Custom TCP', 'TCP', '8080', 'sg-alb'], tl.r3), quiet(NO_MATCH)] },
      { id: 'sg-db', x: 674, y: 376, title: 'sg-db inbound rules', tone: 'security', cols: SG_IN,
        rows: [ok(['PostgreSQL', 'TCP', '5432', 'sg-app'], tl.r4), quiet(NO_MATCH)] },
    ],
    notes: [
      { x: 36, y: 196, text: 'TCP 5432', kind: 'warn', anchor: 'middle', t: [0.75, 0.97] },
    ],
    marks: [{ on: 'albA', t: [0.87, 0.97], still: true }],
    legend: legend(16, 380, ['pk', 'Request'], ['pk-2', 'Response'], ['pk-bad', 'Dropped']),
  };
})());

// ---------------------------------------------------------------------------------------------
// sg-nacl: a network ACL on the subnet and a security group on the instance
// ---------------------------------------------------------------------------------------------
D.push((() => {
  const cliA = nd('cliA', CLIENT, 36, 100, 'Client', { sub: '198.51.100.7' });
  const cliB = nd('cliB', CLIENT, 36, 220, 'Client', { sub: '203.0.113.9' });
  const igw = nd('igw', IGW, 140, 160, 'Internet gateway');
  const acl = nd('acl', NACL, 240, 160, 'Network ACL');
  const ec2 = nd('ec2', EC2, 444, 160, 'Amazon EC2', { sub: 'web server' });
  const tl = {
    a1: rq('a1', 0.03, 0.08, { ring: 'igw' }), a2: rq('a2', 0.08, 0.14, { ring: 'acl' }), a3: rq('a3', 0.15, 0.24, { ring: 'ec2' }),
    s3: rs('a3', 0.32, 0.41, { ring: 'acl' }), s2: rs('a2', 0.42, 0.48, { ring: 'igw' }), s1: rs('a1', 0.48, 0.53, { ring: 'cliA' }),
    b1: bad('b1', 0.62, 0.68), b2: bad('a2', 0.68, 0.75, { ring: 'acl' }),
  };
  const TX = 592;
  return {
    id: 'sg-nacl',
    name: 'Network ACLs and security groups',
    aria: 'Architecture diagram: a network ACL on a public subnet and a security group on a web server. The network ACL evaluates numbered rules lowest first, with a deny for 203.0.113.0/24 at rule 90 before an allow for TCP 443 at rule 100, and an outbound rule for ephemeral ports 1024-65535; the security group allows TCP 443.',
    desc: 'Two layers filter a web server. The network ACL on the subnet is stateless: it evaluates numbered rules lowest first, allows or denies, and checks the response again on the way out, so an outbound rule must allow the client\'s ephemeral ports. The security group on the instance is stateful and only allows. A request passes rule 100 and the security group, the response leaves through outbound rule 100, and a request from 203.0.113.9 stops at deny rule 90 (red).',
    wide: true, w: 960, h: 268, dur: 10, poster: 0.85,
    groups: [
      { kind: 'cloud', x: 84, y: 8, w: 492, h: 252 },
      { kind: 'vpc', x: 96, y: 32, w: 468, h: 220, label: 'VPC', note: '10.0.0.0/16' },
      { kind: 'pub', x: 192, y: 60, w: 360, h: 184, label: 'Public subnet', note: '10.0.1.0/24' },
      { kind: 'sg', x: 348, y: 92, w: 192, h: 144, label: 'sg-web' },
    ],
    nodes: [cliA, cliB, igw, acl, ec2],
    wires: [
      { id: 'a1', d: P(R(cliA), [72, cliA.cy], [72, igw.cy - 8], L(igw, -8)) },
      { id: 'b1', d: P(R(cliB), [72, cliB.cy], [72, igw.cy + 8], L(igw, 8)) },
      { id: 'a2', d: P(R(igw), L(acl)) },
      { id: 'a3', d: P(R(acl), L(ec2)), label: 'TCP 443', labelAt: 0.2 },
    ],
    steps: [
      { n: 1, at: 'a2', f: 0.5, text: 'An HTTPS request from 198.51.100.7 enters the subnet, and the network ACL checks its inbound rules lowest number first. Rule 90 does not match the source, so rule 100 decides: allow TCP 443 from 0.0.0.0/0.' },
      { n: 2, at: 'a3', f: 0.72, text: 'The security group on the instance checks the request next. sg-web allows TCP 443 from 0.0.0.0/0, so the request reaches the web server.' },
      { n: 3, at: 'a3', f: 0.72, dy: 11, text: 'The response leaves the instance without an outbound rule of its own: the security group is stateful, so responses to allowed inbound traffic may leave regardless of its outbound rules.' },
      { n: 4, at: 'a2', f: 0.5, dy: 11, text: 'The network ACL is stateless, so it checks the response again as it leaves the subnet. Outbound rule 100 allows TCP 1024-65535, the range that covers the client\'s ephemeral port; without it, the * rule would drop the response.' },
      { n: 5, at: 'b1', f: 0.5, dx: -11, dy: 0, text: 'A request from 203.0.113.9 matches rule 90 first and is denied, even though rule 100 would allow it: the lowest-numbered matching rule wins. A security group could not block this source, because it has no deny rules.' },
    ],
    timeline: Object.values(tl),
    tables: [
      { id: 'acl-in', x: TX, y: 18, title: 'Network ACL inbound rules', tone: 'security', cols: ACL_IN,
        rows: [deny(['90', 'All traffic', 'All', 'All', '203.0.113.0/24', 'Deny'], tl.b2), ok(['100', 'HTTPS', 'TCP', '443', '0.0.0.0/0', 'Allow'], tl.a2),
          ['*', 'All traffic', 'All', 'All', '0.0.0.0/0', 'Deny']] },
      { id: 'sg-web', x: TX, y: 100, title: 'sg-web inbound rules', tone: 'security', cols: SG_IN,
        rows: [ok(['HTTPS', 'TCP', '443', '0.0.0.0/0'], tl.a3), quiet(NO_MATCH)] },
      { id: 'acl-out', x: TX, y: 171, title: 'Network ACL outbound rules', tone: 'security', cols: ACL_OUT,
        rows: [ok(['100', 'Custom TCP', 'TCP', '1024-65535', '0.0.0.0/0', 'Allow'], tl.s3.t[1]), ['*', 'All traffic', 'All', 'All', '0.0.0.0/0', 'Deny']] },
    ],
    notes: [
      { x: 204, y: 216, text: 'Subnet level, stateless:\nnumbered rules, allow or deny', anchor: 'start', size: 9 },
      { x: 444, y: 216, text: 'Instance level, stateful:\nallow rules only', anchor: 'middle', size: 9 },
    ],
    marks: [{ on: 'acl', t: [0.74, 0.97], still: true }],
    legend: legend(TX + 4, 232, ['pk', 'Request'], ['pk-2', 'Response'], ['pk-bad', 'Denied']),
  };
})());

// ---------------------------------------------------------------------------------------------
// sg-endpoints: a security group on an interface endpoint; a gateway endpoint has none
// ---------------------------------------------------------------------------------------------
D.push((() => {
  const ec2 = nd('ec2', EC2, 112, 146, 'Amazon EC2');
  const eni = nd('eni', VPCE, 288, 146, 'Interface endpoint', { wrap: 20, sub: 'ENI 10.0.1.25' });
  const rt = nd('rt', RT, 112, 252, 'Route table', { sub: 'pl-0a1b2c3d > vpce' });
  const gwe = nd('gwe', VPCE, 404, 252, 'Gateway endpoint', { wrap: 18, sub: 'no security group' });
  const pl = nd('pl', PL, 500, 146, 'AWS PrivateLink');
  const sqs = nd('sqs', SQS, 584, 146, 'Amazon SQS');
  const s3 = nd('s3', S3, 584, 252, 'Amazon S3');
  const tl = {
    i1: rq('i1', 0.03, 0.08, { ring: 'eni' }), i2: rq('i2', 0.09, 0.16, { ring: 'pl' }), i3: rq('i3', 0.16, 0.21, { ring: 'sqs' }),
    j3: rs('i3', 0.25, 0.3, { ring: 'pl' }), j2: rs('i2', 0.3, 0.37, { ring: 'eni' }), j1: rs('i1', 0.37, 0.42, { ring: 'ec2' }),
    g1: rq('g1', 0.48, 0.53, { ring: 'rt' }), g2: rq('g2', 0.53, 0.61, { ring: 'gwe' }), g3: rq('g3', 0.61, 0.68, { ring: 's3' }),
    x1: bad('g1', 0.74, 0.79), x2: bad('g2', 0.79, 0.86), x3: bad('g3', 0.86, 0.92, { ring: 's3' }),
  };
  const TX = 652;
  return {
    id: 'sg-endpoints',
    name: 'Security groups and VPC endpoints',
    aria: 'Architecture diagram: an EC2 instance in sg-app reaches Amazon SQS through an interface endpoint whose network interface is in sg-vpce, which allows TCP 443 from sg-app, and reaches Amazon S3 through a gateway endpoint, a route table target for the S3 prefix list that has no security group; the endpoint policy allows s3:GetObject on one bucket and a request for another bucket is denied.',
    desc: 'An interface endpoint is a network interface in your subnet, so it has a security group: sg-vpce allows TCP 443 from sg-app, and the request to Amazon SQS passes to AWS PrivateLink. A gateway endpoint is a route table target for the S3 prefix list and has no security group: the instance\'s outbound rule to the prefix list and the endpoint policy decide, and a request for a bucket the policy does not allow is denied (red).',
    wide: true, w: 960, h: 332, dur: 10, poster: 0.95,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 628, h: 316 },
      { kind: 'region', x: 20, y: 32, w: 604, h: 284, label: 'us-east-1' },
      { kind: 'vpc', x: 32, y: 56, w: 424, h: 252, label: 'VPC', note: '10.0.0.0/16' },
      { kind: 'priv', x: 44, y: 80, w: 312, h: 220, label: 'Private subnet', note: '10.0.1.0/24' },
      { kind: 'sg', x: 56, y: 104, w: 112, h: 90, label: 'sg-app' },
      { kind: 'sg', x: 232, y: 104, w: 112, h: 90, label: 'sg-vpce' },
    ],
    nodes: [ec2, eni, rt, gwe, pl, sqs, s3],
    wires: [
      { id: 'i1', d: P(R(ec2), L(eni)), label: 'TCP 443', labelDy: 13 },
      { id: 'i2', d: P(R(eni), L(pl)) },
      { id: 'i3', d: P(R(pl), L(sqs)) },
      // the route table lookup (dashed), then the gateway endpoint as the route's target
      { id: 'g1', d: P(B(ec2), T(rt)), dashed: true },
      { id: 'g2', d: P(R(rt), L(gwe)), label: 'TCP 443', labelAt: 0.6, labelDy: 13 },
      { id: 'g3', d: P(R(gwe), L(s3)) },
    ],
    steps: [
      { n: 1, at: 'i1', f: 0.5, text: 'The instance calls Amazon SQS. Private DNS resolves the service name to the interface endpoint\'s network interface in the subnet, and sg-app\'s outbound rule allows TCP 443 to sg-vpce.' },
      { n: 2, at: 'i2', f: 0.75, text: 'The endpoint network interface has its own security group: sg-vpce allows TCP 443 from sg-app (a rule for the VPC CIDR, 10.0.0.0/16, also works), so AWS PrivateLink carries the request to Amazon SQS. The response returns on the same connection.' },
      { n: 3, at: 'g1', f: 0.5, dx: 11, dy: 0, text: 'For Amazon S3, the subnet route table sends traffic for the S3 prefix list (pl-0a1b2c3d) to the gateway endpoint, and sg-app\'s outbound rule allows TCP 443 to that prefix list.' },
      { n: 4, at: 'g3', f: 0.5, text: 'A gateway endpoint is a route target, not a network interface, so no security group applies to it. The endpoint policy allows s3:GetObject on the app-data bucket, and the request reaches Amazon S3.' },
      { n: 5, at: 'g2', f: 0.6, text: 'A request for another bucket takes the same route, but no statement in the endpoint policy allows it, so Amazon S3 denies it (403 Access Denied).' },
    ],
    timeline: Object.values(tl),
    tables: [
      { id: 'sg-app', x: TX, y: 16, title: 'sg-app outbound rules', tone: 'security', cols: SG_OUT,
        rows: [ok(['HTTPS', 'TCP', '443', 'sg-vpce'], tl.i1), ok(['HTTPS', 'TCP', '443', 'pl-0a1b2c3d (S3)'], tl.g1), quiet(NO_MATCH)] },
      { id: 'sg-vpce', x: TX, y: 90, title: 'sg-vpce inbound rules', tone: 'security', cols: SG_IN,
        rows: [ok(['HTTPS', 'TCP', '443', 'sg-app'], tl.i1.t[1]), quiet(NO_MATCH)] },
      { id: 'rt', x: TX, y: 153, title: 'Private subnet route table', tone: 'networking', cols: ['Destination', 'Target'],
        rows: [['10.0.0.0/16', 'local'], ok(['pl-0a1b2c3d (S3)', 'vpce-0a1b2c3d (gateway)'], tl.g1)] },
      { id: 'policy', x: TX, y: 216, title: 'Gateway endpoint policy', tone: 'security', cols: ['Effect', 'Principal', 'Action', 'Resource'],
        rows: [ok(['Allow', '*', 's3:GetObject', 'arn:aws:s3:::app-data/*'], tl.g3), deny(['Implicit deny', '*', 's3:GetObject', 'any other bucket'], tl.x3)] },
    ],
    notes: [
      { x: 616, y: 298, text: '403 Access Denied', kind: 'warn', anchor: 'end', t: [0.9, 0.98] },
    ],
    marks: [{ on: 's3', t: [0.91, 0.98], still: true }],
    legend: legend(TX + 4, 280, ['pk', 'Request'], ['pk-2', 'Response'], ['pk-bad', 'Denied by the endpoint policy']),
  };
})());

// ---------------------------------------------------------------------------------------------
// sg-egress: replacing the allow-all outbound rule with the destinations the tier needs
// ---------------------------------------------------------------------------------------------
D.push((() => {
  const ec2 = nd('ec2', EC2, 140, 122, 'Amazon EC2');
  const rds = nd('rds', RDS, 140, 266, 'Amazon RDS');
  const nat = nd('nat', NAT, 390, 122, 'NAT gateway');
  const igw = nd('igw', IGW, 548, 122, 'Internet gateway');
  const net = nd('net', NET, 664, 122, 'Internet');
  const tl = {
    e1: rq('e1', 0.03, 0.1, { ring: 'nat' }), e2: rq('e2', 0.1, 0.16, { ring: 'igw' }), e3: rq('e3', 0.16, 0.21, { ring: 'net' }),
    r3: rs('e3', 0.25, 0.3, { ring: 'igw' }), r2: rs('e2', 0.3, 0.36, { ring: 'nat' }), r1: rs('e1', 0.36, 0.43, { ring: 'ec2' }),
    d1: rq('d1', 0.5, 0.57, { ring: 'rds' }), d2: rs('d1', 0.62, 0.69, { ring: 'ec2' }),
    x1: bad('x1', 0.77, 0.83, { ring: { x: 230, y: 130, r: 10 } }),
  };
  const TX = 704;
  return {
    id: 'sg-egress',
    name: 'Restricting outbound traffic',
    aria: 'Architecture diagram: an EC2 instance in sg-app whose outbound rules allow only TCP 443 to 0.0.0.0/0, through a NAT gateway and an internet gateway, and TCP 5432 to sg-db; an outbound connection on TCP 22 matches no rule and never leaves the instance.',
    desc: 'A new security group allows all outbound traffic until you remove that rule. Here sg-app allows only what the tier needs: HTTPS to the internet through the NAT gateway, and TCP 5432 to the database\'s security group, which in turn allows TCP 5432 only from sg-app. Allowed requests (orange) light their rules and the responses (blue) return because the group is stateful; a connection on TCP 22 matches no outbound rule and never leaves the instance (red).',
    wide: true, w: 960, h: 336, dur: 10, poster: 0.88,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 608, h: 320 },
      { kind: 'vpc', x: 20, y: 32, w: 584, h: 288, label: 'VPC', note: '10.0.0.0/16' },
      { kind: 'priv', x: 32, y: 56, w: 216, h: 112, label: 'Private subnet', note: '10.0.10.0/24' },
      { kind: 'priv', x: 32, y: 200, w: 216, h: 112, label: 'Private subnet', note: '10.0.20.0/24' },
      { kind: 'pub', x: 300, y: 56, w: 180, h: 112, label: 'Public subnet', note: '10.0.0.0/24' },
      // header labels on the left, clear of the database wire that runs down the middle
      { kind: 'sg', x: 44, y: 80, w: 192, h: 80, label: 'sg-app', align: 'left' },
      { kind: 'sg', x: 44, y: 224, w: 192, h: 80, label: 'sg-db', align: 'left' },
    ],
    nodes: [ec2, rds, nat, igw, net],
    wires: [
      { id: 'e1', d: P(R(ec2, -6), [370, 116]), label: 'TCP 443', labelAt: 0.543 },
      { id: 'e2', d: P(R(nat), L(igw)) },
      { id: 'e3', d: P(R(igw), L(net)) },
      { id: 'd1', d: P(B(ec2), T(rds)), label: 'TCP 5432', labelAnchor: 'start', labelDx: 5, labelAt: 0.35 },
      // the blocked attempt: a stub that ends at the security group boundary
      { id: 'x1', d: P(R(ec2, 8), [230, 130]), hot: true, dashed: true, arrow: false, label: 'TCP 22', labelDy: 13, labelAt: 0.77 },
    ],
    steps: [
      { n: 1, at: 'e1', f: 0.76, text: 'The instance calls an HTTPS API on the internet. sg-app\'s first outbound rule allows TCP 443 to 0.0.0.0/0, so the request leaves for the NAT gateway in the public subnet.' },
      { n: 2, at: 'e2', f: 0.5, text: 'The NAT gateway sends it out through the internet gateway. The response comes back with no inbound rule for it, because security groups are stateful.' },
      { n: 3, at: 'd1', f: 0.35, dx: -11, dy: 0, text: 'The instance queries the database. The second outbound rule allows TCP 5432 only to members of sg-db, and sg-db allows TCP 5432 only from sg-app, so the path is pinned at both ends.' },
      { n: 4, at: 'x1', f: 0.37, dy: 11, text: 'A connection to 198.51.100.20 on TCP 22 matches no outbound rule, so it never leaves the instance. New security groups and the default one allow all outbound traffic; here that rule was removed.' },
    ],
    timeline: Object.values(tl),
    tables: [
      { id: 'sg-app', x: TX, y: 24, title: 'sg-app outbound rules', tone: 'security', cols: SG_OUT,
        rows: [ok(['HTTPS', 'TCP', '443', '0.0.0.0/0'], tl.e1), ok(['PostgreSQL', 'TCP', '5432', 'sg-db'], tl.d1), deny(NO_MATCH, tl.x1)] },
      // beside the frame it describes, in the free corner of the VPC
      { id: 'sg-db', x: 272, y: 238, title: 'sg-db inbound rules', tone: 'security', cols: SG_IN,
        rows: [ok(['PostgreSQL', 'TCP', '5432', 'sg-app'], tl.d1.t[1]), quiet(NO_MATCH)] },
    ],
    notes: [
      { x: TX, y: 112, text: 'Removed from sg-app: the default outbound rule', kind: 'label', anchor: 'start', size: 9 },
      { x: TX, y: 124, text: 'All traffic, All, All, 0.0.0.0/0', anchor: 'start', size: 9 },
    ],
    marks: [{ x: 230, y: 130, t: [0.82, 0.97], still: true }],
    legend: legend(TX + 4, 160, ['pk', 'Request'], ['pk-2', 'Response'], ['pk-bad', 'No outbound rule']),
  };
})());

// ---------------------------------------------------------------------------------------------
// sg-tgw: security group referencing across VPCs attached to the same transit gateway (inbound rules only)
// ---------------------------------------------------------------------------------------------
D.push((() => {
  const app = nd('app', EC2, 138, 146, 'Amazon EC2');
  const batch = nd('batch', EC2, 138, 234, 'Amazon EC2');
  const attA = nd('attA', TGWA, 290, 190, 'TGW attachment', { wrap: 10 });
  const tgw = nd('tgw', TGW, 480, 190, 'AWS Transit Gateway', { wrap: 20 });
  const attB = nd('attB', TGWA, 678, 190, 'TGW attachment', { wrap: 10 });
  const rds = nd('rds', RDS, 834, 190, 'Amazon RDS');
  const tl = {
    a1: rq('a1', 0.03, 0.08, { ring: 'attA' }), a2: rq('t1', 0.08, 0.16, { ring: 'tgw' }), a3: rq('t2', 0.16, 0.24, { ring: 'attB' }), a4: rq('t3', 0.24, 0.3, { ring: 'rds' }),
    r4: rs('t3', 0.35, 0.41, { ring: 'attB' }), r3: rs('t2', 0.41, 0.49, { ring: 'tgw' }), r2: rs('t1', 0.49, 0.57, { ring: 'attA' }), r1: rs('a1', 0.57, 0.62, { ring: 'app' }),
    b1: bad('b1', 0.69, 0.74), b2: bad('t1', 0.74, 0.8), b3: bad('t2', 0.8, 0.86), b4: bad('t3', 0.86, 0.91, { ring: 'rds' }),
  };
  return {
    id: 'sg-tgw',
    name: 'Security group referencing over Transit Gateway',
    aria: 'Architecture diagram: an app VPC and a data VPC attached to the same AWS Transit Gateway with security group referencing support enabled. sg-db in the data VPC allows TCP 5432 from sg-app in the app VPC; sg-app\'s outbound rule uses the data VPC CIDR because outbound rules cannot reference a security group across a transit gateway; an instance in sg-batch is denied.',
    desc: 'Two VPCs attached to the same transit gateway, with security group referencing support turned on for the transit gateway and both VPC attachments. sg-db in the data VPC allows TCP 5432 from sg-app in the app VPC. The reference works in inbound rules only, so sg-app\'s outbound rule names the data VPC CIDR. The app instance\'s request lights both rules and the response returns; an instance in sg-batch, in the same address range, is dropped by sg-db (red).',
    wide: true, w: 960, h: 388, dur: 10, poster: 0.94,
    groups: [
      { kind: 'cloud', x: 8, y: 8, w: 944, h: 300 },
      { kind: 'region', x: 20, y: 32, w: 920, h: 268, label: 'Region' },
      { kind: 'vpc', x: 32, y: 56, w: 300, h: 232, label: 'App VPC', note: '10.0.0.0/16' },
      { kind: 'priv', x: 44, y: 80, w: 188, h: 200, label: 'Private subnet', note: '10.0.1.0/24' },
      { kind: 'sg', x: 56, y: 104, w: 164, h: 80, label: 'sg-app' },
      { kind: 'sg', x: 56, y: 192, w: 164, h: 80, label: 'sg-batch' },
      { kind: 'vpc', x: 628, y: 56, w: 300, h: 232, label: 'Data VPC', note: '10.1.0.0/16' },
      { kind: 'priv', x: 728, y: 80, w: 188, h: 200, label: 'Private subnet', note: '10.1.1.0/24' },
      { kind: 'sg', x: 740, y: 148, w: 164, h: 80, label: 'sg-db' },
    ],
    nodes: [app, batch, attA, tgw, attB, rds],
    wires: [
      { id: 'a1', d: P(R(app), [246, app.cy], [246, attA.cy - 8], L(attA, -8)) },
      { id: 'b1', d: P(R(batch), [246, batch.cy], [246, attA.cy + 8], L(attA, 8)) },
      { id: 't1', d: P(R(attA), L(tgw)), label: 'TCP 5432', labelAt: 0.5, labelDy: 13 },
      { id: 't2', d: P(R(tgw), L(attB)) },
      { id: 't3', d: P(R(attB), L(rds)) },
    ],
    steps: [
      { n: 1, at: 'a1', f: 0.2, text: 'An app instance in sg-app connects to the database in the data VPC. Outbound rules cannot reference a security group across a transit gateway, so sg-app allows TCP 5432 to the data VPC CIDR, 10.1.0.0/16.' },
      { n: 2, at: 't1', f: 0.5, text: 'AWS Transit Gateway routes the connection to the data VPC attachment. Security group referencing support is turned on for the transit gateway and for both VPC attachments, as the feature requires.' },
      { n: 3, at: 't3', f: 0.69, text: 'sg-db allows TCP 5432 from sg-app, a security group in another VPC on the same transit gateway, so the request reaches Amazon RDS and the response returns on the same connection.' },
      { n: 4, at: 'b1', f: 0.2, text: 'An instance in sg-batch has an address in the same 10.0.0.0/16 range, but it is not a member of sg-app, so sg-db matches no rule and drops the connection. A rule for the app VPC CIDR could not tell the two apart.' },
    ],
    timeline: Object.values(tl),
    tables: [
      { id: 'sg-app', x: 32, y: 318, title: 'sg-app outbound rules', tone: 'security', cols: SG_OUT,
        rows: [ok(['PostgreSQL', 'TCP', '5432', '10.1.0.0/16'], tl.a1), quiet(NO_MATCH)] },
      { id: 'sg-db', x: 628, y: 318, title: 'sg-db inbound rules', tone: 'security', cols: SG_IN,
        rows: [ok(['PostgreSQL', 'TCP', '5432', 'sg-app'], tl.a4), deny(NO_MATCH, tl.b4)] },
    ],
    notes: [
      { x: 480, y: 120, text: 'Security group referencing support:\nenabled on the transit gateway\nand on both VPC attachments', anchor: 'middle', size: 9 },
      { x: 284, y: 330, text: 'An outbound rule cannot reference a\nsecurity group across a transit\ngateway, so this rule uses the CIDR', anchor: 'start', size: 9 },
    ],
    marks: [{ on: 'rds', t: [0.9, 0.98], still: true }],
    legend: legend(480 - 30, 336, ['pk', 'Request'], ['pk-2', 'Response'], ['pk-bad', 'Dropped by sg-db']),
  };
})());

export default {
  section: { id: 'security', title: 'SECURITY GROUPS AND NETWORK ACLS' },
  diagrams: D,
};
