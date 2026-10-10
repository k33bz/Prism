// Tests for the Terraform importer (tf.mjs over iac.mjs): plan and state JSON, modules and count, edges
// from configuration references and from matching ids and ARNs, addresses as kit ids, HCL refused.
// Run: node --test catalog/aws-kit/import/tf.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSpec, lint, standalone } from '../awd.mjs';
import { validateDiagram } from '../spec.mjs';
import { fromTerraform, tfId, HCL_MESSAGE } from './tf.mjs';
import { fromCloudFormation } from './cfn.mjs';
import { importDiagram, detectFormat } from './index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const fixtures = fs.readdirSync(FIX).filter((f) => /^tf-.*\.json$/.test(f) && !/\.flows\.json$/.test(f));
const errors = (list) => list.filter((x) => x.severity === 'error');
const imp = (f, o = {}) => fromTerraform(read(f), { file: f.replace(/\.json$/, ''), ...o });
const wireBy = (spec, from, to) => spec.wires.find((w) => w.from === from && w.to === to);

test('every tf fixture imports to a spec that passes checkSpec, the schema and lint', () => {
  assert.ok(fixtures.length >= 2, fixtures.join(', '));
  const sidecarOf = (f) => { const p = path.join(FIX, f.replace(/\.json$/, '.flows.json')); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
  for (const f of fixtures) for (const [what, o] of [['plain', {}], ['guess', { story: 'guess' }], ...(sidecarOf(f) ? [['sidecar', { flows: sidecarOf(f) }], ...(sidecarOf(f).stories || []).map((s) => [`story ${s.id}`, { flows: sidecarOf(f), story: s.id }])] : [])]) {
    const { spec, report } = imp(f, o);
    const label = `${f} (${what})`;
    assert.doesNotThrow(() => checkSpec(spec), label);
    assert.deepEqual(validateDiagram(spec), [], `${label}: schema`);
    assert.deepEqual(errors(lint(spec)).map((x) => `${x.code} ${x.message}`), [], `${label}: lint`);
    assert.deepEqual(errors(report.issues).map((x) => x.message), [], `${label}: issues`);
    assert.ok(report.tile.fits, `${label}: tile`);
    assert.equal(report.from, 'tf');
    assert.ok(spec.id.startsWith('tf-'), spec.id);
    assert.match(standalone(spec, { theme: 'dark' }), /^<svg xmlns=/);
  }
});

test('Terraform addresses become kit ids', () => {
  assert.equal(tfId('module.vpc.aws_subnet.private[0]'), 'vpc-subnet-private-0');
  assert.equal(tfId('aws_lb.web'), 'lb-web');
  assert.equal(tfId('aws_subnet.az["us-east-1a"]'), 'subnet-az-us-east-1a');
  assert.equal(tfId('module.net[1].module.subnets.aws_route_table.this["a b"]'), 'net-1-subnets-route_table-this-a-b');
  assert.equal(tfId('data.aws_iam_policy_document.x'), 'data-iam_policy_document-x');
  const used = new Set();
  assert.equal(tfId('aws_lb.web', used), 'lb-web');
  assert.equal(tfId('aws_lb.web', used), 'lb-web-2');
  for (const a of ['module.x.aws_instance.y[12]', 'aws_s3_bucket.b["weird/key:1"]', 'module.m["k"].aws_vpc.v']) assert.match(tfId(a), /^[A-Za-z0-9_-]+$/, a);
});

test('a plan with a VPC module and count: placement, subnet kinds from route tables, edges from references', () => {
  const { spec, report } = imp('tf-webapp-plan.json');
  const g = (id) => spec.groups.find((x) => x.id === id), n = (id) => spec.nodes.find((x) => x.id === id);
  assert.equal(report.tf.kind, 'plan');
  assert.deepEqual(report.tf.modules, ['module.vpc']);
  assert.equal(report.tf.region, 'us-east-1');
  assert.equal(spec.groups.find((x) => x.kind === 'region').label, 'us-east-1');
  // count instances in the module: subnets per AZ, with AZ names as notes and positions as labels
  assert.deepEqual(spec.groups.filter((x) => x.kind === 'az').map((x) => [x.label, x.note]), [['Availability Zone 1', 'us-east-1a'], ['Availability Zone 2', 'us-east-1b']]);
  assert.equal(g('vpc-subnet-public-0').kind, 'pub');
  assert.equal(g('vpc-subnet-private-1').kind, 'priv');
  assert.equal(g('vpc-subnet-database-0').label, 'Isolated subnet');
  // count.index pairs the NAT gateway with its subnet, the route with its table
  assert.equal(n('vpc-nat_gateway-this-1').x, n('vpc-nat_gateway-this-0').x);
  assert.ok(report.ledger.some((l) => /^module\.vpc\.aws_subnet\.private\[1\] is a private subnet with egress: route table module\.vpc\.aws_route_table\.private\[1\] sends 0\.0\.0\.0\/0 to the NAT gateway module\.vpc\.aws_nat_gateway\.this\[1\]/.test(l.fact)));
  // an inline route block makes the public subnets public
  assert.ok(report.ledger.some((l) => /^module\.vpc\.aws_subnet\.public\[0\] is a public subnet: route table module\.vpc\.aws_route_table\.public sends 0\.0\.0\.0\/0 to the internet gateway/.test(l.fact)));
  // references through module outputs: the ALB in the public subnets, the ASG in the private ones
  assert.deepEqual(report.resources.find((r) => r.key === 'aws_lb.web').nodes, ['lb-web-az1', 'lb-web-az2']);
  assert.deepEqual(report.resources.find((r) => r.key === 'aws_autoscaling_group.app').frames, ['autoscaling_group-app-az1-asg', 'autoscaling_group-app-az2-asg']);
  assert.equal(wireBy(spec, 'lb-web-az1', 'autoscaling_group-app-az1').label, ':8080');
  assert.equal(wireBy(spec, 'autoscaling_group-app-az2', 'db_instance-db-primary').label, ':5432');
  assert.equal(wireBy(spec, 'Users', 'vpc-internet_gateway-this').label, 'HTTPS :443');
  assert.equal(wireBy(spec, 'autoscaling_group-app-az1', 's3_bucket-assets').label, 's3:GetObject');
  assert.equal(wireBy(spec, 'Route53-example', 'lb-web-az1').label, 'www.example.com');
  assert.ok(n('db_instance-db-standby'), 'multi_az = true draws the standby');
  assert.ok(report.ledger.some((l) => l.kind === 'dropped' && /aws_cloudwatch_metric_alarm\.cpu/.test(l.fact)));
  assert.ok(report.ledger.some((l) => /^Read a Terraform plan \(format 1\.2, Terraform 1\.9\.8\): 43 AWS resource instances in 2 modules/.test(l.fact)));
});

test('the Terraform plan draws the same architecture as the CloudFormation webapp', () => {
  const tf = imp('tf-webapp-plan.json').spec, cfn = fromCloudFormation(read('cfn-webapp.yaml'), { file: 'cfn-webapp' }).spec;
  const shape = (s) => {
    const c = (re) => s.nodes.filter((n) => re.test(n.label)).length;
    return { alb: c(/Application Load Balancer/), nat: c(/NAT gateway/), ec2: c(/EC2 instance/), rds: c(/^RDS (primary|standby)$/), s3: c(/S3 bucket/), az: s.groups.filter((g) => g.kind === 'az').length,
      // one group, whether it draws as one frame across the AZs or (when that would cross header text) one per AZ
      asg: new Set(s.groups.filter((g) => g.kind === 'asg').map((g) => g.id.replace(/-az\d+-asg$/, '-asg'))).size };
  };
  assert.deepEqual(shape(tf), shape(cfn));
});

test('anchors carry one sidecar across Terraform and CloudFormation', () => {
  const tfSide = JSON.parse(read('tf-webapp-plan.flows.json'));
  const tf = imp('tf-webapp-plan.json', { flows: tfSide });
  assert.deepEqual(tf.report.issues.filter((i) => i.code === 'sidecar'), []);
  assert.ok(tf.spec.nodes.some((n) => n.id === 'LoadBalancer-az1') && tf.spec.nodes.some((n) => n.id === 'Database-standby'), 'anchors name the nodes');
  // the CloudFormation webapp's own sidecar, whose refs are logical ids, works on the plan through the anchors
  const cfnSide = JSON.parse(read('cfn-webapp.flows.json'));
  const both = imp('tf-webapp-plan.json', { flows: { ...cfnSide, anchors: tfSide.anchors } });
  const cfn = fromCloudFormation(read('cfn-webapp.yaml'), { file: 'cfn-webapp', flows: cfnSide });
  const legs = (s) => { const w = new Map(s.wires.map((x) => [x.id, x])); return s.timeline.map((t) => [w.get(t.wire).from, w.get(t.wire).to, t.kind || 'pk', !!t.reverse, t.ring, t.t]); };
  assert.deepEqual(legs(both.spec), legs(cfn.spec));
  assert.ok(tf.report.ledger.some((l) => l.via === 'sidecar' && /aws_cloudwatch_metric_alarm\.cpu .* is hidden by the sidecar/.test(l.fact)));
});

test('for_each instances: keys pair the instances with their subnets', () => {
  const R = (address, type, name, index, values) => ({ address, mode: 'managed', type, name, ...(index != null ? { index } : {}), provider_name: 'registry.terraform.io/hashicorp/aws', schema_version: 0, values, sensitive_values: {} });
  const plan = {
    format_version: '1.2',
    planned_values: { root_module: { resources: [
      R('aws_vpc.main', 'aws_vpc', 'main', null, { cidr_block: '10.9.0.0/16' }),
      R('aws_subnet.app["eu-west-1a"]', 'aws_subnet', 'app', 'eu-west-1a', { availability_zone: 'eu-west-1a', cidr_block: '10.9.1.0/24' }),
      R('aws_subnet.app["eu-west-1b"]', 'aws_subnet', 'app', 'eu-west-1b', { availability_zone: 'eu-west-1b', cidr_block: '10.9.2.0/24' }),
      R('aws_instance.web["eu-west-1a"]', 'aws_instance', 'web', 'eu-west-1a', { instance_type: 't3.micro' }),
      R('aws_instance.web["eu-west-1b"]', 'aws_instance', 'web', 'eu-west-1b', { instance_type: 't3.micro' }),
      R('aws_instance.ops', 'aws_instance', 'ops', null, { instance_type: 't3.micro' }),
    ] } },
    configuration: { root_module: { resources: [
      { address: 'aws_vpc.main', mode: 'managed', type: 'aws_vpc', name: 'main', expressions: { cidr_block: { constant_value: '10.9.0.0/16' } } },
      { address: 'aws_subnet.app', mode: 'managed', type: 'aws_subnet', name: 'app', expressions: { vpc_id: { references: ['aws_vpc.main.id', 'aws_vpc.main'] }, availability_zone: { references: ['each.key'] } }, for_each_expression: { references: ['var.azs'] } },
      { address: 'aws_instance.web', mode: 'managed', type: 'aws_instance', name: 'web', expressions: { subnet_id: { references: ['aws_subnet.app', 'each.key'] } }, for_each_expression: { references: ['aws_subnet.app'] } },
      { address: 'aws_instance.ops', mode: 'managed', type: 'aws_instance', name: 'ops', expressions: { subnet_id: { references: ['aws_subnet.app["eu-west-1b"].id', 'aws_subnet.app["eu-west-1b"]', 'aws_subnet.app'] } } },
    ] } },
  };
  const { spec, report } = fromTerraform(plan, { id: 'tf-foreach' });
  assert.equal(errors(report.issues).length, 0);
  const parent = (id) => { const n = spec.nodes.find((x) => x.id === id); return spec.groups.filter((g) => g.kind === 'priv' && n.x >= g.x && n.x <= g.x + g.w && n.y >= g.y && n.y <= g.y + g.h).map((g) => g.id); };
  assert.deepEqual(parent('instance-web-eu-west-1a'), ['subnet-app-eu-west-1a']);
  assert.deepEqual(parent('instance-web-eu-west-1b'), ['subnet-app-eu-west-1b']);
  assert.deepEqual(parent('instance-ops'), ['subnet-app-eu-west-1b'], 'an explicit key names one instance');
  assert.deepEqual(spec.groups.filter((g) => g.kind === 'az').map((g) => g.note), ['eu-west-1a', 'eu-west-1b']);
  assert.ok(report.ledger.some((l) => l.kind === 'assumed' && /aws_subnet\.app\["eu-west-1a"\] is a private subnet: no route table is associated/.test(l.fact)));
  assert.equal(spec.groups.find((g) => g.kind === 'region').label, 'eu-west-1', 'the Region from the AZ names');
});

test('a state without configuration: edges from ids and ARNs that match', () => {
  const { spec, report } = imp('tf-queue-state.json');
  assert.equal(report.tf.kind, 'state');
  assert.ok(report.issues.some((i) => i.code === 'tf-config'));
  assert.equal(wireBy(spec, 'sqs_queue-jobs', 'lambda_function-worker').dashed, true, 'the event source mapping');
  assert.ok(wireBy(spec, 'cloudwatch_event_rule-nightly', 'sqs_queue-jobs'), 'the event target');
  assert.equal(wireBy(spec, 'lambda_function-worker', 'dynamodb_table-results').label, 'dynamodb:PutItem');
  assert.ok(!wireBy(spec, 'lambda_function-worker', 'sqs_queue-jobs'), 'the IAM edge to the queue merges with the event source mapping');
  assert.ok(!spec.groups.some((g) => g.kind === 'vpc'));
});

test('a sidecar on a plan: addresses, anchors and qualifiers', () => {
  const flows = {
    actors: [{ id: 'Users' }],
    anchors: { Web: { tf: 'aws_lb.web' } },
    flows: [{ id: 'get', response: 'reverse', steps: [
      { from: 'Users', to: 'module.vpc.aws_internet_gateway.this', label: 'HTTPS' },
      { from: 'module.vpc.aws_internet_gateway.this', to: 'Web@az1' },
      { from: 'Web@az1', to: 'aws_autoscaling_group.app@az1' },
      { from: 'aws_autoscaling_group.app@az1', to: 'aws_db_instance.db@primary' },
    ] }],
  };
  const { spec, report } = imp('tf-webapp-plan.json', { flows });
  assert.deepEqual(report.issues.filter((i) => i.code === 'sidecar'), []);
  assert.deepEqual(spec.steps.map((s) => s.n), [1, 2, 3, 4]);
  assert.equal(spec.timeline.length, 8);
  assert.ok(spec.nodes.some((n) => n.id === 'Web-az1'), 'the anchor names the node');
});

test('raw HCL and other JSON are refused with a clear message; detection', async () => {
  const hcl = 'terraform {\n  required_providers {\n    aws = { source = "hashicorp/aws" }\n  }\n}\nresource "aws_s3_bucket" "b" {\n  bucket = "x"\n}\n';
  assert.throws(() => fromTerraform(hcl), (e) => e.message === HCL_MESSAGE);
  assert.match(HCL_MESSAGE, /terraform show -json/);
  assert.throws(() => fromTerraform('{"hello": 1}'), /terraform show -json/);
  assert.equal(detectFormat(hcl, 'main.tf'), 'tf');
  assert.equal(detectFormat(hcl), 'tf');
  for (const f of fixtures) assert.equal(detectFormat(read(f), f), 'tf', f);
  await assert.rejects(importDiagram(hcl), /HCL/);
  const r = await importDiagram(read('tf-webapp-plan.json'), { file: 'plan.json' });
  assert.equal(r.report.from, 'tf');
  assert.equal(r.spec.id, 'tf-plan');
});
