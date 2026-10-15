import assert from 'node:assert/strict';
import test from 'node:test';
import { generateProductionAction } from '../src/runtime/creative-api.mjs';

const storyboard = {
  id: 'failover-storyboard',
  title: 'Failover test',
  audience: 'Test audience',
  platform: '1280 × 720, 24 fps',
  narrativeConcept: 'A successful provider retry.',
  creativeDirection: 'Keep the message clear.',
  shots: [{
    id: 'shot-01',
    purpose: 'Reveal the message.',
    durationSeconds: 4,
    onScreenCopy: 'HELLO',
    mainVisual: 'A type card.',
    composition: 'Centered.',
    cameraBehavior: 'Static.',
    motionBehavior: 'Fade in.',
    transitionIn: 'Fade up.',
    transitionOut: 'Hold.',
    acceptanceCriteria: ['Copy is readable.'],
  }],
  hardConstraints: ['Preserve exact copy.'],
  acceptanceCriteria: { technical: ['Use the configured format.'], creative: ['Keep copy readable.'] },
};

function createResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return status === 200
        ? { candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }
        : { error: { message: 'Temporarily unavailable.' } };
    },
  };
}

function createOpenAIResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return status === 200
        ? { choices: [{ message: { content: JSON.stringify(payload) } }] }
        : { error: { message: 'Temporarily unavailable.' } };
    },
  };
}

test('Gemini generation retries keys sequentially and succeeds with the next key', async () => {
  const attemptedKeys = [];
  const logs = [];
  const result = await generateProductionAction({
    action: 'storyboard',
    prompt: 'A cinematic title',
    context: {},
    apiKeys: ['first-secret', 'second-secret', 'third-secret'],
    fetchImpl: async (_url, options) => {
      const key = options.headers['x-goog-api-key'];
      attemptedKeys.push(key);
      return key === 'first-secret'
        ? createResponse({}, 503)
        : createResponse(storyboard);
    },
    logger: {
      info(message, details) { logs.push({ level: 'info', message, details }); },
      warn(message, details) { logs.push({ level: 'warn', message, details }); },
    },
  });

  assert.deepEqual(attemptedKeys, ['first-secret', 'second-secret']);
  assert.equal(result.provider, 'Gemini 3.8 Flash');
  assert.deepEqual(result.telemetry.map(({ stage }) => stage), [
    'Gemini key attempt',
    'Gemini key failed',
    'Rotating Gemini key',
    'Gemini key attempt',
  ]);
  assert.ok(logs.some(({ message }) => message.includes('Rotating to Gemini API key #2')));
  assert.ok(logs.every(({ message, details }) => (
    !message.includes('first-secret')
    && !message.includes('second-secret')
    && !JSON.stringify(details).includes('first-secret')
    && !JSON.stringify(details).includes('second-secret')
  )));
});

test('deterministic mock is used only after every configured Gemini key fails', async () => {
  const attemptedKeys = [];
  const logs = [];
  const result = await generateProductionAction({
    action: 'storyboard',
    prompt: 'A cinematic title',
    context: {},
    apiKeys: ['first-secret', 'second-secret'],
    fetchImpl: async (_url, options) => {
      attemptedKeys.push(options.headers['x-goog-api-key']);
      return createResponse({}, 503);
    },
    logger: {
      info(message) { logs.push(message); },
      warn(message) { logs.push(message); },
    },
  });

  assert.deepEqual(attemptedKeys, ['first-secret', 'second-secret']);
  assert.equal(result.provider, 'mock-provider');
  assert.match(result.warning, /All 2 configured Gemini API keys failed/);
  assert.deepEqual(result.telemetry.map(({ stage }) => stage), [
    'Gemini key attempt',
    'Gemini key failed',
    'Rotating Gemini key',
    'Gemini key attempt',
    'Gemini key failed',
    'Gemini key pool exhausted',
    'Offline mock ready',
  ]);
  assert.ok(logs.some((message) => message.includes('key pool exhausted')));
  assert.ok(logs.every((message) => !message.includes('first-secret') && !message.includes('second-secret')));
});

test('generation falls back from Gemini to Groq, then OpenRouter in order', async () => {
  const requests = [];
  const logs = [];
  const result = await generateProductionAction({
    action: 'storyboard',
    prompt: 'A cinematic title',
    context: {},
    apiKeys: ['gemini-secret'],
    environment: {
      GROQ_API_KEY: 'groq-secret',
      OPENROUTER_API_KEY: 'router-secret',
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.includes('generativelanguage.googleapis.com')) return createResponse({}, 503);
      if (url.includes('api.groq.com')) return createOpenAIResponse({}, 503);
      return createOpenAIResponse(storyboard);
    },
    logger: {
      info(message, details) { logs.push({ level: 'info', message, details }); },
      warn(message, details) { logs.push({ level: 'warn', message, details }); },
    },
  });

  assert.deepEqual(requests.map(({ url }) => {
    if (url.includes('generativelanguage.googleapis.com')) return 'Gemini';
    if (url.includes('api.groq.com')) return 'Groq';
    return 'OpenRouter';
  }), ['Gemini', 'Groq', 'OpenRouter']);
  assert.equal(JSON.parse(requests[1].options.body).model, 'openai/gpt-oss-120b');
  assert.equal(JSON.parse(requests[2].options.body).model, 'openrouter/free');
  assert.equal(requests[2].options.headers['HTTP-Referer'], 'https://fold-motion.onrender.com');
  assert.equal(result.provider, 'OpenRouter');
  assert.deepEqual(result.storyboard, storyboard);
  assert.ok(result.telemetry.some(({ stage }) => stage === 'Rotating to OpenRouter'));
  assert.ok(logs.every(({ message, details }) => (
    !message.includes('gemini-secret')
    && !message.includes('groq-secret')
    && !message.includes('router-secret')
    && !JSON.stringify(details).includes('secret')
  )));
});

test('generation uses deterministic mock only after Gemini, Groq, and OpenRouter fail', async () => {
  const attemptedUrls = [];
  const result = await generateProductionAction({
    action: 'storyboard',
    prompt: 'A cinematic title',
    context: {},
    apiKeys: ['gemini-secret'],
    environment: {
      GROQ_API_KEY: 'groq-secret',
      OPENROUTER_API_KEY: 'router-secret',
    },
    fetchImpl: async (url) => {
      attemptedUrls.push(url);
      return url.includes('generativelanguage.googleapis.com')
        ? createResponse({}, 503)
        : createOpenAIResponse({}, 503);
    },
    logger: { info() {}, warn() {} },
  });

  assert.equal(attemptedUrls.length, 3);
  assert.equal(result.provider, 'mock-provider');
  assert.match(result.warning, /All 3 configured AI provider credentials failed/);
  assert.deepEqual(result.telemetry.slice(-2).map(({ stage }) => stage), [
    'AI provider pool exhausted',
    'Offline mock ready',
  ]);
});

test('Groq is tried when Gemini keys are absent and OpenRouter is skipped when unconfigured', async () => {
  const requests = [];
  const result = await generateProductionAction({
    action: 'storyboard',
    prompt: 'A cinematic title',
    context: {},
    apiKeys: [],
    environment: { GROQ_API_KEY: 'groq-secret' },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return createOpenAIResponse(storyboard);
    },
    logger: { info() {}, warn() {} },
  });

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^https:\/\/api\.groq\.com\//);
  assert.equal(result.provider, 'Groq');
});

test('OpenAI-compatible fallback compiles a storyboard from a shotSpecs response object', async () => {
  const shotSpec = {
    id: 'hello-scene',
    title: 'HELLO',
    width: 1280,
    height: 720,
    fps: 24,
    durationInSeconds: 4,
    elements: [
      { id: 'background', type: 'rect', x: 0, y: 0, width: 1280, height: 720, fill: '#0B0F19' },
      { id: 'accent', type: 'rect', x: 100, y: 600, width: 300, height: 5, fill: '#00F0FF' },
      { id: 'copy', type: 'text', x: 640, y: 360, content: 'HELLO', fontSize: 48, fill: '#FFFFFF', anchor: 'middle' },
    ],
  };
  const result = await generateProductionAction({
    action: 'compile',
    storyboard,
    context: {},
    apiKeys: [],
    environment: { OPENROUTER_API_KEY: 'router-secret' },
    fetchImpl: async () => createOpenAIResponse({ shotSpecs: [shotSpec] }),
    logger: { info() {}, warn() {} },
  });

  assert.equal(result.provider, 'OpenRouter');
  assert.equal(result.timeline.shots.length, 1);
  assert.equal(result.timeline.shots[0].spec.id, shotSpec.id);
});
