# FOLD Motion

Code-first motion production tools and a gated creative production Studio.

## Run locally

Requirements: Node.js 20+, FFmpeg, and FFprobe on `PATH`.

```powershell
npm ci
npm start
```

Open `http://127.0.0.1:4173/`. Entering a brief creates a structured storyboard
and acceptance specification. Approve the storyboard to compile the shot specs
and canonical `timeline.json`; then render the sequence and run technical and
creative QA. Final-cut approval and delivery are separate explicit gates.
Project state is saved in the browser's local storage.
Delivered productions are archived in the browser's local storage and appear in
the Recent projects sidebar with their titles and durations. Selecting an
archived project restores its brief, storyboard, timeline, and delivery data;
starting a new production leaves the archive intact.
The Studio accepts an optional exact headline and sub-headline plus primary
and accent colors; these values are carried into the timeline and rendered
frames. Generation and rendering show phase-based telemetry and timestamped
logs while work is in progress. A floating telemetry dock remains visible
across workspace tabs, can be minimized, and preserves its full log, progress,
pipeline state, and collapsed/expanded preference across page reloads.

## Storyboard API

`POST /api/storyboard` accepts a JSON body with a required `brief` and optional
`brand`, `duration` (6–120 seconds), `aspectRatio` (`16:9`, `9:16`, `4:5`, or
`1:1`), `niche`, and `skipAI` boolean. It returns the deterministic rule-engine
baseline enhanced with AI copy when available, plus the selected `source`,
elapsed `totalMs`, provider `attempts`, and final `storyboard`. Use
`GET /health` for the service health status.

## Production loop

The orchestrator enforces:

`BRIEF → PLANNING → STORYBOARD_REVIEW → BUILDING → RENDERING → QA → APPROVED → DELIVERED`

The transition API rejects skipped or unsupported transitions. Storyboard
approval is required before compilation, render evidence is required before QA,
both QA groups must pass before final approval, and a video plus source bundle
must exist before delivery.

`npm run render -- --input <render-request.json>` synthesizes deterministic
frames from a validated timeline and encodes an MP4. It writes the editable
storyboard, acceptance criteria, timeline, frame manifest, and QA report under
`output/`. `npm run qa:validate -- <production-qa.json>` verifies that both
production and creative QA passed.

Production QA measures video dimensions, FPS, duration, encoded frame count,
and frame hashes. Creative QA checks WCAG text/background contrast, source
text size, compile-enforced copy preservation, and use of the specified brand
colors. These measurable checks do not replace a human's visual review. The local renderer applies deterministic text entrances
and accent-line reveals; camera and transition descriptions remain part of the
approved storyboard for future renderer capabilities.

## Deploy to Render

The repository includes a Docker image with Node.js 20 and FFmpeg, plus a
Render Blueprint (`render.yaml`) for a Free web service in Ohio. In Render,
create a new Blueprint Instance from this repository and apply the
`fold-motion-studio` service. The service binds to Render's `PORT` and serves
the Studio and its generation, state, and rendering APIs.

The Free service has ephemeral storage: rendered videos and QA evidence under
`/app/output` can be lost when the service sleeps, restarts, or is redeployed.
Download important outputs promptly or move to a paid plan with a persistent
disk for durable render storage. Add `GEMINI_API_KEY` when prompted during
Blueprint setup to enable Gemini-backed storyboard and shot-spec generation.
See **AI providers** below for the full list of settings.

## Deploy to Vercel

Deploy from the repository root. `vercel.json` publishes `public/`; the `api/`
directory provides generation, state-transition, and render endpoints. Use the
repository root as the Root Directory and the **Other** framework preset.

Set `GEMINI_API_KEY` in Vercel project settings; the key stays server-side.
The Vercel render endpoint returns an explicit unsupported response; use the
Render deployment for cloud rendering, QA, and delivery exports.

## AI providers

| Variable | Default | What it does |
| --- | --- | --- |
| `GEMINI_API_KEY`, `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, `GEMINI_API_KEYS` | none | Gemini keys, tried in order. |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Gemini model ID. Flash-Lite has a much larger free-tier daily quota than Flash. Set `gemini-3.8-flash` on a paid tier. |
| `GEMINI_THINKING_LEVEL` | unset | Optional `thinkingConfig.thinkingLevel` (for example `low`). Leave unset to use the model's default. |
| `GEMINI_TIMEOUT_MS` | `30000` | Per-key request timeout. |
| `GEMINI_ROTATE_ON_QUOTA` | `false` | Keys in one Google Cloud project share a quota, so a 429 stops key rotation. Set `true` only if your keys come from separate projects. |
| `GROQ_API_KEY` | none | Fallback after Gemini (`llama-3.3-70b-versatile`, then `llama-3.1-8b-instant`). |
| `OPENROUTER_API_KEY` | none | Fallback after Groq (`openrouter/free`). |

**How the cascade decides.** Each failure is classified. A bad key, a timeout or
a provider outage rotates to the next Gemini key. A quota error (429), an unknown
model, or an answer that can't be used skips the remaining Gemini keys, because
every key would fail the same way, and moves straight to Groq, then OpenRouter.
The deterministic mock runs only when every configured provider has failed, and
the response's `warning` and `fallbackReason` say why.

**Model output is repaired, not rejected.** Before validation, `src/production/repair.mjs`
enforces what must be exact: format, timing, the full-canvas background in the
primary color, the approved on-screen copy, and an accent element. It also fixes
common model slips (`"center"` anchors, short hex colors, off-canvas shapes,
unsupported element types). Every change is listed in the response's `repairs`
array and shown in the Studio.

`GET /api/engine` returns the configured providers (never the keys) for the
Studio's System view.

## Verify

```powershell
npm test
```