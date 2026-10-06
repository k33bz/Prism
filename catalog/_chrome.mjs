/* Cross-platform Chrome/Chromium binary resolver for the CDP tooling (no deps).
   ----------------------------------------------------------------------------
   Every headless-Chrome script in this folder (extract-from-prism, _find_broken,
   _shoot, _shell-shot, _scrollbar-shot) used to hardcode a single OS-specific
   Chrome path, which meant they only ran on whichever machine authored them.
   This module resolves a usable Chromium-family binary at runtime so the same
   pipeline runs on Windows, macOS, and Linux.

   Resolution order:
     1. $PRISM_CHROME — explicit override (any Chromium-family browser). Honored
        even if the file check fails, so users can point at an unusual install.
     2. First existing path from the per-OS candidate list below (Chrome, then
        Chromium, then Edge — all speak the same DevTools protocol).

   Throws a clear, actionable error if nothing is found (tells you to set
   PRISM_CHROME) rather than letting spawn() fail with a cryptic ENOENT. */
import { existsSync } from 'node:fs';
import { platform } from 'node:os';

// Windows install roots vary by 32/64-bit and per-user vs machine-wide installs.
const WIN_ROOTS = [
  process.env['PROGRAMFILES'] || 'C:/Program Files',
  process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)',
  process.env['LOCALAPPDATA'] || (process.env['USERPROFILE'] || 'C:/Users/Default') + '/AppData/Local',
].map(r => r.replace(/\\/g, '/'));

function candidates() {
  const os = platform();
  if (os === 'win32') {
    const out = [];
    for (const root of WIN_ROOTS) {
      out.push(
        root + '/Google/Chrome/Application/chrome.exe',
        root + '/Google/Chrome Beta/Application/chrome.exe',
        root + '/Chromium/Application/chrome.exe',
        root + '/Microsoft/Edge/Application/msedge.exe',
      );
    }
    return out;
  }
  if (os === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  // linux + everything else: rely on well-known absolute paths (PATH lookups are
  // spawn's job, but we want a concrete path so the error message is useful).
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
  ];
}

/** Shut down a headless browser started with --remote-debugging-port=<port>. Asks it to exit over
 *  the browser-level DevTools endpoint (Browser.close takes every child process with it), then
 *  kills the spawned process as a backstop. proc.kill() alone is not enough: on Windows the spawned
 *  launcher is often not the browser process, so each run used to leak ~9 renderer/GPU/utility
 *  processes that stayed alive until they saturated the CPU. */
export async function closeBrowser(port, proc) {
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://localhost:${port}/json/version`)).json();
    await new Promise((resolve) => {
      const ws = new WebSocket(webSocketDebuggerUrl);
      const done = () => { clearTimeout(timer); try { ws.close(); } catch {} resolve(); };
      const timer = setTimeout(done, 3000);
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      ws.onmessage = done;
      ws.onerror = done;
      ws.onclose = done;
    });
  } catch { /* endpoint already gone */ }
  try { proc && proc.kill('SIGKILL'); } catch {}
}

/** Resolve a Chromium-family executable path, or throw with guidance. */
export function resolveChrome() {
  const override = process.env.PRISM_CHROME;
  if (override) return override; // trust the user's explicit choice, checked or not.
  const list = candidates();
  const found = list.find(p => existsSync(p));
  if (found) return found;
  throw new Error(
    'No Chrome/Chromium/Edge binary found. Set the PRISM_CHROME environment ' +
    'variable to your browser executable, e.g.\n' +
    (platform() === 'win32'
      ? '  set PRISM_CHROME="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"'
      : '  export PRISM_CHROME="/path/to/chrome"') +
    '\nLocations checked:\n  ' + list.join('\n  '),
  );
}
