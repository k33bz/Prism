// The AI console (apps/ai-console.js, apps/ai-spans.js), the whole-deck moments (spans/moments.js) and the
// AI console profiles (export/profile.js): the behavior each design promises, beyond the conformance matrix
// in facets.test.js (valid SVG, budgets, every theme / mode / target), which covers them like every facet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allFacets, findFacet } from '../src/facets/index.js';
import { getGallery } from '../src/facets/galleries.js';
import { render } from '../src/render.js';
import { measureText } from '../src/scene/text.js';
import { flowWords } from '../src/facets/apps/ai-spans.js';
import { AI_CONSOLE_LAYOUTS, aiConsoleProfiles, checkProfile, SAMPLE_LAYOUTS } from '../src/export/profile.js';
import { getDevice } from '../src/devices.js';

const KEYS = ['app-ai-thinking', 'app-ai-session', 'app-ai-permission', 'app-ai-allow', 'app-ai-deny', 'app-ai-screen', 'app-ai-prompts', 'app-ai-agent', 'app-ai-page'];
const SPANS = ['app-ai-question', 'app-ai-stream'];
const MOMENTS = ['span-confetti', 'span-attention', 'span-outrun'];
const f = (id) => { const x = findFacet(id); assert.ok(x && x.id === id, `${id} is registered`); return x; };
const key = (id, o = {}) => render(f(id), { size: 72, theme: 'prism', t: 1.3, since: 1.3, seed: 3, idPrefix: 'ai', ...o }).svg;

test('ai console: the keys and spans are in Apps › AI Console, the moments in Spans', () => {
  assert.ok(getGallery('apps').categories.includes('AI Console'));
  for (const id of [...KEYS, ...SPANS]) { const x = f(id); assert.equal(x.gallery, 'apps'); assert.equal(x.category, 'AI Console'); }
  for (const id of MOMENTS) assert.equal(f(id).gallery, 'spans');
  assert.equal(allFacets().filter((x) => x.category === 'AI Console').length, KEYS.length + SPANS.length);
});

test('ai session: every state draws differently, and the tool in use changes the picture', () => {
  const s = f('app-ai-session');
  const frames = s.states.map((_, i) => key('app-ai-session', { state: i }));
  assert.equal(new Set(frames).size, s.states.length, 'one look per state');
  const tools = s.params.tool.options.map((tool) => key('app-ai-session', { state: 0, params: { tool } }));
  assert.equal(new Set(tools).size, tools.length, 'one glyph per tool');
  assert.notEqual(key('app-ai-session', { params: { project: 'alpha' } }), key('app-ai-session', { params: { project: 'beta' } }), 'the project is on the key');
});

test('allow: a short hold cancels, a full hold allows, and the ready key is neither', () => {
  const ready = key('app-ai-allow', { state: 0, since: 5 });
  const holding = key('app-ai-allow', { state: 1, pressed: true, pressedFor: 0.5, since: 0.5 });
  const cancelled = key('app-ai-allow', { state: 1, since: 0.8, pressAge: 0.3 });   // held 0.5 s of 1 s
  const allowed = key('app-ai-allow', { state: 1, since: 1.5, pressAge: 0.3 });     // held 1.2 s
  const later = key('app-ai-allow', { state: 1, since: 9, pressAge: 5 });            // re-armed after the answer
  assert.equal(new Set([ready, holding, cancelled, allowed]).size, 4);
  assert.notEqual(later, allowed, 'the Allowed frame does not stay');
  assert.ok(key('app-ai-allow', { state: 1, pressed: true, pressedFor: 0.2, since: 0.2 }) !== key('app-ai-allow', { state: 1, pressed: true, pressedFor: 0.8, since: 0.8 }), 'the ring fills while held');
});

test('deny and screen: a press shows the answer for a moment, then the key returns', () => {
  for (const id of ['app-ai-deny', 'app-ai-screen']) {
    const rest = key(id, { since: 6 }), hit = key(id, { since: 6, pressAge: 0.4 }), after = key(id, { since: 6, pressAge: 4 });
    assert.notEqual(rest, hit, `${id}: a press changes the key`);
    assert.equal(after, rest, `${id}: and it comes back`);
  }
});

test('permission prompt: the amber ring breathes for ten seconds, then holds still', () => {
  const at = (since) => key('app-ai-permission', { state: 0, since, t: since });
  assert.notEqual(at(2), at(2.5), 'breathing at 1 Hz');
  assert.equal(at(12), at(12.5), 'steady after 10 s');
});

test('agent status: the glyph param is the icon, an unknown glyph falls back, FAIL replaces it', () => {
  assert.notEqual(key('app-ai-agent', { params: { glyph: 'rocket' } }), key('app-ai-agent', { params: { glyph: 'bug' } }));
  assert.equal(key('app-ai-agent', { params: { glyph: 'no-such-glyph' } }), key('app-ai-agent', { params: { glyph: 'sync' } }));
  assert.equal(key('app-ai-agent', { state: 3, params: { glyph: 'rocket' } }), key('app-ai-agent', { state: 3, params: { glyph: 'bug' } }), 'failed shows FAIL, not the icon');
});

test('page key: PAGE i/n follows the press and the page list', () => {
  const p = (state, pages = 'One, Two, Three') => key('app-ai-page', { state, params: { pages } });
  assert.notEqual(p(0), p(1));
  assert.equal(p(3), p(0), 'wraps at the number of pages');
});

test('question: words flow across keys without losing any; long words break, overflow ends in an ellipsis', () => {
  const size = 10, maxWidth = 56;
  const q = 'The release notes are ready. Publish them as they are?';
  const blocks = flowWords(q, { keys: 5, perKey: 3, maxWidth, size });
  assert.equal(blocks.length, 5);
  assert.equal(blocks.flat().join(' '), q, 'every word, in order');
  for (const ln of blocks.flat()) assert.ok(measureText(ln, { size, weight: 600 }) <= maxWidth + 0.01, `"${ln}" fits a key`);
  const long = flowWords('Supercalifragilisticexpialidocious', { keys: 3, perKey: 2, maxWidth, size }).flat();
  assert.ok(long.length > 1 && long.slice(0, -1).every((l) => l.endsWith('-')), 'a word wider than a key breaks with hyphens');
  const many = flowWords('word '.repeat(80), { keys: 2, perKey: 2, maxWidth, size }).flat();
  assert.equal(many.length, 4);
  assert.ok(many[3].endsWith('…'));
});

test('question: pressing an answer changes only the answer row', () => {
  const q = f('app-ai-question');
  const at = (o) => render(q, { device: 'mk2', theme: 'prism', t: 3, since: 3, idPrefix: 'aq', ...o }).keys;
  const mk2 = getDevice('mk2');
  const base = at({}), sent = at({ pressKey: mk2.cols, pressAge: 0.5 });   // the first key of the second row: the first answer
  const row = (keys, r) => keys.filter((k) => k.row === r).map((k) => k.svg);
  assert.deepEqual(row(sent, 0), row(base, 0), 'the question keys stay byte-identical');
  assert.notDeepEqual(row(sent, 1), row(base, 1), 'the answer lights');
});

test('work stream: working and idle differ, and the packets move', () => {
  const s = f('app-ai-stream');
  const at = (state, t) => render(s, { device: 'mk2', theme: 'prism', state, t, since: t, idPrefix: 'as' }).svg;
  assert.notEqual(at(0, 1.2), at(1, 1.2));
  assert.notEqual(at(0, 1.2), at(0, 1.7));
});

test('moments: confetti bursts from the pressed key; the attention ripple takes its tone', () => {
  const c = f('span-confetti');
  const keysAt = (o) => render(c, { device: 'mk2', theme: 'prism', t: 3.9, since: 3.9, idPrefix: 'mc', ...o }).keys;
  const pressedKey = 12;                                      // bottom row, middle-right
  const burst = keysAt({ pressKey: pressedKey, pressAge: 0.15 }), rain = keysAt({});
  assert.notEqual(burst.find((k) => k.i === pressedKey).svg, rain.find((k) => k.i === pressedKey).svg);
  const a = f('span-attention');
  const tone = (t) => render(a, { device: 'mk2', theme: 'prism', t: 1.2, since: 1.2, params: { tone: t }, idPrefix: 'ma' }).svg;
  assert.equal(new Set(['warn', 'neg', 'info'].map(tone)).size, 3);
});

test('ai console profiles: MK.2 and XL build clean, every key is placed, page keys point at real pages', () => {
  const ps = aiConsoleProfiles();
  assert.deepEqual(ps.map((p) => p.device).sort(), Object.keys(AI_CONSOLE_LAYOUTS).sort());
  for (const p of ps) {
    assert.deepEqual(p.dropped, [], `${p.file}: nothing dropped`);
    assert.deepEqual(checkProfile(p.zip), [], `${p.file}: a valid FormatVersion 1 export`);
    assert.equal(p.pages.length, AI_CONSOLE_LAYOUTS[p.device].pages.length);
    assert.match(p.file, /^Prism AI Console - /);
    const d = getDevice(p.device);
    for (const pg of AI_CONSOLE_LAYOUTS[p.device].pages) {
      const cells = new Set(pg.keys.map((k) => `${k.col},${k.row}`));
      assert.equal(cells.size, pg.keys.length, `${p.file} ${pg.name}: one action per key`);
      for (const k of pg.keys) {
        assert.ok(k.col < d.cols && k.row < d.rows, `${p.file} ${pg.name}: ${k.col},${k.row} is on the device`);
        if (k.settings) assert.ok(findFacet(k.settings.facet), `${k.settings.facet} exists`);
        if (k.builtin?.settings?.PageIndex) assert.ok(k.builtin.settings.PageIndex <= p.pages.length);
      }
    }
  }
  // the sample profiles are unchanged by the console: separate files, separate layouts
  assert.ok(Object.keys(SAMPLE_LAYOUTS).every((dev) => !SAMPLE_LAYOUTS[dev].pages.some((pg) => pg.keys?.some((k) => k.settings?.facet?.startsWith('app-ai-')))));
});
