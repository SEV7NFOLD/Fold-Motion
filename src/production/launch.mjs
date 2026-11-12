/**
 * Launch style planner (docs/LAUNCH-STYLE-BUILD-PLAN.md, Phases 3–4).
 *
 * Gives every shot of a beat-timed timeline a motion device and the beats its
 * copy appears on. The browser renderer's launch runtime (src/browser/
 * launch-runtime.js) draws from this plan. Device choice is deterministic for
 * now; Phase 7 teaches the AI planner to choose.
 *
 * - first shot: `build`  (copy appears beat by beat; the camera chases it)
 * - last shot:  `lockup` (the copy assembles from depth, letter by letter), up to six words
 * - a list ("With neroli, mandarin, frankincense & lavender"): `swap`
 * - one or two words: `punch` (lands huge, then settles)
 * - anything else: `build`
 *
 * Copy is never rewritten: beats come from splitIntoBeats, which always adds
 * back up to the exact copy.
 */
import { FUNCTION_WORDS, splitIntoBeats } from './beats.mjs';
import { minimumBeats } from './pacing.mjs';

const DETERMINERS = new Set(['a', 'an', 'the', 'your', 'our', 'my', 'its', 'their', 'this', 'that', 'these', 'those', 'every']);

export const LAUNCH_DEVICES = Object.freeze(['build', 'swap', 'punch', 'lockup', 'type', 'check', 'count']);
export const LAUNCH_TRANSITIONS = Object.freeze(['fly-into', 'flip', 'whip', 'collapse']);
// Beats each transition takes from the end of the outgoing shot (copy must be read before it starts).
export const TRANSITION_BEATS = Object.freeze({ 'fly-into': 1, collapse: 0.75, flip: 0.5, whip: 0.25 });

/**
 * Continuity between shots, and the light/dark theme each shot sits in:
 * - into a closing lockup: `collapse` (the words converge; the lockup bursts out)
 * - a build or punch ending in a period, once per film: `fly-into` (the camera
 *   dives into the dot until it becomes the next background)
 * - otherwise alternating `flip` (a feathered circle opens the next scene) and
 *   `whip` (a fast push).
 * fly-into and flip switch theme (brand colour ↔ paper); whip and collapse keep it.
 */
export function planTransitions(devices, copies) {
  const out = []; const theme = ['brand']; let flew = false; let alternate = 'flip';
  for (let i = 0; i < devices.length; i += 1) {
    if (i === devices.length - 1) { out.push(null); break; }
    let t;
    if (devices[i + 1] === 'lockup') t = 'collapse';
    else if (!flew && ['build', 'punch'].includes(devices[i]) && /\.["'”’)]*\s*$/.test(copies[i])) { t = 'fly-into'; flew = true; }
    else { t = alternate; alternate = alternate === 'flip' ? 'whip' : 'flip'; }
    out.push(t);
    const switches = t === 'fly-into' || t === 'flip';
    theme.push(switches ? (theme[i] === 'brand' ? 'paper' : 'brand') : theme[i]);
  }
  return { out, theme };
}

/**
 * A list sentence split into a lead and items whose raw slices join back to the
 * exact copy: "With neroli, mandarin, frankincense & lavender." ->
 * lead "With", items ["neroli,", "mandarin,", "frankincense", "& lavender."].
 */
export function listParts(copy) {
  const text = String(copy);
  const match = /^(.*?)\s*([^,]+(?:,\s*[^,]+)+?)(?:,?\s*(?:&|and)\s+)([^,&]+?)([.!?]?)\s*$/i.exec(text.trim());
  if (!match) return null;
  const head = match[1] + (match[1] ? ' ' : '') + match[2];
  const pieces = head.split(',').map((p) => p.trim()).filter(Boolean);
  // the first item keeps its determiner ("your fonts"); prepositions stay in the lead ("With")
  const firstWords = pieces[0].split(/\s+/);
  let cut0 = firstWords.length - 1;
  while (cut0 > 0 && DETERMINERS.has(firstWords[cut0 - 1].toLowerCase())) cut0 -= 1;
  const names = [firstWords.slice(cut0).join(' '), ...pieces.slice(1), match[3].trim()];
  if (names.length < 3 || names.some((i) => i.split(/\s+/).length > 3)) return null;
  // cut points in the original text: each item's start, and the connector before the last item
  const starts = []; let from = 0;
  names.forEach((name, i) => {
    const at = text.indexOf(name, from);
    starts.push(at); from = at + name.length;
  });
  const connector = text.slice(0, starts[starts.length - 1]).search(/(,?\s*(?:&|and)\s+)$/i);
  if (starts.some((s) => s < 0) || connector < 0) return null;
  const cut = [starts[0], ...starts.slice(1, -1), text.slice(0, connector).length + text.slice(connector).search(/[&a]/i)];
  const raw = [text.slice(0, cut[0]), ...cut.map((c, i) => text.slice(c, i < cut.length - 1 ? cut[i + 1] : text.length))];
  if (raw.join('') !== text) return null;
  return { lead: raw[0].trim(), items: raw.slice(1).map((r) => r.trim()), raw };
}

/**
 * Word-level beats for short build lines, the benchmark's rhythm: each beat is one
 * main word with the small words before it ("Your idea", "deserves", "motion.").
 */
export function wordBeats(copy) {
  const words = String(copy).trim().split(/\s+/).filter(Boolean);
  const beats = []; let pending = [];
  const small = (w) => FUNCTION_WORDS.has(w.replace(/^["'“‘(\[]+|["'”’)\].,;:!?—–]+$/g, '').toLowerCase());
  for (const w of words) {
    pending.push(w);
    if (!small(w)) { beats.push(pending.join(' ')); pending = []; }
  }
  if (pending.length) beats.length ? (beats[beats.length - 1] += ` ${pending.join(' ')}`) : beats.push(pending.join(' '));
  return beats;
}

/** Beat offsets (from the shot start) for a run of copy pieces that must fit in `available` beats. */
function schedule(pieces, bpm, available, { startAt = 0.5, holdOf } = {}) {
  const holds = pieces.map((piece, i) => Math.max(1, holdOf(piece, i)));
  const lastRead = minimumBeats(pieces[pieces.length - 1], bpm);
  const room = Math.max(0.5 * (pieces.length - 1), available - startAt - lastRead);
  const used = holds.slice(0, -1).reduce((s, h) => s + h, 0);
  const scale = used > room && used > 0 ? room / used : 1;
  const at = []; let cursor = startAt;
  pieces.forEach((_, i) => {
    at.push(Math.round(cursor * 2) / 2);
    // compressed holds round down, so squeezing never pushes the last piece past its reading time
    if (i < pieces.length - 1) cursor += Math.max(0.5, (scale < 1 ? Math.floor : Math.round)(holds[i] * scale * 2) / 2);
  });
  return at;
}

/** The text inside quotation marks when the whole copy is a quote (a prompt or brief), else null. */
export function quotedText(copy) {
  const m = /^\s*["“](.+?)["”]\s*$/.exec(String(copy));
  return m ? m[1] : null;
}
/** Two to four short sentences ("Exact copy. Your fonts. On the beat.") as checklist rows, else null. */
export function checklistRows(copy) {
  const text = String(copy).trim();
  const rows = text.match(/[^.!?]+[.!?]+/g);
  if (!rows || rows.join('').replace(/\s+/g, '') !== text.replace(/\s+/g, '')) return null;
  const clean = rows.map((r) => r.trim());
  if (clean.length < 2 || clean.length > 4 || clean.some((r) => r.split(/\s+/).length > 6)) return null;
  return clean;
}
/** The first number in a short line ("3 formats, one story."), split around it so the parts join back exactly. */
export function countParts(copy) {
  const text = String(copy);
  const words = text.trim().split(/\s+/);
  if (words.length > 6) return null;
  const m = /(^|[^\d.,])(\d{1,3}(?:,\d{3})*|\d+)(?![\d.,]\d)/.exec(text);
  if (!m) return null;
  const start = m.index + m[1].length; const digits = m[2];
  const value = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0 || value > 1e7) return null;
  return { before: text.slice(0, start), number: digits, value, after: text.slice(start + digits.length), grouped: digits.includes(',') };
}

function deviceFor(copy, index, count) {
  const words = String(copy).trim().split(/\s+/).filter(Boolean);
  if (quotedText(copy)) return 'type';
  if (index === count - 1 && count > 1 && words.length <= 6) return 'lockup';
  if (index > 0 && checklistRows(copy)) return 'check';
  if (index > 0 && countParts(copy)) return 'count';
  if (index > 0 && index < count - 1 && listParts(copy)) return 'swap';
  if (index > 0 && words.length <= 2) return 'punch';
  return 'build';
}

/** Plans devices and beat timings for a beat-timed timeline. Returns the plan; also sets shot.spec.launch. */
export function planLaunch(timeline, storyboard) {
  if (!timeline.beat) throw new Error('planLaunch needs a beat-timed timeline (compile with context.beat).');
  const { bpm, framesPerBeat } = timeline.beat;
  const copies = timeline.shots.map((_, index) => storyboard.shots[index]?.onScreenCopy ?? '');
  const devices = timeline.shots.map((_, index) => deviceFor(copies[index], index, timeline.shots.length));
  const { out, theme } = planTransitions(devices, copies);
  const shots = timeline.shots.map((shot, index) => {
    const copy = storyboard.shots[index]?.onScreenCopy ?? '';
    // the outgoing transition's beats are reserved: copy must be read before it starts
    const beatsAvailable = shot.durationFrames / framesPerBeat - (out[index] ? TRANSITION_BEATS[out[index]] : 0);
    const words = copy.trim().split(/\s+/).filter(Boolean);
    // a lockup assembles letter by letter, so it's only for short closing lines
    const last = index === timeline.shots.length - 1 && timeline.shots.length > 1 && words.length <= 6;
    const list = !last && index > 0 ? listParts(copy) : null;
    let plan;
    // the opening shot waits half a beat for the camera's zoom; later shots land content on the cut
    const startAt = index === 0 ? 0.5 : 0;
    const device = devices[index];
    const BEAT = 60 / bpm;
    if (device === 'type') {
      // typed at about 18 characters a second, then the cursor clicks the card's button
      const text = quotedText(copy);
      const typeBeats = Math.max(1, Math.round(((text.length / 18) / BEAT) * 2) / 2);
      const at = startAt + 0.5;
      // the click comes at least half a beat after typing ends, and before the outgoing transition
      plan = { device: 'type', copy, text, at, typeBeats, clickAt: Math.max(at + typeBeats + 0.5, Math.min(beatsAvailable - 0.5, at + typeBeats + 1)) };
    } else if (device === 'check') {
      const rows = checklistRows(copy);
      plan = { device: 'check', copy, rows, at: schedule(rows, bpm, beatsAvailable, { startAt, holdOf: (p) => minimumBeats(p, bpm) / 2 }) };
    } else if (device === 'count') {
      plan = { device: 'count', copy, ...countParts(copy), at: startAt, countBeats: 1.5 };
    } else if (last) {
      plan = { device: 'lockup', copy, at: startAt };
    } else if (list) {
      // the lead is read with the first item, so the first item holds for both (less the half-beat the lead led by)
      const itemsAt = list.lead ? startAt + 0.5 : startAt;
      const holdOf = (p, i) => (i === 0 && list.lead ? minimumBeats(`${list.lead} ${p}`, bpm) - (itemsAt - startAt) : minimumBeats(p, bpm));
      plan = { device: 'swap', copy, lead: list.lead, items: list.items, leadAt: startAt, at: schedule(list.items, bpm, beatsAvailable, { startAt: itemsAt, holdOf }) };
    } else if (index > 0 && words.length <= 2) {
      plan = { device: 'punch', copy, at: startAt };
    } else {
      // short lines build word by word; longer ones in short phrases
      const beats = words.length <= 7 ? wordBeats(copy) : splitIntoBeats(copy).map((b) => b.text);
      // a built line stays on screen, so each beat needs only part of its reading time before the next arrives
      plan = { device: 'build', copy, beats, at: schedule(beats, bpm, beatsAvailable, { startAt, holdOf: (p) => minimumBeats(p, bpm) / 2 }) };
    }
    Object.assign(plan, { out: out[index], theme: theme[index] });
    shot.spec.launch = plan;
    return { shotId: shot.shotId, ...plan };
  });
  return { version: 1, bpm, shots };
}

/**
 * Reading-time QA for a planned launch timeline: every piece of copy must stay
 * on screen at least its reading time (a built line stays until the cut; a
 * swapped item until the next item arrives).
 */
export function launchReadingCheck(timeline) {
  const BEAT = 60 / timeline.beat.bpm;
  const failures = [];
  for (const shot of timeline.shots) {
    const L = shot.spec.launch; if (!L) continue;
    const length = shot.durationFrames / timeline.fps - (L.out ? TRANSITION_BEATS[L.out] * BEAT : 0);
    const pieces = L.device === 'build' ? L.beats.map((text, i) => ({ text: L.beats.slice(0, i + 1).join(' '), from: L.at[i] * BEAT, to: length }))
      // the lead is read once, with the first item; later items need only their own reading time
      : L.device === 'swap' ? L.items.map((text, i) => ({ text: i === 0 ? [L.lead, text].filter(Boolean).join(' ') : text, from: (i === 0 && L.lead ? L.leadAt : L.at[i]) * BEAT, to: i < L.items.length - 1 ? L.at[i + 1] * BEAT : length }))
        : L.device === 'check' ? L.rows.map((text, i) => ({ text, from: L.at[i] * BEAT, to: length }))
          // typed and counted lines are read as they appear (typing runs near reading speed), and their
          // finished state must also stay on screen a moment: 0.3 s for typing, 0.4 s for the final number
          : L.device === 'type' ? [{ text: L.text, from: L.at * BEAT, to: length, settled: (L.at + L.typeBeats) * BEAT, hold: 0.3 }]
            : L.device === 'count' ? [{ text: L.copy, from: L.at * BEAT, to: length, settled: (L.at + L.countBeats) * BEAT, hold: 0.4 }]
              : [{ text: L.copy, from: L.at * BEAT, to: length }];
    for (const p of pieces) {
      // a built line is read as it grows: the newest words need their reading time, and the
      // whole line a quick skim (0.4 s + 0.03 s per character), whichever is longer
      const newest = L.device === 'build' ? L.beats[pieces.indexOf(p)] : p.text;
      // typed text is read as it types, so once typed it needs only a skim
      const need = L.device === 'build' ? Math.max(readingSecondsFor(newest), 0.4 + 0.03 * p.text.replace(/\s+/g, '').length) : readingSecondsFor(p.text);
      if (p.settled !== undefined && p.to - p.settled + 1e-9 < p.hold) failures.push({ shotId: shot.shotId, text: p.text, seconds: Number((p.to - p.settled).toFixed(3)), needs: p.hold, finished: true });
      if (p.to - p.from + 1e-9 < need) failures.push({ shotId: shot.shotId, text: p.text, seconds: Number((p.to - p.from).toFixed(3)), needs: Number(need.toFixed(3)) });
    }
  }
  return { pass: failures.length === 0, failures };
}
function readingSecondsFor(text) { const v = String(text).replace(/\s+/g, '').length; return v ? 0.3 + 0.06 * v : 0; }
