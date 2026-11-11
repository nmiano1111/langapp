import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { casingCandidates, cleanGloss, lookupWiktionary, parseDefinitions } from '../src/background/lookup/wiktionary.js';
import { LANGUAGE_PAIRS } from '../src/shared/languages.js';
import { htmlToText } from '../src/background/lookup/html-text.js';

const pair = LANGUAGE_PAIRS['de-en'];

/** Serves recorded Wiktionary responses from tests/fixtures. */
function fixtureFetcher() {
  const calls = [];
  const fn = async (word) => {
    calls.push(word);
    const path = new URL(`./fixtures/wiktionary-${word}.json`, import.meta.url);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  };
  fn.calls = calls;
  return fn;
}

test('htmlToText strips tags and decodes entities', () => {
  assert.equal(htmlToText('<a title="x">to</a>&nbsp;<i>neglect</i> &amp; <b>ignore</b>'), 'to neglect & ignore');
});

test('parses form-of entries into lemma and grammar', () => {
  const json = JSON.parse(readFileSync(new URL('./fixtures/wiktionary-vernachlässigt.json', import.meta.url)));
  const entries = parseDefinitions(json, 'de');
  const participle = entries.find((e) => e.partOfSpeech === 'Participle');
  assert.deepEqual(participle.formOf[0], { lemma: 'vernachlässigen', grammar: 'past participle' });
  const adjective = entries.find((e) => e.partOfSpeech === 'Adjective');
  assert.equal(adjective.glosses[0], 'neglected, unattended');
});

test('"inflection of X:" takes grammar from the following form line', () => {
  const json = JSON.parse(readFileSync(new URL('./fixtures/wiktionary-vernachlässigt.json', import.meta.url)));
  const verb = parseDefinitions(json, 'de').find((e) => e.partOfSpeech === 'Verb');
  assert.equal(verb.formOf[0].lemma, 'vernachlässigen');
  assert.equal(verb.formOf[0].grammar, 'third-person singular present');
});

test('vernachlässigt → neglected, from vernachlässigen, past participle', async () => {
  const r = await lookupWiktionary('vernachlässigt', pair, fixtureFetcher());
  assert.equal(r.found, true);
  assert.equal(r.translation, 'neglected, unattended');
  assert.equal(r.lemma, 'vernachlässigen');
  assert.equal(r.lemmaGloss, 'to neglect');
  assert.equal(r.grammar, 'Past participle');
});

test('inflected noun with no own gloss uses the lemma meaning', async () => {
  const r = await lookupWiktionary('Häuser', pair, fixtureFetcher());
  assert.equal(r.lemma, 'Haus');
  assert.match(r.grammar, /plural/);
  assert.equal(r.translation, r.lemmaGloss);
});

test('preterite verb resolves to its infinitive', async () => {
  const r = await lookupWiktionary('ging', pair, fixtureFetcher());
  assert.equal(r.lemma, 'gehen');
  assert.match(r.grammar, /preterite/);
});

test('base forms have no lemma line', async () => {
  const r = await lookupWiktionary('vernachlässigen', pair, fixtureFetcher());
  assert.equal(r.lemma, null);
  assert.equal(r.translation, 'to neglect');
  assert.equal(r.partOfSpeech, 'Verb');
});

test('sentence-initial capitals are stored lowercase unless the word is a noun', async () => {
  const r = await lookupWiktionary('Die', pair, fixtureFetcher());
  assert.equal(r.word, 'Die');
  assert.equal(r.headword, 'die');
  assert.equal(r.lemma, 'der');
  assert.equal(r.translation, 'the');
  assert.equal(r.partOfSpeech, 'Article');
  const noun = await lookupWiktionary('Häuser', pair, fixtureFetcher());
  assert.equal(noun.headword, 'Häuser');
});

test('a lowercase miss falls back to the capitalized noun', async () => {
  const fetcher = async (w) => (w === 'Haus' ? fixtureFetcher()('Haus') : null);
  const r = await lookupWiktionary('haus', pair, fetcher);
  assert.equal(r.headword, 'Haus');
  assert.equal(r.found, true);
});

test('unknown words are reported as not found', async () => {
  const r = await lookupWiktionary('Xyzzyquux', pair, async () => null);
  assert.equal(r.found, false);
});

test('casing candidates and gloss cleanup', () => {
  assert.deepEqual(casingCandidates('Haus'), ['Haus', 'haus']);
  assert.deepEqual(casingCandidates('schnell'), ['schnell', 'Schnell']);
  assert.equal(cleanGloss('fast, quick, rapid, speedy, swift; hurried'), 'fast, quick, rapid');
});
