import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AudioTrackManager } from '../src/audio/audio-track.mjs';

test('AudioTrackManager validates and registers audio tracks', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-audio-test-'));

  try {
    const fakeAudioPath = path.join(tmpDir, 'test-audio.mp3');
    fs.writeFileSync(fakeAudioPath, 'fake mp3 buffer');

    const manager = new AudioTrackManager({ fps: 24 });
    const track = manager.addTrack({
      id: 'voiceover',
      filePath: fakeAudioPath,
      startFrame: 24,
      volume: 0.8,
    });

    assert.equal(track.id, 'voiceover');
    assert.equal(track.startFrame, 24);
    assert.equal(track.startTimeSeconds, 1.0);
    assert.equal(track.volume, 0.8);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('AudioTrackManager throws on missing audio file', () => {
  const manager = new AudioTrackManager({ fps: 24 });
  assert.throws(
    () => manager.addTrack({ id: 'missing', filePath: 'non-existent.mp3' }),
    /Audio file not found/,
  );
});
