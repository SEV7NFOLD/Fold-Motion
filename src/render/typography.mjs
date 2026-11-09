/**
 * Typography for the v2 engine: the bundled fonts and exact text measurement.
 *
 * Widths come from assets/fonts/metrics.json (glyph advance widths read from the
 * font files), so layouts are computed, not guessed: text always fits its box and
 * decorations never land on top of letters.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const metricsUrl = new URL('../../assets/fonts/metrics.json', import.meta.url);
const METRICS = JSON.parse(readFileSync(metricsUrl, 'utf8'));

/** Font roles the recipes use. `display` is Anton; the rest are Montserrat weights. */
export const FONTS = Object.freeze({
  display: Object.freeze({ family: 'Anton', weight: 400 }),
  bold: Object.freeze({ family: 'Montserrat', weight: 700 }),
  semibold: Object.freeze({ family: 'Montserrat', weight: 600 }),
  medium: Object.freeze({ family: 'Montserrat', weight: 500 }),
});

export const FONT_FILES = Object.freeze(
  Object.keys(FONTS).map((key) => fileURLToPath(new URL(`../../assets/fonts/${METRICS[key].file}`, import.meta.url))),
);

// Uploaded brand fonts, registered from their measured metrics (see
// public/font-metrics.mjs) under an id derived from those metrics.
const BRAND_FONTS = new Map();

/** A stable id for a brand font's metrics ("brand-" + a short hash). */
export function brandFontId(metrics) {
  const source = `${metrics.family}|${metrics.weight}|${Object.entries(metrics.advance).slice(0, 64).map(([c, w]) => `${c}${w}`).join('')}`;
  let hash = 2166136261;
  for (const character of source) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  return `brand-${(hash >>> 0).toString(36)}`;
}

/** Registers a brand font's metrics; returns the font id recipes and the renderer use. */
export function registerBrandFont(metrics) {
  const id = brandFontId(metrics);
  if (!BRAND_FONTS.has(id)) BRAND_FONTS.set(id, { ...metrics });
  return id;
}

/** Family and weight for a font id (built-in role or registered brand font). */
export function fontFace(font) {
  const metrics = METRICS[font] && font !== '_note' ? METRICS[font] : BRAND_FONTS.get(font);
  return metrics ? { family: metrics.family, weight: metrics.weight } : undefined;
}

export function fontMetrics(font) {
  const metrics = (font !== '_note' && METRICS[font]) || BRAND_FONTS.get(font);
  if (!metrics) throw new Error(`Unknown font role "${font}".`);
  return metrics;
}

export function advance(font, character) {
  const metrics = fontMetrics(font);
  return metrics.advance[character] ?? metrics.fallbackAdvance;
}

/** Width in pixels of `text` at `size`, with `tracking` in em added between characters. */
export function measure(font, text, size, tracking = 0) {
  const characters = [...String(text)];
  if (characters.length === 0) return 0;
  const glyphs = characters.reduce((sum, character) => sum + advance(font, character), 0);
  return (glyphs + tracking * (characters.length - 1)) * size;
}

/** The largest size between `minSize` and `maxSize` at which `text` fits `maxWidth`. */
export function fitSize(font, text, maxWidth, maxSize, minSize, tracking = 0) {
  const unit = measure(font, text, 1, tracking);
  if (unit <= 0) return maxSize;
  return Math.max(minSize, Math.min(maxSize, maxWidth / unit));
}

/** Greedy word wrap to `maxWidth`. A single word wider than the box stays on its own line. */
export function wrap(font, text, size, maxWidth, tracking = 0) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || measure(font, candidate, size, tracking) <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Fits text into at most `maxLines` lines inside `maxWidth`, as large as allowed.
 * Returns the chosen size and lines. Tries one line first, then balanced wraps.
 */
export function fitBlock(font, text, { maxWidth, maxSize, minSize, maxLines = 2, tracking = 0 }) {
  const single = fitSize(font, text, maxWidth, maxSize, minSize, tracking);
  if (measure(font, text, single, tracking) <= maxWidth + 0.5 || maxLines === 1) {
    return { size: single, lines: [String(text).trim()] };
  }
  // Shrink until the wrap uses at most maxLines lines, preferring larger sizes.
  for (let size = maxSize; size >= minSize; size -= 1) {
    const lines = wrap(font, text, size, maxWidth, tracking);
    if (lines.length <= maxLines && lines.every((line) => measure(font, line, size, tracking) <= maxWidth + 0.5)) {
      return { size, lines };
    }
  }
  const lines = wrap(font, text, minSize, maxWidth, tracking);
  return { size: minSize, lines };
}

/** Positions of each character for a line starting at `x`, for per-letter animation. */
export function layoutCharacters(font, text, size, tracking, x) {
  const out = [];
  let cursor = x;
  for (const character of String(text)) {
    out.push({ character, x: cursor });
    cursor += (advance(font, character) + tracking) * size;
  }
  return out;
}

/** Positions of each word for a line starting at `x`, for per-word animation. */
export function layoutWords(font, text, size, tracking, x) {
  const out = [];
  let cursor = x;
  const space = (advance(font, ' ') + tracking) * size;
  for (const word of String(text).split(' ')) {
    const width = measure(font, word, size, tracking);
    out.push({ word, x: cursor, width });
    cursor += width + space + tracking * size;
  }
  return out;
}

export function capHeight(font, size) {
  return fontMetrics(font).capHeight * size;
}
