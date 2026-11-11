// @ts-check
/**
 * Locale-aware word and sentence boundaries via Intl.Segmenter.
 * Pure, so it is unit-tested in Node.
 */
/** @type {Map<string, Intl.Segmenter>} */
const segmenters = new Map();

/** @param {string} locale @param {'word'|'sentence'} granularity */
function segmenter(locale, granularity) {
  const key = `${locale}|${granularity}`;
  let s = segmenters.get(key);
  if (!s) {
    s = new Intl.Segmenter(locale, { granularity });
    segmenters.set(key, s);
  }
  return s;
}

const HAS_LETTER = /\p{L}/u;

/**
 * Finds the word containing `offset`. A caret position sits *between*
 * characters, so when the offset lands just after a word we also try the
 * character before it.
 *
 * @param {string} text
 * @param {number} offset
 * @param {string} locale
 * @returns {{ text: string, start: number, end: number } | null}
 */
export function wordAt(text, offset, locale) {
  const segments = segmenter(locale, 'word').segment(text);
  for (const i of [offset, offset - 1]) {
    if (i < 0 || i >= text.length) continue;
    const seg = segments.containing(i);
    if (seg && seg.isWordLike && HAS_LETTER.test(seg.segment)) {
      return { text: seg.segment, start: seg.index, end: seg.index + seg.segment.length };
    }
  }
  return null;
}

/**
 * The sentence containing `offset`, whitespace-collapsed.
 * @param {string} text
 * @param {number} offset
 * @param {string} locale
 */
export function sentenceAt(text, offset, locale) {
  const seg = segmenter(locale, 'sentence').segment(text).containing(Math.min(offset, text.length - 1));
  const sentence = (seg ? seg.segment : text).replace(/\s+/g, ' ').trim();
  return sentence.length > 600 ? `${sentence.slice(0, 597)}…` : sentence;
}
