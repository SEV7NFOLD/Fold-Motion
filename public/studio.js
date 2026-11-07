import { PROJECT_STATES } from './workflow-states.mjs';

/*
 * FOLD Motion Studio: one conversation per production.
 *
 * The director types briefs and change requests. The system answers with cards
 * (storyboard, built shots, render and QA, delivery). Every human gate is a button
 * inside the card it approves, and can also be answered by typing "approve".
 */

const STORE_KEY = 'fold-motion.studio.v3';
const LEGACY_PROJECT_KEY = 'fold-motion.project.v2';
const LEGACY_ARCHIVE_KEY = 'fold_motion_projects_archive';
const LOG_LIMIT = 300;

const DEFAULT_CONTEXT = Object.freeze({
  width: 1280,
  height: 720,
  fps: 24,
  primaryColor: '#0B0F19',
  accentColor: '#00F0FF',
  headline: '',
  subheadline: '',
});

const STAGE_OF_STATE = {
  BRIEF: 0, PLANNING: 1, STORYBOARD_REVIEW: 1, BUILDING: 2, RENDERING: 3, QA: 4, APPROVED: 5, DELIVERED: 5,
};
const WAITING_STATES = new Set(['STORYBOARD_REVIEW', 'RENDERING', 'QA', 'APPROVED']);
const STATUS_TEXT = {
  BRIEF: 'Waiting for a brief',
  PLANNING: 'Writing the storyboard',
  STORYBOARD_REVIEW: 'Storyboard needs your approval',
  BUILDING: 'Building the shots',
  RENDERING: 'Ready to render',
  QA: 'Cut needs your review',
  APPROVED: 'Approved, ready to deliver',
  DELIVERED: 'Delivered',
};
const PLACEHOLDERS = {
  NEW: 'Describe the film you want to make',
  PLANNING: 'Writing the storyboard…',
  STORYBOARD_REVIEW: 'Approve above, or tell me what to change',
  BUILDING: 'Tell me what to change. This restarts from the storyboard',
  RENDERING: 'Say render, or tell me what to change',
  QA: 'Approve the cut above, or tell me what to change',
  APPROVED: 'Say deliver, or tell me what to change',
  DELIVERED: 'Describe your next film',
};
const FALLBACK_REASONS = {
  quota: 'Gemini’s quota is used up for now (HTTP 429). On the free tier, Flash-Lite has a far larger daily quota than Flash.',
  unconfigured: 'No AI keys are set on the server.',
  output: 'The model answered, but the answer couldn’t be used even after repair.',
  auth: 'The server’s API key was rejected.',
  config: 'The configured model isn’t available. Check GEMINI_MODEL on the server.',
  timeout: 'The AI took too long to answer. Try it again.',
  network: 'The AI provider couldn’t be reached.',
  overload: 'Google’s servers were overloaded (HTTP 503), even after a retry and a backup model. That’s on Google’s side, not your key. Try the AI again in a minute.',
  provider: 'Every configured AI provider failed.',
};
const STARTERS = [
  {
    label: 'Perfume launch',
    brief: 'A 10-second launch film for a perfume called Nocturne: black glass, slow light sweeps, one line of copy.',
    copy: 'Nocturne',
    primaryColor: '#0B0B10',
    accentColor: '#C9A86A',
  },
  {
    label: 'Showreel opener',
    brief: 'A fast kinetic-type opener for the SEV7N FOLD showreel that ends on the studio name.',
    copy: 'SEV7N FOLD',
    primaryColor: '#141518',
    accentColor: '#7C3AED',
  },
  {
    label: 'Product teaser',
    brief: 'An 8-second teaser for a skincare serum: warm light, calm pacing, minimal copy.',
    copy: 'Glow, slowly',
    primaryColor: '#1B1310',
    accentColor: '#E8B48A',
  },
];
// Mirrors MOTION_OPTIONS in src/production/motion.mjs; a drift test keeps them in sync.
const MOTION_LABELS = {
  camera: { static: 'Locked off', 'push-in': 'Push in', 'pull-out': 'Pull out', 'drift-left': 'Drift left', 'drift-right': 'Drift right' },
  entrance: { 'rise-glitch': 'Rise and glitch', fade: 'Fade', 'slide-up': 'Slide up', 'slide-left': 'Slide in', 'scale-in': 'Scale in', 'type-on': 'Type on', wipe: 'Wipe' },
  atmosphere: { orbit: 'Orbit', spotlight: 'Spotlight', grid: 'Grid', lines: 'Lines', clean: 'Clean' },
};
const DEFAULT_MOTION = { camera: 'static', entrance: 'rise-glitch', atmosphere: 'orbit' };

const APPROVE_WORDS = /^(approve|approved|lgtm|looks good|ship it|go ahead|go|yes|yep|ok|okay)\b[\s.!]*$/i;
const NEW_WORDS = /^(new|new production|new project|start over)[\s.!]*$/i;

// ------------------------------------------------------------------ dom helpers

function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value);
    else if (value === true) element.setAttribute(key, '');
    else element.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  }
  return element;
}

const $ = (id) => document.getElementById(id);
const nowIso = () => new Date().toISOString();
const clockTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const seconds = (value) => `${Number(value).toFixed(Number.isInteger(Number(value)) ? 0 : 1)}s`;
const safeOutputUrl = (url) => typeof url === 'string' && url.startsWith('/output/') && !url.includes('..');
const isHex = (value) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);

function relativeTime(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

// ------------------------------------------------------------------ store

function freshProject(id, brief, context) {
  return {
    id,
    brief,
    context: { ...context },
    state: 'BRIEF',
    storyboard: null,
    acceptance: null,
    timeline: null,
    renderReport: null,
    history: [{ state: 'BRIEF', at: nowIso() }],
  };
}

function cleanContext(context = {}) {
  const merged = { ...DEFAULT_CONTEXT, ...context };
  return {
    width: DEFAULT_CONTEXT.width,
    height: DEFAULT_CONTEXT.height,
    fps: DEFAULT_CONTEXT.fps,
    primaryColor: isHex(merged.primaryColor) ? merged.primaryColor.toUpperCase() : DEFAULT_CONTEXT.primaryColor,
    accentColor: isHex(merged.accentColor) ? merged.accentColor.toUpperCase() : DEFAULT_CONTEXT.accentColor,
    headline: typeof merged.headline === 'string' ? merged.headline : '',
    subheadline: typeof merged.subheadline === 'string' ? merged.subheadline : '',
  };
}

function newRecord(context) {
  const id = `production-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const at = nowIso();
  const cleaned = cleanContext(context);
  return {
    id,
    title: '',
    createdAt: at,
    updatedAt: at,
    version: 1,
    briefs: [],
    context: cleaned,
    project: freshProject(`${id}-v1`, '', cleaned),
    messages: [],
    providers: {},
  };
}

function emptyStore() {
  return { version: 3, activeId: null, records: {}, log: [] };
}

function loadStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY));
    if (parsed?.version === 3 && parsed.records && typeof parsed.records === 'object') {
      for (const record of Object.values(parsed.records)) {
        if (!PROJECT_STATES.includes(record?.project?.state)) delete parsed.records[record?.id];
      }
      parsed.log = Array.isArray(parsed.log) ? parsed.log.slice(-LOG_LIMIT) : [];
      return parsed;
    }
  } catch {
    // Corrupt storage falls through to a fresh store.
  }
  return migrateLegacy();
}

/** Brings projects from the previous dashboard studio into conversations. */
function migrateLegacy() {
  const store = emptyStore();
  try {
    const current = JSON.parse(localStorage.getItem(LEGACY_PROJECT_KEY) || 'null');
    const archive = JSON.parse(localStorage.getItem(LEGACY_ARCHIVE_KEY) || '[]');
    const projects = Array.isArray(archive) ? archive.map((entry) => entry?.project).filter(Boolean) : [];
    if (current?.brief && !projects.some((project) => project.id === current.id)) projects.unshift(current);
    for (const project of projects) {
      if (!PROJECT_STATES.includes(project.state)) continue;
      const record = newRecord(project.context);
      record.id = `legacy-${project.id}`;
      record.project = project;
      record.briefs = project.brief ? [project.brief] : [];
      const add = (role, type, data) => record.messages.push({ id: `m${record.messages.length}`, at: nowIso(), role, type, version: 1, data });
      if (project.brief) add('director', 'text', { text: project.brief });
      if (project.storyboard) add('system', 'storyboard', { storyboard: project.storyboard, acceptance: project.acceptance, provider: project.storyboardProvider || 'mock-provider', context: project.context });
      if (project.timeline) add('system', 'timeline', { timeline: project.timeline, provider: project.compileProvider || 'mock-provider' });
      if (project.renderReport) add('system', 'render', { report: project.renderReport, qaCommandPassed: true });
      if (['APPROVED', 'DELIVERED'].includes(project.state)) add('system', 'approved', {});
      if (project.state === 'DELIVERED') add('system', 'delivered', { artifacts: project.renderReport?.artifacts });
      record.title = project.storyboard?.title || '';
      store.records[record.id] = record;
    }
    const imported = Object.keys(store.records);
    store.activeId = imported[0] ?? null;
    if (imported.length) {
      store.log.push({ at: nowIso(), stage: 'Imported projects', message: `Brought ${imported.length} project${imported.length === 1 ? '' : 's'} over from the previous studio.` });
    }
  } catch {
    // Unreadable legacy data is ignored.
  }
  return store;
}

let store = loadStore();
let saveWarningShown = false;

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (error) {
    if (!saveWarningShown) {
      saveWarningShown = true;
      store.log.push({ at: nowIso(), stage: 'Save failed', message: `This browser refused to save studio data: ${error.message}`, level: 'fault' });
    }
  }
}

function activeRecord() {
  let record = store.records[store.activeId];
  if (!record) {
    record = newRecord();
    store.records[record.id] = record;
    store.activeId = record.id;
  }
  return record;
}

function listedRecords() {
  return Object.values(store.records)
    .filter((record) => record.messages.length > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function recordTitle(record) {
  const fromBrief = record.briefs[0]?.split(/\r?\n/, 1)[0]?.trim() || '';
  const title = record.title || record.context.headline || fromBrief;
  if (!title) return 'New production';
  return title.length > 64 ? `${title.slice(0, 61).trimEnd()}…` : title;
}

function logEvent(stage, message, level) {
  store.log.push({ at: nowIso(), stage, message, ...(level ? { level } : {}) });
  if (store.log.length > LOG_LIMIT) store.log.splice(0, store.log.length - LOG_LIMIT);
}

function absorbTelemetry(events) {
  for (const event of Array.isArray(events) ? events : []) {
    if (typeof event?.stage !== 'string' || typeof event?.message !== 'string') continue;
    logEvent(event.stage, event.message, /failed|skipped|exhausted/i.test(event.stage) ? 'fault' : undefined);
  }
}

// ------------------------------------------------------------------ server

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let result;
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`The server answered with something that isn’t JSON (HTTP ${response.status}).`);
  }
  absorbTelemetry(result.telemetry);
  if (!response.ok || !result.success) {
    throw new Error(result.error || `The request failed with HTTP ${response.status}.`);
  }
  return result;
}

async function transition(record, nextState, evidence) {
  const result = await postJson('/api/state', { project: record.project, nextState, evidence });
  record.project = result.project;
}

// ------------------------------------------------------------------ messages

function addMessage(record, role, type, data = {}) {
  record.messages.push({
    id: `m${Date.now().toString(36)}${record.messages.length}`,
    at: nowIso(),
    role,
    type,
    version: record.version,
    data,
  });
  record.updatedAt = nowIso();
}

const say = (record, text) => addMessage(record, 'system', 'text', { text });
const said = (record, text) => addMessage(record, 'director', 'text', { text });

function providerResult(result) {
  return {
    provider: result.provider,
    warning: result.warning,
    fallbackReason: result.fallbackReason,
    repairs: Array.isArray(result.repairs) ? result.repairs : [],
  };
}

// ------------------------------------------------------------------ actions

let busy = null; // { label, startedAt }

async function work(record, label, failurePrefix, retry, task) {
  if (busy) return;
  busy = { label, startedAt: Date.now(), recordId: record.id };
  render();
  try {
    await task();
    logEvent(label, `Done in ${Math.max(1, Math.round((Date.now() - busy.startedAt) / 1000))}s.`);
  } catch (error) {
    addMessage(record, 'system', 'error', { text: `${failurePrefix}: ${error.message}`, retry });
    logEvent(`${label} failed`, error.message, 'fault');
  } finally {
    busy = null;
    record.updatedAt = nowIso();
    persist();
    render({ stick: true });
  }
}

function composeBrief(briefs) {
  if (briefs.length <= 1) return briefs[0] || '';
  const notes = briefs.slice(1).map((note, index) => `${index + 1}. ${note}`).join('\n');
  return `${briefs[0]}\n\nRevision notes from the director:\n${notes}`;
}

function writeStoryboard(record) {
  return work(record, 'Writing the storyboard', 'Couldn’t write the storyboard', 'storyboard', async () => {
    if (record.project.state === 'BRIEF') await transition(record, 'PLANNING');
    const result = await postJson('/api/generate', {
      action: 'storyboard',
      prompt: record.project.brief,
      context: record.project.context,
    });
    record.project = {
      ...record.project,
      storyboard: result.storyboard,
      acceptance: result.acceptance,
      storyboardProvider: result.provider,
    };
    await transition(record, 'STORYBOARD_REVIEW');
    record.title = result.storyboard.title || record.title;
    record.providers.storyboard = { ...providerResult(result), at: nowIso() };
    addMessage(record, 'system', 'storyboard', {
      storyboard: result.storyboard,
      acceptance: result.acceptance,
      context: record.project.context,
      ...providerResult(result),
    });
  });
}

/** Re-runs the storyboard with the same brief after an offline fallback. */
function retryStoryboardWithAI(record) {
  if (busy) return;
  record.version += 1;
  record.project = freshProject(`${record.id}-v${record.version}`, composeBrief(record.briefs), record.context);
  say(record, 'Trying the AI again with the same brief.');
  persist();
  writeStoryboard(record);
}

function buildShots(record) {
  return work(record, 'Building the shots', 'Couldn’t build the shots', 'compile', async () => {
    if (record.project.state === 'STORYBOARD_REVIEW') {
      await transition(record, 'BUILDING', { storyboardApproved: true });
    }
    const result = await postJson('/api/generate', {
      action: 'compile',
      storyboard: record.project.storyboard,
      context: record.project.context,
    });
    record.project = { ...record.project, timeline: result.timeline, compileProvider: result.provider };
    await transition(record, 'RENDERING');
    record.providers.compile = { ...providerResult(result), at: nowIso() };
    addMessage(record, 'system', 'timeline', { timeline: result.timeline, ...providerResult(result) });
  });
}

function renderFilm(record) {
  return work(record, 'Rendering and checking', 'Couldn’t render the film', 'render', async () => {
    const result = await postJson('/api/render', {
      timeline: record.project.timeline,
      storyboard: record.project.storyboard,
      acceptance: record.project.acceptance,
      context: record.project.context,
    });
    record.project = { ...record.project, renderReport: result.report };
    await transition(record, 'QA');
    addMessage(record, 'system', 'render', {
      report: result.report,
      qaCommandPassed: result.qaCommandPassed,
      qaError: result.qaError,
    });
  });
}

function approveCut(record) {
  return work(record, 'Approving the final cut', 'Couldn’t record the approval', 'approve', async () => {
    await transition(record, 'APPROVED', { finalCutApproved: true });
    addMessage(record, 'system', 'approved', {});
  });
}

function deliver(record) {
  return work(record, 'Delivering', 'Couldn’t deliver', 'deliver', async () => {
    await transition(record, 'DELIVERED');
    addMessage(record, 'system', 'delivered', { artifacts: record.project.renderReport?.artifacts });
  });
}

function qaPasses(report) {
  return report?.productionQA?.pass === true && report?.creativeQA?.pass === true;
}

/** The one action that "approve" means right now, if any. */
function pendingGate(record) {
  switch (record.project.state) {
    case 'STORYBOARD_REVIEW': return { label: 'Approve storyboard', run: () => buildShots(record) };
    case 'BUILDING': return { label: 'Build the shots again', run: () => buildShots(record) };
    case 'RENDERING': return renderBlockedReason() ? null : { label: 'Render and run QA', run: () => renderFilm(record) };
    case 'QA': return qaPasses(record.project.renderReport) ? { label: 'Approve final cut', run: () => approveCut(record) } : null;
    case 'APPROVED': return { label: 'Deliver', run: () => deliver(record) };
    default: return null;
  }
}

function runRetry(record, kind) {
  const actions = {
    storyboard: () => writeStoryboard(record),
    compile: () => buildShots(record),
    render: () => renderFilm(record),
    approve: () => approveCut(record),
    deliver: () => deliver(record),
  };
  actions[kind]?.();
}

function startNewProduction({ focus = true } = {}) {
  const previous = activeRecord();
  const record = newRecord(previous.context);
  store.records[record.id] = record;
  store.activeId = record.id;
  // Drop the previous record if it never got a message.
  if (previous.messages.length === 0) delete store.records[previous.id];
  persist();
  showView('studio');
  if (focus) composerInput.focus();
}

function submitMessage(rawText) {
  const text = rawText.trim();
  if (!text || busy) return;
  let record = activeRecord();
  const state = record.project.state;

  if (NEW_WORDS.test(text)) {
    startNewProduction();
    return;
  }

  if (state === 'RENDERING' && /^render\b/i.test(text) && renderBlockedReason()) {
    said(record, text);
    say(record, renderBlockedReason());
    persist();
    render({ stick: true });
    return;
  }

  const gate = pendingGate(record);
  const wantsGate = (gate && APPROVE_WORDS.test(text))
    || (state === 'RENDERING' && /^render\b/i.test(text))
    || (state === 'APPROVED' && /^deliver\b/i.test(text));
  if (wantsGate && gate) {
    said(record, text);
    gate.run();
    return;
  }
  if (APPROVE_WORDS.test(text) && state === 'QA') {
    said(record, text);
    say(record, 'The cut can’t be approved until every QA check passes. Tell me what to change and I’ll restart from the storyboard.');
    persist();
    render({ stick: true });
    return;
  }

  if (state === 'DELIVERED') {
    const next = newRecord(record.context);
    store.records[next.id] = next;
    store.activeId = next.id;
    record = next;
  }

  if (record.briefs.length > 0 && record.project.state !== 'BRIEF') {
    record.version += 1;
    record.briefs.push(text);
    said(record, text);
    if (STAGE_OF_STATE[state] >= 1) {
      say(record, 'Revising with your notes. The production restarts from the storyboard.');
    }
  } else {
    if (record.briefs.length === 0) record.briefs = [text];
    else record.briefs.push(text);
    said(record, text);
  }
  record.project = freshProject(`${record.id}-v${record.version}`, composeBrief(record.briefs), record.context);
  persist();
  writeStoryboard(record);
}

// ------------------------------------------------------------------ icons

const ICONS = {
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 4.5 21 19.5H3z"/><path d="M12 10v4M12 17h.01"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  play: '<path d="m9 7 8 5-8 5z"/>',
  retry: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
};

function icon(name, className = 'icon') {
  const svg = svgEl('svg', { class: className, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
  svg.innerHTML = ICONS[name];
  return svg;
}

const MARK_PATH = 'M411 85 L0 86 L66 200 L202 203 L147 296 L105 225 L81 224 L147 340 L239 180 L79 179 L37 108 L372 108 L205 397 L188 368 L323 133 L87 133 L98 153 L280 154 L285 156 L164 367 L168 378 L205 440 Z';

function markSvg() {
  const svg = svgEl('svg', { viewBox: '0 0 412 512', 'aria-hidden': 'true', focusable: 'false' });
  svg.append(svgEl('path', { 'fill-rule': 'evenodd', d: MARK_PATH }),
    svgEl('circle', { cx: 205.4, cy: 490.9, r: 20.6 }), svgEl('circle', { cx: 205.4, cy: 20.2, r: 20.6 }));
  return svg;
}

// ------------------------------------------------------------------ frame previews

function wrapText(content, maximumCharacters) {
  const lines = [];
  let line = '';
  for (const word of String(content).trim().split(/\s+/)) {
    if ([...word].length > maximumCharacters) {
      if (line) lines.push(line);
      const characters = [...word];
      while (characters.length > maximumCharacters) lines.push(characters.splice(0, maximumCharacters).join(''));
      line = characters.join('');
    } else if (!line) line = word;
    else if ([...line].length + word.length + 1 <= maximumCharacters) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

let svgCounter = 0;

/**
 * Draws a scene spec's final frame the way scripts/render-production.mjs does:
 * background, then the renderer's atmosphere (glow, grid, rings, accent lines),
 * then the foreground elements and glowing copy.
 */
function specToSvg(spec, label, palette = {}) {
  const width = spec.width || DEFAULT_CONTEXT.width;
  const height = spec.height || DEFAULT_CONTEXT.height;
  const elements = spec.elements || [];
  const isBackground = (element) => element.type === 'rect' && element.x === 0 && element.y === 0
    && element.width === width && element.height === height;
  const primary = isHex(palette.primary) ? palette.primary : elements.find(isBackground)?.fill || '#0B0F19';
  const accent = isHex(palette.accent) ? palette.accent : '#00F0FF';
  const id = `f${(svgCounter += 1)}`;
  const minSide = Math.min(width, height);

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'xMidYMid slice', role: 'img', 'aria-label': label });
  const defs = svgEl('defs');
  const ambient = svgEl('radialGradient', { id: `${id}a`, cx: '74%', cy: '46%', r: '68%' });
  ambient.append(
    svgEl('stop', { offset: 0, 'stop-color': accent, 'stop-opacity': 0.22 }),
    svgEl('stop', { offset: 0.42, 'stop-color': '#FF0055', 'stop-opacity': 0.07 }),
    svgEl('stop', { offset: 1, 'stop-color': primary, 'stop-opacity': 0 }));
  const grid = svgEl('pattern', { id: `${id}g`, width: 42, height: 42, patternUnits: 'userSpaceOnUse' });
  grid.append(svgEl('path', { d: 'M 42 0 L 0 0 0 42', fill: 'none', stroke: accent, 'stroke-width': 0.5, opacity: 0.42 }));
  const glow = svgEl('filter', { id: `${id}t`, x: '-30%', y: '-50%', width: '160%', height: '200%' });
  glow.append(svgEl('feGaussianBlur', { stdDeviation: 5, result: 'blur' }),
    svgEl('feFlood', { 'flood-color': accent, 'flood-opacity': 0.34 }),
    svgEl('feComposite', { in2: 'blur', operator: 'in' }));
  const merge = svgEl('feMerge');
  merge.append(svgEl('feMergeNode'), svgEl('feMergeNode', { in: 'SourceGraphic' }));
  glow.append(merge);
  defs.append(ambient, grid, glow);
  svg.append(defs);

  for (const element of elements.filter(isBackground)) {
    svg.append(svgEl('rect', { x: 0, y: 0, width, height, fill: isHex(element.fill) ? element.fill : primary }));
  }
  if (!elements.some(isBackground)) svg.append(svgEl('rect', { width, height, fill: primary }));

  const motion = { ...DEFAULT_MOTION, ...(spec.motion || {}) };
  // Previews show the final frame, so the camera sits where its move ends.
  const stage = svgEl('g');
  const camera = {
    'push-in': `translate(${width / 2} ${height / 2}) scale(1.08) translate(${-width / 2} ${-height / 2})`,
    'drift-left': `translate(${-width * 0.03} 0)`,
    'drift-right': `translate(${width * 0.03} 0)`,
  }[motion.camera];
  if (camera) stage.setAttribute('transform', camera);
  svg.append(stage);

  const cx = width * 0.76;
  const cy = height * 0.48;
  const gridLines = () => {
    const lines = [];
    for (let x = 0; x <= width; x += 42) lines.push(`M${x} 0V${height}`);
    for (let y = 0; y <= height; y += 42) lines.push(`M0 ${y}H${width}`);
    return svgEl('path', { d: lines.join(''), fill: 'none', stroke: accent, 'stroke-width': 0.5, 'stroke-opacity': 0.1176 });
  };
  const accentLines = () => [
    svgEl('path', { d: `M ${width * 0.08} ${height * 0.78} H ${width * 0.42}`, fill: 'none', stroke: accent, 'stroke-width': 2, opacity: 0.78 }),
    svgEl('path', { d: `M ${width * 0.08} ${height * 0.795} H ${width * 0.23}`, fill: 'none', stroke: '#FF0055', 'stroke-width': 1, opacity: 0.72 }),
  ];
  if (motion.atmosphere === 'orbit') {
    stage.append(
      svgEl('rect', { width, height, fill: `url(#${id}a)`, opacity: 0.7 }),
      gridLines(),
      svgEl('circle', { cx, cy, r: minSide * 0.26, fill: 'none', stroke: accent, 'stroke-width': 1, opacity: 0.42 }),
      svgEl('circle', { cx, cy, r: minSide * 0.31, fill: 'none', stroke: '#FF0055', 'stroke-width': 1, 'stroke-dasharray': '3 12', opacity: 0.34, transform: `rotate(11 ${cx} ${cy})` }),
      ...accentLines());
  } else if (motion.atmosphere === 'spotlight') {
    const spot = svgEl('radialGradient', { id: `${id}s`, cx: '50%', cy: '46%', r: '52%' });
    spot.append(
      svgEl('stop', { offset: 0, 'stop-color': accent, 'stop-opacity': 0.26 }),
      svgEl('stop', { offset: 0.55, 'stop-color': accent, 'stop-opacity': 0.06 }),
      svgEl('stop', { offset: 1, 'stop-color': primary, 'stop-opacity': 0 }));
    defs.append(spot);
    stage.append(svgEl('rect', { width, height, fill: `url(#${id}s)` }));
  } else if (motion.atmosphere === 'grid') {
    stage.append(svgEl('rect', { width, height, fill: `url(#${id}a)`, opacity: 0.45 }), gridLines());
  } else if (motion.atmosphere === 'lines') {
    stage.append(...accentLines());
  }

  for (const element of elements) {
    if (isBackground(element)) continue;
    const fill = isHex(element.fill) ? element.fill : '#F8FAFC';
    if (element.type === 'rect') {
      stage.append(svgEl('rect', { x: element.x, y: element.y, width: element.width, height: element.height, fill }));
    } else if (element.type === 'circle') {
      stage.append(svgEl('circle', { cx: element.x, cy: element.y, r: element.radius ?? 12, fill }));
    } else if (element.type === 'text' && element.content) {
      const size = Math.max(16, Math.min(Number.isFinite(element.fontSize) ? element.fontSize : 32, height * 0.15));
      const lines = wrapText(element.content, Math.max(1, Math.floor((width * 0.76) / (size * 0.58))));
      const anchor = ['middle', 'end'].includes(element.anchor) ? element.anchor : 'start';
      const text = svgEl('text', {
        x: element.x,
        y: element.y - ((lines.length - 1) * size * 0.62) / 2,
        'text-anchor': anchor,
        fill,
        'font-family': 'Montserrat, Arial, sans-serif',
        'font-size': size,
        'font-weight': 700,
        'letter-spacing': Math.max(0.4, size * 0.025),
        filter: `url(#${id}t)`,
      });
      lines.forEach((line, index) => {
        const span = svgEl('tspan', { x: element.x, dy: index === 0 ? 0 : size * 1.2 });
        span.textContent = line;
        text.append(span);
      });
      stage.append(text);
    }
  }
  return svg;
}

/** Mirrors src/production/color.mjs: light or dark text, whichever reads better on the background. */
function readableText(background) {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(background.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  const lightContrast = (0.9536 + 0.05) / (luminance + 0.05);
  const darkContrast = (luminance + 0.05) / (0.0048 + 0.05);
  return lightContrast >= darkContrast ? '#F8FAFC' : '#0B0F19';
}

/** Storyboard shots have no spec yet: preview them with the deterministic layout. */
function storyboardSpec(shot, context) {
  const { width, height, primaryColor, accentColor, subheadline } = cleanContext(context);
  const textFill = readableText(primaryColor);
  const elements = [
    { type: 'rect', x: 0, y: 0, width, height, fill: primaryColor },
    { type: 'rect', x: width * 0.12, y: height * 0.69, width: width * 0.28, height: Math.max(4, height * 0.006), fill: accentColor },
    { type: 'text', content: shot.onScreenCopy, x: width / 2, y: height / 2, fill: textFill, fontSize: Math.max(32, Math.round(height * 0.067)), anchor: 'middle' },
  ];
  if (subheadline && subheadline !== shot.onScreenCopy) {
    elements.push({ type: 'text', content: subheadline, x: width / 2, y: height * 0.61, fill: textFill, fontSize: Math.max(16, Math.round(height * 0.027)), anchor: 'middle' });
  }
  return { width, height, elements };
}

function filmstrip(items, palette) {
  const total = items.reduce((sum, item) => sum + item.duration, 0) || 1;
  const strip = h('div', { class: 'filmstrip' }, items.map((item, index) => h('figure', { class: 'shot' },
    h('div', { class: 'shot-frame' }, specToSvg(item.spec, `Shot ${index + 1}: ${item.copy}`, palette)),
    h('figcaption', {},
      h('div', { class: 'shot-meta' },
        h('span', { class: 'shot-number', text: String(index + 1).padStart(2, '0') }),
        h('span', { class: 'shot-duration', text: seconds(item.duration) })),
      h('p', { class: 'shot-copy', text: item.copy }),
      item.motion ? h('p', { class: 'shot-tags' }, ['camera', 'entrance', 'atmosphere'].map((field) => h('span', {
        class: 'shot-tag',
        title: field,
        text: MOTION_LABELS[field][{ ...DEFAULT_MOTION, ...item.motion }[field]] || '',
      }))) : null,
      item.purpose ? h('p', { class: 'shot-purpose', text: item.purpose }) : null))));
  const track = h('div', { class: 'timebar-track', 'aria-hidden': 'true' }, items.map((item) => {
    const segment = h('span', { class: 'timebar-segment' });
    segment.style.setProperty('--duration', String(item.duration));
    return segment;
  }));
  return [strip, h('div', { class: 'timebar' }, track, h('span', { class: 'timebar-total', text: `${seconds(total)} total` }))];
}

// ------------------------------------------------------------------ message views

const openPanels = new Map();

/** Pill toggles that open one detail panel at a time. */
function toggles(key, entries) {
  const row = h('div', { class: 'toggle-row' });
  const panel = h('div', { class: 'toggle-panel', hidden: true });
  const buttons = [];
  const show = (index) => {
    const current = openPanels.get(key);
    const next = current === index ? undefined : index;
    if (next === undefined) openPanels.delete(key);
    else openPanels.set(key, next);
    buttons.forEach((button, buttonIndex) => button.setAttribute('aria-expanded', String(buttonIndex === next)));
    panel.hidden = next === undefined;
    if (next !== undefined) panel.replaceChildren(entries[next].render());
  };
  entries.forEach((entry, index) => {
    const button = h('button', { class: 'toggle', type: 'button', 'aria-expanded': 'false', onclick: () => show(index), text: entry.label });
    buttons.push(button);
    row.append(button);
  });
  const container = h('div', { class: 'toggles' }, row, panel);
  if (openPanels.has(key)) {
    const index = openPanels.get(key);
    openPanels.delete(key);
    show(index);
  }
  return container;
}

function plainList(items) {
  return h('ul', { class: 'plain-list' }, (items || []).map((item) => h('li', { text: item })));
}

function providerName(provider) {
  return provider === 'mock-provider' ? 'Offline fallback' : provider;
}

function meta(data, suffix) {
  const fallback = data.provider === 'mock-provider';
  return h('p', { class: 'meta' },
    h('span', { class: `meta-dot${fallback ? ' is-fallback' : ''}`, 'aria-hidden': 'true' }),
    `${suffix} ${providerName(data.provider)}`);
}

function note(kind, ...content) {
  return h('div', { class: `note${kind === 'fault' ? ' note-fault' : ''}` },
    icon(kind === 'fault' ? 'alert' : 'info', 'icon note-icon'),
    h('div', { class: 'note-body' }, ...content));
}

function providerNotes(data, key) {
  const notes = [];
  if (data.provider === 'mock-provider') {
    notes.push(note('info',
      h('p', {}, h('strong', { text: 'Made by the offline fallback, not AI. ' }),
        FALLBACK_REASONS[data.fallbackReason] || FALLBACK_REASONS.provider, ' ',
        h('button', { class: 'link-button', type: 'button', onclick: () => showView('system'), text: 'See what happened' }))));
  }
  if (data.repairs?.length) {
    const count = data.repairs.length;
    notes.push(note('info',
      h('p', { text: `Fixed ${count} slip${count === 1 ? '' : 's'} in the model’s output so it matches your brief and brand.` }),
      toggles(`${key}-repairs`, [{ label: 'Show fixes', render: () => h('ul', {}, data.repairs.map((repair) => h('li', { text: repair }))) }])));
  }
  return notes;
}

function stamp(text, superseded = false) {
  return h('p', { class: `stamp${superseded ? ' is-superseded' : ''}`, text });
}

function askForChanges() {
  composerInput.placeholder = 'What should change?';
  composerInput.focus();
}

function goButton(label, run) {
  return h('button', { class: 'pill pill-go', type: 'button', disabled: Boolean(busy), onclick: run, text: label });
}

function changesButton() {
  return h('button', { class: 'pill', type: 'button', disabled: Boolean(busy), onclick: askForChanges, text: 'Ask for changes' });
}

/** Gate contents depend on the live project state, so they're redrawn on every render. */
function fillGate(slot, message, record) {
  const state = record.project.state;
  const stage = PROJECT_STATES.indexOf(state);
  const superseded = message.version !== record.version;
  const content = [];

  if (message.type === 'error') {
    const isLast = record.messages.at(-1) === message;
    if (isLast && !superseded && message.data.retry) {
      content.push(h('button', { class: 'pill', type: 'button', disabled: Boolean(busy), onclick: () => runRetry(record, message.data.retry) }, icon('retry'), 'Try again'));
    }
  } else if (superseded) {
    content.push(stamp('Replaced by a newer version', true));
  } else if (message.type === 'storyboard') {
    if (state === 'STORYBOARD_REVIEW') {
      content.push(goButton('Approve storyboard', () => buildShots(record)));
      if (message.data.provider === 'mock-provider') {
        content.push(h('button', { class: 'pill', type: 'button', disabled: Boolean(busy), onclick: () => retryStoryboardWithAI(record) }, icon('retry'), 'Try AI again'));
      }
      content.push(changesButton());
    }
    else if (stage > PROJECT_STATES.indexOf('STORYBOARD_REVIEW')) content.push(stamp('Storyboard approved'));
  } else if (message.type === 'timeline') {
    if (state === 'RENDERING') {
      content.push(goButton('Render and run QA', () => renderFilm(record)), changesButton());
      const blocked = renderBlockedReason();
      if (blocked) {
        content[0].disabled = true;
        content.push(h('p', { class: 'gate-note', text: blocked }));
      }
    }
    else if (stage > PROJECT_STATES.indexOf('RENDERING')) content.push(stamp('Rendered'));
  } else if (message.type === 'render') {
    if (state === 'QA') {
      const passes = qaPasses(message.data.report);
      content.push(goButton('Approve final cut', () => approveCut(record)), changesButton());
      if (!passes) {
        content[0].disabled = true;
        content.push(h('p', { class: 'gate-note', text: 'Every check has to pass before the cut can be approved. Ask for changes to fix the failing checks.' }));
      }
    } else if (stage > PROJECT_STATES.indexOf('QA')) content.push(stamp('Final cut approved'));
  } else if (message.type === 'approved') {
    if (state === 'APPROVED') content.push(goButton('Deliver', () => deliver(record)));
  }

  slot.replaceChildren(...content);
  slot.hidden = content.length === 0;
}

function systemMessage(...children) {
  return h('article', { class: 'msg msg-system' },
    h('div', { class: 'avatar', 'aria-hidden': 'true' }, markSvg()),
    h('div', { class: 'msg-body' }, h('span', { class: 'sr-only', text: 'FOLD Motion: ' }), ...children));
}

function storyboardView(message) {
  const { storyboard, acceptance, context } = message.data;
  const shots = storyboard.shots || [];
  const total = shots.reduce((sum, shot) => sum + (Number(shot.durationSeconds) || 0), 0);
  const palette = { primary: cleanContext(context).primaryColor, accent: cleanContext(context).accentColor };
  const gate = h('div', { class: 'gate' });
  const node = systemMessage(
    h('p', { class: 'msg-text', text: `Here’s the storyboard. ${shots.length} shot${shots.length === 1 ? '' : 's'}, ${seconds(total)}. Approve it and I’ll build the shots.` }),
    meta(message.data, 'Written by'),
    ...providerNotes(message.data, message.id),
    h('div', { class: 'block' },
      h('div', { class: 'block-head' },
        h('h2', { class: 'block-title', text: storyboard.title }),
        h('span', { class: 'block-badge', text: `${shots.length} shots` })),
      h('p', { class: 'block-lede', text: storyboard.narrativeConcept }),
      ...filmstrip(shots.map((shot) => ({
        duration: Number(shot.durationSeconds) || 1,
        copy: shot.onScreenCopy,
        purpose: shot.purpose,
        spec: storyboardSpec(shot, context),
      })), palette),
      toggles(message.id, [
        {
          label: 'Shot notes',
          render: () => h('div', { class: 'shot-notes' }, shots.map((shot, index) => h('section', { class: 'shot-note' },
            h('h3', {}, h('span', { text: String(index + 1).padStart(2, '0') }), ` / ${seconds(shot.durationSeconds)}`),
            h('dl', {}, [
              ['Purpose', shot.purpose],
              ['On screen', shot.onScreenCopy],
              ['Visual', shot.mainVisual],
              ['Composition', shot.composition],
              ['Camera', shot.cameraBehavior],
              ['Motion', shot.motionBehavior],
              ['Transitions', `${shot.transitionIn} Then: ${shot.transitionOut}`],
              ...(shot.soundCue ? [['Sound', shot.soundCue]] : []),
              ['Must pass', (shot.acceptanceCriteria || []).join(' ')],
            ].flatMap(([term, value]) => [h('dt', { text: term }), h('dd', { text: value })]))))),
        },
        {
          label: 'Direction and criteria',
          render: () => h('div', {},
            h('p', { text: storyboard.creativeDirection }),
            h('p', { class: 'criteria-heading', text: 'Hard constraints' }), plainList(storyboard.hardConstraints),
            h('p', { class: 'criteria-heading', text: 'Technical checks' }), plainList(storyboard.acceptanceCriteria?.technical),
            h('p', { class: 'criteria-heading', text: 'Creative checks' }), plainList(storyboard.acceptanceCriteria?.creative)),
        },
        ...(acceptance ? [{ label: 'Acceptance spec', render: () => h('pre', { class: 'code', text: JSON.stringify(acceptance, null, 2) }) }] : []),
      ]),
      gate));
  return { node, gate };
}

function timelineView(message) {
  const { timeline } = message.data;
  const palette = { primary: timeline.palette?.primary, accent: timeline.palette?.accent };
  const gate = h('div', { class: 'gate' });
  const node = systemMessage(
    h('p', { class: 'msg-text', text: `Shots built: ${timeline.totalFrames} frames at ${timeline.fps} fps. These are the frames the renderer will draw. Render when you’re ready.` }),
    meta(message.data, 'Built by'),
    ...providerNotes(message.data, message.id),
    h('div', { class: 'block' },
      h('div', { class: 'block-head' },
        h('h2', { class: 'block-title', text: timeline.title }),
        h('span', { class: 'block-badge', text: `${timeline.width} × ${timeline.height}` })),
      ...filmstrip(timeline.shots.map((shot) => ({
        duration: shot.durationSeconds,
        copy: shot.spec.elements.find((element) => element.type === 'text')?.content || shot.shotId,
        purpose: shot.purpose,
        motion: shot.spec.motion,
        spec: shot.spec,
      })), palette),
      toggles(message.id, [{ label: 'Timeline JSON', render: () => h('pre', { class: 'code', text: JSON.stringify(timeline, null, 2) }) }]),
      gate));
  return { node, gate };
}

function qaChecks(report) {
  const production = report?.productionQA || {};
  const creative = report?.creativeQA || {};
  const number = (value, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : 'unavailable');
  const checks = [
    ['Dimensions', production.dimensions, (c) => `${c.actual?.width} × ${c.actual?.height}${c.pass ? '' : `, expected ${c.expected?.width} × ${c.expected?.height}`}`],
    ['Frame rate', production.fps, (c) => `${number(c.actual, 0)} fps${c.pass ? '' : `, expected ${c.expected}`}`],
    ['Frames', production.frameIntegrity, (c) => `${c.encodedVideoFrames} of ${c.expectedFrames} encoded`],
    ['Duration', production.duration, (c) => `${number(c.actual)}s${c.pass ? '' : `, expected ${number(c.expected)}s`}`],
    ['Contrast', creative.contrast, (c) => `${number(c.minimumRatio, 1)}:1, needs ${c.requiredRatio}:1`],
    ['Legibility', creative.legibility, (c) => `Smallest text ${c.minimumFontSize}px`],
    ['Brand colors', creative.brandFidelity, (c) => `${String(c.primaryColor).toUpperCase()}, ${String(c.accentColor).toUpperCase()}`],
  ].filter(([, check]) => check);
  return checks.map(([name, check, describe]) => {
    let detail = '';
    try {
      detail = describe(check);
    } catch {
      detail = '';
    }
    return { name, pass: check.pass === true, detail };
  });
}

function renderView(message) {
  const { report, qaError } = message.data;
  const checks = qaChecks(report);
  const failed = checks.filter((check) => !check.pass).length;
  const video = report?.artifacts?.video;
  const gate = h('div', { class: 'gate' });
  const node = systemMessage(
    h('p', { class: 'msg-text', text: failed === 0
      ? 'Your cut is ready. Watch it, then approve the final cut.'
      : `Your cut rendered, but ${failed} check${failed === 1 ? '' : 's'} failed. Ask for changes and I’ll fix them.` }),
    h('div', { class: 'block' },
      safeOutputUrl(video) ? h('video', { class: 'player', src: video, controls: true, preload: 'metadata', playsinline: true }) : null,
      h('p', { class: `qa-summary${failed ? ' is-fail' : ''}` },
        h('span', { class: 'qa-summary-dot', 'aria-hidden': 'true', text: failed ? String(failed) : '✓' }),
        failed ? `${failed} of ${checks.length} QA checks failed` : `All ${checks.length} QA checks passed`),
      h('ul', { class: 'checks' }, checks.map((check) => h('li', { class: `check${check.pass ? '' : ' is-fail'}` },
        h('strong', { text: check.name }), h('span', { text: check.detail })))),
      qaError ? note('fault', h('p', { text: `The QA command reported: ${qaError}` })) : null,
      gate));
  return { node, gate };
}

function exportLinks(artifacts) {
  const film = safeOutputUrl(artifacts?.video) ? artifacts.video : null;
  const sources = [
    ['Source project', artifacts?.source],
    ['Timeline', artifacts?.timeline],
    ['Storyboard', artifacts?.storyboard],
    ['Acceptance spec', artifacts?.acceptance],
    ['QA report', artifacts?.qa],
  ].filter(([, url]) => safeOutputUrl(url));
  return h('div', { class: 'exports' },
    film ? h('a', { class: 'pill pill-go', href: film, download: '' }, icon('download'), 'Download film') : null,
    sources.length ? h('p', { class: 'sources' },
      sources.flatMap(([label, url], index) => [
        index ? h('span', { class: 'sources-slash', 'aria-hidden': 'true', text: ' / ' }) : null,
        h('a', { href: url, text: label }),
      ])) : null);
}

function messageView(message, record) {
  const { type, role, data } = message;
  if (role === 'director') {
    return { node: h('article', { class: 'msg msg-director' }, h('div', { class: 'bubble' }, h('span', { class: 'sr-only', text: 'You: ' }), data.text)) };
  }
  try {
    if (type === 'storyboard') return storyboardView(message);
    if (type === 'timeline') return timelineView(message);
    if (type === 'render') return renderView(message);
  } catch (error) {
    return { node: systemMessage(note('fault', h('p', { text: `This card couldn’t be shown: ${error.message}` }))) };
  }
  if (type === 'approved') {
    const gate = h('div', { class: 'gate' });
    return { node: systemMessage(h('p', { class: 'msg-text', text: 'Final cut approved. Deliver it to add the film and its source files to your Library.' }), gate), gate };
  }
  if (type === 'delivered') {
    return {
      node: systemMessage(
        h('p', { class: 'msg-text', text: `Delivered. ${recordTitle(record)} is in your Library.` }),
        exportLinks(data.artifacts)),
    };
  }
  if (type === 'error') {
    const gate = h('div', { class: 'gate-inline' });
    return { node: systemMessage(note('fault', h('p', {}, h('strong', { text: data.text })), gate)), gate };
  }
  return { node: systemMessage(h('p', { class: 'msg-text', text: data.text })) };
}

// ------------------------------------------------------------------ studio rendering

const studioView = $('view-studio');
const thread = $('thread');
const threadScroll = $('thread-scroll');
const composer = $('composer');
const composerInput = $('composer-input');
const sendButton = $('send');
const detailsToggle = $('details-toggle');
const briefDetails = $('brief-details');
const nodeCache = new Map();
let workingNode = null;
let workingTimer = null;

function renderStarters() {
  $('starters').replaceChildren(...STARTERS.map((starter) => h('button', {
    class: 'starter',
    type: 'button',
    onclick: () => {
      const record = activeRecord();
      record.context = cleanContext({ ...record.context, primaryColor: starter.primaryColor, accentColor: starter.accentColor });
      fillDetails(record);
      persist();
      composerInput.value = starter.brief;
      autosize();
      syncComposer();
      composerInput.focus();
    },
  },
  h('span', { class: 'starter-thumb' }, specToSvg(storyboardSpec({ onScreenCopy: starter.copy }, starter), starter.copy, { primary: starter.primaryColor, accent: starter.accentColor })),
  h('span', { class: 'starter-copy' }, h('span', { class: 'starter-label', text: starter.label }), h('span', { class: 'starter-text', text: starter.brief })))));
}

const WORKING_SKELETON = {
  'Writing the storyboard': 'strip',
  'Building the shots': 'strip',
  'Rendering and checking': 'wide',
};

function updateWorking() {
  if (!workingNode || !busy) return;
  const elapsed = Math.round((Date.now() - busy.startedAt) / 1000);
  const hint = busy.label === 'Rendering and checking'
    ? (elapsed >= 20 ? ', rendering takes a few minutes on small servers' : '')
    : (elapsed >= 25 ? ', AI answers can take a minute' : '');
  workingNode.querySelector('.working-time').textContent = `${elapsed}s${hint}`;
}

function buildWorkingNode() {
  const kind = WORKING_SKELETON[busy.label];
  const skeleton = kind === 'strip'
    ? h('div', { class: 'skeleton-strip', 'aria-hidden': 'true' }, h('span', { class: 'skeleton' }), h('span', { class: 'skeleton' }), h('span', { class: 'skeleton' }))
    : kind === 'wide' ? h('div', { class: 'skeleton-strip', 'aria-hidden': 'true' }, h('span', { class: 'skeleton skeleton-wide' })) : null;
  return h('div', { role: 'status' }, systemMessage(
    h('p', { class: 'working-text' }, h('span', { class: 'shimmer-text', text: `${busy.label}…` }), h('span', { class: 'working-time', text: '0s' })),
    skeleton));
}

function renderThread(record, { stick = false } = {}) {
  const nearBottom = threadScroll.scrollHeight - threadScroll.scrollTop - threadScroll.clientHeight < 160;
  if (thread.dataset.recordId !== record.id) {
    thread.replaceChildren();
    thread.dataset.recordId = record.id;
    stick = true;
  }

  for (const message of record.messages) {
    const key = `${record.id}:${message.id}`;
    let entry = nodeCache.get(key);
    if (!entry) {
      entry = messageView(message, record);
      nodeCache.set(key, entry);
    }
    if (entry.gate) fillGate(entry.gate, message, record);
    if (entry.node.parentNode !== thread) thread.insertBefore(entry.node, workingNode?.parentNode === thread ? workingNode : null);
  }

  if (busy && busy.recordId === record.id) {
    if (!workingNode || workingNode.dataset.label !== busy.label) {
      workingNode?.remove();
      workingNode = buildWorkingNode();
      workingNode.dataset.label = busy.label;
      clearInterval(workingTimer);
      workingTimer = setInterval(updateWorking, 1000);
    }
    thread.append(workingNode);
    updateWorking();
  } else if (workingNode) {
    workingNode.remove();
    workingNode = null;
    clearInterval(workingTimer);
  }

  if (stick || nearBottom) threadScroll.scrollTop = threadScroll.scrollHeight;
}

function renderHead(record) {
  const empty = record.messages.length === 0;
  studioView.classList.toggle('is-empty', empty);
  $('project-title').textContent = recordTitle(record);
  document.title = empty ? 'FOLD Motion — Studio' : `${recordTitle(record)} — FOLD Motion`;
  const state = record.project.state;
  const current = STAGE_OF_STATE[state];
  for (const item of $('stages').children) {
    const index = Number(item.dataset.stage);
    const done = index < current || (state === 'DELIVERED' && index === current);
    item.classList.toggle('is-done', done);
    item.classList.toggle('is-current', index === current && !done);
    item.classList.toggle('is-waiting', index === current && WAITING_STATES.has(state));
    if (index === current && !done) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  }
}

function syncComposer() {
  const record = activeRecord();
  const state = record.project.state;
  if (document.activeElement !== composerInput || composerInput.placeholder !== 'What should change?') {
    composerInput.placeholder = busy ? `${busy.label}…`
      : record.briefs.length === 0 ? PLACEHOLDERS.NEW
        : state === 'RENDERING' && renderBlockedReason() ? 'Tell me what to change'
          : PLACEHOLDERS[state] || PLACEHOLDERS.NEW;
  }
  sendButton.disabled = Boolean(busy) || !composerInput.value.trim();
  const context = record.context;
  $('swatch-primary').style.background = context.primaryColor;
  $('swatch-accent').style.background = context.accentColor;
  $('primary-hex').textContent = context.primaryColor;
  $('accent-hex').textContent = context.accentColor;
  $('details-note').textContent = record.briefs.length && state !== 'BRIEF'
    ? 'Changes here apply to the next storyboard you ask for.'
    : 'Exact copy and brand colors. The AI can’t change these.';
}

function fillDetails(record) {
  $('headline-input').value = record.context.headline;
  $('subheadline-input').value = record.context.subheadline;
  $('primary-color-input').value = record.context.primaryColor.toLowerCase();
  $('accent-color-input').value = record.context.accentColor.toLowerCase();
  syncComposer();
}

function autosize() {
  composerInput.style.height = 'auto';
  composerInput.style.height = `${composerInput.scrollHeight}px`;
}

// ------------------------------------------------------------------ approval dock

const dock = $('dock');
const dockGo = $('dock-go');
const dockShow = $('dock-show');
let liveGate = null;
let liveGateVisible = false;
const gateObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) if (entry.target === liveGate) liveGateVisible = entry.isIntersecting;
  renderDock(activeRecord());
}, { root: threadScroll, threshold: 0.5 });

const DOCK_STATUS = {
  STORYBOARD_REVIEW: 'Storyboard is waiting for your approval',
  BUILDING: 'The shot build stopped',
  RENDERING: 'Shots are built and ready to render',
  QA: 'Your cut is ready to review',
  APPROVED: 'Approved and ready to deliver',
};

/** The gate area of the newest card in the current version, if it holds a live action. */
function findLiveGate(record) {
  for (let index = record.messages.length - 1; index >= 0; index -= 1) {
    const message = record.messages[index];
    if (message.version !== record.version) break;
    const gate = nodeCache.get(`${record.id}:${message.id}`)?.gate;
    if (gate && gate.querySelector('button')) return gate;
  }
  return null;
}

function trackLiveGate(record) {
  const gate = findLiveGate(record);
  if (gate === liveGate) return;
  gateObserver.disconnect();
  liveGate = gate;
  liveGateVisible = false;
  if (gate) gateObserver.observe(gate);
}

function renderDock(record) {
  const state = record.project.state;
  const status = DOCK_STATUS[state];
  const failingQa = state === 'QA' && !qaPasses(record.project.renderReport);
  const show = currentView === 'studio' && !busy && record.messages.length > 0 && status && !liveGateVisible;
  dock.hidden = !show;
  if (!show) return;
  $('dock-status').textContent = failingQa ? 'QA found problems to fix'
    : state === 'RENDERING' && renderBlockedReason() ? 'Shots are built, but this deployment can’t render video' : status;
  const gate = pendingGate(record);
  dockGo.hidden = !gate;
  if (gate) dockGo.textContent = gate.label;
  dockShow.hidden = !liveGate;
}

dockGo.addEventListener('click', () => pendingGate(activeRecord())?.run());
dockShow.addEventListener('click', () => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  liveGate?.closest('.msg')?.scrollIntoView({ block: 'end', behavior: reduce ? 'auto' : 'smooth' });
});

// ------------------------------------------------------------------ other views

function posterFor(record) {
  const timelineShot = record.project.timeline?.shots?.[0];
  if (timelineShot) return specToSvg(timelineShot.spec, recordTitle(record), { primary: record.project.timeline.palette?.primary, accent: record.project.timeline.palette?.accent });
  const shot = record.project.storyboard?.shots?.[0];
  const context = cleanContext(record.project.context || record.context);
  return specToSvg(storyboardSpec({ onScreenCopy: shot?.onScreenCopy || recordTitle(record) }, context), recordTitle(record), { primary: context.primaryColor, accent: context.accentColor });
}

function renderProjects() {
  const list = $('project-list');
  const records = listedRecords();
  if (records.length === 0) {
    list.replaceChildren(h('li', { class: 'empty' },
      h('p', { text: 'Every production you start in Studio lands here, with the ones waiting on you marked.' }),
      h('button', { class: 'pill pill-go', type: 'button', onclick: () => startNewProduction(), text: 'Start a production' })));
    return;
  }
  list.replaceChildren(...records.map((record) => {
    const state = record.project.state;
    const waiting = WAITING_STATES.has(state);
    const done = state === 'DELIVERED';
    return h('li', { class: 'project-card' },
      h('button', {
        class: 'project-open',
        type: 'button',
        onclick: () => {
          store.activeId = record.id;
          persist();
          fillDetails(record);
          showView('studio');
        },
      },
      h('span', { class: 'poster' }, posterFor(record)),
      h('span', { class: 'project-name', text: recordTitle(record) }),
      h('span', { class: 'project-status' },
        h('span', { class: `status-pill${waiting ? ' is-waiting' : done ? ' is-done' : ''}`, text: waiting ? 'Needs you' : done ? 'Delivered' : 'In progress' }),
        relativeTime(record.updatedAt),
        record.id === store.activeId ? h('span', { class: 'current-tag', text: 'Current' }) : null)),
      h('button', {
        class: 'card-remove',
        type: 'button',
        'aria-label': `Remove ${recordTitle(record)}`,
        disabled: Boolean(busy && busy.recordId === record.id),
        text: 'Remove',
        onclick: () => {
          if (!window.confirm(`Remove “${recordTitle(record)}” and its conversation from this browser?`)) return;
          delete store.records[record.id];
          if (store.activeId === record.id) store.activeId = null;
          persist();
          render();
        },
      }));
  }));
}

function renderLibrary() {
  const library = $('library');
  const films = listedRecords().filter((record) => record.project.state === 'DELIVERED');
  if (films.length === 0) {
    library.replaceChildren(h('div', { class: 'empty' },
      h('p', { text: 'Delivered films land here with their source files. Approve and deliver a cut in Studio to add the first one.' }),
      h('button', { class: 'pill', type: 'button', onclick: () => showView('studio'), text: 'Go to Studio' })));
    return;
  }
  library.replaceChildren(...films.map((record) => {
    const artifacts = record.project.renderReport?.artifacts;
    const delivered = record.project.history?.find((entry) => entry.state === 'DELIVERED')?.at || record.updatedAt;
    const duration = record.project.timeline?.durationInSeconds;
    return h('article', { class: 'film' },
      safeOutputUrl(artifacts?.video)
        ? h('video', { class: 'player', src: artifacts.video, controls: true, preload: 'metadata', playsinline: true })
        : h('span', { class: 'poster' }, posterFor(record)),
      h('h2', { text: recordTitle(record) }),
      h('p', { text: `${Number.isFinite(duration) ? `${seconds(duration)}, ` : ''}delivered ${relativeTime(delivered)}` }),
      exportLinks(artifacts));
  }));
}

let engine = null;
let engineError = false;
let renderInfo = null;

/** Why this deployment can't render, or null when it can (or when we don't know yet). */
function renderBlockedReason() {
  return renderInfo && renderInfo.available === false ? renderInfo.reason || 'This deployment can’t render video.' : null;
}

async function loadEngine() {
  try {
    const response = await fetch('/api/engine');
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error('unavailable');
    engine = result.engine;
    renderInfo = result.render ?? null;
    engineError = false;
  } catch {
    engineError = true;
  }
  render();
}

function renderEngineChip() {
  const chip = $('engine-chip');
  const label = $('engine-label');
  const record = activeRecord();
  const lastProvider = [record.providers.compile, record.providers.storyboard]
    .filter(Boolean).sort((a, b) => (b.at || '').localeCompare(a.at || ''))[0];
  if (lastProvider?.provider === 'mock-provider') {
    chip.dataset.state = 'attention';
    label.textContent = 'Offline fallback';
  } else if (engine) {
    const anyConfigured = engine.gemini.configured || engine.fallbacks.some((fallback) => fallback.configured);
    chip.dataset.state = anyConfigured ? 'ai' : 'attention';
    label.textContent = engine.gemini.configured ? engine.gemini.name
      : anyConfigured ? engine.fallbacks.find((fallback) => fallback.configured).name : 'No AI keys';
  } else {
    chip.dataset.state = '';
    label.textContent = engineError ? 'Engine unknown' : 'Checking engine';
  }
}

function definitionList(target, rows) {
  target.replaceChildren(...rows.flatMap(([term, value, waiting]) => [
    h('dt', { text: term }),
    h('dd', { class: waiting ? 'is-waiting' : undefined, text: value }),
  ]));
}

function renderSystem() {
  if (engine) {
    const { gemini, fallbacks } = engine;
    definitionList($('engine-details'), [
      ['Gemini model', `${gemini.name} (${gemini.model})`],
      ['Backup models', gemini.backupModels?.length ? gemini.backupModels.map((backup) => backup.name).join(', ') : 'None'],
      ['When Google is busy', gemini.overloadRetries ? `Retries ${gemini.overloadRetries === 1 ? 'once' : `${gemini.overloadRetries} times`}, then tries the backup model` : 'Tries the backup model'],
      ['Gemini keys', gemini.keys ? `${gemini.keys} set` : 'None set', !gemini.keys],
      ['Thinking level', gemini.thinkingLevel || 'Model default'],
      ['Timeout', `${Math.round(gemini.timeoutMs / 1000)}s per key`],
      ['On quota errors', gemini.rotateOnQuota ? 'Tries the backup model, then the next key' : 'Tries the backup model, then the next provider'],
      ['Video rendering', renderInfo ? (renderInfo.available ? 'Available on this deployment' : renderInfo.reason) : 'Unknown', Boolean(renderInfo && !renderInfo.available)],
      ...fallbacks.map((fallback) => [fallback.name, fallback.configured ? `Set (${fallback.model})` : 'Not set']),
    ]);
  } else {
    definitionList($('engine-details'), [['Status', engineError ? 'The engine endpoint didn’t answer.' : 'Checking…', engineError]]);
  }

  const record = activeRecord();
  const describe = (result) => {
    if (!result) return 'Not yet';
    return result.provider === 'mock-provider' ? `Offline fallback: ${result.warning || 'no reason given'}` : result.provider;
  };
  definitionList($('answer-details'), record.messages.length ? [
    ['Production', recordTitle(record)],
    ['Status', STATUS_TEXT[record.project.state], WAITING_STATES.has(record.project.state)],
    ['Storyboard by', describe(record.providers.storyboard), record.providers.storyboard?.provider === 'mock-provider'],
    ['Shots built by', describe(record.providers.compile), record.providers.compile?.provider === 'mock-provider'],
  ] : [['Production', 'Nothing started yet']]);

  const log = $('activity-log');
  const entries = store.log.slice().reverse();
  log.replaceChildren(...(entries.length ? entries.map((entry) => h('li', { class: entry.level === 'fault' ? 'is-fault' : undefined },
    h('time', { datetime: entry.at, text: clockTime(entry.at) }),
    h('strong', { text: entry.stage }),
    h('p', { text: entry.message }))) : [h('li', {}, h('p', { text: 'No activity yet.' }))]));
}

// ------------------------------------------------------------------ views and render loop

const VIEWS = ['studio', 'projects', 'library', 'system'];
let currentView = 'studio';

function showView(view) {
  currentView = VIEWS.includes(view) ? view : 'studio';
  for (const panel of document.querySelectorAll('[data-view-panel]')) panel.hidden = panel.dataset.viewPanel !== currentView;
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.view === currentView) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  if (location.hash.slice(1) !== currentView) history.replaceState(null, '', currentView === 'studio' ? location.pathname : `#${currentView}`);
  render({ stick: currentView === 'studio' });
}

function render(options = {}) {
  const record = activeRecord();
  const pending = listedRecords().filter((item) => WAITING_STATES.has(item.project.state)).length;
  const count = $('pending-count');
  count.hidden = pending === 0;
  count.textContent = String(pending);
  count.setAttribute('aria-label', `${pending} waiting on you`);
  renderEngineChip();
  if (currentView === 'studio') {
    renderHead(record);
    renderThread(record, options);
    trackLiveGate(record);
    syncComposer();
  } else if (currentView === 'projects') renderProjects();
  else if (currentView === 'library') renderLibrary();
  else if (currentView === 'system') renderSystem();
  renderDock(record);
}

// ------------------------------------------------------------------ events

for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => showView(button.dataset.view));
}

window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = composerInput.value;
  if (!text.trim() || busy) return;
  composerInput.value = '';
  autosize();
  briefDetails.hidden = true;
  detailsToggle.setAttribute('aria-expanded', 'false');
  submitMessage(text);
  render({ stick: true });
});

composerInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

composerInput.addEventListener('input', () => {
  autosize();
  syncComposer();
});

composerInput.addEventListener('blur', () => {
  if (composerInput.placeholder === 'What should change?' && !composerInput.value) syncComposer();
});

detailsToggle.addEventListener('click', () => {
  const open = briefDetails.hidden;
  briefDetails.hidden = !open;
  detailsToggle.setAttribute('aria-expanded', String(open));
  if (open) $('headline-input').focus();
});

for (const [id, key] of [
  ['headline-input', 'headline'],
  ['subheadline-input', 'subheadline'],
  ['primary-color-input', 'primaryColor'],
  ['accent-color-input', 'accentColor'],
]) {
  $(id).addEventListener('input', (event) => {
    const record = activeRecord();
    record.context = cleanContext({ ...record.context, [key]: event.target.value });
    persist();
    syncComposer();
  });
}

$('new-production').addEventListener('click', () => startNewProduction());

$('clear-log').addEventListener('click', () => {
  store.log = [];
  persist();
  render();
});

$('clear-data').addEventListener('click', () => {
  if (busy) return;
  if (!window.confirm('Delete every production, conversation and activity entry saved in this browser? Rendered files on the server are not affected.')) return;
  store = emptyStore();
  nodeCache.clear();
  thread.dataset.recordId = '';
  persist();
  fillDetails(activeRecord());
  render();
});

window.addEventListener('beforeunload', (event) => {
  if (busy) event.preventDefault();
});

// ------------------------------------------------------------------ start

renderStarters();
fillDetails(activeRecord());
showView(location.hash.slice(1));
autosize();
loadEngine();
