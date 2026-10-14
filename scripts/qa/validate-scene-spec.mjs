import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Validates a FOLD Motion scene specification object for schema compliance.
 * @param {Object} scene - The scene object to validate.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSceneSpec(scene) {
  const errors = [];

  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
    return { valid: false, errors: ['Scene specification must be a non-null object.'] };
  }

  if (typeof scene.id !== 'string' || !scene.id.trim()) {
    errors.push('Scene must have a valid string "id".');
  }

  if (typeof scene.width !== 'number' || !Number.isFinite(scene.width) || scene.width <= 0) {
    errors.push('Scene "width" must be a positive number.');
  }
  if (typeof scene.height !== 'number' || !Number.isFinite(scene.height) || scene.height <= 0) {
    errors.push('Scene "height" must be a positive number.');
  }

  if (typeof scene.fps !== 'number' || !Number.isFinite(scene.fps) || scene.fps <= 0) {
    errors.push('Scene "fps" must be a positive number (e.g., 24, 30, 60).');
  }
  if (
    typeof scene.durationInSeconds !== 'number'
    || !Number.isFinite(scene.durationInSeconds)
    || scene.durationInSeconds <= 0
  ) {
    errors.push('Scene "durationInSeconds" must be a positive number.');
  }

  if (!Array.isArray(scene.elements)) {
    errors.push('Scene must contain an "elements" array.');
  } else {
    scene.elements.forEach((element, index) => {
      if (!element || typeof element !== 'object' || Array.isArray(element)) {
        errors.push(`Element at index ${index} must be an object.`);
        return;
      }
      if (typeof element.type !== 'string' || !element.type.trim()) {
        errors.push(`Element at index ${index} missing valid "type".`);
      }
      if (typeof element.id !== 'string' || !element.id.trim()) {
        errors.push(`Element at index ${index} missing valid "id".`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

if (process.argv[1] && path.basename(process.argv[1]) === 'validate-scene-spec.mjs') {
  const samplePath = process.argv[2] || 'src/scenes/scene-01.mjs';

  try {
    const fullPath = path.resolve(samplePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ File not found: ${fullPath}`);
      process.exit(1);
    }

    const sceneModule = await import(pathToFileURL(fullPath).href);
    const scene = sceneModule.default || sceneModule.scene;

    const result = validateSceneSpec(scene);
    if (result.valid) {
      console.log(`✅ Scene specification "${scene.id || samplePath}" is valid!`);
      process.exit(0);
    }

    console.error(`❌ Scene validation failed with ${result.errors.length} error(s):`);
    result.errors.forEach((error) => console.error(`   - ${error}`));
    process.exit(1);
  } catch (error) {
    console.error(`❌ Failed to load or parse scene file: ${error.message}`);
    process.exit(1);
  }
}
