import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isStudioRunning, loadEnvFile, parseEnv } from '../scripts/launch-studio.mjs';
import { createStaticServer } from '../src/runtime/static-server.mjs';

test('.env files are read without overriding settings that are already set', async () => {
  assert.deepEqual(parseEnv('# key\nGEMINI_API_KEY="abc"\nexport PORT=5000\n\nBAD LINE\nEMPTY='), { GEMINI_API_KEY: 'abc', PORT: '5000', EMPTY: '' });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fold-env-'));
  try {
    await writeFile(path.join(dir, '.env'), 'A=from-file\nB=from-file\n');
    const env = { A: 'already-set' };
    assert.equal(loadEnvFile(path.join(dir, '.env'), env), true);
    assert.deepEqual(env, { A: 'already-set', B: 'from-file' });
    assert.equal(loadEnvFile(path.join(dir, 'missing.env'), env), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function launch(port) {
  return spawn(process.execPath, ['scripts/launch-studio.mjs', '--no-open'], { env: { ...process.env, PORT: String(port), GEMINI_API_KEY: process.env.GEMINI_API_KEY || '' }, stdio: ['ignore', 'pipe', 'pipe'] });
}
const output = (child, until, ms = 60_000) => new Promise((resolve, reject) => {
  let text = '';
  const timer = setTimeout(() => reject(new Error(`timed out; output so far: ${text}`)), ms);
  const on = (d) => { text += d; if (until.test(text)) { clearTimeout(timer); resolve(text); } };
  child.stdout.on('data', on); child.stderr.on('data', on);
  child.on('exit', () => { clearTimeout(timer); resolve(text); });
});

test('the launcher starts the studio on this computer and reports where it is', { timeout: 90_000 }, async () => {
  const port = 41000 + Math.floor(Math.random() * 2000);
  const child = launch(port);
  try {
    const text = await output(child, /FOLD Motion is open at/);
    assert.match(text, new RegExp(`FOLD Motion is open at http://localhost:${port}`));
    assert.equal(await isStudioRunning(`http://localhost:${port}`), true);
  } finally { child.kill('SIGINT'); await new Promise((r) => child.once('exit', r)); }
});

test('launching again while the studio runs opens the running one instead of a second copy', { timeout: 30_000 }, async () => {
  const server = await createStaticServer({ root: path.resolve('public'), host: '127.0.0.1', port: 0 });
  try {
    assert.equal(await isStudioRunning(`http://localhost:${server.port}`), true);
    const text = await output(launch(server.port), /already running/);
    assert.match(text, /already running/);
  } finally { await server.close(); }
  assert.equal(await isStudioRunning('http://localhost:9'), false);
});

test('double-click launchers exist for Windows and Mac and both run the shared launcher', async () => {
  const cmd = await readFile('Start FOLD Motion.cmd', 'utf8'); const mac = await readFile('Start FOLD Motion.command', 'utf8');
  assert.ok(cmd.includes('node scripts\\launch-studio.mjs') && cmd.includes('\r\n'), 'Windows: CRLF batch file');
  assert.ok(mac.startsWith('#!/bin/bash') && mac.includes('node scripts/launch-studio.mjs'));
  assert.ok((await stat('Start FOLD Motion.command')).mode & 0o111, 'Mac launcher is executable');
  assert.match(cmd, /nodejs\.org/); assert.match(mac, /nodejs\.org/);
});
