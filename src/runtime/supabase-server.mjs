/**
 * Supabase on the FOLD Motion server: sign-in checks, storage and films.
 *
 * Talks to Supabase's REST endpoints with fetch (no extra dependency). When the
 * SUPABASE_* variables aren't set, every function here is a no-op and the server
 * runs exactly as before (local development, tests).
 *
 * The secret key never leaves the server. Users are identified by the access
 * token from their email sign-in, verified with Supabase Auth, and the server only
 * ever reads or writes files inside that user's own folder.
 */

export const FILM_BUCKET = 'films';
export const BRAND_BUCKET = 'brand-assets';
export const FILM_LINK_SECONDS = 7 * 24 * 60 * 60;

/** { url, publishableKey, secretKey } when all three are set, otherwise null. */
export function supabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const publishableKey = String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '').trim();
  const secretKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) return null;
  if (!publishableKey || !secretKey) return null;
  return { url, publishableKey, secretKey };
}

/** What the studio needs to sign people in. Safe to send to browsers. */
export function publicAuthConfig(env = process.env) {
  const config = supabaseConfig(env);
  return config ? { provider: 'supabase', url: config.url, publishableKey: config.publishableKey } : null;
}

/**
 * Headers for server-side calls. New secret keys (sb_secret_...) go on the apikey
 * header only; legacy service_role keys are JWTs and also go on Authorization.
 */
function serviceHeaders(config, extra = {}) {
  const headers = { apikey: config.secretKey, ...extra };
  if (!config.secretKey.startsWith('sb_secret_')) headers.Authorization = `Bearer ${config.secretKey}`;
  return headers;
}

const verified = new Map();
const VERIFY_CACHE_MS = 60_000;

/** The signed-in user for an access token, or null. Cached for a minute. */
export async function verifyUser(config, accessToken, fetchImpl = fetch) {
  if (!config || typeof accessToken !== 'string' || accessToken.length < 20) return null;
  const cached = verified.get(accessToken);
  if (cached && cached.expires > Date.now()) return cached.user;
  try {
    const response = await fetchImpl(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (typeof body?.id !== 'string') return null;
    const user = { id: body.id, email: body.email || '' };
    verified.set(accessToken, { user, expires: Date.now() + VERIFY_CACHE_MS });
    if (verified.size > 500) verified.delete(verified.keys().next().value);
    return user;
  } catch {
    return null;
  }
}

export function bearerToken(headers = {}) {
  const value = headers.authorization || headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(value));
  return match ? match[1].trim() : '';
}

/**
 * The user behind a request when Supabase is configured. Returns
 * { required: false } when it isn't, { user } when signed in, { error } otherwise.
 */
export async function requireUser(headers, { env = process.env, fetchImpl = fetch } = {}) {
  const config = supabaseConfig(env);
  if (!config) return { required: false, user: null, config: null };
  const user = await verifyUser(config, bearerToken(headers), fetchImpl);
  return user ? { required: true, user, config } : { required: true, error: 'Sign in to FOLD Motion to continue.', status: 401 };
}

const encodePath = (path) => String(path).split('/').map(encodeURIComponent).join('/');

/** True when a storage path sits inside this user's own folder. */
export function ownsPath(user, path) {
  return Boolean(user?.id) && typeof path === 'string' && path.startsWith(`${user.id}/`) && !path.includes('..') && !path.includes('\\');
}

export async function downloadObject(config, bucket, path, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.url}/storage/v1/object/${bucket}/${encodePath(path)}`, { headers: serviceHeaders(config) });
  if (!response.ok) throw new Error(`Couldn't load ${path.split('/').pop()} from storage (HTTP ${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

export async function uploadObject(config, bucket, path, body, contentType, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.url}/storage/v1/object/${bucket}/${encodePath(path)}`, {
    method: 'POST',
    headers: serviceHeaders(config, { 'Content-Type': contentType, 'x-upsert': 'true' }),
    body,
  });
  if (!response.ok) throw new Error(`Couldn't save the film to storage (HTTP ${response.status}).`);
}

export async function signedUrl(config, bucket, path, expiresIn = FILM_LINK_SECONDS, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.url}/storage/v1/object/sign/${bucket}/${encodePath(path)}`, {
    method: 'POST',
    headers: serviceHeaders(config, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn }),
  });
  if (!response.ok) throw new Error(`Couldn't create a link to the film (HTTP ${response.status}).`);
  const body = await response.json();
  const signed = body.signedURL || body.signedUrl;
  if (typeof signed !== 'string') throw new Error('Storage returned no link for the film.');
  return `${config.url}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}`;
}

export async function insertRow(config, table, row, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.url}/rest/v1/${table}`, {
    method: 'POST',
    headers: serviceHeaders(config, { 'Content-Type': 'application/json', Prefer: 'return=minimal,resolution=merge-duplicates' }),
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error(`Couldn't record the film (HTTP ${response.status}).`);
}

/**
 * Brand assets in a render request may point at files in the user's brand-assets
 * folder ({ kind, path }). Downloads them and returns the inline form the renderer
 * checks ({ kind: 'svg', svg } or { kind: 'png', dataUri }).
 */
export async function loadStoredAssets(config, user, assets, fetchImpl = fetch) {
  if (!assets?.logo?.path) return assets;
  const { kind, path } = assets.logo;
  if (!ownsPath(user, path)) throw new Error('That logo belongs to another account.');
  const buffer = await downloadObject(config, BRAND_BUCKET, path, fetchImpl);
  const logo = kind === 'svg' ? { kind: 'svg', svg: buffer.toString('utf8') } : { kind: 'png', dataUri: `data:image/png;base64,${buffer.toString('base64')}` };
  return { ...assets, logo };
}

/**
 * Keeps a rendered film: uploads the MP4 to the user's folder in the films bucket,
 * records it, and returns { path, url } with a signed link that lasts a week.
 */
export async function storeFilm(config, user, { projectId, runId, file, durationSeconds }, fetchImpl = fetch) {
  const safe = (value) => String(value).replace(/[^a-z0-9-]/gi, '-').slice(0, 80);
  const path = `${user.id}/${safe(projectId)}/${safe(runId)}.mp4`;
  await uploadObject(config, FILM_BUCKET, path, file, 'video/mp4', fetchImpl);
  await insertRow(config, 'films', { owner: user.id, project_id: String(projectId), storage_path: path, duration_seconds: durationSeconds ?? null }, fetchImpl);
  return { path, url: await signedUrl(config, FILM_BUCKET, path, FILM_LINK_SECONDS, fetchImpl) };
}
