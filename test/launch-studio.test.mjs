import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileCreativePlan, createCreativePlan, rebuildTimeline, buildAcceptanceSpec } from '../src/production/production.mjs';
import { BROWSER_RENDERER } from '../src/browser/render-browser.mjs';
import { renderProductionProject } from '../scripts/render-production.mjs';
import { createStaticServer } from '../src/runtime/static-server.mjs';

const C = { width: 640, height: 360, fps: 24, primaryColor: '#0B0F19', accentColor: '#00F0FF', launch: true };
const BRIEF = 'A bold launch video for Volt Runner. Your night run, upgraded. Exact fit. Grip. Glow. 3 colors, one shoe.';

let browser = false;
try { const { chromium } = await import('playwright'); const b = await chromium.launch(); await b.close(); browser = true; } catch { browser = false; }
const needsBrowser = browser ? {} : { skip: 'Chromium for Playwright is not installed' };

test('a studio edit (rebuild) keeps the launch plan and beat timing', async () => {
  const { storyboard } = await createCreativePlan(BRIEF, C, null);
  const { timeline } = await compileCreativePlan(storyboard, C, null);
  const specs = timeline.shots.map((shot) => ({ ...shot.spec, elements: undefined }));
  const rebuilt = rebuildTimeline(storyboard, specs, C).timeline;
  assert.ok(rebuilt.launch, 'launch plan kept');
  assert.deepEqual(rebuilt.beat, timeline.beat);
  assert.deepEqual(rebuilt.launch.shots.map((s) => s.device), timeline.launch.shots.map((s) => s.device));
  const classic = rebuildTimeline(storyboard, specs, { ...C, launch: false }).timeline;
  assert.equal(classic.launch, undefined, 'classic films stay classic');
});

test('the standard render entry point sends launch films to the browser renderer', needsBrowser, async () => {
  const { storyboard, acceptance } = await createCreativePlan('A launch film for FOLD Motion. Ideas into motion. Exact.', { ...C, durationInSeconds: 4 }, null);
  const { timeline } = await compileCreativePlan(storyboard, { ...C, durationInSeconds: 4 }, null);
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'fold-launch-studio-'));
  try {
    const { report } = await renderProductionProject({ timeline, storyboard, acceptance: acceptance || buildAcceptanceSpec(storyboard, C), context: C, music: 'off', samples: 1, outputRoot });
    assert.equal(report.renderer, BROWSER_RENDERER);
    assert.equal(report.productionQA.pass, true, JSON.stringify(report.productionQA));
    assert.equal(report.productionQA.beatSync.pass, true);
  } finally { await rm(outputRoot, { recursive: true, force: true }); }
});

test('the server reports whether it can render launch films', async () => {
  const server = await createStaticServer({ root: path.resolve('public') });
  try {
    const body = await (await fetch(`http://${server.host}:${server.port}/api/engine`)).json();
    assert.equal(typeof body.render.launch.available, 'boolean');
    if (!body.render.launch.available) assert.match(body.render.launch.reason, /headless browser/);
  } finally { await server.close(); }
});

test('the studio offers the launch style and sends it with every planning request', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile('public/index.html', 'utf8'); const studio = await readFile('public/studio.js', 'utf8');
  assert.match(html, /id="launch-pick"[\s\S]*value="launch"/);
  assert.match(studio, /launchOf\(record\) \? \{ launch: true \}/, 'withBrand adds launch to the request context');
  assert.match(studio, /timeline\.launch[\s\S]{0,160}shot\.products/, 'launch product photos are uploaded for rendering');
});
