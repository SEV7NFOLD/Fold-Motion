import assert from 'node:assert/strict';
import test from 'node:test';
import { renderShotSvg } from '../scripts/render-production.mjs';
import { validateProductionReport } from '../scripts/qa/validate-production.mjs';
import {
  buildMockStoryboard,
  buildTimeline,
  compileCreativePlan,
  createCreativePlan,
  evaluateCreativeQA,
  validateStoryboard,
  validateTimeline,
} from '../src/production/production.mjs';
import { createProject, transitionProject } from '../src/orchestrator/project-state.mjs';

const context = {
  width: 640,
  height: 360,
  fps: 24,
  primaryColor: '#0F172A',
  accentColor: '#38BDF8',
};

test('creative planning returns storyboard breakdown and machine-readable acceptance criteria', async () => {
  const result = await createCreativePlan('A kinetic product launch', context);

  assert.equal(result.provider, 'mock-provider');
  assert.equal(validateStoryboard(result.storyboard).valid, true);
  assert.ok(result.storyboard.shots.length >= 2);
  assert.ok(result.storyboard.shots.every((shot) => (
    shot.id && shot.purpose && shot.durationSeconds > 0 && shot.onScreenCopy
      && shot.cameraBehavior && shot.motionBehavior && shot.transitionIn && shot.transitionOut
  )));
  assert.equal(result.acceptance.technicalRequirements.width, context.width);
  assert.equal(result.acceptance.technicalRequirements.height, context.height);
  assert.ok(result.acceptance.shotCriteria.length === result.storyboard.shots.length);
});

test('compilation creates a continuous canonical timeline and measurable creative QA', async () => {
  const storyboard = buildMockStoryboard('A cinematic title', context);
  const { timeline } = await compileCreativePlan(storyboard, context);

  assert.equal(validateTimeline(timeline).valid, true);
  assert.equal(timeline.totalFrames, 192);
  assert.deepEqual(
    timeline.shots.map(({ startFrame, endFrame }) => [startFrame, endFrame]),
    [[0, 71], [72, 143], [144, 191]],
  );
  assert.equal(evaluateCreativeQA(timeline, context).pass, true);

  const invalidTimeline = structuredClone(timeline);
  invalidTimeline.shots[1].startFrame += 1;
  assert.equal(validateTimeline(invalidTimeline).valid, false);

  const unsupportedShot = structuredClone(timeline.shots[0].spec);
  unsupportedShot.elements[1].type = 'path';
  assert.throws(
    () => buildTimeline(storyboard, [unsupportedShot, ...timeline.shots.slice(1).map((shot) => shot.spec)], context),
    /brand constraints/,
  );
});

test('project state machine blocks skips and requires storyboard, QA, and delivery evidence', async () => {
  let project = createProject({ id: 'loop-test', brief: 'A cinematic title', context });
  assert.throws(() => transitionProject(project, 'BUILDING'), /Invalid project transition/);
  project = transitionProject(project, 'PLANNING');
  const plan = await createCreativePlan(project.brief, context);
  project.storyboard = plan.storyboard;
  project.acceptance = plan.acceptance;
  project = transitionProject(project, 'STORYBOARD_REVIEW');
  assert.throws(() => transitionProject(project, 'BUILDING'), /evidence is incomplete/);
  project = transitionProject(project, 'BUILDING', { storyboardApproved: true });
  project.timeline = (await compileCreativePlan(project.storyboard, context)).timeline;
  project = transitionProject(project, 'RENDERING');
  assert.throws(() => transitionProject(project, 'QA'), /evidence is incomplete/);
  project.renderReport = {
    verified: true,
    productionQA: { pass: true },
    creativeQA: { pass: true },
    artifacts: { video: '/output/test/production.mp4', source: '/output/test/source.json' },
  };
  project = transitionProject(project, 'QA');
  assert.throws(() => transitionProject(project, 'APPROVED'), /evidence is incomplete/);
  project = transitionProject(project, 'APPROVED', { finalCutApproved: true });
  project = transitionProject(project, 'DELIVERED');
  assert.equal(project.state, 'DELIVERED');
  assert.deepEqual(project.history.map(({ state }) => state), [
    'BRIEF', 'PLANNING', 'STORYBOARD_REVIEW', 'BUILDING',
    'RENDERING', 'QA', 'APPROVED', 'DELIVERED',
  ]);
});

test('render frame SVG uses deterministic escaped copy and production QA requires both gates', () => {
  const htmlSafeShot = {
    spec: {
      elements: [
        { id: 'background', type: 'rect', x: 0, y: 0, width: 640, height: 360, fill: '#0F172A' },
        { id: 'headline', type: 'text', content: '<safe & exact>', x: 320, y: 180, fill: '#FFFFFF', fontSize: 40, anchor: 'middle' },
      ],
    },
  };
  const svg = renderShotSvg(htmlSafeShot, 0.5, 640, 360);
  assert.match(svg, /&lt;safe &amp; exact&gt;/);
  assert.equal(renderShotSvg(htmlSafeShot, 0.5, 640, 360), svg);

  assert.equal(validateProductionReport({
    verified: true,
    productionQA: { pass: true },
    creativeQA: { pass: false },
  }).valid, false);
  assert.equal(validateProductionReport({
    verified: true,
    productionQA: { pass: true },
    creativeQA: { pass: true },
  }).valid, true);
});
