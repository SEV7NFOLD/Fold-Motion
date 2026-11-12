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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WINDOWS = process.platform === 'win32';

/** KEY=value lines from a .env file (comments and blank lines skipped, quotes removed). */
export function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** Loads a .env file into `env` without overriding values that are already set. */
export function loadEnvFile(file, env = process.env) {
  if (!existsSync(file)) return false;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) if (env[key] === undefined) env[key] = value;
  return true;
}

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
  loadEnvFile(path.join(ROOT, '.env'));
  const port = Number(process.env.PORT) || 4173;
  const url = `http://localhost:${port}`;

  if (await isStudioRunning(url)) {
    console.log(`FOLD Motion is already running at ${url}. Opening it.`);
    if (open) openBrowser(url);
    return;
  }

  if (!existsSync(path.join(ROOT, 'node_modules'))) {
    console.log('First run: installing FOLD Motion. This takes a few minutes, once.');
    if (!(await run('npm', ['install']))) { console.error('Installing failed. Check your internet connection and try again.'); process.exit(1); }
  }

  // Launch films render in a headless browser; install it once if it's missing.
  const { checkBrowserRenderer } = await import('../src/browser/render-browser.mjs');
  if (!(await checkBrowserRenderer()).available) {
    console.log('Installing the browser that renders launch films (once)…');
    if (!(await run('npx', ['playwright', 'install', 'chromium']))) console.warn('The browser could not be installed; classic films still work, launch films won’t render until it is.');
  }

  // A Gemini key lets the AI plan films; without one, the offline planner is used.
  const envFile = path.join(ROOT, '.env');
  if (!process.env.GEMINI_API_KEY && !existsSync(envFile) && process.stdin.isTTY) {
    const ask = readline.createInterface({ input: process.stdin, output: process.stdout });
    const key = (await ask.question('Paste your Gemini API key to let the AI plan your films (or press Enter to skip): ')).trim();
    ask.close();
    writeFileSync(envFile, key ? `GEMINI_API_KEY=${key}\n` : '# Add GEMINI_API_KEY=your-key here to let the AI plan films.\n');
    if (key) process.env.GEMINI_API_KEY = key;
    console.log(key ? 'Saved to .env on this computer only.' : 'Skipped: films will use the offline planner. Add your key to .env any time.');
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
