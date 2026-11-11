// @ts-check
import { getPair } from '../../shared/languages.js';
import { lookupClaude } from './claude.js';
import { httpFetcher, lookupWiktionary } from './wiktionary.js';

/** @typedef {import('../../shared/vocab-model.js').LookupResult} LookupResult */
/** @typedef {import('../../shared/settings.js').Settings} Settings */

const MAX_CACHE = 500;
/** @type {Map<string, Promise<LookupResult>>} */
const cache = new Map();

/**
 * Picks a provider from settings, caches results for the life of the service
 * worker, and falls back to Wiktionary if the Claude call fails.
 *
 * @param {{ word: string, sentence: string }} req
 * @param {Settings} settings
 * @returns {Promise<LookupResult>}
 */
export function lookup({ word, sentence }, settings) {
  const pair = getPair(settings.pairId);
  const useClaude = settings.provider === 'claude' && settings.claudeApiKey;
  // Claude answers depend on the sentence; dictionary answers do not.
  const key = useClaude ? `claude|${pair.id}|${word}|${sentence}` : `wikt|${pair.id}|${word}`;

  const hit = cache.get(key);
  if (hit) return hit;

  const wiktionary = () => lookupWiktionary(word, pair, httpFetcher(pair));
  const pending = useClaude
    ? lookupClaude({ word, sentence, pair, apiKey: settings.claudeApiKey, model: settings.claudeModel }).catch(
        (err) => {
          console.warn('[Immersion] Claude lookup failed, using Wiktionary:', err);
          return wiktionary();
        },
      )
    : wiktionary();

  cache.set(key, pending);
  pending.catch(() => cache.delete(key));
  const oldest = cache.keys().next().value;
  if (cache.size > MAX_CACHE && oldest !== undefined) cache.delete(oldest);
  return pending;
}
