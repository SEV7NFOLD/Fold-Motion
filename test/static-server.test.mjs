import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStaticServer, resolveStaticPath } from '../src/runtime/static-server.mjs';

test('maps preview URLs beneath the configured root and rejects traversal', () => {
  const root = path.resolve('public');

  assert.equal(resolveStaticPath(root, '/'), path.join(root, 'index.html'));
  assert.equal(resolveStaticPath(root, '/scene-01.html'), path.join(root, 'scene-01.html'));
  assert.equal(resolveStaticPath(root, '/..%2Fpackage.json'), null);
});

test('serves the studio entry point at the site root', async () => {
  const root = path.resolve('public');
  const server = await createStaticServer({ root });

  try {
    const response = await fetch(`http://${server.host}:${server.port}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html;/);
    assert.match(html, /FOLD Motion — Studio/);
    assert.match(html, /studio\.js/);
  } finally {
    await server.close();
  }
});

test('serves JavaScript module files with a browser-compatible MIME type', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fold-motion-static-'));
  const moduleContents = 'export const ready = true;';
  await writeFile(path.join(root, 'scene.mjs'), moduleContents);
  const server = await createStaticServer({ root });

  try {
    const response = await fetch(`http://${server.host}:${server.port}/scene.mjs`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/javascript;/);
    assert.equal(await response.text(), moduleContents);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('POST /api/generate returns a validated scene specification', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fold-motion-generate-'));
  const server = await createStaticServer({ root });

  try {
    const response = await fetch(`http://${server.host}:${server.port}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Kinetic typography intro',
        context: { width: 1920, height: 1080, fps: 30 },
      }),
    });
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.success, true);
    assert.equal(result.provider, 'mock-provider');
    assert.equal(result.spec.promptSource, 'Kinetic typography intro');
    assert.equal(result.spec.width, 1920);
    assert.equal(result.spec.height, 1080);
    assert.ok(Number.isFinite(Date.parse(result.validatedAt)));
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('POST /api/generate rejects invalid requests with client errors', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fold-motion-generate-invalid-'));
  const server = await createStaticServer({ root });
  const endpoint = `http://${server.host}:${server.port}/api/generate`;

  try {
    const missingPrompt = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '  ' }),
    });
    assert.equal(missingPrompt.status, 400);
    assert.match((await missingPrompt.json()).error, /valid text prompt/);

    const invalidContext = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Scene', context: 'wide' }),
    });
    assert.equal(invalidContext.status, 400);
    assert.match((await invalidContext.json()).error, /Context must be a JSON object/);

    const malformedJson = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(malformedJson.status, 400);
    assert.match((await malformedJson.json()).error, /valid JSON/);

    const wrongContentType = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{"prompt":"Scene"}',
    });
    assert.equal(wrongContentType.status, 415);

    const wrongMethod = await fetch(endpoint);
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'POST');
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
