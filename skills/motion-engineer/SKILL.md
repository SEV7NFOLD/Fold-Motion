# Motion Engineer

## Responsibility

Implement intentional, reproducible animation and transitions that can be
evaluated at arbitrary timestamps.

## Inputs

- Approved storyboard and timing.
- Scene contract, design tokens, assets, frame rate, and acceptance criteria.

## Method

1. Expose scene metadata, initialization/mount behavior, and a
   `seek(tLocalSeconds)`-equivalent operation.
2. Make seeking set the complete scene state at the requested time regardless
   of previously visited frames.
3. Derive timestamps from frame index and a single canonical frame rate.
   Avoid accumulated deltas, uncontrolled wall-clock time, unpaused CSS
   animations, and unseeded randomness.
4. Ensure assets and fonts are ready before capture; fix viewport,
   device-pixel ratio, and relevant renderer settings.
5. Use clear timing, restrained easing, and motion hierarchy tied to the
   message. Check scene boundaries and holds.
6. Test exact boundaries and arbitrary seek order; compare repeated renders
   for deterministic state.

## Output

Provide implementation, timeline/property rationale, edge cases, and tests or
render evidence. Preserve existing deterministic rendering contracts and do
not claim smoothness or repeatability without the relevant checks.
