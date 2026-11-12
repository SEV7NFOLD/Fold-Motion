import assert from 'node:assert/strict';
import test from 'node:test';
import { MOODS } from '../src/audio/fold-score.mjs';
import { beatFrame, beatGrid, chooseBeatTempo, framesPerBeat, measureBeatSync, quantizeFrame } from '../src/production/beat-clock.mjs';
import { minimumBeats, moodForBrief, pacingForMood, readingSeconds, sceneBeats } from '../src/production/pacing.mjs';
import { splitIntoBeats } from '../src/production/beats.mjs';

// ---------- beat clock
test('tempo comes from the mood and prefers beats that land on whole frames', () => {
  assert.equal(chooseBeatTempo('energetic', 30), 120);            // exactly 15 frames
  assert.equal(chooseBeatTempo('premium', 30), 90);               // exactly 20 frames
  assert.equal(framesPerBeat(120, 30), 15);
  for (const mood of Object.keys(MOODS)) {
    for (const fps of [24, 25, 30, 60]) {
      const bpm = chooseBeatTempo(mood, fps);
      const [low, high] = MOODS[mood].bpm;
      assert.ok(bpm >= low && bpm <= high, `${mood}@${fps}: ${bpm} outside ${low}-${high}`);
      const whole = Array.from({ length: high - low + 1 }, (_, k) => low + k).some((c) => Number.isInteger((60 * fps) / c));
      if (whole) assert.ok(Number.isInteger(framesPerBeat(bpm, fps)), `${mood}@${fps} should pick a whole-frame beat`);
    }
  }
  assert.equal(chooseBeatTempo('premium', 30, { bpm: 96 }), 96, 'an explicit tempo wins');
  assert.throws(() => chooseBeatTempo('sleepy', 30), /Unknown mood/);
});

test('the beat grid places every beat and half-beat on a frame inside the film', () => {
  const grid = beatGrid({ bpm: 96, fps: 30, durationInSeconds: 10 });
  assert.equal(grid.framesPerBeat, 18.75);
  assert.deepEqual(grid.beats.slice(0, 5), [0, 19, 38, 56, 75]);  // round(k × 18.75)
  assert.ok(grid.beats.every((f) => f >= 0 && f < grid.totalFrames));
  assert.equal(grid.halfBeats[1], Math.round(18.75 / 2), 'half-beats sit between beats');
  assert.ok(grid.beats.every((f) => grid.halfBeats.includes(f)), 'every beat is also a half-beat point');
  assert.equal(beatFrame(grid, 2.5), Math.round(2.5 * 18.75));
});

test('quantizing snaps to the nearest grid point and beat sync reports the drifters', () => {
  const grid = beatGrid({ bpm: 120, fps: 30, durationInSeconds: 15 });
  assert.equal(quantizeFrame(grid, 16), 15);
  assert.equal(quantizeFrame(grid, 22), 23);                    // the half-beat at 22.5 rounds to frame 23
  assert.equal(quantizeFrame(grid, 29, { division: 1 }), 30);
  assert.equal(quantizeFrame(grid, 10_000), grid.totalFrames - 1);
  const sync = measureBeatSync(grid, [15, 30, 31, 49, 60]);
  assert.equal(sync.checked, 5);
  assert.deepEqual(sync.offenders.map((o) => o.frame), [49]);   // half-beats every 7.5 frames: 49 is 4 off
  assert.equal(sync.pass, false);
  assert.equal(measureBeatSync(grid, [0, 15, 23, 45]).pass, true);
});

// ---------- pacing
test('pacing follows the mood: calm brands get more beats per idea and looser motion targets', () => {
  const calm = pacingForMood('premium'); const energetic = pacingForMood('energetic');
  assert.equal(calm.calm, true); assert.equal(energetic.calm, false);
  assert.ok(calm.beatsPerIdea > energetic.beatsPerIdea);
  assert.ok(calm.targets.maxStillShare > energetic.targets.maxStillShare);
  assert.deepEqual(calm.bpmRange, MOODS.premium.bpm);
  assert.throws(() => pacingForMood('sleepy'), /Unknown mood/);
});

test('product and wellness briefs lean calm unless they ask for energy', () => {
  assert.equal(moodForBrief('Aromatherapy bath oil. Relax & unwind.'), 'premium');
  assert.equal(moodForBrief('A precise skincare serum, engineered with data'), 'premium');
  assert.equal(moodForBrief('Launch party drop, bold and loud'), 'energetic');
  assert.equal(moodForBrief('A bold, energetic skincare drop'), 'energetic');
  assert.equal(moodForBrief('Handmade candles for the home'), 'warm');
  assert.equal(moodForBrief('A developer tool for data teams'), 'editorial');
});

test('copy always gets its reading time, whatever the tempo', () => {
  assert.equal(readingSeconds(''), 0);
  assert.ok(Math.abs(readingSeconds('Relax & unwind.') - (0.3 + 0.06 * 13)) < 1e-9);
  assert.equal(minimumBeats('frankincense', 96), 2);              // 1.02 s at 0.625 s a beat
  assert.equal(minimumBeats('Every word, exactly as approved.', 120), 4);
  const calm = pacingForMood('premium');
  assert.equal(sceneBeats(4, calm), 6);
  assert.equal(sceneBeats(1, calm, 'With papaya fruit enzymes', 90), minimumBeats('With papaya fruit enzymes', 90));
});

// ---------- copy into beats
const split = (copy, protect) => splitIntoBeats(copy, { protect }).map((b) => b.text);

test('copy splits into short beats at natural places', () => {
  const cases = [
    ['Turn a brief into a film.', ['Turn a brief', 'into a film.']],
    ['Every word, exactly as approved.', ['Every word,', 'exactly as approved.']],
    ['A sneaker drop built for night runs. Available Friday.', ['A sneaker drop built', 'for night runs.', 'Available Friday.']],
    ['With neroli, mandarin, frankincense & lavender.', ['With neroli, mandarin,', 'frankincense & lavender.']],
    ['Relax & unwind.', ['Relax & unwind.']],
    ['Save 50% off this weekend only.', ['Save 50% off', 'this weekend only.']],
    ['Only $49 until Dec 12.', ['Only $49', 'until Dec 12.']],
    ['Meet Volt Runner, built for night runs.', ['Meet Volt Runner,', 'built for night runs.']],
    ['Cleansing balm with papaya fruit enzymes for all skin types.', ['Cleansing balm', 'with papaya fruit enzymes', 'for all skin types.']],
  ];
  for (const [copy, expected] of cases) assert.deepEqual(split(copy), expected, copy);
});

test('names, prices, units and dates never split, and protected phrases hold', () => {
  const beats = split('Introducing the new amaranthine cleansing balm today', ['amaranthine cleansing balm']);
  assert.ok(beats.some((b) => b.includes('amaranthine cleansing balm')), beats.join(' | '));
  for (const [copy, whole] of [['Get 15 seconds of film for $9 a month', '15 seconds'], ['Doors open 12 December at 7 pm', '12 December'], ['Built by the Google Workspace team', 'Google Workspace']]) {
    assert.ok(split(copy).some((b) => b.includes(whole)), `${copy}: ${split(copy).join(' | ')}`);
  }
});

test('beats always add back up to the exact copy, never end on a small word, and break at sentence ends', () => {
  const words = ['launch', 'the', 'new', 'film', 'with', 'Volt', 'Runner', 'a', '$49', 'off', '50%', 'today,', 'fast.', 'and', 'every', 'brief', 'in', 'Dec', '12', 'motion!', 'your', 'brand', 'ideas', 'to', 'beautiful'];
  let seed = 7; const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
  for (let run = 0; run < 400; run += 1) {
    const count = 1 + Math.floor(rand() * 14);
    // like real copy, never three small words in a row (then a beat can always avoid ending on one)
    const small = new Set(['the', 'with', 'a', 'and', 'every', 'in', 'your', 'to', 'off']);
    const picked = [];
    while (picked.length < count) {
      const w = words[Math.floor(rand() * words.length)];
      if (small.has(w) && picked.length >= 2 && small.has(picked[picked.length - 1]) && small.has(picked[picked.length - 2])) continue;
      picked.push(w);
    }
    if (small.has(picked[picked.length - 1])) picked.push('film');
    const copy = picked.join(rand() < 0.2 ? '  ' : ' ') + (rand() < 0.5 ? '.' : '');
    const beats = splitIntoBeats(copy);
    assert.equal(beats.map((b) => b.raw).join(''), copy, 'concatenation');
    beats.forEach((b, i) => {
      const toks = b.text.split(/\s+/);
      if (i < beats.length - 1) {
        assert.ok(!['a', 'the', 'with', 'and', 'in', 'to', 'your', 'every'].includes(toks[toks.length - 1].toLowerCase()), `ends on a small word: "${b.text}" in "${copy}"`);
      }
      toks.slice(0, -1).forEach((t) => assert.ok(!/[.!?]$/.test(t), `sentence end inside a beat: "${b.text}"`));
    });
  }
  assert.deepEqual(splitIntoBeats(''), []);
  assert.deepEqual(splitIntoBeats('  Hello  ').map((b) => b.raw), ['  Hello  ']);
});
