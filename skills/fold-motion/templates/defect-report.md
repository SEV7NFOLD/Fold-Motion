# Defect report

One report per defect. Fill every field; write "unknown" rather than guessing.

```markdown
## D-<number>: <one-line summary>

- **Shot:** <shot id, for example shot-02>
- **When:** <seconds into the film> (frame <N> at <fps> fps); frames <first>–<last> if it spans
- **Gate:** production QA | creative QA
- **Severity:** critical (blocks delivery) | major (visible to the audience) | minor (polish)
- **Evidence:** <what you inspected: frame file, MP4 timestamp, report field>
- **Observation:** <what is actually on screen, in plain words>
- **Why it matters:** <the brief, criterion or rule it breaks>
- **Proposed change:** <the smallest fix, and where: storyboard copy, prompt, repair rule, renderer>
- **Expected result:** <what the frame should show after the fix>
- **Verification:** <how to confirm: which frames to re-render and check>
- **Status:** open | fixed and verified | fixed, not yet verified | won't fix (reason)
```

## Example

```markdown
## D-1: Headline overflows the right edge in shot 2

- **Shot:** shot-02
- **When:** 4.0 s (frame 96 at 24 fps); frames 72–143
- **Gate:** creative QA
- **Severity:** major
- **Evidence:** output/storyboard-nocturne/2026-11-05T01-13-22-806Z/frames/frame-000096.png; timeline.json shot-02 spec
- **Observation:** "Nocturne, after dark, unforgettable" runs past the right edge; the last word is cut to "unforgett".
- **Why it matters:** Mandatory copy must be fully visible (acceptance mandatoryContent for shot-02).
- **Proposed change:** In the shot-02 spec, set the copy element's anchor to "middle" at x 640 (it is "start" at x 560), so the renderer's 76%-width wrap applies symmetrically.
- **Expected result:** The full line wraps onto two centered lines inside the safe area.
- **Verification:** Re-render; inspect frames 72, 90 and 143 of shot-02 and confirm the whole copy is inside x 102–1178.
- **Status:** open
```
