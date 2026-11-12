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
| `stat` | A number in the line counts up from zero (keeping its decimals and separators), huge in the display face, then settles exactly as written. Only when the line contains a number |
| `quote` | A testimonial: a large quotation mark, the line in Montserrat Medium word by word, and the kicker beneath as the attribution |
| `product-grid` | Two to four product photos in a grid (a row in landscape, two by two in vertical and square), each emerging in turn, with the line beneath. Only with two or more photos |
| `split` | A split screen: a product photo fills one half edge to edge (top half in vertical), the line sits on the other half beside an accent divider. Only with product photos |
| `word-beat` | Kinetic poster: each word of a two- to five-word line fills the frame in turn, punching in on its beat (FOLD Score hits every word), then the words resolve into the line |
| `logo-reveal` | The uploaded logo as the hero: an SVG strokes itself on along each shape's measured length and fills with its own colors, a PNG wipes in; a glint crosses its exact silhouette; the line sits small beneath. Only with an uploaded logo (`normalizeDirection` swaps it out otherwise) |

Transitions between shots: `cut`, `wipe` (accent panel with a lighter stripe),
`fade` (through the background), `push` (the camera pushes through), `zoom`
(the camera flies into a letter of the line, a point of solid ink preferring the
emphasized word, and the next shot shows through the letter until it fills the
frame; once per film, and a push when no letter fits) and `fold`, FOLD Motion's
signature: the frame folds in half like paper, revealing
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

### Brand fonts

A TTF or OTF uploaded to the brand kit replaces the display face (Anton) for
headlines; body text stays Montserrat. `public/font-metrics.mjs` reads the
font's own tables (cmap, hmtx, head, hhea, OS/2, name) for its family, weight,
cap height and every character's advance width, matching the bundled fonts'
measurements exactly. The studio measures at upload; the metrics travel with
planning requests (`context.brandFont`, checked by `normalizeBrandFont`) so
recipes lay text out with the font's real widths, and the file travels with
renders (`assets.font`, checked by `resolveFont`) so the rasterizer draws it.
WOFF/WOFF2 and font collections are refused with a clear message. Signed in,
the font is kept in the brand kit row (`supabase/migrations/20261110000000_brand_font.sql`
adds the column).

### Kinetic type and text color

Every direction can set `textMotion` (`rise`, `slam`: words punch in at three
times their size and snap into place with overshoot, `drop`: letters fall in with
a bounce, `split`: each line arrives as top and bottom halves from opposite
sides), `emphasisStyle` for the emphasized word (`gradient`, `outline`,
`highlight`: a marker swipe behind it, `pill`: a color capsule; highlighter and
pill only when the ink reads on the accent at 4.5:1) and `echo`: a giant outlined
copy of the key word behind the shot, deliberately cropped by the frame and
drifting slowly (decoration, so exempt from Fit and contrast). `applyTextMotion`
applies them after a recipe lays out. No motion repeats on consecutive shots,
and a film has at most two echoes. End cards with lines of up to six words are
the payoff: the display face at up to a fifth of the frame, slamming in.

### Graphics: icons, emojis, signs and badges

A direction's `graphics` (at most two per shot) support the type.
`public/graphics-library.mjs` holds 55 Lucide icons (ISC) and 52 Twemoji emojis
(CC BY 4.0, credited in the studio), packed as plain shapes only; signs (arrows,
asterisk, sparkle, plus, index numbers, ampersand) and badges (seal, pill, tag)
are drawn by the engine. `applyGraphics` places them relative to the headline
(above, below, beside, or overlapping a corner like a sticker), sized from the
type, kept inside the frame, and timed to arrive after the headline lands. Badge
words must come from the shot's copy or a neutral word (NEW, OUT NOW, SHOP NOW),
so a film never invents an offer; a badge whose ink wouldn't read on the accent
is dropped. Fit checks graphics too, and FOLD Score chimes as each appears.
Emojis are for playful briefs only (a rule for the model now; style kits will
enforce it in code).

### FOLD Score 2: real instruments

Films are scored with real recorded instruments when `assets/samples` is present
(a 7 MB pack of CC0 Versilian samples: Steinway piano, violin and cello sections,
harp, glockenspiel, contrabass sustain and pizzicato, marimba, and ten percussion
hits; rebuilt from the original repositories by `scripts/build-sample-pack.mjs`).
`src/audio/band.mjs` samples and arranges them from the music book
(`src/audio/music-book.mjs`, explained in `references/music.md`) in place of the
synth pad, bass and arp; the synth's drums and sound design, the ducking, room and
master stay. Mastering repeats until the score is within 0.3 LU of -14 LUFS.
`FOLD_SCORE=synth` forces the synth score, which also plays if the pack can't
load. The render report records `audio.instruments`.

### Word beats, color words and the payoff

Runs of three or more one-word shots merge into one word beat (up to five words,
same total time), and staccato lines ("Ruby. Sapphire. Emerald.") are steered to
`word-beat`. Words that name a color (gems, flowers, fruit, metals: ruby,
sapphire, emerald, gold, rose, lavender, citrus…) light up in it in word beats,
and when they're the emphasized word, adjusted to 4.5:1 on the background. On
fresh builds the end card keeps at least three seconds (or a fifth of the film),
taken from the longest shots; edits are left alone. Statements of up to three
words are set larger.

### The brief's words are binding

`applyBriefWords` reads each storyboard shot's description: slams, letters drop,
splits in, traces in as an outline, decodes, highlighter, pill, outlined word,
echo, word beat, count-up and quote card set the effect in code. Those typography
choices are marked `briefLocked`, so the style kit doesn't overwrite them (the
user asked for them); graphics stay guarded by the kit. Headline effects never
apply to word beats, count-ups, type windows or logo reveals (they'd replace the
shot's own animation). With timecoded beats, the brief sets the shot count.

### Font pairings

Six pairings (`src/production/font-pairings.mjs`), all SIL Open Font License fonts
from Google Fonts bundled in `assets/fonts/pairings` (22 static instances, 1.1 MB,
rebuilt by `scripts/build-font-pairings.py`, each family's OFL.txt beside it):

| Pairing | Display | Body | Kicker | Style kit |
| --- | --- | --- | --- | --- |
| classic | Anton | Montserrat | Montserrat caps, wide tracking | (default) |
| editorial | Playfair Display | Montserrat | Playfair italic | Editorial luxury |
| modern | Space Grotesk | Inter | Space Mono caps | Tech & UI |
| friendly | Fredoka | Nunito | Caveat (handwritten) | Playful DTC |
| condensed | Bebas Neue | Archivo | Archivo Black caps | Bold street |
| soft | Fraunces | DM Sans | Fraunces italic | Warm craft |

The style kit picks a pairing; brief words ("serif", "monospace", "handwritten",
"rounded", "condensed", "soft serif") override it; the studio's Fonts picker
overrides both (rebuilds without AI); an uploaded brand font always stays the
display face. While a recipe lays out, its roles (display, bold, semibold,
medium) map to the pairing's fonts (`withFonts`), so every measurement uses the
real font; elements then store the concrete font ids, so rendering, Fit and
contrast work unchanged. The timeline records its `fonts`.

### Style kits

Each film has a visual language from `src/production/style-kits.mjs`:
`editorial-luxury`, `playful-dtc`, `tech-ui`, `bold-street` or `warm-craft`. A kit
lists the text motions, emphasis styles, graphic kinds, echoes and headline
effects it allows, and a graphics budget per film. The storyboard picks one
(`style`, with `styleReason`; offline, the brief's words with the music mood as
a tiebreaker); the studio's Style picker overrides it and rebuilds without AI.
`enforceStyleKit` applies the kit in code on every build, so a luxury film can't
get emojis even if the model asks. The timeline records its `style`. Variety: no
shot type three times in a row (products and end cards excepted).

### Headline effects and film looks

A direction's `typeEffect` gives a shot's title `decode` (each letter cycles
through code-like glyphs, then locks in, left to right) or `outline` (the
letters trace themselves as outlines, then fill); at most two per film, and not
on type windows or logo reveals. The storyboard's `grade` sets the film's look,
applied in FFmpeg with the grain: `clean` (brand colors untouched, the default),
`cinematic`, `matte` or `noir`. The studio's Look picker overrides it.

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
| `api/*.js` | Vercel functions for generate, state, engine; render, render-job and output forward to `RENDER_BACKEND_URL` when set (Vercel never renders itself) |
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
| `npm run render:browser -- --input request.json` | Experimental: render the same request in headless Chromium (see below). Prints `RENDER_REPORT:<path>`; the run folder ends in `-browser` |
| `npm run compare -- --brief "…"` | Render one offline-planned film with both renderers and stack them into `output/compare/*.mp4` (also takes `--input`) |

FFmpeg and FFprobe must be installed for rendering. The Docker image includes
them; check with `ffmpeg -version` before promising a render elsewhere.

## Experimental browser renderer

`src/browser/` renders a timeline in headless Chromium instead of SVG +
Resvg. It is opt-in (CLI only, never the studio's default) and draws the
engine's own layout: each title's lines, size, tracking, position and
emphasis come from the elements, so copy and placement match the SVG
engine and layout QA (`evaluateCreativeQA`) still applies. On top it adds
per-letter motion from `textMotion`, a 3D camera from `motion.camera`, a
deep echo layer for parallax, glow, light sweeps, canvas atmospheres, a
real 3D accordion for `fold`, and motion blur (4 samples across a
180-degree shutter, blended by FFmpeg `tmix`; grain is added after the
blend). It adds FOLD Score audio, checks with FFprobe, and its own QA at
each shot's settled moment: copy drawn exactly, title letters inside the
safe area, and letters advancing left to right. Not supported yet: product
photos (`image` elements) and uploaded brand fonts; both are listed under
`unsupported` in the report, never dropped silently. It is about 10x slower
than the SVG engine (Chromium's capture is the cost), so it isn't wired
into the studio or the Render deployment. Needs the dev dependencies installed (Playwright
is a dev dependency) and `npx playwright install chromium`.

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
generate, state and engine APIs, but cannot render itself. Without
`RENDER_BACKEND_URL`, `api/engine.js` reports `render.available: false` and the
studio disables the Render button with the reason. With `RENDER_BACKEND_URL`
set to the Render deployment, Vercel queues renders there (`api/render.js`),
proxies job status (`api/render-job.js`) and redirects `/output/` links
(`api/output.js`). A local or Docker server checks for FFmpeg and FFprobe once and
reports the result the same way. Render's free plan has
ephemeral storage: files under `/app/output` vanish on restart.
