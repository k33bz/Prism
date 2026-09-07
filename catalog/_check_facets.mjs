/* ============================================================================
   Per-facet render / animation / config gate (headless Chrome, CDP, no deps).
   ----------------------------------------------------------------------------
   For each targeted facet, renders the SAME self-contained sample the showcase
   builds (tokens + effect CSS + HTML + any needs-JS initializer) and asserts,
   across a small config matrix, the things the theme-pack gate and the MCP tests
   do NOT cover:

     dark + full motion    -> renders with substance, no console error, and if the
                              facet is auto-play it has a running keyframe animation
                              (checked on elements AND ::before/::after pseudos).
     dark + reduced motion  -> no console error, and any animation seen above is
                              actually stopped (prefers-reduced-motion is effective).
     light theme + motion   -> renders with substance, no console error
                              (catches token/colour breakage under the light theme;
                               light tokens are read live from the shell).

   Exits non-zero if any targeted facet fails, so it can gate like _check_ds.

   Usage:
     node catalog/_check_facets.mjs                 # author=k33bz (default)
     node catalog/_check_facets.mjs --all           # every browsable (non-spectrum) facet
     node catalog/_check_facets.mjs --author crazy54
     node catalog/_check_facets.mjs --gallery menus
     node catalog/_check_facets.mjs --sample 30     # first N of the target set (smoke)
     node catalog/_check_facets.mjs --json          # machine-readable report
     node catalog/_check_facets.mjs --url http://localhost:8799/Prism.html  # for light tokens
   Honors PRISM_HTML for the manifest/tokens source. ============================ */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveChrome } from './_chrome.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = n => argv.includes(n);
const JSON_OUT = flag('--json');
const SAMPLE = opt('--sample') ? parseInt(opt('--sample'), 10) : 0;
const URL = opt('--url', 'http://localhost:8799/Prism.html');
const PORT = 9500 + Math.floor(Math.random() * 400);

const manifest = JSON.parse(readFileSync(resolve(HERE, 'manifest.json'), 'utf8'));
const EFFECTS = manifest.effects || [];
const TOKENS_DARK = (manifest.tokens && manifest.tokens.css) || '';
const INITS = manifest.initializers || {};

// Known-issue baseline: ids listed here are legacy reduced-motion gaps we haven't
// remediated yet. The gate reports them but does NOT fail on them, so it blocks NEW
// regressions immediately while the backlog is tracked. `--update-baseline` rewrites it.
const KNOWN_PATH = resolve(HERE, '_check_facets_known.json');
let KNOWN_SET = new Set();
try { KNOWN_SET = new Set((JSON.parse(readFileSync(KNOWN_PATH, 'utf8')).ids) || []); } catch {}
const UPDATE_BASELINE = flag('--update-baseline');

// ---- target set ----
let target = EFFECTS.filter(e => e.gallery !== 'spectrums');
if (opt('--gallery')) target = target.filter(e => e.gallery === opt('--gallery'));
if (opt('--author')) target = target.filter(e => e.author === opt('--author'));
else if (!flag('--all')) target = target.filter(e => e.author === 'k33bz');
if (SAMPLE) target = target.slice(0, SAMPLE);

// ---- token names (for reading the live light-theme values) ----
const TOKEN_NAMES = [...new Set((TOKENS_DARK.match(/--[a-z0-9-]+(?=\s*:)/gi) || []))];

function esc(s){ return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function sampleDoc(e, tokensCss){
  const initKey = e.needsJs;
  const init = initKey && INITS[initKey] && INITS[initKey].js;
  const js = init ? `<script>\n${init}\n</script>` : '';
  const bg = e.usableAsBackground ? ' bg' : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style id="prism-tokens">${tokensCss}</style>
<style id="shell">html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,sans-serif}
body{min-height:100vh;box-sizing:border-box;padding:24px;display:flex;align-items:center;justify-content:center}
.stage{position:relative;overflow:hidden;box-sizing:border-box;width:320px;min-height:120px;padding:24px 16px;display:flex;align-items:center;justify-content:center;background:var(--panel);border:1px solid var(--line);border-radius:14px}
.stage.bg{padding:0}</style>
<style id="effect-css">${e.css || ''}</style></head>
<body><div class="stage${bg}" id="stage">${e.html || ''}</div>${js}</body></html>`;
}

// in-page probe (stringified); returns {substance, anim, names}
const PROBE = `(function(){
  var stage=document.getElementById('stage'); if(!stage) return {substance:false,anim:0,names:[]};
  var r=stage.getBoundingClientRect();
  function running(el,pe){ try{ var cs=getComputedStyle(el,pe||null);
    return cs.animationName && cs.animationName!=='none' && cs.animationPlayState!=='paused' ? cs.animationName : ''; }catch(e){ return ''; } }
  var els=[stage].concat([].slice.call(stage.querySelectorAll('*')));
  var anim=0, names={};
  els.forEach(function(el){ ['',':before',':after'].forEach(function(p){
    var n=running(el, p?'::'+p.slice(1):null); if(n){ anim++; n.split(',').forEach(function(x){names[x.trim()]=1;}); } }); });
  // substance
  var sub=false;
  if(r.width>=8 && r.height>=8){
    if(stage.querySelector('svg,canvas,img')) sub=true;
    else { var kids=stage.querySelectorAll('*');
      if(!kids.length) sub=(stage.textContent||'').trim().length>0;
      else { for(var i=0;i<kids.length && !sub;i++){ var cs=getComputedStyle(kids[i]);
        if(cs.animationName!=='none') sub=true;
        else if(cs.backgroundImage!=='none') sub=true;
        else if(cs.backgroundColor && cs.backgroundColor!=='rgba(0, 0, 0, 0)' && cs.backgroundColor!=='transparent') sub=true;
        else if(parseFloat(cs.borderTopWidth)>0 || parseFloat(cs.borderLeftWidth)>0 || parseFloat(cs.borderRightWidth)>0 || parseFloat(cs.borderBottomWidth)>0) sub=true;
        else if(cs.boxShadow && cs.boxShadow!=='none') sub=true; }
        if(!sub) sub=(stage.textContent||'').trim().length>0; } }
  }
  return {substance:sub, anim:anim, names:Object.keys(names)};
})()`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const proc = spawn(resolveChrome(), ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--force-color-profile=srgb','--window-size=900,700','--remote-debugging-port='+PORT,'--user-data-dir='+mkdtempSync(tmpdir()+'/pcf-'),'about:blank'], { stdio:'ignore' });
const pending = new Map(); let id = 0, ws;
let errBuf = [];
const send = (m, p={}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id:i, method:m, params:p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression:x, returnByValue:true, awaitPromise:true }); return r && r.result && r.result.value; };

(async () => {
  let tgt; for (let i=0;i<50;i++){ try{ const j=await (await fetch(`http://localhost:${PORT}/json`)).json(); tgt=j.find(t=>t.type==='page'); if(tgt) break; }catch{} await sleep(150); }
  if(!tgt){ console.error('no devtools target'); proc.kill(); process.exit(2); }
  const { WebSocket } = globalThis;
  ws = new WebSocket(tgt.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ ws.onopen=r; ws.onerror=j; });
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errBuf.push((m.params.args||[]).map(a=>a.value||a.description||'').join(' ').slice(0,160));
    if (m.method === 'Runtime.exceptionThrown') errBuf.push('EXC: ' + (m.params.exceptionDetails && (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text) || 'error').slice(0,160));
  };
  await send('Page.enable'); await send('Runtime.enable');

  // ---- read live light-theme tokens from the shell (best-effort) ----
  let TOKENS_LIGHT = '';
  try {
    await send('Page.navigate', { url: URL }); await sleep(2600);
    await ev(`(function(){var b=[].slice.call(document.querySelectorAll('button')).find(function(x){return /Explore the new look|Close/.test(x.textContent||'');});if(b)b.click();document.querySelectorAll('[role=dialog],.modal').forEach(function(e){e.remove();});})()`);
    const clicked = await ev(`(function(){var b=[].slice.call(document.querySelectorAll('button,a')).find(function(x){return (x.textContent||'').trim()==='Light'||/☀|Light/.test(x.textContent||'');});if(b){b.click();return true;}return false;})()`);
    await sleep(500);
    const vals = await ev(`(function(){var cs=getComputedStyle(document.documentElement);return ${JSON.stringify(TOKEN_NAMES)}.map(function(n){return n+':'+cs.getPropertyValue(n).trim();}).filter(function(s){return s.split(':')[1];}).join(';');})()`);
    if (clicked && vals && /--panel:/.test(vals)) TOKENS_LIGHT = ':root{' + vals + '}';
  } catch {}
  const haveLight = !!TOKENS_LIGHT;

  const CONFIGS = [
    { key:'dark+motion',  tokens:TOKENS_DARK,  reduced:false },
    { key:'dark+reduced', tokens:TOKENS_DARK,  reduced:true },
  ];
  if (haveLight) CONFIGS.push({ key:'light+motion', tokens:TOKENS_LIGHT, reduced:false });

  await send('Page.navigate', { url:'about:blank' }); await sleep(150);

  const rows = {}; // id -> {e, motionAnim, res:{configKey:{err,substance,anim,names}}}
  for (const cfg of CONFIGS) {
    await send('Emulation.setEmulatedMedia', { features: cfg.reduced ? [{ name:'prefers-reduced-motion', value:'reduce' }] : [{ name:'prefers-reduced-motion', value:'no-preference' }] });
    for (const e of target) {
      const html = sampleDoc(e, cfg.tokens);
      errBuf = [];
      await ev(`document.open();document.write(${JSON.stringify(html)});document.close();`);
      await sleep(45);
      const probe = await ev(PROBE) || { substance:false, anim:0, names:[] };
      (rows[e.id] || (rows[e.id] = { e, res:{} })).res[cfg.key] = { err:errBuf.slice(), substance:probe.substance, anim:probe.anim, names:probe.names };
    }
  }

  // ---- evaluate assertions ----
  const isAuto = e => (e.interaction||'').indexOf('auto-play') !== -1;
  const results = [];
  for (const idk of Object.keys(rows)) {
    const { e, res } = rows[idk];
    const fails = [], warns = [];
    const dm = res['dark+motion'], dr = res['dark+reduced'], lm = res['light+motion'];
    if (dm) {
      if (dm.err.length) fails.push('console error (dark): ' + dm.err[0]);
      if (!dm.substance) fails.push('no substance (dark) — renders blank/empty');
      if (isAuto(e) && dm.anim === 0) fails.push('auto-play but no running animation');
    }
    if (dr) {
      if (dr.err.length) fails.push('console error (reduced): ' + dr.err[0]);
      if (dm && dm.anim > 0 && dr.anim > 0) fails.push('reduced-motion did not stop animation (' + dr.anim + ' still running: ' + dr.names.join(',') + ')');
    }
    if (lm) {
      if (lm.err.length) fails.push('console error (light): ' + lm.err[0]);
      if (!lm.substance) warns.push('no substance under light theme');
    }
    results.push({ id:e.id, name:e.name, gallery:e.gallery, interaction:e.interaction, author:e.author, pass: fails.length===0, fails, warns });
  }

  const failed = results.filter(r => !r.pass);
  const newFails = failed.filter(r => !KNOWN_SET.has(r.id));
  const knownFails = failed.filter(r => KNOWN_SET.has(r.id));
  const warned = results.filter(r => r.pass && r.warns.length);
  try { ws.close(); } catch {} proc.kill();

  if (UPDATE_BASELINE) {
    const ids = failed.map(r => r.id).sort();
    writeFileSync(KNOWN_PATH, JSON.stringify({ note: 'Legacy reduced-motion / render gaps the per-facet gate tolerates until remediated. Regenerate: node catalog/_check_facets.mjs --update-baseline', generated: new Date().toISOString().slice(0,10), ids }, null, 2) + '\n');
    console.log(`baseline updated: ${ids.length} known-failing facets -> ${KNOWN_PATH}`);
    process.exit(0);
  }

  if (JSON_OUT) { console.log(JSON.stringify({ total:results.length, failed:failed.length, newFails:newFails.length, knownFails:knownFails.length, warned:warned.length, configs:CONFIGS.map(c=>c.key), results }, null, 2)); process.exit(newFails.length ? 1 : 0); }

  console.log(`\ncheck-facets: ${results.length} facets · configs: ${CONFIGS.map(c=>c.key).join(', ')}${haveLight?'':'  (light tokens unavailable — dark only)'}`);
  if (newFails.length) { console.log(`\n✗ ${newFails.length} NEW failure(s) — not in the baseline:`); newFails.forEach(r => console.log(`  ✗ ${r.name}  (${r.id}, ${r.interaction})\n      ${r.fails.join('\n      ')}`)); }
  if (knownFails.length) console.log(`\n· ${knownFails.length} known legacy gaps tolerated (catalog/_check_facets_known.json).`);
  if (warned.length) { console.log(`\n⚠ ${warned.length} warnings:`); warned.slice(0,40).forEach(r => console.log(`  ⚠ ${r.name} — ${r.warns.join('; ')}`)); }
  if (!newFails.length) console.log(`\n✓ GATE PASS: no new render/animation/reduced-motion regressions across ${CONFIGS.length} configs (${knownFails.length} known gaps tracked).`);
  process.exit(newFails.length ? 1 : 0);
})();
