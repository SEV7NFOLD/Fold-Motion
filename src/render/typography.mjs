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
/**
 * Two wrapped lines rebalanced so neither is a lonely word: the break that makes
 * the longer line shortest wins. Three or more lines stay as wrapped.
 */
export function balance(font, lines, size, maxWidth, tracking = 0) {
  if (lines.length !== 2) return lines;
  const words = lines.join(' ').split(/\s+/);
  let best = lines;
  let bestWidth = Math.max(...lines.map((line) => measure(font, line, size, tracking)));
  for (let cut = 1; cut < words.length; cut += 1) {
    const pair = [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
    const width = Math.max(...pair.map((line) => measure(font, line, size, tracking)));
    if (width < bestWidth - 0.5 && width <= maxWidth + 0.5) { best = pair; bestWidth = width; }
  }
  return best;
}

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
export function fitBlock(font, text, { maxWidth, maxSize, minSize, maxLines = 2, tracking = 0, maxHeight, lineHeight = 1.05 }) {
  // An optional height budget: wrapped lines may only grow as tall as the space allows.
  if (maxHeight) maxLines = Math.max(1, Math.min(maxLines, Math.floor(maxHeight / (minSize * lineHeight))));
  const tallest = (lines) => (maxHeight ? maxHeight / (lines * lineHeight) : Infinity);
  const single = fitSize(font, text, maxWidth, maxSize, minSize, tracking);
  const fitsOne = measure(font, text, single, tracking) <= maxWidth + 0.5;
  // One line is kept when it's (nearly) full size; a line that had to shrink a lot
  // is compared with a wrapped layout, and the bigger type wins (by at least 15%).
  if (maxLines === 1 || (fitsOne && single >= maxSize * 0.85)) {
    return { size: single, lines: [String(text).trim()] };
  }
  for (let size = maxSize; size >= minSize; size -= 1) {
    if (fitsOne && size <= single * 1.15) break;
    const lines = balance(font, wrap(font, text, size, maxWidth, tracking), size, maxWidth, tracking);
    if (size > tallest(lines.length)) continue;
    if (lines.length >= 2 && lines.length <= maxLines && lines.every((line) => measure(font, line, size, tracking) <= maxWidth + 0.5)) {
      return { size, lines };
    }
  }
  if (fitsOne) return { size: single, lines: [String(text).trim()] };
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
