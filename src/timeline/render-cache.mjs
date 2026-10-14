import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }

  return value;
}

function validateSpecHash(specHash) {
  if (typeof specHash !== 'string' || !/^[a-f0-9]{64}$/i.test(specHash)) {
    throw new Error('Spec hash must be a 64-character SHA-256 hex string.');
  }
}

/**
 * Manages render caching for FOLD Motion shots based on state hashes.
 */
export class RenderCache {
  constructor(cacheDir = path.resolve('.fold-cache')) {
    this.cacheDir = cacheDir;
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  /**
   * Computes a deterministic hash for a scene specification object.
   * @param {Object} spec Scene specification
   * @returns {string} SHA-256 hex string
   */
  hashSpec(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new TypeError('Scene specification must be an object.');
    }

    const canonicalJson = JSON.stringify(canonicalize(spec));
    return crypto.createHash('sha256').update(canonicalJson).digest('hex');
  }

  /**
   * Checks if a cached render exists for a given scene spec hash.
   * @param {string} specHash
   * @returns {string|null} Path to cached render directory or null
   */
  getCachePath(specHash) {
    validateSpecHash(specHash);

    const targetPath = path.join(this.cacheDir, specHash);
    if (
      fs.existsSync(targetPath)
      && fs.statSync(targetPath).isDirectory()
      && fs.existsSync(path.join(targetPath, 'manifest.json'))
      && fs.statSync(path.join(targetPath, 'manifest.json')).isFile()
    ) {
      return targetPath;
    }
    return null;
  }

  /**
   * Registers or copies a render output into the cache.
   * @param {string} specHash
   * @param {string} sourceDir
   * @returns {string} Path to the cached render directory
   */
  storeInCache(specHash, sourceDir) {
    validateSpecHash(specHash);
    if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
      throw new Error(`Source render directory does not exist: ${sourceDir}`);
    }

    const targetPath = path.join(this.cacheDir, specHash);
    fs.mkdirSync(targetPath, { recursive: true });

    for (const file of fs.readdirSync(sourceDir)) {
      const srcFile = path.join(sourceDir, file);
      const destFile = path.join(targetPath, file);
      if (fs.statSync(srcFile).isFile()) {
        fs.copyFileSync(srcFile, destFile);
      }
    }
    return targetPath;
  }
}
