// @ts-check
import { emptyState } from '../shared/vocab-model.js';

/** @typedef {import('../shared/vocab-model.js').VocabState} VocabState */

export const VOCAB_KEY = 'vocab';

/** @returns {Promise<VocabState>} */
export async function loadVocab() {
  const stored = await chrome.storage.local.get(VOCAB_KEY);
  return /** @type {VocabState | undefined} */ (stored[VOCAB_KEY]) ?? emptyState();
}

let queue = Promise.resolve();

/**
 * Runs a read-modify-write against the stored vocabulary. Writes are
 * serialized so two quick saves can never clobber each other.
 *
 * @template T
 * @param {(state: VocabState) => T} fn  Mutates the state in place.
 * @returns {Promise<T>}
 */
export function mutateVocab(fn) {
  const run = queue.then(async () => {
    const state = await loadVocab();
    const out = fn(state);
    await chrome.storage.local.set({ [VOCAB_KEY]: state });
    return out;
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
