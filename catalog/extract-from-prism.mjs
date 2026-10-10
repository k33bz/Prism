/* ============================================================================
   Prism catalog extractor (current path) → manifest.json + index.json
   ----------------------------------------------------------------------------
   The original extract-manifest.mjs read standalone _merged-originals/*.html via
   Playwright. Those source files no longer exist and Playwright isn't installed;
   the source of truth is now the pg-* templates INSIDE Prism.html. This extractor
   loads Prism.html in headless Chrome (CDP, no deps), drives the SPA to each
   gallery, and runs the same in-page extraction against the live iframe DOM.

   Run: node catalog/extract-from-prism.mjs
   Then: node catalog/_embed-catalog.mjs   (embeds manifest into the #prism-catalog island)
   ========================================================================== */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveChrome, closeBrowser } from './_chrome.mjs';
import { CSS_SOURCE_FNS } from './_css-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = HERE;
// PRISM_HTML lets tooling point the extractor at an alternate file (e.g. a temp copy
// with staged additions) for verification; defaults to the repo's Prism.html.
const TARGET = process.env.PRISM_HTML ? resolve(process.env.PRISM_HTML) : resolve(HERE, '../Prism.html');
const FILE = 'file://' + TARGET.replace(/\\/g, '/');
const CHROME = resolveChrome();
const PORT = 9366;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const GALLERIES = [
  { gallery: 'charts', title: 'Charts & Metrics' },
  { gallery: 'fx', title: 'FX Store' },
  { gallery: 'lab', title: 'Animation Lab' },
  { gallery: 'ai', title: 'AI Working' },
  { gallery: 'objects', title: 'Animated Objects' },
  { gallery: 'input', title: 'Input Methods' },
  { gallery: 'text', title: 'Text Effects' },
  { gallery: 'shapes', title: 'Text Shapes' },
  { gallery: 'maps', title: 'Maps & Geo' },
  { gallery: 'notify', title: 'Notifications & Status' },
  { gallery: 'arch', title: 'Architecture Diagrams' },
  { gallery: 'aws', title: 'AWS Architecture' },
  { gallery: 'callouts', title: 'Callouts & Annotations' },
  // These three are real content galleries with pg-* templates + nav links in
  // Prism.html. Omitting them silently dropped 433 effects (obsidian 130,
  // menus 37, spectrums 266), leaving a 1235-effect manifest vs the island's
  // 1668 — the stale-manifest root cause. Titles match the #prism-catalog island.
  { gallery: 'obsidian', title: 'Obsidian Facets' },
  { gallery: 'menus', title: 'Menus & Actions' },
  { gallery: 'tables', title: 'Tables & Data Layouts' },
  { gallery: 'diagrams', title: 'Diagrams & Frameworks' },
  { gallery: 'spectrums', title: 'Spectrums' },
];

// This function is serialized and evaluated INSIDE the gallery iframe. It is a
// faithful port of extract-manifest.mjs's extractInPage, but reads styles from
// the iframe document passed as `d` (the CDP evaluate runs in the top frame, so
// we resolve the iframe doc first and pass it in via a wrapper below).
const EXTRACT_FN = `function extractInPage(gallery, d){
  var docStyleSheets = d.styleSheets;
  ${CSS_SOURCE_FNS}
  // Chromium serializes a var() shorthand's longhands as "prop: ;" when the same block also
  // sets one of them (background + background-size, animation + animation-delay), so
  // cssText silently drops the value. Only those rules are rebuilt, from the declarations
  // in the owner <style>'s source text; every other rule keeps its cssText byte for byte.
  var EMPTY_DECL=/[a-z-]+: ;/, srcMaps=new Map(), scratch=null, unrecovered=new Set();
  // The rule the browser makes of one rule's source parsed on its own (null when dropped).
  function reparse(text){
    try{ scratch=scratch||new d.defaultView.CSSStyleSheet(); scratch.replaceSync(text); }catch(e){ return null; }
    return scratch.cssRules.length===1?scratch.cssRules[0]:null;
  }
  // Source rule behind a CSSOM rule (top level, or a child of an @media / @keyframes), or
  // null. Each sheet / parent rule is aligned once, on first use, by exact re-serialization.
  function srcNode(rule){
    var parent=rule.parentRule, sheet=rule.parentStyleSheet, key=parent||sheet, m=srcMaps.get(key);
    if(!m){
      m=new Map(); srcMaps.set(key,m);
      var nodes=null, head='';
      if(parent){ var pn=srcNode(parent); if(pn&&pn.children){ nodes=pn.children; head=pn.text.slice(0,pn.text.length-pn.body.length-1); } }
      else if(sheet&&sheet.ownerNode&&sheet.ownerNode.localName==='style') nodes=parseCssSource(sheet.ownerNode.textContent);
      if(nodes){
        var list=key.cssRules, texts=[];
        for(var i=0;i<list.length;i++) texts.push(list[i].cssText);
        alignCssRules(texts, nodes, function(n){
          // a child only parses inside its parent's head ("@media (...){" / "@keyframes x{")
          var r=reparse(head?head+n.text+'}':n.text);
          if(r&&head) r=r.cssRules&&r.cssRules.length===1?r.cssRules[0]:null;
          return r?r.cssText:null;
        }).forEach(function(k,i){ if(k>=0) m.set(list[i],nodes[k]); });
      }
    }
    return m.get(rule)||null;
  }
  // cssText, with any blanked declaration block replaced by the author's declarations.
  function authored(rule){
    var t=rule.cssText; if(!EMPTY_DECL.test(t)) return t;
    var n, body;
    if(rule.type===1){ n=srcNode(rule); if(n&&(body=cssDeclBlock(n.body))!=null) t=rule.selectorText+' { '+body+' }'; }
    else if(rule.type===7){
      for(var i=0;i<rule.cssRules.length;i++){
        var k=rule.cssRules[i], kt=k.cssText;
        if(EMPTY_DECL.test(kt)&&(n=srcNode(k))&&(body=cssDeclBlock(n.body))!=null) t=t.split(kt).join(k.keyText+' { '+body+' }');
      }
    }
    if(EMPTY_DECL.test(t)) unrecovered.add(rule);
    return t;
  }
  function slug(s){return (s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);}
  function cssFor(html){
    var classes=new Set();
    (html.match(/class="([^"]*)"/g)||[]).forEach(function(m){m.replace(/class="|"/g,'').split(/\\s+/).forEach(function(c){if(c)classes.add(c);});});
    var rulesOut=[]; var kf=new Set(); var animSel=new Set();
    function scanAnims(text){
      (text.match(/animation(?:-name)?:\\s*[^;}]+/g)||[]).forEach(function(a){
        a.split(/[\\s:,]+/).forEach(function(t){
          if(/^[a-zA-Z][\\w-]*$/.test(t) && !/^(animation|animation-name|ease|linear|infinite|alternate|reverse|normal|forwards|backwards|both|none|steps|ease-in|ease-out|ease-in-out|paused|running|cubic-bezier|alternate-reverse)$/.test(t)) kf.add(t);
        });
      });
    }
    for(var si=0; si<docStyleSheets.length; si++){
      var rules; try{rules=docStyleSheets[si].cssRules;}catch(e){continue;}
      if(!rules) continue;
      for(var ri=0; ri<rules.length; ri++){
        var rule=rules[ri];
        if(rule.type===1 && rule.selectorText){
          var hit=false;
          classes.forEach(function(c){
            if(hit) return;
            if(rule.selectorText.split(/[\\s,>+~]+/).some(function(sel){return sel.indexOf('.'+c)!==-1 && new RegExp('\\\\.'+c+'(?![\\\\w-])').test(sel);})){hit=true;}
          });
          if(hit){ var txt=authored(rule); rulesOut.push(txt); scanAnims(txt); if(/animation(-name)?\\s*:/.test(txt)) animSel.add(rule.selectorText); }
        }
      }
      for(var rk=0; rk<rules.length; rk++){ if(rules[rk].type===7 && kf.has(rules[rk].name)) rulesOut.push(authored(rules[rk])); }
      // @media blocks (prefers-reduced-motion, responsive) whose child selectors reference
      // this facet's classes — carry them so a standalone copy keeps its reduced-motion /
      // responsive behaviour instead of silently animating through prefers-reduced-motion.
      for(var rm=0; rm<rules.length; rm++){
        var mr=rules[rm];
        if(mr.type===4 && mr.cssRules){
          var mkids=[];
          for(var mc=0; mc<mr.cssRules.length; mc++){
            var cr=mr.cssRules[mc];
            if(cr.type===1 && cr.selectorText){
              var mhit=false;
              classes.forEach(function(c){ if(mhit) return;
                if(cr.selectorText.split(/[\\s,>+~]+/).some(function(sel){return sel.indexOf('.'+c)!==-1 && new RegExp('\\\\.'+c+'(?![\\\\w-])').test(sel);})){mhit=true;} });
              if(mhit) mkids.push(authored(cr));
            }
          }
          if(mkids.length) rulesOut.push('@media '+(mr.media&&mr.media.mediaText||'')+'{'+mkids.join('')+'}');
        }
      }
      // @property registrations (typed custom properties) that the collected rules reference:
      // without them a standalone copy loses animated counters / interpolated custom props.
      var props={}; rulesOut.join('\\n').replace(/--[A-Za-z0-9_-]+/g, function(p){ props[p]=1; return p; });
      for(var rp=0; rp<rules.length; rp++){ var pr=rules[rp]; if(pr.name && pr.name.indexOf('--')===0 && props[pr.name] && pr.cssText.indexOf('@property')===0) rulesOut.push(pr.cssText); }
    }
    // Ensure standalone copies respect prefers-reduced-motion: disable every animated selector
    // under the media query. Always emitted (idempotent where a section block already stops them)
    // because some section blocks only reset transform/opacity, and an unrelated :hover rule setting
    // animation-name:none must not be mistaken for reduced-motion handling.
    if(kf.size>0 && animSel.size>0){
      rulesOut.push('@media (prefers-reduced-motion:reduce){'+[...animSel].join(',')+'{animation:none!important}}');
    }
    return {css:[...new Set(rulesOut)].join('\\n'), classes:[...classes], keyframes:[...kf]};
  }
  function paramsFor(html, css){
    var params={};
    if(/var\\(--c\\b|--c:|--c-rgb/.test(css)) params.color={var:'--c', rgbVar:'--c-rgb', note:'Set --c (hex) and --c-rgb (R,G,B) to recolor', via:'class c-crit|c-neg|c-warn|c-pos|c-info|c-accent or inline style'};
    var dataAttrs={};
    (html.match(/data-[a-z-]+="[^"]*"/g)||[]).forEach(function(m){dataAttrs[m.split('=')[0]]=m.split('"')[1];});
    if(Object.keys(dataAttrs).length) params.dataAttributes=dataAttrs;
    return params;
  }
  var records=[]; var seen={};
  // Walk the WHOLE body in document order (not just the first .wrap). Some galleries
  // have content — including newly-spliced sections — that lands outside/after the
  // first .wrap; scoping to one .wrap silently drops those tiles.
  var root=d.body||d.documentElement;
  var currentCat='General';
  var walker=root.querySelectorAll('h3.sec, .tile, .panel');
  walker.forEach(function(node){
    if(node.matches('h3.sec')){
      // Read the header text WITHOUT the runtime-injected count badge (.sec-count),
      // which the shell appends after mount; leaving it in poisons every category
      // with a trailing digit ("Progress & Ratio" -> "Progress & Ratio7").
      var hc=node.cloneNode(true); var badge=hc.querySelector('.sec-count'); if(badge)badge.remove();
      // a subtitle follows an em/en dash or a spaced hyphen; a hyphen inside a word (Time-Series,
      // MULTI-REGION) is part of the name
      currentCat=hc.textContent.replace(/^[^A-Za-z0-9]+/,'').split(/\\s+[—–-]\\s+|\\s*[—–]\\s*/)[0].trim(); return;
    }
    var nameEl=node.querySelector('.nm, .ptitle');
    var name=(nameEl?nameEl.textContent:'').replace(/\\s+/g,' ').trim() || 'effect';
    var refEl=node.querySelector('.ref'); var ref=refEl?refEl.textContent.trim():'';
    var descEl=node.querySelector('.desc, .cap'); var description=descEl?descEl.textContent.replace(/\\s+/g,' ').trim():'';
    var demoNode=node.querySelector('.stage'); var html;
    if(demoNode){ html=demoNode.innerHTML.trim(); }
    else { var clone=node.cloneNode(true); var bar=clone.querySelector('.fx-copy'); if(bar)bar.remove(); html=clone.outerHTML; }
    var snipBtn=node.querySelector('[data-snip]');
    var dataSnip=snipBtn?snipBtn.getAttribute('data-snip'):null;
    var id=node.getAttribute('data-fx-id') || (gallery+'-'+slug(name));
    if(seen[id]){seen[id]++;id+='-'+seen[id];}else seen[id]=1;
    var r=cssFor(html);
    // <symbol>s the markup references by id but does not contain (the AWS gallery's icon sprite)
    // travel with the facet, so its html stays self-contained like every other entry.
    var defs=[], seenRef={};
    (html.match(/href="#[^"]+"/g)||[]).forEach(function(m){
      var rid=m.slice(7,-1); if(seenRef[rid]) return; seenRef[rid]=1;
      var el=d.getElementById(rid); if(!el||node.contains(el)||el.tagName.toLowerCase()!=='symbol') return;
      var c=el.cloneNode(true);
      Array.prototype.slice.call(c.attributes).forEach(function(a){ if(a.name.indexOf('data-')===0) c.removeAttribute(a.name); });
      defs.push(c.outerHTML);
    });
    if(defs.length) html+='\\n<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">'+defs.join('')+'</svg>';
    // A tile may declare its initializer explicitly (fork convention: data-needs-js="<key>",
    // with the code in a <script data-prism-init="<key>"> on the same page); otherwise the
    // upstream heuristics apply.
    var needsJs=node.getAttribute('data-needs-js')||null;
    if(!needsJs){
      if(/data-weather=/.test(html)) needsJs='amb-particles';
      else if(/data-countdown=|data-timer=|data-stopwatch/.test(html)) needsJs='time-widgets';
    }
    var isBackground=r.classes.some(function(c){return c.indexOf('amb')===0;});
    var selfContained=!r.css.trim();
    var isNew=node.classList.contains('is-new');
    var isFixed=node.classList.contains('is-fixed');
    // The MCP exposes first-class faceted search over spectrum (design-system/aesthetic
    // family), componentType, and interaction (catalog.js normalizeEffect + tools facets).
    // These come from data-* attributes on the tile; capture them here so they are not
    // dropped (previously ALL null in the manifest, breaking family search).
    var spectrum=node.getAttribute('data-spectrum')||null;
    var componentType=node.getAttribute('data-ctype')||null;
    var interaction=node.getAttribute('data-interact')||null;
    records.push({
      id:id, name:name, gallery:gallery, category:currentCat, ref:ref, description:description,
      classes:r.classes, keyframes:r.keyframes, params:paramsFor(html,r.css),
      componentType:componentType, interaction:interaction, spectrum:spectrum,
      tags:[gallery]
        .concat(spectrum?[spectrum]:[])
        .concat(isBackground?['background','ambient','behind-content']:[])
        .concat(needsJs?['needs-js']:[])
        .concat(selfContained?['self-contained']:[])
        .concat(r.keyframes.length?['animated']:[])
        .concat(isNew?['new']:[])
        .concat(isFixed?['updated','fixed']:[]),
      usableAsBackground:isBackground, needsJs:needsJs, selfContained:selfContained,
      isNew:isNew, isFixed:isFixed,
      html:html, dataSnip:dataSnip, css:r.css,
    });
  });
  // Initializer sources declared on the page: <script data-prism-init="key">...</script>.
  var initializers={};
  d.querySelectorAll('script[data-prism-init]').forEach(function(s){
    initializers[s.getAttribute('data-prism-init')]={ js:s.textContent.trim(), page:gallery };
  });
  return { records:records, initializers:initializers, unrecovered:unrecovered.size };
}`;

let ws, id = 0; const pending = new Map();
const send = (method, params = {}) => { const m = ++id; ws.send(JSON.stringify({ id: m, method, params })); return new Promise(r => pending.set(m, r)); };

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + mkdtempSync(tmpdir() + '/prism-'),
  'about:blank',
], { stdio: 'ignore' });

try {
  let target;
  for (let i = 0; i < 40; i++) {
    try { const j = await (await fetch(`http://localhost:${PORT}/json`)).json();
      target = j.find(t => t.type === 'page'); if (target) break; } catch {}
    await sleep(150);
  }
  if (!target) throw new Error('no devtools target');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: FILE });
  await sleep(2600);

  const all = []; const byGallery = {}; const failures = [];
  // needsJs key -> { js, page }. Upstream's two initializers live in their page tail scripts
  // and are not declared with data-prism-init, so they are recorded as pointers only.
  const initializers = {
    'amb-particles': { js: null, page: 'objects', note: 'Ambient weather backdrop initializer in the Animated Objects page tail script.' },
    'time-widgets': { js: null, page: 'lab', note: 'Countdown ring, MM:SS and stopwatch initializer in the Animation Lab page tail script.' },
  };
  // Signature of the previously-extracted gallery. If a navigation silently fails the
  // iframe still holds the PREVIOUS gallery, and extractInPage happily relabels those
  // tiles with the requested gallery's id prefix. That is exactly how one run wrote 37
  // "menus" tiles out as spectrums-* ids and dropped 1129 real spectrum facets, with a
  // clean exit code. Comparing consecutive signatures turns that into a hard failure.
  let prevSig = null, prevGallery = null;
  const sigOf = recs => recs.map(r => r.ref + '|' + r.name).join('\n');

  for (const g of GALLERIES) {
    // Navigate via the shell's own router. The old path clicked a[data-page="<gallery>"],
    // but Spectrums has no rail link at all (it is in PAGES; it is not in the rail), so
    // querySelector returned null and `if(a)a.click()` no-opped in silence.
    // window.PrismShell.go() is the supported entry point and routes every PAGES id.
    const nav = await send('Runtime.evaluate', { returnByValue: true, expression:
      `(function(){
         try{ if(window.PrismShell&&window.PrismShell.go){ window.PrismShell.go(${JSON.stringify(g.gallery)}); return 'api'; } }catch(e){}
         var a=document.querySelector('a[data-page=${JSON.stringify(g.gallery)}]');
         if(a){ a.click(); return 'click'; }
         return 'none';
       })()` });
    if (nav.result.value === 'none') {
      console.log(g.gallery.padEnd(9), 'ERROR: unroutable (no PrismShell.go, no rail link)');
      failures.push(g.gallery); continue;
    }

    // Wait for the frame to settle rather than trusting a flat 3.2s. Spectrums alone is
    // ~1.2k tiles and keeps rendering well past any fixed sleep, so poll until the tile
    // count stops growing (two identical non-zero samples) — big galleries can't truncate.
    // Also require the shell router to report the requested page as current: the
    // shell opens on New Facets (PAGES[0]), whose build is heavy, and the very first
    // go() otherwise races it — one run captured the facets page as "charts".
    const countExpr = `(function(){var f=document.getElementById('gv'),d=f&&f.contentDocument;
      if(window.PrismShell&&window.PrismShell.current&&window.PrismShell.current()!==${JSON.stringify(g.gallery)})return -1;
      if(!d||d.readyState!=='complete')return -1;return d.querySelectorAll('.tile,.panel').length;})()`;
    let last = -1, stable = 0;
    for (let i = 0; i < 100; i++) {          // 100 x 300ms = 30s ceiling
      await sleep(300);
      const c = await send('Runtime.evaluate', { expression: countExpr, returnByValue: true });
      const n = c.result.value;
      if (n > 0 && n === last) { if (++stable >= 2) break; } else stable = 0;
      last = n;
    }

    // Run extraction inside the top frame, resolving the iframe document, passing it to the ported fn.
    const expr = `(function(){
      ${EXTRACT_FN}
      var f=document.getElementById('gv'); var d=f&&f.contentDocument;
      if(!d) return JSON.stringify({err:'no iframe doc'});
      try { return JSON.stringify(extractInPage(${JSON.stringify(g.gallery)}, d)); }
      catch(e){ return JSON.stringify({err:String(e&&e.message||e)}); }
    })()`;
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    let recs; try { recs = JSON.parse(r.result.value); } catch { recs = { err: 'parse ' + r.result.value?.slice(0, 120) }; }
    if (recs.err) { console.log(g.gallery.padEnd(9), 'ERROR:', recs.err); failures.push(g.gallery); continue; }
    if (recs.unrecovered) console.warn(g.gallery.padEnd(9), `WARN: ${recs.unrecovered} rule(s) still serialize an empty value (not recoverable from source text)`);
    if (recs.records) { Object.assign(initializers, recs.initializers || {}); recs = recs.records; }
    if (!recs.length) { console.log(g.gallery.padEnd(9), 'ERROR: 0 effects extracted'); failures.push(g.gallery); continue; }
    const sig = sigOf(recs);
    if (sig === prevSig) {
      console.log(g.gallery.padEnd(9), `ERROR: stale frame — byte-identical to "${prevGallery}" (navigation did not take)`);
      failures.push(g.gallery); prevSig = sig; prevGallery = g.gallery; continue;
    }
    prevSig = sig; prevGallery = g.gallery;
    recs.forEach(x => { x.galleryTitle = g.title; });
    byGallery[g.gallery] = { title: g.title, count: recs.length, effects: recs };
    all.push(...recs);
    console.log(g.gallery.padEnd(9), String(recs.length).padStart(4), 'effects');
  }

  if (failures.length) {
    // Throw rather than process.exit() so the finally block still kills Chrome.
    console.error('\nRefusing to write a partial catalog. manifest.json / index.json are unchanged.');
    throw new Error(`${failures.length} of ${GALLERIES.length} galleries did not extract: ${failures.join(', ')}`);
  }

  // Reuse the same tokens + usage blocks as the original manifest (kept identical).
  const tokens = {
    css: ':root{--bg:#0b0e17;--panel:#121623;--panel2:#171d2e;--card:#141b2b;--line:#243049;'
      + '--ink:#eaf1f9;--muted:#8593a8;--dim:#5b6678;'
      + '--crit:#c879ff;--crit-rgb:200,121,255;--neg:#f85149;--neg-rgb:248,81,73;'
      + '--warn:#e0a52b;--warn-rgb:224,165,43;--pos:#3fb950;--pos-rgb:63,185,80;'
      + '--info:#4493f8;--info-rgb:68,147,248;--accent:#ff9900;--accent-rgb:255,153,0;'
      + '--cardgrad:linear-gradient(157deg,rgba(255,255,255,.05),rgba(255,255,255,0) 55%)}'
      + '.c-crit{--c:var(--crit);--c-rgb:200,121,255}.c-neg{--c:var(--neg);--c-rgb:248,81,73}'
      + '.c-warn{--c:var(--warn);--c-rgb:224,165,43}.c-pos{--c:var(--pos);--c-rgb:63,185,80}'
      + '.c-info{--c:var(--info);--c-rgb:68,147,248}.c-accent{--c:var(--accent);--c-rgb:255,153,0}',
    note: 'Include once globally. Effects read --c/--c-rgb for color and --bg/--ink/etc for theming.',
  };

  // Merge git-derived dates (catalog/_facet_dates.mjs) so agents can ask "what is new
  // since <date>" without the hand-applied is-new / is-fixed badges.
  try {
    const datesPath = resolve(HERE, 'facet-dates.json');
    if (existsSync(datesPath)) {
      const dates = JSON.parse(readFileSync(datesPath, 'utf8')).facets || {};
      let hit = 0;
      for (const r of all) { const d = dates[r.id]; if (d) { r.addedOn = d.added; r.updatedOn = d.updated; r.author = d.author || null; hit++; } else { r.addedOn = null; r.updatedOn = null; r.author = null; } }
      console.log(`dates merged for ${hit}/${all.length} facets (facet-dates.json)`);
    }
  } catch (e) { console.warn('facet-dates merge skipped:', e.message); }
  const manifest = {
    name: 'prism-effects', version: '1.0.0', generated: 'EXTRACTOR_RUN',
    description: 'Catalog of offline, self-contained CSS/SVG animations, effects, components and backdrops, structured for programmatic composition (e.g. an MCP server).',
    galleries: Object.keys(byGallery).map(k => ({ id: k, title: byGallery[k].title, count: byGallery[k].count })),
    categories: [...new Set(all.map(r => r.gallery + ' / ' + r.category))],
    tokens,
    usage: {
      compose: 'To use an effect: ensure tokens.css is present once globally; insert effect.html; include effect.css; if effect.needsJs, run initializers[effect.needsJs].js once after insertion.',
      recolor: 'If params.color is present, set --c and --c-rgb (or add a c-* class) on the effect element to recolor it.',
      markers: 'tags include "new" for latest-release facets and "updated"/"fixed" for repaired/refreshed facets (blue UPDATED badge in the UI).',
    },
    count: all.length,
    initializers,
    effects: all,
  };
  // Last line of defence before overwriting the catalog. The #prism-catalog island in
  // Prism.html is the source of truth, so a healthy extraction can only ever match or
  // exceed its effect count (new facets get spliced into Prism.html first, then
  // extracted). A drop means a gallery came back short — set PRISM_ALLOW_SHRINK=1 to
  // write anyway when facets were genuinely deleted on purpose.
  const islandCount = (() => {
    try {
      const html = readFileSync(TARGET, 'utf8');
      const open = '<script type="application/json" id="prism-catalog">';
      const s = html.indexOf(open); if (s < 0) return null;
      const raw = html.slice(s + open.length, html.indexOf('</script', s + open.length))
        .split('<\\/script').join('</script');
      const c = JSON.parse(raw);
      return Array.isArray(c.effects) ? c.effects.length : (c.count ?? null);
    } catch { return null; }
  })();
  if (islandCount != null && all.length < islandCount && !process.env.PRISM_ALLOW_SHRINK) {
    console.error('\nRefusing to write. manifest.json / index.json are unchanged.');
    console.error('Per-gallery counts above show which one came back short.'
      + ' Set PRISM_ALLOW_SHRINK=1 only if facets were deliberately removed.');
    throw new Error(`extracted ${all.length} effects but the Prism.html island has ${islandCount}`
      + ` — ${islandCount - all.length} would be lost`);
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(OUT + '/manifest.json', JSON.stringify(manifest, null, 2));
  const index = all.map(r => ({ id: r.id, name: r.name, gallery: r.gallery, category: r.category, ref: r.ref, classes: r.classes, params: Object.keys(r.params), tags: r.tags, componentType: r.componentType, interaction: r.interaction, spectrum: r.spectrum, usableAsBackground: r.usableAsBackground, needsJs: r.needsJs, isNew: r.isNew, isFixed: r.isFixed, addedOn: r.addedOn || null, updatedOn: r.updatedOn || null, author: r.author || null, description: r.description }));
  writeFileSync(OUT + '/index.json', JSON.stringify({ count: index.length, effects: index }, null, 2));
  console.log(`\nTOTAL ${all.length} effects → manifest.json (+ index.json)`);
} catch (e) {
  // Exit non-zero: this used to fall through to a 0 status, so a crashed extraction
  // looked like a success to anything chaining `&& node catalog/_embed-catalog.mjs`.
  console.error('EXTRACT FAILED:', e.message);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch {}
  await closeBrowser(PORT, proc);
}
