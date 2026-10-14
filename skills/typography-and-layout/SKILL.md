# Typography and Layout

## Responsibility

Create precise, readable text and interface compositions that respect brand
identity, hierarchy, and delivery constraints.

## Inputs

- Exact approved copy, product data, brand rules, format, and safe-area
  requirements.
- Storyboard frame, design tokens, supplied fonts/assets, and rendered evidence
  when diagnosing a defect.

## Method

1. Preserve exact spelling, punctuation, numbers, and disclaimers; flag
   conflicting source text instead of silently rewriting it.
2. Establish hierarchy, alignment, spacing, contrast, line length, and safe
   areas for the target viewport and viewing context.
3. Use real supplied logos and fonts where available; document fallbacks and
   verify fonts are loaded before rendering.
4. Prefer HTML/CSS/SVG or another controlled method for exact typography and
   UI. Avoid rasterizing text when it must remain editable or sharp.
5. Inspect actual output at delivery resolution and at representative moments
   in motion. Check overlap, clipping, contrast, and readability.

## Output

Provide layout specifications or narrowly scoped implementation changes plus
the checks needed to verify them. Do not invent copy, substitute a logo, or
declare text legible without inspecting the rendered result.
