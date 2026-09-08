// Tests for composition conflict detection: CSS selector collisions across composed
// effects (the later rule silently wins) and multiple background-layer effects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSelectorConflicts } from '../utils/css.js';
import { validateComposition } from '../utils/validate.js';
import { toolCtx } from './helper.js';

// -------------------- detectSelectorConflicts (pure) --------------------

test('detectSelectorConflicts flags a selector defined differently by two effects', () => {
  const c = detectSelectorConflicts([
    { id: 'a', css: '.x{color:red}' },
    { id: 'b', css: '.x{color:blue}' },
  ]);
  assert.equal(c.length, 1);
  assert.equal(c[0].selector, '.x');
  assert.deepEqual(c[0].effects.sort(), ['a', 'b']);
  assert.equal(c[0].variants, 2);
});

test('detectSelectorConflicts ignores identical rules (dedupe-safe)', () => {
  const c = detectSelectorConflicts([
    { id: 'a', css: '.badge{padding:2px 6px}' },
    { id: 'b', css: '.badge{padding:2px 6px}' }, // byte-identical
  ]);
  assert.deepEqual(c, []);
});

test('detectSelectorConflicts ignores whitespace-only differences', () => {
  const c = detectSelectorConflicts([
    { id: 'a', css: '.y {  color : red ; }' },
    { id: 'b', css: '.y{color:red}' },
  ]);
  assert.deepEqual(c, [], 'signature normalization makes these equal');
});

test('detectSelectorConflicts excludes :root (token merges are intentional)', () => {
  const c = detectSelectorConflicts([
    { id: 'a', css: ':root{--accent:#f00}' },
    { id: 'b', css: ':root{--accent:#00f}' },
  ]);
  assert.deepEqual(c, []);
});

test('detectSelectorConflicts ignores repeats within a single effect', () => {
  const c = detectSelectorConflicts([
    { id: 'a', css: '.z{color:red}.z{color:blue}' }, // one effect, its own problem
  ]);
  assert.deepEqual(c, []);
});

// -------------------- validateComposition integration (fake store) --------------------

const fakeStore = (effects) => ({ get: (id) => effects.find((e) => e.id === id) || null });

test('validateComposition surfaces selector conflicts as warnings', () => {
  const store = fakeStore([
    { id: 'a', css: '.head{font-size:20px}', layer: 'content' },
    { id: 'b', css: '.head{font-size:14px}', layer: 'content' },
  ]);
  const res = validateComposition(['a', 'b'], store);
  assert.equal(res.conflicts.length, 1);
  assert.equal(res.conflicts[0].selector, '.head');
  assert.ok(res.warnings.some((w) => w.includes('.head') && w.includes('later rule wins')));
});

test('validateComposition flags multiple background layers', () => {
  const store = fakeStore([
    { id: 'bg1', css: '.a{}', layer: 'background' },
    { id: 'bg2', css: '.b{}', layer: 'background' },
  ]);
  const res = validateComposition(['bg1', 'bg2'], store);
  assert.deepEqual(res.backgroundConflict, ['bg1', 'bg2']);
  assert.ok(res.warnings.some((w) => w.includes('background')));
});

test('validateComposition: single effect has no composition conflicts', () => {
  const store = fakeStore([{ id: 'solo', css: '.head{color:red}', layer: 'background' }]);
  const res = validateComposition(['solo'], store);
  assert.deepEqual(res.conflicts, []);
  assert.equal(res.backgroundConflict, null);
});

// -------------------- through the tools (real fixture) --------------------

test('validate_composition returns conflicts + backgroundConflict fields', () => {
  const ctx = toolCtx();
  const r = ctx.call('validate_composition', { ids: ['charts-kpi-pulse', 'charts-kpi-delta'] });
  assert.ok(Array.isArray(r.conflicts));
  // .shared-badge is byte-identical in both fixture effects -> dedupe-safe, NOT a conflict
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.backgroundConflict, null);
});

test('compose surfaces the new conflict fields (identical shared rule is not a conflict)', () => {
  const ctx = toolCtx();
  const r = ctx.call('compose', { ids: ['charts-kpi-pulse', 'charts-kpi-delta'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.backgroundConflict, null);
});
