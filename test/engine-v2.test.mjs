import assert from 'node:assert/strict';
import test from 'node:test';
import { Resvg } from '@resvg/resvg-js';
import { contrastRatio } from '../src/production/color.mjs';
import { compileCreativePlan, createCreativePlan, evaluateCreativeQA } from '../src/production/production.mjs';
import { expandRecipe, fallbackDirection, normalizeDirection, RECIPE_OPTIONS, TRANSITION_OPTIONS } from '../src/production/recipes.mjs';
import { renderTimelineFrame } from '../src/render/frame-v2.mjs';
import { FONT_FILES, measure } from '../src/render/typography.mjs';
import { generateProductionAction } from '../src/runtime/creative-api.mjs';

process.env.GEMINI_RETRY_DELAY_MS = '0';
const quiet = { info() {}, warn() {} };
const DARK = { width: 1280, height: 720, fps: 24, primaryColor: '#0E0E11', accentColor: '#7C3AED' };
const LIGHT = { width: 1280, height: 720, fps: 24, primaryColor: '#F4EFE6', accentColor: '#8A6A2F' };
const COPY = [
  'Ideas into motion',
  'Creativity at scale',
  'The lightest runner we have ever made, built to fly',
  'Ember',
];

test('every recipe keeps every line inside the safe area, at any copy length', () => {
  for (const recipe of RECIPE_OPTIONS) {
    for (const copy of COPY) {
      const elements = expandRecipe({ recipe, kicker: 'SEV7N FOLD presents', emphasis: copy.split(' ').at(-1), durationInSeconds: 3, sweep: true }, { copy, context: DARK, support: 'Creativity at scale' });
      for (const element of elements.filter((item) => item.type === 'text')) {
        element.lines.forEach((line, index) => {
          const size = element.lineSizes?.[index] ?? element.fontSize;
          const width = measure(element.font, line, size, element.settle ? Math.max(element.settle.from, element.tracking) : element.tracking);
          const left = element.anchor === 'start' ? element.x : element.x - width / 2;
          assert.ok(left >= DARK.width * 0.08 - 1 && left + width <= DARK.width * 0.92 + 1, `${recipe} "${copy}" ${element.role} line "${line}" overflows (${left.toFixed(0)}..${(left + width).toFixed(0)})`);
          assert.ok(size >= 16, `${recipe} ${element.role} is smaller than 16px`);
        });
        assert.ok(element.y > DARK.height * 0.1 && element.y < DARK.height * 0.92, `${recipe} ${element.role} baseline ${element.y} outside the frame`);
      }
    }
  }
});

test('the title element always carries the exact copy, and the shown text only changes case', () => {
  for (const recipe of RECIPE_OPTIONS) {
    const elements = expandRecipe({ recipe, durationInSeconds: 3 }, { copy: 'Ideas into motion', context: DARK });
    const title = elements.find((element) => element.role === 'title');
    assert.equal(title.content, 'Ideas into motion');
    assert.equal(title.shown.toLowerCase(), 'ideas into motion');
  }
  const asWritten = expandRecipe({ recipe: 'title-reveal', textCase: 'as-written', durationInSeconds: 3 }, { copy: 'iPhone launch', context: DARK });
  assert.equal(asWritten.find((element) => element.role === 'title').shown, 'iPhone launch');
});

test('text, kicker, support and emphasis colors pass contrast on dark and light brands', () => {
  for (const context of [DARK, LIGHT]) {
    for (const recipe of RECIPE_OPTIONS) {
      const elements = expandRecipe({ recipe, kicker: 'Presents', emphasis: 'motion', durationInSeconds: 3 }, { copy: 'Ideas into motion', context, support: 'Creativity at scale' });
      for (const element of elements.filter((item) => item.type === 'text')) {
        assert.ok(contrastRatio(element.fill, context.primaryColor) >= 4.5, `${recipe} ${element.role} fill fails contrast on ${context.primaryColor}`);
        if (element.emphasis) {
          assert.ok(contrastRatio(element.emphasis.from, context.primaryColor) >= 4.5);
          assert.ok(contrastRatio(element.emphasis.to, context.primaryColor) >= 4.5);
        }
      }
    }
  }
});

test('normalizeDirection maps aliases, trims kickers and refuses emphasis that is not in the line', () => {
  const { direction, changes } = normalizeDirection({
    recipe: 'Hero', kicker: '"Ideas into motion, says SEV7N FOLD"', emphasis: 'banana', transitionOut: 'dissolve', beam: 'true',
  }, { copy: 'Ideas into motion', index: 0, count: 3, seed: 's' });
  assert.equal(direction.recipe, 'title-reveal');
  assert.equal(direction.kicker, '', 'a kicker that repeats the line is removed');
  assert.equal(direction.emphasis, '');
  assert.equal(direction.transitionOut, 'fade');
  assert.equal(direction.beam, true);
  assert.ok(changes.length >= 3);
  const last = normalizeDirection({ recipe: 'type-stack', transitionOut: 'wipe' }, { copy: 'A line far too long to stack as words', index: 2, count: 3, seed: 's' });
  assert.equal(last.direction.transitionOut, 'cut');
  assert.equal(last.direction.recipe, 'title-reveal');
});

test('a Gemini v2 direction compiles into a v2 timeline that passes creative QA', async () => {
  const context = { ...DARK, headline: 'Ideas into motion', subheadline: 'Creativity at scale' };
  const { storyboard } = await createCreativePlan('A launch teaser', context, null);
  const directions = storyboard.shots.map((shot, index) => ({
    id: `${shot.id}-scene`,
    title: shot.onScreenCopy,
    recipe: ['kicker-title', 'title-reveal', 'lockup'][index] ?? 'statement',
    kicker: index === 0 ? 'SEV7N FOLD presents' : index === storyboard.shots.length - 1 ? 'FOLD Motion' : '',
    emphasis: index === 1 ? 'motion' : '',
    motion: { camera: 'push-in', atmosphere: ['spotlight', 'planes', 'dots'][index] ?? 'grid' },
    transitionOut: ['wipe', 'push', 'cut'][index] ?? 'fade',
    beam: index === 0,
    sweep: true,
  }));
  const result = await generateProductionAction({
    action: 'compile', storyboard, context, apiKeys: ['k'], logger: quiet, environment: {},
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify(directions) }] } }] }; } }),
  });
  assert.equal(result.provider, 'Gemini 3.5 Flash-Lite');
  const { timeline } = result;
  assert.ok(timeline.shots.every((shot) => shot.spec.version === 2));
  assert.deepEqual(timeline.shots.map((shot) => shot.spec.recipe), directions.map((direction) => direction.recipe));
  assert.ok(timeline.shots[0].spec.elements.some((element) => element.role === 'kicker' && element.content === 'SEV7N FOLD presents'));
  assert.ok(timeline.shots.at(-1).spec.elements.some((element) => element.type === 'text' && element.content === 'Creativity at scale'));
  assert.equal(evaluateCreativeQA(timeline, context).pass, true);
});

test('the offline fallback produces v2 films that differ from brief to brief', async () => {
  const films = new Set();
  for (const brief of ['A perfume called Nocturne', 'A fintech app launch', 'A coffee shop opening', 'A sneaker drop', 'A jazz festival', 'A hotel spa', 'A bakery', 'A law firm']) {
    const { storyboard } = await createCreativePlan(brief, DARK, null);
    const { timeline } = await compileCreativePlan(storyboard, DARK, null);
    assert.ok(timeline.shots.every((shot) => shot.spec.version === 2 && RECIPE_OPTIONS.includes(shot.spec.recipe)));
    assert.ok(timeline.shots.every((shot) => TRANSITION_OPTIONS.includes(shot.spec.transitionOut)));
    films.add(timeline.shots.map((shot) => `${shot.spec.recipe}>${shot.spec.transitionOut}/${shot.spec.motion.atmosphere}`).join(' '));
  }
  assert.ok(films.size >= 3, `only ${films.size} distinct offline films`);
  assert.equal(fallbackDirection('x', 0, 3, 'A b').kicker, undefined, 'the fallback never invents a kicker');
});

function sampleTimeline() {
  const plan = [
    { copy: 'Ideas into motion', recipe: 'kicker-title', kicker: 'SEV7N FOLD presents', beam: true, motion: { camera: 'push-in', atmosphere: 'spotlight' }, transitionOut: 'wipe' },
    { copy: 'Built to fly', recipe: 'type-stack', motion: { camera: 'drift-left', atmosphere: 'planes' }, transitionOut: 'push', sweep: true },
    { copy: 'Ideas into motion', recipe: 'title-reveal', emphasis: 'motion', kicker: 'AI ingredients', motion: { camera: 'static', atmosphere: 'orbit' }, transitionOut: 'fade', sweep: true },
    { copy: 'Creativity at scale', recipe: 'statement', motion: { camera: 'drift-right', atmosphere: 'grid' }, transitionOut: 'cut' },
    { copy: 'Creativity at scale', recipe: 'lockup', kicker: 'FOLD Motion', emphasis: 'scale', motion: { camera: 'pull-out', atmosphere: 'dots' }, transitionOut: 'cut', sweep: true },
  ];
  let start = 0;
  const shots = plan.map((item, index) => {
    const frames = 36;
    const spec = { version: 2, ...item, durationInSeconds: 1.5 };
    spec.elements = expandRecipe(spec, { copy: item.copy, context: DARK, shotIndex: index });
    const shot = { shotId: `shot-${index + 1}`, startFrame: start, endFrame: start + frames - 1, durationFrames: frames, palette: { primary: DARK.primaryColor, accent: DARK.accentColor }, spec };
    start += frames;
    return shot;
  });
  return { width: 1280, height: 720, fps: 24, totalFrames: start, shots };
}

test('v2 frames are deterministic', () => {
  const timeline = sampleTimeline();
  for (const frame of [0, 17, 40, 77, 110, 160]) assert.equal(renderTimelineFrame(timeline, frame), renderTimelineFrame(timeline, frame));
});

test('transitions draw at shot boundaries', () => {
  const timeline = sampleTimeline();
  const [one, two, three] = timeline.shots;
  assert.match(renderTimelineFrame(timeline, one.endFrame - 2), /fill="#7C3AED"\/>/, 'wipe panel enters at the end of shot 1');
  assert.match(renderTimelineFrame(timeline, two.startFrame + 2), new RegExp(`<rect x="[\\d.]+" y="0" width="[\\d.]+" height="720" fill="#7C3AED"/>`), 'wipe panel exits at the start of shot 2');
  assert.match(renderTimelineFrame(timeline, two.endFrame - 1), /scale\(1\.\d+\)/, 'push scales up at the end of shot 2');
  assert.match(renderTimelineFrame(timeline, three.endFrame - 1), /fill="#0E0E11" opacity="0\.\d+"/, 'fade veils the end of shot 3');
  const middle = renderTimelineFrame(timeline, one.startFrame + 18);
  assert.doesNotMatch(middle, /height="720" fill="#7C3AED"\/>/, 'no panel mid-shot');
});

test('every frame of a film using all recipes, atmospheres and transitions rasterizes', () => {
  const timeline = sampleTimeline();
  const font = { fontFiles: [...FONT_FILES], loadSystemFonts: false, defaultFontFamily: 'Montserrat' };
  for (let frame = 0; frame < timeline.totalFrames; frame += 3) {
    const png = new Resvg(renderTimelineFrame(timeline, frame), { fitTo: { mode: 'width', value: 320 }, font }).render().asPng();
    assert.ok(png.length > 1000);
  }
});

test('a length in the brief is read and the storyboard is fitted to it exactly', async () => {
  const { durationFromBrief } = await import('../src/production/production.mjs');
  assert.equal(durationFromBrief('A 10-second launch film'), 10);
  assert.equal(durationFromBrief('a 15 sec teaser'), 15);
  assert.equal(durationFromBrief('Ten seconds, calm'), 10);
  assert.equal(durationFromBrief('cut a 12s spot'), 12);
  assert.equal(durationFromBrief('a 90s-inspired retro film'), undefined);
  assert.equal(durationFromBrief('launching December 2026'), undefined);
  assert.equal(durationFromBrief('a 60-second ad'), 30, 'clamped to the maximum');

  const offline = await createCreativePlan('A 10-second launch film for FOLD Motion', DARK, null);
  assert.equal(offline.storyboard.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0), 10);
  assert.equal(offline.acceptance.technicalRequirements.durationInSeconds, 10);

  // Gemini plans 8 seconds for a brief that asks for 10: code fits it and says so.
  const eightSeconds = (await createCreativePlan('A teaser', DARK, null)).storyboard;
  const result = await generateProductionAction({
    action: 'storyboard', prompt: 'A 10-second launch film for FOLD Motion', context: DARK, apiKeys: ['k'], logger: quiet, environment: {},
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify(eightSeconds) }] } }] }; } }),
  });
  assert.equal(result.provider, 'Gemini 3.5 Flash-Lite');
  assert.equal(result.storyboard.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0), 10);
  assert.ok(result.storyboard.shots.every((shot) => Number.isInteger(Math.round(shot.durationSeconds * 24 * 1000) / 1000)));
  assert.ok(result.repairs.some((message) => message.includes('scaled from 8s to the requested 10s')));

  // No length asked for: the storyboard's own pacing stands.
  const unasked = await createCreativePlan('A teaser with no stated length', DARK, null);
  assert.equal(unasked.storyboard.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0), 8);
});
