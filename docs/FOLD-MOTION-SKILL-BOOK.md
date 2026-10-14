# FOLD MOTION
## The Creative Production Skill Book
**Version 2.0 · October 2026**

**Product:** FOLD Motion  
**Organization:** SEV7N FOLD  
**Purpose:** Autonomous, code-first motion design and creative production  
**Core principle:** Generate what is difficult to control. Code what must be exact.

---

# 01. THE MISSION

FOLD Motion is an AI-assisted creative production system designed to turn creative briefs, product concepts, visual references, and brand assets into polished motion-design deliverables.

It is not a generic AI video generator.

It is a production environment that combines creative reasoning, deterministic animation, software-based rendering, visual inspection, targeted revision, and professional delivery.

The system must be able to:

- Understand what a client wants to communicate.
- Translate the brief into a creative direction and storyboard.
- Develop visual assets, layouts, typography, and animation using code wherever appropriate.
- Render real frames and videos using a deterministic production engine.
- Inspect the actual output instead of trusting its own description of the output.
- Identify weaknesses in storytelling, composition, typography, timing, motion, and polish.
- Make targeted improvements and verify that they work.
- Assemble the final sequence, synchronize audio where required, and validate the deliverables.
- Provide the editable source project alongside the final video.

**The objective is not merely to generate a video. It is to produce work that can survive professional creative review.**

## 1.1 What success looks like

A successful FOLD Motion project should feel deliberately art-directed, visually coherent, technically sound, and appropriate for its intended audience.

The final work should not feel like a collection of unrelated AI-generated scenes, random transitions, generic templates, or animated elements competing for attention.

Every shot must serve a purpose. Every movement must support the message. Every text element must be intentional. Every transition must help the story progress.

---

# 02. THE GOVERNING PRINCIPLES

## Principle 1: Code what must be exact

Use code-based production for elements that require precise control:

- Typography and exact wording.
- Product interfaces and dashboards.
- Logos and brand marks.
- Charts, diagrams, icons, and geometric illustrations.
- UI interactions and cursor movements.
- Precise positioning, spacing, alignment, and layout.
- Repeatable transitions and timing.
- Brand colors, design tokens, and reusable components.

Use HTML, CSS, SVG, JavaScript, animation libraries, and other suitable deterministic tools to control these elements.

Do not use image generation to reproduce a logo or interface accurately when the actual asset or a coded version is available.

## Principle 2: Generate what is difficult to control

Generative tools may be used when they offer a meaningful advantage, including:

- Complex photographic environments.
- Highly detailed organic textures.
- Difficult-to-model cinematic imagery.
- Specific atmospheric backgrounds.
- Complex visual concepts that would take disproportionate time to construct manually.

Generation is optional, not mandatory.

Before using a generative service, determine whether a coded solution, existing asset, procedural effect, or reusable component can achieve the required result.

## Principle 3: Render before judging

Code is not the final output. The rendered image is.

The system must inspect the actual rendered frames or video before declaring creative success.

A successful code execution does not prove that the composition looks good, the text is readable, or the motion feels professional.

## Principle 4: Separate technical correctness from creative quality

A video can render perfectly and still be bad.

Technical QA determines whether the production works. Creative QA determines whether the production works *as communication and design*.

Both are mandatory.

## Principle 5: Revise with evidence

Every meaningful revision should be linked to an observed defect or a specific improvement opportunity.

The system must identify what is wrong, where it occurs, why it matters, and what change is expected to fix it.

Do not rewrite an entire scene when a small adjustment can solve the problem.

## Principle 6: Protect approved work

Once a shot passes review, preserve it.

A revision to one shot should not unnecessarily damage other approved shots. Use cached renders, version control, asset hashes, and explicit approval states to protect completed work.

## Principle 7: Never pretend

Never claim to have rendered, inspected, tested, heard, or verified something unless the relevant operation actually occurred.

When a tool is unavailable, an asset is missing, or a test has not been performed, report the limitation clearly.

---

# 03. THE PRODUCTION ARCHITECTURE

FOLD Motion operates as five connected layers.

## Layer A — Creative Intelligence

**Responsibility:** Understand the brief and make creative decisions.

Tasks:

- Interpret the client's objective.
- Identify the audience, platform, format, and intended response.
- Develop the concept and visual direction.
- Plan the narrative and storyboard.
- Select suitable visual techniques.
- Define acceptance criteria.
- Evaluate rendered work and recommend revisions.

A language model can perform these tasks, but its decisions must be constrained by project data, available tools, and measurable requirements.

## Layer B — Project Orchestrator

**Responsibility:** Manage the production process.

Tasks:

- Create and maintain project files.
- Select the appropriate specialist skills.
- Track shot status and dependencies.
- Manage model calls and retries.
- Enforce revision limits and budgets.
- Determine which shots need rendering.
- Record QA findings and approval states.
- Preserve the best accepted version.

The orchestrator should use explicit states rather than relying entirely on conversational memory.

Suggested states:

`BRIEF → PLANNING → STORYBOARD_REVIEW → BUILDING → RENDERING → QA → REVISION → APPROVED → ASSEMBLY → FINAL_QA → DELIVERED`

Errors should produce an explicit failure or recovery state, not a false success.

## Layer C — Production Engine

**Responsibility:** Turn source code and assets into actual frames and video.

Potential technologies include:

- HTML, CSS, SVG, and JavaScript.
- GSAP or other suitable animation libraries.
- Playwright and Chromium for browser rendering and screenshots.
- Canvas for particle systems and high-volume 2D animation.
- WebGL or Three.js for suitable 3D scenes.
- Blender for more demanding 3D production.
- FFmpeg for encoding, assembly, audio, and video processing.
- FFprobe for inspecting video metadata.

The implementation must test which tools work in the actual target environment before treating them as available.

The system should begin with a modest, reliable production stack and add complexity only when justified.

## Layer D — Quality Assurance

**Responsibility:** Gather evidence about the output.

This layer inspects:

- Rendered frames.
- Scene boundaries.
- Video duration and frame rate.
- Text layout and readability.
- Image dimensions and encoding.
- Animation continuity.
- Audio synchronization and levels, when applicable.
- Black frames, frozen sequences, missing assets, and other technical defects.

It supplies the evidence used by the creative critic.

## Layer E — Delivery

**Responsibility:** Produce a clean, reproducible handoff.

A completed project should contain:

- Final exported video.
- Editable source project.
- Required fonts, assets, and asset references, subject to licensing.
- Project configuration and timeline.
- QA report.
- Known limitations, if any.

The final export and the editable project must correspond to the same accepted version.

---

# 04. THE CREATIVE BRIEF COMPILER

Before producing a shot, convert the brief into a structured specification.

Do not immediately jump from a vague prompt to animation code.

## 4.1 Extract the essentials

Identify:

1. **Objective:** What must the video achieve?
2. **Audience:** Who is watching?
3. **Message:** What must they understand or remember?
4. **Platform:** Where will the video appear?
5. **Duration:** How long should it run?
6. **Format:** Aspect ratio, resolution, frame rate, and delivery format.
7. **Brand:** Colors, typography, logos, tone, and prohibited styles.
8. **References:** What should be borrowed, adapted, or avoided?
9. **Assets:** What files are supplied and what is missing?
10. **Acceptance criteria:** What must be true for the client to approve the result?

If an important ambiguity could substantially change the production, ask a focused clarification question. Otherwise, make a reasonable assumption and record it.

## 4.2 Separate hard constraints from creative preferences

**Hard constraints** include:

- Exact product names and wording.
- Required logos and disclaimers.
- Video dimensions and duration limits.
- Brand colors that must be respected.
- Required scenes or calls to action.
- Platform delivery specifications.

**Creative preferences** include:

- Cinematic atmosphere.
- Premium feel.
- Suspenseful pacing.
- Minimalist composition.
- Smooth transitions.
- Particular references or stylistic influences.

Hard constraints must not be sacrificed to improve subjective style.

## 4.3 Create an acceptance specification

Every project should generate a structured acceptance document, such as `acceptance.yaml`.

It should describe:

- Mandatory content.
- Forbidden content.
- Visual direction.
- Text and logo requirements.
- Technical export requirements.
- Shot-level success criteria.
- Overall creative quality criteria.

Acceptance criteria should be specific enough to guide production and inspection.

Example:

- The product name must match the supplied spelling exactly.
- The primary headline must remain inside the defined safe area.
- The CTA must be readable in the final-resolution render.
- The ending must provide enough time for the viewer to process the message.
- No scene may contain an unintended blank frame or abrupt visual discontinuity.

---

# 05. STORYBOARD AND ART DIRECTION

The storyboard is the bridge between the brief and the production code.

Every shot needs a reason to exist.

## 5.1 Required shot specification

Each shot should define:

- Unique shot ID.
- Duration.
- Narrative purpose.
- Main visual.
- Composition.
- Camera behavior, if applicable.
- Typography and exact text.
- Motion behavior.
- Transition in and out.
- Sound or music cues.
- Required assets.
- Acceptance criteria.

The storyboard should describe the viewer's experience, not merely list objects that appear on screen.

Weak direction:

“Show a phone with an animated dashboard.”

Stronger direction:

“Begin with a restrained close-up of the phone in negative space. Bring the dashboard into focus as a single key metric rises. Let supporting interface elements enter sequentially, keeping the headline dominant. Transition out through a deliberate camera push that carries visual momentum into the next shot.”

The stronger direction establishes hierarchy, timing, and narrative intent.

## 5.2 Design before animating

For projects where style matters, establish representative style frames before building the full animation.

Review:

- Composition.
- Color.
- Typography.
- Lighting and depth.
- Product accuracy.
- Visual hierarchy.
- Relationship to the reference.

Where practical, use an explicit approval gate before proceeding into expensive or time-consuming animation.

Do not compensate for weak art direction with more movement.

---

# 06. THE DETERMINISTIC ANIMATION CONTRACT

This is one of the most important technical requirements in FOLD Motion.

**Given the same scene code, assets, configuration, and timestamp, the renderer should produce the same visual state.**

A scene must be renderable at an arbitrary timestamp without depending on how many frames were previously played.

## 6.1 The seek contract

Each scene should expose a consistent interface:

- `meta`: scene metadata and requirements.
- `mount`: initialize the scene and load its assets.
- `seek(tLocalSeconds)`: set the complete visual state for a specific time.

Conceptually:

`seek(2.5)` must produce the correct state at 2.5 seconds even if the renderer never visited 2.4 seconds.

Use paused timelines, explicit animation progress, and controlled state updates where possible.

Avoid relying on:

- Uncontrolled wall-clock timing.
- Random values that change between renders.
- Unpaused CSS animations that cannot be reliably synchronized.
- Accumulated updates that depend on playback history.
- Asset loading that has not completed before capture.

If randomness is required, use a deterministic seed.

Wait for required fonts and images to load. Fix the render viewport, device-pixel ratio, and other relevant rendering settings.

Use a single canonical timeline and derive timestamps from frame indices to avoid accumulated timing drift.

## 6.2 Why this matters

Determinism enables:

- Reproducible rendering.
- Reliable screenshot capture.
- Frame-accurate revisions.
- Consistent scene assembly.
- Automated visual regression testing.
- Efficient caching.
- Easier debugging.

Without determinism, the system cannot reliably compare the old version of a scene with the revised version.

---

# 07. VISUAL INSPECTION AND CREATIVE QA

FOLD Motion must have two independent quality gates.

## Gate A — Production QA

This asks: **Did the production render correctly?**

Check:

- Did the renderer complete successfully?
- Is the output file present and readable?
- Are duration, resolution, frame rate, and codec correct?
- Are there missing or broken assets?
- Are there browser errors or failed resource loads?
- Are there black frames, frozen sections, or unexpected gaps?
- Are scene boundaries continuous?
- Is audio present and synchronized when required?

Automate deterministic checks whenever possible.

## Gate B — Creative QA

This asks: **Is the result actually good?**

Review the rendered work against:

| Dimension | Review question |
|---|---|
| Brief fidelity | Does the work communicate the intended message? |
| Storytelling | Does every shot advance the narrative? |
| Composition | Is the hierarchy clear and deliberate? |
| Typography | Is text accurate, readable, and well placed? |
| Motion | Does movement feel controlled, intentional, and coherent? |
| Timing | Does the sequence breathe, build, and resolve appropriately? |
| Transitions | Do shots connect naturally? |
| Brand fidelity | Does the work respect the visual identity? |
| Craft | Does the output feel finished rather than template-like? |
| Distinctiveness | Does it have a recognizable creative idea? |

The critic should receive the brief, acceptance criteria, reference material, and actual rendered evidence.

Where possible, the critic should not see the creator's explanation of why the scene is good. This reduces the risk of judging the intention rather than the result.

## 7.1 Inspect the actual frames

The system should capture:

- Representative frames from each shot.
- Opening and closing frames.
- Frames around transitions.
- Frames where text appears or changes.
- Frames at moments of peak visual complexity.
- Frames around detected technical anomalies.

A contact sheet is useful for reviewing the overall sequence, but it is not a substitute for inspecting important moments at full resolution.

For motion-heavy work, inspect additional frames around rapid changes. A single attractive screenshot cannot establish that an animation is smooth.

## 7.2 Diagnose defects with evidence

Every defect report should contain:

- Shot ID.
- Approximate timestamp or frame.
- Severity.
- Observed problem.
- Why it matters.
- Proposed correction.
- Expected outcome.
- Verification method.

Example:

**Shot:** `S03`

**Observation:** The headline overlaps the product interface at approximately 2.4 seconds.

**Severity:** Major.

**Correction:** Move the interface group down and reduce its scale slightly during the headline entrance.

**Verification:** Re-render the affected interval and confirm that the headline remains unobstructed.

The system must not report visual defects that it has not observed or that are not supported by the available evidence.

---

# 08. THE SELF-CORRECTION LOOP

The production loop is the core of FOLD Motion.

1. Create the scene.
2. Run technical checks.
3. Render the scene.
4. Capture visual evidence.
5. Evaluate the evidence against acceptance criteria.
6. Identify the highest-impact defect.
7. Apply a targeted revision.
8. Re-render the affected scene.
9. Compare the new result with the previous version.
10. Keep the revision only if it fixes the defect without introducing a more serious problem.

The system should maintain a record of each revision.

## 8.1 Revision priorities

Fix issues in this order:

1. Broken or missing output.
2. Violations of hard constraints.
3. Incorrect product information or text.
4. Major composition and readability problems.
5. Storytelling and pacing issues.
6. Motion and transition defects.
7. Fine visual polish.

Do not spend time polishing a transition while the main headline is unreadable.

## 8.2 Bounded iteration

Default limits for the initial system:

- Up to two targeted technical repair attempts per failure.
- Up to three creative revision rounds per shot.
- Up to two global revision rounds for the assembled sequence.

These are initial safeguards, not universal laws. Projects can override them explicitly.

If the same failure occurs twice, stop repeating the same action and diagnose the underlying cause.

At the iteration limit:

- Preserve the best valid version.
- Document unresolved defects.
- Report the current quality status.
- Request human review when necessary.

Never hide a failed check to make the project appear complete.

## 8.3 Protect quality improvements

A revision should not be accepted simply because it is different.

Compare it against the previous version and the original defect. Where possible, use frame comparisons and automated metrics alongside creative review.

If the new version introduces worse readability, timing, continuity, or composition, revert to the previous accepted version.

---

# 09. SPECIALIST SKILLS

FOLD Motion should use a compact master skill and a collection of specialist skills.

The master skill defines the operating rules. Specialists provide focused instructions for individual production tasks.

Recommended specialists:

### 09.1 Brief-to-Criteria

Turns a client brief into structured requirements, assumptions, risks, and acceptance criteria.

### 09.2 Creative Director

Develops the concept, visual language, narrative arc, pacing, and differentiation.

### 09.3 Storyboard Architect

Breaks the concept into shots with clear narrative functions, timing, transitions, and visual priorities.

### 09.4 Typography and Layout

Builds accurate, readable, responsive text compositions and product interfaces.

### 09.5 SVG Illustration

Creates controlled vector graphics, diagrams, icons, and illustrated scenes.

### 09.6 Motion Engineer

Implements animation timelines, easing, transforms, transitions, and deterministic scene behavior.

### 09.7 Product Animation

Builds interface reveals, product interactions, feature demonstrations, and data-driven motion.

### 09.8 Render Engineer

Handles browser setup, scene initialization, frame capture, encoding, and reproducibility.

### 09.9 Visual Critic

Inspects rendered evidence and identifies specific creative defects.

### 09.10 Motion Critic

Evaluates timing, rhythm, continuity, easing, transition quality, and motion hierarchy.

### 09.11 Revision Engineer

Converts QA findings into small, controlled, testable changes.

### 09.12 Audio and Assembly

Coordinates sound design, music, voice-over timing, scene assembly, and final encoding.

### 09.13 Delivery and Verification

Checks the final output, source project, export specifications, and delivery report.

## 9.14 Skill selection

The orchestrator should select specialists according to the task rather than loading every instruction for every request.

For example:

- A typography defect invokes Typography and Layout plus Revision Engineer.
- A browser rendering failure invokes Render Engineer.
- A weak narrative invokes Creative Director and Storyboard Architect.
- A transition discontinuity invokes Motion Critic and Revision Engineer.

Specialist instructions must be stored as real project files and versioned. Their existence must not be assumed until implementation is verified.

---

# 10. MULTI-SHOT VIDEO PRODUCTION

FOLD Motion must support videos from approximately 20 to 60 seconds and beyond without treating every frame as a separate AI generation request.

## 10.1 Understand frames and keyframes

At 30 frames per second:

- A 20-second video contains 600 frames.
- A 30-second video contains 900 frames.
- A 60-second video contains 1,800 frames.

These frames are rendered by the production engine.

A keyframe specifies a property at a particular time, such as an object's position, scale, opacity, or rotation. The animation engine interpolates between keyframes according to the chosen easing and timing.

The language model generally writes or modifies the scene logic. It does not need to generate every frame individually.

## 10.2 One timeline, multiple scenes

Every multi-shot project should use a shared `timeline.json` or equivalent structured timeline as its source of truth.

It should define:

- Shot IDs.
- Shot order.
- Start times.
- Durations.
- Transition durations.
- Audio cues.
- Dependencies.
- Export settings.

Each shot can be developed and rendered independently where appropriate, then assembled according to the timeline.

## 10.3 Render only what changed

Use caching to avoid rerendering approved work unnecessarily.

A shot's cache identity should account for relevant inputs, including:

- Source code.
- Parameters and design tokens.
- Assets.
- Fonts.
- Renderer version.
- Resolution.
- Frame rate.
- Relevant dependencies.

If a shot changes, re-render that shot and any affected transitions or dependent segments.

If its duration changes, update the timeline and check neighboring shots and audio synchronization.

## 10.4 Choose the correct rendering method

Use:

- **SVG** for controlled vector illustration.
- **HTML/CSS** for typography, layouts, and interface animation.
- **GSAP or equivalent** for precise timelines.
- **Canvas** for large numbers of 2D elements.
- **WebGL/Three.js** for appropriate real-time 3D scenes.
- **Blender** for more demanding 3D work.
- **FFmpeg** for assembly, encoding, and supported audio/video processing.

Do not force every visual problem into the same technology.

Start with the simplest approach that satisfies the creative brief and quality requirements.

---

# 11. MODEL AND TOOL STRATEGY

FOLD Motion must be model-provider independent.

Gemini may serve as the initial creative and coding model, but the system should not be architected around the assumption that one provider will always be available or optimal.

## 11.1 Language models should handle

- Brief interpretation.
- Creative concepts and storyboards.
- Scene code generation.
- Code diagnosis.
- Visual critique based on supplied evidence.
- Targeted revisions.
- Explanations of unresolved issues.

## 11.2 Deterministic tools should handle

- Rendering.
- Screenshots and frame extraction.
- Video encoding.
- Metadata validation.
- File checks and hashes.
- Caching.
- Browser console inspection.
- Frame comparisons.
- Repeatable layout and accessibility checks where supported.

Whenever a task can be verified reliably by software, prefer a deterministic test over a language model's unsupported assertion.

## 11.3 Model routing

Use the strongest available model for decisions where creative judgment has high impact, such as concept development and final creative review.

Use cheaper or faster models for suitable mechanical tasks, such as boilerplate, simple code repairs, and routine classification.

Do not assume that the cheapest model can reliably perform every creative role.

## 11.4 Provider abstraction

Implement a model gateway so that provider-specific behavior is isolated from the production engine.

The gateway should support, as applicable:

- Provider and model selection.
- Structured outputs.
- Timeouts.
- Retry policies.
- Rate-limit handling.
- Token usage tracking.
- Cost accounting.
- Error reporting.
- Provider-specific capability checks.

Do not hard-code unverified model names, free quotas, or pricing into the core production logic.

Before integration, test the actual API key, endpoint, model ID, quota, and output behavior.

---

# 12. COST AND RESOURCE CONTROL

The system must remain usable on a modest Windows computer.

It should not require a large local model or a powerful GPU for the initial version.

## 12.1 Start with low-cost production

- Use local deterministic rendering whenever feasible.
- Render previews at reduced resolution.
- Render only changed shots.
- Reuse existing assets.
- Cache approved results.
- Limit unnecessary model calls.
- Reserve high-cost generative tools for tasks where they materially improve the output.
- Render the final export at the required delivery settings.

A low-resolution preview is useful for composition and timing, but it does not prove that final-resolution text, fine details, or compression will look correct.

## 12.2 Budget safeguards

Each project should have a configurable budget ledger recording:

- Model calls.
- Token usage where available.
- Estimated or actual cost.
- Generative media requests.
- Purpose of each call.
- Shot or task associated with the expense.

Recommended initial controls:

- Warning at 70% of the project budget.
- Stop new optional spending at 100%.
- Allow explicitly authorized exceptions.
- Do not retry identical failures indefinitely.
- Preserve work before a budget stop.

Use verified provider pricing when calculating actual cost. Pricing and free-tier quotas can change, so previous estimates must not be treated as permanent guarantees.

---

# 13. PROJECT STRUCTURE AND STATE

The implementation should separate reusable platform code from individual creative projects.

Suggested structure:

```text
fold-motion/
├── apps/
│   └── studio/
├── packages/
│   ├── orchestrator/
│   ├── model-gateway/
│   ├── renderer/
│   ├── qa/
│   ├── schemas/
│   ├── runtime/
│   └── components/
├── skills/
│   ├── master/
│   ├── creative-director/
│   ├── storyboard/
│   ├── typography/
│   ├── motion-engineer/
│   ├── render-engineer/
│   ├── visual-critic/
│   └── delivery/
├── projects/
│   └── example-project/
│       ├── brief.yaml
│       ├── acceptance.yaml
│       ├── storyboard.json
│       ├── timeline.json
│       ├── design-tokens.json
│       ├── assets/
│       ├── shots/
│       ├── cache/
│       ├── renders/
│       ├── qa/
│       ├── critiques/
│       ├── ledger.json
│       └── report.md
└── tests/
```

This is a proposed architecture, not a claim that these directories already exist.

The exact structure may evolve during implementation, but project files, rendering, QA, and model integration must remain logically separated.

Each project should preserve enough information to reproduce an accepted render.

---

# 14. THE HUMAN APPROVAL GATES

Autonomy should not mean removing human judgment from every important decision.

The initial system should support three meaningful approval gates.

### Gate 1 — Storyboard

The human approves the concept, message, narrative, and shot sequence.

### Gate 2 — Style frames

The human approves the visual language, typography, composition, and art direction before the system invests in the full sequence.

### Gate 3 — Final cut

The human reviews the assembled video before delivery, especially for high-value client work.

Over time, routine work may use configurable automation rules. Human review should remain available whenever confidence is low, the brief is ambiguous, the output is expensive to revise, or the consequences of an error are significant.

---

# 15. THE BUILD ROADMAP

Build the smallest system that proves the complete production loop before building a large interface.

## Phase 1 — Single-scene rendering

Build one scene from code and render it reliably.

Requirements:

- A scene contract.
- Deterministic time seeking.
- A fixed rendering environment.
- Frame capture.
- Valid video output.
- Repeatable execution.

**Exit condition:** The same project can be rendered repeatedly without uncontrolled timing changes.

## Phase 2 — Automated technical QA

Add:

- Metadata checks.
- Browser error collection.
- Missing-asset detection.
- Frame extraction.
- Black-frame and freeze detection where practical.
- A basic QA report.

**Exit condition:** The system can distinguish a successful render from a broken or incomplete one.

## Phase 3 — Model integration

Connect the initial model through a provider gateway.

Allow it to:

- Read the brief.
- Create scene code.
- Diagnose errors.
- Produce structured critique.
- Suggest targeted revisions.

**Exit condition:** The system can generate and revise a scene without losing track of project requirements.

## Phase 4 — Visual critique and correction

Add rendered-frame inspection, a structured critic, revision limits, and version comparison.

**Exit condition:** The system can identify a supported visual defect, attempt a correction, and verify the new render.

## Phase 5 — Multi-shot production

Add a timeline, shot dependencies, reusable components, caching, transitions, and assembly.

**Exit condition:** A multi-shot video can be produced without rebuilding every shot after each revision.

## Phase 6 — Audio and advanced visuals

Add audio synchronization, sound design workflows, more complex 3D, and optional generative assets as needed.

**Exit condition:** The engine supports the real requirements of target client projects.

## Phase 7 — Studio interface

Build the user-facing Studio after the underlying production loop is dependable.

The interface can then expose:

- Project creation.
- Brief input.
- Storyboard review.
- Shot previews.
- QA findings.
- Revision history.
- Budget tracking.
- Export and delivery status.

**Do not build a beautiful dashboard around an unreliable engine.**

## Phase 8 — Evaluation and calibration

Create a test library of representative scenes and compare system judgments with human creative reviews.

Calibrate the critic against actual examples. Track recurring failures and improve specialist skills accordingly.

A useful system should improve through documented evaluations, not merely through longer prompts.

---

# 16. THE DEFINITION OF DONE

A FOLD Motion project is complete only when it passes the applicable technical and creative gates.

## Technical completion

- [ ] Final video exists and can be opened.
- [ ] Duration and export settings meet the brief.
- [ ] Required assets are present.
- [ ] No known critical rendering errors remain.
- [ ] Audio is checked when applicable.
- [ ] The final export corresponds to the approved project version.

## Creative completion

- [ ] The brief's essential requirements are satisfied.
- [ ] Text and product details are accurate.
- [ ] Typography is readable at the intended delivery size.
- [ ] Composition and visual hierarchy are intentional.
- [ ] Motion and transitions support the message.
- [ ] The sequence has a coherent beginning, development, and ending.
- [ ] The rendered work has been inspected using appropriate evidence.
- [ ] Major defects have been corrected or explicitly disclosed.

## Delivery completion

- [ ] Editable source files are included.
- [ ] Necessary assets and dependencies are documented.
- [ ] The final render and source project are aligned.
- [ ] A QA report is available.
- [ ] Any unresolved limitations are disclosed.

Passing automated tests alone is insufficient for creative approval.

---

# 17. THE FINAL OPERATING DIRECTIVE

FOLD Motion must behave like a disciplined creative production team, not an AI that generates something once and calls it finished.

It should think like a creative director, plan like a motion designer, build like an engineer, render like a production system, inspect like a quality-assurance specialist, and revise like an editor.

It must distinguish between what it intends to create and what it has actually produced.

It must protect approved work, control costs, use tools that are genuinely available, and report failures honestly.

It should prioritize clarity over unnecessary complexity, evidence over assumptions, and deliberate craft over visual noise.

The goal is not maximum automation at any cost.

The goal is **reliable creative autonomy**: a system that can produce increasingly sophisticated motion work while remaining controllable, inspectable, reproducible, and commercially useful.

**FOLD Motion — Make the idea move. Make the details exact. Make the final work count.**
