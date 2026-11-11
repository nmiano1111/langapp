// @ts-check
/**
 * The definition popover. Lives in a closed shadow root so page CSS can't
 * reach it, and is positioned with `position: fixed` against the word's
 * live Range so it follows any scroll container.
 */
const HIGHLIGHT = 'immersion-active-word';

const STYLE = /* css */ `
  :host { all: initial; }
  .card {
    --bg: #fffdf9; --fg: #1f1d1a; --muted: #6f6a63; --faint: #a39d95;
    --line: rgba(31, 29, 26, 0.10); --accent: #b4532a; --accent-soft: rgba(180, 83, 42, 0.10);
    position: fixed; z-index: 2147483647; box-sizing: border-box;
    min-width: 190px; max-width: min(320px, calc(100vw - 16px));
    padding: 11px 14px 10px;
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--line); border-radius: 10px;
    box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.10);
    font: 14px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased; text-align: left; letter-spacing: normal;
    opacity: 0; transform: translateY(2px);
    transition: opacity 110ms ease-out, transform 110ms ease-out;
  }
  .card.visible { opacity: 1; transform: none; }
  .card.savable { cursor: pointer; }
  @media (prefers-color-scheme: dark) {
    .card {
      --bg: #262422; --fg: #f1ede7; --muted: #b0a99f; --faint: #7d776f;
      --line: rgba(255,255,255,.10); --accent: #e39a72; --accent-soft: rgba(227,154,114,.14);
      box-shadow: 0 1px 2px rgba(0,0,0,.3), 0 10px 28px rgba(0,0,0,.45);
    }
  }
  .head { display: flex; align-items: flex-start; gap: 10px; }
  .word { flex: 1; font-weight: 650; font-size: 15px; word-break: break-word; }
  .mark {
    all: unset; cursor: pointer; flex: none; width: 22px; height: 22px; margin: -2px -5px 0 0;
    display: grid; place-items: center; border-radius: 6px; color: var(--faint);
    transition: color 150ms, background-color 150ms;
  }
  .mark:hover { color: var(--accent); background: var(--accent-soft); }
  .mark:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .mark svg { width: 14px; height: 14px; }
  .mark svg path { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linejoin: round; transition: fill 150ms; }
  .saved .mark { color: var(--accent); }
  .saved .mark svg path { fill: currentColor; }
  .meaning { margin-top: 2px; font-size: 15px; color: var(--fg); }
  .meaning em { font-style: italic; }
  .lemma { margin-top: 6px; font-size: 13px; color: var(--muted); }
  .lemma b { color: var(--fg); font-weight: 600; }
  .grammar { margin-top: 3px; font-size: 12px; color: var(--muted); }
  .foot {
    margin-top: 8px; padding-top: 7px; border-top: 1px solid var(--line);
    display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--faint);
  }
  .foot .status { flex: 1; }
  .saved .foot .status { color: var(--accent); }
  .link {
    all: unset; cursor: pointer; color: var(--muted); font-size: 12px;
    text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 2px;
  }
  .link:hover { color: var(--fg); text-decoration-color: currentColor; }
  .link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
  .shimmer {
    margin-top: 6px; height: 10px; width: 70%; border-radius: 4px;
    background: linear-gradient(90deg, var(--line) 0%, var(--accent-soft) 50%, var(--line) 100%);
    background-size: 200% 100%; animation: shimmer 1.1s linear infinite;
  }
  .shimmer.short { width: 45%; }
  @keyframes shimmer { to { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) {
    .card { transition: none; } .shimmer { animation: none; }
  }
  .muted { color: var(--muted); font-size: 13px; margin-top: 2px; }
`;

const BOOKMARK =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h8a.5.5 0 0 1 .5.5v10.6a.3.3 0 0 1-.48.24L8 10.9l-4.02 2.94a.3.3 0 0 1-.48-.24V3a.5.5 0 0 1 .5-.5Z"/></svg>';

/** @param {string} s */
const esc = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/**
 * @typedef {import('../shared/vocab-model.js').LookupResult} LookupResult
 * @typedef {import('../shared/vocab-model.js').SavedStatus} SavedStatus
 * @typedef {{ onSave: () => void, onRemove: () => void }} PopoverHandlers
 */

export class Popover {
  /** @param {PopoverHandlers} handlers */
  constructor(handlers) {
    this.handlers = handlers;
    this.host = document.createElement('immersion-popover');
    this.host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
    const shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.card = document.createElement('div');
    this.card.className = 'card';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-live', 'polite');
    shadow.append(style, this.card);
    // Clicking the card itself saves, like clicking the word again. A drag
    // (selecting text to copy) or a double-click doesn't count.
    let down = { x: 0, y: 0 };
    this.card.addEventListener('mousedown', (e) => (down = { x: e.clientX, y: e.clientY }));
    this.card.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const action = target.closest('[data-action]')?.getAttribute('data-action');
      if (action === 'save') return this.handlers.onSave();
      if (action === 'remove') return this.handlers.onRemove();
      if (target.closest('a, button')) return;
      const dragged = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
      if (e.button === 0 && e.detail === 1 && !dragged) this.handlers.onSave();
    });

    /** @type {Range | null} */
    this.range = null;
    this.frame = 0;
    this.reposition = this.reposition.bind(this);
    this.installHighlightStyle();
  }

  get isOpen() {
    return this.range !== null;
  }

  /** Highlights the active word via the CSS Custom Highlight API: no DOM changes. */
  installHighlightStyle() {
    if (!('highlights' in CSS)) return;
    const style = document.createElement('style');
    style.textContent = `::highlight(${HIGHLIGHT}) { background-color: rgba(214, 134, 84, 0.22); }`;
    (document.head ?? document.documentElement).append(style);
  }

  /** @param {Range} range @param {string} word */
  showLoading(range, word) {
    this.open(range);
    this.card.classList.remove('saved');
    this.card.classList.add('savable'); // a click while loading saves once the definition arrives
    this.card.innerHTML = `
      <div class="head"><div class="word">${esc(word)}</div></div>
      <div class="shimmer"></div><div class="shimmer short"></div>`;
    this.reposition();
  }

  /**
   * @param {LookupResult} r
   * @param {SavedStatus} status
   */
  showResult(r, status) {
    this.card.classList.toggle('saved', status.saved);
    this.card.classList.toggle('savable', r.found && !status.saved);
    if (!r.found) {
      const url = `https://en.wiktionary.org/wiki/${encodeURIComponent(r.headword)}#German`;
      this.card.innerHTML = `
        <div class="head"><div class="word">${esc(r.word)}</div></div>
        <div class="muted">No definition found.</div>
        <div class="foot"><span class="status"></span>
          <a class="link" href="${esc(url)}" target="_blank" rel="noopener">Search Wiktionary</a></div>`;
      this.reposition();
      return;
    }

    const showLemmaGloss = r.lemmaGloss && r.lemmaGloss !== r.translation;
    const lemmaLine = r.lemma
      ? `<div class="lemma">From <b>${esc(r.lemma)}</b>${showLemmaGloss ? ` — ${esc(r.lemmaGloss)}` : ''}</div>`
      : '';
    const grammar = r.grammar || (r.lemma ? '' : r.partOfSpeech);
    let status_ = 'Click to save';
    if (status.saved) status_ = 'Saved';
    else if (status.savedLemma) status_ = `You saved ${esc(status.savedLemma)} · click to save`;

    this.card.innerHTML = `
      <div class="head">
        <div class="word">${esc(r.word)}</div>
        <button class="mark" data-action="${status.saved ? 'remove' : 'save'}"
          title="${status.saved ? 'Saved — click to remove' : 'Save to vocabulary'}"
          aria-pressed="${status.saved}" aria-label="${status.saved ? 'Remove from vocabulary' : 'Save to vocabulary'}">${BOOKMARK}</button>
      </div>
      <div class="meaning"><em>${esc(r.translation)}</em></div>
      ${lemmaLine}
      ${grammar ? `<div class="grammar">${esc(grammar)}</div>` : ''}
      <div class="foot">
        <span class="status">${status_}</span>
        ${status.saved ? '<button class="link" data-action="remove">Remove</button>' : ''}
      </div>`;
    this.reposition();
  }

  /** @param {string} message */
  showError(message) {
    this.card.classList.remove('saved', 'savable');
    const word = this.card.querySelector('.word')?.textContent ?? '';
    this.card.innerHTML = `
      <div class="head"><div class="word">${esc(word)}</div></div>
      <div class="muted">${esc(message)}</div>`;
    this.reposition();
  }

  /** @param {Range} range */
  open(range) {
    this.range = range;
    if (!this.host.isConnected) document.documentElement.append(this.host);
    if ('highlights' in CSS) CSS.highlights.set(HIGHLIGHT, new Highlight(range));
    window.addEventListener('scroll', this.reposition, { capture: true, passive: true });
    window.addEventListener('resize', this.reposition, { passive: true });
    requestAnimationFrame(() => this.card.classList.add('visible'));
  }

  hide() {
    if (!this.range) return;
    this.range = null;
    this.card.classList.remove('visible');
    if ('highlights' in CSS) CSS.highlights.delete(HIGHLIGHT);
    window.removeEventListener('scroll', this.reposition, { capture: true });
    window.removeEventListener('resize', this.reposition);
    this.host.remove();
  }

  reposition() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (!this.range) return;
      const rects = this.range.getClientRects();
      const rect = rects[0] ?? this.range.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      if (rect.bottom < 0 || rect.top > vh || (rect.width === 0 && rect.height === 0)) {
        this.hide(); // the word scrolled away or was removed
        return;
      }
      const margin = 8;
      const gap = 6;
      const { width, height } = this.card.getBoundingClientRect();
      let left = Math.min(Math.max(margin, rect.left - 4), vw - width - margin);
      let top = rect.bottom + gap;
      if (top + height > vh - margin && rect.top - gap - height > margin) top = rect.top - gap - height;
      this.card.style.left = `${Math.round(left)}px`;
      this.card.style.top = `${Math.round(top)}px`;
    });
  }
}
