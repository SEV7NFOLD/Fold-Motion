/**
 * Shot recipes for the v2 engine.
 *
 * Gemini directs: it picks a recipe per shot, writes a short kicker line, chooses a
 * word to emphasize, and picks atmosphere, camera and transition. The recipe designs:
 * it lays the copy out with exact font measurements and choreographs every element,
 * so text always fits and nothing collides. Output elements carry their own reveal
 * timing; the renderer (src/render/frame-v2.mjs) animates them deterministically.
 */
import { capHeight, fitBlock, measure, registerBrandFont } from '../render/typography.mjs';
import { contrastRatio, ensureContrast, MIN_TEXT_CONTRAST, mix, readableTextColor } from './color.mjs';
import { BADGE_SHAPES, EMOJI_NAMES, ICON_NAMES, SIGN_NAMES } from '../../public/graphics-library.mjs';

export const RECIPE_OPTIONS = Object.freeze(['title-reveal', 'statement', 'kicker-title', 'type-stack', 'lockup', 'logo-reveal', 'product-hero', 'type-window', 'stat', 'quote', 'product-grid', 'split', 'word-beat']);

/** How a headline moves in, and how its emphasized words are treated. */
export const TEXT_MOTIONS = Object.freeze(['rise', 'slam', 'drop', 'split']);

/** Graphics that support the type, placed relative to the headline. */
export const GRAPHIC_PLACES = Object.freeze(['above', 'below', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right']);
const GRAPHIC_NAMES = { icon: ICON_NAMES, emoji: EMOJI_NAMES, sign: SIGN_NAMES, badge: BADGE_SHAPES };
// Badge words that make no claim; anything else must come from the shot's own copy.
const NEUTRAL_BADGE_WORDS = ['NEW', 'NEW IN', 'OUT NOW', 'JUST LANDED', 'SHOP NOW'];

/**
 * A direction's graphics, checked: at most two, known names only, and badge words
 * taken from the shot's copy (or a neutral word), so a film never invents an offer.
 */
export function normalizeGraphics(graphics, copy = '') {
  if (!Array.isArray(graphics)) return [];
  const words = String(copy).toUpperCase();
  return graphics.flatMap((item) => {
    const kind = String(item?.kind || '').toLowerCase();
    const name = String(item?.name || '').toLowerCase();
    if (!GRAPHIC_NAMES[kind]?.includes(name)) return [];
    const place = GRAPHIC_PLACES.includes(item?.place) ? item.place : 'top-right';
    const text = String(item?.text || '').toUpperCase().trim().slice(0, 14);
    if (kind === 'badge' && (!text || (!NEUTRAL_BADGE_WORDS.includes(text) && !words.includes(text)))) return [];
    if (kind === 'sign' && name === 'index' && !/^\d{1,2}$/.test(text)) return [{ kind, name, place, text: '01' }];
    return [{ kind, name, place, ...(text && ['badge', 'sign'].includes(kind) ? { text } : {}) }];
  }).slice(0, 2);
}

/** Places a shot's graphics around its headline, sized from the type and kept in frame. */
export function applyGraphics(elements, spec, context = {}) {
  const graphics = normalizeGraphics(spec.graphics, spec.copy || elements.find((element) => element.role === 'title')?.content);
  const title = elements.find((element) => element.type === 'text' && element.role === 'title');
  if (!graphics.length || !title || !context.width || !context.height) return elements;
  const W = context.width;
  const H = context.height;
  const unit = Math.min(W, H);
  const sizes = title.lines.map((_, i) => title.lineSizes?.[i] ?? title.fontSize);
  const widths = title.lines.map((line, i) => measure(title.font, line, sizes[i], title.tracking || 0));
  const lefts = widths.map((width) => (title.anchor === 'start' ? title.x : title.anchor === 'end' ? title.x - width : title.x - width / 2));
  const top = title.y - capHeight(title.font, sizes[0]);
  const bottom = title.y + (title.lines.length - 1) * (title.lineHeight || sizes[0]);
  const box = { left: Math.min(...lefts), right: Math.max(...lefts.map((left, i) => left + widths[i])), top, bottom };
  const cap = capHeight(title.font, sizes[0]);
  const ink = readableTextColor(context.primaryColor);
  const color = mix(context.accentColor, ink, 0.2);
  const reveal = title.reveal || { start: 0, duration: 0.6 };
  const landed = (reveal.start || 0) + (reveal.duration || 0.6) + (reveal.stagger || 0) * Math.min(6, title.lines.join(' ').split(/\s+/).length);
  graphics.forEach((graphic, index) => {
    const size = graphic.kind === 'badge' ? unit * (graphic.name === 'seal' ? 0.16 : 0.085) : Math.min(unit * 0.16, Math.max(unit * 0.06, cap * 1.1));
    const gap = unit * 0.03;
    const midX = (box.left + box.right) / 2;
    const midY = (box.top + box.bottom) / 2;
    const at = {
      above: [midX, box.top - gap - size / 2], below: [midX, box.bottom + gap * 2 + size / 2],
      left: [box.left - gap - size / 2, midY], right: [box.right + gap + size / 2, midY],
      'top-left': [box.left - size * 0.15, box.top - size * 0.35], 'top-right': [box.right + size * 0.15, box.top - size * 0.35],
      'bottom-left': [box.left - size * 0.15, box.bottom + size * 0.35], 'bottom-right': [box.right + size * 0.15, box.bottom + size * 0.35],
    }[graphic.place];
    // Kept inside the frame with a margin, whatever the layout.
    const half = graphic.kind === 'badge' && graphic.name !== 'seal' ? size * 2.2 : size / 2;
    const margin = unit * 0.03;
    const x = Math.min(W - margin - half, Math.max(margin + half, at[0]));
    const y = Math.min(H - margin - size / 2, Math.max(margin + size / 2, at[1]));
    const element = { id: `${title.id}-graphic-${index + 1}`, type: 'graphic', kind: graphic.kind, name: graphic.name, x, y, size, color, reveal: { start: landed + 0.1 + index * 0.18, duration: 0.5 }, ...(graphic.text ? { text: graphic.text } : {}) };
    if (graphic.kind === 'badge') {
      const badgeInk = readableTextColor(context.accentColor);
      if (contrastRatio(badgeInk, context.accentColor) < MIN_TEXT_CONTRAST) return;
      element.paint = context.accentColor;
      element.ink = badgeInk;
    }
    elements.push(element);
  });
  return elements;
}
export const EMPHASIS_STYLES = Object.freeze(['gradient', 'outline', 'highlight', 'pill']);

/** Recipes that put an uploaded product photo on screen. */
export const PRODUCT_RECIPES = Object.freeze(['product-hero', 'type-window', 'product-grid', 'split']);

/** The first number in a line ("98%", "3x", "$1,299"), for the stat recipe. */
export const STAT_NUMBER = /\d[\d,]*(?:\.\d+)?/;
export const TRANSITION_OPTIONS = Object.freeze(['cut', 'wipe', 'fade', 'push', 'fold', 'zoom']);

/** Headline effects a direction can ask for. */
export const TYPE_EFFECTS = Object.freeze(['decode', 'outline']);
export const TEXT_CASE_OPTIONS = Object.freeze(['upper', 'as-written']);

export const RECIPE_DESCRIPTIONS = Object.freeze({
  'title-reveal': 'the line set huge in the condensed display face, words rising out of masks one after another while the letter spacing tightens, a hairline drawing out underneath and an optional kicker below; the hero shot',
  statement: 'the line in a bold sans, letters cascading in one by one, with an optional kicker above and supporting line below; for a clear message',
  'kicker-title': 'an opening card: a small tracked kicker appears first, then the line rises into place under a beam of light; for quiet openings',
  'type-stack': 'each word stacked on its own line, every line scaled to the same width and sliding in from alternating sides; energetic, for two to four short words',
  lockup: 'an end card: the line, a hairline, and the kicker set as a brand name in the display face, with light passing across (the uploaded logo, if any, sits above the line); for the final shot',
  'logo-reveal': 'the uploaded logo as the hero: it draws itself on and fills (an SVG) or wipes in (a PNG), a glint crosses it, and the line sits small beneath; only when a logo is uploaded',
  'product-hero': 'an uploaded product photo, graded into the brand palette, emerges from darkness as a feathered panel on one side with a slow push-in and a pass of light, while the line rises huge in the display face on the other side; only when product photos are uploaded',
  'type-window': 'giant display letters filled with an uploaded product photo, landing one by one; for one or two short words; only when product photos are uploaded',
  stat: 'a number in the line counts up from zero, huge in the display face, with the rest of the line beneath ("98% recycled", "3x faster", "$49"); only when the line contains a number',
  quote: 'a testimonial or striking quote: a large quotation mark, the line in a calm weight word by word, and the kicker beneath as the attribution ("Vogue", "A customer")',
  'product-grid': 'two to four uploaded product photos in a grid, each emerging in turn, with the line beneath; "product" is the first photo; only with two or more photos',
  split: 'a split screen: an uploaded product photo fills one half edge to edge, the line sits on the other half beside an accent divider; only when product photos are uploaded',
  'word-beat': 'kinetic poster: each word of a two- to five-word line fills the frame in turn, punching in on the beat, then the words resolve into the line',
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
  return Math.min(1.6, Math.max(0.6, duration / 3));
}

/** Long shots shouldn't sit still: their line gets a light sweep in the back half. */
const LONG_SHOT_SECONDS = 3.5;

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

function kickerElement({ id, kicker, x, y, height, palette, start, anchor = 'middle', maxWidth = Infinity }) {
  const shown = String(kicker).toUpperCase();
  // Wide tracking first; a long kicker tightens, then shrinks, to fit the frame.
  let size = Math.max(16, height * 0.022);
  let tracking = 0.42;
  const width = () => measure('semibold', shown, size) + tracking * size * Math.max(0, shown.length - 1);
  if (width() > maxWidth) tracking = 0.2;
  if (width() > maxWidth) size = Math.max(12, size * (maxWidth / width()));
  return textElement({
    id, role: 'kicker', content: kicker, shown, font: 'semibold', size, tracking,
    lines: [shown], lineHeight: size * 1.3, x, y, anchor, fill: palette.muted,
    reveal: { style: 'cascade', unit: 'letter', start, duration: 0.45, stagger: Math.min(0.02, 0.6 / Math.max(1, shown.length)) },
  });
}

/** A logo element fitted inside maxWidth x maxHeight, centered on (cx, cy). */
function logoElement({ id, meta, cx, cy, maxWidth, maxHeight, start, duration, glintAt }) {
  const scale = Math.min(maxWidth / meta.width, maxHeight / meta.height);
  return {
    id,
    type: 'logo',
    kind: meta.kind,
    x: cx,
    y: cy,
    width: Math.round(meta.width * scale * 100) / 100,
    height: Math.round(meta.height * scale * 100) / 100,
    reveal: { style: meta.kind === 'svg' ? 'draw' : 'wipe', start, duration },
    glint: { start: glintAt, duration: 0.8 },
  };
}

/** The product photo a shot uses: { index (1-based), meta } or undefined. */
function productFor(spec, context) {
  const products = context.products || [];
  if (!products.length) return undefined;
  const index = Number.isInteger(spec.product) && spec.product >= 1 && spec.product <= products.length ? spec.product : 1;
  return { index, meta: products[index - 1] };
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
export function expandRecipe(spec, { copy, context, shotIndex = 0, support = '', productOrdinal }) {
  // An uploaded brand font takes the display face's place in every recipe.
  const DISPLAY = context.brandFont ? registerBrandFont(context.brandFont) : 'display';
  const W = context.width;
  const H = context.height;
  const palette = recipePalette(context.primaryColor, context.accentColor);
  const k = timeScale(spec.durationInSeconds);
  const n = shotIndex + 1;
  const displayRecipe = ['title-reveal', 'kicker-title', 'type-stack', 'product-hero', 'type-window'].includes(spec.recipe);
  const textCase = TEXT_CASE_OPTIONS.includes(spec.textCase) ? spec.textCase : (displayRecipe ? 'upper' : 'as-written');
  const kicker = typeof spec.kicker === 'string' && spec.kicker.trim()
    ? (spec.kickerExact ? spec.kicker.trim() : spec.kicker.trim().slice(0, KICKER_MAX)) : '';
  const elements = [{ id: `shot-${n}-background`, type: 'rect', x: 0, y: 0, width: W, height: H, fill: context.primaryColor }];
  const sweepAt = (start) => (spec.sweep ? { start: start * k, duration: 0.9 } : undefined);
  const emphasisFor = (shown) => ({ words: emphasisWords(shown, spec.emphasis), from: palette.emphasis.from, to: palette.emphasis.to });

  switch (spec.recipe) {
    case 'title-reveal': {
      const shown = display(copy, textCase);
      // Size for the widest moment: the line starts with open tracking and tightens.
      const settleFrom = 0.06;
      const block = fitBlock(DISPLAY, shown, { maxWidth: W * 0.84, maxSize: H * 0.21, minSize: H * 0.075, maxLines: 2, tracking: settleFrom });
      const lineHeight = block.size * 1.02;
      const y = blockBaseline(H * 0.47, block.size, block.lines.length, lineHeight, DISPLAY);
      const lastBaseline = y + (block.lines.length - 1) * lineHeight;
      const words = shown.split(/\s+/).length;
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: DISPLAY, size: block.size, tracking: 0.012,
        lines: block.lines, lineHeight, x: W / 2, y, fill: palette.text,
        reveal: { style: 'mask-rise', unit: 'word', start: 0.15 * k, duration: 0.8 * k, stagger: Math.min(0.16, 0.9 / Math.max(1, words)) * k },
        settle: { from: settleFrom, start: 0.15 * k, duration: 1.4 * k },
        sweep: sweepAt(1.5),
        emphasis: emphasisFor(shown),
      }));
      const widest = Math.max(...block.lines.map((line) => measure(DISPLAY, line, block.size, 0.012)));
      const lineY = lastBaseline + H * 0.06;
      elements.push(hairline({ id: `shot-${n}-accent`, x: W / 2, y: lineY, width: Math.min(W * 0.32, widest * 0.5), accent: palette.accent, start: 0.75 * k, duration: 0.7 * k }));
      if (kicker) elements.push(kickerElement({ id: `shot-${n}-kicker`, kicker, x: W / 2, y: lineY + H * 0.058, height: H, maxWidth: W * 0.88, palette, start: 1.2 * k }));
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
      if (kicker) elements.push(kickerElement({ id: `shot-${n}-kicker`, kicker, x: W / 2, y: y - capHeight('bold', block.size) - H * 0.07, height: H, maxWidth: W * 0.88, palette, start: 0.05 * k }));
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
        // Sized from the frame's shorter side and drawn at the size that fits (the
        // line was measured small but drawn at a height-based size, so long lines
        // spilled out of vertical frames).
        const unit = Math.min(W, H);
        const block = fitBlock('medium', support, { maxWidth: W * (W < H ? 0.86 : 0.7), maxSize: Math.max(16, Math.min(H * 0.032, unit * 0.04)), minSize: 16, maxLines: 2 });
        const size = block.size;
        elements.push(textElement({
          id: `shot-${n}-support`, role: 'support', content: support, shown: support, font: 'medium', size,
          lines: block.lines,
          lineHeight: size * 1.35, x: W / 2, y: lineY + H * 0.065, fill: palette.muted,
          reveal: { style: 'fade', unit: 'line', start: 1.0 * k, duration: 0.6 * k },
        }));
      }
      break;
    }
    case 'kicker-title': {
      const shown = display(copy, textCase);
      const block = fitBlock(DISPLAY, shown, { maxWidth: W * 0.7, maxSize: H * 0.15, minSize: H * 0.07, maxLines: 2, tracking: 0.03 });
      const lineHeight = block.size * 1.04;
      const y = blockBaseline(H * 0.52, block.size, block.lines.length, lineHeight, DISPLAY);
      const lastBaseline = y + (block.lines.length - 1) * lineHeight;
      if (kicker) elements.push(kickerElement({ id: `shot-${n}-kicker`, kicker, x: W / 2, y: y - capHeight(DISPLAY, block.size) - H * 0.075, height: H, maxWidth: W * 0.88, palette, start: 0.35 * k }));
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: DISPLAY, size: block.size, tracking: 0.03,
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
      // Each line fills the width, capped at a quarter of the height; the width always
      // wins, so a long line in a narrow frame shrinks instead of spilling over.
      const lineSizes = lines.map((line) => Math.min(H * 0.25, targetWidth / measure(DISPLAY, line, 1, 0.01)));
      const gap = H * 0.025;
      const caps = lineSizes.map((size) => capHeight(DISPLAY, size));
      const total = caps.reduce((sum, cap) => sum + cap, 0) + gap * (lines.length - 1);
      const y = H * 0.5 - total / 2 + caps[0];
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: DISPLAY, size: Math.min(...lineSizes), tracking: 0.01,
        lines, lineHeight: gap, lineSizes, x: W / 2, y, fill: palette.text,
        reveal: { style: 'slide', unit: 'line', start: 0.1 * k, duration: 0.7 * k, stagger: 0.14 * k },
        sweep: sweepAt(1.4),
        emphasis: emphasisFor(shown),
      }));
      elements.push(hairline({ id: `shot-${n}-accent`, x: W / 2 - targetWidth / 2, y: y - caps[0] + total + H * 0.05, width: targetWidth * 0.3, accent: palette.accent, start: 0.9 * k, duration: 0.6 * k, from: 'left' }));
      break;
    }
    case 'logo-reveal': {
      if (!context.logo) return expandRecipe({ ...spec, recipe: 'lockup' }, { copy, context, shotIndex, support });
      const logo = logoElement({ id: `shot-${n}-logo`, meta: context.logo, cx: W / 2, cy: H * 0.42, maxWidth: W * 0.5, maxHeight: H * 0.34, start: 0.15 * k, duration: 1.2 * k, glintAt: 1.6 * k });
      elements.push(logo);
      const shown = display(copy, textCase);
      const block = fitBlock('bold', shown, { maxWidth: W * 0.6, maxSize: H * 0.06, minSize: 16, maxLines: 2, tracking: -0.01 });
      const lineHeight = block.size * 1.2;
      const y = logo.y + logo.height / 2 + H * 0.1;
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: 'bold', size: block.size, tracking: -0.01,
        lines: block.lines, lineHeight, x: W / 2, y, fill: palette.text,
        reveal: { style: 'cascade', unit: 'letter', start: 1.1 * k, duration: 0.5 * k, stagger: Math.min(0.025, (0.7 * k) / Math.max(1, shown.length)) },
        emphasis: emphasisFor(shown),
      }));
      elements.push(hairline({ id: `shot-${n}-accent`, x: W / 2, y: y + (block.lines.length - 1) * lineHeight + H * 0.045, width: W * 0.06, accent: palette.accent, start: 1.4 * k, duration: 0.5 * k }));
      break;
    }
    case 'product-hero': {
      const product = productFor(spec, context);
      if (!product) return expandRecipe({ ...spec, recipe: 'title-reveal' }, { copy, context, shotIndex, support });
      if (W / H < 1.2) {
        // Vertical and square frames stack the product above the line.
        const panelHeight = H * (H > W ? 0.56 : 0.54);
        const panelWidth = Math.min(W * 0.92, panelHeight * (product.meta.width / product.meta.height) * 1.15);
        elements.push({
          id: `shot-${n}-product`, type: 'image', role: 'product', product: product.index, x: (W - panelWidth) / 2, y: H * 0.05, width: panelWidth, height: panelHeight,
          feather: { left: 0.14, right: 0.14, top: 0.1, bottom: 0.3 },
          reveal: { style: 'emerge', start: 0, duration: 1.1 * k }, push: 0.04,
          glint: { start: Math.max(1.4 * k, spec.durationInSeconds * 0.5), duration: 0.8 },
        });
        const shown = display(copy, textCase);
        const block = fitBlock(DISPLAY, shown, { maxWidth: W * 0.86, maxSize: H * (H > W ? 0.1 : 0.13), minSize: H * 0.04, maxLines: 2, tracking: 0.04 });
        const lineHeight = block.size * 1.02;
        const top = H * 0.05 + panelHeight + H * 0.06;
        const y = top + capHeight(DISPLAY, block.size) + (kicker ? H * 0.035 : 0);
        const lastBaseline = y + (block.lines.length - 1) * lineHeight;
        if (kicker) {
          const kickerNode = kickerElement({ id: `shot-${n}-kicker`, kicker, x: W / 2, y: top, height: H, maxWidth: W * 0.88, palette, start: 0.35 * k });
          kickerNode.fill = palette.emphasis.from;
          elements.push(kickerNode);
        }
        elements.push(textElement({
          id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: DISPLAY, size: block.size, tracking: 0.015,
          lines: block.lines, lineHeight, x: W / 2, y, fill: palette.text,
          reveal: { style: 'mask-rise', unit: 'word', start: 0.6 * k, duration: 0.8 * k, stagger: 0.1 * k },
          settle: { from: 0.05, start: 0.6 * k, duration: 1.4 * k },
          sweep: spec.sweep === false ? undefined : { start: Math.max(1.6 * k, spec.durationInSeconds * 0.62), duration: 0.8 },
          emphasis: emphasisFor(shown),
        }));
        elements.push(hairline({ id: `shot-${n}-accent`, x: W / 2, y: lastBaseline + H * 0.03, width: W * 0.14, accent: palette.accent, start: 1.0 * k, duration: 0.6 * k }));
        break;
      }
      const side = (productOrdinal ?? shotIndex) % 2 === 0 ? 'right' : 'left';
      const panelWidth = Math.min(W * 0.5, H * (product.meta.width / product.meta.height));
      const panelX = side === 'right' ? W - panelWidth - W * 0.04 : W * 0.04;
      elements.push({
        id: `shot-${n}-product`, type: 'image', role: 'product', product: product.index, x: panelX, y: 0, width: panelWidth, height: H,
        feather: side === 'right' ? { left: 0.32, right: 0.12, top: 0.12, bottom: 0.18 } : { left: 0.12, right: 0.32, top: 0.12, bottom: 0.18 },
        reveal: { style: 'emerge', start: 0, duration: 1.1 * k }, push: 0.045,
        glint: { start: Math.max(1.4 * k, spec.durationInSeconds * 0.5), duration: 0.8 },
      });
      const textLeft = side === 'right' ? W * 0.08 : panelX + panelWidth + W * 0.05;
      const textWidth = side === 'right' ? panelX - W * 0.05 - textLeft : W * 0.92 - textLeft;
      const shown = display(copy, textCase);
      const block = fitBlock(DISPLAY, shown, { maxWidth: textWidth, maxSize: H * 0.3, minSize: H * 0.07, maxLines: 2, tracking: 0.06 });
      const lineHeight = block.size * 1.02;
      const y = blockBaseline(H * 0.5, block.size, block.lines.length, lineHeight, DISPLAY);
      const lastBaseline = y + (block.lines.length - 1) * lineHeight;
      if (kicker) {
        const kickerNode = kickerElement({ id: `shot-${n}-kicker`, kicker, x: textLeft + 3, y: y - capHeight(DISPLAY, block.size) - H * 0.05, height: H, maxWidth: W * 0.88, palette, start: 0.35 * k, anchor: 'start' });
        kickerNode.fill = palette.emphasis.from;
        elements.push(kickerNode);
      }
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: DISPLAY, size: block.size, tracking: 0.015,
        lines: block.lines, lineHeight, x: textLeft, y, anchor: 'start', fill: palette.text,
        reveal: { style: 'mask-rise', unit: 'word', start: 0.6 * k, duration: 0.8 * k, stagger: 0.1 * k },
        settle: { from: 0.06, start: 0.6 * k, duration: 1.4 * k },
        sweep: spec.sweep === false ? undefined : { start: Math.max(1.6 * k, spec.durationInSeconds * 0.62), duration: 0.8 },
        emphasis: emphasisFor(shown),
      }));
      elements.push(hairline({ id: `shot-${n}-accent`, x: textLeft + 3, y: lastBaseline + H * 0.05, width: Math.min(W * 0.14, textWidth * 0.4), accent: palette.accent, start: 1.0 * k, duration: 0.6 * k, from: 'left' }));
      break;
    }
    case 'type-window': {
      // Letters filled with a packshot's white background look pale: prefer a
      // textured photo; with only packshots, fill with the cropped product.
      let product = productFor(spec, context);
      if (product?.meta?.plain) {
        const textured = (context.products || []).findIndex((item) => !item.plain);
        if (textured >= 0) product = { index: textured + 1, meta: context.products[textured] };
      }
      if (!product) return expandRecipe({ ...spec, recipe: 'title-reveal' }, { copy, context, shotIndex, support });
      const shown = display(copy, textCase);
      const block = fitBlock(DISPLAY, shown, { maxWidth: W * 0.86, maxSize: H * 0.42, minSize: H * 0.12, maxLines: 2, tracking: 0.02 });
      const lineHeight = block.size * 0.98;
      const y = blockBaseline(H * 0.47, block.size, block.lines.length, lineHeight, DISPLAY);
      const lastBaseline = y + (block.lines.length - 1) * lineHeight;
      const letters = [...shown].filter((character) => character !== ' ').length;
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: DISPLAY, size: block.size, tracking: 0.02,
        lines: block.lines, lineHeight, x: W / 2, y, fill: palette.text,
        reveal: { style: 'window', unit: 'letter', start: 0, duration: 0.35, stagger: Math.min(0.14, (0.9 * k) / Math.max(1, letters)) },
        sweep: spec.sweep === false ? undefined : { start: Math.max(1.5 * k, spec.durationInSeconds * 0.6), duration: 0.8 },
      }));
      elements.at(-1).window = { product: product.index, outline: palette.emphasis.from, under: [mix(context.primaryColor, context.accentColor, 0.38), mix(context.primaryColor, context.accentColor, 0.15)], ...(product.meta.plain && product.meta.crop ? { crop: product.meta.crop } : {}) };
      const lineY = lastBaseline + H * 0.07;
      elements.push(hairline({ id: `shot-${n}-accent`, x: W / 2, y: lineY, width: W * 0.08, accent: palette.accent, start: 1.0 * k, duration: 0.5 * k }));
      if (kicker) elements.push(kickerElement({ id: `shot-${n}-kicker`, kicker, x: W / 2, y: lineY + H * 0.06, height: H, maxWidth: W * 0.88, palette, start: 1.1 * k }));
      break;
    }
    case 'word-beat': {
      // Kinetic poster: each word fills the frame in turn, then the line resolves.
      const shown = display(copy, textCase === 'as-written' && spec.textCase === undefined ? 'upper' : textCase);
      const count = shown.split(/\s+/).filter(Boolean).length;
      const unit = Math.min(W, H);
      const block = fitBlock(DISPLAY, shown, { maxWidth: W * 0.8, maxSize: unit * 0.22, minSize: unit * 0.06, maxLines: 3, tracking: 0.01 });
      const lineHeight = block.size * 1.0;
      const y = blockBaseline(H * 0.5, block.size, block.lines.length, lineHeight, DISPLAY);
      const interval = Math.min(0.5, Math.max(0.26, (spec.durationInSeconds * 0.55) / Math.max(1, count)));
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: DISPLAY, size: block.size, tracking: 0.01,
        lines: block.lines, lineHeight, x: W / 2, y, fill: palette.text,
        reveal: { style: 'beat', start: 0.05 * k, interval },
        emphasis: emphasisFor(shown),
      }));
      elements.push(hairline({ id: `shot-${n}-accent`, x: W / 2, y: y + (block.lines.length - 1) * lineHeight + unit * 0.05, width: W * 0.1, accent: palette.accent, start: 0.05 * k + count * interval, duration: 0.4 }));
      break;
    }
    case 'stat': {
      // The number counts up; the words around it sit beneath as the label.
      const match = STAT_NUMBER.exec(copy);
      if (!match) return expandRecipe({ ...spec, recipe: 'title-reveal' }, { copy, context, shotIndex, support });
      const shown = display(copy, textCase === 'as-written' ? 'as-written' : textCase);
      const unit = Math.min(W, H);
      // When the line opens with its number ("98% recycled leather"), the number
      // stands alone, huge, with the rest beneath as the label: one element, so the
      // copy stays exact.
      const words = shown.split(/\s+/);
      const opensWithNumber = STAT_NUMBER.test(words[0]) && words.length > 1;
      let lines;
      let lineSizes;
      let lineHeight;
      if (opensWithNumber) {
        const label = words.slice(1).join(' ');
        const big = fitBlock(DISPLAY, words[0], { maxWidth: W * 0.8, maxSize: unit * (W < H ? 0.42 : 0.36), minSize: unit * 0.1, maxLines: 1, tracking: 0.01 });
        const small = fitBlock(DISPLAY, label, { maxWidth: W * 0.8, maxSize: big.size * 0.3, minSize: unit * 0.04, maxLines: 1, tracking: 0.01 });
        lines = [words[0], label];
        lineSizes = [big.size, small.size];
        // With per-line sizes the renderer steps each baseline by this gap plus the
        // next line's cap height (as in type stacks).
        lineHeight = unit * 0.055;
      } else {
        const block = fitBlock(DISPLAY, shown, { maxWidth: W * 0.86, maxSize: unit * 0.3, minSize: unit * 0.07, maxLines: 2, tracking: 0.01 });
        lines = block.lines;
        lineSizes = undefined;
        lineHeight = block.size * 1.02;
      }
      const firstSize = lineSizes ? lineSizes[0] : fitBlock(DISPLAY, shown, { maxWidth: W * 0.86, maxSize: unit * 0.3, minSize: unit * 0.07, maxLines: 2, tracking: 0.01 }).size;
      const caps = (lineSizes || lines.map(() => firstSize)).map((size) => capHeight(DISPLAY, size));
      const totalHeight = lineSizes ? caps.reduce((sum, cap) => sum + cap, 0) + lineHeight * (lines.length - 1) : caps[0] + (lines.length - 1) * lineHeight;
      const y = H * 0.5 - totalHeight / 2 + caps[0];
      const lastBaseline = lineSizes ? y + caps.slice(1).reduce((sum, cap) => sum + cap + lineHeight, 0) : y + (lines.length - 1) * lineHeight;
      if (kicker) elements.push(kickerElement({ id: `shot-${n}-kicker`, kicker, x: W / 2, y: y - capHeight(DISPLAY, firstSize) - unit * 0.06, height: H, maxWidth: W * 0.88, palette, start: 0.2 * k }));
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: DISPLAY, size: Math.min(...(lineSizes || [firstSize])), tracking: 0.01,
        lines, lineHeight, ...(lineSizes ? { lineSizes } : {}), x: W / 2, y, fill: palette.text,
        reveal: { style: 'count', start: 0.1 * k, duration: Math.min(1.6, 0.55 * spec.durationInSeconds) },
        sweep: spec.sweep === false ? undefined : { start: Math.max(1.8 * k, spec.durationInSeconds * 0.7), duration: 0.8 },
        emphasis: emphasisFor(shown),
      }));
      elements.push(hairline({ id: `shot-${n}-accent`, x: W / 2, y: lastBaseline + unit * 0.05, width: W * 0.1, accent: palette.accent, start: 0.9 * k, duration: 0.5 * k }));
      break;
    }
    case 'quote': {
      const shown = display(copy, textCase === 'upper' ? 'upper' : 'as-written');
      const unit = Math.min(W, H);
      const block = fitBlock('medium', shown, { maxWidth: W * 0.78, maxSize: unit * 0.075, minSize: unit * 0.035, maxLines: 4, tracking: 0 });
      const lineHeight = block.size * 1.32;
      const y = blockBaseline(H * 0.52, block.size, block.lines.length, lineHeight, 'medium');
      const lastBaseline = y + (block.lines.length - 1) * lineHeight;
      const markSize = unit * 0.24;
      elements.push(textElement({
        id: `shot-${n}-mark`, role: 'decor', content: '“', shown: '“', font: DISPLAY, size: markSize, lines: ['“'], lineHeight: markSize,
        x: W / 2, y: y - capHeight('medium', block.size) - unit * 0.03 + markSize * 0.42, fill: palette.emphasis.from,
        reveal: { style: 'fade', unit: 'line', start: 0, duration: 0.6 * k, stagger: 0 },
      }));
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: 'medium', size: block.size, tracking: 0,
        lines: block.lines, lineHeight, x: W / 2, y, fill: palette.text,
        reveal: { style: 'mask-rise', unit: 'word', start: 0.35 * k, duration: 0.6 * k, stagger: Math.min(0.09, 1.2 / Math.max(1, shown.split(/\s+/).length)) * k },
        emphasis: emphasisFor(shown),
      }));
      const lineY = lastBaseline + unit * 0.06;
      elements.push(hairline({ id: `shot-${n}-accent`, x: W / 2, y: lineY, width: W * 0.06, accent: palette.accent, start: 1.0 * k, duration: 0.5 * k }));
      if (kicker) elements.push(kickerElement({ id: `shot-${n}-kicker`, kicker: `— ${kicker}`, x: W / 2, y: lineY + unit * 0.06, height: H, maxWidth: W * 0.88, palette, start: 1.15 * k }));
      break;
    }
    case 'product-grid': {
      const products = context.products || [];
      if (products.length < 2) return expandRecipe({ ...spec, recipe: 'product-hero' }, { copy, context, shotIndex, support, productOrdinal });
      const first = Number.isInteger(spec.product) && spec.product >= 1 ? spec.product : 1;
      const count = Math.min(4, products.length);
      const picks = Array.from({ length: count }, (_, i) => ((first - 1 + i) % products.length) + 1);
      const tall = W / H < 1.2;
      const columns = tall ? 2 : count;
      const rows = Math.ceil(count / columns);
      const gap = Math.min(W, H) * 0.025;
      const areaW = W * (tall ? 0.86 : 0.88);
      const areaH = H * (tall ? 0.58 : 0.56);
      const tileW = (areaW - gap * (columns - 1)) / columns;
      const tileH = (areaH - gap * (rows - 1)) / rows;
      const left = (W - areaW) / 2;
      const top = H * 0.07;
      picks.forEach((product, i) => {
        const column = i % columns;
        const row = Math.floor(i / columns);
        elements.push({
          id: `shot-${n}-product-${i + 1}`, type: 'image', role: 'product', product, x: left + column * (tileW + gap), y: top + row * (tileH + gap), width: tileW, height: tileH,
          feather: { left: 0.07, right: 0.07, top: 0.07, bottom: 0.1 },
          reveal: { style: 'emerge', start: (0.1 + i * 0.14) * k, duration: 0.8 * k }, push: 0.03,
        });
      });
      const shown = display(copy, textCase);
      const block = fitBlock(DISPLAY, shown, { maxWidth: W * 0.86, maxSize: Math.min(W, H) * 0.11, minSize: Math.min(W, H) * 0.045, maxLines: 2, tracking: 0.03 });
      const lineHeight = block.size * 1.02;
      const y = top + areaH + H * 0.06 + capHeight(DISPLAY, block.size);
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: DISPLAY, size: block.size, tracking: 0.015,
        lines: block.lines, lineHeight, x: W / 2, y, fill: palette.text,
        reveal: { style: 'mask-rise', unit: 'word', start: (0.3 + count * 0.12) * k, duration: 0.7 * k, stagger: 0.08 * k },
        emphasis: emphasisFor(shown),
      }));
      elements.push(hairline({ id: `shot-${n}-accent`, x: W / 2, y: y + (block.lines.length - 1) * lineHeight + H * 0.035, width: W * 0.1, accent: palette.accent, start: 1.2 * k, duration: 0.5 * k }));
      break;
    }
    case 'split': {
      const product = productFor(spec, context);
      if (!product) return expandRecipe({ ...spec, recipe: 'statement' }, { copy, context, shotIndex, support });
      const tall = W / H < 1.2;
      const photoOnRight = (productOrdinal ?? shotIndex) % 2 === 0;
      // The photo fills one half edge to edge; only its inner edge softens.
      const photo = tall
        ? { x: 0, y: 0, width: W, height: H * 0.5, feather: { left: 0, right: 0, top: 0, bottom: 0.14 } }
        : { x: photoOnRight ? W / 2 : 0, y: 0, width: W / 2, height: H, feather: photoOnRight ? { left: 0.14, right: 0, top: 0, bottom: 0 } : { left: 0, right: 0.14, top: 0, bottom: 0 } };
      elements.push({ id: `shot-${n}-product`, type: 'image', role: 'product', product: product.index, ...photo, reveal: { style: 'emerge', start: 0, duration: 0.9 * k }, push: 0.035, glint: { start: Math.max(1.3 * k, spec.durationInSeconds * 0.5), duration: 0.8 } });
      const half = tall ? { x: W / 2, width: W * 0.84, centerY: H * 0.74 } : { x: photoOnRight ? W * 0.25 : W * 0.75, width: W * 0.4, centerY: H * 0.5 };
      const shown = display(copy, textCase);
      const block = fitBlock(DISPLAY, shown, { maxWidth: half.width, maxSize: Math.min(W, H) * 0.16, minSize: Math.min(W, H) * 0.05, maxLines: 3, tracking: 0.03 });
      const lineHeight = block.size * 1.02;
      const y = blockBaseline(half.centerY, block.size, block.lines.length, lineHeight, DISPLAY);
      if (kicker) elements.push(kickerElement({ id: `shot-${n}-kicker`, kicker, x: half.x, y: y - capHeight(DISPLAY, block.size) - Math.min(W, H) * 0.05, height: H, maxWidth: half.width, palette, start: 0.4 * k }));
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: DISPLAY, size: block.size, tracking: 0.015,
        lines: block.lines, lineHeight, x: half.x, y, fill: palette.text,
        reveal: { style: 'mask-rise', unit: 'word', start: 0.5 * k, duration: 0.7 * k, stagger: 0.09 * k },
        emphasis: emphasisFor(shown),
      }));
      elements.push(tall
        ? hairline({ id: `shot-${n}-accent`, x: W / 2, y: H * 0.5, width: W, accent: palette.accent, start: 0.3 * k, duration: 0.6 * k })
        : { id: `shot-${n}-accent`, type: 'rect', x: W / 2 - 1, y: H * 0.12, width: 2, height: H * 0.76, fill: palette.accent, opacity: 0.85 });
      break;
    }
    case 'lockup':
    default: {
      const shown = display(copy, textCase);
      // The payoff: a campaign line of up to six words is the biggest moment in the
      // film, in the display face, with words slamming in; longer lines stay calm.
      const payoff = shown.split(/\s+/).length <= 6;
      const titleFont = payoff ? DISPLAY : 'bold';
      const unit = Math.min(W, H);
      const block = payoff
        ? fitBlock(DISPLAY, shown, { maxWidth: W * (W < H ? 0.84 : 0.8), maxSize: unit * 0.2, minSize: unit * 0.06, maxLines: 2, tracking: 0.01 })
        : fitBlock('bold', shown, { maxWidth: W * 0.72, maxSize: H * 0.09, minSize: H * 0.045, maxLines: 2, tracking: -0.015 });
      const lineHeight = block.size * (payoff ? 1.02 : 1.18);
      if (context.logo) {
        elements.push(logoElement({ id: `shot-${n}-logo`, meta: context.logo, cx: W / 2, cy: H * 0.3, maxWidth: W * 0.3, maxHeight: H * 0.16, start: 0.05 * k, duration: 0.9 * k, glintAt: 1.5 * k }));
      }
      const y = blockBaseline(context.logo ? H * 0.53 : H * 0.43, block.size, block.lines.length, lineHeight, titleFont);
      const lastBaseline = y + (block.lines.length - 1) * lineHeight;
      const letters = [...shown].filter((character) => character !== ' ').length;
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: titleFont, size: block.size, tracking: payoff ? 0.01 : -0.015,
        lines: block.lines, lineHeight, x: W / 2, y, fill: palette.text,
        reveal: payoff
          ? { style: 'slam', start: 0.3 * k, duration: 0.5, stagger: Math.min(0.18, (0.9 * k) / Math.max(1, shown.split(/\s+/).length)) }
          : { style: 'cascade', unit: 'letter', start: 0.2 * k, duration: 0.55 * k, stagger: Math.min(0.03, (0.8 * k) / Math.max(1, letters)) },
        sweep: spec.sweep === false ? undefined : { start: 1.6 * k, duration: 0.9 },
        emphasis: emphasisFor(shown),
      }));
      const lineY = lastBaseline + H * 0.06;
      elements.push(hairline({ id: `shot-${n}-accent`, x: W / 2, y: lineY, width: W * 0.12, accent: palette.accent, start: 0.75 * k, duration: 0.6 * k }));
      let nextY = lineY + H * 0.1;
      if (kicker) {
        // An exact kicker (from the brief) keeps its own capitalization.
        const shownKicker = spec.kickerExact ? kicker : kicker.toUpperCase();
        // Sized from the frame's shorter side: in a tall frame, height-based sizes
        // are too big for the narrow width. Two lines at most, always inside the frame.
        const unit = Math.min(W, H);
        const block = fitBlock(DISPLAY, shownKicker, { maxWidth: W * (W < H ? 0.86 : 0.6), maxSize: unit * 0.07, minSize: unit * 0.032, maxLines: 2, tracking: 0.04 });
        elements.push(textElement({
          id: `shot-${n}-kicker`, role: 'kicker', content: kicker, shown: shownKicker, font: DISPLAY, size: block.size, tracking: 0.04,
          lines: block.lines, lineHeight: block.size * 1.05, x: W / 2, y: nextY, fill: palette.text,
          reveal: { style: 'mask-rise', unit: 'line', start: 1.0 * k, duration: 0.7 * k, stagger: 0.12 * k },
        }));
        nextY += Math.max(H * 0.06, block.size * 1.05 * block.lines.length + unit * 0.02);
      }
      if (support) {
        // The end card's supporting line: sized from the frame's shorter side and
        // drawn at the size that fits (it used to be measured small but drawn at a
        // height-based size, so long lines spilled out of vertical frames).
        const unit = Math.min(W, H);
        const block = fitBlock('medium', support, { maxWidth: W * (W < H ? 0.86 : 0.7), maxSize: Math.max(16, Math.min(H * 0.028, unit * 0.036)), minSize: 16, maxLines: 2 });
        const size = block.size;
        elements.push(textElement({
          id: `shot-${n}-support`, role: 'support', content: support, shown: support, font: 'medium', size,
          lines: block.lines,
          lineHeight: size * 1.35, x: W / 2, y: nextY, fill: palette.muted,
          reveal: { style: 'fade', unit: 'line', start: 1.2 * k, duration: 0.6 * k },
        }));
      }
      break;
    }
  }
  if (spec.durationInSeconds >= LONG_SHOT_SECONDS) {
    const title = elements.find((element) => element.role === 'title');
    const late = spec.durationInSeconds * 0.58;
    if (title && (!title.sweep || title.sweep.start + title.sweep.duration < spec.durationInSeconds * 0.45)) {
      title.sweep = { start: late, duration: 0.9 };
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
  end: 'lockup', 'end-card': 'lockup', endcard: 'lockup', outro: 'lockup', closing: 'lockup',
  logo: 'logo-reveal', 'logo-sting': 'logo-reveal', 'brand-reveal': 'logo-reveal', 'logo-reveal': 'logo-reveal',
  product: 'product-hero', packshot: 'product-hero', 'pack-shot': 'product-hero', 'hero-product': 'product-hero', 'product-shot': 'product-hero',
  window: 'type-window', 'letters-window': 'type-window', 'photo-type': 'type-window', 'image-type': 'type-window',
  number: 'stat', counter: 'stat', statistic: 'stat', 'stat-reveal': 'stat', testimonial: 'quote', 'pull-quote': 'quote', grid: 'product-grid', 'photo-grid': 'product-grid', collage: 'product-grid', 'split-screen': 'split', 'half-split': 'split',
});
const TRANSITION_ALIASES = Object.freeze({
  'zoom-through': 'zoom', 'letter-zoom': 'zoom', 'zoom-in': 'zoom', 'zoom-through-letter': 'zoom',
  'hard-cut': 'cut', none: 'cut', straight: 'cut',
  crossfade: 'fade', dissolve: 'fade', 'fade-through': 'fade', 'dip-to-black': 'fade',
  slide: 'wipe', swipe: 'wipe', 'wipe-left': 'wipe', 'wipe-right': 'wipe', panel: 'wipe',
  'push-in': 'push', 'push-through': 'push',
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
export function fallbackDirection(seed, index, count, copy, productCount = 0) {
  const direction = DIRECTIONS[hashSeed(seed) % DIRECTIONS.length];
  const words = String(copy).trim().split(/\s+/).filter(Boolean);
  let recipe;
  if (count > 1 && index === count - 1) recipe = 'lockup';
  else if (index === 0) recipe = direction.openers[0] === 'type-stack' && (words.length < 2 || words.length > 4) ? 'title-reveal' : direction.openers[0];
  else recipe = direction.middle;
  if (recipe === 'kicker-title') recipe = 'title-reveal';
  if (index > 0 && index < count - 1 && STAT_NUMBER.test(String(copy)) && String(copy).length <= 28) recipe = 'stat';
  else if (productCount && count >= 2 && index === 1) recipe = productCount >= 3 && count >= 5 ? 'product-grid' : 'product-hero';
  else if (productCount && count >= 4 && index === count - 2 && words.length <= 2 && String(copy).length <= 16) recipe = 'type-window';
  // Offline films still show the newer effects: one headline effect on the second shot.
  const seedValue = [...String(seed)].reduce((sum, character) => sum + character.codePointAt(0), 0);
  const typeEffect = count >= 4 && index === 1 && !['product-hero', 'type-window'].includes(recipe) ? TYPE_EFFECTS[seedValue % TYPE_EFFECTS.length] : undefined;
  // Offline films vary their text motion too, with an echo on the opening and end card.
  const textRecipes = ['title-reveal', 'kicker-title', 'statement', 'type-stack', 'product-hero', 'split', 'product-grid'];
  const textMotion = textRecipes.includes(recipe) && !typeEffect ? TEXT_MOTIONS[(seedValue + index) % TEXT_MOTIONS.length] : undefined;
  return {
    ...(typeEffect ? { typeEffect } : {}),
    ...(textMotion ? { textMotion } : {}),
    echo: index === 0 || index === count - 1,
    ...(productCount ? { product: (index % productCount) + 1 } : {}),
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
export function normalizeDirection(raw, { copy, index, count, seed, hasLogo = false, productCount = 0 }) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const changes = [];
  const fallback = fallbackDirection(seed, index, count, copy, productCount);
  const words = String(copy).trim().split(/\s+/).filter(Boolean);

  let recipe = slug(source.recipe);
  if (!RECIPE_OPTIONS.includes(recipe)) {
    const mapped = RECIPE_ALIASES[recipe];
    if (mapped) changes.push(`recipe "${source.recipe}" treated as "${mapped}"`);
    else changes.push(source.recipe ? `unknown recipe "${source.recipe}" replaced with "${fallback.recipe}"` : `no recipe chosen; used "${fallback.recipe}"`);
    recipe = mapped || fallback.recipe;
  }
  if (PRODUCT_RECIPES.includes(recipe) && !productCount) {
    changes.push(`${recipe} needs an uploaded product photo; used "${fallback.recipe === recipe ? 'title-reveal' : fallback.recipe}"`);
    recipe = PRODUCT_RECIPES.includes(fallback.recipe) ? 'title-reveal' : fallback.recipe;
  }
  if (recipe === 'word-beat' && (words.length < 2 || words.length > 5)) {
    changes.push('word-beat needs a line of two to five words; used "title-reveal"');
    recipe = 'title-reveal';
  }
  if (recipe === 'stat' && !STAT_NUMBER.test(String(copy))) {
    changes.push('stat needs a number in the line; used "title-reveal"');
    recipe = 'title-reveal';
  }
  if (recipe === 'product-grid' && productCount < 2) {
    changes.push('product-grid needs two or more photos; used "product-hero"');
    recipe = 'product-hero';
  }
  if (recipe === 'type-window' && (words.length > 2 || String(copy).length > 16)) {
    changes.push('type-window suits one or two short words; used "product-hero"');
    recipe = 'product-hero';
  }
  if (recipe === 'logo-reveal' && !hasLogo) {
    changes.push('logo-reveal needs an uploaded logo; used "lockup"');
    recipe = index === count - 1 ? 'lockup' : fallback.recipe === 'logo-reveal' ? 'title-reveal' : fallback.recipe;
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
  const requested = Number(source.product);
  const product = productCount ? (Number.isInteger(requested) && requested >= 1 && requested <= productCount ? requested : (index % productCount) + 1) : undefined;
  return {
    direction: {
      recipe,
      ...(product ? { product } : {}),
      ...(TYPE_EFFECTS.includes(source.typeEffect) ? { typeEffect: source.typeEffect } : {}),
      ...(TEXT_MOTIONS.includes(source.textMotion) ? { textMotion: source.textMotion } : {}),
      ...(EMPHASIS_STYLES.includes(source.emphasisStyle) ? { emphasisStyle: source.emphasisStyle } : {}),
      ...(typeof source.echo === 'boolean' ? { echo: source.echo } : {}),
      ...(normalizeGraphics(source.graphics, copy).length ? { graphics: normalizeGraphics(source.graphics, copy) } : {}),
      ...(typeof source.reason === 'string' && source.reason.trim() ? { reason: source.reason.trim().replace(/\s+/g, ' ').slice(0, 160) } : {}),
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
  let zooms = 0;
  let effects = 0;
  let echoes = 0;
  specs.forEach((spec, index) => {
    if (spec?.version !== 2) return;
    const label = labels[index] || `shot ${index + 1}`;
    if (spec.transitionOut === 'fold') {
      folds += 1;
      if (folds > MAX_FOLDS) {
        spec.transitionOut = 'wipe';
        changes.push(`${label}: more than ${MAX_FOLDS} folds in the film; this one became a wipe.`);
      }
    }
    // Signature moves stay special: one zoom through a letter, two headline effects.
    if (spec.transitionOut === 'zoom' && (zooms += 1) > 1) {
      spec.transitionOut = 'push';
      changes.push(`${label}: one zoom through a letter per film; this one became a push.`);
    }
    // No motion twice in a row, and at most two echoes per film.
    if (spec.textMotion && spec.textMotion !== 'rise' && specs[index - 1]?.textMotion === spec.textMotion) {
      changes.push(`${label}: the same text motion twice in a row; this one rises instead.`);
      spec.textMotion = 'rise';
    }
    if (spec.echo && (echoes += 1) > 2) delete spec.echo;
    if (spec.typeEffect && (effects += 1) > 2) {
      changes.push(`${label}: at most two headline effects per film; dropped "${spec.typeEffect}".`);
      delete spec.typeEffect;
    }
  });
  return changes;
}

/**
 * Applies a shot's text motion (slam, drop, split), emphasis style (outline,
 * highlighter, pill) and decorative echo to its laid-out elements.
 */
export function applyTextMotion(elements, spec, context = {}) {
  const title = elements.find((element) => element.type === 'text' && element.role === 'title');
  if (!title) return elements;
  const k = Math.min(1.6, Math.max(1, (spec.durationInSeconds || 2.5) / 2.5));
  const shown = String(title.shown || title.content);
  const wordCount = shown.split(/\s+/).filter(Boolean).length;
  const ownMotion = ['type-window', 'logo-reveal', 'stat', 'word-beat', 'quote'].includes(spec.recipe) || TYPE_EFFECTS.includes(spec.typeEffect);
  if (!ownMotion && TEXT_MOTIONS.includes(spec.textMotion) && spec.textMotion !== 'rise') {
    const letters = shown.replace(/\s/g, '').length;
    title.reveal = spec.textMotion === 'slam'
      ? { style: 'slam', start: 0.15 * k, duration: 0.5, stagger: Math.min(0.16, (0.9 * k) / Math.max(1, wordCount)) }
      : spec.textMotion === 'drop'
        ? { style: 'drop', start: 0.1 * k, duration: 0.55, stagger: Math.min(0.06, (0.9 * k) / Math.max(1, letters)) }
        : { style: 'split', start: 0.1 * k, duration: 0.7 * k, stagger: 0.1 * k };
  }
  if (EMPHASIS_STYLES.includes(spec.emphasisStyle) && spec.emphasisStyle !== 'gradient' && title.emphasis?.words?.length && context.accentColor) {
    // Highlighters and pills sit behind the word: its ink must read on the accent.
    const paint = context.accentColor;
    const ink = readableTextColor(paint);
    if (spec.emphasisStyle === 'outline' || contrastRatio(ink, paint) >= MIN_TEXT_CONTRAST) {
      title.emphasisStyle = spec.emphasisStyle;
      title.emphasisPaint = paint;
      title.emphasisInk = ink;
    }
  }
  if (spec.echo && context.width && context.height && context.primaryColor && context.accentColor) {
    const words = shown.split(/\s+/).filter(Boolean);
    const chosen = title.emphasis?.words?.length ? words[title.emphasis.words[0]] : words.reduce((best, word) => (word.length > best.length ? word : best), '');
    const key = String(chosen || '').replace(/[^\p{L}\p{N}&]/gu, '').toUpperCase();
    if (key.length >= 2) {
      // Wider than the frame on purpose: the echo is cropped by both edges.
      const size = Math.min(context.height * 0.62, (context.width * 1.3) / Math.max(0.01, measure(title.font, key, 1)));
      const echo = textElement({
        id: `${title.id}-echo`, role: 'decor', content: key, shown: key, font: title.font, size, tracking: 0,
        lines: [key], lineHeight: size, x: context.width / 2, y: context.height * 0.5 + capHeight(title.font, size) / 2, fill: 'none',
        reveal: { style: 'fade', unit: 'line', start: 0, duration: 0.8, stagger: 0 },
      });
      // Present but quiet: felt behind the line, never competing with it.
      echo.outline = mix(context.accentColor, '#FFFFFF', 0.15);
      echo.opacity = 0.34;
      // Above every full-frame background (a later one would paint over it).
      const background = elements.findLastIndex((element) => element.type === 'rect' && element.x === 0 && element.y === 0 && element.width >= context.width && element.height >= context.height);
      elements.splice(background + 1, 0, echo);
    }
  }
  return elements;
}

/** Applies a shot's headline effect (decode or outline) to its title. */
export function applyTypeEffect(elements, spec) {
  if (!TYPE_EFFECTS.includes(spec?.typeEffect) || ['type-window', 'logo-reveal'].includes(spec.recipe)) return elements;
  const k = Math.min(1.6, Math.max(1, (spec.durationInSeconds || 2.5) / 2.5));
  for (const element of elements) {
    if (element.type !== 'text' || element.role !== 'title') continue;
    element.reveal = spec.typeEffect === 'decode'
      ? { style: 'decode', start: 0.15 * k, duration: 0.95 * k }
      : { style: 'outline', start: 0.1 * k, duration: 1.1 * k };
  }
  return elements;
}

/**
 * With product photos uploaded, the film shows the product at least once: a
 * middle shot (or the first, in a two-shot film) becomes a product hero.
 */
export function ensureProductShot(specs, productCount, labels = []) {
  if (!productCount || specs.length === 0 || specs.some((spec) => PRODUCT_RECIPES.includes(spec?.recipe))) return [];
  const index = specs.length >= 3 ? 1 : 0;
  specs[index].recipe = 'product-hero';
  specs[index].product = specs[index].product || 1;
  return [`${labels[index] || `shot ${index + 1}`}: shows the uploaded product as a product hero.`];
}
