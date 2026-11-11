import { renderBackendUrl } from './_render-backend.js';

// GET /output/... (rewritten here by vercel.json): films and QA files rendered on the
// RENDER_BACKEND_URL server live on its disk, so send the browser there. Signed-in
// renders are stored in Supabase instead and never come through here.
export default function output(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).end();
  }
  const backend = renderBackendUrl();
  const filePath = String(request.query?.path || '');
  if (!backend || !filePath || filePath.includes('..') || !/^[A-Za-z0-9._\/-]+$/.test(filePath)) {
    return response.status(404).end('Not found');
  }
  response.setHeader('Cache-Control', 'no-store');
  return response.redirect(307, `${backend}/output/${filePath.split('/').map(encodeURIComponent).join('/')}`);
}
