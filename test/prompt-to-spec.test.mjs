import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAndValidateScene } from '../src/ai/prompt-to-spec.mjs';
import { MockAIProvider } from '../src/ai/provider.mjs';

test('generateAndValidateScene returns a validated spec from the default provider', async () => {
  const result = await generateAndValidateScene('A title reveal');

  assert.equal(result.provider, 'mock-provider');
  assert.equal(result.spec.promptSource, 'A title reveal');
  assert.ok(Number.isFinite(Date.parse(result.validatedAt)));
});

test('generateAndValidateScene passes context to a supplied provider', async () => {
  const provider = new MockAIProvider({ name: 'configured-mock' });
  const result = await generateAndValidateScene('A title reveal', {
    provider,
    context: { width: 1920, height: 1080 },
  });

  assert.equal(result.provider, 'configured-mock');
  assert.equal(result.spec.width, 1920);
  assert.equal(result.spec.height, 1080);
});

test('generateAndValidateScene rejects missing or non-string prompts', async () => {
  await assert.rejects(
    generateAndValidateScene(''),
    /A valid text prompt is required/,
  );
  await assert.rejects(
    generateAndValidateScene(42),
    /A valid text prompt is required/,
  );
});

test('generateAndValidateScene rejects invalid provider output', async () => {
  const provider = {
    name: 'invalid-provider',
    async generateSceneSpec() {
      return { id: 'invalid', elements: [] };
    },
  };

  await assert.rejects(
    generateAndValidateScene('A title reveal', { provider }),
    /AI generated invalid scene specification:[\s\S]*width[\s\S]*height/,
  );
});
