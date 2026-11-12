import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildAcceptanceSpec, compileCreativePlan, createCreativePlan } from '../src/production/production.mjs';
import { renderProductionProject } from '../scripts/render-production.mjs';

const probe = (file, entries) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', file]).toString().trim();

test('a scored film also exports a silent copy labelled with its tempo', { timeout: 120_000 }, async () => {
  const context = { primaryColor: '#0B0F19', accentColor: '#00F0FF', durationInSeconds: 2 };
  const { storyboard } = await createCreativePlan('A short launch film for Volt Runner', context, null);
  const { timeline } = await compileCreativePlan(storyboard, context, null);
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'fold-silent-'));
  const previous = process.env.FOLD_SCORE; process.env.FOLD_SCORE = 'synth';
  try {
    const { report, reportPath } = await renderProductionProject({ timeline, storyboard, context, acceptance: buildAcceptanceSpec(storyboard, context), music: 'auto', outputRoot });
    assert.equal(report.productionQA.pass, true);
    const dir = path.dirname(reportPath);
    const full = path.join(dir, 'production.mp4'); const silent = path.join(dir, 'production-silent.mp4');
    await stat(silent);
    assert.equal(report.silentExport.bpm, report.audio.bpm, 'labelled with the score tempo');
    assert.equal(report.silentExport.label, `${report.audio.bpm} BPM`);
    assert.ok(report.artifacts.silentVideo.endsWith('/production-silent.mp4'));
    assert.match(probe(full, 'stream=codec_type'), /audio/);
    assert.doesNotMatch(probe(silent, 'stream=codec_type'), /audio/, 'the silent copy has no audio track');
    const frames = (f) => probe(f, 'stream=nb_frames');
    assert.equal(frames(silent), frames(full).split('\n')[0], 'same picture, frame for frame');
  } finally {
    if (previous === undefined) delete process.env.FOLD_SCORE; else process.env.FOLD_SCORE = previous;
    await rm(outputRoot, { recursive: true, force: true });
  }
});
