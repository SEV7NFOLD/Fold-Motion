# Scene specs

## v2 shot directions (current)

Gemini returns one direction per shot; the engine never takes layout from the
model.

```json
{
  "id": "shot-01-scene",
  "recipe": "title-reveal",
  "textCase": "upper",
  "kicker": "SEV7N FOLD presents",
  "emphasis": "motion",
  "motion": { "camera": "push-in", "atmosphere": "planes" },
  "transitionOut": "wipe",
  "beam": true,
  "sweep": true
}
```

`normalizeDirection` (in `src/production/recipes.mjs`) maps aliases, keeps the
kicker to 32 characters without repeating the line, drops an emphasis that
isn't a word in the line, refuses `type-stack` outside two to four words, and
forces the last shot's transition to `cut`. Every change is listed in
`repairs`. `buildTimeline` then expands the recipe with the shot's exact copy
and runs the same checks as for v1 below; the subheadline rides on the final
shot.

The rest of this file describes v1 scenes, which carry their own elements.

## v1 scenes (legacy)

A scene spec describes one shot's layout and how it moves. Gemini writes them
during compile; `repairShotSpec` (in `src/production/repair.mjs`) cleans them;
`buildTimeline` (in `src/production/production.mjs`) accepts or rejects them.
Motion comes from the `motion` object, chosen from a fixed vocabulary.

## Shape

```json
{
  "id": "shot-01-scene",
  "title": "Nocturne",
  "width": 1280,
  "height": 720,
  "fps": 24,
  "durationInSeconds": 3,
  "motion": { "camera": "push-in", "entrance": "fade", "atmosphere": "spotlight" },
  "elements": [
    { "id": "shot-1-background", "type": "rect", "x": 0, "y": 0, "width": 1280, "height": 720, "fill": "#0B0B10" },
    { "id": "shot-1-copy", "type": "text", "content": "Nocturne", "x": 640, "y": 360, "fill": "#F8FAFC", "fontSize": 72, "anchor": "middle" },
    { "id": "shot-1-accent", "type": "rect", "x": 154, "y": 497, "width": 358, "height": 6, "fill": "#C9A86A" }
  ]
}
```

## Element rules

Only three element types render:

| Type | Required fields | Constraints |
| --- | --- | --- |
| `rect` | `x`, `y`, `width`, `height`, `fill` | Fully inside the canvas, positive size |
| `circle` | `x`, `y` (center), `fill`; optional `radius` (default 12) | Center inside the canvas, radius positive |
| `text` | `content`, `x`, `y`, `fill`, `fontSize` | `fontSize` at least 16, position inside the canvas, `anchor` is `start`, `middle` or `end` |

Every `fill` is a 6-digit hex color. Every element has a unique string `id`.

Id suffixes change how the renderer animates an element: `-background` keeps
the full-canvas rect opaque, and `-accent` makes a rect draw on.

## Motion

`motion` is optional; missing fields take the default. Options:

| Field | Options |
| --- | --- |
| `camera` | `static`, `push-in`, `pull-out`, `drift-left`, `drift-right` |
| `entrance` | `rise-glitch`, `fade`, `slide-up`, `slide-left`, `scale-in`, `type-on`, `wipe` |
| `atmosphere` | `orbit`, `spotlight`, `grid`, `lines`, `clean`, `planes`, `dots` |

What each looks like is in [engine.md](engine.md). The entrance applies to
every text element in the shot; the camera moves everything except the
background.

## What buildTimeline requires of each shot

1. Format equals the context (`width`, `height`, `fps`).
2. Duration rounds to the storyboard shot's duration in frames.
3. A full-canvas `rect` at 0,0 in exactly the primary color.
4. A `text` element whose `content` equals the shot's `onScreenCopy`
   character for character.
5. The subheadline, if one was supplied, as a text element. `buildTimeline`
   adds it if missing.
6. At least one element filled with the accent color.
7. Every element renderable under the rules above.
8. `motion`, if present, uses only the options above.

When a check fails, the error names it, for example
`Compiled shot "shot-02" does not satisfy its format, copy, and brand
constraints: no full-canvas background rect in #0B0F19.`

## What the repair layer fixes automatically

Repairs run only on model output and are listed in the response's `repairs`
array and in the studio. They cover:

- **Format and timing:** forced to the context and the storyboard.
- **Types:** aliases mapped (`rectangle`, `line`, `bar` to `rect`; `dot` to
  `circle`; `title`, `caption` to `text`); unsupported types removed.
- **Numbers:** numeric strings converted.
- **Colors:** short hex, named colors and `rgb()` normalized; unusable colors
  replaced.
- **Geometry:** rects trimmed to the canvas or removed if entirely off it;
  circles and text clamped inside.
- **Text:** anchor aliases mapped (`center` to `middle`, `left` to `start`);
  font sizes raised to 16; empty text removed.
- **Background:** the first full-canvas rect moved to the back, set to the
  primary color and renamed to end in `-background`; one added if missing.
- **Contrast:** text below 4.5:1 against the background switched to the
  readable color (light or dark).
- **Copy:** near-matches restored to the exact approved copy (case and
  punctuation); the copy added if missing.
- **Accent:** an accent rule added if no element uses the accent color.
- **Motion:** aliases mapped (`zoom-in` to `push-in`, `typewriter` to
  `type-on`, `none` to `clean`); unknown options replaced with the default; a
  missing `motion` gets a deterministic pick seeded by the storyboard, so a
  model that forgets it doesn't fall back to the same look every time.

Repairs never change copy wording, invent elements beyond the background, copy
and accent, or touch the deterministic (offline) path.

## Creative QA thresholds (evaluateCreativeQA)

| Check | Passes when |
| --- | --- |
| Contrast | Every text element is at least 4.5:1 against its shot's background |
| Legibility | Every text element has content and `fontSize` of at least 16 |
| Brand fidelity | Both the primary and the accent color appear in the timeline |

These are the automated creative checks. They are necessary, not sufficient:
a human still judges story, composition and craft from the frames
(see [stage-6-qa-and-delivery.md](stage-6-qa-and-delivery.md)).

## Adding a new element type

Treat it as an engine change, in this order: `isRenderableElement` and the
checks in `production.mjs`, `renderShotSvg` in the renderer, the Gemini
response schema enum and `sceneRules()` in `provider.mjs`, `TYPE_ALIASES` in
`repair.mjs`, the studio's `specToSvg` preview, this file, the capability
table in [engine.md](engine.md), and the drift test in
`test/skills.test.mjs`. Then tell Gemini about it in
`src/ai/prompts/shot-compiler.mjs`.
