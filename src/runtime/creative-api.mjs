import { GeminiAIProvider } from '../ai/provider.mjs';
import { compileCreativePlan, createCreativePlan } from '../production/production.mjs';

export async function generateProductionAction({
  action,
  prompt,
  context,
  storyboard,
  apiKey,
  fetchImpl = globalThis.fetch,
  logger = console,
}) {
  const run = (provider) => action === 'compile'
    ? compileCreativePlan(storyboard, context, provider)
    : createCreativePlan(prompt, context, provider);

  if (!apiKey?.trim()) {
    return { action, ...(await run(null)) };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const provider = new GeminiAIProvider({
      apiKey: apiKey.trim(),
      fetchImpl: (url, options) => fetchImpl(url, {
        ...options,
        signal: controller.signal,
      }),
    });
    return { action, ...(await run(provider)) };
  } catch (error) {
    logger.warn('[api/generate] Gemini production planning failed.', {
      action,
      error: error.message,
    });
    throw new Error(`Gemini ${action} request failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}
