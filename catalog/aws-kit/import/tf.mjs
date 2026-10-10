// tf.mjs: Terraform plan or state JSON (terraform show -json) -> Prism AWS kit spec (k33bz fork). No deps.
//
//   import { fromTerraform, tfId } from './import/tf.mjs';
//   const { spec, report } = fromTerraform(planJsonText, { id, name, flows, story });
//
// Reads planned_values (a plan) or values (a state), modules recursively, count and for_each instances
// (module.vpc.aws_subnet.private[0], aws_subnet.az["us-east-1a"]). Edges come from
// configuration.*.expressions.references (resolved through var.* to the module call and module.x.out to the
// module's outputs; count.index and each.key pair instances), and, in a state, from attribute values that
// equal another resource's id or ARN. Types map through resolveIcon(type, { from: 'tf' }); the inference,
// the ledger, the flows sidecar and the layout are the CloudFormation importer's (iac.mjs). Terraform
// addresses become kit ids with tfId(). Raw HCL is rejected: Terraform alone knows how to expand it.
//
// CLI: node catalog/aws-kit/import/tf.mjs plan.json [--flows sidecar.json] [--id x] [--story id|none|guess]
//        [--out spec.json] [--svg out.svg] [--theme light|dark] [--ledger]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importInfra, kitId } from './iac.mjs';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export const HCL_MESSAGE = 'this is Terraform HCL source: only Terraform can expand modules, count and for_each. Run `terraform plan -out plan.tfplan` then `terraform show -json plan.tfplan > plan.json` (or `terraform show -json > state.json` for a deployed stack) and import the JSON';
export const looksLikeHcl = (text) => /^\s*(resource|data|module|provider|variable|output|locals|terraform)\s+("[^"]*"\s*)*\{/m.test(String(text));

/** A Terraform address as a kit id: module.vpc.aws_subnet.private[0] -> vpc-subnet-private-0. */
export function tfId(address, used) {
  const s = String(address)
    .replace(/\bmodule\.([A-Za-z0-9_-]+)(\[[^\]]*\])?\./g, (_, m, i) => `${m}${i ? '-' + i.slice(1, -1) : ''}.`)
    .replace(/(^|\.)aws_/, '$1').replace(/^data\.aws_/, 'data.')
    .replace(/\["([^"]*)"\]/g, '-$1').replace(/\[(\d+)\]/g, '-$1')
    .replace(/\./g, '-');
  return kitId(s, used, 'tf');
}

// parse "a.b[0].c" / 'aws_subnet.az["x"].id' into the resource part and its index
function parseRef(ref) {
  const m = /^(?:(data)\.)?([a-z0-9_]+)\.([A-Za-z0-9_-]+)(?:\[(\d+|"[^"]*")\])?/.exec(ref);
  if (!m) return null;
  return { data: !!m[1], type: m[2], name: m[3], index: m[4] == null ? null : /^\d+$/.test(m[4]) ? Number(m[4]) : m[4].slice(1, -1) };
}

export function fromTerraform(content, opts = {}) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : typeof content === 'string' ? content : null;
  let doc = isObj(content) ? content : null;
  if (!doc) {
    const t = String(text).replace(/^﻿/, '').trim();
    if (!t.startsWith('{')) { if (looksLikeHcl(t)) throw new Error(HCL_MESSAGE); throw new Error('not Terraform JSON: expected the output of terraform show -json'); }
    try { doc = JSON.parse(t); } catch (err) { throw new Error(`not valid JSON: ${err.message}`); }
  }
  if (!doc.format_version || !(doc.planned_values || doc.values)) throw new Error('not terraform show -json output: expected format_version and planned_values (a plan) or values (a state)');
  const kind = doc.planned_values ? 'plan' : 'state';
  const issues = [], ledger = [];
  const say = (severity, code, element, message) => { if (!issues.some((x) => x.code === code && x.element === element && x.message === message)) issues.push({ severity, code, element, message }); };
  const root = (doc.planned_values || doc.values).root_module || {};
  const conf = (doc.configuration && doc.configuration.root_module) || null;
  if (!conf) say('info', 'tf-config', null, `no configuration block (${kind === 'state' ? 'a state' : 'a plan'} without it): edges come only from attribute values that match another resource's id or ARN`);

  // ---- instances, modules first-class
  const inst = [];
  const walkMod = (m, modPath) => {
    for (const r of m.resources || []) inst.push({ ...r, modPath });
    for (const c of m.child_modules || []) walkMod(c, c.address || modPath);
  };
  walkMod(root, '');
  const managed = inst.filter((r) => r.mode !== 'data' && /^aws_/.test(r.type));
  const skipped = inst.filter((r) => r.mode !== 'data' && !/^aws_/.test(r.type));
  if (skipped.length) say('info', 'tf-provider', null, `${skipped.length} resource${skipped.length > 1 ? 's' : ''} from other providers (${[...new Set(skipped.map((r) => r.type))].slice(0, 5).join(', ')}) are not drawn`);
  const byAddr = new Map(managed.map((r) => [r.address, r]));
  // resource address within its module, without the index: module.vpc.aws_subnet.private
  const resAddr = (r) => r.address.replace(/\[[^\]]*\]$/, '');
  const instancesOf = new Map();
  for (const r of managed) { const k = resAddr(r); if (!instancesOf.has(k)) instancesOf.set(k, []); instancesOf.get(k).push(r); }
  // the configuration module for a module path (module.a[0].module.b -> root.module_calls.a.module.module_calls.b.module)
  const confMod = (modPath) => {
    if (!conf) return null;
    let m = conf;
    for (const seg of [...String(modPath).matchAll(/module\.([A-Za-z0-9_-]+)/g)].map((x) => x[1])) {
      m = m && m.module_calls && m.module_calls[seg] && m.module_calls[seg].module;
      if (!m) return null;
    }
    return m;
  };
  const confRes = (r) => { const m = confMod(r.modPath); return m ? (m.resources || []).find((c) => c.type === r.type && c.name === r.name && (c.mode || 'managed') === (r.mode || 'managed')) : null; };
  const parentOf = (modPath) => { const m = /^(.*?)(?:\.)?module\.([A-Za-z0-9_-]+)(\[[^\]]*\])?$/.exec(modPath); return m ? { parent: m[1], call: m[2] } : null; };

  // ---- reference resolution in a module scope; `self` pairs count/for_each instances
  const resolveRefs = (list, modPath, self, depth = 0) => {
    const out = new Set();
    if (!Array.isArray(list) || depth > 6) return out;
    const paired = list.includes('count.index') || list.includes('each.key') || list.includes('each.value');
    const byRes = new Map();
    for (const ref of list) {
      if (/^(count|each|path|terraform|self|local)\./.test(ref) || /^(count|each)$/.test(ref)) continue;
      if (ref.startsWith('var.')) {
        const v = ref.slice(4).split(/[.[]/)[0];
        const p = parentOf(modPath);
        if (!p) continue;
        const call = confMod(p.parent) && confMod(p.parent).module_calls && confMod(p.parent).module_calls[p.call];
        const ex = call && call.expressions && call.expressions[v];
        if (ex && ex.references) for (const x of resolveRefs(ex.references, p.parent, null, depth + 1)) out.add(x);
        continue;
      }
      if (ref.startsWith('module.')) {
        const m = /^module\.([A-Za-z0-9_-]+)(?:\[[^\]]*\])?\.([A-Za-z0-9_-]+)/.exec(ref);
        if (!m) continue;
        const child = confMod(modPath) && confMod(modPath).module_calls && confMod(modPath).module_calls[m[1]];
        const o = child && child.module && child.module.outputs && child.module.outputs[m[2]];
        const childPath = `${modPath ? modPath + '.' : ''}module.${m[1]}`;
        if (o && o.expression && o.expression.references) for (const x of resolveRefs(o.expression.references, childPath, null, depth + 1)) out.add(x);
        continue;
      }
      const pr = parseRef(ref);
      if (!pr || pr.data) continue;
      const key = `${modPath ? modPath + '.' : ''}${pr.type}.${pr.name}`;
      if (!byRes.has(key)) byRes.set(key, new Set());
      if (pr.index != null) byRes.get(key).add(pr.index);
    }
    for (const [key, idx] of byRes) {
      const all = instancesOf.get(key) || [];
      if (!all.length) continue;
      if (idx.size) { for (const r of all) if (idx.has(r.index)) out.add(r.address); continue; }
      if (paired && self && self.index != null) { const hit = all.find((r) => r.index === self.index); if (hit) { out.add(hit.address); continue; } }
      for (const r of all) out.add(r.address);
    }
    return out;
  };

  // ---- value index for states (and known plan values): an id or ARN names its resource
  const valIndex = new Map();
  for (const r of managed) for (const a of ['id', 'arn']) { const v = r.values && r.values[a]; if (typeof v === 'string' && v.length > 4 && !valIndex.has(v)) valIndex.set(v, r.address); }
  // an ARN with a path (bucket/*, table/x/index/*) names the resource whose ARN it starts with
  const lookup = (v) => { if (valIndex.has(v)) return valIndex.get(v); if (!/^arn:/.test(v)) return null; const seg = v.split('/'); for (let k = seg.length - 1; k >= 1; k--) { const t = seg.slice(0, k).join('/'); if (valIndex.has(t)) return valIndex.get(t); } return null; };
  const matchVals = (vs, self) => { const out = new Set(); for (const v of vs) { if (typeof v !== 'string') continue; const hit = lookup(v); if (hit && hit !== self) out.add(hit); } return out; };

  // ---- accessors over values and expressions
  const walk = (v, segs) => {
    let cur = [v];
    for (const s of segs) {
      const next = [];
      for (const x of cur) {
        if (Array.isArray(x)) { for (const y of x) if (isObj(y) && Object.hasOwn(y, s)) next.push(y[s]); }
        else if (isObj(x) && Object.hasOwn(x, s)) next.push(x[s]);
      }
      cur = next;
    }
    return cur;
  };
  const literals = (list) => list.flatMap((x) => (Array.isArray(x) ? x : [x])).filter((x) => x != null && typeof x !== 'object');
  const exprRefs = (exprs) => exprs.flatMap((x) => (Array.isArray(x) ? x : [x])).flatMap((x) => (isObj(x) ? (Array.isArray(x.references) ? x.references : Object.values(x).flatMap((y) => exprRefs([y]))) : []));
  const parseDoc = (v) => { if (typeof v !== 'string' || !/^\s*\{/.test(v)) return v; try { return JSON.parse(v); } catch { return v; } };
  const mkAccess = (values, exprs, r, extraRefs = null) => {
    const at = (v, p) => (p ? walk(v, String(p).split('.')) : [v]);
    const acc = {
      vals: (p) => literals(at(values, p)),
      refs: (p) => {
        const out = new Set();
        const ex = exprs ? (p ? walk(exprs, String(p).split('.')) : [exprs]) : [];
        for (const x of resolveRefs(exprRefs(ex), r.modPath, r)) out.add(x);
        for (const x of matchVals(literals(at(values, p)), r.address)) out.add(x);
        if (extraRefs && (!p || p === 'Resource')) for (const x of extraRefs) out.add(x);
        out.delete(r.address);
        return [...out];
      },
      items: (p) => {
        const vs = at(values, p).flatMap((x) => (Array.isArray(x) ? x : [x])).map(parseDoc);
        const es = exprs ? walk(exprs, String(p).split('.')).flatMap((x) => (Array.isArray(x) ? x : [x])) : [];
        if (!vs.length && es.length) {
          // the value is unknown in the plan (an ARN not known until apply): the expression's references remain
          return es.map((e) => mkAccess({}, isObj(e) && !e.references ? e : null, r, isObj(e) && e.references ? resolveRefs(e.references, r.modPath, r) : extraRefs));
        }
        return vs.filter((x) => isObj(x)).map((x, i) => {
          const e = es[i];
          // a JSON document in a string (a policy): its expression's references belong to every statement
          const whole = isObj(e) && Array.isArray(e.references) ? resolveRefs(e.references, r.modPath, r) : extraRefs;
          return mkAccess(x, isObj(e) && !e.references ? e : null, r, whole);
        });
      },
    };
    return acc;
  };

  // ---- records
  const used = new Set();
  const records = [];
  for (const r of managed) {
    const c = confRes(r);
    const values = r.values || {};
    const base = tfId(r.address, used);
    const tags = isObj(values.tags) ? values.tags : isObj(values.tags_all) ? values.tags_all : {};
    let az = null;
    if (r.type === 'aws_subnet' || r.type === 'aws_default_subnet') {
      if (typeof values.availability_zone === 'string') az = { name: values.availability_zone };
      else if (typeof values.availability_zone_id === 'string') az = { name: values.availability_zone_id };
      else if (c && c.expressions && c.expressions.availability_zone && (c.expressions.availability_zone.references || []).some((x) => /^(count\.index|each\.key)$/.test(x)) && typeof r.index === 'number') az = { index: r.index, how: `availability_zone is indexed by count.index (${r.index})` };
    }
    const nm = typeof tags.Name === 'string' && tags.Name && !/\$\{/.test(tags.Name) ? tags.Name : `${r.modPath ? r.modPath.replace(/module\./g, '') + '/' : ''}${r.name}${r.index != null ? `[${typeof r.index === 'number' ? r.index : JSON.stringify(r.index)}]` : ''}`;
    records.push({
      key: r.address, type: r.type, src: 'tf', base, name: nm,
      aliases: [r.address.replace(/^module\./, '').replace(/\.module\./g, '.'), resAddr(r) === r.address ? null : null].filter(Boolean),
      ...mkAccess(values, c ? c.expressions || {} : null, r), az, tags, props: values,
      groupKey: resAddr(r), modPath: r.modPath, index: r.index,
    });
  }
  // resource addresses without an index name every instance (the sidecar may say aws_lb.web for aws_lb.web)
  for (const [k, list] of instancesOf) if (list.length === 1 && list[0].address !== k) { const rec = records.find((x) => x.key === list[0].address); if (rec) rec.aliases.push(k); }
  for (const rec of records) rec.aliases.push(rec.base);
  if (kind === 'plan' && doc.resource_changes) {
    const del = doc.resource_changes.filter((c) => c.change && Array.isArray(c.change.actions) && c.change.actions.includes('delete') && !c.change.actions.includes('create'));
    if (del.length) say('info', 'tf-plan', null, `the plan destroys ${del.length} resource${del.length > 1 ? 's' : ''} (${del.slice(0, 4).map((c) => c.address).join(', ')}); they are not drawn`);
  }
  const region = (() => {
    const pc = doc.configuration && doc.configuration.provider_config;
    const aws = pc && (pc.aws || Object.values(pc).find((p) => p && p.name === 'aws'));
    const ex = aws && aws.expressions && aws.expressions.region;
    if (ex && typeof ex.constant_value === 'string') return ex.constant_value;
    if (ex && Array.isArray(ex.references)) { const v = (ex.references.find((x) => x.startsWith('var.')) || '').slice(4); const vv = doc.variables && doc.variables[v]; if (vv && typeof vv.value === 'string') return vv.value; }
    return null;
  })();
  const title = opts.name || (opts.file ? String(opts.file) : `Terraform ${kind}`);
  const id = opts.id && /^[a-z][a-z0-9-]*$/.test(opts.id) ? opts.id : `tf-${String(opts.id || opts.file || kind).toLowerCase().replace(/\.(tfplan|tfstate|plan|state)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^tf-/, '') || 'plan'}`;
  ledger.push({ kind: 'derived', fact: `Read a Terraform ${kind} (format ${doc.format_version}${doc.terraform_version ? `, Terraform ${doc.terraform_version}` : ''}): ${managed.length} AWS resource instances in ${new Set(managed.map((r) => r.modPath)).size} module${new Set(managed.map((r) => r.modPath)).size > 1 ? 's' : ''}`, from: [] });
  const res = importInfra(records, { src: 'tf', title, region, issues, ledger }, { ...opts, id, name: opts.name || title });
  res.report.tf = { kind, region, modules: [...new Set(managed.map((r) => r.modPath).filter(Boolean))] };
  return res;
}

// ---- CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let file = null;
  for (let i = 0; i < args.length; i++) { if (args[i] === '--ledger') continue; if (args[i].startsWith('--')) { i++; continue; } file = file || args[i]; }
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  if (!file) { console.error('usage: tf.mjs <plan.json> [--flows sidecar.json] [--id x] [--story id|none|guess] [--out spec.json] [--svg out.svg] [--theme light|dark] [--ledger]'); process.exit(1); }
  const flows = opt('--flows') ? JSON.parse(fs.readFileSync(opt('--flows'), 'utf8')) : null;
  const { spec, report } = fromTerraform(fs.readFileSync(file, 'utf8'), { file: path.basename(file).replace(/\.json$/i, ''), id: opt('--id'), flows, story: opt('--story') });
  const n = (s) => report.issues.filter((i) => i.severity === s).length;
  console.log(`tf: ${spec.id} ${spec.w}x${spec.h} (${report.tile.size}), ${spec.nodes.length} nodes, ${spec.groups.length} groups, ${spec.wires.length} wires, ${(spec.steps || []).length} steps, ${(spec.timeline || []).length} legs; ${n('error')} error, ${n('warn')} warn, ${n('info')} info; lint ${report.lint.filter((f) => f.severity === 'error').length} error`);
  for (const i of report.issues.filter((x) => x.severity !== 'info')) console.log(`  ${i.severity.padEnd(5)} ${i.code.padEnd(14)} ${i.message}`);
  if (args.includes('--ledger')) for (const l of report.ledger) console.log(`  [${l.kind}] ${l.fact}${l.from.length ? `\n        <- ${l.from.join(', ')}` : ''}${l.ask ? `\n        ? ${l.ask}` : ''}`);
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify({ version: 1, section: { id: 'tf-import', title: 'TERRAFORM IMPORT' }, diagrams: [spec] }, null, 2) + '\n');
  if (opt('--svg')) { const { standalone } = await import('../awd.mjs'); fs.writeFileSync(opt('--svg'), standalone(spec, { theme: opt('--theme') || 'auto' })); }
}
