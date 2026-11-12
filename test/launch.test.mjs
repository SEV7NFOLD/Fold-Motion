import assert from 'node:assert/strict';
import test from 'node:test';
import { compileCreativePlan, createCreativePlan, validateTimeline } from '../src/production/production.mjs';
import { launchReadingCheck, listParts, planLaunch, wordBeats } from '../src/production/launch.mjs';
import { openScene } from '../src/browser/render-browser.mjs';

const C = { width: 1920, height: 1080, fps: 30, primaryColor: '#0B0F19', accentColor: '#00F0FF' };
async function launchTimeline(copy, { size = C } = {}) {
  const base = (await createCreativePlan('A launch film for FOLD Motion', size, null)).storyboard;
  const storyboard = { ...base, musicMood: 'energetic', shots: copy.map(([text, d], i) => ({ ...base.shots[Math.min(i, base.shots.length - 1)], id: `shot-${i + 1}`, durationSeconds: d, onScreenCopy: text })) };
  return (await compileCreativePlan(storyboard, { ...size, launch: true }, null)).timeline;
}
const DEMO = [['Your idea deserves motion.', 3], ['Turn a brief into a film.', 2.5], ['Exact.', 1], ['With neroli, mandarin, frankincense & lavender.', 5], ['Ideas into motion.', 2.5]];

let browser = false;
try { const { chromium } = await import('playwright'); const b = await chromium.launch(); await b.close(); browser = true; } catch { browser = false; }
const needsBrowser = browser ? {} : { skip: 'Chromium for Playwright is not installed' };

test('lists split into a lead and items that join back to the exact copy', () => {
  const r = listParts('With neroli, mandarin, frankincense & lavender.');
  assert.deepEqual([r.lead, r.items], ['With', ['neroli,', 'mandarin,', 'frankincense', '& lavender.']]);
  assert.equal(r.raw.join(''), 'With neroli, mandarin, frankincense & lavender.');
  assert.deepEqual(listParts('Spend, earn and save.').items, ['Spend,', 'earn', 'and save.']);
  assert.equal(listParts('Every word, exactly as approved.'), null);
  assert.equal(listParts('A sneaker drop built for night runs.'), null);
});

test('short build lines go word by word, keeping small words with the next main word', () => {
  assert.deepEqual(wordBeats('Your idea deserves motion.'), ['Your idea', 'deserves', 'motion.']);
  assert.deepEqual(wordBeats('Turn a brief into a film.'), ['Turn', 'a brief', 'into a film.']);
  for (const line of ['Relax & unwind.', 'Built for the night', 'The end']) assert.equal(wordBeats(line).join(' '), line);
});

test('the launch planner gives each shot a device, on the beat, with time to read', async () => {
  const timeline = await launchTimeline(DEMO);
  assert.equal(validateTimeline(timeline).valid, true);
  assert.equal(timeline.beat.bpm, 120);
  assert.deepEqual(timeline.launch.shots.map((s) => s.device), ['build', 'build', 'punch', 'swap', 'lockup']);
  for (const shot of timeline.shots) {
    const L = shot.spec.launch; const beats = shot.durationFrames / timeline.beat.framesPerBeat;
    [].concat(L.at).forEach((a) => { assert.ok(a >= 0 && a < beats, `${shot.shotId}: beat ${a} outside ${beats}`); assert.equal(a * 2, Math.round(a * 2), 'on the half-beat grid'); });
  }
  assert.deepEqual(launchReadingCheck(timeline), { pass: true, failures: [] });
  // four ingredients in three seconds at 120 BPM can't all be read: the check says so
  const rushed = await launchTimeline([['Your idea deserves motion.', 3], ['With neroli, mandarin, frankincense & lavender.', 3], ['Ideas into motion.', 2.5]]);
  const rushedCheck = launchReadingCheck(rushed);
  assert.equal(rushedCheck.pass, false);
  assert.ok(rushedCheck.failures.some((f) => f.text === 'frankincense'), JSON.stringify(rushedCheck.failures));
  // a long closing line is built, not assembled letter by letter
  const long = await launchTimeline([['Ideas into motion.', 3], ['FOLD Motion turns a brief into a finished film, on the beat.', 4]]);
  assert.equal(long.launch.shots[1].device, 'build');
});

test('planLaunch refuses a timeline without beat timing', async () => {
  const { storyboard } = await createCreativePlan('A launch film', C, null);
  const { timeline } = await compileCreativePlan(storyboard, C, null);
  assert.throws(() => planLaunch(timeline, storyboard), /beat-timed/);
});

test('the launch runtime draws every device with exact copy, in frame, deterministically', needsBrowser, async () => {
  const timeline = await launchTimeline(DEMO, { size: { ...C, width: 960, height: 540 } });
  const scene = await openScene(timeline);
  try {
    for (const shot of await scene.check()) assert.ok(shot.pass, JSON.stringify(shot));
    await scene.draw(1.3); const a = await scene.capture();
    await scene.draw(8.1); await scene.draw(1.3); const b2 = await scene.capture();
    assert.ok(a.equals(b2), 'the same moment draws the same pixels');
  } finally { await scene.close(); }
});

test('a list item keeps its determiner, and the first item is timed with its lead', async () => {
  assert.deepEqual(listParts('With your fonts, your colors & your beat.').items, ['your fonts,', 'your colors', '& your beat.']);
  assert.equal(listParts('With your fonts, your colors & your beat.').lead, 'With');
  const timeline = await launchTimeline([['Your idea deserves motion.', 3], ['With your fonts, your colors & your beat.', 4], ['Ideas into motion.', 2.5]]);
  assert.deepEqual(launchReadingCheck(timeline), { pass: true, failures: [] });
});

test('continuity: a fly-into once, alternating flips and whips, a collapse into the lockup, and themes that follow', async () => {
  const { planTransitions, TRANSITION_BEATS } = await import('../src/production/launch.mjs');
  const plan = planTransitions(['build', 'build', 'punch', 'swap', 'lockup'], ['Your idea deserves motion.', 'Turn a brief into a film.', 'Exact.', 'With a, b & c.', 'Ideas into motion.']);
  assert.deepEqual(plan.out, ['fly-into', 'flip', 'whip', 'collapse', null]);
  assert.deepEqual(plan.theme, ['brand', 'paper', 'brand', 'brand', 'brand']);
  const noPeriod = planTransitions(['build', 'build', 'build'], ['Hello there', 'Fast', 'The end']);
  assert.deepEqual(noPeriod.out, ['flip', 'whip', null], 'no closing period, no fly-into');
  // transition beats are reserved: copy is read before the transition starts
  const timeline = await launchTimeline(DEMO);
  timeline.shots.forEach((shot) => {
    const L = shot.spec.launch; if (!L.out) return;
    const lastAt = [].concat(L.at).slice(-1)[0];
    assert.ok(lastAt < shot.durationFrames / timeline.beat.framesPerBeat - TRANSITION_BEATS[L.out], `${shot.shotId}: copy lands before the ${L.out}`);
  });
  assert.equal(launchReadingCheck(timeline).pass, true);
});

test('UI kit: quotes type, short sentences check, numbers count, and every split joins back exactly', async () => {
  const { quotedText, checklistRows, countParts } = await import('../src/production/launch.mjs');
  assert.equal(quotedText('“A 15-second launch film for Volt Runner”'), 'A 15-second launch film for Volt Runner');
  assert.equal(quotedText('"Plan my launch"'), 'Plan my launch');
  assert.equal(quotedText('Not a quote'), null);
  assert.deepEqual(checklistRows('Exact copy. Your fonts. On the beat.'), ['Exact copy.', 'Your fonts.', 'On the beat.']);
  assert.equal(checklistRows('Turn a brief into a film.'), null, 'one sentence is not a list');
  assert.equal(checklistRows('One. Two. Three. Four. Five.'), null, 'more than four rows is too many');
  for (const c of ['3 formats, one story.', 'Save 50% today', 'Join 12,000 teams', '10x faster.']) {
    const r = countParts(c); assert.ok(r, c); assert.equal(r.before + r.number + r.after, c);
  }
  assert.equal(countParts('Join 12,000 teams').value, 12000);
  assert.equal(countParts('Every word, exact.'), null);
});

test('UI kit planning: devices from the copy, the click after the typing, and time to read', async () => {
  const timeline = await launchTimeline([['Your idea deserves motion.', 3], ['“A 15-second launch film for Volt Runner”', 4], ['Exact copy. Your fonts. On the beat.', 4], ['3 formats, one story.', 2.5], ['Ideas into motion.', 2.5]]);
  assert.deepEqual(timeline.launch.shots.map((s) => s.device), ['build', 'type', 'check', 'count', 'lockup']);
  const type = timeline.shots[1].spec.launch;
  assert.ok(type.clickAt >= type.at + type.typeBeats + 0.5, 'the cursor clicks after the typing');
  assert.ok(type.clickAt < timeline.shots[1].durationFrames / timeline.beat.framesPerBeat, 'and before the cut');
  assert.deepEqual(launchReadingCheck(timeline), { pass: true, failures: [] });
});

test('the launch runtime draws the UI kit with exact copy and in frame', needsBrowser, async () => {
  const timeline = await launchTimeline([['Your idea deserves motion.', 3], ['“A 15-second launch film for Volt Runner”', 4], ['Exact copy. Your fonts. On the beat.', 4], ['3 formats, one story.', 2.5], ['Ideas into motion.', 2.5]], { size: { ...C, width: 960, height: 540 } });
  const scene = await openScene(timeline);
  try { for (const shot of await scene.check()) assert.ok(shot.pass, JSON.stringify(shot)); } finally { await scene.close(); }
});
