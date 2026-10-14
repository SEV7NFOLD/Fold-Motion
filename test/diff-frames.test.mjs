import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { diffRenderDirectories } from '../scripts/qa/diff-frames.mjs';

test('diffRenderDirectories reports matching, modified, added, and missing frames', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fold-motion-diff-'));
  const dirA = path.join(root, 'render-a');
  const dirB = path.join(root, 'render-b');
  mkdirSync(dirA);
  mkdirSync(dirB);

  try {
    writeFileSync(path.join(dirA, 'same.svg'), '<svg>same</svg>');
    writeFileSync(path.join(dirA, 'changed.png'), 'old');
    writeFileSync(path.join(dirA, 'removed.svg'), '<svg>removed</svg>');

    writeFileSync(path.join(dirB, 'same.svg'), '<svg>same</svg>');
    writeFileSync(path.join(dirB, 'changed.png'), 'new version');
    writeFileSync(path.join(dirB, 'added.svg'), '<svg>added</svg>');

    const report = diffRenderDirectories(dirA, dirB);

    assert.equal(report.identical, false);
    assert.equal(report.matchPercentage, '33.33%');
    assert.deepEqual(report.summary, {
      totalFrames: 3,
      matching: 1,
      modified: 1,
      added: 1,
      missing: 1,
    });
    assert.deepEqual(report.modifiedFrames.map((frame) => ({
      file: frame.file,
      sizeDiffBytes: frame.sizeDiffBytes,
    })), [{ file: 'changed.png', sizeDiffBytes: 8 }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('diffRenderDirectories reports identical render directories', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fold-motion-identical-'));
  const dirA = path.join(root, 'render-a');
  const dirB = path.join(root, 'render-b');
  mkdirSync(dirA);
  mkdirSync(dirB);

  try {
    writeFileSync(path.join(dirA, 'frame.svg'), '<svg>same</svg>');
    writeFileSync(path.join(dirB, 'frame.svg'), '<svg>same</svg>');

    const report = diffRenderDirectories(dirA, dirB);

    assert.equal(report.identical, true);
    assert.equal(report.matchPercentage, '100.00%');
    assert.deepEqual(report.summary, {
      totalFrames: 1,
      matching: 1,
      modified: 0,
      added: 0,
      missing: 0,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
