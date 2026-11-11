// @ts-check
/**
 * Click to understand. Click again to remember.
 *
 * One passive click listener. We never call preventDefault, never wrap
 * words, and stand aside for links, controls, editable text, selections
 * and double-clicks.
 */
import { Popover } from './popover.js';
import { wordAtPoint } from './word-at-point.js';

const root = /** @type {any} */ (globalThis);
if (!root.__immersionLoaded) {
  root.__immersionLoaded = true;
  start();
}

function start() {
  const INTERACTIVE = [
    'a[href]', 'button', 'input', 'textarea', 'select', 'option', 'label', 'summary',
    'video', 'audio', 'iframe', 'canvas', 'svg', '[draggable="true"]',
    '[contenteditable]:not([contenteditable="false"])',
    '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="menuitem"]', '[role="tab"]',
    '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="option"]', '[role="combobox"]',
    '[role="slider"]', '[role="treeitem"]',
  ].join(',');

  /** @type {{ enabled: boolean, source: string }} */
  const config = { enabled: true, source: 'de' };

  /**
   * @typedef {import('../shared/vocab-model.js').LookupResult} LookupResult
   * @typedef {import('../shared/vocab-model.js').SavedStatus} SavedStatus
   * @typedef {{
   *   hit: { word: string, sentence: string, range: Range, block: Element, start: number },
   *   token: number,
   *   result: LookupResult | null,
   *   status: SavedStatus | null,
   *   saveRequested: boolean,
   *   busy: boolean,
   * }} Session
   */

  /** @type {Session | null} */
  let session = null;
  let token = 0;

  const popover = new Popover({ onSave: save, onRemove: remove });

  // ---------- settings ----------

  /** @param {any} s */
  function applySettings(s) {
    config.enabled = s?.enabled ?? true;
    config.source = String(s?.pairId ?? 'de-en').split('-')[0];
    setArrowCursor(config.enabled);
    if (!config.enabled) close();
  }

  // While immersion mode is on, words show the arrow cursor instead of the
  // I-beam: they're clickable now. Set once on <body> and inherited, so
  // anything with its own cursor (links, page-styled clickables) keeps it.
  // Zero-specificity :where() lets any page rule win. Editable text keeps
  // its I-beam.
  const cursorStyle = document.createElement('style');
  cursorStyle.textContent = `
    :where(body) { cursor: default; }
    :where(textarea, [contenteditable]:not([contenteditable="false"]),
      input:not([type="button"], [type="submit"], [type="reset"], [type="checkbox"], [type="radio"],
        [type="range"], [type="color"], [type="file"], [type="image"])) { cursor: text; }
  `;
  /** @param {boolean} on */
  function setArrowCursor(on) {
    if (on && !cursorStyle.isConnected) (document.head ?? document.documentElement).append(cursorStyle);
    if (!on) cursorStyle.remove();
  }
  chrome.storage.local.get('settings').then((v) => applySettings(v.settings)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) applySettings(changes.settings.newValue);
    if (changes.vocab && session?.result) void refreshStatus(session);
  });

  // ---------- messaging ----------

  /** @param {object} msg */
  async function send(msg) {
    try {
      const res = await chrome.runtime.sendMessage(msg);
      if (!res?.ok) throw new Error(res?.error ?? 'No response');
      return res;
    } catch (err) {
      const text = String(/** @type {any} */ (err)?.message ?? err);
      if (/context invalidated|Receiving end does not exist/i.test(text)) {
        throw new Error('Immersion was updated. Reload this page to keep using it.');
      }
      throw err;
    }
  }

  // ---------- click handling ----------

  /** @param {EventTarget | null} target */
  function isInteractive(target) {
    const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    if (!el) return true;
    if (el.closest(INTERACTIVE)) return true;
    if (/** @type {HTMLElement} */ (el).isContentEditable) return true;
    // Elements wired up with JS click handlers usually advertise a pointer cursor.
    return getComputedStyle(el).cursor === 'pointer';
  }

  /** @param {string | null} lang */
  function isOtherLanguage(lang) {
    if (!lang) return false; // undeclared: give the reader the benefit of the doubt
    return !lang.toLowerCase().startsWith(config.source);
  }

  /** @param {MouseEvent} e */
  function onClick(e) {
    if (!config.enabled) return;
    // Any Immersion popover, not just ours (e.g. a second copy injected by a dev page).
    if (e.composedPath().some((n) => n instanceof Element && n.localName === 'immersion-popover')) return;

    // Second/third click of a double/triple-click: the reader is selecting
    // text natively. Get out of the way.
    if (e.detail > 1) {
      close();
      return;
    }
    if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
      close();
      return;
    }
    const selection = document.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) {
      close(); // the click ended a drag-selection
      return;
    }
    if (isInteractive(e.target)) {
      close();
      return;
    }

    const hit = wordAtPoint(e.clientX, e.clientY, config.source);
    if (!hit || isOtherLanguage(hit.lang)) {
      close();
      return;
    }

    if (session && popover.isOpen && session.hit.block === hit.block && session.hit.start === hit.start) {
      save();
      return;
    }
    void open(hit);
  }

  /** @param {any} hit */
  async function open(hit) {
    const mine = ++token;
    session = { hit, token: mine, result: null, status: null, saveRequested: false, busy: false };
    popover.showLoading(hit.range, hit.word);
    try {
      const res = await send({ type: 'lookup', word: hit.word, sentence: hit.sentence });
      if (session?.token !== mine) return;
      session.result = res.result;
      session.status = res.status;
      popover.showResult(res.result, res.status);
      if (session.saveRequested) save();
    } catch (err) {
      if (session?.token === mine) popover.showError(String(/** @type {any} */ (err)?.message ?? err));
    }
  }

  function save() {
    const s = session;
    if (!s) return;
    if (!s.result) {
      s.saveRequested = true; // clicked again before the definition arrived
      return;
    }
    if (!s.result.found || s.status?.saved || s.busy) return;
    s.busy = true;
    send({ type: 'save', result: s.result, sentence: s.hit.sentence, url: location.href, title: document.title })
      .then((res) => {
        s.status = res.status;
        if (session === s && s.result) popover.showResult(s.result, res.status);
      })
      .catch((err) => session === s && popover.showError(String(err?.message ?? err)))
      .finally(() => (s.busy = false));
  }

  function remove() {
    const s = session;
    if (!s?.status?.formId || s.busy) return;
    s.busy = true;
    send({ type: 'remove-form', formId: s.status.formId })
      .then(() => refreshStatus(s))
      .catch((err) => session === s && popover.showError(String(err?.message ?? err)))
      .finally(() => (s.busy = false));
  }

  /** Re-checks saved state, e.g. after a change in the side panel. @param {Session} s */
  async function refreshStatus(s) {
    if (!s.result || session !== s) return;
    const res = await send({ type: 'lookup', word: s.hit.word, sentence: s.hit.sentence }).catch(() => null);
    if (res && session === s) {
      s.status = res.status;
      popover.showResult(s.result, res.status);
    }
  }

  function close() {
    session = null;
    token++;
    popover.hide();
  }

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popover.isOpen) close();
  });
}
