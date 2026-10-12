export const SCENE_01_META = Object.freeze({
  id: 'scene-01',
  name: 'SIGNAL / 001 — Precision in Motion',
  durationSeconds: 4,
  width: 1280,
  height: 720,
});

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function rangeProgress(time, start, end) {
  return clamp((time - start) / (end - start), 0, 1);
}

function easeOutCubic(value) {
  return 1 - (1 - value) ** 3;
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value ** 3
    : 1 - (-2 * value + 2) ** 3 / 2;
}

function easeOutQuint(value) {
  return 1 - (1 - value) ** 5;
}

function interpolate(start, end, progress) {
  return start + (end - start) * progress;
}

export function canonicalTimestamp(frameIndex, framesPerSecond) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    throw new RangeError('frameIndex must be a non-negative integer.');
  }

  if (!Number.isFinite(framesPerSecond) || framesPerSecond <= 0) {
    throw new RangeError('framesPerSecond must be a positive number.');
  }

  return frameIndex / framesPerSecond;
}

export function sceneState(requestedTime) {
  const time = clamp(Number.isFinite(requestedTime) ? requestedTime : 0, 0, SCENE_01_META.durationSeconds);
  const establishment = easeOutCubic(rangeProgress(time, 0, 0.7));
  const convergence = easeInOutCubic(rangeProgress(time, 0.7, 1.6));
  const identity = easeOutQuint(rangeProgress(time, 1.6, 2.35));
  const resolution = easeOutCubic(rangeProgress(time, 2.45, 3.5));

  return Object.freeze({
    time,
    gridOpacity: 0.14 + 0.12 * establishment,
    structureOpacity: 0.28 + 0.72 * establishment,
    convergence,
    upperFragmentX: interpolate(1032, 862, convergence),
    lowerFragmentX: interpolate(748, 862, convergence),
    titleOpacity: identity,
    titleY: interpolate(38, 0, identity),
    titleRuleScale: 0.18 + 0.82 * identity,
    markOpacity: Math.max(convergence, identity * 0.85),
    markScale: interpolate(0.82, 1, convergence),
    detailOpacity: resolution,
    signalWidth: 44 + 172 * resolution,
    footerOpacity: resolution,
  });
}
