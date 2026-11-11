// @ts-check
import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';

/**
 * Optional context-aware provider using the Claude API with the user's own key.
 *
 * Unlike a dictionary, it sees the whole sentence, so it can pick the right
 * sense, resolve separable verbs ("fängt … an" → anfangen) and explain
 * the form in place.
 */

/** @typedef {import('../../shared/vocab-model.js').LookupResult} LookupResult */
/** @typedef {import('../../shared/languages.js').LanguagePair} LanguagePair */

const SCHEMA = /** @type {const} */ ({
  type: 'object',
  additionalProperties: false,
  required: ['found', 'headword', 'translation', 'lemma', 'lemmaGloss', 'grammar', 'partOfSpeech', 'lemmaPartOfSpeech'],
  properties: {
    found: { type: 'boolean', description: 'false if the text is not a word of the source language' },
    headword: {
      type: 'string',
      description: 'The clicked form as it would be written mid-sentence (nouns capitalized, others lowercase)',
    },
    translation: { type: 'string', description: 'Meaning of this word in this sentence, 1–4 words' },
    lemma: {
      type: 'string',
      description: 'Dictionary form. For separable verbs include the particle from the sentence.',
    },
    lemmaGloss: { type: 'string', description: 'Short meaning of the lemma, e.g. "to neglect"' },
    grammar: {
      type: 'string',
      description: 'At most 5 words, e.g. "Past participle", "Dative plural". Empty if the word is its own base form.',
    },
    partOfSpeech: { type: 'string', description: 'Of the clicked form, e.g. Noun, Verb, Adjective' },
    lemmaPartOfSpeech: { type: 'string', description: 'Of the lemma' },
  },
});

/** One client per key; the service worker may live for a while. */
let cached = /** @type {{ key: string, client: Anthropic } | null} */ (null);
/** @param {string} apiKey */
function clientFor(apiKey) {
  if (cached?.key !== apiKey) {
    // The key belongs to the user and lives only in their browser profile;
    // calling from the extension's service worker is the intended setup.
    cached = { key: apiKey, client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 }) };
  }
  return cached.client;
}

/**
 * @param {{ word: string, sentence: string, pair: LanguagePair, apiKey: string, model: string }} args
 * @returns {Promise<LookupResult>}
 */
export async function lookupClaude({ word, sentence, pair, apiKey, model }) {
  let message;
  try {
    message = await clientFor(apiKey).beta.messages.parse(
      {
        model,
        max_tokens: 2048,
        // Server-side fallback: a refused request is re-run on a fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: betaJSONSchemaOutputFormat(SCHEMA) },
        system:
          `You are the dictionary inside a reading companion for ${pair.sourceName} learners whose language is ${pair.targetName}. ` +
          `A reader clicked one word in a sentence on a web page. Explain that word as used in that sentence, in ${pair.targetName}. ` +
          'Be terse: this fills a small popover, not a lesson.',
        messages: [{ role: 'user', content: `Word: ${word}\nSentence: ${sentence}` }],
      },
      { timeout: 20_000 },
    );
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('Your Anthropic API key was rejected');
    if (err instanceof Anthropic.RateLimitError) throw new Error('Claude is rate-limiting requests');
    throw err;
  }

  if (message.stop_reason === 'refusal') throw new Error('Claude declined this lookup');
  if (message.stop_reason === 'max_tokens') throw new Error('Claude response was cut off');
  const data = message.parsed_output;
  if (!data) throw new Error('Claude returned no definition');

  const lemma = data.lemma.trim();
  const headword = data.headword.trim() || word;
  const isBase = !lemma || lemma === headword;
  return {
    found: data.found,
    word,
    headword,
    lang: pair.source,
    targetLang: pair.target,
    translation: data.translation,
    lemma: isBase ? null : lemma,
    lemmaGloss: data.lemmaGloss,
    grammar: data.grammar,
    partOfSpeech: data.partOfSpeech,
    lemmaPartOfSpeech: isBase ? data.partOfSpeech : data.lemmaPartOfSpeech,
    provider: 'claude',
  };
}
