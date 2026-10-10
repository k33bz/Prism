// plantuml.mjs: PlantUML with awslabs aws-icons-for-plantuml -> Prism AWS kit spec (k33bz fork). No deps.
// Same model and pipeline as mermaid.mjs (ir.mjs); only the front end differs.
//
//   fromPlantUml(text, { id, name, story }) -> { spec, report }
//
// Read: group macros as frame kinds (AWSCloudGroup, RegionGroup, VPCGroup, AvailabilityZoneGroup,
// PublicSubnetGroup, PrivateSubnetGroup, SecurityGroupGroup, AutoScalingGroupGroup, AWSAccountGroup,
// CorporateDataCenterGroup, GenericGroup...), icon macros Macro(alias, "label", "technology", "description")
// (technology becomes the sub line), plain elements (actor, person, rectangle, node, database, component,
// queue, storage, cloud, package, frame) with or without a block, links (-->, ->, ..>, --, <-->, -[#c]->,
// -[dashed]->) with direction words (-right-> -r-> -left- -up- -down-) as edge sides, ": label",
// title, left to right direction. Directives ride in ' prism: comments (same keys as Mermaid).
// Ignored: !include/!define, skinparam, notes, legends, sequence diagrams.
import { newIr, issue, directive, cleanText, buildSpec } from './ir.mjs';
import { resolveIcon } from '../../aws-icons/resolve.mjs';

const DIRS = { r: 'R', ri: 'R', rig: 'R', righ: 'R', right: 'R', l: 'L', le: 'L', lef: 'L', left: 'L', u: 'T', up: 'T', d: 'B', do: 'B', dow: 'B', down: 'B' };
const OPP = { R: 'L', L: 'R', T: 'B', B: 'T' };
const ELEMENT = /^(actor|person|rectangle|node|database|component|queue|storage|cloud|package|frame|folder|file|artifact|agent|boundary|control|entity|card|hexagon|stack|collections|usecase|interface)\b\s*(.*)$/;
const NAME = '(?:"[^"]*"|[A-Za-z0-9_.:-]+)';

export function parsePlantUml(text) {
  const ir = newIr('plantuml');
  ir.dir = 'TD';
  const stack = [];
  const ids = new Map();   // alias -> node or group
  let block = null, ignored = 0;
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const parent = () => (stack.length ? stack[stack.length - 1] : null);
  const addNode = (n) => { if (ids.has(n.id)) { issue(ir, 'warn', 'parse', n.id, `${n.id} is declared twice; kept the first`); return ids.get(n.id); } n.parent = parent(); ir.nodes.push(n); ids.set(n.id, n); return n; };
  const addGroup = (g, open) => { g.parent = parent(); ir.groups.push(g); ids.set(g.id, g); if (open) stack.push(g.id); };
  const ref = (s) => { const t = s.replace(/^"|"$/g, ''); if (!ids.has(t)) { const n = { id: t.replace(/[^\w-]+/g, '_'), label: t, icon: null, iconFrom: 'text', implicit: true }; addNode(n); ids.set(t, n); } return ids.get(t).id; };
  const EDGE = new RegExp(`^(${NAME})\\s*(<|<<|\\*|o)?([-.]+)(?:\\[([^\\]]*)\\])?([a-z]+)?([-.]*)(?:\\[([^\\]]*)\\])?(>|>>|\\*|o)?\\s*(${NAME})\\s*(?::\\s*(.+))?$`);
  lines.forEach((raw, i) => {
    let l = raw.trim();
    const d = l.match(/^'\s*prism\s*:\s*(.*)$/i);
    if (d) { directive(ir, d[1], i + 1); return; }
    if (block) { if (block.test(l)) block = null; return; }
    if (!l || l.startsWith("'")) return;
    if (/^\/'/.test(l)) { if (!/'\/\s*$/.test(l)) block = /'\/\s*$/; return; }
    if (/^@(start|end)uml/.test(l) || /^!/.test(l) || /^(hide|show|scale|autonumber|skinparam\s+\w+\s+\S)/.test(l)) return;
    if (/^skinparam\b.*\{\s*$/.test(l)) { block = /^\}\s*$/; return; }
    if (/^skinparam\b/.test(l)) return;
    if (/^(note|legend|header|footer)\b/.test(l) && !/:/.test(l.split(/\s+/)[1] || '')) { if (!/^note\b.*:/.test(l)) block = /^end\s*(note|legend|header|footer)|^end(note|legend|header|footer)/; ignored++; return; }
    if (/^left to right direction/.test(l)) { ir.dir = 'LR'; return; }
    if (/^top to bottom direction/.test(l)) { ir.dir = 'TD'; return; }
    let m;
    if ((m = l.match(/^title\s+(.+)$/))) { ir.title = cleanText(m[1]); return; }
    if (l === '}') { stack.pop(); return; }
    // group macros: XGroup(alias[, "label"]) {
    if ((m = l.match(/^(\w+)\(\s*([\w-]+)\s*(?:,\s*"([^"]*)")?[^)]*\)\s*(\{)?\s*$/))) {
      const [, macro, alias, label, open] = m;
      const r = resolveIcon(macro, { from: 'plantuml' });
      if (r.kind === 'group' || /Group$/.test(macro)) {
        addGroup({ id: alias, label: label != null ? cleanText(label) : null, kind: r.kind === 'group' ? r.group : null, icon: r.kind === 'group' && r.group === 'gen' && r.id ? r.id : null, macro }, !!open);
        return;
      }
    }
    // icon macros: Macro(alias, "label", "technology", "description")
    if ((m = l.match(/^(\w+)\(\s*([\w-]+)\s*,\s*"([^"]*)"(?:\s*,\s*"([^"]*)")?(?:\s*,\s*"([^"]*)")?\s*\)\s*(\{)?\s*$/))) {
      const [, macro, alias, label, tech, desc, open] = m;
      if (open) { addGroup({ id: alias, label: cleanText(label), icon: macro, iconFrom: 'plantuml' }, true); return; }
      addNode({ id: alias, label: cleanText(label), sub: tech ? cleanText(tech) : desc ? cleanText(desc) : null, icon: macro, iconFrom: 'plantuml' });
      return;
    }
    // plain elements: actor "Users" as users, rectangle "VPC" as vpc {, database db
    if ((m = l.match(ELEMENT))) {
      const kind = m[1];
      let rest = m[2].trim(), open = false;
      if (rest.endsWith('{')) { open = true; rest = rest.slice(0, -1).trim(); }
      rest = rest.replace(/\s*<<[^>]*>>\s*/g, ' ').replace(/\s+#\S+$/, '').trim();
      let label = null, alias = null, a;
      if ((a = rest.match(/^"([^"]*)"\s+as\s+([\w-]+)$/)) || (a = rest.match(/^\[([^\]]*)\]\s+as\s+([\w-]+)$/)) || (a = rest.match(/^:([^:]*):\s+as\s+([\w-]+)$/))) { label = a[1]; alias = a[2]; }
      else if ((a = rest.match(/^([\w-]+)\s+as\s+"([^"]*)"$/))) { alias = a[1]; label = a[2]; }
      else if ((a = rest.match(/^"([^"]*)"$/)) || (a = rest.match(/^\[([^\]]*)\]$/)) || (a = rest.match(/^:([^:]*):$/))) { label = a[1]; alias = a[1].replace(/[^\w-]+/g, '_'); }
      else if ((a = rest.match(/^([\w-]+)$/))) { alias = a[1]; label = a[1]; }
      if (!alias) { issue(ir, 'warn', 'parse', `line ${i + 1}`, `line ${i + 1} is not PlantUML this importer reads: ${l}`); return; }
      if (open || ['package', 'frame', 'folder'].includes(kind) && open) { addGroup({ id: alias, label: cleanText(label) }, open); return; }
      addNode({ id: alias, label: cleanText(label), icon: kind === 'actor' || kind === 'person' ? 'Users' : null, iconFrom: 'plantuml', shapeHint: kind === 'database' ? 'cylinder' : null });
      return;
    }
    if ((m = l.match(/^together\s*\{$/))) { stack.push(parent()); return; }
    if ((m = l.match(EDGE))) {
      const [, a, lh, b1, st1, word, b2, st2, rh, b, label] = m;
      const body = b1 + (b2 || ''), style = `${st1 || ''},${st2 || ''}`;
      if (body.length < 1 || (!/-|\./.test(body))) return;
      const dir = word ? DIRS[word.toLowerCase()] : null;
      if (word && !dir) { issue(ir, 'info', 'parse', `line ${i + 1}`, `unknown direction "${word}"`); }
      const e = { a: ref(a), b: ref(b), aHead: !!lh, bHead: !!rh, dashed: body.includes('.') || /dashed|dotted/.test(style), label: label ? cleanText(label.replace(/\\n/g, '\n')) : null, src: l, line: i + 1 };
      if (dir) { e.sa = dir; e.sb = OPP[dir]; }
      ir.edges.push(e);
      return;
    }
    if (/^(@|class |interface |enum |participant |sequence)/.test(l)) { ignored++; return; }
    issue(ir, 'warn', 'parse', `line ${i + 1}`, `line ${i + 1} is not PlantUML this importer reads: ${l}`);
  });
  if (ignored) issue(ir, 'info', 'ignored', null, `${ignored} note/legend/other statement(s) ignored`);
  // direction words place nodes; links without one follow the diagram direction, as a soft hint
  const sided = ir.edges.filter((e) => e.sa);
  if (sided.length) {
    ir.sided = true;
    const [sa, sb] = ir.dir === 'LR' ? ['R', 'L'] : ['B', 'T'];
    for (const e of ir.edges) if (!e.sa) { e.sa = sa; e.sb = sb; e.soft = true; }
  }
  for (const n of ir.nodes) if (n.implicit) issue(ir, 'info', 'implicit', n.id, `${n.id} is used in a link but never declared; added it`);
  return ir;
}

export function fromPlantUml(text, opts = {}) {
  return buildSpec(parsePlantUml(text), opts);
}
