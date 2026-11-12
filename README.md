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
**Vercel cannot render video itself**: it has no FFmpeg and its functions can't
run a full encode. Without further setup, `/api/engine` reports
`render.available: false` and the Studio disables rendering with that
explanation.

To render from the Vercel site, deploy the Render service too and set
`RENDER_BACKEND_URL` in the Vercel project to its URL (for example
`https://fold-motion-studio.onrender.com`), then redeploy. Vercel then queues
each render on the Render server, polls its progress, and sends film links
there. Give both deployments the same Supabase settings so sign-in works on
both. A sleeping free Render instance takes about a minute to wake; the Studio
starts waking it when it opens, and if a render still times out, press Render
again.

## Launch style

In the studio, set the toolbar's motion style to **Launch** before sending a
brief: the film is planned beat by beat (copy forms become motion devices:
builds, product heroes and tiles, swaps, checklists, typed prompts, counts,
lockups), cut on the music's beat with continuity transitions, and rendered
in headless Chromium. Launch renders need Chromium on the server: the Docker
image includes it (build argument `FOLD_LAUNCH=1`, the default), and a Render
instance needs about 2 GB of memory; locally, run `npx playwright install
chromium`. The studio says so when a server can't render launch films.

## Experimental browser renderer

`npm run render:browser -- --input request.json` renders a film in headless
Chromium instead of SVG: the same layout and copy, plus 3D camera moves,
per-letter motion, glow, light sweeps, a real 3D fold transition and motion
blur. `npm run compare -- --brief "Your brief"` renders one film both ways
and stacks them into a single video in `output/compare/`. It's opt-in,
about 10x slower than the SVG engine, and doesn't draw product photos or
uploaded brand fonts yet. Setup: `npm install`, then
`npx playwright install chromium`.

## The v2 engine

Gemini directs each shot by choosing a recipe (`title-reveal`, `statement`,
`kicker-title`, `type-stack`, `lockup`), a short kicker, an emphasis word, motion
and a transition (`cut`, `wipe`, `fade`, `push`). The engine lays the exact copy
out with real font measurements (Anton and Montserrat, bundled in
`assets/fonts`) and choreographs it: words rising out of masks, letter
cascades, tracking that settles, gradient emphasis, hairlines, light sweeps,
beams, depth planes and dot-field ripples, with film grain at encode. See
`skills/fold-motion/references/engine.md`.

## Brand fonts

Upload the client's headline typeface (TTF or OTF) in the brand kit. FOLD
Motion measures it exactly, lays every headline out with its real letter
widths, and renders it; body text stays Montserrat. Signed-in studios: run
`supabase/migrations/20261110000000_brand_font.sql` once so the font is kept in
your account.

## Sound (FOLD Score)

Every film gets a soundtrack composed from its own edit: the score reads each
cut, transition, word landing, type-window letter, sweep, logo and product moment
from the timeline, picks a tempo whose beats line up with the cuts, and puts a
hit on every one. Four moods (Premium calm, Energetic, Editorial, Warm), chosen
in the studio's Music picker or automatically from the brief; or no music. The
score is mastered to -14 LUFS and checked in production QA for loudness, peaks
and sync (every major hit within one frame).

## Accounts and storage (Supabase)

With Supabase configured, FOLD Motion asks people to sign in with an emailed
link, and keeps each person's projects, brand kit and rendered films in their own
private space. Without it, the studio runs as before, saving to the browser.

| Variable | Where it's used | Value |
| --- | --- | --- |
| `SUPABASE_URL` | Server and studio | `https://<project>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Sent to the studio (safe in browsers) | Supabase > Settings > API Keys > Publishable key (`sb_publishable_…`). The legacy `SUPABASE_ANON_KEY` also works. |
| `SUPABASE_SECRET_KEY` | Server only, never sent to browsers | Same page > Secret key (`sb_secret_…`). The legacy `SUPABASE_SERVICE_ROLE_KEY` also works. |

Set up once, in this order:

1. In the Supabase SQL Editor, run `supabase/migrations/20261108000000_fold_motion.sql`.
   It creates the `projects`, `brand_kits` and `films` tables and the private
   `brand-assets` and `films` buckets, with row level security so each user can
   only reach their own rows and files. It is safe to run again.
2. Under Authentication > URL Configuration, set the Site URL to the studio's
   address and add every address people open it from (with `/**`) to Redirect URLs.
3. Add the three variables to Render (and Vercel), then redeploy.

On first sign-in, projects and the brand kit already saved in that browser are
imported once. Generating, planning and rendering require a signed-in user. The
server checks each user's access token with Supabase Auth, reads logos only from
that user's folder, and saves each film to `films/<user id>/…` with a private
link that is renewed whenever the film is reopened. `tools/mock-supabase.mjs` is a
local stand-in for end-to-end tests.

## Brand assets

Upload a logo (SVG or PNG) and up to three product photos under Add headline
and colors. The logo appears on the end card, debossed on The Fold's paper,
and in the `logo-reveal` recipe, where an SVG draws itself on. Every SVG is
rebuilt from a strict whitelist in the browser and again on the server, so
nothing executable or external survives. A raster logo with a plain background
has it removed; a photo background is flagged, since it would show as a box.
Product photos are graded into the brand palette and staged as product hero
shots (`product-hero`) and photo-filled letters (`type-window`).

## Motion

Each shot's scene spec carries `motion: { camera, entrance, atmosphere }`,
chosen by Gemini from a fixed vocabulary in `src/production/motion.mjs`:

- **camera:** `static`, `push-in`, `pull-out`, `drift-left`, `drift-right`
- **entrance:** `rise-glitch`, `fade`, `slide-up`, `slide-left`, `scale-in`, `type-on`, `wipe`
- **atmosphere:** `orbit`, `spotlight`, `grid`, `lines`, `clean`

Rendering stays deterministic: every option is a pure function of shot
progress. A spec without `motion` renders exactly as before. The offline
fallback picks a coherent family of options seeded by the storyboard, so
fallback films differ from brief to brief.

## Rendering on small servers

Renders use a bundled font (Montserrat Bold, OFL, in `assets/fonts`), so text
looks the same everywhere and no system fonts are scanned per frame. An
8.5-second film takes about 10 to 13 seconds and under 300 MB on one CPU core;
on Render's free plan (0.1 CPU, 512 MB) expect about two minutes.

| Variable | Default | What it does |
| --- | --- | --- |
| `RENDER_TIMEOUT_MS` | `900000` | Time limit for a whole render (15 minutes). |
| `RENDER_ENCODE_TIMEOUT_MS` | `600000` | Time limit for the FFmpeg and FFprobe steps. |
| `RENDER_FFMPEG_THREADS` | `1` | Encoder threads; more threads use more memory. |
| `RENDER_X264_PRESET` | `veryfast` | x264 speed preset. |
| `RENDER_X264_CRF` | `18` | Quality (lower is better and larger). Encodes use `aq-mode=3` against banding. |

## AI providers

| Variable | Default | What it does |
| --- | --- | --- |
| `GEMINI_API_KEY`, `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, `GEMINI_API_KEYS` | none | Gemini keys, tried in order. |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Gemini model ID. Flash-Lite has a much larger free-tier daily quota than Flash. Set `gemini-3.8-flash` on a paid tier. |
| `GEMINI_BACKUP_MODELS` | `gemini-3.6-flash` | Comma-separated Gemini models tried when the primary is overloaded or out of quota (both are per model). Set it empty to disable. |
| `GEMINI_OVERLOAD_RETRIES` | `1` | Retries per model after a 503 or network error, before the backup model. |
| `GEMINI_RETRY_DELAY_MS` | `1500` | Pause before a retry, multiplied by the retry number. |
| `GEMINI_THINKING_LEVEL` | unset | Optional `thinkingConfig.thinkingLevel` (for example `low`). Leave unset to use the model's default. |
| `GEMINI_TIMEOUT_MS` | `45000` | Per-request timeout. |
| `GEMINI_BACKUP_THINKING_LEVEL` | `low` | Thinking level for backup models (full thinking models are slow on large structured answers at their default). Set it empty to use the model default. |
| `GEMINI_ROTATE_ON_QUOTA` | `false` | Keys in one Google Cloud project share a quota, so a 429 stops key rotation. Set `true` only if your keys come from separate projects. |
| `GROQ_API_KEY` | none | Fallback after Gemini (`llama-3.3-70b-versatile`, then `llama-3.1-8b-instant`). |
| `OPENROUTER_API_KEY` | none | Fallback after Groq (`openrouter/free`). |

**How the cascade decides.** Each failure is classified. A 503 or network
error retries the same model once, then tries the backup model; a quota error
or unknown model goes straight to the backup model, since overload and quota
are per model. Only a rejected key rotates to the next key, because every key
reaches the same servers. A timeout or an unusable answer moves on to Groq,
then OpenRouter. The deterministic mock runs only when every configured
provider has failed, and the response's `warning` and `fallbackReason` say
why.

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