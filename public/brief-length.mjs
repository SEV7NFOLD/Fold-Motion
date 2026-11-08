/**
 * Reads the film length a brief asks for. Shared by the server (planning) and the
 * studio (the chips under each brief), so both always agree.
 */
const NUMBER_WORDS = Object.freeze({
  three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, eighteen: 18, twenty: 20, 'twenty-five': 25, thirty: 30,
});
export const MIN_FILM_SECONDS = 3;
export const MAX_FILM_SECONDS = 30;

/**
 * The film length a brief asks for, in seconds, or undefined. Reads "10-second",
 * "15 sec", "ten seconds" and "10s"; ignores decades like "the 90s". Clamped to 3–30.
 */
export function durationFromBrief(text) {
  const brief = String(text || '').toLowerCase();
  const spelled = brief.match(/(\d{1,2}(?:\.\d)?)\s*(?:-|–)?\s*(?:seconds?|secs?)\b/);
  const compact = brief.match(/(?:^|[\s(])(\d{1,2}(?:\.\d)?)s\b(?!')/);
  const worded = brief.match(new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\s*(?:-|–)?\\s*seconds?\\b`));
  let value;
  if (spelled) value = Number(spelled[1]);
  else if (compact && Number(compact[1]) <= MAX_FILM_SECONDS) value = Number(compact[1]);
  else if (worded) value = NUMBER_WORDS[worded[1]];
  else value = beatsFromBrief(text)?.total;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(MAX_FILM_SECONDS, Math.max(MIN_FILM_SECONDS, value));
}

const TIMECODE = /(\d{1,2}):([0-5]\d)(?:\.(\d))?/;
const RANGE = new RegExp(`${TIMECODE.source}\\s*(?:-|–|—|to)\\s*${TIMECODE.source}`, 'g');

/**
 * Beats written as timecode ranges, the way an editor writes a brief:
 * "0:00 - 0:03 | The Quiet Opening ... 0:07 - 0:10 | The Bold Reveal".
 * Returns { total, beats } in seconds, or undefined. Requires the ranges to start
 * at 0:00 and run in order, so times of day ("doors 9:30 - 11:00") are ignored.
 */
export function beatsFromBrief(text) {
  const seconds = (m, s, tenths) => Number(m) * 60 + Number(s) + (tenths ? Number(tenths) / 10 : 0);
  const ranges = [...String(text || '').matchAll(RANGE)].map((match) => ({
    start: seconds(match[1], match[2], match[3]),
    end: seconds(match[4], match[5], match[6]),
  }));
  if (ranges.length === 0 || ranges[0].start !== 0) return undefined;
  for (let index = 0; index < ranges.length; index += 1) {
    const { start, end } = ranges[index];
    if (end <= start) return undefined;
    if (index > 0 && Math.abs(start - ranges[index - 1].end) > 0.5) return undefined;
  }
  const total = ranges.at(-1).end;
  if (total < MIN_FILM_SECONDS || total > 120) return undefined;
  const scale = total > MAX_FILM_SECONDS ? MAX_FILM_SECONDS / total : 1;
  return {
    total: Math.min(MAX_FILM_SECONDS, total),
    beats: ranges.map(({ start, end }) => (end - start) * scale),
  };
}
