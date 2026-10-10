// Import a design into the AWS kit, or export a kit diagram, whatever the format (k33bz fork). No deps.
// One entry point over the per-format modules (drawio.mjs, mermaid.mjs), which load on first use:
//
//   import { importDiagram, exportDiagram, detectFormat } from './import/index.mjs';
//   const { spec, report } = await importDiagram(text, { from: 'auto', id: 'my-api' });
//   const { text } = await exportDiagram(spec, { to: 'drawio' });
//   const { text } = await exportDiagram(spec, { to: 'svg', at: 0.5 });   // a still at mid-cycle (frame.mjs)
//   const { frames } = await exportDiagram(spec, { to: 'storyboard' });   // one still per numbered step
//   const { png } = await exportDiagram(spec, { to: 'png', at: 'poster' }); // a Buffer (headless Chrome or Edge)
//
// CLI: node catalog/aws-kit/import/index.mjs <file> [--from auto|drawio|mermaid|plantuml|d2] [--id x]
//        [--out spec.json] [--svg out.svg] [--at 0.5|poster] [--theme light|dark|auto]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORMATS = ['drawio', 'mermaid', 'plantuml', 'd2'];

/** Which format a source is, from its content (and file name when there is one). */
export function detectFormat(content, file = '') {
  const ext = path.extname(String(file)).toLowerCase();
  if (Buffer.isBuffer(content) && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'drawio';
  const head = String(content).slice(0, 4000);
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
  else out = (await load('d2')).fromD2(String(content), opts);
  return { ...out, report: { ...out.report, from } };
}

/**
 * Export a kit diagram spec: to drawio (.drawio XML), mermaid (flowchart, or dialect architecture-beta),
 * svg (standalone; still: the static diagram; at: a fraction of the clock or 'poster', frozen there) or
 * storyboard ({ frames: [{ n, at, text, svg }] }, one still per numbered step, and text: an HTML page)
 * or png ({ png, width, height }: the frame at `at`, default the poster, light by default, at `scale`).
 */
export async function exportDiagram(spec, { to = 'drawio', dialect, theme, still, at, scale } = {}) {
  if (to === 'drawio') {
    const m = await load('drawio');
    const fn = m.toDrawio || (await load('drawio-export').catch(() => ({}))).toDrawio;
    if (typeof fn !== 'function') throw new Error('the draw.io exporter is not available');
    return { to, text: fn(spec) };
  }
  if (to === 'mermaid') return { to, text: (await load('mermaid')).toMermaid(spec, dialect ? { dialect } : {}) };
  if (to === 'svg' && at != null) return { to, at, text: (await import(new URL('../frame.mjs', import.meta.url).href)).frame(spec, at, { theme: theme || 'auto' }) };
  if (to === 'svg') {
    const { standalone } = await import(new URL('../awd.mjs', import.meta.url).href);
    return { to, text: standalone(spec, { theme: theme || 'auto', still: !!still }) };
  }
  if (to === 'png') {
    const { toPng } = await import(new URL('../png.mjs', import.meta.url).href);
    const moment = at ?? 'poster';
    return { to, at: moment, ...(await toPng(spec, { at: moment, theme: theme && theme !== 'auto' ? theme : 'light', scale: scale ?? 2 })) };
  }
  if (to === 'storyboard') {
    const frames = (await import(new URL('../frame.mjs', import.meta.url).href)).storyboard(spec, { theme: theme || 'auto' });
    return { to, frames, text: storyboardHtml(spec, frames) };
  }
  throw new Error(`cannot export to ${JSON.stringify(to)}: drawio, mermaid, svg, png or storyboard`);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A storyboard as one self-contained page: each frame an <img> of its own svg, so frames keep their own ids. */
export function storyboardHtml(spec, frames) {
  const img = (fr) => `<img src="data:image/svg+xml;base64,${Buffer.from(fr.svg).toString('base64')}" alt="Step ${esc(fr.n)}: ${esc(fr.text)}">`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(spec.name || spec.id)}</title>` +
    '<style>:root{color-scheme:light dark}body{font:15px/1.5 Arial,sans-serif;max-width:1000px;margin:24px auto;padding:0 16px}ol{list-style:none;padding:0}li{margin:0 0 40px}img{width:100%;height:auto}h2{font-size:17px;margin:0 0 8px}</style>' +
    `<h1>${esc(spec.name || spec.id)}</h1><ol>${frames.map((fr) => `<li><h2>${esc(fr.n)}. ${esc(fr.text)}</h2>${img(fr)}</li>`).join('')}</ol>\n`;
}

// ---- CLI ----
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, ...rest] = process.argv.slice(2);
  const opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  if (!file) { console.error('usage: index.mjs <file> [--from auto|drawio|mermaid|plantuml|d2] [--id x] [--out spec.json] [--svg out.svg] [--at 0.5|poster] [--theme light|dark|auto]'); process.exit(1); }
  const raw = fs.readFileSync(file);
  const from = opt('--from') || detectFormat(raw, file);
  const content = from === 'drawio' && !/\.png$/i.test(file) ? raw.toString('utf8') : from === 'drawio' ? raw : raw.toString('utf8');
  const { spec, report } = await importDiagram(content, { from, file, id: opt('--id'), name: opt('--name') });
  const n = (s) => report.issues.filter((i) => i.severity === s).length;
  console.log(`${report.from}: ${spec.id} ${spec.w}x${spec.h} (${report.tile?.size || report.tile || 'tile'}), ${(spec.nodes || []).length} nodes, ${(spec.groups || []).length} groups, ${(spec.wires || []).length} wires, ${(spec.steps || []).length} steps; ${n('error')} error, ${n('warn')} warn, ${n('info')} info; ${(report.unmapped || []).length} unmapped`);
  for (const i of report.issues.filter((x) => x.severity !== 'info')) console.log(`  ${i.severity.padEnd(5)} ${i.code.padEnd(16)} ${i.message}`);
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(spec, null, 2) + '\n');
  if (opt('--svg')) fs.writeFileSync(opt('--svg'), (await exportDiagram(spec, { to: 'svg', theme: opt('--theme'), at: opt('--at') })).text);
}
