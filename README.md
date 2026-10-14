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

## Deploy to Vercel

Deploy from the repository root. `vercel.json` publishes `public/`; the `api/`
directory provides generation, state-transition, and render endpoints. Use the
repository root as the Root Directory and the **Other** framework preset.

Set `GEMINI_API_KEY` in Vercel project settings to enable Gemini 3.8 Flash for
storyboard and shot-spec generation. The key remains server-side. Gemini
requests have a six-second timeout; provider failures or invalid structured
output are logged and use the deterministic mock provider. The generation API
returns a valid structured response either way.

Video rendering requires a local FFmpeg/FFprobe installation. The Vercel render
endpoint returns an explicit unsupported response rather than claiming a cloud
render occurred; use the local Studio server for frame synthesis, QA, and
delivery exports.

## Verify

```powershell
npm test
```