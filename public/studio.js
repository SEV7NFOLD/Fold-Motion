import { PROJECT_STATES } from './workflow-states.mjs';
import { durationFromBrief } from './brief-length.mjs';
import { sanitizeSvg, serializeSvgTree } from './svg-sanitize.mjs';
import { createSupabaseClient } from './supabase-client.mjs';
import { analyzeLogoPixels, removePlainBackground } from './logo-check.mjs';
import { readFontMetrics } from './font-metrics.mjs';

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
  atmosphere: { orbit: 'Orbit', spotlight: 'Spotlight', grid: 'Grid', lines: 'Lines', clean: 'Clean', planes: 'Planes', dots: 'Dots' },
};
const DEFAULT_MOTION = { camera: 'static', entrance: 'rise-glitch', atmosphere: 'orbit' };
// Mirror RECIPE_OPTIONS and TRANSITION_OPTIONS in src/production/recipes.mjs (drift-tested).
const RECIPE_LABELS = { 'title-reveal': 'Title reveal', statement: 'Statement', 'kicker-title': 'Opening card', 'type-stack': 'Type stack', lockup: 'End card', 'logo-reveal': 'Logo reveal', 'product-hero': 'Product hero', 'type-window': 'Type window', stat: 'Stat', quote: 'Quote', 'product-grid': 'Product grid', split: 'Split screen' };
const TRANSITION_LABELS = { cut: 'Cut', wipe: 'Wipe', fade: 'Fade', push: 'Push through', fold: 'The Fold', zoom: 'Zoom through a letter' };
const PREVIEW_FONTS = {
  display: ['Anton, Impact, sans-serif', 400],
  bold: ['Montserrat, Arial, sans-serif', 700],
  semibold: ['Montserrat, Arial, sans-serif', 600],
  medium: ['Montserrat, Arial, sans-serif', 500],
};

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
const safeOutputUrl = (url) => typeof url === 'string' && !url.includes('..') && (url.startsWith('/output/')
  || Boolean(authInfo?.url && url.startsWith(`${authInfo.url}/storage/v1/object/sign/films/`)));

/**
 * A cross-site link ignores the download attribute, so Supabase links ask the
 * server to send the film as an attachment instead.
 */
function downloadUrl(url, name = 'fold-motion-film.mp4') {
  if (!authInfo?.url || !String(url).startsWith(`${authInfo.url}/storage/v1/object/sign/`)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(name)}`;
}

// Film links from Supabase expire after a week; reopened films get a fresh one.
const freshFilmLinks = new Map();
async function refreshFilmLinks() {
  if (!cloud) return;
  for (const node of document.querySelectorAll('[data-film-path]')) {
    const path = node.dataset.filmPath;
    if (node.dataset.fresh === 'true') continue;
    node.dataset.fresh = 'true';
    try {
      if (!freshFilmLinks.has(path)) freshFilmLinks.set(path, await cloud.signedUrl('films', path));
      const url = freshFilmLinks.get(path);
      if (node.tagName === 'A') node.href = node.dataset.download === 'true' ? downloadUrl(url) : url; else node.src = url;
    } catch { /* the stored link still works until it expires */ }
  }
}
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

/** A new production keeps the brand (colors) but never the last film's copy. */
function brandOnly(context = {}) {
  return { ...context, headline: '', subheadline: '' };
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

// Signed in with Supabase, projects live in the database: the browser keeps only a
// small bookmark, and records that changed are uploaded a moment after the change.
let cloud = null;
let authInfo = null;
const syncedJson = new Map();
let syncTimer = null;

function scheduleCloudSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncToCloud, 900);
}

async function syncToCloud() {
  if (!cloud) return;
  const changed = Object.values(store.records).filter((record) => record.messages.length > 0 && syncedJson.get(record.id) !== JSON.stringify(record));
  if (changed.length === 0) return;
  try {
    await cloud.upsert('projects', changed.map((record) => ({ id: record.id, owner: cloud.user.id, title: recordTitle(record), data: record, updated_at: new Date().toISOString() })));
    for (const record of changed) syncedJson.set(record.id, JSON.stringify(record));
  } catch (error) {
    if (error.status === 401) return showSignIn('Your session ended. Sign in again to keep saving.');
    logEvent('Save failed', `Couldn’t save to Supabase: ${error.message}. Retrying.`, 'fault');
    setTimeout(scheduleCloudSync, 5000);
  }
}

function persist() {
  if (cloud) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 3, records: {}, activeId: store.activeId, log: store.log.slice(-40), lastFormat: store.lastFormat, cloud: true }));
    } catch { /* the bookmark is optional */ }
    scheduleCloudSync();
    return;
  }
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

/**
 * Renders through the server's queue: one film at a time, with progress shown in
 * the working indicator. Falls back to a plain request on servers without a queue.
 */
async function renderQueued(body) {
  const started = await postJson('/api/render', { ...body, async: true });
  if (!started.jobId) return started;
  let drawingSince = 0;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const token = cloud ? await cloud.accessToken() : '';
    const response = await fetch(`/api/render/jobs/${encodeURIComponent(started.jobId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const job = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(job.error || `The render status couldn’t be read (HTTP ${response.status}).`);
    if (job.progress?.stage === 'drawing' && !drawingSince) drawingSince = Date.now();
    if (busy) {
      busy.progress = { ...job.progress, position: job.position, drawingSeconds: drawingSince ? (Date.now() - drawingSince) / 1000 : 0 };
      updateWorking();
    }
    if (job.status === 'done') return job.result;
    if (job.status === 'failed') throw new Error(job.result?.error || 'The render failed.');
  }
}

async function postJson(url, body) {
  const token = cloud ? await cloud.accessToken() : '';
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (response.status === 401 && authInfo) {
    showSignIn('Your session ended. Sign in again, then retry.');
    throw new Error('Sign in to FOLD Motion to continue.');
  }
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
const said = (record, text, extra = {}) => addMessage(record, 'director', 'text', { text, ...extra });

/** What a brief was actually sent with, shown as chips under the message. */
function usedContext(record, fullBrief) {
  const { headline, subheadline, primaryColor, accentColor } = record.context;
  return {
    context: { headline, subheadline, primaryColor, accentColor },
    seconds: durationFromBrief(fullBrief) ?? null,
    briefHasOnScreenText: /on[-\s]?screen\s+text\s*:/i.test(fullBrief),
    logo: brandKit.logo?.kind || null,
    products: brandKit.products.length,
  };
}

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


// ---------------------------------------------------------------- brand kit (logo, product photos)
// Stored in IndexedDB (images are too big for localStorage). Like the colors, the
// brand kit carries over to every new production.
const BRAND_DB = 'fold-motion-brand';
// Product photos: as many as a production needs (the ceiling protects the server).
const BRAND_LIMITS = { logoPngBytes: 1_500_000, productBytes: 2_000_000, products: 40 };
let brandKit = { logo: null, products: [] };
let logoTree = null;

function openBrandDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BRAND_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kit');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadLocalBrandKit() {
  try {
    const db = await openBrandDb();
    const kit = await new Promise((resolve) => {
      const request = db.transaction('kit').objectStore('kit').get('brand');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    brandKit = { logo: kit?.logo || null, products: Array.isArray(kit?.products) ? kit.products : [] };
  } catch {
    brandKit = { logo: null, products: [] };
  }
  logoTree = brandKit.logo?.kind === 'svg' ? sanitizeSvg(brandKit.logo.svg) : null;
  if (brandKit.font) loadBrandFontFace(brandKit.font);
  renderBrandTray();
}

async function loadBrandKit() {
  if (!cloud) return loadLocalBrandKit();
  try {
    await loadBrandKitFromCloud();
  } catch (error) {
    showAssetError(`Couldn’t load your brand kit from Supabase: ${error.message}`);
  }
}

async function saveBrandKit() {
  logoTree = brandKit.logo?.kind === 'svg' ? sanitizeSvg(brandKit.logo.svg) : null;
  renderBrandTray();
  if (cloud) return saveBrandKitToCloud();
  try {
    const db = await openBrandDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kit', 'readwrite');
      tx.objectStore('kit').put(brandKit, 'brand');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    showAssetError('Your browser couldn’t save the brand kit. It will be used until you reload.');
  }
}


// ---- brand kit in Supabase: files in the user's brand-assets folder, metadata in brand_kits
const brandMeta = (item) => item && Object.fromEntries(Object.entries(item).filter(([key]) => !['svg', 'dataUri'].includes(key)));

async function dataUriToBlob(uri) {
  return (await fetch(uri)).blob();
}

async function uploadBrandFile(item, path, contentType) {
  const body = item.kind === 'svg' ? new Blob([item.svg], { type: 'image/svg+xml' }) : await dataUriToBlob(item.dataUri);
  await cloud.upload('brand-assets', path, body, contentType);
  return { ...item, path };
}

async function saveBrandKitToCloud() {
  try {
    const uid = cloud.user.id;
    if (brandKit.logo && !brandKit.logo.path) {
      const extension = brandKit.logo.kind === 'svg' ? 'svg' : 'png';
      brandKit.logo = await uploadBrandFile(brandKit.logo, `${uid}/logo.${extension}`, brandKit.logo.kind === 'svg' ? 'image/svg+xml' : 'image/png');
      const other = `${uid}/logo.${extension === 'svg' ? 'png' : 'svg'}`;
      cloud.removeObject('brand-assets', other).catch(() => {});
    }
    for (const [index, product] of brandKit.products.entries()) {
      if (!product.path) brandKit.products[index] = await uploadBrandFile(product, `${uid}/products/${product.id}.jpg`, 'image/jpeg');
    }
    const row = { owner: uid, logo: brandMeta(brandKit.logo) || null, products: brandKit.products.map(brandMeta), font: brandKit.font || null, updated_at: new Date().toISOString() };
    try {
      await cloud.upsert('brand_kits', [row]);
    } catch (error) {
      // Databases set up before brand fonts lack the column: save the rest.
      if (!/font/i.test(error.message)) throw error;
      delete row.font;
      await cloud.upsert('brand_kits', [row]);
      if (brandKit.font) showAssetError('Your font is saved in this browser only. Run the brand-font SQL in Supabase to keep it in your account.');
    }
  } catch (error) {
    showAssetError(error.status === 401 ? 'Your session ended. Sign in again.' : `Couldn’t save to Supabase: ${error.message}`);
  }
}

async function blobToDataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Loads the brand kit from Supabase; on first sign-in, imports this browser's kit. */
async function loadBrandKitFromCloud() {
  const rows = await cloud.select('brand_kits', 'select=*');
  const row = rows?.[0];
  if (!row) {
    await loadLocalBrandKit();
    if (brandKit.logo || brandKit.products.length) await saveBrandKitToCloud();
    return;
  }
  const logo = row.logo?.path ? { ...row.logo } : null;
  if (logo) {
    const blob = await cloud.download('brand-assets', logo.path);
    if (logo.kind === 'svg') logo.svg = await blob.text();
    else logo.dataUri = await blobToDataUri(blob);
  }
  const products = [];
  for (const product of Array.isArray(row.products) ? row.products : []) {
    try {
      products.push({ ...product, dataUri: await blobToDataUri(await cloud.download('brand-assets', product.path)) });
    } catch { /* a missing file just drops out of the tray */ }
  }
  brandKit = { logo, products, font: row.font?.dataUri ? row.font : null };
  if (brandKit.font) loadBrandFontFace(brandKit.font);
  logoTree = logo?.kind === 'svg' ? sanitizeSvg(logo.svg) : null;
  renderBrandTray();
}

function showAssetError(message) {
  for (const id of ['asset-error', 'attach-error']) {
    const node = $(id);
    if (!node) continue;
    node.textContent = message || '';
    node.hidden = !message;
  }
}

/** Downscales an image file on a canvas and returns it as a data URI. */
async function rasterToDataUri(file, maxSide, type, quality) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That image couldn’t be opened.'));
      img.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    return { dataUri: canvas.toDataURL(type, quality), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}


/**
 * A raster logo, resized, with a plain background removed. A photo background
 * can't be removed reliably, so it's kept with a warning: it will show as a box.
 */
async function prepareRasterLogo(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That image couldn’t be opened.'));
      img.src = url;
    });
    const scale = Math.min(1, 1000 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    const check = analyzeLogoPixels(pixels.data, width, height);
    let notice = '';
    if (!check.transparent && check.uniformEdges) {
      const cleared = removePlainBackground(pixels.data, width, height, { edgeColor: check.edgeColor });
      context.putImageData(pixels, 0, 0);
      notice = cleared > 0.05 ? 'Removed the plain background from your logo. If it looks wrong, upload an SVG or a PNG with a transparent background.' : '';
    } else if (!check.transparent) {
      notice = 'This logo has a photo background, so it will show as a box in films. For the best result, upload an SVG or a PNG with a transparent background.';
    }
    return { dataUri: canvas.toDataURL('image/png'), width, height, notice };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const dataUriBytes = (uri) => Math.round((uri.length - uri.indexOf(',') - 1) * 0.75);

// ---- brand font: measured here, drawn in previews, sent with plans and renders
function loadBrandFontFace(font) {
  try {
    const face = new FontFace(font.family, `url(${font.dataUri})`, { weight: String(font.metrics.weight) });
    document.fonts.add(face);
    face.load().then(() => render()).catch(() => {});
  } catch { /* previews fall back to the display face */ }
}

async function uploadFont(file) {
  showAssetError('');
  try {
    if (file.size > 3_000_000) throw new Error('That font is larger than 3 MB.');
    const buffer = await file.arrayBuffer();
    const metrics = readFontMetrics(buffer);
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const type = String.fromCharCode(...bytes.subarray(0, 4)) === 'OTTO' ? 'font/otf' : 'font/ttf';
    brandKit.font = { name: file.name, family: metrics.family, dataUri: `data:${type};base64,${btoa(binary)}`, metrics };
    loadBrandFontFace(brandKit.font);
    await saveBrandKit();
  } catch (error) {
    showAssetError(error.message);
  }
}

async function uploadLogo(file) {
  showAssetError('');
  try {
    if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
      const result = sanitizeSvg(await file.text());
      if (!result.ok) throw new Error(result.error);
      // Store the rebuilt, safe version; the server checks it again before rendering.
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${result.viewBox.join(' ')}">${serializeSvgTree(result.tree)}</svg>`;
      brandKit.logo = { kind: 'svg', name: file.name, svg, width: result.width, height: result.height };
    } else {
      const { dataUri, width, height, notice } = await prepareRasterLogo(file);
      if (dataUriBytes(dataUri) > BRAND_LIMITS.logoPngBytes) throw new Error('That logo is too large. Try a smaller PNG or an SVG.');
      brandKit.logo = { kind: 'png', name: file.name, dataUri, width, height };
      if (notice) showAssetError(notice);
    }
    await saveBrandKit();
  } catch (error) {
    showAssetError(error.message);
  }
}

async function addProducts(files) {
  showAssetError('');
  for (const file of files) {
    if (brandKit.products.length >= BRAND_LIMITS.products) {
      showAssetError(`That’s ${BRAND_LIMITS.products} product photos, the most one brand kit holds. Remove some to add others.`);
      break;
    }
    try {
      const { dataUri, width, height } = await rasterToDataUri(file, 1600, 'image/jpeg', 0.88);
      if (dataUriBytes(dataUri) > BRAND_LIMITS.productBytes) throw new Error(`${file.name} is too large even after resizing.`);
      brandKit.products.push({ id: `product-${Date.now().toString(36)}-${brandKit.products.length}`, name: file.name, dataUri, width, height });
    } catch (error) {
      showAssetError(error.message);
    }
  }
  await saveBrandKit();
}

function assetThumb({ src, name, onRemove, label, caption }) {
  const image = h('img', { class: 'asset-thumb', alt: name || label, src });
  const remove = h('button', { class: 'asset-remove', type: 'button', 'aria-label': `Remove ${label}`, text: '×' });
  remove.addEventListener('click', onRemove);
  return h('span', { class: 'asset-item', title: name ? `${caption ? `${caption}: ` : ''}${name}` : label }, image, remove,
    caption ? h('span', { class: 'asset-caption', text: caption }) : null);
}

function renderFontSlot() {
  const slot = $('font-slot');
  if (!slot) return;
  // Only the label's text changes: the file input inside the label must stay.
  if (!brandKit.font) { slot.replaceChildren(); $('font-button').firstChild.textContent = 'Upload font'; return; }
  const remove = h('button', { class: 'asset-remove', type: 'button', 'aria-label': 'Remove brand font', text: '×' });
  remove.addEventListener('click', async () => { brandKit.font = null; await saveBrandKit(); });
  slot.replaceChildren(h('span', { class: 'asset-item font-chip', title: brandKit.font.name },
    h('span', { class: 'font-sample', style: `font-family: '${brandKit.font.family}', var(--display); font-weight: ${brandKit.font.metrics.weight}`, text: 'Aa' }),
    h('span', { class: 'font-name', text: brandKit.font.family }), remove));
  $('font-button').firstChild.textContent = 'Replace';
}

function renderBrandTray() {
  renderFontSlot();
  const logoSlot = $('logo-slot');
  const productSlots = $('product-slots');
  if (!logoSlot || !productSlots) return;
  logoSlot.replaceChildren();
  if (brandKit.logo) {
    const src = brandKit.logo.kind === 'svg' ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(brandKit.logo.svg)}` : brandKit.logo.dataUri;
    logoSlot.append(assetThumb({ src, name: brandKit.logo.name, label: 'logo', onRemove: async () => {
      const path = brandKit.logo?.path;
      brandKit.logo = null;
      await saveBrandKit();
      if (cloud && path) cloud.removeObject('brand-assets', path).catch(() => {});
    } }));
  }
  productSlots.replaceChildren(...brandKit.products.map((product, index) => assetThumb({
    src: product.dataUri, name: product.name, label: `photo ${index + 1}`, caption: `Photo ${index + 1}`,
    onRemove: async () => {
      brandKit.products = brandKit.products.filter((item) => item.id !== product.id);
      await saveBrandKit();
      if (cloud && product.path) cloud.removeObject('brand-assets', product.path).catch(() => {});
    },
  })));
  $('product-button').hidden = brandKit.products.length >= BRAND_LIMITS.products;
  renderComposerAttachments();
}

/** Planning requests carry logo metadata only (so recipes can lay it out). */
// ------------------------------------------------------------------ formats

const FORMATS = {
  landscape: { width: 1280, height: 720, label: '16:9 Landscape', short: '16:9' },
  vertical: { width: 720, height: 1280, label: '9:16 Vertical', short: '9:16' },
  square: { width: 960, height: 960, label: '1:1 Square', short: '1:1' },
};
const formatOf = (record) => (FORMATS[record?.format] ? record.format : FORMATS[store.lastFormat] ? store.lastFormat : 'landscape');

/** The film's shape: its timeline's once built, otherwise the chosen format's. */
function frameOf(record) {
  const timeline = record?.project?.timeline;
  if (timeline?.width && timeline?.height) return { width: timeline.width, height: timeline.height };
  const { width, height } = FORMATS[formatOf(record)];
  return { width, height };
}

// Small thumbnails (320 px JPEG) let the model see each product photo when it
// directs the shots; made once per photo.
const productThumbs = new Map();
function thumbFor(product) {
  if (!product?.dataUri || productThumbs.has(product.id)) return productThumbs.get(product.id);
  productThumbs.set(product.id, undefined);
  const image = new Image();
  image.onload = () => {
    const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    productThumbs.set(product.id, canvas.toDataURL('image/jpeg', 0.72));
  };
  image.src = product.dataUri;
  return undefined;
}

function withBrand(context, record = activeRecord(), format = formatOf(record)) {
  const logo = brandKit.logo ? { kind: brandKit.logo.kind, width: brandKit.logo.width, height: brandKit.logo.height } : undefined;
  const products = brandKit.products.length ? brandKit.products.map((product) => {
    const thumb = thumbFor(product);
    return { width: product.width, height: product.height, ...(product.name ? { name: product.name } : {}), ...(thumb ? { thumb } : {}) };
  }) : undefined;
  const { width, height } = FORMATS[format];
  return { ...context, logo, products, width, height, brandFont: brandKit.font?.metrics };
}

/** Rebuilds the shots in a new format before rendering (same storyboard). */
function rebuildShots(record) {
  return work(record, `Rebuilding the shots in ${FORMATS[formatOf(record)].label}`, 'Couldn’t rebuild the shots', 'rebuild', async () => {
    const result = await rebuildRequest(record, record.project.storyboard, currentSpecs(record));
    record.project = { ...record.project, timeline: result.timeline, acceptance: result.acceptance };
    addMessage(record, 'system', 'timeline', { timeline: result.timeline, ...providerResult(result) });
  });
}

/** The directions the current shots were built with. */
const currentSpecs = (record) => record.project.timeline.shots.map((shot) => ({ ...shot.spec, elements: undefined }));

/** Rebuilds shots from directions, with no AI call (edits and format changes). */
function rebuildRequest(record, storyboard, shotSpecs, format = formatOf(record)) {
  return postJson('/api/generate', { action: 'rebuild', storyboard, shotSpecs, context: withBrand(record.project.context, record, format) });
}

// ------------------------------------------------------------------ edit shots in place

/** Inline editor for the built shots: line, seconds, shot type, photo, transition. */
const PHOTO_RECIPES = ['product-hero', 'type-window', 'product-grid', 'split'];

function shotEditor(record) {
  const { storyboard, timeline } = record.project;
  const photoCount = brandKit.products.length;
  const recipes = Object.keys(RECIPE_LABELS).filter((recipe) => (!PHOTO_RECIPES.includes(recipe) || photoCount) && (recipe !== 'product-grid' || photoCount >= 2) && (recipe !== 'logo-reveal' || brandKit.logo));
  const rows = timeline.shots.map((shot, index) => {
    const spec = shot.spec;
    const line = h('input', { class: 'edit-line', type: 'text', value: storyboard.shots[index].onScreenCopy, 'aria-label': `Shot ${index + 1} line`, maxlength: '90' });
    const seconds = h('input', { class: 'edit-seconds', type: 'number', min: '0.6', max: '12', step: '0.1', value: String(Number(storyboard.shots[index].durationSeconds.toFixed(2))), 'aria-label': `Shot ${index + 1} seconds` });
    const recipe = h('select', { class: 'edit-recipe', 'aria-label': `Shot ${index + 1} shot type` }, ...recipes.map((value) => h('option', { value, text: RECIPE_LABELS[value], ...(spec.recipe === value ? { selected: true } : {}) })));
    const currentPhoto = spec.elements?.find((element) => element.type === 'image')?.product || spec.elements?.find((element) => element.window)?.window?.product || spec.product || 1;
    const photo = h('select', { class: 'edit-photo', 'aria-label': `Shot ${index + 1} photo` }, ...brandKit.products.map((_, i) => h('option', { value: String(i + 1), text: `Photo ${i + 1}`, ...(currentPhoto === i + 1 ? { selected: true } : {}) })));
    const syncPhoto = () => { photo.hidden = !PHOTO_RECIPES.includes(recipe.value); };
    recipe.addEventListener('change', syncPhoto);
    syncPhoto();
    const last = index === timeline.shots.length - 1;
    const transition = last ? null : h('select', { class: 'edit-transition', 'aria-label': `Shot ${index + 1} transition` }, ...Object.entries(TRANSITION_LABELS).map(([value, label]) => h('option', { value, text: `Then: ${label}`, ...((spec.transitionOut || 'cut') === value ? { selected: true } : {}) })));
    return { line, seconds, recipe, photo, transition, node: h('div', { class: 'edit-row' },
      h('span', { class: 'edit-index', text: String(index + 1) }),
      h('div', { class: 'edit-fields' }, line, h('div', { class: 'edit-controls' }, seconds, h('span', { class: 'edit-unit', text: 's' }), recipe, photo, transition)),
    ) };
  });
  const apply = h('button', { class: 'pill pill-go', type: 'button', text: 'Apply changes' });
  const panel = h('details', { class: 'shot-editor' },
    h('summary', { text: 'Edit shots' }),
    h('p', { class: 'edit-hint', text: 'Change a line, a duration, a shot type, a photo or a transition. Changes rebuild instantly, with no AI call.' }),
    ...rows.map((row) => row.node),
    h('div', { class: 'edit-actions' }, apply));
  apply.addEventListener('click', () => {
    const edited = JSON.parse(JSON.stringify(storyboard));
    const specs = currentSpecs(record);
    for (const [index, row] of rows.entries()) {
      const text = row.line.value.trim();
      if (!text) return row.line.focus();
      edited.shots[index].onScreenCopy = text;
      edited.shots[index].durationSeconds = Math.min(12, Math.max(0.6, Number(row.seconds.value) || edited.shots[index].durationSeconds));
      specs[index].recipe = row.recipe.value;
      if (!row.photo.hidden) specs[index].product = Number(row.photo.value);
      if (row.transition) specs[index].transitionOut = row.transition.value;
    }
    editShots(record, edited, specs);
  });
  return panel;
}

function editShots(record, storyboard, shotSpecs) {
  return work(record, 'Updating the shots', 'Couldn’t update the shots', 'rebuild', async () => {
    const result = await rebuildRequest(record, storyboard, shotSpecs);
    record.project = { ...record.project, storyboard, timeline: result.timeline, acceptance: result.acceptance };
    addMessage(record, 'system', 'timeline', { timeline: result.timeline, ...providerResult(result) });
  });
}

// ------------------------------------------------------------------ every format in one go

/** Renders the approved film again in the formats it isn't in yet, through the queue. */
function makeOtherFormats(record) {
  const others = Object.keys(FORMATS).filter((format) => format !== formatOf(record) && !(record.project.variants || []).some((variant) => variant.format === format));
  return work(record, 'Rendering and checking', 'Couldn’t make the other formats', 'variants', async () => {
    for (const format of others) {
      const rebuilt = await rebuildRequest(record, record.project.storyboard, currentSpecs(record), format);
      const result = await renderQueued({
        timeline: rebuilt.timeline,
        storyboard: record.project.storyboard,
        acceptance: rebuilt.acceptance,
        context: withBrand(record.project.context, record, format),
        ...(brandAssets() ? { assets: brandAssets() } : {}),
        music: record.music || 'auto',
        grade: record.grade || 'auto',
      });
      const variant = { format, report: result.report, at: nowIso() };
      record.project = { ...record.project, variants: [...(record.project.variants || []), variant] };
      addMessage(record, 'system', 'variant', variant);
      persist();
    }
  });
}

function variantView(data) {
  const format = FORMATS[data.format];
  const video = data.report?.artifacts?.video;
  const checks = qaChecks(data.report);
  const failed = checks.filter((check) => !check.pass).length;
  return systemMessage(
    h('p', { class: 'msg-text', text: `${format?.label || data.format} version ready.` }),
    h('div', { class: 'block', style: `--frame-w: ${format?.width || 16}; --frame-h: ${format?.height || 9}` },
      safeOutputUrl(video) ? h('video', { class: 'player', src: video, controls: true, preload: 'metadata', playsinline: true, ...(data.report?.artifacts?.film?.path ? { 'data-film-path': data.report.artifacts.film.path } : {}) }) : null,
      h('p', { class: `qa-summary${failed ? ' is-fail' : ''}`, text: failed ? `${failed} of ${checks.length} QA checks failed` : `✓ All ${checks.length} QA checks passed` }),
      safeOutputUrl(video) ? h('a', { class: 'pill pill-go', href: downloadUrl(video, `fold-motion-${format?.short?.replace(':', 'x') || data.format}.mp4`), download: '', ...(data.report?.artifacts?.film?.path ? { 'data-film-path': data.report.artifacts.film.path, 'data-download': 'true' } : {}) }, icon('download'), `Download ${format?.short || ''}`) : null));
}

/** A format picker; after the shots are built, changing it rebuilds them. */
function formatPicker(record) {
  const select = h('select', { class: 'music-pick', 'aria-label': 'Format', title: 'Changing the format rebuilds the shots for the new frame.' },
    ...Object.entries(FORMATS).map(([value, format]) => h('option', { value, text: `Format: ${format.label}`, ...(formatOf(record) === value ? { selected: true } : {}) })));
  select.addEventListener('change', () => {
    record.format = select.value;
    store.lastFormat = select.value;
    syncFormatPick();
    persist();
    if (record.project.state === 'RENDERING') rebuildShots(record);
  });
  return select;
}

function syncFormatPick() {
  const record = activeRecord();
  $('format-pick').value = formatOf(record);
  const built = record?.project?.timeline && !['BRIEF', 'PLANNING', 'STORYBOARD_REVIEW', 'BUILDING'].includes(record.project.state);
  $('format-pick').title = built ? 'This film is built. Change its format on the “Shots built” card, or start a new chat.' : 'Pick the format before the shots are built: layout depends on it.';
}

$('format-pick').addEventListener('change', () => {
  const record = activeRecord();
  const value = $('format-pick').value;
  store.lastFormat = value;
  if (record && ['BRIEF', 'PLANNING', 'STORYBOARD_REVIEW'].includes(record.project.state)) record.format = value;
  else if (record?.project?.state === 'RENDERING') { record.format = value; rebuildShots(record); }
  else if (record && record.project.state !== 'BRIEF') say(record, `New films will be ${FORMATS[value].label}. This one is already rendered; start a new chat to make it in that format.`);
  persist();
  render();
});

/** Render requests carry the logo itself. */
/** Photo numbers a timeline shows (product heroes and type windows), or null. */
function photosUsed(timeline) {
  if (!timeline?.shots) return null;
  const used = new Set();
  for (const shot of timeline.shots) {
    for (const element of shot.spec?.elements || []) {
      if (element.type === 'image' && element.product) used.add(element.product);
      if (element.window?.product) used.add(element.window.product);
    }
  }
  return used;
}

function brandAssets() {
  if (!brandKit.logo && brandKit.products.length === 0 && !brandKit.font) return undefined;
  const assets = {};
  if (brandKit.font) assets.font = { dataUri: brandKit.font.dataUri };
  if (brandKit.logo) {
    assets.logo = cloud && brandKit.logo.path
      ? { kind: brandKit.logo.kind, path: brandKit.logo.path }
      : brandKit.logo.kind === 'svg' ? { kind: 'svg', svg: brandKit.logo.svg } : { kind: 'png', dataUri: brandKit.logo.dataUri };
  }
  if (brandKit.products.length) {
    // Only the photos this film shows travel with the render (the rest stay null,
    // keeping every photo's number), so a big brand kit costs nothing extra.
    const used = photosUsed(activeRecord()?.project?.timeline);
    assets.products = brandKit.products.map((product, index) => {
      if (used && !used.has(index + 1)) return null;
      return cloud && product.path ? { path: product.path } : { dataUri: product.dataUri };
    });
  }
  return assets;
}

function writeStoryboard(record) {
  record.format = formatOf(record); // the chat keeps the format it started with
  return work(record, 'Writing the storyboard', 'Couldn’t write the storyboard', 'storyboard', async () => {
    if (record.project.state === 'BRIEF') await transition(record, 'PLANNING');
    const result = await postJson('/api/generate', {
      action: 'storyboard',
      prompt: record.project.brief,
      context: withBrand(record.project.context, record),
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
      context: withBrand(record.project.context, record),
    });
    record.project = { ...record.project, timeline: result.timeline, compileProvider: result.provider };
    await transition(record, 'RENDERING');
    record.providers.compile = { ...providerResult(result), at: nowIso() };
    addMessage(record, 'system', 'timeline', { timeline: result.timeline, ...providerResult(result) });
  });
}

function renderFilm(record) {
  return work(record, 'Rendering and checking', 'Couldn’t render the film', 'render', async () => {
    const result = await renderQueued({
      timeline: record.project.timeline,
      storyboard: record.project.storyboard,
      acceptance: record.project.acceptance,
      context: withBrand(record.project.context, record),
      ...(brandAssets() ? { assets: brandAssets() } : {}),
      music: record.music || 'auto',
      grade: record.grade || 'auto',
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
    rebuild: () => rebuildShots(record),
    variants: () => makeOtherFormats(record),
  };
  actions[kind]?.();
}

function startNewProduction({ focus = true } = {}) {
  const previous = activeRecord();
  const record = newRecord(brandOnly(previous.context));
  store.records[record.id] = record;
  store.activeId = record.id;
  // Drop the previous record if it never got a message.
  if (previous.messages.length === 0) delete store.records[previous.id];
  persist();
  fillDetails(record);
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
    const next = newRecord(brandOnly(record.context));
    store.records[next.id] = next;
    store.activeId = next.id;
    record = next;
    fillDetails(record);
  }

  if (record.briefs.length > 0 && record.project.state !== 'BRIEF') {
    record.version += 1;
    record.briefs.push(text);
    said(record, text, usedContext(record, composeBrief(record.briefs)));
    if (STAGE_OF_STATE[state] >= 1) {
      say(record, 'Revising with your notes. The production restarts from the storyboard.');
    }
  } else {
    if (record.briefs.length === 0) record.briefs = [text];
    else record.briefs.push(text);
    said(record, text, usedContext(record, composeBrief(record.briefs)));
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
/** The uploaded logo in a preview frame (or an outlined box if it was removed). */
function logoPreview(element, primary) {
  const x = element.x - element.width / 2;
  const y = element.y - element.height / 2;
  if (brandKit.logo?.kind === 'png') {
    return svgEl('image', { href: brandKit.logo.dataUri, x, y, width: element.width, height: element.height, preserveAspectRatio: 'xMidYMid meet' });
  }
  if (brandKit.logo?.kind === 'svg' && logoTree?.ok) {
    const text = readableText(primary);
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${logoTree.viewBox.join(' ')}" x="${x}" y="${y}" width="${element.width}" height="${element.height}"><g fill="${text}" color="${text}">${serializeSvgTree(logoTree.tree, { idPrefix: `${element.id}-` })}</g></svg>`;
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
    return document.importNode(parsed, true);
  }
  return svgEl('rect', { x, y, width: element.width, height: element.height, fill: 'none', stroke: '#9D86F0', 'stroke-dasharray': '6 6' });
}

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
  } else if (motion.atmosphere === 'planes') {
    for (const [size, px, py, rotation, opacity] of [[0.7, 0.77, 0.08, -8, 0.08], [0.47, 0.09, 0.58, 12, 0.1], [0.3, 0.83, 0.72, 24, 0.13]]) {
      const s = size * width;
      const x = px * width;
      const y = py * height;
      stage.append(svgEl('path', { d: `M ${x - s / 2} ${y - s * 0.29} L ${x + s / 2} ${y - s * 0.29} L ${x} ${y + s * 0.58} Z`, fill: 'none', stroke: accent, 'stroke-width': 1.5, opacity, transform: `rotate(${rotation} ${x} ${y})` }));
    }
  } else if (motion.atmosphere === 'dots') {
    const step = Math.round(width / 32);
    for (let y = step / 2; y < height; y += step) {
      for (let x = step / 2; x < width; x += step) stage.append(svgEl('circle', { cx: x, cy: y, r: 1.4, fill: accent, opacity: 0.16 }));
    }
  }

  for (const element of elements) {
    if (isBackground(element)) continue;
    const fill = isHex(element.fill) ? element.fill : '#F8FAFC';
    if (element.type === 'rect') {
      stage.append(svgEl('rect', { x: element.x, y: element.y, width: element.width, height: element.height, fill }));
    } else if (element.type === 'circle') {
      stage.append(svgEl('circle', { cx: element.x, cy: element.y, r: element.radius ?? 12, fill }));
    } else if (element.type === 'logo') {
      stage.append(logoPreview(element, primary));
    } else if (element.type === 'image') {
      const product = brandKit.products[element.product - 1];
      if (product) stage.append(svgEl('image', { href: product.dataUri, x: element.x, y: element.y, width: element.width, height: element.height, preserveAspectRatio: 'xMidYMid slice', opacity: 0.9 }));
      else stage.append(svgEl('rect', { x: element.x, y: element.y, width: element.width, height: element.height, fill: 'none', stroke: '#9D86F0', 'stroke-dasharray': '6 6' }));
    } else if (element.type === 'line') {
      const x = element.reveal?.from === 'left' ? element.x : element.x - element.width / 2;
      stage.append(svgEl('rect', { x, y: element.y - element.height / 2, width: element.width, height: element.height, fill, opacity: 0.85 }));
    } else if (element.type === 'text' && Array.isArray(element.lines)) {
      // v2 text: the recipe already measured and wrapped it; draw its final state.
      const [family, weight] = String(element.font).startsWith('brand-') && brandKit.font ? [`'${brandKit.font.family}'`, brandKit.font.metrics.weight] : PREVIEW_FONTS[element.font] || PREVIEW_FONTS.bold;
      const emphasis = new Set(element.emphasis?.words ?? []);
      // Type windows: the letters are filled with the product photo.
      const windowProduct = element.window ? brandKit.products[element.window.product - 1] : null;
      let windowFill = null;
      if (windowProduct) {
        const patternId = `${element.id}-photo-${Math.random().toString(36).slice(2, 7)}`;
        const pattern = svgEl('pattern', { id: patternId, patternUnits: 'userSpaceOnUse', x: 0, y: element.y - element.fontSize, width, height: element.fontSize * 1.3 });
        pattern.append(svgEl('image', { href: windowProduct.dataUri, x: 0, y: 0, width, height: element.fontSize * 1.3, preserveAspectRatio: 'xMidYMid slice' }));
        defs.append(pattern);
        windowFill = `url(#${patternId})`;
      }
      let wordIndex = 0;
      let baseline = element.y;
      element.lines.forEach((line, index) => {
        const size = element.lineSizes?.[index] ?? element.fontSize;
        if (index > 0) baseline = element.lineSizes ? baseline + element.lineHeight + size * (element.font === 'display' ? 0.86 : 0.7) : element.y + index * element.lineHeight;
        const text = svgEl('text', {
          x: element.x,
          y: baseline,
          'text-anchor': element.anchor === 'start' ? 'start' : element.anchor === 'end' ? 'end' : 'middle',
          fill: windowFill || fill,
          ...(windowFill ? { stroke: element.window.outline, 'stroke-width': Math.max(1.2, size * 0.006) } : {}),
          'font-family': family,
          'font-weight': weight,
          'font-size': size,
          'letter-spacing': (element.tracking || 0) * size,
        });
        line.split(' ').forEach((word, position) => {
          const span = svgEl('tspan', emphasis.has(wordIndex) && element.emphasis?.to ? { fill: element.emphasis.to } : {});
          span.textContent = position ? ` ${word}` : word;
          text.append(span);
          wordIndex += 1;
        });
        stage.append(text);
      });
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
      item.recipe ? h('p', { class: 'shot-tags' },
        h('span', { class: 'shot-tag', title: 'staging', text: RECIPE_LABELS[item.recipe] || item.recipe }),
        h('span', { class: 'shot-tag', title: 'atmosphere', text: MOTION_LABELS.atmosphere[{ ...DEFAULT_MOTION, ...item.motion }.atmosphere] || '' }),
        h('span', { class: 'shot-tag', title: 'camera', text: MOTION_LABELS.camera[{ ...DEFAULT_MOTION, ...item.motion }.camera] || '' }),
        item.transitionOut && item.transitionOut !== 'cut' && !item.last ? h('span', { class: 'shot-tag', title: 'transition to the next shot', text: `then ${item.transitionOut === 'fold' ? 'The Fold' : (TRANSITION_LABELS[item.transitionOut] || item.transitionOut).toLowerCase()}` }) : null)
        : item.motion ? h('p', { class: 'shot-tags' }, ['camera', 'entrance', 'atmosphere'].map((field) => h('span', {
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
      content.push(goButton('Render and run QA', () => renderFilm(record)), formatPicker(record), musicPicker(record), lookPicker(record), changesButton(), shotEditor(record));
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
      content.push(goButton('Approve final cut', () => approveCut(record)), changesButton(), ...otherFormatsButton(record));
      if (!passes) {
        content[0].disabled = true;
        content.push(h('p', { class: 'gate-note', text: 'Every check has to pass before the cut can be approved. Ask for changes to fix the failing checks.' }));
      }
    } else if (stage > PROJECT_STATES.indexOf('QA')) content.push(stamp('Final cut approved'));
  } else if (message.type === 'approved') {
    if (state === 'APPROVED') content.push(goButton('Deliver', () => deliver(record)), ...otherFormatsButton(record));
  }

  slot.replaceChildren(...content);
  slot.hidden = content.length === 0;
}

function otherFormatsButton(record) {
  const others = Object.keys(FORMATS).filter((format) => format !== formatOf(record) && !(record.project.variants || []).some((variant) => variant.format === format));
  if (!others.length || !record.project.renderReport) return [];
  const button = h('button', { class: 'pill', type: 'button', text: `Also make ${others.map((format) => FORMATS[format].short).join(' and ')}` });
  button.addEventListener('click', () => makeOtherFormats(record));
  return [button];
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
      MOOD_LABELS[storyboard.musicMood] ? h('p', { class: 'music-line', text: `Music: ${MOOD_LABELS[storyboard.musicMood]}${storyboard.musicReason ? `. ${storyboard.musicReason}` : ''}${LOOK_LABELS[storyboard.grade] ? ` Look: ${LOOK_LABELS[storyboard.grade]}.` : ''}` }) : null,
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
        copy: (shot.spec.elements.find((element) => element.role === 'title') || shot.spec.elements.find((element) => element.type === 'text'))?.content || shot.shotId,
        purpose: shot.purpose,
        motion: shot.spec.motion,
        recipe: shot.spec.version === 2 ? shot.spec.recipe : undefined,
        transitionOut: shot.spec.transitionOut,
        last: shot === timeline.shots.at(-1),
        spec: shot.spec,
      })), palette),
      directorNotes(timeline),
      toggles(message.id, [{ label: 'Timeline JSON', render: () => h('pre', { class: 'code', text: JSON.stringify(timeline, null, 2) }) }]),
      gate));
  return { node, gate };
}

/** The model's reason for each shot's staging, and which product photo it chose. */
function directorNotes(timeline) {
  const notes = timeline.shots.map((shot, index) => {
    const photo = shot.spec.elements?.find((element) => element.type === 'image')?.product
      || shot.spec.elements?.find((element) => element.window)?.window?.product;
    return { index, recipe: RECIPE_LABELS[shot.spec.recipe] || shot.spec.recipe, photo, reason: shot.spec.reason };
  }).filter((note) => note.reason);
  if (notes.length === 0) return null;
  return h('details', { class: 'director-notes' },
    h('summary', { text: `Director’s notes (${notes.length})` }),
    h('ol', {}, ...notes.map((note) => h('li', {},
      h('span', { class: 'director-shot', text: `Shot ${note.index + 1} · ${note.recipe}${note.photo ? ` · photo ${note.photo}` : ''}` }),
      h('span', { class: 'director-reason', text: note.reason })))));
}


// ------------------------------------------------------------------ music (FOLD Score)

const MOOD_LABELS = { premium: 'Premium calm', energetic: 'Energetic', editorial: 'Editorial', warm: 'Warm' };
const MUSIC_CHOICES = [
  ['auto', 'Music: Auto'],
  ['premium', 'Music: Premium calm'],
  ['energetic', 'Music: Energetic'],
  ['editorial', 'Music: Editorial'],
  ['warm', 'Music: Warm'],
  ['off', 'No music'],
];

/** The soundtrack choice for this production, sent with the render. */
function musicPicker(record) {
  const directed = MOOD_LABELS[record.project?.storyboard?.musicMood];
  const select = h('select', { class: 'music-pick', 'aria-label': 'Music for this film', title: 'FOLD Score composes music from your edit. Auto uses the mood the storyboard chose.' },
    ...MUSIC_CHOICES.map(([value, label]) => h('option', { value, text: value === 'auto' && directed ? `Music: Auto (${directed})` : label, ...((record.music || 'auto') === value ? { selected: true } : {}) })));
  select.addEventListener('change', () => {
    record.music = select.value;
    persist();
  });
  return select;
}

const LOOK_LABELS = { clean: 'Clean', cinematic: 'Cinematic', matte: 'Matte', noir: 'Noir' };

/** The film's look (color grade), sent with the render. */
function lookPicker(record) {
  const directed = LOOK_LABELS[record.project?.storyboard?.grade];
  const choices = [['auto', directed ? `Look: Auto (${directed})` : 'Look: Auto'], ...Object.entries(LOOK_LABELS).map(([value, label]) => [value, `Look: ${label}`])];
  const select = h('select', { class: 'music-pick', 'aria-label': 'Look for this film', title: 'A color grade over the whole film. Clean keeps your brand colors exact.' },
    ...choices.map(([value, label]) => h('option', { value, text: label, ...((record.grade || 'auto') === value ? { selected: true } : {}) })));
  select.addEventListener('change', () => {
    record.grade = select.value;
    persist();
  });
  return select;
}

function musicLine(report) {
  const audio = report?.audio;
  if (!audio) return null;
  const look = LOOK_LABELS[report?.look] ? `. Look: ${LOOK_LABELS[report.look]}` : '';
  const text = `${audio.engine === 'FOLD Score' ? `Music: FOLD Score, ${audio.label}, ${audio.bpm} bpm, ${audio.key}` : 'No music'}${look}`;
  return h('p', { class: 'music-line', text });
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
    ['Fit', creative.frameFit, (c) => (c.pass ? 'All text inside the frame' : `${c.failures.length} line${c.failures.length === 1 ? '' : 's'} outside the frame: “${c.failures[0]?.line}”`)],
    ['Loudness', production.audio?.loudness, (c) => `${number(c.actual, 1)} LUFS, target ${c.target}`],
    ['Peaks', production.audio?.truePeak, (c) => `${number(c.actual, 1)} dB, limit ${c.limit}`],
    ['Sync', production.audio?.sync, (c) => `${c.onTime} of ${c.checked} hits within ${c.tolerance}`],
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
      safeOutputUrl(video) ? h('video', { class: 'player', src: video, controls: true, preload: 'metadata', playsinline: true, ...(report?.artifacts?.film?.path ? { 'data-film-path': report.artifacts.film.path } : {}) }) : null,
      musicLine(report),
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
    film ? h('a', { class: 'pill pill-go', href: downloadUrl(film), download: '', ...(artifacts?.film?.path ? { 'data-film-path': artifacts.film.path, 'data-download': 'true' } : {}) }, icon('download'), 'Download film') : null,
    sources.length ? h('p', { class: 'sources' },
      sources.flatMap(([label, url], index) => [
        index ? h('span', { class: 'sources-slash', 'aria-hidden': 'true', text: ' / ' }) : null,
        h('a', { href: url, text: label }),
      ])) : null);
}

function briefChips(data) {
  const { headline, subheadline, primaryColor, accentColor } = data.context;
  const chip = (content, title, extra = '') => h('span', { class: `brief-chip${extra}`, title }, ...content);
  const swatch = (color) => { const dot = h('span', { class: 'brief-swatch', 'aria-hidden': 'true' }); dot.style.background = color; return dot; };
  return h('div', { class: 'brief-chips', 'aria-label': 'Sent with' },
    headline
      ? chip([`Headline “${headline}”`], 'Exact headline for the first shot')
      : chip(['No headline set: Gemini writes the copy'], 'Add one under Add headline and colors', ' is-missing'),
    subheadline ? chip([`Subheadline “${subheadline}”`], 'Exact line for the final shot') : null,
    chip([swatch(primaryColor), primaryColor, swatch(accentColor), accentColor], 'Primary and accent colors'),
    chip([data.seconds ? `${data.seconds}s from your brief` : '8s default length'], data.seconds ? 'Length read from the brief' : 'Say a length in the brief, like "10-second"'),
    data.logo ? chip([`Logo (${data.logo.toUpperCase()})`], 'Your logo appears on the end card and The Fold') : null,
    data.products ? chip([`${data.products} product photo${data.products === 1 ? '' : 's'}`], 'Stored with your brand kit') : null,
    data.briefHasOnScreenText && (headline || subheadline)
      ? chip(['Copy fields override your brief’s on-screen text'], 'Clear the headline and subheadline to use the brief’s own text', ' is-missing')
      : null);
}

function messageView(message, record) {
  const { type, role, data } = message;
  if (role === 'director') {
    const node = h('article', { class: 'msg msg-director' }, h('div', { class: 'bubble' }, h('span', { class: 'sr-only', text: 'You: ' }), data.text));
    if (data.context) node.append(briefChips(data));
    return { node };
  }
  try {
    if (type === 'storyboard') return storyboardView(message);
    if (type === 'timeline') return timelineView(message);
    if (type === 'render') return renderView(message);
    if (type === 'variant') return { node: variantView(data) };
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
        exportLinks(data.artifacts),
        ...(record.project.variants || []).filter((variant) => safeOutputUrl(variant.report?.artifacts?.video)).map((variant) => h('a', { class: 'pill', href: downloadUrl(variant.report.artifacts.video, `fold-motion-${FORMATS[variant.format]?.short?.replace(':', 'x')}.mp4`), download: '', ...(variant.report.artifacts.film?.path ? { 'data-film-path': variant.report.artifacts.film.path, 'data-download': 'true' } : {}) }, icon('download'), `Download ${FORMATS[variant.format]?.short || variant.format}`))),
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

const RENDER_STAGES = {
  queued: 'Waiting for the renderer',
  preparing: 'Preparing the shots',
  drawing: 'Drawing frames',
  scoring: 'Mixing the score',
  encoding: 'Encoding the film',
  validating: 'Running QA',
  saving: 'Saving to your account',
};

function updateWorking() {
  if (!workingNode || !busy) return;
  const elapsed = Math.round((Date.now() - busy.startedAt) / 1000);
  const progress = busy.progress;
  const bar = workingNode.querySelector('.progress');
  if (progress && bar) {
    // Drawing frames is most of the work: the bar runs 5–85% while drawing.
    const drawn = progress.total ? progress.done / progress.total : 0;
    const share = { queued: 0, preparing: 0.03, drawing: 0.05 + 0.8 * drawn, scoring: 0.86, encoding: 0.9, validating: 0.95, saving: 0.98 }[progress.stage] ?? 0;
    bar.hidden = false;
    bar.firstChild.style.width = `${Math.round(share * 100)}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(share * 100)));
    let text = RENDER_STAGES[progress.stage] || 'Rendering';
    if (progress.position > 1) text = `In line: #${progress.position}, another film is rendering`;
    else if (progress.stage === 'drawing' && progress.total) {
      const rate = progress.done / Math.max(1, progress.drawingSeconds || 1);
      const left = rate > 0 ? Math.round((progress.total - progress.done) / rate) : 0;
      text = `Drawing frames · ${progress.done} of ${progress.total}${progress.done > 12 && left > 0 ? ` · about ${left < 60 ? `${left}s` : `${Math.round(left / 60)} min`} left` : ''}`;
    }
    workingNode.querySelector('.shimmer-text').textContent = `${text}…`;
    workingNode.querySelector('.working-time').textContent = `${elapsed}s`;
    return;
  }
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
    h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Render progress', 'aria-valuemin': '0', 'aria-valuemax': '100', hidden: true }, h('span')),
    skeleton));
}

function renderThread(record, { stick = false } = {}) {
  const frame = frameOf(record);
  thread.style.setProperty('--frame-w', frame.width);
  thread.style.setProperty('--frame-h', frame.height);
  syncFormatPick();
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

  // The welcome (no messages yet) reads from the top; conversations follow the latest message.
  if (record.messages.length === 0) threadScroll.scrollTop = 0;
  else if (stick || nearBottom) threadScroll.scrollTop = threadScroll.scrollHeight;
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
  for (const [field, color] of [['primary-hex', context.primaryColor], ['accent-hex', context.accentColor]]) {
    if (document.activeElement !== $(field)) $(field).value = color;
  }
  $('details-label').textContent = context.headline
    ? `“${context.headline.length > 24 ? `${context.headline.slice(0, 23).trimEnd()}…` : context.headline}”`
    : 'Add headline and colors';
  $('details-note').textContent = record.briefs.length && state !== 'BRIEF'
    ? 'Changes here apply to the next storyboard you ask for.'
    : 'Exact copy, brand colors, logo and product photos. The AI can’t change these.';
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
        onclick: () => openRecord(record),
      },
      h('span', { class: 'poster', style: `--frame-w: ${frameOf(record).width}; --frame-h: ${frameOf(record).height}` }, posterFor(record)),
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
        onclick: () => removeRecord(record),
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
        ? h('video', { class: 'player', src: artifacts.video, controls: true, preload: 'metadata', playsinline: true, ...(artifacts?.film?.path ? { 'data-film-path': artifacts.film.path } : {}) })
        : h('span', { class: 'poster', style: `--frame-w: ${frameOf(record).width}; --frame-h: ${frameOf(record).height}` }, posterFor(record)),
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
    authInfo = result.auth?.provider === 'supabase' ? result.auth : null;
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
  // A sign-in link carries the session after "#": leave it for sign-in to read and clean.
  const signInHash = /(^|[#&])(access_token|error_description|error)=/.test(location.hash);
  if (!signInHash && location.hash.slice(1) !== currentView) history.replaceState(null, '', currentView === 'studio' ? location.pathname : `#${currentView}`);
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
  renderHistory();
  if (currentView === 'studio') {
    renderHead(record);
    renderThread(record, options);
    trackLiveGate(record);
    syncComposer();
  } else if (currentView === 'projects') renderProjects();
  else if (currentView === 'library') renderLibrary();
  else if (currentView === 'system') renderSystem();
  renderDock(record);
  refreshFilmLinks();
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

// Typed hex codes: accept "0E0E11" or "#0e0e11", update the picker as soon as it's valid.
for (const [field, picker, key] of [['primary-hex', 'primary-color-input', 'primaryColor'], ['accent-hex', 'accent-color-input', 'accentColor']]) {
  $(field).addEventListener('input', (event) => {
    const raw = event.target.value.trim();
    const hex = raw.startsWith('#') ? raw : `#${raw}`;
    const valid = /^#[\da-f]{6}$/i.test(hex);
    event.target.setAttribute('aria-invalid', String(!valid));
    if (!valid) return;
    const record = activeRecord();
    record.context = cleanContext({ ...record.context, [key]: hex });
    $(picker).value = hex.toLowerCase();
    persist();
    syncComposer();
  });
  $(field).addEventListener('blur', (event) => {
    event.target.removeAttribute('aria-invalid');
    event.target.value = activeRecord().context[key];
  });
}

$('logo-input').addEventListener('change', (event) => { const [file] = event.target.files; if (file) uploadLogo(file); event.target.value = ''; });
$('font-input').addEventListener('change', (event) => { const [file] = event.target.files; if (file) uploadFont(file); event.target.value = ''; });
$('product-input').addEventListener('change', (event) => { addProducts([...event.target.files]); event.target.value = ''; });

$('new-production').addEventListener('click', () => startNewProduction());

$('clear-log').addEventListener('click', () => {
  store.log = [];
  persist();
  render();
});

$('clear-data').addEventListener('click', async () => {
  if (busy) return;
  const question = cloud
    ? 'Delete every production in your account? Your brand kit and saved films are kept.'
    : 'Delete every production, conversation and activity entry saved in this browser? Rendered files on the server are not affected.';
  if (!window.confirm(question)) return;
  if (cloud) {
    try {
      await cloud.remove('projects', `owner=eq.${cloud.user.id}`);
      syncedJson.clear();
    } catch (error) {
      window.alert(`Couldn’t delete from Supabase: ${error.message}`);
      return;
    }
  }
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



// ------------------------------------------------------------------ chat history

/** Deletes a production (and, when signed in, its copy in Supabase). */
async function removeRecord(record) {
  if (busy && busy.recordId === record.id) return;
  const where = cloud ? 'from your account' : 'from this browser';
  if (!window.confirm(`Delete “${recordTitle(record)}” and its conversation ${where}? Saved films are kept.`)) return;
  if (cloud) {
    try {
      await cloud.remove('projects', `id=eq.${encodeURIComponent(record.id)}`);
      syncedJson.delete(record.id);
    } catch (error) {
      window.alert(`Couldn’t delete it from Supabase: ${error.message}`);
      return;
    }
  }
  delete store.records[record.id];
  nodeCache.clear();
  if (store.activeId === record.id) {
    store.activeId = null;
    thread.dataset.recordId = '';
    fillDetails(activeRecord());
  }
  persist();
  render();
}

function openRecord(record) {
  store.activeId = record.id;
  persist();
  fillDetails(record);
  closeHistory();
  showView('studio');
}

function historyGroup(iso) {
  const then = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((today - new Date(then.getFullYear(), then.getMonth(), then.getDate())) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 days';
  return 'Older';
}

function renderHistory() {
  const list = $('history-list');
  if (!list) return;
  const records = listedRecords();
  if (records.length === 0) {
    list.replaceChildren(h('p', { class: 'history-empty', text: 'Your chats appear here.' }));
    return;
  }
  const groups = new Map();
  for (const record of records) {
    const group = historyGroup(record.updatedAt);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(record);
  }
  list.replaceChildren(...[...groups].map(([group, items]) => h('section', { class: 'history-group' },
    h('h2', { class: 'history-heading', text: group }),
    h('ul', {}, ...items.map((record) => {
      const state = record.project.state;
      const tone = WAITING_STATES.has(state) ? 'waiting' : state === 'DELIVERED' ? 'done' : 'progress';
      const active = record.id === store.activeId && currentView === 'studio';
      const remove = h('button', { class: 'history-remove', type: 'button', 'aria-label': `Delete ${recordTitle(record)}`, title: 'Delete chat', text: '×' });
      remove.addEventListener('click', (event) => { event.stopPropagation(); removeRecord(record); });
      const open = h('button', { class: 'history-open', type: 'button', ...(active ? { 'aria-current': 'page' } : {}) },
        h('span', { class: `history-dot is-${tone}`, 'aria-hidden': 'true' }),
        h('span', { class: 'history-title', text: recordTitle(record) }));
      open.addEventListener('click', () => openRecord(record));
      return h('li', { class: `history-item${active ? ' is-active' : ''}` }, open, remove);
    })))));
}

function closeHistory() {
  $('view-studio').classList.remove('history-open');
  $('history-toggle').setAttribute('aria-expanded', 'false');
  $('history-scrim').hidden = true;
}

$('history-new').addEventListener('click', () => {
  closeHistory();
  startNewProduction();
});
$('history-toggle').addEventListener('click', () => {
  const open = !$('view-studio').classList.contains('history-open');
  $('view-studio').classList.toggle('history-open', open);
  $('history-toggle').setAttribute('aria-expanded', String(open));
  $('history-scrim').hidden = !open;
});
$('history-scrim').addEventListener('click', closeHistory);

// ------------------------------------------------------------------ attach (logo and product photos)

function closeAttachMenu() {
  $('attach-menu').hidden = true;
  $('attach-button').setAttribute('aria-expanded', 'false');
}

$('attach-button').addEventListener('click', (event) => {
  event.stopPropagation();
  const open = $('attach-menu').hidden;
  $('attach-menu').hidden = !open;
  $('attach-button').setAttribute('aria-expanded', String(open));
  if (open) $('attach-menu').querySelector('button')?.focus();
});
$('attach-menu').addEventListener('click', (event) => {
  const choice = event.target.closest('[data-attach]')?.dataset.attach;
  if (!choice) return;
  closeAttachMenu();
  $({ logo: 'logo-input', font: 'font-input', products: 'product-input' }[choice]).click();
});
document.addEventListener('click', (event) => {
  if (!$('attach-menu').hidden && !event.target.closest('.attach')) closeAttachMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!$('attach-menu').hidden) { closeAttachMenu(); $('attach-button').focus(); }
  if ($('view-studio').classList.contains('history-open')) closeHistory();
});

/** Small thumbnails above the message box: what goes with every brief. */
function renderComposerAttachments() {
  brandKit.products.forEach(thumbFor);
  const strip = $('composer-attachments');
  if (!strip) return;
  const items = [];
  if (brandKit.logo) {
    const src = brandKit.logo.kind === 'svg' ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(brandKit.logo.svg)}` : brandKit.logo.dataUri;
    items.push({ src, label: 'Logo', name: brandKit.logo.name, remove: async () => {
      const path = brandKit.logo?.path;
      brandKit.logo = null;
      await saveBrandKit();
      if (cloud && path) cloud.removeObject('brand-assets', path).catch(() => {});
    } });
  }
  brandKit.products.forEach((product, index) => items.push({ src: product.dataUri, label: `Photo ${index + 1}`, name: product.name, remove: async () => {
    brandKit.products = brandKit.products.filter((item) => item.id !== product.id);
    await saveBrandKit();
    if (cloud && product.path) cloud.removeObject('brand-assets', product.path).catch(() => {});
  } }));
  strip.hidden = items.length === 0;
  // A big brand kit shows its first photos and a chip for the rest.
  const shown = items.length > 8 ? items.slice(0, 7) : items;
  const more = items.length - shown.length;
  strip.replaceChildren(...shown.map((item) => {
    const remove = h('button', { class: 'attachment-remove', type: 'button', 'aria-label': `Remove ${item.label.toLowerCase()}`, text: '×' });
    remove.addEventListener('click', item.remove);
    return h('span', { class: 'attachment', title: item.name || item.label },
      h('img', { src: item.src, alt: item.name || item.label }),
      h('span', { class: 'attachment-label', text: item.label }),
      remove);
  }));
  if (more > 0) {
    const chip = h('button', { class: 'attachment attachment-more', type: 'button', text: `+${more} more`, title: 'See every photo in the brand kit' });
    chip.addEventListener('click', () => { if ($('brief-details').hidden) $('details-toggle').click(); });
    strip.append(chip);
  }
}

// ------------------------------------------------------------------ sign-in (Supabase)

function showSignIn(message = '') {
  $('signin').hidden = false;
  document.querySelector('.app').hidden = true;
  $('signin-status').textContent = message;
  $('signin-status').dataset.tone = message ? 'warn' : '';
  setTimeout(() => $('signin-email').focus(), 0);
}

function hideSignIn() {
  $('signin').hidden = true;
  document.querySelector('.app').hidden = false;
}

$('signin-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = $('signin-email').value.trim();
  const status = $('signin-status');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    status.textContent = 'Enter a valid email address.';
    status.dataset.tone = 'warn';
    return;
  }
  $('signin-submit').disabled = true;
  status.dataset.tone = '';
  status.textContent = 'Sending your link…';
  try {
    const client = cloud || createSupabaseClient({ url: authInfo.url, publishableKey: authInfo.publishableKey });
    await client.sendSignInLink(email, `${location.origin}${location.pathname}`);
    status.textContent = `Check ${email} for your sign-in link. You can close this tab.`;
  } catch (error) {
    status.textContent = `Couldn’t send the link: ${error.message}`;
    status.dataset.tone = 'warn';
  } finally {
    $('signin-submit').disabled = false;
  }
});

$('sign-out').addEventListener('click', async () => {
  if (busy || !cloud) return;
  await syncToCloud();
  await cloud.signOut();
  cloud = null;
  localStorage.removeItem(STORE_KEY);
  location.reload();
});

/** Loads the signed-in user's projects; on first sign-in, imports this browser's. */
async function enterCloud(client) {
  cloud = client;
  hideSignIn();
  $('account-panel').hidden = false;
  $('account-email').textContent = cloud.user.email;
  const local = loadStore();
  let rows = await cloud.select('projects', 'select=id,data&order=updated_at.desc&limit=200');
  const importedKey = `fold-motion.imported.${cloud.user.id}`;
  const localRecords = Object.values(local.records || {}).filter((record) => record.messages?.length > 0);
  if (rows.length === 0 && localRecords.length > 0 && !localStorage.getItem(importedKey)) {
    await cloud.upsert('projects', localRecords.map((record) => ({ id: record.id, owner: cloud.user.id, title: recordTitle(record), data: record, updated_at: record.updatedAt || new Date().toISOString() })));
    localStorage.setItem(importedKey, new Date().toISOString());
    logEvent('Imported', `Moved ${localRecords.length} production${localRecords.length === 1 ? '' : 's'} from this browser to your account.`);
    rows = await cloud.select('projects', 'select=id,data&order=updated_at.desc&limit=200');
  }
  const records = {};
  for (const row of rows) {
    if (row?.data && PROJECT_STATES.includes(row.data?.project?.state)) {
      records[row.id] = row.data;
      syncedJson.set(row.id, JSON.stringify(row.data));
    }
  }
  store = { ...emptyStore(), records, activeId: records[local.activeId] ? local.activeId : rows[0]?.id || null, log: Array.isArray(local.log) ? local.log.slice(-LOG_LIMIT) : [], lastFormat: local.lastFormat };
  nodeCache.clear();
  thread.dataset.recordId = '';
  await loadBrandKit();
  fillDetails(activeRecord());
  persist();
  render();
}

// A sign-in link opened in a tab that already shows the studio only changes the
// address after "#", which doesn't reload the page: pick the session up then too.
window.addEventListener('hashchange', () => {
  if (/(^|[#&])(access_token|error_description)=/.test(location.hash)) start();
});

async function start() {
  await loadEngine();
  if (!authInfo) {
    hideSignIn();
    await loadBrandKit();
    return;
  }
  const client = createSupabaseClient({ url: authInfo.url, publishableKey: authInfo.publishableKey });
  const redirect = await client.consumeRedirect();
  if (!client.user) {
    showSignIn(redirect.error || '');
    return;
  }
  try {
    await enterCloud(client);
  } catch (error) {
    if (error.status === 401) {
      await client.signOut();
      showSignIn('Your session ended. Sign in again.');
    } else {
      showSignIn(`Signed in, but couldn’t load your projects: ${error.message}`);
    }
  }
}

// ------------------------------------------------------------------ start

renderStarters();
fillDetails(activeRecord());
showView(location.hash.replace(/^#/, '').split('&')[0].split('=')[0] === 'access_token' ? '' : location.hash.slice(1));
autosize();
start();
