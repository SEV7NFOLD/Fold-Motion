# Stage 1: Brief

Turn what the director typed into a production specification before anything
is planned. In the studio this happens implicitly: the brief text plus the
"Copy and colors" panel become the request context, and the acceptance spec is
generated from the approved storyboard.

## What the engine accepts

| Field | Source | Notes |
| --- | --- | --- |
| Brief | The director's message (plus revision notes) | Free text sent to Gemini |
| `headline` | Copy and colors panel | Exact copy for the first shot; up to 54 characters |
| `subheadline` | Copy and colors panel | Exact copy for the last shot and every shot's supporting line; up to 100 characters |
| `primaryColor`, `accentColor` | Copy and colors panel | 6-digit hex; background and accent |
| `durationInSeconds` | The brief ("10-second", "15 sec", "ten seconds", "10s") | Read by `durationFromBrief` (`public/brief-length.mjs`, shared with the studio), clamped to 3–30 seconds. When a length is asked for, shot durations are scaled to hit it exactly, in whole frames. With none, the storyboard's own pacing stands (it aims for 8 seconds). |
| `width`, `height`, `fps` | Defaults (1280, 720, 24) | Not yet editable in the studio |

Anything else in a brief (audience, platform, references, tone) reaches Gemini
only as part of the brief text. The studio shows what each brief was sent with
(headline, subheadline, colors, length) as chips under the message, so a missing
headline or a mistyped color is visible before anything is built.

## Method

1. Extract the objective, audience, message, platform, duration, format, brand
   and any supplied copy.
2. Separate hard constraints from preferences. Hard: exact wording, product
   names, disclaimers, colors, dimensions, duration limits. Preferences: mood,
   pacing, style references.
3. Put exact copy in `headline` and `subheadline`, not only in the brief text.
   Code guarantees those two fields appear character for character; text
   inside the brief is only a request to the model.
4. Check the brief against [engine.md](engine.md). If it asks for something
   the engine can't make (footage, a logo image, a voice-over, a camera move),
   say so now and offer what it can make instead.
5. Ask one focused question when an ambiguity would materially change the
   film (for example, which of two product names is correct). Otherwise state
   your assumption and its consequence.
6. Never invent product facts, prices, claims or approvals.

## Acceptance criteria

`buildAcceptanceSpec` produces the acceptance spec (`acceptance.json`, schema
version 1.0) from the approved storyboard: mandatory copy per shot, visual
direction, technical requirements, shot criteria and creative criteria. See
[the example](../templates/acceptance.example.json). Good criteria can be
checked on a rendered frame: "The full headline is visible on the last
frame", not "feels premium".
