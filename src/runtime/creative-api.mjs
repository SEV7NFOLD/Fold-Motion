import {
  DEFAULT_GEMINI_MODEL,
  GeminiAIProvider,
  geminiDisplayName,
  getGeminiKeyPool,
  OpenAICompatibleAIProvider,
} from '../ai/provider.mjs';
import { compileCreativePlan, createCreativePlan } from '../production/production.mjs';

const FALLBACK_PROVIDERS = Object.freeze([
  {
    name: 'Groq',
    environmentKey: 'GROQ_API_KEY',
    keyNumber: 1,
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    fallbackModels: ['llama-3.1-8b-instant'],
  },
  {
    name: 'OpenRouter',
    environmentKey: 'OPENROUTER_API_KEY',
    keyNumber: 1,
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'openrouter/free',
    headers: {
      'HTTP-Referer': 'https://fold-motion.onrender.com',
      'X-Title': 'FOLD Motion Studio',
    },
  },
]);

// Why a failure happened, in words the studio can show next to the result.
const FAILURE_EXPLANATIONS = Object.freeze({
  quota: 'quota reached (HTTP 429)',
  auth: 'API key rejected',
  config: 'model unavailable or request rejected',
  timeout: 'request timed out',
  network: 'provider unreachable',
  overload: 'provider overloaded',
  output: 'answer could not be used',
  provider: 'provider error',
});

function readGeminiSettings(environment) {
  const model = typeof environment.GEMINI_MODEL === 'string' && environment.GEMINI_MODEL.trim()
    ? environment.GEMINI_MODEL.trim()
    : DEFAULT_GEMINI_MODEL;
  const thinkingLevel = typeof environment.GEMINI_THINKING_LEVEL === 'string' && environment.GEMINI_THINKING_LEVEL.trim()
    ? environment.GEMINI_THINKING_LEVEL.trim()
    : undefined;
  const timeout = Number(environment.GEMINI_TIMEOUT_MS);
  return {
    model,
    thinkingLevel,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 30_000,
    // Keys created in the same Google Cloud project share one quota, so a 429 on one
    // key means a 429 on all of them. Only rotate on 429 when keys come from separate projects.
    rotateOnQuota: environment.GEMINI_ROTATE_ON_QUOTA === 'true',
  };
}

/** Public, key-free description of the configured engine for the studio's System view. */
export function getEngineConfig(environment = process.env) {
  const gemini = readGeminiSettings(environment);
  const keys = getGeminiKeyPool(environment).length;
  return {
    gemini: {
      configured: keys > 0,
      keys,
      model: gemini.model,
      name: geminiDisplayName(gemini.model),
      thinkingLevel: gemini.thinkingLevel ?? null,
      timeoutMs: gemini.timeoutMs,
      rotateOnQuota: gemini.rotateOnQuota,
    },
    fallbacks: FALLBACK_PROVIDERS.map(({ name, environmentKey, model }) => ({
      name,
      model,
      configured: typeof environment[environmentKey] === 'string' && Boolean(environment[environmentKey].trim()),
    })),
  };
}

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
      ? [...new Set([apiKey.trim(), ...getGeminiKeyPool(environment).filter((key) => key !== apiKey.trim())])]
      : getGeminiKeyPool(environment);
  const gemini = readGeminiSettings(environment);

  const telemetry = [];
  const failures = [];
  let lastSafeError;
  const redact = (message, keys) => keys.reduce(
    (safeMessage, key) => safeMessage.split(key).join('[redacted API key]'),
    String(message ?? ''),
  );
  const succeed = (result) => {
    if (Array.isArray(result.repairs) && result.repairs.length > 0) {
      const count = result.repairs.length;
      telemetry.push({
        stage: 'Output repaired',
        message: `Fixed ${count} issue${count === 1 ? '' : 's'} in the model output before validation.`,
      });
    }
    return { action, ...result, telemetry };
  };

  let geminiAttempts = 0;
  for (let index = 0; index < keyPool.length; index += 1) {
    const keyNumber = index + 1;
    const totalKeys = keyPool.length;
    geminiAttempts += 1;
    const attemptMessage = `Attempting Gemini request with API key #${keyNumber} of ${totalKeys}.`;
    telemetry.push({ stage: 'Gemini key attempt', message: attemptMessage });
    logger.info?.(`[api/generate] ${attemptMessage}`, { action, keyNumber, totalKeys, model: gemini.model });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), gemini.timeoutMs);
    try {
      const provider = new GeminiAIProvider({
        apiKey: keyPool[index],
        model: gemini.model,
        thinkingLevel: gemini.thinkingLevel,
        fetchImpl: (url, options) => fetchImpl(url, {
          ...options,
          signal: controller.signal,
        }),
      });
      return succeed(await run(provider));
    } catch (error) {
      const kind = error?.kind || 'provider';
      const safeMessage = redact(error?.message, keyPool);
      lastSafeError = safeMessage;
      failures.push({ provider: 'Gemini', kind });
      const failureMessage = `Gemini API key #${keyNumber} failed: ${safeMessage}`;
      telemetry.push({ stage: 'Gemini key failed', message: failureMessage, kind });
      logger.warn('[api/generate] Gemini key attempt failed.', {
        action,
        keyNumber,
        totalKeys,
        kind,
        error: safeMessage,
      });

      const remaining = keyPool.length - keyNumber;
      const stopReason = remaining === 0 ? null
        : kind === 'quota' && !gemini.rotateOnQuota
          ? `Gemini quota reached. Skipping ${remaining} remaining key${remaining === 1 ? '' : 's'}: keys in one Google project share a single quota (set GEMINI_ROTATE_ON_QUOTA=true if they come from separate projects).`
          : kind === 'output'
            ? `Gemini answered, but the output could not be used. Skipping ${remaining} remaining key${remaining === 1 ? '' : 's'}: another key returns the same kind of answer.`
            : kind === 'config'
              ? `Gemini rejected the model or request. Skipping ${remaining} remaining key${remaining === 1 ? '' : 's'}: the same request fails on every key. Check GEMINI_MODEL.`
              : null;
      if (stopReason) {
        telemetry.push({ stage: 'Gemini keys skipped', message: stopReason, kind });
        logger.warn(`[api/generate] ${stopReason}`, { action, kind });
        break;
      }
      if (remaining > 0) {
        const rotationMessage = `Rotating to Gemini API key #${keyNumber + 1} of ${totalKeys}.`;
        telemetry.push({ stage: 'Rotating Gemini key', message: rotationMessage });
        logger.info?.(`[api/generate] ${rotationMessage}`, { action, keyNumber: keyNumber + 1, totalKeys });
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  const fallbackProviders = FALLBACK_PROVIDERS.filter(({ environmentKey }) => (
    typeof environment[environmentKey] === 'string' && environment[environmentKey].trim()
  ));

  if (keyPool.length > 0) {
    const message = geminiAttempts === keyPool.length
      ? `All ${keyPool.length} configured Gemini API keys failed.`
      : `Gemini stopped after ${geminiAttempts} of ${keyPool.length} keys.`;
    telemetry.push({ stage: 'Gemini key pool exhausted', message });
    logger.warn('[api/generate] Gemini key pool exhausted; trying configured fallback providers.', {
      action,
      totalKeys: keyPool.length,
      attempted: geminiAttempts,
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
        fallbackModels: config.fallbackModels,
        fetchImpl,
        headers: config.headers,
      });
      const result = await run(provider);
      telemetry.push({
        stage: `${config.name} provider ready`,
        message: `${config.name} generation completed successfully.`,
      });
      return succeed(result);
    } catch (error) {
      const kind = error?.kind || 'provider';
      const safeMessage = redact(error?.message, [key]);
      lastSafeError = safeMessage;
      failures.push({ provider: config.name, kind });
      const failureMessage = `${config.name} API key #${config.keyNumber} failed: ${safeMessage}`;
      telemetry.push({ stage: `${config.name} provider failed`, message: failureMessage, kind });
      logger.warn(`[api/generate] ${config.name} provider attempt failed.`, {
        action,
        keyNumber: config.keyNumber,
        kind,
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
  const reasonSummary = [...new Map(failures.map(({ provider, kind }) => [provider, kind])).entries()]
    .map(([provider, kind]) => `${provider}: ${FAILURE_EXPLANATIONS[kind] || kind}`)
    .join('; ');
  const lastFailure = failures.at(-1);
  const fallbackReason = configuredCount === 0 ? 'unconfigured' : lastFailure?.kind || 'provider';
  const finalMessage = keyPool.length > 0 && fallbackProviders.length === 0
    ? `${geminiAttempts === keyPool.length ? `All ${keyPool.length} configured Gemini API keys failed` : `Gemini stopped after ${geminiAttempts} of ${keyPool.length} keys`} (${reasonSummary}). Last error: ${lastSafeError}`
    : configuredCount > 0
      ? `All ${configuredCount} configured AI provider credentials failed (${reasonSummary}). Last error: ${lastSafeError}`
      : 'No AI provider API keys are configured; using deterministic mock generation.';
  logger.warn('[api/generate] All configured AI providers exhausted; using deterministic mock provider.', {
    action,
    geminiKeys: keyPool.length,
    fallbackProviders: fallbackProviders.length,
    fallbackReason,
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
    return { action, ...result, telemetry, warning: finalMessage, fallbackReason };
  } catch (error) {
    error.telemetry = telemetry;
    throw error;
  }
}
