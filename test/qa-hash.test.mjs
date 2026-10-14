import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { hashContent, generateFrameManifest } from '../scripts/qa/generate-frame-hashes.mjs';

test('hashContent produces deterministic SHA-256 output', () => {
  const input = 'FOLD Motion deterministic state test';
  const hash1 = hashContent(input);
  const hash2 = hashContent(input);

  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 64); // SHA-256 hex length
});

test('generateFrameManifest lists and hashes frames in a folder', () => {
  // Setup temp folder with mock frame files
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-qa-test-'));

  fs.writeFileSync(path.join(tmpDir, 'frame_0001.svg'), '<svg>Frame 1</svg>');
  fs.writeFileSync(path.join(tmpDir, 'frame_0002.svg'), '<svg>Frame 2</svg>');

  const manifest = generateFrameManifest(tmpDir);

  assert.equal(manifest.totalFrames, 2);
  assert.equal(manifest.frames[0].file, 'frame_0001.svg');
  assert.equal(manifest.frames[1].file, 'frame_0002.svg');
  assert.ok(manifest.frames[0].sha256);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
