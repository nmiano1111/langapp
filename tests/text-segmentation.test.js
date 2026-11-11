import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentenceAt, wordAt } from '../src/content/text-segmentation.js';

const text = 'Der Garten wurde jahrelang vernachlässigt. Jetzt blüht er wieder!';

test('finds the word containing an offset', () => {
  const i = text.indexOf('vernachlässigt') + 3;
  assert.deepEqual(wordAt(text, i, 'de'), { text: 'vernachlässigt', start: text.indexOf('vernachlässigt'), end: text.indexOf('vernachlässigt') + 14 });
});

test('a caret just after a word still resolves to it', () => {
  const end = text.indexOf('Garten') + 'Garten'.length; // points at the space
  assert.equal(wordAt(text, end, 'de').text, 'Garten');
});

test('punctuation, numbers and whitespace are not words', () => {
  assert.equal(wordAt('Preis: 42 €', 7, 'de'), null);
  assert.equal(wordAt(' , ', 1, 'de'), null);
});

test('sentence boundaries', () => {
  assert.equal(sentenceAt(text, text.indexOf('blüht'), 'de'), 'Jetzt blüht er wieder!');
  assert.equal(sentenceAt(text, 2, 'de'), 'Der Garten wurde jahrelang vernachlässigt.');
});
