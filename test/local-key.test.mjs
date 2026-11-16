import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canSetLocalKey, createStaticServer } from '../src/runtime/static-server.mjs';

const KEY = `AIza${'k'.repeat(35)}`;
const req = (host, origin, address = '127.0.0.1') => ({ socket: { remoteAddress: address }, headers: { host, ...(origin ? { origin } : {}) } });

test('only the studio on your own computer may save a key', () => {
  assert.equal(canSetLocalKey(req('localhost:4173', 'http://localhost:4173'), {}), true);
  assert.equal(canSetLocalKey(req('127.0.0.1:4173'), {}), true);
  assert.equal(canSetLocalKey(req('localhost:4173', 'https://evil.example'), {}), false, 'other sites cannot post');
  assert.equal(canSetLocalKey(req('evil.example:4173'), {}), false, 'DNS rebinding host is refused');
  assert.equal(canSetLocalKey(req('localhost:4173', null, '192.168.1.20'), {}), false, 'other computers are refused');
  assert.equal(canSetLocalKey(req('localhost:4173'), { NODE_ENV: 'production' }), false, 'hosted deployments never allow it');
  assert.equal(canSetLocalKey(req('localhost:4173'), { RENDER: 'true' }), false);
});

test('saving a key from the studio writes .env and switches the AI on without a restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fold-localkey-'));
  const saved = { key: process.env.GEMINI_API_KEY, keys: process.env.GEMINI_API_KEYS, dir: process.env.FOLD_ENV_DIR, env: process.env.NODE_ENV };
  delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEYS; delete process.env.NODE_ENV;
  process.env.FOLD_ENV_DIR = dir;
  const server = await createStaticServer({ root: path.resolve('public'), host: '127.0.0.1', port: 0 });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const before = await (await fetch(`${base}/api/engine`)).json();
    assert.equal(before.localKeySetup, true);
    assert.equal(before.engine.gemini.configured, false);
    const bad = await fetch(`${base}/api/local/gemini-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'nope' }) });
    assert.equal(bad.status, 400);
    const ok = await fetch(`${base}/api/local/gemini-key`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ key: ` "${KEY}" ` }) });
    const body = await ok.json();
    assert.equal(ok.status, 200, JSON.stringify(body));
    assert.equal(body.key, 'AIza…kkkk');
    assert.equal(body.engine.gemini.configured, true);
    assert.equal(await readFile(path.join(dir, '.env'), 'utf8'), `GEMINI_API_KEY=${KEY}\n`);
    const aq = 'AQ.Ab8RN6Lx_example-Key.part2_abc123XYZ';
    const okAq = await fetch(`${base}/api/local/gemini-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: aq }) });
    assert.equal(okAq.status, 200, 'new AQ. keys (with dots) are accepted');
    assert.equal(await readFile(path.join(dir, '.env'), 'utf8'), `GEMINI_API_KEY=${aq}\n`);
    const after = await (await fetch(`${base}/api/engine`)).json();
    assert.equal(after.engine.gemini.configured, true, 'live without restart');
  } finally {
    await server.close();
    for (const [name, value] of [['GEMINI_API_KEY', saved.key], ['GEMINI_API_KEYS', saved.keys], ['FOLD_ENV_DIR', saved.dir], ['NODE_ENV', saved.env]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
