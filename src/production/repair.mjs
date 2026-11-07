import { contrastRatio, MIN_TEXT_CONTRAST, readableTextColor } from './color.mjs';
import { fallbackMotion, normalizeMotion } from './motion.mjs';

/**
 * Repair layer for AI output.
 *
 * FOLD Motion's rule: AI ingredients, deterministic execution. The model proposes
 * the creative content; this module enforces everything that must be exact
 * (format, timing, brand colors, on-screen copy) before validation runs.
 *
 * Both functions are pure: they never mutate their input and never throw.
 * Every change is reported in `repairs` so the studio can show what was fixed.
 */

const HEX6 = /^#[\da-f]{6}$/i;
const HEX3 = /^#[\da-f]{3}$/i;
const NAMED_COLORS = Object.freeze({
  white: '#FFFFFF',
  black: '#000000',
  red: '#FF0000',
  green: '#00FF00',
  blue: '#0000FF',
  yellow: '#FFFF00',
  cyan: '#00FFFF',
  magenta: '#FF00FF',
  gray: '#808080',
  grey: '#808080',
});
const TYPE_ALIASES = Object.freeze({
  rect: 'rect',
  rectangle: 'rect',
  box: 'rect',
  background: 'rect',
  bg: 'rect',
  shape: 'rect',
  line: 'rect',
  bar: 'rect',
  circle: 'circle',
  dot: 'circle',
  ellipse: 'circle',
  text: 'text',
  title: 'text',
  headline: 'text',
  subheadline: 'text',
  caption: 'text',
  label: 'text',
  copy: 'text',
});
const ANCHOR_ALIASES = Object.freeze({
  start: 'start',
  left: 'start',
  middle: 'middle',
  center: 'middle',
  centre: 'middle',
  centered: 'middle',
  end: 'end',
  right: 'end',
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function rgbToHex(value) {
  const match = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(value);
  if (!match) return undefined;
  const channels = match.slice(1, 4).map((channel) => Math.min(255, Number(channel)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export function normalizeHexColor(value) {
  if (typeof value !== 'string') return undefined;
  const color = value.trim();
  if (HEX6.test(color)) return color;
  if (HEX3.test(color)) return `#${[...color.slice(1)].map((digit) => digit + digit).join('')}`.toUpperCase();
  if (/^#[\da-f]{8}$/i.test(color)) return color.slice(0, 7);
  return NAMED_COLORS[color.toLowerCase()] || rgbToHex(color);
}

function sameColor(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

function looseCopy(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Fills gaps in a model-generated storyboard so it passes validateStoryboard().
 * Creative fields the model omitted get neutral, clearly-generic defaults.
 */
export function repairStoryboard(storyboard, context = {}) {
  const repairs = [];
  if (!isObject(storyboard)) return { storyboard, repairs };

  const board = { ...storyboard };
  const fallbackTitle = nonEmpty(context.headline) || 'FOLD Motion production';
  const stringDefaults = {
    id: () => `storyboard-${Date.now()}`,
    title: () => fallbackTitle,
    audience: () => 'Audience defined in the brief.',
    platform: () => `${context.width || 1280} × ${context.height || 720}, ${context.fps || 24} fps`,
    narrativeConcept: () => nonEmpty(board.title) || fallbackTitle,
    creativeDirection: () => 'Clear, high-contrast motion that carries the message.',
  };
  for (const [key, makeDefault] of Object.entries(stringDefaults)) {
    if (!nonEmpty(board[key])) {
      board[key] = makeDefault();
      repairs.push(`Storyboard was missing "${key}"; filled a default.`);
    }
  }

  if (!Array.isArray(board.shots)) {
    // Nothing safe to invent here; validation will report it.
    return { storyboard: board, repairs };
  }

  const usedIds = new Set();
  board.shots = board.shots.filter(isObject).map((original, index) => {
    const shot = { ...original };
    const label = `Shot ${index + 1}`;
    let id = nonEmpty(shot.id);
    if (!id || usedIds.has(id)) {
      id = `shot-${String(index + 1).padStart(2, '0')}`;
      repairs.push(`${label} had a missing or duplicate id; renamed it to ${id}.`);
    }
    usedIds.add(id);
    shot.id = id;

    const duration = toNumber(shot.durationSeconds);
    if (duration === undefined || duration <= 0) {
      shot.durationSeconds = 3;
      repairs.push(`${label} had no valid duration; set it to 3 seconds.`);
    } else if (duration !== shot.durationSeconds) {
      shot.durationSeconds = duration;
    }

    const shotDefaults = {
      purpose: 'Carry the message forward.',
      onScreenCopy: nonEmpty(context.headline) || board.title,
      mainVisual: 'Typography on the brand background.',
      composition: 'Centered with generous negative space.',
      cameraBehavior: 'Locked off.',
      motionBehavior: 'Copy eases in and holds.',
      transitionIn: 'Cut in.',
      transitionOut: 'Cut out.',
    };
    for (const [key, fallback] of Object.entries(shotDefaults)) {
      if (!nonEmpty(shot[key])) {
        shot[key] = fallback;
        repairs.push(`${label} was missing "${key}"; filled a default.`);
      }
    }
    if (typeof shot.acceptanceCriteria === 'string' && shot.acceptanceCriteria.trim()) {
      shot.acceptanceCriteria = [shot.acceptanceCriteria.trim()];
    }
    if (!Array.isArray(shot.acceptanceCriteria) || !shot.acceptanceCriteria.some(nonEmpty)) {
      shot.acceptanceCriteria = ['On-screen copy is legible for the full shot.'];
      repairs.push(`${label} had no acceptance criteria; added a legibility check.`);
    } else {
      shot.acceptanceCriteria = shot.acceptanceCriteria.filter(nonEmpty);
    }
    return shot;
  });

  if (!Array.isArray(board.hardConstraints) || !board.hardConstraints.some(nonEmpty)) {
    board.hardConstraints = ['Preserve the supplied brief and exact on-screen copy.'];
    repairs.push('Storyboard had no hard constraints; added copy preservation.');
  } else {
    board.hardConstraints = board.hardConstraints.filter(nonEmpty);
  }

  const criteria = isObject(board.acceptanceCriteria) ? { ...board.acceptanceCriteria } : {};
  for (const [key, fallback] of [
    ['technical', `Output is ${context.width || 1280} × ${context.height || 720} at ${context.fps || 24} fps.`],
    ['creative', 'On-screen copy is legible against its background.'],
  ]) {
    if (!Array.isArray(criteria[key]) || !criteria[key].some(nonEmpty)) {
      criteria[key] = [fallback];
      repairs.push(`Storyboard had no ${key} acceptance criteria; added a default.`);
    } else {
      criteria[key] = criteria[key].filter(nonEmpty);
    }
  }
  board.acceptanceCriteria = criteria;

  return { storyboard: board, repairs };
}

/**
 * Brings one model-generated scene specification in line with the rules that
 * buildTimeline() enforces. Format, timing, background, copy and accent are
 * owned by the system; everything else is kept from the model where possible.
 */
export function repairShotSpec(spec, shot, index, context, seed = '') {
  const repairs = [];
  const label = shot?.id || `Shot ${index + 1}`;
  const note = (message) => repairs.push(`${label}: ${message}`);
  const { width, height, fps, primaryColor, accentColor } = context;
  const textFill = readableTextColor(primaryColor);
  const source = isObject(spec) ? spec : {};
  if (!isObject(spec)) note('model returned no scene; built it from the storyboard.');

  const repaired = {
    ...source,
    id: nonEmpty(source.id) || `${shot.id}-scene`,
    title: nonEmpty(source.title) || String(shot.onScreenCopy).slice(0, 64),
    width,
    height,
    fps,
    durationInSeconds: shot.durationSeconds,
  };
  if (source.width !== width || source.height !== height || source.fps !== fps) {
    note(`format set to ${width} × ${height} at ${fps} fps.`);
  }
  if (toNumber(source.durationInSeconds) !== shot.durationSeconds) {
    note(`duration set to the storyboard's ${shot.durationSeconds}s.`);
  }

  const usedIds = new Set();
  const uniqueId = (candidate, fallback) => {
    let id = nonEmpty(candidate) || fallback;
    let suffix = 2;
    while (usedIds.has(id)) id = `${nonEmpty(candidate) || fallback}-${suffix++}`;
    usedIds.add(id);
    return id;
  };

  const dropped = new Map();
  const elements = [];
  for (const [elementIndex, raw] of (Array.isArray(source.elements) ? source.elements : []).entries()) {
    if (!isObject(raw)) continue;
    const typeName = String(raw.type || '').trim().toLowerCase();
    const type = TYPE_ALIASES[typeName];
    if (!type) {
      dropped.set(typeName || 'untyped', (dropped.get(typeName || 'untyped') || 0) + 1);
      continue;
    }
    const element = { ...raw, type };
    if (typeName !== type) note(`element type "${typeName}" treated as "${type}".`);

    const coerced = [];
    for (const key of ['x', 'y', 'width', 'height', 'radius', 'fontSize']) {
      if (element[key] !== undefined) {
        const number = toNumber(element[key]);
        if (number === undefined) delete element[key];
        else {
          if (number !== element[key]) coerced.push(key);
          element[key] = number;
        }
      }
    }
    if (coerced.length) note(`element "${raw.id || elementIndex}" had ${coerced.join(', ')} written as text; converted to numbers.`);

    const fill = normalizeHexColor(element.fill);
    if (!fill) {
      element.fill = type === 'text' ? textFill : accentColor;
      note(`element "${raw.id || elementIndex}" had an unusable color; set to ${element.fill}.`);
    } else {
      if (fill !== element.fill) note(`color "${element.fill}" written as ${fill}.`);
      element.fill = fill;
    }

    if (type === 'rect') {
      const before = [element.x, element.y, element.width, element.height];
      const x = element.x ?? 0;
      const y = element.y ?? 0;
      const left = Math.max(0, x);
      const top = Math.max(0, y);
      const right = Math.min(width, x + (element.width ?? width));
      const bottom = Math.min(height, y + (element.height ?? height));
      if (right - left <= 0 || bottom - top <= 0) {
        note(`rect "${raw.id || elementIndex}" was entirely off-canvas; removed.`);
        continue;
      }
      const after = [left, top, right - left, bottom - top];
      if (before.some((value, position) => value !== undefined && value !== after[position])) {
        note(`rect "${raw.id || elementIndex}" trimmed to the canvas.`);
      }
      [element.x, element.y, element.width, element.height] = after;
    }

    if (type === 'circle') {
      element.x = Math.min(width, Math.max(0, element.x ?? width / 2));
      element.y = Math.min(height, Math.max(0, element.y ?? height / 2));
      if (!(element.radius > 0)) element.radius = 12;
    }

    if (type === 'text') {
      const content = typeof element.content === 'string' ? element.content.trim()
        : typeof element.text === 'string' ? element.text.trim() : '';
      if (!content) continue;
      element.content = content;
      delete element.text;
      const anchor = ANCHOR_ALIASES[String(element.anchor ?? 'middle').trim().toLowerCase()];
      if (!anchor) note(`text anchor "${element.anchor}" set to "middle".`);
      else if (element.anchor !== undefined && anchor !== element.anchor) note(`text anchor "${element.anchor}" written as "${anchor}".`);
      element.anchor = anchor || 'middle';
      element.x = Math.min(width, Math.max(0, element.x ?? width / 2));
      element.y = Math.min(height, Math.max(0, element.y ?? height / 2));
      if (!(element.fontSize >= 16)) {
        if (element.fontSize !== undefined) note(`font size ${element.fontSize} raised to 16.`);
        element.fontSize = element.fontSize === undefined ? Math.max(32, Math.round(height * 0.067)) : 16;
      }
    }

    element.id = uniqueId(raw.id, `shot-${index + 1}-element-${elementIndex + 1}`);
    elements.push(element);
  }
  for (const [typeName, count] of dropped) {
    note(`removed ${count} unsupported "${typeName}" element${count === 1 ? '' : 's'}.`);
  }

  // Background: the first full-canvas rect becomes the brand background, drawn first.
  const backgroundIndex = elements.findIndex((element) => (
    element.type === 'rect' && element.x === 0 && element.y === 0 && element.width === width && element.height === height
  ));
  if (backgroundIndex === -1) {
    elements.unshift({
      id: uniqueId(`shot-${index + 1}-background`, `shot-${index + 1}-background`),
      type: 'rect', x: 0, y: 0, width, height, fill: primaryColor,
    });
    note(`added a full-canvas background in ${primaryColor}.`);
  } else {
    const [background] = elements.splice(backgroundIndex, 1);
    if (!sameColor(background.fill, primaryColor)) {
      note(`background color ${background.fill} set to the brand primary ${primaryColor}.`);
      background.fill = primaryColor;
    }
    // The renderer keeps only "*-background" rects fully opaque; any other id fades in and flashes dark.
    if (!background.id.endsWith('-background')) {
      const renamed = uniqueId(`shot-${index + 1}-background`, `shot-${index + 1}-background`);
      note(`background id "${background.id}" renamed to "${renamed}" so it stays opaque while the shot fades in.`);
      background.id = renamed;
    }
    elements.unshift(background);
  }

  // Legibility: every text element must clear creative QA's contrast bar on the brand background.
  for (const element of elements) {
    if (element.type !== 'text') continue;
    const ratio = contrastRatio(element.fill, primaryColor);
    if (ratio === null || ratio < MIN_TEXT_CONTRAST) {
      note(`text "${element.id}" had ${ratio ? `${ratio.toFixed(1)}:1` : 'no'} contrast on ${primaryColor}; set to ${textFill}.`);
      element.fill = textFill;
    }
  }

  // On-screen copy: exact text, owned by the storyboard.
  const copy = shot.onScreenCopy;
  if (!elements.some((element) => element.type === 'text' && element.content === copy)) {
    const close = elements.find((element) => element.type === 'text' && looseCopy(element.content) === looseCopy(copy));
    if (close) {
      note(`on-screen copy "${close.content}" restored to the approved "${copy}".`);
      close.content = copy;
    } else {
      elements.push({
        id: uniqueId(`shot-${index + 1}-copy`, `shot-${index + 1}-copy`),
        type: 'text', content: copy, x: width / 2, y: height / 2,
        fill: textFill, fontSize: Math.max(32, Math.round(height * 0.067)), anchor: 'middle',
      });
      note('approved on-screen copy was missing; added it centered.');
    }
  }

  // Accent: at least one element in the brand accent color.
  if (!elements.some((element) => sameColor(element.fill, accentColor))) {
    elements.push({
      id: uniqueId(`shot-${index + 1}-accent`, `shot-${index + 1}-accent`),
      type: 'rect',
      x: Math.round(width * 0.12),
      y: Math.round(height * 0.69),
      width: Math.round(width * 0.28),
      height: Math.max(4, Math.round(height * 0.006)),
      fill: accentColor,
    });
    note(`added an accent rule in ${accentColor}.`);
  }

  // Motion: the model's choices, cleaned up. A missing choice gets a deterministic
  // pick rather than the old one-size-fits-all default.
  if (source.motion === undefined) {
    repaired.motion = fallbackMotion(seed, index);
    note(`no motion chosen; picked camera "${repaired.motion.camera}", entrance "${repaired.motion.entrance}", atmosphere "${repaired.motion.atmosphere}".`);
  } else {
    const { motion, changes } = normalizeMotion(source.motion);
    repaired.motion = motion;
    for (const change of changes) note(`motion ${change}.`);
  }

  repaired.elements = elements;
  return { spec: repaired, repairs };
}
