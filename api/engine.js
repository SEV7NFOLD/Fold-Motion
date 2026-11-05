import { getEngineConfig } from '../src/runtime/creative-api.mjs';

// Key-free description of the configured AI engine, shown in the studio's System view.
export default function engine(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ success: false, error: 'Method not allowed.' });
  }
  return response.status(200).json({ success: true, engine: getEngineConfig() });
}
