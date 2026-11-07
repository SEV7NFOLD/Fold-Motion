import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { RENDER_FONT_FAMILY, renderShotSvg } from '../scripts/render-production.mjs';
import { describeProcessFailure } from '../src/runtime/static-server.mjs';

const renderer = readFileSync(new URL('../scripts/render-production.mjs', import.meta.url), 'utf8');
const shot = {
  shotId: 'shot-01',
  palette: { primary: '#0B0B10', accent: '#C9A86A' },
  spec: { elements: [
    { id: 'shot-1-background', type: 'rect', x: 0, y: 0, width: 1280, height: 720, fill: '#0B0B10' },
    { id: 'shot-1-copy', type: 'text', content: 'Nocturne', x: 640, y: 360, fill: '#F8FAFC', fontSize: 72, anchor: 'middle' },
  ] },
};

test('renders use one bundled font instead of scanning system fonts per frame', () => {
  assert.equal(RENDER_FONT_FAMILY, 'Montserrat');
  for (const file of ['Montserrat-Bold.ttf', 'Montserrat-SemiBold.ttf', 'Montserrat-Medium.ttf', 'Anton-Regular.ttf', 'metrics.json']) {
    assert.ok(existsSync(new URL(`../assets/fonts/${file}`, import.meta.url)), `missing assets/fonts/${file}`);
  }
  for (const license of ['OFL-Montserrat.txt', 'OFL-Anton.txt']) {
    assert.ok(existsSync(new URL(`../assets/fonts/${license}`, import.meta.url)), `ship ${license} with the fonts`);
  }
  assert.match(renderer, /loadSystemFonts: false/);
  assert.doesNotMatch(renderer, /loadSystemFonts: true/);
  const svg = renderShotSvg(shot, 0.5, 1280, 720);
  assert.match(svg, /font-family="Montserrat, Arial, sans-serif"/);
  assert.doesNotMatch(svg, /Segoe UI/);
});

test('the background grid is one path, not an expensive SVG pattern', () => {
  const svg = renderShotSvg(shot, 0.5, 1280, 720);
  assert.doesNotMatch(svg, /<pattern/);
  assert.match(svg, /<path d="M0 0V720M42 0V720/);
});

test('the encoder uses a lean, bounded configuration', () => {
  assert.match(renderer, /'-preset', process\.env\.RENDER_X264_PRESET \|\| 'veryfast'/);
  assert.match(renderer, /RENDER_FFMPEG_THREADS, 1\)/);
  assert.match(renderer, /'-x264-params', 'aq-mode=3'/);
  assert.match(renderer, /globalThis\.gc\?\.\(\)/);
});

test('render failures explain timeouts and memory kills in plain words', () => {
  const timedOut = describeProcessFailure({ killed: true, signal: 'SIGTERM' }, 'Rendering', 15 * 60 * 1000);
  assert.match(timedOut, /took longer than 15 minutes/);
  const killed = describeProcessFailure({ signal: 'SIGKILL' }, 'Rendering', 900000);
  assert.match(killed, /ran out of memory/);
  const failed = describeProcessFailure({ stderr: 'line 1\nError: ffmpeg not found', message: 'Command failed' }, 'Rendering', 900000);
  assert.match(failed, /Rendering failed: line 1\nError: ffmpeg not found/);
});
