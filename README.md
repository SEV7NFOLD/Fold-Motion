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
Blueprint setup to enable Gemini-backed storyboard and shot-spec generation;
optionally add `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, or a comma-separated
`GEMINI_API_KEYS` value for sequential failover. `GROQ_API_KEY` and
`OPENROUTER_API_KEY` are optional provider fallbacks, tried in that order after
Gemini. The deterministic mock provider remains the final fallback.

## Deploy to Vercel

Deploy from the repository root. `vercel.json` publishes `public/`; the `api/`
directory provides generation, state-transition, and render endpoints. Use the
repository root as the Root Directory and the **Other** framework preset.

Set `GEMINI_API_KEY` in Vercel project settings to enable Gemini 3.8 Flash for
storyboard and shot-spec generation. The key remains server-side. Gemini
requests have a 30-second timeout. To configure failover, optionally add
`GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, or a comma-separated `GEMINI_API_KEYS`
list. Gemini keys are tried sequentially, followed by Groq (`GROQ_API_KEY`,
`openai/gpt-oss-120b`) and OpenRouter (`OPENROUTER_API_KEY`, `openrouter/free`)
when configured. Provider failures,
timeouts, and invalid structured output trigger the next provider; logs and
Studio telemetry report each attempt and rotation without exposing
credentials. Deterministic mock generation is used only after all configured
providers fail or when no provider credentials are configured. The Vercel
render endpoint returns an explicit unsupported response; use the Render
deployment for cloud rendering, QA, and delivery exports.

## Verify

```powershell
npm test
```