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

test('transitions draw at shot boundaries', async () => {
  const timeline = sampleTimeline();
  const [one, two, three] = timeline.shots;
  // The wipe panel is a deep tint of the accent (mixed 55% toward the primary).
  const { mix: mixColor } = await import('../src/production/color.mjs');
  const panel = mixColor('#7C3AED', timeline.shots[0].palette.primary, 0.55);
  assert.ok(renderTimelineFrame(timeline, one.endFrame - 2).includes(`fill="${panel}"/>`), 'wipe panel enters at the end of shot 1');
  assert.match(renderTimelineFrame(timeline, two.startFrame + 2), new RegExp(`<rect x="[\\d.]+" y="0" width="[\\d.]+" height="720" fill="${panel}"/>`), 'wipe panel exits at the start of shot 2');
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

test('emphasis colors only its own words, even when a whole line rises as one unit', () => {
  const spec = { version: 2, recipe: 'kicker-title', emphasis: 'film', durationInSeconds: 3, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut' };
  spec.elements = expandRecipe(spec, { copy: 'AI plans the film.', context: DARK });
  const timeline = { width: 1280, height: 720, fps: 24, totalFrames: 72, shots: [{ shotId: 's', startFrame: 0, endFrame: 71, durationFrames: 72, palette: { primary: DARK.primaryColor, accent: DARK.accentColor }, spec }] };
  for (const frame of [30, 71]) {
    const svg = renderTimelineFrame(timeline, frame);
    const fills = [...svg.matchAll(/<text [^>]*fill="([^"]+)"[^>]*>(AI|PLANS|THE|FILM\.)<\/text>/g)].map(([, fill, word]) => [word, fill.startsWith('url(') ? 'gradient' : 'solid']);
    assert.deepEqual(Object.fromEntries(fills), { AI: 'solid', PLANS: 'solid', THE: 'solid', 'FILM.': 'gradient' }, `frame ${frame}`);
  }
});

test('kickers that repeat part of the line and emphasis covering most of it are removed', () => {
  const end = normalizeDirection({ recipe: 'lockup', kicker: 'December 2026', emphasis: 'FOLD Motion December', transitionOut: 'cut' }, { copy: 'FOLD Motion December 2026', index: 2, count: 3, seed: 's' });
  assert.equal(end.direction.kicker, '');
  assert.equal(end.direction.emphasis, '');
  assert.ok(end.changes.some((change) => change.includes('repeated')));
  assert.ok(end.changes.some((change) => change.includes('covered too much')));
  const fine = normalizeDirection({ recipe: 'title-reveal', kicker: 'Launching December 2026', emphasis: 'motion', transitionOut: 'wipe' }, { copy: 'Ideas into motion', index: 0, count: 3, seed: 's' });
  assert.equal(fine.direction.kicker, 'Launching December 2026');
  assert.equal(fine.direction.emphasis, 'motion');
});

function foldTimeline() {
  const plan = [
    { copy: 'Ideas into motion', recipe: 'kicker-title', transitionOut: 'fold', motion: { camera: 'push-in', atmosphere: 'spotlight' } },
    { copy: 'AI plans the film.', recipe: 'title-reveal', transitionOut: 'wipe', motion: { camera: 'static', atmosphere: 'planes' } },
    { copy: 'Code renders it.', recipe: 'statement', transitionOut: 'fold', motion: { camera: 'static', atmosphere: 'grid' } },
    { copy: 'Creativity at scale', recipe: 'lockup', transitionOut: 'cut', motion: { camera: 'pull-out', atmosphere: 'dots' } },
  ];
  let start = 0;
  const shots = plan.map((item, index) => {
    const spec = { version: 2, ...item, durationInSeconds: 2 };
    spec.elements = expandRecipe(spec, { copy: item.copy, context: DARK, shotIndex: index });
    const shot = { shotId: `shot-${index + 1}`, startFrame: start, endFrame: start + 47, durationFrames: 48, palette: { primary: DARK.primaryColor, accent: DARK.accentColor }, spec };
    start += 48;
    return shot;
  });
  return { width: 1280, height: 720, fps: 24, totalFrames: start, shots };
}

test('The Fold folds the outgoing shot over the incoming one, alternating its crease', () => {
  const timeline = foldTimeline();
  const firstFold = renderTimelineFrame(timeline, 44);    // end of shot 1
  assert.match(firstFold, /clip-path="url\(#foldSecondX\)"/, 'the first fold uses a vertical crease');
  assert.match(firstFold, /id="s1-atm-glow"/, 'the incoming shot is drawn underneath');
  assert.match(firstFold, /id="s0-atm-glow"/, 'the outgoing shot is drawn on the folding paper');
  assert.match(renderTimelineFrame(timeline, 50), /fill="url\(#foldPaper\)"/, 'the folded half folds away at the start of shot 2');
  assert.match(renderTimelineFrame(timeline, 140), /clip-path="url\(#foldSecondY\)"/, 'the second fold uses a horizontal crease');
  assert.doesNotMatch(renderTimelineFrame(timeline, 24), /url\(#foldPaper\)|url\(#foldSecond/, 'no fold mid-shot');
  assert.equal(renderTimelineFrame(timeline, 45), renderTimelineFrame(timeline, 45));
});

test('a shot entering through The Fold starts with its atmosphere already lit', () => {
  const timeline = foldTimeline();
  const entering = renderTimelineFrame(timeline, 48);   // first frame of shot 2 (after a fold)
  assert.match(entering, /fill="url\(#s1-atm-glow\)" opacity="1"/);
  const afterWipe = renderTimelineFrame(timeline, 96);  // first frame of shot 3 (after a wipe)
  assert.match(afterWipe, /fill="url\(#s2-atm-glow\)" opacity="0"/);
});

test('every frame through both folds rasterizes', () => {
  const timeline = foldTimeline();
  const font = { fontFiles: [...FONT_FILES], loadSystemFonts: false, defaultFontFamily: 'Montserrat' };
  for (const frame of [40, 42, 44, 46, 47, 48, 50, 52, 54, 136, 138, 140, 142, 143, 144, 146, 148, 150]) {
    assert.ok(new Resvg(renderTimelineFrame(timeline, frame), { fitTo: { mode: 'width', value: 320 }, font }).render().asPng().length > 1000, `frame ${frame}`);
  }
});

test('The Fold stays special: at most two per film, aliases map to it, the fallback uses it', async () => {
  const { limitFolds, MAX_FOLDS } = await import('../src/production/recipes.mjs');
  const specs = [1, 2, 3, 4].map(() => ({ version: 2, transitionOut: 'fold' }));
  const changes = limitFolds(specs, ['a', 'b', 'c', 'd']);
  assert.equal(MAX_FOLDS, 2);
  assert.deepEqual(specs.map((spec) => spec.transitionOut), ['fold', 'fold', 'wipe', 'wipe']);
  assert.equal(changes.length, 2);
  assert.equal(normalizeDirection({ recipe: 'statement', transitionOut: 'Paper fold' }, { copy: 'A line', index: 0, count: 3, seed: 's' }).direction.transitionOut, 'fold');

  let filmsWithFold = 0;
  for (const brief of ['A perfume called Nocturne', 'A fintech app launch', 'A coffee shop opening', 'A sneaker drop', 'A jazz festival', 'A hotel spa', 'A bakery', 'A law firm']) {
    const { storyboard } = await createCreativePlan(brief, DARK, null);
    const { timeline } = await compileCreativePlan(storyboard, DARK, null);
    const folds = timeline.shots.filter((shot) => shot.spec.transitionOut === 'fold').length;
    assert.ok(folds <= MAX_FOLDS);
    if (folds > 0) filmsWithFold += 1;
  }
  assert.ok(filmsWithFold >= 3, `only ${filmsWithFold} of 8 offline films used The Fold`);
});

test('Gemini asking for three folds gets two, and the repairs say so', async () => {
  const { storyboard } = await createCreativePlan('A launch teaser', DARK, null);
  storyboard.shots.push({ ...storyboard.shots.at(-1), id: 'shot-04', onScreenCopy: 'One more line' });
  storyboard.shots.push({ ...storyboard.shots.at(-1), id: 'shot-05', onScreenCopy: 'And the last' });
  const directions = storyboard.shots.map((shot) => ({ id: `${shot.id}-scene`, recipe: 'statement', motion: { camera: 'static', atmosphere: 'grid' }, transitionOut: 'fold' }));
  const result = await generateProductionAction({
    action: 'compile', storyboard, context: DARK, apiKeys: ['k'], logger: quiet, environment: {},
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify(directions) }] } }] }; } }),
  });
  const count = result.timeline.shots.length;
  assert.ok(count >= 4);
  assert.deepEqual(result.timeline.shots.map((shot) => shot.spec.transitionOut), ['fold', 'fold', ...Array(count - 3).fill('wipe'), 'cut']);
  assert.ok(result.repairs.some((message) => message.includes('more than 2 folds')));
});

const QUANTUM_SCULPTOR = `The Quantum Sculptor
FOLD Motion is premium, precise, and a little bold.
0:00 - 0:03 | The Quiet Opening
Visual: A pitch-black frame. A single, razor-thin line of pure white light cuts across the center.
0:03 - 0:07 | The Confident Build
Visual: The geometric mesh folds rapidly in hyper-speed.
0:07 - 0:10 | The Bold Reveal
On-Screen Text: FOLD Motion. AI-Directed Studio. Dec 2026.`;

test('timecoded beats set the film length and each shot length', async () => {
  const { beatsFromBrief, durationFromBrief } = await import('../public/brief-length.mjs');
  assert.equal(durationFromBrief(QUANTUM_SCULPTOR), 10);
  assert.deepEqual(beatsFromBrief(QUANTUM_SCULPTOR), { total: 10, beats: [3, 4, 3] });
  assert.deepEqual(beatsFromBrief('0:00–0:04 open. 0:04–0:12 build. 0:12–0:15 end'), { total: 15, beats: [4, 8, 3] });
  assert.equal(beatsFromBrief('Doors open 9:30 - 11:00, drinks at 18:30'), undefined, 'times of day are not beats');
  assert.equal(beatsFromBrief('0:00 - 0:03 a, 0:05 - 0:10 b'), undefined, 'beats must be continuous');
  assert.equal(durationFromBrief('A 12-second film. 0:00 - 0:03 opening, 0:03 - 0:10 rest'), 12, 'an explicit length wins');

  // Gemini plans 8 seconds in three shots for the Quantum Sculptor: code makes it 3 + 4 + 3.
  const eight = (await createCreativePlan('A teaser', DARK, null)).storyboard;
  eight.shots = [
    { ...eight.shots[0], id: 'shot-01', onScreenCopy: 'Precision, made visible', durationSeconds: 2.5 },
    { ...eight.shots[0], id: 'shot-02', onScreenCopy: 'Every frame decided', durationSeconds: 3 },
    { ...eight.shots[0], id: 'shot-03', onScreenCopy: 'FOLD Motion', durationSeconds: 2.5 },
  ];
  const result = await generateProductionAction({
    action: 'storyboard', prompt: QUANTUM_SCULPTOR, context: DARK, apiKeys: ['k'], logger: quiet, environment: {},
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify(eight) }] } }] }; } }),
  });
  assert.deepEqual(result.storyboard.shots.map((shot) => shot.durationSeconds), [3, 4, 3]);
  assert.ok(result.repairs.some((message) => message.includes("Cuts land on the brief's beats (3s, 4s, 3s): 3s, 4s, 3s")));
});

test('a middle shot that repeats a line is dropped and its time shared', async () => {
  const context = { ...DARK, headline: 'Ideas into motion', subheadline: 'Creativity at scale' };
  const base = (await createCreativePlan('A teaser', DARK, null)).storyboard;
  base.shots = [
    { ...base.shots[0], id: 'shot-01', onScreenCopy: 'Anything', durationSeconds: 3 },
    { ...base.shots[0], id: 'shot-02', onScreenCopy: 'Creativity at scale', durationSeconds: 3 },
    { ...base.shots[0], id: 'shot-03', onScreenCopy: 'Anything else', durationSeconds: 2 },
  ];
  const result = await generateProductionAction({
    action: 'storyboard', prompt: 'A teaser', context, apiKeys: ['k'], logger: quiet, environment: {},
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify(base) }] } }] }; } }),
  });
  assert.deepEqual(result.storyboard.shots.map((shot) => shot.onScreenCopy), ['Ideas into motion', 'Creativity at scale']);
  assert.deepEqual(result.storyboard.shots.map((shot) => shot.durationSeconds), [4.5, 3.5]);
  assert.ok(result.repairs.some((message) => message.includes('repeated "Creativity at scale"')));
});

test('an On-Screen Text section in the brief becomes the offline copy', async () => {
  const { onScreenTextFromBrief, splitBriefCopy } = await import('../src/production/production.mjs');
  const brief = '0:07 - 0:10 | The Bold Reveal\n• Visual: A white flash.\n• On-Screen Text:\nFOLD Motion\nAI-Directed Studio. Dec 2026.\n• Audio: A heavy thud.';
  assert.deepEqual(onScreenTextFromBrief(brief), ['FOLD Motion', 'AI-Directed Studio. Dec 2026.']);
  assert.deepEqual(splitBriefCopy(brief), { headline: 'FOLD Motion', subheadline: 'AI-Directed Studio. Dec 2026.' });
  assert.doesNotMatch(splitBriefCopy('The Quantum Sculptor. 0:00 - 0:03 | The Quiet Opening').subheadline, /\d:\d\d|\|/, 'no timecodes or separators on screen');
  assert.deepEqual(splitBriefCopy('A perfume called Nocturne. After dark, unforgettable.'), { headline: 'A perfume called Nocturne', subheadline: 'After dark, unforgettable.' });
});

test('long shots stay alive: slower reveals, a late light sweep, a breathing camera', () => {
  const long = expandRecipe({ recipe: 'title-reveal', durationInSeconds: 5 }, { copy: 'Ideas into motion', context: DARK });
  const short = expandRecipe({ recipe: 'title-reveal', durationInSeconds: 3 }, { copy: 'Ideas into motion', context: DARK });
  const [longTitle, shortTitle] = [long, short].map((elements) => elements.find((element) => element.role === 'title'));
  assert.ok(longTitle.reveal.duration > shortTitle.reveal.duration, 'reveals stretch with the shot');
  assert.ok(longTitle.sweep && longTitle.sweep.start >= 2.5, 'a long shot gets a sweep in its back half');
  assert.equal(shortTitle.sweep, undefined, 'a short shot without a sweep request stays as directed');

  const timelineFor = (seconds) => {
    const spec = { version: 2, recipe: 'statement', durationInSeconds: seconds, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut' };
    spec.elements = expandRecipe(spec, { copy: 'Creativity at scale', context: DARK });
    const frames = seconds * 24;
    return { width: 1280, height: 720, fps: 24, totalFrames: frames, shots: [{ shotId: 's', startFrame: 0, endFrame: frames - 1, durationFrames: frames, palette: { primary: DARK.primaryColor, accent: DARK.accentColor }, spec }] };
  };
  assert.match(renderTimelineFrame(timelineFor(5), 60), /<g transform="translate\(640(?:\.\d+)? 360\) scale\(1\.0\d+\)/, 'a locked-off 5 s shot breathes');
  assert.doesNotMatch(renderTimelineFrame(timelineFor(3), 36), /scale\(1\.0\d+\)/, 'a locked-off 3 s shot stays locked');
});

test("the brief's On-Screen Text becomes the end card exactly, line and kicker", async () => {
  const brief = '0:00 - 0:03 | Opening\n0:03 - 0:07 | Build\n0:07 - 0:10 | Reveal\n• On-Screen Text:\nFOLD Motion\nAI-Directed Studio. Dec 2026.\n• Audio: a thud.';
  const base = (await createCreativePlan('A teaser', DARK, null)).storyboard;
  base.shots = ['Precision in silence', 'Mathematical form', 'FOLD Motion AI-Directed Studio Dec 2026'].map((line, i) => ({ ...base.shots[0], id: `shot-0${i + 1}`, onScreenCopy: line, durationSeconds: 8 / 3 }));
  const plan = await generateProductionAction({
    action: 'storyboard', prompt: brief, context: DARK, apiKeys: ['k'], logger: quiet, environment: {},
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify(base) }] } }] }; } }),
  });
  const last = plan.storyboard.shots.at(-1);
  assert.equal(last.onScreenCopy, 'FOLD Motion');
  assert.equal(last.kicker, 'AI-Directed Studio. Dec 2026.');
  assert.deepEqual(plan.storyboard.shots.map((shot) => shot.durationSeconds), [3, 4, 3]);

  const directions = plan.storyboard.shots.map((shot) => ({ id: `${shot.id}-scene`, recipe: 'statement', kicker: 'Something else', motion: { camera: 'static', atmosphere: 'grid' }, transitionOut: 'fade' }));
  const built = await generateProductionAction({
    action: 'compile', storyboard: plan.storyboard, context: DARK, apiKeys: ['k'], logger: quiet, environment: {},
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify(directions) }] } }] }; } }),
  });
  const endCard = built.timeline.shots.at(-1).spec;
  assert.equal(endCard.recipe, 'lockup');
  const kicker = endCard.elements.find((element) => element.role === 'kicker');
  assert.equal(kicker.content, 'AI-Directed Studio. Dec 2026.');
  assert.equal(kicker.shown, 'AI-Directed Studio. Dec 2026.', 'keeps its own capitalization');
  assert.equal(endCard.elements.find((element) => element.role === 'title').content, 'FOLD Motion');
});

const MARK = (await import('node:fs')).readFileSync(new URL('../public/brand/sev7n-fold-mark.svg', import.meta.url), 'utf8');

test('an uploaded logo appears on the end card and in logo-reveal, sized to fit', async () => {
  const { resolveBrandAssets } = await import('../src/production/brand-assets.mjs');
  const brand = resolveBrandAssets({ logo: { kind: 'svg', svg: MARK } });
  const context = { ...DARK, logo: { kind: 'svg', width: brand.logo.width, height: brand.logo.height } };
  for (const recipe of ['lockup', 'logo-reveal']) {
    const elements = expandRecipe({ recipe, durationInSeconds: 3 }, { copy: 'Creativity at scale', context });
    const logo = elements.find((element) => element.type === 'logo');
    assert.ok(logo, `${recipe} has a logo`);
    assert.ok(Math.abs(logo.width / logo.height - 412 / 512) < 0.01, 'aspect ratio kept');
    const title = elements.find((element) => element.role === 'title');
    assert.ok(title.y - title.fontSize > logo.y + logo.height / 2, `${recipe}: the line sits below the logo`);
  }
  const noLogo = expandRecipe({ recipe: 'logo-reveal', durationInSeconds: 3 }, { copy: 'Creativity at scale', context: DARK });
  assert.equal(noLogo.some((element) => element.type === 'logo'), false, 'logo-reveal without a logo becomes an end card');
});

test('the renderer draws an SVG logo on, glints it, and debosses it on The Fold', async () => {
  const { resolveBrandAssets } = await import('../src/production/brand-assets.mjs');
  const brand = resolveBrandAssets({ logo: { kind: 'svg', svg: MARK } });
  const context = { ...DARK, logo: { kind: 'svg', width: brand.logo.width, height: brand.logo.height } };
  const plan = [{ recipe: 'logo-reveal', transitionOut: 'fold' }, { recipe: 'lockup', transitionOut: 'cut' }];
  let start = 0;
  const shots = plan.map((item, index) => {
    const spec = { version: 2, ...item, durationInSeconds: 3, motion: { camera: 'static', atmosphere: 'spotlight' } };
    spec.elements = expandRecipe(spec, { copy: index ? 'Creativity at scale' : 'SEV7N FOLD presents', context, shotIndex: index });
    const shot = { shotId: `s${index}`, startFrame: start, endFrame: start + 71, durationFrames: 72, palette: { primary: DARK.primaryColor, accent: DARK.accentColor }, spec };
    start += 72;
    return shot;
  });
  const timeline = { width: 1280, height: 720, fps: 24, totalFrames: start, shots };
  assert.match(renderTimelineFrame(timeline, 14, brand), /stroke-dashoffset="[\d.]+"/, 'the outline draws on');
  assert.match(renderTimelineFrame(timeline, 44, brand), /mask="url\(#shot-1-logo-glint-mask\)"/, 'a glint follows the silhouette');
  assert.match(renderTimelineFrame(timeline, 69, brand), /filter="url\(#logoTint\)"/, 'the fold paper carries the logo');
  assert.throws(() => renderTimelineFrame(timeline, 30, {}), /no logo came with the render request/);
  const font = { fontFiles: [...FONT_FILES], loadSystemFonts: false, defaultFontFamily: 'Montserrat' };
  for (const frame of [6, 20, 44, 66, 69, 75, 120, 143]) {
    assert.ok(new Resvg(renderTimelineFrame(timeline, frame, brand), { fitTo: { mode: 'width', value: 320 }, font }).render().asPng().length > 1000, `frame ${frame}`);
  }
});

test('logo-reveal is refused without a logo, and bad logos are rejected with a reason', async () => {
  const { resolveLogo, normalizeLogoMeta } = await import('../src/production/brand-assets.mjs');
  const { direction, changes } = normalizeDirection({ recipe: 'logo-reveal', transitionOut: 'fade' }, { copy: 'A line here', index: 0, count: 3, seed: 's' });
  assert.notEqual(direction.recipe, 'logo-reveal');
  assert.ok(changes.some((change) => change.includes('needs an uploaded logo')));
  assert.equal(normalizeDirection({ recipe: 'logo-reveal', transitionOut: 'fade' }, { copy: 'A line here', index: 0, count: 3, seed: 's', hasLogo: true }).direction.recipe, 'logo-reveal');
  assert.throws(() => resolveLogo({ kind: 'svg', svg: '<html>no</html>' }), /isn’t an SVG/);
  assert.throws(() => resolveLogo({ kind: 'png', dataUri: 'data:image/jpeg;base64,AAAA' }), /must be a PNG/);
  assert.throws(() => resolveLogo({ kind: 'png', dataUri: 'data:image/png;base64,AAAA' }), /could not be read/);
  assert.equal(normalizeLogoMeta({ kind: 'gif', width: 10, height: 10 }), undefined);
  assert.deepEqual(normalizeLogoMeta({ kind: 'png', width: '400', height: 200 }), { kind: 'png', width: 400, height: 200 });
});

async function productBrand() {
  const { Resvg: R } = await import('@resvg/resvg-js');
  const png = Buffer.from(new R('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#333"/><rect x="110" y="120" width="80" height="220" fill="#111"/><rect x="125" y="200" width="50" height="8" fill="#eee"/></svg>').render().asPng());
  const { resolveBrandAssets } = await import('../src/production/brand-assets.mjs');
  const { gradeProduct, bakeProductPanels } = await import('../scripts/render-production.mjs');
  const brand = resolveBrandAssets({ products: [{ dataUri: `data:image/png;base64,${png.toString('base64')}` }] });
  brand.products = brand.products.map((product) => ({ ...product, graded: gradeProduct(product, { primary: DARK.primaryColor, accent: DARK.accentColor }) }));
  return { brand, bakeProductPanels };
}
const PRODUCT_CONTEXT = { ...DARK, products: [{ width: 300, height: 450 }] };

test('product heroes alternate sides and type windows hold short lines', async () => {
  const { storyboard } = await createCreativePlan('A launch', PRODUCT_CONTEXT, null);
  const lines = ['Precision in silence', 'Alpha', 'Every drop decided', 'Built to last', 'Alpha', 'Creativity at scale'];
  const six = { ...storyboard, shots: lines.map((line, i) => ({ ...storyboard.shots[0], id: `shot-0${i + 1}`, onScreenCopy: line, durationSeconds: 10 / 6 })) };
  const directions = lines.map((line, i) => ({ id: `s${i}`, recipe: ['kicker-title', 'product-hero', 'statement', 'product-hero', 'type-window', 'lockup'][i], product: 1, motion: { camera: 'static', atmosphere: 'grid' }, transitionOut: 'cut' }));
  const built = await generateProductionAction({
    action: 'compile', storyboard: six, context: PRODUCT_CONTEXT, apiKeys: ['k'], logger: quiet, environment: {},
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify(directions) }] } }] }; } }),
  });
  const sides = built.timeline.shots.map((shot) => shot.spec.elements.find((element) => element.type === 'image')).filter(Boolean).map((image) => (image.x > 640 ? 'right' : 'left'));
  assert.deepEqual(sides, ['right', 'left']);
  const window = built.timeline.shots[4].spec.elements.find((element) => element.role === 'title');
  assert.equal(window.reveal.style, 'window');
  assert.equal(window.shown, 'ALPHA');
  const { direction } = normalizeDirection({ recipe: 'type-window', transitionOut: 'cut' }, { copy: 'A line far too long for letters', index: 1, count: 3, seed: 's', productCount: 1 });
  assert.equal(direction.recipe, 'product-hero');
  assert.notEqual(normalizeDirection({ recipe: 'product-hero', transitionOut: 'cut' }, { copy: 'Alpha', index: 1, count: 3, seed: 's' }).direction.recipe, 'product-hero', 'no photos, no product shot');
});

test('with product photos uploaded, the film shows the product at least once', async () => {
  const { ensureProductShot } = await import('../src/production/recipes.mjs');
  const specs = [{ version: 2, recipe: 'title-reveal' }, { version: 2, recipe: 'statement' }, { version: 2, recipe: 'lockup' }];
  assert.equal(ensureProductShot(specs, 1, ['a', 'b', 'c']).length, 1);
  assert.equal(specs[1].recipe, 'product-hero');
  assert.deepEqual(ensureProductShot(specs, 1), [], 'already has one');
  const { storyboard } = await createCreativePlan('A launch film for Alpha', PRODUCT_CONTEXT, null);
  const { timeline } = await compileCreativePlan(storyboard, PRODUCT_CONTEXT, null);
  assert.ok(timeline.shots.some((shot) => shot.spec.elements.some((element) => element.type === 'image' || element.window)), 'the offline fallback shows the product');
});

test('product photos are graded, panels are baked, and type windows draw the photo once per frame', async () => {
  const { brand, bakeProductPanels } = await productBrand();
  assert.match(brand.products[0].graded, /^data:image\/png;base64,/);
  const plan = [{ copy: 'Alpha', recipe: 'product-hero' }, { copy: 'Alpha', recipe: 'type-window' }];
  let start = 0;
  const shots = plan.map((item, index) => {
    const spec = { version: 2, ...item, product: 1, durationInSeconds: 2, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut' };
    spec.elements = expandRecipe(spec, { copy: item.copy, context: PRODUCT_CONTEXT, shotIndex: index, productOrdinal: 0 });
    const shot = { shotId: `s${index}`, startFrame: start, endFrame: start + 47, durationFrames: 48, palette: { primary: DARK.primaryColor, accent: DARK.accentColor }, spec };
    start += 48;
    return shot;
  });
  const timeline = { width: 1280, height: 720, fps: 24, totalFrames: start, shots };
  brand.panels = bakeProductPanels(timeline, brand);
  assert.equal(Object.keys(brand.panels).length, 1);
  const hero = renderTimelineFrame(timeline, 30, brand);
  assert.doesNotMatch(hero, /mask="url\(#shot-1-product-mx\)"/, 'baked panels need no masks');
  const windowFrame = renderTimelineFrame(timeline, 80, brand);
  assert.equal((windowFrame.match(/<image /g) || []).length, 1, 'one image for all the letters');
  assert.match(windowFrame, /<mask id="shot-2-copy-letters">/);
  assert.throws(() => renderTimelineFrame(timeline, 30, {}), /no product photo came with the render request/);
  const font = { fontFiles: [...FONT_FILES], loadSystemFonts: false, defaultFontFamily: 'Montserrat' };
  for (const frame of [0, 10, 30, 47, 48, 52, 80, 95]) assert.ok(new Resvg(renderTimelineFrame(timeline, frame, brand), { fitTo: { mode: 'width', value: 320 }, font }).render().asPng().length > 1000, `frame ${frame}`);
});

test('product photos are validated and loaded only from the user’s own folder', async () => {
  const { resolveProducts, normalizeProductsMeta } = await import('../src/production/brand-assets.mjs');
  const { loadStoredAssets } = await import('../src/runtime/supabase-server.mjs');
  assert.throws(() => resolveProducts([{ dataUri: 'data:image/gif;base64,AAAA' }]), /JPEG or PNG/);
  assert.throws(() => resolveProducts([{ dataUri: 'data:image/jpeg;base64,AAAA' }]), /could not be read/);
  assert.deepEqual(normalizeProductsMeta([{ width: '300', height: 450 }, { width: 0, height: 1 }]), [{ width: 300, height: 450 }]);
  const config = { url: 'https://x.supabase.co', publishableKey: 'p', secretKey: 'sb_secret_x' };
  const user = { id: 'u1' };
  await assert.rejects(loadStoredAssets(config, user, { products: [{ path: 'someone-else/products/a.jpg' }] }), /another account/);
});

test('a logo on a plain background has it removed; a photo background is flagged', async () => {
  const { analyzeLogoPixels, removePlainBackground } = await import('../public/logo-check.mjs');
  const W = 40;
  const H = 30;
  const make = (background) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) data.set([...(x > 12 && x < 28 && y > 8 && y < 22 ? [20, 20, 20] : background(x, y)), 255], (y * W + x) * 4);
    return data;
  };
  const plain = make(() => [255, 255, 255]);
  const check = analyzeLogoPixels(plain, W, H);
  assert.deepEqual([check.transparent, check.uniformEdges], [false, true]);
  assert.ok(removePlainBackground(plain, W, H, { edgeColor: check.edgeColor }) > 0.5);
  assert.equal(plain[3], 0, 'corner is now transparent');
  assert.equal(plain[(15 * W + 20) * 4 + 3], 255, 'the mark stays opaque');
  assert.equal(analyzeLogoPixels(make((x, y) => [30 + (x * 37 + y * 53) % 140, 80, 160]), W, H).uniformEdges, false);
});

test('more shots than beats: cuts snap to the beat boundaries', async () => {
  const brief = '0:00 - 0:03 | Opening. 0:03 - 0:07 | Build. 0:07 - 0:10 | Reveal';
  const base = (await createCreativePlan('A teaser', DARK, null)).storyboard;
  base.shots = [1.5, 1.5, 1.2, 1.4, 1.6, 1.8].map((seconds, i) => ({ ...base.shots[0], id: `shot-0${i + 1}`, onScreenCopy: `Line ${i + 1}`, durationSeconds: seconds }));
  const result = await generateProductionAction({
    action: 'storyboard', prompt: brief, context: DARK, apiKeys: ['k'], logger: quiet, environment: {},
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify(base) }] } }] }; } }),
  });
  let elapsed = 0;
  const cuts = result.storyboard.shots.map((shot) => { elapsed += shot.durationSeconds; return Math.round(elapsed * 1000) / 1000; });
  assert.ok(cuts.includes(3) && cuts.includes(7) && cuts.at(-1) === 10, `cuts at ${cuts.join(', ')}`);
  assert.equal(result.storyboard.shots.length, 6);
});

test('a storyboard that reuses the end card is rewritten once, and direction gains emphasis and The Fold', async () => {
  const brief = '0:00 - 0:03 | Opening\n0:03 - 0:10 | Reveal\n• On-Screen Text:\nFOLD Motion\nAI-Directed Studio. Dec 2026.';
  const base = (await createCreativePlan('A teaser', DARK, null)).storyboard;
  const first = { ...base, shots: ['FOLD Motion', 'AI-Directed Studio', 'Something'].map((line, i) => ({ ...base.shots[0], id: `shot-0${i + 1}`, onScreenCopy: line, durationSeconds: 3 })) };
  const second = { ...base, shots: ['Precision in silence', 'Every frame decided', 'Something'].map((line, i) => ({ ...base.shots[0], id: `shot-0${i + 1}`, onScreenCopy: line, durationSeconds: 3 })) };
  const prompts = [];
  const result = await generateProductionAction({
    action: 'storyboard', prompt: brief, context: DARK, apiKeys: ['k'], logger: quiet, environment: {},
    fetchImpl: async (_url, options) => {
      prompts.push(JSON.parse(options.body).contents[0].parts[0].text);
      const reply = prompts.length === 1 ? first : second;
      return { ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }; } };
    },
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /reused the end card's text/);
  assert.deepEqual(result.storyboard.shots.map((shot) => shot.onScreenCopy), ['Precision in silence', 'Every frame decided', 'FOLD Motion']);
  assert.ok(result.repairs.some((message) => message.includes('rewritten once') && message.includes('reused the end card')));

  const directions = result.storyboard.shots.map((shot) => ({ id: shot.id, recipe: 'statement', motion: { camera: 'static', atmosphere: 'grid' }, transitionOut: 'cut' }));
  const built = await generateProductionAction({
    action: 'compile', storyboard: result.storyboard, context: DARK, apiKeys: ['k'], logger: quiet, environment: {},
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify(directions) }] } }] }; } }),
  });
  assert.equal(built.timeline.shots[0].spec.transitionOut, 'fold');
  assert.ok(built.timeline.shots.some((shot) => shot.spec.emphasis));
  assert.ok(built.repairs.some((message) => message.includes('The Fold carries the film')));
});

test('too few shots for the film gets one rewrite asking for more cuts', async () => {
  const brief = '0:00 - 0:03 | Opening. 0:03 - 0:07 | Product. 0:07 - 0:10 | Sign-off';
  const base = (await createCreativePlan('A teaser', DARK, null)).storyboard;
  const three = { ...base, shots: ['Pure form', 'Elevate daily care', 'Alpha'].map((line, i) => ({ ...base.shots[0], id: `shot-0${i + 1}`, onScreenCopy: line, durationSeconds: 3 })) };
  const six = { ...base, shots: ['Pure form', 'Quiet', 'Elevate daily care', 'Every drop', 'Built to last', 'Alpha'].map((line, i) => ({ ...base.shots[0], id: `shot-0${i + 1}`, onScreenCopy: line, durationSeconds: 10 / 6 })) };
  const prompts = [];
  const result = await generateProductionAction({
    action: 'storyboard', prompt: brief, context: DARK, apiKeys: ['k'], logger: quiet, environment: {},
    fetchImpl: async (_url, options) => {
      prompts.push(JSON.parse(options.body).contents[0].parts[0].text);
      const reply = prompts.length === 1 ? three : six;
      return { ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }; } };
    },
  });
  assert.equal(prompts.length, 2);
  // Beats of 3, 4 and 3 seconds: one shot, two shots (four seconds or longer) and the end card.
  assert.match(prompts[1], /only 3 shots for the brief's 3 timecoded beats/);
  assert.match(prompts[1], /Return exactly 4 shots: one per beat, two in beats of four seconds or longer/);
  assert.equal(result.storyboard.shots.length, 6);
  let elapsed = 0;
  const cuts = result.storyboard.shots.map((shot) => { elapsed += shot.durationSeconds; return Math.round(elapsed * 1000) / 1000; });
  assert.ok(cuts.includes(3) && cuts.includes(7), `cuts at ${cuts.join(', ')}`);
});

test('vertical and square films stack product heroes and keep every element inside the frame', async () => {
  const { brand, bakeProductPanels } = await productBrand();
  for (const [width, height] of [[720, 1280], [960, 960]]) {
    const context = { ...PRODUCT_CONTEXT, width, height };
    const { storyboard } = await createCreativePlan('A launch film for Alpha', context, null);
    storyboard.shots = ['Precision in silence', 'Alpha', 'Built to last', 'Alpha', 'Creativity at scale'].map((line, i) => ({ ...storyboard.shots[0], id: `shot-0${i + 1}`, onScreenCopy: line, durationSeconds: 1.6 }));
    const { timeline } = await compileCreativePlan(storyboard, context, null);
    assert.deepEqual([timeline.width, timeline.height], [width, height]);
    const hero = timeline.shots.flatMap((shot) => shot.spec.elements).find((element) => element.type === 'image');
    assert.ok(hero, 'a product hero');
    const title = timeline.shots.find((shot) => shot.spec.elements.includes(hero)).spec.elements.find((element) => element.role === 'title');
    assert.ok(title.y > hero.y + hero.height * 0.8, 'the line sits below the stacked photo');
    for (const shot of timeline.shots) {
      for (const element of shot.spec.elements) {
        if (element.type === 'text') assert.ok(element.y > 0 && element.y < height, `${element.id} inside the frame`);
      }
    }
    brand.panels = bakeProductPanels(timeline, brand);
    const font = { fontFiles: [...FONT_FILES], loadSystemFonts: false, defaultFontFamily: 'Montserrat' };
    for (const frame of [10, 50, 90, timeline.totalFrames - 1]) {
      const png = new Resvg(renderTimelineFrame(timeline, frame, brand), { fitTo: { mode: 'width', value: width / 4 }, font }).render();
      assert.equal(png.height, height / 4);
    }
  }
});

test('the storyboard carries a music mood: the model’s choice, else the brief’s words', async () => {
  const offline = await createCreativePlan('A bold, punchy launch for a sneaker', DARK, null);
  assert.equal(offline.storyboard.musicMood, 'energetic');
  const base = offline.storyboard;
  const chosen = { ...base, musicMood: 'warm', musicReason: 'A candle film should feel close and human.' };
  const result = await generateProductionAction({
    action: 'storyboard', prompt: 'A candle launch', context: DARK, apiKeys: ['k'], logger: quiet, environment: {},
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify(chosen) }] } }] }; } }),
  });
  assert.equal(result.storyboard.musicMood, 'warm');
  assert.equal(result.storyboard.musicReason, 'A candle film should feel close and human.');
  const { scoreMood } = await import('../scripts/render-production.mjs');
  assert.equal(scoreMood('auto', result.storyboard), 'warm');
  assert.equal(scoreMood('energetic', result.storyboard), 'energetic', 'the studio pick wins');
  assert.equal(scoreMood('auto', {}), 'auto');
});

test('type windows use a lifted grade so dark products read inside the letters', async () => {
  const { brand } = await productBrand();
  const { gradeProduct } = await import('../scripts/render-production.mjs');
  const lifted = gradeProduct(brand.products[0], { primary: DARK.primaryColor, accent: DARK.accentColor }, { lift: true });
  const normal = brand.products[0].graded;
  const mean = (uri) => {
    const png = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60"><image href="${uri}" width="40" height="60"/></svg>`).render();
    const px = png.pixels;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
    return sum / (px.length / 4) / 3;
  };
  assert.ok(mean(lifted) > mean(normal) + 40, `lifted ${mean(lifted).toFixed(0)} vs ${mean(normal).toFixed(0)}`);
});

test('zoom through a letter flies into solid ink and reveals the next shot through the letter', async () => {
  const { zoomTarget, TRANSITION_SECONDS } = await import('../src/render/frame-v2.mjs');
  const plan = [{ copy: 'Built to last', recipe: 'title-reveal', emphasis: 'last', transitionOut: 'zoom' }, { copy: 'Creativity at scale', recipe: 'lockup', transitionOut: 'cut' }];
  let start = 0;
  const shots = plan.map((item, index) => {
    const spec = { version: 2, ...item, durationInSeconds: 2, motion: { camera: 'static', atmosphere: 'spotlight' } };
    spec.elements = expandRecipe(spec, { copy: item.copy, context: DARK, shotIndex: index });
    const shot = { shotId: `s${index}`, startFrame: start, endFrame: start + 47, durationFrames: 48, palette: { primary: DARK.primaryColor, accent: DARK.accentColor }, spec };
    start += 48;
    return shot;
  });
  const timeline = { width: 1280, height: 720, fps: 24, totalFrames: start, shots };
  const target = zoomTarget(shots[0]);
  assert.ok(target && ['T', 'L'].includes(target.character.toUpperCase()), `aims at ${target?.character}`);
  assert.equal(zoomTarget({ spec: { elements: [{ type: 'text', role: 'title', font: 'display', lines: ['OCCO'], size: 100, tracking: 0, x: 640, y: 400, anchor: 'middle', content: 'OCCO' }] } }), undefined, 'no solid letter: no zoom');
  const mid = renderTimelineFrame(timeline, 47 - Math.round(TRANSITION_SECONDS.zoom[0] * 24 * 0.5), {});
  assert.match(mid, /<clipPath id="zoom-letter">/);
  assert.match(mid, /scale\(/);
  const font = { fontFiles: [...FONT_FILES], loadSystemFonts: false, defaultFontFamily: 'Montserrat' };
  const lastFrame = new Resvg(renderTimelineFrame(timeline, 47, {}), { fitTo: { mode: 'width', value: 320 }, font }).render().asPng();
  const nextFirst = new Resvg(renderTimelineFrame(timeline, 48, {}), { fitTo: { mode: 'width', value: 320 }, font }).render().asPng();
  assert.ok(lastFrame.length > 1000 && nextFirst.length > 1000);
});

test('decode and outline headline effects animate, then settle into the exact copy', async () => {
  const { applyTypeEffect, limitFolds } = await import('../src/production/recipes.mjs');
  for (const effect of ['decode', 'outline']) {
    const spec = { version: 2, copy: 'Built to last', recipe: 'title-reveal', typeEffect: effect, durationInSeconds: 2.5, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut' };
    spec.elements = applyTypeEffect(expandRecipe(spec, { copy: spec.copy, context: DARK, shotIndex: 0 }), spec);
    const title = spec.elements.find((element) => element.role === 'title');
    assert.equal(title.reveal.style, effect);
    const timeline = { width: 1280, height: 720, fps: 24, totalFrames: 60, shots: [{ shotId: 's', startFrame: 0, endFrame: 59, durationFrames: 60, palette: { primary: DARK.primaryColor, accent: DARK.accentColor }, spec }] };
    const during = renderTimelineFrame(timeline, 14, {});
    const after = renderTimelineFrame(timeline, 59, {});
    if (effect === 'outline') assert.match(during, /stroke-dasharray/);
    else assert.ok(!during.includes('>last<') || /fill-opacity|opacity="0.85"/.test(during), 'scrambled glyphs while decoding');
    assert.match(after, /BUILT|Built/);
  }
  const specs = Array.from({ length: 4 }, () => ({ version: 2, transitionOut: 'zoom', typeEffect: 'decode' }));
  const changes = limitFolds(specs, ['a', 'b', 'c', 'd']);
  assert.equal(specs.filter((spec) => spec.transitionOut === 'zoom').length, 1);
  assert.equal(specs.filter((spec) => spec.typeEffect).length, 2);
  assert.ok(changes.length >= 4);
});

test('film looks come from the brief or the model, and map to FFmpeg filters', async () => {
  const { chooseGrade } = await import('../src/production/production.mjs');
  const { filmLook, LOOK_FILTERS } = await import('../scripts/render-production.mjs');
  assert.equal(chooseGrade('A moody black and white noir teaser'), 'noir');
  assert.equal(chooseGrade('A cinematic, epic trailer'), 'cinematic');
  assert.equal(chooseGrade('A vintage, filmic piece'), 'matte');
  assert.equal(chooseGrade('A launch film'), 'clean');
  assert.equal(filmLook('auto', { grade: 'matte' }), 'matte');
  assert.equal(filmLook('noir', { grade: 'matte' }), 'noir', 'the studio pick wins');
  assert.equal(filmLook('auto', {}), 'clean');
  assert.equal(LOOK_FILTERS.clean, '');
  assert.match(LOOK_FILTERS.noir, /saturation=0\.22/);
  const { storyboard } = await createCreativePlan('A cinematic launch film', DARK, null);
  assert.equal(storyboard.grade, 'cinematic');
});

test('Gemini sees the product photos as images, picks one per shot, and gives a reason', async () => {
  const thumb = `data:image/jpeg;base64,${Buffer.from('fake-jpeg-bytes').toString('base64')}`;
  const context = { ...DARK, products: [{ width: 300, height: 450, thumb }, { width: 450, height: 300, thumb }] };
  const { storyboard } = await createCreativePlan('A launch', context, null);
  storyboard.shots = ['Precision in silence', 'Alpha', 'Creativity at scale'].map((line, i) => ({ ...storyboard.shots[0], id: `shot-0${i + 1}`, onScreenCopy: line, durationSeconds: 2 }));
  const directions = [
    { id: 'a', recipe: 'title-reveal', motion: { camera: 'static', atmosphere: 'grid' }, transitionOut: 'cut', reason: 'Opens on the promise before the product.' },
    { id: 'b', recipe: 'product-hero', product: 2, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut', reason: 'Photo 2 shows the bottle side-on, the clearest silhouette.' },
    { id: 'c', recipe: 'lockup', motion: { camera: 'static', atmosphere: 'grid' }, transitionOut: 'cut', reason: 'Signs off on the brand.' },
  ];
  let body;
  const built = await generateProductionAction({
    action: 'compile', storyboard, context, apiKeys: ['k'], logger: quiet, environment: {},
    fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return { ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify(directions) }] } }] }; } }; },
  });
  const parts = body.contents[0].parts;
  assert.equal(parts.filter((part) => part.inlineData).length, 2, 'both photos attached as images');
  assert.equal(parts[1].inlineData.mimeType, 'image/jpeg');
  assert.doesNotMatch(parts[0].text, /base64/, 'the prompt text carries no image data');
  assert.match(parts[0].text, /attached in that order/);
  const hero = built.timeline.shots[1].spec;
  assert.equal(hero.elements.find((element) => element.type === 'image').product, 2, 'the chosen photo');
  assert.equal(hero.reason, 'Photo 2 shows the bottle side-on, the clearest silhouette.');
});

test('every line fits the frame in every format, and QA fails a line that spills over', async () => {
  const { measureFrameFit } = await import('../src/production/production.mjs');
  const lines = ['Written in leather, every inch of it', 'Every detail, deliberate', 'Inscribed', 'Obsidian'];
  for (const [width, height] of [[1280, 720], [720, 1280], [960, 960]]) {
    const context = { ...DARK, width, height, logo: { kind: 'svg', width: 412, height: 512 } };
    for (const recipe of ['kicker-title', 'title-reveal', 'statement', 'type-stack', 'lockup']) {
      const spec = { version: 2, recipe, kicker: 'Embossed leather, gold horsebit, hand finished', kickerExact: recipe === 'lockup', durationInSeconds: 3, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut' };
      for (const copy of lines) {
        // End cards also carry a long supporting line (from the brief's On-Screen Text).
        spec.elements = expandRecipe(spec, { copy, context, shotIndex: 1, support: recipe === 'lockup' ? 'Pure Lakes. Natural & handmade in the Lake District.' : '' });
        const timeline = { width, height, fps: 24, totalFrames: 72, shots: [{ shotId: 's', startFrame: 0, endFrame: 71, durationFrames: 72, palette: {}, spec }] };
        const fit = measureFrameFit(timeline);
        assert.equal(fit.pass, true, `${width}x${height} ${recipe} "${copy}": ${JSON.stringify(fit.failures)}`);
      }
    }
  }
  const spill = { width: 720, height: 1280, fps: 24, totalFrames: 1, shots: [{ shotId: 's', startFrame: 0, endFrame: 0, durationFrames: 1, spec: { elements: [
    { type: 'text', id: 'wide', font: 'display', fontSize: 51.2, tracking: 0.04, lines: ['Embossed leather. Gold horsebit.'], x: 360, y: 800, anchor: 'middle' },
  ] } }] };
  assert.equal(measureFrameFit(spill).pass, false, 'the old end card line is caught');
  spill.shots[0].spec.elements[0].fontSize = undefined;
  assert.match(JSON.stringify(measureFrameFit(spill)), /could not be measured/, 'an unmeasurable line fails instead of passing');
});

test('any number of named product photos: the storyboard sees them and follows the brief’s photo instructions', async () => {
  const { normalizeProductsMeta, resolveProducts } = await import('../src/production/brand-assets.mjs');
  const thumb = `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}`;
  const names = ['front.jpg', 'side-view.png', 'pair.jpg', 'close-up.jpg', 'sole.jpg', 'box.jpg', 'detail.jpg', 'hero.jpg', 'top.jpg', 'back.jpg'];
  const products = normalizeProductsMeta(names.map((name) => ({ width: 300, height: 450, name, thumb })));
  assert.equal(products.length, 10, 'more than three photos survive');
  assert.equal(products[1].name, 'side-view', 'file names keep their words, not their extension');
  const context = { ...DARK, products };
  const base = (await createCreativePlan('A launch', DARK, null)).storyboard;
  let body;
  await generateProductionAction({
    action: 'storyboard', prompt: 'Use the pair shot for the end card and photo 4 for the close-up.', context, apiKeys: ['k'], logger: quiet, environment: {},
    fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return { ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify(base) }] } }] }; } }; },
  });
  const parts = body.contents[0].parts;
  assert.equal(parts.filter((part) => part.inlineData).length, 10, 'the storyboard sees every photo');
  assert.match(parts[0].text, /Follow any instructions in the brief about which photo goes where/);
  assert.match(parts[0].text, /"name":"pair"/);
  assert.doesNotMatch(parts[0].text, /base64/);
  // Renders carry only the photos the film shows; the rest arrive as null.
  const sparse = resolveProducts([null, null, null, null, { dataUri: (await productBrand()).brand.products[0].dataUri }, null]);
  assert.equal(sparse.length, 6);
  assert.equal(sparse[4].width, 300);
  assert.equal(sparse[0], null);
});

test('a sparse photo list renders the photo the shot asked for', async () => {
  const { brand, bakeProductPanels } = await productBrand();
  const { gradeProduct } = await import('../scripts/render-production.mjs');
  const photo = brand.products[0];
  const products = [null, null, null, null, { ...photo, graded: gradeProduct(photo, { primary: DARK.primaryColor, accent: DARK.accentColor }) }];
  const context = { ...DARK, products: Array.from({ length: 5 }, () => ({ width: 300, height: 450 })) };
  const spec = { version: 2, recipe: 'product-hero', product: 5, durationInSeconds: 2, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut' };
  spec.elements = expandRecipe(spec, { copy: 'Alpha', context, shotIndex: 1 });
  const timeline = { width: 1280, height: 720, fps: 24, totalFrames: 48, shots: [{ shotId: 's', startFrame: 0, endFrame: 47, durationFrames: 48, palette: { primary: DARK.primaryColor, accent: DARK.accentColor }, spec }] };
  const sparseBrand = { products };
  sparseBrand.panels = bakeProductPanels(timeline, sparseBrand);
  assert.equal(Object.keys(sparseBrand.panels).length, 1);
  assert.match(renderTimelineFrame(timeline, 30, sparseBrand), /<image /);
  assert.throws(() => renderTimelineFrame({ ...timeline, shots: [{ ...timeline.shots[0], spec: { ...spec, elements: spec.elements.map((element) => (element.type === 'image' ? { ...element, product: 2 } : element)) } }] }, 30, { products }), /no product photo came with the render request/);
});

test('edits rebuild the shots with no AI call, and the same film re-lays out for another format', async () => {
  const { rebuildTimeline } = await import('../src/production/production.mjs');
  const { storyboard } = await createCreativePlan('A calm 8-second film for FOLD Motion', DARK, null);
  const { timeline } = await compileCreativePlan(storyboard, DARK, null);
  const edited = JSON.parse(JSON.stringify(storyboard));
  edited.shots[0].onScreenCopy = 'Built for what comes next';
  edited.shots[0].durationSeconds = 3.5;
  const specs = timeline.shots.map((shot) => ({ ...shot.spec, elements: undefined }));
  specs[0].transitionOut = 'zoom';
  let called = false;
  const result = await generateProductionAction({ action: 'rebuild', storyboard: edited, shotSpecs: specs, context: DARK, apiKeys: ['k'], logger: quiet, environment: {}, fetchImpl: async () => { called = true; throw new Error('no AI call expected'); } });
  assert.equal(called, false, 'no AI call');
  assert.equal(result.provider, 'rebuild');
  assert.equal(result.timeline.shots[0].spec.elements.find((element) => element.role === 'title').content, 'Built for what comes next');
  assert.equal(result.timeline.shots[0].durationSeconds, 3.5);
  assert.equal(result.timeline.shots[0].spec.transitionOut, 'zoom');
  assert.equal(result.acceptance.mandatoryContent[0].copy, 'Built for what comes next', 'the acceptance spec matches the edit');
  const vertical = rebuildTimeline(edited, specs, { ...DARK, width: 720, height: 1280 });
  assert.deepEqual([vertical.timeline.width, vertical.timeline.height], [720, 1280]);
  assert.deepEqual(vertical.timeline.shots.map((shot) => shot.spec.recipe), result.timeline.shots.map((shot) => shot.spec.recipe), 'directing choices kept');
  assert.equal(vertical.acceptance.technicalRequirements.width, 720);
  assert.throws(() => rebuildTimeline(edited, specs.slice(1), DARK), /one shot direction for each/);
  specs[1].recipe = 'type-window';
  assert.notEqual(rebuildTimeline(edited, specs, DARK).timeline.shots[1].spec.recipe, 'type-window', 'the same rules apply to edits (no photos, no type window)');
});

test('stat, quote, product grid and split screen render inside the frame in every format', async () => {
  const { measureFrameFit } = await import('../src/production/production.mjs');
  const { brand, bakeProductPanels } = await productBrand();
  const photo = brand.products[0];
  const font = { fontFiles: [...FONT_FILES], loadSystemFonts: false, defaultFontFamily: 'Montserrat' };
  for (const [width, height] of [[1280, 720], [720, 1280], [960, 960]]) {
    const context = { ...DARK, width, height, products: Array.from({ length: 4 }, () => ({ width: 300, height: 450 })) };
    const plan = [
      { recipe: 'stat', copy: '98% recycled leather', kicker: 'Made better' },
      { recipe: 'quote', copy: 'The most comfortable loafer I have ever owned.', kicker: 'A customer' },
      { recipe: 'product-grid', copy: 'Every angle', product: 1 },
      { recipe: 'split', copy: 'Built to last', product: 2 },
    ];
    let start = 0;
    const shots = plan.map((item, index) => {
      const spec = { version: 2, ...item, durationInSeconds: 2, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut' };
      spec.elements = expandRecipe(spec, { copy: item.copy, context, shotIndex: index });
      const shot = { shotId: `s${index}`, startFrame: start, endFrame: start + 47, durationFrames: 48, palette: { primary: DARK.primaryColor, accent: DARK.accentColor }, spec };
      start += 48;
      return shot;
    });
    const timeline = { width, height, fps: 24, totalFrames: start, shots };
    assert.equal(measureFrameFit(timeline).pass, true, `${width}x${height}: ${JSON.stringify(measureFrameFit(timeline).failures)}`);
    assert.equal(shots[2].spec.elements.filter((element) => element.type === 'image').length, 4, 'a grid of four photos');
    const products = Array.from({ length: 4 }, () => ({ ...photo, graded: photo.graded }));
    const kit = { products };
    kit.panels = bakeProductPanels(timeline, kit);
    for (const frame of [3, 20, 47, 60, 100, 140, 180]) {
      const png = new Resvg(renderTimelineFrame(timeline, frame, kit), { fitTo: { mode: 'width', value: width / 4 }, font }).render();
      assert.equal(png.width, width / 4);
    }
    const counting = renderTimelineFrame(timeline, 8, kit);
    const settled = renderTimelineFrame(timeline, 47, kit);
    assert.doesNotMatch(counting, />98%</, 'mid-count shows a smaller number');
    assert.match(settled, /98%/, 'the count settles on the exact line');
  }
  const { normalizeDirection } = await import('../src/production/recipes.mjs');
  assert.notEqual(normalizeDirection({ recipe: 'stat', transitionOut: 'cut' }, { copy: 'No numbers here', index: 1, count: 3, seed: 's' }).direction.recipe, 'stat');
  assert.equal(normalizeDirection({ recipe: 'product-grid', transitionOut: 'cut' }, { copy: 'Every angle', index: 1, count: 3, seed: 's', productCount: 1 }).direction.recipe, 'product-hero');
});

test('brand fonts: measured exactly, used for headlines, drawn in their own face, and checked', async () => {
  const { readFontMetrics } = await import('../public/font-metrics.mjs');
  const { normalizeBrandFont, resolveFont } = await import('../src/production/brand-assets.mjs');
  const { readFileSync } = await import('node:fs');
  const known = JSON.parse(readFileSync(new URL('../assets/fonts/metrics.json', import.meta.url), 'utf8'));
  for (const role of ['display', 'medium']) {
    const measured = readFontMetrics(readFileSync(new URL(`../assets/fonts/${known[role].file}`, import.meta.url)));
    assert.equal(measured.family, known[role].family);
    assert.equal(measured.capHeight, known[role].capHeight);
    for (const character of 'AHWaegm0%') assert.ok(Math.abs(measured.advance[character] - known[role].advance[character]) < 0.0002, `${role} ${character}`);
  }
  assert.throws(() => readFontMetrics(Buffer.from('wOF2xxxxxxxxxxxxxxxx')), /web font/);
  // Montserrat Medium stands in for an uploaded brand font.
  const file = readFileSync(new URL('../assets/fonts/Montserrat-Medium.ttf', import.meta.url));
  const metrics = normalizeBrandFont(readFontMetrics(file));
  assert.ok(metrics);
  assert.equal(normalizeBrandFont({ family: 'X', capHeight: 9 }), undefined, 'nonsense metrics are refused');
  const context = { ...DARK, brandFont: metrics };
  const spec = { version: 2, recipe: 'title-reveal', durationInSeconds: 2, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut' };
  spec.elements = expandRecipe(spec, { copy: 'Inscribed in leather', context, shotIndex: 0 });
  const title = spec.elements.find((element) => element.role === 'title');
  assert.match(title.font, /^brand-/, 'headlines use the brand font');
  const timeline = { width: 1280, height: 720, fps: 24, totalFrames: 48, shots: [{ shotId: 's', startFrame: 0, endFrame: 47, durationFrames: 48, palette: { primary: DARK.primaryColor, accent: DARK.accentColor }, spec }] };
  const { measureFrameFit } = await import('../src/production/production.mjs');
  assert.equal(measureFrameFit(timeline).pass, true);
  assert.match(renderTimelineFrame(timeline, 47, {}), /font-family="Montserrat" font-weight="500"/);
  const resolved = resolveFont({ dataUri: `data:font/ttf;base64,${file.toString('base64')}` });
  assert.equal(resolved.extension, 'ttf');
  assert.throws(() => resolveFont({ dataUri: `data:font/ttf;base64,${Buffer.from('not a font at all').toString('base64')}` }), /isn’t a TTF or OTF/);
});

test('high-resolution output: sizes per format, sharper photos, original colors, and a real Full HD render', { timeout: 150_000 }, async () => {
  const { outputSize, gradeProduct, renderProductionProject } = await import('../scripts/render-production.mjs');
  const sizes = (width, height) => ['hd', 'fhd', '2k'].map((key) => `${outputSize({ width, height }, key).width}x${outputSize({ width, height }, key).height}`);
  assert.deepEqual(sizes(1280, 720), ['1280x720', '1920x1080', '2560x1440']);
  assert.deepEqual(sizes(720, 1280), ['720x1280', '1080x1920', '1440x2560']);
  assert.deepEqual(sizes(960, 960), ['960x960', '1080x1080', '1440x1440']);
  assert.equal(outputSize({ width: 1280, height: 720 }, 'nonsense').key, 'hd');
  const { Resvg: R } = await import('@resvg/resvg-js');
  const red = Buffer.from(new R('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600"><rect width="1600" height="1600" fill="#E0301E"/></svg>').render().asPng());
  const product = { dataUri: `data:image/png;base64,${red.toString('base64')}`, width: 1600, height: 1600 };
  const palette = { primary: DARK.primaryColor, accent: DARK.accentColor };
  const pixel = (uri) => { const png = new R(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><image href="${uri}" width="4" height="4"/></svg>`).render(); return [...png.pixels.slice(0, 3)]; };
  const original = gradeProduct(product, palette, { original: true, scale: 2 });
  assert.deepEqual(pixel(original).map((c) => Math.round(c / 16)), [14, 3, 2], 'original colors are kept');
  assert.notDeepEqual(pixel(gradeProduct(product, palette)).map((c) => Math.round(c / 16)), [14, 3, 2], 'the palette grade recolors');
  const size = (uri) => new R(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>`) && Buffer.from(uri.split(',')[1], 'base64').readUInt32BE(16);
  assert.equal(size(gradeProduct(product, palette, { scale: 2 })), 1440, 'prepared at 2K');
  assert.equal(size(gradeProduct({ ...product, width: 900, height: 900 }, palette, { scale: 2 })), 900, 'never enlarged past the source');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const context = { primaryColor: '#0E0E11', accentColor: '#7C3AED', durationInSeconds: 2 };
  const { storyboard } = await createCreativePlan('A short film for FOLD Motion', context, null);
  const { timeline } = await compileCreativePlan(storyboard, context, null);
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'fold-hires-'));
  try {
    const { buildAcceptanceSpec } = await import('../src/production/production.mjs');
    const { report } = await renderProductionProject({ timeline, storyboard, context, acceptance: buildAcceptanceSpec(storyboard, context), music: 'off', resolution: 'fhd', outputRoot });
    assert.deepEqual(report.output, { resolution: 'fhd', label: 'Full HD', width: 1920, height: 1080 });
    assert.equal(report.photoColor, 'original', 'original colors by default');
    assert.equal(report.productionQA.dimensions.pass, true);
    assert.equal(report.productionQA.pass, true);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test('quick wins: a shot every 2.5 seconds, missing photos flagged, type windows avoid white packshots', async () => {
  // A 15-second brief that comes back with four shots is rewritten for more cuts.
  const brief = '0:00 - 0:04 | One. 0:04 - 0:08 | Two. 0:08 - 0:11 | Three. 0:11 - 0:15 | Four';
  const base = (await createCreativePlan('A teaser', DARK, null)).storyboard;
  const four = { ...base, missingPhotos: ['the aromatherapy bath oil'], shots: ['Slow down', 'Neroli', 'Every ritual', 'Find your hour'].map((line, i) => ({ ...base.shots[0], id: `shot-0${i + 1}`, onScreenCopy: line, durationSeconds: 3.75 })) };
  const prompts = [];
  const result = await generateProductionAction({
    action: 'storyboard', prompt: brief, context: { ...DARK, products: [{ width: 300, height: 450 }] }, apiKeys: ['k'], logger: quiet, environment: {},
    fetchImpl: async (_url, options) => { prompts.push(JSON.parse(options.body).contents[0].parts[0].text); return { ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify(four) }] } }] }; } }; },
  });
  assert.equal(prompts.length, 2, 'four shots for 15 seconds is too few');
  assert.match(prompts[0], /missingPhotos/);
  assert.deepEqual(result.storyboard.missingPhotos, ['the aromatherapy bath oil']);
  // Plain packshots and product bounds survive the server's checks; nonsense is dropped.
  const { normalizeProductsMeta } = await import('../src/production/brand-assets.mjs');
  const meta = normalizeProductsMeta([{ width: 300, height: 450, plain: true, crop: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 } }, { width: 300, height: 450, plain: 'yes', crop: { x: 0.9, y: 0, w: 0.5, h: 1 } }]);
  assert.deepEqual(meta[0], { width: 300, height: 450, plain: true, crop: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 } });
  assert.deepEqual(meta[1], { width: 300, height: 450 });
  // Type windows prefer a textured photo, or fill with the cropped product.
  const window = (products, product) => {
    const spec = { version: 2, recipe: 'type-window', product, durationInSeconds: 2, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut' };
    return expandRecipe(spec, { copy: 'CITRUS', context: { ...DARK, products }, shotIndex: 1 }).find((element) => element.window).window;
  };
  const crop = { x: 0.3, y: 0.1, w: 0.4, h: 0.8 };
  assert.equal(window([{ width: 300, height: 450, plain: true, crop }, { width: 600, height: 400 }], 1).product, 2, 'steered to the textured photo');
  const cropped = window([{ width: 300, height: 450, plain: true, crop }], 1);
  assert.deepEqual(cropped.crop, crop, 'only packshots: fill with the product');
  const { brand } = await productBrand();
  const spec = { version: 2, recipe: 'type-window', product: 1, durationInSeconds: 2, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut' };
  spec.elements = expandRecipe(spec, { copy: 'CITRUS', context: { ...DARK, products: [{ width: 300, height: 450, plain: true, crop }] }, shotIndex: 1 });
  const frame = renderTimelineFrame({ width: 1280, height: 720, fps: 24, totalFrames: 48, shots: [{ shotId: 's', startFrame: 0, endFrame: 47, durationFrames: 48, palette: { primary: DARK.primaryColor, accent: DARK.accentColor }, spec }] }, 40, brand);
  assert.match(frame, /<svg [^>]*viewBox="90 45 120 360"/, 'the letters show the product region');
});

test('kinetic type: slam, drop, split, word beat, emphasis styles, echo and the payoff, in every format', async () => {
  const { applyTextMotion, limitFolds, normalizeDirection } = await import('../src/production/recipes.mjs');
  const { measureFrameFit, evaluateCreativeQA } = await import('../src/production/production.mjs');
  const font = { fontFiles: [...FONT_FILES], loadSystemFonts: false, defaultFontFamily: 'Montserrat' };
  for (const [width, height] of [[1280, 720], [720, 1280], [960, 960]]) {
    const context = { ...DARK, width, height, accentColor: '#C9A24A' };
    const plan = [
      { recipe: 'title-reveal', copy: 'Written in leather', textMotion: 'slam', emphasis: 'leather', emphasisStyle: 'highlight', echo: true },
      { recipe: 'statement', copy: 'Every detail, deliberate', textMotion: 'drop', emphasis: 'deliberate', emphasisStyle: 'pill' },
      { recipe: 'kicker-title', copy: 'Made to last', textMotion: 'split', emphasis: 'last', emphasisStyle: 'outline' },
      { recipe: 'word-beat', copy: 'Slow. Calm. Pure.' },
      { recipe: 'lockup', copy: 'Bring the Lakes home.', emphasis: 'Lakes', echo: true },
    ];
    let start = 0;
    const shots = plan.map((item, index) => {
      const spec = { version: 2, ...item, width, height, durationInSeconds: 2.5, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut' };
      // The real build puts a background rect first; contrast is measured against it.
      const background = { id: `s${index}-bg`, type: 'rect', x: 0, y: 0, width, height, fill: DARK.primaryColor };
      spec.elements = applyTextMotion([background, ...expandRecipe(spec, { copy: item.copy, context, shotIndex: index })], spec, context);
      const shot = { shotId: `s${index}`, startFrame: start, endFrame: start + 59, durationFrames: 60, palette: { primary: DARK.primaryColor, accent: '#C9A24A' }, spec };
      start += 60;
      return shot;
    });
    const timeline = { width, height, fps: 24, totalFrames: start, shots, palette: { primary: DARK.primaryColor, accent: '#C9A24A' } };
    const title = (index) => shots[index].spec.elements.find((element) => element.role === 'title');
    assert.deepEqual([0, 1, 2, 3].map((i) => title(i).reveal.style), ['slam', 'drop', 'split', 'beat']);
    assert.deepEqual([0, 1, 2].map((i) => title(i).emphasisStyle), ['highlight', 'pill', 'outline']);
    assert.ok(shots[0].spec.elements.some((element) => element.role === 'decor' && element.outline), 'an echo behind the opening');
    assert.equal(measureFrameFit(timeline).pass, true, `${width}x${height}: echoes are exempt, readable lines fit`);
    assert.equal(evaluateCreativeQA(timeline, context).contrast.pass, true, 'contrast ignores the echo');
    assert.equal(title(4).font, 'display', 'the payoff uses the display face');
    for (const frame of [4, 12, 30, 59, 66, 100, 130, 150, 190, 230, 250, 270, 299]) {
      const png = new Resvg(renderTimelineFrame(timeline, frame, {}), { fitTo: { mode: 'width', value: width / 4 }, font }).render();
      assert.equal(png.width, width / 4);
    }
    const beatMid = renderTimelineFrame(timeline, 180 + 8, {});
    assert.match(beatMid, />SLOW\.</, 'one word fills the frame');
    assert.doesNotMatch(beatMid, />CALM\.</);
    assert.match(renderTimelineFrame(timeline, 299, {}), /Lakes/, 'the payoff settles on the copy');
    assert.match(renderTimelineFrame(timeline, 119, {}), /rx=/, 'the pill sits behind its word');
  }
  // Highlighters and pills pick the ink (black or white) that reads on the accent:
  // that always clears 4.5:1, whatever the brand's accent is.
  const { contrastRatio, readableTextColor } = await import('../src/production/color.mjs');
  for (const accent of ['#808080', '#757575', '#C9A24A', '#7C3AED', '#183B35', '#E9A962', '#FF0055']) {
    const styled = applyTextMotion(expandRecipe({ version: 2, recipe: 'title-reveal', emphasis: 'leather', durationInSeconds: 2, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut' }, { copy: 'Written in leather', context: { ...DARK, accentColor: accent }, shotIndex: 0 }), { emphasisStyle: 'highlight', durationInSeconds: 2 }, { ...DARK, accentColor: accent })
      .find((element) => element.role === 'title');
    // Used only where its ink reads; refused only where it genuinely wouldn't.
    if (styled.emphasisStyle === 'highlight') assert.ok(contrastRatio(styled.emphasisInk, accent) >= 4.5, accent);
    else assert.ok(contrastRatio(readableTextColor(accent), accent) < 4.5, `${accent} was refused but reads`);
    if (['#C9A24A', '#7C3AED', '#E9A962', '#FF0055'].includes(accent)) assert.equal(styled.emphasisStyle, 'highlight', accent);
  }
  const specs = [{ version: 2, textMotion: 'slam', echo: true }, { version: 2, textMotion: 'slam', echo: true }, { version: 2, textMotion: 'drop', echo: true }];
  limitFolds(specs);
  assert.deepEqual(specs.map((spec) => spec.textMotion), ['slam', 'rise', 'drop']);
  assert.equal(specs.filter((spec) => spec.echo).length, 2);
  const kept = normalizeDirection({ recipe: 'title-reveal', textMotion: 'split', emphasisStyle: 'pill', echo: true, transitionOut: 'cut' }, { copy: 'Made to last', index: 1, count: 3, seed: 's' }).direction;
  assert.deepEqual([kept.textMotion, kept.emphasisStyle, kept.echo], ['split', 'pill', true]);
  assert.equal(normalizeDirection({ recipe: 'word-beat', transitionOut: 'cut' }, { copy: 'One', index: 1, count: 3, seed: 's' }).direction.recipe, 'title-reveal');
});

test('style kits: chosen from the brief, enforced in code, overridable, and a gallery of five briefs complies', async () => {
  const { chooseStyle, enforceStyleKit, STYLE_KITS } = await import('../src/production/style-kits.mjs');
  const { rebuildTimeline, measureFrameFit } = await import('../src/production/production.mjs');
  const { limitFolds } = await import('../src/production/recipes.mjs');
  assert.equal(chooseStyle('A luxurious, refined fragrance film'), 'editorial-luxury');
  assert.equal(chooseStyle('A playful, bright snack drop for Gen Z'), 'playful-dtc');
  assert.equal(chooseStyle('A precise film for a smart device app'), 'tech-ui');
  assert.equal(chooseStyle('Streetwear sneaker drop, loud and bold'), 'bold-street');
  assert.equal(chooseStyle('Hand-poured candles from a small batch workshop'), 'warm-craft');
  assert.equal(chooseStyle('A film', 'energetic'), 'bold-street', 'the music mood breaks ties');
  // Enforcement: the kit wins over the model's choices.
  const specs = [
    { version: 2, textMotion: 'drop', emphasisStyle: 'pill', echo: true, graphics: [{ kind: 'emoji', name: 'fire' }, { kind: 'icon', name: 'leaf' }] },
    { version: 2, textMotion: 'slam', graphics: [{ kind: 'badge', name: 'seal', text: 'NEW' }, { kind: 'sign', name: 'sparkle' }] },
  ];
  const changes = enforceStyleKit(specs, 'editorial-luxury');
  assert.equal(specs[0].textMotion, 'rise', 'luxury has no drops');
  assert.equal(specs[0].emphasisStyle, 'gradient', 'or pills');
  assert.deepEqual(specs[0].graphics.map((g) => g.kind), ['icon'], 'no emojis in luxury');
  assert.deepEqual(specs[1].graphics.map((g) => g.kind), ['sign'], 'no badges either');
  assert.ok(changes.length >= 4);
  const warm = [{ version: 2, textMotion: 'slam', typeEffect: 'decode' }];
  enforceStyleKit(warm, 'warm-craft');
  assert.deepEqual([warm[0].textMotion, warm[0].typeEffect], ['rise', undefined]);
  const budget = Array.from({ length: 5 }, () => ({ version: 2, graphics: [{ kind: 'icon', name: 'leaf' }] }));
  enforceStyleKit(budget, 'warm-craft');
  assert.equal(budget.reduce((sum, spec) => sum + spec.graphics.length, 0), STYLE_KITS['warm-craft'].maxGraphics);
  // Variety: no shot type three times in a row.
  const same = [1, 2, 3].map(() => ({ version: 2, recipe: 'statement' }));
  limitFolds(same);
  assert.deepEqual(same.map((spec) => spec.recipe), ['statement', 'statement', 'title-reveal']);
  // A gallery of five briefs, one per kit: chosen right, compliant, inside the frame.
  const gallery = {
    'editorial-luxury': 'A refined, luxurious 10-second film for a jewelled fragrance',
    'playful-dtc': 'A playful, bright 10-second film for a juicy snack drop',
    'tech-ui': 'A precise 10-second film for a smart home app',
    'bold-street': 'A loud 10-second streetwear sneaker drop',
    'warm-craft': 'A cosy 10-second film for hand-poured candles',
  };
  for (const [style, brief] of Object.entries(gallery)) {
    const { storyboard } = await createCreativePlan(brief, DARK, null);
    assert.equal(storyboard.style, style, brief);
    const { timeline } = await compileCreativePlan(storyboard, DARK, null);
    assert.equal(timeline.style, style);
    const kit = STYLE_KITS[style];
    for (const shot of timeline.shots) {
      const spec = shot.spec;
      if (spec.textMotion) assert.ok(kit.textMotions.includes(spec.textMotion), `${style}: ${spec.textMotion}`);
      if (spec.echo) assert.ok(kit.echo, `${style}: echo`);
      if (spec.typeEffect) assert.ok(kit.typeEffects.includes(spec.typeEffect), `${style}: ${spec.typeEffect}`);
    }
    assert.equal(measureFrameFit(timeline).pass, true, style);
    // The studio's Style picker: the same film rebuilt under another kit.
    const other = style === 'playful-dtc' ? 'editorial-luxury' : 'playful-dtc';
    const rebuilt = rebuildTimeline(storyboard, timeline.shots.map((shot) => ({ ...shot.spec, elements: undefined })), { ...DARK, style: other });
    assert.equal(rebuilt.timeline.style, other);
  }
});

test('film polish: one-word runs become word beats, color words light up, the payoff gets time, short statements grow', async () => {
  const { mergeWordRuns, protectPayoff } = await import('../src/production/production.mjs');
  const { normalizeDirection, colorForWord, applyTextMotion } = await import('../src/production/recipes.mjs');
  const { contrastRatio } = await import('../src/production/color.mjs');
  const shot = (id, copy, durationSeconds = 1.3) => ({ id, onScreenCopy: copy, durationSeconds, purpose: 'p', mainVisual: 'v', motion: 'm', transition: 't', audioCue: 'a' });
  const storyboard = { shots: [shot('s1', 'Ruby.'), shot('s2', 'Sapphire'), shot('s3', 'Emerald.'), shot('s4', 'Every ritual, sealed with a jewel', 3), shot('s5', 'Calm.'), shot('s6', 'Glow.'), shot('s7', 'Results worth the ritual.', 3)] };
  const merged = mergeWordRuns(storyboard);
  assert.deepEqual(storyboard.shots.map((s) => s.onScreenCopy), ['Ruby. Sapphire. Emerald.', 'Every ritual, sealed with a jewel', 'Calm.', 'Glow.', 'Results worth the ritual.']);
  assert.equal(storyboard.shots[0].durationSeconds, 3.9, 'the run keeps its time');
  assert.equal(merged.length, 1, 'pairs and the end card stay as they are');
  const longRun = { shots: [shot('l1', 'Ruby.', 3), shot('l2', 'Sapphire.', 3), shot('l3', 'Emerald.', 3), shot('l4', 'The end.', 3)] };
  assert.equal(mergeWordRuns(longRun).length, 0, 'a nine-second run would sit on the line: not merged');
  assert.equal(normalizeDirection({ recipe: 'title-reveal', transitionOut: 'cut' }, { copy: 'Slow. Calm. Pure.', index: 1, count: 4, seed: 's' }).direction.recipe, 'word-beat');
  assert.equal(normalizeDirection({ recipe: 'title-reveal', transitionOut: 'cut' }, { copy: 'Slow and calm', index: 1, count: 4, seed: 's' }).direction.recipe, 'title-reveal');
  // Color words light up, readable on the background.
  const purple = '#2A1838';
  for (const word of ['Ruby.', 'SAPPHIRE', 'emerald', 'Gold', 'citrus']) assert.ok(contrastRatio(colorForWord(word, purple), purple) >= 4.5, word);
  assert.equal(colorForWord('ritual', purple), undefined);
  const context = { width: 1280, height: 720, primaryColor: purple, accentColor: '#C9A55C' };
  const beatSpec = { version: 2, recipe: 'word-beat', durationInSeconds: 3, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut' };
  beatSpec.elements = applyTextMotion(expandRecipe(beatSpec, { copy: 'Ruby. Sapphire. Emerald.', context, shotIndex: 0 }), beatSpec, context);
  const beat = beatSpec.elements.find((e) => e.role === 'title');
  assert.equal(beat.wordColors.length, 3);
  const frame = renderTimelineFrame({ width: 1280, height: 720, fps: 24, totalFrames: 72, shots: [{ shotId: 's', startFrame: 0, endFrame: 71, durationFrames: 72, palette: { primary: purple, accent: '#C9A55C' }, spec: beatSpec }] }, 4, {});
  assert.ok(frame.includes(`fill="${beat.wordColors[0]}"`), 'RUBY is drawn in ruby');
  const resolved = renderTimelineFrame({ width: 1280, height: 720, fps: 24, totalFrames: 72, shots: [{ shotId: 's', startFrame: 0, endFrame: 71, durationFrames: 72, palette: { primary: purple, accent: '#C9A55C' }, spec: beatSpec }] }, 71, {});
  assert.ok(beat.wordColors.every((color) => resolved.includes(`fill="${color}"`)), 'the resolved line keeps every color');
  const goldSpec = { version: 2, recipe: 'title-reveal', emphasis: 'gold', durationInSeconds: 2, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut' };
  const gold = applyTextMotion(expandRecipe(goldSpec, { copy: 'Sealed in gold', context, shotIndex: 1 }), goldSpec, context).find((e) => e.role === 'title');
  assert.equal(gold.emphasis.from, colorForWord('gold', purple), 'an emphasized color word takes its color');
  // The payoff gets time; the film keeps its length; nothing drops under 1.2s.
  const specs = [3.4, 3.2, 3.0, 2.4, 1.5].map((durationInSeconds, i) => ({ version: 2, recipe: i === 4 ? 'lockup' : 'statement', durationInSeconds }));
  protectPayoff(specs, 'durationInSeconds');
  assert.ok(specs[4].durationInSeconds >= 2.7, `end card ${specs[4].durationInSeconds}`);
  assert.equal(Number(specs.reduce((sum, s) => sum + s.durationInSeconds, 0).toFixed(2)), 13.5);
  assert.ok(specs.every((s) => s.durationInSeconds >= 1.2));
  // Short statements grow.
  const statement = (copy) => expandRecipe({ version: 2, recipe: 'statement', durationInSeconds: 2, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut' }, { copy, context, shotIndex: 1 }).find((e) => e.role === 'title').fontSize;
  assert.ok(statement('Radiance, renewed.') > 720 * 0.105 + 1, 'two words fill the space');
});

test('brief adherence: beats set the shot count, end-card lines stay on the end card, the brief\'s motion words bind', async () => {
  const { applyBriefWords } = await import('../src/production/production.mjs');
  const shot = (id, copy, durationSeconds, mainVisual = 'v') => ({ id, onScreenCopy: copy, durationSeconds, purpose: 'p', mainVisual, motion: 'm', transition: 't', audioCue: 'a' });
  const run = async (prompt, shots) => {
    const prompts = [];
    const base = (await createCreativePlan('A film', DARK, null)).storyboard;
    const result = await generateProductionAction({
      action: 'storyboard', prompt, context: DARK, apiKeys: ['k'], logger: quiet, environment: {},
      fetchImpl: async (_url, options) => { prompts.push(JSON.parse(options.body).contents[0].parts[0].text); return { ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify({ ...base, shots }) }] } }] }; } }; },
    });
    return { prompts, storyboard: result.storyboard };
  };
  // Test 1's brief: three beats (3, 2, 3 seconds) are three shots; no padding asked for.
  const test1 = ['SEV7NFOLD | Hello', '', 'An 8-second brand intro.', '', '0:00 - 0:03 | Arrival', 'The line slams in: Ideas into motion.', '', '0:03 - 0:05 | Promise', 'Made with craft.', '', '0:05 - 0:08 | Signature', '• On-Screen Text:', 'SEV7NFOLD', 'Creativity at scale.'].join('\n');
  const three = await run(test1, [shot('s1', 'Ideas into motion.', 3), shot('s2', 'Made with craft.', 2), shot('s3', 'SEV7NFOLD', 3)]);
  assert.equal(three.prompts.length, 1, 'three beats, three shots: no rewrite');
  assert.equal(three.storyboard.shots.at(-1).durationSeconds, 3, 'the end card keeps its beat');
  // A padded shot repeating the end card's second line is removed, its time shared.
  const padded = await run(test1, [shot('s1', 'Ideas into motion.', 3), shot('s2', 'Made with craft.', 2), shot('s3', 'CREATIVITY AT SCALE.', 1.7), shot('s4', 'SEV7NFOLD', 1.3)]);
  assert.deepEqual(padded.storyboard.shots.map((s) => s.onScreenCopy), ['Ideas into motion.', 'Made with craft.', 'SEV7NFOLD']);
  // Long middle beats want two shots each; the end card's beat stays one.
  const long = ['0:00 - 0:04 | A', 'One', '0:04 - 0:08 | B', 'Two', '0:08 - 0:11 | C', 'Three', '0:11 - 0:15 | D', '• On-Screen Text:', 'END.'].join('\n');
  const four = await run(long, [shot('s1', 'One', 4), shot('s2', 'Two', 4), shot('s3', 'Three', 3), shot('s4', 'END.', 4)]);
  assert.equal(four.prompts.length, 2);
  assert.match(four.prompts[1], /Return exactly 6 shots: one per beat, two in beats of four seconds or longer/);
  // No timecodes: the payoff gets its time on the storyboard, where it sticks.
  const untimed = await run('A 10-second film for FOLD Motion', [shot('s1', 'Ideas into motion', 2.6), shot('s2', 'Made with craft', 2.6), shot('s3', 'Every frame measured', 2.6), shot('s4', 'Built to move', 1.2), shot('s5', 'The end card.', 1.0)]);
  assert.ok(untimed.storyboard.shots.at(-1).durationSeconds >= 1.99, `end card ${untimed.storyboard.shots.at(-1).durationSeconds}`);
  // The brief's motion words bind.
  const bind = (mainVisual, copy = 'Ideas into motion.', direction = { typeEffect: 'outline', recipe: 'title-reveal' }) => { applyBriefWords(direction, shot('s', copy, 2, mainVisual)); return direction; };
  assert.deepEqual([bind('The line slams in: Ideas into motion.').textMotion, bind('The line slams in').typeEffect], ['slam', undefined]);
  assert.equal(bind('Letters drop in one by one', 'Every hit lands.', {}).textMotion, 'drop');
  assert.equal(bind('The line splits in from both sides', 'Every frame, measured.', {}).textMotion, 'split');
  assert.equal(bind('The line traces itself in as an outline, then fills', 'Craft is a decision.', {}).typeEffect, 'outline');
  assert.equal(bind('The line decodes from code glyphs', 'Built in code.', {}).typeEffect, 'decode');
  assert.equal(bind('MINUTES gets a highlighter', 'Minutes, not weeks.', {}).emphasisStyle, 'highlight');
  assert.equal(bind('DROPS sits in a pill', 'Your next ad drops in minutes.', {}).emphasisStyle, 'pill');
  assert.equal(bind('A giant outlined CRAFT echoes behind the shot', 'Craft is a decision.', {}).echo, true);
  assert.equal(bind('A word beat: each word fills the frame', 'Landscape. Vertical. Square.', {}).recipe, 'word-beat');
  assert.equal(bind('A count-up', '3 formats from 1 brief.', {}).recipe, 'stat');
  assert.equal(bind('A quote card attributed to SEV7NFOLD', 'We give ideas motion.', {}).recipe, 'quote');
});

test('test 2 fixes: headline effects leave word beats and count-ups alone; the brief\'s typography beats the style kit', async () => {
  const { applyTypeEffect, normalizeDirection, expandRecipe: expand } = await import('../src/production/recipes.mjs');
  const { enforceStyleKit } = await import('../src/production/style-kits.mjs');
  const { applyBriefWords } = await import('../src/production/production.mjs');
  // A decode on a word beat would replace its beats.
  const spec = { version: 2, recipe: 'word-beat', typeEffect: 'decode', durationInSeconds: 2.8, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut' };
  const title = applyTypeEffect(expand(spec, { copy: 'Landscape. Vertical. Square.', context: DARK, shotIndex: 0 }), spec).find((e) => e.role === 'title');
  assert.equal(title.reveal.style, 'beat');
  assert.equal(normalizeDirection({ recipe: 'word-beat', typeEffect: 'decode', transitionOut: 'cut' }, { copy: 'Landscape. Vertical. Square.', index: 0, count: 4, seed: 's' }).direction.typeEffect, undefined);
  assert.equal(normalizeDirection({ recipe: 'title-reveal', typeEffect: 'decode', transitionOut: 'cut' }, { copy: 'Landscape. Vertical. Square.', index: 0, count: 4, seed: 's' }).direction.typeEffect, undefined, 'a staccato line becomes a word beat, without the effect');
  const word = { recipe: 'title-reveal', typeEffect: 'decode' };
  applyBriefWords(word, { id: 's1', onScreenCopy: 'Landscape. Vertical. Square.', mainVisual: 'A word beat: Landscape. Vertical. Square.' });
  assert.deepEqual([word.recipe, word.typeEffect], ['word-beat', undefined]);
  // The brief asked for a highlighter; Tech & UI doesn't use them, but the brief wins.
  const asked = { version: 2, recipe: 'statement' };
  applyBriefWords(asked, { id: 's3', onScreenCopy: 'Minutes, not weeks.', mainVisual: 'The line splits in: Minutes, not weeks. MINUTES gets a highlighter.' });
  assert.deepEqual([asked.textMotion, asked.emphasisStyle], ['split', 'highlight']);
  enforceStyleKit([asked], 'tech-ui');
  assert.equal(asked.emphasisStyle, 'highlight', 'the brief\'s own words stay');
  // The model's own choice still follows the kit, and graphics stay guarded.
  const chosen = { version: 2, recipe: 'statement', emphasisStyle: 'highlight', graphics: [{ kind: 'icon', name: 'music' }] };
  const lockedGraphic = { version: 2, recipe: 'statement', briefLocked: ['emphasisStyle'], emphasisStyle: 'pill', graphics: [{ kind: 'icon', name: 'music' }] };
  enforceStyleKit([chosen, lockedGraphic], 'bold-street');
  assert.equal(chosen.emphasisStyle, 'highlight', 'bold street allows highlighters');
  assert.deepEqual([chosen.graphics.length, lockedGraphic.graphics.length], [0, 0], 'bold street drops icons, asked for or not');
  const techChosen = { version: 2, recipe: 'statement', emphasisStyle: 'highlight' };
  enforceStyleKit([techChosen], 'tech-ui');
  assert.equal(techChosen.emphasisStyle, 'outline', 'without the brief asking, the kit decides');
});

test('test 3 fixes: emojis, badges, signs and icons the brief names are binding; the kit still guards them; emojis are sticker-sized', async () => {
  const { applyBriefWords } = await import('../src/production/production.mjs');
  const { enforceStyleKit } = await import('../src/production/style-kits.mjs');
  const { applyGraphics } = await import('../src/production/recipes.mjs');
  const bind = (copy, mainVisual, direction = {}) => { applyBriefWords(direction, { id: 's', onScreenCopy: copy, mainVisual }); return direction; };
  const hey = bind('Hey you.', 'Letters drop in: Hey you. A 👀 emoji pops up beside it.');
  assert.equal(hey.textMotion, 'drop');
  assert.deepEqual(hey.graphics, [{ kind: 'emoji', name: 'eyes', place: 'right' }]);
  const dropShot = bind('Your next ad drops in minutes.', 'Your next ad drops in minutes. DROPS sits in a pill, a ✨ emoji above, and a NEW seal sticker on the corner.');
  assert.equal(dropShot.textMotion, undefined, 'the copy\'s own "drops in" is not an instruction');
  assert.equal(dropShot.emphasisStyle, 'pill');
  assert.deepEqual(dropShot.graphics.map((g) => [g.kind, g.name, g.text, g.place]), [['emoji', 'sparkles', undefined, 'above'], ['badge', 'seal', 'NEW', 'top-right']]);
  const ai = bind('Built in code. Directed by AI.', 'The line decodes from code glyphs: Built in code. Directed by AI. AI gets a marker highlight, and an arrow points at it.');
  assert.deepEqual([ai.typeEffect, ai.emphasisStyle, ai.graphics[0].name], ['decode', 'highlight', 'arrow-right']);
  // Test 5's trap: the brief asks for a music icon; Bold street doesn't use icons.
  const sound = bind('Real instruments, locked to the cut.', 'The line splits in: Real instruments, locked to the cut. A music icon beside it. Then The Fold.', { version: 2 });
  assert.deepEqual(sound.graphics, [{ kind: 'icon', name: 'music', place: 'right' }]);
  enforceStyleKit([sound], 'bold-street');
  assert.deepEqual([sound.graphics, sound.textMotion], [[], 'split'], 'the icon is dropped; the split stays');
  // Emojis read as stickers, even beside a small line.
  const context = { ...DARK, width: 1280, height: 720 };
  const spec = { version: 2, recipe: 'statement', copy: 'Your next ad drops in minutes.', durationInSeconds: 2.5, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut', graphics: [{ kind: 'emoji', name: 'sparkles', place: 'above' }] };
  const emoji = applyGraphics(expandRecipe(spec, { copy: spec.copy, context, shotIndex: 1 }), spec, context).find((e) => e.type === 'graphic');
  assert.ok(emoji.size >= 72, `emoji ${emoji.size}px`);
});

test('tests 4 and 5 fixes: named transitions bind, long lines and quotes set bigger and balanced', async () => {
  const { applyBriefTransitions } = await import('../src/production/production.mjs');
  const { limitFolds } = await import('../src/production/recipes.mjs');
  const { fitBlock, measure } = await import('../src/render/typography.mjs');
  // Test 4's beats: a zoom out of the first shot, The Fold out of the third, and a
  // second Fold "resolving into" the end card.
  const shots = [
    { id: 's1', onScreenCopy: 'Craft is a decision.', mainVisual: 'The line traces itself in as an outline, then fills. A giant outlined CRAFT echoes behind the shot. Then the camera flies through a letter into the next shot.' },
    { id: 's2', onScreenCopy: 'We don\'t decorate ideas. We give them motion.', mainVisual: 'A quote card.' },
    { id: 's3', onScreenCopy: 'Every frame, measured.', mainVisual: 'The line splits in from both sides. MEASURED is outlined. Then The Fold.' },
    { id: 's4', onScreenCopy: 'CREATIVITY AT SCALE.', mainVisual: 'A second Fold resolves into the logo. The payoff slams in.' },
  ];
  const specs = shots.map(() => ({ version: 2, transitionOut: 'fade' }));
  applyBriefTransitions(specs, shots);
  limitFolds(specs, shots.map((s) => s.id));
  assert.deepEqual(specs.slice(0, 3).map((s) => s.transitionOut), ['zoom', 'fade', 'fold']);
  // Limits still apply: a second zoom becomes a push.
  const zoomShots = [shots[0], { ...shots[0], id: 's1b' }, { id: 'e', onScreenCopy: 'END.', mainVisual: 'The end card.' }];
  const twoZooms = zoomShots.map(() => ({ version: 2, transitionOut: 'cut' }));
  applyBriefTransitions(twoZooms, zoomShots);
  limitFolds(twoZooms, ['a', 'b', 'c']);
  assert.deepEqual(twoZooms.slice(0, 2).map((s) => s.transitionOut), ['zoom', 'push']);
  // Test 5's long lines in a vertical frame (where one line must shrink a lot): two
  // balanced lines at bigger sizes. (At 16:9 width they already fit near full size.)
  for (const line of ['Every line fits. Every hit lands.', 'Real instruments, locked to the cut.']) {
    const one = fitBlock('bold', line, { maxWidth: 619, maxSize: 75, minSize: 36, maxLines: 1 });
    const block = fitBlock('bold', line, { maxWidth: 619, maxSize: 75, minSize: 36, maxLines: 2 });
    assert.ok(block.size >= one.size * 1.15, `${line}: ${block.size} vs ${one.size}`);
    assert.equal(block.lines.length, 2);
    const widths = block.lines.map((l) => measure('bold', l, block.size));
    assert.ok(Math.min(...widths) / Math.max(...widths) > 0.5, `balanced: ${block.lines.join(' / ')}`);
  }
  // Test 4's quote fills the frame instead of one small line.
  const quote = expandRecipe({ version: 2, recipe: 'quote', durationInSeconds: 4, motion: { camera: 'static', atmosphere: 'spotlight' }, transitionOut: 'cut' }, { copy: 'We don\'t decorate ideas. We give them motion.', context: { ...DARK, width: 1280, height: 720 }, shotIndex: 1 }).find((e) => e.role === 'title');
  assert.ok(quote.lines.length >= 2 && quote.fontSize >= 720 * 0.06, `quote ${quote.fontSize}px over ${quote.lines.length} lines`);
  // A full line keeps one line.
  assert.equal(fitBlock('bold', 'Short line', { maxWidth: 1024, maxSize: 75, minSize: 36, maxLines: 2 }).lines.length, 1);
  assert.equal(fitBlock('bold', 'Every line fits. Every hit lands.', { maxWidth: 1024, maxSize: 75, minSize: 36, maxLines: 2 }).lines.length, 1, 'near full size on one line: kept');
});
