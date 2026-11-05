import {
  DEFAULT_GEMINI_MODEL,
  GeminiAIProvider,
  geminiDisplayName,
  getGeminiKeyPool,
  OpenAICompatibleAIProvider,
} from '../ai/provider.mjs';
import { compileCreativePlan, createCreativePlan } from '../production/production.mjs';

const DEFAULT_BACKUP_MODELS = 'gemini-3.6-flash';
const sleep = (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); });

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
  overload: 'servers overloaded (HTTP 503)',
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
  // Overload (503) and quota (429) are per model, so a different Gemini model often answers
  // when the primary can't. Set GEMINI_BACKUP_MODELS="" to disable.
  const backupModels = (typeof environment.GEMINI_BACKUP_MODELS === 'string' ? environment.GEMINI_BACKUP_MODELS : DEFAULT_BACKUP_MODELS)
    .split(',').map((name) => name.trim()).filter((name) => name && name !== model);
  // Backup models are full "thinking" models; low thinking keeps big structured answers fast.
  const backupThinkingLevel = typeof environment.GEMINI_BACKUP_THINKING_LEVEL === 'string'
    ? environment.GEMINI_BACKUP_THINKING_LEVEL.trim() || undefined
    : 'low';
  const retries = Number(environment.GEMINI_OVERLOAD_RETRIES);
  const retryDelay = Number(environment.GEMINI_RETRY_DELAY_MS);
  return {
    model,
    backupModels: [...new Set(backupModels)],
    overloadRetries: Number.isInteger(retries) && retries >= 0 ? Math.min(retries, 3) : 1,
    retryDelayMs: Number.isFinite(retryDelay) && retryDelay >= 0 ? retryDelay : 1500,
    thinkingLevel,
    backupThinkingLevel,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 45_000,
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
      backupModels: gemini.backupModels.map((model) => ({ model, name: geminiDisplayName(model) })),
      backupThinkingLevel: gemini.backupThinkingLevel ?? null,
      overloadRetries: gemini.overloadRetries,
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

  // Keys only differ in whose account they belong to. Model-level failures (overload,
  // quota, unknown model) are handled by retrying and switching models, not keys.
  const models = [gemini.model, ...gemini.backupModels];
  const remainingKeysNote = (count) => `${count} remaining key${count === 1 ? '' : 's'}`;
  let geminiAttempts = 0;
  let stopGemini = false;
  for (let index = 0; index < keyPool.length && !stopGemini; index += 1) {
    const keyNumber = index + 1;
    const totalKeys = keyPool.length;
    geminiAttempts += 1;
    let lastKind = null;

    for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
      const model = models[modelIndex];
      const modelName = geminiDisplayName(model);
      for (let attempt = 0; attempt <= gemini.overloadRetries; attempt += 1) {
        const attemptMessage = modelIndex === 0 && attempt === 0
          ? `Attempting Gemini request with API key #${keyNumber} of ${totalKeys}.`
          : `Attempting ${modelName} with API key #${keyNumber} of ${totalKeys}${attempt ? ` (retry ${attempt})` : ''}.`;
        telemetry.push({ stage: 'Gemini key attempt', message: attemptMessage });
        logger.info?.(`[api/generate] ${attemptMessage}`, { action, keyNumber, totalKeys, model });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), gemini.timeoutMs);
        try {
          const provider = new GeminiAIProvider({
            apiKey: keyPool[index],
            model,
            thinkingLevel: gemini.thinkingLevel ?? (modelIndex > 0 ? gemini.backupThinkingLevel : undefined),
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
          lastKind = kind;
          failures.push({ provider: 'Gemini', kind });
          telemetry.push({ stage: 'Gemini key failed', message: `Gemini API key #${keyNumber} failed: ${safeMessage}`, kind });
          logger.warn('[api/generate] Gemini key attempt failed.', { action, keyNumber, totalKeys, model, kind, error: safeMessage });
          if ((kind === 'overload' || kind === 'network') && attempt < gemini.overloadRetries) {
            const delay = gemini.retryDelayMs * (attempt + 1);
            telemetry.push({ stage: 'Gemini retry', message: `${modelName} is busy or unreachable. Retrying in ${(delay / 1000).toFixed(1)}s.`, kind });
            await sleep(delay);
            continue;
          }
          break;
        } finally {
          clearTimeout(timeout);
        }
      }

      if (lastKind === 'auth' || lastKind === 'provider') break;
      if (lastKind === 'output' || lastKind === 'timeout') {
        stopGemini = true;
        const reason = lastKind === 'output'
          ? 'Gemini answered, but the output could not be used'
          : `Gemini took longer than ${Math.round(gemini.timeoutMs / 1000)}s`;
        const remaining = keyPool.length - keyNumber;
        telemetry.push({
          stage: 'Gemini keys skipped',
          message: `${reason}. Moving on${remaining ? ` and skipping ${remainingKeysNote(remaining)}` : ''}.`,
          kind: lastKind,
        });
        break;
      }
      if (modelIndex < models.length - 1) {
        const nextName = geminiDisplayName(models[modelIndex + 1]);
        const because = lastKind === 'quota' ? `${modelName} is out of quota and quotas are counted per model`
          : lastKind === 'config' ? `${modelName} is unavailable`
            : `${modelName} is overloaded`;
        telemetry.push({ stage: 'Gemini backup model', message: `Switching to ${nextName}: ${because}.`, kind: lastKind });
        logger.info?.(`[api/generate] Switching to backup model ${models[modelIndex + 1]}.`, { action, kind: lastKind });
      }
    }

    const remaining = keyPool.length - keyNumber;
    if (stopGemini || remaining === 0) continue;
    const rotate = lastKind === 'auth' || lastKind === 'provider' || (lastKind === 'quota' && gemini.rotateOnQuota);
    if (rotate) {
      const rotationMessage = `Rotating to Gemini API key #${keyNumber + 1} of ${totalKeys}.`;
      telemetry.push({ stage: 'Rotating Gemini key', message: rotationMessage });
      logger.info?.(`[api/generate] ${rotationMessage}`, { action, keyNumber: keyNumber + 1, totalKeys });
      continue;
    }
    stopGemini = true;
    const skipMessage = lastKind === 'quota'
      ? `Gemini quota reached. Skipping ${remainingKeysNote(remaining)}: keys in one Google project share a single quota (set GEMINI_ROTATE_ON_QUOTA=true if they come from separate projects).`
      : lastKind === 'config'
        ? `Gemini rejected the model or request. Skipping ${remainingKeysNote(remaining)}: the same request fails on every key. Check GEMINI_MODEL.`
        : `Gemini's servers are overloaded for every configured model. Skipping ${remainingKeysNote(remaining)}: other keys reach the same servers.`;
    telemetry.push({ stage: 'Gemini keys skipped', message: skipMessage, kind: lastKind });
    logger.warn(`[api/generate] ${skipMessage}`, { action, kind: lastKind });
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
