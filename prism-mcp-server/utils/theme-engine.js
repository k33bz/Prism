// The theme derivation engine for the MCP: derives contrast-safe token palettes
// (catalog/theme-engine/derive.mjs) and checks token maps against the contrast floors.
//
// The engine is found beside the catalog the server was pointed at, the same way
// utils/diagrams.js finds the AWS kit: catalog/theme-engine/ next to Prism.html, or
// theme-engine/ next to catalog/manifest.json. It is imported on first use (plain ES
// modules, no dependencies), so the server stays dependency-free.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** The engine directory that belongs with a catalog file, or null when there is none. */
export function engineDir(catalogPath) {
  const dir = path.dirname(path.resolve(catalogPath));
  for (const d of [path.join(dir, 'theme-engine'), path.join(dir, 'catalog', 'theme-engine')]) {
    if (fs.existsSync(path.join(d, 'derive.mjs')) && fs.existsSync(path.join(d, 'color.mjs'))) return d;
  }
  return null;
}

const cache = new Map();

/** Import the engine: { dir, derive (deriveTheme, checkContrast, rootCss, ...) }, or null when not found. */
export async function loadEngine(catalogPath) {
  const dir = engineDir(catalogPath);
  if (!dir) return null;
  if (!cache.has(dir)) {
    cache.set(dir, import(pathToFileURL(path.join(dir, 'derive.mjs')).href).then((derive) => ({ dir, derive })));
  }
  try {
    return await cache.get(dir);
  } catch (err) {
    cache.delete(dir);
    throw err;
  }
}
