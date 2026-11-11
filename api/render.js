import { VERCEL_RENDER_REASON, forwardToBackend, renderBackendUrl } from './_render-backend.js';

// Vercel can't render itself. With RENDER_BACKEND_URL set, the render is queued on that
// server (always as a job, so this function answers in seconds) and the studio polls
// /api/render/jobs/:id, which vercel.json routes to ./render-job.js.
export default async function render(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ success: false, error: 'Method not allowed.' });
  }
  const backend = renderBackendUrl();
  if (!backend) {
    return response.status(501).json({ success: false, error: VERCEL_RENDER_REASON });
  }
  const body = request.body && typeof request.body === 'object' ? request.body : null;
  if (!body) return response.status(400).json({ success: false, error: 'The render request needs a JSON body.' });
  const result = await forwardToBackend(backend, '/api/render', {
    method: 'POST',
    authorization: request.headers?.authorization,
    body: { ...body, async: true },
  });
  return response.status(result.status).json(result.body);
}
