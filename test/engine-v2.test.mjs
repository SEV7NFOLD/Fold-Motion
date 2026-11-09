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
  assert.match(prompts[1], /only 3 shots for a 10-second film/);
  assert.match(prompts[1], /Return exactly 6 shots/);
  assert.match(prompts[1], /two or three shots inside each timecoded beat/);
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
