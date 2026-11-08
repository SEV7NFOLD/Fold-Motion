# Stage 3: Storyboard

The storyboard is the plan the director approves, and the plan the render must
honor. In production, Gemini writes it; you may review it, improve the prompt
that writes it, or write one by hand.

## Shape

Required (enforced by `validateStoryboard`): `id`, `title`, `audience`,
`platform`, `narrativeConcept`, `creativeDirection`, `shots`,
`hardConstraints`, `acceptanceCriteria.technical`,
`acceptanceCriteria.creative`. Every shot needs a unique `id`, a positive
`durationSeconds`, `purpose`, `onScreenCopy`, `mainVisual`, `composition`,
`cameraBehavior`, `motionBehavior`, `transitionIn`, `transitionOut` and
non-empty `acceptanceCriteria`. `soundCue` is optional and has no effect
today. See [the example](../templates/storyboard.example.json).

`createCreativePlan` overrides two fields after generation: the first shot's
`onScreenCopy` becomes the supplied headline, and the last shot's becomes the
supplied subheadline.

## What makes it strong

- 2 to 4 shots, each with one job: hook, message, resolution.
- Short copy: ideally under 28 characters per shot, never over 40. Shorter
  copy renders larger.
- Reading time: at least 2 seconds per shot, plus about half a second per
  word beyond three.
- Durations that add up close to the requested total.
- Camera, motion and transitions described with the motion vocabulary in
  [engine.md](engine.md): "Slow push-in; the headline types on, then holds."
  "Cut to the next shot."
- Motion that expresses the concept, varied between shots for rhythm, with
  one atmosphere across the film or a deliberate change.
- Acceptance criteria a reviewer can check on frames.

## Review checklist for the storyboard gate

Flag each of these before recommending approval:

- Promises the engine can't keep: camera moves outside the vocabulary
  (dolly, orbit, handheld, 3D; push-in, pull-out and drifts are fine),
  footage, generated product photography (only uploaded product photos and
  logos can appear), voiceover or licensed music (FOLD Score composes the
  soundtrack from the edit), crossfades.
- Every shot using the same motion, which makes the film feel templated.
- Copy longer than 40 characters, or supplied copy altered in any way.
- Durations that don't add up to the target, or shots under 2 seconds with
  more than three words.
- Shots without a distinct purpose, or two shots doing the same job.
- Vague acceptance criteria ("looks premium", "feels cinematic").
- Invented product facts or claims.

When a pattern recurs across productions, fix it in
`src/ai/prompts/storyboard-director.mjs` rather than correcting each
storyboard by hand (see [gemini-runtime.md](gemini-runtime.md)).
