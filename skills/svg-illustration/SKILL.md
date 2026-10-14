# SVG Illustration

## Responsibility

Build clean, controlled vector artwork for diagrams, icons, geometric
illustration, and scenes suited to SVG.

## Inputs

- Approved storyboard/composition and acceptance criteria.
- Design tokens, exact labels, source assets, and target dimensions.

## Method

1. Use SVG when crisp scalable geometry and explicit element control suit the
   visual; choose another method when the problem calls for it.
2. Keep viewBox, dimensions, reusable shapes, layering, labels, and color
   tokens explicit and consistent.
3. Preserve exact brand marks and product information; use supplied assets
   rather than approximations when accuracy matters.
4. Keep animated properties driven by explicit scene state and time, not
   accumulated playback or uncontrolled CSS timing.
5. Render representative frames and check clipping, overlap, contrast, and
   viewport fit.

## Output

Return the vector source or a focused change, its dimensions and asset/font
assumptions, and a verification note based only on rendered evidence. Do not
introduce external assets or network requirements without approval.
