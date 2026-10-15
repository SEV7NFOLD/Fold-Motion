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
