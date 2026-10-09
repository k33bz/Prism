// Coverage of resolve.mjs against the interop evaluators' inputs (coverage-inputs.json): draw.io service tiles
// and shapes, Python diagrams classes and aliases, Mermaid pack keys, PlantUML macros, free-text labels,
// CloudFormation and Terraform types. "resolved" = an icon or a frame; "agree" = the evaluators' pick (or the
// reviewed pick in REVIEWED below); "policy" = differs only by the service-vs-resource default (prefer:'resource'
// gives the evaluators' pick).
// Usage: node catalog/aws-icons/coverage.mjs [--verbose] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResolver, loadStore, GROUPS } from './resolve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const INPUTS = JSON.parse(fs.readFileSync(path.join(HERE, 'coverage-inputs.json'), 'utf8'));

// the evaluators' resolved counts with their curated tables (SYNTHESIS T2 and the lane reports)
export const BASELINE = {
  drawioTiles: 322, drawioShapes: 331, diagramsDistinct: 448, mermaid: 40, plantuml: 36, labels: 58, cfnMeaningful: 127,
};

// where this resolver deliberately differs from an evaluator's pick, and why
export const REVIEWED = {
  // draw.io shapes the evaluators left unresolved: the normalisation rules reach them (versions, plurals, typo id)
  'drawioShapes:documents2': ['aws-res-documents', 'trailing digit: a draw.io variant of the documents icon'],
  'drawioShapes:documents3': ['aws-res-documents', 'trailing digit'],
  'drawioShapes:internet_alt22': ['aws-res-internet-alt2', 'trailing digit'],
  'drawioShapes:data_lake_resource_icon': ['aws-res-lake-formation-data-lake', '"resource icon" suffix'],
  'drawioShapes:glue_crawlers': ['aws-res-glue-crawler', 'plural'],
  'drawioShapes:redshift_query_editor_v20_light': ['aws-res-redshift-query-editor-v2-0', 'colorway suffix'],
  'drawioShapes:eventbridge_saas_partner_event_bus_resource': ['aws-res-eventbridge-saas-partner-event', 'xref (the diagrams table maps the same name)'],
  'drawioShapes:instance_with_cloudwatch2': ['aws-res-ec2-instance-with-cloudwatch', 'trailing digit'],
  'drawioShapes:db_on_instance2': ['aws-res-ec2-db-instance', 'alias "db on instance"'],
  'drawioShapes:ecs_copilot_cli': ['aws-res-elastic-container-service-copiiot-cli', 'alias for the package typo "copiiot"'],
  'drawioShapes:addon': ['aws-res-identity-access-management-add-on', 'compact form'],
  'drawioShapes:stack2': ['aws-res-cloudformation-stack', 'trailing digit'],
  'drawioShapes:organizations_account2': ['aws-res-organizations-account', 'trailing digit'],
  'drawioShapes:organizations_management_account2': ['aws-res-organizations-management-account', 'trailing digit'],
  'drawioShapes:organizations_organizational_unit2': ['aws-res-organizations-organizational-unit', 'trailing digit'],
  'drawioShapes:non_cached_volume': ['aws-res-storage-gateway-noncached-volume', 'compact form'],
  'drawioShapes:multiple_volumes_resource': ['aws-res-elastic-block-store-multiple-volumes', 'Resource suffix'],
  // better picks than the evaluators' approximations
  'drawioShapes:container_2': ['aws-res-elastic-container-service-container-2', 'the store has the numbered container icons'],
  'drawioShapes:container_3': ['aws-res-elastic-container-service-container-3', 'the store has the numbered container icons'],
  'drawioShapes:elastic_file_system_infrequent_access': ['aws-res-elastic-file-system-efs-standard-infrequent-access', 'no "one zone" in the name: Standard-IA'],
  // no icon of their own: the service icon, with a warning
  'drawioTiles:workspaces_thin_client': ['aws-svc-workspaces', 'WorkSpaces family icon, warned'],
  'drawioShapes:cloud_wan_virtual_pop': ['aws-svc-cloud-wan', 'Cloud WAN service icon, warned'],
  'iconify:aws:amazon-eventbridge-topic': ['aws-svc-eventbridge', 'EventBridge service icon, warned'],
  // policy decisions (AWS_KIT.md "Resolving icon names")
  'diagrams:blockchain.Blockchain': ['aws-cat-blockchain', 'a module-named class is the category icon (compute.Compute, storage.Storage...)'],
  'labels:Auto Scaling Group': ['group:asg', 'a container name returns the frame; prefer node gives aws-svc-ec2-auto-scaling'],
  'labels:Load Balancer': ['aws-svc-elastic-load-balancing', 'a generic load balancer is the ELB service icon; prefer resource gives the ALB'],
  'labels:Postgres': ['aws-res-aurora-postgresql-instance', 'an engine name picks the engine icon'],
  'kitLabels:RDS MySQL': [['aurora-mysql-instance'], 'the package files RDS engine icons under Aurora'],
  'kitLabels:IAM role': [['identity-access-management-role'], 'the resource ids drop the "and" of the service id'],
  'clusterLabels:Subnet A': ['priv', 'a subnet that does not say public: private, warned'],
};

const SETS = [
  // [key, title, from, query(name), opts]
  ['drawioTiles', 'draw.io service tiles (resIcon)', 'drawio', (n) => `resIcon=mxgraph.aws4.${n}`],
  ['drawioShapes', 'draw.io resource shapes', 'drawio', (n) => `mxgraph.aws4.${n}`],
  ['diagrams', 'Python diagrams classes (module-qualified)', 'diagrams', (n) => n],
  ['diagramsAliases', 'Python diagrams module aliases', 'diagrams', (n) => n],
  ['mermaid', 'Mermaid awslabs pack keys', 'mermaid', (n) => n],
  ['iconify', 'Mermaid/Iconify vendor names', 'mermaid', (n) => n],
  ['plantuml', 'PlantUML macros (36 icons + 6 groups)', 'plantuml', (n) => n],
  ['labels', 'free-text labels (Mermaid lane)', 'text', (n) => n],
  ['kitLabels', 'free-text labels (kit lane probe)', 'text', (n) => n],
  ['clusterLabels', 'container labels, prefer group', 'text', (n) => n, { prefer: 'group' }],
  ['cfn', 'CloudFormation types (sample)', 'cfn', (n) => n],
  ['tf', 'Terraform types (crosswalk sample)', 'tf', (n) => n],
];

export function coverage(store = loadStore()) {
  const R = createResolver(store);
  const out = {};
  for (const [key, title, from, q, opts = {}] of SETS) {
    const rows = [];
    for (const [name, want0] of Object.entries(INPUTS[key])) {
      const want = Object.hasOwn(REVIEWED, `${key}:${name}`) ? REVIEWED[`${key}:${name}`][0] : want0;
      const r = R.resolve(q(name), { from, ...opts });
      const resolved = !!(r.id || r.kind === 'group');
      const got = r.kind === 'group' ? `group:${r.group}` : r.role || r.id;
      let agree;
      if (key === 'kitLabels') agree = !!r.id && want.some((o) => r.id.includes(o)) || (r.kind === 'group' && want.some((o) => o === r.group || (GROUPS[r.group] || '').includes(o)));
      else if (key === 'clusterLabels') agree = r.group === want;
      else if (want === 'group') agree = r.kind === 'group';
      else if (want == null) agree = !resolved;
      else { const w = R.info(want); agree = got === want || (r.kind === 'group' && want === GROUPS[r.group]) || (!!r.id && !!w && (w.id === r.id || w.duplicateOf === r.id)); }
      let policy = false;
      if (!agree && r.id && typeof want === 'string' && want.startsWith('aws-')) {
        const p = R.resolve(q(name), { from, ...opts, prefer: 'resource' });
        policy = p.id === want;
      }
      rows.push({ name, want: key === 'kitLabels' ? want.join('|') : want, got, resolved, agree, policy, how: r.how, warnings: r.warnings });
    }
    out[key] = { title, rows, n: rows.length, resolved: rows.filter((x) => x.resolved).length, agree: rows.filter((x) => x.agree).length, policy: rows.filter((x) => x.policy).length };
  }
  // distinct diagrams class names (the evaluators' 491): resolved when every module's class resolves
  const byCls = new Map();
  for (const x of out.diagrams.rows) { const c = x.name.split('.').pop(); byCls.set(c, (byCls.get(c) ?? true) && x.resolved); }
  out.diagramsDistinct = { title: 'Python diagrams distinct class names', n: byCls.size, resolved: [...byCls.values()].filter(Boolean).length };
  // CloudFormation: the 131 architecturally meaningful types are those the evaluators drew or found no icon for
  const meaningful = out.cfn.rows.filter((x) => x.want !== 'edge' && x.want !== 'attr' && x.want !== 'meta');
  out.cfnMeaningful = { title: 'CloudFormation meaningful types', n: meaningful.length, resolved: meaningful.filter((x) => x.resolved).length };
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const verbose = process.argv.includes('--verbose');
  const c = coverage();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(c, null, 1)); process.exit(0); }
  const pad = (s, n) => String(s).padEnd(n), lp = (s, n) => String(s).padStart(n);
  console.log(`${pad('input', 46)}${lp('n', 5)}${lp('resolved', 10)}${lp('evaluators', 12)}${lp('agree', 7)}${lp('policy', 8)}`);
  const line = (k) => { const s = c[k]; console.log(`${pad(s.title, 46)}${lp(s.n, 5)}${lp(s.resolved, 10)}${lp(BASELINE[k] ?? '', 12)}${lp(s.agree ?? '', 7)}${lp(s.policy ?? '', 8)}`); };
  for (const k of ['drawioTiles', 'drawioShapes', 'diagrams', 'diagramsDistinct', 'diagramsAliases', 'mermaid', 'iconify', 'plantuml', 'labels', 'kitLabels', 'clusterLabels', 'cfn', 'cfnMeaningful', 'tf']) line(k);
  for (const [k, s] of Object.entries(c)) {
    if (!s.rows) continue;
    const bad = s.rows.filter((x) => !x.agree && !x.policy);
    if (!bad.length) continue;
    if (!verbose) { console.log(`\n${s.title}: ${bad.length} differ (--verbose lists them)`); continue; }
    console.log(`\n${s.title}: ${bad.length} differ from the expected pick`);
    for (const x of bad) console.log(`  ${pad(x.name, 44)} want ${pad(x.want, 52)} got ${pad(x.got, 52)} ${x.how || ''}`);
  }
}
