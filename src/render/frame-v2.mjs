/**
 * v2 frame renderer: draws one frame of a timeline whose shots are v2 scene specs
 * (expanded by src/production/recipes.mjs). Everything is a pure function of the
 * frame index, so renders are deterministic.
 */
import { mix, readableTextColor } from '../production/color.mjs';
import { isDrawable, serializeSvgTree } from '../../public/svg-sanitize.mjs';
import { normalizeMotion } from '../production/motion.mjs';
import { capHeight, FONTS, layoutCharacters, layoutWords, measure } from './typography.mjs';

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const lerp = (a, b, t) => a + (b - a) * t;
const span = (t, start, end) => (end <= start ? (t >= end ? 1 : 0) : clamp((t - start) / (end - start)));
const ease = {
  outCubic: (x) => 1 - (1 - x) ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  outExpo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  inExpo: (x) => (x <= 0 ? 0 : 2 ** (10 * x - 10)),
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
};
const f = (value) => Number(value.toFixed(2));
const esc = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
const fontAttrs = (font, size) => `font-family="${FONTS[font].family}" font-weight="${FONTS[font].weight}" font-size="${f(size)}"`;

// ---------------------------------------------------------------- text

function lineGeometry(element) {
  const sizes = element.lines.map((_, index) => element.lineSizes?.[index] ?? element.fontSize);
  const baselines = [];
  element.lines.forEach((_, index) => {
    if (index === 0) baselines.push(element.y);
    else if (element.lineSizes) baselines.push(baselines[index - 1] + element.lineHeight + capHeight(element.font, sizes[index]));
    else baselines.push(element.y + index * element.lineHeight);
  });
  return { sizes, baselines };
}

function lineStart(element, line, size, tracking) {
  const width = measure(element.font, line, size, tracking);
  return element.anchor === 'start' ? element.x : element.anchor === 'end' ? element.x - width : element.x - width / 2;
}


// ---------------------------------------------------------------- headline effects

const DECODE_GLYPHS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789#/+<>';

/**
 * Decode: each letter cycles through code-like glyphs, then locks into place, left
 * to right. Outline: the letters trace themselves as outlines, then fill.
 */
function renderTypeEffect(element, t, ctx) {
  const { reveal } = element;
  const { sizes, baselines } = lineGeometry(element);
  const out = [];
  const total = element.lines.reduce((sum, line) => sum + line.replace(/\s/g, '').length, 0);
  const tick = Math.floor(t * 24);
  let index = 0;
  element.lines.forEach((line, lineIndex) => {
    const size = sizes[lineIndex];
    const baseline = baselines[lineIndex];
    const x0 = lineStart(element, line, size, element.tracking);
    if (reveal.style === 'outline') {
      const p = span(t, reveal.start, reveal.start + reveal.duration);
      const draw = ease.inOutCubic(clamp(p / 0.65));
      const fill = ease.outCubic(clamp((p - 0.45) / 0.55));
      const dash = size * 3.2;
      const spacing = f(element.tracking * size);
      const anchorText = (attrs) => `<text x="${f(x0)}" y="${f(baseline)}" ${fontAttrs(element.font, size)} letter-spacing="${spacing}" ${attrs}>${esc(line)}</text>`;
      if (fill > 0) out.push(anchorText(`fill="${element.fill}" opacity="${f(fill)}"`));
      if (draw > 0 && fill < 1) out.push(anchorText(`fill="none" stroke="${mix(ctx.accent, '#FFFFFF', 0.45)}" stroke-width="${f(Math.max(1.2, size * 0.012))}" stroke-dasharray="${f(dash)} ${f(dash)}" stroke-dashoffset="${f(dash * (1 - draw))}" opacity="${f(1 - fill * 0.7)}"`));
      return;
    }
    for (const { character, x } of layoutCharacters(element.font, line, size, element.tracking, x0)) {
      if (character === ' ') continue;
      const appear = reveal.start + reveal.duration * 0.3 * (index / Math.max(1, total));
      const lock = reveal.start + reveal.duration * (0.35 + 0.65 * (index / Math.max(1, total)));
      index += 1;
      if (t < appear) continue;
      if (t >= lock) {
        out.push(`<text x="${f(x)}" y="${f(baseline)}" ${fontAttrs(element.font, size)} fill="${element.fill}">${esc(character)}</text>`);
      } else {
        const glyph = DECODE_GLYPHS[(tick * 7 + index * 13) % DECODE_GLYPHS.length];
        out.push(`<text x="${f(x)}" y="${f(baseline)}" ${fontAttrs(element.font, size)} fill="${mix(ctx.accent, '#FFFFFF', 0.35)}" opacity="0.85">${esc(glyph)}</text>`);
      }
    }
  });
  return { defs: [], body: out.join('') };
}

/** The line with its first number at value * p, keeping decimals and separators. */
function countedLines(lines, p) {
  let done = false;
  return lines.map((line) => {
    if (done) return line;
    const match = /\d[\d,]*(?:\.\d+)?/.exec(line);
    if (!match) return line;
    done = true;
    const token = match[0];
    const decimals = (token.split('.')[1] || '').length;
    const value = Number.parseFloat(token.replace(/,/g, '')) * p;
    let text = value.toFixed(decimals);
    if (token.includes(',')) text = text.replace(/^(\d+)/, (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    return line.slice(0, match.index) + text + line.slice(match.index + token.length);
  });
}

function renderText(element, t, ctx) {
  if (element.reveal?.style === 'count') {
    // A stat: the number counts up, then the line settles exactly as written.
    const { start, duration } = element.reveal;
    const settled = { style: 'fade', unit: 'line', start: -10, duration: 0.01, stagger: 0 };
    element = t < start + duration
      ? { ...element, lines: countedLines(element.lines, ease.outCubic(span(t, start, start + duration))), reveal: settled }
      : { ...element, reveal: settled };
  }
  if (element.reveal?.style === 'decode' || element.reveal?.style === 'outline') {
    if (t < element.reveal.start + element.reveal.duration) return renderTypeEffect(element, t, ctx);
    // Finished: draw as settled text, with emphasis and sweeps.
    element = { ...element, reveal: { style: 'fade', unit: 'line', start: -10, duration: 0.01, stagger: 0 } };
  }
  const out = [];
  const defs = [];
  const { reveal } = element;
  const tracking = element.settle
    ? lerp(element.settle.from, element.tracking, ease.outCubic(span(t, element.settle.start, element.settle.start + element.settle.duration)))
    : element.tracking;
  const { sizes, baselines } = lineGeometry(element);
  const emphasis = new Set(element.emphasis?.words ?? []);
  const gradientId = `${element.id}-em`;
  let minX = Infinity;
  let maxX = -Infinity;
  element.lines.forEach((line, index) => {
    const x = lineStart(element, line, sizes[index], tracking);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + measure(element.font, line, sizes[index], tracking));
  });
  if (emphasis.size) {
    defs.push(`<linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse" x1="${f(minX)}" y1="0" x2="${f(maxX)}" y2="0"><stop offset="0" stop-color="${element.emphasis.from}"/><stop offset="1" stop-color="${element.emphasis.to}"/></linearGradient>`);
  }
  const fillFor = (wordIndex) => (emphasis.has(wordIndex) ? `url(#${gradientId})` : element.fill);

  let wordIndex = 0;
  let letterIndex = 0;
  const windowGlyphs = [];
  const windowOutlines = [];
  element.lines.forEach((line, lineIndex) => {
    const size = sizes[lineIndex];
    const baseline = baselines[lineIndex];
    const cap = capHeight(element.font, size);
    const x0 = lineStart(element, line, size, tracking);
    const spacing = f(tracking * size);
    const words = layoutWords(element.font, line, size, tracking, x0);

    if (reveal.style === 'mask-rise') {
      const units = reveal.unit === 'line' ? [{ text: line, x: x0, width: measure(element.font, line, size, tracking), words: words.map((_, i) => wordIndex + i) }]
        : words.map((word, i) => ({ text: word.word, x: word.x, width: word.width, words: [wordIndex + i] }));
      units.forEach((unit, unitIndex) => {
        const order = reveal.unit === 'line' ? lineIndex : unit.words[0];
        const begin = reveal.start + order * reveal.stagger;
        const p = ease.outExpo(span(t, begin, begin + reveal.duration));
        if (p <= 0) return;
        const y = baseline + (1 - p) * cap * 1.25;
        // Each word keeps its own fill, so emphasis colors only the emphasized words
        // even when a whole line rises as one unit.
        const text = reveal.unit === 'line'
          ? words.map((word, i) => `<text x="${f(word.x)}" y="${f(y)}" ${fontAttrs(element.font, size)} letter-spacing="${spacing}" fill="${fillFor(wordIndex + i)}">${esc(word.word)}</text>`).join('')
          : `<text x="${f(unit.x)}" y="${f(y)}" ${fontAttrs(element.font, size)} letter-spacing="${spacing}" fill="${fillFor(unit.words[0])}">${esc(unit.text)}</text>`;
        if (p < 1) {
          const clipId = `${element.id}-m${lineIndex}-${unitIndex}`;
          defs.push(`<clipPath id="${clipId}"><rect x="${f(unit.x - size * 0.08)}" y="${f(baseline - cap - size * 0.18)}" width="${f(unit.width + size * 0.16)}" height="${f(cap + size * 0.36)}"/></clipPath>`);
          out.push(`<g clip-path="url(#${clipId})">${text}</g>`);
        } else {
          out.push(text);
        }
      });
    } else if (reveal.style === 'window') {
      // Each letter is a window onto the graded product photo, landing in turn.
      const product = ctx.brand?.products?.[element.window.product - 1];
      if (!product?.graded) {
        throw new Error('This film shows a product photo, but no product photo came with the render request. Add it again and re-render.');
      }
      const top = baselines[0] - capHeight(element.font, sizes[0]) - sizes[0] * 0.12;
      const bottom = baselines.at(-1) + sizes.at(-1) * 0.08;
      const underId = `${element.id}-under`;
      if (lineIndex === 0) defs.push(`<linearGradient id="${underId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${element.window.under[0]}"/><stop offset="1" stop-color="${element.window.under[1]}"/></linearGradient>`);
      for (const { character, x } of layoutCharacters(element.font, line, size, tracking, x0)) {
        if (character === ' ') continue;
        const begin = reveal.start + letterIndex * reveal.stagger;
        letterIndex += 1;
        const p = ease.outExpo(span(t, begin, begin + reveal.duration));
        if (p <= 0) continue;
        const y = baseline + (1 - p) * size * 0.22;
        const scale = lerp(1.18, 1, p);
        const cx = x + measure(element.font, character, size) / 2;
        const move = `transform="translate(${f(cx)} ${f(baseline - cap / 2)}) scale(${scale.toFixed(5)}) translate(${f(-cx)} ${f(-(baseline - cap / 2))})"`;
        // One mask holds every letter (each with its own landing and fade), so the
        // photo is drawn once per frame, not once per letter.
        windowGlyphs.push(`<text x="${f(x)}" y="${f(y)}" ${fontAttrs(element.font, size)} fill="#FFFFFF" fill-opacity="${f(clamp(p * 1.4))}" ${move}>${esc(character)}</text>`);
        windowOutlines.push(`<text x="${f(x)}" y="${f(y)}" ${fontAttrs(element.font, size)} fill="none" stroke="${element.window.outline}" stroke-width="${f(Math.max(1.2, size * 0.006))}" opacity="${f(0.6 * clamp(p * 1.4))}" ${move}>${esc(character)}</text>`);
      }
      if (lineIndex === element.lines.length - 1 && windowGlyphs.length) {
        const drift = lerp(-0.04, 0.04, ease.inOutSine(clamp(t / ctx.duration))) * (bottom - top);
        defs.push(`<mask id="${element.id}-letters">${windowGlyphs.join('')}</mask>`);
        out.push(`<g mask="url(#${element.id}-letters)"><rect x="${f(minX - size * 0.1)}" y="${f(top)}" width="${f(maxX - minX + size * 0.2)}" height="${f(bottom - top)}" fill="url(#${underId})"/>`
          + `<image href="${product.windowGraded || product.graded}" x="${f(minX - size * 0.2)}" y="${f(top - (bottom - top) * 0.1 + drift)}" width="${f(maxX - minX + size * 0.4)}" height="${f((bottom - top) * 1.2)}" preserveAspectRatio="xMidYMid slice"/></g>`
          + windowOutlines.join(''));
      }
    } else if (reveal.style === 'cascade' || reveal.style === 'type-on') {
      const characters = layoutCharacters(element.font, line, size, tracking, x0);
      let localWord = wordIndex;
      for (const { character, x } of characters) {
        if (character === ' ') { localWord += 1; continue; }
        const begin = reveal.start + letterIndex * reveal.stagger;
        letterIndex += 1;
        if (reveal.style === 'type-on') {
          if (t < begin) continue;
          out.push(`<text x="${f(x)}" y="${f(baseline)}" ${fontAttrs(element.font, size)} fill="${fillFor(localWord)}">${esc(character)}</text>`);
          continue;
        }
        const p = ease.outCubic(span(t, begin, begin + reveal.duration));
        if (p <= 0) continue;
        out.push(`<text x="${f(x)}" y="${f(baseline + (1 - p) * size * 0.42)}" ${fontAttrs(element.font, size)} fill="${fillFor(localWord)}" opacity="${f(p)}">${esc(character)}</text>`);
      }
    } else {
      // fade and slide work on whole lines (words keep their own fills).
      const begin = reveal.start + lineIndex * (reveal.stagger || 0);
      const p = reveal.style === 'slide' ? ease.outExpo(span(t, begin, begin + reveal.duration)) : ease.outCubic(span(t, begin, begin + reveal.duration));
      if (p > 0) {
        const dx = reveal.style === 'slide' ? (lineIndex % 2 === 0 ? -1 : 1) * (1 - p) * ctx.width * 0.35 : 0;
        words.forEach((word, i) => {
          out.push(`<text x="${f(word.x + dx)}" y="${f(baseline)}" ${fontAttrs(element.font, size)} letter-spacing="${spacing}" fill="${fillFor(wordIndex + i)}" opacity="${f(p)}">${esc(word.word)}</text>`);
        });
      }
    }
    wordIndex += words.length;
  });

  // A band of light passes across the finished line.
  if (element.sweep) {
    const s = span(t, element.sweep.start, element.sweep.start + element.sweep.duration);
    if (s > 0 && s < 1) {
      const sweepId = `${element.id}-sweep`;
      const center = lerp(minX - 260, maxX + 260, s);
      defs.push(`<linearGradient id="${sweepId}" gradientUnits="userSpaceOnUse" x1="${f(center - 200)}" y1="0" x2="${f(center + 200)}" y2="0"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="0.5" stop-color="#FFFFFF" stop-opacity="1"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>`);
      element.lines.forEach((line, lineIndex) => {
        const size = sizes[lineIndex];
        out.push(`<text x="${f(lineStart(element, line, size, tracking))}" y="${f(baselines[lineIndex])}" ${fontAttrs(element.font, size)} letter-spacing="${f(tracking * size)}" fill="url(#${sweepId})" opacity="${f(Math.sin(Math.PI * s) * 0.85)}">${esc(line)}</text>`);
      });
    }
  }
  return { defs, body: out.join('') };
}

function renderLine(element, t) {
  const { reveal } = element;
  const p = ease.inOutCubic(span(t, reveal.start, reveal.start + reveal.duration));
  if (p <= 0) return '';
  const width = element.width * p;
  const x = reveal.from === 'left' ? element.x : element.x - width / 2;
  return `<rect x="${f(x)}" y="${f(element.y - element.height / 2)}" width="${f(width)}" height="${f(element.height)}" fill="${element.fill}" opacity="0.85"/>`;
}



// ---------------------------------------------------------------- product photos

/**
 * A product photo panel: graded into the palette (before rendering), feathered on
 * all four sides, emerging with a settle and a slow push, with a pass of light.
 */
function renderProduct(element, t, brand, duration) {
  const product = brand.products?.[element.product - 1];
  if (!product?.graded) {
    throw new Error('This film shows a product photo, but no product photo came with the render request. Add it again and re-render.');
  }
  const defs = [];
  const { x, y, width, height, feather, reveal, glint } = element;
  const p = ease.outCubic(span(t, reveal.start, reveal.start + reveal.duration));
  if (p <= 0) return { defs, body: '' };
  const prefix = `${element.id}-`;
  const stop = (offset, opacity) => `<stop offset="${f(offset)}" stop-color="#FFFFFF" stop-opacity="${opacity}"/>`;
  defs.push(`<linearGradient id="${prefix}fx" gradientUnits="userSpaceOnUse" x1="${f(x)}" y1="0" x2="${f(x + width)}" y2="0">${stop(0, 0)}${stop(feather.left, 1)}${stop(1 - feather.right, 1)}${stop(1, 0)}</linearGradient>`);
  defs.push(`<linearGradient id="${prefix}fy" gradientUnits="userSpaceOnUse" x1="0" y1="${f(y)}" x2="0" y2="${f(y + height)}">${stop(0, 0)}${stop(feather.top, 1)}${stop(1 - feather.bottom, 1)}${stop(1, 0)}</linearGradient>`);
  defs.push(`<mask id="${prefix}mx"><rect x="${f(x)}" y="${f(y)}" width="${f(width)}" height="${f(height)}" fill="url(#${prefix}fx)"/></mask>`);
  defs.push(`<mask id="${prefix}my"><rect x="${f(x)}" y="${f(y)}" width="${f(width)}" height="${f(height)}" fill="url(#${prefix}fy)"/></mask>`);
  const scale = lerp(1.08, 1, p) * (1 + (element.push || 0) * ease.inOutSine(clamp(t / duration)));
  const cx = x + width / 2;
  const cy = y + height / 2;
  const baked = brand.panels?.[element.id];
  if (baked) {
    // Feathering baked into a transparent image once per render: one plain image per frame.
    const g = glint ? span(t, glint.start, glint.start + glint.duration) : 0;
    const move = `transform="translate(${f(cx)} ${f(cy)}) scale(${scale.toFixed(5)}) translate(${f(-cx)} ${f(-cy)})"`;
    let lightLayer = '';
    if (g > 0 && g < 1) {
      const center = lerp(x - width * 0.4, x + width * 1.4, g);
      defs.push(`<linearGradient id="${prefix}light" gradientUnits="userSpaceOnUse" x1="${f(center - width * 0.18)}" y1="${f(y)}" x2="${f(center + width * 0.18)}" y2="${f(y + height * 0.35)}"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="0.5" stop-color="#FFFFFF" stop-opacity="1"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>`);
      defs.push(`<mask id="${prefix}lightmask" mask-type="alpha"><image href="${baked}" x="${f(x)}" y="${f(y)}" width="${f(width)}" height="${f(height)}"/></mask>`);
      lightLayer = `<rect x="${f(x)}" y="${f(y)}" width="${f(width)}" height="${f(height)}" fill="url(#${prefix}light)" mask="url(#${prefix}lightmask)" opacity="${f(Math.sin(Math.PI * g) * 0.22)}"/>`;
    }
    return { defs, body: `<g opacity="${f(p)}" ${move}><image href="${baked}" x="${f(x)}" y="${f(y)}" width="${f(width)}" height="${f(height)}"/>${lightLayer}</g>` };
  }
  let light = '';
  const g = glint ? span(t, glint.start, glint.start + glint.duration) : 0;
  if (g > 0 && g < 1) {
    const center = lerp(x - width * 0.4, x + width * 1.4, g);
    defs.push(`<linearGradient id="${prefix}light" gradientUnits="userSpaceOnUse" x1="${f(center - width * 0.18)}" y1="${f(y)}" x2="${f(center + width * 0.18)}" y2="${f(y + height * 0.35)}"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="0.5" stop-color="#FFFFFF" stop-opacity="1"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>`);
    light = `<rect x="${f(x)}" y="${f(y)}" width="${f(width)}" height="${f(height)}" fill="url(#${prefix}light)" opacity="${f(Math.sin(Math.PI * g) * 0.22)}"/>`;
  }
  return {
    defs,
    body: `<g mask="url(#${prefix}mx)"><g mask="url(#${prefix}my)"><g opacity="${f(p)}" transform="translate(${f(cx)} ${f(cy)}) scale(${scale.toFixed(5)}) translate(${f(-cx)} ${f(-cy)})"><image href="${product.graded}" x="${f(x)}" y="${f(y)}" width="${f(width)}" height="${f(height)}" preserveAspectRatio="xMidYMid slice"/>${light}</g></g></g>`,
  };
}

// ---------------------------------------------------------------- logo

/** The logo as an inline vector or image, fitted to its box. */
function logoMarkup(logo, x, y, width, height, { idPrefix, override, wrapper = '' } = {}) {
  if (logo.kind === 'svg') {
    return `<svg x="${f(x)}" y="${f(y)}" width="${f(width)}" height="${f(height)}" viewBox="${logo.viewBox.join(' ')}" preserveAspectRatio="xMidYMid meet"><g${wrapper}>${serializeSvgTree(logo.tree, { idPrefix, override })}</g></svg>`;
  }
  return `<image href="${logo.dataUri}" x="${f(x)}" y="${f(y)}" width="${f(width)}" height="${f(height)}" preserveAspectRatio="xMidYMid meet"/>`;
}

/**
 * Draws a logo element: an SVG strokes itself on along each shape's measured
 * length, then its own colors fill in; a PNG wipes in. Then a glint crosses the
 * logo's exact silhouette.
 */
function renderLogo(element, t, logo, ctx) {
  if (!logo) {
    throw new Error('This film includes the logo, but no logo came with the render request. Upload the logo again and re-render.');
  }
  const defs = [];
  const parts = [];
  const prefix = `${element.id}-`;
  const x0 = element.x - element.width / 2;
  const y0 = element.y - element.height / 2;
  const { reveal, glint } = element;
  // Shapes with no fill of their own default to black; give them the film's text color instead.
  const textColor = readableTextColor(ctx.primary);
  const wrapper = ` fill="${textColor}" color="${textColor}"`;
  if (logo.kind === 'svg') {
    const draw = ease.inOutCubic(span(t, reveal.start, reveal.start + reveal.duration));
    if (draw <= 0) return { defs, body: '' };
    const fill = ease.outCubic(span(t, reveal.start + reveal.duration * 0.7, reveal.start + reveal.duration + 0.35));
    const scale = Math.min(element.width / logo.viewBox[2], element.height / logo.viewBox[3]);
    const outline = mix(ctx.accent, '#FFFFFF', 0.45);
    if (fill > 0) parts.push(`<g opacity="${f(fill)}">${logoMarkup(logo, x0, y0, element.width, element.height, { idPrefix: `${prefix}f-`, wrapper })}</g>`);
    if (fill < 1) {
      parts.push(`<g opacity="${f(1 - fill * 0.9)}">${logoMarkup(logo, x0, y0, element.width, element.height, {
        idPrefix: `${prefix}s-`,
        override: (node) => (isDrawable(node) ? {
          fill: 'none', stroke: outline, 'stroke-width': f(2.2 / scale), 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
          'stroke-dasharray': f(Math.max(1, node.length || 1)), 'stroke-dashoffset': f(Math.max(1, node.length || 1) * (1 - draw)),
        } : null),
      })}</g>`);
    }
  } else {
    const wipe = ease.inOutCubic(span(t, reveal.start, reveal.start + reveal.duration));
    if (wipe <= 0) return { defs, body: '' };
    defs.push(`<clipPath id="${prefix}wipe"><rect x="${f(x0)}" y="${f(y0 - 2)}" width="${f(element.width * wipe)}" height="${f(element.height + 4)}"/></clipPath>`);
    parts.push(`<g clip-path="url(#${prefix}wipe)">${logoMarkup(logo, x0, y0, element.width, element.height)}</g>`);
  }
  const g = glint ? span(t, glint.start, glint.start + glint.duration) : 0;
  if (g > 0 && g < 1) {
    defs.push(`<mask id="${prefix}glint-mask" mask-type="alpha">${logoMarkup(logo, x0, y0, element.width, element.height, { idPrefix: `${prefix}m-`, wrapper })}</mask>`);
    const center = lerp(x0 - element.width * 0.3, x0 + element.width * 1.3, g);
    defs.push(`<linearGradient id="${prefix}glint" gradientUnits="userSpaceOnUse" x1="${f(center - element.width * 0.16)}" y1="${f(y0)}" x2="${f(center + element.width * 0.16)}" y2="${f(y0 + element.height * 0.6)}"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="0.5" stop-color="#FFFFFF" stop-opacity="1"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>`);
    parts.push(`<rect x="${f(x0)}" y="${f(y0)}" width="${f(element.width)}" height="${f(element.height)}" fill="url(#${prefix}glint)" mask="url(#${prefix}glint-mask)" opacity="${f(Math.sin(Math.PI * g) * 0.8)}"/>`);
  }
  return { defs, body: parts.join('') };
}

// ---------------------------------------------------------------- atmosphere

function gridPath(width, height) {
  const lines = [];
  for (let x = 0; x <= width; x += 42) lines.push(`M${x} 0V${height}`);
  for (let y = 0; y <= height; y += 42) lines.push(`M0 ${y}H${width}`);
  return lines.join('');
}

function atmosphere(kind, t, duration, ctx) {
  const { width: W, height: H, accent, primary } = ctx;
  const progress = clamp(t / duration);
  // A shot that enters through The Fold is already lit, so the fold reveals a living frame.
  const reveal = ctx.settled ? 1 : ease.outCubic(span(t, 0, 0.9));
  const defs = [];
  const parts = [];
  const glow = (name, cx, cy, r, opacity) => {
    const id = `${ctx.prefix || 's'}-${name}`;
    defs.push(`<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"><stop offset="0" stop-color="${accent}" stop-opacity="${opacity}"/><stop offset="0.6" stop-color="${accent}" stop-opacity="${f(opacity * 0.2)}"/><stop offset="1" stop-color="${primary}" stop-opacity="0"/></radialGradient>`);
    parts.push(`<rect width="${W}" height="${H}" fill="url(#${id})" opacity="${f(reveal)}"/>`);
  };
  const accentLines = `<path d="M ${f(W * 0.08)} ${f(H * 0.78)} H ${f(W * (0.08 + 0.34 * reveal))}" fill="none" stroke="${accent}" stroke-width="2" opacity=".7"/><path d="M ${f(W * 0.08)} ${f(H * 0.795)} H ${f(W * (0.08 + 0.15 * reveal))}" fill="none" stroke="${mix(accent, '#FFFFFF', 0.4)}" stroke-width="1" opacity=".6"/>`;
  switch (kind) {
    case 'orbit': {
      glow('atm-glow', '74%', '46%', '68%', 0.22);
      parts.push(`<path d="${gridPath(W, H)}" fill="none" stroke="${accent}" stroke-width=".5" stroke-opacity=".1"/>`);
      const cx = W * 0.76;
      const cy = H * 0.48;
      const r = Math.min(W, H);
      parts.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.26)}" fill="none" stroke="${accent}" opacity=".4" transform="rotate(${f(-18 + progress * 7)} ${f(cx)} ${f(cy)})"/>`);
      parts.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.31)}" fill="none" stroke="${mix(accent, '#FFFFFF', 0.4)}" stroke-dasharray="3 12" opacity=".32" transform="rotate(${f(22 - progress * 11)} ${f(cx)} ${f(cy)})"/>`);
      parts.push(accentLines);
      break;
    }
    case 'spotlight':
      glow('atm-glow', '50%', '46%', '52%', 0.26);
      break;
    case 'grid':
      glow('atm-glow', '50%', '50%', '70%', 0.14);
      parts.push(`<path d="${gridPath(W, H)}" fill="none" stroke="${accent}" stroke-width=".5" stroke-opacity=".12"/>`);
      break;
    case 'lines':
      parts.push(accentLines);
      break;
    case 'planes': {
      glow('atm-glow', '22%', '88%', '70%', 0.28);
      const planes = [
        { size: 0.7, x: 0.77, y: 0.08, speed: -14, rot: -8, opacity: 0.08 },
        { size: 0.47, x: 0.09, y: 0.58, speed: 22, rot: 12, opacity: 0.1 },
        { size: 0.3, x: 0.83, y: 0.72, speed: -34, rot: 24, opacity: 0.13 },
      ];
      for (const plane of planes) {
        const s = plane.size * W;
        const x = plane.x * W + t * plane.speed;
        const y = plane.y * H;
        const rot = plane.rot + t * plane.speed * 0.05;
        parts.push(`<path d="M ${f(x - s / 2)} ${f(y - s * 0.29)} L ${f(x + s / 2)} ${f(y - s * 0.29)} L ${f(x)} ${f(y + s * 0.58)} Z" fill="none" stroke="${accent}" stroke-width="1.5" opacity="${plane.opacity}" transform="rotate(${f(rot)} ${f(x)} ${f(y)})"/>`);
      }
      break;
    }
    case 'dots': {
      glow('atm-glow', '50%', '44%', '55%', 0.2);
      const front = ease.outCubic(span(t, 0, Math.min(1.6, duration * 0.6))) * Math.hypot(W, H) * 0.6;
      const bright = mix(accent, '#FFFFFF', 0.35);
      const step = Math.round(W / 32);
      const cols = Math.floor(W / step) + 1;
      const rows = Math.floor(H / step) + 1;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const x = c * step + (W - (cols - 1) * step) / 2;
          const y = r * step + (H - (rows - 1) * step) / 2;
          const d = Math.hypot(x - W / 2, (y - H / 2) * 1.4);
          const bump = Math.exp(-(((d - front) / 70) ** 2));
          const twinkle = 0.5 + 0.5 * Math.sin(t * 3.1 + c * 1.7 + r * 2.3);
          const opacity = (d < front ? 0.07 + 0.11 * twinkle : 0) + bump * 0.75;
          if (opacity < 0.02) continue;
          parts.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(1.1 + bump * 3.4)}" fill="${bump > 0.25 ? bright : accent}" opacity="${f(opacity)}"/>`);
        }
      }
      break;
    }
    default:
      break;
  }
  return { defs, body: parts.join('') };
}

/** A beam of light sweeps across, leaving a hairline that settles to the center. */
function beam(t, y, ctx) {
  const { width: W, accent } = ctx;
  const head = lerp(-120, W + 160, ease.inOutCubic(span(t, 0.05, 1.15)));
  const bright = mix(accent, '#FFFFFF', 0.55);
  if (t < 1.2) {
    return `<rect x="0" y="${f(y - 0.5)}" width="${f(clamp(head, 0, W))}" height="1" fill="${bright}" opacity="0.3"/><rect x="${f(head - 380)}" y="${f(y - 2)}" width="380" height="4" fill="url(#beam)"/><circle cx="${f(head)}" cy="${f(y)}" r="4.5" fill="#FFFFFF"/><ellipse cx="${f(head)}" cy="${f(y)}" rx="70" ry="16" fill="url(#beamGlow)"/>`;
  }
  const settle = ease.inOutCubic(span(t, 1.2, 1.8));
  const half = lerp(W / 2, 0, settle);
  return half > 1 ? `<rect x="${f(W / 2 - half)}" y="${f(y - 0.5)}" width="${f(half * 2)}" height="1" fill="${bright}" opacity="${f(0.3 * (1 - settle))}"/>` : '';
}

function cameraTransform(camera, progress, extraScale, ctx) {
  const cx = ctx.width / 2;
  const cy = ctx.height / 2;
  let scale = 1;
  let dx = 0;
  if (camera === 'push-in') scale = 1 + 0.08 * ease.inOutSine(progress);
  else if (camera === 'pull-out') scale = 1.08 - 0.08 * ease.outCubic(progress);
  else if (camera === 'drift-left') dx = -ctx.width * 0.03 * ease.inOutSine(progress);
  else if (camera === 'drift-right') dx = ctx.width * 0.03 * ease.inOutSine(progress);
  else if (camera === 'breathe') scale = 1 + 0.022 * ease.inOutSine(progress);
  scale *= extraScale;
  if (scale === 1 && dx === 0) return '';
  return `translate(${f(cx + dx)} ${f(cy)}) scale(${scale.toFixed(5)}) translate(${f(-cx)} ${f(-cy)})`;
}

// ---------------------------------------------------------------- timeline frame

export const TRANSITION_SECONDS = Object.freeze({ wipe: [0.3, 0.34], fade: [0.3, 0.3], push: [0.35, 0.35], fold: [0.3, 0.3], zoom: [0.5, 0.3] });

// Letters whose middle is solid ink, and letters with a solid left stem.
const SOLID_CENTER = new Set([...'IHTXN1']);
const LEFT_STEM = new Set([...'BDEFKLMPR']);

/**
 * Where a zoom through a letter flies in: a point of solid ink in one letter of
 * the shot's title (preferring the emphasized word), with that glyph to clip the
 * next shot. Undefined when no letter has a reliably solid point.
 */
export function zoomTarget(shot) {
  const element = shot.spec.elements?.find((item) => item.type === 'text' && item.role === 'title' && item.font === 'display')
    || shot.spec.elements?.find((item) => item.type === 'text' && item.role === 'title');
  if (!element) return undefined;
  const { sizes, baselines } = lineGeometry(element);
  // Emphasis is stored as word positions across the whole title.
  const emphasis = new Set(element.emphasis?.words ?? []);
  const candidates = [];
  let wordIndex = 0;
  element.lines.forEach((line, lineIndex) => {
    const size = sizes[lineIndex];
    const x0 = lineStart(element, line, size, element.tracking);
    const cap = capHeight(element.font, size);
    let inWord = false;
    for (const { character, x } of layoutCharacters(element.font, line, size, element.tracking, x0)) {
      if (character === ' ') { if (inWord) wordIndex += 1; inWord = false; continue; }
      inWord = true;
      const upper = character.toUpperCase();
      const advance = measure(element.font, character, size);
      const preferred = emphasis.has(wordIndex) ? 0 : 1;
      if (SOLID_CENTER.has(upper)) candidates.push({ rank: preferred * 2, x: x + advance / 2, character, glyphX: x, baseline: baselines[lineIndex], size, cap });
      else if (LEFT_STEM.has(upper)) candidates.push({ rank: preferred * 2 + 1, x: x + advance * 0.16, character, glyphX: x, baseline: baselines[lineIndex], size, cap });
    }
    if (inWord) wordIndex += 1;
  });
  if (!candidates.length) return undefined;
  candidates.sort((a, b) => a.rank - b.rank);
  const pick = candidates[0];
  return { ...pick, y: pick.baseline - pick.cap / 2, font: element.font };
}

/** Draws frame `frameIndex` of a timeline made of v2 shots, including transitions. */
export function renderTimelineFrame(timeline, frameIndex, brand = {}) {
  const W = timeline.width;
  const H = timeline.height;
  const fps = timeline.fps;
  let index = timeline.shots.findIndex((shot) => frameIndex >= shot.startFrame && frameIndex <= shot.endFrame);
  if (index < 0) index = timeline.shots.length - 1;
  const shot = timeline.shots[index];
  const previous = timeline.shots[index - 1];
  const t = (frameIndex - shot.startFrame) / fps;
  const duration = shot.durationFrames / fps;
  const tail = duration - t - 1 / fps;
  const primary = shot.palette?.primary || shot.spec.elements[0]?.fill || '#0E0E11';
  const accent = shot.palette?.accent || '#7C3AED';
  const ctx = { width: W, height: H, primary, accent };
  const { motion } = normalizeMotion(shot.spec.motion);
  const outgoing = shot.spec.transitionOut && index < timeline.shots.length - 1 ? shot.spec.transitionOut : 'cut';
  const incoming = previous?.spec?.transitionOut || 'cut';

  let extraScale = 1;
  const overlays = [];
  const veil = (opacity) => (opacity > 0.001 ? `<rect width="${W}" height="${H}" fill="${primary}" opacity="${f(clamp(opacity))}"/>` : '');
  if (outgoing === 'push' && tail < TRANSITION_SECONDS.push[0]) {
    const p = 1 - clamp(tail / TRANSITION_SECONDS.push[0]);
    extraScale *= 1 + 0.3 * ease.inExpo(p);
    overlays.push(veil(ease.inOutCubic(p)));
  }
  if (incoming === 'push' && t < TRANSITION_SECONDS.push[1]) {
    const p = clamp(t / TRANSITION_SECONDS.push[1]);
    extraScale *= lerp(0.93, 1, ease.outCubic(p));
    overlays.push(veil(1 - ease.outCubic(p)));
  }
  if (outgoing === 'fade' && tail < TRANSITION_SECONDS.fade[0]) overlays.push(veil(ease.inOutCubic(1 - clamp(tail / TRANSITION_SECONDS.fade[0]))));
  if (incoming === 'fade' && t < TRANSITION_SECONDS.fade[1]) overlays.push(veil(1 - ease.inOutCubic(clamp(t / TRANSITION_SECONDS.fade[1]))));
  const stripeColor = mix(accent, '#FFFFFF', 0.4);
  if (outgoing === 'wipe' && tail < TRANSITION_SECONDS.wipe[0]) {
    const right = W * ease.inOutCubic(1 - clamp(tail / TRANSITION_SECONDS.wipe[0]));
    overlays.push(`<rect x="0" y="0" width="${f(right)}" height="${H}" fill="${accent}"/>`);
  }
  if (incoming === 'wipe' && t < TRANSITION_SECONDS.wipe[1]) {
    const p = clamp(t / TRANSITION_SECONDS.wipe[1]);
    const left = W * ease.inOutCubic(p);
    const stripe = W * 0.07 * Math.sin(Math.PI * p);
    overlays.push(`<rect x="${f(left)}" y="0" width="${f(W - left)}" height="${H}" fill="${accent}"/>`);
    if (stripe > 0.5) overlays.push(`<rect x="${f(Math.max(0, left - stripe))}" y="0" width="${f(Math.min(stripe, left))}" height="${H}" fill="${stripeColor}"/>`);
  }

  if (incoming === 'zoom' && t < TRANSITION_SECONDS.zoom[1] && zoomTarget(previous)) {
    extraScale *= lerp(1.08, 1, ease.outCubic(clamp(t / TRANSITION_SECONDS.zoom[1])));
  }
  const zoom = outgoing === 'zoom' && tail < TRANSITION_SECONDS.zoom[0] ? zoomTarget(shot) : undefined;
  if (outgoing === 'zoom' && tail < TRANSITION_SECONDS.push[0] && !zoomTarget(shot)) {
    // No letter to fly into: behave like a push.
    const p = 1 - clamp(tail / TRANSITION_SECONDS.push[0]);
    extraScale *= 1 + 0.3 * ease.inExpo(p);
    overlays.push(veil(ease.inOutCubic(p)));
  }
  const layer = shotLayers(timeline, index, t, extraScale, brand);
  const defs = [...filmDefs(primary, accent, W, H), ...layer.defs];
  let content = layer.content;
  if (zoom) {
    const p = 1 - clamp(tail / TRANSITION_SECONDS.zoom[0]);
    // Big enough at the end that the letter's ink covers the whole frame.
    const end = Math.min(600, Math.max(60, (Math.hypot(W, H) * 2.2) / (zoom.size * 0.12)));
    const scale = end ** (p * p * p); // slow start, then the rush into the letter
    // The letter does the zoom: a plain glyph (safe at any scale) that is the window
    // onto the next shot, growing until its ink fills the frame. This shot only
    // pushes in gently: scaling it far would push its masked pieces fully off the
    // frame, which crashes the rasterizer.
    const around = (factor) => `translate(${f(zoom.x)} ${f(zoom.y)}) scale(${factor.toFixed(4)}) translate(${f(-zoom.x)} ${f(-zoom.y)})`;
    const next = shotLayers(timeline, index + 1, 0, 1.08, brand);
    defs.push(...next.defs);
    defs.push(`<clipPath id="zoom-letter"><text x="${f(zoom.glyphX)}" y="${f(zoom.baseline)}" ${fontAttrs(zoom.font, zoom.size)} transform="${around(scale)}">${esc(zoom.character)}</text></clipPath>`);
    // The letter's outline, a constant thin line in the light accent, shows you're
    // flying into the letter even when the next shot opens dark.
    const outline = `<text x="${f(zoom.glyphX)}" y="${f(zoom.baseline)}" ${fontAttrs(zoom.font, zoom.size)} fill="none" stroke="${mix(accent, '#FFFFFF', 0.45)}" stroke-width="${f(2.5 / scale)}" opacity="${f(1 - 0.6 * p)}" transform="${around(scale)}">${esc(zoom.character)}</text>`;
    content = `<g transform="${around(1 + 0.25 * ease.inOutCubic(p))}">${content}</g><g clip-path="url(#zoom-letter)">${next.content}</g>${outline}`;
  }
  if (outgoing === 'fold' && tail < TRANSITION_SECONDS.fold[0]) {
    // The next shot waits underneath at its first frame while this one folds over it.
    const next = shotLayers(timeline, index + 1, 0, 1, brand);
    defs.push(...next.defs);
    const p = 1 - clamp(tail / TRANSITION_SECONDS.fold[0]);
    content = foldOver({ under: next.content, folding: content, p, axis: foldAxis(timeline, index), W, H, accent, logo: brand.logo });
  } else if (incoming === 'fold' && t < TRANSITION_SECONDS.fold[1]) {
    const p = clamp(t / TRANSITION_SECONDS.fold[1]);
    content = foldAway({ under: content, p, axis: foldAxis(timeline, index - 1), W, H, accent, logo: brand.logo });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>${defs.join('')}</defs>
${content}
${overlays.join('')}
<rect width="${W}" height="${H}" fill="url(#vignette)"/>
</svg>`;
}

/** Everything one shot draws at time t: its background, atmosphere, beam, elements and camera. */
function shotLayers(timeline, index, t, extraScale = 1, brand = {}) {
  const W = timeline.width;
  const H = timeline.height;
  const shot = timeline.shots[index];
  const duration = shot.durationFrames / timeline.fps;
  const primary = shot.palette?.primary || shot.spec.elements[0]?.fill || '#0E0E11';
  const accent = shot.palette?.accent || '#7C3AED';
  const settled = timeline.shots[index - 1]?.spec?.transitionOut === 'fold';
  const ctx = { width: W, height: H, primary, accent, prefix: `s${index}`, settled, brand, duration };
  const { motion } = normalizeMotion(shot.spec.motion);
  const defs = [];
  const background = shot.spec.elements.find((element) => element.type === 'rect' && element.x === 0 && element.y === 0 && element.width === W && element.height === H);
  const atm = atmosphere(motion.atmosphere, t, duration, ctx);
  defs.push(...atm.defs);
  const layers = [atm.body];
  if (shot.spec.beam) {
    const anchor = shot.spec.elements.find((element) => element.type === 'line');
    layers.push(beam(t, anchor ? anchor.y : H * 0.6, ctx));
  }
  for (const element of shot.spec.elements) {
    if (element === background) continue;
    if (element.type === 'text' && element.reveal) {
      const rendered = renderText(element, t, ctx);
      defs.push(...rendered.defs);
      layers.push(rendered.body);
    } else if (element.type === 'line') {
      layers.push(renderLine(element, t));
    } else if (element.type === 'image') {
      const rendered = renderProduct(element, t, brand, duration);
      defs.push(...rendered.defs);
      layers.push(rendered.body);
    } else if (element.type === 'logo') {
      const rendered = renderLogo(element, t, brand.logo, ctx);
      defs.push(...rendered.defs);
      layers.push(rendered.body);
    } else if (element.type === 'rect') {
      layers.push(`<rect x="${f(element.x)}" y="${f(element.y)}" width="${f(element.width)}" height="${f(element.height)}" fill="${element.fill}"/>`);
    } else if (element.type === 'circle') {
      layers.push(`<circle cx="${f(element.x)}" cy="${f(element.y)}" r="${f(element.radius ?? 12)}" fill="${element.fill}"/>`);
    }
  }
  // A locked-off camera on a long shot breathes slightly, so the frame never freezes.
  const camera = motion.camera === 'static' && duration >= 4 ? 'breathe' : motion.camera;
  const transform = cameraTransform(camera, clamp(t / duration), extraScale, ctx);
  const scene = transform ? `<g transform="${transform}">${layers.join('\n')}</g>` : layers.join('\n');
  return { defs, content: `<rect width="${W}" height="${H}" fill="${background?.fill || primary}"/>\n${scene}` };
}

/** Gradients and clips shared by every shot in a frame, including The Fold's paper. */
function filmDefs(primary, accent, W, H) {
  const paperLight = mix(primary, accent, 0.3);
  const paperDark = mix(primary, accent, 0.12);
  return [
    `<radialGradient id="vignette" cx="50%" cy="50%" r="72%"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient>`,
    `<linearGradient id="beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${accent}" stop-opacity="0"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient>`,
    `<radialGradient id="beamGlow"><stop offset="0" stop-color="${accent}" stop-opacity="0.55"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="foldPaper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${paperLight}"/><stop offset="1" stop-color="${paperDark}"/></linearGradient>`,
    `<linearGradient id="foldShadowX" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></linearGradient>`,
    `<linearGradient id="foldShadowY" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></linearGradient>`,
    `<filter id="logoTint" x="0" y="0" width="1" height="1"><feFlood flood-color="${mix(paperLight, '#FFFFFF', 0.2)}"/><feComposite in2="SourceAlpha" operator="in"/></filter>`,
    `<clipPath id="foldFirstX"><rect x="0" y="0" width="${W / 2}" height="${H}"/></clipPath>`,
    `<clipPath id="foldSecondX"><rect x="${W / 2}" y="0" width="${W / 2}" height="${H}"/></clipPath>`,
    `<clipPath id="foldFirstY"><rect x="0" y="0" width="${W}" height="${H / 2}"/></clipPath>`,
    `<clipPath id="foldSecondY"><rect x="0" y="${H / 2}" width="${W}" height="${H / 2}"/></clipPath>`,
  ];
}

// ---------------------------------------------------------------- The Fold

/** A film's folds alternate: the first folds along a vertical crease, the next along a horizontal one. */
function foldAxis(timeline, boundaryIndex) {
  const before = timeline.shots.slice(0, boundaryIndex).filter((shot) => shot.spec.transitionOut === 'fold').length;
  return before % 2 === 0 ? 'x' : 'y';
}

/** The back of the paper: brand-tinted stock with two faint creases. */
function paperFace(x, y, width, height, shade, accent, { logo, full } = {}) {
  if (width < 0.5 || height < 0.5) return '';
  const crease = mix(accent, '#FFFFFF', 0.35);
  let mark = '';
  if (logo && full) {
    // Printed at the face's full size, then squashed with the paper as it turns.
    const box = Math.min(full.width * 0.42, full.height * 0.42);
    const ratio = logo.width / logo.height;
    const w = ratio >= 1 ? box : box * ratio;
    const h = ratio >= 1 ? box / ratio : box;
    mark = `<g transform="translate(${f(x + width / 2)} ${f(y + height / 2)}) scale(${(width / full.width).toFixed(4)} ${(height / full.height).toFixed(4)})" opacity="0.55" filter="url(#logoTint)">${logoMarkup(logo, -w / 2, -h / 2, w, h, { idPrefix: 'fold-logo-' })}</g>`;
  }
  return `<rect x="${f(x)}" y="${f(y)}" width="${f(width)}" height="${f(height)}" fill="url(#foldPaper)"/>`
    + `<path d="M ${f(x)} ${f(y)} L ${f(x + width)} ${f(y + height)} M ${f(x + width)} ${f(y)} L ${f(x)} ${f(y + height)}" stroke="${crease}" stroke-width="1" opacity="0.14"/>`
    + mark
    + `<rect x="${f(x)}" y="${f(y)}" width="${f(width)}" height="${f(height)}" fill="#000" opacity="${f(clamp(shade))}"/>`;
}

/**
 * Stage one: the frame's first half folds over its crease onto the second half,
 * revealing the next shot underneath. `p` runs from 0 to 1.
 */
function foldOver({ under, folding, p, axis, W, H, accent = '#7C3AED', logo }) {
  const theta = Math.PI * ease.inOutCubic(p);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const swell = 1 + 0.05 * s;
  const parts = [under];
  if (axis === 'x') {
    parts.push(`<g clip-path="url(#foldSecondX)">${folding}</g>`);
    parts.push(`<rect x="${f(W / 2 - 180)}" y="0" width="180" height="${H}" fill="url(#foldShadowX)" opacity="${f(s)}"/>`);
    if (c > 0) {
      parts.push(`<g transform="translate(${W / 2} ${H / 2}) scale(${c.toFixed(5)} ${swell.toFixed(5)}) translate(${-W / 2} ${-H / 2})"><g clip-path="url(#foldFirstX)">${folding}<rect x="0" y="0" width="${W / 2}" height="${H}" fill="#000" opacity="${f(0.6 * (1 - c))}"/></g></g>`);
    } else {
      const height = H * swell;
      parts.push(paperFace(W / 2, H / 2 - height / 2, (W / 2) * -c, height, 0.4 * (1 + c), accent, { logo, full: { width: W / 2, height } }));
    }
    parts.push(`<rect x="${f(W / 2 - 0.75)}" y="0" width="1.5" height="${H}" fill="${mix(accent, '#FFFFFF', 0.5)}" opacity="${f(0.8 * s)}"/>`);
  } else {
    parts.push(`<g clip-path="url(#foldSecondY)">${folding}</g>`);
    parts.push(`<rect x="0" y="${f(H / 2 - 120)}" width="${W}" height="120" fill="url(#foldShadowY)" opacity="${f(s)}"/>`);
    if (c > 0) {
      parts.push(`<g transform="translate(${W / 2} ${H / 2}) scale(${swell.toFixed(5)} ${c.toFixed(5)}) translate(${-W / 2} ${-H / 2})"><g clip-path="url(#foldFirstY)">${folding}<rect x="0" y="0" width="${W}" height="${H / 2}" fill="#000" opacity="${f(0.6 * (1 - c))}"/></g></g>`);
    } else {
      const width = W * swell;
      parts.push(paperFace(W / 2 - width / 2, H / 2, width, (H / 2) * -c, 0.4 * (1 + c), accent, { logo, full: { width, height: H / 2 } }));
    }
    parts.push(`<rect x="0" y="${f(H / 2 - 0.75)}" width="${W}" height="1.5" fill="${mix(accent, '#FFFFFF', 0.5)}" opacity="${f(0.8 * s)}"/>`);
  }
  return parts.join('\n');
}

/** Stage two: the folded half folds away off its far edge, uncovering the rest of the shot. */
function foldAway({ under, p, axis, W, H, accent = '#7C3AED', logo }) {
  const phi = (Math.PI / 2) * ease.inOutCubic(p);
  const c = Math.cos(phi);
  const swell = 1 + 0.05 * Math.sin(phi);
  const parts = [under];
  if (axis === 'x') {
    const width = (W / 2) * c;
    if (width > 0.5) {
      const height = H * swell;
      parts.push(`<rect x="${f(W - width - 160)}" y="0" width="160" height="${H}" fill="url(#foldShadowX)" opacity="${f(0.9 * c)}"/>`);
      parts.push(paperFace(W - width, H / 2 - height / 2, width, height, 0.65 * (1 - c), accent, { logo, full: { width: W / 2, height } }));
      parts.push(`<rect x="${f(W - width - 0.75)}" y="0" width="1.5" height="${H}" fill="${mix(accent, '#FFFFFF', 0.5)}" opacity="0.8"/>`);
    }
  } else {
    const height = (H / 2) * c;
    if (height > 0.5) {
      const width = W * swell;
      parts.push(`<rect x="0" y="${f(H - height - 120)}" width="${W}" height="120" fill="url(#foldShadowY)" opacity="${f(0.9 * c)}"/>`);
      parts.push(paperFace(W / 2 - width / 2, H - height, width, height, 0.65 * (1 - c), accent, { logo, full: { width, height: H / 2 } }));
      parts.push(`<rect x="0" y="${f(H - height - 0.75)}" width="${W}" height="1.5" fill="${mix(accent, '#FFFFFF', 0.5)}" opacity="0.8"/>`);
    }
  }
  return parts.join('\n');
}
