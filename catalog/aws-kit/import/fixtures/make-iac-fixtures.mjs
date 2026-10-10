// make-iac-fixtures.mjs: writes the generated IaC fixtures (k33bz fork). No deps.
//   cfn-cdk-fargate.json   a cdk synth-style template: hashed logical ids, aws:cdk:path metadata, helper
//                          custom resources, one NAT gateway for two AZs, a Fargate service behind an ALB
//   tf-webapp-plan.json    terraform show -json of a plan: a VPC module with count, inline routes, module
//                          outputs, count.index pairing, the CloudFormation webapp's architecture
//   tf-queue-state.json    terraform show -json of a state: values only, edges from matching ids and ARNs
//   tf-webapp-dualstack-plan.json  a dual-stack plan: IPv6 VPC and subnet blocks, an egress-only internet
//                          gateway, inline and separate security group rules (IPv6 ::/0, a group reference,
//                          a managed prefix list), the CloudFormation dual-stack webapp's architecture
// The CloudFormation YAML/JSON fixtures and the sidecars are written by hand.
//   node catalog/aws-kit/import/fixtures/make-iac-fixtures.mjs [outdir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = process.argv[2] || path.dirname(fileURLToPath(import.meta.url));
{
  const S = 'OrdersStack';
  const R = {};
  const md = (p) => ({ 'aws:cdk:path': `${S}/${p}` });
  const ref = (x) => ({ Ref: x });
  const ga = (x, a) => ({ 'Fn::GetAtt': [x, a] });
  const az = (i) => ({ 'Fn::Select': [i, { 'Fn::GetAZs': '' }] });
  const tags = (kv) => Object.entries(kv).map(([Key, Value]) => ({ Key, Value }));
  const VPC = 'ServiceVpc6F2A0B39';
  R[VPC] = { Type: 'AWS::EC2::VPC', Properties: { CidrBlock: '10.20.0.0/16', EnableDnsHostnames: true, EnableDnsSupport: true, InstanceTenancy: 'default', Tags: tags({ Name: `${S}/ServiceVpc` }) }, Metadata: md('ServiceVpc/Resource') };
  const IGW = 'ServiceVpcIGW9F1D4A62', VPCGW = 'ServiceVpcVPCGWB7A3C1E5';
  R[IGW] = { Type: 'AWS::EC2::InternetGateway', Properties: { Tags: tags({ Name: `${S}/ServiceVpc` }) }, Metadata: md('ServiceVpc/IGW') };
  R[VPCGW] = { Type: 'AWS::EC2::VPCGatewayAttachment', Properties: { InternetGatewayId: ref(IGW), VpcId: ref(VPC) }, Metadata: md('ServiceVpc/VPCGW') };
  const H = ['A1B2C3D4', 'E5F60718', '293A4B5C', '6D7E8F90', 'ABCDEF12', '34567890'];
  const sub = {};
  for (const [kind, cidr0] of [['Public', 0], ['Private', 2]]) for (const n of [1, 2]) {
    const base = `ServiceVpc${kind}Subnet${n}`;
    const id = `${base}Subnet${H[(n + cidr0) % 6]}`;
    sub[`${kind}${n}`] = id;
    R[id] = { Type: 'AWS::EC2::Subnet', Properties: { AvailabilityZone: az(n - 1), CidrBlock: `10.20.${(cidr0 + n - 1) * 64}.0/18`, MapPublicIpOnLaunch: kind === 'Public', Tags: tags({ 'aws-cdk:subnet-name': kind, 'aws-cdk:subnet-type': kind, Name: `${S}/ServiceVpc/${kind}Subnet${n}` }), VpcId: ref(VPC) }, Metadata: md(`ServiceVpc/${kind}Subnet${n}/Subnet`) };
    const rt = `${base}RouteTable${H[(n + 1) % 6]}`, assoc = `${base}RouteTableAssociation${H[(n + 2) % 6]}`, dr = `${base}DefaultRoute${H[(n + 3) % 6]}`;
    R[rt] = { Type: 'AWS::EC2::RouteTable', Properties: { Tags: tags({ Name: `${S}/ServiceVpc/${kind}Subnet${n}` }), VpcId: ref(VPC) }, Metadata: md(`ServiceVpc/${kind}Subnet${n}/RouteTable`) };
    R[assoc] = { Type: 'AWS::EC2::SubnetRouteTableAssociation', Properties: { RouteTableId: ref(rt), SubnetId: ref(id) }, Metadata: md(`ServiceVpc/${kind}Subnet${n}/RouteTableAssociation`) };
    sub[`${kind}${n}rt`] = rt; sub[`${kind}${n}dr`] = dr;
}
  // one NAT gateway (natGateways: 1) in public subnet 1; both private subnets route to it
  const EIP = 'ServiceVpcPublicSubnet1EIP4C5D6E7F', NAT = 'ServiceVpcPublicSubnet1NATGateway8A9B0C1D';
  R[EIP] = { Type: 'AWS::EC2::EIP', Properties: { Domain: 'vpc', Tags: tags({ Name: `${S}/ServiceVpc/PublicSubnet1` }) }, Metadata: md('ServiceVpc/PublicSubnet1/EIP') };
  R[NAT] = { Type: 'AWS::EC2::NatGateway', Properties: { AllocationId: ga(EIP, 'AllocationId'), SubnetId: ref(sub.Public1), Tags: tags({ Name: `${S}/ServiceVpc/PublicSubnet1` }) }, DependsOn: [sub.Public1dr, sub.Public1rt], Metadata: md('ServiceVpc/PublicSubnet1/NATGateway') };
  for (const n of [1, 2]) {
    R[sub[`Public${n}dr`]] = { Type: 'AWS::EC2::Route', Properties: { DestinationCidrBlock: '0.0.0.0/0', GatewayId: ref(IGW), RouteTableId: ref(sub[`Public${n}rt`]) }, DependsOn: [VPCGW], Metadata: md(`ServiceVpc/PublicSubnet${n}/DefaultRoute`) };
    R[sub[`Private${n}dr`]] = { Type: 'AWS::EC2::Route', Properties: { DestinationCidrBlock: '0.0.0.0/0', NatGatewayId: ref(NAT), RouteTableId: ref(sub[`Private${n}rt`]) }, Metadata: md(`ServiceVpc/PrivateSubnet${n}/DefaultRoute`) };
}
  // CDK's restrict-default-SG custom resource and its provider
  const RDSG = 'ServiceVpcRestrictDefaultSecurityGroupCustomResource1A2B3C4D', RDSGH = 'CustomVpcRestrictDefaultSGCustomResourceProviderHandlerDC833E5E', RDSGR = 'CustomVpcRestrictDefaultSGCustomResourceProviderRole26592FE0';
  R[RDSG] = { Type: 'Custom::VpcRestrictDefaultSG', Properties: { ServiceToken: ga(RDSGH, 'Arn'), DefaultSecurityGroupId: ga(VPC, 'DefaultSecurityGroup'), Account: ref('AWS::AccountId') }, UpdateReplacePolicy: 'Delete', DeletionPolicy: 'Delete', Metadata: md('ServiceVpc/RestrictDefaultSecurityGroupCustomResource/Default') };
  R[RDSGR] = { Type: 'AWS::IAM::Role', Properties: { AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Action: 'sts:AssumeRole', Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' } }] }, ManagedPolicyArns: [{ 'Fn::Sub': 'arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole' }], Policies: [{ PolicyName: 'Inline', PolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['ec2:AuthorizeSecurityGroupIngress', 'ec2:AuthorizeSecurityGroupEgress', 'ec2:RevokeSecurityGroupIngress', 'ec2:RevokeSecurityGroupEgress'], Resource: [{ 'Fn::Join': ['', ['arn:', ref('AWS::Partition'), ':ec2:', ref('AWS::Region'), ':', ref('AWS::AccountId'), ':security-group/', ga(VPC, 'DefaultSecurityGroup')]] }] }] } }] }, Metadata: md('Custom::VpcRestrictDefaultSGCustomResourceProvider/Role') };
  R[RDSGH] = { Type: 'AWS::Lambda::Function', Properties: { Code: { S3Bucket: { 'Fn::Sub': 'cdk-hnb659fds-assets-${AWS::AccountId}-${AWS::Region}' }, S3Key: 'example-rds-handler-asset.zip' }, Timeout: 900, MemorySize: 128, Handler: '__entrypoint__.handler', Role: ga(RDSGR, 'Arn'), Runtime: 'nodejs22.x', Description: 'Lambda function for removing all inbound/outbound rules from the VPC default security group' }, DependsOn: [RDSGR], Metadata: md('Custom::VpcRestrictDefaultSGCustomResourceProvider/Handler') };
  // ECS cluster and the ApplicationLoadBalancedFargateService pattern
  const CL = 'ClusterEB0386A7';
  R[CL] = { Type: 'AWS::ECS::Cluster', Metadata: md('Cluster/Resource') };
  const LBSG = 'ApiServiceLBSecurityGroup5C2C8E1A', LB = 'ApiServiceLB4B1D0C9E', LIS = 'ApiServiceLBPublicListener8E2F7A3B', TG = 'ApiServiceLBPublicListenerECSGroup9C3D4E5F';
  const SVCSG = 'ApiServiceSecurityGroup2D4E6F80', SVC = 'ApiService6B8C9D7E';
  R[LBSG] = { Type: 'AWS::EC2::SecurityGroup', Properties: { GroupDescription: 'Automatically created Security Group for ELB OrdersStackApiServiceLB', SecurityGroupIngress: [{ CidrIp: '0.0.0.0/0', Description: 'Allow from anyone on port 80', FromPort: 80, IpProtocol: 'tcp', ToPort: 80 }], VpcId: ref(VPC) }, Metadata: md('ApiService/LB/SecurityGroup/Resource') };
  R['ApiServiceLBSecurityGrouptoOrdersStackApiServiceSecurityGroup7A8B9C0D80'] = { Type: 'AWS::EC2::SecurityGroupEgress', Properties: { Description: 'Load balancer to target', DestinationSecurityGroupId: ga(SVCSG, 'GroupId'), FromPort: 80, GroupId: ga(LBSG, 'GroupId'), IpProtocol: 'tcp', ToPort: 80 }, Metadata: md('ApiService/LB/SecurityGroup/to OrdersStackApiServiceSecurityGroup7A8B9C0D:80') };
  R[LB] = { Type: 'AWS::ElasticLoadBalancingV2::LoadBalancer', Properties: { LoadBalancerAttributes: [{ Key: 'deletion_protection.enabled', Value: 'false' }], Scheme: 'internet-facing', SecurityGroups: [ga(LBSG, 'GroupId')], Subnets: [ref(sub.Public1), ref(sub.Public2)], Type: 'application' }, DependsOn: [sub.Public1dr, sub.Public2dr], Metadata: md('ApiService/LB/Resource') };
  R[TG] = { Type: 'AWS::ElasticLoadBalancingV2::TargetGroup', Properties: { Port: 80, Protocol: 'HTTP', TargetGroupAttributes: [{ Key: 'stickiness.enabled', Value: 'false' }], TargetType: 'ip', VpcId: ref(VPC) }, Metadata: md('ApiService/LB/PublicListener/ECSGroup/Resource') };
  R[LIS] = { Type: 'AWS::ElasticLoadBalancingV2::Listener', Properties: { DefaultActions: [{ TargetGroupArn: ref(TG), Type: 'forward' }], LoadBalancerArn: ref(LB), Port: 80, Protocol: 'HTTP' }, Metadata: md('ApiService/LB/PublicListener/Resource') };
  const TR = 'ApiServiceTaskDefTaskRole1F2E3D4C', TRP = 'ApiServiceTaskDefTaskRoleDefaultPolicy5B6A7C8D', ER = 'ApiServiceTaskDefExecutionRole9E8D7C6B', ERP = 'ApiServiceTaskDefExecutionRoleDefaultPolicy3A2B1C0D', TD = 'ApiServiceTaskDef4F5E6D7C', LG = 'ApiServiceTaskDefwebLogGroup8B9A0C1D';
  const TABLE = 'OrdersTable315BB997', BUCKET = 'AssetsBucket5CB76180';
  R[TR] = { Type: 'AWS::IAM::Role', Properties: { AssumeRolePolicyDocument: { Statement: [{ Action: 'sts:AssumeRole', Effect: 'Allow', Principal: { Service: 'ecs-tasks.amazonaws.com' } }], Version: '2012-10-17' } }, Metadata: md('ApiService/TaskDef/TaskRole/Resource') };
  R[TRP] = { Type: 'AWS::IAM::Policy', Properties: { PolicyDocument: { Statement: [
    { Action: ['dynamodb:BatchGetItem', 'dynamodb:BatchWriteItem', 'dynamodb:ConditionCheckItem', 'dynamodb:DeleteItem', 'dynamodb:DescribeTable', 'dynamodb:GetItem', 'dynamodb:GetRecords', 'dynamodb:GetShardIterator', 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:UpdateItem'], Effect: 'Allow', Resource: [ga(TABLE, 'Arn'), ref('AWS::NoValue')] },
    { Action: ['s3:GetBucket*', 's3:GetObject*', 's3:List*'], Effect: 'Allow', Resource: [ga(BUCKET, 'Arn'), { 'Fn::Join': ['', [ga(BUCKET, 'Arn'), '/*']] }] },
  ], Version: '2012-10-17' }, PolicyName: 'ApiServiceTaskDefTaskRoleDefaultPolicy5B6A7C8D', Roles: [ref(TR)] }, Metadata: md('ApiService/TaskDef/TaskRole/DefaultPolicy/Resource') };
  R[LG] = { Type: 'AWS::Logs::LogGroup', UpdateReplacePolicy: 'Retain', DeletionPolicy: 'Retain', Metadata: md('ApiService/TaskDef/web/LogGroup/Resource') };
  R[ER] = { Type: 'AWS::IAM::Role', Properties: { AssumeRolePolicyDocument: { Statement: [{ Action: 'sts:AssumeRole', Effect: 'Allow', Principal: { Service: 'ecs-tasks.amazonaws.com' } }], Version: '2012-10-17' } }, Metadata: md('ApiService/TaskDef/ExecutionRole/Resource') };
  R[ERP] = { Type: 'AWS::IAM::Policy', Properties: { PolicyDocument: { Statement: [{ Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Effect: 'Allow', Resource: ga(LG, 'Arn') }], Version: '2012-10-17' }, PolicyName: 'ApiServiceTaskDefExecutionRoleDefaultPolicy3A2B1C0D', Roles: [ref(ER)] }, Metadata: md('ApiService/TaskDef/ExecutionRole/DefaultPolicy/Resource') };
  R[TD] = { Type: 'AWS::ECS::TaskDefinition', Properties: { ContainerDefinitions: [{ Essential: true, Image: 'public.ecr.aws/acme/orders-api:1.4.2', LogConfiguration: { LogDriver: 'awslogs', Options: { 'awslogs-group': ref(LG), 'awslogs-stream-prefix': 'ApiService', 'awslogs-region': ref('AWS::Region') } }, Name: 'web', PortMappings: [{ ContainerPort: 80, Protocol: 'tcp' }], Environment: [{ Name: 'TABLE', Value: ref(TABLE) }, { Name: 'BUCKET', Value: ref(BUCKET) }] }], Cpu: '512', ExecutionRoleArn: ga(ER, 'Arn'), Family: 'OrdersStackApiServiceTaskDef', Memory: '1024', NetworkMode: 'awsvpc', RequiresCompatibilities: ['FARGATE'], TaskRoleArn: ga(TR, 'Arn') }, Metadata: md('ApiService/TaskDef/Resource') };
  R[SVC] = { Type: 'AWS::ECS::Service', Properties: { Cluster: ref(CL), DeploymentConfiguration: { MaximumPercent: 200, MinimumHealthyPercent: 50 }, DesiredCount: 2, EnableECSManagedTags: false, HealthCheckGracePeriodSeconds: 60, LaunchType: 'FARGATE', LoadBalancers: [{ ContainerName: 'web', ContainerPort: 80, TargetGroupArn: ref(TG) }], NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: 'DISABLED', SecurityGroups: [ga(SVCSG, 'GroupId')], Subnets: [ref(sub.Private1), ref(sub.Private2)] } }, TaskDefinition: ref(TD) }, DependsOn: [LIS, TR], Metadata: md('ApiService/Service/Service') };
  R[SVCSG] = { Type: 'AWS::EC2::SecurityGroup', Properties: { GroupDescription: 'OrdersStack/ApiService/Service/SecurityGroup', SecurityGroupEgress: [{ CidrIp: '0.0.0.0/0', Description: 'Allow all outbound traffic by default', IpProtocol: '-1' }], VpcId: ref(VPC) }, Metadata: md('ApiService/Service/SecurityGroup/Resource') };
  R['ApiServiceSecurityGroupfromOrdersStackApiServiceLBSecurityGroup1E2F3A4B807C8D9E0F'] = { Type: 'AWS::EC2::SecurityGroupIngress', Properties: { Description: 'Load balancer to target', FromPort: 80, GroupId: ga(SVCSG, 'GroupId'), IpProtocol: 'tcp', SourceSecurityGroupId: ga(LBSG, 'GroupId'), ToPort: 80 }, Metadata: md('ApiService/Service/SecurityGroup/from OrdersStackApiServiceLBSecurityGroup1E2F3A4B:80') };
  // data: a DynamoDB table and a bucket with autoDeleteObjects (a custom resource and its provider)
  R[TABLE] = { Type: 'AWS::DynamoDB::Table', Properties: { AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }], BillingMode: 'PAY_PER_REQUEST', KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }] }, UpdateReplacePolicy: 'Retain', DeletionPolicy: 'Retain', Metadata: md('OrdersTable/Resource') };
  R[BUCKET] = { Type: 'AWS::S3::Bucket', Properties: { Tags: tags({ 'aws-cdk:auto-delete-objects': 'true' }) }, UpdateReplacePolicy: 'Delete', DeletionPolicy: 'Delete', Metadata: md('AssetsBucket/Resource') };
  R['AssetsBucketPolicy7D1E5A2B'] = { Type: 'AWS::S3::BucketPolicy', Properties: { Bucket: ref(BUCKET), PolicyDocument: { Statement: [{ Action: ['s3:PutBucketPolicy', 's3:GetBucket*', 's3:List*', 's3:DeleteObject*'], Effect: 'Allow', Principal: { AWS: ga('CustomS3AutoDeleteObjectsCustomResourceProviderRole3B1BD092', 'Arn') }, Resource: [ga(BUCKET, 'Arn'), { 'Fn::Join': ['', [ga(BUCKET, 'Arn'), '/*']] }] }], Version: '2012-10-17' } }, Metadata: md('AssetsBucket/Policy/Resource') };
  R['AssetsBucketAutoDeleteObjectsCustomResource2C4E6A8B'] = { Type: 'Custom::S3AutoDeleteObjects', Properties: { ServiceToken: ga('CustomS3AutoDeleteObjectsCustomResourceProviderHandler9D90184F', 'Arn'), BucketName: ref(BUCKET) }, DependsOn: ['AssetsBucketPolicy7D1E5A2B'], UpdateReplacePolicy: 'Delete', DeletionPolicy: 'Delete', Metadata: md('AssetsBucket/AutoDeleteObjectsCustomResource/Default') };
  R['CustomS3AutoDeleteObjectsCustomResourceProviderRole3B1BD092'] = { Type: 'AWS::IAM::Role', Properties: { AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Action: 'sts:AssumeRole', Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' } }] }, ManagedPolicyArns: [{ 'Fn::Sub': 'arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole' }] }, Metadata: md('Custom::S3AutoDeleteObjectsCustomResourceProvider/Role') };
  R['CustomS3AutoDeleteObjectsCustomResourceProviderHandler9D90184F'] = { Type: 'AWS::Lambda::Function', Properties: { Code: { S3Bucket: { 'Fn::Sub': 'cdk-hnb659fds-assets-${AWS::AccountId}-${AWS::Region}' }, S3Key: 'example-auto-delete-asset.zip' }, Timeout: 900, MemorySize: 128, Handler: '__entrypoint__.handler', Role: ga('CustomS3AutoDeleteObjectsCustomResourceProviderRole3B1BD092', 'Arn'), Runtime: 'nodejs22.x', Description: { 'Fn::Join': ['', ['Lambda function for auto-deleting objects in ', ref(BUCKET), ' S3 bucket.']] } }, DependsOn: ['CustomS3AutoDeleteObjectsCustomResourceProviderRole3B1BD092'], Metadata: md('Custom::S3AutoDeleteObjectsCustomResourceProvider/Handler') };
  R.CDKMetadata = { Type: 'AWS::CDK::Metadata', Properties: { Analytics: 'v2:deflate64:H4sIAAAAAAAA/1WOQQ6CMBBF38K+jFQ1rr2Ae0BjAgB9Twj2r7sVW8AAAA=' }, Metadata: md('CDKMetadata/Default'), Condition: 'CDKMetadataAvailable' };
  const tpl = {
    Resources: R,
    Outputs: {
      ApiServiceLoadBalancerDNS3F4A5B6C: { Value: ga(LB, 'DNSName') },
      ApiServiceServiceURL7D8E9F0A: { Value: { 'Fn::Join': ['', ['http://', ga(LB, 'DNSName')]] } },
    },
    Conditions: { CDKMetadataAvailable: { 'Fn::Or': [{ 'Fn::Or': [{ 'Fn::Equals': [ref('AWS::Region'), 'us-east-1'] }, { 'Fn::Equals': [ref('AWS::Region'), 'us-west-2'] }, { 'Fn::Equals': [ref('AWS::Region'), 'eu-west-1'] }] }, { 'Fn::Equals': [ref('AWS::Region'), 'ap-southeast-2'] }] } },
    Parameters: { BootstrapVersion: { Type: 'AWS::SSM::Parameter::Value<String>', Default: '/cdk-bootstrap/hnb659fds/version', Description: 'Version of the CDK Bootstrap resources in this environment, automatically retrieved from SSM Parameter Store. [cdk:skip]' } },
    Rules: { CheckBootstrapVersion: { Assertions: [{ Assert: { 'Fn::Not': [{ 'Fn::Contains': [['1', '2', '3', '4', '5'], ref('BootstrapVersion')] }] }, AssertDescription: "CDK bootstrap stack version 6 required. Please run 'cdk bootstrap' with a recent version of the CDK CLI." }] } },
  };
  fs.writeFileSync(path.join(DIR, 'cfn-cdk-fargate.json'), JSON.stringify(tpl, null, 1) + '\n');
  console.log('cfn-cdk-fargate.json', Object.keys(R).length, 'resources');
}
{
  const P = 'registry.terraform.io/hashicorp/aws';
  const C = (v) => ({ constant_value: v });
  const Rf = (...r) => ({ references: r });
  // ---- the vpc module
  const azs = ['us-east-1a', 'us-east-1b'];
  const modRes = [], modConf = [];
  const inst = (type, name, index, values) => modRes.push({ address: `module.vpc.${type}.${name}${index == null ? '' : `[${index}]`}`, mode: 'managed', type, name, ...(index == null ? {} : { index }), provider_name: P, schema_version: type === 'aws_vpc' ? 1 : 0, values, sensitive_values: {} });
  const conf = (type, name, expressions, count) => modConf.push({ address: `${type}.${name}`, mode: 'managed', type, name, provider_config_key: 'aws', expressions, schema_version: 0, ...(count ? { count_expression: count } : {}) });
  inst('aws_vpc', 'this', null, { cidr_block: '10.30.0.0/16', enable_dns_hostnames: true, enable_dns_support: true, instance_tenancy: 'default', tags: { Name: 'webapp' } });
  conf('aws_vpc', 'this', { cidr_block: Rf('var.cidr'), enable_dns_hostnames: C(true), tags: C({ Name: 'webapp' }) });
  inst('aws_internet_gateway', 'this', null, { tags: { Name: 'webapp' } });
  conf('aws_internet_gateway', 'this', { vpc_id: Rf('aws_vpc.this.id', 'aws_vpc.this') });
  const tiers = [['public', 0, true], ['private', 10, false], ['database', 20, false]];
  for (const [t, base, pub] of tiers) {
    azs.forEach((az, i) => inst('aws_subnet', t, i, { cidr_block: `10.30.${base + i}.0/24`, availability_zone: az, map_public_ip_on_launch: pub, tags: { Name: `webapp-${t}-${az}` } }));
    conf('aws_subnet', t, { vpc_id: Rf('aws_vpc.this.id', 'aws_vpc.this'), cidr_block: Rf('var.cidr', 'count.index'), availability_zone: Rf('var.azs', 'count.index'), map_public_ip_on_launch: C(pub), tags: Rf('var.azs', 'count.index') }, Rf('var.azs'));
}
  azs.forEach((az, i) => inst('aws_eip', 'nat', i, { domain: 'vpc', tags: { Name: `webapp-nat-${az}` } }));
  conf('aws_eip', 'nat', { domain: C('vpc') }, Rf('var.azs'));
  azs.forEach((az, i) => inst('aws_nat_gateway', 'this', i, { connectivity_type: 'public', tags: { Name: `webapp-${az}` } }));
  conf('aws_nat_gateway', 'this', { allocation_id: Rf('aws_eip.nat', 'count.index'), subnet_id: Rf('aws_subnet.public', 'count.index') }, Rf('var.azs'));
  inst('aws_route_table', 'public', null, { route: [{ cidr_block: '0.0.0.0/0', ipv6_cidr_block: '' }], tags: { Name: 'webapp-public' } });
  conf('aws_route_table', 'public', { vpc_id: Rf('aws_vpc.this.id', 'aws_vpc.this'), route: [{ cidr_block: C('0.0.0.0/0'), gateway_id: Rf('aws_internet_gateway.this.id', 'aws_internet_gateway.this') }] });
  azs.forEach((az, i) => inst('aws_route_table_association', 'public', i, {}));
  conf('aws_route_table_association', 'public', { subnet_id: Rf('aws_subnet.public', 'count.index'), route_table_id: Rf('aws_route_table.public.id', 'aws_route_table.public') }, Rf('var.azs'));
  azs.forEach((az, i) => inst('aws_route_table', 'private', i, { tags: { Name: `webapp-private-${az}` } }));
  conf('aws_route_table', 'private', { vpc_id: Rf('aws_vpc.this.id', 'aws_vpc.this') }, Rf('var.azs'));
  azs.forEach((az, i) => inst('aws_route', 'private_nat', i, { destination_cidr_block: '0.0.0.0/0' }));
  conf('aws_route', 'private_nat', { route_table_id: Rf('aws_route_table.private', 'count.index'), destination_cidr_block: C('0.0.0.0/0'), nat_gateway_id: Rf('aws_nat_gateway.this', 'count.index') }, Rf('var.azs'));
  azs.forEach((az, i) => inst('aws_route_table_association', 'private', i, {}));
  conf('aws_route_table_association', 'private', { subnet_id: Rf('aws_subnet.private', 'count.index'), route_table_id: Rf('aws_route_table.private', 'count.index') }, Rf('var.azs'));
  inst('aws_route_table', 'database', null, { tags: { Name: 'webapp-database' } });
  conf('aws_route_table', 'database', { vpc_id: Rf('aws_vpc.this.id', 'aws_vpc.this') });
  azs.forEach((az, i) => inst('aws_route_table_association', 'database', i, {}));
  conf('aws_route_table_association', 'database', { subnet_id: Rf('aws_subnet.database', 'count.index'), route_table_id: Rf('aws_route_table.database.id', 'aws_route_table.database') }, Rf('var.azs'));
  const modOutputs = {
    vpc_id: { expression: Rf('aws_vpc.this.id', 'aws_vpc.this') },
    public_subnets: { expression: Rf('aws_subnet.public') },
    private_subnets: { expression: Rf('aws_subnet.private') },
    database_subnets: { expression: Rf('aws_subnet.database') },
  };
  // ---- root module
  const rootRes = [], rootConf = [];
  const rinst = (type, name, values) => rootRes.push({ address: `${type}.${name}`, mode: 'managed', type, name, provider_name: P, schema_version: 0, values, sensitive_values: {} });
  const rconf = (type, name, expressions) => rootConf.push({ address: `${type}.${name}`, mode: 'managed', type, name, provider_config_key: 'aws', expressions, schema_version: 0 });
  // Terraform removes AWS's default allow-all egress when it creates a group: the config restates it, as the
  // CloudFormation webapp's groups keep the default
  for (const [n, d] of [['alb', 'ALB, HTTPS from the internet'], ['app', 'App tier'], ['db', 'Database']]) {
    rinst('aws_security_group', n, { name: `webapp-${n}`, description: d, egress: [{ cidr_blocks: ['0.0.0.0/0'], description: '', from_port: 0, ipv6_cidr_blocks: [], prefix_list_ids: [], protocol: '-1', security_groups: [], self: false, to_port: 0 }], tags: { Name: `webapp-${n}` } });
    rconf('aws_security_group', n, { name: C(`webapp-${n}`), description: C(d), vpc_id: Rf('module.vpc.vpc_id', 'module.vpc'), egress: [{ from_port: C(0), to_port: C(0), protocol: C('-1'), cidr_blocks: C(['0.0.0.0/0']) }] });
}
  rinst('aws_vpc_security_group_ingress_rule', 'alb_https', { cidr_ipv4: '0.0.0.0/0', from_port: 443, to_port: 443, ip_protocol: 'tcp' });
  rconf('aws_vpc_security_group_ingress_rule', 'alb_https', { security_group_id: Rf('aws_security_group.alb.id', 'aws_security_group.alb'), cidr_ipv4: C('0.0.0.0/0'), from_port: C(443), to_port: C(443), ip_protocol: C('tcp') });
  rinst('aws_vpc_security_group_ingress_rule', 'app_from_alb', { from_port: 8080, to_port: 8080, ip_protocol: 'tcp' });
  rconf('aws_vpc_security_group_ingress_rule', 'app_from_alb', { security_group_id: Rf('aws_security_group.app.id', 'aws_security_group.app'), referenced_security_group_id: Rf('aws_security_group.alb.id', 'aws_security_group.alb'), from_port: C(8080), to_port: C(8080), ip_protocol: C('tcp') });
  rinst('aws_vpc_security_group_ingress_rule', 'db_from_app', { from_port: 5432, to_port: 5432, ip_protocol: 'tcp' });
  rconf('aws_vpc_security_group_ingress_rule', 'db_from_app', { security_group_id: Rf('aws_security_group.db.id', 'aws_security_group.db'), referenced_security_group_id: Rf('aws_security_group.app.id', 'aws_security_group.app'), from_port: C(5432), to_port: C(5432), ip_protocol: C('tcp') });
  rinst('aws_lb', 'web', { name: 'webapp', internal: false, load_balancer_type: 'application', tags: { Name: 'webapp' } });
  rconf('aws_lb', 'web', { name: C('webapp'), internal: C(false), load_balancer_type: C('application'), subnets: Rf('module.vpc.public_subnets', 'module.vpc'), security_groups: Rf('aws_security_group.alb.id', 'aws_security_group.alb') });
  rinst('aws_lb_target_group', 'app', { name: 'webapp-app', port: 8080, protocol: 'HTTP', target_type: 'instance' });
  rconf('aws_lb_target_group', 'app', { name: C('webapp-app'), port: C(8080), protocol: C('HTTP'), vpc_id: Rf('module.vpc.vpc_id', 'module.vpc') });
  rinst('aws_lb_listener', 'https', { port: 443, protocol: 'HTTPS', default_action: [{ type: 'forward' }] });
  rconf('aws_lb_listener', 'https', { load_balancer_arn: Rf('aws_lb.web.arn', 'aws_lb.web'), port: C(443), protocol: C('HTTPS'), certificate_arn: Rf('var.certificate_arn'), default_action: [{ type: C('forward'), target_group_arn: Rf('aws_lb_target_group.app.arn', 'aws_lb_target_group.app') }] });
  rinst('aws_iam_role', 'app', { name: 'webapp-app', assume_role_policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }] }) });
  rconf('aws_iam_role', 'app', { name: C('webapp-app'), assume_role_policy: {} });
  rinst('aws_iam_role_policy', 'app', { name: 'assets-read', policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:GetObject'], Resource: 'arn:aws:s3:::acme-webapp-assets/*' }] }) });
  rconf('aws_iam_role_policy', 'app', { name: C('assets-read'), role: Rf('aws_iam_role.app.id', 'aws_iam_role.app'), policy: Rf('aws_s3_bucket.assets.bucket', 'aws_s3_bucket.assets') });
  rinst('aws_iam_instance_profile', 'app', { name: 'webapp-app' });
  rconf('aws_iam_instance_profile', 'app', { name: C('webapp-app'), role: Rf('aws_iam_role.app.name', 'aws_iam_role.app') });
  rinst('aws_launch_template', 'app', { name_prefix: 'webapp-app-', instance_type: 't3.small', iam_instance_profile: [{}] });
  rconf('aws_launch_template', 'app', { name_prefix: C('webapp-app-'), image_id: Rf('data.aws_ami.al2023.id', 'data.aws_ami.al2023'), instance_type: C('t3.small'), vpc_security_group_ids: Rf('aws_security_group.app.id', 'aws_security_group.app'), iam_instance_profile: [{ arn: Rf('aws_iam_instance_profile.app.arn', 'aws_iam_instance_profile.app') }] });
  rinst('aws_autoscaling_group', 'app', { name: 'webapp-app', min_size: 2, max_size: 6, desired_capacity: 2, health_check_type: 'ELB', launch_template: [{ version: '$Latest' }] });
  rconf('aws_autoscaling_group', 'app', { name: C('webapp-app'), min_size: C(2), max_size: C(6), desired_capacity: C(2), vpc_zone_identifier: Rf('module.vpc.private_subnets', 'module.vpc'), target_group_arns: Rf('aws_lb_target_group.app.arn', 'aws_lb_target_group.app'), launch_template: [{ id: Rf('aws_launch_template.app.id', 'aws_launch_template.app'), version: C('$Latest') }] });
  rinst('aws_db_subnet_group', 'db', { name: 'webapp-db' });
  rconf('aws_db_subnet_group', 'db', { name: C('webapp-db'), subnet_ids: Rf('module.vpc.database_subnets', 'module.vpc') });
  rinst('aws_db_instance', 'db', { identifier: 'webapp-db', engine: 'postgres', engine_version: '16.4', instance_class: 'db.m6g.large', multi_az: true, allocated_storage: 100, db_subnet_group_name: 'webapp-db' });
  rconf('aws_db_instance', 'db', { identifier: C('webapp-db'), engine: C('postgres'), instance_class: C('db.m6g.large'), multi_az: C(true), db_subnet_group_name: Rf('aws_db_subnet_group.db.name', 'aws_db_subnet_group.db'), vpc_security_group_ids: Rf('aws_security_group.db.id', 'aws_security_group.db') });
  rinst('aws_s3_bucket', 'assets', { bucket: 'acme-webapp-assets', force_destroy: false });
  rconf('aws_s3_bucket', 'assets', { bucket: C('acme-webapp-assets') });
  rinst('aws_route53_record', 'www', { name: 'www.example.com', type: 'A', zone_id: 'Z0123456789EXAMPLE', alias: [{ evaluate_target_health: true }] });
  rconf('aws_route53_record', 'www', { name: C('www.example.com'), type: C('A'), zone_id: Rf('var.zone_id'), alias: [{ name: Rf('aws_lb.web.dns_name', 'aws_lb.web'), zone_id: Rf('aws_lb.web.zone_id', 'aws_lb.web'), evaluate_target_health: C(true) }] });
  rinst('aws_cloudwatch_metric_alarm', 'cpu', { alarm_name: 'webapp-cpu', metric_name: 'CPUUtilization', namespace: 'AWS/EC2', threshold: 80 });
  rconf('aws_cloudwatch_metric_alarm', 'cpu', { alarm_name: C('webapp-cpu'), dimensions: Rf('aws_autoscaling_group.app.name', 'aws_autoscaling_group.app') });
  const allRes = [...rootRes, ...modRes];
  const plan = {
    format_version: '1.2',
    terraform_version: '1.9.8',
    variables: { region: { value: 'us-east-1' }, zone_id: { value: 'Z0123456789EXAMPLE' }, certificate_arn: { value: 'arn:aws:acm:us-east-1:111122223333:certificate/0000-example' } },
    planned_values: { root_module: { resources: rootRes, child_modules: [{ resources: modRes, address: 'module.vpc' }] } },
    resource_changes: allRes.map((r) => ({ address: r.address, ...(r.address.startsWith('module.') ? { module_address: 'module.vpc' } : {}), mode: 'managed', type: r.type, name: r.name, ...(r.index != null ? { index: r.index } : {}), provider_name: P, change: { actions: ['create'], before: null, after: r.values, after_unknown: { id: true, arn: true }, before_sensitive: false, after_sensitive: {} } })),
    configuration: {
      provider_config: { aws: { name: 'aws', full_name: P, version_constraint: '~> 5.80', expressions: { region: Rf('var.region') } } },
      root_module: {
        resources: rootConf,
        module_calls: { vpc: { source: './modules/vpc', expressions: { cidr: C('10.30.0.0/16'), azs: C(azs) }, module: { outputs: modOutputs, resources: modConf, variables: { cidr: { description: 'VPC CIDR' }, azs: { description: 'Availability Zones' } } } } },
        variables: { region: { default: 'us-east-1' }, zone_id: {}, certificate_arn: {} },
      },
    },
    timestamp: '2026-10-09T12:00:00Z',
    applyable: true,
    complete: true,
    errored: false,
  };
  fs.writeFileSync(path.join(DIR, "tf-webapp-plan.json"), JSON.stringify(plan, null, 1) + '\n');
  // ---- a state: values only; edges come from ids and ARNs that match
  const acct = '111122223333', reg = 'eu-west-1';
  const arn = (svc, rest) => `arn:aws:${svc}:${reg}:${acct}:${rest}`;
  const S = [];
  const sres = (type, name, values) => S.push({ address: `${type}.${name}`, mode: 'managed', type, name, provider_name: P, schema_version: 0, values, sensitive_values: {} });
  sres('aws_sqs_queue', 'jobs', { id: `https://sqs.${reg}.amazonaws.com/${acct}/jobs`, arn: arn('sqs', 'jobs'), name: 'jobs' });
  sres('aws_sqs_queue', 'jobs_dlq', { id: `https://sqs.${reg}.amazonaws.com/${acct}/jobs-dlq`, arn: arn('sqs', 'jobs-dlq'), name: 'jobs-dlq' });
  sres('aws_iam_role', 'worker', { id: 'jobs-worker', arn: `arn:aws:iam::${acct}:role/jobs-worker`, name: 'jobs-worker' });
  sres('aws_lambda_function', 'worker', { id: 'jobs-worker', arn: arn('lambda', 'function:jobs-worker'), function_name: 'jobs-worker', role: `arn:aws:iam::${acct}:role/jobs-worker`, runtime: 'python3.13', handler: 'app.handler', tags: { Name: 'jobs-worker' } });
  sres('aws_lambda_event_source_mapping', 'jobs', { id: '9f1c2d3e-0000-4b5a-9c8d-112233445566', event_source_arn: arn('sqs', 'jobs'), function_name: arn('lambda', 'function:jobs-worker'), batch_size: 10 });
  sres('aws_dynamodb_table', 'results', { id: 'job-results', arn: arn('dynamodb', 'table/job-results'), name: 'job-results', billing_mode: 'PAY_PER_REQUEST', hash_key: 'job_id' });
  sres('aws_iam_role_policy', 'worker', { id: 'jobs-worker:worker', name: 'worker', role: 'jobs-worker', policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'], Resource: arn('sqs', 'jobs') }, { Effect: 'Allow', Action: ['dynamodb:PutItem'], Resource: arn('dynamodb', 'table/job-results') }] }) });
  sres('aws_sns_topic', 'done', { id: arn('sns', 'jobs-done'), arn: arn('sns', 'jobs-done'), name: 'jobs-done' });
  sres('aws_cloudwatch_event_rule', 'nightly', { id: 'jobs-nightly', arn: arn('events', 'rule/jobs-nightly'), name: 'jobs-nightly', schedule_expression: 'cron(0 2 * * ? *)' });
  sres('aws_cloudwatch_event_target', 'nightly', { id: 'jobs-nightly-sqs', rule: 'jobs-nightly', arn: arn('sqs', 'jobs'), target_id: 'sqs' });
  sres('aws_cloudwatch_log_group', 'worker', { id: '/aws/lambda/jobs-worker', arn: arn('logs', 'log-group:/aws/lambda/jobs-worker'), name: '/aws/lambda/jobs-worker' });
  const state = { format_version: '1.0', terraform_version: '1.9.8', values: { root_module: { resources: S } } };
  fs.writeFileSync(path.join(DIR, "tf-queue-state.json"), JSON.stringify(state, null, 1) + '\n');
  console.log('tf-webapp-plan.json', allRes.length, 'instances; tf-queue-state.json', S.length);
}
{
  // the dual-stack webapp as a flat root module with count: the same groups, rules and story as
  // cfn-webapp-dualstack.yaml (the sidecar's anchors name them alike); documentation addresses only
  const P = 'registry.terraform.io/hashicorp/aws';
  const C = (v) => ({ constant_value: v });
  const Rf = (...r) => ({ references: r });
  const azs = ['us-east-1a', 'us-east-1b'];
  const res = [], cfg = [];
  const inst = (type, name, index, values) => res.push({ address: `${type}.${name}${index == null ? '' : `[${index}]`}`, mode: 'managed', type, name, ...(index == null ? {} : { index }), provider_name: P, schema_version: 0, values, sensitive_values: {} });
  const conf = (type, name, expressions, count) => cfg.push({ address: `${type}.${name}`, mode: 'managed', type, name, provider_config_key: 'aws', expressions, schema_version: 0, ...(count ? { count_expression: count } : {}) });
  const vpc = Rf('aws_vpc.main.id', 'aws_vpc.main');
  inst('aws_vpc', 'main', null, { cidr_block: '10.0.0.0/16', ipv6_cidr_block: '2001:db8:1200::/56', ipv6_ipam_pool_id: 'ipam-pool-example', enable_dns_hostnames: true, enable_dns_support: true, tags: { Name: 'webapp' } });
  conf('aws_vpc', 'main', { cidr_block: C('10.0.0.0/16'), ipv6_cidr_block: C('2001:db8:1200::/56'), ipv6_ipam_pool_id: Rf('var.ipv6_pool'), enable_dns_hostnames: C(true), tags: C({ Name: 'webapp' }) });
  inst('aws_internet_gateway', 'main', null, { tags: { Name: 'webapp' } });
  conf('aws_internet_gateway', 'main', { vpc_id: vpc });
  inst('aws_egress_only_internet_gateway', 'main', null, { tags: { Name: 'webapp' } });
  conf('aws_egress_only_internet_gateway', 'main', { vpc_id: vpc });
  const v6 = (n) => (n ? `2001:db8:1200:${n}::/64` : '2001:db8:1200::/64');
  for (const [t, base, pub] of [['public', 0, true], ['private', 10, false]]) {
    azs.forEach((az, i) => inst('aws_subnet', t, i, { cidr_block: `10.0.${base + i}.0/24`, ipv6_cidr_block: v6(base + i), assign_ipv6_address_on_creation: true, availability_zone: az, map_public_ip_on_launch: pub, tags: { Name: `webapp-${t}-${az}` } }));
    conf('aws_subnet', t, { vpc_id: vpc, cidr_block: Rf('var.vpc_cidr', 'count.index'), ipv6_cidr_block: Rf('aws_vpc.main.ipv6_cidr_block', 'aws_vpc.main', 'count.index'), assign_ipv6_address_on_creation: C(true), availability_zone: Rf('var.azs', 'count.index'), map_public_ip_on_launch: C(pub) }, Rf('var.azs'));
  }
  azs.forEach((az, i) => inst('aws_eip', 'nat', i, { domain: 'vpc' }));
  conf('aws_eip', 'nat', { domain: C('vpc') }, Rf('var.azs'));
  azs.forEach((az, i) => inst('aws_nat_gateway', 'main', i, { connectivity_type: 'public', tags: { Name: `webapp-${az}` } }));
  conf('aws_nat_gateway', 'main', { allocation_id: Rf('aws_eip.nat', 'count.index'), subnet_id: Rf('aws_subnet.public', 'count.index') }, Rf('var.azs'));
  const routes = [{ cidr_block: '0.0.0.0/0', ipv6_cidr_block: '' }, { cidr_block: '', ipv6_cidr_block: '::/0' }];
  const igw = Rf('aws_internet_gateway.main.id', 'aws_internet_gateway.main');
  inst('aws_route_table', 'public', null, { route: routes, tags: { Name: 'webapp-public' } });
  conf('aws_route_table', 'public', { vpc_id: vpc, route: [{ cidr_block: C('0.0.0.0/0'), gateway_id: igw }, { ipv6_cidr_block: C('::/0'), gateway_id: igw }] });
  azs.forEach((az, i) => inst('aws_route_table_association', 'public', i, {}));
  conf('aws_route_table_association', 'public', { subnet_id: Rf('aws_subnet.public', 'count.index'), route_table_id: Rf('aws_route_table.public.id', 'aws_route_table.public') }, Rf('var.azs'));
  // private subnets: IPv4 out through their AZ's NAT gateway, IPv6 out through the egress-only internet gateway
  azs.forEach((az, i) => inst('aws_route_table', 'private', i, { route: routes, tags: { Name: `webapp-private-${az}` } }));
  conf('aws_route_table', 'private', { vpc_id: vpc, route: [{ cidr_block: C('0.0.0.0/0'), nat_gateway_id: Rf('aws_nat_gateway.main', 'count.index') }, { ipv6_cidr_block: C('::/0'), egress_only_gateway_id: Rf('aws_egress_only_internet_gateway.main.id', 'aws_egress_only_internet_gateway.main') }] }, Rf('var.azs'));
  azs.forEach((az, i) => inst('aws_route_table_association', 'private', i, {}));
  conf('aws_route_table_association', 'private', { subnet_id: Rf('aws_subnet.private', 'count.index'), route_table_id: Rf('aws_route_table.private', 'count.index') }, Rf('var.azs'));
  inst('aws_ec2_managed_prefix_list', 'corp', null, { name: 'corp-offices', address_family: 'IPv4', max_entries: 4, entry: [{ cidr: '198.51.100.0/24', description: 'head office' }, { cidr: '203.0.113.0/24', description: 'branch office' }] });
  conf('aws_ec2_managed_prefix_list', 'corp', { name: C('corp-offices'), address_family: C('IPv4'), max_entries: C(4), entry: [{ cidr: C('198.51.100.0/24'), description: C('head office') }, { cidr: C('203.0.113.0/24'), description: C('branch office') }] });
  // groups: inline rules where the CloudFormation template has them inline, separate ones where it has a
  // separate resource (or a reference cycle forbids inline rules)
  const block = (from, to, proto, v4, v6) => ({ cidr_blocks: v4, description: '', from_port: from, ipv6_cidr_blocks: v6, prefix_list_ids: [], protocol: proto, security_groups: [], self: false, to_port: to });
  const blockConf = (from, to, proto, v4, v6) => ({ from_port: C(from), to_port: C(to), protocol: C(proto), cidr_blocks: C(v4), ipv6_cidr_blocks: C(v6) });
  const https = [443, 443, 'tcp', ['0.0.0.0/0'], ['::/0']], all = [0, 0, '-1', ['0.0.0.0/0'], ['::/0']];
  for (const [n, d, ingress, egress] of [
    ['alb', 'ALB, HTTPS from the internet over IPv4 and IPv6', https, all],
    ['app', 'App tier, 8080 from the ALB, SSH from the offices; out to HTTPS and the database only', null, https],
    ['db', 'DB tier, 5432 from the app tier only', null, all],
  ]) {
    inst('aws_security_group', n, null, { name: `webapp-${n}`, description: d, ...(ingress ? { ingress: [block(...ingress)] } : {}), egress: [block(...egress)], tags: { Name: `webapp-${n}` } });
    conf('aws_security_group', n, { name: C(`webapp-${n}`), description: C(d), vpc_id: vpc, ...(ingress ? { ingress: [blockConf(...ingress)] } : {}), egress: [blockConf(...egress)] });
  }
  const rule = (type, name, sg, port, peer) => {
    inst(type, name, null, { from_port: port, to_port: port, ip_protocol: 'tcp' });
    conf(type, name, { security_group_id: Rf(`aws_security_group.${sg}.id`, `aws_security_group.${sg}`), from_port: C(port), to_port: C(port), ip_protocol: C('tcp'), ...peer });
  };
  rule('aws_vpc_security_group_ingress_rule', 'app_from_alb', 'app', 8080, { referenced_security_group_id: Rf('aws_security_group.alb.id', 'aws_security_group.alb') });
  rule('aws_vpc_security_group_ingress_rule', 'app_ssh_corp', 'app', 22, { prefix_list_id: Rf('aws_ec2_managed_prefix_list.corp.id', 'aws_ec2_managed_prefix_list.corp') });
  rule('aws_vpc_security_group_egress_rule', 'app_to_db', 'app', 5432, { referenced_security_group_id: Rf('aws_security_group.db.id', 'aws_security_group.db') });
  rule('aws_vpc_security_group_ingress_rule', 'db_from_app', 'db', 5432, { referenced_security_group_id: Rf('aws_security_group.app.id', 'aws_security_group.app') });
  inst('aws_lb', 'web', null, { name: 'webapp', internal: false, load_balancer_type: 'application', ip_address_type: 'dualstack', tags: { Name: 'webapp' } });
  conf('aws_lb', 'web', { name: C('webapp'), internal: C(false), load_balancer_type: C('application'), ip_address_type: C('dualstack'), subnets: Rf('aws_subnet.public'), security_groups: Rf('aws_security_group.alb.id', 'aws_security_group.alb') });
  inst('aws_lb_target_group', 'app', null, { name: 'webapp-app', port: 8080, protocol: 'HTTP', target_type: 'instance' });
  conf('aws_lb_target_group', 'app', { name: C('webapp-app'), port: C(8080), protocol: C('HTTP'), vpc_id: vpc });
  inst('aws_lb_listener', 'https', null, { port: 443, protocol: 'HTTPS', default_action: [{ type: 'forward' }] });
  conf('aws_lb_listener', 'https', { load_balancer_arn: Rf('aws_lb.web.arn', 'aws_lb.web'), port: C(443), protocol: C('HTTPS'), certificate_arn: Rf('var.certificate_arn'), default_action: [{ type: C('forward'), target_group_arn: Rf('aws_lb_target_group.app.arn', 'aws_lb_target_group.app') }] });
  inst('aws_launch_template', 'app', null, { name_prefix: 'webapp-app-', instance_type: 't3.small' });
  conf('aws_launch_template', 'app', { name_prefix: C('webapp-app-'), image_id: Rf('data.aws_ami.al2023.id', 'data.aws_ami.al2023'), instance_type: C('t3.small'), vpc_security_group_ids: Rf('aws_security_group.app.id', 'aws_security_group.app') });
  inst('aws_autoscaling_group', 'app', null, { name: 'webapp-app', min_size: 2, max_size: 6, desired_capacity: 2, health_check_type: 'ELB', launch_template: [{ version: '$Latest' }] });
  conf('aws_autoscaling_group', 'app', { name: C('webapp-app'), min_size: C(2), max_size: C(6), desired_capacity: C(2), vpc_zone_identifier: Rf('aws_subnet.private'), target_group_arns: Rf('aws_lb_target_group.app.arn', 'aws_lb_target_group.app'), launch_template: [{ id: Rf('aws_launch_template.app.id', 'aws_launch_template.app'), version: C('$Latest') }] });
  inst('aws_db_subnet_group', 'db', null, { name: 'webapp-db' });
  conf('aws_db_subnet_group', 'db', { name: C('webapp-db'), subnet_ids: Rf('aws_subnet.private') });
  inst('aws_db_instance', 'db', null, { identifier: 'webapp-db', engine: 'postgres', instance_class: 'db.m6g.large', multi_az: true, network_type: 'DUAL', allocated_storage: 100, db_subnet_group_name: 'webapp-db' });
  conf('aws_db_instance', 'db', { identifier: C('webapp-db'), engine: C('postgres'), instance_class: C('db.m6g.large'), multi_az: C(true), network_type: C('DUAL'), db_subnet_group_name: Rf('aws_db_subnet_group.db.name', 'aws_db_subnet_group.db'), vpc_security_group_ids: Rf('aws_security_group.db.id', 'aws_security_group.db') });
  const plan = {
    format_version: '1.2',
    terraform_version: '1.9.8',
    variables: { region: { value: 'us-east-1' }, azs: { value: azs }, ipv6_pool: { value: 'ipam-pool-example' }, certificate_arn: { value: 'arn:aws:acm:us-east-1:111122223333:certificate/example' } },
    planned_values: { root_module: { resources: res } },
    resource_changes: res.map((r) => ({ address: r.address, mode: 'managed', type: r.type, name: r.name, ...(r.index != null ? { index: r.index } : {}), provider_name: P, change: { actions: ['create'], before: null, after: r.values, after_unknown: { id: true, arn: true }, before_sensitive: false, after_sensitive: {} } })),
    configuration: {
      provider_config: { aws: { name: 'aws', full_name: P, version_constraint: '~> 5.80', expressions: { region: Rf('var.region') } } },
      root_module: { resources: cfg, variables: { region: { default: 'us-east-1' }, azs: { default: azs }, ipv6_pool: {}, certificate_arn: {} } },
    },
    timestamp: '2026-10-10T12:00:00Z',
    applyable: true,
    complete: true,
    errored: false,
  };
  fs.writeFileSync(path.join(DIR, 'tf-webapp-dualstack-plan.json'), JSON.stringify(plan, null, 1) + '\n');
  console.log('tf-webapp-dualstack-plan.json', res.length, 'instances');
}
