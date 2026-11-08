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
