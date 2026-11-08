# The engine as it exists today

Plan and promise only what is in the "Today" column. The skill book in
`docs/FOLD-MOTION-SKILL-BOOK.md` describes the long-term architecture; where it
and this file disagree about current behavior, this file and the code win.

## Two scene formats

- **v2 (current):** Gemini *directs* each shot: it picks a recipe, a kicker, an
  emphasis word, motion and a transition. `src/production/recipes.mjs` expands
  that into measured, choreographed elements, and `src/render/frame-v2.mjs`
  draws every frame. The offline fallback also produces v2 shots.
- **v1 (legacy):** raw `rect`, `circle` and `text` elements with the motion
  vocabulary below, drawn by `renderShotSvg`. Kept so older projects and older
  model responses still render; a scene with `elements` and no `recipe` is v1.

### v2 recipes

| Recipe | Staging |
| --- | --- |
| `title-reveal` | Display face (Anton), words rise out of masks one by one, tracking tightens, hairline, optional kicker below; the hero shot |
| `statement` | Bold sans, letters cascade in, optional kicker above and supporting line below |
| `kicker-title` | Opening card: tracked kicker first, then the line rises under a beam of light |
| `type-stack` | Two to four words stacked, each line scaled to the same width, sliding in from alternating sides |
| `lockup` | End card: the line, a hairline, the kicker set as a brand name in the display face, light sweep; the uploaded logo, if any, sits above the line |
| `product-hero` | An uploaded product photo, graded into the palette, as a feathered panel on one side (alternating sides from one product shot to the next) with a settle, a slow push-in and a pass of light; the line rises huge in the display face beside it. Only with product photos |
| `type-window` | Giant display letters filled with the graded product photo, landing one by one, outlined for legibility; one or two short words (longer lines become a product hero). Only with product photos |
| `logo-reveal` | The uploaded logo as the hero: an SVG strokes itself on along each shape's measured length and fills with its own colors, a PNG wipes in; a glint crosses its exact silhouette; the line sits small beneath. Only with an uploaded logo (`normalizeDirection` swaps it out otherwise) |

Transitions between shots: `cut`, `wipe` (accent panel with a lighter stripe),
`fade` (through the background), `push` (the camera pushes through) and
`fold`, FOLD Motion's signature: the frame folds in half like paper, revealing
the next shot, then the folded half folds away. A film's folds alternate
between a vertical and a horizontal crease; the paper's back is stock tinted
with the brand's colors. `limitFolds` keeps at most two folds per film (extras
become wipes). Shots
can also open with a `beam` of light and finish with a `sweep` across the line.
All text is measured from the bundled fonts (`assets/fonts/metrics.json`), sized
to fit 84% of the width at its widest moment, and colored to pass 4.5:1
contrast, including the emphasis gradient. v2 films get subtle film grain at
encode (`RENDER_GRAIN`, default 3; 0 turns it off).

### Brand assets

The studio keeps a brand kit (one logo, up to three product photos) in the
browser's IndexedDB; like the colors, it carries over to new productions.
Planning requests carry only logo metadata (`context.logo`: kind, width,
height), so recipes can lay the logo out; render requests carry the logo itself
(`assets.logo`: `{ kind: 'svg', svg }` or `{ kind: 'png', dataUri }`).

SVG logos are rebuilt by `public/svg-sanitize.mjs`, shared by the studio and the
server: only whitelisted shapes, attributes and local references survive, simple
`<style>` class rules become attributes, and each shape's length is measured for
the draw-on. Scripts, event handlers, external links, embedded HTML, images,
`<use>`, animation and custom entities never survive. The server checks every
logo again (`src/production/brand-assets.mjs`) before rendering; PNGs are
checked for format, size and real dimensions. Shapes with no fill of their own
take the film's text color. The Fold's paper carries the logo debossed in one
tint. Product photos (up to three, JPEG or PNG, checked for size and real
dimensions) come with the render request, or by path from the user's
`brand-assets` folder. Once per render, `gradeProduct` maps each photo's
luminance through the palette (shadows from the primary, muted mid-tones toward
the accent, warm paper highlights) and `bakeProductPanels` bakes each panel's
feathered edges into a transparent image, so frames draw one plain image. A type
window draws the photo once per frame through a mask of all its letters. With
product photos uploaded, `ensureProductShot` makes sure the film shows the
product at least once.

### Sound (FOLD Score)

`composeScore(timeline, { mood, text })` reads every cue from the timeline
(cuts and their transitions, word and type-window letter landings, light sweeps,
the opening beam, logo drawing and glint, product reveals, the end card), picks
the tempo in the mood's range whose beat grid sits closest to the cuts, and
synthesizes a stereo score: a pad that changes chord on each cut and resolves
on the end card, a groove (kick, hats, bass, arpeggio) between the opening and
the end card, and sound design on every cue. Moods: `premium` (Premium calm),
`energetic`, `editorial`, `warm`; `auto` picks one from the storyboard's words,
and `off` renders silent. `masterScore` measures loudness with ITU-R BS.1770
and brings it to -14 LUFS under a -2 dBFS look-ahead limiter, so FFmpeg only
encodes AAC. It is deterministic: the same timeline and mood give the same
samples. Production QA adds audio checks: present, duration, loudness within
1.5 LU of -14, true peak at most -0.5 dBFS, and at least 90% of cuts, letters and
the end card with an onset within one frame.

### Accounts and storage

When `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` are
set, the studio requires email sign-in and keeps projects, the brand kit and
films in Supabase (`supabase/migrations/20261108000000_fold_motion.sql`; row
level security keeps every row and file private to its owner). The server
(`src/runtime/supabase-server.mjs`) refuses unsigned requests to the generate,
storyboard, state and render endpoints with 401, verifies tokens with Supabase
Auth, loads logos only from the user's own `brand-assets/<user id>/` folder, and
stores each film at `films/<user id>/<project>/<run>.mp4` with a signed link.
The browser client (`public/supabase-client.mjs`) uses only the publishable key.
Without those variables nothing changes: the studio saves to the browser.

## Capabilities

| Area | Today | Not yet |
| --- | --- | --- |
| Elements | v2: recipe-built type, hairlines, kickers, emphasis gradients, light sweeps, the uploaded logo (SVG or PNG), graded product photos and photo-filled letters. v1: `rect`, `circle`, `text` | video footage, 3D |
| Motion | Per-shot `motion` in the scene spec: a camera move, a copy entrance and an atmosphere, from a fixed vocabulary (below) | Per-element keyframes, custom easing, orbiting or 3D camera moves |
| Transitions | v2: `cut`, `wipe`, `fade`, `push`, `fold`. v1: hard cuts | Zoom through a letter, match cuts |
| Format | 1280 × 720 at 24 fps by default (`context.width`, `height`, `fps`); the studio always sends the defaults | Vertical or square presets in the studio |
| Duration | Shot durations from the storyboard, frame-accurate | Global duration control in the studio (the model aims for about 8 seconds) |
| Audio | FOLD Score (`src/audio/fold-score.mjs`): a stereo score composed from the timeline, mastered to -14 LUFS and muxed as AAC; four moods or none | Voiceover, licensed music, AI-generated music beds |
| Caching | `src/timeline/render-cache.mjs` exists | Wired into rendering. Every render redraws every frame. |
| Text | v2: Anton display with Montserrat 500/600/700, measured layout, per-word and per-letter animation. v1: Montserrat Bold wrapped at 76% of the width, capped at 15% of the height | Uploaded brand fonts |
| Seek contract | `seek(tLocalSeconds)` exists only in the sample scene (`public/scene-01*.js`) | In the production renderer, which uses `renderShotSvg(shot, progress)` |

### The motion vocabulary (src/production/motion.mjs)

Each scene spec may carry `motion: { camera, entrance, atmosphere }`. The
renderer (`renderShotSvg` in scripts/render-production.mjs) animates it as a
pure function of shot progress, so renders stay deterministic.

| Field | Options | Default |
| --- | --- | --- |
| `camera` | `static`, `push-in` (scale up 8%), `pull-out` (settle from 108%), `drift-left`, `drift-right` (3% of the width) | `static` |
| `entrance` | `rise-glitch`, `fade`, `slide-up`, `slide-left`, `scale-in`, `type-on`, `wipe` | `rise-glitch` |
| `atmosphere` | `orbit` (glow, rings, grid, lines), `spotlight`, `grid`, `lines`, `clean`, `planes` (drifting folded triangles), `dots` (dot field with a light ripple) | `orbit` |

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
| `src/production/repair.mjs` | Fixes legacy (v1) model output before validation |
| `src/production/recipes.mjs` | v2 recipes, direction cleanup (`normalizeDirection`) and the offline fallback's direction |
| `src/render/frame-v2.mjs` | v2 frame renderer: recipes' choreography, atmospheres, beam, camera, transitions |
| `src/render/typography.mjs` | Bundled fonts and exact text measurement |
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
