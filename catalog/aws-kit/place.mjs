// Placement helpers for AWS kit specs (k33bz fork): nodes by center, edge ports and orthogonal
// polylines, so a spec can say "from the right of the ALB to the left of the target group" instead of
// hand-computing coordinates. awd.mjs wraps labels with the same wrap(), so predicted label heights
// match what it draws. No imports: awd.mjs imports this module, and a spec may import both.

// word-wrap a label into <= maxCh-char lines (the generator's own rule)
export function wrap(label, maxCh = 14) {
  const out = []; let line = '';
  for (const w of String(label).split(/\s+/)) {
    if (line && (line + ' ' + w).length > maxCh) { out.push(line); line = w; } else line = line ? line + ' ' + w : w;
  }
  if (line) out.push(line);
  return out;
}
export const wrapLines = wrap;

// a node factory placing icons by CENTER (cx, cy), with a default icon size; cx and cy stay on the
// node for the port helpers
export const centered = (defaultSize = 32) => (id, icon, cx, cy, label, o = {}) => {
  const size = o.size || defaultSize;
  return { id, icon, x: cx - size / 2, y: cy - size / 2, size, label, cx, cy, ...o };
};

// a box or pill node by CENTER: a plain shape with its label inside (for what has no AWS icon)
export const box = (id, cx, cy, w, h, label, o = {}) => ({ id, kind: 'box', x: cx - w / 2, y: cy - h / 2, w, h, label, cx, cy, ...o });

// height of the label block under an icon (label lines at 13px + optional sub line at 11px); 0 when
// the label sits beside or above the icon, or inside a box
export const lblH = (n) => (n.kind || (n.labelPos && n.labelPos !== 'b') ? 0 : (n.label ? 13 * wrap(n.label, n.wrap).length : 0) + (n.sub ? 11 : 0));
// height of a label block above the icon (labelPos 't')
const lblAbove = (n) => (n.labelPos === 't' ? 11 * wrap(n.label || '', n.wrap).length + (n.sub ? 10 : 0) + 2 : 0);

// edge ports of a centered node or box: right / left / top (above a top label) / bottom-below-label /
// bottom-below-icon (d shifts along the edge, g = gap to the icon)
const half = (n, k) => (n[k] != null ? n[k] : n.size) / 2;
export const R = (n, dy = 0, g = 4) => [n.cx + half(n, 'w') + g, n.cy + dy];
export const L = (n, dy = 0, g = 4) => [n.cx - half(n, 'w') - g, n.cy + dy];
export const T = (n, dx = 0, g = 4) => [n.cx + dx, n.cy - half(n, 'h') - g - lblAbove(n)];
export const B = (n, dx = 0, g = 4) => [n.cx + dx, n.cy + half(n, 'h') + g + lblH(n)];
export const Bi = (n, dx = 0, g = 4) => [n.cx + dx, n.cy + half(n, 'h') + g];

// polyline path through points; consecutive points must share x or y (only H / V are emitted)
export const P = (...pts) => {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (y1 === y0) d += ` H${x1}`; else if (x1 === x0) d += ` V${y1}`; else throw new Error(`diagonal segment ${pts[i - 1]} -> ${pts[i]}`);
  }
  return d;
};
