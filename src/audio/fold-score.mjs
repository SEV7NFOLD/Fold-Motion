/**
 * FOLD Score: a soundtrack composed from the edit.
 *
 * Reads the timeline (every cut, transition, word landing, sweep, logo and product
 * moment), picks a tempo whose beat grid lines up with the cuts, and synthesizes a
 * stereo score where every hit lands on its visual moment. Deterministic: the same
 * timeline and mood always produce the same samples.
 */

export const SAMPLE_RATE = 48_000;

export const MOODS = Object.freeze({
  premium: {
    label: 'Premium calm', bpm: [84, 96], key: 'D minor',
    chords: [['D3', 'F3', 'A3', 'C4', 'E4'], ['Bb2', 'D3', 'F3', 'A3', 'C4'], ['G2', 'Bb2', 'D3', 'F3', 'A3'], ['A2', 'E3', 'A3', 'C4', 'E4']],
    resolve: ['D3', 'A3', 'E4', 'F4', 'A4'], bass: ['D2', 'Bb1', 'G1', 'A1'],
    pad: { level: 0.085, cutoff: 3200, detune: 14 }, kick: 'half', hats: 'none', arp: 'sparse', voice: 'bell', energy: 0.7,
  },
  energetic: {
    label: 'Energetic', bpm: [118, 128], key: 'A minor',
    chords: [['A2', 'C3', 'E3', 'G3', 'B3'], ['F2', 'A2', 'C3', 'E3'], ['C3', 'E3', 'G3', 'B3'], ['G2', 'B2', 'D3', 'E3']],
    resolve: ['A2', 'E3', 'A3', 'C4', 'E4'], bass: ['A1', 'F1', 'C2', 'G1'],
    pad: { level: 0.06, cutoff: 4500, detune: 16 }, kick: 'four', hats: 'sixteenths', arp: 'busy', voice: 'pluck', energy: 1,
  },
  editorial: {
    label: 'Editorial', bpm: [104, 114], key: 'E minor',
    chords: [['E3', 'G3', 'B3', 'D4', 'F#4'], ['C3', 'E3', 'G3', 'B3', 'F#4'], ['A2', 'C3', 'E3', 'G3', 'B3'], ['B2', 'E3', 'F#3', 'A3']],
    resolve: ['E3', 'B3', 'F#4', 'G4', 'B4'], bass: ['E2', 'C2', 'A1', 'B1'],
    pad: { level: 0.065, cutoff: 3600, detune: 10 }, kick: 'sparse', hats: 'ticks', arp: 'pulse', voice: 'pluck', energy: 0.85,
  },
  warm: {
    label: 'Warm', bpm: [78, 90], key: 'F major',
    chords: [['F2', 'A2', 'C3', 'E3', 'G3'], ['D3', 'F3', 'A3', 'C4', 'E4'], ['Bb2', 'D3', 'F3', 'A3'], ['C3', 'F3', 'G3', 'A3']],
    resolve: ['F3', 'C4', 'E4', 'G4', 'A4'], bass: ['F1', 'D2', 'Bb1', 'C2'],
    pad: { level: 0.09, cutoff: 1800, detune: 5, soft: true }, kick: 'soft', hats: 'brush', arp: 'sparse', voice: 'keys', energy: 0.6,
  },
});

export const MOOD_OPTIONS = Object.freeze(Object.keys(MOODS));

const KEYWORDS = {
  energetic: /\b(energetic|energy|bold|punchy|hype|fast|loud|sport|launch party|drop|electric|dynamic|aggressive)\b/i,
  editorial: /\b(tech|digital|precise|precision|editorial|data|code|engineered|futur|mathemat|minimal)\w*/i,
  warm: /\b(warm|cozy|cosy|intimate|soft|gentle|candle|home|family|organic|handmade|hand-poured)\b/i,
  premium: /\b(premium|luxury|luxurious|calm|quiet|elegant|refined|cinematic|perfume|silence)\b/i,
};

/** A mood from the film's own words; premium when nothing stands out. */
export function chooseMood(text = '') {
  const scores = Object.entries(KEYWORDS).map(([mood, pattern]) => [mood, (String(text).match(new RegExp(pattern.source, 'gi')) || []).length]);
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][1] > 0 ? scores[0][0] : 'premium';
}

// ------------------------------------------------------------------ cues from the timeline

/**
 * Every moment the score should answer, in seconds: cuts (with their transition),
 * word and letter landings, sweeps, the opening beam, logo and product moments,
 * and the end card.
 */
export function extractCues(timeline) {
  const fps = timeline.fps;
  const cues = [];
  const add = (time, type, extra = {}) => cues.push({ time: Math.max(0, time), type, ...extra });
  timeline.shots.forEach((shot, index) => {
    const start = shot.startFrame / fps;
    const end = (shot.endFrame + 1) / fps;
    const spec = shot.spec || {};
    if (index > 0) add(start, 'cut', { transition: timeline.shots[index - 1].spec?.transitionOut || 'cut' });
    if (spec.transitionOut && index < timeline.shots.length - 1) {
      const kind = spec.transitionOut;
      if (kind === 'fold') { add(end - 0.3, 'fold-a'); add(end, 'fold-b'); }
      if (kind === 'wipe') add(end - 0.3, 'wipe', { duration: 0.64 });
      if (kind === 'push') add(end - 0.45, 'push', { duration: 0.45 });
      if (kind === 'fade') add(end - 0.3, 'fade', { duration: 0.6 });
    }
    if (spec.beam) add(start + 0.05, 'beam', { duration: 1.1 });
    if (['lockup', 'logo-reveal'].includes(spec.recipe) && index === timeline.shots.length - 1) add(start, 'endcard');
    for (const element of spec.elements || []) {
      const reveal = element.reveal;
      if (element.type === 'text' && reveal && element.role === 'title') {
        if (reveal.style === 'window') {
          const letters = [...(element.shown || element.content || '')].filter((c) => c !== ' ').length;
          for (let i = 0; i < letters; i += 1) add(start + reveal.start + i * reveal.stagger + reveal.duration * 0.25, 'letter', { index: i });
        } else if (reveal.style === 'beat') {
          const words = String(element.shown || element.content || '').split(/\s+/).filter(Boolean).length;
          for (let i = 0; i < words; i += 1) add(start + reveal.start + i * reveal.interval, 'letter', { index: i });
        } else if ((reveal.style === 'mask-rise' && reveal.unit === 'word') || reveal.style === 'slam') {
          const words = String(element.shown || element.content || '').split(/\s+/).filter(Boolean).length;
          for (let i = 0; i < Math.min(words, 6); i += 1) add(start + reveal.start + i * reveal.stagger + reveal.duration * 0.2, 'word', { index: i });
        } else if (['cascade', 'mask-rise', 'fade', 'slide', 'count', 'decode', 'outline', 'drop', 'split'].includes(reveal.style)) {
          add(start + reveal.start, 'reveal');
        }
        if (element.sweep) add(start + element.sweep.start, 'sweep');
      }
      if (element.type === 'logo' && reveal) {
        add(start + reveal.start, 'logo-draw', { duration: reveal.duration });
        if (element.glint) add(start + element.glint.start, 'glint');
      }
      if (element.type === 'graphic' && element.reveal) add(start + element.reveal.start, 'glint');
      if (element.type === 'image') {
        add(start + (element.reveal?.start || 0), 'product');
        if (element.glint) add(start + element.glint.start, 'glint');
      }
    }
  });
  return cues.filter((cue) => cue.time < timeline.totalFrames / fps).sort((a, b) => a.time - b.time);
}

/** The tempo in the mood's range whose beat grid sits closest to the cuts. */
export function chooseTempo(cuts, [low, high]) {
  let best = { bpm: low, error: Infinity };
  for (let bpm = low; bpm <= high; bpm += 1) {
    const beat = 60 / bpm;
    const half = beat / 2;
    const error = cuts.reduce((sum, time) => { const offset = time % half; return sum + Math.min(offset, half - offset); }, 0);
    if (error < best.error - 1e-9) best = { bpm, error };
  }
  return best.bpm;
}

// ------------------------------------------------------------------ synthesis primitives

function prng(seed) {
  let a = 2166136261;
  for (const character of String(seed)) a = Math.imul(a ^ character.codePointAt(0), 16777619);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOTE = { C: -9, 'C#': -8, Db: -8, D: -7, 'D#': -6, Eb: -6, E: -5, F: -4, 'F#': -3, Gb: -3, G: -2, 'G#': -1, Ab: -1, A: 0, 'A#': 1, Bb: 1, B: 2 };
export function noteFrequency(name) {
  const match = /^([A-G](?:#|b)?)(-?\d)$/.exec(name);
  return 440 * 2 ** ((NOTE[match[1]] + 12 * (Number(match[2]) - 4)) / 12);
}

/** RBJ biquad, processed in place; `cutoff` may be a function of the sample index. */
function biquad(buffer, type, cutoff, q = 0.707, blockSize = 256) {
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  let b0; let b1; let b2; let a1; let a2;
  const update = (frequency) => {
    const w = (2 * Math.PI * Math.min(frequency, SAMPLE_RATE * 0.45)) / SAMPLE_RATE;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    if (type === 'low') { b0 = (1 - cos) / 2 / a0; b1 = (1 - cos) / a0; b2 = b0; }
    else if (type === 'high') { b0 = (1 + cos) / 2 / a0; b1 = -(1 + cos) / a0; b2 = b0; }
    else { b0 = alpha / a0; b1 = 0; b2 = -alpha / a0; }
    a1 = (-2 * cos) / a0; a2 = (1 - alpha) / a0;
  };
  for (let i = 0; i < buffer.length; i += 1) {
    if (i % blockSize === 0) update(typeof cutoff === 'function' ? cutoff(i) : cutoff);
    const x = buffer[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    buffer[i] = y;
  }
  return buffer;
}

class Bus {
  constructor(length) { this.left = new Float32Array(length); this.right = new Float32Array(length); }
  /** Adds a mono signal at time t with an equal-power pan (or a pan ramp). */
  add(t, signal, { gain = 1, pan = 0, panTo, send } = {}) {
    const start = Math.round(t * SAMPLE_RATE);
    for (let i = 0; i < signal.length; i += 1) {
      const at = start + i;
      if (at < 0 || at >= this.left.length) continue;
      const p = panTo === undefined ? pan : pan + (panTo - pan) * (i / signal.length);
      const angle = ((p + 1) * Math.PI) / 4;
      const value = signal[i] * gain;
      this.left[at] += value * Math.cos(angle);
      this.right[at] += value * Math.sin(angle);
      if (send) { send.left[at] += value * Math.cos(angle) * send.amount; send.right[at] += value * Math.sin(angle) * send.amount; }
    }
  }
}

const seconds = (s) => new Float32Array(Math.max(1, Math.round(s * SAMPLE_RATE)));

function envelope(signal, attack, decay) {
  for (let i = 0; i < signal.length; i += 1) {
    const t = i / SAMPLE_RATE;
    signal[i] *= Math.min(1, t / Math.max(attack, 1e-4)) * Math.exp(-Math.max(0, t - attack) / Math.max(decay, 1e-4));
  }
  return signal;
}

function saw(frequency, length, random, detuneCents = 0) {
  const out = seconds(length);
  const f = frequency * 2 ** (detuneCents / 1200);
  let phase = random();
  const step = f / SAMPLE_RATE;
  for (let i = 0; i < out.length; i += 1) {
    phase += step; if (phase >= 1) phase -= 1;
    let value = 2 * phase - 1;
    // PolyBLEP softens the saw's edge, keeping high notes clean.
    if (phase < step) { const x = phase / step; value -= x + x - x * x - 1; }
    else if (phase > 1 - step) { const x = (phase - 1) / step; value -= x * x + x + x + 1; }
    out[i] = value;
  }
  return out;
}

function sine(frequency, length, { sweepTo, curve = 30 } = {}) {
  const out = seconds(length);
  let phase = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SAMPLE_RATE;
    const f = sweepTo === undefined ? frequency : sweepTo + (frequency - sweepTo) * Math.exp(-t * curve);
    phase += (2 * Math.PI * f) / SAMPLE_RATE;
    out[i] = Math.sin(phase);
  }
  return out;
}

function noise(length, random) {
  const out = seconds(length);
  for (let i = 0; i < out.length; i += 1) out[i] = random() * 2 - 1;
  return out;
}

const scale = (signal, gain) => { for (let i = 0; i < signal.length; i += 1) signal[i] *= gain; return signal; };
const mixInto = (target, source, gain = 1) => { for (let i = 0; i < Math.min(target.length, source.length); i += 1) target[i] += source[i] * gain; return target; };

/** A Freeverb-style room: eight combs and four allpasses per channel. */
function reverb(left, right, { room = 0.82, damp = 0.35 } = {}) {
  const ratio = SAMPLE_RATE / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const allpasses = [556, 441, 341, 225];
  const run = (input, spread) => {
    const out = new Float32Array(input.length);
    for (const length of combs) {
      const size = Math.round((length + spread) * ratio);
      const delay = new Float32Array(size);
      let index = 0; let store = 0;
      for (let i = 0; i < input.length; i += 1) {
        const output = delay[index];
        store = output * (1 - damp) + store * damp;
        delay[index] = input[i] * 0.015 + store * room;
        out[i] += output;
        index = (index + 1) % size;
      }
    }
    for (const length of allpasses) {
      const size = Math.round((length + spread) * ratio);
      const delay = new Float32Array(size);
      let index = 0;
      for (let i = 0; i < out.length; i += 1) {
        const buffered = delay[index];
        const value = out[i];
        out[i] = -value + buffered;
        delay[index] = value + buffered * 0.5;
        index = (index + 1) % size;
      }
    }
    return out;
  };
  return [run(left, 0), run(right, 41)];
}

// ------------------------------------------------------------------ the score

/**
 * Composes the film's score. Returns { left, right, sampleRate, mood, label, bpm,
 * key, cues, sync }. `mood` is a MOODS key or 'auto' (from `text`).
 */
export function composeScore(timeline, { mood = 'auto', text = '' } = {}) {
  const chosen = MOODS[mood] ? mood : chooseMood(text);
  const style = MOODS[chosen];
  const random = prng(`${timeline.id || 'film'}|${chosen}`);
  const duration = timeline.totalFrames / timeline.fps;
  const length = Math.round(duration * SAMPLE_RATE);
  const cues = extractCues(timeline);
  const cuts = cues.filter((cue) => cue.type === 'cut').map((cue) => cue.time);
  const bpm = chooseTempo(cuts, style.bpm);
  const beat = 60 / bpm;
  const music = new Bus(length);
  const drums = new Bus(length);
  const fx = new Bus(length);
  const send = new Bus(length);
  const kickEnvelope = new Float32Array(length);
  const shotStarts = timeline.shots.map((shot) => shot.startFrame / timeline.fps);
  const endcard = cues.find((cue) => cue.type === 'endcard')?.time ?? shotStarts.at(-1);
  const sends = (amount) => ({ left: send.left, right: send.right, amount });

  // ---- pad: a chord per shot, cycling the progression, resolving on the end card
  timeline.shots.forEach((shot, index) => {
    const start = shotStarts[index];
    const end = index < timeline.shots.length - 1 ? shotStarts[index + 1] : duration;
    const last = index === timeline.shots.length - 1;
    const notes = last ? style.resolve : style.chords[index % style.chords.length];
    const span = end - start + 0.6;
    const attack = index === 0 ? Math.min(1.6, span * 0.6) : 0.08;
    for (const name of notes) {
      const f = noteFrequency(name);
      // Warm pads are soft tones with gentle harmonics; the others are detuned saws.
      const soft = (frequency) => mixInto(mixInto(sine(frequency, span), sine(frequency * 2, span), 0.22), sine(frequency * 3, span), 0.1);
      const left = style.pad.soft ? soft(f) : saw(f, span, random, -style.pad.detune);
      const right = style.pad.soft ? soft(f * 1.003) : saw(f, span, random, style.pad.detune);
      for (const [voice, pan] of [[left, -0.7], [right, 0.7]]) {
        for (let i = 0; i < voice.length; i += 1) {
          const t = i / SAMPLE_RATE;
          voice[i] *= Math.min(1, t / attack) * Math.min(1, Math.max(0, (span - t) / 0.6));
        }
        biquad(voice, 'low', style.pad.soft ? 3000 : style.pad.cutoff);
        biquad(voice, 'high', 140);
        music.add(start, voice, { gain: style.pad.level, pan, send: sends(0.25) });
      }
    }
  });

  // ---- groove (beats from t = 0): kick, hats, bass, arp; quiet in the opening and on the end card
  const firstGroove = shotStarts[1] ?? 0;
  const kick = (t, gain) => {
    const body = sine(150, 0.45, { sweepTo: 46, curve: 38 });
    for (let i = 0; i < body.length; i += 1) body[i] *= Math.exp(-(i / SAMPLE_RATE) / 0.13);
    const click = envelope(biquad(noise(0.01, random), 'band', 3000, 0.7), 0.0005, 0.003);
    mixInto(body, click, 0.25);
    drums.add(t, body, { gain });
    const at = Math.round(t * SAMPLE_RATE);
    for (let i = 0; i < SAMPLE_RATE * 0.3 && at + i < length; i += 1) kickEnvelope[at + i] = Math.max(kickEnvelope[at + i], Math.exp(-i / (SAMPLE_RATE * 0.12)));
  };
  const hat = (t, gain, pan) => drums.add(t, envelope(biquad(noise(0.07, random), 'high', 7500), 0.001, 0.018), { gain, pan });
  for (let b = 0; b * beat < duration; b += 1) {
    const t = b * beat;
    if (t < firstGroove - 1e-6 || t >= endcard - 0.05) continue;
    const bar = b % 4;
    const e = style.energy;
    if (style.kick === 'four' || (style.kick === 'half' && bar % 2 === 0) || (style.kick === 'sparse' && bar === 0) || (style.kick === 'soft' && bar === 0)) kick(t, (style.kick === 'soft' ? 0.28 : 0.4) * e);
    if (style.kick === 'sparse' && bar === 2 && t + beat / 2 < endcard - 0.05) kick(t + beat / 2, 0.32 * e);
    if (style.hats === 'sixteenths') for (let s = 1; s < 4; s += 1) hat(t + (s * beat) / 4, s === 2 ? 0.17 : 0.1, s % 2 ? -0.45 : 0.45);
    if (style.hats === 'ticks') { hat(t + beat / 2, 0.13, bar % 2 ? 0.5 : -0.5); hat(t + beat * 0.75, 0.06, bar % 2 ? -0.5 : 0.5); }
    if (style.hats === 'brush') { hat(t + beat * 0.5, 0.08, -0.35); hat(t + beat * 0.83, 0.055, 0.35); }
    // bass: eighths on the shot's root
    const shotIndex = Math.max(0, shotStarts.findLastIndex((start) => start <= t + 1e-6));
    const root = noteFrequency(style.bass[shotIndex % style.bass.length]);
    for (const offset of style.energy >= 0.85 ? [0, 0.5] : [0]) {
      const tone = saw(root, beat * 0.45, random);
      mixInto(tone, sine(root, beat * 0.45), 0.6);
      biquad(tone, 'low', 950);
      envelope(tone, 0.004, beat * 0.25);
      for (let i = 0; i < tone.length; i += 1) tone[i] = Math.tanh(tone[i] * 1.6);
      music.add(t + offset * beat, tone, { gain: 0.095 * e });
    }
    // arp: chord tones an octave up
    const chord = style.chords[shotIndex % style.chords.length];
    const steps = style.arp === 'busy' ? 4 : style.arp === 'pulse' ? 2 : bar % 2 === 0 ? 1 : 0;
    for (let s = 0; s < steps; s += 1) {
      const f = noteFrequency(chord[(b * steps + s) % chord.length]) * 2;
      const tone = saw(f, 0.4, random);
      biquad(tone, 'low', style.arp === 'pulse' ? 3800 : 6500);
      envelope(tone, 0.002, 0.12);
      music.add(t + (s * beat) / steps, tone, { gain: 0.09, pan: s % 2 ? 0.6 : -0.6, send: sends(0.35) });
    }
  }

  // ---- sound design on every cue
  const bell = (f, length = 1.2) => {
    const tone = sine(f, length);
    mixInto(tone, scale(sine(f * 2.76, length), 0.35));
    return envelope(tone, 0.002, length * 0.32);
  };
  const voice = (f) => {
    if (style.voice === 'bell') return bell(f, 1.1);
    const tone = style.voice === 'keys' ? sine(f, 0.9) : saw(f, 0.6, random);
    if (style.voice === 'keys') mixInto(tone, scale(sine(f * 2, 0.9), 0.3));
    biquad(tone, 'low', style.voice === 'keys' ? 3000 : 5000);
    return envelope(tone, 0.002, style.voice === 'keys' ? 0.35 : 0.16);
  };
  const whoosh = (length, low, high, gain, pan, panTo) => {
    const sound = noise(length, random);
    biquad(sound, 'band', (i) => low * (high / low) ** (i / sound.length), 1.2);
    for (let i = 0; i < sound.length; i += 1) sound[i] *= Math.sin(Math.PI * (i / sound.length)) ** 2;
    return { sound, gain, pan, panTo };
  };
  const impact = (t, gain) => {
    const boom = sine(52, 1.4, { sweepTo: 42, curve: 6 });
    for (let i = 0; i < boom.length; i += 1) boom[i] *= 0.6 * Math.exp(-(i / SAMPLE_RATE) / 0.4);
    const crack = envelope(biquad(noise(0.5, random), 'low', 2500), 0.001, 0.06);
    mixInto(boom, crack, 1.4);
    drums.add(t, boom, { gain, send: sends(0.35) });
  };
  const riser = (t, length, gain) => {
    const sound = noise(length, random);
    biquad(sound, 'band', (i) => 200 * 40 ** (i / sound.length), 0.9);
    for (let i = 0; i < sound.length; i += 1) sound[i] *= (i / sound.length) ** 2.2;
    fx.add(t, sound, { gain, send: sends(0.2) });
  };
  const chordAt = (t) => style.chords[Math.max(0, shotStarts.findLastIndex((start) => start <= t + 1e-6)) % style.chords.length];
  for (const cue of cues) {
    const t = cue.time;
    switch (cue.type) {
      case 'cut': {
        const strong = cue.transition === 'push' || cue.transition === 'fold';
        impact(t, (strong ? 0.42 : cue.transition === 'cut' ? 0.32 : 0.22) * style.energy);
        break;
      }
      case 'fold-a': case 'fold-b': {
        const { sound } = whoosh(0.28, 900, 3800, 0.2);
        fx.add(t, sound, { gain: 0.2, pan: cue.type === 'fold-a' ? -0.5 : 0.1, panTo: cue.type === 'fold-a' ? 0.1 : 0.7 });
        break;
      }
      case 'wipe': { const { sound } = whoosh(cue.duration, 400, 6000); fx.add(t, sound, { gain: 0.2, pan: -0.9, panTo: 0.9, send: sends(0.15) }); break; }
      case 'push': riser(t, cue.duration, 0.12); break;
      case 'fade': { const { sound } = whoosh(cue.duration, 200, 1200); fx.add(t, sound, { gain: 0.08, send: sends(0.3) }); break; }
      case 'beam': { const { sound } = whoosh(cue.duration, 300, 5000); fx.add(t, sound, { gain: 0.15, pan: -0.9, panTo: 0.9, send: sends(0.3) }); break; }
      case 'word': { const chord = chordAt(t); music.add(t, voice(noteFrequency(chord[cue.index % chord.length]) * 2), { gain: 0.07, pan: -0.3 + cue.index * 0.15, send: sends(0.4) }); break; }
      case 'letter': {
        const chord = chordAt(t);
        const tom = sine(130, 0.4, { sweepTo: 70, curve: 30 });
        envelope(tom, 0.001, 0.11);
        drums.add(t, tom, { gain: 0.24 });
        music.add(t, voice(noteFrequency(chord[cue.index % chord.length]) * 2), { gain: 0.11, pan: -0.5 + cue.index * 0.22, send: sends(0.4) });
        break;
      }
      case 'reveal': music.add(t, bell(noteFrequency(chordAt(t)[0]) * 4, 1.4), { gain: 0.04, send: sends(0.5) }); break;
      case 'sweep': case 'glint': {
        const chord = chordAt(t);
        chord.slice(0, 4).forEach((name, i) => music.add(t + i * 0.06, bell(noteFrequency(name) * 4, 0.9), { gain: 0.025, pan: -0.4 + i * 0.25, send: sends(0.7) }));
        break;
      }
      case 'logo-draw': riser(t, Math.min(1.2, cue.duration), 0.06); break;
      case 'product': {
        const swell = noise(1.2, random);
        biquad(swell, 'low', 500);
        for (let i = 0; i < swell.length; i += 1) swell[i] *= Math.sin(Math.PI * (i / swell.length));
        fx.add(t, swell, { gain: 0.1, send: sends(0.3) });
        break;
      }
      case 'endcard': {
        impact(t, 0.5 * style.energy + 0.1);
        style.resolve.slice(-3).forEach((name, i) => music.add(t + 0.25 + i * 0.3, voice(noteFrequency(name) * 2), { gain: 0.06, send: sends(0.6) }));
        break;
      }
      default: break;
    }
  }
  if (shotStarts.length > 1) riser(Math.max(0, endcard - 0.7), 0.7, 0.1);
  { // a low swell under the opening
    const sub = sine(noteFrequency(style.bass[0]) / 2, Math.min(3, duration));
    for (let i = 0; i < sub.length; i += 1) { const t = i / SAMPLE_RATE; sub[i] *= Math.min(1, t / 1.2) * Math.min(1, Math.max(0, (sub.length / SAMPLE_RATE - t) / 0.4)); }
    music.add(0, sub, { gain: 0.045 });
  }

  // ---- mix, room, master
  const [wetL, wetR] = reverb(send.left, send.right);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const duck = 1 - 0.3 * kickEnvelope[i];
    left[i] = (music.left[i] * duck) + drums.left[i] + fx.left[i] + wetL[i] * 0.75;
    right[i] = (music.right[i] * duck) + drums.right[i] + fx.right[i] + wetR[i] * 0.75;
  }
  biquad(left, 'high', 28);
  biquad(right, 'high', 28);
  const fadeStart = Math.max(0, length - Math.round(0.5 * SAMPLE_RATE));
  let peak = 1e-9;
  for (let i = 0; i < length; i += 1) {
    const fade = i >= fadeStart ? ((length - i) / (length - fadeStart)) ** 1.5 : 1;
    left[i] = Math.tanh(left[i] * 1.3) * fade;
    right[i] = Math.tanh(right[i] * 1.3) * fade;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const normalize = 0.89 / peak;
  for (let i = 0; i < length; i += 1) { left[i] *= normalize; right[i] *= normalize; }
  const score = { left, right, sampleRate: SAMPLE_RATE, mood: chosen, label: style.label, bpm, key: style.key, cues };
  score.sync = measureSync(score, cues.filter((cue) => ['cut', 'endcard', 'letter'].includes(cue.type)).map((cue) => cue.time));
  return score;
}

/**
 * How many of the given cue times have an audible onset within one video frame
 * (1/24 s), measured from the samples themselves.
 */
export function measureSync(score, times, tolerance = 1 / 24) {
  const frame = Math.round(0.005 * score.sampleRate);
  const energy = [];
  for (let i = 0; i + frame <= score.left.length; i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j += 1) sum += (score.left[j] + score.right[j]) ** 2;
    energy.push(Math.log(1e-6 + sum / frame));
  }
  const flux = energy.map((value, i) => Math.max(0, value - (energy[i - 1] ?? value)));
  const hits = times.filter((time) => {
    const center = Math.round(time / 0.005);
    const reach = Math.round(tolerance / 0.005);
    let best = 0;
    for (let k = center - reach; k <= center + reach; k += 1) best = Math.max(best, flux[k] || 0);
    return best > 0.6;
  });
  return { checked: times.length, onTime: hits.length, pass: times.length === 0 || hits.length / times.length >= 0.9 };
}

/** 16-bit PCM WAV bytes for a composed score. */
export function encodeWav({ left, right, sampleRate }) {
  const frames = left.length;
  const buffer = Buffer.alloc(44 + frames * 4);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + frames * 4, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 4, 28); buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i += 1) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), 44 + i * 4);
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), 46 + i * 4);
  }
  return buffer;
}

// ------------------------------------------------------------------ mastering

function filterInPlace(buffer, [b0, b1, b2], [, a1, a2]) {
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  const out = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    const x = buffer[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

/**
 * Integrated loudness in LUFS (ITU-R BS.1770: K-weighting, 400 ms blocks with 75%
 * overlap, an absolute gate at -70 LUFS and a relative gate 10 LU below).
 * Coefficients are the standard ones for 48 kHz.
 */
export function integratedLoudness(left, right) {
  const shelf = [[1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]];
  const highpass = [[1, -2, 1], [1, -1.99004745483398, 0.99007225036621]];
  const weigh = (channel) => filterInPlace(filterInPlace(channel, ...shelf), ...highpass);
  const l = weigh(left);
  const r = weigh(right);
  const block = Math.round(0.4 * SAMPLE_RATE);
  const hop = Math.round(0.1 * SAMPLE_RATE);
  const powers = [];
  for (let start = 0; start + block <= l.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + block; i += 1) sum += l[i] * l[i] + r[i] * r[i];
    powers.push(sum / block);
  }
  const lufs = (power) => -0.691 + 10 * Math.log10(power + 1e-12);
  const absolute = powers.filter((power) => lufs(power) > -70);
  if (absolute.length === 0) return -70;
  const relativeGate = lufs(absolute.reduce((a, b) => a + b, 0) / absolute.length) - 10;
  const gated = absolute.filter((power) => lufs(power) > relativeGate);
  return lufs(gated.reduce((a, b) => a + b, 0) / gated.length);
}

/**
 * Masters a score to `target` LUFS with a look-ahead limiter holding sample peaks
 * under `ceiling` dBFS (about half a dB below it in true peak). Done here, not in
 * FFmpeg, so encoding stays light on small servers.
 */
export function masterScore(score, { target = -14, ceiling = -2 } = {}) {
  const { left, right } = score;
  const gain = 10 ** ((target - integratedLoudness(left, right)) / 20);
  const limit = 10 ** (ceiling / 20);
  const lookahead = Math.round(0.005 * SAMPLE_RATE);
  const release = Math.exp(-1 / (0.08 * SAMPLE_RATE));
  const needed = new Float32Array(left.length);
  for (let i = 0; i < left.length; i += 1) {
    const peak = Math.max(Math.abs(left[i]), Math.abs(right[i])) * gain;
    needed[i] = peak > limit ? limit / peak : 1;
  }
  // Each sample takes the smallest gain needed within the look-ahead window,
  // then the gain recovers smoothly.
  let current = 1;
  for (let i = 0; i < left.length; i += 1) {
    let target = 1;
    for (let j = i; j < Math.min(left.length, i + lookahead); j += 1) target = Math.min(target, needed[j]);
    current = target < current ? target : target + (current - target) * release;
    left[i] *= gain * current;
    right[i] *= gain * current;
  }
  score.loudness = integratedLoudness(left, right);
  score.samplePeak = 20 * Math.log10(left.reduce((m, v, i) => Math.max(m, Math.abs(v), Math.abs(right[i])), 1e-9));
  return score;
}
