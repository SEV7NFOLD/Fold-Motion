import { execFile } from 'node:child_process';
import { beatGrid, measureBeatSync, timelineBeatEvents } from '../src/production/beat-clock.mjs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { generateFrameManifest } from './qa/generate-frame-hashes.mjs';
import { evaluateCreativeQA, validateTimeline } from '../src/production/production.mjs';
import { normalizeMotion } from '../src/production/motion.mjs';
import { renderTimelineFrame } from '../src/render/frame-v2.mjs';
import { FONT_FILES } from '../src/render/typography.mjs';
import { resolveBrandAssets } from '../src/production/brand-assets.mjs';
import { mix } from '../src/production/color.mjs';
import { normalizeBrandFont } from '../src/production/brand-assets.mjs';
import { registerBrandFont } from '../src/render/typography.mjs';
import { composeScore, encodeWav, masterScore, MOOD_OPTIONS } from '../src/audio/fold-score.mjs';
import { instrumentBand } from '../src/audio/band.mjs';

const execFileAsync = promisify(execFile);

// One bundled font keeps renders identical on every machine and avoids scanning
// every system font for each frame (the main cost on small servers).
export const RENDER_FONT_FAMILY = 'Montserrat';
const RESVG_FONT_OPTIONS = Object.freeze({ fontFiles: [...FONT_FILES], loadSystemFonts: false, defaultFontFamily: RENDER_FONT_FAMILY });
const FONT_STACK = `${RENDER_FONT_FAMILY}, Arial, sans-serif`;

/**
 * The background grid as one path (42 px cells). Rasterizing a single path is far
 * cheaper than an SVG <pattern>; opacity .1176 equals the pattern's .42 at .28.
 */
const gridCache = new Map();
function gridPath(width, height) {
  const key = `${width}x${height}`;
  if (!gridCache.has(key)) {
    const lines = [];
    for (let x = 0; x <= width; x += 42) lines.push(`M${x} 0V${height}`);
    for (let y = 0; y <= height; y += 42) lines.push(`M0 ${y}H${width}`);
    gridCache.set(key, lines.join(''));
  }
  return gridCache.get(key);
}

/** Subtle temporal film grain for v2 films (RENDER_GRAIN, default 3; 0 turns it off). */
function grainFilter(timeline, scale = 1) {
  if (!timeline.shots.some((shot) => shot.spec.version === 2)) return '';
  // Grain looks finer at higher resolutions, and fresh grain on every pixel of
  // every frame is costly to encode: it gets gentler as the frame grows.
  const strength = Number(process.env.RENDER_GRAIN ?? 3) / scale;
  return Number.isFinite(strength) && strength > 0 ? `noise=alls=${Math.min(20, Number(strength.toFixed(2)))}:allf=t` : '';
}

/**
 * Grades a product photo into the film's palette once per render: luminance mapped
 * through shadows (the primary, darkened), muted mid-tones toward the accent,
 * soft lights and warm paper highlights. Returns a PNG data URI whose shorter
 * side is 720 px, which every frame then reuses.
 */
/**
 * Output sizes. The layout keeps its own size (1280x720, 720x1280 or 960x960);
 * only rasterization scales, so text and graphics stay sharp and every recipe and
 * creative check is unchanged.
 */
export const RESOLUTIONS = Object.freeze({
  hd: { label: 'HD', landscape: 1280, vertical: 720, square: 960, work: 1 },
  fhd: { label: 'Full HD', landscape: 1920, vertical: 1080, square: 1080, work: 2.3 },
  '2k': { label: '2K', landscape: 2560, vertical: 1440, square: 1440, work: 4 },
});

/** The output size for a timeline at a resolution: { key, width, height, scale }. */
export function outputSize(timeline, resolution = 'hd') {
  const key = Object.hasOwn(RESOLUTIONS, resolution) ? resolution : 'hd';
  const shape = timeline.width > timeline.height ? 'landscape' : timeline.width < timeline.height ? 'vertical' : 'square';
  const width = RESOLUTIONS[key][shape];
  const scale = width / timeline.width;
  const even = (value) => Math.round(value / 2) * 2;
  return { key, label: RESOLUTIONS[key].label, width: even(width), height: even(timeline.height * scale), scale };
}

export function gradeProduct(product, { primary, accent }, { lift = false, scale = 1, original = false } = {}) {
  // Inside letters a photo has to read as light against the background, so type
  // windows get a lifted grade: dark products still show their shape.
  const stops = lift ? [
    [0, mix(mix(primary, accent, 0.45), '#8E8A9A', 0.35)],
    [0.35, mix(mix(accent, '#FFFFFF', 0.4), '#B6B2C2', 0.4)],
    [0.7, '#E2DEE8'],
    [1, '#FFFFFF'],
  ] : [
    [0, mix(primary, '#000000', 0.35)],
    [0.42, mix(mix(primary, accent, 0.35), '#6E6A78', 0.45)],
    [0.75, mix(mix(accent, '#FFFFFF', 0.62), '#B0ACB8', 0.5)],
    [1, '#F6F3EE'],
  ];
  const channel = (hex, index) => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  const table = (index) => Array.from({ length: 17 }, (_, k) => {
    const t = k / 16;
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1][0]) i += 1;
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    return (channel(c0, index) + (channel(c1, index) - channel(c0, index)) * u).toFixed(4);
  }).join(' ');
  // Prepared at the output resolution (at least 720 px on the shorter side), but
  // never enlarged past the source photo: upscaling adds no detail.
  const shorter = Math.min(product.width, product.height);
  const target = Math.max(720, Math.min(720 * scale, shorter));
  const factor = target / shorter;
  const width = Math.round(product.width * factor);
  const height = Math.round(product.height * factor);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><filter id="grade" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">`
    + '<feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0"/>'
    + `<feComponentTransfer><feFuncR type="table" tableValues="${table(0)}"/><feFuncG type="table" tableValues="${table(1)}"/><feFuncB type="table" tableValues="${table(2)}"/></feComponentTransfer>`
    + `</filter></defs><image href="${product.dataUri}" width="${width}" height="${height}"${original ? '' : ' filter="url(#grade)"'}/></svg>`;
  return `data:image/png;base64,${Buffer.from(new Resvg(svg).render().asPng()).toString('base64')}`;
}

/**
 * Bakes each product panel's feathered edges into a transparent PNG once per
 * render, so frames draw one plain image instead of two gradient masks.
 */
export function bakeProductPanels(timeline, brand, scale = 1) {
  const panels = {};
  for (const shot of timeline.shots) {
    for (const element of shot.spec.elements || []) {
      if (element.type !== 'image' || !element.feather) continue;
      const product = brand.products?.[element.product - 1];
      if (!product?.graded) continue;
      // Baked at the output resolution so the panel stays sharp when it's drawn.
      const w = Math.round(element.width * scale);
      const h = Math.round(element.height * scale);
      const { left, right, top, bottom } = element.feather;
      const stop = (offset, opacity) => `<stop offset="${offset}" stop-color="#FFFFFF" stop-opacity="${opacity}"/>`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>`
        + `<linearGradient id="fx" x1="0" y1="0" x2="1" y2="0">${stop(0, 0)}${stop(left, 1)}${stop(1 - right, 1)}${stop(1, 0)}</linearGradient>`
        + `<linearGradient id="fy" x1="0" y1="0" x2="0" y2="1">${stop(0, 0)}${stop(top, 1)}${stop(1 - bottom, 1)}${stop(1, 0)}</linearGradient>`
        + `<mask id="mx"><rect width="${w}" height="${h}" fill="url(#fx)"/></mask><mask id="my"><rect width="${w}" height="${h}" fill="url(#fy)"/></mask></defs>`
        + `<g mask="url(#mx)"><g mask="url(#my)"><image href="${product.graded}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/></g></g></svg>`;
      panels[element.id] = `data:image/png;base64,${Buffer.from(new Resvg(svg).render().asPng()).toString('base64')}`;
    }
  }
  return panels;
}

/** FFmpeg filters for each film look; clean leaves the brand colors untouched. */
export const LOOK_FILTERS = Object.freeze({
  clean: '',
  cinematic: "eq=contrast=1.06:saturation=1.08,colorbalance=rs=-0.03:bs=0.04:rh=0.03:bh=-0.02",
  matte: "curves=all='0/0.06 0.5/0.5 1/0.95',eq=saturation=0.92",
  noir: 'eq=saturation=0.22:contrast=1.08',
});

/** The film's look: the studio's pick, else the storyboard's, else clean. */
export function filmLook(grade, storyboard) {
  if (Object.hasOwn(LOOK_FILTERS, grade)) return grade;
  return Object.hasOwn(LOOK_FILTERS, storyboard?.grade) ? storyboard.grade : 'clean';
}

function videoFilters(timeline, look, scale = 1) {
  return [LOOK_FILTERS[look], grainFilter(timeline, scale)].filter(Boolean).join(',');
}

/** The score's mood: the studio's pick, else the storyboard's (the model's choice), else the brief's words. */
export function scoreMood(music, storyboard) {
  if (MOOD_OPTIONS.includes(music)) return music;
  return MOOD_OPTIONS.includes(storyboard?.musicMood) ? storyboard.musicMood : 'auto';
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character]);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function easeOutCubic(value) {
  return 1 - (1 - value) ** 3;
}

function wrapText(content, maximumCharacters) {
  const lines = [];
  let line = '';
  for (const word of String(content).trim().split(/\s+/)) {
    if ([...word].length > maximumCharacters) {
      if (line) lines.push(line);
      line = '';
      const characters = [...word];
      while (characters.length > maximumCharacters) {
        lines.push(characters.splice(0, maximumCharacters).join(''));
      }
      line = characters.join('');
    } else if (!line) {
      line = word;
    } else if ([...line].length + word.length + 1 <= maximumCharacters) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function easeInOutSine(value) {
  return -(Math.cos(Math.PI * value) - 1) / 2;
}

/** The camera move as an SVG transform, or '' when the camera is static. */
function cameraTransform(camera, progress, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const scaleAbout = (scale) => `translate(${cx} ${cy}) scale(${scale.toFixed(5)}) translate(${-cx} ${-cy})`;
  if (camera === 'push-in') return scaleAbout(1 + 0.08 * easeInOutSine(progress));
  if (camera === 'pull-out') return scaleAbout(1.08 - 0.08 * easeOutCubic(progress));
  if (camera === 'drift-left') return `translate(${(-width * 0.03 * easeInOutSine(progress)).toFixed(2)} 0)`;
  if (camera === 'drift-right') return `translate(${(width * 0.03 * easeInOutSine(progress)).toFixed(2)} 0)`;
  return '';
}

export function renderShotSvg(shot, progress, width, height) {
  const progressValue = clamp(progress, 0, 1);
  const reveal = easeOutCubic(clamp(progressValue * 4, 0, 1));
  const fade = 0.16 + 0.84 * reveal;
  const { motion } = normalizeMotion(shot.spec.motion);
  const primary = shot.palette?.primary
    || shot.spec.elements.find((element) => element.type === 'rect')?.fill
    || '#0B0F19';
  const accent = shot.palette?.accent
    || shot.spec.elements.find((element) => element.id.endsWith('-accent'))?.fill
    || '#00F0FF';
  const backgroundElements = [];
  const foregroundElements = [];
  const extraDefs = [];
  shot.spec.elements.forEach((element, elementIndex) => {
    const fill = escapeXml(element.fill || '#F8FAFC');
    if (element.type === 'rect') {
      const animatedWidth = element.id.endsWith('-accent')
        ? Math.max(1, element.width * easeOutCubic(clamp(progressValue * 2.2, 0.05, 1)))
        : element.width;
      const markup = `<rect x="${element.x}" y="${element.y}" width="${animatedWidth}" height="${element.height}" fill="${fill}" opacity="${element.id.endsWith('-background') ? 1 : fade}"/>`;
      const isBackground = element.x === 0 && element.y === 0 && element.width === width && element.height === height;
      (isBackground ? backgroundElements : foregroundElements).push(markup);
    } else if (element.type === 'circle') {
      foregroundElements.push(`<circle cx="${element.x}" cy="${element.y}" r="${element.radius ?? 12}" fill="${fill}" opacity="${fade}"/>`);
    } else if (element.type === 'text') {
      const requestedSize = Number.isFinite(element.fontSize) ? element.fontSize : 32;
      const fittedSize = Math.min(requestedSize, height * 0.15);
      const lines = wrapText(
        element.content,
        Math.max(1, Math.floor(width * 0.76 / (fittedSize * 0.58))),
      );
      const anchor = element.anchor === 'middle' ? 'middle' : element.anchor === 'end' ? 'end' : 'start';
      const size = Math.max(16, fittedSize);
      const baseY = element.y - ((lines.length - 1) * fittedSize * 0.62) / 2;
      const textAttributes = (x, y, opacity) => `x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-family="${FONT_STACK}" font-size="${size}" font-weight="700" letter-spacing="${Math.max(0.4, fittedSize * 0.025)}" opacity="${opacity}" filter="url(#text-glow)" style="font-kerning:normal"`;
      const plainLines = (x) => lines.map((line, index) => (
        `<tspan x="${x}" dy="${index === 0 ? 0 : fittedSize * 1.2}">${escapeXml(line)}</tspan>`
      )).join('');

      if (motion.entrance === 'rise-glitch') {
        const y = element.y - ((lines.length - 1) * fittedSize * 0.62) / 2 - (1 - fade) * height * 0.035;
        const textLines = lines.map((line, index) => (
          `<tspan x="${element.x}" dy="${index === 0 ? 0 : fittedSize * 1.2}">${escapeXml(line)}</tspan>`
        )).join('');
        const glitchStrength = clamp((0.24 - progressValue) / 0.24, 0, 1);
        const glitchLayers = glitchStrength > 0
          ? `<text x="${element.x}" y="${y}" text-anchor="${anchor}" fill="#FF0055" font-family="${FONT_STACK}" font-size="${Math.max(16, fittedSize)}" font-weight="700" opacity="${glitchStrength * 0.48}" transform="translate(${Math.round(7 * glitchStrength)} ${Math.round(-2 * glitchStrength)}) skewX(-4)" clip-path="url(#glitch-slice)">${textLines}</text><text x="${element.x}" y="${y}" text-anchor="${anchor}" fill="${escapeXml(accent)}" font-family="${FONT_STACK}" font-size="${Math.max(16, fittedSize)}" font-weight="700" opacity="${glitchStrength * 0.38}" transform="translate(${Math.round(-5 * glitchStrength)} ${Math.round(2 * glitchStrength)})">${textLines}</text>`
          : '';
        foregroundElements.push(`${glitchLayers}<text x="${element.x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-family="${FONT_STACK}" font-size="${Math.max(16, fittedSize)}" font-weight="700" letter-spacing="${Math.max(0.4, fittedSize * 0.025)}" opacity="${fade}" filter="url(#text-glow)" style="font-kerning:normal">${textLines}</text>`);
      } else if (motion.entrance === 'fade') {
        const opacity = easeOutCubic(clamp(progressValue / 0.35, 0, 1));
        foregroundElements.push(`<text ${textAttributes(element.x, baseY, opacity)}>${plainLines(element.x)}</text>`);
      } else if (motion.entrance === 'slide-up') {
        const y = baseY + (1 - reveal) * height * 0.12;
        foregroundElements.push(`<text ${textAttributes(element.x, y, reveal)}>${plainLines(element.x)}</text>`);
      } else if (motion.entrance === 'slide-left') {
        const x = element.x + (1 - reveal) * width * 0.08;
        foregroundElements.push(`<text ${textAttributes(x, baseY, reveal)}>${plainLines(x)}</text>`);
      } else if (motion.entrance === 'scale-in') {
        const scale = 0.86 + 0.14 * reveal;
        const pivotY = element.y;
        foregroundElements.push(`<g transform="translate(${element.x} ${pivotY}) scale(${scale.toFixed(5)}) translate(${-element.x} ${-pivotY})"><text ${textAttributes(element.x, baseY, reveal)}>${plainLines(element.x)}</text></g>`);
      } else if (motion.entrance === 'type-on') {
        // Unrevealed characters stay in place but transparent, so the layout never shifts.
        const total = lines.reduce((sum, line) => sum + [...line].length, 0);
        let remaining = Math.round(total * clamp(progressValue / 0.45, 0, 1));
        const typed = lines.map((line, index) => {
          const characters = [...line];
          const shown = characters.slice(0, Math.max(0, remaining)).join('');
          const hidden = characters.slice(Math.max(0, remaining)).join('');
          remaining -= characters.length;
          const hiddenPart = hidden ? `<tspan fill-opacity="0">${escapeXml(hidden)}</tspan>` : '';
          return `<tspan x="${element.x}" dy="${index === 0 ? 0 : fittedSize * 1.2}">${escapeXml(shown)}${hiddenPart}</tspan>`;
        }).join('');
        foregroundElements.push(`<text ${textAttributes(element.x, baseY, 1)}>${typed}</text>`);
      } else if (motion.entrance === 'wipe') {
        const clipId = `wipe-${elementIndex}`;
        extraDefs.push(`<clipPath id="${clipId}"><rect x="0" y="0" width="${(width * easeOutCubic(clamp(progressValue / 0.4, 0, 1))).toFixed(2)}" height="${height}"/></clipPath>`);
        foregroundElements.push(`<g clip-path="url(#${clipId})"><text ${textAttributes(element.x, baseY, 1)}>${plainLines(element.x)}</text></g>`);
      }
    }
  });

  const grid = `<path d="${gridPath(width, height)}" fill="none" stroke="${escapeXml(accent)}" stroke-width=".5" stroke-opacity=".1176"/>`;
  const accentLines = `<path d="M ${width * 0.08} ${height * 0.78} H ${width * (0.08 + 0.34 * reveal)}" fill="none" stroke="${escapeXml(accent)}" stroke-width="2" opacity=".78" filter="url(#accent-glow)"/><path d="M ${width * 0.08} ${height * 0.795} H ${width * (0.08 + 0.15 * reveal)}" fill="none" stroke="#FF0055" stroke-width="1" opacity=".72"/>`;
  let atmosphere = '';
  if (motion.atmosphere === 'orbit') {
    atmosphere = `<rect width="${width}" height="${height}" fill="url(#ambient)" opacity=".7"/>${grid}<circle cx="${width * 0.76}" cy="${height * 0.48}" r="${Math.min(width, height) * 0.26}" fill="none" stroke="${escapeXml(accent)}" stroke-width="1" opacity=".42" transform="rotate(${-18 + progressValue * 7} ${width * 0.76} ${height * 0.48})"/><circle cx="${width * 0.76}" cy="${height * 0.48}" r="${Math.min(width, height) * 0.31}" fill="none" stroke="#FF0055" stroke-width="1" stroke-dasharray="3 12" opacity=".34" transform="rotate(${22 - progressValue * 11} ${width * 0.76} ${height * 0.48})"/>${accentLines}`;
  } else if (motion.atmosphere === 'spotlight') {
    extraDefs.push(`<radialGradient id="spotlight" cx="50%" cy="46%" r="52%"><stop offset="0" stop-color="${escapeXml(accent)}" stop-opacity=".26"/><stop offset=".55" stop-color="${escapeXml(accent)}" stop-opacity=".06"/><stop offset="1" stop-color="${escapeXml(primary)}" stop-opacity="0"/></radialGradient>`);
    atmosphere = `<rect width="${width}" height="${height}" fill="url(#spotlight)" opacity="${(0.5 + 0.5 * reveal).toFixed(3)}"/>`;
  } else if (motion.atmosphere === 'grid') {
    atmosphere = `<rect width="${width}" height="${height}" fill="url(#ambient)" opacity=".45"/>${grid}`;
  } else if (motion.atmosphere === 'lines') {
    atmosphere = accentLines;
  }

  const metadata = escapeXml(JSON.stringify({
    palette: shot.palette ?? { primary, accent },
    hardConstraints: shot.hardConstraints ?? [],
    copy: shot.spec.elements.filter((element) => element.type === 'text').map((element) => element.content),
  }));
  const transform = cameraTransform(motion.camera, progressValue, width, height);
  const scene = transform
    ? `<g transform="${transform}">\n${atmosphere}\n${foregroundElements.join('\n')}\n</g>`
    : `${atmosphere}\n${foregroundElements.join('\n')}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>
  <radialGradient id="ambient" cx="74%" cy="46%" r="68%"><stop offset="0" stop-color="${escapeXml(accent)}" stop-opacity=".22"/><stop offset=".42" stop-color="#FF0055" stop-opacity=".07"/><stop offset="1" stop-color="${escapeXml(primary)}" stop-opacity="0"/></radialGradient>
  <filter id="text-glow" x="-30%" y="-50%" width="160%" height="200%"><feGaussianBlur stdDeviation="5" result="blur"/><feFlood flood-color="${escapeXml(accent)}" flood-opacity=".34"/><feComposite in2="blur" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="accent-glow" x="-30%" y="-300%" width="160%" height="700%"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <clipPath id="glitch-slice"><rect x="0" y="${height * 0.42}" width="${width}" height="${height * 0.2}"/></clipPath>${extraDefs.length ? `\n  ${extraDefs.join('\n  ')}` : ''}
</defs>
<metadata>${metadata}</metadata>
${backgroundElements.join('\n')}
${scene}
</svg>`;
}

async function runCommand(command, args) {
  try {
    return await execFileAsync(command, args, {
      timeout: positiveNumber(process.env.RENDER_ENCODE_TIMEOUT_MS, 600_000),
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    const details = [error.message, error.stdout, error.stderr].filter(Boolean).join('\n');
    throw new Error(`${command} failed.\n${details}`);
  }
}

function parseFrameRate(value) {
  const [numerator, denominator = '1'] = String(value || '').split('/');
  const rate = Number(numerator) / Number(denominator);
  return Number.isFinite(rate) ? rate : NaN;
}

export async function renderProductionProject({
  timeline,
  storyboard,
  acceptance,
  context,
  assets,
  music = 'auto',
  grade = 'auto',
  resolution = 'hd',
  photoColor = 'original',
  outputRoot = path.resolve('output'),
}) {
  // Launch films render in the browser renderer (docs/LAUNCH-STYLE-BUILD-PLAN.md): same
  // request, same report format, labelled with its own renderer.
  if (arguments[0]?.timeline?.launch) {
    const { renderBrowserProject } = await import('../src/browser/render-browser.mjs');
    return renderBrowserProject(arguments[0]);
  }
  const validation = validateTimeline(timeline);
  const brand = resolveBrandAssets(assets);
  // A brand font: its metrics lay text out (registered for QA too), its file draws it.
  if (normalizeBrandFont(context?.brandFont)) registerBrandFont(normalizeBrandFont(context.brandFont));
  let fontOptions = RESVG_FONT_OPTIONS;
  const palette = timeline.shots[0]?.palette || { primary: '#0E0E11', accent: '#7C3AED' };
  const output = outputSize(timeline, resolution);
  // Photos are graded into the palette, or kept in their original colors.
  const original = photoColor === 'original';
  const hasWindows = timeline.shots.some((shot) => (shot.spec.elements || []).some((element) => element.window));
  brand.products = brand.products.map((product) => (product ? {
    ...product,
    graded: gradeProduct(product, palette, { scale: output.scale, original }),
    ...(hasWindows && !original ? { windowGraded: gradeProduct(product, palette, { lift: true, scale: output.scale }) } : {}),
  } : null));
  brand.panels = bakeProductPanels(timeline, brand, output.scale);
  if (!validation.valid) throw new Error(`Timeline validation failed: ${validation.errors.join(' ')}`);

  const projectId = timeline.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDirectory = path.join(outputRoot, projectId, runId);
  const framesDirectory = path.join(outputDirectory, 'frames');
  try {
    await access(outputDirectory);
    throw new Error(`Render output already exists: ${outputDirectory}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(framesDirectory, { recursive: true });
  if (brand.font) {
    // The rasterizer loads fonts from files: the brand font joins the bundled ones
    // (written after the existence check, which must see a fresh folder).
    const fontPath = path.join(outputDirectory, `brand-font.${brand.font.extension}`);
    await writeFile(fontPath, brand.font.buffer);
    fontOptions = { ...RESVG_FONT_OPTIONS, fontFiles: [...RESVG_FONT_OPTIONS.fontFiles, fontPath] };
  }
  // Large images go to files, and every frame points at them instead of embedding
  // megabytes of image data as text: far less memory at Full HD and 2K.
  const assetsDirectory = path.join(outputDirectory, 'assets');
  await mkdir(assetsDirectory, { recursive: true });
  let assetCount = 0;
  const toFile = async (uri) => {
    if (typeof uri !== 'string' || !uri.startsWith('data:image/')) return uri;
    assetCount += 1;
    const file = path.join(assetsDirectory, `image-${assetCount}.png`);
    await writeFile(file, Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64'));
    return file;
  };
  for (const product of brand.products) {
    if (!product) continue;
    product.graded = await toFile(product.graded);
    if (product.windowGraded) product.windowGraded = await toFile(product.windowGraded);
  }
  for (const id of Object.keys(brand.panels || {})) brand.panels[id] = await toFile(brand.panels[id]);
  await writeFile(path.join(outputDirectory, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
  await writeFile(path.join(outputDirectory, 'storyboard.json'), `${JSON.stringify(storyboard, null, 2)}\n`);
  await writeFile(path.join(outputDirectory, 'acceptance.json'), `${JSON.stringify(acceptance, null, 2)}\n`);
  await writeFile(path.join(outputDirectory, 'source-project.json'), `${JSON.stringify({
    schemaVersion: '1.0',
    storyboard,
    acceptance,
    timeline,
  }, null, 2)}\n`);

  // Progress for the studio: stage, frames drawn and total.
  const progress = (stage, done, total) => process.stdout.write(`FOLD_PROGRESS ${JSON.stringify({ stage, ...(total ? { done, total } : {}) })}\n`);
  progress('drawing', 0, timeline.totalFrames);
  let shotIndex = 0;
  for (let frameIndex = 0; frameIndex < timeline.totalFrames; frameIndex += 1) {
    while (frameIndex > timeline.shots[shotIndex].endFrame) shotIndex += 1;
    const shot = timeline.shots[shotIndex];
    const frameProgress = (frameIndex - shot.startFrame) / Math.max(1, shot.durationFrames - 1);
    const svg = shot.spec.version === 2
      ? renderTimelineFrame(timeline, frameIndex, brand)
      : renderShotSvg(shot, frameProgress, timeline.width, timeline.height);
    const frameName = `frame-${String(frameIndex).padStart(6, '0')}`;
    const svgPath = path.join(framesDirectory, `${frameName}.svg`);
    const pngPath = path.join(framesDirectory, `${frameName}.png`);
    await writeFile(svgPath, svg);
    const rasterizer = new Resvg(svg, {
      fitTo: { mode: 'width', value: output.width },
      font: fontOptions,
    });
    await writeFile(pngPath, rasterizer.render().asPng());
    // Each rasterizer holds native pixel memory that V8 can't see; collect regularly
    // so a long film doesn't climb toward a small server's memory limit.
    if (frameIndex % 12 === 11) globalThis.gc?.();
    if (frameIndex % 6 === 5 || frameIndex === timeline.totalFrames - 1) progress('drawing', frameIndex + 1, timeline.totalFrames);
  }

  const manifest = generateFrameManifest(framesDirectory);
  await writeFile(path.join(framesDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  progress('scoring');
  // FOLD Score: composed from this timeline, so every hit lands on its cut.
  const scored = music !== 'off';
  let score = null;
  const scorePath = path.join(outputDirectory, 'score.wav');
  if (scored) {
    // FOLD Score 2: real instruments when the pack loads (FOLD_SCORE=synth forces the
    // synth score); if anything is missing, the synth score plays instead.
    let band;
    if (process.env.FOLD_SCORE !== 'synth') {
      try { band = instrumentBand(); } catch (error) { console.warn(`Real instruments unavailable, using the synth score: ${error.message}`); }
    }
    score = composeScore(timeline, {
      mood: scoreMood(music, storyboard),
      text: [storyboard?.title, storyboard?.narrativeConcept, storyboard?.creativeDirection].filter(Boolean).join(' '),
      band,
    });
    masterScore(score, { target: -14, ceiling: -2 });
    await writeFile(scorePath, encodeWav(score));
  }

  const isWindows = process.platform === 'win32';
  const ffmpeg = isWindows ? 'ffmpeg.exe' : 'ffmpeg';
  const ffprobe = isWindows ? 'ffprobe.exe' : 'ffprobe';
  const videoPath = path.join(outputDirectory, 'production.mp4');
  progress('encoding');
  await runCommand(ffmpeg, [
    '-y',
    '-framerate', String(timeline.fps),
    '-i', path.join(framesDirectory, 'frame-%06d.png'),
    ...(scored ? ['-i', scorePath] : []),
    ...(videoFilters(timeline, filmLook(grade, storyboard), output.scale) ? ['-vf', videoFilters(timeline, filmLook(grade, storyboard), output.scale)] : []),
    // The score arrives mastered to -14 LUFS; FFmpeg only encodes it.
    ...(scored ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest'] : []),
    '-c:v', 'libx264',
    // veryfast uses one reference frame and a short lookahead: far less memory and
    // CPU than the default preset, at a quality that holds up for motion graphics.
    '-preset', process.env.RENDER_X264_PRESET || 'veryfast',
    // Above HD, CRF 20 is still visually lossless for motion graphics (more pixels
    // per detail) and keeps 2K files near HD sizes.
    '-crf', String(positiveNumber(process.env.RENDER_X264_CRF, output.scale > 1 ? 20 : 18)),
    // aq-mode 3 spends bits on dark, smooth areas, which keeps dark brand
    // backgrounds and glows from breaking into blocky bands.
    // At Full HD and 2K the encoder's look-ahead, B-frames and macroblock tree hold
    // several full frames each: turned off, memory halves; the CRF quality target is
    // unchanged (files come out larger instead).
    '-x264-params', output.scale > 1 ? 'aq-mode=3:rc-lookahead=0:bframes=0:mbtree=0' : 'aq-mode=3',
    '-threads', String(positiveNumber(process.env.RENDER_FFMPEG_THREADS, 1)),
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    videoPath,
  ]);
  const probe = await runCommand(ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'format=duration:stream=width,height,avg_frame_rate,nb_frames',
    '-of', 'json',
    videoPath,
  ]);
  const metadata = JSON.parse(probe.stdout);
  const stream = metadata.streams?.[0];
  let audioQA = null;
  if (scored) {
    const audioProbe = JSON.parse((await runCommand(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,channels,duration', '-of', 'json', videoPath])).stdout);
    const audioStream = audioProbe.streams?.[0];
    const loudnessRun = await runCommand(ffmpeg, ['-nostats', '-i', videoPath, '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-']).catch((error) => ({ stderr: error.stderr || '' }));
    const summary = String(loudnessRun.stderr || '').split('Summary:').pop();
    const integrated = Number.parseFloat(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
    const truePeak = Number.parseFloat(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);
    const audioDuration = Number.parseFloat(audioStream?.duration ?? 'NaN');
    audioQA = {
      present: { pass: Boolean(audioStream), codec: audioStream?.codec_name, channels: audioStream?.channels },
      duration: { pass: Math.abs(audioDuration - timeline.durationInSeconds) <= 1 / timeline.fps + 0.03, expected: timeline.durationInSeconds, actual: audioDuration },
      loudness: { pass: Number.isFinite(integrated) && Math.abs(integrated + 14) <= 1.5, target: -14, actual: integrated },
      truePeak: { pass: Number.isFinite(truePeak) && truePeak <= -0.5, limit: -0.5, actual: truePeak },
      sync: { pass: score.sync.pass, onTime: score.sync.onTime, checked: score.sync.checked, tolerance: '1 frame' },
    };
    audioQA.pass = Object.values(audioQA).every((check) => check.pass);
  }
  const expectedRate = timeline.fps;
  const actualRate = parseFrameRate(stream?.avg_frame_rate);
  const actualDuration = Number.parseFloat(metadata.format?.duration ?? 'NaN');
  const encodedFrameCount = Number.parseInt(stream?.nb_frames ?? 'NaN', 10);
  const frameIntegrityPass = manifest.totalFrames === timeline.totalFrames * 2
    && manifest.frames.length === timeline.totalFrames * 2
    && encodedFrameCount === timeline.totalFrames
    && manifest.frames.every((frame) => /^[a-f\d]{64}$/i.test(frame.sha256) && frame.sizeBytes > 0);
  // Beat-timed films: every cut and reveal must sit within a frame of the beat grid,
  // and the score must play at the film's tempo.
  const beatSync = timeline.beat ? {
    ...measureBeatSync(beatGrid({ bpm: timeline.beat.bpm, fps: timeline.fps, durationInSeconds: timeline.durationInSeconds }), timelineBeatEvents(timeline)),
    bpm: timeline.beat.bpm,
    ...(score ? { scoreBpm: score.bpm } : {}),
  } : null;
  if (beatSync && score && score.bpm !== timeline.beat.bpm) beatSync.pass = false;
  const productionQA = {
    pass: (beatSync ? beatSync.pass : true) && stream?.width === output.width
      && stream?.height === output.height
      && Math.abs(actualRate - expectedRate) < 0.01
      && Math.abs(actualDuration - timeline.durationInSeconds) <= 1 / timeline.fps
      && frameIntegrityPass
      && (audioQA ? audioQA.pass : true),
    ...(audioQA ? { audio: audioQA } : {}),
    ...(beatSync ? { beatSync } : {}),
    dimensions: {
      pass: stream?.width === output.width && stream?.height === output.height,
      expected: { width: output.width, height: output.height },
      actual: { width: stream?.width, height: stream?.height },
    },
    fps: {
      pass: Math.abs(actualRate - expectedRate) < 0.01,
      expected: expectedRate,
      actual: actualRate,
    },
    frameIntegrity: {
      pass: frameIntegrityPass,
      expectedFrames: timeline.totalFrames,
      encodedVideoFrames: encodedFrameCount,
      hashedFrameFiles: manifest.totalFrames,
    },
    duration: {
      pass: Number.isFinite(actualDuration)
        && Math.abs(actualDuration - timeline.durationInSeconds) <= 1 / timeline.fps,
      expected: timeline.durationInSeconds,
      actual: actualDuration,
    },
  };
  // A silent copy of a scored film, labelled with its tempo, for creators who add
  // platform music: the picture is copied, not re-encoded, so it is identical.
  let silentExport = null;
  if (scored) {
    await runCommand(ffmpeg, ['-y', '-loglevel', 'error', '-i', videoPath, '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', path.join(outputDirectory, 'production-silent.mp4')]);
    silentExport = { file: 'production-silent.mp4', bpm: score.bpm, label: `${score.bpm} BPM` };
  }
  const creativeQA = evaluateCreativeQA(timeline, context);
  const baseUrl = `/output/${projectId}/${runId}`;
  const report = {
    schemaVersion: '1.0',
    projectId,
    runId,
    verified: true,
    renderedAt: new Date().toISOString(),
    renderer: 'resvg + ffmpeg',
    productionQA,
    creativeQA,
    ...(score ? { audio: { engine: 'FOLD Score', instruments: score.engine === 'instruments', mood: score.mood, label: score.label, bpm: score.bpm, key: score.key, cues: score.cues.length } } : { audio: { engine: 'none' } }),
    ...(silentExport ? { silentExport } : {}),
    look: filmLook(grade, storyboard),
    output: { resolution: output.key, label: output.label, width: output.width, height: output.height },
    photoColor: original ? 'original' : 'palette',
    videoMetadata: metadata,
    artifacts: {
      video: `${baseUrl}/production.mp4`,
      ...(silentExport ? { silentVideo: `${baseUrl}/production-silent.mp4` } : {}),
      timeline: `${baseUrl}/timeline.json`,
      storyboard: `${baseUrl}/storyboard.json`,
      acceptance: `${baseUrl}/acceptance.json`,
      source: `${baseUrl}/source-project.json`,
      qa: `${baseUrl}/production-qa.json`,
      frameManifest: `${baseUrl}/frames/manifest.json`,
    },
  };
  const reportPath = path.join(outputDirectory, 'production-qa.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { report, reportPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputIndex = process.argv.indexOf('--input');
  const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : undefined;
  if (!inputPath) {
    throw new Error('Usage: npm run render -- --input <render-request.json>');
  }
  const { readFile } = await import('node:fs/promises');
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  const result = await renderProductionProject(input);
  console.log(`RENDER_REPORT:${result.reportPath}`);
  console.log(JSON.stringify(result.report));
}
