/* ============================================================================
   Theme-switching gate (headless Chrome/Edge over CDP, zero deps).
   ----------------------------------------------------------------------------
   Loads the real Prism.html and drives its theme engine the way a person does,
   then asserts what the eye would catch:

     load     the stored theme is on screen from the first painted frame, in the
              shell AND in the gallery iframe, on a first visit and a returning one,
              and in frames created later (a page change, the New Facets in-place
              re-render). Probed with a requestAnimationFrame recorder injected into
              every document before any of its own code runs.
     switch   every registry theme in turn: computed --bg/--ink in the shell and in
              the gallery frame equal the registry's :root values, data-mode /
              data-ds / color-scheme follow, body.cs-light follows, and no frame
              reloads (no srcdoc rewrite, no iframe load event).
     pack     the Light/Dark toggle and the reveal's "Try light mode" keep the pack.
     pages    New Facets, Search, Variant Matrix (and its live previews) and the
              Showcase follow a switch without reloading; no themed frame is left
              stale; a change made in another tab is followed.
     url      ?theme=<id>, ?theme=<pack>&mode=<light|dark|auto>, and an invalid id
              (falls back, warns on the console).
     auto     the Auto mode follows an emulated prefers-color-scheme change live,
              keeps the pack, and survives a reload.
     picker   keyboard (arrows, Home/End, type-ahead, Enter, Escape, Tab, focus
              return), roles and states, focus ring, swatches, grouping by pack,
              current theme marked, outside click closes.
     motion   a switch cross-fades (View Transition) unless reduced motion is on,
              in which case it applies synchronously.
     perf     reported: per-switch sync time and time to the next frame, gallery and
              nested iframe reloads (must be 0), stylesheet rewrites per switch (<= 1).

   The registry is read statically from Prism.html (the THEME_REGISTRY block is
   evaluated in a sandbox), so the expected values never come from the code
   under test.

   Usage:
     node catalog/_check_theme_switch.mjs                 # gate (exit 1 on failure)
     node catalog/_check_theme_switch.mjs --shots DIR     # also write screenshots
     node catalog/_check_theme_switch.mjs --file X.html   # run against another copy
     node catalog/_check_theme_switch.mjs --json          # machine-readable report
   Honors PRISM_CHROME (see _chrome.mjs). Always closes the browser it starts.
   ========================================================================== */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { resolveChrome, closeBrowser } from './_chrome.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = n => argv.includes(n);
const FILE = resolve(opt('--file', resolve(HERE, '../Prism.html')));
const SHOTS = opt('--shots', '');
const JSON_OUT = flag('--json');
const URL0 = pathToFileURL(FILE).href;
const W = 1440, H = 900;
const PORT = 9300 + Math.floor(Math.random() * 500);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const J = JSON.stringify;

// ---------------------------------------------------------------- registry (static)
function loadRegistry() {
  const html = readFileSync(FILE, 'utf8');
  // The theme engine section opens with its banner; the CSS consts and THEME_REGISTRY
  // follow, and the derived lookups (var THEMES={}) close the block we evaluate.
  let a = html.indexOf('// ===================== THEME ENGINE');
  if (a < 0) a = html.indexOf('var CS_DARK_CSS=');
  const b = html.indexOf('var THEMES={}', a);
  if (a < 0 || b < 0) throw new Error('THEME_REGISTRY block not found in ' + FILE);
  const reg = vm.runInNewContext(html.slice(a, b) + '\n;THEME_REGISTRY', {}, { timeout: 2000 });
  const tok = (css, k) => { const m = new RegExp('(?:^|[{;])\\s*' + k + '\\s*:\\s*([^;}]+)').exec(css || ''); return m ? m[1].trim().toLowerCase() : null; };
  const base = reg[0].css;
  return reg.map(t => ({ id: t.id, ds: t.ds, mode: t.mode, name: t.name,
    bg: tok(t.css, '--bg') || tok(base, '--bg'), ink: tok(t.css, '--ink') || tok(base, '--ink'),
    accent: tok(t.css, '--accent') || tok(base, '--accent') }));
}
const REG = loadRegistry();
const BY_ID = Object.fromEntries(REG.map(t => [t.id, t]));
const FAMILIES = [...new Set(REG.map(t => t.ds))];
const pair = (ds, mode) => REG.find(t => t.ds === ds && t.mode === mode);

// ---------------------------------------------------------------- results
const results = [];
const metrics = {};
function check(group, name, ok, detail) {
  results.push({ group, name, ok: !!ok, detail: ok ? undefined : detail });
  if (!JSON_OUT) console.log((ok ? '  ok   ' : '  FAIL ') + group + ': ' + name + (ok || detail == null ? '' : '  -> ' + (typeof detail === 'string' ? detail : J(detail))));
}

// ---------------------------------------------------------------- browser + CDP
const udd = mkdtempSync(resolve(tmpdir(), 'prism-theme-'));
const proc = spawn(resolveChrome(), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-color-profile=srgb', '--force-device-scale-factor=1', `--window-size=${W},${H}`,
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + udd, 'about:blank'], { stdio: 'ignore' });
let ws, seq = 0; const pending = new Map(); const consoleLog = [];
const send = (method, params = {}) => new Promise((res) => { const i = ++seq; pending.set(i, res); ws.send(J({ id: i, method, params })); });
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) throw new Error('page: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r && r.result ? r.result.value : undefined;
}
const call = (fn, ...args) => ev('(' + fn.toString() + ')(' + args.map(a => J(a)).join(',') + ')');
async function key(k) {
  if (k.length === 1 && k !== ' ') {   // a printable letter (type-ahead)
    const C = k.toUpperCase(), vk = C.charCodeAt(0);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: 'Key' + C, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: k });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: 'Key' + C, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(40); return;
  }
  const K = { Enter: [13, 'Enter', '\r'], Escape: [27, 'Escape'], ArrowDown: [40, 'ArrowDown'], ArrowUp: [38, 'ArrowUp'],
    ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'], Home: [36, 'Home'], End: [35, 'End'], Tab: [9, 'Tab'], ' ': [32, 'Space', ' '] }[k];
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: K[1], windowsVirtualKeyCode: K[0], nativeVirtualKeyCode: K[0], text: K[2] });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: K[1], windowsVirtualKeyCode: K[0], nativeVirtualKeyCode: K[0] });
  await sleep(40);
}
async function media(scheme, reduced) {
  await send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: scheme || 'dark' },
    { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
}

// Recorder: runs in EVERY document (shell, gallery frames, nested previews) before the
// page's own code. Snapshots the theme state at each animation frame, the last point
// before paint, so the first snapshot with a <body> is what the first paint showed.
const RECORDER = `(function(){
  var T; try{ T=window.top; T.document; }catch(e){ return; }
  var depth=0, w=window; while(w!==T && depth<5){ w=w.parent; depth++; }
  var log=T.__fouc||(T.__fouc=[]), n=0;
  function snap(){
    try{
      var de=document.documentElement, cs=de&&getComputedStyle(de), b=document.body;
      var fw=null; if(depth===1){ var e=T.document.getElementById('fw'); fw=e?+getComputedStyle(e).opacity:null; }
      log.push({t:performance.timeOrigin+performance.now(), depth:depth, title:document.title, n:n, url:location.href,
        body:!!b, vis:b?getComputedStyle(b).visibility:null,
        bg:cs?cs.getPropertyValue('--bg').trim().toLowerCase():'', mode:de?de.getAttribute('data-mode'):null,
        scheme:cs?cs.colorScheme:'', fw:fw, vm:!!document.getElementById('vm-theme')});
    }catch(e){}
    if(++n<24) requestAnimationFrame(snap);
  }
  requestAnimationFrame(snap);
})();`;

// In-page theme state reader (runs in the shell).
function readState() {
  function rd(doc) {
    if (!doc || !doc.documentElement) return null;
    var cs = doc.defaultView.getComputedStyle(doc.documentElement);
    return { bg: cs.getPropertyValue('--bg').trim().toLowerCase(), ink: cs.getPropertyValue('--ink').trim().toLowerCase(),
      mode: doc.documentElement.getAttribute('data-mode'), ds: doc.documentElement.getAttribute('data-ds'), scheme: cs.colorScheme };
  }
  var S = window.PrismShell, gv = document.getElementById('gv'), fd = null;
  try { fd = gv.contentDocument; } catch (e) {}
  var nested = [];
  (function walk(doc, d) {
    if (!doc || d > 3) return;
    doc.querySelectorAll('iframe').forEach(function (f) {
      var cd = null; try { cd = f.contentDocument; } catch (e) {}
      if (!cd || !cd.documentElement || cd.readyState === 'loading') return;
      var themed = !!(cd.getElementById('vm-theme') || cd.getElementById('prism-theme-vars'));
      if (themed) { var r = rd(cd); r.label = f.getAttribute('aria-label') || f.id || ''; nested.push(r); }
      walk(cd, d + 1);
    });
  })(fd, 0);
  return { id: S && S.getTheme ? S.getTheme() : null, mode: S && S.getMode ? S.getMode() : null,
    shell: rd(document), frame: rd(fd), nested: nested, bodyLight: document.body.classList.contains('cs-light') };
}
const state = () => call(readState);

// Counters for reload / re-parse detection, re-armed after every page load.
function armCounters() {
  var gv = document.getElementById('gv');
  if (!window.__tsc) {
    window.__tsc = { gvLoads: 0, srcdoc: 0, nestedLoads: 0, styleMut: 0 };
    gv.addEventListener('load', function () { window.__tsc.gvLoads++; });
    new MutationObserver(function (ms) { ms.forEach(function (m) { if (m.attributeName === 'srcdoc') window.__tsc.srcdoc++; }); })
      .observe(gv, { attributes: true, attributeFilter: ['srcdoc'] });
  }
  var fd = gv.contentDocument;
  if (fd && !fd.__tscArmed) {
    fd.__tscArmed = true;
    fd.addEventListener('load', function (e) { if (e.target && e.target.tagName === 'IFRAME') window.__tsc.nestedLoads++; }, true);
    new MutationObserver(function (ms) {
      ms.forEach(function (m) { var t = m.target; if (t.nodeType === 3) t = t.parentNode; if (t && t.tagName === 'STYLE') window.__tsc.styleMut++;
        m.addedNodes && m.addedNodes.forEach(function (n) { if (n.tagName === 'STYLE') window.__tsc.styleMut++; }); });
    }).observe(fd.documentElement, { childList: true, subtree: true, characterData: true });
  }
  return true;
}

async function open(query, page, seed, scheme = 'dark', reduced = true) {
  await media(scheme, reduced);
  const token = 'seed' + Math.random().toString(36).slice(2);
  const src = `if(window===window.top){ try{ if(sessionStorage.getItem('__seed')!==${J(token)}){
      localStorage.clear(); var s=${J(seed || {})}; for(var k in s) localStorage.setItem(k,s[k]);
      if(!('prismRevealSeen' in s)) localStorage.setItem('prismRevealSeen','1');
      sessionStorage.setItem('__seed',${J(token)}); } }catch(e){} }`;
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: src });
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(50);
  consoleLog.length = 0;
  await send('Page.navigate', { url: URL0 + (query || '') + '#' + page });
  const ok = await waitPage(page);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  return ok;
}
async function waitPage(page, timeout = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await call(function (p) {
      try {
        var S = window.PrismShell; if (!S || S.current() !== p) return false;
        var fw = document.getElementById('fw'), d = document.getElementById('gv').contentDocument;
        return !!(fw && fw.classList.contains('in') && d && d.readyState === 'complete' && !document.getElementById('veil'));
      } catch (e) { return false; }
    }, page).catch(() => false);
    if (ok) { await sleep(250); await call(armCounters); return true; }
    await sleep(100);
  }
  return false;
}
async function go(page) {
  await call(function (p) { window.__fouc = []; window.PrismShell.go(p); }, page);
  return waitPage(page);
}
async function settle(id, timeout = 3000) {
  const t = BY_ID[id], t0 = Date.now();
  let s;
  while (Date.now() - t0 < timeout) {
    s = await state();
    if (s.shell && s.shell.bg === t.bg && s.frame && s.frame.bg === t.bg && s.nested.every(n => n.bg === t.bg)) break;
    await sleep(30);
  }
  await sleep(160); // past the 120ms chrome colour transitions
  return state();
}
async function setTheme(id) {
  return call(async function (id) {
    var t0 = performance.now(); window.PrismShell.setTheme(id); var t1 = performance.now();
    await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
    return { sync: t1 - t0, frame: performance.now() - t0 };
  }, id);
}
function stateMatches(s, t, where) {
  const bad = [];
  const cmp = (lbl, got, want) => { if (got !== want) bad.push(lbl + '=' + got + ' want ' + want); };
  if (!s.shell || !s.frame) return ['no shell/frame'];
  cmp('id', s.id, t.id);
  cmp('shell --bg', s.shell.bg, t.bg); cmp('shell --ink', s.shell.ink, t.ink);
  cmp('frame --bg', s.frame.bg, t.bg); cmp('frame --ink', s.frame.ink, t.ink);
  cmp('frame data-mode', s.frame.mode, t.mode); cmp('frame data-ds', s.frame.ds, t.ds);
  cmp('shell data-mode', s.shell.mode, t.mode);
  cmp('shell color-scheme', s.shell.scheme, t.mode); cmp('frame color-scheme', s.frame.scheme, t.mode);
  cmp('body.cs-light', s.bodyLight, t.mode === 'light');
  s.nested.forEach((n, i) => { cmp('nested[' + i + '] --bg', n.bg, t.bg); cmp('nested[' + i + '] data-mode', n.mode, t.mode); });
  return bad.length ? (where ? [where + ': ' + bad.join('; ')] : bad) : null;
}
async function shot(name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = resolve(SHOTS, name + '.png');
  writeFileSync(p, Buffer.from(r.data, 'base64'));
  metrics.shots = (metrics.shots || 0) + 1; metrics.shotsDir = SHOTS;
}
// First-paint analysis of the recorder log for the current navigation.
async function fouc(expectId) {
  const t = BY_ID[expectId];
  const log = (await ev('JSON.stringify(window.__fouc||[])')) || '[]';
  const L = JSON.parse(log);
  const shellBad = L.filter(r => r.depth === 0 && r.body && r.vis !== 'hidden' && r.bg !== t.bg);
  const docs = {};
  // about:blank is an iframe's initial empty document (no content, never a gallery)
  L.filter(r => r.depth > 0 && r.body && r.url !== 'about:blank').forEach(r => { const k = r.depth + '|' + r.title + '|' + r.vm; if (!docs[k]) docs[k] = r; });
  const frameBad = Object.values(docs).filter(r => r.bg !== t.bg || r.mode !== t.mode);
  return { records: L.length, shellBad, frameBad, frames: Object.keys(docs).length,
    frameBadVisible: frameBad.filter(r => r.depth > 1 || r.fw == null || r.fw > 0) };
}

// ---------------------------------------------------------------- the run
async function main() {
  let target;
  for (let i = 0; i < 60; i++) {
    try { target = (await (await fetch(`http://localhost:${PORT}/json`)).json()).find(t => t.type === 'page'); if (target) break; } catch {}
    await sleep(150);
  }
  if (!target) throw new Error('no DevTools target');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') consoleLog.push({ type: m.params.type, text: (m.params.args || []).map(a => a.value != null ? String(a.value) : (a.description || '')).join(' ') });
    if (m.method === 'Runtime.exceptionThrown') consoleLog.push({ type: 'exception', text: (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text });
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });

  // ---- 1. load: stored theme from the first paint (first visit, then returning visit)
  const LOAD_THEME = 'fluent-light';
  check('load', 'page loads with a stored theme', await open('', 'aws', { prismTheme: LOAD_THEME }), 'timeout');
  const first = await fouc(LOAD_THEME);
  metrics.firstVisit = { shellWrongFrames: first.shellBad.length, staleFrameDocs: first.frameBad.length, of: first.frames };
  await send('Page.reload', {}); await waitPage('aws');
  const again = await fouc(LOAD_THEME);
  metrics.returningVisit = { shellWrongFrames: again.shellBad.length, staleFrameDocs: again.frameBad.length, of: again.frames };
  check('load', 'shell paints the stored theme from its first frame', again.shellBad.length === 0,
    again.shellBad.slice(0, 2).map(r => 'frame#' + r.n + ' --bg=' + r.bg));
  check('load', 'gallery frame paints the stored theme from its first frame', again.frameBad.length === 0,
    again.frameBad.slice(0, 3).map(r => (r.title || 'doc') + ' first --bg=' + r.bg + ' data-mode=' + r.mode));
  let s = await settle(LOAD_THEME);
  check('load', 'stored theme fully applied after load', !stateMatches(s, BY_ID[LOAD_THEME]), stateMatches(s, BY_ID[LOAD_THEME]));
  await shot('load-' + LOAD_THEME + '-aws');
  // frames created later: another page, then the New Facets in-place re-render
  await go('charts');
  let later = await fouc(LOAD_THEME);
  check('load', 'a gallery opened later paints themed from its first frame', later.frameBad.length === 0,
    later.frameBad.slice(0, 2).map(r => r.title + ' --bg=' + r.bg));
  await go('facets');
  await call(function () { window.__fouc = []; window.PrismShell.setFacetsWindow(window.PrismShell.getFacetsWindow() === 30 ? 31 : 30); });
  await sleep(2500);
  later = await fouc(LOAD_THEME);
  check('load', 'New Facets re-render (visible, in place) paints themed from its first frame', later.frameBad.length === 0,
    later.frameBad.slice(0, 2).map(r => r.title + ' --bg=' + r.bg + ' visible=' + r.fw));

  // ---- 2. switch through every registry theme on the AWS gallery (data-mode matters there)
  await open('', 'aws', { prismTheme: 'cloudscape-dark' }, 'dark', true);
  const times = [], frameTimes = []; let failures = [];
  const c0 = await ev('JSON.stringify(window.__tsc)');
  let maxStyleMut = 0;
  for (const t of REG) {
    const before = JSON.parse(await ev('JSON.stringify(window.__tsc)'));
    const r = await setTheme(t.id); times.push(r.sync); frameTimes.push(r.frame);
    s = await settle(t.id);
    const after = JSON.parse(await ev('JSON.stringify(window.__tsc)'));
    maxStyleMut = Math.max(maxStyleMut, after.styleMut - before.styleMut);
    const bad = stateMatches(s, t, t.id); if (bad) failures.push(...bad);
  }
  const c1 = JSON.parse(await ev('JSON.stringify(window.__tsc)')), c0j = JSON.parse(c0);
  check('switch', 'all ' + REG.length + ' themes: shell + frame tokens, data-mode, data-ds, color-scheme match the registry', failures.length === 0, failures.slice(0, 6));
  const med = a => { const b = [...a].sort((x, y) => x - y); return +b[Math.floor(b.length / 2)].toFixed(2); };
  metrics.switch = { themes: REG.length, syncMsMedian: med(times), syncMsMax: +Math.max(...times).toFixed(2),
    toNextFrameMsMedian: med(frameTimes), toNextFrameMsMax: +Math.max(...frameTimes).toFixed(2),
    galleryReloads: c1.gvLoads - c0j.gvLoads, srcdocWrites: c1.srcdoc - c0j.srcdoc, nestedReloads: c1.nestedLoads - c0j.nestedLoads,
    frameStyleWritesPerSwitchMax: maxStyleMut };
  check('perf', 'switching never reloads the gallery frame', metrics.switch.galleryReloads === 0 && metrics.switch.srcdocWrites === 0, metrics.switch);
  check('perf', 'switching rewrites at most one stylesheet in the frame', maxStyleMut <= 1, 'max ' + maxStyleMut);
  for (const id of ['cloudscape-dark', 'cloudscape-light', 'fluent-dark', 'fluent-light', 'aero-light', 'glass-dark']) {
    if (!BY_ID[id] || !SHOTS) continue;
    await setTheme(id); await settle(id); await shot('aws-' + id);
  }

  // ---- 3. pack kept across modes
  await setTheme('fluent-dark'); await settle('fluent-dark');
  await call(function () { document.querySelector('.cs-mode button[data-mode="light"]').click(); });
  s = await settle('fluent-light');
  check('pack', 'Light toggle keeps the pack (fluent-dark -> fluent-light)', s.id === 'fluent-light', s.id);
  await call(function () { document.querySelector('.cs-mode button[data-mode="dark"]').click(); });
  s = await settle('fluent-dark');
  check('pack', 'Dark toggle keeps the pack (fluent-light -> fluent-dark)', s.id === 'fluent-dark', s.id);
  await call(function () { document.getElementById('srWhatsNew').click(); });
  await sleep(150);
  await call(function () { var b = document.getElementById('prRevealLight'); if (b) b.click(); });
  s = await settle('fluent-light');
  check('pack', 'reveal "Try light mode" keeps the pack', s.id === 'fluent-light', s.id);
  await call(function () { var m = document.getElementById('prReveal'); if (m) m.classList.remove('open'); });

  // ---- 4. every kind of page follows, no themed frame left stale
  for (const page of ['facets', 'search', 'variants', 'showcase']) {
    await setTheme('cloudscape-dark'); await settle('cloudscape-dark');
    const ok = await go(page);
    if (!ok) { check('pages', page + ' loads', false, 'timeout'); continue; }
    await sleep(page === 'variants' ? 1200 : 300);
    const loads0 = JSON.parse(await ev('JSON.stringify(window.__tsc)'));
    const bad = [];
    for (const id of ['fluent-light', 'primer-dark', 'material3-light']) {
      await setTheme(id); s = await settle(id);
      const b = stateMatches(s, BY_ID[id], page + ' ' + id); if (b) bad.push(...b);
      if (page === 'variants' && !s.nested.length) bad.push('variants: no live previews found');
    }
    const loads1 = JSON.parse(await ev('JSON.stringify(window.__tsc)'));
    check('pages', page + ' follows the switch (tokens, data-mode, color-scheme' + (page === 'variants' ? ', every live preview' : '') + ')', bad.length === 0, bad.slice(0, 4));
    check('pages', page + ' does not reload on switch', loads1.gvLoads === loads0.gvLoads && loads1.srcdoc === loads0.srcdoc && loads1.nestedLoads === loads0.nestedLoads,
      { gv: loads1.gvLoads - loads0.gvLoads, srcdoc: loads1.srcdoc - loads0.srcdoc, nested: loads1.nestedLoads - loads0.nestedLoads });
    if (page === 'variants' || page === 'showcase') await shot(page + '-material3-light');
  }

  // ---- 4b. another tab changes the theme (storage event): this tab and its frame follow
  await go('charts');
  await call(function () {
    localStorage.setItem('prismTheme', 'monzo-light'); localStorage.setItem('prismThemeMode', 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: 'prismTheme', newValue: 'monzo-light' }));
  });
  s = await settle('monzo-light');
  check('pages', 'a change made in another tab is followed (shell + frame)', !stateMatches(s, BY_ID['monzo-light']), stateMatches(s, BY_ID['monzo-light']));

  // ---- 5. ?theme= / &mode= deep links
  await open('?theme=fluent-light', 'charts', {});
  s = await settle('fluent-light');
  check('url', '?theme=fluent-light applies', !stateMatches(s, BY_ID['fluent-light']), stateMatches(s, BY_ID['fluent-light']));
  const urlFouc = await fouc('fluent-light');
  metrics.urlFirstVisit = { shellWrongFrames: urlFouc.shellBad.length, staleFrameDocs: urlFouc.frameBad.length };
  await open('?theme=gcp&mode=light', 'charts', { prismTheme: 'primer-dark' });
  s = await settle('gcp-light');
  check('url', '?theme=gcp&mode=light applies gcp-light', s.id === 'gcp-light', s.id);
  await open('?theme=fluent&mode=auto', 'charts', {}, 'light');
  s = await settle('fluent-light');
  check('url', '?theme=fluent&mode=auto follows the system (light)', s.id === 'fluent-light' && s.mode === 'auto', s.id + ' mode=' + s.mode);
  await open('?theme=no-such-theme', 'charts', { prismTheme: 'primer-dark' });
  s = await settle('primer-dark');
  const warned = consoleLog.some(c => (c.type === 'warning' || c.type === 'warn') && /theme/i.test(c.text) && /no-such-theme/.test(c.text));
  check('url', 'invalid ?theme= falls back to the stored theme', s.id === 'primer-dark', s.id);
  check('url', 'invalid ?theme= warns on the console', warned, consoleLog.slice(0, 3));

  // ---- 6. Auto follows prefers-color-scheme live, keeps the pack, survives reload
  await open('', 'aws', { prismTheme: 'primer-dark' }, 'dark', true);
  const hasAuto = await call(function () { return !!document.querySelector('.cs-mode button[data-mode="auto"]'); });
  check('auto', 'an Auto choice exists next to Light/Dark', hasAuto, 'no .cs-mode button[data-mode=auto]');
  if (hasAuto) {
    await call(function () { document.querySelector('.cs-mode button[data-mode="auto"]').click(); });
    s = await settle('primer-dark');
    const pressed = await call(function () { return document.querySelector('.cs-mode button[data-mode="auto"]').getAttribute('aria-pressed'); });
    check('auto', 'Auto under a dark system = pack dark, Auto marked pressed', s.id === 'primer-dark' && s.mode === 'auto' && pressed === 'true', s.id + ' ' + s.mode + ' ' + pressed);
    await media('light', true);
    s = await settle('primer-light');
    check('auto', 'system turns light -> primer-light live (shell + frame)', !stateMatches(s, BY_ID['primer-light']), stateMatches(s, BY_ID['primer-light']));
    await shot('auto-primer-light-aws');
    await media('dark', true);
    s = await settle('primer-dark');
    check('auto', 'system turns dark -> primer-dark live', !stateMatches(s, BY_ID['primer-dark']), stateMatches(s, BY_ID['primer-dark']));
    await media('light', true);
    await call(function () { window.__fouc = []; });
    await send('Page.reload', {}); await waitPage('aws');
    s = await settle('primer-light');
    const af = await fouc('primer-light');
    check('auto', 'Auto persists across reload (light system -> primer-light)', s.id === 'primer-light' && s.mode === 'auto', s.id + ' ' + s.mode);
    check('auto', 'Auto reload paints the right mode from the first frame', af.shellBad.length === 0 && af.frameBad.length === 0,
      { shell: af.shellBad.slice(0, 1), frames: af.frameBad.slice(0, 1) });
    await call(function () { document.querySelector('.cs-mode button[data-mode="dark"]').click(); });
    s = await settle('primer-dark');
    check('auto', 'choosing Dark leaves Auto (system light, theme stays dark)', s.id === 'primer-dark' && s.mode !== 'auto', s.id + ' ' + s.mode);
    await media('dark', true);
  }

  // ---- 7. the picker
  await open('', 'charts', { prismTheme: 'cloudscape-dark' }, 'dark', true);
  const P = await call(function () {
    var btn = document.getElementById('csThemeBtn'), menu = document.getElementById('csThemeMenu');
    if (!btn || !menu) return null;
    var opts = [].slice.call(menu.querySelectorAll('[role="option"]'));
    var groups = [].slice.call(menu.querySelectorAll('[role="group"]'));
    return { btnPopup: btn.getAttribute('aria-haspopup'), btnExpanded: btn.getAttribute('aria-expanded'), btnControls: btn.getAttribute('aria-controls'),
      role: menu.getAttribute('role'), label: menu.getAttribute('aria-label') || menu.getAttribute('aria-labelledby'), hidden: menu.hidden || getComputedStyle(menu).display === 'none',
      groups: groups.map(function (g) { var lb = g.getAttribute('aria-labelledby'); return { label: g.getAttribute('aria-label') || (lb && document.getElementById(lb) ? document.getElementById(lb).textContent : ''),
        opts: [].slice.call(g.querySelectorAll('[role="option"]')).map(function (o) { return o.getAttribute('data-theme'); }) }; }),
      opts: opts.map(function (o) {
        var sw = [].slice.call(o.querySelectorAll('.sw i, .sw span, [data-swatch]'));
        return { id: o.getAttribute('data-theme'), sel: o.getAttribute('aria-selected'), sw: sw.map(function (i) { return getComputedStyle(i).backgroundColor; }) };
      }) };
  });
  check('picker', 'a theme picker button + listbox exist (#csThemeBtn, #csThemeMenu)', !!P, 'not found');
  if (P) {
    check('picker', 'trigger announces a listbox popup (aria-haspopup, aria-expanded=false, aria-controls)', P.btnPopup === 'listbox' && P.btnExpanded === 'false' && P.btnControls === 'csThemeMenu', P);
    check('picker', 'popup is a labelled listbox, hidden until opened', P.role === 'listbox' && !!P.label && P.hidden, { role: P.role, label: P.label, hidden: P.hidden });
    const optIds = P.opts.map(o => o.id).filter(Boolean);
    check('picker', 'every registry theme is an option', REG.every(t => optIds.includes(t.id)) && optIds.length === REG.length, REG.filter(t => !optIds.includes(t.id)).map(t => t.id));
    const groupOk = P.groups.length === FAMILIES.length && P.groups.every(g => { const ts = g.opts.map(id => BY_ID[id]); return ts.length === 2 && ts[0] && ts[1] && ts[0].ds === ts[1].ds && ts[0].mode !== ts[1].mode && !!g.label; });
    check('picker', 'grouped by pack: ' + FAMILIES.length + ' labelled groups, each with its dark and light together', groupOk, P.groups.slice(0, 3));
    const rgb = hex => { const h = hex.replace('#', ''); const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6); const n = parseInt(f, 16); return `rgb(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255})`; };
    const swBad = P.opts.filter(o => { const t = BY_ID[o.id]; return !t || !o.sw.includes(rgb(t.bg)) || !o.sw.includes(rgb(t.accent)); }).map(o => o.id);
    check('picker', 'each option shows its bg and accent swatches', swBad.length === 0, swBad.slice(0, 5));
    const selected = P.opts.filter(o => o.sel === 'true').map(o => o.id);
    check('picker', 'exactly the current theme is marked selected', selected.length === 1 && selected[0] === 'cloudscape-dark', selected);
    // keyboard: open with Enter, move, Escape returns focus without changing the theme
    await call(function () { document.getElementById('csThemeBtn').focus(); });
    await key('Enter'); await sleep(120);
    let k = await call(function () { var a = document.activeElement, m = document.getElementById('csThemeMenu');
      return { open: !m.hidden && getComputedStyle(m).display !== 'none', expanded: document.getElementById('csThemeBtn').getAttribute('aria-expanded'), focus: a && a.getAttribute('data-theme'), role: a && a.getAttribute('role'),
        ring: a ? (getComputedStyle(a).outlineStyle !== 'none' && parseFloat(getComputedStyle(a).outlineWidth) > 0) || getComputedStyle(a).boxShadow !== 'none' : false }; });
    check('picker', 'Enter opens it and focuses the current theme', k.open && k.expanded === 'true' && k.focus === 'cloudscape-dark' && k.role === 'option', k);
    check('picker', 'the focused option has a visible focus ring', k.ring, k);
    await shot('picker-open-cloudscape-dark');
    await key('ArrowRight'); k = await call(function () { return document.activeElement.getAttribute('data-theme'); });
    check('picker', 'ArrowRight moves to the other mode of the same pack', k === 'cloudscape-light', k);
    await key('ArrowDown'); k = await call(function () { return document.activeElement.getAttribute('data-theme'); });
    const nextFam = P.groups[1] && BY_ID[P.groups[1].opts[0]] ? BY_ID[P.groups[1].opts[0]].ds : FAMILIES[1];
    check('picker', 'ArrowDown moves to the next pack, same mode', k === (pair(nextFam, 'light') || {}).id, k);
    const listed = P.groups.map(g => BY_ID[g.opts[0]] && BY_ID[g.opts[0]].ds);   // pack order as the picker lists it
    await key('End'); const endId = await call(function () { return document.activeElement.getAttribute('data-theme'); });
    check('picker', 'End jumps to the last listed pack', BY_ID[endId] && BY_ID[endId].ds === listed[listed.length - 1], endId);
    await key('Home'); const homeId = await call(function () { return document.activeElement.getAttribute('data-theme'); });
    check('picker', 'Home jumps to the first listed pack', BY_ID[homeId] && BY_ID[homeId].ds === listed[0], homeId);
    await key('Escape');
    k = await call(function () { var m = document.getElementById('csThemeMenu'); return { open: !m.hidden, focus: document.activeElement && document.activeElement.id, theme: window.PrismShell.getTheme() }; });
    check('picker', 'Escape closes, returns focus to the button, keeps the theme', !k.open && k.focus === 'csThemeBtn' && k.theme === 'cloudscape-dark', k);
    await key('ArrowDown'); await sleep(100);
    await key('ArrowDown'); await key('ArrowRight');
    const want = await call(function () { return document.activeElement.getAttribute('data-theme'); });
    await key('Enter');
    s = await settle(want);
    k = await call(function () { var m = document.getElementById('csThemeMenu'); return { open: !m.hidden, focus: document.activeElement && document.activeElement.id }; });
    check('picker', 'ArrowDown opens, Enter applies the focused theme, closes, returns focus', s.id === want && !k.open && k.focus === 'csThemeBtn', { want, got: s.id, k });
    const sel2 = await call(function () { return [].slice.call(document.querySelectorAll('#csThemeMenu [aria-selected="true"]')).map(function (o) { return o.getAttribute('data-theme'); }); });
    check('picker', 'the new theme is the one marked selected', sel2.length === 1 && sel2[0] === want, sel2);
    await call(function () { document.getElementById('csThemeBtn').click(); });
    await sleep(150); await shot('picker-open-' + want);
    await call(function () { document.body.click(); }); await sleep(100);
    const outside = await call(function () { return document.getElementById('csThemeMenu').hidden; });
    check('picker', 'a click outside closes it', outside === true, outside);
    // type-ahead: "f" jumps to the next pack whose name starts with f, "fl" keeps matching
    const labels = P.groups.map(g => (g.label || '').trim().toLowerCase());
    const cur = await call(function () { return window.PrismShell.getTheme(); });
    const gi = P.groups.findIndex(g => g.opts.includes(cur));
    const firstF = [...labels.slice(gi + 1), ...labels.slice(0, gi + 1)].find(l => l.startsWith('f'));
    const fl = labels.find(l => l.startsWith('fl'));
    await call(function () { document.getElementById('csThemeBtn').focus(); });
    await key('Enter'); await sleep(100);
    await key('f');
    const tf = await call(function () { var a = document.activeElement, g = a && a.closest('[role="group"]'); var lb = g && document.getElementById(g.getAttribute('aria-labelledby')); return lb ? lb.textContent.trim().toLowerCase() : null; });
    await key('l');
    const tfl = await call(function () { var a = document.activeElement, g = a && a.closest('[role="group"]'); var lb = g && document.getElementById(g.getAttribute('aria-labelledby')); return lb ? lb.textContent.trim().toLowerCase() : null; });
    check('picker', 'type-ahead: "f" -> ' + firstF + ', "fl" -> ' + fl, tf === firstF && tfl === fl, { tf, tfl });
    await key('Tab');
    k = await call(function () { var m = document.getElementById('csThemeMenu'); return { open: !m.hidden, inMenu: m.contains(document.activeElement), theme: window.PrismShell.getTheme() }; });
    check('picker', 'Tab closes it without changing the theme', !k.open && !k.inMenu && k.theme === cur, k);
  }

  // ---- 8. motion: cross-fade unless reduced motion
  await media('dark', false);
  const vt = await call(async function () {
    var n = 0, orig = document.startViewTransition;
    if (!orig) return { supported: false };
    document.startViewTransition = function (cb) { n++; return orig.call(document, cb); };
    window.PrismShell.setTheme('cloudscape-light');
    await new Promise(function (r) { setTimeout(r, 600); });
    document.startViewTransition = orig;
    return { supported: true, calls: n };
  });
  s = await settle('cloudscape-light');
  check('motion', 'switch cross-fades with a View Transition when motion is allowed', !vt.supported || vt.calls === 1, vt);
  check('motion', 'the cross-fade lands on the right theme', !stateMatches(s, BY_ID['cloudscape-light']), stateMatches(s, BY_ID['cloudscape-light']));
  await media('dark', true);
  const rm = await call(function () {
    var n = 0, orig = document.startViewTransition;
    if (orig) document.startViewTransition = function (cb) { n++; return orig.call(document, cb); };
    window.PrismShell.setTheme('fluent-dark');
    var cs = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase();
    var fcs = getComputedStyle(document.getElementById('gv').contentDocument.documentElement).getPropertyValue('--bg').trim().toLowerCase();
    if (orig) document.startViewTransition = orig;
    return { calls: n, shellBg: cs, frameBg: fcs };
  });
  check('motion', 'reduced motion: no transition, applied synchronously', rm.calls === 0 && rm.shellBg === BY_ID['fluent-dark'].bg && rm.frameBg === BY_ID['fluent-dark'].bg, rm);

  const errs = consoleLog.filter(c => c.type === 'exception' || c.type === 'error');
  metrics.consoleErrors = errs.length;
}

let crashed = null;
try { await main(); } catch (e) { crashed = e; }
finally {
  try { ws && ws.close(); } catch {}
  await closeBrowser(PORT, proc);
  await sleep(300);
  try { rmSync(udd, { recursive: true, force: true }); } catch {}
}
const failed = results.filter(r => !r.ok);
if (JSON_OUT) console.log(J({ ok: !crashed && !failed.length, crashed: crashed && String(crashed.stack || crashed), metrics, results }, null, 2));
else {
  console.log('\nmetrics ' + J(metrics, null, 1).replace(/\n\s*/g, ' '));
  if (crashed) console.log('CRASH ' + (crashed.stack || crashed));
  console.log((failed.length || crashed ? 'FAIL' : 'PASS') + ': ' + (results.length - failed.length) + '/' + results.length + ' checks passed');
}
process.exit(failed.length || crashed ? 1 : 0);
