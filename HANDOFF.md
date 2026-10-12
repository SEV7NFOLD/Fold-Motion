# FOLD Motion — Recovery handoff

This file documents the recovery work performed on branch `recovery/fold-motion-bootstrap` and the next steps to validate and continue development.

## Project purpose and architecture

- Purpose: Deterministic, code-first motion-production foundation. Generates deterministic SVG frames via an authored scene, rasterizes frames with Resvg, and encodes to H.264 MP4 via FFmpeg for inspection and delivery.
- Architecture: Editable scene source → deterministic SVG → Resvg PNG frames → FFmpeg MP4 → FFprobe validation.

## Confirmed repository state (recovery branch)

The following files were added or restored in the recovery branch:

- scripts/health-check.mjs
- scripts/serve.mjs
- scripts/render-scene-01.mjs (modified to be OS-portable)
- src/runtime/health.mjs
- src/runtime/static-server.mjs
- public/scene-01-core.js
- public/scene-01-svg.mjs
- public/scene-01.html
- public/scene-01.js
- public/index.html
- test/health.test.mjs
- test/static-server.test.mjs

A root package.json and .gitignore were added in this commit to restore the project manifest and ignore rules.

## Setup & execution (commands to run locally or in CI)

1. Checkout the recovery branch:

   git checkout recovery/fold-motion-bootstrap

2. Install dependencies (this will generate or update package-lock.json locally):

   npm ci

   - If you prefer to generate a new lockfile instead of using an existing one, run `npm install`.

3. Run the health check (validates Node, npm, Git, FFmpeg/FFprobe, and Resvg availability):

   npm run health

   - Note: The health check will report PASS/FAIL per check and may exit with a non-zero status if a required tool is missing.

4. Run the automated tests:

   npm test

5. Run the scene renderer (this will create output/scene-01/<runId>/ with frames, contact sheet, MP4, and render-report.json):

   npm run render:scene-01

## Important runtime notes and dependencies

- Node.js: Project expects Node >= 20 and `type: "module"` (ES modules with top-level await).
- Native binding: @resvg/resvg-js is a native addon; npm install should fetch a prebuilt binary for your platform when available. If installation fails, capture the npm error output and share it for diagnosis.
- FFmpeg/FFprobe: The renderer requires FFmpeg and FFprobe on PATH. The renderer was updated to choose the correct executable name for Windows (ffmpeg.exe / ffprobe.exe) or other platforms (ffmpeg / ffprobe).

## What was not executed here

- All runtime checks (npm ci, npm run health, npm test, npm run render:scene-01) are pending and must be executed in your environment or CI. The repository changes committed here only prepare the project for those checks.

## Files changed in this commit

- Added: package.json, .gitignore, HANDOFF.md
- Modified: scripts/render-scene-01.mjs (to be cross-platform)

## Next task (minimal validation)

After you run the commands in the Setup section, please share the full terminal output for each command. If any step fails, paste the error and I will diagnose and prepare targeted fixes on the recovery branch.

## For the next AI collaborator

- Always inspect the branch `recovery/fold-motion-bootstrap` before making edits.
- Do not modify the default branch in this recovery effort.
- Keep changes minimal and document each commit with clear intent and scope.
