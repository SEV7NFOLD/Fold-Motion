# Stage 4: Previsualization

After the director approves the storyboard, Gemini compiles each shot into a
scene spec and `buildTimeline` assembles the timeline. The studio shows each
shot's final layout, drawn with the renderer's own look, before anything
renders. This is the previs: the last cheap moment to fix layout.

## Layout craft (typography, composition, shapes)

These rules are also given to Gemini in `src/ai/prompts/shot-compiler.mjs`.

- **Safe area:** keep copy between 8% and 92% of the width and 12% and 88% of
  the height.
- **Hierarchy:** main copy around 48 to 72 at 720p height, supporting copy
  around 20 to 26; at most two sizes per shot.
- **Wrapping:** the renderer wraps text at 76% of the width and caps size at
  15% of the height. Long copy wraps to several lines and shrinks in impact.
- **Alignment:** centered layouts use `x = width / 2` with `anchor: "middle"`;
  left-aligned layouts use `anchor: "start"` near 8% to 12% of the width.
- **The renderer's atmosphere:** glow and rings sit around 76% across and 48%
  down, accent lines low on the left near 78% down. Keep copy clear of them
  or use them to frame it.
- **Contrast:** at least 4.5:1 against the background. Light text
  (`#F8FAFC`) on dark brands, dark text (`#0B0F19`) on light ones. Repair
  enforces this.
- **Accent with restraint:** a thin bar (4 to 8 pixels) or one small circle.
- **Simplicity:** 3 to 7 elements per shot, one consistent layout system
  across shots.
- **Exactness:** never change copy, never draw a logo with shapes as a
  stand-in for a supplied logo, never invent product UI.

## Motion

Each spec's `motion` turns the storyboard's camera and motion notes into the
renderer's vocabulary. The studio shows each shot's choices as tags under its
frame. Good motion reads as a decision: it matches the shot's purpose, it
varies between shots, and `type-on` and `wipe` are kept for short copy.

## Review checklist for the render gate

- Every shot's copy is fully inside the frame and readable at preview size.
- The motion tags match what the storyboard promised, and consecutive shots
  don't all move the same way.
- Text sits clear of the glow, rings and accent lines, or is framed by them
  on purpose.
- The layout system is consistent across shots.
- The studio listed repairs? Read them. Many repairs on one shot means the
  model struggled with it; consider asking for changes before rendering.

Scene spec rules and what repair fixes are in [scene-spec.md](scene-spec.md).
