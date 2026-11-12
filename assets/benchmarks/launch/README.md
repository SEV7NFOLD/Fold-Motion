# Launch style benchmark

`golden-v2.mp4` is the approved Phase 0 film (15 s, 120 BPM, 1080p): the
visual and sonic benchmark for `docs/LAUNCH-STYLE-BUILD-PLAN.md`. It was
designed and timed by hand; the engine's job is to reach this quality from a
brief. `golden-v2-contact-sheet.jpg` shows 24 frames from it. This copy is
compressed for the repository.

Measured: 13% near-still frames, motion energy 2.38, 73% of motion peaks
with a sound, stereo correlation 0.86, midrange 17.6%, −13.2 LUFS, true
peak −1.5 dBFS.

## Sources

- `source/film.html`: the scene. Every moment is `window.frame(t)`, a pure
  function of time; fonts load from `assets/fonts/pairings/`.
- `source/score.py`: the score and sound design, from the CC0 instruments in
  `assets/samples/`. It writes raw 48 kHz stereo float audio to
  `source/score.f32`, which was mastered with FFmpeg: a low trim and mid lift
  (`bass=g=-2.5:f=120`, `equalizer` +2 dB at 700 Hz and +1.5 dB at 1.8 kHz),
  gentle compression, gain to −13 LUFS, then a true-peak limiter at −1.5 dB.

The frames were captured in headless Chromium at 4 samples per frame across
a 180° shutter, blended with FFmpeg `tmix`, with light grain added after.
