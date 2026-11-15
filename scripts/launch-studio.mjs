#!/usr/bin/env node
/**
 * One-click FOLD Motion studio on your own computer (`Start FOLD Motion.cmd` on
 * Windows, `Start FOLD Motion.command` on Mac, or `npm run studio`).
 *
 * - First run: installs the packages and the headless browser launch films need,
 *   and asks once for a Gemini API key, saved to .env (git-ignored).
 * - Every run: loads .env, starts the studio, and opens it in the browser.
 * - Already running: opens the studio instead of starting a second copy.
 * Keep the window open while you work; closing it stops the studio.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WINDOWS = process.platform === 'win32';

import {
  cleanApiKey, loadProjectEnv, looksLikeGeminiKey, maskKey, saveGeminiKey,
} from '../src/runtime/env-file.mjs';

// Kept as exports of this script for existing callers and tests.
export { loadEnvFile, parseEnv } from '../src/runtime/env-file.mjs';

/** Whether a FOLD Motion studio already answers at this address. */
export async function isStudioRunning(url) {
  try {
    const response = await fetch(`${url}/api/engine`, { signal: AbortSignal.timeout(1500) });
    return response.ok && (await response.json()).success === true;
  } catch {
    return false;
  }
}

async function waitForStudio(url, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await isStudioRunning(url)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function openBrowser(url) {
  const [command, args] = WINDOWS ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).unref();
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', shell: WINDOWS });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

async function main() {
  const open = !process.argv.includes('--no-open');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    console.error(`FOLD Motion needs Node.js 20 or newer (this computer has ${process.versions.node}). Install the LTS version from https://nodejs.org and try again.`);
    process.exit(1);
  }
  const envFile = loadProjectEnv(ROOT);
  if (envFile && path.basename(envFile) !== '.env') {
    console.log(`Using settings from ${path.basename(envFile)} (Notepad added ".txt"; that's fine).`);
  }
  const port = Number(process.env.PORT) || 4173;
  const url = `http://localhost:${port}`;

  if (await isStudioRunning(url)) {
    console.log(`FOLD Motion is already running at ${url}. Opening it.`);
    const running = await fetch(`${url}/api/engine`).then((r) => r.json()).catch(() => null);
    if (process.env.GEMINI_API_KEY && running?.engine?.gemini && running.engine.gemini.configured === false) {
      console.log('\nThat copy was started before your Gemini key was added, so it has no key.');
      console.log('Close the other FOLD Motion window (or restart your computer), then double-click Start FOLD Motion again.\n');
    }
    if (open) openBrowser(url);
    return;
  }

  if (!existsSync(path.join(ROOT, 'node_modules'))) {
    console.log('First run: installing FOLD Motion. This takes a few minutes, once.');
    // --prefer-offline reuses packages already in this PC's npm cache, so a fresh copy
    // of the project installs with little or no download.
    if (!(await run('npm', ['install', '--prefer-offline', '--no-audit', '--no-fund']))) { console.error('Installing failed. Check your internet connection and try again.'); process.exit(1); }
  }

  // Launch films render in a headless browser; install it once if it's missing.
  const { checkBrowserRenderer } = await import('../src/browser/render-browser.mjs');
  if (!(await checkBrowserRenderer()).available) {
    console.log('Installing the browser that renders launch films (once)…');
    if (!(await run('npx', ['playwright', 'install', 'chromium']))) console.warn('The browser could not be installed; classic films still work, launch films won’t render until it is.');
  }

  // A Gemini key lets the AI plan films; without one, the offline planner is used.
  // Asked again on every start until a key is set (press Enter to skip for now).
  const settingsFile = envFile || path.join(ROOT, '.env');
  if (!cleanApiKey(process.env.GEMINI_API_KEY) && process.stdin.isTTY) {
    console.log('\nNo Gemini API key yet. Get one free at https://aistudio.google.com/apikey');
    console.log('To paste in this window: right-click (or press Ctrl+V), then press Enter.');
    const ask = readline.createInterface({ input: process.stdin, output: process.stdout });
    const key = cleanApiKey(await ask.question('Gemini API key (or press Enter to skip): '));
    ask.close();
    if (key) {
      saveGeminiKey(settingsFile, key);
      process.env.GEMINI_API_KEY = key;
      console.log(`Saved to ${path.basename(settingsFile)} on this computer only (${maskKey(key)}).`);
      if (!looksLikeGeminiKey(key)) console.warn('Heads-up: that doesn\u2019t look like a usual Gemini key (they start with "AIza" and are 39 characters). If AI planning fails, paste it again.');
    } else {
      console.log('Skipped: films will use the offline planner. You can add the key next time you start.');
    }
  } else if (process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = cleanApiKey(process.env.GEMINI_API_KEY);
    console.log(`Gemini key found (${maskKey(process.env.GEMINI_API_KEY)}): AI planning is on.`);
  }

  // Local only: the studio listens on this computer, not the network.
  const server = spawn(process.execPath, [path.join(ROOT, 'src', 'server.mjs')], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, HOST: process.env.HOST || '127.0.0.1', PORT: String(port) },
  });
  const stop = () => { server.kill('SIGINT'); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  server.on('exit', (code) => process.exit(code ?? 0));

  if (await waitForStudio(url)) {
    console.log(`\nFOLD Motion is open at ${url}\nKeep this window open while you work. Close it to stop the studio.\n`);
    if (open) openBrowser(url);
  } else {
    console.error('The studio didn’t start. The messages above say why.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
