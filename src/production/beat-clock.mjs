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
