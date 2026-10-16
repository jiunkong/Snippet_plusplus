# AGENTS.md

## Project overview

Snippet++ is a Chrome Manifest V3 extension that expands typed triggers into snippets in input, textarea, and contenteditable fields. The options page manages snippet groups, triggers, replacement templates, hotkeys, language, and sync settings. The extension uses plain JavaScript, HTML, and CSS; it has no package manifest or build step.

Snippets support regular-expression captures, variables and expressions, integer ranges, conditional blocks, loops, built-in functions, and calls to other snippets in the same group. Cursor placeholders control where typing continues after expansion. Subgroups organize snippets with folding and drag-and-drop ordering. The options page also provides a localized syntax guide and an isolated test tab that runs the real expansion engine against current edits.

Settings sync through Chrome Sync and can be exported as a full configuration (`.sppcfg`) or a single group (`.sppgrp`), with a choice of gzip-compressed binary or plain JSON. Imports detect the format automatically and retain support for legacy JSON files. Exported files carry the extension version; importing files from older or newer versions displays a compatibility warning before the user decides whether to continue.

## Repository layout

- `manifest.json`: extension permissions, service worker, options page, and ordered content-script list.
- `background.js`: opens the options page from the toolbar action.
- `utils/`: shared defaults, trigger compilation, and Chrome Sync persistence.
- `content/`: editor detection, settings, template evaluation, placeholder handling, expansion, effects, and event handlers.
- `options/`: options-page state, persistence, localization, hotkeys, groups and subgroups, snippet editing, highlighting, syntax-guide navigation, and test-tab integration.
- `options.html`, `tester.html`: settings UI and isolated test document; each declares its classic-script loading order.
- `styles/`, `content.css`, `options.css`: extension and options-page styles.
- `_locales/{en,ko}/messages.json`: Chrome extension message catalogs.
- `tests/*.test.cjs`: Node.js built-in test-runner tests using `node:test` and VM/browser API harnesses.

## Working conventions

- Preserve the classic-script architecture. Files share top-level declarations and globals; avoid converting individual files to ES modules unless all script loading and callers are updated together.
- Script order is part of the runtime contract. If adding or moving a shared helper, update both `manifest.json`'s `content_scripts[0].js` and the script list in `options.html` where relevant. Dependencies must load before consumers.
- Keep snippet expansion and template evaluation safe. Do not introduce `eval` or `new Function`; expressions are handled by `content/evaluator.js`.
- Treat Chrome Sync persistence in `utils/sync.js` as a versioned chunk-and-manifest protocol. Maintain compatibility with legacy `snippetGroups` data and avoid publishing a manifest until all new chunks are written.
- Keep the export codec in `options/file-format.js` compatible with existing files. Binary exports use an `SPPB` header with an independent format version and file kind, followed by gzip-compressed UTF-8 JSON. Do not confuse the binary format version with the extension version in the payload. Preserve JSON export/import and detect the format by contents, not filename extensions.
- Keep user-facing strings localized. Add or update matching keys in both English and Korean catalogs, and use the existing options localization helpers where applicable.
- Preserve existing editor behavior for inputs and contenteditable hosts, including cursor placeholders, selection/caret placement, undo, and prompt cancellation. Host editors can normalize DOM and emit asynchronous input events, so avoid changing timing assumptions without updating focused tests.
- Keep tests self-contained with Node's built-in `node:test`; do not add a dependency or build tool for tests without a project-level need.

## Versioning and file compatibility

- When adding a feature, increment `manifest.json`'s `version` as part of the same change so exported files identify the capabilities required to use them. This includes template syntax and built-in functions, even when the exported JSON structure stays the same. Also increment the version for changes to existing syntax or saved-data behavior that affect file compatibility.
- Version bumps are per commit, not per feature or conversation turn. Before bumping, compare the working-tree version with `HEAD:manifest.json`. For changes requiring the same major/minor/patch bump level, bump at most once until those changes are committed; additional changes at that level reuse the pending version. For example, if HEAD is `1.4.0` and the pending minor version is `1.5.0`, further minor features stay at `1.5.0` until a commit. If a later change requires a higher bump level, calculate the replacement version from HEAD (for example, a pending patch becomes a single minor bump), rather than stacking increments on the pending version. A new commit starts the next version-bump cycle.
- Treat `manifest.json`'s `version` as the source of truth. Full and group exports must obtain it through `chrome.runtime.getManifest().version`; do not hardcode a separate export version.
- Keep import version comparisons numeric by component, treating omitted trailing components as zero (for example, `1.0` equals `1.0.0`). Preserve localized warnings for both older and newer files and let the user continue or cancel before changing settings or groups.
- Maintain support for legacy files without version metadata. When changing import/export behavior, verify both file types, version warnings, cancellation without mutation, and existing-file compatibility.

## Verification

Run the full test suite with:

```sh
node --test tests/*.test.cjs
```

There is no `npm test` script or build command. For extension changes, also inspect the modified manifest and options-page script order and load the unpacked extension in Chrome when browser-level verification is needed.
