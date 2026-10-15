'use strict';
// Run with: node --test
process.env.GEMINI_API_KEYS = 'k1,k2,k3';
process.env.GROQ_API_KEY = 'g';
process.env.OPENROUTER_API_KEY = 'o';
process.env.AI_CALL_TIMEOUT_MS = '400';
process.env.AI_PROVIDER_BUDGET_MS = '1500';
process.env.AI_TOTAL_BUDGET_MS = '4000';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { generateStoryboard, detectNiche } = require('../src/resilient/ruleEngine.cjs');
const { generateStoryboardResilient, _internals } = require('../src/resilient/cascade.cjs');

const realFetch = global.fetch;
beforeEach(() => { _internals.breaker.state.clear(); global.fetch = realFetch; });

const res = (status, body) => ({ ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const hang = (init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)));

test('niche detection', () => {
  assert.equal(detectNiche('Cinematic 30s promo for The George Hotel in Ikoyi').id, 'hospitality');
  assert.equal(detectNiche('Listing video for luxury apartments, real estate').id, 'real_estate');
  assert.equal(detectNiche('Brand reel for our digital agency portfolio').id, 'agency');
  assert.equal(detectNiche('We fly from the airport').id, 'generic'); // "ai" must not match "air"
  assert.equal(detectNiche('asdf').id, 'generic');
});

test('brand, duration and aspect are parsed; timings add up', () => {
  for (const d of [6, 15, 30, 60, 120]) {
    const sb = generateStoryboard(`${d} second vertical reel for The George Hotel`);
    assert.equal(sb.brand, 'The George Hotel');
    assert.equal(sb.aspectRatio, '9:16');
    assert.equal(sb.totalDuration, d);
    const sum = sb.scenes.reduce((s, x) => s + x.duration, 0);
    assert.ok(Math.abs(sum - d) < 0.05, `durations sum ${sum} != ${d}`);
    assert.equal(sb.scenes.at(-1).end, d);
  }
});

test('deterministic: same brief gives identical output', () => {
  const brief = 'Luxury hotel teaser for "Appleville Suites", 30s';
  assert.deepEqual(generateStoryboard(brief), generateStoryboard(brief));
});

test('rule engine never throws on garbage input', () => {
  for (const x of [null, undefined, 42, {}, [], '', '🔥'.repeat(10000), 'x'.repeat(1e6)]) {
    assert.ok(generateStoryboard(x).scenes.length >= 3);
  }
});

test('AI enhancement merges into baseline and keeps timings', async () => {
  const base = generateStoryboard('Promo for a hotel');
  const ai = {
    title: 'AI Title',
    scenes: base.scenes.map((s) => ({ onScreenText: `AI ${s.index}`, duration: 999 })),
  };
  global.fetch = async (url, init) => {
    if (String(url).includes('generativelanguage')) return res(503, 'overloaded');
    if (String(url).includes('groq.com')) return res(200, { choices: [{ message: { content: '```json\n' + JSON.stringify(ai) + '\n```' } }] });
    return hang(init);
  };
  const r = await generateStoryboardResilient('Promo for a hotel');
  assert.equal(r.source, 'groq');
  assert.equal(r.storyboard.title, 'AI Title');
  assert.equal(r.storyboard.scenes[0].onScreenText, 'AI 1');
  assert.equal(r.storyboard.scenes[0].duration, base.scenes[0].duration); // timings untouched
  assert.equal(r.storyboard.scenes[0].shot, base.scenes[0].shot);         // missing fields fall back
});

test('falls back to rules when every network call throws', async () => {
  global.fetch = async () => { throw new Error('boom'); };
  const r = await generateStoryboardResilient('Promo for a hotel');
  assert.equal(r.source, 'rules');
  assert.ok(r.storyboard.scenes.length >= 3);
});

test('falls back to rules on 503 / 404 / hang (your exact failure mix)', async () => {
  global.fetch = async (url, init) => {
    if (String(url).includes('generativelanguage')) return res(503, 'high demand');
    if (String(url).includes('groq.com')) return res(404, { error: { message: 'model does not exist' } });
    return hang(init);
  };
  const r = await generateStoryboardResilient('Promo for a hotel');
  assert.equal(r.source, 'rules');
  assert.ok(r.attempts.some((a) => a.provider === 'groq' && a.kind === 'config'));
  assert.ok(r.totalMs < 5000);
});

test('malformed AI output is rejected, not propagated', async () => {
  global.fetch = async () => res(200, { choices: [{ message: { content: '{"scenes":[]}' } }], candidates: [] });
  const r = await generateStoryboardResilient('Promo for a hotel');
  assert.equal(r.source, 'rules');
});
