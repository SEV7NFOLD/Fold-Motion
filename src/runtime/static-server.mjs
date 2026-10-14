import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { generateAndValidateScene } from '../ai/prompt-to-spec.mjs';

const MAX_GENERATE_BODY_BYTES = 1024 * 1024;
const DEFAULT_SCENE_CONTEXT = {
  width: 1280,
  height: 720,
  fps: 24,
  primaryColor: '#0F172A',
  accentColor: '#38BDF8',
};

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function contentTypeFor(filePath) {
  return contentTypes[path.extname(filePath)] ?? 'application/octet-stream';
}

export function resolveStaticPath(root, requestUrl) {
  const { pathname } = new URL(requestUrl, 'http://127.0.0.1');
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const resolved = path.resolve(root, relativePath);

  if (!resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }

  return resolved;
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function handleGenerateRequest(request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST' }).end();
    return;
  }

  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    sendJson(response, 415, { success: false, error: 'Content-Type must be application/json.' });
    return;
  }

  const bodyChunks = [];
  let bodyBytes = 0;
  for await (const chunk of request) {
    bodyBytes += chunk.length;
    if (bodyBytes > MAX_GENERATE_BODY_BYTES) {
      request.resume();
      sendJson(response, 413, { success: false, error: 'Request body exceeds the 1 MiB limit.' });
      return;
    }
    bodyChunks.push(chunk);
  }

  let body;
  try {
    body = JSON.parse(Buffer.concat(bodyChunks).toString('utf8'));
  } catch {
    sendJson(response, 400, { success: false, error: 'Request body must contain valid JSON.' });
    return;
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(response, 400, { success: false, error: 'Request body must be a JSON object.' });
    return;
  }

  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    sendJson(response, 400, { success: false, error: 'A valid text prompt is required.' });
    return;
  }

  if (
    body.context !== undefined
    && (!body.context || typeof body.context !== 'object' || Array.isArray(body.context))
  ) {
    sendJson(response, 400, { success: false, error: 'Context must be a JSON object.' });
    return;
  }

  try {
    const result = await generateAndValidateScene(body.prompt, {
      context: body.context ?? DEFAULT_SCENE_CONTEXT,
    });
    sendJson(response, 200, { success: true, ...result });
  } catch (error) {
    sendJson(response, 500, { success: false, error: error.message });
  }
}

export async function createStaticServer({ root, host = '127.0.0.1', port = 0 }) {
  const resolvedRoot = path.resolve(root);
  await access(resolvedRoot);

  const server = http.createServer(async (request, response) => {
    const { pathname } = new URL(request.url, 'http://127.0.0.1');
    if (pathname === '/api/generate') {
      await handleGenerateRequest(request, response);
      return;
    }

    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    const filePath = resolveStaticPath(resolvedRoot, request.url);
    if (!filePath) {
      response.writeHead(403).end();
      return;
    }

    try {
      await access(filePath);
      response.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });

      if (request.method === 'HEAD') {
        response.end();
      } else {
        createReadStream(filePath).pipe(response);
      }
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  return {
    host,
    port: actualPort,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
