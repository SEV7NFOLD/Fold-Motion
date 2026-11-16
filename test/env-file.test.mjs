import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  cleanApiKey, decodeEnvBytes, loadProjectEnv, looksLikeGeminiKey, maskKey, parseEnv, saveGeminiKey,
} from '../src/runtime/env-file.mjs';

const KEY = `AIza${'x'.repeat(35)}`;

test('.env files saved by Windows editors still load', () => {
  const text = `GEMINI_API_KEY = "${KEY}"  \r\n`;
  assert.equal(parseEnv(decodeEnvBytes(Buffer.from(`﻿${text}`, 'utf8'))).GEMINI_API_KEY, KEY, 'UTF-8 with BOM, quotes, spaces');
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  assert.equal(parseEnv(decodeEnvBytes(le)).GEMINI_API_KEY, KEY, 'UTF-16 LE with BOM');
  assert.equal(parseEnv(decodeEnvBytes(Buffer.from(text, 'utf16le'))).GEMINI_API_KEY, KEY, 'UTF-16 LE without BOM');
  const be = Buffer.from(Buffer.from(text, 'utf16le')); be.swap16();
  assert.equal(parseEnv(decodeEnvBytes(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).GEMINI_API_KEY, KEY, 'UTF-16 BE with BOM');
  assert.deepEqual(parseEnv('# GEMINI_API_KEY=commented\n'), {}, 'comments stay comments');
});

test('the project settings file is found as .env or as Notepad’s .env.txt', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fold-envfile-'));
  try {
    await writeFile(path.join(dir, '.env.txt'), `GEMINI_API_KEY=${KEY}\n`);
    const env = {};
    assert.equal(path.basename(loadProjectEnv(dir, env)), '.env.txt');
    assert.equal(env.GEMINI_API_KEY, KEY);
    await writeFile(path.join(dir, '.env'), 'GEMINI_API_KEY=from-dot-env\n');
    const env2 = { GEMINI_API_KEY: '' };
    assert.equal(path.basename(loadProjectEnv(dir, env2)), '.env', '.env wins when both exist');
    assert.equal(env2.GEMINI_API_KEY, 'from-dot-env', 'an empty variable is filled from the file');
    const env3 = { GEMINI_API_KEY: 'real-env' };
    loadProjectEnv(dir, env3);
    assert.equal(env3.GEMINI_API_KEY, 'real-env', 'a real environment variable wins');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a pasted key is cleaned and saved over the placeholder, keeping other settings', async () => {
  assert.equal(cleanApiKey(`  GEMINI_API_KEY="${KEY}" \n`), KEY);
  assert.equal(cleanApiKey(`'${KEY}'`), KEY);
  assert.equal(looksLikeGeminiKey(KEY), true);
  assert.equal(looksLikeGeminiKey('AQ.Ab8RN6Lx_example-Key.part2_abc123XYZ'), true, 'new AI Studio Auth keys');
  assert.equal(looksLikeGeminiKey('not-a-key'), false);
  assert.equal(maskKey(KEY), 'AIza…xxxx');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fold-envsave-'));
  try {
    const file = path.join(dir, '.env');
    await writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# Add GEMINI_API_KEY=your-key here to let the AI plan films.\r\nGROQ_API_KEY=g\r\nGEMINI_API_KEY=old\r\n', 'utf16le')]));
    saveGeminiKey(file, KEY);
    const saved = await readFile(file, 'utf8');
    assert.equal(saved, `GEMINI_API_KEY=${KEY}\nGROQ_API_KEY=g\n`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
