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
  timeout: 'The AI took too long to answer.',
  network: 'The AI provider couldn’t be reached.',
  overload: 'The AI provider is overloaded right now.',
  provider: 'Every configured AI provider failed.',
};
const STARTERS = [
  'A 10-second launch film for a perfume called Nocturne: black glass, slow light sweeps, one line of copy.',
  'A fast kinetic-type opener for the SEV7N FOLD showreel that ends on the studio name.',
  'An 8-second teaser for a skincare serum: warm light, calm pacing, minimal copy.',
];
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
    case 'RENDERING': return { label: 'Render and run QA', run: () => renderFilm(record) };
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

/** Draws a scene spec's final layout the same way the renderer places it. */
function specToSvg(spec, label) {
  const width = spec.width || DEFAULT_CONTEXT.width;
  const height = spec.height || DEFAULT_CONTEXT.height;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': label,
  });
  for (const element of spec.elements || []) {
    const fill = isHex(element.fill) ? element.fill : '#F8FAFC';
    if (element.type === 'rect') {
      svg.append(svgEl('rect', { x: element.x, y: element.y, width: element.width, height: element.height, fill }));
    } else if (element.type === 'circle') {
      svg.append(svgEl('circle', { cx: element.x, cy: element.y, r: element.radius ?? 12, fill }));
    } else if (element.type === 'text' && element.content) {
      const size = Math.max(16, Math.min(Number.isFinite(element.fontSize) ? element.fontSize : 32, height * 0.15));
      const lines = wrapText(element.content, Math.max(1, Math.floor((width * 0.76) / (size * 0.58))));
      const anchor = ['middle', 'end'].includes(element.anchor) ? element.anchor : 'start';
      const text = svgEl('text', {
        x: element.x,
        y: element.y - ((lines.length - 1) * size * 0.62) / 2,
        'text-anchor': anchor,
        fill,
        'font-family': 'Segoe UI, Arial, sans-serif',
        'font-size': size,
        'font-weight': 700,
      });
      lines.forEach((line, index) => {
        const span = svgEl('tspan', { x: element.x, dy: index === 0 ? 0 : size * 1.2 });
        span.textContent = line;
        text.append(span);
      });
      svg.append(text);
    }
  }
  return svg;
}

/** Storyboard shots have no spec yet: preview them with the deterministic layout. */
function storyboardSpec(shot, context) {
  const { width, height, primaryColor, accentColor } = cleanContext(context);
  return {
    width,
    height,
    elements: [
      { type: 'rect', x: 0, y: 0, width, height, fill: primaryColor },
      { type: 'rect', x: width * 0.12, y: height * 0.69, width: width * 0.28, height: Math.max(4, height * 0.006), fill: accentColor },
      { type: 'text', content: shot.onScreenCopy, x: width / 2, y: height / 2, fill: '#F8FAFC', fontSize: Math.max(32, Math.round(height * 0.067)), anchor: 'middle' },
    ],
  };
}

function reel(items) {
  const total = items.reduce((sum, item) => sum + item.duration, 0) || 1;
  const track = h('div', { class: 'reel-track' });
  track.style.setProperty('--shots', String(items.length));
  const strip = h('div', { class: 'strip' });
  items.forEach((item, index) => {
    const frame = h('figure', { class: 'frame', 'aria-label': `Shot ${index + 1}, ${seconds(item.duration)}: ${item.copy}` },
      h('div', { class: 'frame-picture', style: `background:${isHex(item.spec.elements?.[0]?.fill) ? item.spec.elements[0].fill : '#000'}` }, specToSvg(item.spec, item.copy)),
      h('figcaption', {}, h('span', { class: 'frame-number', text: String(index + 1).padStart(2, '0') }), h('span', { text: seconds(item.duration) })));
    frame.style.setProperty('--duration', String(item.duration));
    strip.append(frame);
  });
  const ruler = h('div', { class: 'ruler', 'aria-hidden': 'true' });
  const step = total <= 12 ? 1 : total <= 30 ? 5 : 10;
  for (let second = 0; second <= Math.floor(total); second += 1) {
    const left = `${(second / total) * 100}%`;
    const tick = h('span', { class: 'tick' });
    tick.style.left = left;
    ruler.append(tick);
    if (second % step === 0 && second / total < 0.94) {
      const label = h('span', { class: 'tick-label', text: `${second}s` });
      label.style.left = left;
      if (second === 0) label.style.transform = 'none';
      ruler.append(label);
    }
  }
  const end = h('span', { class: 'tick-label', text: seconds(total) });
  end.style.left = '100%';
  end.style.transform = 'translateX(-100%)';
  ruler.append(end);
  track.append(strip, ruler);
  return h('div', { class: 'reel' }, track);
}

// ------------------------------------------------------------------ message views

const openDetails = new Set();

function more(key, summary, ...content) {
  const details = h('details', { class: 'more' }, h('summary', { text: summary }), ...content);
  details.open = openDetails.has(key);
  details.addEventListener('toggle', () => {
    if (details.open) openDetails.add(key);
    else openDetails.delete(key);
  });
  return details;
}

function plainList(items) {
  return h('ul', { class: 'plain-list' }, (items || []).map((item) => h('li', { text: item })));
}

function providerName(provider) {
  return provider === 'mock-provider' ? 'the offline fallback' : provider;
}

function providerNotes(data) {
  const notes = [];
  if (data.provider === 'mock-provider') {
    notes.push(h('div', { class: 'note' },
      h('p', {}, h('strong', { text: 'Made by the offline fallback, not AI. ' }),
        FALLBACK_REASONS[data.fallbackReason] || FALLBACK_REASONS.provider, ' ',
        h('button', { class: 'inline-link', type: 'button', onclick: () => showView('system'), text: 'See what happened' }))));
  }
  if (data.repairs?.length) {
    const count = data.repairs.length;
    const key = `repairs-${data.repairs[0]}-${count}`;
    notes.push(h('div', { class: 'note' },
      h('p', { text: `Fixed ${count} slip${count === 1 ? '' : 's'} in the model’s output so it matches your brief and brand.` }),
      more(key, 'Show fixes', h('ul', {}, data.repairs.map((repair) => h('li', { text: repair }))))));
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
  return h('button', { class: 'button button-go', type: 'button', disabled: Boolean(busy), onclick: run, text: label });
}

function changesButton() {
  return h('button', { class: 'button', type: 'button', disabled: Boolean(busy), onclick: askForChanges, text: 'Ask for changes' });
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
      content.push(h('button', { class: 'button', type: 'button', disabled: Boolean(busy), onclick: () => runRetry(record, message.data.retry), text: 'Try again' }));
    }
  } else if (superseded) {
    content.push(stamp('Replaced by a revised storyboard.', true));
  } else if (message.type === 'storyboard') {
    if (state === 'STORYBOARD_REVIEW') content.push(goButton('Approve storyboard', () => buildShots(record)), changesButton());
    else if (stage > PROJECT_STATES.indexOf('STORYBOARD_REVIEW')) content.push(stamp('Storyboard approved.'));
  } else if (message.type === 'timeline') {
    if (state === 'RENDERING') content.push(goButton('Render and run QA', () => renderFilm(record)), changesButton());
    else if (stage > PROJECT_STATES.indexOf('RENDERING')) content.push(stamp('Rendered.'));
  } else if (message.type === 'render') {
    if (state === 'QA') {
      const passes = qaPasses(message.data.report);
      content.push(goButton('Approve final cut', () => approveCut(record)), changesButton());
      if (!passes) {
        content[0].disabled = true;
        content.push(h('p', { class: 'gate-note', text: 'Every check has to pass before the cut can be approved. Ask for changes to fix the failing checks.' }));
      }
    } else if (stage > PROJECT_STATES.indexOf('QA')) content.push(stamp('Final cut approved.'));
  } else if (message.type === 'approved') {
    if (state === 'APPROVED') content.push(goButton('Deliver', () => deliver(record)));
  }

  slot.replaceChildren(...content);
  slot.hidden = content.length === 0;
}

function storyboardView(message) {
  const { storyboard, acceptance, context } = message.data;
  const shots = storyboard.shots || [];
  const total = shots.reduce((sum, shot) => sum + (Number(shot.durationSeconds) || 0), 0);
  const key = (part) => `${message.id}-${part}`;
  const notes = h('div', { class: 'shot-notes' }, shots.map((shot, index) => h('section', { class: 'shot-note' },
    h('h3', { text: `Shot ${String(index + 1).padStart(2, '0')} / ${seconds(shot.durationSeconds)}` }),
    h('dl', {}, [
      ['Purpose', shot.purpose],
      ['On screen', shot.onScreenCopy],
      ['Visual', shot.mainVisual],
      ['Composition', shot.composition],
      ['Camera', shot.cameraBehavior],
      ['Motion', shot.motionBehavior],
      ['In and out', `${shot.transitionIn} Then: ${shot.transitionOut}`],
      ...(shot.soundCue ? [['Sound', shot.soundCue]] : []),
      ['Must pass', (shot.acceptanceCriteria || []).join(' ')],
    ].flatMap(([term, value]) => [h('dt', { text: term }), h('dd', { text: value })])))));
  const gate = h('div', { class: 'gate' });
  const node = h('article', { class: 'msg msg-system' },
    h('p', { text: `Here’s the storyboard: ${shots.length} shot${shots.length === 1 ? '' : 's'}, ${seconds(total)}.` }),
    h('p', { class: 'msg-meta', text: `Written by ${providerName(message.data.provider)}` }),
    ...providerNotes(message.data),
    h('div', { class: 'card' },
      h('h2', { class: 'card-title', text: storyboard.title }),
      h('p', { class: 'card-lede', text: storyboard.narrativeConcept }),
      reel(shots.map((shot) => ({
        duration: Number(shot.durationSeconds) || 1,
        copy: shot.onScreenCopy,
        spec: storyboardSpec(shot, context),
      }))),
      more(key('shots'), 'Shot notes', notes),
      more(key('criteria'), 'Direction and acceptance criteria',
        h('p', { text: storyboard.creativeDirection }),
        h('p', { class: 'criteria-heading', text: 'Hard constraints' }), plainList(storyboard.hardConstraints),
        h('p', { class: 'criteria-heading', text: 'Technical checks' }), plainList(storyboard.acceptanceCriteria?.technical),
        h('p', { class: 'criteria-heading', text: 'Creative checks' }), plainList(storyboard.acceptanceCriteria?.creative),
        acceptance ? more(key('acceptance-json'), 'Acceptance spec (JSON)', h('pre', { class: 'code', text: JSON.stringify(acceptance, null, 2) })) : null),
      gate));
  return { node, gate };
}

function timelineView(message) {
  const { timeline } = message.data;
  const gate = h('div', { class: 'gate' });
  const node = h('article', { class: 'msg msg-system' },
    h('p', { text: `Shots built: ${timeline.shots.length} shots, ${timeline.totalFrames} frames at ${timeline.fps} fps. These are the layouts the renderer will draw.` }),
    h('p', { class: 'msg-meta', text: `Built by ${providerName(message.data.provider)}` }),
    ...providerNotes(message.data),
    h('div', { class: 'card' },
      h('h2', { class: 'card-title', text: timeline.title }),
      h('p', { class: 'card-lede', text: `${timeline.width} × ${timeline.height}, ${seconds(timeline.durationInSeconds)}` }),
      reel(timeline.shots.map((shot) => ({
        duration: shot.durationSeconds,
        copy: shot.spec.elements.find((element) => element.type === 'text')?.content || shot.shotId,
        spec: shot.spec,
      }))),
      more(`${message.id}-json`, 'Timeline (JSON)', h('pre', { class: 'code', text: JSON.stringify(timeline, null, 2) })),
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
    ['Contrast', creative.contrast, (c) => `${number(c.minimumRatio)}:1, needs ${c.requiredRatio}:1`],
    ['Legibility', creative.legibility, (c) => `Smallest text ${c.minimumFontSize}px`],
    ['Brand colors', creative.brandFidelity, (c) => `${String(c.primaryColor).toUpperCase()} and ${String(c.accentColor).toUpperCase()}`],
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
  const node = h('article', { class: 'msg msg-system' },
    h('p', { text: failed === 0
      ? `Rendered and checked. All ${checks.length} checks passed. Watch it, then approve the cut.`
      : `Rendered. ${failed} of ${checks.length} checks failed.` }),
    h('div', { class: 'card' },
      safeOutputUrl(video) ? h('video', { class: 'player', src: video, controls: true, preload: 'metadata', playsinline: true }) : null,
      h('ul', { class: 'checks' }, checks.map((check) => h('li', { class: `check${check.pass ? '' : ' is-fail'}` },
        h('strong', { text: check.name }), h('span', { text: check.detail })))),
      qaError ? h('div', { class: 'note note-fault' }, h('p', { text: `The QA command reported: ${qaError}` })) : null,
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
    film ? h('a', { class: 'button', href: film, download: '', text: 'Download film' }) : null,
    sources.length ? h('p', { class: 'sources' },
      sources.flatMap(([label, url], index) => [
        index ? h('span', { class: 'sources-slash', 'aria-hidden': 'true', text: ' / ' }) : null,
        h('a', { href: url, text: label }),
      ])) : null);
}

function messageView(message, record) {
  const { type, role, data } = message;
  if (role === 'director') {
    return { node: h('article', { class: 'msg msg-director' }, h('span', { class: 'sr-only', text: 'You: ' }), data.text) };
  }
  try {
    if (type === 'storyboard') return storyboardView(message);
    if (type === 'timeline') return timelineView(message);
    if (type === 'render') return renderView(message);
  } catch (error) {
    return { node: h('article', { class: 'msg msg-system' }, h('div', { class: 'note note-fault' }, h('p', { text: `This card couldn’t be shown: ${error.message}` }))) };
  }
  if (type === 'approved') {
    const gate = h('div', { class: 'gate' });
    return { node: h('article', { class: 'msg msg-system' }, h('p', { text: 'Final cut approved.' }), gate), gate };
  }
  if (type === 'delivered') {
    return {
      node: h('article', { class: 'msg msg-system' },
        h('p', { text: `Delivered. ${recordTitle(record)} is in your Library with its source files.` }),
        exportLinks(data.artifacts)),
    };
  }
  if (type === 'error') {
    const gate = h('div', { class: 'gate-inline' });
    return { node: h('article', { class: 'msg msg-system' }, h('div', { class: 'note note-fault' }, h('p', {}, h('strong', { text: data.text })), gate)), gate };
  }
  return { node: h('article', { class: 'msg msg-system' }, h('p', { text: data.text })) };
}

// ------------------------------------------------------------------ studio rendering

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

function welcomeView() {
  return h('div', { class: 'welcome', 'data-welcome': '' },
    h('span', { class: 'rule-mark', 'aria-hidden': 'true' }),
    h('p', { class: 'welcome-lead', text: 'Brief me. I’ll write the storyboard for your approval, build and render every shot, and check the cut before you sign it off.' }),
    h('p', { class: 'starters-label', text: 'Start from a brief' }),
    h('ul', { class: 'starters' }, STARTERS.map((starter) => h('li', {},
      h('button', {
        class: 'starter',
        type: 'button',
        text: starter,
        onclick: () => {
          composerInput.value = starter;
          autosize();
          syncComposer();
          composerInput.focus();
        },
      })))));
}

function updateWorking() {
  if (!workingNode || !busy) return;
  const elapsed = Math.round((Date.now() - busy.startedAt) / 1000);
  workingNode.querySelector('.working-time').textContent = `${elapsed}s`;
  workingNode.querySelector('.working-hint').hidden = elapsed < 25;
}

function renderThread(record, { stick = false } = {}) {
  const nearBottom = threadScroll.scrollHeight - threadScroll.scrollTop - threadScroll.clientHeight < 160;
  if (thread.dataset.recordId !== record.id) {
    thread.replaceChildren();
    thread.dataset.recordId = record.id;
    stick = true;
  }

  const welcome = thread.querySelector('[data-welcome]');
  if (record.messages.length === 0) {
    if (!welcome) thread.replaceChildren(welcomeView());
  } else if (welcome) welcome.remove();

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
    if (!workingNode) {
      workingNode = h('div', { class: 'msg msg-system working', role: 'status' },
        h('p', {}, `${busy.label}… `, h('span', { class: 'working-time', text: '0s' })),
        h('p', { class: 'msg-meta working-hint', hidden: true, text: 'Still working. AI answers can take up to a minute.' }),
        h('div', { class: 'working-bar', 'aria-hidden': 'true' }));
      workingTimer = setInterval(updateWorking, 1000);
    }
    workingNode.querySelector('p').firstChild.textContent = `${busy.label}… `;
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
  $('project-title').textContent = recordTitle(record);
  document.title = record.messages.length ? `${recordTitle(record)} — FOLD Motion` : 'FOLD Motion — Studio';
  const state = record.project.state;
  const current = STAGE_OF_STATE[state];
  $('stages').hidden = record.messages.length === 0;
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
        : PLACEHOLDERS[state] || PLACEHOLDERS.NEW;
  }
  sendButton.disabled = Boolean(busy) || !composerInput.value.trim();
  const context = record.context;
  $('swatch-primary').style.background = context.primaryColor;
  $('swatch-accent').style.background = context.accentColor;
  $('details-note').textContent = record.briefs.length && state !== 'BRIEF'
    ? 'Changes here apply to the next storyboard you ask for.'
    : 'Exact copy and brand colors. The AI can’t change these.';
}

function fillDetails(record) {
  $('headline-input').value = record.context.headline;
  $('subheadline-input').value = record.context.subheadline;
  $('primary-color-input').value = record.context.primaryColor.toLowerCase();
  $('accent-color-input').value = record.context.accentColor.toLowerCase();
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
  STORYBOARD_REVIEW: 'Storyboard / waiting on you',
  BUILDING: 'Shot build stopped / try again',
  RENDERING: 'Shots built / ready to render',
  QA: 'Cut ready / waiting on your review',
  APPROVED: 'Approved / ready to deliver',
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
  $('dock-status').textContent = failingQa ? 'QA failed / ask for changes' : status;
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

function renderProjects() {
  const list = $('project-list');
  const records = listedRecords();
  if (records.length === 0) {
    list.replaceChildren(h('li', { class: 'empty' },
      h('p', { text: 'Productions you start in Studio show up here, with the ones waiting on you marked.' }),
      h('button', { class: 'button button-go', type: 'button', onclick: () => startNewProduction(), text: 'Start a production' })));
    return;
  }
  list.replaceChildren(...records.map((record) => {
    const state = record.project.state;
    const waiting = WAITING_STATES.has(state);
    return h('li', { class: `project-row${record.id === store.activeId ? ' is-active' : ''}` },
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
      h('span', { class: 'project-name', text: recordTitle(record) }),
      h('span', { class: `project-status${waiting ? ' is-waiting' : ''}`, text: `${STATUS_TEXT[state]}, updated ${relativeTime(record.updatedAt)}` })),
      h('button', {
        class: 'button button-quiet',
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
      h('a', { class: 'button', href: './scene-01.html', text: 'Open the sample scene' })));
    return;
  }
  library.replaceChildren(...films.map((record) => {
    const artifacts = record.project.renderReport?.artifacts;
    const delivered = record.project.history?.find((entry) => entry.state === 'DELIVERED')?.at || record.updatedAt;
    const duration = record.project.timeline?.durationInSeconds;
    return h('article', { class: 'film' },
      safeOutputUrl(artifacts?.video) ? h('video', { class: 'player', src: artifacts.video, controls: true, preload: 'metadata', playsinline: true }) : null,
      h('h2', { text: recordTitle(record) }),
      h('p', { text: `${Number.isFinite(duration) ? `${seconds(duration)}, ` : ''}delivered ${relativeTime(delivered)}` }),
      exportLinks(artifacts));
  }));
}

let engine = null;
let engineError = false;

async function loadEngine() {
  try {
    const response = await fetch('/api/engine');
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error('unavailable');
    engine = result.engine;
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
      ['Gemini keys', gemini.keys ? `${gemini.keys} set` : 'None set', !gemini.keys],
      ['Thinking level', gemini.thinkingLevel || 'Model default'],
      ['Timeout', `${Math.round(gemini.timeoutMs / 1000)}s per key`],
      ['On quota errors', gemini.rotateOnQuota ? 'Tries the next key' : 'Skips to the next provider'],
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

fillDetails(activeRecord());
showView(location.hash.slice(1));
autosize();
loadEngine();
