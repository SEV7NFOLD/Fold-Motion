import assert from 'node:assert/strict';
import test from 'node:test';
import { generateProductionAction, getEngineConfig } from '../src/runtime/creative-api.mjs';
import { buildTimeline, createCreativePlan, validateStoryboard } from '../src/production/production.mjs';
import { normalizeHexColor, repairShotSpec, repairStoryboard } from '../src/production/repair.mjs';
import { classifyHttpFailure } from '../src/ai/provider.mjs';

const context = {
  width: 1280, height: 720, fps: 24, primaryColor: '#0B0F19', accentColor: '#00F0FF',
  headline: 'Ideas into motion', subheadline: 'Creativity at scale',
};
const { storyboard } = await createCreativePlan('Cinematic perfume launch film', context, null);
const quiet = { info() {}, warn() {} };

function geminiResponse(payload, status = 200, errorMessage = 'Error.') {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return status === 200
        ? { candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }
        : { error: { message: errorMessage } };
    },
  };
}

function perfectSpec(shot) {
  return {
    id: shot.id, title: shot.id, width: 1280, height: 720, fps: 24, durationInSeconds: shot.durationSeconds,
    elements: [
      { id: 'bg', type: 'rect', x: 0, y: 0, width: 1280, height: 720, fill: '#0B0F19' },
      { id: 'line', type: 'rect', x: 150, y: 500, width: 300, height: 4, fill: '#00F0FF' },
      { id: 'copy', type: 'text', content: shot.onScreenCopy, x: 640, y: 360, fill: '#FFFFFF', fontSize: 48, anchor: 'middle' },
    ],
  };
}

const typicalDeviations = {
  'anchor "center"': (spec) => { spec.elements[2].anchor = 'center'; },
  'uppercased copy': (spec, shot) => { spec.elements[2].content = shot.onScreenCopy.toUpperCase(); },
  'short hex color': (spec) => { spec.elements[2].fill = '#FFF'; },
  'accent bleeding off-canvas': (spec) => { spec.elements[1].x = -20; },
  'unsupported element type': (spec) => { spec.elements.push({ id: 'l', type: 'line', fill: '#00F0FF' }); },
  'off-brand background': (spec) => { spec.elements[0].fill = '#000000'; },
  'wrong duration and format': (spec) => { spec.durationInSeconds = 99; spec.width = 1920; },
  'string numbers': (spec) => { spec.elements[2].fontSize = '48'; spec.elements[2].x = '640'; },
  'missing background and accent': (spec) => { spec.elements.splice(0, 2); },
};

for (const [name, mutate] of Object.entries(typicalDeviations)) {
  test(`compile keeps the AI result when the model output has ${name}`, async () => {
    let calls = 0;
    const result = await generateProductionAction({
      action: 'compile', storyboard, context, apiKeys: ['k1', 'k2', 'k3'], logger: quiet, environment: {},
      fetchImpl: async () => {
        calls += 1;
        return geminiResponse(storyboard.shots.map((shot) => {
          const spec = perfectSpec(shot);
          mutate(spec, shot);
          return spec;
        }));
      },
    });
    assert.equal(result.provider, 'Gemini 3.5 Flash-Lite');
    assert.equal(calls, 1, 'one call, no wasted key rotation');
    assert.ok(result.repairs.length > 0);
    assert.ok(result.telemetry.some(({ stage }) => stage === 'Output repaired'));
    for (const [index, shot] of result.timeline.shots.entries()) {
      assert.ok(shot.spec.elements.some((element) => element.content === storyboard.shots[index].onScreenCopy));
      assert.equal(shot.spec.elements[0].fill, '#0B0F19');
    }
  });
}

test('a quota error on the first key does not burn the remaining keys', async () => {
  const hosts = [];
  const result = await generateProductionAction({
    action: 'storyboard', prompt: 'A title', context: {}, apiKeys: ['a', 'b', 'c'], logger: quiet, environment: {},
    fetchImpl: async (url) => {
      hosts.push(new URL(url).host);
      return geminiResponse({}, 429, 'Resource has been exhausted (e.g. check quota).');
    },
  });
  assert.equal(hosts.length, 1);
  assert.equal(result.provider, 'mock-provider');
  assert.equal(result.fallbackReason, 'quota');
  assert.match(result.warning, /Gemini stopped after 1 of 3 keys \(Gemini: quota reached/);
  assert.ok(result.telemetry.some(({ stage }) => stage === 'Gemini keys skipped'));
});

test('GEMINI_ROTATE_ON_QUOTA=true rotates keys from separate projects on 429', async () => {
  const keys = [];
  const result = await generateProductionAction({
    action: 'storyboard', prompt: 'A title', context: {}, apiKeys: ['a', 'b'], logger: quiet,
    environment: { GEMINI_ROTATE_ON_QUOTA: 'true' },
    fetchImpl: async (_url, options) => {
      const key = options.headers['x-goog-api-key'];
      keys.push(key);
      if (key === 'a') return geminiResponse({}, 429, 'Quota exceeded.');
      const plan = await createCreativePlan('A title', {}, null);
      return geminiResponse(plan.storyboard);
    },
  });
  assert.deepEqual(keys, ['a', 'b']);
  assert.equal(result.provider, 'Gemini 3.5 Flash-Lite');
});

test('unusable output skips the remaining Gemini keys and moves to the next provider', async () => {
  const hosts = [];
  const result = await generateProductionAction({
    action: 'storyboard', prompt: 'A title', context: {}, apiKeys: ['a', 'b', 'c'], logger: quiet,
    environment: { GROQ_API_KEY: 'g' },
    fetchImpl: async (url) => {
      hosts.push(new URL(url).host);
      if (url.includes('googleapis')) {
        return { ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: 'not json at all' }] } }] }; } };
      }
      return { ok: false, status: 503, async json() { return { error: { message: 'Down.' } }; } };
    },
  });
  assert.deepEqual(hosts, ['generativelanguage.googleapis.com', 'api.groq.com']);
  assert.equal(result.provider, 'mock-provider');
  assert.match(result.warning, /Gemini: answer could not be used; Groq: provider overloaded/);
});

test('an invalid API key still rotates to the next key', async () => {
  const keys = [];
  const plan = await createCreativePlan('A title', {}, null);
  const result = await generateProductionAction({
    action: 'storyboard', prompt: 'A title', context: {}, apiKeys: ['bad', 'good'], logger: quiet, environment: {},
    fetchImpl: async (_url, options) => {
      const key = options.headers['x-goog-api-key'];
      keys.push(key);
      return key === 'bad'
        ? geminiResponse({}, 400, 'API key not valid. Please pass a valid API key.')
        : geminiResponse(plan.storyboard);
    },
  });
  assert.deepEqual(keys, ['bad', 'good']);
  assert.equal(result.provider, 'Gemini 3.5 Flash-Lite');
});

test('GEMINI_MODEL and GEMINI_THINKING_LEVEL configure the Gemini request', async () => {
  const plan = await createCreativePlan('A title', {}, null);
  const requests = [];
  const run = (environment) => generateProductionAction({
    action: 'storyboard', prompt: 'A title', context: {}, apiKeys: ['k'], logger: quiet, environment,
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return geminiResponse(plan.storyboard);
    },
  });

  const configured = await run({ GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_THINKING_LEVEL: 'low' });
  assert.match(requests[0].url, /models\/gemini-3\.8-flash:generateContent$/);
  assert.deepEqual(requests[0].body.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  assert.equal(configured.provider, 'Gemini 3.8 Flash');

  await run({});
  assert.match(requests[1].url, /gemini-3\.5-flash-lite/);
  assert.equal(requests[1].body.generationConfig.thinkingConfig, undefined);
});

test('engine config describes providers without exposing keys', () => {
  const engine = getEngineConfig({
    GEMINI_API_KEY: 'secret-1', GEMINI_API_KEY_2: 'secret-2', GROQ_API_KEY: 'secret-3', GEMINI_MODEL: 'gemini-3.8-flash',
  });
  assert.equal(engine.gemini.keys, 2);
  assert.equal(engine.gemini.model, 'gemini-3.8-flash');
  assert.deepEqual(engine.fallbacks.map(({ name, configured }) => [name, configured]), [['Groq', true], ['OpenRouter', false]]);
  assert.ok(!JSON.stringify(engine).includes('secret'));
});

test('HTTP failures are classified for the cascade', () => {
  assert.equal(classifyHttpFailure(429, ''), 'quota');
  assert.equal(classifyHttpFailure(400, 'API key not valid.'), 'auth');
  assert.equal(classifyHttpFailure(404, 'models/gemini-9 is not found'), 'config');
  assert.equal(classifyHttpFailure(503, ''), 'overload');
});

test('timeline validation names the exact check that failed', () => {
  const spec = perfectSpec(storyboard.shots[0]);
  spec.elements[0].fill = '#000000';
  const specs = storyboard.shots.map((shot, index) => (index === 0 ? spec : perfectSpec(shot)));
  assert.throws(() => buildTimeline(storyboard, specs, context), /no full-canvas background rect in #0B0F19/);
});

test('repairShotSpec never mutates its input and handles a missing scene', () => {
  const shot = storyboard.shots[0];
  const input = perfectSpec(shot);
  input.elements[2].anchor = 'center';
  const snapshot = JSON.stringify(input);
  repairShotSpec(input, shot, 0, { ...context });
  assert.equal(JSON.stringify(input), snapshot);

  const { spec, repairs } = repairShotSpec(undefined, shot, 0, { ...context });
  assert.ok(repairs.some((message) => message.includes('built it from the storyboard')));
  assert.equal(spec.elements[0].fill, '#0B0F19');
  assert.ok(spec.elements.some((element) => element.content === shot.onScreenCopy));
});

test('repairStoryboard fills gaps that would otherwise fail validation', () => {
  const partial = {
    title: 'Launch',
    shots: [
      { id: 'a', durationSeconds: '3', onScreenCopy: 'Hello' },
      { id: 'a', durationSeconds: 2, onScreenCopy: 'World', acceptanceCriteria: 'Readable.' },
    ],
  };
  assert.equal(validateStoryboard(partial).valid, false);
  const { storyboard: repaired, repairs } = repairStoryboard(partial, context);
  assert.equal(validateStoryboard(repaired).valid, true);
  assert.equal(repaired.shots[0].durationSeconds, 3);
  assert.equal(repaired.shots[1].id, 'shot-02');
  assert.deepEqual(repaired.shots[1].acceptanceCriteria, ['Readable.']);
  assert.ok(repairs.length > 0);
});

test('normalizeHexColor accepts common color spellings', () => {
  assert.equal(normalizeHexColor('#fff'), '#FFFFFF');
  assert.equal(normalizeHexColor('white'), '#FFFFFF');
  assert.equal(normalizeHexColor('rgb(0, 240, 255)'), '#00F0FF');
  assert.equal(normalizeHexColor('#00F0FFCC'), '#00F0FF');
  assert.equal(normalizeHexColor('transparent'), undefined);
});

test('Gemini storyboard and compile requests carry the FOLD Motion craft prompts', async () => {
  const { STORYBOARD_DIRECTOR, SHOT_COMPILER } = await import('../src/ai/prompts/index.mjs');
  const plan = await createCreativePlan('A title', {}, null);
  const bodies = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    const isCompile = bodies.length > 1;
    return geminiResponse(isCompile ? plan.storyboard.shots.map(perfectSpec) : plan.storyboard);
  };
  const { GeminiAIProvider } = await import('../src/ai/provider.mjs');
  const provider = new GeminiAIProvider({ apiKey: 'k', fetchImpl });
  await provider.generateStoryboard('A title', {});
  await provider.compileStoryboard(plan.storyboard, context);
  assert.ok(bodies[0].contents[0].parts[0].text.includes(STORYBOARD_DIRECTOR));
  assert.ok(bodies[1].contents[0].parts[0].text.includes(SHOT_COMPILER));
  assert.match(bodies[1].contents[0].parts[0].text, /id ending in "-background"/);
});

test('OpenAI-compatible fallbacks get the same craft prompts', async () => {
  const { STORYBOARD_DIRECTOR, SHOT_COMPILER } = await import('../src/ai/prompts/index.mjs');
  const { OpenAICompatibleAIProvider } = await import('../src/ai/provider.mjs');
  const sent = [];
  const provider = new OpenAICompatibleAIProvider({
    name: 'Groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions', apiKey: 'k', model: 'm',
    fetchImpl: async (_url, options) => {
      sent.push(JSON.parse(options.body).messages[1].content);
      return { ok: true, status: 200, async json() { return { choices: [{ message: { content: '{"shotSpecs":[]}' } }] }; } };
    },
  });
  await provider.generateStoryboard('A title', {});
  await provider.compileStoryboard({ shots: [] }, context);
  assert.ok(sent[0].includes(STORYBOARD_DIRECTOR));
  assert.ok(sent[1].includes(SHOT_COMPILER));
});

test('a background without a "-background" id is renamed so it never flashes dark', () => {
  const shot = storyboard.shots[0];
  const input = perfectSpec(shot);
  input.elements[0].id = 'bg';
  const { spec, repairs } = repairShotSpec(input, shot, 0, { ...context });
  assert.equal(spec.elements[0].id, 'shot-1-background');
  assert.ok(repairs.some((message) => message.includes('stays opaque')));
});

test('light brand backgrounds pass contrast QA, including with low-contrast model output', async () => {
  const { evaluateCreativeQA } = await import('../src/production/production.mjs');
  const light = { ...context, primaryColor: '#F0EDE8', accentColor: '#7C3AED' };
  const { storyboard: board } = await createCreativePlan('A bright product reveal', light, null);

  const offline = await generateProductionAction({
    action: 'compile', storyboard: board, context: light, apiKeys: [], logger: quiet, environment: {},
  });
  assert.equal(evaluateCreativeQA(offline.timeline, light).contrast.pass, true);

  const ai = await generateProductionAction({
    action: 'compile', storyboard: board, context: light, apiKeys: ['k'], logger: quiet, environment: {},
    fetchImpl: async () => geminiResponse(board.shots.map((shot) => {
      const spec = perfectSpec(shot);
      spec.elements[0].fill = '#F0EDE8';
      return spec; // white copy on a paper-white background
    })),
  });
  assert.equal(ai.provider, 'Gemini 3.5 Flash-Lite');
  assert.equal(evaluateCreativeQA(ai.timeline, light).contrast.pass, true);
  assert.ok(ai.repairs.some((message) => message.includes('contrast')));
});
