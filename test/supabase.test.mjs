import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  downloadObject, loadStoredAssets, ownsPath, publicAuthConfig, requireUser, supabaseConfig, verifyUser,
} from '../src/runtime/supabase-server.mjs';
import { createStaticServer } from '../src/runtime/static-server.mjs';

const ENV = { SUPABASE_URL: 'https://cipkgsyvvgmfalfazije.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc', SUPABASE_SECRET_KEY: 'sb_secret_xyz' };
const USER = { id: '11111111-2222-4333-8444-555555555555', email: 'studio@sev7nfold.com' };
const fakeFetch = (handler) => {
  const calls = [];
  const fn = async (url, options = {}) => { calls.push({ url, options }); return handler(url, options); };
  fn.calls = calls;
  return fn;
};
const json = (status, body) => ({ ok: status < 400, status, async json() { return body; }, async arrayBuffer() { return Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); } });

test('Supabase is configured only when the URL and both keys are set', () => {
  assert.equal(supabaseConfig({}), null);
  assert.equal(supabaseConfig({ ...ENV, SUPABASE_SECRET_KEY: '' }), null);
  assert.equal(supabaseConfig({ ...ENV, SUPABASE_URL: 'https://evil.example.com' }), null);
  assert.deepEqual(supabaseConfig(ENV), { url: ENV.SUPABASE_URL, publishableKey: 'sb_publishable_abc', secretKey: 'sb_secret_xyz' });
  assert.ok(supabaseConfig({ SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 'b' }), 'legacy key names work');
  const exposed = publicAuthConfig(ENV);
  assert.deepEqual(exposed, { provider: 'supabase', url: ENV.SUPABASE_URL, publishableKey: 'sb_publishable_abc' });
  assert.doesNotMatch(JSON.stringify(exposed), /sb_secret/, 'the secret key is never sent to browsers');
});

test('requests need a verified user when Supabase is configured, and checks are cached', async () => {
  assert.deepEqual(await requireUser({}, { env: {} }), { required: false, user: null, config: null });
  const noToken = await requireUser({}, { env: ENV, fetchImpl: fakeFetch(() => json(200, USER)) });
  assert.equal(noToken.status, 401);
  const fetchImpl = fakeFetch((url, options) => (options.headers.Authorization === 'Bearer good-token-0123456789abcdef' ? json(200, USER) : json(401, {})));
  const signedIn = await requireUser({ authorization: 'Bearer good-token-0123456789abcdef' }, { env: ENV, fetchImpl });
  assert.deepEqual(signedIn.user, USER);
  assert.equal(fetchImpl.calls[0].options.headers.apikey, 'sb_publishable_abc');
  await verifyUser(supabaseConfig(ENV), 'good-token-0123456789abcdef', fetchImpl);
  assert.equal(fetchImpl.calls.length, 1, 'a verified token is cached for a minute');
  assert.equal((await requireUser({ authorization: 'Bearer bad-token-0123456789abcdef' }, { env: ENV, fetchImpl })).status, 401);
});

test('secret keys go on the apikey header only; legacy service_role keys also on Authorization', async () => {
  const fetchImpl = fakeFetch(() => json(200, 'file'));
  await downloadObject(supabaseConfig(ENV), 'brand-assets', `${USER.id}/logo.svg`, fetchImpl);
  assert.deepEqual(fetchImpl.calls[0].options.headers, { apikey: 'sb_secret_xyz' });
  const legacy = supabaseConfig({ SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOi.legacy.jwt' });
  await downloadObject(legacy, 'brand-assets', `${USER.id}/logo.svg`, fetchImpl);
  assert.equal(fetchImpl.calls[1].options.headers.Authorization, 'Bearer eyJhbGciOi.legacy.jwt');
});

test('the server only touches files in the signed-in user’s own folder', async () => {
  assert.equal(ownsPath(USER, `${USER.id}/logo.svg`), true);
  assert.equal(ownsPath(USER, 'someone-else/logo.svg'), false);
  assert.equal(ownsPath(USER, `${USER.id}/../other/logo.svg`), false);
  await assert.rejects(loadStoredAssets(supabaseConfig(ENV), USER, { logo: { kind: 'svg', path: 'someone-else/logo.svg' } }), /another account/);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
  const assets = await loadStoredAssets(supabaseConfig(ENV), USER, { logo: { kind: 'svg', path: `${USER.id}/logo.svg` } }, fakeFetch(() => json(200, svg)));
  assert.deepEqual(assets.logo, { kind: 'svg', svg });
});

test('with Supabase configured, the server refuses signed-out requests and shares only public settings', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, ENV);
  const server = await createStaticServer({ root: new URL('../public', import.meta.url).pathname });
  try {
    const base = `http://${server.host}:${server.port}`;
    for (const endpoint of ['/api/generate', '/api/render', '/api/state', '/api/storyboard']) {
      const response = await fetch(`${base}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 401, endpoint);
      assert.equal((await response.json()).signIn, true);
    }
    const engine = await (await fetch(`${base}/api/engine`)).json();
    assert.deepEqual(engine.auth, { provider: 'supabase', url: ENV.SUPABASE_URL, publishableKey: 'sb_publishable_abc' });
  } finally {
    await server.close();
    for (const key of Object.keys(ENV)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test('the migration turns on row level security for every table and keeps buckets private', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261108000000_fold_motion.sql', import.meta.url), 'utf8');
  const tables = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map(([, name]) => name);
  assert.deepEqual(tables, ['projects', 'brand_kits', 'films']);
  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), `${table} has RLS`);
    assert.match(sql, new RegExp(`on public\\.${table} for select to authenticated using \\(owner = \\(select auth\\.uid\\(\\)\\)\\)`), `${table} reads are owner-only`);
  }
  assert.match(sql, /\('brand-assets', 'brand-assets', false,/);
  assert.match(sql, /\('films', 'films', false,/);
  assert.doesNotMatch(sql, /films: (insert|upload)/, 'only the server writes films');
});
