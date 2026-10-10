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
  assert.equal(spec.groups.filter((x) => x.kind === 'asg').length, 2);
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
  const fr = s.spec.groups.find((g) => g.id === 'AppAsg-az1-asg'), n2 = s.spec.nodes.find((n) => n.id === 'AppAsg-az1-2');
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
