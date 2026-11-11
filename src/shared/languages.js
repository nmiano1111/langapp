// @ts-check
/**
 * Language pair configuration. Everything language-specific lives here so that
 * adding a pair (e.g. French → English) is a data change plus, at most, a
 * provider tweak, not a rewrite.
 *
 * @typedef {Object} LanguagePair
 * @property {string} id            Stable identifier, e.g. "de-en".
 * @property {string} source        BCP 47 code of the language being read.
 * @property {string} target        BCP 47 code of the user's language.
 * @property {string} sourceName
 * @property {string} targetName
 * @property {string} wiktionaryHost  Wiktionary edition written in the target language.
 * @property {string} wiktionarySection  Key of the source language in Wiktionary's REST response.
 * @property {Record<string, string>} articleGlosses  Wiktionary describes articles rather than
 *   translating them ("nominative masculine singular definite article"), so pairs supply their own.
 */

/** @type {Record<string, LanguagePair>} */
export const LANGUAGE_PAIRS = {
  'de-en': {
    id: 'de-en',
    source: 'de',
    target: 'en',
    sourceName: 'German',
    targetName: 'English',
    wiktionaryHost: 'en.wiktionary.org',
    wiktionarySection: 'de',
    articleGlosses: {
      der: 'the', die: 'the', das: 'the', den: 'the', dem: 'the', des: 'the',
      ein: 'a, an', eine: 'a, an', einen: 'a, an', einem: 'a, an', einer: 'a, an', eines: 'a, an',
    },
  },
};

export const DEFAULT_PAIR_ID = 'de-en';

/** @param {string} id */
export function getPair(id) {
  return LANGUAGE_PAIRS[id] ?? LANGUAGE_PAIRS[DEFAULT_PAIR_ID];
}
