import { GeminiAIProvider, getGeminiKeyPool } from '../ai/provider.mjs';
import { compileCreativePlan, createCreativePlan } from '../production/production.mjs';

export async function generateProductionAction({
  action,
  prompt,
  context,
  storyboard,
  apiKey,
  apiKeys,
  fetchImpl = globalThis.fetch,
  logger = console,
}) {
  const run = (provider) => action === 'compile'
    ? compileCreativePlan(storyboard, context, provider)
    : createCreativePlan(prompt, context, provider);

  const keyPool = Array.isArray(apiKeys)
    ? [...new Set(apiKeys.filter((key) => typeof key === 'string').map((key) => key.trim()).filter(Boolean))]
    : apiKey?.trim()
      ? [...new Set([apiKey.trim(), ...getGeminiKeyPool().filter((key) => key !== apiKey.trim())])]
      : getGeminiKeyPool();

  if (keyPool.length === 0) {
    return { action, ...(await run(null)) };
  }

  const telemetry = [];
  let lastSafeError;
  for (let index = 0; index < keyPool.length; index += 1) {
    const keyNumber = index + 1;
    const totalKeys = keyPool.length;
    const attemptMessage = `Attempting Gemini request with API key #${keyNumber} of ${totalKeys}.`;
    telemetry.push({ stage: 'Gemini key attempt', message: attemptMessage });
    logger.info?.(`[api/generate] ${attemptMessage}`, { action, keyNumber, totalKeys });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const provider = new GeminiAIProvider({
        apiKey: keyPool[index],
        fetchImpl: (url, options) => fetchImpl(url, {
          ...options,
          signal: controller.signal,
        }),
      });
      const result = await run(provider);
      return { action, ...result, telemetry };
    } catch (error) {
      const safeMessage = keyPool.reduce(
        (message, key) => message.split(key).join('[redacted API key]'),
        error.message,
      );
      lastSafeError = safeMessage;
      const failureMessage = `Gemini API key #${keyNumber} failed: ${safeMessage}`;
      telemetry.push({ stage: 'Gemini key failed', message: failureMessage });
      logger.warn('[api/generate] Gemini key attempt failed.', {
        action,
        keyNumber,
        totalKeys,
        error: safeMessage,
      });
      if (index < keyPool.length - 1) {
        const rotationMessage = `Rotating to Gemini API key #${keyNumber + 1} of ${totalKeys}.`;
        telemetry.push({ stage: 'Rotating Gemini key', message: rotationMessage });
        logger.info?.(`[api/generate] ${rotationMessage}`, { action, keyNumber: keyNumber + 1, totalKeys });
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  const finalMessage = `All ${keyPool.length} configured Gemini API keys failed. Last error: ${lastSafeError}`;
  logger.warn('[api/generate] Gemini key pool exhausted; using deterministic mock provider.', {
    action,
    totalKeys: keyPool.length,
  });
  telemetry.push({
    stage: 'Gemini key pool exhausted',
    message: 'All configured Gemini API keys failed; continuing with deterministic mock generation.',
  });
  try {
    const result = await run(null);
    telemetry.push({ stage: 'Offline mock ready', message: 'Deterministic mock generation completed.' });
    return { action, ...result, telemetry, warning: finalMessage };
  } catch (error) {
    error.telemetry = telemetry;
    throw error;
  }
}
