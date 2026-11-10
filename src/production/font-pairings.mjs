/**
 * Font pairings: each film gets a display face, a body face and an accent face
 * for kickers, all SIL Open Font License fonts bundled in assets/fonts/pairings.
 * The style kit picks a pairing; words in the brief ("serif", "monospace",
 * "handwritten", "condensed", "rounded") override it; the studio's Fonts picker
 * overrides both; an uploaded brand font always takes the display role.
 */
import { STYLE_OPTIONS } from './style-kits.mjs';

export const PAIRINGS = Object.freeze({
  classic: {
    label: 'Anton + Montserrat', display: 'display', bold: 'bold', semibold: 'semibold', medium: 'medium',
    kicker: { font: 'semibold', upper: true, tracking: 0.42, scale: 1 },
  },
  editorial: {
    label: 'Playfair + Montserrat', display: 'playfair-bold', bold: 'bold', semibold: 'semibold', medium: 'medium',
    kicker: { font: 'playfair-italic', upper: false, tracking: 0.02, scale: 1.45 },
  },
  modern: {
    label: 'Space Grotesk + Inter', display: 'spacegrotesk-bold', bold: 'inter-bold', semibold: 'inter-semibold', medium: 'inter-medium',
    kicker: { font: 'spacemono-bold', upper: true, tracking: 0.14, scale: 1.05 },
  },
  friendly: {
    label: 'Fredoka + Nunito', display: 'fredoka-semibold', bold: 'nunito-bold', semibold: 'nunito-semibold', medium: 'nunito-medium',
    kicker: { font: 'caveat-bold', upper: false, tracking: 0, scale: 1.9 },
  },
  condensed: {
    label: 'Bebas Neue + Archivo', display: 'bebas', bold: 'archivo-bold', semibold: 'archivo-semibold', medium: 'archivo-medium',
    kicker: { font: 'archivoblack', upper: true, tracking: 0.18, scale: 1.05 },
  },
  soft: {
    label: 'Fraunces + DM Sans', display: 'fraunces-semibold', bold: 'dmsans-bold', semibold: 'dmsans-semibold', medium: 'dmsans-medium',
    kicker: { font: 'fraunces-italic', upper: false, tracking: 0.01, scale: 1.45 },
  },
});

export const PAIRING_OPTIONS = Object.freeze(Object.keys(PAIRINGS));

/** The style kit's pairing. */
export const STYLE_FONTS = Object.freeze({
  'editorial-luxury': 'editorial',
  'tech-ui': 'modern',
  'playful-dtc': 'friendly',
  'bold-street': 'condensed',
  'warm-craft': 'soft',
});

// Words in the brief that ask for a kind of type.
const FONT_WORDS = [
  [/\bsoft serif\b|\bwarm serif\b/i, 'soft'],
  [/(?<!sans[- ])\bserif\b/i, 'editorial'],
  [/\bmono(?:space|spaced)?\b|\bcode font\b|\btypewriter\b/i, 'modern'],
  [/\bhandwritten\b|\bhand-?lettered\b|\bscript font\b|\brounded\b/i, 'friendly'],
  [/\bcondensed\b|\btall narrow\b/i, 'condensed'],
];

/** A pairing from words in the brief, or undefined. */
export function pairingFromWords(text = '') {
  for (const [pattern, key] of FONT_WORDS) if (pattern.test(String(text))) return key;
  return undefined;
}

/** The film's pairing: the studio's pick, else the brief's words, else the style kit's. */
export function resolvePairing(storyboard = {}, context = {}) {
  if (PAIRING_OPTIONS.includes(context.fonts)) return context.fonts;
  const words = [storyboard.title, storyboard.narrativeConcept, storyboard.creativeDirection, ...(storyboard.shots || []).flatMap((shot) => [shot.briefNotes, shot.mainVisual])].filter(Boolean).join(' ');
  const asked = pairingFromWords(words);
  if (asked) return asked;
  const style = STYLE_OPTIONS.includes(context.style) ? context.style : storyboard.style;
  return STYLE_FONTS[style] || 'classic';
}

/** The pairing for a planning context (classic when none is set). */
export function pairingFor(context = {}) {
  return PAIRINGS[context.fonts] || PAIRINGS.classic;
}
