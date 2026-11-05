# Stage 6: Quality assurance and delivery

Two gates, then a human decision, then handoff. Keep the gates separate:
production QA asks "is the file correct?", creative QA asks "is the film
good and true to the brief?".

## Gate A: production QA (automated)

From the render report's `productionQA`:

| Check | Passes when |
| --- | --- |
| `dimensions` | Encoded width and height equal the timeline |
| `fps` | Encoded frame rate equals the timeline |
| `frameIntegrity` | Encoded frames equal the timeline's total, and every frame has an SVG and PNG with a hash |
| `duration` | Encoded duration is within one frame of the timeline |

## Gate B: creative QA (automated part)

From `creativeQA`: contrast (every text at least 4.5:1 on its background),
legibility (font size at least 16), brand fidelity (primary and accent both
used). See [scene-spec.md](scene-spec.md).

## Gate B: creative QA (human part)

Automated checks can't judge story or craft. Inspect real evidence:

- **Which frames:** for each shot, the first frame (`startFrame`), the frame
  a quarter of the way in (end of the reveal and glitch), and the last frame
  (`endFrame`). Frame `N` of a shot is
  `output/.../frames/frame-NNNNNN.png`. Also watch the MP4 through once.
- **What to judge:** brief fidelity, the single idea, composition and
  hierarchy, copy exactness, legibility at delivery size, accent restraint,
  the rhythm across shots (does each shot hold long enough to read?), and
  continuity at cuts.
- **What not to do:** don't infer appearance from source code, don't claim
  smooth motion from one frame, and don't report a defect you didn't see.

Write each finding as a defect report using
[the template](../templates/defect-report.md). Time and frame convert at the
timeline fps: at 24 fps, 4.0 seconds is frame 96.

## Revisions

The studio's way to revise is "Ask for changes": the director's note is
appended to the brief and production restarts from the storyboard with a new
version. For engine-level fixes (repair, prompts, renderer):

1. Confirm the defect in the evidence.
2. Change the narrowest thing: a prompt line, one repair rule, one renderer
   detail.
3. Don't touch approved shots or unrelated code.
4. Re-render and compare against both the defect and the previous accepted
   output.
5. Keep the change only if the defect is fixed without a worse regression;
   otherwise revert.
6. Limits: two technical repair attempts per failure, three creative rounds
   per shot, two global rounds. Stop repeating an action that failed.

## Final-cut gate and delivery

The director approves the final cut only when both gates pass (the state
machine enforces it). Delivery then requires the video and source artifacts
under `/output/`. A complete handoff includes `production.mp4`,
`source-project.json`, `timeline.json`, `storyboard.json`,
`acceptance.json`, `production-qa.json`, and a short note of known
limitations. Report each item as verified, pending or failed, with its path.
Never describe an unrun check as passed, and never call a production
delivered while a gate is unresolved.
