/**
 * The music skill book as data (see skills/fold-motion/references/music.md):
 * each mood's band, the patterns its parts play, their levels, and what happens
 * on cuts, transitions and the end card. Harmony (key, chords, resolve) comes
 * from MOODS in fold-score.mjs, so both engines agree.
 */
export const BOOK = Object.freeze({
  premium: {
    pad: [{ instrument: 'cellos', voices: 'low', gain: 0.5 }, { instrument: 'violins', voices: 'high', gain: 0.36 }],
    keys: { instrument: 'piano', pattern: 'broken', step: 1, velocity: [0.3, 0.48], gain: 0.62 },
    bass: { instrument: 'bass', pattern: 'held', gain: 0.42 },
    sparkle: { instrument: 'glock', cues: ['letter', 'word', 'glint'], gain: 0.2, perSecond: 2 },
    run: { instrument: 'harp', gain: 0.42 },
    hits: { cut: { name: 'timpani', gain: 0.3 }, swell: { name: 'cymbal-swell', gain: 0.3 }, endcard: [{ name: 'timpani', gain: 0.42 }, { name: 'triangle', gain: 0.28 }] },
    rhythm: [],
  },
  energetic: {
    pad: [{ instrument: 'violins', voices: 'high', gain: 0.24 }],
    keys: { instrument: 'marimba', pattern: 'ostinato', step: 0.5, velocity: [0.55, 0.8], gain: 0.5 },
    bass: { instrument: 'pizz', pattern: 'eighths', gain: 0.62 },
    sparkle: { instrument: 'glock', cues: ['letter', 'glint'], gain: 0.16, perSecond: 2 },
    run: { instrument: 'harp', gain: 0.3 },
    hits: { cut: { name: 'crash', gain: 0.2 }, swell: { name: 'cymbal-swell', gain: 0.32 }, endcard: [{ name: 'crash', gain: 0.32 }, { name: 'timpani', gain: 0.45 }] },
    rhythm: [{ hit: 'clap', beats: [1, 3], gain: 0.34 }, { hit: 'shaker', every: 0.5, gain: 0.16 }],
  },
  editorial: {
    pad: [{ instrument: 'cellos', voices: 'low', gain: 0.38 }],
    keys: { instrument: 'harp', pattern: 'pulse', step: 0.5, velocity: [0.4, 0.6], gain: 0.46 },
    lead: { instrument: 'piano', pattern: 'top', step: 2, velocity: [0.32, 0.45], gain: 0.4 },
    bass: { instrument: 'pizz', pattern: 'downbeats', gain: 0.55 },
    sparkle: { instrument: 'glock', cues: ['letter', 'word'], gain: 0.16, perSecond: 1.5 },
    run: { instrument: 'harp', gain: 0.32 },
    hits: { cut: { name: 'timpani', gain: 0.24 }, swell: { name: 'cymbal-swell', gain: 0.26 }, endcard: [{ name: 'triangle', gain: 0.3 }] },
    rhythm: [{ hit: 'shaker', every: 0.25, gain: 0.09 }],
  },
  warm: {
    pad: [{ instrument: 'cellos', voices: 'low', gain: 0.45 }, { instrument: 'violins', voices: 'high', gain: 0.22 }],
    keys: { instrument: 'piano', pattern: 'broken', step: 0.5, velocity: [0.24, 0.38], gain: 0.55 },
    bass: { instrument: 'bass', pattern: 'held', gain: 0.38 },
    sparkle: { instrument: 'glock', cues: ['word'], gain: 0.14, perSecond: 1 },
    run: { instrument: 'harp', gain: 0.4 },
    hits: { swell: { name: 'cymbal-swell', gain: 0.22 }, endcard: [{ name: 'triangle', gain: 0.3 }] },
    rhythm: [{ hit: 'shaker', offbeats: true, gain: 0.11 }],
  },
});

/** Transitions a harp run rises into and a cymbal swell crests on. */
export const RUN_INTO = Object.freeze(['fold-a', 'wipe', 'push', 'fade']);
