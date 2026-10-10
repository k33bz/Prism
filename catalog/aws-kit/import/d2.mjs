// d2.mjs: D2 -> Prism AWS kit spec (k33bz fork). No deps. Same model and pipeline as mermaid.mjs (ir.mjs).
//
//   fromD2(text, { id, name, story }) -> { spec, report }
//
// Read: shapes (a, a: Label, "quoted key", dotted paths a.b.c), containers (a shape with children is a
// group, its kind from the label, then the key, then the icon), icon: URLs (the file name names the
// service, e.g. icons.terrastruct.com/aws/Compute/AWS-Lambda.svg), label:, shape: person, connections
// (->, <-, <->, --, chains a -> b -> c, ": label", a block with style.stroke-dash for dashed),
// direction:, and steps (each step board's new connections become one numbered step: the story).
// Directives ride in # prism: comments (same keys as Mermaid). Ignored: layers, scenarios, vars, classes,
// globs, style (the kit's theme sets colors), near, tooltip, link.
import { newIr, issue, directive, cleanText, buildSpec } from './ir.mjs';

// tokens: strings, braces, separators, words; comments dropped (directives kept)
function lex(text, ir) {
  const out = [];
  const src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let i = 0, line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { out.push({ t: 'nl', line }); line++; i++; continue; }
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '#') {
      let j = src.indexOf('\n', i); if (j < 0) j = src.length;
      const d = src.slice(i + 1, j).match(/^\s*prism\s*:\s*(.*)$/i);
      if (d) directive(ir, d[1], line);
      i = j; continue;
    }
    if (c === '|') {   // block string |md ... |
      const m = src.slice(i).match(/^\|+[a-z]*\s/);
      if (m) { const close = m[0].trim().replace(/[a-z]+$/, ''); const j = src.indexOf(close, i + m[0].length); const body = src.slice(i + m[0].length, j < 0 ? src.length : j); line += (body.match(/\n/g) || []).length; out.push({ t: 'str', v: body.trim(), line }); i = j < 0 ? src.length : j + close.length; continue; }
    }
    if (c === '"' || c === "'") {
      let j = i + 1, v = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') { v += src[j + 1]; j += 2; continue; } v += src[j++]; }
      out.push({ t: 'str', v, line }); i = j + 1; continue;
    }
    // a colon separates a key from its value only before a space, a brace, a quote or the line end
    // (a URL keeps its own)
    const sep = (k) => src[k] === ':' && /^:(\s|$|\{|"|')/.test(src.slice(k, k + 2));
    if (c === ':' ? sep(i) : '{};'.includes(c)) { out.push({ t: c === ';' ? 'nl' : c, line }); i++; continue; }
    const arrow = src.slice(i).match(/^(<->|<-|->|--)(?![>-])/);
    if (arrow) { out.push({ t: 'arrow', v: arrow[1], line }); i += arrow[1].length; continue; }
    let j = i;
    while (j < src.length && !/[\s{};#]/.test(src[j]) && !sep(j) && !/^(<->|<-|->|--)(?![>-])/.test(src.slice(j)) && src[j] !== '"') j++;
    if (j === i) j = i + 1;
    out.push({ t: 'word', v: src.slice(i, j), line });
    i = j;
  }
  return out;
}

export function parseD2(text) {
  const ir = newIr('d2');
  ir.dir = 'TD';
  const toks = lex(text, ir);
  const shapes = new Map();   // full path -> { path, label, icon, parent (path), children: Set }
  const conns = [];           // { a, b, aHead, bHead, label, dashed, step }
  const steps = [];
  let p = 0;
  const peek = () => toks[p], next = () => toks[p++];
  const skipNl = () => { while (peek() && peek().t === 'nl') p++; };
  const ensure = (path) => {
    if (!path) return null;
    if (shapes.has(path)) return shapes.get(path);
    const parts = path.split('.');
    const parent = parts.length > 1 ? ensure(parts.slice(0, -1).join('.')) : null;
    const s = { path, key: parts[parts.length - 1], label: null, icon: null, parent: parent ? parent.path : null, children: new Set(), shape: null };
    if (parent) parent.children.add(path);
    shapes.set(path, s);
    return s;
  };
  const RESERVED = new Set(['label', 'icon', 'shape', 'style', 'near', 'tooltip', 'link', 'width', 'height', 'class', 'classes', 'vars', 'direction', 'grid-rows', 'grid-columns', 'constraint', 'top', 'left', 'filled', 'source-arrowhead', 'target-arrowhead']);
  const skipValue = () => {   // a value or a block
    let depth = 0;
    while (peek()) {
      const t = peek();
      if (t.t === '{') depth++;
      else if (t.t === '}') { if (!depth) return; depth--; if (!depth) { p++; return; } }
      else if (t.t === 'nl' && !depth) return;
      p++;
    }
  };
  const readValue = () => { const out = []; while (peek() && !['nl', '{', '}'].includes(peek().t)) out.push(next()); return out.map((t) => (t.v != null ? t.v : t.t)).join(' ').trim(); };
  const keyPath = (scope, k) => (scope ? `${scope}.${k}` : k);
  // a statement inside a scope (a shape path, a step index)
  const block = (scope, step) => {
    for (;;) {
      skipNl();
      const t = peek();
      if (!t || t.t === '}') return;
      // read the first key and any connection chain
      const items = [];
      const readKey = () => { const k = next(); if (!k || (k.t !== 'word' && k.t !== 'str')) return null; return k.v; };
      let k = readKey();
      if (k == null) { p++; continue; }
      items.push(k);
      const arrows = [];
      while (peek() && peek().t === 'arrow') { arrows.push(next().v); const k2 = readKey(); if (k2 == null) break; items.push(k2); }
      if (arrows.length) {
        let label = null, dashed = false;
        if (peek() && peek().t === ':') { next(); label = readValue() || null; }
        if (peek() && peek().t === '{') {
          next(); let depth = 1;
          while (peek() && depth) { const x = next(); if (x.t === '{') depth++; else if (x.t === '}') depth--; else if (x.t === 'word' && /stroke-dash/.test(x.v)) dashed = true; else if (x.t === 'word' && x.v === 'label' && peek() && peek().t === ':') { next(); label = readValue(); } }
        }
        for (let j = 0; j < arrows.length; j++) {
          const a = items[j], b = items[j + 1], ar = arrows[j];
          conns.push({ a: keyPath(scope, a), b: keyPath(scope, b), aHead: ar === '<-' || ar === '<->', bHead: ar === '->' || ar === '<->', label, dashed, step, line: t.line, src: `${a} ${ar} ${b}${label ? ': ' + label : ''}` });
        }
        continue;
      }
      // special keys
      if (k === 'direction' && peek() && peek().t === ':') { next(); const v = readValue(); if (!scope) ir.dir = { right: 'LR', left: 'RL', down: 'TD', up: 'BT' }[v] || ir.dir; continue; }
      if (k === 'steps' && !scope && step == null) {
        if (peek() && peek().t === ':') next();
        skipNl();
        if (peek() && peek().t === '{') {
          next();
          for (;;) {
            skipNl();
            if (!peek() || peek().t === '}') { p++; break; }
            const name = next().v;
            if (peek() && peek().t === ':') next();
            skipNl();
            const st = { name, label: null, edges: [] };
            steps.push(st);
            if (peek() && peek().t === '{') { next(); block(null, steps.length - 1); p++; }
          }
        }
        continue;
      }
      if (['layers', 'scenarios', 'vars', 'classes'].includes(k) && !scope) { issue(ir, 'info', 'ignored', k, `D2 ${k} are not imported`); if (peek() && peek().t === ':') next(); skipNl(); skipValue(); continue; }
      if (k === 'label' && step != null && !scope && peek() && peek().t === ':') { next(); steps[step].label = readValue(); continue; }
      // property of the scope shape (icon: label: shape: style...)
      const last = k.split('.').pop();
      if (scope && RESERVED.has(k.split('.')[0])) {
        const s = shapes.get(scope);
        if (peek() && peek().t === ':') next();
        if (k === 'icon' && s) s.icon = readValue();
        else if (k === 'label' && s) s.label = readValue();
        else if (k === 'shape' && s) s.shape = readValue();
        else skipValue();
        continue;
      }
      if (RESERVED.has(last) && k.includes('.')) {   // a.icon: url
        const s = ensure(keyPath(scope, k.split('.').slice(0, -1).join('.')));
        if (peek() && peek().t === ':') next();
        if (last === 'icon') s.icon = readValue(); else if (last === 'label') s.label = readValue(); else if (last === 'shape') s.shape = readValue(); else skipValue();
        continue;
      }
      if (/[*]/.test(k)) { issue(ir, 'info', 'ignored', k, `D2 glob ${k} is not imported`); if (peek() && peek().t === ':') next(); skipValue(); continue; }
      // a shape declaration
      const s = ensure(keyPath(scope, k));
      if (step != null) s.step = s.step == null ? step : s.step;
      if (peek() && peek().t === ':') { next(); const v = readValue(); if (v) s.label = v; }
      if (peek() && peek().t === '{') { next(); block(s.path, step); p++; }
    }
  };
  block(null, null);
  // a top-level reference to a nested key: real D2 would create a new shape; join it to the nested one
  const byKey = new Map();
  for (const s of shapes.values()) { if (!byKey.has(s.key)) byKey.set(s.key, []); byKey.get(s.key).push(s.path); }
  const fix = (path) => {
    const s = shapes.get(path);
    if (s && (s.children.size || s.label || s.icon || s.parent)) return path;
    const others = (byKey.get(path.split('.').pop()) || []).filter((x) => x !== path && x.endsWith('.' + path));
    if (!path.includes('.') && others.length === 1) {
      issue(ir, 'info', 'd2-scope', path, `"${path}" at the top level would be a new shape in D2; joined it to ${others[0]}`);
      if (s && !s.children.size) shapes.delete(path);
      return others[0];
    }
    return path;
  };
  for (const c of conns) { c.a = fix(c.a); c.b = fix(c.b); ensure(c.a); ensure(c.b); }
  // containers (shapes with children) are groups
  const used = new Set();
  const idOf = new Map();
  for (const s of shapes.values()) { let id = s.key.replace(/[^\w-]+/g, '_') || 'x'; let k = id, i = 2; while (used.has(k)) k = `${id}_${i++}`; used.add(k); idOf.set(s.path, k); }
  const iconName = (u) => { if (!u) return null; const f = decodeURIComponent(String(u).split(/[?#]/)[0].split('/').pop() || ''); return f.replace(/\.(svg|png|jpe?g)$/i, '').replace(/^(Arch|Res|Arch-Category)_/, '').replace(/_(16|32|48|64)$/i, ''); };
  for (const s of shapes.values()) {
    const parent = s.parent ? idOf.get(s.parent) : null;
    const label = s.label != null ? cleanText(s.label) : s.key;
    if (s.children.size) ir.groups.push({ id: idOf.get(s.path), label, icon: iconName(s.icon), iconFrom: 'text', parent });
    else ir.nodes.push({ id: idOf.get(s.path), label, icon: s.shape === 'person' ? 'Users' : iconName(s.icon), iconFrom: 'text', parent, shapeHint: s.shape === 'cylinder' ? 'cylinder' : null });
  }
  conns.forEach((c, i) => ir.edges.push({ a: idOf.get(c.a), b: idOf.get(c.b), aHead: c.aHead, bHead: c.bHead, label: c.label ? cleanText(c.label) : null, dashed: c.dashed, src: c.src, line: c.line, step: c.step }));
  if (steps.length) {
    ir.d2Steps = steps.map((st, i) => ({ label: st.label, name: st.name, edges: ir.edges.map((e, k) => (e.step === i ? k : -1)).filter((k) => k >= 0) })).filter((st) => st.edges.length);
  }
  return ir;
}

export function fromD2(text, opts = {}) {
  return buildSpec(parseD2(text), opts);
}
