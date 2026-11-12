import assert from 'node:assert/strict';
import test from 'node:test';
import { GeminiAIProvider } from '../src/ai/provider.mjs';
import { LAUNCH_DIRECTOR } from '../src/ai/prompts/index.mjs';
import { compileCreativePlan, createCreativePlan } from '../src/production/production.mjs';
import { fitLaunchStoryboard, launchReadingCheck, launchStoryboardFromBrief, planLaunch } from '../src/production/launch.mjs';

const C = { width: 1920, height: 1080, fps: 30, primaryColor: '#2A2690', accentColor: '#E0337E' };

// Captures what would be sent to Gemini, without a key or the network.
async function capturedRequest(context) {
  const provider = new GeminiAIProvider({ apiKey: 'test-key', fetchImpl: async () => { throw new Error('no network in tests'); } });
  let seen;
  provider.generateStructuredJson = async (instruction, schema) => { seen = { instruction, schema }; throw new Error('captured'); };
  await provider.generateStoryboard('A launch film for amaranthine', context).catch(() => {});
  return seen;
}

test('launch films send the launch instructions to Gemini, and the storyboard schema has a product field', async () => {
  const launch = await capturedRequest({ ...C, launch: true });
  assert.ok(launch.instruction.includes(LAUNCH_DIRECTOR));
  for (const phrase of ['"product"', 'quotation marks', 'checklist', 'counts up', 'Never invent a number', 'ending with a period']) assert.ok(LAUNCH_DIRECTOR.includes(phrase), phrase);
  assert.deepEqual(launch.schema.properties.shots.items.properties.product, { type: 'INTEGER' });
  const plain = await capturedRequest(C);
  assert.ok(!plain.instruction.includes(LAUNCH_DIRECTOR), 'other films are unchanged');
});

test('the offline launch planner uses the brief’s lines, keeps quotes apart, gathers short items, and closes on the brand', () => {
  const base = { id: 'b', shots: [{ id: 'x', durationSeconds: 2, onScreenCopy: 'x' }] };
  const sb = launchStoryboardFromBrief('A bold launch video for Volt Runner. Your night run, upgraded. “Plan a 5K route for tonight” Exact fit. Grip. Glow. 3 colors, one shoe.', base);
  assert.deepEqual(sb.shots.map((s) => s.onScreenCopy), ['Your night run, upgraded.', '“Plan a 5K route for tonight”', 'Exact fit. Grip. Glow.', '3 colors, one shoe.', 'Volt Runner']);
  assert.equal(launchStoryboardFromBrief('Make a film.', base), base, 'too little copy keeps the planner’s own storyboard');
});

test('launch pacing: product numbers checked, photos matched by name to plain lines, extra photos noted', () => {
  const shots = (copies) => ({ shots: copies.map((t, i) => ({ id: `s${i}`, onScreenCopy: t, durationSeconds: 2.5 })) });
  const sb = shots(['Relax & unwind.', 'Aromatherapy bath oil.', 'With neroli, mandarin & lavender.', 'Cleansing balm for all skin types.', 'amaranthine']);
  fitLaunchStoryboard(sb, { fps: 30, products: [{ name: 'balm' }, { name: 'bath oil' }] }, { bpm: 90 });
  assert.deepEqual(sb.shots.map((s) => s.product), [undefined, 2, undefined, 1, undefined]);
  const bad = shots(['Open.', 'Middle line.', 'End']); bad.shots[1].product = 7;
  const notes = fitLaunchStoryboard(bad, { fps: 30, products: [{}] }, { bpm: 120 });
  assert.ok(notes.some((n) => /product 7 is not an uploaded photo/.test(n)));
  assert.equal(bad.shots[1].product, 1, 'replaced by a real photo');
  const extra = shots(['Open line.', 'One plain line.', 'Close']);
  assert.ok(fitLaunchStoryboard(extra, { fps: 30, products: [{}, {}] }, { bpm: 120 }).some((n) => /photo 2 is not used/.test(n)));
});

test('launch pacing gives every shot time to read, keeps a requested length exact, and says when copy cannot fit', () => {
  const make = () => ({ shots: ['Your idea deserves motion.', 'With neroli, mandarin, frankincense & lavender.', '“A 15-second launch film for Volt Runner”', 'Exact copy. Your fonts. On the beat.', 'Ideas into motion.'].map((t, i) => ({ id: `s${i}`, onScreenCopy: t, durationSeconds: 2 })) });
  for (const bpm of [90, 120]) {
    const free = make(); fitLaunchStoryboard(free, { fps: 30 }, { bpm });
    const fpb = 1800 / bpm;
    const timeline = { fps: 30, beat: { bpm, framesPerBeat: fpb }, shots: free.shots.map((s) => ({ shotId: s.id, durationFrames: Math.round(s.durationSeconds * 30), spec: { elements: [] } })) };
    planLaunch(timeline, free);
    assert.equal(launchReadingCheck(timeline).pass, true, `${bpm} BPM`);
    timeline.shots.forEach((s) => assert.equal(s.durationFrames % fpb, 0, 'cuts sit on whole beats'));
  }
  const exact = make(); fitLaunchStoryboard(exact, { fps: 30 }, { bpm: 120, keepTotal: true });
  assert.ok(Math.abs(exact.shots.reduce((t, s) => t + s.durationSeconds, 0) - 10) < 1e-9, 'a requested 10 s stays 10 s');
  const squeezed = make(); squeezed.shots.forEach((s) => { s.durationSeconds = 1; });
  const notes = fitLaunchStoryboard(squeezed, { fps: 30 }, { bpm: 90, keepTotal: true });
  assert.ok(notes.some((n) => /needs about .* to be read/.test(n)), 'too much copy for the length is reported');
});

test('reading time only gets easier with a longer shot, for every device and tempo', () => {
  const copies = ['Relax & unwind.', 'Cleansing balm for all skin types.', 'With neroli, mandarin, frankincense & lavender.', 'A sneaker drop built for night runs.', 'Exact copy. Your fonts. On the beat.', '3 formats, one story.'];
  for (const bpm of [90, 120]) for (const copy of copies) {
    let passed = false;
    for (let b = 2; b <= 16; b += 0.5) {
      const sb = { shots: [{ id: 'a', onScreenCopy: 'Open line here.' }, { id: 'b', onScreenCopy: copy }, { id: 'c', onScreenCopy: 'Close.' }] };
      const fpb = 1800 / bpm;
      const tl = { fps: 30, beat: { bpm, framesPerBeat: fpb }, shots: [8, b, 4].map((n, i) => ({ shotId: 'abc'[i], durationFrames: Math.round(n * fpb), spec: { elements: [] } })) };
      planLaunch(tl, sb);
      const ok = !launchReadingCheck(tl).failures.some((f) => f.shotId === 'b');
      assert.ok(!(passed && !ok), `${copy} at ${bpm} BPM failed at ${b} beats after passing at fewer`);
      if (ok) passed = true;
    }
  }
});

test('a brief becomes a readable launch film offline, from plan to compile', async () => {
  for (const [brief, ctx] of [
    ['A calm launch film for amaranthine. Relax & unwind. Aromatherapy bath oil. With neroli, mandarin, frankincense & lavender. Cleansing balm for all skin types.', { ...C, products: [{ width: 447, height: 559 }, { width: 911, height: 911 }] }],
    ['A bold launch video for Volt Runner. Your night run, upgraded. “Plan a 5K route for tonight” Exact fit. Grip. Glow. 3 colors, one shoe.', { ...C, primaryColor: '#0B0F19', accentColor: '#00F0FF' }],
  ]) {
    const { storyboard } = await createCreativePlan(brief, { ...ctx, launch: true }, null);
    const { timeline } = await compileCreativePlan(storyboard, { ...ctx, launch: true }, null);
    assert.equal(launchReadingCheck(timeline).pass, true, brief);
    assert.ok(timeline.launch.shots.length >= 4);
  }
});

test('the end card holds on purpose: at least two beats beyond its reading time', () => {
  const sb = { shots: ['Your night run, upgraded.', 'Exact fit. Grip. Glow.', 'Volt Runner'].map((t, i) => ({ id: `s${i}`, onScreenCopy: t, durationSeconds: 1 })) };
  fitLaunchStoryboard(sb, { fps: 30 }, { bpm: 120 });
  assert.ok(sb.shots[2].durationSeconds >= 2, `end card ${sb.shots[2].durationSeconds}s`);
});
