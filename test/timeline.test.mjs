import assert from 'node:assert/strict';
import test from 'node:test';
import { Timeline } from '../src/timeline/timeline.mjs';

test('Timeline applies default metadata and generates an id', () => {
  const timeline = new Timeline();
  const summary = timeline.getSummary();

  assert.match(summary.id, /^timeline-\d+$/);
  assert.equal(summary.fps, 24);
  assert.equal(summary.width, 1280);
  assert.equal(summary.height, 720);
  assert.equal(summary.totalShots, 0);
  assert.equal(summary.totalFrames, 0);
  assert.equal(summary.totalDurationSeconds, 0);
  assert.deepEqual(summary.shots, []);
});

test('Timeline adds shots with sequential frame ranges and summarizes duration', () => {
  const timeline = new Timeline({ id: 'main', fps: 24, width: 1920, height: 1080 });
  const firstShot = { id: 'opening', durationInSeconds: 2 };
  const secondShot = { id: 'title', durationInSeconds: 1.5 };

  assert.equal(timeline.addShot(firstShot), timeline);
  timeline.addShot(secondShot);

  const summary = timeline.getSummary();
  assert.equal(summary.id, 'main');
  assert.equal(summary.fps, 24);
  assert.equal(summary.width, 1920);
  assert.equal(summary.height, 1080);
  assert.equal(summary.totalShots, 2);
  assert.equal(summary.totalFrames, 84);
  assert.equal(summary.totalDurationSeconds, 3.5);
  assert.deepEqual(summary.shots, [
    { index: 0, spec: firstShot, durationFrames: 48, startFrame: 0, endFrame: 47 },
    { index: 1, spec: secondShot, durationFrames: 36, startFrame: 48, endFrame: 83 },
  ]);
});

test('Timeline correctly sequences multiple shots and calculates frame offsets', () => {
  const timeline = new Timeline({ fps: 24, width: 1280, height: 720 });
  const shot1 = { id: 'shot-01', durationInSeconds: 2 };
  const shot2 = { id: 'shot-02', durationInSeconds: 3 };

  timeline.addShot(shot1);
  timeline.addShot(shot2);

  const summary = timeline.getSummary();

  assert.equal(summary.totalShots, 2);
  assert.equal(summary.totalFrames, 120);
  assert.equal(summary.totalDurationSeconds, 5);
  assert.equal(summary.shots[0].startFrame, 0);
  assert.equal(summary.shots[0].endFrame, 47);
  assert.equal(summary.shots[1].startFrame, 48);
  assert.equal(summary.shots[1].endFrame, 119);
});

test('Timeline uses default shot duration and rounds fractional frame counts', () => {
  const timeline = new Timeline({ fps: 24 });

  timeline.addShot({ id: 'default-duration' });
  timeline.addShot({ id: 'fractional-duration', durationInSeconds: 0.1 });

  assert.deepEqual(
    timeline.shots.map(({ durationFrames, startFrame, endFrame }) => ({
      durationFrames,
      startFrame,
      endFrame,
    })),
    [
      { durationFrames: 96, startFrame: 0, endFrame: 95 },
      { durationFrames: 2, startFrame: 96, endFrame: 97 },
    ],
  );
});

test('Timeline rejects shot specifications without an id', () => {
  const timeline = new Timeline();

  assert.throws(() => timeline.addShot(null), /Invalid shot specification/);
  assert.throws(() => timeline.addShot({}), /Invalid shot specification/);
});
