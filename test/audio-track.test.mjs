import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AudioTrackManager } from '../src/audio/audio-track.mjs';

test('AudioTrackManager returns empty FFmpeg arguments with no tracks', () => {
  assert.deepEqual(new AudioTrackManager().buildFFmpegAudioArgs(), {
    inputs: [],
    filterComplex: '',
  });
});

test('AudioTrackManager converts a single track offset and volume to FFmpeg arguments', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fold-motion-audio-'));

  try {
    const audioFile = path.join(directory, 'music.wav');
    writeFileSync(audioFile, 'mock audio');

    const manager = new AudioTrackManager({ fps: 24 });
    const track = manager.addTrack({
      id: 'music',
      filePath: audioFile,
      startFrame: 24,
      volume: 0.5,
      cues: [{ frame: 24, label: 'beat-drop' }],
    });

    assert.equal(track.startTimeSeconds, 1);
    assert.equal(track.volume, 0.5);
    assert.deepEqual(track.cues, [{ frame: 24, label: 'beat-drop' }]);
    assert.deepEqual(manager.buildFFmpegAudioArgs(), {
      inputs: ['-i', path.resolve(audioFile)],
      filterComplex: '[0:a]adelay=1000|1000,volume=0.5[a0]',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('AudioTrackManager builds a mix filter for multiple tracks', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fold-motion-audio-mix-'));

  try {
    const firstFile = path.join(directory, 'first.wav');
    const secondFile = path.join(directory, 'second.wav');
    writeFileSync(firstFile, 'first');
    writeFileSync(secondFile, 'second');

    const manager = new AudioTrackManager({ fps: 24 });
    manager.addTrack({ id: 'first', filePath: firstFile });
    manager.addTrack({ id: 'second', filePath: secondFile, startFrame: 12 });

    assert.deepEqual(manager.buildFFmpegAudioArgs(), {
      inputs: ['-i', path.resolve(firstFile), '-i', path.resolve(secondFile)],
      filterComplex: [
        '[0:a]adelay=0|0,volume=1[a0]',
        '[1:a]adelay=500|500,volume=1[a1]',
        '[a0][a1]amix=inputs=2:duration=longest[outa]',
      ].join(';'),
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('AudioTrackManager rejects invalid configuration and missing audio files', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fold-motion-audio-invalid-'));

  try {
    assert.throws(() => new AudioTrackManager({ fps: 0 }), /frame rate must be a positive number/);

    const manager = new AudioTrackManager();
    assert.throws(() => manager.addTrack(null), /valid "id" and "filePath"/);
    assert.throws(
      () => manager.addTrack({ id: 'missing', filePath: path.join(directory, 'missing.wav') }),
      /Audio file not found/,
    );

    const audioFile = path.join(directory, 'audio.wav');
    writeFileSync(audioFile, 'mock audio');
    assert.throws(
      () => manager.addTrack({ id: 'invalid-offset', filePath: audioFile, startFrame: -1 }),
      /startFrame.*non-negative integer/,
    );
    assert.throws(
      () => manager.addTrack({ id: 'invalid-volume', filePath: audioFile, volume: Number.NaN }),
      /volume.*non-negative number/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
