import { validateSceneSpec } from '../../scripts/qa/validate-scene-spec.mjs';
import { repairShotSpec, repairStoryboard } from './repair.mjs';
import { contrastRatio, readableTextColor } from './color.mjs';
import { fallbackMotion, isValidMotion, normalizeMotion } from './motion.mjs';
import { ensureProductShot, expandRecipe, fallbackDirection, limitFolds, normalizeDirection, RECIPES_WITH_SUPPORT } from './recipes.mjs';
import { beatsFromBrief, durationFromBrief } from '../../public/brief-length.mjs';
import { normalizeLogoMeta, normalizeProductsMeta } from './brand-assets.mjs';

export { durationFromBrief };

const DEFAULTS = Object.freeze({
  width: 1280,
  height: 720,
  fps: 24,
  durationInSeconds: 8,
  primaryColor: '#0B0F19',
  accentColor: '#00F0FF',
});

function validString(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function safeSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'fold-motion';
}

function isRenderableElement(element, context) {
  const hasColor = typeof element.fill === 'string' && /^#[\da-f]{6}$/i.test(element.fill);
  if (element.type === 'rect') {
    return hasColor
      && Number.isFinite(element.x)
      && Number.isFinite(element.y)
      && Number.isFinite(element.width)
      && Number.isFinite(element.height)
      && element.x >= 0
      && element.y >= 0
      && element.width > 0
      && element.height > 0
      && element.x + element.width <= context.width
      && element.y + element.height <= context.height;
  }
  if (element.type === 'circle') {
    return hasColor
      && Number.isFinite(element.x)
      && Number.isFinite(element.y)
      && Number.isFinite(element.radius ?? 12)
      && (element.radius ?? 12) > 0
      && element.x >= 0
      && element.y >= 0
      && element.x <= context.width
      && element.y <= context.height;
  }
  if (element.type === 'image') {
    return Number.isInteger(element.product) && element.product >= 1
      && [element.x, element.y, element.width, element.height].every(Number.isFinite)
      && element.width > 0 && element.height > 0
      && element.x >= -0.5 && element.y >= -0.5
      && element.x + element.width <= context.width + 0.5 && element.y + element.height <= context.height + 0.5;
  }
  if (element.type === 'logo') {
    return (element.kind === 'svg' || element.kind === 'png')
      && [element.x, element.y, element.width, element.height].every(Number.isFinite)
      && element.width > 0 && element.height > 0
      && element.x - element.width / 2 >= 0 && element.x + element.width / 2 <= context.width
      && element.y - element.height / 2 >= 0 && element.y + element.height / 2 <= context.height;
  }
  if (element.type === 'line') {
    return hasColor
      && Number.isFinite(element.x)
      && Number.isFinite(element.y)
      && Number.isFinite(element.width)
      && Number.isFinite(element.height)
      && element.width > 0
      && element.height > 0
      && element.x >= 0
      && element.y >= 0
      && element.x + (element.reveal?.from === 'left' ? element.width : element.width / 2) <= context.width
      && element.y <= context.height;
  }
  if (element.type === 'text') {
    return hasColor
      && validString(element.content)
      && Number.isFinite(element.x)
      && Number.isFinite(element.y)
      && Number.isFinite(element.fontSize)
      && element.fontSize >= 16
      && element.x >= 0
      && element.y >= 0
      && element.x <= context.width
      && element.y <= context.height
      && ['start', 'middle', 'end', undefined].includes(element.anchor);
  }
  return false;
}

export function normalizeProductionContext(context = {}) {
  const normalized = { ...DEFAULTS, ...context };
  for (const key of ['width', 'height', 'fps', 'durationInSeconds']) {
    if (!Number.isFinite(normalized[key]) || normalized[key] <= 0) {
      normalized[key] = DEFAULTS[key];
    }
  }
  for (const key of ['primaryColor', 'accentColor']) {
    if (typeof normalized[key] !== 'string' || !/^#[\da-f]{6}$/i.test(normalized[key])) {
      normalized[key] = DEFAULTS[key];
    }
  }
  for (const key of ['headline', 'subheadline']) {
    if (typeof normalized[key] !== 'string') normalized[key] = '';
    normalized[key] = normalized[key].trim();
  }
  // Only logo metadata travels with planning; the logo itself comes with the render.
  const logo = normalizeLogoMeta(normalized.logo);
  if (logo) normalized.logo = logo;
  else delete normalized.logo;
  const products = normalizeProductsMeta(normalized.products);
  if (products) normalized.products = products;
  else delete normalized.products;
  return normalized;
}

/**
 * Splits a brief into readable on-screen copy for the offline fallback: the first
 * clause becomes the headline, the rest the subheadline, never cutting a word.
 */
const BRIEF_LABEL = /^\s*(?:[•*\-–]\s*)?(?:visual|visuals|audio|sound|music|sfx|vo|voice-?over|on[-\s]?screen\s+text|text\s+on\s+screen|super|camera)\s*:/i;
const TIMECODE_RANGE = /\d{1,2}:[0-5]\d(?:\.\d)?\s*(?:-|–|—|to)\s*\d{1,2}:[0-5]\d(?:\.\d)?/g;

/**
 * The lines under an "On-Screen Text:" heading, if the brief has one, the way
 * editors write briefs. Stops at the next labelled section, timecode or bullet.
 */
export function onScreenTextFromBrief(prompt) {
  const lines = String(prompt || '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*(?:[•*\-–]\s*)?(?:on[-\s]?screen\s+text|text\s+on\s+screen|super)\s*:/i.test(line));
  if (start < 0) return [];
  const sameLine = lines[start].replace(/^.*?:\s*/, '').trim();
  const out = sameLine ? [sameLine] : [];
  for (const line of lines.slice(start + 1)) {
    const text = line.trim();
    if (!text) { if (out.length) break; continue; }
    if (BRIEF_LABEL.test(text) || /^\s*[•*]/.test(text) || TIMECODE_RANGE.test(text)) break;
    TIMECODE_RANGE.lastIndex = 0;
    out.push(text.replace(/^["“]|["”]$/g, ''));
  }
  TIMECODE_RANGE.lastIndex = 0;
  return out.slice(0, 3);
}

/** Brief text without timecodes, section labels, bullets or separators. */
function cleanBriefText(prompt) {
  return String(prompt || '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:[•*\-–]\s*)?(?:audio|sound|music|sfx)\s*:/i.test(line))
    .join(' ')
    .replace(TIMECODE_RANGE, ' ')
    .replace(/(?:^|\s)[•*|](?=\s)/g, ' ')
    .replace(/\b(?:visuals?|on[-\s]?screen\s+text|text\s+on\s+screen|camera|super)\s*:/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitBriefCopy(prompt, maxHeadline = 54) {
  const onScreen = onScreenTextFromBrief(prompt);
  if (onScreen.length) return { headline: onScreen[0], subheadline: onScreen.slice(1).join(' ') };
  const text = cleanBriefText(prompt);
  const clause = text.match(/^(.{3,}?)[:.!?;—–]\s+(.+)$/);
  let headline = clause && clause[1].length <= maxHeadline ? clause[1] : '';
  if (!headline) {
    const words = text.replace(/[.!?]+$/, '').split(' ');
    for (const word of words) {
      const next = headline ? `${headline} ${word}` : word;
      if (next.length > maxHeadline) break;
      headline = next;
    }
    if (!headline) headline = text.slice(0, maxHeadline);
  }
  headline = headline.replace(/[,;:—–\s]+$/, '');
  const rest = text.slice(text.indexOf(headline) + headline.length).replace(/^[\s,.:;!?—–-]+/, '').trim();
  const subheadline = rest.length > 100 ? `${rest.slice(0, 100).replace(/\s+\S*$/, '')}…` : rest;
  return { headline, subheadline };
}

export function buildMockStoryboard(prompt, context = {}) {
  if (!validString(prompt)) {
    throw new Error('A valid text prompt is required to create a storyboard.');
  }
  const normalizedContext = normalizeProductionContext(context);
  const derived = splitBriefCopy(prompt);
  const headline = normalizedContext.headline || derived.headline;
  const subheadline = normalizedContext.subheadline || derived.subheadline;
  const shots = [
    {
      id: 'shot-01',
      purpose: 'Establish the visual world and create anticipation.',
      durationSeconds: 3,
      onScreenCopy: headline || subheadline,
      mainVisual: 'The supporting line set large on the brand background, with the accent glow and rings on the right.',
      composition: 'Centered focal point with generous negative space.',
      cameraBehavior: 'Locked off.',
      motionBehavior: 'Copy fades up and rises with a short glitch, the accent bar draws on, then everything holds.',
      transitionIn: 'Opens on the brand background as the copy fades up.',
      transitionOut: 'Cut to the next shot.',
      acceptanceCriteria: ['The opening reads clearly without competing elements.'],
    },
    {
      id: 'shot-02',
      purpose: 'Deliver the central message with a clear visual hierarchy.',
      durationSeconds: 3,
      onScreenCopy: headline || 'MAKE IT MOVE',
      mainVisual: 'The headline at full size, underlined by the accent bar.',
      composition: 'Headline occupies the central safe area; supporting detail remains subordinate.',
      cameraBehavior: 'Locked off.',
      motionBehavior: 'Headline rises in with a short glitch and settles into a stable hold.',
      transitionIn: 'Cut in.',
      transitionOut: 'Cut to the closing shot.',
      acceptanceCriteria: ['The exact headline remains readable and dominant.'],
    },
    {
      id: 'shot-03',
      purpose: 'Resolve the idea and leave the viewer with a memorable finish.',
      durationSeconds: 2,
      onScreenCopy: subheadline || headline,
      mainVisual: 'The closing line centered on a calm, high-contrast field.',
      composition: 'Centered lockup with a clear ending hold.',
      cameraBehavior: 'Locked off; holds through the final frame.',
      motionBehavior: 'Copy fades up, the accent bar draws on, and the frame holds to the end.',
      transitionIn: 'Cut in.',
      transitionOut: 'Ends on a stable hold with no fade or blank frame.',
      acceptanceCriteria: ['The final message is visible on the last frame.'],
    },
  ];

  return {
    id: `storyboard-${safeSlug(headline)}`,
    title: headline || 'FOLD Motion Production',
    audience: 'Audience identified from the supplied brief; confirm during review.',
    platform: `${normalizedContext.width} × ${normalizedContext.height}, ${normalizedContext.fps} fps`,
    narrativeConcept: `A concise three-beat motion story that turns “${headline || 'the brief'}” into a clear visual message.`,
    creativeDirection: 'Code-first, high-contrast motion with deliberate pacing, restrained geometry, and typography that carries the message.',
    shots,
    hardConstraints: [
      'Preserve the supplied brief and exact on-screen copy.',
      `Render at ${normalizedContext.width} × ${normalizedContext.height} and ${normalizedContext.fps} fps.`,
      'Keep all essential copy within the visible canvas.',
    ],
    acceptanceCriteria: {
      technical: [
        `Output dimensions are ${normalizedContext.width} × ${normalizedContext.height}.`,
        `Output frame rate is ${normalizedContext.fps} fps.`,
        'Every expected frame is present and has a valid SHA-256 hash.',
      ],
      creative: [
        'Each shot serves a distinct narrative purpose.',
        'On-screen copy is legible against its background.',
        'Primary and accent brand colors appear in the compiled shots.',
      ],
    },
  };
}

export function validateStoryboard(storyboard) {
  const errors = [];
  if (!storyboard || typeof storyboard !== 'object' || Array.isArray(storyboard)) {
    return { valid: false, errors: ['Storyboard must be a JSON object.'] };
  }
  for (const key of ['id', 'title', 'narrativeConcept', 'creativeDirection', 'audience', 'platform']) {
    if (!validString(storyboard[key])) errors.push(`Storyboard "${key}" must be a non-empty string.`);
  }
  if (!Array.isArray(storyboard.shots) || storyboard.shots.length < 1) {
    errors.push('Storyboard must contain at least one shot.');
  } else {
    const ids = new Set();
    storyboard.shots.forEach((shot, index) => {
      if (!shot || typeof shot !== 'object' || Array.isArray(shot)) {
        errors.push(`Storyboard shot ${index + 1} must be an object.`);
        return;
      }
      if (!validString(shot.id) || ids.has(shot.id)) {
        errors.push(`Storyboard shot ${index + 1} must have a unique non-empty id.`);
      } else {
        ids.add(shot.id);
      }
      for (const key of [
        'purpose', 'onScreenCopy', 'mainVisual', 'composition', 'cameraBehavior',
        'motionBehavior', 'transitionIn', 'transitionOut',
      ]) {
        if (!validString(shot[key])) errors.push(`Storyboard shot ${shot.id || index + 1} needs "${key}".`);
      }
      if (!Number.isFinite(shot.durationSeconds) || shot.durationSeconds <= 0) {
        errors.push(`Storyboard shot ${shot.id || index + 1} needs a positive durationSeconds.`);
      }
      if (!Array.isArray(shot.acceptanceCriteria) || shot.acceptanceCriteria.length === 0) {
        errors.push(`Storyboard shot ${shot.id || index + 1} needs acceptance criteria.`);
      }
    });
  }
  if (
    !Array.isArray(storyboard.hardConstraints)
    || storyboard.hardConstraints.length === 0
    || !storyboard.hardConstraints.every(validString)
  ) {
    errors.push('Storyboard must include hard constraints.');
  }
  if (
    !storyboard.acceptanceCriteria
    || !Array.isArray(storyboard.acceptanceCriteria.technical)
    || storyboard.acceptanceCriteria.technical.length === 0
    || !storyboard.acceptanceCriteria.technical.every(validString)
    || !Array.isArray(storyboard.acceptanceCriteria.creative)
    || storyboard.acceptanceCriteria.creative.length === 0
    || !storyboard.acceptanceCriteria.creative.every(validString)
  ) {
    errors.push('Storyboard must include technical and creative acceptance criteria.');
  }
  return { valid: errors.length === 0, errors };
}

export function buildAcceptanceSpec(storyboard, context = {}) {
  const normalizedContext = normalizeProductionContext(context);
  return {
    schemaVersion: '1.0',
    mandatoryContent: storyboard.shots.map(({ id, onScreenCopy }) => ({ shotId: id, copy: onScreenCopy })),
    forbiddenContent: [],
    visualDirection: storyboard.creativeDirection,
    technicalRequirements: {
      width: normalizedContext.width,
      height: normalizedContext.height,
      fps: normalizedContext.fps,
      durationInSeconds: storyboard.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0),
    },
    shotCriteria: storyboard.shots.map(({ id, acceptanceCriteria }) => ({
      shotId: id,
      criteria: acceptanceCriteria,
    })),
    creativeCriteria: storyboard.acceptanceCriteria.creative,
  };
}

function makeShotSpec(storyboardShot, index, context, seed = '', count = 1) {
  return {
    version: 2,
    id: `${safeSlug(storyboardShot.id)}-scene`,
    title: storyboardShot.onScreenCopy.slice(0, 64),
    width: context.width,
    height: context.height,
    fps: context.fps,
    durationInSeconds: storyboardShot.durationSeconds,
    promptSource: storyboardShot.purpose,
    motion: fallbackMotion(seed, index),
    ...fallbackDirection(seed, index, count, storyboardShot.onScreenCopy, context.products?.length || 0),
    elements: [],
  };
}

/**
 * A kicker written into the storyboard (from the brief's On-Screen Text) is exact
 * copy: it replaces the model's kicker, keeps its own capitalization, and the
 * final shot becomes an end card. Longer text rides as the supporting line.
 */
function applyExactKicker(direction, shot, index, count) {
  const exact = typeof shot.kicker === 'string' ? shot.kicker.trim() : '';
  if (!exact) return;
  if (exact.length <= 40) {
    direction.kicker = exact;
    direction.kickerExact = true;
  } else {
    direction.kicker = '';
    direction.supportExact = exact;
  }
  if (index === count - 1) direction.recipe = 'lockup';
}

/** A model scene that carries raw elements and no recipe is a legacy (v1) scene. */
function isLegacyScene(raw) {
  return Boolean(raw) && typeof raw === 'object' && Array.isArray(raw.elements) && raw.elements.length > 0 && raw.recipe === undefined;
}

/** Turns the model's direction for one shot into a v2 spec, listing what was repaired. */
function directedShotSpec(raw, shot, index, count, context, seed) {
  const label = shot.id;
  const repairs = [];
  const { direction, changes } = normalizeDirection(raw, { copy: shot.onScreenCopy, index, count, seed, hasLogo: Boolean(context.logo), productCount: context.products?.length || 0 });
  repairs.push(...changes.map((change) => `${label}: ${change}.`));
  let motion;
  if (raw?.motion === undefined) {
    motion = fallbackMotion(seed, index);
    repairs.push(`${label}: no motion chosen; picked camera "${motion.camera}" and atmosphere "${motion.atmosphere}".`);
  } else {
    const normalized = normalizeMotion(raw.motion);
    motion = normalized.motion;
    repairs.push(...normalized.changes.map((change) => `${label}: motion ${change}.`));
  }
  applyExactKicker(direction, shot, index, count);
  return {
    spec: {
      version: 2,
      id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : `${safeSlug(shot.id)}-scene`,
      title: typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 64) : shot.onScreenCopy.slice(0, 64),
      width: context.width,
      height: context.height,
      fps: context.fps,
      durationInSeconds: shot.durationSeconds,
      motion,
      ...direction,
      elements: [],
    },
    repairs,
  };
}

export function buildTimeline(storyboard, shotSpecs, context = {}) {
  const normalizedContext = normalizeProductionContext(context);
  if (!Array.isArray(shotSpecs) || shotSpecs.length !== storyboard.shots.length) {
    throw new Error('Compiled shot specifications must match the storyboard shot count.');
  }
  let cursor = 0;
  const shots = storyboard.shots.map((shot, index) => {
    let sourceSpec = shotSpecs[index];
    const isV2 = sourceSpec?.version === 2;
    const isLast = index === storyboard.shots.length - 1;
    if (isV2) {
      // v2: the recipe lays the copy out; the subheadline rides on the final shot.
      const support = isLast && normalizedContext.subheadline && shot.onScreenCopy !== normalizedContext.subheadline
        ? normalizedContext.subheadline : (sourceSpec.supportExact || '');
      const recipe = support && !RECIPES_WITH_SUPPORT.includes(sourceSpec.recipe) ? 'lockup' : sourceSpec.recipe;
      const expanded = { ...sourceSpec, recipe, durationInSeconds: shot.durationSeconds };
      const productOrdinal = shotSpecs.slice(0, index).filter((spec) => spec?.recipe === 'product-hero').length;
      sourceSpec = {
        ...expanded,
        elements: expandRecipe(expanded, { copy: shot.onScreenCopy, context: normalizedContext, shotIndex: index, support, productOrdinal }),
      };
    }
    const validation = validateSceneSpec(sourceSpec);
    if (!validation.valid) {
      throw new Error(`Compiled shot "${shot.id}" is invalid: ${validation.errors.join(' ')}`);
    }
    const spec = { ...sourceSpec, elements: [...sourceSpec.elements] };
    const expectedDurationFrames = Math.round(shot.durationSeconds * normalizedContext.fps);
    const hasFullBackground = spec.elements.some((element) => (
      element.type === 'rect'
      && element.x === 0
      && element.y === 0
      && element.width === normalizedContext.width
      && element.height === normalizedContext.height
      && element.fill?.toLowerCase() === normalizedContext.primaryColor.toLowerCase()
    ));
    const preservesCopy = spec.elements.some((element) => (
      element.type === 'text' && element.content === shot.onScreenCopy
    ));
    if (!isV2 && normalizedContext.subheadline && !spec.elements.some((element) => (
      element.type === 'text' && element.content === normalizedContext.subheadline
    ))) {
      spec.elements.push({
        id: `shot-${index + 1}-subheadline`,
        type: 'text',
        content: normalizedContext.subheadline,
        x: normalizedContext.width / 2,
        y: normalizedContext.height * 0.61,
        fill: readableTextColor(normalizedContext.primaryColor),
        fontSize: Math.max(16, Math.round(normalizedContext.height * 0.027)),
        anchor: 'middle',
      });
    }
    const preservesSubheadline = !normalizedContext.subheadline || (isV2 && !isLast) || spec.elements.some((element) => (
      element.type === 'text' && element.content === normalizedContext.subheadline
    ));
    const hasRenderableElements = spec.elements.every((element) => isRenderableElement(element, normalizedContext));
    const includesAccent = spec.elements.some((element) => (
      element.fill?.toLowerCase() === normalizedContext.accentColor.toLowerCase()
    ));
    const failures = [];
    if (spec.width !== normalizedContext.width || spec.height !== normalizedContext.height) {
      failures.push(`format is ${spec.width} × ${spec.height}, expected ${normalizedContext.width} × ${normalizedContext.height}`);
    }
    if (spec.fps !== normalizedContext.fps) failures.push(`fps is ${spec.fps}, expected ${normalizedContext.fps}`);
    if (Math.round(spec.durationInSeconds * normalizedContext.fps) !== expectedDurationFrames) {
      failures.push(`duration is ${spec.durationInSeconds}s, expected ${shot.durationSeconds}s`);
    }
    if (!hasFullBackground) failures.push(`no full-canvas background rect in ${normalizedContext.primaryColor}`);
    if (!preservesCopy) failures.push(`no text element with the exact copy "${shot.onScreenCopy}"`);
    if (!preservesSubheadline) failures.push('subheadline missing');
    if (!includesAccent) failures.push(`accent color ${normalizedContext.accentColor} not used`);
    if (!isValidMotion(spec.motion)) failures.push(`motion ${JSON.stringify(spec.motion)} uses an option the renderer doesn't have`);
    if (!hasRenderableElements) {
      const bad = spec.elements.filter((element) => !isRenderableElement(element, normalizedContext))
        .map((element) => `${element.id || '?'} (${element.type || 'no type'})`);
      failures.push(`unrenderable elements: ${bad.join(', ')}`);
    }
    if (failures.length > 0) {
      throw new Error(`Compiled shot "${shot.id}" does not satisfy its format, copy, and brand constraints: ${failures.join('; ')}.`);
    }
    const durationFrames = expectedDurationFrames;
    if (durationFrames < 1) throw new Error(`Shot "${shot.id}" is shorter than one frame.`);
    const startFrame = cursor;
    const endFrame = startFrame + durationFrames - 1;
    cursor += durationFrames;
    return {
      shotId: shot.id,
      purpose: shot.purpose,
      startFrame,
      endFrame,
      durationFrames,
      durationSeconds: durationFrames / normalizedContext.fps,
      transitionIn: shot.transitionIn,
      transitionOut: shot.transitionOut,
      palette: {
        primary: normalizedContext.primaryColor,
        accent: normalizedContext.accentColor,
      },
      hardConstraints: [...storyboard.hardConstraints],
      spec: { ...spec, width: normalizedContext.width, height: normalizedContext.height, fps: normalizedContext.fps, durationInSeconds: durationFrames / normalizedContext.fps },
    };
  });
  return {
    schemaVersion: '1.0',
    id: safeSlug(storyboard.id),
    title: storyboard.title,
    width: normalizedContext.width,
    height: normalizedContext.height,
    fps: normalizedContext.fps,
    palette: {
      primary: normalizedContext.primaryColor,
      accent: normalizedContext.accentColor,
    },
    hardConstraints: [...storyboard.hardConstraints],
    totalFrames: cursor,
    durationInSeconds: cursor / normalizedContext.fps,
    shots,
  };
}

export function validateTimeline(timeline) {
  const errors = [];
  if (!timeline || typeof timeline !== 'object' || Array.isArray(timeline)) {
    return { valid: false, errors: ['Timeline must be a JSON object.'] };
  }
  for (const key of ['width', 'height', 'fps', 'totalFrames']) {
    if (!Number.isInteger(timeline[key]) || timeline[key] <= 0) {
      errors.push(`Timeline "${key}" must be a positive integer.`);
    }
  }
  if (!validString(timeline.id) || !validString(timeline.title)) {
    errors.push('Timeline must have a non-empty id and title.');
  }
  if (timeline.schemaVersion !== '1.0') {
    errors.push('Timeline schemaVersion must be "1.0".');
  }
  if (timeline.palette !== undefined && (
    !timeline.palette
    || !/^#[\da-f]{6}$/i.test(timeline.palette.primary || '')
    || !/^#[\da-f]{6}$/i.test(timeline.palette.accent || '')
  )) {
    errors.push('Timeline palette must contain valid primary and accent colors.');
  }
  if (timeline.hardConstraints !== undefined && (
    !Array.isArray(timeline.hardConstraints)
    || timeline.hardConstraints.length === 0
    || !timeline.hardConstraints.every(validString)
  )) {
    errors.push('Timeline hardConstraints must be a non-empty array of strings.');
  }
  if (!Array.isArray(timeline.shots) || timeline.shots.length === 0) {
    errors.push('Timeline must contain at least one shot.');
  } else {
    let expectedStartFrame = 0;
    const ids = new Set();
    for (const shot of timeline.shots) {
      if (!shot || typeof shot !== 'object' || Array.isArray(shot)) {
        errors.push('Timeline shots must be objects.');
        continue;
      }
      if (!validString(shot.shotId) || ids.has(shot.shotId)) {
        errors.push('Timeline shot ids must be unique non-empty strings.');
      } else ids.add(shot.shotId);
      if (
        shot.startFrame !== expectedStartFrame
        || !Number.isInteger(shot.durationFrames)
        || shot.durationFrames < 1
        || shot.endFrame !== shot.startFrame + shot.durationFrames - 1
      ) {
        errors.push(`Timeline shot "${shot.shotId}" has invalid or non-contiguous frame boundaries.`);
      } else {
        expectedStartFrame = shot.endFrame + 1;
      }
      if (
        !validString(shot.purpose)
        || Math.abs(shot.durationSeconds - shot.durationFrames / timeline.fps) > 0.0001
      ) {
        errors.push(`Timeline shot "${shot.shotId}" purpose or duration is invalid.`);
      }
      if (shot.palette !== undefined && (
        !shot.palette
        || !/^#[\da-f]{6}$/i.test(shot.palette.primary || '')
        || !/^#[\da-f]{6}$/i.test(shot.palette.accent || '')
      )) {
        errors.push(`Timeline shot "${shot.shotId}" palette is invalid.`);
      }
      if (shot.hardConstraints !== undefined && (
        !Array.isArray(shot.hardConstraints)
        || shot.hardConstraints.length === 0
        || !shot.hardConstraints.every(validString)
      )) {
        errors.push(`Timeline shot "${shot.shotId}" hardConstraints are invalid.`);
      }
      const sceneResult = validateSceneSpec(shot.spec);
      if (!sceneResult.valid) errors.push(`Timeline shot "${shot.shotId}" scene is invalid: ${sceneResult.errors.join(' ')}`);
      if (shot.spec?.width !== timeline.width || shot.spec?.height !== timeline.height || shot.spec?.fps !== timeline.fps) {
        errors.push(`Timeline shot "${shot.shotId}" format does not match the timeline.`);
      }
      if (Math.abs(shot.spec?.durationInSeconds - shot.durationSeconds) > 0.0001) {
        errors.push(`Timeline shot "${shot.shotId}" scene duration does not match its frame range.`);
      }
    }
    if (expectedStartFrame !== timeline.totalFrames) {
      errors.push('Timeline totalFrames does not equal the sum of shot frames.');
    }
  }
  if (
    Number.isFinite(timeline.totalFrames)
    && Number.isFinite(timeline.fps)
    && Math.abs(timeline.durationInSeconds - timeline.totalFrames / timeline.fps) > 0.0001
  ) {
    errors.push('Timeline durationInSeconds does not match its frame count and frame rate.');
  }
  return { valid: errors.length === 0, errors };
}


export function evaluateCreativeQA(timeline, context = {}) {
  const normalizedContext = normalizeProductionContext(context);
  const textElements = timeline.shots.flatMap((shot) => shot.spec.elements
    .filter((element) => element.type === 'text')
    .map((element) => ({ shotId: shot.shotId, element })));
  const contrastResults = textElements.map(({ shotId, element }) => {
    const background = shotBackground(timeline.shots.find((shot) => shot.shotId === shotId)?.spec);
    const ratio = contrastRatio(element.fill, background);
    return { shotId, ratio, pass: ratio !== null && ratio >= 4.5 };
  });
  const legibility = textElements.every(({ element }) => (
    validString(element.content) && Number.isFinite(element.fontSize) && element.fontSize >= 16
  ));
  const usedColors = timeline.shots.flatMap((shot) => shot.spec.elements.map((element) => element.fill?.toLowerCase()));
  const primaryColor = normalizedContext.primaryColor.toLowerCase();
  const accentColor = normalizedContext.accentColor.toLowerCase();
  const brandFidelity = usedColors.includes(primaryColor) && usedColors.includes(accentColor);
  return {
    pass: contrastResults.length > 0
      && contrastResults.every((metric) => metric.pass)
      && legibility
      && brandFidelity,
    contrast: {
      pass: contrastResults.length > 0 && contrastResults.every((metric) => metric.pass),
      minimumRatio: contrastResults.length ? Math.min(...contrastResults.map((metric) => metric.ratio ?? 0)) : 0,
      requiredRatio: 4.5,
      shots: contrastResults,
    },
    legibility: { pass: legibility, minimumFontSize: 16, textElementCount: textElements.length },
    brandFidelity: { pass: brandFidelity, primaryColor, accentColor },
  };
}

function shotBackground(spec) {
  return spec?.elements.find((element) => (
    element.type === 'rect' && element.x === 0 && element.y === 0
      && element.width === spec.width && element.height === spec.height
  ))?.fill;
}

/**
 * Scales shot durations so the film is exactly `target` seconds, in whole frames,
 * keeping every shot at least one second. Returns the old total if it changed.
 */
function fitStoryboardDuration(storyboard, target, fps) {
  const shots = storyboard.shots;
  const total = shots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
  const targetFrames = Math.round(target * fps);
  if (Math.abs(Math.round(total * fps) - targetFrames) < 1) return undefined;
  const frames = shots.map((shot) => Math.max(fps, Math.round((shot.durationSeconds * targetFrames) / total)));
  let difference = targetFrames - frames.reduce((sum, value) => sum + value, 0);
  while (difference !== 0) {
    const step = Math.sign(difference);
    const candidates = frames.map((value, index) => ({ value, index })).filter(({ value }) => step > 0 || value > fps);
    if (candidates.length === 0) break;
    const { index } = candidates.reduce((best, item) => (item.value > best.value ? item : best));
    frames[index] += step;
    difference -= step;
  }
  shots.forEach((shot, index) => { shot.durationSeconds = frames[index] / fps; });
  return total;
}

function markOutputError(error) {
  if (error && typeof error === 'object' && !error.kind) error.kind = 'output';
  return error;
}

/** Ids of shots before the last that reuse the brief's On-Screen Text (equal or contained). */
function earlierShotsReusing(storyboard, onScreenText) {
  if (!onScreenText.length || !Array.isArray(storyboard?.shots)) return [];
  const norm = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const lines = onScreenText.flatMap((line) => line.split(/(?<=[.!?])\s+/)).map(norm).filter((line) => line.length >= 3);
  return storyboard.shots.slice(0, -1)
    .filter((shot) => { const copy = norm(shot.onScreenCopy); return copy && lines.some((line) => copy === line || copy.includes(line) || line.includes(copy)); })
    .map((shot) => shot.id);
}

/**
 * Drops middle shots whose line repeats another shot's, sharing their time between
 * the shots on either side. The first and last shots (headline and subheadline) always stay,
 * and a film never drops below two shots. Returns the removed shots.
 */
function removeRepeatedLines(storyboard) {
  const key = (shot) => String(shot.onScreenCopy || '').trim().toLowerCase();
  const shots = storyboard.shots;
  const removed = [];
  const kept = [];
  shots.forEach((shot, index) => {
    // The last shot always stays; the first stays unless it repeats the end card.
    const isEdge = index === shots.length - 1 || (index === 0 && key(shot) !== key(shots.at(-1)));
    const repeats = kept.some((other) => key(other) === key(shot)) || key(shot) === key(shots.at(-1));
    if (!isEdge && repeats && shots.length - removed.length > 2) {
      if (index === 0) {
        removed.push(shot);
        shots[1].durationSeconds += shot.durationSeconds;
        return;
      }
      // Its time is shared between the shots on either side, keeping the pacing even.
      removed.push(shot);
      kept.at(-1).durationSeconds += shot.durationSeconds / 2;
      shots[index + 1].durationSeconds += shot.durationSeconds / 2;
    } else {
      kept.push(shot);
    }
  });
  storyboard.shots = kept;
  return removed;
}

/**
 * Fits shots into timecoded beats: each beat is a section holding one or more
 * consecutive shots. The cut nearest each beat boundary moves onto it, then each
 * section's shots are scaled to fill it exactly, in whole frames (each shot at
 * least half a second).
 */
function fitShotsToBeats(storyboard, beats, fps) {
  const shots = storyboard.shots;
  const total = shots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
  const target = beats.reduce((sum, seconds) => sum + seconds, 0);
  const cuts = [];
  let elapsed = 0;
  for (const shot of shots.slice(0, -1)) { elapsed += (shot.durationSeconds / total) * target; cuts.push(elapsed); }
  // Choose which cut ends each beat (in order, leaving at least one shot per beat).
  const ends = [];
  let boundary = 0;
  let from = 0;
  for (let beat = 0; beat < beats.length - 1; beat += 1) {
    boundary += beats[beat];
    const last = cuts.length - (beats.length - 2 - beat) - 1;
    let best = from;
    for (let index = from; index <= last; index += 1) {
      if (Math.abs(cuts[index] - boundary) < Math.abs(cuts[best] - boundary)) best = index;
    }
    ends.push(best);
    from = best + 1;
  }
  const minimum = Math.round(fps / 2);
  let start = 0;
  beats.forEach((seconds, beat) => {
    const end = beat < beats.length - 1 ? ends[beat] : shots.length - 1;
    const section = shots.slice(start, end + 1);
    const sectionTotal = section.reduce((sum, shot) => sum + shot.durationSeconds, 0);
    const targetFrames = Math.round(seconds * fps);
    const frames = section.map((shot) => Math.max(minimum, Math.round((shot.durationSeconds / sectionTotal) * targetFrames)));
    frames[frames.length - 1] += targetFrames - frames.reduce((sum, value) => sum + value, 0);
    section.forEach((shot, index) => { shot.durationSeconds = Math.max(minimum, frames[index]) / fps; });
    start = end + 1;
  });
}

export async function createCreativePlan(prompt, context = {}, provider = null) {
  // A length in the brief wins over the default, unless the caller set one explicitly.
  const briefSeconds = context.durationInSeconds === undefined ? durationFromBrief(prompt) : undefined;
  const normalizedContext = normalizeProductionContext(briefSeconds ? { ...context, durationInSeconds: briefSeconds } : context);
  const onScreenText = provider && !normalizedContext.headline && !normalizedContext.subheadline ? onScreenTextFromBrief(prompt) : [];
  let generatedStoryboard = provider?.generateStoryboard
    ? await provider.generateStoryboard(prompt, normalizedContext)
    : buildMockStoryboard(prompt, normalizedContext);
  // The end card's text belongs on the end card. If the model reused it earlier in
  // the film, it gets one rewrite with a note saying exactly what to change.
  // Two problems get one rewrite with a note saying exactly what to change: shots
  // that reuse the end card's text, and too few shots for the film's length.
  let rewriteNote = '';
  const reused = earlierShotsReusing(generatedStoryboard, onScreenText);
  const shotCount = Array.isArray(generatedStoryboard?.shots) ? generatedStoryboard.shots.length : 0;
  const seconds = normalizedContext.durationInSeconds;
  // Only when a length was asked for (in the brief or by the caller): a default
  // 8-second film with three shots is acceptable, and not worth another call.
  const lengthRequested = briefSeconds !== undefined || context.durationInSeconds !== undefined;
  const tooFew = lengthRequested && seconds >= 8 && shotCount > 0 && shotCount < 4;
  if ((reused.length || tooFew) && provider?.generateStoryboard) {
    const notes = [];
    if (reused.length) notes.push(`Shots ${reused.join(', ')} reused the end card's text ("${onScreenText.join(' / ')}"). FOLD Motion places that text on the final shot. Write new, different lines for every earlier shot.`);
    if (tooFew) notes.push(`This storyboard has only ${shotCount} shots for a ${seconds}-second film, so each shot holds too long. Use ${Math.max(5, Math.round(seconds / 2))} to ${Math.min(8, Math.round(seconds / 1.3))} shots, about one cut every 1.5 to 2 seconds${beatsFromBrief(prompt) ? ', with two or three shots inside each timecoded beat' : ''}.`);
    try {
      generatedStoryboard = await provider.generateStoryboard(`${prompt}\n\nRevision: ${notes.join(' ')}`, normalizedContext);
      rewriteNote = `The storyboard was rewritten once: ${[reused.length ? 'earlier shots reused the end card' : '', tooFew ? `${shotCount} shots was too few for ${seconds}s` : ''].filter(Boolean).join('; ')}.`;
    } catch {
      // Keep the first storyboard; repeated lines are still removed below.
    }
  }
  let repairs = [];
  let storyboard = generatedStoryboard && Array.isArray(generatedStoryboard.shots)
    ? { ...generatedStoryboard, shots: generatedStoryboard.shots.map((shot) => ({ ...shot })) }
    : generatedStoryboard;
  if (provider) ({ storyboard, repairs } = repairStoryboard(storyboard, normalizedContext));
  if (rewriteNote) repairs.unshift(rewriteNote);
  if (storyboard && Array.isArray(storyboard.shots) && storyboard.shots.length > 0) {
    if (normalizedContext.headline) storyboard.shots[0].onScreenCopy = normalizedContext.headline;
    if (normalizedContext.subheadline && storyboard.shots.length > 1) {
      storyboard.shots.at(-1).onScreenCopy = normalizedContext.subheadline;
    }
    // A brief's On-Screen Text is the end card, exactly: its first line on the final
    // shot and the rest as that shot's kicker (when no copy fields are set).
    const onScreen = onScreenText;
    if (onScreen.length) {
      const last = storyboard.shots.at(-1);
      const rest = onScreen.slice(1).join(' ').trim();
      last.onScreenCopy = onScreen[0];
      if (rest) last.kicker = rest;
      else delete last.kicker;
      repairs.push(`The final shot uses the brief's On-Screen Text exactly: "${onScreen[0]}"${rest ? `, with "${rest}" beneath it` : ''}.`);
    }
    // Every shot gets its own line: a middle shot that repeats one is dropped.
    for (const shot of removeRepeatedLines(storyboard)) {
      if (provider) repairs.push(`${shot.id} repeated "${shot.onScreenCopy}"; removed, and its time shared with the shots around it.`);
    }
  }
  const validation = validateStoryboard(storyboard);
  if (!validation.valid) {
    const error = new Error(`Generated storyboard is invalid: ${validation.errors.join(' ')}`);
    throw provider ? markOutputError(error) : error;
  }
  // A requested length (from the brief or the caller) is a client requirement, so code
  // makes it exact. With no request, the storyboard's own pacing stands.
  const requestedSeconds = context.durationInSeconds ?? briefSeconds;
  const previousTotal = requestedSeconds === undefined ? undefined
    : fitStoryboardDuration(storyboard, normalizedContext.durationInSeconds, normalizedContext.fps);
  if (previousTotal !== undefined && provider) {
    repairs.push(`Shot durations scaled from ${Number(previousTotal.toFixed(2))}s to the requested ${normalizedContext.durationInSeconds}s.`);
  }
  // Beats written as timecodes ("0:00 - 0:03 ... 0:07 - 0:10") set each shot's length
  // exactly, when they match the shots one to one.
  const beats = briefSeconds !== undefined && context.durationInSeconds === undefined ? beatsFromBrief(prompt) : undefined;
  if (beats && storyboard.shots.length >= beats.beats.length && Math.abs(beats.total - normalizedContext.durationInSeconds) < 0.05) {
    fitShotsToBeats(storyboard, beats.beats, normalizedContext.fps);
    if (provider) repairs.push(`Cuts land on the brief's beats (${beats.beats.map((seconds) => `${Number(seconds.toFixed(2))}s`).join(', ')}): ${storyboard.shots.map((shot) => `${Number(shot.durationSeconds.toFixed(2))}s`).join(', ')}.`);
  }
  return {
    storyboard,
    acceptance: buildAcceptanceSpec(storyboard, normalizedContext),
    provider: provider?.name ?? 'mock-provider',
    ...(repairs.length ? { repairs } : {}),
  };
}

/**
 * Makes sure a film uses FOLD Motion's signature moves when the direction left
 * them out: one emphasis word on the hero line, and The Fold once in films of
 * three or more shots. Returns what it changed.
 */
function strengthenDirection(specs, storyboard) {
  const changes = [];
  const v2 = specs.filter((spec) => spec?.version === 2);
  if (v2.length !== specs.length || specs.length === 0) return changes;
  if (!specs.some((spec) => spec.emphasis)) {
    const index = specs.findIndex((spec, i) => ['title-reveal', 'statement', 'kicker-title', 'type-stack', 'type-window', 'product-hero'].includes(spec.recipe)
      && storyboard.shots[i].onScreenCopy.trim().split(/\s+/).length >= 2);
    if (index >= 0) {
      const word = storyboard.shots[index].onScreenCopy.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, '')).filter((w) => w.length >= 3)
        .reduce((best, w) => (w.length > best.length ? w : best), '');
      if (word) {
        specs[index].emphasis = word;
        changes.push(`${storyboard.shots[index].id}: emphasized "${word}" on the hero line.`);
      }
    }
  }
  if (specs.length >= 3 && !specs.some((spec) => spec.transitionOut === 'fold')) {
    specs[0].transitionOut = 'fold';
    changes.push(`${storyboard.shots[0].id}: The Fold carries the film out of its opening shot.`);
  }
  return changes;
}

export async function compileCreativePlan(storyboard, context = {}, provider = null) {
  const storyboardValidation = validateStoryboard(storyboard);
  if (!storyboardValidation.valid) throw new Error(`Cannot compile invalid storyboard: ${storyboardValidation.errors.join(' ')}`);
  const normalizedContext = normalizeProductionContext(context);
  if (!provider?.compileStoryboard) {
    const seed = `${storyboard.id}|${storyboard.title}`;
    const shotSpecs = storyboard.shots.map((shot, index) => makeShotSpec(shot, index, normalizedContext, seed, storyboard.shots.length));
    ensureProductShot(shotSpecs, normalizedContext.products?.length || 0);
    strengthenDirection(shotSpecs, storyboard);
    return { timeline: buildTimeline(storyboard, shotSpecs, normalizedContext), provider: 'mock-provider' };
  }

  const rawSpecs = await provider.compileStoryboard(storyboard, normalizedContext);
  if (!Array.isArray(rawSpecs)) {
    throw markOutputError(new Error(`${provider.name} returned shot specifications in an invalid format.`));
  }
  const repairs = [];
  if (rawSpecs.length !== storyboard.shots.length) {
    repairs.push(`Model returned ${rawSpecs.length} scenes for ${storyboard.shots.length} shots; matched them by position.`);
  }
  const seed = `${storyboard.id}|${storyboard.title}`;
  const shotSpecs = storyboard.shots.map((shot, index) => {
    const raw = rawSpecs[index];
    const result = isLegacyScene(raw)
      ? repairShotSpec(raw, shot, index, normalizedContext, seed)
      : directedShotSpec(raw, shot, index, storyboard.shots.length, normalizedContext, seed);
    repairs.push(...result.repairs);
    return result.spec;
  });
  repairs.push(...limitFolds(shotSpecs, storyboard.shots.map((shot) => shot.id)));
  repairs.push(...ensureProductShot(shotSpecs, normalizedContext.products?.length || 0, storyboard.shots.map((shot) => shot.id)));
  repairs.push(...strengthenDirection(shotSpecs, storyboard));
  try {
    const timeline = buildTimeline(storyboard, shotSpecs, normalizedContext);
    return { timeline, provider: provider.name, ...(repairs.length ? { repairs } : {}) };
  } catch (error) {
    throw markOutputError(error);
  }
}
