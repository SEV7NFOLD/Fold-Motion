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

export const RECIPE_OPTIONS = Object.freeze(['title-reveal', 'statement', 'kicker-title', 'type-stack', 'lockup', 'logo-reveal', 'product-hero', 'type-window']);

/** Recipes that put an uploaded product photo on screen. */
export const PRODUCT_RECIPES = Object.freeze(['product-hero', 'type-window']);
export const TRANSITION_OPTIONS = Object.freeze(['cut', 'wipe', 'fade', 'push', 'fold']);
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

function kickerElement({ id, kicker, x, y, height, palette, start, anchor = 'middle' }) {
  const size = Math.max(16, height * 0.022);
  const shown = String(kicker).toUpperCase();
  return textElement({
    id, role: 'kicker', content: kicker, shown, font: 'semibold', size, tracking: 0.42,
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
        const block = fitBlock('display', shown, { maxWidth: W * 0.86, maxSize: H * (H > W ? 0.1 : 0.13), minSize: H * 0.04, maxLines: 2, tracking: 0.04 });
        const lineHeight = block.size * 1.02;
        const top = H * 0.05 + panelHeight + H * 0.06;
        const y = top + capHeight('display', block.size) + (kicker ? H * 0.035 : 0);
        const lastBaseline = y + (block.lines.length - 1) * lineHeight;
        if (kicker) {
          const kickerNode = kickerElement({ id: `shot-${n}-kicker`, kicker, x: W / 2, y: top, height: H, palette, start: 0.35 * k });
          kickerNode.fill = palette.emphasis.from;
          elements.push(kickerNode);
        }
        elements.push(textElement({
          id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: 'display', size: block.size, tracking: 0.015,
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
      const block = fitBlock('display', shown, { maxWidth: textWidth, maxSize: H * 0.3, minSize: H * 0.07, maxLines: 2, tracking: 0.06 });
      const lineHeight = block.size * 1.02;
      const y = blockBaseline(H * 0.5, block.size, block.lines.length, lineHeight, 'display');
      const lastBaseline = y + (block.lines.length - 1) * lineHeight;
      if (kicker) {
        const kickerNode = kickerElement({ id: `shot-${n}-kicker`, kicker, x: textLeft + 3, y: y - capHeight('display', block.size) - H * 0.05, height: H, palette, start: 0.35 * k, anchor: 'start' });
        kickerNode.fill = palette.emphasis.from;
        elements.push(kickerNode);
      }
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: 'display', size: block.size, tracking: 0.015,
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
      const product = productFor(spec, context);
      if (!product) return expandRecipe({ ...spec, recipe: 'title-reveal' }, { copy, context, shotIndex, support });
      const shown = display(copy, textCase);
      const block = fitBlock('display', shown, { maxWidth: W * 0.86, maxSize: H * 0.42, minSize: H * 0.12, maxLines: 2, tracking: 0.02 });
      const lineHeight = block.size * 0.98;
      const y = blockBaseline(H * 0.47, block.size, block.lines.length, lineHeight, 'display');
      const lastBaseline = y + (block.lines.length - 1) * lineHeight;
      const letters = [...shown].filter((character) => character !== ' ').length;
      elements.push(textElement({
        id: `shot-${n}-copy`, role: 'title', content: copy, shown, font: 'display', size: block.size, tracking: 0.02,
        lines: block.lines, lineHeight, x: W / 2, y, fill: palette.text,
        reveal: { style: 'window', unit: 'letter', start: 0, duration: 0.35, stagger: Math.min(0.14, (0.9 * k) / Math.max(1, letters)) },
        sweep: spec.sweep === false ? undefined : { start: Math.max(1.5 * k, spec.durationInSeconds * 0.6), duration: 0.8 },
      }));
      elements.at(-1).window = { product: product.index, outline: palette.emphasis.from, under: [mix(context.primaryColor, context.accentColor, 0.38), mix(context.primaryColor, context.accentColor, 0.15)] };
      const lineY = lastBaseline + H * 0.07;
      elements.push(hairline({ id: `shot-${n}-accent`, x: W / 2, y: lineY, width: W * 0.08, accent: palette.accent, start: 1.0 * k, duration: 0.5 * k }));
      if (kicker) elements.push(kickerElement({ id: `shot-${n}-kicker`, kicker, x: W / 2, y: lineY + H * 0.06, height: H, palette, start: 1.1 * k }));
      break;
    }
    case 'lockup':
    default: {
      const shown = display(copy, textCase);
      const block = fitBlock('bold', shown, { maxWidth: W * 0.72, maxSize: H * 0.09, minSize: H * 0.045, maxLines: 2, tracking: -0.015 });
      const lineHeight = block.size * 1.18;
      if (context.logo) {
        elements.push(logoElement({ id: `shot-${n}-logo`, meta: context.logo, cx: W / 2, cy: H * 0.3, maxWidth: W * 0.3, maxHeight: H * 0.16, start: 0.05 * k, duration: 0.9 * k, glintAt: 1.5 * k }));
      }
      const y = blockBaseline(context.logo ? H * 0.53 : H * 0.43, block.size, block.lines.length, lineHeight, 'bold');
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
        // An exact kicker (from the brief) keeps its own capitalization.
        const shownKicker = spec.kickerExact ? kicker : kicker.toUpperCase();
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
export function fallbackDirection(seed, index, count, copy, productCount = 0) {
  const direction = DIRECTIONS[hashSeed(seed) % DIRECTIONS.length];
  const words = String(copy).trim().split(/\s+/).filter(Boolean);
  let recipe;
  if (count > 1 && index === count - 1) recipe = 'lockup';
  else if (index === 0) recipe = direction.openers[0] === 'type-stack' && (words.length < 2 || words.length > 4) ? 'title-reveal' : direction.openers[0];
  else recipe = direction.middle;
  if (recipe === 'kicker-title') recipe = 'title-reveal';
  if (productCount && count >= 2 && index === 1) recipe = 'product-hero';
  else if (productCount && count >= 4 && index === count - 2 && words.length <= 2 && String(copy).length <= 16) recipe = 'type-window';
  return {
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
