// @ts-check
import { getPair } from '../shared/languages.js';
import { getSettings, updateSettings, SETTINGS_KEY } from '../shared/settings.js';
import { emptyState, listEntries } from '../shared/vocab-model.js';

/** @typedef {import('../shared/vocab-model.js').VocabState} VocabState */
/** @typedef {import('../shared/vocab-model.js').VocabEntry} VocabEntry */
/** @typedef {import('../shared/vocab-model.js').Occurrence} Occurrence */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const els = {
  list: $('list'),
  search: /** @type {HTMLInputElement} */ ($('search')),
  count: $('count'),
  enabled: /** @type {HTMLInputElement} */ ($('enabled')),
  enabledLabel: $('enabled-label'),
  pair: $('pair'),
  settingsBtn: $('settings-btn'),
  settings: $('settings'),
  claudeFields: $('claude-fields'),
  apiKey: /** @type {HTMLInputElement} */ ($('api-key')),
  model: /** @type {HTMLInputElement} */ ($('model')),
  shortcuts: $('shortcuts'),
  emptyTpl: /** @type {HTMLTemplateElement} */ ($('empty-tpl')),
};

/** @type {VocabState} */
let vocab = emptyState();
/** Lexeme ids whose full encounter list is expanded. */
const expanded = new Set();

// ---------- vocabulary list ----------

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
/** @param {number} t */
function relativeTime(t) {
  const diff = (t - Date.now()) / 1000;
  const units = /** @type {const} */ ([
    ['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60],
  ]);
  for (const [unit, secs] of units) {
    if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  }
  return 'just now';
}

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Sentence with the encountered word marked. @param {Occurrence} occ */
function sentenceNode(occ) {
  const p = el('p', 'sentence');
  const i = occ.word ? occ.sentence.indexOf(occ.word) : -1;
  if (i < 0) {
    p.textContent = occ.sentence;
    return p;
  }
  p.append(occ.sentence.slice(0, i), el('mark', '', occ.word), occ.sentence.slice(i + occ.word.length));
  return p;
}

/** @param {Occurrence} occ */
function occurrenceNode(occ) {
  const wrap = el('div', 'occ');
  if (occ.sentence) wrap.append(sentenceNode(occ));
  const source = el('div', 'source');
  if (occ.url) {
    const a = /** @type {HTMLAnchorElement} */ (el('a'));
    a.href = occ.url;
    a.target = '_blank';
    a.rel = 'noopener';
    let host = occ.url;
    try {
      host = new URL(occ.url).hostname.replace(/^www\./, '');
    } catch {}
    a.textContent = host;
    a.title = occ.title || occ.url;
    source.append(a, el('span', '', `· ${relativeTime(occ.encounteredAt)}`));
  }
  wrap.append(source);
  return wrap;
}

/** @param {VocabEntry} entry */
function entryNode(entry) {
  const { lexeme, forms, occurrences } = entry;
  const node = el('article', 'entry');

  const head = el('div', 'entry-head');
  head.append(el('span', 'lemma', lexeme.lemma));
  if (lexeme.partOfSpeech) head.append(el('span', 'pos', lexeme.partOfSpeech.toLowerCase()));
  head.append(el('span', 'when', relativeTime(lexeme.updatedAt)));
  node.append(head);

  const gloss = lexeme.gloss || forms.find((f) => f.form === lexeme.lemma)?.translation || '';
  if (gloss) node.append(el('div', 'gloss', gloss));

  const inflected = forms.filter((f) => f.form !== lexeme.lemma);
  if (inflected.length) {
    const list = el('div', 'forms');
    for (const f of inflected) {
      const item = el('span', 'form');
      item.append(el('b', '', f.form));
      const detail = [f.grammar.toLowerCase(), f.translation !== gloss ? f.translation : '']
        .filter(Boolean)
        .join(' · ');
      if (detail) item.append(el('span', '', ` ${detail}`));
      list.append(item);
    }
    node.append(list);
  }

  const isOpen = expanded.has(lexeme.id);
  for (const occ of isOpen ? occurrences : occurrences.slice(0, 1)) node.append(occurrenceNode(occ));

  const foot = el('div', 'entry-foot');
  if (occurrences.length > 1) {
    const more = el('button', 'link', isOpen ? 'Show less' : `${occurrences.length - 1} more encounter${occurrences.length > 2 ? 's' : ''}`);
    more.addEventListener('click', () => {
      isOpen ? expanded.delete(lexeme.id) : expanded.add(lexeme.id);
      render();
    });
    foot.append(more);
  }
  const remove = el('button', 'link danger', 'Remove');
  let armed = 0;
  remove.addEventListener('click', () => {
    if (!armed) {
      remove.textContent = `Remove “${lexeme.lemma}”?`;
      armed = window.setTimeout(() => {
        armed = 0;
        remove.textContent = 'Remove';
      }, 3000);
      return;
    }
    clearTimeout(armed);
    chrome.runtime.sendMessage({ type: 'remove-lexeme', lexemeId: lexeme.id });
  });
  foot.append(remove);
  node.append(foot);
  return node;
}

function render() {
  const query = els.search.value;
  const entries = listEntries(vocab, query);
  const total = Object.keys(vocab.lexemes).length;
  els.count.textContent = total ? (query ? `${entries.length} of ${total}` : String(total)) : '';
  els.list.replaceChildren();

  if (!total) {
    els.list.append(els.emptyTpl.content.cloneNode(true));
    return;
  }
  if (!entries.length) {
    const none = el('div', 'empty');
    none.append(el('p', '', `Nothing matches “${query}”.`));
    els.list.append(none);
    return;
  }
  els.list.append(...entries.map(entryNode));
}

// ---------- settings ----------

/** @param {import('../shared/settings.js').Settings} s */
function renderSettings(s) {
  els.enabled.checked = s.enabled;
  els.enabledLabel.textContent = s.enabled ? 'On' : 'Off';
  const pair = getPair(s.pairId);
  els.pair.textContent = `${pair.sourceName} → ${pair.targetName}`;
  for (const radio of document.querySelectorAll('input[name="provider"]')) {
    /** @type {HTMLInputElement} */ (radio).checked = /** @type {HTMLInputElement} */ (radio).value === s.provider;
  }
  els.claudeFields.hidden = s.provider !== 'claude';
  if (document.activeElement !== els.apiKey) els.apiKey.value = s.claudeApiKey;
  if (document.activeElement !== els.model) els.model.value = s.claudeModel;
}

els.enabled.addEventListener('change', () => updateSettings({ enabled: els.enabled.checked }));
els.settingsBtn.addEventListener('click', () => {
  const open = els.settings.hidden;
  els.settings.hidden = !open;
  els.settingsBtn.setAttribute('aria-expanded', String(open));
});
for (const radio of document.querySelectorAll('input[name="provider"]')) {
  radio.addEventListener('change', (e) =>
    updateSettings({ provider: /** @type {any} */ (/** @type {HTMLInputElement} */ (e.target).value) }),
  );
}
els.apiKey.addEventListener('change', () => updateSettings({ claudeApiKey: els.apiKey.value.trim() }));
els.model.addEventListener('change', () => updateSettings({ claudeModel: els.model.value.trim() || 'claude-opus-5-5' }));
els.shortcuts.addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
els.search.addEventListener('input', render);

// ---------- live data ----------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.vocab) {
    vocab = /** @type {VocabState | undefined} */ (changes.vocab.newValue) ?? emptyState();
    render();
  }
  if (changes[SETTINGS_KEY]) getSettings().then(renderSettings);
});

const stored = await chrome.storage.local.get('vocab');
vocab = /** @type {VocabState | undefined} */ (stored.vocab) ?? emptyState();
render();
renderSettings(await getSettings());
// Keep relative dates fresh while the panel stays open.
setInterval(render, 60_000);
