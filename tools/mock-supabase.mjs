/**
 * A small stand-in for Supabase, for end-to-end tests of sign-in, the projects
 * and brand_kits tables, films and storage. It implements only what FOLD Motion
 * uses, enforces "own folder / own rows" for user tokens like row level security
 * would, and lets secret-key requests through like the service role.
 *
 * Test hooks: GET /__last_link (the latest sign-in link) and GET /__state.
 */
import http from 'node:http';

export async function startMockSupabase({ port = 0, publishableKey = 'sb_publishable_test', secretKey = 'sb_secret_test' } = {}) {
  const users = new Map();      // token -> user
  const tables = { projects: new Map(), brand_kits: new Map(), films: new Map() };
  const objects = new Map();    // `${bucket}/${path}` -> { type, body }
  let lastLink = '';
  let counter = 0;

  const issue = (user) => {
    counter += 1;
    const token = `tok_${counter}_${'x'.repeat(24)}`;
    users.set(token, user);
    return { access_token: token, refresh_token: `ref_${counter}`, expires_in: 3600, token_type: 'bearer', user };
  };
  const read = (request) => new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
  });
  const send = (response, status, body, type = 'application/json') => {
    response.writeHead(status, { 'Content-Type': type });
    response.end(Buffer.isBuffer(body) ? body : body === undefined ? '' : JSON.stringify(body));
  };

  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'apikey, authorization, content-type, x-upsert, prefer');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (request.method === 'OPTIONS') return send(response, 204);
    const url = new URL(request.url, 'http://mock');
    const apikey = request.headers.apikey;
    const service = apikey === secretKey;
    const token = /^Bearer (.+)$/.exec(request.headers.authorization || '')?.[1];
    const user = token ? users.get(token) : null;
    if (url.pathname === '/__last_link') return send(response, 200, { link: lastLink });
    if (url.pathname === '/__state') {
      return send(response, 200, {
        projects: [...tables.projects.values()].map(({ id, owner, title }) => ({ id, owner, title })),
        brand_kits: [...tables.brand_kits.values()].map(({ owner, logo, products }) => ({ owner, logo, products })),
        films: [...tables.films.values()],
        objects: [...objects.keys()],
      });
    }
    // Signed links carry their own token, like real Supabase: no API key needed.
    const signedGet = request.method === 'GET' && /^\/storage\/v1\/object\/sign\//.test(url.pathname) && url.searchParams.has('token');
    if (apikey !== publishableKey && !service && !signedGet) return send(response, 401, { message: 'Invalid API key' });

    // ---- auth
    if (url.pathname === '/auth/v1/otp' && request.method === 'POST') {
      const { email } = JSON.parse((await read(request)).toString() || '{}');
      const session = issue({ id: `00000000-0000-4000-8000-${String(1000 + counter).padStart(12, '0')}`, email });
      lastLink = `${url.searchParams.get('redirect_to')}#access_token=${session.access_token}&refresh_token=${session.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`;
      return send(response, 200, {});
    }
    if (url.pathname === '/auth/v1/user') return user ? send(response, 200, user) : send(response, 401, { msg: 'invalid JWT' });
    if (url.pathname === '/auth/v1/token') {
      const body = JSON.parse((await read(request)).toString() || '{}');
      const old = [...users.entries()].find(([key]) => key.endsWith(body.refresh_token?.slice(4)));
      return old ? send(response, 200, issue(old[1])) : send(response, 400, { error: 'invalid_grant' });
    }
    if (url.pathname === '/auth/v1/logout') { users.delete(token); return send(response, 204); }

    // ---- tables (own rows only for user tokens)
    const table = /^\/rest\/v1\/(projects|brand_kits|films)$/.exec(url.pathname)?.[1];
    if (table) {
      if (!service && !user) return send(response, 401, { message: 'JWT required' });
      const key = (row) => (table === 'brand_kits' ? row.owner : table === 'films' ? row.storage_path : row.id);
      if (request.method === 'GET') {
        const rows = [...tables[table].values()].filter((row) => service || row.owner === user.id);
        rows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
        return send(response, 200, rows);
      }
      if (request.method === 'POST') {
        const rows = [].concat(JSON.parse((await read(request)).toString()));
        for (const row of rows) {
          if (!service && row.owner !== user.id) return send(response, 403, { message: 'new row violates row-level security policy' });
          if (table === 'films' && !service) return send(response, 403, { message: 'row-level security' });
          tables[table].set(key(row), { ...tables[table].get(key(row)), ...row });
        }
        return send(response, 201);
      }
      if (request.method === 'DELETE') {
        // Honor PostgREST equality filters (?id=eq.x&owner=eq.y), like the real API.
        const filters = [...url.searchParams].filter(([, value]) => value.startsWith('eq.')).map(([column, value]) => [column, value.slice(3)]);
        for (const [id, row] of tables[table]) {
          const allowed = service || row.owner === user.id;
          if (allowed && filters.every(([column, value]) => String(row[column]) === value)) tables[table].delete(id);
        }
        return send(response, 204);
      }
    }

    // ---- storage (own folder only for user tokens)
    const signed = /^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (signed) {
      const [, bucket, rawPath] = signed;
      const path = decodeURIComponent(rawPath);
      if (request.method === 'POST') {
        if (!service && !path.startsWith(`${user?.id}/`)) return send(response, 403, { message: 'Unauthorized' });
        return send(response, 200, { signedURL: `/object/sign/${bucket}/${rawPath}?token=signed-${Date.now()}` });
      }
      const object = objects.get(`${bucket}/${path}`);
      if (object && url.searchParams.has('download')) response.setHeader('Content-Disposition', `attachment; filename="${url.searchParams.get('download') || path.split('/').pop()}"`);
      return object ? send(response, 200, object.body, object.type) : send(response, 404, { message: 'Object not found' });
    }
    const object = /^\/storage\/v1\/object\/([^/]+)(?:\/(.+))?$/.exec(url.pathname);
    if (object) {
      const [, bucket, rawPath = ''] = object;
      const path = decodeURIComponent(rawPath);
      const owns = (p) => service || (user && p.startsWith(`${user.id}/`));
      if (request.method === 'POST') {
        if (!owns(path)) return send(response, 403, { message: 'new row violates row-level security policy' });
        objects.set(`${bucket}/${path}`, { type: request.headers['content-type'], body: await read(request) });
        return send(response, 200, { Key: `${bucket}/${path}` });
      }
      if (request.method === 'GET') {
        if (!owns(path)) return send(response, 400, { message: 'Object not found' });
        const found = objects.get(`${bucket}/${path}`);
        return found ? send(response, 200, found.body, found.type) : send(response, 404, { message: 'Object not found' });
      }
      if (request.method === 'DELETE') {
        const { prefixes = [] } = JSON.parse((await read(request)).toString() || '{}');
        for (const prefix of prefixes) if (owns(prefix)) objects.delete(`${bucket}/${prefix}`);
        return send(response, 200, []);
      }
    }
    return send(response, 404, { message: `mock has no route for ${request.method} ${url.pathname}` });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, publishableKey, secretKey, close: () => new Promise((resolve) => server.close(resolve)) };
}

if (process.argv[1] && process.argv[1].endsWith('mock-supabase.mjs')) {
  const mock = await startMockSupabase({ port: Number(process.env.MOCK_PORT || 54321) });
  console.log(`mock supabase on ${mock.url}`);
}
