// resolve.mjs against the real store: normalisation rules, word boundaries, colorways, CloudFormation and
// Terraform property picks, group vs node, retired icons, the store overlay, coverage, and the CLI.
// Run: node --test catalog/aws-icons/resolve.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveIcon, searchIcons, createResolver, loadStore } from './resolve.mjs';
import { coverage, BASELINE } from './coverage.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const r = (q, o) => resolveIcon(q, o);
const id = (q, o) => r(q, o).id;

test('the six queries awd icons could not answer, and the ecr false hit', () => {
  assert.equal(id('AWS::Lambda::Function'), 'aws-svc-lambda');   // the kit draws Lambda functions with the service icon
  assert.equal(id('AWS::Lambda::Function', { prefer: 'resource' }), 'aws-res-lambda-function');
  assert.equal(id('ElasticLoadBalancingV2'), 'aws-svc-elastic-load-balancing');
  assert.equal(id('quicksight'), 'aws-svc-quick');
  assert.equal(id('elasticsearch'), 'aws-svc-opensearch-service');
  assert.equal(id('dax'), 'aws-res-dynamodb-accelerator');
  assert.equal(id('nacl'), 'aws-res-vpc-network-access-control-list');
  assert.equal(id('ecr'), 'aws-svc-elastic-container-registry');
  assert.ok(!r('ecr').candidates.some((c) => c.id.includes('secrets')));
});

test('words match whole, never as substrings', () => {
  assert.equal(id('ec'), null);   // not "ecs" by plural, not "secrets" by substring
  assert.ok(!searchIcons('ecr').some((h) => h.id.includes('secrets')));
  assert.equal(searchIcons('lamb')[0].id, 'aws-svc-lambda');   // search alone also takes word starts
  assert.equal(id('front'), null);
  assert.equal(id('secret'), 'aws-svc-secrets-manager');
  const s3 = r('Laptop');
  assert.equal(s3.id, null);
  assert.ok(Array.isArray(s3.candidates) && s3.warnings.length);
});

test('normalisation: compact form, brand words, CamelCase', () => {
  assert.equal(id('CloudFront'), 'aws-svc-cloudfront');
  assert.equal(id('Cloud Front'), 'aws-svc-cloudfront');
  assert.equal(id('cloudfront'), 'aws-svc-cloudfront');
  assert.equal(id('Amazon S3'), 'aws-svc-simple-storage-service');
  assert.equal(id('AWS Lambda'), 'aws-svc-lambda');
  assert.equal(id('aws:aws-lambda', { from: 'mermaid' }), 'aws-svc-lambda');
  assert.equal(id('DynamoDBTable', { from: 'plantuml' }), 'aws-res-dynamodb-table');
  assert.equal(id('Route53'), 'aws-svc-route-53');
  assert.equal(id('storage.SimpleStorageServiceS3Bucket', { from: 'diagrams' }), 'aws-res-simple-storage-service-bucket');   // initialism dropped
});

test('normalisation: trailing digits, versions, repeated prefixes, Resource suffix, plurals', () => {
  assert.equal(id('resIcon=mxgraph.aws4.cloudwatch_2'), 'aws-svc-cloudwatch');
  assert.equal(id('aws:kinesis-video-streams2'), 'aws-svc-kinesis-video-streams');
  assert.equal(id('mxgraph.aws4.stack2'), 'aws-res-cloudformation-stack');
  assert.equal(id('ElasticLoadBalancingV2'), 'aws-svc-elastic-load-balancing');
  assert.equal(id('LambdaLambdaFunction', { from: 'plantuml' }), 'aws-res-lambda-function');
  assert.equal(id('aws:emr-emr-engine'), 'aws-res-emr-engine');
  assert.equal(id('EC2AutoScalingResource', { from: 'plantuml' }), 'aws-res-ec2-auto-scaling');
  assert.equal(id('EC2AutoScaling', { from: 'plantuml' }), 'aws-svc-ec2-auto-scaling');
  assert.equal(id('mxgraph.aws4.glue_crawlers'), 'aws-res-glue-crawler');
});

test('normalisation: _alt is the alternate colorway, including the package typo id', () => {
  assert.equal(id('mxgraph.aws4.rds_mysql_instance_alt'), 'aws-res-aurora-mysql-instance-alternate');
  assert.equal(id('mxgraph.aws4.rds_instance_alt'), 'aws-res-aurora-rds-instance-aternate');
  assert.equal(id('aurora rds instance alternate'), 'aws-res-aurora-rds-instance-aternate');
  assert.equal(id('aws-res-aurora-rds-instance-aternate'), 'aws-res-aurora-rds-instance-aternate');
});

test('colorway pairs collapse to the base id the kit swaps per theme', () => {
  assert.equal(id('aws-res-users-dark'), 'aws-res-users');
  assert.equal(id('aws-res-users-light'), 'aws-res-users');
  assert.equal(r('aws-res-users-dark').how, 'id+colorway');
  assert.equal(id('Users'), 'aws-res-users');
  assert.equal(id('mxgraph.aws4.users'), 'aws-res-users');
  assert.equal(id('mxgraph.aws4.redshift_query_editor_v20_light'), 'aws-res-redshift-query-editor-v2-0');
  assert.equal(id('AWS Marketplace'), 'aws-svc-marketplace');
  for (const h of searchIcons('users')) assert.ok(!/-(dark|light)$/.test(h.id), h.id);
});

test('draw.io: resIcon tiles are services, bare shapes are resources, styles carry properties', () => {
  assert.equal(id('shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#ED7100'), 'aws-svc-lambda');
  assert.equal(id('sketch=0;shape=mxgraph.aws4.lambda_function;fillColor=#ED7100'), 'aws-res-lambda-function');
  assert.equal(id('mxgraph.aws4.internet_gateway'), 'aws-res-vpc-internet-gateway');
  assert.equal(id('resIcon=mxgraph.aws4.elasticsearch_service'), 'aws-svc-opensearch-service');
  assert.equal(id('mxgraph.aws4.s3_on_outposts'), 'aws-res-simple-storage-service-s3-on-outposts');
  const pub = r('shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_security_group;grStroke=0;strokeColor=#7AA116');
  assert.deepEqual([pub.kind, pub.group], ['group', 'pub']);
  assert.equal(r('grIcon=mxgraph.aws4.group_security_group;strokeColor=#00A4A6').group, 'priv');
  assert.equal(r('grIcon=mxgraph.aws4.group_vpc2').group, 'vpc');
});

test('CloudFormation property picks: ELBv2 Type, RDS Engine and MultiAZ, ElastiCache Engine, FSx type', () => {
  const lb = r('AWS::ElasticLoadBalancingV2::LoadBalancer', { props: { Type: 'network' } });
  assert.equal(lb.id, 'aws-res-elastic-load-balancing-network-load-balancer');
  assert.equal(lb.confidence, 1);
  assert.equal(id('AWS::ElasticLoadBalancingV2::LoadBalancer', { props: { type: 'gateway' } }), 'aws-res-elastic-load-balancing-gateway-load-balancer');
  const def = r('AWS::ElasticLoadBalancingV2::LoadBalancer');
  assert.equal(def.id, 'aws-res-elastic-load-balancing-application-load-balancer');
  assert.ok(def.confidence < 1 && def.warnings.some((w) => /pass Type/.test(w)));
  const pg = r('AWS::RDS::DBInstance', { props: { Engine: 'postgres', MultiAZ: true } });
  assert.equal(pg.id, 'aws-res-aurora-postgresql-instance');
  assert.equal(pg.standby, 'aws-res-aurora-postgresql-instance-alternate');
  assert.equal(r('AWS::RDS::DBInstance', { props: { Engine: 'mysql', MultiAZ: 'false' } }).standby, undefined);
  assert.equal(id('AWS::RDS::DBInstance', { props: { Engine: 'sqlserver-ee' } }), 'aws-res-aurora-sql-server-instance');
  assert.equal(id('AWS::RDS::DBInstance', { props: { Engine: 'aurora-postgresql' } }), 'aws-res-aurora-postgresql-instance');
  assert.equal(r('AWS::RDS::DBInstance', { props: { MultiAZ: true } }).standby, 'aws-res-aurora-rds-instance-aternate');
  assert.ok(r('AWS::RDS::DBInstance', { props: { MultiAZ: { 'Fn::If': ['IsProd', true, false] } } }).warnings.some((w) => /not a literal/.test(w)));
  assert.equal(id('AWS::RDS::DBCluster', { props: { Engine: 'aurora-mysql' } }), 'aws-svc-aurora');
  assert.equal(id('AWS::RDS::DBCluster', { props: { Engine: 'postgres' } }), 'aws-res-rds-multi-az-db-cluster');
  assert.equal(id('AWS::ElastiCache::ReplicationGroup', { props: { Engine: 'valkey' } }), 'aws-res-elasticache-for-valkey');
  assert.equal(id('AWS::ElastiCache::CacheCluster', { props: { Engine: 'memcached' } }), 'aws-res-elasticache-for-memcached');
  assert.equal(id('AWS::FSx::FileSystem', { props: { FileSystemType: 'ONTAP' } }), 'aws-svc-fsx-for-netapp-ontap');
  assert.equal(id('AWS::FSx::FileSystem', { props: { FileSystemType: 'WINDOWS' } }), 'aws-svc-fsx-for-wfs');
});

test('Terraform types and property picks', () => {
  assert.equal(id('aws_lb', { props: { load_balancer_type: 'network' } }), 'aws-res-elastic-load-balancing-network-load-balancer');
  const db = r('aws_db_instance', { props: { engine: 'mysql', multi_az: true } });
  assert.deepEqual([db.id, db.standby], ['aws-res-aurora-mysql-instance', 'aws-res-aurora-mysql-instance-alternate']);
  assert.equal(id('aws_instance'), 'aws-res-ec2-instance');
  assert.equal(id('aws_cloudwatch_event_rule'), 'aws-res-eventbridge-rule');
  assert.equal(id('aws_fsx_lustre_file_system'), 'aws-svc-fsx-for-lustre');
  assert.equal(r('aws_vpc').group, 'vpc');
  const guess = r('aws_wafv2_ip_set');   // not in the table: matched by name, warned
  assert.equal(guess.id, 'aws-svc-waf');
  assert.ok(guess.confidence < 0.7 && guess.warnings.some((w) => /not in the Terraform table/.test(w)));
});

test('CloudFormation roles: edges, folded types, shut-down services', () => {
  const route = r('AWS::EC2::Route');
  assert.equal(route.id, null);
  assert.equal(route.role, 'edge');
  assert.equal(r('AWS::ElasticLoadBalancingV2::TargetGroup').role, 'attr');
  assert.equal(r('AWS::CDK::Metadata').role, 'meta');
  const qldb = r('AWS::QLDB::Ledger');
  assert.equal(qldb.id, null);
  assert.ok(qldb.warnings.some((w) => /QLDB shut down/.test(w)));
  assert.equal(r('AWS::Foo::Bar').id, null);
  const url = r('AWS::Lambda::Url');
  assert.equal(url.role, 'attr');
});

test('group vs node: containers return the awd group kind', () => {
  const kind = (q, o) => { const x = r(q, o); return x.kind === 'group' ? `group:${x.group}` : x.id; };
  assert.equal(kind('Security Group'), 'group:sg');
  assert.equal(r('Security Group').id, null);   // the sg frame has no icon
  assert.equal(kind('Availability Zone'), 'group:az');
  assert.equal(kind('us-east-1a'), 'group:az');
  assert.equal(kind('VPC'), 'group:vpc');
  assert.equal(r('VPC').id, 'aws-grp-virtual-private-cloud-vpc');
  assert.equal(kind('Prod VPC (10.0.0.0/16)'), 'group:vpc');
  assert.equal(kind('VPC endpoint'), 'aws-res-vpc-endpoints');
  assert.equal(kind('VPC Lattice'), 'aws-svc-vpc-lattice');
  assert.equal(kind('Public subnet'), 'group:pub');
  assert.equal(kind('Private subnet 10.0.3.0/24'), 'group:priv');
  assert.equal(kind('Web subnet (public)'), 'group:pub');
  assert.ok(r('Subnet A').warnings.some((w) => /public or private/.test(w)));
  assert.equal(kind('Region'), 'group:region');
  assert.equal(kind('us-east-1'), 'group:region');
  assert.equal(kind('Auto Scaling group'), 'group:asg');
  assert.equal(kind('Auto Scaling'), 'aws-svc-auto-scaling');
  assert.equal(kind('AWS account'), 'group:acct');
  assert.equal(kind('Organizations account'), 'aws-res-organizations-account');
  assert.equal(kind('Corporate data center'), 'group:dc');
  assert.equal(kind('AWS Cloud'), 'group:cloud');
  assert.equal(kind('CloudFront'), 'aws-svc-cloudfront');   // "Cloud" inside a brand word is not a frame
  assert.equal(kind('AWS::EC2::VPC'), 'group:vpc');
  assert.equal(kind('AWS::EC2::SecurityGroup'), 'group:sg');
  assert.equal(kind('AWS::AutoScaling::AutoScalingGroup'), 'group:asg');
  assert.equal(kind('AWS::EC2::Subnet', { props: { MapPublicIpOnLaunch: true } }), 'group:pub');
  const ecs = r('AWS::ECS::Cluster');
  assert.deepEqual([ecs.kind, ecs.group, ecs.id], ['group', 'gen', 'aws-svc-elastic-container-service']);
  assert.equal(kind('VPCGroup', { from: 'plantuml' }), 'group:vpc');
  assert.equal(kind('AvailabilityZoneGroup', { from: 'plantuml' }), 'group:az');
});

test('prefer overrides the defaults', () => {
  assert.equal(id('VPC', { prefer: 'node' }), 'aws-svc-virtual-private-cloud');
  assert.equal(id('Auto Scaling group', { prefer: 'node' }), 'aws-svc-ec2-auto-scaling');
  assert.equal(r('EKS cluster', { prefer: 'group' }).group, 'gen');
  assert.equal(r('EKS cluster', { prefer: 'group' }).id, 'aws-svc-elastic-kubernetes-service');
  assert.equal(r('Web tier', { prefer: 'group' }).group, 'gen');
  assert.equal(r('On-premises', { prefer: 'group' }).group, 'dc');
  assert.equal(id('S3 bucket'), 'aws-res-simple-storage-service-bucket');
  assert.equal(id('S3 bucket', { prefer: 'service' }), 'aws-svc-simple-storage-service');
  assert.equal(id('Lambda function'), 'aws-svc-lambda');
  assert.equal(id('Lambda function', { prefer: 'resource' }), 'aws-res-lambda-function');
  assert.equal(id('Lambda', { prefer: 'resource' }), 'aws-res-lambda-function');
  assert.equal(id('AWS::SQS::Queue'), 'aws-svc-simple-queue-service');
  assert.equal(id('AWS::SQS::Queue', { prefer: 'resource' }), 'aws-res-simple-queue-service-queue');
  assert.equal(id('AWS::S3::Bucket'), 'aws-res-simple-storage-service-bucket');
  assert.equal(id('compute.LambdaFunction', { from: 'diagrams' }), 'aws-res-lambda-function');   // explicit icon names keep the resource
});

test('a service plus a word with no icon of its own falls back to the service icon', () => {
  const eks = r('EKS cluster');
  assert.equal(eks.id, 'aws-svc-elastic-kubernetes-service');
  assert.ok(eks.warnings.some((w) => /cluster/.test(w)));
  assert.equal(id('Cognito user pool'), 'aws-svc-cognito');
  assert.equal(id('KMS key'), 'aws-svc-key-management-service');
  assert.equal(id('ECS service'), 'aws-res-elastic-container-service-service');
  assert.equal(id('ElastiCache Redis'), 'aws-res-elasticache-for-redis');
  assert.equal(id('ECS Fargate'), 'aws-svc-fargate');
  assert.equal(id('EMR on EKS'), 'aws-svc-emr');
});

test('retired, end-of-support, renamed and duplicate icons resolve with a warning', () => {
  const wd = r('WorkDocs');
  assert.deepEqual([wd.id, wd.status], ['aws-svc-workdocs', 'retired']);
  assert.ok(wd.warnings.some((w) => /shut down on 2025-04-25/.test(w)));
  const mesh = r('App Mesh');
  assert.equal(mesh.status, 'end-of-support');
  assert.ok(mesh.warnings.some((w) => /2026-09-30/.test(w)));
  assert.ok(r('aws-res-app-mesh-virtual-node').warnings.length);
  assert.ok(r('Pinpoint').warnings.some((w) => /2026-10-30/.test(w)));
  for (const q of ['MediaStore', 'IoT Events', 'AWS IQ', 'Panorama', 'FinSpace', 'Lookout for Vision', 'SimSpace Weaver', 'aws-res-cloudwatch-evidently', 'aws-res-iot-device-management-fleet-hub', 'aws-res-datasync-discovery']) {
    assert.equal(r(q).status, 'retired', q);
  }
  assert.ok(r('CodeWhisperer').warnings.some((w) => /draw aws-svc-q/.test(w)));
  assert.equal(id('Amazon Kinesis Video Streams'), 'aws-svc-kinesis-video-streams');
  assert.equal(id('Compute Optimizer'), 'aws-svc-compute-optimizer');
  assert.ok(r('aws-svc-aws-compute-optimizer').warnings.some((w) => /duplicates aws-svc-compute-optimizer/.test(w)));
  assert.equal(r('Lambda').status, undefined);
  assert.equal(r('Lambda').warnings.length, 0);
});

test('Route 53 Resolver carries its current name', () => {
  const s = loadStore();
  assert.equal(s.icons['aws-res-route-53-resolver'].short, 'Route 53 VPC Resolver');
  assert.equal(id('Route 53 VPC Resolver'), 'aws-res-route-53-resolver');
  assert.equal(id('Resolver inbound endpoint'), 'aws-res-route-53-resolver');
  assert.equal(id('AWS::Route53Resolver::ResolverEndpoint'), 'aws-res-route-53-resolver');
});

test('the store: ids and artwork as AWS ships them, overlay fields regenerable', () => {
  const s = loadStore();
  assert.equal(s.count, Object.keys(s.icons).length);
  const sprite = fs.readFileSync(path.join(HERE, 'aws-icons.svg'), 'utf8');
  const spriteIds = [...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(spriteIds, Object.keys(s.icons));   // the sprite (artwork) and the store list the same ids
  for (const [k, ic] of Object.entries(s.icons)) assert.ok(sprite.includes(`<symbol id="${k}" viewBox="${ic.viewBox}">${ic.svg}</symbol>`), k);
  assert.ok(s.icons['aws-res-aurora-rds-instance-aternate'], 'the package typo id stays');
  assert.equal(s.icons['aws-svc-aws-compute-optimizer'].duplicateOf, 'aws-svc-compute-optimizer');
  assert.ok(s.icons['aws-res-users-dark'].xref.drawio.includes('users'));   // both artworks of a pair carry the metadata
  assert.ok(s.icons['aws-res-lambda-function'].xref.cfn.includes('AWS::Lambda::Function'));
  assert.ok(s.rules.cfn['AWS::RDS::DBInstance'].by === 'Engine');
  // overlay-only is idempotent: running it again changes nothing
  const before = fs.readFileSync(path.join(HERE, 'aws-icons.json'), 'utf8');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-resolve-test-'));
  try {
    for (const f of ['build_icons.mjs', 'overlay.mjs', 'aws-icons.json']) fs.copyFileSync(path.join(HERE, f), path.join(tmp, f));
    const p = spawnSync(process.execPath, [path.join(tmp, 'build_icons.mjs'), '--overlay-only'], { encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    assert.equal(fs.readFileSync(path.join(tmp, 'aws-icons.json'), 'utf8'), before);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('degrades on a bare store: no xref, no rules, sprite-style metadata only', () => {
  const R = createResolver({ icons: new Map([
    ['aws-svc-lambda', { name: 'AWS Lambda', kind: 'service', category: 'Compute' }],
    ['aws-res-lambda-function', { name: 'Lambda Function', kind: 'resource', service: 'AWS Lambda', category: 'Compute' }],
    ['aws-res-users-dark', { name: 'Users', kind: 'resource', category: 'General Icons' }],
    ['aws-res-users-light', { name: 'Users', kind: 'resource', category: 'General Icons' }],
  ]) });
  assert.equal(R.resolve('Lambda').id, 'aws-svc-lambda');
  assert.equal(R.resolve('LambdaLambdaFunction', { from: 'plantuml' }).id, 'aws-res-lambda-function');
  assert.equal(R.resolve('aws-res-users-light').id, 'aws-res-users');
  assert.equal(R.resolve('AWS::Lambda::Function').id, 'aws-res-lambda-function');   // no table and no policy: matched by name, warned
  assert.ok(R.resolve('AWS::Lambda::Function').warnings.length);
  assert.equal(R.resolve('Security Group').group, 'sg');
});

test('coverage meets or beats the interop evaluators on their inputs', () => {
  const c = coverage();
  for (const [k, n] of Object.entries(BASELINE)) assert.ok(c[k].resolved >= n, `${k}: ${c[k].resolved} < ${n}`);
  for (const k of ['drawioTiles', 'drawioShapes', 'diagrams', 'mermaid', 'plantuml', 'labels', 'kitLabels', 'clusterLabels']) {
    assert.equal(c[k].agree, c[k].n, `${k}: ${c[k].rows.filter((x) => !x.agree).map((x) => x.name).join(', ')}`);
  }
  assert.equal(c.cfn.agree + c.cfn.policy, c.cfn.n);
});

test('CLI prints the pick, its properties and warnings', () => {
  const run = (...a) => spawnSync(process.execPath, [path.join(HERE, 'resolve.mjs'), ...a], { encoding: 'utf8' });
  const lb = run('AWS::ElasticLoadBalancingV2::LoadBalancer', '--from', 'cfn', '--prop', 'Type=network');
  assert.equal(lb.status, 0);
  assert.match(lb.stdout, /aws-res-elastic-load-balancing-network-load-balancer\s+node/);
  const js = JSON.parse(run('Security Group', '--json').stdout);
  assert.deepEqual([js.kind, js.group], ['group', 'sg']);
  const none = run('Laptop');
  assert.equal(none.status, 1);
  assert.match(none.stdout, /no icon/);
  assert.equal(run().status, 2);
});
