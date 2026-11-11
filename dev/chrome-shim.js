// Dev-only: a minimal chrome.* stand-in so the built content script can run
// on a plain web page (served from the repo root) for manual and automated
// testing. Not shipped in the extension; the manifest doesn't reference it.
import { getPair } from '../src/shared/languages.js';
import { emptyState, removeForm, saveOccurrence, savedStatus } from '../src/shared/vocab-model.js';
import { httpFetcher, lookupWiktionary } from '../src/background/lookup/wiktionary.js';

const store = { settings: { enabled: true, pairId: 'de-en' }, vocab: emptyState() };
const listeners = [];
const log = (...a) => {
  const el = document.getElementById('log');
  if (el) el.textContent += a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n';
};

function setLocal(patch) {
  const changes = {};
  for (const [k, v] of Object.entries(patch)) {
    changes[k] = { oldValue: store[k], newValue: structuredClone(v) };
    store[k] = structuredClone(v);
  }
  for (const l of listeners) l(changes, 'local');
}

const pair = getPair('de-en');
async function handle(msg) {
  switch (msg.type) {
    case 'lookup': {
      const result = await lookupWiktionary(msg.word, pair, httpFetcher(pair));
      log('lookup', msg.word, '→', result.translation, '|', msg.sentence);
      return { result, status: savedStatus(store.vocab, result) };
    }
    case 'save': {
      const state = structuredClone(store.vocab);
      saveOccurrence(state, msg, Date.now(), () => crypto.randomUUID());
      setLocal({ vocab: state });
      log('saved', msg.result.headword);
      return { status: savedStatus(state, msg.result) };
    }
    case 'remove-form': {
      const state = structuredClone(store.vocab);
      removeForm(state, msg.formId);
      setLocal({ vocab: state });
      log('removed', msg.formId);
      return {};
    }
  }
  throw new Error('unknown ' + msg.type);
}

globalThis.chrome = {
  runtime: {
    sendMessage: (msg) => handle(msg).then((d) => ({ ok: true, ...d }), (e) => ({ ok: false, error: e.message })),
  },
  storage: {
    local: {
      get: async (k) => ({ [k]: structuredClone(store[k]) }),
      set: async (patch) => setLocal(patch),
    },
    onChanged: { addListener: (fn) => listeners.push(fn) },
  },
};
globalThis.__immersionStore = store;
globalThis.__immersionSetEnabled = (enabled) => setLocal({ settings: { ...store.settings, enabled } });

// Load the built bundle exactly as Chrome would inject it (run `npm run build` first).
// With the extension itself installed, open harness.html?real to test that copy
// instead; two copies on one page would both react to every click.
if (new URLSearchParams(location.search).has('real')) {
  log('?real: not injecting the dev bundle; using the installed extension');
} else await new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = `../dist/content.js?v=${Date.now()}`; // never a stale cached build
  s.onload = resolve;
  s.onerror = reject;
  document.head.append(s);
});
log('Ready');
