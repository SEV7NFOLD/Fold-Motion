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

/**
 * Generates scene specifications with Google's Gemini generateContent API.
 */
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
  'Include exactly 2 to 4 shots in every storyboard.',
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
      'Return an object with id, title, audience, platform, narrativeConcept, creativeDirection, shots, hardConstraints, and acceptanceCriteria.',
      'Include at least two purposeful shots. Every shot must include id, purpose, positive durationSeconds, onScreenCopy, mainVisual, composition, cameraBehavior, motionBehavior, transitionIn, transitionOut, and acceptanceCriteria.',
      'Include acceptanceCriteria.technical and acceptanceCriteria.creative arrays. Preserve exact supplied headlines, subheadlines, hard constraints, and brand colors.',
      `Creative brief:\n${prompt}`,
      `Production context:\n${JSON.stringify(context)}`,
    ].join('\n\n'));
  }

  async compileStoryboard(storyboard, context = {}) {
    const result = await this.generateStructuredJson([
      'Compile the approved FOLD Motion storyboard into deterministic scene specifications.',
      'Return a JSON object with a "shotSpecs" array containing one scene specification per storyboard shot, in the same order.',
      'Each scene must include id, title, width, height, fps, durationInSeconds, and elements. Each element must include id and type; include x, y, width, height, fill, content, fontSize, and anchor as appropriate.',
      'Preserve exact on-screen copy, include a full-canvas background and readable text elements, use the requested dimensions and FPS, and use both brand colors. Include supplied subheadline copy in every shot.',
      `Approved storyboard:\n${JSON.stringify(storyboard)}`,
      `Production context:\n${JSON.stringify(context)}`,
    ].join('\n\n'));
    const shotSpecs = Array.isArray(result) ? result : result?.shotSpecs;
    if (!Array.isArray(shotSpecs)) {
      throw new Error(`${this.name} returned shot specifications in an invalid format.`);
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
        throw new Error(`${this.name} request failed: ${error.message}`);
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
            throw new Error(`${this.name} retry without JSON mode failed: ${error.message}`);
          }
          if (!response.ok) detail = await this.readErrorDetail(response);
        }

        if (!response.ok) {
          if (index < models.length - 1 && this.isModelUnavailable(response.status, detail)) {
            continue;
          }
          const suffix = detail ? `: ${detail}` : '. Check provider availability and server configuration.';
          throw new Error(`${this.name} API returned HTTP ${response.status}${suffix}`);
        }
      }

      let data;
      try {
        data = await response.json();
      } catch (error) {
        throw new Error(`${this.name} returned an unreadable API response: ${error.message}`);
      }
      const rawContent = data.choices?.[0]?.message?.content;
      if (rawContent === undefined || rawContent === null || rawContent === '') {
        throw new Error(`${this.name} returned no structured production content.`);
      }
      try {
        return extractAndParseJSON(rawContent);
      } catch (error) {
        throw new Error(`${this.name} returned invalid production JSON: ${error.message}`);
      }
    }

    throw new Error(`${this.name} has no available configured models.`);
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
  constructor({ apiKey, model = 'gemini-3.8-flash', fetchImpl = globalThis.fetch } = {}) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('A Gemini API key is required.');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('A fetch implementation is required for the Gemini provider.');
    }

    super({
      name: model === 'gemini-3.8-flash' ? 'Gemini 3.8 Flash' : `Gemini (${model})`,
      apiKey,
    });
    this.model = model;
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
        'Include at least two purposeful shots. Keep every shot duration positive and include copy, camera/motion behavior, transitions, and shot acceptance criteria.',
        'When the production context contains a headline or subheadline, preserve that text exactly in the storyboard copy. Do not replace supplied copy with generic phrases.',
        'Use the supplied primary and accent colors throughout the visual direction and acceptance criteria.',
        `Creative brief:\n${prompt}`,
        `Production context:\n${JSON.stringify(context)}`,
      ].join('\n\n'),
      responseSchema,
    );
  }

  async compileStoryboard(storyboard, context = {}) {
    const elementSchema = {
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
    };
    const sceneSchema = {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING' },
        title: { type: 'STRING' },
        width: { type: 'NUMBER' },
        height: { type: 'NUMBER' },
        fps: { type: 'NUMBER' },
        durationInSeconds: { type: 'NUMBER' },
        promptSource: { type: 'STRING' },
        elements: { type: 'ARRAY', items: elementSchema },
      },
      required: ['id', 'title', 'width', 'height', 'fps', 'durationInSeconds', 'elements'],
    };
    const shotSpecs = await this.generateStructuredJson(
      [
        'Compile the approved storyboard into one deterministic FOLD Motion scene specification for each storyboard shot. Return only a raw JSON value with no markdown, conversational preamble, or explanatory text.',
        'Return a JSON array in the same order and with the same item count as the storyboard shots. Preserve exact on-screen copy, use the requested dimensions/FPS, include a full-canvas background and readable text elements, and use the brand primary/accent colors.',
        'Preserve any supplied subheadline as an additional readable text element in every shot.',
        `Approved storyboard:\n${JSON.stringify(storyboard)}`,
        `Production context:\n${JSON.stringify(context)}`,
      ].join('\n\n'),
      { type: 'ARRAY', items: sceneSchema },
    );
    if (!Array.isArray(shotSpecs)) {
      throw new Error('Gemini returned shot specifications in an invalid format.');
    }
    return shotSpecs;
  }

  async generateStructuredJson(instruction, responseSchema) {
    let response;
    try {
      response = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: instruction }] }],
            systemInstruction: {
              parts: [{
                text: 'Return only valid raw JSON matching the provided response schema. Do not include markdown fences, conversational text, safety preambles, or content outside the JSON value.',
              }],
            },
            generationConfig: { responseMimeType: 'application/json', responseSchema },
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch (error) {
      throw new Error(`Gemini request failed: ${error.message}`);
    }

    if (!response.ok) {
      let detail = '';
      try {
        const errorBody = await response.json();
        detail = errorBody.error?.message;
      } catch {
        try {
          detail = (await response.text()).trim().slice(0, 300);
        } catch {
          detail = '';
        }
      }
      const suffix = detail ? `: ${detail}` : '. Check provider availability and server configuration.';
      throw new Error(`Gemini API returned HTTP ${response.status}${suffix}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error(`Gemini returned an unreadable API response: ${error.message}`);
    }
    const rawText = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!rawText) throw new Error('Gemini returned no structured production content.');
    try {
      return extractAndParseJSON(rawText);
    } catch (error) {
      throw new Error(`Gemini returned invalid production JSON: ${error.message}`);
    }
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

    let response;
    try {
      response = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text: 'Return only valid raw JSON matching the provided scene specification schema. Do not include markdown fences, conversational text, safety preambles, or content outside the JSON value.',
              }],
            },
            contents: [{
              parts: [{
                text: [
                  'Generate one FOLD Motion scene specification as JSON. Return only a raw JSON value with no markdown, conversational preamble, or explanatory text. The scene must match the supplied context for dimensions, frame rate, duration, and colors. Create a concise title, a stable kebab-case scene id, and an elements array containing objects with string id and type fields.',
                  `Motion brief:\n${prompt}`,
                  `Scene context:\n${JSON.stringify(context)}`,
                ].join('\n\n'),
              }],
            }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch (error) {
      throw new Error(`Gemini request failed: ${error.message}`);
    }

    if (!response.ok) {
      let detail = '';
      try {
        const errorBody = await response.json();
        detail = errorBody.error?.message;
      } catch {
        try {
          detail = (await response.text()).trim().slice(0, 300);
        } catch {
          detail = '';
        }
      }
      const suffix = detail ? `: ${detail}` : '. Check provider availability and server configuration.';
      throw new Error(`Gemini API returned HTTP ${response.status}${suffix}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error(`Gemini returned an unreadable API response: ${error.message}`);
    }

    const rawText = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!rawText) {
      throw new Error('Gemini returned no scene specification content.');
    }

    try {
      return extractAndParseJSON(rawText);
    } catch (error) {
      throw new Error(`Gemini returned invalid scene JSON: ${error.message}`);
    }
  }
}
