import cascade from '../resilient/cascade.cjs';

const { generateStoryboardResilient } = cascade;

const MAX_BODY_BYTES = 1024 * 1024;
const SUPPORTED_ASPECT_RATIOS = new Set(['16:9', '9:16', '4:5', '1:1']);
function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request, response) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    sendJson(response, 415, { success: false, error: 'Content-Type must be application/json.' });
    return null;
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      request.resume();
      sendJson(response, 413, { success: false, error: 'Request body exceeds the 1 MiB limit.' });
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

function normalizeStoryboardOptions(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object.' };
  }
  if (typeof body.brief !== 'string' || !body.brief.trim()) {
    return { error: 'Invalid request: "brief" string is required.' };
  }
  if (body.brand !== undefined && typeof body.brand !== 'string') {
    return { error: '"brand" must be a string.' };
  }
  if (body.niche !== undefined && typeof body.niche !== 'string') {
    return { error: '"niche" must be a string.' };
  }
  if (body.aspectRatio !== undefined && !SUPPORTED_ASPECT_RATIOS.has(body.aspectRatio)) {
    return { error: '"aspectRatio" must be one of 16:9, 9:16, 4:5, or 1:1.' };
  }
  if (body.duration !== undefined && (
    !Number.isFinite(Number(body.duration)) || Number(body.duration) < 6 || Number(body.duration) > 120
  )) {
    return { error: '"duration" must be between 6 and 120 seconds.' };
  }
  if (body.skipAI !== undefined && typeof body.skipAI !== 'boolean') {
    return { error: '"skipAI" must be a boolean.' };
  }

  const aspectRatio = body.aspectRatio ?? '16:9';
  return {
    brief: body.brief.trim(),
    brand: body.brand?.trim() || undefined,
    niche: body.niche?.trim() || undefined,
    duration: body.duration === undefined ? 30 : Number(body.duration),
    aspectRatio,
    skipAI: body.skipAI === true,
  };
}

export async function handleStoryboardRequest(request, response, {
  generateResilient = generateStoryboardResilient,
  logger = console,
} = {}) {
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST' }).end();
    return;
  }

  const body = await readJsonBody(request, response);
  if (response.writableEnded) return;

  const options = normalizeStoryboardOptions(body);
  if (options.error) {
    sendJson(response, 400, { success: false, error: options.error });
    return;
  }

  try {
    const startedAt = Date.now();
    const result = await generateResilient(options.brief, {
      brand: options.brand,
      duration: options.duration,
      aspectRatio: options.aspectRatio,
      niche: options.niche,
      skipAI: options.skipAI,
    });
    sendJson(response, 200, {
      success: true,
      source: result.source,
      totalMs: result.totalMs ?? Date.now() - startedAt,
      attempts: result.attempts,
      storyboard: result.storyboard,
    });
  } catch (error) {
    logger.error?.('[api/storyboard] Storyboard generation failed.', { error: error.message });
    sendJson(response, 500, { success: false, error: error.message });
  }
}
