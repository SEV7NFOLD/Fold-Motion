/**
 * FOLD Score 2's band: real recorded instruments (assets/samples, CC0), played by
 * a small sampler and arranged from the music book around the film's timeline.
 * composeScore() calls the band in place of its synth pad, bass and arp; drums,
 * sound design, ducking, the room and the master stay as they are.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOK, RUN_INTO } from './music-book.mjs';

const PACK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'samples');
const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
let cached = null;

/** "A#3", "Bb2", "C4" -> MIDI number. */
export function midiFromName(name) {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(String(name));
  if (!match) return undefined;
  return 12 * (Number(match[3]) + 1) + NOTE_INDEX[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
}

function decode(file, sampleRate) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(sampleRate), '-'], { maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Couldn't decode ${path.basename(file)}: ${String(result.stderr).trim()}`);
  const bytes = result.stdout;
  const copy = new Float32Array(bytes.length / 4);
  for (let i = 0; i < copy.length; i += 1) copy[i] = bytes.readFloatLE(i * 4);
  return copy;
}

/**
 * Seconds until a sample's attack arrives (bowed strings take up to 0.2 s to
 * speak): the first point above a tenth of its peak. Notes are scheduled early by
 * this much so the attack lands on the beat.
 */
export function onsetOf(data, rate) {
  let peak = 0;
  for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
  for (let i = 0; i < data.length; i += 1) if (Math.abs(data[i]) > peak * 0.1) return i / rate;
  return 0;
}

/**
 * Loads the instrument pack once per process (decoded at the pack's own rate to
 * keep memory low; the sampler resamples as it plays). Throws if the pack or
 * ffmpeg is missing, so callers can fall back to the synth score.
 */
export function loadInstrumentPack(dir = PACK_DIR) {
  if (cached?.dir === dir) return cached;
  const manifestPath = path.join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error('The instrument pack is missing (assets/samples).');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const rate = manifest.sampleRate;
  const instruments = {};
  for (const [name, spec] of Object.entries(manifest.instruments)) {
    instruments[name] = { sustain: spec.sustain, zones: spec.zones.map((zone) => { const data = decode(path.join(dir, zone.file), rate); return { midi: zone.midi, data, onset: onsetOf(data, rate) }; }) };
  }
  const hits = {};
  const hitOnsets = {};
  for (const [name, spec] of Object.entries(manifest.hits)) { hits[name] = decode(path.join(dir, spec.file), rate); hitOnsets[name] = onsetOf(hits[name], rate); }
  cached = { dir, rate, instruments, hits, hitOnsets };
  return cached;
}

/**
 * One note from a sampled instrument at the score's sample rate: pitch-shifted
 * from the nearest recorded note, looped with a crossfade when a sustained note
 * outlasts its sample, shaped by attack and release.
 */
export function playNote(pack, instrument, midi, { duration, velocity = 0.6, attack = 0.005, release = 0.25, sampleRate = 48_000 }) {
  const voice = pack.instruments[instrument];
  if (!voice) return new Float32Array(0);
  const zone = nearestZone(voice, midi);
  const data = zone.data;
  const rate = 2 ** ((midi - zone.midi) / 12) * (pack.rate / sampleRate);
  let length = Math.round((duration + release) * sampleRate);
  if (!voice.sustain) length = Math.min(length, Math.floor((data.length - 2) / rate));
  const out = new Float32Array(Math.max(0, length));
  const loopStart = Math.floor(data.length * 0.35);
  const loopEnd = Math.floor(data.length * 0.85);
  const loopLength = loopEnd - loopStart;
  const fade = Math.floor(pack.rate * 0.12);
  const read = (position) => {
    const i = Math.floor(position);
    const t = position - i;
    return data[i] + (data[Math.min(i + 1, data.length - 1)] - data[i]) * t;
  };
  const level = (0.25 + 0.75 * velocity) ** 1.4;
  const attackSamples = Math.max(1, attack * sampleRate);
  const releaseStart = duration * sampleRate;
  const releaseSamples = Math.max(1, release * sampleRate);
  let position = 0;
  for (let i = 0; i < out.length; i += 1) {
    let value;
    if (voice.sustain && position >= loopEnd) position -= loopLength;
    if (voice.sustain && position > loopEnd - fade) {
      const w = (position - (loopEnd - fade)) / fade;
      value = read(position) * (1 - w) + read(position - loopLength) * w;
    } else {
      value = position < data.length - 1 ? read(position) : 0;
    }
    const envelope = Math.min(1, i / attackSamples) * (i < releaseStart ? 1 : Math.max(0, 1 - (i - releaseStart) / releaseSamples));
    out[i] = value * level * envelope;
    position += rate;
  }
  return out;
}

function nearestZone(voice, midi) {
  return voice.zones.reduce((best, item) => (Math.abs(item.midi - midi) < Math.abs(best.midi - midi) ? item : best));
}

/** When a note's attack arrives, at the pitch it's played (faster playback arrives sooner). */
export function noteOnset(pack, instrument, midi) {
  const voice = pack.instruments[instrument];
  if (!voice) return 0;
  const zone = nearestZone(voice, midi);
  return zone.onset / 2 ** ((midi - zone.midi) / 12);
}

/** A percussion hit at the score's rate. */
export function playHit(pack, name, { sampleRate = 48_000 } = {}) {
  const data = pack.hits[name];
  if (!data) return new Float32Array(0);
  const ratio = pack.rate / sampleRate;
  const out = new Float32Array(Math.floor((data.length - 1) / ratio));
  for (let i = 0; i < out.length; i += 1) {
    const p = i * ratio;
    const j = Math.floor(p);
    out[i] = data[j] + (data[j + 1] - data[j]) * (p - j);
  }
  return out;
}

/**
 * The band for composeScore(): returns a function that arranges the mood's parts
 * onto the music bus. Throws when the pack can't load (the caller falls back).
 */
export function instrumentBand({ dir } = {}) {
  const pack = loadInstrumentPack(dir);
  return function band({ music, sends, style, chosen, grid, shotStarts, endcard, duration, cues, random, sampleRate }) {
    const book = BOOK[chosen] || BOOK.premium;
    // A few milliseconds of human looseness, seeded: tight, not robotic.
    const jitter = () => (random() - 0.5) * 0.006;
    const vary = ([low, high]) => low + (high - low) * random();
    const midiOf = (names) => names.map(midiFromName).filter((value) => value !== undefined);
    const breath = Math.max(0, endcard - 0.25);
    const lastIndex = shotStarts.length - 1;
    const chordFor = (index) => midiOf(index === lastIndex ? style.resolve : style.chords[index % style.chords.length]);
    // Every note is scheduled early by its attack time, so the attack lands on time.
    const note = (instrument, midi, time, options) => {
      if (time >= duration) return;
      const early = Math.min(0.25, noteOnset(pack, instrument, midi));
      const signal = playNote(pack, instrument, midi, { ...options, duration: options.duration + early, sampleRate });
      music.add(Math.max(0, time - early), signal, { gain: options.gain, pan: options.pan || 0, send: sends(options.send ?? 0.2) });
    };
    const hit = (name, time, gain, send = 0.15) => {
      if (!name || time >= duration) return;
      const early = Math.min(0.1, pack.hitOnsets[name] || 0);
      music.add(Math.max(0, time - early), playHit(pack, name, { sampleRate }), { gain, send: sends(send) });
    };
    // Subdivisions of the tempo map within one shot, every `step` beats.
    const pulses = (index, step, until) => grid.filter((g) => g.shot === index).flatMap((g) => {
      const times = [];
      for (let s = 0; s < 1; s += step) times.push({ time: g.time + s * g.beat, length: g.beat * step, k: g.k, sub: s });
      return step > 1 ? (g.k % step === 0 ? [{ time: g.time, length: g.beat * step, k: g.k, sub: 0 }] : []) : times;
    }).filter((p) => p.time < until - 0.04);

    shotStarts.forEach((start, index) => {
      const last = index === lastIndex;
      const chord = chordFor(index);
      const shotEnd = index < lastIndex ? shotStarts[index + 1] : duration;
      // Parts stop for the breath before the end card; the end card has its own chord.
      const end = last ? duration : Math.min(shotEnd, breath);
      const span = Math.max(0.2, end - start);
      const opening = index === 0;
      // ---- pad: low voices to the cellos, upper voices an octave up to the violins
      for (const layer of book.pad) {
        const voices = layer.voices === 'low' ? chord.slice(0, 2) : chord.slice(2).map((midi) => midi + 12);
        voices.forEach((midi, v) => note(layer.instrument, midi, start, {
          duration: span, velocity: last ? 0.62 : 0.5, attack: opening ? Math.min(1.4, span * 0.5) : last ? 0.3 : 0.04,
          release: last ? 1.2 : 0.18, gain: layer.gain / Math.sqrt(voices.length), pan: (v / Math.max(1, voices.length - 1) - 0.5) * 0.8, send: 0.35,
        }));
      }
      if (last) return;
      // ---- bass, on the grid
      const root = chord[0] - 12;
      if (book.bass.pattern === 'held') {
        note(book.bass.instrument, root, start, { duration: span, velocity: 0.5, attack: opening ? 0.8 : 0.03, release: 0.18, gain: book.bass.gain, send: 0.08 });
      } else if (!opening) {
        const step = book.bass.pattern === 'eighths' ? 0.5 : 2;
        for (const p of pulses(index, step, end)) note(book.bass.instrument, root, p.time + jitter(), { duration: Math.min(p.length * 0.9, end - p.time), velocity: p.sub === 0 ? 0.72 : 0.58, release: 0.08, gain: book.bass.gain, send: 0.05 });
      }
      // ---- keys and lead: patterns from the chord's own tones, ending at the chord change
      for (const part of [book.keys, book.lead].filter(Boolean)) {
        const tones = chord.map((midi) => midi + 12);
        pulses(index, part.step, end).forEach((p, n) => {
          if (opening && n % 2 === 1) return;
          let pitch;
          if (part.pattern === 'broken') pitch = n % 4 === 0 ? tones[0] - 12 : tones[[1, 2, 3, 2][n % 4] % tones.length];
          else if (part.pattern === 'ostinato') pitch = tones[[0, 2, 4, 2][n % 4] % tones.length];
          else if (part.pattern === 'pulse') pitch = n % 2 === 0 ? tones[0] : tones[tones.length - 1];
          else pitch = tones[tones.length - 1] + (n % 2 ? 0 : 2);
          const accent = p.sub === 0 && p.k % 2 === 0 ? 1 : 0.82;
          note(part.instrument, pitch, p.time + jitter(), { duration: Math.min(p.length * 1.5, end - p.time), velocity: vary(part.velocity) * accent, release: 0.15, gain: part.gain, pan: n % 2 ? 0.25 : -0.25, send: 0.3 });
        });
      }
      // ---- rhythm, on the grid (from the second shot)
      if (!opening) {
        for (const groove of book.rhythm) {
          const step = groove.offbeats ? 1 : groove.every || 1;
          for (const p of pulses(index, step, end)) {
            if (groove.beats && (p.sub !== 0 || !groove.beats.includes(p.k % 4))) continue;
            const time = groove.offbeats ? p.time + p.length / 2 : p.time;
            if (time >= end - 0.04) continue;
            hit(groove.hit, time + jitter(), groove.gain * (p.sub === 0 ? 1 : 0.7) * vary([0.88, 1]), 0.08);
          }
        }
      }
    });

    // ---- cues: hits on cuts, runs and swells into transitions, one sparkle per shot
    const sparkled = new Set();
    for (const cue of cues) {
      if (cue.type === 'cut' && book.hits.cut && cue.time < breath) hit(book.hits.cut.name, cue.time, book.hits.cut.gain, 0.2);
      if (RUN_INTO.includes(cue.type) && cue.time < breath) {
        // A harp run in sixteenths of the local beat, landing on the transition.
        const index = Math.max(0, shotStarts.findLastIndex((start) => start <= cue.time));
        const local = grid.find((g) => g.shot === index)?.beat || 0.6;
        const tones = chordFor(index).map((midi) => midi + 12);
        for (let k = 0; k < 5; k += 1) note(book.run.instrument, tones[k % tones.length] + 12 * Math.floor(k / tones.length), cue.time - (5 - k) * (local / 4), { duration: 0.7, velocity: 0.42 + k * 0.05, release: 0.6, gain: book.run.gain, pan: -0.4 + k * 0.2, send: 0.4 });
        const swell = playHit(pack, book.hits.swell.name, { sampleRate });
        let peak = 0;
        for (let i = 1; i < swell.length; i += 1) if (Math.abs(swell[i]) > Math.abs(swell[peak])) peak = i;
        music.add(cue.time - peak / sampleRate, swell, { gain: book.hits.swell.gain, send: sends(0.3) });
      }
      if (book.sparkle.cues.includes(cue.type) && cue.time < breath) {
        const index = Math.max(0, shotStarts.findLastIndex((start) => start <= cue.time));
        if (sparkled.has(index)) continue;
        // Quantized to the nearest half beat, or left out.
        const halves = pulses(index, 0.5, breath);
        const nearest = halves.reduce((best, p) => (Math.abs(p.time - cue.time) < Math.abs(best.time - cue.time) ? p : best), halves[0] || { time: Infinity });
        if (Math.abs(nearest.time - cue.time) > 0.15) continue;
        sparkled.add(index);
        let pitch = chordFor(index).at(-1);
        while (pitch < 84) pitch += 12;
        note(book.sparkle.instrument, pitch, nearest.time, { duration: 1, velocity: 0.45, release: 0.9, gain: book.sparkle.gain, pan: 0.3, send: 0.45 });
      }
    }

    // ---- the payoff: the home chord on the end card, low piano root to high glockenspiel
    const home = midiOf(style.resolve);
    const ring = Math.max(0.5, duration - endcard);
    note('piano', home[0] - 12, endcard, { duration: ring, velocity: 0.62, release: 1.5, gain: 0.7, send: 0.3 });
    home.slice(0, 4).forEach((midi) => note('piano', midi, endcard, { duration: ring, velocity: 0.48, release: 1.5, gain: 0.42, send: 0.35 }));
    let top = home.at(-1);
    while (top < 84) top += 12;
    note('glock', top, endcard, { duration: ring, velocity: 0.55, release: 1.5, gain: 0.22, pan: 0.3, send: 0.5 });
    for (const item of book.hits.endcard) hit(item.name, endcard, item.gain, 0.25);
    return { engine: 'instruments' };
  };
}
