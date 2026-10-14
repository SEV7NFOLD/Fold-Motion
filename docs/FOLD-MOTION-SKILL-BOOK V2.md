# FOLD Motion — The Creative Production Skill Book

**Version 2.0 · October 2026**  
**Status:** Canonical production specification  
**Repository destination:** `docs/FOLD-MOTION-SKILL-BOOK.md`

---

## 1. Mission

FOLD Motion is a code-first autonomous motion design production system. It is not a generic text-to-video generator.

Its purpose is to turn a creative brief into commercially useful motion work through a controlled, inspectable, reproducible production loop:

**Brief → Creative direction → Storyboard and acceptance criteria → Editable scene implementation → Deterministic render → Evidence-based inspection → Targeted revision → Re-render and verification → Assembly → Delivery**

The system should produce premium commercial motion design, including:

- Fintech, SaaS, and software-interface product animation
- Cinematic product reveals and brand films
- Typography-led motion design
- Social advertisements and short-form campaigns
- Explainer sequences and product demonstrations
- Multi-shot campaigns with consistent visual language

The system must prioritize exactness where exactness matters: wording, logos, UI, data, layout, product details, timing, and brand constraints. Generative imagery may be used when it materially improves elements that are difficult to control deterministically, but generation is optional rather than the default production method.

### Governing production principle

> **Generate what is difficult to control. Code what must be exact. Inspect what you produce. Improve only what needs improving.**

The final artifact—not a prompt, source file, storyboard, or claim—is the evidence of the work.

---

## 2. Governing principles

1. **Exactness by construction.** Code or otherwise deterministically construct exact text, logos, interfaces, diagrams, data, layouts, and repeatable timing.
2. **Generation is selective.** Use generated imagery or other probabilistic assets only when they materially help and can be evaluated against the brief.
3. **Render before judging.** Do not infer the final appearance from source code or a description of intent. Inspect actual rendered frames and video.
4. **Separate the two QA gates.** Technical correctness does not establish creative quality, and creative appeal does not excuse a broken export.
5. **Use evidence to revise.** Each revision must address an observed defect or a clearly documented acceptance-criteria failure.
6. **Protect approved work.** Preserve the last valid version, avoid unrelated edits, and do not overwrite a known-good output with an unverified correction.
7. **Reproducibility is a production requirement.** Scene state should be derivable from an explicit time or frame index, with controlled assets, fonts, dimensions, renderer settings, and randomness.
8. **Prefer simple, reliable methods.** Use the least complex toolchain that satisfies the production requirements.
9. **Be honest about capability.** Never claim a tool was used, a frame was inspected, a render succeeded, or a feature exists unless that is true in the current environment.
10. **Human review is part of the system.** Keep approval gates for decisions that materially affect creative direction, brand interpretation, cost, or final acceptance.
11. **Bound retries and spend.** Avoid loops that repeat the same failed action. Enforce revision limits and project budgets.
12. **Deliver the work, not just the video.** Preserve the source project, required assets and references, configuration, QA evidence, and known limitations.

---

## 3. System architecture: five layers

FOLD Motion is organized into five logical layers. These layers describe responsibilities; their existence in this specification does not mean every layer is already implemented in code.

### 3.1 Creative Intelligence

Responsible for understanding the brief and developing the creative plan.

Responsibilities:

- Parse the objective, audience, message, platform, format, duration, brand, references, and constraints.
- Separate hard requirements from preferences.
- Identify missing information and ask focused questions only when ambiguity could materially change the result.
- Develop concepts, visual language, narrative structure, pacing, and differentiation.
- Produce a storyboard, style-frame direction, and acceptance criteria.
- Identify which details must be deterministic and which assets may benefit from generation.
- Explain creative trade-offs and assumptions.

### 3.2 Project Orchestrator

Responsible for controlling the workflow and project state.

Responsibilities:

- Track the current project state and valid next transitions.
- Route tasks to the smallest useful set of specialists.
- Pass each specialist the relevant brief, assets, constraints, acceptance criteria, and requested output.
- Enforce review gates, dependency order, retry limits, and budget limits.
- Track versions, approvals, unresolved defects, and decisions.
- Keep failures explicit; never convert a failed step into a success-shaped fallback.
- Coordinate production, QA, revision, assembly, and delivery.

The orchestration workflow may initially be manual. Markdown instructions are not an executable orchestrator.

### 3.3 Production Engine

Responsible for constructing and rendering scenes.

Responsibilities:

- Build exact visual elements using suitable code-based tools.
- Support deterministic scene state and arbitrary-time seeking.
- Render reproducible frames and encoded video.
- Keep source scenes editable and structured.
- Support multi-shot timelines, reusable components, caching, and dependency-aware re-rendering as those capabilities are implemented.
- Integrate generated assets selectively through a provider abstraction rather than hard-coding one vendor.
- Keep rendering behavior explicit and testable.

### 3.4 Quality Assurance

Responsible for technical verification and creative evaluation.

It has two separate gates:

- **Production QA:** Does the artifact render and export correctly, with expected files, dimensions, timing, assets, encoding, continuity, and audio where applicable?
- **Creative QA:** Does the rendered work satisfy the brief and meet the expected standards for narrative, composition, typography, timing, motion, brand fidelity, craft, and distinctiveness?

QA findings must cite evidence from the actual output. Automated metrics can help but do not replace visual or temporal judgment where human or model inspection is required.

### 3.5 Delivery

Responsible for assembling, verifying, and handing off the accepted work.

Responsibilities:

- Assemble approved shots and audio against one source-of-truth timeline.
- Verify the final export and its correspondence with the accepted project.
- Include editable source, necessary assets/references, configuration, QA report, and known limitations.
- Confirm format, dimensions, frame rate, duration, codec, audio requirements, and destination requirements.
- Report any checks that were unavailable or remain incomplete.

---

## 4. Brief compiler and acceptance criteria

Every project begins with a structured brief.

### 4.1 Required brief fields

Capture, when applicable:

- Project name and objective
- Target audience and intended response
- Core message and call to action
- Platform and placement
- Deliverable format, aspect ratio, resolution, and frame rate
- Target duration and any timing restrictions
- Brand identity, logo files, fonts, colors, and brand rules
- Product facts, UI references, copy, data, and approved wording
- Visual references and explicit anti-references
- Available assets and asset rights/usage constraints
- Audio, voice, music, and sound-effect requirements
- Deadline, budget, and review schedule
- Approval owner and final acceptance conditions

### 4.2 Hard constraints versus preferences

Record hard constraints separately from preferences.

Examples of hard constraints include exact copy, correct logo, required legal text, correct product behavior, output format, brand colors, prohibited claims, and maximum duration.

Preferences include mood, pacing, stylistic references, and optional visual flourishes unless the brief makes them mandatory.

Never silently trade away a hard constraint to satisfy a stylistic preference.

### 4.3 Clarification and assumptions

Ask a focused question when an unresolved ambiguity could materially change the creative direction, technical implementation, budget, or deliverable. Otherwise, record a reasonable assumption and continue.

Do not block production on details that can safely be decided later.

### 4.4 Acceptance file

Create an `acceptance.yaml` or equivalent structured acceptance record for each project. It should include:

- Deliverable and technical specifications
- Hard constraints
- Creative goals and preferences
- Required assets and exact-copy requirements
- Shot-level acceptance criteria
- Required QA evidence
- Human approval gates
- Delivery package requirements
- Explicitly excluded scope

Acceptance criteria must be observable and testable where possible. Avoid vague criteria such as “make it premium” without describing the observable qualities that would support that judgment.

---

## 5. Creative direction, storyboard, and approval gates

### 5.1 Creative direction

The creative plan should identify:

- Central concept and narrative logic
- Audience insight and intended emotional response
- Visual system: color, typography, composition, imagery, texture, and lighting
- Motion language: pace, easing, transitions, emphasis, and spatial behavior
- Sound direction where applicable
- How the work will be distinct from generic template-like output
- Which visual details are exact and which may be interpreted creatively

Creative choices should support the message, not exist only as decoration.

### 5.2 Storyboard

Every shot should have a clear narrative or communicative purpose. A storyboard should specify, as applicable:

- Shot ID and purpose
- Duration and timeline position
- Composition and focal point
- On-screen copy and exact text
- Visual elements and required assets
- Motion and transition behavior
- Audio cues
- Acceptance criteria
- Dependencies and continuity requirements
- Open questions and risk level

Do not move into full production while a material story or brand decision remains unresolved.

### 5.3 Style-frame gate

Produce one or more representative still frames before investing in complex animation when style uncertainty could cause expensive rework.

Review the visual hierarchy, typography, brand accuracy, contrast, composition, and overall direction. Record approval or requested changes.

### 5.4 Human approval gates

Human approval is required at the following gates when applicable:

1. **Storyboard approval:** narrative, sequence, and shot intent are accepted.
2. **Style-frame approval:** visual language and representative compositions are accepted.
3. **Final-cut approval:** the rendered, assembled deliverable is accepted before final delivery.

Request additional review when confidence is low, the brief is ambiguous, changes are expensive, or the consequence of an error is significant. Record the approver, decision, version, and any conditions.

---

## 6. Deterministic animation contract

A scene must support reproducible evaluation at any requested local timestamp.

### 6.1 Scene interface

Each scene should expose:

- **`meta`** — scene identity, duration, dimensions, frame rate, dependencies, and other relevant metadata.
- **`mount`** — deterministic initialization of the scene or rendering surface.
- **`seek(tLocalSeconds)`** — an operation that sets the complete scene state for the requested local timestamp.

Equivalent interfaces are acceptable if the behavior is explicit and testable.

### 6.2 Arbitrary-time seeking

`seek(t)` must derive the complete visual state from `t`. It must not depend on having played all previous frames in sequence. Seeking directly to a time and reaching the same time through sequential playback should produce equivalent state.

Avoid stateful animation behavior that accumulates unbounded changes frame by frame. Prefer direct time-based calculations.

### 6.3 Timeline and frame timing

- Use one canonical timeline for a multi-shot project.
- Derive frame timestamps from integer frame indices and the declared frame rate.
- Avoid accumulated floating-point timing drift.
- Define shot start/end times and transition overlaps explicitly.
- Define behavior at scene boundaries and at time zero.
- Verify duration and frame count against the timeline.

### 6.4 Reproducibility controls

Control or record:

- Fonts and font availability
- Image, vector, video, and audio assets
- Viewport and output dimensions
- Device-pixel ratio where relevant
- Renderer and encoder versions/settings
- Frame rate and timestamp calculations
- Random seeds for any necessary randomness
- Color space and transparency behavior where relevant
- External resources and network dependencies

Do not claim deterministic output merely because the same command ran twice. Where reproducibility is a requirement, compare the relevant rendered outputs or hashes and report what was actually verified.

### 6.5 Exactness and generated assets

Keep exact text, logos, UI, numbers, and critical product details in controlled layers whenever practical. Generated assets must be checked for unwanted text, logo errors, artifacts, inconsistent product details, and other violations of the brief before use.

---

## 7. Production QA

Production QA verifies that the technical artifact is valid and deliverable.

Check applicable items such as:

- Required source files and output files exist.
- Render and encoding processes exit successfully.
- The file can be probed and decoded.
- Resolution, aspect ratio, frame rate, duration, codec, and pixel format match the specification.
- Expected frame count and timeline timing are consistent.
- Frames are not blank, missing, corrupted, or unexpectedly duplicated.
- Assets resolve and fonts are available.
- There are no unexpected renderer errors or missing-resource warnings.
- Shot boundaries, overlaps, and transitions follow the timeline.
- Audio exists when required, is synchronized, and has suitable levels.
- The final export corresponds to the accepted source and configuration.
- Required contact sheets, reports, and evidence are present.

Production QA should emit a structured report with pass/fail status, checks performed, observed values, warnings, evidence paths, and unavailable checks. A test that was not run must not be recorded as passed.

---

## 8. Creative QA

Creative QA evaluates the actual rendered frames and video against the brief, storyboard, and acceptance criteria.

### 8.1 Visual criteria

Evaluate, as applicable:

- Brief and message fidelity
- Storytelling clarity and hierarchy
- Composition, balance, focal point, and visual flow
- Typography accuracy, hierarchy, spacing, legibility, and safe areas
- Brand identity, logo, color, and product fidelity
- Contrast and accessibility for the intended placement
- Craft, consistency, detail, and visual polish
- Distinctiveness and avoidance of generic or unintended AI artifacts
- Continuity between shots and consistency across the sequence

### 8.2 Motion criteria

Evaluate, as applicable:

- Timing, rhythm, pacing, and holds
- Easing and acceleration
- Spatial continuity and direction
- Weight, anticipation, follow-through, and settling
- Readability during motion
- Transition intent and continuity
- Synchronization with copy, voice, music, and sound effects
- Abrupt cuts, flicker, popping, jitter, clipping, and unintended jumps
- Whether motion supports the message rather than distracting from it

### 8.3 Evidence

Inspect representative frames throughout each shot, including critical moments such as entrances, holds, exits, transitions, and any suspected defect. Use contact sheets or frame extraction to make review repeatable. For temporal problems, inspect neighboring frames or short clips rather than relying on a single still.

A contact sheet is inspection evidence, not proof that every moment is correct. If a required frame, playback inspection, or audio check was unavailable, state that limitation.

### 8.4 Separate scoring and decision

Keep technical status separate from creative assessment. A technically valid render may still fail creative QA. A visually attractive sample may still fail production QA.

Record criterion-level findings and unresolved defects. Do not average away a critical hard-constraint failure with otherwise strong scores.

---

## 9. Evidence-based defect reports and bounded revision

Every actionable defect should record:

- Project and shot ID
- Timestamp and/or frame number
- Severity and priority
- Acceptance criterion or requirement affected
- Objective observation from the rendered evidence
- Impact on the audience or deliverable
- Proposed change
- Expected result
- Verification method
- Result after the attempted correction

Prioritize hard-constraint failures and severe defects before cosmetic refinements.

### 9.1 Initial revision limits

Unless a project explicitly overrides these initial limits:

- **Technical repair:** maximum 2 attempts per failure.
- **Creative revision:** maximum 3 rounds per shot.
- **Global revision:** maximum 2 rounds for the whole project.

These limits are guardrails against unbounded loops, not a reason to ignore a serious defect. If a limit is reached, stop repeating the same action, record the unresolved problem, and ask for a human decision or propose a materially different approach.

### 9.2 Revision procedure

1. Identify the highest-priority evidenced defect.
2. Trace it to the smallest responsible scene, component, asset, or timeline segment.
3. Propose the minimal change likely to correct it.
4. Preserve the last known-good version.
5. Apply the change.
6. Re-render the affected output and any dependents.
7. Inspect the exact evidence relevant to the defect.
8. Record pass/fail and any side effects.
9. Re-run broader QA where the change may have affected other requirements.

Do not make unrelated stylistic edits while fixing a specific defect. If a correction worsens the result, restore the last valid version or clearly isolate the failed attempt.

---

## 10. The 13 specialist skills

Specialists are focused instruction sets. They may be followed by an agent or human; their presence as Markdown files does not imply automatic loading, runtime routing, or executable orchestration.

### 10.1 Brief-to-Criteria

**Activate when:** a new brief arrives, scope changes materially, or acceptance conditions are unclear.

**Responsibilities:**
- Extract the objective, audience, message, platform, deliverables, brand, references, assets, constraints, and deadline.
- Separate hard constraints from preferences.
- Identify ambiguities and ask focused clarification questions when necessary.
- Record assumptions and risks.
- Produce structured acceptance criteria and an `acceptance.yaml` or equivalent.

**Output:** normalized brief, assumptions, open questions, hard constraints, and testable acceptance criteria.

### 10.2 Creative Director

**Activate when:** the project needs a concept, visual language, narrative, pacing, or differentiation.

**Responsibilities:**
- Develop concepts tied to the brief and audience.
- Establish visual and motion language.
- Define narrative progression, tone, and creative rationale.
- Identify risks of generic, derivative, or visually inconsistent output.
- Propose a clear direction for storyboard and style-frame review.

**Output:** selected concept or options, visual direction, narrative arc, design rules, risks, and approval questions.

### 10.3 Storyboard Architect

**Activate when:** an approved concept needs to become a timed, reviewable sequence.

**Responsibilities:**
- Break the narrative into shots with explicit purpose and duration.
- Specify composition, copy, assets, movement, transitions, and audio cues.
- Define shot-level acceptance criteria and dependencies.
- Check pacing, continuity, duration, and platform constraints.
- Prepare storyboard review materials.

**Output:** timed shot list or storyboard, transition plan, dependencies, and shot-level acceptance criteria.

### 10.4 Typography and Layout

**Activate when:** exact text, hierarchy, spacing, safe areas, interface legibility, or layout is important.

**Responsibilities:**
- Preserve supplied copy exactly unless a change is approved.
- Establish hierarchy, scale, alignment, line breaks, spacing, contrast, and safe areas.
- Check legibility at the intended resolution and placement.
- Protect logos, labels, figures, and other exact elements.
- Ensure text remains readable during animation.

**Output:** layout specifications, text treatment, typography rules, and evidence-based layout fixes.

### 10.5 SVG Illustration

**Activate when:** the scene needs controlled vector graphics, diagrams, icons, or illustrated elements.

**Responsibilities:**
- Build clear, editable SVG elements.
- Use consistent geometry, stroke, fills, and visual weight.
- Keep exact labels and important shapes deterministic.
- Minimize unnecessary complexity and rendering fragility.
- Verify scaling, clipping, layering, and transparency.

**Output:** reusable SVG assets or scene elements with relevant constraints and verification notes.

### 10.6 Motion Engineer

**Activate when:** deterministic timing, easing, transitions, arbitrary-time state, or scene continuity is needed.

**Responsibilities:**
- Implement the scene contract and direct timestamp-based state.
- Define durations, delays, easing, and boundary behavior.
- Prevent accumulated state and frame-order dependence.
- Maintain continuity and respect the canonical timeline.
- Verify seek consistency at critical timestamps and boundaries.

**Output:** motion implementation, timing definitions, and reproducibility tests or evidence.

### 10.7 Product Animation

**Activate when:** animating software interfaces, product interactions, features, or data-driven demonstrations.

**Responsibilities:**
- Preserve product behavior and interface details.
- Define interaction states and transitions.
- Use accurate data, labels, and UI structure.
- Focus motion on communicating a product benefit.
- Avoid implying functionality or results that the product does not support.

**Output:** product-animation plan and scene implementation, including state definitions and fidelity checks.

### 10.8 Render Engineer

**Activate when:** renderer setup, frame capture, encoding, reproducibility, or a production render fails.

**Responsibilities:**
- Validate runtime prerequisites and available tools.
- Maintain a predictable frame-rendering and encoding path.
- Diagnose logs and actual error output.
- Verify dimensions, frame rate, duration, codec, frame count, and file integrity.
- Optimize safely through caching or incremental rendering where supported.
- Preserve the known-good path and document environment limitations.

**Output:** render configuration, verified output, technical QA report, and unresolved technical risks.

### 10.9 Visual Critic

**Activate when:** rendered evidence needs evaluation for composition, legibility, fidelity, and craft.

**Responsibilities:**
- Inspect actual rendered frames, not just source or intended design.
- Compare results against the brief, storyboard, and acceptance criteria.
- Identify hierarchy, spacing, contrast, cropping, brand, text, asset, and artifact defects.
- Cite the frame or timestamp for every actionable finding.
- Separate hard-constraint failures from subjective refinements.

**Output:** prioritized visual defect report with observations, impact, proposed changes, and verification methods.

### 10.10 Motion Critic

**Activate when:** temporal behavior, rhythm, easing, continuity, or transitions need review.

**Responsibilities:**
- Inspect sequences of frames or playback around critical events.
- Identify jitter, flicker, popping, awkward holds, weak easing, timing problems, and discontinuities.
- Check motion against narrative purpose and intended emphasis.
- Record precise timestamps and affected shots.
- Recommend actionable corrections rather than vague aesthetic criticism.

**Output:** prioritized temporal defect report and evidence-backed recommendations.

### 10.11 Revision Engineer

**Activate when:** an evidenced defect must be translated into a small, verifiable change.

**Responsibilities:**
- Confirm the defect and its acceptance criterion.
- Locate the smallest responsible component or scene.
- Propose the minimum effective correction.
- Preserve the last known-good version.
- Respect technical, per-shot creative, and global revision limits.
- Re-render and verify the changed output and affected dependents.

**Output:** targeted change, verification evidence, regression notes, and remaining defects.

### 10.12 Audio and Assembly

**Activate when:** the project requires audio cues, synchronization, multi-shot assembly, or final encoding.

**Responsibilities:**
- Use the canonical timeline as the source of truth.
- Align voice, music, and effects to visual events.
- Check timing, transitions, levels, clipping, silence, and synchronization.
- Assemble approved shots without unintended gaps or discontinuities.
- Re-render only changed shots and affected dependents when reliable caching is available.
- Verify the final assembled export.

**Output:** assembly configuration, audio/timeline checks, final render, and relevant QA evidence.

### 10.13 Delivery and Verification

**Activate when:** a cut is ready for acceptance or files are being handed off.

**Responsibilities:**
- Verify the final export against technical and creative acceptance criteria.
- Confirm source/export correspondence and identify the exact version delivered.
- Package editable source, required assets/references, configuration, QA report, and known limitations.
- Check file names, formats, dimensions, frame rate, duration, codec, and audio requirements.
- Report any missing evidence or unavailable verification honestly.

**Output:** verified deliverable package, completion checklist, QA summary, and handoff notes.

---

## 11. Specialist routing

Select the smallest useful group of specialists. Provide each with the task, relevant inputs, hard constraints, acceptance criteria, dependencies, and required output.

Examples:

- New or materially changed brief → Brief-to-Criteria.
- Concept, visual language, narrative, or differentiation → Creative Director.
- Timed shot sequence → Storyboard Architect.
- Text accuracy or hierarchy defect → Typography and Layout + Revision Engineer; add Visual Critic when evidence is needed.
- Controlled vector graphics → SVG Illustration.
- Deterministic timing or seek behavior → Motion Engineer.
- Interface or feature demonstration → Product Animation + Typography and Layout as needed.
- Render or encoding failure → Render Engineer.
- Composition, legibility, fidelity, or visual-craft review → Visual Critic.
- Timing, easing, or continuity review → Motion Critic.
- Implement an evidenced correction → Revision Engineer.
- Audio synchronization or multi-shot assembly → Audio and Assembly.
- Final package and handoff → Delivery and Verification.

Do not route every task to every specialist. Additional specialists should be invoked only when the evidence or task requires them.

---

## 12. Multi-shot production, timeline, and caching

A multi-shot project must use one canonical `timeline.json` or equivalent structured timeline.

The timeline should record, as applicable:

- Project frame rate and global duration
- Shot IDs and source scene references
- Start/end times or frame indices
- Local scene time and global timeline mapping
- Transition intervals and overlap behavior
- Required assets and dependencies
- Audio tracks and synchronization points
- Shot acceptance criteria and approval state
- Render/cache identity and source version

### 12.1 Shot boundaries and continuity

Define boundaries explicitly. Verify that shot duration, transition overlap, and total runtime agree with the timeline. Continuity checks should cover color, typography, spatial direction, scale, product state, sound, and narrative flow where applicable.

### 12.2 Caching and incremental rendering

Cache only when the inputs that affect the output can be identified reliably. Cache identity should account for scene source, relevant assets, fonts, configuration, renderer settings, and dependencies.

When a scene changes, re-render that scene and affected dependents rather than blindly re-rendering or reusing stale output. A cache hit is not proof of correctness; final assembly and relevant QA must still be verified.

### 12.3 Current capability boundary

The timeline, caching, and multi-shot workflow described here are requirements for the system. They must not be represented as implemented until code and tests demonstrate them.

---

## 13. Model and provider gateway

Model access must be isolated behind a provider abstraction instead of being coupled directly to one vendor.

### 13.1 Gateway responsibilities

- Provide a consistent interface for supported model capabilities.
- Route tasks according to complexity, required capabilities, latency, reliability, and cost.
- Keep provider-specific request/response handling behind adapters.
- Support explicit timeouts, retries, cancellation, and useful error reporting.
- Track provider, model ID, request purpose, token or usage metadata where available, and cost estimates where available.
- Keep credentials in environment variables or an appropriate secret store; never hard-code keys or commit secrets.
- Make unsupported capabilities explicit.
- Allow provider configuration to change without rewriting the production workflow.

### 13.2 Verify before use

Model IDs, endpoint compatibility, quotas, pricing, regional availability, and payment/card requirements can change. Verify them against current provider documentation before relying on them. Do not label a model “free” or “unlimited” without checking its current terms and limits.

Do not claim that a provider call succeeded unless a real request was made and a valid response was received.

### 13.3 Fallback behavior

Fallbacks must be explicit and safe. If a provider is unavailable, the system may use a verified alternative or pause for human intervention. It must not silently fabricate model output or report success after a failed call.

Provider integration is a future implementation requirement unless supported by actual code and tests.

---

## 14. Cost and resource safeguards

The system should make cost and resource use visible before and during production.

- Estimate expected model, generation, rendering, storage, and external-service usage where possible.
- Track actual spend where provider data permits.
- Warn when the project reaches **70% of its approved budget**.
- Stop optional spend when the project reaches **100% of its approved budget**.
- Do not bypass budget stops automatically.
- Require explicit human approval to raise a budget or resume optional spend after the stop.
- Prefer local deterministic operations when they satisfy the requirement.
- Use previews and incremental renders to avoid unnecessary full-resolution work.
- Reuse verified assets and valid cached shots when inputs match.
- Report estimates separately from confirmed costs.
- If cost cannot be measured reliably, disclose that limitation and apply conservative safeguards.

Cost thresholds are required operating policy; they are not proof that budget tracking has already been implemented.

---

## 15. Project states and failure handling

Use explicit project states such as:

`BRIEF` → `PLANNING` → `STORYBOARD_REVIEW` → `BUILDING` → `RENDERING` → `QA` → `REVISION` → `APPROVED` → `ASSEMBLY` → `FINAL_QA` → `DELIVERED`

Not every project requires every state, but skipped gates must be justified and recorded.

Use explicit failure or recovery states when work cannot proceed. Examples include `BLOCKED`, `RENDER_FAILED`, `QA_FAILED`, and `AWAITING_APPROVAL`.

Rules:

- A failed command must remain a failure until a verified recovery occurs.
- Missing assets or unavailable tools must not be silently ignored when they affect the deliverable.
- Human decisions must be recorded when they change scope, acceptance criteria, budget, or creative direction.
- Do not mark a project `APPROVED` or `DELIVERED` while mandatory checks remain unresolved.
- Clearly distinguish completed, partially completed, and unverified work.

---

## 16. Recommended repository organization

The exact structure may evolve, but responsibilities should remain separable. A target organization may look like:

```text
docs/
  FOLD-MOTION-SKILL-BOOK.md
  DEVELOPMENT.md
  architecture/
skills/
  master/
    SKILL.md
  brief-to-criteria/
    SKILL.md
  creative-director/
    SKILL.md
  storyboard-architect/
    SKILL.md
  typography-and-layout/
    SKILL.md
  svg-illustration/
    SKILL.md
  motion-engineer/
    SKILL.md
  product-animation/
    SKILL.md
  render-engineer/
    SKILL.md
  visual-critic/
    SKILL.md
  motion-critic/
    SKILL.md
  revision-engineer/
    SKILL.md
  audio-and-assembly/
    SKILL.md
  delivery-and-verification/
    SKILL.md
apps/
  studio/
packages/
  orchestrator/
  model-gateway/
  renderer/
  qa/
  schemas/
  runtime/
  components/
projects/
  <project-id>/
    brief.md
    acceptance.yaml
    storyboard/
    timeline.json
    scenes/
    assets/
    renders/
    qa/
    delivery/
```

This is a target structure, not a mandate to create all directories immediately. Preserve the existing working renderer and introduce packages incrementally. Do not build a Studio frontend before the production loop is reliable.

---

## 17. Testing and evaluation

Tests should cover both deterministic behavior and workflow constraints.

### 17.1 Foundation tests

- Health checks accurately report required runtime tools.
- Scene state is correct at key timestamps.
- Arbitrary-time seeking is reproducible.
- Rendering creates the expected output files.
- FFprobe or equivalent verifies required output metadata.
- Errors and missing prerequisites fail clearly.
- Existing rendering behavior remains protected by regression tests.

### 17.2 Skill and orchestration tests

As those systems are implemented, test:

- Skill discovery and metadata validity.
- All required specialist instructions are present.
- Routing is deterministic for the same input and configuration.
- Routing selects the smallest useful specialist group.
- Missing or malformed skills fail clearly.
- Hard constraints and acceptance criteria persist across workflow stages.
- Approval gates cannot be silently bypassed.
- Revision limits and budget stops are enforced.
- Failure states are not converted to success.
- Model/provider failures are reported accurately.

### 17.3 Creative evaluation

Maintain a set of representative briefs and expected outcomes. Evaluate exact-copy accuracy, brand fidelity, visual hierarchy, narrative clarity, motion quality, continuity, reproducibility, and delivery completeness. Record defects and compare revisions against evidence.

A structural Markdown test proves only that documents satisfy the tested structural conditions. It does not prove that an orchestrator, provider gateway, visual critic, or multi-shot engine exists.

---

## 18. Roadmap

Implement in stages. Each phase must have a clear definition of done and evidence before the next phase is treated as complete.

### Phase 1 — Single-scene rendering foundation

Maintain the deterministic scene contract, preview, frame rendering, video encoding, metadata verification, and reproducible output.

**Exit criteria:** a known scene can be rendered and verified; technical failures are visible; the source remains editable.

### Phase 2 — Production QA

Add structured technical reports, checks for required outputs and metadata, frame integrity checks, and evidence collection.

**Exit criteria:** required technical criteria are machine-checked where practical, and unrun checks remain clearly marked.

### Phase 3 — Model integration

Add the provider gateway, verified provider adapters, task routing, configuration, error handling, and cost/resource safeguards.

**Exit criteria:** real supported requests can be made and verified; unavailable providers and budget stops fail safely; credentials are not committed.

### Phase 4 — Visual critique and targeted correction

Build an evidence-based process for reviewing rendered frames and temporal segments, producing defect reports, applying targeted revisions, and re-verifying results.

**Exit criteria:** findings cite actual output evidence; revisions respect limits and preserve known-good versions.

### Phase 5 — Multi-shot production

Add the canonical timeline, shot-level acceptance criteria, transitions, dependency tracking, caching, incremental rendering, and assembly checks.

**Exit criteria:** the assembled export matches the timeline, and changed shots/dependents are refreshed correctly.

### Phase 6 — Audio and advanced visuals

Add audio synchronization, voice/music/effect handling, and additional visual techniques as required by real projects.

**Exit criteria:** audio and visual timing are verified, output requirements are met, and unsupported formats or tools are reported.

### Phase 7 — Studio interface

Only after the production loop is dependable, build a UI for briefs, approvals, timeline, renders, QA, revisions, and delivery.

**Exit criteria:** the interface reflects real underlying states and never presents unverified operations as complete.

### Phase 8 — Evaluation and calibration

Create a repeatable evaluation set, calibrate QA criteria and routing, measure recurring failure modes, and improve reliability using documented evidence.

**Exit criteria:** performance and limitations are measured against representative work, not asserted from isolated demos.

---

## 19. Definition of done

A project is complete only when all applicable technical, creative, approval, and delivery conditions are satisfied.

### Technical completion

- The required render and export exist.
- Technical metadata matches the specification.
- Required files, assets, fonts, and audio are available.
- The output is readable and decodable.
- Mandatory production checks pass, or an approved exception is documented.
- The delivered source and configuration correspond to the final export.

### Creative completion

- The output satisfies the brief and hard constraints.
- The storyboard and applicable style-frame approvals are recorded.
- Rendered evidence has been reviewed against visual and motion criteria.
- Critical defects are resolved.
- Remaining defects or subjective trade-offs are disclosed.
- Final-cut approval is recorded when required.

### Delivery completion

- The requested formats and placements are included.
- Editable source and required assets/references are packaged.
- QA reports, configuration, and handoff notes are included.
- File names, versions, and output locations are clear.
- Known limitations and unavailable checks are stated.
- No claim of completion exceeds the evidence actually obtained.

Passing code tests alone is not completion. A valid MP4 alone is not completion. The final work must meet the accepted brief and be accompanied by honest verification.

---

## 20. Final directive

FOLD Motion exists to make high-quality motion production more reliable, controllable, inspectable, and commercially useful.

**Build reliable creative autonomy—not an illusion of autonomy.**

Keep exact details exact. Keep the workflow inspectable. Make scene output reproducible. Inspect the actual render. Revise only with evidence. Respect human approval and budget limits. Preserve valid work. Deliver the editable source and verified output. Be explicit about what is implemented, what is planned, and what remains unverified.
