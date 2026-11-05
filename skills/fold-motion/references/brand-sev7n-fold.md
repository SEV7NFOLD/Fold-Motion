# SEV7N FOLD brand

Use this when the production is for SEV7N FOLD itself (showreels, launches,
internal pieces) or when changing the studio's own interface. For client
work, the client's colors and copy come from the brief context instead; never
apply SEV7N FOLD's brand to a client film.

Sources: the SEV7N FOLD Brand Book and the Company Profile 2026.

## Palette

| Name | Hex | Use |
| --- | --- | --- |
| Obsidian Black | `#141518` (profile dark pages `#0E0E11`) | Dark backgrounds |
| Pure White / paper | `#FFFFFF` / `#F0EDE8` | Light backgrounds, text on dark |
| Electric Indigo | `#7C3AED` | Primary accent, actions |
| Working indigo | `#6B4FC9` | Indigo text on light backgrounds |
| Lavender | `#9D86F0` | Indigo text and states on dark backgrounds |
| Taupe Gray | `#736F6E` | Secondary text and rules |

For a SEV7N FOLD film in the engine, use `primaryColor` `#0E0E11` or `#141518`
with `accentColor` `#7C3AED`, or `#F0EDE8` with `#6B4FC9` for a light piece.
Text color is chosen automatically for contrast.

## Typography

The designed profile uses Anton (condensed display, uppercase headlines,
usually ending with a period) and Montserrat (body and wide-tracked uppercase
labels). The brand book lists Helvetica; follow the profile for designed work.
The render engine draws its own bold sans-serif and can't load brand fonts
yet.

## Logo

The mark is an inverted triangle folding into an S and a 7, with a dot above
and below. Keep 40 px clear space on every side and never render it narrower
than 104 px. The vector is at `public/brand/sev7n-fold-mark.svg`. The engine
can't place images, so don't approximate the mark with rects and circles in
a film; add the logo in post or wait for image support.

## Voice

Authoritative, premium, sophisticated, visionary. Short, declarative lines
("We build what's next."). Tagline: "Make more." Aesthetic: architectural
precision, warm minimalism, structured clarity.
