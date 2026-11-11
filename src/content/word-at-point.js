// @ts-check
/**
 * Resolves the word under a pointer position without touching the DOM:
 * caretPositionFromPoint → text node + offset, then Intl.Segmenter over the
 * surrounding block's text, then a Range for positioning and hit-testing.
 * Words split across inline elements (<b>Haus</b>tür) are handled because
 * segmentation runs on the whole block's text.
 */
import { sentenceAt, wordAt } from './text-segmentation.js';

const SKIP_TEXT_IN = 'script, style, noscript, textarea, template';
const MAX_BLOCK_CHARS = 20000;

/**
 * @param {number} x
 * @param {number} y
 * @returns {{ node: Node, offset: number } | null}
 */
function caretAt(x, y) {
  if (typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(x, y);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }
  // Older Chromium fallback.
  const range = /** @type {any} */ (document).caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/** The nearest ancestor that isn't laid out inline. @param {Element} el */
function blockAncestor(el) {
  /** @type {Element | null} */
  let cur = el;
  while (cur && cur !== document.body) {
    const display = getComputedStyle(cur).display;
    if (!display.startsWith('inline') && display !== 'contents') return cur;
    cur = cur.parentElement;
  }
  return document.body;
}

/**
 * Concatenated text of a block plus a map back to its text nodes.
 * @param {Element} block
 */
function collectText(block) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest(SKIP_TEXT_IN) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  /** @type {{ node: Text, start: number }[]} */
  const pieces = [];
  let text = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    pieces.push({ node: /** @type {Text} */ (n), start: text.length });
    text += n.nodeValue ?? '';
  }
  return { text, pieces };
}

/**
 * @param {{ node: Text, start: number }[]} pieces
 * @param {number} index
 * @param {boolean} isEnd  Prefer the end of the previous node at boundaries.
 */
function locate(pieces, index, isEnd) {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    if (isEnd ? p.start < index : p.start <= index) {
      return { node: p.node, offset: Math.min(index - p.start, p.node.length) };
    }
  }
  return null;
}

/** @param {Range} range @param {number} x @param {number} y */
function rangeContainsPoint(range, x, y) {
  const pad = 1;
  for (const r of range.getClientRects()) {
    if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return true;
  }
  return false;
}

/**
 * @typedef {Object} WordHit
 * @property {string} word
 * @property {string} sentence
 * @property {Range} range
 * @property {Element} block
 * @property {number} start      Offset of the word within the block's text.
 * @property {string | null} lang  The page/element language, if declared.
 */

/**
 * @param {number} x  clientX
 * @param {number} y  clientY
 * @param {string} locale
 * @returns {WordHit | null}
 */
export function wordAtPoint(x, y, locale) {
  const caret = caretAt(x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;
  const textNode = /** @type {Text} */ (caret.node);
  const parent = textNode.parentElement;
  if (!parent || parent.closest(SKIP_TEXT_IN)) return null;

  const block = blockAncestor(parent);
  const { text, pieces } = collectText(block);
  const piece = pieces.find((p) => p.node === textNode);
  if (!piece) return null;
  const caretIndex = piece.start + caret.offset;

  // Very large blocks (layout divs): segment only a window around the click.
  let base = 0;
  let scope = text;
  if (text.length > MAX_BLOCK_CHARS) {
    base = Math.max(0, caretIndex - MAX_BLOCK_CHARS / 2);
    scope = text.slice(base, base + MAX_BLOCK_CHARS);
  }

  const word = wordAt(scope, caretIndex - base, locale);
  if (!word) return null;
  const startPos = locate(pieces, base + word.start, false);
  const endPos = locate(pieces, base + word.end, true);
  if (!startPos || !endPos) return null;

  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  // Carets snap to the nearest text even when clicking empty space.
  if (!rangeContainsPoint(range, x, y)) return null;

  const langEl = parent.closest('[lang]');
  return {
    word: word.text,
    sentence: sentenceAt(scope, word.start, locale),
    range,
    block,
    start: base + word.start,
    lang: langEl ? langEl.getAttribute('lang') : null,
  };
}
