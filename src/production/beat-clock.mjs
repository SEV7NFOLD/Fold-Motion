/**
 * Beat clock for the launch style: the music's tempo comes first, and cuts and
 * word entrances snap to its grid (the reverse of FOLD Score's chooseTempo,
 * which fits a tempo to cuts that already exist).
 *
 * Beat k sits on frame round(k × framesPerBeat). Within a mood's tempo range we
 * prefer tempos whose beat is a whole number of frames (120 BPM at 30 fps is
 * exactly 15 frames), so every beat lands on a real frame without rounding.
 */
import { MOODS } from '../audio/fold-score.mjs';

/** Frames in one beat; fractional when the tempo doesn't divide the frame rate. */
export function framesPerBeat(bpm, fps) {
  if (!(bpm > 0) || !(fps > 0)) throw new Error('framesPerBeat needs a positive tempo and frame rate.');
  return (60 * fps) / bpm;
}

/**
 * The tempo for a film: an explicit bpm when it's valid, otherwise the tempo in
 * the mood's range whose beat is closest to a whole number of frames, breaking
 * ties toward the middle of the range.
 */
export function chooseBeatTempo(mood, fps, { bpm } = {}) {
  if (Number.isFinite(bpm) && bpm >= 40 && bpm <= 220) return Math.round(bpm * 100) / 100;
  const range = MOODS[mood]?.bpm;
  if (!range) throw new Error(`Unknown mood "${mood}". Use one of: ${Object.keys(MOODS).join(', ')}.`);
  const [low, high] = range;
  const middle = (low + high) / 2;
  let best = null;
  for (let candidate = low; candidate <= high; candidate += 1) {
    const fpb = framesPerBeat(candidate, fps);
    const score = Math.abs(fpb - Math.round(fpb)) * 10 + Math.abs(candidate - middle) / (high - low || 1);
    if (!best || score < best.score - 1e-9) best = { bpm: candidate, score };
  }
  return best.bpm;
}

/** The grid for a film: every beat and half-beat as a frame number. */
export function beatGrid({ bpm, fps, durationInSeconds }) {
  const fpb = framesPerBeat(bpm, fps);
  const totalFrames = Math.round(durationInSeconds * fps);
  const count = Math.floor((totalFrames - 1) / fpb);
  const beats = Array.from({ length: count + 1 }, (_, k) => Math.round(k * fpb));
  const halfBeats = Array.from({ length: Math.floor((totalFrames - 1) / (fpb / 2)) + 1 }, (_, k) => Math.round((k * fpb) / 2));
  return Object.freeze({ bpm, fps, framesPerBeat: fpb, totalFrames, beats, halfBeats });
}

/** The frame of a (possibly fractional) beat: beatFrame(grid, 2.5) is halfway between beats 2 and 3. */
export function beatFrame(grid, beat) {
  return Math.round(beat * grid.framesPerBeat);
}

/** Snap a frame to the nearest grid point, `division` points per beat (2 = half-beats). */
export function quantizeFrame(grid, frame, { division = 2 } = {}) {
  const step = grid.framesPerBeat / division;
  return Math.min(grid.totalFrames - 1, Math.max(0, Math.round(Math.round(frame / step) * step)));
}

/**
 * Beat-sync QA: how many event frames sit within `toleranceFrames` of the grid.
 * Returns the offenders so a report can say exactly which events drifted.
 */
export function measureBeatSync(grid, frames, { toleranceFrames = 1, division = 2 } = {}) {
  const offenders = [];
  for (const frame of frames) {
    const nearest = quantizeFrame(grid, frame, { division });
    const error = Math.abs(frame - nearest);
    if (error > toleranceFrames) offenders.push({ frame, nearest, error });
  }
  return { checked: frames.length, onGrid: frames.length - offenders.length, offenders, pass: offenders.length === 0 };
}

/**
 * Shot lengths (in frames) whose cuts land on beats, keeping the total exactly.
 * Each cut moves to the nearest beat that keeps every shot at least `minFrames`
 * long; a cut with no such beat nearby stays where it was.
 */
export function alignDurations(frames, grid, { minFrames = 1 } = {}) {
  const total = frames.reduce((sum, f) => sum + f, 0);
  const cuts = []; let at = 0;
  for (let i = 0; i < frames.length - 1; i += 1) { at += frames[i]; cuts.push(at); }
  const aligned = [];
  let previous = 0;
  cuts.forEach((cut, i) => {
    const remainingShots = frames.length - 1 - i;
    const latest = total - remainingShots * minFrames;   // leave room for the shots after this one
    const candidates = [quantizeFrame(grid, cut, { division: 1 }), Math.floor(cut / grid.framesPerBeat) * grid.framesPerBeat, Math.ceil(cut / grid.framesPerBeat) * grid.framesPerBeat]
      .map(Math.round)
      .filter((c) => c - previous >= minFrames && c <= latest)
      .sort((a, b) => Math.abs(a - cut) - Math.abs(b - cut));
    const chosen = candidates.length ? candidates[0] : Math.min(Math.max(cut, previous + minFrames), latest);
    aligned.push(chosen); previous = chosen;
  });
  const bounds = [0, ...aligned, total];
  return bounds.slice(1).map((b, i) => b - bounds[i]);
}

/** The frames a beat-sync check measures: every cut, and every element's reveal start. */
export function timelineBeatEvents(timeline) {
  const events = [];
  timeline.shots.forEach((shot, index) => {
    if (index > 0) events.push(shot.startFrame);
    for (const element of shot.spec?.elements || []) {
      const start = element.reveal?.start;
      if (Number.isFinite(start)) events.push(Math.round(shot.startFrame + start * timeline.fps));
    }
  });
  return events;
}

/**
 * Snaps every element's reveal start to the nearest half-beat inside its shot,
 * stepping back a grid point when the reveal would otherwise run past the cut.
 * Mutates the timeline's element specs; returns how many reveals moved.
 */
export function snapReveals(timeline, grid) {
  let moved = 0;
  const step = grid.framesPerBeat / 2;
  for (const shot of timeline.shots) {
    for (const element of shot.spec?.elements || []) {
      const reveal = element.reveal;
      if (!reveal || !Number.isFinite(reveal.start)) continue;
      const absolute = shot.startFrame + reveal.start * timeline.fps;
      const length = Number.isFinite(reveal.duration) ? reveal.duration * timeline.fps : 0;
      let snapped = quantizeFrame(grid, absolute, { division: 2 });
      while (snapped + length > shot.endFrame + 1 && snapped - step >= shot.startFrame) snapped = Math.round(snapped - step);
      if (snapped < shot.startFrame) snapped = Math.round(Math.ceil(shot.startFrame / step) * step);
      if (snapped > shot.endFrame) continue;
      const start = (snapped - shot.startFrame) / timeline.fps;
      if (Math.abs(start - reveal.start) > 1e-9) { element.reveal = { ...reveal, start }; moved += 1; }
    }
  }
  return moved;
}
