#!/usr/bin/env node
/**
 * Builds FOLD Score 2's instrument pack from two public-domain (CC0) libraries:
 * the Versilian Community Sample Library (VCSL) and VSCO 2 Community Edition,
 * both by Versilian Studios. Only the notes the composer needs are downloaded,
 * then converted with ffmpeg to compact mono 32 kHz FLAC (trimmed, faded and
 * level-matched), with a manifest the sampler reads.
 *
 * Reproducible: `node scripts/build-sample-pack.mjs` rebuilds assets/samples
 * from the original sources. Needs network access and ffmpeg.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'assets', 'samples');
const SOURCES = {
  vcsl: 'https://raw.githubusercontent.com/sgossner/VCSL/master/',
  vsco: 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master/',
};
const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "A#3", "Bb2", "C4" -> MIDI number. */
export function midiFromName(name) {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!match) return undefined;
  return 12 * (Number(match[3]) + 1) + NOTE_INDEX[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
}

/**
 * Each instrument: where its notes live, which file per note, how long to keep,
 * and which notes to take (a spread across the range is enough: the sampler
 * pitch-shifts to the notes in between).
 */
const INSTRUMENTS = {
  piano: { source: 'vcsl', dir: 'Chordophones/Zithers/Grand Piano, Steinway B/NoSus/', pattern: /JHPiano_NoSus_Close_([A-G]#?\d)_vl3_rr1\.wav$/, keep: 4.0, every: 3, range: [33, 96] },
  violins: { source: 'vsco', dir: 'Strings/Violin Section/susVib/', pattern: /VlnEns_susVib_([A-G]#?\d)_v1\.wav$/, keep: 4.5, every: 1, range: [55, 100], sustain: true, octave: 1 },
  cellos: { source: 'vsco', dir: 'Strings/Cello Section/susvib/', pattern: /susvib_([A-G]#?\d)_v1_1\.wav$/, keep: 4.5, every: 1, range: [36, 76], sustain: true, octave: 1 },
  harp: { source: 'vsco', dir: 'Strings/Harp/', pattern: /KSHarp_([A-G]#?\d)_(?:mf|mp|f)\.wav$/, keep: 3.0, every: 1, range: [36, 100] },
  glock: { source: 'vsco', dir: 'Percussion/Glock/', pattern: /glock_medium_([A-G]#?\d)\.wav$/, keep: 2.5, every: 1, range: [72, 108], octave: 1 },
  bass: { source: 'vsco', dir: 'Strings/Solo Contrabass/SusNV/', pattern: /([A-G]#?\d)[^/]*\.wav$/, keep: 4.0, every: 1, range: [28, 60], sustain: true, octave: 1 },
  pizz: { source: 'vsco', dir: 'Strings/Solo Contrabass/Pizz/', pattern: /([A-G]#?\d)[^/]*\.wav$/, keep: 1.6, every: 1, range: [28, 60], octave: 1 },
  marimba: { source: 'vsco', dir: 'Percussion/', pattern: /Marimba[^/]*?([A-G]#?\d)[^/]*\.wav$/, keep: 1.8, every: 1, range: [48, 100], octave: 1 },
};
const HITS = {
  'bass-drum': { source: 'vsco', file: 'Percussion/BDrumNewhit_v5_rr1_Sum.wav', keep: 2.2 },
  timpani: { source: 'vsco', file: 'Percussion/Timpani/Timpani1_Hit_v3_rr1_Sum.wav', keep: 3.0 },
  'timpani-roll': { source: 'vsco', file: 'Percussion/Timpani/Rolls/Timpani1_Roll_v3_rr1_Sum.wav', keep: 4.0 },
  'cymbal-swell': { source: 'vsco', file: 'Percussion/susCymb1-cresc-Short_v1.wav', keep: 6 },
  'cymbal-swell-long': { source: 'vsco', file: 'Percussion/susCymb1-cresc-Median_v1.wav', keep: 8 },
  crash: { source: 'vsco', pick: /Percussion\/cymbal-crash1[^/]*\.wav$/, keep: 3.5 },
  triangle: { source: 'vsco', pick: /Percussion\/Triangle3-Hit_[^/]*\.wav$/, keep: 2.5 },
  tambourine: { source: 'vsco', pick: /Percussion\/Tamb1-Hit[^/]*\.wav$/, keep: 1.0 },
  shaker: { source: 'vcsl', pick: /Idiophones\/Struck Idiophones\/Shaker, Small\/[^/]*\.wav$/, keep: 0.6 },
  clap: { source: 'vcsl', pick: /Idiophones\/Struck Idiophones\/Claps\/[^/]*\.wav$/, keep: 0.8 },
  snare: { source: 'vsco', pick: /Percussion\/Snare2-HitNS[^/]*\.wav$/, keep: 1.0 },
};

function listing(source) {
  const repo = source === 'vcsl' ? 'sgossner/VCSL' : 'sgossner/VSCO-2-CE';
  // GitHub limits unauthenticated listings; set GITHUB_TOKEN to raise the limit.
  const auth = process.env.GITHUB_TOKEN ? ['-H', `Authorization: Bearer ${process.env.GITHUB_TOKEN}`] : [];
  const body = JSON.parse(execFileSync('curl', ['-sL', ...auth, `https://api.github.com/repos/${repo}/git/trees/master?recursive=1`], { maxBuffer: 64 * 1024 * 1024 }));
  if (!Array.isArray(body.tree)) throw new Error(`Couldn't list ${repo}: ${body.message || 'no file listing'}. Set GITHUB_TOKEN and try again.`);
  return body.tree.filter((item) => item.type === 'blob').map((item) => item.path);
}

function convert(url, out, keep) {
  const temp = path.join(os.tmpdir(), `fold-sample-${process.pid}.wav`);
  execFileSync('curl', ['-sL', '--fail', '-o', temp, url]);
  // Mono, 32 kHz, trimmed to `keep` seconds with a fade, leading silence removed,
  // peak-normalized to -1 dB so instruments start level-matched.
  const fade = Math.min(0.6, keep * 0.25);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', temp,
    '-af', `silenceremove=start_periods=1:start_threshold=-60dB,atrim=0:${keep},afade=t=out:st=${keep - fade}:d=${fade},loudnorm=I=-20:TP=-1:LRA=11,alimiter=limit=0.89`,
    '-ac', '1', '-ar', '32000', '-sample_fmt', 's16', out]);
  rmSync(temp, { force: true });
}

function main() {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const trees = { vcsl: listing('vcsl'), vsco: listing('vsco') };
  const manifest = { version: 1, sampleRate: 32000, license: 'CC0-1.0', sources: ['https://github.com/sgossner/VCSL', 'https://github.com/sgossner/VSCO-2-CE'], instruments: {}, hits: {} };
  for (const [name, spec] of Object.entries(INSTRUMENTS)) {
    const notes = new Map();
    for (const file of trees[spec.source].filter((item) => item.startsWith(spec.dir))) {
      const match = spec.pattern.exec(file);
      // Some libraries number octaves one lower than scientific pitch (a cello's
      // lowest note labelled C1): `octave` shifts those names to the true pitch,
      // checked by measuring each instrument's fundamental.
      const midi = match && midiFromName(match[1]) + 12 * (spec.octave || 0);
      if (!Number.isNaN(midi) && midi !== undefined && midi >= spec.range[0] && midi <= spec.range[1] && !notes.has(midi)) notes.set(midi, file);
    }
    const sorted = [...notes.keys()].sort((a, b) => a - b);
    const chosen = sorted.filter((midi, index) => index === 0 || index === sorted.length - 1 || midi - sorted[0] >= 0 && (sorted.indexOf(midi) % spec.every === 0));
    mkdirSync(path.join(OUT, name), { recursive: true });
    manifest.instruments[name] = { sustain: Boolean(spec.sustain), zones: [] };
    for (const midi of chosen) {
      const file = `${name}/${midi}.flac`;
      convert(SOURCES[spec.source] + encodeURI(notes.get(midi)).replace(/#/g, '%23'), path.join(OUT, file), spec.keep);
      manifest.instruments[name].zones.push({ midi, file });
    }
    console.log(`${name}: ${chosen.length} notes`);
  }
  mkdirSync(path.join(OUT, 'hits'), { recursive: true });
  for (const [name, spec] of Object.entries(HITS)) {
    const source = spec.file || trees[spec.source].find((item) => spec.pick.test(item));
    if (!source) { console.log(`${name}: not found`); continue; }
    const file = `hits/${name}.flac`;
    convert(SOURCES[spec.source] + encodeURI(source).replace(/#/g, '%23'), path.join(OUT, file), spec.keep);
    manifest.hits[name] = { file };
    console.log(`${name}: ${path.basename(source)}`);
  }
  writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(OUT, 'LICENSE.txt'), 'FOLD Score 2 instrument pack.\n\nAll samples are from the Versilian Community Sample Library (VCSL) and VSCO 2\nCommunity Edition by Versilian Studios LLC, released under Creative Commons Zero\n(CC0 1.0, public domain): https://github.com/sgossner/VCSL and\nhttps://github.com/sgossner/VSCO-2-CE. Trimmed, converted and level-matched by\nscripts/build-sample-pack.mjs. No attribution is required; this note is a courtesy.\n');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
