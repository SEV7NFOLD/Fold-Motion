import { MockAIProvider } from './provider.mjs';
import { validateSceneSpec } from '../../scripts/qa/validate-scene-spec.mjs';

/**
 * High-level pipeline to convert a natural language prompt into a validated FOLD Motion scene spec.
 * @param {string} prompt Natural language creative direction
 * @param {Object} options Configuration options including provider and rendering context
 * @returns {Promise<{ spec: Object, provider: string, validatedAt: string }>}
 */
export async function generateAndValidateScene(prompt, options = {}) {
  const provider = options.provider || new MockAIProvider();
  const context = options.context || {};

  if (!prompt || typeof prompt !== 'string') {
    throw new Error('A valid text prompt is required to generate a scene specification.');
  }

  const rawSpec = await provider.generateSceneSpec(prompt, context);
  const validation = validateSceneSpec(rawSpec);

  if (!validation.valid) {
    throw new Error(`AI generated invalid scene specification:\n  - ${validation.errors.join('\n  - ')}`);
  }

  return {
    spec: rawSpec,
    provider: provider.name,
    validatedAt: new Date().toISOString(),
  };
}
