// png: a diagram frame as a PNG, for slides, documents and chat, drawn by headless Chrome or Edge
// (k33bz fork). No deps beyond a Chromium-family browser (catalog/_chrome.mjs finds one, or set
// PRISM_CHROME). The kit draws the frame (frame.mjs); the browser only rasterizes it.
//
//   import { toPng } from './png.mjs';
//   const { png, width, height } = await toPng(spec, { at: 'poster', theme: 'light', scale: 2 });
//
// CLI: node catalog/aws-kit/png.mjs <family spec> <diagram id> [--at 0.5|poster] [--theme light|dark]
//        [--scale 2] --out file.png
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveChrome } from '../_chrome.mjs';
import { frame } from './frame.mjs';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Rasterize a standalone svg document (its width and height set the size) at a device scale. */
export async function svgToPng(svg, { scale = 2, timeoutMs = 60000, browser } = {}) {
  const m = /^<svg\b[^>]*?\swidth="([\d.]+)"[^>]*?\sheight="([\d.]+)"/.exec(svg);
  if (!m) throw new Error('png: the svg needs width and height on its root (a standalone export)');
  if (!(scale > 0 && scale <= 4)) throw new Error('png: scale must be above 0 and at most 4');
  const W = Math.ceil(Number(m[1])), H = Math.ceil(Number(m[2]));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-png-'));
  const src = path.join(dir, 'frame.svg'), out = path.join(dir, 'frame.png');
  fs.writeFileSync(src, svg);
  // a fresh profile per shot: a browser still holding a profile takes the job over and writes nothing
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${path.join(dir, 'profile')}`, `--force-device-scale-factor=${scale}`, `--window-size=${W},${H}`,
    '--virtual-time-budget=300', `--screenshot=${out}`, pathToFileURL(src).href];
  const proc = spawn(browser || resolveChrome(), args, { stdio: 'ignore', windowsHide: true });
  const failed = new Promise((_, reject) => proc.once('error', reject));
  try {
    // the browser can exit before the file lands: poll for a complete PNG
    const until = Date.now() + timeoutMs;
    for (;;) {
      await Promise.race([sleep(150), failed]);
      if (fs.existsSync(out)) {
        const buf = fs.readFileSync(out);
        if (buf.length > 33 && buf.subarray(0, 8).equals(SIG) && buf.subarray(-8, -4).toString('latin1') === 'IEND') {
          return { png: buf, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
        }
      }
      if (Date.now() > until) throw new Error(`png: the browser wrote no image in ${Math.round(timeoutMs / 1000)} s`);
    }
  } finally {
    if (proc.exitCode == null) try { proc.kill(); } catch {}
    // the browser may hold profile files for a moment after it exits
    for (let i = 0; i < 10; i++) { try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch { await sleep(200); } }
  }
}

/** A diagram at a moment (frame.mjs: a fraction of the clock or 'poster'), as a PNG. Light by default. */
export async function toPng(spec, { at = 'poster', theme = 'light', scale = 2, ...rest } = {}) {
  return svgToPng(frame(spec, at, { theme }), { scale, ...rest });
}

// ---- CLI ----
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [specPath, id, ...rest] = process.argv.slice(2);
  const opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  if (!specPath || !id || !opt('--out')) { console.error('usage: png.mjs <family spec> <diagram id> [--at 0.5|poster] [--theme light|dark] [--scale 2] --out file.png'); process.exit(1); }
  const mod = /\.json$/i.test(specPath) ? JSON.parse(fs.readFileSync(specPath, 'utf8')) : (await import(pathToFileURL(path.resolve(specPath)).href)).default;
  const d = mod.diagrams.find((x) => x.id === id || 'aws-' + x.id === id);
  if (!d) { console.error(`no diagram ${id} in ${specPath}`); process.exit(1); }
  const { png, width, height } = await toPng(d, { at: opt('--at') || 'poster', theme: opt('--theme') || 'light', scale: Number(opt('--scale') || 2) });
  fs.writeFileSync(opt('--out'), png);
  console.log(`${opt('--out')}: ${width}x${height}`);
}
