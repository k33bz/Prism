// resolve.mjs: map any name for an AWS thing to a Prism AWS icon id. One resolver for awd.mjs, the importers
// (draw.io, Mermaid, PlantUML, Python diagrams, CloudFormation, Terraform) and the MCP server. No deps.
//
//   resolveIcon(query, { from = 'text', props = {}, prefer } = {})
//     -> { id, kind: 'node'|'group', group?, confidence, from, how, standby?, status?, candidates: [{ id, score }], warnings: [] }
//     -> { id: null, role?, from, how, candidates, warnings }   nothing good enough (confidence < 0.5), or a
//        cfn/tf type that is a relationship or folded into another node (role 'edge' | 'attr' | 'meta')
//   from:   text | drawio | mermaid | plantuml | diagrams | cfn | tf. With 'text', CloudFormation types
//           (AWS::S3::Bucket), Terraform types (aws_s3_bucket), draw.io styles (mxgraph.aws4.*), Mermaid/Iconify
//           refs (aws:lambda) and diagrams classes (compute.Lambda) are recognised by their shape.
//   props:  property picks for cfn/tf (and draw.io frames): Type, Engine, MultiAZ, FileSystemType,
//           load_balancer_type, engine, multi_az, MapPublicIpOnLaunch, strokeColor... MultiAZ adds standby.
//   prefer: 'service' | 'resource' | 'node' | 'group' overrides the default policy below.
//   searchIcons(query, { kind }) ranks every match for icon browsers; createResolver(store) builds both over
//   another copy of the store (the MCP server's sprite map).
//
// Order: vocabulary rules and xref names from the store (exact), an icon id, store aliases and short names,
// compact-form keys with normalisation rules, then scored word matching. Words match whole (with plural
// folding), never as substrings, so "ecr" cannot hit secrets-manager. Normalisation: lowercase compact form
// (CloudFront = cloud front = cloudfront), Amazon/AWS dropped, trailing _2/2 digits, version suffixes (V2),
// repeated prefixes (LambdaLambdaFunction, emr-emr-engine), trailing Resource (PlantUML), _alt -> -alternate
// (and AWS's own typo id aws-res-aurora-rds-instance-aternate), -dark/-light colorways -> the base id (the
// kit swaps the artwork per theme).
//
// Service vs resource policy (default): a vocabulary that names an icon explicitly keeps it (a draw.io
// resIcon tile is the service, a bare mxgraph.aws4.<name> shape is the resource; PlantUML, Mermaid pack keys
// and diagrams classes name exact icons). Text, CloudFormation and Terraform take the resource icon when they
// name a resource that has one ("S3 bucket", AWS::S3::Bucket) and the service icon for a service ("Amazon
// S3"), except where the kit draws a service's primary resource with the service icon (store field prefer:
// Lambda function, DynamoDB table, SQS queue, SNS topic: aws-svc-lambda has 16 uses in the kit specs,
// aws-res-lambda-function 0). A service named with a resource word that has no icon of its own ("KMS key",
// "EKS cluster") resolves to the service icon.
// Group vs node: names of containers (security group, Availability Zone, VPC, subnets, Region, Auto Scaling
// group, account, corporate data center, AWS Cloud) return kind 'group' with the awd group kind; prefer 'node'
// returns the node icon where one exists. Retired, end-of-support, renamed and duplicate icons resolve, with
// a warning.
//
// CLI: node catalog/aws-icons/resolve.mjs "<query>" [--from cfn] [--prop Type=network] [--prefer resource] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FROM = ['text', 'drawio', 'mermaid', 'plantuml', 'diagrams', 'cfn', 'tf'];
export const PREFER = ['service', 'resource', 'node', 'group'];

// awd group kinds and the corner icon awd draws for each (null: a frame without an icon)
export const GROUPS = {
  cloud: 'aws-grp-cloud-logo', region: 'aws-grp-region', az: null, vpc: 'aws-grp-virtual-private-cloud-vpc',
  pub: 'aws-grp-public-subnet', priv: 'aws-grp-private-subnet', sg: null, asg: 'aws-grp-auto-scaling-group',
  acct: 'aws-grp-account', dc: 'aws-grp-corporate-data-center', server: 'aws-grp-server-contents',
  ec2: 'aws-grp-ec2-instance-contents', spot: 'aws-grp-spot-fleet', gen: null,
};
// container names, matched as whole words after Amazon/AWS are dropped
const GROUP_NAMES = [
  ['sg', ['security group', 'security groups', 'sg']],
  ['az', ['availability zone', 'availability zones', 'az']],
  ['region', ['region', 'regions', 'aws region']],
  ['vpc', ['vpc', 'virtual private cloud', 'vpcs']],
  ['pub', ['public subnet', 'public subnets']],
  ['priv', ['private subnet', 'private subnets', 'isolated subnet', 'subnet', 'subnets']],
  ['asg', ['auto scaling group', 'autoscaling group', 'ec2 auto scaling group', 'asg']],
  ['acct', ['account', 'accounts']],
  ['dc', ['corporate data center', 'data center', 'datacenter', 'on premises data center', 'on prem data center', 'corporate network', 'on premises network']],
  ['cloud', ['cloud']],
  ['server', ['server contents']],
  ['ec2', ['ec2 instance contents', 'instance contents']],
  ['spot', ['spot fleet']],
];
// node icon for a group kind (prefer:'node'), and the group a node icon stands for (prefer:'group')
const GROUP_NODE = { vpc: 'aws-svc-virtual-private-cloud', asg: 'aws-svc-ec2-auto-scaling', dc: 'aws-res-office-building', acct: 'aws-res-organizations-account', server: 'aws-res-server', ec2: 'aws-res-ec2-instance', spot: 'aws-res-ec2-spot-instance' };
const NODE_GROUP = {
  'aws-svc-virtual-private-cloud': 'vpc', 'aws-res-vpc-virtual-private-cloud-vpc': 'vpc', 'aws-svc-ec2-auto-scaling': 'asg',
  'aws-res-ec2-auto-scaling': 'asg', 'aws-svc-auto-scaling': 'asg', 'aws-res-office-building': 'dc', 'aws-res-organizations-account': 'acct',
};
// free-text words that are not AWS names (text only)
const LABELS = {
  'web server': 'aws-res-ec2-instance', 'app server': 'aws-res-ec2-instance', 'application server': 'aws-res-ec2-instance',
  bastion: 'aws-res-ec2-instance', 'bastion host': 'aws-res-ec2-instance', 'jump host': 'aws-res-ec2-instance',
  'on prem': 'aws-res-server', 'on premises': 'aws-res-server', 'mobile': 'aws-res-mobile-client', phone: 'aws-res-mobile-client',
  cache: 'aws-svc-elasticache', 'message queue': 'aws-svc-simple-queue-service', 'object storage': 'aws-svc-simple-storage-service',
  'object store': 'aws-svc-simple-storage-service', 'file storage': 'aws-svc-efs', 'block storage': 'aws-svc-elastic-block-store',
  'identity provider': 'aws-svc-iam-identity-center', warehouse: 'aws-svc-redshift',
};

const STOP = new Set(['amazon', 'aws', 'the', 'a', 'an', 'and', 'for', 'of', 'on', 'with', 'to', 'in', 'by']);
const KIND_ORDER = { svc: ['service', 'resource', 'group', 'category'], res: ['resource', 'service', 'group', 'category'] };
const compact = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const stripBrand = (c) => c.replace(/^(?:amazon|aws)+(?=[a-z0-9]{2})/, '');
const lc = (s) => String(s).toLowerCase();
// split on separators and CamelCase (EC2Instance -> ec2 instance, APIGateway -> api gateway)
const split = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const fold = (w) => (w.length > 3 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);
const kindPrefix = (id) => (id.match(/^aws-(svc|res|grp|cat)-/) || [])[1];
const KIND_OF = { svc: 'service', res: 'resource', grp: 'group', cat: 'category' };

/** Build a resolver over an icon store: { icons: {id: icon} | Map, rules? } (aws-icons.json shape, or the
 *  MCP server's sprite map with whatever metadata it carries; missing xref/rules just mean fewer exact hits). */
export function createResolver(store = {}) {
  const raw = store.icons instanceof Map ? store.icons : new Map(Object.entries(store.icons || {}));
  const rules = store.rules || {};
  // ---- 1. one entry per icon, colorway pairs collapsed to the base id
  const baseOf = (id) => {
    const b = id.replace(/-(dark|light)$/, '');
    return b !== id && raw.has(b + '-dark') && (raw.has(b + '-light') || raw.has(b)) ? b : id;
  };
  const E = new Map();
  for (const [id, ic] of raw) {
    const base = baseOf(id);
    const e = E.get(base);
    if (e) { e.variants.push(id); continue; }
    const kind = ic.kind || KIND_OF[kindPrefix(id)] || '';
    E.set(base, {
      id: base, variants: [id], kind, name: String(ic.name || base).replace(/ (Dark|Light)$/, ''), service: ic.service || null,
      category: ic.category || '', short: ic.short || null, aliases: ic.aliases || [], xref: ic.xref || {},
      status: ic.status || null, endOfSupport: ic.endOfSupport || null, note: ic.note || null, renamedTo: ic.renamedTo || null,
      duplicateOf: ic.duplicateOf || null, primary: ic.primary || null, prefer: ic.prefer || null,
      slug: base.replace(/^aws-(svc|res|grp|cat)-/, ''),
    });
  }
  const canon = (id) => (id && E.has(baseOf(id)) ? baseOf(id) : null);

  // ---- 2. exact keys (compact form). prio 0: slug, alias, short; 1: service + resource name; 2: name alone
  const keys = new Map();
  const addKey = (k, id, prio, how) => {
    if (!k) return;
    const l = keys.get(k) || [];
    if (!l.some((x) => x.id === id && x.prio <= prio)) l.push({ id, prio, how });
    keys.set(k, l);
  };
  // store text splits on spaces and hyphens only: CamelCase brand words stay whole (CloudFront, AgentCore)
  const plain = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const words = (s) => plain(s).filter((w) => !STOP.has(w));
  for (const e of E.values()) {
    addKey(compact(e.slug), e.id, 0, 'slug');
    for (const a of e.aliases) { addKey(compact(a), e.id, 0, 'alias'); addKey(stripBrand(compact(a)), e.id, 0, 'alias'); }
    if (e.short) addKey(stripBrand(compact(e.short)), e.id, 0, 'short');
    if (e.kind !== 'resource' || !e.service) addKey(stripBrand(compact(e.name)), e.id, e.kind === 'resource' ? 1 : 0, 'name');
  }
  // service entries and their keys: resources find their service through it (names, aliases, short)
  const svcOfKey = new Map();
  for (const e of E.values()) if (e.kind === 'service') for (const k of [compact(e.slug), stripBrand(compact(e.name)), ...e.aliases.map((a) => stripBrand(compact(a))), e.short && stripBrand(compact(e.short))]) if (k && !svcOfKey.has(k)) svcOfKey.set(k, e.id);
  const svcByName = (s) => (s ? svcOfKey.get(stripBrand(compact(s))) || null : null);
  const svcKeysOf = new Map();
  for (const e of E.values()) if (e.kind === 'service') svcKeysOf.set(e.id, new Set());
  for (const [k, id] of svcOfKey) svcKeysOf.get(id).add(k);
  for (const e of E.values()) {
    e.svc = e.kind === 'service' ? e.id : svcByName(e.service);
    e.svcKeys = new Set([...(e.svc ? svcKeysOf.get(e.svc) : []), ...(e.service ? [stripBrand(compact(e.service))] : [])]);
    e.nameWords = words(e.name);
    if (e.kind === 'resource' && e.service) {
      const n = compact(e.name);
      for (const k of e.svcKeys) addKey(k + n.replace(new RegExp('^' + k), ''), e.id, 1, 'service+name');
      if (e.nameWords.length >= 2) addKey(stripBrand(n), e.id, 2, 'name');
    }
  }
  const primaryOf = new Map();
  for (const e of E.values()) if (e.primary && canon(e.primary)) primaryOf.set(canon(e.primary), e.id);

  // ---- 3. word vocabulary: tokens of slugs, names, services, aliases (for merging/segmenting query words)
  const VOCAB = new Set();
  for (const e of E.values()) for (const s of [e.slug.replace(/-/g, ' '), e.name, e.service || '', e.short || '', ...e.aliases]) for (const w of plain(s)) VOCAB.add(w);
  for (const e of E.values()) {
    e.words = new Set();
    for (const s of [e.slug.replace(/-/g, ' '), e.name, e.service || '', e.short || '', ...e.aliases]) for (const w of plain(s)) if (!STOP.has(w)) { e.words.add(w); e.words.add(fold(w)); }
    for (const a of e.aliases) e.words.add(compact(a));
    e.slugWords = e.slug.split('-').filter((w) => !STOP.has(w));
  }
  // query words: CamelCase pieces re-joined where the store spells them as one word (dynamo db -> dynamodb,
  // cloud front -> cloudfront), unknown runs segmented into store words (route53 -> route 53)
  const segment = (w) => {
    if (VOCAB.has(w) || VOCAB.has(fold(w)) || /^\d+$/.test(w)) return [w];
    const best = new Array(w.length + 1).fill(null); best[0] = [];
    for (let i = 0; i < w.length; i++) if (best[i]) for (let j = i + 2; j <= w.length; j++) {
      const p = w.slice(i, j);
      if ((VOCAB.has(p) || /^\d+$/.test(p)) && (!best[j] || best[j].length > best[i].length + 1)) best[j] = [...best[i], p];
    }
    return best[w.length] && best[w.length].length <= 3 ? best[w.length] : [w];
  };
  const tokens = (s) => {
    const ws = split(s);
    const out = [];
    for (let i = 0; i < ws.length;) {
      let j = Math.min(ws.length, i + 4);
      for (; j > i + 1; j--) if (VOCAB.has(ws.slice(i, j).join(''))) break;
      out.push(ws.slice(i, j).join(''));
      i = j;
    }
    return out.flatMap(segment).filter((w) => !STOP.has(w) && !/^v\d+$/.test(w));
  };

  const LABEL_KEYS = new Map(Object.entries(LABELS).map(([k, id]) => [tokens(k).join(' '), id]));

  // ---- 4. vocabulary indexes from the store: xref names and rules, case-insensitive
  const XREF = {};
  for (const e of E.values()) for (const [v, names] of Object.entries(e.xref)) for (const n of names) (XREF[v] ||= new Map()).set(lc(n), e.id);
  const RULES = {};
  for (const [v, t] of Object.entries(rules)) RULES[v] = new Map(Object.entries(t).map(([n, r]) => [lc(n), r]));
  // diagrams: also by bare class name when it is unique across modules
  const DG_CLASS = new Map();
  for (const m of [XREF.diagrams, RULES.diagrams]) for (const k of m ? m.keys() : []) { const c = k.split('.').pop(); DG_CLASS.set(c, DG_CLASS.has(c) && DG_CLASS.get(c) !== k ? null : k); }

  const info = (id) => E.get(canon(id)) || null;

  // ---- exact lookup over a compact key and its normalisation variants
  function variants(raw0) {
    const out = [];
    const seen = new Set();
    const push = (c, how, cost, opts = {}) => { if (c && c.length > 1 && !seen.has(c)) { seen.add(c); out.push({ c, how, cost, ...opts }); } };
    let r = String(raw0).trim();
    const cw = r.match(/^(.*?)[\s_-]+(dark|light)(?:[\s_-]*bg)?$/i);
    const c0 = compact(r);
    push(c0, 'exact', 0);
    push(stripBrand(c0), 'brand', 0.01);
    if (cw) { push(stripBrand(compact(cw[1])), 'colorway', 0.02); r = cw[1]; }
    const alt = r.match(/^(.*?)[\s_-]+alt$/i);
    if (alt) for (const s of ['alternate', 'aternate']) push(stripBrand(compact(alt[1])) + s, 'alt', 0.03);
    const base = stripBrand(compact(r));
    // an initialism repeating the service just named: SimpleStorageServiceS3Bucket -> simple storage service bucket
    const tk = tokens(r);
    for (let i = 1; i < tk.length; i++) {
      const svc = svcOfKey.get(tk[i]);
      if (svc && tk[i].length <= 4 && svcOfKey.get(tk.slice(0, i).join('')) === svc) push(tk.filter((_, j) => j !== i).join(''), 'initialism', 0.03);
    }
    const steps = [
      [/^(.+?)[_-]?\d$/, 'digit', (m) => m[1]], [/^(.+?)\d+$/, 'digits', (m) => m[1]], [/^(.+?)v\d+$/, 'version', (m) => m[1]],
      [/^(.+?)(?:resourceicon|icon)$/, 'icon', (m) => m[1]], [/^(.+?)resource$/, 'resource-suffix', (m) => m[1], { res: true }],
    ];
    const queue = [{ c: base, how: [], cost: 0.03, res: false }];
    for (let d = 0; d < 3 && queue.length; d++) {
      for (const q of queue.splice(0)) {
        // repeated prefix: lambdalambdafunction -> lambdafunction, emremrengine -> emrengine
        for (let i = 2; i <= q.c.length / 2; i++) if (q.c.startsWith(q.c.slice(0, i), i)) { const n = q.c.slice(i); push(n, [...q.how, 'repeated-prefix'].join('+'), q.cost + 0.02, { res: q.res }); queue.push({ c: n, how: [...q.how, 'repeated-prefix'], cost: q.cost + 0.02, res: q.res }); }
        for (const [re, how, f, o = {}] of steps) {
          const m = q.c.match(re); if (!m) continue;
          const n = f(m); const h = [...q.how, how];
          push(n, h.join('+'), q.cost + 0.02, { res: q.res || !!o.res }); queue.push({ c: n, how: h, cost: q.cost + 0.02, res: q.res || !!o.res });
        }
        if (q.c.length >= 4) for (const n of [q.c + 's', q.c.replace(/s$/, '')]) push(n, [...q.how, 'plural'].join('+'), q.cost + 0.02, { res: q.res });
      }
    }
    return out;
  }
  function exact(q, order) {
    for (const v of variants(q)) {
      const hits = keys.get(v.c);
      if (!hits) continue;
      const kord = v.res ? KIND_ORDER.res : order;
      const best = [...hits].sort((a, b) => a.prio - b.prio || kord.indexOf(E.get(a.id).kind) - kord.indexOf(E.get(b.id).kind) || a.id.length - b.id.length);
      const top = best[0];
      const tied = best.filter((h) => h.prio === top.prio && E.get(h.id).kind === E.get(top.id).kind && h.id !== top.id && E.get(h.id).duplicateOf !== top.id && E.get(top.id).duplicateOf !== h.id);
      const conf = (top.prio === 0 ? 0.95 : top.prio === 1 ? 0.92 : 0.85) - v.cost - (tied.length ? 0.1 : 0);
      return { id: top.id, confidence: conf, how: v.how === 'exact' ? top.how : `${top.how}+${v.how}`, candidates: best.map((h) => ({ id: h.id, score: conf - 0.05 * h.prio })) };
    }
    return null;
  }

  // ---- scored word matching: every query word must match an icon word (whole, plural-folded) or name the
  // icon's service; fewer unmatched icon words is better
  function scoreAll(qt, order, { prefix = false } = {}) {
    const out = [];
    if (!qt.length) return out;
    for (const e of E.values()) {
      let ok = 0, viaSvc = false, resHit = 0, partial = 0, foldOnly = 0;
      const used = new Set();
      for (const w of qt) {
        const f = fold(w);
        if (e.svcKeys.has(w) && e.kind === 'resource') { viaSvc = true; ok++; continue; }
        if (e.words.has(w) || e.words.has(f)) {
          ok++; used.add(w); used.add(f);
          if (!e.words.has(w)) foldOnly++;
          if (e.kind === 'resource' && (e.nameWords.includes(w) || e.nameWords.includes(f) || e.nameWords.map(fold).includes(f))) resHit++;
          continue;
        }
        if (e.svcKeys.has(w)) { viaSvc = true; ok++; continue; }
        if (prefix && w.length >= 3 && [...e.words].some((x) => x.startsWith(w))) { ok++; partial++; continue; }
      }
      if (ok < qt.length) continue;
      const svcWords = viaSvc && e.svc ? new Set(E.get(e.svc).slugWords) : new Set();
      const extra = e.slugWords.filter((w) => !used.has(w) && !used.has(fold(w)) && !svcWords.has(w)).length;
      const kpen = order.indexOf(e.kind) * 0.04;
      const score = 0.85 - 0.1 * extra - kpen + (resHit ? 0.03 : 0) - partial * 0.05 - foldOnly * 0.01;
      out.push({ id: e.id, score: Math.round(score * 1000) / 1000, extra });
    }
    return out.sort((a, b) => b.score - a.score || a.id.length - b.id.length);
  }
  // the longest run of query words that names a service, and the words around it
  function serviceMention(qt) {
    for (let len = Math.min(4, qt.length); len >= 1; len--) for (let i = 0; i + len <= qt.length; i++) {
      const id = svcOfKey.get(qt.slice(i, i + len).join(''));
      if (id) return { id, rest: [...qt.slice(0, i), ...qt.slice(i + len)] };
    }
    return null;
  }
  function words2(q, order) {
    const qt = tokens(q);
    if (/[_-]\d$/.test(String(q).trim()) && qt.length > 1) qt.pop();   // gamelift_2, rule_2: draw.io versions
    if (!qt.length) return null;
    const all = scoreAll(qt, order);
    if (all.length) {
      const [a, b] = all;
      let conf = a.score;
      const warn = [];
      if (b && a.score - b.score < 0.03 && (info(b.id).duplicateOf !== a.id)) { conf -= 0.12; warn.push(`ambiguous: also matches ${b.id}`); }
      return { id: a.id, confidence: Math.min(0.9, conf), how: 'words', candidates: all.slice(0, 5), warnings: warn };
    }
    // a service plus words with no icon of their own ("KMS key", "EKS cluster"): the service icon
    const m = serviceMention(qt);
    if (m) {
      const second = m.rest.length ? serviceMention(m.rest) : null;
      if (second) {
        // "EMR on EKS": the first service runs on the second; "ECS Fargate": the last word is the head
        const [head, other] = /\bon\b/i.test(q) ? [m.id, second.id] : [second.id, m.id];
        return { id: head, confidence: 0.6, how: 'two-services', candidates: [{ id: head, score: 0.6 }, { id: other, score: 0.55 }], warnings: [`names two services (${m.id}, ${second.id}); took ${head}`] };
      }
      const cands = scoreAll(m.rest, order).filter((c) => E.get(c.id).svc === m.id);
      if (cands.length && cands[0].extra <= 1) return { id: cands[0].id, confidence: 0.8, how: 'service+words', candidates: cands.slice(0, 5) };
      return { id: m.id, confidence: 0.72, how: 'service', candidates: [{ id: m.id, score: 0.72 }, ...scoreAll(m.rest, order).slice(0, 4)], warnings: m.rest.length ? [`no icon for "${m.rest.join(' ')}" of ${E.get(m.id).name}; used the service icon`] : [] };
    }
    // partial: report the best candidates, below the confidence bar
    const part = [];
    for (const w of qt) for (const c of scoreAll([w], order).slice(0, 3)) part.push({ id: c.id, score: Math.round((c.score * 0.5 / qt.length) * 1000) / 1000 });
    part.sort((x, y) => y.score - x.score);
    return { id: null, confidence: part.length ? part[0].score : 0, how: 'partial', candidates: dedupe(part).slice(0, 5) };
  }
  // draw.io resource shapes drop the service prefix (internet_gateway = vpc-internet-gateway): the name's words
  // ending a resource id; the shortest id when several do (exact words before plural-folded ones)
  function suffix(name) {
    const t = String(name).toLowerCase().replace(/[_-]+\d$/, '').split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
    if (!t.length) return null;
    const ends = (e, eq) => e.kind === 'resource' && e.slugWords.length >= t.length && t.every((w, i) => eq(e.slugWords[e.slugWords.length - t.length + i], w));
    let hits = [...E.values()].filter((e) => ends(e, (a, b) => a === b));
    if (!hits.length) hits = [...E.values()].filter((e) => ends(e, (a, b) => fold(a) === fold(b)));
    hits.sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id));
    if (!hits.length) return null;
    return { id: hits[0].id, confidence: hits.length === 1 ? 0.88 : 0.75, how: hits.length === 1 ? 'suffix' : 'suffix-shortest', candidates: hits.slice(0, 5).map((e, i) => ({ id: e.id, score: (hits.length === 1 ? 0.88 : 0.75) - i * 0.02 })), warnings: hits.length > 1 ? [`several resource icons end in "${t.join(' ')}"; took the shortest`] : [] };
  }
  const dedupe = (l) => { const s = new Set(); return l.filter((c) => (s.has(c.id) ? false : (s.add(c.id), true))); };

  // ---- containers named in text (same word merging as queries, so "CloudFront" never reads as "cloud")
  const PHRASES = GROUP_NAMES.flatMap(([g, ps]) => ps.map((p) => ({ g, p, t: tokens(p) })));
  const WIDE = [['dc', ['on premises', 'on prem', 'office', 'customer network']], ['pub', ['dmz']]].flatMap(([g, ps]) => ps.map((p) => ({ g, p, t: tokens(p) })));
  function groupIn(q, wide = false) {
    const s = lc(q).trim();
    if (/^(?:region:?\s*)?[a-z]{2}(?:-gov|-iso[a-z]?)?-[a-z]+-\d$/.test(s)) return { group: 'region', words: 1, how: 'region-code' };
    if (/^(?:az:?\s*)?(?:[a-z]{2}(?:-gov)?-[a-z]+-\d[a-z]|[a-z]{3}\d-az\d)$/.test(s)) return { group: 'az', words: 1, how: 'az-code' };
    const qt = tokens(q);
    const t = ' ' + qt.join(' ') + ' ';
    let best = null;
    for (const ph of wide ? [...PHRASES, ...WIDE] : PHRASES) {
      if (!ph.t.length || !t.includes(' ' + ph.t.join(' ') + ' ')) continue;
      if (!best || ph.t.length > best.words) best = { group: ph.g, words: ph.t.length, how: 'group-name', phrase: ph.p };
    }
    // "Web subnet (public)": the word public or private anywhere decides a subnet
    if (best && best.group === 'priv' && /^subnets?$/.test(best.phrase)) {
      if (qt.includes('public')) best.group = 'pub';
      else if (!qt.some((w) => w === 'private' || w === 'isolated')) best.unsure = true;
    }
    return best;
  }

  // ---- vocabulary forms
  function sniff(q) {
    if (/^AWS::[A-Za-z0-9]+::[A-Za-z0-9]+$/i.test(q)) return 'cfn';
    if (/^aws_[a-z0-9_]+$/.test(q)) return 'tf';
    if (/mxgraph\.aws\d?\./i.test(q) || /(?:^|;)\s*(?:resIcon|grIcon|prIcon)=/i.test(q)) return 'drawio';
    if (/^diagrams\.aws\.[a-z]+\.[A-Za-z0-9]+$/.test(q) || /^[a-z]+\.[A-Z][A-Za-z0-9]*$/.test(q)) return 'diagrams';
    if (/^(?:aws|aws-icons|logos|awsicons|aws-architecture)\s*:\s*[a-z0-9_.-]+$/i.test(q)) return 'mermaid';
    return 'text';
  }
  function drawioName(q) {
    let m;
    if ((m = q.match(/grIcon=mxgraph\.aws\d?\.([a-z0-9_]+)/i))) return { name: m[1], form: 'group' };
    if ((m = q.match(/(?:resIcon|prIcon)=mxgraph\.aws\d?\.([a-z0-9_]+)/i))) return { name: m[1], form: 'tile' };
    if ((m = q.match(/shape=mxgraph\.aws\d?\.([a-z0-9_]+)/i)) && !/^(?:resourceIcon|productIcon|group|groupCenter)$/i.test(m[1])) return { name: m[1], form: /^group_/i.test(m[1]) ? 'group' : 'shape' };
    if ((m = q.match(/^tile:([a-z0-9_]+)$/i))) return { name: m[1], form: 'tile' };
    if ((m = q.match(/mxgraph\.aws\d?\.([a-z0-9_]+)/i))) return { name: m[1], form: /^group_/i.test(m[1]) ? 'group' : 'shape' };
    return { name: q.trim(), form: /^group_/i.test(q.trim()) ? 'group' : 'shape' };
  }

  // ---- apply a rule (store.rules[vocab][name]) with props
  function applyRule(rule, name, props, warnings) {
    let r = { ...rule };
    if (r.by) {
      const key = Object.keys(props).find((k) => lc(k) === lc(r.by));
      const v = key == null ? undefined : props[key];
      const values = Object.keys(r.map || {}).filter((m) => !/^(?:true|false|#)/.test(m));
      r.picked = false;
      if (v == null) warnings.push(`${name}: pass ${r.by}${values.length ? ` (${values.slice(0, 6).join('|')}${values.length > 6 ? '|...' : ''})` : ''}${r.hint ? '; ' + r.hint : ''}; used the default`);
      else if (typeof v === 'object') warnings.push(`${name}: ${r.by} is not a literal value; used the default`);
      else {
        const s = lc(v);
        const k = Object.keys(r.map || {}).filter((m) => s === lc(m) || s.startsWith(lc(m))).sort((a, b) => b.length - a.length)[0];
        if (k != null) { const m = r.map[k]; r = { ...r, ...(typeof m === 'string' ? { icon: m, group: undefined } : m) }; }
        else if (Object.values(r.map || {}).some((m) => typeof m === 'string')) warnings.push(`${name}: ${r.by}=${v} has no icon of its own; used the default`);
        r.picked = true;
      }
    }
    if (r.standby) {
      const key = Object.keys(props).find((k) => lc(k) === lc(r.standby));
      const v = key == null ? undefined : props[key];
      if (v === true || /^(?:true|yes|1)$/i.test(String(v))) r.standbyOn = true;
      else if (v != null && typeof v === 'object') warnings.push(`${name}: ${r.standby} is not a literal value; no standby added`);
    }
    return r;
  }
  const altOf = (id) => [id + '-alternate', id + '-aternate'].find((x) => E.has(x)) || null;

  // ---- the main entry
  function resolve(query, opts = {}) {
    const q = String(query == null ? '' : query).trim();
    let props = opts.props || {};
    let from = FROM.includes(opts.from) ? opts.from : 'text';
    const prefer = PREFER.includes(opts.prefer) ? opts.prefer : null;
    const warnings = [];
    if (!q) return { id: null, candidates: [], warnings: ['empty query'] };
    if (from === 'text') { const s = sniff(q); if (s !== 'text') from = s; }
    let r = null;
    let order = KIND_ORDER.svc;
    let key = q;
    let explicit = from !== 'text' && from !== 'cfn' && from !== 'tf';   // the vocabulary names an exact icon
    let shape = false;
    let fromId = false;

    if (from === 'drawio') {
      const d = drawioName(q);
      key = d.name;
      if (d.form === 'shape') { order = KIND_ORDER.res; shape = true; }
      // a full style string carries its own properties (strokeColor tells a public subnet frame from a private one)
      if (q.includes('=')) props = { ...Object.fromEntries(q.split(';').map((kv) => kv.split('=')).filter((kv) => kv.length === 2)), ...props };
    } else if (from === 'mermaid') {
      key = q.replace(/^[a-z0-9-]+\s*:\s*/i, '');
    } else if (from === 'diagrams') {
      key = q.replace(/^diagrams\.aws\./, '');
      if (!key.includes('.')) key = DG_CLASS.get(lc(key)) || key;
    } else if (from === 'cfn' || from === 'tf') order = KIND_ORDER.res;

    // 1. vocabulary rule or xref name
    const rule = RULES[from] && RULES[from].get(lc(key));
    if (rule) {
      const rr = applyRule(rule, key, props, warnings);
      if (rr.none) return finish({ id: null, how: 'rule', confidence: 0, candidates: [], warnings: [...warnings, `${key}: ${rr.none}`] });
      if (rr.role) return finish({ id: null, role: rr.role, icon: rr.icon || null, how: 'rule', candidates: rr.icon ? [{ id: rr.icon, score: 0.5 }] : [], warnings: [...warnings, `${key} is ${rr.role === 'edge' ? 'a relationship (draw it as a wire)' : rr.role === 'attr' ? 'folded into another node' : 'not architecture'}, not a node`] });
      const conf = rr.note ? 0.75 : rr.by && !rr.picked ? 0.85 : 1;   // an approximation, or a property pick left at its default
      const how = rr.by ? `rule+${rr.by}${rr.picked ? '' : ' (default)'}` : 'rule';
      if (rr.group) r = { id: rr.icon || GROUPS[rr.group] || null, kind: 'group', group: rr.group, confidence: conf, how, candidates: [] };
      else r = { id: canon(rr.icon), confidence: conf, how, candidates: [] };
      if (rr.note) warnings.push(`${key}: ${rr.note}`);
      if (rr.standbyOn && r.id) r.standby = altOf(r.id) || r.id;
    }
    if (!r && XREF[from]) {
      const id = XREF[from].get(lc(key));
      if (id) r = { id, confidence: 1, how: 'xref', candidates: [] };
    }
    if (from === 'diagrams') key = key.split('.').pop();   // the class name carries the icon name
    // <name>_alt is the alternate colorway of whatever <name> resolves to (-alternate, or AWS's typo -aternate)
    const alt = !r && key.match(/^(.+?)[\s_-]+alt$/i);
    if (alt) {
      const b = resolve(from === 'drawio' ? `${shape ? '' : 'resIcon='}mxgraph.aws4.${alt[1]}` : alt[1], { ...opts, from, prefer: undefined });
      if (b.id && altOf(b.id)) r = { id: altOf(b.id), confidence: Math.min(0.95, b.confidence), how: b.how + '+alt', candidates: [] };
    }
    // 2. an icon id (a colorway variant resolves to its base)
    if (!r && /^aws-(svc|res|grp|cat)-/.test(q) && canon(q)) {
      r = { id: canon(q), confidence: 1, how: canon(q) === q ? 'id' : 'id+colorway', candidates: [] };
      explicit = fromId = true;
    }
    // 3. drawio / plantuml group names, then containers named in text
    if (!r && from === 'plantuml' && /group$/i.test(key)) {
      const g = groupIn(key.replace(/group$/i, ''));
      if (g) r = { id: GROUPS[g.group], kind: 'group', group: g.group, confidence: 0.9, how: 'plantuml-group', candidates: [] };
    }
    const grp = !r && (from === 'text' || from === 'mermaid') ? groupIn(key, prefer === 'group') : null;
    // 4. label words, exact keys with normalisation, then scored words
    let node = null;
    if (!r) {
      const label = from === 'text' && LABEL_KEYS.get(tokens(key).join(' '));
      if (label && E.has(label)) node = { id: label, confidence: 0.8, how: 'label', candidates: [] };
      if (shape) node = suffix(key);
      // a type missing from the cfn/tf tables: matched by its words, with a warning
      if (from === 'cfn') node = cfnFallback(key, warnings);
      if (from === 'tf') node = tfFallback(key, warnings);
      if (!node && from !== 'cfn' && from !== 'tf') node = exact(key, order);
      if (!node && from !== 'cfn' && from !== 'tf') node = words2(key, order);
    }
    // a container phrase wins unless a node icon matched every word and explains more words than the phrase
    // ("VPC endpoint", "Organizations account", "Multi-Region access points"); prefer decides outright
    if (grp) {
      const fullNode = node && node.id && node.confidence >= 0.5 && !/^(?:service|two-services|partial)/.test(node.how);
      const asGroup = prefer === 'group' || (prefer === 'node' ? !(node && node.id) : !(fullNode && tokens(key).length > grp.words));
      if (asGroup) {
        r = { id: GROUPS[grp.group], kind: 'group', group: grp.group, confidence: tokens(key).length <= grp.words ? 0.9 : 0.8, how: grp.how, candidates: node && node.id ? [{ id: node.id, score: node.confidence }] : [] };
        if (grp.unsure) warnings.push(`"${q}" does not say public or private; assumed a private subnet`);
        node = null;
      }
    }
    if (node && node.warnings) warnings.push(...node.warnings);
    if (!r) r = node;
    // prefer:'group' with nothing recognisable: a generic frame
    if (prefer === 'group' && (!r || (!r.id && r.kind !== 'group'))) r = { id: null, kind: 'group', group: 'gen', confidence: 0.5, how: 'generic-frame', candidates: (r && r.candidates) || [] };
    return finish(r);

    function finish(res) {
      const roundC = (l) => dedupe((l || []).map((c) => ({ id: canon(c.id) || c.id, score: Math.round(c.score * 100) / 100 }))).slice(0, 5);
      if (!res) return { id: null, from, candidates: [], warnings: [...warnings, `no Prism icon matches "${q}"`] };
      if (res.id == null && res.kind !== 'group') {
        if (!res.warnings && !warnings.some((w) => w.includes(q))) warnings.push(`no Prism icon matches "${q}"`);
        return { id: null, ...(res.role ? { role: res.role } : {}), from, how: res.how, candidates: roundC(res.candidates), warnings: [...new Set([...warnings, ...(res.warnings || [])])] };
      }
      if (res.kind !== 'group' && res.confidence < 0.5) return { id: null, from, how: res.how, candidates: roundC(res.candidates), warnings: [...warnings, `no confident match for "${q}"`] };
      let out = { id: res.id, kind: res.kind || 'node', ...(res.group ? { group: res.group } : {}), confidence: Math.round(res.confidence * 100) / 100, from, how: res.how };
      if (res.standby) out.standby = res.standby;
      // a node icon that is itself a frame icon
      if (out.kind === 'node' && out.id && E.get(out.id) && E.get(out.id).kind === 'group') {
        const g = Object.keys(GROUPS).find((k) => GROUPS[k] === out.id) || (out.id === 'aws-grp-cloud' ? 'cloud' : 'gen');
        out = { ...out, kind: 'group', group: g };
      }
      // policy and prefer
      const e = out.id && E.get(out.id);
      if (out.kind === 'node' && e) {
        if (prefer === 'service' && e.kind === 'resource' && e.svc) { out.id = e.svc; out.how += '+prefer-service'; }
        else if (prefer === 'resource' && e.kind === 'service') {
          if (e.primary && canon(e.primary)) { out.id = canon(e.primary); out.how += '+prefer-resource'; }
          else warnings.push(`${e.name} has no resource icon; kept the service icon`);
        } else if (!prefer && !explicit && e.kind === 'resource' && primaryOf.has(e.id) && E.get(primaryOf.get(e.id)).prefer === 'service') {
          out.id = primaryOf.get(e.id); out.how += '+service-policy';
        }
        if (prefer === 'group') {
          const g = NODE_GROUP[out.id];
          out = g ? { ...out, kind: 'group', group: g, id: GROUPS[g] } : { ...out, kind: 'group', group: 'gen' };
          out.how += '+prefer-group';
        }
      } else if (out.kind === 'group' && prefer === 'node') {
        const n = out.group === 'gen' ? out.id : GROUP_NODE[out.group];
        if (n && E.has(n)) out = { id: n, kind: 'node', confidence: out.confidence, how: out.how + '+prefer-node' };
        else warnings.push(`${out.group} is a frame with no node icon`);
      }
      // duplicates, renames, status
      const f = out.id && E.get(out.id);
      if (f && f.duplicateOf && canon(f.duplicateOf)) {
        if (fromId) warnings.push(`${f.id} duplicates ${f.duplicateOf}`);
        else { out.id = canon(f.duplicateOf); out.how += '+dedupe'; }
      }
      const g = out.id && E.get(out.id);
      if (g) {
        if (g.status === 'retired') warnings.push(`${g.short || g.name} was shut down${g.endOfSupport ? ' on ' + g.endOfSupport : ''}; the icon is kept for legacy estates${g.note ? ' (' + g.note + ')' : ''}`);
        else if (g.status === 'end-of-support') warnings.push(`${g.short || g.name} ${g.endOfSupport && g.endOfSupport < today() ? 'reached' : 'reaches'} end of support${g.endOfSupport ? ' on ' + g.endOfSupport : ''}${g.note ? ' (' + g.note + ')' : ''}`);
        if (g.renamedTo && canon(g.renamedTo)) warnings.push(`${g.name}: ${g.note || 'renamed'}; draw ${canon(g.renamedTo)} (${E.get(canon(g.renamedTo)).name})`);
        if (g.status) out.status = g.status;
      }
      out.confidence = Math.max(0, Math.min(1, out.confidence));
      return { ...out, candidates: roundC([...(out.id ? [{ id: out.id, score: out.confidence }] : []), ...(res.candidates || [])]), warnings: [...new Set(warnings)] };
    }
  }
  // CloudFormation type with no table entry: service + resource words, else the service icon
  function cfnFallback(t, warnings) {
    const m = t.match(/^AWS::([A-Za-z0-9]+)::([A-Za-z0-9]+)$/i);
    if (!m) return null;
    const ns = m[1].replace(/V\d+$/, '');
    const svc = exact(ns, KIND_ORDER.svc);
    const both = words2(`${ns} ${m[2]}`, KIND_ORDER.res);
    if (both && both.id && both.how !== 'service' && svc && E.get(both.id).svc === svc.id) {
      warnings.push(`${t} is not in the CloudFormation table; matched by name`);
      return { ...both, confidence: Math.min(both.confidence, 0.7), how: 'cfn-name' };
    }
    if (svc && E.get(svc.id).kind === 'service') {
      warnings.push(`${t} is not in the CloudFormation table; used the ${E.get(svc.id).name} service icon`);
      return { id: svc.id, confidence: 0.6, how: 'cfn-service', candidates: svc.candidates };
    }
    return null;
  }
  function tfFallback(t, warnings) {
    const m = t.match(/^aws_([a-z0-9]+)_(.+)$/);
    if (!m) return null;
    const r = words2(t.replace(/^aws_/, '').replace(/_/g, ' '), KIND_ORDER.res) || exact(m[1], KIND_ORDER.svc);
    if (r && r.id) { warnings.push(`${t} is not in the Terraform table; matched by name`); return { ...r, confidence: Math.min(r.confidence, 0.65), how: 'tf-name' }; }
    return null;
  }

  /** Ranked search for icon browsers: every query word matches a whole word (or the start of one), exact
   *  names, aliases and xref names first. [{ id, score, entry }] */
  function search(query = '', { kind = null } = {}) {
    const q = String(query).trim();
    const pool = [...E.values()].filter((e) => !kind || e.kind === kind);
    if (!q) return pool.sort((a, b) => KIND_ORDER.svc.indexOf(a.kind) - KIND_ORDER.svc.indexOf(b.kind) || a.name.localeCompare(b.name)).map((e) => ({ id: e.id, score: 0, entry: e }));
    const scores = new Map();
    const bump = (id, s) => { if (id && E.has(id) && (!kind || E.get(id).kind === kind) && s > (scores.get(id) || -1)) scores.set(id, s); };
    const r = resolve(q);
    if (r.id) bump(r.id, 1 + r.confidence);
    for (const c of r.candidates || []) bump(c.id, 1 + c.score * 0.9);
    const ex = exact(q, KIND_ORDER.svc);
    if (ex) for (const c of ex.candidates) bump(c.id, 1 + c.score * 0.9);
    for (const c of scoreAll(tokens(q), KIND_ORDER.svc, { prefix: true })) bump(c.id, c.score);
    return [...scores].map(([id, score]) => ({ id, score: Math.round(score * 1000) / 1000, entry: E.get(id) }))
      .sort((a, b) => b.score - a.score || KIND_ORDER.svc.indexOf(a.entry.kind) - KIND_ORDER.svc.indexOf(b.entry.kind) || a.entry.name.length - b.entry.name.length);
  }

  return { resolve, search, info, has: (id) => !!canon(id), size: E.size };
}

const today = () => new Date().toISOString().slice(0, 10);

let DEFAULT = null;
/** The store beside this module (aws-icons.json). */
export function loadStore(file = path.join(HERE, 'aws-icons.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
const defaultResolver = () => (DEFAULT ||= createResolver(loadStore()));
/** Resolve against the store beside this module. */
export function resolveIcon(query, opts) { return defaultResolver().resolve(query, opts); }
export function searchIcons(query, opts) { return defaultResolver().search(query, opts); }
export function iconInfo(id) { return defaultResolver().info(id); }

// ---- CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opts = { props: {} };
  const words = [];
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--from') opts.from = args[++i];
    else if (a === '--prefer') opts.prefer = args[++i];
    else if (a === '--prop') { const [k, ...v] = String(args[++i]).split('='); opts.props[k] = v.join('='); }
    else if (a === '--json') json = true;
    else words.push(a);
  }
  if (!words.length || (opts.from && !FROM.includes(opts.from)) || (opts.prefer && !PREFER.includes(opts.prefer))) {
    console.error(`usage: node catalog/aws-icons/resolve.mjs "<query>" [--from ${FROM.join('|')}] [--prop Key=value]... [--prefer ${PREFER.join('|')}] [--json]`);
    process.exit(2);
  }
  const r = resolveIcon(words.join(' '), opts);
  if (json) console.log(JSON.stringify(r, null, 2));
  else {
    const nm = (id) => { const e = iconInfo(id); return e ? `${e.short || e.name}${e.service ? ' [' + e.service + ']' : ''}` : ''; };
    if (r.id || r.kind === 'group') console.log(`${r.id || '(frame, no icon)'}  ${r.kind}${r.group ? ' ' + r.group : ''}  confidence ${r.confidence}  via ${r.how}${r.id ? '\n  ' + nm(r.id) : ''}${r.standby ? '\n  standby: ' + r.standby : ''}`);
    else console.log(`no icon${r.role ? ` (${r.role})` : ''}`);
    for (const w of r.warnings) console.log('  warning: ' + w);
    if (r.candidates.length > 1 || !r.id) for (const c of r.candidates) console.log(`  candidate ${c.id.padEnd(58)} ${String(c.score).padEnd(5)} ${nm(c.id)}`);
  }
  process.exit(r.id || r.kind === 'group' ? 0 : 1);
}
