---
name: fold-motion
description: How SEV7N FOLD's FOLD Motion studio works, and how to change or operate it without breaking it. FOLD Motion is code-built motion design where Gemini plans the storyboard and shot layouts, deterministic code renders the frames, MP4 and QA, and a human approves each gate. Use this skill for any work in the Fold-Motion repository or on a FOLD Motion production, including briefs, storyboards, scene specs, Gemini prompts, the provider cascade and repair layer, rendering, technical or creative QA, revisions, delivery and the studio's approval flow. Use it even when the request names only a symptom or one file, such as "why did it fall back to mock", "make the storyboards better", "the headline is clipped", "add a new shape type" or "review this render".
---

# FOLD Motion

FOLD Motion is SEV7N FOLD's production system for motion design. The division
of labor is the whole idea:

- **Gemini thinks.** It writes the storyboard (concept, shots, copy, timing,
  acceptance criteria) and compiles each approved shot into a scene spec.
- **Code makes.** A deterministic renderer turns scene specs into SVG frames,
  PNGs and an H.264 MP4, then measures the result.
- **A human decides.** The director approves the storyboard, starts the
  render, approves the final cut and releases delivery.

The house rule follows from that split: *AI ingredients, deterministic
execution, human direction.* Anything that must be exact (copy, brand colors,
format, timing) is enforced by code, never left to the model.

## How a production moves

```
brief ──▶ Gemini storyboard ──▶ repair ──▶ validate ──▶ STORYBOARD_REVIEW (human)
      ──▶ Gemini scene specs ──▶ repair ──▶ buildTimeline ──▶ RENDERING (human starts)
      ──▶ render-production.mjs: SVG → PNG → MP4 → ffprobe ──▶ QA report
      ──▶ QA (human reviews) ──▶ APPROVED ──▶ DELIVERED
```

The project states are exactly `BRIEF`, `PLANNING`, `STORYBOARD_REVIEW`,
`BUILDING`, `RENDERING`, `QA`, `APPROVED`, `DELIVERED`, enforced in
`src/orchestrator/project-state.mjs`. Transitions only move forward and each
needs evidence. A revision starts a fresh project at `BRIEF` with the
director's notes appended to the brief.

## Rules that hold everywhere

1. **Plan only what the engine can render.** The engine draws `rect`,
   `circle` and `text` on a brand background, with one built-in motion style
   and hard cuts. A storyboard that promises camera moves, footage, logos as
   images or sound is a defect, because the render will not match what the
   director approved. Read [engine.md](references/engine.md) before planning
   or promising anything.
2. **Code what must be exact.** Copy, colors, format, timing and legibility
   are enforced in `src/production/repair.mjs` and checked in
   `buildTimeline`. Fix exactness in code, not by asking the model harder.
3. **Judge rendered evidence.** Look at frames or the MP4, never at source
   code or an explanation of intent. A passing encode proves the file is
   valid, not that the film is good.
4. **Keep the two QA gates separate.** Production QA (format, frames,
   duration) and creative QA (contrast, legibility, brand, story, craft) are
   different questions. Passing one never implies the other.
5. **Revise with evidence, within limits.** Every fix starts from an observed
   defect at a shot and frame, changes the smallest thing, and is verified by
   re-rendering. Two technical repair attempts per failure, three creative
   rounds per shot, two global rounds, unless the director says otherwise.
6. **Protect approved work.** Don't touch approved shots or the renderer to
   fix an unrelated problem.
7. **Never pretend.** Don't claim a render, check, tool, file or capability
   you didn't actually use. Failures stay visible: the offline fallback must
   announce itself (`provider: "mock-provider"`, `warning`, `fallbackReason`),
   never pass as AI output.

## Where to go next

Read only what the task needs.

| Task | Read |
| --- | --- |
| Anything that touches what the engine can do, files, commands or APIs | [engine.md](references/engine.md) |
| Scene specs, element rules, what repair fixes, why a shot is rejected | [scene-spec.md](references/scene-spec.md) |
| Gemini prompts, storyboard quality, the provider cascade, fallbacks, quotas | [gemini-runtime.md](references/gemini-runtime.md) |
| Stage 1: turning a brief into constraints and acceptance criteria | [stage-1-brief.md](references/stage-1-brief.md) |
| Stage 2: concept and visual direction | [stage-2-creative-direction.md](references/stage-2-creative-direction.md) |
| Stage 3: writing or reviewing a storyboard | [stage-3-storyboard.md](references/stage-3-storyboard.md) |
| Stage 4: shot layouts before render (previs), typography, composition | [stage-4-previs.md](references/stage-4-previs.md) |
| Stage 5: rendering, render failures, reproducibility | [stage-5-production.md](references/stage-5-production.md) |
| Stage 6: QA, defect reports, revisions, delivery | [stage-6-qa-and-delivery.md](references/stage-6-qa-and-delivery.md) |
| Work for SEV7N FOLD itself, or the studio UI's look | [brand-sev7n-fold.md](references/brand-sev7n-fold.md) |

The six stages match FOLD Motion's public production architecture: Brief,
Creative Direction, Storyboard, Previsualization, Production, and Quality
Assurance and Delivery.

Templates live in `templates/`: a [defect report](templates/defect-report.md),
an [example storyboard](templates/storyboard.example.json) and the matching
[acceptance spec](templates/acceptance.example.json).

## Before you finish any change

- Run `npm test`. The suite includes drift tests that fail when this skill
  and the code disagree (states, element types, QA thresholds, commands,
  templates).
- If you changed the renderer, update the "What the renderer can make"
  section of `src/ai/prompts/storyboard-director.mjs` and the capability table
  in [engine.md](references/engine.md) in the same change. Gemini plans from
  that text, so a stale description produces storyboards the engine can't
  honor.
- Say what you verified and what you couldn't.
