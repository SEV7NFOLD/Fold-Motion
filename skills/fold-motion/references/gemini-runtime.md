# Gemini: where the production thinking happens

Gemini writes every storyboard and every scene spec. Its instructions are the
most direct lever on creative quality, so most "make the output better" work
happens here.

## What Gemini receives

| Call | Instructions | Output contract |
| --- | --- | --- |
| Storyboard | `STORYBOARD_DIRECTOR` in `src/ai/prompts/storyboard-director.mjs`, plus the brief and context | `responseSchema` in `GeminiAIProvider.generateStoryboard` |
| Compile | `SHOT_COMPILER` in `src/ai/prompts/shot-compiler.mjs`, then `sceneRules(context)` in `provider.mjs`, plus the approved storyboard | `responseSchema` in `GeminiAIProvider.compileStoryboard` (element `type` and `anchor` are enums) |

Groq and OpenRouter get the same prompt text through
`OpenAICompatibleAIProvider`, with a short system prompt that also bounds copy
length and shot count.

Context always includes `width`, `height`, `fps`, `durationInSeconds`
(default 8), `primaryColor`, `accentColor`, `headline` and `subheadline`.

## Division of responsibility

- **Prompts** carry craft: story, pacing, copy length, layout, restraint. Edit
  them to change what Gemini *chooses*.
- **sceneRules and the schemas** state the hard contract. Keep them identical
  in meaning to what `buildTimeline` checks.
- **The repair layer** enforces exactness whatever the model does. Edit it
  only for deterministic guarantees (format, copy, colors, legibility).
- **Validators** (`validateStoryboard`, `buildTimeline`) decide acceptance.
  Don't loosen them to let weak output through; improve the prompt or repair
  instead.

## Improving storyboards or layouts

1. Find the failure in real output first: the storyboard JSON, the timeline,
   or rendered frames. Name the pattern (for example "copy over 40
   characters", "every shot has the same layout", "promises a dolly move").
2. Change the relevant prompt in `src/ai/prompts/`. Say what to do and why,
   in plain sentences; models follow reasons better than capital-letter
   commands.
3. Keep every instruction inside the engine's capabilities in
   [engine.md](engine.md). Never ask for anything the renderer can't draw.
4. Keep the exact-copy rule and the color rules.
5. Add or update a test with a mocked `fetchImpl` (pattern:
   `test/repair-and-cascade.test.mjs`) that proves the prompt reaches the
   request. Prompt *quality* can only be judged on live output, so say so
   rather than claiming an improvement you haven't observed.

Prompts are sent on every call. On the free tier the token budget is
generous, but keep each prompt focused: under about 600 words.

## The provider cascade

`src/runtime/creative-api.mjs` tries Gemini first: the primary model
(`GEMINI_MODEL`), then each backup model (`GEMINI_BACKUP_MODELS`, default
`gemini-3.6-flash`), on each key. Then Groq, then OpenRouter, then the
deterministic offline mock. Overload and quota are per model, so the cascade
switches models for those; keys only differ in whose account they belong to,
so it rotates keys only when a key is rejected.

| Kind | Cause | Next step |
| --- | --- | --- |
| `overload`, `network` | 503 "high demand", 5xx, unreachable | Retry the same model once after 1.5 s, then the backup model. Never another key. |
| `quota` | HTTP 429 | The backup model (quotas are per model). Other keys only if `GEMINI_ROTATE_ON_QUOTA=true`. |
| `config` | Unknown model or rejected request | The backup model; check `GEMINI_MODEL` |
| `auth` | Key rejected (401, 403, 400 "API key not valid") | Next Gemini key |
| `timeout` | No answer within `GEMINI_TIMEOUT_MS` | Stop Gemini (the time is already spent); next provider |
| `output` | Answer unusable even after repair | Stop Gemini; next provider |

The mock runs only when every configured provider failed. Its response says
so (`provider: "mock-provider"`, `warning`, `fallbackReason`), the studio
explains the reason, and storyboards get a "Try AI again" button. Never make
the mock look like AI output.

## Diagnosing "it fell back to mock"

1. Read the telemetry (studio System view, or the `telemetry` array in the
   response) for the `Gemini key failed` line and its kind.
2. `overload`: Google's servers for those models were busy (HTTP 503). A new
   key cannot help. Wait a minute and use "Try AI again", or add a backup
   model with spare capacity to `GEMINI_BACKUP_MODELS`.
3. `quota`: the free tier limits requests per day per model and per project.
   Adding keys from the same project does nothing. Use
   `GEMINI_MODEL=gemini-3.5-flash-lite` (far larger free daily quota than
   Flash), wait for the reset, or enable billing.
4. `output`: the model answered but repair couldn't save it. Inspect the
   error text, which names the failed check, then improve the prompt.
5. `config`: the model ID is wrong or unavailable; check it against Google's
   model list.
6. `unconfigured`: no keys are set on the server.

## Settings

| Variable | Default |
| --- | --- |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` |
| `GEMINI_BACKUP_MODELS` | `gemini-3.6-flash` (comma-separated; empty disables) |
| `GEMINI_OVERLOAD_RETRIES` | `1` retry per model on 503 or network errors (max 3) |
| `GEMINI_RETRY_DELAY_MS` | `1500`, multiplied by the retry number |
| `GEMINI_THINKING_LEVEL` | unset (model default); sent as `thinkingConfig.thinkingLevel` |
| `GEMINI_TIMEOUT_MS` | `45000` per request |
| `GEMINI_BACKUP_THINKING_LEVEL` | `low` for backup models; empty uses the model default. If a model rejects the setting, the request is retried without it. |
| `GEMINI_ROTATE_ON_QUOTA` | `false` |
| `GEMINI_API_KEY`, `_2`, `_3`, `GEMINI_API_KEYS` | none |
| `GROQ_API_KEY`, `OPENROUTER_API_KEY` | none |

Keys never appear in prompts, logs, telemetry or `GET /api/engine`.
