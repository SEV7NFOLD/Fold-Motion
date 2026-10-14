/**
 * Base AI Provider interface for FOLD Motion.
 * All concrete providers (OpenAI, Anthropic, Gemini, Mock) must implement this.
 */
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
          fill: context.primaryColor || '#0F172A',
        },
        {
          id: 'title-text',
          type: 'text',
          content: prompt.slice(0, 30),
          x: width / 2,
          y: height / 2,
          fill: context.accentColor || '#38BDF8',
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
            contents: [{
              parts: [{
                text: [
                  'Generate one FOLD Motion scene specification as JSON. The scene must match the supplied context for dimensions, frame rate, duration, and colors. Create a concise title, a stable kebab-case scene id, and an elements array containing objects with string id and type fields. Do not include markdown.',
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
      return JSON.parse(rawText);
    } catch (error) {
      throw new Error(`Gemini returned invalid scene JSON: ${error.message}`);
    }
  }
}
