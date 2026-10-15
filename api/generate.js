import { generateProductionAction } from '../src/runtime/creative-api.mjs';
import { validateStoryboard } from '../src/production/production.mjs';
import { getGeminiKeyPool } from '../src/ai/provider.mjs';

const defaultContext = {
  width: 1280,
  height: 720,
  fps: 24,
  primaryColor: '#0B0F19',
  accentColor: '#00F0FF',
};

export default async function generate(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(204).end();
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  const body = request.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return response.status(400).json({ success: false, error: 'Request body must be a JSON object.' });
  }
  if (body.context !== undefined && (!body.context || typeof body.context !== 'object' || Array.isArray(body.context))) {
    return response.status(400).json({ success: false, error: 'Context must be a JSON object.' });
  }
  const action = body.action || 'storyboard';
  if (!['storyboard', 'compile'].includes(action)) {
    return response.status(400).json({ success: false, error: 'Action must be "storyboard" or "compile".' });
  }
  if (action === 'storyboard' && (typeof body.prompt !== 'string' || !body.prompt.trim())) {
    return response.status(400).json({ success: false, error: 'A valid text prompt is required.' });
  }
  if (action === 'compile' && (!body.storyboard || typeof body.storyboard !== 'object' || Array.isArray(body.storyboard))) {
    return response.status(400).json({ success: false, error: 'A valid approved storyboard is required.' });
  }
  if (action === 'compile') {
    const validation = validateStoryboard(body.storyboard);
    if (!validation.valid) {
      return response.status(400).json({ success: false, error: `Storyboard validation failed: ${validation.errors.join(' ')}` });
    }
  }

  try {
    const result = await generateProductionAction({
      action,
      prompt: body.prompt,
      storyboard: body.storyboard,
      context: body.context ?? defaultContext,
      apiKeys: getGeminiKeyPool(),
    });
    return response.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[api/generate] Production planning failed.', { action, error: error.message });
    return response.status(500).json({
      success: false,
      error: error.message,
      telemetry: error.telemetry,
    });
  }
}
