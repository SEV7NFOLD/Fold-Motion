/**
 * A small Supabase client for the studio: email sign-in, the session, the
 * projects and brand_kits tables, and the user's own storage folder.
 *
 * Uses only the publishable key, which is safe in a browser: every read and write
 * is limited by row level security to the signed-in user's own data.
 */

const SESSION_KEY = 'fold-motion.session';

export function createSupabaseClient({ url, publishableKey, storage = globalThis.localStorage, fetchImpl = (...args) => fetch(...args) }) {
  let session = readSession();

  function readSession() {
    try {
      const value = JSON.parse(storage.getItem(SESSION_KEY) || 'null');
      return value && typeof value.access_token === 'string' && value.user?.id ? value : null;
    } catch {
      return null;
    }
  }

  function writeSession(next) {
    session = next;
    try {
      if (next) storage.setItem(SESSION_KEY, JSON.stringify(next));
      else storage.removeItem(SESSION_KEY);
    } catch {
      // The session still works for this page; it just won't survive a reload.
    }
  }

  async function call(path, { method = 'GET', headers = {}, body, auth = true, raw = false } = {}) {
    const response = await fetchImpl(`${url}${path}`, {
      method,
      headers: { apikey: publishableKey, ...(auth && session ? { Authorization: `Bearer ${await accessToken()}` } : {}), ...headers },
      body,
    });
    if (raw) return response;
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const message = data?.msg || data?.message || data?.error_description || data?.error || `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  /** A fresh access token, refreshed a minute before it expires. */
  async function accessToken() {
    if (!session) return '';
    if (session.expires_at && session.expires_at * 1000 - Date.now() < 60_000) await refresh();
    return session?.access_token || '';
  }

  async function refresh() {
    if (!session?.refresh_token) return writeSession(null);
    try {
      const response = await fetchImpl(`${url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      if (!response.ok) return writeSession(null);
      const next = await response.json();
      writeSession({ ...next, expires_at: next.expires_at || Math.floor(Date.now() / 1000) + (next.expires_in || 3600) });
    } catch {
      // Offline: keep the current session and try again next time.
    }
  }

  const encodePath = (path) => String(path).split('/').map(encodeURIComponent).join('/');

  return {
    get session() { return session; },
    get user() { return session?.user ? { id: session.user.id, email: session.user.email || '' } : null; },
    accessToken,

    /** Emails a one-click sign-in link that brings the person back to `redirectTo`. */
    async sendSignInLink(email, redirectTo) {
      await call(`/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: 'POST', auth: false, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, create_user: true }),
      });
    },

    /**
     * Picks up the session from a sign-in link (#access_token=... in the address)
     * and cleans the address. Returns { signedIn } or { error }.
     */
    async consumeRedirect(location = globalThis.location, history = globalThis.history) {
      const hash = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
      if (!hash.has('access_token') && !hash.has('error') && !hash.has('error_description')) return {};
      history?.replaceState?.(null, '', location.pathname + location.search);
      if (hash.get('error') || hash.get('error_description')) {
        return { error: (hash.get('error_description') || hash.get('error')).replace(/\+/g, ' ') };
      }
      const pending = {
        access_token: hash.get('access_token'),
        refresh_token: hash.get('refresh_token'),
        expires_at: Number(hash.get('expires_at')) || Math.floor(Date.now() / 1000) + (Number(hash.get('expires_in')) || 3600),
      };
      session = pending;
      try {
        const user = await call('/auth/v1/user');
        writeSession({ ...pending, user: { id: user.id, email: user.email || '' } });
        return { signedIn: true };
      } catch (error) {
        writeSession(null);
        return { error: `That sign-in link didn’t work (${error.message}). Ask for a new one.` };
      }
    },

    async signOut() {
      try { await call('/auth/v1/logout', { method: 'POST' }); } catch { /* signed out locally anyway */ }
      writeSession(null);
    },

    select: (table, query = '') => call(`/rest/v1/${table}?${query}`),
    upsert: (table, rows) => call(`/rest/v1/${table}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows),
    }),
    remove: (table, query) => call(`/rest/v1/${table}?${query}`, { method: 'DELETE' }),

    async upload(bucket, path, blob, contentType) {
      return call(`/storage/v1/object/${bucket}/${encodePath(path)}`, {
        method: 'POST', headers: { 'Content-Type': contentType, 'x-upsert': 'true' }, body: blob,
      });
    },
    async download(bucket, path) {
      const response = await call(`/storage/v1/object/${bucket}/${encodePath(path)}`, { raw: true });
      if (!response.ok) throw new Error(`Couldn’t load ${path.split('/').pop()} (HTTP ${response.status}).`);
      return response.blob();
    },
    async removeObject(bucket, path) {
      return call(`/storage/v1/object/${bucket}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [path] }) });
    },
    async signedUrl(bucket, path, expiresIn = 7 * 24 * 60 * 60) {
      const data = await call(`/storage/v1/object/sign/${bucket}/${encodePath(path)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn }),
      });
      const signed = data?.signedURL || data?.signedUrl;
      return `${url}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}`;
    },
  };
}
