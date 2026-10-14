# FOLD Motion — Recovery handoff

This handoff describes the verified repository foundation and the production
skill instructions added on `recovery/fold-motion-bootstrap`. The canonical
requirements are in [the FOLD Motion v2.0 Skill Book](docs/FOLD-MOTION-SKILL-BOOK.md).

## Current foundation

The project is a local, deterministic rendering foundation:

`scene state at frame-index timestamp -> SVG -> Resvg PNG -> FFmpeg MP4 -> FFprobe metadata validation`

- Scene 01 derives its complete state from an explicit timestamp and shared
  source used by preview and rendering.
- The renderer produces 1280x720 output at 24 fps, writes source SVG and PNG
  frames, creates a contact sheet, encodes H.264, and checks output metadata.
- The local preview server binds to loopback; health checks cover runtime
  prerequisites.
- The runtime dependencies remain Node.js built-ins and the pinned
  `@resvg/resvg-js` package. FFmpeg/FFprobe are external local prerequisites.

Do not replace or bypass this deterministic rendering path as part of skill
documentation work.

## Skill system

`skills/master/SKILL.md` defines the operating contract and specialist routing.
The 13 versioned specialist instructions are:

- `skills/brief-to-criteria/SKILL.md`
- `skills/creative-director/SKILL.md`
- `skills/storyboard-architect/SKILL.md`
- `skills/typography-and-layout/SKILL.md`
- `skills/svg-illustration/SKILL.md`
- `skills/motion-engineer/SKILL.md`
- `skills/product-animation/SKILL.md`
- `skills/render-engineer/SKILL.md`
- `skills/visual-critic/SKILL.md`
- `skills/motion-critic/SKILL.md`
- `skills/revision-engineer/SKILL.md`
- `skills/audio-and-assembly/SKILL.md`
- `skills/delivery-and-verification/SKILL.md`

These Markdown files are production instructions. This repository does not yet
contain a skill loader, model-provider gateway, executable project
orchestrator, automated visual/motion critic, multi-shot production system, or
audio workflow. A documented workflow is not evidence those capabilities have
been implemented. No frontend was built for this work.

## Setup and commands

Requirements: Node.js 20 or later, npm, Git, FFmpeg, and FFprobe. Install the
pinned dependencies with `npm ci`, then run:

```powershell
npm run health
npm test
npm run render:scene-01
```

`npm run render:scene-01` requires FFmpeg and FFprobe on `PATH`; it creates a
new `output/scene-01/<run-id>/` directory and refuses to overwrite an existing
run directory.

## Skill verification

`test/skills.test.mjs` checks that the master skill and all 13 canonical
specialist files exist, have matching titles, and are linked from the master.
It also checks selected operating constraints. These checks verify document
structure and required guidance, not the existence of an executable
orchestrator or the creative quality of rendered video.

## Validation record

Record actual command results for this checkout here. Automated tests do not
substitute for rendered-frame creative QA.

- `npm test`: PASS — 8 tests, 0 failures.
- `npm run health`: PASS — Node.js 24.21.0, npm 11.19.0, Git, FFmpeg,
  FFprobe, and Resvg available; 16.72 GiB free at check time.
- `npm run render:scene-01`: PASS — 96 frames rendered; FFprobe verified
  1280x720, 4.000-second, 24 fps output at
  `output/scene-01/2026-10-12T15-44-12-624Z/scene-01.mp4`.
- Visual/creative inspection: pending; do not claim completion without
  reviewing the generated evidence.

## Boundaries and next steps

Follow the staged skill book as the canonical specification. Keep work on
`recovery/fold-motion-bootstrap`; preserve unrelated staged or untracked files.
The next production roadmap is defined by the skill book: extend technical QA,
then add model integration through a provider abstraction, evidence-based
visual critique and correction, multi-shot timeline/caching, audio as needed,
and only then consider a Studio interface. Validate tool availability before
claiming support, and do not build the frontend ahead of the production loop.
