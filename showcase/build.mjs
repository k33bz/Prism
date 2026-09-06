/* Prism GIF showcase builder (headless browser + ffmpeg, no npm deps).
   ----------------------------------------------------------------------------
   For every effect in the #prism-catalog island this script:
     1. writes a standalone, offline HTML sample  -> showcase/html/<id>.html
     2. records the animated stage in a headless browser and encodes a looping
        GIF with ffmpeg                            -> showcase/gif/<id>.gif
     3. records what it produced                   -> showcase/manifest.json
   and then renders the browsable docs from that manifest:
        showcase/README.md, showcase/galleries/*.md, showcase/index.html

   Usage (from the repo root):
     node showcase/build.mjs                 # capture everything that is missing, then docs
     node showcase/build.mjs capture         # capture only
     node showcase/build.mjs docs            # regenerate docs from manifest.json only
   Options:
     --browser <firefox|chrome|auto>  rendering engine (default auto: Firefox, else Chromium)
     --gallery <id[,id]>   restrict to galleries (charts, fx, lab, ai, objects, ...)
     --only <id[,id]>      restrict to specific effect ids
     --limit <n>           stop after n effects (smoke runs)
     --workers <n>         parallel browser tabs (default 3)
     --force               re-record GIFs that already exist
     --html-only           write HTML samples, skip recording

   Requirements: Node 18+, Firefox 129+ or a Chromium-family browser (see
   showcase/browsers.mjs; override with PRISM_FIREFOX / PRISM_CHROME), and
   ffmpeg on PATH (override with PRISM_FFMPEG). */
import { spawn, spawnSync } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { launch } from './browsers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PRISM = process.env.PRISM_HTML || resolve(ROOT, 'Prism.html');
const HTML_DIR = resolve(HERE, 'html');
const GIF_DIR = resolve(HERE, 'gif');
const GAL_DIR = resolve(HERE, 'galleries');
const MANIFEST = resolve(HERE, 'manifest.json');
const FFMPEG = process.env.PRISM_FFMPEG || 'ffmpeg';

// ---- recording parameters ---------------------------------------------------
const STAGE_W = 344;          // inner stage width in the sample (matches a Prism tile)
const FPS = 10;
const MIN_DUR = 1.6, MAX_DUR = 4.0;   // seconds of animation captured per GIF
const MAX_H = 600;            // tallest GIF we will emit
const PAD_Y = 12;             // vertical breathing room around the measured content
const COLORS = 128;

// ---- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'all';
const RAW_ARGS = argv.slice();          // everything after the command, for the supervisor to re-spawn
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const flag = name => argv.includes(name);
const BROWSER = opt('--browser', 'auto');
const ONLY_GALLERY = opt('--gallery', '') ? opt('--gallery').split(',') : null;
const ONLY_IDS = opt('--only', '') ? opt('--only').split(',') : null;
const LIMIT = parseInt(opt('--limit', '0'), 10) || 0;
const WORKERS = Math.max(1, parseInt(opt('--workers', '3'), 10) || 3);
const FORCE = flag('--force');
const HTML_ONLY = flag('--html-only');
const CHILD = flag('--child');          // internal: this process is a supervised capture worker
const EXIT_BROWSER_LOST = 3;

// ---- catalog ----------------------------------------------------------------
function loadCatalog() {
  const html = readFileSync(PRISM, 'utf8');
  const open = html.indexOf('<script type="application/json" id="prism-catalog">');
  if (open < 0) throw new Error('no #prism-catalog island in ' + PRISM);
  const start = html.indexOf('>', open) + 1;
  const end = html.indexOf('</script>', start);
  return JSON.parse(html.slice(start, end));
}
const catalog = loadCatalog();
const galleryTitle = Object.fromEntries((catalog.galleries || []).map(g => [g.id, g.title]));
const tokensCss = (catalog.tokens && catalog.tokens.css) || '';

const SPECTRUM_TITLES = {
  'material-ui': 'Material UI', 'cyberpunk-os': 'Cyberpunk OS', neumorphism: 'Neumorphism',
  glassmorphism: 'Glassmorphism', 'brutalist-web': 'Brutalist Web', 'skeuo-hardware': 'Skeuomorphic Hardware',
  'retro-terminal': 'Retro Terminal', 'art-deco': 'Art Deco', solarpunk: 'Solarpunk', duolingo: 'Duolingo',
  mailchimp: 'Mailchimp', stackoverflow: 'Stack Overflow', monzo: 'Monzo', heroku: 'Heroku', polaris: 'Shopify Polaris',
  primer: 'GitHub Primer', antd: 'Ant Design', acorn: 'Acorn', material3: 'Material 3',
};
const spectrumTitle = s => SPECTRUM_TITLES[s] || s;

// ---- per-effect derived facts -----------------------------------------------
const TIME_WIDGETS_JS = `
/* live time-based widgets (countdown ring, MM:SS, stopwatch) - from Prism.html */
(function(){
  function tick(){
    var now=Date.now();
    document.querySelectorAll('[data-countdown]').forEach(function(el){
      var total=parseInt(el.getAttribute('data-countdown'),10)||8;
      el.textContent=total-Math.floor(now/1000)%total;
    });
    document.querySelectorAll('[data-timer="mmss"]').forEach(function(el){
      var from=parseInt(el.getAttribute('data-from'),10)||90;
      var rem=from-Math.floor(now/1000)%(from+1);
      var m=Math.floor(rem/60),s=rem%60;
      el.textContent=String(m).padStart(2,'0');
      var secEl=el.parentNode.querySelector('[data-timer-sec]');
      if(secEl)secEl.textContent=String(s).padStart(2,'0');
    });
    document.querySelectorAll('[data-stopwatch]').forEach(function(el){
      var t=(now/100)%6000;
      var m=Math.floor(t/600),s=Math.floor(t/10)%60,d=Math.floor(t)%10;
      el.textContent=String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+'.'+d;
    });
    requestAnimationFrame(tick);
  }
  tick();
})();`;

function isAnimated(e) {
  return !!e.needsJs || /animation|transition/.test(e.css || '') || /animation/.test(e.html || '');
}

// Longest time value mentioned by any animation / transition declaration.
function animDuration(e) {
  let max = 0;
  const src = (e.css || '') + '\n' + (e.html || '');
  for (const m of src.matchAll(/(?:animation|transition)(?:-duration)?\s*:\s*([^;}"]+)/g)) {
    for (const t of m[1].matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)) {
      const v = t[2] === 'ms' ? parseFloat(t[1]) / 1000 : parseFloat(t[1]);
      if (v > max) max = v;
    }
  }
  if (!max) return MIN_DUR;
  return Math.min(MAX_DUR, Math.max(MIN_DUR, max));
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SAMPLE_INITS = catalog.initializers || {};   // initializer sources shipped in the catalog island
function sampleHtml(e) {
  const gal = galleryTitle[e.gallery] || e.gallery;
  const fam = e.spectrum ? ` · ${esc(spectrumTitle(e.spectrum))}` : '';
  const bg = e.usableAsBackground ? ' bg' : '';
  // Initializer: the bundled time-widgets shim, or the initializer the catalog ships for this
  // key (catalog.initializers[<needsJs>].js, declared on the page with data-prism-init).
  const init = e.needsJs && SAMPLE_INITS[e.needsJs];
  const js = e.needsJs === 'time-widgets' ? `<script>${TIME_WIDGETS_JS}</script>` : (init && init.js ? `<script>
${init.js}
</script>` : '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(e.name)} · Prism</title>
<!-- Prism showcase sample: ${esc(e.id)} (gallery: ${esc(e.gallery)}). Offline, self-contained. -->
<style id="prism-tokens">
${tokensCss}
</style>
<style id="showcase-shell">
html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
body{min-height:100vh;box-sizing:border-box;padding:28px 20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:8px}
.stage{position:relative;overflow:hidden;box-sizing:border-box;width:${STAGE_W}px;min-height:120px;padding:24px 16px;display:flex;align-items:center;justify-content:center;background:var(--panel)}
.stage.bg{padding:0;min-height:0;display:block}
.stage.bg>*{width:100%}
.meta{max-width:${STAGE_W + 18}px;text-align:center;font-size:12px;color:var(--muted)}
.meta b{color:var(--ink);font-size:13px}
.meta code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:var(--info)}
.meta p{margin:6px 0 0}
</style>
<style id="effect-css">
${e.css || ''}
</style>
</head>
<body>
<div class="tile"><div class="stage${bg}" id="stage">${e.html || ''}</div></div>
<div class="meta"><b>${esc(e.name)}</b> · <code>${esc(e.id)}</code><br>${esc(gal)}${fam}${e.category ? ' · ' + esc(e.category) : ''}${e.description ? `<p>${esc(e.description)}</p>` : ''}</div>
${js}
</body>
</html>
`;
}

// ---- recording --------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MEASURE = `(() => {
  const s = document.getElementById('stage'); const sr = s.getBoundingClientRect();
  let top = Infinity, bottom = -Infinity;
  for (const el of s.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue; top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom); }
  if (!isFinite(top)) { top = sr.top; bottom = sr.bottom; }
  return { sx: sr.left, sy: sr.top, sw: sr.width, sh: sr.height, top, bottom };
})()`;

const RESTART = `(() => { let n = 0; for (const a of document.getAnimations()) { try { a.currentTime = 0; if (a.playState !== 'running') a.play(); n++; } catch {} } return n; })()`;

function encodeGif(frames, fps, out) {
  return new Promise((res, rej) => {
    const vf = `split[a][b];[a]palettegen=max_colors=${COLORS}:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
    const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0', '-vf', vf, '-loop', '0', out], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    const timer = setTimeout(() => { err += ' (timeout)'; try { ff.kill('SIGKILL'); } catch {} }, 60000);
    ff.stderr.on('data', d => { err += d; });
    ff.on('error', e => { clearTimeout(timer); rej(e); });
    ff.on('close', code => { clearTimeout(timer); code === 0 ? res() : rej(new Error('ffmpeg exit ' + code + ': ' + err.trim())); });
    ff.stdin.on('error', () => {});
    for (const f of frames) ff.stdin.write(f);
    ff.stdin.end();
  });
}

async function recordEffect(tab, e, htmlPath, gifPath) {
  await tab.navigate(pathToFileURL(htmlPath).href);
  await sleep(220);
  const animated = isAnimated(e);
  // Measure the content box a few times so motion that starts off-origin is still framed.
  let top = Infinity, bottom = -Infinity, box;
  const samples = animated ? 3 : 1;
  for (let i = 0; i < samples; i++) {
    box = await tab.evaluate(MEASURE);
    top = Math.min(top, box.top); bottom = Math.max(bottom, box.bottom);
    if (i < samples - 1) await sleep(140);
  }
  const x = Math.round(box.sx), w = Math.round(box.sw);
  let y0 = Math.max(box.sy, Math.floor(top - PAD_Y));
  let y1 = Math.min(box.sy + box.sh, Math.ceil(bottom + PAD_Y));
  if (y1 - y0 < 90) { const c = (y0 + y1) / 2; y0 = Math.max(box.sy, Math.floor(c - 45)); y1 = Math.min(box.sy + box.sh, y0 + 90); }
  if (y1 - y0 > MAX_H) y1 = y0 + MAX_H;
  const clip = { x, y: Math.round(y0), width: w, height: Math.round(y1 - y0) };

  const dur = animated ? animDuration(e) : 0;
  const n = animated ? Math.round(dur * FPS) : 1;
  const interval = 1000 / FPS;
  const frames = []; let late = 0;
  // Restart every CSS animation from t=0 (what Prism's ▶ replay button does) so
  // one-shot entrances are recorded from their first frame, not mid-flight.
  if (animated) await tab.evaluate(RESTART);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const target = t0 + i * interval;
    const now = performance.now();
    if (target > now) await sleep(target - now); else if (i) late++;
    frames.push(await tab.screenshot(clip));
  }
  await encodeGif(frames, FPS, gifPath);
  return { animated, duration: animated ? +dur.toFixed(2) : 0, frames: n, width: clip.width, height: clip.height, late };
}

// ---- capture driver ---------------------------------------------------------
function selectEffects() {
  let list = catalog.effects.slice();
  if (ONLY_GALLERY) list = list.filter(e => ONLY_GALLERY.includes(e.gallery));
  if (ONLY_IDS) list = list.filter(e => ONLY_IDS.includes(e.id));
  if (LIMIT) list = list.slice(0, LIMIT);
  return list;
}

function readManifest() {
  if (!existsSync(MANIFEST)) return { effects: {}, browser: null };
  try { const m = JSON.parse(readFileSync(MANIFEST, 'utf8')); return { effects: Object.fromEntries((m.effects || []).map(x => [x.id, x])), browser: m.browser || null }; }
  catch { return { effects: {}, browser: null }; }
}

function writeManifest(records, browser) {
  const effects = catalog.effects.map(e => records[e.id]).filter(Boolean);
  const bytes = effects.reduce((a, r) => a + (r.bytes || 0), 0);
  const out = {
    name: 'Prism GIF showcase', generated: new Date().toISOString(), source: relative(ROOT, PRISM).replace(/\\/g, '/'),
    browser: browser || null,
    count: effects.length, animated: effects.filter(r => r.animated).length, gifBytes: bytes,
    settings: { fps: FPS, minSeconds: MIN_DUR, maxSeconds: MAX_DUR, colors: COLORS, stageWidth: STAGE_W },
    effects,
  };
  writeFileSync(MANIFEST, JSON.stringify(out, null, 1));
  return out;
}

async function capture() {
  mkdirSync(HTML_DIR, { recursive: true }); mkdirSync(GIF_DIR, { recursive: true });
  const list = selectEffects();
  const prev = readManifest();
  const records = prev.effects;
  let browserInfo = prev.browser;
  console.log(`catalog: ${catalog.effects.length} effects · selected ${list.length} · workers ${WORKERS}`);

  // 1) HTML samples are cheap and deterministic: always (re)write them.
  for (const e of list) writeFileSync(resolve(HTML_DIR, e.id + '.html'), sampleHtml(e));
  console.log(`wrote ${list.length} HTML samples -> ${relative(ROOT, HTML_DIR)}`);
  if (HTML_ONLY) { writeManifest(records, browserInfo); return; }

  const check = spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' });
  if (check.error || check.status !== 0) throw new Error('ffmpeg not found (set PRISM_FFMPEG or add it to PATH)');

  const todo = list.filter(e => FORCE || !existsSync(resolve(GIF_DIR, e.id + '.gif')) || !records[e.id]);
  const skipped = list.length - todo.length;
  console.log(`recording ${todo.length} GIFs (${skipped} already present)`);
  if (!todo.length) { writeManifest(records, browserInfo); return; }

  let browser = await launch(BROWSER);
  browserInfo = { engine: browser.engine, version: browser.version };
  console.log(`browser: ${browser.engine} ${browser.version} — ${browser.path}`);
  console.log(`browser stderr -> ${browser.log}`);
  // A crashed or hung browser is relaunched once for everyone (workers pass the
  // instance they gave up on, so only the first one triggers it); each worker then
  // re-opens its tab and retries the effect it was on. Firefox also gets recycled
  // proactively every RECYCLE_EVERY effects: long headless sessions with many
  // navigations were observed to crash after a few hundred pages.
  const RECYCLE_EVERY = parseInt(process.env.PRISM_RECYCLE || '150', 10) || 150;
  let relaunching = null, relaunches = 0, recycleAt = RECYCLE_EVERY;
  const getBrowser = async (stale, why) => {
    if (!stale && browser.alive()) return browser;
    if (stale && stale !== browser) return browser;             // someone already replaced it
    if (!relaunching) relaunching = (async () => {
      try {
        try { await browser.close(); } catch {}
        let lastErr;
        for (let i = 0; i < 3; i++) {
          try { browser = await launch(BROWSER); lastErr = null; break; }
          catch (e) { lastErr = e; console.log(`  relaunch attempt ${i + 1} failed: ${e.message}`); await sleep(1500); }
        }
        if (lastErr) {
          // A browser that cannot be relaunched from this process (seen after a real
          // Firefox crash: every new instance died at startup, while a fresh Node
          // process could launch it fine) is handed back to the supervisor, which
          // restarts the worker; everything recorded so far is on disk and skipped.
          writeManifest(records, browserInfo);
          console.log(`  browser could not be relaunched (${lastErr.message.split(' — ')[0]}) — restarting the capture worker`);
          process.exit(EXIT_BROWSER_LOST);
        }
        relaunches++;
        console.log(`  browser ${why || 'died'} — relaunched (${relaunches}x)`);
      } finally { relaunching = null; }
    })();
    await relaunching;
    return browser;
  };
  const started = performance.now();
  let next = 0, done = 0, failed = 0, lateTotal = 0;
  const failures = [];
  const worker = async () => {
    let owner = await getBrowser(), tab = await owner.newTab();
    while (next < todo.length) {
      const e = todo[next++];
      const htmlPath = resolve(HTML_DIR, e.id + '.html');
      const gifPath = resolve(GIF_DIR, e.id + '.gif');
      let lastErr = null;
      if (done >= recycleAt) { recycleAt += RECYCLE_EVERY; try { await getBrowser(browser, `recycled after ${done} effects`); } catch (e) { console.log('  recycle failed: ' + e.message); } }
      for (let attempt = 0, connErrors = 0; attempt < 3 && connErrors < 4; attempt++) {
        try {
          if (owner !== browser || !owner.alive()) { owner = await getBrowser(); tab = await owner.newTab(); }
          const r = await recordEffect(tab, e, htmlPath, gifPath);
          lateTotal += r.late; lastErr = null;
          records[e.id] = { id: e.id, name: e.name, gallery: e.gallery, category: e.category || '', spectrum: e.spectrum || null,
            gif: `gif/${e.id}.gif`, html: `html/${e.id}.html`, animated: r.animated, duration: r.duration, frames: r.frames,
            width: r.width, height: r.height, bytes: statSync(gifPath).size };
          break;
        } catch (err) {
          lastErr = err;
          const connection = /browser connection|browser command timeout|launch failed/.test(err.message) || !owner.alive();
          if (!connection && attempt === 0) continue;          // plain effect error: one quiet retry on the same tab
          if (connection) {                                     // browser trouble: does not count against the effect
            connErrors++; attempt--;
            try { await sleep(500); owner = await getBrowser(owner, owner.alive() ? 'hung' : 'died'); tab = await owner.newTab(); } catch (e2) { lastErr = e2; }
            continue;
          }
          if (attempt === 2) break;
        }
      }
      if (lastErr) { failed++; failures.push(e.id + ': ' + lastErr.message); try { rmSync(gifPath, { force: true }); } catch {} }
      done++;
      if (done % 25 === 0 || done === todo.length) {
        const el = (performance.now() - started) / 1000;
        console.log(`  ${done}/${todo.length}  ${(el / 60).toFixed(1)} min  eta ${((el / done) * (todo.length - done) / 60).toFixed(1)} min  failed ${failed}  late frames ${lateTotal}`);
        writeManifest(records, browserInfo);
      }
    }
    try { await tab.close(); } catch {}
  };
  try { await Promise.all(Array.from({ length: Math.min(WORKERS, todo.length) }, worker)); }
  finally { try { await browser.close(); } catch {} }
  const m = writeManifest(records, browserInfo);
  console.log(`done: ${m.count} effects in manifest · ${(m.gifBytes / 1048576).toFixed(1)} MB of GIF · ${failed} failed · ${relaunches} browser relaunches · ${((performance.now() - started) / 60000).toFixed(1)} min`);
  if (failures.length) console.log('failures:\n  ' + failures.join('\n  '));
}

// ---- docs -------------------------------------------------------------------
const fmtKB = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
const cell = (r, up) => `<a href="${up}${r.html}"><img src="${up}${r.gif}" width="300" alt="${esc(r.name)}"></a><br><b>${esc(r.name)}</b><br><sub><code>${r.id}</code>${r.animated ? '' : ' · static'}</sub>`;

function grid(rows, up, cols = 3) {
  const out = ['<table>'];
  for (let i = 0; i < rows.length; i += cols) {
    const chunk = rows.slice(i, i + cols);
    out.push('<tr>' + chunk.map(r => `<td align="center" valign="top" width="33%">${cell(r, up)}</td>`).join('') + '</tr>');
  }
  out.push('</table>');
  return out.join('\n');
}

function galleryPage(title, intro, rows, up, groupBy) {
  const groups = new Map();
  for (const r of rows) { const k = groupBy(r) || 'Other'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const parts = [`# ${title}`, '', intro, '',
    `**${rows.length} effects** · ${rows.filter(r => r.animated).length} animated · ${fmtKB(rows.reduce((a, r) => a + r.bytes, 0))} of GIF · click any GIF to open its standalone HTML sample (raw file; open it locally, GitHub shows source).`, '',
    '[← Showcase index](../README.md)', ''];
  if (groups.size > 1) { parts.push('**Sections:** ' + [...groups.keys()].map(k => `[${k}](#${k.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')})`).join(' · '), ''); }
  for (const [k, list] of groups) { if (groups.size > 1) parts.push(`## ${k}`, ''); parts.push(grid(list, up), ''); }
  return parts.join('\n');
}

const HERO = { // hand-picked representative per gallery; falls back to the first animated effect
  charts: 'charts-gauge-cluster', fx: 'fx-pulse-glow-winner', lab: 'lab-countdown-ring', ai: 'ai-thinking-orb', objects: 'objects-snowfall',
  input: 'input-like-heart-burst', text: 'text-neon-sign', shapes: 'shapes-ring-spin', maps: 'maps-world-pulse-map',
  notify: 'notify-stacking-toast-group', arch: 'arch-flowing-connector', callouts: 'callouts-progress-stepper', obsidian: 'obsidian-knowledge-constellation',
  menus: 'menus-compact-cmd-k-palette', spectrums: 'spectrums-filled-ripple-button',
};
function hero(rows, gallery) {
  return rows.find(r => r.id === HERO[gallery]) || rows.find(r => r.animated && r.height <= 220) || rows.find(r => r.animated) || rows[0];
}

function docs() {
  if (!existsSync(MANIFEST)) throw new Error('no manifest.json yet - run capture first');
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const rows = m.effects;
  mkdirSync(GAL_DIR, { recursive: true });
  const byGallery = new Map();
  for (const g of catalog.galleries) byGallery.set(g.id, rows.filter(r => r.gallery === g.id));

  // Per-gallery pages (spectrums split per design-system family).
  const index = [];
  for (const g of catalog.galleries) {
    const list = byGallery.get(g.id) || [];
    if (!list.length) continue;
    if (g.id === 'spectrums') {
      const fams = [...new Set(list.map(r => r.spectrum || 'other'))];
      const famLinks = [];
      for (const f of fams) {
        const fl = list.filter(r => (r.spectrum || 'other') === f);
        const file = `spectrums-${f}.md`;
        writeFileSync(resolve(GAL_DIR, file), galleryPage(`${spectrumTitle(f)} · Spectrums`,
          `Every Prism facet authored in the **${spectrumTitle(f)}** visual language, recorded as a looping GIF.`, fl, '../', r => r.category));
        famLinks.push({ f, file, n: fl.length, hero: hero(fl, 'spectrums') });
      }
      const sp = [`# Spectrums`, '', 'Component families rendered across full visual languages. Each family has its own page.', '', '[← Showcase index](../README.md)', '', '<table>'];
      for (let i = 0; i < famLinks.length; i += 3) {
        sp.push('<tr>' + famLinks.slice(i, i + 3).map(x => `<td align="center" valign="top" width="33%"><a href="${x.file}"><img src="../${x.hero.gif}" width="300" alt="${esc(spectrumTitle(x.f))}"></a><br><b><a href="${x.file}">${esc(spectrumTitle(x.f))}</a></b><br><sub>${x.n} effects</sub></td>`).join('') + '</tr>');
      }
      sp.push('</table>', '');
      writeFileSync(resolve(GAL_DIR, 'spectrums.md'), sp.join('\n'));
      index.push({ id: g.id, title: g.title, file: 'galleries/spectrums.md', list, hero: hero(list, g.id), note: `${fams.length} design-system families` });
    } else {
      const file = `${g.id}.md`;
      writeFileSync(resolve(GAL_DIR, file), galleryPage(g.title, `Every effect in Prism's **${g.title}** gallery, recorded as a looping GIF.`, list, '../', r => r.category));
      index.push({ id: g.id, title: g.title, file: 'galleries/' + file, list, hero: hero(list, g.id), note: '' });
    }
  }

  // showcase/README.md
  const total = rows.length, anim = rows.filter(r => r.animated).length;
  const engine = m.browser ? `${m.browser.engine}${m.browser.version ? ' ' + String(m.browser.version).replace(/^firefox\s+/i, '') : ''}` : 'headless browser';
  const R = [
    '# ✦ Prism GIF showcase', '',
    `A visual index of **every facet in Prism** — ${total} effects across ${index.length} galleries, each recorded as a looping GIF from its own standalone HTML sample.`, '',
    '- **`gif/<id>.gif`** — the recording (dark theme, real browser render, looped).',
    '- **`html/<id>.html`** — a self-contained sample page: Prism tokens + the effect\'s HTML/CSS (+ its tiny JS initializer where needed). Open it locally in any browser; no network needed.',
    '- **`galleries/*.md`** — browsable pages, one per gallery, grouped by category.',
    '- **`manifest.json`** — what was recorded (size, frames, duration) so tooling can consume the suite too.', '',
    `Stats: ${anim} animated · ${total - anim} static (single-frame GIF) · ${fmtKB(m.gifBytes)} total · ${m.settings.fps} fps, ${m.settings.minSeconds}–${m.settings.maxSeconds} s per clip · rendered by ${engine} · generated ${m.generated.slice(0, 10)}.`, '',
    '> GIFs are for **display only** — they are not part of the Prism library or the MCP catalog. The authoritative, paste-ready source of every effect remains the `#prism-catalog` island in `Prism.html`.', '',
    '## Galleries', '', '<table>',
  ];
  for (let i = 0; i < index.length; i += 3) {
    R.push('<tr>' + index.slice(i, i + 3).map(x => `<td align="center" valign="top" width="33%"><a href="${x.file}"><img src="${x.hero.gif}" width="300" alt="${esc(x.title)}"></a><br><b><a href="${x.file}">${esc(x.title)}</a></b><br><sub>${x.list.length} effects${x.note ? ' · ' + x.note : ''}</sub></td>`).join('') + '</tr>');
  }
  R.push('</table>', '',
    '## Regenerating', '',
    'From the repo root (needs Node 18+, Firefox 129+ or a Chromium-family browser, and `ffmpeg` on `PATH`):', '',
    '```bash', 'node showcase/build.mjs                       # record whatever is missing, then rebuild the docs',
    'node showcase/build.mjs --force               # re-record everything',
    'node showcase/build.mjs --browser chrome      # force an engine (default auto: Firefox, else Chromium)',
    'node showcase/build.mjs docs                  # only rebuild README / gallery pages / index.html from manifest.json',
    'node showcase/build.mjs --gallery charts,fx --workers 4', '```', '',
    'The builder reads the catalog island straight out of `Prism.html`, writes one sample page per effect, drives a headless browser over its native wire protocol with no npm dependencies (Firefox via **WebDriver BiDi**, Chromium via **CDP** — see [`browsers.mjs`](browsers.mjs)), captures frames from the sample\'s stage, and encodes each clip with a per-GIF palette. Clip length is derived from the longest `animation` / `transition` duration the effect declares, clamped to the range above.', '',
    'Also see [`index.html`](index.html) — an offline, filterable browser for the whole suite.', '');
  writeFileSync(resolve(HERE, 'README.md'), R.join('\n'));

  // showcase/index.html — offline browser with embedded manifest.
  const slim = rows.map(r => ({ i: r.id, n: r.name, g: r.gallery, c: r.category, s: r.spectrum, a: r.animated ? 1 : 0, w: r.width, h: r.height }));
  const gals = index.map(x => ({ id: x.id, title: x.title, n: x.list.length }));
  writeFileSync(resolve(HERE, 'index.html'), `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prism GIF showcase</title>
<script type="application/json" id="showcase-data">${JSON.stringify({ galleries: gals, spectrums: SPECTRUM_TITLES, effects: slim }).replace(/</g, '\\u003c')}</script>
<style>
${tokensCss}
html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--panel);border-bottom:1px solid var(--line);padding:12px 18px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
header h1{font-size:16px;margin:0 12px 0 0}header h1 span{color:var(--accent)}
input[type=search]{background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:7px 10px;min-width:220px;font:inherit}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{cursor:pointer;border:1px solid var(--line);background:var(--panel2);color:var(--muted);border-radius:20px;padding:4px 10px;font-size:12px}
.chip.on{background:rgba(var(--accent-rgb),.16);border-color:var(--accent);color:var(--ink)}
.count{color:var(--muted);font-size:12px;margin-left:auto}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(${STAGE_W}px,1fr));gap:14px;padding:18px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.card img{display:block;width:100%;height:auto;background:var(--panel)}
.card .m{padding:10px 12px;font-size:12px;color:var(--muted)}.card .m b{color:var(--ink);font-size:13px;display:block}
.card .m code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:var(--info)}
.card .m a{color:var(--accent);text-decoration:none}
.tag{display:inline-block;margin-top:4px;padding:1px 7px;border-radius:10px;background:var(--panel2);font-size:10.5px}
</style></head><body>
<header><h1><span>✦</span> Prism GIF showcase</h1>
<input type="search" id="q" placeholder="Search name, id, category…" autofocus>
<div class="chips" id="chips"></div><span class="count" id="count"></span></header>
<main id="grid"></main>
<script>
(function(){
  var D=JSON.parse(document.getElementById('showcase-data').textContent);
  var gal='',q='';var chips=document.getElementById('chips'),grid=document.getElementById('grid'),count=document.getElementById('count');
  function chip(id,label){var c=document.createElement('span');c.className='chip'+(gal===id?' on':'');c.textContent=label;c.onclick=function(){gal=id;render();};chips.appendChild(c);}
  function render(){
    chips.innerHTML='';chip('','All');D.galleries.forEach(function(g){chip(g.id,g.title+' · '+g.n);});
    var needle=q.trim().toLowerCase();
    var list=D.effects.filter(function(e){return (!gal||e.g===gal)&&(!needle||(e.n+' '+e.i+' '+(e.c||'')+' '+(e.s||'')).toLowerCase().indexOf(needle)>=0);});
    count.textContent=list.length+' / '+D.effects.length+' effects';
    var html='';list.slice(0,600).forEach(function(e){
      html+='<div class="card"><a href="html/'+e.i+'.html"><img loading="lazy" src="gif/'+e.i+'.gif" width="'+e.w+'" height="'+e.h+'" alt=""></a>'+
        '<div class="m"><b>'+esc(e.n)+'</b><code>'+e.i+'</code>'+(e.c?' · '+esc(e.c):'')+(e.s?' · '+esc(D.spectrums[e.s]||e.s):'')+
        (e.a?'':'<span class="tag">static</span>')+' · <a href="html/'+e.i+'.html">sample</a></div></div>';});
    if(list.length>600)html+='<div class="card"><div class="m">Showing the first 600 — narrow the search to see the rest.</div></div>';
    grid.innerHTML=html;
  }
  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  document.getElementById('q').addEventListener('input',function(ev){q=ev.target.value;render();});
  render();
})();
</script></body></html>
`);
  // Root README: refresh the block between the showcase markers (inserted before "## Themes" if absent).
  const rootReadme = resolve(ROOT, 'README.md');
  if (existsSync(rootReadme)) {
    const S = '<!-- showcase:start -->', E = '<!-- showcase:end -->';
    const block = [S,
      '## 🎞 GIF showcase', '',
      `Every one of the **${total} facets** is recorded as a looping GIF from its own standalone HTML sample, so you can browse the whole library without opening Prism.html — see [**showcase/**](showcase/README.md) (${fmtKB(m.gifBytes)} of GIFs, rendered by ${engine}). Click a gallery below to open its page; click any GIF there to get to the effect's self-contained HTML.`, '',
      '<table>',
      ...Array.from({ length: Math.ceil(index.length / 3) }, (_, i) => '<tr>' + index.slice(i * 3, i * 3 + 3).map(x =>
        `<td align="center" valign="top" width="33%"><a href="showcase/${x.file}"><img src="showcase/${x.hero.gif}" width="300" alt="${esc(x.title)}"></a><br><b><a href="showcase/${x.file}">${esc(x.title)}</a></b><br><sub>${x.list.length} effects</sub></td>`).join('') + '</tr>'),
      '</table>', '',
      'Regenerate with `node showcase/build.mjs` (Node 18+, Firefox or Chromium, ffmpeg) — the GIFs are display-only and never part of the catalog or MCP server.', '',
      E].join('\n');
    let src = readFileSync(rootReadme, 'utf8');
    if (src.includes(S) && src.includes(E)) src = src.slice(0, src.indexOf(S)) + block + src.slice(src.indexOf(E) + E.length);
    else { const at = src.indexOf('## Themes'); src = at >= 0 ? src.slice(0, at) + block + '\n\n---\n\n' + src.slice(at) : src + '\n\n---\n\n' + block + '\n'; }
    writeFileSync(rootReadme, src);
  }
  console.log(`docs: showcase/README.md, ${index.length} gallery pages, index.html, root README block (${rows.length} effects)`);
}

// Run the capture in a child process and restart it when the browser is lost.
// Cheap insurance: the child skips GIFs that already exist, so a restart resumes
// exactly where the previous worker stopped.
function captureSupervised() {
  const MAX_RESTARTS = 60;
  for (let run = 0; run <= MAX_RESTARTS; run++) {
    // --force only applies to the first worker: a restarted one must skip what was just recorded.
    const args = run === 0 ? RAW_ARGS : RAW_ARGS.filter(a => a !== '--force');
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'capture', ...args, '--child'], { stdio: 'inherit' });
    if (r.status === 0) return;
    if (r.status === EXIT_BROWSER_LOST && run < MAX_RESTARTS) { console.log(`capture worker restart ${run + 1}/${MAX_RESTARTS}`); continue; }
    throw new Error('capture worker exited with status ' + r.status);
  }
}

// ---- main -------------------------------------------------------------------
try {
  if (!['capture', 'docs', 'all'].includes(cmd)) { console.error('unknown command: ' + cmd); process.exit(2); }
  if (cmd === 'capture' || cmd === 'all') { if (CHILD || HTML_ONLY) await capture(); else captureSupervised(); }
  if (cmd === 'docs' || cmd === 'all') docs();
} catch (e) { console.error('SHOWCASE FAILED:', e.message); process.exit(1); }
