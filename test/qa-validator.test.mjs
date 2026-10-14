import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSceneSpec } from '../scripts/qa/validate-scene-spec.mjs';

test('validateSceneSpec passes for a valid scene', () => {
  const validScene = {
    id: 'scene-01',
    width: 1280,
    height: 720,
    fps: 24,
    durationInSeconds: 4,
    elements: [
      { id: 'bg', type: 'rect' },
      { id: 'title', type: 'text' }
    ]
  };

  const result = validateSceneSpec(validScene);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('validateSceneSpec catches missing required fields', () => {
  const invalidScene = {
    width: 1280,
    elements: []
  };

  const result = validateSceneSpec(invalidScene);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 3);
});
