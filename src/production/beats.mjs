/**
 * Copy into beats (docs/LAUNCH-STYLE-BUILD-PLAN.md, Phase 2).
 *
 * Splits approved copy into beats of 1–3 words (4 when that avoids an orphan),
 * by rules, not by the model:
 * - never split a protected name, a number with its unit or currency, a date,
 *   or a run of capitalised words (a product name such as "Volt Runner");
 * - a beat never ends on a small function word ("a", "the", "with");
 * - sentence ends always break; breaks after punctuation and before
 *   conjunctions and prepositions are preferred.
 * The split is chosen by scoring every possible segmentation (dynamic
 * programming), and the beats always concatenate back to the exact copy,
 * whitespace included: `beats.map((b) => b.raw).join('') === copy`.
 */

const FUNCTION_WORDS = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'with', 'and', '&', 'or', 'but', 'at', 'by', 'from', 'into', 'onto', 'your', 'our', 'my', 'its', 'their', 'this', 'that', 'these', 'those', 'as', 'is', 'are', 'be', 'than', 'via', 'per', 'until', 'before', 'after', 'since', 'over', 'under', 'about', 'through', 'within', 'without', 'across', 'every', 'all', 'no', 'not', 'so', 'if', 'when', 'while']);
const UNITS = new Set(['seconds', 'second', 'sec', 'secs', 's', 'min', 'mins', 'minute', 'minutes', 'hour', 'hours', 'hr', 'hrs', 'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years', 'ml', 'l', 'g', 'kg', 'mg', 'oz', 'lb', 'lbs', 'cm', 'mm', 'm', 'km', 'gb', 'mb', 'tb', 'am', 'pm', 'off', 'percent', 'x', 'fps', 'bpm', 'k']);
const MONTHS = new Set(['jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may', 'jun', 'june', 'jul', 'july', 'aug', 'august', 'sep', 'sept', 'september', 'oct', 'october', 'nov', 'november', 'dec', 'december']);
const NUMBER = /^[($€£¥]?\d[\d.,:/]*(?:%|x|k|m|ml|g|s)?$/i;
const SENTENCE_END = /[.!?]["'”’)\]]*$/;
const SOFT_END = /[,;:—–-]["'”’)\]]*$/;

const bare = (word) => word.replace(/^["'“‘(\[]+|["'”’)\].,;:!?—–]+$/g, '');
const norm = (word) => bare(word).toLowerCase();

function tokenize(copy) {
  return [...copy.matchAll(/\S+/g)].map((m) => ({ word: m[0], start: m.index, end: m.index + m[0].length }));
}

/** joined[i] is true when tokens i and i+1 must stay in the same beat. */
function bindings(tokens, protect) {
  const joined = new Array(Math.max(0, tokens.length - 1)).fill(false);
  const bind = (from, to) => { for (let i = from; i < to; i += 1) joined[i] = true; };
  // protected phrases, matched word by word, ignoring case and edge punctuation
  for (const phrase of protect) {
    const words = String(phrase).split(/\s+/).filter(Boolean).map(norm);
    if (words.length < 2) continue;
    for (let i = 0; i + words.length <= tokens.length; i += 1) {
      if (words.every((w, k) => norm(tokens[i + k].word) === w)) bind(i, i + words.length - 1);
    }
  }
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const here = tokens[i].word; const next = tokens[i + 1].word;
    const hereEndsClause = SENTENCE_END.test(here) || SOFT_END.test(here);
    // a number with its unit or currency word: "$49", "50% off", "15 seconds", "100 ml"
    if (NUMBER.test(bare(here)) && !hereEndsClause && UNITS.has(norm(next))) joined[i] = true;
    // dates: "Dec 12", "12 December"
    if (!hereEndsClause && ((MONTHS.has(norm(here)) && /^\d{1,2}(st|nd|rd|th)?$/i.test(bare(next))) || (/^\d{1,2}(st|nd|rd|th)?$/i.test(bare(here)) && MONTHS.has(norm(next))))) joined[i] = true;
  }
  // runs of 2–4 capitalised words are names ("Volt Runner", "FOLD Motion", "Google Workspace")
  const capital = (w) => /^[A-Z0-9][\w'’.-]*$/.test(bare(w)) && !FUNCTION_WORDS.has(norm(w)) && bare(w).length > 0;
  let i = 0;
  while (i < tokens.length) {
    let j = i;
    while (j + 1 < tokens.length && capital(tokens[j].word) && capital(tokens[j + 1].word) && !SENTENCE_END.test(tokens[j].word) && !SOFT_END.test(tokens[j].word)) j += 1;
    if (j > i && j - i + 1 <= 4) bind(i, j);
    i = j + 1;
  }
  return joined;
}

/**
 * Split copy into beats. Returns [{ text, raw, start, end, words }], where raw
 * slices concatenate to the copy and text is raw without surrounding spaces.
 */
export function splitIntoBeats(copy, { protect = [], maxWords = 3 } = {}) {
  const source = String(copy ?? '');
  const tokens = tokenize(source);
  if (tokens.length === 0) return source ? [{ text: '', raw: source, start: 0, end: source.length, words: 0 }] : [];
  const joined = bindings(tokens, protect);
  // atoms: tokens that must travel together
  const atoms = [];
  tokens.forEach((token, i) => {
    if (i > 0 && joined[i - 1]) { const a = atoms[atoms.length - 1]; a.tokens.push(token); } else atoms.push({ tokens: [token] });
  });
  const hardMax = maxWords + 1;
  const words = (a) => a.tokens.length;
  const last = (a) => a.tokens[a.tokens.length - 1].word;
  const first = (a) => a.tokens[0].word;
  const n = atoms.length;
  const best = new Array(n + 1).fill(Infinity); const from = new Array(n + 1).fill(-1);
  best[0] = 0;
  for (let j = 1; j <= n; j += 1) {
    let count = 0; let internalComma = 0; let forbidden = false; let biggestAtom = 0;
    for (let i = j - 1; i >= 0; i -= 1) {
      count += words(atoms[i]); biggestAtom = Math.max(biggestAtom, words(atoms[i]));
      if (i < j - 1) {
        if (SENTENCE_END.test(last(atoms[i]))) forbidden = true;      // a sentence end inside the beat
        if (SOFT_END.test(last(atoms[i]))) internalComma += 1;
      }
      if (forbidden) break;
      const single = j - i === 1;
      // a beat may stretch past the limit only to carry a multi-word name with its small words
      if (count > hardMax + 2 && !single) break;
      if (count > hardMax && !single && biggestAtom < 2) continue;
      let cost = 1;
      if (count >= hardMax) cost += 0.8 + 0.9 * (count - hardMax);
      if (count === 1) cost += 0.35;
      cost += internalComma * 0.5;
      if (j < n) {
        if (FUNCTION_WORDS.has(norm(last(atoms[j - 1])))) cost += 5;   // never end on "a", "the", "with"
        const end = last(atoms[j - 1]);
        cost += SENTENCE_END.test(end) || SOFT_END.test(end) ? 0 : FUNCTION_WORDS.has(norm(first(atoms[j]))) ? 0.15 : 0.6;
      }
      if (best[i] + cost < best[j] - 1e-9) { best[j] = best[i] + cost; from[j] = i; }
    }
  }
  const cuts = [];
  for (let j = n; j > 0; j = from[j]) cuts.unshift([from[j], j]);
  const beats = cuts.map(([i, j], k) => {
    const start = k === 0 ? 0 : atoms[i].tokens[0].start;
    const end = k === cuts.length - 1 ? source.length : atoms[j].tokens[0].start;
    const raw = source.slice(start, end);
    return { text: raw.trim(), raw, start, end, words: atoms.slice(i, j).reduce((s, a) => s + words(a), 0) };
  });
  if (beats.map((b) => b.raw).join('') !== source) throw new Error('Beat split lost copy; this is a bug.');
  return beats;
}
