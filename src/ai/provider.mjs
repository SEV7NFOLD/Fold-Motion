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
        'Create a concise FOLD Motion creative storyboard and acceptance criteria as JSON.',
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
        'Compile the approved storyboard into one deterministic FOLD Motion scene specification for each storyboard shot.',
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
      return JSON.parse(rawText);
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
