/**
 * Shot recipes for the v2 engine.
 *
 * Gemini directs: it picks a recipe per shot, writes a short kicker line, chooses a
 * word to emphasize, and picks atmosphere, camera and transition. The recipe designs:
 * it lays the copy out with exact font measurements and choreographs every element,
 * so text always fits and nothing collides. Output elements carry their own reveal
 * timing; the renderer (src/render/frame-v2.mjs) animates them deterministically.
 */
import { capHeight, fitBlock, measure } from '../render/typography.mjs';
import { ensureContrast, MIN_TEXT_CONTRAST, mix, readableTextColor } from './color.mjs';

export const RECIPE_OPTIONS = Object.freeze(['title-reveal', 'statement', 'kicker-title', 'type-stack', 'lockup']);
export const TRANSITION_OPTIONS = Object.freeze(['cut', 'wipe', 'fade', 'push', 'fold']);
export const TEXT_CASE_OPTIONS = Object.freeze(['upper', 'as-written']);

export const RECIPE_DESCRIPTIONS = Object.freeze({
  'title-reveal': 'the line set huge in the condensed display face, words rising out of masks one after another while the letter spacing tightens, a hairline drawing out underneath and an optional kicker below; the hero shot',
  statement: 'the line in a bold sans, letters cascading in one by one, with an optional kicker above and supporting line below; for a clear message',
  'kicker-title': 'an opening card: a small tracked kicker appears first, then the line rises into place under a beam of light; for quiet openings',
  'type-stack': 'each word stacked on its own line, every line scaled to the same width and sliding in from alternating sides; energetic, for two to four short words',
  lockup: 'an end card: the line, a hairline, and the kicker set as a brand name in the display face, with light passing across; for the final shot',
});

export const TRANSITION_DESCRIPTIONS = Object.freeze({
  cut: 'a hard cut',
  wipe: 'an accent-colored panel wipes across with a lighter stripe riding its edge',
  fade: 'fades through the background color',
  push: 'the camera pushes through the frame into the next shot',
  fold: "FOLD Motion's signature: the frame folds in half like paper, revealing the next shot, then the folded half folds away; at most twice per film, for the most important change of scene",
});

/** The Fold is a signature, not a habit: at most this many per film. */
export const MAX_FOLDS = 2;

const KICKER_MAX = 32;

function timeScale(duration) {
  return Math.min(1.15, Math.max(0.6, duration / 3));
}

/** Text and decoration colors that read on this background and pass creative QA. */
export function recipePalette(primary, accent) {
  const text = readableTextColor(primary);
  const muted = ensureContrast(mix(text, primary, 0.38), primary, MIN_TEXT_CONTRAST);
  const emphasisFrom = ensureContrast(mix(accent, text, 0.45), primary, MIN_TEXT_CONTRAST);
  const emphasisTo = ensureContrast(accent, primary, MIN_TEXT_CONTRAST);
  return { text, muted, accent, emphasis: { from: emphasisFrom, to: emphasisTo } };
}

function display(text, textCase) {
  return textCase === 'upper' ? String(text).toUpperCase() : String(text);
}

function emphasisWords(display, emphasis) {
  if (!emphasis) return [];
  const target = new Set(String(emphasis).toLowerCase().split(/\s+/).filter(Boolean));
  const words = display.split(/\s+/);
  return words
    .map((word, index) => (target.has(word.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, '')) ? index : -1))
    .filter((index) => index >= 0);
}

function textElement({ id, role, content, shown, font, size, tracking = 0, lines, lineHeight, lineSizes, x, y, anchor = 'middle', fill, reveal, settle, sweep, emphasis }) {
  return {
    id,
    type: 'text',
    role,
    content,
    shown,
    font,
    fontSize: Math.round(size * 100) / 100,
    tracking,
    lines,
    lineHeight,
    ...(lineSizes ? { lineSizes } : {}),
    x,
    y,
    anchor,
    fill,
    reveal,
    ...(settle ? { settle } : {}),
    ...(sweep ? { sweep } : {}),
    ...(emphasis && emphasis.words.length ? { emphasis } : {}),
  };
}

function hairline({ id, x, y, width, accent, start, duration, from = 'center', thickness = 1.5 }) {
  return { id, type: 'line', x, y, width, height: thickness, fill: accent, reveal: { style: 'grow', from, start, duration } };
}

function kickerElement({ id, kicker, x, y, height, palette, start, anchor = 'middle' }) {
  const size = Math.max(16, height * 0.022);
  const shown = String(kicker).toUpperCase();
  return textElement({
    id, role: 'kicker', content: kicker, shown, font: 'semibold', size, tracking: 0.42,
    lines: [shown], lineHeight: size * 1.3, x, y, anchor, fill: palette.muted,
    reveal: { style: 'cascade', unit: 'letter', start, duration: 0.45, stagger: Math.min(0.02, 0.6 / Math.max(1, shown.length)) },
  });
}

function blockBaseline(centerY, size, lineCount, lineHeight, font) {
  const cap = capHeight(font, size);
  const total = cap + (lineCount - 1) * lineHeight;
  return centerY - total / 2 + cap;
}

/**
 * Expands a v2 shot spec into renderable elements.
 * `spec`: { recipe, textCase, kicker, emphasis, sweep, durationInSeconds }
 * `context`: { width, height, primaryColor, accentColor }
 * `support`: optional supporting line (the subheadline on the final shot).
 */
export function expandRecipe(spec, { copy, context, shotIndex = 0, support = '' }) {
  const W = context.width;
  const H = context.height;
  const palette = recipePalette(context.primaryColor, context.accentColor);
  const k = timeScale(spec.durationInSeconds);
  const n = shotIndex + 1;
  const displayRecipe = ['title-reveal', 'kicker-title', 'type-stack'].includes(spec.recipe);
  const textCase = TEXT_CASE_OPTIONS.includes(spec.textCase) ? spec.textCase : (displayRecipe ? 'upper' : 'as-written');
  const kicker = typeof spec.kicker === 'string' && spec.kicker.trim() ? spec.kicker.trim().slice(0, KICKER_MAX) : '';
  const elements = [{ id: `shot-${n}-background`, type: 'rect', x: 0, y: 0, width: W, height: H, fill: context.primaryColor }];
  const sweepAt = (start) => (spec.sweep ? { start: start * k, duration: 0.9 } : undefined);
  const emphasisFor = (shown) => ({ words: emphasisWords(shown, spec.emphasis), from: palette.emphasis.from, to: palette.emphasis.to });

  switch (spec.recipe) {
    case 'title-reveal': {
      const shown = display(copy, textCase);
      // Size for the widest moment: the line starts with open tracking and tightens.
      const settleFrom = 0.06;
      const block = fitBlock('display', shown, { maxWidth: W * 0.84, maxSize: H * 0.21, minSize: H * 0.075, maxLines: 2, tracking: settleFrom });
      const lineHeight = block.size * 1.02;
      const y = blockBaseline(H * 0.47, block.size, block.lines.length, lineHeight, 'display');
      const lastBaseline = y + (block.lines.length - 1) * lineHeight;
      const words = shown.split(/\s+/).length;
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: 'display', size: block.size, tracking: 0.012,
        lines: block.lines, lineHeight, x: W / 2, y, fill: palette.text,
        reveal: { style: 'mask-rise', unit: 'word', start: 0.15 * k, duration: 0.8 * k, stagger: Math.min(0.16, 0.9 / Math.max(1, words)) * k },
        settle: { from: settleFrom, start: 0.15 * k, duration: 1.4 * k },
        sweep: sweepAt(1.5),
        emphasis: emphasisFor(shown),
      }));
      const widest = Math.max(...block.lines.map((line) => measure('display', line, block.size, 0.012)));
      const lineY = lastBaseline + H * 0.06;
      elements.push(hairline({ id: `shot-${n}-accent`, x: W / 2, y: lineY, width: Math.min(W * 0.32, widest * 0.5), accent: palette.accent, start: 0.75 * k, duration: 0.7 * k }));
      if (kicker) elements.push(kickerElement({ id: `shot-${n}-kicker`, kicker, x: W / 2, y: lineY + H * 0.058, height: H, palette, start: 1.2 * k }));
      break;
    }
    case 'statement': {
      const shown = display(copy, textCase);
      const block = fitBlock('bold', shown, { maxWidth: W * 0.8, maxSize: H * 0.105, minSize: H * 0.05, maxLines: 2, tracking: -0.015 });
      const lineHeight = block.size * 1.18;
      const y = blockBaseline(H * 0.5, block.size, block.lines.length, lineHeight, 'bold');
      const lastBaseline = y + (block.lines.length - 1) * lineHeight;
      const letters = [...shown].filter((character) => character !== ' ').length;
      const start = kicker ? 0.4 * k : 0.2 * k;
      if (kicker) elements.push(kickerElement({ id: `shot-${n}-kicker`, kicker, x: W / 2, y: y - capHeight('bold', block.size) - H * 0.07, height: H, palette, start: 0.05 * k }));
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: 'bold', size: block.size, tracking: -0.015,
        lines: block.lines, lineHeight, x: W / 2, y, fill: palette.text,
        reveal: { style: 'cascade', unit: 'letter', start, duration: 0.55 * k, stagger: Math.min(0.03, (0.9 * k) / Math.max(1, letters)) },
        sweep: sweepAt(1.6),
        emphasis: emphasisFor(shown),
      }));
      const lineY = lastBaseline + H * 0.05;
      elements.push(hairline({ id: `shot-${n}-accent`, x: W / 2, y: lineY, width: W * 0.08, accent: palette.accent, start: 0.8 * k, duration: 0.5 * k }));
      if (support) {
        const size = Math.max(16, H * 0.032);
        elements.push(textElement({
          id: `shot-${n}-support`, role: 'support', content: support, shown: support, font: 'medium', size,
          lines: fitBlock('medium', support, { maxWidth: W * 0.7, maxSize: size, minSize: 16, maxLines: 2 }).lines,
          lineHeight: size * 1.35, x: W / 2, y: lineY + H * 0.065, fill: palette.muted,
          reveal: { style: 'fade', unit: 'line', start: 1.0 * k, duration: 0.6 * k },
        }));
      }
      break;
    }
    case 'kicker-title': {
      const shown = display(copy, textCase);
      const block = fitBlock('display', shown, { maxWidth: W * 0.7, maxSize: H * 0.15, minSize: H * 0.07, maxLines: 2, tracking: 0.03 });
      const lineHeight = block.size * 1.04;
      const y = blockBaseline(H * 0.52, block.size, block.lines.length, lineHeight, 'display');
      const lastBaseline = y + (block.lines.length - 1) * lineHeight;
      if (kicker) elements.push(kickerElement({ id: `shot-${n}-kicker`, kicker, x: W / 2, y: y - capHeight('display', block.size) - H * 0.075, height: H, palette, start: 0.35 * k }));
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: 'display', size: block.size, tracking: 0.03,
        lines: block.lines, lineHeight, x: W / 2, y, fill: palette.text,
        reveal: { style: 'mask-rise', unit: 'line', start: 0.75 * k, duration: 0.9 * k, stagger: 0.12 * k },
        sweep: sweepAt(1.7),
        emphasis: emphasisFor(shown),
      }));
      elements.push(hairline({ id: `shot-${n}-accent`, x: W / 2, y: lastBaseline + H * 0.065, width: W * 0.22, accent: palette.accent, start: 1.15 * k, duration: 0.7 * k }));
      break;
    }
    case 'type-stack': {
      const shown = display(copy, textCase);
      const words = shown.split(/\s+/).filter(Boolean);
      // Group words into at most three lines with similar widths.
      const lineCount = Math.min(3, words.length);
      const lines = [];
      const per = Math.ceil(words.length / lineCount);
      for (let index = 0; index < words.length; index += per) lines.push(words.slice(index, index + per).join(' '));
      const targetWidth = W * 0.6;
      const lineSizes = lines.map((line) => Math.max(H * 0.08, Math.min(H * 0.25, targetWidth / measure('display', line, 1, 0.01))));
      const gap = H * 0.025;
      const caps = lineSizes.map((size) => capHeight('display', size));
      const total = caps.reduce((sum, cap) => sum + cap, 0) + gap * (lines.length - 1);
      const y = H * 0.5 - total / 2 + caps[0];
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: 'display', size: Math.min(...lineSizes), tracking: 0.01,
        lines, lineHeight: gap, lineSizes, x: W / 2, y, fill: palette.text,
        reveal: { style: 'slide', unit: 'line', start: 0.1 * k, duration: 0.7 * k, stagger: 0.14 * k },
        sweep: sweepAt(1.4),
        emphasis: emphasisFor(shown),
      }));
      elements.push(hairline({ id: `shot-${n}-accent`, x: W / 2 - targetWidth / 2, y: y - caps[0] + total + H * 0.05, width: targetWidth * 0.3, accent: palette.accent, start: 0.9 * k, duration: 0.6 * k, from: 'left' }));
      break;
    }
    case 'lockup':
    default: {
      const shown = display(copy, textCase);
      const block = fitBlock('bold', shown, { maxWidth: W * 0.72, maxSize: H * 0.09, minSize: H * 0.045, maxLines: 2, tracking: -0.015 });
      const lineHeight = block.size * 1.18;
      const y = blockBaseline(H * 0.43, block.size, block.lines.length, lineHeight, 'bold');
      const lastBaseline = y + (block.lines.length - 1) * lineHeight;
      const letters = [...shown].filter((character) => character !== ' ').length;
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: 'bold', size: block.size, tracking: -0.015,
        lines: block.lines, lineHeight, x: W / 2, y, fill: palette.text,
        reveal: { style: 'cascade', unit: 'letter', start: 0.2 * k, duration: 0.55 * k, stagger: Math.min(0.03, (0.8 * k) / Math.max(1, letters)) },
        sweep: spec.sweep === false ? undefined : { start: 1.6 * k, duration: 0.9 },
        emphasis: emphasisFor(shown),
      }));
      const lineY = lastBaseline + H * 0.06;
      elements.push(hairline({ id: `shot-${n}-accent`, x: W / 2, y: lineY, width: W * 0.12, accent: palette.accent, start: 0.75 * k, duration: 0.6 * k }));
      let nextY = lineY + H * 0.1;
      if (kicker) {
        const shownKicker = kicker.toUpperCase();
        const size = fitBlock('display', shownKicker, { maxWidth: W * 0.6, maxSize: H * 0.07, minSize: H * 0.04, maxLines: 1, tracking: 0.04 }).size;
        elements.push(textElement({
          id: `shot-${n}-kicker`, role: 'kicker', content: kicker, shown: shownKicker, font: 'display', size, tracking: 0.04,
          lines: [shownKicker], lineHeight: size, x: W / 2, y: nextY, fill: palette.text,
          reveal: { style: 'mask-rise', unit: 'line', start: 1.0 * k, duration: 0.7 * k, stagger: 0 },
        }));
        nextY += H * 0.06;
      }
      if (support) {
        const size = Math.max(16, H * 0.028);
        elements.push(textElement({
          id: `shot-${n}-support`, role: 'support', content: support, shown: support, font: 'medium', size,
          lines: fitBlock('medium', support, { maxWidth: W * 0.7, maxSize: size, minSize: 16, maxLines: 2 }).lines,
          lineHeight: size * 1.35, x: W / 2, y: nextY, fill: palette.muted,
          reveal: { style: 'fade', unit: 'line', start: 1.2 * k, duration: 0.6 * k },
        }));
      }
      break;
    }
  }
  return elements;
}

/** Recipes with a slot for a supporting line (needed when the subheadline must appear). */
export const RECIPES_WITH_SUPPORT = Object.freeze(['statement', 'lockup']);

/** Deterministic recipe for a shot position, used when the model gives none. */
export function recipeForPosition(index, count) {
  if (count <= 1) return 'title-reveal';
  if (index === 0) return 'title-reveal';
  if (index === count - 1) return 'lockup';
  return 'statement';
}

const RECIPE_ALIASES = Object.freeze({
  title: 'title-reveal', hero: 'title-reveal', headline: 'title-reveal', reveal: 'title-reveal', 'big-title': 'title-reveal',
  message: 'statement', sentence: 'statement', line: 'statement', body: 'statement',
  opening: 'kicker-title', intro: 'kicker-title', opener: 'kicker-title', kicker: 'kicker-title',
  stack: 'type-stack', stacked: 'type-stack', 'word-stack': 'type-stack',
  end: 'lockup', 'end-card': 'lockup', endcard: 'lockup', outro: 'lockup', closing: 'lockup', logo: 'lockup',
});
const TRANSITION_ALIASES = Object.freeze({
  'hard-cut': 'cut', none: 'cut', straight: 'cut',
  crossfade: 'fade', dissolve: 'fade', 'fade-through': 'fade', 'dip-to-black': 'fade',
  slide: 'wipe', swipe: 'wipe', 'wipe-left': 'wipe', 'wipe-right': 'wipe', panel: 'wipe',
  zoom: 'push', 'zoom-through': 'push', 'push-in': 'push', 'push-through': 'push',
  'paper-fold': 'fold', 'the-fold': 'fold', origami: 'fold', crease: 'fold', 'fold-over': 'fold', 'page-fold': 'fold',
});

function slug(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s_]+/g, '-') : '';
}

function hashSeed(text) {
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

const DIRECTIONS = Object.freeze([
  { openers: ['kicker-title', 'title-reveal'], middle: 'title-reveal', transitions: ['fold', 'push', 'fade'], beam: true },
  { openers: ['type-stack', 'title-reveal'], middle: 'statement', transitions: ['fold', 'push', 'push'], beam: false },
  { openers: ['title-reveal', 'title-reveal'], middle: 'statement', transitions: ['fold', 'wipe', 'fade'], beam: true },
  { openers: ['type-stack', 'title-reveal'], middle: 'title-reveal', transitions: ['wipe', 'wipe', 'push'], beam: false },
]);

/**
 * Deterministic direction for the offline fallback and for gaps in model output:
 * recipe, transition, beam and sweep, seeded so different storyboards differ.
 * Never invents copy (no kicker); emphasis only reuses a word already in the line.
 */
export function fallbackDirection(seed, index, count, copy) {
  const direction = DIRECTIONS[hashSeed(seed) % DIRECTIONS.length];
  const words = String(copy).trim().split(/\s+/).filter(Boolean);
  let recipe;
  if (count > 1 && index === count - 1) recipe = 'lockup';
  else if (index === 0) recipe = direction.openers[0] === 'type-stack' && (words.length < 2 || words.length > 4) ? 'title-reveal' : direction.openers[0];
  else recipe = direction.middle;
  if (recipe === 'kicker-title') recipe = 'title-reveal';
  return {
    recipe,
    transitionOut: index === count - 1 ? 'cut' : direction.transitions[index % direction.transitions.length],
    beam: index === 0 && direction.beam,
    sweep: index === count - 1 || recipe === 'title-reveal',
    emphasis: words.length >= 3 ? words.at(-1).replace(/[^\p{L}\p{N}'-]/gu, '') : '',
  };
}

/**
 * Cleans the model's direction for one shot. Returns the v2 fields and a list of
 * what changed. The copy itself never comes from here: it is the storyboard's.
 */
export function normalizeDirection(raw, { copy, index, count, seed }) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const changes = [];
  const fallback = fallbackDirection(seed, index, count, copy);
  const words = String(copy).trim().split(/\s+/).filter(Boolean);

  let recipe = slug(source.recipe);
  if (!RECIPE_OPTIONS.includes(recipe)) {
    const mapped = RECIPE_ALIASES[recipe];
    if (mapped) changes.push(`recipe "${source.recipe}" treated as "${mapped}"`);
    else changes.push(source.recipe ? `unknown recipe "${source.recipe}" replaced with "${fallback.recipe}"` : `no recipe chosen; used "${fallback.recipe}"`);
    recipe = mapped || fallback.recipe;
  }
  if (recipe === 'type-stack' && (words.length < 2 || words.length > 4)) {
    changes.push(`type-stack needs two to four words; used "title-reveal" for ${words.length}`);
    recipe = 'title-reveal';
  }

  const textCase = TEXT_CASE_OPTIONS.includes(slug(source.textCase)) ? slug(source.textCase) : undefined;

  let kicker = typeof source.kicker === 'string' ? source.kicker.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim() : '';
  if (kicker) {
    // A kicker must add something: drop it when it repeats the line or a part of it.
    const tokens = (text) => String(text).toLowerCase().split(/\s+/).map((word) => word.replace(/[^\p{L}\p{N}'-]/gu, '')).filter(Boolean);
    const lineWords = new Set(tokens(copy));
    const kickerWords = tokens(kicker);
    const shared = kickerWords.filter((word) => lineWords.has(word)).length;
    if (kicker.toLowerCase().includes(String(copy).toLowerCase()) || String(copy).toLowerCase().includes(kicker.toLowerCase()) || (kickerWords.length && shared / kickerWords.length >= 0.6)) {
      changes.push(`kicker "${kicker}" repeated the on-screen copy; removed`);
      kicker = '';
    }
  }
  if ([...kicker].length > KICKER_MAX) {
    const cut = kicker.slice(0, KICKER_MAX + 1).replace(/\s+\S*$/, '').trim();
    changes.push(`kicker shortened to "${cut}"`);
    kicker = cut;
  }

  let emphasis = typeof source.emphasis === 'string' ? source.emphasis.trim() : '';
  if (emphasis) {
    const available = new Set(words.map((word) => word.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, '')));
    const wanted = emphasis.toLowerCase().split(/\s+/).map((word) => word.replace(/[^\p{L}\p{N}'-]/gu, '')).filter(Boolean);
    const limit = words.length <= 1 ? 1 : Math.max(1, Math.floor(words.length / 2));
    if (wanted.length === 0 || !wanted.every((word) => available.has(word))) {
      changes.push(`emphasis "${emphasis}" is not a word in the line; removed`);
      emphasis = '';
    } else if (wanted.length > Math.min(3, limit)) {
      // Emphasis that covers most of the line emphasizes nothing.
      changes.push(`emphasis "${emphasis}" covered too much of the line; removed`);
      emphasis = '';
    }
  }

  let transitionOut = slug(source.transitionOut);
  if (index === count - 1) {
    transitionOut = 'cut';
  } else if (!TRANSITION_OPTIONS.includes(transitionOut)) {
    const mapped = TRANSITION_ALIASES[transitionOut];
    if (mapped || source.transitionOut) changes.push(mapped ? `transition "${source.transitionOut}" treated as "${mapped}"` : `unknown transition "${source.transitionOut}" replaced with "${fallback.transitionOut}"`);
    transitionOut = mapped || fallback.transitionOut;
  }

  const flag = (value, fallbackValue) => (typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : fallbackValue);
  return {
    direction: {
      recipe,
      ...(textCase ? { textCase } : {}),
      kicker,
      emphasis,
      transitionOut,
      beam: flag(source.beam, false),
      sweep: flag(source.sweep, fallback.sweep),
    },
    changes,
  };
}

/**
 * Keeps The Fold special: after MAX_FOLDS folds in a film, further folds become
 * wipes. Returns the list of changes made (specs are edited in place).
 */
export function limitFolds(specs, labels = []) {
  const changes = [];
  let folds = 0;
  specs.forEach((spec, index) => {
    if (spec?.version !== 2 || spec.transitionOut !== 'fold') return;
    folds += 1;
    if (folds > MAX_FOLDS) {
      spec.transitionOut = 'wipe';
      changes.push(`${labels[index] || `shot ${index + 1}`}: more than ${MAX_FOLDS} folds in the film; this one became a wipe.`);
    }
  });
  return changes;
}
