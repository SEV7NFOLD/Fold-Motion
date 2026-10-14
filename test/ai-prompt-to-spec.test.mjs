import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAndValidateScene } from '../src/ai/prompt-to-spec.mjs';

test('generateAndValidateScene pipeline successfully generates and validates a scene spec', async () => {
  const result = await generateAndValidateScene('Kinetic typography intro sequence', {
    context: {
      width: 1280,
      height: 720,
      fps: 24,
      primaryColor: '#0F172A',
      accentColor: '#38BDF8',
    },
  });

  assert.ok(result.spec);
  assert.equal(result.provider, 'mock-provider');
  assert.equal(result.spec.width, 1280);
  assert.equal(result.spec.height, 720);
  assert.ok(result.validatedAt);
});

test('generateAndValidateScene throws on missing prompt', async () => {
  await assert.rejects(
    async () => generateAndValidateScene(''),
    /A valid text prompt is required/,
  );
});
