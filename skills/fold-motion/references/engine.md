# The engine as it exists today

Plan and promise only what is in the "Today" column. The skill book in
`docs/FOLD-MOTION-SKILL-BOOK.md` describes the long-term architecture; where it
and this file disagree about current behavior, this file and the code win.

## Capabilities

| Area | Today | Not yet |
| --- | --- | --- |
| Elements | `rect`, `circle`, `text` on a full-canvas background | images, paths, gradients, logos as images, video footage, 3D |
| Motion | One built-in style for every shot (below). Same for every element of a type. | Per-element keyframes, camera moves, custom easing. The scene spec has no motion fields. |
| Transitions | Hard cut between shots; each shot opens with the built-in fade-up | Crossfades, wipes, match cuts |
| Format | 1280 × 720 at 24 fps by default (`context.width`, `height`, `fps`); the studio always sends the defaults | Vertical or square presets in the studio |
| Duration | Shot durations from the storyboard, frame-accurate | Global duration control in the studio (the model aims for about 8 seconds) |
| Audio | `src/audio/audio-track.mjs` models tracks and cues | Audio in the render. Nothing muxes audio into the MP4. |
| Caching | `src/timeline/render-cache.mjs` exists | Wired into rendering. Every render redraws every frame. |
| Text | Wraps at 76% of the width, size capped at 15% of the height, bold sans-serif with an accent glow | Custom fonts in the render, per-word styling |
| Seek contract | `seek(tLocalSeconds)` exists only in the sample scene (`public/scene-01*.js`) | In the production renderer, which uses `renderShotSvg(shot, progress)` |

### The built-in motion (scripts/render-production.mjs, `renderShotSvg`)

Over each shot, with `progress` running from 0 to 1:

- Every non-background element fades from 16% to full opacity over the first
  quarter, eased out.
- Text rises about 3.5% of the canvas height into place over the same window,
  with red and accent-colored offset copies (a glitch) for the first 24%.
- Rects whose id ends in `-accent` draw on from the left over roughly the
  first 45%.
- The renderer adds atmosphere on every shot: an accent radial glow and two
  thin rings centered about 76% across and 48% down (one dashed, slowly
  rotating), a faint accent grid, and two accent lines low on the left near
  78% down.
- The full-canvas background rect stays at full opacity only if its id ends
  in `-background`. Any other id fades in with the rest and flashes dark at
  each shot start. The repair layer renames it.

To change motion you change `renderShotSvg`, which changes every shot of
every production. Keep it a pure function of `progress` so renders stay
deterministic.

## Files

| Path | What it is |
| --- | --- |
| `public/index.html`, `studio.js`, `studio.css` | The studio: one conversation per production, approval gates, Projects, Library, System |
| `src/runtime/static-server.mjs` | Node server: static files plus the APIs below |
| `src/runtime/creative-api.mjs` | Provider cascade: Gemini keys, then Groq, then OpenRouter, then the offline mock |
| `src/ai/provider.mjs` | Gemini and OpenAI-compatible providers, response schemas, `sceneRules()` |
| `src/ai/prompts/` | Gemini's production thinking: `storyboard-director.mjs`, `shot-compiler.mjs` |
| `src/production/production.mjs` | Storyboard validation, offline mock, acceptance spec, `buildTimeline`, creative QA |
| `src/production/repair.mjs` | Fixes model output before validation |
| `src/production/color.mjs` | Contrast math and readable text color |
| `src/orchestrator/project-state.mjs` | The state machine and its evidence rules |
| `scripts/render-production.mjs` | Frames, MP4, ffprobe metadata, production QA, report |
| `scripts/qa/validate-production.mjs` | Validates a render report |
| `api/*.js` | Vercel functions for generate, state, engine (render is unsupported on Vercel) |
| `src/resilient/`, `src/routes/storyboard.mjs` | A rules-engine storyboard cascade on `/api/storyboard`. The studio does not use it, and its storyboard shape (`scenes`, `onScreenText`) differs from the production shape. |

## Commands

| Command | Use |
| --- | --- |
| `npm test` | All unit, integration and skill drift tests |
| `npm start` | Studio on `PORT` (default 4173) |
| `npm run render -- --input request.json` | Render a request file (`{ timeline, storyboard, acceptance, context }`). Prints `RENDER_REPORT:<path>`. |
| `npm run qa:validate -- <report.json>` | Validate a render report |
| `npm run health` | Check runtime prerequisites |
| `npm run render:scene-01` | Render the sample scene |

FFmpeg and FFprobe must be installed for rendering. The Docker image includes
them; check with `ffmpeg -version` before promising a render elsewhere.

## APIs

| Endpoint | Purpose |
| --- | --- |
| `POST /api/generate` `{ action: "storyboard", prompt, context }` | Storyboard plus acceptance spec |
| `POST /api/generate` `{ action: "compile", storyboard, context }` | Timeline of validated shot specs |
| `POST /api/render` `{ timeline, storyboard, acceptance, context }` | Render, production QA, report (Render deployment only) |
| `POST /api/state` `{ project, nextState, evidence }` | One state transition |
| `GET /api/engine` | Configured providers (never keys) and `render: { available, reason }` |
| `GET /health` | Liveness |

Generate responses always include `provider`, `telemetry`, and when present
`repairs`. A fallback response adds `warning` and `fallbackReason`
(`quota`, `auth`, `config`, `timeout`, `network`, `overload`, `output`,
`provider`, or `unconfigured`).

## States and evidence

| Transition | Evidence required |
| --- | --- |
| `BRIEF` → `PLANNING` | Non-empty brief |
| `PLANNING` → `STORYBOARD_REVIEW` | Valid storyboard |
| `STORYBOARD_REVIEW` → `BUILDING` | `storyboardApproved: true`, valid storyboard, acceptance with one `shotCriteria` entry per shot |
| `BUILDING` → `RENDERING` | Valid timeline |
| `RENDERING` → `QA` | Render report with `verified: true` and boolean production and creative QA results |
| `QA` → `APPROVED` | `finalCutApproved: true` and both QA gates passed |
| `APPROVED` → `DELIVERED` | Video and source artifacts under `/output/` |

## Deployments

Render (Docker, FFmpeg) runs everything. Vercel serves the studio and the
generate, state and engine APIs, but cannot render: `api/engine.js` reports
`render.available: false` and the studio disables the Render button with the
reason. A local or Docker server checks for FFmpeg and FFprobe once and
reports the result the same way. Render's free plan has
ephemeral storage: files under `/app/output` vanish on restart.
