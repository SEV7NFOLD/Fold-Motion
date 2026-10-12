import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
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

export async function createStaticServer({ root, host = '127.0.0.1', port = 0 }) {
  const resolvedRoot = path.resolve(root);
  await access(resolvedRoot);

  const server = http.createServer(async (request, response) => {
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
