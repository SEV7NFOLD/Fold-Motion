'use strict';
/**
 * SEV7N FOLD — resilient AI cascade (Node >= 18, global fetch).
 *
 * Design:
 *  1. The rule engine runs FIRST and instantly. Its storyboard is the baseline.
 *  2. Gemini -> Groq -> OpenRouter are tried only to *enhance the copy* of that baseline.
 *  3. AI output is merged field-by-field into the baseline (timings/structure stay ours),
 *     so a malformed or partial AI answer can never produce an invalid storyboard.
 *  4. Any failure, timeout or exhausted budget => the baseline is returned. Never throws.
 *
 * Env (all optional):
 *   GEMINI_API_KEYS / GEMINI_API_KEY      comma-separated keys
 *   GEMINI_MODELS                         default: gemini-2.5-flash,gemini-2.5-flash-lite
 *   GROQ_API_KEYS / GROQ_API_KEY
 *   GROQ_MODELS                           default: openai/gpt-oss-120b,openai/gpt-oss-20b
 *   OPENROUTER_API_KEYS / OPENROUTER_API_KEY
 *   OPENROUTER_MODELS                     default: openrouter/free  (pin a specific :free model if you can)
 *   APP_URL                               sent as HTTP-Referer to OpenRouter
 *   AI_CASCADE_ENABLED=false              kill switch -> rules only
 *   AI_TOTAL_BUDGET_MS (20000) AI_PROVIDER_BUDGET_MS (8000) AI_CALL_TIMEOUT_MS (7000)
 *   AI_BREAKER_THRESHOLD (3)   AI_BREAKER_COOLDOWN_MS (300000)
 */

const { generateStoryboard, normalizeBrief } = require('./ruleEngine.cjs');

const env = (k, d = '') => process.env[k] ?? d;
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const num = (k, d) => {
  const n = Number(process.env[k]);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const CFG = {
  enabled: env('AI_CASCADE_ENABLED', 'true') !== 'false',
  totalBudgetMs: num('AI_TOTAL_BUDGET_MS', 20000),
  providerBudgetMs: num('AI_PROVIDER_BUDGET_MS', 8000),
  callTimeoutMs: num('AI_CALL_TIMEOUT_MS', 7000),
  breakerThreshold: num('AI_BREAKER_THRESHOLD', 3),
  breakerCooldownMs: num('AI_BREAKER_COOLDOWN_MS', 300000),
  configParkMs: 3600000, // a 404/400 is a config problem: don't retry for an hour
};

// ---------------------------------------------------------------- errors
class ProviderError extends Error {
  constructor(message, kind, status) {
    super(message);
    this.kind = kind; // config | auth | rate | overload | transient | bad_output
    this.status = status;
  }
}

function kindFromStatus(s) {
  if (s === 400 || s === 404 || s === 410 || s === 422) return 'config'; // dead model id / bad params
  if (s === 401 || s === 403) return 'auth';
  if (s === 408 || s === 429) return 'rate';
  if (s >= 500) return 'overload';
  return 'transient';
}

// ---------------------------------------------------------------- circuit breaker
const breaker = {
  state: new Map(),
  get(id) {
    let s = this.state.get(id);
    if (!s) this.state.set(id, (s = { fails: 0, openUntil: 0 }));
    return s;
  },
  isOpen(id) { return this.get(id).openUntil > Date.now(); },
  ok(id) { const s = this.get(id); s.fails = 0; s.openUntil = 0; },
  fail(id) {
    const s = this.get(id);
    if (++s.fails >= CFG.breakerThreshold) { s.openUntil = Date.now() + CFG.breakerCooldownMs; s.fails = 0; }
  },
  park(id, ms) { this.get(id).openUntil = Date.now() + ms; },
};

// ---------------------------------------------------------------- http
async function timedFetch(url, init, ms, parent) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('timeout')), ms);
  const onAbort = () => ctl.abort(parent.reason);
  if (parent) parent.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
    if (parent) parent.removeEventListener('abort', onAbort);
  }
}

async function postJson(url, headers, body, timeoutMs, signal) {
  let res;
  try {
    res = await timedFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }, timeoutMs, signal);
  } catch (e) {
    const timedOut = /timeout|abort|budget/i.test(String(e && e.message));
    throw new ProviderError(timedOut ? 'timeout' : `network error: ${e && e.message}`, 'transient');
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    // Body snippet is logged so a 400/404 tells you *why* (dead model id vs bad param).
    throw new ProviderError(`HTTP ${res.status}: ${text.slice(0, 160).replace(/\s+/g, ' ')}`, kindFromStatus(res.status), res.status);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError('unreadable response body', 'transient', res.status);
  }
}

function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) throw new ProviderError('empty model output', 'bad_output');
  const t = text.replace(/```(?:json)?/gi, '').trim();
  const a = t.indexOf('{');
  const z = t.lastIndexOf('}');
  if (a < 0 || z <= a) throw new ProviderError('no JSON object in output', 'bad_output');
  try {
    return JSON.parse(t.slice(a, z + 1));
  } catch {
    throw new ProviderError('invalid JSON in output', 'bad_output');
  }
}

// Only creative copy comes from the AI. Timings, indexes and structure stay from the baseline.
function mergeEnhancement(base, ai) {
  if (!ai || !Array.isArray(ai.scenes) || ai.scenes.length !== base.scenes.length) {
    throw new ProviderError('scene count mismatch', 'bad_output');
  }
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 400) : null);
  const out = structuredClone(base);
  for (const k of ['title', 'tone', 'music']) out[k] = str(ai[k]) ?? out[k];
  out.scenes.forEach((s, i) => {
    for (const k of ['shot', 'camera', 'motion', 'onScreenText', 'voiceover', 'transition']) {
      s[k] = str(ai.scenes[i] && ai.scenes[i][k]) ?? s[k];
    }
  });
  out.cta = out.scenes[out.scenes.length - 1].onScreenText;
  out.meta = { ...out.meta, source: 'ai' };
  return out;
}

// ---------------------------------------------------------------- prompt
const SYSTEM =
  'You are a senior motion-design creative director. You receive a creative brief and a baseline storyboard as JSON. ' +
  'Rewrite the creative copy so it is sharper and more specific to the brief. Keep exactly the same number of scenes ' +
  'and the same keys. Do not change numbers or timings. Reply with ONLY the JSON object, no commentary.';

function buildPrompt(brief, base) {
  const slim = {
    title: base.title, tone: base.tone, music: base.music,
    scenes: base.scenes.map(({ index, beat, duration, shot, camera, motion, onScreenText, voiceover, transition }) =>
      ({ index, beat, duration, shot, camera, motion, onScreenText, voiceover, transition })),
  };
  return `BRIEF:\n${brief}\n\nBASELINE STORYBOARD:\n${JSON.stringify(slim)}`;
}

// ---------------------------------------------------------------- providers
function chat(url, key, extraHeaders, extraBody, prompt, timeoutMs, signal) {
  return postJson(url, { Authorization: `Bearer ${key}`, ...extraHeaders }, {
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
    temperature: 0.7,
    ...extraBody,
  }, timeoutMs, signal).then((d) => d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content);
}

const PROVIDERS = [
  {
    name: 'gemini',
    keys: () => list(env('GEMINI_API_KEYS', env('GEMINI_API_KEY'))),
    models: () => list(env('GEMINI_MODELS', 'gemini-2.5-flash,gemini-2.5-flash-lite')),
    async call(model, key, prompt, timeoutMs, signal) {
      const d = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { 'x-goog-api-key': key }, // header, not ?key=, so keys never leak into logs
        {
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, responseMimeType: 'application/json', maxOutputTokens: 4096 },
        }, timeoutMs, signal);
      const parts = d && d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts;
      return Array.isArray(parts) ? parts.map((p) => p.text || '').join('') : '';
    },
  },
  {
    name: 'groq',
    keys: () => list(env('GROQ_API_KEYS', env('GROQ_API_KEY'))),
    models: () => list(env('GROQ_MODELS', 'openai/gpt-oss-120b,openai/gpt-oss-20b')),
    call(model, key, prompt, timeoutMs, signal) {
      const extra = { model, max_completion_tokens: 4096, response_format: { type: 'json_object' } };
      // gpt-oss are reasoning models: reasoning tokens count against the completion cap.
      if (model.startsWith('openai/gpt-oss')) extra.reasoning_effort = 'low';
      return chat('https://api.groq.com/openai/v1/chat/completions', key, {}, extra, prompt, timeoutMs, signal);
    },
  },
  {
    name: 'openrouter',
    keys: () => list(env('OPENROUTER_API_KEYS', env('OPENROUTER_API_KEY'))),
    models: () => list(env('OPENROUTER_MODELS', 'openrouter/free')),
    call(model, key, prompt, timeoutMs, signal) {
      const headers = { 'X-Title': 'SEV7N FOLD' };
      if (env('APP_URL')) headers['HTTP-Referer'] = env('APP_URL');
      return chat('https://openrouter.ai/api/v1/chat/completions', key, headers, { model, max_tokens: 3000 }, prompt, timeoutMs, signal);
    },
  },
];

// ---------------------------------------------------------------- orchestration
async function runProvider(p, prompt, base, ctx, attempts) {
  const keys = p.keys();
  const models = p.models();
  if (!keys.length || !models.length) {
    attempts.push({ provider: p.name, ok: false, kind: 'unconfigured' });
    return null;
  }
  const pDeadline = Math.min(ctx.deadline, Date.now() + CFG.providerBudgetMs);

  for (const model of models) {
    const id = `${p.name}:${model}`;
    if (breaker.isOpen(id)) {
      attempts.push({ provider: p.name, model, ok: false, kind: 'breaker_open' });
      continue;
    }
    for (let k = 0; k < keys.length; k++) {
      const left = pDeadline - Date.now();
      if (left < 1000 || ctx.signal.aborted) return null;
      const t0 = Date.now();
      try {
        const text = await p.call(model, keys[k], prompt, Math.min(CFG.callTimeoutMs, left), ctx.signal);
        const merged = mergeEnhancement(base, extractJson(text));
        breaker.ok(id);
        attempts.push({ provider: p.name, model, keyIndex: k, ok: true, ms: Date.now() - t0 });
        return merged;
      } catch (e) {
        const kind = (e && e.kind) || 'transient';
        attempts.push({
          provider: p.name, model, keyIndex: k, ok: false, kind, status: e && e.status,
          ms: Date.now() - t0, error: String(e && e.message).slice(0, 160),
        });
        if (kind === 'config') { breaker.park(id, CFG.configParkMs); break; } // dead model id: next model
        breaker.fail(id);
        if (kind === 'overload') break; // 503 is model-level; another key on the same project won't help
        // auth / rate / transient / bad_output: try next key, then next model
      }
    }
  }
  return null;
}

async function generateStoryboardResilient(brief, opts = {}) {
  const t0 = Date.now();
  const attempts = [];
  const baseline = generateStoryboard(brief, opts); // instant, never throws
  const finish = (storyboard, source) => {
    const totalMs = Date.now() - t0;
    console.log(`[storyboard] source=${source} ms=${totalMs} attempts=${JSON.stringify(attempts.map((a) => `${a.provider}${a.model ? '/' + a.model : ''}:${a.ok ? 'ok' : a.kind}${a.status ? '(' + a.status + ')' : ''}`))}`);
    return { storyboard, source, attempts, totalMs };
  };

  if (!CFG.enabled || opts.skipAI) return finish(baseline, 'rules');

  const ctl = new AbortController();
  const ctx = { deadline: t0 + CFG.totalBudgetMs, signal: ctl.signal };
  const hardStop = setTimeout(() => ctl.abort(new Error('budget')), CFG.totalBudgetMs);
  try {
    const prompt = buildPrompt(normalizeBrief(brief).slice(0, 4000), baseline);
    for (const p of PROVIDERS) {
      if (Date.now() >= ctx.deadline - 1500) break;
      let out = null;
      try {
        out = await runProvider(p, prompt, baseline, ctx, attempts);
      } catch (e) {
        attempts.push({ provider: p.name, ok: false, kind: 'unexpected', error: String(e && e.message).slice(0, 160) });
      }
      if (out) return finish(out, p.name);
    }
  } catch (e) {
    attempts.push({ provider: 'cascade', ok: false, kind: 'unexpected', error: String(e && e.message).slice(0, 160) });
  } finally {
    clearTimeout(hardStop);
  }
  return finish(baseline, 'rules');
}

module.exports = { generateStoryboardResilient, _internals: { breaker, mergeEnhancement, extractJson, CFG } };
