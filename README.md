# Immersion

A Chrome extension for reading German on the web.
**Click a word to understand it. Click it again to remember it.**

## Install (unpacked)

```sh
nvm use            # Node 22.14.0, pinned in .nvmrc
npm install
npm run build      # → dist/
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `dist/` folder.
3. Open any German page and click a word.

The source is ES modules with JSDoc types, checked by `tsc`. esbuild bundles it into `dist/`. The content script is bundled as an IIFE, the service worker and side panel as ES modules.

## Using it

| Action | Result |
| --- | --- |
| Click a word | Definition popover: meaning, base form, grammar note, saved status |
| Click the same word again | Saves it, with its sentence, page and date |
| Bookmark icon / **Remove** in the popover | Saves or removes explicitly |
| Click elsewhere, or press `Esc` | Dismisses the popover |
| Toolbar icon | Opens the vocabulary side panel |
| `Alt+Shift+I`, or the switch in the side panel | Turns immersion mode on or off. The badge shows `off` |

Immersion steps aside for links, buttons, form fields, editable text, anything with a pointer cursor, text you've selected, double/triple-clicks (native word selection), modified clicks, and elements explicitly marked as another language (`lang="en"`).

## How it works

```
content script (every page)          service worker                     side panel
───────────────────────────          ──────────────                     ──────────
click → caretPositionFromPoint       lookup ─┬─ Wiktionary (default)    reads storage,
      → Intl.Segmenter (word,                └─ Claude (opt-in, sees    live-updates via
        sentence) over block text                the sentence)          storage.onChanged
      → Range (hit-test, position)   save / remove → vocab-model
      → shadow-DOM popover +                 (serialized writes to
        CSS Custom Highlight                  chrome.storage.local)
```

- **No DOM changes to the page.** Words are found from the caret position plus `Intl.Segmenter`, not by wrapping text in elements. The active word is shown with the CSS Custom Highlight API. The popover lives in a closed shadow root.
- **Definitions.** By default they come from Wiktionary's REST API, which is free and needs no key. Its "form-of" markup gives the lemma and grammar (`vernachlässigt` → *past participle of* `vernachlässigen`). You can switch to Claude in settings, using your own Anthropic API key. Claude reads the whole sentence, so it picks the right sense and handles separable verbs. Claude is called through the official `@anthropic-ai/sdk`, with structured output and server-side refusal fallback. If a Claude lookup fails, the extension falls back to Wiktionary.
- **Data model** (`src/shared/vocab-model.js`):
  - **Lexeme** (lemma + gloss) → **WordForm** (surface form + in-context meaning + grammar) → **Occurrence** (sentence, URL, title, date).
  - Pure functions, shared by the service worker, the side panel and the tests.
- **Language pairs.** Everything language-specific lives in `src/shared/languages.js`. Only German → English ships.

```
static/manifest.json  (paths relative to dist/)
src/background/  service-worker.js, vocab-store.js, lookup/{lookup-service,wiktionary,claude,html-text}.js
src/content/     text-segmentation.js, word-at-point.js, popover.js, content.js
src/sidepanel/   sidepanel.{html,css,js}
src/shared/      languages.js, settings.js, vocab-model.js
tests/           node:test unit tests + recorded Wiktionary fixtures
dev/             browser harnesses with a chrome.* stand-in (not shipped)
scripts/         build.mjs (esbuild), make-icons.py
```

## Development

```sh
npm run check        # typecheck + unit tests + build
npm run watch        # rebuild on change; then reload the extension in chrome://extensions
npm test             # node:test unit tests only

npm run build && python3 -m http.server 8765   # then open:
#   http://127.0.0.1:8765/dev/harness.html    built content script on a sample German page
#   http://127.0.0.1:8765/dev/sidepanel.html  side panel with sample data
python3 scripts/make-icons.py icons             # regenerate icons
```

## Known limitations

- Wiktionary isn't context-aware. It returns the first listed sense, which may not fit the sentence.
- Separable verbs (`fängt … an`) resolve to the verb stem with Wiktionary; Claude handles them.
- Hyphenated compounds (`E-Mail-Adresse`) are split by the segmenter into parts.
- Content inside iframes and closed shadow roots isn't covered yet.
