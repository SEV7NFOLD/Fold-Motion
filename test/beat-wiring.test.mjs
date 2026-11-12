import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildAcceptanceSpec, compileCreativePlan, createCreativePlan, validateTimeline } from '../src/production/production.mjs';
import { beatGrid, measureBeatSync, timelineBeatEvents } from '../src/production/beat-clock.mjs';
import { composeScore } from '../src/audio/fold-score.mjs';
import { renderProductionProject } from '../scripts/render-production.mjs';

const C = { width: 1920, height: 1080, fps: 30, primaryColor: '#0B0F19', accentColor: '#00F0FF' };
async function compile(brief, extra = {}) {
  const { storyboard } = await createCreativePlan(brief, { ...C, ...extra }, null);
  const plain = (await compileCreativePlan(storyboard, C, null)).timeline;
  return { storyboard, plain, timed: (beat) => compileCreativePlan(storyboard, { ...C, beat }, null).then((r) => r.timeline) };
}
const reveals = (timeline) => timeline.shots.flatMap((shot) => shot.spec.elements.filter((e) => Number.isFinite(e.reveal?.start)).map((e) => shot.startFrame + e.reveal.start * timeline.fps));

test('without a beat setting, films compile exactly as before', async () => {
  const { storyboard, plain } = await compile('Volt Runner. A sneaker drop built for night runs. Available Friday.');
  assert.equal(plain.beat, undefined);
  const again = (await compileCreativePlan(storyboard, { ...C, beat: false }, null)).timeline;
  assert.deepEqual(again, plain);
});

test('an energetic beat film puts every cut on a beat and every reveal on a half-beat, keeping its length', async () => {
  const { plain, timed } = await compile('Volt Runner. A sneaker drop built for night runs. Available Friday.', { durationInSeconds: 9 });
  const timeline = await timed({ mood: 'energetic' });
  assert.deepEqual(timeline.beat, { bpm: 120, mood: 'energetic', framesPerBeat: 15, cuts: 'beat', reveals: 'half-beat' });
  assert.equal(validateTimeline(timeline).valid, true);
  assert.equal(timeline.totalFrames, plain.totalFrames, 'same length');
  timeline.shots.slice(1).forEach((shot) => assert.equal(shot.startFrame % 15, 0, `cut at ${shot.startFrame}`));
  reveals(timeline).forEach((f) => assert.ok(Math.abs(f - Math.round(f / 7.5) * 7.5) <= 0.5 + 1e-9, `reveal at ${f}`));
  timeline.shots.forEach((shot) => assert.ok(shot.durationFrames >= 30, 'every shot keeps at least a second'));
  assert.equal(measureBeatSync(beatGrid({ bpm: 120, fps: 30, durationInSeconds: timeline.durationInSeconds }), timelineBeatEvents(timeline)).pass, true);
});

test('a calm product brief gets the calm tempo, and an explicit tempo is honoured', async () => {
  const { storyboard, timed } = await compile('Aromatherapy bath oil. Relax and unwind. Handmade in Scotland.', { durationInSeconds: 9 });
  assert.equal(storyboard.musicMood, 'premium', 'wellness briefs lean calm');
  const calm = await timed(true);
  assert.equal(calm.beat.bpm, 90);
  calm.shots.slice(1).forEach((shot) => assert.equal(shot.startFrame % 20, 0));
  const ninetySix = await timed({ bpm: 96 });                  // 18.75 frames a beat: beats fall between frames
  assert.equal(ninetySix.beat.bpm, 96);
  assert.equal(measureBeatSync(beatGrid({ bpm: 96, fps: 30, durationInSeconds: ninetySix.durationInSeconds }), timelineBeatEvents(ninetySix)).pass, true);
});

test('FOLD Score plays at the film’s tempo and mood when the film has beat timing', async () => {
  const { timed } = await compile('Volt Runner. A sneaker drop built for night runs.', { durationInSeconds: 6 });
  const timeline = await timed({ mood: 'premium', bpm: 92 });
  const score = composeScore(timeline, { mood: 'energetic' });     // an explicit mood still follows the film’s beat
  assert.equal(score.bpm, 92);
  assert.equal(score.mood, 'premium');
});

test('a beat film renders with beat sync in its QA and the score on its tempo', { timeout: 150_000 }, async () => {
  const { storyboard, timed } = await compile('Volt Runner. A sneaker drop built for night runs. Available Friday.', { durationInSeconds: 4 });
  const timeline = await timed({ mood: 'energetic' });
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'fold-beat-'));
  const previous = process.env.FOLD_SCORE; process.env.FOLD_SCORE = 'synth';
  try {
    const { report } = await renderProductionProject({ timeline, storyboard, context: C, acceptance: buildAcceptanceSpec(storyboard, C), music: 'auto', outputRoot });
    assert.equal(report.productionQA.pass, true, JSON.stringify(report.productionQA.beatSync));
    assert.equal(report.productionQA.beatSync.pass, true);
    assert.equal(report.productionQA.beatSync.bpm, 120);
    assert.equal(report.productionQA.beatSync.scoreBpm, 120);
    assert.equal(report.audio.bpm, 120);
    assert.equal(report.silentExport.label, '120 BPM');
  } finally {
    if (previous === undefined) delete process.env.FOLD_SCORE; else process.env.FOLD_SCORE = previous;
    await rm(outputRoot, { recursive: true, force: true });
  }
});
