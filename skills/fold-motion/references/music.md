# FOLD Score 2: the music skill book

FOLD Score 2 scores every film with real recorded instruments (the CC0 Versilian
libraries in `assets/samples`), arranged around the film's own timeline. These
are the rules the composer follows; `src/audio/music-book.mjs` holds the same
rules as data, and `src/audio/band.mjs` plays them.

The difference from library music: a library track is written first and the
film cut to it. FOLD Score writes the music *to the cut*, so harmony changes on
cuts, the music breathes before the payoff, and the last chord lands on the logo.

## 1. Harmony

- Each mood has a key and a four-chord progression (shared with the synth score
  in `fold-score.mjs`, so both engines agree). One chord per shot, cycling the
  progression; the end card resolves to the home chord.
- Chords are voiced in two layers: the lower two notes go to the low strings
  (cellos), the upper notes an octave up to the high strings (violins). Keys and
  plucked parts take chord tones from the same voicing, never outside it, so
  nothing clashes.
- Extensions (7ths and 9ths) live in the upper voices only; the bass plays roots.

## 2. Voice leading

- Sustained voices change on the cut, not before it: harmony moves with the
  picture.
- New chords attack quickly after a cut (a few hundredths of a second) and
  sustained notes overlap by a short release, so changes sound joined, not
  chopped.
- The opening chord fades in slowly (the film is arriving); later chords enter
  at the cut.

## 3. Arrangement by section

- **Opening shot:** pad and a few keys notes only. Rhythm parts wait for the
  second shot, so the film opens on space.
- **Middle shots:** the full band of the mood: pad, keys pattern, bass, rhythm.
- **Into a transition** (fold, wipe, push, fade): a harp run rises into the
  transition and a cymbal swell crests on it, so the eye and ear arrive
  together.
- **On cuts:** a low hit (timpani or bass drum, by mood) marks the change.
- **The breath:** every sustained part stops a quarter of a second before the
  end card. The silence makes the payoff land.
- **The payoff:** on the end card, the whole band plays the home chord once:
  low piano root, the chord, strings swelling in, a high glockenspiel note and a
  triangle, then rings out to the end.

## 4. Sync to picture

- Hits sit exactly on cut times (sample-accurate); runs and swells are timed to
  *end* on their cue.
- Word and letter landings get a soft glockenspiel note, at most a couple a
  second, so typography has a voice without becoming a xylophone solo.
- The synth sound design (whooshes, glints, sweeps) stays underneath, and QA's
  sync check still requires 90% of hits within one frame.

## 4b. Playing together

- **The tempo map:** each shot gets a whole number of beats, with the tempo
  flexing slightly between shots, so every cut is a downbeat and every part
  (band, synth drums, bass, arp) plays on the same grid.
- **Attacks on time:** bowed strings take up to 0.2 s to speak. Each sample's
  attack delay is measured when the pack loads, and notes are scheduled early by
  that much (adjusted for pitch), so attacks land on the beat.
- **True octaves:** the VSCO library numbers octaves one lower than scientific
  pitch for some instruments (a cello's lowest note labelled C1); the pack
  builder shifts those to their true pitch, checked by measuring each sample.
- **Notes end at the chord change,** instead of ringing into the next chord.
- **Tight, not robotic:** a few milliseconds of seeded looseness, no more.
- Measured on a six-shot film: strings speak within 30 ms of each cut (they were
  114 ms late), and flams fell from 56% of attacks to 17%.

## 5. Mixing

- The band plays on its own bus, ducked slightly under the kick on moods that
  have one, with a shared room reverb (pads and harp send more, bass and hits
  less).
- Levels are set per part in the book; the master then brings the whole score
  to -14 LUFS with peaks under -0.5 dBTP.
- Small timing and velocity variations (a few milliseconds, a few percent) keep
  repeated notes from sounding mechanical; they're seeded, so a film always
  gets the same score.

## 6. The moods

| Mood | Feel | Pad | Keys / pulse | Bass | Rhythm | On cuts | End card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Premium calm | luxury, still, confident | cellos and violins | piano, broken chords on the beat | held contrabass | none | soft timpani | timpani, triangle, glock |
| Energetic | launch, bold, forward | light violins | marimba ostinato in eighths | pizzicato eighths | claps on 2 and 4, shaker | crash | crash, timpani |
| Editorial | precise, modern, curious | cellos | harp pulse in eighths, piano top notes | pizzicato on the downbeat | quiet shaker | timpani | triangle, glock |
| Warm | handmade, gentle, cosy | cellos and soft violins | soft piano, broken eighths | held contrabass | shaker on the offbeat | none | triangle, glock |

## 7. Taste rules

- Fewer notes, better notes: when in doubt, leave space.
- One lead voice at a time: keys or harp carry the motion, not both loudly.
- Never let the music fight a word landing: rhythm parts drop a little under
  dense typography.
- The payoff chord is the loudest moment; nothing before it should be.

## Sources and licence

All instruments come from the Versilian Community Sample Library and VSCO 2
Community Edition (Versilian Studios, CC0 1.0). `scripts/build-sample-pack.mjs`
rebuilds the pack from the original repositories.
