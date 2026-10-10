// cfn.mjs: CloudFormation (JSON or YAML, CDK synth output, SAM after transform) -> Prism AWS kit spec
// (k33bz fork). No deps.
//
//   import { fromCloudFormation } from './import/cfn.mjs';
//   const { spec, report } = fromCloudFormation(text, { id, name, flows, params, story });
//   // report: { from: 'cfn', issues, unmapped, ledger, tile, lint, story, resources, counts, icons }
//
// opts.flows is the flows sidecar (an object or JSON text; see "Importing CloudFormation and Terraform" in
// catalog/drafts/AWS_KIT.md): actors, request flows, stories, hide/show/merge/pin/group_hints/overrides/anchors.
// A template may carry it in Metadata "Prism::Flows" instead. opts.params overrides Parameter defaults;
// opts.story picks a sidecar flow or story by id, 'none', or 'guess' (a breadth-first walk from the
// internet-facing entry, reported as a guess). Without a sidecar there is no animation unless story is 'guess'.
//
// What it reads: Parameters (defaults, opts.params), Conditions (resources whose condition is false are
// dropped; Fn::If picks its branch and the ledger says which parameter decided it), Mappings, the
// intrinsics (Ref, GetAtt, Sub, If, Select, GetAZs, Join, Split, FindInMap, ImportValue, Equals, Not, And,
// Or, Base64, Cidr), CDK metadata (aws:cdk:path gives readable names; Custom:: resources, their provider
// functions and roles, CDKMetadata and DefaultPolicy fold away), SAM after transform (and the SAM source
// with a warning: its implicit resources from Events are approximated).
//
// CLI: node catalog/aws-kit/import/cfn.mjs template.yaml [--flows sidecar.json] [--id x] [--param K=V]
//        [--story id|none|guess] [--rules [AppSg,DbSg]] [--out spec.json] [--svg out.svg] [--theme light|dark] [--ledger]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './cfn-yaml.mjs';
import { importInfra, kitId } from './iac.mjs';

export { parseYaml };

/** Parse a CloudFormation template from JSON or YAML text. */
export function loadTemplate(content) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
  const t = text.replace(/^﻿/, '').trim();
  let tpl;
  if (t.startsWith('{')) {
    try { tpl = JSON.parse(t); } catch (err) { throw new Error(`the template is not valid JSON: ${err.message}`); }
  } else tpl = parseYaml(t);
  if (!tpl || typeof tpl !== 'object' || Array.isArray(tpl)) throw new Error('the template is not a mapping');
  if (!tpl.Resources || typeof tpl.Resources !== 'object') throw new Error('the template has no Resources section');
  return tpl;
}

const PSEUDO = { 'AWS::Partition': 'aws', 'AWS::URLSuffix': 'amazonaws.com', 'AWS::NotificationARNs': [] };
const NOVALUE = Symbol('NoValue');
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const intrinsicKey = (v) => (isObj(v) && Object.keys(v).length === 1 && /^(Ref|Condition|Fn::\w+)$/.test(Object.keys(v)[0]) ? Object.keys(v)[0] : null);

export function fromCloudFormation(content, opts = {}) {
  const tpl = isObj(content) && content.Resources ? content : loadTemplate(content);
  const issues = [], ledger = [];
  const say = (severity, code, element, message) => { if (!issues.some((x) => x.code === code && x.element === element && x.message === message)) issues.push({ severity, code, element, message }); };
  const led = (kind, fact, from = [], extra = {}) => { if (!ledger.some((l) => l.fact === fact)) ledger.push({ kind, fact, from: [...new Set(from)], ...extra }); };
  const R = tpl.Resources;
  const keys = Object.keys(R);
  const params = isObj(tpl.Parameters) ? tpl.Parameters : {};
  const given = isObj(opts.params) ? opts.params : {};
  for (const k of Object.keys(given)) if (!params[k]) say('warn', 'param', k, `opts.params names ${k}, which the template does not declare`);
  const mappings = isObj(tpl.Mappings) ? tpl.Mappings : {};
  const conditions = isObj(tpl.Conditions) ? tpl.Conditions : {};
  const region = opts.region || null;

  // ---- SAM source (not transformed): say so; the processed template is the faithful input
  const transforms = [].concat(tpl.Transform || []).map(String);
  const samSource = transforms.some((t) => /Serverless/.test(t)) && keys.some((k) => /^AWS::Serverless::/.test(String(R[k] && R[k].Type)));
  if (samSource) say('warn', 'sam-source', null, 'this is a SAM source template (Transform AWS::Serverless-2016-10-31): implicit resources from Events and policy templates are approximated; import the processed template (aws cloudformation get-template --template-stage Processed) for the exact picture');
  if (transforms.some((t) => !/Serverless/.test(t))) say('warn', 'macro', null, `template macros ${transforms.filter((t) => !/Serverless/.test(t)).join(', ')} run at deploy time; their output is not drawn`);

  // ---- parameters: given, default, or unknown
  const paramUse = new Map();   // name -> { value, how }
  const paramVal = (name) => {
    if (paramUse.has(name)) return paramUse.get(name);
    const p = params[name] || {};
    let o;
    if (Object.hasOwn(given, name)) o = { value: given[name], how: 'given' };
    else if (Object.hasOwn(p, 'Default')) o = { value: /^List<|CommaDelimitedList/.test(String(p.Type || '')) && typeof p.Default === 'string' ? p.Default.split(',').map((x) => x.trim()) : p.Default, how: 'default' };
    else o = { value: undefined, how: 'unknown', type: p.Type };
    o.type = p.Type;
    paramUse.set(name, o);
    return o;
  };
  const explainParam = (n) => { const p = paramVal(n); return p.how === 'given' ? `${n} is ${JSON.stringify(p.value)} (given)` : p.how === 'default' ? `${n} is ${JSON.stringify(p.value)} (its default)` : `${n} has no value (no default, not given)`; };

  // ---- conditions, with the parameters that decided them
  const condMemo = new Map();
  const evalCond = (name, stack = []) => {
    if (condMemo.has(name)) return condMemo.get(name);
    if (!Object.hasOwn(conditions, name)) { say('warn', 'condition', name, `condition ${name} is not defined; taken as false`); return { value: false, deps: [], unknown: true }; }
    if (stack.includes(name)) return { value: false, deps: [], unknown: true };
    const deps = new Set(); let unknown = false;
    const ev = (v) => {
      const k = intrinsicKey(v);
      if (k === 'Condition') { const c = evalCond(v.Condition, [...stack, name]); c.deps.forEach((d) => deps.add(d)); if (c.unknown) unknown = true; return c.value; }
      if (k === 'Fn::Equals') { const [a, b] = v[k].map(scalar); if (a === undefined || b === undefined) { unknown = true; return false; } return String(a) === String(b); }
      if (k === 'Fn::Not') return !ev(v[k][0]);
      if (k === 'Fn::And') return v[k].every(ev);
      if (k === 'Fn::Or') return v[k].some(ev);
      if (typeof v === 'boolean') return v;
      unknown = true; return false;
    };
    const scalar = (v) => {
      const k = intrinsicKey(v);
      if (k === 'Ref') { if (params[v.Ref]) { deps.add(v.Ref); const p = paramVal(v.Ref); return p.value; } if (Object.hasOwn(PSEUDO, v.Ref)) return PSEUDO[v.Ref]; if (v.Ref === 'AWS::Region') return region || undefined; return undefined; }
      if (k === 'Fn::FindInMap') { const r = evaluate(v, { deps }); return typeof r === 'string' || typeof r === 'number' ? r : undefined; }
      if (k) { const r = evaluate(v, { deps }); return typeof r === 'string' || typeof r === 'number' || typeof r === 'boolean' ? r : undefined; }
      return v;
    };
    const value = ev(conditions[name]);
    const out = { value, deps: [...deps], unknown };
    condMemo.set(name, out);
    return out;
  };
  const explainCond = (name) => { const c = evalCond(name); return `${name} is ${c.value}${c.unknown ? ' (assumed: it depends on a value the template does not have)' : ''}${c.deps.length ? ` because ${c.deps.map(explainParam).join(' and ')}` : ''}`; };
  const condAssumed = (name) => { const c = evalCond(name); return c.unknown || c.deps.some((d) => paramVal(d).how !== 'given'); };

  // ---- evaluate a property tree: parameters, pseudo parameters, conditions and mappings resolve;
  // references to resources stay as { Ref } / { Fn::GetAtt } / { Fn::Sub } for the inference to read
  function evaluate(v, ctx = {}) {
    const at = ctx.path || '';
    if (Array.isArray(v)) return v.map((x) => evaluate(x, ctx)).filter((x) => x !== NOVALUE);
    if (!isObj(v)) return v;
    const k = intrinsicKey(v);
    if (!k) { const o = {}; for (const [kk, x] of Object.entries(v)) { const e = evaluate(x, { ...ctx, path: at ? `${at}.${kk}` : kk }); if (e !== NOVALUE) o[kk] = e; } return o; }
    const a = v[k];
    switch (k) {
      case 'Ref':
        if (a === 'AWS::NoValue') return NOVALUE;
        if (params[a]) { ctx.deps && ctx.deps.add(a); const p = paramVal(a); return p.value !== undefined ? p.value : { Ref: a, param: true }; }
        if (Object.hasOwn(PSEUDO, a)) return PSEUDO[a];
        if (a === 'AWS::Region') return region || { Ref: a, pseudo: true };
        if (a === 'AWS::StackName') return opts.stackName || 'stack';
        if (/^AWS::/.test(a)) return { Ref: a, pseudo: true };
        return { Ref: a };
      case 'Condition': return evalCond(a).value;
      case 'Fn::If': {
        const [c, yes, no] = a;
        const r = evalCond(c);
        if (ctx.onIf) ctx.onIf(at, c, r);
        return evaluate(r.value ? yes : no, ctx);
      }
      case 'Fn::Equals': case 'Fn::Not': case 'Fn::And': case 'Fn::Or': return v;
      case 'Fn::GetAZs': return { __azs: true };
      case 'Fn::Select': {
        const [i0, list0] = a;
        const i = Number(evaluate(i0, ctx));
        const list = evaluate(list0, ctx);
        if (isObj(list) && list.__azs) return { __az: i, how: `!Select [${i}, !GetAZs]` };
        if (Array.isArray(list) && Number.isInteger(i) && i < list.length) return list[i];
        if (isObj(list) && list.Ref && list.param) { const p = params[list.Ref] || {}; if (/AvailabilityZone/.test(String(p.Type))) return { __az: i, how: `!Select [${i}, !Ref ${list.Ref}] (a list of AZ names with no value)` }; }
        return { 'Fn::Select': [i, list] };
      }
      case 'Fn::Join': {
        const [d, list0] = a;
        const list = evaluate(list0, ctx);
        if (Array.isArray(list) && list.every((x) => typeof x === 'string' || typeof x === 'number')) return list.join(d);
        return { 'Fn::Join': [d, list] };
      }
      case 'Fn::Split': { const [d, s0] = a; const s = evaluate(s0, ctx); return typeof s === 'string' ? s.split(d) : { 'Fn::Split': [d, s] }; }
      case 'Fn::Base64': return evaluate(a, ctx);
      case 'Fn::FindInMap': {
        const [m, k1, k2] = a.map((x) => evaluate(x, ctx));
        const hit = typeof m === 'string' && typeof k1 === 'string' && typeof k2 === 'string' && mappings[m] && mappings[m][k1] ? mappings[m][k1][k2] : undefined;
        return hit !== undefined ? hit : { 'Fn::FindInMap': [m, k1, k2] };
      }
      case 'Fn::ImportValue': { const n = evaluate(a, ctx); ctx.onImport && ctx.onImport(n); return { __import: n }; }
      case 'Fn::Sub': {
        let s = Array.isArray(a) ? a[0] : a;
        const vars = Array.isArray(a) && isObj(a[1]) ? evaluate(a[1], ctx) : {};
        if (typeof s !== 'string') return v;
        let open = false;
        s = s.replace(/\$\{(!?)([^}]+)\}/g, (all, bang, name) => {
          if (bang) return '${' + name + '}';
          if (Object.hasOwn(vars, name)) { const x = vars[name]; if (typeof x === 'string' || typeof x === 'number') return String(x); open = true; return all; }
          if (params[name]) { ctx.deps && ctx.deps.add(name); const p = paramVal(name); if (typeof p.value === 'string' || typeof p.value === 'number') return String(p.value); open = true; return all; }
          if (Object.hasOwn(PSEUDO, name) && typeof PSEUDO[name] === 'string') return PSEUDO[name];
          if (name === 'AWS::StackName') return opts.stackName || 'stack';
          if (name === 'AWS::Region' && region) return region;
          open = true; return all;
        });
        return open ? { 'Fn::Sub': Object.keys(vars).length ? [s, vars] : s } : s;
      }
      case 'Fn::GetAtt': return { 'Fn::GetAtt': Array.isArray(a) ? a : String(a).split('.') };
      case 'Fn::Cidr': return { 'Fn::Cidr': evaluate(a, ctx) };
      case 'Fn::Transform': say('info', 'macro', null, 'Fn::Transform (a macro) runs at deploy time; its output is not drawn'); return v;
      default: return evaluate(a, ctx);
    }
  }

  // ---- resources whose condition is false do not exist
  const live = [];
  for (const k of keys) {
    const r = R[k];
    if (!isObj(r) || typeof r.Type !== 'string') { say('warn', 'resource', k, `resource ${k} has no Type; skipped`); continue; }
    if (r.Condition && r.Type !== 'AWS::CDK::Metadata') {
      const c = evalCond(r.Condition);
      if (!c.value) { led(condAssumed(r.Condition) ? 'assumed' : 'derived', `${k} (${r.Type}) does not exist: its Condition ${explainCond(r.Condition)}`, [k], condAssumed(r.Condition) ? { ask: `Is ${r.Condition} false in the deployed stack (${c.deps.join(', ') || 'no parameters'})?` } : {}); continue; }
    }
    live.push(k);
  }
  const liveSet = new Set(live);

  // ---- reference extraction from an evaluated tree (Ref, GetAtt, Sub variables naming a resource)
  const refsIn = (v, out = new Set()) => {
    if (Array.isArray(v)) { for (const x of v) refsIn(x, out); return out; }
    if (!isObj(v)) return out;
    if (typeof v.Ref === 'string' && !v.param && !v.pseudo && liveSet.has(v.Ref)) out.add(v.Ref);
    const ga = v['Fn::GetAtt'];
    if (Array.isArray(ga) && liveSet.has(String(ga[0]))) out.add(String(ga[0]));
    const sub = v['Fn::Sub'];
    if (sub != null) { const s = Array.isArray(sub) ? sub[0] : sub; if (typeof s === 'string') for (const m of s.matchAll(/\$\{([A-Za-z0-9]+)(?:\.[A-Za-z0-9.]+)?\}/g)) if (liveSet.has(m[1])) out.add(m[1]); if (Array.isArray(sub)) refsIn(sub[1], out); }
    for (const [k, x] of Object.entries(v)) if (k !== 'Ref' && k !== 'Fn::GetAtt' && k !== 'Fn::Sub') refsIn(x, out);
    // a JSON document as a string (a Step Functions definition, an OpenAPI body) can carry ${Res.Arn} too
    return out;
  };
  const strRefs = (s, out) => { if (typeof s === 'string') for (const m of s.matchAll(/\$\{([A-Za-z0-9]+)(?:\.[A-Za-z0-9.]+)?\}/g)) if (liveSet.has(m[1])) out.add(m[1]); return out; };
  const walk = (v, segs) => {
    // values at a path: lists are walked at every level
    let cur = [v];
    for (const s of segs) {
      const next = [];
      for (const x of cur) {
        if (Array.isArray(x)) { for (const y of x) if (isObj(y) && Object.hasOwn(y, s)) next.push(y[s]); }
        else if (isObj(x) && !intrinsicKey(x) && Object.hasOwn(x, s)) next.push(x[s]);
      }
      cur = next;
    }
    return cur;
  };
  const literals = (list) => list.flatMap((x) => (Array.isArray(x) ? x : [x])).filter((x) => x != null && (typeof x !== 'object'));
  const mkAccess = (root, key, condNotes) => {
    const at = (p) => (p ? walk(root, String(p).split('.')) : [root]);
    const acc = {
      vals: (p) => literals(at(p)),
      refs: (p) => { const out = new Set(); for (const x of at(p)) { refsIn(x, out); strRefs(typeof x === 'string' ? x : null, out); if (isObj(x) || Array.isArray(x)) for (const s of JSON.stringify(x).match(/\$\{[A-Za-z0-9]+(?:\.[A-Za-z0-9.]+)?\}/g) || []) strRefs(s, out); } out.delete(key); return [...out]; },
      items: (p) => at(p).flatMap((x) => (Array.isArray(x) ? x : [x])).filter((x) => isObj(x)).map((x) => mkAccess(x, key, null)),
    };
    if (condNotes) acc.cond = (p) => condNotes.get(p) || null;
    return acc;
  };

  // ---- CDK: readable names from aws:cdk:path; helpers fold away
  const cdkPath = (k) => { const m = R[k].Metadata; return isObj(m) && typeof m['aws:cdk:path'] === 'string' ? m['aws:cdk:path'] : null; };
  const isCdk = live.some((k) => cdkPath(k)) || live.some((k) => R[k].Type === 'AWS::CDK::Metadata');
  const GENERIC = new Set(['Resource', 'Default']);
  const cdkSegs = (k) => { const p = cdkPath(k); if (!p) return null; const s = p.split('/').slice(1).filter((x, i, a) => i === 0 || x !== a[i - 1]); while (s.length > 1 && GENERIC.has(s[s.length - 1])) s.pop(); return s; };
  const helpers = new Map();   // key -> into
  if (isCdk) {
    for (const k of live) {
      const t = R[k].Type, p = cdkPath(k) || '';
      if (/^Custom::/.test(t) || t === 'AWS::CloudFormation::CustomResource' || /\/Custom::|CustomResourceProvider|\/LogRetention[A-Za-z0-9]*\/|BucketDeployment|AwsCliLayer|\/Provider\/framework/.test(p)) helpers.set(k, null);
    }
    // what the custom resources point at (a bucket for auto-delete, a VPC for its default SG)
    for (const k of [...helpers.keys()]) {
      if (!/^Custom::|CustomResource$/.test(R[k].Type)) continue;
      const props = evaluate(R[k].Properties || {});
      const tok = refsIn(props.ServiceToken);
      for (const t of tok) if (!helpers.has(t)) helpers.set(t, k);
      const target = [...refsIn({ ...props, ServiceToken: null })].find((x) => !helpers.has(x));
      helpers.set(k, target || null);
    }
    // roles and policies only helpers use
    for (const k of live) {
      if (helpers.has(k) || !['AWS::IAM::Role', 'AWS::IAM::Policy', 'AWS::Lambda::Permission'].includes(R[k].Type)) continue;
      const users = live.filter((u) => u !== k && refsIn(evaluate(R[u].Properties || {})).has(k));
      const mine = R[k].Type === 'AWS::IAM::Policy' ? [...refsIn(evaluate((R[k].Properties || {}).Roles || []))] : [];
      if ((users.length && users.every((u) => helpers.has(u))) || (mine.length && mine.every((u) => helpers.has(u)))) helpers.set(k, null);
    }
    const n = helpers.size;
    if (n) say('info', 'cdk', null, `CDK synth output: ${n} helper resource${n > 1 ? 's' : ''} folded away (custom resources, their provider functions, roles and layers)`);
  }

  // ---- resource records
  const usedBase = new Set();
  const out = [];
  let imports = new Set();
  for (const k of live) {
    const r = R[k];
    const condNotes = new Map();
    const props = evaluate(r.Properties || {}, {
      onIf: (p, c, res) => condNotes.set(p, { how: `${p} is Fn::If [${c}, ...] and ${explainCond(c)}`, assumed: condAssumed(c), from: [], ask: `${c} decides ${k}.${p}: is it ${res.value} in the deployed stack (${res.deps.map((d) => `${d}=${JSON.stringify(paramVal(d).value)}`).join(', ') || 'no parameters'})?` }),
      onImport: (n) => imports.add(`${k}: ${typeof n === 'string' ? n : JSON.stringify(n)}`),
    });
    const segs = cdkSegs(k);
    const readable = segs ? (segs.length > 1 && /^(Subnet)$/.test(segs[segs.length - 1]) ? segs.slice(0, -1) : segs) : null;
    const base = kitId(readable ? readable.slice(-2).join('-') : k, usedBase);
    const tags = {};
    for (const t of Array.isArray(props.Tags) ? props.Tags : []) if (isObj(t) && typeof t.Key === 'string' && (typeof t.Value === 'string' || typeof t.Value === 'number')) tags[t.Key] = String(t.Value);
    let az = null;
    if (r.Type === 'AWS::EC2::Subnet') {
      const a = props.AvailabilityZone;
      if (isObj(a) && a.__az != null) az = { index: a.__az, how: a.how };
      else if (typeof a === 'string') az = { name: a };
      else if (typeof props.AvailabilityZoneId === 'string') az = { name: props.AvailabilityZoneId };
    }
    const rec = {
      key: k, type: r.Type, src: 'cfn', base, name: readable ? readable.slice(-2).join('/') : k, display: readable ? readable.join('/') : null,
      aliases: [cdkPath(k), cdkPath(k) && cdkPath(k).split('/').slice(1).join('/'), readable && readable.join('/'), base].filter(Boolean),
      ...mkAccess(props, k, condNotes), az, tags, props,
      groupKey: readable && r.Type === 'AWS::EC2::Subnet' ? readable.join('-') : k,
      helper: helpers.has(k) ? 'cdk' : null, helperOf: helpers.get(k) || null, helperWhy: 'a CDK helper (custom resource, provider function or role)',
    };
    out.push(rec);
  }
  for (const i of imports) say('info', 'import-value', i.split(':')[0], `Fn::ImportValue ${i.split(': ').slice(1).join(': ')} comes from another stack; what it names is not drawn`);
  for (const k of live) if (R[k].Type === 'AWS::CloudFormation::Stack') say('warn', 'nested-stack', k, `${k} is a nested stack (${typeof (R[k].Properties || {}).TemplateURL === 'string' ? R[k].Properties.TemplateURL : 'TemplateURL'}): its resources are in the child template, which is not fetched; drawn as one stack node`);

  // ---- SAM source: approximate the implicit resources Events and policy templates create
  if (samSource) samShim(out, R, evaluate, refsIn, mkAccess, liveSet, say);

  // ---- parameters that decided something
  for (const [n, p] of paramUse) {
    const used = [...condMemo.values()].some((c) => c.deps.includes(n));
    if (!used) continue;
    if (p.how === 'default') led('assumed', `Parameter ${n} = ${JSON.stringify(p.value)}: its default, used to evaluate the conditions (the deployed stack may use another value)`, [], { ask: `What is ${n} in the deployed stack?` });
    else if (p.how === 'given') led('derived', `Parameter ${n} = ${JSON.stringify(p.value)} (given)`, []);
    else led('assumed', `Parameter ${n} has no value: conditions that read it were taken as false`, [], { ask: `What is ${n} in the deployed stack?` });
  }
  for (const c of Object.keys(conditions)) if (condMemo.has(c)) led(condAssumed(c) ? 'assumed' : 'derived', `Condition ${explainCond(c)}`, [], condAssumed(c) ? { ask: `Is ${c} ${evalCond(c).value} in the deployed stack?` } : {});
  if (isObj(tpl.Outputs) && Object.keys(tpl.Outputs).length) led('dropped', `Outputs (${Object.keys(tpl.Outputs).join(', ')}) are not drawn`, []);

  // ---- the sidecar: an option, else the template's own Metadata
  let flows = opts.flows || null;
  if (!flows && isObj(tpl.Metadata) && (isObj(tpl.Metadata['Prism::Flows']) || isObj(tpl.Metadata.PrismFlows))) { flows = tpl.Metadata['Prism::Flows'] || tpl.Metadata.PrismFlows; say('info', 'sidecar', null, 'the flows sidecar comes from the template Metadata (Prism::Flows)'); }

  const desc = typeof tpl.Description === 'string' ? tpl.Description.trim() : '';
  const title = opts.name || (desc && desc.split(/(?<=\.)\s/)[0].replace(/\.$/, '').length <= 60 ? desc.split(/(?<=\.)\s/)[0].replace(/\.$/, '') : null) || (opts.file ? String(opts.file) : null) || (isCdk ? 'CDK stack' : 'CloudFormation stack');
  const id = opts.id && /^[a-z][a-z0-9-]*$/.test(opts.id) ? opts.id : `cfn-${String(opts.id || opts.file || title).toLowerCase().replace(/\.(cfn|template)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^cfn-/, '') || 'stack'}`;
  const res = importInfra(out, { src: 'cfn', title, region, issues, ledger }, { ...opts, id, flows, name: opts.name || title });
  res.report.cdk = isCdk;
  res.report.sam = samSource ? 'source' : live.some((k) => /ServerlessRestApi|ServerlessHttpApi/.test(k)) || (tpl.Metadata && tpl.Metadata['AWS::ServerlessTransform']) ? 'processed' : null;
  return res;
}

// SAM source templates: Events and policy templates create resources only the transform writes out. A small
// shim adds what the inference reads (an implicit API, event source mappings, notifications, rules, inline
// policies), so a SAM source draws close to its processed form.
function samShim(out, R, evaluate, refsIn, mkAccess, liveSet, say) {
  const byKey = new Map(out.map((r) => [r.key, r]));
  const add = (key, type, props) => {
    if (byKey.has(key)) return byKey.get(key);
    liveSet.add(key);
    const rec = { key, type, src: 'cfn', base: key, name: key, aliases: [], ...mkAccess(props, key, null), az: null, tags: {}, props, sam: true };
    out.push(rec); byKey.set(key, rec);
    return rec;
  };
  for (const f of out.filter((r) => r.type === 'AWS::Serverless::Function')) {
    const ev = f.props.Events || {};
    for (const [en, e] of Object.entries(ev)) {
      const p = (e && e.Properties) || {};
      const t = e && e.Type;
      if (t === 'Api' || t === 'HttpApi') {
        const api = p.RestApiId || p.ApiId;
        const apiKey = api && api.Ref ? api.Ref : t === 'Api' ? 'ServerlessRestApi' : 'ServerlessHttpApi';
        if (!api) add(apiKey, t === 'Api' ? 'AWS::ApiGateway::RestApi' : 'AWS::ApiGatewayV2::Api', {});
        add(`${f.key}${en}Integration`, t === 'Api' ? 'AWS::ApiGateway::Method' : 'AWS::ApiGatewayV2::Integration', t === 'Api' ? { RestApiId: { Ref: apiKey }, Integration: { Uri: { 'Fn::Sub': `\${${f.key}.Arn}` } } } : { ApiId: { Ref: apiKey }, IntegrationUri: { 'Fn::GetAtt': [f.key, 'Arn'] } });
      } else if (['SQS', 'Kinesis', 'DynamoDB', 'MSK', 'MQ', 'DocumentDB'].includes(t)) {
        add(`${f.key}${en}`, 'AWS::Lambda::EventSourceMapping', { EventSourceArn: p.Queue || p.Stream || p.Broker || p.Cluster, FunctionName: { Ref: f.key } });
      } else if (t === 'S3') {
        add(`${f.key}${en}Permission`, 'AWS::Lambda::Permission', { FunctionName: { Ref: f.key }, Principal: 's3.amazonaws.com', SourceArn: { 'Fn::GetAtt': [p.Bucket && p.Bucket.Ref, 'Arn'] } });
      } else if (t === 'SNS') {
        add(`${f.key}${en}`, 'AWS::SNS::Subscription', { TopicArn: p.Topic, Endpoint: { 'Fn::GetAtt': [f.key, 'Arn'] }, Protocol: 'lambda' });
      } else if (t === 'Schedule' || t === 'ScheduleV2' || t === 'EventBridgeRule' || t === 'CloudWatchEvent') {
        add(`${f.key}${en}`, 'AWS::Events::Rule', { ScheduleExpression: p.Schedule || p.ScheduleExpression, EventBusName: p.EventBusName, Targets: [{ Arn: { 'Fn::GetAtt': [f.key, 'Arn'] }, Id: en }] });
      } else if (t) say('info', 'sam-source', `${f.key}.${en}`, `SAM event type ${t} is not approximated; import the processed template`);
    }
    // policy templates and inline statements: the resources they name become an inline role policy
    const pol = [].concat(f.props.Policies || []);
    const named = new Set();
    for (const p of pol) refsIn(p, named);
    named.delete(f.key);
    if (named.size) {
      const roleKey = `${f.key}Role`;
      const acts = pol.flatMap((p) => (p && typeof p === 'object' ? Object.keys(p).filter((k) => /Policy$/.test(k)) : [p])).filter((x) => typeof x === 'string');
      add(roleKey, 'AWS::IAM::Role', { Policies: [{ PolicyName: 'sam', PolicyDocument: { Statement: [{ Effect: 'Allow', Action: acts.length ? acts : ['*'], Resource: [...named].map((n) => ({ 'Fn::GetAtt': [n, 'Arn'] })) }] } }] });
      if (!f.props.Role) { f.props.Role = { 'Fn::GetAtt': [roleKey, 'Arn'] }; Object.assign(f, mkAccess(f.props, f.key, null)); }
    }
  }
}

// ---- CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let file = null;
  // --rules takes a list of groups when one follows (--rules AppSg,DbSg or --rules=AppSg,DbSg), else it means every group
  const bare = (i) => args[i] === '--rules' && (!args[i + 1] || args[i + 1].startsWith('--') || fs.existsSync(args[i + 1]));
  const rulesArg = (a) => { const i = a.findIndex((x) => x === '--rules' || x.startsWith('--rules=')); return i < 0 ? undefined : a[i].startsWith('--rules=') ? a[i].slice(8) : bare(i) ? true : a[i + 1]; };
  for (let i = 0; i < args.length; i++) { if (args[i] === '--ledger' || bare(i) || args[i].startsWith('--rules=')) continue; if (args[i].startsWith('--')) { i++; continue; } file = file || args[i]; }
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  if (!file) { console.error('usage: cfn.mjs <template.yaml|json> [--flows sidecar.json] [--id x] [--param K=V]... [--story id|none|guess] [--rules [AppSg,DbSg]] [--out spec.json] [--svg out.svg] [--theme light|dark] [--ledger]'); process.exit(1); }
  const params = {};
  args.forEach((a, i) => { if (a === '--param') { const [k, ...v] = String(args[i + 1]).split('='); params[k] = v.join('='); } });
  const flows = opt('--flows') ? JSON.parse(fs.readFileSync(opt('--flows'), 'utf8')) : null;
  const { spec, report } = fromCloudFormation(fs.readFileSync(file, 'utf8'), { file: path.basename(file).replace(/\.(ya?ml|json|template)$/i, ''), id: opt('--id'), flows, params, story: opt('--story'), rules: rulesArg(args) });
  const n = (s) => report.issues.filter((i) => i.severity === s).length;
  console.log(`cfn: ${spec.id} ${spec.w}x${spec.h} (${report.tile.size}), ${spec.nodes.length} nodes, ${spec.groups.length} groups, ${spec.wires.length} wires, ${(spec.steps || []).length} steps, ${(spec.timeline || []).length} legs; ${n('error')} error, ${n('warn')} warn, ${n('info')} info; lint ${report.lint.filter((f) => f.severity === 'error').length} error`);
  for (const i of report.issues.filter((x) => x.severity !== 'info')) console.log(`  ${i.severity.padEnd(5)} ${i.code.padEnd(14)} ${i.message}`);
  if (args.includes('--ledger')) for (const l of report.ledger) console.log(`  [${l.kind}] ${l.fact}${l.from.length ? `\n        <- ${l.from.join(', ')}` : ''}${l.ask ? `\n        ? ${l.ask}` : ''}`);
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify({ version: 1, section: { id: 'cfn-import', title: 'CLOUDFORMATION IMPORT' }, diagrams: [spec] }, null, 2) + '\n');
  if (opt('--svg')) { const { standalone } = await import('../awd.mjs'); fs.writeFileSync(opt('--svg'), standalone(spec, { theme: opt('--theme') || 'auto' })); }
}
