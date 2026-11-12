import { getEngineConfig } from '../src/runtime/creative-api.mjs';
import { publicAuthConfig } from '../src/runtime/supabase-server.mjs';
import { VERCEL_RENDER_REASON, renderBackendUrl, wakeBackend } from './_render-backend.js';

export { VERCEL_RENDER_REASON };

// Key-free description of the configured AI engine, shown in the studio's System view.
export default async function engine(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ success: false, error: 'Method not allowed.' });
  }
  const backend = renderBackendUrl();
  // The studio loads this on open, so it's a good moment to start waking a sleeping
  // Render instance before the director presses Render.
  if (backend) await wakeBackend(backend);
  return response.status(200).json({
    success: true,
    engine: getEngineConfig(),
    render: backend
      ? { available: true, via: 'render-backend', launch: { available: true, via: 'render-backend' } }
      : { available: false, reason: VERCEL_RENDER_REASON, launch: { available: false, reason: VERCEL_RENDER_REASON } },
    auth: publicAuthConfig(),
  });
}
