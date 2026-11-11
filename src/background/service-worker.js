// @ts-check
import { getSettings, updateSettings, SETTINGS_KEY } from '../shared/settings.js';
import { removeForm, removeLexeme, saveOccurrence, savedStatus } from '../shared/vocab-model.js';
import { lookup } from './lookup/lookup-service.js';
import { loadVocab, mutateVocab } from './vocab-store.js';

/**
 * Message protocol (content script / side panel → service worker):
 *   { type: 'lookup', word, sentence }          → { ok, result, status }
 *   { type: 'save', result, sentence, url, title } → { ok, status }
 *   { type: 'remove-form', formId }             → { ok }
 *   { type: 'remove-lexeme', lexemeId }         → { ok }
 * All vocabulary writes go through here so they are serialized.
 */

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

chrome.runtime.onInstalled.addListener(() => void refreshBadge());
chrome.runtime.onStartup.addListener(() => void refreshBadge());

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-immersion') return;
  const { enabled } = await getSettings();
  await updateSettings({ enabled: !enabled });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SETTINGS_KEY]) void refreshBadge();
});

async function refreshBadge() {
  const { enabled } = await getSettings();
  await chrome.action.setBadgeText({ text: enabled ? '' : 'off' });
  await chrome.action.setBadgeBackgroundColor({ color: '#8a8580' });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((err) => {
      console.error('[Immersion]', err);
      sendResponse({ ok: false, error: String(err?.message ?? err) });
    });
  return true; // keep the channel open for the async response
});

/** @param {any} msg */
async function handle(msg) {
  switch (msg?.type) {
    case 'lookup': {
      const settings = await getSettings();
      const result = await lookup({ word: String(msg.word), sentence: String(msg.sentence ?? '') }, settings);
      return { result, status: savedStatus(await loadVocab(), result) };
    }
    case 'save': {
      const status = await mutateVocab((state) => {
        saveOccurrence(
          state,
          { result: msg.result, sentence: String(msg.sentence ?? ''), url: String(msg.url ?? ''), title: String(msg.title ?? '') },
          Date.now(),
          () => crypto.randomUUID(),
        );
        return savedStatus(state, msg.result);
      });
      return { status };
    }
    case 'remove-form':
      return { removed: await mutateVocab((state) => removeForm(state, String(msg.formId))) };
    case 'remove-lexeme':
      return { removed: await mutateVocab((state) => removeLexeme(state, String(msg.lexemeId))) };
    default:
      throw new Error(`Unknown message type: ${msg?.type}`);
  }
}
