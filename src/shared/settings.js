// @ts-check
import { DEFAULT_PAIR_ID } from './languages.js';

/**
 * @typedef {Object} Settings
 * @property {boolean} enabled        Immersion mode: clicks on page words open definitions.
 * @property {string} pairId          Active language pair.
 * @property {'wiktionary'|'claude'} provider
 * @property {string} claudeApiKey    Only used when provider === 'claude'. Stored locally, never synced.
 * @property {string} claudeModel
 */

export const SETTINGS_KEY = 'settings';

/** @type {Settings} */
export const DEFAULT_SETTINGS = {
  enabled: true,
  pairId: DEFAULT_PAIR_ID,
  provider: 'wiktionary',
  claudeApiKey: '',
  claudeModel: 'claude-opus-5-5',
};

/** @returns {Promise<Settings>} */
export async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] ?? {}) };
}

/** @param {Partial<Settings>} patch */
export async function updateSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
