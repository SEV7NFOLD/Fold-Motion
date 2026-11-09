import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readFontMetrics } from '../public/font-metrics.mjs';
import { buildAcceptanceSpec, compileCreativePlan, createCreativePlan } from '../src/production/production.mjs';
import { renderProductionProject } from '../scripts/render-production.mjs';

test('a film renders with an uploaded brand font and passes QA', { timeout: 120_000 }, async () => {
  // Montserrat Medium stands in for an uploaded brand font.
  const file = await readFile(new URL('../assets/fonts/Montserrat-Medium.ttf', import.meta.url));
  const context = { primaryColor: '#0B0907', accentColor: '#C9A24A', durationInSeconds: 2, brandFont: readFontMetrics(file) };
  const { storyboard } = await createCreativePlan('A calm film for OBSIDIAN loafers', context, null);
  const { timeline } = await compileCreativePlan(storyboard, context, null);
  assert.ok(timeline.shots.some((shot) => shot.spec.elements.some((element) => String(element.font).startsWith('brand-'))));
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'fold-font-'));
  try {
    const { report } = await renderProductionProject({
      timeline, storyboard, context, acceptance: buildAcceptanceSpec(storyboard, context), music: 'off', outputRoot,
      assets: { font: { dataUri: `data:font/ttf;base64,${file.toString('base64')}` } },
    });
    assert.equal(report.productionQA.pass, true);
    assert.equal(report.creativeQA.pass, true);
    assert.equal(report.creativeQA.frameFit.pass, true);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
