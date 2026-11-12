# Launch style: master build plan

Goal: a director drops a product or launch brief into the studio and gets a
film at the level of modern SaaS and tech launch motion: word-by-word beats
locked to the music, refined typography, soft light, UI storytelling. Every
word stays exactly as approved, as FOLD Motion already guarantees.

This plan is written to be executed phase by phase by a coding agent. Each
phase lists what to build, where, and the tests that prove it is done. Do
not start a phase until the previous one passes. Follow `AGENTS.md` and
`skills/fold-motion/SKILL.md` throughout.

## Status

- **Phase 1 has started.** Built and tested: the beat clock
  (`src/production/beat-clock.mjs`), pacing by mood (`src/production/pacing.mjs`),
  copy into beats (`src/production/beats.mjs`), and the silent tempo-labelled
  export in both renderers (PR #38). Then the wiring: `context.beat` aligns
  cuts to beats and reveals to half-beats, FOLD Score plays at the film's
  tempo, and `beatSync` is in every beat film's render report. Offline
  storyboards now pick their mood with `moodForBrief`. **Phase 1 is done**;
  Phase 2's splitter is built and waits to be used by the launch devices.
- **Phases 3–4 have started** (`context.launch`): a launch planner
  (`src/production/launch.mjs`) and a browser runtime
  (`src/browser/launch-runtime.js`) with four devices (build, swap, punch,
  lockup), a camera that animates, whip-pans onto every cut, and
  reading-time QA. Next: rebalance shot lengths by reading need before beat
  alignment (a four-item swap in three seconds at 120 BPM can't be read, and
  QA rightly fails it), then the type device, flips and continuity
  transitions.
- **First engine-made launch film** (13 s, five shots, 120 BPM): every QA
  check passes (beat sync on 14 events, exact copy on all devices, reading
  time), but it is calmer than the benchmark: 25% near-still frames (target
  under 25%), motion energy 1.28 (target 2.3), longest still 0.63 s (target
  0.5 s). Missing: continuity transitions, light/dark flips, the UI kit and
  bigger scale contrast (Phases 4b–6).
- **Phase 4b: continuity and flips.** fly-into, flip, whip and collapse
  transitions; brand/paper themes whose inks are each other's backgrounds;
  per-scene cameras with roll and stronger drift. The same film now meets
  every motion target and matches the hand-built benchmark: 11% near-still
  frames (benchmark 13%), motion energy 2.46 (2.38), longest still 0.47 s
  (0.20 s). Still to come: the UI kit and image roles (Phases 6–6b), the
  planner (7), sound design (5b) and render speed (11).
- **Phase 6: the UI kit.** `type` (prompt card, caret, cursor click with a
  macro zoom), `check` (spin-then-tick rows) and `count` (a number rolling
  to its value), each chosen from the copy without inventing words. A
  16-second engine film using all three passes every QA check: 8% near-still
  frames, longest still 0.33 s, motion energy 2.20 (just under the 2.3
  target; UI moments carry less raw motion than kinetic type). Tuning showed
  that the camera must never park after a device finishes, and that small UI
  on paper scenes needs size to read as motion. Next: product images (6b).
- **Phase 6b: product images.** A `product` device with image roles detected
  in the browser (cutout → hero, photo → tile), sized under the 1.25× rule at
  the camera's closest push and measured on screen by QA. The amaranthine
  test film (16 s, calm 90 BPM, a 112×291 px cutout and a 911 px photo)
  passes every check (bottle 1.15×, balm 0.73×); calm targets: 22% near-still
  frames, longest still 0.33 s, motion energy 1.82 (just under the calm
  target of 2.0). Not yet: label-detail crops, the dive into a photo,
  several products in one shot, image swaps.
- **Phase 7: the planner.** Launch instructions for Gemini (`LAUNCH_DIRECTOR`)
  and a `product` field in the storyboard schema; a launch-aware offline
  planner; pacing set by the real planner and reading check, so a longer
  shot can only read better (tested across devices and tempos), with a
  deliberate end-card hold. **A brief now goes straight to a film:** the
  Volt Runner brief planned itself as build → type → check → count → lockup
  and rendered with every QA check passing and every motion target met
  (9% near-still frames, motion energy 2.54, longest still 0.20 s). Gemini's
  output with these instructions still needs a real-key test in the studio.
  Next: the studio (Phase 10) and sound (5b).
- **Product images were prototyped** with three amaranthine photos (a small
  cutout and two lifestyle shots): an 8-second segment at 120 BPM and a
  calm 10-second cut at 96 BPM. Image roles and the 1.25× rule held on every
  frame; the director found the 120 BPM cut too fast for the brand, which
  led to *Pacing follows the brand's mood*.
- **Phase 0 is done.** The director approved golden film v2 on the second
  round (v1 scored 4/10). It lives in `assets/benchmarks/launch/` with its
  contact sheet, scene file and sound script. Every phase below is measured
  against it.

## What the references taught us

Studying the four references frame by frame, and measuring them, showed why
v1 failed and v2 worked. These rules outrank anything else in this plan.

1. **The camera animates; words pop.** Words appear within 2–3 frames with a
   small scale settle. The camera does the travelling: open huge and zoom
   out, chase the newest word (fast start, long tail), whip-pan, push in
   until type crops. Never give every element the same entrance.
2. **Nothing is ever still.** Every hold keeps a slow camera drift, zoom or
   roll, and UI keeps living (counters, charts, spinners, typing).
3. **Continuity, not cuts.** Each scene is born from an element of the one
   before: fly into a period until it becomes the next background, a text
   selection that morphs into a card, a button that grows into the next
   scene, a whip-pan through one shared world, shapes that collapse into
   the logo's dot.
4. **Contrast.** Tiny type next to frame-filling type; slow drifts broken by
   fast whips; calm holds, then bursts.
5. **Depth.** Letters fly in from depth with a focus pull; parallax layers;
   out-of-focus UI behind the type.
6. **Micro-detail.** Older words fade to grey as attention moves; selection
   highlights; colour wipes; spin-then-tick checks.
7. **Pacing follows the brand's mood.** A product segment for a calm
   skincare brand, cut at the benchmark's 120 BPM, felt rushed to the
   director; the same segment at 96 BPM fit the brand. Energetic tech
   launches run about 120 BPM; calm, premium and wellness brands run
   90–100 BPM, with longer holds, softer drums and fewer ideas per second.
8. **Sound is half the film.** A continuous musical bed from real
   instruments, a groove with a shape (build, drop to silence, impact), and
   a sound on most motion peaks.

## What "reference grade" means

The four reference films (a SaaS text animation, the Bleap fintech launch,
Google's "Made by" countdown, a Google Workspace update) define the style.
Do **not** copy their frames, layouts or wording: those designs belong to
their owners, and a copy would only fit their briefs. Match their *quality*,
measured by the criteria below. A film is reference grade when all hold.

Targets marked *measured* come from analysing the four references and the
approved benchmark (v1 → v2 shown where useful).

| # | Criterion | How it's checked |
| --- | --- | --- |
| M1 | Near-still frames under 25% for energetic films, under 35% for calm ones (*measured*: references 7–28%; v1 76% → v2 13%; product segment 23% at 120 BPM, 26% at 96 BPM) | `stillShare`: frame-difference energy on a 160×90 greyscale render |
| M2 | Mean motion energy 2.3 or more (2.0 for calm); no still stretch over 0.5 s (1.2 s for calm) (*measured*: v1 1.36 → v2 2.38) | `motionEnergy` on the same render |
| M3 | 70% or more of motion peaks have an audio onset within 2 frames (*measured*: Google countdown 75%; v2 73%) | `picSync` |
| M4 | Stereo correlation 0.90 or lower; midrange (250 Hz–2 kHz) 12–22% of energy (*measured*: v2 0.86, 17.6%) | `stereoWidth`, `bandBalance` |
| M5 | Loudness −13 LUFS ±1, true peak −1.5 dBFS or lower | `ebur128` |
| 1 | Every cut and every word entrance lands on a beat or half-beat | `beatSync` QA: 100% of events within 1 frame of the grid |
| 2 | Never more than 6 words of new copy on screen at once; most beats show 1–3 | `beatDensity` QA over the timeline |
| 3 | Copy across all beats concatenates to the approved copy exactly | `copyIntegrity` QA (extends repair checks) |
| 4 | Type is sentence case in a refined sans, with at most one serif-italic accent word per beat | Style kit rules + QA |
| 5 | At least 3 distinct motion devices per 15 s, and no device more than twice in a row | `deviceVariety` QA |
| 6 | Scale contrast: at least one beat at 2.5× the base type size per 15 s | `scaleContrast` QA |
| 7 | Backgrounds are soft light only: no particles, grids or outline echo words in this style | Style kit rule + drift test |
| 8 | Text contrast 4.5:1, nothing outside the safe area, no clipped glyphs | Existing creative QA |
| 9 | A vision review scores at least 8/10 on the rubric (Phase 8) for every eval brief | `npm run eval:launch` |
| 10 | The director approves Phase 0's golden film as the benchmark | Human gate |

## The style, in rules

**Pacing.** One idea per beat. A line builds word by word, or swaps a word in
place, on the beat. Shots are 1–4 beats long, not 3–6 seconds. Holds happen
on purpose, for the hero line and the end card.

**Type.** A clean sans (Inter, DM Sans or Space Grotesk, already bundled) in
sentence case, with an optional italic serif accent (Fraunces or Playfair
italic, bundled) for one word. Small type with generous space most of the
time, then sudden jumps to huge type for impact beats.

**Light.** Two or three large blurred gradient blobs in the brand's accent
family, drifting slowly. Depth-of-field blur on secondary elements. Optional
palette flips (dark ↔ light) on strong beats.

**Devices** (the motion vocabulary for this style):
- `build`: the line grows word by word while the camera pans to keep the newest word in view
- `swap`: one word slot cycles through options in place (e.g. "Spend / Earn / Save")
- `type`: a caret types the line, as in a prompt or search bar
- `punch`: one word hits at huge scale, then the line settles
- `flip`: the palette inverts on the beat
- `chip`: a UI pill or card drops into a gap inside the sentence
- `click`: a cursor moves to a word or button and clicks; the target reacts
- `count`: a number rolls up to its value (only numbers present in the copy)
- `check`: list items tick one per beat
- `wall`: a repeated word fills the frame and one instance is highlighted
- `lockup`: the logo and end line resolve, with a call to action

**Easing.** Entrances use a fast-out curve (cubic-bezier(0.16, 1, 0.3, 1)) of
0.5–0.75 beats; exits are quicker (0.25–0.4 beats, ease-in). Rises travel
0.35× the type size with a short blur trail. Camera pans use ease-in-out
across a full beat. Nothing bounces more than 4% past its target.

## Architecture decision

**Decided by the director: build the launch style in the browser renderer**
(`src/browser/`, from PR #36), not the SVG engine.

Why: every film the director approved (the benchmark and both product
cuts) was made in headless Chromium. CSS gives the look its depth for
free: real blur and focus pulls, masks and masked light sweeps, gradients,
blurred backdrops, exact font rendering. Rebuilding that in the SVG engine
would be slower to build and might not match. Quality is the point of this
style, so it uses the renderer that produced the approved quality.

What stays the same:
- The planner, storyboard, copy repair, approval gates and QA reports.
  The browser draws what the timeline describes; it doesn't decide it.
- Determinism: every scene is `frame(t)`, a pure function of time, with
  seeded randomness, and frame hashes are tested.
- The SVG engine keeps rendering every existing style. The launch style is
  a new style kit, `launch`; nothing else changes renderer.
- Runs are labelled with their renderer, and FFprobe validation applies
  as it does today (the skill's rule against switching backends silently).

Consequences to plan for:
- **Speed.** About 20 s of render time per second of film at 4 samples per
  frame in development (the 15-second benchmark took about 5 minutes).
  Phase 11 brings this down.
- **Server.** Launch renders need Chromium. Playwright moves from a dev
  dependency to a production one for launch renders, the Docker image grows
  (about 300–400 MB), and the free Render instance (512 MB) is too small:
  launch renders need a paid instance with about 2 GB, or run locally.
- **Code.** Where later phases mention `src/render/frame-v2.mjs` or drawing
  in recipes, read: scene modules in the browser runtime (`src/browser/`).
  Each device is a module that draws a shot from its spec as a function of
  time, the way the benchmark's `source/film.html` does.

## Phases## Phases

### Phase 0: Golden film (human gate)

Build one 15-second film by hand in the target style: FOLD Motion's own
launch ("Ideas into motion"), 1920×1080, 30 fps, with a FOLD Score track.
It may be written as a one-off script. It exists to settle taste before any
engine work.

- Output: `output/golden/launch-golden.mp4` and a 24-frame contact sheet.
- Done when: the director approves it. Save the approved contact sheet to
  `assets/benchmarks/launch/` as the visual benchmark for Phase 8.
- If it is not approved, iterate here. Do not build the engine around a look
  nobody signed off.

### Phase 1: Beat clock (music first)

Today `chooseTempo` in `src/audio/fold-score.mjs` fits the tempo to cuts
that already exist. Invert it for the launch style: choose the tempo first
(from the mood range), then build a beat grid and quantize every cut and
word entrance to it.

- Add `src/production/beat-clock.mjs`: `beatGrid(bpm, fps, durationInSeconds)`
  returns frame-exact beat and half-beat positions; `quantize(time, grid)`
  snaps to the nearest one.
- `buildTimeline` (in `src/production/production.mjs`) takes `context.beat`
  for launch films and snaps shot boundaries and reveal starts.
- `composeScore` accepts a fixed tempo and grid, and accents downbeats under cuts.
- Export: alongside the full mix, offer a silent file labelled with the
  film's tempo (for example "96 BPM"), so creators can add platform music
  that lands on the motion. The director's own workflow adds music in TikTok.
- QA: `beatSync` in the render report. Every cut and entrance must sit within
  one frame of a grid point. Reuse `measureSync`.
- Tests: grid math at 24, 25, 30 and 60 fps; quantization; a launch timeline
  passes `beatSync`; non-launch films behave exactly as before (frame hashes).

### Phase 1b: Pacing by mood

- The storyboard's mood picks the tempo from FOLD Score's ranges: energetic
  118–128 BPM, editorial 104–114, premium calm 84–96, warm 78–90. Product,
  wellness and luxury briefs lean calm unless the brief asks for energy.
- Beats per idea scale with the mood: a calm film gets about 1.5× the beats
  per scene of an energetic one, so fewer ideas fit the same length. The
  planner trims scenes rather than squeezing them.
- Minimum reading time: a beat that adds copy holds it on screen for at
  least 0.3 s + 0.06 s per character before the next change, whatever the
  tempo. Swaps of single words may go faster only after the first.
- Calm films use softer drums (lighter kick, no claps or tambourine),
  longer camera drifts and softer transitions.
- Sound effects are placed on the visual motion peaks, not only on the beat
  grid: when a transition peaks between beats, its hit moves to the peak
  (the product segment missed two peaks until its hits were re-timed).
- QA targets M1–M3 read their thresholds from the film's mood.
- Tests: the same brief planned as energetic and as calm gets the expected
  tempo and scene count; every copy beat meets the reading-time minimum.

### Phase 2: Copy into beats

Split each shot's approved copy into beats of 1–3 words (at most 6 on
screen), by rules, not by the model:

- Never split a brand or product name, a number with its unit, a price, a
  date or an offer.
- Prefer breaks at punctuation, then before conjunctions and prepositions.
- The concatenated beats equal the approved copy exactly. The repair layer
  enforces this, as it does copy today.

Files: `src/production/beats.mjs`, wired into `src/production/repair.mjs`.
Tests: a table of 40+ real lines with the expected beats; property test that
concatenation always equals the input; `copyIntegrity` QA.

### Phase 3: Launch typography

- New style kit `launch` in `src/production/style-kits.mjs`: pairing Inter
  or DM Sans with a Fraunces italic accent, sentence case, base size around
  5.5% of frame height, tracking −0.01 to −0.02 em.
- Emphasis becomes an italic serif word or an accent gradient, never both.
- `punch` beats scale to 2.5–4× base.
- The `launch` kit disables echo words, particles and grids (criterion 7).
- Tests: drift test that `launch` films contain no echo or particle elements;
  measured layout fits the safe area at every scale.

### Phase 4: Motion devices

Implement `build`, `swap`, `type`, `punch` and `flip` first (they need no UI
kit), then `wall` and `lockup`. Each device is a recipe in
`src/production/recipes.mjs` and draws in `src/render/frame-v2.mjs`, as a
pure function of the frame.

- `build` needs a camera that pans to keep the newest word in view: compute
  word positions from the measured layout and ease the view between them.
- Motion blur: approximate with a short directional blur on fast-moving words
  (feGaussianBlur with stdDeviation scaled by speed). Deterministic.
- Tests per device: frames are deterministic; the settled frame matches the
  layout; entrances start on beat frames.

### Phase 4b: Camera and continuity

The rules that took v1 to v2 (see *What the references taught us*).

- `src/production/camera.mjs`: a camera per shot (world point at screen
  centre, scale, roll) built from eased keys, plus a continuous drift so no
  shot ever settles. Zooms ease in log-scale.
- Continuity transitions as shot-to-shot links in the timeline:
  `fly-into` (camera dives into an element until it becomes the next
  background), `morph` (one element's box, radius and colour become the next
  shot's element), `grow` (a UI element expands into the next scene),
  `travel` (whip-pan through one world), `collapse` (elements converge into
  a point that the next shot uses).
- Motion blur by sub-frame sampling (4 samples, 180° shutter) for whips and
  zooms; deterministic.
- Tests: M1 and M2 pass for every eval brief; the benchmark scene's camera
  moves can be expressed with the new camera keys.

### Phase 5: Soft light and depth

- Gradient blob field: 2–3 large ellipses, heavily blurred, in the accent
  family, drifting slowly and seeded per film.
- Depth blur for secondary layers (UI cards behind the type).
- `flip` swaps the field and ink colors on the beat.
- Performance: blur is the costly part. Cache static blob layers per shot and
  keep a Full HD frame under the current render time per frame +50%.
- Tests: render time budget test; the blob field is deterministic.

### Phase 5b: Sound design

FOLD Score already ships real CC0 instruments; v1 sounded robotic because of
how they were arranged. Rebuild the arrangement, following
`assets/benchmarks/launch/source/score.py`:

- A continuous string bed per scene chord (cellos and violins, slow attack,
  wide), a piano arpeggio pulse, pulsing bass ducked under the kick.
- A groove with a shape: starts on the first strong scene change, thins
  while UI is busy, drops to silence before the hero action, impacts on the
  reveal, drops out under a cymbal swell before the lockup, lands on a hit.
- Humanised timing (±6 ms) and velocity (±15%) on everything except the
  hits that mark visual events.
- Sound effects from the timeline's events: tuned plucks on word pops,
  flicks on swaps, keyboard ticks, two-part clicks, whooshes panned with the
  camera, dings on checks, thumps on tile pops, an arpeggio on the logo.
- Reverb send, stereo width, a master EQ (trim lows, lift mids), and
  loudness to −13 LUFS with a true-peak limiter.
- Tests: M3, M4 and M5 pass; every effect sits within one frame of its event.

### Phase 6: UI kit

Draw in SVG, in brand colors: cursor (move along an eased curve, click with a
ripple), button, pill/chip, card (title, two lines, optional mini chart),
checkbox list, counter, and a prompt/search bar with a caret.

- Every text inside UI comes from the approved copy or is clearly neutral
  placeholder shape (grey lines), never invented claims.
- Devices `chip`, `click`, `count` and `check` use the kit.
- Tests: each component renders at 16:9, 9:16 and 1:1; counters only show
  numbers present in the copy.

### Phase 6b: Product images

Images join the motion system; they never sit still and they are never
altered. FOLD Motion's promise covers products as well as words: the
product in the film is the product in the photo.

**Each upload gets a role.**
- *Cutout*: a transparent PNG, or a photo on a plain background that can be
  keyed cleanly (uniform corners and edges). The hero object.
- *Photo*: lifestyle or full-bleed shots. These live in rounded-square tiles
  (1:1, or 4:5 in vertical films).
- *Detail*: tight crops cut from a high-resolution photo (label, texture,
  sole) to give a film several shots from one image.

**Motion per role.**
- `hero` (cutout): floats with a soft contact shadow, a slow 2.5D tilt
  (±6°), parallax against the type, a light sweep masked to its shape, and a
  focus pull on entry.
- `tile` (photo): pops with a small overshoot or morphs out of a card;
  inside the tile, a slow push toward the image's focal point, so the
  picture is never still.
- `image-swap`: one tile cycles product angles or colourways on the beat,
  like the word swap.
- `grid`: the camera travels through a grid of image tiles and type cells,
  as in the Bleap reference.
- `inline`: a small product chip inside a sentence ("Meet [product] Volt
  Runner"); the camera can then dive into it to open the next shot.
- `dive`: the camera flies into a tile until the photo fills the frame.
- `formats`: the product plays inside the 16:9, 9:16 and 1:1 frames.

**Rules.**
- Uniform scaling only; no stretching, recolouring of the product, or
  generated product imagery.
- Each image gets a focal box (detected from detail and contrast, or set by
  the director). Crops must keep the whole focal box inside the tile with a
  margin.
- Never upscale more than 1.25×; detail crops need the source pixels to
  back them. If an image is too small, it gets a smaller role.
- Text never sits on a busy part of an image without a scrim; contrast stays
  4.5:1.
- The light field takes its colours from the image's dominant colours (the
  existing palette grading), so photos and background belong together.
- Background keying runs only when the background is plain enough to key
  cleanly; anything else stays a photo. Nothing is cut out silently with a
  guess.

**Tests:** role detection on a fixture set (cutouts, studio shots,
lifestyle, low-resolution); focal-box crop safety; no upscaling beyond
1.25×; text contrast over images; motion targets M1 and M2 still pass.

### Phase 7: Planner

Teach the storyboard and shot prompts the launch style.

- `src/ai/prompts/storyboard-director.mjs` and `shot-compiler.mjs`: describe
  the devices, beat pacing, the variety rules and when to use each device.
- The compile schema enumerates the new devices; the mock planner produces
  valid launch films offline, so tests never need keys.
- `pairingFromWords` / style detection: product, SaaS, app and launch briefs
  pick `launch` by default.
- Update `skills/fold-motion/references/engine.md` and the drift tests in the
  same change, as `AGENTS.md` requires.

### Phase 8: Review loop (render, look, fix)

Automate the loop a human designer runs.

1. Render the film.
2. Build a 24-frame contact sheet and run the automated QA (criteria 1–8).
3. Send the contact sheet, the storyboard and the Phase 0 benchmark to a
   vision model (Gemini) with a fixed rubric: rhythm, type quality, hierarchy,
   use of space, light, device variety, brand fit. Each scores 1–10 with the
   frame number of every defect.
4. If any automated check fails or the score is below 8, apply the smallest
   fix for the worst defect (planner or engine) and re-render.
5. Limits from the skill: two technical repair attempts per failure, three
   creative rounds per shot, two global rounds. Then stop and report
   honestly; never mark a film as passing when it isn't.

Files: `scripts/review-film.mjs`, `src/qa/vision-review.mjs`. The vision
score is advice for the loop, not a replacement for the director's approval.

### Phase 9: Eval set

Ten fixed briefs covering the range: a SaaS feature launch, a fintech app, a
developer tool, a consumer app, a hardware product with photos (a cutout and
a lifestyle shot), an event, a
price announcement, a vertical social cut, a light-palette brand and a
dark-palette brand.

- `npm run eval:launch` renders all ten, runs Phase 8 scoring, and writes a
  summary with contact sheets to `output/eval/<date>/`.
- Done when every brief meets criteria 1–9. Rerun after every phase from 4
  onwards to catch regressions.

### Phase 10: Studio

- `launch` appears in the style picker and is the default for product briefs.
- The approval flow is unchanged: storyboard, render, final cut, delivery.
- Render time for a 15 s Full HD launch film is shown before the director
  starts it.

### Phase 11: Render speed

Bring launch renders from about 20 s per output second toward 5 s, without
changing what a finished frame looks like.

- **Adaptive samples:** the timeline knows where the camera moves fast. Use
  4 samples only on frames with fast motion, 1 on calm frames (most of a
  film). Frame output is identical on calm frames.
- **Parallel workers:** split the film into frame ranges across several
  browser pages or processes, then join the samples in order.
- **Draft renders:** 720p at 1 sample for previews before final approval,
  about 10× faster. Final renders stay at full quality.
- **Capture path:** keep the fast lossless PNG capture; measure whether a
  raw screencast is faster on the server.
- Tests: a draft and a final render of the same timeline share layout and
  timing; adaptive sampling changes no calm frame (hash test); a 15-second
  launch film renders within the target on the reference machine.

## Definition of done

A director types a product brief, approves the storyboard, presses Render,
and receives a film that meets criteria 1–9 without any manual fixing, in
16:9, 9:16 and 1:1, with exact copy and a beat-locked score. Criterion 10 is
the director's own sign-off on Phase 0, which anchors everything else.

## Risks

- **Taste.** Automated checks catch rule breaks, not blandness. The golden
  film and the director's review are the real quality bar.
- **Vision scoring drifts.** Keep the rubric and benchmark fixed, log scores
  per run, and compare against the eval history rather than trusting one
  number.
- **Render cost.** Blur is expensive. Budget it in Phase 5 before adding more.
- **Free-tier limits.** The review loop multiplies Gemini calls; cap rounds and
  fall back to automated QA only when quota runs out, saying so in the report.
