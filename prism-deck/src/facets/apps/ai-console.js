// The AI console keys: a Stream Deck as the desk console for AI coding agents. The key designs come from
// the fork owner's own Stream Deck MK.2 console for Claude sessions, rebuilt here as generic,
// themed facets (no hosts, no services, no daemon: states come from a runtime or MCP, and a press cycles
// them by hand, as alert-build does).
//
//   app-ai-thinking    the orb that plays while AI work is in flight: a glass core breathing inside a
//                      spectral ring that turns; idle it rests dim, done it closes into a full ring
//   app-ai-session     one key per agent session: the project on top, the tool it is using acted out in
//                      the middle (shell, edit, read, search, web, agent), what it is doing below
//   app-ai-permission  a pending permission prompt: the tool that asks, in an amber ring that blinks
//   app-ai-allow       answer it: hold to allow (a ring of light fills; letting go early cancels)
//   app-ai-deny        answer it: one press denies
//   app-ai-screen      answer it on the screen instead
//   app-ai-prompts     where permission prompts go: the deck when you are away (auto), always, or never
//   app-ai-agent       an agent or job at a glance: a status tab, its name, its icon (or FAIL), last run
//   app-ai-page        the page key: which page of how many, its name, a status line
//
// The question and the work stream that span several keys are in ai-spans.js; the whole-deck moments
// (confetti, an attention ripple, the outrun screensaver) are spans/moments.js.

import { surface, rect, circle, path, n, radialGradient, url, arcPath, roundRectPath, capHeight } from '../../scene/index.js';
import { clamp, lerp, outExpo, pulse, phase, smoothstep } from '../../scene/easing.js';
import { mix } from '../../scene/color.js';
import { text, isBig, holdAge, headDot, burst, perimeter, perimeterStroke, perimeterPoint, lightOf } from './_d7-kit.js';

const TOOLS = {
  shell: { glyph: 'terminal', state: 'running', word: 'shell' },
  edit: { glyph: 'code', state: 'editing', word: 'edit' },
  read: { glyph: 'note', state: 'editing', word: 'read' },
  search: { glyph: 'search', state: 'searching', word: 'search' },
  web: { glyph: 'cloud', state: 'uploading', word: 'web' },
  agent: { glyph: 'git-branch', state: 'active', word: 'agent' },
};
const TOOL_NAMES = Object.keys(TOOLS);
const ago = (min) => (min < 1 ? 'just now' : min < 60 ? `${Math.round(min)}m ago` : min < 1440 ? `${Math.round(min / 60)}h ago` : `${Math.round(min / 1440)}d ago`);

// ── shared pieces ───────────────────────────────────────────────────────────

/** Baseline of the bottom line: the theme's label baseline, which each theme keeps clear of its own index or plate. */
const lineY = (k) => k.h - (k.theme.type.label?.baseline ?? 6.5) * k.m.u;

/** The small line at the bottom of a console tile (what it is doing, when it ran), in caption type. */
function line(k, str, color = 'muted') { k.caption(str, { y: lineY(k), color }); }

/** The box between an eyebrow on top and the bottom line (what the console tiles put in the middle). */
function midBox(k, { top = true, bottom = true } = {}) {
  const u = k.m.u, eb = k.typeStyle('eyebrow'), cp = k.typeStyle('caption');
  const y0 = top ? k.m.text + capHeight(eb.size, eb.weight) + 2.5 * u : k.m.safe;
  const y1 = bottom ? lineY(k) - capHeight(cp.size, cp.weight) - 2.5 * u : k.h - k.m.safe;
  const size = Math.max(8 * u, Math.min(y1 - y0, k.w - k.m.safe * 2));
  return { x: k.w / 2 - size / 2, y: (y0 + y1) / 2 - size / 2, size, cy: (y0 + y1) / 2 };
}

/** The console's status tab: a short bar at the top edge in the state's color. */
function statusTab(k, color, opacity = 1, f = 1) {
  const u = k.m.u, w = k.w * 0.44 * Math.max(0.08, f), h = Math.max(1.5, 1.8 * u);
  k.add(rect({ x: n(k.w / 2 - w / 2), y: n(1.6 * u), width: n(w), height: n(h), rx: n(h / 2), fill: color, fillOpacity: opacity < 1 ? n(opacity, 3) : undefined }));
}

/** A rounded ring inside the bezel (the console's answer keys and prompts): color, stroke weight, opacity. */
function keyRing(k, color, { width, opacity = 1, inset, f = 1 } = {}) {
  const sw = width ?? Math.max(2, k.m.u * 2.4);
  const i = inset ?? (k.m.bleed + sw / 2), r = Math.max(0, k.m.radius - i * 0.4);
  if (f >= 0.999) { k.add(path(roundRectPath(i, i, k.w - i * 2, k.h - i * 2, r), { fill: 'none', stroke: color, strokeWidth: n(sw), strokeOpacity: opacity < 1 ? n(opacity, 3) : undefined })); return; }
  k.add(perimeterStroke(perimeter(i, i, k.w - i * 2, k.h - i * 2, r), f, { color, width: sw, opacity }));
}

/** How far a key has arrived after a state change (0 → 1 over 0.6 s; 1 under reduced motion). */
const arrival = (ctx, dur = 0.6) => (ctx.reduced ? 1 : outExpo(clamp(ctx.since / dur)));

/** The attention breath of the key grammar: 1 Hz for 10 s from `since`, then steady. */
const breath = (ctx, lo = 0.35) => (ctx.reduced || ctx.since >= 10 ? 1 : lerp(lo, 1, pulse(ctx.since, 1)));

/** The thinking orb at (cx, cy) with radius r. mode: 'thinking' | 'idle' | 'done'. */
export function orb(k, ctx, { cx, cy, r, mode = 'thinking', hue = ctx.hue, tag = 'orb' }) {
  const T = ctx.theme, C = k.colors, t = ctx.reduced ? 1.3 : ctx.t;
  const lit = mode !== 'idle';
  const core = T.spectral(hue, { tier: 'vivid' });
  const glow = k.id(`${tag}-g`), body = k.id(`${tag}-b`);
  const beat = lit && !ctx.reduced ? pulse(t, 2.4) : 0.5;
  const R = r * (mode === 'thinking' ? 0.98 + 0.06 * beat : 0.96);
  // halo, then the glass core: a hot spot up and left, the hue deepening to the rim
  k.def(radialGradient(glow, [[0, core, lit ? (k.dark ? 0.42 : 0.3) : 0.12], [1, core, 0]], { cx: 0.5, cy: 0.5, r: 0.5 }));
  k.add(circle({ cx: n(cx), cy: n(cy), r: n(R * 1.75), fill: url(glow) }));
  const hot = mix(core, lightOf(k) === '#ffffff' ? '#ffffff' : mix(C.surface, '#ffffff', 0.6), 0.65);
  const deep = mix(core, k.dark ? '#000000' : C.ink, lit ? 0.35 : 0.55);
  k.def(radialGradient(body, [[0, lit ? hot : mix(hot, C.surface2, 0.6)], [0.55, lit ? core : mix(core, C.surface2, 0.55)], [1, deep]], { cx: 0.36, cy: 0.32, r: 0.75 }));
  k.add(circle({ cx: n(cx), cy: n(cy), r: n(R * 0.62), fill: url(body), fillOpacity: lit ? undefined : 0.75 }));
  // the spectral ring: 270° of the Spectrum, turning; done = the whole ring, idle = a faint track
  const sw = Math.max(1.25, r * 0.12), rr = R * 0.92;
  if (mode === 'idle') {
    k.add(circle({ cx: n(cx), cy: n(cy), r: n(rr), fill: 'none', stroke: C.line, strokeWidth: n(sw * 0.7) }));
    return;
  }
  const spin = mode === 'done' ? 0 : phase(t, 2) * 360;
  const span = mode === 'done' ? 360 : 270, segs = 6;
  for (let i = 0; i < segs; i++) {
    const a0 = spin + (span * i) / segs, a1 = spin + (span * (i + 1)) / segs - (span < 360 ? 1.5 : 0);
    const c = T.spectral(296 - (i / (segs - 1)) * 272, { tier: 'vivid' });
    k.add(path(arcPath(cx, cy, rr, a0, a1), { fill: 'none', stroke: c, strokeWidth: n(sw), strokeLinecap: span < 360 && (i === 0 || i === segs - 1) ? 'round' : 'butt', strokeOpacity: n(0.35 + 0.65 * ((i + 1) / segs), 3) }));
  }
  if (mode === 'thinking') {
    const [hx, hy] = [cx + rr * Math.sin(((spin + span) * Math.PI) / 180), cy - rr * Math.cos(((spin + span) * Math.PI) / 180)];
    k.add(headDot(k, hx, hy, sw * 0.62, T.spectral(24, { tier: 'vivid' })));
  }
}

// ── app-ai-thinking ──────────────────────────────────────────────────────────

const thinking = {
  id: 'app-ai-thinking', title: 'AI Thinking', category: 'AI Console',
  description: 'The orb that plays while an AI agent works: a glass core breathing inside a spectral ring that turns. Idle it rests dim; done, the ring closes. A runtime sets the state.',
  tags: ['ai', 'agent', 'thinking', 'working', 'orb', 'busy', 'claude', 'llm', 'status', 'console'],
  surface: 'key', fps: 12, loop: 4.8,
  states: ['thinking', 'idle', 'done'], tones: { thinking: 'active', idle: 'idle', done: 'ok' }, press: 'cycle',
  params: {
    label: { type: 'text', default: 'Thinking', maxLength: 12, label: 'Label while working' },
    hue: { type: 'hue', default: 280, min: 0, max: 360, label: 'Core hue' },
  },
  order: 10,
  render(ctx) {
    const k = surface(ctx);
    const st = ctx.stateName || 'thinking';
    k.background({ tone: st === 'done' ? 'ok' : st === 'idle' ? 'idle' : 'active' });
    const box = midBox(k, { top: false });
    const r = box.size * 0.36;
    orb(k, ctx, { cx: k.w / 2, cy: box.cy, r, mode: st, hue: ctx.params.hue });
    if (st === 'done' && ctx.since < 1.2 && !ctx.reduced) k.add(burst(k, { cx: k.w / 2, cy: box.cy, r0: r * 0.9, r1: r * 1.7, age: ctx.since, dur: 1.1, count: 10, hue: ctx.params.hue }));
    line(k, st === 'done' ? 'Done' : st === 'idle' ? 'Idle' : ctx.params.label, st === 'done' ? 'pos' : st === 'idle' ? 'muted' : 'ink');
    return k.svg();
  },
};

// ── app-ai-session ───────────────────────────────────────────────────────────

const STATE_WORD = { idle: 'idle', thinking: 'thinking', waiting: 'needs you', done: 'done' };

const session = {
  id: 'app-ai-session', title: 'AI Session', category: 'AI Console',
  description: 'One key per agent session: the project on top, the tool it is using acted out in the middle, what it is doing below; amber when it needs you, a burst when it is done.',
  tags: ['ai', 'agent', 'session', 'claude', 'coding', 'tool', 'project', 'status', 'console', 'llm'],
  surface: 'key', fps: 10, loop: 4.8,
  states: ['tool', 'thinking', 'waiting', 'idle', 'done'],
  tones: { tool: 'active', thinking: 'active', waiting: 'warn', idle: 'idle', done: 'ok' },
  press: 'cycle',
  params: {
    project: { type: 'text', default: 'my-app', maxLength: 14, label: 'Project' },
    tool: { type: 'select', default: 'shell', options: TOOL_NAMES, label: 'Tool in use' },
    hue: { type: 'hue', default: 268, min: 0, max: 360, label: 'Session hue' },
  },
  order: 11,
  render(ctx) {
    const k = surface(ctx);
    const st = ctx.stateName || 'tool';
    const tone = session.tones[st];
    k.background({ tone });
    const T = ctx.theme, u = k.m.u;
    const tag = T.spectral(ctx.params.hue, { tier: 'ink' });
    k.eyebrow(ctx.params.project, { align: 'center', color: () => tag });
    const box = midBox(k);
    const tool = TOOLS[ctx.params.tool] || TOOLS.shell;
    if (st === 'thinking') orb(k, ctx, { cx: k.w / 2, cy: box.cy, r: box.size * 0.34, mode: 'thinking', hue: ctx.params.hue, tag: 'so' });
    else if (st === 'tool') k.glyph(tool.glyph, { box, state: tool.state, tone: 'active' });
    else if (st === 'waiting') {
      k.glyph('timer', { box, state: 'running', tone: 'warn' });
      keyRing(k, k.colors.warn, { opacity: breath(ctx) });
    } else if (st === 'done') {
      k.glyph('check', { box, state: 'done', since: ctx.since, tone: 'ok' });
      if (ctx.since < 1.2 && !ctx.reduced) k.add(burst(k, { cx: k.w / 2, cy: box.cy, r0: box.size * 0.3, r1: box.size * 0.62, age: ctx.since, dur: 1.1, count: 10, hue: ctx.params.hue }));
    } else {
      // idle: three z's drifting up and fading, in the session's own ink
      const t = ctx.reduced ? 1.5 : ctx.t;
      for (let i = 0; i < 3; i++) {
        const p = phase(t + i * 0.8, 2.4);
        const size = box.size * (0.2 + 0.08 * i);
        text(k, 'z', { x: box.x + box.size * (0.32 + 0.2 * i), cy: box.cy + box.size * (0.18 - 0.16 * i) - p * 3 * u, size, weight: 700, color: 'muted', opacity: 0.85 * (1 - smoothstep(0.55, 1, p)) });
      }
    }
    line(k, st === 'tool' ? tool.word : STATE_WORD[st], st === 'waiting' ? 'warn' : st === 'idle' ? 'muted' : st === 'done' ? 'pos' : 'ink');
    return k.svg();
  },
};

// ── app-ai-permission ────────────────────────────────────────────────────────

const permission = {
  id: 'app-ai-permission', title: 'Permission Prompt', category: 'AI Console',
  description: 'An agent asks before it acts: the tool it wants, in an amber ring that blinks for ten seconds and then holds. Pair it with the Allow, Deny and Screen keys.',
  tags: ['ai', 'agent', 'permission', 'prompt', 'approve', 'allow', 'deny', 'claude', 'ask', 'console', 'attention'],
  surface: 'key', fps: 6, loop: 2,
  states: ['asking', 'allowed', 'denied'], tones: { asking: 'warn', allowed: 'ok', denied: 'neg' }, press: 'cycle',
  params: {
    project: { type: 'text', default: 'my-app', maxLength: 14, label: 'Project' },
    tool: { type: 'text', default: 'Bash', maxLength: 10, label: 'Tool' },
    verb: { type: 'text', default: 'wants to', maxLength: 14, label: 'Line under the tool' },
  },
  order: 20,
  render(ctx) {
    const k = surface(ctx);
    const st = ctx.stateName || 'asking';
    k.background({ tone: permission.tones[st] });
    const C = k.colors, box = midBox(k);
    const ring = st === 'asking' ? C.warn : st === 'allowed' ? C.pos : C.neg;
    keyRing(k, ring, { opacity: st === 'asking' ? breath(ctx, 0.25) : 1, width: Math.max(2, k.m.u * 2.8) });
    k.eyebrow(ctx.params.project, { align: 'center', color: st === 'asking' ? 'warn' : st === 'allowed' ? 'pos' : 'neg' });
    const arr = ctx.reduced ? 1 : outExpo(clamp(ctx.since / 0.35));
    if (st === 'asking') k.value(ctx.params.tool, { cy: box.cy, color: 'ink', opacity: 0.3 + 0.7 * arr });
    else k.glyph(st === 'allowed' ? 'check' : 'lock', { box: { x: box.x + box.size * 0.12, y: box.y + box.size * 0.12, size: box.size * 0.76 }, state: st === 'allowed' ? 'done' : 'locked', since: ctx.since, tone: st === 'allowed' ? 'ok' : 'neg' });
    line(k, st === 'asking' ? ctx.params.verb : st === 'allowed' ? `${ctx.params.tool} allowed` : `${ctx.params.tool} denied`, st === 'asking' ? 'muted' : st === 'allowed' ? 'pos' : 'neg');
    return k.svg();
  },
};

// ── answer keys: allow (hold), deny (press), screen ─────────────────────────────

const allow = {
  id: 'app-ai-allow', title: 'Allow (Hold)', category: 'AI Console',
  description: 'Allow what an agent asked, on purpose: hold the key and a ring of light runs round it; let go early and nothing happens, hold through and it says Allowed.',
  tags: ['ai', 'agent', 'allow', 'approve', 'permission', 'hold', 'confirm', 'safety', 'claude', 'console'],
  surface: 'key', fps: 12, loop: 4,
  states: ['ready', 'rearmed'], press: 'toggle',
  params: {
    label: { type: 'text', default: 'Allow', maxLength: 9, label: 'Word' },
    hold: { type: 'number', default: 1, min: 0.3, max: 4, step: 0.1, label: 'Hold for (s)' },
  },
  order: 21,
  render(ctx) {
    const H = holdAge(ctx), need = ctx.params.hold;
    const fired = H.held >= need, after = fired ? H.released : Infinity;
    const phaseName = H.pressed && !fired ? 'holding' : !H.pressed && !fired && H.released < 1.2 ? 'cancel' : fired && after < 3 ? 'allowed' : 'ready';
    // the theme's press sink would fight the hold ring: draw the held key unpressed
    const k = surface(phaseName === 'ready' ? ctx : { ...ctx, pressed: false, pressAge: Infinity });
    const C = k.colors, u = k.m.u;
    k.background({ tone: phaseName === 'allowed' ? 'ok' : phaseName === 'cancel' ? 'warn' : 'idle' });
    const sw = Math.max(2, u * 2.6), i = k.m.bleed + sw / 2, r = Math.max(0, k.m.radius - i * 0.4);
    const per = perimeter(i, i, k.w - i * 2, k.h - i * 2, r);
    const arr = phaseName === 'ready' && !Number.isFinite(ctx.pressAge) && !ctx.pressed ? arrival(ctx) : 1;
    if (arr < 0.999) k.add(perimeterStroke(per, arr, { color: C.pos, width: sw }));
    else k.add(path(per.d, { fill: 'none', stroke: C.pos, strokeWidth: n(sw), strokeOpacity: phaseName === 'holding' ? 0.3 : phaseName === 'cancel' ? 0.25 : undefined }));
    if (phaseName === 'holding' || phaseName === 'cancel') {
      const f = phaseName === 'holding' ? clamp(H.held / need) : clamp(H.held / need) * (1 - outExpo(clamp(H.released / 0.45)));
      const lit = mix(C.pos, lightOf(k), k.dark ? 0.35 : 0.15);
      k.add(perimeterStroke(per, f, { color: phaseName === 'cancel' ? C.warn : lit, width: sw * 1.15 }));
      if (phaseName === 'holding' && f > 0.01) { const [hx, hy] = perimeterPoint(i, i, k.w - i * 2, k.h - i * 2, r, f); k.add(headDot(k, hx, hy, sw * 0.55, lit)); }
    }
    const big = isBig(k);
    if (phaseName === 'allowed') {
      const box = midBox(k, { top: false });
      k.glyph('check', { box: { x: box.x + box.size * 0.1, y: box.y + box.size * 0.1, size: box.size * 0.8 }, state: 'done', since: after, tone: 'ok' });
      line(k, 'Allowed', 'pos');
    } else {
      k.value(ctx.params.label.toUpperCase(), { cy: k.h * (big ? 0.47 : 0.46), color: 'ink', maxWidth: k.w - k.m.text * 2 });
      line(k, phaseName === 'holding' ? 'keep holding' : phaseName === 'cancel' ? 'hold longer' : 'hold', phaseName === 'cancel' ? 'warn' : 'muted');
    }
    return k.svg();
  },
};

function answerKey(ctx, { word, done, ring, tone, glyph, glyphState }) {
  const k = surface(ctx);
  const C = k.colors;
  const hit = ctx.pressed || ctx.pressAge < 2.5;
  k.background({ tone: hit ? tone : 'idle' });
  const arr = hit ? 1 : arrival(ctx);
  if (ring) keyRing(k, C[ring], { width: Math.max(2, k.m.u * 2.6), f: arr });
  else statusTab(k, C.dim, 1, arr);
  if (hit) {
    const box = midBox(k, { top: false });
    k.glyph(glyph, { box: { x: box.x + box.size * 0.1, y: box.y + box.size * 0.1, size: box.size * 0.8 }, state: glyphState, since: ctx.pressed ? 0 : ctx.pressAge, tone });
    line(k, done, tone === 'neg' ? 'neg' : 'ink');
  } else {
    k.value(word.toUpperCase(), { cy: k.h * 0.46, color: 'ink', maxWidth: k.w - k.m.text * 2 });
  }
  return k;
}

const deny = {
  id: 'app-ai-deny', title: 'Deny', category: 'AI Console',
  description: 'Deny what an agent asked with one press: a red ring and the word DENY, then the lock and Denied while the answer goes back.',
  tags: ['ai', 'agent', 'deny', 'reject', 'permission', 'press', 'claude', 'console'],
  surface: 'key', fps: 8, loop: 3,
  params: { label: { type: 'text', default: 'Deny', maxLength: 9, label: 'Word' } },
  order: 22,
  render(ctx) {
    const k = answerKey(ctx, { word: ctx.params.label, done: 'Denied', ring: 'neg', tone: 'neg', glyph: 'lock', glyphState: 'locked' });
    if (!(ctx.pressed || ctx.pressAge < 2.5)) line(k, 'press', 'muted');
    return k.svg();
  },
};

const screen = {
  id: 'app-ai-screen', title: 'Answer on Screen', category: 'AI Console',
  description: 'Send a permission prompt back to the screen to answer it there: a grey status tab and SCREEN; a press shows where the answer went.',
  tags: ['ai', 'agent', 'permission', 'screen', 'defer', 'claude', 'console'],
  surface: 'key', fps: 8, loop: 3,
  params: { label: { type: 'text', default: 'Screen', maxLength: 9, label: 'Word' } },
  order: 23,
  render(ctx) {
    const k = answerKey(ctx, { word: ctx.params.label, done: 'On screen', tone: 'info', glyph: 'info', glyphState: undefined });
    if (!(ctx.pressed || ctx.pressAge < 2.5)) line(k, 'answer there', 'muted');
    return k.svg();
  },
};

// ── app-ai-prompts ───────────────────────────────────────────────────────────

const prompts = {
  id: 'app-ai-prompts', title: 'Prompt Routing', category: 'AI Console',
  description: 'Where permission prompts go: to the deck once you step away (auto), always to the deck, or always to the screen. A press cycles the mode.',
  tags: ['ai', 'agent', 'permission', 'prompts', 'routing', 'away', 'idle', 'claude', 'mode', 'console'],
  surface: 'key', fps: 2, loop: 4,
  states: ['auto', 'deck', 'screen'], tones: { auto: 'idle', deck: 'active', screen: 'off' }, press: 'cycle',
  params: { away: { type: 'number', default: 2, min: 1, max: 30, step: 1, label: 'Away after (min)' } },
  order: 24,
  render(ctx) {
    const k = surface(ctx);
    const st = ctx.stateName || 'auto';
    k.background({ tone: prompts.tones[st] });
    const C = k.colors;
    const arr = arrival(ctx);
    if (st === 'deck') keyRing(k, C.accent, { width: Math.max(2, k.m.u * 2.4), f: arr });
    else statusTab(k, st === 'auto' ? C.muted : C.dim, 1, arr);
    k.eyebrow('Prompts', { align: 'center', color: st === 'deck' ? 'accent' : 'muted' });
    k.value(st === 'deck' ? 'DECK' : st, { cy: k.h * 0.52, color: st === 'screen' ? 'muted' : 'ink' });
    line(k, st === 'auto' ? `away ${ctx.params.away}m` : st === 'deck' ? 'on the keys' : 'on screen', 'muted');
    return k.svg();
  },
};

// ── app-ai-agent ─────────────────────────────────────────────────────────────

const AGENT_TONE = { ok: 'ok', running: 'busy', recovered: 'warn', failed: 'neg', off: 'off' };

const agent = {
  id: 'app-ai-agent', title: 'Agent Status', category: 'AI Console',
  description: 'An agent or a scheduled job at a glance: a status tab in its state color, its name, its icon (FAIL when it failed) and when it last ran.',
  tags: ['ai', 'agent', 'job', 'status', 'health', 'cron', 'automation', 'last run', 'console', 'ops'],
  surface: 'key', fps: 6, loop: 3,
  states: ['ok', 'running', 'recovered', 'failed', 'off'], tones: AGENT_TONE, press: 'cycle',
  params: {
    name: { type: 'text', default: 'Agent', maxLength: 10, label: 'Name' },
    glyph: { type: 'glyph', default: 'sync', label: 'Icon' },
    lastRun: { type: 'number', default: 18, min: 0, max: 100000, step: 1, label: 'Last run (minutes ago)' },
  },
  order: 30,
  render(ctx) {
    const k = surface(ctx);
    const st = ctx.stateName || 'ok';
    const tone = AGENT_TONE[st];
    k.background({ tone });
    const C = k.colors;
    const col = { ok: C.pos, running: C.info, recovered: C.warn, failed: C.neg, off: C.dim }[st];
    statusTab(k, col, st === 'failed' ? breath(ctx, 0.45) : 1);
    k.eyebrow(ctx.params.name, { align: 'center', color: st === 'off' ? 'dim' : st === 'running' ? 'info' : st === 'ok' ? 'pos' : st === 'recovered' ? 'warn' : 'neg' });
    const box = midBox(k);
    if (st === 'failed') k.value('FAIL', { cy: box.cy, color: 'neg' });
    else if (st === 'off') k.value('off', { cy: box.cy, color: 'dim' });
    else {
      let id = ctx.params.glyph;
      if (!ctx.glyphs.get(id)) id = 'sync';
      const g = ctx.glyphs.get(id);
      const want = st === 'running' ? ['syncing', 'running', 'active', 'busy', 'on'] : ['idle', 'on', 'online', 'ready'];
      const state = want.find((s) => g.stateNames.includes(s));
      k.glyph(id, { box, state, tone: st === 'recovered' ? 'warn' : st === 'running' ? 'busy' : 'ok' });
    }
    const caption = st === 'ok' ? ago(ctx.params.lastRun) : st === 'running' ? 'running' : st === 'recovered' ? 'recovered' : st === 'failed' ? ago(ctx.params.lastRun) : 'paused';
    line(k, caption, st === 'failed' ? 'neg' : 'muted');
    return k.svg();
  },
};

// ── app-ai-page ──────────────────────────────────────────────────────────────

const PAGES_MAX = 8;
const page = {
  id: 'app-ai-page', title: 'Page Key', category: 'AI Console',
  description: 'The page key of a console deck: PAGE 1/4 on a violet tab, the page name, a status line under it. A press moves to the next page (shown here; pair it with Go to Page).',
  tags: ['page', 'navigation', 'console', 'pages', 'next', 'ai', 'agent', 'status'],
  surface: 'key', animated: false, fps: 0, loop: 4,
  states: Array.from({ length: PAGES_MAX }, (_, i) => `page-${i + 1}`), press: 'cycle',
  params: {
    pages: { type: 'text', default: 'Agents, Jobs, System, Stats', maxLength: 72, label: 'Pages (comma-separated)' },
    status: { type: 'text', default: 'all quiet', maxLength: 16, label: 'Status line' },
  },
  order: 40,
  render(ctx) {
    const k = surface(ctx);
    const names = String(ctx.params.pages).split(',').map((s) => s.trim()).filter(Boolean).slice(0, PAGES_MAX);
    const count = Math.max(1, names.length), i = ctx.state % count;
    k.background({ tone: 'idle' });
    statusTab(k, k.colors.accent);
    k.eyebrow(`Page ${i + 1}/${count}`, { align: 'center', color: 'accent' });
    k.value(names[i] || 'Home', { cy: k.h * 0.5, color: 'ink', size: k.m.u * 15, maxWidth: k.w - k.m.text * 2 });
    line(k, ctx.params.status, 'muted');
    return k.svg();
  },
};

export default [thinking, session, permission, allow, deny, screen, prompts, agent, page];
export { TOOLS, midBox, statusTab, keyRing };
