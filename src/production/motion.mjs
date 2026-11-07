/**
 * FOLD Motion's motion vocabulary: the per-shot choices Gemini can make and the
 * renderer animates. One source of truth for the renderer, validation, repair,
 * the Gemini schema, prompts, docs and the studio preview.
 *
 * Every option is a pure function of shot progress, so renders stay
 * deterministic: the same spec always produces the same frames.
 */

export const MOTION_OPTIONS = Object.freeze({
  camera: Object.freeze(['static', 'push-in', 'pull-out', 'drift-left', 'drift-right']),
  entrance: Object.freeze(['rise-glitch', 'fade', 'slide-up', 'slide-left', 'scale-in', 'type-on', 'wipe']),
  atmosphere: Object.freeze(['orbit', 'spotlight', 'grid', 'lines', 'clean', 'planes', 'dots']),
});

/** The look every shot had before the vocabulary existed. */
export const DEFAULT_MOTION = Object.freeze({ camera: 'static', entrance: 'rise-glitch', atmosphere: 'orbit' });

export const MOTION_DESCRIPTIONS = Object.freeze({
  camera: Object.freeze({
    static: 'locked off',
    'push-in': 'a slow push toward the copy, scaling up 8% over the shot',
    'pull-out': 'a slow pull back that settles at full frame',
    'drift-left': 'a gentle sideways drift to the left',
    'drift-right': 'a gentle sideways drift to the right',
  }),
  entrance: Object.freeze({
    'rise-glitch': 'copy rises in with a short RGB glitch, energetic and digital',
    fade: 'copy fades up softly with no movement, calm and premium',
    'slide-up': 'copy slides up from below as it fades in',
    'slide-left': 'copy slides in from the right',
    'scale-in': 'copy grows from slightly smaller into place',
    'type-on': 'copy types on character by character, suits tech and editorial',
    wipe: 'copy is revealed by a left-to-right wipe',
  }),
  atmosphere: Object.freeze({
    orbit: 'accent glow, two drifting rings, a faint grid and two accent lines',
    spotlight: 'a soft pool of accent light behind the copy, nothing else',
    grid: 'a faint accent grid with a gentle glow',
    lines: 'only the two accent lines low on the left',
    clean: 'the bare brand background',
    planes: 'large folded triangles drifting at different speeds for depth, with a low glow',
    dots: 'a field of dots that a ripple of light spreads across, then twinkles',
  }),
});

const ALIASES = Object.freeze({
  camera: Object.freeze({
    locked: 'static', 'locked-off': 'static', none: 'static', still: 'static',
    'zoom-in': 'push-in', push: 'push-in', 'dolly-in': 'push-in',
    'zoom-out': 'pull-out', pull: 'pull-out', 'dolly-out': 'pull-out',
    'pan-left': 'drift-left', 'truck-left': 'drift-left',
    'pan-right': 'drift-right', 'truck-right': 'drift-right', drift: 'drift-right',
  }),
  entrance: Object.freeze({
    glitch: 'rise-glitch', default: 'rise-glitch',
    'fade-in': 'fade', dissolve: 'fade',
    'slide-in': 'slide-left', 'slide-right': 'slide-left',
    'slide-in-up': 'slide-up', rise: 'slide-up',
    scale: 'scale-in', 'zoom-in': 'scale-in', pop: 'scale-in',
    typewriter: 'type-on', type: 'type-on', typing: 'type-on',
    reveal: 'wipe', 'wipe-in': 'wipe',
  }),
  atmosphere: Object.freeze({
    default: 'orbit', rings: 'orbit', full: 'orbit',
    spot: 'spotlight', glow: 'spotlight',
    'grid-only': 'grid',
    line: 'lines', minimal: 'lines',
    none: 'clean', plain: 'clean', bare: 'clean',
    triangles: 'planes', depth: 'planes', parallax: 'planes', shapes: 'planes',
    dot: 'dots', 'dot-field': 'dots', particles: 'dots', ripple: 'dots',
  }),
});

/**
 * Returns a complete, valid motion object and a list of what was changed.
 * Missing fields take the default; aliases map to their option; anything else
 * falls back to the default.
 */
export function normalizeMotion(motion) {
  const source = motion && typeof motion === 'object' && !Array.isArray(motion) ? motion : {};
  const result = {};
  const changes = [];
  for (const [field, options] of Object.entries(MOTION_OPTIONS)) {
    const raw = typeof source[field] === 'string' ? source[field].trim().toLowerCase().replace(/[\s_]+/g, '-') : '';
    if (!raw) {
      result[field] = DEFAULT_MOTION[field];
    } else if (options.includes(raw)) {
      result[field] = raw;
    } else if (ALIASES[field][raw]) {
      result[field] = ALIASES[field][raw];
      changes.push(`${field} "${source[field]}" treated as "${result[field]}"`);
    } else {
      result[field] = DEFAULT_MOTION[field];
      changes.push(`unknown ${field} "${source[field]}" replaced with "${result[field]}"`);
    }
  }
  return { motion: result, changes };
}

export function isValidMotion(motion) {
  if (motion === undefined) return true;
  if (!motion || typeof motion !== 'object' || Array.isArray(motion)) return false;
  return Object.entries(MOTION_OPTIONS).every(([field, options]) => motion[field] === undefined || options.includes(motion[field]));
}

function hash(text) {
  let value = 2166136261;
  for (const character of String(text)) {
    value ^= character.codePointAt(0);
    value = Math.imul(value, 16777619) >>> 0;
  }
  // Final avalanche so similar seeds spread across all buckets.
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
}

// Coherent film "families" for the offline fallback: one atmosphere per film,
// entrances and camera moves that vary shot to shot but belong together.
const FAMILIES = Object.freeze([
  { atmosphere: 'spotlight', entrances: ['fade', 'scale-in', 'fade'], cameras: ['push-in', 'static', 'pull-out'] },
  { atmosphere: 'grid', entrances: ['type-on', 'wipe', 'type-on'], cameras: ['static', 'drift-left', 'static'] },
  { atmosphere: 'lines', entrances: ['slide-left', 'slide-up', 'fade'], cameras: ['drift-right', 'static', 'push-in'] },
  { atmosphere: 'planes', entrances: ['rise-glitch', 'scale-in', 'rise-glitch'], cameras: ['drift-right', 'push-in', 'pull-out'] },
  { atmosphere: 'dots', entrances: ['wipe', 'fade', 'slide-up'], cameras: ['pull-out', 'drift-left', 'static'] },
]);

/**
 * Deterministic motion for the offline fallback: the same storyboard always gets
 * the same choices, but different storyboards get different films.
 */
export function fallbackMotion(seed, shotIndex) {
  const family = FAMILIES[hash(seed) % FAMILIES.length];
  return {
    camera: family.cameras[shotIndex % family.cameras.length],
    entrance: family.entrances[shotIndex % family.entrances.length],
    atmosphere: family.atmosphere,
  };
}
