/* ============================================================================
   Per-facet render / animation / theme gate (headless Chrome, CDP, no deps).
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
     <theme> + motion       -> one per registry theme asked for (default: Cloudscape
                              Light). The facet is re-skinned the way the shell
                              re-skins a gallery frame: the theme's :root block from
                              Prism.html's THEME_REGISTRY after the facet CSS, and
                              data-ds / data-mode / data-theme / color-scheme on the
                              root. Asserts no console error, substance kept (a facet
                              that renders in dark must not vanish), and legible text:
                              every rendered text run (elements, SVG text, ::before /
                              ::after content, form values, placeholders) must reach
                              its WCAG contrast floor against the pixels actually
                              painted under its glyphs (see _facet_probe.mjs).

   Text contrast is measured in dark + motion too (it runs as a baseline even when
   "dark" is not asked for) and reported, but only the themed configs fail on it, and
   only where the theme breaks the text: a run below its floor in a theme fails unless
   the same run (element and text) is also below its floor in dark and the theme keeps
   at least 90% of the dark ratio (or loses no more than 0.3 of it). Those are the facet's own design (a label over a
   ring, --dim on --panel2), reported as "shared with dark" and tracked by the dark
   report, not theme breakage. --strict fails on them too.

   Exits non-zero if any targeted facet fails, so it can gate like _check_ds.

   Usage:
     node catalog/_check_facets.mjs                 # author=k33bz (default)
     node catalog/_check_facets.mjs --all           # every browsable (non-spectrum) facet
     node catalog/_check_facets.mjs --author crazy54
     node catalog/_check_facets.mjs --gallery menus
     node catalog/_check_facets.mjs --id obsidian-tag-distribution-orbit   # comma list ok
     node catalog/_check_facets.mjs --sample 30     # first N of the target set (smoke)
     node catalog/_check_facets.mjs --theme duolingo-light       # one registry theme
     node catalog/_check_facets.mjs --themes dark,acorn-dark,glass-light
                                                    # "dark" = the dark+motion/reduced pair;
                                                    # default: dark,cloudscape-light
     node catalog/_check_facets.mjs --strict        # themed runs fail even when dark is as low
     node catalog/_check_facets.mjs --json          # machine-readable report
     node catalog/_check_facets.mjs --url http://localhost:8799/Prism.html
                                                    # Cloudscape Light tokens read live
                                                    # from a running shell instead
   Honors PRISM_HTML (the theme registry source) and PRISM_CHROME. ===================== */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveChrome, closeBrowser } from './_chrome.mjs';
import { themeById, tokenMap, themedDoc, openWindowTab, measureText } from './_facet_probe.mjs';
import { parseColor, toHex } from './theme-engine/color.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = n => argv.includes(n);
const JSON_OUT = flag('--json');
const SAMPLE = opt('--sample') ? parseInt(opt('--sample'), 10) : 0;
const URL = opt('--url');
const STRICT = flag('--strict');
const PRISM_HTML = process.env.PRISM_HTML ? resolve(process.env.PRISM_HTML) : resolve(HERE, '../Prism.html');
const THEME_IDS = (opt('--themes') || opt('--theme') || 'dark,cloudscape-light').split(',').map(s => s.trim()).filter(Boolean);
const PORT = 9500 + Math.floor(Math.random() * 400);
const VIEW = { width: 900, height: 1400 };

const manifest = JSON.parse(readFileSync(resolve(HERE, 'manifest.json'), 'utf8'));
const EFFECTS = manifest.effects || [];
const TOKENS_DARK = (manifest.tokens && manifest.tokens.css) || '';
const INITS = manifest.initializers || {};

// Known-issue baseline: `ids` are facets the gate reports but does NOT fail on, so it
// blocks NEW regressions while a backlog is tracked (`--update-baseline` rewrites them).
// `contrast` maps a facet id to the reason its low-contrast text is a design choice
// (a string tolerates the whole facet; {why, els:[...]} only those element labels).
const KNOWN_PATH = resolve(HERE, '_check_facets_known.json');
let KNOWN = {};
try { KNOWN = JSON.parse(readFileSync(KNOWN_PATH, 'utf8')); } catch {}
const KNOWN_SET = new Set(KNOWN.ids || []);
const CONTRAST_OK = KNOWN.contrast || {};
const UPDATE_BASELINE = flag('--update-baseline');

// ---- target set ----
let target = EFFECTS.filter(e => e.gallery !== 'spectrums');
if (opt('--gallery')) target = target.filter(e => e.gallery === opt('--gallery'));
if (opt('--id')) { const ids = new Set(opt('--id').split(',')); target = target.filter(e => ids.has(e.id)); }
if (opt('--author')) target = target.filter(e => e.author === opt('--author'));
else if (!flag('--all') && !opt('--id')) target = target.filter(e => e.author === 'k33bz');
if (SAMPLE) target = target.slice(0, SAMPLE);

// ---- configs ----
const html = readFileSync(PRISM_HTML, 'utf8');
const CONFIGS = [];
for (const id of THEME_IDS) {
  if (id === 'dark') {
    CONFIGS.push({ key: 'dark+motion', reduced: false, theme: null, contrast: true, gate: false });
    CONFIGS.push({ key: 'dark+reduced', reduced: true, theme: null, contrast: false, gate: false });
  } else {
    let theme;
    try { theme = themeById(html, id); } catch (err) { console.error('check-facets: ' + err.message); process.exit(2); }
    CONFIGS.push({ key: id, reduced: false, theme, contrast: true, gate: true });
  }
}
// a themed run is judged against the same run in dark: measure dark even when not asked
if (!CONFIGS.some(c => c.key === 'dark+motion')) CONFIGS.unshift({ key: 'dark+motion', reduced: false, theme: null, contrast: true, gate: false, baseline: true });
// A theme inherits the dark design's low text when it keeps >= 90% of the dark ratio or loses no
// more than 0.3 of it (near 1:1 the ratio is noise: 1.0 and 1.2 are both a label on top of a shape).
const SHARE = 0.9, SHARE_ABS = 0.3;
const TOKEN_NAMES = [...new Set((TOKENS_DARK.match(/--[a-z0-9-]+(?=\s*:)/gi) || []))];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const proc = spawn(resolveChrome(), ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--force-color-profile=srgb','--hide-scrollbars',
  // every config runs in its own window at once: keep them all at full speed
  '--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows',
  '--window-size='+VIEW.width+','+VIEW.height,'--remote-debugging-port='+PORT,'--user-data-dir='+mkdtempSync(tmpdir()+'/pcf-'),'about:blank'], { stdio:'ignore' });

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
  // SVG SMIL (<animate>, <animateMotion>, ...) runs without CSS keyframes: count each one whose
  // target is actually rendered, so a reduced-motion rule that hides the moving parts reads as stopped.
  [].slice.call(stage.querySelectorAll('animate,animateMotion,animateTransform,set')).forEach(function(a){
    var shown=true;
    for(var x=a.targetElement||a.parentNode; x && x!==stage; x=x.parentNode){ if(x.nodeType===1 && getComputedStyle(x).display==='none'){ shown=false; break; } }
    if(shown){ anim++; names['smil:'+a.localName]=1; } });
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
async function runConfig(tab, cfg) {
  await tab.send('Emulation.setEmulatedMedia', { features: [{ name:'prefers-reduced-motion', value: cfg.reduced ? 'reduce' : 'no-preference' }] });
  const dim = cfg.theme ? tokenMap(cfg.theme.css)['--dim'] : tokenMap(TOKENS_DARK)['--dim'];
  const out = {};
  for (const e of target) {
    const init = e.needsJs && INITS[e.needsJs] && INITS[e.needsJs].js;
    tab.errs = [];
    await tab.ev(`document.open();document.write(${JSON.stringify(themedDoc(e, { tokensCss: TOKENS_DARK, theme: cfg.theme, init }))});document.close();`);
    await sleep(45);
    const probe = await tab.ev(PROBE) || { substance:false, anim:0, names:[] };
    const err = tab.errs.slice();
    let text = [], textErr = '';
    if (cfg.contrast) { try { text = await measureText(tab, { dim }); } catch (x) { textErr = String(x && x.message || x).slice(0, 120); } }
    out[e.id] = { err, substance: probe.substance, anim: probe.anim, names: probe.names, text, textErr };
  }
  return out;
}

const fmtColor = c => { const p = parseColor(c); return p ? toHex(p) + (p.a < 1 ? '@' + Math.round(p.a * 100) + '%' : '') : c; };
const fmtRun = (it, key) => `${it.ratio}:1 < ${it.floor} [${key}] "${it.text}" ${it.el} (${fmtColor(it.color)}${it.op < 1 ? ' x' + it.op : ''} on ${it.bg})`;
function tolerated(id, it) {
  const k = CONTRAST_OK[id];
  if (!k) return false;
  if (typeof k === 'string') return true;
  return !k.els || k.els.includes(it.el);
}

(async () => {
  let ver; for (let i=0;i<60;i++){ try{ ver=await (await fetch(`http://localhost:${PORT}/json/version`)).json(); if(ver) break; }catch{} await sleep(150); }
  if(!ver){ console.error('no devtools endpoint'); await closeBrowser(PORT, proc); process.exit(2); }
  // one window per config, all running at once
  const tabs = [];
  for (let i = 0; i < CONFIGS.length; i++) tabs.push(await openWindowTab(PORT, VIEW));

  // ---- legacy override: Cloudscape Light tokens read live from a running shell ----
  let urlNote = '';
  if (URL) {
    const cl = CONFIGS.find(c => c.theme && c.theme.id === 'cloudscape-light');
    const tab = tabs[0];
    try {
      await tab.send('Page.navigate', { url: URL }); await sleep(2600);
      await tab.ev(`(function(){var b=[].slice.call(document.querySelectorAll('button')).find(function(x){return /Explore the new look|Close/.test(x.textContent||'');});if(b)b.click();document.querySelectorAll('[role=dialog],.modal').forEach(function(e){e.remove();});})()`);
      const clicked = await tab.ev(`(function(){var b=[].slice.call(document.querySelectorAll('button,a')).find(function(x){return (x.textContent||'').trim()==='Light'||/☀|Light/.test(x.textContent||'');});if(b){b.click();return true;}return false;})()`);
      await sleep(500);
      const vals = await tab.ev(`(function(){var cs=getComputedStyle(document.documentElement);return ${JSON.stringify(TOKEN_NAMES)}.map(function(n){return n+':'+cs.getPropertyValue(n).trim();}).filter(function(s){return s.split(':')[1];}).join(';');})()`);
      if (cl && clicked && vals && /--panel:/.test(vals)) { cl.theme = { ...cl.theme, css: ':root{' + vals + '}' }; urlNote = `  (cloudscape-light tokens read live from ${URL})`; }
      else urlNote = `  (live tokens unavailable at ${URL}; cloudscape-light from the registry)`;
    } catch { urlNote = `  (live tokens unavailable at ${URL}; cloudscape-light from the registry)`; }
    await tab.send('Page.navigate', { url:'about:blank' }); await sleep(150);
  }

  const t0 = Date.now();
  const per = await Promise.all(CONFIGS.map((cfg, i) => runConfig(tabs[i], cfg)));
  const byCfg = {}; CONFIGS.forEach((c, i) => { byCfg[c.key] = per[i]; });

  // ---- evaluate assertions ----
  const isAuto = e => (e.interaction||'').indexOf('auto-play') !== -1;
  const results = [];
  const counts = {}; CONFIGS.filter(c => c.contrast).forEach(c => { counts[c.key] = { facets: 0, runs: 0, gated: 0, shared: 0, tolerated: 0 }; });
  for (const e of target) {
    const fails = [], warns = [], contrast = {};
    const dm = byCfg['dark+motion'] && byCfg['dark+motion'][e.id], dr = byCfg['dark+reduced'] && byCfg['dark+reduced'][e.id];
    const darkGate = CONFIGS.some(c => c.key === 'dark+motion' && !c.baseline);
    const darkLow = dm ? dm.text.filter(it => it.ratio < it.floor) : [];
    const shared = it => darkLow.some(d => d.el === it.el && d.text === it.text && (it.ratio >= d.ratio * SHARE || d.ratio - it.ratio <= SHARE_ABS));
    if (dm && darkGate) {
      if (dm.err.length) fails.push('console error (dark): ' + dm.err[0]);
      if (!dm.substance) fails.push('no substance (dark): renders blank/empty');
      if (isAuto(e) && dm.anim === 0) fails.push('auto-play but no running animation');
    }
    if (dr) {
      if (dr.err.length) fails.push('console error (reduced): ' + dr.err[0]);
      if (dm && dm.anim > 0 && dr.anim > 0) fails.push('reduced-motion did not stop animation (' + dr.anim + ' still running: ' + dr.names.join(',') + ')');
    }
    for (const cfg of CONFIGS) {
      const r = byCfg[cfg.key][e.id];
      if (cfg.theme) {
        if (r.err.length) fails.push(`console error (${cfg.key}): ` + r.err[0]);
        if (!r.substance) (dm && dm.substance ? fails : warns).push(`no substance under ${cfg.key}` + (dm && dm.substance ? ' (renders in dark)' : ''));
      }
      if (!cfg.contrast) continue;
      if (r.textErr) (cfg.gate ? warns : []).push(`text contrast not measured under ${cfg.key}: ${r.textErr}`);
      const low = r.text.filter(it => it.ratio < it.floor);
      if (!low.length) continue;
      const sh = it => cfg.gate && shared(it);
      contrast[cfg.key] = low.map(it => ({ el: it.el, text: it.text, ratio: it.ratio, floor: it.floor, color: fmtColor(it.color), op: it.op, bg: it.bg, size: it.size, kind: it.kind, ...(sh(it) ? { shared: true } : {}) }));
      const c = counts[cfg.key]; c.facets++; c.runs += low.length;
      if (!cfg.gate) continue; // dark: the baseline, in the JSON report and the summary count
      const judged = STRICT ? low : low.filter(it => !sh(it));
      c.shared += low.length - judged.length;
      const open = judged.filter(it => !tolerated(e.id, it));
      c.tolerated += judged.length - open.length;
      if (!open.length) continue;
      c.gated += open.length;
      const msg = `low text contrast: ` + open.slice(0, 3).map(it => fmtRun(it, cfg.key)).join('; ') + (open.length > 3 ? ` (+${open.length - 3} more)` : '');
      fails.push(msg);
    }
    results.push({ id:e.id, name:e.name, gallery:e.gallery, interaction:e.interaction, author:e.author, pass: fails.length===0, fails, warns, contrast });
  }

  const failed = results.filter(r => !r.pass);
  const newFails = failed.filter(r => !KNOWN_SET.has(r.id));
  const knownFails = failed.filter(r => KNOWN_SET.has(r.id));
  const warned = results.filter(r => r.pass && r.warns.length);
  for (const t of tabs) t.close();
  await closeBrowser(PORT, proc);
  const secs = Math.round((Date.now() - t0) / 1000);

  if (UPDATE_BASELINE) {
    const ids = failed.map(r => r.id).sort();
    const next = { ...KNOWN, note: KNOWN.note || 'Facets the per-facet gate tolerates. Regenerate ids: node catalog/_check_facets.mjs --update-baseline', generated: new Date().toISOString().slice(0,10), ids };
    writeFileSync(KNOWN_PATH, JSON.stringify(next, null, 2) + '\n');
    console.log(`baseline updated: ${ids.length} known-failing facets -> ${KNOWN_PATH}`);
    process.exit(0);
  }

  if (JSON_OUT) { console.log(JSON.stringify({ total:results.length, failed:failed.length, newFails:newFails.length, knownFails:knownFails.length, warned:warned.length, configs:CONFIGS.map(c=>c.key), contrast:counts, seconds:secs, results }, null, 2)); process.exit(newFails.length ? 1 : 0); }

  console.log(`\ncheck-facets: ${results.length} facets · configs: ${CONFIGS.map(c=>c.key).join(', ')}${urlNote} · ${secs}s`);
  for (const [k, c] of Object.entries(counts)) {
    const cf = CONFIGS.find(x => x.key === k);
    console.log(`  text contrast ${k}: ${c.runs} low run(s) in ${c.facets} facet(s)` + (cf.gate ? `: ${c.gated} failing, ${c.shared} shared with dark${STRICT ? ' (strict: failing too)' : ''}, ${c.tolerated} tolerated` : ` (${cf.baseline ? 'baseline for the themes' : 'reported'}, not gated)`));
  }
  if (newFails.length) { console.log(`\n✗ ${newFails.length} NEW failure(s), not in the baseline:`); newFails.forEach(r => console.log(`  ✗ ${r.name}  (${r.id}, ${r.interaction})\n      ${r.fails.join('\n      ')}`)); }
  if (knownFails.length) console.log(`\n· ${knownFails.length} known legacy gaps tolerated (catalog/_check_facets_known.json).`);
  if (warned.length) { console.log(`\n⚠ ${warned.length} warnings:`); warned.slice(0,40).forEach(r => console.log(`  ⚠ ${r.name}: ${r.warns.join('; ')}`)); if (warned.length > 40) console.log(`  ... ${warned.length - 40} more (--json for all)`); }
  if (!newFails.length) console.log(`\n✓ GATE PASS: no new render/animation/reduced-motion/theme regressions across ${CONFIGS.length} configs (${knownFails.length} known gaps tracked).`);
  process.exit(newFails.length ? 1 : 0);
})();
