/**
 * Pacing follows the brand's mood (docs/LAUNCH-STYLE-BUILD-PLAN.md, Phase 1b).
 *
 * The director found a calm skincare segment cut at 120 BPM rushed; the same
 * segment at 96 BPM fit the brand. So the mood sets the tempo range, how many
 * beats each idea gets, and the motion targets QA holds the film to. Copy also
 * gets a minimum reading time, whatever the tempo.
 */
import { MOODS, chooseMood } from '../audio/fold-score.mjs';

// Beats per idea relative to an energetic film; motion targets from the plan (M1, M2).
const PACING = Object.freeze({
  energetic: { beatsPerIdea: 1, calm: false },
  editorial: { beatsPerIdea: 1.2, calm: false },
  premium: { beatsPerIdea: 1.5, calm: true },
  warm: { beatsPerIdea: 1.5, calm: true },
});
const TARGETS = Object.freeze({
  energetic: Object.freeze({ maxStillShare: 0.25, minMotionEnergy: 2.3, maxStillSeconds: 0.5 }),
  calm: Object.freeze({ maxStillShare: 0.35, minMotionEnergy: 2.0, maxStillSeconds: 1.2 }),
});

// Product, wellness and luxury briefs lean calm unless the brief asks for energy.
const CALM_PRODUCT = /\b(skin\s?care|skincare|serum|balm|cleanser|moisturi[sz]er|spa|bath|wellness|self-care|beauty|fragrance|perfume|candle|aromatherapy|relax|unwind|sleep|tea|jewel(?:le)?ry|luxury)\b/i;

/** The pacing for a mood: its tempo range, beats per idea, and QA motion targets. */
export function pacingForMood(mood) {
  const style = MOODS[mood];
  const pacing = PACING[mood];
  if (!style || !pacing) throw new Error(`Unknown mood "${mood}". Use one of: ${Object.keys(PACING).join(', ')}.`);
  return Object.freeze({
    mood,
    label: style.label,
    bpmRange: style.bpm,
    beatsPerIdea: pacing.beatsPerIdea,
    calm: pacing.calm,
    targets: pacing.calm ? TARGETS.calm : TARGETS.energetic,
  });
}

/**
 * The mood for a brief: FOLD Score's own keyword choice, except that product and
 * wellness briefs lean calm when nothing in them asks for energy.
 */
export function moodForBrief(text = '') {
  const chosen = chooseMood(text);
  if (chosen === 'energetic') return chosen;
  if (CALM_PRODUCT.test(String(text)) && (chosen === 'premium' || chosen === 'editorial')) return 'premium';
  return chosen;
}

/** Seconds a viewer needs to read a piece of copy: 0.3 s plus 0.06 s per visible character. */
export function readingSeconds(text = '') {
  const visible = String(text).replace(/\s+/g, '').length;
  return visible === 0 ? 0 : 0.3 + 0.06 * visible;
}

/** The fewest beats (to the nearest `resolution`) that give the copy its reading time at this tempo. */
export function minimumBeats(text, bpm, { resolution = 0.5 } = {}) {
  const seconds = readingSeconds(text);
  if (seconds === 0) return 0;
  const beats = seconds / (60 / bpm);
  return Math.ceil(beats / resolution - 1e-9) * resolution;
}

/** Beats a scene gets at this pacing, never fewer than its copy needs to be read. */
export function sceneBeats(baseBeats, pacing, copy = '', bpm = (pacing.bpmRange[0] + pacing.bpmRange[1]) / 2) {
  const scaled = Math.round(baseBeats * pacing.beatsPerIdea * 2) / 2;
  return Math.max(scaled, minimumBeats(copy, bpm));
}
