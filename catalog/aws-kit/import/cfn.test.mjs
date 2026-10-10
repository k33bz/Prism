// Tests for the CloudFormation importer (cfn.mjs, cfn-yaml.mjs, iac.mjs): every cfn- fixture imports clean,
// the YAML loader, the webapp ledger, the flows sidecar's timeline and stories, CDK, SAM, Parameters and
// Conditions, and format detection. Run: node --test catalog/aws-kit/import/cfn.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSpec, lint, standalone } from '../awd.mjs';
import { validateDiagram } from '../spec.mjs';
import { story } from '../story.mjs';
import { fromCloudFormation, loadTemplate } from './cfn.mjs';
import { parseYaml } from './cfn-yaml.mjs';
import { importDiagram, detectFormat } from './index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const templates = fs.readdirSync(FIX).filter((f) => /^cfn-/.test(f) && !/\.flows\.json$/.test(f));
const sidecarOf = (f) => { const p = path.join(FIX, f.replace(/\.(ya?ml|json)$/, '.flows.json')); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const errors = (list) => list.filter((x) => x.severity === 'error');
const imp = (f, o = {}) => fromCloudFormation(read(f), { file: f.replace(/\.(ya?ml|json)$/, ''), ...o });
const webapp = (o = {}) => imp('cfn-webapp.yaml', o);
const flows = () => sidecarOf('cfn-webapp.yaml');
const wireBy = (spec, from, to) => spec.wires.find((w) => w.from === from && w.to === to);

function assertClean(spec, report, label) {
  assert.doesNotThrow(() => checkSpec(spec), label);
  assert.deepEqual(validateDiagram(spec), [], `${label}: schema`);
  assert.deepEqual(errors(lint(spec)).map((x) => `${x.code} ${x.message}`), [], `${label}: lint`);
  assert.deepEqual(errors(report.issues).map((x) => `${x.code} ${x.message}`), [], `${label}: issues`);
  assert.deepEqual(errors(report.lint), [], `${label}: report.lint`);
  assert.ok(report.tile.fits && ['normal', 'wide', 'full'].includes(report.tile.size), `${label}: tile ${JSON.stringify(report.tile)}`);
  assert.match(standalone(spec, { theme: 'light' }), /^<svg xmlns=/, label);
}

test('every cfn fixture imports to a spec that passes checkSpec, the schema and lint, with and without its sidecar', () => {
  assert.ok(templates.length >= 5, `fixtures: ${templates.join(', ')}`);
  for (const f of templates) {
    const runs = [['plain', {}], ['guess', { story: 'guess' }]];
    const side = sidecarOf(f);
    if (side) {
      runs.push(['sidecar', { flows: side }]);
      for (const s of side.stories || []) runs.push([`story ${s.id}`, { flows: side, story: s.id }]);
    }
    if (f === 'cfn-conditions.yaml') runs.push(['prod', { params: { EnvType: 'prod', EnableCache: 'true' } }], ['prod guess', { params: { EnvType: 'prod', EnableCache: 'true' }, story: 'guess' }]);
    for (const [what, o] of runs) {
      const { spec, report } = imp(f, o);
      assertClean(spec, report, `${f} (${what})`);
      assert.ok(spec.id.startsWith('cfn-'), spec.id);
      for (const k of ['issues', 'unmapped', 'ledger', 'tile', 'lint']) assert.ok(k in report, `${f}: report.${k}`);
    }
  }
});

test('the YAML loader reads the short-form intrinsics and the YAML templates use', () => {
  const t = parseYaml([
    'A: !Ref Vpc',
    'B: !GetAtt Lb.DNSName',
    'B2: !GetAtt [Lb, Arn]',
    "C: !Sub '${AWS::StackName}-x'",
    'C2: !Sub',
    "  - 'arn:${P}:s3:::${B}'",
    '  - { B: !Ref Bucket }',
    'D: !If [IsProd, 2, !Ref AWS::NoValue]',
    "E: !Select [1, !GetAZs '']",
    "F: !Join ['', ['a', !Ref B]]",
    "G: !Split [',', !ImportValue Shared]",
    'H: !FindInMap [Sizing, !Ref Env, Db]',
    'I: !Equals [!Ref Env, prod]',
    'J: !Not [!Condition IsProd]',
    'K: !And',
    '  - !Condition IsProd',
    '  - !Or [!Condition A, !Condition B]',
    'L: !Base64 |',
    '  #!/bin/bash',
    '  echo ${X} # kept',
    'M: !Cidr [!GetAtt Vpc.CidrBlock, 6, 8]',
    'N: >-',
    '  folded',
    '  text',
    'O: [a,',
    '    b, c]   # a comment',
    "P: 'it''s'",
    'Q: "tab\\tquote\\"" ',
    'R: &anchor { x: 1 }',
    'S: *anchor',
    'T:',
    '- k: 1',
    '  v: two',
    '- plain scalar',
    'U: 2010-09-09',
    "V: '0755'",
    'W: 10.0.0.0/16',
  ].join('\n'));
  assert.deepEqual(t.A, { Ref: 'Vpc' });
  assert.deepEqual(t.B, { 'Fn::GetAtt': ['Lb', 'DNSName'] });
  assert.deepEqual(t.B2, { 'Fn::GetAtt': ['Lb', 'Arn'] });
  assert.deepEqual(t.C, { 'Fn::Sub': '${AWS::StackName}-x' });
  assert.deepEqual(t.C2, { 'Fn::Sub': ['arn:${P}:s3:::${B}', { B: { Ref: 'Bucket' } }] });
  assert.deepEqual(t.D, { 'Fn::If': ['IsProd', 2, { Ref: 'AWS::NoValue' }] });
  assert.deepEqual(t.E, { 'Fn::Select': [1, { 'Fn::GetAZs': '' }] });
  assert.deepEqual(t.F, { 'Fn::Join': ['', ['a', { Ref: 'B' }]] });
  assert.deepEqual(t.G, { 'Fn::Split': [',', { 'Fn::ImportValue': 'Shared' }] });
  assert.deepEqual(t.H, { 'Fn::FindInMap': ['Sizing', { Ref: 'Env' }, 'Db'] });
  assert.deepEqual(t.I, { 'Fn::Equals': [{ Ref: 'Env' }, 'prod'] });
  assert.deepEqual(t.J, { 'Fn::Not': [{ Condition: 'IsProd' }] });
  assert.deepEqual(t.K, { 'Fn::And': [{ Condition: 'IsProd' }, { 'Fn::Or': [{ Condition: 'A' }, { Condition: 'B' }] }] });
  assert.deepEqual(t.L, { 'Fn::Base64': '#!/bin/bash\necho ${X} # kept\n' });
  assert.deepEqual(t.M, { 'Fn::Cidr': [{ 'Fn::GetAtt': ['Vpc', 'CidrBlock'] }, 6, 8] });
  assert.equal(t.N, 'folded text');
  assert.deepEqual(t.O, ['a', 'b', 'c']);
  assert.equal(t.P, "it's");
  assert.equal(t.Q, 'tab\tquote"');
  assert.deepEqual(t.S, { x: 1 });
  assert.deepEqual(t.T, [{ k: 1, v: 'two' }, 'plain scalar']);
  assert.equal(t.U, '2010-09-09');
  assert.equal(t.V, '0755');
  assert.equal(t.W, '10.0.0.0/16');
  // the evaluator's template, YAML and JSON, read the same
  assert.deepEqual(parseYaml(read('cfn-webapp.yaml')), JSON.parse(read('cfn-webapp.json')));
  assert.deepEqual(loadTemplate(read('cfn-webapp.json')), loadTemplate(read('cfn-webapp.yaml')));
  assert.throws(() => parseYaml('A: !Reff X'), /unknown tag !Reff/);
  assert.throws(() => parseYaml('A:\n\tB: 1'), /tab in the indentation/);
  assert.throws(() => loadTemplate('Description: no resources'), /no Resources section/);
});

test('the webapp ledger: every fact derived, assumed or dropped, with the resources it came from', () => {
  const { report } = webapp();
  const L = report.ledger;
  const find = (kind, re) => L.find((l) => l.kind === kind && re.test(l.fact));
  const has = (l, ...keys) => { assert.ok(l, 'missing fact'); for (const k of keys) assert.ok(l.from.includes(k), `${l.fact}: from lacks ${k} (${l.from.join(', ')})`); };
  for (const l of L) { assert.ok(['derived', 'assumed', 'dropped'].includes(l.kind), l.kind); assert.equal(typeof l.fact, 'string'); assert.ok(Array.isArray(l.from)); assert.doesNotMatch(l.fact, /\u2014/); }
  // derived from the template
  has(find('derived', /^PublicSubnet1 is a public subnet: route table PublicRouteTable sends 0\.0\.0\.0\/0 to the internet gateway InternetGateway/), 'PublicSubnet1', 'PublicAssoc1', 'PublicRouteTable', 'PublicDefaultRoute', 'InternetGateway');
  has(find('derived', /^PrivateSubnet2 is a private subnet with egress: .*NatGateway2/), 'PrivateSubnet2', 'PrivateAssoc2', 'PrivateRouteTable2', 'PrivateDefaultRoute2', 'NatGateway2');
  has(find('derived', /^PrivateSubnet2 sits in AZ position 2: !Select \[1, !GetAZs\]/), 'PrivateSubnet2');
  has(find('derived', /^LoadBalancer spans PublicSubnet1, PublicSubnet2: drawn once per Availability Zone/), 'LoadBalancer');
  has(find('derived', /^AppAsg is an Auto Scaling group .*Min 2, Max 6, Desired 2/), 'AppAsg', 'PrivateSubnet1', 'PrivateSubnet2');
  has(find('derived', /^LoadBalancer forwards to AppAsg on :8080: listener Listener > target group TargetGroup > AppAsg/), 'Listener', 'TargetGroup', 'AppAsg', 'AppSg', 'AlbSg');
  has(find('derived', /^AppAsg reaches Database on :5432: DbSg allows ingress from AppSg \(AppAsg carries AppSg through LaunchTemplate\)/), 'DbSg', 'AppSg', 'LaunchTemplate', 'Database');
  has(find('derived', /^AppAsg may call AssetsBucket \(s3:GetObject\).*a weak edge/), 'LaunchTemplate', 'InstanceProfile', 'InstanceRole', 'AssetsBucket');
  has(find('derived', /^LoadBalancer is internet-facing \(the default Scheme\)|^LoadBalancer is internet-facing in public subnets/), 'InternetGateway');
  has(find('derived', /^Database is placed through the subnet group DbSubnetGroup/), 'Database', 'DbSubnetGroup');
  has(find('derived', /^PrivateSubnet1 reaches the internet through NatGateway1/), 'PrivateRouteTable1', 'NatGateway1');
  has(find('derived', /^NatEip1 \(AWS::EC2::EIP\) is folded into NatGateway1/), 'NatEip1', 'NatGateway1');
  // assumed: each with a question for the customer
  const multi = find('assumed', /^Database is Multi-AZ: MultiAZ is Fn::If \[IsProd, \.\.\.\] and IsProd is true because Environment is "prod" \(its default\)/);
  has(multi, 'Database');
  assert.match(multi.ask, /IsProd decides Database\.MultiAZ/);
  assert.match(find('assumed', /^Database's primary is drawn in Availability Zone 1 and the standby in Availability Zone 2/).ask, /Which AZ holds Database's primary/);
  assert.ok(find('assumed', /^Users reach InternetGateway from the internet \(HTTP :80\)/).ask);
  assert.ok(find('assumed', /^Parameter Environment = "prod": its default/));
  for (const l of L.filter((x) => x.kind === 'assumed')) assert.ok(l.ask, `${l.fact}: no question`);
  // dropped
  has(find('dropped', /^CpuAlarm \(AWS::CloudWatch::Alarm\) is operational/), 'CpuAlarm');
  assert.ok(find('dropped', /^Outputs \(AlbDns\) are not drawn/));
  // every resource of the template is accounted for
  const all = Object.keys(loadTemplate(read('cfn-webapp.yaml')).Resources);
  const named = new Set(L.flatMap((l) => l.from));
  assert.deepEqual(all.filter((k) => !named.has(k)), []);
  assert.equal(report.resources.length, all.length);
  assert.deepEqual(report.resources.find((r) => r.key === 'LoadBalancer').nodes, ['LoadBalancer-az1', 'LoadBalancer-az2']);
  assert.equal(report.resources.find((r) => r.key === 'CpuAlarm').as, 'dropped');
  assert.equal(report.resources.find((r) => r.key === 'TargetGroup').as, 'edge');
  // a parameter given changes the facts: dev is single-AZ, so no standby
  const dev = webapp({ params: { Environment: 'dev' } });
  assert.ok(dev.report.ledger.some((l) => l.kind === 'derived' && /^Database is single-AZ: MultiAZ is Fn::If \[IsProd, \.\.\.\] and IsProd is false because Environment is "dev" \(given\)/.test(l.fact)));
  assert.ok(!dev.spec.nodes.some((n) => /standby/.test(n.id)));
  assert.ok(dev.report.ledger.some((l) => l.kind === 'derived' && /^Parameter Environment = "dev" \(given\)/.test(l.fact)));
  // the sidecar's pin answers "which AZ": derived, via the sidecar
  const pinned = webapp({ flows: { ...flows(), pin: { 'Database@primary': 'az2' } } });
  const p = pinned.report.ledger.find((l) => /^Database's primary is drawn in Availability Zone 2/.test(l.fact));
  assert.equal(p.kind, 'derived'); assert.equal(p.via, 'sidecar');
  const prim = pinned.spec.nodes.find((n) => n.id === 'Database-primary'), stby = pinned.spec.nodes.find((n) => n.id === 'Database-standby');
  assert.ok(prim.y > stby.y, 'the primary is drawn in the lower AZ row');
});

test('the webapp drawing: AZ rows, tiers as columns, replicas per AZ', () => {
  const { spec } = webapp();
  const g = (id) => spec.groups.find((x) => x.id === id), n = (id) => spec.nodes.find((x) => x.id === id);
  assert.deepEqual(spec.groups.filter((x) => x.kind === 'az').map((x) => x.label), ['Availability Zone 1', 'Availability Zone 2']);
  assert.ok(g('az1').y + g('az1').h <= g('az2').y, 'AZ 1 above AZ 2');
  assert.equal(g('PublicSubnet1').kind, 'pub'); assert.equal(g('PrivateSubnet1').kind, 'priv');
  assert.equal(g('PublicSubnet1').note, '10.0.0.0/24');
  assert.ok(g('PublicSubnet1').x < g('PrivateSubnet1').x, 'public tier left of private');
  assert.equal(n('LoadBalancer-az1').x, n('LoadBalancer-az2').x, 'replicas share a column');
  assert.equal(n('Database-primary').x, n('Database-standby').x, 'primary and standby share a column');
  assert.ok(n('NatGateway1').y > n('LoadBalancer-az1').y, 'the NAT gateway sits under the load balancer');
  assert.equal(n('Database-standby').icon, 'aws-res-aurora-postgresql-instance-alternate');
  assert.equal(n('Users').x < g('cloud').x, true, 'users outside the AWS Cloud');
  assert.ok(n('AssetsBucket').x > g('Vpc').x + g('Vpc').w, 'S3 beside the VPC');
  // one Auto Scaling group frame across both AZ rows, around both instances
  const asg = spec.groups.filter((x) => x.kind === 'asg');
  assert.deepEqual(asg.map((x) => x.id), ['AppAsg-asg']);
  for (const id of ['AppAsg-az1', 'AppAsg-az2']) { const m = n(id); assert.ok(m.x >= asg[0].x && m.y >= asg[0].y && m.y + 40 <= asg[0].y + asg[0].h, `${id} inside the ASG frame`); }
  assert.ok(g('az1').align === 'left' && g('az2').align === 'left', 'AZ titles move left, off the spanning frame');
  assert.equal(wireBy(spec, 'LoadBalancer-az1', 'AppAsg-az1').label, ':8080');
  assert.equal(wireBy(spec, 'AppAsg-az2', 'Database-primary').label, ':5432');
  assert.ok(!wireBy(spec, 'LoadBalancer-az1', 'AppAsg-az2'), 'no cross-AZ load balancer wire');
  assert.equal(wireBy(spec, 'AppAsg-az1', 'AssetsBucket').dashed, true);
  const rep = wireBy(spec, 'Database-primary', 'Database-standby');
  assert.ok(rep.dashed && rep.flow);
  assert.match(rep.d, /^M[\d.]+,[\d.]+ V[\d.]+$/, 'replication runs straight down between the AZ rows');
  assert.equal(spec.timeline, undefined, 'no sidecar, no animation');
  assert.match(spec.desc, /No animation/);
});

test('the sidecar compiles to the expected timeline with story()', () => {
  const { spec, report } = webapp({ flows: flows() });
  assert.equal(report.story.channel, 'sidecar');
  assert.equal(report.story.flow, 'page-view');
  assert.deepEqual(report.story.available, ['page-view', 'az-failure', 'scale-out']);
  assert.equal(spec.dur, 10);
  const w = (a, b) => wireBy(spec, a, b).id;
  const users = w('Users', 'InternetGateway'), igw = w('InternetGateway', 'LoadBalancer-az1'), lb = w('LoadBalancer-az1', 'AppAsg-az1'), db = w('AppAsg-az1', 'Database-primary'), rep = w('Database-primary', 'Database-standby');
  const expected = story([
    { wire: users, ring: 'InternetGateway' }, { wire: igw, ring: 'LoadBalancer-az1' }, { wire: lb, ring: 'AppAsg-az1' }, { wire: db, ring: 'Database-primary' },
    { wire: rep, kind: 'pk-2', ring: 'Database-standby', step: false },
    { wire: db, reverse: true, kind: 'pk-2', ring: 'AppAsg-az1', step: false }, { wire: lb, reverse: true, kind: 'pk-2', ring: 'LoadBalancer-az1', step: false },
    { wire: igw, reverse: true, kind: 'pk-2', ring: 'InternetGateway', step: false }, { wire: users, reverse: true, kind: 'pk-2', ring: 'Users', step: false },
  ]);
  assert.deepEqual(spec.timeline, expected.timeline);
  assert.deepEqual(spec.steps.map((s) => [s.n, s.at]), [[1, users], [2, igw], [3, lb], [4, db]]);
  assert.equal(spec.steps[0].text, 'Users to Internet gateway on HTTP :80.');
  assert.equal(spec.steps[3].text, 'EC2 instance (AppAsg) to RDS primary (Database) on :5432.');
  assert.equal(wireBy(spec, 'Users', 'InternetGateway').label, 'HTTP :80');
  assert.ok(report.ledger.some((l) => l.via === 'sidecar' && /^Users > InternetGateway \(HTTP :80\) is a hop the sidecar's flow page-view adds/.test(l.fact)));
  // the JSON template and the sidecar as text give the same timeline
  const j = imp('cfn-webapp.json', { flows: JSON.stringify(flows()) });
  assert.deepEqual(j.spec.timeline, spec.timeline);
  // the template may carry the sidecar in its Metadata
  const t = loadTemplate(read('cfn-webapp.yaml'));
  const inMeta = fromCloudFormation({ ...t, Metadata: { 'Prism::Flows': flows() } }, { id: 'cfn-webapp' });
  assert.deepEqual(inMeta.spec.timeline, spec.timeline);
  assert.ok(inMeta.report.issues.some((i) => i.code === 'sidecar' && /Metadata/.test(i.message)));
  // a step that names nothing is reported and skipped
  const bad = webapp({ flows: { flows: [{ id: 'x', steps: [{ from: 'Users', to: 'Nope' }, { from: 'InternetGateway', to: 'LoadBalancer@az3' }, { from: 'LoadBalancer@az2', to: 'AppAsg@az2' }] }], actors: [{ id: 'Users' }] } });
  assert.ok(bad.report.issues.some((i) => i.code === 'sidecar' && /Nope names nothing/.test(i.message)));
  assert.ok(bad.report.issues.some((i) => i.code === 'sidecar' && /has no az3 replica/.test(i.message)));
  assert.equal(bad.spec.timeline.length, 1);
  // hide, merge, overrides, anchors, show
  const tuned = webapp({ flows: { hide: ['AssetsBucket'], show: ['CpuAlarm'], overrides: { 'LoadBalancer@az2': { sub: 'standby ALB' }, Database: { label: 'Orders DB' } }, anchors: { Db: { cfn: 'Database' } }, pin: { 'Db@primary': 'az1' } } });
  assert.ok(!tuned.spec.nodes.some((n) => n.id === 'AssetsBucket'));
  assert.ok(tuned.spec.nodes.some((n) => n.label === 'CloudWatch alarm'));
  assert.equal(tuned.spec.nodes.find((n) => n.id === 'LoadBalancer-az2').sub, 'standby ALB');
  assert.equal(tuned.spec.nodes.find((n) => n.id === 'Db-primary').label, 'Orders DB');
  assert.ok(tuned.report.ledger.some((l) => /^AssetsBucket \(AWS::S3::Bucket\) is hidden by the sidecar/.test(l.fact)));
});

test('sidecar stories: az-fail replays the request through the other AZ, asg-scale adds ghosted instances', () => {
  const f = webapp({ flows: flows(), story: 'az-failure' });
  assert.equal(f.report.story.template, 'az-failure');
  const fx = f.spec.effects;
  const fail = fx.find((e) => e.fail);
  assert.equal(fail.fail, 'az1');
  const t0 = f.spec.timeline[8].t[1];
  assert.ok(fail.t[0] >= t0 && fail.t[0] < f.spec.timeline[9].t[0] + 0.01, 'the AZ fails after the first round trip');
  const fades = fx.filter((e) => e.fade).map((e) => e.fade), glows = fx.filter((e) => e.glow).map((e) => e.glow);
  assert.ok(fades.includes(wireBy(f.spec, 'LoadBalancer-az1', 'AppAsg-az1').id));
  const promoted = wireBy(f.spec, 'AppAsg-az2', 'Database-standby');
  assert.ok(promoted, 'the failover adds the wire to the promoted standby');
  assert.ok(glows.includes(promoted.id) && glows.includes(wireBy(f.spec, 'LoadBalancer-az2', 'AppAsg-az2').id));
  assert.equal(f.spec.timeline.length, 17);
  assert.deepEqual(f.spec.steps.map((s) => s.n), [1, 2, 3, 4], 'the replay carries no new badges');
  assert.ok(f.spec.dur >= 14);
  assert.ok(f.report.ledger.some((l) => /^story az-failure: after Availability Zone 1 fails, EC2 instance \(AppAsg\) reaches RDS standby \(promoted\)/.test(l.fact)));
  const s = webapp({ flows: flows(), story: 'scale-out' });
  const app = s.spec.effects.filter((e) => e.appear);
  assert.deepEqual(app.map((e) => e.appear), ['AppAsg-az1-2', 'AppAsg-az2-2']);
  assert.ok(app.every((e) => e.ghost));
  const fr = s.spec.groups.find((g) => g.kind === 'asg' && /^AppAsg-(az1-)?asg$/.test(g.id)), n2 = s.spec.nodes.find((n) => n.id === 'AppAsg-az1-2');
  assert.ok(n2.x >= fr.x && n2.y + 40 <= fr.y + fr.h, 'the new instance sits in the ASG frame');
  assert.equal(webapp({ flows: flows(), story: 'nope' }).report.issues.find((i) => i.code === 'story').severity, 'warn');
});

test('no sidecar: no animation; story guess walks from the internet entry and says so', () => {
  const { spec, report } = webapp({ story: 'guess' });
  assert.equal(report.story.channel, 'bfs');
  assert.ok(report.issues.some((i) => i.code === 'story-guess' && i.severity === 'info'));
  assert.equal(spec.timeline[0].ring, 'InternetGateway');
  assert.deepEqual(spec.steps.map((s) => s.n), [1, 2, 3, 4]);
  assert.ok(!spec.timeline.some((t) => /az2/.test(t.ring || '')), 'one representative path, through AZ 1');
  assert.ok(spec.timeline.slice(4).every((t) => t.kind === 'pk-2' && t.reverse));
  assert.equal(webapp({ story: 'none', flows: flows() }).spec.timeline, undefined);
});

test('CDK synth output: construct paths name the nodes, helpers fold away', () => {
  const { spec, report } = imp('cfn-cdk-fargate.json');
  assert.equal(report.cdk, true);
  const ids = spec.nodes.map((n) => n.id);
  assert.ok(ids.includes('ApiService-LB-az1') && ids.includes('ApiService-Service-az2') && ids.includes('OrdersTable'), ids.join(' '));
  assert.ok(!spec.nodes.some((n) => /Lambda/.test(n.label)), 'custom resource provider functions are folded');
  assert.equal(spec.nodes.find((n) => n.id === 'ApiService-LB-az1').sub, 'ApiService/LB');
  assert.equal(spec.nodes.find((n) => n.id === 'PublicSubnet1-NATGateway').sub, 'PublicSubnet1/NATGateway');
  for (const k of ['CustomS3AutoDeleteObjectsCustomResourceProviderHandler9D90184F', 'CustomVpcRestrictDefaultSGCustomResourceProviderRole26592FE0', 'AssetsBucketAutoDeleteObjectsCustomResource2C4E6A8B']) assert.equal(report.resources.find((r) => r.key === k).as, 'folded', k);
  assert.equal(report.resources.find((r) => r.key === 'CDKMetadata').as, 'meta');
  assert.ok(report.issues.some((i) => i.code === 'cdk' && /helper/.test(i.message)));
  // the ledger reads in construct paths and keeps the logical ids in from
  const nat = report.ledger.find((l) => /^ServiceVpc\/PrivateSubnet2 \(Availability Zone 2\) sends its internet traffic to ServiceVpc\/PublicSubnet1\/NATGateway in Availability Zone 1/.test(l.fact));
  assert.ok(nat && nat.ask && nat.from.includes('ServiceVpcPublicSubnet1NATGateway8A9B0C1D'));
  assert.ok(report.ledger.some((l) => /^ApiService\/LB forwards to ApiService\/Service on :80/.test(l.fact)));
  assert.ok(report.ledger.some((l) => /^ApiService\/Service may call OrdersTable \(dynamodb:/.test(l.fact) && l.from.includes('ApiServiceTaskDefTaskRoleDefaultPolicy5B6A7C8D')));
  // the sidecar may name resources by construct path
  const side = imp('cfn-cdk-fargate.json', { flows: { actors: [{ id: 'Users' }], flows: [{ id: 'f', steps: [{ from: 'Users', to: 'ServiceVpc/IGW' }, { from: 'ServiceVpc/IGW', to: 'ApiService/LB@az1' }, { from: 'ApiService/LB@az1', to: 'ApiService/Service@az1' }] }] } });
  assert.equal(side.spec.steps.length, 3);
  assert.equal(side.report.issues.filter((i) => i.code === 'sidecar').length, 0, JSON.stringify(side.report.issues));
});

test('SAM processed form: API integrations, the event source mapping and IAM edges', () => {
  const { spec, report } = imp('cfn-sam-orders.json');
  assert.equal(report.sam, 'processed');
  const api = wireBy(spec, 'ServerlessRestApi', 'GetOrderFunction');
  assert.ok(api && !api.dashed, 'API Gateway to the function (OpenAPI body)');
  assert.ok(wireBy(spec, 'ServerlessRestApi', 'CreateOrderFunction'));
  assert.equal(wireBy(spec, 'OrdersQueue', 'FulfillFunction').dashed, true, 'the event source mapping is asynchronous');
  assert.equal(wireBy(spec, 'GetOrderFunction', 'OrdersTable').label, 'dynamodb read');
  assert.equal(wireBy(spec, 'CreateOrderFunction', 'OrdersTable').label.replace(/\n/g, ' '), 'dynamodb read/write');
  assert.equal(wireBy(spec, 'FulfillFunction', 'OrderEventsTopic').label, 'sns:Publish');
  assert.equal(wireBy(spec, 'Users', 'ServerlessRestApi').label, 'HTTPS');
  assert.ok(!spec.groups.some((g) => g.kind === 'vpc'));
  assert.ok(report.ledger.some((l) => l.kind === 'dropped' && /ServerlessRestApiProdStage/.test(l.fact)));
  // with its sidecar: six numbered steps, the confirmed write becomes solid, the async legs stay dashed
  const s = imp('cfn-sam-orders.json', { flows: sidecarOf('cfn-sam-orders.json') });
  assert.deepEqual(s.spec.steps.map((x) => x.n), [1, 2, 3, 4, 5, 6]);
  assert.equal(s.spec.steps[0].text, 'The client posts an order to the REST API.');
  assert.ok(!wireBy(s.spec, 'CreateOrderFunction', 'OrdersTable').dashed, 'a request step confirms the IAM edge');
  assert.equal(wireBy(s.spec, 'CreateOrderFunction', 'OrdersQueue').dashed, true);
  assert.equal(s.spec.nodes.find((n) => n.id === 'ServerlessRestApi').sub, 'Orders API');
  assert.equal(s.spec.name, 'Orders API (SAM)');
  // the SAM source (not transformed) is approximated, with a warning
  const src = fromCloudFormation([
    'Transform: AWS::Serverless-2016-10-31',
    'Resources:',
    '  Table:',
    '    Type: AWS::Serverless::SimpleTable',
    '  Fn:',
    '    Type: AWS::Serverless::Function',
    '    Properties:',
    '      Handler: app.handler',
    '      Runtime: python3.13',
    '      Policies:',
    '        - DynamoDBCrudPolicy: { TableName: !Ref Table }',
    '      Events:',
    '        Get:',
    '          Type: Api',
    '          Properties: { Path: /items, Method: get }',
  ].join('\n'), { id: 'cfn-sam-src' });
  assert.ok(src.report.issues.some((i) => i.code === 'sam-source' && i.severity === 'warn'));
  assert.ok(wireBy(src.spec, 'ServerlessRestApi', 'Fn'));
  assert.equal(wireBy(src.spec, 'Fn', 'Table').label, 'DynamoDBCrudPolicy');
  assertClean(src.spec, { ...src.report, issues: src.report.issues }, 'sam source');
});

test('Parameters and Conditions: defaults, overrides, NoValue, FindInMap, ImportValue, isolated subnets', () => {
  const dev = imp('cfn-conditions.yaml');
  const prod = imp('cfn-conditions.yaml', { params: { EnvType: 'prod', EnableCache: 'true' } });
  const kinds = (r) => Object.fromEntries(r.spec.groups.filter((g) => g.kind === 'priv' || g.kind === 'pub').map((g) => [g.id, g.label || g.kind]));
  assert.equal(kinds(dev).AppSubnetA, 'Isolated subnet', 'dev has no NAT gateway: the app subnets have no default route');
  assert.equal(kinds(prod).AppSubnetA, 'priv');
  assert.equal(kinds(prod).DataSubnetA, 'Isolated subnet');
  assert.ok(dev.report.ledger.some((l) => l.kind === 'assumed' && /^NatGateway \(AWS::EC2::NatGateway\) does not exist: its Condition IsProd is false because EnvType is "dev" \(its default\)/.test(l.fact)));
  assert.ok(prod.report.ledger.some((l) => l.kind === 'derived' && /^Condition CreateCache is true because EnvType is "prod" \(given\) and EnableCache is "true" \(given\)/.test(l.fact)));
  const ids = (r) => r.spec.nodes.map((n) => n.id).sort();
  assert.ok(!ids(dev).includes('NatGateway') && ids(prod).includes('NatGateway'));
  assert.ok(ids(prod).includes('DbReader') && !ids(dev).includes('DbReader'));
  assert.ok(ids(prod).includes('Cache-primary') && ids(prod).includes('Cache-standby'));
  assert.equal(prod.spec.nodes.find((n) => n.id === 'DbWriter').label, 'Aurora writer');
  // readers collapse onto the writer: requests go to the writer
  assert.ok(!prod.spec.wires.some((w) => w.to === 'DbReader'));
  // the internal ALB has no internet entry, so no Users
  assert.ok(!ids(dev).includes('Users'));
  assert.ok(dev.report.issues.some((i) => i.code === 'import-value' && /shared-alerts-topic-arn/.test(i.message)));
  assert.ok(dev.report.issues.some((i) => i.code === 'kit-gap' && /isolated-subnet/.test(i.message)));
  assert.ok(dev.report.ledger.some((l) => /^AppSubnetA sits in AZ position 1: !Select \[0, !Ref AvailabilityZones\]/.test(l.fact)));
  // a cluster's instances answer to Cluster@writer and Cluster@reader
  const q = imp('cfn-conditions.yaml', { params: { EnvType: 'prod' }, flows: { actors: [{ id: 'Ops', to: ['InternalAlb@az1'] }], flows: [{ id: 'f', steps: [{ from: 'AppInstanceA', to: 'DbCluster@writer' }, { from: 'AppInstanceB', to: 'DbCluster@reader', kind: 'async' }] }] } });
  assert.deepEqual(q.report.issues.filter((i) => i.code === 'sidecar'), []);
  assert.deepEqual(q.spec.timeline.map((t) => t.ring), ['DbWriter', 'DbReader']);
  assert.ok(wireBy(q.spec, 'Ops', 'InternalAlb-az1'), 'an actor wired with to');
  // NoValue drops a property; FindInMap reads the mapping
  const t = loadTemplate(read('cfn-conditions.yaml'));
  assert.deepEqual(t.Resources.AppInstanceA.Properties.InstanceType, { 'Fn::FindInMap': ['Sizing', { Ref: 'EnvType' }, 'Instance'] });
  assert.equal(dev.report.resources.find((r) => r.key === 'AppInstanceA').as, 'node');
});

test('rules tables: the webapp groups as console tables beside the drawing, the admitting row lit while the request crosses', () => {
  const { spec, report } = webapp({ flows: flows(), rules: true });
  assertClean(spec, report, 'webapp rules');
  const t = (id) => spec.tables.find((x) => x.id === id);
  assert.deepEqual(spec.tables.map((x) => x.title), ['AlbSg inbound rules', 'AppSg inbound rules', 'DbSg inbound rules'], 'in the order the story reaches them');
  assert.ok(spec.tables.every((x) => x.tone === 'security' && x.cols.join() === 'Type,Protocol,Port range,Source'));
  const win = (a, b) => spec.timeline.find((e) => e.wire === wireBy(spec, a, b).id && !e.reverse).t;
  assert.deepEqual(t('AlbSg-in').rows, [{ cells: ['HTTP', 'TCP', '80', '0.0.0.0/0'], t: win('InternetGateway', 'LoadBalancer-az1'), tone: 'ok' }, { cells: ['All traffic', 'All', 'All', 'no match: denied'], tone: 'muted' }]);
  assert.deepEqual(t('AppSg-in').rows[0], { cells: ['Custom TCP', 'TCP', '8080', 'AlbSg'], t: win('LoadBalancer-az1', 'AppAsg-az1'), tone: 'ok' });
  assert.deepEqual(t('DbSg-in').rows[0], { cells: ['PostgreSQL', 'TCP', '5432', 'AppSg'], t: win('AppAsg-az1', 'Database-primary'), tone: 'ok' });
  // a column right of the AWS Cloud frame from the VPC's top, in a full tile
  const cloud = spec.groups.find((g) => g.kind === 'cloud'), vpc = spec.groups.find((g) => g.kind === 'vpc');
  for (const x of spec.tables) assert.ok(x.x > cloud.x + cloud.w && x.x + x.w <= spec.w && x.y >= vpc.y, x.id);
  assert.ok(spec.full && spec.w <= 1400 && spec.h <= 900);
  assert.deepEqual(report.rules, { tables: [{ id: 'AlbSg-in', group: 'AlbSg', dir: 'in', rows: 2, lit: 1 }, { id: 'AppSg-in', group: 'AppSg', dir: 'in', rows: 2, lit: 1 }, { id: 'DbSg-in', group: 'DbSg', dir: 'in', rows: 2, lit: 1 }], omitted: [], placed: 'right' });
  assert.equal(report.tile.w, spec.w);
  assert.match(spec.desc, /Rules tables list the security group rules; the row that admits a request lights as its packet arrives\.$/);
  // the ledger: each row with its evidence, the lit rows, the outbound rules not shown
  const L = report.ledger;
  const has = (re, ...keys) => { const l = L.find((x) => re.test(x.fact)); assert.ok(l, String(re)); for (const k of keys) assert.ok(l.from.includes(k), `${l.fact}: from lacks ${k}`); return l; };
  has(/^AppSg allows Custom TCP \(TCP 8080\) in from the security group AlbSg \(row 1 of its inbound rules table\)$/, 'AppSg', 'AlbSg');
  has(/^DbSg drops any other inbound traffic: security groups only allow/, 'DbSg');
  assert.equal(has(/^story: DbSg's inbound rule PostgreSQL \(TCP 5432\) from the security group AppSg admits EC2 instance \(AppAsg\) to RDS primary \(Database\) on :5432/, 'LaunchTemplate', 'Database').via, 'sidecar');
  assert.equal(has(/^AppSg's outbound rules are not shown \(unrestricted; rules \{ outbound: true \} shows them\): all traffic to 0\.0\.0\.0\/0, the default rule$/, 'AppSg').kind, 'dropped');
  // only when asked; the option beats the sidecar; a list names the groups; outbound tables on demand
  assert.equal(webapp({ flows: flows() }).spec.tables, undefined);
  assert.equal(webapp({ flows: { ...flows(), rules: true }, rules: false }).spec.tables, undefined);
  const db = webapp({ flows: flows(), rules: ['DbSg'] });
  assert.deepEqual(db.spec.tables.map((x) => x.id), ['DbSg-in']);
  assert.deepEqual(db.report.rules.omitted, [{ group: 'AlbSg', why: 'the rules option names DbSg' }, { group: 'AppSg', why: 'the rules option names DbSg' }]);
  assert.ok(db.report.ledger.some((l) => l.kind === 'dropped' && l.fact === "AlbSg's rules are not shown: the rules option names DbSg"));
  const out = webapp({ rules: { outbound: true } });
  assertClean(out.spec, out.report, 'webapp outbound');
  assert.deepEqual(out.spec.tables.find((x) => x.id === 'AppSg-out').rows, [{ cells: ['All traffic', 'All', 'All', '0.0.0.0/0 (default)'], tone: 'muted' }, { cells: ['All traffic', 'All', 'All', 'no match: denied'], tone: 'muted' }]);
  assert.ok(webapp({ rules: ['Nope'] }).report.issues.some((i) => i.code === 'rules' && i.severity === 'warn' && /Nope, which is not a security group/.test(i.message)));
});

test('dual stack: both CIDRs on the frames, the egress-only internet gateway, IPv6 packets as diamonds, the ::/0 row lit', () => {
  const side = sidecarOf('cfn-webapp-dualstack.yaml');
  const { spec, report } = imp('cfn-webapp-dualstack.yaml', { flows: side });
  assertClean(spec, report, 'dual stack');
  const g = (id) => spec.groups.find((x) => x.id === id), n = (id) => spec.nodes.find((x) => x.id === id), t = (id) => spec.tables.find((x) => x.id === id);
  assert.deepEqual(g('Vpc').note, ['10.0.0.0/16', '2001:db8:1200::/56']);
  assert.deepEqual(g('PublicSubnet1').note, ['10.0.0.0/24', '2001:db8:1200::/64']);
  assert.deepEqual(g('PrivateSubnet2').note, ['10.0.11.0/24', '2001:db8:1200:11::/64']);
  // the second note line sits inside the frame: the content starts below it
  for (const s of ['PublicSubnet1', 'PrivateSubnet1']) assert.ok(spec.nodes.filter((x) => x.x > g(s).x && x.x < g(s).x + g(s).w && x.y > g(s).y && x.y < g(s).y + g(s).h).every((x) => x.y >= g(s).y + 30), s);
  const eigw = n('EgressOnlyInternetGateway');
  assert.equal(eigw.icon, 'aws-res-vpc-internet-gateway');
  assert.equal(eigw.label, 'Egress-only internet gateway');
  assert.ok(eigw.x < g('az1').x, 'on the VPC edge with the internet gateway');
  assert.ok(report.issues.some((i) => i.code === 'kit-gap' && /egress-only internet gateway/.test(i.message)));
  assert.ok(!report.unmapped.length);
  const L = report.ledger;
  const has = (re, ...keys) => { const l = L.find((x) => re.test(x.fact)); assert.ok(l, String(re)); for (const k of keys) assert.ok(l.from.includes(k), `${l.fact}: from lacks ${k}`); return l; };
  has(/^Vpc is dual-stack: VpcIpv6Block gives it the IPv6 block 2001:db8:1200::\/56$/, 'Vpc', 'VpcIpv6Block');
  has(/^PrivateSubnet1 is dual-stack: its IPv6 CIDR is 2001:db8:1200:10::\/64$/, 'PrivateSubnet1');
  has(/^PrivateSubnet1 sends IPv6 traffic \(::\/0\) to the egress-only internet gateway EgressOnlyInternetGateway: IPv6 out only/, 'PrivateRouteTable1', 'PrivateIpv6Route1', 'EgressOnlyInternetGateway');
  has(/^PublicSubnet2 sends IPv6 traffic \(::\/0\) to the internet gateway InternetGateway: IPv6 in and out$/, 'PublicDefaultRouteIpv6');
  has(/^PublicSubnet1 is a public subnet: route table PublicRouteTable sends 0\.0\.0\.0\/0 to the internet gateway/, 'PublicDefaultRoute');
  // IPv6 to the dual-stack load balancer, IPv4 from it to its targets; the responses keep their hop's shape
  assert.deepEqual(spec.timeline.map((e) => !!e.v6), [true, true, false, false, false, false, false, true, true]);
  assert.equal(spec.steps[0].text, 'A browser opens the site over IPv6: the load balancer is dual-stack.');
  assert.deepEqual(spec.legend && Object.keys(spec.legend), ['x', 'y'], 'the IPv4/IPv6 key under the tables');
  assert.match(standalone(spec, { theme: 'light' }), /class="pk pk-v6"[\s\S]*>IPv6 packet</);
  // rules: the IPv6 source on its own row; the prefix list and the group references by name; AppSg's restricted egress
  const win = (i) => spec.timeline[i].t;
  assert.deepEqual(spec.tables.map((x) => x.id), ['AlbSg-in', 'AppSg-in', 'AppSg-out', 'DbSg-in']);
  assert.deepEqual(t('AlbSg-in').rows, [{ cells: ['HTTPS', 'TCP', '443', '0.0.0.0/0'] }, { cells: ['HTTPS', 'TCP', '443', '::/0'], t: win(1), tone: 'ok' }, { cells: ['All traffic', 'All', 'All', 'no match: denied'], tone: 'muted' }]);
  assert.deepEqual(t('AppSg-in').rows.map((r) => r.cells), [['Custom TCP', 'TCP', '8080', 'AlbSg'], ['SSH', 'TCP', '22', 'prefix list corp-offices'], ['All traffic', 'All', 'All', 'no match: denied']]);
  assert.equal(t('AppSg-out').title, 'AppSg outbound rules');
  assert.deepEqual(t('AppSg-out').cols, ['Type', 'Protocol', 'Port range', 'Destination']);
  assert.deepEqual(t('AppSg-out').rows.map((r) => [r.cells[3], r.t || null]), [['0.0.0.0/0', null], ['::/0', null], ['DbSg', win(3)], ['no match: denied', null]]);
  assert.deepEqual(t('DbSg-in').rows[0], { cells: ['PostgreSQL', 'TCP', '5432', 'AppSg'], t: win(3), tone: 'ok' });
  has(/^AppSg allows PostgreSQL \(TCP 5432\) out to the security group DbSg \(row 3 of its outbound rules table\)$/, 'AppToDbEgress', 'DbSg');
  has(/^AppSg allows SSH \(TCP 22\) in from the prefix list CorpPrefixList \(corp-offices\)/, 'CorpPrefixList');
  assert.ok(!L.some((l) => l.kind === 'dropped' && /^(CorpPrefixList|AppToDbEgress) /.test(l.fact)), 'a rule a table shows is not dropped');
  has(/^DbSg's outbound rules are not shown .*all traffic to 0\.0\.0\.0\/0, the default rule; all traffic to ::\/0 \(IPv6\), the default rule$/);
  // the IPv4 flow lights the 0.0.0.0/0 row instead
  const v4 = imp('cfn-webapp-dualstack.yaml', { flows: side, story: 'page-view' }).spec.tables[0].rows;
  assert.ok(v4[0].t && !v4[1].t);
  // a failed packet no rule admits lights the implicit deny red; a request no rule admits is reported
  const bad = imp('cfn-webapp-dualstack.yaml', { flows: { ...side, flows: [{ id: 'ssh', steps: [{ from: 'Users', to: 'InternetGateway' }, { from: 'InternetGateway', to: 'LoadBalancer@az1', label: 'SSH :22', kind: 'bad' }] }] } });
  assertClean(bad.spec, bad.report, 'denied');
  assert.deepEqual(bad.spec.tables[0].rows[2], { cells: ['All traffic', 'All', 'All', 'no match: denied'], t: bad.spec.timeline[1].t, tone: 'bad' });
  const told = imp('cfn-webapp-dualstack.yaml', { flows: { ...side, flows: [{ id: 'ssh', steps: [{ from: 'Users', to: 'InternetGateway' }, { from: 'InternetGateway', to: 'LoadBalancer@az1', label: 'SSH :22' }] }] } });
  assert.ok(told.report.issues.some((i) => i.code === 'rules' && i.severity === 'warn' && /on :22: no inbound rule of AlbSg admits it/.test(i.message)));
  // every resource of the template is accounted for
  const named = new Set(L.flatMap((l) => l.from));
  assert.deepEqual(Object.keys(loadTemplate(read('cfn-webapp-dualstack.yaml')).Resources).filter((k) => !named.has(k)), []);
});

test('rule rows read like the console; a table holds 12 rows; groups that find no room are listed', () => {
  const sg = (ingress, extra = {}) => ({ Type: 'AWS::EC2::SecurityGroup', Properties: { GroupDescription: 'x', VpcId: { Ref: 'Vpc' }, SecurityGroupIngress: ingress, ...extra } });
  const tpl = { Resources: {
    Vpc: { Type: 'AWS::EC2::VPC', Properties: { CidrBlock: '10.1.0.0/16' } },
    Sub: { Type: 'AWS::EC2::Subnet', Properties: { VpcId: { Ref: 'Vpc' }, CidrBlock: '10.1.0.0/24' } },
    Mixed: sg([
      { IpProtocol: 'tcp', FromPort: 1024, ToPort: 65535, CidrIp: { 'Fn::GetAtt': ['Vpc', 'CidrBlock'] } },
      { IpProtocol: 'icmp', FromPort: -1, ToPort: -1, CidrIp: '192.0.2.0/24' },
      { IpProtocol: 'udp', FromPort: 53, ToPort: 53, CidrIp: '10.1.0.0/16' },
      { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, SourcePrefixListId: 'pl-example' },
      { IpProtocol: 'tcp', FromPort: 0, ToPort: 65535, SourceSecurityGroupId: { 'Fn::ImportValue': 'shared-sg' } },
      { IpProtocol: '-1', CidrIpv6: '2001:db8::/32' },
    ], { SecurityGroupEgress: [{ CidrIp: '255.255.255.255/32', Description: 'Disallow all traffic', FromPort: 252, IpProtocol: 'icmp', ToPort: 86 }] }),
    MixedSelf: { Type: 'AWS::EC2::SecurityGroupIngress', Properties: { GroupId: { Ref: 'Mixed' }, IpProtocol: 'tcp', FromPort: 7000, ToPort: 7001, SourceSecurityGroupId: { Ref: 'Mixed' } } },
    Big: sg(Array.from({ length: 14 }, (_, k) => ({ IpProtocol: 'tcp', FromPort: 8000 + k, ToPort: 8000 + k, CidrIp: '10.1.0.0/16' }))),
    Box: { Type: 'AWS::EC2::Instance', Properties: { SubnetId: { Ref: 'Sub' }, SecurityGroupIds: [{ Ref: 'Mixed' }, { Ref: 'Big' }] } },
  } };
  const { spec, report } = fromCloudFormation(tpl, { id: 'cfn-rules', rules: { outbound: true } });
  assertClean(spec, report, 'console rows');
  const t = (id) => spec.tables.find((x) => x.id === id);
  assert.deepEqual(t('Mixed-in').rows.map((r) => r.cells), [
    ['Custom TCP', 'TCP', '1024 - 65535', '10.1.0.0/16'], ['All ICMP - IPv4', 'ICMP', 'All', '192.0.2.0/24'], ['DNS (UDP)', 'UDP', '53', '10.1.0.0/16'],
    ['HTTPS', 'TCP', '443', 'prefix list pl-example'], ['All TCP', 'TCP', '0 - 65535', 'not in the source'], ['All traffic', 'All', 'All', '2001:db8::/32'],
    ['Custom TCP', 'TCP', '7000 - 7001', 'Mixed (itself)'], ['All traffic', 'All', 'All', 'no match: denied']]);
  assert.ok(report.ledger.some((l) => /^Mixed allows Custom TCP \(TCP 1024 - 65535\) in from 10\.1\.0\.0\/16 \(Vpc's block\)/.test(l.fact) && l.from.includes('Vpc')));
  // CDK's placeholder egress leaves no outbound rule
  assert.deepEqual(t('Mixed-out').rows.map((r) => r.cells[3]), ['no match: denied']);
  assert.ok(report.ledger.some((l) => /^Mixed has no outbound rules: CDK's placeholder rule/.test(l.fact)));
  // 14 rules: 10 rows, a "more" row and the deny; the rest in the ledger
  assert.equal(t('Big-in').rows.length, 12);
  assert.deepEqual(t('Big-in').rows[10], { cells: ['...', '', '', '4 more in the ledger'], tone: 'muted' });
  assert.ok(report.ledger.some((l) => l.kind === 'dropped' && /^4 more inbound rules of Big are not in its table \(a table holds 12 rows\): Custom TCP \(TCP 8010\) from 10\.1\.0\.0\/16;/.test(l.fact)));
  // more groups than a full tile holds: the ones the drawing reaches last are left out, and said so
  const many = { Resources: { Vpc: tpl.Resources.Vpc, Sub: tpl.Resources.Sub } };
  for (let i = 1; i <= 3; i++) {
    for (let j = 1; j <= 6; j++) many.Resources[`Sg${i}x${j}`] = sg(Array.from({ length: 11 }, (_, k) => ({ IpProtocol: 'tcp', FromPort: 8000 + k, ToPort: 8000 + k, CidrIp: '10.1.0.0/16' })));
    many.Resources[`Box${i}`] = { Type: 'AWS::EC2::Instance', Properties: { SubnetId: { Ref: 'Sub' }, SecurityGroupIds: Array.from({ length: 6 }, (_, j) => ({ Ref: `Sg${i}x${j + 1}` })) } };
  }
  const m = fromCloudFormation(many, { id: 'cfn-many', rules: true });
  assertClean(m.spec, m.report, 'many groups');
  assert.ok(m.spec.tables.length >= 10 && m.spec.w <= 1400 && m.spec.h <= 900);
  assert.ok(m.report.rules.omitted.length && m.report.rules.omitted.every((o) => o.why === 'no room in a full tile (1400x900)'));
  assert.equal(m.spec.tables.length + m.report.rules.omitted.length, 18);
  assert.ok(m.report.issues.some((i) => i.code === 'rules' && /^rules tables left out: Sg3x6 /.test(i.message)));
  for (const o of m.report.rules.omitted) assert.ok(m.report.ledger.some((l) => l.kind === 'dropped' && l.fact === `${o.group}'s rules are not shown: no room in a full tile (1400x900)`));
  // a tile that grows into a full one moves its drawing to the left margin
  const small = fromCloudFormation({ Resources: { Vpc: tpl.Resources.Vpc, Sub: tpl.Resources.Sub, Big: tpl.Resources.Big, Box: { Type: 'AWS::EC2::Instance', Properties: { SubnetId: { Ref: 'Sub' }, SecurityGroupIds: [{ Ref: 'Big' }] } } } }, { id: 'cfn-small', rules: true });
  assertClean(small.spec, small.report, 'small');
  assert.equal(small.spec.groups.find((x) => x.kind === 'cloud').x, 8);
});

test('index.mjs detects CloudFormation (YAML and JSON) and passes the sidecar, params and story', async () => {
  for (const f of templates) assert.equal(detectFormat(read(f), f), 'cfn', f);
  assert.equal(detectFormat('AWSTemplateFormatVersion: "2010-09-09"\nResources: {}\n'), 'cfn');
  assert.equal(detectFormat('Resources:\n  B:\n    Type: AWS::S3::Bucket\n'), 'cfn');
  const r = await importDiagram(read('cfn-webapp.yaml'), { file: 'webapp.cfn.yaml', flows: flows() });
  assert.equal(r.report.from, 'cfn');
  assert.equal(r.spec.id, 'cfn-webapp');
  assert.equal(r.spec.timeline.length, 9);
  const p = await importDiagram(read('cfn-conditions.yaml'), { from: 'cfn', params: { EnvType: 'prod' }, story: 'guess' });
  assert.ok(p.spec.nodes.some((n) => n.id === 'NatGateway'));
  assert.equal(p.report.story.channel, 'bfs');
});
