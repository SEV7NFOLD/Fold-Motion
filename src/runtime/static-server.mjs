import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { generateProductionAction, getEngineConfig } from './creative-api.mjs';
import { getGeminiKeyPool } from '../ai/provider.mjs';
import { validateStoryboard, validateTimeline } from '../production/production.mjs';
import { transitionProject } from '../orchestrator/project-state.mjs';
import { handleStoryboardRequest } from '../routes/storyboard.mjs';

import { resolveBrandAssets } from '../production/brand-assets.mjs';
import { loadStoredAssets, publicAuthConfig, requireUser, storeFilm, FILM_BUCKET } from './supabase-server.mjs';
const MAX_GENERATE_BODY_BYTES = 1024 * 1024;
const MAX_RENDER_BODY_BYTES = 16 * 1024 * 1024;
const DEFAULT_SCENE_CONTEXT = {
  width: 1280,
  height: 720,
  fps: 24,
  primaryColor: '#0B0F19',
  accentColor: '#00F0FF',
};
const execFileAsync = promisify(execFile);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function contentTypeFor(filePath) {
  return contentTypes[path.extname(filePath)] ?? 'application/octet-stream';
}

export function resolveStaticPath(root, requestUrl) {
  const { pathname } = new URL(requestUrl, 'http://127.0.0.1');
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const resolved = path.resolve(root, relativePath);

  if (!resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }

  return resolved;
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function handleGenerateRequest(request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST' }).end();
    return;
  }

  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    sendJson(response, 415, { success: false, error: 'Content-Type must be application/json.' });
    return;
  }

  const bodyChunks = [];
  let bodyBytes = 0;
  for await (const chunk of request) {
    bodyBytes += chunk.length;
    if (bodyBytes > MAX_GENERATE_BODY_BYTES) {
      request.resume();
      sendJson(response, 413, { success: false, error: 'Request body exceeds the 1 MiB limit.' });
      return;
    }
    bodyChunks.push(chunk);
  }

  let body;
  try {
    body = JSON.parse(Buffer.concat(bodyChunks).toString('utf8'));
  } catch {
    sendJson(response, 400, { success: false, error: 'Request body must contain valid JSON.' });
    return;
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(response, 400, { success: false, error: 'Request body must be a JSON object.' });
    return;
  }

  if (
    body.context !== undefined
    && (!body.context || typeof body.context !== 'object' || Array.isArray(body.context))
  ) {
    sendJson(response, 400, { success: false, error: 'Context must be a JSON object.' });
    return;
  }

  const action = body.action || 'storyboard';
  if (!['storyboard', 'compile', 'rebuild'].includes(action)) {
    sendJson(response, 400, { success: false, error: 'Action must be "storyboard", "compile" or "rebuild".' });
    return;
  }
  if (action === 'storyboard' && (typeof body.prompt !== 'string' || !body.prompt.trim())) {
    sendJson(response, 400, { success: false, error: 'A valid text prompt is required.' });
    return;
  }
  if ((action === 'compile' || action === 'rebuild') && (!body.storyboard || typeof body.storyboard !== 'object' || Array.isArray(body.storyboard))) {
    sendJson(response, 400, { success: false, error: 'A valid approved storyboard is required.' });
    return;
  }
  if (action === 'compile') {
    const validation = validateStoryboard(body.storyboard);
    if (!validation.valid) {
      sendJson(response, 400, { success: false, error: `Storyboard validation failed: ${validation.errors.join(' ')}` });
      return;
    }
  }

  try {
    const result = await generateProductionAction({
      action,
      prompt: body.prompt,
      storyboard: body.storyboard,
      shotSpecs: body.shotSpecs,
      context: body.context ?? DEFAULT_SCENE_CONTEXT,
      apiKeys: getGeminiKeyPool(),
    });
    sendJson(response, 200, { success: true, ...result });
  } catch (error) {
    sendJson(response, 500, { success: false, error: error.message, telemetry: error.telemetry });
  }
}

async function readJsonRequest(request, response, sizeLimit) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    sendJson(response, 415, { success: false, error: 'Content-Type must be application/json.' });
    return null;
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > sizeLimit) {
      request.resume();
      sendJson(response, 413, { success: false, error: 'Request body exceeds the size limit.' });
      return null;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    sendJson(response, 400, { success: false, error: 'Request body must contain valid JSON.' });
    return null;
  }
}

let renderAvailability;
/** Whether this server can render video: FFmpeg and FFprobe must both run. Checked once. */
export function checkRenderAvailability(run = execFileAsync) {
  renderAvailability ??= Promise.all([
    run('ffmpeg', ['-version'], { timeout: 5000, windowsHide: true }),
    run('ffprobe', ['-version'], { timeout: 5000, windowsHide: true }),
  ]).then(
    () => ({ available: true, reason: null }),
    () => ({ available: false, reason: 'FFmpeg and FFprobe are not installed on this server, so it can’t render video. The Docker image (Render deployment) includes them.' }),
  );
  return renderAvailability;
}

const DEFAULT_RENDER_TIMEOUT_MS = 15 * 60 * 1000;

/** Explains why a child process failed in words a director can act on. */
export function describeProcessFailure(error, label, timeoutMs) {
  const tail = (text) => String(text || '').trim().split(/\r?\n/).slice(-6).join('\n');
  if (error?.killed && (error.signal === 'SIGTERM' || error.code === 'ETIMEDOUT')) {
    return `${label} took longer than ${Math.round(timeoutMs / 60000)} minutes and was stopped. Small servers render slowly; a larger instance or a shorter film will finish sooner (raise RENDER_TIMEOUT_MS to allow more time).`;
  }
  if (error?.signal === 'SIGKILL' || error?.code === 137) {
    return `${label} was killed by the server, most likely because it ran out of memory. Try again, or use an instance with more memory.`;
  }
  const detail = tail(error?.stderr) || tail(error?.stdout) || error?.message || 'unknown error';
  return `${label} failed: ${detail}`;
}

/** Runs one of the project's Node scripts directly (no npm wrapper process, so less memory). */
async function runNodeScript(script, args, cwd, { label, timeoutMs = DEFAULT_RENDER_TIMEOUT_MS } = {}) {
  try {
    return await execFileAsync(process.execPath, ['--expose-gc', script, ...args], {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(describeProcessFailure(error, label, timeoutMs));
  }
}

function renderTimeoutMs() {
  const value = Number(process.env.RENDER_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RENDER_TIMEOUT_MS;
}

async function handleRenderRequest(request, response, root) {
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST' }).end();
    return;
  }
  const body = await readJsonRequest(request, response, MAX_RENDER_BODY_BYTES);
  if (response.writableEnded) return;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(response, 400, { success: false, error: 'Request body must be a JSON object.' });
    return;
  }
  const timelineValidation = validateTimeline(body.timeline);
  if (!timelineValidation.valid) {
    sendJson(response, 400, { success: false, error: `Timeline validation failed: ${timelineValidation.errors.join(' ')}` });
    return;
  }
  if (!body.storyboard || typeof body.storyboard !== 'object' || !body.acceptance || typeof body.acceptance !== 'object') {
    sendJson(response, 400, { success: false, error: 'Storyboard and acceptance specification are required.' });
    return;
  }
  const storyboardValidation = validateStoryboard(body.storyboard);
  const acceptance = body.acceptance;
  if (
    !storyboardValidation.valid
    || body.storyboard.shots.length !== body.timeline.shots.length
    || acceptance.schemaVersion !== '1.0'
    || acceptance.technicalRequirements?.width !== body.timeline.width
    || acceptance.technicalRequirements?.height !== body.timeline.height
    || acceptance.technicalRequirements?.fps !== body.timeline.fps
    || !Number.isFinite(acceptance.technicalRequirements?.durationInSeconds)
    || Math.abs(acceptance.technicalRequirements.durationInSeconds - body.timeline.durationInSeconds) > 1 / body.timeline.fps
    || !Array.isArray(acceptance.mandatoryContent)
    || acceptance.mandatoryContent.length !== body.timeline.shots.length
    || !Array.isArray(acceptance.creativeCriteria)
    || acceptance.creativeCriteria.length === 0
    || !Array.isArray(acceptance.shotCriteria)
    || acceptance.shotCriteria.length !== body.timeline.shots.length
    || body.timeline.shots.some((shot, index) => (
      shot.shotId !== body.storyboard.shots[index].id
      || acceptance.shotCriteria[index]?.shotId !== shot.shotId
      || acceptance.mandatoryContent[index]?.shotId !== shot.shotId
      || acceptance.mandatoryContent[index]?.copy !== body.storyboard.shots[index].onScreenCopy
    ))
  ) {
    sendJson(response, 400, { success: false, error: 'Storyboard and acceptance criteria must match the validated timeline.' });
    return;
  }

  // The logo is checked before any work starts, so a bad file fails fast and clearly.
  try {
    if (request.fold?.config && (body.assets?.logo?.path || body.assets?.products?.some((product) => product?.path))) {
      body.assets = await loadStoredAssets(request.fold.config, request.fold.user, body.assets);
    }
    resolveBrandAssets(body.assets);
  } catch (error) {
    sendJson(response, 400, { success: false, error: error.message });
    return;
  }
  const projectRoot = path.resolve(root, '..');
  // Queued renders (the studio's way): answer at once with a job, render one film
  // at a time, and report progress. Without async, the request waits as before.
  if (body.async === true) {
    const job = enqueueRender({ body, fold: request.fold, projectRoot });
    sendJson(response, 202, { success: true, jobId: job.id, position: queuePosition(job), status: job.status });
    return;
  }
  const result = await performRender({ body, fold: request.fold, projectRoot });
  sendJson(response, result.status, result.payload);
}

/** Renders one film: the render script, QA validation, then storage when signed in. */
async function performRender({ body, fold, projectRoot, onProgress }) {
  const requestFile = path.join(os.tmpdir(), `fold-render-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`);
  try {
    await writeFile(requestFile, JSON.stringify({
      timeline: body.timeline,
      storyboard: body.storyboard,
      acceptance: body.acceptance,
      context: body.context,
      ...(body.assets ? { assets: body.assets } : {}),
      ...(typeof body.music === 'string' ? { music: body.music } : {}),
      ...(typeof body.grade === 'string' ? { grade: body.grade } : {}),
      ...(['hd', 'fhd', '2k'].includes(body.resolution) ? { resolution: body.resolution } : {}),
      ...(body.photoColor === 'original' ? { photoColor: 'original' } : {}),
    }));
    const renderResult = await runNodeScriptStreaming('scripts/render-production.mjs', ['--input', requestFile], projectRoot, {
      label: 'Rendering',
      // Bigger frames take longer: the timeout grows with the pixels drawn.
      timeoutMs: renderTimeoutMs() * ({ fhd: 2.3, '2k': 4 }[body.resolution] || 1),
      onProgress,
    });
    const reportLine = renderResult.stdout.split(/\r?\n/).find((line) => line.startsWith('RENDER_REPORT:'));
    if (!reportLine) throw new Error('Render command completed without reporting a QA artifact path.');
    const reportPath = path.resolve(reportLine.slice('RENDER_REPORT:'.length));
    const outputRoot = path.resolve(projectRoot, 'output');
    if (!reportPath.startsWith(`${outputRoot}${path.sep}`)) {
      throw new Error('Render command returned an output path outside the project output directory.');
    }
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    let qaCommandPassed = true;
    let qaError;
    onProgress?.({ stage: 'validating' });
    try {
      await runNodeScript('scripts/qa/validate-production.mjs', [reportPath], projectRoot, { label: 'QA validation', timeoutMs: 120_000 });
    } catch (error) {
      qaCommandPassed = false;
      qaError = error.message.slice(0, 1200);
    }
    // Signed in with Supabase: the film is kept in the user's films folder, not on this
    // server's disk (which a free Render instance wipes on every restart).
    let storageError;
    if (fold?.config && fold.user) {
      onProgress?.({ stage: 'saving' });
      try {
        const film = await storeFilm(fold.config, fold.user, {
          projectId: body.timeline.id,
          runId: path.basename(path.dirname(reportPath)),
          file: await readFile(path.join(path.dirname(reportPath), 'production.mp4')),
          durationSeconds: body.timeline.durationInSeconds,
        });
        report.artifacts = { ...report.artifacts, video: film.url, film: { bucket: FILM_BUCKET, path: film.path } };
      } catch (error) {
        storageError = `${error.message} The film is playable from this server until it restarts.`;
      }
    }
    return { status: 200, payload: { success: true, report, qaCommandPassed, qaError, ...(storageError ? { storageError } : {}) } };
  } catch (error) {
    return { status: 500, payload: { success: false, error: error.message } };
  } finally {
    await rm(requestFile, { force: true });
  }
}

// ------------------------------------------------------------------ render queue

const renderJobs = new Map();
const renderQueue = [];
let renderRunning = 0;
const RENDER_CONCURRENCY = Math.max(1, Number(process.env.RENDER_CONCURRENCY) || 1);
const JOB_TTL_MS = 30 * 60 * 1000;

function enqueueRender({ body, fold, projectRoot }) {
  const job = {
    id: randomUUID(),
    owner: fold?.user?.id || null,
    status: 'queued',
    createdAt: Date.now(),
    progress: { stage: 'queued' },
    body,
    fold,
    projectRoot,
  };
  renderJobs.set(job.id, job);
  renderQueue.push(job);
  pumpRenderQueue();
  return job;
}

/** 1 when the job is next or rendering, 2 when one job is ahead, and so on. */
function queuePosition(job) {
  if (job.status !== 'queued') return 0;
  return renderQueue.indexOf(job) + 1 + renderRunning;
}

function pumpRenderQueue() {
  while (renderRunning < RENDER_CONCURRENCY && renderQueue.length) {
    const job = renderQueue.shift();
    renderRunning += 1;
    job.status = 'rendering';
    job.startedAt = Date.now();
    job.progress = { stage: 'preparing' };
    performRender({ body: job.body, fold: job.fold, projectRoot: job.projectRoot, onProgress: (progress) => { job.progress = { ...job.progress, ...progress }; } })
      .then((result) => {
        job.status = result.status === 200 ? 'done' : 'failed';
        job.result = result.payload;
      })
      .catch((error) => {
        job.status = 'failed';
        job.result = { success: false, error: error.message };
      })
      .finally(() => {
        job.finishedAt = Date.now();
        delete job.body; // the timeline and photos aren't needed any more
        renderRunning -= 1;
        pumpRenderQueue();
      });
  }
  // Forget finished jobs after half an hour.
  for (const [id, job] of renderJobs) if (job.finishedAt && Date.now() - job.finishedAt > JOB_TTL_MS) renderJobs.delete(id);
}

async function handleRenderJobRequest(request, response, jobId) {
  const auth = await requireUser(request.headers);
  if (auth.error) {
    sendJson(response, auth.status || 401, { success: false, error: auth.error, signIn: true });
    return;
  }
  const job = renderJobs.get(jobId);
  if (!job || (auth.user && job.owner !== auth.user.id)) {
    sendJson(response, 404, { success: false, error: 'That render isn’t running on this server (it may have restarted). Render again.' });
    return;
  }
  const elapsed = ((job.finishedAt || Date.now()) - (job.startedAt || job.createdAt)) / 1000;
  sendJson(response, 200, {
    success: true,
    jobId: job.id,
    status: job.status,
    position: queuePosition(job),
    progress: job.progress,
    elapsedSeconds: Math.round(elapsed),
    ...(job.status === 'done' || job.status === 'failed' ? { result: job.result } : {}),
  });
}

/** Runs a script, streaming its FOLD_PROGRESS lines to onProgress. */
function runNodeScriptStreaming(script, args, cwd, { label, timeoutMs = DEFAULT_RENDER_TIMEOUT_MS, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', script, ...args], { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let pending = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      pending += text;
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.startsWith('FOLD_PROGRESS ')) {
          try { onProgress?.(JSON.parse(line.slice('FOLD_PROGRESS '.length))); } catch { /* a garbled line is skipped */ }
        }
      }
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-200_000); });
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(describeProcessFailure(error, label, timeoutMs))); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) resolve({ stdout, stderr });
      else reject(new Error(describeProcessFailure({ code, signal, killed: timedOut, stdout, stderr }, label, timeoutMs)));
    });
  });
}

async function handleStateRequest(request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST' }).end();
    return;
  }
  const body = await readJsonRequest(request, response, MAX_RENDER_BODY_BYTES);
  if (response.writableEnded) return;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(response, 400, { success: false, error: 'Request body must be a JSON object.' });
    return;
  }
  try {
    const project = transitionProject(body.project, body.nextState, body.evidence);
    sendJson(response, 200, { success: true, project });
  } catch (error) {
    sendJson(response, 400, { success: false, error: error.message });
  }
}

function resolveOutputPath(root, requestUrl) {
  const { pathname } = new URL(requestUrl, 'http://127.0.0.1');
  const relativePath = decodeURIComponent(pathname).replace(/^\/output\/+/, '');
  const outputRoot = path.resolve(root, '..', 'output');
  const resolved = path.resolve(outputRoot, relativePath);
  return resolved.startsWith(`${outputRoot}${path.sep}`) ? resolved : null;
}

export async function createStaticServer({ root, host = '127.0.0.1', port = 0 }) {
  const resolvedRoot = path.resolve(root);
  await access(resolvedRoot);

  const server = http.createServer(async (request, response) => {
    try {
      const { pathname } = new URL(request.url, 'http://127.0.0.1');
      // With Supabase configured, generating, planning and rendering need a signed-in user.
      if (['/api/storyboard', '/api/generate', '/api/render', '/api/state'].includes(pathname) && request.method === 'POST') {
        const auth = await requireUser(request.headers);
        if (auth.error) {
          sendJson(response, auth.status || 401, { success: false, error: auth.error, signIn: true });
          return;
        }
        request.fold = auth;
      }
      if (pathname === '/api/storyboard') {
        await handleStoryboardRequest(request, response);
        return;
      }
      if (pathname === '/api/generate') {
        await handleGenerateRequest(request, response);
        return;
      }
      if (pathname.startsWith('/api/render/jobs/') && request.method === 'GET') {
        await handleRenderJobRequest(request, response, decodeURIComponent(pathname.slice('/api/render/jobs/'.length)));
        return;
      }
      if (pathname === '/api/render') {
        await handleRenderRequest(request, response, resolvedRoot);
        return;
      }
      if (pathname === '/api/state') {
        await handleStateRequest(request, response);
        return;
      }
      if (pathname === '/api/engine') {
        if (request.method !== 'GET') {
          response.writeHead(405, { Allow: 'GET' }).end();
          return;
        }
        sendJson(response, 200, { success: true, engine: getEngineConfig(), render: await checkRenderAvailability(), auth: publicAuthConfig() });
        return;
      }
      if (pathname === '/health') {
        if (request.method !== 'GET') {
          response.writeHead(405, { Allow: 'GET' }).end();
          return;
        }
        sendJson(response, 200, { status: 'healthy', timestamp: new Date().toISOString() });
        return;
      }

      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }

      const isOutput = pathname.startsWith('/output/');
      const filePath = isOutput
        ? resolveOutputPath(resolvedRoot, request.url)
        : resolveStaticPath(resolvedRoot, request.url);
      if (!filePath) {
        response.writeHead(403).end();
        return;
      }

      try {
        await access(filePath);
      } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': isOutput && path.extname(filePath) === '.mp4'
          ? 'video/mp4'
          : isOutput && path.extname(filePath) === '.png'
            ? 'image/png'
            : contentTypeFor(filePath),
      });

      if (request.method === 'HEAD') {
        response.end();
      } else {
        createReadStream(filePath).pipe(response);
      }
    } catch (error) {
      console.error('[server-error]', error?.stack ?? error);
      if (response.headersSent) {
        response.destroy(error);
      } else {
        sendJson(response, 500, {
          success: false,
          error: error instanceof Error ? error.message : 'Internal Server Error',
        });
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  return {
    host,
    port: actualPort,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
