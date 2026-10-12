import assert from 'node:assert/strict';
import test from 'node:test';
import { MINIMUM_FREE_BYTES, evaluateHealth, parseNodeMajor } from '../src/runtime/health.mjs';
import { SCENE_01_META, canonicalTimestamp, sceneState } from '../public/scene-01-core.js';
import { renderSceneSvg } from '../public/scene-01-svg.mjs';

test('parses supported Node.js version strings', () => {
  assert.equal(parseNodeMajor('v24.21.0'), 24);
  assert.equal(parseNodeMajor('20.0.0'), 20);
  assert.ok(Number.isNaN(parseNodeMajor('unknown')));
});

test('fails health when a required command is unavailable', () => {
  const report = evaluateHealth({
    nodeVersion: 'v24.21.0',
    commands: [
      { name: 'npm', ok: true, detail: '11.19.0' },
      { name: 'FFmpeg', ok: false, detail: 'not found' },
    ],
    freeBytes: MINIMUM_FREE_BYTES,
  });

  assert.equal(report.ok, false);
});

test('scene 01 resolves canonical timestamps and bounded deterministic state', () => {
  assert.equal(canonicalTimestamp(9, 6), 1.5);
  assert.equal(sceneState(-10).time, 0);
  assert.equal(sceneState(999).time, SCENE_01_META.durationSeconds);
  assert.deepEqual(sceneState(1.75), sceneState(1.75));
  assert.throws(() => canonicalTimestamp(-1, 6), RangeError);
});

test('scene 01 emits a fixed-size SVG frame from its state', () => {
  const frame = renderSceneSvg(sceneState(2.5));

  assert.match(frame, /width="1280" height="720"/);
  assert.match(frame, /SIGNAL/);
  assert.match(frame, /PRECISION IN MOTION/);
});

test('scene 01 holds its final visual state after resolution', () => {
  const resolved = sceneState(3.5);
  const held = sceneState(3.99);

  assert.equal(resolved.titleOpacity, held.titleOpacity);
  assert.equal(resolved.titleY, held.titleY);
  assert.equal(resolved.signalWidth, held.signalWidth);
  assert.equal(resolved.detailOpacity, held.detailOpacity);
});
