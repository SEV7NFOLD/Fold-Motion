import { SHOT_COMPILER, STORYBOARD_DIRECTOR } from './prompts/index.mjs';
import { MOTION_OPTIONS } from '../production/motion.mjs';
import { RECIPE_OPTIONS, TEXT_CASE_OPTIONS, TRANSITION_OPTIONS } from '../production/recipes.mjs';

/**
 * Base AI Provider interface for FOLD Motion.
 * All concrete providers (OpenAI, Anthropic, Gemini, Mock) must implement this.
 */
export function extractAndParseJSON(rawContent) {
  if (rawContent !== null && typeof rawContent === 'object') return rawContent;
  if (typeof rawContent !== 'string') {
    throw new Error('Provider response content is not a valid string or object.');
  }

  const cleaned = rawContent.replace(/```[a-z0-9_-]*\s*/gi, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed !== null && typeof parsed === 'object') return parsed;
  } catch {
    // Provider output may contain explanatory text around the JSON payload.
  }

  let lastParseError;
  for (let start = 0; start < cleaned.length; start += 1) {
    const opening = cleaned[start];
    if (opening !== '{' && opening !== '[') continue;

    const stack = [opening];
    let inString = false;
    let escaped = false;
    for (let cursor = start + 1; cursor < cleaned.length; cursor += 1) {
      const character = cleaned[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === '{' || character === '[') {
        stack.push(character);
      } else if (character === '}' || character === ']') {
        const expectedOpening = character === '}' ? '{' : '[';
        if (stack.pop() !== expectedOpening) break;
        if (stack.length === 0) {
          try {
            const parsed = JSON.parse(cleaned.slice(start, cursor + 1));
            if (parsed !== null && typeof parsed === 'object') return parsed;
          } catch (error) {
            lastParseError = error;
          }
          break;
        }
      }
    }
  }

  const detail = lastParseError ? ` ${lastParseError.message}` : '';
  throw new Error(`Invalid JSON output from provider.${detail}`);
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

const GEMINI_DISPLAY_NAMES = Object.freeze({
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
  'gemini-3.6-flash': 'Gemini 3.6 Flash',
  'gemini-3.7-flash': 'Gemini 3.7 Flash',
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
});

export function geminiDisplayName(model) {
  return GEMINI_DISPLAY_NAMES[model] || `Gemini (${model})`;
}

/**
 * Error raised by AI providers. `kind` tells the cascade what to do next:
 *   quota    HTTP 429: the project's quota is spent; other keys in the same project won't help.
 *   auth     bad or revoked key: another key may work.
 *   config   unknown model or bad parameters: every key will fail the same way.
 *   timeout  the request took too long.
 *   network  the request never reached the provider.
 *   overload provider-side 5xx.
 *   output   the provider answered, but the content can't be used.
 *   provider anything else.
 */
export class ProviderError extends Error {
  constructor(message, { kind = 'provider', status, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ProviderError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}

export function classifyHttpFailure(status, detail = '') {
  const text = String(detail || '');
  if (status === 429) return 'quota';
  if (status === 401 || status === 403) return 'auth';
  if (status === 400 && /api[\s_-]?key|credential|unauthenticated|permission/i.test(text)) return 'auth';
  if ((status === 400 || status === 404)
    && /model.{0,40}(not found|unavailable|decommission|does not exist|unsupported)|(not found|unavailable|decommission|does not exist|unsupported).{0,40}model/i.test(text)) {
    return 'config';
  }
  if (status === 404) return 'config';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'overload';
  return 'provider';
}

function classifyFetchFailure(error) {
  const name = error?.name || '';
  const message = String(error?.message || '');
  return name === 'TimeoutError' || name === 'AbortError' || /abort|timed? ?out/i.test(message)
    ? 'timeout'
    : 'network';
}

/**
 * Rules the compiled scene specifications must follow. They mirror the checks in
 * buildTimeline(), so the model is told exactly what will be accepted.
 */
function sceneRules(context = {}) {
  const width = Number.isFinite(context.width) ? context.width : 1280;
  const height = Number.isFinite(context.height) ? context.height : 720;
  return [
    'Rules for every shot direction:',
    '- Return one object per storyboard shot, in the same order and with the same count.',
    `- "recipe": one of ${RECIPE_OPTIONS.join(' | ')}.`,
    `- "transitionOut": one of ${TRANSITION_OPTIONS.join(' | ')}. The last shot's transition is ignored.`,
    `- "motion": { "camera": ${MOTION_OPTIONS.camera.join(' | ')}, "atmosphere": ${MOTION_OPTIONS.atmosphere.join(' | ')} }.`,
    '- "kicker" (optional): at most 32 characters, one specific fact from the brief that the line doesn\'t say (a name, a date, a place, a category or a call to action). Never a generic label, never a repeat of the line. Leave it empty rather than pad.',
    "- \"emphasis\" (optional): one to three words copied exactly from the shot's onScreenCopy.",
    '- "textCase": "upper" or "as-written". Keep "as-written" when the copy has deliberate casing, such as brand or product names.',
    '- "beam" and "sweep" are true or false.',
    context.products?.length
      ? `- ${context.products.length} product photo${context.products.length === 1 ? ' is' : 's are'} uploaded. Show the product at least once with "product-hero" or "type-window" (one or two short words), and set "product" to 1${context.products.length > 1 ? `-${context.products.length}` : ''}.`
      : '- No product photos are uploaded: don\'t use "product-hero" or "type-window".',
    context.logo ? '- A logo is uploaded: the end card carries it, and "logo-reveal" can open or close the film.' : '- No logo is uploaded: don\'t use "logo-reveal".',
    `- Do not output elements, coordinates or sizes: the engine lays out the copy itself on a ${width} × ${height} canvas.`,
  ].join('\n');
}

export class BaseAIProvider {
  constructor(options = {}) {
    this.name = options.name || 'base-provider';
    this.apiKey = options.apiKey || null;
  }

  /**
   * Generates a scene specification object from a text prompt.
   * @param {string} prompt Motion design prompt or creative brief
   * @param {Object} context Additional brand parameters, colors, or target duration
   * @returns {Promise<Object>} Formatted scene specification JSON
   */
  async generateSceneSpec(prompt, context = {}) {
    throw new Error('generateSceneSpec() must be implemented by concrete AI provider subclass.');
  }
}

/**
 * Mock AI Provider for deterministic offline testing and local development.
 */
export class MockAIProvider extends BaseAIProvider {
  constructor(options = {}) {
    super({ name: 'mock-provider', ...options });
  }

  async generateSceneSpec(prompt, context = {}) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt string is required.');
    }

    const title = context.title || 'Generated Scene';
    const width = context.width || 1280;
    const height = context.height || 720;
    const fps = context.fps || 24;
    const durationInSeconds = context.durationInSeconds || 4;

    return {
      id: `scene-${Date.now()}`,
      title,
      width,
      height,
      fps,
      durationInSeconds,
      promptSource: prompt,
      elements: [
        {
          id: 'bg-rect',
          type: 'rect',
          x: 0,
          y: 0,
          width,
          height,
          fill: context.primaryColor || '#0B0F19',
        },
        {
          id: 'title-text',
          type: 'text',
          content: prompt.slice(0, 30),
          x: width / 2,
          y: height / 2,
          fill: context.accentColor || '#00F0FF',
          fontSize: 48,
          anchor: 'middle',
        },
      ],
    };
  }
}

export function getGeminiKeyPool(environment = process.env) {
  const keys = [
    environment.GEMINI_API_KEY,
    environment.GEMINI_API_KEY_2,
    environment.GEMINI_API_KEY_3,
    ...(typeof environment.GEMINI_API_KEYS === 'string' ? environment.GEMINI_API_KEYS.split(',') : []),
  ]
    .filter((key) => typeof key === 'string')
    .map((key) => key.trim())
    .filter(Boolean);
  return [...new Set(keys)];
}

const OPENAI_COMPATIBLE_SYSTEM_PROMPT = [
  'You are an automated motion design API.',
  'Return only valid raw JSON matching the requested schema. Use only schema-defined keys.',
  'Every headline must contain 3 to 25 characters, inclusive.',
  'Every subheadline must contain 5 to 40 characters, inclusive.',
  'Include 4 to 8 shots in every storyboard (3 for films under 6 seconds).',
  'Do not include markdown, conversational preambles, safety tags, or text outside the JSON value.',
  'Preserve explicit user-provided copy and constraints exactly.',
].join('\n');

export class OpenAICompatibleAIProvider extends BaseAIProvider {
  constructor({
    name,
    endpoint,
    apiKey,
    model,
    fallbackModels = [],
    fetchImpl = globalThis.fetch,
    headers = {},
  } = {}) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error(`${name || 'AI'} API key is required.`);
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('A fetch implementation is required for the AI provider.');
    }

    super({ name, apiKey });
    this.endpoint = endpoint;
    this.model = model;
    this.fallbackModels = [...new Set(fallbackModels.filter(
      (fallbackModel) => typeof fallbackModel === 'string' && fallbackModel.trim() && fallbackModel !== model,
    ).map((fallbackModel) => fallbackModel.trim()))];
    this.fetchImpl = fetchImpl;
    this.headers = headers;
  }

  async generateStoryboard(prompt, context = {}) {
    return this.generateStructuredJson([
      'Create a concise FOLD Motion creative storyboard and acceptance criteria as JSON.',
      STORYBOARD_DIRECTOR,
      'Return an object with id, title, audience, platform, narrativeConcept, creativeDirection, shots, hardConstraints, and acceptanceCriteria.',
      'Include at least two purposeful shots. Every shot must include id, purpose, positive durationSeconds, onScreenCopy, mainVisual, composition, cameraBehavior, motionBehavior, transitionIn, transitionOut, and acceptanceCriteria.',
      'Include acceptanceCriteria.technical and acceptanceCriteria.creative arrays. Preserve exact supplied headlines, subheadlines, hard constraints, and brand colors.',
      `Creative brief:\n${prompt}`,
      `Production context:\n${JSON.stringify(context)}`,
    ].join('\n\n'));
  }

  async compileStoryboard(storyboard, context = {}) {
    const result = await this.generateStructuredJson([
      'Direct the approved FOLD Motion storyboard: one shot direction per storyboard shot.',
      'Return a JSON object with a "shotSpecs" array containing one direction per storyboard shot, in the same order. Each direction has id, title, recipe, textCase, kicker, emphasis, motion, transitionOut, product, beam and sweep.',
      SHOT_COMPILER,
      sceneRules(context),
      `Approved storyboard:\n${JSON.stringify(storyboard)}`,
      `Production context:\n${JSON.stringify(context)}`,
    ].join('\n\n'));
    const shotSpecs = Array.isArray(result) ? result : result?.shotSpecs;
    if (!Array.isArray(shotSpecs)) {
      throw new ProviderError(`${this.name} returned shot specifications in an invalid format.`, { kind: 'output' });
    }
    return shotSpecs;
  }

  async generateStructuredJson(instruction) {
    const timeoutMs = this.endpoint.includes('openrouter.ai') ? 35_000 : 20_000;
    const models = [this.model, ...this.fallbackModels];

    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      const requestBody = {
        model,
        messages: [
          { role: 'system', content: OPENAI_COMPATIBLE_SYSTEM_PROMPT },
          { role: 'user', content: instruction },
        ],
        response_format: { type: 'json_object' },
      };

      let response;
      try {
        response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            ...this.headers,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new ProviderError(`${this.name} request failed: ${error.message}`, { kind: classifyFetchFailure(error), cause: error });
      }

      if (!response.ok) {
        let detail = await this.readErrorDetail(response);
        if (response.status === 400 && /response[_\s-]?format|json[_\s-]?object/i.test(detail)) {
          const retryBody = { ...requestBody };
          delete retryBody.response_format;
          try {
            response = await this.fetchImpl(this.endpoint, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                ...this.headers,
              },
              body: JSON.stringify(retryBody),
              signal: AbortSignal.timeout(timeoutMs),
            });
          } catch (error) {
            throw new ProviderError(`${this.name} retry without JSON mode failed: ${error.message}`, { kind: classifyFetchFailure(error), cause: error });
          }
          if (!response.ok) detail = await this.readErrorDetail(response);
        }

        if (!response.ok) {
          if (index < models.length - 1 && this.isModelUnavailable(response.status, detail)) {
            continue;
          }
          const suffix = detail ? `: ${detail}` : '. Check provider availability and server configuration.';
          throw new ProviderError(`${this.name} API returned HTTP ${response.status}${suffix}`, {
            kind: classifyHttpFailure(response.status, detail),
            status: response.status,
          });
        }
      }

      let data;
      try {
        data = await response.json();
      } catch (error) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
          || /abort|timed? ?out/i.test(String(error?.message || ''));
        throw new ProviderError(`${this.name} returned an unreadable API response: ${error.message}`, {
          kind: timedOut ? 'timeout' : 'output',
          cause: error,
        });
      }
      const rawContent = data.choices?.[0]?.message?.content;
      if (rawContent === undefined || rawContent === null || rawContent === '') {
        throw new ProviderError(`${this.name} returned no structured production content.`, { kind: 'output' });
      }
      try {
        return extractAndParseJSON(rawContent);
      } catch (error) {
        throw new ProviderError(`${this.name} returned invalid production JSON: ${error.message}`, { kind: 'output' });
      }
    }

    throw new ProviderError(`${this.name} has no available configured models.`, { kind: 'config' });
  }

  async readErrorDetail(response) {
    let body = '';
    try {
      const errorBody = await response.json();
      body = typeof errorBody === 'string' ? errorBody : JSON.stringify(errorBody);
    } catch {
      try {
        body = await response.text();
      } catch {
        body = '';
      }
    }
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      detail = parsed.error?.message || body;
    } catch {
      // Non-JSON provider errors are surfaced as plain text.
    }
    return detail.trim().slice(0, 500);
  }

  isModelUnavailable(status, detail) {
    return (status === 400 || status === 404)
      && /model.{0,40}(not found|unavailable|decommission|does not exist|unsupported)|(?:not found|unavailable|decommission|does not exist|unsupported).{0,40}model/i.test(detail);
  }
}

export class GeminiAIProvider extends BaseAIProvider {
  constructor({
    apiKey,
    model = DEFAULT_GEMINI_MODEL,
    thinkingLevel,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('A Gemini API key is required.');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('A fetch implementation is required for the Gemini provider.');
    }

    super({ name: geminiDisplayName(model), apiKey });
    this.model = model;
    this.thinkingLevel = typeof thinkingLevel === 'string' && thinkingLevel.trim() ? thinkingLevel.trim() : undefined;
    this.fetchImpl = fetchImpl;
  }

  async generateStoryboard(prompt, context = {}) {
    const shotSchema = {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING' },
        purpose: { type: 'STRING' },
        durationSeconds: { type: 'NUMBER' },
        onScreenCopy: { type: 'STRING' },
        mainVisual: { type: 'STRING' },
        composition: { type: 'STRING' },
        cameraBehavior: { type: 'STRING' },
        motionBehavior: { type: 'STRING' },
        transitionIn: { type: 'STRING' },
        transitionOut: { type: 'STRING' },
        soundCue: { type: 'STRING' },
        acceptanceCriteria: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: [
        'id', 'purpose', 'durationSeconds', 'onScreenCopy', 'mainVisual', 'composition',
        'cameraBehavior', 'motionBehavior', 'transitionIn', 'transitionOut', 'acceptanceCriteria',
      ],
    };
    const responseSchema = {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING' },
        title: { type: 'STRING' },
        audience: { type: 'STRING' },
        platform: { type: 'STRING' },
        narrativeConcept: { type: 'STRING' },
        creativeDirection: { type: 'STRING' },
        shots: { type: 'ARRAY', items: shotSchema },
        hardConstraints: { type: 'ARRAY', items: { type: 'STRING' } },
        acceptanceCriteria: {
          type: 'OBJECT',
          properties: {
            technical: { type: 'ARRAY', items: { type: 'STRING' } },
            creative: { type: 'ARRAY', items: { type: 'STRING' } },
          },
          required: ['technical', 'creative'],
        },
      },
      required: [
        'id', 'title', 'audience', 'platform', 'narrativeConcept', 'creativeDirection',
        'shots', 'hardConstraints', 'acceptanceCriteria',
      ],
    };
    return this.generateStructuredJson(
      [
        'Create a concise FOLD Motion creative storyboard and acceptance criteria as JSON. Return only a raw JSON value with no markdown, conversational preamble, or explanatory text.',
        STORYBOARD_DIRECTOR,
        'Include 4 to 8 purposeful shots (3 for films under 6 seconds). Keep every shot duration positive and include copy, camera/motion behavior, transitions, and shot acceptance criteria.',
        'When the production context contains a headline or subheadline, preserve that text exactly in the storyboard copy. Do not replace supplied copy with generic phrases.',
        'Use the supplied primary and accent colors throughout the visual direction and acceptance criteria.',
        `Creative brief:\n${prompt}`,
        `Production context:\n${JSON.stringify(context)}`,
      ].join('\n\n'),
      responseSchema,
    );
  }

  async compileStoryboard(storyboard, context = {}) {
    const sceneSchema = {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING' },
        title: { type: 'STRING' },
        recipe: { type: 'STRING', enum: [...RECIPE_OPTIONS] },
        textCase: { type: 'STRING', enum: [...TEXT_CASE_OPTIONS] },
        kicker: { type: 'STRING' },
        emphasis: { type: 'STRING' },
        motion: {
          type: 'OBJECT',
          properties: {
            camera: { type: 'STRING', enum: [...MOTION_OPTIONS.camera] },
            entrance: { type: 'STRING', enum: [...MOTION_OPTIONS.entrance] },
            atmosphere: { type: 'STRING', enum: [...MOTION_OPTIONS.atmosphere] },
          },
          required: ['camera', 'atmosphere'],
        },
        transitionOut: { type: 'STRING', enum: [...TRANSITION_OPTIONS] },
        product: { type: 'INTEGER' },
        beam: { type: 'BOOLEAN' },
        sweep: { type: 'BOOLEAN' },
      },
      required: ['id', 'recipe', 'motion', 'transitionOut'],
    };
    const shotSpecs = await this.generateStructuredJson(
      [
        'Direct the approved storyboard: return one FOLD Motion shot direction for each storyboard shot. Return only a raw JSON value with no markdown, conversational preamble, or explanatory text.',
        'Return a JSON array in the same order and with the same item count as the storyboard shots.',
        SHOT_COMPILER,
        sceneRules(context),
        `Approved storyboard:\n${JSON.stringify(storyboard)}`,
        `Production context:\n${JSON.stringify(context)}`,
      ].join('\n\n'),
      { type: 'ARRAY', items: sceneSchema },
    );
    if (!Array.isArray(shotSpecs)) {
      throw new ProviderError('Gemini returned shot specifications in an invalid format.', { kind: 'output' });
    }
    return shotSpecs;
  }

  async generateStructuredJson(instruction, responseSchema) {
    return this.requestJson({
      instruction,
      responseSchema,
      systemText: 'Return only valid raw JSON matching the provided response schema. Do not include markdown fences, conversational text, safety preambles, or content outside the JSON value.',
      emptyMessage: 'Gemini returned no structured production content.',
      invalidPrefix: 'Gemini returned invalid production JSON',
    });
  }

  async generateSceneSpec(prompt, context = {}) {
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('Prompt string is required.');
    }

    const responseSchema = {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING' },
        title: { type: 'STRING' },
        width: { type: 'NUMBER' },
        height: { type: 'NUMBER' },
        fps: { type: 'NUMBER' },
        durationInSeconds: { type: 'NUMBER' },
        promptSource: { type: 'STRING' },
        elements: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING' },
              type: { type: 'STRING' },
              x: { type: 'NUMBER' },
              y: { type: 'NUMBER' },
              width: { type: 'NUMBER' },
              height: { type: 'NUMBER' },
              fill: { type: 'STRING' },
              content: { type: 'STRING' },
              fontSize: { type: 'NUMBER' },
              anchor: { type: 'STRING' },
            },
            required: ['id', 'type'],
          },
        },
      },
      required: ['id', 'title', 'width', 'height', 'fps', 'durationInSeconds', 'elements'],
    };

    return this.requestJson({
      instruction: [
        'Generate one FOLD Motion scene specification as JSON. Return only a raw JSON value with no markdown, conversational preamble, or explanatory text. The scene must match the supplied context for dimensions, frame rate, duration, and colors. Create a concise title, a stable kebab-case scene id, and an elements array containing objects with string id and type fields.',
        `Motion brief:\n${prompt}`,
        `Scene context:\n${JSON.stringify(context)}`,
      ].join('\n\n'),
      responseSchema,
      systemText: 'Return only valid raw JSON matching the provided scene specification schema. Do not include markdown fences, conversational text, safety preambles, or content outside the JSON value.',
      emptyMessage: 'Gemini returned no scene specification content.',
      invalidPrefix: 'Gemini returned invalid scene JSON',
    });
  }

  async requestJson({ instruction, responseSchema, systemText, emptyMessage, invalidPrefix }) {
    const send = async (withThinking) => {
      const generationConfig = { responseMimeType: 'application/json', responseSchema };
      if (withThinking) generationConfig.thinkingConfig = { thinkingLevel: this.thinkingLevel };
      try {
        return await this.fetchImpl(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': this.apiKey,
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemText }] },
              contents: [{ parts: [{ text: instruction }] }],
              generationConfig,
            }),
            signal: AbortSignal.timeout(30_000),
          },
        );
      } catch (error) {
        throw new ProviderError(`Gemini request failed: ${error.message}`, { kind: classifyFetchFailure(error), cause: error });
      }
    };
    const readDetail = async (failed) => {
      try {
        const errorBody = await failed.json();
        return errorBody?.error?.message || '';
      } catch {
        try {
          return (await failed.text()).trim().slice(0, 300);
        } catch {
          return '';
        }
      }
    };

    let response = await send(Boolean(this.thinkingLevel));
    let detail = '';
    if (!response.ok) {
      detail = await readDetail(response);
      // A model that doesn't accept the thinking setting still deserves an answer.
      if (response.status === 400 && this.thinkingLevel && /thinking/i.test(detail)) {
        response = await send(false);
        if (!response.ok) detail = await readDetail(response);
      }
    }

    if (!response.ok) {
      const suffix = detail ? `: ${detail}` : '. Check provider availability and server configuration.';
      throw new ProviderError(`Gemini API returned HTTP ${response.status}${suffix}`, {
        kind: classifyHttpFailure(response.status, detail),
        status: response.status,
      });
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new ProviderError(`Gemini returned an unreadable API response: ${error.message}`, { kind: 'output' });
    }

    const rawText = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!rawText) {
      const blockReason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
      const reason = blockReason && blockReason !== 'STOP' ? ` (finish reason: ${blockReason})` : '';
      throw new ProviderError(`${emptyMessage.replace(/\.$/, '')}${reason}.`, { kind: 'output' });
    }

    try {
      return extractAndParseJSON(rawText);
    } catch (error) {
      throw new ProviderError(`${invalidPrefix}: ${error.message}`, { kind: 'output' });
    }
  }
}
