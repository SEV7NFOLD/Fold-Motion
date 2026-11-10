import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseMood, chooseTempo, composeScore, encodeWav, extractCues, integratedLoudness, masterScore, MOODS, SAMPLE_RATE,
} from '../src/audio/fold-score.mjs';
import { compileCreativePlan, createCreativePlan } from '../src/production/production.mjs';

const CONTEXT = { primaryColor: '#0E0E11', accentColor: '#7C3AED', products: [{ width: 300, height: 450 }] };
async function productTimeline() {
  const { storyboard } = await createCreativePlan('A launch', CONTEXT, null);
  storyboard.shots = ['Precision in silence', 'Alpha', 'Every drop decided', 'Built to last', 'Alpha', 'Creativity at scale']
    .map((line, i) => ({ ...storyboard.shots[0], id: `shot-0${i + 1}`, onScreenCopy: line, durationSeconds: 1.6 }));
  return (await compileCreativePlan(storyboard, CONTEXT, null)).timeline;
}

test('cues come from the edit: cuts, transitions, letters and the end card', async () => {
  const timeline = await productTimeline();
  const cues = extractCues(timeline);
  const cuts = cues.filter((cue) => cue.type === 'cut');
  assert.equal(cuts.length, timeline.shots.length - 1);
  cuts.forEach((cue, i) => assert.ok(Math.abs(cue.time - timeline.shots[i + 1].startFrame / timeline.fps) < 1e-9));
  const folds = timeline.shots.filter((shot, i) => i < timeline.shots.length - 1 && shot.spec.transitionOut === 'fold').length;
  assert.equal(cues.filter((cue) => cue.type === 'fold-a').length, folds);
  const windowShot = timeline.shots.find((shot) => shot.spec.elements.some((element) => element.window));
  if (windowShot) assert.equal(cues.filter((cue) => cue.type === 'letter').length, 'ALPHA'.length);
  assert.equal(cues.filter((cue) => cue.type === 'endcard').length, 1);
  assert.deepEqual(cues.map((cue) => cue.time), [...cues.map((cue) => cue.time)].sort((a, b) => a - b));
});

test('the tempo lines its beat grid up with the cuts', () => {
  const bpm = chooseTempo([2, 4, 6], [84, 96]);
  const half = 60 / bpm / 2;
  for (const cut of [2, 4, 6]) assert.ok(Math.min(cut % half, half - (cut % half)) < 0.01, `${bpm} bpm`);
});

test('moods come from the brief’s words', () => {
  assert.equal(chooseMood('A calm, luxurious perfume film'), 'premium');
  assert.equal(chooseMood('Bold, punchy and fast'), 'energetic');
  assert.equal(chooseMood('Precise, engineered, data driven'), 'editorial');
  assert.equal(chooseMood('A warm, cozy candle'), 'warm');
  assert.equal(chooseMood('A film'), 'premium');
});

test('every mood composes a deterministic score with every major hit within one frame', async () => {
  const timeline = await productTimeline();
  for (const mood of Object.keys(MOODS)) {
    const score = composeScore(timeline, { mood });
    assert.equal(score.left.length, Math.round((timeline.totalFrames / timeline.fps) * SAMPLE_RATE));
    assert.ok(score.bpm >= MOODS[mood].bpm[0] && score.bpm <= MOODS[mood].bpm[1]);
    assert.equal(score.sync.pass, true, `${mood}: ${score.sync.onTime} of ${score.sync.checked}`);
    const again = composeScore(timeline, { mood });
    assert.ok(score.left.every((value, i) => value === again.left[i]), `${mood} is deterministic`);
  }
});

test('loudness follows BS.1770, and mastering lands on -14 LUFS under the ceiling', async () => {
  const length = SAMPLE_RATE * 3;
  const tone = Float32Array.from({ length }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 997 * i) / SAMPLE_RATE));
  assert.ok(Math.abs(integratedLoudness(tone, tone.slice()) + 20) < 0.4, 'a -20 dBFS stereo tone reads about -20 LUFS');
  const score = masterScore(composeScore(await productTimeline(), { mood: 'energetic' }));
  assert.ok(Math.abs(score.loudness + 14) < 0.3, `${score.loudness} LUFS`);
  assert.ok(score.samplePeak <= -1.9, `${score.samplePeak} dBFS`);
  const wav = encodeWav(score);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), SAMPLE_RATE);
  assert.equal(wav.length, 44 + score.left.length * 4);
});

test('FOLD Score 2: real instruments from the CC0 pack, arranged by the music book, mastered and in sync', { timeout: 120_000 }, async () => {
  const { instrumentBand, loadInstrumentPack, playNote, midiFromName } = await import('../src/audio/band.mjs');
  const { BOOK } = await import('../src/audio/music-book.mjs');
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(new URL('../assets/samples/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.license, 'CC0-1.0');
  for (const instrument of ['piano', 'violins', 'cellos', 'harp', 'glock', 'bass', 'pizz', 'marimba']) assert.ok(manifest.instruments[instrument].zones.length >= 6, instrument);
  for (const mood of Object.values(BOOK)) {
    for (const part of [...mood.pad, mood.keys, mood.bass, mood.sparkle, mood.run, mood.lead].filter(Boolean)) assert.ok(manifest.instruments[part.instrument], part.instrument);
    for (const hit of [mood.hits.cut, mood.hits.swell, ...mood.hits.endcard].filter(Boolean)) assert.ok(manifest.hits[hit.name], hit.name);
  }
  assert.equal(midiFromName('A4'), 69);
  assert.equal(midiFromName('Bb2'), 46);
  // The sampler: pitch-shifted notes, and sustained strings that outlast their sample.
  const pack = loadInstrumentPack();
  const piano = playNote(pack, 'piano', 61, { duration: 1, sampleRate: 48_000 });
  assert.ok(piano.length > 40_000 && piano.some((v) => Math.abs(v) > 0.05), 'a piano note sounds');
  const long = playNote(pack, 'cellos', 50, { duration: 9, release: 0.4, sampleRate: 48_000 });
  assert.equal(long.length, Math.round(9.4 * 48_000), 'strings loop to hold any length');
  const tail = long.slice(8 * 48_000, 8.5 * 48_000);
  assert.ok(Math.sqrt(tail.reduce((sum, v) => sum + v * v, 0) / tail.length) > 0.005, 'and still sound after the sample ends');
  // Every mood: real instruments, mastered to -14 LUFS, in sync, the payoff loudest.
  const context = { primaryColor: '#2A1838', accentColor: '#C9A55C', durationInSeconds: 10 };
  const { storyboard } = await createCreativePlan('A calm film', context, null);
  storyboard.shots = ['Ruby. Sapphire. Emerald.', 'Every ritual, sealed', 'Ten minutes', 'Radiance, renewed', 'Results worth the ritual.'].map((line, i) => ({ ...storyboard.shots[0], id: `shot-0${i + 1}`, onScreenCopy: line, durationSeconds: 2 }));
  const { timeline } = await compileCreativePlan(storyboard, context, null);
  assert.equal(timeline.shots[0].spec.recipe, 'word-beat', 'the offline director makes staccato lines word beats');
  const band = instrumentBand();
  const endcard = timeline.shots.at(-1).startFrame / timeline.fps;
  for (const mood of ['premium', 'energetic', 'editorial', 'warm']) {
    const score = masterScore(composeScore(timeline, { mood, band }), { target: -14, ceiling: -2 });
    assert.equal(score.engine, 'instruments');
    assert.ok(Math.abs(score.loudness + 14) <= 0.6, `${mood}: ${score.loudness}`);
    assert.equal(score.sync.pass, true, mood);
    const rms = (from, to) => { const a = Math.round(from * 48_000); const b = Math.round(to * 48_000); let sum = 0; for (let i = a; i < b; i += 1) sum += score.left[i] ** 2; return Math.sqrt(sum / (b - a)); };
    const payoff = rms(endcard, endcard + 0.6);
    for (let t = 0.5; t < endcard - 0.6; t += 0.5) assert.ok(rms(t, t + 0.6) <= payoff * 1.15, `${mood}: the payoff is the loudest moment (${t}s)`);
  }
  // Without the pack, the band refuses, and the renderer falls back to the synth score.
  assert.throws(() => instrumentBand({ dir: '/nonexistent' }), /instrument pack is missing/);
  assert.equal(composeScore(timeline, { mood: 'premium' }).engine, 'synth');
});
