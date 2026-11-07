import assert from 'node:assert/strict';
import test from 'node:test';
import { renderShotSvg } from '../scripts/render-production.mjs';
import { DEFAULT_MOTION, fallbackMotion, MOTION_OPTIONS, normalizeMotion } from '../src/production/motion.mjs';
import { compileCreativePlan, createCreativePlan } from '../src/production/production.mjs';
import { repairShotSpec } from '../src/production/repair.mjs';

const elements = [
  { id: 's-background', type: 'rect', x: 0, y: 0, width: 1280, height: 720, fill: '#0B0B10' },
  { id: 's-copy', type: 'text', content: 'Light on black glass', x: 640, y: 340, fill: '#F8FAFC', fontSize: 72, anchor: 'middle' },
  { id: 's-accent', type: 'rect', x: 520, y: 420, width: 240, height: 6, fill: '#C9A86A' },
];
const shotWith = (motion) => ({ shotId: 's', palette: { primary: '#0B0B10', accent: '#C9A86A' }, spec: { elements, ...(motion ? { motion } : {}) } });

test('no motion and the explicit default render identically', () => {
  for (const progress of [0, 0.1, 0.5, 1]) {
    assert.equal(renderShotSvg(shotWith(), progress, 1280, 720), renderShotSvg(shotWith(DEFAULT_MOTION), progress, 1280, 720));
  }
});

test('every option renders differently from the default and deterministically', () => {
  for (const [field, options] of Object.entries(MOTION_OPTIONS)) {
    for (const option of options) {
      if (option === DEFAULT_MOTION[field]) continue;
      const motion = { ...DEFAULT_MOTION, [field]: option };
      const frames = [0.1, 0.6].map((progress) => renderShotSvg(shotWith(motion), progress, 1280, 720));
      const defaults = [0.1, 0.6].map((progress) => renderShotSvg(shotWith(), progress, 1280, 720));
      assert.ok(frames.some((frame, index) => frame !== defaults[index]), `${field} "${option}" looks like the default`);
      assert.equal(renderShotSvg(shotWith(motion), 0.37, 1280, 720), renderShotSvg(shotWith(motion), 0.37, 1280, 720));
    }
  }
});

test('type-on reveals copy over time without shifting the layout', () => {
  const early = renderShotSvg(shotWith({ entrance: 'type-on' }), 0.1, 1280, 720);
  const late = renderShotSvg(shotWith({ entrance: 'type-on' }), 0.9, 1280, 720);
  assert.match(early, /<tspan fill-opacity="0">/);
  assert.doesNotMatch(late, /<tspan fill-opacity="0">/);
  const x = (svg) => svg.match(/<text x="([\d.]+)"/)[1];
  assert.equal(x(early), x(late));
});

test('camera moves wrap everything but the background', () => {
  const svg = renderShotSvg(shotWith({ camera: 'push-in', atmosphere: 'clean' }), 0.5, 1280, 720);
  const background = svg.indexOf('fill="#0B0B10" opacity="1"');
  const group = svg.indexOf('<g transform="translate(640 360) scale(');
  assert.ok(background > 0 && group > background, 'background is drawn before, and outside, the camera group');
  assert.doesNotMatch(renderShotSvg(shotWith({ camera: 'static' }), 0.5, 1280, 720), /<g transform="translate\(640 360\) scale/);
});

test('atmospheres change what surrounds the copy', () => {
  const at = (atmosphere) => renderShotSvg(shotWith({ atmosphere }), 0.8, 1280, 720);
  assert.match(at('orbit'), /stroke-dasharray="3 12"/);
  assert.match(at('spotlight'), /url\(#spotlight\)/);
  assert.doesNotMatch(at('clean'), /url\(#ambient\)"|stroke-dasharray|M0 0V720/);
  assert.match(at('grid'), /M0 0V720/);
  assert.doesNotMatch(at('lines'), /M0 0V720/);
});

test('normalizeMotion maps aliases and replaces unknown options', () => {
  const { motion, changes } = normalizeMotion({ camera: 'Zoom In', entrance: 'typewriter', atmosphere: 'lasers' });
  assert.deepEqual(motion, { camera: 'push-in', entrance: 'type-on', atmosphere: 'orbit' });
  assert.equal(changes.length, 3);
  assert.deepEqual(normalizeMotion(undefined).motion, DEFAULT_MOTION);
});

test('repair fills missing motion with a seeded pick instead of the old default', () => {
  const shot = { id: 'shot-01', onScreenCopy: 'Light on black glass', durationSeconds: 3 };
  const context = { width: 1280, height: 720, fps: 24, primaryColor: '#0B0B10', accentColor: '#C9A86A' };
  const { spec, repairs } = repairShotSpec({ elements }, shot, 0, context, 'storyboard-a|A');
  assert.deepEqual(spec.motion, fallbackMotion('storyboard-a|A', 0));
  assert.ok(repairs.some((message) => message.includes('no motion chosen')));
});

test('offline fallback films vary from brief to brief and from shot to shot', async () => {
  const combos = new Set();
  const films = [];
  for (const brief of ['A perfume called Nocturne', 'A fintech app launch', 'A coffee shop opening', 'A sneaker drop', 'A jazz festival', 'A hotel spa']) {
    const { storyboard } = await createCreativePlan(brief, {}, null);
    const { timeline } = await compileCreativePlan(storyboard, {}, null);
    const motions = timeline.shots.map((shot) => shot.spec.motion);
    films.push(motions.map((motion) => `${motion.camera}/${motion.entrance}`).join(' '));
    for (const motion of motions) combos.add(JSON.stringify(motion));
    assert.ok(new Set(motions.map((motion) => `${motion.camera}/${motion.entrance}`)).size > 1, `${brief}: shots should not all move the same way`);
  }
  assert.ok(new Set(films).size >= 3, 'different briefs should produce different films');
  assert.ok(combos.size >= 6);
});
