/* ============================================================================
   Copy-button fidelity gate (headless Chrome, CDP, no deps).
   ----------------------------------------------------------------------------
   Every gallery tile's Copy button runs the shell's shared Copy (prismCopyFrame in
   Prism.html, injected into each gallery frame). Its promise: the copied text,
   pasted into a blank page, renders the way the tile renders in the gallery.

   For a sample of tiles per gallery and per theme this gate:
     1. freezes the tile's animations at one instant and records, for every element
        of the stage (and its ::before / ::after), the computed styles that show
        (colors, backgrounds, borders, fill / stroke, type, opacity, transforms,
        shadows, filters, animation names) plus its size and running animations;
     2. clicks Copy with the clipboard stubbed, writes the text into a blank page
        (no styles, no tokens: just the paste), freezes it at the same instant and
        records the same things;
     3. fails a tile whose copy differs: other markup, a style that resolves
        differently (an unresolved token, a rule not carried, the page's text or
        backdrop missing), a size off by more than 2px / 3%, or an animation that
        runs in the gallery and not in the copy.

   Exits non-zero if any sampled tile fails.

   Usage:
     node catalog/_check_copy.mjs                          # 3 tiles per gallery, dark + light
     node catalog/_check_copy.mjs --per 12 --gallery fx,aws
     node catalog/_check_copy.mjs --themes cloudscape-dark,duolingo-light
     node catalog/_check_copy.mjs --json
   Honors PRISM_HTML and PRISM_CHROME. ========================================= */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { resolveChrome, closeBrowser } from './_chrome.mjs';
import { openWindowTab } from './_facet_probe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const HTML = process.env.PRISM_HTML ? resolve(process.env.PRISM_HTML) : resolve(HERE, '../Prism.html');
const PER = parseInt(opt('--per', '3'), 10);
const THEMES = opt('--themes', opt('--theme', 'cloudscape-dark,cloudscape-light')).split(',');
const JSON_OUT = argv.includes('--json');
const GALLERIES = (opt('--gallery') || 'charts,fx,lab,ai,objects,input,text,shapes,maps,notify,arch,aws,callouts,obsidian,menus,tables,diagrams,spectrums').split(',');
const T = 1234;   // the instant (ms) every animation is frozen at, in the gallery and in the paste
const PORT = 9400 + Math.floor(Math.random() * 90);
const VIEW = { width: 1500, height: 1100 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- in-page helpers (stringified into both documents) ----
const FNS = String.raw`
var SKIP={style:1,script:1,noscript:1,template:1,title:1,meta:1,link:1};
var PROPS=['color','background-color','background-image','border-top-color','border-top-width','border-top-style','border-left-color','border-bottom-color','fill','stroke','stroke-width','opacity','visibility','display','font-family','font-size','font-weight','font-style','line-height','box-shadow','text-shadow','filter','transform','animation-name','border-radius','letter-spacing','text-transform','clip-path','mask-image','-webkit-text-fill-color','outline-style','stroke-dasharray','text-decoration-line','white-space','backdrop-filter','mix-blend-mode'];
var PPROPS=['content','color','background-color','background-image','opacity','animation-name','display','width','height','border-top-color','border-top-width','box-shadow','transform','filter'];
function freeze(root,T){try{root.getAnimations({subtree:true}).forEach(function(a){try{a.pause();a.currentTime=T;}catch(e){}});}catch(e){}
  try{[].forEach.call(root.querySelectorAll('svg'),function(s){if(s.ownerSVGElement)return;try{s.pauseAnimations();s.setCurrentTime(T/1000);}catch(e){}});}catch(e){}}
function info(root,els){var am=new Map();
  try{root.getAnimations({subtree:true}).forEach(function(a){var t=a.effect&&a.effect.target;if(!a.animationName||!t)return;var k=a.effect.pseudoElement||'';var o=am.get(t)||{};o[k]=(o[k]||0)+1;am.set(t,o);});}catch(e){}
  return els.map(function(el){var cs=getComputedStyle(el),r=el.getBoundingClientRect();
    var o={tag:el.localName,cls:String(el.getAttribute('class')||'').split(/\s+/).slice(0,2).join('.'),w:Math.round(r.width),h:Math.round(r.height),p:{},ps:{},an:am.get(el)||{}};
    PROPS.forEach(function(k){o.p[k]=cs.getPropertyValue(k);});
    ['::before','::after'].forEach(function(pe){var c=getComputedStyle(el,pe);if(c.content&&c.content!=='none'&&c.content!=='normal'){var q={};PPROPS.forEach(function(k){q[k]=c.getPropertyValue(k);});o.ps[pe]=q;}});
    return o;});}
`;
const GALLERY = (i) => `(async function(){${FNS}
  var d=document.getElementById('gv').contentDocument,t=window.__tiles[${i}],stage=t.querySelector('.stage')||t,panel=stage===t;
  // a panel copy leaves out the gallery's NEW / UPDATED marking and the grid row's stretch
  if(panel){t.classList.remove('is-new','is-fixed');t.style.alignSelf='start';}
  t.scrollIntoView({block:'center'});await new Promise(function(r){setTimeout(r,300);});
  freeze(stage,${T});await new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});});
  var els=[].filter.call(stage.querySelectorAll('*'),function(e){return !SKIP[e.localName]&&!(panel&&e.closest('.fx-copy'));});if(panel)els.unshift(stage);
  var r=stage.getBoundingClientRect();
  return {panel:panel,w:Math.round(r.width),h:Math.round(r.height),info:info(stage,els)};})()`;
const COPY = (i) => `(async function(){
  var f=document.getElementById('gv'),d=f.contentDocument,w=f.contentWindow;w.__copied=null;
  try{Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:{writeText:function(x){w.__copied=String(x);return Promise.resolve();}}});}catch(e){}
  window.__btns[${i}].click();
  for(var k=0;k<40&&w.__copied==null;k++)await new Promise(function(r){setTimeout(r,50);});
  return w.__copied;})()`;
const PASTE = `(async function(){${FNS}
  await new Promise(function(r){setTimeout(r,80);});try{await document.fonts.ready;}catch(e){}
  var body=document.body,wrap=[].find.call(body.children,function(e){return e.classList.contains('prism-copy');});
  freeze(body,${T});await new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});});
  function sprite(e){return e.localName==='svg'&&e.getAttribute('width')==='0'&&e.getAttribute('height')==='0'&&e.parentNode===(wrap||body);}
  var els=[].filter.call(body.querySelectorAll('*'),function(e){if(SKIP[e.localName]||e===wrap)return false;for(var x=e;x&&x!==body;x=x.parentNode)if(sprite(x))return false;return true;});
  var css='';[].forEach.call(document.querySelectorAll('style'),function(s){css+=s.textContent;});
  var inl='';[].forEach.call(body.querySelectorAll('[style]'),function(e){inl+=e.getAttribute('style')+';';});
  var defined={};(css+inl).replace(/(--[\\w-]+)\\s*:/g,function(x,v){defined[v]=1;return x;});
  var unresolved={};(css+inl).replace(/var\\(\\s*(--[\\w-]+)\\s*\\)/g,function(x,v){if(!defined[v])unresolved[v]=1;return x;});
  return {wrap:!!wrap,info:info(body,els),unresolved:Object.keys(unresolved)};})()`;

const num = (s) => String(s).replace(/-?\d+\.\d+/g, (m) => String(Math.round(parseFloat(m) * 10) / 10));
const same = (k, a, b) => a === b || (/transform|shadow|filter|dasharray|line-height|letter-spacing/.test(k) && num(a) === num(b));
const shows = (o) => o.w > 0 && o.h > 0 && o.p.display !== 'none' && o.p.visibility !== 'hidden';
function compare(g, p) {
  const out = [];
  const eq = (a, b) => a === b || (a === 'canvas' && b === 'img');   // Copy turns a canvas into a picture of it
  if (g.info.length !== p.info.length || g.info.some((o, i) => !eq(o.tag, p.info[i].tag))) out.push(`markup differs: ${g.info.length} elements in the tile, ${p.info.length} in the copy`);
  const n = Math.min(g.info.length, p.info.length);
  for (let i = 0; i < n && out.length < 6; i++) {
    const a = g.info[i], b = p.info[i]; if (a.tag !== b.tag) break;
    const el = a.tag + (a.cls ? '.' + a.cls : '');
    for (const k of Object.keys(a.p)) {
      // a border color only shows when the side is drawn (it defaults to currentColor)
      if (/border-\w+-color/.test(k) && a.p['border-top-style'] === 'none' && b.p['border-top-style'] === 'none') continue;
      if (!same(k, a.p[k], b.p[k])) out.push(`${el} ${k}: ${a.p[k].slice(0, 60)} | copy ${b.p[k].slice(0, 60)}`);
    }
    if (!(g.panel && i === 0)) for (const pe of new Set([...Object.keys(a.ps), ...Object.keys(b.ps)])) {
      const x = a.ps[pe], y = b.ps[pe];
      if (!x || !y) { out.push(`${el}${pe}: ${x ? 'missing in the copy' : 'only in the copy'}`); continue; }
      for (const k of Object.keys(x)) if (!same(k, x[k], y[k])) out.push(`${el}${pe} ${k}: ${x[k].slice(0, 60)} | copy ${y[k].slice(0, 60)}`);
    }
    if (JSON.stringify(a.an) !== JSON.stringify(b.an)) out.push(`${el}: ${Object.keys(a.an).length ? 'animates in the tile' : 'still in the tile'}, ${Object.keys(b.an).length ? 'animates' : 'still'} in the copy`);
    if (shows(a) && (Math.abs(a.w - b.w) > Math.max(2, a.w * 0.03) || Math.abs(a.h - b.h) > Math.max(2, a.h * 0.03))) out.push(`${el} size ${a.w}x${a.h} | copy ${b.w}x${b.h}`);
  }
  if (p.unresolved.length) out.push('tokens with no value in the copy: ' + p.unresolved.join(', '));
  return out;
}

const proc = spawn(resolveChrome(), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb', '--hide-scrollbars',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + mkdtempSync(tmpdir() + '/pcc-'), 'about:blank'], { stdio: 'ignore' });
const results = [];
let code = 0;
try {
  let up = false; for (let i = 0; i < 400 && !up; i++) { try { await (await fetch(`http://localhost:${PORT}/json/version`)).json(); up = true; } catch { await sleep(150); } }
  if (!up) throw new Error('no devtools endpoint');
  const shell = await openWindowTab(PORT, { ...VIEW, timeout: 90000 });
  const paste = await openWindowTab(PORT, { width: 900, height: 900, timeout: 30000 });
  for (const theme of THEMES) {
    await shell.send('Page.navigate', { url: 'file:///' + HTML.replace(/\\/g, '/') + '?theme=' + theme });
    await sleep(2600);
    await shell.ev(`(function(){try{localStorage.setItem('prismRevealSeen','1');}catch(e){}var b=document.getElementById('prRevealOk');if(b)b.click();})()`);
    for (const g of GALLERIES) {
      await shell.ev(`window.PrismShell.go(${JSON.stringify(g)})`);
      let last = -1, stable = 0;
      for (let i = 0; i < 150; i++) {
        await sleep(300);
        const n = await shell.ev(`(function(){var d=document.getElementById('gv').contentDocument;if(window.PrismShell.current()!==${JSON.stringify(g)}||!d||d.readyState!=='complete')return -1;return d.querySelectorAll('.tile,.panel').length;})()`);
        if (n > 0 && n === last) { if (++stable >= 3) break; } else stable = 0; last = n;
      }
      // the tiles with a Copy button (a panel's is its "Code" button), sampled evenly
      const n = await shell.ev(`(function(){var d=document.getElementById('gv').contentDocument,tiles=[],btns=[];
        [].forEach.call(d.querySelectorAll('.tile,.panel'),function(t){if(t.parentElement.closest('.tile,.panel')||t.offsetParent===null)return;
          var b=[].find.call(t.querySelectorAll('.fx-copy button'),function(x){return /^\\s*code\\s*$/i.test(x.textContent);})||[].find.call(t.querySelectorAll('button'),function(x){return /copy/i.test(x.textContent)&&!x.closest('.stage');});
          if(b&&(t.querySelector('.stage')||t.classList.contains('panel'))){tiles.push(t);btns.push(b);}});
        var k=Math.min(${PER},tiles.length),pick=[];for(var i=0;i<k;i++){var j=Math.round(i*(tiles.length-1)/Math.max(1,k-1));if(pick.indexOf(j)<0)pick.push(j);}
        window.__tiles=pick.map(function(j){return tiles[j];});window.__btns=pick.map(function(j){return btns[j];});return window.__tiles.length;})()`);
      for (let i = 0; i < (n || 0); i++) {
        const name = await shell.ev(`(function(){var e=window.__tiles[${i}].querySelector('.nm, .ptitle');return e?e.textContent.replace(/\\s+/g,' ').trim():'tile';})()`);
        const g0 = await shell.ev(GALLERY(i));
        const text = await shell.ev(COPY(i));
        const rec = { theme, gallery: g, name, fails: [] };
        if (!g0) rec.fails.push('could not read the tile');
        else if (!text) rec.fails.push('Copy put nothing on the clipboard');
        else {
          // the blank page is as wide as the tile's stage (plus the body's default 8px margins)
          await paste.send('Emulation.setDeviceMetricsOverride', { width: g0.w + 16, height: Math.max(300, g0.h + 300), deviceScaleFactor: 1, mobile: false });
          paste.errs = [];
          await paste.ev(`document.open();document.write(${JSON.stringify('<!DOCTYPE html><html><head><meta charset="utf-8"><title>paste</title></head><body>' + text + '</body></html>')});document.close();`);
          const p0 = await paste.ev(PASTE);
          if (!p0) rec.fails.push('the paste did not render');
          else rec.fails = compare(g0, p0);
          if (paste.errs.length) rec.fails.push('console error in the paste: ' + paste.errs[0]);
        }
        results.push(rec);
        if (!JSON_OUT) console.log(`${rec.fails.length ? '✗' : '✓'} ${theme.padEnd(17)} ${g.padEnd(10)} ${name}` + (rec.fails.length ? '\n      ' + rec.fails.slice(0, 4).join('\n      ') : ''));
      }
    }
  }
  shell.close(); paste.close();
} catch (e) { console.error('check-copy: ' + (e && e.message || e)); code = 2; }
finally { await closeBrowser(PORT, proc); }
const failed = results.filter((r) => r.fails.length);
if (JSON_OUT) console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
else console.log(`\ncheck-copy: ${results.length - failed.length}/${results.length} copies render like their tile (${THEMES.join(', ')}; ${PER} per gallery)`);
process.exit(code || (failed.length ? 1 : 0));
