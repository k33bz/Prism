/* ============================================================================
   Re-render the theme packs' generated facets after a generator change.
   ----------------------------------------------------------------------------
   _merge_spectrum.mjs only adds a family. When _gen_system.mjs changes, the
   packs already in Prism.html need the new output. This runs the generator at
   <ref> (the version the page was built with) and the working copy for every
   theme pack in systems.json, then swaps old for new inside the pg-spectrums
   template: the pack's CSS block and each changed tile, every swap matched
   exactly once (or nothing is written). Everything else stays byte-identical.

   Usage:  node catalog/_regen_packs.mjs <ref> [--only ds,ds] [--dry]
           ref = the commit whose _gen_system.mjs produced the page's packs
   Honors PRISM_HTML. Then: commit, _facet_dates, extract, splice spectrums,
   embed, and the gates (_check_ds, _check_themes, smoke), as for any pack change.

   Zero deps.
   ========================================================================== */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const HTML = process.env.PRISM_HTML ? path.resolve(process.env.PRISM_HTML) : path.join(REPO, 'Prism.html');
const args = process.argv.slice(2);
const ref = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--only');
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? new Set(String(args[onlyAt + 1] || '').split(',').filter(Boolean)) : null;
const dry = args.includes('--dry');
if (!ref) { console.error('Usage: node catalog/_regen_packs.mjs <ref> [--only ds,ds] [--dry]   (honors PRISM_HTML)'); process.exit(1); }

// the old generator runs from catalog/ so its relative imports resolve as they did
const oldGen = path.join(HERE, `_gen_system.regen-${process.pid}.mjs`);
fs.writeFileSync(oldGen, execFileSync('git', ['show', `${ref}:catalog/_gen_system.mjs`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 }));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-regen-'));
const gen = (script, profile, out) => {
  execFileSync(process.execPath, [script, profile, out], { cwd: REPO, stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
};
// _merge_spectrum escapes </script> inside the text/html template and writes the file's line endings
const escScript = (s) => s.replace(/<\/script\s*>/gi, '<\\/script>');

let html = fs.readFileSync(HTML, 'utf8');
const EOL = html.includes('\r\n') ? '\r\n' : '\n';
const fix = (s) => escScript(EOL === '\r\n' ? s.replace(/\r?\n/g, '\r\n') : s);
const TPL = '<script type="text/html" id="pg-spectrums">';
const a = html.indexOf(TPL);
if (a < 0) { console.error('Could not find the pg-spectrums template.'); process.exit(1); }
const b = html.indexOf('</script>', a);
let slice = html.slice(a, b);
const swap = (from, to, what) => {
  const n = slice.split(from).length - 1;
  if (n !== 1) throw new Error(`${what}: the old markup matched ${n} times in pg-spectrums (need exactly 1); was the page built with ${ref}?`);
  slice = slice.replace(from, () => to);   // a function, so $-sequences stay literal
};

const packs = JSON.parse(fs.readFileSync(path.join(HERE, 'systems.json'), 'utf8')).themePack.map((p) => p.dsShort).filter((ds) => !only || only.has(ds));
let tiles = 0, css = 0;
try {
  for (const ds of packs) {
    const profile = path.join(HERE, 'profiles', `${ds}.mjs`);
    const o = gen(oldGen, profile, path.join(tmp, `${ds}.old.json`));
    const n = gen(path.join(HERE, '_gen_system.mjs'), profile, path.join(tmp, `${ds}.new.json`));
    if (o.tiles.length !== n.tiles.length) throw new Error(`${ds}: the tile count changed (${o.tiles.length} -> ${n.tiles.length}); re-merge the family instead`);
    let changed = 0;
    if (o.css !== n.css) { swap(fix(o.css), fix(n.css), `${ds} css`); css++; }
    o.tiles.forEach((t, i) => { if (t !== n.tiles[i]) { swap(fix(t), fix(n.tiles[i]), `${ds} tile ${i}`); changed++; } });
    tiles += changed;
    console.log(`${ds.padEnd(14)} css ${o.css === n.css ? 'same   ' : 'swapped'}  ${changed} tile(s)`);
  }
} catch (err) {
  console.error(err.message);   // nothing has been written
  process.exitCode = 1;
} finally {
  fs.rmSync(oldGen, { force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (process.exitCode) process.exit();
if (dry) { console.log(`dry run: ${packs.length} pack(s), ${css} css block(s), ${tiles} tile(s) would change`); process.exit(0); }
fs.writeFileSync(HTML, html.slice(0, a) + slice + html.slice(b));
console.log(`${packs.length} pack(s): ${css} css block(s) and ${tiles} tile(s) re-rendered in ${HTML}`);
