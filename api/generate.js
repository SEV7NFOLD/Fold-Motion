import { generateAndValidateScene } from '../src/ai/prompt-to-spec.mjs';

const defaultContext = {
  width: 1280,
  height: 720,
  fps: 24,
  primaryColor: '#0F172A',
  accentColor: '#38BDF8',
};

export default async function generate(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  const body = request.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return response.status(400).json({ success: false, error: 'Request body must be a JSON object.' });
  }

  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return response.status(400).json({ success: false, error: 'A valid text prompt is required.' });
  }

  if (
    body.context !== undefined
    && (!body.context || typeof body.context !== 'object' || Array.isArray(body.context))
  ) {
    return response.status(400).json({ success: false, error: 'Context must be a JSON object.' });
  }

  try {
    const result = await generateAndValidateScene(body.prompt, {
      context: body.context ?? defaultContext,
    });
    return response.status(200).json({ success: true, ...result });
  } catch (error) {
    return response.status(500).json({ success: false, error: error.message });
  }
}
