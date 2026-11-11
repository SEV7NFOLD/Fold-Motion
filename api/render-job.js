import { forwardToBackend, renderBackendUrl } from './_render-backend.js';

// GET /api/render/jobs/:id (rewritten here by vercel.json): the status of a render
// queued on the RENDER_BACKEND_URL server.
export default async function renderJob(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ success: false, error: 'Method not allowed.' });
  }
  const backend = renderBackendUrl();
  if (!backend) return response.status(404).json({ success: false, error: 'This deployment doesn’t run renders.' });
  const id = String(request.query?.id || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return response.status(400).json({ success: false, error: 'Invalid render job id.' });
  const result = await forwardToBackend(backend, `/api/render/jobs/${encodeURIComponent(id)}`, {
    authorization: request.headers?.authorization,
    timeoutMs: 20_000,
  });
  return response.status(result.status).json(result.body);
}
