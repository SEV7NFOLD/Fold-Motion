# The engine as it exists today

Plan and promise only what is in the "Today" column. The skill book in
`docs/FOLD-MOTION-SKILL-BOOK.md` describes the long-term architecture; where it
and this file disagree about current behavior, this file and the code win.

## Capabilities

| Area | Today | Not yet |
| --- | --- | --- |
| Elements | `rect`, `circle`, `text` on a full-canvas background | images, paths, gradients, logos as images, video footage, 3D |
| Motion | Per-shot `motion` in the scene spec: a camera move, a copy entrance and an atmosphere, from a fixed vocabulary (below) | Per-element keyframes, custom easing, orbiting or 3D camera moves |
| Transitions | Hard cut between shots; each shot's copy makes its own entrance | Crossfades, wipes between shots, match cuts |
| Format | 1280 × 720 at 24 fps by default (`context.width`, `height`, `fps`); the studio always sends the defaults | Vertical or square presets in the studio |
| Duration | Shot durations from the storyboard, frame-accurate | Global duration control in the studio (the model aims for about 8 seconds) |
| Audio | `src/audio/audio-track.mjs` models tracks and cues | Audio in the render. Nothing muxes audio into the MP4. |
| Caching | `src/timeline/render-cache.mjs` exists | Wired into rendering. Every render redraws every frame. |
| Text | Montserrat Bold (bundled in `assets/fonts`), wrapped at 76% of the width, size capped at 15% of the height, with an accent glow | Other fonts, per-word styling |
| Seek contract | `seek(tLocalSeconds)` exists only in the sample scene (`public/scene-01*.js`) | In the production renderer, which uses `renderShotSvg(shot, progress)` |

### The motion vocabulary (src/production/motion.mjs)

Each scene spec may carry `motion: { camera, entrance, atmosphere }`. The
renderer (`renderShotSvg` in scripts/render-production.mjs) animates it as a
pure function of shot progress, so renders stay deterministic.

| Field | Options | Default |
| --- | --- | --- |
| `camera` | `static`, `push-in` (scale up 8%), `pull-out` (settle from 108%), `drift-left`, `drift-right` (3% of the width) | `static` |
| `entrance` | `rise-glitch`, `fade`, `slide-up`, `slide-left`, `scale-in`, `type-on`, `wipe` | `rise-glitch` |
| `atmosphere` | `orbit` (glow, rings, grid, lines), `spotlight`, `grid`, `lines`, `clean` | `orbit` |

The defaults reproduce the original look exactly. Other behavior that applies
to every shot:

- Non-text elements fade from 16% to full opacity over the first quarter of
  the shot. Rects whose id ends in `-accent` draw on from the left over
  roughly the first 45%.
- Entrances finish within the first 25% to 45% of the shot, then the copy
  holds.
- The full-canvas background rect stays at full opacity only if its id ends
  in `-background`; any other id fades in and flashes dark. The repair layer
  renames it. The background never moves with the camera.

Model output missing `motion` gets a deterministic pick from
`fallbackMotion` (seeded by the storyboard), and the offline fallback uses the
same function, so even fallback films differ from one brief to the next.

To add an option, change `src/production/motion.mjs` and `renderShotSvg`,
then the studio's `MOTION_LABELS` and preview. The prompts and the Gemini
schema read the vocabulary from `motion.mjs`, and the drift tests check the
rest.

## Rendering performance

Each frame is drawn with one bundled font (no system font scan), the grid is
a single path, garbage is collected every 12 frames (the script runs with
`--expose-gc`), and FFmpeg encodes with `-preset veryfast` and `aq-mode=3` on one thread. An
8.5-second film (204 frames) takes about 13 seconds and 300 MB on one CPU
core. On Render's free plan (0.1 CPU, 512 MB) expect about two minutes; the
Starter plan (0.5 CPU) is about five times faster.

| Variable | Default |
| --- | --- |
| `RENDER_TIMEOUT_MS` | `900000` (15 minutes) for the whole render, set by the server |
| `RENDER_ENCODE_TIMEOUT_MS` | `600000` for the FFmpeg and FFprobe steps |
| `RENDER_FFMPEG_THREADS` | `1` |
| `RENDER_X264_PRESET` | `veryfast` |
| `RENDER_X264_CRF` | `18` (with `aq-mode=3` against banding in dark gradients) |

The server runs the renderer directly with Node (no npm wrapper) and reports
failures in plain words: a timeout, a memory kill, or the last lines of the
error.

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
| `npm run render -- --input request.json` | Render a request file (`{ timeline, storyboard, acceptance, context }`). Prints `RENDER_REPORT:<path>`. Runs with `--expose-gc`. |
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
