// Directory Services & Active Directory family. Build: node catalog/aws-kit/awd.mjs build catalog/aws-kit/specs/directory.mjs
// Domains: aws.example.com = AWS Managed Microsoft AD, corp.example.com = on-premises Active Directory
// (a stand-alone directory with no on-premises side uses corp.example.com for the AWS directory).
const D = [];

// ---------------------------------------------------------------------------------------------
D.push({
  id: 'ds-managed-ad',
  name: 'AWS Managed Microsoft AD',
  aria: 'Architecture diagram: AWS Systems Manager joins Windows EC2 instances in two Availability Zones to an AWS Managed Microsoft AD directory whose two domain controllers run in private subnets of the same VPC.',
  desc: 'AWS Managed Microsoft AD runs two domain controllers in private subnets in two Availability Zones, and AWS Systems Manager joins Windows EC2 instances to corp.example.com. Packets show the join command, sign-in to the local controller, replication between the controllers and the status report.',
  w: 480, h: 298, dur: 8,
  groups: [
    { kind: 'cloud', x: 8, y: 8, w: 464, h: 282 },
    { kind: 'region', x: 16, y: 32, w: 448, h: 250 },
    { kind: 'vpc', x: 36, y: 106, w: 408, h: 170 },
    { kind: 'az', x: 44, y: 130, w: 192, h: 140, label: 'Availability Zone 1' },
    { kind: 'az', x: 244, y: 130, w: 192, h: 140, label: 'Availability Zone 2' },
    { kind: 'priv', x: 50, y: 154, w: 180, h: 110 },
    { kind: 'priv', x: 250, y: 154, w: 180, h: 110 },
  ],
  nodes: [
    { id: 'ssm', icon: 'aws-svc-systems-manager', x: 224, y: 56, size: 32, label: 'AWS Systems Manager', wrap: 22 },
    { id: 'eca', icon: 'aws-res-ec2-instance', x: 72, y: 180, label: 'Windows EC2 instance', sub: 'domain-joined' },
    { id: 'dca', icon: 'aws-res-directory-service-managed-microsoft-ad', x: 162, y: 180, label: 'AWS Managed Microsoft AD', sub: 'corp.example.com' },
    { id: 'dcb', icon: 'aws-res-directory-service-managed-microsoft-ad', x: 278, y: 180, label: 'AWS Managed Microsoft AD', sub: 'corp.example.com' },
    { id: 'ecb', icon: 'aws-res-ec2-instance', x: 368, y: 180, label: 'Windows EC2 instance', sub: 'domain-joined' },
  ],
  wires: [
    { id: 'w1a', d: 'M222,72 H26 V200 H69', both: true },
    { id: 'w1b', d: 'M258,72 H454 V200 H411', both: true },
    { id: 'w2a', from: 'eca', to: 'dca', both: true },
    { id: 'w2b', from: 'ecb', to: 'dcb', both: true },
    { id: 'w3', from: 'dca', to: 'dcb', both: true, dashed: true },
  ],
  steps: [
    { n: 1, at: 'w1a', f: 0.18 }, { n: 1, at: 'w1b', f: 0.18 },
    { n: 2, at: 'w2a' }, { n: 2, at: 'w2b' },
    { n: 3, at: 'w3', f: 0.15 },
  ],
  timeline: [
    { wire: 'w1a', t: [0.05, 0.19], ring: 'eca' }, { wire: 'w1b', t: [0.05, 0.19], ring: 'ecb' },
    { wire: 'w2a', t: [0.22, 0.36], ring: 'dca' }, { wire: 'w2b', t: [0.22, 0.36], ring: 'dcb' },
    { wire: 'w3', t: [0.39, 0.53], kind: 'pk-2', ring: 'dcb' }, { wire: 'w3', t: [0.39, 0.53], reverse: true, kind: 'pk-2', ring: 'dca' },
    { wire: 'w2a', t: [0.56, 0.70], reverse: true, kind: 'pk-2', ring: 'eca' }, { wire: 'w2b', t: [0.56, 0.70], reverse: true, kind: 'pk-2', ring: 'ecb' },
    { wire: 'w1a', t: [0.73, 0.87], reverse: true, kind: 'pk-2', ring: 'ssm' }, { wire: 'w1b', t: [0.73, 0.87], reverse: true, kind: 'pk-2' },
  ],
});

// ---------------------------------------------------------------------------------------------
D.push({
  id: 'ds-trust-2way',
  name: 'Two-way forest trust with on-premises AD',
  aria: 'Architecture diagram: a two-way forest trust between on-premises Active Directory and AWS Managed Microsoft AD over AWS Site-to-Site VPN or AWS Direct Connect, with DNS conditional forwarders on both sides.',
  desc: 'A two-way forest trust links AWS Managed Microsoft AD (aws.example.com) and on-premises Active Directory (corp.example.com) over Site-to-Site VPN or Direct Connect, with a DNS conditional forwarder on each side. Packets cross in both directions for DNS lookups, the trust handshake and cross-forest authentication, then replicate to the second domain controller.',
  wide: true, w: 960, h: 312, dur: 10,
  groups: [
    { kind: 'dc', x: 8, y: 100, w: 300, h: 200 },
    { kind: 'cloud', x: 446, y: 44, w: 506, h: 256 },
    { kind: 'region', x: 454, y: 68, w: 490, h: 224 },
    { kind: 'vpc', x: 548, y: 92, w: 388, h: 194 },
    { kind: 'az', x: 556, y: 116, w: 181, h: 164, label: 'Availability Zone 1' },
    { kind: 'az', x: 745, y: 116, w: 183, h: 164, label: 'Availability Zone 2' },
    { kind: 'priv', x: 562, y: 140, w: 169, h: 134 },
    { kind: 'priv', x: 751, y: 140, w: 171, h: 134 },
  ],
  nodes: [
    { id: 'onp', icon: 'aws-res-servers', x: 132, y: 166, label: 'Active Directory domain controllers', wrap: 18, sub: 'corp.example.com' },
    { id: 'cgw', icon: 'aws-res-vpc-customer-gateway', x: 232, y: 166, label: 'Customer gateway device' },
    { id: 'vpn', icon: 'aws-svc-site-to-site-vpn', x: 356, y: 116, label: 'AWS Site-to-Site VPN', wrap: 18 },
    { id: 'dx', icon: 'aws-svc-direct-connect', x: 356, y: 216, label: 'AWS Direct Connect', wrap: 18 },
    { id: 'vgw', icon: 'aws-res-vpc-vpn-gateway', x: 480, y: 166, label: 'Virtual private gateway', wrap: 16 },
    { id: 'dc1', icon: 'aws-res-directory-service-managed-microsoft-ad', x: 646, y: 166, label: 'AWS Managed Microsoft AD', sub: 'aws.example.com' },
    { id: 'dc2', icon: 'aws-res-directory-service-managed-microsoft-ad', x: 817, y: 166, label: 'AWS Managed Microsoft AD', sub: 'aws.example.com' },
  ],
  wires: [
    { id: 'trust', d: 'M152,162 V18 H666 V162', both: true, dashed: true },
    { id: 'c1', from: 'onp', to: 'cgw' },
    { id: 'c2', from: 'cgw', to: 'vpn', via: 316 },
    { id: 'c3', from: 'vpn', to: 'vgw', via: 432 },
    { id: 'c4', from: 'cgw', to: 'dx', via: 316 },
    { id: 'c5', from: 'dx', to: 'vgw', via: 432 },
    { id: 'c6', from: 'vgw', to: 'dc1' },
    { id: 'rep', from: 'dc1', to: 'dc2', both: true, dashed: true },
  ],
  steps: [
    { n: 1, at: 'trust', f: 0.25, dy: 11 }, { n: 2, at: 'trust', f: 0.42, dy: 11 }, { n: 3, at: 'trust', f: 0.59, dy: 11 },
  ],
  timeline: [
    { wire: 'trust', t: [0.05, 0.17], kind: 'pk-2', ring: 'dc1' }, { wire: 'trust', t: [0.05, 0.17], reverse: true, kind: 'pk-2', ring: 'onp' },
    { wire: 'trust', t: [0.21, 0.32], ring: 'dc1' },
    { wire: 'trust', t: [0.34, 0.45], reverse: true, ring: 'onp' },
    { wire: 'trust', t: [0.54, 0.68], kind: 'pk-2', ring: 'dc1' }, { wire: 'trust', t: [0.54, 0.68], reverse: true, kind: 'pk-2', ring: 'onp' },
    { wire: 'rep', t: [0.74, 0.88], kind: 'pk-2', ring: 'dc2' },
  ],
  effects: [{ glow: 'trust', t: [0.47, 0.72] }],
  extra: [
    '<text class="t-c" x="409" y="11">Two-way forest trust</text>',
    '<text class="t-wire" style="text-anchor:start" x="221" y="32">DNS lookups</text><text class="t-wire" style="text-anchor:start" x="356" y="32">Trust handshake</text><text class="t-wire" style="text-anchor:start" x="491" y="32">Cross-forest authentication</text>',
    '<text class="t-c t-sub" x="376" y="204">or</text>',
    '<text class="t-c t-sub" x="152" y="254">DNS conditional forwarder</text><text class="t-c t-sub" x="152" y="265">for aws.example.com</text>',
    '<text class="t-c t-sub" x="666" y="254">DNS conditional forwarder</text><text class="t-c t-sub" x="666" y="265">for corp.example.com</text>',
  ].join(''),
});

// ---------------------------------------------------------------------------------------------
D.push({
  id: 'ds-trust-1way',
  name: 'One-way trust: AWS trusts on-premises',
  aria: 'Architecture diagram: AWS Managed Microsoft AD trusts on-premises Active Directory through a one-way trust, so on-premises users sign in to a Windows EC2 instance with their existing credentials.',
  desc: 'AWS Managed Microsoft AD (aws.example.com) trusts on-premises Active Directory (corp.example.com) through a one-way trust, so on-premises users sign in to AWS resources with their existing credentials. The trust arrow points from the trusting to the trusted domain; packets show the sign-in, the validation that follows the trust, and the replies.',
  w: 480, h: 296, dur: 10,
  groups: [
    { kind: 'dc', x: 8, y: 56, w: 140, h: 218 },
    { kind: 'cloud', x: 168, y: 8, w: 304, h: 280 },
    { kind: 'region', x: 176, y: 32, w: 288, h: 248 },
    { kind: 'vpc', x: 184, y: 56, w: 272, h: 218 },
  ],
  nodes: [
    { id: 'usr', icon: 'aws-res-users', x: 53, y: 84, label: 'On-premises users' },
    { id: 'onp', icon: 'aws-res-servers', x: 53, y: 190, label: 'Active Directory domain controllers', wrap: 18, sub: 'corp.example.com' },
    { id: 'ec2', icon: 'aws-res-ec2-instance', x: 352, y: 84, label: 'Windows EC2 instance', wrap: 22, sub: 'joined to aws.example.com' },
    { id: 'ad', icon: 'aws-res-directory-service-managed-microsoft-ad', x: 352, y: 190, label: 'AWS Managed Microsoft AD', sub: 'aws.example.com' },
  ],
  wires: [
    { id: 'u1', from: 'usr', to: 'ec2', both: true },
    { id: 'a1', d: 'M372,154 V186', both: true },
    { id: 't1', from: 'ad', to: 'onp', dashed: true },
  ],
  steps: [
    { n: 1, at: 'u1', f: 0.5, dy: 0 }, { n: 2, at: 'a1', dx: 13, dy: 0 }, { n: 3, at: 't1', f: 0.11, dy: 0 },
  ],
  timeline: [
    { wire: 'u1', t: [0.04, 0.14], ring: 'ec2' },
    { wire: 'a1', t: [0.16, 0.25], ring: 'ad' },
    { wire: 't1', t: [0.27, 0.42], ring: 'onp' },
    { wire: 't1', t: [0.47, 0.62], reverse: true, kind: 'pk-2', ring: 'ad' },
    { wire: 'a1', t: [0.64, 0.73], reverse: true, kind: 'pk-2', ring: 'ec2' },
    { wire: 'u1', t: [0.75, 0.85], reverse: true, kind: 'pk-2', ring: 'usr' },
  ],
  extra: [
    '<text class="t-wire" x="262" y="99">corp\\user</text>',
    '<text class="t-wire" x="292" y="117">over VPN or Direct Connect</text>',
    '<text class="t-wire" style="text-anchor:end" x="448" y="70">2 domain controllers in 2 AZs</text>',
    '<text class="t-wire" x="250" y="205">One-way trust</text>',
    '<text class="t-wire" x="250" y="226">aws.example.com trusts</text><text class="t-wire" x="250" y="236">corp.example.com</text>',
  ].join(''),
});

// ---------------------------------------------------------------------------------------------
D.push({
  id: 'ds-ad-connector',
  name: 'AD Connector',
  aria: 'Architecture diagram: AD Connector in a VPC proxies sign-in requests from Amazon WorkSpaces and the AWS Management Console to on-premises Active Directory without caching directory data in AWS.',
  desc: 'AD Connector proxies sign-in requests from Amazon WorkSpaces and AWS Management Console access to on-premises domain controllers over VPN or AWS Direct Connect, and caches no directory data in AWS. Packets show the request going out through the connector and the reply returning to the user.',
  w: 480, h: 290, dur: 10,
  groups: [
    { kind: 'cloud', x: 84, y: 8, w: 280, h: 272 },
    { kind: 'region', x: 92, y: 32, w: 264, h: 240 },
    { kind: 'vpc', x: 116, y: 132, w: 232, h: 132 },
    { kind: 'dc', x: 372, y: 132, w: 100, h: 132, label: '' },
  ],
  nodes: [
    { id: 'usr', icon: 'aws-res-users', x: 4, y: 160, label: 'Users' },
    { id: 'con', icon: 'aws-res-management-console', x: 126, y: 58, label: 'AWS Management Console', wrap: 14 },
    { id: 'ws', icon: 'aws-svc-workspaces', x: 138, y: 160, label: 'Amazon WorkSpaces', wrap: 14 },
    { id: 'adc', icon: 'aws-res-directory-service-ad-connector', x: 268, y: 160, label: 'AD Connector', sub: 'no directory data cached' },
    { id: 'onp', icon: 'aws-res-servers', x: 402, y: 160, label: 'Active Directory', wrap: 18, sub: 'corp.example.com' },
  ],
  wires: [
    { id: 'w1', d: 'M48,180 H134', both: true },
    { id: 'w2', d: 'M24,156 V78 H120', both: true },
    { id: 'w3', from: 'ws', to: 'adc', both: true },
    { id: 'w4', d: 'M170,78 H288 V156', both: true },
    { id: 'w5', from: 'adc', to: 'onp', both: true },
  ],
  steps: [
    { n: 1, at: 'w1', f: 0.2, dy: 0 }, { n: 1, at: 'w2', f: 0.3, dy: 0 },
    { n: 2, at: 'w3', f: 0.62, dy: 0 }, { n: 2, at: 'w4', f: 0.82, dy: 0 },
    { n: 3, at: 'w5', f: 0.2, dy: 0 },
  ],
  timeline: [
    { wire: 'w1', t: [0.04, 0.14], ring: 'ws' }, { wire: 'w2', t: [0.04, 0.14], ring: 'con' },
    { wire: 'w3', t: [0.16, 0.26], ring: 'adc' }, { wire: 'w4', t: [0.16, 0.26] },
    { wire: 'w5', t: [0.28, 0.42], ring: 'onp' },
    { wire: 'w5', t: [0.48, 0.62], reverse: true, kind: 'pk-2', ring: 'adc' },
    { wire: 'w3', t: [0.64, 0.74], reverse: true, kind: 'pk-2', ring: 'ws' }, { wire: 'w4', t: [0.64, 0.74], reverse: true, kind: 'pk-2', ring: 'con' },
    { wire: 'w1', t: [0.76, 0.86], reverse: true, kind: 'pk-2', ring: 'usr' }, { wire: 'w2', t: [0.76, 0.86], reverse: true, kind: 'pk-2' },
  ],
  extra: [
    '<use href="#aws-grp-corporate-data-center" x="372" y="132" width="20" height="20"/>',
    '<text class="t-g gt-dc" x="397" y="142">Corporate</text><text class="t-g gt-dc" x="397" y="153">data center</text>',
    '<text class="t-c t-sub" x="288" y="235">2 connectors in 2 AZs</text>',
    '<text class="t-wire" x="229" y="73">console sign-in</text>',
    '<text class="t-wire" x="205" y="175">sign-in</text>',
    '<text class="t-c t-sub" x="422" y="238">over VPN or</text><text class="t-c t-sub" x="422" y="248">Direct Connect</text>',
  ].join(''),
});

// ---------------------------------------------------------------------------------------------
D.push({
  id: 'ds-rds-sqlserver',
  name: 'RDS for SQL Server Windows Authentication',
  aria: 'Architecture diagram: a domain-joined on-premises client gets a Kerberos ticket through a one-way forest trust and connects with Windows Authentication to a Multi-AZ Amazon RDS for SQL Server instance joined to AWS Managed Microsoft AD.',
  desc: 'Amazon RDS for SQL Server (Multi-AZ) is joined to AWS Managed Microsoft AD, and a user from the trusted on-premises domain gets a Kerberos ticket through the forest trust, then connects with Windows Authentication over VPN or AWS Direct Connect. Packets follow the ticket exchange, the connection and the directory validation.',
  wide: true, w: 960, h: 368, dur: 10,
  groups: [
    { kind: 'dc', x: 8, y: 96, w: 170, h: 250 },
    { kind: 'gen', x: 192, y: 96, w: 190, h: 216, label: 'Hybrid connectivity' },
    { kind: 'cloud', x: 396, y: 8, w: 556, h: 352 },
    { kind: 'region', x: 404, y: 32, w: 540, h: 320 },
    { kind: 'vpc', x: 412, y: 56, w: 524, h: 290 },
    { kind: 'az', x: 420, y: 80, w: 250, h: 260, label: 'Availability Zone 1' },
    { kind: 'az', x: 678, y: 80, w: 250, h: 260, label: 'Availability Zone 2' },
    { kind: 'priv', x: 426, y: 104, w: 238, h: 230 },
    { kind: 'priv', x: 684, y: 104, w: 238, h: 230 },
  ],
  nodes: [
    { id: 'cli', icon: 'aws-res-client', x: 73, y: 130, label: 'Domain-joined client', sub: 'corp\\user' },
    { id: 'onp', icon: 'aws-res-servers', x: 73, y: 250, label: 'Active Directory domain controllers', wrap: 18, sub: 'corp.example.com' },
    { id: 'vpn', icon: 'aws-svc-site-to-site-vpn', x: 220, y: 190, label: 'AWS Site-to-Site VPN', wrap: 16 },
    { id: 'dx', icon: 'aws-svc-direct-connect', x: 315, y: 190, label: 'AWS Direct Connect', wrap: 10 },
    { id: 'rds1', icon: 'aws-res-aurora-sql-server-instance', x: 525, y: 130, label: 'Amazon RDS for SQL Server', sub: 'primary' },
    { id: 'dc1', icon: 'aws-res-directory-service-managed-microsoft-ad', x: 525, y: 250, label: 'AWS Managed Microsoft AD', sub: 'aws.example.com' },
    { id: 'rds2', icon: 'aws-res-aurora-sql-server-instance', x: 783, y: 130, label: 'Amazon RDS for SQL Server', sub: 'standby' },
    { id: 'dc2', icon: 'aws-res-directory-service-managed-microsoft-ad', x: 783, y: 250, label: 'AWS Managed Microsoft AD', sub: 'aws.example.com' },
  ],
  wires: [
    { id: 'tgt', d: 'M93,210 V246', both: true },
    { id: 'trust', from: 'dc1', to: 'onp', dashed: true },
    { id: 'conn', from: 'cli', to: 'rds1', both: true },
    { id: 'val1', d: 'M545,210 V246', both: true },
    { id: 'val2', d: 'M803,210 V246', both: true },
    { id: 'rep', from: 'rds1', to: 'rds2', both: true, dashed: true },
    { id: 'drep', from: 'dc1', to: 'dc2', both: true, dashed: true },
  ],
  steps: [
    { n: 1, at: 'tgt', dx: 13, dy: 0 },
    { n: 2, x: 232, y: 270 },
    { n: 3, x: 232, y: 150 },
    { n: 4, at: 'val1', dx: 13, dy: 0 },
  ],
  timeline: [
    { wire: 'tgt', t: [0.04, 0.12], ring: 'onp' },
    { wire: 'tgt', t: [0.13, 0.21], reverse: true, kind: 'pk-2', ring: 'cli' },
    { wire: 'trust', t: [0.25, 0.36], reverse: true, ring: 'dc1' },
    { wire: 'trust', t: [0.37, 0.48], kind: 'pk-2', ring: 'onp' },
    { wire: 'conn', t: [0.53, 0.65], ring: 'rds1' }, { wire: 'rep', t: [0.53, 0.65], kind: 'pk-2', ring: 'rds2' },
    { wire: 'val1', t: [0.68, 0.75], ring: 'dc1' },
    { wire: 'val1', t: [0.76, 0.83], reverse: true, kind: 'pk-2', ring: 'rds1' },
    { wire: 'conn', t: [0.85, 0.96], reverse: true, kind: 'pk-2', ring: 'cli' },
  ],
  extra: [
    '<text class="t-wire" x="300" y="144">Windows Authentication</text>',
    '<text class="t-wire" x="300" y="283">One-way forest trust</text>',
    '<text class="t-wire" x="617" y="144">sync replication</text>',
    '<text class="t-wire" style="text-anchor:start" x="120" y="231">Kerberos TGT</text>',
    '<text class="t-wire" style="text-anchor:start" x="570" y="231">validate ticket</text>',
  ].join(''),
});

// ---------------------------------------------------------------------------------------------
D.push({
  id: 'ds-aurora-kerberos',
  name: 'Aurora Kerberos authentication',
  aria: 'Architecture diagram: a domain-joined client authenticates to an Amazon Aurora cluster with Kerberos using AWS Managed Microsoft AD, with the writer and the reader in two Availability Zones.',
  desc: 'An Amazon Aurora PostgreSQL or MySQL cluster is associated with AWS Managed Microsoft AD, so domain-joined clients connect to the writer with a Kerberos ticket that the instance validates against the directory. Packets follow the ticket request, the connection, the validation and the reply; the reader shares the cluster volume.',
  w: 480, h: 298, dur: 10,
  groups: [
    { kind: 'cloud', x: 96, y: 8, w: 376, h: 282 },
    { kind: 'region', x: 104, y: 31, w: 360, h: 251 },
    { kind: 'vpc', x: 112, y: 54, w: 344, h: 222 },
    { kind: 'az', x: 120, y: 77, w: 160, h: 193, label: 'Availability Zone 1' },
    { kind: 'az', x: 288, y: 77, w: 160, h: 193, label: 'Availability Zone 2' },
    { kind: 'priv', x: 126, y: 100, w: 148, h: 164 },
    { kind: 'priv', x: 294, y: 100, w: 148, h: 164 },
  ],
  nodes: [
    { id: 'cli', icon: 'aws-res-client', x: 18, y: 163, label: 'Client', sub: 'domain-joined' },
    { id: 'wr', icon: 'aws-res-aurora-instance', x: 184, y: 124, size: 32, label: 'Aurora writer', sub: 'PostgreSQL or MySQL' },
    { id: 'rd', icon: 'aws-res-aurora-instance', x: 352, y: 124, size: 32, label: 'Aurora reader', sub: 'shares cluster volume' },
    { id: 'dc1', icon: 'aws-res-directory-service-managed-microsoft-ad', x: 184, y: 210, size: 32, label: 'AWS Managed Microsoft AD', wrap: 26 },
    { id: 'dc2', icon: 'aws-res-directory-service-managed-microsoft-ad', x: 352, y: 210, size: 32, label: 'AWS Managed Microsoft AD', wrap: 26 },
  ],
  wires: [
    { id: 'tkt', d: 'M60,183 H78 V226 H180', both: true },
    { id: 'conn', d: 'M60,183 H78 V140 H180', both: true },
    { id: 'val1', d: 'M200,185 V206', both: true },
    { id: 'val2', d: 'M368,185 V206', both: true },
    { id: 'vol', from: 'wr', to: 'rd', both: true, dashed: true },
    { id: 'rep', from: 'dc1', to: 'dc2', both: true, dashed: true },
  ],
  steps: [
    { n: 1, x: 78, y: 206 }, { n: 2, x: 78, y: 161 }, { n: 3, at: 'val1', dx: 13, dy: 0 },
  ],
  timeline: [
    { wire: 'tkt', t: [0.04, 0.16], ring: 'dc1' },
    { wire: 'tkt', t: [0.18, 0.30], reverse: true, kind: 'pk-2', ring: 'cli' },
    { wire: 'conn', t: [0.34, 0.46], ring: 'wr' }, { wire: 'vol', t: [0.34, 0.46], kind: 'pk-2', ring: 'rd' },
    { wire: 'val1', t: [0.49, 0.57], ring: 'dc1' },
    { wire: 'val1', t: [0.58, 0.66], reverse: true, kind: 'pk-2', ring: 'wr' },
    { wire: 'conn', t: [0.69, 0.81], reverse: true, kind: 'pk-2', ring: 'cli' },
    { wire: 'rep', t: [0.84, 0.95], kind: 'pk-2', ring: 'dc2' },
  ],
  extra: [
    '<text class="t-wire" style="text-anchor:end" x="448" y="68">AD domain: corp.example.com</text>',
    '<text class="t-wire" x="153" y="134">SQL</text><text class="t-wire" x="153" y="220">Kerberos</text>',
  ].join(''),
});

// ---------------------------------------------------------------------------------------------
D.push({
  id: 'ds-fsx',
  name: 'FSx for Windows File Server',
  aria: 'Architecture diagram: a domain-joined client maps an SMB share on a Multi-AZ Amazon FSx for Windows File Server file system joined to AWS Managed Microsoft AD, with preferred and standby file servers in two Availability Zones.',
  desc: 'A Multi-AZ Amazon FSx for Windows File Server file system runs a preferred and a standby file server in two Availability Zones and is joined to AWS Managed Microsoft AD. Packets show a domain-joined client getting a Kerberos ticket and mapping the SMB share, with writes replicated synchronously to the standby.',
  w: 480, h: 298, dur: 10,
  groups: [
    { kind: 'cloud', x: 96, y: 8, w: 376, h: 282 },
    { kind: 'region', x: 104, y: 31, w: 360, h: 251 },
    { kind: 'vpc', x: 112, y: 54, w: 344, h: 222 },
    { kind: 'az', x: 120, y: 77, w: 160, h: 193, label: 'Availability Zone 1' },
    { kind: 'az', x: 288, y: 77, w: 160, h: 193, label: 'Availability Zone 2' },
    { kind: 'priv', x: 126, y: 100, w: 148, h: 164 },
    { kind: 'priv', x: 294, y: 100, w: 148, h: 164 },
  ],
  nodes: [
    { id: 'cli', icon: 'aws-res-client', x: 18, y: 163, label: 'Client', sub: 'domain-joined' },
    { id: 'fs1', icon: 'aws-svc-fsx-for-wfs', x: 184, y: 124, size: 32, label: 'Amazon FSx for Windows File Server (preferred)', wrap: 24 },
    { id: 'fs2', icon: 'aws-svc-fsx-for-wfs', x: 352, y: 124, size: 32, label: 'Amazon FSx for Windows File Server (standby)', wrap: 24 },
    { id: 'dc1', icon: 'aws-res-directory-service-managed-microsoft-ad', x: 184, y: 210, size: 32, label: 'AWS Managed Microsoft AD', wrap: 26 },
    { id: 'dc2', icon: 'aws-res-directory-service-managed-microsoft-ad', x: 352, y: 210, size: 32, label: 'AWS Managed Microsoft AD', wrap: 26 },
  ],
  wires: [
    { id: 'tkt', d: 'M60,183 H78 V226 H180', both: true },
    { id: 'smb', d: 'M60,183 H78 V140 H180', both: true },
    { id: 'val1', d: 'M200,185 V206', both: true },
    { id: 'val2', d: 'M368,185 V206', both: true },
    { id: 'sync', from: 'fs1', to: 'fs2', both: true, dashed: true },
    { id: 'rep', from: 'dc1', to: 'dc2', both: true, dashed: true },
  ],
  steps: [
    { n: 1, x: 78, y: 206 }, { n: 2, x: 78, y: 161 }, { n: 3, at: 'val1', dx: 13, dy: 0 },
  ],
  timeline: [
    { wire: 'tkt', t: [0.04, 0.16], ring: 'dc1' },
    { wire: 'tkt', t: [0.18, 0.30], reverse: true, kind: 'pk-2', ring: 'cli' },
    { wire: 'smb', t: [0.34, 0.46], ring: 'fs1' }, { wire: 'sync', t: [0.34, 0.46], kind: 'pk-2', ring: 'fs2' },
    { wire: 'val1', t: [0.49, 0.57], ring: 'dc1' },
    { wire: 'val1', t: [0.58, 0.66], reverse: true, kind: 'pk-2', ring: 'fs1' },
    { wire: 'smb', t: [0.69, 0.81], reverse: true, kind: 'pk-2', ring: 'cli' },
    { wire: 'rep', t: [0.84, 0.95], kind: 'pk-2', ring: 'dc2' },
  ],
  extra: [
    '<text class="t-wire" style="text-anchor:end" x="448" y="68">AD domain: corp.example.com</text>',
    '<text class="t-wire" x="153" y="134">SMB</text><text class="t-wire" x="153" y="220">Kerberos</text>',
    '<text class="t-wire" x="246" y="134">replication</text>',
  ].join(''),
});

// ---------------------------------------------------------------------------------------------
D.push({
  id: 'ds-workspaces',
  name: 'Amazon WorkSpaces with a directory',
  aria: 'Architecture diagram: users sign in to Amazon WorkSpaces with domain credentials that are validated by the AWS Managed Microsoft AD directory registered with WorkSpaces across two Availability Zones.',
  desc: 'Amazon WorkSpaces is registered with AWS Managed Microsoft AD and launches desktops into private subnets in two Availability Zones. Packets show a user signing in with domain credentials, the WorkSpace validating them against the directory, and the desktop session streaming back.',
  w: 480, h: 298, dur: 10,
  groups: [
    { kind: 'cloud', x: 96, y: 8, w: 376, h: 282 },
    { kind: 'region', x: 104, y: 31, w: 360, h: 251 },
    { kind: 'vpc', x: 112, y: 54, w: 344, h: 222 },
    { kind: 'az', x: 120, y: 77, w: 160, h: 193, label: 'Availability Zone 1' },
    { kind: 'az', x: 288, y: 77, w: 160, h: 193, label: 'Availability Zone 2' },
    { kind: 'priv', x: 126, y: 100, w: 148, h: 164 },
    { kind: 'priv', x: 294, y: 100, w: 148, h: 164 },
  ],
  nodes: [
    { id: 'usr', icon: 'aws-res-users', x: 18, y: 206, label: 'Users', sub: 'AD credentials' },
    { id: 'dc1', icon: 'aws-res-directory-service-managed-microsoft-ad', x: 184, y: 124, size: 32, label: 'AWS Managed Microsoft AD', wrap: 26 },
    { id: 'dc2', icon: 'aws-res-directory-service-managed-microsoft-ad', x: 352, y: 124, size: 32, label: 'AWS Managed Microsoft AD', wrap: 26 },
    { id: 'ws1', icon: 'aws-svc-workspaces', x: 184, y: 210, size: 32, label: 'Amazon WorkSpaces', wrap: 20 },
    { id: 'ws2', icon: 'aws-svc-workspaces', x: 352, y: 210, size: 32, label: 'Amazon WorkSpaces', wrap: 20 },
  ],
  wires: [
    { id: 'sign', d: 'M60,226 H180', both: true },
    { id: 'val1', d: 'M200,206 V178', both: true },
    { id: 'val2', d: 'M368,206 V178', both: true },
    { id: 'rep', from: 'dc1', to: 'dc2', both: true, dashed: true },
  ],
  steps: [
    { n: 1, x: 78, y: 226 }, { n: 2, at: 'val1', dx: 13, dy: 0 },
  ],
  timeline: [
    { wire: 'sign', t: [0.05, 0.19], ring: 'ws1' },
    { wire: 'val1', t: [0.23, 0.32], ring: 'dc1' },
    { wire: 'val1', t: [0.33, 0.42], reverse: true, kind: 'pk-2', ring: 'ws1' },
    { wire: 'sign', t: [0.48, 0.64], reverse: true, kind: 'pk-2', ring: 'usr' },
    { wire: 'rep', t: [0.72, 0.86], kind: 'pk-2', ring: 'dc2' },
  ],
  extra: [
    '<text class="t-wire" style="text-anchor:end" x="448" y="68">Registered directory: corp.example.com</text>',
    '<text class="t-wire" x="153" y="220">sign in</text>',
  ].join(''),
});

// ---------------------------------------------------------------------------------------------
D.push({
  id: 'ds-shared',
  name: 'Directory sharing across accounts',
  aria: 'Architecture diagram: AWS Managed Microsoft AD in a shared services account is shared with a workload account through AWS Organizations, and Windows EC2 instances join it over VPC peering or AWS Transit Gateway.',
  desc: 'AWS Managed Microsoft AD (two domain controllers) in a shared services account is shared with a workload account in the same AWS Organization, whose Windows EC2 instances join it over a VPC peering connection or AWS Transit Gateway. Packets show the share, the join request and the reply.',
  w: 480, h: 222, dur: 10,
  groups: [
    { kind: 'gen', x: 4, y: 8, w: 472, h: 204, label: '' },
    { kind: 'acct', x: 12, y: 32, w: 192, h: 172, label: 'Shared services account' },
    { kind: 'acct', x: 276, y: 32, w: 192, h: 172, label: 'Workload account' },
    { kind: 'region', x: 20, y: 56, w: 176, h: 142 },
    { kind: 'region', x: 284, y: 56, w: 176, h: 142 },
    { kind: 'vpc', x: 28, y: 80, w: 160, h: 112, label: 'VPC 10.0.0.0/16' },
    { kind: 'vpc', x: 292, y: 80, w: 160, h: 112, label: 'VPC 10.1.0.0/16' },
  ],
  nodes: [
    { id: 'ad', icon: 'aws-res-directory-service-managed-microsoft-ad', x: 88, y: 106, label: 'AWS Managed Microsoft AD', sub: 'corp.example.com' },
    { id: 'peer', icon: 'aws-res-vpc-peering-connection', x: 220, y: 106, label: 'VPC peering or Transit Gateway', wrap: 12 },
    { id: 'ec2', icon: 'aws-res-ec2-instances', x: 352, y: 106, label: 'Windows EC2 instances', sub: 'domain-joined' },
  ],
  wires: [
    { id: 'share', d: 'M206,52 H274', dashed: true },
    { id: 'j1', d: 'M350,126 H264', both: true },
    { id: 'j2', d: 'M218,126 H132', both: true },
  ],
  steps: [
    { n: 1, x: 240, y: 41 }, { n: 2, x: 320, y: 126 }, { n: 3, x: 160, y: 126 },
  ],
  timeline: [
    { wire: 'share', t: [0.05, 0.20], kind: 'pk-2' },
    { wire: 'j1', t: [0.26, 0.38], ring: 'peer' },
    { wire: 'j2', t: [0.39, 0.51], ring: 'ad' },
    { wire: 'j2', t: [0.58, 0.70], reverse: true, kind: 'pk-2', ring: 'peer' },
    { wire: 'j1', t: [0.71, 0.83], reverse: true, kind: 'pk-2', ring: 'ec2' },
  ],
  extra: [
    '<use href="#aws-svc-organizations" x="4" y="8" width="20" height="20"/>',
    '<text class="t-g gt-gen" x="29" y="22">AWS Organizations</text>',
    '<text class="t-wire" x="240" y="67">Directory</text><text class="t-wire" x="240" y="77">sharing</text>',
  ].join(''),
});

// ---------------------------------------------------------------------------------------------
D.push({
  id: 'ds-multi-forest',
  name: 'Resource forest with two on-premises forests',
  aria: 'Architecture diagram: AWS Managed Microsoft AD acts as a resource forest that trusts two on-premises forests reached over AWS Site-to-Site VPN and AWS Direct Connect.',
  desc: 'AWS Managed Microsoft AD (aws.example.com) acts as a resource forest that trusts two separate on-premises forests, one reached over Site-to-Site VPN and one over Direct Connect. Packets show each trust request and reply, then sign-ins from both forests reaching Windows resources.',
  wide: true, w: 960, h: 354, dur: 10,
  groups: [
    { kind: 'dc', x: 8, y: 8, w: 180, h: 120, label: 'Corporate data center' },
    { kind: 'dc', x: 8, y: 168, w: 180, h: 120, label: 'Subsidiary data center' },
    { kind: 'cloud', x: 372, y: 8, w: 580, h: 338 },
    { kind: 'region', x: 380, y: 32, w: 564, h: 306 },
    { kind: 'vpc', x: 388, y: 56, w: 548, h: 276 },
    { kind: 'az', x: 396, y: 80, w: 262, h: 246, label: 'Availability Zone 1' },
    { kind: 'az', x: 666, y: 80, w: 262, h: 246, label: 'Availability Zone 2' },
    { kind: 'priv', x: 402, y: 104, w: 250, h: 216 },
    { kind: 'priv', x: 672, y: 104, w: 250, h: 216 },
  ],
  nodes: [
    { id: 'fa', icon: 'aws-res-servers', x: 78, y: 50, label: 'Domain controllers', wrap: 20, sub: 'corp.example.com' },
    { id: 'fb', icon: 'aws-res-servers', x: 78, y: 210, label: 'Domain controllers', wrap: 20, sub: 'subsidiary.example.net' },
    { id: 'vpn', icon: 'aws-svc-site-to-site-vpn', x: 270, y: 50, label: 'AWS Site-to-Site VPN', wrap: 16 },
    { id: 'dx', icon: 'aws-svc-direct-connect', x: 270, y: 210, label: 'AWS Direct Connect', wrap: 18 },
    { id: 'dc1', icon: 'aws-res-directory-service-managed-microsoft-ad', x: 507, y: 130, label: 'AWS Managed Microsoft AD', sub: 'aws.example.com' },
    { id: 'dc2', icon: 'aws-res-directory-service-managed-microsoft-ad', x: 777, y: 130, label: 'AWS Managed Microsoft AD', sub: 'aws.example.com' },
    { id: 'r1', icon: 'aws-res-ec2-instances', x: 507, y: 236, label: 'Windows EC2 instances', sub: 'domain-joined' },
    { id: 'r2', icon: 'aws-svc-fsx-for-wfs', x: 777, y: 236, label: 'Amazon FSx for Windows File Server', wrap: 22, sub: 'domain-joined' },
  ],
  wires: [
    { id: 'a2', d: 'M503,150 H350 V70 H314', dashed: true },
    { id: 'a1', d: 'M266,70 H122', dashed: true },
    { id: 'b2', d: 'M503,150 H350 V230 H314', dashed: true },
    { id: 'b1', d: 'M266,230 H122', dashed: true },
    { id: 'v1', d: 'M527,210 V232', both: true },
    { id: 'v2', d: 'M797,210 V232', both: true },
    { id: 'rep', from: 'dc1', to: 'dc2', both: true, dashed: true },
  ],
  steps: [
    { n: 1, x: 150, y: 70 }, { n: 2, x: 150, y: 230 }, { n: 3, at: 'v1', dx: 13, dy: 0 },
  ],
  timeline: [
    { wire: 'a2', t: [0.05, 0.12] }, { wire: 'a1', t: [0.125, 0.20], ring: 'fa' },
    { wire: 'b2', t: [0.05, 0.12] }, { wire: 'b1', t: [0.125, 0.20], ring: 'fb' },
    { wire: 'a1', t: [0.28, 0.355], reverse: true, kind: 'pk-2' }, { wire: 'a2', t: [0.36, 0.43], reverse: true, kind: 'pk-2', ring: 'dc1' },
    { wire: 'b1', t: [0.28, 0.355], reverse: true, kind: 'pk-2' }, { wire: 'b2', t: [0.36, 0.43], reverse: true, kind: 'pk-2' },
    { wire: 'a1', t: [0.52, 0.595], reverse: true }, { wire: 'a2', t: [0.60, 0.67], reverse: true, ring: 'dc1' },
    { wire: 'b1', t: [0.52, 0.595], reverse: true }, { wire: 'b2', t: [0.60, 0.67], reverse: true },
    { wire: 'v1', t: [0.73, 0.80], kind: 'pk-2', ring: 'r1' },
    { wire: 'rep', t: [0.81, 0.92], kind: 'pk-2', ring: 'dc2' },
  ],
  extra: [
    '<text class="t-wire" style="text-anchor:end" x="928" y="70">Resource forest: aws.example.com</text>',
    '<text class="t-wire" x="228" y="64">One-way trust</text>',
    '<text class="t-wire" x="228" y="224">One-way trust</text>',
    '<text class="t-wire" x="98" y="152">No trust between these two forests</text>',
  ].join(''),
});


export default { section: { id: 'directory', title: 'DIRECTORY SERVICES & ACTIVE DIRECTORY' }, diagrams: D };
