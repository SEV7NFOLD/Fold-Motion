import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BaseAIProvider,
  extractAndParseJSON,
  GeminiAIProvider,
  getGeminiKeyPool,
  MockAIProvider,
  OpenAICompatibleAIProvider,
} from '../src/ai/provider.mjs';
import { validateSceneSpec } from '../scripts/qa/validate-scene-spec.mjs';

test('BaseAIProvider stores provider options and requires an implementation', async () => {
  const provider = new BaseAIProvider({ name: 'custom', apiKey: 'test-key' });

  assert.equal(provider.name, 'custom');
  assert.equal(provider.apiKey, 'test-key');
  await assert.rejects(
    provider.generateSceneSpec('A scene'),
    /generateSceneSpec\(\) must be implemented/,
  );
});

test('Gemini key pool trims, orders, and deduplicates configured keys', () => {
  assert.deepEqual(getGeminiKeyPool({
    GEMINI_API_KEY: ' first-key ',
    GEMINI_API_KEY_2: 'second-key',
    GEMINI_API_KEY_3: '',
    GEMINI_API_KEYS: 'second-key, third-key, first-key, ,fourth-key ',
  }), ['first-key', 'second-key', 'third-key', 'fourth-key']);
  assert.deepEqual(getGeminiKeyPool({}), []);
});

test('extractAndParseJSON handles objects, arrays, markdown, and conversational preambles', () => {
  const object = { title: 'A {balanced} title', shots: [{ id: 'shot-1' }] };
  const array = [{ id: 'scene-1' }, { id: 'scene-2' }];

  assert.deepEqual(extractAndParseJSON(object), object);
  assert.deepEqual(extractAndParseJSON('User Safety: safe\n```json\n{"ok":true}\n```\nGeneration complete.'), { ok: true });
  assert.deepEqual(extractAndParseJSON(`Here is the requested result:\n${JSON.stringify(object)}\nHope this helps.`), object);
  assert.deepEqual(extractAndParseJSON(`\`\`\`json\n${JSON.stringify(array)}\n\`\`\``), array);
  assert.throws(() => extractAndParseJSON('User Safety: safe, no JSON here.'), /Invalid JSON output from provider/);
  assert.throws(() => extractAndParseJSON(42), /not a valid string or object/);
});

test('OpenRouter retries without response_format and uses the 35-second timeout', async () => {
  const requests = [];
  const timeoutValues = [];
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (milliseconds) => {
    timeoutValues.push(milliseconds);
    return originalTimeout(milliseconds);
  };
  try {
    const provider = new OpenAICompatibleAIProvider({
      name: 'OpenRouter',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: 'router-secret',
      model: 'openrouter/free',
      headers: { 'HTTP-Referer': 'https://fold-motion.onrender.com' },
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        requests.push({ options, body });
        if (requests.length === 1) {
          return {
            ok: false,
            status: 400,
            async json() {
              return { error: { message: 'response_format json_object is not supported.' } };
            },
          };
        }
        return {
          ok: true,
          async json() {
            return { choices: [{ message: { content: 'User Safety: safe\n```json\n{"ok":true}\n```' } }] };
          },
        };
      },
    });

    assert.deepEqual(await provider.generateStructuredJson('Make a storyboard.'), { ok: true });
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(({ body }) => Boolean(body.response_format)), [true, false]);
    assert.equal(requests[1].options.headers.Authorization, 'Bearer router-secret');
    assert.equal(requests[1].options.headers['HTTP-Referer'], 'https://fold-motion.onrender.com');
    assert.deepEqual(timeoutValues, [35_000, 35_000]);
    assert.match(requests[0].body.messages[0].content, /3 to 25 characters/);
    assert.match(requests[0].body.messages[0].content, /5 to 40 characters/);
    assert.match(requests[0].body.messages[0].content, /exactly 2 to 4 shots/);
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
});

test('OpenAI-compatible providers use the 20-second timeout outside OpenRouter', async () => {
  const timeoutValues = [];
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (milliseconds) => {
    timeoutValues.push(milliseconds);
    return originalTimeout(milliseconds);
  };
  try {
    const provider = new OpenAICompatibleAIProvider({
      name: 'Groq',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: 'groq-secret',
      model: 'llama-3.3-70b-versatile',
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return { choices: [{ message: { content: '{"ok":true}' } }] };
        },
      }),
    });
    assert.deepEqual(await provider.generateStructuredJson('Make a storyboard.'), { ok: true });
    assert.deepEqual(timeoutValues, [20_000]);
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
});

test('OpenAI-compatible provider retries a decommissioned model with its next configured model', async () => {
  const models = [];
  const provider = new OpenAICompatibleAIProvider({
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: 'groq-secret',
    model: 'llama-3.3-70b-versatile',
    fallbackModels: ['llama-3.1-8b-instant'],
    fetchImpl: async (_url, options) => {
      const { model } = JSON.parse(options.body);
      models.push(model);
      return model === 'llama-3.3-70b-versatile'
        ? {
          ok: false,
          status: 400,
          async json() {
            return { error: { message: 'The model has been decommissioned.' } };
          },
        }
        : {
          ok: true,
          async json() {
            return { choices: [{ message: { content: '{"ok":true}' } }] };
          },
        };
    },
  });

  assert.deepEqual(await provider.generateStructuredJson('Make a storyboard.'), { ok: true });
  assert.deepEqual(models, ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']);
});

test('MockAIProvider generates a scene using default context', async () => {
  const provider = new MockAIProvider();
  const scene = await provider.generateSceneSpec('A moving title');

  assert.equal(provider.name, 'mock-provider');
  assert.match(scene.id, /^scene-\d+$/);
  assert.equal(scene.title, 'Generated Scene');
  assert.equal(scene.width, 1280);
  assert.equal(scene.height, 720);
  assert.equal(scene.fps, 24);
  assert.equal(scene.durationInSeconds, 4);
  assert.equal(scene.promptSource, 'A moving title');
  assert.deepEqual(scene.elements.map(({ id, type }) => ({ id, type })), [
    { id: 'bg-rect', type: 'rect' },
    { id: 'title-text', type: 'text' },
  ]);
  assert.equal(scene.elements[0].fill, '#0B0F19');
  assert.equal(scene.elements[1].content, 'A moving title');
});

test('MockAIProvider applies context overrides', async () => {
  const scene = await new MockAIProvider().generateSceneSpec(
    'A very long motion title that gets shortened',
    {
      title: 'Brand scene',
      width: 1920,
      height: 1080,
      fps: 30,
      durationInSeconds: 8,
      primaryColor: '#123456',
      accentColor: '#ABCDEF',
    },
  );

  assert.equal(scene.title, 'Brand scene');
  assert.equal(scene.width, 1920);
  assert.equal(scene.height, 1080);
  assert.equal(scene.fps, 30);
  assert.equal(scene.durationInSeconds, 8);
  assert.equal(scene.elements[0].width, 1920);
  assert.equal(scene.elements[0].height, 1080);
  assert.equal(scene.elements[0].fill, '#123456');
  assert.equal(scene.elements[1].x, 960);
  assert.equal(scene.elements[1].y, 540);
  assert.equal(scene.elements[1].fill, '#ABCDEF');
  assert.equal(scene.elements[1].content, 'A very long motion title that ');
});

test('MockAIProvider generates a scene specification accepted by the validator', async () => {
  const provider = new MockAIProvider();
  const scene = await provider.generateSceneSpec(
    'Hero title reveal with neon blue accent',
    {
      width: 1920,
      height: 1080,
      primaryColor: '#000000',
    },
  );

  assert.equal(scene.width, 1920);
  assert.equal(scene.height, 1080);
  assert.equal(scene.elements.length, 2);

  const validation = validateSceneSpec(scene);
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);
});

test('MockAIProvider rejects a missing or non-string prompt', async () => {
  const provider = new MockAIProvider();

  await assert.rejects(provider.generateSceneSpec(''), /Prompt string is required/);
  await assert.rejects(provider.generateSceneSpec(42), /Prompt string is required/);
});

test('GeminiAIProvider requests JSON and parses a scene specification', async () => {
  let requestedUrl;
  let requestedOptions;
  const spec = {
    id: 'gemini-scene',
    title: 'Neon Intro',
    width: 1920,
    height: 1080,
    fps: 24,
    durationInSeconds: 4,
    elements: [{ id: 'title', type: 'text', content: 'Hello' }],
  };
  const provider = new GeminiAIProvider({
    apiKey: 'test-api-key',
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return {
        ok: true,
        async json() {
          return {
            candidates: [{
              content: { parts: [{ text: `User Safety: safe\n\`\`\`json\n${JSON.stringify(spec)}\n\`\`\`` }] },
            }],
          };
        },
      };
    },
  });

  const result = await provider.generateSceneSpec('Neon title reveal', { width: 1920 });

  assert.equal(provider.name, 'Gemini 3.8 Flash');
  assert.match(requestedUrl, /models\/gemini-3\.8-flash:generateContent$/);
  assert.equal(requestedOptions.headers['x-goog-api-key'], 'test-api-key');
  assert.equal(requestedOptions.headers['Content-Type'], 'application/json');
  assert.equal(result.id, spec.id);
  assert.equal(result.width, 1920);
  assert.equal(JSON.parse(requestedOptions.body).generationConfig.responseMimeType, 'application/json');
  assert.match(JSON.parse(requestedOptions.body).systemInstruction.parts[0].text, /Return only valid raw JSON/);
  assert.equal(validateSceneSpec(result).valid, true);
});

test('GeminiAIProvider surfaces HTTP and malformed-response failures', async () => {
  const unavailable = new GeminiAIProvider({
    apiKey: 'test-api-key',
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      async json() {
        return { error: { message: 'Rate limit exceeded.' } };
      },
    }),
  });
  await assert.rejects(
    unavailable.generateSceneSpec('A scene'),
    /Gemini API returned HTTP 429: Rate limit exceeded/,
  );

  const malformed = new GeminiAIProvider({
    apiKey: 'test-api-key',
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { candidates: [{ content: { parts: [{ text: 'not json' }] } }] };
      },
    }),
  });
  await assert.rejects(malformed.generateSceneSpec('A scene'), /Gemini returned invalid scene JSON/);
  assert.throws(() => new GeminiAIProvider({ apiKey: '' }), /Gemini API key is required/);
});

test('GeminiAIProvider generates structured storyboard and shot-spec responses', async () => {
  const storyboard = {
    id: 'launch-storyboard',
    title: 'Launch',
    audience: 'Customers',
    platform: '1280 × 720, 24 fps',
    narrativeConcept: 'Reveal the product promise.',
    creativeDirection: 'High contrast typography.',
    shots: [{
      id: 'shot-01',
      purpose: 'Introduce the promise.',
      durationSeconds: 4,
      onScreenCopy: 'MOVE FORWARD',
      mainVisual: 'A title.',
      composition: 'Centered.',
      cameraBehavior: 'Static.',
      motionBehavior: 'Ease in.',
      transitionIn: 'Fade.',
      transitionOut: 'Hold.',
      acceptanceCriteria: ['Copy stays legible.'],
    }],
    hardConstraints: ['Retain exact copy.'],
    acceptanceCriteria: { technical: ['24 fps.'], creative: ['Clear copy.'] },
  };
  const shotSpecs = [{
    id: 'move-forward',
    title: 'MOVE FORWARD',
    width: 1280,
    height: 720,
    fps: 24,
    durationInSeconds: 4,
    elements: [
      { id: 'bg', type: 'rect', x: 0, y: 0, width: 1280, height: 720, fill: '#0F172A' },
      { id: 'accent', type: 'rect', x: 100, y: 600, width: 300, height: 5, fill: '#38BDF8' },
      { id: 'copy', type: 'text', x: 640, y: 360, content: 'MOVE FORWARD', fontSize: 48, fill: '#FFFFFF', anchor: 'middle' },
    ],
  }];
  const requests = [];
  const provider = new GeminiAIProvider({
    apiKey: 'test-api-key',
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      const response = requests.length === 1 ? storyboard : shotSpecs;
      return {
        ok: true,
        async json() {
          const content = requests.length === 1
            ? `User Safety: safe\n\`\`\`json\n${JSON.stringify(response)}\n\`\`\``
            : `Here are the scene specifications:\n${JSON.stringify(response)}`;
          return { candidates: [{ content: { parts: [{ text: content }] } }] };
        },
      };
    },
  });

  assert.deepEqual(await provider.generateStoryboard('Product launch'), storyboard);
  assert.deepEqual(await provider.compileStoryboard(storyboard), shotSpecs);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /gemini-3\.8-flash/);
  assert.equal(requests[0].body.generationConfig.responseSchema.properties.shots.type, 'ARRAY');
  assert.equal(requests[1].body.generationConfig.responseSchema.type, 'ARRAY');
  assert.match(requests[0].body.contents[0].parts[0].text, /Return only a raw JSON value/);
});
