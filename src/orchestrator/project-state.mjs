import { validateStoryboard, validateTimeline } from '../production/production.mjs';

export const PROJECT_STATES = Object.freeze([
  'BRIEF',
  'PLANNING',
  'STORYBOARD_REVIEW',
  'BUILDING',
  'RENDERING',
  'QA',
  'APPROVED',
  'DELIVERED',
]);

const transitions = Object.freeze({
  BRIEF: 'PLANNING',
  PLANNING: 'STORYBOARD_REVIEW',
  STORYBOARD_REVIEW: 'BUILDING',
  BUILDING: 'RENDERING',
  RENDERING: 'QA',
  QA: 'APPROVED',
  APPROVED: 'DELIVERED',
});

function hasObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasTransitionEvidence(project, nextState, evidence) {
  switch (nextState) {
    case 'PLANNING':
      return typeof project.brief === 'string' && Boolean(project.brief.trim());
    case 'STORYBOARD_REVIEW':
      return validateStoryboard(project.storyboard).valid;
    case 'BUILDING':
      return evidence.storyboardApproved === true
        && validateStoryboard(project.storyboard).valid
        && hasObject(project.acceptance)
        && Array.isArray(project.acceptance.shotCriteria)
        && project.acceptance.shotCriteria.length === project.storyboard.shots.length;
    case 'RENDERING':
      return validateTimeline(project.timeline).valid;
    case 'QA':
      return hasObject(project.renderReport)
        && project.renderReport.verified === true
        && typeof project.renderReport.productionQA?.pass === 'boolean'
        && typeof project.renderReport.creativeQA?.pass === 'boolean';
    case 'APPROVED':
      return evidence.finalCutApproved === true
        && project.renderReport?.productionQA?.pass === true
        && project.renderReport?.creativeQA?.pass === true;
    case 'DELIVERED':
      return hasObject(project.renderReport?.artifacts)
        && typeof project.renderReport.artifacts.video === 'string'
        && typeof project.renderReport.artifacts.source === 'string'
        && project.renderReport.artifacts.video.startsWith('/output/')
        && project.renderReport.artifacts.source.startsWith('/output/')
        && !project.renderReport.artifacts.video.includes('..')
        && !project.renderReport.artifacts.source.includes('..');
    default:
      return false;
  }
}

export function createProject({ id, brief = '', context = {} } = {}) {
  return {
    id: id || `project-${Date.now()}`,
    brief,
    context,
    state: 'BRIEF',
    storyboard: null,
    acceptance: null,
    timeline: null,
    renderReport: null,
    history: [{ state: 'BRIEF', at: new Date().toISOString() }],
  };
}

export function transitionProject(project, nextState, evidence = {}) {
  if (!hasObject(project) || !PROJECT_STATES.includes(project.state)) {
    throw new Error('Cannot transition an invalid project state.');
  }
  if (transitions[project.state] !== nextState) {
    throw new Error(`Invalid project transition: ${project.state} → ${nextState}.`);
  }
  if (
    !Array.isArray(project.history)
    || project.history.at(-1)?.state !== project.state
    || project.history.some((entry, index) => entry?.state !== PROJECT_STATES[index])
  ) {
    throw new Error('Project state history is inconsistent; create a new project before continuing.');
  }
  if (!hasTransitionEvidence(project, nextState, evidence)) {
    throw new Error(`Project evidence is incomplete for transition to ${nextState}.`);
  }

  return {
    ...project,
    state: nextState,
    history: [...(Array.isArray(project.history) ? project.history : []), {
      state: nextState,
      at: new Date().toISOString(),
    }],
  };
}
