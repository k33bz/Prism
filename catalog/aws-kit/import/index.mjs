// Import a design into the AWS kit, or export a kit diagram, whatever the format (k33bz fork). No deps.
// One entry point over the per-format modules (drawio.mjs, mermaid.mjs, plantuml.mjs, d2.mjs, cfn.mjs,
// tf.mjs), which load on first use:
//
//   import { importDiagram, exportDiagram, detectFormat } from './import/index.mjs';
//   const { spec, report } = await importDiagram(text, { from: 'auto', id: 'my-api' });
//   const { text } = await exportDiagram(spec, { to: 'drawio' });
//
//   // CloudFormation (YAML/JSON, CDK synth, SAM) and Terraform (terraform show -json) take a flows sidecar:
//   await importDiagram(template, { from: 'cfn', flows: sidecar, params: { Env: 'prod' }, story: 'page-view' });
//
// CLI: node catalog/aws-kit/import/index.mjs <file> [--from auto|drawio|mermaid|plantuml|d2|cfn|tf] [--id x]
//        [--flows sidecar.json] [--param K=V]... [--story id|none|guess] [--ledger]
//        [--out spec.json] [--svg out.svg] [--theme light|dark|auto]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORMATS = ['drawio', 'mermaid', 'plantuml', 'd2', 'cfn', 'tf'];

// CloudFormation: the version key, or Resources whose entries carry an AWS:: (or Custom::) Type
const CFN_RE = /(^|[\s{,"'])AWSTemplateFormatVersion["']?\s*:/;
const CFN_RES = /^Resources:\s*$[\s\S]*?^\s+Type:\s*["']?(AWS|Custom)::/m;
const CFN_JSON = /"Resources"\s*:\s*\{[\s\S]*?"Type"\s*:\s*"(AWS|Custom)::/;
// Terraform: terraform show -json output, or HCL (sent to tf.mjs, which explains how to get the JSON)
const TF_JSON = /^\s*\{[\s\S]*"format_version"\s*:[\s\S]*"(planned_values|values)"\s*:/;
const HCL = /^\s*(resource|module|provider|terraform|variable|data)\s+("[^"]*"\s*)*\{/m;

/** Which format a source is, from its content (and file name when there is one). */
export function detectFormat(content, file = '') {
  const ext = path.extname(String(file)).toLowerCase();
  if (Buffer.isBuffer(content) && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'drawio';
  const head = String(content).slice(0, 4000);
  if (!Buffer.isBuffer(content) || !/^\s*</.test(head)) {
    const text = String(content);
    if (/\.tf(state)?$/.test(file) || (/^\s*\{/.test(text) && TF_JSON.test(text)) || (!/^\s*[{<]/.test(text) && HCL.test(head) && !/^\s*(flowchart|graph|architecture-beta)\b/m.test(head))) return 'tf';
    if (CFN_RE.test(head) || CFN_RES.test(text) || (/^\s*\{/.test(text) && CFN_JSON.test(text))) return 'cfn';
  }
  if (/\.(drawio|dio)$/.test(file) || /\.drawio\.(svg|png)$/i.test(file) || /<mxfile\b|<mxGraphModel\b|%3CmxGraphModel|mxgraph\./.test(head) || (/<svg\b/.test(head) && /\bcontent="/.test(head))) return 'drawio';
  if (ext === '.puml' || ext === '.plantuml' || /^\s*@startuml/m.test(head)) return 'plantuml';
  if (ext === '.mmd' || ext === '.mermaid' || /^\s*(%%.*\n\s*)*(architecture-beta|flowchart|graph)\b/m.test(head) || /^---\n[\s\S]*?\n---\n\s*(architecture-beta|flowchart|graph)\b/.test(head)) return 'mermaid';
  if (ext === '.d2' || /^\s*[\w.-]+\s*(->|<->|--)\s*[\w.-]+/m.test(head) || /^\s*direction:\s*(right|down|left|up)/m.test(head)) return 'd2';
  return null;
}

const load = (name) => import(new URL(`./${name}.mjs`, import.meta.url).href);

/**
 * Import a design. Returns { spec, report } as the format module does, plus report.from.
 * from: 'auto' (default) detects the format from the content and the file name.
 */
export async function importDiagram(content, opts = {}) {
  const from = !opts.from || opts.from === 'auto' ? detectFormat(content, opts.file) : opts.from;
  if (!FORMATS.includes(from)) throw new Error(`cannot tell the format${opts.file ? ` of ${opts.file}` : ''}: pass from (one of ${FORMATS.join(', ')})`);
  // the importers name a diagram after its source file: the file's own name, not its folder or extension
  if (opts.file) opts = { ...opts, file: path.basename(String(opts.file)).replace(/\.(drawio\.(svg|png)|[^.]+)$/i, '') };
  let out;
  if (from === 'drawio') out = (await load('drawio')).fromDrawio(content, opts);
  else if (from === 'mermaid') out = (await load('mermaid')).fromMermaid(String(content), opts);
  else if (from === 'plantuml') out = (await load('plantuml')).fromPlantUml(String(content), opts);
  else if (from === 'cfn') out = (await load('cfn')).fromCloudFormation(Buffer.isBuffer(content) ? content.toString('utf8') : content, opts);
  else if (from === 'tf') out = (await load('tf')).fromTerraform(Buffer.isBuffer(content) ? content.toString('utf8') : content, opts);
  else out = (await load('d2')).fromD2(String(content), opts);
  return { ...out, report: { ...out.report, from } };
}

/** Export a kit diagram spec: to drawio (.drawio XML), mermaid (flowchart, or dialect architecture-beta) or svg (standalone). */
export async function exportDiagram(spec, { to = 'drawio', dialect, theme, still } = {}) {
  if (to === 'drawio') {
    const m = await load('drawio');
    const fn = m.toDrawio || (await load('drawio-export').catch(() => ({}))).toDrawio;
    if (typeof fn !== 'function') throw new Error('the draw.io exporter is not available');
    return { to, text: fn(spec) };
  }
  if (to === 'mermaid') return { to, text: (await load('mermaid')).toMermaid(spec, dialect ? { dialect } : {}) };
  if (to === 'svg') {
    const { standalone } = await import(new URL('../awd.mjs', import.meta.url).href);
    return { to, text: standalone(spec, { theme: theme || 'auto', still: !!still }) };
  }
  throw new Error(`cannot export to ${JSON.stringify(to)}: drawio, mermaid or svg`);
}

// ---- CLI ----
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, ...rest] = process.argv.slice(2);
  const opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  if (!file) { console.error('usage: index.mjs <file> [--from auto|drawio|mermaid|plantuml|d2|cfn|tf] [--id x] [--flows sidecar.json] [--param K=V]... [--story id|none|guess] [--ledger] [--out spec.json] [--svg out.svg] [--theme light|dark|auto]'); process.exit(1); }
  const raw = fs.readFileSync(file);
  const from = opt('--from') || detectFormat(raw, file);
  const content = from === 'drawio' && !/\.png$/i.test(file) ? raw.toString('utf8') : from === 'drawio' ? raw : raw.toString('utf8');
  const params = {};
  rest.forEach((a, i) => { if (a === '--param' && rest[i + 1]) { const [k, ...v] = rest[i + 1].split('='); params[k] = v.join('='); } });
  const flows = opt('--flows') ? JSON.parse(fs.readFileSync(opt('--flows'), 'utf8')) : undefined;
  const { spec, report } = await importDiagram(content, { from, file, id: opt('--id'), name: opt('--name'), flows, params: Object.keys(params).length ? params : undefined, story: opt('--story') });
  const n = (s) => report.issues.filter((i) => i.severity === s).length;
  console.log(`${report.from}: ${spec.id} ${spec.w}x${spec.h} (${report.tile?.size || report.tile || 'tile'}), ${(spec.nodes || []).length} nodes, ${(spec.groups || []).length} groups, ${(spec.wires || []).length} wires, ${(spec.steps || []).length} steps; ${n('error')} error, ${n('warn')} warn, ${n('info')} info; ${(report.unmapped || []).length} unmapped`);
  for (const i of report.issues.filter((x) => x.severity !== 'info')) console.log(`  ${i.severity.padEnd(5)} ${i.code.padEnd(16)} ${i.message}`);
  if (report.ledger) {
    const c = (k) => report.ledger.filter((l) => l.kind === k).length;
    console.log(`  ledger: ${c('derived')} derived, ${c('assumed')} assumed, ${c('dropped')} dropped${report.story ? `; story: ${report.story.channel}${report.story.flow ? ` (${report.story.flow})` : ''}` : ''}`);
    if (rest.includes('--ledger')) for (const l of report.ledger) console.log(`  [${l.kind}] ${l.fact}${l.from.length ? `
        <- ${l.from.join(', ')}` : ''}${l.ask ? `
        ? ${l.ask}` : ''}`);
  }
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(spec, null, 2) + '\n');
  if (opt('--svg')) fs.writeFileSync(opt('--svg'), (await exportDiagram(spec, { to: 'svg', theme: opt('--theme') })).text);
}
