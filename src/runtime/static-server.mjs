import { execFile } from 'node:child_process';
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
  if (!['storyboard', 'compile'].includes(action)) {
    sendJson(response, 400, { success: false, error: 'Action must be "storyboard" or "compile".' });
    return;
  }
  if (action === 'storyboard' && (typeof body.prompt !== 'string' || !body.prompt.trim())) {
    sendJson(response, 400, { success: false, error: 'A valid text prompt is required.' });
    return;
  }
  if (action === 'compile' && (!body.storyboard || typeof body.storyboard !== 'object' || Array.isArray(body.storyboard))) {
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
  const requestFile = path.join(os.tmpdir(), `fold-render-${process.pid}-${Date.now()}.json`);
  try {
    await writeFile(requestFile, JSON.stringify({
      timeline: body.timeline,
      storyboard: body.storyboard,
      acceptance: body.acceptance,
      context: body.context,
      ...(body.assets ? { assets: body.assets } : {}),
      ...(typeof body.music === 'string' ? { music: body.music } : {}),
      ...(typeof body.grade === 'string' ? { grade: body.grade } : {}),
    }));
    const renderResult = await runNodeScript('scripts/render-production.mjs', ['--input', requestFile], projectRoot, {
      label: 'Rendering',
      timeoutMs: renderTimeoutMs(),
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
    try {
      await runNodeScript('scripts/qa/validate-production.mjs', [reportPath], projectRoot, { label: 'QA validation', timeoutMs: 120_000 });
    } catch (error) {
      qaCommandPassed = false;
      qaError = error.message.slice(0, 1200);
    }
    // Signed in with Supabase: the film is kept in the user's films folder, not on this
    // server's disk (which a free Render instance wipes on every restart).
    let storageError;
    if (request.fold?.config && request.fold.user) {
      try {
        const film = await storeFilm(request.fold.config, request.fold.user, {
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
    sendJson(response, 200, { success: true, report, qaCommandPassed, qaError, ...(storageError ? { storageError } : {}) });
  } catch (error) {
    sendJson(response, 500, { success: false, error: error.message });
  } finally {
    await rm(requestFile, { force: true });
  }
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
