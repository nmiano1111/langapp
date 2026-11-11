// @ts-check
import { htmlToText } from './html-text.js';

/**
 * Dictionary provider backed by Wiktionary's REST definition endpoint
 * (https://en.wiktionary.org/api/rest_v1/page/definition/{word}).
 *
 * Free and keyless. It isn't context-aware, but its "form-of" markup gives
 * reliable lemmas and grammar notes ("past participle of vernachlässigen").
 */

/** @typedef {import('../../shared/vocab-model.js').LookupResult} LookupResult */
/** @typedef {import('../../shared/languages.js').LanguagePair} LanguagePair */

/**
 * @typedef {Object} ParsedEntry
 * @property {string} partOfSpeech
 * @property {string[]} glosses
 * @property {{ lemma: string, grammar: string }[]} formOf
 */

const FORM_OF_LINK = /class="form-of-definition-link"[\s\S]*?<a\b[^>]*\btitle="([^"]+)"/;

/**
 * Parses one language section of the REST response.
 * @param {any} json
 * @param {string} section  e.g. "de"
 * @returns {ParsedEntry[]}
 */
export function parseDefinitions(json, section) {
  const raw = json?.[section];
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    /** @type {ParsedEntry} */
    const parsed = { partOfSpeech: String(entry.partOfSpeech ?? ''), glosses: [], formOf: [] };
    /** @type {{ lemma: string, grammar: string } | null} */
    let pendingInflection = null;

    for (const def of entry.definitions ?? []) {
      const html = String(def.definition ?? '');
      const linkMatch = html.match(FORM_OF_LINK);
      if (linkMatch) {
        const text = htmlToText(html.replace(/<ol[\s\S]*$/i, ''));
        const ofIndex = text.search(/\sof\s/);
        const grammar = ofIndex > 0 ? text.slice(0, ofIndex).trim() : '';
        const item = { lemma: linkMatch[1].replace(/#.*$/, ''), grammar };
        parsed.formOf.push(item);
        // "inflection of X:" lists the actual forms as following definitions.
        pendingInflection = /^inflection$/i.test(grammar) || !grammar ? item : null;
        continue;
      }
      if (html.includes('form-of-definition')) {
        if (pendingInflection) {
          pendingInflection.grammar = htmlToText(html);
          pendingInflection = null;
        }
        continue;
      }
      pendingInflection = null;
      const gloss = cleanGloss(htmlToText(html));
      if (gloss) parsed.glosses.push(gloss);
    }
    return parsed;
  });
}

/** Keeps a gloss short enough to scan at a glance. @param {string} text */
export function cleanGloss(text) {
  let gloss = text.split(/[;:]\s/)[0].trim();
  gloss = gloss.replace(/\s*\.$/, '');
  const parts = gloss.split(/,\s*/);
  if (parts.length > 3) gloss = parts.slice(0, 3).join(', ');
  return gloss.length > 80 ? `${gloss.slice(0, 77).trimEnd()}…` : gloss;
}

/** @param {string} s */
const capitalize = (s) => (s ? s[0].toLocaleUpperCase('en') + s.slice(1) : s);

/** German capitalizes nouns and sentence starts; try the other casing too. @param {string} word */
export function casingCandidates(word) {
  const first = word[0];
  const lower = first.toLocaleLowerCase('de') + word.slice(1);
  const upper = first.toLocaleUpperCase('de') + word.slice(1);
  return [...new Set([word, first === upper[0] ? lower : upper])];
}

/**
 * @typedef {(word: string) => Promise<any | null>} DefinitionFetcher
 */

/**
 * @param {LanguagePair} pair
 * @returns {DefinitionFetcher}
 */
export function httpFetcher(pair) {
  return async (word) => {
    const url = `https://${pair.wiktionaryHost}/api/rest_v1/page/definition/${encodeURIComponent(word)}?redirect=true`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'Api-User-Agent': 'Immersion/0.1 (Chrome extension)' },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Wiktionary responded ${res.status}`);
    return res.json();
  };
}

/**
 * Looks up a word and, if it is an inflected form, its lemma.
 *
 * @param {string} word
 * @param {LanguagePair} pair
 * @param {DefinitionFetcher} fetchDefinition
 * @returns {Promise<LookupResult>}
 */
export async function lookupWiktionary(word, pair, fetchDefinition) {
  let headword = word;
  /** @type {ParsedEntry[]} */
  let entries = [];
  for (const candidate of casingCandidates(word)) {
    const json = await fetchDefinition(candidate);
    entries = parseDefinitions(json, pair.wiktionarySection);
    if (entries.length) {
      headword = candidate;
      break;
    }
  }

  // Wiktionary silently redirects "Die" → "die". Only nouns keep their capital
  // in German, so anything else clicked at a sentence start is stored lowercase.
  const isNoun = entries.some((e) => /^(proper )?noun$/i.test(e.partOfSpeech));
  if (!isNoun && headword[0] !== headword[0].toLocaleLowerCase('de')) {
    headword = headword[0].toLocaleLowerCase('de') + headword.slice(1);
  }

  const glossEntry = entries.find((e) => e.glosses.length);
  const formOfEntry = entries.find((e) => e.formOf.some((f) => f.lemma !== headword));
  const formOf = formOfEntry?.formOf.find((f) => f.lemma !== headword) ?? null;

  let lemmaGloss = '';
  let lemmaPos = '';
  if (formOf) {
    const lemmaEntries = parseDefinitions(await fetchDefinition(formOf.lemma), pair.wiktionarySection);
    const lemmaGlossEntry = lemmaEntries.find((e) => e.glosses.length);
    lemmaGloss = lemmaGlossEntry?.glosses[0] ?? '';
    lemmaPos = lemmaGlossEntry?.partOfSpeech ?? '';
  }

  let translation = glossEntry?.glosses[0] ?? lemmaGloss;
  let partOfSpeech = glossEntry?.partOfSpeech || formOfEntry?.partOfSpeech || lemmaPos || '';
  let grammar = formOf?.grammar ?? '';

  // Articles: prefer a plain translation over Wiktionary's description.
  const articleEntry = entries.find((e) => e.partOfSpeech === 'Article');
  const articleGloss = pair.articleGlosses?.[headword];
  if (articleEntry && articleGloss) {
    const articleForm = articleEntry.formOf.find((f) => f.lemma !== headword);
    translation = articleGloss;
    partOfSpeech = 'Article';
    grammar = articleForm?.grammar ?? '';
    if (formOf) lemmaGloss = pair.articleGlosses[formOf.lemma] ?? lemmaGloss;
  }

  return {
    found: Boolean(translation || formOf),
    word,
    headword,
    lang: pair.source,
    targetLang: pair.target,
    translation,
    lemma: formOf?.lemma ?? null,
    lemmaGloss,
    grammar: capitalize(grammar),
    partOfSpeech,
    lemmaPartOfSpeech: formOf ? lemmaPos : partOfSpeech,
    provider: 'wiktionary',
  };
}
