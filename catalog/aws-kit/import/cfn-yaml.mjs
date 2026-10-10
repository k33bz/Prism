// cfn-yaml.mjs: a zero-dependency loader for the YAML that CloudFormation templates use (k33bz fork).
// Short-form intrinsics become their long JSON form, as the CloudFormation service reads them:
//   !Ref X -> { Ref: X }, !Condition X -> { Condition: X }, !GetAtt A.B -> { 'Fn::GetAtt': ['A', 'B'] },
//   !Sub, !If, !Select, !GetAZs, !Join, !Split, !FindInMap, !ImportValue, !Equals, !Not, !And, !Or, !Base64,
//   !Cidr, !Transform, !ToJsonString, !Length -> { 'Fn::<Name>': value }.
// The subset: block mappings and sequences (compact "- key: value" entries and sequences at their key's
// indent), flow collections [..] and {..} across lines, plain, 'single' and "double" quoted scalars
// (multi-line plain and quoted scalars fold), literal | and folded > block scalars with chomping and
// indentation indicators, comments, anchors and aliases, document markers. Plain scalars resolve as
// YAML 1.2 core does (null, true/false, decimal integers and floats); everything else stays a string, so
// "2010-09-09", "10.0.0.0/16" and "yes" are strings.
//
//   import { parseYaml } from './cfn-yaml.mjs';
//   const template = parseYaml(text);

const LONG = { Ref: 'Ref', Condition: 'Condition' };
export const INTRINSIC_TAGS = ['Ref', 'Condition', 'GetAtt', 'Sub', 'If', 'Select', 'GetAZs', 'Join', 'Split', 'FindInMap', 'ImportValue',
  'Equals', 'Not', 'And', 'Or', 'Base64', 'Cidr', 'Transform', 'ToJsonString', 'Length'];

export class YamlError extends Error {
  constructor(message, line) { super(line ? `YAML line ${line}: ${message}` : `YAML: ${message}`); this.line = line; }
}

function applyTag(tag, v, line) {
  if (tag === '!' || tag === '!!str') return v == null ? '' : String(v);
  if (/^!!/.test(tag)) return v;   // !!map, !!seq, !!int...: the value as parsed
  const name = tag.slice(1);
  if (!INTRINSIC_TAGS.includes(name)) throw new YamlError(`unknown tag ${tag} (CloudFormation knows ${INTRINSIC_TAGS.map((t) => '!' + t).join(' ')})`, line);
  if (name === 'GetAtt' && typeof v === 'string') { const i = v.indexOf('.'); v = i > 0 ? [v.slice(0, i), v.slice(i + 1)] : [v]; }
  if (name === 'GetAZs' && v == null) v = '';
  return { [LONG[name] || `Fn::${name}`]: v };
}

function plainValue(s) {
  if (s === '' || s === '~' || /^(null|Null|NULL)$/.test(s)) return null;
  if (/^(true|True|TRUE)$/.test(s)) return true;
  if (/^(false|False|FALSE)$/.test(s)) return false;
  if (/^[-+]?(0|[1-9][0-9]*)$/.test(s)) { const n = Number(s); if (Number.isSafeInteger(n)) return n; }
  if (/^[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) || /^[-+]?\d+[eE][-+]?\d+$/.test(s)) return Number(s);
  return s;
}

export function parseYaml(text) {
  const src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (/^ *\t/m.test(src.split('\n').filter((l) => /^\s*\S/.test(l) && !/^\s*#/.test(l)).join('\n'))) {
    const at = src.split('\n').findIndex((l) => /^ *\t/.test(l) && /\S/.test(l));
    throw new YamlError('a tab in the indentation (YAML indents with spaces)', at + 1);
  }
  const raw = src.split('\n');
  // strip comments outside quotes; keep the text for flow/quoted continuation
  const lines = raw.map((t, i) => ({ no: i + 1, text: t, indent: t.match(/^ */)[0].length }));
  const anchors = new Map();
  let li = 0;

  // ---- helpers over lines
  const stripComment = (s) => {
    let q = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === q) { if (q === "'" && s[i + 1] === "'") { i++; continue; } q = null; } else if (q === '"' && c === '\\') i++; continue; }
      if ((c === '"' || c === "'") && (i === 0 || /[\s[{,:]/.test(s[i - 1]))) { q = c; continue; }
      if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).replace(/\s+$/, '');
    }
    return s.replace(/\s+$/, '');
  };
  const significant = (l) => { const t = stripComment(l.text).trim(); return t !== '' && !/^(---|\.\.\.)(\s|$)/.test(t) && !/^%/.test(t); };
  const nextSig = () => { while (li < lines.length && !significant(lines[li])) { if (/^---/.test(lines[li].text) && li > 0 && seenContent) { li = lines.length; break; } li++; } return li < lines.length ? lines[li] : null; };
  let seenContent = false;

  // find ": " (or ":" at the end) that splits a mapping key, outside quotes and brackets
  const keySplit = (s) => {
    let q = null, depth = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === q) { if (q === "'" && s[i + 1] === "'") { i++; continue; } q = null; } else if (q === '"' && c === '\\') i++; continue; }
      if ((c === '"' || c === "'") && (i === 0 || /[\s[{,]/.test(s[i - 1]))) { q = c; continue; }
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
      else if (c === '#' && i > 0 && /\s/.test(s[i - 1])) return -1;
      else if (c === ':' && depth === 0 && (i === s.length - 1 || s[i + 1] === ' ')) return i;
      // a value that starts with a flow collection, a tag or an alias is not a key
      if (i === 0 && (c === '[' || c === '{' || c === '!' || c === '*' || c === '&' || c === '|' || c === '>')) return -1;
    }
    return -1;
  };
  const keyText = (k, line) => {
    k = k.trim();
    if (/^"/.test(k)) return dq(k, line).v;
    if (/^'/.test(k)) return sq(k, line).v;
    return k;
  };

  // ---- quoted scalars from a string (may come from several joined lines)
  function dq(s, line) {
    let out = '', i = 1;
    const ESC = { n: '\n', t: '\t', r: '\r', '0': '\0', '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', e: '\x1b', ' ': ' ', N: '\u0085', _: ' ', L: ' ', P: ' ', a: '\x07', v: '\x0b' };
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === '"') return { v: out, end: i + 1 };
      if (c === '\\') {
        const n = s[++i];
        if (n === 'x' || n === 'u' || n === 'U') { const len = n === 'x' ? 2 : n === 'u' ? 4 : 8; out += String.fromCodePoint(parseInt(s.slice(i + 1, i + 1 + len), 16)); i += len; }
        else if (n === '\n') { while (s[i + 1] === ' ') i++; }
        else out += ESC[n] != null ? ESC[n] : n;
      } else if (c === '\n') {
        // line folding: one newline becomes a space, blank lines stay newlines
        out = out.replace(/[ \t]+$/, '');
        let blanks = 0;
        while (s[i + 1] === '\n' || s[i + 1] === ' ') { if (s[i + 1] === '\n') blanks++; i++; }
        out += blanks ? '\n'.repeat(blanks) : ' ';
      } else out += c;
    }
    throw new YamlError('unterminated double-quoted string', line);
  }
  function sq(s, line) {
    let out = '';
    for (let i = 1; i < s.length; i++) {
      const c = s[i];
      if (c === "'") { if (s[i + 1] === "'") { out += "'"; i++; continue; } return { v: out, end: i + 1 }; }
      if (c === '\n') {
        out = out.replace(/[ \t]+$/, '');
        let blanks = 0;
        while (s[i + 1] === '\n' || s[i + 1] === ' ') { if (s[i + 1] === '\n') blanks++; i++; }
        out += blanks ? '\n'.repeat(blanks) : ' ';
      } else out += c;
    }
    throw new YamlError('unterminated single-quoted string', line);
  }

  // ---- flow context: a cursor over the rest of the current line, pulling in following lines as needed
  function flowValue(start, line0) {
    // gather text until brackets balance (across lines), then parse it
    let buf = start, depth = 0, q = null;
    const scan = (s, from) => {
      for (let i = from; i < s.length; i++) {
        const c = s[i];
        if (q) { if (c === q) { if (q === "'" && s[i + 1] === "'") { i++; continue; } q = null; } else if (q === '"' && c === '\\') i++; continue; }
        if (c === '"' || c === "'") { q = c; continue; }
        if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) { const nl = s.indexOf('\n', i); buf = s.slice(0, i) + (nl >= 0 ? s.slice(nl) : ''); return scan(buf, i); }
        if (c === '[' || c === '{') depth++;
        else if (c === ']' || c === '}') { depth--; if (depth === 0) return i + 1; }
      }
      return -1;
    };
    let end = scan(buf, 0);
    while (end < 0) {
      if (li >= lines.length) throw new YamlError('unterminated flow collection', line0);
      const from = buf.length;
      buf += '\n' + lines[li++].text;
      end = scan(buf, from + 1);
    }
    const rest = buf.slice(end).trim();
    if (rest && !rest.startsWith('#')) throw new YamlError(`unexpected text after a flow collection: "${rest.slice(0, 30)}"`, line0);
    const p = { s: buf.slice(0, end), i: 0 };
    const v = flowNode(p, line0);
    return v;
  }
  const ws = (p) => { while (p.i < p.s.length && /[\s]/.test(p.s[p.i])) p.i++; };
  function flowNode(p, line) {
    ws(p);
    let tag = null, anchor = null;
    for (;;) {
      if (p.s[p.i] === '!') { const m = /^!!?[A-Za-z0-9_:-]*/.exec(p.s.slice(p.i)); tag = m[0]; p.i += m[0].length; ws(p); continue; }
      if (p.s[p.i] === '&') { const m = /^&([^\s,[\]{}]+)/.exec(p.s.slice(p.i)); anchor = m[1]; p.i += m[0].length; ws(p); continue; }
      break;
    }
    let v;
    const c = p.s[p.i];
    if (c === '*') { const m = /^\*([^\s,[\]{}]+)/.exec(p.s.slice(p.i)); p.i += m[0].length; if (!anchors.has(m[1])) throw new YamlError(`unknown alias *${m[1]}`, line); v = anchors.get(m[1]); }
    else if (c === '[') {
      p.i++; v = [];
      for (;;) {
        ws(p);
        if (p.s[p.i] === ']') { p.i++; break; }
        // a single-pair mapping inside a sequence ([a: b]) is rare in templates; plain entries are the norm
        const item = flowNode(p, line);
        ws(p);
        if (p.s[p.i] === ':' ) { p.i++; const val = flowNode(p, line); v.push({ [String(item)]: val }); ws(p); } else v.push(item);
        if (p.s[p.i] === ',') { p.i++; continue; }
        if (p.s[p.i] === ']') { p.i++; break; }
        throw new YamlError(`expected , or ] in a flow sequence near "${p.s.slice(p.i, p.i + 20)}"`, line);
      }
    } else if (c === '{') {
      p.i++; v = {};
      for (;;) {
        ws(p);
        if (p.s[p.i] === '}') { p.i++; break; }
        const k = flowScalar(p, line, true);
        ws(p);
        let val = null;
        if (p.s[p.i] === ':') { p.i++; ws(p); val = p.s[p.i] === ',' || p.s[p.i] === '}' ? null : flowNode(p, line); }
        v[String(k)] = val;
        ws(p);
        if (p.s[p.i] === ',') { p.i++; continue; }
        if (p.s[p.i] === '}') { p.i++; break; }
        throw new YamlError(`expected , or } in a flow mapping near "${p.s.slice(p.i, p.i + 20)}"`, line);
      }
    } else if (c === ',' || c === ']' || c === '}' || p.i >= p.s.length) v = tag ? (tag === '!GetAZs' ? '' : null) : null;
    else v = flowScalar(p, line, false);
    if (tag) v = applyTag(tag, v, line);
    if (anchor) anchors.set(anchor, v);
    return v;
  }
  function flowScalar(p, line, isKey) {
    const c = p.s[p.i];
    if (c === '"') { const r = dq(p.s.slice(p.i), line); p.i += r.end; return r.v; }
    if (c === "'") { const r = sq(p.s.slice(p.i), line); p.i += r.end; return r.v; }
    let j = p.i;
    while (j < p.s.length) {
      const ch = p.s[j];
      if (ch === ',' || ch === ']' || ch === '}' ) break;
      if (ch === ':' && (j + 1 >= p.s.length || /[\s,[\]{}]/.test(p.s[j + 1]))) break;
      j++;
    }
    const t = p.s.slice(p.i, j).replace(/\s+/g, ' ').trim();
    p.i = j;
    return isKey ? t : plainValue(t);
  }

  // ---- block scalars (| and >)
  function blockScalar(header, parentIndent, line) {
    const m = /^([|>])([-+]?)(\d?)([-+]?)\s*(#.*)?$/.exec(header);
    if (!m) throw new YamlError(`bad block scalar header "${header}"`, line);
    const literal = m[1] === '|', chomp = m[2] || m[4] || '', explicit = m[3] ? Number(m[3]) : 0;
    const body = [];
    let ind = explicit ? parentIndent + explicit : -1;
    while (li < lines.length) {
      const t = lines[li].text;
      if (t.trim() === '') { body.push(''); li++; continue; }
      const n = lines[li].indent;
      if (ind < 0) { if (n <= parentIndent) break; ind = n; }
      if (n < ind) break;
      body.push(t.slice(ind)); li++;
    }
    // trailing blank lines belong to chomping
    let trail = 0;
    while (body.length && body[body.length - 1] === '') { body.pop(); trail++; }
    let out;
    if (literal) out = body.join('\n');
    else {
      out = '';
      for (let i = 0; i < body.length; i++) {
        const l = body[i];
        if (i === 0) { out = l; continue; }
        const prev = body[i - 1];
        if (l === '') out += '\n';
        else if (/^\s/.test(l) || /^\s/.test(prev) || prev === '') out += (prev === '' ? '' : '\n') + l;
        else out += ' ' + l;
      }
    }
    if (!body.length) return chomp === '+' ? '\n'.repeat(trail) : '';
    if (chomp === '-') return out;
    if (chomp === '+') return out + '\n' + '\n'.repeat(trail);
    return out + '\n';
  }

  // ---- an inline value after "key:" or "- " (rest of the line), with continuation lines for plain/quoted scalars
  function inlineValue(rest, parentIndent, line) {
    let tag = null, anchor = null;
    let s = rest.trim();
    for (;;) {
      let m;
      if ((m = /^(!!?[A-Za-z0-9_:-]*)(\s+|$)/.exec(s))) { tag = m[1]; s = s.slice(m[0].length); continue; }
      if ((m = /^&([^\s]+)(\s+|$)/.exec(s))) { anchor = m[1]; s = s.slice(m[0].length); continue; }
      break;
    }
    let v;
    if (s === '' || s.startsWith('#')) {
      // the value is the following block (a tagged block sequence or mapping), or empty
      const nx = nextSig();
      if (nx && (nx.indent > parentIndent || (nx.indent === parentIndent && /^-(\s|$)/.test(stripComment(nx.text).trim()) && !tag))) v = block(nx.indent, line);
      else if (nx && nx.indent === parentIndent && /^-(\s|$)/.test(stripComment(nx.text).trim()) && tag) v = block(nx.indent, line);
      else v = null;
    } else if (s[0] === '|' || s[0] === '>') v = blockScalar(s, parentIndent, line);
    else if (s[0] === '[' || s[0] === '{') v = flowValue(s, line);
    else if (s[0] === '*') { const name = s.slice(1).trim(); if (!anchors.has(name)) throw new YamlError(`unknown alias *${name}`, line); v = anchors.get(name); }
    else if (s[0] === '"' || s[0] === "'") {
      let buf = s;
      for (;;) {
        try { const r = (s[0] === '"' ? dq : sq)(buf, line); const after = buf.slice(r.end).trim(); if (after && !after.startsWith('#')) throw new YamlError(`unexpected text after a quoted scalar: "${after.slice(0, 30)}"`, line); v = r.v; break; } catch (e) {
          if (!/unterminated/.test(e.message) || li >= lines.length) throw e;
          buf += '\n' + lines[li++].text.trim();
        }
      }
    } else {
      // plain scalar, folding more-indented continuation lines that are not keys or entries
      let t = stripComment(s);
      while (li < lines.length) {
        const l = lines[li];
        if (l.text.trim() === '') { let k = li; while (k < lines.length && lines[k].text.trim() === '') k++; if (k < lines.length && lines[k].indent > parentIndent && keySplit(stripComment(lines[k].text).trim()) < 0 && !/^-(\s|$)/.test(lines[k].text.trim())) { t += '\n'; li = k; continue; } break; }
        if (l.indent <= parentIndent) break;
        const body = stripComment(l.text).trim();
        if (!body || /^#/.test(l.text.trim())) { li++; continue; }
        if (keySplit(body) >= 0 || /^-(\s|$)/.test(body)) break;
        t += (t.endsWith('\n') ? '' : ' ') + body; li++;
      }
      v = plainValue(t.trim());
    }
    if (tag) v = applyTag(tag, v, line);
    if (anchor) anchors.set(anchor, v);
    return v;
  }

  // ---- block nodes
  function block(indent, line) {
    const l = nextSig();
    if (!l) return null;
    seenContent = true;
    const t = stripComment(l.text).trim();
    if (/^-(\s|$)/.test(t)) return seq(l.indent);
    if (keySplit(t) >= 0) return map(l.indent);
    // a lone scalar or flow node at this indent
    li++;
    return inlineValue(t, l.indent - 1, l.no);
  }
  function seq(n) {
    const out = [];
    for (;;) {
      const l = nextSig();
      if (!l || l.indent !== n) break;
      const t = stripComment(l.text).trim();
      if (!/^-(\s|$)/.test(t)) break;
      const rest = l.text.slice(n + 1);
      const restT = rest.trim();
      if (restT === '' || restT.startsWith('#')) { li++; const nx = nextSig(); out.push(nx && nx.indent > n ? block(nx.indent, l.no) : null); continue; }
      // "- key: value" or "- - x": the entry is a block node starting at the column after "- "
      const col = n + 1 + rest.match(/^ */)[0].length;
      if (keySplit(stripComment(restT)) >= 0 || /^-(\s|$)/.test(restT)) {
        lines[li] = { ...l, text: ' '.repeat(col) + restT, indent: col };
        out.push(block(col, l.no));
        continue;
      }
      li++;
      out.push(inlineValue(restT, n, l.no));
    }
    return out;
  }
  function map(n) {
    const out = {};
    for (;;) {
      const l = nextSig();
      if (!l || l.indent !== n) break;
      const t = stripComment(l.text).trim();
      if (/^-(\s|$)/.test(t)) break;
      const body = l.text.slice(n);
      const k = keySplit(body);
      if (k < 0) throw new YamlError(`expected "key: value", got "${t.slice(0, 40)}"`, l.no);
      let key = body.slice(0, k);
      let anchor = null;
      key = keyText(key, l.no);
      if (key === '<<') anchor = '<<';
      const rest = body.slice(k + 1);
      li++;
      const v = inlineValue(rest, n, l.no);
      if (anchor === '<<' && v && typeof v === 'object') { for (const x of Array.isArray(v) ? v : [v]) Object.assign(out, x); continue; }
      if (Object.hasOwn(out, key)) throw new YamlError(`duplicate key "${key}"`, l.no);
      out[key] = v;
    }
    return out;
  }

  const first = nextSig();
  if (!first) return null;
  const v = block(first.indent, first.no);
  const extra = nextSig();
  if (extra && li < lines.length) throw new YamlError(`unexpected content at indent ${extra.indent}: "${stripComment(extra.text).trim().slice(0, 40)}"`, extra.no);
  return v;
}
