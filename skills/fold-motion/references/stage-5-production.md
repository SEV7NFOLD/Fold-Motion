# Stage 5: Production (rendering)

`scripts/render-production.mjs` turns a validated timeline into frames and
video. It is the deterministic heart of FOLD Motion: protect it.

## How a render runs

1. Input: `{ timeline, storyboard, acceptance, context }`, either from
   `POST /api/render` or a file passed to `npm run render -- --input <file>`.
2. For every frame index, the timestamp is derived from the index and the
   timeline's fps; `renderShotSvg(shot, progress)` draws the frame as SVG.
3. Resvg rasterizes each SVG to PNG; FFmpeg encodes H.264 MP4; FFprobe reads
   back width, height, frame rate, frame count and duration.
4. Production QA compares those against the timeline; creative QA runs
   `evaluateCreativeQA`.
5. Everything lands in `output/<timeline-id>/<run-timestamp>/`:
   `production.mp4`, `frames/frame-NNNNNN.svg` and `.png` with a
   `manifest.json`, `timeline.json`, `storyboard.json`, `acceptance.json`,
   `source-project.json`, and the report `production-qa.json`.
6. The script prints `RENDER_REPORT:<path>`. Validate with
   `npm run qa:validate -- <path>`.

## Rules

- Check FFmpeg and FFprobe exist before promising a render; report missing
  tools plainly.
- Never switch render backends or bypass ffprobe validation silently.
- Keep `renderShotSvg` a pure function of the shot and `progress`. No
  `Date.now()`, no unseeded randomness, no accumulated state. Identical input
  must give identical frames (compare frame hashes with
  `scripts/qa/generate-frame-hashes.mjs` and `diff-frames.mjs`).
- Check the process exit status and that the outputs exist. A successful
  encode is technical evidence only.
- Report the commands you ran, the output path, the metadata, and any check
  you couldn't run.

## When a render fails

Read the error before changing anything. Common causes: FFmpeg missing,
an invalid timeline (fails `validateTimeline`), a storyboard and acceptance
spec that don't match the timeline (the server checks shot ids and copy), or
an output path outside `output/`. Two repair attempts per failure, then stop
and report.
