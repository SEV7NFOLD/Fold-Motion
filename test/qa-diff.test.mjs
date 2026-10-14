import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { diffRenderDirectories } from '../scripts/qa/diff-frames.mjs';

test('diffRenderDirectories identifies identical render folders', () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-qa-diff-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-qa-diff-b-'));

  try {
    fs.writeFileSync(path.join(dirA, 'frame_0001.svg'), '<svg>Frame 1</svg>');
    fs.writeFileSync(path.join(dirB, 'frame_0001.svg'), '<svg>Frame 1</svg>');

    const report = diffRenderDirectories(dirA, dirB);

    assert.equal(report.identical, true);
    assert.equal(report.matchPercentage, '100.00%');
    assert.equal(report.summary.matching, 1);
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

test('diffRenderDirectories detects modified frames', () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-qa-diff-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-qa-diff-b-'));

  try {
    fs.writeFileSync(path.join(dirA, 'frame_0001.svg'), '<svg>Frame 1 Original</svg>');
    fs.writeFileSync(path.join(dirB, 'frame_0001.svg'), '<svg>Frame 1 Modified Content</svg>');

    const report = diffRenderDirectories(dirA, dirB);

    assert.equal(report.identical, false);
    assert.equal(report.summary.modified, 1);
    assert.equal(report.modifiedFrames[0].file, 'frame_0001.svg');
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});
