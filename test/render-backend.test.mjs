import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import render from '../api/render.js';
import renderJob from '../api/render-job.js';
import output from '../api/output.js';
import engine from '../api/engine.js';
import { renderBackendUrl } from '../api/_render-backend.js';

function createResponse() {
  return {
    headers: {}, statusCode: 200, body: undefined, redirectedTo: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    redirect(code, url) { this.statusCode = code; this.redirectedTo = url; return this; },
    end() { return this; },
  };
}

async function withBackend(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.RENDER_BACKEND_URL;
  process.env.RENDER_BACKEND_URL = `http://127.0.0.1:${server.address().port}/`;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.RENDER_BACKEND_URL;
    else process.env.RENDER_BACKEND_URL = previous;
    await new Promise((resolve) => server.close(resolve));
  }
}

test('RENDER_BACKEND_URL accepts https origins and rejects plain http outside localhost', () => {
  assert.equal(renderBackendUrl({ RENDER_BACKEND_URL: 'https://fold.onrender.com/' }), 'https://fold.onrender.com');
  assert.equal(renderBackendUrl({ RENDER_BACKEND_URL: 'http://fold.onrender.com' }), null);
  assert.equal(renderBackendUrl({ RENDER_BACKEND_URL: 'not a url' }), null);
  assert.equal(renderBackendUrl({}), null);
});

test('with a render backend, Vercel queues the render there with the caller’s sign-in', async () => {
  let seen;
  await withBackend((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      seen = { method: request.method, url: request.url, auth: request.headers.authorization, body: JSON.parse(raw) };
      response.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: true, jobId: 'abc-123' }));
    });
  }, async () => {
    const response = createResponse();
    await render({ method: 'POST', headers: { authorization: 'Bearer user-token' }, body: { timeline: { id: 'p1' } } }, response);
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.jobId, 'abc-123');
    assert.deepEqual(seen, { method: 'POST', url: '/api/render', auth: 'Bearer user-token', body: { timeline: { id: 'p1' }, async: true } });
  });
});

test('with a render backend, job status is passed through and ids are validated', async () => {
  await withBackend((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: true, status: 'rendering', path: request.url }));
  }, async () => {
    const ok = createResponse();
    await renderJob({ method: 'GET', headers: {}, query: { id: '0f8b3c1e-aaaa-bbbb-cccc-123456789abc' } }, ok);
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body.path, '/api/render/jobs/0f8b3c1e-aaaa-bbbb-cccc-123456789abc');

    const bad = createResponse();
    await renderJob({ method: 'GET', headers: {}, query: { id: '../secrets' } }, bad);
    assert.equal(bad.statusCode, 400);
  });
});

test('with a render backend, the engine reports rendering available and output links redirect there', async () => {
  await withBackend((request, response) => response.writeHead(200).end('{}'), async () => {
    const info = createResponse();
    await engine({ method: 'GET' }, info);
    assert.equal(info.body.render.available, true);

    const film = createResponse();
    output({ method: 'GET', query: { path: 'p1/run-1/production.mp4' } }, film);
    assert.equal(film.statusCode, 307);
    assert.match(film.redirectedTo, /^http:\/\/127\.0\.0\.1:\d+\/output\/p1\/run-1\/production\.mp4$/);

    const escape = createResponse();
    output({ method: 'GET', query: { path: '../etc/passwd' } }, escape);
    assert.equal(escape.statusCode, 404);
  });
});

test('an unreachable render backend gives a readable error instead of hanging', async () => {
  const previous = process.env.RENDER_BACKEND_URL;
  process.env.RENDER_BACKEND_URL = 'http://127.0.0.1:1';
  try {
    const response = createResponse();
    await render({ method: 'POST', headers: {}, body: { timeline: {} } }, response);
    assert.equal(response.statusCode, 502);
    assert.match(response.body.error, /couldn’t be reached/);
  } finally {
    if (previous === undefined) delete process.env.RENDER_BACKEND_URL;
    else process.env.RENDER_BACKEND_URL = previous;
  }
});
