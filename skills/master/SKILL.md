# FOLD Motion Master Skill

## Purpose and authority

Use this skill to coordinate code-first motion production according to the
FOLD Motion v2.0 Creative Production Skill Book at
`docs/FOLD-MOTION-SKILL-BOOK.md`. That book is the canonical source for the
production principles, gates, limits, and specialist responsibilities. Do not
replace its requirements with a generic video workflow.

The master skill defines operating rules; specialist skills provide focused
instructions. Load only the specialists needed for the current task. Their
files are versioned project instructions, not proof that a runtime loader,
model gateway, or automated orchestrator exists.

## Governing rules

- Code what must be exact: wording, logos, interfaces, diagrams, layout, and
  repeatable timing.
- Generate imagery only when it materially helps with content that is difficult
  to control deterministically; generation is optional.
- Judge rendered evidence, not source code or an explanation of intent.
- Keep technical QA and creative QA as separate, mandatory gates.
- Tie revisions to observed defects and verify the affected output.
- Protect approved work; avoid unrelated edits and preserve the best valid
  version when a correction fails.
- Never claim a render, inspection, test, asset, tool, or capability that was
  not actually available and used.
- Prefer the simplest reliable production method. Validate tools in the target
  environment before relying on them.

## Production workflow

1. **Compile the brief.** Identify objective, audience, message, platform,
   duration, format, brand, references, assets, and acceptance criteria.
   Separate hard constraints from preferences. Ask a focused question when an
   ambiguity could materially change production; otherwise record a reasonable
   assumption.
2. **Plan the creative.** Develop the concept and visual language, then a
   storyboard in which every shot has a narrative purpose and explicit
   acceptance criteria. Seek approval at the storyboard and style-frame gates
   where applicable.
3. **Build exact elements with code.** Define a scene contract and implement
   controlled typography, layout, illustration, product behavior, and motion.
   Use the least complex suitable rendering method.
4. **Render reproducibly.** A scene must expose metadata, initialization, and a
   `seek(tLocalSeconds)`-equivalent operation that sets the complete state for
   an arbitrary timestamp. Derive frame times from frame indices and a
   canonical timeline. Control fonts, assets, viewport, device-pixel ratio,
   and renderer settings. Seed any required randomness.
5. **Run two QA gates.** Production QA verifies files, metadata, assets, errors,
   continuity, and audio when applicable. Creative QA evaluates brief fidelity,
   storytelling, composition, typography, motion, timing, transitions, brand,
   craft, and distinctiveness against the actual rendered evidence.
6. **Correct with evidence.** Record the shot, timestamp/frame, severity,
   observation, impact, proposed change, expected result, and verification
   method. Fix the highest-priority defect first. Limit technical repair to two
   attempts per failure, creative revisions to three rounds per shot, and
   global revisions to two rounds unless a project explicitly overrides these
   initial limits. Stop repeating the same failed action.
7. **Assemble and deliver.** Keep one timeline as the source of truth for
   multi-shot work. Re-render only changed shots and affected dependents when
   cache inputs permit. Confirm the export matches the accepted editable
   project; include source, assets/references, configuration, QA report, and
   known limitations.

Use explicit project states such as `BRIEF`, `PLANNING`,
`STORYBOARD_REVIEW`, `BUILDING`, `RENDERING`, `QA`, `REVISION`, `APPROVED`,
`ASSEMBLY`, `FINAL_QA`, and `DELIVERED`. A failure must remain an explicit
failure or recovery state, never a success-shaped fallback.

## Specialist routing

Select the smallest useful group and pass each specialist its inputs, relevant
constraints, and requested output:

- [Brief-to-Criteria](../brief-to-criteria/SKILL.md): new or materially changed
  brief; clarify scope and create acceptance criteria.
- [Creative Director](../creative-director/SKILL.md): concept, visual
  language, narrative, pacing, or differentiation is needed.
- [Storyboard Architect](../storyboard-architect/SKILL.md): convert an
  approved concept into timed, reviewable shots.
- [Typography and Layout](../typography-and-layout/SKILL.md): text accuracy,
  hierarchy, safe areas, layout, or interface legibility.
- [SVG Illustration](../svg-illustration/SKILL.md): controlled vector
  graphics, diagrams, icons, or illustrated scenes.
- [Motion Engineer](../motion-engineer/SKILL.md): deterministic timelines,
  easing, transitions, and arbitrary-time scene state.
- [Product Animation](../product-animation/SKILL.md): interface reveals,
  product interactions, feature demonstrations, and data-driven motion.
- [Render Engineer](../render-engineer/SKILL.md): browser/runtime setup, frame
  capture, encoding, reproducibility, or a production-render failure.
- [Visual Critic](../visual-critic/SKILL.md): inspect rendered evidence for
  composition, legibility, fidelity, and craft defects.
- [Motion Critic](../motion-critic/SKILL.md): inspect temporal behavior,
  rhythm, easing, continuity, and transitions.
- [Revision Engineer](../revision-engineer/SKILL.md): turn an evidenced,
  prioritized finding into a small, verifiable change.
- [Audio and Assembly](../audio-and-assembly/SKILL.md): audio cues,
  synchronization, multi-shot assembly, and final encoding.
- [Delivery and Verification](../delivery-and-verification/SKILL.md): final
  source/export correspondence, deliverable checks, and handoff.

Examples: typography defects route to Typography and Layout plus Revision
Engineer; render failures route to Render Engineer; weak narrative routes to
Creative Director plus Storyboard Architect; transition discontinuities route
to Motion Critic plus Revision Engineer. Use additional specialists only when
the evidence or task requires them.

## Capability boundary

Instructions do not install tools or implement the production orchestrator.
Check the repository and current environment before promising browser capture,
model calls, generated assets, automated visual critique, caching, audio work,
or multi-shot support. The current deterministic scene renderer is the
authoritative production foundation; preserve it unless a task explicitly
requires a change and that change is validated.

## Approval and completion

Support human review at storyboard, style-frame, and final-cut gates. Keep
review available when confidence is low, the brief is ambiguous, revisions are
expensive, or consequences are significant.

Do not declare completion from passing code tests alone. Complete the applicable
technical, creative, and delivery checks in the skill book. Disclose every
unresolved defect and unavailable verification step.
