/* ============================================================================
   Page sweep gate (headless Chrome/Edge over CDP, zero deps).
   ----------------------------------------------------------------------------
   Loads every page the shell routes to (PrismShell.pages) and drives the main
   controls the way a person does, then fails on what they would hit:

     pages     every page renders (frame complete, real content) in Cloudscape Dark,
               then follows a live switch to Cloudscape Light and Duolingo Light,
               at 1440 and 390 wide. No console error, uncaught exception, unhandled
               rejection, failed resource load or dialog on any of them.
     layout    no horizontal page scroll in the shell or the gallery frame; every
               section header of a gallery sits on one left edge (a stray </div>
               that ends .wrap early drops the rest of the page out of the gutters);
               no two elements share an id unless they are identical copies; no
               <use href="#id"> or url(#id) pointing at an id the page lacks.
     storage   with localStorage throwing (site data blocked) every page still
               loads clean, from a ?theme= link to a light pack at phone width.
     controls  rail and breadcrumb nav (real mouse clicks), hash routing, the
               mobile rail toggle, quick search (Ctrl+K in the shell and inside the
               gallery frame, typing, arrows, Enter, Escape), full Search, the theme
               picker, Light / Dark / Auto, the New Facets window and Spectrums
               toggle, the Variant Matrix modal, the Showcase readout, Collections
               create / rename / delete, Idea run and calibrate, the What's new
               dialog.
     a11y      landmarks (banner, two labelled navigations, main), aria-current on
               the active rail link and the breadcrumb, aria-expanded on the rail
               toggle, the frame's accessible name follows the page, every Tab stop
               in the shell is visible (closed quick search, off-canvas rail), the
               What's new dialog takes focus, keeps Tab inside and gives it back.

   Usage:
     node catalog/_check_pages.mjs                 # gate (exit 1 on failure)
     node catalog/_check_pages.mjs --pages fx,lab  # only these pages in the sweeps
     node catalog/_check_pages.mjs --file X.html   # run against another copy
     node catalog/_check_pages.mjs --json          # machine-readable report
     node catalog/_check_pages.mjs --self-test     # prove each inspector fails on a planted defect
   Honors PRISM_CHROME (see _chrome.mjs). Starts ONE headless browser, reuses it for every
   page, and always closes it: every DevTools call has a timeout (PRISM_STEP_MS, default 30 s)
   and the whole run a budget (PRISM_BUDGET_MS, default 300 s); past either, the browser's
   whole process tree is killed (the launcher alone is not enough on Windows) and the gate fails.
   ========================================================================== */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveChrome, closeBrowser } from './_chrome.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = n => argv.includes(n);
const FILE = resolve(opt('--file', process.env.PRISM_HTML || resolve(HERE, '../Prism.html')));
const ONLY = (opt('--pages', '') || '').split(',').filter(Boolean);
const JSON_OUT = flag('--json');
const SELF_TEST = flag('--self-test');
const URL0 = pathToFileURL(FILE).href;
const PORT = 9300 + Math.floor(Math.random() * 500);
const STEP_MS = +(process.env.PRISM_STEP_MS || 30000);
const BUDGET_MS = +(process.env.PRISM_BUDGET_MS || 300000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const J = JSON.stringify;

// ---------------------------------------------------------------- results
const results = [];
function check(group, name, ok, detail) {
  results.push({ group, name, ok: !!ok, detail: ok ? undefined : detail });
  if (!JSON_OUT) console.log((ok ? '  ok   ' : '  FAIL ') + group + ': ' + name + (ok || detail == null ? '' : '  -> ' + (typeof detail === 'string' ? detail : J(detail))));
}

// ---------------------------------------------------------------- browser + CDP
const udd = mkdtempSync(resolve(tmpdir(), 'prism-pages-'));
const proc = spawn(resolveChrome(), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1440,900',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + udd, 'about:blank'], { stdio: 'ignore' });
// Kill every process of THIS browser: the spawned tree, plus any browser process carrying this run's
// unique profile dir (the launcher can exit and leave the real browser running on its own).
function killTree() {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore', timeout: 15000 });
      const ps = "Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains('" + udd.replace(/'/g, "''") + "') } | ForEach-Object { $_.ProcessId }";
      const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 20000 });
      (r.stdout || '').split(/\s+/).filter(Boolean).forEach(pid => spawnSync('taskkill', ['/T', '/F', '/PID', pid], { stdio: 'ignore', timeout: 15000 }));
    } else {
      try { proc.kill('SIGKILL'); } catch {}
      spawnSync('pkill', ['-9', '-f', udd], { stdio: 'ignore', timeout: 15000 });
    }
  } catch {}
}
let finished = false;
async function shutdown() {
  if (finished) return; finished = true;
  try { ws && ws.close(); } catch {}
  await Promise.race([closeBrowser(PORT, proc), sleep(8000)]);
  await sleep(500);
  killTree();   // no-op when the browser already exited; ends it when it did not
  try { rmSync(udd, { recursive: true, force: true }); } catch {}
}
// the whole-run budget: past it, end the browser tree and fail rather than hang the machine
const watchdog = setTimeout(() => {
  console.log('FAIL: the run passed its ' + Math.round(BUDGET_MS / 1000) + ' s budget; killing the browser tree');
  finished = true; killTree(); try { rmSync(udd, { recursive: true, force: true }); } catch {}
  process.exit(1);
}, BUDGET_MS);
watchdog.unref();
let ws, seq = 0; const pending = new Map();
// every DevTools call times out (a hung renderer must not hang the gate)
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++seq;
  const t = setTimeout(() => { pending.delete(i); rej(new Error('CDP ' + method + ' timed out after ' + STEP_MS + ' ms')); }, STEP_MS);
  pending.set(i, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } });
  ws.send(J({ id: i, method, params }));
});
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) throw new Error('page: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r && r.result ? r.result.value : undefined;
}
const call = (fn, ...args) => ev('(' + fn.toString() + ')(' + args.map(a => J(a)).join(',') + ')');

// Everything the page reports, tagged with what the run was doing at the time.
let phase = 'boot';
const events = [], reqUrl = {};
function onEvent(m, p) {
  if (m === 'Runtime.exceptionThrown') {
    const d = p.exceptionDetails;
    events.push({ phase, kind: 'exception', text: ((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 240) });
  } else if (m === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'assert')) {
    events.push({ phase, kind: 'console.' + p.type, text: (p.args || []).map(a => a.value != null ? String(a.value) : (a.description || '')).join(' ').slice(0, 240) });
  } else if (m === 'Log.entryAdded' && p.entry.level === 'error') {
    // browser interventions (e.g. navigator.vibrate before a tap) are blocked calls, not faults
    events.push({ phase, kind: 'log.' + p.entry.source, text: (p.entry.text || '').slice(0, 240), url: (p.entry.url || '').slice(0, 120), soft: p.entry.source === 'intervention' });
  } else if (m === 'Network.requestWillBeSent') {
    reqUrl[p.requestId] = p.request.url;
  } else if (m === 'Network.loadingFailed' && !p.canceled) {
    events.push({ phase, kind: 'net.failed', text: p.errorText, url: (reqUrl[p.requestId] || '').slice(0, 160) });
  } else if (m === 'Network.responseReceived' && p.response.status >= 400) {
    events.push({ phase, kind: 'net.' + p.response.status, text: p.response.statusText || '', url: p.response.url.slice(0, 160) });
  } else if (m === 'Page.javascriptDialogOpening') {
    events.push({ phase, kind: 'dialog', text: p.type + ': ' + (p.message || '').slice(0, 120) });
    send('Page.handleJavaScriptDialog', { accept: true });
  }
}
const hard = list => list.filter(e => !e.soft);
function eventsSince(n) { return events.slice(n); }

async function viewport(w) {
  const mobile = w < 600;
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: mobile ? 844 : 900, deviceScaleFactor: 1, mobile });
  await send('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
}
async function media(scheme) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
}
// Site data blocked: reading localStorage / sessionStorage throws, as with blocked cookies.
const BLOCK_STORAGE = `(function(){ function no(){ throw new DOMException('The operation is insecure.','SecurityError'); }
  try{ Object.defineProperty(window,'localStorage',{configurable:true,get:no}); Object.defineProperty(window,'sessionStorage',{configurable:true,get:no}); }catch(e){} })();`;
// Fresh load: seed storage, open Prism.html<query>#page, wait for the page.
async function open(query, page, { seed = {} } = {}) {
  const token = 'seed' + Math.random().toString(36).slice(2);
  const src = `if(window===window.top){ try{ if(sessionStorage.getItem('__seed')!==${J(token)}){
        localStorage.clear(); var s=${J(seed)}; for(var k in s) localStorage.setItem(k,s[k]);
        if(!('prismRevealSeen' in s)) localStorage.setItem('prismRevealSeen','1');
        sessionStorage.setItem('__seed',${J(token)}); } }catch(e){} }`;
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: src });
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(50);
  await send('Page.navigate', { url: URL0 + (query || '') + '#' + page });
  const ok = await waitPage(page, 40000);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  return ok;
}
async function waitPage(page, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await call(function (p) {
      try {
        var S = window.PrismShell; if (!S || S.current() !== p) return false;
        var fw = document.getElementById('fw'), d = document.getElementById('gv').contentDocument;
        return !!(fw && fw.classList.contains('in') && d && d.readyState === 'complete' && d.body && !document.getElementById('veil'));
      } catch (e) { return false; }
    }, page).catch(() => false);
    if (ok) { await sleep(300); return true; }
    await sleep(100);
  }
  return false;
}
async function go(page) { await call(function (p) { window.PrismShell.go(p); }, page); return waitPage(page); }
async function setTheme(id) {
  await call(function (id) { window.PrismShell.setTheme(id); }, id);
  for (let i = 0; i < 40; i++) {
    const ok = await call(function (id) { var d = document.getElementById('gv').contentDocument; return document.documentElement.getAttribute('data-theme') === id && (!d || !d.documentElement || d.documentElement.getAttribute('data-theme') === id); }, id);
    if (ok) break; await sleep(50);
  }
  await sleep(200);
}
async function waitFor(fn, arg, timeout = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = await call(fn, arg).catch(() => null); if (v) return v; await sleep(80); }
  return null;
}
// Real input: a mouse click at an element's centre (shell element, or one inside the frame).
async function clickAt(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(60);
}
async function click(sel, inFrame) {
  const r = await call(function (sel, inFrame) {
    var doc = document, ox = 0, oy = 0;
    if (inFrame) { var gv = document.getElementById('gv'), g = gv.getBoundingClientRect(); doc = gv.contentDocument; ox = g.left; oy = g.top; }
    var el = doc.querySelector(sel); if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    var b = el.getBoundingClientRect(); if (!b.width || !b.height) return null;
    return { x: ox + b.left + b.width / 2, y: oy + b.top + b.height / 2 };
  }, sel, !!inFrame);
  if (!r) return false;
  await clickAt(r.x, r.y);
  return true;
}
const KEYS = { Enter: [13, 'Enter', '\r'], Escape: [27, 'Escape'], ArrowDown: [40, 'ArrowDown'], ArrowUp: [38, 'ArrowUp'], Tab: [9, 'Tab'], k: [75, 'KeyK', 'k'] };
async function key(k, modifiers = 0) {
  const K = KEYS[k];
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: K[1], windowsVirtualKeyCode: K[0], nativeVirtualKeyCode: K[0], text: modifiers ? undefined : K[2], modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: K[1], windowsVirtualKeyCode: K[0], nativeVirtualKeyCode: K[0], modifiers });
  await sleep(50);
}
const CTRL = 2;
async function type(text) { await send('Input.insertText', { text }); await sleep(250); }

// ---------------------------------------------------------------- in-page inspector
// Runs in the shell. Returns layout facts for the shell and the gallery frame document.
// Kept self-contained (it is serialized), and exercised by --self-test on a planted fixture.
function inspectPage(fixture) {
  function sel(el) {
    var c = el.className && el.className.baseVal == null ? String(el.className).trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (c ? '.' + c : '');
  }
  // elements that stick out past the right edge and are not clipped by an ancestor
  function overflow(doc, win) {
    var vw = doc.documentElement.clientWidth, out = [];
    if (doc.documentElement.scrollWidth - vw <= 1) return out;
    var all = doc.body ? doc.body.querySelectorAll('*') : [], marked = [];
    for (var i = 0; i < all.length && out.length < 5; i++) {
      var el = all[i], r = el.getBoundingClientRect();
      if (!r.width || r.right <= vw + 1) continue;
      var a = el.parentElement, skip = false;
      while (a && a !== doc.body) { if (a.__pov || win.getComputedStyle(a).overflowX !== 'visible') { skip = true; break; } a = a.parentElement; }
      if (skip) continue;
      el.__pov = 1; marked.push(el);
      out.push(sel(el) + ' right=' + Math.round(r.right) + ' > ' + vw);
    }
    marked.forEach(function (e) { delete e.__pov; });
    if (!out.length) out.push('scrollWidth ' + doc.documentElement.scrollWidth + ' > ' + vw);
    return out;
  }
  function frameFacts(d, w) {
    var f = { overflow: overflow(d, w), textLen: (d.body.innerText || '').trim().length, height: d.body.scrollHeight };
    // section headers of one gallery share a left edge
    var lefts = {};
    d.querySelectorAll('h3.sec').forEach(function (h) { if (!h.offsetParent || h.closest('.tile,.panel')) return; var l = Math.round(h.getBoundingClientRect().left); (lefts[l] = lefts[l] || []).push((h.textContent || '').trim().slice(0, 30)); });
    var keys = Object.keys(lefts);
    f.gutters = keys.length > 1 ? keys.map(function (k) { return k + 'px: ' + lefts[k].length + ' (' + lefts[k][0] + ')'; }) : [];
    // duplicate ids: identical copies (a self-contained facet's own sprite) are fine; differing ones are not
    var byId = {};
    d.querySelectorAll('[id]').forEach(function (e) { (byId[e.id] = byId[e.id] || []).push(e); });
    f.dupIds = Object.keys(byId).filter(function (k) {
      var l = byId[k]; if (l.length < 2) return false;
      var h0 = l[0].outerHTML; return l.some(function (e) { return e.outerHTML !== h0; });
    }).slice(0, 8).map(function (k) { return k + ' x' + byId[k].length; });
    var miss = {};
    d.querySelectorAll('use').forEach(function (u) { var h = u.getAttribute('href') || u.getAttribute('xlink:href') || ''; if (h.charAt(0) === '#' && !d.getElementById(h.slice(1))) miss[h] = 1; });
    d.querySelectorAll('[fill],[stroke],[clip-path],[mask],[filter],[marker-start],[marker-mid],[marker-end]').forEach(function (e) {
      ['fill', 'stroke', 'clip-path', 'mask', 'filter', 'marker-start', 'marker-mid', 'marker-end'].forEach(function (a) {
        var v = e.getAttribute(a), m = v && /url\(\s*['"]?#([^)'"\s]+)/.exec(v); if (m && !d.getElementById(m[1])) miss['url(#' + m[1] + ')'] = 1; });
    });
    f.missingRefs = Object.keys(miss).slice(0, 8);
    f.brokenImg = [].slice.call(d.images).filter(function (im) { return im.complete && !im.naturalWidth && im.getAttribute('src'); }).map(function (im) { return im.getAttribute('src').slice(0, 60); }).slice(0, 5);
    return f;
  }
  if (fixture) return frameFacts(document, window);
  var gv = document.getElementById('gv'), d = gv && gv.contentDocument;
  var out = { shellOverflow: overflow(document, window) };
  var ids = {}; document.querySelectorAll('[id]').forEach(function (e) { ids[e.id] = (ids[e.id] || 0) + 1; });
  out.shellDupIds = Object.keys(ids).filter(function (k) { return ids[k] > 1; });
  if (!d || !d.body) { out.noFrame = true; return out; }
  out.frame = frameFacts(d, gv.contentWindow);
  return out;
}
function pageProblems(r) {
  const p = [];
  if (r.noFrame) return ['no gallery document'];
  if (r.shellOverflow.length) p.push('shell scrolls sideways: ' + r.shellOverflow.join('; '));
  if (r.shellDupIds.length) p.push('shell duplicate ids: ' + r.shellDupIds.join(', '));
  const f = r.frame;
  if (f.textLen < 40 || f.height < 200) p.push('frame looks blank (text ' + f.textLen + ', height ' + f.height + ')');
  if (f.overflow.length) p.push('frame scrolls sideways: ' + f.overflow.join('; '));
  if (f.gutters.length) p.push('section headers on ' + f.gutters.length + ' left edges: ' + f.gutters.join(' | '));
  if (f.dupIds.length) p.push('differing elements share an id: ' + f.dupIds.join(', '));
  if (f.missingRefs.length) p.push('references to missing ids: ' + f.missingRefs.join(', '));
  if (f.brokenImg.length) p.push('broken images: ' + f.brokenImg.join(', '));
  return p;
}

// Every Tab stop in the shell, in order, until it reaches the gallery frame or wraps; each must
// be visible (not transparent, not hidden, not off-canvas) when it takes focus.
async function walkTabStops(max) {
  // start from the top of the document: focus a throwaway element placed first in <body>
  await call(function () {
    var s = document.createElement('span'); s.tabIndex = -1; s.id = '__tabstart';
    document.body.insertBefore(s, document.body.firstChild); window.focus(); s.focus();
  });
  const seen = [], hidden = [];
  for (let i = 0; i < max; i++) {
    await key('Tab');
    const s = await call(function () {
      var a = document.activeElement; if (!a || a === document.body) return { none: true };
      if (a.id === 'gv') return { frame: true };
      var r = a.getBoundingClientRect(), cs = getComputedStyle(a), vis = true, e = a;
      while (e && e.nodeType === 1) { var c = getComputedStyle(e); if (c.visibility === 'hidden' || c.display === 'none' || parseFloat(c.opacity) < 0.05) { vis = false; break; } e = e.parentElement; }
      var on = r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
      var name = (a.getAttribute('aria-label') || a.textContent || a.id || a.tagName).trim().replace(/\s+/g, ' ').slice(0, 30);
      return { name: name, ok: vis && on && cs.visibility !== 'hidden' };
    });
    if (i === 0) await call(function () { var s = document.getElementById('__tabstart'); if (s) s.remove(); });
    if (s.none || s.frame) break;
    if (seen.includes(s.name) && seen.length > 3) break;
    seen.push(s.name);
    if (!s.ok) hidden.push(s.name);
  }
  return { count: seen.length, hidden };
}

// ---------------------------------------------------------------- self-test
// Plant each defect the inspector looks for in a fixture page and require it is reported,
// plus one clean fixture that must come back clean; the event collector must see a planted
// console.error and an uncaught exception.
async function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'prism-pages-fx-'));
  const page = (body, extra) => '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0}.wrap{padding:0 32px}h3{margin:8px 0}</style></head><body>' + body + (extra || '') + '</body></html>';
  const lorem = '<p>' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(8) + '</p><div style="height:400px"></div>';
  const cases = {
    clean: page('<div class="wrap"><h3 class="sec">A</h3>' + lorem + '<h3 class="sec">B</h3><svg><defs><linearGradient id="g"></linearGradient></defs><rect fill="url(#g)" width="5" height="5"/></svg><svg><symbol id="s"><path d="M0 0"/></symbol></svg><svg><symbol id="s"><path d="M0 0"/></symbol></svg></div>'),
    overflow: page('<div class="wrap"><h3 class="sec">A</h3>' + lorem + '<div style="width:3000px;height:10px"></div></div>'),
    gutter: page('<div class="wrap"><h3 class="sec">A</h3>' + lorem + '</div><h3 class="sec">Stray</h3>'),
    dupid: page('<div class="wrap"><h3 class="sec">A</h3>' + lorem + '<i id="x">1</i><i id="x">2</i></div>'),
    missing: page('<div class="wrap"><h3 class="sec">A</h3>' + lorem + '<svg><use href="#nope"/><rect fill="url(#gone)" width="5" height="5"/></svg></div>'),
    errors: page('<div class="wrap"><h3 class="sec">A</h3>' + lorem + '</div>', '<script>console.error("planted error"); setTimeout(function(){ throw new Error("planted throw"); }, 0);<' + '/script>'),
  };
  const want = { overflow: 'scrolls sideways', gutter: 'left edges', dupid: 'share an id', missing: 'missing ids' };
  await viewport(800);
  for (const [name, html] of Object.entries(cases)) {
    const f = join(dir, name + '.html'); writeFileSync(f, html);
    const n0 = events.length; phase = 'self-test:' + name;
    await send('Page.navigate', { url: pathToFileURL(f).href }); await sleep(500);
    const facts = await call(inspectPage, true);
    const probs = pageProblems({ shellOverflow: [], shellDupIds: [], frame: facts });
    const evs = hard(eventsSince(n0));
    if (name === 'clean') check('self-test', 'a clean fixture reports nothing', !probs.length && !evs.length, { probs, evs });
    else if (name === 'errors') check('self-test', 'a planted console.error and uncaught throw are both caught', evs.some(e => /planted error/.test(e.text)) && evs.some(e => e.kind === 'exception' && /planted throw/.test(e.text)), evs);
    else check('self-test', 'a planted ' + name + ' defect is reported', probs.some(p => p.includes(want[name])), probs);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- the run
async function main() {
  let target;
  const tLaunch = Date.now();
  while (Date.now() - tLaunch < 60000) {   // a cold start can take a while; never longer than a minute
    try { target = (await (await fetch(`http://localhost:${PORT}/json`, { signal: AbortSignal.timeout(3000) })).json()).find(t => t.type === 'page'); if (target) break; } catch {}
    await sleep(200);
  }
  if (!target) throw new Error('no DevTools target');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result || {}); return; }
    if (m.method) onEvent(m.method, m.params);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  if (SELF_TEST) { await selfTest(); return; }

  // ---- 1. every page: Cloudscape Dark at 1440 (fresh load each), then live Light / Duolingo Light, 1440 and 390
  await viewport(1440); await media('dark');
  phase = 'boot';
  check('pages', 'the shell loads', await open('', 'charts', { seed: { prismTheme: 'cloudscape-dark', prismThemeMode: 'dark' } }), 'timeout');
  const ALL = await call(function () { return window.PrismShell.pages.map(function (p) { return p.id; }); });
  const PAGES = ONLY.length ? ALL.filter(p => ONLY.includes(p)) : ALL;
  // each theme and each width at least once (the storage pass below adds Duolingo Light at 390 from a fresh load)
  const VIEWS = [['cloudscape-dark', 1440], ['cloudscape-light', 390], ['duolingo-light', 1440]];
  const bad = [], slow = [];
  for (const p of PAGES) {
    phase = p + ' cloudscape-dark@1440';
    const t0 = Date.now();
    if (!(await go(p))) { bad.push(p + ': never finished loading'); continue; }
    if (Date.now() - t0 > 8000) slow.push(p + ' ' + (Date.now() - t0) + 'ms');
    const tl = [Date.now() - t0];
    for (const [theme, w] of VIEWS) {
      phase = p + ' ' + theme + '@' + w;
      const tv = Date.now();
      if (theme !== 'cloudscape-dark') await setTheme(theme);
      await viewport(w); await sleep(w < 600 ? 250 : 120);
      const ti = Date.now();
      let r; try { r = await call(inspectPage, false); } catch (e) { bad.push(phase + ': inspect threw ' + e.message); continue; }
      pageProblems(r).forEach(x => bad.push(phase + ': ' + x));
      tl.push((ti - tv) + '+' + (Date.now() - ti));
    }
    await viewport(1440); await setTheme('cloudscape-dark');
    if (flag('--timing')) console.log('  time ' + p + ' load ' + tl[0] + 'ms, views (switch+inspect) ' + tl.slice(1).join(' '));
  }
  // the same defect usually shows in every view: report each once, with where it showed
  const uniq = {}; bad.forEach(b => { const [where, ...rest] = b.split(': '); const k = where.split(' ')[0] + ': ' + rest.join(': '); (uniq[k] = uniq[k] || []).push(where.split(' ').slice(1).join(' ')); });
  check('pages', PAGES.length + ' pages render in 3 themes at 1440 and 390 with no layout fault', !bad.length,
    Object.entries(uniq).slice(0, 12).map(([k, v]) => k + ' [' + v.length + ' view' + (v.length > 1 ? 's' : '') + ']'));
  const evA = hard(events);
  check('pages', 'no console error, exception, failed load or dialog on any page or theme', !evA.length, evA.slice(0, 8).map(e => e.phase + ' ' + e.kind + ': ' + e.text + (e.url ? ' ' + e.url : '')));
  if (slow.length) check('pages', 'every page loads within 8s', false, slow);

  // ---- 2. site data blocked: localStorage throws in the shell and every frame
  await viewport(390); await media('light');
  let n0 = events.length; const blockedBad = [];
  phase = 'storage-blocked boot';
  const { identifier: blockId } = await send('Page.addScriptToEvaluateOnNewDocument', { source: BLOCK_STORAGE });   // every document, frames included
  const okB = await open('?theme=duolingo&mode=light', PAGES[0]);
  if (!okB) blockedBad.push('shell never loaded');
  else {
    const th = await call(function () { return window.PrismShell.getTheme(); });
    if (th !== 'duolingo-light') blockedBad.push('?theme=duolingo&mode=light gave ' + th);
    for (const p of PAGES.slice(1)) {
      phase = 'storage-blocked ' + p;
      if (!(await go(p))) { blockedBad.push(p + ' never loaded'); continue; }
      const blocked = await call(function () { try { document.getElementById('gv').contentWindow.localStorage; return false; } catch (e) { return true; } });
      if (!blocked) blockedBad.push(p + ': storage was not blocked in the frame (harness)');
    }
  }
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blockId });
  const evB = hard(eventsSince(n0));
  check('storage', 'with localStorage blocked every page loads, from a ?theme= link, at 390', !blockedBad.length && !evB.length,
    blockedBad.concat(evB.slice(0, 8).map(e => e.phase + ' ' + e.kind + ': ' + e.text)));

  // ---- 3. controls
  await viewport(1440); await media('dark');
  n0 = events.length; phase = 'controls';
  await open('', 'charts', { seed: { prismTheme: 'cloudscape-dark', prismThemeMode: 'dark' } });
  // landmarks and names
  const lm = await call(function () {
    var navs = [].slice.call(document.querySelectorAll('nav')).map(function (n) { return n.getAttribute('aria-label'); });
    return { banner: !!document.querySelector('body > header'), main: document.querySelectorAll('main').length, navs: navs,
      rail: !!document.querySelector('nav.prism-rail'), frameTitle: document.getElementById('gv').title,
      current: [].slice.call(document.querySelectorAll('.prism-rail [aria-current="page"]')).map(function (a) { return a.getAttribute('data-page'); }),
      crumb: document.getElementById('csCrumbCur').getAttribute('aria-current') };
  });
  check('a11y', 'landmarks: banner, main, the rail and the breadcrumb are labelled navigations', lm.banner && lm.main === 1 && lm.rail && lm.navs.length === 2 && lm.navs.every(Boolean), lm);
  check('a11y', 'the active rail link and the breadcrumb carry aria-current, the frame is named for its page', J(lm.current) === '["charts"]' && lm.crumb === 'page' && /Charts/.test(lm.frameTitle), lm);
  // rail nav with a real click
  await click('.prism-rail a[data-page="fx"]');
  let ok = await waitPage('fx');
  let st = await call(function () { return { cur: [].slice.call(document.querySelectorAll('.prism-rail [aria-current="page"]')).map(function (a) { return a.getAttribute('data-page'); }), active: document.querySelector('.sr-link.active').getAttribute('data-page'), crumb: document.getElementById('csCrumbCur').textContent, hash: location.hash, title: document.getElementById('gv').title }; });
  check('controls', 'a rail click routes (frame, active link, aria-current, breadcrumb, hash, frame name)', ok && st.active === 'fx' && J(st.cur) === '["fx"]' && /FX/.test(st.crumb) && st.hash === '#fx' && /FX/.test(st.title), st);
  await click('#csCrumbs a[data-page="charts"]');
  check('controls', 'the breadcrumb root link routes', await waitPage('charts'), 'timeout');
  // hash routing (a followed link / edited address bar)
  await call(function () { location.hash = '#maps'; });
  check('controls', 'a same-document #page change routes', await waitPage('maps'), await call(function () { return window.PrismShell.current() + ' ' + location.hash; }));
  await call(function () { location.hash = '#search?q=gauge'; });
  ok = await waitPage('search');
  const sq = ok && await waitFor(function () { var d = document.getElementById('gv').contentDocument, i = d && d.getElementById('srchInput'); return i && i.value; });
  check('controls', '#search?q= routes and the page reads the query', sq === 'gauge', sq);
  if (!sq) await go('search');   // keep going on the page the next checks need
  // full search page: typing filters
  await click('#srchInput', true);
  await call(function () { var i = document.getElementById('gv').contentDocument.getElementById('srchInput'); i.select(); });
  await type('menu');
  const sr = await waitFor(function () { var d = document.getElementById('gv').contentDocument, g = d.getElementById('srchGrid'); return g && g.children.length; });
  check('controls', 'Search: typing renders results', sr > 0, sr);
  // quick search from the shell: Ctrl+K, type, ArrowDown, Enter routes to the facet's gallery
  await go('charts');
  await call(function () { document.getElementById('csThemeBtn').focus(); });
  await key('k', CTRL);
  let qs = await waitFor(function () { var p = document.getElementById('qsPanel'); return p.classList.contains('qs-open') && document.activeElement === document.getElementById('qsInput'); });
  check('controls', 'Ctrl+K in the shell opens quick search with the input focused', !!qs, qs);
  await type('aws lambda');
  const qn = await waitFor(function () { return document.querySelectorAll('#qsRes .qs-item').length; });
  await key('ArrowDown');
  const ad = await call(function () { var i = document.getElementById('qsInput'), id = i.getAttribute('aria-activedescendant'), o = id && document.getElementById(id); return { id: id, sel: o && o.getAttribute('aria-selected') }; });
  check('a11y', 'quick search: ArrowDown sets aria-activedescendant to a selected option', qn > 0 && ad.id && ad.sel === 'true', { results: qn, ad });
  await key('Enter');
  ok = await waitPage('aws');
  qs = await call(function () { return { open: document.getElementById('qsPanel').classList.contains('qs-open'), focus: document.activeElement && document.activeElement.id }; });
  check('controls', 'Enter routes to the facet gallery, closes the panel, focus returns to the button', ok && !qs.open && qs.focus === 'qsFab', qs);
  // Ctrl+K from inside the gallery frame
  await click('.head h1', true);
  const inFrame = await call(function () { return document.activeElement && document.activeElement.id === 'gv'; });
  await key('k', CTRL);
  qs = await waitFor(function () { return document.getElementById('qsPanel').classList.contains('qs-open'); });
  check('controls', 'Ctrl+K with focus inside the gallery frame opens quick search', inFrame && !!qs, { inFrame, open: qs });
  if (!qs) { await click('#qsFab'); await sleep(300); }
  // dragging the panel by its header and letting go over the gallery frame ends the drag there
  // (the frame swallows the mouseup): moving back over the shell must not drag it along
  const hd = await call(function () { var r = document.getElementById('qsHead').getBoundingClientRect(), g = document.getElementById('gv').getBoundingClientRect(); return { x: r.left + 60, y: r.top + r.height / 2, fx: g.left + g.width / 2, fy: g.top + g.height / 2 }; });
  const M = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: buttons || type !== 'mouseMoved' ? 'left' : 'none', buttons, clickCount: 1 });
  const panelAt = () => call(function () { var r = document.getElementById('qsPanel').getBoundingClientRect(); return Math.round(r.left) + ',' + Math.round(r.top); });
  const p0 = await panelAt();
  await M('mousePressed', hd.x, hd.y, 1); await M('mouseMoved', hd.x - 30, hd.y, 1); await M('mouseMoved', hd.x - 60, hd.y, 1);
  const p1 = await panelAt();
  await M('mouseMoved', hd.fx, hd.fy, 1); await M('mouseReleased', hd.fx, hd.fy, 0);
  await M('mouseMoved', 140, 320, 0); await M('mouseMoved', 120, 300, 0);
  const p2 = await panelAt();
  check('controls', 'quick search: a drag released over the gallery frame ends there (no sticky drag)', p1 !== p0 && p2 === p1, { start: p0, dragged: p1, afterRelease: p2 });
  await key('Escape'); await key('Escape');
  qs = await call(function () { var p = document.getElementById('qsPanel'); return { open: p.classList.contains('qs-open'), focus: document.activeElement && document.activeElement.id }; });
  check('controls', 'Escape clears then closes quick search, focus returns to the button', !qs.open && qs.focus === 'qsFab', qs);
  // tab order: every stop in the shell is visible (closed quick search controls, off-canvas rail)
  await sleep(300);
  let tabs = await walkTabStops(60);
  check('a11y', 'every shell Tab stop at 1440 is visible (' + tabs.count + ' stops)', !tabs.hidden.length && tabs.count > 5, tabs.hidden.slice(0, 6));
  // theme picker by mouse, then the mode buttons
  await click('#csThemeBtn');
  await click('#csThemeMenu [data-theme="duolingo-light"]');
  st = await call(function () { return { theme: window.PrismShell.getTheme(), open: !document.getElementById('csThemeMenu').hidden, frame: document.getElementById('gv').contentDocument.documentElement.getAttribute('data-theme') }; });
  check('controls', 'theme picker: a click picks Duolingo Light, closes, the frame follows', st.theme === 'duolingo-light' && !st.open && st.frame === 'duolingo-light', st);
  await click('#csModeDark'); await sleep(150);
  st = await call(function () { return { theme: window.PrismShell.getTheme(), mode: window.PrismShell.getMode(), pressed: document.getElementById('csModeDark').getAttribute('aria-pressed') }; });
  check('controls', 'Dark keeps the pack (duolingo-dark), marked pressed', st.theme === 'duolingo-dark' && st.mode === 'dark' && st.pressed === 'true', st);
  await click('#csModeAuto'); await sleep(150);
  st = await call(function () { return { theme: window.PrismShell.getTheme(), mode: window.PrismShell.getMode() }; });
  check('controls', 'Auto follows the system (dark) and keeps the pack', st.theme === 'duolingo-dark' && st.mode === 'auto', st);
  await setTheme('cloudscape-dark');
  // New Facets: a preset and the Spectrums toggle re-render in place
  ok = await go('facets');
  const before = await call(function () { return window.PrismShell.getFacetsWindow(); });
  await click('.facets-preset[data-days="7"]', true);
  await sleep(300); ok = ok && await waitPage('facets');
  st = await call(function () { var d = document.getElementById('gv').contentDocument; return { days: window.PrismShell.getFacetsWindow(), range: d.getElementById('facetsRange').value, on: d.querySelector('.facets-preset.on') && d.querySelector('.facets-preset.on').getAttribute('data-days') }; });
  const facetsOk = st.days === 7 && st.range === '7' && st.on === '7';
  await click('#facetsSpectrums', true);
  await sleep(300); await waitPage('facets');
  const spec = await call(function () { var d = document.getElementById('gv').contentDocument; return d.getElementById('facetsSpectrums').checked; });
  await call(function (n) { window.PrismShell.setFacetsSpectrums(false); window.PrismShell.setFacetsWindow(n); }, before);
  await waitPage('facets');
  check('controls', 'New Facets: the 7d preset and the Spectrums toggle re-render the page in place', ok && facetsOk && spec === true, st);
  // Variant Matrix: filter, open a matrix, previews render, close
  ok = await go('variants');
  await click('#vmSearch', true); await type('gauge');
  const vmCards = await waitFor(function () { var d = document.getElementById('gv').contentDocument; return d.querySelectorAll('[data-act="matrix"]').length; });
  await click('[data-act="matrix"]', true);
  const vm = await waitFor(function () { var d = document.getElementById('gv').contentDocument, m = d.getElementById('vmModal'); return m.classList.contains('open') && d.querySelectorAll('#vmMatrix iframe').length; }, null, 6000);
  await click('#vmModalClose', true); await sleep(150);
  const vmClosed = await call(function () { return !document.getElementById('gv').contentDocument.getElementById('vmModal').classList.contains('open'); });
  check('controls', 'Variant Matrix: filtering, opening a component matrix with live previews, closing', ok && vmCards > 0 && vm > 0 && vmClosed, { cards: vmCards, previews: vm, closed: vmClosed });
  // Showcase: the readout follows a shell switch
  ok = await go('showcase');
  await setTheme('fluent-light');
  const sc = await waitFor(function () { var d = document.getElementById('gv').contentDocument, n = d.getElementById('scActiveName'); return n && /Fluent/.test(n.textContent) && n.textContent; });
  await setTheme('cloudscape-dark');
  check('controls', 'Showcase: the "You\'re previewing" readout follows the theme', ok && !!sc, sc);
  // Collections: create, rename, delete through the page
  ok = await go('collections');
  const c0 = await call(function () { return window.PrismCollections.count(); });
  await click('#clNew', true) || await click('#clEmptyNew', true);
  await waitFor(function () { return !!document.getElementById('gv').contentDocument.getElementById('clfName'); });
  await click('#clfName', true); await type('Gate kit');
  await click('#clfCreate', true);
  const made = await waitFor(function () { return window.PrismCollections.list().filter(function (c) { return c.name === 'Gate kit'; })[0]; });
  await click('#clEdit', true);
  await call(function () { var i = document.getElementById('gv').contentDocument.getElementById('cleName'); i.focus(); i.select(); });
  await type('Gate kit 2');
  await click('#cleSave', true);
  const renamed = await waitFor(function () { return window.PrismCollections.list().some(function (c) { return c.name === 'Gate kit 2'; }); });
  await click('#clDelete', true);
  const gone = await waitFor(function (n) { return window.PrismCollections.count() === n; }, c0);
  const badge = await call(function () { var b = document.querySelector('.sr-collections .sr-cc'); return b ? b.textContent : ''; });
  check('controls', 'Collections: create, rename and delete through the page; the rail badge follows', ok && !!made && !!renamed && !!gone && badge === (c0 ? String(c0) : ''), { made: !!made, renamed, gone, badge });
  // Idea: run the code editor preview, then calibrate a pasted facet
  ok = await go('idea');
  await call(function () { document.getElementById('gv').contentDocument.getElementById('codeEditor').value = '<div class="gk">Gate</div><style>.gk{color:var(--accent)}</style>'; });
  await click('button.primary', true);
  const ran = await waitFor(function () { var d = document.getElementById('gv').contentDocument, f = d.getElementById('previewFrame'), fd = f && f.contentDocument; return fd && fd.body && fd.body.querySelectorAll('.gk').length; });
  await call(function () { var w = document.getElementById('gv').contentWindow; w.switchTab('calibrate'); var t = w.document.getElementById('calInput'); t.value = '<div class="gk" style="--gk-size:40px;width:var(--gk-size);height:var(--gk-size);background:var(--accent)"></div><style>.gk{border-radius:8px}</style>'; });
  await call(function () { document.getElementById('gv').contentWindow.calBuild(); });
  const cal = await waitFor(function () { var d = document.getElementById('gv').contentDocument, c = d.getElementById('calControls'); return c && c.children.length; });
  check('controls', 'Idea: Run renders the preview, Calibrate builds controls for a pasted facet', ok && ran > 0 && cal > 0, { ran, cal });
  // What's new: a modal dialog takes focus, keeps Tab inside, Escape returns focus
  await go('charts');
  await call(function () { document.getElementById('srWhatsNew').focus(); });
  await key('Enter'); await sleep(150);
  const rv = await call(function () { var m = document.getElementById('prReveal'); return { open: m.classList.contains('open'), inside: m.contains(document.activeElement) }; });
  const trapped = [];
  for (let i = 0; i < 4; i++) { await key('Tab'); trapped.push(await call(function () { return document.getElementById('prReveal').contains(document.activeElement); })); }
  await key('Escape');
  const rv2 = await call(function () { var m = document.getElementById('prReveal'); return { open: m.classList.contains('open'), focus: document.activeElement && document.activeElement.id }; });
  check('a11y', 'What\'s new: focus moves into the dialog, Tab stays inside, Escape closes and returns focus', rv.open && rv.inside && trapped.every(Boolean) && !rv2.open && rv2.focus === 'srWhatsNew', { rv, trapped, rv2 });
  // mobile: the rail toggle reports its state, the closed rail is out of the Tab order, a link routes and closes it
  await viewport(390); await sleep(300);
  tabs = await walkTabStops(40);
  check('a11y', 'every shell Tab stop at 390 is visible (closed rail and quick search skipped; ' + tabs.count + ' stops)', !tabs.hidden.length && tabs.count > 3, tabs.hidden.slice(0, 6));
  await click('.sr-toggle'); await sleep(300);
  st = await call(function () { var r = document.querySelector('.prism-rail').getBoundingClientRect(); return { open: document.body.classList.contains('sr-open'), exp: document.querySelector('.sr-toggle').getAttribute('aria-expanded'), left: Math.round(r.left) }; });
  const railOpen = st.open && st.exp === 'true' && st.left === 0;
  await click('.prism-rail a[data-page="notify"]');
  ok = await waitPage('notify');
  st = { before: st, after: await call(function () { return { open: document.body.classList.contains('sr-open'), exp: document.querySelector('.sr-toggle').getAttribute('aria-expanded') }; }) };
  check('controls', 'mobile: the toggle opens the rail (aria-expanded), a link routes and closes it', railOpen && ok && !st.after.open && st.after.exp === 'false', st);
  await viewport(1440);
  const evC = hard(eventsSince(n0));
  check('controls', 'no console error, exception or failed load while driving the controls', !evC.length, evC.slice(0, 8).map(e => e.phase + ' ' + e.kind + ': ' + e.text));
  const soft = events.filter(e => e.soft);
  if (soft.length && !JSON_OUT) console.log('  note browser interventions (not gated): ' + [...new Set(soft.map(e => e.text.slice(0, 90)))].join(' | '));
}

// Interrupted (Ctrl+C, a timeout, a closed pipe): still end the browser, never leave it running.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, async () => { await shutdown(); process.exit(130); });
process.stdout.on('error', () => {});
let crashed = null;
const t0 = Date.now();
try { await main(); } catch (e) { crashed = e; }
finally { await shutdown(); }
const failed = results.filter(r => !r.ok);
const secs = Math.round((Date.now() - t0) / 1000);
if (JSON_OUT) console.log(J({ ok: !crashed && !failed.length, crashed: crashed && String(crashed.stack || crashed), seconds: secs, results }, null, 2));
else {
  if (crashed) console.log('CRASH ' + (crashed.stack || crashed));
  console.log((failed.length || crashed ? 'FAIL' : 'PASS') + ': ' + (results.length - failed.length) + '/' + results.length + ' checks passed in ' + secs + 's');
}
process.exit(failed.length || crashed ? 1 : 0);
