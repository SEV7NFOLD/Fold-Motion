import { getEngineConfig } from '../src/runtime/creative-api.mjs';

export const VERCEL_RENDER_REASON = 'This deployment runs on Vercel, which can’t render video (no FFmpeg, and functions can’t run a full encode). Render from the Render deployment, or run npm start on a machine with FFmpeg.';

// Key-free description of the configured AI engine, shown in the studio's System view.
export default function engine(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ success: false, error: 'Method not allowed.' });
  }
  return response.status(200).json({
    success: true,
    engine: getEngineConfig(),
    render: { available: false, reason: VERCEL_RENDER_REASON },
  });
}
