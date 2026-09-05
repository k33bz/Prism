/* Headless browser drivers for the showcase builder — no npm deps.
   ----------------------------------------------------------------------------
   Two backends behind one tiny interface, so the recorder does not care which
   engine renders the effect:

     chrome   Chromium-family (Chrome / Chromium / Edge) over the Chrome DevTools
              Protocol (CDP): raw WebSocket JSON-RPC on --remote-debugging-port.
              Same approach as catalog/extract-from-prism.mjs.

     firefox  Firefox over WebDriver BiDi: raw WebSocket JSON-RPC on
              --remote-debugging-port (ws://localhost:<port>/session). BiDi is
              Firefox's "raw devtools" — its CDP shim was removed in Firefox 129,
              and the legacy Remote Debugging Protocol is DevTools-UI only. No
              geckodriver, no Selenium: Firefox 129+ speaks BiDi natively.

   Interface:
     const b = await launch('chrome' | 'firefox' | 'auto');
     const tab = await b.newTab();          // isolated top-level page, 560x960 viewport
     await tab.navigate(fileUrl);           // resolves after the load event
     const v = await tab.evaluate(expr);    // expr must produce a JSON-serializable value
     const png = await tab.screenshot({ x, y, width, height });   // Buffer (PNG), viewport CSS px
     b.alive();                             // false once the process or socket has gone away
     await b.close();

   Binary resolution: PRISM_CHROME / PRISM_FIREFOX env overrides, else well-known
   per-OS install paths. Both drivers force prefers-reduced-motion: no-preference
   and prefers-color-scheme: dark so every recording matches Prism's default look. */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync, openSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { resolveChrome } from '../catalog/_chrome.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- Firefox binary resolver (mirrors catalog/_chrome.mjs) -------------------
export function resolveFirefox() {
  const override = process.env.PRISM_FIREFOX;
  if (override) return override;
  const os = platform();
  let list;
  if (os === 'win32') {
    const roots = [process.env['PROGRAMFILES'] || 'C:/Program Files', process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)',
      process.env['LOCALAPPDATA'] || (process.env['USERPROFILE'] || 'C:/Users/Default') + '/AppData/Local'].map(r => r.replace(/\\/g, '/'));
    list = roots.flatMap(r => [r + '/Mozilla Firefox/firefox.exe', r + '/Firefox Developer Edition/firefox.exe', r + '/Firefox Nightly/firefox.exe']);
  } else if (os === 'darwin') {
    list = ['/Applications/Firefox.app/Contents/MacOS/firefox', '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox', '/Applications/Firefox Nightly.app/Contents/MacOS/firefox'];
  } else {
    list = ['/usr/bin/firefox', '/usr/bin/firefox-esr', '/usr/lib/firefox/firefox', '/snap/bin/firefox', '/usr/local/bin/firefox'];
  }
  const found = list.find(p => existsSync(p));
  if (found) return found;
  throw new Error('No Firefox binary found. Set PRISM_FIREFOX to your firefox executable.\nLocations checked:\n  ' + list.join('\n  '));
}

// ---- shared JSON-RPC-over-WebSocket plumbing --------------------------------
const CMD_TIMEOUT_MS = 30000;
class Rpc {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); this.dead = false;
    const die = why => { if (this.dead) return; this.dead = true; for (const [, p] of this.pending) p.rej(new Error('browser connection ' + why)); this.pending.clear(); };
    ws.onclose = () => die('closed'); ws.onerror = () => die('errored');
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        // CDP errors: {error:{message}}. BiDi errors: {type:'error', error, message}.
        if (m.error) p.rej(new Error(typeof m.error === 'string' ? `${m.error}: ${m.message}` : m.error.message));
        else p.res(m.result);
        return;
      }
      if (m.method) { const key = (m.sessionId || '') + ':' + m.method; for (const h of this.handlers.get(key) || []) h(m.params); }
    };
  }
  send(method, params = {}, sessionId) {
    if (this.dead) return Promise.reject(new Error('browser connection closed'));
    const id = ++this.id;
    this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { if (this.pending.delete(id)) rej(new Error('browser command timeout: ' + method)); }, CMD_TIMEOUT_MS);
      this.pending.set(id, { res: v => { clearTimeout(timer); res(v); }, rej: e => { clearTimeout(timer); rej(e); } });
    });
  }
  on(method, sessionId, fn) { const k = (sessionId || '') + ':' + method; if (!this.handlers.has(k)) this.handlers.set(k, []); this.handlers.get(k).push(fn); }
  off(method, sessionId, fn) { const k = (sessionId || '') + ':' + method; const a = this.handlers.get(k) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
}

async function connectWs(url, timeoutMs = 30000) {
  const t0 = Date.now();
  let lastErr;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const ws = new WebSocket(url);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('connect failed')); ws.onclose = () => rej(new Error('closed')); });
      ws.onerror = null; ws.onclose = null;
      return ws;
    } catch (e) { lastErr = e; await sleep(200); }
  }
  throw new Error('could not connect to ' + url + ' (' + (lastErr && lastErr.message) + ')');
}

const VIEWPORT = { width: 560, height: 960 };
// Browser stderr goes to a per-instance log in the temp dir so a crash can be diagnosed after the fact.
const logPath = (kind, port) => resolve(tmpdir(), `prism-showcase-${kind}-${port}.log`);
const logFd = (kind, port) => { try { return openSync(logPath(kind, port), 'a'); } catch { return 'ignore'; } };
// Ask the OS for a free loopback port (a fixed/random pick can collide with the
// instance that was just closed, or with anything else on the box).
const freePort = () => new Promise((res, rej) => {
  const srv = createServer(); srv.unref();
  srv.on('error', rej);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); });
});

// ---- Chromium over CDP -------------------------------------------------------
async function launchChrome() {
  const path = resolveChrome();
  const tmp = mkdtempSync(resolve(tmpdir(), 'prism-showcase-chrome-'));
  const port = await freePort();
  const proc = spawn(path, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--disable-extensions', '--mute-audio', '--allow-file-access-from-files',
    '--remote-debugging-port=' + port, '--user-data-dir=' + tmp, 'about:blank',
  ], { stdio: ['ignore', 'ignore', logFd('chrome', port)] });
  let info;
  for (let i = 0; i < 100 && !info; i++) {
    try { info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(150); }
  }
  if (!info) { proc.kill('SIGKILL'); throw new Error('Chrome did not expose DevTools on :' + port); }
  const rpc = new Rpc(await connectWs(info.webSocketDebuggerUrl));

  const newTab = async () => {
    // Own window per worker: background *tabs* get their animations throttled, which
    // silently freezes recordings; separate windows are all treated as visible.
    const { targetId } = await rpc.send('Target.createTarget', { url: 'about:blank', newWindow: true });
    const { sessionId } = await rpc.send('Target.attachToTarget', { targetId, flatten: true });
    await rpc.send('Page.enable', {}, sessionId);
    await rpc.send('Runtime.enable', {}, sessionId);
    await rpc.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 1, mobile: false }, sessionId);
    await rpc.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }, { name: 'prefers-color-scheme', value: 'dark' }] }, sessionId);
    return {
      async navigate(url) {
        let done; const loaded = new Promise(r => { done = r; });
        rpc.on('Page.loadEventFired', sessionId, done);
        try { await rpc.send('Page.navigate', { url }, sessionId); await Promise.race([loaded, sleep(4000)]); }
        finally { rpc.off('Page.loadEventFired', sessionId, done); }
      },
      async evaluate(expression) {
        const r = await rpc.send('Runtime.evaluate', { expression: `JSON.stringify((${expression}))`, returnByValue: true }, sessionId);
        if (r.exceptionDetails) throw new Error('evaluate: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
        return JSON.parse(r.result.value);
      },
      async screenshot(clip) {
        const r = await rpc.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: false }, sessionId);
        return Buffer.from(r.data, 'base64');
      },
      async close() { try { await rpc.send('Target.closeTarget', { targetId }); } catch {} },
    };
  };
  const close = async () => { try { rpc.ws.close(); } catch {} try { proc.kill('SIGKILL'); } catch {} await sleep(300); try { rmSync(tmp, { recursive: true, force: true }); } catch {} };
  const alive = () => !rpc.dead && proc.exitCode === null;
  return { name: 'chrome', engine: 'Chromium (CDP)', path, version: info.Browser || '', newTab, close, alive, log: logPath('chrome', port) };
}

// ---- Firefox over WebDriver BiDi --------------------------------------------
const FIREFOX_PREFS = {
  // quiet first-run / telemetry / update chrome
  'browser.shell.checkDefaultBrowser': false, 'datareporting.policy.dataSubmissionEnabled': false,
  'toolkit.telemetry.reportingpolicy.firstRun': false, 'browser.startup.homepage_override.mstone': 'ignore',
  'app.update.enabled': false, 'browser.sessionstore.resume_from_crash': false, 'browser.tabs.warnOnClose': false,
  'remote.log.level': 'Warn',
  // rendering parity with the Chrome driver: motion on, dark scheme, 1x scale
  'ui.prefersReducedMotion': 0, 'layout.css.prefers-color-scheme.content-override': 0, 'layout.css.devPixelsPerPx': '1.0',
  'layout.css.prefers-reduced-motion.enabled': true, 'browser.display.use_system_colors': false,
  // no local-file sandboxing surprises for file:// samples
  'security.fileuri.strict_origin_policy': false,
};

async function launchFirefox() {
  const path = resolveFirefox();
  const profile = mkdtempSync(resolve(tmpdir(), 'prism-showcase-firefox-'));
  writeFileSync(resolve(profile, 'user.js'), Object.entries(FIREFOX_PREFS).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n') + '\n');
  const port = await freePort();
  const proc = spawn(path, ['-headless', '-no-remote', '-profile', profile, '--remote-debugging-port', String(port), 'about:blank'],
    { stdio: ['ignore', 'ignore', logFd('firefox', port)], env: { ...process.env, MOZ_CRASHREPORTER_DISABLE: '1', MOZ_CRASHREPORTER_NO_REPORT: '1' } });
  // Firefox has no /json/version discovery endpoint; the BiDi session socket is fixed.
  let rpc, hello;
  try {
    rpc = new Rpc(await connectWs(`ws://localhost:${port}/session`));
    hello = await rpc.send('session.new', { capabilities: {} });
  } catch (e) {
    try { proc.kill('SIGKILL'); } catch {}
    await sleep(300);
    let tail = '';
    try { tail = readFileSync(logPath('firefox', port), 'utf8').split(/\r?\n/).filter(l => l && !/shell_windows|GFX1|occlusion|headless mode|glean|crashreporter/.test(l)).slice(-6).join(' | '); } catch {}
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
    throw new Error('Firefox launch failed on :' + port + ' (' + e.message + ')' + (tail ? ' — log: ' + tail : ''));
  }
  const version = String(hello.capabilities.browserVersion || "");
  const tree = await rpc.send('browsingContext.getTree', {});
  let spare = tree.contexts.map(c => c.context); // reuse the initial blank tab first

  const newTab = async () => {
    // Own window per worker (not a tab): Firefox throttles CSS animations and rAF in
    // background tabs, which silently freezes recordings on parallel workers.
    const context = spare.length ? spare.shift() : (await rpc.send('browsingContext.create', { type: 'window' })).context;
    await rpc.send('browsingContext.setViewport', { context, viewport: VIEWPORT, devicePixelRatio: 1 });
    return {
      async navigate(url) { await rpc.send('browsingContext.navigate', { context, url, wait: 'complete' }); },
      async evaluate(expression) {
        const r = await rpc.send('script.evaluate', { expression: `JSON.stringify((${expression}))`, target: { context }, awaitPromise: false, resultOwnership: 'none' });
        if (r.type === 'exception') throw new Error('evaluate: ' + (r.exceptionDetails && r.exceptionDetails.text));
        return JSON.parse(r.result.value);
      },
      async screenshot(clip) {
        const r = await rpc.send('browsingContext.captureScreenshot', { context, origin: 'viewport', format: { type: 'image/png' }, clip: { type: 'box', ...clip } });
        return Buffer.from(r.data, 'base64');
      },
      async close() { try { await rpc.send('browsingContext.close', { context }); } catch {} },
    };
  };
  const close = async () => {
    if (!rpc.dead) { try { await Promise.race([rpc.send('browser.close', {}), sleep(3000)]); } catch {} }
    try { rpc.ws.close(); } catch {} await sleep(300); try { proc.kill('SIGKILL'); } catch {} await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  };
  const alive = () => !rpc.dead && proc.exitCode === null;
  return { name: 'firefox', engine: 'Firefox (WebDriver BiDi)', path, version, newTab, close, alive, log: logPath('firefox', port) };
}

// ---- entry ------------------------------------------------------------------
export async function launch(kind = 'auto') {
  if (kind === 'chrome') return launchChrome();
  if (kind === 'firefox') {
    // Firefox 155 occasionally never answers session.new on a fresh profile; one
    // retry with a new profile and port clears it far more often than not.
    try { return await launchFirefox(); }
    catch (e) { if (!/session\.new|connect/.test(e.message)) throw e; await sleep(1500); return launchFirefox(); }
  }
  if (kind !== 'auto') throw new Error('unknown browser: ' + kind + ' (chrome | firefox | auto)');
  try { return await launchFirefox(); } catch (e) { const ff = e.message.split('\n')[0]; try { return await launchChrome(); } catch (e2) { throw new Error(ff + '\n' + e2.message); } }
}
