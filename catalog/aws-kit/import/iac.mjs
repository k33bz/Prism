// iac.mjs: the infrastructure-as-code back end the CloudFormation (cfn.mjs) and Terraform (tf.mjs) importers
// share (k33bz fork). No deps. A front end turns its source into resource records; this module classifies
// them, infers what an AWS reference diagram draws (VPC, subnets and their kind, Availability Zone
// positions, placement, the request edges), writes the inference ledger, applies the flows sidecar and
// lays the result out through the shared IR (ir.mjs, layout.mjs).
//
//   importInfra(resources, ctx, opts) -> { spec, report }
//
// A resource record (both front ends):
//   { key, type, src: 'cfn'|'tf', base, name, aliases: [], vals(path), refs(path?), items(path), az, tags,
//     helper, props }
//   key is the native address (logical id, Terraform address); vals/refs walk a property path such as
//   "VpcConfig.SubnetIds" or "vpc_config.subnet_ids" (lists are walked); refs() with no path returns every
//   resource the record references; items(path) returns one sub-record per list element.
// ctx: { src, title, desc, region, issues: [], ledger: [], params: [] }
// opts: { id, name, flows (the sidecar object), story ('auto'|'none'|'guess'|<flow or story id>), width }
import { resolveIcon, iconInfo } from '../../aws-icons/resolve.mjs';
import { newIr, buildSpec, issue as irIssue } from './ir.mjs';
import { checkSpec, lint as lintSpec } from '../awd.mjs';
import { validateDiagram } from '../spec.mjs';
import { story as storyOf } from '../story.mjs';
import { wrap as wrapWords } from '../place.mjs';

// ---------------------------------------------------------------------------------------------------
// canonical kinds: CloudFormation and Terraform types for the resources the inference reads
const KINDS = {
  vpc: ['AWS::EC2::VPC', 'aws_vpc', 'aws_default_vpc'],
  subnet: ['AWS::EC2::Subnet', 'aws_subnet', 'aws_default_subnet'],
  igw: ['AWS::EC2::InternetGateway', 'aws_internet_gateway'],
  eigw: ['AWS::EC2::EgressOnlyInternetGateway', 'aws_egress_only_internet_gateway'],
  igwAttach: ['AWS::EC2::VPCGatewayAttachment', 'aws_internet_gateway_attachment', 'aws_vpn_gateway_attachment'],
  vgw: ['AWS::EC2::VPNGateway', 'aws_vpn_gateway'],
  nat: ['AWS::EC2::NatGateway', 'aws_nat_gateway'],
  eip: ['AWS::EC2::EIP', 'aws_eip'],
  rt: ['AWS::EC2::RouteTable', 'aws_route_table', 'aws_default_route_table'],
  route: ['AWS::EC2::Route', 'aws_route'],
  rtAssoc: ['AWS::EC2::SubnetRouteTableAssociation', 'aws_route_table_association'],
  sg: ['AWS::EC2::SecurityGroup', 'aws_security_group', 'aws_default_security_group'],
  sgIn: ['AWS::EC2::SecurityGroupIngress', 'aws_security_group_rule', 'aws_vpc_security_group_ingress_rule'],
  sgOut: ['AWS::EC2::SecurityGroupEgress', 'aws_vpc_security_group_egress_rule'],
  lb: ['AWS::ElasticLoadBalancingV2::LoadBalancer', 'aws_lb', 'aws_alb'],
  clb: ['AWS::ElasticLoadBalancing::LoadBalancer', 'aws_elb'],
  listener: ['AWS::ElasticLoadBalancingV2::Listener', 'aws_lb_listener', 'aws_alb_listener'],
  listenerRule: ['AWS::ElasticLoadBalancingV2::ListenerRule', 'aws_lb_listener_rule', 'aws_alb_listener_rule'],
  tg: ['AWS::ElasticLoadBalancingV2::TargetGroup', 'aws_lb_target_group', 'aws_alb_target_group'],
  tgAttach: ['aws_lb_target_group_attachment', 'aws_alb_target_group_attachment'],
  asg: ['AWS::AutoScaling::AutoScalingGroup', 'aws_autoscaling_group'],
  lt: ['AWS::EC2::LaunchTemplate', 'aws_launch_template'],
  lc: ['AWS::AutoScaling::LaunchConfiguration', 'aws_launch_configuration'],
  instance: ['AWS::EC2::Instance', 'aws_instance'],
  db: ['AWS::RDS::DBInstance', 'aws_db_instance', 'aws_rds_cluster_instance'],
  dbCluster: ['AWS::RDS::DBCluster', 'aws_rds_cluster'],
  dbSubnetGroup: ['AWS::RDS::DBSubnetGroup', 'aws_db_subnet_group', 'AWS::DocDB::DBSubnetGroup', 'aws_docdb_subnet_group', 'AWS::Neptune::DBSubnetGroup', 'aws_neptune_subnet_group'],
  cache: ['AWS::ElastiCache::ReplicationGroup', 'AWS::ElastiCache::CacheCluster', 'aws_elasticache_replication_group', 'aws_elasticache_cluster', 'AWS::MemoryDB::Cluster', 'aws_memorydb_cluster'],
  cacheSubnetGroup: ['AWS::ElastiCache::SubnetGroup', 'aws_elasticache_subnet_group', 'AWS::MemoryDB::SubnetGroup', 'aws_memorydb_subnet_group'],
  docdb: ['AWS::DocDB::DBCluster', 'aws_docdb_cluster', 'AWS::Neptune::DBCluster', 'aws_neptune_cluster'],
  redshift: ['AWS::Redshift::Cluster', 'aws_redshift_cluster'],
  redshiftSubnetGroup: ['AWS::Redshift::ClusterSubnetGroup', 'aws_redshift_subnet_group'],
  opensearch: ['AWS::OpenSearchService::Domain', 'AWS::Elasticsearch::Domain', 'aws_opensearch_domain', 'aws_elasticsearch_domain'],
  msk: ['AWS::MSK::Cluster', 'aws_msk_cluster'],
  mq: ['AWS::AmazonMQ::Broker', 'aws_mq_broker'],
  fn: ['AWS::Lambda::Function', 'AWS::Serverless::Function', 'aws_lambda_function'],
  esm: ['AWS::Lambda::EventSourceMapping', 'aws_lambda_event_source_mapping'],
  perm: ['AWS::Lambda::Permission', 'aws_lambda_permission'],
  fnUrl: ['AWS::Lambda::Url', 'aws_lambda_function_url'],
  ecsCluster: ['AWS::ECS::Cluster', 'aws_ecs_cluster'],
  ecsService: ['AWS::ECS::Service', 'aws_ecs_service'],
  ecsTask: ['AWS::ECS::TaskDefinition', 'aws_ecs_task_definition'],
  eks: ['AWS::EKS::Cluster', 'aws_eks_cluster'],
  eksNg: ['AWS::EKS::Nodegroup', 'aws_eks_node_group'],
  efs: ['AWS::EFS::FileSystem', 'aws_efs_file_system'],
  efsMount: ['AWS::EFS::MountTarget', 'aws_efs_mount_target'],
  vpce: ['AWS::EC2::VPCEndpoint', 'aws_vpc_endpoint'],
  tgwAttach: ['AWS::EC2::TransitGatewayAttachment', 'AWS::EC2::TransitGatewayVpcAttachment', 'aws_ec2_transit_gateway_vpc_attachment'],
  rule: ['AWS::Events::Rule', 'aws_cloudwatch_event_rule'],
  ruleTarget: ['aws_cloudwatch_event_target'],
  schedule: ['AWS::Scheduler::Schedule', 'aws_scheduler_schedule'],
  pipe: ['AWS::Pipes::Pipe', 'aws_pipes_pipe'],
  topic: ['AWS::SNS::Topic', 'aws_sns_topic'],
  snsSub: ['AWS::SNS::Subscription', 'aws_sns_topic_subscription'],
  queue: ['AWS::SQS::Queue', 'aws_sqs_queue'],
  bucket: ['AWS::S3::Bucket', 'aws_s3_bucket'],
  s3notif: ['aws_s3_bucket_notification'],
  table: ['AWS::DynamoDB::Table', 'AWS::DynamoDB::GlobalTable', 'aws_dynamodb_table'],
  restApi: ['AWS::ApiGateway::RestApi', 'aws_api_gateway_rest_api'],
  apiMethod: ['AWS::ApiGateway::Method', 'aws_api_gateway_integration'],
  apiV2: ['AWS::ApiGatewayV2::Api', 'aws_apigatewayv2_api'],
  apiV2Int: ['AWS::ApiGatewayV2::Integration', 'aws_apigatewayv2_integration'],
  appsync: ['AWS::AppSync::GraphQLApi', 'aws_appsync_graphql_api'],
  r53zone: ['AWS::Route53::HostedZone', 'aws_route53_zone'],
  r53rec: ['AWS::Route53::RecordSet', 'aws_route53_record'],
  r53recGroup: ['AWS::Route53::RecordSetGroup'],
  cf: ['AWS::CloudFront::Distribution', 'aws_cloudfront_distribution'],
  waf: ['AWS::WAFv2::WebACL', 'aws_wafv2_web_acl'],
  wafAssoc: ['AWS::WAFv2::WebACLAssociation', 'aws_wafv2_web_acl_association'],
  ga: ['AWS::GlobalAccelerator::Accelerator', 'aws_globalaccelerator_accelerator'],
  role: ['AWS::IAM::Role', 'aws_iam_role'],
  policy: ['AWS::IAM::Policy', 'AWS::IAM::ManagedPolicy', 'aws_iam_policy', 'aws_iam_role_policy'],
  policyAttach: ['aws_iam_role_policy_attachment'],
  profile: ['AWS::IAM::InstanceProfile', 'aws_iam_instance_profile'],
  sfn: ['AWS::StepFunctions::StateMachine', 'AWS::Serverless::StateMachine', 'aws_sfn_state_machine'],
  stack: ['AWS::CloudFormation::Stack'],
  // operational resources: not drawn unless the sidecar lists them under "show"
  ops: ['AWS::CloudWatch::Alarm', 'AWS::CloudWatch::CompositeAlarm', 'AWS::CloudWatch::Dashboard', 'AWS::Logs::LogGroup', 'AWS::Logs::MetricFilter',
    'AWS::Logs::SubscriptionFilter', 'AWS::AutoScaling::ScalingPolicy', 'AWS::AutoScaling::ScheduledAction', 'AWS::AutoScaling::LifecycleHook',
    'AWS::ApplicationAutoScaling::ScalingPolicy', 'AWS::ApplicationAutoScaling::ScalableTarget', 'AWS::SSM::Parameter', 'AWS::Lambda::Version',
    'AWS::Lambda::Alias', 'AWS::Lambda::LayerVersion', 'AWS::Lambda::EventInvokeConfig', 'AWS::ApiGateway::Account', 'AWS::ApiGateway::Deployment',
    'AWS::ApiGateway::Stage', 'AWS::ApiGateway::Resource', 'AWS::ApiGatewayV2::Stage', 'AWS::ApiGatewayV2::Route', 'AWS::ApiGatewayV2::Deployment',
    'AWS::EC2::FlowLog', 'AWS::KMS::Alias', 'AWS::S3::BucketPolicy', 'AWS::SQS::QueuePolicy', 'AWS::SNS::TopicPolicy', 'AWS::EC2::NetworkAcl',
    'AWS::EC2::NetworkAclEntry', 'AWS::EC2::SubnetNetworkAclAssociation', 'AWS::EC2::DHCPOptions', 'AWS::EC2::VPCDHCPOptionsAssociation',
    'AWS::CertificateManager::Certificate', 'AWS::Route53::HealthCheck',
    'aws_cloudwatch_metric_alarm', 'aws_cloudwatch_composite_alarm', 'aws_cloudwatch_dashboard', 'aws_cloudwatch_log_group', 'aws_cloudwatch_log_metric_filter',
    'aws_cloudwatch_log_subscription_filter', 'aws_autoscaling_policy', 'aws_autoscaling_schedule', 'aws_autoscaling_lifecycle_hook', 'aws_appautoscaling_policy',
    'aws_appautoscaling_target', 'aws_ssm_parameter', 'aws_lambda_alias', 'aws_lambda_layer_version', 'aws_api_gateway_deployment', 'aws_api_gateway_stage',
    'aws_api_gateway_resource', 'aws_api_gateway_method', 'aws_apigatewayv2_stage', 'aws_apigatewayv2_route', 'aws_flow_log', 'aws_kms_alias',
    'aws_s3_bucket_policy', 'aws_s3_bucket_versioning', 'aws_s3_bucket_server_side_encryption_configuration', 'aws_s3_bucket_public_access_block',
    'aws_s3_bucket_ownership_controls', 'aws_s3_bucket_lifecycle_configuration', 'aws_s3_bucket_acl', 'aws_s3_bucket_cors_configuration',
    'aws_s3_bucket_website_configuration', 'aws_sqs_queue_policy', 'aws_sns_topic_policy', 'aws_network_acl', 'aws_network_acl_rule',
    'aws_network_acl_association', 'aws_vpc_dhcp_options', 'aws_vpc_dhcp_options_association', 'aws_acm_certificate', 'aws_acm_certificate_validation',
    'aws_route53_health_check', 'aws_lambda_permission_x'],
};
const TYPE_KIND = new Map();
for (const [k, ts] of Object.entries(KINDS)) for (const t of ts) if (!TYPE_KIND.has(t)) TYPE_KIND.set(t, k);
export const kindOf = (type) => TYPE_KIND.get(type) || null;

// property paths: [CloudFormation, Terraform]; a list means "any of these"
const F = {
  'vpc.cidr': ['CidrBlock', 'cidr_block'],
  'subnet.vpc': ['VpcId', 'vpc_id'], 'subnet.cidr': ['CidrBlock', 'cidr_block'], 'subnet.public': ['MapPublicIpOnLaunch', 'map_public_ip_on_launch'],
  'igw.vpc': [null, 'vpc_id'], 'igwAttach.vpc': ['VpcId', 'vpc_id'], 'igwAttach.gw': [['InternetGatewayId', 'VpnGatewayId'], ['internet_gateway_id', 'vpn_gateway_id']],
  'vgw.vpc': [null, 'vpc_id'], 'eigw.vpc': ['VpcId', 'vpc_id'],
  'nat.subnet': ['SubnetId', 'subnet_id'], 'nat.eip': ['AllocationId', 'allocation_id'], 'nat.private': ['ConnectivityType', 'connectivity_type'],
  'rt.vpc': ['VpcId', 'vpc_id'],
  'rt.routes': [null, 'route'],
  'route.rt': ['RouteTableId', 'route_table_id'], 'route.dest': [['DestinationCidrBlock', 'DestinationIpv6CidrBlock'], ['destination_cidr_block', 'destination_ipv6_cidr_block', 'cidr_block', 'ipv6_cidr_block']],
  'route.target': [['GatewayId', 'NatGatewayId', 'TransitGatewayId', 'VpcEndpointId', 'NetworkInterfaceId', 'InstanceId', 'VpcPeeringConnectionId', 'EgressOnlyInternetGatewayId', 'CarrierGatewayId'],
    ['gateway_id', 'nat_gateway_id', 'transit_gateway_id', 'vpc_endpoint_id', 'network_interface_id', 'instance_id', 'vpc_peering_connection_id', 'egress_only_gateway_id', 'carrier_gateway_id']],
  'rtAssoc.subnet': ['SubnetId', 'subnet_id'], 'rtAssoc.rt': ['RouteTableId', 'route_table_id'],
  'sg.ingress': ['SecurityGroupIngress', 'ingress'], 'sg.vpc': ['VpcId', 'vpc_id'],
  'rule.from': ['FromPort', 'from_port'], 'rule.to': ['ToPort', 'to_port'], 'rule.proto': ['IpProtocol', ['protocol', 'ip_protocol']],
  'rule.srcSg': ['SourceSecurityGroupId', ['security_groups', 'source_security_group_id', 'referenced_security_group_id']], 'rule.cidr': [['CidrIp', 'CidrIpv6'], ['cidr_blocks', 'cidr_ipv4', 'ipv6_cidr_blocks', 'cidr_ipv6']],
  'sgIn.group': ['GroupId', 'security_group_id'], 'sgIn.type': [null, 'type'],
  'lb.subnets': [['Subnets', 'SubnetMappings.SubnetId'], ['subnets', 'subnet_mapping.subnet_id']], 'lb.sgs': ['SecurityGroups', 'security_groups'],
  'lb.scheme': ['Scheme', 'internal'], 'lb.type': ['Type', 'load_balancer_type'],
  'clb.subnets': ['Subnets', 'subnets'], 'clb.sgs': ['SecurityGroups', 'security_groups'], 'clb.instances': ['Instances', 'instances'], 'clb.scheme': ['Scheme', 'internal'],
  'listener.lb': ['LoadBalancerArn', 'load_balancer_arn'], 'listener.tgs': [['DefaultActions.TargetGroupArn', 'DefaultActions.ForwardConfig.TargetGroups.TargetGroupArn'], ['default_action.target_group_arn', 'default_action.forward.target_group.arn']],
  'listener.port': ['Port', 'port'], 'listener.proto': ['Protocol', 'protocol'],
  'listenerRule.listener': ['ListenerArn', 'listener_arn'], 'listenerRule.tgs': [['Actions.TargetGroupArn', 'Actions.ForwardConfig.TargetGroups.TargetGroupArn'], ['action.target_group_arn', 'action.forward.target_group.arn']],
  'tg.port': ['Port', 'port'], 'tg.proto': ['Protocol', 'protocol'], 'tg.targets': ['Targets.Id', null], 'tg.type': ['TargetType', 'target_type'],
  'tgAttach.tg': [null, 'target_group_arn'], 'tgAttach.target': [null, 'target_id'],
  'asg.subnets': ['VPCZoneIdentifier', 'vpc_zone_identifier'], 'asg.tgs': ['TargetGroupARNs', 'target_group_arns'], 'asg.lbs': ['LoadBalancerNames', 'load_balancers'],
  'asg.lt': [['LaunchTemplate.LaunchTemplateId', 'LaunchTemplate.LaunchTemplateName', 'MixedInstancesPolicy.LaunchTemplate.LaunchTemplateSpecification.LaunchTemplateId'], ['launch_template.id', 'launch_template.name', 'mixed_instances_policy.launch_template.launch_template_specification.launch_template_id']],
  'asg.lc': ['LaunchConfigurationName', 'launch_configuration'], 'asg.min': ['MinSize', 'min_size'], 'asg.max': ['MaxSize', 'max_size'], 'asg.desired': ['DesiredCapacity', 'desired_capacity'],
  'lt.sgs': [['LaunchTemplateData.SecurityGroupIds', 'LaunchTemplateData.SecurityGroups', 'LaunchTemplateData.NetworkInterfaces.Groups'], ['vpc_security_group_ids', 'security_group_names', 'network_interfaces.security_groups']],
  'lt.profile': [['LaunchTemplateData.IamInstanceProfile.Arn', 'LaunchTemplateData.IamInstanceProfile.Name'], ['iam_instance_profile.arn', 'iam_instance_profile.name']],
  'lc.sgs': ['SecurityGroups', 'security_groups'], 'lc.profile': ['IamInstanceProfile', 'iam_instance_profile'],
  'instance.subnet': [['SubnetId', 'NetworkInterfaces.SubnetId'], ['subnet_id', 'network_interface.subnet_id']],
  'instance.sgs': [['SecurityGroupIds', 'SecurityGroups', 'NetworkInterfaces.GroupSet'], ['vpc_security_group_ids', 'security_groups']],
  'instance.profile': ['IamInstanceProfile', 'iam_instance_profile'], 'instance.az': ['AvailabilityZone', 'availability_zone'],
  'db.subnetGroup': ['DBSubnetGroupName', 'db_subnet_group_name'], 'db.sgs': ['VPCSecurityGroups', 'vpc_security_group_ids'], 'db.multiAz': ['MultiAZ', 'multi_az'],
  'db.az': ['AvailabilityZone', 'availability_zone'], 'db.engine': ['Engine', 'engine'], 'db.cluster': ['DBClusterIdentifier', 'cluster_identifier'], 'db.port': ['Port', 'port'],
  'db.replicaOf': ['SourceDBInstanceIdentifier', 'replicate_source_db'],
  'dbCluster.subnetGroup': ['DBSubnetGroupName', 'db_subnet_group_name'], 'dbCluster.sgs': ['VpcSecurityGroupIds', 'vpc_security_group_ids'], 'dbCluster.engine': ['Engine', 'engine'],
  'dbSubnetGroup.subnets': ['SubnetIds', 'subnet_ids'],
  'cache.subnetGroup': [['CacheSubnetGroupName', 'SubnetGroupName'], ['subnet_group_name']], 'cache.sgs': [['SecurityGroupIds', 'VpcSecurityGroupIds'], ['security_group_ids']],
  'cache.engine': ['Engine', 'engine'], 'cache.multiAz': [['MultiAZEnabled', 'AutomaticFailoverEnabled'], ['multi_az_enabled', 'automatic_failover_enabled']],
  'cache.nodes': [['NumCacheClusters', 'NumNodeGroups', 'NumNodes'], ['num_cache_clusters', 'num_cache_nodes', 'num_node_groups']],
  'cacheSubnetGroup.subnets': ['SubnetIds', 'subnet_ids'],
  'docdb.subnetGroup': ['DBSubnetGroupName', ['db_subnet_group_name', 'neptune_subnet_group_name']], 'docdb.sgs': ['VpcSecurityGroupIds', 'vpc_security_group_ids'],
  'redshift.subnetGroup': ['ClusterSubnetGroupName', 'cluster_subnet_group_name'], 'redshift.sgs': ['VpcSecurityGroupIds', 'vpc_security_group_ids'], 'redshiftSubnetGroup.subnets': ['SubnetIds', 'subnet_ids'],
  'opensearch.subnets': [['VPCOptions.SubnetIds'], ['vpc_options.subnet_ids']], 'opensearch.sgs': [['VPCOptions.SecurityGroupIds'], ['vpc_options.security_group_ids']],
  'msk.subnets': ['BrokerNodeGroupInfo.ClientSubnets', 'broker_node_group_info.client_subnets'], 'msk.sgs': ['BrokerNodeGroupInfo.SecurityGroups', 'broker_node_group_info.security_groups'],
  'mq.subnets': ['SubnetIds', 'subnet_ids'], 'mq.sgs': ['SecurityGroups', 'security_groups'],
  'fn.subnets': ['VpcConfig.SubnetIds', 'vpc_config.subnet_ids'], 'fn.sgs': ['VpcConfig.SecurityGroupIds', 'vpc_config.security_group_ids'], 'fn.role': ['Role', 'role'],
  'fn.env': ['Environment.Variables', 'environment.variables'], 'fn.events': ['Events', null],
  'esm.source': ['EventSourceArn', 'event_source_arn'], 'esm.fn': ['FunctionName', 'function_name'],
  'perm.fn': ['FunctionName', 'function_name'], 'perm.principal': ['Principal', 'principal'], 'perm.source': ['SourceArn', 'source_arn'],
  'fnUrl.fn': ['TargetFunctionArn', 'function_name'],
  'ecsService.subnets': ['NetworkConfiguration.AwsvpcConfiguration.Subnets', 'network_configuration.subnets'], 'ecsService.sgs': ['NetworkConfiguration.AwsvpcConfiguration.SecurityGroups', 'network_configuration.security_groups'],
  'ecsService.tgs': ['LoadBalancers.TargetGroupArn', 'load_balancer.target_group_arn'], 'ecsService.cluster': ['Cluster', 'cluster'], 'ecsService.task': ['TaskDefinition', 'task_definition'],
  'ecsService.launch': ['LaunchType', 'launch_type'], 'ecsService.count': ['DesiredCount', 'desired_count'],
  'ecsTask.role': ['TaskRoleArn', 'task_role_arn'],
  'eks.subnets': ['ResourcesVpcConfig.SubnetIds', 'vpc_config.subnet_ids'], 'eks.sgs': ['ResourcesVpcConfig.SecurityGroupIds', 'vpc_config.security_group_ids'],
  'eksNg.subnets': ['Subnets', 'subnet_ids'], 'eksNg.cluster': ['ClusterName', 'cluster_name'],
  'efsMount.fs': ['FileSystemId', 'file_system_id'], 'efsMount.subnet': ['SubnetId', 'subnet_id'], 'efsMount.sgs': ['SecurityGroups', 'security_groups'],
  'vpce.subnets': ['SubnetIds', 'subnet_ids'], 'vpce.rts': ['RouteTableIds', 'route_table_ids'], 'vpce.type': ['VpcEndpointType', 'vpc_endpoint_type'],
  'vpce.service': ['ServiceName', 'service_name'], 'vpce.vpc': ['VpcId', 'vpc_id'], 'vpce.sgs': ['SecurityGroupIds', 'security_group_ids'],
  'tgwAttach.subnets': ['SubnetIds', 'subnet_ids'], 'tgwAttach.vpc': ['VpcId', 'vpc_id'],
  'rule.targets': ['Targets.Arn', null], 'ruleTarget.rule': [null, 'rule'], 'ruleTarget.arn': [null, 'arn'], 'rule.schedule': ['ScheduleExpression', 'schedule_expression'],
  'schedule.target': ['Target.Arn', 'target.arn'], 'pipe.source': ['Source', 'source'], 'pipe.target': ['Target', 'target'],
  'snsSub.topic': ['TopicArn', 'topic_arn'], 'snsSub.endpoint': ['Endpoint', 'endpoint'], 'topic.subs': ['Subscription.Endpoint', null],
  'bucket.notif': [['NotificationConfiguration.LambdaConfigurations.Function', 'NotificationConfiguration.QueueConfigurations.Queue', 'NotificationConfiguration.TopicConfigurations.Topic'], null],
  'bucket.eventbridge': ['NotificationConfiguration.EventBridgeConfiguration.EventBridgeEnabled', null],
  's3notif.bucket': [null, 'bucket'], 's3notif.targets': [null, ['lambda_function.lambda_function_arn', 'queue.queue_arn', 'topic.topic_arn']],
  'apiMethod.api': ['RestApiId', 'rest_api_id'], 'apiMethod.uri': ['Integration.Uri', 'uri'],
  'restApi.body': ['Body', 'body'],
  'apiV2Int.api': ['ApiId', 'api_id'], 'apiV2Int.uri': ['IntegrationUri', 'integration_uri'], 'apiV2.target': ['Target', 'target'],
  'r53rec.alias': ['AliasTarget.DNSName', 'alias.name'], 'r53rec.name': ['Name', 'name'], 'r53rec.zone': [['HostedZoneId', 'HostedZoneName'], ['zone_id']],
  'r53rec.records': ['ResourceRecords', 'records'], 'r53recGroup.zone': [['HostedZoneId', 'HostedZoneName'], null], 'r53recGroup.sets': ['RecordSets', null],
  'r53zone.name': ['Name', 'name'],
  'cf.origins': ['DistributionConfig.Origins.DomainName', 'origin.domain_name'], 'cf.waf': ['DistributionConfig.WebACLId', 'web_acl_id'],
  'wafAssoc.res': ['ResourceArn', 'resource_arn'], 'wafAssoc.acl': ['WebACLArn', 'web_acl_arn'], 'waf.scope': ['Scope', 'scope'],
  'ga.listeners': [null, null],
  'role.policies': ['Policies.PolicyDocument', 'inline_policy.policy'], 'role.managed': ['ManagedPolicyArns', 'managed_policy_arns'],
  'policy.doc': ['PolicyDocument', 'policy'], 'policy.roles': ['Roles', 'role'],
  'policyAttach.role': [null, 'role'], 'policyAttach.policy': [null, 'policy_arn'],
  'profile.roles': [['Roles'], ['role', 'roles']],
  'sfn.def': [['DefinitionString', 'Definition', 'DefinitionSubstitutions', 'DefinitionUri'], ['definition']], 'sfn.role': ['RoleArn', 'role_arn'],
  'stack.url': ['TemplateURL', null],
};
const pathsOf = (r, f) => { const p = F[f]; if (!p) throw new Error(`iac: unknown field ${f}`); const v = p[r.src === 'tf' ? 1 : 0]; return v == null ? [] : Array.isArray(v) ? v : [v]; };
const vals = (r, f) => pathsOf(r, f).flatMap((p) => r.vals(p));
const refs = (r, f) => [...new Set(pathsOf(r, f).flatMap((p) => r.refs(p)))];
const val = (r, f) => vals(r, f).find((v) => v != null);
const items = (r, f) => pathsOf(r, f).flatMap((p) => r.items(p));
const truthy = (v) => v === true || /^(true|yes|1)$/i.test(String(v));

// ---------------------------------------------------------------------------------------------------
// labels: the official name (CODE-18: author names go in the sub line)
const LABEL = {
  'aws-res-ec2-instance': 'EC2 instance', 'aws-res-ec2-instances': 'EC2 instances', 'aws-res-vpc-nat-gateway': 'NAT gateway', 'aws-res-vpc-internet-gateway': 'Internet gateway',
  'aws-res-simple-storage-service-bucket': 'S3 bucket', 'aws-res-dynamodb-table': 'DynamoDB table', 'aws-res-lambda-function': 'Lambda function',
  'aws-res-eventbridge-rule': 'EventBridge rule', 'aws-res-eventbridge-custom-event-bus': 'EventBridge event bus', 'aws-res-eventbridge-scheduler': 'EventBridge Scheduler',
  'aws-res-eventbridge-pipes': 'EventBridge Pipes', 'aws-res-elastic-container-service-service': 'ECS service', 'aws-res-elastic-container-service-task': 'ECS task',
  'aws-res-cloudwatch-alarm': 'CloudWatch alarm', 'aws-res-cloudwatch-logs': 'CloudWatch Logs', 'aws-res-identity-access-management-role': 'IAM role',
  'aws-res-vpc-endpoints': 'VPC endpoint', 'aws-res-cloudfront-download-distribution': 'CloudFront distribution', 'aws-res-route-53-hosted-zone': 'Route 53 hosted zone',
  'aws-res-elastic-file-system-file-system': 'EFS file system', 'aws-res-elastic-container-registry-registry': 'ECR repository',
  'aws-res-simple-queue-service-queue': 'SQS queue', 'aws-res-simple-notification-service-topic': 'SNS topic', 'aws-res-vpc-vpn-gateway': 'Virtual private gateway',
  'aws-res-transit-gateway-attachment': 'Transit Gateway attachment', 'aws-res-elastic-block-store-volume': 'EBS volume', 'aws-res-systems-manager-parameter-store': 'Parameter Store',
  'aws-res-elasticache-for-redis': 'ElastiCache for Redis', 'aws-res-elasticache-for-valkey': 'ElastiCache for Valkey', 'aws-res-elasticache-for-memcached': 'ElastiCache for Memcached',
  'aws-res-cloudformation-stack': 'CloudFormation stack', 'aws-res-mq-broker': 'Amazon MQ broker', 'aws-res-vpc-elastic-network-interface': 'Network interface',
};
function officialLabel(icon) {
  if (LABEL[icon]) return LABEL[icon];
  const e = iconInfo(icon);
  if (!e) return icon;
  const name = e.short || e.name;
  if (e.kind === 'service') return name;
  if (name.split(/\s+/).length >= 2) return name.replace(/^(Amazon|AWS) (?=Aurora \w+ Instance$)/, '').replace(/ Instance$/, ' instance').replace(/ Gateway$/, ' gateway');
  return name;
}
// an IAM edge's label: one action as written, several as "<service> read|write|read/write"
function actionLabel(acts) {
  if (!acts.length) return null;
  if (acts.length === 1) return acts[0];
  const svc = [...new Set(acts.map((a) => a.split(':')[0]))];
  const kinds = new Set(acts.map((a) => { const v = a.split(':')[1] || ''; return v === '*' ? 'all' : /^(Get|List|Describe|Query|Scan|BatchGet|Receive|Read|Select|Lookup|Head|ConditionCheck|Search|Subscribe)/i.test(v) ? 'read' : 'write'; }));
  const k = kinds.has('all') ? 'full access' : [...kinds].sort().join('/');
  return `${svc.length === 1 ? svc[0] : `${svc[0]} +${svc.length - 1}`} ${k}`;
}
const humanType = (t) => String(t).split('::').pop().replace(/^aws_/, '').replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
const compact = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ellipsis = (s, n = 26) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

// kit-safe ids
export function kitId(s, used, prefix = 'n') {
  let id = String(s).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, '') || prefix;
  if (/^ah/.test(id)) id = prefix + '-' + id;
  let k = id, i = 2;
  while (used && used.has(k)) k = `${id}-${i++}`;
  if (used) used.add(k);
  return k;
}

// ---------------------------------------------------------------------------------------------------
// the flows sidecar: what IaC cannot say (actors, request order, stories, human overrides)
const SIDECAR_KEYS = ['version', '$schema', '_comment', 'diagram', 'name', 'desc', 'region', 'story', 'actors', 'flows', 'stories', 'hide', 'show', 'merge', 'pin', 'group_hints', 'overrides', 'anchors'];
export function normalizeSidecar(raw, issues = []) {
  if (raw == null) return null;
  let s = raw;
  if (typeof s === 'string') { try { s = JSON.parse(s); } catch (err) { throw new Error(`flows sidecar is not valid JSON: ${err.message}`); } }
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('flows sidecar must be a JSON object');
  const say = (m) => issues.push({ severity: 'warn', code: 'sidecar', element: null, message: m });
  for (const k of Object.keys(s)) if (!SIDECAR_KEYS.includes(k)) say(`sidecar key "${k}" is not known (${SIDECAR_KEYS.filter((x) => !/^[$_]/.test(x)).join(', ')}); ignored`);
  const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const out = {
    name: s.name || null, desc: s.desc || null, region: s.region || null, story: s.story || null,
    actors: list(s.actors).filter((a) => a && a.id).map((a) => ({ id: String(a.id), icon: a.icon || 'aws-res-users', label: a.label || null, sub: a.sub || null, side: a.side === 'right' ? 'right' : 'left', to: list(a.to).map(String) })),
    flows: list(s.flows).filter((f) => f && Array.isArray(f.steps)).map((f, i) => ({ id: String(f.id || `flow${i + 1}`), name: f.name || null, dur: Number(f.dur) || null, response: f.response || null, steps: f.steps.filter((x) => x && x.from && x.to).map((x) => ({ from: String(x.from), to: String(x.to), label: x.label != null ? String(x.label) : null, kind: x.kind || null, text: x.text || null })) })),
    stories: list(s.stories).filter((x) => x && x.id && x.template).map((x) => ({ ...x, id: String(x.id) })),
    hide: list(s.hide).map(String), show: list(s.show).map(String),
    merge: obj(s.merge), pin: obj(s.pin), group_hints: obj(s.group_hints), overrides: obj(s.overrides), anchors: obj(s.anchors),
  };
  for (const f of list(s.flows)) if (f && !Array.isArray(f.steps)) say(`flow ${f.id || '?'} has no steps list; ignored`);
  for (const st of out.stories) if (!['az-fail', 'asg-scale'].includes(st.template)) say(`story ${st.id}: template "${st.template}" is not known (az-fail, asg-scale); ignored`);
  out.stories = out.stories.filter((x) => ['az-fail', 'asg-scale'].includes(x.template));
  return out;
}

// ---------------------------------------------------------------------------------------------------
// the import
export function importInfra(resources, ctx, opts = {}) {
  const issues = ctx.issues || [];
  const ledger = ctx.ledger || [];
  const say = (severity, code, element, message) => { if (!issues.some((x) => x.code === code && x.element === element && x.message === message)) issues.push({ severity, code, element, message }); };
  const led = (kind, fact, from = [], extra = {}) => {
    const f = [...new Set((Array.isArray(from) ? from : [from]).filter(Boolean))];
    const hit = ledger.find((x) => x.fact === fact && x.kind === kind);
    if (hit) { for (const k of f) if (!hit.from.includes(k)) hit.from.push(k); return hit; }
    const e = { kind, fact, from: f, ...extra };
    ledger.push(e);
    return e;
  };
  const side = opts.flows ? normalizeSidecar(opts.flows, issues) : null;
  const src = ctx.src;
  const unmapped = [];
  const byKey = new Map(resources.map((r) => [r.key, r]));
  const K = (r) => kindOf(r.type);
  const ofKind = (...ks) => resources.filter((r) => ks.includes(K(r)));
  const name = (key) => (byKey.get(key) ? byKey.get(key).key : key);

  // ---- sidecar names: anchors, CDK paths and aliases resolve to resource keys
  const alias = new Map();
  for (const r of resources) { alias.set(r.key, r.key); for (const a of r.aliases || []) if (!alias.has(a)) alias.set(a, r.key); }
  if (side) for (const [a, m] of Object.entries(side.anchors)) {
    const want = typeof m === 'string' ? [m] : [m && m[src], m && m.cdk, m && m.cfn, m && m.tf].filter(Boolean);
    const key = want.map((w) => alias.get(w)).find(Boolean);
    if (key) { alias.set(a, key); byKey.get(key).anchor = a; } else say('info', 'sidecar', a, `anchor ${a}: no ${src} resource matches ${JSON.stringify(m)}`);
  }
  const keyOf = (x) => alias.get(x) || null;

  // ---- classification: node, group, edge, folded, dropped, meta
  const cls = new Map();   // key -> { as, into?, why }
  const setCls = (key, as, why, into) => { if (!cls.has(key)) cls.set(key, { as, why, into: into || null }); };
  const hidden = new Set(side ? side.hide.map(keyOf).filter(Boolean) : []);
  const shown = new Set(side ? side.show.map(keyOf).filter(Boolean) : []);
  if (side) for (const h of [...side.hide, ...side.show]) if (!keyOf(h)) say('warn', 'sidecar', h, `hide/show names ${h}, which is not a resource in the ${src === 'tf' ? 'plan' : 'template'}`);
  const merged = new Map();   // key -> key it merges into
  if (side) for (const [a, b] of Object.entries(side.merge)) {
    const ka = keyOf(a), kb = keyOf(b);
    if (ka && kb) merged.set(ka, kb); else say('warn', 'sidecar', a, `merge ${a} -> ${b}: ${!ka ? a : b} is not a resource`);
  }
  const into = (key) => { let k = key; for (let i = 0; i < 5 && merged.has(k); i++) k = merged.get(k); return k; };

  for (const r of resources) {
    const k = K(r);
    if (r.helper) { setCls(r.key, 'folded', r.helperWhy || 'CDK helper', r.helperOf || null); continue; }
    if (hidden.has(r.key)) { setCls(r.key, 'dropped', 'hidden by the sidecar'); led('dropped', `${r.key} (${r.type}) is hidden by the sidecar`, r.key, { via: 'sidecar' }); continue; }
    if (merged.has(r.key)) { setCls(r.key, 'folded', `merged into ${merged.get(r.key)} by the sidecar`, merged.get(r.key)); led('derived', `${r.key} is drawn as part of ${merged.get(r.key)} (sidecar merge)`, [r.key, merged.get(r.key)], { via: 'sidecar' }); continue; }
    if (k === 'ops' && !shown.has(r.key)) { setCls(r.key, 'dropped', 'operational'); led('dropped', `${r.key} (${r.type}) is operational, not architecture; not drawn (list it under the sidecar's "show" to draw it)`, r.key); continue; }
    if (['vpc', 'subnet'].includes(k)) { setCls(r.key, 'group', k); continue; }
    if (k === 'asg') { setCls(r.key, 'group', 'asg'); continue; }
    if (['sg', 'sgIn', 'sgOut'].includes(k)) { setCls(r.key, 'edge', 'security group rules become edges'); continue; }
    if (['rt', 'route', 'rtAssoc', 'igwAttach', 'eip'].includes(k)) { setCls(r.key, 'folded', 'routing'); continue; }
    if (['listener', 'listenerRule', 'tg', 'tgAttach'].includes(k)) { setCls(r.key, 'edge', 'load balancer chain'); continue; }
    if (['lt', 'lc', 'profile', 'role', 'policy', 'policyAttach', 'dbSubnetGroup', 'cacheSubnetGroup', 'redshiftSubnetGroup', 'ecsTask', 'efsMount'].includes(k)) { setCls(r.key, 'folded', k); continue; }
    if (['esm', 'perm', 'snsSub', 'ruleTarget', 's3notif', 'apiMethod', 'apiV2Int', 'wafAssoc', 'r53rec', 'r53recGroup', 'fnUrl'].includes(k)) { setCls(r.key, 'edge', k); continue; }
    if (k === 'ecsCluster') { setCls(r.key, 'folded', 'ECS cluster'); continue; }
    if (k === 'dbCluster' && ofKind('db').some((d) => refs(d, 'db.cluster').includes(r.key))) { setCls(r.key, 'folded', 'Aurora cluster drawn as its instances'); continue; }
    // the resolver decides the rest: a node with an icon, a relationship, folded, or not architecture
    const res = resolveIcon(r.type, { from: src, props: propsFor(r) });
    if (res.role === 'meta') { setCls(r.key, 'meta', 'not architecture'); led('dropped', `${r.key} (${r.type}) is not architecture`, r.key); continue; }
    if (res.role === 'edge' || res.role === 'attr') { setCls(r.key, 'folded', res.role === 'edge' ? 'a relationship' : 'an attribute of another resource'); continue; }
    if (res.kind === 'group' && !['ecsCluster', 'eks'].includes(k)) { setCls(r.key, 'folded', `a ${res.group} frame the kit does not draw from IaC`); continue; }
    setCls(r.key, 'node', res.how || 'icon');
  }

  // ---- 1. VPCs, subnets, route tables, subnet kinds
  const vpcs = ofKind('vpc').filter((r) => cls.get(r.key).as === 'group');
  for (const v of vpcs) led('derived', `${v.key} is a VPC${val(v, 'vpc.cidr') ? ` (${val(v, 'vpc.cidr')})` : ''}`, v.key);
  const subnets = new Map();
  const rtOfSubnet = new Map(), rtEvidence = new Map();
  for (const a of ofKind('rtAssoc')) { const s = refs(a, 'rtAssoc.subnet')[0], t = refs(a, 'rtAssoc.rt')[0]; if (s && t) { rtOfSubnet.set(s, t); rtEvidence.set(s, [a.key, t]); } }
  const defaultRoute = new Map();   // rt -> { target, type, evidence }
  const isDefault = (d) => d === '0.0.0.0/0' || d === '::/0';
  for (const rt of ofKind('route')) {
    const dest = vals(rt, 'route.dest'); const t = refs(rt, 'route.target')[0]; const table = refs(rt, 'route.rt')[0];
    if (!table || !dest.some(isDefault)) continue;
    if (!defaultRoute.has(table) || dest.includes('0.0.0.0/0')) defaultRoute.set(table, { target: t || null, evidence: [rt.key, t].filter(Boolean) });
  }
  for (const table of ofKind('rt')) for (const it of items(table, 'rt.routes')) {
    const dest = [...it.vals('cidr_block'), ...it.vals('ipv6_cidr_block')];
    if (!dest.some(isDefault)) continue;
    const t = ['gateway_id', 'nat_gateway_id', 'transit_gateway_id', 'vpc_endpoint_id', 'network_interface_id', 'egress_only_gateway_id'].flatMap((p) => it.refs(p))[0];
    if (!defaultRoute.has(table.key)) defaultRoute.set(table.key, { target: t || null, evidence: [table.key, t].filter(Boolean) });
  }
  const hints = side ? side.group_hints : {};
  for (const s of ofKind('subnet')) {
    if (cls.get(s.key).as !== 'group') continue;
    const vpc = refs(s, 'subnet.vpc')[0] || (vpcs.length === 1 ? vpcs[0].key : null);
    const rt = rtOfSubnet.get(s.key);
    const dr = rt ? defaultRoute.get(rt) : null;
    const tk = dr && dr.target ? K(byKey.get(dr.target) || { type: '' }) : null;
    let kind, how, flavor, egress = null;
    const ev = [s.key, ...(rtEvidence.get(s.key) || []), ...(dr ? dr.evidence : [])];
    if (dr && tk === 'igw') { kind = 'pub'; flavor = 'public'; how = `route table ${rt} sends 0.0.0.0/0 to the internet gateway ${dr.target}`; }
    else if (dr && tk === 'nat') { kind = 'priv'; flavor = 'private with egress'; egress = dr.target; how = `route table ${rt} sends 0.0.0.0/0 to the NAT gateway ${dr.target}`; }
    else if (dr && dr.target) { kind = 'priv'; flavor = 'private'; egress = dr.target; how = `route table ${rt} sends 0.0.0.0/0 to ${dr.target} (${byKey.get(dr.target) ? byKey.get(dr.target).type : 'outside the stack'})`; }
    else if (dr) { kind = 'priv'; flavor = 'private'; how = `route table ${rt} has a default route to a target outside the stack`; }
    else if (rt) { kind = 'iso'; flavor = 'isolated'; how = `route table ${rt} has no default route`; }
    else {
      const t = (s.tags || {})['aws-cdk:subnet-type'];
      if (t) { kind = /public/i.test(t) ? 'pub' : /isolated/i.test(t) ? 'iso' : 'priv'; flavor = kind === 'pub' ? 'public' : kind === 'iso' ? 'isolated' : 'private'; how = `the CDK tag aws-cdk:subnet-type is ${t} (no route table in the ${src === 'tf' ? 'plan' : 'template'})`; }
      else if (truthy(val(s, 'subnet.public'))) { kind = 'pub'; flavor = 'public'; how = 'MapPublicIpOnLaunch is true and no route table is associated (a hint, not proof)'; }
      else { kind = 'priv'; flavor = 'private'; how = 'no route table is associated, so it uses the main route table (not in the stack)'; }
    }
    const hint = hints[s.key] || hints[s.name] || (s.anchor && hints[s.anchor]);
    const hk = hint && (typeof hint === 'string' ? hint : hint.kind);
    let viaSide = false;
    if (hk) { const k2 = { public: 'pub', private: 'priv', isolated: 'iso' }[hk] || hk; if (['pub', 'priv', 'iso'].includes(k2)) { kind = k2; flavor = { pub: 'public', priv: 'private', iso: 'isolated' }[k2]; how = 'the sidecar says so (group_hints)'; viaSide = true; } }
    const assumed = !viaSide && !rt && !(s.tags || {})['aws-cdk:subnet-type'];
    const phrase = { public: 'a public subnet', 'private with egress': 'a private subnet with egress', private: 'a private subnet', isolated: 'an isolated subnet' }[flavor] || `a ${flavor} subnet`;
    const e = led(assumed ? 'assumed' : 'derived', `${s.key} is ${phrase}: ${how}`, ev, assumed ? { ask: `Which route table does ${s.key} use in the deployed VPC?` } : viaSide ? { via: 'sidecar' } : {});
    void e;
    subnets.set(s.key, { key: s.key, r: s, vpc, cidr: val(s, 'subnet.cidr') || null, kind, flavor, egress, rt, az: s.az || null, azPos: null, tier: null });
  }

  // ---- 2. Availability Zone positions ("Availability Zone 1/2", never a/b)
  const azNames = [...new Set([...subnets.values()].map((s) => s.az && s.az.name).filter(Boolean))].sort();
  const azIdx = [...new Set([...subnets.values()].map((s) => s.az && s.az.index).filter((x) => x != null))].sort((a, b) => a - b);
  const azNameOf = new Map();
  for (const s of subnets.values()) {
    const hint = hints[s.key] && typeof hints[s.key] === 'object' ? hints[s.key] : null;
    if (hint && hint.az != null) { s.azPos = Number(String(hint.az).replace(/\D/g, '')) || 1; led('derived', `${s.key} is in Availability Zone ${s.azPos} (sidecar group_hints)`, s.key, { via: 'sidecar' }); continue; }
    if (s.az && s.az.name) { s.azPos = azNames.indexOf(s.az.name) + 1 + azIdx.length; azNameOf.set(s.azPos, s.az.name); led('derived', `${s.key} is in ${s.az.name} (drawn as Availability Zone ${s.azPos})`, s.key); }
    else if (s.az && s.az.index != null) { s.azPos = azIdx.indexOf(s.az.index) + 1; led('derived', `${s.key} sits in AZ position ${s.azPos}: ${s.az.how || `index ${s.az.index}`}, a position, not an AZ name`, s.key); }
  }
  // subnets with no AZ: by their place among their tier's siblings, assumed
  const stem = (s) => {
    const r = s.r;
    const cdkName = (r.tags || {})['aws-cdk:subnet-name'];
    if (cdkName) return cdkName;
    let n = String(r.groupKey || r.key).replace(/\[[^\]]*\]$/, '');
    n = n.replace(/(?:[-_]?(?:az|AZ|Az|zone|Zone)?[-_]?\d{1,2}|(?<=[a-z])[A-F]|[-_][a-fA-F])(?=(?:Subnet|subnet)?$)/, '');
    return n || r.key;
  };
  const tierKey = new Map();
  for (const s of subnets.values()) { s.tier = `${s.kind}:${stem(s)}`; tierKey.set(s.key, s.tier); }
  for (const s of subnets.values()) {
    if (s.azPos != null) continue;
    const sib = [...subnets.values()].filter((x) => x.tier === s.tier);
    s.azPos = sib.indexOf(s) + 1;
    led('assumed', `${s.key} is drawn in Availability Zone ${s.azPos}: the ${src === 'tf' ? 'plan' : 'template'} does not say which AZ it is in`, s.key, { ask: `Which Availability Zone is ${s.key} in?` });
  }
  const azCount = Math.max(0, ...[...subnets.values()].map((s) => s.azPos));
  const subnetAz = (key) => (subnets.get(key) ? subnets.get(key).azPos : null);

  // ---- 3. nodes: placement and replicas
  const nodes = [];   // { nid, key, qual, az, subnet, parent, icon, label, sub, cls, vpcLevel, region, global, frame }
  const nodeIds = new Set();
  const usedIds = new Set(['cloud', 'region']);
  const baseOf = (r) => r.anchor || r.base || r.key;
  const replicasOf = new Map();   // key -> [node]
  const addNode = (r, o) => {
    const nid = kitId(o.nid || baseOf(r), usedIds);
    const n = { nid, key: r.key, r, qual: o.qual || null, az: o.az || null, subnet: o.subnet || null, vpc: o.vpc || null, icon: o.icon, label: o.label, sub: o.sub || null, klass: o.klass || 'other', place: o.place || 'region', frame: o.frame || null, box: o.box || null, standby: o.qual === 'standby' };
    nodes.push(n); nodeIds.add(nid);
    if (!replicasOf.has(r.key)) replicasOf.set(r.key, []);
    replicasOf.get(r.key).push(n);
    return n;
  };
  const subnetsByAz = (keys) => {
    const m = new Map();
    for (const k of keys) { const s = subnets.get(k); if (!s) continue; if (!m.has(s.azPos)) m.set(s.azPos, s.key); }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  };
  const subGroupSubnets = (r, f, groupField) => {
    const g = refs(r, f)[0];
    const gr = g && byKey.get(g);
    return { group: g || null, subnets: gr ? refs(gr, groupField) : [] };
  };
  const KLASS = { lb: 'entry', clb: 'entry', nat: 'nat', vpce: 'entry', instance: 'compute', asg: 'compute', fn: 'compute', ecsService: 'compute', eksNg: 'compute', eks: 'compute', db: 'data', dbCluster: 'data', cache: 'data', docdb: 'data', redshift: 'data', opensearch: 'data', msk: 'data', mq: 'data', efs: 'data' };
  const GLOBAL = new Set(['cf', 'r53zone', 'ga']);
  const officialIcon = (r) => { const res = resolveIcon(r.type, { from: src, props: propsFor(r) }); return res; };
  const subName = (r, label) => {
    const n = r.anchor || r.name || r.key;
    if (!n) return null;
    const c = compact(n), l = compact(label);
    // the type name again ("InternetGateway", "LoadBalancer", "NatGateway1") says nothing the label does not
    if (c === l || l.includes(c) || ((c.startsWith(l) || c.endsWith(l)) && c.length - l.length <= 2)) return null;
    return ellipsis(n);
  };
  const overrides = (key) => (side ? Object.entries(side.overrides).filter(([k]) => keyOf(k.split('@')[0]) === key).map(([k, v]) => ({ q: k.split('@')[1] || null, v })) : []);
  const dataPrimary = new Map();  // key -> az of the primary
  const clusterWriter = new Map(); // an Aurora reader -> its cluster's writer: request edges go to the writer

  // which AZ the sidecar pins a replica to
  const pinOf = (key, qual) => {
    if (!side) return null;
    for (const [k, v] of Object.entries(side.pin)) { const [a, q] = k.split('@'); if (keyOf(a) === key && (q || null) === (qual || null)) return Number(String(v).replace(/\D/g, '')) || null; }
    return null;
  };

  const nodeRes = resources.filter((r) => cls.get(r.key) && cls.get(r.key).as === 'node');
  const asgs = ofKind('asg').filter((r) => cls.get(r.key).as === 'group');
  const frames = [];   // ASG frames: { gid, key, az, subnet, members: [] }
  for (const r of asgs) {
    const sn = refs(r, 'asg.subnets');
    const per = subnetsByAz(sn);
    const min = val(r, 'asg.min'), max = val(r, 'asg.max'), des = val(r, 'asg.desired');
    led('derived', `${r.key} is an Auto Scaling group across ${sn.join(', ') || 'no subnets in the stack'}; drawn as one frame per AZ with one instance each (Min ${min ?? '?'}, Max ${max ?? '?'}, Desired ${des ?? '?'}; the running count is not in the ${src === 'tf' ? 'plan' : 'template'})`, [r.key, ...sn]);
    const icon = 'aws-res-ec2-instance';
    const label = 'EC2 instance';
    const placements = per.length ? per : [[null, null]];
    for (const [az, sk] of placements) {
      const gid = kitId(`${baseOf(r)}${per.length > 1 ? `-az${az}` : ''}-asg`, usedIds);
      const fr = { gid, key: r.key, az, subnet: sk, members: [] };
      frames.push(fr);
      const n = addNode(r, { nid: `${baseOf(r)}${per.length > 1 ? `-az${az}` : ''}`, qual: per.length > 1 ? `az${az}` : null, az, subnet: sk, icon, label, sub: subName(r, label), klass: 'compute', place: sk ? 'subnet' : 'region', frame: gid });
      fr.members.push(n.nid);
    }
  }
  for (const r of nodeRes) {
    const k = K(r);
    const res = officialIcon(r);
    let icon = res.id;
    let box = null;
    if (!icon) {
      const cand = (res.candidates || []).map((c) => c.id);
      box = 'box';
      say('warn', 'unmapped-type', r.key, `no Prism icon for ${r.type}${res.warnings && res.warnings.length ? ` (${res.warnings[0]})` : ''}; drawn as a box${cand.length ? ` (closest: ${cand.slice(0, 3).join(', ')})` : ''}`);
      unmapped.push({ element: r.key, type: r.type, label: r.name || r.key, candidates: cand.slice(0, 3) });
    }
    for (const w of res.warnings || []) if (icon && !/used the default|pass \w+/.test(w)) say('info', 'icon', r.key, w);
    const label0 = icon ? officialLabel(icon) : humanType(r.type);
    let klass = KLASS[k] || 'other';
    // placement
    let sn = [];
    if (k === 'instance') sn = refs(r, 'instance.subnet');
    else if (k === 'lb') sn = refs(r, 'lb.subnets');
    else if (k === 'clb') sn = refs(r, 'clb.subnets');
    else if (k === 'nat') sn = refs(r, 'nat.subnet');
    else if (k === 'fn') sn = refs(r, 'fn.subnets');
    else if (k === 'ecsService') sn = refs(r, 'ecsService.subnets');
    else if (k === 'eks') sn = refs(r, 'eks.subnets');
    else if (k === 'eksNg') sn = refs(r, 'eksNg.subnets');
    else if (k === 'opensearch') sn = refs(r, 'opensearch.subnets');
    else if (k === 'msk') sn = refs(r, 'msk.subnets');
    else if (k === 'mq') sn = refs(r, 'mq.subnets');
    else if (k === 'tgwAttach') sn = refs(r, 'tgwAttach.subnets');
    else if (k === 'vpce') sn = refs(r, 'vpce.subnets');
    else if (k === 'db' || k === 'dbCluster') {
      const own = subGroupSubnets(r, k === 'db' ? 'db.subnetGroup' : 'dbCluster.subnetGroup', 'dbSubnetGroup.subnets');
      sn = own.subnets;
      if (!sn.length && k === 'db') {
        const c = refs(r, 'db.cluster')[0];
        if (c && byKey.get(c)) { const g = subGroupSubnets(byKey.get(c), 'dbCluster.subnetGroup', 'dbSubnetGroup.subnets'); sn = g.subnets; if (g.group) led('derived', `${r.key} is placed through its cluster ${c}'s subnet group ${g.group} (${sn.join(', ')})`, [r.key, c, g.group]); }
      }
      if (own.group) led('derived', `${r.key} is placed through the subnet group ${own.group} (${sn.join(', ')})`, [r.key, own.group]);
    } else if (k === 'cache') sn = subGroupSubnets(r, 'cache.subnetGroup', 'cacheSubnetGroup.subnets').subnets;
    else if (k === 'docdb') sn = subGroupSubnets(r, 'docdb.subnetGroup', 'dbSubnetGroup.subnets').subnets;
    else if (k === 'redshift') sn = subGroupSubnets(r, 'redshift.subnetGroup', 'redshiftSubnetGroup.subnets').subnets;
    else if (k === 'efs') { sn = []; }
    sn = sn.filter((x) => subnets.has(x));
    const per = subnetsByAz(sn);
    const ov = overrides(r.key);
    const mk = (o) => {
      const q = o.qual || null;
      const ovr = Object.assign({}, ...ov.filter((x) => !x.q || x.q === q).map((x) => x.v));
      let ic = icon, bx = box;
      if (ovr.icon) { const rr = iconInfo(ovr.icon) ? { id: iconInfo(ovr.icon).id } : resolveIcon(ovr.icon); if (rr.id) { ic = rr.id; bx = null; } else say('warn', 'sidecar', r.key, `override icon ${ovr.icon} names no Prism icon`); }
      const lab = ovr.label || o.label || (ic ? officialLabel(ic) : label0);
      return addNode(r, { ...o, icon: ic, box: bx, label: lab, sub: ovr.sub !== undefined ? ovr.sub : o.sub !== undefined ? o.sub : subName(r, lab), klass: o.klass || klass });
    };
    const isData = klass === 'data' && k !== 'msk';
    if (k === 'vpce' && !per.length) {
      const vpc = refs(r, 'vpce.vpc')[0] || (vpcs[0] && vpcs[0].key);
      mk({ place: 'vpc', vpc, klass: 'entry' });
      led('derived', `${r.key} is a gateway VPC endpoint (route table targets, no subnet)`, r.key);
      continue;
    }
    if (k === 'igw' || k === 'vgw' || k === 'eigw') {
      const att = ofKind('igwAttach').find((a) => refs(a, 'igwAttach.gw').includes(r.key));
      const vpc = (att && refs(att, 'igwAttach.vpc')[0]) || refs(r, k === 'igw' ? 'igw.vpc' : k === 'vgw' ? 'vgw.vpc' : 'eigw.vpc')[0] || (vpcs.length === 1 ? vpcs[0].key : null);
      mk({ place: vpc ? 'vpc' : 'region', vpc, klass: 'edge' });
      if (vpc) led('derived', `${r.key} is attached to ${vpc}`, [r.key, att && att.key, vpc]);
      continue;
    }
    if (GLOBAL.has(k) || (k === 'waf' && /cloudfront/i.test(String(val(r, 'waf.scope') || '')))) { mk({ place: 'global', klass: 'edge' }); continue; }
    if (!per.length) {
      if (sn.length === 0 && ['instance', 'lb', 'nat', 'db', 'cache', 'docdb'].includes(k) && subnets.size) say('info', 'placement', r.key, `${r.key}: no subnet in the ${src === 'tf' ? 'plan' : 'template'} places it; drawn outside the VPC`);
      mk({ place: 'region', klass: klass === 'compute' || klass === 'data' ? klass : 'region' });
      continue;
    }
    if (isData) {
      // a database: the primary in one AZ, a standby (Multi-AZ) in another; the template rarely says which
      const multi = k === 'db' ? truthy(val(r, 'db.multiAz')) : k === 'cache' ? truthy(val(r, 'cache.multiAz')) : false;
      const cluster = k === 'db' ? refs(r, 'db.cluster')[0] : null;
      const azs = per.map(([az]) => az);
      const pinned = pinOf(r.key, 'primary') || pinOf(r.key, null);
      const lit = k === 'db' ? val(r, 'db.az') : null;
      let pAz = pinned || azs[0];
      if (cluster) {
        const sibs = ofKind('db').filter((d) => refs(d, 'db.cluster')[0] === cluster && cls.get(d.key).as === 'node');
        const i = sibs.indexOf(r);
        pAz = pinned || azs[i % azs.length];
        const role = i === 0 ? 'writer' : 'reader';
        if (i > 0) clusterWriter.set(r.key, sibs[0].key);
        const sk = per.find(([az]) => az === pAz)[1];
        const lab = `Aurora ${role}`;
        mk({ qual: role, az: pAz, subnet: sk, place: 'subnet', label: lab });
        led(pinned ? 'derived' : 'assumed', `${r.key} is an instance of the cluster ${cluster}, drawn as the ${role} in Availability Zone ${pAz}${pinned ? ' (sidecar pin)' : ''}`, [r.key, cluster], pinned ? { via: 'sidecar' } : { ask: `Which instance of ${cluster} is the writer, and in which AZ?` });
        continue;
      }
      const sk = per.find(([az]) => az === pAz)[1];
      const base = baseOf(r);
      const cn = r.cond ? r.cond(pathsOf(r, k === 'db' ? 'db.multiAz' : 'cache.multiAz')[0]) : null;
      const evidence = [r.key, ...((cn && cn.from) || [])];
      if (multi && azs.length > 1) {
        const sAz = azs.find((a) => a !== pAz);
        const ssk = per.find(([az]) => az === sAz)[1];
        const svc = k === 'db' ? 'RDS' : 'ElastiCache';
        mk({ nid: `${base}-primary`, qual: 'primary', az: pAz, subnet: sk, place: 'subnet', label: `${svc} primary` });
        const sb = mk({ nid: `${base}-standby`, qual: 'standby', az: sAz, subnet: ssk, place: 'subnet', label: `${svc} ${k === 'db' ? 'standby' : 'replica'}` });
        if (k === 'db' && res.standby) sb.icon = res.standby;
        dataPrimary.set(r.key, pAz);
        const how = (cn && cn.how) || `${k === 'db' ? 'MultiAZ' : 'MultiAZEnabled'} is true`;
        led(cn && cn.assumed ? 'assumed' : 'derived', `${r.key} is Multi-AZ: ${how}`, evidence, cn && cn.assumed ? { ask: cn.ask || `Is ${r.key} Multi-AZ in the deployed stack?` } : cn && cn.via ? { via: cn.via } : {});
        led(pinned ? 'derived' : 'assumed', `${r.key}'s primary is drawn in Availability Zone ${pAz} and the ${k === 'db' ? 'standby' : 'replica'} in Availability Zone ${sAz}${pinned ? ' (sidecar pin)' : `: the ${src === 'tf' ? 'plan' : 'template'} never says which AZ holds the primary; ${svc} picks it at deploy time`}`, r.key, pinned ? { via: 'sidecar' } : { ask: `Which AZ holds ${r.key}'s primary today?` });
      } else {
        const z = lit && subnets.size ? pAz : pAz;
        mk({ az: z, subnet: per.find(([az]) => az === z)[1], place: 'subnet' });
        if (multi === false && (cn || val(r, 'db.multiAz') != null)) led(cn && cn.assumed ? 'assumed' : 'derived', `${r.key} is single-AZ: ${(cn && cn.how) || 'MultiAZ is false'}`, evidence, cn && cn.assumed ? { ask: cn.ask || `Is ${r.key} single-AZ in the deployed stack?` } : {});
        if (azs.length > 1 && !pinned) led('assumed', `${r.key} is drawn in Availability Zone ${z}; its subnets span ${azs.length} AZs and the ${src === 'tf' ? 'plan' : 'template'} does not say which one it runs in`, r.key, { ask: `Which AZ does ${r.key} run in?` });
      }
      continue;
    }
    // one replica per AZ (the kit's convention for a load balancer, an ASG, a VPC Lambda function...)
    if (per.length > 1) {
      led('derived', `${r.key} spans ${per.map(([, s]) => s).join(', ')}: drawn once per Availability Zone`, [r.key, ...per.map(([, s]) => s)]);
      for (const [az, sk] of per) mk({ nid: `${baseOf(r)}-az${az}`, qual: `az${az}`, az, subnet: sk, place: 'subnet' });
    } else {
      const [az, sk] = per[0];
      mk({ az, subnet: sk, place: 'subnet' });
      if (['nat', 'instance'].includes(k)) led('derived', `${r.key} is in ${sk} (Availability Zone ${az})`, [r.key, sk]);
    }
  }

  // ---- 4. edges
  const edges = [];   // { a: key|nid, b, kind, label, evidence, aNode?, bNode?, weak, dashed }
  const addEdge = (a, b, o) => {
    a = into(a); b = into(b);
    if (o.kind === 'traffic' && clusterWriter.has(b)) { o = { ...o, fact: o.fact ? `${o.fact} (drawn to the writer ${clusterWriter.get(b)}: readers serve the cluster's reader endpoint)` : o.fact, evidence: [...(o.evidence || []), b] }; b = clusterWriter.get(b); }
    if (!a || !b || a === b) return null;
    const ex = edges.find((e) => e.a === a && e.b === b && (e.kind === o.kind || (e.kind === 'traffic' && o.kind === 'iam')));
    if (ex) { if (o.label && !ex.label) ex.label = o.label; ex.evidence = [...new Set([...ex.evidence, ...(o.evidence || [])])]; return ex; }
    if (o.kind === 'iam' && edges.some((e) => ((e.a === a && e.b === b) || (e.a === b && e.b === a)) && e.kind !== 'iam')) return null;
    const e = { a, b, kind: o.kind, label: o.label || null, evidence: o.evidence || [], fact: o.fact || null, ledgerKind: o.ledgerKind || 'derived', ask: o.ask || null };
    edges.push(e);
    return e;
  };
  const drawn = (key) => replicasOf.has(into(key)) || frames.some((f) => f.key === into(key));
  // users of a security group: the drawn resources that carry it (through launch templates for an ASG)
  const sgUsers = new Map();
  const addUser = (sg, key, via) => { if (!sgUsers.has(sg)) sgUsers.set(sg, []); if (!sgUsers.get(sg).some((u) => u.key === key)) sgUsers.get(sg).push({ key, via }); };
  for (const r of resources) {
    const k = K(r);
    const field = { instance: 'instance.sgs', lb: 'lb.sgs', clb: 'clb.sgs', db: 'db.sgs', dbCluster: 'dbCluster.sgs', cache: 'cache.sgs', fn: 'fn.sgs', ecsService: 'ecsService.sgs', vpce: 'vpce.sgs', opensearch: 'opensearch.sgs', msk: 'msk.sgs', mq: 'mq.sgs', redshift: 'redshift.sgs', docdb: 'docdb.sgs', eks: 'eks.sgs', efsMount: 'efsMount.sgs' }[k];
    if (field) for (const sg of refs(r, field)) {
      if (k === 'efsMount') { const fs = refs(r, 'efsMount.fs')[0]; if (fs) addUser(sg, fs, [r.key]); }
      else if (k === 'dbCluster') { const inst = ofKind('db').filter((d) => refs(d, 'db.cluster')[0] === r.key); for (const d of inst) addUser(sg, d.key, [r.key]); if (!inst.length) addUser(sg, r.key, []); }
      else addUser(sg, r.key, []);
    }
    if (k === 'lt' || k === 'lc') for (const sg of refs(r, k === 'lt' ? 'lt.sgs' : 'lc.sgs')) for (const a of asgs) if (refs(a, k === 'lt' ? 'asg.lt' : 'asg.lc').includes(r.key)) addUser(sg, a.key, [r.key]);
  }
  const portLabel = (from, to, proto) => {
    if (proto === '-1' || proto === -1 || proto === 'all') return 'all traffic';
    if (from == null) return null;
    return from === to || to == null ? `:${from}` : `:${from}-${to}`;
  };
  const sgRules = [];   // { target sg, source sg | null, cidr, label, evidence }
  for (const sg of ofKind('sg')) for (const it of items(sg, 'sg.ingress')) {
    const from = it.vals(src === 'tf' ? 'from_port' : 'FromPort')[0], to = it.vals(src === 'tf' ? 'to_port' : 'ToPort')[0], proto = it.vals(src === 'tf' ? 'protocol' : 'IpProtocol')[0];
    const srcs = src === 'tf' ? it.refs('security_groups') : it.refs('SourceSecurityGroupId');
    const cidr = src === 'tf' ? it.vals('cidr_blocks') : it.vals('CidrIp');
    for (const s of srcs) sgRules.push({ sg: sg.key, from: s, label: portLabel(from, to, proto), evidence: [sg.key, s] });
    for (const c of cidr) sgRules.push({ sg: sg.key, cidr: c, label: portLabel(from, to, proto), evidence: [sg.key] });
  }
  for (const r of ofKind('sgIn')) {
    if (src === 'tf' && r.type === 'aws_security_group_rule' && val(r, 'sgIn.type') !== 'ingress') continue;
    const sg = refs(r, 'sgIn.group')[0]; if (!sg) continue;
    const from = val(r, 'rule.from'), to = val(r, 'rule.to'), proto = val(r, 'rule.proto');
    for (const s of refs(r, 'rule.srcSg')) sgRules.push({ sg, from: s, label: portLabel(from, to, proto), evidence: [r.key, sg, s] });
    for (const c of vals(r, 'rule.cidr')) sgRules.push({ sg, cidr: c, label: portLabel(from, to, proto), evidence: [r.key, sg] });
  }
  for (const rule of sgRules) {
    if (!rule.from) continue;
    for (const s of sgUsers.get(rule.from) || []) for (const t of sgUsers.get(rule.sg) || []) {
      if (!drawn(s.key) || !drawn(t.key)) continue;
      const e = addEdge(s.key, t.key, { kind: 'traffic', label: rule.label, evidence: [...rule.evidence, ...s.via, ...t.via, s.key, t.key] });
      if (e && !e.fact) e.fact = `${s.key} reaches ${t.key}${rule.label ? ` on ${rule.label}` : ''}: ${rule.sg} allows ingress from ${rule.from}${s.via.length ? ` (${s.key} carries ${rule.from} through ${s.via.join(', ')})` : ''}`;
    }
  }
  // load balancer -> target group -> targets
  const lbOfListener = new Map(), tgsOfLb = new Map();
  for (const l of ofKind('listener')) {
    const lb = refs(l, 'listener.lb')[0]; if (!lb) continue;
    lbOfListener.set(l.key, lb);
    for (const tg of refs(l, 'listener.tgs')) { if (!tgsOfLb.has(lb)) tgsOfLb.set(lb, []); tgsOfLb.get(lb).push({ tg, via: [l.key] }); }
  }
  for (const lr of ofKind('listenerRule')) {
    const l = refs(lr, 'listenerRule.listener')[0], lb = l && lbOfListener.get(l); if (!lb) continue;
    for (const tg of refs(lr, 'listenerRule.tgs')) { if (!tgsOfLb.has(lb)) tgsOfLb.set(lb, []); tgsOfLb.get(lb).push({ tg, via: [l, lr.key] }); }
  }
  const targetsOfTg = new Map();
  const addTarget = (tg, key, via) => { if (!targetsOfTg.has(tg)) targetsOfTg.set(tg, []); targetsOfTg.get(tg).push({ key, via }); };
  for (const a of asgs) for (const tg of refs(a, 'asg.tgs')) addTarget(tg, a.key, []);
  for (const s of ofKind('ecsService')) for (const tg of refs(s, 'ecsService.tgs')) addTarget(tg, s.key, []);
  for (const tg of ofKind('tg')) for (const t of refs(tg, 'tg.targets')) addTarget(tg.key, t, []);
  for (const at of ofKind('tgAttach')) { const tg = refs(at, 'tgAttach.tg')[0], t = refs(at, 'tgAttach.target')[0]; if (tg && t) addTarget(tg, t, [at.key]); }
  for (const [lb, list] of tgsOfLb) for (const { tg, via } of list) for (const t of targetsOfTg.get(tg) || []) {
    if (!drawn(lb) || !drawn(t.key)) continue;
    const tgr = byKey.get(tg);
    const port = tgr && val(tgr, 'tg.port');
    const e = addEdge(lb, t.key, { kind: 'traffic', label: port != null ? `:${port}` : null, evidence: [lb, ...via, tg, ...t.via, t.key] });
    if (e) e.fact = `${lb} forwards to ${t.key}${port != null ? ` on :${port}` : ''}: listener ${via.join(' > ')} > target group ${tg} > ${t.key}`;
  }
  for (const c of ofKind('clb')) for (const t of refs(c, 'clb.instances')) addEdge(c.key, t, { kind: 'traffic', evidence: [c.key, t], fact: `${c.key} balances ${t}` });
  for (const a of asgs) for (const c of refs(a, 'asg.lbs')) addEdge(c, a.key, { kind: 'traffic', evidence: [c, a.key], fact: `${c} balances ${a.key}` });
  // internet-facing load balancers reach the internet through the internet gateway of their public subnets
  const entries = [];   // { key (node resource or synthetic), label, evidence }
  for (const lb of ofKind('lb', 'clb')) {
    if (!drawn(lb.key)) continue;
    const sch = val(lb, K(lb) === 'lb' ? 'lb.scheme' : 'clb.scheme');
    const internal = src === 'tf' ? truthy(sch) : /internal/i.test(String(sch || ''));
    if (internal) { led('derived', `${lb.key} is internal (Scheme internal)`, lb.key); continue; }
    const sn = refs(lb, K(lb) === 'lb' ? 'lb.subnets' : 'clb.subnets').map((x) => subnets.get(x)).filter(Boolean);
    const igws = [...new Set(sn.filter((s) => s.kind === 'pub').map((s) => defaultRoute.get(s.rt) && defaultRoute.get(s.rt).target).filter(Boolean))];
    const listeners = ofKind('listener').filter((l) => refs(l, 'listener.lb')[0] === lb.key);
    const lab = listeners.map((l) => `${val(l, 'listener.proto') || ''} :${val(l, 'listener.port') ?? ''}`.trim()).filter((x) => /:\d/.test(x)).join(', ') || null;
    const cidrRule = sgRules.find((x) => x.cidr && (sgUsers.get(x.sg) || []).some((u) => u.key === lb.key) && /^0\.0\.0\.0\/0$|^::\/0$/.test(x.cidr));
    if (igws.length && drawn(igws[0])) {
      addEdge(igws[0], lb.key, { kind: 'traffic', evidence: [lb.key, igws[0], ...sn.map((s) => s.key)], fact: `${lb.key} is internet-facing${sch == null ? ' (the default Scheme)' : ''} in public subnets: traffic from the internet enters through ${igws[0]}` });
      entries.push({ key: igws[0], label: lab, evidence: [lb.key, ...listeners.map((l) => l.key), cidrRule && cidrRule.evidence[0]].filter(Boolean) });
    } else entries.push({ key: lb.key, label: lab, evidence: [lb.key, ...listeners.map((l) => l.key)] });
    if (cidrRule) led('derived', `${lb.key} accepts ${cidrRule.label || 'traffic'} from ${cidrRule.cidr}`, cidrRule.evidence);
  }
  // DNS aliases
  const zoneNodes = new Map();
  const recs = [...ofKind('r53rec').map((r) => ({ r, items: [r], zoneF: 'r53rec.zone' })), ...ofKind('r53recGroup').map((r) => ({ r, items: items(r, 'r53recGroup.sets'), zoneF: 'r53recGroup.zone' }))];
  for (const { r, items: its, zoneF } of recs) {
    if (!cls.get(r.key) || cls.get(r.key).as === 'dropped') continue;
    for (const it of its) {
      const targets = (it === r ? refs(r, 'r53rec.alias') : it.refs('AliasTarget.DNSName')).filter(drawn);
      if (!targets.length) continue;
      const zoneRef = (it === r ? refs(r, zoneF) : refs(r, zoneF))[0];
      const zoneLit = it === r ? val(r, zoneF) : val(r, zoneF);
      const recName = it === r ? val(r, 'r53rec.name') : it.vals('Name')[0];
      let zkey = zoneRef && drawn(zoneRef) ? zoneRef : null;
      if (!zkey) {
        const rn = String(recName || '').replace(/\.$/, '');
        const zn = (typeof zoneLit === 'string' && /\./.test(zoneLit) ? zoneLit : rn.split('.').length > 2 ? rn.split('.').slice(1).join('.') : rn || 'zone').replace(/\.$/, '');
        if (!zoneNodes.has(zn)) {
          const fake = { key: `zone:${zn}`, type: 'AWS::Route53::HostedZone', src, base: `dns-${zn}`, name: zn, aliases: [], vals: () => [], refs: () => [], items: () => [], tags: {} };
          byKey.set(fake.key, fake);
          addNode(fake, { nid: kitId(`Route53-${zn.split('.')[0]}`), icon: 'aws-svc-route-53', label: 'Amazon Route 53', sub: ellipsis(zn), place: 'global', klass: 'edge' });
          zoneNodes.set(zn, fake.key);
          led('derived', `DNS records for ${zn} live in Route 53 (the hosted zone is outside the stack; drawn as Amazon Route 53)`, r.key);
        }
        zkey = zoneNodes.get(zn);
      }
      for (const t of targets) addEdge(zkey, t, { kind: 'dns', label: recName ? ellipsis(String(recName).replace(/\.$/, ''), 22) : 'alias', evidence: [r.key, t], fact: `${recName || 'a record'} is a DNS alias for ${t}` });
    }
  }
  // CloudFront origins, WAF
  for (const c of ofKind('cf')) {
    for (const o of refs(c, 'cf.origins')) if (drawn(o)) addEdge(c.key, o, { kind: 'traffic', evidence: [c.key, o], fact: `${c.key} uses ${o} as an origin` });
    for (const w of refs(c, 'cf.waf')) if (drawn(w)) addEdge(w, c.key, { kind: 'assoc', evidence: [c.key, w], fact: `${w} protects ${c.key}` });
  }
  for (const a of ofKind('wafAssoc')) { const w = refs(a, 'wafAssoc.acl')[0], t = refs(a, 'wafAssoc.res')[0]; if (w && t && drawn(w) && drawn(t)) addEdge(w, t, { kind: 'assoc', evidence: [a.key, w, t], fact: `${w} protects ${t}` }); }
  // event sources (asynchronous: dashed)
  const ev = (a, b, via, what) => { if (drawn(a) && drawn(b)) addEdge(a, b, { kind: 'async', evidence: [via, a, b].flat(), fact: `${a} ${what} ${b}` }); };
  for (const m of ofKind('esm')) { const s = refs(m, 'esm.source')[0], f = refs(m, 'esm.fn')[0]; if (s && f) ev(s, f, m.key, 'feeds (event source mapping)'); }
  for (const rr of ofKind('rule')) for (const t of refs(rr, 'rule.targets')) ev(rr.key, t, rr.key, 'targets');
  for (const t of ofKind('ruleTarget')) { const rr = refs(t, 'ruleTarget.rule')[0], a = refs(t, 'ruleTarget.arn')[0]; if (rr && a) ev(rr, a, t.key, 'targets'); }
  for (const s of ofKind('snsSub')) { const tp = refs(s, 'snsSub.topic')[0], e = refs(s, 'snsSub.endpoint')[0]; if (tp && e) ev(tp, e, s.key, 'delivers to'); }
  for (const tp of ofKind('topic')) for (const e of refs(tp, 'topic.subs')) ev(tp.key, e, tp.key, 'delivers to');
  for (const b of ofKind('bucket')) for (const t of refs(b, 'bucket.notif')) ev(b.key, t, b.key, 'notifies');
  for (const n of ofKind('s3notif')) { const b = refs(n, 's3notif.bucket')[0]; for (const t of refs(n, 's3notif.targets')) if (b) ev(b, t, n.key, 'notifies'); }
  for (const p of ofKind('pipe')) { const s = refs(p, 'pipe.source')[0], t = refs(p, 'pipe.target')[0]; if (s) ev(s, p.key, p.key, 'feeds'); if (t) ev(p.key, t, p.key, 'targets'); }
  for (const s of ofKind('schedule')) for (const t of refs(s, 'schedule.target')) ev(s.key, t, s.key, 'invokes');
  // API Gateway integrations, Step Functions tasks (synchronous: solid)
  const call = (a, b, via, what) => { if (drawn(a) && drawn(b)) addEdge(a, b, { kind: 'traffic', evidence: [via, a, b].flat(), fact: `${a} ${what} ${b}` }); };
  for (const m of ofKind('apiMethod')) { const api = refs(m, 'apiMethod.api')[0]; for (const t of refs(m, 'apiMethod.uri')) if (api) call(api, t, m.key, 'integrates with'); }
  for (const a of ofKind('restApi')) for (const t of refs(a, 'restApi.body')) call(a.key, t, a.key, 'integrates with (OpenAPI body)');
  for (const i of ofKind('apiV2Int')) { const api = refs(i, 'apiV2Int.api')[0]; for (const t of refs(i, 'apiV2Int.uri')) if (api) call(api, t, i.key, 'integrates with'); }
  for (const a of ofKind('apiV2')) for (const t of refs(a, 'apiV2.target')) call(a.key, t, a.key, 'integrates with (quick create)');
  for (const s of ofKind('sfn')) for (const t of refs(s, 'sfn.def')) if (t !== s.key && K(byKey.get(t) || { type: '' }) !== 'role') call(s.key, t, s.key, 'invokes');
  // Lambda permissions: a source the template grants (S3, SNS, EventBridge, API Gateway) when nothing else linked them
  for (const p of ofKind('perm')) {
    const f = refs(p, 'perm.fn')[0], s = refs(p, 'perm.source')[0];
    if (!f || !s || !drawn(f) || !drawn(s)) continue;
    if (edges.some((e) => (e.a === into(s) && e.b === into(f)) || (e.a === into(f) && e.b === into(s)))) { for (const e of edges) if (e.a === into(s) && e.b === into(f)) e.evidence.push(p.key); continue; }
    const pr = String(val(p, 'perm.principal') || '');
    call(s, f, p.key, /apigateway/.test(pr) ? 'may invoke (Lambda permission)' : 'may invoke (Lambda permission)');
    const e = edges.find((x) => x.a === into(s) && x.b === into(f));
    if (e && !/apigateway|elasticloadbalancing/.test(pr)) e.kind = 'async';
  }
  // IAM: resource ARNs in a role's policies, as weak dashed edges from what assumes the role
  const roleUsers = new Map();
  const addRoleUser = (role, key, via) => { if (!role) return; if (!roleUsers.has(role)) roleUsers.set(role, []); roleUsers.get(role).push({ key, via }); };
  const profileRoles = (p) => { const pr = byKey.get(p); return pr ? refs(pr, 'profile.roles') : []; };
  for (const f of ofKind('fn')) for (const role of refs(f, 'fn.role')) addRoleUser(role, f.key, []);
  for (const s of ofKind('sfn')) for (const role of refs(s, 'sfn.role')) addRoleUser(role, s.key, []);
  for (const i of ofKind('instance')) for (const p of refs(i, 'instance.profile')) for (const role of profileRoles(p)) addRoleUser(role, i.key, [p]);
  for (const a of asgs) {
    for (const lt of refs(a, 'asg.lt')) { const l = byKey.get(lt); if (l) for (const p of refs(l, 'lt.profile')) for (const role of profileRoles(p)) addRoleUser(role, a.key, [lt, p]); }
    for (const lc of refs(a, 'asg.lc')) { const l = byKey.get(lc); if (l) for (const p of refs(l, 'lc.profile')) for (const role of profileRoles(p)) addRoleUser(role, a.key, [lc, p]); }
  }
  for (const s of ofKind('ecsService')) for (const td of refs(s, 'ecsService.task')) { const t = byKey.get(td); if (t) for (const role of refs(t, 'ecsTask.role')) addRoleUser(role, s.key, [td]); }
  const docsOf = (role) => {
    const out = [];
    const rr = byKey.get(role);
    if (rr) {
      for (const it of items(rr, 'role.policies')) out.push({ it, via: role });
      for (const mp of refs(rr, 'role.managed')) { const m = byKey.get(mp); if (m) for (const it of items(m, 'policy.doc')) out.push({ it, via: mp }); }
    }
    for (const p of ofKind('policy')) if (refs(p, 'policy.roles').includes(role)) for (const it of items(p, 'policy.doc')) out.push({ it, via: p.key });
    for (const a of ofKind('policyAttach')) if (refs(a, 'policyAttach.role').includes(role)) for (const pk of refs(a, 'policyAttach.policy')) { const p = byKey.get(pk); if (p) for (const it of items(p, 'policy.doc')) out.push({ it, via: pk }); }
    return out;
  };
  for (const [role, users] of roleUsers) {
    const grants = new Map();   // target -> { actions:Set, via:Set }
    for (const { it, via } of docsOf(role)) {
      const stmts = it.items('Statement');
      const list = stmts.length ? stmts : [it];
      for (const st of list) {
        if (/deny/i.test(String(st.vals('Effect')[0] || 'Allow'))) continue;
        const acts = [...st.vals('Action'), ...st.vals('NotAction')].flat().map(String);
        for (const t of [...new Set([...st.refs('Resource'), ...(list === stmts ? [] : it.refs())])]) {
          if (t === role || !drawn(t)) continue;
          if (!grants.has(t)) grants.set(t, { actions: new Set(), via: new Set() });
          for (const a of acts) grants.get(t).actions.add(a);
          grants.get(t).via.add(via);
        }
      }
    }
    // one weak edge per role and target, from the first resource that assumes the role; the ledger names them all
    for (const [t, g] of grants) {
      const us = users.filter((u) => drawn(u.key) && into(u.key) !== into(t));
      if (!us.length) continue;
      const u = us[0];
      const acts = [...g.actions];
      const label = actionLabel(acts);
      const others = us.slice(1).map((x) => x.key);
      addEdge(u.key, t, { kind: 'iam', label, evidence: [...us.flatMap((x) => [x.key, ...x.via]), role, ...g.via, t], fact: `${u.key}${others.length ? ` (and ${others.join(', ')}, same role)` : ''} may call ${t}${acts.length ? ` (${acts.slice(0, 4).join(', ')}${acts.length > 4 ? '...' : ''})` : ''}: ${role}'s policy names ${t}'s ARN${u.via.length ? ` (${u.key} > ${u.via.join(' > ')} > ${role})` : ''}; a weak edge, an ARN in a policy does not prove traffic`, ledgerKind: 'derived' });
    }
  }
  // private egress through the NAT gateway of the subnet's route table
  for (const s of subnets.values()) if (s.egress && K(byKey.get(s.egress) || { type: '' }) === 'nat' && drawn(s.egress)) {
    addEdge(`subnet:${s.key}`, s.egress, { kind: 'egress', label: 'egress', evidence: [s.key, s.rt, s.egress], fact: `${s.key} reaches the internet through ${s.egress} (its default route)` });
    const nat = (replicasOf.get(s.egress) || [])[0];
    if (nat && nat.az != null && s.azPos != null && nat.az !== s.azPos) led('derived', `${s.key} (Availability Zone ${s.azPos}) sends its internet traffic to ${s.egress} in Availability Zone ${nat.az}: if that AZ fails, ${s.key} loses egress (one NAT gateway per AZ avoids it)`, [s.key, s.rt, s.egress], { ask: `Is a single NAT gateway for ${s.key}'s AZ intended (cost) or should each AZ have its own?` });
  }

  // ---- 5. actors: the sidecar's, else Users at the internet-facing entry (assumed)
  const actorNodes = [];
  const actorOf = new Map();
  const mkActor = (a, assumed) => {
    const fake = { key: `actor:${a.id}`, type: 'actor', src, base: a.id, name: a.label || a.id, aliases: [a.id], vals: () => [], refs: () => [], items: () => [], tags: {} };
    byKey.set(fake.key, fake); alias.set(a.id, fake.key);
    const ic = iconInfo(a.icon) ? iconInfo(a.icon).id : resolveIcon(a.icon || 'users').id || 'aws-res-users';
    const n = addNode(fake, { nid: a.id, icon: ic, label: a.label || officialLabel(ic), sub: a.sub || null, place: a.side === 'right' ? 'actor-right' : 'actor', klass: 'actor' });
    actorNodes.push(n); actorOf.set(a.id, n);
    if (!assumed) led('derived', `${a.id} is an actor outside the stack (the sidecar declares it)`, [], { via: 'sidecar' });
    return n;
  };
  // entries that nothing else feeds: CloudFront, API Gateway, AppSync, the IGW in front of a load balancer
  for (const r of resources) {
    const k = K(r);
    if (!drawn(r.key) || !['cf', 'restApi', 'apiV2', 'appsync', 'ga'].includes(k)) continue;
    if (edges.some((e) => e.b === r.key && e.kind === 'traffic')) continue;
    entries.push({ key: r.key, label: 'HTTPS', evidence: [r.key] });
  }
  const fed = new Set(edges.filter((e) => e.kind === 'traffic').map((e) => e.b));
  const entryList = entries.filter((e, i) => entries.findIndex((x) => x.key === e.key) === i && !(fed.has(e.key) && K(byKey.get(e.key) || { type: '' }) !== 'igw'));
  if (side && side.actors.length) for (const a of side.actors) {
    const n = mkActor(a, false);
    for (const t of a.to) { const k = keyOf(t.split('@')[0]); if (k) addEdge(n.key, k, { kind: 'traffic', evidence: [], fact: `${a.id} uses ${t} (sidecar)`, ledgerKind: 'derived', via: 'sidecar' }); }
  } else if (entryList.length) {
    const u = mkActor({ id: 'Users', icon: 'aws-res-users', label: 'Users' }, true);
    for (const en of entryList) {
      const e = addEdge(u.key, en.key, { kind: 'traffic', label: en.label, evidence: en.evidence });
      if (e) { e.ledgerKind = 'assumed'; e.fact = `Users reach ${en.key} from the internet${en.label ? ` (${en.label})` : ''}: no client is in the ${src === 'tf' ? 'plan' : 'template'}, so the actor is assumed`; e.ask = 'Who are the clients (browsers, mobile apps, partners) and how do they reach the stack (DNS, CDN, WAF)?'; }
    }
  }

  // ---- 6. the sidecar's flows: resolve refs, add the wires a step needs
  const resolveRef = (ref) => {
    const [a, q0] = String(ref).split('@');
    const q = q0 ? q0.toLowerCase() : null;
    const key = actorOf.has(a) ? `actor:${a}` : keyOf(a) ? into(keyOf(a)) : null;
    if (!key) return { error: `${ref} names nothing in the ${src === 'tf' ? 'plan' : 'template'} or the sidecar's actors` };
    let reps = replicasOf.get(key) || [];
    if (!reps.length) return { error: `${ref}: ${key} is not drawn (${(cls.get(key) || {}).as || 'unknown'}${(cls.get(key) || {}).why ? `: ${cls.get(key).why}` : ''})` };
    if (q) {
      const m = /^az(\d+)$/.exec(q);
      const hit = m ? reps.find((n) => n.az === Number(m[1])) : reps.find((n) => n.qual === q);
      if (hit) return { node: hit };
      return { error: `${ref}: ${key} has no ${q} replica (it has ${reps.map((n) => n.qual || 'one node').join(', ')})` };
    }
    if (reps.length > 1) { const pick = reps.find((n) => n.qual === 'primary' || n.qual === 'writer') || reps[0]; return { node: pick, note: `${ref} is drawn ${reps.length} times; used ${pick.nid} (qualify it, e.g. ${a}@az1)` }; }
    return { node: reps[0] };
  };
  const nodeEdges = [];   // edges between drawn nodes (after replica expansion), filled below
  const flowSteps = [];   // { flow, steps: [{ a: nid, b: nid, label, kind, text }] }
  const flowsWanted = side ? side.flows : [];

  // ---- 7. replica expansion: one edge per pair of drawn nodes
  const nodesOf = (key) => (key.startsWith('subnet:') ? [{ subnetFrame: key.slice(7) }] : replicasOf.get(key) || []);
  const wireOf = new Map();   // "nidA>nidB" -> wire
  let wn = 0;
  const addWire = (A, B, e, extra = {}) => {
    const a = A.subnetFrame ? `subnet:${A.subnetFrame}` : A.nid, b = B.nid;
    const k = `${a}>${b}`;
    if (wireOf.has(k)) return wireOf.get(k);
    const w = { id: `w${++wn}`, a, b, kind: e.kind, label: e.label, edge: e, ...extra };
    wireOf.set(k, w); nodeEdges.push(w);
    return w;
  };
  for (const e of edges) {
    const S = nodesOf(e.a), T = nodesOf(e.b);
    if (!S.length || !T.length) continue;
    if (e.kind === 'egress') { const s = subnets.get(e.a.slice(7)); const t = T.find((n) => n.az === s.azPos) || T[0]; addWire(S[0], t, e); continue; }
    const perAz = (L) => L.length > 1 && L.every((n) => n.qual && /^az\d+$/.test(n.qual));
    if (e.kind === 'iam' || e.kind === 'assoc' || e.kind === 'dns') { addWire(S[0], T.find((n) => n.qual === 'primary' || n.qual === 'writer') || T[0], e); continue; }
    if (perAz(S) && perAz(T)) { for (const s of S) { const t = T.find((n) => n.az === s.az); if (t) addWire(s, t, e); else addWire(s, T[0], e); } continue; }
    const tPrimary = T.find((n) => n.qual === 'primary' || n.qual === 'writer');
    if (tPrimary) { for (const s of S) addWire(s, tPrimary, e); continue; }
    if (perAz(S) && T.length === 1 && T[0].az != null && S.some((n) => n.az === T[0].az)) { addWire(S.find((n) => n.az === T[0].az), T[0], e); continue; }
    if (perAz(T) && S.length === 1 && S[0].az != null && T.some((n) => n.az === S[0].az)) { addWire(S[0], T.find((n) => n.az === S[0].az), e); continue; }
    if (S.length === 1 && T.length > 1) { for (const t of T) if (!t.standby) addWire(S[0], t, e); continue; }
    for (const s of S) for (const t of T.length > 1 ? T.filter((t) => t.az === s.az).concat(T.some((t) => t.az === s.az) ? [] : [T[0]]) : T) addWire(s, t, e);
  }
  // Multi-AZ replication, primary to standby
  for (const [key, reps] of replicasOf) {
    const p = reps.find((n) => n.qual === 'primary'), s = reps.find((n) => n.qual === 'standby');
    if (p && s) addWire(p, s, { kind: 'replication', label: null, evidence: [key], fact: null });
  }
  // sidecar steps: resolve, find (or add) the wire
  const usedFlow = [];
  for (const f of flowsWanted) {
    const steps = [];
    for (const st of f.steps) {
      const A = resolveRef(st.from), B = resolveRef(st.to);
      if (A.error || B.error) { say('warn', 'sidecar', `${f.id}`, `flow ${f.id}: step ${st.from} -> ${st.to}: ${A.error || B.error}; skipped`); continue; }
      for (const x of [A, B]) if (x.note) say('info', 'sidecar', f.id, `flow ${f.id}: ${x.note}`);
      let w = wireOf.get(`${A.node.nid}>${B.node.nid}`), reverse = false;
      if (!w) { w = wireOf.get(`${B.node.nid}>${A.node.nid}`); reverse = !!w; }
      if (!w) {
        w = addWire(A.node, B.node, { kind: st.kind === 'async' ? 'async' : st.kind === 'replication' ? 'replication' : 'traffic', label: null, evidence: [], fact: null }, { sidecar: true });
        led('derived', `${st.from} > ${st.to}${st.label ? ` (${st.label})` : ''} is a hop the sidecar's flow ${f.id} adds: the ${src === 'tf' ? 'plan' : 'template'} has no edge for it`, [A.node.key, B.node.key].filter((k) => !k.startsWith('actor:') && !k.startsWith('zone:')), { via: 'sidecar' });
      }
      if (st.label && !reverse) w.label = st.label;
      // a request step on a weak IAM edge: the sidecar confirms the traffic (an async step keeps it dashed)
      if (w.kind === 'iam') {
        w.kind = st.kind === 'async' ? 'async' : 'traffic';
        if (w.edge && w.edge.fact) w.edge.fact = w.edge.fact.replace(/; a weak edge, an ARN in a policy does not prove traffic$/, `; the sidecar's flow ${f.id} confirms the traffic`);
        if (w.edge) w.edge.via = 'sidecar';
      }
      steps.push({ wire: w, reverse, a: A.node, b: B.node, kind: st.kind, text: st.text, label: st.label, from: st.from, to: st.to });
    }
    flowSteps.push({ flow: f, steps });
  }

  // the story to tell: a sidecar flow or story, a guess, or none
  const want = opts.story || (side && side.story) || 'auto';
  let chosen = null, storyTpl = null;
  const flowById = new Map(flowSteps.map((f) => [f.flow.id, f]));
  if (want !== 'none') {
    if (side && side.stories.some((s) => s.id === want)) { storyTpl = side.stories.find((s) => s.id === want); chosen = flowById.get(storyTpl.flow) || flowSteps[0] || null; }
    else if (flowById.has(want)) chosen = flowById.get(want);
    else if (want === 'auto' && flowSteps.length) chosen = flowSteps[0];
    else if (want !== 'auto' && want !== 'guess') say('warn', 'story', want, `story ${want}: no flow or story with that id in the sidecar${side ? ` (flows: ${side.flows.map((f) => f.id).join(', ') || 'none'}; stories: ${side.stories.map((s) => s.id).join(', ') || 'none'})` : ''}; drawn without animation`);
  }
  const guess = want === 'guess';
  // az-fail: the same request again through the surviving AZ, the standby promoted; a hop the failover needs
  // (the app in the other AZ to the promoted standby) gets its wire now, before layout
  let failover = null;
  const failAz = storyTpl && storyTpl.template === 'az-fail' ? Number(String(storyTpl.az || 'az1').replace(/\D/g, '')) || 1 : null;
  if (failAz && chosen) {
    const alt = (node) => {
      if (!node || node.az !== failAz) return node;
      const reps = replicasOf.get(node.key) || [];
      if (node.qual === 'primary') return reps.find((x) => x.qual === 'standby') || null;
      return reps.find((x) => x.az !== failAz && !x.standby && x.qual !== 'primary') || reps.find((x) => x.az !== failAz) || null;
    };
    failover = { flow: chosen.flow, steps: [] };
    for (const st of chosen.steps) {
      if (st.kind === 'replication') continue;
      const a = alt(st.a), b = alt(st.b);
      if (!a || !b) { say('info', 'story', storyTpl.id, `story ${storyTpl.id}: ${st.from} > ${st.to} has no replica outside Availability Zone ${failAz}; the failover pass skips it`); continue; }
      let w = wireOf.get(`${a.nid}>${b.nid}`), reverse = false;
      if (!w) { w = wireOf.get(`${b.nid}>${a.nid}`); reverse = !!w; }
      if (!w) {
        w = addWire(a, b, { kind: st.wire.kind === 'async' ? 'async' : 'traffic', label: null, evidence: [], fact: null }, { sidecar: true });
        w.label = st.wire.label || null;
        led('derived', `story ${storyTpl.id}: after Availability Zone ${failAz} fails, ${a.label}${a.sub ? ` (${a.sub})` : ''} reaches ${b.label}${b.qual === 'standby' ? ' (promoted)' : ''}: a wire only the failover draws`, [a.key, b.key].filter((k) => !k.startsWith('actor:')), { via: 'sidecar' });
      }
      failover.steps.push({ ...st, a, b, wire: w, reverse });
    }
  } else if (storyTpl && storyTpl.template === 'az-fail') say('warn', 'story', storyTpl.id, `story ${storyTpl.id}: az-fail needs a flow to replay (the sidecar has none)`);

  // ---- 8. ledger lines for edges, then every resource accounted for
  for (const e of edges) {
    if (!e.fact) continue;
    if (!nodeEdges.some((w) => w.edge === e)) continue;
    led(e.ledgerKind, e.fact, e.evidence.filter((k) => byKey.has(k) && !String(k).startsWith('actor:') && !String(k).startsWith('zone:')), e.ask ? { ask: e.ask } : e.via ? { via: e.via } : {});
  }
  // a folded resource names the drawn resource that references it (an EIP its NAT gateway, a launch
  // template its Auto Scaling group)
  for (const r of resources) {
    const c = cls.get(r.key);
    if (!c || c.as !== 'folded' || c.into) continue;
    const user = resources.find((u) => u.key !== r.key && (drawn(u.key) || (cls.get(u.key) || {}).as === 'group') && u.refs().includes(r.key));
    if (user) c.into = user.key;
  }
  const mentioned = new Set(ledger.flatMap((l) => l.from));
  for (const r of resources) {
    if (mentioned.has(r.key)) continue;
    const c = cls.get(r.key) || { as: 'dropped', why: 'unclassified' };
    if (c.as === 'node') led('derived', `${r.key} is drawn as ${officialIconLabel(r)}`, r.key);
    else if (c.as === 'group') led('derived', `${r.key} (${r.type}) is drawn as a frame`, r.key);
    else if (c.as === 'folded' && c.into) led('derived', `${r.key} (${r.type}) is folded into ${c.into}: ${c.why}`, [r.key, c.into]);
    else led('dropped', `${r.key} (${r.type}) adds nothing the diagram draws (${c.why}${c.as === 'edge' ? '; no edge between drawn resources came from it' : ''})`, r.key);
  }

  // ---- 9. the IR
  const ir = newIr(src);
  ir.dir = 'LR';
  ir.title = side && side.name || opts.name || ctx.title || null;
  const regionLabel = (side && side.region) || opts.region || ctx.region || (azNameOf.size ? [...azNameOf.values()][0].replace(/[a-z]$/, '') : null);
  const anyRegion = nodes.some((n) => n.place !== 'actor' && n.place !== 'actor-right' && n.place !== 'global') || vpcs.length;
  ir.groups.push({ id: 'cloud', kind: 'cloud', label: null, parent: null });
  if (anyRegion) ir.groups.push({ id: 'region', kind: 'region', label: regionLabel, parent: 'cloud' });
  const gid = new Map();   // resource key -> group id
  const multiVpc = vpcs.length > 1;
  for (const v of vpcs) {
    const g = kitId(baseOf(v), usedIds);
    gid.set(v.key, g);
    const cidr = val(v, 'vpc.cidr');
    ir.groups.push({ id: g, kind: 'vpc', label: null, note: cidr || null, parent: 'region' });
  }
  const azGroup = new Map();   // `${vpc}|${az}` -> group id
  const sortedSubnets = [...subnets.values()].sort((a, b) => a.azPos - b.azPos);
  for (const s of sortedSubnets) {
    const vg = gid.get(s.vpc) || (vpcs[0] && gid.get(vpcs[0].key));
    if (!vg) continue;
    const ak = `${s.vpc}|${s.azPos}`;
    if (!azGroup.has(ak)) {
      const id = kitId(multiVpc ? `${vg}-az${s.azPos}` : `az${s.azPos}`, usedIds);
      azGroup.set(ak, id);
      ir.groups.push({ id, kind: 'az', label: `Availability Zone ${s.azPos}`, note: azNameOf.get(s.azPos) || null, parent: vg });
    }
  }
  for (const s of sortedSubnets) {
    const parent = azGroup.get(`${s.vpc}|${s.azPos}`);
    if (!parent) continue;
    const g = kitId(baseOf(s.r), usedIds);
    gid.set(s.key, g);
    ir.groups.push({ id: g, kind: s.kind === 'pub' ? 'pub' : 'priv', label: s.kind === 'iso' ? 'Isolated subnet' : null, note: s.cidr || null, parent });
  }
  for (const fr of frames) ir.groups.push({ id: fr.gid, kind: 'asg', label: null, parent: fr.subnet ? gid.get(fr.subnet) : 'region' });
  if (subnets.size && [...subnets.values()].some((s) => s.kind === 'iso')) say('info', 'kit-gap', null, 'the kit has no isolated-subnet frame: isolated subnets are drawn as private subnet frames titled "Isolated subnet"');
  for (const n of nodes) {
    let parent;
    if (n.frame) parent = n.frame;
    else if (n.place === 'subnet') parent = gid.get(n.subnet);
    else if (n.place === 'vpc') parent = gid.get(n.vpc) || (vpcs[0] && gid.get(vpcs[0].key));
    else if (n.place === 'global') parent = 'cloud';
    else if (n.place === 'actor' || n.place === 'actor-right') parent = null;
    else parent = anyRegion ? 'region' : 'cloud';
    n.parent = parent || null;
    const N = { id: n.nid, label: n.label, sub: n.sub, parent: n.parent };
    // a short last word would dangle on its own line ("Amazon Route" / "53"): keep the label on one line
    { const w = wrapWords(n.label || '', 14); if (w.length === 2 && w[1].length <= 3 && n.label.length <= 18) N.wrap = n.label.length; }
    if (n.icon) N.icon = n.icon; else { N.icon = null; N.shapeHint = 'box'; }
    ir.nodes.push(N);
    if (!n.icon) ir.directives.icon[n.nid] = 'box';
  }
  // placeholders: subnets of one AZ get the same height
  for (const w of nodeEdges) {
    const e = { id: w.id, a: w.a.startsWith('subnet:') ? gid.get(w.a.slice(7)) : w.a, b: w.b, aHead: false, bHead: true, dashed: ['async', 'iam', 'egress', 'replication', 'dns', 'assoc'].includes(w.kind), label: w.label || null, src: w.id };
    if (w.kind === 'replication') {
      ir.directives.peer.push([w.a, w.b]);
      // primary to standby straight down (or up) between the AZ rows
      const A = nodes.find((n) => n.nid === w.a), Bn = nodes.find((n) => n.nid === w.b);
      if (A && Bn && A.az != null && Bn.az != null && A.az !== Bn.az) { e.sa = A.az < Bn.az ? 'B' : 'T'; e.sb = A.az < Bn.az ? 'T' : 'B'; }
    }
    ir.edges.push(e);
  }

  // ---- 10. the story's clock
  const plan = { channel: 'none', hops: [], reply: false, texts: new Map() };
  ir.directives.dur = failover ? Math.min(20, Math.max(14, (chosen.flow.dur || 10) * 1.6)) : (chosen && chosen.flow.dur) || null;

  // asg-scale adds instance slots before layout
  const appearing = [];
  if (storyTpl && storyTpl.template === 'asg-scale') {
    const ak = keyOf(storyTpl.asg);
    const frs = frames.filter((f) => f.key === ak);
    if (!frs.length) say('warn', 'story', storyTpl.id, `story ${storyTpl.id}: ${storyTpl.asg} is not an Auto Scaling group in the ${src === 'tf' ? 'plan' : 'template'}`);
    else {
      const r = byKey.get(ak);
      const from = Number(storyTpl.from ?? val(r, 'asg.min') ?? frs.length), to = Number(storyTpl.to ?? val(r, 'asg.max') ?? from * 2);
      const perAz = (x) => Math.max(1, Math.ceil(x / frs.length));
      const have = perAz(from), need = Math.min(4, perAz(to));
      frs.forEach((fr) => {
        for (let i = have; i < need; i++) {
          const nid = kitId(`${fr.members[0]}-${i + 1}`, usedIds);
          fr.members.push(nid);
          ir.nodes.push({ id: nid, icon: 'aws-res-ec2-instance', label: 'EC2 instance', sub: null, parent: fr.gid });
          nodes.push({ nid, key: ak, r, qual: `${fr.members[0]}-${i + 1}`, az: fr.az, subnet: fr.subnet, icon: 'aws-res-ec2-instance', label: 'EC2 instance', klass: 'compute', place: 'subnet', frame: fr.gid, parent: fr.gid, extra: true });
          appearing.push(nid);
        }
      });
      led('derived', `story ${storyTpl.id}: ${ak} scales from ${from} to ${to} instances (${need} per AZ drawn; the new ones appear, ghosted when idle)`, [ak], { via: 'sidecar' });
    }
  }

  // ---- 11. layout: the AZ-row archetype when there is a VPC, else the shared layered layout (a serverless chain)
  const nodeByNid = new Map(nodes.map((n) => [n.nid, n]));
  const cellsFn = subnets.size || nodes.some((n) => n.place === 'vpc') ? (model) => azRowCells(model, { nodes, nodeByNid, subnets, frames, gid, sortedSubnets, nodeEdges, vpcs, clusterWriter }) : null;

  const planFn = (model) => {
    const edgeOf = new Map(model.edges.map((e) => [e.src, e]));
    const P = { channel: 'none', hops: [], reply: false, texts: new Map() };
    const hop = (w, reverse, extra) => {
      const e = edgeOf.get(w.id);
      if (!e) return null;
      const from = reverse ? e.b : e.a, to = reverse ? e.a : e.b;
      return { wire: e.id, reverse, ring: model.nodes.has(to) && !model.nodes.get(to).junction ? to : undefined, back: model.nodes.has(from) ? from : undefined, from, to, edge: e, ...extra };
    };
    const runFlow = (fs, suffix = '') => {
      const req = [];
      let n = 0;
      for (const st of fs.steps) {
        const k = st.kind === 'replication' || st.kind === 'response' ? 'pk-2' : st.kind === 'bad' ? 'pk-bad' : undefined;
        const numbered = !(st.kind === 'replication' || st.kind === 'response');
        const h = hop(st.wire, st.reverse, { kind: k, step: numbered ? ++n : false });
        if (!h) continue;
        P.hops.push(h);
        if (numbered) {
          req.push(h);
          const nm = (x) => x.label + (x.sub ? ` (${x.sub})` : '');
          P.texts.set(String(n) + suffix, st.text || `${nm(st.a)} to ${nm(st.b)}${st.label ? ` on ${st.label}` : ''}.`);
        }
      }
      if (fs.flow.response === 'reverse') for (const h of [...req].reverse()) P.hops.push({ ...h, reverse: !h.reverse, ring: h.back, back: h.ring, kind: 'pk-2', step: false });
      return n;
    };
    if (chosen) {
      P.channel = 'sidecar';
      runFlow(chosen);
      if (failover) {
        // the same flow again through the surviving AZ, after the failure
        P.failSplit = P.hops.length;
        const before = P.hops.length;
        runFlow(failover, 'b');
        // the second pass repeats the numbers; it is the same request after the failover
        for (const h of P.hops.slice(before)) h.step = false;
        P.failAz = failAz;
        P.failHops = P.hops.slice(before).map((h) => h.wire);
      }
    } else if (guess) {
      P.channel = 'bfs';
      const entry = actorNodes[0] ? actorNodes[0].nid : [...model.nodes.keys()].find((id) => model.edges.some((e) => e.a === id) && !model.edges.some((e) => e.b === id));
      if (entry) {
        const seen = new Set([entry]), q = [entry];
        let n = 0;
        while (q.length && n < 12) {
          const u = q.shift();
          for (const e of model.edges) {
            if (e.dashed || e.a !== u || seen.has(e.b)) continue;
            const nb = nodeByNid.get(e.b);
            // one representative path: the first AZ's replica of a resource drawn per AZ
            if (nb && nb.az && nb.az > 1 && (replicasOf.get(nb.key) || []).some((x) => x.az === 1)) continue;
            seen.add(e.b); q.push(e.b);
            P.hops.push(hop({ id: e.src }, false, { step: ++n }));
            const A = nodeByNid.get(e.a), B = nodeByNid.get(e.b);
            P.texts.set(String(n), `${A ? A.label : e.a} to ${B ? B.label : e.b}${e.label ? ` on ${e.label.replace(/\n/g, ' ')}` : ''}.`);
          }
        }
        P.hops = P.hops.filter(Boolean);
        for (const h of [...P.hops].reverse()) P.hops.push({ ...h, reverse: true, ring: h.back, back: h.ring, kind: 'pk-2', step: false });
        if (P.hops.length) irIssue(ir, 'info', 'story-guess', entry, `no sidecar flow: packets follow a breadth-first guess from ${entry} along the solid edges (first AZ only); write a flows sidecar to set the order`);
      }
    }
    P.hops = P.hops.filter(Boolean);
    plan.channel = P.channel; plan.hops = P.hops; plan.failAz = P.failAz; plan.failHops = P.failHops; plan.failSplit = P.failSplit;
    return P;
  };

  const desc = (side && side.desc) || ctx.desc || null;
  if (desc) ir.directives.desc = desc;
  const id = opts.id;
  const { spec, report } = buildSpec(ir, { id, name: (side && side.name) || opts.name || ctx.title || null, story: 'auto', plan: planFn, cells: cellsFn, width: opts.width });
  spec.name = (side && side.name) || opts.name || ctx.title || spec.name;
  if (!desc) spec.desc = genDesc(spec, ctx, plan, side, chosen, storyTpl, guess);

  // ---- 12. after layout: flow styling, story effects
  const wireKind = new Map(nodeEdges.map((w) => [w.id, w.kind]));
  for (const w of spec.wires) if (wireKind.get(w.id) === 'replication') w.flow = true;
  if (storyTpl && storyTpl.template === 'az-fail' && plan.failSplit != null && spec.timeline) {
    const failAz = plan.failAz;
    const azG = [...azGroup.entries()].find(([k]) => Number(k.split('|')[1]) === failAz);
    const t0 = spec.timeline[plan.failSplit - 1] ? spec.timeline[plan.failSplit - 1].t[1] : 0.45;
    const t1 = spec.timeline[plan.failSplit] ? spec.timeline[plan.failSplit].t[0] : t0 + 0.02;
    const a = Math.min(0.9, Math.round((t0 + 0.005) * 1000) / 1000), b = 0.97;
    spec.effects = spec.effects || [];
    if (azG) spec.effects.push({ fail: azG[1], t: [a, b] });
    const inAz = new Set(nodes.filter((n) => n.az === failAz).map((n) => n.nid));
    for (const w of spec.wires) if ((inAz.has(w.from) || inAz.has(w.to)) && wireKind.get(w.id) !== 'egress') spec.effects.push({ fade: w.id, t: [a, b] });
    for (const wid of new Set(plan.failHops || [])) if (!spec.effects.some((e) => e.fade === wid)) spec.effects.push({ glow: wid, t: [Math.max(a, Math.round(t1 * 1000) / 1000), b] });
    if (azG) led('derived', `story ${storyTpl.id}: Availability Zone ${failAz} fails; the request runs again through the other AZ${storyTpl.promote ? ` and ${storyTpl.promote} is promoted` : ''}`, [], { via: 'sidecar' });
  }
  if (appearing.length && spec.timeline) {
    spec.effects = spec.effects || [];
    for (const nid of appearing) spec.effects.push({ appear: nid, t: [0.3, 0.9], ghost: true });
  } else if (appearing.length) {
    spec.effects = spec.effects || [];
    for (const nid of appearing) spec.effects.push({ appear: nid, t: [0.3, 0.9], ghost: true });
  }
  if (!spec.effects || !spec.effects.length) delete spec.effects;
  // the kit's checks again, after the post-layout edits
  const issuesOut = report.issues.filter((x) => x.code !== 'spec' && x.code !== 'schema');
  try { checkSpec(spec); } catch (err) { issuesOut.push({ severity: 'error', code: 'spec', element: spec.id, message: String(err.message || err) }); }
  for (const e of validateDiagram(spec)) issuesOut.push({ severity: 'error', code: 'schema', element: e.path, message: e.message });
  const lintOut = lintSpec(spec);
  for (const f of lintOut.filter((x) => x.severity === 'error')) issuesOut.push({ severity: 'error', code: `lint:${f.code}`, element: spec.id, message: f.message });
  for (const x of issues) if (!issuesOut.some((y) => y.code === x.code && y.element === x.element && y.message === x.message)) issuesOut.push(x);
  const resourcesOut = resources.map((r) => { const c = cls.get(r.key) || { as: 'dropped' }; const reps = replicasOf.get(r.key) || []; return { key: r.key, type: r.type, as: c.as, ...(c.into ? { into: c.into } : {}), ...(reps.length ? { nodes: reps.map((n) => n.nid) } : {}), ...(frames.some((f) => f.key === r.key) ? { frames: frames.filter((f) => f.key === r.key).map((f) => f.gid) } : {}), ...(gid.has(r.key) ? { group: gid.get(r.key) } : {}) }; });
  const order = { derived: 0, assumed: 1, dropped: 2 };
  ledger.sort((a, b) => order[a.kind] - order[b.kind]);
  // CDK's hashed logical ids read as their construct paths in the text (the from lists keep the exact ids)
  const disp = new Map(resources.filter((r) => r.display && r.display !== r.key).map((r) => [r.key, r.display]));
  if (disp.size) {
    const re = new RegExp([...disp.keys()].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    const tr = (t) => (typeof t === 'string' ? t.replace(re, (k) => disp.get(k)) : t);
    for (const l of ledger) { l.fact = tr(l.fact); if (l.ask) l.ask = tr(l.ask); }
    for (const x of issuesOut) x.message = tr(x.message);
  }
  return {
    spec,
    report: {
      from: src, issues: issuesOut, unmapped, ledger,
      tile: report.tile, lint: lintOut,
      story: { channel: plan.channel, flow: chosen ? chosen.flow.id : null, template: storyTpl ? storyTpl.id : null, legs: (spec.timeline || []).length, steps: (spec.steps || []).length, available: side ? [...side.flows.map((f) => f.id), ...side.stories.map((s) => s.id)] : [] },
      resources: resourcesOut,
      counts: { resources: resources.length, drawn: resourcesOut.filter((r) => r.as === 'node' || r.as === 'group').length, nodes: spec.nodes.length, groups: spec.groups.length, wires: spec.wires.length },
      icons: report.icons,
    },
  };

  function officialIconLabel(r) { const reps = replicasOf.get(r.key) || []; return reps.length ? `${reps[0].label}${reps.length > 1 ? ` (${reps.length} nodes)` : ''}` : r.type; }
  function propsFor(r) {
    const k = K(r);
    const p = {};
    if (k === 'lb') { const t = val(r, 'lb.type'); if (t != null) p[src === 'tf' ? 'load_balancer_type' : 'Type'] = t; }
    if (k === 'db') { const e = val(r, 'db.engine') || (refs(r, 'db.cluster')[0] && byKey.get(refs(r, 'db.cluster')[0]) && val(byKey.get(refs(r, 'db.cluster')[0]), 'dbCluster.engine')); if (e != null) p[src === 'tf' ? 'engine' : 'Engine'] = e; const m = val(r, 'db.multiAz'); if (m != null) p[src === 'tf' ? 'multi_az' : 'MultiAZ'] = m; }
    if (k === 'dbCluster' || k === 'cache') { const e = val(r, k === 'cache' ? 'cache.engine' : 'dbCluster.engine'); if (e != null) p[src === 'tf' ? 'engine' : 'Engine'] = e; }
    if (/FSx/.test(r.type) || /fsx/.test(r.type)) { const t = r.vals('FileSystemType')[0]; if (t) p.FileSystemType = t; }
    return p;
  }
}
function genDesc(spec, ctx, plan, side, chosen, storyTpl, guess) {
  const what = ctx.src === 'tf' ? 'a Terraform plan' : 'a CloudFormation template';
  const n = spec.nodes.length, g = spec.groups.length;
  const base = `Imported from ${what}${ctx.title ? ` (${ctx.title})` : ''}: ${n} services in ${g} frames, placed from the subnets, route tables and Availability Zones the source declares.`;
  if (chosen && storyTpl && storyTpl.template === 'az-fail') return `${base} Packets follow the sidecar's ${chosen.flow.name || chosen.flow.id} flow, then Availability Zone ${plan.failAz} fails and the same request runs through the other AZ.`;
  if (chosen) return `${base} Packets follow the sidecar's ${chosen.flow.name || chosen.flow.id} flow${chosen.flow.response === 'reverse' ? ', and responses return the same way' : ''}.`;
  if (guess && plan.hops.length) return `${base} Packets follow a guessed request path from the internet-facing entry; the source has no request order.`;
  return `${base} No animation: IaC has no request order (add a flows sidecar).`;
}

// ---------------------------------------------------------------------------------------------------
// the AZ-row archetype: Availability Zones as rows, tiers as columns (public, private app, private data),
// VPC-level gateways on the VPC's left edge, regional services beside the VPC, actors outside the cloud
function azRowCells(model, ctx) {
  const { nodes, nodeByNid, subnets, frames, gid, sortedSubnets, nodeEdges, vpcs, clusterWriter } = ctx;
  const cells = new Map();
  const real = [...model.nodes.values()].filter((n) => !n.junction);
  const info = (id) => nodeByNid.get(id);
  // traffic graph depth (solid edges), for the order of columns inside a subnet tier and outside the VPC
  const solid = model.edges.filter((e) => !e.dashed && model.nodes.has(e.a) && model.nodes.has(e.b));
  const depth = new Map();
  const preds = new Map(real.map((n) => [n.id, []]));
  for (const e of solid) if (preds.has(e.b)) preds.get(e.b).push(e.a);
  const D = (id, seen = new Set()) => { if (depth.has(id)) return depth.get(id); if (seen.has(id)) return 0; seen.add(id); const p = preds.get(id) || []; const d = p.length ? Math.max(...p.map((x) => D(x, seen))) + 1 : 0; depth.set(id, d); return d; };
  for (const n of real) D(n.id);
  // replicas of one resource share a column (a standby has no traffic edges of its own)
  const byRes = new Map();
  const resOf = (x) => (clusterWriter && clusterWriter.get(x.key)) || x.key;   // an Aurora reader goes with its writer
  for (const n of real) { const x = info(n.id); if (x) byRes.set(resOf(x), Math.max(byRes.get(resOf(x)) ?? 0, depth.get(n.id) || 0)); }
  for (const n of real) { const x = info(n.id); if (x && byRes.has(resOf(x))) depth.set(n.id, byRes.get(resOf(x))); }
  const KR = { nat: 0, entry: 0, compute: 1, data: 2, other: 1, edge: 0, region: 1 };
  // tiers: subnet tier keys ordered public, private, isolated, then first appearance
  const tierOrder = [];
  for (const s of sortedSubnets) if (!tierOrder.includes(s.tier)) tierOrder.push(s.tier);
  const kRank = { pub: 0, priv: 1, iso: 2 };
  tierOrder.sort((a, b) => kRank[a.split(':')[0]] - kRank[b.split(':')[0]] || tierOrder.indexOf(a) - tierOrder.indexOf(b));
  // columns inside each tier: (class rank, depth among that class)
  const inTier = new Map(tierOrder.map((t) => [t, []]));
  for (const n of real) { const x = info(n.id); if (x && x.subnet && subnets.get(x.subnet)) inTier.get(subnets.get(x.subnet).tier).push(n.id); }
  const colKey = (id) => { const x = info(id); return `${KR[x.klass] ?? 1}`; };
  let col = 0;
  const colOf = new Map();
  const actorsL = real.filter((n) => info(n.id) && info(n.id).place === 'actor').map((n) => n.id);
  const actorsR = real.filter((n) => info(n.id) && info(n.id).place === 'actor-right').map((n) => n.id);
  const globals = real.filter((n) => info(n.id) && info(n.id).place === 'global').map((n) => n.id);
  const vpcLevel = real.filter((n) => info(n.id) && info(n.id).place === 'vpc').map((n) => n.id);
  const regional = real.filter((n) => info(n.id) && info(n.id).place === 'region').map((n) => n.id);
  const inVpc = new Set([...[...inTier.values()].flat(), ...vpcLevel]);
  // regional services upstream of the VPC (an API in front of a VPC load balancer) go left of it
  const reaches = (a, set) => solid.some((e) => e.a === a && set.has(e.b));
  const fromVpc = (b) => model.edges.some((e) => e.b === b && inVpc.has(e.a));
  const upstream = regional.filter((id) => reaches(id, inVpc) && !fromVpc(id));
  const downstream = regional.filter((id) => !upstream.includes(id));
  if (actorsL.length) { for (const id of actorsL) colOf.set(id, col); col++; }
  const byDepth = (ids) => { const ds = [...new Set(ids.map((id) => depth.get(id) || 0))].sort((a, b) => a - b); return ds.map((d) => ids.filter((id) => (depth.get(id) || 0) === d)); };
  for (const layer of byDepth(globals)) { for (const id of layer) colOf.set(id, col); col++; }
  for (const layer of byDepth(upstream)) { for (const id of layer) colOf.set(id, col); col++; }
  const leftVpc = vpcLevel.filter((id) => !/endpoint/i.test(info(id).label));
  const rightVpc = vpcLevel.filter((id) => /endpoint/i.test(info(id).label));
  if (leftVpc.length) { for (const id of leftVpc) colOf.set(id, col); col++; }
  const tierCols = new Map();
  for (const t of tierOrder) {
    const ids = inTier.get(t);
    const keys = [...new Set(ids.map(colKey))].sort((a, b) => Number(a) - Number(b));
    // inside a class, deeper nodes (web tier before app tier) get their own column
    const sub = [];
    for (const k of keys) {
      const cls = ids.filter((id) => colKey(id) === k);
      const ds = [...new Set(cls.map((id) => (info(id).klass === 'nat' ? null : depth.get(id) || 0)).filter((d) => d != null))].sort((a, b) => a - b);
      if (!ds.length) ds.push(0);
      for (const d of ds) sub.push({ k, d, ids: cls.filter((id) => (info(id).klass === 'nat' ? d === ds[0] : (depth.get(id) || 0) === d)) });
    }
    if (!sub.length) sub.push({ k: '1', d: 0, ids: [] });
    tierCols.set(t, sub.map((s) => ({ ...s, col: col++ })));
  }
  if (rightVpc.length) { for (const id of rightVpc) colOf.set(id, col); col++; }
  const lastVpcCol = col - 1;
  for (const layer of byDepth(downstream)) { for (const id of layer) colOf.set(id, col); col++; }
  if (actorsR.length) { for (const id of actorsR) colOf.set(id, col); col++; }
  // rows: one band per Availability Zone (per VPC), as tall as the busiest subnet column
  const slots = new Map();   // node -> slot inside its (tier column, AZ)
  let B = 1;
  const azOf = (id) => subnets.get(info(id).subnet).azPos;
  const vpcOf = (id) => subnets.get(info(id).subnet).vpc;
  for (const [t, cols] of tierCols) for (const c of cols) {
    const groups = new Map();
    for (const id of c.ids) { const k = `${vpcOf(id)}|${azOf(id)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(id); }
    for (const list of groups.values()) {
      // load balancers first, NAT gateways last; an ASG frame's instances together
      const rank = (id) => { const x = info(id); return (x.klass === 'nat' ? 9 : x.klass === 'entry' ? 0 : 1) * 1000 + (x.frame ? frames.findIndex((f) => f.gid === x.frame) * 10 : 500) + (x.extra ? 1 : 0); };
      list.sort((a, b) => rank(a) - rank(b) || model.nodes.get(a).decl - model.nodes.get(b).decl);
      list.forEach((id, i) => { slots.set(id, i); colOf.set(id, c.col); });
      B = Math.max(B, list.length);
    }
  }
  const vpcKeys = [...new Set(sortedSubnets.map((s) => s.vpc))];
  const azs = (v) => [...new Set(sortedSubnets.filter((s) => s.vpc === v).map((s) => s.azPos))].sort((a, b) => a - b);
  const bandRow = new Map();   // `${vpc}|${az}` -> first row
  let row = 0;
  for (const v of vpcKeys) { for (const az of azs(v)) { bandRow.set(`${v}|${az}`, row); row += B; } row += 1; }
  const vpcRows = (v) => { const rs = azs(v).map((az) => bandRow.get(`${v}|${az}`)); return rs.length ? [Math.min(...rs), Math.max(...rs) + B - 1] : [0, 0]; };
  for (const id of slots.keys()) cells.set(id, [colOf.get(id), bandRow.get(`${vpcOf(id)}|${azOf(id)}`) + slots.get(id)]);
  // subnets of one AZ band share its height: a zero-size placeholder in a shorter subnet's last row
  const allRows = [...cells.values()].map((c) => c[1]);
  for (const g of model.groups.values()) {
    if (g.kind !== 'pub' && g.kind !== 'priv') continue;
    const s = [...subnets.values()].find((x) => gid.get(x.key) === g.id);
    if (!s) continue;
    const r0 = bandRow.get(`${s.vpc}|${s.azPos}`);
    const mine = g.desc.filter((id) => cells.has(id));
    const last = r0 + B - 1;
    const cs = mine.map((id) => cells.get(id));
    const c0 = cs.length ? Math.min(...cs.map((c) => c[0])) : (tierCols.get(s.tier) || [{ col: lastVpcCol }])[0].col;
    for (const r of [r0, last]) if (!cs.some((c) => c[1] === r)) {
      const pid = `${g.id}-row${r}`;
      if (!model.nodes.has(pid)) { model.nodes.set(pid, { id: pid, src: pid, junction: true, placeholder: true, parent: g.id, decl: model.nodes.size, fw: 0, up: 0, down: 0, iw: 0, ih: 0, lblH: 0, lblW: 0, lines: [] }); for (let p = g.id; p; p = model.groups.get(p) && model.groups.get(p).parent) { const G = model.groups.get(p); if (G) G.desc.push(pid); } g.kids.nodes.push(pid); }
      cells.set(pid, [c0, r]);
    }
  }
  void allRows;
  // VPC-level gateways: centred on their VPC's bands
  for (const v of vpcKeys.length ? vpcKeys : [null]) {
    const [a, b] = v ? vpcRows(v) : [0, 0];
    const mine = leftVpc.filter((id) => vpcKeys.length <= 1 || model.nodes.get(id).parent === gid.get(v));
    mine.forEach((id, i) => cells.set(id, [colOf.get(id), (a + b) / 2 + (i - (mine.length - 1) / 2) * Math.max(1, B)]));
    const mr = rightVpc.filter((id) => vpcKeys.length <= 1 || model.nodes.get(id).parent === gid.get(v));
    mr.forEach((id, i) => cells.set(id, [colOf.get(id), (a + b) / 2 + (i - (mr.length - 1) / 2) * Math.max(1, B)]));
  }
  // everything else: the barycentre of its neighbours' rows, the next free row in its column on a clash
  const taken = new Map();
  for (const [id, [c, r]] of cells) { if (!taken.has(c)) taken.set(c, []); taken.get(c).push(r); }
  const nb = (id) => model.edges.filter((e) => e.a === id || e.b === id).map((e) => (e.a === id ? e.b : e.a)).filter((x) => cells.has(x));
  const rest = real.map((n) => n.id).filter((id) => !cells.has(id));
  const [vr0, vr1] = vpcKeys.length ? [vpcRows(vpcKeys[0])[0], vpcRows(vpcKeys[vpcKeys.length - 1])[1]] : [0, 0];
  for (let pass = 0; pass < 3; pass++) for (const id of rest) {
    if (cells.has(id)) continue;
    const ns = nb(id);
    const c = colOf.get(id) ?? col;
    let want = ns.length ? ns.reduce((s, x) => s + cells.get(x)[1], 0) / ns.length : (vr0 + vr1) / 2;
    if (!ns.length && pass < 2) continue;
    want = Math.round(want * 2) / 2;
    const used = taken.get(c) || [];
    let r = want;
    for (let k = 0; k < 40; k++) { const t = want + (k % 2 ? Math.ceil(k / 2) : -k / 2); if (!used.some((u) => Math.abs(u - t) < 1)) { r = t; break; } }
    cells.set(id, [c, r]);
    if (!taken.has(c)) taken.set(c, []);
    taken.get(c).push(r);
  }
  for (const id of rest) if (!cells.has(id)) cells.set(id, [colOf.get(id) ?? col, vr1 + 1]);
  // a replication wire runs straight between the AZ rows only when nothing sits between its ends
  for (const e of model.edges) {
    if (!e.sa || !e.sb || !cells.has(e.a) || !cells.has(e.b)) continue;
    const [ca, ra] = cells.get(e.a), [cb, rb] = cells.get(e.b);
    const between = ca !== cb || real.some((n) => n.id !== e.a && n.id !== e.b && cells.has(n.id) && cells.get(n.id)[0] === ca && cells.get(n.id)[1] > Math.min(ra, rb) && cells.get(n.id)[1] < Math.max(ra, rb));
    if (between) { delete e.sa; delete e.sb; }
  }
  // the router keeps hops to the next column on the flow's sides (R out, L in)
  const used = [...new Set([...cells.values()].map((c) => c[0]))].sort((a, b) => a - b);
  model.layerOf = new Map([...cells.entries()].map(([id, c]) => [id, used.indexOf(c[0])]));
  model.dir = 'LR';
  // shift rows so the smallest is 0
  const minR = Math.min(...[...cells.values()].map((c) => c[1]));
  if (minR < 0) for (const [id, c] of cells) cells.set(id, [c[0], c[1] - Math.floor(minR)]);
  return cells;
}
