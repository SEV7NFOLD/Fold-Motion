import { validateSceneSpec } from '../../scripts/qa/validate-scene-spec.mjs';

const DEFAULTS = Object.freeze({
  width: 1280,
  height: 720,
  fps: 24,
  durationInSeconds: 8,
  primaryColor: '#0F172A',
  accentColor: '#38BDF8',
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
  return normalized;
}

export function buildMockStoryboard(prompt, context = {}) {
  if (!validString(prompt)) {
    throw new Error('A valid text prompt is required to create a storyboard.');
  }
  const normalizedContext = normalizeProductionContext(context);
  const headline = prompt.trim().replace(/[.!?]+$/, '').slice(0, 54);
  const shots = [
    {
      id: 'shot-01',
      purpose: 'Establish the visual world and create anticipation.',
      durationSeconds: 3,
      onScreenCopy: 'A NEW SIGNAL',
      mainVisual: 'A restrained geometric field with a single illuminated focal point.',
      composition: 'Centered focal point with generous negative space.',
      cameraBehavior: 'Slow, steady push toward the focal point.',
      motionBehavior: 'Fine grid and framing lines reveal before the focal point brightens.',
      transitionIn: 'Fade up from the primary brand color.',
      transitionOut: 'The focal point expands into the next shot.',
      soundCue: 'Low, restrained tonal swell.',
      acceptanceCriteria: ['The opening reads clearly without competing elements.'],
    },
    {
      id: 'shot-02',
      purpose: 'Deliver the central message with a clear visual hierarchy.',
      durationSeconds: 3,
      onScreenCopy: headline || 'MAKE IT MOVE',
      mainVisual: 'Oversized kinetic typography supported by a precise accent line.',
      composition: 'Headline occupies the central safe area; supporting detail remains subordinate.',
      cameraBehavior: 'Measured lateral drift that settles before the copy resolves.',
      motionBehavior: 'Headline enters with a short eased rise and settles into a stable hold.',
      transitionIn: 'Carry the previous focal point into the headline baseline.',
      transitionOut: 'The accent line draws toward the closing action.',
      soundCue: 'A concise percussive accent at the headline reveal.',
      acceptanceCriteria: ['The exact headline remains readable and dominant.'],
    },
    {
      id: 'shot-03',
      purpose: 'Resolve the idea and leave the viewer with a memorable finish.',
      durationSeconds: 2,
      onScreenCopy: 'BUILT TO MOVE',
      mainVisual: 'A compact brand lockup on a calm, high-contrast field.',
      composition: 'Centered lockup with a clear ending hold.',
      cameraBehavior: 'Camera settles and holds through the final frame.',
      motionBehavior: 'Supporting geometry resolves into a crisp brand signature.',
      transitionIn: 'The previous accent line resolves into the lockup.',
      transitionOut: 'End on a stable hold; no unintended fade or blank frame.',
      soundCue: 'Short tonal resolution with a clean tail.',
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

function makeShotSpec(storyboardShot, index, context) {
  const id = `${safeSlug(storyboardShot.id)}-scene`;
  return {
    id,
    title: storyboardShot.onScreenCopy.slice(0, 64),
    width: context.width,
    height: context.height,
    fps: context.fps,
    durationInSeconds: storyboardShot.durationSeconds,
    promptSource: storyboardShot.purpose,
    elements: [
      {
        id: `shot-${index + 1}-background`,
        type: 'rect',
        x: 0,
        y: 0,
        width: context.width,
        height: context.height,
        fill: context.primaryColor,
      },
      {
        id: `shot-${index + 1}-accent`,
        type: 'rect',
        x: context.width * 0.12,
        y: context.height * 0.69,
        width: context.width * 0.28,
        height: Math.max(4, context.height * 0.006),
        fill: context.accentColor,
      },
      {
        id: `shot-${index + 1}-copy`,
        type: 'text',
        content: storyboardShot.onScreenCopy,
        x: context.width / 2,
        y: context.height / 2,
        fill: '#F8FAFC',
        fontSize: Math.max(32, Math.round(context.height * 0.067)),
        anchor: 'middle',
      },
    ],
  };
}

export function buildTimeline(storyboard, shotSpecs, context = {}) {
  const normalizedContext = normalizeProductionContext(context);
  if (!Array.isArray(shotSpecs) || shotSpecs.length !== storyboard.shots.length) {
    throw new Error('Compiled shot specifications must match the storyboard shot count.');
  }
  let cursor = 0;
  const shots = storyboard.shots.map((shot, index) => {
    const spec = shotSpecs[index];
    const validation = validateSceneSpec(spec);
    if (!validation.valid) {
      throw new Error(`Compiled shot "${shot.id}" is invalid: ${validation.errors.join(' ')}`);
    }
    const expectedDurationFrames = Math.round(shot.durationSeconds * normalizedContext.fps);
    const hasRenderableElements = spec.elements.every((element) => isRenderableElement(element, normalizedContext));
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
    const includesAccent = spec.elements.some((element) => (
      element.fill?.toLowerCase() === normalizedContext.accentColor.toLowerCase()
    ));
    if (
      spec.width !== normalizedContext.width
      || spec.height !== normalizedContext.height
      || spec.fps !== normalizedContext.fps
      || Math.round(spec.durationInSeconds * normalizedContext.fps) !== expectedDurationFrames
      || !hasFullBackground
      || !preservesCopy
      || !includesAccent
      || !hasRenderableElements
    ) {
      throw new Error(`Compiled shot "${shot.id}" does not satisfy its format, copy, and brand constraints.`);
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

function hexRgb(color) {
  if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) return null;
  return [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
}

function contrastRatio(first, second) {
  const firstLuminance = hexRgb(first);
  const secondLuminance = hexRgb(second);
  if (!firstLuminance || !secondLuminance) return null;
  const luminance = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const values = [luminance(firstLuminance), luminance(secondLuminance)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
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

export async function createCreativePlan(prompt, context = {}, provider = null) {
  const normalizedContext = normalizeProductionContext(context);
  const storyboard = provider?.generateStoryboard
    ? await provider.generateStoryboard(prompt, normalizedContext)
    : buildMockStoryboard(prompt, normalizedContext);
  const validation = validateStoryboard(storyboard);
  if (!validation.valid) throw new Error(`Generated storyboard is invalid: ${validation.errors.join(' ')}`);
  return {
    storyboard,
    acceptance: buildAcceptanceSpec(storyboard, normalizedContext),
    provider: provider?.name ?? 'mock-provider',
  };
}

export async function compileCreativePlan(storyboard, context = {}, provider = null) {
  const storyboardValidation = validateStoryboard(storyboard);
  if (!storyboardValidation.valid) throw new Error(`Cannot compile invalid storyboard: ${storyboardValidation.errors.join(' ')}`);
  const normalizedContext = normalizeProductionContext(context);
  const shotSpecs = provider?.compileStoryboard
    ? await provider.compileStoryboard(storyboard, normalizedContext)
    : storyboard.shots.map((shot, index) => makeShotSpec(shot, index, normalizedContext));
  const timeline = buildTimeline(storyboard, shotSpecs, normalizedContext);
  return {
    timeline,
    provider: provider?.name ?? 'mock-provider',
  };
}
