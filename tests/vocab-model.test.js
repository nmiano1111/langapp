import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, listEntries, removeForm, removeLexeme, saveOccurrence, savedStatus } from '../src/shared/vocab-model.js';

let n = 0;
const id = () => `occ${++n}`;

const result = (over = {}) => ({
  found: true,
  word: 'vernachlässigt',
  headword: 'vernachlässigt',
  lang: 'de',
  targetLang: 'en',
  translation: 'neglected',
  lemma: 'vernachlässigen',
  lemmaGloss: 'to neglect',
  grammar: 'Past participle',
  partOfSpeech: 'Adjective',
  provider: 'wiktionary',
  ...over,
});
const input = (over = {}, sentence = 'Der Garten wurde vernachlässigt.', url = 'https://a.de/1') => ({
  result: result(over),
  sentence,
  url,
  title: 'A',
});

test('saving creates lexeme, form and occurrence', () => {
  const s = emptyState();
  saveOccurrence(s, input(), 1000, id);
  assert.equal(s.lexemes['de:vernachlässigen'].gloss, 'to neglect');
  assert.equal(s.forms['de:vernachlässigt'].grammar, 'Past participle');
  const [occ] = Object.values(s.occurrences);
  assert.equal(occ.sentence, 'Der Garten wurde vernachlässigt.');
  assert.equal(occ.url, 'https://a.de/1');
  assert.equal(occ.encounteredAt, 1000);
});

test('same sentence twice does not duplicate; a new sentence adds an occurrence', () => {
  const s = emptyState();
  saveOccurrence(s, input(), 1, id);
  saveOccurrence(s, input(), 2, id);
  assert.equal(Object.keys(s.occurrences).length, 1);
  saveOccurrence(s, input({}, 'Er hat sie vernachlässigt.'), 3, id);
  assert.equal(Object.keys(s.occurrences).length, 2);
});

test('saved status: exact form, or another form of the same lemma', () => {
  const s = emptyState();
  saveOccurrence(s, input(), 1, id);
  assert.equal(savedStatus(s, result()).saved, true);
  const other = savedStatus(s, result({ word: 'vernachlässigte', headword: 'vernachlässigte' }));
  assert.equal(other.saved, false);
  assert.equal(other.savedLemma, 'vernachlässigen');
});

test('removing the last form removes the lexeme', () => {
  const s = emptyState();
  saveOccurrence(s, input(), 1, id);
  removeForm(s, 'de:vernachlässigt');
  assert.deepEqual(s, emptyState());
});

test('removing a lexeme removes all its forms and occurrences', () => {
  const s = emptyState();
  saveOccurrence(s, input(), 1, id);
  saveOccurrence(s, input({ word: 'vernachlässigte', headword: 'vernachlässigte' }, 'Sie vernachlässigte ihn.'), 2, id);
  saveOccurrence(s, input({ word: 'Haus', headword: 'Haus', lemma: null, lemmaGloss: '', translation: 'house' }, 'Das Haus.'), 3, id);
  removeLexeme(s, 'de:vernachlässigen');
  assert.deepEqual(Object.keys(s.lexemes), ['de:Haus']);
  assert.equal(Object.keys(s.forms).length, 1);
  assert.equal(Object.keys(s.occurrences).length, 1);
});

test('list is most-recent first and searchable by German or English, ignoring umlauts', () => {
  const s = emptyState();
  saveOccurrence(s, input(), 1, id);
  saveOccurrence(s, input({ word: 'Haus', headword: 'Haus', lemma: null, lemmaGloss: '', translation: 'house' }, 'Das Haus.'), 2, id);
  assert.deepEqual(listEntries(s).map((e) => e.lexeme.lemma), ['Haus', 'vernachlässigen']);
  assert.deepEqual(listEntries(s, 'neglect').map((e) => e.lexeme.lemma), ['vernachlässigen']);
  assert.deepEqual(listEntries(s, 'vernachlassigt').map((e) => e.lexeme.lemma), ['vernachlässigen']);
  assert.deepEqual(listEntries(s, 'HOUSE').map((e) => e.lexeme.lemma), ['Haus']);
});

test('a base-form save uses its translation as the lexeme gloss', () => {
  const s = emptyState();
  saveOccurrence(s, input({ word: 'Haus', headword: 'Haus', lemma: null, lemmaGloss: '', translation: 'house' }), 1, id);
  assert.equal(s.lexemes['de:Haus'].gloss, 'house');
});
