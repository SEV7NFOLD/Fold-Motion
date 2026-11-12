import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileCreativePlan, createCreativePlan } from '../src/production/production.mjs';
import { BROWSER_RENDERER, buildScenePage, openScene, renderBrowserProject, sampleTimes, timelineFonts } from '../src/browser/render-browser.mjs';

const CONTEXT = { width: 640, height: 360, fps: 12, durationInSeconds: 3, primaryColor: '#0B0F19', accentColor: '#00F0FF' };

async function plan(brief = 'Volt Runner. Built for night runs.') {
  const { storyboard, acceptance } = await createCreativePlan(brief, CONTEXT, null);
  const { timeline } = await compileCreativePlan(storyboard, CONTEXT, null);
  return { timeline, storyboard, acceptance, context: CONTEXT };
}

// Real-browser tests run only where Chromium is installed (npx playwright install chromium).
let browserAvailable = false;
try {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  await browser.close();
  browserAvailable = true;
} catch {
  browserAvailable = false;
}
const needsBrowser = browserAvailable ? {} : { skip: 'Chromium for Playwright is not installed' };

test('sub-frame samples are centred on the frame and stay inside the film', () => {
  assert.deepEqual(sampleTimes(10, 10, 1, 0.5, 100), [1]);
  const four = sampleTimes(10, 10, 4, 0.5, 100);
  assert.equal(four.length, 4);
  assert.ok(Math.abs(four.reduce((a, b) => a + b, 0) / 4 - 1) < 1e-9, 'samples average to the frame time');
  assert.ok(Math.max(...four) - Math.min(...four) < 0.05, 'samples span less than the shutter');
  assert.ok(sampleTimes(0, 10, 4, 0.5, 100).every((t) => t >= 0));
  assert.ok(sampleTimes(99, 10, 4, 0.5, 100).every((t) => t <= 9.9));
});

test('the scene page inlines the timeline fonts and cannot be broken out of by copy', async () => {
  const { timeline } = await plan();
  timeline.shots[0].spec.elements.find((el) => el.role === 'title').shown = '</script><script>alert(1)</script>';
  const { fonts, missing } = await timelineFonts(timeline);
  assert.deepEqual(missing, []);
  const html = await buildScenePage(timeline, fonts);
  assert.ok(html.includes('@font-face'), 'fonts are inlined');
  assert.equal((html.match(/<\/script>/g) || []).length, 1, 'copy cannot close the data script');
});

test('the browser draws the engine layout: exact copy, in frame, letters not collapsed', needsBrowser, async () => {
  const { timeline } = await plan('A sneaker drop called Volt Runner. Available Friday.');
  const scene = await openScene(timeline);
  try {
    const checks = await scene.check();
    assert.equal(checks.length, timeline.shots.length);
    for (const shot of checks) assert.ok(shot.pass, `${shot.shotId}: ${JSON.stringify(shot)}`);
  } finally {
    await scene.close();
  }
});

test('browser frames are deterministic, whatever was drawn before', needsBrowser, async () => {
  const { timeline } = await plan();
  const scene = await openScene(timeline);
  try {
    const t = (timeline.totalFrames / timeline.fps) * 0.4;
    await scene.draw(t);
    const first = await scene.capture();
    await scene.draw(0.1);
    await scene.draw(t);
    const again = await scene.capture();
    assert.ok(first.equals(again), 'the same moment draws the same pixels');
  } finally {
    await scene.close();
  }
});

test('a browser render produces a validated film with the experimental label', needsBrowser, async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'fold-browser-'));
  try {
    const request = await plan();
    const { report } = await renderBrowserProject({ ...request, music: 'off', samples: 2, outputRoot });
    assert.equal(report.renderer, BROWSER_RENDERER);
    assert.equal(report.experimental, true);
    assert.ok(report.runId.endsWith('-browser'), 'browser runs are labelled, never mistaken for SVG renders');
    assert.ok(report.productionQA.pass, JSON.stringify(report.productionQA));
    assert.equal(report.productionQA.frameIntegrity.encodedVideoFrames, request.timeline.totalFrames);
    assert.ok(report.creativeQA.browser.every((shot) => shot.pass));
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
