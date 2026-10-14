import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RenderCache } from '../src/timeline/render-cache.mjs';

test('hashSpec is stable across object key order, including nested objects', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fold-motion-cache-hash-'));

  try {
    const cache = new RenderCache(path.join(root, 'cache'));
    const first = {
      id: 'scene-01',
      elements: [{ id: 'title', style: { color: '#fff', fontSize: 48 } }],
    };
    const reordered = {
      elements: [{ style: { fontSize: 48, color: '#fff' }, id: 'title' }],
      id: 'scene-01',
    };
    const changed = {
      ...reordered,
      elements: [{ ...reordered.elements[0], style: { fontSize: 49, color: '#fff' } }],
    };

    assert.equal(cache.hashSpec(first), cache.hashSpec(reordered));
    assert.notEqual(cache.hashSpec(first), cache.hashSpec(changed));
    assert.match(cache.hashSpec(first), /^[a-f0-9]{64}$/);
    assert.throws(() => cache.hashSpec(null), /Scene specification must be an object/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('storeInCache copies files and getCachePath requires a manifest', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fold-motion-cache-store-'));
  const sourceDir = path.join(root, 'render');
  const cacheDir = path.join(root, 'cache');
  mkdirSync(sourceDir);

  try {
    const cache = new RenderCache(cacheDir);
    const specHash = cache.hashSpec({ id: 'scene-01' });

    assert.equal(cache.getCachePath(specHash), null);
    writeFileSync(path.join(sourceDir, 'frame.svg'), '<svg/>');
    writeFileSync(path.join(sourceDir, 'manifest.json'), '{"totalFrames":1}');

    const cachedPath = cache.storeInCache(specHash, sourceDir);

    assert.equal(cache.getCachePath(specHash), cachedPath);
    assert.equal(readFileSync(path.join(cachedPath, 'frame.svg'), 'utf8'), '<svg/>');
    assert.equal(readFileSync(path.join(cachedPath, 'manifest.json'), 'utf8'), '{"totalFrames":1}');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cache operations reject invalid hashes and missing source directories', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fold-motion-cache-invalid-'));

  try {
    const cache = new RenderCache(path.join(root, 'cache'));
    assert.throws(() => cache.getCachePath('..'), /64-character SHA-256/);
    assert.throws(() => cache.storeInCache('..', root), /64-character SHA-256/);
    assert.throws(
      () => cache.storeInCache('a'.repeat(64), path.join(root, 'missing')),
      /Source render directory does not exist/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
