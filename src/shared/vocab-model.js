// @ts-check
/**
 * Vocabulary domain model. Pure functions over a plain JSON state object so
 * the same logic runs in the service worker, the side panel and unit tests.
 *
 *   Lexeme      a dictionary entry identified by its lemma ("vernachlässigen").
 *   WordForm    a surface form the user actually met ("vernachlässigt"),
 *               with the meaning and grammar of that form.
 *   Occurrence  one encounter of a form: the sentence, page and date.
 *
 * A Lexeme has many WordForms; a WordForm has many Occurrences. Translations
 * live on the level they describe: the lemma's gloss on the Lexeme, the
 * in-context meaning and grammar note on the WordForm.
 */

/**
 * The normalized result of a dictionary lookup, shared by all providers.
 * @typedef {Object} LookupResult
 * @property {boolean} found
 * @property {string} word         Exactly what was clicked ("Häuser").
 * @property {string} headword     The dictionary form matched ("Häuser", or "die" for a clicked "Die").
 * @property {string} lang
 * @property {string} targetLang
 * @property {string} translation  Meaning of this form, ideally in context ("neglected").
 * @property {string|null} lemma   Base form, when reliably identified ("vernachlässigen").
 * @property {string} lemmaGloss   Meaning of the lemma ("to neglect").
 * @property {string} grammar      Short note ("Past participle"), may be empty.
 * @property {string} partOfSpeech  Of the clicked form.
 * @property {string} [lemmaPartOfSpeech]  Of the lemma, when it differs from the form.
 * @property {string} provider     "wiktionary" | "claude"
 */

/**
 * @typedef {Object} Lexeme
 * @property {string} id
 * @property {string} lang
 * @property {string} lemma
 * @property {string} gloss
 * @property {string} partOfSpeech
 * @property {number} createdAt
 * @property {number} updatedAt   Last time any form of this lexeme was saved or met.
 *
 * @typedef {Object} WordForm
 * @property {string} id
 * @property {string} lexemeId
 * @property {string} lang
 * @property {string} form
 * @property {string} translation
 * @property {string} grammar
 * @property {string} provider
 * @property {number} createdAt
 *
 * @typedef {Object} Occurrence
 * @property {string} id
 * @property {string} formId
 * @property {string} lexemeId
 * @property {string} word        The exact text clicked, for highlighting in the sentence.
 * @property {string} sentence
 * @property {string} url
 * @property {string} title
 * @property {number} encounteredAt
 *
 * @typedef {Object} VocabState
 * @property {1} version
 * @property {Record<string, Lexeme>} lexemes
 * @property {Record<string, WordForm>} forms
 * @property {Record<string, Occurrence>} occurrences
 *
 * @typedef {Object} SaveInput
 * @property {LookupResult} result
 * @property {string} sentence
 * @property {string} url
 * @property {string} title
 *
 * @typedef {Object} SavedStatus
 * @property {boolean} saved        This exact form is in the collection.
 * @property {string|null} lexemeId
 * @property {string|null} formId
 * @property {string|null} savedLemma  Set when another form of the same lemma is saved.
 */

/** @returns {VocabState} */
export function emptyState() {
  return { version: 1, lexemes: {}, forms: {}, occurrences: {} };
}

/** @param {string} s */
const nfc = (s) => s.normalize('NFC').trim();

/** @param {string} lang @param {string} lemma */
export const lexemeId = (lang, lemma) => `${lang}:${nfc(lemma)}`;
/** @param {string} lang @param {string} form */
export const formId = (lang, form) => `${lang}:${nfc(form)}`;

/** @param {LookupResult} result */
function lemmaOf(result) {
  return nfc(result.lemma || result.headword || result.word);
}

/**
 * Adds a lookup result to the collection (creating the lexeme and form as
 * needed) and records where it was encountered. Mutates `state`.
 *
 * @param {VocabState} state
 * @param {SaveInput} input
 * @param {number} now
 * @param {() => string} newId
 */
export function saveOccurrence(state, input, now, newId) {
  const { result } = input;
  const lemma = lemmaOf(result);
  const headword = nfc(result.headword || result.word);
  const lxId = lexemeId(result.lang, lemma);
  const fId = formId(result.lang, headword);

  const existingLexeme = state.lexemes[lxId];
  const lemmaGloss = result.lemmaGloss || (lemma === headword ? result.translation : '');
  state.lexemes[lxId] = {
    id: lxId,
    lang: result.lang,
    lemma,
    gloss: lemmaGloss || existingLexeme?.gloss || '',
    partOfSpeech:
      (lemma === headword ? result.partOfSpeech : result.lemmaPartOfSpeech) || existingLexeme?.partOfSpeech || '',
    createdAt: existingLexeme?.createdAt ?? now,
    updatedAt: now,
  };

  const existingForm = state.forms[fId];
  if (existingForm && existingForm.lexemeId !== lxId) {
    // A newer lookup attributed this form to a different lemma; move it.
    const previous = existingForm.lexemeId;
    for (const occ of Object.values(state.occurrences)) {
      if (occ.formId === fId) occ.lexemeId = lxId;
    }
    existingForm.lexemeId = lxId;
    pruneLexeme(state, previous);
  }
  state.forms[fId] = {
    id: fId,
    lexemeId: lxId,
    lang: result.lang,
    form: headword,
    translation: result.translation || existingForm?.translation || '',
    grammar: result.grammar || existingForm?.grammar || '',
    provider: result.provider,
    createdAt: existingForm?.createdAt ?? now,
  };

  const sentence = input.sentence.trim();
  const duplicate = Object.values(state.occurrences).find(
    (o) => o.formId === fId && o.sentence === sentence && o.url === input.url,
  );
  if (duplicate) {
    duplicate.encounteredAt = now;
  } else {
    const id = newId();
    state.occurrences[id] = {
      id,
      formId: fId,
      lexemeId: lxId,
      word: result.word,
      sentence,
      url: input.url,
      title: input.title,
      encounteredAt: now,
    };
  }
  return { lexemeId: lxId, formId: fId };
}

/** Removes a lexeme if no forms reference it any more. @param {VocabState} state @param {string} lxId */
function pruneLexeme(state, lxId) {
  const stillUsed = Object.values(state.forms).some((f) => f.lexemeId === lxId);
  if (!stillUsed) delete state.lexemes[lxId];
}

/** @param {VocabState} state @param {string} fId */
export function removeForm(state, fId) {
  const form = state.forms[fId];
  if (!form) return false;
  delete state.forms[fId];
  for (const [id, occ] of Object.entries(state.occurrences)) {
    if (occ.formId === fId) delete state.occurrences[id];
  }
  pruneLexeme(state, form.lexemeId);
  return true;
}

/** @param {VocabState} state @param {string} lxId */
export function removeLexeme(state, lxId) {
  if (!state.lexemes[lxId]) return false;
  delete state.lexemes[lxId];
  for (const [id, f] of Object.entries(state.forms)) {
    if (f.lexemeId === lxId) delete state.forms[id];
  }
  for (const [id, o] of Object.entries(state.occurrences)) {
    if (o.lexemeId === lxId) delete state.occurrences[id];
  }
  return true;
}

/**
 * @param {VocabState} state
 * @param {LookupResult} result
 * @returns {SavedStatus}
 */
export function savedStatus(state, result) {
  const fId = formId(result.lang, result.headword || result.word);
  const form = state.forms[fId];
  if (form) return { saved: true, formId: fId, lexemeId: form.lexemeId, savedLemma: null };
  const lxId = lexemeId(result.lang, lemmaOf(result));
  const lexeme = state.lexemes[lxId];
  return {
    saved: false,
    formId: null,
    lexemeId: lexeme ? lxId : null,
    savedLemma: lexeme ? lexeme.lemma : null,
  };
}

/** Case-, accent- and ß-insensitive folding for search. @param {string} s */
export function fold(s) {
  return s
    .toLocaleLowerCase('de')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/**
 * @typedef {Object} VocabEntry
 * @property {Lexeme} lexeme
 * @property {WordForm[]} forms
 * @property {Occurrence[]} occurrences  Most recent first.
 */

/**
 * Builds the list shown in the side panel: one entry per lexeme, most
 * recently saved first, optionally filtered by a search query that matches
 * German forms, lemmas and English meanings.
 *
 * @param {VocabState} state
 * @param {string} [query]
 * @returns {VocabEntry[]}
 */
export function listEntries(state, query = '') {
  /** @type {Map<string, VocabEntry>} */
  const byLexeme = new Map();
  for (const lexeme of Object.values(state.lexemes)) {
    byLexeme.set(lexeme.id, { lexeme, forms: [], occurrences: [] });
  }
  for (const form of Object.values(state.forms)) byLexeme.get(form.lexemeId)?.forms.push(form);
  for (const occ of Object.values(state.occurrences)) byLexeme.get(occ.lexemeId)?.occurrences.push(occ);

  const q = fold(query.trim());
  const entries = [...byLexeme.values()].filter((e) => {
    if (!q) return true;
    const haystack = [
      e.lexeme.lemma,
      e.lexeme.gloss,
      ...e.forms.flatMap((f) => [f.form, f.translation]),
    ];
    return haystack.some((s) => fold(s).includes(q));
  });
  for (const e of entries) {
    e.occurrences.sort((a, b) => b.encounteredAt - a.encounteredAt);
    e.forms.sort((a, b) => b.createdAt - a.createdAt);
  }
  return entries.sort((a, b) => b.lexeme.updatedAt - a.lexeme.updatedAt);
}
