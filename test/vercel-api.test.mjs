import assert from 'node:assert/strict';
import test from 'node:test';
import generate from '../api/generate.js';

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

const GEMINI_KEY_VARIABLES = [
  'GEMINI_API_KEY',
  'GEMINI_API_KEY_2',
  'GEMINI_API_KEY_3',
  'GEMINI_API_KEYS',
];

function configureGeminiKeys(values) {
  const previous = Object.fromEntries(GEMINI_KEY_VARIABLES.map((name) => [name, process.env[name]]));
  for (const name of GEMINI_KEY_VARIABLES) delete process.env[name];
  Object.assign(process.env, values);
  return () => {
    for (const name of GEMINI_KEY_VARIABLES) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  };
}

test('Vercel generation function starts with a structured storyboard and acceptance criteria', async () => {
  const response = createResponse();
  await generate({
    method: 'POST',
    body: {
      prompt: 'Kinetic typography intro',
      context: { width: 1920, height: 1080 },
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.action, 'storyboard');
  assert.equal(response.body.provider, 'mock-provider');
  assert.ok(response.body.storyboard.shots.length >= 2);
  assert.equal(response.body.acceptance.technicalRequirements.width, 1920);
  assert.equal(response.body.acceptance.technicalRequirements.height, 1080);
  assert.ok(response.body.storyboard.acceptanceCriteria.creative.length > 0);
});

test('Vercel generation function rejects invalid prompts and request methods', async () => {
  const invalidPromptResponse = createResponse();
  await generate({ method: 'POST', body: { prompt: ' ' } }, invalidPromptResponse);
  assert.equal(invalidPromptResponse.statusCode, 400);
  assert.match(invalidPromptResponse.body.error, /valid text prompt/);

  const invalidContextResponse = createResponse();
  await generate({
    method: 'POST',
    body: { prompt: 'A scene', context: 'invalid' },
  }, invalidContextResponse);
  assert.equal(invalidContextResponse.statusCode, 400);
  assert.match(invalidContextResponse.body.error, /Context must be a JSON object/);

  const invalidActionResponse = createResponse();
  await generate({
    method: 'POST',
    body: { action: 'unknown', prompt: 'A scene' },
  }, invalidActionResponse);
  assert.equal(invalidActionResponse.statusCode, 400);

  const invalidCompileResponse = createResponse();
  await generate({
    method: 'POST',
    body: { action: 'compile', storyboard: {} },
  }, invalidCompileResponse);
  assert.equal(invalidCompileResponse.statusCode, 400);
  assert.match(invalidCompileResponse.body.error, /storyboard validation failed/i);

  const methodResponse = createResponse();
  await generate({ method: 'GET', body: {} }, methodResponse);
  assert.equal(methodResponse.statusCode, 405);
  assert.equal(methodResponse.headers.Allow, 'POST');
  assert.equal(methodResponse.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(methodResponse.headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');

  const preflightResponse = createResponse();
  await generate({ method: 'OPTIONS' }, preflightResponse);
  assert.equal(preflightResponse.statusCode, 204);
  assert.equal(preflightResponse.headers['Access-Control-Allow-Headers'], 'Content-Type');
});

test('Vercel generation function compiles an approved storyboard into a canonical timeline', async () => {
  const planResponse = createResponse();
  const context = {
    width: 640,
    height: 360,
    fps: 24,
    headline: 'A CUSTOM HEADLINE',
    subheadline: 'The exact supporting line',
    primaryColor: '#112233',
    accentColor: '#44AABB',
  };
  await generate({
    method: 'POST',
    body: { prompt: 'A cinematic title', context },
  }, planResponse);
  const compileResponse = createResponse();
  await generate({
    method: 'POST',
    body: {
      action: 'compile',
      storyboard: planResponse.body.storyboard,
      context,
    },
  }, compileResponse);

  assert.ok(planResponse.body.storyboard.shots.some((shot) => shot.onScreenCopy === context.headline));
  assert.ok(planResponse.body.storyboard.shots.some((shot) => shot.onScreenCopy === context.subheadline));
  assert.equal(compileResponse.statusCode, 200);
  assert.equal(compileResponse.body.action, 'compile');
  assert.equal(compileResponse.body.provider, 'mock-provider');
  assert.equal(compileResponse.body.timeline.shots.length, planResponse.body.storyboard.shots.length);
  assert.equal(compileResponse.body.timeline.totalFrames, 192);
  assert.deepEqual(compileResponse.body.timeline.palette, {
    primary: context.primaryColor,
    accent: context.accentColor,
  });
  assert.ok(compileResponse.body.timeline.shots.every((shot) => (
    shot.spec.elements.some((element) => element.content === context.subheadline)
  )));
  assert.ok(compileResponse.body.timeline.hardConstraints.length > 0);
  assert.deepEqual(
    compileResponse.body.timeline.shots.map(({ startFrame, endFrame }) => [startFrame, endFrame]),
    [[0, 71], [72, 143], [144, 191]],
  );
});

test('Vercel generation function rotates to the next configured Gemini key', async () => {
  const restoreKeys = configureGeminiKeys({
    GEMINI_API_KEY: 'first-test-key',
    GEMINI_API_KEY_2: 'second-test-key',
  });
  const previousFetch = globalThis.fetch;
  const attemptedKeys = [];
  const storyboard = {
    id: 'gemini-storyboard',
    title: 'Generated by Gemini',
    audience: 'Designers',
    platform: '1280 × 720, 24 fps',
    narrativeConcept: 'A clear reveal.',
    creativeDirection: 'Minimal, high contrast.',
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
    acceptanceCriteria: { technical: ['24 fps.'], creative: ['Readable copy.'] },
  };
  globalThis.fetch = async (_url, options) => {
    const key = options.headers['x-goog-api-key'];
    attemptedKeys.push(key);
    if (key === 'first-test-key') {
      return {
        ok: false,
        status: 503,
        async json() {
          return { error: { message: 'Temporarily unavailable.' } };
        },
      };
    }
    return {
      ok: true,
      async json() {
        return {
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  ...storyboard,
                }),
              }],
            },
          }],
        };
      },
    };
  };

  try {
    const response = createResponse();
    await generate({
      method: 'POST',
      body: { prompt: 'A cinematic title' },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.provider, 'Gemini 3.8 Flash');
    assert.equal(response.body.storyboard.title, 'Generated by Gemini');
    assert.deepEqual(attemptedKeys, ['first-test-key', 'second-test-key']);
    assert.ok(response.body.telemetry.some(({ stage }) => stage === 'Rotating Gemini key'));
    assert.equal(response.body.success, true);
  } finally {
    globalThis.fetch = previousFetch;
    restoreKeys();
  }
});

test('Vercel generation function falls back only after Gemini key pool exhaustion', async () => {
  const restoreKeys = configureGeminiKeys({ GEMINI_API_KEY: 'test-gemini-key' });
  const previousFetch = globalThis.fetch;
  const previousConsoleWarn = console.warn;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  let warningLogged = false;
  console.warn = () => { warningLogged = true; };

  try {
    const response = createResponse();
    await generate({
      method: 'POST',
      body: { prompt: 'A cinematic title' },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.provider, 'mock-provider');
    assert.ok(response.body.telemetry.some(({ stage }) => stage === 'Gemini key pool exhausted'));
    assert.equal(warningLogged, true);
  } finally {
    console.warn = previousConsoleWarn;
    globalThis.fetch = previousFetch;
    restoreKeys();
  }
});

test('Vercel generation function uses mock after a Gemini timeout exhausts the key pool', async (testContext) => {
  testContext.mock.timers.enable({ apis: ['setTimeout'] });
  const restoreKeys = configureGeminiKeys({ GEMINI_API_KEY: 'test-gemini-key' });
  const previousFetch = globalThis.fetch;
  const previousConsoleWarn = console.warn;
  let requestSignal;
  let warningLogged = false;
  globalThis.fetch = async (_url, options) => {
    requestSignal = options.signal;
    return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => {
        reject(new Error('Gemini request aborted.'));
      }, { once: true });
    });
  };
  console.warn = () => { warningLogged = true; };

  try {
    const response = createResponse();
    const pending = generate({
      method: 'POST',
      body: { prompt: 'A cinematic title' },
    }, response);
    await new Promise((resolve) => setImmediate(resolve));
    testContext.mock.timers.tick(30_000);
    await pending;

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.provider, 'mock-provider');
    assert.ok(response.body.telemetry.some(({ stage }) => stage === 'Gemini key pool exhausted'));
    assert.equal(requestSignal.aborted, true);
    assert.equal(warningLogged, true);
  } finally {
    console.warn = previousConsoleWarn;
    globalThis.fetch = previousFetch;
    restoreKeys();
  }
});

test('Vercel generation function uses mock after Gemini setup failure exhausts the key pool', async () => {
  const restoreKeys = configureGeminiKeys({ GEMINI_API_KEY: 'test-gemini-key' });
  const previousFetch = globalThis.fetch;
  const previousConsoleWarn = console.warn;
  globalThis.fetch = undefined;
  console.warn = () => {};

  try {
    const response = createResponse();
    await generate({
      method: 'POST',
      body: { prompt: 'A cinematic title' },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.provider, 'mock-provider');
    assert.ok(response.body.telemetry.some(({ stage }) => stage === 'Gemini key pool exhausted'));
  } finally {
    console.warn = previousConsoleWarn;
    globalThis.fetch = previousFetch;
    restoreKeys();
  }
});
