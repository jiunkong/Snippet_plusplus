# AGENTS.md

## Project overview

Snippet++ is a Chrome Manifest V3 extension that expands typed triggers into snippets in input, textarea, and contenteditable fields. The options page manages snippet groups, triggers, replacement templates, hotkeys, language, and sync settings. The extension uses plain JavaScript, HTML, and CSS; it has no package manifest or build step.

## Repository layout

- `manifest.json`: extension permissions, service worker, options page, and ordered content-script list.
- `background.js`: opens the options page from the toolbar action.
- `utils/`: shared defaults, trigger compilation, and Chrome Sync persistence.
- `content/`: editor detection, settings, template evaluation, placeholder handling, expansion, effects, and event handlers.
- `options/`: options-page state, persistence, localization, hotkeys, groups, snippet editing, and highlighting.
- `styles/`, `content.css`, `options.css`: extension and options-page styles.
- `_locales/{en,ko}/messages.json`: Chrome extension message catalogs.
- `tests/*.test.cjs`: Node.js built-in test-runner tests using `node:test` and VM/browser API harnesses.

## Working conventions

- Preserve the classic-script architecture. Files share top-level declarations and globals; avoid converting individual files to ES modules unless all script loading and callers are updated together.
- Script order is part of the runtime contract. If adding or moving a shared helper, update both `manifest.json`'s `content_scripts[0].js` and the script list in `options.html` where relevant. Dependencies must load before consumers.
- Keep snippet expansion and template evaluation safe. Do not introduce `eval` or `new Function`; expressions are handled by `content/evaluator.js`.
- Treat Chrome Sync persistence in `utils/sync.js` as a versioned chunk-and-manifest protocol. Maintain compatibility with legacy `snippetGroups` data and avoid publishing a manifest until all new chunks are written.
- Keep user-facing strings localized. Add or update matching keys in both English and Korean catalogs, and use the existing options localization helpers where applicable.
- Preserve existing editor behavior for inputs and contenteditable hosts, including cursor placeholders, selection/caret placement, undo, and prompt cancellation. Host editors can normalize DOM and emit asynchronous input events, so avoid changing timing assumptions without updating focused tests.
- Keep tests self-contained with Node's built-in `node:test`; do not add a dependency or build tool for tests without a project-level need.

## Verification

Run the full test suite with:

```sh
node --test tests/*.test.cjs
```

There is no `npm test` script or build command. For extension changes, also inspect the modified manifest and options-page script order and load the unpacked extension in Chrome when browser-level verification is needed.
