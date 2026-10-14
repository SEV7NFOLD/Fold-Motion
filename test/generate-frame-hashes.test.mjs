import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateFrameManifest, hashContent } from '../scripts/qa/generate-frame-hashes.mjs';

test('hashContent returns a SHA-256 hex digest for strings and buffers', () => {
  const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

  assert.equal(hashContent('abc'), expected);
  assert.equal(hashContent(Buffer.from('abc')), expected);
});

test('generateFrameManifest sorts frame files and records their hashes and sizes', () => {
  const renderDir = mkdtempSync(path.join(os.tmpdir(), 'fold-motion-frames-'));
  try {
    writeFileSync(path.join(renderDir, 'frame-0001.png'), 'png frame');
    writeFileSync(path.join(renderDir, 'frame-0000.svg'), '<svg/>');
    writeFileSync(path.join(renderDir, 'notes.txt'), 'ignore');
    mkdirSync(path.join(renderDir, 'nested'));
    writeFileSync(path.join(renderDir, 'nested', 'frame-0002.png'), 'nested frame');

    const manifest = generateFrameManifest(renderDir);

    assert.equal(manifest.totalFrames, 2);
    assert.equal(manifest.renderDir, path.basename(renderDir));
    assert.deepEqual(manifest.frames, [
      {
        file: 'frame-0000.svg',
        sizeBytes: 6,
        sha256: hashContent('<svg/>'),
      },
      {
        file: 'frame-0001.png',
        sizeBytes: 9,
        sha256: hashContent('png frame'),
      },
    ]);
    assert.ok(Number.isFinite(Date.parse(manifest.generatedAt)));
  } finally {
    rmSync(renderDir, { recursive: true, force: true });
  }
});

test('generateFrameManifest rejects a missing directory', () => {
  const missingDirectory = path.join(os.tmpdir(), `missing-frames-${process.pid}`);

  assert.throws(
    () => generateFrameManifest(missingDirectory),
    new RegExp(`Directory does not exist: ${missingDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
});
