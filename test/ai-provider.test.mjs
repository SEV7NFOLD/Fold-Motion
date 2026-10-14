import assert from 'node:assert/strict';
import test from 'node:test';
import { BaseAIProvider, MockAIProvider } from '../src/ai/provider.mjs';
import { validateSceneSpec } from '../scripts/qa/validate-scene-spec.mjs';

test('BaseAIProvider stores provider options and requires an implementation', async () => {
  const provider = new BaseAIProvider({ name: 'custom', apiKey: 'test-key' });

  assert.equal(provider.name, 'custom');
  assert.equal(provider.apiKey, 'test-key');
  await assert.rejects(
    provider.generateSceneSpec('A scene'),
    /generateSceneSpec\(\) must be implemented/,
  );
});

test('MockAIProvider generates a scene using default context', async () => {
  const provider = new MockAIProvider();
  const scene = await provider.generateSceneSpec('A moving title');

  assert.equal(provider.name, 'mock-provider');
  assert.match(scene.id, /^scene-\d+$/);
  assert.equal(scene.title, 'Generated Scene');
  assert.equal(scene.width, 1280);
  assert.equal(scene.height, 720);
  assert.equal(scene.fps, 24);
  assert.equal(scene.durationInSeconds, 4);
  assert.equal(scene.promptSource, 'A moving title');
  assert.deepEqual(scene.elements.map(({ id, type }) => ({ id, type })), [
    { id: 'bg-rect', type: 'rect' },
    { id: 'title-text', type: 'text' },
  ]);
  assert.equal(scene.elements[0].fill, '#0F172A');
  assert.equal(scene.elements[1].content, 'A moving title');
});

test('MockAIProvider applies context overrides', async () => {
  const scene = await new MockAIProvider().generateSceneSpec(
    'A very long motion title that gets shortened',
    {
      title: 'Brand scene',
      width: 1920,
      height: 1080,
      fps: 30,
      durationInSeconds: 8,
      primaryColor: '#123456',
      accentColor: '#ABCDEF',
    },
  );

  assert.equal(scene.title, 'Brand scene');
  assert.equal(scene.width, 1920);
  assert.equal(scene.height, 1080);
  assert.equal(scene.fps, 30);
  assert.equal(scene.durationInSeconds, 8);
  assert.equal(scene.elements[0].width, 1920);
  assert.equal(scene.elements[0].height, 1080);
  assert.equal(scene.elements[0].fill, '#123456');
  assert.equal(scene.elements[1].x, 960);
  assert.equal(scene.elements[1].y, 540);
  assert.equal(scene.elements[1].fill, '#ABCDEF');
  assert.equal(scene.elements[1].content, 'A very long motion title that ');
});

test('MockAIProvider generates a scene specification accepted by the validator', async () => {
  const provider = new MockAIProvider();
  const scene = await provider.generateSceneSpec(
    'Hero title reveal with neon blue accent',
    {
      width: 1920,
      height: 1080,
      primaryColor: '#000000',
    },
  );

  assert.equal(scene.width, 1920);
  assert.equal(scene.height, 1080);
  assert.equal(scene.elements.length, 2);

  const validation = validateSceneSpec(scene);
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);
});

test('MockAIProvider rejects a missing or non-string prompt', async () => {
  const provider = new MockAIProvider();

  await assert.rejects(provider.generateSceneSpec(''), /Prompt string is required/);
  await assert.rejects(provider.generateSceneSpec(42), /Prompt string is required/);
});
