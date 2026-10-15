import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStaticServer, resolveStaticPath } from '../src/runtime/static-server.mjs';
import { createProject } from '../src/orchestrator/project-state.mjs';

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
    assert.match(html, /id="recent-project-list"/);
    assert.match(html, /id="telemetry-panel" class="telemetry-panel panel minimized"/);
    assert.match(html, /id="telemetry-toggle-btn"/);
    assert.match(html, /id="telemetry-logs"/);
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

test('POST /api/generate begins with a validated storyboard and acceptance criteria', async () => {
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
    assert.equal(result.action, 'storyboard');
    assert.equal(result.provider, 'mock-provider');
    assert.ok(result.storyboard.shots.length >= 2);
    assert.equal(result.acceptance.technicalRequirements.width, 1920);
    assert.equal(result.acceptance.technicalRequirements.height, 1080);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('local generation API compiles storyboard shots into a continuous timeline', async () => {
  const server = await createStaticServer({ root: path.resolve('public') });
  const endpoint = `http://${server.host}:${server.port}/api/generate`;

  try {
    const planResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'storyboard',
        prompt: 'A product reveal',
        context: { width: 640, height: 360, fps: 24 },
      }),
    });
    const plan = await planResponse.json();
    const compileResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'compile',
        storyboard: plan.storyboard,
        context: { width: 640, height: 360, fps: 24 },
      }),
    });
    const compiled = await compileResponse.json();

    assert.equal(compileResponse.status, 200);
    assert.equal(compiled.timeline.shots.length, plan.storyboard.shots.length);
    assert.equal(compiled.timeline.totalFrames, 192);
    assert.equal(compiled.timeline.shots[1].startFrame, compiled.timeline.shots[0].endFrame + 1);
  } finally {
    await server.close();
  }
});

test('local state API rejects unverified state skips and accepts the submitted brief', async () => {
  const server = await createStaticServer({ root: path.resolve('public') });
  const endpoint = `http://${server.host}:${server.port}/api/state`;
  const project = createProject({ id: 'state-test', brief: 'A title reveal' });

  try {
    const skipped = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, nextState: 'BUILDING' }),
    });
    assert.equal(skipped.status, 400);

    const accepted = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, nextState: 'PLANNING' }),
    });
    const result = await accepted.json();
    assert.equal(accepted.status, 200);
    assert.equal(result.project.state, 'PLANNING');
  } finally {
    await server.close();
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

    const badCompile = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'compile', storyboard: {} }),
    });
    assert.equal(badCompile.status, 400);

    const badRender = await fetch(`http://${server.host}:${server.port}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeline: {} }),
    });
    assert.equal(badRender.status, 400);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
