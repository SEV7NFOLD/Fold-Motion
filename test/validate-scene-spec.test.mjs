import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSceneSpec } from '../scripts/qa/validate-scene-spec.mjs';

const validScene = {
  id: 'scene-01',
  width: 1280,
  height: 720,
  fps: 24,
  durationInSeconds: 4,
  elements: [{ id: 'title', type: 'text' }],
};

test('accepts a valid scene specification', () => {
  assert.deepEqual(validateSceneSpec(validScene), { valid: true, errors: [] });
});

test('reports invalid scene metadata and dimensions', () => {
  const result = validateSceneSpec({
    ...validScene,
    id: ' ',
    width: Number.POSITIVE_INFINITY,
    height: 0,
    fps: Number.NaN,
    durationInSeconds: -1,
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 5);
});

test('reports malformed elements without throwing', () => {
  const result = validateSceneSpec({
    ...validScene,
    elements: [null, { id: '', type: 12 }],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    'Element at index 0 must be an object.',
    'Element at index 1 missing valid "type".',
    'Element at index 1 missing valid "id".',
  ]);
});

test('rejects non-object scene specifications', () => {
  assert.deepEqual(validateSceneSpec(null), {
    valid: false,
    errors: ['Scene specification must be a non-null object.'],
  });
  assert.equal(validateSceneSpec([]).valid, false);
});
