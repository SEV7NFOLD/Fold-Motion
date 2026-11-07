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
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(MAX_FILM_SECONDS, Math.max(MIN_FILM_SECONDS, value));
}
