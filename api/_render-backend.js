// Vercel can't render (no FFmpeg, short-lived functions), so when RENDER_BACKEND_URL
// names a FOLD Motion server that can (the Render deployment), Vercel forwards render
// work there. Files starting with "_" are helpers, not Vercel routes.

export const VERCEL_RENDER_REASON = 'This deployment runs on Vercel, which can’t render video (no FFmpeg, and functions can’t run a full encode). Render from the Render deployment, or run npm start on a machine with FFmpeg. To render from this site, set RENDER_BACKEND_URL in the Vercel project to your Render deployment’s URL.';

/** The configured render server's origin (https, no trailing slash), or null when unset or invalid. */
export function renderBackendUrl(env = process.env) {
  const raw = String(env.RENDER_BACKEND_URL || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return null;
    return url.origin;
  } catch {
    return null;
  }
}

const WAKE_HINT = 'The render server didn’t answer in time. A free Render instance sleeps when idle and takes about a minute to wake; try again shortly.';

/**
 * Forwards one request to the render server and returns { status, body }.
 * Never throws: network failures become a 502/504 with a readable error.
 */
export async function forwardToBackend(backend, pathAndQuery, { method = 'GET', authorization, body, timeoutMs = 55_000, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(`${backend}${pathAndQuery}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(authorization ? { Authorization: authorization } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    try {
      return { status: response.status, body: text ? JSON.parse(text) : {} };
    } catch {
      return { status: 502, body: { success: false, error: `The render server answered with something that isn’t JSON (HTTP ${response.status}). Check that RENDER_BACKEND_URL points at the FOLD Motion Render deployment.` } };
    }
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return { status: timedOut ? 504 : 502, body: { success: false, error: timedOut ? WAKE_HINT : `The render server couldn’t be reached (${error?.message || 'network error'}). ${WAKE_HINT}` } };
  }
}

/** Sends a cheap request so a sleeping Render instance starts waking; ignores the outcome. */
export async function wakeBackend(backend, { timeoutMs = 2500, fetchImpl = fetch } = {}) {
  try {
    await fetchImpl(`${backend}/health`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    // Waking is best-effort; the render request itself reports real failures.
  }
}
