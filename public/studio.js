import { PROJECT_STATES } from './workflow-states.mjs';

const STORAGE_KEY = 'fold-motion.project.v2';
const PROJECTS_STORAGE_KEY = 'fold_motion_projects_archive';
const TELEMETRY_STORAGE_KEY = 'fold_motion_telemetry_session';
const DEFAULT_CONTEXT = {
  width: 1280,
  height: 720,
  fps: 24,
  primaryColor: '#0B0F19',
  accentColor: '#00F0FF',
  headline: '',
  subheadline: '',
};
const viewTitles = {
  studio: 'Motion Studio',
  timeline: 'Timeline & Shots',
  qa: 'Technical QA',
};
const stateLabels = {
  BRIEF: 'Waiting for a creative brief',
  PLANNING: 'Developing story and acceptance criteria',
  STORYBOARD_REVIEW: 'Human storyboard approval required',
  BUILDING: 'Compiling approved shots',
  RENDERING: 'Ready to render locally',
  QA: 'Render evidence ready for review',
  APPROVED: 'Final cut approved for delivery',
  DELIVERED: 'Production delivered',
};
const navButtons = [...document.querySelectorAll('.nav-item[data-view]')];
const panels = [...document.querySelectorAll('.view-panel[data-panel]')];
const pageTitle = document.getElementById('page-title');
const promptForm = document.getElementById('prompt-form');
const promptInput = document.getElementById('prompt-input');
const formMessage = document.getElementById('form-message');
const submitButton = promptForm.querySelector('button[type="submit"]');
const storyboardReview = document.getElementById('storyboard-review');
const compiledProduction = document.getElementById('compiled-production');
const approveStoryboardButton = document.getElementById('approve-storyboard');
const renderButton = document.getElementById('render-production');
const qaStatus = document.getElementById('qa-status');
const qaMetrics = document.getElementById('qa-metrics');
const qaMessage = document.getElementById('qa-message');
const finalApprovalButton = document.getElementById('approve-final-cut');
const markDeliveredButton = document.getElementById('mark-delivered');
const deliveryStatus = document.getElementById('delivery-status');
const deliveryArtifacts = document.getElementById('delivery-artifacts');
const telemetryPanel = document.getElementById('telemetry-panel');
const telemetryTitle = document.getElementById('telemetry-title');
const telemetryPercent = document.getElementById('telemetry-percent');
const telemetryProgress = document.getElementById('telemetry-progress-fill');
const telemetryTrack = telemetryProgress.parentElement;
const telemetryLogs = document.getElementById('telemetry-logs');
const telemetryStatus = document.getElementById('telemetry-status');
const telemetryToggle = document.getElementById('telemetry-toggle-btn');
const telemetryDot = telemetryPanel.querySelector('.status-dot');
const recentProjectList = document.getElementById('recent-project-list');

function getStoredTelemetry() {
  const initial = {
    logs: [],
    lastPercent: 0,
    lastStage: 'Ready for production brief.',
    lastMessage: 'Telemetry dock is ready.',
    status: 'IDLE',
    pipelineState: 'BRIEF',
    minimized: true,
  };
  try {
    const stored = localStorage.getItem(TELEMETRY_STORAGE_KEY);
    if (!stored) return initial;
    const parsed = JSON.parse(stored);
    const logs = Array.isArray(parsed.logs)
      ? parsed.logs.filter((entry) => (
        entry
        && typeof entry.timestamp === 'string'
        && typeof entry.stage === 'string'
        && typeof entry.message === 'string'
      ))
      : [];
    return {
      ...initial,
      ...parsed,
      logs,
      lastPercent: Number.isFinite(parsed.lastPercent)
        ? Math.max(0, Math.min(100, Math.round(parsed.lastPercent)))
        : initial.lastPercent,
      status: ['IDLE', 'ACTIVE', 'COMPLETE', 'FAILED', 'PAUSED'].includes(parsed.status)
        ? parsed.status
        : initial.status,
      minimized: typeof parsed.minimized === 'boolean' ? parsed.minimized : initial.minimized,
    };
  } catch (error) {
    console.warn('Failed to load telemetry from storage.', error);
    return initial;
  }
}

function saveTelemetry(sessionData) {
  try {
    localStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(sessionData));
  } catch (error) {
    console.warn('Failed to save telemetry to storage.', error);
  }
}

function renderTelemetryUI(sessionData) {
  telemetryPanel.hidden = false;
  telemetryTitle.textContent = sessionData.lastStage;
  telemetryPercent.textContent = `${sessionData.lastPercent}%`;
  telemetryProgress.style.width = `${sessionData.lastPercent}%`;
  telemetryTrack.setAttribute('aria-valuenow', String(sessionData.lastPercent));
  telemetryStatus.textContent = sessionData.status;
  telemetryStatus.className = `telemetry-status is-${sessionData.status.toLowerCase()}`;
  telemetryDot.classList.toggle('pulsing', sessionData.status === 'ACTIVE');
  telemetryDot.classList.toggle('telemetry-failed', sessionData.status === 'FAILED');
  telemetryPanel.classList.toggle('minimized', sessionData.minimized);
  telemetryToggle.textContent = sessionData.minimized ? '▲ Expand' : '▼ Minimize';
  telemetryToggle.setAttribute('aria-expanded', String(!sessionData.minimized));

  telemetryLogs.replaceChildren();
  for (const entry of sessionData.logs) {
    const row = document.createElement('div');
    row.className = 'telemetry-line';
    const timestamp = document.createElement('span');
    timestamp.className = 'timestamp';
    timestamp.textContent = entry.timestamp;
    const stage = document.createElement('span');
    stage.className = 'stage';
    stage.textContent = entry.stage;
    const message = document.createElement('span');
    message.className = 'message';
    message.textContent = entry.message;
    row.append(timestamp, stage, message);
    if (Number.isFinite(entry.percent)) {
      const percent = document.createElement('span');
      percent.className = 'mono';
      percent.textContent = `${entry.percent}%`;
      row.append(percent);
    }
    telemetryLogs.append(row);
  }
  telemetryLogs.scrollTop = telemetryLogs.scrollHeight;
}

function logTelemetry(stage, message, percent, status) {
  const sessionData = getStoredTelemetry();
  const value = Number.isFinite(percent)
    ? Math.max(0, Math.min(100, Math.round(percent)))
    : sessionData.lastPercent;
  const timestamp = new Date().toLocaleTimeString([], { hour12: false });
  sessionData.logs.push({ timestamp, stage, message, percent: Number.isFinite(percent) ? value : null });
  sessionData.lastPercent = value;
  sessionData.lastStage = stage;
  sessionData.lastMessage = message;
  sessionData.status = status || sessionData.status;
  sessionData.pipelineState = project?.state || sessionData.pipelineState;
  saveTelemetry(sessionData);
  renderTelemetryUI(sessionData);
}

function emitServerTelemetry(events) {
  for (const event of events || []) {
    if (event && typeof event.stage === 'string' && typeof event.message === 'string') {
      logTelemetry(event.stage, event.message, event.percent);
    }
  }
}

function beginTelemetry(stage, message, percent) {
  setTelemetryBusy(true);
  const sessionData = getStoredTelemetry();
  sessionData.minimized = false;
  saveTelemetry(sessionData);
  logTelemetry(stage, message, percent, 'ACTIVE');
}

function setTelemetryBusy(busy) {
  telemetryTrack.classList.toggle('is-indeterminate', busy);
}

function finishTelemetry(stage, message, percent = 100) {
  setTelemetryBusy(false);
  logTelemetry(stage, message, percent, 'COMPLETE');
}

function failTelemetry(stage, message) {
  setTelemetryBusy(false);
  logTelemetry(stage, message, undefined, 'FAILED');
}

function restoreTelemetrySession() {
  const sessionData = getStoredTelemetry();
  if (sessionData.status === 'ACTIVE') {
    sessionData.status = 'PAUSED';
    sessionData.lastStage = 'Production paused after page refresh';
    sessionData.lastMessage = 'The previous request was interrupted by a page refresh; start again to resume work.';
    sessionData.logs.push({
      timestamp: new Date().toLocaleTimeString([], { hour12: false }),
      stage: 'Session restored',
      message: sessionData.lastMessage,
      percent: sessionData.lastPercent,
    });
    saveTelemetry(sessionData);
  }
  renderTelemetryUI(sessionData);
}

function toggleTelemetryDock() {
  const sessionData = getStoredTelemetry();
  sessionData.minimized = !sessionData.minimized;
  saveTelemetry(sessionData);
  renderTelemetryUI(sessionData);
}

function startTelemetryHeartbeat(message) {
  return setInterval(() => {
    logTelemetry('Still working', message, Number.parseInt(telemetryPercent.textContent, 10) || 0);
  }, 15_000);
}

function readBriefContext() {
  return {
    ...DEFAULT_CONTEXT,
    headline: document.getElementById('headline-input').value.trim(),
    subheadline: document.getElementById('subheadline-input').value.trim(),
    primaryColor: document.getElementById('primary-color-input').value,
    accentColor: document.getElementById('accent-color-input').value,
  };
}

function createLocalProject(brief = '') {
  return {
    id: `project-${Date.now()}`,
    brief,
    context: { ...DEFAULT_CONTEXT },
    state: 'BRIEF',
    storyboard: null,
    acceptance: null,
    timeline: null,
    renderReport: null,
    history: [{ state: 'BRIEF', at: new Date().toISOString() }],
  };
}

function getSavedProjects() {
  try {
    const data = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!data) return [];
    const projects = JSON.parse(data);
    if (!Array.isArray(projects)) {
      console.warn('Project archive is not a list; ignoring its contents.');
      return [];
    }
    return projects.filter((entry) => (
      entry
      && typeof entry.id === 'string'
      && entry.project
      && typeof entry.project === 'object'
      && entry.project.state === 'DELIVERED'
    ));
  } catch (error) {
    console.warn('Failed to load project archive.', error);
    return [];
  }
}

function projectDisplayName(savedProject) {
  const briefTitle = typeof savedProject.brief === 'string'
    ? savedProject.brief.split(/\r?\n/, 1)[0].replace(/^Project:\s*/i, '').trim()
    : '';
  return savedProject.storyboard?.title
    || savedProject.context?.headline
    || briefTitle
    || 'Untitled Motion';
}

function projectDuration(savedProject) {
  const duration = savedProject.timeline?.durationInSeconds
    ?? savedProject.storyboard?.shots?.reduce((total, shot) => total + (Number(shot.durationSeconds) || 0), 0);
  return Number.isFinite(duration) && duration > 0 ? `${duration.toFixed(1)}s` : '—';
}

function renderProjectsSidebar() {
  const savedProjects = getSavedProjects();
  recentProjectList.replaceChildren();
  if (savedProjects.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'archive-empty';
    empty.textContent = 'No delivered projects yet.';
    recentProjectList.append(empty);
    return;
  }

  for (const saved of savedProjects) {
    const button = document.createElement('button');
    button.className = 'archive-project';
    button.type = 'button';
    button.dataset.projectId = saved.id;
    button.classList.toggle('is-active', project.id === saved.id);
    button.setAttribute('aria-label', `Load ${projectDisplayName(saved.project)}, ${projectDuration(saved.project)}`);
    if (project.id === saved.id) button.setAttribute('aria-current', 'true');

    const name = document.createElement('span');
    name.className = 'archive-project-copy';
    name.textContent = projectDisplayName(saved.project);
    const duration = document.createElement('span');
    duration.className = 'archive-project-duration';
    duration.textContent = projectDuration(saved.project);
    button.append(name, duration);
    recentProjectList.append(button);
  }
}

function persistCurrentProject() {
  if (project.state !== 'DELIVERED') return false;
  const archive = getSavedProjects();
  const record = {
    id: project.id,
    name: projectDisplayName(project),
    brief: project.brief,
    status: 'DELIVERED',
    archivedAt: new Date().toISOString(),
    duration: projectDuration(project),
    project: JSON.parse(JSON.stringify(project)),
  };
  const existingIndex = archive.findIndex((entry) => entry.id === record.id);
  if (existingIndex >= 0) archive.splice(existingIndex, 1);
  archive.unshift(record);

  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(archive));
  } catch (error) {
    console.error('Failed to save delivered project to the archive.', error);
    logTelemetry('Project archive failed', `The project was delivered but could not be saved to browser storage: ${error.message}`, undefined, 'COMPLETE');
    deliveryStatus.textContent = 'Delivered · archive save failed';
    return false;
  }
  renderProjectsSidebar();
  logTelemetry('Project archived', 'Delivered project saved to recent project history.', 100, 'COMPLETE');
  return true;
}

function loadArchivedProject(projectId) {
  const saved = getSavedProjects().find((entry) => entry.id === projectId);
  if (!saved) {
    logTelemetry('Project archive error', 'The selected delivered project is no longer available in browser storage.', undefined, 'FAILED');
    return;
  }
  project = JSON.parse(JSON.stringify(saved.project));
  project.context = { ...DEFAULT_CONTEXT, ...(project.context || {}) };
  promptInput.value = project.brief || '';
  document.getElementById('headline-input').value = project.context.headline || '';
  document.getElementById('subheadline-input').value = project.context.subheadline || '';
  document.getElementById('primary-color-input').value = project.context.primaryColor;
  document.getElementById('accent-color-input').value = project.context.accentColor;
  formMessage.textContent = '';
  document.getElementById('render-message').textContent = '';
  qaMessage.textContent = '';
  persistProject();
  renderProject();
  renderProjectsSidebar();
  showView('studio');
  logTelemetry('Project restored', `${projectDisplayName(project)} restored from delivered project history.`, 100, 'COMPLETE');
}

function readSavedProject() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && PROJECT_STATES.includes(saved.state) ? saved : createLocalProject();
  } catch {
    return createLocalProject();
  }
}

let project = readSavedProject();

function persistProject() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

async function requestJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  let result;
  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error(`API returned non-JSON content (HTTP ${response.status}): ${responseText.slice(0, 300)}`);
  }
  emitServerTelemetry(result.telemetry);
  if (!response.ok || !result.success) {
    throw new Error(result.error || `API request failed with HTTP ${response.status}.`);
  }
  return result;
}

async function transitionTo(nextState, evidence) {
  const result = await requestJson('/api/state', {
    project,
    nextState,
    evidence,
  });
  project = result.project;
  persistProject();
  if (nextState === 'DELIVERED') persistCurrentProject();
  renderProject();
}

function showView(view) {
  for (const button of navButtons) {
    const isActive = button.dataset.view === view;
    button.classList.toggle('is-active', isActive);
    if (isActive) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const panel of panels) panel.hidden = panel.dataset.panel !== view;
  pageTitle.textContent = viewTitles[view];
}

function appendList(target, entries) {
  target.replaceChildren();
  for (const entry of entries || []) {
    const item = document.createElement('li');
    item.textContent = entry;
    target.append(item);
  }
}

function renderStoryboard() {
  const storyboard = project.storyboard;
  if (!storyboard) {
    storyboardReview.hidden = true;
    return;
  }
  storyboardReview.hidden = false;
  document.getElementById('storyboard-title').textContent = storyboard.title;
  document.getElementById('storyboard-concept').textContent = storyboard.narrativeConcept;
  document.getElementById('storyboard-direction').textContent = storyboard.creativeDirection;
  document.getElementById('storyboard-provider').textContent = `Provider: ${project.storyboardProvider || 'mock-provider'}`;
  const shotContainer = document.getElementById('storyboard-shots');
  shotContainer.replaceChildren();
  for (const shot of storyboard.shots) {
    const card = document.createElement('article');
    card.className = 'storyboard-shot';
    const title = document.createElement('h3');
    title.textContent = `${shot.id} · ${shot.durationSeconds}s`;
    card.append(title);
    for (const [label, value] of [
      ['Purpose', shot.purpose],
      ['On-screen copy', shot.onScreenCopy],
      ['Main visual', shot.mainVisual],
      ['Composition', shot.composition],
      ['Camera', shot.cameraBehavior],
      ['Motion', shot.motionBehavior],
      ['Transitions', `${shot.transitionIn} → ${shot.transitionOut}`],
    ]) {
      const paragraph = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = `${label}: `;
      paragraph.append(strong, document.createTextNode(value));
      card.append(paragraph);
    }
    const criteria = document.createElement('ul');
    for (const criterion of shot.acceptanceCriteria) {
      const item = document.createElement('li');
      item.textContent = criterion;
      criteria.append(item);
    }
    card.append(criteria);
    shotContainer.append(card);
  }
  appendList(document.getElementById('storyboard-constraints'), storyboard.hardConstraints);
  appendList(document.getElementById('technical-criteria'), storyboard.acceptanceCriteria.technical);
  appendList(document.getElementById('creative-criteria'), storyboard.acceptanceCriteria.creative);
  document.getElementById('acceptance-output').textContent = JSON.stringify(project.acceptance, null, 2);
}

function renderTimeline() {
  const timeline = project.timeline;
  compiledProduction.hidden = !timeline;
  document.getElementById('timeline-render-controls').hidden = !timeline;
  const visualization = document.getElementById('timeline-visualization');
  const summary = document.getElementById('timeline-summary');
  const timelineJson = document.getElementById('timeline-json');
  if (!timeline) {
    document.getElementById('timeline-title').textContent = 'No compiled sequence';
    document.getElementById('timeline-format').textContent = 'Awaiting approval';
    summary.hidden = true;
    timelineJson.hidden = true;
    visualization.innerHTML = '<p class="results-empty">Approve a storyboard to compile and visualize its multi-shot sequence.</p>';
    return;
  }
  document.getElementById('timeline-title').textContent = timeline.title;
  document.getElementById('timeline-format').textContent = `${timeline.width} × ${timeline.height} · ${timeline.fps} FPS`;
  document.getElementById('result-title').textContent = timeline.title;
  document.getElementById('result-shot-count').textContent = String(timeline.shots.length);
  document.getElementById('result-dimensions').textContent = `${timeline.width} × ${timeline.height} @ ${timeline.fps} fps`;
  document.getElementById('result-duration').textContent = `${timeline.durationInSeconds} seconds`;
  document.getElementById('result-frame-count').textContent = String(timeline.totalFrames);
  document.getElementById('result-provider').textContent = `Compiled by ${project.compileProvider || 'mock-provider'}`;
  document.getElementById('spec-output').textContent = JSON.stringify(timeline, null, 2);
  visualization.replaceChildren();
  for (const shot of timeline.shots) {
    const row = document.createElement('div');
    row.className = 'timeline-shot';
    const label = document.createElement('span');
    label.className = 'timeline-shot-label';
    label.textContent = shot.shotId;
    const bar = document.createElement('div');
    bar.className = 'timeline-shot-bar';
    bar.style.width = `${Math.max(20, shot.durationFrames / timeline.totalFrames * 100)}%`;
    bar.textContent = shot.spec.title;
    const range = document.createElement('small');
    range.textContent = `Frames ${shot.startFrame}–${shot.endFrame} · ${shot.durationSeconds.toFixed(2)} sec · ${shot.purpose}`;
    bar.append(range);
    row.append(label, bar);
    visualization.append(row);
  }
  summary.hidden = false;
  summary.textContent = `${timeline.shots.length} shots · ${timeline.totalFrames} frames · ${timeline.durationInSeconds.toFixed(2)} seconds`;
  timelineJson.hidden = false;
  timelineJson.textContent = JSON.stringify(timeline, null, 2);
}

function metricCard(title, pass, detail) {
  const card = document.createElement('article');
  card.className = `qa-metric ${pass ? 'is-pass' : 'is-fail'}`;
  const heading = document.createElement('h3');
  heading.textContent = title;
  const result = document.createElement('strong');
  result.textContent = pass ? 'PASS' : 'FAIL';
  const description = document.createElement('p');
  description.textContent = detail;
  card.append(heading, result, description);
  return card;
}

function renderQa() {
  const report = project.renderReport;
  finalApprovalButton.disabled = !(
    project.state === 'QA'
    && report?.productionQA?.pass
    && report?.creativeQA?.pass
  );
  if (!report) {
    qaStatus.textContent = 'Not run';
    qaMetrics.innerHTML = '<p class="results-empty">Render the approved timeline to collect QA evidence.</p>';
    return;
  }
  const production = report.productionQA;
  const creative = report.creativeQA;
  qaStatus.textContent = production.pass && creative.pass ? 'All checks passed' : 'Review required';
  qaMetrics.replaceChildren(
    metricCard(
      'Dimensions',
      production.dimensions.pass,
      `${production.dimensions.actual.width} × ${production.dimensions.actual.height} (expected ${production.dimensions.expected.width} × ${production.dimensions.expected.height})`,
    ),
    metricCard('FPS', production.fps.pass, `${Number.isFinite(production.fps.actual) ? production.fps.actual : 'Unavailable'} fps (expected ${production.fps.expected})`),
    metricCard(
      'Frame integrity',
      production.frameIntegrity.pass,
      `${production.frameIntegrity.encodedVideoFrames} encoded / ${production.frameIntegrity.expectedFrames} expected frames; ${production.frameIntegrity.hashedFrameFiles} hashed SVG/PNG files`,
    ),
    metricCard(
      'Duration',
      production.duration.pass,
      `${Number.isFinite(production.duration.actual) ? production.duration.actual.toFixed(2) : 'Unavailable'} sec (expected ${production.duration.expected.toFixed(2)} sec)`,
    ),
    metricCard(
      'Contrast',
      creative.contrast.pass,
      `Minimum ${creative.contrast.minimumRatio.toFixed(2)}:1; required ${creative.contrast.requiredRatio}:1`,
    ),
    metricCard(
      'Legibility',
      creative.legibility.pass,
      `${creative.legibility.textElementCount} text elements; minimum font size ${creative.legibility.minimumFontSize}px`,
    ),
    metricCard(
      'Brand fidelity',
      creative.brandFidelity.pass,
      `Primary ${creative.brandFidelity.primaryColor}; accent ${creative.brandFidelity.accentColor}`,
    ),
  );
}

function renderDelivery() {
  markDeliveredButton.disabled = project.state !== 'APPROVED';
  markDeliveredButton.hidden = project.state === 'DELIVERED';
  deliveryStatus.textContent = project.state === 'DELIVERED'
    ? 'Delivered'
    : project.state === 'APPROVED' ? 'Ready to deliver' : 'Approval required';
  const artifacts = project.renderReport?.artifacts;
  if (project.state !== 'DELIVERED' || !artifacts) {
    deliveryArtifacts.innerHTML = '<p class="results-empty">Exports will be available after final-cut approval and delivery.</p>';
    return;
  }
  deliveryArtifacts.replaceChildren();
  for (const [label, url] of [
    ['Final video (MP4)', artifacts.video],
    ['Editable source project', artifacts.source],
    ['Canonical timeline.json', artifacts.timeline],
    ['Approved storyboard', artifacts.storyboard],
    ['Acceptance specification', artifacts.acceptance],
    ['Production QA report', artifacts.qa],
  ]) {
    if (typeof url !== 'string' || !url.startsWith('/output/') || url.includes('..')) continue;
    const link = document.createElement('a');
    link.className = 'delivery-artifact';
    link.href = url;
    link.textContent = label;
    if (label.includes('MP4')) link.download = '';
    deliveryArtifacts.append(link);
  }
}

function renderProject() {
  const currentIndex = PROJECT_STATES.indexOf(project.state);
  document.getElementById('project-state-label').textContent = project.state;
  document.getElementById('project-state-chip').textContent = stateLabels[project.state];
  document.getElementById('pipeline-project-state').textContent = project.state;
  for (const step of document.querySelectorAll('#state-steps [data-state]')) {
    const index = PROJECT_STATES.indexOf(step.dataset.state);
    step.classList.toggle('is-current', index === currentIndex);
    step.classList.toggle('is-complete', index < currentIndex);
  }
  approveStoryboardButton.disabled = project.state !== 'STORYBOARD_REVIEW'
    && project.state !== 'BUILDING';
  for (const button of document.querySelectorAll('.render-trigger, #render-production')) {
    button.disabled = project.state !== 'RENDERING';
  }
  approveStoryboardButton.textContent = project.state === 'BUILDING'
    ? 'Retry production compilation'
    : 'Approve storyboard & compile production code';
  renderStoryboard();
  renderTimeline();
  renderQa();
  renderDelivery();
  renderProjectsSidebar();
  persistProject();
}

async function buildProduction() {
  if (!['STORYBOARD_REVIEW', 'BUILDING'].includes(project.state)) return;
  approveStoryboardButton.disabled = true;
  formMessage.textContent = 'Approving storyboard and compiling validated shot specifications…';
  beginTelemetry('Approving storyboard', 'Recording approval and preparing deterministic shot compilation.', 5);
  setTelemetryBusy(true);
  const heartbeat = startTelemetryHeartbeat('Production compilation is still running; waiting for the provider response.');
  try {
    if (project.state === 'STORYBOARD_REVIEW') {
      await transitionTo('BUILDING', { storyboardApproved: true });
      approveStoryboardButton.disabled = true;
    }
    logTelemetry('Compiling production', 'Storyboard approved; validating shot specifications and applying the selected palette.', 12);
    const result = await requestJson('/api/generate', {
      action: 'compile',
      storyboard: project.storyboard,
      context: project.context,
    });
    setTelemetryBusy(false);
    logTelemetry('Shot specifications received', `${result.provider} returned ${result.timeline.shots.length} shots for timeline validation.`, 78);
    project.timeline = result.timeline;
    project.compileProvider = result.provider;
    await transitionTo('RENDERING');
    finishTelemetry('Compilation complete', 'Timeline, copy, hard constraints, and palette are ready for rendering.', 100);
    formMessage.textContent = 'Production code compiled. Review the timeline, then render and run QA.';
    renderProject();
  } catch (error) {
    failTelemetry('Compilation failed', error.message);
    formMessage.textContent = `Production compilation failed: ${error.message}`;
    renderProject();
  } finally {
    clearInterval(heartbeat);
  }
}

async function renderProduction() {
  if (project.state !== 'RENDERING' || !project.timeline) return;
  const renderMessage = document.getElementById('render-message');
  for (const button of document.querySelectorAll('.render-trigger, #render-production')) button.disabled = true;
  renderMessage.textContent = 'Rendering deterministic frames, encoding MP4, and running QA…';
  beginTelemetry('Rendering production', 'Renderer accepted the validated timeline; generating frames and running QA.', 8);
  setTelemetryBusy(true);
  const heartbeat = startTelemetryHeartbeat('Frame rendering and video encoding are in progress; waiting for render and QA results.');
  try {
    const result = await requestJson('/api/render', {
      timeline: project.timeline,
      storyboard: project.storyboard,
      acceptance: project.acceptance,
      context: project.context,
    });
    setTelemetryBusy(false);
    logTelemetry('Frames rendered', 'Renderer returned the video and frame evidence; finalizing production QA.', 88);
    project.renderReport = result.report;
    await transitionTo('QA');
    finishTelemetry(
      result.qaCommandPassed ? 'Production and QA complete' : 'Render complete with QA warning',
      result.qaCommandPassed ? 'Verified render and QA evidence are ready for review.' : (result.qaError || 'Review the reported QA metrics.'),
      100,
    );
    renderMessage.textContent = result.qaCommandPassed
      ? 'Render complete. Technical and creative QA evidence is ready for review.'
      : `Render completed; QA command reported a failure: ${result.qaError || 'review the QA metrics.'}`;
    qaMessage.textContent = result.qaError || '';
    renderQa();
    showView('qa');
  } catch (error) {
    failTelemetry('Render failed', error.message);
    renderMessage.textContent = `Local render or QA could not complete: ${error.message}`;
  } finally {
    clearInterval(heartbeat);
    for (const button of document.querySelectorAll('.render-trigger, #render-production')) {
      button.disabled = project.state !== 'RENDERING';
    }
  }
}

for (const button of navButtons) button.addEventListener('click', () => showView(button.dataset.view));
telemetryToggle.addEventListener('click', toggleTelemetryDock);

for (const button of document.querySelectorAll('.tool-pill')) {
  button.addEventListener('click', () => {
    for (const pill of document.querySelectorAll('.tool-pill')) {
      const selected = pill === button;
      pill.classList.toggle('is-selected', selected);
      pill.setAttribute('aria-pressed', String(selected));
    }
    document.getElementById('active-tool').textContent = button.querySelector('span').textContent;
  });
}

for (const button of document.querySelectorAll('.category-chip')) {
  button.addEventListener('click', () => {
    button.classList.toggle('is-selected');
    const category = button.textContent.trim();
    const currentPrompt = promptInput.value.trim();
    const categoryText = `Create a ${category.toLowerCase()} motion scene`;
    if (button.classList.contains('is-selected')) {
      if (!currentPrompt) promptInput.value = categoryText;
      else if (!currentPrompt.toLowerCase().includes(category.toLowerCase())) {
        promptInput.value = `${currentPrompt.replace(/[.\s]+$/, '')} — ${categoryText}`;
      }
    } else if (currentPrompt === categoryText) promptInput.value = '';
    promptInput.focus();
  });
}

document.getElementById('new-production').addEventListener('click', () => {
  project = createLocalProject();
  logTelemetry('New production ready', 'Telemetry is ready for a new brief.', 0, 'IDLE');
  promptInput.value = '';
  document.getElementById('headline-input').value = '';
  document.getElementById('subheadline-input').value = '';
  document.getElementById('primary-color-input').value = DEFAULT_CONTEXT.primaryColor;
  document.getElementById('accent-color-input').value = DEFAULT_CONTEXT.accentColor;
  formMessage.textContent = '';
  document.getElementById('render-message').textContent = '';
  qaMessage.textContent = '';
  renderProject();
  showView('studio');
  promptInput.focus();
});

recentProjectList.addEventListener('click', (event) => {
  const projectButton = event.target.closest('button[data-project-id]');
  if (projectButton) loadArchivedProject(projectButton.dataset.projectId);
});

promptForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) {
    formMessage.textContent = 'Enter a motion brief before creating a storyboard.';
    promptInput.focus();
    return;
  }
  if (!['BRIEF', 'PLANNING'].includes(project.state)) {
    project = createLocalProject();
  }
  project.brief = prompt;
  project.context = readBriefContext();
  persistProject();
  submitButton.disabled = true;
  submitButton.textContent = 'Developing storyboard…';
  formMessage.textContent = 'Interpreting the brief and creating acceptance criteria…';
  beginTelemetry('Planning storyboard', 'Validating your brief and sending it to the configured creative provider.', 6);
  setTelemetryBusy(true);
  const heartbeat = startTelemetryHeartbeat('Storyboard generation is still running; waiting for structured creative direction.');
  try {
    if (project.state === 'BRIEF') await transitionTo('PLANNING');
    setTelemetryBusy(false);
    logTelemetry('Brief accepted', 'Project state is PLANNING; generating storyboard and acceptance criteria.', 22);
    setTelemetryBusy(true);
    const result = await requestJson('/api/generate', {
      action: 'storyboard',
      prompt,
      context: project.context,
    });
    setTelemetryBusy(false);
    logTelemetry('Storyboard received', `${result.provider} returned ${result.storyboard.shots.length} shots and acceptance criteria.`, 78);
    project.storyboard = result.storyboard;
    project.storyboardProvider = result.provider;
    project.acceptance = result.acceptance;
    await transitionTo('STORYBOARD_REVIEW');
    finishTelemetry('Storyboard ready for review', 'Storyboard and acceptance criteria are ready for human approval.', 100);
    formMessage.textContent = 'Storyboard ready. Human approval is required before production code is compiled.';
  } catch (error) {
    failTelemetry('Storyboard planning failed', error.message);
    formMessage.textContent = `Storyboard planning failed: ${error.message}`;
  } finally {
    clearInterval(heartbeat);
    submitButton.disabled = false;
    submitButton.textContent = 'Generate creative storyboard ↗';
  }
});

approveStoryboardButton.addEventListener('click', buildProduction);
renderButton.addEventListener('click', renderProduction);
for (const button of document.querySelectorAll('.render-trigger')) button.addEventListener('click', renderProduction);

finalApprovalButton.addEventListener('click', async () => {
  qaMessage.textContent = '';
  try {
    await transitionTo('APPROVED', { finalCutApproved: true });
    qaMessage.textContent = 'Final cut approved. Delivery exports can now be released.';
  } catch (error) {
    qaMessage.textContent = `Final approval blocked: ${error.message}`;
  }
});

markDeliveredButton.addEventListener('click', async () => {
  try {
    await transitionTo('DELIVERED');
  } catch (error) {
    deliveryStatus.textContent = `Delivery blocked: ${error.message}`;
  }
});

if (project.brief) promptInput.value = project.brief;
if (project.context) {
  document.getElementById('headline-input').value = project.context.headline || '';
  document.getElementById('subheadline-input').value = project.context.subheadline || '';
  document.getElementById('primary-color-input').value = project.context.primaryColor || DEFAULT_CONTEXT.primaryColor;
  document.getElementById('accent-color-input').value = project.context.accentColor || DEFAULT_CONTEXT.accentColor;
}
restoreTelemetrySession();
renderProject();
