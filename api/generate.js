import { generateAndValidateScene } from '../src/ai/prompt-to-spec.mjs';
import { GeminiAIProvider } from '../src/ai/provider.mjs';

const defaultContext = {
  width: 1280,
  height: 720,
  fps: 24,
  primaryColor: '#0F172A',
  accentColor: '#38BDF8',
};

function createMockContext(context = {}) {
  const positiveNumber = (value, fallback) => (
    Number.isFinite(value) && value > 0 ? value : fallback
  );

  return {
    ...context,
    width: positiveNumber(context.width, defaultContext.width),
    height: positiveNumber(context.height, defaultContext.height),
    fps: positiveNumber(context.fps, defaultContext.fps),
    durationInSeconds: positiveNumber(context.durationInSeconds, 4),
  };
}

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

  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return response.status(400).json({ success: false, error: 'A valid text prompt is required.' });
  }

  if (
    body.context !== undefined
    && (!body.context || typeof body.context !== 'object' || Array.isArray(body.context))
  ) {
    return response.status(400).json({ success: false, error: 'Context must be a JSON object.' });
  }

  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  const context = body.context ?? defaultContext;
  let result;

  if (geminiConfigured) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const provider = new GeminiAIProvider({
        apiKey: process.env.GEMINI_API_KEY.trim(),
        fetchImpl: (url, options) => globalThis.fetch(url, {
          ...options,
          signal: controller.signal,
        }),
      });
      result = await generateAndValidateScene(body.prompt, { provider, context });
    } catch (error) {
      console.warn('[api/generate] Gemini unavailable; using mock provider.', {
        error: error.message,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!result) {
    result = await generateAndValidateScene(body.prompt, {
      context: createMockContext(context),
    });
  }

  return response.status(200).json({ success: true, ...result });
}
