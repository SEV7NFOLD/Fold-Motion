import {
  GeminiAIProvider,
  getGeminiKeyPool,
  OpenAICompatibleAIProvider,
} from '../ai/provider.mjs';
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
  environment = process.env,
}) {
  const run = (provider) => action === 'compile'
    ? compileCreativePlan(storyboard, context, provider)
    : createCreativePlan(prompt, context, provider);

  const keyPool = Array.isArray(apiKeys)
    ? [...new Set(apiKeys.filter((key) => typeof key === 'string').map((key) => key.trim()).filter(Boolean))]
    : apiKey?.trim()
      ? [...new Set([apiKey.trim(), ...getGeminiKeyPool().filter((key) => key !== apiKey.trim())])]
      : getGeminiKeyPool();

  const telemetry = [];
  let lastSafeError;
  const redact = (message, keys) => keys.reduce(
    (safeMessage, key) => safeMessage.split(key).join('[redacted API key]'),
    message,
  );

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
      const safeMessage = redact(error.message, keyPool);
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

  const fallbackProviders = [
    {
      name: 'Groq',
      environmentKey: 'GROQ_API_KEY',
      keyNumber: 1,
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      model: 'llama-3.1-70b-versatile',
    },
    {
      name: 'OpenRouter',
      environmentKey: 'OPENROUTER_API_KEY',
      keyNumber: 1,
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'mistralai/mistral-7b-instruct:free',
      headers: {
        'HTTP-Referer': 'https://fold-motion.onrender.com',
        'X-Title': 'FOLD Motion Studio',
      },
    },
  ].filter(({ environmentKey }) => (
    typeof environment[environmentKey] === 'string' && environment[environmentKey].trim()
  ));

  if (keyPool.length > 0) {
    const message = `All ${keyPool.length} configured Gemini API keys failed.`;
    telemetry.push({ stage: 'Gemini key pool exhausted', message });
    logger.warn('[api/generate] Gemini key pool exhausted; trying configured fallback providers.', {
      action,
      totalKeys: keyPool.length,
    });
  }

  for (let index = 0; index < fallbackProviders.length; index += 1) {
    const config = fallbackProviders[index];
    const key = environment[config.environmentKey].trim();
    const attemptMessage = `Attempting ${config.name} generation with API key #${config.keyNumber}.`;
    telemetry.push({ stage: `${config.name} provider attempt`, message: attemptMessage });
    logger.info?.(`[api/generate] ${attemptMessage}`, { action, keyNumber: config.keyNumber });

    try {
      const provider = new OpenAICompatibleAIProvider({
        name: config.name,
        endpoint: config.endpoint,
        apiKey: key,
        model: config.model,
        fetchImpl,
        headers: config.headers,
      });
      const result = await run(provider);
      telemetry.push({
        stage: `${config.name} provider ready`,
        message: `${config.name} generation completed successfully.`,
      });
      return { action, ...result, telemetry };
    } catch (error) {
      const safeMessage = redact(error.message, [key]);
      lastSafeError = safeMessage;
      const failureMessage = `${config.name} API key #${config.keyNumber} failed: ${safeMessage}`;
      telemetry.push({ stage: `${config.name} provider failed`, message: failureMessage });
      logger.warn(`[api/generate] ${config.name} provider attempt failed.`, {
        action,
        keyNumber: config.keyNumber,
        error: safeMessage,
      });
      if (index < fallbackProviders.length - 1) {
        const nextProvider = fallbackProviders[index + 1];
        const rotationMessage = `Rotating to ${nextProvider.name} API key #${nextProvider.keyNumber}.`;
        telemetry.push({ stage: `Rotating to ${nextProvider.name}`, message: rotationMessage });
        logger.info?.(`[api/generate] ${rotationMessage}`, {
          action,
          keyNumber: nextProvider.keyNumber,
        });
      }
    }
  }

  const configuredCount = keyPool.length + fallbackProviders.length;
  const finalMessage = keyPool.length > 0 && fallbackProviders.length === 0
    ? `All ${keyPool.length} configured Gemini API keys failed. Last error: ${lastSafeError}`
    : configuredCount > 0
      ? `All ${configuredCount} configured AI provider credentials failed. Last error: ${lastSafeError}`
    : 'No AI provider API keys are configured; using deterministic mock generation.';
  logger.warn('[api/generate] All configured AI providers exhausted; using deterministic mock provider.', {
    action,
    geminiKeys: keyPool.length,
    fallbackProviders: fallbackProviders.length,
  });
  if (keyPool.length === 0 || fallbackProviders.length > 0) {
    telemetry.push({
      stage: 'AI provider pool exhausted',
      message: 'All configured AI providers failed or no provider keys are configured; continuing with deterministic mock generation.',
    });
  }
  try {
    const result = await run(null);
    telemetry.push({ stage: 'Offline mock ready', message: 'Deterministic mock generation completed.' });
    return { action, ...result, telemetry, warning: finalMessage };
  } catch (error) {
    error.telemetry = telemetry;
    throw error;
  }
}
